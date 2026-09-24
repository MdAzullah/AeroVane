import type { DetectorFinding, FaultDetector } from '../detector';
import type { TelemetrySample } from '../types';
import { ConditionLatch } from './condition-latch';
import { DEFAULT_VIBRATION_DETECTOR_CONFIG, type VibrationDetectorConfig } from './config';

export class VibrationFaultDetector implements FaultDetector {
  readonly id = 'vibration';
  private readonly vibrationLatch = new ConditionLatch();
  private readonly clippingLatch = new ConditionLatch();
  private readonly config: VibrationDetectorConfig;
  private clippingTotal: number | undefined;

  constructor(config: Partial<VibrationDetectorConfig> = {}) {
    this.config = { ...DEFAULT_VIBRATION_DETECTOR_CONFIG, ...config };
  }

  evaluate(sample: Readonly<TelemetrySample>): readonly DetectorFinding[] {
    const findings: DetectorFinding[] = [];
    const axes = ['x', 'y', 'z'].map(axis => sample.values[`vibration.${axis}_mps2`]).filter((v): v is number => v !== undefined);
    if (axes.length > 0) {
      const peak = Math.max(...axes.map(Math.abs));
      const state = this.vibrationLatch.update(peak >= this.config.warningMps2, sample.timestampMs, this.config.activationDelayMs, this.config.recoveryDelayMs);
      if (state.cleared) findings.push({ status: 'cleared', key: 'excessive' });
      if (state.active) {
        const critical = peak >= this.config.criticalMps2;
        findings.push({ status: 'active', key: 'excessive', faultType: critical ? 'VIBRATION_CRITICAL' : 'VIBRATION_EXCESSIVE', severity: critical ? 'critical' : 'warning', confidence: 0.94, message: critical ? 'Airframe vibration is critical' : 'Airframe vibration is excessive', evidence: [{ signal: 'vibration.peak_mps2', value: peak, unit: 'm/s²', threshold: critical ? this.config.criticalMps2 : this.config.warningMps2, description: 'Peak vibration exceeds the configured limit' }], suggestedAction: 'Land safely and inspect propellers, motors, and frame mounting' });
      }
    }

    const clipping = [0, 1, 2].map(i => sample.values[`imu.clipping_${i}`]).filter((v): v is number => v !== undefined);
    if (clipping.length > 0) {
      const total = clipping.reduce((sum, value) => sum + value, 0);
      const increased = this.clippingTotal !== undefined && total > this.clippingTotal;
      this.clippingTotal = total;
      const state = this.clippingLatch.update(increased, sample.timestampMs, this.config.activationDelayMs, this.config.recoveryDelayMs);
      if (state.cleared) findings.push({ status: 'cleared', key: 'clipping' });
      if (state.active) findings.push({ status: 'active', key: 'clipping', faultType: 'IMU_CLIPPING', severity: 'warning', confidence: 0.97, message: 'IMU clipping is increasing', evidence: [{ signal: 'imu.clipping_total', value: total, unit: 'count', description: 'Cumulative accelerometer clipping count continues to increase' }], suggestedAction: 'Reduce vibration and inspect IMU isolation before the next flight' });
    }
    return findings;
  }

  reset(): void { this.vibrationLatch.reset(); this.clippingLatch.reset(); this.clippingTotal = undefined; }
}
