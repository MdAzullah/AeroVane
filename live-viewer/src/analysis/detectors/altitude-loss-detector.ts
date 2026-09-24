import type { DetectorFinding, FaultDetector } from '../detector';
import type { TelemetrySample } from '../types';
import { ConditionLatch } from './condition-latch';
import { DEFAULT_ALTITUDE_LOSS_DETECTOR_CONFIG, type AltitudeLossDetectorConfig } from './config';

export class AltitudeLossFaultDetector implements FaultDetector {
  readonly id = 'altitude-loss';
  private readonly latch = new ConditionLatch();
  private readonly config: AltitudeLossDetectorConfig;
  private throttlePct?: number;
  private descentMps?: number;
  private throttleAtMs?: number;
  private descentAtMs?: number;

  constructor(config: Partial<AltitudeLossDetectorConfig> = {}) { this.config = { ...DEFAULT_ALTITUDE_LOSS_DETECTOR_CONFIG, ...config }; }

  evaluate(sample: Readonly<TelemetrySample>): readonly DetectorFinding[] {
    if (sample.values['throttle.pct'] !== undefined) { this.throttlePct = sample.values['throttle.pct']; this.throttleAtMs = sample.timestampMs; }
    if (sample.values['velocity.down_mps'] !== undefined) { this.descentMps = sample.values['velocity.down_mps']; this.descentAtMs = sample.timestampMs; }
    if (sample.values['velocity.climb_mps'] !== undefined) { this.descentMps = -sample.values['velocity.climb_mps']; this.descentAtMs = sample.timestampMs; }
    if (this.throttlePct === undefined || this.descentMps === undefined) return [];
    const fresh = sample.timestampMs - (this.throttleAtMs ?? 0) <= 2_000 && sample.timestampMs - (this.descentAtMs ?? 0) <= 2_000;
    const flying = fresh && sample.flightPhase === 'flying';
    const bad = flying && this.throttlePct >= this.config.minimumThrottlePct && this.descentMps >= this.config.warningDescentMps;
    const state = this.latch.update(bad, sample.timestampMs, this.config.activationDelayMs, this.config.recoveryDelayMs);
    if (state.cleared) return [{ status: 'cleared', key: 'high-throttle-descent' }];
    if (!state.active) return [];
    const critical = this.descentMps >= this.config.criticalDescentMps;
    return [{ status: 'active', key: 'high-throttle-descent', faultType: critical ? 'ALTITUDE_LOSS_CRITICAL' : 'ALTITUDE_LOSS_HIGH_THROTTLE', severity: critical ? 'critical' : 'warning', confidence: 0.93, message: critical ? 'Rapid altitude loss despite high throttle' : 'Vehicle is descending despite high throttle', evidence: [
      { signal: 'velocity.descent_mps', value: this.descentMps, unit: 'm/s', threshold: critical ? this.config.criticalDescentMps : this.config.warningDescentMps, description: 'Descent rate exceeds the configured limit' },
      { signal: 'throttle.pct', value: this.throttlePct, unit: '%', threshold: this.config.minimumThrottlePct, description: 'Throttle remains above the high-demand threshold' },
    ], suggestedAction: 'Reduce horizontal demand, verify lift response, and land immediately if safe' }];
  }

  reset(): void { this.latch.reset(); this.throttlePct = this.descentMps = this.throttleAtMs = this.descentAtMs = undefined; }
}
