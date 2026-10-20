/* AeroVane Signal Explorer & Sidebar Navigation */

let activeTraces = [];
const TRACE_COLORS = [
    '#38bdf8', '#10b981', '#f59e0b', '#ec4899', 
    '#8b5cf6', '#06b6d4', '#f97316', '#84cc16',
    '#e11d48', '#3b82f6', '#14b8a6', '#d946ef'
];

function build_navbar(itemlist) {
    const nav = document.querySelector('nav');
    if (!nav) return;

    nav.innerHTML = `
        <div class="sidebar-header">
            <h3>Signals & Messages</h3>
            <input type="text" id="signalSearch" placeholder="Search signals (e.g. Alt, Pitch)..." oninput="filter_signals(this.value)">
        </div>
        <ul id="msglist"></ul>
    `;

    const vl = document.getElementById('msglist');
    for (let i = 0; i < itemlist.length; i++) {
        const msgt = itemlist[i];
        if (!msgt || !msgt.name) continue;

        if (msgt.with_instances && Array.isArray(msgt.data)) {
            let instanceFound = false;
            for (let inst = 0; inst < msgt.data.length; inst++) {
                if (msgt.data[inst] && msgt.data[inst].length > 0) {
                    const entry = create_entry(msgt, inst);
                    vl.appendChild(entry);
                    instanceFound = true;
                }
            }
            if (!instanceFound) {
                const entry = create_entry(msgt, -1);
                vl.appendChild(entry);
            }
        } else {
            const count = Array.isArray(msgt.data) ? msgt.data.length : 0;
            if (count > 0 || msgt.subitemlist.length > 0) {
                const entry = create_entry(msgt, -1);
                vl.appendChild(entry);
            }
        }
    }
}

function create_entry(msgt, instance) {
    const entry = document.createElement('li');
    const msgId = msgt.name + (instance >= 0 ? "_" + instance : "");
    entry.id = msgId;
    entry.className = "msg-group";

    let count = 0;
    if (msgt.with_instances && instance >= 0 && msgt.data[instance]) {
        count = msgt.data[instance].length;
    } else if (Array.isArray(msgt.data)) {
        count = msgt.data.length;
    }

    const header = document.createElement('div');
    header.className = "msg-header";
    header.innerHTML = `
        <span class="msg-title">
            <span class="caret-icon">▶</span>
            <strong>${msgt.name}${instance >= 0 ? ` [${instance}]` : ''}</strong>
        </span>
        <span class="msg-count">${count.toLocaleString()}</span>
    `;

    header.addEventListener("click", function() {
        const group = this.parentElement;
        const nested = group.querySelector(".nested");
        const icon = group.querySelector(".caret-icon");
        if (nested) {
            const isOpen = nested.classList.toggle("active");
            icon.textContent = isOpen ? "▼" : "▶";
        }
    });

    entry.appendChild(header);

    const ul = document.createElement('ul');
    ul.className = "nested";
    const subitems = msgt.subitemlist || [];

    for (let si = 0; si < subitems.length; si++) {
        const subname = subitems[si];
        // Skip timestamp in field selector
        if (subname === "TimeUS" || subname === "TimeMS") continue;

        const li = document.createElement('li');
        li.className = "signal-item";
        li.dataset.group = msgt.name;
        li.dataset.instance = instance >= 0 ? instance : -1;
        li.dataset.field = subname;
        li.innerHTML = `
            <span class="signal-name">${subname}</span>
            <button class="add-btn" title="Plot signal">+</button>
        `;

        li.addEventListener("click", function(e) {
            e.stopPropagation();
            toggle_signal_plot(msgt.name, instance, subname);
        });

        ul.appendChild(li);
    }

    entry.appendChild(ul);
    return entry;
}

function filter_signals(query) {
    const q = query.toLowerCase().trim();
    const groups = document.querySelectorAll(".msg-group");

    groups.forEach(group => {
        const title = group.querySelector("strong")?.textContent.toLowerCase() || "";
        const signals = group.querySelectorAll(".signal-item");
        let hasMatchingSignal = false;

        signals.forEach(sig => {
            const field = sig.dataset.field.toLowerCase();
            const full = `${sig.dataset.group}.${field}`.toLowerCase();
            if (q === "" || field.includes(q) || full.includes(q) || title.includes(q)) {
                sig.style.display = "flex";
                hasMatchingSignal = true;
            } else {
                sig.style.display = "none";
            }
        });

        if (q === "" || hasMatchingSignal || title.includes(q)) {
            group.style.display = "block";
            const nested = group.querySelector(".nested");
            const icon = group.querySelector(".caret-icon");
            if (q !== "" && nested && hasMatchingSignal) {
                nested.classList.add("active");
                if (icon) icon.textContent = "▼";
            }
        } else {
            group.style.display = "none";
        }
    });
}

