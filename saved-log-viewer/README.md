# AeroVane Dataflash Log Analyzer

A fast, client-side in-browser flight log analyzer for ArduPilot dataflash (`.bin`) log files. Perform telemetry analysis, sensor comparisons, and trajectory mapping offline with zero server dependencies.

## Features
- **Zero Server Setup**: All parsing and plotting happens entirely client-side in the browser.
- **Interactive Multi-Axis Plotting**: Graph sensor data, baro, GPS, and custom series using Plotly.js.
- **Flight Trajectory Mapping**: Visualize drone flight path directly on the map.
- **Comprehensive Overview**: Instant calculation of flight duration, distance, altitude delta, and velocity stats.

## How to Run
Simply open `index.html` in your web browser, or serve locally:
```bash
python3 -m http.server 8080
```
Then navigate to `http://localhost:8080` and drag-and-drop your `.bin` log file.

# License

 This program is free software: you can redistribute it and/or modify
 it under the terms of the GNU General Public License as published by
 the Free Software Foundation, either version 3 of the License, or
 (at your option) any later version.

See: https://www.gnu.org/licenses/gpl-3.0 and [copyright](copyright.txt).

[plotly](https://plotly.com/javascript/) is licensed under the MIT License
