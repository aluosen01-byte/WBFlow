/**
 * 打包脚本：npm run package
 * 1. 将 wbflow-extension/ 打包为 dist/wbflow-extension-v1.0.0.zip（排除本机生成物）
 * 2. 自动解压覆盖 dist/wbflow-extension/（Chrome 加载扩展所用的目录，免手动解压）
 * 3. 将整个项目打包为 dist/wbflow-project-v1.0.0.zip（排除 .env/node_modules/data/.git 等）
 * 依赖系统 tar（Windows 10+ / macOS / Linux 自带 bsdtar）。
 */
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const DIST = path.join(ROOT, 'dist');
const EXT_SRC = path.join(ROOT, 'wbflow-extension');
const EXT_ZIP = path.join(DIST, 'wbflow-extension-v1.0.0.zip');
const EXT_DIR = path.join(DIST, 'wbflow-extension');   // Chrome 加载扩展的解压目录
const PROJ_ZIP = path.join(DIST, 'wbflow-project-v1.0.0.zip');
const STAGE = path.join(ROOT, 'node_modules', '.cache', 'wbflow-package'); // staging 目录

function run(cmd, args) {
  const r = spawnSync(cmd, args, { encoding: 'utf8' });
  if (r.status !== 0) {
    throw new Error(`[${cmd} ${args.join(' ')}] 失败: ${(r.stderr || r.stdout || '').slice(0, 500)}`);
  }
}

console.log('== 1/3 打包扩展 zip ==');
fs.rmSync(EXT_ZIP, { force: true });
fs.rmSync(STAGE, { recursive: true, force: true });
fs.mkdirSync(STAGE, { recursive: true });
// staging：复制扩展源码（排除本机生成物）+ 附带安装说明
fs.cpSync(EXT_SRC, STAGE, {
  recursive: true,
  filter: (src) => {
    const base = path.basename(src);
    return base !== 'wbflow-host.log' && base !== 'com.wbflow.host.json';
  },
});
if (fs.existsSync(path.join(DIST, '安装说明.txt'))) {
  fs.copyFileSync(path.join(DIST, '安装说明.txt'), path.join(STAGE, '安装说明.txt'));
}
run('tar', ['-a', '-c', '-f', EXT_ZIP, '-C', STAGE, '.']);
console.log('  已生成:', EXT_ZIP);

console.log('== 2/3 自动解压覆盖 dist/wbflow-extension/（Chrome 加载目录） ==');
fs.rmSync(EXT_DIR, { recursive: true, force: true });
fs.mkdirSync(EXT_DIR, { recursive: true });
run('tar', ['-xf', EXT_ZIP, '-C', EXT_DIR]);
console.log('  已解压覆盖:', EXT_DIR);

console.log('== 3/3 打包全项目 zip ==');
fs.rmSync(PROJ_ZIP, { force: true });
run('tar', ['-a', '-c', '-f', PROJ_ZIP, '-C', ROOT,
  '--exclude=node_modules',
  '--exclude=.env',
  '--exclude=data',
  '--exclude=.git',
  '--exclude=.idea',
  '--exclude=dist/*.zip',
  '--exclude=dist/wbflow-extension',
  '--exclude=dist/wbflow-extension-v1.0.0',
  '--exclude=docs_ref/wb-item-sample.html',
  '--exclude=docs_ref/work-with-products.html',
  '--exclude=docs_ref/api-information.html',
  '--exclude=wbflow-extension/native-host/wbflow-host.log',
  '--exclude=wbflow-extension/native-host/com.wbflow.host.json',
  '.']);
console.log('  已生成:', PROJ_ZIP);

const pkg = JSON.parse(fs.readFileSync(path.join(ROOT, 'package.json'), 'utf8'));
console.log(`\n打包完成（v${pkg.version}）。Chrome 扩展加载目录已更新：${EXT_DIR}`);
console.log('提示：chrome://extensions 中点击「重新加载」即可生效。');
