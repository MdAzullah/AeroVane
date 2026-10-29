import { createSignal, createEffect, createMemo, onCleanup, For, Show } from 'solid-js';
import { appState } from '../store';
import type { PlotConfig } from '../models';
import { useWorkerBridge } from '../services';
import { toggleSetItem } from './hooks';

const FALLBACK_POPULAR_FIELDS: string[] = [
  'ATTITUDE.roll', 'ATTITUDE.pitch', 'ATTITUDE.yaw',
  'ATTITUDE.rollspeed', 'ATTITUDE.pitchspeed', 'ATTITUDE.yawspeed',
  'VFR_HUD.alt', 'VFR_HUD.climb', 'VFR_HUD.groundspeed', 'VFR_HUD.airspeed', 'VFR_HUD.heading', 'VFR_HUD.throttle',
  'GLOBAL_POSITION_INT.lat', 'GLOBAL_POSITION_INT.lon', 'GLOBAL_POSITION_INT.alt', 'GLOBAL_POSITION_INT.relative_alt',
  'GLOBAL_POSITION_INT.vx', 'GLOBAL_POSITION_INT.vy', 'GLOBAL_POSITION_INT.vz',
  'SYS_STATUS.voltage_battery', 'SYS_STATUS.current_battery', 'SYS_STATUS.battery_remaining', 'SYS_STATUS.drop_rate_comm',
  'GPS_RAW_INT.fix_type', 'GPS_RAW_INT.satellites_visible', 'GPS_RAW_INT.eph', 'GPS_RAW_INT.epv', 'GPS_RAW_INT.vel',
  'RAW_IMU.xacc', 'RAW_IMU.yacc', 'RAW_IMU.zacc', 'RAW_IMU.xgyro', 'RAW_IMU.ygyro', 'RAW_IMU.zgyro',
  'BATTERY_STATUS.voltages', 'BATTERY_STATUS.current_battery', 'BATTERY_STATUS.battery_remaining',
  'NAV_CONTROLLER_OUTPUT.nav_roll', 'NAV_CONTROLLER_OUTPUT.nav_pitch', 'NAV_CONTROLLER_OUTPUT.nav_bearing', 'NAV_CONTROLLER_OUTPUT.wp_dist',
];

interface SignalSelectorProps {
  plotConfig: PlotConfig;
  onToggleSignal: (plotId: string, fieldKey: string) => void;
  onClose: () => void;
}

