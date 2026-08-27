// 查询 WB 类目树中"体育用品 / 自行车装饰"
const base = 'http://localhost:3000';
async function jget(path) {
  const r = await fetch(base + path);
  return r.json();
}

const j1 = await jget('/api/categories/parents');
const sports = (j1.data || []).filter((p) => /体育|спорт/i.test(p.name));
console.log('体育类父类目:', JSON.stringify(sports));

for (const s of sports) {
  const j2 = await jget('/api/categories?parentID=' + s.id);
  const subs = (j2.data || []).filter((x) => /自行车|вело/i.test(x.subjectName));
  console.log(`父类目[${s.id} ${s.name}] 自行车相关子类目:`, JSON.stringify(subs));
}

const j3 = await jget('/api/categories?name=' + encodeURIComponent('自行车') + '&limit=100');
console.log('name=自行车 搜索:', JSON.stringify((j3.data || []).slice(0, 10)));

// 也查"装饰"相关
const j4 = await jget('/api/categories?name=' + encodeURIComponent('装饰') + '&limit=100');
console.log('name=装饰 搜索:', JSON.stringify((j4.data || []).slice(0, 10)));
