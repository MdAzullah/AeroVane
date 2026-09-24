import { FaultDetectionEngine, createDefaultFaultDetectors } from '../live-viewer/src/analysis';
import type { FaultRecord, FlightPhase, TelemetrySample } from '../live-viewer/src/analysis';

export interface DataFlashRecord {
  name: string;
  instance: number | null;
  timestampMs: number;
  values: Record<string, number | string>;
}

export interface DataFlashAnalysis {
  faults: FaultRecord[];
  analyzedRecords: number;
  startedAtMs: number;
  endedAtMs: number;
  healthScore: number;
}

const numberValue = (record: DataFlashRecord, ...names: string[]): number | undefined => {
  for (const name of names) {
    const value = record.values[name];
    if (typeof value === 'number' && Number.isFinite(value)) return value;
  }
  return undefined;
};

const put = (values: Record<string, number>, units: Record<string, string>, key: string, value: number | undefined, unit: string): void => {
  if (value !== undefined && Number.isFinite(value)) { values[key] = value; units[key] = unit; }
};

/** Maps ArduPilot DataFlash fields to the source-independent detector schema. */
export class DataFlashTelemetryAdapter {
  private phase: FlightPhase = 'unknown';
  private readonly escRpm = new Map<number, number>();

  normalize(record: DataFlashRecord): TelemetrySample {
    const values: Record<string, number> = {};
    const units: Record<string, string> = {};
    const textValues: Record<string, string> = {};
    const name = record.name.toUpperCase();
    const instance = record.instance ?? numberValue(record, 'Instance', 'I', 'IMU') ?? 0;

    if (name === 'BAT' || name === 'CURR') {
      put(values, units, 'battery.voltage_v', numberValue(record, 'Volt', 'Voltage'), 'V');
      put(values, units, 'battery.current_a', numberValue(record, 'Curr', 'Current'), 'A');
      put(values, units, 'battery.temperature_c', numberValue(record, 'Temp'), '°C');
    } else if (name === 'GPS' || name === 'GPS2') {
      put(values, units, 'gps.fix_type', numberValue(record, 'Status'), 'enum');
      put(values, units, 'gps.satellites', numberValue(record, 'NSats', 'Sats'), 'count');
      const hdop = numberValue(record, 'HDop');
      put(values, units, 'gps.hdop', hdop !== undefined && hdop > 20 ? hdop / 100 : hdop, 'ratio');
      put(values, units, 'position.altitude_m', numberValue(record, 'Alt'), 'm');
      put(values, units, 'velocity.down_mps', numberValue(record, 'VZ'), 'm/s');
      const speed = numberValue(record, 'Spd');
      if ((speed ?? 0) > 1) this.phase = 'flying';
    } else if (name === 'ATT') {
      const radians = Math.PI / 180;
      put(values, units, 'attitude.roll_rad', numberValue(record, 'Roll')! * radians, 'rad');
      put(values, units, 'attitude.pitch_rad', numberValue(record, 'Pitch')! * radians, 'rad');
      put(values, units, 'attitude.target_roll_rad', numberValue(record, 'DesRoll', 'RollDes')! * radians, 'rad');
      put(values, units, 'attitude.target_pitch_rad', numberValue(record, 'DesPitch', 'PitchDes')! * radians, 'rad');
    } else if (name === 'VIBE') {
      put(values, units, 'vibration.x_mps2', numberValue(record, 'VibeX'), 'm/s²');
      put(values, units, 'vibration.y_mps2', numberValue(record, 'VibeY'), 'm/s²');
      put(values, units, 'vibration.z_mps2', numberValue(record, 'VibeZ'), 'm/s²');
      put(values, units, 'imu.clipping_0', numberValue(record, 'Clip0', 'Clip'), 'count');
      put(values, units, 'imu.clipping_1', numberValue(record, 'Clip1'), 'count');
      put(values, units, 'imu.clipping_2', numberValue(record, 'Clip2'), 'count');
    } else if (name === 'CTUN') {
      const throttle = numberValue(record, 'ThO', 'ThrOut');
      put(values, units, 'throttle.pct', throttle !== undefined && throttle <= 1.5 ? throttle * 100 : throttle, '%');
      const climb = numberValue(record, 'CRt', 'ClimbRate');
      put(values, units, 'velocity.climb_mps', climb !== undefined && Math.abs(climb) > 30 ? climb / 100 : climb, 'm/s');
      if ((throttle ?? 0) > 0.2) this.phase = 'flying';
    } else if (name === 'BARO') {
      put(values, units, 'position.altitude_m', numberValue(record, 'Alt'), 'm');
      put(values, units, 'imu.temperature_c', numberValue(record, 'Temp'), '°C');
    } else if (name === 'IMU') {
      put(values, units, 'imu.temperature_c', numberValue(record, 'T', 'Temp'), '°C');
    } else if (name === 'ESC') {
      const rpm = numberValue(record, 'RPM');
      if (rpm !== undefined) this.escRpm.set(instance, rpm);
      for (const [motor, latestRpm] of this.escRpm) put(values, units, `esc.${motor}.rpm`, latestRpm, 'rpm');
      put(values, units, `esc.${instance}.temperature_c`, numberValue(record, 'Temp'), '°C');
    } else if (name === 'XKF4' || name === 'NKF4' || name === 'EKF') {
      put(values, units, 'ekf.velocity_variance', numberValue(record, 'SV', 'VelVar'), 'variance');
      put(values, units, 'ekf.position_variance', numberValue(record, 'SP', 'PosVar'), 'variance');
      put(values, units, 'ekf.height_variance', numberValue(record, 'SH', 'HgtVar'), 'variance');
      put(values, units, 'ekf.compass_variance', numberValue(record, 'SM', 'MagVar'), 'variance');
      put(values, units, 'ekf.flags', numberValue(record, 'FS', 'Flags'), 'bitmask');
    } else if (name === 'MSG') {
      const message = record.values.Message ?? record.values.Msg;
      if (typeof message === 'string') textValues['status.text'] = message;
      values['status.severity'] = 4;
      units['status.severity'] = 'enum';
    } else if (name === 'ERR') {
      const subsystem = numberValue(record, 'Subsys') ?? -1;
      const code = numberValue(record, 'ECode') ?? -1;
      textValues['status.text'] = `DataFlash error: subsystem ${subsystem}, code ${code}`;
      values['status.severity'] = 2;
      units['status.severity'] = 'enum';
    }

    return { timestampMs: record.timestampMs, source: 'dataflash', values, units, textValues, flightPhase: this.phase };
  }
}

