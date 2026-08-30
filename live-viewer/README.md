# SkyForge — Live Telemetry Viewer

[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](LICENSE)

A high-performance, web-based MAVLink telemetry visualizer and real-time flight monitor. Built with SolidJS, Vite, Tailwind CSS v4, uPlot, and Leaflet.

## Why SkyForge?

- **Web-based & Fast** — Opens instantly in modern browsers with zero driver installations required.
- **Offline-capable (PWA)** — Full Progressive Web App support that persists across sessions.
- **Dynamic XML Dialect Parsing** — Load custom or standard MAVLink dialect XML definitions on the fly.
- **Multi-Protocol Connectivity** — Supports WebSerial (USB/FTDI), WebSockets (Network bridge / `mavlink-server`), and simulated telemetry.
- **Synchronized Time-Series Plotting** — High-speed canvas-rendered charts (uPlot) with synchronized crosshairs and zooming.
- **Live Flight Map** — Leaflet map showing real-time GPS position, heading, and trajectory.

## Quick Start

### 1. Install & Run Dev Server
```bash
npm install
npm run dev
```

Open `http://localhost:5173` in a Chromium-based browser (Chrome, Edge, Brave) to use WebSerial, or any browser for WebSocket telemetry.

### 2. Available Scripts
- `npm run dev` — Launch Vite dev server
- `npm run build` — Build production PWA bundle
- `npm test` — Run all unit and component tests via Vitest
- `npm run typecheck` — Run TypeScript type checking
- `npm run verify` — Run typecheck, build, and unit tests

## Author

**MD Azizullah**
- GitHub: [@MdAzullah](https://github.com/MdAzullah)
- Email: md.azizullah.engineer@gmail.com

## License

This project is licensed under the [MIT License](LICENSE).