function toggle_signal_plot(msgName, instance, fieldName) {
    const lf = document.logfile;
    if (!lf) return;

    const seriesName = msgName + (instance >= 0 ? instance : "") + "." + fieldName;
    const existingIdx = activeTraces.findIndex(t => t.name.startsWith(seriesName));

    if (existingIdx >= 0) {
        remove_trace(existingIdx);
    } else {
        const ds = lf.get_data_series(msgName, instance, fieldName);
        if (!ds || ds.y.length === 0) {
            alert(`No data points found for ${seriesName}`);
            return;
        }
        add_trace_to_plot(ds);
    }
}

function add_trace_to_plot(ds, axisId = 'y') {
    const plot = document.getElementById('plot');
    if (!plot) return;

    if (activeTraces.length >= 12) {
        alert('For a readable graph, AeroVane supports up to 12 signals at once. Remove a signal before adding another.');
        return;
    }
    ds = sanitize_signal(ds);
    if (!ds.x.length) return;
    ds = downsample_signal(ds, 8000);
    const unit = infer_signal_unit(ds.name);
    const currentUnits = new Set(activeTraces.map(trace => trace.unit));
    if (!currentUnits.has(unit) && currentUnits.size >= 2) {
        show_graph_notice(`Remove a signal before adding ${ds.name}. The graph uses at most two unit scales at once so values remain readable.`);
        return;
    }
    if (axisId === 'y' && activeTraces.length > 0) axisId = activeTraces.some(trace => trace.unit === unit) ? activeTraces.find(trace => trace.unit === unit).axis : 'y2';
    const color = TRACE_COLORS[activeTraces.length % TRACE_COLORS.length];
    ds.line = { color: color, width: 2 };
    ds.type = ds.x.length > 1500 ? 'scattergl' : 'scatter';
    ds.mode = 'lines';
    ds.yaxis = axisId;
    ds.name = `${ds.name}:${axisId}`;

    Plotly.addTraces(plot, ds);
    activeTraces.push({ name: ds.name, axis: axisId, color: color, unit });
    update_axis_titles();
    render_active_traces_pill_bar();
}

function sanitize_signal(series) {
    const output = { ...series, x: [], y: [] };
    for (let index = 0; index < Math.min(series.x?.length || 0, series.y?.length || 0); index++) {
        const value = Number(series.y[index]);
        if (!Number.isFinite(value) || !is_plausible_signal_value(series.name, value)) continue;
        output.x.push(series.x[index]);
        output.y.push(value);
    }
    return output;
}

function is_plausible_signal_value(name, value) {
    const signal = String(name).toUpperCase();
    const bounds = [
        [/GPS.*\.ALT$|BARO.*\.ALT$/, -2000, 100000],
        [/GPS.*\.(SPD|VEL)$|\.SPEED$/, -50, 500],
        [/GPS.*\.(NSATS|SATS)$/, 0, 100],
        [/GPS.*\.HDOP$/, 0, 10000],
        [/\.(VOLT|VOLTAGE)$/, 0, 1000],
        [/\.(CURR|CURRENT)$/, -10000, 10000],
        [/\.(ROLL|PITCH)$/, -3600, 3600],
        [/\.YAW$/, -7200, 7200],
        [/\.(VIBEX|VIBEY|VIBEZ|ACCX|ACCY|ACCZ)$/, -10000, 10000],
        [/\.(TEMP|TEMPERATURE)$/, -100, 1000],
    ];
    const match = bounds.find(([pattern]) => pattern.test(signal));
    if (match) return value >= match[1] && value <= match[2];
    return Math.abs(value) <= 1e12;
}

function show_graph_notice(message) {
    const notice = document.getElementById('graph-notice');
    if (!notice) return;
    notice.textContent = message;
    notice.hidden = false;
    clearTimeout(show_graph_notice.timer);
    show_graph_notice.timer = setTimeout(() => { notice.hidden = true; }, 6000);
}

function infer_signal_unit(name) {
    const field = String(name).split('.').pop().toLowerCase();
    if (/volt|voltage/.test(field)) return 'V';
    if (/curr|current/.test(field)) return 'A';
    if (/alt|height|dist/.test(field)) return 'm';
    if (/spd|speed|vel|crt|climb/.test(field)) return 'm/s';
    if (/roll|pitch|yaw/.test(field)) return 'deg';
    if (/vib|acc/.test(field)) return 'm/s²';
    if (/gyr/.test(field)) return 'rad/s';
    if (/temp/.test(field)) return '°C';
    if (/rpm/.test(field)) return 'rpm';
    if (/sat|clip/.test(field)) return 'count';
    if (/pct|percent|rem/.test(field)) return '%';
    return 'value';
}

