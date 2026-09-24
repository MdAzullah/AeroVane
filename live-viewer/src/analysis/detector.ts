import type {
  FaultEvidence,
  FaultSeverity,
  TelemetrySample,
} from './types';

/** Finding returned while a detector considers a fault active. */
export interface ActiveFaultFinding {
  status: 'active';
  /** Stable key for this condition within the detector, such as "main". */
  key: string;
  faultType: string;
  severity: FaultSeverity;
  /** Value from 0 (uncertain) to 1 (fully confident). */
  confidence: number;
  message: string;
  evidence: readonly FaultEvidence[];
  suggestedAction: string;
}

/** Finding returned when a previously active condition has recovered. */
export interface ClearedFaultFinding {
  status: 'cleared';
  key: string;
}

export type DetectorFinding = ActiveFaultFinding | ClearedFaultFinding;

/** Small, independent module evaluated for every normalized sample. */
export interface FaultDetector {
  /** Stable identifier. Two registered detectors cannot use the same ID. */
  readonly id: string;

  evaluate(sample: Readonly<TelemetrySample>): readonly DetectorFinding[];

  /** Remove state retained from the previous flight or log. */
  reset(): void;
}

