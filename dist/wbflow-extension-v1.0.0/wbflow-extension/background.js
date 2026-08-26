/* WBFlow 扩展后台：配置管理 + 图标徽标 */
'use strict';

const DEFAULTS = {
  backendUrl: 'http://localhost:3000',
  warehouseId: '',
  priceMode: 'manual',     // manual | source | multiplier
  priceMultiplier: 1.5,
  stock: 10,
  defaultBrand: '',        // 留空则用源商品品牌
  defaultSubjectId: '',    // 可选默认类目
  autoOpen: true,          // 搬品成功后自动打开结果链接
};

chrome.runtime.onInstalled.addListener(async () => {
  const cfg = await chrome.storage.local.get('wbflow');
  if (!cfg.wbflow) await chrome.storage.local.set({ wbflow: DEFAULTS });
});

// 供 content 脚本读取配置
chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
  if (msg?.type === 'getConfig') {
    chrome.storage.local.get('wbflow').then(({ wbflow }) => sendResponse(wbflow || DEFAULTS));
    return true;
  }
  if (msg?.type === 'setConfig') {
    // 合并保存，避免覆盖 lastParentId/lastSubjectId 等运行时记忆字段
    chrome.storage.local.get('wbflow').then(({ wbflow }) => {
      const merged = { ...DEFAULTS, ...(wbflow || {}), ...msg.config };
      chrome.storage.local.set({ wbflow: merged }).then(() => sendResponse({ ok: true }));
    });
    return true;
  }
  if (msg?.type === 'openTab') {
    chrome.tabs.create({ url: msg.url }).then(() => sendResponse({ ok: true }));
    return true;
  }
});
