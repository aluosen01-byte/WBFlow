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
  <title>Наушники Bluetooth TWS — купить по цене 1299 ₽ | WB</title>
  <meta property="og:title" content="Беспроводные наушники TWS черные">
  <meta property="og:description" content="Bluetooth 5.3, шумоподавление, 30ч работы">
  <meta property="og:image" content="https://basket-01.wbbasket.ru/vol1455/part145530/1455302318/images/c516x688/1.webp">
  <script type="application/ld+json">
  {"@context":"https://schema.org","@type":"Product",
   "name":"Беспроводные наушники TWS черные",
   "description":"Bluetooth 5.3, активное шумоподавление, до 30 часов работы",
   "brand":{"@type":"Brand","name":"SoundCore"},
   "sku":"1455302318",
   "image":["https://basket-01.wbbasket.ru/vol1455/part145530/1455302318/images/c516x688/1.webp",
            "https://basket-01.wbbasket.ru/vol1455/part145530/1455302318/images/c516x688/2.webp",
            "https://basket-01.wbbasket.ru/vol1455/part145530/1455302318/images/c516x688/3.webp"],
   "offers":{"@type":"Offer","price":"1299","priceCurrency":"RUB"},
   "additionalProperty":[{"@type":"PropertyValue","name":"Цвет","value":"черный"},
                          {"@type":"PropertyValue","name":"Материал","value":"пластик"}]}
  </script>
  <script type="application/ld+json">
  {"@context":"https://schema.org","@type":"BreadcrumbList","itemListElement":[
    {"@type":"ListItem","position":1,"item":{"@id":"/catalog/elektronika","name":"Электроника"}},
    {"@type":"ListItem","position":2,"item":{"@id":"/catalog/aksessuary","name":"Аксессуары"}},
    {"@type":"ListItem","position":3,"item":{"@id":"/catalog/1455302318","name":"Наушники"}}]}
  </script>
</head><body>
  <h1 itemprop="name">Беспроводные наушники TWS черные</h1>
  <a data-link="/brands/SoundCore">SoundCore</a>
  <span class="price-block__price">1 299 ₽</span>
  <div class="swiper-wrapper">
    <img src="https://basket-01.wbbasket.ru/vol1455/part145530/1455302318/images/tm/1.webp">
    <img src="https://basket-01.wbbasket.ru/vol1455/part145530/1455302318/images/tm/2.webp">
  </div>
