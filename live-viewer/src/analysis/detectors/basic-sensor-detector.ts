import type { DetectorFinding, FaultDetector } from '../detector';
import basicModel from '../models/basic-sensor-model.json';
import { scorePortableDenseModel, validatePortableDenseModel, type PortableDenseModel } from '../portable-dense-model';
import type { TelemetrySample } from '../types';

const WINDOW_MS = 5_000;
const STRIDE_MS = 2_500;
const PERSISTENCE_WINDOWS = 2;
type Observation = { timestampMs: number; values: Record<string, number> };

const LABELS: Record<string, { faultType: string; name: string; action: string }> = {
  gps_failure: { faultType: 'ML_GPS_SENSOR_PATTERN', name: 'GPS sensor-fault', action: 'Cross-check GPS fix, satellites, EKF, and rule-based navigation warnings' },
  accelerometer_failure: { faultType: 'ML_ACCELEROMETER_PATTERN', name: 'accelerometer-fault', action: 'Cross-check IMU health, vibration, clipping, and attitude tracking before continuing flight' },
  gyroscope_failure: { faultType: 'ML_GYROSCOPE_PATTERN', name: 'gyroscope-fault', action: 'Cross-check IMU health and attitude-rate telemetry; land safely if control is degraded' },
  compass_failure: { faultType: 'ML_COMPASS_PATTERN', name: 'compass-fault', action: 'Cross-check compass health, yaw consistency, and EKF warnings; avoid compass-dependent modes if degraded' },
  barometer_failure: { faultType: 'ML_BAROMETER_PATTERN', name: 'barometer-fault', action: 'Cross-check pressure, altitude, climb-rate, and EKF height warnings' },
};

export class BasicSensorFaultDetector implements FaultDetector {
  readonly id = 'basic-simulated-sensor-ml';
  private readonly model: PortableDenseModel | null;
  private readonly observations: Observation[] = [];
  private nextWindowEndMs?: number;
  private candidate?: string;
  private candidateRun = 0;
  private active?: string;

  constructor(artifact: unknown = basicModel) { this.model = validatePortableDenseModel(artifact); }

  evaluate(sample: Readonly<TelemetrySample>): readonly DetectorFinding[] {
    if (!this.model || !this.isSupported(sample)) return [];
    const values = observeBasicSignals(sample.values);
    if (Object.keys(values).length) this.observations.push({ timestampMs: sample.timestampMs, values });
    this.nextWindowEndMs ??= sample.timestampMs + WINDOW_MS;
    if (this.observations.length > 500 || this.nextWindowEndMs <= sample.timestampMs) {
      const cutoff = sample.timestampMs - WINDOW_MS - STRIDE_MS;
      const firstRetained = this.observations.findIndex(item => item.timestampMs >= cutoff);
      if (firstRetained > 0) this.observations.splice(0, firstRetained);
    }
    const findings: DetectorFinding[] = [];
    while (this.nextWindowEndMs <= sample.timestampMs) {
      const window = this.observations.filter(item => item.timestampMs >= this.nextWindowEndMs! - WINDOW_MS && item.timestampMs < this.nextWindowEndMs!);
      const families = new Set(window.flatMap(item => Object.keys(item.values).map(name => name.split('.')[0])));
      if (families.size >= this.model.minimum_observed_signal_families) {
        const score = scorePortableDenseModel(this.model, aggregateBasicSignals(window, this.model.features));
        const next = score && LABELS[score.predictedClass] ? score.predictedClass : undefined;
        if (next && next === this.candidate) this.candidateRun += 1;
        else { this.candidate = next; this.candidateRun = next ? 1 : 0; }
        const confirmed = this.candidateRun >= PERSISTENCE_WINDOWS ? next : undefined;
        if (this.active && this.active !== confirmed) findings.push({ status: 'cleared', key: `sensor-pattern-${this.active}` });
        if (confirmed && score) findings.push(this.finding(confirmed, score.confidence, families.size));
        this.active = confirmed;
      }
      this.nextWindowEndMs += STRIDE_MS;
    }
    return findings;
  }

  reset(): void { this.observations.length = 0; this.nextWindowEndMs = undefined; this.candidate = undefined; this.candidateRun = 0; this.active = undefined; }

  private isSupported(sample: Readonly<TelemetrySample>): boolean {
    if (sample.flightPhase !== 'flying') return false;
    return sample.source === 'dataflash' || sample.vehicle?.family === 'multicopter';
  }

