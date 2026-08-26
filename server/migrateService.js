/**
 * 一键搬品编排服务：把源商品搬到 WB 平台。
 *
 * 流程：
 *  1. 准备商品数据（URL 解析 / 手动输入）
 *  2. 下载源商品图片（并发限制）
 *  3. 创建商品卡片 POST /content/v2/cards/upload
 *  4. 按 vendorCode 查询 nmID
 *  5. 上传图片到卡片 POST /content/v3/media/file（X-Nm-Id / X-Photo-Number）
 *  6. 设置价格 POST /api/v2/upload/task（异步，轮询结果）
 *  7. 设置库存 PUT /api/v3/stocks/{warehouseId}
 */
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { config, ensureDirs } from './config.js';
import { fetchSourceProduct, normalizeManualProduct } from './sourceFetcher.js';
import {
  uploadCards, getCardsList, uploadMediaFile, getCardErrors, getCharacteristics,
} from './contentApi.js';
import { setPrices, getPriceTaskState, updateStocks, getWarehouses, getGoodsByNm } from './marketplaceApi.js';
import { WbApiError } from './wbClient.js';

const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0 Safari/537.36';
const IMAGE_CONCURRENCY = 3;
const MAX_IMAGES = 30; // 搬所有主图（WB 商品主图一般不超过 30 张）
const MAX_IMAGE_BYTES = 8 * 1024 * 1024;

/* ---------------- 任务存储 ---------------- */

function tasksFile() {
  return path.join(config.dataDir, 'tasks.json');
}

export function loadTasks() {
  ensureDirs();
  try {
    return JSON.parse(fs.readFileSync(tasksFile(), 'utf8'));
  } catch {
    return [];
  }
}

function saveTasks(tasks) {
  ensureDirs();
  fs.writeFileSync(tasksFile(), JSON.stringify(tasks, null, 2), 'utf8');
}

function getTask(id) {
  return loadTasks().find((t) => t.id === id) || null;
}

function upsertTask(task) {
  const tasks = loadTasks();
  const idx = tasks.findIndex((t) => t.id === task.id);
  if (idx >= 0) tasks[idx] = task; else tasks.unshift(task);
  saveTasks(tasks.slice(0, 200)); // 只保留最近 200 条
}

/* ---------------- 工具 ---------------- */

function newStep(name) {
  return { name, status: 'pending', message: '', startedAt: null, finishedAt: null };
}

function startStep(task, name) {
  const step = task.steps.find((s) => s.name === name);
  step.status = 'running';
  step.startedAt = new Date().toISOString();
  persist(task);
  return step;
}

function endStep(task, name, status, message = '') {
  const step = task.steps.find((s) => s.name === name);
  step.status = status;
  step.message = message;
  step.finishedAt = new Date().toISOString();
  persist(task);
}

function persist(task) {
  task.updatedAt = new Date().toISOString();
  upsertTask(task);
}

function failTask(task, error) {
  task.status = 'failed';
  task.error = error instanceof Error ? error.message : String(error);
  task.updatedAt = new Date().toISOString();
  for (const s of task.steps) if (s.status === 'running') { s.status = 'failed'; s.finishedAt = new Date().toISOString(); }
  upsertTask(task);
}

function genVendorCode(seed) {
  const base = seed ? String(seed).replace(/[^\w-]/g, '').slice(0, 30) : 'wb';
  const rnd = Date.now().toString(36) + crypto.randomBytes(3).toString('hex');
  return `${base}-${rnd}`.slice(0, 72);
}

