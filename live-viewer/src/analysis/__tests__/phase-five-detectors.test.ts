import { describe, expect, it } from 'vitest';
import {
  AltitudeLossFaultDetector,
  AttitudeFaultDetector,
  EkfFaultDetector,
  FaultDetectionEngine,
  MotorImbalanceFaultDetector,
  SensorStalenessFaultDetector,
  StatusTextFaultDetector,
  TemperatureFaultDetector,
  VibrationFaultDetector,
  type FaultEvent,
  type FlightPhase,
  type TelemetrySample,
} from '..';

function sample(timestampMs: number, values: Record<string, number>, flightPhase: FlightPhase = 'flying', textValues?: Record<string, string>): TelemetrySample {
  return { timestampMs, source: 'simulation', values, flightPhase, textValues };
}

function find(events: FaultEvent[], key: string): FaultEvent | undefined {
  return events.find(event => event.fault.key === key);
}

describe('VibrationFaultDetector', () => {
  it('handles normal, excessive, critical, and recovered vibration', () => {
    const engine = new FaultDetectionEngine([new VibrationFaultDetector({ activationDelayMs: 1_000, recoveryDelayMs: 1_000 })]);
    expect(engine.processSample(sample(0, { 'vibration.x_mps2': 10 }))).toEqual([]);
    engine.processSample(sample(1_000, { 'vibration.x_mps2': 35 }));
    expect(find(engine.processSample(sample(2_000, { 'vibration.x_mps2': 40 })), 'excessive')).toMatchObject({ fault: { faultType: 'VIBRATION_EXCESSIVE' } });
    expect(find(engine.processSample(sample(3_000, { 'vibration.x_mps2': 65 })), 'excessive')).toMatchObject({ type: 'updated', fault: { severity: 'critical' } });
    engine.processSample(sample(4_000, { 'vibration.x_mps2': 5 }));
    expect(find(engine.processSample(sample(5_000, { 'vibration.x_mps2': 5 })), 'excessive')?.type).toBe('cleared');
  });

  it('detects increasing IMU clipping and clears when clipping stops', () => {
    const engine = new FaultDetectionEngine([new VibrationFaultDetector({ activationDelayMs: 0, recoveryDelayMs: 1_000 })]);
    engine.processSample(sample(0, { 'imu.clipping_0': 0, 'imu.clipping_1': 0, 'imu.clipping_2': 0 }));
    expect(find(engine.processSample(sample(1_000, { 'imu.clipping_0': 2, 'imu.clipping_1': 0, 'imu.clipping_2': 0 })), 'clipping')).toMatchObject({ fault: { faultType: 'IMU_CLIPPING' } });
    engine.processSample(sample(2_000, { 'imu.clipping_0': 2, 'imu.clipping_1': 0, 'imu.clipping_2': 0 }));
    expect(find(engine.processSample(sample(3_000, { 'imu.clipping_0': 2, 'imu.clipping_1': 0, 'imu.clipping_2': 0 })), 'clipping')?.type).toBe('cleared');
  });
});

describe('AttitudeFaultDetector', () => {
  it('ignores unavailable data and detects sustained target tracking error with recovery', () => {
    const engine = new FaultDetectionEngine([new AttitudeFaultDetector({ activationDelayMs: 1_000, recoveryDelayMs: 1_000 })]);
    expect(engine.processSample(sample(0, {}))).toEqual([]);
    engine.processSample(sample(0, { 'attitude.target_roll_rad': 0, 'attitude.target_pitch_rad': 0 }));
    engine.processSample(sample(0, { 'attitude.roll_rad': 0.5, 'attitude.pitch_rad': 0 }));
    expect(engine.processSample(sample(1_000, { 'attitude.roll_rad': 0.5, 'attitude.pitch_rad': 0 }))[0]).toMatchObject({ fault: { faultType: 'ATTITUDE_TRACKING_ERROR' } });
    engine.processSample(sample(2_000, { 'attitude.roll_rad': 0, 'attitude.pitch_rad': 0 }));
    expect(engine.processSample(sample(3_000, { 'attitude.roll_rad': 0, 'attitude.pitch_rad': 0 }))[0]?.type).toBe('cleared');
  });
});

