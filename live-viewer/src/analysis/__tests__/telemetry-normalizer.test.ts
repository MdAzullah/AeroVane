import { describe, expect, it } from 'vitest';
import type { MavlinkMessage } from '../../mavlink/decoder';
import { MavlinkTelemetryNormalizer } from '../telemetry-normalizer';

function message(name: string, values: MavlinkMessage['values'], systemId = 1): MavlinkMessage {
  return { id: 0, name, values, systemId, componentId: 1, sequence: 0 };
}

describe('MavlinkTelemetryNormalizer', () => {
  it('normalizes battery values into SI units', () => {
    const normalizer = new MavlinkTelemetryNormalizer();
    const sample = normalizer.normalize(message('SYS_STATUS', {
      voltage_battery: 15_750,
      current_battery: 123,
      battery_remaining: 82,
    }), 1_000);

    expect(sample).toMatchObject({
      timestampMs: 1_000,
      source: 'live',
      vehicleId: '1:1',
      values: {
        'battery.voltage_v': 15.75,
        'battery.current_a': 1.23,
        'battery.remaining_pct': 82,
      },
      units: {
        'battery.voltage_v': 'V',
        'battery.current_a': 'A',
        'battery.remaining_pct': '%',
      },
    });
  });

  it('sums valid BATTERY_STATUS cell voltages and ignores unavailable fields', () => {
    const normalizer = new MavlinkTelemetryNormalizer();
    const sample = normalizer.normalize(message('BATTERY_STATUS', {
      voltages: [4_100, 4_090, 4_080, 65_535, 0],
      current_battery: -1,
      battery_remaining: -1,
      temperature: 2_525,
    }), 2_000)!;

    expect(sample.values['battery.voltage_v']).toBeCloseTo(12.27);
    expect(sample.values['battery.temperature_c']).toBe(25.25);
    expect(sample.values).not.toHaveProperty('battery.current_a');
    expect(sample.values).not.toHaveProperty('battery.remaining_pct');
  });

  it('normalizes GPS position, accuracy, and speed', () => {
    const normalizer = new MavlinkTelemetryNormalizer('tlog');
    const sample = normalizer.normalize(message('GPS_RAW_INT', {
      fix_type: 3,
      satellites_visible: 14,
      eph: 85,
      epv: 130,
      lat: 340_522_000,
      lon: -1_182_437_000,
      alt: 12_345,
      vel: 450,
    }), 3_000)!;

    expect(sample.source).toBe('tlog');
    expect(sample.values).toMatchObject({
      'gps.fix_type': 3,
      'gps.satellites': 14,
      'gps.hdop': 0.85,
      'gps.vdop': 1.3,
      'gps.altitude_m': 12.345,
      'gps.ground_speed_mps': 4.5,
    });
    expect(sample.values['gps.latitude_deg']).toBeCloseTo(34.0522);
    expect(sample.values['gps.longitude_deg']).toBeCloseTo(-118.2437);
  });

  it('rejects non-finite values and invalid timestamps safely', () => {
    const normalizer = new MavlinkTelemetryNormalizer();
    expect(normalizer.normalize(message('ATTITUDE', { roll: 0.1 }), Number.NaN)).toBeNull();
    const sample = normalizer.normalize(message('ATTITUDE', {
      roll: Number.NaN,
      pitch: Number.POSITIVE_INFINITY,
      yaw: 0.2,
    }), 4_000)!;
    expect(sample.values).toEqual({ 'attitude.yaw_rad': 0.2 });
  });

  it('preserves status text with its severity', () => {
    const normalizer = new MavlinkTelemetryNormalizer();
    const sample = normalizer.normalize(message('STATUSTEXT', {
      severity: 2,
      text: '  EKF variance  ',
    }), 5_000)!;
    expect(sample.values).toEqual({ 'status.severity': 2 });
    expect(sample.textValues).toEqual({ 'status.text': 'EKF variance' });
  });

  it('converts attitude-target quaternions to roll and pitch', () => {
    const normalizer = new MavlinkTelemetryNormalizer();
    const halfAngle = Math.PI / 8;
    const sample = normalizer.normalize(message('ATTITUDE_TARGET', {
      type_mask: 0,
      q: [Math.cos(halfAngle), Math.sin(halfAngle), 0, 0],
    }), 5_100)!;
    expect(sample.values['attitude.target_roll_rad']).toBeCloseTo(Math.PI / 4);
    expect(sample.values['attitude.target_pitch_rad']).toBeCloseTo(0);
  });

  it('normalizes indexed ESC RPM, current, voltage, and temperature', () => {
    const normalizer = new MavlinkTelemetryNormalizer();
    const status = normalizer.normalize(message('ESC_STATUS', {
      index: 4, rpm: [4_000, 4_100], voltage: [15.8, 15.7], current: [3.1, 3.2],
    }), 5_200)!;
    expect(status.values).toMatchObject({
      'esc.4.rpm': 4_000, 'esc.5.rpm': 4_100,
      'esc.4.voltage': 15.8, 'esc.5.current': 3.2,
    });
    const info = normalizer.normalize(message('ESC_INFO', {
      index: 4, temperature: [6_500, 32_767],
    }), 5_300)!;
    expect(info.values).toEqual({ 'esc.4.temperature_c': 65 });
  });

  it('ignores unsupported messages', () => {
    const normalizer = new MavlinkTelemetryNormalizer();
    expect(normalizer.normalize(message('COMMAND_ACK', { command: 1 }), 1)).toBeNull();
  });

  it('tracks on-ground, armed, flying, landing, landed, and disconnected phases', () => {
    const normalizer = new MavlinkTelemetryNormalizer();
    expect(normalizer.normalize(message('HEARTBEAT', { base_mode: 0, system_status: 3 }), 1)?.flightPhase).toBe('on_ground');
    expect(normalizer.normalize(message('HEARTBEAT', { base_mode: 128, system_status: 4 }), 2)?.flightPhase).toBe('armed');
    expect(normalizer.normalize(message('EXTENDED_SYS_STATE', { landed_state: 2 }), 3)?.flightPhase).toBe('flying');
    expect(normalizer.normalize(message('EXTENDED_SYS_STATE', { landed_state: 4 }), 4)?.flightPhase).toBe('landing');
    expect(normalizer.normalize(message('EXTENDED_SYS_STATE', { landed_state: 1 }), 5)?.flightPhase).toBe('landed');
    normalizer.setConnected(false);
    expect(normalizer.getFlightPhase()).toBe('disconnected');
  });

  it('resets retained flight state between sessions', () => {
    const normalizer = new MavlinkTelemetryNormalizer();
    normalizer.normalize(message('HEARTBEAT', { base_mode: 128 }), 1);
    normalizer.normalize(message('EXTENDED_SYS_STATE', { landed_state: 2 }), 2);
    normalizer.reset();
    expect(normalizer.getFlightPhase()).toBe('on_ground');
  });
});
