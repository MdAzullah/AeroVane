import type { DetectorFinding, FaultDetector } from '../detector';
import realModel from '../models/real-anomaly-model.json';
import { scorePortableTreeModel, validatePortableTreeModel, type PortableTreeModel } from '../portable-tree-model';
import type { TelemetrySample } from '../types';

const WINDOW_MS = 5_000;
const STRIDE_MS = 2_500;

type Observation = { timestampMs: number; values: Record<string, number> };

export class RealAnomalyDetector implements FaultDetector {
  readonly id = 'real-ml-anomaly';
  private readonly model: PortableTreeModel | null;
  private readonly observations: Observation[] = [];
  private nextWindowEndMs?: number;
  private anomalyRun = 0;
  private active = false;

  constructor(artifact: unknown = realModel) { this.model = validatePortableTreeModel(artifact); }

  evaluate(sample: Readonly<TelemetrySample>): readonly DetectorFinding[] {
    if (!this.model || !this.isSupported(sample)) return [];
    this.observations.push({ timestampMs: sample.timestampMs, values: observe(sample.values) });
    this.nextWindowEndMs ??= sample.timestampMs + WINDOW_MS;
    const firstRetained = this.observations.findIndex(item => item.timestampMs >= sample.timestampMs - WINDOW_MS - STRIDE_MS);
    if (firstRetained > 0) this.observations.splice(0, firstRetained);
    let latest: DetectorFinding | undefined;
    while (this.nextWindowEndMs <= sample.timestampMs) {
      const window = this.observations.filter(item => item.timestampMs >= this.nextWindowEndMs! - WINDOW_MS && item.timestampMs < this.nextWindowEndMs!);
      const features = aggregate(window, this.model.features);
      const score = scorePortableTreeModel(this.model, features);
      if (score === null) return [];
      const anomalous = score >= this.model.decision_threshold;
      this.anomalyRun = anomalous ? this.anomalyRun + 1 : 0;
      const shouldBeActive = this.anomalyRun >= this.model.persistence_windows;
      if (this.active && !shouldBeActive) latest = { status: 'cleared', key: 'real-flight-anomaly' };
      if (shouldBeActive) latest = this.finding(score);
      this.active = shouldBeActive;
      this.nextWindowEndMs += STRIDE_MS;
    }
    return latest ? [latest] : [];
  }

  reset(): void {
    this.observations.length = 0;
    this.nextWindowEndMs = undefined;
    this.anomalyRun = 0;
    this.active = false;
  }

  private isSupported(sample: Readonly<TelemetrySample>): boolean {
    return sample.source !== 'dataflash' && sample.vehicle?.family === 'multicopter' && sample.flightPhase === 'flying';
  }

  private finding(score: number): DetectorFinding {
    return {
      status: 'active', key: 'real-flight-anomaly', faultType: 'ML_FLIGHT_ANOMALY',
      severity: score >= 0.9 ? 'warning' : 'caution', confidence: score,
      message: `Advisory: unusual five-second flight behaviour (${this.model!.version})`,
      evidence: [{ signal: 'ml.anomaly_probability', value: score, unit: 'probability', threshold: this.model!.decision_threshold, description: 'Portable model score after two-window persistence' }],
      suggestedAction: 'Cross-check rule-based findings and telemetry; land safely for inspection if the warning persists',
    };
  }
}

function finite(value: unknown): number | undefined { return typeof value === 'number' && Number.isFinite(value) ? value : undefined; }

function magnitude(values: Readonly<Record<string, number>>, keys: string[]): number | undefined {
  const parts = keys.map(key => finite(values[key]));
  return parts.every(value => value !== undefined) ? Math.hypot(...parts as number[]) : undefined;
}

export function observe(values: Readonly<Record<string, number>>): Record<string, number> {
  const result: Record<string, number> = {};
  const voltage = finite(values['battery.voltage_v']); if (voltage !== undefined) result.battery_voltage_v = voltage;
  const current = finite(values['battery.current_a']); if (current !== undefined) result.battery_current_a = current;
  const accel = magnitude(values, ['imu.xacc_mps2', 'imu.yacc_mps2', 'imu.zacc_mps2']); if (accel !== undefined) result.accel_magnitude_mps2 = accel;
  const gyro = magnitude(values, ['imu.xgyro_radps', 'imu.ygyro_radps', 'imu.zgyro_radps']); if (gyro !== undefined) result.gyro_magnitude_radps = gyro;
  const velocity = magnitude(values, ['velocity.north_mps', 'velocity.east_mps', 'velocity.down_mps']); if (velocity !== undefined) result.velocity_magnitude_mps = velocity;
  const ratios = ['velocity', 'position', 'height', 'magnetometer'].map(name => finite(values[`ekf.${name}_test_ratio`])).filter((value): value is number => value !== undefined);
  if (ratios.length) result.ekf_test_ratio = Math.max(...ratios);
  const attitude = ['roll', 'pitch', 'yaw'].map(name => finite(values[`attitude.${name}_rad`])).filter((value): value is number => value !== undefined);
  if (attitude.length) result.attitude_abs_rad = Math.max(...attitude.map(Math.abs));
  return result;
}

export function aggregate(observations: readonly Observation[], features: readonly string[]): Array<number | null> {
  const buckets = new Map<string, number[]>();
  for (const observation of observations) for (const [name, value] of Object.entries(observation.values)) {
    const bucket = buckets.get(name) ?? []; bucket.push(value); buckets.set(name, bucket);
  }
  return features.map(feature => {
    const match = feature.match(/^(.*)_(mean|min|max)$/); if (!match) return null;
    const values = buckets.get(match[1]); if (!values?.length) return null;
    if (match[2] === 'mean') return values.reduce((sum, value) => sum + value, 0) / values.length;
    return match[2] === 'min' ? Math.min(...values) : Math.max(...values);
  });
}
