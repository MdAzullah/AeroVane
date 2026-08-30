/* SkyForge Geographic Flight Path & Real-World Map Visualizer (Leaflet)
   Clean 4-layer selection, collapsible controls, and fullscreen support */

let leafletMap = null;
let flightPolyline = null;
let takeoffMarker = null;
let landingMarker = null;
let droneHoverMarker = null;
let currentGpsData = null;

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

function init_or_get_map(centerLat, centerLon, zoom = 15) {
    const mapContainer = document.getElementById('map');
    if (!mapContainer) return null;

    if (leafletMap) {
        leafletMap.setView([centerLat, centerLon], zoom);
        return leafletMap;
    }

    // Initialize Leaflet Map
    leafletMap = L.map('map', {
        center: [centerLat, centerLon],
        zoom: zoom,
        zoomControl: true,
        attributionControl: true
    });

    // 1. Hybrid Satellite Layer (Satellite + Roads + Location Names)
    const satelliteHybrid = L.layerGroup([
        L.tileLayer('https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}', {
            maxZoom: 19,
            attribution: 'Tiles &copy; Esri &mdash; Satellite Imagery'
        }),
        L.tileLayer('https://server.arcgisonline.com/ArcGIS/rest/services/Reference/World_Transportation/MapServer/tile/{z}/{y}/{x}', {
            maxZoom: 19
        }),
        L.tileLayer('https://server.arcgisonline.com/ArcGIS/rest/services/Reference/World_Boundaries_and_Places/MapServer/tile/{z}/{y}/{x}', {
            maxZoom: 19
        })
    ]);

    // 2. OpenStreetMap (Detailed Street & Place Names)
    const streetOsm = L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
        maxZoom: 19,
        attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors'
    });

    // 3. Topographic Terrain Layer
    const esriTopo = L.tileLayer('https://server.arcgisonline.com/ArcGIS/rest/services/World_Topo_Map/MapServer/tile/{z}/{y}/{x}', {
        maxZoom: 19,
        attribution: '&copy; Esri &mdash; Topo & Terrain'
    });

    // 4. Dark Mode Layer
    const cartoDark = L.tileLayer('https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png', {
        maxZoom: 19,
        attribution: '&copy; <a href="https://carto.com/">CARTO</a>'
    });

    // Default to Hybrid Satellite
    satelliteHybrid.addTo(leafletMap);

    const baseMaps = {
        "🛰️ Hybrid Satellite": satelliteHybrid,
        "🗺️ Streets (OSM)": streetOsm,
        "🏔️ Topo Terrain": esriTopo,
        "🌙 Dark Mode": cartoDark
    };

    // Collapsible layer selector (can be opened and closed easily)
    L.control.layers(baseMaps, null, { position: 'topright', collapsed: true }).addTo(leafletMap);
    L.control.scale({ imperial: false, position: 'bottomleft' }).addTo(leafletMap);

    return leafletMap;
}

