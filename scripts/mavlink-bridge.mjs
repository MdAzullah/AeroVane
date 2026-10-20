#!/usr/bin/env node
import { createHash } from 'node:crypto';
import { createServer as createTcpServer, connect as connectTcp } from 'node:net';
import { createSocket } from 'node:dgram';
import { createServer as createHttpServer } from 'node:http';

const endpointArgs = process.argv.slice(2);
if (endpointArgs.includes('--help') || endpointArgs.length < 2) {
  console.log(`AeroVane portable MAVLink bridge

Usage:
  npm run bridge -- fakesource:// wsserver://127.0.0.1:9988
  npm run bridge -- udpserver://0.0.0.0:14550 wsserver://127.0.0.1:9988
  npm run bridge -- tcpclient://192.168.1.10:5760 wsserver://127.0.0.1:9988
  npm run bridge -- udpserver://0.0.0.0:14550 udpclient://127.0.0.1:14551 wsserver://127.0.0.1:9988

Supported endpoints: fakesource, udpserver, udpclient, tcpserver, tcpclient, wsserver.
For a USB/serial vehicle, connect directly with Live Viewer's Connect USB button.`);
  process.exit(endpointArgs.includes('--help') ? 0 : 1);
}

const outputs = new Set();
const route = (data, origin) => {
  for (const output of outputs) if (output !== origin) output.send(data);
};
const parse = value => {
  const match = /^(\w+):\/\/(.*)$/.exec(value);
  if (!match) throw new Error(`Invalid endpoint: ${value}`);
  const [, type, address] = match;
  if (type === 'fakesource') return { type };
  const split = address.lastIndexOf(':');
  if (split < 0) throw new Error(`Endpoint needs host:port: ${value}`);
  return { type, host: address.slice(0, split) || '0.0.0.0', port: Number(address.slice(split + 1)) };
};

function websocketFrame(payload, opcode = 2) {
  const data = Buffer.from(payload);
  let header;
  if (data.length < 126) header = Buffer.from([0x80 | opcode, data.length]);
  else if (data.length <= 0xffff) {
    header = Buffer.alloc(4); header[0] = 0x80 | opcode; header[1] = 126; header.writeUInt16BE(data.length, 2);
  } else {
    header = Buffer.alloc(10); header[0] = 0x80 | opcode; header[1] = 127; header.writeBigUInt64BE(BigInt(data.length), 2);
  }
  return Buffer.concat([header, data]);
}

function attachWebSocket(socket, initial = Buffer.alloc(0)) {
  let buffer = initial;
  const output = { send: data => socket.writable && socket.write(websocketFrame(data)) };
  outputs.add(output);
  const consume = chunk => {
    buffer = Buffer.concat([buffer, chunk]);
    while (buffer.length >= 2) {
      const opcode = buffer[0] & 0x0f;
      const masked = Boolean(buffer[1] & 0x80);
      let length = buffer[1] & 0x7f;
      let offset = 2;
      if (length === 126) { if (buffer.length < 4) return; length = buffer.readUInt16BE(2); offset = 4; }
      if (length === 127) { if (buffer.length < 10) return; length = Number(buffer.readBigUInt64BE(2)); offset = 10; }
      const maskBytes = masked ? 4 : 0;
      if (buffer.length < offset + maskBytes + length) return;
      const mask = masked ? buffer.subarray(offset, offset + 4) : null;
      offset += maskBytes;
      const payload = Buffer.from(buffer.subarray(offset, offset + length));
      buffer = buffer.subarray(offset + length);
      if (mask) for (let i = 0; i < payload.length; i += 1) payload[i] ^= mask[i % 4];
      if (opcode === 1 || opcode === 2) route(payload, output);
      else if (opcode === 8) { socket.end(websocketFrame(payload, 8)); return; }
      else if (opcode === 9) socket.write(websocketFrame(payload, 10));
    }
  };
  socket.on('data', consume);
  socket.on('close', () => outputs.delete(output));
  socket.on('error', () => outputs.delete(output));
}

