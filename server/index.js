import 'dotenv/config';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { createApp } from './app.js';
import { providerConfig, publicProviderInfo } from './ai.js';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const port = Number(process.env.PORT || 8787);
const config = providerConfig();
const allowedOrigins = (process.env.ALLOWED_ORIGINS || '').split(',').map(value => value.trim()).filter(Boolean).map(value => new URL(value).origin);
if (!Number.isInteger(port) || port < 1 || port > 65535) throw new Error('PORT 必须是有效端口。');
createApp({ root, config, allowedOrigins, dataDirectory: process.env.DATA_DIRECTORY || join(root, 'data') }).listen(port, '127.0.0.1', () => {
  console.log(`Furniture studio API: http://127.0.0.1:${port} (${publicProviderInfo(config).mode})`);
});
