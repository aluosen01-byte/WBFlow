/**
 * 源商品解析器：把"源商品"（URL 或手动数据）归一化为标准商品结构。
 *
 * 支持三类来源：
 *  1. wildberries — WB 商品页（best-effort：页面可达时解析 __NUXT__/JSON-LD/meta）
 *  2. generic      — 任意电商商品页（Open Graph + JSON-LD Product + meta）
 *  3. manual       — 用户手动输入 / 粘贴 JSON
 *
 * 归一化商品结构：
 * {
 *   source: 'wildberries' | 'generic' | 'manual',
 *   url: string,
 *   title: string,
 *   description: string,
 *   brand: string,
 *   price: number|null,
 *   currency: string,
 *   images: string[],
 *   attributes: { [name]: string[] },   // 页面结构化特性（颜色/材质/尺码等）
 *   sizes: string[],
 *   sourceSku: string|null,
 *   raw: object                            // 原始解析数据（调试用）
 * }
 */

const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0 Safari/537.36';

function decodeEntities(s) {
  if (!s) return s;
  return s
    .replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&nbsp;/g, ' ');
}

function extractMeta(html, attr, name) {
  // property="..." or name="..."
  const re = new RegExp(`${attr}="${name}" content="([^"]*)"`, 'i');
  const m = html.match(re);
  return m ? decodeEntities(m[1]) : null;
}

/** 从 HTML 提取 JSON-LD 脚本块 */
function extractJsonLd(html) {
  const blocks = [];
  const re = /<script[^>]*type="application\/ld\+json"[^>]*>([\s\S]*?)<\/script>/gi;
  let m;
  while ((m = re.exec(html)) !== null) {
    const raw = m[1].trim();
    try {
      blocks.push(JSON.parse(raw));
    } catch {
      try {
        // 有时是多个对象用逗号拼接
        const arr = JSON.parse(`[${raw.replace(/}\s*{/g, '},{')}]`);
        blocks.push(...arr);
      } catch { /* ignore */ }
    }
  }
  return blocks;
}

/** 在 JSON-LD 树中查找 Product 节点 */
function findProduct(node, depth = 0) {
  if (!node || typeof node !== 'object' || depth > 8) return null;
  if (Array.isArray(node)) {
    for (const item of node) {
      const found = findProduct(item, depth + 1);
      if (found) return found;
    }
    return null;
  }
  if (node['@type'] === 'Product' || (Array.isArray(node['@type']) && node['@type'].includes('Product'))) return node;
  for (const key of Object.keys(node)) {
    if (key.startsWith('@')) continue;
    const found = findProduct(node[key], depth + 1);
    if (found) return found;
  }
  return null;
}

/** 解析 generic 页面 */
function parseGeneric(html, url) {
  const product = {
    source: 'generic',
    url,
    title: null,
    description: null,
    brand: null,
    price: null,
    currency: null,
    images: [],
    attributes: {},
    sizes: [],
    sourceSku: null,
  };

  // JSON-LD Product（最可靠）
  const ld = findProduct(extractJsonLd(html));
  if (ld) {
    product.title = ld.name || product.title;
    product.description = ld.description || product.description;
    product.brand = ld.brand && (typeof ld.brand === 'string' ? ld.brand : ld.brand.name) || product.brand;
    product.sourceSku = ld.sku || ld.mpn || product.sourceSku;
    const off = ld.offers;
    if (off) {
      const offers = Array.isArray(off) ? off : [off];
      const first = offers.find((o) => o && o.price) || offers[0];
      if (first) {
        product.price = Number(first.price);
        product.currency = first.priceCurrency || 'CNY';
      }
    }
    const imgs = ld.image;
    if (imgs) {
      product.images = (Array.isArray(imgs) ? imgs : [imgs])
        .map((i) => (typeof i === 'string' ? i : i.url))
        .filter(Boolean)
        .map((u) => new URL(u, url).href);
    }
  }

  // Open Graph / meta 补充
  if (!product.title) product.title = extractMeta(html, 'property', 'og:title') || extractMeta(html, 'name', 'twitter:title') || null;
  if (!product.description) product.description = extractMeta(html, 'property', 'og:description') || extractMeta(html, 'name', 'description') || null;
  if (!product.title) {
    const t = html.match(/<title>([^<]*)<\/title>/i);
    product.title = t ? decodeEntities(t[1]).trim() : null;
  }
  const ogImg = extractMeta(html, 'property', 'og:image');
  if (ogImg) product.images.unshift(new URL(ogImg, url).href);
  product.images = [...new Set(product.images)].slice(0, 20);

  return product;
}

