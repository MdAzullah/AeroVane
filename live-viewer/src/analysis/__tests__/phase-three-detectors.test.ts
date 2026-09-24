import { describe, expect, it } from 'vitest';
import {
  BatteryFaultDetector,
  COMMUNICATION_WATCHDOG_SIGNAL,
  CommunicationFaultDetector,
  FaultDetectionEngine,
  GpsFaultDetector,
  type FaultEvent,
  type TelemetrySample,
} from '..';

function sample(timestampMs: number, values: Record<string, number>): TelemetrySample {
  return { timestampMs, source: 'simulation', values };
}

function fault(events: readonly FaultEvent[], key: string): FaultEvent | undefined {
  return events.find(event => event.fault.key === key);
}

describe('BatteryFaultDetector', () => {
  function engine(): FaultDetectionEngine {
    return new FaultDetectionEngine([new BatteryFaultDetector({
      activationDelayMs: 1_000, recoveryDelayMs: 1_000,
      warningVoltageV: 10.5, criticalVoltageV: 9.9,
      rapidDropVPerSecond: 0.5, rapidDropWindowMs: 5_000,
    })]);
  }

  it('does not alert for normal data or one bad sample', () => {
    const detector = engine();
    expect(detector.processSample(sample(0, { 'battery.voltage_v': 12 }))).toEqual([]);
    expect(detector.processSample(sample(1_000, { 'battery.voltage_v': 10.4 }))).toEqual([]);
  });

  it('creates, upgrades, and clears a low-voltage fault with evidence', () => {
    const detector = engine();
    detector.processSample(sample(0, { 'battery.voltage_v': 10.4 }));
    const warning = fault(detector.processSample(sample(1_000, { 'battery.voltage_v': 10.3 })), 'low-voltage');
    expect(warning).toMatchObject({ type: 'created', fault: { severity: 'warning', faultType: 'BATTERY_VOLTAGE_LOW' } });
    expect(warning?.fault.evidence[0]).toMatchObject({ value: 10.3, threshold: 10.5, unit: 'V' });

    const critical = fault(detector.processSample(sample(2_000, { 'battery.voltage_v': 9.8 })), 'low-voltage');
    expect(critical).toMatchObject({ type: 'updated', fault: { severity: 'critical', faultType: 'BATTERY_VOLTAGE_CRITICAL' } });

    detector.processSample(sample(3_000, { 'battery.voltage_v': 11.2 }));
    expect(fault(detector.processSample(sample(4_000, { 'battery.voltage_v': 11.3 })), 'low-voltage'))
      .toMatchObject({ type: 'cleared' });
  });

  it('detects a sustained rapid voltage drop and ignores missing battery data', () => {
    const detector = engine();
    detector.processSample(sample(0, { 'battery.voltage_v': 14 }));
    detector.processSample(sample(1_000, { 'battery.voltage_v': 13.4 }));
    expect(detector.processSample(sample(1_500, { 'gps.fix_type': 3 }))).toEqual([]);
    const rapid = fault(detector.processSample(sample(2_000, { 'battery.voltage_v': 12.8 })), 'rapid-drop');
    expect(rapid).toMatchObject({ type: 'created', fault: { faultType: 'BATTERY_VOLTAGE_RAPID_DROP' } });
    expect(rapid?.fault.evidence[0].threshold).toBe(0.5);
  });
});

describe('GpsFaultDetector', () => {
  function engine(): FaultDetectionEngine {
    return new FaultDetectionEngine([new GpsFaultDetector({ activationDelayMs: 1_000, recoveryDelayMs: 1_000 })]);
  }

  it('creates no faults for healthy or missing GPS values', () => {
    const detector = engine();
    expect(detector.processSample(sample(0, { 'gps.fix_type': 3, 'gps.satellites': 10, 'gps.hdop': 1.2 }))).toEqual([]);
    expect(detector.processSample(sample(2_000, { 'battery.voltage_v': 12 }))).toEqual([]);
  });

  it('debounces fix, satellite, and accuracy faults independently', () => {
    const detector = engine();
    const bad = { 'gps.fix_type': 2, 'gps.satellites': 4, 'gps.hdop': 3.2 };
    expect(detector.processSample(sample(0, bad))).toEqual([]);
    const events = detector.processSample(sample(1_000, bad));
    expect(events.map(event => event.fault.key)).toEqual(['fix', 'satellites', 'accuracy']);
    expect(events.map(event => event.fault.evidence[0].threshold)).toEqual([3, 6, 2.5]);
  });

  it('clears recovered GPS faults only after the recovery delay', () => {
    const detector = engine();
    detector.processSample(sample(0, { 'gps.fix_type': 2 }));
    detector.processSample(sample(1_000, { 'gps.fix_type': 2 }));
    expect(detector.processSample(sample(2_000, { 'gps.fix_type': 3 }))[0]?.type).toBe('updated');
    expect(detector.processSample(sample(3_000, { 'gps.fix_type': 3 }))[0]?.type).toBe('cleared');
  });
});

describe('CommunicationFaultDetector', () => {
  function engine(): FaultDetectionEngine {
    return new FaultDetectionEngine([new CommunicationFaultDetector({
      heartbeatTimeoutMs: 2_000, telemetryTimeoutMs: 1_000,
      activationDelayMs: 0, recoveryDelayMs: 1_000,
    })]);
  }

  const tick = (timestampMs: number) => sample(timestampMs, { [COMMUNICATION_WATCHDOG_SIGNAL]: 1 });

  it('does not create a false fault before receiving telemetry', () => {
    expect(engine().processSample(tick(10_000))).toEqual([]);
  });

  it('detects heartbeat loss while other telemetry continues', () => {
    const detector = engine();
    detector.processSample(sample(0, { 'flight.base_mode': 128 }));
    const heartbeat = fault(detector.processSample(sample(2_100, { 'battery.voltage_v': 12 })), 'heartbeat');
    expect(heartbeat).toMatchObject({ type: 'created', fault: { faultType: 'HEARTBEAT_TIMEOUT', severity: 'warning' } });
    expect(fault(detector.processSample(tick(2_100)), 'telemetry')).toBeUndefined();
  });

  it('detects a complete telemetry timeout and clears after data recovers', () => {
    const detector = engine();
    detector.processSample(sample(0, { 'flight.base_mode': 128 }));
    const timedOut = detector.processSample(tick(1_100));
    expect(fault(timedOut, 'telemetry')).toMatchObject({ type: 'created', fault: { severity: 'critical' } });

    detector.processSample(sample(2_000, { 'battery.voltage_v': 12 }));
    const recovered = detector.processSample(sample(3_000, { 'battery.voltage_v': 12 }));
    expect(fault(recovered, 'telemetry')).toMatchObject({ type: 'cleared' });
  });

  it('reset removes prior communication state', () => {
    const detector = engine();
    detector.processSample(sample(0, { 'flight.base_mode': 128 }));
    detector.processSample(tick(3_000));
    detector.reset();
    expect(detector.processSample(tick(10_000))).toEqual([]);
  });
});
