/* WebGL flight map. A custom MapLibre style URL can be supplied as window.AEROVANE_MAP_STYLE_URL. */
let leafletMap = null; // Compatibility name used by main.js; contains the MapLibre instance.
let currentGpsData = null;
let aiFaultMarkers = [];
let flightBounds = null;
let droneCursorMarker = null;
let endpointMarkers = [];
let selectedMapLayer = 'street';
let lastOnlineMapLayer = 'street';
let tileFailureCount = 0;
let activeBaseLayers = [];
let activeBaseSources = [];
let localPmtilesUrl = null;
let localPmtilesName = null;

const MAPTILER_KEY = typeof window !== 'undefined' ? (window.AEROVANE_MAPTILER_KEY || window.SKYFORGE_MAPTILER_KEY || '') : '';
const MAP_STYLES = create_map_styles();

function raster_source(tiles, attribution, maxzoom = 20, tileSize = 256) {
    return { type: 'raster', tiles, tileSize, attribution, maxzoom };
}

function raster_map(id, tiles, attribution, maxzoom = 20) {
    return { sources: { [id]: raster_source(tiles, attribution, maxzoom) },
        layers: [{ id, type: 'raster', source: id, minzoom: 0, maxzoom }] };
}

function create_map_styles() {
    const osmAttribution = '© OpenStreetMap contributors © CARTO';
    const maptilerAttribution = '© MapTiler © OpenStreetMap contributors';
    const maptiler = style => `https://api.maptiler.com/maps/${style}/256/{z}/{x}/{y}.png?key=${encodeURIComponent(MAPTILER_KEY)}`;
    const carto = path => ['a', 'b', 'c'].map(host => `https://${host}.basemaps.cartocdn.com/${path}/{z}/{x}/{y}.png`);
    const topo = ['a', 'b', 'c'].map(host => `https://${host}.tile.opentopomap.org/{z}/{x}/{y}.png`);
    const street = MAPTILER_KEY
        ? raster_map('street', [maptiler('streets-v2')], maptilerAttribution, 20)
        : raster_map('street', carto('rastertiles/voyager'), osmAttribution, 20);
    const terrain = MAPTILER_KEY
        ? raster_map('terrain', [maptiler('outdoor-v2')], maptilerAttribution, 20)
        : raster_map('terrain', topo, '© OpenStreetMap contributors, SRTM | Map style © OpenTopoMap', 17);
    const dark = MAPTILER_KEY
        ? raster_map('dark', [maptiler('dataviz-dark')], maptilerAttribution, 20)
        : raster_map('dark', carto('dark_all'), osmAttribution, 20);
    const satellite = MAPTILER_KEY ? raster_map('satellite', [maptiler('hybrid')], maptilerAttribution, 20) : {
        sources: {
            satellite: raster_source(['https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}'], 'Tiles © Esri', 19),
            'satellite-labels': MAPTILER_KEY
                ? raster_source([maptiler('streets-v2')], maptilerAttribution, 20)
                : raster_source(carto('rastertiles/voyager_only_labels'), osmAttribution, 20)
        },
        layers: [
            { id: 'satellite', type: 'raster', source: 'satellite', minzoom: 0, maxzoom: 19 },
            { id: 'satellite-labels', type: 'raster', source: 'satellite-labels', minzoom: 0, maxzoom: 20, paint: { 'raster-opacity': .92 } }
        ]
    };
    return { street, satellite, terrain, dark,
        offline: { sources: {}, layers: [{ id: 'offline-background', type: 'background', paint: { 'background-color': '#0b1721' } }] } };
}

function coord2dist(a, b) {
    const radius = 6378388;
    const dLat = (a.lat - b.lat) * Math.PI / 180;
    const dLon = (a.lon - b.lon) * Math.PI / 180;
    const lat1 = a.lat * Math.PI / 180;
    const lat2 = b.lat * Math.PI / 180;
    const h = Math.sin(dLat / 2) ** 2 + Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLon / 2) ** 2;
    return radius * 2 * Math.atan2(Math.sqrt(h), Math.sqrt(1 - h));
}

