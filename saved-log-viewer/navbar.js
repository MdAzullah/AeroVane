/* SkyForge Signal Explorer & Sidebar Navigation */

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

    const color = TRACE_COLORS[activeTraces.length % TRACE_COLORS.length];
    ds.line = { color: color, width: 2 };
    ds.yaxis = axisId;
    ds.name = `${ds.name}:${axisId}`;

    Plotly.addTraces(plot, ds);
    activeTraces.push({ name: ds.name, axis: axisId, color: color });
    render_active_traces_pill_bar();
}

function remove_trace(traceIndex) {
    const plot = document.getElementById('plot');
    if (!plot || traceIndex < 0 || traceIndex >= activeTraces.length) return;

    Plotly.deleteTraces(plot, traceIndex);
    activeTraces.splice(traceIndex, 1);
    render_active_traces_pill_bar();
}

function clear_all_traces() {
    const plot = document.getElementById('plot');
    if (!plot) return;

    while (activeTraces.length > 0) {
        Plotly.deleteTraces(plot, 0);
        activeTraces.shift();
    }
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
                <option value="y" ${t.axis === 'y' ? 'selected' : ''}>Y1</option>
                <option value="y2" ${t.axis === 'y2' ? 'selected' : ''}>Y2</option>
                <option value="y3" ${t.axis === 'y3' ? 'selected' : ''}>Y3</option>
                <option value="y4" ${t.axis === 'y4' ? 'selected' : ''}>Y4</option>
            </select>
            <button class="trace-remove-btn" onclick="remove_trace(${idx})" title="Remove trace">&times;</button>
        </div>
    `).join('');
}
