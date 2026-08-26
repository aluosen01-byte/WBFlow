import express from 'express';
import path from 'node:path';
import { config, ensureDirs } from './config.js';
import { api } from './routes.js';

ensureDirs();

const app = express();
app.use(express.json({ limit: '2mb' }));

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
  console.log(`令牌: ${config.wbToken ? '已配置' : '未配置（请在 .env 中设置 WB_TOKEN）'}`);
});