function formatDuration(ms) {
    if (!ms || !Number.isFinite(ms) || ms <= 0) return '0s';
    const seconds = Math.floor(ms / 1000);
    const hours = Math.floor(seconds / 3600);
    const minutes = Math.floor((seconds % 3600) / 60);
    const remainder = seconds % 60;
    return hours ? `${hours}h ${minutes}m ${remainder}s` : minutes ? `${minutes}m ${remainder}s` : `${remainder}s`;
}

function map_style() {
    if (window.AEROVANE_MAP_STYLE_URL || window.SKYFORGE_MAP_STYLE_URL) return window.AEROVANE_MAP_STYLE_URL || window.SKYFORGE_MAP_STYLE_URL;
    const profile = base_style_for(selectedMapLayer);
    return { version: 8, sources: profile.sources, layers: profile.layers };
}

function base_style_for(layer) {
    const pmtilesUrl = localPmtilesUrl || (window.AEROVANE_PMTILES_URL || window.SKYFORGE_PMTILES_URL ? `pmtiles://${window.AEROVANE_PMTILES_URL || window.SKYFORGE_PMTILES_URL}` : null);
    if (layer === 'offline' && pmtilesUrl) {
        return {
            sources: { offline: { type: 'raster', url: pmtilesUrl, tileSize: 256, attribution: 'Offline map data' } },
            layers: [{ id: 'offline', type: 'raster', source: 'offline' }]
        };
    }
    return MAP_STYLES[layer] || MAP_STYLES.offline;
}

function preferred_theme_layer() {
    try {
        const saved = localStorage.getItem('aerovane-map-layer') || localStorage.getItem('aerovane-map-layer');
        if (saved && MAP_STYLES[saved] && saved !== 'offline') return saved;
    } catch (_) { /* Storage can be disabled in privacy mode. */ }
    return document.documentElement.dataset.theme === 'dark' ? 'dark' : 'street';
}

function set_map_offline_status(offline) {
    const map = document.getElementById('map');
    if (!map) return;
    map.classList.toggle('offline-map', offline);
    let notice = document.getElementById('offline-map-notice');
    if (offline && !notice) {
        notice = document.createElement('div'); notice.id = 'offline-map-notice'; notice.className = 'offline-map-notice';
        notice.textContent = 'Offline map · flight path and coordinates remain available'; map.appendChild(notice);
    } else if (!offline) notice?.remove();
}

function change_map_layer(layer, button, force = false) {
    if (!MAP_STYLES[layer] || (selectedMapLayer === layer && !force)) return;
    selectedMapLayer = layer;
    if (layer !== 'offline') {
        lastOnlineMapLayer = layer;
        try {
            localStorage.setItem('aerovane-map-layer', layer);
            localStorage.setItem('aerovane-map-layer', layer);
        } catch (_) { /* Optional preference only. */ }
    }
    tileFailureCount = 0;
    const selector = document.getElementById('map-layer-select');
    if (selector && layer !== 'offline') selector.value = layer;
    if (!leafletMap) return;
    set_map_offline_status(layer === 'offline');
    // Replace only the basemap. setStyle() removes every custom source/layer,
    // including the flight route, and is therefore intentionally avoided.
    activeBaseLayers.slice().reverse().forEach(id => { if (leafletMap.getLayer(id)) leafletMap.removeLayer(id); });
    activeBaseSources.forEach(id => { if (leafletMap.getSource(id)) leafletMap.removeSource(id); });
    const style = base_style_for(layer);
    Object.entries(style.sources || {}).forEach(([id, source]) => leafletMap.addSource(id, source));
    const before = leafletMap.getLayer('flight-route-outline') ? 'flight-route-outline' : undefined;
    style.layers.forEach(baseLayer => leafletMap.addLayer(baseLayer, before));
    activeBaseLayers = style.layers.map(item => item.id);
    activeBaseSources = Object.keys(style.sources || {});
    update_route_contrast();
    if (button) button.blur();
}

