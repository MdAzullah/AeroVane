# 📡 AeroVane Live Viewer

Real-time MAVLink telemetry viewer and flight monitor. It is part of the [AeroVane](../../README.md) suite and is served at `/live/`.

Built with **SolidJS**, **TypeScript**, **Vite**, **Tailwind CSS v4**, **uPlot**, and **Leaflet**, and ships as an installable **PWA**.

## Features

- **Connections:** Web Serial (USB / FTDI), WebSocket (via the [AeroVane bridge](../../bridge/README.md)), or the built-in simulator.
- **Runtime dialects:** MAVLink v1/v2 XML dialects are parsed at load time, so no message IDs are hard-coded.
- **Fast plotting:** uPlot canvas charts with synchronized crosshairs, zoom, and draggable grid layouts.
- **Parameters:** read, search, group, and edit, with metadata fetched over MAVLink FTP.
- **Live map:** GPS position, heading, and trajectory.
- **AI Safety panel:** advisory fault detection from rule-based detectors plus two embedded models.
- **TLOG** recording and replay, message monitor, status-text log, and debug console.
- **Offline-capable PWA.**

## Source map

```text
src/
├── mavlink/     # Frame parser & builder, CRC, XML dialect parser, decoder, registry
├── services/    # Byte sources (Web Serial, WebSocket, simulator), connection manager,
│                # parameters, MAVLink FTP, TLOG, settings, unit display
├── workers/     # Off-main-thread MAVLink pipeline and its message protocol
├── analysis/    # FaultDetectionEngine, detectors/, portable model scorers, models/
├── components/  # UI: Toolbar, TelemetryView, PlotPanel, MapView, ParametersView, AISafetyPanel…
├── store/       # Application state
├── hooks/       # Bootstrap, auto-connect, log session, fault events, shortcuts…
└── core/        # Ring buffer, CRC32, event emitter, plot interactions
e2e/             # Playwright specs: connection, telemetry, plots, parameters
```

## Development

From this directory (or use the root `npm run …` aliases):

```bash
npm ci
npm run dev        # http://localhost:5173
```

| Script | Purpose |
|---|---|
| `npm run dev` | Vite dev server with hot reload |
| `npm run build` | Production PWA build into `dist/` |
| `npm test` | Vitest unit & component tests |
| `npm run typecheck` | TypeScript type-check |
| `npm run verify` | Type-check, build, and test |
| `npm run e2e` | Playwright end-to-end tests (`npx playwright install chromium` first) |

To get telemetry without hardware, run `npm run dev:bridge` from the repo root and click **Connect WS**, or pick a simulation scenario in **Settings**.

## License

[MIT](LICENSE). Based on [MavDeck](https://github.com/DanWilson00/MavDeck) by Dan Wilson (MIT); see [ATTRIBUTION.md](../../ATTRIBUTION.md).