export default function SignalSelector(props: SignalSelectorProps) {
  const workerBridge = useWorkerBridge();
  const [availableFields, setAvailableFields] = createSignal<string[]>(workerBridge.getAvailableFields());
  const [expandedGroups, setExpandedGroups] = createSignal<Set<string>>(new Set());
  const [searchQuery, setSearchQuery] = createSignal('');

  // Get available fields from worker updates
  createEffect(() => {
    if (!appState.isReady) return;
    const unsub = workerBridge.onAvailableFields(fields => {
      if (fields && fields.length > 0) {
        setAvailableFields(fields);
      }
    });
    onCleanup(unsub);
  });

  // Effective fields: use received fields, or fall back to popular fields if no telemetry yet
  const effectiveFields = createMemo(() => {
    const raw = availableFields();
    if (raw && raw.length > 0) return raw;
    return FALLBACK_POPULAR_FIELDS;
  });

  // Group fields by message type, filtered by search query
  const groupedFields = createMemo(() => {
    const query = searchQuery().trim().toLowerCase();
    const groups = new Map<string, string[]>();

    for (const key of effectiveFields()) {
      const dotIdx = key.indexOf('.');
      if (dotIdx === -1) continue;
      const msgType = key.substring(0, dotIdx);
      const fieldName = key.substring(dotIdx + 1);

      if (query) {
        const matchesMsg = msgType.toLowerCase().includes(query);
        const matchesField = fieldName.toLowerCase().includes(query);
        if (!matchesMsg && !matchesField) continue;
      }

      if (!groups.has(msgType)) groups.set(msgType, []);
      groups.get(msgType)!.push(fieldName);
    }
    return groups;
  });

  function isGroupExpanded(msgType: string): boolean {
    if (searchQuery().trim().length > 0) return true; // Auto-expand when searching
    return expandedGroups().has(msgType);
  }

  function isSelected(fieldKey: string): boolean {
    return props.plotConfig.signals.some(s => s.fieldKey === fieldKey);
  }

  function getSignalColor(fieldKey: string): string | undefined {
    const sig = props.plotConfig.signals.find(s => s.fieldKey === fieldKey);
    return sig?.color;
  }

  function toggleGroup(msgType: string) {
    toggleSetItem(setExpandedGroups, msgType);
  }

  return (
    <div
      class="fixed inset-0 flex items-center justify-center z-50 p-4"
      style={{ 'background-color': 'rgba(0,0,0,0.65)', 'backdrop-filter': 'blur(2px)' }}
      onClick={(e) => {
        if (e.target === e.currentTarget) props.onClose();
      }}
    >
      <div
        class="rounded-xl shadow-2xl max-h-[80vh] w-full max-w-[460px] flex flex-col overflow-hidden"
        style={{
          'background-color': 'var(--bg-panel)',
          border: '1px solid var(--border)',
        }}
      >
        {/* Header */}
        <div
          class="flex items-center justify-between px-4 py-3 border-b"
          style={{ 'border-color': 'var(--border)' }}
        >
          <div>
            <span class="text-sm font-semibold block" style={{ color: 'var(--text-primary)' }}>
              Select Telemetry Signals
            </span>
            <span class="text-[11px]" style={{ color: 'var(--text-secondary)' }}>
              Plotting to: <strong>{props.plotConfig.title || 'Selected Plot'}</strong>
            </span>
          </div>
          <button
            class="p-1 rounded transition-colors interactive-hover"
            style={{ color: 'var(--text-secondary)' }}
            onClick={() => props.onClose()}
            aria-label="Close signal selector"
          >
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
              <line x1="18" y1="6" x2="6" y2="18" />
              <line x1="6" y1="6" x2="18" y2="18" />
            </svg>
          </button>
        </div>

        {/* Search bar */}
        <div class="p-3 border-b" style={{ 'border-color': 'var(--border-subtle)', 'background-color': 'var(--bg-panel-2)' }}>
          <div class="relative">
            <input
              type="text"
              placeholder="Search signals (e.g. roll, alt, voltage, speed)..."
              value={searchQuery()}
              onInput={(e) => setSearchQuery(e.currentTarget.value)}
              class="w-full text-xs rounded-md pl-8 pr-3 py-1.5 outline-none border focus:border-cyan-500"
              style={{
                'background-color': 'var(--bg-panel)',
                color: 'var(--text-primary)',
                'border-color': 'var(--border-subtle)',
              }}
              autofocus
            />
            <svg
              width="14"
              height="14"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              stroke-width="2"
              class="absolute left-2.5 top-2.5"
              style={{ color: 'var(--text-secondary)' }}
            >
              <circle cx="11" cy="11" r="8" />
              <line x1="21" y1="21" x2="16.65" y2="16.65" />
            </svg>
          </div>
        </div>

        {/* Field list */}
        <div class="flex-1 overflow-y-auto p-2">
          <Show when={availableFields().length === 0}>
            <div class="px-2 py-1.5 mb-2 rounded text-[11px]" style={{ 'background-color': 'var(--bg-hover)', color: 'var(--text-secondary)' }}>
              💡 Showing common MAVLink fields. Connect to live telemetry to discover active sensors.
            </div>
          </Show>

          <For each={Array.from(groupedFields().entries())}>
            {([msgType, fields]) => (
              <div class="mb-1 rounded border" style={{ 'border-color': 'var(--border-subtle)' }}>
                {/* Group header */}
                <button
                  class="flex items-center gap-2 w-full px-2.5 py-1.5 rounded-t text-left transition-colors interactive-hover"
                  style={{
                    color: 'var(--text-primary)',
                    'background-color': isGroupExpanded(msgType) ? 'var(--bg-hover)' : 'transparent',
                  }}
                  data-testid={`signal-group-${msgType}`}
                  onClick={() => toggleGroup(msgType)}
                >
                  <svg
                    width="10" height="10" viewBox="0 0 24 24"
                    fill="none" stroke="currentColor" stroke-width="2.5"
                    style={{
                      transform: isGroupExpanded(msgType) ? 'rotate(90deg)' : 'rotate(0deg)',
                      transition: 'transform 0.15s',
                      color: 'var(--text-secondary)',
                    }}
                  >
                    <polyline points="9 18 15 12 9 6" />
                  </svg>
                  <span class="text-xs font-mono font-semibold">{msgType}</span>
                  <span class="text-[10px] ml-auto px-1.5 py-0.2 rounded font-mono" style={{ color: 'var(--text-secondary)', 'background-color': 'var(--bg-panel-2)' }}>
                    {fields.length}
                  </span>
                </button>

                {/* Fields */}
                <Show when={isGroupExpanded(msgType)}>
                  <div class="px-2 py-1.5 grid grid-cols-2 gap-1 border-t" style={{ 'border-color': 'var(--border-subtle)', 'background-color': 'var(--bg-panel)' }}>
                    <For each={fields}>
                      {(fieldName) => {
                        const fieldKey = `${msgType}.${fieldName}`;
                        const selected = () => isSelected(fieldKey);
                        const color = () => getSignalColor(fieldKey);

                        return (
                          <button
                            class="flex items-center gap-2 px-2 py-1 rounded text-left transition-colors interactive-hover"
                            style={{
                              'background-color': selected() ? 'color-mix(in srgb, var(--accent) 15%, transparent)' : 'transparent',
                            }}
                            onClick={() => props.onToggleSignal(props.plotConfig.id, fieldKey)}
                          >
                            <div
                              class="w-3.5 h-3.5 rounded flex items-center justify-center border flex-shrink-0"
                              style={{
                                'background-color': selected() ? (color() ?? 'var(--accent)') : 'transparent',
                                'border-color': selected() ? (color() ?? 'var(--accent)') : 'var(--text-secondary)',
                              }}
                            >
                              <Show when={selected()}>
                                <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="#ffffff" stroke-width="3">
                                  <polyline points="20 6 9 17 4 12" />
                                </svg>
                              </Show>
                            </div>
                            <span
                              class="text-xs font-mono truncate"
                              style={{ color: selected() ? 'var(--text-primary)' : 'var(--text-secondary)' }}
                              title={fieldKey}
                            >
                              {fieldName}
                            </span>
                          </button>
                        );
                      }}
                    </For>
                  </div>
                </Show>
              </div>
            )}
          </For>

          <Show when={groupedFields().size === 0}>
            <div class="text-center py-6 text-xs" style={{ color: 'var(--text-secondary)' }}>
              No matching signals found for "{searchQuery()}".
            </div>
          </Show>
        </div>

        {/* Footer */}
        <div class="px-4 py-2.5 border-t flex items-center justify-between" style={{ 'border-color': 'var(--border-subtle)', 'background-color': 'var(--bg-panel-2)' }}>
          <span class="text-xs" style={{ color: 'var(--text-secondary)' }}>
            {props.plotConfig.signals.length} signal(s) active
          </span>
          <button
            class="console-button px-3 py-1 rounded text-xs font-medium"
            onClick={() => props.onClose()}
          >
            Done
          </button>
        </div>
      </div>
    </div>
  );
}