describe('AltitudeLossFaultDetector', () => {
  it('requires flying, high throttle, and sustained descent, then clears', () => {
    const engine = new FaultDetectionEngine([new AltitudeLossFaultDetector({ activationDelayMs: 1_000, recoveryDelayMs: 1_000 })]);
    expect(engine.processSample(sample(0, { 'throttle.pct': 80, 'velocity.climb_mps': -2 }, 'on_ground'))).toEqual([]);
    engine.processSample(sample(1_000, { 'throttle.pct': 80, 'velocity.climb_mps': -2 }));
    expect(engine.processSample(sample(2_000, { 'throttle.pct': 82, 'velocity.climb_mps': -2.2 }))[0]).toMatchObject({ fault: { faultType: 'ALTITUDE_LOSS_HIGH_THROTTLE' } });
    engine.processSample(sample(3_000, { 'throttle.pct': 50, 'velocity.climb_mps': 0 }));
    expect(engine.processSample(sample(4_000, { 'throttle.pct': 50, 'velocity.climb_mps': 0 }))[0]?.type).toBe('cleared');
  });
});

describe('EkfFaultDetector', () => {
  it('ignores missing EKF data and detects variance and error flags with recovery', () => {
    const engine = new FaultDetectionEngine([new EkfFaultDetector({ activationDelayMs: 1_000, recoveryDelayMs: 1_000 })]);
    expect(engine.processSample(sample(0, {}))).toEqual([]);
    engine.processSample(sample(0, { 'ekf.flags': 0, 'ekf.velocity_variance': 1.2 }));
    expect(engine.processSample(sample(1_000, { 'ekf.flags': 0, 'ekf.velocity_variance': 1.3 }))[0]).toMatchObject({ fault: { faultType: 'EKF_VARIANCE_HIGH' } });
    expect(engine.processSample(sample(2_000, { 'ekf.flags': 1024, 'ekf.velocity_variance': 0.2 }))[0]).toMatchObject({ fault: { severity: 'critical' } });
    engine.processSample(sample(3_000, { 'ekf.flags': 0, 'ekf.velocity_variance': 0.2 }));
    expect(engine.processSample(sample(4_000, { 'ekf.flags': 0, 'ekf.velocity_variance': 0.2 }))[0]?.type).toBe('cleared');
  });
});

describe('SensorStalenessFaultDetector', () => {
  it('does not fault before availability and detects missing attitude updates with recovery', () => {
    const engine = new FaultDetectionEngine([new SensorStalenessFaultDetector({ missingTimeoutMs: 1_000, frozenTimeoutMs: 5_000, recoveryDelayMs: 1_000 })]);
    expect(engine.processSample(sample(2_000, {}))).toEqual([]);
    engine.processSample(sample(0, { 'attitude.roll_rad': 0, 'attitude.pitch_rad': 0 }));
    expect(find(engine.processSample(sample(1_001, {})), 'attitude-missing')).toMatchObject({ fault: { faultType: 'ATTITUDE_SENSOR_MISSING' } });
    engine.processSample(sample(2_000, { 'attitude.roll_rad': 0.1, 'attitude.pitch_rad': 0 }));
    expect(find(engine.processSample(sample(3_000, { 'attitude.roll_rad': 0.2, 'attitude.pitch_rad': 0 })), 'attitude-missing')?.type).toBe('cleared');
  });

  it('detects frozen but still-arriving attitude values', () => {
    const engine = new FaultDetectionEngine([new SensorStalenessFaultDetector({ missingTimeoutMs: 2_000, frozenTimeoutMs: 1_000, recoveryDelayMs: 0 })]);
    engine.processSample(sample(0, { 'attitude.roll_rad': 0, 'attitude.pitch_rad': 0 }));
    expect(find(engine.processSample(sample(1_001, { 'attitude.roll_rad': 0, 'attitude.pitch_rad': 0 })), 'attitude-frozen')).toMatchObject({ fault: { faultType: 'ATTITUDE_SENSOR_FROZEN' } });
    expect(find(engine.processSample(sample(2_000, { 'attitude.roll_rad': 0.1, 'attitude.pitch_rad': 0 })), 'attitude-frozen')?.type).toBe('cleared');
  });
});

