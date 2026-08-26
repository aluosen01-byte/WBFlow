const spec = require('./work-with-products.spec.json');

function deref(ref) {
  const parts = ref.replace('#/', '').split('/');
  let node = spec;
  for (const p of parts) node = node[p];
  return node;
}

for (const [p, ops] of Object.entries(spec.paths)) {
  if (!p.startsWith('/api/v2/upload') && p !== '/api/v2/history/tasks' && p !== '/api/v2/history/goods/task') continue;
  for (const [m, op] of Object.entries(ops)) {
    if (!['get', 'post'].includes(m)) continue;
    console.log('=== ' + m.toUpperCase() + ' ' + p);
    for (const prm of op.parameters || []) {
      const pr = prm.$ref ? deref(prm.$ref) : prm;
      console.log('  param:', pr.name, pr.in, 'required=' + pr.required, JSON.stringify(pr.schema || {}));
    }
    const rb = op.requestBody;
    if (rb) {
      const body = rb.$ref ? deref(rb.$ref) : rb;
      const schema = (body.content && body.content['application/json'] && body.content['application/json'].schema) || {};
      if (schema.$ref) {
        const s = deref(schema.$ref);
        console.log('  body schema ref:', schema.$ref);
        console.log('  Items:', JSON.stringify(s).slice(0, 1800));
      } else {
        console.log('  body schema:', JSON.stringify(schema).slice(0, 900));
      }
      const ex = (body.content && body.content['application/json'] && body.content['application/json'].example) || body.example;
      if (ex) console.log('  example:', JSON.stringify(ex).slice(0, 500));
    }
    const r200 = op.responses && op.responses['200'];
    if (r200 && r200.content && r200.content['application/json']) {
      const ex = r200.content['application/json'].example;
      if (ex) console.log('  resp example:', JSON.stringify(ex).slice(0, 500));
    }
    console.log();
  }
}
