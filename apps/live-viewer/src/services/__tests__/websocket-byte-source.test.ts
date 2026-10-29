import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { WebSocketByteSource, type WebSocketLifecycleEvent } from '../websocket-byte-source';

class FakeWebSocket {
  static instances: FakeWebSocket[] = [];
  static OPEN = 1;
  static CLOSED = 3;
  binaryType = '';
  readyState = 0;
  onopen: (() => void) | null = null;
  onmessage: ((event: MessageEvent) => void) | null = null;
  onerror: (() => void) | null = null;
  onclose: ((event: CloseEvent) => void) | null = null;
  constructor(readonly url: string) { FakeWebSocket.instances.push(this); }
  open() { this.readyState = FakeWebSocket.OPEN; this.onopen?.(); }
  message(data: unknown) { this.onmessage?.({ data } as MessageEvent); }
  close(code = 1006, reason = '') { this.readyState = FakeWebSocket.CLOSED; this.onclose?.({ code, reason } as CloseEvent); }
  send(_data: Uint8Array) {}
}

describe('WebSocketByteSource lifecycle', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    FakeWebSocket.instances = [];
    vi.stubGlobal('WebSocket', FakeWebSocket);
  });
  afterEach(() => { vi.unstubAllGlobals(); vi.useRealTimers(); });

  it('delivers binary data and ignores text without disconnecting', async () => {
    const source = new WebSocketByteSource('ws://127.0.0.1:9988');
    const packets: Uint8Array[] = [];
    source.onData(data => packets.push(data));
    const connected = source.connect();
    FakeWebSocket.instances[0].open();
    await connected;
    FakeWebSocket.instances[0].message('status');
    FakeWebSocket.instances[0].message(new Uint8Array([1, 2]).buffer);
    expect(source.isConnected).toBe(true);
    expect([...packets[0]]).toEqual([1, 2]);
  });

  it('reconnects with backoff and keeps only one active socket', async () => {
    const events: WebSocketLifecycleEvent[] = [];
    const source = new WebSocketByteSource('ws://127.0.0.1:9988', event => events.push(event));
    const connected = source.connect();
    FakeWebSocket.instances[0].open();
    await connected;
    FakeWebSocket.instances[0].close(1006, 'bridge stopped');
    expect(events.at(-1)).toMatchObject({ state: 'reconnecting', retryCount: 1, delayMs: 1000, closeCode: 1006 });
    expect(FakeWebSocket.instances).toHaveLength(1);
    await vi.advanceTimersByTimeAsync(1000);
    expect(FakeWebSocket.instances).toHaveLength(2);
    FakeWebSocket.instances[1].close();
    await vi.advanceTimersByTimeAsync(1999);
    expect(FakeWebSocket.instances).toHaveLength(2);
    await vi.advanceTimersByTimeAsync(1);
    expect(FakeWebSocket.instances).toHaveLength(3);
  });

  it('manual disconnect cancels reconnection', async () => {
    const source = new WebSocketByteSource('ws://127.0.0.1:9988');
    const connected = source.connect();
    FakeWebSocket.instances[0].open();
    await connected;
    FakeWebSocket.instances[0].close();
    await source.disconnect();
    await vi.advanceTimersByTimeAsync(20_000);
    expect(FakeWebSocket.instances).toHaveLength(1);
  });

  it('recovers packet delivery after reconnection', async () => {
    const source = new WebSocketByteSource('ws://127.0.0.1:9988');
    const packet = vi.fn();
    source.onData(packet);
    const connected = source.connect();
    FakeWebSocket.instances[0].open();
    await connected;
    FakeWebSocket.instances[0].close();
    await vi.advanceTimersByTimeAsync(1000);
    FakeWebSocket.instances[1].open();
    FakeWebSocket.instances[1].message(new Uint8Array([42]).buffer);
    expect(packet).toHaveBeenCalledOnce();
  });
});
