import { batch } from 'solid-js';
import { createStore } from 'solid-js/store';
import type {
  ConnectionStatus,
  BaudRate,
  UnitProfile,
  LogViewerState,
  MapLayerType,
} from '../services';
import { DEFAULT_BAUD_RATE, DEFAULT_SETTINGS } from '../services';
import type { PlotTab, TimeWindow } from '../models';
import { DEFAULT_TIME_WINDOW } from '../models';
import type { FaultEvent, FaultRecord, FaultSeverity } from '../analysis';

export interface AppFaultRecord extends FaultRecord {
  acknowledged: boolean;
}

export interface AppState {
  connectionStatus: ConnectionStatus;
  theme: 'dark' | 'light';
  debugConsoleEnabled: boolean;
  uiScale: number;
  unitProfile: UnitProfile;
  activeTab: string;
  activeSubTab: string;
  plotTabs: PlotTab[];
  isPaused: boolean;
  isReady: boolean;
  baudRate: BaudRate;
  bufferCapacity: number;
  isSettingsOpen: boolean;
  isHelpOpen: boolean;
  timeWindow: TimeWindow;
  addPlotCounter: number;
  mapShowPath: boolean;
  mapTrailLength: number;
  mapLayer: MapLayerType;
  mapZoom: number;
  mapCenterLat: number;
  mapCenterLon: number;
  mapAutoCenter: boolean;
  sidebarCollapsed: boolean;
  sidebarWidth: number;
  isLogPaneCollapsed: boolean;
  offlineReady: boolean;
  offlineStatus: 'checking' | 'ready' | 'error' | 'unsupported';
  offlineError: string | null;
  logsVersion: number;
  logViewerState: LogViewerState;
  dialectName: string;
  connectionSourceType: 'serial' | 'spoof' | null;
  pendingConnectionSourceType: 'serial' | 'spoof' | null;
  autoConnect: boolean;
  autoDetectBaud: boolean;
  probeStatus: string | null;
  webusbAvailability: 'unknown' | 'needs_grant' | 'needs_regrant_android' | 'waiting_for_device' | 'granted';
  lastPortVendorId: number | null;
  lastPortProductId: number | null;
  lastPortSerialNumber: string | null;
  lastSuccessfulBaudRate: BaudRate | null;
  connectedBaudRate: BaudRate | null;
  throughputBytesPerSec: number;
  updateAvailable: boolean;
  activeFaults: AppFaultRecord[];
  faultHistory: AppFaultRecord[];
  aiSafetySoundEnabled: boolean;
  faultAnalysisStatus: 'idle' | 'analyzing' | 'complete';
  faultAnalysisRecordCount: number;
  faultAnalysisMessageCount: number;
  faultAnalysisStartedAtMs: number;
  faultAnalysisEndedAtMs: number;
  faultNavigationTargetMs: number | null;
  faultNavigationRequest: number;
}

