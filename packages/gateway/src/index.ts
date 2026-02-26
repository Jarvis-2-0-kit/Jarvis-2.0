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

  const port = Number(process.env['JARVIS_PORT'] ?? DEFAULT_GATEWAY_PORT);
  if (isNaN(port) || port < 1 || port > 65535) {
    log.error(`Invalid JARVIS_PORT: ${process.env['JARVIS_PORT']}. Must be 1-65535.`);
    process.exit(1);
  }

  const authToken = process.env['JARVIS_AUTH_TOKEN'] ?? '';
  if (!authToken || authToken.length < 8) {
    log.warn('JARVIS_AUTH_TOKEN is missing or too short (<8 chars). Authentication will be weak.');
  }

  const server = new GatewayServer({
    port,
    host: process.env['JARVIS_HOST'] ?? '0.0.0.0',
    authToken,
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
