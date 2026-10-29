import type { MavlinkMessage } from '../mavlink/decoder';
import type { FlightPhase, TelemetrySample, TelemetrySource, VehicleIdentity } from './types';
import { routeMavTypeToVehicleFamily } from './vehicle-family';

const MAV_MODE_FLAG_SAFETY_ARMED = 128;
const UINT16_MAX = 65_535;
const UINT32_MAX = 4_294_967_295;

type Values = Record<string, number>;
type Units = Record<string, string>;

const EXPECTED_SIGNALS: Readonly<Record<string, readonly string[]>> = {
  HEARTBEAT: ['vehicle.mav_type', 'vehicle.autopilot', 'vehicle.mavlink_version', 'flight.custom_mode', 'flight.base_mode', 'flight.system_status', 'flight.armed'],
  AUTOPILOT_VERSION: ['vehicle.capabilities', 'vehicle.firmware_version_encoded', 'vehicle.middleware_version_encoded', 'vehicle.os_version_encoded', 'vehicle.board_version', 'vehicle.vendor_id', 'vehicle.product_id'],
  SYS_STATUS: ['battery.voltage_v', 'battery.current_a', 'battery.remaining_pct'],
  BATTERY_STATUS: ['battery.voltage_v', 'battery.current_a', 'battery.remaining_pct', 'battery.temperature_c'],
  GPS_RAW_INT: ['gps.fix_type', 'gps.satellites', 'gps.hdop', 'gps.vdop', 'gps.latitude_deg', 'gps.longitude_deg', 'gps.altitude_m', 'gps.ground_speed_mps'],
  GLOBAL_POSITION_INT: ['position.latitude_deg', 'position.longitude_deg', 'position.altitude_m', 'position.relative_altitude_m', 'velocity.north_mps', 'velocity.east_mps', 'velocity.down_mps'],
  ATTITUDE: ['attitude.roll_rad', 'attitude.pitch_rad', 'attitude.yaw_rad', 'attitude.rollspeed_rad_per_s', 'attitude.pitchspeed_rad_per_s', 'attitude.yawspeed_rad_per_s'],
  ATTITUDE_TARGET: ['attitude.target_roll_rad', 'attitude.target_pitch_rad'],
  VFR_HUD: ['speed.air_mps', 'speed.ground_mps', 'altitude.msl_m', 'velocity.climb_mps', 'throttle.pct'],
  VIBRATION: ['vibration.x_mps2', 'vibration.y_mps2', 'vibration.z_mps2', 'imu.clipping_0', 'imu.clipping_1', 'imu.clipping_2'],
  EKF_STATUS_REPORT: ['ekf.flags', 'ekf.velocity_variance', 'ekf.pos_horiz_variance', 'ekf.pos_vert_variance', 'ekf.compass_variance', 'ekf.terrain_alt_variance', 'ekf.airspeed_variance'],
  EXTENDED_SYS_STATE: ['flight.landed_state'],
  HIGHRES_IMU: ['imu.xacc_mps2', 'imu.yacc_mps2', 'imu.zacc_mps2', 'imu.xgyro_radps', 'imu.ygyro_radps', 'imu.zgyro_radps', 'magnetometer.x_milligauss', 'magnetometer.y_milligauss', 'magnetometer.z_milligauss', 'barometer.pressure_pa', 'barometer.temperature_c', 'imu.temperature_c'],
  STATUSTEXT: ['status.severity', 'status.text'],
};

/**
 * Converts decoded MAVLink messages into stable, SI-unit telemetry samples.
 * One input message produces at most one sample; unsupported and malformed
 * fields are ignored rather than represented as zeroes or sensor faults.
 */
export class MavlinkTelemetryNormalizer {
  private armed = false;
  private landedState: number | undefined;
  private relativeAltitudeM: number | undefined;
  private verticalSpeedMps: number | undefined;
  private groundSpeedMps: number | undefined;
  private hasFlown = false;
  private connected = true;
  private readonly vehicles = new Map<number, VehicleIdentity>();

  constructor(private readonly source: TelemetrySource = 'live') {}

