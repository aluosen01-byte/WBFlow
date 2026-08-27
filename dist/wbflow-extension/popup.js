/* WBFlow 扩展设置弹窗 */
'use strict';

const DEFAULTS = {
  backendUrl: 'http://localhost:3000',
  currentUser: '',
  warehouseId: '',
  priceMode: 'manual',
  priceMultiplier: 1.5,
  stock: 10,
  defaultBrand: '',
  defaultSubjectId: '',
  autoOpen: true,
};

const $ = (id) => document.getElementById(id);

async function load() {
  const { wbflow } = await chrome.storage.local.get('wbflow');
  const cfg = { ...DEFAULTS, ...(wbflow || {}) };
  $('backendUrl').value = cfg.backendUrl;
  $('warehouseId').value = cfg.warehouseId;
  $('priceMode').value = cfg.priceMode;
  $('priceMultiplier').value = cfg.priceMultiplier;
  $('stock').value = cfg.stock;
  $('defaultBrand').value = cfg.defaultBrand;
  // 打开设置时自动确保后端已启动（native host 模式免手动 npm start）
  const ensure = await new Promise((resolve) => {
    chrome.runtime.sendMessage({ type: 'ensureBackend' }, (r) => resolve(r || { ok: false }));
  });
  if (ensure.ok) {
    setStatus('后端已就绪（' + (ensure.server === 'started' ? '本次已自动启动' : '运行中') + '）', 'ok');
  } else {
    setStatus(ensure.hint || '后端未启动：' + (ensure.error || ''), 'err');
  }
  await Promise.all([loadUsers(cfg), loadWarehouses(cfg.backendUrl)]);
}

async function loadUsers(cfg) {
  const base = cfg.backendUrl;
  try {
    const r = await fetch(base.replace(/\/$/, '') + '/api/users');
    if (!r.ok) throw new Error('HTTP ' + r.status);
    const { users, current } = await r.json();
    const sel = $('userSelect');
    sel.innerHTML = (users || []).map((u) => `<option value="${u.name}">${u.name}</option>`).join('')
      || '<option value="">无用户</option>';
    const saved = cfg.currentUser || '';
    sel.value = (users || []).some((u) => u.name === saved) ? saved : (current || (users && users[0] && users[0].name) || '');
  } catch (e) {
    $('userSelect').innerHTML = '<option value="">用户加载失败</option>';
    setStatus('用户列表加载失败：' + e.message, 'err');
  }
}

async function loadWarehouses(base) {
  try {
    const r = await fetch(base.replace(/\/$/, '') + '/api/warehouses');
    if (!r.ok) throw new Error('HTTP ' + r.status);
    const { data } = await r.json();
    const sel = $('warehouseId');
    const current = sel.value;
    sel.innerHTML = '<option value="">（自动检测）</option>' +
      (data || []).map((w) => `<option value="${w.id}">${w.name}</option>`).join('');
    if (current) sel.value = current;
    setStatus('已连接后端，仓库 ' + (data?.length || 0) + ' 个', 'ok');
  } catch (e) {
    setStatus('后端连接失败：' + e.message + '（请先 npm start）', 'err');
  }
}

function setStatus(text, cls = '') {
  const el = $('status');
  el.textContent = text;
  el.className = cls;
}

function read() {
  return {
    backendUrl: $('backendUrl').value.trim() || DEFAULTS.backendUrl,
    currentUser: $('userSelect').value,
    warehouseId: $('warehouseId').value,
    priceMode: $('priceMode').value,
    priceMultiplier: Number($('priceMultiplier').value) || 1.5,
    stock: $('stock').value === '' ? 10 : Number($('stock').value),
    defaultBrand: $('defaultBrand').value.trim(),
    defaultSubjectId: '',
    autoOpen: true,
  };
}

$('btnSave').addEventListener('click', async () => {
  const cfg = read();
  const existing = (await chrome.storage.local.get('wbflow')).wbflow || {};
  await chrome.storage.local.set({ wbflow: { ...existing, ...cfg } }); // 合并，保留类目记忆等字段
  setStatus('设置已保存', 'ok');
  setTimeout(() => window.close(), 600);
});

$('btnTest').addEventListener('click', () => {
  loadWarehouses($('backendUrl').value.trim());
});

$('btnOpen').addEventListener('click', () => {
  const base = $('backendUrl').value.trim() || DEFAULTS.backendUrl;
  chrome.tabs.create({ url: base });
});

load();