function update_axis_titles() {
    const left = [...new Set(activeTraces.filter(trace => trace.axis === 'y').map(trace => trace.unit))].join(' / ') || 'Value';
    const right = [...new Set(activeTraces.filter(trace => trace.axis === 'y2').map(trace => trace.unit))].join(' / ') || '';
    Plotly.relayout('plot', { 'yaxis.title.text': left, 'yaxis2.title.text': right });
}

function downsample_signal(series, limit) {
    if (!series?.x || series.x.length <= limit) return series;
    const output = { ...series, x: [], y: [] };
    const bucket = Math.ceil(series.x.length / (limit / 2));
    for (let start = 0; start < series.x.length; start += bucket) {
        const end = Math.min(series.x.length, start + bucket);
        let min = start, max = start;
        for (let index = start + 1; index < end; index++) {
            if (series.y[index] < series.y[min]) min = index;
            if (series.y[index] > series.y[max]) max = index;
        }
        [min, max].sort((a, b) => a - b).forEach(index => { output.x.push(series.x[index]); output.y.push(series.y[index]); });
    }
    return output;
}

const SIGNAL_PRESETS = {
    battery: [['BAT', 'Volt'], ['BAT', 'Curr'], ['CURR', 'Volt'], ['CURR', 'Curr']],
    attitude: [['ATT', 'Roll'], ['ATT', 'DesRoll'], ['ATT', 'Pitch'], ['ATT', 'DesPitch'], ['ATT', 'Yaw']],
    gps: [['GPS', 'Alt'], ['GPS', 'Spd']],
    vibration: [['VIBE', 'VibeX'], ['VIBE', 'VibeY'], ['VIBE', 'VibeZ'], ['IMU', 'AccX'], ['IMU', 'AccY'], ['IMU', 'AccZ']],
    ekf: [['XKF4', 'SV'], ['XKF4', 'SP'], ['XKF4', 'SH'], ['NKF4', 'SV'], ['NKF4', 'SP']]
};

function apply_signal_preset(name) {
    const log = document.logfile;
    if (!log || !SIGNAL_PRESETS[name]) return;
    clear_all_traces();
    for (const [message, field] of SIGNAL_PRESETS[name]) {
        if (log.msgtype_name_hash[message] == null) continue;
        const data = log.get_data_series(message, -1, field);
        if (data?.y?.length) add_trace_to_plot(data);
    }
    if (!activeTraces.length) alert(`This log does not contain the signals required for the ${name} preset.`);
}

function remove_trace(traceIndex) {
    const plot = document.getElementById('plot');
    if (!plot || traceIndex < 0 || traceIndex >= activeTraces.length) return;

    Plotly.deleteTraces(plot, traceIndex);
    activeTraces.splice(traceIndex, 1);
    update_axis_titles();
    render_active_traces_pill_bar();
}

function clear_all_traces() {
    const plot = document.getElementById('plot');
    if (!plot) return;

    if (activeTraces.length) Plotly.deleteTraces(plot, activeTraces.map((_, index) => index));
    activeTraces = [];
    update_axis_titles();
    render_active_traces_pill_bar();
}

function change_trace_axis(traceIndex, newAxis) {
    const plot = document.getElementById('plot');
    if (!plot || traceIndex < 0 || traceIndex >= activeTraces.length) return;

    const tr = activeTraces[traceIndex];
    const baseName = tr.name.split(":")[0];
    tr.axis = newAxis;
    tr.name = `${baseName}:${newAxis}`;

    Plotly.restyle(plot, { yaxis: newAxis, name: tr.name }, traceIndex);
    update_axis_titles();
    render_active_traces_pill_bar();
}

function render_active_traces_pill_bar() {
    const container = document.getElementById('active-traces-bar');
    if (!container) return;

    if (activeTraces.length === 0) {
        container.innerHTML = `<span class="empty-hint">No active plots. Click any signal on the left sidebar to graph it.</span>`;
        return;
    }

    container.innerHTML = activeTraces.map((t, idx) => `
        <div class="trace-pill" style="border-left-color: ${t.color}">
            <span class="trace-color-dot" style="background-color: ${t.color}"></span>
            <span class="trace-label">${t.name.split(':')[0]}</span>
            <select class="axis-select" onchange="change_trace_axis(${idx}, this.value)">
                <option value="y" ${t.axis === 'y' ? 'selected' : ''}>Left · ${t.unit}</option>
                <option value="y2" ${t.axis === 'y2' ? 'selected' : ''}>Right · ${t.unit}</option>
            </select>
            <button class="trace-remove-btn" onclick="remove_trace(${idx})" title="Remove trace">&times;</button>
        </div>
    `).join('');
}
