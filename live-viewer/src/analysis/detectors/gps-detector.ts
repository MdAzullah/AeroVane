import type { DetectorFinding, FaultDetector } from '../detector';
import type { TelemetrySample } from '../types';
import { ConditionLatch } from './condition-latch';
import { DEFAULT_GPS_DETECTOR_CONFIG, type GpsDetectorConfig } from './config';

type GpsKey = 'fix' | 'satellites' | 'accuracy';

export class GpsFaultDetector implements FaultDetector {
  readonly id = 'gps';
  private readonly latches: Record<GpsKey, ConditionLatch> = {
    fix: new ConditionLatch(), satellites: new ConditionLatch(), accuracy: new ConditionLatch(),
  };
  private readonly config: GpsDetectorConfig;

  constructor(config: Partial<GpsDetectorConfig> = {}) {
    this.config = { ...DEFAULT_GPS_DETECTOR_CONFIG, ...config };
  }

  evaluate(sample: Readonly<TelemetrySample>): readonly DetectorFinding[] {
    const findings: DetectorFinding[] = [];
    const fixType = sample.values['gps.fix_type'];
    if (fixType !== undefined) {
      this.evaluateCondition(findings, 'fix', fixType < this.config.minimumFixType, sample.timestampMs, () => ({
        status: 'active', key: 'fix', faultType: 'GPS_FIX_INVALID', severity: 'warning', confidence: 0.96,
        message: 'GPS does not have a valid 3D fix',
        evidence: [{ signal: 'gps.fix_type', value: fixType, unit: 'enum', threshold: this.config.minimumFixType, description: 'GPS fix type is below the configured minimum' }],
        suggestedAction: 'Hold position if safe and wait for a stable GPS fix',
      }));
    }

    const satellites = sample.values['gps.satellites'];
    if (satellites !== undefined) {
      this.evaluateCondition(findings, 'satellites', satellites < this.config.minimumSatellites, sample.timestampMs, () => ({
        status: 'active', key: 'satellites', faultType: 'GPS_SATELLITES_LOW', severity: 'caution', confidence: 0.9,
        message: 'GPS satellite count is low',
        evidence: [{ signal: 'gps.satellites', value: satellites, unit: 'count', threshold: this.config.minimumSatellites, description: 'Visible satellite count is below the configured minimum' }],
        suggestedAction: 'Avoid GPS-dependent manoeuvres until satellite reception improves',
      }));
    }

    const hdop = sample.values['gps.hdop'];
    if (hdop !== undefined) {
      this.evaluateCondition(findings, 'accuracy', hdop > this.config.maximumHdop, sample.timestampMs, () => ({
        status: 'active', key: 'accuracy', faultType: 'GPS_ACCURACY_POOR', severity: 'caution', confidence: 0.88,
        message: 'GPS horizontal accuracy is poor',
        evidence: [{ signal: 'gps.hdop', value: hdop, unit: 'ratio', threshold: this.config.maximumHdop, description: 'HDOP exceeds the configured maximum' }],
        suggestedAction: 'Maintain a safe flight mode and wait for GPS accuracy to improve',
      }));
    }
    return findings;
  }

  reset(): void {
    Object.values(this.latches).forEach(latch => latch.reset());
  }

  private evaluateCondition(
    findings: DetectorFinding[], key: GpsKey, isBad: boolean, timestampMs: number,
    activeFinding: () => Extract<DetectorFinding, { status: 'active' }>,
  ): void {
    const state = this.latches[key].update(isBad, timestampMs, this.config.activationDelayMs, this.config.recoveryDelayMs);
    if (state.cleared) findings.push({ status: 'cleared', key });
    if (state.active) findings.push(activeFinding());
  }
}
