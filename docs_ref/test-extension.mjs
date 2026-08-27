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
window.chrome = {
  runtime: {
    sendMessage: (msg, cb) => {
      const res = msg.type === 'getConfig' ? {
        backendUrl: 'http://localhost:3000', priceMode: 'manual', priceMultiplier: 1.5,
        stock: 5, warehouseId: '', defaultBrand: '',
        lastParentId: '', lastSubjectId: '',
        categoryMap: {},
      } : (msg.type === 'ensureBackend' ? { ok: true, server: 'running' } : { ok: true });
      if (cb) cb(res);
    },
    onMessage: { addListener() {} },
  },
};

// ---- 存根 fetch（模拟后端，含 体育用品/239 → 自行车装饰/1557） ----
const json = (data, ok = true) => ({ ok, status: ok ? 200 : 500, json: async () => data });
window.fetch = async (url, opts = {}) => {
  const path = String(url).replace(/^https?:\/\/[^/]+/, '');
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

  console.log('== 9. 品牌非必填 ==');
  const brandInput = window.document.getElementById('wf-brand');
  assert(brandInput && !brandInput.closest('label').textContent.includes('*'), '品牌标签无必填星号');
  brandInput.value = ''; // 清空品牌

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

  console.log('== 11. 搬品请求体完整携带 ==');
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

  console.log('\n[全部通过] 扩展 content.js 集成测试（含失败场景）');
  process.exit(0);
})().catch((e) => { console.error('[失败]', e.message); process.exit(1); });
