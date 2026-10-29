/* AeroVane Main App Controller
   Supports full responsiveness, split fullscreen graph/sidebar workspace, and mobile layouts */

let activeAnalysisWorker = null;
let lastProgressRender = { stage: '', progress: -1, at: 0 };
let safetyBannerVisible = false;

function cancel_log_analysis() {
    if (!activeAnalysisWorker) return;
    activeAnalysisWorker.terminate();
    activeAnalysisWorker = null;
    render_file_picker('Analysis cancelled. Select a BIN log when ready.');
}

function render_file_picker(message = '') {
    const dropCard = document.querySelector('.drop-card');
    if (!dropCard) return;
    dropCard.classList.remove('loading');
    dropCard.innerHTML = `<div class="drop-content">
        ${message ? `<p class="file-picker-message">${escape_app_html(message)}</p>` : ''}
        <p class="drop-title">📂 Drag & Drop an ArduPilot DataFlash <code>*.bin</code> or <code>*.log</code> file here</p>
        <label class="browse-btn">Browse File<input type="file" id="files" name="file" accept=".bin,.BIN,.log,.LOG" onchange="handle_onfilechange(event)"></label>
    </div>`;
}

function skip_safety_analysis() {
    if (activeAnalysisWorker) {
        activeAnalysisWorker.terminate();
        activeAnalysisWorker = null;
    }
    render_safety_banner(0, true, true); // removes the banner
    const status = document.getElementById('ai-analysis-status');
    if (status) status.textContent = 'Safety analysis skipped. Telemetry and signal exploration active.';
}

function render_analysis_progress(filename, stage, progress) {
    const dropCard = document.querySelector('.drop-card');
    if (!dropCard) return;
    const percentage = Math.max(0, Math.min(100, Math.round(progress * 100)));
    // Steps 1 & 2 fill 0–100%; step 3 (safety) runs as background banner after dashboard opens
    const stages = ['loading', 'parsing'];
    const activeStage = Math.max(0, stages.indexOf(stage));
    const label = stage === 'loading' ? 'Reading file' : 'Decoding telemetry';
    const stageWeight = { loading: [0, 30], parsing: [30, 100] }[stage] || [0, 100];
    const overallPercentage = Math.round(stageWeight[0] + (stageWeight[1] - stageWeight[0]) * Math.max(0, Math.min(1, progress)));
    dropCard.classList.add('loading');
    dropCard.innerHTML = `<div class="analysis-progress" role="status" aria-live="polite">
        <div class="analysis-progress-copy"><strong>${escape_app_html(label)}</strong><span>${escape_app_html(filename)} · ${percentage}%</span></div>
        <div class="progress-stages" aria-label="Analysis progress">
            ${['Read file', 'Decode telemetry', 'Safety analysis'].map((name, index) => `<span class="${index < activeStage ? 'complete' : index === activeStage ? 'active' : ''}"><b>${index < activeStage ? '✓' : index + 1}</b>${name}</span>`).join('')}
        </div>
        <progress max="100" value="${overallPercentage}">${overallPercentage}%</progress>
        <button type="button" class="cancel-analysis-btn" onclick="cancel_log_analysis()">Cancel</button>
    </div>`;
}

/** Show / update the compact non-blocking safety analysis banner at top of dashboard */
function render_safety_banner(percent, done, skipped) {
    let banner = document.getElementById('safety-analysis-banner');
    const analyzepage = document.getElementById('analyzepage');
    if (!analyzepage) return;
    if (!banner) {
        banner = document.createElement('div');
        banner.id = 'safety-analysis-banner';
        banner.className = 'safety-analysis-banner';
        banner.setAttribute('role', 'status');
        banner.setAttribute('aria-live', 'polite');
        analyzepage.insertAdjacentElement('afterbegin', banner);
    }
    if (done || skipped) {
        banner.remove();
        safetyBannerVisible = false;
        return;
    }
    safetyBannerVisible = true;
    banner.innerHTML = `
        <div class="safety-banner-inner">
            <span class="safety-banner-icon">🔍</span>
            <span class="safety-banner-label">Running safety analysis… <strong>${percent}%</strong></span>
            <div class="safety-banner-bar"><div class="safety-banner-fill" style="width:${percent}%"></div></div>
            <button type="button" class="safety-banner-skip" onclick="skip_safety_analysis()">Skip</button>
        </div>`;
}