/** 下载图片到本地（带并发限制） */
async function downloadImages(urls, task, stepName) {
  const results = [];
  let failed = 0;
  let i = 0;
  const worker = async () => {
    while (i < urls.length) {
      const idx = i++;
      const u = urls[idx];
      try {
        const res = await fetch(u, { headers: { 'User-Agent': UA, 'Referer': new URL(u).origin }, redirect: 'follow' });
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const ct = res.headers.get('content-type') || '';
        const len = Number(res.headers.get('content-length') || 0);
        if (!ct.startsWith('image/')) throw new Error(`非图片类型: ${ct || 'unknown'}`);
        if (len > MAX_IMAGE_BYTES) throw new Error(`图片过大: ${(len / 1024 / 1024).toFixed(1)}MB`);
        const buf = Buffer.from(await res.arrayBuffer());
        if (buf.length === 0) throw new Error('空文件');
        const ext = (ct.split('/')[1] || 'jpg').replace('jpeg', 'jpg').split(';')[0];
        const filename = `${task.id}-${String(idx).padStart(2, '0')}.${ext}`;
        fs.writeFileSync(path.join(config.uploadDir, filename), buf);
        results.push({ url: u, file: filename, bytes: buf.length, mime: ct });
      } catch (e) {
        failed++;
        results.push({ url: u, error: e.message });
      }
    }
  };
  await Promise.all(Array.from({ length: Math.min(IMAGE_CONCURRENCY, urls.length) }, worker));
  const ok = results.filter((r) => r.file);
  const step = task.steps.find((s) => s.name === stepName);
  step.message = `成功 ${ok.length}/${urls.length}${failed ? `，失败 ${failed}` : ''}`;
  persist(task);
  return results;
}

/** 构造上传卡片的载荷 */
function buildCardPayload({ subjectID, card, characteristics, sizes }) {
  const variant = {
    vendorCode: card.vendorCode,
    brand: card.brand,
    title: String(card.title || '').slice(0, 60),
    description: String(card.description || '').slice(0, 5000),
    kizMarked: false,
    characteristics: [],
  };

  // 重量/尺寸类特性必须通过 dimensions 传递（单位 kg/cm），不能放在 characteristics 里
  const autoDims = {};
  const seenDims = {};
  for (const c of characteristics || []) {
    if (!c.charcId || c.values === undefined || c.values === null || (Array.isArray(c.values) && c.values.length === 0)) continue;
    const name = String(c.name || '').toLowerCase();
    const firstVal = Array.isArray(c.values) ? c.values[0] : c.values;
    const numVal = Number(firstVal);
    let mappedKey = null;
    if (/重量|weight/.test(name)) {
      mappedKey = 'weightBrutto';
      // 按特性名称中的单位换算：克(g)/г → kg；千克(kg)/кг → 原样
      if (/千克|kg|кг/.test(name)) autoDims[mappedKey] = numVal;
      else autoDims[mappedKey] = numVal / 1000; // 默认按克(g)处理
    } else if (/^(长度|长|length)/.test(name) && /cm|厘米|сантиметр/.test(name)) {
      mappedKey = 'length'; autoDims[mappedKey] = numVal;
    } else if (/^(宽度|宽|width)/.test(name) && /cm|厘米|сантиметр/.test(name)) {
      mappedKey = 'width'; autoDims[mappedKey] = numVal;
    } else if (/^(高度|高|height)/.test(name) && /cm|厘米|сантиметр/.test(name)) {
      mappedKey = 'height'; autoDims[mappedKey] = numVal;
    }
    if (mappedKey) {
      seenDims[mappedKey] = true;
      continue; // 不进入 characteristics
    }
    const ch = { id: Number(c.charcId) };
    if (Array.isArray(c.values)) ch.value = c.values.map(String);
    else ch.value = Number(c.values);
    variant.characteristics.push(ch);
  }

  // 尺寸信息：仅当用户提供了尺寸时才传。无尺寸类目（如数据线）传了会报错。
  if (sizes && sizes.length) {
    variant.sizes = sizes.map((s) => ({
      techSize: String(s.techSize || 'A'),
      wbSize: String(s.wbSize || '1'),
      price: Number(s.price || 0),
      skus: Array.isArray(s.skus) ? s.skus : [],
    }));
  }
  // 包装尺寸：用户显式提供 > 特性自动识别（用户提供优先）
  const dims = { ...autoDims };
  if (card.dimensions) {
    if (card.dimensions.length != null && card.dimensions.length !== '') dims.length = Number(card.dimensions.length);
    if (card.dimensions.width != null && card.dimensions.width !== '') dims.width = Number(card.dimensions.width);
    if (card.dimensions.height != null && card.dimensions.height !== '') dims.height = Number(card.dimensions.height);
    if (card.dimensions.weightBrutto != null && card.dimensions.weightBrutto !== '') dims.weightBrutto = Number(card.dimensions.weightBrutto);
  }
  if (Object.keys(dims).length) {
    variant.dimensions = {
      length: dims.length || 0,
      width: dims.width || 0,
      height: dims.height || 0,
      weightBrutto: dims.weightBrutto || 0,
    };
  }
  const payload = {
    subjectID: Number(subjectID),
    variants: [variant],
  };
  return payload;
}

