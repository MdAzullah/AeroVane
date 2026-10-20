# AeroVane 🛸 — Real-Time Drone Telemetry & Post-Flight Log Analysis Suite

[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](LICENSE)
[![TypeScript](https://img.shields.io/badge/TypeScript-5.9-blue.svg)](https://www.typescriptlang.org/)
[![SolidJS](https://img.shields.io/badge/SolidJS-1.9-446b9e.svg)](https://www.solidjs.com/)
[![Vite](https://img.shields.io/badge/Vite-7.3-646CFF.svg)](https://vitejs.dev/)
[![MAVLink](https://img.shields.io/badge/Protocol-MAVLink%20v1%2Fv2-green.svg)](https://mavlink.io/)
[![Offline First](https://img.shields.io/badge/Privacy-100%25%20Local%20%2F%20Offline-success.svg)](USER_GUIDE.md)

**AeroVane** is a unified, high-performance flight operations and telemetry diagnostic suite for autonomous drones, UAVs, and robotic vehicles running **ArduPilot** or **PX4**.

Built for drone pilots, aerospace engineers, and robotics researchers, AeroVane combines **zero-latency real-time MAVLink flight monitoring** with a **two-phase non-blocking post-flight log analyzer** that processes 500MB+ `.bin` dataflash files directly in the browser with **100% local privacy**.

---

## 🌟 Why AeroVane?

| Challenge with Existing Tools | How AeroVane Solves It |
| :--- | :--- |
| **Cloud Uploads & Privacy Risks** | **100% Client-Side**: Telemetry and logs never leave your machine. No cloud uploads, no logins, no telemetry tracking. |
| **Browser Freezes on Large Files** | **Non-Blocking 2-Phase Engine**: Large 500MB+ `.bin` logs open the graph and trajectory map in seconds; deep AI safety analysis finishes in the background with a top progress banner. |
| **Complex Desktop Tool Setup** | **Zero-Dependency Web Suite**: Runs on any OS (Linux, macOS, Windows) using your browser with WebSerial and WebSockets. |
| **No Internet in Field Operations** | **Offline PMTiles & PWA**: Load offline vector/raster maps and PWA offline caching for remote field missions without cellular coverage. |
| **Manual Sensor Troubleshooting** | **Embedded ML & Rules Diagnostics**: Built-in neural networks and rule detectors advise on battery sag, motor imbalance, GPS multipath, and sensor faults automatically. |

---

## 🏗️ System Architecture

```mermaid
flowchart TB
    subgraph DataSources["Telemetry & Flight Log Sources"]
        Physical["🛸 Physical Drone / Autopilot (Pixhawk, Cube, Matek)"]
        SITL["💻 ArduPilot / PX4 SITL Simulation"]
        Logs["📁 ArduPilot DataFlash (.bin / .log)"]
    end

    subgraph AeroVanePortal["AeroVane Suite (http://127.0.0.1:4173)"]
        Portal["🌐 Unified Local Portal (index.html)"]
        
        subgraph LiveEngine["Live Telemetry Viewer (/live/)"]
            WebSerial["Web Serial API (USB/FTDI)"]
            Bridge["MAVLink Bridge (UDP / TCP / WS)"]
            uPlot["uPlot Canvas Engine (60 FPS)"]
            ML_Live["In-Browser ML Anomaly Engine"]
            LiveMap["Leaflet Flight Path & Heading"]
        end

        subgraph LogEngine["Saved Log Analyzer (/logs/)"]
            Worker["analysis-worker.js (Off-thread decoder)"]
            Plotly["Plotly.js Synchronized Multi-Axis Charts"]
            SafetyBanner["Progressive Safety Banner (Top sticky)"]
            MapGL["Offline PMTiles & Basemap Trajectory"]
            ML_Saved["Automated Fault & Metric Reporter"]
        end
    end

    Physical -->|Direct USB Serial| WebSerial
    Physical -->|UDP/TCP Telemetry Radio| Bridge
    SITL -->|UDP 14550| Bridge
    Bridge -->|WebSocket (ws://9988)| LiveEngine
    WebSerial --> LiveEngine
    
    Logs -->|Drag & Drop| Worker
    Worker -->|Phase 1: Telemetry Data| Plotly
    Worker -->|Phase 1: GPS Path| MapGL
    Worker -->|Phase 2: Safety Progress| SafetyBanner
    Worker -->|Phase 2: Findings| ML_Saved

    Portal --> LiveEngine
    Portal --> LogEngine
```

---

## 🚀 Key Modules & Capabilities

### 1. 🖥️ Real-Time Live Telemetry Viewer (`/live/`)
* **Direct Hardware Connection**: Connect autopilots directly via **Web Serial** (USB/FTDI) in Chrome, Edge, and Brave with zero bridge software needed.
* **Network & Simulation Bridge**: Stream telemetry over UDP, TCP, or WebSockets via the built-in Node.js telemetry bridge.
* **60 FPS Hardware-Accelerated Charts**: Render hundreds of thousands of datapoints with `uPlot` without UI lag or memory leaks.
* **Onboard Parameter Management**: Search, filter, inspect, and tweak ArduPilot/PX4 parameters live in the field.
* **Real-Time AI Anomaly Detection**: Integrated lightweight neural networks and decision trees flag anomalous sensor readings, communication loss, and attitude anomalies on the fly.
* **Full PWA Offline Support**: Installable as a standalone progressive web app on field laptops.

### 2. 📊 Post-Flight Saved Log Analyzer (`/logs/`)
* **Two-Phase Non-Blocking Architecture**:
  - **Phase 1 (Instant Display)**: Decodes telemetry indices and GPS records in 2–3 seconds and reveals the full dashboard with interactive graphs, maps, and signal explorer immediately.
  - **Phase 2 (Background Safety Analysis)**: Parses deep diagnostic records in a background Web Worker while displaying a compact sticky status banner (`🔍 Running safety analysis... X%`) with an optional skip button.
* **Synchronized Multi-Axis Inspection**: Compare attitude, altitude, battery voltages, vibration levels, and motor outputs across common timestamps.
* **Offline PMTiles Basemap Support**: Air-gapped flight mapping using local `.pmtiles` vector/raster basemaps without needing an internet connection.
* **Automated Safety Findings**: Clear advisory diagnostic reports flagging battery critical drop, compass errors, EKF variance, and motor saturation.

### 3. 🌉 Standalone MAVLink Network Bridge (`scripts/mavlink-bridge.mjs`)
* Zero-dependency bridge multiplexing MAVLink streams between:
  - Autopilot telemetry radios (UDP `14550`)
  - Ground control stations (Mission Planner / QGroundControl on UDP `14551`)
  - AeroVane browser interface (WebSockets `ws://127.0.0.1:9988`)

---

## 🛠️ Getting Started (One-Time Setup)

### Prerequisites
- **Node.js**: v20 or newer (LTS recommended)
- **npm**: v10 or newer
- **Browser**: Chromium-based (Google Chrome, Microsoft Edge, Brave) for Web Serial; any modern browser for log analysis and WebSockets.

### 1. Clone the Repository
```bash
git clone https://github.com/MdAzullah/AeroVane.git
cd AeroVane
```

### 2. Install Dependencies & Build
```bash
npm ci
npm --prefix live-viewer ci
npm run build
```

### 3. Start AeroVane
```bash
npm start
```

This launches the local server and automatically opens **http://127.0.0.1:4173/** in your default browser. Keep the terminal running while using AeroVane; press `Ctrl+C` to stop.

* **Live Telemetry Viewer**: `http://127.0.0.1:4173/live/`
* **Saved Log Analyzer**: `http://127.0.0.1:4173/logs/`

*(Optional for Linux users)*: To install a persistent background service and desktop application menu shortcut, run:
```bash
npm run install:local
```

---

## 📖 Practical Workflows

### Scenario A: Analyzing a 500MB Flight Log
1. Open `http://127.0.0.1:4173/logs/`.
2. Drag and drop your `.bin` or `.log` file into the drop zone.
3. Within seconds, the dashboard unlocks with the full time-series charts and GPS flight path.
4. Watch the compact top banner evaluate safety detectors in the background, or click **Skip** at any time.

### Scenario B: Live Flight Monitoring with USB Cable
1. Connect your flight controller (e.g. Pixhawk / Cube) to your laptop via USB.
2. Open `http://127.0.0.1:4173/live/` in Chrome, Edge, or Brave.
3. Click **Connect USB**, select your device port, and begin monitoring telemetry instantly.

### Scenario C: Live Flight with ArduPilot SITL / Simulation
1. Start ArduPilot SITL:
   ```bash
   sim_vehicle.py -v ArduCopter --console --map
   ```
2. In a new terminal, launch the telemetry bridge:
   ```bash
   npm run bridge -- udpserver://0.0.0.0:14550 wsserver://127.0.0.1:9988
   ```
3. Open `http://127.0.0.1:4173/live/` and click **Connect WS**.

For detailed setup with Mission Planner, Ethernet antennas, and offline basemaps, read the full [USER_GUIDE.md](USER_GUIDE.md).

---

## 🧪 Testing & Quality Assurance

AeroVane includes an automated test suite across unit, component, telemetry, and parser modules:

```bash
# Run Saved Log Analyzer test suite (17 DataFlash & AI tests)
npm run test:saved

# Run Live Viewer test suite (600 unit & component tests)
npm --prefix live-viewer test -- --run

# Run TypeScript typecheck
npm --prefix live-viewer run typecheck
```

---

## 📂 Repository Structure

```text
AeroVane/
├── portal/                     # Local landing portal (http://127.0.0.1:4173/)
├── live-viewer/                # Real-time MAVLink telemetry dashboard (SolidJS + Vite)
│   ├── src/analysis/           # Fault engine, detectors, normalizer & ML models
│   ├── src/components/         # UI components, plots, maps & safety panels
│   └── src/services/           # WebSerial & WebSocket connection drivers
├── saved-log-viewer/           # Post-flight DataFlash .bin log analyzer
│   ├── analysis-worker.js      # Web Worker for non-blocking large-file parsing
│   ├── main.js                 # Workspace coordinator & safety banner renderer
│   ├── dataflash.js            # ArduPilot DataFlash binary log format decoder
│   ├── ai-analysis.js          # Client-side advisory safety rule evaluator
│   └── tests/                  # Automated decoder & telemetry tests
├── scripts/                    # Portable server, bridge & local daemon scripts
├── ml/                         # Reproducible ML training pipeline, schemas & manifests
├── USER_GUIDE.md               # End-user operational handbook
└── README.md                   # Project overview & quickstart
```

---

## 👤 Author & Maintainer

**MD Azizullah**
- **GitHub**: [@MdAzullah](https://github.com/MdAzullah)
- **Email**: md.azizullah.engineer@gmail.com
- **Project Link**: [https://github.com/MdAzullah/AeroVane](https://github.com/MdAzullah/AeroVane)

---

## 📄 License & Attributions

- Released under the [MIT License](LICENSE).
- Third-party open-source components and acknowledgments are listed in [ATTRIBUTION.md](ATTRIBUTION.md).
