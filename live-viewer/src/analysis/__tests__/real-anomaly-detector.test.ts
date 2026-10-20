import { describe, expect, it } from 'vitest';
import realModel from '../models/real-anomaly-model.json';
import { aggregate, observe, RealAnomalyDetector } from '../detectors/real-anomaly-detector';
import { validatePortableTreeModel } from '../portable-tree-model';
import { createDefaultFaultDetectors } from '../default-detectors';
import type { TelemetrySample } from '../types';

const alwaysAnomalous = {
  schema_version: '1.0.0', model_kind: 'binary-decision-tree', version: 'test-real', advisory_only: true,
  features: ['battery_voltage_v_mean'], imputation_medians: [12], persistence_windows: 2, decision_threshold: 0.5, lineage: {},
  tree: { feature_index: [-1], threshold: [-2], left: [-1], right: [-1], anomaly_probability: [0.9] },
};

function sample(timestampMs: number, family: 'multicopter' | 'fixed_wing' = 'multicopter'): TelemetrySample {
  return {
    timestampMs, source: 'live', flightPhase: 'flying', values: { 'battery.voltage_v': 12 },
    vehicle: { systemId: 1, componentId: 1, mavType: 2, autopilot: 12, family },
  };
}

describe('RealAnomalyDetector', () => {
  it('loads the promoted model contract', () => {
    expect(validatePortableTreeModel(realModel)?.version).toBe('skyforge-real-anomaly-2.0.0');
    const ids = createDefaultFaultDetectors().map(detector => detector.id);
    expect(ids).toContain('real-ml-anomaly');
    expect(ids).not.toContain('ml-anomaly');
  });

  it('matches training observation and aggregation semantics', () => {
    const values = observe({
      'battery.voltage_v': 10, 'battery.current_a': 4,
      'imu.xacc_mps2': 3, 'imu.yacc_mps2': 4, 'imu.zacc_mps2': 0,
      'imu.xgyro_radps': 0, 'imu.ygyro_radps': 0, 'imu.zgyro_radps': 2,
      'velocity.north_mps': 3, 'velocity.east_mps': 4, 'velocity.down_mps': 0,
      'attitude.roll_rad': -1, 'attitude.pitch_rad': 0.5, 'attitude.yaw_rad': 0.2,
    });
    expect(values).toMatchObject({ accel_magnitude_mps2: 5, gyro_magnitude_radps: 2, velocity_magnitude_mps: 5, attitude_abs_rad: 1 });
    expect(aggregate([{ timestampMs: 0, values }, { timestampMs: 1, values: { ...values, battery_voltage_v: 14 } }], ['battery_voltage_v_mean', 'battery_voltage_v_min'])).toEqual([12, 10]);
  });

  it('requires two complete anomalous windows and emits an advisory finding', () => {
    const detector = new RealAnomalyDetector(alwaysAnomalous);
    expect(detector.evaluate(sample(0))).toEqual([]);
    expect(detector.evaluate(sample(5_000))).toEqual([]);
    const findings = detector.evaluate(sample(7_500));
    expect(findings[0]).toMatchObject({ status: 'active', faultType: 'ML_FLIGHT_ANOMALY', severity: 'warning' });
    expect(findings[0].status === 'active' && findings[0].message).toContain('Advisory');
  });

  it('fails closed outside the validated multicopter route', () => {
    const detector = new RealAnomalyDetector(alwaysAnomalous);
    expect([0, 5_000, 7_500].flatMap(time => detector.evaluate(sample(time, 'fixed_wing')))).toEqual([]);
  });
});
