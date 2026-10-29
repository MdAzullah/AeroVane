import { beforeEach, describe, expect, it } from 'vitest';
import type { FaultEvent, FaultRecord } from '../../analysis';
import {
  acknowledgeFault,
  appState,
  applyFaultEvent,
  clearFaultHistory,
  beginFaultAnalysis,
  buildFaultAnalysisExport,
  completeFaultAnalysis,
  requestFaultNavigation,
  selectFaultHealthScore,
  setAppState,
  resetFaultState,
  selectHighestFaultSeverity,
} from '../app-store';

function record(overrides: Partial<FaultRecord> = {}): FaultRecord {
  return {
    id: 'fault-1', key: 'low-voltage', detectorId: 'battery',
    faultType: 'BATTERY_VOLTAGE_LOW', severity: 'warning', state: 'active',
    confidence: 0.92, message: 'Battery voltage is low', evidence: [],
    suggestedAction: 'Prepare to land', startedAtMs: 1_000, updatedAtMs: 1_000,
    ...overrides,
  };
}

function apply(type: FaultEvent['type'], fault: FaultRecord): void {
  applyFaultEvent({ type, fault });
}

describe('fault application state', () => {
  beforeEach(resetFaultState);

  it('creates and updates one active fault without duplication', () => {
    apply('created', record());
    apply('updated', record({ severity: 'critical', updatedAtMs: 2_000 }));

    expect(appState.activeFaults).toHaveLength(1);
    expect(appState.activeFaults[0]).toMatchObject({ severity: 'critical', updatedAtMs: 2_000 });
    expect(selectHighestFaultSeverity()).toBe('critical');
  });

  it('preserves acknowledgement across worker updates', () => {
    apply('created', record());
    acknowledgeFault('fault-1');
    apply('updated', record({ updatedAtMs: 2_000 }));

    expect(appState.activeFaults[0].acknowledged).toBe(true);
  });

  it('moves cleared faults to history and can clear history', () => {
    apply('created', record());
    apply('cleared', record({ state: 'cleared', updatedAtMs: 3_000, clearedAtMs: 3_000 }));

    expect(appState.activeFaults).toEqual([]);
    expect(appState.faultHistory).toHaveLength(1);
    expect(appState.faultHistory[0].state).toBe('cleared');
    clearFaultHistory();
    expect(appState.faultHistory).toEqual([]);
  });

  it('resets active faults and history for a new session', () => {
    apply('created', record());
    apply('cleared', record({ state: 'cleared', clearedAtMs: 2_000 }));
    resetFaultState();
    expect(appState.activeFaults).toEqual([]);
    expect(appState.faultHistory).toEqual([]);
    expect(selectHighestFaultSeverity()).toBe('normal');
  });

  it('replaces state with a completed saved-log timeline and health summary', () => {
    beginFaultAnalysis(2_000);
    expect(appState.faultAnalysisStatus).toBe('analyzing');
    completeFaultAnalysis({
      faults: [
        record({ id: 'cleared', state: 'cleared', clearedAtMs: 3_000 }),
        record({ id: 'active', severity: 'critical' }),
      ],
      analyzedMessages: 1_500,
      startedAtMs: 1_000,
      endedAtMs: 20_000,
    });

    expect(appState.faultAnalysisStatus).toBe('complete');
    expect(appState.activeFaults.map(fault => fault.id)).toEqual(['active']);
    expect(appState.faultHistory.map(fault => fault.id)).toEqual(['cleared']);
    expect(appState.faultAnalysisMessageCount).toBe(1_500);
    expect(selectFaultHealthScore()).toBe(63);
  });

  it('builds a JSON-safe report and requests graph navigation', () => {
    setAppState('logViewerState', { isActive: true, sourceName: 'flight.tlog', durationSec: 10, recordCount: 2 });
    completeFaultAnalysis({ faults: [record()], analyzedMessages: 2, startedAtMs: 1_000, endedAtMs: 2_000 });
    const report = buildFaultAnalysisExport() as { source: string; faults: Array<Record<string, unknown>> };
    expect(report.source).toBe('flight.tlog');
    expect(report.faults).toHaveLength(1);
    expect(report.faults[0]).not.toHaveProperty('acknowledged');

    const requestBefore = appState.faultNavigationRequest;
    requestFaultNavigation(1_500);
    expect(appState.activeTab).toBe('telemetry');
    expect(appState.faultNavigationTargetMs).toBe(1_500);
    expect(appState.faultNavigationRequest).toBe(requestBefore + 1);
  });
});
