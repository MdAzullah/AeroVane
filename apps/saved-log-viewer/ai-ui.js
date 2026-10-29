/* Saved-log AI panel. The detector implementation is bundled from apps/live-viewer/src/analysis. */
let savedLogAiResult = null;

function run_dataflash_ai_analysis(log, filename) {
    const status = document.getElementById('ai-analysis-status');
    const timeline = document.getElementById('ai-fault-timeline');
    try {
        status.textContent = 'Running shared safety detectors…';
        const records = log.get_records();
        const aiApi = window.AeroVaneAI || window.AeroVaneAI;
        savedLogAiResult = aiApi.analyzeDataFlashRecords(records);
        render_dataflash_ai_analysis(savedLogAiResult, filename, log.boot_time_ms_since_epoch || 0);
    } catch (error) {
        render_ai_analysis_error(error);
    }
}

function render_dataflash_ai_analysis(result, filename, bootTimeMs) {
    const status = document.getElementById('ai-analysis-status');
    const timeline = document.getElementById('ai-fault-timeline');
    try {
        savedLogAiResult = result;
        draw_ai_fault_markers(result, bootTimeMs);
        draw_ai_fault_regions(result, bootTimeMs);
        document.getElementById('ai-health-score').textContent = `${result.healthScore}/100`;
        document.getElementById('ai-coverage').textContent = `${result.dataCoveragePct ?? 0}%`;
        document.getElementById('ai-detector-split').textContent = `${result.ruleFindings ?? 0} / ${result.mlFindings ?? 0}`;
        document.getElementById('ai-record-count').textContent = `${result.analyzedRecords.toLocaleString()} records`;
        status.textContent = result.faults.length
            ? `${result.faults.length} safety finding${result.faults.length === 1 ? '' : 's'} detected in ${filename}`
            : `No safety faults detected in ${filename}`;
        const section = document.getElementById('findings-section');
        section?.classList.toggle('has-findings', result.faults.length > 0);
        const toggle = document.getElementById('ai-report-toggle');
        if (toggle) toggle.textContent = result.faults.length ? `View ${result.faults.length} finding${result.faults.length === 1 ? '' : 's'}` : 'View details';
        timeline.replaceChildren();
        if (result.faults.length === 0) {
            timeline.innerHTML = '<p class="ai-empty">No detector thresholds were crossed.</p>';
            return;
        }
        result.faults.forEach((fault, index) => {
            const card = document.createElement('article');
            card.className = `ai-fault-card severity-${fault.severity}`;
            const aiApi = window.AeroVaneAI || window.AeroVaneAI;
            const presented = aiApi.presentFaultNotification(fault, 'post-flight');
            const evidence = presented.evidence.slice(0, 3).map(item => `<li><strong>${escape_ai_html(item.label)}:</strong> ${format_ai_value(item.value)} ${escape_ai_html(item.unit || '')}${Number.isFinite(item.threshold) ? `; warning level ${format_ai_value(item.threshold)} ${escape_ai_html(item.unit || '')}` : ''}<small>${escape_ai_html(item.description)}</small></li>`).join('');
            const actions = presented.actions.map(item => `<li>${escape_ai_html(item)}</li>`).join('');
            card.innerHTML = `
                <div class="ai-fault-heading"><strong>${escape_ai_html(presented.title)}</strong><span>${fault.severity}</span></div>
                <div class="ai-fault-meta"><span>${format_ai_time(fault.startedAtMs)}</span></div>
                <p class="fault-summary">${escape_ai_html(presented.summary)}</p>
                ${presented.reading ? `<p class="fault-reading">${escape_ai_html(presented.reading)}</p>` : ''}
                <p class="fault-urgency"><strong>${escape_ai_html(presented.urgencyLabel)}:</strong> ${escape_ai_html(presented.urgency)}</p>
                <div class="fault-action-list"><ol>${actions}</ol></div>
                ${presented.note ? `<p class="fault-note">${escape_ai_html(presented.note)}</p>` : ''}
                <details class="fault-detail"><summary>Details · ${escape_ai_html(presented.sourceLabel)} · ${Math.round(fault.confidence * 100)}% confidence · ${escape_ai_html(fault.state)}</summary>${evidence ? `<ul class="fault-evidence">${evidence}</ul>` : ''}</details>
                <div class="ai-fault-actions">
                    <button type="button" onclick="show_fault_on_graph(${index})">Show on graph</button>
                    <button type="button" onclick="show_fault_on_map(${index})">Show on map</button>
                </div>`;
            timeline.appendChild(card);
        });
    } catch (error) { render_ai_analysis_error(error); }
}

