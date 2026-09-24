import type { DetectorFinding, FaultDetector } from '../detector';
import type { FaultSeverity, TelemetrySample } from '../types';
import { ConditionLatch } from './condition-latch';
import { DEFAULT_STATUS_TEXT_DETECTOR_CONFIG, type StatusTextDetectorConfig } from './config';

const IMPORTANT_PATTERN = /failsafe|failure|failed|critical|emergency|crash|ekf|vibration|temperature high|overheat|motor error|esc error|battery (low|critical|failed)|gps (lost|glitch|failed)/i;

export class StatusTextFaultDetector implements FaultDetector {
  readonly id = 'vehicle-status';
  private readonly systemLatch = new ConditionLatch();
  private readonly config: StatusTextDetectorConfig;
  private textAlert?: { text: string; severityCode: number; seenAtMs: number };
  private textActive = false;

  constructor(config: Partial<StatusTextDetectorConfig> = {}) { this.config = { ...DEFAULT_STATUS_TEXT_DETECTOR_CONFIG, ...config }; }

  evaluate(sample: Readonly<TelemetrySample>): readonly DetectorFinding[] {
    const findings: DetectorFinding[] = [];
    const systemStatus = sample.values['flight.system_status'];
    if (systemStatus !== undefined) {
      const abnormal = systemStatus >= 5;
      const state = this.systemLatch.update(abnormal, sample.timestampMs, 0, 2_000);
      if (state.cleared) findings.push({ status: 'cleared', key: 'system-failsafe' });
      if (state.active) {
        const critical = systemStatus >= 6;
        findings.push({ status: 'active', key: 'system-failsafe', faultType: critical ? 'VEHICLE_EMERGENCY_STATE' : 'VEHICLE_CRITICAL_STATE', severity: critical ? 'critical' : 'warning', confidence: 0.99, message: critical ? 'Vehicle reports an emergency or termination state' : 'Vehicle reports a critical system state', evidence: [{ signal: 'flight.system_status', value: systemStatus, unit: 'enum', threshold: 5, description: 'MAVLink system status is critical or worse' }], suggestedAction: 'Follow the vehicle failsafe procedure and land as soon as safely possible' });
      }
    }

    const text = sample.textValues?.['status.text'];
    const severityCode = sample.values['status.severity'];
    if (text && severityCode !== undefined && (severityCode <= 3 || IMPORTANT_PATTERN.test(text))) {
      this.textAlert = { text, severityCode, seenAtMs: sample.timestampMs };
    }
    if (this.textAlert) {
      const expired = sample.timestampMs - this.textAlert.seenAtMs > this.config.activeDurationMs;
      if (expired) {
        if (this.textActive) findings.push({ status: 'cleared', key: 'important-text' });
        this.textActive = false;
        this.textAlert = undefined;
      } else {
        this.textActive = true;
        const severity = mapMavSeverity(this.textAlert.severityCode);
        findings.push({ status: 'active', key: 'important-text', faultType: 'IMPORTANT_STATUS_TEXT', severity, confidence: this.textAlert.severityCode <= 3 ? 0.98 : 0.85, message: this.textAlert.text, evidence: [{ signal: 'status.severity', value: this.textAlert.severityCode, unit: 'enum', threshold: 3, description: 'Vehicle status message is important by severity or safety keyword' }], suggestedAction: 'Review the vehicle message and follow the applicable failsafe or maintenance procedure' });
      }
    }
    return findings;
  }

  reset(): void { this.systemLatch.reset(); this.textAlert = undefined; this.textActive = false; }
}

function mapMavSeverity(code: number): FaultSeverity {
  if (code <= 2) return 'critical';
  if (code <= 4) return 'warning';
  return 'caution';
}
