// Quick analyzer for the extracted WB spec: prints key endpoint info
import fs from 'node:fs';

const [, , specFile, ...filters] = process.argv;
const spec = JSON.parse(fs.readFileSync(specFile, 'utf8'));

console.log('INFO:', spec.info.title, '| version:', spec.info.version);
console.log('SERVERS:', JSON.stringify(spec.servers));
console.log('SECURITY:', JSON.stringify(spec.security));
console.log('SECURITY SCHEMES:', JSON.stringify(spec.components?.securitySchemes));
console.log('TAGS:', (spec.tags || []).map(t => t.name).join(', '));
console.log('========================================');

const paths = spec.paths || {};
for (const [path, ops] of Object.entries(paths)) {
  if (filters.length && !filters.some(f => path.includes(f))) continue;
  for (const [method, op] of Object.entries(ops)) {
    if (!['get', 'post', 'put', 'patch', 'delete'].includes(method)) continue;
    console.log(`\n### ${method.toUpperCase()} ${path}`);
    console.log('   summary:', op.summary || '');
    console.log('   operationId:', op.operationId || '');
    if (op.parameters?.length) {
      console.log('   params:', op.parameters.map(p => `${p.name} (${p.in}${p.required ? ', req' : ''})`).join(', '));
    }
    const rb = op.requestBody;
    if (rb) {
      const content = rb.content || {};
      const json = content['application/json'];
      const schema = json?.schema;
      const ex = json?.example ?? rb.example;
      const brief = schema?.$ref
        ? `$ref ${schema.$ref.split('/').pop()}`
        : schema ? `inline (${JSON.stringify(schema).slice(0, 120)})` : '?';
      console.log('   requestBody:', brief);
      if (ex !== undefined) console.log('   requestBody example:', JSON.stringify(ex).slice(0, 300));
    }
    const resp200 = op.responses?.['200'];
    if (resp200) {
      const content = resp200.content || {};
      const json = content['application/json'];
      const schema = json?.schema;
      const ex = json?.example ?? resp200.example;
      const brief = schema?.$ref
        ? `$ref ${schema.$ref.split('/').pop()}`
        : schema ? `inline (${JSON.stringify(schema).slice(0, 120)})` : '?';
      console.log('   resp200:', brief);
      if (ex !== undefined) console.log('   resp200 example:', JSON.stringify(ex).slice(0, 400));
    }
  }
}
