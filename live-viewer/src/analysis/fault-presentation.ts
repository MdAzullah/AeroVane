import type { FaultEvidence, FaultRecord, FaultSeverity } from './types';

export interface PresentedFault {
  title: string;
  summary: string;
  urgency: string;
  actions: string[];
  evidence: Array<FaultEvidence & { label: string }>;
  sourceLabel: string;
  isMachineLearned: boolean;
}

const TITLES: Record<string, string> = {
  BATTERY_VOLTAGE_LOW: 'Battery voltage is low', BATTERY_VOLTAGE_CRITICAL: 'Battery voltage is critically low',
  BATTERY_VOLTAGE_RAPID_DROP: 'Battery voltage is dropping rapidly', GPS_FIX_INVALID: 'GPS position lock lost',
  GPS_SATELLITES_LOW: 'Too few GPS satellites', GPS_ACCURACY_POOR: 'GPS accuracy is poor',
  EKF_VARIANCE_HIGH: 'Navigation estimate is unreliable', EKF_HEALTH_CRITICAL: 'Navigation estimate is critically unreliable',
  VIBRATION_EXCESSIVE: 'Excessive aircraft vibration', VIBRATION_CRITICAL: 'Critical aircraft vibration',
  IMU_CLIPPING: 'IMU measurements are being clipped', MOTOR_ESC_IMBALANCE: 'Motor or ESC speeds are unbalanced',
  MOTOR_IMBALANCE_CRITICAL: 'Critical motor or ESC imbalance', ATTITUDE_TRACKING_ERROR: 'Aircraft is not following attitude commands',
  ATTITUDE_TRACKING_CRITICAL: 'Critical attitude-control error', ALTITUDE_LOSS_HIGH_THROTTLE: 'Aircraft is losing altitude under high throttle',
  ALTITUDE_LOSS_CRITICAL: 'Critical altitude loss under high throttle', ATTITUDE_SENSOR_MISSING: 'Attitude sensor updates are missing',
  ATTITUDE_SENSOR_FROZEN: 'Attitude sensor appears frozen', ML_FLIGHT_ANOMALY: 'Unusual flight behaviour detected',
  ML_GPS_SENSOR_PATTERN: 'Possible GPS sensor problem', ML_ACCELEROMETER_PATTERN: 'Possible accelerometer problem',
  ML_GYROSCOPE_PATTERN: 'Possible gyroscope problem', ML_COMPASS_PATTERN: 'Possible compass problem',
  ML_BAROMETER_PATTERN: 'Possible barometer problem',
};

const SIGNALS: Record<string, string> = {
  'gps.fix_type': 'GPS fix quality', 'gps.satellites': 'Satellites tracked', 'gps.hdop': 'GPS position uncertainty',
  'battery.voltage_v': 'Battery voltage', 'battery.drop_rate_vps': 'Battery voltage drop rate',
  'vibration.peak_mps2': 'Peak vibration', 'imu.clipping_total': 'IMU clipping count',
  'ml.anomaly_probability': 'AI anomaly score', 'ml.simulated_pattern_probability': 'AI pattern score',
};

const URGENCY: Record<FaultSeverity, string> = {
  info: 'Monitor this condition. No immediate action is normally required.',
  caution: 'Check the supporting data and prepare to end the flight if the condition continues.',
  warning: 'Reduce flight demand and land as soon as it is safe to do so.',
  critical: 'Act immediately: stabilize the aircraft and follow the emergency landing procedure.',
};

export function presentFaultNotification(fault: Pick<FaultRecord, 'faultType' | 'message' | 'severity' | 'suggestedAction' | 'evidence' | 'detectorId'>): PresentedFault {
  const isMachineLearned = fault.detectorId.includes('ml') || fault.detectorId.includes('anomaly') || fault.faultType.startsWith('ML_');
  const actions = splitActions(fault.suggestedAction);
  if (isMachineLearned) actions.push('Confirm the warning using the listed telemetry and rule-based findings; AI output is advisory, not a confirmed diagnosis.');
  return { title: TITLES[fault.faultType] ?? humanize(fault.faultType), summary: fault.message, urgency: URGENCY[fault.severity],
    actions: [...new Set(actions)], evidence: fault.evidence.map(item => ({ ...item, label: SIGNALS[item.signal] ?? humanize(item.signal) })),
    sourceLabel: isMachineLearned ? 'AI-assisted advisory' : 'Telemetry safety rule', isMachineLearned };
}

function splitActions(value: string): string[] {
  return value.split(/;|\.(?:\s+|$)/).map(item => item.trim()).filter(Boolean).map(item => `${item[0].toUpperCase()}${item.slice(1)}`);
}

function humanize(value: string): string {
  const text = value.replace(/^ML_/, '').replace(/[._-]+/g, ' ').replace(/\b(?:mps2|radps|pct|vps)\b/gi, '').replace(/\s+/g, ' ').trim().toLowerCase();
  return text ? `${text[0].toUpperCase()}${text.slice(1)}` : 'Safety warning';
}
