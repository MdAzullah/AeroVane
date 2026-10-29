import type { DetectorFinding, FaultDetector } from '../detector';
import type { TelemetrySample } from '../types';
import { ConditionLatch } from './condition-latch';
import { DEFAULT_MOTOR_IMBALANCE_DETECTOR_CONFIG, type MotorImbalanceDetectorConfig } from './config';

export class MotorImbalanceFaultDetector implements FaultDetector {
  readonly id = 'motor-imbalance';
  private readonly latch = new ConditionLatch();
  private readonly config: MotorImbalanceDetectorConfig;

  constructor(config: Partial<MotorImbalanceDetectorConfig> = {}) { this.config = { ...DEFAULT_MOTOR_IMBALANCE_DETECTOR_CONFIG, ...config }; }

  evaluate(sample: Readonly<TelemetrySample>): readonly DetectorFinding[] {
    const rpms = Object.entries(sample.values).filter(([key]) => /^esc\.\d+\.rpm$/.test(key)).map(([, value]) => Math.abs(value));
    if (rpms.length < 2) return [];
    const mean = rpms.reduce((sum, value) => sum + value, 0) / rpms.length;
    const deviation = mean > 0 ? Math.max(...rpms.map(value => Math.abs(value - mean))) / mean : 0;
    const bad = mean >= this.config.minimumMeanRpm && deviation >= this.config.warningDeviationRatio;
    const state = this.latch.update(bad, sample.timestampMs, this.config.activationDelayMs, this.config.recoveryDelayMs);
    if (state.cleared) return [{ status: 'cleared', key: 'rpm' }];
    if (!state.active) return [];
    const critical = deviation >= this.config.criticalDeviationRatio;
    return [{ status: 'active', key: 'rpm', faultType: critical ? 'MOTOR_IMBALANCE_CRITICAL' : 'MOTOR_ESC_IMBALANCE', severity: critical ? 'critical' : 'warning', confidence: 0.88, message: critical ? 'Motor RPM imbalance is critical' : 'Motor or ESC RPM imbalance detected', evidence: [
      { signal: 'motor.maximum_rpm_deviation_ratio', value: deviation, unit: 'ratio', threshold: critical ? this.config.criticalDeviationRatio : this.config.warningDeviationRatio, description: 'Maximum motor RPM deviation from the group mean exceeds the limit' },
      { signal: 'motor.mean_rpm', value: mean, unit: 'rpm', threshold: this.config.minimumMeanRpm, description: 'Mean RPM is high enough for imbalance monitoring' },
    ], suggestedAction: 'Land safely and inspect motors, propellers, ESCs, and wiring' }];
  }

  reset(): void { this.latch.reset(); }
}
