// 测试 native host：模拟 Chrome 发送 ensureServer 消息，验证后端自动启动
import { spawn } from 'node:child_process';
import net from 'node:net';

const HOST_JS = 'D:/projects/WBFlow/wbflow-extension/native-host/wbflow-host.cjs';

function isRunning(port = 3000) {
  return new Promise((resolve) => {
    const s = net.connect({ host: '127.0.0.1', port });
    s.setTimeout(800);
    s.on('connect', () => { s.destroy(); resolve(true); });
    s.on('error', () => resolve(false));
    s.on('timeout', () => { s.destroy(); resolve(false); });
  });
}

function sendMessage(proc, obj) {
  return new Promise((resolve, reject) => {
    const data = Buffer.from(JSON.stringify(obj), 'utf8');
    const head = Buffer.alloc(4);
    head.writeUInt32LE(data.length, 0);
    proc.stdin.write(Buffer.concat([head, data]));

    let buf = Buffer.alloc(0);
    const onData = (chunk) => {
      buf = Buffer.concat([buf, chunk]);
      if (buf.length >= 4) {
        const len = buf.readUInt32LE(0);
        if (buf.length >= 4 + len) {
          const raw = buf.slice(4, 4 + len).toString('utf8');
          cleanup();
          resolve(JSON.parse(raw));
        }
      }
    };
    const onErr = (e) => { cleanup(); reject(e); };
    const cleanup = () => {
      proc.stdout.off('data', onData);
      proc.stderr.off('data', onErr);
      try { proc.stdin.end(); } catch { /* ignore */ }
    };
    proc.stdout.on('data', onData);
    proc.stderr.on('data', onErr);
  });
}

console.log('== 前置：后端状态 ==');
console.log('backend running:', await isRunning());

console.log('\n== 1. 模拟 Chrome 向宿主发送 ensureServer ==');
const proc = spawn(process.execPath, [HOST_JS], { stdio: ['pipe', 'pipe', 'pipe'] });
const resp = await sendMessage(proc, { type: 'ensureServer' });
console.log('host response:', JSON.stringify(resp));
proc.kill();

console.log('\n== 2. 等待后端端口就绪 ==');
let up = false;
for (let i = 0; i < 20; i++) {
  await new Promise((r) => setTimeout(r, 500));
  up = await isRunning();
  if (up) break;
}
console.log('backend running now:', up);
if (!up) { console.error('FAIL: 后端未自动启动'); process.exit(1); }

console.log('\n== 3. 再次发送 ensureServer（应返回 running 且不重复启动） ==');
const proc2 = spawn(process.execPath, [HOST_JS], { stdio: ['pipe', 'pipe', 'pipe'] });
const resp2 = await sendMessage(proc2, { type: 'ensureServer' });
console.log('host response 2:', JSON.stringify(resp2));
proc2.kill();

console.log('\n✅ native host 自动启动后端链路验证通过');
process.exit(0);