function init_or_get_map(centerLat, centerLon, zoom = 15) {
    if (leafletMap) { leafletMap.jumpTo({ center: [centerLon, centerLat], zoom }); return leafletMap; }
    const api = window.AeroVaneMap || window.AeroVaneMap;
    if (!api) throw new Error('MapLibre runtime did not load.');
    leafletMap = new api.maplibregl.Map({ container: 'map', style: map_style(), center: [centerLon, centerLat], zoom,
        attributionControl: true, cooperativeGestures: false });
    // Laptop trackpads and mouse wheels should zoom immediately while the
    // pointer is over the map; Ctrl/Cmd must not be required.
    leafletMap.scrollZoom.enable();
    const baseStyle = base_style_for(selectedMapLayer);
    activeBaseLayers = baseStyle.layers.map(item => item.id);
    activeBaseSources = Object.keys(baseStyle.sources || {});
    leafletMap.addControl(new api.maplibregl.NavigationControl({ visualizePitch: true }), 'top-right');
    leafletMap.addControl(new api.maplibregl.ScaleControl({ unit: 'metric' }), 'bottom-left');
    leafletMap.on('error', event => {
        if (selectedMapLayer === 'offline') return;
        const message = String(event?.error?.message || '');
        if (!/tile|image|network|fetch|403|401/i.test(message)) return;
        tileFailureCount += 1;
        if (tileFailureCount >= 4) change_map_layer('offline');
    });
    leafletMap.on('data', event => { if (event.dataType === 'source' && event.isSourceLoaded) tileFailureCount = 0; });
    return leafletMap;
}

function route_feature(gpsds) {
    const lines = gpsds.segments?.length ? gpsds.segments : [gpsds.lat.map((lat, index) => [gpsds.lon[index], lat])];
    return { type: 'Feature', properties: {}, geometry: { type: 'MultiLineString', coordinates: lines } };
}

function prepare_gps_path(gpsds) {
    const length = Math.min(gpsds?.lat?.length || 0, gpsds?.lon?.length || 0);
    const valid = [];
    for (let index = 0; index < length; index++) {
        const lat = Number(gpsds.lat[index]), lon = Number(gpsds.lon[index]);
        if (!Number.isFinite(lat) || !Number.isFinite(lon) || Math.abs(lat) > 90 || Math.abs(lon) > 180 || (lat === 0 && lon === 0)) continue;
        valid.push(index);
    }
    const segments = []; let segment = [];
    for (const index of valid) {
        const point = [Number(gpsds.lon[index]), Number(gpsds.lat[index])];
        const previous = segment.at(-1);
        const previousIndex = previous ? previous.index : null;
        if (previousIndex != null) {
            const distance = coord2dist({ lat: gpsds.lat[previousIndex], lon: gpsds.lon[previousIndex] }, { lat: point[1], lon: point[0] });
            const previousTime = gps_time_as_ms(gpsds, previousIndex, 0), currentTime = gps_time_as_ms(gpsds, index, 0);
            const elapsed = previousTime != null && currentTime != null ? Math.max(.05, (currentTime - previousTime) / 1000) : 1;
            if (distance > Math.max(250, elapsed * 150)) {
                if (segment.length >= 2) segments.push(segment);
                segment = [];
            }
        }
        segment.push({ index, point });
    }
    if (segment.length >= 2) segments.push(segment);
    const continuous = segments.flatMap(line => line.map(item => item.index));
    const stride = Math.max(1, Math.ceil(continuous.length / 5000));
    const indices = continuous.filter((_, index) => index % stride === 0);
    if (continuous.length && indices.at(-1) !== continuous.at(-1)) indices.push(continuous.at(-1));
    const select = key => indices.map(index => gpsds[key]?.[index]);
    const sampledSegments = segments.map(line => {
        const lineStride = Math.max(1, Math.ceil(line.length / 5000));
        const sampled = line.filter((_, index) => index % lineStride === 0);
        if (sampled.at(-1) !== line.at(-1)) sampled.push(line.at(-1));
        return sampled.map(item => item.point);
    });
    const lat = select('lat'), lon = select('lon');
    return { ...gpsds, lat, lon, alt: select('alt'), vel: select('vel'), time: select('time'), segments: sampledSegments,
        cenlat: lat.length ? lat.reduce((a,b) => a + b, 0) / lat.length : gpsds.cenlat,
        cenlon: lon.length ? lon.reduce((a,b) => a + b, 0) / lon.length : gpsds.cenlon };
}

