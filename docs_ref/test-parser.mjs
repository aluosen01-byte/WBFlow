// Test generic source parser with JSON-LD fixture
const html = `<!DOCTYPE html><html><head>
    <title>测试商品 - 智能保温杯</title>
    <meta property="og:title" content="智能保温杯 500ml">
    <meta property="og:description" content="不锈钢内胆，保温12小时">
    <meta property="og:image" content="https://example.com/img/1.jpg">
    <script type="application/ld+json">{
      "@context": "https://schema.org",
      "@type": "Product",
      "name": "智能保温杯 500ml 黑色",
      "description": "316不锈钢内胆，保温12小时，智能显示水温",
      "brand": {"@type": "Brand", "name": "ThermoPro"},
      "sku": "TP-CUP-500",
      "offers": {"@type": "Offer", "price": "89.90", "priceCurrency": "CNY"},
      "image": ["https://example.com/img/1.jpg", "https://example.com/img/2.jpg"]
    }</script>
  </head><body></body></html>`;

const res = await fetch('http://localhost:3000/api/source/parse', {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({ url: 'https://shop.example.com/product/123', html }),
});
console.log(JSON.stringify((await res.json()).product, null, 1));