function readfiles(files) {
    if (!files || files.length === 0) return;
    const file = files[0];

    if (!is_dataflash(file.name)) {
        alert("Please select an ArduPilot DataFlash .bin or text .log file.");
        return;
    }

    if (activeAnalysisWorker) activeAnalysisWorker.terminate();
    render_analysis_progress(file.name, 'loading', 0);
    lastProgressRender = { stage: '', progress: -1, at: 0 };
    const startedAt = performance.now();

    const reader = new FileReader();
    reader.onload = function(event) {
        const worker = new Worker('analysis-worker.js?v=2');
        activeAnalysisWorker = worker;
        worker.onmessage = async function(workerEvent) {
            if (worker !== activeAnalysisWorker) return;
            const message = workerEvent.data || {};
            if (message.type === 'progress') {
                const now = performance.now();
                const changedStage = message.stage !== lastProgressRender.stage;
                const meaningfulStep = message.progress >= 1 || message.progress - lastProgressRender.progress >= 0.01;
                if (!changedStage && !meaningfulStep && now - lastProgressRender.at < 120) return;
                lastProgressRender = { stage: message.stage, progress: message.progress, at: now };
                render_analysis_progress(file.name, message.stage, message.progress);
                return;
            }
            if (message.type === 'error') {
                worker.terminate();
                activeAnalysisWorker = null;
                console.error('Error reading logfile:', message.message);
                render_file_picker(`Could not analyze this log: ${message.message}`);
                return;
            }
            if (message.type === 'ready' || message.type === 'complete') {
                try {
                    const lf = message.format === 'text' ? textlogfile.from_snapshot(message.buffer, message.snapshot) : logfile.from_snapshot(message.buffer, message.snapshot);
                    document.logfile = lf;
                    const duration = ((performance.now() - startedAt) / 1000).toFixed(2);
                    const dropCard = document.querySelector('.drop-card');
                    if (dropCard) {
                        dropCard.classList.remove('loading');
                        dropCard.innerHTML = `
                            <div class="file-loaded-info">
                                <span class="file-icon">LOG</span>
                                <div>
                                    <strong>${escape_app_html(file.name)}</strong>
                                    <span class="file-meta">${(file.size / (1024 * 1024)).toFixed(2)} MB &bull; ${lf.totalMessages.toLocaleString()} packets indexed in ${duration}s</span>
                                </div>
                                <label class="change-file-btn">
                                    Change File
                                    <input type="file" id="files" name="file" accept=".bin,.BIN,.log,.LOG" onchange="handle_onfilechange(event)" style="display:none">
                                </label>
                            </div>
                        `;
                    }
                    // ── Open the full dashboard NOW (step 3 / safety runs in background) ──
                    const analyzepage = document.getElementById('analyzepage');
                    if (analyzepage) analyzepage.style.display = "block";
                    build_navbar(lf.get_msgitem_list());
                    await init_main_plot();
                    plot_default_signal(lf);
                    const gpsds = message.gps;
                    get_overview(gpsds, lf.get_boot_time(), lf);
                    if (gpsds) {
                        draw_flight_map(gpsds);
                    } else {
                        const mapCard = document.querySelector('.map-card');
                        if (mapCard) mapCard.style.display = "none";
                    }

                    if (message.analysis) {
                        // Safety analysis was bundled in 'ready' (e.g. small logs)
                        render_dataflash_ai_analysis(message.analysis, file.name, lf.boot_time_ms_since_epoch || 0);
                        worker.terminate();
                        if (activeAnalysisWorker === worker) activeAnalysisWorker = null;
                    } else {
                        // Show compact top banner — safety analysis running in background
                        render_safety_banner(0, false, false);
                        const status = document.getElementById('ai-analysis-status');
                        if (status) status.textContent = 'Running automated safety analysis in background…';
                    }
                } catch (err) {
                    console.error('Error presenting logfile:', err);
                    render_file_picker(`The log was decoded but could not be displayed: ${err.message}`);
                    worker.terminate();
                    if (activeAnalysisWorker === worker) activeAnalysisWorker = null;
                }
                return;
            }
            if (message.type === 'analysis_progress') {
                const percent = Math.round((message.progress || 0) * 100);
                render_safety_banner(percent, false, false);
                const status = document.getElementById('ai-analysis-status');
                if (status && !savedLogAiResult) {
                    status.textContent = `Running safety analysis… ${percent}%`;
                }
                return;
            }
            if (message.type === 'analysis_complete') {
                // Remove the safety banner regardless of outcome
                render_safety_banner(100, true, message.skipped || false);
                try {
                    if (message.analysis) {
                        render_dataflash_ai_analysis(message.analysis, file.name, document.logfile?.boot_time_ms_since_epoch || 0);
                    } else if (message.skipped) {
                        const status = document.getElementById('ai-analysis-status');
                        if (status) status.textContent = 'Safety analysis not available for this log format.';
                    } else if (message.error) {
                        const status = document.getElementById('ai-analysis-status');
                        if (status) status.textContent = `Safety analysis could not complete: ${message.error}`;
                    }
                } catch (err) {
                    render_ai_analysis_error(err);
                } finally {
                    worker.terminate();
                    if (activeAnalysisWorker === worker) activeAnalysisWorker = null;
                }
                return;
            }
        };
        worker.onerror = function(error) {
            console.error('Analysis worker failed:', error);
            worker.terminate();
            if (activeAnalysisWorker === worker) activeAnalysisWorker = null;
            render_file_picker('The background analyzer failed to start. Reload the page and try again.');
        };
        worker.postMessage({ type: 'analyze', buffer: event.target.result, filename: file.name }, [event.target.result]);
    };
    reader.onerror = () => render_file_picker('The browser could not read that file.');
    reader.onprogress = event => {
        if (event.lengthComputable) render_analysis_progress(file.name, 'loading', event.loaded / event.total);
    };
    reader.readAsArrayBuffer(file);
}

