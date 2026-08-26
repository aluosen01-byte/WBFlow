import { contentRequest } from './wbClient.js';
import { config } from './config.js';

/**
 * WB 内容 API（商品管理）封装：
 * 类目/特性/品牌/目录字典、卡片上传、媒体上传、条码生成、卡片查询。
 * 接口文档: https://dev.wildberries.cn/docs/openapi/work-with-products
 */

/** 父级类目列表 */
export async function getParentCategories() {
  const data = await contentRequest(`/content/v2/object/parent/all?locale=${config.locale}`);
  return data?.data || [];
}

/** 子类目列表（可按父类目/关键字过滤） */
export async function getSubcategories({ parentID, name, limit = 500, offset = 0 } = {}) {
  const qs = new URLSearchParams({ locale: config.locale, limit: String(limit), offset: String(offset) });
  if (parentID) qs.set('parentID', String(parentID));
  if (name) qs.set('name', name);
  const data = await contentRequest(`/content/v2/object/all?${qs}`);
  return data?.data || [];
}

/** 某子类目的全部特性 */
export async function getCharacteristics(subjectId) {
  const data = await contentRequest(`/content/v2/object/charcs/${subjectId}?locale=${config.locale}`);
  return data?.data || [];
}

/** 品牌列表（按类目） */
export async function getBrands(subjectId, { next = 0, limit = 100 } = {}) {
  const qs = new URLSearchParams({ subjectId: String(subjectId), next: String(next), limit: String(limit) });
  const data = await contentRequest(`/api/content/v1/brands?${qs}`);
  return data; // { total, brands: [{id, name, logoUrl}] }
}

/** 目录字典：colors / countries / kinds / seasons / vat */
export async function getDirectory(type) {
  const data = await contentRequest(`/content/v2/directory/${type}?locale=${config.locale}`);
  return data?.data || [];
}

/** 海关编码 TNVED */
export async function getTnved(subjectID, search = '') {
  const qs = new URLSearchParams({ subjectID: String(subjectID), locale: config.locale });
  if (search) qs.set('search', search);
  const data = await contentRequest(`/content/v2/directory/tnved?${qs}`);
  return data?.data || [];
}

/** 卡片限额 */
export async function getCardsLimits() {
  const data = await contentRequest('/content/v2/cards/limits');
  return data?.data || {};
}

/** 生成条码 SKU */
export async function generateBarcodes(count = 1) {
  const data = await contentRequest('/content/v2/barcodes', { method: 'POST', body: { count } });
  return data?.data || [];
}

/**
 * 创建商品卡片（一键搬品的核心）
 * @param {Array} payload 结构见 docs_ref/work-with-products.spec.json 的 cards/upload
 */
export async function uploadCards(payload) {
  const data = await contentRequest('/content/v2/cards/upload', { method: 'POST', body: payload });
  return data; // { data, error, errorText, additionalErrors }
}

/** 向已有卡片追加商品（合并） */
export async function uploadCardsAdd(payload) {
  const data = await contentRequest('/content/v2/cards/upload/add', { method: 'POST', body: payload });
  return data;
}

/** 查询卡片列表（按 vendorCode / nmID / 文本等） */
export async function getCardsList({ textSearch, vendorCode, nmID, limit = 100, updatedAt, cursorNmID } = {}) {
  const filter = { allowedCategoriesOnly: true };
  if (textSearch) filter.textSearch = textSearch;
  if (vendorCode) filter.textSearch = vendorCode;
  if (nmID) filter.nmID = nmID;
  const settings = {
    sort: { ascending: false },
    filter,
    cursor: { limit, ...(updatedAt ? { updatedAt } : {}), ...(cursorNmID ? { nmID: cursorNmID } : {}) },
  };
  const data = await contentRequest(`/content/v2/get/cards/list?locale=${config.locale}`, {
    method: 'POST',
    body: { settings },
  });
  return data?.cards || [];
}

/** 卡片错误列表 */
export async function getCardErrors({ limit = 100 } = {}) {
  const data = await contentRequest(`/content/v2/cards/error/list?locale=${config.locale}`, {
    method: 'POST',
    body: { cursor: { limit }, order: { ascending: true } },
  });
  return data?.data || {};
}

/**
 * 上传媒体文件（图片/视频）到指定卡片
 * @param {number|string} nmId
 * @param {number} photoNumber 从 1 开始
 * @param {Buffer} fileBuffer
 * @param {string} filename
 * @param {string} mimeType
 */
export async function uploadMediaFile(nmId, photoNumber, fileBuffer, filename, mimeType) {
  const fd = new FormData();
  fd.append('uploadfile', new Blob([fileBuffer], { type: mimeType }), filename);
  const data = await contentRequest('/content/v3/media/file', {
    method: 'POST',
    headers: {
      'X-Nm-Id': String(nmId),
      'X-Photo-Number': String(photoNumber),
    },
    body: fd,
  });
  return data;
}

/** 通过链接保存媒体文件（顺序对应卡片图片顺序） */
export async function saveMediaByLinks(nmId, links) {
  const data = await contentRequest('/content/v3/media/save', {
    method: 'POST',
    body: { nmId, data: links },
  });
  return data;
}
