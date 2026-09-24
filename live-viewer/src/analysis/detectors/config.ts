export interface DetectorTimingConfig {
  activationDelayMs: number;
  recoveryDelayMs: number;
}

export interface BatteryDetectorConfig extends DetectorTimingConfig {
  warningVoltageV: number;
  criticalVoltageV: number;
  rapidDropVPerSecond: number;
  rapidDropWindowMs: number;
}

export interface GpsDetectorConfig extends DetectorTimingConfig {
  minimumFixType: number;
  minimumSatellites: number;
  maximumHdop: number;
}

export interface CommunicationDetectorConfig extends DetectorTimingConfig {
  heartbeatTimeoutMs: number;
  telemetryTimeoutMs: number;
}

export interface VibrationDetectorConfig extends DetectorTimingConfig {
  warningMps2: number;
  criticalMps2: number;
}

export interface AttitudeDetectorConfig extends DetectorTimingConfig {
  warningErrorRad: number;
  criticalErrorRad: number;
}

export interface AltitudeLossDetectorConfig extends DetectorTimingConfig {
  minimumThrottlePct: number;
  warningDescentMps: number;
  criticalDescentMps: number;
}

export interface EkfDetectorConfig extends DetectorTimingConfig {
  warningVariance: number;
  criticalVariance: number;
}

export interface SensorStalenessDetectorConfig extends DetectorTimingConfig {
  missingTimeoutMs: number;
  frozenTimeoutMs: number;
  changeEpsilonRad: number;
}

export interface MotorImbalanceDetectorConfig extends DetectorTimingConfig {
  warningDeviationRatio: number;
  criticalDeviationRatio: number;
  minimumMeanRpm: number;
}

export interface TemperatureDetectorConfig extends DetectorTimingConfig {
  imuWarningC: number;
  imuCriticalC: number;
  batteryWarningC: number;
  batteryCriticalC: number;
  escWarningC: number;
  escCriticalC: number;
}

export interface StatusTextDetectorConfig {
  activeDurationMs: number;
}

export const DEFAULT_BATTERY_DETECTOR_CONFIG: Readonly<BatteryDetectorConfig> = {
  activationDelayMs: 3_000,
  recoveryDelayMs: 5_000,
  warningVoltageV: 10.5,
  criticalVoltageV: 9.9,
  rapidDropVPerSecond: 0.15,
  rapidDropWindowMs: 10_000,
};

export const DEFAULT_GPS_DETECTOR_CONFIG: Readonly<GpsDetectorConfig> = {
  activationDelayMs: 3_000,
  recoveryDelayMs: 5_000,
  minimumFixType: 3,
  minimumSatellites: 6,
  maximumHdop: 2.5,
};

export const DEFAULT_COMMUNICATION_DETECTOR_CONFIG: Readonly<CommunicationDetectorConfig> = {
  activationDelayMs: 0,
  recoveryDelayMs: 2_000,
  heartbeatTimeoutMs: 5_000,
  telemetryTimeoutMs: 3_000,
};

export const DEFAULT_VIBRATION_DETECTOR_CONFIG: Readonly<VibrationDetectorConfig> = {
  activationDelayMs: 2_000, recoveryDelayMs: 4_000, warningMps2: 30, criticalMps2: 60,
};

export const DEFAULT_ATTITUDE_DETECTOR_CONFIG: Readonly<AttitudeDetectorConfig> = {
  activationDelayMs: 2_000, recoveryDelayMs: 3_000,
  warningErrorRad: 20 * Math.PI / 180, criticalErrorRad: 35 * Math.PI / 180,
};

export const DEFAULT_ALTITUDE_LOSS_DETECTOR_CONFIG: Readonly<AltitudeLossDetectorConfig> = {
  activationDelayMs: 2_000, recoveryDelayMs: 3_000,
  minimumThrottlePct: 70, warningDescentMps: 1.5, criticalDescentMps: 3,
};

export const DEFAULT_EKF_DETECTOR_CONFIG: Readonly<EkfDetectorConfig> = {
  activationDelayMs: 2_000, recoveryDelayMs: 4_000, warningVariance: 1, criticalVariance: 2,
};

export const DEFAULT_SENSOR_STALENESS_DETECTOR_CONFIG: Readonly<SensorStalenessDetectorConfig> = {
  activationDelayMs: 0, recoveryDelayMs: 2_000, missingTimeoutMs: 2_000,
  frozenTimeoutMs: 5_000, changeEpsilonRad: 1e-5,
};

export const DEFAULT_MOTOR_IMBALANCE_DETECTOR_CONFIG: Readonly<MotorImbalanceDetectorConfig> = {
  activationDelayMs: 2_000, recoveryDelayMs: 4_000,
  warningDeviationRatio: 0.25, criticalDeviationRatio: 0.4, minimumMeanRpm: 500,
};

export const DEFAULT_TEMPERATURE_DETECTOR_CONFIG: Readonly<TemperatureDetectorConfig> = {
  activationDelayMs: 3_000, recoveryDelayMs: 5_000,
  imuWarningC: 80, imuCriticalC: 90,
  batteryWarningC: 55, batteryCriticalC: 65,
  escWarningC: 90, escCriticalC: 110,
};

export const DEFAULT_STATUS_TEXT_DETECTOR_CONFIG: Readonly<StatusTextDetectorConfig> = {
  activeDurationMs: 15_000,
};
