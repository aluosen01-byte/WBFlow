import { config } from './config.js';

/**
 * WB API 客户端：统一封装请求、鉴权、错误解析与限流退避。
 * 网关：
 *  - 内容 API: content-api.wildberries.cn
 *  - 市场 API: marketplace-api.wildberries.cn（价格/仓库/库存）
 */
export class WbApiError extends Error {
  constructor(status, title, detail, extra = {}) {
    super(detail || title || `HTTP ${status}`);
    this.name = 'WbApiError';
    this.status = status;
    this.title = title;
    this.detail = detail;
    this.extra = extra;
  }
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function request(base, path, { method = 'GET', body, headers = {}, retries = 2 } = {}) {
  const url = path.startsWith('http') ? path : base + path;
  const isForm = typeof FormData !== 'undefined' && body instanceof FormData;
  const h = {
    Authorization: config.wbToken,
    ...(isForm ? {} : { 'Content-Type': 'application/json' }),
    ...headers,
  };
  let lastErr;
  for (let attempt = 0; attempt <= retries; attempt++) {
    let res;
    try {
      res = await fetch(url, {
        method,
        headers: h,
        body: body !== undefined
          ? (typeof body === 'string' ? body : isForm ? body : JSON.stringify(body))
          : undefined,
      });
    } catch (e) {
      lastErr = e;
      if (attempt < retries) { await sleep(500 * (attempt + 1)); continue; }
      throw new WbApiError(0, 'NetworkError', `请求失败: ${e.message}`);
    }

    if (res.status === 429) {
      const retryAfter = Number(res.headers.get('retry-after') || 1) * 1000;
      if (attempt < retries) { await sleep(Math.min(retryAfter, 5000) + 500); continue; }
    }

    const text = await res.text();
    let data = null;
    let contentType = res.headers.get('content-type') || '';
    if (text && (contentType.includes('json') || text.trim().startsWith('{'))) {
      try { data = JSON.parse(text); } catch { data = text; }
    } else if (text) {
      data = text;
    }

    if (!res.ok) {
      const title = data?.title || res.statusText;
      const detail = data?.detail || data?.errorText || (typeof data === 'string' ? data : '');
      if (attempt < retries && (res.status === 500 || res.status === 502 || res.status === 503 || res.status === 504)) {
        lastErr = new WbApiError(res.status, title, detail, { data });
        await sleep(700 * (attempt + 1));
        continue;
      }
      throw new WbApiError(res.status, title, detail, { data });
    }
    return data;
  }
  throw lastErr;
}

/** 内容 API 请求 */
export function contentRequest(path, opts = {}) {
  return request(config.contentBase, path, opts);
}

/** 市场 API 请求 */
export function marketRequest(path, opts = {}) {
  return request(config.marketBase, path, opts);
}

/** 通用请求（可指定任意网关绝对地址） */
export function apiRequest(url, opts = {}) {
  return request(null, url, opts);
}

/** 校验令牌是否可用 */
export async function checkToken() {
  try {
    const data = await contentRequest(`/content/v2/object/parent/all?locale=${config.locale}`);
    const parents = (data?.data || []).map((p) => ({ id: p.id, name: p.name }));
    return { ok: true, parentCount: parents.length };
  } catch (e) {
    return { ok: false, error: e.message };
  }
}
