/**
 * Spoof byte source for testing without real MAVLink hardware.
 *
 * Generates realistic MAVLink telemetry frames at configurable rates.
 * Simulates a vehicle flying a figure-8 pattern over Los Angeles
 * with realistic attitude, position, and system status updates.
 */

import type { ByteCallback, IByteSource } from './byte-source';
import { MavlinkFrameBuilder } from '../mavlink/frame-builder';
import { MavlinkFrameParser } from '../mavlink/frame-parser';
import { MavlinkMessageDecoder } from '../mavlink/decoder';
import type { MavlinkMetadataRegistry } from '../mavlink/registry';
import { SpoofParamResponder } from './spoof-param-responder';
import { SpoofFtpResponder } from './spoof-ftp-responder';
import type { SpoofScenarioId, SimulationEnvironmentId, SimulationFlightProfileId } from './spoof-scenarios';

/** Status text entries with severity levels. */
const STATUS_MESSAGES: ReadonlyArray<readonly [number, string]> = [
  [6, 'All systems nominal'],
  [6, 'GPS lock acquired'],
  [6, 'Battery voltage nominal'],
  [6, 'Telemetry link stable'],
  [5, 'Altitude hold active'],
  [5, 'Navigation mode enabled'],
  [6, 'Sensor calibration complete'],
] as const;

/** Degrees-to-radians conversion factor. */
const DEG_TO_RAD = Math.PI / 180;

/** Meters per degree of latitude at equator. */
const METERS_PER_DEG_LAT = 111320;

/** Minimum STATUSTEXT interval in seconds. */
const STATUS_MIN_DELAY_S = 3;

/** Maximum STATUSTEXT interval in seconds. */
const STATUS_MAX_DELAY_S = 8;

export class SpoofByteSource implements IByteSource {
  private readonly registry: MavlinkMetadataRegistry;
  private readonly frameBuilder: MavlinkFrameBuilder;
  private readonly callbacks = new Set<ByteCallback>();
  private readonly inboundParser: MavlinkFrameParser;
  private readonly inboundDecoder: MavlinkMessageDecoder;
  private readonly paramResponder: SpoofParamResponder;
  private readonly ftpResponder: SpoofFtpResponder;

  private readonly systemId: number;
  private readonly componentId: number;

  // Timer handles
  private fastTelemetryTimer: ReturnType<typeof setInterval> | null = null;
  private slowTelemetryTimer: ReturnType<typeof setInterval> | null = null;
  private heartbeatTimer: ReturnType<typeof setInterval> | null = null;
  private statusTextTimer: ReturnType<typeof setTimeout> | null = null;

  private _isConnected = false;
  private sequenceNumber = 0;

  // Simulation state
  private simulationTime = 0;
  private latitude = 34.0522;
  private longitude = -118.2437;
  private altitude = 75.0;     // Start in middle of [50, 100] range
  private groundSpeed = 15.0;  // Start in middle of [5, 25] range
  private heading = 0;
  private roll = 0;            // radians
  private pitch = 0;           // radians
  private yaw = 0;             // radians
  private batteryVoltage = 12.6;
  private throttle = 50;
  private statusTextIndex = 0;
  private readonly scenario: SpoofScenarioId;
  private readonly environment: SimulationEnvironmentId;
  private readonly flightProfile: SimulationFlightProfileId;
  private radioErrors = 0;

  constructor(
    registry: MavlinkMetadataRegistry,
    systemId = 1,
    componentId = 1,
    metadataJson = '',
    scenario: SpoofScenarioId = 'normal',
    environment: SimulationEnvironmentId = 'calm',
    flightProfile: SimulationFlightProfileId = 'cruise',
  ) {
    this.registry = registry;
    this.frameBuilder = new MavlinkFrameBuilder(registry);
    this.systemId = systemId;
    this.componentId = componentId;
    this.scenario = scenario;
    this.environment = environment;
    this.flightProfile = flightProfile;

    // Loopback pipeline: parse outbound frames, decode, dispatch to responders
    this.inboundParser = new MavlinkFrameParser(registry);
    this.inboundDecoder = new MavlinkMessageDecoder(registry);
    this.paramResponder = new SpoofParamResponder(registry, systemId, componentId);
    this.ftpResponder = new SpoofFtpResponder(registry, metadataJson, systemId, componentId);

    this.inboundParser.onFrame(frame => {
      const msg = this.inboundDecoder.decode(frame);
      if (!msg) return;

      // Collect responses from all responders
      const responses = [
        ...this.paramResponder.handleMessage(msg),
        ...this.ftpResponder.handleMessage(msg),
      ];

      for (const responseFrame of responses) {
        // Emit response frames through the normal data path
        // Use setTimeout to avoid synchronous re-entry
        setTimeout(() => {
          for (const cb of this.callbacks) {
            cb(responseFrame);
          }
        }, 0);
      }
    });
  }

