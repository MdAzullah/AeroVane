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
  private readonly onDisconnect?: () => void;

  constructor(url: string, onDisconnect?: () => void) {
    this.url = url;
    this.onDisconnect = onDisconnect;
  }

  get isConnected(): boolean {
    return this._isConnected;
  }

  onData(callback: ByteCallback): () => void {
    this.callbacks.add(callback);
    return () => this.callbacks.delete(callback);
  }

  connect(): Promise<void> {
    return new Promise((resolve, reject) => {
      let settled = false;
      let socket: WebSocket;

      try {
        socket = new WebSocket(this.url);
      } catch (err) {
        reject(err instanceof Error ? err : new Error('Failed to create WebSocket'));
        return;
      }

      socket.binaryType = 'arraybuffer';

      socket.onopen = () => {
        this._isConnected = true;
        settled = true;
        resolve();
      };

      socket.onmessage = (event: MessageEvent) => {
        if (!this._isConnected) return;
        const data = event.data instanceof ArrayBuffer
          ? new Uint8Array(event.data)
          : null;
        if (!data) return; // ignore non-binary frames (e.g. text/JSON status messages)
        for (const cb of this.callbacks) {
          cb(data);
        }
      };

      socket.onerror = () => {
        if (!settled) {
          settled = true;
          reject(new Error(`WebSocket connection failed: ${this.url}`));
        }
      };

      socket.onclose = () => {
        const wasConnected = this._isConnected;
        this._isConnected = false;
        if (!settled) {
          settled = true;
          reject(new Error(`WebSocket closed before connecting: ${this.url}`));
        } else if (wasConnected) {
          this.onDisconnect?.();
        }
      };

      this.socket = socket;
    });
  }

  async disconnect(): Promise<void> {
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
