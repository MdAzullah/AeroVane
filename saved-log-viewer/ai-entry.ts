import { FaultDetectionEngine, createDefaultFaultDetectors, presentFaultNotification } from '../live-viewer/src/analysis';
import type { FaultRecord, FlightPhase, FrameMetadata, TelemetrySample } from '../live-viewer/src/analysis';

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
  dataCoveragePct: number;
  ruleFindings: number;
  mlFindings: number;
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

const EXPECTED_DATAFLASH_SIGNALS: Readonly<Record<string, readonly string[]>> = {
  BAT: ['battery.voltage_v', 'battery.current_a', 'battery.temperature_c'],
  CURR: ['battery.voltage_v', 'battery.current_a', 'battery.temperature_c'],
  GPS: ['gps.fix_type', 'gps.satellites', 'gps.hdop', 'gps.ground_speed_mps', 'position.altitude_m', 'velocity.down_mps'],
  GPS2: ['gps.fix_type', 'gps.satellites', 'gps.hdop', 'gps.ground_speed_mps', 'position.altitude_m', 'velocity.down_mps'],
  ATT: ['attitude.roll_rad', 'attitude.pitch_rad', 'attitude.yaw_rad', 'attitude.target_roll_rad', 'attitude.target_pitch_rad', 'attitude.target_yaw_rad', 'attitude.error_rp_deg', 'attitude.error_yaw_deg'],
  VIBE: ['vibration.x_mps2', 'vibration.y_mps2', 'vibration.z_mps2', 'imu.clipping_0', 'imu.clipping_1', 'imu.clipping_2'],
  CTUN: ['throttle.pct', 'velocity.climb_mps'],
  BARO: ['position.altitude_m', 'barometer.pressure_pa', 'barometer.temperature_c', 'velocity.climb_mps'],
  MAG: ['magnetometer.x_milligauss', 'magnetometer.y_milligauss', 'magnetometer.z_milligauss'],
  RSSI: ['radio.rssi', 'radio.link_quality'],
  IMU: ['imu.xacc_mps2', 'imu.yacc_mps2', 'imu.zacc_mps2', 'imu.xgyro_radps', 'imu.ygyro_radps', 'imu.zgyro_radps', 'imu.temperature_c'],
  EKF: ['ekf.velocity_variance', 'ekf.position_variance', 'ekf.height_variance', 'ekf.compass_variance', 'ekf.flags'],
  XKF4: ['ekf.velocity_variance', 'ekf.position_variance', 'ekf.height_variance', 'ekf.compass_variance', 'ekf.flags'],
  NKF4: ['ekf.velocity_variance', 'ekf.position_variance', 'ekf.height_variance', 'ekf.compass_variance', 'ekf.flags'],
  MSG: ['status.severity', 'status.text'],
  ERR: ['status.severity', 'status.text'],
};

/** Maps ArduPilot DataFlash fields to the source-independent detector schema. */
export class DataFlashTelemetryAdapter {
  private phase: FlightPhase = 'unknown';
  private readonly escRpm = new Map<number, number>();
  private readonly frame: FrameMetadata = {};