function marker_element(className, label) {
    const element = document.createElement('button');
    element.className = `map-point ${className}`;
    element.type = 'button';
    element.setAttribute('aria-label', label);
    return element;
}

function add_endpoint(coordinates, className, html) {
    const api = window.AeroVaneMap || window.AeroVaneMap;
    return new api.maplibregl.Marker({ element: marker_element(className, className) })
        .setLngLat(coordinates).setPopup(new api.maplibregl.Popup({ offset: 14 }).setHTML(html)).addTo(leafletMap);
}

function draw_flight_map(gpsds) {
    const card = document.querySelector('.map-card');
    if (!gpsds?.lat?.length || !Number.isFinite(gpsds.cenlat) || !Number.isFinite(gpsds.cenlon) || Math.abs(gpsds.cenlat) > 90 || Math.abs(gpsds.cenlon) > 180) { if (card) card.style.display = 'none'; return; }
    if (card) card.style.display = 'block';
    gpsds = prepare_gps_path(gpsds);
    if (!gpsds.lat.length || !gpsds.segments?.length) {
        if (card) card.style.display = 'block';
        set_map_path_notice('No reliable flight path: GPS coordinates contain impossible jumps or insufficient valid points.');
        return;
    }
    set_map_path_notice('');
    currentGpsData = gpsds;
    const map = init_or_get_map(gpsds.cenlat, gpsds.cenlon);
    if (!map._aerovaneRouteClickBound && !map._aerovaneRouteClickBound) {
        map._aerovaneRouteClickBound = true;
        map._aerovaneRouteClickBound = true;
        map.on('click', event => focus_graph_from_map(event.lngLat));
    }
    const render = () => {
        if (map.getSource('flight-route')) map.getSource('flight-route').setData(route_feature(gpsds));
        else {
            map.addSource('flight-route', { type: 'geojson', data: route_feature(gpsds) });
            map.addLayer({ id: 'flight-route-outline', type: 'line', source: 'flight-route', layout: { 'line-cap': 'round', 'line-join': 'round' }, paint: { 'line-color': route_outline_color(), 'line-width': ['interpolate', ['linear'], ['zoom'], 5, 6, 16, 10], 'line-opacity': .94 } });
            map.addLayer({ id: 'flight-route', type: 'line', source: 'flight-route', layout: { 'line-cap': 'round', 'line-join': 'round' }, paint: { 'line-color': '#168cff', 'line-width': ['interpolate', ['linear'], ['zoom'], 5, 3, 16, 5.5], 'line-opacity': 1 } });
            add_route_arrow_image(map);
            map.addLayer({ id: 'flight-route-direction', type: 'symbol', source: 'flight-route', layout: { 'symbol-placement': 'line', 'symbol-spacing': 90, 'icon-image': 'flight-route-arrow', 'icon-size': ['interpolate', ['linear'], ['zoom'], 8, .65, 17, 1], 'icon-rotation-alignment': 'map', 'icon-allow-overlap': false, 'icon-ignore-placement': true } });
        }
        aiFaultMarkers.forEach(marker => marker.remove()); aiFaultMarkers = [];
        endpointMarkers.forEach(marker => marker.remove()); endpointMarkers = [];
        const first = [gpsds.lon[0], gpsds.lat[0]], lastIndex = gpsds.lat.length - 1;
        endpointMarkers.push(add_endpoint(first, 'map-endpoint takeoff', '<strong>Takeoff</strong>'));
        endpointMarkers.push(add_endpoint([gpsds.lon[lastIndex], gpsds.lat[lastIndex]], 'map-endpoint landing', '<strong>Landing</strong>'));
        const api = window.AeroVaneMap || window.AeroVaneMap;
        flightBounds = new api.maplibregl.LngLatBounds();
        gpsds.lat.forEach((lat, index) => flightBounds.extend([gpsds.lon[index], lat]));
        fit_flight_path();
    };
    map.isStyleLoaded() ? render() : map.once('style.load', render);
}