describe('MotorImbalanceFaultDetector', () => {
  it('ignores unavailable ESC telemetry and detects RPM imbalance with recovery', () => {
    const engine = new FaultDetectionEngine([new MotorImbalanceFaultDetector({ activationDelayMs: 1_000, recoveryDelayMs: 1_000 })]);
    expect(engine.processSample(sample(0, { 'throttle.pct': 80 }))).toEqual([]);
    const bad = { 'esc.0.rpm': 4_000, 'esc.1.rpm': 4_100, 'esc.2.rpm': 2_500, 'esc.3.rpm': 4_000 };
    engine.processSample(sample(0, bad));
    expect(engine.processSample(sample(1_000, bad))[0]).toMatchObject({ fault: { faultType: 'MOTOR_ESC_IMBALANCE' } });
    const good = { 'esc.0.rpm': 4_000, 'esc.1.rpm': 4_100, 'esc.2.rpm': 3_900, 'esc.3.rpm': 4_000 };
    engine.processSample(sample(2_000, good));
    expect(engine.processSample(sample(3_000, good))[0]?.type).toBe('cleared');
  });
});

describe('TemperatureFaultDetector', () => {
  it('handles unavailable, high, critical, and recovered temperature data', () => {
    const engine = new FaultDetectionEngine([new TemperatureFaultDetector({ activationDelayMs: 1_000, recoveryDelayMs: 1_000 })]);
    expect(engine.processSample(sample(0, {}))).toEqual([]);
    engine.processSample(sample(0, { 'imu.temperature_c': 82 }));
    expect(engine.processSample(sample(1_000, { 'imu.temperature_c': 83 }))[0]).toMatchObject({ fault: { faultType: 'IMU_TEMPERATURE_HIGH' } });
    expect(engine.processSample(sample(2_000, { 'imu.temperature_c': 92 }))[0]).toMatchObject({ fault: { severity: 'critical' } });
    engine.processSample(sample(3_000, { 'imu.temperature_c': 60 }));
    expect(engine.processSample(sample(4_000, { 'imu.temperature_c': 60 }))[0]?.type).toBe('cleared');
  });
});

describe('StatusTextFaultDetector', () => {
  it('detects vehicle failsafe state and clears on healthy heartbeats', () => {
    const engine = new FaultDetectionEngine([new StatusTextFaultDetector()]);
    expect(engine.processSample(sample(0, { 'flight.system_status': 4 }))).toEqual([]);
    expect(engine.processSample(sample(1_000, { 'flight.system_status': 6 }))[0]).toMatchObject({ fault: { faultType: 'VEHICLE_EMERGENCY_STATE' } });
    engine.processSample(sample(2_000, { 'flight.system_status': 4 }));
    expect(engine.processSample(sample(4_000, { 'flight.system_status': 4 }))[0]?.type).toBe('cleared');
  });

  it('shows important STATUSTEXT and clears it after its display duration', () => {
    const engine = new FaultDetectionEngine([new StatusTextFaultDetector({ activeDurationMs: 1_000 })]);
    expect(engine.processSample(sample(0, { 'status.severity': 6 }, 'flying', { 'status.text': 'Routine notice' }))).toEqual([]);
    const alert = engine.processSample(sample(1_000, { 'status.severity': 2 }, 'flying', { 'status.text': 'EKF failsafe' }))[0];
    expect(alert).toMatchObject({ fault: { faultType: 'IMPORTANT_STATUS_TEXT', severity: 'critical', message: 'EKF failsafe' } });
    expect(engine.processSample(sample(2_001, {}))[0]?.type).toBe('cleared');
  });
});
