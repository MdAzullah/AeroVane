import { createEffect, createMemo, createSignal, For, Show } from 'solid-js';
import { presentFaultNotification, type FaultSeverity } from '../analysis';
import {
  acknowledgeFault,
  appState,
  clearFaultHistory,
  buildFaultAnalysisExport,
  requestFaultNavigation,
  selectFaultHealthScore,
  selectHighestFaultSeverity,
  setAppState,
  type AppFaultRecord,
} from '../store';
import { playCriticalAlert } from '../services';

type DisplayStatus = 'normal' | 'caution' | 'warning' | 'critical';

const STATUS_COLORS: Record<DisplayStatus, string> = {
  normal: 'var(--accent-green)', caution: 'var(--accent-yellow)',
  warning: '#f97316', critical: 'var(--accent-red)',
};

export default function AISafetyPanel() {
  const [expanded, setExpanded] = createSignal(false);
  const [view, setView] = createSignal<'active' | 'history' | 'timeline'>('active');
  const soundedFaultIds = new Set<string>();
  const status = createMemo<DisplayStatus>(() => {
    const severity = appState.logViewerState.isActive && appState.faultAnalysisStatus === 'complete'
      ? highestSeverity([...appState.faultHistory, ...appState.activeFaults])
      : selectHighestFaultSeverity();
    if (severity === 'info' || severity === 'normal') return severity === 'info' ? 'caution' : 'normal';
    return severity;
  });

  createEffect(() => {
    const active = appState.activeFaults;
    if (active.some(fault => !fault.acknowledged)) setExpanded(true);
    const activeIds = new Set(active.map(fault => fault.id));
    for (const id of soundedFaultIds) if (!activeIds.has(id)) soundedFaultIds.delete(id);
    if (appState.faultAnalysisStatus === 'complete' && appState.logViewerState.isActive) {
      setExpanded(true);
      setView('timeline');
    }
    if (!appState.aiSafetySoundEnabled || appState.logViewerState.isActive) return;
    for (const fault of active) {
      if (fault.severity !== 'critical' || fault.acknowledged || soundedFaultIds.has(fault.id)) continue;
      soundedFaultIds.add(fault.id);
      playCriticalAlert();
    }
  });

  const visibleFaults = () => {
    if (view() === 'active') return appState.activeFaults;
    if (view() === 'history') return appState.faultHistory;
    return [...appState.faultHistory, ...appState.activeFaults].sort((a, b) => a.startedAtMs - b.startedAtMs);
  };

  return (
    <section
      class="ai-safety-panel shrink-0"
      aria-label="AI Safety fault detection"
      style={{ '--ai-status-color': STATUS_COLORS[status()] }}
    >
      <div class="ai-safety-header">
        <button
          class="ai-safety-toggle"
          aria-expanded={expanded()}
          aria-controls="ai-safety-content"
          onClick={() => setExpanded(value => !value)}
        >
          <span class="ai-safety-status-dot" aria-hidden="true" />
          <span class="ai-safety-title">AI Safety</span>
          <strong class="ai-safety-status" role="status" aria-live="polite">{status().toUpperCase()}</strong>
          <Show when={appState.activeFaults.length > 0}>
            <span class="ai-safety-count" aria-label={`${appState.activeFaults.length} active faults`}>
              {appState.activeFaults.length}
            </span>
          </Show>
          <span aria-hidden="true">{expanded() ? '▾' : '▴'}</span>
        </button>
        <label class="ai-safety-sound" title="Play a sound for new critical warnings">
          <input
            type="checkbox"
            checked={appState.aiSafetySoundEnabled}
            onChange={event => setAppState('aiSafetySoundEnabled', event.currentTarget.checked)}
          />
          Critical sound
        </label>
      </div>

      <Show when={expanded()}>
        <div id="ai-safety-content" class="ai-safety-content">
          <Show when={appState.logViewerState.isActive}>
            <div class="ai-analysis-summary" aria-live="polite">
              <Show
                when={appState.faultAnalysisStatus === 'complete'}
                fallback={<span>Analyzing {appState.faultAnalysisRecordCount.toLocaleString()} TLOG records…</span>}
              >
                <strong>Flight health {selectFaultHealthScore()}/100</strong>
                <span>{(appState.activeFaults.length + appState.faultHistory.length)} detected fault episodes</span>
                <span>{appState.faultAnalysisMessageCount.toLocaleString()} MAVLink messages analyzed</span>
                <button onClick={exportAnalysisJson}>Export JSON</button>
              </Show>
            </div>
          </Show>
          <div class="ai-safety-tabs" role="tablist" aria-label="Fault views">
            <button role="tab" aria-selected={view() === 'active'} onClick={() => setView('active')}>
              Active ({appState.activeFaults.length})
            </button>
            <button role="tab" aria-selected={view() === 'history'} onClick={() => setView('history')}>
              History ({appState.faultHistory.length})
            </button>
            <Show when={appState.logViewerState.isActive}>
              <button role="tab" aria-selected={view() === 'timeline'} onClick={() => setView('timeline')}>
                Timeline ({appState.activeFaults.length + appState.faultHistory.length})
              </button>
            </Show>
            <Show when={view() === 'history' && appState.faultHistory.length > 0}>
              <button class="ai-safety-clear" onClick={clearFaultHistory}>Clear history</button>
            </Show>
          </div>

          <div
            class="ai-safety-list"
            role={view() === 'active' ? 'log' : undefined}
            aria-live={view() === 'active' ? 'assertive' : 'off'}
          >
            <Show
              when={visibleFaults().length > 0}
              fallback={<p class="ai-safety-empty">{emptyMessage(view())}</p>}
            >
              <For each={visibleFaults()}>{fault => <FaultCard fault={fault} history={fault.state === 'cleared'} logMode={appState.logViewerState.isActive} />}</For>
            </Show>
          </div>
        </div>
      </Show>
    </section>
  );
}

