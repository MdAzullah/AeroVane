# SkyForge 🛸 — Drone Telemetry & Flight Log Analysis Suite

[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](LICENSE)
[![TypeScript](https://img.shields.io/badge/TypeScript-5.9-blue.svg)](https://www.typescriptlang.org/)
[![SolidJS](https://img.shields.io/badge/SolidJS-1.9-446b9e.svg)](https://www.solidjs.com/)
[![Vite](https://img.shields.io/badge/Vite-7.3-646CFF.svg)](https://vitejs.dev/)
[![MAVLink](https://img.shields.io/badge/Protocol-MAVLink%20v1%2Fv2-green.svg)](https://mavlink.io/)

**SkyForge** is a unified, high-performance telemetry visualization and flight log analysis suite for autonomous drones, UAVs, and robotic vehicles. Designed for drone operators, flight software engineers, and researchers, SkyForge provides instant, zero-install in-browser real-time monitoring and post-flight `.bin` dataflash diagnostics.

---

## 🌟 Suite Components

```mermaid
graph TD
    Drone["🛸 Drone / Autopilot / SITL"] -->|Serial / USB| LV["🖥️ Live Viewer (SolidJS + WebSerial)"]
    Drone -->|UDP / TCP / Serial| Bridge["🌉 MAVLink Bridge Server"]
    Bridge -->|WebSockets (ws://)| LV
    DF["📁 ArduPilot Dataflash (*.bin)"] --> SLV["📊 Saved Log Viewer (Plotly.js)"]
```

SkyForge includes three core components:

| Component | Path | Description | Key Technologies |
| :--- | :--- | :--- | :--- |
| **Live Telemetry Viewer** | [`live-viewer/`](./live-viewer) | High-speed real-time MAVLink telemetry dashboard, PWA offline support, multi-axis plotting, parameter editor, and live flight mapping. | SolidJS, Vite, Tailwind CSS v4, uPlot, Leaflet, Web Serial |
| **Dataflash Bin Analyzer** | [`saved-log-viewer/`](./saved-log-viewer) | In-browser analyzer for ArduPilot `.bin` flight logs. Instant offline decoding, sensor overlay, and trajectory mapping. | HTML5, Vanilla JS, Plotly.js, Leaflet |
| **MAVLink Network Bridge** | [`bridge/`](./bridge) | Fast, zero-dependency proxy server bridging Serial, UDP, TCP, and WebSockets. | Pre-compiled static Linux binary (`mavlink-server`) |

---

## 🚀 Key Features

### 1. Real-Time Live Telemetry
- **Dynamic XML Dialects**: Load any custom or standard MAVLink XML dialect on the fly with zero recompilation.
- **Hardware & Network Connectivity**: Connect directly via **Web Serial** (USB/FTDI), **WebSockets** (via `bridge/mavlink-server`), or simulated telemetry.
- **Ultra-Fast Canvas Plotting**: Powered by `uPlot` for rendering hundreds of thousands of datapoints with 60 FPS performance and synchronized crosshair zooming.
- **Interactive Flight Map**: Real-time position tracking, heading vector, and waypoint overlay on OpenStreetMap/Carto basemaps.
- **Onboard Parameter Management**: Inspect, search, group, and modify autopilot parameters in real time.
- **Offline Progressive Web App (PWA)**: Works seamlessly offline in the field without an active internet connection.

### 2. Post-Flight Dataflash Analysis
- **100% Client-Side**: No uploads to external cloud servers; flight logs remain strictly private on your machine.
- **Multi-Axis Comparison**: Graph multiple data series simultaneously on synchronized Y-axes (e.g. Baro Altitude vs. GPS Altitude vs. Throttle).
- **Automated Flight Metrics**: Instant calculation of flight duration, total distance, max speed, and ascent/descent rates.

### 3. Standalone Telemetry Bridge
- **Multiplexing**: Route telemetry streams across USB serial ports, UDP broadcast (ports 14550/14551), TCP, and WebSockets (`ws://localhost:9988`).

---

## 🛠️ Quick Start Guide

### Prerequisites
- **Node.js**: v20+ (LTS)
- **npm**: v10+
- **Browser**: Chromium-based (Chrome, Edge, Brave) for Web Serial; any modern browser for WebSockets and log analysis.

---

### Option A: Launching the Live Telemetry Viewer

1. Navigate to the `live-viewer` directory and install dependencies:
   ```bash
   cd live-viewer
   npm install
   ```

2. Start the Vite development server:
   ```bash
   npm run dev
   ```

3. Open `http://localhost:5173` in your browser. Click **Connect USB** or enter `ws://localhost:9988` to stream live telemetry.

---

### Option B: Running the Saved Log Analyzer

1. Navigate to `saved-log-viewer` and start a static web server:
   ```bash
   cd saved-log-viewer
   python3 -m http.server 8080
   ```

2. Open `http://localhost:8080` in your browser.
3. Drag and drop any `.bin` dataflash file to inspect flight metrics and graph sensor telemetry.

---

### Option C: Starting the Telemetry Bridge

To route drone telemetry from a serial port or SITL simulation to WebSockets:

- **From Serial Device (`/dev/ttyACM0`)**:
  ```bash
  ./bridge/mavlink-server serial:///dev/ttyACM0?baudrate=115200 wsserver://0.0.0.0:9988
  ```

- **From Drone Simulation (SITL / PX4 UDP 14550)**:
  ```bash
  ./bridge/mavlink-server udpserver://0.0.0.0:14550 wsserver://0.0.0.0:9988
  ```

- **From Fake Heartbeat Source (For offline testing)**:
  ```bash
  ./bridge/mavlink-server 'fakesource://' wsserver://0.0.0.0:9988
  ```

---

## 🧪 Testing & Verification

Inside `live-viewer/`:

```bash
# Run complete test suite (Vitest unit & component tests)
npm test

# Run TypeScript type check
npm run typecheck

# Verify build output
npm run build
```

---

## 👤 Author & Maintainer

**MD Azizullah**
- **GitHub**: [@MdAzullah](https://github.com/MdAzullah)
- **Email**: md.azizullah.engineer@gmail.com
- **Repository**: [https://github.com/MdAzullah/drone-log-analyzer](https://github.com/MdAzullah/drone-log-analyzer)

---

## 📄 License & Attributions

- SkyForge is released under the [MIT License](LICENSE).
- For third-party licenses and open-source acknowledgments, see [ATTRIBUTION.md](ATTRIBUTION.md).
