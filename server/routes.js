import { Router } from 'express';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { config } from './config.js';
import { checkToken, currentUserName } from './wbClient.js';
import * as content from './contentApi.js';
import * as market from './marketplaceApi.js';
import { runMigration, loadTasks, getTask, fetchRecentCardErrors } from './migrateService.js';
import { fetchSourceProduct, detectSource } from './sourceFetcher.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const pkg = JSON.parse(fs.readFileSync(path.resolve(__dirname, '..', 'package.json'), 'utf8'));

export const api = Router();

/** 版本号（package.json 为唯一版本源，npm run bump 递增） */
api.get('/version', (_req, res) => {
  res.json({ name: pkg.name, version: pkg.version });
});

/** 用户列表（不返回令牌，仅用户名） */
api.get('/users', (_req, res) => {
  res.json({
    users: config.userNames.map((name) => ({ name })),
    current: currentUserName(),
  });
});

/** 服务状态 + 令牌校验（按当前用户） */
api.get('/status', async (_req, res) => {
  const user = currentUserName();
  const token = await checkToken();
  let limits = null;
  let warehouses = [];
  if (token.ok) {
    try { limits = await content.getCardsLimits(); } catch { /* ignore */ }
    try { warehouses = await market.getWarehouses(); } catch { /* ignore */ }
  }
  res.json({ ok: token.ok, user, tokenError: token.error, limits, warehouses, parentCount: token.parentCount });
});

/* ---------- WB 类目 / 特性 / 字典 ---------- */

api.get('/categories/parents', async (_req, res) => {
  try {
    const data = await content.getParentCategories();
    res.json({ data });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

api.get('/categories', async (req, res) => {
  try {
    const { parentID, name } = req.query;
    const data = await content.getSubcategories({ parentID, name });
    res.json({ data });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

api.get('/categories/:subjectId/characteristics', async (req, res) => {
  try {
    const data = await content.getCharacteristics(req.params.subjectId);
    res.json({ data });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

api.get('/brands', async (req, res) => {
  try {
    const data = await content.getBrands(req.query.subjectId, { next: req.query.next || 0 });
    res.json(data);
  } catch (e) { res.status(500).json({ error: e.message }); }
});

api.get('/directories/:type', async (req, res) => {
  try {
    const data = await content.getDirectory(req.params.type);
    res.json({ data });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

api.get('/warehouses', async (_req, res) => {
  try {
    const data = await market.getWarehouses();
    res.json({ data });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

/* ---------- 源商品解析 ---------- */

api.post('/source/detect', (req, res) => {
  res.json(detectSource(req.body?.url || ''));
});

api.post('/source/parse', async (req, res) => {
  try {
    const { url, html } = req.body || {};
    if (!url) return res.status(400).json({ error: '缺少 url' });
    const product = await fetchSourceProduct({ url, html });
    res.json({ product });
  } catch (e) {
    res.status(502).json({ error: e.message, hint: '若源站反爬拦截，可切换"手动输入"模式' });
  }
});

/* ---------- 一键搬品 ---------- */

api.post('/migrate', async (req, res) => {
  const task = await runMigration(req.body || {});
  res.json({ taskId: task.id, status: task.status });
});

api.get('/tasks', (_req, res) => {
  res.json({ tasks: loadTasks() });
});

api.get('/tasks/:id', (req, res) => {
  const task = getTask(req.params.id);
  if (!task) return res.status(404).json({ error: '任务不存在' });
  res.json({ task });
});

api.get('/card-errors', async (_req, res) => {
  res.json(await fetchRecentCardErrors());
});
