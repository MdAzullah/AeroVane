/* Worker-only DataFlash parsing and ML analysis. Keeps large-log work off the UI thread. */
self.window = self;
importScripts('dataflash.js?v=2', 'ai-analysis.js?v=2');

// These message families are the only ones consumed by DataFlashTelemetryAdapter.
// The complete raw log remains available to charts through the snapshot.
const SAFETY_RECORD_NAMES = new Set(['PARM', 'BAT', 'CURR', 'GPS', 'GPS2', 'ATT', 'VIBE', 'CTUN', 'BARO', 'MAG', 'RSSI', 'IMU', 'ESC', 'XKF4', 'NKF4', 'EKF', 'MSG', 'ERR']);

function getAdaptiveSampleIntervals(byteLength) {
    if (byteLength >= 350 * 1024 * 1024) {
        return {
            BAT: 1000, CURR: 1000, GPS: 500, GPS2: 500, ATT: 500, VIBE: 500,
            CTUN: 500, BARO: 500, MAG: 1000, RSSI: 1000, IMU: 500, ESC: 500,
            XKF4: 500, NKF4: 500, EKF: 500
        };
    }
    if (byteLength >= 150 * 1024 * 1024) {
        return {
            BAT: 500, CURR: 500, GPS: 250, GPS2: 250, ATT: 250, VIBE: 250,
            CTUN: 250, BARO: 250, MAG: 500, RSSI: 500, IMU: 250, ESC: 250,
            XKF4: 250, NKF4: 250, EKF: 250
        };
    }
    if (byteLength >= 50 * 1024 * 1024) {
        return {
            BAT: 250, CURR: 250, GPS: 100, GPS2: 100, ATT: 100, VIBE: 100,
            CTUN: 100, BARO: 100, MAG: 200, RSSI: 200, IMU: 100, ESC: 100,
            XKF4: 100, NKF4: 100, EKF: 100
        };
    }
    return null;
}

/** Yield to the event loop so postMessage flushes before heavy sync work */
function yieldToEventLoop() {
    return new Promise(resolve => setTimeout(resolve, 0));
}

self.onmessage = async function(event) {
    if (!event.data || event.data.type !== 'analyze') return;
    const buffer = event.data.buffer;
    const byteLength = buffer.byteLength;
    const extension = String(event.data.filename || '').split('.').pop().toLowerCase();

    try {
        // ── STEP 1 & 2: Parse (fast index pass — even 500MB takes only ~2-3s) ─────────
        self.postMessage({ type: 'progress', stage: 'parsing', progress: 0 });
        const Parser = extension === 'log' ? textlogfile : logfile;
        const log = new Parser(buffer, progress => self.postMessage({ type: 'progress', stage: 'parsing', progress }));

        if (!log.totalMessages || !log.get_msgitem_list().length) {
            throw new Error('No supported DataFlash messages were found. Confirm this is an ArduPilot BIN or text LOG file.');
        }

        self.postMessage({ type: 'progress', stage: 'parsing', progress: 1 });

        // Extract GPS path and snapshot — fast (metadata only, no full field decode)
        const gps = log.get_gps_series();
        const snapshot = log.to_snapshot();
        const format = extension === 'log' ? 'text' : 'binary';

        // ── STEP 3: Open workspace IMMEDIATELY ───────────────────────────────────────
        // Transfer buffer to main thread RIGHT NOW so charts, graphs and map all work.
        // We keep a cheap reference copy for safety extraction using slice() only for
        // large text logs (binary logs already have full parse state in `log.msgtypes`).
        //
        // For BINARY logs: The snapshot holds all message offsets, but field values
        // require re-reading the ArrayBuffer. We slice a copy before transferring.
        // slice() is O(n) in bytes but runs in ~200ms for 500MB — acceptable since
        // the dashboard opens in parallel while the copy is made.
        let safetyBuffer = null;
        if (extension !== 'log') {
            // Slice is zero-copy on most JS engines (just marks new bounds in the heap).
            // We only need to read it, not modify it.
            safetyBuffer = buffer.slice(0);
        }

        self.postMessage({
            type: 'ready',
            buffer,           // transferred to main thread (worker loses ownership)
            snapshot,
            gps,
            format,
            totalMessages: log.totalMessages,
            bootTime: log.get_boot_time(),
        }, [buffer]);         // ← transferList: buffer moves to main thread instantly

        // Yield so the main thread can process 'ready', show the dashboard,
        // init the plot, draw the map — all before we start blocking CPU again.
        await yieldToEventLoop();

        // ── STEP 4: Safety record extraction (background, dashboard already open) ────
        self.postMessage({ type: 'analysis_progress', progress: 0 });

        const sampling = getAdaptiveSampleIntervals(byteLength);
        let records;

        if (extension === 'log') {
            // textlogfile keeps all records in this.records (no buffer needed)
            records = log.get_records(
                progress => self.postMessage({ type: 'analysis_progress', progress: progress * 0.08 }),
                SAFETY_RECORD_NAMES,
                sampling,
            );
        } else {
            // Reconstruct logfile from the sliced copy so we can call get_records()
            const logCopy = logfile.from_snapshot(safetyBuffer, snapshot);
            records = logCopy.get_records(
                progress => self.postMessage({ type: 'analysis_progress', progress: progress * 0.08 }),
                SAFETY_RECORD_NAMES,
                sampling,
            );
            safetyBuffer = null; // release memory as soon as possible
        }

        self.postMessage({ type: 'analysis_progress', progress: 0.08 });

        // ── STEP 5: Run safety detectors ─────────────────────────────────────────────
        const ai = self.AeroVaneAI || self.AeroVaneAI;
        const analysis = await ai.analyzeDataFlashRecordsWithProgress(records, progress => {
            self.postMessage({ type: 'analysis_progress', progress: 0.08 + progress * 0.92 });
        });

        self.postMessage({ type: 'analysis_complete', analysis });

    } catch (error) {
        self.postMessage({ type: 'error', message: error instanceof Error ? error.message : String(error) });
    }
};
