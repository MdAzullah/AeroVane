import { COMMUNICATION_WATCHDOG_SIGNAL } from './detectors';
import type { FlightPhase, TelemetrySample, TelemetrySource } from './types';

/** Creates a canonical synthetic clock tick for communication timeout checks. */
export function createCommunicationWatchdogSample(
  timestampMs: number,
  source: TelemetrySource,
  flightPhase: FlightPhase,
): TelemetrySample {
  return {
    timestampMs,
    source,
    values: { [COMMUNICATION_WATCHDOG_SIGNAL]: 1 },
    units: { [COMMUNICATION_WATCHDOG_SIGNAL]: 'boolean' },
    availability: { [COMMUNICATION_WATCHDOG_SIGNAL]: true },
    flightPhase,
  };
}