  normalize(message: Readonly<MavlinkMessage>, timestampMs: number): TelemetrySample | null {
    if (!Number.isFinite(timestampMs) || timestampMs < 0) return null;

    const values: Values = {};
    const units: Units = {};
    const textValues: Record<string, string> = {};

    switch (message.name) {
      case 'HEARTBEAT':
        this.readHeartbeat(message, values, units);
        break;
      case 'AUTOPILOT_VERSION':
        this.readAutopilotVersion(message, values, units, textValues);
        break;
      case 'SYS_STATUS':
        addScaled(message, 'voltage_battery', values, units, 'battery.voltage_v', 0.001, 'V', UINT16_MAX);
        addScaled(message, 'current_battery', values, units, 'battery.current_a', 0.01, 'A', -1);
        addNumber(message, 'battery_remaining', values, units, 'battery.remaining_pct', '%', -1);
        break;
      case 'BATTERY_STATUS':
        this.readBatteryStatus(message, values, units);
        break;
      case 'GPS_RAW_INT':
        addNumber(message, 'fix_type', values, units, 'gps.fix_type', 'enum');
        addNumber(message, 'satellites_visible', values, units, 'gps.satellites', 'count', 255);
        addScaled(message, 'eph', values, units, 'gps.hdop', 0.01, 'ratio', UINT16_MAX);
        addScaled(message, 'epv', values, units, 'gps.vdop', 0.01, 'ratio', UINT16_MAX);
        addScaled(message, 'lat', values, units, 'gps.latitude_deg', 1e-7, 'deg');
        addScaled(message, 'lon', values, units, 'gps.longitude_deg', 1e-7, 'deg');
        addScaled(message, 'alt', values, units, 'gps.altitude_m', 0.001, 'm');
        addScaled(message, 'vel', values, units, 'gps.ground_speed_mps', 0.01, 'm/s', UINT16_MAX);
        break;
      case 'GLOBAL_POSITION_INT':
        addScaled(message, 'lat', values, units, 'position.latitude_deg', 1e-7, 'deg');
        addScaled(message, 'lon', values, units, 'position.longitude_deg', 1e-7, 'deg');
        addScaled(message, 'alt', values, units, 'position.altitude_m', 0.001, 'm');
        addScaled(message, 'relative_alt', values, units, 'position.relative_altitude_m', 0.001, 'm');
        addScaled(message, 'vx', values, units, 'velocity.north_mps', 0.01, 'm/s');
        addScaled(message, 'vy', values, units, 'velocity.east_mps', 0.01, 'm/s');
        addScaled(message, 'vz', values, units, 'velocity.down_mps', 0.01, 'm/s');
        this.relativeAltitudeM = values['position.relative_altitude_m'];
        this.verticalSpeedMps = values['velocity.down_mps'];
        break;
      case 'ATTITUDE':
        for (const field of ['roll', 'pitch', 'yaw', 'rollspeed', 'pitchspeed', 'yawspeed']) {
          addNumber(message, field, values, units, `attitude.${field}_rad${field.endsWith('speed') ? '_per_s' : ''}`, field.endsWith('speed') ? 'rad/s' : 'rad');
        }
        break;
      case 'ATTITUDE_TARGET':
        this.readAttitudeTarget(message, values, units);
        break;
      case 'VFR_HUD':
        addNumber(message, 'airspeed', values, units, 'speed.air_mps', 'm/s');
        addNumber(message, 'groundspeed', values, units, 'speed.ground_mps', 'm/s');
        addNumber(message, 'alt', values, units, 'altitude.msl_m', 'm');
        addNumber(message, 'climb', values, units, 'velocity.climb_mps', 'm/s');
        addNumber(message, 'throttle', values, units, 'throttle.pct', '%');
        this.groundSpeedMps = values['speed.ground_mps'];
        if (values['velocity.climb_mps'] !== undefined) this.verticalSpeedMps = -values['velocity.climb_mps'];
        break;
      case 'VIBRATION':
        for (const axis of ['x', 'y', 'z']) addNumber(message, `vibration_${axis}`, values, units, `vibration.${axis}_mps2`, 'm/s²');
        for (const index of [0, 1, 2]) addNumber(message, `clipping_${index}`, values, units, `imu.clipping_${index}`, 'count', UINT32_MAX);
        break;
      case 'EKF_STATUS_REPORT':
        addNumber(message, 'flags', values, units, 'ekf.flags', 'bitmask');
        for (const field of ['velocity_variance', 'pos_horiz_variance', 'pos_vert_variance', 'compass_variance', 'terrain_alt_variance', 'airspeed_variance']) {
          addNumber(message, field, values, units, `ekf.${field}`, 'variance');
        }
        break;
      case 'EXTENDED_SYS_STATE':
        addNumber(message, 'landed_state', values, units, 'flight.landed_state', 'enum');
        this.landedState = values['flight.landed_state'];
        break;
      case 'HIGHRES_IMU':
        for (const field of ['xacc', 'yacc', 'zacc']) addNumber(message, field, values, units, `imu.${field}_mps2`, 'm/s²');
        for (const field of ['xgyro', 'ygyro', 'zgyro']) addNumber(message, field, values, units, `imu.${field}_radps`, 'rad/s');
        for (const field of ['xmag', 'ymag', 'zmag']) addScaled(message, field, values, units, `magnetometer.${field[0]}_milligauss`, 1000, 'mG');
        addScaled(message, 'abs_pressure', values, units, 'barometer.pressure_pa', 100, 'Pa');
        addNumber(message, 'temperature', values, units, 'imu.temperature_c', '°C');
        addNumber(message, 'temperature', values, units, 'barometer.temperature_c', '°C');
        break;
      case 'ESC_STATUS':
        this.readEscStatus(message, values, units);
        break;
      case 'ESC_INFO':
        this.readEscInfo(message, values, units);
        break;
      case 'STATUSTEXT': {
        addNumber(message, 'severity', values, units, 'status.severity', 'enum');
        const text = message.values['text'];
        if (typeof text === 'string' && text.trim()) textValues['status.text'] = text.trim();
        break;
      }
      default:
        return null;
    }

    const flightPhase = this.getFlightPhase();
    const availability = buildAvailability(message.name, values, textValues);
    const qualityFlags = Object.fromEntries(
      Object.entries(availability)
        .filter(([, available]) => !available)
        .map(([signal]) => [signal, ['missing_or_invalid'] as const]),
    );
    return {
      timestampMs,
      source: this.source,
      vehicleId: `${message.systemId}:${message.componentId}`,
      ...(this.vehicles.has(message.systemId) ? { vehicle: this.vehicles.get(message.systemId) } : {}),
      flightPhase,
      values,
      availability,
      ...(Object.keys(qualityFlags).length > 0 ? { qualityFlags } : {}),
      ...(Object.keys(units).length > 0 ? { units } : {}),
      ...(Object.keys(textValues).length > 0 ? { textValues } : {}),
    };
  }

