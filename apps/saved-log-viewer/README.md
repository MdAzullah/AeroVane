# 📊 AeroVane Saved Log Analyzer

In-browser analyzer for ArduPilot DataFlash (`.bin`) flight logs. It is part of the [AeroVane](../../README.md) suite and is served at `/logs/`. All parsing and plotting happen client-side, and logs never leave your computer.

## Features

- **Two-phase pipeline for large logs (500 MB+):**
  1. *Phase 1:* `analysis-worker.js` decodes the log off the main thread, and charts, the signal explorer, and the map unlock within seconds.
  2. *Phase 2:* safety analysis continues in the background behind a sticky progress banner that you can skip.
- **Synchronized multi-axis charts** with Plotly.js for any signal in the log.
- **WebGL flight map** with MapLibre GL: street, terrain, dark, and satellite layers, plus offline `.pmtiles` basemaps.
- **Flight overview:** duration, distance, altitude delta, and velocity statistics.
- **Safety findings** produced by the same fault-detection engine as the Live Viewer.

## Files

| File | Role |
|---|---|
| `index.html`, `main.js`, `navbar.js` | App shell, charts, signal explorer, safety banner |
| `dataflash.js` | DataFlash `.bin` decoder |
| `analysis-worker.js` | Web Worker running the two-phase parse and analysis |
| `map-gl.js` | MapLibre map, layers, and PMTiles handling |
| `ai-entry.ts` → `ai-analysis.js` | **Generated** bundle that wraps the Live Viewer's fault engine |
| `map-entry.ts` → `map-runtime.js` | **Generated** bundle of MapLibre GL and PMTiles |
| `plotly-2.14.0.min.js` | Vendored Plotly.js |
| `sample_flight.bin` | Example log for trying the app |
| `tests/` | `node --test` suite |

Do not edit the generated bundles by hand. Rebuild them from the repository root:

```bash
npm run build:saved-ai
npm run build:saved-map
```

## Run and test

From the repository root:

```bash
npm run dev:saved     # http://127.0.0.1:8080
npm run test:saved    # unit tests
```

Open the page and drag in a `.bin` file, or try `sample_flight.bin`.

**Offline basemaps:** set `window.AEROVANE_PMTILES_URL` to a `.pmtiles` file, then choose the *offline* map layer. A custom MapLibre style can be supplied through `window.AEROVANE_MAP_STYLE_URL`.

## License

This component is derived from SearchWing *swlogview* by Friedrich Beckmann and is licensed under the **GNU General Public License v3.0 or later**. See [copyright.txt](copyright.txt) and https://www.gnu.org/licenses/gpl-3.0.

[Plotly.js](https://plotly.com/javascript/) is licensed under the MIT License.
