import type { DetectorFinding, FaultDetector } from '../detector';
import type { TelemetrySample } from '../types';
import { ConditionLatch } from './condition-latch';
import { DEFAULT_SENSOR_STALENESS_DETECTOR_CONFIG, type SensorStalenessDetectorConfig } from './config';

export class SensorStalenessFaultDetector implements FaultDetector {
  readonly id = 'sensor-staleness';
  private readonly missingLatch = new ConditionLatch();
  private readonly frozenLatch = new ConditionLatch();
  private readonly config: SensorStalenessDetectorConfig;
  private lastReceivedMs?: number;
  private lastChangedMs?: number;
  private lastRoll?: number;
  private lastPitch?: number;

  constructor(config: Partial<SensorStalenessDetectorConfig> = {}) { this.config = { ...DEFAULT_SENSOR_STALENESS_DETECTOR_CONFIG, ...config }; }

  evaluate(sample: Readonly<TelemetrySample>): readonly DetectorFinding[] {
    const roll = sample.values['attitude.roll_rad'];
    const pitch = sample.values['attitude.pitch_rad'];
    if (roll !== undefined || pitch !== undefined) {
      const changed = this.lastRoll === undefined || this.lastPitch === undefined
        || Math.abs((roll ?? this.lastRoll) - this.lastRoll) > this.config.changeEpsilonRad
        || Math.abs((pitch ?? this.lastPitch) - this.lastPitch) > this.config.changeEpsilonRad;
      this.lastReceivedMs = sample.timestampMs;
      if (changed) this.lastChangedMs = sample.timestampMs;
      this.lastRoll = roll ?? this.lastRoll;
      this.lastPitch = pitch ?? this.lastPitch;
    }
    if (this.lastReceivedMs === undefined || this.lastChangedMs === undefined) return [];

    const monitoring = sample.flightPhase === 'flying' || sample.flightPhase === 'landing';
    const receiveAge = Math.max(0, sample.timestampMs - this.lastReceivedMs);
    const changeAge = Math.max(0, sample.timestampMs - this.lastChangedMs);
    const missing = monitoring && receiveAge > this.config.missingTimeoutMs;
    const frozen = monitoring && !missing && changeAge > this.config.frozenTimeoutMs;
    const findings: DetectorFinding[] = [];
    this.apply(findings, this.missingLatch, 'attitude-missing', missing, sample.timestampMs, {
      faultType: 'ATTITUDE_SENSOR_MISSING', severity: 'critical', confidence: 0.98,
      message: 'Attitude telemetry has stopped updating', signal: 'sensor.attitude_age_ms', value: receiveAge,
      threshold: this.config.missingTimeoutMs, description: 'Time since the last attitude sample exceeds the configured timeout',
      action: 'Use a safe fallback mode and land immediately if attitude data remains unavailable',
    });
    this.apply(findings, this.frozenLatch, 'attitude-frozen', frozen, sample.timestampMs, {
      faultType: 'ATTITUDE_SENSOR_FROZEN', severity: 'warning', confidence: 0.86,
      message: 'Attitude sensor values appear frozen', signal: 'sensor.attitude_unchanged_ms', value: changeAge,
      threshold: this.config.frozenTimeoutMs, description: 'Attitude values have remained unchanged beyond the configured limit',
      action: 'Avoid aggressive manoeuvres and land to inspect the attitude sensors',
    });
    return findings;
  }

  reset(): void {
    this.missingLatch.reset(); this.frozenLatch.reset();
    this.lastReceivedMs = this.lastChangedMs = this.lastRoll = this.lastPitch = undefined;
  }

  private apply(findings: DetectorFinding[], latch: ConditionLatch, key: string, bad: boolean, timestampMs: number, detail: { faultType: string; severity: 'warning' | 'critical'; confidence: number; message: string; signal: string; value: number; threshold: number; description: string; action: string }): void {
    const state = latch.update(bad, timestampMs, this.config.activationDelayMs, this.config.recoveryDelayMs);
    if (state.cleared) findings.push({ status: 'cleared', key });
    if (state.active) findings.push({ status: 'active', key, faultType: detail.faultType, severity: detail.severity, confidence: detail.confidence, message: detail.message, evidence: [{ signal: detail.signal, value: detail.value, unit: 'ms', threshold: detail.threshold, description: detail.description }], suggestedAction: detail.action });
  }
}
