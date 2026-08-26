// 实测：空品牌建卡是否可行
const token = require('fs').readFileSync('D:/projects/WBFlow/.env', 'utf8').match(/WB_TOKEN=(.+)/)[1].trim();
const vc = 'wbtest-nobrand-' + Date.now().toString(36);

const payload = [{
  subjectID: 2187,
  variants: [{
    vendorCode: vc,
    title: '无品牌测试 数据线',
    description: '测试空品牌建卡行为。',
    kizMarked: false,
    characteristics: [{ id: 90735, value: 100 }],
  }],
}];

(async () => {
  const r = await fetch('https://content-api.wildberries.cn/content/v2/cards/upload', {
    method: 'POST',
    headers: { Authorization: token, 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  });
  console.log('upload status:', r.status, (await r.text()).slice(0, 400));

  // 等几秒后查错误列表确认
  await new Promise((res) => setTimeout(res, 4000));
  const r2 = await fetch('https://content-api.wildberries.cn/content/v2/cards/error/list?locale=zh', {
    method: 'POST',
    headers: { Authorization: token, 'Content-Type': 'application/json' },
    body: JSON.stringify({ cursor: { limit: 50 }, order: { ascending: true } }),
  });
  const j2 = await r2.json();
  const items = (j2.data?.items || []).filter((i) => i.vendorCodes?.includes(vc));
  console.log('errors for vendorCode:', JSON.stringify(items).slice(0, 400) || '无错误记录');

  // 查卡片是否创建
  const r3 = await fetch('https://content-api.wildberries.cn/content/v2/get/cards/list?locale=zh', {
    method: 'POST',
    headers: { Authorization: token, 'Content-Type': 'application/json' },
    body: JSON.stringify({ settings: { sort: { ascending: false }, filter: { textSearch: vc, allowedCategoriesOnly: true }, cursor: { limit: 10 } } }),
  });
  const j3 = await r3.json();
  const cards = (j3.cards || []).filter((c) => c.vendorCode === vc);
  console.log('cards:', cards.length ? JSON.stringify({ nmID: cards[0].nmID, brand: cards[0].brand, title: cards[0].title }) : '未找到');
})();
