import { config } from 'dotenv';
import { createLogger, DEFAULT_GATEWAY_PORT } from '@jarvis/shared';
import { GatewayServer } from './server.js';

import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

// Load .env from project root
const __dirname = dirname(fileURLToPath(import.meta.url));
config({ path: resolve(__dirname, '../../../.env') });
config(); // Also check local .env

const log = createLogger('gateway');

async function main(): Promise<void> {
  const thunderboltEnabled = process.env['THUNDERBOLT_ENABLED'] === 'true';

  const server = new GatewayServer({
    port: Number(process.env['JARVIS_PORT'] ?? DEFAULT_GATEWAY_PORT),
    host: process.env['JARVIS_HOST'] ?? '0.0.0.0',
    authToken: process.env['JARVIS_AUTH_TOKEN'] ?? '',
    natsUrl: process.env['NATS_URL'] ?? 'nats://localhost:4222',
    natsUrlThunderbolt: thunderboltEnabled ? process.env['NATS_URL_THUNDERBOLT'] : undefined,
    redisUrl: process.env['REDIS_URL'] ?? 'redis://localhost:6379',
    nasMountPath: process.env['JARVIS_NAS_MOUNT'],
  });

  // Graceful shutdown
  const shutdown = async () => {
    log.info('Received shutdown signal');
    await server.stop();
    process.exit(0);
  };

  process.on('SIGINT', () => void shutdown());
  process.on('SIGTERM', () => void shutdown());

  try {
    await server.start();
    log.info('Jarvis 2.0 Gateway is running');
  } catch (err) {
    log.error('Failed to start gateway', { error: String(err) });
    process.exit(1);
  }
}

void main();
