/* SkyForge Flight Trajectory Map & Overview Generator */

function coord2dist(a, b) {
    const earthradius = 6378388.0; /* Earth Radius in meters */
    const difflat = (a.lat - b.lat) * Math.PI / 180.0;
    const difflon = (a.lon - b.lon) * Math.PI / 180.0;
    const lat1 = a.lat * Math.PI / 180.0;
    const lat2 = b.lat * Math.PI / 180.0;

    const sinLat = Math.sin(difflat / 2);
    const sinLon = Math.sin(difflon / 2);
    const h = sinLat * sinLat + Math.cos(lat1) * Math.cos(lat2) * sinLon * sinLon;
    const c = 2 * Math.atan2(Math.sqrt(h), Math.sqrt(1 - h));
    return earthradius * c;
}

function formatDuration(ms) {
    if (!ms || isNaN(ms) || ms <= 0) return "0s";
    const totalSecs = Math.floor(ms / 1000);
    const hrs = Math.floor(totalSecs / 3600);
    const mins = Math.floor((totalSecs % 3600) / 60);
    const secs = totalSecs % 60;

    if (hrs > 0) return `${hrs}h ${mins}m ${secs}s`;
    if (mins > 0) return `${mins}m ${secs}s`;
    return `${secs}s`;
}

function draw_flight_map(gpsds) {
    const mapDiv = document.getElementById('map');
    if (!mapDiv) return;

    if (!gpsds || !gpsds.lat || gpsds.lat.length === 0) {
        mapDiv.style.display = "none";
        return;
    }

    mapDiv.style.display = "block";

    const pathTrace = {
        x: gpsds.lon,
        y: gpsds.lat,
        mode: 'lines',
        name: 'Flight Path',
        line: {
            color: '#38bdf8',
            width: 3
        },
        hoverinfo: 'text',
        text: gpsds.alt && gpsds.alt.length ? gpsds.alt.map((a, i) => `Alt: ${a.toFixed(1)}m | Spd: ${(gpsds.vel[i] * 3.6).toFixed(1)} km/h`) : 'GPS Point'
    };

    const startPoint = {
        x: [gpsds.lon[0]],
        y: [gpsds.lat[0]],
        mode: 'markers',
        name: 'Takeoff (Start)',
        marker: { color: '#22c55e', size: 10, symbol: 'circle' }
    };

    const endPoint = {
        x: [gpsds.lon[gpsds.lon.length - 1]],
        y: [gpsds.lat[gpsds.lat.length - 1]],
        mode: 'markers',
        name: 'Landing (End)',
        marker: { color: '#ef4444', size: 10, symbol: 'circle' }
    };

    const layout = {
        title: {
            text: '2D GPS Flight Path',
            font: { color: '#f8fafc', size: 14 }
        },
        paper_bgcolor: '#0f172a',
        plot_bgcolor: '#1e293b',
        showlegend: true,
        legend: { orientation: 'h', y: 1.1, font: { color: '#94a3b8' } },
        margin: { l: 60, r: 30, t: 40, b: 50 },
        xaxis: {
            title: 'Longitude',
            color: '#94a3b8',
            gridcolor: '#334155',
            zerolinecolor: '#475569'
        },
        yaxis: {
            title: 'Latitude',
            color: '#94a3b8',
            gridcolor: '#334155',
            zerolinecolor: '#475569',
            scaleanchor: "x",
            scaleratio: 1
        }
    };

    const config = { responsive: true, displayModeBar: true };
    Plotly.newPlot('map', [pathTrace, startPoint, endPoint], layout, config);
}

function get_overview(gpsds, boot_time, logfileRef) {
    // 1. Logging Start
    const elStart = document.getElementById('logstart');
    if (elStart) {
        if (boot_time > 0) {
            elStart.textContent = new Date(boot_time).toLocaleString();
        } else {
            elStart.textContent = "Relative Time (No GPS Absolute Epoch)";
        }
    }

    // 2. Logging Duration
    let totalDurationMs = 0;
    if (gpsds && gpsds.time && gpsds.time.length > 0) {
        const lastT = gpsds.time[gpsds.time.length - 1];
        const firstT = gpsds.time[0];
        if (lastT instanceof Date && firstT instanceof Date) {
            totalDurationMs = lastT.getTime() - firstT.getTime();
        } else if (typeof lastT === 'number' && typeof firstT === 'number') {
            totalDurationMs = (lastT - firstT) * 1000;
        }
    }
    const elDur = document.getElementById('logduration');
    if (elDur) elDur.textContent = formatDuration(totalDurationMs);

    // 3. Flight Metrics
    let totalDistanceM = 0;
    let flyingTimeMs = 0;
    let isFlying = false;
    let flyingStartMs = 0;
    let lastPos = null;

    if (gpsds && gpsds.lat && gpsds.lat.length > 1) {
        for (let i = 0; i < gpsds.lat.length; i++) {
            const pos = {
                lat: gpsds.lat[i],
                lon: gpsds.lon[i],
                vel: gpsds.vel[i] || 0,
                time: (gpsds.time[i] instanceof Date) ? gpsds.time[i].getTime() : (gpsds.time[i] * 1000)
            };
            const status = gpsds.status ? gpsds.status[i] : 3;

            if (!isFlying && status >= 3 && pos.vel > 1.5) {
                isFlying = true;
                flyingStartMs = pos.time;
                lastPos = pos;
            } else if (isFlying && pos.vel < 0.8) {
                isFlying = false;
                flyingTimeMs += (pos.time - flyingStartMs);
            }

            if (isFlying && lastPos) {
                totalDistanceM += coord2dist(pos, lastPos);
                lastPos = pos;
            }
        }
        if (isFlying) {
            const lastTime = (gpsds.time[gpsds.time.length - 1] instanceof Date) 
                ? gpsds.time[gpsds.time.length - 1].getTime() 
                : (gpsds.time[gpsds.time.length - 1] * 1000);
            flyingTimeMs += (lastTime - flyingStartMs);
        }
    }

    // 4. Altitude Delta
    let altDiffM = 0;
    if (gpsds && gpsds.alt && gpsds.alt.length > 0) {
        altDiffM = Math.max(0, (gpsds.altmax || 0) - (gpsds.altmin || 0));
    }

    const elDist = document.getElementById('distance');
    if (elDist) elDist.textContent = (totalDistanceM / 1000.0).toFixed(2) + " km";

    const elAlt = document.getElementById('maxaltdiff');
    if (elAlt) elAlt.textContent = altDiffM.toFixed(1) + " m";

    const elFly = document.getElementById('flighttime');
    if (elFly) elFly.textContent = formatDuration(flyingTimeMs);

    const elAvg = document.getElementById('avgspeed');
    if (elAvg) {
        const speedKmh = flyingTimeMs > 0 ? (totalDistanceM / (flyingTimeMs / 1000)) * 3.6 : 0;
        elAvg.textContent = speedKmh.toFixed(1) + " km/h";
    }

    const elMax = document.getElementById('maxspeed');
    if (elMax) {
        const maxKmh = (gpsds && gpsds.velmax) ? (gpsds.velmax * 3.6) : 0;
        elMax.textContent = maxKmh.toFixed(1) + " km/h";
    }
}