</body></html>`;

const dom = new JSDOM(pageHtml, {
  url: 'https://www.wildberries.ru/catalog/1455302318/detail.aspx?targetUrl=MI',
  runScripts: 'outside-only',
  pretendToBeVisual: true,
});
const { window } = dom;

// ---- 存根 chrome.runtime：配置含记忆类目 lastSubjectId=2187 ----
window.chrome = {
  runtime: {
    sendMessage: (msg, cb) => {
      const res = msg.type === 'getConfig' ? {
        backendUrl: 'http://localhost:3000', priceMode: 'manual', priceMultiplier: 1.5,
        stock: 5, warehouseId: '', defaultBrand: '', lastParentId: '479', lastSubjectId: '2187',
      } : { ok: true };
      if (cb) cb(res);
    },
    onMessage: { addListener() {} },
  },
};

// ---- 存根 fetch（模拟后端） ----
const json = (data, ok = true) => ({ ok, status: ok ? 200 : 500, json: async () => data });
window.fetch = async (url, opts = {}) => {
  const path = String(url).replace(/^https?:\/\/[^/]+/, '');
  if (path === '/api/categories/parents') return json({ data: [{ id: 479, name: '电子配件' }, { id: 7, name: 'Игрушки' }] });
  if (path.startsWith('/api/warehouses')) return json({ data: [{ id: 999, name: '备用仓' }, { id: 2096595, name: '我的仓库' }] });
  if (path.startsWith('/api/categories?limit=500')) return json({
    data: [
      { subjectID: 2187, parentID: 479, subjectName: 'USB数据线' },
      { subjectID: 2191, parentID: 479, subjectName: '蓝牙耳机' },
      { subjectID: 1152, parentID: 858, subjectName: '3D打印机' },
    ],
  });
  if (path.startsWith('/api/categories?parentID=')) return json({
    data: path.includes('479')
      ? [{ subjectID: 2187, parentID: 479, subjectName: 'USB数据线' }, { subjectID: 2191, parentID: 479, subjectName: '蓝牙耳机' }]
      : [{ subjectID: 1152, parentID: 858, subjectName: '3D打印机' }],
  });
  if (path.startsWith('/api/categories/2187/characteristics')) return json({
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
  assert(title.value === 'Беспроводные наушники TWS черные', '标题来自 JSON-LD');
  const brand = window.document.getElementById('wf-brand');
  assert(brand.value === 'SoundCore', '品牌来自 JSON-LD');
  const price = window.document.getElementById('wf-price');
  assert(price.value === '1299', '售价自动带出源价格: ' + price.value);

  console.log('== 3. 全部主图提取 + 尺寸归一化 ==');
  const images = window.document.getElementById('wf-images');
  const imgList = images.value.split('\n').filter(Boolean);
  assert(imgList.length >= 3, '主图 >= 3 张（JSON-LD 3 图 + og + DOM 去重后）: ' + imgList.length);
  const allBig = imgList.every((u) => u.includes('/images/big/'));
  assert(allBig, '所有图片 URL 归一化为 big 尺寸');
  const unique = new Set(imgList).size === imgList.length;
  assert(unique, '图片去重（不同尺寸段合并）');

  console.log('== 4. 源类目包屑 ==');
  const crumbsText = window.document.querySelector('.wbflow-modal-body').textContent;
  assert(crumbsText.includes('Электроника') && crumbsText.includes('Аксессуары'), '源商品类目包屑已展示');

  console.log('== 5. 仓库默认"我的仓库" ==');
  const warehouseSel = window.document.getElementById('wf-warehouse');
  const picked = warehouseSel.options[warehouseSel.selectedIndex];
  assert(picked && picked.value === '2096595', '仓库自动选中"我的仓库"(2096595): ' + (picked ? picked.text : '无'));

  console.log('== 6. 类目记忆自动选中 ==');
  await sleep(700); // 等待 autoSelectSubject 的异步级联
  const parentSel = window.document.getElementById('wf-parent');
  const subjectSel = window.document.getElementById('wf-subject');
  assert(String(parentSel.value) === '479', '父级类目自动选中 479: ' + parentSel.value);
  assert(String(subjectSel.value) === '2187', '子类目自动选中 2187: ' + subjectSel.value);
  const charItems = window.document.querySelectorAll('.wbflow-char');
  assert(charItems.length === 3, '特性表单已自动加载: ' + charItems.length);
  const weightItem = [...charItems].find((i) => i.textContent.includes('带包装重量'));
  assert(weightItem && !weightItem.querySelector('input'), '重量特性自动映射（无输入框）');

  console.log('== 7. 提交搬品 ==');
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
  assert(result, '任务结果已渲染');
  assert(result.textContent.includes('1455302318'), '结果包含 nmID');

  console.log('== 8. 搬品请求体完整携带 ==');
  assert(capturedBody, '已捕获 /api/migrate 请求体');
  assert(capturedBody.mode === 'manual', 'mode=manual');
  assert(Number(capturedBody.subjectID) === 2187, '携带子类目 subjectID=2187');
  assert(capturedBody.product.images.length === 3, '携带全部主图(3张): ' + capturedBody.product.images.length);
  assert(capturedBody.product.images.every((u) => u.includes('/images/big/')), '主图均为 big 全尺寸');
  assert(Number(capturedBody.price) === 1299, '携带售价 1299');
  assert(Number(capturedBody.warehouseId) === 2096595, '携带默认仓库"我的仓库" 2096595');
  assert(capturedBody.useSourceImages === true, '启用源图上传');

  console.log('\n[全部通过] 扩展 content.js 集成测试');
  process.exit(0);
})().catch((e) => { console.error('[失败]', e.message); process.exit(1); });
