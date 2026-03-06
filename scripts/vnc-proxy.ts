/**
 * WebSocket-to-VNC proxy with server-side ARD authentication.
 *
 * Runs on each agent machine: ws://0.0.0.0:6080 → localhost:5900
 *
 * The proxy authenticates with the macOS VNC server using Apple Remote
 * Desktop auth (type 30, DH + AES), then presents a clean unauthenticated
 * (type 1 "None") connection to the noVNC client. This bypasses all
 * client-side auth issues (DES legacy, ARD crypto in Electron, password
 * mismatch with kickstart, etc.)
 *
 * Environment variables:
 *   VNC_USERNAME — macOS login username (required for ARD auth)
 *   VNC_PASSWORD — macOS login password (required for ARD auth)
 */
import { createServer } from 'node:http';
import { createConnection, type Socket } from 'node:net';
import { createDiffieHellman, createHash, createCipheriv, randomBytes } from 'node:crypto';
import { WebSocketServer, type WebSocket } from 'ws';

const WS_PORT = parseInt(process.argv[2] ?? '6080', 10);
const VNC_HOST = '127.0.0.1';
const VNC_PORT = 5900;
const VNC_USER = process.env['VNC_USERNAME'] ?? '';
const VNC_PASS = process.env['VNC_PASSWORD'] ?? '';

if (!VNC_USER || !VNC_PASS) {
  console.error('[vnc-proxy] ERROR: VNC_USERNAME and VNC_PASSWORD env vars required');
  process.exit(1);
}

const http = createServer((_req, res) => {
  res.writeHead(200, { 'Content-Type': 'text/plain' });
  res.end('VNC WebSocket proxy OK');
});

const wss = new WebSocketServer({
  server: http,
  maxPayload: 10 * 1024 * 1024,
  perMessageDeflate: false,  // No compression over Thunderbolt — saves CPU
  handleProtocols: (protocols: Set<string>) => {
    if (protocols.has('binary')) return 'binary';
    return false as unknown as string;
  },
});

// ── ARD Auth (type 30) implementation ──────────────────────────────
async function authenticateARD(tcp: Socket): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    let buf = Buffer.alloc(0);
    let phase = 0; // 0=version, 1=types, 2=ardParams, 3=result+init

    const onData = (data: Buffer) => {
      buf = Buffer.concat([buf, data]);

      // Phase 0: Read server version (12 bytes)
      if (phase === 0 && buf.length >= 12) {
        const version = buf.subarray(0, 12).toString('ascii').trim();
        console.log(`[vnc-proxy] Server: ${version}`);
        tcp.write(Buffer.from('RFB 003.008\n'));
        buf = buf.subarray(12);
        phase = 1;
      }

      // Phase 1: Read security types
      if (phase === 1 && buf.length > 0) {
        const count = buf[0];
        if (buf.length >= 1 + count) {
          const types = [...buf.subarray(1, 1 + count)];
          console.log(`[vnc-proxy] Security types: [${types.join(', ')}]`);

          if (!types.includes(30)) {
            reject(new Error(`ARD type 30 not offered (types: ${types})`));
            return;
          }

          tcp.write(Buffer.from([30])); // Select ARD
          buf = buf.subarray(1 + count);
          phase = 2;
        }
      }

      // Phase 2: Read ARD DH params and perform authentication
      if (phase === 2 && buf.length >= 4) {
        const generator = buf.readUInt16BE(0);
        const keyLength = buf.readUInt16BE(2);
        const needed = 4 + keyLength * 2; // generator(2) + keyLen(2) + prime(keyLen) + serverPubKey(keyLen)

        if (buf.length >= needed) {
          const prime = buf.subarray(4, 4 + keyLength);
          const serverPubKey = buf.subarray(4 + keyLength, 4 + keyLength * 2);

          console.log(`[vnc-proxy] ARD DH: generator=${generator} keyLength=${keyLength}`);

          try {
            // Generate DH key pair
            const dh = createDiffieHellman(prime, Buffer.from([generator]));
            dh.generateKeys();

            // Derive shared secret
            const sharedSecret = dh.computeSecret(serverPubKey);

            // Build credentials block (128 bytes): username[0..63] + password[64..127]
            const credentials = randomBytes(128);
            const usernameBytes = Buffer.from(VNC_USER, 'utf-8').subarray(0, 63);
            const passwordBytes = Buffer.from(VNC_PASS, 'utf-8').subarray(0, 63);

            usernameBytes.copy(credentials, 0);
            credentials[usernameBytes.length] = 0;
            passwordBytes.copy(credentials, 64);
            credentials[64 + passwordBytes.length] = 0;

            // AES key = MD5(sharedSecret)
            const aesKey = createHash('md5').update(sharedSecret).digest();

            // Encrypt credentials with AES-128-ECB
            const cipher = createCipheriv('aes-128-ecb', aesKey, null);
            cipher.setAutoPadding(false);
            const encrypted = Buffer.concat([cipher.update(credentials), cipher.final()]);

            // Send: encrypted_credentials (128b) + client_public_key
            const clientPubKey = dh.getPublicKey();
            // Pad client public key to keyLength
            const paddedPubKey = Buffer.alloc(keyLength);
            clientPubKey.copy(paddedPubKey, keyLength - clientPubKey.length);

            tcp.write(Buffer.concat([encrypted, paddedPubKey]));
            console.log(`[vnc-proxy] ARD: sent encrypted credentials + public key`);

            buf = buf.subarray(needed);
            phase = 3;
          } catch (e) {
            reject(new Error(`ARD crypto failed: ${(e as Error).message}`));
            return;
          }
        }
      }

      // Phase 3: Read SecurityResult (4 bytes) + rest is ServerInit
      if (phase === 3 && buf.length >= 4) {
        const status = buf.readUInt32BE(0);
        if (status === 0) {
          console.log(`[vnc-proxy] ARD auth: SUCCESS`);
          // Remove the data handler — we're done with auth
          tcp.removeListener('data', onData);
          // Return remaining data (SecurityResult removed, ServerInit etc.)
          resolve(buf.subarray(4));
        } else {
          // Read reason if available
          if (buf.length >= 8) {
            const reasonLen = buf.readUInt32BE(4);
            if (buf.length >= 8 + reasonLen) {
              const reason = buf.subarray(8, 8 + reasonLen).toString();
              reject(new Error(`ARD auth failed: ${reason}`));
              return;
            }
          }
          reject(new Error(`ARD auth failed: status=${status}`));
        }
      }
    };

    tcp.on('data', onData);
    tcp.on('error', (err) => reject(new Error(`TCP error: ${err.message}`)));
    tcp.on('close', () => reject(new Error('TCP closed during auth')));
  });
}

