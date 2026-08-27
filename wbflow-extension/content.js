/* WBFlow 一键搬品 · WB商品页注入脚本 */
'use strict';

(() => {
  if (window.__WBF_LOADED__) return;
  window.__WBF_LOADED__ = true;

  const NM_MATCH = window.location.pathname.match(/\/catalog\/(\d+)\/detail\.aspx/i);
  if (!NM_MATCH) return; // 非商品详情页不注入
  const NM_ID = NM_MATCH[1];

  const ICONS = { done: '√', err: '×', skip: '-', run: '…' };

  /* ============ 配置 ============ */
  async function getConfig() {
    return new Promise((resolve) => {
      chrome.runtime.sendMessage({ type: 'getConfig' }, (cfg) => resolve(cfg || {}));
    });
  }

  async function api(base, path, opts = {}) {
    const headers = {};
    if (opts.body) headers['Content-Type'] = 'application/json';
    // 多用户：请求携带当前操作账号（X-WB-User），后端按账号令牌鉴权
    if (state.config && state.config.currentUser) headers['X-WB-User'] = encodeURIComponent(state.config.currentUser);
    const r = await fetch(base.replace(/\/$/, '') + path, { ...opts, headers });
    const j = await r.json().catch(() => ({}));
    if (!r.ok) throw new Error(j.error || `HTTP ${r.status}`);
    return j;
  }

  /* ============ 商品数据分层提取 ============ */

  function deepFind(node, test, depth = 0) {
    if (!node || typeof node !== 'object' || depth > 10) return null;
    if (Array.isArray(node)) {
      for (const item of node) { const f = deepFind(item, test, depth + 1); if (f) return f; }
      return null;
    }
    if (test(node)) return node;
    for (const k of Object.keys(node)) {
      if (k.startsWith('@')) continue;
      const f = deepFind(node[k], test, depth + 1);
      if (f) return f;
    }
    return null;
  }

  function jsonLdBlocks() {
    const out = [];
    document.querySelectorAll('script[type="application/ld+json"]').forEach((s) => {
      try { out.push(JSON.parse(s.textContent)); } catch { /* ignore */ }
    });
    return out;
  }

  function metaContent(name) {
    return document.querySelector(`meta[property="${name}"]`)?.content
      || document.querySelector(`meta[name="${name}"]`)?.content
      || '';
  }

  /** WB 图片 URL 尺寸段归一化为全尺寸 big（c516x688/tm/hq 等 → big） */
  function toFullSize(u) {
    try {
      return String(u).replace(/\/images\/(?:[a-z0-9]+(?:x[a-z0-9]+)?)\//i, '/images/big/');
    } catch { return u; }
  }

  /** 提取源商品类目路径：JSON-LD BreadcrumbList/category → DOM 面包屑导航 → __NUXT__ 面包屑/类目名 */
  function extractBreadcrumbs() {
    let crumbs = [];
    // 1) JSON-LD BreadcrumbList
    const bc = deepFind(jsonLdBlocks(), (n) =>
      n && (n['@type'] === 'BreadcrumbList' || (Array.isArray(n['@type']) && n['@type'].includes('BreadcrumbList'))));
    const items = (bc && bc.itemListElement) || [];
    if (Array.isArray(items)) {
      crumbs = items
        .map((i) => (i.item && i.item.name) || i.name || '')
        .filter(Boolean);
    }
    // 1b) JSON-LD Product.category 字段
    if (!crumbs.length) {
      const ld = deepFind(jsonLdBlocks(), (n) =>
        n && (n['@type'] === 'Product' || (Array.isArray(n['@type']) && n['@type'].includes('Product'))));
      const cat = ld && ld.category;
      if (cat) {
        const seg = (Array.isArray(cat) ? cat : [cat]).map((c) => (typeof c === 'string' ? c : c?.name)).filter(Boolean);
        if (seg.length) crumbs = seg;
      }
    }
    // 2) DOM 面包屑导航兜底（兼容 WB 新旧页面结构；a 优先，避免 li>a>span 重复抓取）
    if (!crumbs.length) {
      const navSels = [
        'nav[aria-label*="хлеб"]', 'nav[aria-label*="crumb"]', 'nav[aria-label*="breadcrumb"]',
        'nav[itemprop="breadcrumb"]', 'nav[class*="breadcrumb"]', 'nav[class*="crumb"]',
        '.breadcrumbs', '.breadcrumbs__list', '.crumbs', '[data-e2e="breadcrumbs"]',
        'ol[itemtype*="BreadcrumbList"]', 'ol[class*="breadcrumb"]', 'ul[class*="breadcrumb"]',
        'div[class*="breadcrumb"]',
      ];
      let nav = null;
      for (const sel of navSels) { nav = document.querySelector(sel); if (nav) break; }
      if (nav) {
        let nodes = [...nav.querySelectorAll('a')];
        if (!nodes.length) nodes = [...nav.querySelectorAll('li, span, [itemprop="name"]')];
        crumbs = nodes
          .map((a) => a.textContent.replace(/\s+/g, ' ').trim())
          .filter(Boolean);
        // 保序去重（页面可能重复渲染面包屑 DOM）
        crumbs = [...new Set(crumbs)];
      }
    }
    // 3) __NUXT__ 兜底：面包屑数组或父/子类目名
    if (!crumbs.length) {
      const nuxtCats = nuxtProbe();
      if (nuxtCats.breadcrumbs && nuxtCats.breadcrumbs.length) crumbs = nuxtCats.breadcrumbs;
      if (nuxtCats.parentName) crumbs.unshift(nuxtCats.parentName);
      if (nuxtCats.subjectName) crumbs.push(nuxtCats.subjectName);
    }
    // 去掉首页/导航类目与商品名占位
    return crumbs
      .filter((n) => n && !/главная|каталог|home|catalog|main page/i.test(n))
      .map((n) => n.replace(/\s+/g, ' ').trim())
      .filter(Boolean);
  }

  /** 从包屑中提取"最具体的源类目名"（末级；若末级是商品名则取上一级） */
  function sourceCategoryOf(product) {
    const crumbs = product.crumbs || [];
    if (!crumbs.length) return null;
    const title = String(product.title || '').toLowerCase();
    let cat = crumbs[crumbs.length - 1];
    if (cat && title && (title.includes(cat.toLowerCase()) || cat.toLowerCase().startsWith(title.slice(0, 8)))) {
      cat = crumbs[crumbs.length - 2];
    }
    return (cat || crumbs[crumbs.length - 1] || '').trim() || null;
  }

  /**
   * 源类目路径 → WB 子类目 的精确规则表（基于面包屑关键词组合）。
   * 例如源路径 Main / Sports / Cycling / Accessories → 自行车装饰(subjectID=1557, 体育用品)
   * 新增规则：needs 为需要同时命中的关键词（任一 crumb 包含即命中），subjectId 为 WB 子类目ID
   */
  const CATEGORY_RULES = [
    { needs: ['sport', 'cycling', 'accessor'], subjectId: 1557, note: 'Sports/Cycling/Accessories → 自行车装饰' },
    { needs: ['sport', 'cycling'], subjectId: 2151, note: 'Sports/Cycling → 自行车' },
    { needs: ['sport', 'accessor'], subjectId: 1557, note: 'Sports/Accessories → 自行车装饰' },
  ];

  /** 用规则表匹配源类目路径，返回 subjectId 或 null */
  function matchCategoryRule(crumbs) {
    const lower = (crumbs || []).map((c) => String(c).toLowerCase());
    if (!lower.length) return null;
    for (const rule of CATEGORY_RULES) {
      if (rule.needs.every((k) => lower.some((c) => c.includes(k)))) return rule.subjectId;
    }
    return null;
  }

  /** 清洗商品标题：去掉站点后缀（如 " — купить по цене 1299 ₽"） */
  function cleanTitle(t) {
    return String(t || '')
      .replace(/\s*[—–\-–]\s*(купить по цене|купить|price|buy|заказать).*$/i, '')
      .replace(/\s+/g, ' ')
      .trim();
  }

  /** 是否为 WB 站点默认/降级标题（非真实商品标题），命中视为未提取 */
  function isFallbackTitle(t) {
    const s = String(t || '').trim();
    if (!s) return true;
    if (/Интернет[‑\-–—\s]?магазин\s+Wildberries|широкий\s+ассортимент|Онлайн[‑\-–—\s]?гипермаркет|гипермаркет\s+Wildberries/i.test(s)) return true;
    if (/^Wildberries\s*$/i.test(s)) return true;
    if (/^(главная|home|404|error)\b/i.test(s)) return true;
    return false;
  }

  /** 多选择器查找商品标题元素（兼容 WB 新旧页面结构） */
  function findTitleText() {
    const selectors = [
      'h1[itemprop="name"]',
      '[data-wba-header-name="ProductName"]',
      '[data-wba-header-name="ProductName"] h1',
      '[data-e2e="product-title"]',
      '[data-e2e="product-name"]',
      '[data-e2e="productName"]',
      '.product-page__title h1',
      '.product-page__title',
      '.product-title',
      '.product-name',
      '#productTitle',
      '[itemprop="name"]',
      '[class*="product__title"]',
      'h1',
    ];
    for (const sel of selectors) {
      const el = document.querySelector(sel);
      if (!el) continue;
      const t = String(el.textContent || '').replace(/\s+/g, ' ').trim();
      if (t && !isFallbackTitle(t)) return t;
    }
    // meta[itemprop=name] 兜底
    const meta = document.querySelector('meta[itemprop="name"], meta[property="og:title"]');
    if (meta) {
      const t = cleanTitle(String(meta.content || ''));
      if (t && !isFallbackTitle(t)) return t;
    }
    return '';
  }

  /** 从页面HTML原文做正则兜底（__NUXT__ 等内嵌数据） */
  function nuxtProbe() {
    const html = document.documentElement.outerHTML || '';
    const out = {};
    let m;
    if ((m = html.match(/"nm_name":"([^"]+)"/)) || (m = html.match(/"full_name":"([^"]+)"/))) out.title = m[1];
    if ((m = html.match(/"brand_name":"([^"]+)"/)) || (m = html.match(/"brandName":"([^"]+)"/))) out.brand = m[1];
    if ((m = html.match(/"salePrice":(\d+)/))) out.price = Number(m[1]);
    if ((m = html.match(/"salePriceU":(\d+)/))) out.price = Math.round(Number(m[1]) / 100);
    if ((m = html.match(/"description":"([^"]{20,4000})"/))) out.description = m[1];
    if ((m = html.match(/"object_name":"([^"]+)"/)) || (m = html.match(/"subject_name":"([^"]+)"/))) out.subjectName = m[1];
    if ((m = html.match(/"parent_name":"([^"]+)"/))) out.parentName = m[1];
    // 面包屑数组（如 "breadcrumbs":[{"name":"Бытовая техника","url":"/..."},...]）
    if ((m = html.match(/"breadcrumbs":\[([^\]]{10,3000})\]/))) {
      const seg = m[1];
      const names = [...seg.matchAll(/"name":"([^"]+)"/g)].map((x) => x[1]);
      if (names.length) out.breadcrumbs = names;
    }
    // dimensions：兼容不同字段顺序与单位
    const dimM = html.match(/"dimensions":\s*\{([^}]{0,300})\}/);
    if (dimM) {
      const seg = dimM[1];
      const g = (re) => { const x = seg.match(re); return x ? Number(x[1]) : undefined; };
      const d = {
        length: g(/"length"\s*:\s*([\d.]+)/),
        width: g(/"width"\s*:\s*([\d.]+)/),
        height: g(/"height"\s*:\s*([\d.]+)/),
        weightBrutto: g(/"weightBrutto"\s*:\s*([\d.]+)/) ?? g(/"weight"\s*:\s*([\d.]+)/),
      };
      if (Object.values(d).some((v) => v !== undefined)) out.dimensions = d;
    }
    if ((m = html.match(/"photos":\[([^\]]{10,4000})\]/))) {
      out.images = (m[1].match(/"https?:[^"]+"/g) || []).map((s) => s.replace(/^"|"$/g, ''));
    }
    return out;
  }

  /** 提取商品尺寸重量：__NUXT__ dimensions → JSON-LD additionalProperty → DOM 特性区块 */
  function extractDimensions(nuxt, ld) {
    const dims = {};
    if (nuxt.dimensions) {
      for (const k of ['length', 'width', 'height', 'weightBrutto']) {
        if (nuxt.dimensions[k] != null && nuxt.dimensions[k] !== 0) dims[k] = nuxt.dimensions[k];
      }
    }
    // JSON-LD additionalProperty 中的 Длина/Ширина/Высота/Вес
    const props = (ld && ld.additionalProperty) || [];
    (Array.isArray(props) ? props : []).forEach((prop) => {
      const n = String(prop.name || '').toLowerCase();
      const raw = String(prop.value ?? '').replace(/\s*[смкг]/gi, '').replace(',', '.');
      const v = Number(raw);
      if (!(v > 0)) return;
      if (/длин|length/i.test(n) && dims.length == null) dims.length = v;
      else if (/ширин|width/i.test(n) && dims.width == null) dims.width = v;
      else if (/высот|height/i.test(n) && dims.height == null) dims.height = v;
      else if (/вес|weight|масс/i.test(n) && dims.weightBrutto == null) dims.weightBrutto = v;
    });
    // DOM 特性区块兜底
    if (!Object.keys(dims).length) {
      const rows = document.querySelectorAll('[data-e2e="characteristics"] .product-params__row, .product-params__row, .item-prop, [itemprop="additionalProperty"]');
      rows.forEach((row) => {
        const nameEl = row.querySelector('.product-params__cell:first-child, .item-prop__title, [itemprop="name"]');
        const valEl = row.querySelector('.product-params__cell:last-child, .item-prop__value, [itemprop="value"]');
        if (!nameEl || !valEl) return;
        const n = nameEl.textContent.toLowerCase();
        const v = Number(String(valEl.textContent).replace(/\s*[смкг]/gi, '').replace(',', '.'));
        if (!(v > 0)) return;
        if (/длин|length/i.test(n) && dims.length == null) dims.length = v;
        else if (/ширин|width/i.test(n) && dims.width == null) dims.width = v;
        else if (/высот|height/i.test(n) && dims.height == null) dims.height = v;
        else if (/вес|weight|масс/i.test(n) && dims.weightBrutto == null) dims.weightBrutto = v;
      });
    }
    return dims;
  }

  function extractProduct() {
    const p = { title: '', brand: '', description: '', price: null, currency: '', images: [], attributes: {}, sourceSku: NM_ID, crumbs: extractBreadcrumbs(), dimensions: {} };

    // 1) JSON-LD Product
    const ld = deepFind(jsonLdBlocks(), (n) =>
      n && (n['@type'] === 'Product' || (Array.isArray(n['@type']) && n['@type'].includes('Product'))));
    if (ld) {
      p.title = ld.name || ld.headline || p.title;
      p.description = ld.description || p.description;
      p.brand = (typeof ld.brand === 'string' ? ld.brand : ld.brand?.name) || p.brand;
      const off = ld.offers;
      const offer = Array.isArray(off) ? off[0] : off;
      if (offer) {
        p.price = Number(offer.price ?? offer.lowPrice ?? offer.highPrice ?? p.price) || p.price;
        p.currency = offer.priceCurrency || p.currency;
      }
      const imgs = ld.image;
      if (imgs) p.images.push(...(Array.isArray(imgs) ? imgs : [imgs]).map((i) => (typeof i === 'string' ? i : i?.url)).filter(Boolean));
      // additionalProperty → attributes
      const props = ld.additionalProperty || [];
      (Array.isArray(props) ? props : []).forEach((prop) => {
        if (prop?.name && prop.value != null) p.attributes[prop.name] = String(prop.value);
      });
    }

    // 2) meta 补充（描述与主图；标题交由 DOM 段按 h1 > og:title 顺序处理）
    p.description = p.description || cleanTitle(metaContent('og:description') || metaContent('description'));
    const ogImg = metaContent('og:image');
    if (ogImg) p.images.push(ogImg);

    // 3) DOM 兜底（主图与缩略图）
    const domImgs = [...document.querySelectorAll('.swiper-wrapper img, .product-page__main img, [itemprop="image"]')]
      .map((img) => img.currentSrc || img.src).filter(Boolean);
    p.images.push(...domImgs);

    // 4) __NUXT__ 正则兜底
    const nuxt = nuxtProbe();
    p.title = p.title || nuxt.title || '';
    p.brand = p.brand || nuxt.brand || '';
    p.description = p.description || nuxt.description || '';
    if (p.price == null && nuxt.price != null) p.price = nuxt.price;
    if (nuxt.images?.length) p.images.push(...nuxt.images);
    // 类目兜底（__NUXT__ 父/子类目名）
    if (!p.crumbs.length) {
      if (nuxt.parentName) p.crumbs.push(nuxt.parentName);
      if (nuxt.subjectName) p.crumbs.push(nuxt.subjectName);
    }

    // 5) 尺寸重量提取（__NUXT__ → JSON-LD → DOM 特性区块）
    p.dimensions = extractDimensions(nuxt, ld);
    // 尺寸重量同时写入 attributes，便于特性自动预填
    const dimLabels = { length: '长度', width: '宽度', height: '高度', weightBrutto: '重量' };
    for (const [k, label] of Object.entries(dimLabels)) {
      if (p.dimensions[k] != null) p.attributes[label] = String(p.dimensions[k]);
    }

    // 6) DOM 兜底：标题（多选择器 > og:title，站点默认标题视为无效）、品牌、价格
    if (!p.title) p.title = findTitleText();
    if (!p.title) {
      const og = cleanTitle(metaContent('og:title') || metaContent('twitter:title') || document.title);
      if (!isFallbackTitle(og)) p.title = og;
    }
    // 兜底链结束后仍可能是站点默认标题 → 清空视为未提取（由延迟重试/用户填写处理）
    if (isFallbackTitle(p.title)) p.title = '';
    if (!p.brand) {
      const brandLink = document.querySelector('a[data-link^="/brands/"]') || document.querySelector('[data-link^="/brands/"] a');
      p.brand = brandLink?.textContent?.trim() || '';
    }
    if (!p.price) {
      const priceEl = document.querySelector('[itemprop="price"]')
        || document.querySelector('.price-block__price')
        || document.querySelector('ins.price-block__price')
        || document.querySelector('[data-e2e="product-price"]');
      if (priceEl) p.price = Number(String(priceEl.getAttribute('content') || priceEl.textContent).replace(/[^\d.]/g, '')) || null;
    }

    // 7) 描述：页面描述容器兜底（Full Details 弹窗内容由 grabFullDetails 异步补充）
    if (!p.description) {
      const descEl = document.querySelector('[data-e2e="description"], .collapsable__content, #description, .product-page__description, [itemprop="description"]');
      if (descEl) p.description = descEl.textContent.replace(/\s+/g, ' ').trim();
    }

    // 全部主图：多来源合并、尺寸段归一化为 big、去重（上限 30 张）
    p.images = [...new Set(p.images.map(toFullSize))].slice(0, 30);
    // 面包屑去重 + 去掉末级混入的品牌名（如 Yonno）
    p.crumbs = [...new Set(p.crumbs)];
    if (p.crumbs.length && p.brand) {
      const last = String(p.crumbs[p.crumbs.length - 1]).toLowerCase();
      const br = p.brand.toLowerCase();
      if (last === br) p.crumbs.pop();
    }
    return p;
  }

  /* ============ Full Details 弹窗描述抓取 ============ */

  function findFullDetailsButton() {
    const sels = ['[data-e2e="full-details"]', '[data-e2e="show-all-characteristics"]', '[data-e2e="details"]', '[data-e2e="more-info"]'];
    for (const s of sels) { const el = document.querySelector(s); if (el) return el; }
    const keywords = ['Все характеристики', 'Full details', 'Full Details', 'Подробнее', '全部详情', '所有特性'];
    const els = [...document.querySelectorAll('button, a, div[role="button"], span, [data-e2e]')];
    return els.find((el) => {
      const t = (el.textContent || '').trim();
      return t && t.length < 40 && keywords.some((k) => t === k || t.startsWith(k));
    }) || null;
  }

  function findFullDetailsModal() {
    const sels = ['[data-e2e="modal"]', 'div[role="dialog"]', '.modal', '.j-modal', '.modal__wrapper', '.modal-content'];
    let best = null;
    for (const s of sels) {
      for (const el of document.querySelectorAll(s)) {
        const len = (el.textContent || '').length;
        if (len > 200 && (!best || len > (best.textContent || '').length)) best = el;
      }
    }
    return best;
  }

  /** 点击商品页 "Full Details / 全部详情" 按钮，抓取弹窗中的完整描述（异步） */
  function grabFullDetails() {
    return new Promise((resolve) => {
      const btn = findFullDetailsButton();
      if (!btn) { resolve(null); return; }
      try { btn.click(); } catch { resolve(null); return; }
      setTimeout(() => {
        const modal = findFullDetailsModal();
        let text = '';
        if (modal) {
          text = modal.innerText || modal.textContent || '';
          const close = modal.querySelector('[data-e2e="close"], .modal__close, [aria-label*="закрыт"], .modal-close');
          if (close) { try { close.click(); } catch { /* ignore */ } }
        }
        resolve(text ? text.replace(/\s+/g, ' ').trim() : null);
      }, 700);
    });
  }

  /* ============ 弹窗UI ============ */
  let modal = null;
  let pollTimer = null;
  let state = { product: null, parents: [], subjects: [], charcs: [], config: {} };

  function el(tag, attrs = {}, children = []) {
    const node = document.createElement(tag);
    for (const [k, v] of Object.entries(attrs)) {
      if (k === 'class') node.className = v;
      else if (k === 'text') node.textContent = v;
      else if (k === 'html') node.innerHTML = v;
      else if (k.startsWith('on')) node.addEventListener(k.slice(2), v);
      else node.setAttribute(k, v);
    }
    for (const c of children) node.appendChild(c);
    return node;
  }

  function openModal() {
    if (modal) return;
    modal = el('div', { class: 'wbflow-modal-mask' });
    const box = el('div', { class: 'wbflow-modal' });
    modal.appendChild(box);
    document.body.appendChild(modal);
    modal.addEventListener('click', (e) => { if (e.target === modal) closeModal(); });
    buildModalContent(box);
  }

  function closeModal() {
    clearInterval(pollTimer);
    pollTimer = null;
    if (modal) { modal.remove(); modal = null; }
  }

  /** 切换操作账号：更新当前请求上下文并记忆到配置 */
  function onUserChange() {
    const sel = document.getElementById('wf-user');
    if (!sel) return;
    state.config.currentUser = sel.value;
    chrome.runtime.sendMessage({ type: 'setConfig', config: { currentUser: sel.value } }, () => {});
    setStatus(`已切换账号：${sel.value}，后续搬品将使用该账号`, 'ok');
  }

  function esc(s) { return String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c])); }

  /** 提取商品，标题缺失时多轮延时重试（兼容 SPA 渲染延迟 / 懒加载页面） */
  async function extractWithRetry() {
    let p = extractProduct();
    if (!p.title) {
      for (const wait of [1000, 2000]) {
        await new Promise((r) => setTimeout(r, wait));
        const retry = extractProduct();
        if (retry.title) { p = retry; break; }
      }
    }
    return p;
  }

  function buildModalContent(box) {
    box.innerHTML = '';
    box.appendChild(el('div', { class: 'wbflow-modal-head' }, [
      el('div', { class: 'wbflow-modal-title' }, [
        el('span', { class: 'wf-logo', text: 'WB' }),
        el('span', { text: '一键搬品 · nmID ' + (NM_ID || '') }),
        el('span', { class: 'wf-version', id: 'wf-version', text: 'v…' }),
      ]),
      el('select', { class: 'wbflow-input wf-user-select', id: 'wf-user', title: '切换操作账号', onchange: onUserChange }, [el('option', { value: '', text: '加载用户…' })]),
      el('button', { class: 'wbflow-close', text: '×', onclick: closeModal }),
    ]));

    const body = el('div', { class: 'wbflow-modal-body' });
    const foot = el('div', { class: 'wbflow-modal-foot' });
    box.appendChild(body);
    box.appendChild(foot);

    body.innerHTML = '<div style="color:#8a8aa3;padding:20px;text-align:center">正在提取商品数据…</div>';

    (async () => {
      try {
        // 打开弹窗时确保后端已启动（native host 自动拉起；失败不阻塞，由下方错误横幅提示）
        await new Promise((resolve) => {
          try { chrome.runtime.sendMessage({ type: 'ensureBackend' }, () => resolve()); }
          catch { resolve(); }
        });
        const cfg = await getConfig();
        state.config = cfg;
        const base = cfg.backendUrl || 'http://localhost:3000';
        // 版本号展示：后端 /api/version 为准，兜底扩展 manifest 版本
        try {
          const v = await api(base, '/api/version');
          const verEl = document.getElementById('wf-version');
          if (verEl && v && v.version) verEl.textContent = 'v' + v.version;
        } catch {
          const verEl = document.getElementById('wf-version');
          if (verEl) { try { verEl.textContent = 'v' + (chrome.runtime.getManifest().version || ''); } catch { verEl.textContent = ''; } }
        }
        // 加载团队用户列表并选中当前账号
        try {
          const { users, current } = await api(base, '/api/users');
          const sel = document.getElementById('wf-user');
          sel.innerHTML = (users || []).map((u) => `<option value="${esc(u.name)}">${esc(u.name)}</option>`).join('');
          const saved = cfg.currentUser || '';
          sel.value = (users || []).some((u) => u.name === saved) ? saved : (current || (users && users[0] && users[0].name) || '');
          if (sel.value) state.config.currentUser = sel.value;
        } catch { /* 用户列表加载失败不影响主流程 */ }
        state.product = await extractWithRetry(); // 含多轮延时重试（SPA 渲染延迟/懒加载兜底）
        // 预填价格策略
        applyPriceStrategy(state.product);

        // 异步抓取商品页 "Full Details" 弹窗完整描述，成功后更新描述输入框
        grabFullDetails().then((fullText) => {
          if (fullText && (!state.product.description || fullText.length > state.product.description.length)) {
            state.product.description = fullText;
            const desc = document.getElementById('wf-desc');
            if (desc) desc.value = fullText;
            updateDescCount();
          }
        });

        const [parentsRes, warehousesRes] = await Promise.all([
          api(base, '/api/categories/parents').catch((e) => ({ data: [], error: e.message })),
          api(base, '/api/warehouses').catch((e) => ({ data: [], error: e.message })),
        ]);
        state.parents = parentsRes.data || [];
        const loadErrors = [parentsRes.error, warehousesRes.error].filter(Boolean);
        renderForm(body, foot, warehousesRes.data || [], cfg, loadErrors);
      } catch (e) {
        body.innerHTML = `<div class="wbflow-error">无法连接 WBFlow 后端：${esc(e.message)}<br/>请确认已在本地运行 <b>npm start</b>（默认 http://localhost:3000），并在扩展设置中确认后端地址。</div>`;
      }
    })();
  }

  function applyPriceStrategy(product) {
    const mode = state.config.priceMode || 'manual';
    if (mode === 'source') { /* 保留源价格 */ }
    else if (mode === 'multiplier' && product.price != null) {
      product.price = Math.round(product.price * (Number(state.config.priceMultiplier) || 1.5));
    }
    // manual 模式也预填源价格，便于用户修改
  }

  function renderForm(body, foot, warehouses, cfg, loadErrors = []) {
    const p = state.product;
    const base = cfg.backendUrl || 'http://localhost:3000';

    body.innerHTML = '';

    // 加载失败提示（后端未启动 / 接口异常时明确告知，避免"无法选择"但无提示）
    if (loadErrors.length) {
      body.appendChild(el('div', { class: 'wbflow-error', html:
        `后端数据加载失败：${esc(loadErrors.join('；'))}<br/>` +
        `请确认已在本地运行 <b>npm start</b>（后端地址：${esc(base)}），然后关闭本窗口重新打开。</b>` }));
    }

    /* --- 商品信息 --- */
    const crumbsHtml = p.crumbs && p.crumbs.length
      ? `<div style="font-size:12px;color:#8a8aa3;grid-column:span 2">源商品类目：${esc(p.crumbs.join(' / '))}</div>`
      : '';
    body.appendChild(el('div', { class: 'wbflow-section-title', text: '商品信息（已自动提取，可修改）' }));
    body.appendChild(el('div', { class: 'wbflow-grid2', html: crumbsHtml }));
    body.appendChild(el('div', { class: 'wbflow-grid2' }, [
      el('label', { class: 'wbflow-label' }, [el('span', { text: '标题 *' }), el('input', { class: 'wbflow-input', id: 'wf-title', value: p.title, maxlength: '60', placeholder: '请填写商品标题（自动提取失败时）' })]),
      el('label', { class: 'wbflow-label' }, [el('span', { text: '品牌（可选）' }), el('input', { class: 'wbflow-input', id: 'wf-brand', value: cfg.defaultBrand || p.brand })]),
      el('label', { class: 'wbflow-label' }, [
        el('div', { class: 'wbflow-row' }, [
          el('span', { text: '描述（Full Details 自动抓取）' }),
          el('span', { class: 'wf-desc-count', id: 'wf-desc-count', text: `${(p.description || '').length}/2000` }),
        ]),
        el('textarea', { class: 'wbflow-input', id: 'wf-desc', rows: '2', oninput: updateDescCount }, [document.createTextNode(p.description || '')]),
      ]),
      el('label', { class: 'wbflow-label' }, [el('span', { text: `主图（${p.images.length}张，可编辑链接）` }), el('textarea', { class: 'wbflow-input', id: 'wf-images', rows: '3' }, [document.createTextNode(p.images.join('\n'))])]),
    ]));

    /* --- 类目 --- */
    // 源类目自动匹配提示
    const srcCat = sourceCategoryOf(p);
    const catMap = cfg.categoryMap || {};
    const matched = srcCat && catMap[srcCat];
    const catHint = matched
      ? `已按源类目「${esc(srcCat)}」自动匹配（可修改）`
      : srcCat
        ? `源商品类目：${esc(srcCat)}；首次搬品请选择WB类目（会自动记住）`
        : '上次使用的类目会自动选中';
    body.appendChild(el('div', { class: 'wbflow-section-title', text: 'WB 目标类目 · ' + catHint }));
    body.appendChild(el('div', { class: 'wbflow-grid3' }, [
      el('label', { class: 'wbflow-label' }, [
        el('span', { text: '父级类目' }),
        el('select', { class: 'wbflow-input', id: 'wf-parent', onchange: onParentChange },
          [el('option', { value: '', text: '选择父级类目' })].concat(state.parents.map((x) => el('option', { value: x.id, text: x.name })))),
      ]),
      el('label', { class: 'wbflow-label' }, [
        el('span', { text: '子类目 *' }),
        el('select', { class: 'wbflow-input', id: 'wf-subject', disabled: 'disabled', onchange: onSubjectChange }, [el('option', { value: '', text: '请先选择父级类目' })]),
      ]),
      el('label', { class: 'wbflow-label' }, [
        el('span', { text: '商家SKU' }),
        el('input', { class: 'wbflow-input', id: 'wf-vendor', placeholder: '留空自动生成' }),
      ]),
    ]));

    /* --- 特性 --- */
    body.appendChild(el('div', { class: 'wbflow-section-title', text: '商品特性（选择子类目后加载；重量/尺寸类自动映射）' }));
    body.appendChild(el('div', { class: 'wbflow-chars', id: 'wf-chars' }, [el('div', { text: '请先选择子类目', style: 'grid-column:span 2;color:#8a8aa3' })]));

    /* --- 尺寸与重量 --- */
    const dims = p.dimensions || {};
    body.appendChild(el('div', { class: 'wbflow-section-title', text: `尺寸与重量（已自动提取${Object.keys(dims).length ? '' : '，未获取到可手填'}）` }));
    body.appendChild(el('div', { class: 'wbflow-grid4' }, [
      el('label', { class: 'wbflow-label' }, [el('span', { text: '长（cm）' }), el('input', { class: 'wbflow-input', id: 'wf-dim-length', type: 'number', min: '0', step: '0.1', value: dims.length ?? '' })]),
      el('label', { class: 'wbflow-label' }, [el('span', { text: '宽（cm）' }), el('input', { class: 'wbflow-input', id: 'wf-dim-width', type: 'number', min: '0', step: '0.1', value: dims.width ?? '' })]),
      el('label', { class: 'wbflow-label' }, [el('span', { text: '高（cm）' }), el('input', { class: 'wbflow-input', id: 'wf-dim-height', type: 'number', min: '0', step: '0.1', value: dims.height ?? '' })]),
      el('label', { class: 'wbflow-label' }, [el('span', { text: '重量（kg）' }), el('input', { class: 'wbflow-input', id: 'wf-dim-weight', type: 'number', min: '0', step: '0.01', value: dims.weightBrutto ?? '' })]),
    ]));

    /* --- 定价库存 --- */
    body.appendChild(el('div', { class: 'wbflow-section-title', text: '定价与库存' }));
    body.appendChild(el('div', { class: 'wbflow-grid4' }, [
      el('label', { class: 'wbflow-label' }, [
        el('span', { html: `<span class="req-flag">售价（元）*</span>${p.price != null ? ` <span class="wf-hint">已带出源价 ${p.price}${p.currency || ''}</span>` : ''}` }),
        el('input', { class: 'wbflow-input wf-price-input', id: 'wf-price', type: 'number', min: '0', value: p.price ?? '', placeholder: '必填，如 199' }),
      ]),
      el('label', { class: 'wbflow-label' }, [el('span', { text: '折扣（%）' }), el('input', { class: 'wbflow-input', id: 'wf-discount', type: 'number', min: '0', max: '99', value: '0' })]),
      el('label', { class: 'wbflow-label' }, [
        el('span', { text: '仓库（默认我的仓库）' }),
        el('select', { class: 'wbflow-input', id: 'wf-warehouse' },
          [el('option', { value: '', text: '选择仓库' })].concat(warehouses.map((w) => el('option', { value: w.id, text: w.name })))),
      ]),
      el('label', { class: 'wbflow-label' }, [el('span', { text: '库存数量' }), el('input', { class: 'wbflow-input', id: 'wf-stock', type: 'number', min: '0', value: cfg.stock ?? 10 })]),
    ]));

    /* --- 步骤区 --- */
    body.appendChild(el('div', { class: 'wbflow-steps', id: 'wf-steps' }));

    /* --- 底部 --- */
    const status = el('div', { class: 'wbflow-status', id: 'wf-status', text: '' });
    const btn = el('button', { class: 'wbflow-btn primary big', id: 'wf-go', text: '一键搬品', onclick: runMigrate });
    foot.appendChild(status);
    foot.appendChild(el('button', { class: 'wbflow-btn', text: '取消', onclick: closeModal }));
    foot.appendChild(btn);

    // 仓库默认：配置的 warehouseId > 名为"我的仓库" > 第一个仓库
    let pickedWarehouse = warehouses.find((w) => String(w.id) === String(cfg.warehouseId || ''));
    if (!pickedWarehouse) pickedWarehouse = warehouses.find((w) => /我的仓库|мой склад|main warehouse/i.test(w.name));
    if (!pickedWarehouse) pickedWarehouse = warehouses[0] || null;
    if (pickedWarehouse) document.getElementById('wf-warehouse').value = String(pickedWarehouse.id);

    // 类目自动选中（与搬品保持一致）：
    // 1) 源类目学习映射 categoryMap[源类目名] 优先
    // 2) 源类目路径规则表 CATEGORY_RULES（如 Sports/Cycling/Accessories → 自行车装饰）
    // 3) 记忆的 lastSubjectId 兜底
    // 4) 配置的 defaultSubjectId 最后兜底
    const autoSubjectId = (srcCat && catMap[srcCat] && catMap[srcCat].subjectId)
      || matchCategoryRule(p.crumbs)
      || cfg.lastSubjectId || cfg.defaultSubjectId;
    if (autoSubjectId) autoSelectSubject(autoSubjectId);
    else if (p.crumbs && p.crumbs.length) {
      // 规则表未命中时提示用户参考源类目手动选择
      setStatus(`源类目：${esc(p.crumbs.join(' / '))}，请选择对应 WB 类目（会自动记住）`);
    }
  }

  function setStatus(text, cls = '') {
    const s = document.getElementById('wf-status');
    if (s) { s.textContent = text; s.className = 'wbflow-status ' + cls; }
  }

  /** 描述字符计数（类目限制标准 2000，超限提示；后端会按类目实际限制自动截断） */
  function updateDescCount() {
    const ta = document.getElementById('wf-desc');
    const cnt = document.getElementById('wf-desc-count');
    if (!ta || !cnt) return;
    const len = (ta.value || '').length;
    cnt.textContent = `${len}/2000`;
    cnt.classList.toggle('over', len > 2000);
  }

  async function onParentChange() {
    const base = state.config.backendUrl || 'http://localhost:3000';
    const pid = document.getElementById('wf-parent').value;
    const sel = document.getElementById('wf-subject');
    const chars = document.getElementById('wf-chars');
    sel.disabled = !pid;
    sel.innerHTML = '<option value="">加载子类目…</option>';
    chars.innerHTML = '<div style="grid-column:span 2;color:#8a8aa3">请选择子类目</div>';
    if (!pid) return;
    try {
      const { data } = await api(base, `/api/categories?parentID=${pid}`);
      state.subjects = data || [];
      sel.innerHTML = '<option value="">共 ' + state.subjects.length + ' 个子类目</option>' +
        state.subjects.map((s) => `<option value="${s.subjectID}">${esc(s.subjectName)}</option>`).join('');
    } catch (e) {
      sel.innerHTML = '<option value="">加载失败</option>';
      setStatus('类目加载失败：' + e.message, 'err');
    }
  }

  async function onSubjectChange() {
    const base = state.config.backendUrl || 'http://localhost:3000';
    const sid = document.getElementById('wf-subject').value;
    const chars = document.getElementById('wf-chars');
    chars.innerHTML = '<div style="grid-column:span 2;color:#8a8aa3">加载特性…</div>';
    if (!sid) { state.charcs = []; return; }
    try {
      const { data } = await api(base, `/api/categories/${sid}/characteristics`);
      state.charcs = data || [];
      renderChars(chars);
      // 记忆：1) 本次类目选择（下次兜底）；2) 源类目 → WB类目 学习映射（与搬品保持一致）
      const pid = document.getElementById('wf-parent').value;
      const srcCat = sourceCategoryOf(state.product);
      const extra = { lastParentId: pid, lastSubjectId: sid };
      if (srcCat) extra.categoryMap = { [srcCat]: { parentId: pid, subjectId: sid } };
      chrome.runtime.sendMessage({ type: 'setConfig', config: extra }, () => {});
    } catch (e) {
      chars.innerHTML = `<div style="grid-column:span 2;color:#d41f1c">特性加载失败：${esc(e.message)}</div>`;
    }
  }

  const CHAR_ALIASES = {
    color: ['颜色', 'color', 'цвет'],
    material: ['材质', '材料', 'material'],
    gender: ['性别', 'gender', 'пол'],
    country: ['产地', '国家', 'country', 'страна'],
    season: ['季节', 'season', 'сезон'],
    size: ['尺码', 'размер', 'size'],
  };

  function renderChars(container) {
    const p = state.product;
    const attrs = {};
    for (const [k, v] of Object.entries(p.attributes || {})) attrs[k.toLowerCase()] = String(v);

    if (!state.charcs.length) {
      container.innerHTML = '<div style="grid-column:span 2;color:#8a8aa3">该类目无特性</div>';
      return;
    }

    const items = state.charcs.map((c) => {
      const isWeight = /重量|weight/i.test(c.name);
      const isDim = isWeight || (/^(长度|长|宽度|宽|高度|高|length|width|height)/i.test(c.name) && /cm|厘米|сантиметр/i.test(c.name));
      const name = c.name.toLowerCase();
      let prefill = '';
      if (!isDim) {
        for (const [, names] of Object.entries(CHAR_ALIASES)) {
          if (names.some((n) => name.includes(n.toLowerCase()))) {
            const foundKey = names.find((n) => attrs[n.toLowerCase()] !== undefined);
            if (foundKey !== undefined) { prefill = String(attrs[foundKey.toLowerCase()]); break; }
          }
        }
      }
      const item = el('div', { class: 'wbflow-char', 'data-charcid': c.charcID });
      item.appendChild(el('div', { class: 'wf-cname', html: `${esc(c.name)}${c.required ? '<span class="req">*</span>' : ''}${c.isVariable ? '<span class="var">变体</span>' : ''}<span class="wf-unit">${esc(c.unitName || '')}</span>` }));
      if (isWeight) {
        item.appendChild(el('div', { style: 'font-size:11px;color:#8a8aa3', text: '重量特性将自动写入包装重量(kg)' }));
      } else {
        const inp = el('input', {
          class: 'wbflow-input', 'data-charcid': c.charcID, 'data-type': c.charcType,
          type: c.charcType === 4 ? 'number' : 'text',
          placeholder: c.charcType === 4 ? '数字' : c.maxCount > 1 ? '多个值用逗号分隔' : '',
          value: prefill,
        });
        item.appendChild(inp);
      }
      return item;
    });
    container.innerHTML = '';
    items.forEach((i) => container.appendChild(i));
  }

  function collectChars() {
    const out = [];
    document.querySelectorAll('.wbflow-char[data-charcid]').forEach((item) => {
      const inp = item.querySelector('input[data-charcid]');
      if (!inp) return; // 重量特性无输入框
      const v = inp.value.trim();
      if (!v) return;
      const isNum = inp.dataset.type === '4';
      out.push({ charcId: Number(inp.dataset.charcid), values: isNum ? Number(v) : v.split(/[,，]/).map((s) => s.trim()).filter(Boolean) });
    });
    return out;
  }

  function renderSteps(steps) {
    const box = document.getElementById('wf-steps');
    if (!box) return;
    const order = ['准备商品数据', '下载图片', '创建商品卡片', '上传图片', '设置价格', '设置库存'];
    const sorted = [...(steps || [])].sort((a, b) => order.indexOf(a.name) - order.indexOf(b.name));
    box.innerHTML = sorted.map((s) => `
      <div class="wbflow-step">
        <span class="wf-dot ${s.status === 'success' ? 'done' : s.status === 'failed' ? 'err' : s.status === 'skipped' ? 'skip' : 'run'}">${ICONS[s.status] || ''}</span>
        <span class="wf-sname">${esc(s.name)}</span>
        <span class="wf-smsg">${esc(s.message || '')}</span>
      </div>`).join('');
  }

  async function runMigrate() {
    const base = state.config.backendUrl || 'http://localhost:3000';
    const btn = document.getElementById('wf-go');
    btn.disabled = true;
    setStatus('正在提交…');

    const product = {
      title: document.getElementById('wf-title').value.trim(),
      brand: document.getElementById('wf-brand').value.trim(),
      description: document.getElementById('wf-desc').value.trim(),
      price: document.getElementById('wf-price').value ? Number(document.getElementById('wf-price').value) : null,
      images: document.getElementById('wf-images').value.split(/\r?\n/).map((s) => s.trim()).filter(Boolean),
      sourceSku: NM_ID,
    };
    const subjectID = Number(document.getElementById('wf-subject').value);
    const price = document.getElementById('wf-price').value ? Number(document.getElementById('wf-price').value) : product.price;
    const warehouseId = document.getElementById('wf-warehouse').value ? Number(document.getElementById('wf-warehouse').value) : undefined;
    const stock = document.getElementById('wf-stock').value !== '' ? Number(document.getElementById('wf-stock').value) : undefined;

    const missing = [];
    if (!product.title) missing.push('标题');
    if (!subjectID) missing.push('子类目');
    // 售价必填（明显提示）
    if (price == null || !(price > 0)) {
      const priceInput = document.getElementById('wf-price');
      if (priceInput) priceInput.classList.add('error');
      setStatus('售价为必填项，请填写售价（元）', 'err');
      btn.disabled = false;
      return;
    }
    if (missing.length) { setStatus('请填写：' + missing.join('、'), 'err'); btn.disabled = false; return; }

    // 记忆本次搬品使用的账号：下次搬品默认使用同一用户
    if (state.config.currentUser) {
      chrome.runtime.sendMessage({ type: 'setConfig', config: { currentUser: state.config.currentUser } }, () => {});
    }

    // 尺寸与重量（自动提取，可修改；全空则不传）
    const dimensions = {};
    const dimFields = { length: 'wf-dim-length', width: 'wf-dim-width', height: 'wf-dim-height', weightBrutto: 'wf-dim-weight' };
    for (const [k, id] of Object.entries(dimFields)) {
      const elm = document.getElementById(id);
      if (elm && elm.value !== '') dimensions[k] = Number(elm.value);
    }

    const body = {
      mode: 'manual',
      product,
      subjectID,
      card: {
        brand: product.brand,
        title: product.title,
        description: product.description,
        ...(Object.keys(dimensions).length ? { dimensions } : {}),
      },
      characteristics: collectChars(),
      price,
      discount: Number(document.getElementById('wf-discount').value || 0),
      sizes: [],
      warehouseId,
      stock,
      useSourceImages: true,
    };

    try {
      const { taskId } = await api(base, '/api/migrate', { method: 'POST', body: JSON.stringify(body) });
      setStatus('任务已提交，执行中…', 'ok');
      pollTask(base, taskId);
    } catch (e) {
      setStatus('提交失败：' + e.message, 'err');
      btn.disabled = false;
    }
  }

  function pollTask(base, taskId) {
    clearInterval(pollTimer);
    pollTimer = setInterval(async () => {
      try {
        const { task } = await api(base, `/api/tasks/${taskId}`);
        renderSteps(task.steps);
        const result = document.getElementById('wf-steps');
        if (task.status !== 'running') {
          clearInterval(pollTimer);
          pollTimer = null;
          const btn = document.getElementById('wf-go');
          if (btn) btn.disabled = false;
          if (task.status === 'success' && task.result?.nmID) {
            const link = document.createElement('div');
            link.className = 'wbflow-result';
            link.innerHTML = `搬品成功！<br/>nmID：<b>${task.result.nmID}</b> · SKU：<b>${esc(task.result.vendorCode)}</b><br/><a href="${esc(task.result.cardUrl)}" target="_blank" rel="noopener">打开卖家后台查看</a>`;
            result.after(link);
            setStatus('搬品成功！', 'ok');
          } else if (task.status === 'failed') {
            const err = document.createElement('div');
            err.className = 'wbflow-error';
            err.textContent = '搬品失败：' + (task.error || '未知错误');
            result.after(err);
            setStatus('搬品失败', 'err');
          }
        }
      } catch { /* 网络抖动忽略 */ }
    }, 2000);
  }

  async function autoSelectSubject(subjectId) {
    const base = state.config.backendUrl || 'http://localhost:3000';
    try {
      const { data } = await api(base, '/api/categories?limit=500');
      const sub = (data || []).find((s) => String(s.subjectID) === String(subjectId));
      if (!sub) return;
      const parentSel = document.getElementById('wf-parent');
      parentSel.value = sub.parentID;
      await onParentChange();
      const subjectSel = document.getElementById('wf-subject');
      subjectSel.value = subjectId;
      await onSubjectChange();
    } catch { /* ignore */ }
  }

  /* ============ 悬浮按钮 ============ */
  function injectFab() {
    const fab = el('button', { class: 'wbflow-fab', text: '一键搬品', onclick: openModal });
    document.body.appendChild(fab);
  }

  injectFab();
})();