function toggle_ai_report() {
    const timeline = document.getElementById('ai-fault-timeline');
    const button = document.getElementById('ai-report-toggle');
    if (!timeline || !button) return;
    const opening = timeline.hidden;
    timeline.hidden = !opening;
    button.setAttribute('aria-expanded', String(opening));
    button.textContent = opening ? 'Hide details' : (savedLogAiResult?.faults?.length ? `View ${savedLogAiResult.faults.length} finding${savedLogAiResult.faults.length === 1 ? '' : 's'}` : 'View details');
}

function draw_ai_fault_regions(result, bootTimeMs) {
    const plot = document.getElementById('plot');
    if (!plot || !window.Plotly) return;
    const colors = { critical: '#ef4444', warning: '#f59e0b', caution: '#eab308', info: '#38bdf8' };
    const shapes = result.faults.slice(0, 100).map(fault => {
        const x = bootTimeMs > 0 ? new Date(bootTimeMs + fault.startedAtMs) : fault.startedAtMs / 1000;
        return { type: 'line', xref: 'x', yref: 'paper', x0: x, x1: x, y0: 0, y1: 1,
            line: { color: colors[fault.severity] || colors.info, width: 1, dash: 'dot' }, opacity: .65 };
    });
    const annotations = result.faults.slice(0, 16).map((fault, index) => {
        const x = bootTimeMs > 0 ? new Date(bootTimeMs + fault.startedAtMs) : fault.startedAtMs / 1000;
        return { x, y: 1, xref: 'x', yref: 'paper', text: `${index + 1}`, showarrow: false,
            bgcolor: colors[fault.severity] || colors.info, bordercolor: '#ffffff', borderwidth: 1,
            font: { color: '#07111f', size: 10 }, yshift: 12 };
    });
    Plotly.relayout(plot, { shapes, annotations });
    render_fault_event_rail(result);
}

function render_fault_event_rail(result) {
    const rail = document.getElementById('fault-event-rail');
    if (!rail) return;
    rail.replaceChildren();
    rail.classList.toggle('has-events', result.faults.length > 0);
    const colors = { critical: '#ef4444', warning: '#f59e0b', caution: '#eab308', info: '#38bdf8' };
    result.faults.forEach((fault, index) => {
        const button = document.createElement('button');
        button.type = 'button';
        button.className = 'fault-event-button';
        button.style.setProperty('--fault-color', colors[fault.severity] || colors.info);
        button.innerHTML = `<strong>${index + 1}</strong><span>${format_ai_time(fault.startedAtMs)}</span><span>${escape_ai_html(fault.message)}</span>`;
        button.onclick = () => show_fault_on_graph(index);
        rail.appendChild(button);
    });
}

function render_ai_analysis_error(error) {
    console.error('AI DataFlash analysis failed:', error);
    const status = document.getElementById('ai-analysis-status');
    const timeline = document.getElementById('ai-fault-timeline');
    if (status) status.textContent = `AI analysis unavailable: ${error.message}`;
    if (timeline) timeline.innerHTML = '<p class="ai-empty">The log was parsed, but its records could not be analyzed.</p>';
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
    const marker = boot > 0 ? new Date(boot + fault.startedAtMs) : fault.startedAtMs / 1000;
    Plotly.Fx.hover('plot', [{ curveNumber: 0, xval: marker }]);
    document.getElementById('plot').scrollIntoView({ behavior: 'smooth', block: 'center' });
}

function export_ai_analysis() {
    if (!savedLogAiResult) return;
    const blob = new Blob([JSON.stringify(savedLogAiResult, null, 2)], { type: 'application/json' });
    const link = document.createElement('a');
    link.href = URL.createObjectURL(blob);
    link.download = 'aerovane-bin-ai-analysis.json';
    link.click();
    URL.revokeObjectURL(link.href);
}

function format_ai_time(timestampMs) {
    const totalSeconds = Math.max(0, timestampMs / 1000);
    const minutes = Math.floor(totalSeconds / 60);
    return `${minutes}:${(totalSeconds % 60).toFixed(1).padStart(4, '0')}`;
}

function format_ai_value(value) {
    return Number.isInteger(value) ? String(value) : Number(value).toFixed(2);
}

function escape_ai_html(value) {
    const node = document.createElement('span');
    node.textContent = String(value);
    return node.innerHTML;
}
