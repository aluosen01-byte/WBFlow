/**
 * WBFlow Native Messaging Host
 * 供浏览器扩展调用：检测后端服务(默认 http://localhost:3000)是否运行，
 * 未运行则自动启动（node server/index.js，脱离终端后台运行）。
 *
 * 协议：Chrome 通过 stdin 发送 4字节长度前缀 + JSON 消息；
 * 宿主处理后通过 stdout 回发同格式消息。
 */
'use strict';

const { spawn } = require('child_process');
const net = require('net');
const path = require('path');
const fs = require('fs');

const LOG_FILE = path.join(__dirname, 'wbflow-host.log');
function log(msg) {
  try { fs.appendFileSync(LOG_FILE, `[${new Date().toISOString()}] ${msg}\n`); } catch { /* ignore */ }
}

// 项目根目录：本文件位于 wbflow-extension/native-host/，项目根在其上两级
const PROJECT_DIR = path.resolve(__dirname, '..', '..');
const SERVER_ENTRY = path.join(PROJECT_DIR, 'server', 'index.js');
const BACKEND_URL = process.env.WBFLOW_BACKEND_URL || 'http://localhost:3000';
const PORT = Number(process.env.WBFLOW_PORT || 3000);

function readPortMessage() {
  return new Promise((resolve, reject) => {
    const stdin = process.stdin;
    stdin.resume();
    let buf = Buffer.alloc(0);
    let settled = false;
    const finish = (err, msg) => {
      if (settled) return;
      settled = true;
      stdin.removeAllListeners('data');
      stdin.removeAllListeners('end');
      if (err) reject(err); else resolve(msg);
    };
    stdin.on('data', (chunk) => {
      buf = Buffer.concat([buf, chunk]);
      if (buf.length >= 4) {
        const len = buf.readUInt32LE(0);
        if (buf.length >= 4 + len) {
          const raw = buf.slice(4, 4 + len).toString('utf8');
          try { finish(null, JSON.parse(raw)); } catch (e) { finish(e); }
        }
      }
    });
    stdin.on('end', () => finish(new Error('stdin closed')));
    stdin.on('error', (e) => finish(e));
  });
}

function writePortMessage(obj) {
  const data = Buffer.from(JSON.stringify(obj), 'utf8');
  const head = Buffer.alloc(4);
  head.writeUInt32LE(data.length, 0);
  process.stdout.write(Buffer.concat([head, data]));
}

function isServerRunning() {
  return new Promise((resolve) => {
    const sock = net.connect({ host: '127.0.0.1', port: PORT });
    sock.setTimeout(1500);
    sock.on('connect', () => { sock.destroy(); resolve(true); });
    sock.on('error', () => resolve(false));
    sock.on('timeout', () => { sock.destroy(); resolve(false); });
  });
}

function startServer() {
  return new Promise((resolve) => {
    if (!fs.existsSync(SERVER_ENTRY)) {
      log('server entry not found: ' + SERVER_ENTRY);
      resolve({ ok: false, error: 'server entry not found: ' + SERVER_ENTRY });
      return;
    }
    // detached + stdio 重定向，脱离终端后台运行
    const child = spawn(process.execPath, [SERVER_ENTRY], {
      cwd: PROJECT_DIR,
      detached: true,
      stdio: 'ignore',
      windowsHide: true,
    });
    child.unref();
    log(`spawned server (pid ${child.pid}) at ${SERVER_ENTRY}`);
    resolve({ ok: true, pid: child.pid });
  });
}

async function main() {
  let msg = null;
  try {
    msg = await readPortMessage();
  } catch (e) {
    log('read error: ' + e.message);
    process.exit(0);
  }

  log('received: ' + JSON.stringify(msg));
  const resp = { ok: true };

  if (msg && (msg.type === 'ensureServer' || msg.cmd === 'ensureServer')) {
    const running = await isServerRunning();
    if (running) {
      resp.server = 'running';
    } else {
      const started = await startServer();
      resp.server = 'started';
      resp.started = started;
      // 等待端口就绪（最多 8 秒）
      for (let i = 0; i < 16; i++) {
        await new Promise((r) => setTimeout(r, 500));
        if (await isServerRunning()) { resp.server = 'running'; break; }
      }
    }
  } else if (msg && msg.type === 'ping') {
    resp.server = (await isServerRunning()) ? 'running' : 'stopped';
  } else {
    resp.server = (await isServerRunning()) ? 'running' : 'stopped';
  }

  writePortMessage(resp);
  log('response: ' + JSON.stringify(resp));
  // 保持进程直到 Chrome 断开 stdin
  process.stdin.resume();
}

main().catch((e) => {
  log('fatal: ' + e.stack || e.message);
  try { writePortMessage({ ok: false, error: String(e.message || e) }); } catch { /* ignore */ }
  process.exit(1);
});
