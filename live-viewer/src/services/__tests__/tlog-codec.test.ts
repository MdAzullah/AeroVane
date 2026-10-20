import { describe, expect, it } from 'vitest';
import { encodeTlogRecord, parseTlogBytes } from '../tlog-codec';
import { MavlinkFrameBuilder } from '../../mavlink/frame-builder';
import { MavlinkFrameParser } from '../../mavlink/frame-parser';
import { MavlinkMessageDecoder } from '../../mavlink/decoder';
import { MavlinkMetadataRegistry } from '../../mavlink/registry';
import { MavlinkTelemetryNormalizer } from '../../analysis';
import { loadCommonDialectJson } from '../../test-helpers/load-dialect';

describe('tlog-codec', () => {
  it('encodes and parses two MAVLink v2 records', () => {
    const packetA = new Uint8Array([0xfd, 0x02, 0x00, 0x00, 0x01, 0x01, 0x01, 0x1e, 0x00, 0x00, 0xaa, 0xbb, 0x11, 0x22]);
    const packetB = new Uint8Array([0xfd, 0x01, 0x00, 0x00, 0x02, 0x01, 0x01, 0x00, 0x00, 0x00, 0xcc, 0x33, 0x44]);

    const recA = encodeTlogRecord(1_000_000, packetA);
    const recB = encodeTlogRecord(2_500_000, packetB);
    const file = new Uint8Array(recA.length + recB.length);
    file.set(recA, 0);
    file.set(recB, recA.length);

    const parsed = parseTlogBytes(file);
    expect(parsed).toHaveLength(2);
    expect(parsed[0].timestampUs).toBe(1_000_000);
    expect(parsed[1].timestampUs).toBe(2_500_000);
    expect(Array.from(parsed[0].packet)).toEqual(Array.from(packetA));
    expect(Array.from(parsed[1].packet)).toEqual(Array.from(packetB));
  });

  it('stops on malformed packet header', () => {
    const badPacket = new Uint8Array([0x00, 0x01, 0x02, 0x03]);
    const rec = encodeTlogRecord(123, badPacket);
    const parsed = parseTlogBytes(rec);
    expect(parsed).toHaveLength(0);
  });

  it('replays a tlog through framing, decoding, and canonical normalization', () => {
    const registry = new MavlinkMetadataRegistry();
    registry.loadFromJsonString(loadCommonDialectJson());
    const packet = new MavlinkFrameBuilder(registry).buildFrame({
      messageName: 'SYS_STATUS',
      values: { voltage_battery: 15_200, current_battery: -1, battery_remaining: 75 },
      systemId: 42,
      componentId: 1,
    });
    const records = parseTlogBytes(encodeTlogRecord(1_250_000, packet));
    expect(records).toHaveLength(1);

    const parser = new MavlinkFrameParser(registry);
    const decoder = new MavlinkMessageDecoder(registry);
    const normalizer = new MavlinkTelemetryNormalizer('tlog');
    const samples: ReturnType<MavlinkTelemetryNormalizer['normalize']>[] = [];
    parser.onFrame(frame => {
      const message = decoder.decode(frame);
      if (message) samples.push(normalizer.normalize(message, records[0].timestampUs / 1000));
    });
    parser.parse(records[0].packet);

    expect(samples).toHaveLength(1);
    const sample = samples[0]!;
    expect(sample).not.toBeNull();
    expect(sample).toMatchObject({
      timestampMs: 1_250,
      source: 'tlog',
      vehicleId: '42:1',
      values: { 'battery.remaining_pct': 75 },
      availability: {
        'battery.voltage_v': true,
        'battery.current_a': false,
        'battery.remaining_pct': true,
      },
      qualityFlags: { 'battery.current_a': ['missing_or_invalid'] },
    });
    expect(sample!.values['battery.voltage_v']).toBeCloseTo(15.2);
    for (const signal of Object.keys(sample!.values)) {
      expect(sample!.availability?.[signal]).toBe(true);
      expect(sample!.units?.[signal]).toBeTruthy();
    }
  });
});
