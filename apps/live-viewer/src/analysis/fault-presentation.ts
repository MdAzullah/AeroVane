import type { FaultEvidence, FaultRecord, FaultSeverity } from './types';

/** `in-flight` advises the pilot now; `post-flight` advises what to check before the next flight. */
export type FaultContext = 'in-flight' | 'post-flight';

export interface PresentedFault {
  title: string;
  /** One plain-language sentence: what is happening and the likely cause. */
  summary: string;
  /** The key measurement, e.g. "Battery voltage 13.1 V (limit 13.5 V)". */
  reading?: string;
  urgencyLabel: string;
  urgency: string;
  /** At most three short steps for the given context. */
  actions: string[];
  /** Short caveat shown for AI findings. */
  note?: string;
  evidence: Array<FaultEvidence & { label: string }>;
  sourceLabel: string;
  isMachineLearned: boolean;
}

interface FaultGuide {
  title: string;
  what: string;
  /** Steps for the pilot while flying. */
  now: string[];
  /** Checks to make before the next flight. */
  fix: string[];
}

const AI_CHECK = 'Compare with the graphs and other findings at this time';

const GUIDES: Record<string, FaultGuide> = {
  BATTERY_VOLTAGE_LOW: { title: 'Battery low', what: 'Battery voltage is below the safe level.',
    now: ['Head back and land soon', 'Avoid fast climbs and hard manoeuvres'], fix: ['Fully charge the battery before the next flight', 'Check battery health if this happened early in the flight'] },
  BATTERY_VOLTAGE_CRITICAL: { title: 'Battery critically low', what: 'The battery may cut out soon and the aircraft could fall.',
    now: ['Land immediately at the nearest safe spot'], fix: ['Do not reuse this battery until it is checked', 'Review the low-battery failsafe settings'] },
  BATTERY_VOLTAGE_RAPID_DROP: { title: 'Battery draining fast', what: 'Voltage is falling quickly: a weak cell, loose connector or very high load.',
    now: ['Reduce throttle and land soon'], fix: ['Check battery cells and connectors', 'Check for a motor or propeller drawing too much power'] },
  GPS_FIX_INVALID: { title: 'GPS position lost', what: 'The aircraft does not know where it is, so position hold and return-home will not work.',
    now: ['Switch to a non-GPS mode if the aircraft drifts', 'Fly back by sight and land'], fix: ['Check the GPS antenna and cable', 'Fly with a clear view of the sky'] },
  GPS_SATELLITES_LOW: { title: 'Few GPS satellites', what: 'Too few satellites for a reliable position, so the aircraft may drift.',
    now: ['Avoid auto missions and return-home', 'Keep extra distance from obstacles'], fix: ['Wait for a strong GPS lock before take-off', 'Keep the GPS away from other electronics'] },
  GPS_ACCURACY_POOR: { title: 'GPS accuracy poor', what: 'The reported position is uncertain, so the aircraft may drift.',
    now: ['Keep extra distance from obstacles', 'Avoid GPS-dependent modes until it improves'], fix: ['Check for radio interference near the GPS', 'Fly with a clear view of the sky'] },
  EKF_VARIANCE_HIGH: { title: 'Navigation unreliable', what: 'Position and heading estimates disagree, often from GPS, compass or vibration trouble.',
    now: ['Switch to a non-GPS mode if the aircraft drifts', 'Land soon'], fix: ['Calibrate the compass', 'Check GPS quality and vibration levels'] },
  EKF_HEALTH_CRITICAL: { title: 'Navigation failing', what: 'The flight controller can no longer trust its position, so control may be lost.',
    now: ['Switch to a manual mode and land now'], fix: ['Do not fly until GPS, compass and IMU are checked', 'Recalibrate the sensors'] },
  VIBRATION_EXCESSIVE: { title: 'High vibration', what: 'Strong vibration can confuse the sensors and cause drift.',
    now: ['Fly gently and land soon'], fix: ['Check propellers for damage and balance', 'Tighten motors and frame; check the flight controller mounting'] },
  VIBRATION_CRITICAL: { title: 'Severe vibration', what: 'Vibration is high enough to cause loss of control.',
    now: ['Land now'], fix: ['Replace damaged propellers', 'Inspect motors, bearings and frame for loose parts'] },
  IMU_CLIPPING: { title: 'Motion sensor overloaded', what: 'Vibration exceeds the accelerometer range, so readings are being lost.',
    now: ['Fly gently and land soon'], fix: ['Improve vibration damping under the flight controller', 'Balance or replace the propellers'] },
  MOTOR_ESC_IMBALANCE: { title: 'Motors unbalanced', what: 'One motor is working much harder than the others: possible damaged propeller, motor or ESC.',
    now: ['Land soon and avoid hard manoeuvres'], fix: ['Check propellers for damage', 'Check every motor spins freely; check ESC wiring'] },
  MOTOR_IMBALANCE_CRITICAL: { title: 'Motor failure risk', what: 'One motor is far out of balance and may fail.',
    now: ['Land now'], fix: ['Inspect motors, propellers and ESCs before flying again'] },
  ATTITUDE_TRACKING_ERROR: { title: 'Not following controls', what: 'The aircraft is not tilting as commanded: possible tuning, motor or load problem.',
    now: ['Fly gently and land soon'], fix: ['Check motors, propellers and payload balance', 'Review the PID tuning'] },
  ATTITUDE_TRACKING_CRITICAL: { title: 'Losing control', what: 'The aircraft is badly failing to hold its commanded angle.',
    now: ['Reduce stick inputs and land now'], fix: ['Do not fly until the cause is found', 'Check motors, propellers and tuning'] },
  ALTITUDE_LOSS_HIGH_THROTTLE: { title: 'Sinking at high throttle', what: 'Height is dropping despite high throttle: low power, heavy load or a motor problem.',
    now: ['Stop forward flight and land soon'], fix: ['Check weight against motor and propeller capacity', 'Check the battery and motors'] },
  ALTITUDE_LOSS_CRITICAL: { title: 'Falling despite high throttle', what: 'Rapid height loss at high throttle; the aircraft may not stay airborne.',
    now: ['Level out and land now'], fix: ['Check motors, propellers and battery before flying again', 'Reduce payload weight'] },
  ATTITUDE_SENSOR_MISSING: { title: 'Attitude data lost', what: 'Orientation updates have stopped; the flight controller or link may have failed.',
    now: ['Switch to a safe mode and land now'], fix: ['Check flight controller power and wiring'] },
  ATTITUDE_SENSOR_FROZEN: { title: 'Attitude data frozen', what: 'Orientation values are not changing, so a sensor may be stuck.',
    now: ['Fly gently and land soon'], fix: ['Check the IMU and recalibrate it'] },
  TELEMETRY_TIMEOUT: { title: 'Telemetry lost', what: 'No data is arriving from the aircraft.',
    now: ['Check the radio or cable connection', 'Expect the link-loss failsafe to trigger'], fix: ['Check antennas, range and radio settings'] },
  HEARTBEAT_TIMEOUT: { title: 'Aircraft not responding', what: 'The aircraft heartbeat has stopped arriving.',
    now: ['Check the connection and the aircraft status'], fix: ['Check the telemetry radio and cables'] },
  BATTERY_TEMPERATURE_HIGH: { title: 'Battery hot', what: 'A hot battery loses power and can be damaged.',
    now: ['Reduce load and land soon'], fix: ['Let it cool; do not charge it while hot', 'Check the battery for swelling'] },
  BATTERY_TEMPERATURE_CRITICAL: { title: 'Battery overheating', what: 'The battery is dangerously hot and could fail or catch fire.',
    now: ['Land now and keep clear of the battery'], fix: ['Do not reuse the battery if it is swollen or damaged'] },
  ESC_TEMPERATURE_HIGH: { title: 'ESC hot', what: 'Motor controllers are hot and may reduce power or shut down.',
    now: ['Reduce load and land soon'], fix: ['Improve cooling around the ESCs', 'Check for a stiff or overloaded motor'] },
  ESC_TEMPERATURE_CRITICAL: { title: 'ESC overheating', what: 'Motor controllers are close to shutting down.',
    now: ['Land now'], fix: ['Improve ESC cooling and check motors before flying again'] },
  IMU_TEMPERATURE_HIGH: { title: 'Flight controller hot', what: 'Sensor readings can drift when the flight controller overheats.',
    now: ['Land soon'], fix: ['Improve airflow around the flight controller'] },
  IMU_TEMPERATURE_CRITICAL: { title: 'Flight controller overheating', what: 'Sensor readings may become unreliable.',
    now: ['Land now'], fix: ['Improve flight controller cooling before flying again'] },
  VEHICLE_EMERGENCY_STATE: { title: 'Aircraft in emergency', what: 'The flight controller reports an emergency or flight termination.',
    now: ['Follow your emergency procedure and land now'], fix: ['Check the aircraft messages in the log for the cause'] },
  VEHICLE_CRITICAL_STATE: { title: 'Aircraft in failsafe', what: 'The flight controller reports a critical state, usually a failsafe.',
    now: ['Let the failsafe act, or land manually as soon as safe'], fix: ['Check the log messages to see which failsafe triggered'] },
  IMPORTANT_STATUS_TEXT: { title: 'Message from aircraft', what: '',
    now: ['Read the message and act on it'], fix: ['Look up this message in your autopilot documentation'] },
  ML_FLIGHT_ANOMALY: { title: 'Unusual flight behaviour', what: 'The AI noticed flight data unlike normal flight.',
    now: ['Watch the aircraft closely', 'Land if other warnings appear'], fix: [AI_CHECK] },
  ML_GPS_SENSOR_PATTERN: { title: 'Possible GPS fault', what: 'The AI sees a pattern similar to a GPS fault.',
    now: ['Check GPS fix and satellite count', 'Avoid GPS modes if they look wrong'], fix: [AI_CHECK, 'Check the GPS antenna and cable'] },
  ML_ACCELEROMETER_PATTERN: { title: 'Possible accelerometer fault', what: 'The AI sees a pattern similar to an accelerometer fault.',
    now: ['Fly gently and watch for drift', 'Land if control feels wrong'], fix: [AI_CHECK, 'Check vibration and recalibrate the accelerometer'] },
  ML_GYROSCOPE_PATTERN: { title: 'Possible gyroscope fault', what: 'The AI sees a pattern similar to a gyroscope fault.',
    now: ['Fly gently', 'Land if the aircraft wobbles or spins'], fix: [AI_CHECK, 'Check the IMU and its mounting'] },
  ML_COMPASS_PATTERN: { title: 'Possible compass fault', what: 'The AI sees a pattern similar to a compass fault.',
    now: ['Watch for heading drift or circling', 'Switch to a non-GPS mode if it happens'], fix: [AI_CHECK, 'Recalibrate the compass away from metal'] },
  ML_BAROMETER_PATTERN: { title: 'Possible barometer fault', what: 'The AI sees a pattern similar to a barometer fault.',
    now: ['Watch altitude closely', 'Use manual throttle if height holds poorly'], fix: [AI_CHECK, 'Shield the barometer from wind and light'] },
};

