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

/**
 * 解析多用户令牌配置（.env 中 WB_USERS，JSON：{"用户名":"令牌"} 或 {"用户名":{"token":"...","clientSecret":"..."}}）。
 * 兼容单用户：未配置 WB_USERS 时，WB_TOKEN 作为默认用户"默认"。
 * clientSecret：服务令牌（for=asid:*）调用内容API需要的 X-Client-Secret。
 */
function loadUsers() {
  const map = new Map();
  try {
    const raw = process.env.WB_USERS || env.WB_USERS || '';
    if (raw.trim()) {
      const parsed = JSON.parse(raw);
      for (const [name, value] of Object.entries(parsed)) {
        const n = String(name).trim();
        if (typeof value === 'string') {
          if (value.trim()) map.set(n, { token: value.trim() });
        } else if (value && typeof value === 'object') {
          const t = String(value.token || '').trim();
          if (t) map.set(n, { token: t, clientSecret: String(value.clientSecret || '').trim() || undefined });
        }
      }
    }
  } catch (e) {
    console.error('[config] WB_USERS 解析失败（应为 JSON 对象）:', e.message);
  }
  const legacy = process.env.WB_TOKEN || env.WB_TOKEN || '';
  if (!map.size && legacy) map.set('默认', { token: legacy });
  return map;
}

const users = loadUsers();
const userNames = [...users.keys()];

export const config = {
  port: Number(process.env.PORT || env.PORT || 3000),
  wbToken: process.env.WB_TOKEN || env.WB_TOKEN || '',
  users,                                   // Map<用户名, {token, clientSecret?}>
  userNames,                               // 用户名数组（保持配置顺序）
  defaultUserName: userNames[0] || '默认',   // 默认选中第一个用户
  contentBase: process.env.CONTENT_BASE || 'https://content-api.wildberries.cn',
  marketBase: process.env.MARKET_BASE || 'https://marketplace-api.wildberries.cn',
  pricesBase: process.env.PRICES_BASE || 'https://discounts-prices-api.wildberries.cn',
  locale: process.env.LOCALE || 'zh',
  dataDir: path.join(ROOT, 'data'),
  uploadDir: path.join(ROOT, 'data', 'uploads'),
  root: ROOT,
};

/** 按用户名取令牌；未知用户返回空字符串 */
export function getUserToken(name) {
  if (!name) return config.wbToken;
  const u = config.users.get(String(name));
  return (u && u.token) || '';
}

/** 按用户名取 clientSecret（服务令牌需要）；无则返回空 */
export function getUserSecret(name) {
  if (!name) return '';
  const u = config.users.get(String(name));
  return (u && u.clientSecret) || '';
}

/** 用户是否有效 */
export function isValidUser(name) {
  return Boolean(name) && config.users.has(String(name));
}

export function ensureDirs() {
  fs.mkdirSync(config.dataDir, { recursive: true });
  fs.mkdirSync(config.uploadDir, { recursive: true });
}
