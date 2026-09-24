import type { DetectorFinding, FaultDetector } from '../detector';
import type { TelemetrySample } from '../types';
import modelArtifact from '../models/anomaly-model.json';
import { ConditionLatch } from './condition-latch';

interface AnomalyModelArtifact {
  version: string; features: string[]; means: number[]; scales: number[];
  weights: number[]; bias: number; threshold: number;
}

export class MlAnomalyDetector implements FaultDetector {
  readonly id = 'ml-anomaly';
  private readonly latch = new ConditionLatch();
  private readonly latest = new Map<string, { value: number; at: number }>();
  private readonly model: AnomalyModelArtifact | null;
  private startedAtMs?: number;

  constructor(artifact: unknown = modelArtifact) { this.model = validateArtifact(artifact); }

  evaluate(sample: Readonly<TelemetrySample>): readonly DetectorFinding[] {
    if (!this.model) return [];
    this.startedAtMs ??= sample.timestampMs;
    this.capture(sample);
    if (sample.timestampMs - this.startedAtMs < 2_000) return [];
    const extracted = this.extract(sample.timestampMs);
    if (!extracted) return [];
    const score = sigmoid(this.model.bias + extracted.values.reduce((sum, value, index) => (
      sum + ((value - this.model!.means[index]) / this.model!.scales[index]) * this.model!.weights[index]
    ), 0));
    const state = this.latch.update(score >= this.model.threshold, sample.timestampMs, 1_000, 2_000);
    if (state.cleared) return [{ status: 'cleared', key: 'flight-anomaly' }];
    if (!state.active) return [];
    const ranked = extracted.contributions.sort((a, b) => Math.abs(b.value) - Math.abs(a.value)).slice(0, 3);
    return [{
      status: 'active', key: 'flight-anomaly', faultType: 'ML_FLIGHT_ANOMALY',
      severity: score >= 0.95 ? 'warning' : 'caution', confidence: score,
      message: `Unusual combined flight behaviour detected (${this.model.version})`,
      evidence: ranked.map(item => ({ signal: `ml.${item.name}`, value: item.raw, unit: item.unit, threshold: this.model!.threshold, description: `Model contribution ${item.value.toFixed(2)}` })),
      suggestedAction: 'Review the supporting signals and rule-based findings; inspect the aircraft if the anomaly repeats',
    }];
  }

  reset(): void { this.latch.reset(); this.latest.clear(); this.startedAtMs = undefined; }

  private capture(sample: Readonly<TelemetrySample>): void {
    for (const [key, value] of Object.entries(sample.values)) this.latest.set(key, { value, at: sample.timestampMs });
  }

  private extract(now: number): { values: number[]; contributions: Array<{ name: string; raw: number; value: number; unit: string }> } | null {
    const get = (key: string, fallback: number) => this.latest.get(key)?.value ?? fallback;
    const attitudeAt = Math.max(this.latest.get('attitude.roll_rad')?.at ?? now, this.latest.get('attitude.pitch_rad')?.at ?? now);
    const attitudeError = Math.max(
      Math.abs(get('attitude.target_roll_rad', get('attitude.roll_rad', 0)) - get('attitude.roll_rad', 0)),
      Math.abs(get('attitude.target_pitch_rad', get('attitude.pitch_rad', 0)) - get('attitude.pitch_rad', 0)),
    );
    const vibration = Math.max(...['x', 'y', 'z'].map(axis => Math.abs(get(`vibration.${axis}_mps2`, 5))));
    const variances = [...this.latest.entries()].filter(([key]) => key.startsWith('ekf.') && key.endsWith('_variance')).map(([, entry]) => entry.value);
    const rpms = [...this.latest.entries()].filter(([key]) => /^esc\.\d+\.rpm$/.test(key)).map(([, entry]) => Math.abs(entry.value));
    const rpmMean = rpms.length ? rpms.reduce((sum, rpm) => sum + rpm, 0) / rpms.length : 0;
    const rpmDeviation = rpms.length >= 2 && rpmMean > 0 ? Math.max(...rpms.map(rpm => Math.abs(rpm - rpmMean))) / rpmMean : 0.01;
    const throttle = get('throttle.pct', 0);
    const descent = get('velocity.down_mps', -get('velocity.climb_mps', 0));
    const values = [get('battery.voltage_v', 12.3), get('gps.satellites', 14), vibration, attitudeError, throttle >= 70 ? Math.max(0, descent) : 0, variances.length ? Math.max(...variances) : 0.2, rpmDeviation, Math.max(0, now - attitudeAt)];
    const units = ['V', 'count', 'm/s²', 'rad', 'm/s', 'variance', 'ratio', 'ms'];
    const contributions = values.map((raw, index) => ({ name: this.model!.features[index], raw, unit: units[index], value: ((raw - this.model!.means[index]) / this.model!.scales[index]) * this.model!.weights[index] }));
    return { values, contributions };
  }
}

function validateArtifact(value: unknown): AnomalyModelArtifact | null {
  if (!value || typeof value !== 'object') return null;
  const model = value as AnomalyModelArtifact;
  const length = model.features?.length;
  if (!model.version || !length || model.means?.length !== length || model.scales?.length !== length || model.weights?.length !== length) return null;
  if (![...model.means, ...model.scales, ...model.weights, model.bias, model.threshold].every(Number.isFinite) || model.scales.some(scale => scale <= 0)) return null;
  return model;
}

function sigmoid(value: number): number { return 1 / (1 + Math.exp(-Math.max(-30, Math.min(30, value)))); }