const SIGNALS: Record<string, string> = {
  'gps.fix_type': 'GPS fix type', 'gps.satellites': 'Satellites', 'gps.hdop': 'GPS HDOP',
  'battery.voltage_v': 'Battery voltage', 'battery.drop_rate_vps': 'Voltage drop rate', 'battery.voltage_drop_v_per_s': 'Voltage drop rate',
  'battery.temperature_c': 'Battery temperature', 'vibration.peak_mps2': 'Peak vibration', 'imu.clipping_total': 'Clipping events',
  'ekf.maximum_variance': 'EKF variance', 'ekf.error_flags': 'EKF error flags', 'velocity.descent_mps': 'Descent rate', 'throttle.pct': 'Throttle',
  'motor.maximum_rpm_deviation_ratio': 'Motor speed difference', 'motor.mean_rpm': 'Average motor speed',
  'attitude.roll_error_rad': 'Roll error', 'attitude.pitch_error_rad': 'Pitch error',
  'sensor.attitude_age_ms': 'Time without attitude data', 'sensor.attitude_unchanged_ms': 'Time unchanged',
  'communication.telemetry_age_ms': 'Time without data', 'communication.heartbeat_age_ms': 'Time without heartbeat',
  'flight.system_status': 'System status', 'status.severity': 'Message severity',
  'ml.anomaly_probability': 'AI anomaly score', 'ml.simulated_pattern_probability': 'AI pattern match',
};

