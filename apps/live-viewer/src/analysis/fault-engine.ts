import { EventEmitter } from '../core';
import type {
  ActiveFaultFinding,
  DetectorFinding,
  FaultDetector,
} from './detector';
import type {
  DetectorError,
  FaultEvent,
  FaultEvidence,
  FaultRecord,
  TelemetrySample,
} from './types';

type FaultEventCallback = (event: FaultEvent) => void;
type DetectorErrorCallback = (error: DetectorError) => void;

/**
 * Runs independent fault detectors and owns the active-fault lifecycle.
 *
 * The engine is deliberately source-agnostic: Phase 2 will feed it normalized
 * MAVLink samples and later phases will use the same API for saved logs.
 */
export class FaultDetectionEngine {
  private readonly detectors = new Map<string, FaultDetector>();
  private readonly activeFaults = new Map<string, FaultRecord>();
  private readonly eventEmitter = new EventEmitter<FaultEventCallback>();
  private readonly errorEmitter = new EventEmitter<DetectorErrorCallback>();
  private nextFaultId = 1;

  constructor(detectors: readonly FaultDetector[] = []) {
    for (const detector of detectors) {
      this.registerDetector(detector);
    }
  }

  /** Register a detector. IDs must be non-empty and unique. */
  registerDetector(detector: FaultDetector): void {
    const id = detector.id.trim();
    if (!id) throw new Error('Detector ID cannot be empty');
    if (this.detectors.has(id)) {
      throw new Error(`Detector ID already registered: ${id}`);
    }
    this.detectors.set(id, detector);
  }

  /**
   * Process one sample and return the events emitted for it.
   * Invalid timestamps are ignored. Non-finite signal values are removed
   * before detectors receive the sample.
   */
  processSample(sample: Readonly<TelemetrySample>): FaultEvent[] {
    if (!Number.isFinite(sample.timestampMs) || sample.timestampMs < 0) {
      return [];
    }

    const safeSample = sanitizeSample(sample);
    const emitted: FaultEvent[] = [];

    for (const [detectorId, detector] of this.detectors) {
      let findings: readonly DetectorFinding[];
      try {
        findings = detector.evaluate(safeSample);
      } catch (error) {
        this.errorEmitter.emit({
          detectorId,
          timestampMs: safeSample.timestampMs,
          error,
        });
        continue;
      }

      if (!Array.isArray(findings)) continue;
      for (const finding of findings) {
        const event = this.applyFinding(detectorId, finding, safeSample.timestampMs);
        if (!event) continue;
        emitted.push(event);
        this.eventEmitter.emit(event);
      }
    }

    return emitted;
  }

  /** Subscribe to created, updated, and cleared fault events. */
  onFaultEvent(callback: FaultEventCallback): () => void {
    return this.eventEmitter.on(callback);
  }

  /** Subscribe to detector failures without stopping other detectors. */
  onDetectorError(callback: DetectorErrorCallback): () => void {
    return this.errorEmitter.on(callback);
  }

  /** Return immutable copies of the currently active faults. */
  getActiveFaults(): FaultRecord[] {
    return Array.from(this.activeFaults.values(), cloneFault);
  }

  /** Reset all detector and active-fault state for a new flight or log. */
  reset(): void {
    this.activeFaults.clear();
    this.nextFaultId = 1;
    for (const [detectorId, detector] of this.detectors) {
      try {
        detector.reset();
      } catch (error) {
        this.errorEmitter.emit({ detectorId, timestampMs: 0, error });
      }
    }
  }

  /** Remove subscribers and all session state. */
  dispose(): void {
    this.reset();
    this.eventEmitter.clear();
    this.errorEmitter.clear();
  }

