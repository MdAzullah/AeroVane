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
  { id: 'radio', label: 'Weak / noisy radio link', expectedFaultType: null, activationMs: 5_000 },
  { id: 'compass', label: 'Compass interference', expectedFaultType: null, activationMs: 5_000 },
  { id: 'barometer', label: 'Barometer drift', expectedFaultType: null, activationMs: 5_000 },
] as const;

export type SpoofScenarioId = typeof SPOOF_SCENARIOS[number]['id'];

export const SIMULATION_ENVIRONMENTS = [
  { id: 'calm', label: 'Calm day', description: 'Light wind and clean sensor data' },
  { id: 'coastal', label: 'Coastal breeze', description: 'Steady crosswind with mild gusts' },
  { id: 'mountain', label: 'Mountain terrain', description: 'Thin air, cooler temperature and turbulent wind' },
  { id: 'urban', label: 'Urban canyon', description: 'GPS multipath and elevated radio noise' },
  { id: 'storm', label: 'Storm front', description: 'Strong gusts, pressure changes and heavy vibration' },
] as const;

export const SIMULATION_FLIGHT_PROFILES = [
  { id: 'hover', label: 'Stable hover', description: 'Low speed with gentle attitude corrections' },
  { id: 'cruise', label: 'Survey cruise', description: 'Smooth figure-eight mission flight' },
  { id: 'aggressive', label: 'Aggressive manoeuvres', description: 'Fast turns, higher throttle and larger attitude changes' },
] as const;

export type SimulationEnvironmentId = typeof SIMULATION_ENVIRONMENTS[number]['id'];
export type SimulationFlightProfileId = typeof SIMULATION_FLIGHT_PROFILES[number]['id'];

export function isSpoofScenarioId(value: unknown): value is SpoofScenarioId {
  return SPOOF_SCENARIOS.some(scenario => scenario.id === value);
}
