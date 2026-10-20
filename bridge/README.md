# SkyForge MAVLink Bridges

SkyForge's recommended bridge is the cross-platform Node.js implementation at
`scripts/mavlink-bridge.mjs`. It works on Windows, macOS, and Linux and routes
MAVLink byte streams between UDP, TCP, and WebSockets without extra packages.
For USB connections, Live Viewer's **Connect USB** button talks directly to the
vehicle through Chromium's Web Serial support.

The `mavlink-server` file in this directory is retained as an optional legacy
Linux x86-64 binary for users who need its additional serial and REST features.

## Features
- **Cross-platform Default**: Runs with the same Node.js installation as SkyForge.
- **Multi-Endpoint Routing**: Bridges UDP, TCP, WebSocket, and generated test telemetry.
- **WebSocket Streaming**: Exposes real-time MAVLink feeds to browser applications (like SkyForge Live Viewer).

## Quick Start

Run these commands from the repository root.

### 1. Connecting with USB

Open Live Viewer in Chrome, Edge, or Brave and click **Connect USB**.

### 2. Launching with UDP (e.g. ArduPilot / SITL / PX4 Simulator)
Route telemetry from SITL / QGroundControl UDP port 14550 to WebSocket:
```bash
npm run bridge -- udpserver://0.0.0.0:14550 wsserver://127.0.0.1:9988
```

### 3. Launching with Simulated / Fake Heartbeat Telemetry
Generate fake telemetry for UI testing and verification:
```bash
npm run bridge -- fakesource:// wsserver://127.0.0.1:9988
```

### 4. Command-line Options
To view all available arguments and endpoint formats:
```bash
npm run bridge -- --help
```

### Optional legacy Linux bridge

On Linux x86-64, run `./bridge/mavlink-server --help` to see the legacy
binary's serial, TLOG, and REST options.