function draw_flight_map(gpsds) {
    const mapCard = document.querySelector('.map-card');
    const mapContainer = document.getElementById('map');
    if (!mapContainer) return;

    if (!gpsds || !gpsds.lat || gpsds.lat.length === 0) {
        if (mapCard) mapCard.style.display = "none";
        return;
    }

    if (mapCard) mapCard.style.display = "block";
    currentGpsData = gpsds;

    const latlngs = [];
    for (let i = 0; i < gpsds.lat.length; i++) {
        latlngs.push([gpsds.lat[i], gpsds.lon[i]]);
    }

    const map = init_or_get_map(gpsds.cenlat, gpsds.cenlon);
    if (!map) return;

    // Clear previous flight path & markers
    if (flightPolyline) map.removeLayer(flightPolyline);
    if (takeoffMarker) map.removeLayer(takeoffMarker);
    if (landingMarker) map.removeLayer(landingMarker);
    if (droneHoverMarker) map.removeLayer(droneHoverMarker);

    // 1. Polyline Shadow + Glowing Flight Path
    flightPolyline = L.polyline(latlngs, {
        color: '#38bdf8',
        weight: 3.5,
        opacity: 0.95,
        lineCap: 'round',
        lineJoin: 'round'
    }).addTo(map);

    // 2. Takeoff Marker (Green)
    const takeoffLat = gpsds.lat[0];
    const takeoffLon = gpsds.lon[0];
    const takeoffAlt = gpsds.alt && gpsds.alt.length ? gpsds.alt[0].toFixed(1) + "m" : "N/A";
    const takeoffTime = (gpsds.time && gpsds.time[0] instanceof Date) ? gpsds.time[0].toLocaleTimeString() : "Start";

    takeoffMarker = L.circleMarker([takeoffLat, takeoffLon], {
        radius: 8,
        fillColor: '#22c55e',
        color: '#ffffff',
        weight: 2,
        opacity: 1,
        fillOpacity: 0.95
    }).addTo(map);

    takeoffMarker.bindPopup(`
        <div style="font-family: sans-serif; font-size: 13px; min-width: 140px;">
            <strong style="color: #22c55e;">🟢 Takeoff (Start)</strong><br>
            <strong>Time:</strong> ${takeoffTime}<br>
            <strong>Alt:</strong> ${takeoffAlt}<br>
            <strong>Lat/Lon:</strong> ${takeoffLat.toFixed(6)}, ${takeoffLon.toFixed(6)}
        </div>
    `);

    // 3. Landing Marker (Red)
    const lastIdx = gpsds.lat.length - 1;
    const landingLat = gpsds.lat[lastIdx];
    const landingLon = gpsds.lon[lastIdx];
    const landingAlt = gpsds.alt && gpsds.alt.length ? gpsds.alt[lastIdx].toFixed(1) + "m" : "N/A";
    const landingTime = (gpsds.time && gpsds.time[lastIdx] instanceof Date) ? gpsds.time[lastIdx].toLocaleTimeString() : "End";

    landingMarker = L.circleMarker([landingLat, landingLon], {
        radius: 8,
        fillColor: '#ef4444',
        color: '#ffffff',
        weight: 2,
        opacity: 1,
        fillOpacity: 0.95
    }).addTo(map);

    landingMarker.bindPopup(`
        <div style="font-family: sans-serif; font-size: 13px; min-width: 140px;">
            <strong style="color: #ef4444;">🔴 Landing (End)</strong><br>
            <strong>Time:</strong> ${landingTime}<br>
            <strong>Alt:</strong> ${landingAlt}<br>
            <strong>Lat/Lon:</strong> ${landingLat.toFixed(6)}, ${landingLon.toFixed(6)}
        </div>
    `);

    // Fit view to bounds
    const bounds = flightPolyline.getBounds();
    map.fitBounds(bounds, { padding: [45, 45], maxZoom: 18 });

    setTimeout(() => {
        map.invalidateSize();
    }, 100);
}

function fit_flight_path() {
    if (leafletMap && flightPolyline) {
        leafletMap.fitBounds(flightPolyline.getBounds(), { padding: [45, 45], maxZoom: 18 });
    }
}

function toggle_map_fullscreen() {
    const mapCard = document.querySelector('.map-card');
    if (!mapCard) return;

    const isFullscreen = mapCard.classList.toggle('fullscreen-active');
    const btn = document.getElementById('map-fullscreen-btn');
    if (btn) {
        btn.textContent = isFullscreen ? '✕ Exit Fullscreen' : '⛶ Fullscreen';
    }

    setTimeout(() => {
        if (leafletMap) {
            leafletMap.invalidateSize();
            fit_flight_path();
        }
    }, 150);
}

function get_overview(gpsds, boot_time, logfileRef) {
    const elStart = document.getElementById('logstart');
    if (elStart) {
        if (boot_time > 0) {
            elStart.textContent = new Date(boot_time).toLocaleString();
        } else {
            elStart.textContent = "Relative Time (No GPS Epoch)";
        }
    }

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
