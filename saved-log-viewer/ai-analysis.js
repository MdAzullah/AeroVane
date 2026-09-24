(() => {
  var __defProp = Object.defineProperty;
  var __defNormalProp = (obj, key, value) => key in obj ? __defProp(obj, key, { enumerable: true, configurable: true, writable: true, value }) : obj[key] = value;
  var __publicField = (obj, key, value) => __defNormalProp(obj, typeof key !== "symbol" ? key + "" : key, value);

  // live-viewer/src/core/event-emitter.ts
  var EventEmitter = class {
    constructor() {
      __publicField(this, "listeners", /* @__PURE__ */ new Set());
    }
    /** Subscribe a listener. Returns an unsubscribe function. */
    on(listener) {
      this.listeners.add(listener);
      return () => {
        this.listeners.delete(listener);
      };
    }
    /** Invoke all listeners with the given arguments. */
    emit(...args) {
      for (const listener of this.listeners) {
        listener(...args);
      }
    }
    /** Remove all listeners. */
    clear() {
      this.listeners.clear();
    }
    /** Number of active listeners. */
    get size() {
      return this.listeners.size;
    }
  };

  // live-viewer/src/core/crc32.ts
  var TABLE = new Uint32Array(256);
  for (let i = 0; i < 256; i++) {
    let crc = i;
    for (let j = 0; j < 8; j++) {
      crc = crc & 1 ? crc >>> 1 ^ 3988292384 : crc >>> 1;
    }
    TABLE[i] = crc;
  }

  // live-viewer/src/analysis/fault-engine.ts
  var FaultDetectionEngine = class {
    constructor(detectors = []) {
      __publicField(this, "detectors", /* @__PURE__ */ new Map());
      __publicField(this, "activeFaults", /* @__PURE__ */ new Map());
      __publicField(this, "eventEmitter", new EventEmitter());
      __publicField(this, "errorEmitter", new EventEmitter());
      __publicField(this, "nextFaultId", 1);
      for (const detector of detectors) {
        this.registerDetector(detector);
      }
    }
    /** Register a detector. IDs must be non-empty and unique. */
    registerDetector(detector) {
      const id = detector.id.trim();
      if (!id) throw new Error("Detector ID cannot be empty");
      if (this.detectors.has(id)) {
        throw new Error(`Detector ID already registered: ${id}`);
      }
      this.detectors.set(id, detector);
    }
    /**
     * Process one sample and return the events emitted for it.
     * Invalid timestamps are ignored. Non-finite signal values are removed
     * before detectors receive the sample.
     */
    processSample(sample) {
      if (!Number.isFinite(sample.timestampMs) || sample.timestampMs < 0) {
        return [];
      }
      const safeSample = sanitizeSample(sample);
      const emitted = [];
      for (const [detectorId, detector] of this.detectors) {
        let findings;
        try {
          findings = detector.evaluate(safeSample);
        } catch (error) {
          this.errorEmitter.emit({
            detectorId,
            timestampMs: safeSample.timestampMs,
            error
          });
          continue;
        }
        if (!Array.isArray(findings)) continue;
        for (const finding of findings) {
          const event = this.applyFinding(detectorId, finding, safeSample.timestampMs);
          if (!event) continue;
          emitted.push(event);
          this.eventEmitter.emit(event);
        }
      }
      return emitted;
    }
    /** Subscribe to created, updated, and cleared fault events. */
    onFaultEvent(callback) {
      return this.eventEmitter.on(callback);
    }
    /** Subscribe to detector failures without stopping other detectors. */
    onDetectorError(callback) {
      return this.errorEmitter.on(callback);
    }
    /** Return immutable copies of the currently active faults. */
    getActiveFaults() {
      return Array.from(this.activeFaults.values(), cloneFault);
    }
    /** Reset all detector and active-fault state for a new flight or log. */
    reset() {
      this.activeFaults.clear();
      this.nextFaultId = 1;
      for (const [detectorId, detector] of this.detectors) {
        try {
          detector.reset();
        } catch (error) {
          this.errorEmitter.emit({ detectorId, timestampMs: 0, error });
        }
      }
    }
    /** Remove subscribers and all session state. */
    dispose() {
      this.reset();
      this.eventEmitter.clear();
      this.errorEmitter.clear();
    }
    applyFinding(detectorId, finding, timestampMs) {
      if (!isValidKey(finding.key)) return null;
      const lookupKey = `${detectorId}:${finding.key}`;
      if (finding.status === "cleared") {
        const active = this.activeFaults.get(lookupKey);
        if (!active) return null;
        const cleared = {
          ...active,
          state: "cleared",
          updatedAtMs: timestampMs,
          clearedAtMs: timestampMs
        };
        this.activeFaults.delete(lookupKey);
        return { type: "cleared", fault: cloneFault(cleared) };
      }
      if (!isValidActiveFinding(finding)) return null;
      const existing = this.activeFaults.get(lookupKey);
      if (existing) {
        const updated = buildFaultRecord(
          finding,
          detectorId,
          existing.id,
          existing.startedAtMs,
          timestampMs
        );
        this.activeFaults.set(lookupKey, updated);
        return { type: "updated", fault: cloneFault(updated) };
      }
      const created = buildFaultRecord(
        finding,
        detectorId,
        `fault-${this.nextFaultId++}`,
        timestampMs,
        timestampMs
      );
      this.activeFaults.set(lookupKey, created);
      return { type: "created", fault: cloneFault(created) };
    }
  };
  function sanitizeSample(sample) {
    const values = {};
    const units = {};
    const textValues = {};
    for (const [key, value] of Object.entries(sample.values ?? {})) {
      if (key && typeof value === "number" && Number.isFinite(value)) {
        values[key] = value;
        const unit = sample.units?.[key];
        if (typeof unit === "string" && unit.length > 0) units[key] = unit;
      }
    }
    for (const [key, value] of Object.entries(sample.textValues ?? {})) {
      if (key && typeof value === "string" && value.length > 0) textValues[key] = value;
    }
    return {
      ...sample,
      values,
      ...Object.keys(units).length > 0 ? { units } : { units: void 0 },
      ...Object.keys(textValues).length > 0 ? { textValues } : { textValues: void 0 }
    };
  }
  function isValidKey(key) {
    return typeof key === "string" && key.trim().length > 0;
  }
  function isValidActiveFinding(finding) {
    return finding.faultType.trim().length > 0 && finding.message.trim().length > 0 && finding.suggestedAction.trim().length > 0 && Number.isFinite(finding.confidence) && Array.isArray(finding.evidence);
  }
  function buildFaultRecord(finding, detectorId, id, startedAtMs, updatedAtMs) {
    return {
      id,
      key: finding.key,
      detectorId,
      faultType: finding.faultType,
      severity: finding.severity,
      state: "active",
      confidence: Math.max(0, Math.min(1, finding.confidence)),
      message: finding.message,
      evidence: sanitizeEvidence(finding.evidence),
      suggestedAction: finding.suggestedAction,
      startedAtMs,
      updatedAtMs
    };
  }
  function sanitizeEvidence(evidence) {
    return evidence.filter((item) => typeof item.signal === "string" && item.signal.length > 0 && typeof item.description === "string" && Number.isFinite(item.value) && (item.threshold === void 0 || Number.isFinite(item.threshold))).map((item) => ({ ...item }));
  }
  function cloneFault(fault) {
    return {
      ...fault,
      evidence: fault.evidence.map((item) => ({ ...item }))
    };
  }

  // live-viewer/src/analysis/detectors/condition-latch.ts
  var ConditionLatch = class {
    constructor() {
      __publicField(this, "active", false);
      __publicField(this, "badSinceMs");
      __publicField(this, "goodSinceMs");
    }
    update(isBad, timestampMs, activationDelayMs, recoveryDelayMs) {
      let activated = false;
      let cleared = false;
      if (isBad) {
        this.goodSinceMs = void 0;
        this.badSinceMs ?? (this.badSinceMs = timestampMs);
        if (!this.active && timestampMs - this.badSinceMs >= activationDelayMs) {
          this.active = true;
          activated = true;
        }
      } else {
        this.badSinceMs = void 0;
        this.goodSinceMs ?? (this.goodSinceMs = timestampMs);
        if (this.active && timestampMs - this.goodSinceMs >= recoveryDelayMs) {
          this.active = false;
          cleared = true;
        }
      }
      return { active: this.active, activated, cleared };
    }
    reset() {
      this.active = false;
      this.badSinceMs = void 0;
      this.goodSinceMs = void 0;
    }
  };

  // live-viewer/src/analysis/detectors/config.ts
  var DEFAULT_BATTERY_DETECTOR_CONFIG = {
    activationDelayMs: 3e3,
    recoveryDelayMs: 5e3,
    warningVoltageV: 10.5,
    criticalVoltageV: 9.9,
    rapidDropVPerSecond: 0.15,
    rapidDropWindowMs: 1e4
  };
  var DEFAULT_GPS_DETECTOR_CONFIG = {
    activationDelayMs: 3e3,
    recoveryDelayMs: 5e3,
    minimumFixType: 3,
    minimumSatellites: 6,
    maximumHdop: 2.5
  };
  var DEFAULT_COMMUNICATION_DETECTOR_CONFIG = {
    activationDelayMs: 0,
    recoveryDelayMs: 2e3,
    heartbeatTimeoutMs: 5e3,
    telemetryTimeoutMs: 3e3
  };
  var DEFAULT_VIBRATION_DETECTOR_CONFIG = {
    activationDelayMs: 2e3,
    recoveryDelayMs: 4e3,
    warningMps2: 30,
    criticalMps2: 60
  };
  var DEFAULT_ATTITUDE_DETECTOR_CONFIG = {
    activationDelayMs: 2e3,
    recoveryDelayMs: 3e3,
    warningErrorRad: 20 * Math.PI / 180,
    criticalErrorRad: 35 * Math.PI / 180
  };
  var DEFAULT_ALTITUDE_LOSS_DETECTOR_CONFIG = {
    activationDelayMs: 2e3,
    recoveryDelayMs: 3e3,
    minimumThrottlePct: 70,
    warningDescentMps: 1.5,
    criticalDescentMps: 3
  };
  var DEFAULT_EKF_DETECTOR_CONFIG = {
    activationDelayMs: 2e3,
    recoveryDelayMs: 4e3,
    warningVariance: 1,
    criticalVariance: 2
  };
  var DEFAULT_SENSOR_STALENESS_DETECTOR_CONFIG = {
    activationDelayMs: 0,
    recoveryDelayMs: 2e3,
    missingTimeoutMs: 2e3,
    frozenTimeoutMs: 5e3,
    changeEpsilonRad: 1e-5
  };
  var DEFAULT_MOTOR_IMBALANCE_DETECTOR_CONFIG = {
    activationDelayMs: 2e3,
    recoveryDelayMs: 4e3,
    warningDeviationRatio: 0.25,
    criticalDeviationRatio: 0.4,
    minimumMeanRpm: 500
  };
  var DEFAULT_TEMPERATURE_DETECTOR_CONFIG = {
    activationDelayMs: 3e3,
    recoveryDelayMs: 5e3,
    imuWarningC: 80,
    imuCriticalC: 90,
    batteryWarningC: 55,
    batteryCriticalC: 65,
    escWarningC: 90,
    escCriticalC: 110
  };
  var DEFAULT_STATUS_TEXT_DETECTOR_CONFIG = {
    activeDurationMs: 15e3
  };

  // live-viewer/src/analysis/detectors/battery-detector.ts
  var BatteryFaultDetector = class {
    constructor(config = {}) {
      __publicField(this, "id", "battery");
      __publicField(this, "voltageLatch", new ConditionLatch());
      __publicField(this, "dropLatch", new ConditionLatch());
      __publicField(this, "voltageHistory", []);
      __publicField(this, "config");
      this.config = { ...DEFAULT_BATTERY_DETECTOR_CONFIG, ...config };
    }
    evaluate(sample) {
      const voltageV = sample.values["battery.voltage_v"];
      if (voltageV === void 0) return [];
      const findings = [];
      const voltageState = this.voltageLatch.update(
        voltageV <= this.config.warningVoltageV,
        sample.timestampMs,
        this.config.activationDelayMs,
        this.config.recoveryDelayMs
      );
      if (voltageState.cleared) findings.push({ status: "cleared", key: "low-voltage" });
      if (voltageState.active) {
        const critical = voltageV <= this.config.criticalVoltageV;
        const threshold = critical ? this.config.criticalVoltageV : this.config.warningVoltageV;
        findings.push({
          status: "active",
          key: "low-voltage",
          faultType: critical ? "BATTERY_VOLTAGE_CRITICAL" : "BATTERY_VOLTAGE_LOW",
          severity: critical ? "critical" : "warning",
          confidence: critical ? 0.98 : 0.92,
          message: critical ? "Battery voltage is critically low" : "Battery voltage is low",
          evidence: [{
            signal: "battery.voltage_v",
            value: voltageV,
            unit: "V",
            threshold,
            description: `Battery voltage is at or below the configured ${critical ? "critical" : "warning"} limit`
          }],
          suggestedAction: critical ? "Land immediately in the nearest safe area" : "Prepare to land and monitor battery voltage"
        });
      }
      const dropRate = this.recordAndCalculateDropRate(sample.timestampMs, voltageV);
      if (dropRate !== void 0) {
        const dropState = this.dropLatch.update(
          dropRate >= this.config.rapidDropVPerSecond,
          sample.timestampMs,
          this.config.activationDelayMs,
          this.config.recoveryDelayMs
        );
        if (dropState.cleared) findings.push({ status: "cleared", key: "rapid-drop" });
        if (dropState.active) findings.push({
          status: "active",
          key: "rapid-drop",
          faultType: "BATTERY_VOLTAGE_RAPID_DROP",
          severity: "warning",
          confidence: 0.88,
          message: "Battery voltage is falling unusually fast",
          evidence: [{
            signal: "battery.voltage_drop_v_per_s",
            value: dropRate,
            unit: "V/s",
            threshold: this.config.rapidDropVPerSecond,
            description: "Observed voltage drop rate exceeds the configured limit"
          }],
          suggestedAction: "Reduce power demand and land as soon as safely possible"
        });
      }
      return findings;
    }
    reset() {
      this.voltageLatch.reset();
      this.dropLatch.reset();
      this.voltageHistory.length = 0;
    }
    recordAndCalculateDropRate(timestampMs, voltageV) {
      const last = this.voltageHistory.at(-1);
      if (last && timestampMs <= last.timestampMs) return void 0;
      this.voltageHistory.push({ timestampMs, voltageV });
      const cutoff = timestampMs - this.config.rapidDropWindowMs;
      while (this.voltageHistory.length > 1 && this.voltageHistory[1].timestampMs <= cutoff) {
        this.voltageHistory.shift();
      }
      const first = this.voltageHistory[0];
      const elapsedSeconds = (timestampMs - first.timestampMs) / 1e3;
      if (elapsedSeconds <= 0) return void 0;
      return Math.max(0, (first.voltageV - voltageV) / elapsedSeconds);
    }
  };

  // live-viewer/src/analysis/detectors/gps-detector.ts
  var GpsFaultDetector = class {
    constructor(config = {}) {
      __publicField(this, "id", "gps");
      __publicField(this, "latches", {
        fix: new ConditionLatch(),
        satellites: new ConditionLatch(),
        accuracy: new ConditionLatch()
      });
      __publicField(this, "config");
      this.config = { ...DEFAULT_GPS_DETECTOR_CONFIG, ...config };
    }
    evaluate(sample) {
      const findings = [];
      const fixType = sample.values["gps.fix_type"];
      if (fixType !== void 0) {
        this.evaluateCondition(findings, "fix", fixType < this.config.minimumFixType, sample.timestampMs, () => ({
          status: "active",
          key: "fix",
          faultType: "GPS_FIX_INVALID",
          severity: "warning",
          confidence: 0.96,
          message: "GPS does not have a valid 3D fix",
          evidence: [{ signal: "gps.fix_type", value: fixType, unit: "enum", threshold: this.config.minimumFixType, description: "GPS fix type is below the configured minimum" }],
          suggestedAction: "Hold position if safe and wait for a stable GPS fix"
        }));
      }
      const satellites = sample.values["gps.satellites"];
      if (satellites !== void 0) {
        this.evaluateCondition(findings, "satellites", satellites < this.config.minimumSatellites, sample.timestampMs, () => ({
          status: "active",
          key: "satellites",
          faultType: "GPS_SATELLITES_LOW",
          severity: "caution",
          confidence: 0.9,
          message: "GPS satellite count is low",
          evidence: [{ signal: "gps.satellites", value: satellites, unit: "count", threshold: this.config.minimumSatellites, description: "Visible satellite count is below the configured minimum" }],
          suggestedAction: "Avoid GPS-dependent manoeuvres until satellite reception improves"
        }));
      }
      const hdop = sample.values["gps.hdop"];
      if (hdop !== void 0) {
        this.evaluateCondition(findings, "accuracy", hdop > this.config.maximumHdop, sample.timestampMs, () => ({
          status: "active",
          key: "accuracy",
          faultType: "GPS_ACCURACY_POOR",
          severity: "caution",
          confidence: 0.88,
          message: "GPS horizontal accuracy is poor",
          evidence: [{ signal: "gps.hdop", value: hdop, unit: "ratio", threshold: this.config.maximumHdop, description: "HDOP exceeds the configured maximum" }],
          suggestedAction: "Maintain a safe flight mode and wait for GPS accuracy to improve"
        }));
      }
      return findings;
    }
    reset() {
      Object.values(this.latches).forEach((latch) => latch.reset());
    }
    evaluateCondition(findings, key, isBad, timestampMs, activeFinding) {
      const state = this.latches[key].update(isBad, timestampMs, this.config.activationDelayMs, this.config.recoveryDelayMs);
      if (state.cleared) findings.push({ status: "cleared", key });
      if (state.active) findings.push(activeFinding());
    }
  };

  // live-viewer/src/analysis/detectors/communication-detector.ts
  var COMMUNICATION_WATCHDOG_SIGNAL = "communication.watchdog_tick";
  var CommunicationFaultDetector = class {
    constructor(config = {}) {
      __publicField(this, "id", "communication");
      __publicField(this, "heartbeatLatch", new ConditionLatch());
      __publicField(this, "telemetryLatch", new ConditionLatch());
      __publicField(this, "config");
      __publicField(this, "lastHeartbeatMs");
      __publicField(this, "lastTelemetryMs");
      this.config = { ...DEFAULT_COMMUNICATION_DETECTOR_CONFIG, ...config };
    }
    evaluate(sample) {
      const isWatchdog = sample.values[COMMUNICATION_WATCHDOG_SIGNAL] === 1;
      if (!isWatchdog) {
        this.lastTelemetryMs = sample.timestampMs;
        if (sample.values["flight.base_mode"] !== void 0) this.lastHeartbeatMs = sample.timestampMs;
      }
      const findings = [];
      if (this.lastTelemetryMs !== void 0) {
        const elapsed = Math.max(0, sample.timestampMs - this.lastTelemetryMs);
        const state = this.telemetryLatch.update(
          elapsed > this.config.telemetryTimeoutMs,
          sample.timestampMs,
          this.config.activationDelayMs,
          this.config.recoveryDelayMs
        );
        if (state.cleared) findings.push({ status: "cleared", key: "telemetry" });
        if (state.active) findings.push(this.activeFinding(
          "telemetry",
          "TELEMETRY_TIMEOUT",
          "critical",
          elapsed,
          this.config.telemetryTimeoutMs,
          "Telemetry has stopped arriving",
          "Check the radio link and prepare for the configured failsafe response"
        ));
      }
      if (this.lastHeartbeatMs !== void 0) {
        const elapsed = Math.max(0, sample.timestampMs - this.lastHeartbeatMs);
        const state = this.heartbeatLatch.update(
          elapsed > this.config.heartbeatTimeoutMs,
          sample.timestampMs,
          this.config.activationDelayMs,
          this.config.recoveryDelayMs
        );
        if (state.cleared) findings.push({ status: "cleared", key: "heartbeat" });
        if (state.active) findings.push(this.activeFinding(
          "heartbeat",
          "HEARTBEAT_TIMEOUT",
          "warning",
          elapsed,
          this.config.heartbeatTimeoutMs,
          "Vehicle heartbeat has stopped arriving",
          "Verify vehicle status and the telemetry connection"
        ));
      }
      return findings;
    }
    reset() {
      this.heartbeatLatch.reset();
      this.telemetryLatch.reset();
      this.lastHeartbeatMs = void 0;
      this.lastTelemetryMs = void 0;
    }
    activeFinding(key, faultType, severity, elapsedMs, thresholdMs, message, suggestedAction) {
      return {
        status: "active",
        key,
        faultType,
        severity,
        confidence: 0.99,
        message,
        evidence: [{
          signal: `communication.${key}_age_ms`,
          value: elapsedMs,
          unit: "ms",
          threshold: thresholdMs,
          description: `${key === "heartbeat" ? "Heartbeat" : "Telemetry"} age exceeds the configured timeout`
        }],
        suggestedAction
      };
    }
  };

  // live-viewer/src/analysis/detectors/vibration-detector.ts
  var VibrationFaultDetector = class {
    constructor(config = {}) {
      __publicField(this, "id", "vibration");
      __publicField(this, "vibrationLatch", new ConditionLatch());
      __publicField(this, "clippingLatch", new ConditionLatch());
      __publicField(this, "config");
      __publicField(this, "clippingTotal");
      this.config = { ...DEFAULT_VIBRATION_DETECTOR_CONFIG, ...config };
    }
    evaluate(sample) {
      const findings = [];
      const axes = ["x", "y", "z"].map((axis) => sample.values[`vibration.${axis}_mps2`]).filter((v) => v !== void 0);
      if (axes.length > 0) {
        const peak = Math.max(...axes.map(Math.abs));
        const state = this.vibrationLatch.update(peak >= this.config.warningMps2, sample.timestampMs, this.config.activationDelayMs, this.config.recoveryDelayMs);
        if (state.cleared) findings.push({ status: "cleared", key: "excessive" });
        if (state.active) {
          const critical = peak >= this.config.criticalMps2;
          findings.push({ status: "active", key: "excessive", faultType: critical ? "VIBRATION_CRITICAL" : "VIBRATION_EXCESSIVE", severity: critical ? "critical" : "warning", confidence: 0.94, message: critical ? "Airframe vibration is critical" : "Airframe vibration is excessive", evidence: [{ signal: "vibration.peak_mps2", value: peak, unit: "m/s\xB2", threshold: critical ? this.config.criticalMps2 : this.config.warningMps2, description: "Peak vibration exceeds the configured limit" }], suggestedAction: "Land safely and inspect propellers, motors, and frame mounting" });
        }
      }
      const clipping = [0, 1, 2].map((i) => sample.values[`imu.clipping_${i}`]).filter((v) => v !== void 0);
      if (clipping.length > 0) {
        const total = clipping.reduce((sum, value) => sum + value, 0);
        const increased = this.clippingTotal !== void 0 && total > this.clippingTotal;
        this.clippingTotal = total;
        const state = this.clippingLatch.update(increased, sample.timestampMs, this.config.activationDelayMs, this.config.recoveryDelayMs);
        if (state.cleared) findings.push({ status: "cleared", key: "clipping" });
        if (state.active) findings.push({ status: "active", key: "clipping", faultType: "IMU_CLIPPING", severity: "warning", confidence: 0.97, message: "IMU clipping is increasing", evidence: [{ signal: "imu.clipping_total", value: total, unit: "count", description: "Cumulative accelerometer clipping count continues to increase" }], suggestedAction: "Reduce vibration and inspect IMU isolation before the next flight" });
      }
      return findings;
    }
    reset() {
      this.vibrationLatch.reset();
      this.clippingLatch.reset();
      this.clippingTotal = void 0;
    }
  };

  // live-viewer/src/analysis/detectors/attitude-detector.ts
  var AttitudeFaultDetector = class {
    constructor(config = {}) {
      __publicField(this, "id", "attitude");
      __publicField(this, "latch", new ConditionLatch());
      __publicField(this, "config");
      __publicField(this, "actualRoll");
      __publicField(this, "actualPitch");
      __publicField(this, "targetRoll");
      __publicField(this, "targetPitch");
      __publicField(this, "actualAtMs");
      __publicField(this, "targetAtMs");
      this.config = { ...DEFAULT_ATTITUDE_DETECTOR_CONFIG, ...config };
    }
    evaluate(sample) {
      if (sample.values["attitude.roll_rad"] !== void 0 || sample.values["attitude.pitch_rad"] !== void 0) {
        this.actualRoll = sample.values["attitude.roll_rad"] ?? this.actualRoll;
        this.actualPitch = sample.values["attitude.pitch_rad"] ?? this.actualPitch;
        this.actualAtMs = sample.timestampMs;
      }
      if (sample.values["attitude.target_roll_rad"] !== void 0 || sample.values["attitude.target_pitch_rad"] !== void 0) {
        this.targetRoll = sample.values["attitude.target_roll_rad"] ?? this.targetRoll;
        this.targetPitch = sample.values["attitude.target_pitch_rad"] ?? this.targetPitch;
        this.targetAtMs = sample.timestampMs;
      }
      if ([this.actualRoll, this.actualPitch, this.targetRoll, this.targetPitch].some((value) => value === void 0)) return [];
      const rollError = angularError(this.actualRoll, this.targetRoll);
      const pitchError = angularError(this.actualPitch, this.targetPitch);
      const maximumError = Math.max(rollError, pitchError);
      const fresh = sample.timestampMs - (this.actualAtMs ?? 0) <= 2e3 && sample.timestampMs - (this.targetAtMs ?? 0) <= 2e3;
      const monitoring = fresh && (sample.flightPhase === "flying" || sample.flightPhase === "landing");
      const state = this.latch.update(monitoring && maximumError >= this.config.warningErrorRad, sample.timestampMs, this.config.activationDelayMs, this.config.recoveryDelayMs);
      if (state.cleared) return [{ status: "cleared", key: "tracking" }];
      if (!state.active) return [];
      const critical = maximumError >= this.config.criticalErrorRad;
      return [{ status: "active", key: "tracking", faultType: critical ? "ATTITUDE_TRACKING_CRITICAL" : "ATTITUDE_TRACKING_ERROR", severity: critical ? "critical" : "warning", confidence: 0.9, message: "Vehicle attitude is not following its target", evidence: [{ signal: rollError >= pitchError ? "attitude.roll_error_rad" : "attitude.pitch_error_rad", value: maximumError, unit: "rad", threshold: critical ? this.config.criticalErrorRad : this.config.warningErrorRad, description: "Maximum roll or pitch tracking error exceeds the configured limit" }], suggestedAction: "Reduce manoeuvring demand and land if attitude control remains degraded" }];
    }
    reset() {
      this.latch.reset();
      this.actualRoll = this.actualPitch = this.targetRoll = this.targetPitch = this.actualAtMs = this.targetAtMs = void 0;
    }
  };
  function angularError(actual, target) {
    return Math.abs(Math.atan2(Math.sin(actual - target), Math.cos(actual - target)));
  }

  // live-viewer/src/analysis/detectors/altitude-loss-detector.ts
  var AltitudeLossFaultDetector = class {
    constructor(config = {}) {
      __publicField(this, "id", "altitude-loss");
      __publicField(this, "latch", new ConditionLatch());
      __publicField(this, "config");
      __publicField(this, "throttlePct");
      __publicField(this, "descentMps");
      __publicField(this, "throttleAtMs");
      __publicField(this, "descentAtMs");
      this.config = { ...DEFAULT_ALTITUDE_LOSS_DETECTOR_CONFIG, ...config };
    }
    evaluate(sample) {
      if (sample.values["throttle.pct"] !== void 0) {
        this.throttlePct = sample.values["throttle.pct"];
        this.throttleAtMs = sample.timestampMs;
      }
      if (sample.values["velocity.down_mps"] !== void 0) {
        this.descentMps = sample.values["velocity.down_mps"];
        this.descentAtMs = sample.timestampMs;
      }
      if (sample.values["velocity.climb_mps"] !== void 0) {
        this.descentMps = -sample.values["velocity.climb_mps"];
        this.descentAtMs = sample.timestampMs;
      }
      if (this.throttlePct === void 0 || this.descentMps === void 0) return [];
      const fresh = sample.timestampMs - (this.throttleAtMs ?? 0) <= 2e3 && sample.timestampMs - (this.descentAtMs ?? 0) <= 2e3;
      const flying = fresh && sample.flightPhase === "flying";
      const bad = flying && this.throttlePct >= this.config.minimumThrottlePct && this.descentMps >= this.config.warningDescentMps;
      const state = this.latch.update(bad, sample.timestampMs, this.config.activationDelayMs, this.config.recoveryDelayMs);
      if (state.cleared) return [{ status: "cleared", key: "high-throttle-descent" }];
      if (!state.active) return [];
      const critical = this.descentMps >= this.config.criticalDescentMps;
      return [{ status: "active", key: "high-throttle-descent", faultType: critical ? "ALTITUDE_LOSS_CRITICAL" : "ALTITUDE_LOSS_HIGH_THROTTLE", severity: critical ? "critical" : "warning", confidence: 0.93, message: critical ? "Rapid altitude loss despite high throttle" : "Vehicle is descending despite high throttle", evidence: [
        { signal: "velocity.descent_mps", value: this.descentMps, unit: "m/s", threshold: critical ? this.config.criticalDescentMps : this.config.warningDescentMps, description: "Descent rate exceeds the configured limit" },
        { signal: "throttle.pct", value: this.throttlePct, unit: "%", threshold: this.config.minimumThrottlePct, description: "Throttle remains above the high-demand threshold" }
      ], suggestedAction: "Reduce horizontal demand, verify lift response, and land immediately if safe" }];
    }
    reset() {
      this.latch.reset();
      this.throttlePct = this.descentMps = this.throttleAtMs = this.descentAtMs = void 0;
    }
  };

  // live-viewer/src/analysis/detectors/ekf-detector.ts
  var EKF_GPS_GLITCH = 1 << 10;
  var EKF_ACCEL_ERROR = 1 << 11;
  var ERROR_FLAGS = EKF_GPS_GLITCH | EKF_ACCEL_ERROR;
  var EkfFaultDetector = class {
    constructor(config = {}) {
      __publicField(this, "id", "ekf");
      __publicField(this, "latch", new ConditionLatch());
      __publicField(this, "config");
      this.config = { ...DEFAULT_EKF_DETECTOR_CONFIG, ...config };
    }
    evaluate(sample) {
      const flags = sample.values["ekf.flags"];
      const variances = Object.entries(sample.values).filter(([key]) => key.startsWith("ekf.") && key.endsWith("_variance"));
      if (flags === void 0 && variances.length === 0) return [];
      const maximum = variances.reduce((max, [, value]) => Math.max(max, value), 0);
      const errorFlags = flags === void 0 ? 0 : Math.trunc(flags) & ERROR_FLAGS;
      const bad = errorFlags !== 0 || maximum >= this.config.warningVariance;
      const state = this.latch.update(bad, sample.timestampMs, this.config.activationDelayMs, this.config.recoveryDelayMs);
      if (state.cleared) return [{ status: "cleared", key: "health" }];
      if (!state.active) return [];
      const critical = errorFlags !== 0 || maximum >= this.config.criticalVariance;
      const evidence = errorFlags !== 0 ? { signal: "ekf.error_flags", value: errorFlags, unit: "bitmask", threshold: 0, description: "EKF reports GPS glitch or accelerometer error flags" } : { signal: "ekf.maximum_variance", value: maximum, unit: "variance", threshold: critical ? this.config.criticalVariance : this.config.warningVariance, description: "Maximum EKF variance exceeds the configured limit" };
      return [{ status: "active", key: "health", faultType: critical ? "EKF_HEALTH_CRITICAL" : "EKF_VARIANCE_HIGH", severity: critical ? "critical" : "warning", confidence: 0.95, message: critical ? "Navigation estimator health is critical" : "Navigation estimator variance is high", evidence: [evidence], suggestedAction: "Avoid GPS-dependent modes and land safely if navigation remains unreliable" }];
    }
    reset() {
      this.latch.reset();
    }
  };

  // live-viewer/src/analysis/detectors/sensor-staleness-detector.ts
  var SensorStalenessFaultDetector = class {
    constructor(config = {}) {
      __publicField(this, "id", "sensor-staleness");
      __publicField(this, "missingLatch", new ConditionLatch());
      __publicField(this, "frozenLatch", new ConditionLatch());
      __publicField(this, "config");
      __publicField(this, "lastReceivedMs");
      __publicField(this, "lastChangedMs");
      __publicField(this, "lastRoll");
      __publicField(this, "lastPitch");
      this.config = { ...DEFAULT_SENSOR_STALENESS_DETECTOR_CONFIG, ...config };
    }
    evaluate(sample) {
      const roll = sample.values["attitude.roll_rad"];
      const pitch = sample.values["attitude.pitch_rad"];
      if (roll !== void 0 || pitch !== void 0) {
        const changed = this.lastRoll === void 0 || this.lastPitch === void 0 || Math.abs((roll ?? this.lastRoll) - this.lastRoll) > this.config.changeEpsilonRad || Math.abs((pitch ?? this.lastPitch) - this.lastPitch) > this.config.changeEpsilonRad;
        this.lastReceivedMs = sample.timestampMs;
        if (changed) this.lastChangedMs = sample.timestampMs;
        this.lastRoll = roll ?? this.lastRoll;
        this.lastPitch = pitch ?? this.lastPitch;
      }
      if (this.lastReceivedMs === void 0 || this.lastChangedMs === void 0) return [];
      const monitoring = sample.flightPhase === "flying" || sample.flightPhase === "landing";
      const receiveAge = Math.max(0, sample.timestampMs - this.lastReceivedMs);
      const changeAge = Math.max(0, sample.timestampMs - this.lastChangedMs);
      const missing = monitoring && receiveAge > this.config.missingTimeoutMs;
      const frozen = monitoring && !missing && changeAge > this.config.frozenTimeoutMs;
      const findings = [];
      this.apply(findings, this.missingLatch, "attitude-missing", missing, sample.timestampMs, {
        faultType: "ATTITUDE_SENSOR_MISSING",
        severity: "critical",
        confidence: 0.98,
        message: "Attitude telemetry has stopped updating",
        signal: "sensor.attitude_age_ms",
        value: receiveAge,
        threshold: this.config.missingTimeoutMs,
        description: "Time since the last attitude sample exceeds the configured timeout",
        action: "Use a safe fallback mode and land immediately if attitude data remains unavailable"
      });
      this.apply(findings, this.frozenLatch, "attitude-frozen", frozen, sample.timestampMs, {
        faultType: "ATTITUDE_SENSOR_FROZEN",
        severity: "warning",
        confidence: 0.86,
        message: "Attitude sensor values appear frozen",
        signal: "sensor.attitude_unchanged_ms",
        value: changeAge,
        threshold: this.config.frozenTimeoutMs,
        description: "Attitude values have remained unchanged beyond the configured limit",
        action: "Avoid aggressive manoeuvres and land to inspect the attitude sensors"
      });
      return findings;
    }
    reset() {
      this.missingLatch.reset();
      this.frozenLatch.reset();
      this.lastReceivedMs = this.lastChangedMs = this.lastRoll = this.lastPitch = void 0;
    }
    apply(findings, latch, key, bad, timestampMs, detail) {
      const state = latch.update(bad, timestampMs, this.config.activationDelayMs, this.config.recoveryDelayMs);
      if (state.cleared) findings.push({ status: "cleared", key });
      if (state.active) findings.push({ status: "active", key, faultType: detail.faultType, severity: detail.severity, confidence: detail.confidence, message: detail.message, evidence: [{ signal: detail.signal, value: detail.value, unit: "ms", threshold: detail.threshold, description: detail.description }], suggestedAction: detail.action });
    }
  };

  // live-viewer/src/analysis/detectors/motor-imbalance-detector.ts
  var MotorImbalanceFaultDetector = class {
    constructor(config = {}) {
      __publicField(this, "id", "motor-imbalance");
      __publicField(this, "latch", new ConditionLatch());
      __publicField(this, "config");
      this.config = { ...DEFAULT_MOTOR_IMBALANCE_DETECTOR_CONFIG, ...config };
    }
    evaluate(sample) {
      const rpms = Object.entries(sample.values).filter(([key]) => /^esc\.\d+\.rpm$/.test(key)).map(([, value]) => Math.abs(value));
      if (rpms.length < 2) return [];
      const mean = rpms.reduce((sum, value) => sum + value, 0) / rpms.length;
      const deviation = mean > 0 ? Math.max(...rpms.map((value) => Math.abs(value - mean))) / mean : 0;
      const bad = mean >= this.config.minimumMeanRpm && deviation >= this.config.warningDeviationRatio;
      const state = this.latch.update(bad, sample.timestampMs, this.config.activationDelayMs, this.config.recoveryDelayMs);
      if (state.cleared) return [{ status: "cleared", key: "rpm" }];
      if (!state.active) return [];
      const critical = deviation >= this.config.criticalDeviationRatio;
      return [{ status: "active", key: "rpm", faultType: critical ? "MOTOR_IMBALANCE_CRITICAL" : "MOTOR_ESC_IMBALANCE", severity: critical ? "critical" : "warning", confidence: 0.88, message: critical ? "Motor RPM imbalance is critical" : "Motor or ESC RPM imbalance detected", evidence: [
        { signal: "motor.maximum_rpm_deviation_ratio", value: deviation, unit: "ratio", threshold: critical ? this.config.criticalDeviationRatio : this.config.warningDeviationRatio, description: "Maximum motor RPM deviation from the group mean exceeds the limit" },
        { signal: "motor.mean_rpm", value: mean, unit: "rpm", threshold: this.config.minimumMeanRpm, description: "Mean RPM is high enough for imbalance monitoring" }
      ], suggestedAction: "Land safely and inspect motors, propellers, ESCs, and wiring" }];
    }
    reset() {
      this.latch.reset();
    }
  };

  // live-viewer/src/analysis/detectors/temperature-detector.ts
  var TemperatureFaultDetector = class {
    constructor(config = {}) {
      __publicField(this, "id", "temperature");
      __publicField(this, "latches", { imu: new ConditionLatch(), battery: new ConditionLatch(), esc: new ConditionLatch() });
      __publicField(this, "config");
      this.config = { ...DEFAULT_TEMPERATURE_DETECTOR_CONFIG, ...config };
    }
    evaluate(sample) {
      const findings = [];
      this.check(findings, sample, "imu", sample.values["imu.temperature_c"], "imu.temperature_c");
      this.check(findings, sample, "battery", sample.values["battery.temperature_c"], "battery.temperature_c");
      const escEntries = Object.entries(sample.values).filter(([key]) => /^esc\.\d+\.temperature_c$/.test(key));
      if (escEntries.length > 0) {
        const hottest = escEntries.reduce((max, entry) => entry[1] > max[1] ? entry : max);
        this.check(findings, sample, "esc", hottest[1], hottest[0]);
      }
      return findings;
    }
    reset() {
      Object.values(this.latches).forEach((latch) => latch.reset());
    }
    check(findings, sample, kind, value, signal) {
      if (value === void 0) return;
      const warning = this.config[`${kind}WarningC`];
      const criticalLimit = this.config[`${kind}CriticalC`];
      const state = this.latches[kind].update(value >= warning, sample.timestampMs, this.config.activationDelayMs, this.config.recoveryDelayMs);
      if (state.cleared) findings.push({ status: "cleared", key: kind });
      if (!state.active) return;
      const critical = value >= criticalLimit;
      findings.push({ status: "active", key: kind, faultType: `${kind.toUpperCase()}_TEMPERATURE_${critical ? "CRITICAL" : "HIGH"}`, severity: critical ? "critical" : "warning", confidence: 0.96, message: `${kind === "esc" ? "ESC" : kind[0].toUpperCase() + kind.slice(1)} temperature is ${critical ? "critical" : "high"}`, evidence: [{ signal, value, unit: "\xB0C", threshold: critical ? criticalLimit : warning, description: "Measured temperature exceeds the configured limit" }], suggestedAction: "Reduce load and land safely to inspect cooling and hardware condition" });
    }
  };

  // live-viewer/src/analysis/detectors/status-text-detector.ts
  var IMPORTANT_PATTERN = /failsafe|failure|failed|critical|emergency|crash|ekf|vibration|temperature high|overheat|motor error|esc error|battery (low|critical|failed)|gps (lost|glitch|failed)/i;
  var StatusTextFaultDetector = class {
    constructor(config = {}) {
      __publicField(this, "id", "vehicle-status");
      __publicField(this, "systemLatch", new ConditionLatch());
      __publicField(this, "config");
      __publicField(this, "textAlert");
      __publicField(this, "textActive", false);
      this.config = { ...DEFAULT_STATUS_TEXT_DETECTOR_CONFIG, ...config };
    }
    evaluate(sample) {
      const findings = [];
      const systemStatus = sample.values["flight.system_status"];
      if (systemStatus !== void 0) {
        const abnormal = systemStatus >= 5;
        const state = this.systemLatch.update(abnormal, sample.timestampMs, 0, 2e3);
        if (state.cleared) findings.push({ status: "cleared", key: "system-failsafe" });
        if (state.active) {
          const critical = systemStatus >= 6;
          findings.push({ status: "active", key: "system-failsafe", faultType: critical ? "VEHICLE_EMERGENCY_STATE" : "VEHICLE_CRITICAL_STATE", severity: critical ? "critical" : "warning", confidence: 0.99, message: critical ? "Vehicle reports an emergency or termination state" : "Vehicle reports a critical system state", evidence: [{ signal: "flight.system_status", value: systemStatus, unit: "enum", threshold: 5, description: "MAVLink system status is critical or worse" }], suggestedAction: "Follow the vehicle failsafe procedure and land as soon as safely possible" });
        }
      }
      const text = sample.textValues?.["status.text"];
      const severityCode = sample.values["status.severity"];
      if (text && severityCode !== void 0 && (severityCode <= 3 || IMPORTANT_PATTERN.test(text))) {
        this.textAlert = { text, severityCode, seenAtMs: sample.timestampMs };
      }
      if (this.textAlert) {
        const expired = sample.timestampMs - this.textAlert.seenAtMs > this.config.activeDurationMs;
        if (expired) {
          if (this.textActive) findings.push({ status: "cleared", key: "important-text" });
          this.textActive = false;
          this.textAlert = void 0;
        } else {
          this.textActive = true;
          const severity = mapMavSeverity(this.textAlert.severityCode);
          findings.push({ status: "active", key: "important-text", faultType: "IMPORTANT_STATUS_TEXT", severity, confidence: this.textAlert.severityCode <= 3 ? 0.98 : 0.85, message: this.textAlert.text, evidence: [{ signal: "status.severity", value: this.textAlert.severityCode, unit: "enum", threshold: 3, description: "Vehicle status message is important by severity or safety keyword" }], suggestedAction: "Review the vehicle message and follow the applicable failsafe or maintenance procedure" });
        }
      }
      return findings;
    }
    reset() {
      this.systemLatch.reset();
      this.textAlert = void 0;
      this.textActive = false;
    }
  };
  function mapMavSeverity(code) {
    if (code <= 2) return "critical";
    if (code <= 4) return "warning";
    return "caution";
  }

  // live-viewer/src/analysis/models/anomaly-model.json
  var anomaly_model_default = {
    version: "skyforge-anomaly-1.0.0",
    features: ["battery_voltage_v", "gps_satellites", "vibration_peak_mps2", "attitude_error_rad", "high_throttle_descent", "ekf_max_variance", "motor_rpm_deviation", "attitude_age_ms"],
    means: [12.3, 14, 5, 0.04, 0, 0.2, 0.01, 0],
    scales: [1, 5, 20, 0.4, 2, 1, 0.2, 2e3],
    weights: [-1.381817, -1.400125, 1.844056, 1.635607, 1.46747, 1.556042, 1.816929, 1.638852],
    bias: -1.400862,
    threshold: 0.75
  };

  // live-viewer/src/analysis/detectors/ml-anomaly-detector.ts
  var MlAnomalyDetector = class {
    constructor(artifact = anomaly_model_default) {
      __publicField(this, "id", "ml-anomaly");
      __publicField(this, "latch", new ConditionLatch());
      __publicField(this, "latest", /* @__PURE__ */ new Map());
      __publicField(this, "model");
      __publicField(this, "startedAtMs");
      this.model = validateArtifact(artifact);
    }
    evaluate(sample) {
      if (!this.model) return [];
      this.startedAtMs ?? (this.startedAtMs = sample.timestampMs);
      this.capture(sample);
      if (sample.timestampMs - this.startedAtMs < 2e3) return [];
      const extracted = this.extract(sample.timestampMs);
      if (!extracted) return [];
      const score = sigmoid(this.model.bias + extracted.values.reduce((sum, value, index) => sum + (value - this.model.means[index]) / this.model.scales[index] * this.model.weights[index], 0));
      const state = this.latch.update(score >= this.model.threshold, sample.timestampMs, 1e3, 2e3);
      if (state.cleared) return [{ status: "cleared", key: "flight-anomaly" }];
      if (!state.active) return [];
      const ranked = extracted.contributions.sort((a, b) => Math.abs(b.value) - Math.abs(a.value)).slice(0, 3);
      return [{
        status: "active",
        key: "flight-anomaly",
        faultType: "ML_FLIGHT_ANOMALY",
        severity: score >= 0.95 ? "warning" : "caution",
        confidence: score,
        message: `Unusual combined flight behaviour detected (${this.model.version})`,
        evidence: ranked.map((item) => ({ signal: `ml.${item.name}`, value: item.raw, unit: item.unit, threshold: this.model.threshold, description: `Model contribution ${item.value.toFixed(2)}` })),
        suggestedAction: "Review the supporting signals and rule-based findings; inspect the aircraft if the anomaly repeats"
      }];
    }
    reset() {
      this.latch.reset();
      this.latest.clear();
      this.startedAtMs = void 0;
    }
    capture(sample) {
      for (const [key, value] of Object.entries(sample.values)) this.latest.set(key, { value, at: sample.timestampMs });
    }
    extract(now) {
      const get = (key, fallback) => this.latest.get(key)?.value ?? fallback;
      const attitudeAt = Math.max(this.latest.get("attitude.roll_rad")?.at ?? now, this.latest.get("attitude.pitch_rad")?.at ?? now);
      const attitudeError = Math.max(
        Math.abs(get("attitude.target_roll_rad", get("attitude.roll_rad", 0)) - get("attitude.roll_rad", 0)),
        Math.abs(get("attitude.target_pitch_rad", get("attitude.pitch_rad", 0)) - get("attitude.pitch_rad", 0))
      );
      const vibration = Math.max(...["x", "y", "z"].map((axis) => Math.abs(get(`vibration.${axis}_mps2`, 5))));
      const variances = [...this.latest.entries()].filter(([key]) => key.startsWith("ekf.") && key.endsWith("_variance")).map(([, entry]) => entry.value);
      const rpms = [...this.latest.entries()].filter(([key]) => /^esc\.\d+\.rpm$/.test(key)).map(([, entry]) => Math.abs(entry.value));
      const rpmMean = rpms.length ? rpms.reduce((sum, rpm) => sum + rpm, 0) / rpms.length : 0;
      const rpmDeviation = rpms.length >= 2 && rpmMean > 0 ? Math.max(...rpms.map((rpm) => Math.abs(rpm - rpmMean))) / rpmMean : 0.01;
      const throttle = get("throttle.pct", 0);
      const descent = get("velocity.down_mps", -get("velocity.climb_mps", 0));
      const values = [get("battery.voltage_v", 12.3), get("gps.satellites", 14), vibration, attitudeError, throttle >= 70 ? Math.max(0, descent) : 0, variances.length ? Math.max(...variances) : 0.2, rpmDeviation, Math.max(0, now - attitudeAt)];
      const units = ["V", "count", "m/s\xB2", "rad", "m/s", "variance", "ratio", "ms"];
      const contributions = values.map((raw, index) => ({ name: this.model.features[index], raw, unit: units[index], value: (raw - this.model.means[index]) / this.model.scales[index] * this.model.weights[index] }));
      return { values, contributions };
    }
  };
  function validateArtifact(value) {
    if (!value || typeof value !== "object") return null;
    const model = value;
    const length = model.features?.length;
    if (!model.version || !length || model.means?.length !== length || model.scales?.length !== length || model.weights?.length !== length) return null;
    if (![...model.means, ...model.scales, ...model.weights, model.bias, model.threshold].every(Number.isFinite) || model.scales.some((scale) => scale <= 0)) return null;
    return model;
  }
  function sigmoid(value) {
    return 1 / (1 + Math.exp(-Math.max(-30, Math.min(30, value))));
  }

  // live-viewer/src/analysis/default-detectors.ts
  function createDefaultFaultDetectors() {
    return [
      new BatteryFaultDetector(),
      new GpsFaultDetector(),
      new CommunicationFaultDetector(),
      new VibrationFaultDetector(),
      new AttitudeFaultDetector(),
      new AltitudeLossFaultDetector(),
      new EkfFaultDetector(),
      new SensorStalenessFaultDetector(),
      new MotorImbalanceFaultDetector(),
      new TemperatureFaultDetector(),
      new StatusTextFaultDetector(),
      new MlAnomalyDetector()
    ];
  }

  // saved-log-viewer/ai-entry.ts
  var numberValue = (record, ...names) => {
    for (const name of names) {
      const value = record.values[name];
      if (typeof value === "number" && Number.isFinite(value)) return value;
    }
    return void 0;
  };
  var put = (values, units, key, value, unit) => {
    if (value !== void 0 && Number.isFinite(value)) {
      values[key] = value;
      units[key] = unit;
    }
  };
  var DataFlashTelemetryAdapter = class {
    constructor() {
      __publicField(this, "phase", "unknown");
      __publicField(this, "escRpm", /* @__PURE__ */ new Map());
    }
    normalize(record) {
      const values = {};
      const units = {};
      const textValues = {};
      const name = record.name.toUpperCase();
      const instance = record.instance ?? numberValue(record, "Instance", "I", "IMU") ?? 0;
      if (name === "BAT" || name === "CURR") {
        put(values, units, "battery.voltage_v", numberValue(record, "Volt", "Voltage"), "V");
        put(values, units, "battery.current_a", numberValue(record, "Curr", "Current"), "A");
        put(values, units, "battery.temperature_c", numberValue(record, "Temp"), "\xB0C");
      } else if (name === "GPS" || name === "GPS2") {
        put(values, units, "gps.fix_type", numberValue(record, "Status"), "enum");
        put(values, units, "gps.satellites", numberValue(record, "NSats", "Sats"), "count");
        const hdop = numberValue(record, "HDop");
        put(values, units, "gps.hdop", hdop !== void 0 && hdop > 20 ? hdop / 100 : hdop, "ratio");
        put(values, units, "position.altitude_m", numberValue(record, "Alt"), "m");
        put(values, units, "velocity.down_mps", numberValue(record, "VZ"), "m/s");
        const speed = numberValue(record, "Spd");
        if ((speed ?? 0) > 1) this.phase = "flying";
      } else if (name === "ATT") {
        const radians = Math.PI / 180;
        put(values, units, "attitude.roll_rad", numberValue(record, "Roll") * radians, "rad");
        put(values, units, "attitude.pitch_rad", numberValue(record, "Pitch") * radians, "rad");
        put(values, units, "attitude.target_roll_rad", numberValue(record, "DesRoll", "RollDes") * radians, "rad");
        put(values, units, "attitude.target_pitch_rad", numberValue(record, "DesPitch", "PitchDes") * radians, "rad");
      } else if (name === "VIBE") {
        put(values, units, "vibration.x_mps2", numberValue(record, "VibeX"), "m/s\xB2");
        put(values, units, "vibration.y_mps2", numberValue(record, "VibeY"), "m/s\xB2");
        put(values, units, "vibration.z_mps2", numberValue(record, "VibeZ"), "m/s\xB2");
        put(values, units, "imu.clipping_0", numberValue(record, "Clip0", "Clip"), "count");
        put(values, units, "imu.clipping_1", numberValue(record, "Clip1"), "count");
        put(values, units, "imu.clipping_2", numberValue(record, "Clip2"), "count");
      } else if (name === "CTUN") {
        const throttle = numberValue(record, "ThO", "ThrOut");
        put(values, units, "throttle.pct", throttle !== void 0 && throttle <= 1.5 ? throttle * 100 : throttle, "%");
        const climb = numberValue(record, "CRt", "ClimbRate");
        put(values, units, "velocity.climb_mps", climb !== void 0 && Math.abs(climb) > 30 ? climb / 100 : climb, "m/s");
        if ((throttle ?? 0) > 0.2) this.phase = "flying";
      } else if (name === "BARO") {
        put(values, units, "position.altitude_m", numberValue(record, "Alt"), "m");
        put(values, units, "imu.temperature_c", numberValue(record, "Temp"), "\xB0C");
      } else if (name === "IMU") {
        put(values, units, "imu.temperature_c", numberValue(record, "T", "Temp"), "\xB0C");
      } else if (name === "ESC") {
        const rpm = numberValue(record, "RPM");
        if (rpm !== void 0) this.escRpm.set(instance, rpm);
        for (const [motor, latestRpm] of this.escRpm) put(values, units, `esc.${motor}.rpm`, latestRpm, "rpm");
        put(values, units, `esc.${instance}.temperature_c`, numberValue(record, "Temp"), "\xB0C");
      } else if (name === "XKF4" || name === "NKF4" || name === "EKF") {
        put(values, units, "ekf.velocity_variance", numberValue(record, "SV", "VelVar"), "variance");
        put(values, units, "ekf.position_variance", numberValue(record, "SP", "PosVar"), "variance");
        put(values, units, "ekf.height_variance", numberValue(record, "SH", "HgtVar"), "variance");
        put(values, units, "ekf.compass_variance", numberValue(record, "SM", "MagVar"), "variance");
        put(values, units, "ekf.flags", numberValue(record, "FS", "Flags"), "bitmask");
      } else if (name === "MSG") {
        const message = record.values.Message ?? record.values.Msg;
        if (typeof message === "string") textValues["status.text"] = message;
        values["status.severity"] = 4;
        units["status.severity"] = "enum";
      } else if (name === "ERR") {
        const subsystem = numberValue(record, "Subsys") ?? -1;
        const code = numberValue(record, "ECode") ?? -1;
        textValues["status.text"] = `DataFlash error: subsystem ${subsystem}, code ${code}`;
        values["status.severity"] = 2;
        units["status.severity"] = "enum";
      }
      return { timestampMs: record.timestampMs, source: "dataflash", values, units, textValues, flightPhase: this.phase };
    }
  };
  function analyzeDataFlashRecords(records) {
    if (!Array.isArray(records) || records.length === 0) throw new Error("The BIN file contains no timestamped DataFlash records.");
    const engine = new FaultDetectionEngine(createDefaultFaultDetectors());
    const adapter = new DataFlashTelemetryAdapter();
    const faults = /* @__PURE__ */ new Map();
    engine.onFaultEvent((event) => faults.set(event.fault.id, { ...event.fault, evidence: [...event.fault.evidence] }));
    for (const record of records) engine.processSample(adapter.normalize(record));
    const result = [...faults.values()].sort((a, b) => a.startedAtMs - b.startedAtMs);
    const penalty = { info: 2, caution: 5, warning: 12, critical: 25 };
    const healthScore = Math.max(0, 100 - result.reduce((sum, fault) => sum + penalty[fault.severity], 0));
    return { faults: result, analyzedRecords: records.length, startedAtMs: records[0].timestampMs, endedAtMs: records.at(-1).timestampMs, healthScore };
  }
  if (typeof window !== "undefined") window.SkyForgeAI = { analyzeDataFlashRecords };
})();
