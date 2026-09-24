import { describe, expect, it, vi } from 'vitest';
import type {
  DetectorFinding,
  FaultDetector,
  TelemetrySample,
} from '..';
import { FaultDetectionEngine } from '..';

const DEFAULT_SAMPLE: TelemetrySample = {
  timestampMs: 1_000,
  source: 'simulation',
  values: { 'battery.voltage': 12.4 },
};

function activeFinding(overrides: Partial<Extract<DetectorFinding, { status: 'active' }>> = {}): DetectorFinding {
  return {
    status: 'active',
    key: 'main',
    faultType: 'TEST_FAULT',
    severity: 'warning',
    confidence: 0.8,
    message: 'A test fault is active',
    evidence: [{
      signal: 'battery.voltage',
      value: 12.4,
      unit: 'V',
      threshold: 13,
      description: 'Battery voltage is below the test limit',
    }],
    suggestedAction: 'Inspect the test system',
    ...overrides,
  };
}

function detector(
  evaluate: FaultDetector['evaluate'],
  id = 'test-detector',
  reset = vi.fn(),
): FaultDetector {
  return { id, evaluate, reset };
}

describe('FaultDetectionEngine', () => {
  it('creates a fault and notifies subscribers', () => {
    const engine = new FaultDetectionEngine([
      detector(() => [activeFinding()]),
    ]);
    const subscriber = vi.fn();
    engine.onFaultEvent(subscriber);

    const events = engine.processSample(DEFAULT_SAMPLE);

    expect(events).toHaveLength(1);
    expect(events[0]).toMatchObject({
      type: 'created',
      fault: {
        id: 'fault-1',
        key: 'main',
        detectorId: 'test-detector',
        faultType: 'TEST_FAULT',
        severity: 'warning',
        state: 'active',
        confidence: 0.8,
        startedAtMs: 1_000,
        updatedAtMs: 1_000,
      },
    });
    expect(subscriber).toHaveBeenCalledWith(events[0]);
    expect(engine.getActiveFaults()).toHaveLength(1);
  });

  it('updates an existing fault instead of creating a duplicate', () => {
    let confidence = 0.6;
    const engine = new FaultDetectionEngine([
      detector(() => [activeFinding({ confidence })]),
    ]);

    const created = engine.processSample(DEFAULT_SAMPLE)[0];
    confidence = 0.95;
    const updated = engine.processSample({ ...DEFAULT_SAMPLE, timestampMs: 2_000 })[0];

    expect(updated.type).toBe('updated');
    expect(updated.fault.id).toBe(created.fault.id);
    expect(updated.fault.startedAtMs).toBe(1_000);
    expect(updated.fault.updatedAtMs).toBe(2_000);
    expect(updated.fault.confidence).toBe(0.95);
    expect(engine.getActiveFaults()).toHaveLength(1);
  });

  it('keeps different keys from one detector as separate active faults', () => {
    const engine = new FaultDetectionEngine([
      detector(() => [
        activeFinding({ key: 'low' }),
        activeFinding({ key: 'rapid-drop', faultType: 'RAPID_DROP' }),
      ]),
    ]);

    const events = engine.processSample(DEFAULT_SAMPLE);

    expect(events.map(event => event.type)).toEqual(['created', 'created']);
    expect(engine.getActiveFaults().map(fault => fault.key)).toEqual(['low', 'rapid-drop']);
  });

  it('clears an active fault and ignores repeated clear findings', () => {
    let findings: readonly DetectorFinding[] = [activeFinding()];
    const engine = new FaultDetectionEngine([
      detector(() => findings),
    ]);
    engine.processSample(DEFAULT_SAMPLE);

    findings = [{ status: 'cleared', key: 'main' }];
    const cleared = engine.processSample({ ...DEFAULT_SAMPLE, timestampMs: 3_000 });
    const repeated = engine.processSample({ ...DEFAULT_SAMPLE, timestampMs: 4_000 });

    expect(cleared).toHaveLength(1);
    expect(cleared[0]).toMatchObject({
      type: 'cleared',
      fault: {
        id: 'fault-1',
        state: 'cleared',
        startedAtMs: 1_000,
        updatedAtMs: 3_000,
        clearedAtMs: 3_000,
      },
    });
    expect(repeated).toEqual([]);
    expect(engine.getActiveFaults()).toEqual([]);
  });

  it('resets engine and detector state for a new session', () => {
    const reset = vi.fn();
    const engine = new FaultDetectionEngine([
      detector(() => [activeFinding()], 'test-detector', reset),
    ]);
    engine.processSample(DEFAULT_SAMPLE);

    engine.reset();

    expect(reset).toHaveBeenCalledTimes(1);
    expect(engine.getActiveFaults()).toEqual([]);
    expect(engine.processSample(DEFAULT_SAMPLE)[0].fault.id).toBe('fault-1');
  });

  it('ignores invalid timestamps without calling detectors', () => {
    const evaluate = vi.fn(() => [activeFinding()]);
    const engine = new FaultDetectionEngine([detector(evaluate)]);

    expect(engine.processSample({ ...DEFAULT_SAMPLE, timestampMs: Number.NaN })).toEqual([]);
    expect(engine.processSample({ ...DEFAULT_SAMPLE, timestampMs: -1 })).toEqual([]);
    expect(evaluate).not.toHaveBeenCalled();
  });

  it('removes non-finite telemetry values before calling detectors', () => {
    let received: Readonly<TelemetrySample> | undefined;
    const engine = new FaultDetectionEngine([
      detector(sample => {
        received = sample;
        return [];
      }),
    ]);

    engine.processSample({
      ...DEFAULT_SAMPLE,
      values: {
        valid: 42,
        nan: Number.NaN,
        positiveInfinity: Number.POSITIVE_INFINITY,
        negativeInfinity: Number.NEGATIVE_INFINITY,
      },
    });

    expect(received?.values).toEqual({ valid: 42 });
  });

  it('ignores malformed findings and removes invalid evidence', () => {
    const engine = new FaultDetectionEngine([
      detector(() => [
        activeFinding({ key: '' }),
        activeFinding({ key: 'valid', evidence: [
          {
            signal: 'valid',
            value: 1,
            description: 'Valid evidence',
          },
          {
            signal: 'invalid',
            value: Number.NaN,
            description: 'Invalid evidence',
          },
        ] }),
      ]),
    ]);

    const events = engine.processSample(DEFAULT_SAMPLE);

    expect(events).toHaveLength(1);
    expect(events[0].fault.key).toBe('valid');
    expect(events[0].fault.evidence).toHaveLength(1);
  });

  it('clamps confidence to the supported 0 to 1 range', () => {
    const highEngine = new FaultDetectionEngine([
      detector(() => [activeFinding({ confidence: 5 })]),
    ]);
    const lowEngine = new FaultDetectionEngine([
      detector(() => [activeFinding({ confidence: -2 })]),
    ]);

    expect(highEngine.processSample(DEFAULT_SAMPLE)[0].fault.confidence).toBe(1);
    expect(lowEngine.processSample(DEFAULT_SAMPLE)[0].fault.confidence).toBe(0);
  });

  it('isolates a failing detector and reports its error', () => {
    const error = new Error('Detector failed');
    const engine = new FaultDetectionEngine([
      detector(() => { throw error; }, 'broken'),
      detector(() => [activeFinding()], 'healthy'),
    ]);
    const errorSubscriber = vi.fn();
    engine.onDetectorError(errorSubscriber);

    const events = engine.processSample(DEFAULT_SAMPLE);

    expect(events).toHaveLength(1);
    expect(events[0].fault.detectorId).toBe('healthy');
    expect(errorSubscriber).toHaveBeenCalledWith({
      detectorId: 'broken',
      timestampMs: 1_000,
      error,
    });
  });

  it('rejects empty and duplicate detector IDs', () => {
    const engine = new FaultDetectionEngine();

    expect(() => engine.registerDetector(detector(() => [], '  ')))
      .toThrow('Detector ID cannot be empty');

    engine.registerDetector(detector(() => [], 'duplicate'));
    expect(() => engine.registerDetector(detector(() => [], 'duplicate')))
      .toThrow('Detector ID already registered: duplicate');
  });

  it('returns defensive copies of active faults and evidence', () => {
    const engine = new FaultDetectionEngine([
      detector(() => [activeFinding()]),
    ]);
    engine.processSample(DEFAULT_SAMPLE);

    const first = engine.getActiveFaults();
    first[0].message = 'Changed outside the engine';
    first[0].evidence[0].description = 'Changed evidence';
    const second = engine.getActiveFaults();

    expect(second[0].message).toBe('A test fault is active');
    expect(second[0].evidence[0].description).toBe('Battery voltage is below the test limit');
  });

  it('dispose clears state and all subscribers', () => {
    const reset = vi.fn();
    const engine = new FaultDetectionEngine([
      detector(() => [activeFinding()], 'test-detector', reset),
    ]);
    const subscriber = vi.fn();
    engine.onFaultEvent(subscriber);
    engine.processSample(DEFAULT_SAMPLE);

    engine.dispose();
    engine.processSample(DEFAULT_SAMPLE);

    expect(reset).toHaveBeenCalledTimes(1);
    expect(subscriber).toHaveBeenCalledTimes(1);
  });
});
