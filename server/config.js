import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..');

function loadEnv() {
  const envPath = path.join(ROOT, '.env');
  const env = {};
  if (fs.existsSync(envPath)) {
    for (const line of fs.readFileSync(envPath, 'utf8').split(/\r?\n/)) {
      const m = line.match(/^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)\s*$/);
      if (m) env[m[1]] = m[2].replace(/^['"]|['"]$/g, '');
    }
  }
  return env;
}

const env = loadEnv();

export const config = {
  port: Number(process.env.PORT || env.PORT || 3000),
  wbToken: process.env.WB_TOKEN || env.WB_TOKEN || '',
  contentBase: process.env.CONTENT_BASE || 'https://content-api.wildberries.cn',
  marketBase: process.env.MARKET_BASE || 'https://marketplace-api.wildberries.cn',
  pricesBase: process.env.PRICES_BASE || 'https://discounts-prices-api.wildberries.cn',
  locale: process.env.LOCALE || 'zh',
  dataDir: path.join(ROOT, 'data'),
  uploadDir: path.join(ROOT, 'data', 'uploads'),
  root: ROOT,
};

export function ensureDirs() {
  fs.mkdirSync(config.dataDir, { recursive: true });
  fs.mkdirSync(config.uploadDir, { recursive: true });
}
