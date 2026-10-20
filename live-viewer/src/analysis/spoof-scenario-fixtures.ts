import type { TelemetrySample } from './types';
import type { SpoofScenarioId } from '../services/spoof-scenarios';
import { createCommunicationWatchdogSample } from './watchdog-sample';

/** Deterministic detector-level replay fixture matching the selectable simulator scenarios. */
export function createSpoofScenarioReplay(scenario: SpoofScenarioId): TelemetrySample[] {
  const samples: TelemetrySample[] = [];
  for (let timestampMs = 0; timestampMs <= 10_000; timestampMs += 1_000) {
    const active = timestampMs >= 5_000;
    const values: Record<string, number> = {
      'flight.base_mode': 129,
      'battery.voltage_v': active && scenario === 'battery' ? 9.5 : 12.3,
      'gps.fix_type': active && scenario === 'gps' ? 1 : 3,
      'gps.satellites': active && scenario === 'gps' ? 3 : 14,
      'gps.hdop': active && scenario === 'gps' ? 9 : 0.9,
      'vibration.x_mps2': active && scenario === 'vibration' ? 70 : 4,
      'vibration.y_mps2': active && scenario === 'vibration' ? 65 : 5,
      'vibration.z_mps2': active && scenario === 'vibration' ? 75 : 6,
      'attitude.target_roll_rad': active && scenario === 'attitude' ? 1 : 0.05,
      'attitude.target_pitch_rad': active && scenario === 'attitude' ? 0.7 : 0.03,
      'throttle.pct': active && scenario === 'altitude' ? 90 : 50,
      'velocity.down_mps': active && scenario === 'altitude' ? 4 : 0,
      'ekf.velocity_variance': active && scenario === 'ekf' ? 3 : 0.2,
      'esc.0.rpm': 3000, 'esc.1.rpm': 3000,
      'esc.2.rpm': active && scenario === 'motor' ? 1000 : 2980,
      'esc.3.rpm': 3020,
    };
    if (!(active && scenario === 'frozen')) {
      values['attitude.roll_rad'] = 0.05 + timestampMs / 1_000_000;
      values['attitude.pitch_rad'] = 0.03 + timestampMs / 1_000_000;
    }
    if (active && scenario === 'link') {
      samples.push(createCommunicationWatchdogSample(timestampMs, 'simulation', 'flying'));
    } else {
      samples.push({ timestampMs, source: 'simulation', flightPhase: 'flying', values });
    }
  }
  return samples;
}