  get isConnected(): boolean {
    return this._isConnected;
  }

  onData(callback: ByteCallback): () => void {
    this.callbacks.add(callback);
    return () => {
      this.callbacks.delete(callback);
    };
  }

  async connect(): Promise<void> {
    if (this._isConnected) {
      await this.disconnect();
    }

    this._isConnected = true;

    // Fast telemetry at 10 Hz: ATTITUDE, GLOBAL_POSITION_INT, VFR_HUD
    this.fastTelemetryTimer = setInterval(
      () => this.generateFastTelemetry(),
      100,
    );

    // Slow telemetry at 1 Hz: SYS_STATUS
    this.slowTelemetryTimer = setInterval(
      () => this.generateSlowTelemetry(),
      1000,
    );

    // Heartbeat at 1 Hz
    this.heartbeatTimer = setInterval(
      () => this.generateHeartbeat(),
      1000,
    );

    // STATUSTEXT at random 3-8s intervals
    this.scheduleNextStatusText();
  }

  async write(data: Uint8Array): Promise<void> {
    if (!this._isConnected) return;
    // Feed outbound bytes through the inbound parser for loopback
    this.inboundParser.parse(data);
  }

  async disconnect(): Promise<void> {
    if (this.fastTelemetryTimer !== null) {
      clearInterval(this.fastTelemetryTimer);
      this.fastTelemetryTimer = null;
    }
    if (this.slowTelemetryTimer !== null) {
      clearInterval(this.slowTelemetryTimer);
      this.slowTelemetryTimer = null;
    }
    if (this.heartbeatTimer !== null) {
      clearInterval(this.heartbeatTimer);
      this.heartbeatTimer = null;
    }
    if (this.statusTextTimer !== null) {
      clearTimeout(this.statusTextTimer);
      this.statusTextTimer = null;
    }
    this._isConnected = false;
  }

  // -------------------------------------------------------------------
  // Private: frame emission
  // -------------------------------------------------------------------

  private emitMessage(
    messageName: string,
    values: Record<string, number | string | number[]>,
  ): void {
    if (!this._isConnected) return;

    const frame = this.frameBuilder.buildFrame({
      messageName,
      values,
      systemId: this.systemId,
      componentId: this.componentId,
      sequence: this.nextSequence(),
    });

    for (const cb of this.callbacks) {
      cb(frame);
    }
  }

  private nextSequence(): number {
    const seq = this.sequenceNumber;
    this.sequenceNumber = (this.sequenceNumber + 1) & 0xFF;
    return seq;
  }

  // -------------------------------------------------------------------
  // Private: telemetry generation
  // -------------------------------------------------------------------