export function createInitialAppState(): AppState {
  return {
    connectionStatus: 'disconnected',
    activeTab: DEFAULT_SETTINGS.activeTab,
    theme: DEFAULT_SETTINGS.theme,
    debugConsoleEnabled: DEFAULT_SETTINGS.debugConsoleEnabled,
    uiScale: DEFAULT_SETTINGS.uiScale,
    unitProfile: DEFAULT_SETTINGS.unitProfile,
    activeSubTab: 'default',
    plotTabs: [{ id: 'default', name: 'Tab 1', plots: [] }],
    isPaused: false,
    isReady: false,
    baudRate: DEFAULT_BAUD_RATE,
    bufferCapacity: DEFAULT_SETTINGS.bufferCapacity,
    isSettingsOpen: false,
    isHelpOpen: false,
    timeWindow: DEFAULT_TIME_WINDOW,
    addPlotCounter: 0,
    mapShowPath: DEFAULT_SETTINGS.mapShowPath,
    mapTrailLength: DEFAULT_SETTINGS.mapTrailLength,
    mapLayer: DEFAULT_SETTINGS.mapLayer,
    mapZoom: DEFAULT_SETTINGS.mapZoom,
    mapCenterLat: DEFAULT_SETTINGS.mapCenterLat,
    mapCenterLon: DEFAULT_SETTINGS.mapCenterLon,
    mapAutoCenter: DEFAULT_SETTINGS.mapAutoCenter,
    sidebarCollapsed: DEFAULT_SETTINGS.sidebarCollapsed,
    sidebarWidth: DEFAULT_SETTINGS.sidebarWidth,
    isLogPaneCollapsed: true,
    offlineReady: false,
    offlineStatus: 'checking',
    offlineError: null,
    logsVersion: 0,
    logViewerState: {
      isActive: false,
      sourceName: '',
      durationSec: 0,
      recordCount: 0,
    },
    dialectName: '',
    connectionSourceType: null,
    pendingConnectionSourceType: null,
    autoConnect: DEFAULT_SETTINGS.autoConnect,
    autoDetectBaud: DEFAULT_SETTINGS.autoDetectBaud,
    probeStatus: null,
    webusbAvailability: 'unknown',
    lastPortVendorId: DEFAULT_SETTINGS.lastPortVendorId,
    lastPortProductId: DEFAULT_SETTINGS.lastPortProductId,
    lastPortSerialNumber: DEFAULT_SETTINGS.lastPortSerialNumber,
    lastSuccessfulBaudRate: DEFAULT_SETTINGS.lastSuccessfulBaudRate,
    connectedBaudRate: null,
    throughputBytesPerSec: 0,
    updateAvailable: false,
    activeFaults: [],
    faultHistory: [],
    aiSafetySoundEnabled: false,
    faultAnalysisStatus: 'idle',
    faultAnalysisRecordCount: 0,
    faultAnalysisMessageCount: 0,
    faultAnalysisStartedAtMs: 0,
    faultAnalysisEndedAtMs: 0,
    faultNavigationTargetMs: null,
    faultNavigationRequest: 0,
  };
}

const MAX_FAULT_HISTORY = 200;

/** Apply one worker fault event while preserving local acknowledgement state. */
export function applyFaultEvent(event: FaultEvent): void {
  const existing = appState.activeFaults.find(fault => fault.id === event.fault.id);
  const managed: AppFaultRecord = {
    ...event.fault,
    evidence: event.fault.evidence.map(item => ({ ...item })),
    acknowledged: existing?.acknowledged ?? false,
  };

  if (event.type === 'cleared') {
    batch(() => {
      setAppState('activeFaults', faults => faults.filter(fault => fault.id !== event.fault.id));
      setAppState('faultHistory', history => [managed, ...history].slice(0, MAX_FAULT_HISTORY));
    });
    return;
  }

  const index = appState.activeFaults.findIndex(fault => fault.id === event.fault.id);
  if (index === -1) setAppState('activeFaults', faults => [...faults, managed]);
  else setAppState('activeFaults', index, managed);
}

export function acknowledgeFault(faultId: string): void {
  const index = appState.activeFaults.findIndex(fault => fault.id === faultId);
  if (index !== -1) setAppState('activeFaults', index, 'acknowledged', true);
}

export function clearFaultHistory(): void {
  setAppState('faultHistory', []);
}

/** A new live connection clears both active and previous-session fault state. */
export function resetFaultState(): void {
  batch(() => {
    setAppState('activeFaults', []);
    setAppState('faultHistory', []);
    setAppState('faultAnalysisStatus', 'idle');
    setAppState('faultAnalysisRecordCount', 0);
    setAppState('faultAnalysisMessageCount', 0);
    setAppState('faultAnalysisStartedAtMs', 0);
    setAppState('faultAnalysisEndedAtMs', 0);
    setAppState('faultNavigationTargetMs', null);
  });
}

export function beginFaultAnalysis(recordCount: number): void {
  batch(() => {
    setAppState('activeFaults', []);
    setAppState('faultHistory', []);
    setAppState('faultAnalysisStatus', 'analyzing');
    setAppState('faultAnalysisRecordCount', Math.max(0, recordCount));
    setAppState('faultAnalysisMessageCount', 0);
  });
}

export function completeFaultAnalysis(result: { faults: readonly FaultRecord[]; analyzedMessages: number; startedAtMs: number; endedAtMs: number }): void {
  const managed = result.faults.map<AppFaultRecord>(fault => ({
    ...fault,
    evidence: fault.evidence.map(item => ({ ...item })),
    acknowledged: false,
  }));
  batch(() => {
    setAppState('activeFaults', managed.filter(fault => fault.state === 'active'));
    setAppState('faultHistory', managed.filter(fault => fault.state === 'cleared').sort((a, b) => a.startedAtMs - b.startedAtMs));
    setAppState('faultAnalysisStatus', 'complete');
    setAppState('faultAnalysisMessageCount', Math.max(0, result.analyzedMessages));
    setAppState('faultAnalysisStartedAtMs', result.startedAtMs);
    setAppState('faultAnalysisEndedAtMs', result.endedAtMs);
  });
}

