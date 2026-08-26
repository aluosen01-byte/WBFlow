// Try multiple strategies to obtain a real WB product page sample
const nmId = '1455302318';
const url = `https://www.wildberries.ru/catalog/${nmId}/detail.aspx`;

const chromeUA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0.0.0 Safari/537.36';
const fullHeaders = {
  'User-Agent': chromeUA,
  'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,image/apng,*/*;q=0.8,application/signed-exchange;v=b3;q=0.7',
  'Accept-Language': 'ru-RU,ru;q=0.9,en;q=0.8',
  'Sec-Ch-Ua': '"Chromium";v="125", "Google Chrome";v="125", "Not.A/Brand";v="24"',
  'Sec-Ch-Ua-Mobile': '?0',
  'Sec-Ch-Ua-Platform': '"Windows"',
  'Sec-Fetch-Dest': 'document',
  'Sec-Fetch-Mode': 'navigate',
  'Sec-Fetch-Site': 'none',
  'Sec-Fetch-User': '?1',
  'Upgrade-Insecure-Requests': '1',
  'Accept-Encoding': 'gzip, deflate, br',
};

async function tryFetch(name, u, headers) {
  try {
    const r = await fetch(u, { headers, redirect: 'follow' });
    const t = await r.text();
    return { name, status: r.status, len: t.length, html: t };
  } catch (e) {
    return { name, err: e.cause?.code || e.message };
  }
}

const results = [];
// 1. full browser headers
results.push(await tryFetch('full-headers', url, fullHeaders));
// 2. jina reader with html return
try {
  const r = await fetch(`https://r.jina.ai/${url}`, { headers: { 'x-respond-with': 'html', 'User-Agent': chromeUA } });
  const t = await r.text();
  results.push({ name: 'jina-html', status: r.status, len: t.length, html: t });
} catch (e) { results.push({ name: 'jina-html', err: e.cause?.code || e.message }); }

for (const res of results) {
  console.log(res.name, '->', res.status || 'ERR', res.err || `len=${res.len}`);
  if (res.html && res.html.length > 10000 && res.status === 200) {
    require('fs').writeFileSync('D:/projects/WBFlow/docs_ref/wb-page-real.html', res.html);
    console.log('  saved to docs_ref/wb-page-real.html');
    console.log('  has __NUXT__:', res.html.includes('__NUXT__'), '| has json-ld:', res.html.includes('application/ld+json'));
    const m = res.html.match(/<title>([^<]*)<\/title>/);
    console.log('  title:', m && m[1]);
    break;
  }
}