function set_map_path_notice(message) {
    const map = document.getElementById('map'); if (!map) return;
    let notice = document.getElementById('map-path-notice');
    if (!message) { notice?.remove(); return; }
    if (!notice) { notice = document.createElement('div'); notice.id = 'map-path-notice'; notice.className = 'map-path-notice'; map.appendChild(notice); }
    notice.textContent = message;
}

function restore_flight_overlays() {
    if (!currentGpsData) return;
    const center = leafletMap?.getCenter();
    const zoom = leafletMap?.getZoom();
    const analysis = typeof savedLogAiResult !== 'undefined' ? savedLogAiResult : null;
    draw_flight_map(currentGpsData);
    if (analysis) draw_ai_fault_markers(analysis, document.logfile?.boot_time_ms_since_epoch || 0);
    if (center && Number.isFinite(zoom)) requestAnimationFrame(() => leafletMap?.jumpTo({ center, zoom }));
}

if (typeof window !== 'undefined' && typeof document !== 'undefined') {
    window.addEventListener('offline', () => change_map_layer('offline'));
    window.addEventListener('online', () => change_map_layer(lastOnlineMapLayer || preferred_theme_layer()));
    selectedMapLayer = typeof navigator === 'undefined' || navigator.onLine ? preferred_theme_layer() : 'offline';
    if (selectedMapLayer !== 'offline') lastOnlineMapLayer = selectedMapLayer;
    document.addEventListener('DOMContentLoaded', () => {
        const selector = document.getElementById('map-layer-select');
        if (selector && selectedMapLayer !== 'offline') selector.value = selectedMapLayer;
        set_map_offline_status(selectedMapLayer === 'offline');
    });
}

function route_outline_color() {
    return selectedMapLayer === 'satellite' || selectedMapLayer === 'dark' || selectedMapLayer === 'offline' ? '#f8fafc' : '#07182d';
}

function update_route_contrast() {
    if (leafletMap?.getLayer('flight-route-outline')) leafletMap.setPaintProperty('flight-route-outline', 'line-color', route_outline_color());
}

function add_route_arrow_image(map) {
    if (map.hasImage('flight-route-arrow')) return;
    const canvas = document.createElement('canvas'); canvas.width = 28; canvas.height = 28;
    const context = canvas.getContext('2d');
    context.lineJoin = 'round'; context.lineWidth = 5; context.strokeStyle = '#ffffff'; context.fillStyle = '#168cff';
    context.beginPath(); context.moveTo(5, 5); context.lineTo(23, 14); context.lineTo(5, 23); context.lineTo(10, 14); context.closePath(); context.stroke(); context.fill();
    map.addImage('flight-route-arrow', context.getImageData(0, 0, 28, 28), { pixelRatio: 2 });
}

function gps_time_as_ms(gpsds, index, bootTimeMs) {
    const value = gpsds.time?.[index];
    return value instanceof Date ? value.getTime() : Number.isFinite(value) ? (bootTimeMs > 0 ? bootTimeMs + value * 1000 : value * 1000) : null;
}

function find_nearest_gps_index(gpsds, faultTimestampMs, bootTimeMs) {
    const target = bootTimeMs > 0 ? bootTimeMs + faultTimestampMs : faultTimestampMs;
    let best = -1, distance = Infinity;
    (gpsds.time || []).forEach((_, index) => { const time = gps_time_as_ms(gpsds, index, bootTimeMs); if (time == null) return; const delta = Math.abs(time - target); if (delta < distance) { best = index; distance = delta; } });
    return best;
}

