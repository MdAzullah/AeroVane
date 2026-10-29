import type { DetectorFinding, FaultDetector } from '../detector';
import type { TelemetrySample } from '../types';
import { ConditionLatch } from './condition-latch';
import {
  DEFAULT_BATTERY_DETECTOR_CONFIG,
  type BatteryDetectorConfig,
} from './config';

interface VoltagePoint { timestampMs: number; voltageV: number }

export class BatteryFaultDetector implements FaultDetector {
  readonly id = 'battery';
  private readonly voltageLatch = new ConditionLatch();
  private readonly dropLatch = new ConditionLatch();
  private readonly voltageHistory: VoltagePoint[] = [];
  private readonly config: BatteryDetectorConfig;

  constructor(config: Partial<BatteryDetectorConfig> = {}) {
    this.config = { ...DEFAULT_BATTERY_DETECTOR_CONFIG, ...config };
  }

  evaluate(sample: Readonly<TelemetrySample>): readonly DetectorFinding[] {
    const voltageV = sample.values['battery.voltage_v'];
    if (voltageV === undefined) return [];

    const findings: DetectorFinding[] = [];
    const voltageState = this.voltageLatch.update(
      voltageV <= this.config.warningVoltageV,
      sample.timestampMs,
      this.config.activationDelayMs,
      this.config.recoveryDelayMs,
    );
    if (voltageState.cleared) findings.push({ status: 'cleared', key: 'low-voltage' });
    if (voltageState.active) {
      const critical = voltageV <= this.config.criticalVoltageV;
      const threshold = critical ? this.config.criticalVoltageV : this.config.warningVoltageV;
      findings.push({
        status: 'active',
        key: 'low-voltage',
        faultType: critical ? 'BATTERY_VOLTAGE_CRITICAL' : 'BATTERY_VOLTAGE_LOW',
        severity: critical ? 'critical' : 'warning',
        confidence: critical ? 0.98 : 0.92,
        message: critical ? 'Battery voltage is critically low' : 'Battery voltage is low',
        evidence: [{
          signal: 'battery.voltage_v', value: voltageV, unit: 'V', threshold,
          description: `Battery voltage is at or below the configured ${critical ? 'critical' : 'warning'} limit`,
        }],
        suggestedAction: critical ? 'Land immediately in the nearest safe area' : 'Prepare to land and monitor battery voltage',
      });
    }

    const dropRate = this.recordAndCalculateDropRate(sample.timestampMs, voltageV);
    if (dropRate !== undefined) {
      const dropState = this.dropLatch.update(
        dropRate >= this.config.rapidDropVPerSecond,
        sample.timestampMs,
        this.config.activationDelayMs,
        this.config.recoveryDelayMs,
      );
      if (dropState.cleared) findings.push({ status: 'cleared', key: 'rapid-drop' });
      if (dropState.active) findings.push({
        status: 'active',
        key: 'rapid-drop',
        faultType: 'BATTERY_VOLTAGE_RAPID_DROP',
        severity: 'warning',
        confidence: 0.88,
        message: 'Battery voltage is falling unusually fast',
        evidence: [{
          signal: 'battery.voltage_drop_v_per_s', value: dropRate, unit: 'V/s',
          threshold: this.config.rapidDropVPerSecond,
          description: 'Observed voltage drop rate exceeds the configured limit',
        }],
        suggestedAction: 'Reduce power demand and land as soon as safely possible',
      });
    }
    return findings;
  }

  reset(): void {
    this.voltageLatch.reset();
    this.dropLatch.reset();
    this.voltageHistory.length = 0;
  }

  private recordAndCalculateDropRate(timestampMs: number, voltageV: number): number | undefined {
    const last = this.voltageHistory.at(-1);
    if (last && timestampMs <= last.timestampMs) return undefined;
    this.voltageHistory.push({ timestampMs, voltageV });
    const cutoff = timestampMs - this.config.rapidDropWindowMs;
    while (this.voltageHistory.length > 1 && this.voltageHistory[1].timestampMs <= cutoff) {
      this.voltageHistory.shift();
    }
    const first = this.voltageHistory[0];
    const elapsedSeconds = (timestampMs - first.timestampMs) / 1_000;
    if (elapsedSeconds <= 0) return undefined;
    return Math.max(0, (first.voltageV - voltageV) / elapsedSeconds);
  }
}
