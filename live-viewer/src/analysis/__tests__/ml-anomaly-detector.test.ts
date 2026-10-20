import { describe, expect, it } from 'vitest';
import { MlAnomalyDetector } from '../detectors';
import type { TelemetrySample } from '../types';

function sample(timestampMs: number, values: Record<string, number>): TelemetrySample {
  return { timestampMs, source: 'simulation', flightPhase: 'flying', values };
}

const normal = {
  'battery.voltage_v': 12.3, 'gps.satellites': 14,
  'vibration.x_mps2': 5, 'vibration.y_mps2': 4, 'vibration.z_mps2': 6,
  'attitude.roll_rad': 0.05, 'attitude.pitch_rad': 0.03,
  'attitude.target_roll_rad': 0.05, 'attitude.target_pitch_rad': 0.03,
  'throttle.pct': 50, 'velocity.down_mps': 0, 'ekf.velocity_variance': 0.2,
  'esc.0.rpm': 3000, 'esc.1.rpm': 3020, 'esc.2.rpm': 2980, 'esc.3.rpm': 3010,
};

describe('MlAnomalyDetector', () => {
  it('does not alert on a normal flight window', () => {
    const detector = new MlAnomalyDetector();
    const findings = [0, 1000, 2000, 3000, 4000].flatMap(time => detector.evaluate(sample(time, normal)));
    expect(findings).toEqual([]);
  });

  it('detects a combined anomaly below individual rule thresholds and reports model version', () => {
    const detector = new MlAnomalyDetector();
    detector.evaluate(sample(0, normal));
    detector.evaluate(sample(2000, normal));
    const unusual = { ...normal, 'battery.voltage_v': 10.8, 'gps.satellites': 7, 'vibration.x_mps2': 25, 'attitude.target_roll_rad': 0.35, 'ekf.velocity_variance': 0.8, 'esc.2.rpm': 2300 };
    detector.evaluate(sample(3000, unusual));
    const findings = detector.evaluate(sample(4500, unusual));
    expect(findings[0]).toMatchObject({ status: 'active', faultType: 'ML_FLIGHT_ANOMALY' });
    expect(findings[0].status === 'active' && findings[0].message).toContain('aerovane-anomaly-1.0.0');
  });

  it('fails safely when the model artifact is invalid', () => {
    const detector = new MlAnomalyDetector({ version: 'broken' });
    expect(detector.evaluate(sample(5000, { 'battery.voltage_v': 1 }))).toEqual([]);
  });
});