  setConnected(connected: boolean): void {
    this.connected = connected;
  }

  getFlightPhase(): FlightPhase {
    if (!this.connected) return 'disconnected';

    const explicitlyAirborne = this.landedState === 2;
    const takingOff = this.landedState === 3;
    const landing = this.landedState === 4;
    const explicitlyGrounded = this.landedState === 1;
    const inferredAirborne = !explicitlyGrounded && (
      (this.relativeAltitudeM ?? 0) > 1
      || (this.groundSpeedMps ?? 0) > 2
    );
    if (explicitlyAirborne || takingOff || inferredAirborne) this.hasFlown = true;

    const inferredLanding = this.landedState === undefined
      && this.hasFlown
      && this.armed
      && (this.relativeAltitudeM ?? Number.POSITIVE_INFINITY) < 5
      && (this.verticalSpeedMps ?? 0) > 0.5;
    if (landing || inferredLanding) return 'landing';
    if (explicitlyAirborne || takingOff || inferredAirborne) return 'flying';
    if (this.hasFlown && explicitlyGrounded) return 'landed';
    if (this.armed) return 'armed';
    return 'on_ground';
  }

  reset(): void {
    this.armed = false;
    this.landedState = undefined;
    this.relativeAltitudeM = undefined;
    this.verticalSpeedMps = undefined;
    this.groundSpeedMps = undefined;
    this.hasFlown = false;
    this.connected = true;
    this.vehicles.clear();
  }

