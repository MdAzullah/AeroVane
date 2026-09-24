import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import vm from 'node:vm';

const root = new URL('../', import.meta.url);

async function loadRuntime() {
  const context = vm.createContext({ console });
  context.window = context;
  vm.runInContext(await readFile(new URL('dataflash.js', root), 'utf8'), context);
  vm.runInContext(await readFile(new URL('ai-analysis.js', root), 'utf8'), context);
  return context;
}

async function loadMapRuntime() {
  const context = vm.createContext({ console, Date });
  vm.runInContext(await readFile(new URL('map.js', root), 'utf8'), context);
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

test('shared battery detector reports sustained critical BIN voltage', async () => {
  const context = await loadRuntime();
  const faults = vm.runInContext(`SkyForgeAI.analyzeDataFlashRecords([
    { name: 'BAT', instance: 0, timestampMs: 0, values: { Volt: 9.5 } },
    { name: 'BAT', instance: 0, timestampMs: 4000, values: { Volt: 9.5 } }
  ]).faults`, context);
  assert.ok(faults.some(fault => fault.detectorId === 'battery' && fault.severity === 'critical'));
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