function FaultCard(props: { fault: AppFaultRecord; history: boolean; logMode: boolean }) {
  const presented = () => presentFaultNotification(props.fault);
  return (
    <article class="ai-fault-card" data-severity={props.fault.severity}>
      <div class="ai-fault-heading">
        <div>
          <span class="ai-fault-severity">{props.fault.severity.toUpperCase()}</span>
          <strong>{presented().title}</strong>
        </div>
        <time dateTime={new Date(props.fault.updatedAtMs).toISOString()}>{props.logMode ? formatLogOffset(props.fault.startedAtMs) : formatTime(props.fault.updatedAtMs)}</time>
      </div>
      <div class="ai-fault-meta">
        Confidence {Math.round(props.fault.confidence * 100)}%
        <span aria-hidden="true"> · </span>
        {props.history ? 'Cleared' : props.fault.acknowledged ? 'Acknowledged' : 'Needs attention'}
      </div>
      <p class="ai-fault-summary">{presented().summary}</p>
      <p class="ai-fault-urgency"><strong>What to do now:</strong> {presented().urgency}</p>
      <span class="ai-fault-source">{presented().sourceLabel}</span>
      <Show when={presented().evidence.length > 0}>
        <p class="ai-fault-section-label">Why this warning appeared</p>
      </Show>
      <For each={presented().evidence}>
        {evidence => (
          <p class="ai-fault-evidence">
            <strong>{evidence.label}:</strong> {formatNumber(evidence.value)} {evidence.unit ?? ''}
            <Show when={evidence.threshold !== undefined}>; warning level {formatNumber(evidence.threshold!)} {evidence.unit ?? ''}</Show>
            <span> — {evidence.description}</span>
          </p>
        )}
      </For>
      <p class="ai-fault-section-label">Recommended actions</p>
      <ol class="ai-fault-actions-list"><For each={presented().actions}>{action => <li>{action}</li>}</For></ol>
      <Show when={!props.history && !props.fault.acknowledged}>
        <button class="ai-fault-acknowledge" onClick={() => acknowledgeFault(props.fault.id)}>
          Acknowledge
        </button>
      </Show>
      <Show when={props.logMode}>
        <button class="ai-fault-acknowledge" onClick={() => requestFaultNavigation(props.fault.startedAtMs)}>
          Show on graphs
        </button>
      </Show>
    </article>
  );
}

function highestSeverity(faults: readonly AppFaultRecord[]): FaultSeverity | 'normal' {
  const rank: Record<FaultSeverity, number> = { info: 0, caution: 1, warning: 2, critical: 3 };
  return faults.reduce<FaultSeverity | 'normal'>((highest, fault) => highest === 'normal' || rank[fault.severity] > rank[highest] ? fault.severity : highest, 'normal');
}

function emptyMessage(view: 'active' | 'history' | 'timeline'): string {
  if (view === 'active') return 'No active faults detected.';
  if (view === 'timeline') return 'No faults detected in this flight.';
  return 'No cleared faults in this session.';
}

function formatLogOffset(timestampMs: number): string {
  const elapsedSeconds = Math.max(0, Math.round((timestampMs - appState.faultAnalysisStartedAtMs) / 1_000));
  const minutes = Math.floor(elapsedSeconds / 60);
  const seconds = elapsedSeconds % 60;
  return `+${minutes}:${String(seconds).padStart(2, '0')}`;
}

function exportAnalysisJson(): void {
  const json = JSON.stringify(buildFaultAnalysisExport(), null, 2);
  const url = URL.createObjectURL(new Blob([json], { type: 'application/json' }));
  const link = document.createElement('a');
  const baseName = appState.logViewerState.sourceName.replace(/\.[^.]+$/, '').replace(/[^a-z0-9_-]+/gi, '-') || 'flight';
  link.href = url;
  link.download = `${baseName}-skyforge-analysis.json`;
  link.click();
  URL.revokeObjectURL(url);
}

function formatTime(timestampMs: number): string {
  return new Date(timestampMs).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' });
}

function formatNumber(value: number): string {
  return Number.isInteger(value) ? String(value) : value.toFixed(2);
}
