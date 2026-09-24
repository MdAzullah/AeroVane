/* Saved-log AI panel. The detector implementation is bundled from live-viewer/src/analysis. */
let savedLogAiResult = null;

function run_dataflash_ai_analysis(log, filename) {
    const status = document.getElementById('ai-analysis-status');
    const timeline = document.getElementById('ai-fault-timeline');
    try {
        status.textContent = 'Running shared safety detectors…';
        const records = log.get_records();
        savedLogAiResult = window.SkyForgeAI.analyzeDataFlashRecords(records);
        const result = savedLogAiResult;
        draw_ai_fault_markers(result, log.boot_time_ms_since_epoch || 0);
        document.getElementById('ai-health-score').textContent = `${result.healthScore}/100`;
        document.getElementById('ai-record-count').textContent = `${result.analyzedRecords.toLocaleString()} records`;
        status.textContent = result.faults.length
            ? `${result.faults.length} safety finding${result.faults.length === 1 ? '' : 's'} detected in ${filename}`
            : `No safety faults detected in ${filename}`;
        timeline.replaceChildren();
        if (result.faults.length === 0) {
            timeline.innerHTML = '<p class="ai-empty">No detector thresholds were crossed.</p>';
            return;
        }
        result.faults.forEach((fault, index) => {
            const card = document.createElement('article');
            card.className = `ai-fault-card severity-${fault.severity}`;
            card.innerHTML = `
                <div class="ai-fault-heading"><strong>${escape_ai_html(fault.message)}</strong><span>${fault.severity}</span></div>
                <p>${format_ai_time(fault.startedAtMs)} · ${fault.state}</p>
                <p>${escape_ai_html(fault.suggestedAction)}</p>
                <div class="ai-fault-actions">
                    <button type="button" onclick="show_fault_on_graph(${index})">Show on graph</button>
                    <button type="button" onclick="show_fault_on_map(${index})">Show on map</button>
                </div>`;
            timeline.appendChild(card);
        });
    } catch (error) {
        console.error('AI DataFlash analysis failed:', error);
        status.textContent = `AI analysis unavailable: ${error.message}`;
        timeline.innerHTML = '<p class="ai-empty">The log was parsed, but its records could not be analyzed.</p>';
    }
}

function show_fault_on_graph(index) {
    if (!savedLogAiResult || !savedLogAiResult.faults[index] || !document.logfile) return;
    const fault = savedLogAiResult.faults[index];
    const radiusMs = 5000;
    const boot = document.logfile.boot_time_ms_since_epoch;
    const range = boot > 0
        ? [new Date(boot + fault.startedAtMs - radiusMs), new Date(boot + fault.startedAtMs + radiusMs)]
        : [(fault.startedAtMs - radiusMs) / 1000, (fault.startedAtMs + radiusMs) / 1000];
    Plotly.relayout('plot', { 'xaxis.range': range });
    document.getElementById('plot').scrollIntoView({ behavior: 'smooth', block: 'center' });
}

function export_ai_analysis() {
    if (!savedLogAiResult) return;
    const blob = new Blob([JSON.stringify(savedLogAiResult, null, 2)], { type: 'application/json' });
    const link = document.createElement('a');
    link.href = URL.createObjectURL(blob);
    link.download = 'skyforge-bin-ai-analysis.json';
    link.click();
    URL.revokeObjectURL(link.href);
}

function format_ai_time(timestampMs) {
    const totalSeconds = Math.max(0, timestampMs / 1000);
    const minutes = Math.floor(totalSeconds / 60);
    return `${minutes}:${(totalSeconds % 60).toFixed(1).padStart(4, '0')}`;
}

function escape_ai_html(value) {
    const node = document.createElement('span');
    node.textContent = String(value);
    return node.innerHTML;
}
