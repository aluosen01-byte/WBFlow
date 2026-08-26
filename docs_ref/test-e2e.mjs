// Final E2E test: exactly mirrors what the frontend sends in runMigrate()
const body = {
  mode: 'manual',
  product: {
    title: 'USB数据线 前台契约测试',
    brand: 'TP-link',
    description: '前台契约验证：完整模拟前端发送结构。',
    price: 89,
    images: ['https://httpbin.org/image/png'],
  },
  subjectID: 2187,
  card: {
    vendorCode: undefined,
    brand: 'TP-link',
    title: undefined,
    description: undefined,
  },
  characteristics: [{ charcId: 90735, values: 150 }],
  price: 89,
  discount: 0,
  sizes: [],
  warehouseId: 2096595,
  stock: 3,
  useSourceImages: true,
};

const res = await fetch('http://localhost:3000/api/migrate', {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify(body),
});
const j = await res.json();
console.log('submit:', JSON.stringify(j));

const taskId = j.taskId;
let last = '';
for (let i = 0; i < 150; i++) {
  await new Promise((r) => setTimeout(r, 4000));
  const t = await (await fetch(`http://localhost:3000/api/tasks/${taskId}`)).json();
  const line = t.task.steps
    .map((s) => `${s.name}:${s.status === 'success' ? '✓' : s.status === 'failed' ? '✗' : s.status === 'skipped' ? '–' : '…'}${s.message ? '(' + s.message.slice(0, 50) + ')' : ''}`)
    .join(' ');
  if (line !== last) { console.log(`[${i * 4}s]`, line); last = line; }
  if (t.task.status !== 'running') {
    console.log('FINAL:', t.task.status, '| result:', JSON.stringify(t.task.result), '| error:', t.task.error);
    break;
  }
}
