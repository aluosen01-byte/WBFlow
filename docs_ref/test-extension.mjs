/**
 * 扩展 content.js 集成测试（jsdom）：
 * 模拟 WB 商品页 DOM + 存根 chrome/fetch，验证：
 *  1. 注入悬浮按钮
 *  2. 多层提取器提取商品（JSON-LD / meta / DOM / __NUXT__）
 *  3. 全部主图提取 + 尺寸段归一化为 big
 *  4. 源类目包屑提取
 *  5. 弹窗渲染：仓库默认"我的仓库"、售价自动带出
 *  6. 类目记忆自动选中
 *  7. 提交搬品并渲染结果
 */
import fs from 'node:fs';
import { JSDOM } from 'jsdom';

const contentSrc = fs.readFileSync('D:/projects/WBFlow/wbflow-extension/content.js', 'utf8');

// 模拟 WB 商品页：JSON-LD Product（多图不同尺寸段）+ BreadcrumbList + og meta + DOM
const pageHtml = `<!DOCTYPE html><html><head>
  <title>Bicycle accessories — купить по цене 1999 ₽ | WB</title>
  <meta property="og:title" content="Велосипедные аксессуары — купить по цене 1999 ₽">
  <meta property="og:description" content="Велосипедные аксессуары, высокое качество">
  <meta property="og:image" content="https://basket-01.wbbasket.ru/vol1455/part145530/1455302318/images/c516x688/1.webp">
  <script type="application/ld+json">
  {"@context":"https://schema.org","@type":"Product",
   "name":"Велосипедные аксессуары",
   "description":"Bluetooth-велокомпьютер, фонарь, звонок, держатель",
   "brand":{"@type":"Brand","name":"SoundCore"},
   "sku":"1455302318",
   "image":["https://basket-01.wbbasket.ru/vol1455/part145530/1455302318/images/c516x688/1.webp",
            "https://basket-01.wbbasket.ru/vol1455/part145530/1455302318/images/c516x688/2.webp",
            "https://basket-01.wbbasket.ru/vol1455/part145530/1455302318/images/c516x688/3.webp"],
   "offers":{"@type":"Offer","price":"1999","priceCurrency":"RUB"},
   "additionalProperty":[{"@type":"PropertyValue","name":"Цвет","value":"черный"},
                          {"@type":"PropertyValue","name":"Материал","value":"алюминий"}]}
  </script>
  <script type="application/ld+json">
  {"@context":"https://schema.org","@type":"BreadcrumbList","itemListElement":[
    {"@type":"ListItem","position":1,"item":{"@id":"/main","name":"Main"}},
    {"@type":"ListItem","position":2,"item":{"@id":"/sports","name":"Sports"}},
    {"@type":"ListItem","position":3,"item":{"@id":"/cycling","name":"Cycling"}},
    {"@type":"ListItem","position":4,"item":{"@id":"/accessories","name":"Accessories"}}]}
  </script>
  <script>
  window.__NUXT__ = (function(){ return {
    "object_name": "Велосипедные аксессуары",
    "parent_name": "Cycling",
    "dimensions": {"length":12,"width":7,"height":5,"weightBrutto":0.5}
  }; })();
  </script>
</head><body>
  <h1 itemprop="name">Велосипедные аксессуары</h1>
  <a data-link="/brands/SoundCore">SoundCore</a>
  <span class="price-block__price">1 999 ₽</span>
  <button data-e2e="full-details">Все характеристики</button>
  <div class="modal" style="display:none">
    <div class="modal-content">
      <p>Полное описание товара: Bluetooth-велокомпьютер с беспроводной передачей данных, передний фонарь 300 люмен, звонок и держатель для смартфона в комплекте. Корпус из алюминиевого сплава, влагозащита IPX5. Время работы до 30 часов, беспроводная зарядка, вес всего 45 грамм. Совместим с любыми велосипедами, устанавливается без специального инструмента. Гарантия 12 месяцев.</p>
      <button class="modal__close">×</button>
    </div>
  </div>
  <div class="swiper-wrapper">
    <img src="https://basket-01.wbbasket.ru/vol1455/part145530/1455302318/images/tm/1.webp">
    <img src="https://basket-01.wbbasket.ru/vol1455/part145530/1455302318/images/tm/2.webp">
  </div>
</body></html>`;

