import { describe, expect, it } from 'vitest';
import { FaultDetectionEngine, createDefaultFaultDetectors, createSpoofScenarioReplay } from '..';
import { SPOOF_SCENARIOS } from '../../services/spoof-scenarios';

describe('repeatable spoof fault scenarios', () => {
  for (const scenario of SPOOF_SCENARIOS) {
    it(`${scenario.id} produces its expected result within the allowed delay`, () => {
      const engine = new FaultDetectionEngine(createDefaultFaultDetectors());
      const created: Array<{ faultType: string; startedAtMs: number; severity: string }> = [];
      for (const sample of createSpoofScenarioReplay(scenario.id)) {
        for (const event of engine.processSample(sample)) {
          if (event.type === 'created') created.push(event.fault);
        }
      }
      if (scenario.expectedFaultType === null) {
        expect(created.filter(fault => fault.severity === 'critical')).toEqual([]);
      } else {
        const expected = created.find(fault => fault.faultType === scenario.expectedFaultType);
        expect(expected, `missing ${scenario.expectedFaultType}`).toBeDefined();
        expect(expected!.startedAtMs).toBeGreaterThanOrEqual(scenario.activationMs!);
        expect(expected!.startedAtMs).toBeLessThanOrEqual(scenario.activationMs! + 5_000);
      }
    });
  }
});
