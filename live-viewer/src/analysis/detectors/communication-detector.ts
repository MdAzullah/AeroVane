import type { DetectorFinding, FaultDetector } from '../detector';
import type { TelemetrySample } from '../types';
import { ConditionLatch } from './condition-latch';
import {
  DEFAULT_COMMUNICATION_DETECTOR_CONFIG,
  type CommunicationDetectorConfig,
} from './config';

/** Marker used by the worker's periodic watchdog sample. */
export const COMMUNICATION_WATCHDOG_SIGNAL = 'communication.watchdog_tick';

export class CommunicationFaultDetector implements FaultDetector {
  readonly id = 'communication';
  private readonly heartbeatLatch = new ConditionLatch();
  private readonly telemetryLatch = new ConditionLatch();
  private readonly config: CommunicationDetectorConfig;
  private lastHeartbeatMs: number | undefined;
  private lastTelemetryMs: number | undefined;

  constructor(config: Partial<CommunicationDetectorConfig> = {}) {
    this.config = { ...DEFAULT_COMMUNICATION_DETECTOR_CONFIG, ...config };
  }

  evaluate(sample: Readonly<TelemetrySample>): readonly DetectorFinding[] {
    const isWatchdog = sample.values[COMMUNICATION_WATCHDOG_SIGNAL] === 1;
    if (!isWatchdog) {
      this.lastTelemetryMs = sample.timestampMs;
      if (sample.values['flight.base_mode'] !== undefined) this.lastHeartbeatMs = sample.timestampMs;
    }

    const findings: DetectorFinding[] = [];
    if (this.lastTelemetryMs !== undefined) {
      const elapsed = Math.max(0, sample.timestampMs - this.lastTelemetryMs);
      const state = this.telemetryLatch.update(
        elapsed > this.config.telemetryTimeoutMs, sample.timestampMs,
        this.config.activationDelayMs, this.config.recoveryDelayMs,
      );
      if (state.cleared) findings.push({ status: 'cleared', key: 'telemetry' });
      if (state.active) findings.push(this.activeFinding(
        'telemetry', 'TELEMETRY_TIMEOUT', 'critical', elapsed, this.config.telemetryTimeoutMs,
        'Telemetry has stopped arriving', 'Check the radio link and prepare for the configured failsafe response',
      ));
    }

    if (this.lastHeartbeatMs !== undefined) {
      const elapsed = Math.max(0, sample.timestampMs - this.lastHeartbeatMs);
      const state = this.heartbeatLatch.update(
        elapsed > this.config.heartbeatTimeoutMs, sample.timestampMs,
        this.config.activationDelayMs, this.config.recoveryDelayMs,
      );
      if (state.cleared) findings.push({ status: 'cleared', key: 'heartbeat' });
      if (state.active) findings.push(this.activeFinding(
        'heartbeat', 'HEARTBEAT_TIMEOUT', 'warning', elapsed, this.config.heartbeatTimeoutMs,
        'Vehicle heartbeat has stopped arriving', 'Verify vehicle status and the telemetry connection',
      ));
    }
    return findings;
  }

  reset(): void {
    this.heartbeatLatch.reset();
    this.telemetryLatch.reset();
    this.lastHeartbeatMs = undefined;
    this.lastTelemetryMs = undefined;
  }

  private activeFinding(
    key: string, faultType: string, severity: 'warning' | 'critical', elapsedMs: number,
    thresholdMs: number, message: string, suggestedAction: string,
  ): Extract<DetectorFinding, { status: 'active' }> {
    return {
      status: 'active', key, faultType, severity, confidence: 0.99, message,
      evidence: [{
        signal: `communication.${key}_age_ms`, value: elapsedMs, unit: 'ms', threshold: thresholdMs,
        description: `${key === 'heartbeat' ? 'Heartbeat' : 'Telemetry'} age exceeds the configured timeout`,
      }],
      suggestedAction,
    };
  }
}