async function init_main_plot() {
    const plot = document.getElementById('plot');
    if (!plot) return;

    activeTraces = [];

    const colors = get_plot_theme();
    const layout = {
        title: {
            text: '',
            font: { color: colors.text, size: 14 }
        },
        paper_bgcolor: colors.background,
        plot_bgcolor: colors.background,
        showlegend: false,
        hovermode: 'x unified',
        hoverdistance: 80,
        autosize: true,
        margin: { l: 64, r: 64, t: 24, b: 46 },
        xaxis: {
            color: colors.muted,
            gridcolor: colors.grid,
            zerolinecolor: colors.zero,
            showspikes: true,
            spikemode: 'across',
            spikesnap: 'cursor',
            spikecolor: colors.text,
            spikethickness: 1,
            rangeslider: { visible: true, thickness: 0.07, bgcolor: colors.slider, bordercolor: colors.grid }
        },
        yaxis: {
            title: 'Value',
            color: colors.primary,
            gridcolor: colors.grid,
            zerolinecolor: colors.zero,
            fixedrange: false
        },
        yaxis2: {
            title: '',
            color: colors.secondary,
            overlaying: 'y',
            side: 'right',
            gridcolor: 'transparent'
        },
        uirevision: 'aerovane-log'
    };

    const config = {
        responsive: true,
        scrollZoom: true,
        displaylogo: false,
        modeBarButtonsToRemove: ['lasso2d', 'select2d']
    };

    await Plotly.newPlot(plot, [], layout, config);
    plot.on('plotly_hover', event => {
        const time = event?.points?.[0]?.x;
        if (time != null && typeof set_map_cursor_time === 'function') set_map_cursor_time(time);
    });
    render_active_traces_pill_bar();
}

function get_plot_theme() {
    const dark = document.documentElement.dataset.theme === 'dark';
    return dark
        ? { background: '#111820', text: '#e6edf5', muted: '#9aabba', grid: '#293746', zero: '#405164', slider: '#17212c', primary: '#56b4e9', secondary: '#45c495' }
        : { background: '#ffffff', text: '#16202d', muted: '#66778a', grid: '#e6ebf1', zero: '#c9d3df', slider: '#f5f8fb', primary: '#1268a8', secondary: '#16835d' };
}

function reset_graph_view() {
    const plot = document.getElementById('plot');
    if (!plot || !window.Plotly) return;
    Plotly.relayout(plot, { 'xaxis.autorange': true, 'yaxis.autorange': true, 'yaxis2.autorange': true });
}

function apply_plot_theme() {
    const plot = document.getElementById('plot');
    if (!plot || !plot.data || !window.Plotly) return;
    const colors = get_plot_theme();
    Plotly.relayout(plot, {
        paper_bgcolor: colors.background, plot_bgcolor: colors.background,
        'font.color': colors.text, 'xaxis.color': colors.muted, 'xaxis.gridcolor': colors.grid,
        'xaxis.zerolinecolor': colors.zero, 'xaxis.spikecolor': colors.text,
        'xaxis.rangeslider.bgcolor': colors.slider, 'xaxis.rangeslider.bordercolor': colors.grid,
        'yaxis.color': colors.primary, 'yaxis.gridcolor': colors.grid, 'yaxis.zerolinecolor': colors.zero,
        'yaxis2.color': colors.secondary
    });
}