const dom = new JSDOM(pageHtml, {
  url: 'https://www.wildberries.ru/catalog/1417476182/detail.aspx?targetUrl=MI',
  runScripts: 'outside-only',
  pretendToBeVisual: true,
});
const { window } = dom;

// ---- 存根 chrome.runtime：无学习映射（验证规则表 Sports/Cycling/Accessories → 自行车装饰） ----
const savedSetConfig = [];
window.chrome = {
  runtime: {
    sendMessage: (msg, cb) => {
      if (msg.type === 'setConfig') savedSetConfig.push(msg.config);
      const res = msg.type === 'getConfig' ? {
        backendUrl: 'http://localhost:3000', priceMode: 'manual', priceMultiplier: 1.5,
        stock: 5, warehouseId: '', defaultBrand: '', currentUser: '罗世凯',
        lastParentId: '', lastSubjectId: '',
        categoryMap: {},
      } : (msg.type === 'ensureBackend' ? { ok: true, server: 'running' } : { ok: true });
      if (cb) cb(res);
    },
    getManifest: () => ({ version: '1.1.1' }),
    onMessage: { addListener() {} },
  },
};

// ---- 存根 fetch（模拟后端，含 体育用品/239 → 自行车装饰/1557 与用户列表） ----
const json = (data, ok = true) => ({ ok, status: ok ? 200 : 500, json: async () => data });
window.fetch = async (url, opts = {}) => {
  const path = String(url).replace(/^https?:\/\/[^/]+/, '');
  if (path === '/api/version') return json({ name: 'wbflow', version: '1.1.1' });
  if (path === '/api/users') return json({ users: [{ name: '罗世凯' }, { name: '罗世伟' }, { name: '罗梓晨' }, { name: '陈炜豪' }, { name: '孙红伟' }], current: '罗世凯' });
  if (path === '/api/categories/parents') return json({ data: [{ id: 239, name: '体育用品' }, { id: 479, name: '电子配件' }] });
  if (path.startsWith('/api/warehouses')) return json({ data: [{ id: 999, name: '备用仓' }, { id: 2096595, name: '我的仓库' }] });
  if (path.startsWith('/api/categories?limit=500')) return json({
    data: [
      { subjectID: 2187, parentID: 479, subjectName: 'USB数据线' },
      { subjectID: 2191, parentID: 479, subjectName: '蓝牙耳机' },
      { subjectID: 1557, parentID: 239, subjectName: '自行车装饰' },
      { subjectID: 2151, parentID: 239, subjectName: '自行车' },
    ],
  });
  if (path.startsWith('/api/categories?parentID=')) return json({
    data: path.includes('239')
      ? [{ subjectID: 1557, parentID: 239, subjectName: '自行车装饰' }, { subjectID: 2151, parentID: 239, subjectName: '自行车' }]
      : path.includes('479')
        ? [{ subjectID: 2187, parentID: 479, subjectName: 'USB数据线' }, { subjectID: 2191, parentID: 479, subjectName: '蓝牙耳机' }]
        : [],
  });
  if (path.startsWith('/api/categories/1557/characteristics')) return json({
    data: [
      { charcID: 90735, name: '电线长度(cm)', charcType: 4, required: false, unitName: '厘米' },
      { charcID: 88952, name: '带包装重量(g)(克)/产品毛重(g)', charcType: 4, required: false, unitName: '克' },
      { charcID: 17596, name: '颜色', charcType: 1, required: true, maxCount: 3 },
    ],
  });
  if (path.startsWith('/api/migrate')) return json({ taskId: 'test-task-abc', status: 'running' });
  if (path.startsWith('/api/tasks/test-task-abc')) return json({
    task: {
      id: 'test-task-abc', status: 'success',
      steps: [
        { name: '准备商品数据', status: 'success', message: 'ok' },
        { name: '下载图片', status: 'success', message: '3/3' },
        { name: '创建商品卡片', status: 'success', message: 'ok' },
        { name: '上传图片', status: 'success', message: '3/3' },
        { name: '设置价格', status: 'success', message: '任务 #1 成功' },
        { name: '设置库存', status: 'success', message: 'ok' },
      ],
      result: { nmID: 1455302318, vendorCode: 'wb-test', cardUrl: 'https://seller.wildberries.cn/new-goods/card?nmId=1455302318' },
      error: null,
    },
  });
  return json({ error: 'unhandled ' + path }, false);
};

