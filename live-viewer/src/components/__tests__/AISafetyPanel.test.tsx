import { beforeEach, describe, expect, it } from 'vitest';
import { render } from 'solid-js/web';
import AISafetyPanel from '../AISafetyPanel';
import { appState, applyFaultEvent, completeFaultAnalysis, resetFaultState, setAppState } from '../../store';

function createWarning(): void {
  applyFaultEvent({
    type: 'created',
    fault: {
      id: 'fault-1', key: 'fix', detectorId: 'gps', faultType: 'GPS_FIX_INVALID',
      severity: 'warning', state: 'active', confidence: 0.96,
      message: 'GPS does not have a valid 3D fix',
      evidence: [{ signal: 'gps.fix_type', value: 2, unit: 'enum', threshold: 3, description: 'GPS fix type is below the configured minimum' }],
      suggestedAction: 'Wait for a stable GPS fix', startedAtMs: 1_000, updatedAtMs: 1_000,
    },
  });
}

describe('AISafetyPanel', () => {
  beforeEach(() => {
    document.body.innerHTML = '';
    resetFaultState();
    setAppState('aiSafetySoundEnabled', false);
    setAppState('logViewerState', { isActive: false, sourceName: '', durationSec: 0, recordCount: 0 });
  });

  it('shows saved-log health, timeline, and graph navigation controls', async () => {
    const dispose = render(() => <AISafetyPanel />, document.body);
    setAppState('logViewerState', { isActive: true, sourceName: 'fault-flight.tlog', durationSec: 30, recordCount: 10 });
    completeFaultAnalysis({
      faults: [{
        id: 'log-fault', key: 'fix', detectorId: 'gps', faultType: 'GPS_FIX_INVALID',
        severity: 'warning', state: 'cleared', confidence: 0.96,
        message: 'GPS fix lost', evidence: [], suggestedAction: 'Land safely',
        startedAtMs: 5_000, updatedAtMs: 8_000, clearedAtMs: 8_000,
      }],
      analyzedMessages: 42,
      startedAtMs: 1_000,
      endedAtMs: 31_000,
    });
    await Promise.resolve();

    expect(document.body.textContent).toContain('Flight health 88/100');
    expect(document.body.textContent).toContain('1 detected fault episodes');
    expect(document.body.textContent).toContain('GPS fix lost');
    expect(document.body.textContent).toContain('+0:04');
    const navigate = Array.from(document.querySelectorAll('button')).find(item => item.textContent?.includes('Show on graphs')) as HTMLButtonElement;
    navigate.click();
    expect(appState.faultNavigationTargetMs).toBe(5_000);
    dispose();
  });

  it('shows normal status with no active faults', () => {
    const dispose = render(() => <AISafetyPanel />, document.body);
    expect(document.body.textContent).toContain('NORMAL');
    dispose();
  });

  it('auto-expands a warning with evidence and supports acknowledgement', async () => {
    const dispose = render(() => <AISafetyPanel />, document.body);
    createWarning();
    await Promise.resolve();

    expect(document.body.textContent).toContain('WARNING');
    expect(document.body.textContent).toContain('GPS does not have a valid 3D fix');
    expect(document.body.textContent).toContain('limit 3 enum');
    const button = Array.from(document.querySelectorAll('button')).find(item => item.textContent?.includes('Acknowledge')) as HTMLButtonElement;
    button.click();
    expect(appState.activeFaults[0].acknowledged).toBe(true);
    expect(document.body.textContent).toContain('Acknowledged');
    dispose();
  });

  it('shows cleared warnings in history and clears them', async () => {
    const dispose = render(() => <AISafetyPanel />, document.body);
    createWarning();
    applyFaultEvent({
      type: 'cleared',
      fault: { ...appState.activeFaults[0], state: 'cleared', updatedAtMs: 2_000, clearedAtMs: 2_000 },
    });
    await Promise.resolve();
    const historyTab = Array.from(document.querySelectorAll('button')).find(item => item.textContent?.includes('History')) as HTMLButtonElement;
    historyTab.click();
    expect(document.body.textContent).toContain('GPS does not have a valid 3D fix');
    const clear = Array.from(document.querySelectorAll('button')).find(item => item.textContent?.includes('Clear history')) as HTMLButtonElement;
    clear.click();
    expect(appState.faultHistory).toEqual([]);
    dispose();
  });
});
