import { describe, expect, it } from 'vitest';
import { presentFaultNotification } from '../fault-presentation';

describe('presentFaultNotification', () => {
  it('turns detector fields into a clear actionable warning', () => {
    const result = presentFaultNotification({
      detectorId: 'gps', faultType: 'GPS_FIX_INVALID', severity: 'warning',
      message: 'GPS does not have a valid 3D fix', suggestedAction: 'Wait for a stable GPS fix; land safely if navigation remains unreliable',
      evidence: [{ signal: 'gps.fix_type', value: 2, unit: 'enum', threshold: 3, description: 'Below required fix type' }],
    });
    expect(result.title).toBe('GPS position lock lost');
    expect(result.urgency).toContain('land as soon as it is safe');
    expect(result.actions).toHaveLength(2);
    expect(result.evidence[0].label).toBe('GPS fix quality');
    expect(result.sourceLabel).toBe('Telemetry safety rule');
  });

  it('clearly labels ML findings as advisory and adds confirmation guidance', () => {
    const result = presentFaultNotification({
      detectorId: 'real-ml-anomaly', faultType: 'ML_FLIGHT_ANOMALY', severity: 'caution',
      message: 'Advisory anomaly', suggestedAction: 'Inspect telemetry', evidence: [],
    });
    expect(result.title).toBe('Unusual flight behaviour detected');
    expect(result.sourceLabel).toBe('AI-assisted advisory');
    expect(result.actions.at(-1)).toContain('not a confirmed diagnosis');
  });
});