export function requestFaultNavigation(timestampMs: number): void {
  if (!Number.isFinite(timestampMs)) return;
  batch(() => {
    setAppState('activeTab', 'telemetry');
    setAppState('faultNavigationTargetMs', timestampMs);
    setAppState('faultNavigationRequest', value => value + 1);
  });
}

export function selectFaultHealthScore(): number {
  const penalties: Record<FaultSeverity, number> = { info: 2, caution: 5, warning: 12, critical: 25 };
  const allFaults = [...appState.faultHistory, ...appState.activeFaults];
  return Math.max(0, 100 - allFaults.reduce((total, fault) => total + penalties[fault.severity], 0));
}

export function buildFaultAnalysisExport(): object {
  return {
    schemaVersion: 1,
    source: appState.logViewerState.sourceName,
    generatedAt: new Date().toISOString(),
    analysis: {
      status: appState.faultAnalysisStatus,
      healthScore: selectFaultHealthScore(),
      analyzedMessages: appState.faultAnalysisMessageCount,
      startedAtMs: appState.faultAnalysisStartedAtMs,
      endedAtMs: appState.faultAnalysisEndedAtMs,
    },
    faults: [...appState.faultHistory, ...appState.activeFaults]
      .sort((a, b) => a.startedAtMs - b.startedAtMs)
      .map(({ acknowledged: _acknowledged, ...fault }) => fault),
  };
}

const FAULT_SEVERITY_RANK: Record<FaultSeverity, number> = {
  info: 0, caution: 1, warning: 2, critical: 3,
};

export function selectHighestFaultSeverity(): FaultSeverity | 'normal' {
  let highest: FaultSeverity | 'normal' = 'normal';
  let rank = -1;
  for (const fault of appState.activeFaults) {
    const nextRank = FAULT_SEVERITY_RANK[fault.severity];
    if (nextRank > rank) {
      highest = fault.severity;
      rank = nextRank;
    }
  }
  return highest;
}

export const [appState, setAppState] = createStore<AppState>(createInitialAppState());

type PersistedSettingsState = Pick<
  AppState,
  'activeTab' | 'theme' | 'uiScale' | 'unitProfile' | 'baudRate' | 'bufferCapacity' | 'mapShowPath' |
  'debugConsoleEnabled' |
  'mapTrailLength' | 'mapLayer' | 'mapZoom' | 'mapCenterLat' | 'mapCenterLon' | 'mapAutoCenter' | 'sidebarCollapsed' |
  'sidebarWidth' | 'autoConnect' | 'autoDetectBaud' | 'lastSuccessfulBaudRate'
  | 'lastPortVendorId' | 'lastPortProductId' | 'lastPortSerialNumber'
>;

export function applySettingsToAppState(settings: PersistedSettingsState): void {
  batch(() => {
    setAppState('activeTab', settings.activeTab);
    setAppState('theme', settings.theme);
    setAppState('debugConsoleEnabled', settings.debugConsoleEnabled);
    setAppState('uiScale', settings.uiScale);
    setAppState('unitProfile', settings.unitProfile);
    setAppState('baudRate', settings.baudRate);
    setAppState('bufferCapacity', settings.bufferCapacity);
    setAppState('mapShowPath', settings.mapShowPath);
    setAppState('mapTrailLength', settings.mapTrailLength);
    setAppState('mapLayer', settings.mapLayer);
    setAppState('mapZoom', settings.mapZoom);
    setAppState('mapCenterLat', settings.mapCenterLat);
    setAppState('mapCenterLon', settings.mapCenterLon);
    setAppState('mapAutoCenter', settings.mapAutoCenter);
    setAppState('sidebarCollapsed', settings.sidebarCollapsed);
    setAppState('sidebarWidth', settings.sidebarWidth);
    setAppState('autoConnect', settings.autoConnect);
    setAppState('autoDetectBaud', settings.autoDetectBaud);
    setAppState('lastPortVendorId', settings.lastPortVendorId);
    setAppState('lastPortProductId', settings.lastPortProductId);
    setAppState('lastPortSerialNumber', settings.lastPortSerialNumber);
    setAppState('lastSuccessfulBaudRate', settings.lastSuccessfulBaudRate);
  });
}

