import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import vm from 'node:vm';

const root = new URL('../', import.meta.url);

async function loadRuntime() {
  const context = vm.createContext({ console, TextDecoder, TextEncoder, setTimeout });
  context.window = context;
  vm.runInContext(await readFile(new URL('dataflash.js', root), 'utf8'), context);
  vm.runInContext(await readFile(new URL('ai-analysis.js', root), 'utf8'), context);
  return context;
}

async function loadMapRuntime() {
  const context = vm.createContext({ console, Date });
  vm.runInContext(await readFile(new URL('map-gl.js', root), 'utf8'), context);
  return context;
}

test('sample BIN decodes into ordered DataFlash records and runs shared analysis', async () => {
  const context = await loadRuntime();
  const bytes = await readFile(new URL('sample_flight.bin', root));
  context.inputBuffer = bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength);
  const summary = vm.runInContext(`(() => {
    const log = new logfile(inputBuffer);
    const records = log.get_records();
    const analysis = SkyForgeAI.analyzeDataFlashRecords(records);
    return { total: log.totalMessages, names: [...new Set(records.map(r => r.name))], ordered: records.every((r, i) => i === 0 || records[i - 1].timestampMs <= r.timestampMs), analysis };
  })()`, context);
  assert.ok(summary.total > 0);
  assert.equal(summary.ordered, true);
  assert.ok(summary.names.includes('BAT'));
  assert.ok(summary.names.includes('GPS'));
  assert.equal(summary.analysis.analyzedRecords, summary.total);
  assert.ok(summary.analysis.healthScore >= 0 && summary.analysis.healthScore <= 100);
});

test('sample BIN recovers its local continuous GPS path from inconsistent FMT widths', async () => {
  const context = await loadRuntime();
  const bytes = await readFile(new URL('sample_flight.bin', root));
  context.inputBuffer = bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength);
  const gps = vm.runInContext('new logfile(inputBuffer).get_gps_series()', context);
  assert.ok(gps.lat.length > 100);
  assert.ok(Math.max(...gps.lat) - Math.min(...gps.lat) < 0.02);
  assert.ok(Math.max(...gps.lon) - Math.min(...gps.lon) < 0.02);
});

test('worker snapshot restores the parsed index without decoding the file twice', async () => {
  const context = await loadRuntime();
  const bytes = await readFile(new URL('sample_flight.bin', root));
  context.inputBuffer = bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength);
  const result = vm.runInContext(`(() => {
    const parsed = new logfile(inputBuffer);
    const restored = logfile.from_snapshot(inputBuffer, parsed.to_snapshot());
    return { before: parsed.get_records().length, after: restored.get_records().length,
      messages: restored.totalMessages, names: restored.get_msgitem_list().map(item => item.name) };
  })()`, context);
  assert.equal(result.before, result.after);
  assert.equal(result.messages, result.after);
  assert.ok(result.names.includes('GPS'));
});

test('ArduPilot text LOG rows decode into the same graph and analysis interface', async () => {
  const context = await loadRuntime();
  const source = [
    'FMT, 1, 32, GPS, QBLLff, TimeUS,Status,NSats,Lat,Lng,Alt,Spd',
    'FMT, 2, 20, BAT, Qff, TimeUS,Volt,Curr',
    'GPS, 1000000, 3, 12, 12.9716, 77.5946, 120.5, 4.2',
    'BAT, 1000000, 15.4, 3.2',
    'BAT, 5000000, 15.3, 3.4',
  ].join('\n');
  context.inputBuffer = new TextEncoder().encode(source).buffer;
  const result = vm.runInContext(`(() => {
    const log = new textlogfile(inputBuffer);
    const gps = log.get_gps_series();
    const restored = textlogfile.from_snapshot(inputBuffer, log.to_snapshot());
    return { count: restored.get_records().length, voltage: restored.get_data_series('BAT', -1, 'Volt').y,
      lat: gps.lat[0], names: restored.get_msgitem_list().map(item => item.name) };
  })()`, context);
  assert.equal(result.count, 3);
  assert.deepEqual(Array.from(result.voltage), [15.4, 15.3]);
  assert.equal(result.lat, 12.9716);
  assert.ok(result.names.includes('GPS'));
});

