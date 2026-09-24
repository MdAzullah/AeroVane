import type { DetectorFinding, FaultDetector } from '../detector';
import type { TelemetrySample } from '../types';
import { ConditionLatch } from './condition-latch';
import { DEFAULT_TEMPERATURE_DETECTOR_CONFIG, type TemperatureDetectorConfig } from './config';

type TemperatureKind = 'imu' | 'battery' | 'esc';

export class TemperatureFaultDetector implements FaultDetector {
  readonly id = 'temperature';
  private readonly latches: Record<TemperatureKind, ConditionLatch> = { imu: new ConditionLatch(), battery: new ConditionLatch(), esc: new ConditionLatch() };
  private readonly config: TemperatureDetectorConfig;

  constructor(config: Partial<TemperatureDetectorConfig> = {}) { this.config = { ...DEFAULT_TEMPERATURE_DETECTOR_CONFIG, ...config }; }

  evaluate(sample: Readonly<TelemetrySample>): readonly DetectorFinding[] {
    const findings: DetectorFinding[] = [];
    this.check(findings, sample, 'imu', sample.values['imu.temperature_c'], 'imu.temperature_c');
    this.check(findings, sample, 'battery', sample.values['battery.temperature_c'], 'battery.temperature_c');
    const escEntries = Object.entries(sample.values).filter(([key]) => /^esc\.\d+\.temperature_c$/.test(key));
    if (escEntries.length > 0) {
      const hottest = escEntries.reduce((max, entry) => entry[1] > max[1] ? entry : max);
      this.check(findings, sample, 'esc', hottest[1], hottest[0]);
    }
    return findings;
  }

  reset(): void { Object.values(this.latches).forEach(latch => latch.reset()); }

  private check(findings: DetectorFinding[], sample: Readonly<TelemetrySample>, kind: TemperatureKind, value: number | undefined, signal: string): void {
    if (value === undefined) return;
    const warning = this.config[`${kind}WarningC`];
    const criticalLimit = this.config[`${kind}CriticalC`];
    const state = this.latches[kind].update(value >= warning, sample.timestampMs, this.config.activationDelayMs, this.config.recoveryDelayMs);
    if (state.cleared) findings.push({ status: 'cleared', key: kind });
    if (!state.active) return;
    const critical = value >= criticalLimit;
    findings.push({ status: 'active', key: kind, faultType: `${kind.toUpperCase()}_TEMPERATURE_${critical ? 'CRITICAL' : 'HIGH'}`, severity: critical ? 'critical' : 'warning', confidence: 0.96, message: `${kind === 'esc' ? 'ESC' : kind[0].toUpperCase() + kind.slice(1)} temperature is ${critical ? 'critical' : 'high'}`, evidence: [{ signal, value, unit: '°C', threshold: critical ? criticalLimit : warning, description: 'Measured temperature exceeds the configured limit' }], suggestedAction: 'Reduce load and land safely to inspect cooling and hardware condition' });
  }
}