  private generateFastTelemetry(): void {
    if (!this._isConnected) return;

    this.simulationTime += 100;
    const timeBootMs = this.simulationTime;
    const timeInSeconds = this.simulationTime / 1000;
    if (this.isScenarioActive('link')) return;

    // Update simulation state
    this.updateSimulationState(timeInSeconds);

    const headingRad = this.heading * DEG_TO_RAD;

    // GLOBAL_POSITION_INT (#33)
    this.emitMessage('GLOBAL_POSITION_INT', {
      time_boot_ms: timeBootMs,
      lat: Math.round(this.latitude * 1e7),
      lon: Math.round(this.longitude * 1e7),
      alt: Math.round(this.altitude * 1000),
      relative_alt: Math.round(this.altitude * 1000),
      vx: Math.round(this.groundSpeed * Math.cos(headingRad) * 100),
      vy: Math.round(this.groundSpeed * Math.sin(headingRad) * 100),
      vz: 0,
      hdg: Math.round(this.heading * 100),
    });

    // ATTITUDE (#30)
    if (!this.isScenarioActive('frozen')) {
      this.emitMessage('ATTITUDE', {
        time_boot_ms: timeBootMs, roll: this.roll, pitch: this.pitch, yaw: this.yaw,
        rollspeed: 0, pitchspeed: 0, yawspeed: 0,
      });
    }

    if (this.scenario === 'attitude') {
      const targetRoll = this.isScenarioActive('attitude') ? this.roll + 1 : this.roll;
      const targetPitch = this.isScenarioActive('attitude') ? this.pitch + 0.7 : this.pitch;
      this.emitIfSupported('ATTITUDE_TARGET', {
        time_boot_ms: timeBootMs, type_mask: 0, q: eulerToQuaternion(targetRoll, targetPitch, this.yaw),
        body_roll_rate: 0, body_pitch_rate: 0, body_yaw_rate: 0, thrust: 0.5,
      });
    }

    // VFR_HUD (#74)
    this.emitMessage('VFR_HUD', {
      airspeed: this.groundSpeed,
      groundspeed: this.groundSpeed,
      heading: Math.round(this.heading),
      throttle: this.isScenarioActive('altitude') ? 90 : this.throttle,
      alt: this.altitude,
      climb: this.isScenarioActive('altitude') ? -4 : 0,
    });

    // Keep common sensor families available in every simulation so plots and
    // detectors are useful without requiring a matching fault scenario.
    const vibration = this.environment === 'storm' ? 18 : this.environment === 'mountain' ? 10 : 4;
    const vibrationFault = this.isScenarioActive('vibration');
    const compassFault = this.isScenarioActive('compass');
    this.emitIfSupported('SCALED_IMU', {
      time_boot_ms: timeBootMs,
      xacc: Math.round(Math.sin(timeInSeconds * 1.7) * vibration),
      yacc: Math.round(Math.cos(timeInSeconds * 1.3) * vibration),
      zacc: 1000 + Math.round(Math.sin(timeInSeconds * 2.1) * vibration),
      xgyro: Math.round(this.roll * 1000), ygyro: Math.round(this.pitch * 1000), zgyro: Math.round(0.26 * 1000),
      xmag: compassFault ? 1200 : 220, ymag: compassFault ? -900 : 35, zmag: compassFault ? 700 : 410,
      temperature: this.environment === 'mountain' ? 1200 : this.environment === 'storm' ? 1800 : 2600,
    });
    this.emitIfSupported('VIBRATION', {
      time_usec: this.simulationTime * 1000,
      vibration_x: vibrationFault ? 70 : vibration,
      vibration_y: vibrationFault ? 65 : vibration * 1.1,
      vibration_z: vibrationFault ? 75 : vibration * 1.2,
      clipping_0: vibrationFault ? 2 : 0, clipping_1: 0, clipping_2: vibrationFault ? 1 : 0,
    });
  }

