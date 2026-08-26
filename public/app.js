/* WBFlow 前台逻辑 */
'use strict';

const $ = (id) => document.getElementById(id);
const state = {
  status: null,
  parents: [],
  subjects: [],
  charcs: [],
  product: null,        // 解析出的源商品
  task: null,
  pollTimer: null,
};

const ICONS = { done: '√', err: '×', skip: '-', run: '…' };

/* ---------------- 通用 ---------------- */
async function api(path, opts = {}) {
  const r = await fetch(path, {
    headers: opts.body ? { 'Content-Type': 'application/json' } : undefined,
    ...opts,
  });
  const j = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(j.error || `请求失败 HTTP ${r.status}`);
  return j;
}

function setStatus(id, text, cls = '') {
  const el = $(id);
  el.textContent = text;
  el.className = 'inline-status ' + cls;
}

function esc(s) {
  return String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

/* ---------------- 初始化 ---------------- */
async function init() {
  bindEvents();
  try {
    const s = await api('/api/status');
    state.status = s;
    const pill = $('statusPill');
    if (s.ok) {
      pill.textContent = `令牌有效 · 免费额度 ${s.limits?.freeLimits ?? '?'} · ${s.warehouses?.length ?? 0} 个仓库`;
      pill.className = 'status-pill ok';
    } else {
      pill.textContent = '令牌无效：' + (s.tokenError || '');
      pill.className = 'status-pill bad';
    }
    await Promise.all([loadParents(), loadWarehouses()]);
  } catch (e) {
    $('statusPill').textContent = e.message;
    $('statusPill').className = 'status-pill bad';
  }
  loadTasks();
}

function bindEvents() {
  document.querySelectorAll('.tab').forEach((t) => {
    t.addEventListener('click', () => {
      document.querySelectorAll('.tab').forEach((x) => x.classList.toggle('active', x === t));
      $('pane-url').classList.toggle('hidden', t.dataset.tab !== 'url');
      $('pane-manual').classList.toggle('hidden', t.dataset.tab !== 'manual');
    });
  });

  $('btnParse').addEventListener('click', parseSource);
  $('sourceUrl').addEventListener('keydown', (e) => { if (e.key === 'Enter') parseSource(); });

  $('parentSelect').addEventListener('change', onParentChange);
  $('subjectSelect').addEventListener('change', onSubjectChange);
  $('brandInput').addEventListener('input', loadBrandsDebounced);
  $('btnMigrate').addEventListener('click', runMigrate);
  $('btnRefreshTasks').addEventListener('click', loadTasks);
  $('mPrice').addEventListener('input', () => { $('priceInput').value = $('mPrice').value; });
}

/* ---------------- 源商品解析 ---------------- */
async function parseSource() {
  const url = $('sourceUrl').value.trim();
  if (!url) { setStatus('parseStatus', '请先粘贴商品链接', 'err'); return; }
  $('btnParse').disabled = true;
  setStatus('parseStatus', '正在解析源商品…');
  $('productPreview').classList.add('hidden');
  try {
    const { product } = await api('/api/source/parse', { method: 'POST', body: JSON.stringify({ url }) });
    state.product = product;
    renderPreview(product);
    setStatus('parseStatus', `解析成功：${product.title?.slice(0, 40) || '无标题'} · 图片 ${product.images.length} 张`, 'ok');
    // 尝试自动匹配特性
    if (state.charcs.length) autoMapChars(product);
  } catch (e) {
    setStatus('parseStatus', '解析失败：' + e.message + '（可切换"手动输入"）', 'err');
  } finally {
    $('btnParse').disabled = false;
  }
}

function renderPreview(p) {
  $('previewImgs').innerHTML = (p.images || []).slice(0, 6)
    .map((u) => `<img src="${esc(u)}" referrerpolicy="no-referrer" onerror="this.style.opacity=.15" />`).join('');
  $('pvTitle').textContent = p.title || '（无标题）';
  $('pvBrand').textContent = p.brand ? '品牌: ' + p.brand : '';
  $('pvPrice').textContent = p.price != null ? `价格: ${p.price} ${p.currency || ''}` : '';
  $('pvSku').textContent = p.sourceSku ? '源SKU: ' + p.sourceSku : '';
  $('pvDesc').textContent = p.description || '';
  const attrs = Object.entries(p.attributes || {}).filter(([, v]) => v && v.length);
  $('pvAttrs').innerHTML = attrs.slice(0, 10).map(([k, v]) =>
    `<span class="attr-chip">${esc(k)}: ${esc(Array.isArray(v) ? v.join('/') : v)}</span>`).join('');
  $('productPreview').classList.remove('hidden');
  if (p.brand) $('brandInput').value = p.brand;
  if (p.price != null) { $('priceInput').value = p.price; $('mPrice').value = p.price; }
  if (p.title) { $('mTitle').value = p.title; }
  if (p.description) $('mDesc').value = p.description;
  if (p.images?.length) $('mImages').value = p.images.join('\n');
}

/* ---------------- 类目 ---------------- */
async function loadParents() {
  try {
    const { data } = await api('/api/categories/parents');
    state.parents = data || [];
    $('parentSelect').innerHTML = '<option value="">选择父级类目</option>' +
      data.map((p) => `<option value="${p.id}">${esc(p.name)}</option>`).join('');
  } catch (e) {
    $('parentSelect').innerHTML = `<option value="">加载失败：${esc(e.message)}</option>`;
  }
}

async function onParentChange() {
  const pid = $('parentSelect').value;
  const sel = $('subjectSelect');
  sel.disabled = !pid;
  sel.innerHTML = pid ? '<option value="">加载子类目…</option>' : '<option value="">请先选择父级类目</option>';
  $('charsBox').innerHTML = '<div class="empty">请先选择子类目</div>';
  $('subjectInfo').classList.add('hidden');
  state.subjects = [];
  state.charcs = [];
  if (!pid) return;
  try {
    const { data } = await api('/api/categories?parentID=' + pid);
    state.subjects = data || [];
    sel.innerHTML = `<option value="">共 ${state.subjects.length} 个子类目</option>` +
      state.subjects.map((s) => `<option value="${s.subjectID}">${esc(s.subjectName)}</option>`).join('');
  } catch (e) {
    sel.innerHTML = `<option value="">加载失败</option>`;
  }
}

async function onSubjectChange() {
  const sid = $('subjectSelect').value;
  $('charsBox').innerHTML = '<div class="empty">加载特性…</div>';
  $('subjectInfo').classList.add('hidden');
  if (!sid) { state.charcs = []; return; }
  try {
    const { data } = await api(`/api/categories/${sid}/characteristics`);
    state.charcs = data || [];
    const sub = state.subjects.find((s) => String(s.subjectID) === String(sid));
    $('subjectInfo').textContent = `类目：${sub?.parentName || ''} / ${sub?.subjectName || sid} · 共 ${state.charcs.length} 个特性`;
    $('subjectInfo').classList.remove('hidden');
    renderChars(state.charcs);
    loadBrands();
    if (state.product) autoMapChars(state.product);
  } catch (e) {
    $('charsBox').innerHTML = `<div class="empty">特性加载失败：${esc(e.message)}</div>`;
  }
}

function renderChars(charcs) {
  const box = $('charsBox');
  if (!charcs.length) { box.innerHTML = '<div class="empty">该类目无特性</div>'; return; }
  box.innerHTML = charcs.map((c) => `
    <div class="char-item" data-charcid="${c.charcID}">
      <div class="char-name">${esc(c.name)}${c.required ? '<span class="req">*</span>' : ''}${c.isVariable ? '<span class="var-tag">变体</span>' : ''}<span class="char-unit">${esc(c.unitName || '')}</span></div>
      <input class="input char-input" type="${c.charcType === 4 ? 'number' : 'text'}"
        data-charcid="${c.charcID}" data-type="${c.charcType}"
        placeholder="${c.charcType === 4 ? '数字' : c.maxCount > 1 ? '多个值用逗号分隔' : ''}" />
      <div class="char-note">${c.required ? '必填' : '选填'}${c.maxCount > 1 ? ` · 最多${c.maxCount}个值` : ''}${c.hasFilter ? ' · 关键特性' : ''}</div>
    </div>`).join('');
}

function collectChars() {
  const out = [];
  document.querySelectorAll('.char-input').forEach((inp) => {
    const v = inp.value.trim();
    if (!v) return;
    const isNum = inp.dataset.type === '4';
    out.push({ charcId: Number(inp.dataset.charcid), values: isNum ? Number(v) : v.split(/[,，]/).map((s) => s.trim()).filter(Boolean) });
  });
  return out;
}

/* 源商品特性自动映射 */
function autoMapChars(product) {
  const attrs = {};
  for (const [k, v] of Object.entries(product.attributes || {})) {
    attrs[k.toLowerCase()] = Array.isArray(v) ? v : [v];
  }
  const aliases = {
    color: ['颜色', 'color', 'цвет'],
    material: ['材质', '材料', 'material'],
    gender: ['性别', 'gender', 'пол'],
    country: ['产地', 'country', 'страна'],
    season: ['季节', 'season', 'сезон'],
    size: ['尺码', 'size', 'размер'],
  };
  document.querySelectorAll('.char-item').forEach((item) => {
    const name = item.querySelector('.char-name').textContent.toLowerCase();
    const inp = item.querySelector('.char-input');
    if (inp.value) return;
    for (const [, names] of Object.entries(aliases)) {
      if (names.some((n) => name.includes(n.toLowerCase()))) {
        const foundKey = names.find((n) => attrs[n.toLowerCase()]?.length);
        if (foundKey) { inp.value = attrs[foundKey.toLowerCase()].join(', '); break; }
      }
    }
  });
}

/* ---------------- 品牌 ---------------- */
let brandTimer = null;
function loadBrandsDebounced() {
  clearTimeout(brandTimer);
  brandTimer = setTimeout(loadBrands, 400);
}
async function loadBrands() {
  const sid = $('subjectSelect').value;
  const kw = $('brandInput').value.trim();
  if (!sid) return;
  try {
    const j = await api(`/api/brands?subjectId=${sid}&next=0`);
    const brands = (j.brands || []).slice(0, 50);
    const filtered = kw ? brands.filter((b) => b.name.toLowerCase().includes(kw.toLowerCase())) : brands;
    $('brandList').innerHTML = (filtered.length ? filtered : brands).map((b) => `<option value="${esc(b.name)}"></option>`).join('');
  } catch { /* ignore */ }
}

/* ---------------- 仓库 ---------------- */
async function loadWarehouses() {
  try {
    const { data } = await api('/api/warehouses');
    $('warehouseSelect').innerHTML = '<option value="">选择仓库</option>' +
      data.map((w) => `<option value="${w.id}">${esc(w.name)}</option>`).join('');
  } catch (e) {
    $('warehouseSelect').innerHTML = `<option value="">仓库加载失败</option>`;
  }
}

/* ---------------- 一键搬品 ---------------- */
async function runMigrate() {
  const btn = $('btnMigrate');
  btn.disabled = true;
  $('taskPanel').classList.remove('hidden');
  $('taskResult').classList.add('hidden');
  $('taskError').classList.add('hidden');
  $('taskSteps').innerHTML = '';
  setStatus('migrateStatus', '正在提交搬品任务…');

  const url = $('sourceUrl').value.trim();
  const mode = $('pane-manual').classList.contains('hidden') ? 'url' : 'manual';
  let product;
  if (mode === 'manual') {
    product = {
      title: $('mTitle').value.trim(),
      brand: $('mBrand').value.trim(),
      description: $('mDesc').value.trim(),
      price: $('mPrice').value ? Number($('mPrice').value) : null,
      images: $('mImages').value.split(/\r?\n/).map((s) => s.trim()).filter(Boolean),
    };
    if (!product.title) { setStatus('migrateStatus', '手动模式请填写商品标题', 'err'); btn.disabled = false; return; }
    if (!product.brand) { setStatus('migrateStatus', '手动模式请填写品牌', 'err'); btn.disabled = false; return; }
  }

  const body = {
    mode,
    url: mode === 'url' ? url : undefined,
    product: mode === 'manual' ? product : undefined,
    subjectID: Number($('subjectSelect').value),
    card: {
      vendorCode: $('vendorCodeInput').value.trim() || undefined,
      brand: $('brandInput').value.trim() || product?.brand || undefined,
      title: mode === 'manual' ? product.title : undefined,
      description: mode === 'manual' ? product.description : undefined,
    },
    characteristics: collectChars(),
    price: $('priceInput').value ? Number($('priceInput').value) : (product?.price ?? null),
    discount: $('discountInput').value ? Number($('discountInput').value) : 0,
    sizes: [],
    warehouseId: $('warehouseSelect').value ? Number($('warehouseSelect').value) : undefined,
    stock: $('stockInput').value !== '' ? Number($('stockInput').value) : undefined,
    useSourceImages: $('useSourceImages').checked,
  };

  if (!body.subjectID) { setStatus('migrateStatus', '请选择子类目', 'err'); btn.disabled = false; return; }
  if (mode === 'url' && !state.product) { setStatus('migrateStatus', '请先解析源商品，或切换到手动输入', 'err'); btn.disabled = false; return; }
  if (!body.price) { setStatus('migrateStatus', '请填写售价', 'err'); btn.disabled = false; return; }

  try {
    const { taskId } = await api('/api/migrate', { method: 'POST', body: JSON.stringify(body) });
    setStatus('migrateStatus', '任务已提交，正在执行…', 'ok');
    pollTask(taskId);
  } catch (e) {
    setStatus('migrateStatus', '提交失败：' + e.message, 'err');
    btn.disabled = false;
  }
}

function pollTask(taskId) {
  clearInterval(state.pollTimer);
  state.pollTimer = setInterval(async () => {
    try {
      const { task } = await api('/api/tasks/' + taskId);
      renderTask(task);
      if (task.status !== 'running') {
        clearInterval(state.pollTimer);
        state.pollTimer = null;
        $('btnMigrate').disabled = false;
        if (task.status === 'success') {
          setStatus('migrateStatus', '搬品成功', 'ok');
        } else {
          setStatus('migrateStatus', '搬品失败', 'err');
        }
        loadTasks();
      }
    } catch { /* 网络抖动忽略，继续轮询 */ }
  }, 2000);
}

function renderTask(task) {
  state.task = task;
  const order = ['准备商品数据', '下载图片', '创建商品卡片', '上传图片', '设置价格', '设置库存'];
  const steps = [...task.steps].sort((a, b) => order.indexOf(a.name) - order.indexOf(b.name));
  $('taskSteps').innerHTML = steps.map((s) => {
    const icon = ICONS[s.status] || '';
    return `<div class="tstep">
      <span class="dot ${s.status === 'success' ? 'done' : s.status === 'failed' ? 'err' : s.status === 'skipped' ? 'skip' : 'run'}">${icon}</span>
      <span class="sname">${esc(s.name)}</span>
      <span class="smsg">${esc(s.message || '')}</span>
    </div>`;
  }).join('');

  const res = task.result;
  if (res?.nmID) {
    $('taskResult').innerHTML = `商品卡片已创建：<br/>
      编号 nmID：<b>${res.nmID}</b> · 商家SKU：<b>${esc(res.vendorCode)}</b><br/>
      <a href="${esc(res.cardUrl)}" target="_blank" rel="noopener">打开卖家后台查看卡片 →</a>`;
    $('taskResult').classList.remove('hidden');
  }
  if (task.status === 'failed' && task.error) {
    $('taskError').textContent = '失败原因：' + task.error;
    $('taskError').classList.remove('hidden');
  }
}

/* ---------------- 历史 ---------------- */
async function loadTasks() {
  try {
    const { tasks } = await api('/api/tasks');
    const list = $('tasksList');
    if (!tasks.length) { list.innerHTML = '<div class="empty">暂无搬品记录</div>'; return; }
    list.innerHTML = tasks.map((t) => {
      const cls = t.status === 'success' ? 'ok' : t.status === 'failed' ? 'failed' : 'running';
      const time = (t.createdAt || '').replace('T', ' ').slice(0, 16);
      const title = t.source?.title || t.title || '(手动)';
      return `<div class="task-item" onclick="showTask('${t.id}')">
        <span class="tstatus ${cls}"></span>
        <span class="ttitle">${esc(title.slice(0, 40))}</span>
        <span class="tnm">${t.result?.nmID ? 'nmID ' + t.result.nmID : ''}</span>
        <span class="tmeta">${time} · ${t.status === 'running' ? '执行中' : t.status === 'success' ? '成功' : '失败'}</span>
      </div>`;
    }).join('');
  } catch { /* ignore */ }
}

function showTask(id) {
  clearInterval(state.pollTimer);
  state.pollTimer = null;
  $('taskPanel').classList.remove('hidden');
  $('taskResult').classList.add('hidden');
  $('taskError').classList.add('hidden');
  $('btnMigrate').disabled = false;
  document.querySelector('#stepRun').scrollIntoView({ behavior: 'smooth' });
  (async () => {
    const { task } = await api('/api/tasks/' + id);
    renderTask(task);
    if (task.status === 'running') pollTask(id);
  })();
}

init();
