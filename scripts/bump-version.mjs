/**
 * 版本号递增脚本：每次代码修改后运行 `npm run bump`，版本号 +1。
 * 以 package.json 的 version 为唯一版本源，同步更新扩展 manifest.json 的 version。
 * 版本格式 x.y.z，每次递增 z（补丁号）；如需主/次版本升级可手动改 package.json。
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..');
const PKG = path.join(ROOT, 'package.json');
const MANIFEST = path.join(ROOT, 'wbflow-extension', 'manifest.json');

const pkg = JSON.parse(fs.readFileSync(PKG, 'utf8'));
const cur = pkg.version || '0.0.0';
const parts = cur.split('.').map((n) => parseInt(n, 10) || 0);
while (parts.length < 3) parts.push(0);
parts[2] += 1; // 补丁号 +1
const next = parts.join('.');

pkg.version = next;
fs.writeFileSync(PKG, JSON.stringify(pkg, null, 2) + '\n');

if (fs.existsSync(MANIFEST)) {
  const manifest = JSON.parse(fs.readFileSync(MANIFEST, 'utf8'));
  manifest.version = next;
  fs.writeFileSync(MANIFEST, JSON.stringify(manifest, null, 2) + '\n');
  console.log(`已同步扩展 manifest.json version -> ${next}`);
}

console.log(`版本号已递增：${cur} -> ${next}`);
