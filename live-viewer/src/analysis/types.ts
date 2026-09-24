/** Source that produced a normalized telemetry sample. */
export type TelemetrySource = 'live' | 'tlog' | 'dataflash' | 'simulation';

/** Flight phase values shared by live and saved-log analysis. */
export type FlightPhase =
  | 'unknown'
  | 'disconnected'
  | 'on_ground'
  | 'armed'
  | 'flying'
  | 'landing'
  | 'landed';

/**
 * A source-independent telemetry sample consumed by fault detectors.
 *
 * Signal names and unit conversion are added by the Phase 2 normalizer. The
 * Phase 1 engine only requires finite numeric values and a valid timestamp.
 */
export interface TelemetrySample {
  timestampMs: number;
  source: TelemetrySource;
  values: Readonly<Record<string, number>>;
  /** Unit for each numeric value, keyed by the same stable signal name. */
  units?: Readonly<Record<string, string>>;
  /** Non-numeric evidence such as a MAVLink STATUSTEXT message. */
  textValues?: Readonly<Record<string, string>>;
  vehicleId?: string;
  flightPhase?: FlightPhase;
}

export type FaultSeverity = 'info' | 'caution' | 'warning' | 'critical';
export type FaultState = 'active' | 'cleared';

/** A measured value that supports a fault finding. */
export interface FaultEvidence {
  signal: string;
  value: number;
  unit?: string;
  threshold?: number;
  description: string;
}

/** A fault stored and emitted by the engine. */
export interface FaultRecord {
  /** Unique within one engine session. */
  id: string;
  /** Detector-local key used to prevent duplicate active faults. */
  key: string;
  detectorId: string;
  faultType: string;
  severity: FaultSeverity;
  state: FaultState;
  confidence: number;
  message: string;
  evidence: readonly FaultEvidence[];
  suggestedAction: string;
  startedAtMs: number;
  updatedAtMs: number;
  clearedAtMs?: number;
}

export type FaultEventType = 'created' | 'updated' | 'cleared';

/** Immutable snapshot sent to engine subscribers. */
export interface FaultEvent {
  type: FaultEventType;
  fault: Readonly<FaultRecord>;
}

/** Error from one detector. Other detectors continue to run. */
export interface DetectorError {
  detectorId: string;
  timestampMs: number;
  error: unknown;
}