  private generateSlowTelemetry(): void {
    if (!this._isConnected) return;
    if (this.isScenarioActive('link')) return;

    // Battery slow drain
    this.batteryVoltage -= 0.001;
    this.batteryVoltage = clamp(this.batteryVoltage, 10.0, 13.0);

    this.emitMessage('SYS_STATUS', {
      onboard_control_sensors_present: 0x7FF,
      onboard_control_sensors_enabled: 0x7FF,
      onboard_control_sensors_health: 0x7FF,
      load: 100,
      voltage_battery: Math.round((this.isScenarioActive('battery') ? 9.5 : this.batteryVoltage) * 1000),
      current_battery: Math.round((6 + this.throttle * 0.12) * 100),
      battery_remaining: Math.max(0, Math.round(100 - this.simulationTime / 120_000)),
      drop_rate_comm: 0,
      errors_comm: 0,
      errors_count1: 0,
      errors_count2: 0,
      errors_count3: 0,
      errors_count4: 0,
    });
    const displayedVoltage = this.isScenarioActive('battery') ? 9.5 : this.batteryVoltage;
    const cellVoltage = Math.round(displayedVoltage * 1000 / 3);
    this.emitIfSupported('BATTERY_STATUS', {
      id: 0, battery_function: 1, type: 3,
      temperature: this.environment === 'storm' ? 1800 : 2800,
      voltages: [cellVoltage, cellVoltage, cellVoltage, 65535, 65535, 65535, 65535, 65535, 65535, 65535],
      current_battery: Math.round((6 + this.throttle * 0.12) * 100),
      current_consumed: Math.round(this.simulationTime / 1000 * 3),
      energy_consumed: Math.round(this.simulationTime / 1000 * 1.2),
      battery_remaining: Math.max(0, Math.round(100 - this.simulationTime / 120_000)),
      time_remaining: Math.max(0, Math.round(1200 - this.simulationTime / 1000)),
      charge_state: this.isScenarioActive('battery') ? 2 : 1,
      voltages_ext: [0, 0, 0, 0], mode: 0, fault_bitmask: 0,
    });

    const urbanGps = this.environment === 'urban';
    this.emitIfSupported('GPS_RAW_INT', {
      time_usec: this.simulationTime * 1000, fix_type: this.isScenarioActive('gps') ? 1 : 3,
      lat: Math.round(this.latitude * 1e7), lon: Math.round(this.longitude * 1e7),
      alt: Math.round(this.altitude * 1000), eph: this.isScenarioActive('gps') ? 900 : urbanGps ? 240 : 90,
      epv: 120, vel: Math.round(this.groundSpeed * 100), cog: Math.round(this.heading * 100),
      satellites_visible: this.isScenarioActive('gps') ? 3 : urbanGps ? 8 : 14,
    });
    this.emitIfSupported('EKF_STATUS_REPORT', {
      flags: 831, velocity_variance: this.isScenarioActive('ekf') ? 3 : 0.2,
      pos_horiz_variance: 0.2, pos_vert_variance: 0.2, compass_variance: 0.2,
      terrain_alt_variance: 0.2, airspeed_variance: 0.2,
    });
    if (this.scenario === 'motor') this.emitIfSupported('ESC_STATUS', {
      index: 0, time_usec: this.simulationTime * 1000,
      rpm: this.isScenarioActive('motor') ? [3000, 3000, 1000, 3000] : [3000, 3050, 2980, 3020],
      voltage: [12, 12, 12, 12], current: [5, 5, 5, 5],
    });

    const pressureDrift = this.isScenarioActive('barometer') ? (this.simulationTime - 5_000) / 8_000 : 0;
    const environmentPressure = this.environment === 'mountain' ? 820 : this.environment === 'storm' ? 985 : 1013.25;
    this.emitIfSupported('SCALED_PRESSURE', {
      time_boot_ms: this.simulationTime, press_abs: environmentPressure - this.altitude * 0.12 + pressureDrift,
      press_diff: this.groundSpeed * this.groundSpeed * 0.006, temperature: this.environment === 'mountain' ? 900 : 2300,
      temperature_press_diff: 2200,
    });
    const weakRadio = this.isScenarioActive('radio');
    if (weakRadio) this.radioErrors += 4;
    this.emitIfSupported('RADIO_STATUS', {
      rssi: weakRadio ? 35 : this.environment === 'urban' ? 110 : 190,
      remrssi: weakRadio ? 28 : 180, txbuf: weakRadio ? 18 : 92,
      noise: weakRadio ? 90 : this.environment === 'urban' ? 70 : 35,
      remnoise: weakRadio ? 95 : 38, rxerrors: this.radioErrors, fixed: Math.floor(this.radioErrors / 2),
    });
    const windSpeed = this.environment === 'storm' ? 14 : this.environment === 'mountain' ? 8 : this.environment === 'coastal' ? 6 : 1.5;
    this.emitIfSupported('WIND_COV', {
      time_usec: this.simulationTime * 1000,
      wind_x: windSpeed + Math.sin(this.simulationTime / 700) * (this.environment === 'storm' ? 5 : 0.8),
      wind_y: windSpeed * 0.45, wind_z: this.environment === 'mountain' ? -2 : 0,
      var_horiz: this.environment === 'storm' ? 5 : 0.8, var_vert: this.environment === 'storm' ? 2 : 0.3,
      wind_alt: this.altitude, horiz_accuracy: 0.5, vert_accuracy: 0.5,
    });
    this.emitIfSupported('NAV_CONTROLLER_OUTPUT', {
      nav_roll: this.roll / DEG_TO_RAD, nav_pitch: this.pitch / DEG_TO_RAD,
      nav_bearing: Math.round(this.heading), target_bearing: Math.round((this.heading + 15) % 360),
      wp_dist: Math.max(0, Math.round(500 - (this.simulationTime / 100))),
      alt_error: 75 - this.altitude, aspd_error: 15 - this.groundSpeed, xtrack_error: Math.sin(this.simulationTime / 3000) * 2,
    });
  }

  private generateHeartbeat(): void {
    if (!this._isConnected) return;
    if (this.isScenarioActive('link')) return;

    this.emitMessage('HEARTBEAT', {
      type: 2,              // MAV_TYPE_QUADROTOR
      autopilot: 3,         // MAV_AUTOPILOT_ARDUPILOTMEGA
      base_mode: 0x81,
      custom_mode: 0,
      system_status: 4,     // MAV_STATE_ACTIVE
      mavlink_version: 3,
    });
  }

