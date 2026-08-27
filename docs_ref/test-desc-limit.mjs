// parseDescLimit 单元测试
import { parseDescLimit } from '../server/migrateService.js';

const cases = [
  ['В категории Бытовая техника/Ароматизаторы воздуха электрические разрешается указывать не более 2000 символов в поле Описание', 2000],
  ['не более 5000 символов в поле Описание', 5000],
  ['не более 1000 символов', 1000],
  ['не более 300 символов', null],
  ['просто ошибка', null],
];
let pass = 0;
for (const [text, expect] of cases) {
  const got = parseDescLimit(text);
  const ok = got === expect;
  if (ok) pass++;
  console.log(`${ok ? 'OK  ' : 'FAIL'} | ${text.slice(0, 55)} -> ${got} (期望 ${expect})`);
}
console.log(`${pass}/${cases.length} 通过`);
process.exit(pass === cases.length ? 0 : 1);
