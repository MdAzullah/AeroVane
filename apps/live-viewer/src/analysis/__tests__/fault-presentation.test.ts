import { describe, expect, it } from 'vitest';
import { presentFaultNotification } from '../fault-presentation';

describe('presentFaultNotification', () => {
  it('turns detector fields into a clear actionable warning', () => {
    const result = presentFaultNotification({
      detectorId: 'gps', faultType: 'GPS_FIX_INVALID', severity: 'warning',
      message: 'GPS does not have a valid 3D fix', suggestedAction: 'Wait for a stable GPS fix; land safely if navigation remains unreliable',
      evidence: [{ signal: 'gps.fix_type', value: 2, unit: 'enum', threshold: 3, description: 'Below required fix type' }],
    });
    expect(result.title).toBe('GPS position lost');
    expect(result.summary).toContain('does not know where it is');
    expect(result.reading).toBe('GPS fix type 2 (limit 3)');
    expect(result.urgencyLabel).toBe('Do now');
    expect(result.urgency).toBe('Land as soon as it is safe.');
    expect(result.actions).toHaveLength(2);
    expect(result.evidence[0].label).toBe('GPS fix type');
    expect(result.sourceLabel).toBe('Safety rule');
    expect(result.note).toBeUndefined();
  });

  it('gives inspection steps instead of flying instructions after the flight', () => {
    const result = presentFaultNotification({
      detectorId: 'battery', faultType: 'BATTERY_VOLTAGE_CRITICAL', severity: 'critical',
      message: 'Battery voltage is critically low', suggestedAction: 'Land immediately in the nearest safe area',
      evidence: [{ signal: 'battery.voltage_v', value: 13.04, unit: 'V', threshold: 13.2, description: 'Below limit' }],
    }, 'post-flight');
    expect(result.urgencyLabel).toBe('Next step');
    expect(result.urgency).toBe('Do not fly again until this is fixed.');
    expect(result.actions.join(' ')).not.toMatch(/land/i);
    expect(result.reading).toBe('Battery voltage 13.04 V (limit 13.2 V)');
  });

  it('keeps unknown faults readable and short', () => {
    const result = presentFaultNotification({
      detectorId: 'x', faultType: 'NEW_FAULT_KIND', severity: 'caution', message: 'Something odd',
      suggestedAction: 'One; two; three; four', evidence: [],
    });
    expect(result.title).toBe('New fault kind');
    expect(result.summary).toBe('Something odd');
    expect(result.actions).toEqual(['One', 'Two', 'Three']);
  });

  it('clearly labels ML findings as advisory with a short caveat', () => {
    const result = presentFaultNotification({
      detectorId: 'real-ml-anomaly', faultType: 'ML_FLIGHT_ANOMALY', severity: 'caution',
      message: 'Advisory anomaly', suggestedAction: 'Inspect telemetry', evidence: [],
    });
    expect(result.title).toBe('Unusual flight behaviour');
    expect(result.sourceLabel).toBe('AI advisory');
    expect(result.note).toContain('not a confirmed fault');
  });
});