  private readHeartbeat(message: Readonly<MavlinkMessage>, values: Values, units: Units): void {
    addNumber(message, 'type', values, units, 'vehicle.mav_type', 'enum');
    addNumber(message, 'autopilot', values, units, 'vehicle.autopilot', 'enum');
    addNumber(message, 'custom_mode', values, units, 'flight.custom_mode', 'bitmask');
    addNumber(message, 'mavlink_version', values, units, 'vehicle.mavlink_version', 'version');
    addNumber(message, 'base_mode', values, units, 'flight.base_mode', 'bitmask');
    addNumber(message, 'system_status', values, units, 'flight.system_status', 'enum');
    const mavType = values['vehicle.mav_type'];
    const autopilot = values['vehicle.autopilot'];
    if (mavType !== undefined && autopilot !== undefined) {
      this.vehicles.set(message.systemId, Object.freeze({
        systemId: message.systemId,
        componentId: message.componentId,
        mavType,
        autopilot,
        family: routeMavTypeToVehicleFamily(mavType),
      }));
    }
    const baseMode = values['flight.base_mode'];
    if (baseMode !== undefined) this.armed = (baseMode & MAV_MODE_FLAG_SAFETY_ARMED) !== 0;
    values['flight.armed'] = this.armed ? 1 : 0;
    units['flight.armed'] = 'boolean';
  }

  private readAutopilotVersion(
    message: Readonly<MavlinkMessage>,
    values: Values,
    units: Units,
    textValues: Record<string, string>,
  ): void {
    addNumber(message, 'capabilities', values, units, 'vehicle.capabilities', 'bitmask');
    addNumber(message, 'flight_sw_version', values, units, 'vehicle.firmware_version_encoded', 'version');
    addNumber(message, 'middleware_sw_version', values, units, 'vehicle.middleware_version_encoded', 'version');
    addNumber(message, 'os_sw_version', values, units, 'vehicle.os_version_encoded', 'version');
    addNumber(message, 'board_version', values, units, 'vehicle.board_version', 'version');
    addNumber(message, 'vendor_id', values, units, 'vehicle.vendor_id', 'id');
    addNumber(message, 'product_id', values, units, 'vehicle.product_id', 'id');

    const encoded = values['vehicle.firmware_version_encoded'];
    const firmwareVersion = encoded === undefined ? undefined : decodeFirmwareVersion(encoded);
    if (firmwareVersion) textValues['vehicle.firmware_version'] = firmwareVersion;
    const current = this.vehicles.get(message.systemId);
    if (!current) return;
    this.vehicles.set(message.systemId, Object.freeze({
      ...current,
      ...(firmwareVersion ? { firmwareVersion } : {}),
      ...(encoded !== undefined ? { firmwareVersionEncoded: encoded } : {}),
      ...(values['vehicle.board_version'] !== undefined ? { boardVersion: values['vehicle.board_version'] } : {}),
      ...(values['vehicle.vendor_id'] !== undefined ? { vendorId: values['vehicle.vendor_id'] } : {}),
      ...(values['vehicle.product_id'] !== undefined ? { productId: values['vehicle.product_id'] } : {}),
    }));
  }

  private readBatteryStatus(message: Readonly<MavlinkMessage>, values: Values, units: Units): void {
    const voltages = message.values['voltages'];
    if (Array.isArray(voltages)) {
      const valid = voltages.filter(value => Number.isFinite(value) && value > 0 && value < UINT16_MAX);
      if (valid.length > 0) {
        values['battery.voltage_v'] = valid.reduce((sum, value) => sum + value, 0) * 0.001;
        units['battery.voltage_v'] = 'V';
      }
    }
    addScaled(message, 'current_battery', values, units, 'battery.current_a', 0.01, 'A', -1);
    addNumber(message, 'battery_remaining', values, units, 'battery.remaining_pct', '%', -1);
    addScaled(message, 'temperature', values, units, 'battery.temperature_c', 0.01, '°C', 32_767);
  }