/** 常见俄语错误 → 中文提示 */
const ERROR_TRANSLATIONS = [
  [/безразмерного товара|без размеров/i, '该商品类目为无尺寸商品，不能填写尺码（尺寸字段已自动省略）'],
  [/vendorCode/i, '商家SKU（vendorCode）问题'],
  [/характеристик/i, '缺少必填特性'],
  [/бренд|brand/i, '品牌问题（可能未在账号中注册该品牌）'],
  [/фото|photo|изображени/i, '图片问题'],
  [/превышен|limit|лимит/i, '超出数量限制'],
  [/категори/i, '类目问题'],
];

export function translateError(msg) {
  if (!msg) return msg;
  for (const [re, zh] of ERROR_TRANSLATIONS) {
    if (re.test(msg)) return zh;
  }
  return null;
}

/** 等待价格任务处理完成（status 数字编码：3=成功 4=取消 5=部分错误 6=全部错误） */
async function waitForPriceTask(uploadID, task, timeoutMs = 60000) {
  const deadline = Date.now() + timeoutMs;
  let lastItem = null;
  while (Date.now() < deadline) {
    const state = await getPriceTaskState({ uploadID });
    // 注意：data 是对象（SellerTaskMetadata），不是数组
    const meta = state?.data && typeof state.data === 'object' && !Array.isArray(state.data) ? state.data : null;
    const item = meta && String(meta.uploadID) === String(uploadID) ? meta : null;
    if (item) {
      lastItem = item;
      const st = Number(item.status);
      if (st === 3 || st === 4 || st === 5 || st === 6) return item;
    }
    await new Promise((r) => setTimeout(r, 2000));
  }
  return lastItem;
}

/** 等待新卡片同步到价格服务（新卡有数分钟延迟），超时返回 false */
async function waitForCardInPriceService(nmId, timeoutMs = 300000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    try {
      const res = await getGoodsByNm([nmId]);
      const goods = res?.data?.listGoods || [];
      if (goods.some((g) => Number(g.nmID) === Number(nmId))) return true;
    } catch { /* retry */ }
    await new Promise((r) => setTimeout(r, 10000));
  }
  return false;
}

/* ---------------- 主流程 ---------------- */

/**
 * 一键搬品
 * @param {object} input
 *   {
 *     mode: 'url' | 'manual',
 *     url?: string,
 *     product?: object,          // manual 模式
 *     subjectID: number,
 *     characteristics: [{charcId, values}],
 *     card: { vendorCode?, brand, title, description, dimensions? },
 *     price: number, discount?: number,
 *     sizes: [{techSize, wbSize, price, skus}],
 *     warehouseId?: number,
 *     stock?: number,
 *     useSourceImages?: boolean  // 默认 true
 *   }
 */
