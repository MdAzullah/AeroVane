/* SkyForge Main App Controller */

function readfiles(files) {
    if (!files || files.length === 0) return;
    const file = files[0];

    if (!is_dataflash(file.name)) {
        alert("Please select a valid ArduPilot dataflash (.bin or .log) file.");
        return;
    }

    const dropCard = document.querySelector('.drop-card');
    if (dropCard) {
        dropCard.classList.add('loading');
        dropCard.innerHTML = `<div class="spinner"></div><p>Parsing <strong>${file.name}</strong> (${(file.size / (1024 * 1024)).toFixed(2)} MB)...</p>`;
    }

    const reader = new FileReader();
    reader.onload = function(event) {
        setTimeout(() => {
            try {
                const startTime = performance.now();
                const buffer = event.target.result;
                const lf = new logfile(buffer);
                document.logfile = lf;

                const parseDuration = ((performance.now() - startTime) / 1000).toFixed(2);
                console.log(`Parsed ${lf.totalMessages} messages in ${parseDuration}s`);

                // Restore drop card with success banner
                if (dropCard) {
                    dropCard.classList.remove('loading');
                    dropCard.innerHTML = `
                        <div class="file-loaded-info">
                            <span class="file-icon">📁</span>
                            <div>
                                <strong>${file.name}</strong>
                                <span class="file-meta">${(file.size / (1024 * 1024)).toFixed(2)} MB &bull; ${lf.totalMessages.toLocaleString()} packets parsed in ${parseDuration}s</span>
                            </div>
                            <label class="change-file-btn">
                                Change File
                                <input type="file" id="files" name="file" accept=".bin,.BIN,.log" onchange="handle_onfilechange(event)" style="display:none">
                            </label>
                        </div>
                    `;
                }

                // Show analyze workspace
                const analyzepage = document.getElementById('analyzepage');
                if (analyzepage) analyzepage.style.display = "block";

                // Build sidebar
                const msgList = lf.get_msgitem_list();
                build_navbar(msgList);

                // Initialize main plot
                init_main_plot();

                // Plot default signal
                plot_default_signal(lf);

                // GPS & Overview
                const gpsds = lf.get_gps_series();
                get_overview(gpsds, lf.get_boot_time(), lf);
                if (gpsds) {
                    draw_flight_map(gpsds);
                } else {
                    const mapDiv = document.getElementById('map');
                    if (mapDiv) mapDiv.style.display = "none";
                }

            } catch (err) {
                console.error("Error reading logfile:", err);
                alert("Error parsing logfile: " + err.message);
                if (dropCard) {
                    dropCard.classList.remove('loading');
                    dropCard.innerHTML = `
                        <p>Error parsing file. Please try another ArduPilot dataflash (.bin) file.</p>
                        <input type="file" id="files" name="file" accept=".bin,.BIN,.log" onchange="handle_onfilechange(event)">
                    `;
                }
            }
        }, 30);
    };
    reader.readAsArrayBuffer(file);
}

function init_main_plot() {
    const plot = document.getElementById('plot');
    if (!plot) return;

    activeTraces = [];

    const layout = {
        title: {
            text: 'Telemetry Time-Series Plot',
            font: { color: '#f8fafc', size: 14 }
        },
        paper_bgcolor: '#0f172a',
        plot_bgcolor: '#1e293b',
        showlegend: false,
        hovermode: 'x unified',
        margin: { l: 60, r: 60, t: 40, b: 40 },
        xaxis: {
            color: '#94a3b8',
            gridcolor: '#334155',
            zerolinecolor: '#475569'
        },
        yaxis: {
            title: 'Y1',
            color: '#38bdf8',
            gridcolor: '#334155',
            zerolinecolor: '#475569'
        },
        yaxis2: {
            title: 'Y2',
            color: '#10b981',
            overlaying: 'y',
            side: 'right',
            gridcolor: 'transparent'
        },
        yaxis3: {
            title: 'Y3',
            color: '#f59e0b',
            overlaying: 'y',
            side: 'left',
            position: 0.05,
            gridcolor: 'transparent'
        },
        yaxis4: {
            title: 'Y4',
            color: '#ec4899',
            overlaying: 'y',
            side: 'right',
            position: 0.95,
            gridcolor: 'transparent'
        }
    };

    const config = {
        responsive: true,
        displaylogo: false,
        modeBarButtonsToRemove: ['lasso2d', 'select2d']
    };

    Plotly.newPlot(plot, [], layout, config);
    render_active_traces_pill_bar();
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