export function mergeAppStateIntoSettings(settings: typeof DEFAULT_SETTINGS): typeof DEFAULT_SETTINGS {
  return {
    ...settings,
    activeTab: appState.activeTab,
    theme: appState.theme,
    debugConsoleEnabled: appState.debugConsoleEnabled,
    uiScale: appState.uiScale,
    unitProfile: appState.unitProfile,
    baudRate: appState.baudRate,
    bufferCapacity: appState.bufferCapacity,
    mapShowPath: appState.mapShowPath,
    mapTrailLength: appState.mapTrailLength,
    mapLayer: appState.mapLayer,
    mapZoom: appState.mapZoom,
    mapCenterLat: appState.mapCenterLat,
    mapCenterLon: appState.mapCenterLon,
    mapAutoCenter: appState.mapAutoCenter,
    sidebarCollapsed: appState.sidebarCollapsed,
    sidebarWidth: appState.sidebarWidth,
    autoConnect: appState.autoConnect,
    autoDetectBaud: appState.autoDetectBaud,
    lastPortVendorId: appState.lastPortVendorId,
    lastPortProductId: appState.lastPortProductId,
    lastPortSerialNumber: appState.lastPortSerialNumber,
    lastSuccessfulBaudRate: appState.lastSuccessfulBaudRate,
  };
}

// ---------------------------------------------------------------------------
// Tab management actions
// ---------------------------------------------------------------------------

function generateTabId(): string {
  return `tab-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;
}

function nextTabNumber(): number {
  let max = 0;
  for (const tab of appState.plotTabs) {
    const match = tab.name.match(/^Tab (\d+)$/);
    if (match) max = Math.max(max, parseInt(match[1], 10));
  }
  return max + 1;
}

/** Create a new plot tab with an auto-generated name, set it active, and return its id. */
export function addPlotTab(): string {
  const id = generateTabId();
  const name = `Tab ${nextTabNumber()}`;
  const newTab: PlotTab = { id, name, plots: [] };
  batch(() => {
    setAppState('plotTabs', tabs => [...tabs, newTab]);
    setAppState('activeSubTab', id);
  });
  return id;
}

/** Delete a plot tab. If it was the last tab, a fresh "Tab 1" replaces it. Switches to a neighbor if deleting the active tab. */
export function deletePlotTab(tabId: string): void {
  batch(() => {
    const tabs = appState.plotTabs;
    const idx = tabs.findIndex(t => t.id === tabId);
    if (idx === -1) return;

    if (tabs.length === 1) {
      // Last tab — replace with a fresh default
      const freshId = generateTabId();
      setAppState('plotTabs', [{ id: freshId, name: 'Tab 1', plots: [] }]);
      setAppState('activeSubTab', freshId);
      return;
    }

    // If deleting the active tab, switch to a neighbor
    if (appState.activeSubTab === tabId) {
      const neighborIdx = idx > 0 ? idx - 1 : 1;
      setAppState('activeSubTab', tabs[neighborIdx].id);
    }

    setAppState('plotTabs', tabs => tabs.filter(t => t.id !== tabId));
  });
}

/** Rename a plot tab. Rejects empty names after trimming. */
export function renamePlotTab(tabId: string, name: string): void {
  const trimmed = name.trim();
  if (!trimmed) return;

  const idx = appState.plotTabs.findIndex(t => t.id === tabId);
  if (idx === -1) return;

  setAppState('plotTabs', idx, 'name', trimmed);
}

/** Reorder plot tabs by moving the tab at fromIdx to toIdx (splice-based). */
export function reorderPlotTabs(fromIdx: number, toIdx: number): void {
  if (fromIdx === toIdx) return;
  const tabs = [...appState.plotTabs];
  if (fromIdx < 0 || fromIdx >= tabs.length || toIdx < 0 || toIdx >= tabs.length) return;

  const [moved] = tabs.splice(fromIdx, 1);
  tabs.splice(toIdx, 0, moved);
  setAppState('plotTabs', tabs);
}

/** Switch the active sub-tab. */
export function setActiveSubTab(tabId: string): void {
  if (!appState.plotTabs.some(t => t.id === tabId)) return;
  setAppState('activeSubTab', tabId);
}
