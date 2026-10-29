export { FaultDetectionEngine } from './fault-engine';
export { MavlinkTelemetryNormalizer } from './telemetry-normalizer';
export { routeMavTypeToVehicleFamily } from './vehicle-family';
export { createCommunicationWatchdogSample } from './watchdog-sample';
export { createDefaultFaultDetectors } from './default-detectors';
export { createSpoofScenarioReplay } from './spoof-scenario-fixtures';
export { presentFaultNotification, type PresentedFault, type FaultContext } from './fault-presentation';
export {
  BatteryFaultDetector,
  BasicSensorFaultDetector,
  CommunicationFaultDetector,
  GpsFaultDetector,
  COMMUNICATION_WATCHDOG_SIGNAL,
  DEFAULT_BATTERY_DETECTOR_CONFIG,
  DEFAULT_COMMUNICATION_DETECTOR_CONFIG,
  DEFAULT_GPS_DETECTOR_CONFIG,
  VibrationFaultDetector,
  AttitudeFaultDetector,
  AltitudeLossFaultDetector,
  EkfFaultDetector,
  SensorStalenessFaultDetector,
  MotorImbalanceFaultDetector,
  TemperatureFaultDetector,
  StatusTextFaultDetector,
  DEFAULT_VIBRATION_DETECTOR_CONFIG,
  DEFAULT_ATTITUDE_DETECTOR_CONFIG,
  DEFAULT_ALTITUDE_LOSS_DETECTOR_CONFIG,
  DEFAULT_EKF_DETECTOR_CONFIG,
  DEFAULT_SENSOR_STALENESS_DETECTOR_CONFIG,
  DEFAULT_MOTOR_IMBALANCE_DETECTOR_CONFIG,
  DEFAULT_TEMPERATURE_DETECTOR_CONFIG,
  DEFAULT_STATUS_TEXT_DETECTOR_CONFIG,
} from './detectors';
export type {
  BatteryDetectorConfig,
  CommunicationDetectorConfig,
  DetectorTimingConfig,
  GpsDetectorConfig,
  VibrationDetectorConfig,
  AttitudeDetectorConfig,
  AltitudeLossDetectorConfig,
  EkfDetectorConfig,
  SensorStalenessDetectorConfig,
  MotorImbalanceDetectorConfig,
  TemperatureDetectorConfig,
  StatusTextDetectorConfig,
} from './detectors';
export type {
  ActiveFaultFinding,
  ClearedFaultFinding,
  DetectorFinding,
  FaultDetector,
} from './detector';
export type {
  DetectorError,
  FaultEvent,
  FaultEventType,
  FaultEvidence,
  FaultRecord,
  FaultSeverity,
  FaultState,
  FrameMetadata,
  FlightPhase,
  SignalQualityFlag,
  TelemetrySample,
  TelemetrySource,
  VehicleFamily,
  VehicleIdentity,
} from './types';