  private finding(label: string, confidence: number, families: number): DetectorFinding {
    const detail = LABELS[label];
    return { status: 'active', key: `sensor-pattern-${label}`, faultType: detail.faultType, severity: 'caution', confidence,
      message: `Experimental advisory: telemetry resembles a simulated ${detail.name} pattern; this is not a confirmed diagnosis`,
      evidence: [{ signal: 'ml.simulated_pattern_probability', value: confidence, unit: 'probability', threshold: this.model!.unknown_confidence_threshold,
        description: `${families} telemetry families observed; BASiC SITL model ${this.model!.version}` }],
      suggestedAction: `${detail.action}. Use deterministic findings and vehicle health messages as primary evidence.`, };
  }
}

function finite(value: unknown): number | undefined { return typeof value === 'number' && Number.isFinite(value) ? value : undefined; }
function put(target: Record<string, number>, key: string, value: number | undefined): void { if (value !== undefined) target[key] = value; }

export function observeBasicSignals(values: Readonly<Record<string, number>>): Record<string, number> {
  const output: Record<string, number> = {};
  put(output, 'GPS.NSats', finite(values['gps.satellites'])); put(output, 'GPS.HDop', finite(values['gps.hdop']));
  put(output, 'GPS.Spd', finite(values['gps.ground_speed_mps']) ?? finite(values['speed.ground_mps']));
  put(output, 'GPS.VZ', finite(values['velocity.down_mps']) ?? (finite(values['velocity.climb_mps']) !== undefined ? -values['velocity.climb_mps'] : undefined));
  for (const [raw, canonical] of Object.entries({ GyrX:'imu.xgyro_radps', GyrY:'imu.ygyro_radps', GyrZ:'imu.zgyro_radps', AccX:'imu.xacc_mps2', AccY:'imu.yacc_mps2', AccZ:'imu.zacc_mps2', T:'imu.temperature_c' })) put(output, `IMU.${raw}`, finite(values[canonical]));
  for (const [raw, canonical] of Object.entries({ MagX:'magnetometer.x_milligauss', MagY:'magnetometer.y_milligauss', MagZ:'magnetometer.z_milligauss' })) put(output, `MAG.${raw}`, finite(values[canonical]));
  put(output, 'BARO.Alt', finite(values['position.altitude_m']) ?? finite(values['altitude.msl_m'])); put(output, 'BARO.Press', finite(values['barometer.pressure_pa']));
  put(output, 'BARO.Temp', finite(values['barometer.temperature_c'])); put(output, 'BARO.CRt', finite(values['velocity.climb_mps']));
  for (const [raw, canonical] of Object.entries({ VibeX:'vibration.x_mps2', VibeY:'vibration.y_mps2', VibeZ:'vibration.z_mps2', Clip:'imu.clipping_0' })) put(output, `VIBE.${raw}`, finite(values[canonical]));
  const degrees = 180 / Math.PI;
  for (const [raw, canonical] of Object.entries({ Roll:'attitude.roll_rad', Pitch:'attitude.pitch_rad', Yaw:'attitude.yaw_rad', DesRoll:'attitude.target_roll_rad', DesPitch:'attitude.target_pitch_rad', DesYaw:'attitude.target_yaw_rad' })) {
    const value = finite(values[canonical]); put(output, `ATT.${raw}`, value === undefined ? undefined : value * degrees);
  }
  put(output, 'ATT.ErrRP', finite(values['attitude.error_rp_deg'])); put(output, 'ATT.ErrYaw', finite(values['attitude.error_yaw_deg']));
  put(output, 'BAT.Volt', finite(values['battery.voltage_v'])); put(output, 'BAT.Curr', finite(values['battery.current_a'])); put(output, 'BAT.RemPct', finite(values['battery.remaining_pct']));
  put(output, 'RSSI.RXRSSI', finite(values['radio.rssi'])); put(output, 'RSSI.RXLQ', finite(values['radio.link_quality']));
  return output;
}

export function aggregateBasicSignals(observations: readonly Observation[], features: readonly string[]): Array<number | null> {
  const buckets = new Map<string, number[]>();
  for (const observation of observations) for (const [name, value] of Object.entries(observation.values)) { const bucket = buckets.get(name) ?? []; bucket.push(value); buckets.set(name, bucket); }
  return features.map(feature => {
    const match = feature.match(/^(.*)_(mean|std|min|max)$/); if (!match) return null;
    const values = buckets.get(match[1]); if (!values?.length) return null;
    const mean = values.reduce((sum, value) => sum + value, 0) / values.length;
    if (match[2] === 'mean') return mean;
    if (match[2] === 'std') return Math.sqrt(values.reduce((sum, value) => sum + (value - mean) ** 2, 0) / values.length);
    return match[2] === 'min' ? Math.min(...values) : Math.max(...values);
  });
}