function draw_ai_fault_markers(analysis, bootTimeMs) {
    aiFaultMarkers.forEach(marker => marker.remove()); aiFaultMarkers = [];
    if (!leafletMap || !currentGpsData) return;
    const colors = { critical: '#ef4444', warning: '#f59e0b', caution: '#eab308', info: '#38bdf8' };
    analysis.faults.forEach((fault, index) => {
        const gpsIndex = find_nearest_gps_index(currentGpsData, fault.startedAtMs, bootTimeMs);
        if (gpsIndex < 0) return;
        const element = marker_element('fault', `${fault.severity} fault`); element.style.setProperty('--marker-color', colors[fault.severity] || colors.info);
        const api = window.AeroVaneMap || window.AeroVaneMap;
        const popup = new api.maplibregl.Popup({ offset: 12 }).setHTML(`<strong>${escape_map_html(fault.message)}</strong><br>${escape_map_html(format_ai_time(fault.startedAtMs))}<br><button onclick="show_fault_on_graph(${index})">Show on graph</button>`);
        aiFaultMarkers[index] = new api.maplibregl.Marker({ element }).setLngLat([currentGpsData.lon[gpsIndex], currentGpsData.lat[gpsIndex]]).setPopup(popup).addTo(leafletMap);
    });
}

function set_map_cursor_time(plotTime) {
    if (!leafletMap || !currentGpsData?.time?.length) return;
    const boot = document.logfile?.boot_time_ms_since_epoch || 0;
    const timestamp = plotTime instanceof Date ? plotTime.getTime() : Number.isFinite(plotTime) ? (boot > 0 ? plotTime : plotTime * 1000) : new Date(plotTime).getTime();
    if (!Number.isFinite(timestamp)) return;
    let best = 0, distance = Infinity;
    currentGpsData.time.forEach((value, index) => { const time = value instanceof Date ? value.getTime() : value * 1000; const delta = Math.abs(time - timestamp); if (delta < distance) { best = index; distance = delta; } });
    const api = window.AeroVaneMap || window.AeroVaneMap;
    if (!droneCursorMarker) droneCursorMarker = new api.maplibregl.Marker({ element: marker_element('cursor', 'Graph cursor position') }).setLngLat([currentGpsData.lon[best], currentGpsData.lat[best]]).addTo(leafletMap);
    else droneCursorMarker.setLngLat([currentGpsData.lon[best], currentGpsData.lat[best]]);
}

function show_fault_on_map(index) { const marker = aiFaultMarkers[index]; if (!leafletMap || !marker) { set_map_path_notice('This finding has no timestamped GPS position in the loaded log.'); return; } leafletMap.easeTo({ center: marker.getLngLat(), zoom: Math.max(leafletMap.getZoom(), 16), duration: 700 }); marker.getPopup()?.addTo(leafletMap); document.querySelector('.map-card')?.scrollIntoView({ behavior: 'smooth', block: 'center' }); }
function fit_flight_path() { if (leafletMap && flightBounds) leafletMap.fitBounds(flightBounds, { padding: 48, maxZoom: 18, duration: 600 }); }
function reset_map_orientation() { if (leafletMap) leafletMap.easeTo({ bearing: 0, pitch: 0, duration: 450 }); }
function focus_graph_from_map(lngLat) {
    if (!currentGpsData?.lat?.length || !lngLat) return;
    let best = 0, bestDistance = Infinity;
    for (let index = 0; index < currentGpsData.lat.length; index++) {
        const dx = currentGpsData.lon[index] - lngLat.lng;
        const dy = currentGpsData.lat[index] - lngLat.lat;
        const distance = dx * dx + dy * dy;
        if (distance < bestDistance) { bestDistance = distance; best = index; }
    }
    const timestamp = gps_time_as_ms(currentGpsData, best, document.logfile?.boot_time_ms_since_epoch || 0);
    if (timestamp == null) return;
    set_map_cursor_time(new Date(timestamp));
    if (window.Plotly && document.getElementById('plot')?.data?.length) {
        const boot = document.logfile?.boot_time_ms_since_epoch || 0;
        Plotly.Fx.hover('plot', [{ curveNumber: 0, xval: boot > 0 ? new Date(timestamp) : timestamp / 1000 }]);
    }
}
function escape_map_html(value) { return String(value).replace(/[&<>'"]/g, character => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', "'": '&#39;', '"': '&quot;' })[character]); }
function toggle_map_fullscreen() { const card = document.querySelector('.map-card'); if (!card) return; const active = card.classList.toggle('fullscreen-active'); document.getElementById('map-fullscreen-btn').textContent = active ? 'Exit fullscreen' : 'Fullscreen'; setTimeout(() => { leafletMap?.resize(); fit_flight_path(); }, 150); }

