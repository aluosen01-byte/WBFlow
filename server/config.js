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

/** 解码 JWT payload（用于判断令牌类型：for=asid:* 为服务令牌） */
function decodeJwtPayload(token) {
  try {
    const part = String(token || '').split('.')[1];
    if (!part) return {};
    const json = Buffer.from(part.replace(/-/g, '+').replace(/_/g, '/'), 'base64').toString('utf8');
    return JSON.parse(json);
  } catch { return {}; }
}

/**
 * 解析多用户令牌配置（.env 中 WB_USERS，JSON：{"用户名":"令牌"} 或 {"用户名":{"token":"...","clientSecret":"..."}}）。
 * 兼容单用户：未配置 WB_USERS 时，WB_TOKEN 作为默认用户"默认"。
 * clientSecret：服务令牌（for=asid:*）调用内容API需要的 X-Client-Secret。
 * type：'service'（服务令牌，需 clientSecret）| 'personal'（个人令牌）
 */
function loadUsers() {
  const map = new Map();
  try {
    const raw = process.env.WB_USERS || env.WB_USERS || '';
    if (raw.trim()) {
      const parsed = JSON.parse(raw);
      for (const [name, value] of Object.entries(parsed)) {
        const n = String(name).trim();
        let token = '';
        let clientSecret;
        if (typeof value === 'string') {
          token = value.trim();
        } else if (value && typeof value === 'object') {
          token = String(value.token || '').trim();
          clientSecret = String(value.clientSecret || '').trim() || undefined;
        }
        if (!token) continue;
        const payload = decodeJwtPayload(token);
        const isService = String(payload.for || '').startsWith('asid');
        map.set(n, { token, clientSecret, type: isService ? 'service' : 'personal' });
      }
    }
  } catch (e) {
    console.error('[config] WB_USERS 解析失败（应为 JSON 对象）:', e.message);
  }
  const legacy = process.env.WB_TOKEN || env.WB_TOKEN || '';
  if (!map.size && legacy) map.set('默认', { token: legacy, type: 'personal' });
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

/** 按用户名取令牌类型：'service'（服务令牌）| 'personal' */
export function getUserType(name) {
  if (!name) return 'personal';
  const u = config.users.get(String(name));
  return (u && u.type) || 'personal';
}

/** 该用户是否可用：服务令牌必须有 clientSecret 才能调内容API */
export function isUserUsable(name) {
  const u = config.users.get(String(name));
  if (!u) return false;
  if (u.type === 'service' && !u.clientSecret) return false;
  return true;
}

/** 获取服务令牌缺少 clientSecret 时的中文配置指引 */
export function serviceSecretHint(name) {
  return `账号「${name}」为服务令牌（for=asid:*），调用内容API需要 X-Client-Secret。`
    + `请在 .env 的 WB_USERS 中配置：{"${name}":{"token":"...","clientSecret":"你的secret"}}，`
    + `或切换到个人令牌账号（如 罗世凯 等）。`;
}

/** 用户是否有效 */
export function isValidUser(name) {
  return Boolean(name) && config.users.has(String(name));
}

export function ensureDirs() {
  fs.mkdirSync(config.dataDir, { recursive: true });
  fs.mkdirSync(config.uploadDir, { recursive: true });
}