function set_theme(theme) {
    const normalized = theme === 'dark' ? 'dark' : 'light';
    document.documentElement.dataset.theme = normalized;
    document.documentElement.style.colorScheme = normalized;
    const icon = document.getElementById('theme-icon');
    if (icon) icon.textContent = normalized === 'dark' ? 'Sun' : 'Moon';
    const button = document.getElementById('theme-toggle');
    if (button) button.setAttribute('aria-label', normalized === 'dark' ? 'Switch to light theme' : 'Switch to dark theme');
    try {
        localStorage.setItem('aerovane-theme', normalized);
        localStorage.setItem('aerovane-theme', normalized);
    } catch (_) { /* private mode */ }
    window.dispatchEvent(new CustomEvent('aerovane-theme-change', { detail: { theme: normalized } }));
    window.dispatchEvent(new CustomEvent('aerovane-theme-change', { detail: { theme: normalized } }));
    apply_plot_theme();
}

function toggle_theme() { set_theme(document.documentElement.dataset.theme === 'dark' ? 'light' : 'dark'); }

function init_theme() {
    let saved = null;
    try { saved = localStorage.getItem('aerovane-theme') || localStorage.getItem('aerovane-theme'); } catch (_) { /* private mode */ }
    const preferred = window.matchMedia?.('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
    set_theme(saved || preferred);
}

function plot_default_signal(lf) {
    const preferredSignals = [
        ['BARO', 'Alt'],
        ['GPS', 'Alt'],
        ['ATT', 'Pitch'],
        ['ATT', 'Roll'],
        ['BAT', 'Volt'],
        ['CURR', 'Volt']
    ];

    for (const [msg, field] of preferredSignals) {
        if (lf.msgtype_name_hash[msg] != null) {
            const ds = lf.get_data_series(msg, -1, field);
            if (ds && ds.y.length > 0) {
                add_trace_to_plot(ds, 'y');
                return;
            }
        }
    }

    // Fallback: first available numeric field from any message
    const msgList = lf.get_msgitem_list();
    for (const msg of msgList) {
        for (const sub of msg.subitemlist) {
            if (sub === 'TimeUS' || sub === 'TimeMS') continue;
            const ds = lf.get_data_series(msg.name, -1, sub);
            if (ds && ds.y.length > 0 && typeof ds.y[0] === 'number') {
                add_trace_to_plot(ds, 'y');
                return;
            }
        }
    }
}

function toggle_graph_fullscreen() {
    const workspace = document.querySelector('.workspace-grid');
    if (!workspace) return;

    const isFullscreen = workspace.classList.toggle('fullscreen-workspace');
    const btn = document.getElementById('graph-fullscreen-btn');
    if (btn) {
        btn.textContent = isFullscreen ? 'Exit focus mode' : 'Focus mode';
    }

    const mapCard = document.querySelector('.map-card');
    if (mapCard) {
        mapCard.style.display = isFullscreen ? 'none' : (currentGpsData ? 'block' : 'none');
    }

    setTimeout(() => {
        const plot = document.getElementById('plot');
        if (plot && window.Plotly) {
            Plotly.Plots.resize(plot);
        }
    }, 150);
}

function toggle_mobile_sidebar() {
    const sidebar = document.querySelector('.sidebar');
    if (sidebar) {
        sidebar.classList.toggle('mobile-open');
    }
}

function scroll_analysis_section(id, button) {
    document.getElementById(id)?.scrollIntoView({ behavior: 'smooth', block: 'start' });
    document.querySelectorAll('.analysis-nav button').forEach(item => item.classList.toggle('active', item === button));
}

// Global escape key handler to exit any fullscreen mode
document.addEventListener('keydown', function(e) {
    if (e.key === 'Escape') {
        const workspace = document.querySelector('.workspace-grid');
        if (workspace && workspace.classList.contains('fullscreen-workspace')) {
            toggle_graph_fullscreen();
        }

        const mapCard = document.querySelector('.map-card');
        if (mapCard && mapCard.classList.contains('fullscreen-active')) {
            toggle_map_fullscreen();
        }
    }
});

// Window resize handler for Plotly and Leaflet
window.addEventListener('resize', function() {
    const plot = document.getElementById('plot');
    if (plot && window.Plotly) {
        Plotly.Plots.resize(plot);
    }
    if (leafletMap?.resize) leafletMap.resize();
});

function handle_ondrop(event) {
    event.preventDefault();
    if (event.dataTransfer && event.dataTransfer.files) {
        readfiles(event.dataTransfer.files);
    }
}

function handle_dragover(event) {
    event.preventDefault();
    event.dataTransfer.dropEffect = 'copy';
}

function handle_dragenter(event) {
    event.preventDefault();
}

function handle_onfilechange(event) {
    if (event.currentTarget && event.currentTarget.files) {
        readfiles(event.currentTarget.files);
    }
}

function is_dataflash(fname) {
    if (!fname) return false;
    const ext = fname.split(".").pop().toLowerCase();
    return ext === "bin" || ext === "log";
}

function escape_app_html(value) {
    const node = document.createElement('span');
    node.textContent = String(value);
    return node.innerHTML;
}

init_theme();