// ── Connection handler ─────────────────────────────────────────────
wss.on('connection', (ws: WebSocket, req) => {
  const ip = req.socket.remoteAddress ?? '?';
  console.log(`[vnc-proxy] WS connected from ${ip}`);

  const tcp = createConnection(VNC_PORT, VNC_HOST);
  tcp.setNoDelay(true);  // Disable Nagle's algorithm — reduces latency

  tcp.on('connect', async () => {
    console.log(`[vnc-proxy] TCP connected, authenticating...`);

    try {
      // Authenticate with VNC server — returns any data after SecurityResult
      const serverInitData = await authenticateARD(tcp);

      // Now present a clean connection to the noVNC client
      // Send fake RFB version
      ws.send(Buffer.from('RFB 003.008\n'), { binary: true });

      // Wait for client version response
      const clientVersion = await waitForWsMessage(ws);
      console.log(`[vnc-proxy] Client version: ${clientVersion.toString('ascii').trim()}`);

      // Send security types: only type 1 (None)
      ws.send(Buffer.from([1, 1]), { binary: true }); // count=1, type=1

      // Wait for client to select type 1
      const typeSelection = await waitForWsMessage(ws);
      console.log(`[vnc-proxy] Client selected type: ${typeSelection[0]}`);

      // Send SecurityResult OK
      ws.send(Buffer.from([0, 0, 0, 0]), { binary: true });

      // Wait for client shared flag
      const sharedFlag = await waitForWsMessage(ws);
      console.log(`[vnc-proxy] Client shared flag: ${sharedFlag[0]}`);

      // Send shared flag to server (we already authenticated, but server needs it)
      tcp.write(sharedFlag);

      // Forward any buffered ServerInit data (if server already sent it)
      // Actually, after ARD auth success, the server waits for shared flag before sending ServerInit
      // So we need to wait for ServerInit from server

      // Now switch to pure passthrough mode
      console.log(`[vnc-proxy] Auth complete — entering passthrough mode`);

      // Forward any remaining buffered data from server
      if (serverInitData.length > 0) {
        ws.send(serverInitData, { binary: true });
      }

      // Passthrough: VNC → WS
      tcp.on('data', (data: Buffer) => {
        if (ws.readyState === 1) {
          try { ws.send(data, { binary: true }); } catch { /* ignore */ }
        }
      });

      // Passthrough: WS → VNC
      ws.on('message', (data: Buffer | ArrayBuffer) => {
        const buf = Buffer.isBuffer(data) ? data : Buffer.from(data);
        if (tcp.writable) tcp.write(buf);
      });

    } catch (err) {
      console.error(`[vnc-proxy] Auth failed:`, (err as Error).message);
      ws.close();
      tcp.destroy();
      return;
    }
  });

  ws.on('close', () => {
    console.log(`[vnc-proxy] WS closed`);
    tcp.destroy();
  });

  tcp.on('close', () => {
    console.log(`[vnc-proxy] TCP closed`);
    if (ws.readyState === 1) ws.close();
  });

  tcp.on('error', (err) => {
    console.error(`[vnc-proxy] TCP error:`, err.message);
    if (ws.readyState === 1) ws.close();
  });

  ws.on('error', (err) => {
    console.error(`[vnc-proxy] WS error:`, err.message);
    tcp.destroy();
  });
});

function waitForWsMessage(ws: WebSocket): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const onMessage = (data: Buffer | ArrayBuffer) => {
      ws.removeListener('message', onMessage);
      ws.removeListener('close', onClose);
      resolve(Buffer.isBuffer(data) ? data : Buffer.from(data));
    };
    const onClose = () => {
      ws.removeListener('message', onMessage);
      reject(new Error('WS closed while waiting for message'));
    };
    ws.on('message', onMessage);
    ws.on('close', onClose);
  });
}

http.listen(WS_PORT, '0.0.0.0', () => {
  console.log(`[vnc-proxy] Listening on ws://0.0.0.0:${WS_PORT} → ${VNC_HOST}:${VNC_PORT}`);
  console.log(`[vnc-proxy] Auth: ARD (type 30) as ${VNC_USER}`);
});