  normalize(record: DataFlashRecord): TelemetrySample {
    const values: Record<string, number> = {};
    const units: Record<string, string> = {};
    const textValues: Record<string, string> = {};
    const name = record.name.toUpperCase();
    const instance = record.instance ?? numberValue(record, 'Instance', 'I', 'IMU') ?? 0;

    if (name === 'PARM') {
      const parameterName = record.values.Name ?? record.values.Param;
      const parameterValue = numberValue(record, 'Value', 'Val');
      if (typeof parameterName === 'string' && parameterValue !== undefined) {
        const key = parameterName.replace(/\0/g, '').trim().toUpperCase();
        if (key === 'FRAME_CLASS') this.frame.frameClass = parameterValue;
        else if (key === 'FRAME_TYPE') this.frame.frameType = parameterValue;
        else if (key === 'Q_FRAME_CLASS') this.frame.vtolFrameClass = parameterValue;
        else if (key === 'Q_FRAME_TYPE') this.frame.vtolFrameType = parameterValue;
      }
    } else if (name === 'BAT' || name === 'CURR') {
      put(values, units, 'battery.voltage_v', numberValue(record, 'Volt', 'Voltage'), 'V');
      put(values, units, 'battery.current_a', numberValue(record, 'Curr', 'Current'), 'A');
      put(values, units, 'battery.temperature_c', numberValue(record, 'Temp'), '°C');
    } else if (name === 'GPS' || name === 'GPS2') {
      put(values, units, 'gps.fix_type', numberValue(record, 'Status'), 'enum');
      put(values, units, 'gps.satellites', numberValue(record, 'NSats', 'Sats'), 'count');
      const hdop = numberValue(record, 'HDop');
      put(values, units, 'gps.hdop', hdop !== undefined && hdop > 20 ? hdop / 100 : hdop, 'ratio');
      put(values, units, 'gps.ground_speed_mps', numberValue(record, 'Spd'), 'm/s');
      put(values, units, 'position.altitude_m', numberValue(record, 'Alt'), 'm');
      put(values, units, 'velocity.down_mps', numberValue(record, 'VZ'), 'm/s');
      const speed = numberValue(record, 'Spd');
      if ((speed ?? 0) > 1) this.phase = 'flying';
    } else if (name === 'ATT') {
      const radians = Math.PI / 180;
      put(values, units, 'attitude.roll_rad', numberValue(record, 'Roll')! * radians, 'rad');
      put(values, units, 'attitude.pitch_rad', numberValue(record, 'Pitch')! * radians, 'rad');
      put(values, units, 'attitude.yaw_rad', numberValue(record, 'Yaw')! * radians, 'rad');
      put(values, units, 'attitude.target_roll_rad', numberValue(record, 'DesRoll', 'RollDes')! * radians, 'rad');
      put(values, units, 'attitude.target_pitch_rad', numberValue(record, 'DesPitch', 'PitchDes')! * radians, 'rad');
      put(values, units, 'attitude.target_yaw_rad', numberValue(record, 'DesYaw', 'YawDes')! * radians, 'rad');
      put(values, units, 'attitude.error_rp_deg', numberValue(record, 'ErrRP'), 'deg');
      put(values, units, 'attitude.error_yaw_deg', numberValue(record, 'ErrYaw'), 'deg');
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
      put(values, units, 'barometer.pressure_pa', numberValue(record, 'Press'), 'Pa');
      put(values, units, 'barometer.temperature_c', numberValue(record, 'Temp'), '°C');
      const climb = numberValue(record, 'CRt');
      put(values, units, 'velocity.climb_mps', climb !== undefined && Math.abs(climb) > 30 ? climb / 100 : climb, 'm/s');
    } else if (name === 'MAG') {
      put(values, units, 'magnetometer.x_milligauss', numberValue(record, 'MagX'), 'mG');
      put(values, units, 'magnetometer.y_milligauss', numberValue(record, 'MagY'), 'mG');
      put(values, units, 'magnetometer.z_milligauss', numberValue(record, 'MagZ'), 'mG');
    } else if (name === 'RSSI') {
      put(values, units, 'radio.rssi', numberValue(record, 'RXRSSI'), 'dBm');
      put(values, units, 'radio.link_quality', numberValue(record, 'RXLQ'), '%');
    } else if (name === 'IMU') {
      put(values, units, 'imu.xacc_mps2', numberValue(record, 'AccX'), 'm/s²');
      put(values, units, 'imu.yacc_mps2', numberValue(record, 'AccY'), 'm/s²');
      put(values, units, 'imu.zacc_mps2', numberValue(record, 'AccZ'), 'm/s²');
      put(values, units, 'imu.xgyro_radps', numberValue(record, 'GyrX', 'GyroX'), 'rad/s');
      put(values, units, 'imu.ygyro_radps', numberValue(record, 'GyrY', 'GyroY'), 'rad/s');
      put(values, units, 'imu.zgyro_radps', numberValue(record, 'GyrZ', 'GyroZ'), 'rad/s');
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

    const availability: Record<string, boolean> = {};
    for (const signal of EXPECTED_DATAFLASH_SIGNALS[name] ?? []) {
      availability[signal] = Object.hasOwn(values, signal) || Object.hasOwn(textValues, signal);
    }
    for (const signal of Object.keys(values)) availability[signal] = true;
    for (const signal of Object.keys(textValues)) availability[signal] = true;
    const qualityFlags = Object.fromEntries(
      Object.entries(availability)
        .filter(([, available]) => !available)
        .map(([signal]) => [signal, ['missing_or_invalid'] as const]),
    );

    return {
      timestampMs: record.timestampMs,
      source: 'dataflash',
      values,
      units,
      textValues,
      availability,
      ...(Object.keys(qualityFlags).length > 0 ? { qualityFlags } : {}),
      ...(Object.keys(this.frame).length > 0 ? { frame: { ...this.frame } } : {}),
      flightPhase: this.phase,
    };
  }
}

/** Converts timestamped DataFlash records into deterministic canonical samples. */
export function normalizeDataFlashRecords(records: DataFlashRecord[]): TelemetrySample[] {
  if (!Array.isArray(records) || records.length === 0) throw new Error('The BIN file contains no timestamped DataFlash records.');
  let isSorted = true;
  for (let i = 0; i < records.length; i++) {
    const t = records[i]?.timestampMs;
    if (!Number.isFinite(t) || t < 0) throw new Error('The BIN file contains an invalid record timestamp.');
    if (isSorted && i > 0 && t < records[i - 1].timestampMs) isSorted = false;
  }
  const adapter = new DataFlashTelemetryAdapter();
  if (isSorted) {
    return records.map(record => adapter.normalize(record));
  }
  return records
    .map((record, index) => ({ record, index }))
    .sort((a, b) => a.record.timestampMs - b.record.timestampMs || a.index - b.index)
    .map(({ record }) => adapter.normalize(record));
}

export function analyzeDataFlashRecords(records: DataFlashRecord[]): DataFlashAnalysis {
  const engine = new FaultDetectionEngine(createDefaultFaultDetectors());
  const faults = new Map<string, FaultRecord>();
  engine.onFaultEvent(event => faults.set(event.fault.id, { ...event.fault, evidence: [...event.fault.evidence] }));
  const samples = normalizeDataFlashRecords(records);
  for (const sample of samples) engine.processSample(sample);
  const result = [...faults.values()].sort((a, b) => a.startedAtMs - b.startedAtMs);
  const penalty = { info: 2, caution: 5, warning: 12, critical: 25 } as const;
  const worstByDetector = new Map<string, keyof typeof penalty>();
  const severityRank = { info: 0, caution: 1, warning: 2, critical: 3 } as const;
  for (const fault of result) {
    const previous = worstByDetector.get(fault.detectorId);
    if (!previous || severityRank[fault.severity] > severityRank[previous]) worstByDetector.set(fault.detectorId, fault.severity);
  }
  const healthScore = Math.max(0, 100 - [...worstByDetector.values()].reduce((sum, severity) => sum + penalty[severity], 0));
  const samplesWithTelemetry = samples.filter(sample => Object.keys(sample.values).length > 0 || Object.keys(sample.textValues ?? {}).length > 0).length;
  const dataCoveragePct = Math.round(samplesWithTelemetry / samples.length * 100);
  const mlFindings = result.filter(fault => fault.detectorId.includes('ml') || fault.detectorId.includes('anomaly')).length;
  return { faults: result, analyzedRecords: samples.length, startedAtMs: samples[0].timestampMs, endedAtMs: samples.at(-1)!.timestampMs,
    healthScore, dataCoveragePct, ruleFindings: result.length - mlFindings, mlFindings };
}

/**
 * Worker-friendly variant for large logs. It yields between bounded batches so
 * progress messages reach the UI instead of appearing only at 0% and 100%.
 */
export async function analyzeDataFlashRecordsWithProgress(
  records: DataFlashRecord[],
  onProgress?: (progress: number) => void,
): Promise<DataFlashAnalysis> {
  if (!Array.isArray(records) || records.length === 0) throw new Error('The BIN file contains no timestamped DataFlash records.');

  let isSorted = true;
  for (let i = 0; i < records.length; i++) {
    const t = records[i]?.timestampMs;
    if (!Number.isFinite(t) || t < 0) throw new Error('The BIN file contains an invalid record timestamp.');
    if (isSorted && i > 0 && t < records[i - 1].timestampMs) isSorted = false;
  }
  onProgress?.(0.02);
  await new Promise<void>(resolve => setTimeout(resolve, 0));

  const ordered = isSorted
    ? records
    : records
        .map((record, index) => ({ record, index }))
        .sort((a, b) => a.record.timestampMs - b.record.timestampMs || a.index - b.index)
        .map(({ record }) => record);

  onProgress?.(0.08);
  await new Promise<void>(resolve => setTimeout(resolve, 0));

  const engine = new FaultDetectionEngine(createDefaultFaultDetectors());
  const faults = new Map<string, FaultRecord>();
  const adapter = new DataFlashTelemetryAdapter();
  let samplesWithTelemetry = 0;
  // Adaptive batch size: yields ~50 times regardless of log length, min 1000, max 25000
  const batchSize = Math.max(1000, Math.min(25000, Math.floor(ordered.length / 50)));
  let lastReported = -1;
  engine.onFaultEvent(event => faults.set(event.fault.id, { ...event.fault, evidence: [...event.fault.evidence] }));

  for (let start = 0; start < ordered.length; start += batchSize) {
    const end = Math.min(ordered.length, start + batchSize);
    for (let index = start; index < end; index++) {
      const sample = adapter.normalize(ordered[index]);
      if (Object.keys(sample.values).length > 0 || Object.keys(sample.textValues ?? {}).length > 0) samplesWithTelemetry++;
      engine.processSample(sample);
    }
    const progress = 0.08 + (end / ordered.length) * 0.92;
    const roundedPercent = Math.floor(progress * 100);
    if (roundedPercent !== lastReported || end === ordered.length) {
      lastReported = roundedPercent;
      onProgress?.(progress);
    }
    await new Promise<void>(resolve => setTimeout(resolve, 0));
  }

  const result = [...faults.values()].sort((a, b) => a.startedAtMs - b.startedAtMs);
  const penalty = { info: 2, caution: 5, warning: 12, critical: 25 } as const;
  const worstByDetector = new Map<string, keyof typeof penalty>();
  const severityRank = { info: 0, caution: 1, warning: 2, critical: 3 } as const;
  for (const fault of result) {
    const previous = worstByDetector.get(fault.detectorId);
    if (!previous || severityRank[fault.severity] > severityRank[previous]) worstByDetector.set(fault.detectorId, fault.severity);
  }
  const healthScore = Math.max(0, 100 - [...worstByDetector.values()].reduce((sum, severity) => sum + penalty[severity], 0));
  const mlFindings = result.filter(fault => fault.detectorId.includes('ml') || fault.detectorId.includes('anomaly')).length;
  return { faults: result, analyzedRecords: ordered.length, startedAtMs: ordered[0].timestampMs, endedAtMs: ordered.at(-1)!.timestampMs,
    healthScore, dataCoveragePct: Math.round(samplesWithTelemetry / ordered.length * 100), ruleFindings: result.length - mlFindings, mlFindings };
}

declare global {
  interface Window {
    AeroVaneAI: {
      analyzeDataFlashRecords: typeof analyzeDataFlashRecords;
      analyzeDataFlashRecordsWithProgress: typeof analyzeDataFlashRecordsWithProgress;
      normalizeDataFlashRecords: typeof normalizeDataFlashRecords;
      presentFaultNotification: typeof presentFaultNotification;
    };
    AeroVaneAI: Window['AeroVaneAI'];
  }
}
if (typeof window !== 'undefined') {
  window.AeroVaneAI = { analyzeDataFlashRecords, analyzeDataFlashRecordsWithProgress, normalizeDataFlashRecords, presentFaultNotification };
  window.AeroVaneAI = window.AeroVaneAI;
}
