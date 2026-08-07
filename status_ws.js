"use strict";
/*
 * /api/status/ws — the real bar's device→app status stream, faithful enough to
 * carry input events. busylib (AsyncBusyBar.stream_status_ws) opens this
 * WebSocket, sends a {"enable":true} text handshake, then decodes every binary
 * frame as a BSB_State.State protobuf. Apps that drive the bar listen here for
 * button / wheel / switch input, so the emulator's on-screen "Device buttons"
 * only reach a running app if they arrive on THIS channel — not the SSE stream
 * the web UI uses.
 *
 * We hand-roll both the RFC 6455 framing and the (tiny) protobuf encoding to
 * keep the emulator's zero-dependency Node footprint: the only stdlib help used
 * is `crypto` for the handshake SHA-1. We emit InputEvent updates only; the
 * firmware also streams frame updates on this channel, but the web UI already
 * renders frames its own way, and apps only need input from here.
 */
const crypto = require("crypto");

const WS_GUID = "258EAFA5-E914-47DA-95CA-C5AB0DC85B11";
const WS_PATH = "/api/status/ws";

/* ----------------------- protobuf wire format (encode) ------------------- */
// Field numbers/types come straight from bsb-protobuf (state.proto/input.proto),
// the same schema busylib decodes with:
//   State.updates            = field 2, repeated message
//   StateUpdate.input        = field 11, message
//   InputEvent.button_event  = field 1, message
//   InputEvent.switch_event  = field 2, message
//   InputEvent.encoder_event = field 3, message
//   ButtonEvent.button       = field 1, enum   (OK=0, BACK=1, START=2)
//   ButtonEvent.action       = field 2, enum   (PRESS=0, RELEASE=1)
//   SwitchEvent.position     = field 1, enum   (BUSY=0, CUSTOM=1, OFF=2, APPS=3, SETTINGS=4)
//   EncoderEvent.delta       = field 1, sint32 (zigzag)
const BUTTON = { ok: 0, back: 1, start: 2 };
const SWITCH = { busy: 0, custom: 1, off: 2, apps: 3, settings: 4 };

function varint(n) {
  const out = [];
  let v = n >>> 0; // all values we encode are small non-negative ints
  do { let b = v & 0x7f; v >>>= 7; if (v) b |= 0x80; out.push(b); } while (v);
  return Buffer.from(out);
}
function tag(field, wire) { return varint((field << 3) | wire); }
function fieldVarint(field, value) { return Buffer.concat([tag(field, 0), varint(value)]); }
function fieldMessage(field, msg) { return Buffer.concat([tag(field, 2), varint(msg.length), msg]); }
function zigzag(n) { return ((n << 1) ^ (n >> 31)) >>> 0; } // sint32

// proto3 omits default (0) scalars on the wire, so we do too: a PRESS carries no
// "action" and an OK carries no "button", matching what the device sends and
// what busylib's MessageToDict then produces.
function buttonEvent(button, release) {
  const parts = [];
  if (button) parts.push(fieldVarint(1, button)); // OK=0 omitted
  if (release) parts.push(fieldVarint(2, 1));      // PRESS=0 omitted
  return Buffer.concat(parts);
}
function switchEvent(position) { return position ? fieldVarint(1, position) : Buffer.alloc(0); }
function encoderEvent(delta) { const z = zigzag(delta); return z ? Buffer.concat([tag(1, 0), varint(z)]) : Buffer.alloc(0); }

// Wrap one InputEvent (identified by its oneof field number) as a full State frame.
function stateFrame(inputField, inputMsg) {
  const inputEvent = fieldMessage(inputField, inputMsg); // InputEvent.<oneof>
  const stateUpdate = fieldMessage(11, inputEvent);      // StateUpdate.input
  return fieldMessage(2, stateUpdate);                   // State.updates[0]
}
function encodeButton(name, release) { return stateFrame(1, buttonEvent(BUTTON[name] || 0, !!release)); }
function encodeSwitch(name) { return stateFrame(2, switchEvent(SWITCH[name] || 0)); }
function encodeEncoder(delta) { return stateFrame(3, encoderEvent(delta | 0)); }

// Map an /api/input key to the State frame(s) to broadcast. A button press is a
// full click: PRESS then RELEASE, exactly as the hardware reports one tap. The
// wheel steps ±1 detent; the 5-position switch reports its new position.
// Returns null for an unknown key.
function encodeInputKey(key) {
  if (key === "up") return [encodeEncoder(1)];
  if (key === "down") return [encodeEncoder(-1)];
  if (key in BUTTON) return [encodeButton(key, false), encodeButton(key, true)];
  if (key in SWITCH) return [encodeSwitch(key)];
  return null;
}

