import type { DetectorFinding, FaultDetector } from '../detector';
import type { TelemetrySample } from '../types';
import { ConditionLatch } from './condition-latch';
import { DEFAULT_ATTITUDE_DETECTOR_CONFIG, type AttitudeDetectorConfig } from './config';

export class AttitudeFaultDetector implements FaultDetector {
  readonly id = 'attitude';
  private readonly latch = new ConditionLatch();
  private readonly config: AttitudeDetectorConfig;
  private actualRoll?: number; private actualPitch?: number;
  private targetRoll?: number; private targetPitch?: number;
  private actualAtMs?: number; private targetAtMs?: number;

  constructor(config: Partial<AttitudeDetectorConfig> = {}) { this.config = { ...DEFAULT_ATTITUDE_DETECTOR_CONFIG, ...config }; }

  evaluate(sample: Readonly<TelemetrySample>): readonly DetectorFinding[] {
    if (sample.values['attitude.roll_rad'] !== undefined || sample.values['attitude.pitch_rad'] !== undefined) {
      this.actualRoll = sample.values['attitude.roll_rad'] ?? this.actualRoll;
      this.actualPitch = sample.values['attitude.pitch_rad'] ?? this.actualPitch;
      this.actualAtMs = sample.timestampMs;
    }
    if (sample.values['attitude.target_roll_rad'] !== undefined || sample.values['attitude.target_pitch_rad'] !== undefined) {
      this.targetRoll = sample.values['attitude.target_roll_rad'] ?? this.targetRoll;
      this.targetPitch = sample.values['attitude.target_pitch_rad'] ?? this.targetPitch;
      this.targetAtMs = sample.timestampMs;
    }
    if ([this.actualRoll, this.actualPitch, this.targetRoll, this.targetPitch].some(value => value === undefined)) return [];
    const rollError = angularError(this.actualRoll!, this.targetRoll!);
    const pitchError = angularError(this.actualPitch!, this.targetPitch!);
    const maximumError = Math.max(rollError, pitchError);
    const fresh = sample.timestampMs - (this.actualAtMs ?? 0) <= 2_000 && sample.timestampMs - (this.targetAtMs ?? 0) <= 2_000;
    const monitoring = fresh && (sample.flightPhase === 'flying' || sample.flightPhase === 'landing');
    const state = this.latch.update(monitoring && maximumError >= this.config.warningErrorRad, sample.timestampMs, this.config.activationDelayMs, this.config.recoveryDelayMs);
    if (state.cleared) return [{ status: 'cleared', key: 'tracking' }];
    if (!state.active) return [];
    const critical = maximumError >= this.config.criticalErrorRad;
    return [{ status: 'active', key: 'tracking', faultType: critical ? 'ATTITUDE_TRACKING_CRITICAL' : 'ATTITUDE_TRACKING_ERROR', severity: critical ? 'critical' : 'warning', confidence: 0.9, message: 'Vehicle attitude is not following its target', evidence: [{ signal: rollError >= pitchError ? 'attitude.roll_error_rad' : 'attitude.pitch_error_rad', value: maximumError, unit: 'rad', threshold: critical ? this.config.criticalErrorRad : this.config.warningErrorRad, description: 'Maximum roll or pitch tracking error exceeds the configured limit' }], suggestedAction: 'Reduce manoeuvring demand and land if attitude control remains degraded' }];
  }

  reset(): void { this.latch.reset(); this.actualRoll = this.actualPitch = this.targetRoll = this.targetPitch = this.actualAtMs = this.targetAtMs = undefined; }
}

function angularError(actual: number, target: number): number {
  return Math.abs(Math.atan2(Math.sin(actual - target), Math.cos(actual - target)));
}