export async function runMigration(input) {
  ensureDirs();
  const task = {
    id: crypto.randomUUID(),
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    status: 'running',
    steps: [
      newStep('准备商品数据'),
      newStep('下载图片'),
      newStep('创建商品卡片'),
      newStep('上传图片'),
      newStep('设置价格'),
      newStep('设置库存'),
    ],
    source: null,
    result: null,
    error: null,
  };
  upsertTask(task);

  try {
    /* 1. 准备商品数据 */
    startStep(task, '准备商品数据');
    let product;
    if (input.mode === 'manual') {
      product = normalizeManualProduct(input.product || {});
    } else {
      if (!input.url) throw new Error('缺少源商品URL');
      product = await fetchSourceProduct({ url: input.url });
      if (!product.title) throw new Error('未能从源页面解析出商品信息（页面可能被反爬拦截），请改用手动输入模式');
    }
    task.source = {
      url: product.url,
      title: product.title,
      brand: product.brand,
      price: product.price,
      images: product.images.slice(0, MAX_IMAGES),
      sizes: product.sizes,
      attributes: product.attributes,
    };
    endStep(task, '准备商品数据', 'success', `解析到商品「${product.title?.slice(0, 30) || '未知'}」，图片 ${product.images.length} 张`);

    /* 2. 下载图片 */
    startStep(task, '下载图片');
    let images = [];
    if (input.useSourceImages !== false && product.images.length > 0) {
      const urls = product.images.slice(0, MAX_IMAGES);
      images = (await downloadImages(urls, task, '下载图片')).filter((r) => r.file);
      if (images.length === 0) {
        endStep(task, '下载图片', 'failed', '所有图片下载失败');
        throw new Error('源商品图片下载失败，请检查图片链接是否可访问（部分站点防盗链）');
      }
      endStep(task, '下载图片', 'success', `已下载 ${images.length} 张图片`);
    } else {
      endStep(task, '下载图片', 'skipped', '未使用源图片');
    }

    /* 3. 创建商品卡片 */
    startStep(task, '创建商品卡片');
    const card = {
      vendorCode: input.card?.vendorCode || genVendorCode(product.sourceSku),
      brand: (input.card?.brand || product.brand || '').slice(0, 100),
      title: input.card?.title || product.title,
      description: input.card?.description || product.description || '',
      dimensions: input.card?.dimensions,
    };
    if (!card.brand) throw new Error('缺少品牌（brand），请补充');
    // 仅当用户明确提供尺寸时才传 sizes（无尺寸类目不能传）
    const sizes = input.sizes && input.sizes.length ? input.sizes : [];

    // 补全特性名称/类型元数据（用于识别重量/尺寸类特性 → 映射到 dimensions）
    let charcMeta = [];
    try {
      charcMeta = await getCharacteristics(input.subjectID);
    } catch { /* 元数据获取失败时降级处理 */ }
    const charcNameMap = new Map(charcMeta.map((c) => [String(c.charcID), c.name]));
    const charcTypeMap = new Map(charcMeta.map((c) => [String(c.charcID), c.charcType]));
    const enrichedChars = (input.characteristics || []).map((c) => ({
      ...c,
      name: c.name || charcNameMap.get(String(c.charcId)) || '',
      charcType: c.charcType ?? charcTypeMap.get(String(c.charcId)),
    }));

    const buildAndUpload = async (withSizes) => {
      const s = withSizes ? sizes : [];
      const payload = buildCardPayload({ subjectID: input.subjectID, card, characteristics: enrichedChars, sizes: s });
      return uploadCards([payload]);
    };

    let uploadRes = await buildAndUpload(sizes.length > 0);
    if (uploadRes?.error) {
      const errText = uploadRes.errorText || '创建卡片失败';
      endStep(task, '创建商品卡片', 'failed', errText);
      const extra = uploadRes.additionalErrors ? JSON.stringify(uploadRes.additionalErrors) : '';
      throw new Error(`${errText}${extra ? `（${extra}）` : ''}`);
    }
    endStep(task, '创建商品卡片', 'success', '卡片已提交，等待生效');

    // 检查卡片错误列表（卡片可能进入"草稿/错误"状态而非直接报错）
    await new Promise((r) => setTimeout(r, 3000));
    let cardError = null;
    try {
      const errData = await getCardErrors({ limit: 100 });
      const items = errData?.items || [];
      for (const item of items) {
        const vendorMap = item.vendorCodes || [];
        if (vendorMap.includes(card.vendorCode)) {
          cardError = (item.errors?.[card.vendorCode] || []).join(' | ');
          break;
        }
      }
    } catch { /* 忽略错误列表查询失败 */ }

    if (cardError) {
      const zh = translateError(cardError);
      // 无尺寸商品错误 → 自动重试一次（不带尺寸）
      if (/безразмерного товара|без размеров/i.test(cardError)) {
        endStep(task, '创建商品卡片', 'running', `无尺寸类目检测到，自动重试（省略尺寸）…`);
        uploadRes = await buildAndUpload(false);
        if (uploadRes?.error) {
          endStep(task, '创建商品卡片', 'failed', uploadRes.errorText || '重试失败');
          throw new Error(`${uploadRes.errorText || '重试失败'}（${card.vendorCode}）`);
        }
        await new Promise((r) => setTimeout(r, 3000));
        cardError = null;
      } else {
        endStep(task, '创建商品卡片', 'failed', `${zh || cardError}`);
        throw new Error(`${zh ? zh + '：' : ''}${cardError}`);
      }
    }

    // 查询刚创建的 nmID（同时拿到 SKU 信息）
    let nmId = null;
    let cardSkus = [];
    for (let attempt = 0; attempt < 8 && !nmId; attempt++) {
      await new Promise((r) => setTimeout(r, 1500 * (attempt + 1)));
      try {
        const cards = await getCardsList({ vendorCode: card.vendorCode });
        const found = cards.find((c) => c.vendorCode === card.vendorCode);
        if (found) {
          nmId = found.nmID;
          cardSkus = (found.sizes || []).flatMap((s) => s.skus || []);
        }
      } catch { /* retry */ }
    }
    if (!nmId) {
      endStep(task, '创建商品卡片', 'failed', '卡片创建成功但查询 nmID 超时，请稍后在卡片列表中确认');
      throw new Error('未能获取新卡片的 nmID（创建可能仍在处理中）');
    }
    task.result = { nmID: nmId, vendorCode: card.vendorCode, cardUrl: `https://seller.wildberries.cn/new-goods/card?nmId=${nmId}` };
    persist(task);

    /* 4. 上传图片 */
    startStep(task, '上传图片');
    if (images.length > 0) {
      let okCount = 0;
      const errors = [];
      for (let i = 0; i < images.length; i++) {
        const img = images[i];
        try {
          const buf = fs.readFileSync(path.join(config.uploadDir, img.file));
          await uploadMediaFile(nmId, i + 1, buf, img.file, img.mime);
          okCount++;
        } catch (e) {
          errors.push(`第${i + 1}张: ${e.message}`);
        }
      }
      if (okCount === 0) {
        endStep(task, '上传图片', 'failed', errors[0] || '全部失败');
        throw new Error(`图片上传全部失败：${errors[0] || '未知错误'}`);
      }
      endStep(task, '上传图片', okCount === images.length ? 'success' : 'success',
        `已上传 ${okCount}/${images.length}${errors.length ? `（失败: ${errors.join('; ')}）` : ''}`);
    } else {
      endStep(task, '上传图片', 'skipped', '无图片');
    }

    /* 5. 设置价格 */
    startStep(task, '设置价格');
    if (input.price != null && input.price > 0) {
      // 新卡片在价格服务中同步有延迟，先等待同步（最长 5 分钟）
      const step = task.steps.find((s) => s.name === '设置价格');
      let synced = false;
      for (let w = 0; w < 30; w++) {
        if (w > 0) await new Promise((r) => setTimeout(r, 10000));
        synced = await waitForCardInPriceService(nmId, 2000);
        step.message = synced ? '卡片已同步到价格服务' : `等待卡片同步到价格服务…(${w * 10}s)`;
        persist(task);
        if (synced) break;
      }
      if (!synced) {
        endStep(task, '设置价格', 'failed', '卡片长时间未同步到价格服务，可稍后在后台手动设置价格');
        throw new Error('卡片未同步到价格服务，价格设置跳过（可稍后重试）');
      }

      const NOT_SYNCED = /All item Nos\. are specified incorrectly|specified prices and discounts are already set/i;
      let uploadID = null;
      let priceError = null;
      for (let attempt = 0; attempt < 4; attempt++) {
        try {
          const res = await setPrices([{ nmID: nmId, price: Number(input.price), discount: Number(input.discount || 0) }]);
          if (res?.error) {
            priceError = res.errorText || '设置失败';
            if (attempt < 3 && NOT_SYNCED.test(priceError)) {
              await new Promise((r) => setTimeout(r, 10000));
              continue;
            }
            endStep(task, '设置价格', 'failed', priceError);
            throw new Error(`设置价格失败：${priceError}`);
          }
          uploadID = res?.data?.uploadID ?? res?.data?.id;
          priceError = null;
          break;
        } catch (e) {
          priceError = e instanceof Error ? e.message : String(e);
          if (e instanceof WbApiError && e.status === 400 && NOT_SYNCED.test(priceError) && attempt < 3) {
            await new Promise((r) => setTimeout(r, 10000));
            continue;
          }
          endStep(task, '设置价格', 'failed', priceError);
          throw e;
        }
      }
      if (uploadID) {
        const done = await waitForPriceTask(uploadID, task);
        const status = done?.status != null ? `状态码 ${done.status}` : '未知';
        const statusMap = { 3: '成功', 4: '已取消', 5: '部分错误', 6: '全部错误' };
        const zhStatus = statusMap[Number(done?.status)] || status;
        endStep(task, '设置价格', Number(done?.status) === 3 || Number(done?.status) === 5 ? 'success' : 'failed',
          `价格任务 #${uploadID} ${zhStatus}`);
        if (Number(done?.status) === 6 || Number(done?.status) === 4) {
          throw new Error(`价格任务 #${uploadID} ${zhStatus}`);
        }
      } else {
        endStep(task, '设置价格', priceError ? 'failed' : 'success', priceError ? priceError : '价格已提交');
        if (priceError) throw new Error(`设置价格失败：${priceError}`);
      }
    } else {
      endStep(task, '设置价格', 'skipped', '未设置价格（可在后续修改）');
    }

    /* 6. 设置库存 */
    startStep(task, '设置库存');
    if (input.warehouseId && input.stock != null) {
      try {
        const sku = input.sku || cardSkus[0];
        if (!sku) throw new Error('该卡片没有可用的 SKU（barcode），无法设置库存');
        const res = await updateStocks(input.warehouseId, [{ sku, amount: Number(input.stock) }]);
        const err = res?.errors?.find((e) => e.object === sku) || res?.errors?.[0];
        if (err) {
          endStep(task, '设置库存', 'failed', err.message || JSON.stringify(err));
          throw new Error(`设置库存失败：${err.message || JSON.stringify(err)}`);
        }
        endStep(task, '设置库存', 'success', `仓库 #${input.warehouseId} 库存 ${input.stock} 件（SKU: ${sku}）`);
      } catch (e) {
        if (e instanceof WbApiError) {
          endStep(task, '设置库存', 'failed', e.message);
          throw e;
        }
        throw e;
      }
    } else {
      endStep(task, '设置库存', 'skipped', '未设置库存');
    }

    task.status = 'success';
    persist(task);
    return task;
  } catch (e) {
    failTask(task, e);
    return task;
  }
}

/** 查看最近卡片错误（后台同步用） */
export async function fetchRecentCardErrors() {
  try {
    const data = await getCardErrors({ limit: 50 });
    return data;
  } catch (e) {
    return { error: e.message };
  }
}

export { getTask, getWarehouses };
