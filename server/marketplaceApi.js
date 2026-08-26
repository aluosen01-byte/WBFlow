import { marketRequest, apiRequest } from './wbClient.js';
import { config } from './config.js';

/**
 * WB 市场 / 价格 API 封装。
 *  - 仓库与库存: marketplace-api.wildberries.cn
 *  - 价格与折扣: discounts-prices-api.wildberries.cn
 */

/** 仓库列表 */
export async function getWarehouses() {
  return marketRequest('/api/v3/warehouses');
}

/**
 * 设置价格与折扣（异步任务，需轮询 getPriceTaskState 查看结果）
 * @param {Array} data [{nmID, price, discount}]
 */
export async function setPrices(data) {
  const res = await apiRequest(`${config.pricesBase}/api/v2/upload/task`, {
    method: 'POST',
    body: { data },
  });
  return res; // { data: { uploadID }, error, errorText }
}

/** 设置尺码价格 */
export async function setSizePrices(data) {
  const res = await apiRequest(`${config.pricesBase}/api/v2/upload/task/size`, {
    method: 'POST',
    body: { data },
  });
  return res;
}

/** 上传状态查询（已处理任务），uploadID 必填 */
export async function getPriceTaskState({ uploadID, limit = 100 } = {}) {
  const qs = new URLSearchParams();
  qs.set('uploadID', String(uploadID));
  qs.set('limit', String(limit));
  const res = await apiRequest(`${config.pricesBase}/api/v2/history/tasks?${qs}`);
  return res; // { data: [{uploadID, status, uploadDate}] }
}

/** 上传详情（含错误明细） */
export async function getPriceTaskDetails({ uploadID, limit = 100 } = {}) {
  const qs = new URLSearchParams();
  qs.set('uploadID', String(uploadID));
  qs.set('limit', String(limit));
  const res = await apiRequest(`${config.pricesBase}/api/v2/history/goods/task?${qs}`);
  return res;
}

/** 按 nmID 查询商品价格信息（判断卡片是否已同步到价格服务） */
export async function getGoodsByNm(nmList) {
  const res = await apiRequest(`${config.pricesBase}/api/v2/list/goods/filter`, {
    method: 'POST',
    body: { nmList },
  });
  return res;
}

/**
 * 更新库存
 * @param {number} warehouseId
 * @param {Array} stocks [{sku, amount}]
 */
export async function updateStocks(warehouseId, stocks) {
  const res = await marketRequest(`/api/v3/stocks/${warehouseId}`, {
    method: 'PUT',
    body: { stocks },
  });
  return res;
}