  private scheduleNextStatusText(): void {
    if (!this._isConnected) return;

    const delayMs = (STATUS_MIN_DELAY_S +
      Math.floor(Math.random() * (STATUS_MAX_DELAY_S - STATUS_MIN_DELAY_S + 1))) * 1000;

    this.statusTextTimer = setTimeout(() => {
      this.generateStatusText();
      this.scheduleNextStatusText();
    }, delayMs);
  }

  private generateStatusText(): void {
    if (!this._isConnected) return;
    if (this.isScenarioActive('link')) return;

    const [severity, text] = STATUS_MESSAGES[this.statusTextIndex % STATUS_MESSAGES.length];
    this.statusTextIndex++;

    this.emitMessage('STATUSTEXT', {
      severity,
      text,
    });
  }

  // -------------------------------------------------------------------
  // Private: simulation model
  // -------------------------------------------------------------------

  private updateSimulationState(timeInSeconds: number): void {
    const profile = this.flightProfile === 'hover'
      ? { minSpeed: 0.2, maxSpeed: 2, speedNoise: 0.08, turnRate: 4, attitudeNoise: 0.025, rollLimit: 6, pitchLimit: 5 }
      : this.flightProfile === 'aggressive'
        ? { minSpeed: 12, maxSpeed: 35, speedNoise: 0.9, turnRate: 28, attitudeNoise: 0.18, rollLimit: 38, pitchLimit: 28 }
        : { minSpeed: 5, maxSpeed: 25, speedNoise: 0.6, turnRate: 15, attitudeNoise: 0.1, rollLimit: 20, pitchLimit: 15 };
    // Altitude random walk bounded [50, 100]m
    this.altitude += (Math.random() - 0.5) * 0.1;  // +-0.05
    this.altitude = clamp(this.altitude, 50, 100);

    // Groundspeed random walk bounded [5, 25] m/s
    this.groundSpeed += (Math.random() - 0.5) * profile.speedNoise;
    this.groundSpeed = clamp(this.groundSpeed, profile.minSpeed, profile.maxSpeed);

    // Heading: figure-8 pattern
    const baseHeading = (timeInSeconds * profile.turnRate) % 360;
    const headingVariation = 30 * Math.sin(timeInSeconds * 0.5);
    this.heading = ((baseHeading + headingVariation) % 360 + 360) % 360;

    // Roll random walk bounded [-20deg, 20deg] in radians
    this.roll += (Math.random() - 0.5) * profile.attitudeNoise;
    this.roll = clamp(this.roll, -profile.rollLimit * DEG_TO_RAD, profile.rollLimit * DEG_TO_RAD);

    // Pitch random walk bounded [-15deg, 15deg] in radians
    this.pitch += (Math.random() - 0.5) * profile.attitudeNoise;
    this.pitch = clamp(this.pitch, -profile.pitchLimit * DEG_TO_RAD, profile.pitchLimit * DEG_TO_RAD);

    // Yaw follows heading
    this.yaw = this.heading * DEG_TO_RAD;

    // GPS position update
    const headingRad = this.heading * DEG_TO_RAD;
    const latRad = this.latitude * DEG_TO_RAD;
    this.latitude += (this.groundSpeed * Math.cos(headingRad) * 0.1) / METERS_PER_DEG_LAT;
    this.longitude += (this.groundSpeed * Math.sin(headingRad) * 0.1) / (METERS_PER_DEG_LAT * Math.cos(latRad));

    // Throttle random walk bounded [0, 100]
    this.throttle += Math.round((Math.random() - 0.5) * 10);
    this.throttle = clamp(this.throttle, 0, 100);
  }

  private isScenarioActive(scenario: SpoofScenarioId): boolean {
    return this.scenario === scenario && this.simulationTime >= 5_000;
  }

  private emitIfSupported(messageName: string, values: Record<string, number | string | number[]>): void {
    if (this.registry.getMessageByName(messageName)) this.emitMessage(messageName, values);
  }
}

/** Clamp a value to the range [min, max]. */
function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}

function eulerToQuaternion(roll: number, pitch: number, yaw: number): number[] {
  const cr = Math.cos(roll / 2), sr = Math.sin(roll / 2);
  const cp = Math.cos(pitch / 2), sp = Math.sin(pitch / 2);
  const cy = Math.cos(yaw / 2), sy = Math.sin(yaw / 2);
  return [cr * cp * cy + sr * sp * sy, sr * cp * cy - cr * sp * sy, cr * sp * cy + sr * cp * sy, cr * cp * sy - sr * sp * cy];
}
