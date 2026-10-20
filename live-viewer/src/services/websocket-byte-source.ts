/**
 * WebSocket byte source — reads raw MAVLink bytes from a WebSocket endpoint.
 *
 * Used to connect to network-bridged MAVLink feeds (e.g. SITL's UDP output,
 * or a network telemetry radio/antenna) via a bridge such as
 * bluerobotics/mavlink-server's `wsserver://` endpoint, which serves raw
 * binary MAVLink frames (NOT the REST/JSON `--web-server` dashboard mode).
 *
 * Unlike Web Serial, the WebSocket API is available inside Web Workers,
 * so this source can run directly in the MAVLink worker — no main-thread
 * relay is needed (contrast with WebSerialByteSource + ExternalByteSource).
 */

import type { ByteCallback, IByteSource } from './byte-source';

export class WebSocketByteSource implements IByteSource {
  private socket: WebSocket | null = null;
  private readonly callbacks = new Set<ByteCallback>();
  private _isConnected = false;
  private readonly url: string;
  private retryTimer: ReturnType<typeof setTimeout> | null = null;
  private stableTimer: ReturnType<typeof setTimeout> | null = null;
  private manuallyDisconnected = false;
  private retryCount = 0;
  private generation = 0;
  private lastPacketAt: number | null = null;
  private readonly onLifecycle?: (event: WebSocketLifecycleEvent) => void;

  constructor(url: string, onLifecycle?: (event: WebSocketLifecycleEvent) => void) {
    this.url = url;
    this.onLifecycle = onLifecycle;
  }

  get isConnected(): boolean {
    return this._isConnected;
  }

  onData(callback: ByteCallback): () => void {
    this.callbacks.add(callback);
    return () => this.callbacks.delete(callback);
  }

  connect(): Promise<void> {
    this.manuallyDisconnected = false;
    this.clearRetryTimer();
    const generation = ++this.generation;
    return new Promise((resolve, reject) => {
      this.openSocket(generation, resolve, reject);
    });
  }

  private openSocket(generation: number, resolve?: () => void, reject?: (error: Error) => void): void {
    if (this.manuallyDisconnected || generation !== this.generation) return;
    let socket: WebSocket;
    try {
      socket = new WebSocket(this.url);
    } catch (err) {
      const error = err instanceof Error ? err : new Error('Failed to create WebSocket');
      reject?.(error);
      this.onLifecycle?.({ state: 'failed', retryCount: this.retryCount, reason: error.message, lastPacketAt: this.lastPacketAt });
      return;
    }

    this.socket = socket;
    socket.binaryType = 'arraybuffer';

    socket.onopen = () => {
      if (generation !== this.generation || socket !== this.socket) return;
      this._isConnected = true;
      this.onLifecycle?.({ state: 'connected', retryCount: this.retryCount, lastPacketAt: this.lastPacketAt });
      resolve?.();
      this.clearStableTimer();
      this.stableTimer = setTimeout(() => { this.retryCount = 0; }, 10_000);
    };

    socket.onmessage = (event: MessageEvent) => {
      if (!this._isConnected || socket !== this.socket) return;
      const data = event.data instanceof ArrayBuffer ? new Uint8Array(event.data) : null;
      if (!data) return;
      this.lastPacketAt = Date.now();
      for (const cb of this.callbacks) cb(data);
    };

    socket.onerror = () => {
      if (socket.readyState !== WebSocket.CLOSED) socket.close();
    };

    socket.onclose = (event: CloseEvent) => {
      if (generation !== this.generation || socket !== this.socket) return;
      this._isConnected = false;
      this.clearStableTimer();
      if (this.manuallyDisconnected) return;
      this.retryCount += 1;
      const delayMs = Math.min(10_000, 1_000 * (2 ** Math.min(this.retryCount - 1, 4)));
      this.onLifecycle?.({ state: 'reconnecting', retryCount: this.retryCount, delayMs, closeCode: event.code, reason: event.reason || 'Socket closed', lastPacketAt: this.lastPacketAt });
      this.retryTimer = setTimeout(() => {
        this.retryTimer = null;
        this.openSocket(generation, resolve, reject);
      }, delayMs);
    };
  }

  private clearRetryTimer(): void {
    if (this.retryTimer !== null) clearTimeout(this.retryTimer);
    this.retryTimer = null;
  }

  private clearStableTimer(): void {
    if (this.stableTimer !== null) clearTimeout(this.stableTimer);
    this.stableTimer = null;
  }

  async disconnect(): Promise<void> {
    this.manuallyDisconnected = true;
    this.generation += 1;
    this.clearRetryTimer();
    this.clearStableTimer();
    this._isConnected = false;
    this.callbacks.clear();
    try {
      this.socket?.close();
    } catch {
      // already closed
    }
    this.socket = null;
  }

  async write(data: Uint8Array): Promise<void> {
    if (!this.socket || this.socket.readyState !== WebSocket.OPEN) {
      throw new Error('WebSocket not connected');
    }
    this.socket.send(data);
  }
}

export interface WebSocketLifecycleEvent {
  state: 'connected' | 'reconnecting' | 'failed';
  retryCount: number;
  delayMs?: number;
  closeCode?: number;
  reason?: string;
  lastPacketAt: number | null;
}