test('large-log sampling bounds high-rate telemetry without dropping status records', async () => {
  const context = await loadRuntime();
  const records = vm.runInContext(`(() => {
    const log = Object.create(textlogfile.prototype);
    log.records = [
      { name: 'IMU', instance: 0, timestampMs: 0, values: {} },
      { name: 'IMU', instance: 0, timestampMs: 20, values: {} },
      { name: 'IMU', instance: 0, timestampMs: 120, values: {} },
      { name: 'MSG', instance: 0, timestampMs: 30, values: {} },
    ];
    return log.get_records(null, new Set(['IMU', 'MSG']), { IMU: 100 });
  })()`, context);
  assert.deepEqual(Array.from(records, record => [record.name, record.timestampMs]), [['IMU', 0], ['IMU', 120], ['MSG', 30]]);
});

test('shared battery detector reports sustained critical BIN voltage', async () => {
  const context = await loadRuntime();
  const faults = vm.runInContext(`SkyForgeAI.analyzeDataFlashRecords([
    { name: 'BAT', instance: 0, timestampMs: 0, values: { Volt: 9.5 } },
    { name: 'BAT', instance: 0, timestampMs: 4000, values: { Volt: 9.5 } }
  ]).faults`, context);
  assert.ok(faults.some(fault => fault.detectorId === 'battery' && fault.severity === 'critical'));
});

test('large-log analysis reports incremental safety progress while preserving findings', async () => {
  const context = await loadRuntime();
  const result = await vm.runInContext(`(async () => {
    const progress = [];
    const records = Array.from({ length: 2_100 }, (_, index) => ({
      name: 'BAT', instance: 0, timestampMs: index * 1000, values: { Volt: index < 4 ? 9.5 : 15.2 }
    }));
    const analysis = await SkyForgeAI.analyzeDataFlashRecordsWithProgress(records, value => progress.push(value));
    return { analysis, progress };
  })()`, context);
  assert.ok(result.progress.length > 3);
  assert.equal(result.progress.at(-1), 1);
  assert.ok(result.progress.every((value, index) => index === 0 || value >= result.progress[index - 1]));
  assert.ok(result.analysis.faults.some(fault => fault.detectorId === 'battery'));
});

test('huge-log adaptive intervals bound sample count while preserving sustained faults', async () => {
  const context = await loadRuntime();
  const result = await vm.runInContext(`(async () => {
    const log = Object.create(textlogfile.prototype);
    log.records = [];
    for (let i = 0; i < 10000; i++) {
      log.records.push({
        name: 'BAT', instance: 0, timestampMs: i * 10, values: { Volt: i < 500 ? 9.2 : 15.0 }
      });
    }
    const sampling = { BAT: 500 };
    const filtered = log.get_records(null, new Set(['BAT']), sampling);
    const analysis = await SkyForgeAI.analyzeDataFlashRecordsWithProgress(filtered);
    return { original: log.records.length, bounded: filtered.length, faults: analysis.faults.length };
  })()`, context);
  assert.equal(result.original, 10000);
  assert.ok(result.bounded <= 205);
  assert.ok(result.faults >= 1);
});

test('shared notification presenter provides plain-language action guidance', async () => {
  const context = await loadRuntime();
  const result = vm.runInContext(`SkyForgeAI.presentFaultNotification({
    detectorId: 'real-ml-anomaly', faultType: 'ML_FLIGHT_ANOMALY', severity: 'warning',
    message: 'Anomaly detected', suggestedAction: 'Inspect telemetry; land safely', evidence: []
  })`, context);
  assert.equal(result.title, 'Unusual flight behaviour detected');
  assert.equal(result.sourceLabel, 'AI-assisted advisory');
  assert.ok(result.urgency.includes('land as soon as it is safe'));
  assert.ok(result.actions.at(-1).includes('not a confirmed diagnosis'));
});

test('DataFlash canonical extraction preserves missing values and sorts timestamps', async () => {
  const context = await loadRuntime();
  const samples = vm.runInContext(`SkyForgeAI.normalizeDataFlashRecords([
    { name: 'BAT', instance: 0, timestampMs: 2000, values: { Volt: 15.2, Curr: NaN } },
    { name: 'BAT', instance: 0, timestampMs: 1000, values: { Curr: 2.5 } }
  ])`, context);
  assert.deepEqual(Array.from(samples, sample => sample.timestampMs), [1000, 2000]);
  assert.equal(samples[0].values['battery.current_a'], 2.5);
  assert.equal(samples[0].availability['battery.voltage_v'], false);
  assert.equal(samples[0].qualityFlags['battery.voltage_v'][0], 'missing_or_invalid');
  assert.equal(samples[1].values['battery.current_a'], undefined);
  assert.equal(samples[1].availability['battery.current_a'], false);
});

