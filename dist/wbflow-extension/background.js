/* WBFlow 扩展后台：配置管理 + 后端服务自动启动 */
'use strict';

const DEFAULTS = {
  backendUrl: 'http://localhost:3000',
  currentUser: '',         // 当前操作账号（搬品使用该账号令牌），留空用后端默认用户
  warehouseId: '',
  priceMode: 'manual',     // manual | source | multiplier
  priceMultiplier: 1.5,
  stock: 10,
  defaultBrand: '',        // 留空则用源商品品牌
  defaultSubjectId: '',    // 可选默认类目
  autoOpen: true,          // 搬品成功后自动打开结果链接
};

const HOST_NAME = 'com.wbflow.host';

/** 探测后端是否可访问 */
async function pingBackend(base) {
  try {
    const r = await fetch(base.replace(/\/$/, '') + '/healthz', { signal: AbortSignal.timeout(1500) });
    return r.ok;
  } catch { return false; }
}

/** 通过 Native Messaging Host 请求自动启动后端 */
function requestNativeStart() {
  return new Promise((resolve) => {
    let port;
    try {
      port = chrome.runtime.connectNative(HOST_NAME);
    } catch (e) {
      resolve({ ok: false, error: 'native host 未安装：' + e.message });
      return;
    }
    const timer = setTimeout(() => { try { port.disconnect(); } catch { /* ignore */ } resolve({ ok: false, error: 'native host 无响应' }); }, 12000);
    port.onMessage.addListener((msg) => {
      clearTimeout(timer);
      try { port.disconnect(); } catch { /* ignore */ }
      resolve({ ok: true, ...(msg || {}) });
    });
    port.onDisconnect.addListener(() => {
      clearTimeout(timer);
      resolve({ ok: false, error: 'native host 连接断开：' + (chrome.runtime.lastError?.message || '') });
    });
    try {
      port.postMessage({ type: 'ensureServer' });
    } catch (e) {
      clearTimeout(timer);
      resolve({ ok: false, error: e.message });
    }
  });
}

/** 确保后端运行：探测 → 未运行则请求 native host 启动 → 再次探测 */
async function ensureBackend() {
  const { wbflow } = await chrome.storage.local.get('wbflow');
  const base = (wbflow && wbflow.backendUrl) || DEFAULTS.backendUrl;
  if (await pingBackend(base)) {
    return { ok: true, server: 'running', backendUrl: base };
  }
  const native = await requestNativeStart();
  if (!native.ok) {
    return { ok: false, server: 'stopped', backendUrl: base, error: native.error, hint: '请运行 wbflow-extension/native-host/install-host.bat 启用自动启动，或手动 npm start' };
  }
  // 等待端口就绪
  for (let i = 0; i < 20; i++) {
    await new Promise((r) => setTimeout(r, 500));
    if (await pingBackend(base)) {
      return { ok: true, server: 'started', backendUrl: base };
    }
  }
  return { ok: false, server: 'starting', backendUrl: base, error: '后端启动超时', hint: '请手动 npm start 并检查端口' };
}

chrome.runtime.onInstalled.addListener(async () => {
  const cfg = await chrome.storage.local.get('wbflow');
  if (!cfg.wbflow) await chrome.storage.local.set({ wbflow: DEFAULTS });
  ensureBackend(); // 安装后自动尝试启动后端（失败静默，不打扰）
});

chrome.runtime.onStartup.addListener(() => {
  ensureBackend();
});

chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
  if (msg?.type === 'getConfig') {
    chrome.storage.local.get('wbflow').then(({ wbflow }) => sendResponse(wbflow || DEFAULTS));
    return true;
  }
  if (msg?.type === 'setConfig') {
    // 合并保存：lastParentId/lastSubjectId/categoryMap 等运行时记忆字段需保留
    chrome.storage.local.get('wbflow').then(({ wbflow }) => {
      const base = { ...DEFAULTS, ...(wbflow || {}) };
      const merged = { ...base, ...msg.config };
      if (msg.config.categoryMap && base.categoryMap) {
        merged.categoryMap = { ...base.categoryMap, ...msg.config.categoryMap };
      }
      chrome.storage.local.set({ wbflow: merged }).then(() => sendResponse({ ok: true }));
    });
    return true;
  }
  if (msg?.type === 'ensureBackend') {
    ensureBackend().then(sendResponse);
    return true;
  }
  if (msg?.type === 'openTab') {
    chrome.tabs.create({ url: msg.url }).then(() => sendResponse({ ok: true }));
    return true;
  }
});
