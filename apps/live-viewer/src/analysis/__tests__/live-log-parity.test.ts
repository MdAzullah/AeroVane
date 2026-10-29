import { describe, expect, it } from 'vitest';
import type { MavlinkMessage } from '../../mavlink/decoder';
import { createDefaultFaultDetectors, FaultDetectionEngine, MavlinkTelemetryNormalizer } from '..';

const messages: Array<{ timestampMs: number; message: MavlinkMessage }> = [
  { timestampMs: 10_000, message: makeMessage('SYS_STATUS', { voltage_battery: 10_400 }) },
  { timestampMs: 13_000, message: makeMessage('SYS_STATUS', { voltage_battery: 10_300 }) },
  { timestampMs: 20_000, message: makeMessage('SYS_STATUS', { voltage_battery: 12_000 }) },
  { timestampMs: 25_000, message: makeMessage('SYS_STATUS', { voltage_battery: 12_000 }) },
];

describe('live and saved-log detector parity', () => {
  it('produces the same fault lifecycle for identical normalized sequences', () => {
    expect(run('live')).toEqual(run('tlog'));
  });
});

function run(source: 'live' | 'tlog') {
  const normalizer = new MavlinkTelemetryNormalizer(source);
  const engine = new FaultDetectionEngine(createDefaultFaultDetectors());
  return messages.flatMap(({ message, timestampMs }) => {
    const normalized = normalizer.normalize(message, timestampMs);
    return normalized ? engine.processSample(normalized) : [];
  }).map(event => ({
    type: event.type,
    detectorId: event.fault.detectorId,
    key: event.fault.key,
    state: event.fault.state,
    startedAtMs: event.fault.startedAtMs,
    updatedAtMs: event.fault.updatedAtMs,
  }));
}

function makeMessage(name: string, values: MavlinkMessage['values']): MavlinkMessage {
  return { id: 0, name, values, systemId: 1, componentId: 1, sequence: 0 };
}