  private applyFinding(
    detectorId: string,
    finding: DetectorFinding,
    timestampMs: number,
  ): FaultEvent | null {
    if (!isValidKey(finding.key)) return null;
    const lookupKey = `${detectorId}:${finding.key}`;

    if (finding.status === 'cleared') {
      const active = this.activeFaults.get(lookupKey);
      if (!active) return null;

      const cleared: FaultRecord = {
        ...active,
        state: 'cleared',
        updatedAtMs: timestampMs,
        clearedAtMs: timestampMs,
      };
      this.activeFaults.delete(lookupKey);
      return { type: 'cleared', fault: cloneFault(cleared) };
    }

    if (!isValidActiveFinding(finding)) return null;
    const existing = this.activeFaults.get(lookupKey);

    if (existing) {
      const updated = buildFaultRecord(
        finding,
        detectorId,
        existing.id,
        existing.startedAtMs,
        timestampMs,
      );
      this.activeFaults.set(lookupKey, updated);
      return { type: 'updated', fault: cloneFault(updated) };
    }

    const created = buildFaultRecord(
      finding,
      detectorId,
      `fault-${this.nextFaultId++}`,
      timestampMs,
      timestampMs,
    );
    this.activeFaults.set(lookupKey, created);
    return { type: 'created', fault: cloneFault(created) };
  }
}

function sanitizeSample(sample: Readonly<TelemetrySample>): TelemetrySample {
  const values: Record<string, number> = {};
  const units: Record<string, string> = {};
  const textValues: Record<string, string> = {};
  const availability: Record<string, boolean> = {};
  const qualityFlags: Record<string, readonly import('./types').SignalQualityFlag[]> = {};
  for (const [key, value] of Object.entries(sample.values ?? {})) {
    if (key && typeof value === 'number' && Number.isFinite(value)) {
      values[key] = value;
      const unit = sample.units?.[key];
      if (typeof unit === 'string' && unit.length > 0) units[key] = unit;
    }
  }
  for (const [key, value] of Object.entries(sample.textValues ?? {})) {
    if (key && typeof value === 'string' && value.length > 0) textValues[key] = value;
  }
  for (const [key, available] of Object.entries(sample.availability ?? {})) {
    if (key && typeof available === 'boolean') availability[key] = available;
  }
  for (const [key, flags] of Object.entries(sample.qualityFlags ?? {})) {
    if (key && Array.isArray(flags)) qualityFlags[key] = [...flags];
  }
  return {
    ...sample,
    values,
    ...(Object.keys(units).length > 0 ? { units } : { units: undefined }),
    ...(Object.keys(textValues).length > 0 ? { textValues } : { textValues: undefined }),
    ...(Object.keys(availability).length > 0 ? { availability } : { availability: undefined }),
    ...(Object.keys(qualityFlags).length > 0 ? { qualityFlags } : { qualityFlags: undefined }),
  };
}

function isValidKey(key: unknown): key is string {
  return typeof key === 'string' && key.trim().length > 0;
}

function isValidActiveFinding(finding: ActiveFaultFinding): boolean {
  return (
    finding.faultType.trim().length > 0
    && finding.message.trim().length > 0
    && finding.suggestedAction.trim().length > 0
    && Number.isFinite(finding.confidence)
    && Array.isArray(finding.evidence)
  );
}

function buildFaultRecord(
  finding: ActiveFaultFinding,
  detectorId: string,
  id: string,
  startedAtMs: number,
  updatedAtMs: number,
): FaultRecord {
  return {
    id,
    key: finding.key,
    detectorId,
    faultType: finding.faultType,
    severity: finding.severity,
    state: 'active',
    confidence: Math.max(0, Math.min(1, finding.confidence)),
    message: finding.message,
    evidence: sanitizeEvidence(finding.evidence),
    suggestedAction: finding.suggestedAction,
    startedAtMs,
    updatedAtMs,
  };
}

function sanitizeEvidence(evidence: readonly FaultEvidence[]): FaultEvidence[] {
  return evidence
    .filter(item => (
      typeof item.signal === 'string'
      && item.signal.length > 0
      && typeof item.description === 'string'
      && Number.isFinite(item.value)
      && (item.threshold === undefined || Number.isFinite(item.threshold))
    ))
    .map(item => ({ ...item }));
}

function cloneFault(fault: FaultRecord): FaultRecord {
  return {
    ...fault,
    evidence: fault.evidence.map(item => ({ ...item })),
  };
}