/* ------------------------------ RFC 6455 --------------------------------- */
function acceptKey(key) { return crypto.createHash("sha1").update(key + WS_GUID).digest("base64"); }

// One server→client frame (never masked). opcode: 0x1 text, 0x2 binary, 0x8 close, 0xA pong.
function encodeFrame(opcode, payload) {
  payload = payload || Buffer.alloc(0);
  const len = payload.length;
  let header;
  if (len < 126) header = Buffer.from([0x80 | opcode, len]);
  else if (len < 65536) header = Buffer.from([0x80 | opcode, 126, (len >> 8) & 0xff, len & 0xff]);
  else {
    header = Buffer.alloc(10);
    header[0] = 0x80 | opcode; header[1] = 127;
    header.writeUInt32BE(Math.floor(len / 4294967296), 2);
    header.writeUInt32BE(len >>> 0, 6);
  }
  return Buffer.concat([header, payload]);
}

/* --------------------------- connection manager -------------------------- */
// authorize(req) → boolean gate for the upgrade (localhost/token parity lives in
// the caller). Returns { handleUpgrade, broadcast, size }.
function createStatusWs(opts) {
  const authorize = (opts && opts.authorize) || (() => true);
  const sockets = new Set();

  function handleUpgrade(req, socket) {
    let pathname;
    try { pathname = new URL(req.url, "http://localhost").pathname; } catch (_) { pathname = req.url; }
    if (pathname !== WS_PATH) { socket.destroy(); return; }
    const key = req.headers["sec-websocket-key"];
    if (!key) { socket.destroy(); return; }
    if (!authorize(req)) { socket.write("HTTP/1.1 401 Unauthorized\r\nConnection: close\r\n\r\n"); socket.destroy(); return; }

    socket.write(
      "HTTP/1.1 101 Switching Protocols\r\n" +
      "Upgrade: websocket\r\n" +
      "Connection: Upgrade\r\n" +
      "Sec-WebSocket-Accept: " + acceptKey(key) + "\r\n\r\n"
    );
    socket.setTimeout(0);
    socket.setNoDelay(true);
    sockets.add(socket);

    let buf = Buffer.alloc(0);
    socket.on("data", (chunk) => { buf = drainFrames(socket, Buffer.concat([buf, chunk])); });
    const drop = () => sockets.delete(socket);
    socket.on("close", drop); socket.on("error", drop); socket.on("end", drop);
  }

  // Consume whole client frames from buf; reply to control frames. The client's
  // data frames (the {"enable":true} text handshake) are ignored — we are a
  // one-way input feed. Returns the unconsumed tail. Client frames are masked
  // per spec, so we unmask before acting on control payloads (close echo).
  function drainFrames(socket, buf) {
    for (;;) {
      if (buf.length < 2) return buf;
      const opcode = buf[0] & 0x0f;
      const masked = (buf[1] & 0x80) !== 0;
      let len = buf[1] & 0x7f, off = 2;
      if (len === 126) { if (buf.length < 4) return buf; len = buf.readUInt16BE(2); off = 4; }
      else if (len === 127) { if (buf.length < 10) return buf; len = Number(buf.readBigUInt64BE(2)); off = 10; }
      const need = off + (masked ? 4 : 0) + len;
      if (buf.length < need) return buf;
      let payload = buf.slice(off + (masked ? 4 : 0), need);
      if (masked) {
        const mask = buf.slice(off, off + 4);
        const out = Buffer.allocUnsafe(len);
        for (let i = 0; i < len; i++) out[i] = payload[i] ^ mask[i & 3];
        payload = out;
      }
      buf = buf.slice(need);
      if (opcode === 0x8) { try { socket.write(encodeFrame(0x8, payload)); } catch (_) {} socket.end(); return Buffer.alloc(0); } // close → echo + close
      else if (opcode === 0x9) { try { socket.write(encodeFrame(0xa, payload)); } catch (_) {} }                                  // ping → pong (keeps busylib alive)
      // text/binary/pong frames from the client are ignored
    }
  }

  function broadcast(stateBuf) {
    const frame = encodeFrame(0x2, stateBuf); // binary
    for (const s of sockets) { try { s.write(frame); } catch (_) {} }
  }

  return { handleUpgrade, broadcast, get size() { return sockets.size; } };
}

module.exports = { createStatusWs, encodeInputKey, encodeButton, encodeSwitch, encodeEncoder, WS_PATH };