function startWebSocket({ host, port }) {
  const server = createHttpServer();
  server.on('upgrade', (request, socket, head) => {
    const key = request.headers['sec-websocket-key'];
    if (!key) return socket.destroy();
    const accept = createHash('sha1').update(`${key}258EAFA5-E914-47DA-95CA-C5AB0DC85B11`).digest('base64');
    socket.write(`HTTP/1.1 101 Switching Protocols\r\nUpgrade: websocket\r\nConnection: Upgrade\r\nSec-WebSocket-Accept: ${accept}\r\n\r\n`);
    attachWebSocket(socket, head);
  });
  server.listen(port, host, () => console.log(`WebSocket server: ws://${host}:${port}`));
}

function startUdpServer(endpoint) {
  const socket = createSocket('udp4');
  let remote;
  const output = { send: data => remote && socket.send(data, remote.port, remote.address) };
  outputs.add(output);
  socket.on('message', (data, sender) => { remote = sender; route(data, output); });
  socket.bind(endpoint.port, endpoint.host, () => console.log(`UDP input: ${endpoint.host}:${endpoint.port}`));
}

function startUdpClient(endpoint) {
  const socket = createSocket('udp4');
  const output = { send: data => socket.send(data, endpoint.port, endpoint.host) };
  outputs.add(output);
  socket.on('message', data => route(data, output));
  console.log(`UDP output: ${endpoint.host}:${endpoint.port}`);
}

function startTcpServer(endpoint) {
  createTcpServer(socket => {
    const output = { send: data => socket.writable && socket.write(data) };
    outputs.add(output);
    socket.on('data', data => route(data, output));
    socket.on('close', () => outputs.delete(output));
    socket.on('error', () => outputs.delete(output));
  }).listen(endpoint.port, endpoint.host, () => console.log(`TCP server: ${endpoint.host}:${endpoint.port}`));
}

function startTcpClient(endpoint) {
  let output;
  const connect = () => {
    const socket = connectTcp(endpoint.port, endpoint.host);
    output = { send: data => socket.writable && socket.write(data) };
    outputs.add(output);
    socket.on('connect', () => console.log(`TCP connected: ${endpoint.host}:${endpoint.port}`));
    socket.on('data', data => route(data, output));
    socket.on('close', () => { outputs.delete(output); setTimeout(connect, 2000); });
    socket.on('error', error => console.error(`TCP connection: ${error.message}`));
  };
  connect();
}

function crcAccumulate(byte, crc) {
  let temporary = byte ^ (crc & 0xff);
  temporary ^= temporary << 4;
  return ((crc >> 8) ^ (temporary << 8) ^ (temporary << 3) ^ (temporary >> 4)) & 0xffff;
}
let sequence = 0;
function heartbeat() {
  const payload = Buffer.from([0, 0, 0, 0, 2, 3, 0, 3, 3]);
  const header = Buffer.from([0xfe, payload.length, sequence++ & 0xff, 1, 1, 0]);
  let crc = 0xffff;
  for (const byte of Buffer.concat([header.subarray(1), payload, Buffer.from([50])])) crc = crcAccumulate(byte, crc);
  const checksum = Buffer.from([crc & 0xff, crc >> 8]);
  route(Buffer.concat([header, payload, checksum]), null);
}

for (const endpoint of endpointArgs.map(parse)) {
  if (endpoint.type === 'wsserver') startWebSocket(endpoint);
  else if (endpoint.type === 'udpserver') startUdpServer(endpoint);
  else if (endpoint.type === 'udpclient') startUdpClient(endpoint);
  else if (endpoint.type === 'tcpserver') startTcpServer(endpoint);
  else if (endpoint.type === 'tcpclient') startTcpClient(endpoint);
  else if (endpoint.type === 'fakesource') setInterval(heartbeat, 1000);
  else throw new Error(`Unsupported endpoint type: ${endpoint.type}`);
}
