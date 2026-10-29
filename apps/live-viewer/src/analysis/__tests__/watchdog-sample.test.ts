import { describe, expect, it } from 'vitest';
import { COMMUNICATION_WATCHDOG_SIGNAL, createCommunicationWatchdogSample } from '..';

describe('createCommunicationWatchdogSample', () => {
  it('creates a canonical available synthetic signal', () => {
    const sample = createCommunicationWatchdogSample(1_000, 'tlog', 'flying');
    expect(sample).toEqual({
      timestampMs: 1_000,
      source: 'tlog',
      values: { [COMMUNICATION_WATCHDOG_SIGNAL]: 1 },
      units: { [COMMUNICATION_WATCHDOG_SIGNAL]: 'boolean' },
      availability: { [COMMUNICATION_WATCHDOG_SIGNAL]: true },
      flightPhase: 'flying',
    });
  });
});
