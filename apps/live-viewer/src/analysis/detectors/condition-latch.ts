export interface ConditionLatchResult {
  active: boolean;
  activated: boolean;
  cleared: boolean;
}

/** Time-based debounce and recovery hysteresis shared by fault detectors. */
export class ConditionLatch {
  private active = false;
  private badSinceMs: number | undefined;
  private goodSinceMs: number | undefined;

  update(isBad: boolean, timestampMs: number, activationDelayMs: number, recoveryDelayMs: number): ConditionLatchResult {
    let activated = false;
    let cleared = false;

    if (isBad) {
      this.goodSinceMs = undefined;
      this.badSinceMs ??= timestampMs;
      if (!this.active && timestampMs - this.badSinceMs >= activationDelayMs) {
        this.active = true;
        activated = true;
      }
    } else {
      this.badSinceMs = undefined;
      this.goodSinceMs ??= timestampMs;
      if (this.active && timestampMs - this.goodSinceMs >= recoveryDelayMs) {
        this.active = false;
        cleared = true;
      }
    }

    return { active: this.active, activated, cleared };
  }

  reset(): void {
    this.active = false;
    this.badSinceMs = undefined;
    this.goodSinceMs = undefined;
  }
}
