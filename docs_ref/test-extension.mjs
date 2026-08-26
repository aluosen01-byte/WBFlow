/**
 * 扩展 content.js 集成测试（jsdom）：
 * 模拟 WB 商品页 DOM + 存根 chrome/fetch，验证：
 *  1. 注入悬浮按钮
 *  2. 多层提取器提取商品（JSON-LD / meta / DOM / __NUXT__）
 *  3. 弹窗渲染与价格策略
 *  4. 提交搬品并渲染结果
 */
import fs from 'node:fs';
import { JSDOM } from 'jsdom';

const contentSrc = fs.readFileSync('D:/projects/WBFlow/wbflow-extension/content.js', 'utf8');

// 模拟 WB 商品页：JSON-LD Product + og meta + DOM 元素
const pageHtml = `<!DOCTYPE html><html><head>
  <title>Наушники Bluetooth TWS — купить по цене 1299 ₽ | WB</title>
  <meta property="og:title" content="Беспроводные наушники TWS черные">
  <meta property="og:description" content="Bluetooth 5.3, шумоподавление, 30ч работы">
  <meta property="og:image" content="https://basket-01.wbbasket.ru/vol1455/part145530/1455302318/images/big/1.webp">
  <script type="application/ld+json">
  {"@context":"https://schema.org","@type":"Product",
   "name":"Беспроводные наушники TWS черные",
   "description":"Bluetooth 5.3, активное шумоподавление, до 30 часов работы",
   "brand":{"@type":"Brand","name":"SoundCore"},
   "sku":"1455302318",
   "image":["https://basket-01.wbbasket.ru/vol1455/part145530/1455302318/images/big/1.webp",
            "https://basket-01.wbbasket.ru/vol1455/part145530/1455302318/images/big/2.webp"],
   "offers":{"@type":"Offer","price":"1299","priceCurrency":"RUB"},
   "additionalProperty":[{"@type":"PropertyValue","name":"Цвет","value":"черный"},
                          {"@type":"PropertyValue","name":"Материал","value":"пластик"}]}
  </script>
</head><body>
  <h1 itemprop="name">Беспроводные наушники TWS черные</h1>
  <a data-link="/brands/SoundCore">SoundCore</a>
  <span class="price-block__price">1 299 ₽</span>
  <div class="swiper-wrapper"><img src="https://basket-01.wbbasket.ru/vol1455/part145530/1455302318/images/c516x688/1.webp"></div>
</body></html>`;

const dom = new JSDOM(pageHtml, {
  url: 'https://www.wildberries.ru/catalog/1455302318/detail.aspx?targetUrl=MI',
  runScripts: 'outside-only',
  pretendToBeVisual: true,
});
const { window } = dom;

// ---- 存根 chrome.runtime ----
window.chrome = {
  runtime: {
    sendMessage: (msg, cb) => {
      if (msg.type === 'getConfig') cb({ backendUrl: 'http://localhost:3000', priceMode: 'manual', priceMultiplier: 1.5, stock: 5, warehouseId: '2096595', defaultBrand: '' });
    },
    onMessage: { addListener() {} },
  },
};

// ---- 存根 fetch（模拟后端） ----
const json = (data, ok = true) => ({ ok, status: ok ? 200 : 500, json: async () => data });
window.fetch = async (url, opts = {}) => {
  const path = String(url).replace(/^https?:\/\/[^/]+/, '');
  if (path === '/api/categories/parents') return json({ data: [{ id: 479, name: '电子配件' }, { id: 7, name: 'Игрушки' }] });
  if (path.startsWith('/api/warehouses')) return json({ data: [{ id: 2096595, name: '我的仓库' }] });
  if (path.startsWith('/api/categories?parentID=')) return json({ data: [{ subjectID: 2187, parentID: 479, subjectName: 'USB数据线' }, { subjectID: 2191, parentID: 479, subjectName: '蓝牙耳机' }] });
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
        { name: '下载图片', status: 'success', message: '2/2' },
        { name: '创建商品卡片', status: 'success', message: 'ok' },
        { name: '上传图片', status: 'success', message: '2/2' },
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

const assert = (cond, msg) => { if (!cond) throw new Error('断言失败: ' + msg); console.log('  ✓', msg); };

(async () => {
  console.log('== 1. 悬浮按钮注入 ==');
  const fab = window.document.querySelector('.wbflow-fab');
  assert(fab, '页面注入 .wbflow-fab 按钮');
  assert(fab.textContent.includes('一键搬品'), '按钮文案正确');

  console.log('== 2. 打开弹窗（触发提取 + 渲染） ==');
  fab.click();
  await new Promise((r) => setTimeout(r, 300)); // 等待 async 渲染

  const title = window.document.getElementById('wf-title');
  assert(title, '弹窗已渲染');
  assert(title.value === 'Беспроводные наушники TWS черные', '标题来自 JSON-LD: ' + title.value);
  const brand = window.document.getElementById('wf-brand');
  assert(brand.value === 'SoundCore', '品牌来自 JSON-LD');
  const price = window.document.getElementById('wf-price');
  assert(price.value === '1299', '价格来自 JSON-LD offers: ' + price.value);
  const images = window.document.getElementById('wf-images');
  const imgList = images.value.split('\n').filter(Boolean);
  assert(imgList.length >= 2, '图片提取 >= 2 张（JSON-LD + og 去重）: ' + imgList.length);

  console.log('== 3. 类目选择与特性渲染 ==');
  const parentSel = window.document.getElementById('wf-parent');
  parentSel.value = '479';
  parentSel.dispatchEvent(new window.Event('change'));
  await new Promise((r) => setTimeout(r, 100));
  const subjectSel = window.document.getElementById('wf-subject');
  assert(subjectSel.options.length >= 2, '子类目已加载: ' + subjectSel.options.length + ' 项');
  subjectSel.value = '2187';
  subjectSel.dispatchEvent(new window.Event('change'));
  await new Promise((r) => setTimeout(r, 100));
  const charItems = window.document.querySelectorAll('.wbflow-char');
  assert(charItems.length === 3, '特性表单渲染 3 项: ' + charItems.length);
  // 重量特性应无输入框（自动映射提示）
  const weightItem = [...charItems].find((i) => i.textContent.includes('带包装重量'));
  assert(weightItem && !weightItem.querySelector('input'), '重量特性无输入框（自动映射）');
  const colorInput = [...charItems].find((i) => i.textContent.includes('颜色')).querySelector('input');
  assert(colorInput && colorInput.value.includes('черный'), '颜色特性从 additionalProperty 自动预填: ' + colorInput.value);

  console.log('== 4. 提交搬品 ==');
  const goBtn = window.document.getElementById('wf-go');
  goBtn.click();
  await new Promise((r) => setTimeout(r, 2600)); // 等待提交 + 首次轮询(2s间隔)
  const result = window.document.querySelector('.wbflow-result');
  assert(result, '任务结果已渲染');
  assert(result.textContent.includes('1455302318'), '结果包含 nmID');
  const status = window.document.getElementById('wf-status');
  assert(status.textContent.includes('成功'), '状态显示成功');

  console.log('\n✅ 扩展 content.js 集成测试全部通过');
  process.exit(0);
})().catch((e) => { console.error('❌', e.message); process.exit(1); });