// ---- 执行 content.js ----
window.eval(contentSrc);

const assert = (cond, msg) => { if (!cond) throw new Error('断言失败: ' + msg); console.log('  [通过]', msg); };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

(async () => {
  console.log('== 1. 悬浮按钮注入 ==');
  const fab = window.document.querySelector('.wbflow-fab');
  assert(fab, '页面注入 .wbflow-fab 按钮');
  assert(fab.textContent.includes('一键搬品'), '按钮文案正确');

  console.log('== 2. 打开弹窗（提取 + 渲染） ==');
  fab.click();
  await sleep(500);

  const title = window.document.getElementById('wf-title');
  assert(title, '弹窗已渲染');
  assert(title.value === 'Велосипедные аксессуары', '标题来自 JSON-LD（未被 og:title 后缀污染）: ' + title.value);
  const brand = window.document.getElementById('wf-brand');
  assert(brand.value === 'SoundCore', '品牌来自 JSON-LD');
  const price = window.document.getElementById('wf-price');
  assert(price.value === '1999', '售价自动带出源价格: ' + price.value);

  console.log('== 2.5 团队用户选择器与版本号 ==');
  const userSel = window.document.getElementById('wf-user');
  assert(userSel, '弹窗头部有用户选择器');
  assert(userSel.options.length === 5, '用户选择器列出 5 个用户: ' + userSel.options.length);
  assert(userSel.value === '罗世凯', '默认选中保存的账号「罗世凯」: ' + userSel.value);
  // 切换用户
  userSel.value = '陈炜豪';
  userSel.dispatchEvent(new window.Event('change'));
  assert(window.document.getElementById('wf-status').textContent.includes('陈炜豪'), '切换账号后状态提示更新');
  // 版本号展示
  const verEl = window.document.getElementById('wf-version');
  assert(verEl && verEl.textContent === 'v1.1.1', '一键搬品弹窗显示版本号 v1.1.1（来自后端 /api/version）: ' + (verEl && verEl.textContent));

  console.log('== 3. 全部主图提取 + 尺寸归一化 ==');
  const images = window.document.getElementById('wf-images');
  const imgList = images.value.split('\n').filter(Boolean);
  assert(imgList.length >= 3, '主图 >= 3 张（JSON-LD 3 图 + og + DOM 去重后）: ' + imgList.length);
  const allBig = imgList.every((u) => u.includes('/images/big/'));
  assert(allBig, '所有图片 URL 归一化为 big 尺寸');
  const unique = new Set(imgList).size === imgList.length;
  assert(unique, '图片去重（不同尺寸段合并）');

  console.log('== 4. 源类目包屑（英文 Main/Sports/Cycling/Accessories） ==');
  const crumbsText = window.document.querySelector('.wbflow-modal-body').textContent;
  assert(crumbsText.includes('Main') && crumbsText.includes('Accessories'), '源商品类目包屑已展示');

  console.log('== 5. 尺寸与重量自动提取 ==');
  const dimL = window.document.getElementById('wf-dim-length');
  const dimW = window.document.getElementById('wf-dim-width');
  const dimH = window.document.getElementById('wf-dim-height');
  const dimKg = window.document.getElementById('wf-dim-weight');
  assert(dimL && dimL.value === '12', '长=12cm（__NUXT__ dimensions）: ' + (dimL && dimL.value));
  assert(dimW && dimW.value === '7', '宽=7cm');
  assert(dimH && dimH.value === '5', '高=5cm');
  assert(dimKg && dimKg.value === '0.5', '重=0.5kg');
  const dimsTitle = window.document.querySelector('.wbflow-modal-body').textContent;
  assert(dimsTitle.includes('尺寸与重量（已自动提取'), '尺寸区块标题显示已自动提取');

  console.log('== 6. 仓库默认"我的仓库" ==');
  const warehouseSel = window.document.getElementById('wf-warehouse');
  const picked = warehouseSel.options[warehouseSel.selectedIndex];
  assert(picked && picked.value === '2096595', '仓库自动选中"我的仓库"(2096595): ' + (picked ? picked.text : '无'));

  console.log('== 7. 类目规则表自动匹配（Sports/Cycling/Accessories → 自行车装饰） ==');
  await sleep(700); // 等待 autoSelectSubject 的异步级联
  const parentSel = window.document.getElementById('wf-parent');
  const subjectSel = window.document.getElementById('wf-subject');
  assert(String(parentSel.value) === '239', '父级类目自动选中 239（体育用品）: ' + parentSel.value);
  assert(String(subjectSel.value) === '1557', '子类目自动选中 1557（自行车装饰）: ' + subjectSel.value);
  const charItems = window.document.querySelectorAll('.wbflow-char');
  assert(charItems.length === 3, '特性表单已自动加载: ' + charItems.length);
  const weightItem = [...charItems].find((i) => i.textContent.includes('带包装重量'));
  assert(weightItem && !weightItem.querySelector('input'), '重量特性自动映射（无输入框）');

  console.log('== 8. Full Details 弹窗描述抓取 ==');
  await sleep(900); // 等待 grabFullDetails 异步（点击+700ms）
  const desc = window.document.getElementById('wf-desc');
  assert(desc && desc.value.length > 100, '描述已填入 Full Details 弹窗内容: ' + (desc ? desc.value.slice(0, 40) + '…' : '空'));
  assert(desc.value.includes('Bluetooth-велокомпьютер'), '描述来自 Full Details 弹窗');

  console.log('== 8.5 描述字符计数 ==');
  const descCount = window.document.getElementById('wf-desc-count');
  assert(descCount && /\/2000$/.test(descCount.textContent), '描述计数显示 x/2000: ' + (descCount && descCount.textContent));
  // 超限输入 → 计数变红提示
  const fullDesc = desc.value;
  desc.value = 'x'.repeat(2100);
  desc.dispatchEvent(new window.Event('input'));
  assert(descCount.textContent === '2100/2000' && descCount.classList.contains('over'), '超 2000 字符计数标红提示（搬品时后端按类目限制自动截断）');
  desc.value = fullDesc; // 恢复原描述供后续提交断言

  console.log('== 9. 品牌非必填 ==');
  const brandInput = window.document.getElementById('wf-brand');
  assert(brandInput && !brandInput.closest('label').textContent.includes('*'), '品牌标签无必填星号');
  brandInput.value = ''; // 清空品牌

  console.log('== 9.5 售价必填校验 ==');
  const priceInput = window.document.getElementById('wf-price');
  const origPrice = priceInput.value;
  priceInput.value = '';
  const goBtnPre = window.document.getElementById('wf-go');
  goBtnPre.click();
  await sleep(300);
  const statusPre = window.document.getElementById('wf-status');
  assert(statusPre.textContent.includes('售价为必填项'), '售价为空时提示必填: ' + statusPre.textContent);
  assert(priceInput.classList.contains('error'), '售价输入框标红提示');
  priceInput.value = origPrice; // 恢复售价

  console.log('== 10. 提交搬品 ==');
  let capturedBody = null;
  const origFetch = window.fetch;
  window.fetch = async (url, opts = {}) => {
    const path = String(url).replace(/^https?:\/\/[^/]+/, '');
    if (path.startsWith('/api/migrate') && opts.body) capturedBody = JSON.parse(opts.body);
    return origFetch(url, opts);
  };
  const goBtn = window.document.getElementById('wf-go');
  goBtn.click();
  await sleep(2600);
  const result = window.document.querySelector('.wbflow-result');
  assert(result, '品牌为空仍成功提交并渲染结果');
  assert(result.textContent.includes('1455302318'), '结果包含 nmID');
  const savedUser = savedSetConfig.filter((c) => c.currentUser).pop();
  assert(savedUser && savedUser.currentUser === '陈炜豪', '搬品提交时记忆当前账号（陈炜豪），下次搬品默认使用: ' + JSON.stringify(savedUser));

  console.log('== 11. 搬品请求体与账号头完整携带 ==');
  assert(capturedBody, '已捕获 /api/migrate 请求体');
  assert(capturedBody.mode === 'manual', 'mode=manual');
  assert(Number(capturedBody.subjectID) === 1557, '携带子类目 subjectID=1557（自行车装饰）');
  assert(!capturedBody.product.brand && !capturedBody.card.brand, '品牌为空且不强制');
  assert(capturedBody.product.images.length === 3, '携带全部主图(3张): ' + capturedBody.product.images.length);
  assert(capturedBody.product.images.every((u) => u.includes('/images/big/')), '主图均为 big 全尺寸');
  assert(Number(capturedBody.price) === 1999, '携带售价 1999');
  assert(Number(capturedBody.warehouseId) === 2096595, '携带默认仓库"我的仓库" 2096595');
  assert(capturedBody.useSourceImages === true, '启用源图上传');
  assert(capturedBody.card.dimensions && capturedBody.card.dimensions.length === 12
    && capturedBody.card.dimensions.width === 7 && capturedBody.card.dimensions.height === 5
    && capturedBody.card.dimensions.weightBrutto === 0.5, '携带自动提取的尺寸重量: ' + JSON.stringify(capturedBody.card.dimensions));
  assert(capturedBody.product.description.includes('Bluetooth-велокомпьютер'), '携带 Full Details 弹窗描述');

  console.log('== 11.5 请求头携带操作账号 ==');
  let capturedUserHeader = null;
  const origFetch2 = window.fetch;
  window.fetch = async (url, opts = {}) => {
    const path = String(url).replace(/^https?:\/\/[^/]+/, '');
    if (path.startsWith('/api/migrate')) capturedUserHeader = (opts.headers && opts.headers['X-WB-User']) || '';
    return origFetch2(url, opts);
  };
  const goBtn2 = window.document.getElementById('wf-go');
  goBtn2.click();
  await sleep(2600);
  assert(capturedUserHeader === encodeURIComponent('陈炜豪'), 'migrate 请求带 X-WB-User（当前账号陈炜豪）: ' + capturedUserHeader);

  console.log('\n[全部通过] 扩展 content.js 集成测试');
  console.log('\n== 12. 后端接口失败时的错误提示 ==');

  // 独立场景：parents 接口失败，不应静默显示空下拉
  const dom2 = new JSDOM('<!DOCTYPE html><html><head><title>t</title></head><body></body></html>', {
    url: 'https://www.wildberries.ru/catalog/999999/detail.aspx',
    runScripts: 'outside-only',
    pretendToBeVisual: true,
  });
  const w2 = dom2.window;
  w2.chrome = {
    runtime: {
      sendMessage: (msg, cb) => { if (cb) cb(msg.type === 'getConfig' ? { backendUrl: 'http://localhost:3000' } : { ok: true }); },
      onMessage: { addListener() {} },
    },
  };
  const failJson = (ok = false) => ({ ok, status: ok ? 200 : 500, json: async () => ({ error: 'boom' }) });
  w2.fetch = async (url) => {
    const path = String(url).replace(/^https?:\/\/[^/]+/, '');
    if (path === '/api/categories/parents') return failJson(false);
    if (path.startsWith('/api/warehouses')) return failJson(true);
    return failJson(false);
  };
  w2.eval(contentSrc);
  w2.document.querySelector('.wbflow-fab').click();
  await sleep(600);
  const errBox = w2.document.querySelector('.wbflow-error');
  assert(errBox, '接口失败时显示错误横幅');
  assert(errBox.textContent.includes('后端数据加载失败') && errBox.textContent.includes('npm start'), '错误提示包含"后端数据加载失败"与启动指引');
  const parentOpts = w2.document.getElementById('wf-parent');
  assert(parentOpts && parentOpts.options.length === 1, '父级下拉不再静默为空（有提示引导）');

  console.log('\n== 13. 站点默认标题识别（Интернет‑магазин Wildberries...） ==');

  // 独立场景：页面只有站点默认标题，无商品数据
  const dom3 = new JSDOM('<!DOCTYPE html><html><head>'
    + '<title>Интернет‑магазин Wildberries: широкий ассортимент товаров</title>'
    + '<meta property="og:title" content="Интернет‑магазин Wildberries: широкий ассортимент товаров">'
    + '</head><body><h1>Wildberries</h1></body></html>', {
    url: 'https://www.wildberries.ru/catalog/7777777/detail.aspx',
    runScripts: 'outside-only',
    pretendToBeVisual: true,
  });
  const w3 = dom3.window;
  w3.chrome = {
    runtime: {
      sendMessage: (msg, cb) => {
        if (cb) cb(msg.type === 'getConfig'
          ? { backendUrl: 'http://localhost:3000', currentUser: '罗世凯' }
          : (msg.type === 'ensureBackend' ? { ok: true, server: 'running' } : { ok: true }));
      },
      onMessage: { addListener() {} },
    },
  };
  const j3 = (d, ok = true) => ({ ok, status: ok ? 200 : 500, json: async () => d });
  w3.fetch = async (url) => {
    const path = String(url).replace(/^https?:\/\/[^/]+/, '');
    if (path === '/api/users') return j3({ users: [{ name: '罗世凯' }], current: '罗世凯' });
    if (path === '/api/categories/parents') return j3({ data: [{ id: 239, name: '体育用品' }] });
    if (path.startsWith('/api/warehouses')) return j3({ data: [{ id: 2096595, name: '我的仓库' }] });
    return j3({ error: 'unhandled' }, false);
  };
  w3.eval(contentSrc);
  w3.document.querySelector('.wbflow-fab').click();
  await sleep(3600); // 覆盖多轮重试（首次 + 1000ms + 2000ms）
  const t3 = w3.document.getElementById('wf-title');
  assert(t3, '站点默认标题页面仍渲染弹窗');
  assert(t3.value === '', '站点默认标题（Интернет‑магазин Wildberries...）被识别为无效，不填入商品标题: ' + JSON.stringify(t3.value));
  assert(t3.placeholder.includes('请填写商品标题'), '标题为空时输入框提示用户手动填写: ' + JSON.stringify(t3.placeholder));

  console.log('\n== 14. 标题在 data-e2e 元素中（无 JSON-LD / 无 h1） ==');

  // 独立场景：标题在 [data-e2e="product-title"] div 中，无 JSON-LD Product
  const dom4 = new JSDOM('<!DOCTYPE html><html><head>'
    + '<title>Увлажнитель воздуха для дома с аромадиффузором и подсветкой | WB</title>'
    + '<meta property="og:title" content="Интернет‑магазин Wildberries: широкий ассортимент товаров">'
    + '</head><body>'
    + '<div data-e2e="product-title">Увлажнитель воздуха для дома с аромадиффузором и подсветкой</div>'
    + '<span class="price-block__price">2 399 ₽</span>'
    + '</body></html>', {
    url: 'https://www.wildberries.ru/catalog/772590607/detail.aspx',
    runScripts: 'outside-only',
    pretendToBeVisual: true,
  });
  const w4 = dom4.window;
  w4.chrome = {
    runtime: {
      sendMessage: (msg, cb) => {
        if (cb) cb(msg.type === 'getConfig'
          ? { backendUrl: 'http://localhost:3000', currentUser: '罗世凯' }
          : (msg.type === 'ensureBackend' ? { ok: true, server: 'running' } : { ok: true }));
      },
      getManifest: () => ({ version: '1.1.2' }),
      onMessage: { addListener() {} },
    },
  };
  const j4 = (d, ok = true) => ({ ok, status: ok ? 200 : 500, json: async () => d });
  w4.fetch = async (url) => {
    const path = String(url).replace(/^https?:\/\/[^/]+/, '');
    if (path === '/api/version') return j4({ name: 'wbflow', version: '1.1.2' });
    if (path === '/api/users') return j4({ users: [{ name: '罗世凯' }], current: '罗世凯' });
    if (path === '/api/categories/parents') return j4({ data: [{ id: 239, name: '体育用品' }] });
    if (path.startsWith('/api/warehouses')) return j4({ data: [{ id: 2096595, name: '我的仓库' }] });
    return j4({ error: 'unhandled' }, false);
  };
  w4.eval(contentSrc);
  w4.document.querySelector('.wbflow-fab').click();
  await sleep(600);
  const t4 = w4.document.getElementById('wf-title');
  assert(t4 && t4.value === 'Увлажнитель воздуха для дома с аромадиффузором и подсветкой',
    '标题从 [data-e2e="product-title"] 提取成功（未被站点默认 og:title 干扰）: ' + JSON.stringify(t4 && t4.value));

  console.log('\n== 15. 类目路径提取（DOM 面包屑，用户反馈的加湿器页面形态） ==');

  // 独立场景：无 JSON-LD BreadcrumbList，面包屑在 [data-e2e="breadcrumbs"] DOM 中
  const dom5 = new JSDOM('<!DOCTYPE html><html><head>'
    + '<title>Увлажнитель воздуха | WB</title>'
    + '</head><body>'
    + '<nav data-e2e="breadcrumbs">'
    + '<a href="/catalog/bytovaya-tehnika">Бытовая техника</a>'
    + '<a href="/catalog/klimaticheskaya-tehnika">Климатическая техника</a>'
    + '<a href="/catalog/uvlazhniteli">Увлажнители и очистители воздуха</a>'
    + '</nav>'
    + '<h1 itemprop="name">Увлажнитель воздуха для дома с аромадиффузором и подсветкой</h1>'
    + '</body></html>', {
    url: 'https://www.wildberries.ru/catalog/772590607/detail.aspx',
    runScripts: 'outside-only',
    pretendToBeVisual: true,
  });
  const w5 = dom5.window;
  w5.chrome = {
    runtime: {
      sendMessage: (msg, cb) => {
        if (cb) cb(msg.type === 'getConfig'
          ? { backendUrl: 'http://localhost:3000', currentUser: '罗世凯' }
          : (msg.type === 'ensureBackend' ? { ok: true, server: 'running' } : { ok: true }));
      },
      getManifest: () => ({ version: '1.1.3' }),
      onMessage: { addListener() {} },
    },
  };
  const j5 = (d, ok = true) => ({ ok, status: ok ? 200 : 500, json: async () => d });
  w5.fetch = async (url) => {
    const path = String(url).replace(/^https?:\/\/[^/]+/, '');
    if (path === '/api/version') return j5({ name: 'wbflow', version: '1.1.3' });
    if (path === '/api/users') return j5({ users: [{ name: '罗世凯' }], current: '罗世凯' });
    if (path === '/api/categories/parents') return j5({ data: [{ id: 239, name: '体育用品' }] });
    if (path.startsWith('/api/warehouses')) return j5({ data: [{ id: 2096595, name: '我的仓库' }] });
    return j5({ error: 'unhandled' }, false);
  };
  w5.eval(contentSrc);
  w5.document.querySelector('.wbflow-fab').click();
  await sleep(700);
  const body5 = w5.document.querySelector('.wbflow-modal-body').textContent;
  assert(body5.includes('Бытовая техника') && body5.includes('Увлажнители и очистители воздуха'),
    'DOM 面包屑提取为类目路径（Бытовая техника / ... / Увлажнители и очистители воздуха）');
  const t5 = w5.document.getElementById('wf-title');
  assert(t5 && t5.value === 'Увлажнитель воздуха для дома с аромадиффузором и подсветкой', '标题同时正常提取: ' + JSON.stringify(t5 && t5.value));

  console.log('\n[全部通过] 扩展 content.js 集成测试（含失败与降级场景）');
  process.exit(0);
})().catch((e) => { console.error('[失败]', e.message); process.exit(1); });
