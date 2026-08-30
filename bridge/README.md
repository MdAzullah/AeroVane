# SkyForge MAVLink Bridge Server

High-performance, standalone MAVLink router and network bridge. It facilitates seamless communication between hardware serial ports, UDP/TCP connections, and modern WebSockets for the **SkyForge Live Viewer**.

## Features
- **Zero Runtime Dependencies**: Pre-compiled, statically linked x86-64 binary.
- **Multi-Endpoint Routing**: Bridges any combination of Serial, UDP, TCP, WebSocket, and TLOG file readers/writers.
- **WebSocket Streaming**: Exposes real-time MAVLink feeds to browser applications (like SkyForge Live Viewer).
- **Embedded REST API**: Built-in HTTP/REST endpoints for diagnostics and telemetry inspection.

## Quick Start

### 1. Launching with WebSocket & Serial
Route telemetry from a drone connected via USB serial (`/dev/ttyACM0` at 115200 baud) to a WebSocket server (`ws://0.0.0.0:9988`):
```bash
./mavlink-server serial:///dev/ttyACM0?baudrate=115200 wsserver://0.0.0.0:9988
```

### 2. Launching with UDP (e.g. ArduPilot / SITL / PX4 Simulator)
Route telemetry from SITL / QGroundControl UDP port 14550 to WebSocket:
```bash
./mavlink-server udpserver://0.0.0.0:14550 wsserver://0.0.0.0:9988
```

### 3. Launching with Simulated / Fake Heartbeat Telemetry
Generate fake telemetry for UI testing and verification:
```bash
./mavlink-server 'fakesource://' wsserver://0.0.0.0:9988
```

### 4. Command-line Options
To view all available arguments and endpoint formats:
```bash
./mavlink-server --help
```