/** 从 WB 商品页解析（页面可达时）。__NUXT__ 数据或 meta 兜底 */
function parseWildberries(html, url, nmId) {
  const p = parseGeneric(html, url);
  p.source = 'wildberries';
  if (nmId) p.sourceSku = String(nmId);

  // 尝试解析 __NUXT__ 里的商品数据
  const nuxtIdx = html.indexOf('__NUXT__');
  if (nuxtIdx >= 0) {
    try {
      // window.__NUXT__=(function(a,b,c){...})(...); 结构复杂，尝试提取 JSON 区间
      const start = html.indexOf('(', nuxtIdx + 9);
      // 尽力而为：找 imt_name / nm_name 等字段
      const nameM = html.match(/"nm_name":"([^"]+)"/);
      if (nameM) p.title = decodeEntities(nameM[1]);
      const descM = html.match(/"description":"([^"]+)"/);
      if (descM) p.description = decodeEntities(descM[1]);
      const brandM = html.match(/"brand_name":"([^"]+)"/) || html.match(/"brandName":"([^"]+)"/);
      if (brandM) p.brand = decodeEntities(brandM[1]);
      const priceM = html.match(/"salePrice":(\d+)/);
      if (priceM) p.price = Number(priceM[1]);
      const imgM = html.match(/"photos":\[([^\]]+)\]/);
      if (imgM) {
        p.images = imgM[1].match(/"[^"]+"/g).map((s) => s.replace(/"/g, '')).slice(0, 20);
      }
      void start;
    } catch { /* best effort */ }
  }
  return p;
}

/** 识别 URL 类型 */
export function detectSource(url) {
  if (typeof url !== 'string' || !url.trim()) return { type: 'manual', nmId: null };
  let u;
  try { u = new URL(url); } catch { return { type: 'manual', nmId: null }; }
  const host = u.hostname.replace(/^www\./, '');
  const m = u.pathname.match(/\/catalog\/(\d+)\/detail\.aspx/i);
  if ((host.includes('wildberries') || host.includes('wb.ru')) && m) {
    return { type: 'wildberries', nmId: m[1] };
  }
  return { type: 'generic', nmId: null };
}

/** 获取并解析源商品 */
export async function fetchSourceProduct({ url, html } = {}) {
  const { type, nmId } = detectSource(url);
  let product = {
    source: type,
    url: url || null,
    title: null,
    description: null,
    brand: null,
    price: null,
    currency: 'CNY',
    images: [],
    attributes: {},
    sizes: [],
    sourceSku: nmId ? String(nmId) : null,
  };

  if (type === 'manual') {
    return product;
  }

  let content = html;
  if (!content) {
    const res = await fetch(url, {
      headers: {
        'User-Agent': UA,
        'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
        'Accept-Language': 'zh-CN,zh;q=0.9,ru;q=0.8,en;q=0.7',
      },
      redirect: 'follow',
    });
    if (!res.ok) throw new Error(`获取源页面失败: HTTP ${res.status}`);
    content = await res.text();
  }

  product = type === 'wildberries' ? parseWildberries(content, url, nmId) : parseGeneric(content, url);

  // 从标题/特性中尝试提取尺码信息（供特性映射参考）
  const sizeM = product.title ? product.title.match(/(\d{2,3}(?:[,xX×]\d{2,3})*)\s*(?:см|cm|码|号)/i) : null;
  if (sizeM) product.sizes = sizeM[1].split(/[,xX×]/);

  product.raw = { type, nmId };
  return product;
}

/** 手动商品数据校验与归一化 */
export function normalizeManualProduct(input) {
  const p = {
    source: 'manual',
    url: input.url || null,
    title: String(input.title || '').trim(),
    description: String(input.description || '').trim(),
    brand: String(input.brand || '').trim(),
    price: input.price != null && input.price !== '' ? Number(input.price) : null,
    currency: input.currency || 'CNY',
    images: (Array.isArray(input.images) ? input.images : []).filter(Boolean),
    attributes: input.attributes && typeof input.attributes === 'object' ? input.attributes : {},
    sizes: Array.isArray(input.sizes) ? input.sizes.map(String) : [],
    sourceSku: input.sourceSku ? String(input.sourceSku) : null,
  };
  if (!p.title) throw new Error('商品标题不能为空');
  return p;
}