export function analyzeDataFlashRecords(records: DataFlashRecord[]): DataFlashAnalysis {
  if (!Array.isArray(records) || records.length === 0) throw new Error('The BIN file contains no timestamped DataFlash records.');
  const engine = new FaultDetectionEngine(createDefaultFaultDetectors());
  const adapter = new DataFlashTelemetryAdapter();
  const faults = new Map<string, FaultRecord>();
  engine.onFaultEvent(event => faults.set(event.fault.id, { ...event.fault, evidence: [...event.fault.evidence] }));
  for (const record of records) engine.processSample(adapter.normalize(record));
  const result = [...faults.values()].sort((a, b) => a.startedAtMs - b.startedAtMs);
  const penalty = { info: 2, caution: 5, warning: 12, critical: 25 } as const;
  const healthScore = Math.max(0, 100 - result.reduce((sum, fault) => sum + penalty[fault.severity], 0));
  return { faults: result, analyzedRecords: records.length, startedAtMs: records[0].timestampMs, endedAtMs: records.at(-1)!.timestampMs, healthScore };
}

declare global { interface Window { SkyForgeAI: { analyzeDataFlashRecords: typeof analyzeDataFlashRecords } } }
if (typeof window !== 'undefined') window.SkyForgeAI = { analyzeDataFlashRecords };