const URGENCY: Record<FaultContext, Record<FaultSeverity, string>> = {
  'in-flight': {
    info: 'No action needed; keep an eye on it.', caution: 'Keep flying carefully and be ready to land.',
    warning: 'Land as soon as it is safe.', critical: 'Land now. This is an emergency.',
  },
  'post-flight': {
    info: 'No action needed.', caution: 'Check this before the next flight.',
    warning: 'Fix this before the next flight.', critical: 'Do not fly again until this is fixed.',
  },
};

export function presentFaultNotification(
  fault: Pick<FaultRecord, 'faultType' | 'message' | 'severity' | 'suggestedAction' | 'evidence' | 'detectorId'>,
  context: FaultContext = 'in-flight',
): PresentedFault {
  const isMachineLearned = fault.detectorId.includes('ml') || fault.detectorId.includes('anomaly') || fault.faultType.startsWith('ML_');
  const guide = GUIDES[fault.faultType];
  const evidence = fault.evidence.map(item => ({ ...item, label: SIGNALS[item.signal] ?? humanize(item.signal) }));
  const summary = fault.faultType === 'IMPORTANT_STATUS_TEXT' ? `The aircraft reported: “${fault.message}”` : guide?.what || fault.message;
  const actions = guide ? (context === 'in-flight' ? guide.now : guide.fix) : splitActions(fault.suggestedAction);
  return {
    title: guide?.title ?? humanize(fault.faultType), summary, reading: formatReading(evidence[0]),
    urgencyLabel: context === 'in-flight' ? 'Do now' : 'Next step', urgency: URGENCY[context][fault.severity],
    actions: [...new Set(actions)].slice(0, 3),
    note: isMachineLearned ? 'AI estimate, not a confirmed fault. Confirm with the data before acting.' : undefined,
    evidence, sourceLabel: isMachineLearned ? 'AI advisory' : 'Safety rule', isMachineLearned,
  };
}

