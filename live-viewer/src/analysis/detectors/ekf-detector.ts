import type { DetectorFinding, FaultDetector } from '../detector';
import type { TelemetrySample } from '../types';
import { ConditionLatch } from './condition-latch';
import { DEFAULT_EKF_DETECTOR_CONFIG, type EkfDetectorConfig } from './config';

const EKF_GPS_GLITCH = 1 << 10;
const EKF_ACCEL_ERROR = 1 << 11;
const ERROR_FLAGS = EKF_GPS_GLITCH | EKF_ACCEL_ERROR;

export class EkfFaultDetector implements FaultDetector {
  readonly id = 'ekf';
  private readonly latch = new ConditionLatch();
  private readonly config: EkfDetectorConfig;

  constructor(config: Partial<EkfDetectorConfig> = {}) { this.config = { ...DEFAULT_EKF_DETECTOR_CONFIG, ...config }; }

  evaluate(sample: Readonly<TelemetrySample>): readonly DetectorFinding[] {
    const flags = sample.values['ekf.flags'];
    const variances = Object.entries(sample.values).filter(([key]) => key.startsWith('ekf.') && key.endsWith('_variance'));
    if (flags === undefined && variances.length === 0) return [];
    const maximum = variances.reduce((max, [, value]) => Math.max(max, value), 0);
    const errorFlags = flags === undefined ? 0 : (Math.trunc(flags) & ERROR_FLAGS);
    const bad = errorFlags !== 0 || maximum >= this.config.warningVariance;
    const state = this.latch.update(bad, sample.timestampMs, this.config.activationDelayMs, this.config.recoveryDelayMs);
    if (state.cleared) return [{ status: 'cleared', key: 'health' }];
    if (!state.active) return [];
    const critical = errorFlags !== 0 || maximum >= this.config.criticalVariance;
    const evidence = errorFlags !== 0
      ? { signal: 'ekf.error_flags', value: errorFlags, unit: 'bitmask', threshold: 0, description: 'EKF reports GPS glitch or accelerometer error flags' }
      : { signal: 'ekf.maximum_variance', value: maximum, unit: 'variance', threshold: critical ? this.config.criticalVariance : this.config.warningVariance, description: 'Maximum EKF variance exceeds the configured limit' };
    return [{ status: 'active', key: 'health', faultType: critical ? 'EKF_HEALTH_CRITICAL' : 'EKF_VARIANCE_HIGH', severity: critical ? 'critical' : 'warning', confidence: 0.95, message: critical ? 'Navigation estimator health is critical' : 'Navigation estimator variance is high', evidence: [evidence], suggestedAction: 'Avoid GPS-dependent modes and land safely if navigation remains unreliable' }];
  }

  reset(): void { this.latch.reset(); }
}
