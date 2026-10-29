# Third-Party Attributions & Open Source Notices

AeroVane integrates and builds upon exceptional open-source projects. We gratefully acknowledge the upstream creators and maintainers:

---

### 1. MavDeck
- **Upstream Author**: Dan Wilson
- **Repository**: [https://github.com/DanWilson00/MavDeck](https://github.com/DanWilson00/MavDeck)
- **License**: MIT License
- **Component**: Foundation for `apps/live-viewer` real-time MAVLink telemetry visualization.

---

### 2. SearchWing ArduPilot LogViewer
- **Upstream Author**: Friedrich Beckmann (SearchWing)
- **Repository**: [https://searchwing.org](https://searchwing.org)
- **License**: GNU General Public License v3.0 (GPL-3.0)
- **Component**: Foundation for `apps/saved-log-viewer` dataflash (`.bin`) flight log analyzer.

---

### 3. Plotly.js
- **License**: MIT License
- **Component**: `apps/saved-log-viewer/plotly-2.14.0.min.js` interactive graphing library.

---

### 4. Leaflet & OpenStreetMap / CARTO / OpenTopoMap
- **License**: Leaflet BSD-2-Clause; map data © OpenStreetMap contributors (ODbL); CARTO and OpenTopoMap tile attribution as displayed in the map.
- **Component**: Live Viewer flight map and online basemap tiles.

---

### 5. uPlot
- **License**: MIT License
- **Component**: High-performance, low-memory 2D canvas time-series chart renderer.

---

### 6. MapLibre GL JS
- **Repository**: [https://github.com/maplibre/maplibre-gl-js](https://github.com/maplibre/maplibre-gl-js)
- **License**: BSD-3-Clause
- **Component**: WebGL flight map in `apps/saved-log-viewer` (bundled into `map-runtime.js`).

---

### 7. PMTiles
- **Repository**: [https://github.com/protomaps/PMTiles](https://github.com/protomaps/PMTiles)
- **License**: BSD-3-Clause
- **Component**: Offline single-file basemaps in `apps/saved-log-viewer` (bundled into `map-runtime.js`).

---

### 8. Other runtime libraries (Live Viewer)
| Library | License |
| :--- | :--- |
| [SolidJS](https://github.com/solidjs/solid) | MIT |
| [Gridstack.js](https://github.com/gridstack/gridstack.js) | MIT |
| [idb-keyval](https://github.com/jakearchibald/idb-keyval) | Apache-2.0 |
| [xz-decompress](https://github.com/httptoolkit/xz-decompress) | MIT |

---

### 9. UAV-FD actuator fault dataset
- **Creators**: Alessandro Baldini, Lorenzo D'Alleva, Riccardo Felicetti, Francesco Ferracuti, Alessandro Freddi, and Andrea Monteriù
- **Dataset**: [https://doi.org/10.5281/zenodo.7648996](https://doi.org/10.5281/zenodo.7648996)
- **License**: Creative Commons Attribution 4.0 International (CC BY 4.0)
- **Use**: Real hexarotor normal and chipped-propeller flight data used for propulsion-anomaly research and held-out evaluation.

---

### 10. UAV-SEAD flight anomaly dataset
- **Dataset**: [https://huggingface.co/datasets/aykutkabaoglu/uav-flight-anomaly-dataset](https://huggingface.co/datasets/aykutkabaoglu/uav-flight-anomaly-dataset)
- **License**: Creative Commons Attribution 4.0 International (CC BY 4.0), as declared on the dataset card (see `ml/LICENSE_AUDIT.md`)
- **Use**: Reviewed flight windows used to train and evaluate the embedded `aerovane-real-anomaly-2.0.0` model.