test('DataFlash canonical extraction rejects invalid timestamps', async () => {
  const context = await loadRuntime();
  assert.throws(
    () => vm.runInContext(`SkyForgeAI.normalizeDataFlashRecords([
      { name: 'BAT', instance: 0, timestampMs: NaN, values: { Volt: 15.2 } }
    ])`, context),
    /invalid record timestamp/,
  );
});

test('DataFlash retains source-provided frame parameters without guessing', async () => {
  const context = await loadRuntime();
  const samples = vm.runInContext(`SkyForgeAI.normalizeDataFlashRecords([
    { name: 'PARM', instance: null, timestampMs: 100, values: { Name: 'FRAME_CLASS', Value: 1 } },
    { name: 'PARM', instance: null, timestampMs: 200, values: { Name: 'FRAME_TYPE', Value: 3 } },
    { name: 'BAT', instance: 0, timestampMs: 300, values: { Volt: 15.2 } }
  ])`, context);
  assert.equal(samples[0].frame.frameClass, 1);
  assert.equal(samples[1].frame.frameType, 3);
  assert.equal(samples[2].frame.frameClass, 1);
  assert.equal(samples[2].frame.frameType, 3);
  assert.equal(samples[2].vehicle, undefined);
});

test('DataFlash exposes BASiC classifier sensor families in canonical units', async () => {
  const context = await loadRuntime();
  const samples = vm.runInContext(`SkyForgeAI.normalizeDataFlashRecords([
    { name: 'GPS', instance: 0, timestampMs: 1000, values: { NSats: 12, HDop: 120, Spd: 4, VZ: -1 } },
    { name: 'MAG', instance: 0, timestampMs: 2000, values: { MagX: 100, MagY: 200, MagZ: 300 } },
    { name: 'BARO', instance: 0, timestampMs: 3000, values: { Alt: 42, Press: 101325, Temp: 25, CRt: 150 } },
    { name: 'ATT', instance: 0, timestampMs: 4000, values: { Roll: 90, Pitch: 0, Yaw: 180, DesRoll: 45, DesPitch: 0, DesYaw: 90, ErrRP: 2, ErrYaw: 3 } }
  ])`, context);
  assert.equal(samples[0].values['gps.ground_speed_mps'], 4);
  assert.equal(samples[1].values['magnetometer.x_milligauss'], 100);
  assert.equal(samples[2].values['barometer.pressure_pa'], 101325);
  assert.equal(samples[2].values['velocity.climb_mps'], 1.5);
  assert.ok(Math.abs(samples[3].values['attitude.yaw_rad'] - Math.PI) < 1e-12);
});

test('corrupt input produces a clear unsupported-file error', async () => {
  const context = await loadRuntime();
  context.inputBuffer = new ArrayBuffer(32);
  assert.throws(
    () => vm.runInContext('new logfile(inputBuffer).get_records()', context),
    /corrupt or unsupported/,
  );
});

test('record decoding tolerates sparse DataFlash instance arrays', async () => {
  const context = await loadRuntime();
  const result = vm.runInContext(`(() => {
    const fake = Object.create(logfile.prototype);
    fake.buffer = new ArrayBuffer(16);
    new DataView(fake.buffer).setBigUint64(0, 1000000n, true);
    fake.totalMessages = 1;
    fake.msgtypes = {
      42: {
        name: 'GPS', fields: 'QB', subitemlist: ['TimeUS', 'I'],
        subitemoffset: [0, 8], with_instances: true,
        data: Object.assign([], { 1: [0] })
      }
    };
    return fake.get_records();
  })()`, context);
  assert.equal(result.length, 1);
  assert.equal(result[0].instance, 1);
  assert.equal(result[0].timestampMs, 1000);
});

test('AI map markers select the GPS point nearest the fault timestamp', async () => {
  const context = await loadMapRuntime();
  context.gps = { time: [0, 2, 5, 9], lat: [1, 2, 3, 4], lon: [5, 6, 7, 8] };
  assert.equal(vm.runInContext('find_nearest_gps_index(gps, 4600, 0)', context), 2);
});

test('map path preparation rejects impossible GPS jumps without joining route segments', async () => {
  const context = await loadMapRuntime();
  context.gps = {
    lat: [12, 12.0001, 45, 45.0001], lon: [77, 77.0001, -120, -120.0001],
    time: [0, 1, 2, 3], alt: [1, 2, 3, 4], vel: [2, 2, 2, 2], cenlat: 0, cenlon: 0,
  };
  const result = vm.runInContext('prepare_gps_path(gps)', context);
  assert.equal(result.segments.length, 2);
  assert.equal(result.segments[0].length, 2);
  assert.equal(result.segments[1].length, 2);
});