  private readAttitudeTarget(message: Readonly<MavlinkMessage>, values: Values, units: Units): void {
    const typeMask = numericField(message, 'type_mask');
    if (typeMask !== undefined && (typeMask & 128) !== 0) return;
    const quaternion = message.values['q'];
    if (!Array.isArray(quaternion) || quaternion.length < 4 || !quaternion.every(Number.isFinite)) return;
    const [w, x, y, z] = quaternion;
    const norm = Math.hypot(w, x, y, z);
    if (norm < 0.5) return;
    const qw = w / norm;
    const qx = x / norm;
    const qy = y / norm;
    const qz = z / norm;
    values['attitude.target_roll_rad'] = Math.atan2(2 * (qw * qx + qy * qz), 1 - 2 * (qx * qx + qy * qy));
    values['attitude.target_pitch_rad'] = Math.asin(Math.max(-1, Math.min(1, 2 * (qw * qy - qz * qx))));
    units['attitude.target_roll_rad'] = 'rad';
    units['attitude.target_pitch_rad'] = 'rad';
  }

  private readEscStatus(message: Readonly<MavlinkMessage>, values: Values, units: Units): void {
    const index = numericField(message, 'index') ?? 0;
    for (const field of ['rpm', 'voltage', 'current'] as const) {
      const entries = message.values[field];
      if (!Array.isArray(entries)) continue;
      const unit = field === 'rpm' ? 'rpm' : field === 'voltage' ? 'V' : 'A';
      entries.forEach((entry, offset) => {
        if (!Number.isFinite(entry)) return;
        const signal = `esc.${Math.trunc(index) + offset}.${field}`;
        values[signal] = entry;
        units[signal] = unit;
      });
    }
  }

  private readEscInfo(message: Readonly<MavlinkMessage>, values: Values, units: Units): void {
    const index = numericField(message, 'index') ?? 0;
    const temperatures = message.values['temperature'];
    if (!Array.isArray(temperatures)) return;
    temperatures.forEach((temperature, offset) => {
      if (!Number.isFinite(temperature) || temperature === 32_767) return;
      const signal = `esc.${Math.trunc(index) + offset}.temperature_c`;
      values[signal] = temperature * 0.01;
      units[signal] = '°C';
    });
  }
}

function buildAvailability(
  messageName: string,
  values: Readonly<Values>,
  textValues: Readonly<Record<string, string>>,
): Record<string, boolean> {
  const availability: Record<string, boolean> = {};
  for (const signal of EXPECTED_SIGNALS[messageName] ?? []) {
    availability[signal] = Object.hasOwn(values, signal) || Object.hasOwn(textValues, signal);
  }
  for (const signal of Object.keys(values)) availability[signal] = true;
  for (const signal of Object.keys(textValues)) availability[signal] = true;
  return availability;
}

function decodeFirmwareVersion(encoded: number): string | undefined {
  if (!Number.isInteger(encoded) || encoded <= 0 || encoded > UINT32_MAX) return undefined;
  const unsigned = encoded >>> 0;
  const major = (unsigned >>> 24) & 0xFF;
  const minor = (unsigned >>> 16) & 0xFF;
  const patch = (unsigned >>> 8) & 0xFF;
  const versionType = unsigned & 0xFF;
  const suffix = versionType === 0 ? '-dev'
    : versionType === 64 ? '-alpha'
      : versionType === 128 ? '-beta'
        : versionType === 192 ? '-rc'
          : '';
  return `${major}.${minor}.${patch}${suffix}`;
}

function numericField(message: Readonly<MavlinkMessage>, field: string, unavailable?: number): number | undefined {
  const value = message.values[field];
  return typeof value === 'number' && Number.isFinite(value) && value !== unavailable ? value : undefined;
}

function addNumber(message: Readonly<MavlinkMessage>, field: string, values: Values, units: Units, signal: string, unit: string, unavailable?: number): void {
  const value = numericField(message, field, unavailable);
  if (value === undefined) return;
  values[signal] = value;
  units[signal] = unit;
}

function addScaled(message: Readonly<MavlinkMessage>, field: string, values: Values, units: Units, signal: string, scale: number, unit: string, unavailable?: number): void {
  const value = numericField(message, field, unavailable);
  if (value === undefined) return;
  values[signal] = value * scale;
  units[signal] = unit;
}