async function load_offline_pmtiles(file) {
    if (!file) return;
    const api = window.AeroVaneMap;
    if (!api?.PMTiles || !api?.FileSource || !api?.protocol) { set_map_path_notice('Offline map runtime is unavailable. Reload the Log Analyser and try again.'); return; }
    try {
        const archive = new api.PMTiles(new api.FileSource(file));
        const header = await archive.getHeader();
        if (header.tileType === api.TileType.Mvt || header.tileType === api.TileType.Mlt) {
            throw new Error('This vector PMTiles archive needs a matching MapLibre style. Choose a raster PNG, JPEG, WebP, or AVIF PMTiles file.');
        }
        if (![api.TileType.Png, api.TileType.Jpeg, api.TileType.Webp, api.TileType.Avif].includes(header.tileType)) {
            throw new Error('The selected file is not a supported raster PMTiles archive.');
        }
        api.protocol.add(archive);
        localPmtilesUrl = `pmtiles://${archive.source.getKey()}`;
        localPmtilesName = file.name;
        change_map_layer('offline', undefined, true);
        set_map_offline_status(false);
        set_map_path_notice(`Offline basemap loaded: ${localPmtilesName}`);
    } catch (error) {
        set_map_path_notice(`Offline map could not be loaded: ${error.message || error}`);
    }
}

function get_overview(gps, bootTime) {
    const set = (id, value) => { const element = document.getElementById(id); if (element) element.textContent = value; };
    set('logstart', bootTime > 0 ? new Date(bootTime).toLocaleString() : 'Relative Time (No GPS Epoch)');
    if (!gps?.lat?.length) { ['logduration', 'flighttime'].forEach(id => set(id, '0s')); return; }
    const millis = value => value instanceof Date ? value.getTime() : Number(value) * 1000;
    const duration = Math.max(0, millis(gps.time.at(-1)) - millis(gps.time[0]));
    let distance = 0, flyingMs = 0, flightStart = null, maximumSpeed = 0;
    for (let index = 1; index < gps.lat.length; index++) {
        const speed = Number(gps.vel?.[index]) || 0;
        maximumSpeed = Math.max(maximumSpeed, speed);
        if (speed > 1.5 && flightStart == null) flightStart = millis(gps.time[index]);
        if (speed < .8 && flightStart != null) { flyingMs += millis(gps.time[index]) - flightStart; flightStart = null; }
        if (speed > .8) distance += coord2dist({ lat: gps.lat[index - 1], lon: gps.lon[index - 1] }, { lat: gps.lat[index], lon: gps.lon[index] });
    }
    if (flightStart != null) flyingMs += millis(gps.time.at(-1)) - flightStart;
    const altitude = (gps.alt || []).filter(Number.isFinite);
    set('logduration', formatDuration(duration));
    set('distance', `${(distance / 1000).toFixed(2)} km`);
    set('maxaltdiff', `${(altitude.length ? Math.max(...altitude) - Math.min(...altitude) : 0).toFixed(1)} m`);
    set('flighttime', formatDuration(flyingMs));
    set('avgspeed', `${(flyingMs ? distance / (flyingMs / 1000) * 3.6 : 0).toFixed(1)} km/h`);
    set('maxspeed', `${(maximumSpeed * 3.6).toFixed(1)} km/h`);
}
