import express from 'express';
import path from 'node:path';
import { config, ensureDirs, isValidUser } from './config.js';
import { userStore, withUser } from './wbClient.js';
import { api } from './routes.js';

ensureDirs();

const app = express();
app.use(express.json({ limit: '2mb' }));

// CORS：允许浏览器扩展（WB商品页上下文）跨域调用本地 API
app.use((req, res, next) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, PUT, PATCH, DELETE, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization, X-WB-User');
  if (req.method === 'OPTIONS') return res.sendStatus(204);
  next();
});

// 多用户：从请求头 X-WB-User 解析当前用户（前端需 encodeURIComponent，避免中文header问题），未指定时用默认用户
app.use((req, res, next) => {
  let user = req.headers['x-wb-user'] || '';
  if (user) {
    try { user = decodeURIComponent(user); } catch { /* 保持原值 */ }
  }
  user = String(user || config.defaultUserName);
  if (!isValidUser(user)) {
    return res.status(400).json({ error: `未知用户「${user}」，可用用户：${config.userNames.join('、')}` });
  }
  withUser(user, next);
});

// 静态前台
app.use(express.static(path.join(config.root, 'public')));

// API 路由
app.use('/api', api);

// 健康检查
app.get('/healthz', (_req, res) => res.json({ ok: true }));

// 错误兜底
app.use((err, _req, res, _next) => {
  console.error('[server error]', err);
  res.status(500).json({ error: err.message || 'Internal Server Error' });
});

app.listen(config.port, () => {
  console.log(`WBFlow 一键搬品服务已启动: http://localhost:${config.port}`);
  console.log(`用户: ${config.userNames.join('、') || '未配置'}`);
  console.log(`令牌: ${config.wbToken ? '已配置' : '未配置（请在 .env 中设置 WB_TOKEN 或 WB_USERS）'}`);
});