function formatReading(item: (FaultEvidence & { label: string }) | undefined): string | undefined {
  if (!item || item.unit === 'bitmask' || item.signal === 'status.severity' || item.signal === 'flight.system_status') return undefined;
  const value = formatValue(item.value, item.unit);
  return item.threshold === undefined ? `${item.label} ${value}` : `${item.label} ${value} (limit ${formatValue(item.threshold, item.unit)})`;
}

function formatValue(value: number, unit?: string): string {
  if (unit === 'probability' || unit === 'ratio') return `${Math.round(value * 100)}%`;
  if (unit === 'rad') return `${round(value * 180 / Math.PI)}°`;
  if (unit === 'ms') return `${round(value / 1000)} s`;
  if (!unit || unit === 'enum' || unit === 'count' || unit === 'variance') return `${round(value)}`;
  return unit === '%' || unit === '°C' ? `${round(value)}${unit}` : `${round(value)} ${unit}`;
}

function round(value: number): string {
  return String(Number(value.toFixed(Math.abs(value) < 100 ? 2 : 1)));
}

function splitActions(value: string): string[] {
  return value.split(/;|\.(?:\s+|$)/).map(item => item.trim()).filter(Boolean).map(item => `${item[0].toUpperCase()}${item.slice(1)}`);
}

function humanize(value: string): string {
  const text = value.replace(/^ML_/, '').replace(/[._-]+/g, ' ').replace(/\b(?:mps2|radps|pct|vps)\b/gi, '').replace(/\s+/g, ' ').trim().toLowerCase();
  return text ? `${text[0].toUpperCase()}${text.slice(1)}` : 'Safety warning';
}
