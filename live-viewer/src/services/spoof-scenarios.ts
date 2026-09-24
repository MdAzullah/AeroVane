export const SPOOF_SCENARIOS = [
  { id: 'normal', label: 'Normal flight', expectedFaultType: null, activationMs: null },
  { id: 'battery', label: 'Critical battery', expectedFaultType: 'BATTERY_VOLTAGE_CRITICAL', activationMs: 5_000 },
  { id: 'gps', label: 'GPS loss', expectedFaultType: 'GPS_FIX_INVALID', activationMs: 5_000 },
  { id: 'link', label: 'Telemetry link loss', expectedFaultType: 'TELEMETRY_TIMEOUT', activationMs: 5_000 },
  { id: 'vibration', label: 'Critical vibration', expectedFaultType: 'VIBRATION_CRITICAL', activationMs: 5_000 },
  { id: 'attitude', label: 'Attitude tracking error', expectedFaultType: 'ATTITUDE_TRACKING_CRITICAL', activationMs: 5_000 },
  { id: 'altitude', label: 'Altitude loss at high throttle', expectedFaultType: 'ALTITUDE_LOSS_CRITICAL', activationMs: 5_000 },
  { id: 'ekf', label: 'EKF navigation failure', expectedFaultType: 'EKF_HEALTH_CRITICAL', activationMs: 5_000 },
  { id: 'motor', label: 'Motor / ESC imbalance', expectedFaultType: 'MOTOR_IMBALANCE_CRITICAL', activationMs: 5_000 },
  { id: 'frozen', label: 'Frozen attitude sensor', expectedFaultType: 'ATTITUDE_SENSOR_MISSING', activationMs: 5_000 },
] as const;

export type SpoofScenarioId = typeof SPOOF_SCENARIOS[number]['id'];

export function isSpoofScenarioId(value: unknown): value is SpoofScenarioId {
  return SPOOF_SCENARIOS.some(scenario => scenario.id === value);
}
