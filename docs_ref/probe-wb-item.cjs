// Probe WB product page structure (dev tool, not part of the app)
const fs = require('fs');
const url = process.argv[2] || 'https://www.wildberries.ru/catalog/5870243/detail.aspx';
(async () => {
  try {
    const r = await fetch(url, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0 Safari/537.36',
        'Accept-Language': 'zh-CN,zh;q=0.9,ru;q=0.8',
      },
    });
    const t = await r.text();
    console.log('status', r.status, 'len', t.length);
    console.log('__NUXT__ idx:', t.indexOf('__NUXT__'));
    console.log('json-ld idx:', t.indexOf('application/ld+json'));
    const m = t.match(/<title>([^<]*)<\/title>/);
    console.log('TITLE:', m && m[1]);
    const og = t.match(/property="og:image" content="([^"]+)"/);
    console.log('OG IMAGE:', og && og[1]);
    fs.writeFileSync('D:/projects/WBFlow/docs_ref/wb-item-sample.html', t);
  } catch (e) {
    console.log('ERR', e.cause && e.cause.code || e.message);
  }
})();
