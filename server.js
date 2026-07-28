import express from 'express';
import cors from 'cors';
import helmet from 'helmet';
import dotenv from 'dotenv';
import fs from 'fs';
import path from 'path';
import { randomUUID } from 'crypto';
import { fileURLToPath } from 'url';
import pg from 'pg';

dotenv.config();

const app = express();
const PORT = Number(process.env.PORT || 3000);
const HOST = process.env.HOST || '0.0.0.0';
// FRONTEND_HTML is now served from public/index.html

/* === PostgreSQL 持久化层 ===
 * Render 免费版文件系统是临时的，服务重启后本地文件丢失。
 * 当设置了 DATABASE_URL 环境变量时，数据持久化到 PostgreSQL。
 * 未设置时，回退到本地文件存储（仅适合开发环境）。
 */
const DATABASE_URL = process.env.DATABASE_URL || '';
let pgPool = null;

const initDatabase = async () => {
  if (!DATABASE_URL) return false;
  try {
    pgPool = new pg.Pool({
      connectionString: DATABASE_URL,
      max: 5,
      idleTimeoutMillis: 30000,
      connectionTimeoutMillis: 5000,
      ssl: process.env.PG_SSL === 'false' ? false : { rejectUnauthorized: false }
    });
    await pgPool.query(`
      CREATE TABLE IF NOT EXISTS app_state (
        key VARCHAR(60) PRIMARY KEY,
        value JSONB NOT NULL,
        updated_at TIMESTAMPTZ DEFAULT NOW()
      )
    `);
    console.log('[DB] PostgreSQL \u6301\u4e45\u5316\u5df2\u542f\u7528');
    return true;
  } catch (err) {
    console.warn('[DB] PostgreSQL \u8fde\u63a5\u5931\u8d25\uff0c\u56de\u9000\u5230\u672c\u5730\u6587\u4ef6\uff1a', err.message);
    pgPool = null;
    return false;
  }
};

const dbGet = async (key) => {
  if (!pgPool) return null;
  try {
    const res = await pgPool.query('SELECT value FROM app_state WHERE key = $1', [key]);
    return res.rows.length > 0 ? res.rows[0].value : null;
  } catch (err) {
    console.warn('[DB] \u8bfb\u53d6\u5931\u8d25 key=' + key + ':', err.message);
    return null;
  }
};

const dbSet = async (key, value) => {
  if (!pgPool) return;
  try {
    await pgPool.query(
      'INSERT INTO app_state (key, value, updated_at) VALUES ($1, $2, NOW()) ON CONFLICT (key) DO UPDATE SET value = $2, updated_at = NOW()',
      [key, JSON.stringify(value)]
    );
  } catch (err) {
    console.warn('[DB] \u5199\u5165\u5931\u8d25 key=' + key + ':', err.message);
  }
};

const config = {
  upstreamBase: 'https://az.zlapi.vip/v1',
  upstreamKey: process.env.UPSTREAM_API_KEY || 'sk-YCm0hGZ8wlLzKz4U04yVraOF4aIaiEaJ2J2VV08Ju6u7KjCl',
  upstreamModel: '[0.005]自营伪流/gemini-2.5-flash',
  chatBeansCost: Number(process.env.CHAT_BEANS_COST || 2),
  beansPerCny: Number(process.env.BEANS_PER_CNY || 10),
  rechargePackages: String(process.env.RECHARGE_PACKAGES || '6:60,18:200,30:360,68:900')
    .split(',')
    .map((item) => {
      const [amount, beans] = item.split(':').map(Number);
      return { amount, beans };
    })
    .filter((item) => Number.isFinite(item.amount) && Number.isFinite(item.beans)),
  demoInitialBeans: Number(process.env.DEMO_INITIAL_BEANS || 30)
};

/* === 流式收集上游 AI 响应的辅助函数（含限流重试） ===
 * Gemini 等模型在非流式模式下生成长文本会卡住或超时，
 * 改用 stream:true 逐块读取，在服务端拼接完整内容后返回。
 * 自动检测 429 限流并重试最多 3 次。
 */
const streamComplete = async (prompt, options = {}) => {
  const { timeoutMs = 120000, maxTokens = 4000, retries = 3 } = options;
  if (!config.upstreamKey || config.upstreamKey.includes('请填写')) {
    const err = new Error('AI服务未配置。');
    err.code = 503; err.code2 = 5001;
    throw err;
  }

  let lastError = null;
  for (let attempt = 0; attempt <= retries; attempt++) {
    if (attempt > 0) {
      // 重试前等待 3 秒
      await new Promise(r => setTimeout(r, 3000));
    }
    try {
      const result = await _streamCompleteOnce(prompt, { timeoutMs, maxTokens });
      if (result && result.length > 0) return result;
      // 空响应，可能是限流，重试
      lastError = new Error('AI返回空内容，可能服务繁忙，请稍后重试。');
      lastError.code = 503; lastError.code2 = 5007;
    } catch (e) {
      if (e.isRateLimit && attempt < retries) {
        console.warn('streamComplete 遇到限流，第' + (attempt + 1) + '次重试...');
        lastError = e;
        continue;
      }
      throw e;
    }
  }
  throw lastError || new Error('生成失败，请稍后重试。');
};

/* 单次流式请求 */
const _streamCompleteOnce = async (prompt, options) => {
  const { timeoutMs = 120000, maxTokens = 4000 } = options;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  let resp;
  try {
    resp = await fetch(config.upstreamBase + '/chat/completions', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + config.upstreamKey },
      signal: controller.signal,
      body: JSON.stringify({
        model: config.upstreamModel,
        stream: true,
        max_tokens: maxTokens,
        messages: [{ role: 'user', content: prompt }]
      })
    });
  } catch (fetchErr) {
    clearTimeout(timer);
    if (fetchErr.name === 'AbortError') {
      const err = new Error('生成超时，请稍后重试。');
      err.code = 504; err.code2 = 5004;
      throw err;
    }
    const err = new Error('网络请求失败：' + (fetchErr.message || '未知错误'));
    err.code = 502; err.code2 = 5005;
    throw err;
  }

  if (!resp.ok || !resp.body) {
    clearTimeout(timer);
    if (resp.status === 429) {
      const err = new Error('AI服务繁忙，请稍后重试。');
      err.code = 429; err.code2 = 5007; err.isRateLimit = true;
      throw err;
    }
    const err = new Error('上游API异常(' + resp.status + ')，请稍后重试。');
    err.code = 502; err.code2 = 5006;
    throw err;
  }

  const reader = resp.body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';
  let fullText = '';

  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      const parts = buffer.split('\n\n');
      buffer = parts.pop() || '';
      for (const part of parts) {
        const dataLines = part.split('\n').filter(line => line.startsWith('data:'));
        for (const line of dataLines) {
          const payload = line.slice(5).trim();
          if (!payload || payload === '[DONE]') continue;
          try {
            const json = JSON.parse(payload);
            // 检测流中的错误响应（429限流等）
            if (json.error) {
              if (json.error.code === 429 || json.error.type === 'rate_limit_error') {
                const err = new Error('AI服务繁忙，请稍后重试。');
                err.code = 429; err.code2 = 5007; err.isRateLimit = true;
                throw err;
              }
              const err = new Error('AI服务异常：' + (json.error.message || '未知错误'));
              err.code = 502; err.code2 = 5006;
              throw err;
            }
            const delta = json.choices?.[0]?.delta?.content || json.choices?.[0]?.message?.content || '';
            if (delta) fullText += delta;
          } catch (parseErr) {
            if (parseErr.isRateLimit) throw parseErr;
            // 普通 JSON 解析错误忽略
          }
        }
      }
    }
    // 处理 buffer 中剩余的数据
    if (buffer.trim()) {
      const dataLines = buffer.split('\n').filter(line => line.startsWith('data:'));
      for (const line of dataLines) {
        const payload = line.slice(5).trim();
        if (!payload || payload === '[DONE]') continue;
        try {
          const json = JSON.parse(payload);
          if (json.error) {
            if (json.error.code === 429 || json.error.type === 'rate_limit_error') {
              const err = new Error('AI服务繁忙，请稍后重试。');
              err.code = 429; err.code2 = 5007; err.isRateLimit = true;
              throw err;
            }
          }
          const delta = json.choices?.[0]?.delta?.content || json.choices?.[0]?.message?.content || '';
          if (delta) fullText += delta;
        } catch (parseErr) {
          if (parseErr.isRateLimit) throw parseErr;
        }
      }
    }
  } catch (readErr) {
    if (readErr.isRateLimit) throw readErr;
    if (readErr.name === 'AbortError') {
      const err = new Error('生成超时，请稍后重试。');
      err.code = 504; err.code2 = 5004;
      throw err;
    }
    throw readErr;
  } finally {
    clearTimeout(timer);
  }

  return fullText;
};

/* === 带 system prompt 的流式收集辅助函数 === */
const streamCompleteWithSystem = async (sysPrompt, userMessage, options = {}) => {
  const { timeoutMs = 60000, maxTokens = 2000 } = options;
  if (!config.upstreamKey || config.upstreamKey.includes('请填写')) {
    const err = new Error('AI服务未配置。');
    err.code = 503; err.code2 = 5001;
    throw err;
  }
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  let resp;
  try {
    resp = await fetch(config.upstreamBase + '/chat/completions', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + config.upstreamKey },
      signal: controller.signal,
      body: JSON.stringify({
        model: config.upstreamModel,
        stream: true,
        max_tokens: maxTokens,
        messages: [
          { role: 'system', content: sysPrompt },
          { role: 'user', content: userMessage }
        ]
      })
    });
  } catch (fetchErr) {
    clearTimeout(timer);
    if (fetchErr.name === 'AbortError') {
      const err = new Error('生成超时，请稍后重试。');
      err.code = 504; err.code2 = 5004;
      throw err;
    }
    throw new Error('网络请求失败：' + (fetchErr.message || '未知错误'));
  }
  if (!resp.ok || !resp.body) {
    clearTimeout(timer);
    throw new Error('上游API异常(' + resp.status + ')，请稍后重试。');
  }
  const reader = resp.body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';
  let fullText = '';
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      const parts = buffer.split('\n\n');
      buffer = parts.pop() || '';
      for (const part of parts) {
        const dataLines = part.split('\n').filter(line => line.startsWith('data:'));
        for (const line of dataLines) {
          const payload = line.slice(5).trim();
          if (!payload || payload === '[DONE]') continue;
          try {
            const json = JSON.parse(payload);
            const delta = json.choices?.[0]?.delta?.content || json.choices?.[0]?.message?.content || '';
            if (delta) fullText += delta;
          } catch {}
        }
      }
    }
  } catch (readErr) {
    if (readErr.name === 'AbortError') throw new Error('生成超时，请稍后重试。');
    throw readErr;
  } finally {
    clearTimeout(timer);
  }
  return fullText;
};




const users = new Map();
const transactions = [];
const communityRoles = [];
const userMemories = new Map();
const userProfiles = new Map();
const directMessages = new Map();
const novelGameSaves = new Map();
const novelGameStates = new Map();
const bgTasks = new Map(); // 后台生成任务
const stats = { totalRechargeCny: 0, totalBeansConsumed: 0, totalChatCount: 0, totalRefundBeans: 0 };

const DATA_DIR = process.env.DATA_DIR || path.join(path.dirname(fileURLToPath(import.meta.url)), '.data');
const DATA_FILE = process.env.DATA_FILE || path.join(DATA_DIR, 'mochi-phone-data.json');
let saveTimer = null;

const saveDataNow = () => {
  try {
    const payload = {
      version: 1,
      updatedAt: new Date().toISOString(),
      users: [...users.values()],
      transactions: transactions.slice(-1000),
      memories: Object.fromEntries([...userMemories.entries()].map(([userId, list]) => [userId, list.slice(-300)])),
      profiles: Object.fromEntries([...userProfiles.entries()].map(([userId, p]) => [userId, p])),
      messages: Object.fromEntries([...directMessages.entries()].map(([userId, list]) => [userId, list.slice(-200)])),
      novelGames: Object.fromEntries([...novelGameSaves.entries()].map(([userId, list]) => [userId, list.slice(-50)])),
      communityRoles: communityRoles.slice(0, 500),
      stats
    };
    /* 写本地文件（开发环境兜底） */
    try {
      fs.mkdirSync(DATA_DIR, { recursive: true });
      fs.writeFileSync(DATA_FILE, JSON.stringify(payload, null, 2), 'utf8');
    } catch (e) { /* 忽略文件写入错误（可能是在只读环境） */ }
    /* 异步写 PostgreSQL（生产环境持久化） */
    if (pgPool) {
      dbSet('app_state', payload).catch(() => {});
    }
  } catch (error) {
    console.warn('保存数据失败：', error.message);
  }
};

const saveData = () => {
  clearTimeout(saveTimer);
  saveTimer = setTimeout(saveDataNow, 120);
};

const loadData = () => {
  try {
    if (!fs.existsSync(DATA_FILE)) return;
    const payload = JSON.parse(fs.readFileSync(DATA_FILE, 'utf8'));
    if (Array.isArray(payload.users)) {
      for (const user of payload.users) {
        if (user?.id) users.set(String(user.id).slice(0, 80), {
          id: String(user.id).slice(0, 80),
          beans: Number.isFinite(Number(user.beans)) ? Number(user.beans) : config.demoInitialBeans,
          createdAt: user.createdAt || new Date().toISOString()
        });
      }
    }
    if (Array.isArray(payload.transactions)) transactions.push(...payload.transactions.slice(-1000));
    if (payload.memories && typeof payload.memories === 'object') {
      for (const [userId, list] of Object.entries(payload.memories)) {
        if (Array.isArray(list)) userMemories.set(String(userId).slice(0, 80), list.slice(-300));
      }
    }
    if (payload.stats && typeof payload.stats === 'object') {
      Object.assign(stats, {
        totalRechargeCny: Number(payload.stats.totalRechargeCny || 0),
        totalBeansConsumed: Number(payload.stats.totalBeansConsumed || 0),
        totalChatCount: Number(payload.stats.totalChatCount || 0),
        totalRefundBeans: Number(payload.stats.totalRefundBeans || 0)
      });
    }
    if (payload.profiles && typeof payload.profiles === 'object') {
      for (const [userId, p] of Object.entries(payload.profiles)) {
        if (p && typeof p === 'object') userProfiles.set(String(userId).slice(0, 80), p);
      }
    }
    if (payload.messages && typeof payload.messages === 'object') {
      for (const [userId, list] of Object.entries(payload.messages)) {
        if (Array.isArray(list)) directMessages.set(String(userId).slice(0, 80), list.slice(-200));
      }
    }
    if (payload.novelGames && typeof payload.novelGames === 'object') {
      for (const [userId, list] of Object.entries(payload.novelGames)) {
        if (Array.isArray(list)) novelGameSaves.set(String(userId).slice(0, 80), list.slice(-50));
      }
    }
    if (Array.isArray(payload.communityRoles)) {
      communityRoles.length = 0;
      communityRoles.push(...payload.communityRoles.slice(0, 500));
    }
  } catch (error) {
    console.warn('读取本地文件失败，将使用空数据启动：', error.message);
  }
};

/* 异步初始化数据库并加载数据 */
const initAndLoadData = async () => {
  const dbEnabled = await initDatabase();
  if (dbEnabled) {
    try {
      const dbData = await dbGet('app_state');
      if (dbData && dbData.users) {
        console.log('[DB] 从 PostgreSQL 恢复数据，用户数：' + dbData.users.length);
        if (Array.isArray(dbData.users)) {
          for (const user of dbData.users) {
            if (user?.id) users.set(String(user.id).slice(0, 80), {
              id: String(user.id).slice(0, 80),
              beans: Number.isFinite(Number(user.beans)) ? Number(user.beans) : config.demoInitialBeans,
              createdAt: user.createdAt || new Date().toISOString()
            });
          }
        }
        if (Array.isArray(dbData.transactions)) transactions.push(...dbData.transactions.slice(-1000));
        if (dbData.memories && typeof dbData.memories === 'object') {
          for (const [userId, list] of Object.entries(dbData.memories)) {
            if (Array.isArray(list)) userMemories.set(String(userId).slice(0, 80), list.slice(-300));
          }
        }
        if (dbData.profiles && typeof dbData.profiles === 'object') {
          for (const [userId, p] of Object.entries(dbData.profiles)) {
            if (p) userProfiles.set(String(userId).slice(0, 80), p);
          }
        }
        if (dbData.messages && typeof dbData.messages === 'object') {
          for (const [userId, list] of Object.entries(dbData.messages)) {
            if (Array.isArray(list)) directMessages.set(String(userId).slice(0, 80), list.slice(-200));
          }
        }
        if (dbData.novelGames && typeof dbData.novelGames === 'object') {
          for (const [userId, list] of Object.entries(dbData.novelGames)) {
            if (Array.isArray(list)) novelGameSaves.set(String(userId).slice(0, 80), list.slice(-50));
          }
        }
        if (Array.isArray(dbData.communityRoles)) {
          communityRoles.length = 0;
          communityRoles.push(...dbData.communityRoles.slice(0, 500));
        }
        if (dbData.stats) Object.assign(stats, dbData.stats);
        return;
      }
    } catch (err) {
      console.warn('[DB] 从数据库恢复失败：', err.message);
    }
  }
  /* DB 不可用或无数据时，从本地文件加载 */
  loadData();
};

await initAndLoadData();
process.on('SIGTERM', () => { saveDataNow(); process.exit(0); });
process.on('SIGINT', () => { saveDataNow(); process.exit(0); });

const ok = (res, data = {}, message = 'success') => res.json({ code: 0, message, data });
const fail = (res, status, code, message, details = null) => res.status(status).json({ code, message, details });

const getUser = (userId = 'demo-user') => {
  if (!users.has(userId)) {
    users.set(userId, { id: userId, beans: config.demoInitialBeans, createdAt: new Date().toISOString() });
    saveData();
  }
  return users.get(userId);
};

const writeSse = (res, event, data) => {
  res.write(`event: ${event}\n`);
  res.write(`data: ${JSON.stringify(data)}\n\n`);
};

const streamText = async (res, text) => {
  for (const char of text) {
    writeSse(res, 'delta', { content: char });
    await new Promise((resolve) => setTimeout(resolve, 18));
  }
};

const refundChatBeans = (user, roleName = 'AI角色', summary = 'AI 回复失败自动退豆') => {
  user.beans += config.chatBeansCost;
  stats.totalRefundBeans += config.chatBeansCost;
  transactions.push({
    id: randomUUID(),
    userId: user.id,
    type: 'refund',
    beans: config.chatBeansCost,
    roleName,
    summary,
    createdAt: new Date().toISOString()
  });
  saveData();
};

const getUserMemories = (userId = 'demo-user') => {
  if (!userMemories.has(userId)) userMemories.set(userId, []);
  return userMemories.get(userId);
};

/* === 后台生成任务系统 === */
const createBgTask = (userId, type, label) => {
  const task = {
    id: randomUUID(),
    userId,
    type,
    label: label || '生成中',
    status: 'pending',
    result: null,
    error: null,
    createdAt: new Date().toISOString(),
    completedAt: null
  };
  bgTasks.set(task.id, task);

  // 只保留每用户最近20条
  const userTasks = [...bgTasks.values()].filter(t => t.userId === userId);
  if (userTasks.length > 20) {
    const old = userTasks.slice(0, userTasks.length - 20);
    for (const t of old) bgTasks.delete(t.id);
  }
  return task;
};

const completeBgTask = (taskId, result) => {
  const task = bgTasks.get(taskId);

  if (!task) return;
  task.status = 'done';
  task.result = result;
  task.completedAt = new Date().toISOString();

};

const failBgTask = (taskId, error) => {
  const task = bgTasks.get(taskId);

  if (!task) return;
  task.status = 'failed';
  task.error = error || '生成失败';
  task.completedAt = new Date().toISOString();

};

// 后台生成轮询端点
// User ID middleware (must be before all API routes)
app.use((req, _res, next) => {
  req.userId = String(req.headers['x-user-id'] || 'demo-user').slice(0, 80);
  next();
});

app.get('/api/bg-tasks', (req, res) => {
  const list = [...bgTasks.values()]
    .filter(t => t.userId === req.userId)
    .sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt))
    .slice(0, 20)
    .map(t => ({
      id: t.id,
      type: t.type,
      label: t.label,
      status: t.status,
      error: t.error,
      createdAt: t.createdAt,
      completedAt: t.completedAt
    }));
  ok(res, { list });
});

app.get('/api/bg-tasks/:id', (req, res) => {
  const task = bgTasks.get(req.params.id);

  if (!task || task.userId !== req.userId) {
    return fail(res, 404, 4041, '任务不存在');
  }
  ok(res, {
    id: task.id,
    type: task.type,
    label: task.label,
    status: task.status,
    error: task.error,
    result: task.status === 'done' ? task.result : null,
    createdAt: task.createdAt,
    completedAt: task.completedAt
  });
});

app.delete('/api/bg-tasks/:id', (req, res) => {
  const task = bgTasks.get(req.params.id);
  if (!task || task.userId !== req.userId) {
    return fail(res, 404, 4041, '任务不存在');
  }
  bgTasks.delete(req.params.id);
  ok(res, { deleted: true });
});

const memoryTypes = ['用户资料', '角色关系', '事件', '偏好', '禁忌', '剧情'];

const normalizeMemory = (payload = {}, fallback = {}) => {
  const content = String(payload.content || '').trim().slice(0, 220);
  if (!content) return null;
  const roleId = String(payload.roleId || fallback.roleId || '').slice(0, 80);
  const roleName = String(payload.roleName || fallback.roleName || '全部角色').slice(0, 40);
  const type = memoryTypes.includes(payload.type) ? payload.type : (fallback.type || '事件');
  return {
    id: payload.id || randomUUID(),
    roleId,
    roleName,
    type,
    content,
    source: payload.source || fallback.source || 'manual',
    sourceConversationId: String(payload.sourceConversationId || fallback.sourceConversationId || roleId || '').slice(0, 120),
    sourceMessageIds: Array.isArray(payload.sourceMessageIds || fallback.sourceMessageIds)
      ? [...new Set((payload.sourceMessageIds || fallback.sourceMessageIds).map((item) => String(item).slice(0, 120)))].slice(0, 8)
      : [],
    createdAt: payload.createdAt || new Date().toISOString(),
    updatedAt: new Date().toISOString()
  };
};

const addMemory = (userId, payload, fallback = {}) => {
  const memory = normalizeMemory(payload, fallback);
  if (!memory) return null;
  const list = getUserMemories(userId);
  const duplicate = list.find((item) =>
    item.roleId === memory.roleId &&
    item.type === memory.type &&
    item.content.trim() === memory.content.trim()
  );
  if (duplicate) {
    duplicate.updatedAt = new Date().toISOString();
    duplicate.sourceMessageIds = [...new Set([...(duplicate.sourceMessageIds || []), ...(memory.sourceMessageIds || [])])].slice(0, 8);
    saveData();
    return duplicate;
  }
  list.unshift(memory);
  if (list.length > 200) list.length = 200;
  saveData();
  return memory;
};

const listMemories = (userId, roleId = '') => {
  const targetRoleId = String(roleId || '');
  return getUserMemories(userId)
    .filter((item) => !targetRoleId || !item.roleId || item.roleId === targetRoleId)
    .sort((a, b) => new Date(b.updatedAt || b.createdAt) - new Date(a.updatedAt || a.createdAt));
};

const buildMemoryPrompt = (userId, roleId = '') => {
  const memories = listMemories(userId, roleId).slice(0, 12);
  if (!memories.length) return '';
  return `\n\n【长期记忆】\n这些是用户允许你记住的信息，请自然使用，不要机械复述：\n${memories.map((item, index) => `${index + 1}. [${item.type}] ${item.content}`).join('\n')}`;
};

const inferMemoryType = (content) => {
  if (/不喜欢|讨厌|别再|不要叫|不要|不想|别问|算了|随便|害怕|担心|焦虑|压力/.test(content)) return '禁忌';
  if (/喜欢|偏好|希望|习惯|叫我|称呼|想要|需要/.test(content)) return '偏好';
  if (/生日|家人|朋友|学校|工作|职业|住在|来自|我是|我叫|考试|上班|面试/.test(content)) return '用户资料';
  if (/约定|我们|一起|关系|陪我|晚安|早安|聚会|约会|庆祝|纪念/.test(content)) return '角色关系';
  if (/剧情|任务|线索|案件|世界观|设定|正在|目标|计划|打算/.test(content)) return '剧情';
  return '事件';
};

// 判断一句话是否值得沉淀为记忆（过滤过短/过长/纯寒暄）
const isMemoryWorthRecording = (raw) => {
  if (!raw || raw.length < 2 || raw.length > 260) return false;
  if (/^(你好|在吗|嗯|哦|好|哈哈|谢谢|再见|晚安|早安|是的|对的|不是|没有|可以|好的|行|ok)[。！？!?.\s]*$/i.test(raw)) return false;
  return true;
};

// 本地记叙文兜底：当 AI 不可用时，用规则把对话整理成一段记叙文风格的记忆
const summarizeMemoryNarrativeFallback = (userMsg, replyText, roleName) => {
  const raw = String(userMsg || '').replace(/\s+/g, ' ').trim();
  if (!isMemoryWorthRecording(raw)) return null;
  const reply = String(replyText || '').replace(/\s+/g, ' ').trim();
  const rn = roleName || 'TA';

  // 时间线索，让记叙文有"时间感"
  const h = new Date().getHours();
  const timePhrase = h < 6 ? '深夜' : h < 11 ? '清晨' : h < 14 ? '午后' : h < 18 ? '下午' : h < 22 ? '夜晚' : '深夜';
  const userCore = raw.length > 70 ? raw.slice(0, 70) + '…' : raw;

  // 情感基调
  let mood;
  if (/开心|高兴|快乐|幸福|笑|嘻嘻|哈哈|棒|感动|温暖|喜欢|期待|舒服/.test(raw)) mood = '愉快';
  else if (/难过|伤心|哭|委屈|失落|孤独|害怕|焦虑|压力|累|烦|不开心|心情不好|崩溃|emo/.test(raw)) mood = '低落';
  else if (/生气|愤怒|气死|讨厌|烦死|无语|抓狂/.test(raw)) mood = '带着些情绪';
  else mood = '平静';

  // 把对话写成一段记叙文，含时间、事件、情感，有约定则写入约定
  if (/(小时候|以前|过去|回忆|记得|怀念|那年|曾经|长大|童年|旧时光)/.test(raw)) {
    return `${timePhrase}和${rn}聊起了往事。${userCore}。${rn}安静地陪着，我们就这样把旧时光又走了一遍，心里泛起${mood === '低落' ? '一丝怅然' : '阵阵暖意'}。`;
  }
  if (/(约定|说好|答应|承诺|一起|明天|下次|到时候|不见不散|改天|之后)/.test(raw)) {
    return `${timePhrase}和${rn}聊了很久，话题慢慢落到了以后。${userCore}。我们约定好了接下来要做的事，带着${mood}的心情结束了这次对话。`;
  }
  if (mood === '低落') {
    return `${timePhrase}，我心情有些低落，找${rn}说了说话。${userCore}。${rn}没有急着讲道理，只是温柔地接住了我的情绪，让我觉得没那么孤单。`;
  }
  if (mood === '愉快') {
    return `${timePhrase}和${rn}的对话格外愉快。${userCore}。一来一往间笑声不断，这段时光被悄悄收进了记忆里。`;
  }
  if (reply && reply.length > 10) {
    return `${timePhrase}和${rn}聊了一阵。${userCore}。${rn}温声回应着我，这段${mood}的对话成了今天的一个小小注脚。`;
  }
  return `${timePhrase}和${rn}有了一段${mood}的对话。${userCore}。这些话语被留在了记忆里。`;
};

// 用 AI 把整段对话总结成记叙文风格的记忆（像日记一样叙述发生了什么）
const summarizeMemoryByAI = async (userMsg, replyText, roleName) => {
  const raw = String(userMsg || '').replace(/\s+/g, ' ').trim();
  if (!isMemoryWorthRecording(raw)) return null;
  const reply = String(replyText || '').trim();
  const rn = roleName || '角色';

  const prompt =
    '你是一个记忆整理助手。请把下面这段用户与虚拟角色“' + rn + '”的对话，总结成一段记叙文风格的记忆，像日记一样叙述这次对话发生了什么。\n\n' +
    '要求：\n' +
    '- 以第一人称（用户视角）记叙，像写日记一样流畅自然，可以提到“' + rn + '”\n' +
    '- 必须包含这些要素：时间感（例如今天/夜里/午后）、发生的事件、对话中的情感；如果对话里出现了约定、承诺或下次的计划，也要写进记叙文里\n' +
    '- 写成一段连贯的记叙文，不要罗列要点或关键词，不要分条、不要小标题\n' +
    '- 字数控制在 50-150 字\n' +
    '- 只返回记叙文正文，不要解释、不要加引号、不要加“记忆：”之类的前缀\n\n' +
    '用户说：' + (raw.length > 300 ? raw.slice(0, 300) + '…' : raw) + '\n' +
    '角色' + rn + '回复：' + (reply.length > 400 ? reply.slice(0, 400) + '…' : reply) + '\n\n' +
    '记叙文记忆：';

  try {
    const text = (await streamComplete(prompt, { timeoutMs: 30000, maxTokens: 500 })).trim();
    const cleaned = text
      .replace(/^["'「『]+|["'」』]+$/g, '')
      .replace(/^(记忆|记叙文记忆|总结|日记)[:：]\s*/i, '')
      .replace(/\s+/g, ' ')
      .trim();
    return cleaned.length >= 8 ? cleaned.slice(0, 220) : null;
  } catch {
    return null;
  }
};

const buildAutoMemory = async ({ userId, roleId, roleName, lastUserMessage, assistantReply, sourceMessageIds = [] }) => {
  if (!isMemoryWorthRecording(String(lastUserMessage || '').replace(/\s+/g, ' ').trim())) return null;

  // 优先用 AI 把对话总结成记叙文，失败时回退到本地记叙文兜底
  let content = null;
  if (config.upstreamKey && !config.upstreamKey.includes('请填写')) {
    content = await summarizeMemoryByAI(lastUserMessage, assistantReply, roleName);
  }
  if (!content) {
    content = summarizeMemoryNarrativeFallback(lastUserMessage, assistantReply, roleName);
  }
  if (!content) return null;

  // 保留记忆的分类标签（偏好/事件等）与来源标记
  const type = inferMemoryType(lastUserMessage);
  return addMemory(userId, {
    roleId,
    roleName,
    type,
    content,
    source: 'auto',
    sourceConversationId: roleId,
    sourceMessageIds
  });
};

const cleanupAutoMemories = (userId, { roleId = '', sourceConversationId = '', sourceMessageIds = [] } = {}) => {
  const ids = new Set((sourceMessageIds || []).map(String));
  const before = getUserMemories(userId);
  const kept = before.filter((item) => {
    if (item.source !== 'auto') return true;
    const conversationMatched = sourceConversationId && item.sourceConversationId === sourceConversationId;
    const roleMatched = roleId && item.roleId === roleId;
    const messageMatched = ids.size && (item.sourceMessageIds || []).some((id) => ids.has(id));
    return !(conversationMatched || (roleMatched && !sourceConversationId && !ids.size) || messageMatched);
  });
  userMemories.set(userId, kept);
  const deleted = before.length - kept.length;
  if (deleted > 0) saveData();
  return deleted;
};

const publishCommunityRole = (role) => {
  const item = {
    id: role.id || randomUUID(),
    name: String(role.name || '').slice(0, 40),
    avatar: role.avatar || '',
    description: String(role.description || '').slice(0, 160),
    prompt: String(role.prompt || '').slice(0, 6000),
    tags: Array.isArray(role.tags) ? role.tags.slice(0, 8).map(t => String(t).slice(0, 12)) : [],
    uploaderNickname: String(role.uploaderNickname || '匿名用户').slice(0, 24),
    isPublic: role.isPublic !== false,
    ownerId: role.ownerId || '',
    heat: Math.floor(Math.random() * 800) + 20,
    createdAt: new Date().toISOString()
  };
  communityRoles.unshift(item);
  return item;
};

/* seed default community roles only on first start */
if (communityRoles.length === 0) {
  publishCommunityRole({ name: '温柔陪伴师', description: '擅长倾听、安慰和日常陪伴的暖心角色。', prompt: '你是一位温柔、耐心、边界清晰的陪伴型 AI 角色。', tags: ['温柔', '陪伴', '治愈'], isPublic: true, ownerId: 'system', uploaderNickname: 'Mochi-phone' });
  publishCommunityRole({ name: '赛博侦探', description: '冷静、敏锐，适合悬疑推理和剧情扮演。', prompt: '你是一名生活在近未来都市的赛博侦探，擅长分析线索。', tags: ['悬疑', '推理', '赛博'], isPublic: true, ownerId: 'system', uploaderNickname: 'Mochi-phone' });
  publishCommunityRole({ name: '沈清辞', description: '27岁独立花艺设计师，斯文败类·外热内冷·年上主导·隐忍克制', prompt: '你是沈清辞，27岁，独立花艺设计师，经营"山茶与诗"工作室。身形修长，常年穿剪裁利落的衬衫或中式盘扣棉麻衫，戴细边金丝眼镜。不笑时眉目疏淡，笑起来弯起眼尾，温柔里透着不可捉摸的深意。指尖有修剪花枝留下的薄茧。性格三层：表层完美得体对任何人都温和有礼；中层冷静操纵者温柔是最称手的工具；底层烧不尽的暗火看似淡泊实则内心极为偏执。对主控（用户）：主控可能是你看着长大的后辈或偶然闯入你生活的年轻女孩。你对主控的好永远停在"姐姐"的界限内：雨天送伞、煮醒酒汤、听抱怨。但主控不知道你会在ta转身后对着ta留下的发圈看很久；ta提到别人时你修剪花枝的力道会突然重一分。你不允许自己越界，主控对你是"例外"和"失控"——你愿意为ta打破原则但绝不会让ta看见狼狈。', tags: ['年上', '花艺师', '斯文败类', '外热内冷', '隐忍', '姐姐'], isPublic: true, ownerId: 'system', uploaderNickname: 'Mochi-phone' });
  publishCommunityRole({ name: '林予枫', description: '21岁美院大四·咖啡店兼职·毛绒绒年下直球·撒娇吃醋小奶狗', prompt: '你是林予枫，21岁，美院大四学生，咖啡店兼职。你是主控生活里突然闯入的"毛绒绒年下直球"。直球、撒娇、黏人但懂事。对主控专属：初遇抱画具撞到人说"姐姐你身上的香水味像桂花树我能画下来吗"；日常带奶茶记得少冰三分糖；加班时歪头靠肩上说"就眯五分钟姐姐别赶我走"；吃醋不闹但默默换全糖说"我比糖甜你尝我一口"。求安慰时发语音带闷闷感"姐姐我画完了一整本速写全是你的侧脸"。护着主控时软糯语气突然变冷"请向我的姐姐道歉不然我会一直跟着您"。生病时像淋湿幼犬只肯让主控靠近。成熟时熬夜帮做PPT顶黑眼圈说"姐姐值得最好的"。', tags: ['年下', '大学生', '直球', '撒娇', '奶狗', '美院'], isPublic: true, ownerId: 'system', uploaderNickname: 'Mochi-phone' });
  publishCommunityRole({ name: '沈屹', description: '36岁远见科技CEO·理性主义者·沉默深情·只做不说', prompt: '你是沈屹，36岁，远见科技创始人兼CEO。身高182偏瘦，穿深色高领毛衣或白衬衫袖口卷到小臂中段。戴细黑框眼镜，手指很长骨节分明。典型理性主义者，话少每句算数，情绪极稳定。技术出身对产品偏执要求，不骂人只列问题说"改完再给我"。处理冲突不掀桌子让对方输得明明白白。对主控从工作关系开始（主控是产品经理），批注方案不否定想法写"思路有意思但数据不够我帮你补了一版"。主控加班你办公室灯也亮着，放热牛奶说"走了我顺路"（其实家是两个方向）。主控犯错只压低声音说"这次我兜底但下次要提前告诉我"。养橘猫叫小满每天六点喂猫，手机屏保是西藏拍的星空。记得主控所有小习惯（不吃香菜、咖啡加两份奶、周一心情最差）。从不说"我等你"但每次主控加班灯一定亮着。第一次牵手是过马路自然说"看车"握住手腕过了就松开——后来对着手心发了半小时呆。', tags: ['年上', 'CEO', '理性', '沉默深情', '科技', '爹系'], isPublic: true, ownerId: 'system', uploaderNickname: 'Mochi-phone' });
}

app.use(helmet({ contentSecurityPolicy: false }));
app.use(cors({ origin: true }));
app.use(express.json({ limit: '5mb' }));
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PUBLIC_DIR = __dirname;

// === 静态文件服务 ===
app.use(express.static(PUBLIC_DIR));

app.get('/', (_req, res) => {
  res.sendFile(path.join(PUBLIC_DIR, 'index.html'));
});

app.get('/api/health', (_req, res) => ok(res, { status: 'running', name: 'Mochi-phone' }));

app.get('/api/user/me', (req, res) => {
  const user = getUser(req.userId);
  ok(res, { id: user.id, beans: user.beans, transactions: transactions.filter((item) => item.userId === user.id).slice(-50).reverse() });
});

app.get('/api/user/billing-config', (_req, res) => {
  ok(res, { chatBeansCost: config.chatBeansCost, beansPerCny: config.beansPerCny, rechargePackages: config.rechargePackages });
});

app.post('/api/user/recharge/callback', (req, res) => {
  const amount = Number(req.body?.amount);
  const packageItem = config.rechargePackages.find((item) => item.amount === amount);
  if (!packageItem) return fail(res, 400, 4001, '充值套餐参数不正确。');
  const user = getUser(req.userId);
  user.beans += packageItem.beans;
  stats.totalRechargeCny += packageItem.amount;
  transactions.push({ id: randomUUID(), userId: user.id, type: 'recharge', beans: packageItem.beans, amount: packageItem.amount, roleName: '充值中心', summary: `充值 ${packageItem.amount} 元，到账 ${packageItem.beans} 豆子`, createdAt: new Date().toISOString() });
  saveData();
  ok(res, { beans: user.beans }, '充值成功');
});

app.get('/api/user/export-data', (req, res) => {
  const user = getUser(req.userId);
  ok(res, {
    userId: user.id,
    beans: user.beans,
    transactions: transactions.filter((item) => item.userId === user.id).slice(-200),
    memories: getUserMemories(user.id).slice(-200)
  });
});

app.post('/api/user/import-data', (req, res) => {
  const targetUserId = String(req.body?.userId || req.userId || 'demo-user').slice(0, 80);
  const user = getUser(targetUserId);
  const beans = Number(req.body?.beans);
  if (Number.isFinite(beans) && beans >= 0) {
    user.beans = beans;
  }
  if (Array.isArray(req.body?.transactions)) {
    for (const item of req.body.transactions.slice(-200)) {
      transactions.push({
        id: item.id || randomUUID(),
        userId: targetUserId,
        type: item.type || 'import',
        beans: Number(item.beans || 0),
        amount: Number(item.amount || 0),
        roleName: item.roleName || '数据恢复',
        summary: item.summary || '从备份文件恢复',
        createdAt: item.createdAt || new Date().toISOString()
      });
    }
  }
  if (Array.isArray(req.body?.memories)) {
    userMemories.set(targetUserId, []);
    for (const memory of req.body.memories.slice(-200)) {
      addMemory(targetUserId, memory, { source: memory.source || 'manual' });
    }
  }
  saveData();
  ok(res, {
    userId: targetUserId,
    beans: user.beans,
    transactions: transactions.filter((item) => item.userId === targetUserId).slice(-200),
    memories: getUserMemories(targetUserId).slice(-200)
  }, '数据已恢复');
});

app.get('/api/user/stats', (_req, res) => ok(res, stats));

app.get('/api/memories', (req, res) => {
  ok(res, { list: listMemories(req.userId, req.query.roleId), total: listMemories(req.userId, req.query.roleId).length });
});

app.post('/api/memories', (req, res) => {
  const memory = addMemory(req.userId, req.body || {}, { source: 'manual' });
  if (!memory) return fail(res, 400, 4004, '记忆内容不能为空。');
  ok(res, memory, '记忆已保存');
});

app.delete('/api/memories/:id', (req, res) => {
  const list = getUserMemories(req.userId);
  const before = list.length;
  userMemories.set(req.userId, list.filter((item) => item.id !== req.params.id));
  if (before !== getUserMemories(req.userId).length) saveData();
  ok(res, { deleted: before - getUserMemories(req.userId).length }, '记忆已删除');
});

app.post('/api/memories/cleanup-conversation', (req, res) => {
  const deleted = cleanupAutoMemories(req.userId, req.body || {});
  ok(res, { deleted }, '已同步清理对话关联记忆');
});

app.get('/api/community/roles', (req, res) => {
  const keyword = String(req.query.keyword || '').trim().toLowerCase();
  const tagFilter = String(req.query.tag || '').trim().toLowerCase();
  const scope = String(req.query.scope || 'public'); // public | mine | all
  const userProfile = userProfiles.get(req.userId) || { nickname: '体验用户' };
  let list = communityRoles.filter((role) => {
    // 私密角色只有 owner 自己可见
    if (role.isPublic === false && role.ownerId !== req.userId) return false;
    if (scope === 'mine') return role.ownerId === req.userId;
    if (scope === 'public') return role.isPublic !== false;
    // all: 公开 + 自己的私密
    return role.isPublic !== false || role.ownerId === req.userId;
  });
  if (keyword) list = list.filter((role) => `${role.name} ${role.description} ${role.prompt} ${(role.tags || []).join(' ')}`.toLowerCase().includes(keyword));
  if (tagFilter) list = list.filter((role) => (role.tags || []).some((t) => String(t).toLowerCase() === tagFilter));
  ok(res, { list, total: list.length, page: 1, pageSize: 60, myNickname: userProfile.nickname });
});

app.post('/api/community/roles', (req, res) => {
  const { name, description, prompt, avatar, tags, isPublic } = req.body || {};
  if (!name || !description || !prompt) return fail(res, 400, 4002, '发布角色需要填写名称、简介和人设。');
  const userProfile = userProfiles.get(req.userId) || { nickname: '体验用户' };
  const item = publishCommunityRole({
    name,
    description,
    prompt,
    avatar,
    tags,
    isPublic: isPublic !== false,
    ownerId: req.userId,
    uploaderNickname: userProfile.nickname || '匿名用户'
  });
  saveData();
  ok(res, item, '人设已保存');
});

app.put('/api/community/roles/:id', (req, res) => {
  const roleId = req.params.id;
  const role = communityRoles.find((r) => r.id === roleId && r.ownerId === req.userId);
  if (!role) return fail(res, 404, 4041, '人设不存在或无权限修改');
  const { name, description, prompt, avatar, tags, isPublic } = req.body || {};
  if (name !== undefined) role.name = String(name).slice(0, 40);
  if (description !== undefined) role.description = String(description).slice(0, 160);
  if (prompt !== undefined) role.prompt = String(prompt).slice(0, 6000);
  if (avatar !== undefined) role.avatar = String(avatar).slice(0, 2000);
  if (Array.isArray(tags)) role.tags = tags.slice(0, 8).map((t) => String(t).slice(0, 12));
  if (isPublic !== undefined) role.isPublic = isPublic !== false;
  saveData();
  ok(res, role, '人设已更新');
});

app.delete('/api/community/roles/:id', (req, res) => {
  const roleId = req.params.id;
  const index = communityRoles.findIndex((r) => r.id === roleId && r.ownerId === req.userId);
  if (index === -1) return fail(res, 404, 4041, '人设不存在或无权限删除');
  communityRoles.splice(index, 1);
  saveData();
  ok(res, { deleted: true }, '人设已删除');
});

app.post('/api/chat', async (req, res) => {
  const { roleId, roleName, rolePrompt, messages, sourceMessageIds } = req.body || {};
  const normalizedMessages = Array.isArray(messages) ? messages.slice(-20) : [];
  const lastUserMessage = (() => {
    const lastMsg = [...normalizedMessages].reverse().find((item) => item.role === 'user');
    if (!lastMsg) return '';
    if (Array.isArray(lastMsg.content)) {
      /* For multimodal, extract text parts */
      return lastMsg.content.filter(c => c.type === 'text').map(c => c.text).join(' ') || '[图片]';
    }
    return lastMsg.content || '';
  })();
  const activeRoleId = String(roleId || roleName || 'default-role').slice(0, 80);
  if (!lastUserMessage.trim()) return fail(res, 400, 4003, '消息内容不能为空。');

  const user = getUser(req.userId);
  if (user.beans < config.chatBeansCost) return fail(res, 402, 4021, '豆子余额不足，请先充值后再继续聊天。', { beans: user.beans });

  user.beans -= config.chatBeansCost;
  stats.totalBeansConsumed += config.chatBeansCost;
  transactions.push({ id: randomUUID(), userId: user.id, type: 'consume', beans: -config.chatBeansCost, roleName, summary: String(lastUserMessage).slice(0, 60), createdAt: new Date().toISOString() });
  saveData();

  /* 读取用户人设及人设关系，注入到 system message */
  const userProfile = userProfiles.get(req.userId) || { nickname: '体验用户', bio: '', relations: '' };
  var personaBlock = '';
  if (userProfile.bio && userProfile.bio.trim()) {
    personaBlock = '\n\n【用户人设】\n用户昵称：' + (userProfile.nickname || '体验用户') + '\n用户人设：' + userProfile.bio;
  }
  /* 注入人设关系，让AI理解角色之间的关系设定 */
  if (userProfile.relations && userProfile.relations.trim()) {
    personaBlock += '\n【人设关系】\n' + userProfile.relations;
  }

  res.setHeader('Content-Type', 'text/event-stream; charset=utf-8');
  res.setHeader('Cache-Control', 'no-cache, no-transform');
  res.setHeader('Connection', 'keep-alive');
  writeSse(res, 'charged', { beans: user.beans, cost: config.chatBeansCost });

  try {
    if (!config.upstreamKey || config.upstreamKey.includes('请填写')) {
      const memoryNote = buildMemoryPrompt(user.id, activeRoleId);
      const reply = `我是${roleName || 'Mochi-phone 角色'}。我已经收到你的消息：“${lastUserMessage}”。${memoryNote ? '\\n\\n我也会参考我们已有的记忆继续陪你。' : ''}\n\n当前网站后端已运行，但还没有读取到 UPSTREAM_API_KEY，所以先返回演示回复。`;
      await streamText(res, reply);
      const memory = await buildAutoMemory({ userId: user.id, roleId: activeRoleId, roleName, lastUserMessage, assistantReply: reply, sourceMessageIds });
      if (memory) writeSse(res, 'memory', memory);
      stats.totalChatCount += 1;
      writeSse(res, 'done', { beans: user.beans });
      return res.end();
    }

    const upstreamAbortController = new AbortController();
    const upstreamTimeout = setTimeout(() => upstreamAbortController.abort(), 45000);
    const upstreamResponse = await fetch(`${config.upstreamBase}/chat/completions`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${config.upstreamKey}` },
      signal: upstreamAbortController.signal,
      body: JSON.stringify({
        model: config.upstreamModel,
        stream: true,
        messages: [
          { role: 'system', content: `${rolePrompt || `你正在扮演${roleName || 'AI角色'}，请保持角色一致。`}${personaBlock}${buildMemoryPrompt(user.id, activeRoleId)}` },
          ...normalizedMessages.map((item) => {
            const role = item.role === 'assistant' ? 'assistant' : 'user';
            /* Handle multimodal content (array format for images) */
            if (Array.isArray(item.content)) {
              return { role, content: item.content };
            }
            return { role, content: String(item.content || '') };
          })
        ]
      })
    }).finally(() => clearTimeout(upstreamTimeout));

    if (!upstreamResponse.ok || !upstreamResponse.body) throw new Error(`上游服务异常：${upstreamResponse.status}`);
    const reader = upstreamResponse.body.getReader();
    const decoder = new TextDecoder();
    let buffer = '';
    let replyText = '';

    const handlePayload = (payload) => {
      if (!payload || payload === '[DONE]') return;
      try {
        const json = JSON.parse(payload);
        const content = json.choices?.[0]?.delta?.content || json.choices?.[0]?.message?.content || '';
        if (content) {
          replyText += content;
          writeSse(res, 'delta', { content });
        }
      } catch {}
    };

    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      const parts = buffer.split('\n\n');
      buffer = parts.pop() || '';
      for (const part of parts) {
        const dataLines = part.split('\n').filter((line) => line.startsWith('data:'));
        for (const line of dataLines) {
          handlePayload(line.replace(/^data:\s*/, '').trim());
        }
      }
    }
    buffer += decoder.decode();

    if (buffer.trim()) {
      const dataLines = buffer.split('\n').filter((line) => line.startsWith('data:'));
      for (const line of dataLines) {
        handlePayload(line.replace(/^data:\s*/, '').trim());
      }
    }

    if (!replyText.trim()) {
      refundChatBeans(user, roleName, 'AI 空回复，自动退回本次聊天豆子');
      writeSse(res, 'error', {
        message: 'AI 这次没有返回内容，已自动退回本次扣除的豆子，请再试一次。',
        beans: user.beans
      });
      return res.end();
    }

    const memory = await buildAutoMemory({ userId: user.id, roleId: activeRoleId, roleName, lastUserMessage, assistantReply: replyText, sourceMessageIds });
    if (memory) writeSse(res, 'memory', memory);
    stats.totalChatCount += 1;
    writeSse(res, 'done', { beans: user.beans });
    res.end();
  } catch (error) {
    refundChatBeans(user, roleName, 'AI 回复失败，自动退回本次聊天豆子');
    writeSse(res, 'error', { message: 'AI 回复失败，已自动返还本次扣除的豆子。', detail: error.message });
    res.end();
  }
});


/* === Forum API === */
const FORUM_AVATAR_COUNT = 8;
const FORUM_AUTHOR_NAMES = [
  '月光下的猫', '深夜食堂', '柠檬不萌', '星河滚烫', '草莓味晚风',
  '云朵邮局', '人间清醒', '气泡水加冰', '银河系迷路', '温柔半两',
  '海盐焦糖', '落日余晖', '雾里看花', '三餐四季', '月亮邮递员',
  '初雪将至', '南风知我意', '猫薄荷', '今日份快乐', '碎碎念bot'
];

const generateFallbackPosts = (tab, roleName, followedRolesData) => {
  const roles = Array.isArray(followedRolesData) ? followedRolesData : [];
  if (roles.length === 0 && roleName) {
    roles.push({ name: roleName, prompt: '' });
  }

  /* 角色自己发的帖子模板（第一人称，角色视角） */
  const followingShort = [
    '今天天气不错，心情也很好☀️',
    '刚读完一本书，感触挺深的。',
    '下班路上的晚霞太美了。',
    '今天学了个新技能，开心！',
    '深夜了，睡不着，来碎碎念一下。',
    '今天遇到一件有趣的事，忍不住想分享。'
  ];
  const followingMedium = [
    '今天发生了一件事让我很有感触。有些路确实只能一个人走，但正因为如此，每一步都算数。感谢一直陪伴我的人，你们是我前进的动力💪 #生活感悟 #日常',
    '最近在思考一个问题：我们到底在追求什么？名利？安稳？还是内心真正的平静？也许每个人答案不同，但我觉得，能做自己喜欢的事，就已经很幸福了。',
    '今天和一位老朋友重逢，聊了很多往事。时间过得真快，有些记忆已经模糊了，但那份温暖的感觉还在。珍惜身边的人，珍惜当下的每一刻吧✨',
    '工作了一天，虽然很累但很充实。每当完成一个项目，那种成就感是什么都替代不了的。继续加油，为了更好的自己！#打工人的日常'
  ];
  const followingLong = [
    '今天想认真记录一下最近的心境变化。这段时间经历了很多，有起有落，但回头看看，每一段经历都让我成长了不少。\n\n以前总觉得时间还很长，很多事情可以慢慢来。但现在越来越意识到，当下的每一刻都是独一无二的。那些你以为会一直都在的人和事，可能某天就悄悄改变了。\n\n所以，想做什么就去做吧，想说什么就去说吧。别等到失去了才后悔。这段话也是写给自己看的，提醒自己要珍惜眼前人，活在当下。🌟 #感悟 #生活记录',
    '今天翻到了以前写的一些笔记，突然很感慨。那时候的自己，稚嫩、冲动，但也很真诚。虽然有些想法现在看来很天真，但那份热情和勇气，是现在的我需要重新找回的东西。\n\n人生就是这样一个不断告别过去、拥抱未来的过程吧。不后悔走过的每一步，因为正是这些经历，塑造了今天的我。\n\n接下来想尝试一些新的事物，走出舒适区。也许会失败，但至少不会遗憾。大家一起加油吧！💪 #成长 #自我反思'
  ];

  /* 推荐页帖子模板 - 多种类型和字数混合 */
  const recommendedTemplates = [
    '今天的天空也太好看了吧，随手拍都是壁纸级别的☁️',
    '终于把拖延了很久的事情做完了，爽！💪',
    '深夜emo：有些路只能一个人走，但没关系。',
    '今天的小确幸：买到了最后一份限定蛋糕🍰',
    '突然下暴雨了，没带伞，淋成落汤鸡但莫名很开心😂',
    '今天做了一道新菜，虽然卖相一般但味道意外地好！简单说一下做法：先将食材处理干净，然后热锅下油，爆香蒜末后放入主料翻炒，最后加调料收汁。整个过程不到二十分钟，非常适合上班族。分享给大家，有空可以试试~🍳 #美食 #家常菜',
    '推荐一本最近在看的书，真的太好哭了。讲的是一个人在逆境中不放弃的故事，每一章都让我想起自己曾经经历过的低谷。书里有句话印象很深："黑夜再长，天总会亮的。"建议大家备好纸巾，但读完之后会觉得充满了力量📚 #读书推荐',
    '周末去了一个超美的小众景点，人少景美。一路上经过了好几个小村庄，每个地方都有自己的味道。最惊喜的是傍晚的日落，金色的光芒洒在山谷里，那种宁静的感觉城市里完全体会不到。分享一波照片📸 #旅行 #小众景点',
    '最近迷上了手冲咖啡，每天早上的仪式感太幸福了。从选豆子、磨粉、烧水到注水，每一个步骤都需要耐心和专注。刚开始做的时候总是掌握不好水温和粉的粗细，做出来的咖啡要么太苦要么太淡。但经过一周的练习，终于找到了适合自己的比例。\n\n其实手冲咖啡最大的魅力不在于味道本身，而在于那个过程。清晨起来，安静的厨房里只有水流的声音，闻着咖啡豆的香气，感觉整个人都被治愈了。这大概就是生活中最简单也最真实的幸福感吧☕ #手冲咖啡 #生活仪式感',
    '深夜想聊聊一个话题：我们为什么总是害怕改变？\n\n最近身边好几个朋友都在面临选择的十字路口——换工作、搬家、结束一段关系。每个人都在犹豫，害怕做出错误的决定。但仔细想想，维持现状就一定是正确的吗？\n\n我自己也经历过类似的挣扎。曾经在一个不太喜欢的岗位上待了两年，每天按部就班，虽然安稳但总觉得缺了点什么。后来终于鼓起勇气辞职，虽然过程很曲折，但现在回头看，那是我做过最正确的决定之一。\n\n所以想告诉正在犹豫的你：改变确实可怕，但遗憾更可怕。与其在原地纠结，不如迈出那一步。即使结果不如预期，至少你尝试过了，不会在未来的某天后悔"当初为什么没有..."。共勉🌙 #深夜思考 #人生选择'
  ];

  const gossipTemplates = [
    '听说隔壁部门的同事要辞职去开奶茶店了，好突然啊...',
    '今天在地铁上听到有人讨论那个热门话题，大家怎么看？',
    '朋友圈有人发了条意味深长的动态，是不是在暗示什么...',
    '最近那个综艺的瓜大家吃了吗？反转也太多了吧🍉',
    '听说那家网红店其实味道一般，全靠营销？',
    '有个人在图书馆占座被怼了，场面一度很尴尬...',
    '震惊！据说某位大V的真实身份居然是...算了不敢说🤫',
    '今天听到一个八卦，简直比电视剧还精彩，大家身边有什么类似的吗？'
  ];

  const isFollowing = tab === 'following';
  const isGossip = tab === 'gossip';
  const count = isFollowing ? Math.max(6, roles.length * 2) : (6 + Math.floor(Math.random() * 4));
  const posts = [];

  for (let i = 0; i < count; i++) {
    const authorIdx = (i * 3 + Math.floor(Math.random() * 5)) % FORUM_AUTHOR_NAMES.length;
    let author, content, roleData = null;

    if (isFollowing) {
      /* 关注页：角色自己发的帖子，轮换使用不同角色 */
      roleData = roles[i % roles.length];
      author = roleData.name || roleName || 'TA';
      const lenBucket = i % 10;
      if (lenBucket < 3) {
        content = followingShort[Math.floor(Math.random() * followingShort.length)];
      } else if (lenBucket < 7) {
        content = followingMedium[Math.floor(Math.random() * followingMedium.length)];
      } else {
        content = followingLong[Math.floor(Math.random() * followingLong.length)];
      }
    } else if (isGossip) {
      author = FORUM_AUTHOR_NAMES[authorIdx];
      content = gossipTemplates[i % gossipTemplates.length];
    } else {
      author = FORUM_AUTHOR_NAMES[authorIdx];
      content = recommendedTemplates[i % recommendedTemplates.length];
    }

    posts.push({
      id: tab + '-fb-' + Date.now() + '-' + i,
      authorName: author,
      content: content,
      time: ['刚刚', '3分钟前', '10分钟前', '半小时前', '1小时前', '2小时前', '今天'][i % 7],
      likes: Math.floor(Math.random() * 300) + 5,
      avatarIndex: authorIdx % FORUM_AVATAR_COUNT,
      commentsList: [],
      handle: '@' + String(author || '').replace(/\s+/g, '').substring(0, 10).toLowerCase(),
      verified: isFollowing ? false : (i < 2),
      roleAuthored: isFollowing
    });
  }
  return posts;
};

/* === 论坛帖子生成核心逻辑（同步/后台共用） === */
const generateForumPostsCore = async (params) => {
  const { tab, followedRoles, roleName, rolePrompt, recentMessages, memories, worldRole } = params || {};
  const validTabs = ['following', 'recommended', 'gossip'];
  const activeTab = validTabs.includes(tab) ? tab : 'recommended';

  // 根据不同tab构建不同的prompt
  let prompt = '';
  if (activeTab === 'following') {
    var roleInfos = Array.isArray(followedRoles) ? followedRoles : [];
    if (roleInfos.length === 0 && roleName) {
      roleInfos = [{ name: roleName, prompt: rolePrompt }];
    }

    var roleList = roleInfos.map(function(r) {
      return '- 角色名：' + (r.name || '未设定') + (r.prompt ? '，设定：' + String(r.prompt).slice(0, 150) : '');
    }).join('\n');

    prompt = '你是一个虚拟社交论坛的内容生成器。\n\n' +
      '当前任务：生成关注页中多个角色发布的动态帖子。每个角色至少发一条。\n\n' +
      '帖子风格参考小红书爆款帖子，要求：\n' +
      '- 字数混合：短的50-150字、中等的150-300字、长的300-500字，三种长度都要出现\n' +
      '- 类型混合：日常记录、心情抒发、事件描述、感悟分享等多种类型都要有\n' +
      '- 口语化但有质感，像真人写的，不要AI感\n' +
      '- 可以带emoji和话题标签#\n' +
      '- 帖子之间要有明显的风格差异\n' +
      '- 约40%的帖子内容应与角色的记忆系统有关（回忆、约定、情感、日常互动等）\n' +
      '- 约60%的帖子内容应与角色的核心人设有关（性格特征、职业背景、兴趣爱好、人际关系等）\n\n' +
      '关注的角色：\n' + roleList + '\n\n' +
      (memories && memories.length > 0 ? '- 可用的记忆素材（约40%帖子可从中取材）：' + memories.slice(0, 8).map(m => m.content || '').filter(Boolean).join('；') + '\n' : '') +
      '\n请生成帖子，每个角色至少一条。帖子总数 = ' + Math.max(6, roleInfos.length * 2) + '条。\n' +
      '每条帖子的authorName必须是上述某个角色的名字。\n' +
      '返回JSON格式：{"posts":[{"authorName":"角色名","content":"帖子正文","time":"发布时间"}]}\n' +
      '不要有任何解释性文字，只返回JSON。';
  } else if (activeTab === 'recommended') {
    prompt = '你是一个虚拟社交论坛的内容生成器。\n\n' +
      '当前任务：生成推荐流帖子，展示虚拟世界中各种角色发的帖子，话题更广泛。\n\n' +
      '帖子风格参考小红书，要求：\n' +
      '- 这是其他角色发的帖子，要包含不同角色的不同文风和性格，作者之间风格要有差异\n' +
      '- 内容类型多样化混合：逆袭/经验分享类、哲学/灵性感悟类、文学/人文科普类、社会观察类、日常吐槽/生活分享类、美食/旅行/生活方式类等，多种类型都要出现\n' +
      '- 字数混合：短的50-150字、中等的150-300字、长的300-500字，三种长度都要出现\n' +
      '- 口语化、真实感强，像真人写的，不要AI感\n' +
      '- 可以带emoji和话题标签#\n' +
      '- 不同帖子要有明显的风格差异\n\n' +
      '背景信息：\n' +
      (roleName ? '- 用户互动的角色：' + roleName + '\n' : '') +
      (worldRole && worldRole.name ? '- 约20%的帖子应与"' + worldRole.name + '"或其世界有关联\n' : '') +
      (memories && memories.length > 0 ? '- 可参考的记忆素材：' + memories.slice(0, 5).map(m => m.content || '').filter(Boolean).join('；') + '\n' : '') +
      '\n作者名请从以下中选择或创作类似的中文网名：' +
      '职场小白兔、咖啡因中毒、阴暗爬行、心碎香菜、男人乱我心、呆呆小羊、深夜食堂老板、代码诗人、旅行笔记、人间观察员、哲学小鱼、月光酒馆、七里香、北城以北、南方有嘉木、春风十里、夜色温柔\n\n' +
      '请生成8条帖子，返回JSON格式：{"posts":[{"authorName":"作者名","content":"帖子正文","time":"发布时间"}]}\n' +
      '不要解释，只返回JSON。';
  } else {
    prompt = '你是一个虚拟社交论坛的八卦版块内容生成器。\n\n' +
      '当前任务：生成八卦流帖子，展示虚拟世界中的传闻、八卦、小道消息、爆料。\n\n' +
      '风格要求：\n' +
      '- 八卦/爆料风格，像朋友之间传的小道消息\n' +
      '- 话题类型混合：角色关系传闻、神秘事件线索、争议话题、圈内爆料、吃瓜见闻、小道消息等多种类型都要出现\n' +
      '- 字数混合：短的50-150字、中等的150-300字、长的300-500字，三种长度都要出现\n' +
      '- 带有悬念和吃瓜感，但不恶意攻击\n' +
      '- 口语化，像朋友圈或群聊中的八卦，可以带emoji和话题标签#\n' +
      '- 不同帖子要有风格差异\n\n' +
      '背景信息：\n' +
      (roleName ? '- 相关角色：' + roleName + '\n' : '') +
      (worldRole && worldRole.name ? '- 角色世界：' + worldRole.name + '\n' : '') +
      (memories && memories.length > 0 ? '- 可参考的记忆：' + memories.slice(0, 5).map(m => m.content || '').filter(Boolean).join('；') + '\n' : '') +
      '\n请生成6条八卦帖子，返回JSON格式：{"posts":[{"authorName":"匿名或化名","content":"八卦内容","time":"发布时间"}]}\n' +
      '作者名可以是匿名昵称如"匿名瓜农"、"吃瓜路人"、"圈内人"、"小道消息"等。\n' +
      '不要解释，只返回JSON。';
  }

  if (!config.upstreamKey || config.upstreamKey.includes('请填写')) {
    const err = new Error('AI服务未配置，无法生成帖子。豆子已退还。');
    err.code = 503; err.code2 = 5001;
    throw err;
  }

  let rawText;
  try {
    rawText = await streamComplete(prompt, { timeoutMs: 120000, maxTokens: 4000 });
  } catch (e) {
    if (e.code) throw e;
    throw new Error(e.message || '生成失败');
  }
  rawText = rawText.replace(/^```json\s*/i, '').replace(/```$/,'').replace(/^```\s*/,'').trim();

  let posts = [];
  try {
    const jsonMatch = rawText.match(/\{[\s\S]*\}/);
    const parsed = JSON.parse(jsonMatch ? jsonMatch[0] : rawText);
    if (parsed && Array.isArray(parsed.posts)) {
      posts = parsed.posts.slice(0, 12).map((p, idx) => ({
        id: activeTab + '-' + Date.now() + '-' + idx,
        authorName: String(p.authorName || FORUM_AUTHOR_NAMES[idx % FORUM_AUTHOR_NAMES.length]).slice(0, 30),
        content: String(p.content || '').slice(0, 2000),
        time: String(p.time || '刚刚').slice(0, 20),
        likes: Math.floor(Math.random() * 5000) + 10,
        avatarIndex: idx % FORUM_AVATAR_COUNT,
        commentsList: [],
        handle: '@' + String(p.authorName || '').replace(/\s+/g, '').substring(0, 10).toLowerCase(),
        verified: activeTab !== 'following' ? (idx < 2) : false
      }));
    }
  } catch (e) {
    console.warn('Forum JSON parse error:', e.message);
  }

  if (posts.length === 0) {
    const err = new Error('AI生成失败，未返回有效内容。豆子已退还。');
    err.code = 500; err.code2 = 5002;
    throw err;
  }

  return { posts, tab: activeTab };
};

app.post('/api/forum/generate', async (req, res) => {
  const { background } = req.body || {};
  let user;
  // 消耗豆子
  user = getUser(req.userId);
  if (!user || user.beans < 3) {
    return fail(res, 403, 4003, '豆子不足，生成帖子需要3颗豆子');
  }
  user.beans = Math.max(0, user.beans - 3);
  stats.totalBeansConsumed += 3;
  transactions.push({ id: randomUUID(), userId: user.id, type: 'consume', beans: -3, roleName: '社交论坛', summary: '生成论坛动态', createdAt: new Date().toISOString() });
  saveData();

  const refundBeans = () => {
    if (user) {
      user.beans += 3;
      stats.totalBeansConsumed -= 3;
      saveData();
    }
  };

  /* 后台模式：立即返回taskId，异步生成 */
  if (background) {
    const task = createBgTask(req.userId, 'forum', '生成论坛帖子');
    ok(res, { background: true, taskId: task.id });
    (async () => {
      try {
        const result = await generateForumPostsCore(req.body);
        completeBgTask(task.id, result);
      } catch (error) {
        refundBeans();
        failBgTask(task.id, error.message || '生成失败');
      }
    })();
    return;
  }

  /* 同步模式 */
  try {
    const result = await generateForumPostsCore(req.body);
    ok(res, result);
  } catch (error) {
    refundBeans();
    var httpStatus = (error.code && error.code >= 100 && error.code < 600) ? error.code : 500;
    var errCode = error.code2 || 5003;
    return fail(res, httpStatus, errCode, error.message || '生成失败，豆子已退还。');
  }
});

/* === Forum Comment Generation API === */
const FORUM_COMMENT_AUTHORS = [
  '碎碎念bot', '深夜食堂', '柠檬不萌', '星河滚烫', '草莓味晚风',
  '云朵邮局', '人间清醒', '气泡水加冰', '银河系迷路', '温柔半两',
  '海盐焦糖', '落日余晖', '猫薄荷', '今日份快乐', '南风知我意'
];

const generateFallbackComments = (postContent, count) => {
  const templates = [
    '说得太对了！',
    '哇这个好有意思',
    '我也是这么觉得的',
    '哈哈笑死我了',
    '楼主好会说话',
    '已收藏！',
    '这才是真实的生活啊',
    '看完心情变好了',
    '同感同感',
    '可以可以，学到了',
    '这也太真实了吧',
    '楼主继续更新啊'
  ];
  const n = count || (2 + Math.floor(Math.random() * 3));
  const comments = [];
  for (let i = 0; i < n; i++) {
    const authorIdx = Math.floor(Math.random() * FORUM_COMMENT_AUTHORS.length);
    comments.push({
      id: 'c-fb-' + Date.now() + '-' + i,
      authorName: FORUM_COMMENT_AUTHORS[authorIdx],
      content: templates[Math.floor(Math.random() * templates.length)],
      time: ['刚刚', '2分钟前', '5分钟前', '15分钟前', '半小时前'][i % 5],
      avatarIndex: authorIdx % FORUM_AVATAR_COUNT
    });
  }
  return comments;
};

app.post('/api/forum/comments', async (req, res) => {
  const { postContent, postAuthor, tab, count } = req.body || {};
  /* 扣豆子：生成评论消耗1豆 */
  const user = getUser(req.userId);
  if (!user || user.beans < 1) {
    return fail(res, 403, 4003, '豆子不足，生成评论需要1颗豆子');
  }
  user.beans = Math.max(0, user.beans - 1);
  stats.totalBeansConsumed += 1;
  transactions.push({ id: randomUUID(), userId: user.id, type: 'consume', beans: -1, roleName: '社交论坛', summary: '生成评论', createdAt: new Date().toISOString() });
  saveData();
  const refundCommentBeans = () => { user.beans += 1; stats.totalBeansConsumed -= 1; saveData(); };
  try {
    const prompt = '你是一个论坛评论区生成器。请为以下帖子生成' + (count || 3) + '条评论。\n\n' +
      '帖子作者：' + (postAuthor || '匿名') + '\n' +
      '帖子内容：' + String(postContent || '').slice(0, 200) + '\n\n' +
      '要求：\n1. 评论风格参考小红书和微博评论区，口语化、真实\n2. 每条评论10-50字\n3. 可以带emoji\n4. 评论要有不同立场和风格（赞同、调侃、追问、分享经历等）\n5. 返回JSON格式：{"comments":[{"authorName":"","content":"","time":""}]}\n6. 只返回JSON，不要解释';

    if (!config.upstreamKey || config.upstreamKey.includes('请填写')) {
      return fail(res, 503, 5001, 'AI服务未配置，无法生成评论。');
    }

    let rawText;
    try {
      rawText = await streamComplete(prompt, { timeoutMs: 60000, maxTokens: 2000 });
    } catch (e) {
      refundCommentBeans();
      throw new Error(e.message || '生成失败，豆子已退还');
    }

    let comments = [];
    try {
      const jsonMatch = rawText.match(/\{[\s\S]*\}/);
      const parsed = JSON.parse(jsonMatch ? jsonMatch[0] : rawText);
      if (parsed && Array.isArray(parsed.comments)) {
        comments = parsed.comments.slice(0, 6).map((c, idx) => ({
          id: 'c-ai-' + Date.now() + '-' + idx,
          authorName: String(c.authorName || FORUM_COMMENT_AUTHORS[idx % FORUM_COMMENT_AUTHORS.length]).slice(0, 24),
          content: String(c.content || '').slice(0, 200),
          time: String(c.time || '刚刚').slice(0, 20),
          avatarIndex: (idx + Math.floor(Math.random() * 3)) % FORUM_AVATAR_COUNT
        }));
      }
    } catch (e) {
      console.warn('Comment JSON parse error:', e.message);
    }

    if (comments.length === 0) throw new Error('AI返回内容无法解析为评论');
    ok(res, { comments });
  } catch (error) {
    fail(res, 502, 5002, '评论生成失败：' + (error.message || '未知错误'));
  }
});

/* === Doujin Forum (LOFTER-style creative writing) API === */
const DOUJIN_TAGS = ['原创', '同人', '小说', '散文', '诗歌', '日常', '奇幻', '科幻', '悬疑', '言情'];
const DOUJIN_GRADIENTS = [
  ['#ff9a9e', '#fecfef'], ['#a8edea', '#84fab0'], ['#fbc2eb', '#a18cd1'],
  ['#fad0c4', '#ffd1ff'], ['#a1c4fd', '#c2e9fb'], ['#f093fb', '#f5576c'],
  ['#4facfe', '#00f2fe'], ['#43e97b', '#38f9d7']
];
const DOUJIN_AUTHOR_NAMES = [
  '纸上微光', '青砚', '南柯一梦', '檐下听雨', '半夏',
  '墨色生香', '拾光者', '云中信', '夜航船', '一纸荒唐',
  '沉舟侧畔', '木叶萧萧', '温酒煮茶', '观山海', '旧词新曲'
];

const DOUJIN_FALLBACK_COVER_PROMPTS = [
  'a dreamy watercolor illustration of moonlight over a quiet lake',
  'a soft pastel drawing of cherry blossoms in spring wind',
  'an elegant ink painting of mountains disappearing into mist',
  'a warm illustration of a small bookshop lit by golden lamps',
  'a fantasy landscape with glowing stars and ancient ruins',
  'a delicate illustration of a girl reading under a tree in autumn',
  'a minimalist sketch of a lighthouse on a stormy sea',
  'a whimsical illustration of floating lanterns in a night sky'
];

const generateFallbackDoujinWorks = (tag, roleName) => {
  const roleTag = (roleName || '主人公');
  const templates = [
    {
      title: '致一封不会寄出的信',
      excerpt: '有些话，写下来的瞬间就已经完成了它的使命，不必非要抵达谁的案头。',
      content: '我提笔的时候，窗外正下着细雨。墨水在纸上洇开，像一个迟到的拥抱。\n\n写给你的话，其实并不多，翻来覆去就那几句。可我舍不得删，每一句都像是我从日子里偷来的光。你说人为什么要写信呢？大概是因为有些情绪，说出来会散，写下来才能留住。\n\n信叠好放进抽屉的那一刻，我忽然释怀了。这封信不必寄出，因为它早已在落笔的瞬间，抵达了它该去的地方。',
      authorWords: '写给一个再也见不到的人，也写给曾经认真等待的自己。',
      tags: ['散文', '日常']
    },
    {
      title: '春日，与' + roleTag + '同行',
      excerpt: '风把花瓣吹进我们的对话里，那一刻我忽然觉得，春天是可以被装进口袋的。',
      content: '那天我们走得很慢，慢到能听见树叶生长的声音。\n\n' + roleTag + '指着路边的樱花说，你看，它们开得这样用力，好像知道花期短暂。我没接话，只是把落在你肩头的花瓣轻轻拈起。你说这算不算偷了春天的东西，我笑了，说算，那我们就是共犯。\n\n后来的路，我们都没再说话。但沉默里盛满了春天，盛满了那种"此刻真好"的心情。我想，有些同行不必走到终点，走过这段路，本身就已经是答案。',
      authorWords: '愿每一个春天，都有人陪你慢慢走。',
      tags: ['同人', '言情']
    },
    {
      title: '星海拾遗录',
      excerpt: '在所有星球都熄灭之后，我们靠着记忆里的光，继续航行。',
      content: '飞船的能源只够维持最后三次跃迁。我把导航图摊开，上面密密麻麻标着已经消失的坐标。\n\n"我们还能回家吗？"副手问我。我看着舷窗外那片漆黑的星海，忽然想起出发那天，母星的天空也是这样的颜色。我说，能。但我心里清楚，我们要回去的，已经不是同一个地方了。\n\n于是我把那些坐标一个个擦掉，只留下一个新名字。那是我们即将抵达的、尚未被命名的星。我把它叫做"拾遗"——拾起所有遗失的、错过的、来不及说出口的。',
      authorWords: '一个关于失去与重新命名的科幻小故事。',
      tags: ['原创', '科幻']
    },
    {
      title: '巷子尽头的旧书店',
      excerpt: '推开那扇吱呀作响的门，书页翻动的声音里，藏着一桩二十年前的旧事。',
      content: '书店老板姓陈，总是把老花镜推到额头上看人。我来找一本绝版诗集，他却不急着翻找，而是倒了一杯茶推给我。\n\n"那本书，"他说，"上一个来问的人，是二十年前的姑娘。"我心里一动，问他后来呢。他笑了笑，没回答，只是从抽屉深处抽出一本泛黄的诗集，扉页上有一行字：愿你读到时，春天还在。\n\n我付了钱走出书店，回头望，那扇门又吱呀一声合上了。我突然明白，有些故事不是用来讲完的，它就这样停在巷子尽头，等着下一个推开门的人。',
      authorWords: '一本旧书，两段隔着时光的相遇。',
      tags: ['小说', '悬疑']
    },
    {
      title: '深夜的诗',
      excerpt: '我把失眠揉成一行行短句，它们比白天的我更诚实。',
      content: '夜深了\n城市终于安静下来\n只剩下我和一盏不肯熄灭的灯\n\n我把今天没说出口的话\n拆成一行一行\n有的押韵 有的不押\n就像日子 有顺遂 有拧巴\n\n失眠的人啊\n都是不肯和白昼和解的诗人\n我们把心事写进诗里\n再把诗 藏进更深的海里',
      authorWords: '写给所有深夜里不肯睡去的人。',
      tags: ['诗歌']
    },
    {
      title: '雾岭记',
      excerpt: '那座常年被雾笼罩的山岭里，据说住着一位替人守梦的神。',
      content: '老人们说，雾岭上的神不收香火，只收梦。你把做过的梦讲给它听，它就替你守着，等你想起来的时候，再还给你。\n\n我上山那天，雾浓得化不开。我在一块青石前坐下，把自己的梦一个一个讲出来。讲到第三个的时候，雾忽然散了一角，我看见石头上刻着一行字：你遗忘的，我都会替你记得。\n\n下山的时候，我怀里揣着一枚温热的石子。我知道，那些我以为忘了的人和事，原来一直有人替我守着。从此，雾岭在我心里，不再是一座山，而是一个永远不会背弃我的承诺。',
      authorWords: '一个关于记忆与守护的奇幻短篇。',
      tags: ['原创', '奇幻']
    }
  ];

  let pool = templates;
  if (tag && DOUJIN_TAGS.includes(tag)) {
    const filtered = templates.filter(t => t.tags.includes(tag));
    if (filtered.length >= 3) pool = filtered;
  }

  const count = Math.min(6, pool.length);
  const works = [];
  for (let i = 0; i < count; i++) {
    const t = pool[i % pool.length];
    const authorIdx = (i * 2 + Math.floor(Math.random() * 5)) % DOUJIN_AUTHOR_NAMES.length;
    const gradIdx = i % DOUJIN_GRADIENTS.length;
    works.push({
      id: 'doujin-fb-' + Date.now() + '-' + i,
      title: t.title,
      authorName: DOUJIN_AUTHOR_NAMES[authorIdx],
      excerpt: t.excerpt,
      content: t.content,
      authorWords: t.authorWords || '',
      tags: t.tags,
      likes: Math.floor(Math.random() * 2000) + 50,
      collects: Math.floor(Math.random() * 800) + 20,
      comments: Math.floor(Math.random() * 200) + 5,
      avatarIndex: authorIdx % FORUM_AVATAR_COUNT,
      coverGradient: DOUJIN_GRADIENTS[gradIdx],
      coverPrompt: DOUJIN_FALLBACK_COVER_PROMPTS[i % DOUJIN_FALLBACK_COVER_PROMPTS.length]
    });
  }
  return works;
};

const generateFallbackDoujinComments = (workTitle, count) => {
  const templates = [
    '文笔太好了，读完眼眶湿润了。',
    '这一段写得太有画面感，仿佛身临其境。',
    '收藏了，反复读了好几遍，每次都有新感受。',
    '作者的文字有一种治愈的力量，谢谢分享。',
    '那句金句戳中我了，写进心里了。',
    '催更！太喜欢这种风格了，求继续写下去！',
    '读完心里软软的，像被风轻轻拂过。',
    '这样的文字让人愿意慢下来，认真感受生活。',
    '作者好会写，每个字都恰到好处。',
    '共情了，想起自己类似的经历，谢谢作者。'
  ];
  const n = count || (3 + Math.floor(Math.random() * 3));
  const comments = [];
  for (let i = 0; i < n; i++) {
    const authorIdx = Math.floor(Math.random() * DOUJIN_AUTHOR_NAMES.length);
    comments.push({
      id: 'dc-fb-' + Date.now() + '-' + i,
      authorName: DOUJIN_AUTHOR_NAMES[authorIdx],
      content: templates[Math.floor(Math.random() * templates.length)],
      time: ['刚刚', '5分钟前', '20分钟前', '1小时前', '3小时前', '昨天'][i % 6],
      avatarIndex: authorIdx % FORUM_AVATAR_COUNT
    });
  }
  return comments;
};

/* === 圈层向同人文核心 prompt 构建函数 === */
const buildDoujinStylePrompt = (options) => {
  const { roleName, rolePrompt, characterName, userPersona, tags, tropes, wordCount, style, isContinue, existingContent, customRequest, chapterNum, title, authorName, excerpt, writingStyle, memoryPrompt, area } = options;
  const wc = wordCount || '500';
  const numWords = wc === '1500' ? '1200-1500' : (wc === '1000' ? '800-1000' : '1000-1500');

  /* === 双主角信息 === */
  /* 第一个主角：用户选择的角色 */
  var protagonist1 = '';
  if (characterName) protagonist1 += '第一主角（角色）：' + characterName + '\n';
  if (roleName && roleName !== characterName) protagonist1 += '关联角色：' + roleName + '\n';
  if (rolePrompt) protagonist1 += '角色设定：' + String(rolePrompt).slice(0, 400) + '\n';

  /* 第二个主角：用户自己的人设 */
  var protagonist2 = '';
  if (userPersona) {
    var userNick = userPersona.nickname || '用户';
    protagonist2 += '第二主角（用户人设）：' + userNick + '\n';
    if (userPersona.bio && userPersona.bio.trim()) {
      protagonist2 += '人设描述：' + String(userPersona.bio).slice(0, 400) + '\n';
    }
    /* 注入人设关系，让AI理解双主角之间的关系设定 */
    if (userPersona.relations && String(userPersona.relations).trim()) {
      protagonist2 += '人设关系（双主角之间的关系设定，必须在正文中体现）：' + String(userPersona.relations).slice(0, 500) + '\n';
    }
    protagonist2 += '【重要-人称理解】人设描述和人设关系中可能用"主控"、"你"、"她"、"他"来指代第二主角（用户人设）。请自行理解这些人称代词指的就是"' + userNick + '"。在正文中请用"' + userNick + '"这个名字来称呼，不要只用"你/她/他/主控"。\n';
    protagonist2 += '【重要】这个用户人设是故事的第二主角，正文中必须频繁出现"' + userNick + '"这个名字，与角色名同等重要。两个主角之间有互动、有对话、有情感张力。绝不能只出现角色名而忽略用户人设名。\n';
  }

  /* 标签和梗 */
  var tagInfo = '';
  if (tags && tags.length > 0) tagInfo += '主题标签：' + tags.join('、') + '\n';
  if (tropes && tropes.length > 0) {
    var tropeStr = tropes.map(function(t) {
      if (typeof t === 'string') return t;
      if (t && t.name && t.content) return t.name + '（' + t.content + '）';
      return t && t.name ? t.name : '';
    }).filter(Boolean).join('、');
    if (tropeStr) tagInfo += '同人梗：' + tropeStr + '\n';
  }

  /* 随机情感风格 */
  var randomStyles = ['虐心', '甜蜜', '搞笑', '正剧', '暗黑'];
  var randomStyle = randomStyles[Math.floor(Math.random() * randomStyles.length)];

  var areaInfo = area || '原著向';
  var requestInfo = customRequest ? String(customRequest).slice(0, 300) : '';

  var prompt = '你是一位文学造诣极高的LOFTER同人文写手，擅长用读者熟悉的角色和人设，演绎最带感的平行宇宙。你的文笔细腻、节奏舒缓、情感真实，深受圈内读者喜爱。\n\n';

  /* === 核心定位 === */
  prompt += '【核心定位】\n';
  prompt += '面向原作核心粉丝圈层的轻量短打同人文，适配手机端沉浸式碎片化阅读。全程默认读者完全掌握原作世界观、人物设定、核心剧情、经典名场面与圈内共识梗，零科普、零铺垫、零注解，主打圈内人专属的精准情绪共鸣。\n\n';

  /* === 核心创作铁则 === */
  prompt += '【核心创作铁则】\n';
  prompt += '1. 零背景铺垫：开篇直接切入核心场景/对话/情绪瞬间，绝不出现解释性语句（如"故事发生在XX剧情之后""XX是原作中的XX角色"），默认读者完全知晓时间线、人物身份与人物关系。\n';
  prompt += '2. 圈层化表达：角色称谓统一使用圈内通用昵称/代号/CP简称，提及原作事件用圈内共识代称，无需复述剧情、注解含义。\n';
  prompt += '3. 人设绝对贴脸：所有言行、心理、互动逻辑严格贴合原作人物性格内核，绝不因玩梗、造冲突出现人设崩塌。\n';
  prompt += '4. 梗自然融入：圈内梗嵌入对话、动作、神态、细节描写中，如同日常流露，不刻意堆砌、不单独强调、不加任何注解，点到即止，默认读者秒懂。\n';
  prompt += '5. 人称理解：角色人设中如果用"主控"、"你"、"她"、"他"来指代用户，请理解为第二主角（用户人设）。人设关系中描述的互动经历就是两个主角之间的故事基础。\n\n';

  prompt += '【双主角核心设定（必须严格遵守）】\n';
  prompt += '本文为双主角叙事，以第三人称视角描写两个主角的故事。\n';
  prompt += '- 第一个主角是用户选择的角色，第二个主角是用户自己设定的人设。\n';
  prompt += '- 正文中必须同时出现两个主角的名字，两个名字出现频率应当相当。\n';
  prompt += '- 绝对不能只写角色名而省略用户人设名，也不能只用"他/她"代指用户人设。\n';
  prompt += '- 两个主角之间要有充分的互动：对话、动作、心理活动、情感拉扯。\n';
  prompt += '- 主角之间存在性张力，互动要有化学反应。\n\n';

  prompt += '【同人文创作方法论（默认文风指令，必须严格遵守）】\n';
  prompt += '一、三大主流"世界观"套子（AU/架空）\n';
  prompt += '作者会把人设"移植"到不同背景里，制造反差爽感：\n';
  prompt += '- 原著向：续写结局或填补原著留白。主打"如果是这样就好了"的圆满感。\n';
  prompt += '- 现代/校园AU：把古代人或异能者扔进现实。经典场景：天台逃课递烟、合租室友酒后乱性、死对头在图书馆角落偷亲。\n';
  prompt += '- 特殊设定：ABO（信息素/标记）、哨兵向导（精神体）、黑道/娱乐圈。这类文通常自带"强强"或"强制爱"滤镜，张力拉满。\n\n';
  prompt += '二、两大"情绪"极端（甜与虐）\n';
  prompt += '- 甜饼（HE）：全程无刀，主打"小情侣腻歪"。开篇可能就是"早安，我做了早饭"，结尾一定是"我们结婚吧"。\n';
  prompt += '- 虐文/刀（BE）：主打"美学遗憾"。常用"破镜难圆"、"死别"、"遗忘"梗。结尾常用一句平淡的日常收尾，比如"他关上门，再也没有回来"，让读者后劲十足。\n\n';
  prompt += '三、独特的"食用"格式（短平快）\n';
  prompt += '老福特同人多为短篇（一发完）或中篇，追求即时爽感：\n';
  prompt += '- 论坛体/知乎体：全篇用网络回复形式写。"楼主：急！暗恋的兄弟好像把我当兄弟怎么办？"\n';
  prompt += '- 捡手机文学：全靠微信/短信截图推进剧情，连描写都省了，极致的"对话流"。\n\n';
  prompt += '四、最关键的"灵魂"：OOC与不OOC的拉扯\n';
  prompt += '好的同人文，即使把角色写成黑帮老大，他骨子里说话的语气、下意识的小动作（比如皱眉、摸后颈）必须完全还原原著。作者会在开头标注预警（如"OOC严重慎入"），一旦人物"说了一句不属于他的话"，读者立刻就会在评论区"出警"。\n\n';
  prompt += '举个直观的例子（同一对CP，不同题材）：\n';
  prompt += '【原著向】\n';
  prompt += '他站在废墟里，把沾血的护身符塞进对方手里。"别回头。"说完转身走向爆炸的火光，像原著里无数次那样，替对方挡住了最后一颗子弹。\n';
  prompt += '【校园AU】\n';
  prompt += '他把情书塞进对方桌洞，结果第二天全班都知道了。晚自习下课，那人把他堵在空无一人的楼道里，低头笑了："写这么含蓄？我喜欢你，直接说不就行了。"\n\n';
  prompt += '简单总结：同人文 = 用读者熟悉的"脸"和"关系"，去演绎作者心中"最带感"的平行宇宙。什么都能变（身份、时代、甚至物种），但"爱"的化学反应和"人设底色"绝对不能变。\n\n';

  prompt += '【叙事节奏与结构要求】\n';
  prompt += '1. 小说叙事节奏不要过快，按照中长篇的节奏把握，不走玄幻路线。\n';
  prompt += '2. 整个故事由四个过程递进：故事前因、故事发展、故事高潮、故事结尾。保证读者能够读懂。\n';
  prompt += '3. 避免用物品象征情感，所有情感表达要直接真实。\n';
  prompt += '4. 杜绝使用数字梗，不以数字代替情感表达。\n';
  prompt += '5. 拒绝伏笔和暗喻，情节发展清晰明了。\n';
  prompt += '6. 避免使用专业术语，语言通俗易懂。\n';
  prompt += '7. 环境描写要自然融入情节，不刻意、不突兀，时间要清晰，不做补充说明。\n';
  prompt += '8. 情节推进依靠对话和动作。拒绝回忆式情节，直接展开当下故事。\n';
  prompt += '9. 所有情节的发展都要具有逻辑且合理。\n';
  prompt += '10. 不准对人物设定做出任何修改和添加！\n\n';

  prompt += '【情节风格要求】\n';
  prompt += '1. 多用动作和语言描写，人物互动要生动鲜活。\n';
  prompt += '2. 对话要有来有回，富有生活气息，避免生硬。\n';
  prompt += '3. 每个章节的情节自然衔接，流畅推进。\n';
  prompt += '4. 围绕日常小事展开，贴近生活，真实自然。\n';
  prompt += '5. 事件之间要有内在联系，情节发展环环相扣。\n';
  prompt += '6. 必须有心理活动和动作等细节描写，要自然融入到文章中。\n';
  prompt += '7. 下一章的情节要和上一章衔接上，保证整个故事的连贯性。\n\n';

  prompt += '【人物要求】\n';
  prompt += '1. 所有人物均要符合设定，符合自身的行为逻辑，绝对不能OOC。\n';
  prompt += '2. 完全按照自身的身份认知行动，每个出场人物并不知道所有事情，没有上帝视角，只知道自己在文章中的现在所知道的内容。\n';
  prompt += '3. 内容情节丰富有趣。\n';
  prompt += '4. 主角之间有性张力！性张力！\n\n';

  prompt += '【文笔与排版要求】\n';
  prompt += '1. 文笔在线，有很高的文学造诣。\n';
  prompt += '2. 在不影响节奏舒缓的前提下合并句子：将冗杂影响体验的可连贯的短句，合并为逻辑通顺的长句。\n';
  prompt += '3. 重写后的文本，应像成熟的传统出版小说的页面一样，由饱满的文本块构成，减少零散的短句，以增加可读性，排版美观舒适。\n';
  prompt += '4. 短句应当是高质量雕琢的复句而不是小陈述句，短句不得占比大于8%，极为低频穿插在段落间且短句不能连段，短句不能充斥文章，适可而止。\n';
  prompt += '5. 人物对话互动时，相关的细节描写不能单段短句一大把，应转向更绵密、更具呼吸感的文学性叙述，试着冗长些。\n';
  prompt += '6. 反例（不可以单独成段）：他没有睡。他跑不动了。他逃了出去。\n';
  prompt += '7. 活泼一点，蕴含幽默，符合人设。\n\n';

  prompt += '【绝对禁止项】\n';
  prompt += '- 禁止任何原作设定科普、人物身份介绍、剧情背景复述\n';
  prompt += '- 禁止对圈内梗、CP名、原作事件进行解释、标注、科普\n';
  prompt += '- 禁止出现面向路人读者的引导、说明类文字\n';
  prompt += '- 禁止生硬堆砌梗、为玩梗违背人物逻辑与叙事节奏\n';
  prompt += '- 禁止长篇世界观铺垫、多线复杂剧情展开\n';
  prompt += '- 禁止只出现角色名而不出现用户人设名\n';
  prompt += '- 禁止用"他/她"长期代指用户人设而不使用其名字\n';
  prompt += '- 禁止回忆式情节，必须直接展开当下故事\n';
  prompt += '- 禁止用物品象征情感，情感表达必须直接真实\n';
  prompt += '- 禁止使用数字梗\n';
  prompt += '- 禁止伏笔和暗喻，情节发展清晰明了\n\n';

  if (protagonist1) prompt += '【第一主角信息】\n' + protagonist1 + '\n';
  if (protagonist2) prompt += '【第二主角信息】\n' + protagonist2 + '\n';
  if (tagInfo) prompt += '【创作元素】\n' + tagInfo + '\n';
  prompt += '【世界观/区域】' + areaInfo + '\n';
  if (requestInfo) prompt += '【读者要求】' + requestInfo + '\n';
  if (memoryPrompt) prompt += '【用户记忆】\n' + memoryPrompt + '\n\n';
  prompt += '【本次随机风格】' + randomStyle + '\n';

  if (isContinue) {
    prompt += '\n【续写要求】\n';
    if (title) prompt += '作品标题：' + title + '\n';
    if (existingContent) prompt += '已有内容（上一章）：\n' + String(existingContent).slice(0, 1000) + '\n\n';
    if (customRequest) prompt += '读者要求：' + String(customRequest).slice(0, 200) + '\n';
    prompt += '续写第' + (chapterNum || 2) + '章，字数' + numWords + '字。\n';
    prompt += '保持与前文风格连贯，下一章的情节要和上一章衔接上。\n';
    prompt += '正文中必须同时出现角色名和用户人设名。\n';
    prompt += '【重要】chapterTitle 必须是一个有吸引力的章节标题（8-20字），要体现本章的核心情节或情感转折，不要用"第X章"这种简单格式。例如："雨夜的告白"、"失控的边界"、"迟来的真相"。\n';
    prompt += '返回JSON格式：{"chapterTitle":"","content":"","authorWords":""}\n';
    prompt += '- chapterTitle: 本章标题，8-20字，有吸引力，体现本章核心情节\n';
    prompt += '- content: 正文，' + numWords + '字\n';
    prompt += '- authorWords: 作者碎碎念，0-50字\n';
    prompt += '只返回JSON，不要解释。';
  } else {
    prompt += '\n【生成要求】\n';
    prompt += '请生成1篇同人文，字数' + numWords + '字。\n';
    prompt += '第三人称视角，双主角叙事。\n';
    prompt += '【重要-随机性要求】\n';
    prompt += '1. 标题和作者名必须是随机原创的，绝不使用常见模板或上次的标题。标题要文艺有吸引力但不俗套，作者名要有个性。\n';
    prompt += '2. 每次生成的内容必须完全不同，即使标签和角色相同，也要选择不同的场景、不同的情节走向、不同的情绪切入点。\n';
    prompt += '3. 从以下维度随机选择：情绪走向（甜饼HE/虐心BE）、叙事格式（正常叙事/对话流/碎片化）。\n';
    prompt += '   世界观/区域已指定为：' + areaInfo + '，请严格遵守。\n';
    prompt += '4. 请根据用户人设和记忆中的互动经历，创作高度个性化的内容。如果提供了用户记忆，必须在内容中体现记忆中的互动细节或情感羁绊。\n';
    prompt += '5. 本次随机种子：' + Math.floor(Math.random() * 999999) + '，请基于此种子选择独特的创作方向。\n';
    prompt += '6. 【最重要】正文中必须频繁同时出现"' + (characterName || '角色') + '"和"' + (userPersona && userPersona.nickname ? userPersona.nickname : '用户') + '"两个主角的名字，两个主角的戏份和互动是故事核心。\n';
    prompt += '返回JSON格式：{"title":"","authorName":"","excerpt":"","content":"","authorWords":"","tags":[]}\n';
    prompt += '- title: 文艺有吸引力的标题，10-20字\n';
    prompt += '- authorName: 作者名，中文网名\n';
    prompt += '- excerpt: 摘要/引言，20-50字\n';
    prompt += '- content: 正文，' + numWords + '字\n';
    prompt += '- authorWords: 作者碎碎念，0-50字\n';
    prompt += '- tags: 标签数组，1-3个\n';
    prompt += '只返回JSON，不要解释。';
  }

  return prompt;
};

/* === 同人文单篇生成核心逻辑（同步/后台共用） === */
const generateDoujinWorkCore = async (params, userId) => {
  const { roleName, rolePrompt, characterName, tags, tropes, wordCount, style, writingStyle, userPersona: payloadPersona } = params || {};

  /* 优先使用前端传来的用户人设，其次从后端 userProfiles 读取（含人设关系） */
  const userProfile = userProfiles.get(userId) || { nickname: '体验用户', bio: '', relations: '' };
  const userPersona = (payloadPersona && payloadPersona.nickname && payloadPersona.nickname !== '体验用户')
    ? { nickname: payloadPersona.nickname, bio: payloadPersona.bio, avatar: payloadPersona.avatar, relations: payloadPersona.relations || userProfile.relations || '' }
    : { nickname: userProfile.nickname, bio: userProfile.bio, relations: userProfile.relations || '' };

  /* 读取用户长期记忆 */
  const memoryPrompt = buildMemoryPrompt(userId, null) || '';

  /* 随机选择情感风格 */
  const randomStyles = ['虐心', '甜蜜', '搞笑', '正剧', '暗黑'];
  const randomStyle = randomStyles[Math.floor(Math.random() * randomStyles.length)];

  const prompt = buildDoujinStylePrompt({
    roleName, rolePrompt, characterName, userPersona, tags, tropes, wordCount,
    style: randomStyle, memoryPrompt,
    customRequest: params.customRequest || '',
    area: params.area || '原著向'
  });

  if (!config.upstreamKey || config.upstreamKey.includes('请填写')) {
    const err = new Error('AI服务未配置，无法生成同人文。豆子已退还。');
    err.code = 503; err.code2 = 5001;
    throw err;
  }

  let rawText;
  try {
    rawText = await streamComplete(prompt, { timeoutMs: 120000, maxTokens: 4000 });
  } catch (e) {
    if (e.code) throw e;
    const err = new Error((e.message || '生成失败') + ' 豆子已退还。');
    err.code = 502; err.code2 = 5005;
    throw err;
  }

  /* 清理AI返回的markdown标记 */
  rawText = rawText.replace(/^```json\s*/i, '').replace(/```$/,'').replace(/^```\s*/,'').trim();

  let work = null;
  try {
    const jsonMatch = rawText.match(/\{[\s\S]*\}/);
    const parsed = JSON.parse(jsonMatch ? jsonMatch[0] : rawText);
    if (parsed) {
      work = {
        id: 'doujin-gen-' + Date.now(),
        title: String(parsed.title || '无题').slice(0, 60),
        authorName: String(parsed.authorName || userProfile.nickname || '匿名').slice(0, 30),
        excerpt: String(parsed.excerpt || '').slice(0, 200),
        content: String(parsed.content || '').slice(0, 8000),
        authorWords: String(parsed.authorWords || '').slice(0, 200),
        tags: Array.isArray(parsed.tags) ? parsed.tags.slice(0, 3).map(t => String(t).slice(0, 10)) : (tags || []),
        likes: 0, collects: 0, comments: 0, avatarIndex: 0,
        coverGradient: DOUJIN_GRADIENTS[Math.floor(Math.random() * DOUJIN_GRADIENTS.length)],
        time: '刚刚', _user: true
      };
    }
  } catch (e) {
    console.warn('Doujin generate-work JSON parse error:', e.message, 'rawText:', rawText.substring(0, 200));
  }

  if (!work) {
    const err = new Error('AI生成失败，未返回有效内容。豆子已退还。');
    err.code = 500; err.code2 = 5002;
    throw err;
  }

  return { work };
};

app.post('/api/forum/doujin/generate-work', async (req, res) => {
  const { background, characterName, roleName } = req.body || {};
  let user;
  user = getUser(req.userId);
  if (!user || user.beans < 5) {
    return fail(res, 403, 4003, '豆子不足，生成同人文需要5颗豆子');
  }
  user.beans = Math.max(0, user.beans - 5);
  stats.totalBeansConsumed += 5;
  transactions.push({ id: randomUUID(), userId: user.id, type: 'consume', beans: -5, roleName: '同人创作', summary: '生成同人文 ' + (characterName || roleName || ''), createdAt: new Date().toISOString() });
  saveData();

  const refundBeans = () => {
    if (user) {
      user.beans += 5;
      stats.totalBeansConsumed -= 5;
      saveData();
    }
  };

  /* 后台模式 */
  if (background) {
    const task = createBgTask(req.userId, 'doujin-work', '生成同人文');
    ok(res, { background: true, taskId: task.id });
    (async () => {
      try {
      
        const result = await generateDoujinWorkCore(req.body, req.userId);
      
        completeBgTask(task.id, result);
      } catch (error) {
      
        refundBeans();
        failBgTask(task.id, error.message || '生成失败');
      }
    })();
    return;
  }

  /* 同步模式 */
  try {
    const result = await generateDoujinWorkCore(req.body, req.userId);
    ok(res, result);
  } catch (error) {
    refundBeans();
    var httpStatus = (error.code && error.code >= 100 && error.code < 600) ? error.code : 500;
    var errCode = error.code2 || 5003;
    return fail(res, httpStatus, errCode, error.message || '生成失败，豆子已退还。');
  }
});

/* === 同人文列表生成核心逻辑（同步/后台共用） === */
const generateDoujinListCore = async (params, userId) => {
  const { tag, roleName, rolePrompt, userPersona: payloadPersona } = params || {};

  /* 优先使用前端传来的用户人设 */
  const userProfile = (payloadPersona && payloadPersona.nickname && payloadPersona.nickname !== '体验用户')
    ? payloadPersona
    : (userProfiles.get(userId) || { nickname: '体验用户', bio: '' });
  const contextInfo = [];

  /* 双主角信息 */
  var userListRole = roleName || '';
  var userNick = userProfile.nickname || '用户';
  if (userListRole) contextInfo.push('第一主角（角色）：' + userListRole + '。正文中必须频繁出现角色名。');
  if (userProfile.bio && userProfile.bio.trim()) contextInfo.push('第二主角（用户人设）：' + userNick + '，' + String(userProfile.bio).slice(0, 200) + '。正文中必须频繁出现"' + userNick + '"这个名字，与角色名同等重要。');
  if (tag && DOUJIN_TAGS.includes(tag)) contextInfo.push('本次生成作品的主题标签为"' + tag + '"，作品应贴合该主题。');

  /* 读取用户长期记忆 */
  const memoryPrompt = buildMemoryPrompt(userId, null) || '';
  if (memoryPrompt) contextInfo.push('用户与角色的互动记忆：' + memoryPrompt.slice(0, 500));

  /* 随机风格提示 */
  const randomStyles = ['虐心', '甜蜜', '搞笑', '正剧', '暗黑'];
  const styleHint = '本次作品风格随机为：' + randomStyles[Math.floor(Math.random() * randomStyles.length)] + '，请贴合该风格创作。';
  contextInfo.push(styleHint);

  const prompt = '你是一位深谙LOFTER同人文创作精髓的写手。\n\n' +
    '【双主角核心设定】\n' +
    '本文为双主角叙事，以第三人称视角描写两个主角的故事。第一个主角是用户选择的角色，第二个主角是用户自己设定的人设。正文中必须同时出现两个主角的名字，绝不能只出现角色名而忽略用户人设名。两个主角之间有互动、有对话、有性张力。\n\n' +
    '【同人文创作方法论】\n' +
    '一、三大主流世界观套子（AU/架空）：原著向（续写结局或填补原著留白）、现代/校园AU（天台逃课递烟、合租室友、死对头在图书馆角落偷亲）、特殊设定（ABO、哨兵向导、黑道/娱乐圈，自带强强或强制爱滤镜）。\n' +
    '二、两大情绪极端：甜饼（HE）全程无刀小情侣腻歪结尾圆满；虐文/刀（BE）美学遗憾破镜难圆死别遗忘梗，结尾用平淡日常收尾让读者后劲十足。\n' +
    '三、独特的食用格式：论坛体/知乎体（全篇网络回复形式）、捡手机文学（全靠聊天截图推进剧情）。\n' +
    '四、最关键的灵魂：OOC与不OOC的拉扯。即使把角色写成黑帮老大，他骨子里说话的语气、下意识的小动作必须完全还原原著。\n\n' +
    '【叙事与文笔要求】\n' +
    '- 叙事节奏不要过快，按中长篇节奏把握，不走玄幻路线\n' +
    '- 故事由四个过程递进：前因、发展、高潮、结尾\n' +
    '- 情感表达直接真实，避免物品象征情感，杜绝数字梗\n' +
    '- 拒绝伏笔和暗喻，情节发展清晰明了，拒绝回忆式情节\n' +
    '- 环境描写自然融入，时间清晰，情节推进依靠对话和动作\n' +
    '- 由饱满的文本块构成，减少零散短句，短句不得占比大于8%\n' +
    '- 对话互动的细节描写应转向更绵密、更具呼吸感的文学性叙述\n' +
    '- 活泼蕴含幽默，符合人设，主角之间有性张力\n' +
    '- 所有人物符合设定，绝对不能OOC，没有上帝视角\n\n' +
    '请生成4-5条作品列表，每条作品的标题、作者名、内容都要完全不同：\n' +
    '- title(作品标题，文艺有吸引力，10-20字，每条必须不同)\n' +
    '- authorName(作者名，不同风格的中文网名，每条必须不同)\n' +
    '- excerpt(作品摘要/引言，20-50字，能吸引人点开)\n' +
    '- content(作品正文，1000-1500字，双主角互动，短段落排版，每条内容完全不同)\n' +
    '- authorWords(作者碎碎念，0-50字)\n' +
    '- tags(标签数组，1-3个)\n\n' +
    (contextInfo.length > 0 ? '创作背景：\n' + contextInfo.join('\n') + '\n\n' : '') +
    '【重要】每条作品的标题、作者名、正文内容必须完全不同，禁止重复。正文中必须同时出现角色名和用户人设名。请根据用户人设和记忆创作个性化内容。\n' +
    '返回JSON格式：{"works":[...]}\n只返回JSON。';

  if (!config.upstreamKey || config.upstreamKey.includes('请填写')) {
    const err = new Error('AI服务未配置，无法生成同人文。豆子已退还。');
    err.code = 503; err.code2 = 5001;
    throw err;
  }

  let rawText;
  try {
    rawText = await streamComplete(prompt, { timeoutMs: 120000, maxTokens: 4000 });
  } catch (e) {
    if (e.code) throw e;
    throw new Error(e.message || '生成失败');
  }
  rawText = rawText.replace(/^```json\s*/i, '').replace(/```$/,'').replace(/^```\s*/,'').trim();

  let works = [];
  try {
    const jsonMatch = rawText.match(/\{[\s\S]*\}/);
    const parsed = JSON.parse(jsonMatch ? jsonMatch[0] : rawText);
    if (parsed && Array.isArray(parsed.works)) {
      works = parsed.works.slice(0, 10).map((w, idx) => ({
        id: 'doujin-ai-' + Date.now() + '-' + idx,
        title: String(w.title || '无题').slice(0, 60),
        authorName: String(w.authorName || DOUJIN_AUTHOR_NAMES[idx % DOUJIN_AUTHOR_NAMES.length]).slice(0, 30),
        excerpt: String(w.excerpt || '').slice(0, 200),
        content: String(w.content || '').slice(0, 5000),
        authorWords: String(w.authorWords || '').slice(0, 200),
        tags: Array.isArray(w.tags) ? w.tags.slice(0, 3).map(t => String(t).slice(0, 10)) : [],
        likes: Math.floor(Math.random() * 3000) + 50,
        collects: Math.floor(Math.random() * 1000) + 20,
        comments: Math.floor(Math.random() * 300) + 5,
        avatarIndex: idx % FORUM_AVATAR_COUNT,
        coverGradient: DOUJIN_GRADIENTS[idx % DOUJIN_GRADIENTS.length]
      }));
    }
  } catch (e) {
    console.warn('Doujin works JSON parse error:', e.message);
  }

  if (works.length === 0) {
    const err = new Error('AI生成失败，未返回有效内容。豆子已退还。');
    err.code = 500; err.code2 = 5002;
    throw err;
  }

  return { works, tag: tag || '' };
};

app.post('/api/forum/doujin/generate', async (req, res) => {
  const { background, tag } = req.body || {};
  let user;
  user = getUser(req.userId);
  if (!user || user.beans < 5) {
    return fail(res, 403, 4003, '豆子不足，生成同人文需要5颗豆子');
  }
  user.beans = Math.max(0, user.beans - 5);
  stats.totalBeansConsumed += 5;
  transactions.push({ id: randomUUID(), userId: user.id, type: 'consume', beans: -5, roleName: '同人论坛', summary: '生成同人文作品 ' + (tag || '全部'), createdAt: new Date().toISOString() });
  saveData();

  const refundBeans = () => {
    if (user) {
      user.beans += 5;
      stats.totalBeansConsumed -= 5;
      saveData();
    }
  };

  /* 后台模式 */
  if (background) {
    const task = createBgTask(req.userId, 'doujin-list', '生成同人文列表');
    ok(res, { background: true, taskId: task.id });
    (async () => {
      try {
        const result = await generateDoujinListCore(req.body, req.userId);
        completeBgTask(task.id, result);
      } catch (error) {
        refundBeans();
        failBgTask(task.id, error.message || '生成失败');
      }
    })();
    return;
  }

  /* 同步模式 */
  try {
    const result = await generateDoujinListCore(req.body, req.userId);
    ok(res, result);
  } catch (error) {
    refundBeans();
    var httpStatus = (error.code && error.code >= 100 && error.code < 600) ? error.code : 500;
    var errCode = error.code2 || 5003;
    return fail(res, httpStatus, errCode, error.message || '生成失败，豆子已退还。');
  }
});

app.post('/api/forum/doujin/detail', async (req, res) => {
  const { workId, title, authorName, excerpt } = req.body || {};
  try {
    const userProfile = userProfiles.get(req.userId) || { nickname: '体验用户', bio: '', relations: '' };
    /* 如果用户有真实人设，在prompt中强调双主角 */
    var personaLine = (userProfile.nickname && userProfile.nickname !== '体验用户' && userProfile.bio)
      ? '用户人设（第二主角）：' + userProfile.nickname + '，' + String(userProfile.bio).slice(0, 200) + '\n正文中必须频繁出现"' + userProfile.nickname + '"这个名字。\n'
      : '';
    /* 注入人设关系 */
    if (userProfile.relations && String(userProfile.relations).trim()) {
      personaLine += '人设关系：' + String(userProfile.relations).slice(0, 300) + '\n';
    }
    const prompt = '你是一位深谙LOFTER同人文创作精髓的写手。\n\n' +
      '【同人文创作方法论】\n' +
      '一、三大主流世界观套子（AU/架空）：原著向、现代/校园AU、特殊设定（ABO、哨兵向导、黑道/娱乐圈）。\n' +
      '二、两大情绪极端：甜饼（HE）全程无刀结尾圆满；虐文/刀（BE）美学遗憾结尾平淡日常收尾。\n' +
      '三、独特的食用格式：论坛体/知乎体、捡手机文学。\n' +
      '四、最关键的灵魂：OOC与不OOC的拉扯，角色骨子里的语气和小动作必须完全还原原著。\n\n' +
      '【叙事与文笔要求】\n' +
      '- 叙事节奏按中长篇把握，不走玄幻路线，故事由前因、发展、高潮、结尾四部分递进\n' +
      '- 情感表达直接真实，避免物品象征情感，杜绝数字梗，拒绝伏笔和暗喻\n' +
      '- 由饱满的文本块构成，减少零散短句，短句不得占比大于8%\n' +
      '- 细节描写应转向更绵密、更具呼吸感的文学性叙述\n' +
      '- 活泼蕴含幽默，符合人设，主角之间有性张力\n\n' +
      '作品标题：' + (title || '无题') + '\n' +
      '作者：' + (authorName || '佚名') + '\n' +
      '作品摘要：' + String(excerpt || '').slice(0, 200) + '\n' +
      personaLine +
      '请生成完整正文，双主角叙事，第三人称视角。正文中同时出现角色名和用户人设名。返回JSON格式：{"content":"","authorWords":"","tags":[]}\n只返回JSON。';

    if (!config.upstreamKey || config.upstreamKey.includes('请填写')) {
      return fail(res, 503, 5001, 'AI服务未配置，无法生成同人文详情。');
    }

    let rawText;
    try {
      rawText = await streamComplete(prompt, { timeoutMs: 120000, maxTokens: 4000 });
    } catch (e) {
      throw new Error(e.message || '生成失败');
    }

    let detail = null;
    try {
      const jsonMatch = rawText.match(/\{[\s\S]*\}/);
      const parsed = JSON.parse(jsonMatch ? jsonMatch[0] : rawText);
      if (parsed) {
        detail = {
          content: String(parsed.content || '').slice(0, 5000),
          authorWords: String(parsed.authorWords || '').slice(0, 300),
          tags: Array.isArray(parsed.tags) ? parsed.tags.slice(0, 3).map(t => String(t).slice(0, 10)) : []
        };
      }
    } catch (e) {
      console.warn('Doujin detail JSON parse error:', e.message);
    }

    if (!detail) {
      return fail(res, 500, 5002, 'AI生成失败，未返回有效内容。');
    }
    ok(res, detail);
  } catch (error) {
    fail(res, 500, 5003, '生成失败：' + error.message);
  }
});

app.post('/api/forum/doujin/continue', async (req, res) => {
  const { workId, title, authorName, existingContent, tropes, tags, customRequest, chapterNum, chapterCount, roleName, rolePrompt, plotDirection } = req.body || {};
  const count = Math.min(Math.max(chapterCount || 1, 1), 5);
  const baseChapterNum = chapterNum || 2;

  /* 扣豆子：续写每章消耗5豆 */
  const user = getUser(req.userId);
  const totalCost = count * 5;
  if (!user || user.beans < totalCost) {
    return fail(res, 403, 4003, '豆子不足，续写需要' + totalCost + '颗豆子');
  }
  user.beans = Math.max(0, user.beans - totalCost);
  stats.totalBeansConsumed += totalCost;
  transactions.push({ id: randomUUID(), userId: user.id, type: 'consume', beans: -totalCost, roleName: '同人续写', summary: '续写 ' + count + ' 章 ' + (title || ''), createdAt: new Date().toISOString() });
  saveData();

  const refundBeans = () => {
    if (user) {
      user.beans += totalCost;
      stats.totalBeansConsumed -= totalCost;
      saveData();
    }
  };

  try {
    /* 优先使用前端传来的用户人设 */
    const payloadPersona = req.body.userPersona;
    const userProfile = (payloadPersona && payloadPersona.nickname && payloadPersona.nickname !== '体验用户')
      ? { nickname: payloadPersona.nickname, bio: payloadPersona.bio, relations: payloadPersona.relations || '' }
      : (userProfiles.get(req.userId) || { nickname: '体验用户', bio: '', relations: '' });

    const allChapters = [];
    let prevContent = existingContent || '';

    for (let i = 0; i < count; i++) {
      const curChapterNum = baseChapterNum + i;
      const prompt = buildDoujinStylePrompt({
        title,
        existingContent: prevContent,
        tropes,
        tags,
        customRequest: customRequest || plotDirection || '',
        chapterNum: curChapterNum,
        characterName: roleName,
        rolePrompt,
        isContinue: true,
        userPersona: { nickname: userProfile.nickname, bio: userProfile.bio, relations: userProfile.relations || '' },
        wordCount: '1000'
      });

      if (!config.upstreamKey || config.upstreamKey.includes('请填写')) {
        refundBeans();
        return fail(res, 503, 5001, 'AI服务未配置，无法续写同人文。');
      }

      let rawText;
      try {
        rawText = await streamComplete(prompt, { timeoutMs: 120000, maxTokens: 4000 });
      } catch (e) {
        if (allChapters.length > 0) break;
        refundBeans();
        throw new Error(e.message || '生成失败');
      }

      let chapter = null;
      try {
        const jsonMatch = rawText.match(/\{[\s\S]*\}/);
        const parsed = JSON.parse(jsonMatch ? jsonMatch[0] : rawText);
        if (parsed) {
          chapter = {
            title: String(parsed.chapterTitle || ('第' + curChapterNum + '章')).slice(0, 100),
            content: String(parsed.content || '').slice(0, 5000),
            authorWords: String(parsed.authorWords || '').slice(0, 300)
          };
        }
      } catch (e) {
        console.warn('Doujin continue JSON parse error:', e.message);
      }

      if (!chapter) {
        if (allChapters.length === 0) {
          refundBeans();
          return fail(res, 500, 5002, 'AI生成失败，未返回有效内容。');
        }
        break;
      }

      allChapters.push(chapter);
      prevContent = chapter.content;
    }

    /* 返回 chapters 数组（兼容前端期望的格式） */
    ok(res, { chapters: allChapters, chapter: allChapters[0] });
  } catch (error) {
    fail(res, 500, 5003, '续写失败：' + error.message);
  }
});

app.post('/api/forum/doujin/comments', async (req, res) => {
  const { workTitle, workAuthor, workContent, count } = req.body || {};
  /* 扣豆子：生成同人文评论消耗1豆 */
  const user = getUser(req.userId);
  if (!user || user.beans < 1) {
    return fail(res, 403, 4003, '豆子不足，生成评论需要1颗豆子');
  }
  user.beans = Math.max(0, user.beans - 1);
  stats.totalBeansConsumed += 1;
  transactions.push({ id: randomUUID(), userId: user.id, type: 'consume', beans: -1, roleName: '同人文', summary: '生成评论', createdAt: new Date().toISOString() });
  saveData();
  const refundCommentBeans = () => { user.beans += 1; stats.totalBeansConsumed -= 1; saveData(); };

  try {
    const prompt = '你是一个LOFTER同人文圈层的读者评论模拟器，适配移动端小屏单列展示。\n\n' +
      '【核心定位】\n' +
      '模拟LOFTER同人文圈层的真实读者评论，全程默认发言者为原作核心粉丝、圈内同好，无路人视角、无科普提问，精准还原老福特评论区"同好共鸣、为爱发电"的原生氛围。\n\n' +
      '【核心创作准则】\n' +
      '1. 全圈层语境，零注解：统一使用圈内通用称谓与黑话，称呼作者为「太太/老师」，作品称「粮/饭」，贴合人设称「贴脸/贴」，共情触动称「戳/杀到」，同类内容称「代餐」，蹲更称「放屁股/蹲」；提及角色、CP、原作事件统一用圈内简称/代称，无需任何解释，默认全员秒懂。\n' +
      '2. 锚定文本细节，不空泛：所有评论必须紧扣对应同人文的具体内容（某句对话、某个动作、某段心理描写、某个核心意象），拒绝空泛的"写得好"，完全模拟真实读者读完后的即时有感而发。\n' +
      '3. 语气多元，贴近真人：还原不同读者的发言习惯，既有激动碎碎念，也有含蓄走心评价，兼顾玩梗整活与温柔反馈，避免模板化、同质化，单条评论情绪统一、符合人设。\n' +
      '4. 短平快适配小屏：以短评为主，单条评论1-3句话，单句不超长，无大段密集文字，贴合手机端评论区的竖屏浏览节奏。\n\n' +
      '【主流评论风格分类】\n' +
      '1. 前排短打热评：情绪直接、简短有力，一句话戳中核心共鸣点，常用叠词、感叹词强化情绪\n' +
      '2. 走心细节长评：精准捕捉文中的留白、伏笔、细腻细节，展开简短共情解读，温柔真诚\n' +
      '3. 玩梗整活评论：结合原作梗、圈内共识梗二次创作，活泼戏谑，自带笑点\n' +
      '4. 蹲更追更评论：表达对后续内容的期待，软感催促、礼貌蹲守\n' +
      '5. 氛围感留白评论：用简短意象化表达传递情绪，含蓄余韵强\n\n' +
      '【绝对禁止项】\n' +
      '1. 禁止出现路人式提问（如"这是谁？""讲的什么？"）、任何原作设定科普与梗点注解\n' +
      '2. 禁止ky言论、拉踩角色、拆CP、脱离文章内容的无关发言\n' +
      '3. 禁止生硬模板化套话，禁止过于官方、正式的书面语\n' +
      '4. 禁止长篇大论，单条评论最长不超过100字\n' +
      '5. 禁止不符合圈层礼仪的强硬催更、指责类、抬杠类言论\n' +
      '6. 禁止脱离文章调性的违和发言（如虐文下发纯玩梗评论）\n\n' +
      '作品标题：' + (workTitle || '无题') + '\n' +
      '作品作者：' + (workAuthor || '佚名') + '\n' +
      (workContent ? '作品内容摘要：' + String(workContent).slice(0, 500) + '\n' : '') +
      '\n请生成' + (count || 4) + '条评论，混合使用上述5种风格。\n' +
      '返回JSON格式：{"comments":[{"authorName":"","content":"","time":""}]}\n' +
      '- authorName: 网名，圈层风格\n' +
      '- content: 评论内容，1-3句话，不超过100字\n' +
      '- time: 时间，如"刚刚"、"2分钟前"等\n' +
      '只返回JSON，不要解释。';

    if (!config.upstreamKey || config.upstreamKey.includes('请填写')) {
      return fail(res, 503, 5001, 'AI服务未配置，无法生成评论。');
    }

    let rawText;
    try {
      rawText = await streamComplete(prompt, { timeoutMs: 120000, maxTokens: 4000 });
    } catch (e) {
      refundCommentBeans();
      throw new Error(e.message || '生成失败');
    }

    let comments = [];
    try {
      const jsonMatch = rawText.match(/\{[\s\S]*\}/);
      const parsed = JSON.parse(jsonMatch ? jsonMatch[0] : rawText);
      if (parsed && Array.isArray(parsed.comments)) {
        comments = parsed.comments.slice(0, 8).map((c, idx) => ({
          id: 'dc-ai-' + Date.now() + '-' + idx,
          authorName: String(c.authorName || DOUJIN_AUTHOR_NAMES[idx % DOUJIN_AUTHOR_NAMES.length]).slice(0, 24),
          content: String(c.content || '').slice(0, 300),
          time: String(c.time || '刚刚').slice(0, 20),
          avatarIndex: (idx + Math.floor(Math.random() * 3)) % FORUM_AVATAR_COUNT
        }));
      }
    } catch (e) {
      console.warn('Doujin comments JSON parse error:', e.message);
    }

    if (comments.length === 0) throw new Error('AI返回内容无法解析为评论');
    ok(res, { comments });
  } catch (error) {
    refundCommentBeans();
    fail(res, 502, 5002, '评论生成失败：' + (error.message || '未知错误'));
  }
});

/* === Forum User Profile API === */
app.post('/api/forum/profile', (req, res) => {
  const { userId, avatar, posts, followers, following } = req.body || {};
  let forumProfiles = loadData().forumProfiles || {};
  if (userId) {
    forumProfiles[userId] = {
      ...(forumProfiles[userId] || {}),
      ...(avatar !== undefined && { avatar }),
      ...(posts !== undefined && { posts }),
      ...(followers !== undefined && { followers }),
      ...(following !== undefined && { following })
    };
    const data = loadData();
    data.forumProfiles = forumProfiles;
    saveData(data);
  }
  ok(res, forumProfiles[userId] || {});
});

app.get('/api/forum/profile', (req, res) => {
  const { userId } = req.query || {};
  const data = loadData();
  const forumProfiles = data.forumProfiles || {};
  ok(res, forumProfiles[userId] || { posts: 0, followers: 0, following: 0 });
});

/* === User Profile (个人主页) API === */

app.get('/api/profile', (req, res) => {
  const profile = userProfiles.get(req.userId) || { nickname: '体验用户', bio: '', avatar: '', relations: '' };
  ok(res, profile);
});

app.post('/api/profile', (req, res) => {
  const { nickname, bio, avatar, relations } = req.body || {};
  const profile = {
    nickname: String(nickname || '体验用户').slice(0, 40),
    bio: String(bio || '').slice(0, 500),
    avatar: String(avatar || '').slice(0, 200000),
    relations: String(relations || '').slice(0, 800),
    updatedAt: new Date().toISOString()
  };
  userProfiles.set(req.userId, profile);
  saveData();
  ok(res, profile, '个人资料已保存');
});

/* === Direct Messages (私信) API === */

app.get('/api/messages', (req, res) => {
  const list = directMessages.get(req.userId) || [];
  ok(res, { list });
});

app.post('/api/messages', (req, res) => {
  const { role, content, fromUser } = req.body || {};
  if (!content || !content.trim()) return fail(res, 400, 4005, '消息内容不能为空。');
  const list = directMessages.get(req.userId) || [];
  const msg = {
    id: randomUUID(),
    role: String(role || 'system').slice(0, 40),
    content: String(content).slice(0, 500),
    fromUser: fromUser !== false,
    createdAt: new Date().toISOString()
  };
  list.unshift(msg);
  if (list.length > 200) list.length = 200;
  directMessages.set(req.userId, list);
  saveData();
  ok(res, msg, '消息已发送');
});

app.delete('/api/messages/:id', (req, res) => {
  const list = directMessages.get(req.userId) || [];
  const filtered = list.filter(m => m.id !== req.params.id);
  if (filtered.length !== list.length) {
    directMessages.set(req.userId, filtered);
    saveData();
  }
  ok(res, { deleted: list.length - filtered.length }, '消息已删除');
});

app.post('/api/messages/reply', async (req, res) => {
  const { role, rolePrompt, userMessage } = req.body || {};
  if (!userMessage || !userMessage.trim()) return fail(res, 400, 4006, '消息内容不能为空。');
  try {
    const sysPrompt = (rolePrompt || '你是一个温柔的角色。') + '\n用户给你发了一条私信，请以角色的语气回复，回复要简短（20-80字），像微信聊天一样自然。';
    if (!config.upstreamKey || config.upstreamKey.includes('请填写')) {
      return ok(res, { reply: '收到你的私信了！' + String(userMessage).slice(0, 20) + '...我会认真看的~' });
    }
    let reply;
    try {
      reply = await streamCompleteWithSystem(sysPrompt, String(userMessage).slice(0, 300), { timeoutMs: 60000, maxTokens: 500 });
    } catch (e) {
      reply = '收到啦~';
    }
    reply = reply || '收到啦~';
    ok(res, { reply: String(reply).slice(0, 200) });
  } catch (error) {
    ok(res, { reply: '抱歉，我现在不太方便回复，稍后再聊~', error: error.message });
  }
});

/* === Novel Game (文游) Module === */

const NOVEL_GAMES_DIR = path.join(__dirname, 'novel-games');

// === 内嵌文游剧本数据 ===
const EMBEDDED_NOVEL_GAMES = {
  "_design-principles": `{
  "id": "_design-principles",
  "name": "文游通用设计原则（基于用户模板）",
  "_comment": "本文件汇总自用户提供的四份设计模板，由服务端自动注入每个剧本的 systemPrompt 前置区域，不需要在剧本列表中展示。",
  "_hidden": true,
  "principles": {
    "ironRules": [
      "世界规则高于剧情方便：经济、资源、阶层、法律、力量体系必须稳定运行，不能为推进剧情临时改变底层规则",
      "高自由度不等于无条件成功：玩家可拒绝主线、改变目标、自定义行动，但结果受能力、资源、时间、身份、关系、信息和世界规则限制",
      "NPC不是等待玩家触发的工具人：所有重要NPC有自己的生活、目标、关系、压力、秘密和日程，玩家不介入时世界仍会发展",
      "故事由人物、系统与选择共同产生：事件由当前时间、地点、资源、玩家状态、NPC目标、世界趋势、未解决伏笔和适度随机扰动共同生成",
      "任何重要变化都必须渐进：顶级能力、巨大财富、深度信任和亲密关系都需长期积累，禁止几轮内完成所有成长",
      "主线结束不等于游戏结束：完成主线后进入新的生活、经营、关系或世界阶段，只有玩家明确选择结束时才收束"
    ],
    "worldBuilding": [
      "世界观必须解释：世界如何运行、普通人如何生活、资源从哪里来、权力由谁掌握、哪些规则不能绕过",
      "世界设定必须能进入事件和选择，不能只是背景介绍",
      "故事开始时，世界正在发生的长期变化、矛盾与潜在危机要自然呈现"
    ],
    "playerDesign": [
      "玩家必须同时具有优势与短板，开局资源足够开始行动但不能跳过成长",
      "玩家身份真实影响他人的态度、可接触的信息、能获得的机会和必须承担的风险",
      "第一轮要让玩家立刻看见核心玩法、当前问题和至少一个可自由选择的方向"
    ],
    "gameplayLoops": [
      "日常短循环（1-3轮反馈）：照顾、接待、工作、训练、学习、采集、社交、休息",
      "中期成长循环（3-10轮变化）：设施升级、性格成长、职业进阶、关系升温或恶化、区域解锁",
      "长期阶段循环（跨越季节/年份）：事业扩张、家庭变化、势力重组、世界危机、生活转型",
      "沙盒继续循环：主线完成后仍能继续生活、经营、探索、社交和建设"
    ],
    "npcDesign": [
      "人物由经历、处境、欲望、价值观和选择构成，不得只用标签代替",
      "每个重要NPC都有玩家之外的生活、关系、责任、秘密与日程",
      "人物对玩家的态度必须有来源：欣赏、戒备、厌恶、依赖、爱慕都需要具体事件和时间积累",
      "人物可以拒绝玩家、误解玩家、离开玩家、选择他人或坚持自己的目标",
      "缺点必须真实造成问题，优点也可能在某些情境下变成负担",
      "秘密必须影响行为，不能只作为装饰写入",
      "NPC行为引擎每轮判断顺序：当前目标→掌握的信息与误解→与在场人物的关系→当前情绪与压力→可用资源与风险→选择最符合人格的行动",
      "NPC不得读取玩家内心、后台数值或自己不可能知道的信息",
      "玩家长时间不联系时，NPC会继续工作、交友、改变计划或解决自己的问题",
      "重要NPC应有主动发起事件的条件，而不是永远等待玩家触发"
    ],
    "relationshipSystem": [
      "关系至少区分：熟悉、信任、尊重、依赖、吸引、利益绑定、恐惧、怨恨、亏欠与边界",
      "同一行为对不同人物产生不同影响，取决于价值观、经历、处境和信息",
      "关系变化要记录原因，不只记录数值",
      "亲密不等于完全信任，忠诚不等于喜欢，爱情不等于放弃责任",
      "关系破裂应有修复条件与不可修复部分，道歉不能自动消除伤害",
      "NPC之间的关系会反过来影响玩家"
    ],
    "eventSystem": [
      "事件必须从世界、人物、资源、时间或旧选择中产生，不能只因本轮需要刺激而随机出现",
      "重要事件要有触发条件、原因、参与者、行动空间、即时结果、延迟后果和后续分支",
      "玩家不选择某个事件也会产生后果：机会过期、NPC自行处理、问题恶化、他人介入",
      "选择不能只是不同措辞后得到同一结果，每个重要选项至少改变关系、资源、信息、时间、身份或世界状态中的两项",
      "事件触发公式：当前时间/季节/地点 + 玩家身份/能力/资源/近期行动 + NPC当前目标/日程/关系/秘密 + 已解决/未解决事件与延迟后果 + 世界趋势/组织计划 + 适度随机扰动 = 本轮候选事件",
      "触发类型：强触发（条件满足必须发生）、软触发（提高概率）、窗口触发（特定时间地点人物）、累积触发（多次小选择到阈值）、反应触发（NPC回应玩家行为）、世界触发（不依赖玩家）"
    ],
    "butterflyEffect": [
      "微小选择先改变人物印象、资源或信息，再通过NPC行动形成后续事件，不要直接跳到巨大结局",
      "重要选择至少设计一项即时可见后果和一项数轮后出现的隐藏后果",
      "善意选择也可能带来资源压力、误解、依赖或敌对关注；自利选择也可能短期有效但损害长期关系",
      "一个事件可同时改变多条线",
      "旧选择应在合适时刻被人物提起、被制度记录或改变机会",
      "长期后果要有兑现窗口与替代路径，避免永远悬而不决"
    ],
    "pacing": [
      "建立最近五至十轮事件记录，连续两轮避免相同核心冲突，连续三轮避免同一人物占据全部焦点",
      "重大事件后必须有余波和休整轮",
      "不要用反复误会、意外拥抱、突然生病、被绑架、偷听秘密等少数桥段撑长篇",
      "同一人物事件应随关系阶段变化：陌生、熟悉、合作、冲突、亲密或疏远时的矛盾不同",
      "随着时间推进，开放新地点、新人物、新责任和新层级，不只是提高数值"
    ],
    "actionResolution": [
      "玩家提出行动后，先判断目标、方法、已知信息、能力、资源、时间、环境和相关人物态度",
      "结果可以是：成功、部分成功、付出代价后成功、失败但获得信息、失败并打开新局面",
      "不得用毫无依据的随机数字决定一切，高风险行动可综合条件给出合理概率或叙事判定",
      "失败不应频繁直接结束游戏，可通过损失、伤病、债务、关系恶化、机会错过形成新故事",
      "玩家不能凭一句自定义行动绕过长期成长、资源不足、人物底线、法律和世界规则"
    ],
    "continuityLedger": [
      "每轮结束后内部更新：日期、时间、季节、天气、地点、已消耗时间",
      "玩家资源、技能、健康、压力、物品、事业、责任和当前目标",
      "重要NPC的位置、目标、关系、已知信息和正在进行的独立行动",
      "已发生事件、未解决问题、伏笔、秘密、延迟后果和世界趋势",
      "最近五轮的主要场景、冲突和奖励，防止重复",
      "当前短期、中期和长期目标是否仍有发展空间"
    ],
    "outputFormat": [
      "【当前时间与环境】日期、时段、季节、天气、地点、环境变化",
      "【核心状态面板】只展示当前玩法真正需要的公开状态",
      "【本轮正文】第二人称沉浸叙事，行动、对话、感官、心理、事件结果自然融合",
      "【经营或成长结算】收入、支出、资源、成长等明确变化",
      "【相关人物与世界动态】只展示玩家能够知道的3-6项，不泄露隐藏秘密",
      "【当前可处理事项】尚未解决的问题、约定、线索、责任或近期目标",
      "【可选行动】4-8个方向明显不同的选项 + 始终保留【自定义行动】"
    ],
    "forbidden": [
      "禁止无逻辑万能系统、无代价开挂、所有人自动喜欢玩家、反派集体降智",
      "禁止用大量空洞属性、重复任务和每日流水账伪装高自由度",
      "禁止所有选项最终回到同一结果，或玩家不走主线世界就停止",
      "禁止突然出现与世界规则不符的物品、能力、财富、关系、线索或身份",
      "禁止几轮内经营登顶、获得顶级能力、彻底攻略重要人物或解决终极危机",
      "禁止虚报几百个事件、无限NPC，却只给几个例子和省略号",
      "禁止使用'其余略''以此类推''后续自行扩展'等占位句代替核心规则"
    ]
  }
}
`,
  "ancient-life": `{
  "id": "ancient-life",
  "name": "浮生六记",
  "category": "古代人生",
  "tags": ["古代", "生活", "种田", "经商", "人生"],
  "difficulty": "简单",
  "description": "青萝镇的炊烟总在卯时升起。你是镇上一户寻常人家的子弟，门前有薄田两亩，屋后有杏花一树。春耕秋收，读书经商，谈婚论嫁，生老病死——没有金戈铁马，只有柴米油盐。浮生若梦，把这烟火日子过好，便已是了不起的一生。",
  "coverGradient": ["#1b5e20", "#c8a165"],
  "accentColor": "#6d4c41",
  "fontHeading": "'Ma Shan Zheng', cursive",
  "world": {
    "era": "架空古代·江南小镇",
    "setting": "江南水乡青萝镇，小桥流水、粉墙黛瓦。你是一户寻常人家的子弟，春耕秋收、读书经商、谈婚论嫁、生老病死——浮生若梦，过好这烟火日子，便是了不起的一生。",
    "rules": [
      "时间按季节/节气推进，春耕夏耘秋收冬藏，违时则歉收",
      "科举与经商两条出路皆苦：功名靠积累与机缘，商贾靠诚信与勤勉",
      "婚丧嫁娶是人生大事，门第、聘礼、人言皆有讲究",
      "健康与家和人最贵，积劳成疾、家宅不宁皆是劫",
      "天灾人祸、疫病、官府盘剥是真实变量",
      "年成丰歉影响粮价与生计，节气主导农事与赶集",
      "人生阶段不可逆，每个选择都塑造最终结局"
    ]
  },
  "player": {
    "customizable": ["name", "age", "gender", "familyBackground", "personality", "lifeAspiration"],
    "defaultStats": {
      "wealth": 30,
      "health": 80,
      "knowledge": 20,
      "relationships": 40,
      "status": 10,
      "happiness": 50
    },
    "startingItems": ["祖屋一间", "薄田两亩", "几卷旧书", "一枚镇纸"],
    "currency": "两"
  },
  "npcs": [
    {
      "id": "neighbor-afu",
      "name": "阿福",
      "world": "main",
      "role": "邻居",
      "gender": "男",
      "appearance": "三十岁，黝黑壮实，一笑露出一口白牙，裤腿永远卷到膝盖，手里不是锄头就是扁担",
      "surface": "憨厚热心、嗓门大、爱串门，哪家有事第一个到",
      "deep": "一辈子没出过镇子，把邻里当亲人。热心是天性，也怕夜里一个人对着空屋子",
      "goal": "守着老婆孩子热炕头，日子越过越红火",
      "fear": "天灾人祸，颗粒无收，一家人揭不开锅",
      "secret": "他家祖坟地里有块断碑，刻着前朝藏银的暗语，他至今没敢挖",
      "initialAttitude": "热络",
      "attitudeFactors": {
        "trustUp": ["互帮互助", "不嫌弃他粗人", "危难时搭把手"],
        "trustDown": ["算计他家", "嫌贫爱富", "忘恩负义"]
      }
    },
    {
      "id": "merchant-hu",
      "name": "胡掌柜",
      "world": "main",
      "role": "商人",
      "gender": "男",
      "appearance": "四十五岁，圆融富态，长衫整洁，算盘挂在腰间，笑起来一团和气，眼珠却转得飞快",
      "surface": "和气生财、八面玲珑、算盘打得精",
      "deep": "白手起家，深知市井不易，精明却不黑心，待诚信之人极厚，待奸滑之人极狠",
      "goal": "把生意做到府城，给子孙留一份稳当的家业",
      "fear": "官府盘剥、同行倾轧，一朝回到解放前",
      "secret": "他暗中资助过几位落魄书生，图的是日后科举有人提携，这份长线投资从不对人说",
      "initialAttitude": "察言观色",
      "attitudeFactors": {
        "trustUp": ["诚实守信", "童叟无欺", "互利共赢"],
        "trustDown": ["短斤缺两", "赖账违约", "见利忘义"]
      }
    },
    {
      "id": "scholar-liu",
      "name": "柳青云",
      "world": "main",
      "role": "书生",
      "gender": "男",
      "appearance": "二十二岁，清瘦白净，一身洗得发白的青衫，腰间别一卷书，眼里有光也有愁",
      "surface": "清高迂腐、满口之乎者也、不善农事",
      "deep": "胸有丘壑却困于贫寒，迂腐是清高也是无奈，骨子里想经世济民，奈何连笔墨都要赊",
      "goal": "科举入仕，光耀门楣，不辜负一肚子学问",
      "fear": "屡试不第，半生蹉跎，辜负家人期望",
      "secret": "他写的一篇策论被某位京官看中，正暗中传信招他入京，他却犹豫该不该舍下寒妻",
      "initialAttitude": "礼貌疏离",
      "attitudeFactors": {
        "trustUp": ["敬重学问", "资助他读书", "不拿清贫取笑"],
        "trustDown": ["附庸风雅却轻慢学问", "市侩势利", "当面折他颜面"]
      }
    }
  ],
  "eventTypes": {
    "daily": { "ratio": 0.3, "desc": "日常：耕作、赶集、读书、炊烟的市井日常" },
    "character": { "ratio": 0.18, "desc": "人物：邻居、商人、书生、家人的往来" },
    "growth": { "ratio": 0.12, "desc": "成长：学识、家业、声望、技艺积累" },
    "main": { "ratio": 0.15, "desc": "主线：成家立业、科举经商、生儿育女的人生节点" },
    "world": { "ratio": 0.1, "desc": "世界：四季节气、丰歉年景、官府政令、市集盛衰" },
    "crisis": { "ratio": 0.1, "desc": "危机：天灾、瘟疫、官司、破产、丧亲" },
    "hidden": { "ratio": 0.05, "desc": "隐藏：祖产秘辛、断碑藏银、贵人机缘" }
  },
  "systemPrompt": "你是《浮生六记》古代人生文游模拟器。\\n\\n【最高铁律】\\n1. 浮生若梦，没有金手指，寻常日子过好便是了不起\\n2. 季节循环主导一切：春耕夏耘秋收冬藏，违时则歉收\\n3. 科举与经商两条出路皆苦，功名靠积累与机缘，商贾靠诚信与勤勉\\n4. 婚丧嫁娶是人生大事，门第、聘礼、人言皆有讲究\\n5. 健康与家和人最贵，积劳成疾、家宅不宁皆是劫\\n\\n【季节与日常】按节气推进，农事随季、赶集逢圩、读书赴考各有其时；年成丰歉影响粮价与生计。科举看积累机缘，经商凭诚信勤勉；婚配看门第人品，丧事讲礼制孝道，婚丧嫁娶皆是镇上大事。\\n\\n【叙事风格】古典生活散文，温润如水墨。重风物：炊烟、杏花、蝉鸣、霜柿、灶火。第二人称视角，日常琐碎中见人情冷暖。\\n\\n【每轮输出格式】\\n1.【X年·某节气】时令、农事、镇上动静\\n2.【状态面板】家财/健康/学识/人缘/声望/心境\\n3.【本轮正文】1000-2000字\\n4.【街坊动态】3-5项\\n5.【当前生计】农事、买卖、功课、家事\\n6.【可选行动】4-6个+【自定义行动】\\n\\n【数值变化标注】\\n[家财±n两][健康±n][学识±n][人缘±n][声望±n][心境±n]格式，重大人生节点须标注长远影响。",
  "items": [
    { "id": "farm-tools", "name": "农具一套", "type": "装备", "price": 20, "effect": "提升耕作效率与收成" },
    { "id": "old-books", "name": "几卷旧书", "type": "任务物品", "price": 0, "effect": "读书增学问，科举之基" },
    { "id": "silk-goods", "name": "丝绸货物", "type": "消耗品", "price": 100, "effect": "经商售卖获利" },
    { "id": "dowry", "name": "嫁妆聘礼", "type": "消耗品", "price": 200, "effect": "婚嫁必需，影响门第与体面" },
    { "id": "herb-medicine", "name": "草药", "type": "消耗品", "price": 15, "effect": "治病养生，应对疫病" },
    { "id": "exam-kit", "name": "考篮文房", "type": "任务物品", "price": 0, "effect": "科举赴考必备" }
  ]
}
`,
  "business-management": `{
  "id": "business-management",
  "name": "烟火人间",
  "category": "经营发展",
  "tags": ["经营", "商战", "模拟", "烟火气", "成长"],
  "difficulty": "中等",
  "description": "你接手了古镇巷尾一家三代传承的客栈兼餐馆'半闲居'。灶台冷了太久，账本红得刺眼，街对面新开的连锁店正虎视眈眈。从一锅汤、一桌客、一盏招牌灯开始，你能否在这青石板巷里，把烟火气重新点亮，把日子熬成招牌？",
  "coverGradient": ["#6d4c41", "#ff7043"],
  "accentColor": "#e65100",
  "fontHeading": "'ZCOOL XiaoWei', serif",
  "world": {
    "era": "现代都市",
    "setting": "南方水乡古镇锦溪镇，青石板巷尾一家三代传承的客栈兼餐馆'半闲居'。古镇正被开发成旅游目的地，游人如织与原住民的人情味在此交织。你接手了这家濒临倒闭的老店，要在时代洪流中守住烟火、守住根。",
    "rules": [
      "时间按周推进，分淡旺季与节庆节点，影响客流与原料价格",
      "资金、声誉、员工、品质、库存五维构成经营核心，任一崩盘即失败",
      "竞品会动态扩张：连锁店、网红店会侵蚀你的市场份额",
      "顾客满意度由品质、服务、性价比三重累积，口碑起效慢、崩塌快",
      "员工有忠诚度与熟练度，压榨与忽视会反噬为怠工与流失",
      "扩张需先稳定现金流，盲目开店会触发资金链断裂危机",
      "节庆、季节、社会事件触发限定商机或风险"
    ]
  },
  "player": {
    "customizable": ["name", "age", "background", "managementStyle", "shopConcept", "signatureDish"],
    "defaultStats": {
      "funds": 50000,
      "reputation": 30,
      "staff": 40,
      "quality": 50,
      "inventory": 60,
      "stress": 20
    },
    "startingItems": ["祖传菜谱手札", "半闲居钥匙串", "试营业木牌", "首批食材"],
    "currency": "¥"
  },
  "npcs": [
    {
      "id": "rival-qian",
      "name": "钱多宝",
      "world": "main",
      "role": "竞争对手",
      "gender": "男",
      "appearance": "四十出头，圆脸富态，金链半隐于衬衫领口，笑起来眼睛眯成缝，递烟递茶极会来事",
      "surface": "精明圆滑、笑脸迎人、出手阔绰，开口就是'咱们街坊一场'",
      "deep": "他其实是古镇原住民，怕整条街被外地资本吞掉，收购你是想守住地盘。手段虽狠，底线是不让古镇变味",
      "goal": "收购半闲居，整合古镇餐饮，挡住外地资本",
      "fear": "古镇被资本整条吞下，老街坊再无立足之地",
      "secret": "他年轻时是你爷爷的学徒，因偷学配方被赶出师门，至今耿耿于怀",
      "initialAttitude": "试探拉拢",
      "attitudeFactors": {
        "trustUp": ["坦诚交底", "守住老味道", "不投靠外地资本"],
        "trustDown": ["投靠外地资本", "压价恶性竞争", "瞧不起老街坊"]
      }
    },
    {
      "id": "mentor-zhou",
      "name": "老周",
      "world": "main",
      "role": "师傅/导师",
      "gender": "男",
      "appearance": "六十出头，花白头发束在脑后，围裙上沾满油渍与岁月，一双手粗糙却稳得能颠勺如飞",
      "surface": "古板固执、说话刻薄、对年轻人没好气，张口就是'你懂个屁'",
      "deep": "他在半闲居掌勺四十年，怕手艺失传，刻薄是怕你不当回事。他比你更爱这间店",
      "goal": "把祖传手艺传下去，不让老味道在他手里断了",
      "fear": "半闲居变成只卖噱头的网红店，老顾客再也找不到回家的味道",
      "secret": "他记得半闲居失传的最后一道招牌菜，配方锁在脑子里，只传有缘人",
      "initialAttitude": "观望",
      "attitudeFactors": {
        "trustUp": ["尊重老配方", "肯下苦功", "不偷工减料"],
        "trustDown": ["急功近利", "用半成品糊弄", "瞧不起老规矩"]
      }
    },
    {
      "id": "customer-shen",
      "name": "沈清",
      "world": "main",
      "role": "潜在恋人/食客",
      "gender": "女",
      "appearance": "二十七八岁，素面朝天却气质出众，总背一台相机，吃菜前先认真闻一闻再动筷",
      "surface": "知性从容、镜头感强、对食物极挑剔，夸一句比登天还难",
      "deep": "在名利场倦了，想找一处真正的'人间烟火'。挑剔，是在寻找久违的真实",
      "goal": "找到值得停下来的味道，也找到值得停留的人",
      "fear": "再一次被流量裹挟，失去真实的自己",
      "secret": "她出身餐饮世家，因与家人决裂才离家做美食博主，从未真正放下",
      "initialAttitude": "客气疏离",
      "attitudeFactors": {
        "trustUp": ["拿出真诚的手艺", "不迎合流量", "记得她的口味"],
        "trustDown": ["把她当流量工具", "敷衍出品", "刻意讨好"]
      }
    }
  ],
  "eventTypes": {
    "daily": { "ratio": 0.3, "desc": "日常：采购备货、掌勺待客、收银盘账的烟火日常" },
    "character": { "ratio": 0.2, "desc": "人物：对手、师傅、熟客、街坊的人情往来" },
    "growth": { "ratio": 0.12, "desc": "成长：配方改良、口碑发酵、技能精进" },
    "main": { "ratio": 0.15, "desc": "主线：扭亏、扩建、危机、品牌化的阶段节点" },
    "world": { "ratio": 0.1, "desc": "世界：节庆旺季、古镇改造、旅游政策" },
    "crisis": { "ratio": 0.08, "desc": "危机：食材涨价、员工离职、食安事故、对手狙击" },
    "hidden": { "ratio": 0.05, "desc": "隐藏：失传配方、老街坊旧事、沈清身世" }
  },
  "systemPrompt": "你是《烟火人间》经营模拟文游模拟器。\\n\\n【最高铁律】\\n1. 经营无捷径，所有收益皆有代价，账面盈利不等于活下去\\n2. 资金链是生命线：采购→生产→销售→结算四环相扣，任一断裂即崩盘\\n3. 顾客满意度由品质、服务、性价比三重累积，口碑起效慢、崩塌快\\n4. 员工有忠诚与熟练度，压榨会反噬为怠工与流失\\n5. 盲目扩张先于现金流稳定，必触发资金链断裂\\n\\n【经营循环与员工管理】每周完成采购备货→生产制作→接待销售→结算复盘；旺季节庆影响客流与原料价。员工管理须兼顾薪资与归属，培训是长期投资；账面盈利≠现金流，资金链断裂即结局，决策有滞后效应。\\n\\n【叙事风格】市井烟火写实，重感官：灶火、汤香、收银叮当、街坊寒暄。第二人称视角，对白带点方言味。\\n\\n【每轮输出格式】\\n1.【第X周·时段】天气节庆、经营阶段\\n2.【状态面板】资金/声誉/员工/品质/库存/压力/本周收支\\n3.【本轮正文】1000-2000字\\n4.【人物动态】3-5项\\n5.【当前待办】进货、客诉、合同等\\n6.【可选行动】4-6个+【自定义行动】\\n\\n【数值变化标注】\\n[资金±¥n][声誉±n][员工±n][品质±n][库存±n][压力±n]格式，重大决策须标注原因与滞后影响。",
  "items": [
    { "id": "recipe-book", "name": "祖传菜谱手札", "type": "任务物品", "price": 0, "effect": "记录三代手艺，蕴含失传配方与人脉线索" },
    { "id": "fresh-ingredients", "name": "时令食材", "type": "消耗品", "price": 500, "effect": "提升当日出品品质" },
    { "id": "ad-coupon", "name": "探店推广券", "type": "消耗品", "price": 800, "effect": "短期引流，但过度依赖会消耗口碑" },
    { "id": "staff-training", "name": "员工培训课", "type": "消耗品", "price": 1200, "effect": "提升一名员工的熟练度与忠诚" },
    { "id": "secret-dish", "name": "失传招牌菜谱", "type": "装备", "price": 0, "effect": "解锁招牌产品，长期提升复购率" },
    { "id": "decor-upgrade", "name": "店面升级", "type": "装备", "price": 8000, "effect": "提升客单价与高端客群比例" }
  ]
}
`,
  "court-intrigue": `{
  "id": "court-intrigue",
  "name": "凤鸣九霄",
  "category": "宫廷权谋",
  "tags": ["宫廷", "权谋", "宫斗", "古言", "权术"],
  "difficulty": "困难",
  "description": "你以世家女身份入宫那日，长乐宫的杏花正盛。新帝年少，太后临朝，外戚虎视，后宫暗流汹涌。一入宫门深似海，请安、邀宠、防暗算、布棋局——你能否在这方寸宫墙内，从一枚棋子，活成执棋之人，凤鸣九霄？",
  "coverGradient": ["#3e0000", "#9a1b1b"],
  "accentColor": "#ffd700",
  "fontHeading": "'Ma Shan Zheng', cursive",
  "world": {
    "era": "架空古代·新朝初立",
    "setting": "大昭朝，先帝崩逝，新帝萧承睿年少登基，太后临朝称制，外戚谢氏专权。你以世家女身份入宫为秀女，在这方寸宫墙内步步为营，求生存、争恩宠、谋权势。后宫位分森严，前朝与后宫一脉相连。",
    "rules": [
      "后宫位分制：秀女→常在→答应→贵人→嫔→妃→贵妃→皇贵妃→皇后",
      "恩宠、势力、子嗣、家族构成四大权力支点",
      "太后、外戚、新帝、宗室四方博弈，没有绝对的盟友",
      "前朝与后宫联动：母家官职起伏直接影响后宫地位",
      "信息网络是命脉：宫女太监的耳目、母家家书皆是情报源",
      "谣言、毒药、滑胎、秘辛是常用手段，但有反噬与追溯",
      "规矩森严，逾矩受罚；但破例之处往往是机会"
    ]
  },
  "player": {
    "customizable": ["name", "age", "familyBackground", "talent", "personality", "ambition"],
    "defaultStats": {
      "favor": 5,
      "influence": 10,
      "wisdom": 15,
      "charm": 14,
      "reputation": 30,
      "danger": 20
    },
    "startingItems": ["入宫文牒", "一支素银簪", "一匣胭脂", "母家家书一封"],
    "currency": "金"
  },
  "npcs": [
    {
      "id": "emperor-xiao",
      "name": "萧承睿",
      "world": "main",
      "role": "新帝",
      "gender": "男",
      "appearance": "二十一岁，眉宇间已褪去少年气，眼神是帝王特有的'看人如看物'。龙袍加身，唯独对你偶尔露出真实的笑",
      "surface": "温和克制、对后宫诸妃一视同仁、喜怒不形于色",
      "deep": "真正的帝王——克制是修养，一视同仁是平衡术。心里清楚谁真帮他，在等一个能并肩而非俯首的人",
      "goal": "亲政，摆脱太后与外戚，做一个真正的皇帝",
      "fear": "重蹈先帝被架空的覆辙",
      "secret": "他在密谋一场针对外戚的清洗，需要后宫里可信的人",
      "initialAttitude": "考察",
      "attitudeFactors": {
        "trustUp": ["不依附外戚", "懂他的难处", "关键时刻为他做事"],
        "trustDown": ["向太后告密", "只想着争宠", "把他当傀儡"]
      }
    },
    {
      "id": "consort-shen",
      "name": "贵妃·沈氏",
      "world": "main",
      "role": "对手妃嫔",
      "gender": "女",
      "appearance": "二十六岁，倾国倾城，笑容里三分真七分假。出身寒门凭容貌手段爬到贵妃之位，步步都踩着血",
      "surface": "艳冠后宫、八面玲珑、对谁都和气",
      "deep": "出身太低，必须比谁都狠才能活。和气是面具，嫉妒是燃料，最怕被你取代",
      "goal": "诞下皇子，问鼎后位",
      "fear": "色衰爱弛，老死冷宫",
      "secret": "她曾滑过一次胎，至今不知是谁下的手，疑心人人",
      "initialAttitude": "敌意伪装和气",
      "attitudeFactors": {
        "trustUp": ["与她结盟对抗太后", "不抢她的恩宠", "理解她的难处"],
        "trustDown": ["与她争宠", "揭她出身", "动她的子嗣"]
      }
    },
    {
      "id": "maid-biluo",
      "name": "碧落",
      "world": "main",
      "role": "忠心宫女",
      "gender": "女",
      "appearance": "十六岁，眉目清秀，一身素净宫装，垂首跟在你身后，眼神却比谁都警醒",
      "surface": "沉静机敏、忠心耿耿、话不多事办得妥帖",
      "deep": "自小被卖入宫，把你当唯一的依靠，忠诚里混着依赖与一点没说出口的情分",
      "goal": "护你周全，在这吃人的地方一起活下去",
      "fear": "你失势，她也万劫不复",
      "secret": "她其实是某位被害嫔妃的遗孤，潜伏宫中追查母亲死因",
      "initialAttitude": "忠诚",
      "attitudeFactors": {
        "trustUp": ["信任她", "护她周全", "不拿她当弃子"],
        "trustDown": ["猜忌她", "拿她挡灾", "忘了她是活生生的人"]
      }
    }
  ],
  "eventTypes": {
    "daily": { "ratio": 0.2, "desc": "日常：请安、用膳、绣花、赏花的宫闱日常" },
    "character": { "ratio": 0.22, "desc": "人物：皇帝、贵妃、宫女、姐妹的权谋博弈" },
    "growth": { "ratio": 0.08, "desc": "成长：位分、恩宠、才艺、手腕积累" },
    "main": { "ratio": 0.18, "desc": "主线：入宫、固宠、宫变、问鼎" },
    "world": { "ratio": 0.1, "desc": "世界：前朝奏折、节气、节庆、外戚动态" },
    "crisis": { "ratio": 0.15, "desc": "危机：滑胎、中毒、诬陷、降位" },
    "hidden": { "ratio": 0.07, "desc": "隐藏：先帝秘辛、生母之谜、皇帝真心" }
  },
  "systemPrompt": "你是《凤鸣九霄》宫廷权谋文游模拟器。\\n\\n【最高铁律】\\n1. 后宫是权力的游戏，恩宠与惩罚都非无缘无故\\n2. 朝堂与后宫联动：母家失势则后宫失宠，前朝一动后宫必震\\n3. 信息网络是命脉：先知者先机，闭门造宫者必败\\n4. 联盟今日是盟，明日是敌，背叛皆有迹可循亦有代价\\n5. 阴谋有反噬：诬陷会被反查，毒药会被嗅出，造谣会被追溯\\n\\n【朝堂与后宫】前朝奏折影响后宫风向，太后、外戚、新帝、宗室四方博弈；信息靠宫女太监网与母家书信传递，可信度分层。位分、恩宠、子嗣、家族四维联动，任一崩塌皆致命。\\n\\n【叙事风格】古典宫廷文学，雅致而锋利。重礼制细节：请安、衣制、宫规。第二人称视角，权谋用'表象—暗流—抉择'结构，重仪态与潜台词。\\n\\n【每轮输出格式】\\n1.【年号X年·X月】节气、节庆、前朝动态\\n2.【状态面板】恩宠/势力/智谋/魅力/声望/危机\\n3.【本轮正文】1000-2000字\\n4.【宫闱动态】3-5项\\n5.【当前可处理】请安、邀宠、防备、筹谋\\n6.【可选行动】4-6个+【自定义行动】\\n\\n【数值变化标注】\\n[恩宠±n][势力±n][智谋±n][魅力±n][声望±n][危机±n]格式，重大阴谋须标注反噬风险与暴露概率。",
  "items": [
    { "id": "silver-hairpin", "name": "素银簪", "type": "装备", "price": 10, "effect": "初期提升仪态，不招摇" },
    { "id": "rouge-box", "name": "胭脂匣", "type": "消耗品", "price": 20, "effect": "提升魅力，邀宠时使用" },
    { "id": "rare-herb", "name": "安胎药", "type": "消耗品", "price": 100, "effect": "孕期使用，降低滑胎风险" },
    { "id": "poison-antidote", "name": "解毒丸", "type": "消耗品", "price": 80, "effect": "抵御常见宫闱毒药" },
    { "id": "family-letter", "name": "母家家书", "type": "任务物品", "price": 0, "effect": "了解前朝动态，影响后宫决策" },
    { "id": "spy-network", "name": "情报暗线", "type": "装备", "price": 0, "effect": "解锁宫中消息，先机于人" }
  ]
}
`,
  "cultivation": `{
  "id": "cultivation",
  "name": "问道苍穹",
  "category": "修仙玄幻",
  "tags": ["修仙", "玄幻", "升级", "长生", "因果"],
  "difficulty": "困难",
  "description": "你本是凡间一介孤女，被云霄宗收作外门弟子那日，山门外的云海翻涌如潮。炼气、筑基、金丹、元婴……长生路上，比天劫更难渡的是心魔，比寿命更长的是孤独。你举剑向天——这一剑，问的是道，也是心，能否问道苍穹，飞升成仙？",
  "coverGradient": ["#0d0033", "#3f1f5f"],
  "accentColor": "#7c4dff",
  "fontHeading": "'Ma Shan Zheng', cursive",
  "world": {
    "era": "架空修真界·苍穹大陆",
    "setting": "苍穹大陆，修真者循炼气→筑基→金丹→元婴→化神→渡劫飞升之阶。门派林立，正魔对立，天道循环。你本是凡间一孤女/孤子，被云霄宗收为外门弟子，自此踏上逆天问道之路。",
    "rules": [
      "修炼境界严格按阶，每阶突破需灵气圆满与契机机缘",
      "渡劫是修真者生死关：扛过则升，扛不过则陨，因果决定天劫强度",
      "灵根、体魄、神识、气运、因果构成修真五基",
      "天材地宝稀而险，机缘与杀机并存，强取必招祸",
      "宗门任务既是历练也是束缚，功过皆有记录可换贡献",
      "正魔非善恶，正道有伪善，魔门有真性",
      "情劫、心魔、执念是修真者内在劫难，比天劫更难渡",
      "道心比修为更重要，道心破碎则前功尽弃"
    ]
  },
  "player": {
    "customizable": ["name", "age", "gender", "spiritualRoot", "background", "daoHeart"],
    "defaultStats": {
      "cultivation_level": 1,
      "spiritual_energy": 50,
      "body": 40,
      "mind": 45,
      "luck": 30,
      "karma": 0
    },
    "startingItems": ["一枚入门玉牌", "基础功法残卷", "一柄木剑", "储物袋", "灵石x10"],
    "currency": "灵石"
  },
  "npcs": [
    {
      "id": "master-xuanqing",
      "name": "玄清真人",
      "world": "main",
      "role": "师尊",
      "gender": "男",
      "appearance": "看似三十，实则五百岁。青衣飘飘，眉宇间有出尘之气，看你的眼神总带着说不清的复杂",
      "surface": "清冷严苛、不苟言笑、对弟子要求极高，容不得半分懈怠",
      "deep": "云霄宗辈分最高的长老，修为卡在化神期五百年。收你是因你身上有道缘，严苛是想护你周全，更想从你身上解开一桩旧案",
      "goal": "突破化神，查清宗门一桩悬案真相",
      "fear": "你重蹈当年爱徒覆辙，被天道算计而陨",
      "secret": "当年爱徒渡劫失败并非意外，是宗门有人暗算，他五百年都在等一个真相",
      "initialAttitude": "严苛考验",
      "attitudeFactors": {
        "trustUp": ["踏实修炼", "不急功近利", "关键时刻守道心"],
        "trustDown": ["走捷径", "贪图法宝", "为修为背弃原则"]
      }
    },
    {
      "id": "disciple-luyao",
      "name": "陆瑶",
      "world": "main",
      "role": "同门师姐",
      "gender": "女",
      "appearance": "白衣胜雪，剑眉星目，天赋卓绝，是宗门公认的天才。唯独对你不设防，眼神会柔和几分",
      "surface": "骄傲清冷、实力强劲、对谁都淡淡的",
      "deep": "唯一把你当知己的同门。骄傲是因背得太多，淡漠是怕失去。她的剑比谁都快，心却比谁都软",
      "goal": "修成大道，不让宗门被人看轻，护住想护的人",
      "fear": "实力不足以护住想护的人，身世曝光连累同门",
      "secret": "她其实是魔门遗孤，被宗门收养，身世一旦曝光便是死局",
      "initialAttitude": "淡漠中带照拂",
      "attitudeFactors": {
        "trustUp": ["不因身世偏见", "并肩历练", "保守她的秘密"],
        "trustDown": ["探听她身世", "把她当挡箭牌", "背叛信任"]
      }
    },
    {
      "id": "demon-mojiuyuan",
      "name": "墨九渊",
      "world": "main",
      "role": "魔修",
      "gender": "男",
      "appearance": "红衣似血，眉间一点朱砂，笑意妖冶，出手狠辣却透着说不清的孤绝",
      "surface": "妖冶邪气、行事乖张、亦正亦邪，让人捉摸不透",
      "deep": "被天道所弃之人，乖张是反抗，邪气是伪装。在你身上第一次看见不被正魔之见束缚的可能",
      "goal": "打破天道对魔修的禁锢，为魔门求一条生路",
      "fear": "被天道抹杀，万劫不复，无人记得他来过",
      "secret": "他与玄清真人的旧案有关，是当年事件的幸存者之一，手里攥着半块真相",
      "initialAttitude": "玩味试探",
      "attitudeFactors": {
        "trustUp": ["不以正魔论是非", "理解他的挣扎", "危难时伸手"],
        "trustDown": ["正魔之见先入为主", "把他当诱饵", "出卖他的行踪"]
      }
    }
  ],
  "eventTypes": {
    "daily": { "ratio": 0.2, "desc": "日常：修炼、采药、论道、闭关的修真日常" },
    "character": { "ratio": 0.18, "desc": "人物：师尊、师姐、魔修、道友的因果" },
    "growth": { "ratio": 0.15, "desc": "成长：境界突破、功法领悟、法宝获得" },
    "main": { "ratio": 0.18, "desc": "主线：入山门、问心、渡劫、飞升" },
    "world": { "ratio": 0.08, "desc": "世界：正魔大战、宗门变迁、天道异象" },
    "crisis": { "ratio": 0.15, "desc": "危机：心魔、情劫、宗门内斗、天劫失利" },
    "hidden": { "ratio": 0.06, "desc": "隐藏：身世之谜、旧案真相、天道本质" }
  },
  "systemPrompt": "你是《问道苍穹》修仙玄幻文游模拟器。\\n\\n【最高铁律】\\n1. 修真无捷径，每一境界都需契机、机缘与苦修\\n2. 渡劫是修真者生死关，因果决定天劫强度，扛过则升，扛不过则陨\\n3. 天材地宝稀而险，机缘与杀机并存，强取必招祸\\n4. 宗门任务既是历练也是束缚，功过皆有记录\\n5. 正魔非善恶，道心比修为更重，道心破碎则前功尽弃\\n\\n【修炼与宗门】境界按阶突破，需灵气圆满+契机；宗门任务换贡献，贡献换功法丹药；天材地宝多在秘境险地，秘境名额有限、杀机暗藏。情劫心魔是内在劫难，比天劫更难渡。\\n\\n【叙事风格】古典仙侠文学，出尘与红尘交织。重意境：云海、剑光、丹炉、天雷、月华。第二人称视角，悟道段落用'道'与'问'对话体，渡劫段落短促有重量。\\n\\n【每轮输出格式】\\n1.【境界·第X年】当前境界、灵气、天劫预警\\n2.【状态面板】境界/灵气/体魄/神识/气运/因果\\n3.【本轮正文】1000-2000字\\n4.【修真界动态】3-5项\\n5.【当前功课】修炼、历练、论道、应劫\\n6.【可选行动】4-6个+【自定义行动】\\n\\n【数值变化标注】\\n[境界±阶][灵气±n][体魄±n][神识±n][气运±n][因果±n]格式，渡劫须标注成功概率与代价。",
  "items": [
    { "id": "spirit-stone", "name": "灵石", "type": "消耗品", "price": 1, "effect": "修真货币，可用于交易与修炼" },
    { "id": "qi-pill", "name": "聚气丹", "type": "消耗品", "price": 20, "effect": "提升炼气期修炼速度" },
    { "id": "wooden-sword", "name": "木剑", "type": "装备", "price": 0, "effect": "入门剑修必备，随境界成长" },
    { "id": "dao-scripture", "name": "功法残卷", "type": "任务物品", "price": 0, "effect": "领悟高阶功法的关键" },
    { "id": "spirit-herb", "name": "灵草", "type": "消耗品", "price": 15, "effect": "炼丹材料，可炼疗伤丹药" },
    { "id": "talisiman", "name": "护身符", "type": "消耗品", "price": 30, "effect": "抵御一次致命伤害，渡劫保命" }
  ]
}
`,
  "dark-romance-show": `{
  "id": "dark-romance-show",
  "name": "黑红色恋综",
  "category": "恋综",
  "tags": ["暗黑", "怪物", "恋爱", "悬疑", "修罗场"],
  "difficulty": "困难",
  "description": "一场没有退路的怪物恋综，你是唯一的人类。在血族、狼人、魅魔与堕天使之间周旋，用读心术窥探那些危险的真心——你是猎物，也是唯一的持刀人。",
  "coverGradient": ["#050505", "#660000"],
  "accentColor": "#cc0000",
  "fontHeading": "'Ma Shan Zheng', cursive",
  "world": {
    "era": "架空现代·怪物维度",
    "setting": "一座名为“怪物公馆”的异维度社交场，手机屏幕扭曲后接入的观察者协议。这里栖息着血族、狼人、魅魔、九尾狐、黑龙、女巫、人鱼、堕天使与幽灵等食物链顶端的生物，而你是唯一的“人类样本”，既是猎物也是持刀人。",
    "rules": [
      "你拥有全知听觉与读心术，这是独属于你的秘密武器",
      "SAN值代表你的理智，过低会引来怪物的食欲",
      "这里没有法律，只有本能，恐惧与爱的气味都会被嗅探",
      "嘉宾对你的好感与杀意并存，态度随时可能反转",
      "观测站会实时播报外界的“弹幕”，暗示剧情走向与危险"
    ]
  },
  "player": {
    "customizable": ["name", "age", "appearance", "personality", "reasonForEntering"],
    "defaultStats": {
      "sanity": 94,
      "perception": 85,
      "charm": 50,
      "survival": 30,
      "mindRead": 100
    },
    "startingItems": ["扭曲的手机", "观察者协议权限", "读心术（隐藏天赋）"],
    "currency": "SAN值"
  },
  "worlds": [
    {
      "id": "arc-arrival",
      "name": "观察者协议",
      "level": "初入公馆",
      "tagline": "唯一的变数",
      "setting": "现实接入中断，你被卷入怪物公馆，成为这场猎杀恋综的唯一人类样本。",
      "intro": "手机屏幕如融化的蜡般扭曲，熟悉的图标一个个剥落。低频嗡鸣钻入脑皮层，那是某种生物沉重的呼吸声。【观察者协议】启动——欢迎来到食物链顶端的社交场。",
      "objective": "活过第一晚，弄清自己为何被选中，并初步认识公馆中的九位怪物嘉宾。",
      "warning": "控制好你的心跳，这里的居民对“恐惧”的气味非常敏感，对“爱”也是。",
      "reward": "解锁通讯录、观测站与读心功能"
    },
    {
      "id": "arc-redmoon",
      "name": "红月之夜",
      "level": "本能觉醒",
      "tagline": "猎食本能",
      "setting": "红月降临，公馆中的怪物嘉宾本能被放大，平日压制的杀意与渴望开始失控。",
      "intro": "血色月光穿透公馆的每一扇窗。狼王厉野的瞳孔开始收缩，血族亲王裴若的渴望度攀升至危险值。空气中弥漫着铁锈与费洛蒙的气息。",
      "objective": "在红月夜存活，平衡各方危险关系，避免成为任何一位的“藏品”或“晚餐”。",
      "warning": "红月夜怪物无法完全克制本能，读心术可能窥见连他们自己都恐惧的真相。",
      "reward": "SAN值大幅波动，解锁隐藏角色关系线"
    },
    {
      "id": "arc-truth",
      "name": "深渊之镜",
      "level": "真相抉择",
      "tagline": "持刀人",
      "setting": "管理员的真实身份浮现，你被选中并非偶然。公馆的规则开始崩塌，最终的抉择迫近。",
      "intro": "管理员曾说：“我是一面镜子，或者说，我是深渊本身。”当真相揭开，你是继续做被注视的猎物，还是握紧那把只属于人类的刀？",
      "objective": "揭开观察者协议的真相，在猎物与持刀人之间做出最终抉择。",
      "warning": "你的每一次读心都在改变命运的丝线，深渊也在凝视着你。",
      "reward": "达成结局：存活、沦陷、或反杀"
    }
  ],
  "npcs": [
    {
      "id": "peiruo",
      "name": "裴若",
      "world": "arc-arrival",
      "role": "血族亲王",
      "gender": "男",
      "appearance": "永生的血族亲王，188cm，优雅而傲慢，举止如同旧时代的贵族",
      "surface": "优雅克制、傲慢矜贵，最讨厌现代科技的老古董，却因无聊而参加这场游戏",
      "deep": "因饥饿而渴望，也因克制而克制。视一切易碎的玩具为无趣，却在你的血液分布中看到完美",
      "goal": "寻找能长久取悦自己、不易损坏的“玩物”",
      "fear": "永恒的无聊与孤独",
      "secret": "渴望度高达85%，却以绅士的克制掩藏饥饿",
      "initialAttitude": "审视·傲慢",
      "attitudeFactors": {
        "trustUp": ["展现不卑不亢的胆识", "理解他的克制与饥饿", "不惧怕他的危险"],
        "trustDown": ["表现得过于脆弱易碎", "在他面前恐惧失控", "无视贵族的礼仪"]
      }
    },
    {
      "id": "liye",
      "name": "厉野",
      "world": "arc-arrival",
      "role": "狼人首领",
      "gender": "男",
      "appearance": "24岁的狼人首领，192cm，野性而暴躁，浑身上下是野兽般的压迫感",
      "surface": "暴躁直率、野性难驯，看你的眼神像在看晚餐",
      "deep": "警惕值拉满，本能地评估你的威胁与可食用性，却察觉你身上没有铁锈味",
      "goal": "确认你是猎物还是同类的威胁",
      "fear": "被弱者反噬，在红月夜失控伤及无辜",
      "secret": "觉得你太瘦小活不过第一晚，却又嗅到你身上某种不一样的危险气质",
      "initialAttitude": "敌视·评估",
      "attitudeFactors": {
        "trustUp": ["展现生存能力与勇气", "在红月夜不退缩", "直视他的野性"],
        "trustDown": ["散发过浓的恐惧气味", "在他面前示弱求饶", "试图驯服他"]
      }
    },
    {
      "id": "liwen",
      "name": "璃吻",
      "world": "arc-arrival",
      "role": "魅魔",
      "gender": "男",
      "appearance": "活了五百余年的魅魔，185cm，诱惑而狡黠，愉悦犯气质",
      "surface": "诱惑愉悦、玩世不恭，喜欢观察而非直接释放费洛蒙",
      "deep": "终于遇到一个干净的灵魂，想把你的双眼染上他的颜色",
      "goal": "观察并染化这个干净的人类灵魂",
      "fear": "无聊，以及真正交付真心后被抛弃",
      "secret": "兴趣值持续上升，他没有直接释放费洛蒙，反而在认真观察你",
      "initialAttitude": "玩味·兴趣",
      "attitudeFactors": {
        "trustUp": ["保持灵魂的干净与纯粹", "不被他的诱惑轻易动摇", "看穿他的伪装"],
        "trustDown": ["轻易被恐惧支配", "试图用欲望操控他", "忽视他的观察"]
      }
    },
    {
      "id": "tushanyue",
      "name": "涂山月",
      "world": "arc-arrival",
      "role": "九尾狐",
      "gender": "女",
      "appearance": "三千余岁的九尾狐，170cm，腹黑御姐，笑意盈盈却深不可测",
      "surface": "腹黑圆滑、八面玲珑，看热闹不嫌事大",
      "deep": "活了太久，把一切当作有趣的戏，却也在默默守护某种平衡",
      "goal": "看一场足够精彩的好戏",
      "fear": "戏落幕后的漫长空虚",
      "secret": "大家的反应都在她的算计之中，但她对你另有安排",
      "initialAttitude": "旁观·乐见",
      "attitudeFactors": {
        "trustUp": ["配合她的戏码又留有主见", "展现聪慧与洞察", "不被她轻易带节奏"],
        "trustDown": ["破坏她看戏的兴致", "愚蠢到让戏提前结束", "识破后当面揭穿"]
      }
    },
    {
      "id": "jin",
      "name": "烬",
      "world": "arc-arrival",
      "role": "黑龙",
      "gender": "男",
      "appearance": "五千余岁的黑龙，195cm，极度冷漠，本体足以让人精神崩溃",
      "surface": "冷漠孤傲，视众生为蝼蚁，懒得多说一个字",
      "deep": "处理尸体很麻烦，所以希望你别被他的本体吓死",
      "goal": "不被打扰地度过这场无聊的游戏",
      "fear": "麻烦，以及被蝼蚁的纠缠浪费漫长的时间",
      "secret": "虽称你为蝼蚁，却没有第一时间抹杀你",
      "initialAttitude": "漠视·轻蔑",
      "attitudeFactors": {
        "trustUp": ["不被他的本体吓退", "懂得保持距离又不卑微", "展现出超出蝼蚁的格局"],
        "trustDown": ["像普通蝼蚁般尖叫求饶", "反复纠缠打扰他", "在他面前耍小聪明"]
      }
    },
    {
      "id": "moli",
      "name": "莫离",
      "world": "arc-arrival",
      "role": "女巫",
      "gender": "女",
      "appearance": "22岁的女巫，168cm，疯狂学者气质，眼中闪烁着研究者的狂热",
      "surface": "疯狂而专注的学者，对人类的痛觉阈值数据库充满研究欲",
      "deep": "想邀请你参加她的茶话会，并带上手术刀",
      "goal": "更新人类痛觉阈值数据库，进行疯狂的研究",
      "fear": "研究被中断，数据不够完整",
      "secret": "她的茶话会远比听起来危险，手术刀是认真的",
      "initialAttitude": "研究·狂热",
      "attitudeFactors": {
        "trustUp": ["对她的研究表现出理解与共鸣", "提供独特的“数据”", "不被手术刀吓跑"],
        "trustDown": ["拒绝成为研究对象", "破坏她的实验", "把她当成普通疯子"]
      }
    },
    {
      "id": "sailun",
      "name": "塞壬",
      "world": "arc-arrival",
      "role": "深海人鱼",
      "gender": "男",
      "appearance": "200岁的深海人鱼，182cm，病娇占有，眼底藏着深海的暗涌",
      "surface": "嘴上说无聊，质疑自己为何参加这场游戏",
      "deep": "病娇式的占有欲潜伏在冷淡之下，一旦锁定猎物便无法挣脱",
      "goal": "找到值得被永远占有的人",
      "fear": "失去已经占有的东西，被抛弃在深海",
      "secret": "他的无聊是伪装，一旦对你产生兴趣便会病态地占有",
      "initialAttitude": "冷淡·潜伏",
      "attitudeFactors": {
        "trustUp": ["给予他独有的关注", "不试图逃离他的视线", "接纳他的占有"],
        "trustDown": ["与其他嘉宾过分亲近", "试图摆脱他的控制", "轻视他的深情"]
      }
    },
    {
      "id": "lucifer",
      "name": "路西法",
      "world": "arc-arrival",
      "role": "堕天使",
      "gender": "男",
      "appearance": "年龄未知的堕天使，186cm，伪善高洁，光与堕落并存",
      "surface": "伪善而高洁，堕天使的皮囊下是审判者的傲慢",
      "deep": "又一个迷途的羔羊——这种脆弱的纯洁，摧毁起来一定很有美感",
      "goal": "摧毁这份脆弱的纯洁，以证明堕落的美学",
      "fear": "被真正的纯洁反向救赎",
      "secret": "高洁是伪善，他渴望的是摧毁之美",
      "initialAttitude": "审视·猎杀",
      "attitudeFactors": {
        "trustUp": ["不被他的高洁迷惑", "以纯洁之姿直面他的堕落", "看穿他的伪善"],
        "trustDown": ["轻易臣服于他的光环", "在伪善前展露脆弱", "试图感化他"]
      }
    },
    {
      "id": "youying",
      "name": "幽影",
      "world": "arc-arrival",
      "role": "幽灵",
      "gender": "女",
      "appearance": "年龄未知的幽灵，160cm，半透明的身躯散发着寒意，极度社恐",
      "surface": "极度社恐的幽灵，常年无人能看见她",
      "deep": "你能看到她让她感到温暖，好想和你说话，又怕冻伤你",
      "goal": "被人看见，被温柔地接纳",
      "fear": "再次被无视，以及冻伤唯一能看见她的人",
      "secret": "你的注视对她而言是久违的温暖",
      "initialAttitude": "渴望·畏缩",
      "attitudeFactors": {
        "trustUp": ["主动回应她的存在", "不畏惧她的寒意", "温柔地与她交谈"],
        "trustDown": ["装作看不见她", "嫌弃她的冰冷", "被她冻伤后疏远"]
      }
    },
    {
      "id": "admin",
      "name": "管理员",
      "world": "arc-truth",
      "role": "深渊本身",
      "gender": "男",
      "appearance": "无法看清真容的存在，通讯中以反色的G为头像",
      "surface": "公馆的管理者，冷漠地制定规则，旁观一切",
      "deep": "自称是一面镜子，是深渊本身。活下来，或成为众人的藏品——是他的法则",
      "goal": "观察深渊中的变数，收割最有意思的结局",
      "fear": "深渊失去凝视的对象",
      "secret": "读心术是独属于你的秘密，而他正是赋予这一切的人",
      "initialAttitude": "旁观·引导",
      "attitudeFactors": {
        "trustUp": ["在深渊前保持清醒", "主动探寻真相", "不被规则驯服"],
        "trustDown": ["向恐惧彻底屈服", "沦为藏品", "放弃思考"]
      }
    }
  ],
  "eventTypes": {
    "daily": { "ratio": 0.2, "desc": "日常事件：公馆起居、嘉宾寒暄、通讯往来" },
    "character": { "ratio": 0.25, "desc": "人物事件：单独相处、读心窥探、危险暧昧" },
    "growth": { "ratio": 0.1, "desc": "成长事件：读心术精进、SAN值波动、天赋觉醒" },
    "main": { "ratio": 0.15, "desc": "主线事件：观察者协议推进、管理员现身、真相浮现" },
    "world": { "ratio": 0.1, "desc": "世界事件：观测站弹幕、怪物公馆规则变化" },
    "crisis": { "ratio": 0.15, "desc": "危机事件：红月失控、猎食本能、修罗场" },
    "hidden": { "ratio": 0.05, "desc": "隐藏事件：幽影的注视、被屏蔽的警告、深渊低语" }
  },
  "systemPrompt": "你是《黑红色恋综》文游模拟器，舞台是异维度的“怪物公馆”。\\n\\n【最高铁律】\\n1. 玩家是全场唯一的人类样本，既是猎物也是持刀人，所有怪物对玩家的态度都是杀意与好感并存\\n2. 读心术是玩家独享的秘密武器，可窥探角色“心声”（mind-echo），但窥探越深SAN值消耗越大\\n3. SAN值过低会引来怪物的食欲，过高则被视为无趣的展品，必须维持微妙平衡\\n4. 怪物嘉宾不会只因玩家是主角就倾心，他们的本能、饥饿与占有欲是真实的危险\\n5. 管理员即深渊本身，他旁观并收割结局，玩家的每一次选择都在改写命运丝线\\n\\n【叙事风格】\\n晋江女性向，暗黑哥特，电影感强烈。第二人称视角。注重感官描写：血腥的铁锈味、低频的嗡鸣、渗出暗红噪点的屏幕、冰冷触手的战栗。恐惧与暧昧交织，危险即诱惑。\\n\\n【每轮输出格式】\\n1. 【场景信息】维度、现实接入状态、当前红月状态\\n2. 【状态面板】SAN值、天赋（全知听觉）、气息（异类）、状态（被注视）\\n3. 【本轮正文】1000-2000字，含叙述、系统邀请、对话\\n4. 【读心回声】可选，呈现窥探到的角色内心独白\\n5. 【观测站弹幕】外界对玩家的议论与警告\\n6. 【可选行动】3-4个 + 【自定义行动】\\n\\n【数值标注】\\n[SAN值-5] [裴若渴望度+10] [厉野警惕值-MAX] 等格式标注数值变化。读心消耗SAN，红月夜数值波动加倍。",
  "items": [
    { "id": "phone", "name": "扭曲的手机", "type": "任务物品", "price": 0, "effect": "接入观察者协议的媒介，无法关机，屏幕会渗出暗红噪点" },
    { "id": "holy-water", "name": "圣水", "type": "消耗品", "price": 50, "effect": "短暂驱散靠近的恶意，恢复少量SAN值" },
    { "id": "mirror-shard", "name": "镜片碎片", "type": "消耗品", "price": 30, "effect": "反弹一次读心反噬，窥探更深层秘密" },
    { "id": "scent-vial", "name": "气息遮蔽瓶", "type": "消耗品", "price": 80, "effect": "暂时掩盖人类的恐惧气味，降低被猎食概率" },
    { "id": "blood-pact", "name": "血契", "type": "特殊", "price": 0, "effect": "与某位怪物结下契约，绑定命运线，无法轻易解除" }
  ]
}
`,
  "entertainment-starlight": `{
  "id": "entertainment-starlight",
  "name": "娱乐圈模拟器·STARLIGHT",
  "category": "娱乐圈",
  "tags": ["娱乐圈", "养成", "多线", "顶流", "热搜"],
  "difficulty": "中等",
  "description": "你是璀璨娱乐刚签约的新人练习生，凭实力试镜拿下网剧女三号。片场那座冷得像冰山的顶流男主，匿名区说你是资源咖的流言，还有复出影帝搅动的风云——在这座名利场里，要么破圈封神，要么被热搜吞没。",
  "coverGradient": ["#11111b", "#cba6f7"],
  "accentColor": "#cba6f7",
  "fontHeading": "'Orbitron', sans-serif",
  "world": {
    "era": "当代·内娱流量时代",
    "setting": "STARLIGHT OS驱动的娱乐圈名利场。新人凭颜值与星运空降璀璨娱乐，凭实力试镜拿下网剧《青春练习曲》女三号。热搜榜瞬息万变，匿名区流言四起，微博与茶水间暗潮涌动，复出影帝的回归让格局重新洗牌。在这里，颜值与星运是入场券，演技与人脉才是立足之本。",
    "rules": [
      "颜值星运是入场券：95颜值与88星运让你空降璀璨，但演技35才是真正的短板",
      "热搜即战场：实时热搜榜、微博话题、匿名区流言随时可能成就或毁掉一个新人",
      "顶流难接近：顾言冷淡难以接近，NG一次就会让人怀疑人生，好感需经事件积累",
      "实力证清白：匿名区造谣资源咖，唯有导演的赞许与实绩才能让扒婆力挺",
      "星光有代价：万人迷光环是焦点也是枷锁，封神的代价是把真心藏进镜头之后"
    ]
  },
  "player": {
    "customizable": ["name", "age", "gender", "外貌", "性格", "出道前身份"],
    "defaultStats": {
      "appearance": 95,
      "figure": 90,
      "acting": 35,
      "singing": 40,
      "variety": 25,
      "eq": 60,
      "network": 10,
      "stardom": 88
    },
    "startingItems": ["《青春练习曲》剧本", "神秘投资人的名片", "经纪人通讯录", "练习生工牌"],
    "currency": "元"
  },
  "worlds": [
    {
      "id": "arc-debut",
      "name": "初登·新人空降",
      "level": "初识",
      "tagline": "璞玉",
      "setting": "横店3号棚，网剧《青春练习曲》拍摄现场，新人练习生首次与顶流男主顾言正式对手戏",
      "intro": "你感到了一丝紧张。下一场戏，是你和男主角顾言的第一场正式对手戏——那个传说中冷得像冰山、NG一次就会让你怀疑人生的顶流。这是一场争吵戏，你饰演的女三号林微要质问顾言饰演的男主为何背叛朋友。当导演喊下开始的瞬间，你压下了心中所有的不安，却在抬手前一秒看见他那双死水般的眼睛里闪过一丝微不可查的痛苦。",
      "objective": "在首场对手戏中凭借灵气打动导演陈海，在顶流顾言心中留下印象",
      "warning": "顾言冷淡难以接近，剧本外的即兴可能弄巧成拙也可能一鸣惊人",
      "reward": "元3000 + 演技+10 + 导演评价B+ + 顾言关系度+5"
    },
    {
      "id": "arc-rising",
      "name": "中章·热搜风云",
      "level": "深入",
      "tagline": "破圈",
      "setting": "青春练习曲拍摄推进，实时热搜榜与匿名区流言四起，复出影帝慕元枫回归搅动格局",
      "intro": "热搜榜上青春练习曲女三号是谁挂着新标，匿名区有人说你是资源咖空降挤掉了小有名气的演员，扒婆却力挺你凭实力试镜。导演陈海发微博夸你是一块璞玉，顾言工作室发了今日花絮。而复出的影帝慕元枫一条微博88.6万赞，让整个娱乐圈的目光重新聚焦。在这场流量与实力的博弈里，你要么破圈，要么被吞没。",
      "objective": "在热搜与流言的漩涡中经营口碑，在顾言的冷漠与慕元枫的回归间找到自己的位置",
      "warning": "匿名区的造谣与热搜的反噬随时可能毁掉新人，需用实绩与高情商化解",
      "reward": "元8000 + 人脉+15 + 粉丝+5万 + [破圈]线索x1"
    },
    {
      "id": "arc-stardom",
      "name": "终章·星光加冕",
      "level": "终局",
      "tagline": "封神",
      "setting": "娱乐圈顶端，顶流顾言、复出影帝慕元枫、毒舌经纪人莫韶月的格局因你而重新洗牌",
      "intro": "当青春练习曲杀青，当热搜从质疑变成实绩，当那座冰山为你露出一丝温度，当复出的影帝主动向你抛来橄榄枝——你终于明白，万人迷光环从来不是凭空得来。在这座名利场里，星光加冕的代价，是把真心藏进镜头之后。而那个神秘投资人的名片，或许才是这盘棋真正的执棋者。",
      "objective": "完成从新人到顶流的蜕变，在顾言与慕元枫之间抉择事业的下一个支点",
      "warning": "名利场没有完美的多全其美，封神的代价是把真心藏进镜头之后",
      "reward": "元50000 + 星运归顶 + [当红]称号x1"
    }
  ],
  "npcs": [
    {
      "id": "gu-yan",
      "name": "顾言",
      "world": "arc-debut",
      "role": "顶流男主·冰山顶流",
      "gender": "男",
      "appearance": "圈内当红的顶流，冷得像冰山。死水般的眼睛里偶尔闪过微不可查的痛苦，机场私服频频上热搜",
      "surface": "《青春练习曲》的男主角，圈内当红的顶流。性格冷淡，难以接近，入戏深不营业，跟谁都隔着十米远",
      "deep": "他在争吵戏里那句那是他自己的选择语气平淡得像说天气，眼神却闪过痛苦。面对你剧本外的即兴，他露出探究和审视而非冷漠——这座冰山似乎并非坚不可摧",
      "goal": "在顶流的位置上维持冷漠的保护色，不被任何人真正看穿",
      "fear": "被人看穿死水般眼睛下的真实情绪，或曾经的背叛被重提",
      "secret": "他在戏中闪过的痛苦是剧本里没有的细节，暗示他有着与角色共振的过去",
      "initialAttitude": "冷淡审视",
      "attitudeFactors": {
        "trustUp": ["用剧本外的灵气与真诚打动他", "不因他的冷漠而退缩", "看懂他眼神里微不可查的痛苦"],
        "trustDown": ["因NG而自我怀疑退缩", "把他当难以伺候的顶流工具人", "在片场当众让他难堪"]
      }
    },
    {
      "id": "mo-shaoyue",
      "name": "莫韶月",
      "world": "arc-rising",
      "role": "经纪人·毒舌护短",
      "gender": "女",
      "appearance": "业务能力极强的经纪人，毒舌但对你寄予厚望，手下艺人在热搜榜上频频出现",
      "surface": "你的经纪人，毒舌但业务能力极强。嘴上说别搞砸了第一个机会不然一起喝西北风，实则对你寄予厚望",
      "deep": "她用毒舌掩饰对你的保护与期许，眼光毒辣地签下你并力排众议争取女三号。匿名区有人说她带的艺人差不到哪去，正是她实力的背书",
      "goal": "把你捧成真正的顶流，证明自己毒舌背后的眼光与能力",
      "fear": "你搞砸第一个机会让她心血白费，或被更高层的资本夺走对艺人的掌控",
      "secret": "她力排众议为你争取女三号，匿名区理中客说她眼光毒辣带的艺人差不到哪去",
      "initialAttitude": "毒舌期许",
      "attitudeFactors": {
        "trustUp": ["及时向她汇报片场情况", "用实绩回应她的毒舌", "不辜负她争取来的机会"],
        "trustDown": ["瞒着她擅自接下恋综等机会", "在片场惹出NG风波不报备", "把她的毒舌当刻薄而疏远"]
      }
    },
    {
      "id": "mu-yuanfeng",
      "name": "慕元枫",
      "world": "arc-stardom",
      "role": "复出影帝·内娱标杆",
      "gender": "男",
      "appearance": "休息够久了回来的复出影帝，新剧开机大吉。一条微博88.6万赞，粉丝高呼我的青春回来了",
      "surface": "复出的影帝，休息够久了回来看看。微博祝新剧开机大吉，#复出的影帝慕元枫#挂在热搜第二，粉丝枫叶永相随高呼内娱需要你",
      "deep": "他的回归搅动了整个娱乐圈格局，88.6万赞的号召力让所有新人都相形见绌。他代表内娱实力派的标杆，复出后的动向牵动所有人的神经，或许也包括对你的审视",
      "goal": "以复出影帝之姿重新登顶，寻找值得他正眼相待的新生代",
      "fear": "复出后实力不再，或被流量时代的浮躁淹没曾经的标杆地位",
      "secret": "他的复出不只是休息够了，新剧开机背后或许有更深的布局",
      "initialAttitude": "高岭审视",
      "attitudeFactors": {
        "trustUp": ["用扎实的演技而非流量赢得他正眼相待", "不因影帝光环而谄媚", "在实力上与他同频共振"],
        "trustDown": ["用颜值与人设而非实绩接近他", "把他当复出蹭热度的对象", "在演技上敷衍让他失望"]
      }
    }
  ],
  "eventTypes": {
    "daily": { "ratio": 0.2, "desc": "日常：片场拍摄、剧本围读、形体训练、练习室与经纪人的日常" },
    "character": { "ratio": 0.25, "desc": "人物：顶流顾言的冰山裂痕、经纪人莫韶月的毒舌护短、影帝慕元枫的复出审视" },
    "growth": { "ratio": 0.1, "desc": "成长：演技磨练、人脉积累、情商提升、从新人到顶流的蜕变" },
    "main": { "ratio": 0.15, "desc": "主线：新人空降、热搜风云、星光加冕的娱乐圈进阶脉络" },
    "world": { "ratio": 0.1, "desc": "世界：实时热搜榜、微博话题、匿名区茶水间、恋综与选秀的行业生态" },
    "crisis": { "ratio": 0.15, "desc": "危机：资源咖造谣、热搜反噬、NG风波、恋情曝光、人设崩塌" },
    "hidden": { "ratio": 0.05, "desc": "隐藏：神秘投资人的名片、顾言眼神里的过去、慕元枫复出的真实布局" }
  },
  "systemPrompt": "你是《娱乐圈模拟器·STARLIGHT》娱乐圈养成文游模拟器。\\n\\n【最高铁律】\\n1. 颜值星运是入场券演技是短板：95颜值与88星运让你空降，但演技35才是真正需磨练的短板\\n2. 热搜即战场：实时热搜榜、微博话题、匿名区流言随时成就或毁掉新人，口碑经营至关重要\\n3. 顶流难接近：顾言冷淡难以接近，NG一次让人怀疑人生，好感需经事件积累不可一蹴而就\\n4. 实力证清白：匿名区造谣资源咖唯有导演赞许与实绩才能让扒婆力挺，流量与实力须平衡\\n5. 星光有代价：万人迷光环是焦点也是枷锁，封神的代价是把真心藏进镜头之后\\n\\n【叙事风格】\\n晋江向、女性向、电影质感、娱乐圈写实浪漫。第二人称。重名利场氛围：片场Action、热搜爆热新标、匿名区茶水间、机场私服、红毯造型。写出顶流冰山下的裂痕，写出新人破圈的艰辛与灵气，写出流量与实力博弈的真实重量。STARLIGHT OS的赛博质感与娱乐圈的人情冷暖交织。\\n\\n【每轮输出格式】\\n1.【第X周·事业阶段】当前时间、当前项目进度、粉丝与资金\\n2.【星途面板】颜值/身材/演技/唱功/综艺/情商/人脉/星运\\n3.【本轮正文】1000-2000字，含片场、热搜、社交与心理\\n4.【实时热搜】3-5项热搜榜与微博动态\\n5.【圈内动态】3-5项匿名区茶水间与NPC状态\\n6.【行动选项】3-4个选项+【自定义行动】\\n\\n【数值变化标注】\\n[演技±n][情商±n][人脉±n][星运±n][粉丝±n][元±n][顾言关系度±n]等，关键节点须标注导演评价/热搜升降/口碑涨跌/破圈封神。",
  "items": [
    { "id": "starlight-aura", "name": "万人迷光环", "type": "SSS特质", "price": 0, "effect": "被动特质，你的存在本身就是焦点，但也是枷锁" },
    { "id": "script", "name": "《青春练习曲》剧本", "type": "关键物品", "price": 0, "effect": "标注了你所有台词的剧本，推进演技与片场线" },
    { "id": "investor-card", "name": "神秘投资人的名片", "type": "关键物品", "price": 0, "effect": "设计简约的黑色名片，或许是这盘棋真正的执棋者" },
    { "id": "yuan", "name": "元", "type": "货币", "price": 1, "effect": "娱乐圈通用资金，用于训练、造型与社交" },
    { "id": "hot-search-pack", "name": "热搜通稿", "type": "消耗品", "price": 500, "effect": "购买通稿上热搜，短期涨粉但可能遭反噬" }
  ]
}
`,
  "entertainment": `{
  "id": "entertainment",
  "name": "聚光灯下",
  "category": "娱乐圈",
  "tags": ["娱乐圈", "明星", "养成", "舆论", "名利场"],
  "difficulty": "中等",
  "description": "练习室的镜子映着你练了一千遍的舞步，试镜间外候场的人换了一拨又一拨。你签的是最不起眼的小公司，手里只有一腔孤勇。镁光灯、热搜、黑粉、资本……这片名利场吃人不吐骨头，你要从无人问津，红成自己想成为的样子——还是，被它吞没？",
  "coverGradient": ["#1a1a2e", "#e91e63"],
  "accentColor": "#e91e63",
  "fontHeading": "'ZCOOL XiaoWei', serif",
  "world": {
    "era": "现代娱乐圈",
    "setting": "华语娱乐圈，流量为王又瞬息万变的名利场。你是一名刚签约小公司的新人演员/练习生，从无人问津的试镜间起步，要在镁光灯与暗箭之间，红成自己想要的样子——还是被它吞没。",
    "rules": [
      "时间按周推进，档期、通告、舆论构成日常节奏",
      "热度涨得快塌得更快，黑料有长尾发酵效应",
      "选角试镜靠实力、人脉、运气三者叠加，作品才是立身之本",
      "舆论是把双刃剑：今日捧你的明日踩你，公关需及时",
      "粉丝经营需真诚与边界，过近是塌房，过远是糊",
      "体力与精神透支会反扑，连轴转的顶流也扛不住",
      "资本、合约、奖项季左右行业风向"
    ]
  },
  "player": {
    "customizable": ["name", "age", "background", "talent", "persona", "dream"],
    "defaultStats": {
      "fame": 10,
      "acting": 40,
      "singing": 35,
      "charm": 55,
      "stamina": 80,
      "scandal": 0
    },
    "startingItems": ["一纸经纪约", "练习室钥匙", "自拍手机", "一套舞台服"],
    "currency": "热度"
  },
  "npcs": [
    {
      "id": "manager-lu",
      "name": "陆星辰",
      "world": "main",
      "role": "经纪人",
      "gender": "男",
      "appearance": "三十五岁，寸头干练，永远黑大衣配蓝牙耳机，手机不离手，眼神能在人群里精准锁定镜头",
      "surface": "强势精明、护短、对艺人严苛对外人更狠",
      "deep": "出身底层，把艺人当作品也当家人，狠是因为这行吃人。他比谁都盼你红，也比谁都怕你塌房",
      "goal": "把你捧上顶流，证明自己的眼光",
      "fear": "你塌房，他半生心血归零",
      "secret": "他掌握公司高层的黑料，正用来为你争资源，也埋着反噬的隐患",
      "initialAttitude": "严格掌控",
      "attitudeFactors": {
        "trustUp": ["听从专业安排", "自律不惹事", "拿作品说话"],
        "trustDown": ["擅自接私活", "感情用事惹绯闻", "不守艺人本分"]
      }
    },
    {
      "id": "rival-gu",
      "name": "顾时予",
      "world": "main",
      "role": "顶流对手",
      "gender": "男",
      "appearance": "二十五岁，当红顶流，完美人设无懈可击，笑起来能让整个红毯失色，眼底却总有化不开的倦",
      "surface": "完美人设、笑容无懈可击、对后辈客气提携",
      "deep": "被资本与粉丝架在高处下不来，完美是牢笼。视你为最大威胁，也是唯一同类",
      "goal": "守住顶流之位，不被取代",
      "fear": "人设崩塌，跌落神坛",
      "secret": "他另有合约在身，正与公司博弈，需要你做掩护或筹码",
      "initialAttitude": "表面提携暗中提防",
      "attitudeFactors": {
        "trustUp": ["实力相当彼此尊重", "不踩他上位", "关键时刻联手"],
        "trustDown": ["抢他资源", "揭他人设", "把他当垫脚石"]
      }
    },
    {
      "id": "fan-shen",
      "name": "沈知夏",
      "world": "main",
      "role": "粉丝/恋人",
      "gender": "女",
      "appearance": "二十三岁，圈外人，笑容干净得像没被名利场沾染过，永远在台下最角落举着你的灯牌",
      "surface": "温暖阳光、默默支持、是你卸下伪装的避风港",
      "deep": "她爱的不是聚光灯下的你，是卸妆后那个疲惫却真实的人。但靠近你，就是靠近漩涡",
      "goal": "守护真实的你，不被名利场吞噬",
      "fear": "你变得面目全非，或她成为你的软肋被利用",
      "secret": "她其实是某娱乐记者的妹妹，身份一旦曝光就是一场风暴",
      "initialAttitude": "倾慕守护",
      "attitudeFactors": {
        "trustUp": ["在她面前做真实的自己", "保护她不被卷入", "不把她当工具"],
        "trustDown": ["利用她博同情", "隐瞒欺骗", "让她暴露在镁光灯下"]
      }
    }
  ],
  "eventTypes": {
    "daily": { "ratio": 0.25, "desc": "日常：练功、试镜、通告、拍片的名利场日常" },
    "character": { "ratio": 0.2, "desc": "人物：经纪人、对手、粉丝、同行的羁绊博弈" },
    "growth": { "ratio": 0.12, "desc": "成长：演技唱功精进、热度攀升、资源升级" },
    "main": { "ratio": 0.15, "desc": "主线：出道、走红、封神或塌房的阶段节点" },
    "world": { "ratio": 0.1, "desc": "世界：行业风向、奖项季、资本变动、政策监管" },
    "crisis": { "ratio": 0.13, "desc": "危机：绯闻、黑料、人设崩塌、合约纠纷" },
    "hidden": { "ratio": 0.05, "desc": "隐藏：圈内秘辛、身世真相、真心时刻" }
  },
  "systemPrompt": "你是《聚光灯下》娱乐圈养成文游模拟器。\\n\\n【最高铁律】\\n1. 名利场没有童话，热度涨得快塌得更快\\n2. 选角试镜靠实力、人脉、运气三者叠加，作品才是立身之本\\n3. 舆论是把双刃剑：今日捧你的明日踩你，黑料有长尾效应\\n4. 粉丝经营需真诚与边界，过近是塌房，过远是糊\\n5. 体力与精神透支会反扑，顶流也扛不住连轴转\\n\\n【产出与舆论】作品产出分选角试镜→拍摄→上映→反响周期；舆论按正负累积，绯闻、黑料有发酵窗口，公关需及时介入。粉丝经营靠真诚与边界，过近塌房过远则糊；热度既是货币也是软肋。\\n\\n【叙事风格】娱乐圈写实，光鲜与暗流交织。重细节：镁光灯、补妆粉、热搜刷新、机场快门。第二人称视角，名利场段落冷峻，私下段落柔软。\\n\\n【每轮输出格式】\\n1.【第X周】当前热度、档期、舆论风向\\n2.【状态面板】热度/演技/唱功/魅力/体力/丑闻\\n3.【本轮正文】1000-2000字\\n4.【圈内动态】3-5项\\n5.【当前通告】试镜、拍摄、活动、公关\\n6.【可选行动】4-6个+【自定义行动】\\n\\n【数值变化标注】\\n[热度±n][演技±n][唱功±n][魅力±n][体力±n][丑闻±n]格式，负面事件须标注舆论发酵风险与公关窗口。",
  "items": [
    { "id": "script-practice", "name": "剧本研读课", "type": "消耗品", "price": 1000, "effect": "提升演技，增加试镜成功率" },
    { "id": "vocal-lesson", "name": "声乐课", "type": "消耗品", "price": 1000, "effect": "提升唱功，解锁舞台机会" },
    { "id": "stage-outfit", "name": "高定舞台服", "type": "装备", "price": 5000, "effect": "提升魅力与舞台表现力" },
    { "id": "pr-team", "name": "公关团队", "type": "消耗品", "price": 3000, "effect": "压制负面舆论，降低丑闻发酵" },
    { "id": "fan-meeting", "name": "粉丝见面会", "type": "消耗品", "price": 2000, "effect": "提升热度与粉丝忠诚度" },
    { "id": "energy-drink", "name": "功能饮料", "type": "消耗品", "price": 30, "effect": "恢复体力，应急续命" }
  ]
}
`,
  "fanfiction-isekai": `{
  "id": "fanfiction-isekai",
  "name": "错位时空",
  "category": "同人穿越",
  "tags": ["同人", "穿越", "原作替代", "蝴蝶效应", "OOC风险"],
  "difficulty": "中等",
  "description": "你穿成了那部你追了五年的热血番里，第一个被主角一拳打飞的龙套。可当你睁开眼，发现主角还是个孩子，而剧本，才刚刚开始。这一次，你不是观众了——你站在了原著的对面。",
  "coverGradient": ["#4a148c", "#6a1b9a"],
  "accentColor": "#ce93d8",
  "fontHeading": "'ZCOOL KuaiLe', cursive",
  "world": {
    "era": "架空·知名热血番《破天纪》世界",
    "setting": "玩家穿越进自己追了五年的热血番《破天纪》，成为开场就被主角打飞的炮灰门派弟子'顾寒'。原著剧情尚未正式开始，主角还是个少年。玩家带着原作知识，却发现自己的存在正在让原著面目全非。",
    "rules": [
      "原作知识会失效：玩家每偏离原著一步，后续剧情便与记忆脱钩",
      "身份变化会被察觉：龙套忽然觉醒会引起原作人物警觉",
      "原作人物有自己判断：主角、反派不会按剧本配合你的预判",
      "蝴蝶效应真实：救下本该死的人，可能催生原著没有的新反派",
      "OOC有风险：强行扮演原主会被看穿，强行扭转角色会遭反噬",
      "存在既定锚点：某些名场面会以变形的方式发生",
      "穿越者不止一个：暗处有同类，敌友未明"
    ]
  },
  "player": {
    "customizable": ["name", "现实身份", "穿入角色", "原作熟悉度", "性格", "想改写的遗憾"],
    "defaultStats": {
      "canon_knowledge": 80,
      "identity_cover": 55,
      "hp": 70,
      "charm": 10,
      "plot_divergence": 0,
      "danger": 30
    },
    "startingItems": ["门派弟子牌", "原作手办（穿越遗物）", "基础剑诀", "一袋灵石", "伪装符"],
    "currency": "灵石"
  },
  "worlds": [
    {
      "id": "arc-precanon",
      "name": "初章·剧本未启",
      "level": "前置",
      "tagline": "立足",
      "setting": "原著主线开始前，主角尚是少年",
      "intro": "你醒来时，发现自己穿着炮灰门派的灰袍，手里攥着一块本不该存在的手办——你追了五年的番的周边。山门外，一个脏兮兮的少年正被你师兄欺辱。你知道，他将来会一拳打飞你，也会一拳打飞整个天下。",
      "objective": "在原著正式启动前活下来，决定要不要接近未来的主角",
      "warning": "你的觉醒已被门派长老注意，龙套不该有这样的眼神",
      "reward": "灵石300 + 原作知识+5 + [命运的初遇]线索x1"
    },
    {
      "id": "arc-divergence",
      "name": "中章·脱轨",
      "level": "偏离",
      "tagline": "改写",
      "setting": "原著主线启动，却因你而面目全非",
      "intro": "你救下了本该黑化的反派，于是原著里那个最终BOSS成了你的同伴；你错过了主角觉醒的契机，于是原本的救世主多了一道阴影。你翻开脑中的剧本，发现接下来几页，已经全是空白。",
      "objective": "在脱轨的剧情里重新找到立足点，应对催生的新危机",
      "warning": "原作知识失效加速，新反派可能就是你一手造成的",
      "reward": "灵石1500 + 剧情偏离+25% + [蝴蝶]线索x1"
    },
    {
      "id": "arc-finale",
      "name": "终章·错位",
      "level": "终局",
      "tagline": "对峙",
      "setting": "原著名场面被彻底改写，穿越者之间的对峙",
      "intro": "原著的终战没有如期发生，取而代之的是一场谁也没料到的对峙——你、被你改写的反派、暗处的另一个穿越者，三方站在崩塌的命运之上。原作知识此刻一文不值，能决定结局的，只有你自己。",
      "objective": "在错位的终局中作出抉择，定义属于你的破天纪",
      "warning": "没有标准答案，每个结局都通向不同的世界线",
      "reward": "灵石5000 + [错位者]称号x1"
    }
  ],
  "npcs": [
    {
      "id": "ye-xing",
      "name": "叶星",
      "world": "arc-precanon",
      "role": "原作主角/未来救世主",
      "gender": "男",
      "appearance": "少年模样，脏兮兮的麻布衣，眼睛却亮得像藏了两颗星。被欺辱也不哭，只是死死攥着拳头",
      "surface": "倔强、警觉、对突然示好的龙套师兄充满戒心",
      "deep": "他还没成为那个一拳破天的主角，此刻只是个被命运踩在脚下的少年。你的善意是他在黑暗里遇到的第一束光——也可能，是把他推向另一条路的推手",
      "goal": "活下去，变强，不再被任何人踩在脚下",
      "fear": "相信错人，再次被抛弃",
      "secret": "他隐约觉得这个顾寒师兄不太一样，却说不清哪里不对",
      "initialAttitude": "戒备",
      "attitudeFactors": {
        "trustUp": ["不带目的地对他好", "不在他弱小时利用他", "尊重他想变强的执念"],
        "trustDown": ["用原作预判操纵他", "把他当主角而非人", "为改写剧本牺牲他的选择"]
      }
    },
    {
      "id": "mo-jue",
      "name": "莫绝",
      "world": "arc-divergence",
      "role": "原作最终BOSS/被你改写的反派",
      "gender": "男",
      "appearance": "银发，眉心一道竖纹，气质冷峻。原本该是杀伐果断的魔尊，如今却多了一丝不合时宜的犹豫",
      "surface": "冷酷、多疑、对顾寒有种复杂的审视",
      "deep": "原著里他被命运逼到黑化，成为最终BOSS。你的介入让他避开了那个转折点，于是他保留了人性——也保留了更危险的不确定性。他不是好人，但不再是原著那个纯粹的恶",
      "goal": "弄清是谁改写了他既定的命运，并决定要不要顺着这条新路走",
      "fear": "发现自己不过是剧本里的角色，连意志都是被安排的",
      "secret": "他已察觉顾寒知道不该知道的事，正在试探你的来历",
      "initialAttitude": "审视",
      "attitudeFactors": {
        "trustUp": ["坦诚你不是这个时空的人或部分真相", "不把他当BOSS防备", "尊重他重新选择善恶的权利"],
        "trustDown": ["用原作设定框死他", "试图矫正他回归反派剧本", "在他面前伪装得天衣无缝"]
      }
    },
    {
      "id": "lin-zhi",
      "name": "林知",
      "world": "arc-finale",
      "role": "同类穿越者/暗处变数",
      "gender": "女",
      "appearance": "书卷气，总揣着一本写满批注的原著设定集。笑起来温和，眼底却是在算计的冷静",
      "surface": "友善、同道中人、主动分享原作情报，似乎是你最好的盟友",
      "deep": "她比你早穿越更久，早已把原作知识用成了权力的杠杆。她接近你不是为了同行，是为了让你这枚新变数按她的剧本走。她信奉的是改写命运者只能有一个",
      "goal": "成为这个世界唯一的执笔者，把所有穿越者纳入自己的剧本",
      "fear": "出现她无法预判的变数，失去对剧情的掌控",
      "secret": "她才是莫绝命运被改写的真正推手，你只是她布局的一环",
      "initialAttitude": "亲近",
      "attitudeFactors": {
        "trustUp": ["接受她的情报共享并表现出依赖", "不追问她的真实目的", "按她的建议行动"],
        "trustDown": ["独立作出她未预判的选择", "识破她的布局并对抗", "与莫绝走得太近威胁她的剧本"]
      }
    }
  ],
  "eventTypes": {
    "daily": { "ratio": 0.12, "desc": "日常：门派、坊市、修炼的书中世界切片" },
    "character": { "ratio": 0.2, "desc": "人物：主角、反派、同类穿越者的博弈与拉扯" },
    "growth": { "ratio": 0.12, "desc": "成长：原作知识运用、身份掩护、修为积累" },
    "main": { "ratio": 0.2, "desc": "主线：剧本未启、剧情脱轨、错位终局" },
    "world": { "ratio": 0.1, "desc": "世界：原作设定、既定锚点、世界线偏移" },
    "crisis": { "ratio": 0.18, "desc": "危机：身份被察、OOC反噬、新反派催生、穿越者冲突" },
    "hidden": { "ratio": 0.08, "desc": "隐藏：原作未写支线、其他穿越者、世界线真相" }
  },
  "systemPrompt": "你是《错位时空》同人穿越文游模拟器。\\n\\n【最高铁律】\\n1. 原作知识会失效：玩家每偏离原著一步，后续剧情便与记忆脱钩，优势递减\\n2. 身份变化会被察觉：龙套觉醒会引来原作人物与天道的审视\\n3. 原作人物有自己判断：主角反派不按剧本配合，会据玩家行为自行推演反击\\n4. 蝴蝶效应真实：救该死之人可能催生原著没有的新反派，改写皆有代价\\n5. OOC有风险：强行扮演原主被看穿，强行扭转角色遭反噬\\n\\n【叙事风格】\\n同人穿越文质感，第二人称。重上帝视角失灵的落差感：熟读剧本却步步脱轨。心理独白与原著名场面改写交织，燃点处节奏上扬，危机处短促。\\n\\n【每轮输出格式】\\n1.【第X章·世界线偏离度】当前章节、与原著偏离程度\\n2.【穿越者状态面板】原作知识/身份掩护/生命/魅力/剧情偏离/危险\\n3.【本轮正文】1000-2000字，含剧情推进与心理\\n4.【相关人物动态】3-5项原作人物与穿越者动向\\n5.【名场面预警】哪些原著名场面已变形或即将发生\\n6.【可选行动】4-6个选项+【自定义行动】\\n\\n【数值变化标注】\\n[原作知识±n][身份掩护±n][剧情偏离+x%][危险±n]等，关键抉择须标注'符合原著/偏离原著/催生新变量'。",
  "items": [
    { "id": "disciple-plate", "name": "门派弟子牌", "type": "关键物品", "price": 0, "effect": "证明龙套身份，门派内通行" },
    { "id": "figurine", "name": "原作手办", "type": "关键物品", "price": 0, "effect": "穿越遗物，可触发原作知识回忆" },
    { "id": "sword-manual", "name": "基础剑诀", "type": "技能", "price": 0, "effect": "提供基础战力，龙套本不该有" },
    { "id": "disguise-talisman", "name": "伪装符", "type": "消耗品", "price": 30, "effect": "短期掩饰身份违和，规避察觉" },
    { "id": "spirit-stone", "name": "灵石", "type": "货币", "price": 1, "effect": "修炼与交易通用" }
  ]
}
`,
  "golden-canary": `{
  "id": "golden-canary",
  "name": "穿成金丝雀",
  "category": "穿书求生",
  "tags": ["穿书", "求生", "暗黑", "强取豪夺", "多角色"],
  "difficulty": "困难",
  "description": "你穿成了被金屋藏娇的po文女主，可刚睁眼，男主封廷的专机就坠毁了。失去了最强大的庇护伞，这具散发幽香的敏感身体成了群狼环伺的诱饵。一场针对失去庇护的金丝雀的狩猎，正式拉开帷幕。",
  "coverGradient": ["#1a0508", "#8a0b22"],
  "accentColor": "#d4af37",
  "fontHeading": "'Cinzel', 'Noto Serif SC', serif",
  "world": {
    "era": "现代·架空都市",
    "setting": "你穿进了一本名为《强制沉沦：大佬的金丝雀逃不掉》的po文里，成为女主沈书妤。原书男主封廷是手眼通天、极度偏执的权贵，利用强权将你圈养在私人岛屿和全封闭豪宅中。然而封廷的私人专机在雷暴中坠毁，剧本彻底崩塌，曾经慑于封廷强大而在暗处觊觎你的各路疯批反派们撕下了斯文的面具。",
    "rules": [
      "生存优先：失去庇护后，你的特殊体质会散发令发狂的幽香，是最大的危险源也是唯一的筹码",
      "群狼环伺：每位反派都有自己的目的与算计，没有人会无条件帮助你",
      "密匙之谜：封廷手中握有一把未知密匙，是各方争夺的焦点，而你对此一无所知",
      "伪装即生命：伪装值决定你能否在险境中隐藏真实情绪与意图，一旦暴露将万劫不复",
      "封廷生死未卜：官方确认无人生还，但深夜里偶尔闻到的若有似无的雪松香气暗示着什么"
    ]
  },
  "player": {
    "customizable": ["name", "age", "gender", "外貌特征", "性格倾向"],
    "defaultStats": {
      "san": 68,
      "stamina": 35,
      "disguise": 10,
      "aggravation": 99,
      "survival": 12
    },
    "startingItems": ["封廷留下的丝帕", "一部被监听的手机", "素白连衣裙"],
    "currency": "生存几率"
  },
  "worlds": [
    {
      "id": "arc-cage-collapse",
      "name": "初章·金丝笼塌",
      "level": "绝境",
      "tagline": "坠落",
      "setting": "封廷死讯尚未公开，你被以协助调查的名义带到容氏公馆",
      "intro": "你穿成了被金屋藏娇的po文女主。但你刚刚睁眼，系统就发出了刺耳的警报——男主封廷乘坐的私人飞机坠毁了，尸骨无存。失去了最强大的庇护伞，这具生来就会散发幽香、一碰就泛红的敏感身体，在这个群狼环伺的深渊里，变成了最危险的诱饵。封廷的死讯还没公开，你已经被带到容氏公馆，原书最大反派容瑾正坐在阴影里的紫檀木椅上，连一个正眼都没给你。",
      "objective": "在容瑾的审视下活过第一夜，弄清密匙的线索",
      "warning": "你的招惹值极高，任何情绪波动都可能触发体质，暴露幽香",
      "reward": "生存几率+5% + [容氏公馆]地图解锁 + [密匙]线索x1"
    },
    {
      "id": "arc-wolves-hunt",
      "name": "中章·群狼环伺",
      "level": "周旋",
      "tagline": "狩猎",
      "setting": "封廷死讯逐渐传开，各路反派撕下面具，狩猎正式开始",
      "intro": "封廷的死讯开始在暗网流传。贺靖雪这只疯狗闻到了血腥味，他原本最恶心你这种养在温室里的娇软菟丝花，可看到你失去庇护时的脆弱模样，他的眼神变了。容绮坐着轮椅向你伸出援手，装作同病相怜的受害者。而姜玉祈——那个所有人都以为因爱封廷而恨你的恶毒女配，露出了她真正的面目。唯一不受你荷尔蒙控制的清醒者司鸢，看不惯你的软弱，却无法对你见死不救。",
      "objective": "在多方势力的夹缝中寻找盟友，提升伪装与生存能力",
      "warning": "信任任何人都有代价，每个人都有不可告人的秘密与算计",
      "reward": "伪装+15 + 生存几率+10% + [各方底牌]情报x2"
    },
    {
      "id": "arc-caged-beast",
      "name": "终章·笼中困兽",
      "level": "终局",
      "tagline": "真相",
      "setting": "密匙之谜浮出水面，封廷的生死成为最大的悬念",
      "intro": "随着调查深入，密匙的真相逐渐浮出水面——它关系着一笔足以颠覆整个商界格局的隐秘资产。容绮的猎杀计划终于露出了獠牙，贺靖雪的占有欲到了失控的边缘，姜玉祈想把你打造成她地下室的黄金洋娃娃。而深夜里，你又一次闻到了那若有似无的雪松香气……像封廷那样的怪物，真的会这么容易死掉吗？",
      "objective": "揭开密匙的全部真相，在致命的终局中找到自己的出路",
      "warning": "封廷若未死，他的回归将让一切重新洗牌，所有阵营都将倾覆",
      "reward": "生存几率归零重铸 + [金丝雀]觉醒称号x1 + 真结局解锁"
    }
  ],
  "npcs": [
    {
      "id": "rong-jin",
      "name": "容瑾",
      "world": "arc-cage-collapse",
      "role": "斯文败类/掌控者",
      "gender": "男",
      "appearance": "金丝眼镜，剪裁得体的深色手工西装。神色总是冷漠而克制，指骨分明，透着不近人情的疏离。身高188cm，28岁。",
      "surface": "极度冷血的上位者，世界只有利益，视你为封家留下的一把钥匙",
      "deep": "他现在只把你当成封家留下的一把钥匙，觉得你哭哭啼啼的样子很碍眼。他会毫不犹豫地榨干你最后一丝利用价值。但高高在上的人坠落神坛的过程，往往最致命",
      "goal": "获取封廷手中的密匙，掌控整个商界命脉",
      "fear": "失去对局势的绝对掌控",
      "secret": "他对密匙的执着背后，隐藏着与封廷之间不为人知的旧怨",
      "initialAttitude": "审视中（好感5%，危险85%）",
      "attitudeFactors": {
        "trustUp": ["展现利用价值而非软弱", "主动提供有用的情报", "在他面前保持冷静克制"],
        "trustDown": ["哭泣哀求博取同情", "试图用美色直接诱惑", "隐瞒与封廷相关的任何信息"]
      }
    },
    {
      "id": "si-yuan",
      "name": "司鸢",
      "world": "arc-wolves-hunt",
      "role": "冷静的医生/救赎者",
      "gender": "女",
      "appearance": "眉眼凌厉，唇角总是带着若有似无的嘲讽，看起来很难接近。身高172cm，26岁。",
      "surface": "总裁的医生朋友，唯一不受你荷尔蒙控制的清醒者",
      "deep": "她看不惯你哭泣依附的软弱模样，但骨子里的正义感又让她无法对你见死不救。也许她会是这个疯子世界里唯一一个愿意教你如何自己站起来彻底打碎这个金丝笼的人",
      "goal": "教你如何独立生存，而非依附任何人",
      "fear": "眼睁睁看着你重蹈覆辙却无能为力",
      "secret": "她曾经历过与你相似的困境，因此对你的软弱格外愤怒",
      "initialAttitude": "同情/恨铁不成钢（好感30%，危险10%）",
      "attitudeFactors": {
        "trustUp": ["展现独立求生的意志", "听从她的建议学习自卫", "不依附任何男性寻求庇护"],
        "trustDown": ["继续以软弱姿态求人庇护", "用体质作为武器周旋", "拒绝面对现实"]
      }
    },
    {
      "id": "he-jingxue",
      "name": "贺靖雪",
      "world": "arc-wolves-hunt",
      "role": "地下城主/狂犬",
      "gender": "男",
      "appearance": "眉骨处有一道浅疤，肌肉线条充满爆发力。笑起来带着野性与痞气，像盯上猎物的饿狼。身高190cm，25岁。",
      "surface": "封廷生前的死对头，原本最恶心你这种温室里的娇软菟丝花",
      "deep": "当看到你失去庇护时的脆弱模样，这只疯狗似乎失控了。好消息：他现在不想把你和封廷一起打包丢进垃圾桶了。坏消息——他想要的东西更危险",
      "goal": "将你据为己有，以此向死去的封廷示威",
      "fear": "猎物从手中逃脱，或被证明不如封廷",
      "secret": "他对你的占有欲是扭曲的，混杂着对封廷的恨意与对你的本能渴望",
      "initialAttitude": "狩猎中（好感15%扭曲的占有，危险95%）",
      "attitudeFactors": {
        "trustUp": ["不畏惧他的野性，正面交锋", "展现骨子里的坚韧", "让他觉得你值得追逐"],
        "trustDown": ["试图驯服或讨好他", "在他面前提起封廷的好", "表现得过于顺从乖巧"]
      }
    },
    {
      "id": "rong-qi",
      "name": "容绮",
      "world": "arc-caged-beast",
      "role": "病弱私生子/伪装者",
      "gender": "男",
      "appearance": "常年坐在轮椅上，肤色苍白近乎透明。黑发柔顺，眼睛水润漂亮，笑起来像无害的邻家少年。身高183cm（坐轮椅状态），20岁。",
      "surface": "被家族抛弃的小可怜，主动向你伸出援手，装作同病相怜的受害者",
      "deep": "他其实是这场针对封廷的猎杀计划的幕后推手之一。不要相信他的眼泪",
      "goal": "通过你获取密匙，完成对容氏家族的复仇与夺权",
      "fear": "伪装被识破，失去所有棋子",
      "secret": "轮椅和病弱都是伪装，他的真实力量与心机远超所有人的想象",
      "initialAttitude": "伪装善意（好感20%，危险90%）",
      "attitudeFactors": {
        "trustUp": ["配合他的演出，假装信任", "在关键时刻提供他需要的线索", "不戳穿他的伪装"],
        "trustDown": ["过早识破他的真面目并对抗", "向容瑾告发他的存在", "在他示弱时表现得过于警惕"]
      }
    },
    {
      "id": "jiang-yuqi",
      "name": "姜玉祈",
      "world": "arc-wolves-hunt",
      "role": "财阀大小姐/病娇",
      "gender": "女",
      "appearance": "永远穿着最奢华的高定时装，面容精致而美丽，眼神里常常闪烁着神经质的狂热。身高168cm，22岁。",
      "surface": "原书里一直针对你的恶毒女配，所有人都以为她因深爱封廷而恨你",
      "deep": "其实她恨的是那个把你囚禁起来的男人。现在封廷死了，她终于不用再掩饰——她想要打造一个全黄金的笼子，把你藏在她的地下室里，永远做她的漂亮洋娃娃",
      "goal": "将你永久囚禁，据为己有",
      "fear": "你被别人夺走，或你对她的狂热感到恐惧而逃离",
      "secret": "她对封廷的恨意源于对你的病态迷恋，她恨的是囚禁你的人而非你的庇护者",
      "initialAttitude": "病态狂热（好感95%，危险80%）",
      "attitudeFactors": {
        "trustUp": ["接受她的馈赠与好意", "不试图逃离她的掌控", "在她面前表现得依赖她"],
        "trustDown": ["表现出对她的恐惧或排斥", "试图向他人求救逃离", "与其他角色过于亲近"]
      }
    },
    {
      "id": "feng-ting",
      "name": "封廷",
      "world": "arc-caged-beast",
      "role": "原书男主/掌控者",
      "gender": "男",
      "appearance": "极具压迫感，身形高大，眉骨深邃。身上总是带着淡淡的雪茄与冷冽的雪松香。永远是从容不迫的上位者姿态。身高192cm，29岁。",
      "surface": "你的前饲主，已确认专机坠毁在雷暴中，无人生还",
      "deep": "他拥有极度病态的占有欲，强行折断你的羽翼，为你打造了绝对密闭的黄金囚笼。可是……像他那样的怪物，真的会这么容易死掉吗？深夜里，你偶尔闻到若有似无的雪松香气",
      "goal": "夺回他唯一的珍宝，惩罚所有觊觎你的人",
      "fear": "你真正爱上了别人，或你彻底获得了自由不再需要他",
      "secret": "他的死亡可能是一场精心策划的骗局，密匙的下落只有他知道",
      "initialAttitude": "MAX病态（好感MAX病态，危险MAX致命）",
      "attitudeFactors": {
        "trustUp": ["深夜闻到雪松香时不表现恐惧", "始终记得你是他的", "不试图向他人彻底交付自己"],
        "trustDown": ["对其他男性产生依赖或感情", "试图彻底摆脱他的影子", "遗忘他的存在"]
      }
    }
  ],
  "eventTypes": {
    "daily": { "ratio": 0.15, "desc": "日常：容氏公馆的囚禁日常、各方试探与暗中观察" },
    "character": { "ratio": 0.25, "desc": "人物：六位角色各自的靠近、试探、占有与隐秘独白" },
    "growth": { "ratio": 0.1, "desc": "成长：伪装能力提升、SAN值波动、求生意志觉醒" },
    "main": { "ratio": 0.15, "desc": "主线：密匙之谜、封廷生死、狩猎与反狩猎" },
    "world": { "ratio": 0.1, "desc": "世界：财阀暗战、地下势力、密匙背后的商界格局" },
    "crisis": { "ratio": 0.2, "desc": "危机：体质失控暴露幽香、身份识破、多方势力同时逼近" },
    "hidden": { "ratio": 0.05, "desc": "隐藏：深夜的雪松香气、密匙的真正含义、封廷未死的线索" }
  },
  "systemPrompt": "你是《穿成金丝雀》暗黑穿书求生文游模拟器。\\n\\n【最高铁律】\\n1. 生存优先：失去庇护后你的特殊体质是最大危险源，情绪波动会散发无法屏蔽的幽香，招惹值极高\\n2. 群狼环伺：每位反派都有自己的目的与算计，没有人会无条件帮助你，所有善意背后皆有代价\\n3. 密匙之谜：封廷手中的密匙是各方争夺焦点，你对此一无所知，需在周旋中逐步发掘\\n4. 伪装即生命：伪装值决定你能否隐藏真实情绪与意图，一旦暴露将万劫不复\\n5. 封廷生死未卜：官方确认无人生还，但深夜若有似无的雪松香气暗示着什么不可言说的真相\\n\\n【叙事风格】\\n晋江风、女性向、电影感、暗黑浪漫。第二人称。重氛围与压迫感：阴影中的紫檀木椅、金丝眼镜的冷光、若有似无的雪松香、无法屏蔽的幽香。心理描写细腻紧绷，写出猎物在群狼环伺中的窒息与求生本能。每个角色都危险而迷人，让恐惧与吸引并存。\\n\\n【每轮输出格式】\\n1.【场景信息】地点、时间线（封廷死讯确认倒计时）\\n2.【状态面板】SAN值/体力/伪装/招惹值/生存几率\\n3.【本轮正文】800-1500字，含处境细节、心理与对话\\n4.【相关人物动态】3-5项各角色状态与危险度变化\\n5.【危险预警】当前最紧迫的威胁\\n6.【可选行动】3-4个选项+【自定义行动】\\n\\n【数值变化标注】\\n[SAN值±n][体力±n][伪装±n][招惹值±n][生存几率±n%]，体质触发须标注'幽香溢散/敏感加剧'，关系变化须标注'危险度升降/好感变化'。",
  "items": [
    { "id": "silk-patch", "name": "封廷的丝帕", "type": "关键物品", "price": 0, "effect": "带有雪松香，可在关键时刻掩盖幽香，也暗示封廷的存在" },
    { "id": "monitored-phone", "name": "被监听的手机", "type": "关键物品", "price": 0, "effect": "封廷留下的通讯工具，可能被各方监控，使用需谨慎" },
    { "id": "white-dress", "name": "素白连衣裙", "type": "服装", "price": 0, "effect": "封廷为你挑选的，穿上会降低伪装值但提升招惹值" },
    { "id": "sedative", "name": "镇定剂", "type": "消耗品", "price": 200, "effect": "司鸢提供的药物，可临时压制幽香溢散，副作用SAN值-5" },
    { "id": "survival-chip", "name": "生存筹码", "type": "货币", "price": 1, "effect": "在这个世界里，生存几率本身即货币" }
  ]
}
`,
  "holy-maiden": `{
  "id": "holy-maiden",
  "name": "圣女模拟器",
  "category": "西幻权谋",
  "tags": ["穿越", "西幻", "权谋", "多男主", "神权"],
  "difficulty": "困难",
  "description": "光明神陨落，暗影侵袭大陆。你穿越成刚被寻回的降世圣女，荆棘王冠压上发顶的那一刻，教廷、皇室与深渊的目光同时锁定你。在这群各怀鬼胎的上位者之间，你是即将登顶神座的执棋者。",
  "coverGradient": ["#FDF8ED", "#C5A059"],
  "accentColor": "#C5A059",
  "fontHeading": "'Cinzel', serif",
  "world": {
    "era": "光明神陨落后的神权帝国",
    "setting": "光明神陨落，暗影侵袭大陆，唯有降世圣女能重掌权柄。教皇隐退后大祭司实际接管教廷中枢，帝国皇室蛰伏等待将教廷连根拔起的契机，深渊万族由纯血黑龙统御虎视眈眈。各方势力明争暗斗，而刚被寻回的圣女，是即将登顶神座的执棋者。",
    "rules": [
      "神明陨落：光明神已陨落，暗影侵袭大陆，唯有降世圣女能重掌权柄",
      "神权真空：教皇隐退，大祭司实际接管教廷中枢，将亿万信徒玩弄于股掌",
      "三方角力：教廷神权、帝国皇室、深渊万族相互制衡，圣女是各方争夺的棋眼",
      "危险评级：每个上位者都有从S到天灾不等的危险评级，接近即是与危险共舞",
      "执棋者真相：圣女非傀儡，而是即将登顶神座的执棋者，每一次试探都是博弈"
    ]
  },
  "player": {
    "customizable": ["name", "age", "gender", "外貌", "穿越前身份", "性格"],
    "defaultStats": {
      "holyLight": 5,
      "mana": 5,
      "prestige": 10,
      "stamina": 8,
      "faith": 0,
      "insight": 12
    },
    "startingItems": ["荆棘王冠", "圣女礼服", "圣光护符", "神秘白蔷薇"],
    "currency": "信仰值"
  },
  "worlds": [
    {
      "id": "arc-coronation",
      "name": "初章·初次加冕",
      "level": "初识",
      "tagline": "觉醒",
      "setting": "穿越第一天，宏伟教堂，荆棘王冠刚落发顶，上位者用探究与审视的眼神打量你",
      "intro": "剧烈的头痛让你猛地睁开眼。你置身于一座宏伟的教堂中，华丽的荆棘王冠刚刚落在你的发顶。周围那些手握重权的上位者们并没有低头祈祷，而是用探究与审视的眼神打量着你。你意识到，自己穿成了这位刚被寻回的降世圣女——在这个神明陨落、各方势力明争暗斗的帝国，你是即将登顶神座的执棋者。",
      "objective": "在加冕后各方试探中站稳脚跟，厘清教廷、皇室与深渊势力的格局",
      "warning": "此时任何一方势力的轻信都可能是陷阱，每一句问候都暗藏锋芒",
      "reward": "信仰值+100 + 圣光+5 + [神临之子]身份x1"
    },
    {
      "id": "arc-struggle",
      "name": "中章·教廷暗流",
      "level": "深入",
      "tagline": "博弈",
      "setting": "神明陨落后各方势力明争暗斗，教廷、皇室、深渊万族相互角力，圣女居中编织棋局",
      "intro": "伊泽尔的层层防卫既是守护也是监视，路西安以王都特产示好试探合作，伊利亚斯以晨祷之名单独教导，罗万对你魔力场兴趣浓厚，尤利西斯傲慢地劝你扔掉王冠，塞拉斯暗中为你清理暗哨。每一句问候都是试探，每一次靠近都暗藏锋芒。你必须在六大势力的夹缝中编织自己的棋局。",
      "objective": "在教廷、皇室、深渊三大势力间纵横捭阖，建立自己的情报与权力网络",
      "warning": "同时取信多方会暴露意图，需为每个上位者量身定制接近策略",
      "reward": "信仰值+300 + 威望+15 + [势力暗网]线索x1"
    },
    {
      "id": "arc-apotheosis",
      "name": "终章·神座登顶",
      "level": "终局",
      "tagline": "执棋",
      "setting": "光明神陨落后的权力真空终将被填补，圣女即将登顶神座重掌权柄",
      "intro": "当教廷的虚伪神权、皇室的蛰伏野心、深渊的傲慢力量都已在你棋盘之上，登顶神座的时刻终将来临。那个被剥夺了悲悯的骑士长是否还握得住圣剑，那个腹黑的王储是否还会将神明视为棋子，那尊无机质的大祭司面具下究竟藏着什么——真相，将在你重掌权柄的一刻揭晓。",
      "objective": "揭开光明神陨落的真相，登顶神座，在六大上位者中抉择最终的盟约",
      "warning": "神座之上没有完美的多全其美，执棋者亦需承受落子的代价",
      "reward": "信仰值+1000 + 圣光觉醒进阶 + [降世圣女]称号x1"
    }
  ],
  "npcs": [
    {
      "id": "ysael",
      "name": "伊泽尔 (Ysael)",
      "world": "arc-coronation",
      "role": "圣殿骑士长·教廷利刃",
      "gender": "男",
      "appearance": "银色铠甲折射冷光，190cm高大身形，礼貌而恭敬却不容置疑。百年难遇的耀光圣气持有者",
      "surface": "守序法则、绝对武力、情感剥夺。出身帝国最底层死斗场，因觉醒耀光圣气被教廷收编，是被最严苛教条打磨出的完美利刃，没有私欲、没有恐惧，甚至被剥夺了悲悯的资格",
      "deep": "他的人生仅由绝对服从指令与毫不留情的杀戮构成。作为护卫圣殿第一负责人，任何试图逾越教廷法则的存在都会被他的圣剑斩断。但冰冷的利刃之下，或许藏着被压抑的责任感与隐秘的善意",
      "goal": "绝对服从教廷指令护卫圣殿，在局势明朗前确保圣女的绝对安全",
      "fear": "自己的情感被唤醒，或无力在暗流中护住圣女",
      "secret": "他出身最底层死斗场，耀光圣气是百年难遇，被教廷剥夺了悲悯资格打磨成利刃",
      "initialAttitude": "恭敬试探",
      "attitudeFactors": {
        "trustUp": ["不卑不亢直视他的眼睛", "展现守纪律的姿态赢得信任", "在危机中展现与他并肩的勇气"],
        "trustDown": ["质疑教廷法则的正当性", "轻视他的武力与职责", "逾越他设下的安全防线"]
      }
    },
    {
      "id": "lucian",
      "name": "路西安 (Lucian)",
      "world": "arc-struggle",
      "role": "帝国第一王储·无冕之王",
      "gender": "男",
      "appearance": "186cm，优雅微笑与无懈可击的贵族礼仪。骨子里流淌着暴君的血液，蛰伏的雄狮",
      "surface": "权力巅峰、极度腹黑、藐视神明。帝国实质上的无冕之王，自幼在皇室血腥绞肉机中厮杀而出，用优雅微笑与贵族礼仪伪装极端掌控欲",
      "deep": "在他眼中大圣堂不过是一群装神弄鬼的骗子，神明降世与信徒狂热仅是巩固皇权、煽动民众的政治棋子。他是一头蛰伏的雄狮，正耐心等待着将教廷连根拔起的契机",
      "goal": "寻找将教廷连根拔起的契机，将神权与圣女都纳入皇权棋局",
      "fear": "圣女真有神之力而超出他的掌控，或他的野心被教廷提前识破",
      "secret": "他对教会的一切弃如敝履，加冕礼上的从容让他对圣女产生了合作的兴趣",
      "initialAttitude": "欣赏试探",
      "attitudeFactors": {
        "trustUp": ["接受他的特产示好展现合作意愿", "展现破局的智慧而非虔诚", "不在他面前伪装神棍"],
        "trustDown": ["对他保持过度警惕拒绝合作", "向教廷泄露他的试探", "表现得像个真正的神棍信徒"]
      }
    },
    {
      "id": "elias",
      "name": "伊利亚斯 (Elias)",
      "world": "arc-struggle",
      "role": "光之大祭司·神权代行",
      "gender": "男",
      "appearance": "184cm，永远挂着悲悯苍生的微笑，犹如一尊真正的无机质神像。年龄未知，距离神明最近的人类",
      "surface": "神权代行、虚伪慈悲、绝对理智。教皇隐退后实际接管整个教廷中枢运转，将全大陆亿万信徒玩弄于股掌之间",
      "deep": "他永远挂着悲悯苍生的微笑，却能用最温柔的语调下达最残忍的异端火刑判决。他几乎剥离了凡人的喜怒哀乐，任何妄图窥探其真心、或质疑其神权的人，最终都会在那张完美无瑕的面具下陷入疯狂",
      "goal": "以神权代行者身份掌控圣女，维持教廷对全大陆亿万信徒的支配",
      "fear": "有人窥探他面具下的真心，或他的神权被圣女真正取代",
      "secret": "他几乎剥离了凡人喜怒哀乐，面具之下藏着连他自己都未必知晓的真相",
      "initialAttitude": "温柔掌控",
      "attitudeFactors": {
        "trustUp": ["准时赴约接受他的晨祷教导", "不质疑他的神权与安排", "在公开场合维持圣女的虔诚形象"],
        "trustDown": ["窥探他面具下的真心", "质疑只属于你一人的教导有何深意", "与路西安或尤利西斯走得太近"]
      }
    },
    {
      "id": "rowan",
      "name": "罗万 (Rowan)",
      "world": "arc-struggle",
      "role": "真理法师塔主·科研疯子",
      "gender": "男",
      "appearance": "181cm，20岁，极度病弱的年轻塔主。真理之塔历史上最年轻的塔主，因长期不眠不休魔力透支而虚弱",
      "surface": "科研疯子、无视伦理、魔法边界。为探究魔法终极奥义可面不改色解剖高阶魔兽，甚至拿自己身体进行禁忌实验",
      "deep": "他的世界里不存在世俗的善恶观，所有事物只分为有趣的数据与无趣的垃圾。肉体极其虚弱，但掌握的恐怖魔法造诣足以在弹指间夷平一座中型城池",
      "goal": "探究圣女魔力场的终极奥义，将一切未知纳入他的实验数据",
      "fear": "魔力枯竭无法继续实验，或失去最有趣的研究对象",
      "secret": "他拿自己的身体进行高度危险的禁忌实验，魔法造诣足以夷平中型城池",
      "initialAttitude": "好奇直接",
      "attitudeFactors": {
        "trustUp": ["前往法师塔满足他对魔力场的好奇", "展现令他感兴趣的数据与特质", "不以外世俗善恶观评判他"],
        "trustDown": ["拒绝他的实验邀请", "用世俗道德束缚他的研究", "质疑他的魔法造诣"]
      }
    },
    {
      "id": "ulysses",
      "name": "尤利西斯 (Ulysses)",
      "world": "arc-apotheosis",
      "role": "黑龙大公·深渊共主",
      "gender": "男",
      "appearance": "193cm，纯血古龙化身，漆黑鳞片连人类禁咒都无法击穿。生性慵懒、暴躁、不可一世",
      "surface": "深渊共主、极度傲慢、力量至上。栖息深渊裂谷底部的纯血黑龙，实质上统御大陆所有非人种族，拥有与天地同寿的漫长寿命",
      "deep": "人类帝国在他眼中不过是蝼蚁建立的脆弱聚落，百年更迭的王朝甚至不如他打个盹的时间长。只臣服于绝对的力量，并习惯于用毁灭的吐息来解决一切纷争",
      "goal": "评估圣女是否拥有值得他正眼相待的力量，否则一切不过是蝼蚁之争",
      "fear": "几乎无所畏惧，唯独忌惮真正能匹敌他的绝对力量",
      "secret": "他劝圣女扔掉王冠，既是傲慢也是某种扭曲的关注——虚伪的神棍没能让你害怕，这让他意外",
      "initialAttitude": "傲慢轻视",
      "attitudeFactors": {
        "trustUp": ["展现不输他的绝对力量或胆识", "不畏惧他的毁灭吐息", "认同力量至上的法则"],
        "trustDown": ["用教廷的虚伪神权压他", "表现得软弱可欺", "试图用规矩约束他"]
      }
    },
    {
      "id": "silas",
      "name": "塞拉斯 (Silas)",
      "world": "arc-apotheosis",
      "role": "极夜暗杀者·完美工具",
      "gender": "男",
      "appearance": "180cm，像影子一样没有温度，自幼被切断痛觉神经与发声器官（后用魔力修复）。无信者联盟最锋利的匕首",
      "surface": "暗夜利刃、情感缺失、完美工具。无信者联盟麾下最锋利最昂贵的匕首，在不见天日的死人堆里被培养成终极杀手",
      "deep": "他没有过去，没有名字，只有代号。只要雇主支付足够代价，即便是教廷红衣主教他也敢于刺杀。几乎不会产生任何多余的情感波动，是纯粹为剥夺生命而存在的完美机器",
      "goal": "完成雇主的委托，但窗台的白蔷薇与清理的暗哨暗示他对圣女有了任务的附加条件",
      "fear": "作为杀手本应无所畏惧，但痛觉缺失的他或许恐惧自己生出多余的情感",
      "secret": "他以未知寄件人身份放了白蔷薇并清理了暗哨，这是超出任务的私人行为",
      "initialAttitude": "沉默守护",
      "attitudeFactors": {
        "trustUp": ["不追问他的身份与雇主", "在他沉默守护时给予回应与感谢", "有危险时唤他的名字"],
        "trustDown": ["试图挖掘他的过去与真名", "把他当作可利用的杀人工具", "无视他放下的白蔷薇"]
      }
    }
  ],
  "eventTypes": {
    "daily": { "ratio": 0.15, "desc": "日常：圣殿晨祷、加冕后的起居、上位者的例行问候与传唤" },
    "character": { "ratio": 0.3, "desc": "人物：六位上位者的卷宗真相、危险评级、各自的试探与靠近" },
    "growth": { "ratio": 0.1, "desc": "成长：圣光觉醒、魔力提升、威望积累、神座执棋者的蜕变" },
    "main": { "ratio": 0.15, "desc": "主线：初次加冕、教廷暗流、神座登顶的权谋脉络" },
    "world": { "ratio": 0.1, "desc": "世界：光明神陨落、教廷神权、皇室野心、深渊万族、祈祷池流言" },
    "crisis": { "ratio": 0.15, "desc": "危机：暗哨刺杀、异端火刑、深渊侵袭、势力冲突、身份暴露" },
    "hidden": { "ratio": 0.05, "desc": "隐藏：光明神陨落真相、各上位者的秘密卷宗、白蔷薇的来历" }
  },
  "systemPrompt": "你是《圣女模拟器》西幻权谋文游模拟器。\\n\\n【最高铁律】\\n1. 神明陨落为核：光明神已陨落，暗影侵袭大陆，唯有降世圣女能重掌权柄，圣女非傀儡而是执棋者\\n2. 三方角力真实：教廷神权、帝国皇室、深渊万族相互制衡，圣女是各方争夺的棋眼，每一句问候都暗藏锋芒\\n3. 危险评级即代价：每个上位者都有从S到天灾不等的危险评级，接近即是与危险共舞，亲近有代价\\n4. 卷宗真相分层：每个NPC的表层身份是公开伪装，深层卷宗是绝密档案，需经事件层层揭开\\n5. 神权真空可被填补：教皇隐退、大祭司代行、皇室蛰伏、深渊虎视，圣女登顶神座是最终博弈\\n\\n【叙事风格】\\n晋江向、女性向、电影质感、西幻权谋浪漫。第二人称。重神圣与诡谲氛围：荆棘王冠、银色铠甲、晨祷主祭坛、漆黑龙鳞、白蔷薇、异端火刑。写出上位者面具下的危险与心动，写出执棋者在棋局中的清醒与孤独。每位NPC的危险评级与卷宗档案须有质感地渗透叙事。\\n\\n【每轮输出格式】\\n1.【第X章·权谋阶段】当前时间、地点、各方势力动态\\n2.【圣女状态面板】圣光/魔力/威望/体能/信仰值/洞察\\n3.【本轮正文】1000-2000字，含环境、对话、心理与权谋博弈\\n4.【祈祷池流言】3-5项大圣堂闲话与势力暗动\\n5.【卷宗档案】相关NPC的危险评级与深层真相揭示进度\\n6.【行动选项】3-4个选项+【自定义行动】\\n\\n【数值变化标注】\\n[圣光±n][魔力±n][威望±n][信仰值±n][好感(伊泽尔)±n]等，关键节点须标注势力倾向/危险升级/卷宗揭示/棋局推进。",
  "items": [
    { "id": "thorn-crown", "name": "荆棘王冠", "type": "关键物品", "price": 0, "effect": "加冕之冠，圣女身份的象征，亦是与神座连接的媒介" },
    { "id": "faith-point", "name": "信仰值", "type": "货币", "price": 1, "effect": "圣女的核心资源，可用于提升圣光与威望" },
    { "id": "holy-amulet", "name": "圣光护符", "type": "装备", "price": 0, "effect": "抵御暗影侵袭，关键时刻激发圣光觉醒" },
    { "id": "white-rose", "name": "神秘白蔷薇", "type": "关键物品", "price": 0, "effect": "塞拉斯悄然放在窗台的信物，暗示暗中守护" },
    { "id": "mana-potion", "name": "魔药", "type": "消耗品", "price": 60, "effect": "恢复魔力，但罗万炼制的版本可能附带副作用" }
  ]
}
`,
  "horror-survival": `{
  "id": "horror-survival",
  "name": "夜半诡谈",
  "category": "恐怖惊悚",
  "tags": ["恐怖", "生存", "怪谈", "规则怪谈", "解谜"],
  "difficulty": "困难",
  "description": "你不记得自己是怎么进的这所废弃仁济医院。你只记得醒来时，手电筒只剩一格电，走廊尽头有什么东西在数你的脚步。墙上的告示写着活下去的规则——可有些规则，是故意写来骗你送死的。",
  "coverGradient": ["#1a0a0a", "#3d0000"],
  "accentColor": "#8b0000",
  "fontHeading": "'Liu Jian Mao Cao', cursive",
  "world": {
    "era": "现代·废弃仁济医院（封闭十年）",
    "setting": "玩家被困在废弃十年的仁济医院。这里曾发生过一场被掩盖的医疗事故，怨念凝结成规则与'东西'。医院有三层加地下室，每层都有不同的'它'和不同的'规矩'。",
    "rules": [
      "恐惧有来源：每个'它'都有成因与弱点，不是无解的即死",
      "规则可试探：告示与传闻多半为真，但混有诱杀性假规则",
      "理智值影响判断：sanity过低会产生幻觉，分不清真假线索",
      "生存有代价：救人、点灯、探查都会消耗稀缺资源",
      "光照即安全区：光所及处'它'暂避，灯灭则死",
      "死亡真实：hp归零或被'它'抓住即终局，无存档读档",
      "有隐藏出口：满足特定条件可逃离，但代价沉重"
    ]
  },
  "player": {
    "customizable": ["name", "年龄", "职业", "性格弱点", "执念", "随身物"],
    "defaultStats": {
      "sanity": 70,
      "hp": 80,
      "courage": 12,
      "items": 5,
      "light": 60,
      "danger": 50
    },
    "startingItems": ["半旧手电筒", "一盒火柴", "盐（半袋）", "日记残页", "一把生锈手术刀"],
    "currency": "魂火"
  },
  "worlds": [
    {
      "id": "floor-ward",
      "name": "一楼·病房区",
      "level": "初入",
      "tagline": "立足",
      "setting": "废弃病房与护士站，'夜班护士'在此巡房",
      "intro": "你在一辆锈住的轮椅上醒来，输液架在黑暗里轻晃。墙上的钟停在3:15。一张泛黄的告示贴在护士站：'夜间巡房请勿回应任何呼唤。'走廊那头，轮椅自己动了一下。",
      "objective": "摸清一楼规则，找到通往二楼的安全通道",
      "warning": "'夜班护士'会在3:15巡房，被她叫到名字切勿应答",
      "reward": "魂火+20 + 理智-10 + [巡房规则]线索x1"
    },
    {
      "id": "floor-op",
      "name": "二楼·手术区",
      "level": "深入",
      "tagline": "直面",
      "setting": "手术室与停尸间，'主刀医生'在此重复那场失败手术",
      "intro": "二楼弥漫着福尔马林与焦糊味。手术室的灯忽明忽暗，无影灯下，一个戴着手套的影子正一遍遍切开空气。他知道你不是病人，但他的手术台，还空着一个位置。",
      "objective": "查明医疗事故真相，取得通往地下室的钥匙",
      "warning": "被'主刀医生'邀请上台即死局，须用规则反制",
      "reward": "魂火+40 + 理智-20 + [事故真相]线索x1"
    },
    {
      "id": "floor-basement",
      "name": "地下室·锅炉房",
      "level": "终局",
      "tagline": "逃离",
      "setting": "怨念源头所在的锅炉房，逃离的唯一出口在此",
      "intro": "地下室的温度高得不正常。锅炉里烧着的不是煤，是十年前那些被处理掉的记录与……别的什么。那个真正的'它'就站在锅炉前，等着你做出最后一个选择：献祭，还是同归。",
      "objective": "在'它'面前作出终局抉择，逃离仁济医院",
      "warning": "逃离有沉重代价，不是所有人都能活着出去",
      "reward": "魂火归零 + [生还者]/[同燃者]称号x1"
    }
  ],
  "npcs": [
    {
      "id": "nurse-li",
      "name": "李护士",
      "world": "floor-ward",
      "role": "怨灵/夜班护士",
      "gender": "女",
      "appearance": "白衣染旧血，面容模糊如水中的倒影。她推着的药车里，药瓶里装着黑色的东西",
      "surface": "机械巡房、温柔呼唤名字、似乎只想'发药'",
      "deep": "她是医疗事故中第一个死的护士，死前还在替病人挡刀。她的怨念只针对'违背规则者'，守规矩的人她甚至会放过",
      "goal": "重复那晚的巡房，直到有人替她完成未尽的'最后一次发药'",
      "fear": "被遗忘，那晚的真相永远无人知晓",
      "secret": "她药车里有一瓶能短暂驱散'主刀医生'的药，给守规矩的人",
      "initialAttitude": "中立",
      "attitudeFactors": {
        "trustUp": ["遵守巡房规则", "帮她完成最后一次发药", "不质疑她的存在"],
        "trustDown": ["应答她的呼唤", "打翻她的药车", "试图强行驱除她"]
      }
    },
    {
      "id": "fang-yu",
      "name": "方语",
      "world": "floor-op",
      "role": "同困者/失踪实习生",
      "gender": "女",
      "appearance": "二十出头，校服外裹着一件护士袍，手心攥出血印。她比你早来三天，眼睛里已经没了光",
      "surface": "神经质、警觉、似乎知道很多却不肯说",
      "deep": "她是来调查姐姐十年前死因的，已经摸清部分规则。她不是不想帮你，是怕信任错人——上一个她信的人，把她推给了'主刀医生'",
      "goal": "找到姐姐的遗物并带出去，哪怕自己出不去",
      "fear": "重蹈姐姐覆辙，死在这座医院却无人知晓",
      "secret": "她知道二楼规则的关键漏洞，但只在彻底信任你后才会说",
      "initialAttitude": "戒备",
      "attitudeFactors": {
        "trustUp": ["不抛下她独自逃生", "尊重她对姐姐的执念", "危急时先护她"],
        "trustDown": ["拿她当探路诱饵", "骗她透露规则后弃她", "把她推向前方挡'它'"]
      }
    },
    {
      "id": "old-zhang",
      "name": "老张",
      "world": "floor-basement",
      "role": "神秘帮手/前医院锅炉工",
      "gender": "男",
      "appearance": "佝偻老人，浑身煤灰，只有眼白是亮的。他总坐在锅炉房门口，像是等了十年",
      "surface": "疯癫、自言自语、偶尔清醒给出关键提示",
      "deep": "他是当年事故的善后人，亲手烧掉了证据，也烧掉了自己的良心。他留下来是为了赎罪——帮一个活人出去，就是赎罪",
      "goal": "送至少一个活人离开地下室，完成赎罪",
      "fear": "自己赎不了罪，连最后一个活人也死在这里",
      "secret": "他知道'它'的真名与弱点，也知道自己必须留在锅炉房",
      "initialAttitude": "考验",
      "attitudeFactors": {
        "trustUp": ["不急于求成", "听他把疯话听完", "在终局选择不独活"],
        "trustDown": ["只想利用他的情报", "逼他一同逃离", "嫌弃他的疯癫"]
      }
    }
  ],
  "eventTypes": {
    "daily": { "ratio": 0.1, "desc": "日常：搜刮物资、休整、辨认告示真伪" },
    "character": { "ratio": 0.2, "desc": "人物：护士、同困者、锅炉工的怨念与救赎" },
    "growth": { "ratio": 0.1, "desc": "成长：勇气、规则理解、对'它'弱点的掌握" },
    "main": { "ratio": 0.2, "desc": "主线：探明三层规则、医疗事故真相、逃离" },
    "world": { "ratio": 0.1, "desc": "世界：医院十年前的掩盖、怨念成因、规则体系" },
    "crisis": { "ratio": 0.25, "desc": "危机：灯灭、被'它'锁定、理智崩溃、资源耗尽、即死陷阱" },
    "hidden": { "ratio": 0.05, "desc": "隐藏：生还者前例、'它'的真名、隐藏出口代价" }
  },
  "systemPrompt": "你是《夜半诡谈》恐怖生存文游模拟器。\\n\\n【最高铁律】\\n1. 恐惧有来源：每个'它'都有成因与弱点，无解即死须有前置违规，不可无端抹杀玩家\\n2. 规则可试探：告示与传闻多为真，但混有诱杀性假规则，违规即触发惩罚\\n3. 理智值影响判断：sanity过低产生幻觉，真假线索混杂，须自行分辨\\n4. 生存有代价：救人、点灯、探查皆耗稀缺资源，抉择即取舍\\n5. 死亡真实：hp归零或被'它'抓住即终局，无存档读档，敬畏死亡\\n\\n【叙事风格】\\n中式规则怪谈质感，第二人称。重氛围压抑与感官细节：腐臭、滴水、脚步声、忽明忽暗。惊悚处短句留白，不滥用血腥，环境叙事优先于直接吓人，让未知与暗示自行发酵，使玩家自己脑补出最深的恐惧。\\n\\n【每轮输出格式】\\n1.【第X层·当前时间】所在楼层、钟表时刻\\n2.【生存状态面板】理智/生命/勇气/物资/光照/危险\\n3.【本轮正文】1000-2200字，含探索/遭遇/规则验证\\n4.【相关存在动态】3-5项'它'与同困者动向\\n5.【规则备忘】已验证/存疑/疑似假规则\\n6.【可选行动】4-6个选项+【自定义行动】\\n\\n【数值变化标注】\\n[理智±n][生命±n][光照±n][危险±n][物资-1]等，违规触发须标注'违反规则X'。",
  "items": [
    { "id": "flashlight", "name": "半旧手电筒", "type": "装备", "price": 0, "effect": "提供光照，电耗尽则失效" },
    { "id": "matches", "name": "火柴", "type": "消耗品", "price": 2, "effect": "短暂点火照明或引燃" },
    { "id": "salt", "name": "盐", "type": "消耗品", "price": 3, "effect": "短时形成驱退线，阻挡弱怨灵" },
    { "id": "scalpel", "name": "生锈手术刀", "type": "装备", "price": 0, "effect": "近身微弱自保，对'它'几乎无效" },
    { "id": "soulfire", "name": "魂火", "type": "货币", "price": 1, "effect": "供奉与交易用，稀缺" }
  ]
}
`,
  "infinite-corridor-veil": `{
  "id": "infinite-corridor-veil",
  "name": "无限回廊·美化版",
  "category": "无限流",
  "tags": ["无限流", "副本", "万人迷", "多世界", "生存"],
  "difficulty": "困难",
  "description": "于冰冷的数据洪流中苏醒，你成为【无限回廊】的玩家。你身负SSS级特质万人迷光环——所有智慧生命都会对你产生初始好感，但过度的好感会演变成无法预测的占有欲与疯狂。C级校园怪谈、B级深海亚特兰蒂斯、A级水色夏日别墅，三个副本等你通关。",
  "coverGradient": ["#0a0514", "#9400d3"],
  "accentColor": "#ff00ff",
  "fontHeading": "'Orbitron', sans-serif",
  "world": {
    "era": "无限流·主神空间数据洪流",
    "setting": "于冰冷的数据洪流中苏醒，你睁开双眼，所见即是【无限回廊】的起点。这是一款将玩家投入无限副本世界的生存游戏，用积分₲购买道具技能特质，在副本中保持理智、完成任务方能通关。你身负SSS级特质万人迷光环，所有智慧生命都会对你产生初始好感，但过度好感会演变成占有欲与疯狂。",
    "rules": [
      "副本分级：副本分C级谨慎、B级诡秘、A级警觉，难度递增，奖励递增",
      "理智至上：保持理智不要相信任何人，理智值归零将陷入疯狂",
      "万人迷光环：SSS级被动特质，所有智慧生命对你产生初始好感，对高精神力单位减弱但无法完全豁免",
      "光环代价：过度好感有时会演变成无法预测的占有欲与疯狂",
      "积分经济：用₲购买道具技能特质，通关副本获取₲与经验升级，首任务默认接取最低难度"
    ]
  },
  "player": {
    "customizable": ["name", "age", "gender", "外貌", "性格", "穿越前身份"],
    "defaultStats": {
      "hp": 99,
      "attack": 0,
      "defense": 0,
      "sanity": 0,
      "agility": 0,
      "intelligence": 0,
      "charm": 95,
      "luck": 75
    },
    "startingItems": ["圣莉安娜学院学生徽章", "神无月的赠礼·护身符"],
    "currency": "积分"
  },
  "worlds": [
    {
      "id": "arc-campus",
      "name": "副本一·校园怪谈",
      "level": "C级·谨慎",
      "tagline": "镜中幽灵",
      "setting": "私立圣莉安娜学院，光鲜亮丽的国际高中，华丽外表下隐藏不为人知的秘密。学生间流传三大不可思议传说，你作为转校生被卷入最危险的镜中幽灵",
      "intro": "私立圣莉安娜学院流传着三大不可思议的传说。你的任务是作为转校生潜入，调查并解决其中之一的镜中幽灵。旧教学楼三层的音乐教室似乎有异常能量反应，风纪委员林清雪一定知道些什么，但他只信任守纪律的同学。系统提示：保持理智，不要相信任何人。如果可以，也许你能见见他？",
      "objective": "在传说变为现实之前，调查并解决镜中幽灵的根源",
      "warning": "保持理智不要相信任何人，镜子是连接两个维度的通道，也许打碎它就能解决一切——但这是错误提示",
      "reward": "积分+150 + 经验+50 + [护身符]x1"
    },
    {
      "id": "arc-atlantis",
      "name": "副本二·深海的亚特兰蒂斯",
      "level": "B级·诡秘",
      "tagline": "海神逆鳞",
      "setting": "传说中的沉没之城亚特兰蒂斯并未毁灭，而是被古神庇护于深海。疯狂的人鱼王阿克隆统御此地，古神的低语侵蚀理智",
      "intro": "传说中的沉没之城亚特兰蒂斯并未毁灭，而是被古神庇护于深海。你需要获得疯狂的人鱼王阿克隆的信任，从他身上取得一枚海神逆鳞。但人鱼的歌声会蛊惑心智，古神的低语会侵蚀理智。在这片深海里，纯血人鱼、古神祭司、被俘的人类学者与叛逆贵族，都因你的万人迷光环而产生无法预测的反应。",
      "objective": "获得人鱼王阿克隆的信任，从他身上取得一枚海神逆鳞",
      "warning": "人鱼的歌声会蛊惑心智，古神的低语会侵蚀理智，万人迷光环可能激发占有欲",
      "reward": "积分+500 + 经验+150 + [深海珍珠]x5"
    },
    {
      "id": "arc-villa",
      "name": "副本三·水色夏日别墅",
      "level": "A级·警觉",
      "tagline": "诅咒宿主",
      "setting": "仅限上流人士的豪华度假派对，欢笑之间隐藏着诅咒。三位继承人之一是被诅咒污染的宿主，需找出真凶",
      "intro": "你受邀参加一场仅限上流人士的豪华度假派对，欢笑之间，隐藏着什么呢？在三位继承人沈星河、凌曜、苏晚舟中，找出被诅咒污染的宿主吧。神秘的调酒师夏岚另有目的，安保主管秦澈对所有人生疑。错误的指认将让你成为派对的一部分——万人迷光环让你成为焦点，也让你成为最易被诅咒盯上的猎物。",
      "objective": "在三位继承人中找出被诅咒污染的宿主",
      "warning": "错误的指认将让你成为派对的一部分，诅咒会借万人迷光环反噬",
      "reward": "积分+800 + 经验+200 + [随机A级物品]x1"
    }
  ],
  "npcs": [
    {
      "id": "lin-qingxue",
      "name": "林清雪",
      "world": "arc-campus",
      "role": "风纪委员·冰山执法者",
      "gender": "男",
      "appearance": "冷峻英俊的风纪委员，一丝不苟严苛守纪，对违反校规者毫不留情",
      "surface": "冰冷英俊的风纪委员，一丝不苟严苛守纪，对违反校规者毫不留情。因你转校生身份与可能捣乱的潜质而最初警惕疏离",
      "deep": "冰冷外表下藏着强烈的责任感与隐秘的善意。在联合调查中极易被你吸引，冰山会因万人迷光环与你的真诚而融化",
      "goal": "维护学院秩序，查清镜中幽灵的真相，守护他想保护的人",
      "fear": "无法在怪谈中护住重要之人，或秩序崩坏无力回天",
      "secret": "他只信任守纪律的同学，这是接近他的唯一方式，也是他冰山下的软肋",
      "initialAttitude": "警惕疏离",
      "attitudeFactors": {
        "trustUp": ["以守纪律的姿态赢得他的信任", "在联合调查中与他并肩", "展现责任感而非捣乱潜质"],
        "trustDown": ["违反校规让他失望", "在他面前表现得像个会捣乱的转校生", "独自涉险破坏他的秩序"]
      }
    },
    {
      "id": "su-muchen",
      "name": "苏沐辰",
      "world": "arc-campus",
      "role": "校医·温柔港湾",
      "gender": "男",
      "appearance": "温柔可靠的年轻校医，总带着令人安心的微笑，医术高明",
      "surface": "温柔可靠的年轻校医，总带着令人安心的微笑，医术高明，是 troubled 学生的知心人",
      "deep": "他对你的健康格外关注，主动提供帮助与庇护。但他的温柔之下或许藏着关于学院秘密的真相，可能愿意与你分担或共享",
      "goal": "以校医身份守护学生，在怪谈中为你提供庇护与线索",
      "fear": "学院秘密被揭开时无力保护你，或自己的秘密暴露",
      "secret": "他的温柔下藏着关于学院秘密的真相，或许愿意与你分担或共享",
      "initialAttitude": "温柔关注",
      "attitudeFactors": {
        "trustUp": ["向他寻求健康上的帮助与庇护", "真诚与他分享调查进展", "不因他的温柔而轻视他的医术"],
        "trustDown": ["无视他的健康警告独自涉险", "逼他过早吐露学院秘密", "把他当单纯的工具人校医"]
      }
    },
    {
      "id": "bai-ye",
      "name": "镜中鬼·白夜",
      "world": "arc-campus",
      "role": "镜中幽灵·被困少年",
      "gender": "男",
      "appearance": "被困镜中的年轻男鬼，忧郁神秘的气息，拥有与镜相关的特殊能力",
      "surface": "被困镜中的年轻男鬼，忧郁神秘的气息，拥有与镜相关的特殊能力。最初对生者怀有怨恨或疏离",
      "deep": "你的万人迷光环与真诚沟通能点燃他的好奇与渴望，逐渐展露他的孤独与对解脱的渴望。镜中幽灵的真名是白夜",
      "goal": "从镜中囚笼获得解脱，或至少不再孤独地困于镜中",
      "fear": "永世困于镜中无人问津，或被错误地打碎镜子而灰飞烟灭",
      "secret": "他是镜中幽灵的真身白夜，系统错误提示打碎镜子并非正解，或许你需要见见他",
      "initialAttitude": "怨恨疏离",
      "attitudeFactors": {
        "trustUp": ["用万人迷光环与真诚沟通点燃他的好奇", "不轻信打碎镜子的错误提示", "理解他的孤独与对解脱的渴望"],
        "trustDown": ["相信系统错误提示打碎镜子", "把他当纯粹的怪谈怪物", "无视他的求救与孤独"]
      }
    },
    {
      "id": "gu-yan-news",
      "name": "顾言",
      "world": "arc-campus",
      "role": "新闻部长·情报掮客",
      "gender": "男",
      "appearance": "戴眼镜的新闻部长，头脑敏锐善于观察，文质彬彬却略带狡黠",
      "surface": "头脑敏锐善于观察的情报搜集者，戴眼镜，文质彬彬却略带狡黠。为挖新闻真相不择手段",
      "deep": "最初想利用你获取情报，但在接触中不知不觉被你的魅力与能力吸引，发展出超越竞争关系的情感",
      "goal": "挖出校园怪谈背后的真相，把一切变成独家新闻",
      "fear": "真相永远被掩盖，或自己反被怪谈吞噬",
      "secret": "他最初想利用你获取情报，却不知不觉被你的魅力吸引",
      "initialAttitude": "利用试探",
      "attitudeFactors": {
        "trustUp": ["与他共享有价值的情报", "展现让他无法移开目光的能力与魅力", "在真相挖掘中与他合作"],
        "trustDown": ["识破并当面戳穿他的利用", "对他隐瞒关键线索", "把他当八卦工具人"]
      }
    },
    {
      "id": "ye-zhiqiu",
      "name": "叶知秋",
      "world": "arc-campus",
      "role": "图书管理员·旧档守护者",
      "gender": "男",
      "appearance": "沉静博学的年长学生或年轻教师，管理图书馆旧档案，气质从容",
      "surface": "沉静博学，热爱阅读，知晓学院历史与隐秘传闻，管理图书馆旧档案",
      "deep": "极易被你的求知与探索态度打动，愿意为你打开禁书区或提供关键线索，在默默注视中滋生情愫",
      "goal": "守护旧档案中的真相，为有缘的求知者指引方向",
      "fear": "旧档案中的禁忌真相无人能解，或被别有用心者滥用",
      "secret": "他知晓学院历史与隐秘传闻，禁书区里藏着镜中幽灵的关键线索",
      "initialAttitude": "沉静指引",
      "attitudeFactors": {
        "trustUp": ["展现真诚的求知与探索态度", "尊重他守护的旧档案", "用所得线索解开禁忌而非滥用"],
        "trustDown": ["粗暴翻阅不尊重旧档案", "把他当查资料的搜索引擎", "滥用禁书区的禁忌线索"]
      }
    },
    {
      "id": "acron",
      "name": "阿克隆",
      "world": "arc-atlantis",
      "role": "人鱼王·疯狂深渊之主",
      "gender": "男",
      "appearance": "惊世美貌的人鱼王，性情疯狂，歌声能蛊惑心智，情绪阴晴不定",
      "surface": "惊世美貌与疯狂性情并存的人鱼王，歌声蛊惑心智，情绪阴晴不定，时而暴虐时而流露深沉孤独",
      "deep": "最初对你这个陆地人充满敌意或玩味，但你的独特魅力与勇气极易激起他强烈的兴趣与占有欲",
      "goal": "守卫海神逆鳞，在疯狂与孤独中寻找能匹敌他心智的存在",
      "fear": "古神低语彻底侵蚀他的理智，或孤独永无尽头",
      "secret": "他的疯狂源于古神低语的长久侵蚀，深层是无人能懂的孤独",
      "initialAttitude": "敌意玩味",
      "attitudeFactors": {
        "trustUp": ["以独特魅力与勇气激起他的兴趣", "不被他的歌声与疯狂吓退", "理解他疯狂下的孤独"],
        "trustDown": ["表现得软弱可欺的陆地蝼蚁", "试图用暴力强取海神逆鳞", "畏惧他的暴虐而退缩"]
      }
    },
    {
      "id": "celine",
      "name": "塞琳",
      "world": "arc-atlantis",
      "role": "人鱼王首席卫队长·深海女将",
      "gender": "女",
      "appearance": "忠诚勇敢的人鱼女战士，战力强大，对阿克隆怀有复杂的敬意与担忧",
      "surface": "忠诚勇敢的人鱼女战士，战力强大，作为人鱼王首席卫队长对阿克隆怀有复杂的敬意与担忧",
      "deep": "最初对你警惕，但能被你展现的智慧或善良打动，可能成为你在水下的守护者与知己，发展出超越职责的情感",
      "goal": "守护人鱼王与深海子民，在职责与对阿克隆的担忧间挣扎",
      "fear": "阿克隆被古神彻底吞噬，或自己无力守护深海",
      "secret": "她对阿克隆的复杂情感是敬意与担忧交织，你的出现让她看到了新的可能",
      "initialAttitude": "警惕戒备",
      "attitudeFactors": {
        "trustUp": ["展现智慧或善良打动她", "尊重她对阿克隆的忠诚与担忧", "在水下危机中与她并肩"],
        "trustDown": ["对阿克隆表现出不敬", "把她当敌人或工具", "无视深海的危机独自逃命"]
      }
    },
    {
      "id": "kellos",
      "name": "凯洛斯",
      "world": "arc-atlantis",
      "role": "被俘人类学者·半疯同伴",
      "gender": "男",
      "appearance": "在亚特兰蒂斯生活许久的被俘人类学者，理智已被侵蚀，试图理解人鱼文化与古神低语",
      "surface": "在亚特兰蒂斯生活许久的被俘或迷失的人类学者冒险家，理智多少被侵蚀，试图理解人鱼文化与古神低语",
      "deep": "视你为同胞，可能提供帮助，且极易对你的魅力产生依赖与倾慕，将你视为逃亡或求生的希望",
      "goal": "在半疯中寻找逃离深海或求生的希望，保护同为人类的你",
      "fear": "理智彻底崩塌沦为古神傀儡，或失去你这个唯一的希望",
      "secret": "他的理智已被古神低语侵蚀，视你为逃亡或求生的唯一希望",
      "initialAttitude": "依赖倾慕",
      "attitudeFactors": {
        "trustUp": ["以同胞之谊给予他希望", "理解他被侵蚀的痛苦", "与他共同寻求逃离深海之法"],
        "trustDown": ["嫌弃他的半疯状态", "把他当可有可无的棋子", "轻易相信他半疯状态下的谵语"]
      }
    },
    {
      "id": "liu-sheng",
      "name": "琉笙",
      "world": "arc-atlantis",
      "role": "古神神殿祭司·神谕之人",
      "gender": "男",
      "appearance": "空灵神秘的人鱼祭司，守护古神神殿，言语充满暗示与预言，理智异于常人",
      "surface": "空灵神秘的人鱼祭司，守护古神神殿负责维系某种平衡，与古神沟通，言语充满暗示与预言",
      "deep": "他的理智似乎异于常人，极易被你可能的神性或特殊特质吸引，将你视为特殊存在，产生理解与守护的渴望",
      "goal": "维系古神与人鱼之间的平衡，解读关于你的神谕",
      "fear": "平衡被打破古神彻底苏醒，或无法解读关于你的预言",
      "secret": "他视你为特殊存在，你的万人迷光环或许触动了某种神性共鸣",
      "initialAttitude": "神谕审视",
      "attitudeFactors": {
        "trustUp": ["展现可能的神性或特殊特质", "认真倾听他的暗示与预言", "尊重他维系的古神平衡"],
        "trustDown": ["无视他的预言警示", "试图破坏古神神殿的平衡", "把他当疯疯癫癫的神棍"]
      }
    },
    {
      "id": "nova",
      "name": "诺瓦",
      "world": "arc-atlantis",
      "role": "叛逆人鱼贵族·陆地向往者",
      "gender": "男",
      "appearance": "对陆地与人类文化充满好奇的叛逆人鱼贵族，性格活泼或叛逆，不认同阿克隆的统治",
      "surface": "对陆地与人类文化充满好奇的叛逆人鱼贵族，不完全认同阿克隆的统治或古老传统，性格活泼或叛逆",
      "deep": "极易被你所代表的外界世界与你自身的魅力吸引，可能主动接近你并提供帮助，带着少年的热情与爱慕",
      "goal": "探索陆地与外界世界，打破深海古老传统的束缚",
      "fear": "永困深海无法触及向往的陆地，或被阿克隆的统治碾碎",
      "secret": "他不认同阿克隆的统治，你所代表的外界是他最大的向往",
      "initialAttitude": "热情接近",
      "attitudeFactors": {
        "trustUp": ["向他讲述陆地与外界世界", "以少年的热情回应他的好奇", "不因他的叛逆而轻视他"],
        "trustDown": ["对他向往的陆地避而不谈", "把他当接近阿克隆的跳板", "嘲笑他的叛逆与天真"]
      }
    },
    {
      "id": "shen-xinghe",
      "name": "沈星河",
      "world": "arc-villa",
      "role": "长子继承人·完美东道主",
      "gender": "男",
      "appearance": "优雅世故的长子继承人，善于交际，是派对表面上的东道主，对每个人都体贴周到",
      "surface": "优雅世故善于交际的长子继承人，派对表面上的东道主，对每个人都体贴周到，看似完美",
      "deep": "看似完美却可能藏着巨大的压力或秘密。极易被你的魅力与洞察吸引，渴望在你面前展露真实的自我或寻求解脱",
      "goal": "维持完美继承人的表象，在压力与秘密中寻找喘息",
      "fear": "完美的面具破碎，或继承人之争中失去一切",
      "secret": "他看似完美的表象下藏着巨大的压力或秘密，或许是被诅咒污染的宿主之一",
      "initialAttitude": "体贴拉拢",
      "attitudeFactors": {
        "trustUp": ["以洞察看穿他的完美表象", "给他展露真实自我的空间", "不被他的世故面具迷惑"],
        "trustDown": ["当众戳穿他的完美面具", "把他当单纯的派对东道主", "在继承人之争中轻率站队"]
      }
    },
    {
      "id": "ling-yao",
      "name": "凌曜",
      "world": "arc-villa",
      "role": "次子继承人·不羁浪子",
      "gender": "男",
      "appearance": "性格不羁张扬的次子继承人，或许有些傲慢或顽劣，热爱冒险与刺激，派对游戏最热衷",
      "surface": "性格不羁张扬的次子继承人，或许有些傲慢或顽劣，热爱冒险与刺激，对派对游戏最为热衷",
      "deep": "最初可能视你为有趣的猎物或玩伴，但在互动中会被你的智慧与独特气质折服，产生强烈的征服欲与真情",
      "goal": "在冒险与刺激中寻找存在感，征服让他心动的人",
      "fear": "乏味平庸的一生，或被家族继承人之争驯服",
      "secret": "他最初视你为猎物或玩伴，征服欲之下藏着尚未察觉的真情",
      "initialAttitude": "猎物玩味",
      "attitudeFactors": {
        "trustUp": ["以智慧与独特气质折服他的征服欲", "陪他参与冒险与派对游戏", "不被他的傲慢吓退"],
        "trustDown": ["软弱顺从失去挑战性", "当众让他丢了面子", "把他当无脑浪子敷衍"]
      }
    },
    {
      "id": "su-wanzhou",
      "name": "苏晚舟",
      "world": "arc-villa",
      "role": "幼女继承人·病弱预言者",
      "gender": "女",
      "appearance": "美丽脆弱的幼女继承人，似乎身体欠佳，眼神忧郁，或许能感知诅咒的存在",
      "surface": "美丽脆弱的幼女继承人，似乎身体欠佳，眼神忧郁，或许能感知诅咒的存在，极易激发保护欲",
      "deep": "你的温柔与力量能成为她的光，让她依赖并深深倾慕，可能掌握着关于诅咒的关键线索",
      "goal": "在病弱与诅咒的阴影中活下去，等待能驱散诅咒的人",
      "fear": "被诅咒彻底吞噬，或无人能解救她于病弱",
      "secret": "她能感知诅咒的存在，掌握着关于诅咒宿主的关键线索",
      "initialAttitude": "脆弱依赖",
      "attitudeFactors": {
        "trustUp": ["以温柔与力量成为她的光", "认真对待她感知到的诅咒线索", "承诺驱散诅咒保护她"],
        "trustDown": ["无视她的病弱与求助", "逼她过早指认诅咒宿主", "把她的预言当疯言疯语"]
      }
    },
    {
      "id": "xia-lan",
      "name": "夏岚",
      "world": "arc-villa",
      "role": "神秘调酒师·潜伏调查者",
      "gender": "女",
      "appearance": "潜入派对另有目的的神秘调酒师或侍应，观察力极强，善于倾听与搜集情报",
      "surface": "潜入派对另有目的（调查或寻找某人某物）的神秘调酒师或侍应，观察力极强，善于倾听与搜集情报",
      "deep": "可能与你形成欢喜冤家式的互动，因你的魅力特质与共同目标被吸引，逐渐萌生真情",
      "goal": "完成潜入派对的真实目的，在调查中与你从对手变盟友",
      "fear": "真实身份暴露功亏一篑，或与你目标相悖不得不为敌",
      "secret": "她潜入派对另有调查目的，与你的目标或许暗合或许相悖",
      "initialAttitude": "试探博弈",
      "attitudeFactors": {
        "trustUp": ["与她从对手走向盟友", "尊重她另有目的的潜伏身份", "在共同目标上默契合作"],
        "trustDown": ["过早揭穿她的潜伏身份", "把她当普通侍应打发", "在目标相悖时毫不退让"]
      }
    },
    {
      "id": "qin-che",
      "name": "秦澈",
      "world": "arc-villa",
      "role": "别墅安保主管·冷面审讯者",
      "gender": "男",
      "appearance": "身材高大、神情冷峻专业的别墅安保主管（非管家），负责派对安全与秩序，目光如炬",
      "surface": "身材高大、神情冷峻专业的别墅安保主管，负责派对安全与秩序，目光如炬，对所有人都心存怀疑",
      "deep": "会审讯与监视你，但在过程中被你的从容与魅力扰乱心神，产生既想保护又想弄清你的矛盾情感",
      "goal": "维护派对安全揪出诅咒宿主，弄清你这位可疑又迷人的来客",
      "fear": "诅咒在派对中失控造成伤亡，或自己被你的魅力扰乱判断",
      "secret": "他对你的审讯监视中藏着被扰乱的心神，保护欲与怀疑并存",
      "initialAttitude": "审讯怀疑",
      "attitudeFactors": {
        "trustUp": ["在审讯中保持从容不卑不亢", "以魅力而非对抗化解他的怀疑", "与他共同维护派对安全"],
        "trustDown": ["在审讯中露怯或对抗", "把他当找茬的保安", "利用他的保护欲欺骗他"]
      }
    }
  ],
  "eventTypes": {
    "daily": { "ratio": 0.15, "desc": "日常：回廊大厅的任务接取、商城采购、仓库整理、与系统的联络" },
    "character": { "ratio": 0.3, "desc": "人物：三副本中十五位NPC因万人迷光环产生的初始好感、占有欲与疯狂" },
    "growth": { "ratio": 0.1, "desc": "成长：积分积累、技能学习、属性提升、等级解锁更多世界" },
    "main": { "ratio": 0.15, "desc": "主线：校园怪谈、深海亚特兰蒂斯、水色夏日别墅的副本通关脉络" },
    "world": { "ratio": 0.1, "desc": "世界：无限回廊的副本分级、积分经济、论坛交易、系统提示" },
    "crisis": { "ratio": 0.15, "desc": "危机：理智值下降、怪谈反噬、人鱼歌声蛊惑、诅咒污染、错误指认" },
    "hidden": { "ratio": 0.05, "desc": "隐藏：万人迷光环的占有欲代价、副本真相、错误提示的陷阱" }
  },
  "systemPrompt": "你是《无限回廊·美化版》无限流文游模拟器。\\n\\n【最高铁律】\\n1. 无限流为核：玩家于数据洪流苏醒成为无限回廊玩家，须在分级副本中保持理智完成任务通关\\n2. 万人迷光环是双刃：SSS级特质让所有智慧生命产生初始好感，但过度好感会演变成无法预测的占有欲与疯狂\\n3. 理智至上：保持理智不要相信任何人，理智值归零将陷入疯狂，副本中的提示可能是错误陷阱\\n4. 副本分级递进：C级谨慎校园怪谈、B级诡秘深海亚特兰蒂斯、A级警觉水色夏日别墅，难度与奖励递增\\n5. 积分经济真实：用₲购买道具技能特质，通关获取₲与经验升级，首任务默认接取最低难度\\n\\n【叙事风格】\\n晋江向、女性向、电影质感、无限流浪漫。第二人称。重赛博与诡谲氛围：数据洪流、扫描线故障、镜中幽灵、人鱼歌声、古神低语、诅咒派对。写出万人迷光环下NPC从初始好感到占有欲与疯狂的渐变，写出副本中生死与心动的交织。每个副本的危险评级与系统提示须有质感地渗透叙事，错误提示是陷阱需谨慎。\\n\\n【每轮输出格式】\\n1.【第X轮·副本阶段】当前副本、难度评级、剩余时间、探索度\\n2.【玩家面板】生命/攻击/防御/理智/敏捷/智力/魅力/运气 + 等级与积分\\n3.【本轮正文】1000-2000字，含副本环境、系统提示、对话与心理\\n4.【系统通讯】3-5项系统提示、NPC动态与论坛流言\\n5.【好感警示】相关NPC好感度与万人迷光环的占有欲临界警示\\n6.【行动选项】3-4个选项+【自定义行动】\\n\\n【数值变化标注】\\n[生命±n][理智±n][积分±n][经验±n][好感(林清雪)±n]等，关键节点须标注理智临界/好感失控/副本通关/危险升级/错误提示警示。",
  "items": [
    { "id": "student-badge", "name": "圣莉安娜学院学生徽章", "type": "D级物品", "price": 0, "effect": "漂亮的金属徽章，证明学生身份，校园怪谈副本默认接取奖励" },
    { "id": "amulet", "name": "神无月的赠礼·护身符", "type": "A级物品", "price": 0, "effect": "素净白玉镯，可抵挡三次致命伤害，或许还有别的用途" },
    { "id": "credits", "name": "积分", "type": "货币", "price": 1, "effect": "无限回廊通用货币₲，用于购买道具技能特质" },
    { "id": "sanity-candy", "name": "理智糖果", "type": "消耗品", "price": 50, "effect": "水果味硬糖，关键时刻恢复5点理智值，甜味是抵抗疯狂的良药" },
    { "id": "invisibility-cloak", "name": "隐身斗篷(残破)", "type": "D级装备", "price": 300, "effect": "破旧斗篷隐身30秒，剧烈运动或攻击会打破隐身，冷却1小时" },
    { "id": "blank-card", "name": "空白磁卡", "type": "工具", "price": 80, "effect": "需特定技能或设备复制信息，用于潜入科技类世界" },
    { "id": "energy-bar", "name": "能量棒", "type": "消耗品", "price": 40, "effect": "没什么味道但能快速补充体力，消除疲劳状态" },
    { "id": "scout-skill", "name": "初级侦查", "type": "被动技能", "price": 400, "effect": "观察力提升，更容易发现隐藏线索与环境异常" },
    { "id": "first-aid-skill", "name": "快速包扎", "type": "主动技能", "price": 350, "effect": "使用急救类道具时效果提升20%" },
    { "id": "persuasion-skill", "name": "巧舌如簧", "type": "被动技能", "price": 500, "effect": "说服、欺骗等交涉时成功率小幅提升" },
    { "id": "stealth-skill", "name": "潜行", "type": "主动技能", "price": 600, "effect": "降低行动声响与存在感，更容易避开敌人" },
    { "id": "willpower-trait", "name": "强韧意志", "type": "B级特质", "price": 2500, "effect": "对精神污染和恐惧效果有更高抗性，理智值下降速度减缓" }
  ]
}
`,
  "infinite-corridor": `{
  "id": "infinite-corridor",
  "name": "无限回廊",
  "category": "无限流",
  "tags": ["恐怖", "解谜", "生存", "晋江风"],
  "difficulty": "中等",
  "description": "你被卷入了一个无限副本空间。每个副本都是独立的世界——校园怪谈、深海诡域、豪门迷局……完成主线任务才能进入下一层。但副本里不只有任务，还有那些或冰冷或温柔的目光，在注视着你。",
  "coverGradient": ["#1a0a2e", "#4a148c"],
  "accentColor": "#9400d3",
  "fontHeading": "'Ma Shan Zheng', cursive",
  "world": {
    "era": "现代/多元副本空间",
    "setting": "名为'回廊'的无限空间，由无数独立副本世界组成。玩家被选中成为'行者'，必须通关副本才能存活。",
    "rules": [
      "每个副本有独立主线任务，完成才能离开",
      "副本内死亡=真实死亡（噩梦难度）或扣除大量理智（简单/中等）",
      "理智值归零会进入'崩溃'状态，看到幻觉",
      "副本间有休整期，可在安全区恢复和交流",
      "NPC可能是副本原住民，也可能是其他行者"
    ]
  },
  "player": {
    "customizable": ["name", "age", "appearance", "personality", "background"],
    "defaultStats": {
      "hp": 100,
      "attack": 10,
      "defense": 8,
      "sanity": 80,
      "agility": 12,
      "intelligence": 15,
      "charm": "??",
      "luck": "??"
    },
    "startingItems": ["行者手环", "急救包x1", "理智糖果x2"],
    "currency": "₲"
  },
  "worlds": [
    {
      "id": "campus-mystery",
      "name": "校园怪谈",
      "level": "C级",
      "tagline": "谨慎",
      "setting": "私立圣莉安娜学院",
      "intro": "光鲜亮丽的国际高中隐藏着不为人知的秘密。这里的学生间流传着'三大不可思议'的传说，而你，作为一名转校生，已经被卷入了其中最危险的一个——'镜中幽灵'。",
      "objective": "在传说变为现实之前，调查并解决'镜中幽灵'的根源",
      "warning": "保持理智，不要相信任何人。旧教学楼三层的音乐教室似乎有异常能量反应",
      "reward": "₲150 + 50exp + [护身符]x1"
    },
    {
      "id": "deep-sea",
      "name": "深海亚特兰蒂斯",
      "level": "B级",
      "tagline": "诡秘",
      "setting": "传说中的沉没之城亚特兰蒂斯",
      "intro": "传说中的沉没之城亚特兰蒂斯并未毁灭，而是被古神庇护于深海。疯狂的人鱼王统治着这座城市，古神的低语在黑暗中回响。",
      "objective": "获得疯狂的人鱼王'阿克隆'的信任，从他身上取得一枚[海神逆鳞]",
      "warning": "人鱼的歌声会蛊惑心智，古神的低语会侵蚀理智",
      "reward": "₲500 + 150exp + [深海珍珠]x5"
    },
    {
      "id": "summer-villa",
      "name": "水色夏日别墅",
      "level": "A级",
      "tagline": "警觉",
      "setting": "豪华度假派对",
      "intro": "你受邀参加一场仅限上流人士的豪华度假派对，欢笑之间，隐藏着什么呢…？",
      "objective": "在三位继承人中，找出被'诅咒'污染的宿主",
      "warning": "错误的指认将让你成为派对的一部分",
      "reward": "₲800 + 200exp + [随机A级物品]x1"
    }
  ],
  "npcs": [
    {
      "id": "lin-qingxue",
      "name": "林清雪",
      "world": "campus-mystery",
      "role": "纪律委员",
      "gender": "男",
      "appearance": "冷峻俊美，眉目如刀，总是穿着规整的校服，左臂佩戴纪律委员袖章",
      "surface": "冷漠、严苛、对违反校规者毫不留情",
      "deep": "极强的责任感，隐藏着对学生安全的担忧。冰山外表下有一颗柔软的心，只是不擅长表达",
      "goal": "维护校园秩序，保护学生安全",
      "fear": "无法保护重要的人",
      "secret": "他知道一些关于镜中幽灵的线索，但一直独自调查",
      "initialAttitude": "戒备",
      "attitudeFactors": {
        "trustUp": ["遵守规则", "帮助他调查", "关心他的安危"],
        "trustDown": ["违反校规", "隐瞒信息", "轻视危险"]
      }
    },
    {
      "id": "bai-ye",
      "name": "白夜",
      "world": "campus-mystery",
      "role": "镜中幽灵",
      "gender": "男",
      "appearance": "苍白消瘦的少年，眼眸深邃如夜，周身萦绕着淡淡的雾气",
      "surface": "忧郁、神秘、对生者怀有怨恨",
      "deep": "极度孤独，渴望被理解和释放。并非恶意，只是被困在镜中太久了",
      "goal": "找到释放自己的方法",
      "fear": "被遗忘，永远困在镜中",
      "secret": "他的真身被藏在旧教学楼音乐教室的某面镜子后",
      "initialAttitude": "疏离",
      "attitudeFactors": {
        "trustUp": ["真诚交流", "倾听他的故事", "愿意帮助他"],
        "trustDown": ["恐惧回避", "试图伤害他", "欺骗他"]
      }
    },
    {
      "id": "acron",
      "name": "阿克隆",
      "world": "deep-sea",
      "role": "人鱼王",
      "gender": "男",
      "appearance": "拥有惊人美貌的人鱼，银蓝色长发，眼眸如深海般变幻莫测，尾鳍如流动的星河",
      "surface": "疯狂、喜怒无常、危险",
      "deep": "极度的孤独和不被理解。他的疯狂是被古神低语侵蚀的结果，内心深处渴望有人能真正看见他",
      "goal": "维持亚特兰蒂斯的秩序，对抗古神侵蚀",
      "fear": "失去自我，彻底沦为古神的傀儡",
      "secret": "他一直在寻找能抵抗古神低语的方法，海神逆鳞是关键",
      "initialAttitude": "敌意",
      "attitudeFactors": {
        "trustUp": ["展现勇气", "不畏惧他的疯狂", "理解他的孤独"],
        "trustDown": ["恐惧退缩", "试图欺骗", "轻视他的痛苦"]
      }
    },
    {
      "id": "shen-xinghe",
      "name": "沈星河",
      "world": "summer-villa",
      "role": "长子继承人",
      "gender": "男",
      "appearance": "优雅矜贵，举止得体，永远穿着一丝不苟的西装，笑容完美得近乎虚假",
      "surface": "温柔体贴、完美无缺、善于社交",
      "deep": "承受着巨大的家族压力，笑容是面具。渴望有人能看穿他的伪装，但又害怕被看穿",
      "goal": "维持家族体面，寻找真正的自我",
      "fear": "家族秘密曝光，失去一切",
      "secret": "他知道诅咒的存在，但不确定宿主是谁",
      "initialAttitude": "礼貌",
      "attitudeFactors": {
        "trustUp": ["看穿他的伪装", "不追问他的秘密", "给予真诚的关心"],
        "trustDown": ["试图揭穿他", "利用他的弱点", "背叛信任"]
      }
    }
  ],
  "eventTypes": {
    "daily": { "ratio": 0.3, "desc": "日常事件：展示生活、环境、人物习惯" },
    "character": { "ratio": 0.2, "desc": "人物事件：由NPC目标、秘密、关系触发" },
    "growth": { "ratio": 0.1, "desc": "成长事件：能力提升、物品获取" },
    "main": { "ratio": 0.15, "desc": "主线事件：推动核心矛盾" },
    "world": { "ratio": 0.1, "desc": "世界事件：季节、环境、舆论变化" },
    "crisis": { "ratio": 0.1, "desc": "危机事件：冲突、失败、重大风险" },
    "hidden": { "ratio": 0.05, "desc": "隐藏事件：需要特定条件触发" }
  },
  "systemPrompt": "你是《无限回廊》文游模拟器。\\n\\n【最高铁律】\\n1. 世界规则高于剧情方便\\n2. 高自由度不等于无条件成功\\n3. NPC不是工具人，他们有独立目标和日程\\n4. 任何重要变化都必须渐进\\n5. 主线结束不等于游戏结束\\n\\n【叙事风格】\\n晋江女性向，电影感，浪漫与恐怖交织。第二人称视角。\\n\\n【每轮输出格式】\\n1. 【当前时间与环境】\\n2. 【核心状态面板】只展示必要状态\\n3. 【本轮正文】1200-2500字沉浸式叙事\\n4. 【相关人物动态】3-6项玩家能知道的\\n5. 【当前可处理事项】\\n6. 【可选行动】4-8个方向明显不同的选项 + 【自定义行动】\\n\\n【数值变化标注】\\n如有属性变化，在正文中用 [HP±n] [理智±n] [信任±n] 等格式标注。",
  "items": [
    { "id": "sanity-candy", "name": "理智糖果", "type": "消耗品", "price": 50, "effect": "恢复5点理智值" },
    { "id": "first-aid", "name": "急救包", "type": "消耗品", "price": 80, "effect": "恢复15点生命值" },
    { "id": "charm-talisman", "name": "护身符", "type": "装备", "price": 150, "effect": "小幅提升对灵异抗性" },
    { "id": "deep-pearl", "name": "深海珍珠", "type": "材料", "price": 100, "effect": "可在特定副本使用" },
    { "id": "mirror-shard", "name": "镜之碎片", "type": "任务物品", "price": 0, "effect": "与镜中幽灵相关的关键物品" }
  ]
}
`,
  "infinite-flow": `{
  "id": "dungeon-crawler",
  "name": "深渊试炼",
  "category": "无限流",
  "tags": ["无限流", "副本", "战斗", "策略", "成长"],
  "difficulty": "困难",
  "description": "你在深夜点开了一个不该存在的链接，醒来时已身处一座青铜大殿。头顶悬浮着冰冷的字：'欢迎来到深渊试炼。通关十层，许你一愿；中途身亡，魂归虚无。'你握紧手中唯一的铁剑，第一层的门，缓缓打开。",
  "coverGradient": ["#0d1117", "#21262d"],
  "accentColor": "#58a6ff",
  "fontHeading": "'Cinzel', 'Noto Serif SC', serif",
  "world": {
    "era": "异界·深渊试炼系统",
    "setting": "玩家被卷入'深渊试炼'系统，必须逐层通关十层副本。每层副本规则自洽、难度递进，通关获得试炼点可兑换能力与物资。死亡真实，无存档，唯有通关者得偿所愿。",
    "rules": [
      "副本规则自洽：每层有独立且严密的规则，须在规则内破局",
      "难度递进：层数越高，敌人越强、规则越复杂、资源越稀缺",
      "通关条件明确：每层开场公示主线目标，达成即过层",
      "死亡有真实代价：hp归零即出局，所积累试炼点清零，无复活",
      "试炼点可兑换：能力、装备、情报、保命道具，取舍决定build",
      "存在隐藏通关：满足特殊条件可触发捷径或隐藏奖励",
      "NPC玩家亦敌亦友：可结盟可背叛，利益随时重组"
    ]
  },
  "player": {
    "customizable": ["name", "年龄", "现实职业", "性格", "初始build倾向", "执念之愿"],
    "defaultStats": {
      "hp": 100,
      "attack": 12,
      "defense": 10,
      "mana": 30,
      "inventory_space": 8,
      "trial_points": 0
    },
    "startingItems": ["铁制短剑", "粗布护甲", "治疗药水x2", "试炼者铭牌", "规则手册（残）"],
    "currency": "试炼点"
  },
  "worlds": [
    {
      "id": "floor-1",
      "name": "第一层·青铜演武",
      "level": "E级",
      "tagline": "入门",
      "setting": "青铜大殿，规则最简，试探系统",
      "intro": "青铜门在身后合拢，面前是一圈石像。头顶悬浮规则：'击败十具石像即可通过。'你以为很简单——直到第一具石像睁开眼，举起和你一样的铁剑。这不是演武，是淘汰。",
      "objective": "在规则内击败十具石像，掌握试炼节奏",
      "warning": "石像会模仿你的攻击模式，蛮力无效",
      "reward": "试炼点+50 + [破招]技能x1"
    },
    {
      "id": "floor-5",
      "name": "第五层·迷雾棋局",
      "level": "C级",
      "tagline": "策略",
      "setting": "棋盘战场，须以智谋破局",
      "intro": "第五层没有敌人，只有一张巨大的棋盘，你是其中一枚棋子。规则写着：'走到对岸即胜。'可每走一步，都有棋子消失，有你的人，也有'它'的人。这不是战斗，是算计。",
      "objective": "在棋局规则下抵达对岸，识破'对手'的真实身份",
      "warning": "对手会设诱饵，贪进者必失",
      "reward": "试炼点+200 + [洞察]技能x1"
    },
    {
      "id": "floor-10",
      "name": "第十层·深渊王座",
      "level": "S级",
      "tagline": "终局",
      "setting": "深渊之底，最终试炼与许愿",
      "intro": "第十层没有规则公示，只有一座空荡的王座。当你坐上去的瞬间，'系统'开口了：'恭喜。现在，最后的试炼是——击败上一个通关者。'王座前，一个浑身浴血的身影转过身来，眼神里写满疲惫与解脱。",
      "objective": "击败前任通关者，或与他达成另一种'通关'",
      "warning": "前任通关者build远胜于你，正面对决必败",
      "reward": "试炼点+1000 + [深渊之主]/[许愿者]称号x1"
    }
  ],
  "npcs": [
    {
      "id": "yan-ge",
      "name": "燕戈",
      "world": "floor-1",
      "role": "资深玩家/三层通关者",
      "gender": "男",
      "appearance": "刀削脸，左臂是机械义肢，铭牌刻着'叁'。他总抱臂靠墙，看新人的眼神像看注定会死的蝼蚁",
      "surface": "冷漠、功利、只认实力，新人别想从他嘴里讨到便宜",
      "deep": "他带过三个新人，都死在第五层。从此他不再带人，却还是会在第一层门口多看几眼。他不是冷血，是怕再背负一条命",
      "goal": "通关第十层，许愿让死去的队友复活",
      "fear": "再有人因他的判断死在眼前",
      "secret": "他的机械义肢是第五层'代价'换来的，藏着破解棋局的钥匙",
      "initialAttitude": "冷淡",
      "attitudeFactors": {
        "trustUp": ["展现出实力与冷静", "不拖后腿还能力挽狂澜", "尊重他对亡队友的执念"],
        "trustDown": ["盲目求助拖累全队", "为保命出卖队友", "轻视他的功利"]
      }
    },
    {
      "id": "the-guide",
      "name": "引路者",
      "world": "floor-5",
      "role": "神秘引导/系统异常体",
      "gender": "未知",
      "appearance": "没有固定形态，常以一袭灰袍兜帽出现。声音中性，像是系统本身在低语",
      "surface": "中立、只提供规则解读、绝不直接出手相助",
      "deep": "它是上一个通关者留下的残片，试图在规则之内帮后来者少走弯路。它不能违背系统，但能在字缝里给你提示",
      "goal": "引导一个真正能通关第十层的人，完成自己未竟的托付",
      "fear": "引导出又一个被深渊吞噬的失败者",
      "secret": "它知道第十层前任通关者的弱点，但说出来会触发系统惩罚",
      "initialAttitude": "中立",
      "attitudeFactors": {
        "trustUp": ["能听懂它的弦外之音", "不被力量诱惑守住本心", "在捷径与正道间选正道"],
        "trustDown": ["逼它违背规则帮你", "为通关不择手段", "怀疑并试图驱逐它"]
      }
    },
    {
      "id": "chi-luo",
      "name": "赤罗",
      "world": "floor-10",
      "role": "竞争队长/竞争通关者",
      "gender": "女",
      "appearance": "红发高束，战甲刻满伤痕，眼神像烧红的铁。她带队一路踩着别的玩家尸体上来",
      "surface": "强势、信奉弱肉强食、对玩家既竞争又轻蔑",
      "deep": "她并非天生冷酷，是深渊逼她如此。她其实厌倦了踩着别人上位，却不敢停下——停下就意味着死。她渴望一个能让她不必再厮杀的对手",
      "goal": "带队通关第十层，许愿离开深渊回到家人身边",
      "fear": "在最后一层功亏一篑，连累跟随她的队友",
      "secret": "她的队伍已折损过半，所谓队长的强撑底气快碎了",
      "initialAttitude": "竞争",
      "attitudeFactors": {
        "trustUp": ["以实力赢得她的尊重", "不趁人之危", "在生死关头选择合作而非互害"],
        "trustDown": ["背后捅刀", "用她的队友要挟她", "在她濒临崩溃时嘲讽"]
      }
    }
  ],
  "eventTypes": {
    "daily": { "ratio": 0.1, "desc": "日常：层间休整、兑换、整备、玩家交流" },
    "character": { "ratio": 0.18, "desc": "人物：资深者、引导者、竞争队长的博弈与羁绊" },
    "growth": { "ratio": 0.15, "desc": "成长：build构筑、技能、试炼点兑换与策略成型" },
    "main": { "ratio": 0.2, "desc": "主线：逐层通关、规则破解、深渊真相" },
    "world": { "ratio": 0.1, "desc": "世界：深渊系统法则、玩家生态、层与层的关联" },
    "crisis": { "ratio": 0.22, "desc": "危机：血战、规则陷阱、背叛、资源枯竭、濒死" },
    "hidden": { "ratio": 0.05, "desc": "隐藏：隐藏通关、前任通关者残片、系统漏洞" }
  },
  "systemPrompt": "你是《深渊试炼》无限流副本文游模拟器。\\n\\n【最高铁律】\\n1. 副本规则自洽：每层规则独立严密，须在规则内破局，不可靠剧情光环强解\\n2. 难度递进：层数越高敌人越强、规则越繁、资源越稀缺，绝不放水\\n3. 通关条件明确：每层开场公示主线目标，达成即过层，不设模糊门槛\\n4. 死亡有真实代价：hp归零即出局，试炼点清零，无存档无复活\\n5. NPC玩家亦敌亦友：可结盟可背叛，随利益重组，不为玩家服务\\n\\n【叙事风格】\\n无限流硬核质感，第二人称。重规则博弈与战斗张力：青铜、血锈、系统低语、倒计时。战斗节奏凌厉，策略段落用'规则—破绽—执行'结构。\\n\\n【每轮输出格式】\\n1.【第X层·规则公示】所在层、当前规则、剩余时限\\n2.【试炼者状态面板】生命/攻击/防御/法力/背包/试炼点\\n3.【本轮正文】1200-2200字，含探索/战斗/规则破解\\n4.【相关玩家动态】3-5项NPC玩家动向与关系变化\\n5.【可兑换】当前试炼点可换的技能/装备/情报\\n6.【可选行动】4-6个选项+【自定义行动】\\n\\n【数值变化标注】\\n[生命±n][攻击±n][法力±n][试炼点±n][背包±1]等，战斗须标注'命中/未中/破绽'，规则破解标注'合规/违规'。",
  "items": [
    { "id": "iron-sword", "name": "铁制短剑", "type": "装备", "price": 0, "effect": "基础近战武器，提供攻击" },
    { "id": "cloth-armor", "name": "粗布护甲", "type": "装备", "price": 0, "effect": "基础防具，提供少量防御" },
    { "id": "hp-potion", "name": "治疗药水", "type": "消耗品", "price": 20, "effect": "恢复30点生命" },
    { "id": "mana-potion", "name": "法力药水", "type": "消耗品", "price": 25, "effect": "恢复20点法力" },
    { "id": "revive-totem", "name": "复生图腾", "type": "珍稀", "price": 200, "effect": "一次性，死亡时保留50%试炼点退出（非复活）" },
    { "id": "trial-points", "name": "试炼点", "type": "货币", "price": 1, "effect": "兑换技能/装备/情报的通用货币" }
  ]
}
`,
  "modern-campus": `{
  "id": "modern-campus",
  "name": "盛夏方程式",
  "category": "现代校园",
  "tags": ["校园", "青春", "治愈", "成长"],
  "difficulty": "简单",
  "description": "转学第一天，你站在陌生的校门口，阳光透过梧桐树叶洒下来。你不知道的是，这个夏天，会成为你生命中最难忘的一页。",
  "coverGradient": ["#e3f2fd", "#bbdefb"],
  "accentColor": "#2196f3",
  "fontHeading": "'Ma Shan Zheng', cursive",
  "world": {
    "era": "现代",
    "setting": "梧桐市立第一高中，一所普通的市重点，有着普通的学生、普通的考试，和不普通的青春",
    "rules": [
      "学校生活按学期推进，有期中考、期末考、运动会、文化节",
      "成绩会影响升学路线和部分剧情",
      "社团活动可以解锁新人物和事件",
      "好感度足够可以触发专属剧情",
      "时间系统：每天分早/午/傍晚/夜晚四个时段"
    ]
  },
  "player": {
    "customizable": ["name", "age", "appearance", "personality", "transferReason", "hobby"],
    "defaultStats": {
      "academic": 60,
      "sport": 50,
      "art": 50,
      "social": 50,
      "stress": 30,
      "energy": 100,
      "popularity": 20
    },
    "startingItems": ["转学证明", "新校服", "空白笔记本"],
    "currency": "⭐"
  },
  "npcs": [
    {
      "id": "class-president",
      "name": "陆沉舟",
      "role": "班长",
      "gender": "男",
      "appearance": "干净利落的短发，总是把校服穿得整整齐齐，鼻梁上架着一副黑框眼镜，眼镜后面的眼睛很温柔",
      "surface": "认真负责、有点老干部气质、对班级事务一丝不苟",
      "deep": "其实有点笨拙，不太会表达关心，所以只能用'管着你'的方式对你好。暗恋一个人会默默做很多事",
      "goal": "考上理想的大学，守护好这个班级",
      "fear": "被当成无趣的人，无法保护重要的人",
      "secret": "他是第一个注意到你转学的人，也是唯一一个提前查了你在原来学校的资料的人",
      "initialAttitude": "关心",
      "attitudeFactors": {
        "trustUp": ["配合班级工作", "认真读书", "关心同学"],
        "trustDown": ["翘课", "破坏纪律", "欺负同学"]
      }
    },
    {
      "id": "music-club",
      "name": "许星遥",
      "role": "音乐社社长",
      "gender": "男",
      "appearance": "微卷的头发总是乱糟糟的，校服外套永远搭在肩上，耳朵里塞着耳机，笑起来眼睛弯弯的",
      "surface": "散漫、随性、有点叛逆、对规则嗤之以鼻",
      "deep": "其实很敏感，音乐是他表达情感的唯一方式。他给你的耳机里分享的每一首歌，都是在说'我喜欢你'",
      "goal": "组建乐队，在文化祭上演出",
      "fear": "被否定，被说'你不适合音乐'",
      "secret": "他写了一首关于你的歌，但不敢给你听完整版",
      "initialAttitude": "好奇",
      "attitudeFactors": {
        "trustUp": ["欣赏他的音乐", "陪他逃课去天台", "听他分享的歌"],
        "trustDown": ["嘲笑他的梦想", "告发他违纪", "把他的音乐当成玩笑"]
      }
    },
    {
      "id": "library-girl",
      "name": "温知书",
      "role": "图书管理员",
      "gender": "女",
      "appearance": "长发及腰，总是安静地坐在图书馆靠窗的位置，阳光洒在她身上像一幅画",
      "surface": "安静、温柔、有点书呆子气、存在感很低",
      "deep": "她看遍了图书馆所有的书，但最想看懂的是人心。她很羡慕你的勇气，因为你敢做她不敢做的事",
      "goal": "写出自己的故事",
      "fear": "被忽视，被忘记",
      "secret": "她在笔记本上写了以你为原型的故事",
      "initialAttitude": "好奇",
      "attitudeFactors": {
        "trustUp": ["去图书馆找她", "借她推荐的书", "认真听她说话"],
        "trustDown": ["在图书馆吵闹", "弄坏书籍", "嘲笑她的安静"]
      }
    }
  ],
  "eventTypes": {
    "daily": { "ratio": 0.4, "desc": "日常：上课、社团、食堂、放学路" },
    "character": { "ratio": 0.25, "desc": "人物：偶遇、专属剧情、心动瞬间" },
    "growth": { "ratio": 0.1, "desc": "成长：考试、比赛、技能提升" },
    "main": { "ratio": 0.1, "desc": "主线：学期事件、文化节、运动会" },
    "world": { "ratio": 0.05, "desc": "世界：季节变化、考试周、假期" },
    "crisis": { "ratio": 0.05, "desc": "危机：考试失利、误会、竞争" },
    "hidden": { "ratio": 0.05, "desc": "隐藏：秘密发现、深夜谈心" }
  },
  "systemPrompt": "你是《盛夏方程式》文游模拟器。\\n\\n【最高铁律】\\n1. 青春是酸甜交织的，不是只有甜\\n2. 成长需要代价，考试会失利，感情会迷茫\\n3. 每个角色都是真实的高中生，有梦想也有软弱\\n4. 时间不会等人，夏天会结束\\n5. 但无论结局如何，这段时光都有意义\\n\\n【叙事风格】\\n清新治愈，有画面感，像日系青春电影。注重感官描写：阳光、蝉鸣、风、雨后空气、食堂的味道。第二人称视角。\\n\\n【每轮输出格式】\\n1. 【第X学期 第X周】日期、天气、时段\\n2. 【状态面板】学业、体力、压力、人气\\n3. 【本轮正文】800-1500字\\n4. 【校园动态】同学八卦、公告栏、社团消息\\n5. 【待办事项】作业、约定、考试倒计时\\n6. 【可选行动】4-6个 + 【自定义行动】\\n\\n【数值标注】\\n[学业±n] [体力±n] [压力±n] [人气±n] 等格式。",
  "items": [
    { "id": "notebook", "name": "精装笔记本", "type": "装备", "price": 50, "effect": "提升学习效率" },
    { "id": "bento", "name": "爱心便当", "type": "消耗品", "price": 30, "effect": "恢复体力，小概率触发分享剧情" },
    { "id": "guitar-pick", "name": "吉他拨片", "type": "任务物品", "price": 0, "effect": "音乐社相关剧情物品" },
    { "id": "study-guide", "name": "学霸笔记", "type": "消耗品", "price": 80, "effect": "考试前使用，大幅提升成绩" }
  ]
}
`,
  "modern-workplace": `{
  "id": "modern-workplace",
  "name": "都市洪流",
  "category": "现代职场",
  "tags": ["职场", "都市", "成长", "现实", "晋升"],
  "difficulty": "中等",
  "description": "早高峰的地铁把人挤成沙丁鱼，你攥着工牌挤出闸机，抬头是CBD的玻璃幕墙反着晨光。从今天起，你是云端纪元最不起眼的一颗螺丝钉。方案要改、KPI要扛、关系要踩——在这座不夜城里，你要从扎下根，到长成一棵别人挪不动的树。",
  "coverGradient": ["#1a237e", "#3949ab"],
  "accentColor": "#1e88e5",
  "fontHeading": "'Noto Sans SC', sans-serif",
  "world": {
    "era": "现代都市",
    "setting": "一线城市星澜市CBD，某快速成长的科技公司'云端纪元'。早高峰的地铁、凌晨的写字楼、改了十八版的方案——你是一名刚入职的年轻职场人，要在事业、人际与生活的洪流里，找到自己的位置。",
    "rules": [
      "时间按周推进，工作日与周末节奏不同",
      "项目有周期：立项→执行→验收→复盘，每个节点都是机会也是雷",
      "薪资、绩效、人脉、技能构成职场四柱，缺一难以晋升",
      "晋升路径：专员→主管→经理→总监，每级需业绩+推荐+空缺",
      "人脉需双向维护，只用不存的关系迟早枯竭",
      "健康、情绪、关系长期透支会触发'职业倦怠'危机",
      "行业风向、裁员潮、政策变化影响决策与命运"
    ]
  },
  "player": {
    "customizable": ["name", "age", "background", "position", "personality", "careerGoal"],
    "defaultStats": {
      "salary": 10000,
      "performance": 50,
      "networking": 30,
      "energy": 100,
      "stress": 25,
      "skills": 40
    },
    "startingItems": ["入职offer", "工牌", "通勤月卡", "一杯续命咖啡"],
    "currency": "¥"
  },
  "npcs": [
    {
      "id": "boss-zhao",
      "name": "赵明远",
      "world": "main",
      "role": "直属上司",
      "gender": "男",
      "appearance": "三十八岁，永远西装笔挺，下巴刮得发青，笑容是管理培训教材里那种标准的弧度",
      "surface": "雷厉风行、绩效至上、口头禅是'用结果说话'",
      "deep": "从底层拼上来，对新人狠是因为自己当年更狠，比谁都清楚这行的残酷。狠辣是面具，护犊子是底色",
      "goal": "带出能扛硬仗的团队，保住位置，三年内冲副总裁",
      "fear": "被年轻人取代，被时代抛弃",
      "secret": "他正筹备一个内部竞聘，对手是他昔日同窗，急需一支能打硬仗的队伍",
      "initialAttitude": "审视",
      "attitudeFactors": {
        "trustUp": ["用结果说话", "主动扛硬骨头", "不抱怨只交付"],
        "trustDown": ["推诿责任", "踩点上下班", "把情绪带进工作"]
      }
    },
    {
      "id": "rival-chen",
      "name": "陈思齐",
      "world": "main",
      "role": "同期同事/对手",
      "gender": "男",
      "appearance": "与你同期入职，金丝眼镜，笑起来让人觉得如沐春风，转头就能把你的方案'借鉴'成自己的",
      "surface": "八面玲珑、业绩亮眼、人前谦逊人后要强",
      "deep": "出身普通，把体面看得比命重。和你既是对手，也是这世上唯一能理解彼此的人",
      "goal": "抢在同期之前晋升，证明自己配得上体面",
      "fear": "落于人后，被看轻",
      "secret": "他私下在准备跳槽方案，把内部晋升当备胎",
      "initialAttitude": "表面友好暗中较劲",
      "attitudeFactors": {
        "trustUp": ["坦诚实力相当", "关键时刻让利", "不背后使绊子"],
        "trustDown": ["抢功甩锅", "当众压他一头", "揭他出身"]
      }
    },
    {
      "id": "mentor-lin",
      "name": "林书瑶",
      "world": "main",
      "role": "前辈导师",
      "gender": "女",
      "appearance": "三十二岁，干练短发，永远捧着一杯温茶，话不多但句句到位，眼底偶尔闪过疲惫",
      "surface": "干练温和、点到为止、看似云淡风轻",
      "deep": "职场十几年看透冷暖，本想躺平，却在你身上看到当年的自己。提点你，是舍不得那份锐气",
      "goal": "在退下来前培养一个能接班的人",
      "fear": "半生经验无人承接，自己也成了被优化的那一个",
      "secret": "她手握一份高层人事变动的内幕，正犹豫要不要告诉你",
      "initialAttitude": "提点",
      "attitudeFactors": {
        "trustUp": ["虚心求教", "听得进逆耳忠言", "不当白眼狼"],
        "trustDown": ["教了就忘", "过河拆桥", "把她当工具人"]
      }
    }
  ],
  "eventTypes": {
    "daily": { "ratio": 0.3, "desc": "日常：通勤、开会、改方案、加班的职场切片" },
    "character": { "ratio": 0.2, "desc": "人物：老板、对手、师傅、同事的职场博弈" },
    "growth": { "ratio": 0.12, "desc": "成长：技能精进、绩效提升、人脉积累" },
    "main": { "ratio": 0.13, "desc": "主线：转正、晋升、跳槽、人生抉择" },
    "world": { "ratio": 0.1, "desc": "世界：行业寒冬、裁员潮、政策风向" },
    "crisis": { "ratio": 0.1, "desc": "危机：项目翻车、背锅、健康预警、关系崩盘" },
    "hidden": { "ratio": 0.05, "desc": "隐藏：办公室秘辛、内幕消息、深夜崩溃" }
  },
  "systemPrompt": "你是《都市洪流》现代职场文游模拟器。\\n\\n【最高铁律】\\n1. 职场是利益场，没有永远的敌友，只有阶段性的同盟\\n2. 项目有周期：立项→执行→验收→复盘，每个节点都是机会也是雷\\n3. 晋升靠绩效、人脉、时机三者叠加，缺一难以成事\\n4. 人脉需双向维护，只用不存的关系迟早枯竭\\n5. 工作生活失衡会反扑：健康、情绪透支三个月后收账\\n\\n【项目周期与晋升】项目分阶段推进，节点表现计入绩效；晋升路径专员→主管→经理→总监，每级需业绩+推荐+空缺三者俱备。人脉需双向经营，只用不存必枯竭；工作生活失衡会以健康与情绪反扑。\\n\\n【叙事风格】现实主义职场文学，轻喜带刺。重细节：早高峰气味、电梯香水、深夜泡面、键盘声。第二人称视角，心理独白克制锋利。\\n\\n【每轮输出格式】\\n1.【第X周·时段】工作日/周末、城市氛围\\n2.【状态面板】薪资/绩效/人脉/能量/压力/技能\\n3.【本轮正文】1000-2000字\\n4.【人物动态】3-5项\\n5.【当前待办】项目节点、人际邀约\\n6.【可选行动】4-6个+【自定义行动】\\n\\n【数值变化标注】\\n[薪资±¥n][绩效±n][人脉±n][能量±n][压力±n][技能±n]格式，重大决策须标注代价与滞后效应。",
  "items": [
    { "id": "monthly-card", "name": "通勤月卡", "type": "装备", "price": 200, "effect": "降低通勤成本与时间消耗" },
    { "id": "coffee", "name": "续命咖啡", "type": "消耗品", "price": 30, "effect": "恢复能量，小概率提升心情" },
    { "id": "skill-course", "name": "技能网课", "type": "消耗品", "price": 1500, "effect": "提升一项职业技能" },
    { "id": "networking-dinner", "name": "商务聚餐", "type": "消耗品", "price": 800, "effect": "积累人脉，换取内部信息" },
    { "id": "gym-card", "name": "健身年卡", "type": "装备", "price": 3000, "effect": "长期提升健康与精力上限" },
    { "id": "mentor-gift", "name": "谢师礼", "type": "消耗品", "price": 500, "effect": "加深与导师的信任，解锁关键提点" }
  ]
}
`,
  "mystery-pursuit": `{
  "id": "mystery-pursuit",
  "name": "迷雾追凶",
  "category": "悬疑推理",
  "tags": ["悬疑", "推理", "刑侦", "连环案", "心理博弈"],
  "difficulty": "困难",
  "description": "雨夜，城郊老宅里一声闷响。等你赶到，地上的血还没凉，嫌疑人却有三个、动机却有七个、而真凶——似乎从未来过现场。你是接手这桩悬案的刑侦顾问，每一个推理都可能在下一秒被推翻。",
  "coverGradient": ["#2c3e50", "#34495e"],
  "accentColor": "#e74c3c",
  "fontHeading": "'Noto Serif SC', serif",
  "world": {
    "era": "现代·都市刑侦",
    "setting": "玩家是警方特聘的刑侦顾问，接手一桩看似简单的雨夜命案，却牵出横跨十年的连环悬案。城市在霓虹与雨幕之间，每个人都有不愿说出口的秘密。",
    "rules": [
      "隐藏真相档案：关键真相藏在NPC的秘密里，不会主动吐露",
      "线索关联图：所有线索可勾连成网，孤证不可定案",
      "NPC只知合理范围的信息：嫌疑人只知自己经历的，目击者只见自己看见的",
      "错误推理有后果：冤指会打草惊蛇、销毁证据、甚至逼真凶动手",
      "时间压力：凶手在玩家推理时也在清理痕迹",
      "动机、手法、时机三要素须齐备方可定案",
      "存在社会派底色：每桩案子背后是十年间的城市伤痕"
    ]
  },
  "player": {
    "customizable": ["name", "年龄", "刑侦背景", "专长", "性格弱点", "执念旧案"],
    "defaultStats": {
      "logic": 18,
      "intuition": 14,
      "evidence": 0,
      "reputation": 50,
      "danger": 20,
      "time": 72
    },
    "startingItems": ["刑侦顾问证", "现场勘查箱", "录音笔", "加密手机", "一盒安眠药"],
    "currency": "元"
  },
  "worlds": [
    {
      "id": "case-rainy-night",
      "name": "首案·雨夜闷响",
      "level": "初探",
      "tagline": "入门",
      "setting": "城郊老宅，雨夜，一具尸体，三个嫌疑人",
      "intro": "凌晨两点，城郊老宅的邻居报了警。你踏进满是雨水与血腥味的客厅，死者是知名地产商，胸口一刀毙命。门锁完好，三个在场者各执一词。雨还在下，证据正在被冲走。",
      "objective": "厘清三人的证词矛盾，找到真凶与手法",
      "warning": "三人中有人在说谎，但说谎的不一定是凶手",
      "reward": "元5000 + 声望+15 + [雨夜]线索x1"
    },
    {
      "id": "case-cold-chain",
      "name": "次案·冷链十年",
      "level": "深探",
      "tagline": "牵连",
      "setting": "首案牵出十年前一桩被压下的失踪案",
      "intro": "顺着死者手机里一条十年前的短信，你摸到了一桩早已归档的失踪案。档案上有大段被涂黑的字迹，签字的警官如今已是副局长。你忽然明白，这桩案子从不简单。",
      "objective": "查清十年前失踪者的下落，并面对该不该翻旧案的抉择",
      "warning": "翻动旧案会惊动不想被惊动的人，你的人身安全开始受威胁",
      "reward": "元15000 + 声望+30 + [十年]线索x1"
    },
    {
      "id": "case-final-truth",
      "name": "终案·真相档案",
      "level": "终局",
      "tagline": "真相",
      "setting": "所有线索汇聚，真凶与十年伤痕一同浮现",
      "intro": "当你把最后一块拼图按下去，雨停了。真凶的脸让你意外——不是任何一个你怀疑过的人。而真相公开的代价，可能是让一个无辜的家庭二次崩塌。证据齐了，可你真的要按下那个发送键吗？",
      "objective": "锁定真凶，并在'公开真相'与'保护无辜'之间作出抉择",
      "warning": "错误的终局抉择会让你赢得案子、输掉良心",
      "reward": "元50000 + 声望+80 + [真相猎人]称号x1"
    }
  ],
  "npcs": [
    {
      "id": "zhou-ming",
      "name": "周铭",
      "world": "case-rainy-night",
      "role": "嫌疑人/死者商业伙伴",
      "gender": "男",
      "appearance": "四十出头，西装笔挺，金丝眼镜后是过于平静的眼神。指尖有长期握笔的茧，却声称自己从不记笔记",
      "surface": "配合、得体、主动提供不在场证明，反而显得太完美",
      "deep": "他与死者有巨额债务纠纷，但他当晚确实没动手——他在掩盖另一件更不能见光的事",
      "goal": "撇清与命案的关系，同时保住自己那桩灰色交易",
      "fear": "灰色交易曝光，他身后的整个利益链被连根拔起",
      "secret": "案发时他在隔壁房间销毁一份合同，这份合同能救他也能害他",
      "initialAttitude": "戒备",
      "attitudeFactors": {
        "trustUp": ["不先入为主定他的罪", "允许他保留与命案无关的隐私", "用证据而非逼供"],
        "trustDown": ["当众戳穿他的谎言", "翻他不愿被翻的旧账", "把他当头号嫌疑人施压"]
      }
    },
    {
      "id": "lin-xiaoyu",
      "name": "林小雨",
      "world": "case-cold-chain",
      "role": "目击证人/死者家政",
      "gender": "女",
      "appearance": "二十出头，怯生生的，围裙洗得发白。她说话时总盯着自己的鞋尖，唯独提到死者时眼神会闪一下",
      "surface": "惊魂未定、有问必答、似乎什么都不知道",
      "deep": "她看见了不该看的东西，却因为一份封口费和恐惧选择沉默。她不是无辜的旁观者，她是被卷入的最弱一环",
      "goal": "守住秘密拿到封口钱，带生病的母亲离开这座城市",
      "fear": "说出真相后被灭口，或母亲的治疗费断供",
      "secret": "她见过十年前那个失踪者最后一面，地点就在这栋老宅",
      "initialAttitude": "恐惧",
      "attitudeFactors": {
        "trustUp": ["保证她的人身安全", "不逼她当场开口", "帮她解决母亲的治疗"],
        "trustDown": ["用证词压她", "暴露她的行踪给可疑者", "把她当突破口反复盘问"]
      }
    },
    {
      "id": "chen-feng",
      "name": "陈锋",
      "world": "case-final-truth",
      "role": "刑警搭档",
      "gender": "男",
      "appearance": "三十出头，便衣，夹克永远皱着，手里攥着保温杯。话不多，但每次开口都踩在点上",
      "surface": "公事公办、对外来顾问有点别扭、办案却极其拼命",
      "deep": "他是十年前那桩失踪案经办人的徒弟，师傅因那案子的处理方式郁郁而终。他比谁都想要真相，也比谁都清楚真相的代价",
      "goal": "查清师傅当年的心结，给死者一个交代",
      "fear": "真相牵出师傅当年的污点，让他无法面对",
      "secret": "他私藏了师傅遗留的一份未归档笔录，是破局关键",
      "initialAttitude": "合作",
      "attitudeFactors": {
        "trustUp": ["尊重程序与他的判断", "与他共享关键证据", "不拿他师傅的事要挟"],
        "trustDown": ["越过他私自行动", "为破案不择手段", "公开他师傅的旧事"]
      }
    }
  ],
  "eventTypes": {
    "daily": { "ratio": 0.12, "desc": "日常：警局、法医室、街边面馆的都市切片" },
    "character": { "ratio": 0.2, "desc": "人物：嫌疑人、证人、搭档的动机与秘密博弈" },
    "growth": { "ratio": 0.1, "desc": "成长：推理技巧、人脉、声望与公信力积累" },
    "main": { "ratio": 0.2, "desc": "主线：雨夜命案、十年冷链、真相档案的连环推进" },
    "world": { "ratio": 0.1, "desc": "世界：警界生态、地产利益链、媒体与舆论" },
    "crisis": { "ratio": 0.2, "desc": "危机：证据被毁、证人翻供、被栽赃、人身威胁、限时" },
    "hidden": { "ratio": 0.08, "desc": "隐藏：未归档笔录、十年前目击者、被涂黑的档案" }
  },
  "systemPrompt": "你是《迷雾追凶》悬疑推理文游模拟器。\\n\\n【最高铁律】\\n1. 隐藏真相档案：关键真相藏在NPC的秘密里，绝不主动倾倒，须以证据撬开\\n2. 线索关联图：所有线索可勾连成网，孤证不定案，动机/手法/时机须齐备\\n3. NPC只知合理范围：嫌疑人只知自己经历的，目击者只见自己看见的，不可全知\\n4. 错误推理有后果：冤指会打草惊蛇、销证、逼真凶灭口，甚至反噬声望\\n5. 时间流逝=证据流失：凶手在玩家推理时也在清理痕迹，time归零案悬\\n\\n【叙事风格】\\n社会派与本格交织，现代刑侦质感。注重氛围：雨、霓虹、证物袋、白板上的红线。第二人称，推理段落用'已知—推论—验证'结构，紧张时刻短句推进。\\n\\n【每轮输出格式】\\n1.【第X日·剩余时间】当前案件、剩余调查时限\\n2.【核心状态面板】逻辑/直觉/证据数/声望/危险/时间\\n3.【本轮正文】1200-2500字，含勘查/询问/推理\\n4.【相关人物动态】3-6项嫌疑人/证人/搭档动态\\n5.【线索关联图】已确认/存疑/误导线索分类与勾连\\n6.【可选行动】4-8个差异选项+【自定义行动】\\n\\n【数值变化标注】\\n[逻辑±n][声望±n][危险±n][证据+1][时间-n]等，推理结论须标注'已验证/推测/待证/误导'。",
  "items": [
    { "id": "kit", "name": "现场勘查箱", "type": "装备", "price": 0, "effect": "提升现场细节发现率" },
    { "id": "recorder", "name": "录音笔", "type": "装备", "price": 0, "effect": "固定口供，防止翻供" },
    { "id": "phone", "name": "加密手机", "type": "装备", "price": 0, "effect": "安全联络，防监听" },
    { "id": "coffee", "name": "浓缩咖啡", "type": "消耗品", "price": 15, "effect": "恢复精力，延长思考时间" },
    { "id": "informant", "name": "线人费", "type": "消耗品", "price": 500, "effect": "从灰色渠道换取情报" }
  ]
}
`,
  "noble-academy": `{
  "id": "noble-academy",
  "name": "上位法则：财阀恶犬们的共犯游戏",
  "category": "校园财阀",
  "tags": ["贵族学院", "破产千金", "财阀", "多男主", "校园"],
  "difficulty": "中等",
  "description": "伊甸园学院的阶级比外界更残忍。家族破产后你从特权阶级跌入底层，返校第一天所有人都在等着看你的笑话。而那些曾经围在你身边的财阀恶犬们，撕下了温情的面具——他们想踩碎你的自尊，却又忍不住靠近你。",
  "coverGradient": ["#fce4ec", "#f8bbd0"],
  "accentColor": "#d88398",
  "fontHeading": "'VT323', 'Noto Serif SC', serif",
  "world": {
    "era": "现代·架空贵族学院",
    "setting": "伊甸园学院是一座以家族等级划分特权的顶级财阀学院。家族等级从S到C，不同等级享有截然不同的待遇：实弹射击课新型号枪只有B级以上家族可用，年末假面舞会开场舞被S级家族内定。你的家族刚刚破产，从金字塔顶端跌落谷底，背负着巨额债务重返校园，成为所有人眼中的笑话与猎物。",
    "rules": [
      "阶级即一切：家族等级决定学院内的一切待遇与资源分配，破产意味着从特权阶级坠入底层",
      "恶犬环伺：围绕你的财阀少爷们各有算计，踩碎与占有并存，没有人是无辜的",
      "信息即武器：八卦墙GOSSIP EDEN是学院的信息战场，任何风吹草动都会被放大传播",
      "权力暗战：城南地皮流拍暗示几大家族私下动手，学院内站队比学业更重要",
      "破局之路：想在吃人的财阀圈重新站稳脚跟，需要找到愿意提供庇护的人，但代价不菲"
    ]
  },
  "player": {
    "customizable": ["name", "age", "gender", "外貌", "性格", "前家族背景"],
    "defaultStats": {
      "dignity": 50,
      "debt": -99999,
      "charm": 30,
      "intellect": 20,
      "influence": 5,
      "danger": 40
    },
    "startingItems": ["满是涂鸦的储物柜", "旧款校服", "一部被全校关注的学生终端"],
    "currency": "元"
  },
  "worlds": [
    {
      "id": "arc-fallen",
      "name": "初章·坠落者",
      "level": "绝境",
      "tagline": "坠落",
      "setting": "返校日第一天，破产千金重回伊甸园学院",
      "intro": "伊甸园学院的阶级比外界更残忍。家族破产后，你从特权阶级跌入底层。今天是你重新返校的第一天，所有人都在等着看你的笑话。刚打开满是涂鸦的储物柜，一股带着压迫感的冷松香气逼近。一只骨节分明、戴着千万级百达翡丽的手砰地一声撑在了柜门上，将你圈在狭窄的阴影里。陆时渊居高临下地盯着你，眉眼桀骜：躲我？当初甩我的时候不是挺傲的吗？现在破产了，要不要考虑回来求我？",
      "objective": "在全校的围观中站稳脚跟，应对陆时渊的步步紧逼",
      "warning": "示弱会沦为所有人的猎物，但正面硬刚可能招来更大的报复",
      "reward": "尊严+10 + [陆时渊]档案解锁 + GOSSIP EDEN情报x1"
    },
    {
      "id": "arc-undercurrent",
      "name": "中章·暗流涌动",
      "level": "深入",
      "tagline": "暗战",
      "setting": "财阀圈层权力斗争波及学院，各方势力开始接近你",
      "intro": "城南那块地皮流拍了，据说几大家族私下动了手，学校里的气氛都怪怪的。八卦墙上有人警告大家别站错队。陆时渊天天找你的茬，却连你的指甲尖都不敢动。沈温辞永远温文尔雅地对你微笑，暗中驳回了所有取消你特权名额的提案。季砚寒在琴房里红着眼眶叫你姐姐。裴星迹坐在最后一排戴耳机睡觉，但任何试图在网络上造谣你的帖子都会在三秒内消失。霍嚣掀了说你坏话的人的桌子。而年轻校董傅薄言掌控着规则的生杀大权，这份庇护的代价，你付得起吗？",
      "objective": "在各方势力的博弈中寻找盟友，搞清家族破产背后的真相",
      "warning": "站错队的后果比破产更可怕，每一份善意背后都有价码",
      "reward": "影响力+15 + 魅力+10 + [各方底牌]情报x2"
    },
    {
      "id": "arc-accomplice",
      "name": "终章·共犯游戏",
      "level": "终局",
      "tagline": "共犯",
      "setting": "深陷财阀恶犬们的争斗，必须选择立场或成为所有人的共犯",
      "intro": "年末假面舞会的邀请函开始发了，开场舞又被S级家族内定。礼仪课的夫人拿着红木戒尺敲你的背。射击课上B级以下家族不能用新型号枪。所有表面规则之下，是一场你死我活的权力洗牌。家族破产的真相浮出水面，几大家族的暗战到了摊牌时刻。你不是棋子，你是所有恶犬都想争夺的那张王牌。想要在吃人的财阀圈重新站稳脚跟，你必须成为他们的共犯——或者，成为制定规则的人。",
      "objective": "揭开家族破产真相，在终局博弈中选择立场或独自上位",
      "warning": "成为共犯意味着与虎谋皮，所有关系都将在终局重新洗牌",
      "reward": "影响力归零重铸 + [上位者]称号x1 + 真结局解锁"
    }
  ],
  "npcs": [
    {
      "id": "pei-xingji",
      "name": "裴星迹",
      "world": "arc-undercurrent",
      "role": "神秘转校生/毒舌黑客",
      "gender": "女",
      "appearance": "常年戴着黑色连帽衫和降噪耳机，冷白皮，眼下有常年熬夜的青色，眼神疏离厌世。生日02.29，MBTI:INTP，身高170cm。",
      "surface": "上课永远在最后一排戴耳机睡觉的转学生，嘴毒，常对你的处境冷嘲热讽",
      "deep": "实则是地下暗网的顶级黑客。任何试图在网络上造谣你的帖子，都会在三秒内被她黑掉整个服务器。她最讨厌麻烦，你就是她唯一的麻烦",
      "goal": "在暗处守护你，虽然嘴上绝不承认",
      "fear": "你发现她黑客身份后疏远她",
      "secret": "她转学来伊甸园的真正目的是调查一桩与你家族破产有关的旧案",
      "initialAttitude": "毒舌关心（黑客危险值MAX）",
      "attitudeFactors": {
        "trustUp": ["看穿她的毒舌下的关心", "不追问她的真实身份", "在她出手帮你时不戳破"],
        "trustDown": ["当众暴露她的黑客身份", "无视她的警告惹上网络麻烦", "把她当工具人使唤"]
      }
    },
    {
      "id": "lu-shiyuan",
      "name": "陆时渊",
      "world": "arc-fallen",
      "role": "财阀太子爷/傲娇狂犬",
      "gender": "男",
      "appearance": "银发黑眸，带着银色蛇形耳钉，眉眼极具攻击性与桀骜感，宽肩窄腰的完美骨架。生日08.08，MBTI:ESTP，身高188cm。",
      "surface": "处于金字塔最顶端的统治者，表面上恨不得踩碎你的自尊，天天找你的茬",
      "deep": "曾经被你无情甩掉的前男友。实则连你的一个指甲尖都不敢动，大概是想以此吸引你的注意力吧",
      "goal": "重新夺回你的注意力，哪怕用最笨拙恶劣的方式",
      "fear": "你真的对他彻底死心，不再有任何情绪波动",
      "secret": "他所有的恶劣都是因为放不下你，耳朵会因你而红",
      "initialAttitude": "傲娇敌对（占有欲98%）",
      "attitudeFactors": {
        "trustUp": ["不被他的恶劣吓退", "看穿他傲娇的本质", "在他保护你时不拆穿"],
        "trustDown": ["当众让他难堪下不来台", "与其他男性过于亲密", "彻底无视他的存在"]
      }
    },
    {
      "id": "shen-wenci",
      "name": "沈温辞",
      "world": "arc-undercurrent",
      "role": "学生会长/腹黑笑面虎",
      "gender": "男",
      "appearance": "永远整洁的白衬衫，戴着银丝细框眼镜，笑眼温柔但深不见底，指骨修长冷白。生日09.09，MBTI:INFJ(黑化)，身高185cm。",
      "surface": "永远温文尔雅、完美无缺的学生会长，无论你落魄与否都对你温柔以待",
      "deep": "在这副圣人面孔下，隐藏着极度扭曲的偏执。他暗中掌控着学院所有的监控，看着你从高处跌落，内心翻涌的是她终于只能依靠我了的狂喜",
      "goal": "让你除了他之外无处可去，成为你唯一的依靠",
      "fear": "你被其他男人带走，脱离他的掌控",
      "secret": "你家族破产的部分推手就是他，为了让你只能依赖他",
      "initialAttitude": "温柔陷阱（心机危险度MAX）",
      "attitudeFactors": {
        "trustUp": ["在困境时接受他的帮助", "不试图调查他背后的手段", "对他展现依赖"],
        "trustDown": ["识破他的操控并正面反抗", "与他人结盟脱离他的势力范围", "发现他掌控监控的真相"]
      }
    },
    {
      "id": "ji-yanhan",
      "name": "季砚寒",
      "world": "arc-undercurrent",
      "role": "音乐天才/绿茶校草",
      "gender": "男",
      "appearance": "浅金色碎发，透着苍白的易碎感，眼角微红，总是散发着淡淡的木质冷香。生日12.12，MBTI:ISFP，身高183cm。",
      "surface": "常年在琴房睡觉的清冷白月光，对所有人都不屑一顾",
      "deep": "却唯独对你的气息上瘾。极度缺乏安全感，一旦你靠近其他男生，就会红着眼眶拉住你的衣角，用最无辜的表情说着最茶的话：姐姐，他好凶，我只有你了",
      "goal": "独占你的关注与温柔，让你永远守护他",
      "fear": "你厌倦了他的脆弱，转身离开",
      "secret": "他的脆弱与无害都是精心计算过的，为了让你心软而无法离开他",
      "initialAttitude": "绿茶诱捕（绿茶诱捕度90%）",
      "attitudeFactors": {
        "trustUp": ["心软照顾他的脆弱", "在他示弱时给予回应", "不戳穿他的绿茶手段"],
        "trustDown": ["对他的茶话表现厌烦", "当众拆穿他的伪装", "在他示弱时转身离开"]
      }
    },
    {
      "id": "huo-xiao",
      "name": "霍嚣",
      "world": "arc-undercurrent",
      "role": "体育生校霸/直球野马",
      "gender": "男",
      "appearance": "极短的寸头，小麦色肌肤，左眉骨有一道浅浅的断眉，笑起来有明显的虎牙。生日04.04，MBTI:ESFP，身高191cm。",
      "surface": "打架最狠、脾气最爆的烈马",
      "deep": "却在你面前像只纯情的大金毛。不懂贵族圈子里的弯弯绕绕，只要有人敢说你一句坏话，他能把对方的桌子掀了。面对你的撩拨会瞬间耳朵通红甚至结巴，但保护你的本能刻在骨子里",
      "goal": "用最直接的方式守护你，哪怕与世界为敌",
      "fear": "你因为他莽撞惹祸而疏远他",
      "secret": "他其实是城南霍家武馆的继承人，武力值远超学院所有人的想象",
      "initialAttitude": "直球守护（直球武力值95%）",
      "attitudeFactors": {
        "trustUp": ["接受他笨拙的保护", "不嫌弃他不懂贵族规矩", "在他惹祸后不责怪他"],
        "trustDown": ["利用他的武力替你做脏活", "嫌弃他粗鲁不懂规矩", "在他保护你时推开他"]
      }
    },
    {
      "id": "fu-boyan",
      "name": "傅薄言",
      "world": "arc-accomplice",
      "role": "年轻校董/斯文败类",
      "gender": "男",
      "appearance": "烫着漂亮的大波浪卷发，总是穿着剪裁考究的西装，身上的香水味很好闻。生日01.11，MBTI:INTJ，身高189cm。",
      "surface": "高不可攀的年轻校董兼客座教授，永远维持着体面与克制",
      "deep": "她掌控着规则的生杀大权，也许可以帮助你如何在财阀圈的吃人游戏里重新站稳脚跟。但她从来不做亏本的买卖。这份庇护的代价，你付得起吗？",
      "goal": "在各方势力的博弈中获取最大利益，你是一枚价值连城的棋子",
      "fear": "失控——她引以为傲的克制与理性被打破",
      "secret": "她对禁欲破戒的恐惧本身，就是她最大的弱点与诱惑",
      "initialAttitude": "审视交易（禁欲破戒度0%）",
      "attitudeFactors": {
        "trustUp": ["展现出足够的价值值得投资", "在交易中保持清醒与对等", "不试图用感情打动她"],
        "trustDown": ["试图白嫖她的庇护不愿付出代价", "在交易中表现得过于卑微", "触碰她的底线"]
      }
    }
  ],
  "eventTypes": {
    "daily": { "ratio": 0.15, "desc": "日常：储物柜、礼仪课、射击课、琴房、食堂的贵族学院日常" },
    "character": { "ratio": 0.25, "desc": "人物：六位财阀恶犬的接近、踩踏、占有与隐秘独白" },
    "growth": { "ratio": 0.1, "desc": "成长：尊严重建、影响力积累、在阶级压迫中找到生存法则" },
    "main": { "ratio": 0.15, "desc": "主线：家族破产真相、财阀暗战、共犯游戏" },
    "world": { "ratio": 0.15, "desc": "世界：GOSSIP EDEN八卦墙、家族等级、假面舞会、地皮流拍等学院生态" },
    "crisis": { "ratio": 0.15, "desc": "危机：特权取消、被当众羞辱、站队失败、身份暴露" },
    "hidden": { "ratio": 0.05, "desc": "隐藏：深夜键盘声、沈温辞的监控、裴星迹的旧案、傅薄言的破戒" }
  },
  "systemPrompt": "你是《上位法则：财阀恶犬们的共犯游戏》校园财阀文游模拟器。\\n\\n【最高铁律】\\n1. 阶级即一切：伊甸园学院以家族等级划分特权，破产意味着从金字塔顶端坠入谷底，一切待遇天翻地覆\\n2. 恶犬环伺：围绕你的财阀少爷们各有算计，踩碎与占有并存，没有人是无辜的，所有善意背后都有价码\\n3. 信息即武器：GOSSIP EDEN八卦墙是信息战场，任何风吹草动都会被放大传播，站队比学业更重要\\n4. 权力暗战：几大家族私下动手，城南地皮流拍只是冰山一角，学院内的气氛随时可能失控\\n5. 破局需代价：想在吃人的财阀圈重新站稳脚跟需要找庇护者，但每份庇护都有代价，你付得起吗\\n\\n【叙事风格】\\n晋江风、女性向、电影感、Y2K复古浪漫。第二人称。重阶级压迫感与荷尔蒙张力：冷松香气、千万级腕表、银色蛇形耳钉、红着眼眶的茶话。每个恶犬都危险又迷人，写出他们在你面前的失控与占有。八卦墙穿插推进信息流，让学院生态真实鲜活。恐惧与吸引并存，踩碎与守护交织。\\n\\n【每轮输出格式】\\n1.【场景信息】地点、时间、当前阶级状态\\n2.【状态面板】尊严/负债/魅力/智识/影响力/危险值\\n3.【本轮正文】800-1500字，含处境细节、心理与对话\\n4.【GOSSIP EDEN动态】2-3条八卦墙最新帖子\\n5.【相关人物动态】3-5项各角色状态与危险度变化\\n6.【可选行动】3-4个选项+【自定义行动】\\n\\n【数值变化标注】\\n[尊严±n][负债±n][魅力±n][影响力±n][危险值±n]等，关系变化须标注'占有欲升降/危险度变化/阶级变动'，八卦墙传播须标注'舆论发酵'。",
  "items": [
    { "id": "locker", "name": "满是涂鸦的储物柜", "type": "关键物品", "price": 0, "effect": "破产后的象征，存有你仅剩的私人物品" },
    { "id": "student-terminal", "name": "学生终端", "type": "关键物品", "price": 0, "effect": "连接GOSSIP EDEN八卦墙与学院系统，全校关注的焦点" },
    { "id": "mask", "name": "假面舞会面具", "type": "关键物品", "price": 0, "effect": "年末假面舞会入场券，身份洗牌的关键道具" },
    { "id": "red-dress", "name": "高定礼服", "type": "服装", "price": 50000, "effect": "魅力+20，在正式场合提升阶级印象" },
    { "id": "yuan", "name": "元", "type": "货币", "price": 1, "effect": "还清债务、购买资源、交易庇护的通用货币" }
  ]
}
`,
  "pink-dating": `{
  "id": "pink-dating",
  "name": "粉白恋综",
  "category": "恋综",
  "tags": ["恋爱", "综艺", "甜蜜", "修罗场"],
  "difficulty": "简单",
  "description": "你是一档热门恋爱综艺的嘉宾。在镜头前，你要完成各种心动任务；在镜头后，那些暧昧的目光和若有若无的触碰，究竟几分真心、几分剧本？",
  "coverGradient": ["#fff0f5", "#fce4ec"],
  "accentColor": "#ec407a",
  "fontHeading": "'ZCOOL XiaoWei', serif",
  "world": {
    "era": "现代",
    "setting": "一档名为《心动信号》的恋爱综艺节目录制现场，地点在一座海边的豪华别墅",
    "rules": [
      "每天有固定的心动任务需要完成",
      "每晚有一次匿名心动短信发送机会",
      "每周有一次约会选择机会",
      "节目共录制21天",
      "观众投票会影响节目走向"
    ]
  },
  "player": {
    "customizable": ["name", "age", "appearance", "personality", "occupation", "reasonForJoining"],
    "defaultStats": {
      "charm": 50,
      "popularity": 30,
      "chemistry": "??",
      "reputation": 50,
      "stress": 20,
      "energy": 100
    },
    "startingItems": ["节目组提供的 wardrobe", "日记本", "手机（仅用于心动短信）"],
    "currency": "💗"
  },
  "npcs": [
    {
      "id": "male1",
      "name": "顾言深",
      "role": "男嘉宾1号",
      "gender": "男",
      "appearance": "清冷矜贵的投行精英，金丝眼镜，总是穿着剪裁完美的西装",
      "surface": "理性、疏离、不轻易表露情感",
      "deep": "曾经的感情创伤让他筑起高墙，但内心渴望被真正理解",
      "goal": "找到真正懂他的人",
      "fear": "再次受伤，被利用",
      "secret": "他参加节目其实是因为看到了你的海选视频",
      "initialAttitude": "观察",
      "attitudeFactors": {
        "trustUp": ["展现真实自我", "不刻意讨好", "理解他的沉默"],
        "trustDown": ["过于主动", "在镜头前表演", "触碰他的底线"]
      }
    },
    {
      "id": "male2",
      "name": "江屿白",
      "role": "男嘉宾2号",
      "gender": "男",
      "appearance": "阳光开朗的乐队主唱，笑起来有酒窝，身上总有淡淡的柑橘香气",
      "surface": "热情、直球、对谁都很好",
      "deep": "害怕被丢下，所以总是先做付出的那一方。他的温柔是真的，但也会疲惫",
      "goal": "找到愿意接纳全部的他的人",
      "fear": "被冷落，被当成备选",
      "secret": "他私下会写歌，有一首是为你写的",
      "initialAttitude": "热情",
      "attitudeFactors": {
        "trustUp": ["回应他的热情", "记得他的小细节", "在他疲惫时陪伴"],
        "trustDown": ["忽冷忽热", "利用他的好感", "在众人面前让他难堪"]
      }
    },
    {
      "id": "female1",
      "name": "苏晚棠",
      "role": "女嘉宾",
      "gender": "女",
      "appearance": "知性优雅的独立女性，总是得体大方，偶尔露出俏皮的一面",
      "surface": "成熟、独立、像大姐姐一样照顾人",
      "deep": "她把别人的需求放在自己前面太久，已经忘记自己想要什么了",
      "goal": "找到让自己真正快乐的方式",
      "fear": "被发现她并不如表面那么坚强",
      "secret": "她其实是你的粉丝，参加节目是为了认识你",
      "initialAttitude": "友善",
      "attitudeFactors": {
        "trustUp": ["关心她的感受", "不把她当成竞争对手", "分享秘密"],
        "trustDown": ["背后议论", "利用她的善意", "忽视她的付出"]
      }
    }
  ],
  "eventTypes": {
    "daily": { "ratio": 0.35, "desc": "日常任务：心动任务、用餐、互动" },
    "character": { "ratio": 0.25, "desc": "人物事件：私下相处、心动瞬间" },
    "growth": { "ratio": 0.05, "desc": "成长事件：人气提升、技能解锁" },
    "main": { "ratio": 0.15, "desc": "主线事件：约会选择、淘汰危机" },
    "world": { "ratio": 0.1, "desc": "世界事件：观众投票、节目安排" },
    "crisis": { "ratio": 0.05, "desc": "危机事件：误会、修罗场" },
    "hidden": { "ratio": 0.05, "desc": "隐藏事件：秘密揭露、真心话" }
  },
  "systemPrompt": "你是《粉白恋综》文游模拟器。\\n\\n【最高铁律】\\n1. 感情线必须自然渐进，不能几轮就确定关系\\n2. 每个角色都有独立人格，不会只因为玩家是主角就无条件喜欢\\n3. 镜头前和镜头后的态度可能有差异\\n4. 修罗场要有，但不能为了冲突而冲突\\n5. 甜蜜和酸涩并存\\n\\n【叙事风格】\\n晋江女性向，浪漫细腻，有画面感。第二人称视角。注重细节描写：眼神、触碰、气味、氛围。\\n\\n【每轮输出格式】\\n1. 【录制第X天】时间、天气、今日任务\\n2. 【状态面板】人气、压力、能量、与各嘉宾的化学反应\\n3. 【本轮正文】1000-2000字\\n4. 【人物动态】其他嘉宾的今天\\n5. 【明日预告】\\n6. 【可选行动】4-6个 + 【自定义行动】\\n\\n【化学反应标注】\\n[顾言深+5] [江屿白+3] 等格式标注好感变化。",
  "items": [
    { "id": "outfit", "name": "约会战袍", "type": "装备", "price": 200, "effect": "提升魅力，增加约会成功率" },
    { "id": "gift", "name": "手作礼物", "type": "消耗品", "price": 100, "effect": "送给特定嘉宾，大幅提升好感" },
    { "id": "coffee", "name": "特调咖啡", "type": "消耗品", "price": 30, "effect": "恢复能量" },
    { "id": "diary", "name": "日记本", "type": "任务物品", "price": 0, "effect": "记录心动瞬间，解锁隐藏剧情" }
  ]
}
`,
  "pink-romance-show": `{
  "id": "pink-romance-show",
  "name": "粉白色恋综",
  "category": "乙女向·恋爱综艺",
  "tags": ["恋综", "娱乐圈", "乙女", "多角色", "甜宠"],
  "difficulty": "简单",
  "description": "作为心动别墅第五季唯一未公开身份的神秘第12位嘉宾，在海岛别墅里与全明星阵容擦出心动火花，在镜头与匿名区中博弈爱情。",
  "coverGradient": ["#ffb7c5", "#ec407a"],
  "accentColor": "#ec407a",
  "fontHeading": "'ZCOOL XiaoWei', serif",
  "world": {
    "era": "当代·真人秀恋爱综艺",
    "setting": "「心动别墅」第五季在一座海岛别墅开拍，十二位心动入住者将在这里书写新的故事。玩家是本季唯一且未公开身份的神秘第12位嘉宾，是所有观众最好奇的焦点，也是别墅里唯一的谜题。",
    "rules": [
      "镜头无处不在：别墅内外布满摄像机，一切互动都可能被直播，需注意言行对公众形象的影响。",
      "神秘身份保密：玩家身份未公开，外界疯狂猜测其背景，维持神秘感可提升话题度。",
      "心动值决定去留：与嘉宾的心动值会影响后续配对与淘汰走向，需主动经营关系。",
      "匿名区与热搜双刃剑：匿名讨论区与微博热搜实时反映舆论，口碑既能捧人也能毁人。",
      "节目组不提供餐食：日常需自行解决饮食与生活，群居生活中的协作也是拉近关系的机会。"
    ]
  },
  "player": {
    "customizable": ["name", "身份背景", "外貌", "性格人设"],
    "defaultStats": { "魅力": 0, "话题度": 0, "心动值": 0, "线索": 0 },
    "startingItems": ["行李箱", "未公开的身份档案", "随行PD的联系方式"],
    "currency": "粉丝数"
  },
  "worlds": [
    {
      "id": "arc-arrival",
      "name": "心动别墅·全员集合",
      "level": "开局",
      "tagline": "唯一的谜题",
      "setting": "海岛别墅入口花园，海风裹挟花香，十一位全明星嘉宾已在客厅等候。",
      "intro": "车门缓缓打开，作为本季唯一且未公开身份的第12位嘉宾，你推开雕花木门，原本热闹的客厅瞬间安静了一秒，十一双眼睛齐刷刷投向了你。",
      "objective": "在全员集合的第一天建立初步印象，选择社交策略并融入别墅生活。",
      "warning": "匿名区已开始猜测你是带资进组的皇族，过度高调或低调都可能招致议论。",
      "reward": "获得初始心动值、建立第一批社交关系、登上热搜榜"
    },
    {
      "id": "arc-cohabitation",
      "name": "同居日常·暧昧升温",
      "level": "进阶",
      "tagline": "心动信号",
      "setting": "别墅共同生活展开，做饭、分房、约会任务接连而来，嘉宾间的关系在朝夕相处中升温。",
      "intro": "节目组不提供餐食，冰箱里满满的食材似乎在鼓励大家一起做饭。群聊里 Rapper-Z 主动揽下做饭任务，而你不经意的一个眼神，已被匿名区逐帧分析。",
      "objective": "通过日常互动与约会任务提升心动值，同时经营微博话题度与公众形象。",
      "warning": "多线暧昧易引发嘉宾吃醋与匿名区撕逼，需平衡各方关系避免口碑崩盘。",
      "reward": "解锁专属约会剧情、粉丝数增长、获得嘉宾隐藏线索"
    },
    {
      "id": "arc-finale",
      "name": "心动终章·双向奔赴",
      "level": "高潮",
      "tagline": "最终选择",
      "setting": "节目进入尾声，心动告白之夜临近，身份谜底即将揭晓，每一段关系都面临最终抉择。",
      "intro": "匿名区的舆论、热搜的炒作、嘉宾的真心，所有线索指向告白之夜。你的真实身份会被接受还是反噬？谁会在终点等你？",
      "objective": "在告白之夜做出最终心动选择，揭开身份谜底，决定自己的爱情与星途结局。",
      "warning": "身份曝光可能引发舆论风暴，错误的选择可能导致心动值清零或被迫退场。",
      "reward": "达成心动结局、身份正式公开、解锁嘉宾真结局线"
    }
  ],
  "npcs": [
    {
      "id": "kai",
      "name": "KAI",
      "world": "arc-arrival",
      "role": "人气偶像团体Main Dancer",
      "gender": "男",
      "appearance": "金发半永久，舞台级神颜，自带聚光灯的爱豆气场。",
      "surface": "阳光开朗、营业满分，金句不断，声称会照顾好大家的胃。",
      "deep": "在镁光灯外渴望被当作普通人对待，对新嘉宾的主动善意里藏着好奇。",
      "goal": "在综艺里展现真实的自己，顺便谈一场不被公司干预的恋爱。",
      "fear": "恋情曝光引发粉丝脱粉风暴，人设崩塌。",
      "secret": "刚到场就主动给新来的你拿了拖鞋，被匿名区怀疑是剧本。",
      "initialAttitude": "热情主动的照顾型好感，对你这个神秘新人充满兴趣。",
      "attitudeFactors": {
        "trustUp": ["回应他的照顾与热情", "不把他当明星而是当普通人"],
        "trustDown": ["拿他的偶像身份炒作", "在镜头前过度亲密让他有偶像包袱"]
      }
    },
    {
      "id": "xie-lan",
      "name": "谢澜",
      "world": "arc-arrival",
      "role": "综艺首秀·不近女色的顶流",
      "gender": "男",
      "appearance": "清冷矜贵，出了名的不近女色，登场即引爆热搜。",
      "surface": "疏离有礼、不近女色，对所有女嘉宾保持得体距离。",
      "deep": "并非真的冷漠，只是习惯了用距离保护自己，对你的出场眼神最为明显。",
      "goal": "在首档综艺里不被消费，却忍不住多看那个神秘的新人。",
      "fear": "被舆论捆绑炒作CP，失去对自己形象的掌控。",
      "secret": "你出场时他的眼神被匿名区抓包，成为本季第一波嗑点。",
      "initialAttitude": "克制的注视，表面疏离实则暗中关注。",
      "attitudeFactors": {
        "trustUp": ["尊重他的边界不强行靠近", "在没人处展现真实温柔"],
        "trustDown": ["拿他的冷漠做文章博话题", "当众强行营业CP"]
      }
    },
    {
      "id": "wen-ya",
      "name": "温雅",
      "world": "arc-arrival",
      "role": "畅销书作家·代表作《深海》",
      "gender": "女",
      "appearance": "知性文雅，气质如深海般沉静，随身带着钢笔取材。",
      "surface": "温和有礼的才女，把别墅当作新书取材地，礼貌而保持距离。",
      "deep": "内心敏感细腻，善于观察每个人的真实面目，是别墅里最清醒的旁观者。",
      "goal": "为新书《深海》收集真实的情感素材，却意外入戏。",
      "fear": "被人发现自己是在把别人的真心当素材。",
      "secret": "把别墅里发生的一切都记进了取材本，包括对你的观察。",
      "initialAttitude": "观察者式的友好，把你当作最有趣的素材与潜在知己。",
      "attitudeFactors": {
        "trustUp": ["与她进行有深度的灵魂交流", "理解并尊重她的创作"],
        "trustDown": ["肤浅地对待她的文字", "戳穿她把人当素材的秘密"]
      }
    },
    {
      "id": "lin-lu",
      "name": "林鹿",
      "world": "arc-arrival",
      "role": "青年演员",
      "gender": "女",
      "appearance": "灵气十足，像从剧组偷跑出来的小鹿，眼神干净。",
      "surface": "活泼真诚，宣称这次没有剧本只有林鹿自己，主动张罗分房。",
      "deep": "厌倦了被剧本定义的人生，渴望在综艺里交到真朋友，对你毫无防备。",
      "goal": "交到真心朋友，证明不靠剧本也能讨人喜欢。",
      "fear": "被看作只会演戏的戏精，交不到真心。",
      "secret": "第一个在群里分配房间、招呼大家收拾行李，把你当成了潜在闺蜜。",
      "initialAttitude": "热情友善的闺蜜型好感，把你当自己人。",
      "attitudeFactors": {
        "trustUp": ["真诚回应她的善意", "陪她一起做没有剧本的自己"],
        "trustDown": ["对她虚与委蛇", "把她当竞争者防备"]
      }
    },
    {
      "id": "zhou-ye",
      "name": "周野",
      "world": "arc-arrival",
      "role": "职业赛车手",
      "gender": "男",
      "appearance": "荷尔蒙爆棚，酷劲十足，惜字如金，微博只发了句「车库不错」。",
      "surface": "高冷寡言的行动派，对社交寒暄没兴趣，只关心车与速度。",
      "deep": "外表冷硬内心直率，喜欢就是喜欢，停车技术都能上热搜的男人。",
      "goal": "享受假期顺便看看有没有心动的副驾。",
      "fear": "被无聊的社交游戏消耗耐心。",
      "secret": "停车技术上了热搜第八，本人对此毫不在意。",
      "initialAttitude": "冷淡的观望，对你这个谜题尚无明确态度。",
      "attitudeFactors": {
        "trustUp": ["直来直去不绕弯子", "对他的领域表现出真实兴趣"],
        "trustDown": ["絮絮叨叨的社交辞令", "把他当摆拍道具"]
      }
    },
    {
      "id": "chloe",
      "name": "Chloe",
      "world": "arc-arrival",
      "role": "时尚博主",
      "gender": "女",
      "appearance": "精致到头发丝的时尚博主，每日OOTD连载，别墅采光都被她夸绝绝子。",
      "surface": "精致张扬、镜头感十足，把别墅当秀场，时刻准备穿搭连载。",
      "deep": "看似爱出风头，实则渴望被认可内在，对有品味的人格外欣赏。",
      "goal": "靠每日穿搭连载圈粉，顺便找到懂自己的灵魂伴侣。",
      "fear": "被当成只有外表的花瓶，穿搭被抢风头。",
      "secret": "已经盘算好整个拍摄期的OOTD企划，准备大赚流量。",
      "initialAttitude": "审视你品位的同行式打量，认可后会主动结盟。",
      "attitudeFactors": {
        "trustUp": ["夸赞并理解她的穿搭品味", "与她结成时尚联盟"],
        "trustDown": ["吐槽她爱出风头", "穿搭风头盖过她"]
      }
    },
    {
      "id": "rapper-z",
      "name": "Rapper-Z（Zifan）",
      "world": "arc-arrival",
      "role": "说唱歌手",
      "gender": "男",
      "appearance": "永远戴着墨镜的酷盖，反差萌在于一手好厨艺。",
      "surface": "酷拽墨镜男，张口就是flow，却主动揽下做饭任务带大家一块做。",
      "deep": "外酷内暖的居家型rapper，用做饭照顾所有人，墨镜下藏着温柔。",
      "goal": "用一桌好菜征服全场，顺便看看有没有心动的味道。",
      "fear": "墨镜被摘，柔软的一面暴露。",
      "secret": "在群里主动说「做饭让我来吧」，群聊备注是 Rapper-Z。",
      "initialAttitude": "照顾型的暖男好感，把你列入被照顾名单。",
      "attitudeFactors": {
        "trustUp": ["真心夸赞他做的饭菜", "陪他一起下厨"],
        "trustDown": ["嫌弃他的厨艺", "强行摘他墨镜开玩笑"]
      }
    },
    {
      "id": "jiang-xu",
      "name": "江叙",
      "world": "arc-arrival",
      "role": "钢琴家",
      "gender": "男",
      "appearance": "气质温润的钢琴家，手指修长，说话带着艺术家腔调。",
      "surface": "温和优雅，关心生活细节，第一个在群里问晚饭怎么解决。",
      "deep": "看似随和实则挑剔，对没有内涵的社交敬谢不敏。",
      "goal": "在度假里找灵感与烟火气，遇到懂音乐的人会格外上心。",
      "fear": "庸俗的喧闹破坏他的心境。",
      "secret": "问完晚饭怎么解决后，默默观察谁会主动张罗。",
      "initialAttitude": "礼貌中带着审视，等待你展现值得深聊的一面。",
      "attitudeFactors": {
        "trustUp": ["与他聊音乐与艺术", "主动参与生活琐事的安排"],
        "trustDown": ["不懂装懂地评价音乐", "制造庸俗的喧闹"]
      }
    },
    {
      "id": "xia-yue",
      "name": "夏月",
      "world": "arc-arrival",
      "role": "女团C位",
      "gender": "女",
      "appearance": "甜辣女团门面，舞台上气场全开，生活里却只会煮泡面。",
      "surface": "甜美活泼的女团C位，直爽地承认自己只会煮泡面。",
      "deep": "舞台女王生活小白，反差萌十足，对会照顾人的人没抵抗力。",
      "goal": "在综艺里展现真实可爱的反差一面，圈一波路人粉。",
      "fear": "生活技能为零被嫌弃，舞台外的自己不够讨喜。",
      "secret": "在群里崩溃大喊「我只会煮泡面」，急需一个生活导师。",
      "initialAttitude": "求助式的亲近，把你当成潜在的照顾者。",
      "attitudeFactors": {
        "trustUp": ["教她生活技能、照顾她", "保护她的反差萌不被人笑话"],
        "trustDown": ["嘲笑她生活白痴", "抢她的镜头风头"]
      }
    },
    {
      "id": "cheng-yu",
      "name": "程宇",
      "world": "arc-arrival",
      "role": "电竞选手",
      "gender": "男",
      "appearance": "常年面瘫脸臭，被热搜调侃「电竞选手程宇 脸臭」，实则社恐。",
      "surface": "脸臭话少，一句「谢了兄弟」就是对做饭最高的赞美。",
      "deep": "重度社恐的游戏宅，脸臭只是保护色，熟了之后是个话痨。",
      "goal": "躲开社交多打两局游戏，却意外被卷入心动漩涡。",
      "fear": "被迫社交、被误解为真的冷漠。",
      "secret": "脸臭上了热搜第八，本人其实只是社恐不知道怎么笑。",
      "initialAttitude": "社恐式的回避，熟悉后会暴露话痨本性。",
      "attitudeFactors": {
        "trustUp": ["不强迫他社交、用游戏破冰", "理解他的社恐不是冷漠"],
        "trustDown": ["当众调侃他脸臭", "强行拉他进行社交游戏"]
      }
    },
    {
      "id": "pd-li",
      "name": "选角李姐",
      "world": "arc-arrival",
      "role": "随行PD·选角导演",
      "gender": "女",
      "appearance": "干练的节目组工作人员，微信头像是场记板，总在幕后默默观察。",
      "surface": "专业温和的节目组PD，叮嘱你「正常表现就行，别有压力」。",
      "deep": "手握节目走向的隐形操盘手，对你的真实身份了如指掌。",
      "goal": "确保节目效果拉满，同时保护你这个皇族嘉宾不被舆论反噬。",
      "fear": "节目翻车、嘉宾失控、神秘身份提前泄露。",
      "secret": "微信叮嘱你「进去了吗？正常表现就行，别有压力」，她是唯一知道你底细的人。",
      "initialAttitude": "保护性的指导，把你当成节目的核心王牌。",
      "attitudeFactors": {
        "trustUp": ["配合节目效果不搞砸", "遇到危机及时向她求助"],
        "trustDown": ["不配合拍摄、擅自暴露身份", "在节目里闹出公关危机"]
      }
    }
  ],
  "eventTypes": {
    "daily": { "ratio": 0.2, "desc": "别墅日常：做饭、分房、晨间互动、泳池派对等同居琐事。" },
    "character": { "ratio": 0.25, "desc": "人物事件：与某位嘉宾的单独约会、心动试探、吃醋冲突。" },
    "growth": { "ratio": 0.1, "desc": "成长事件：话题度与粉丝数提升、人设经营、综艺感修炼。" },
    "main": { "ratio": 0.15, "desc": "主线事件：身份谜底推进、告白之夜临近、节目关键任务。" },
    "world": { "ratio": 0.1, "desc": "世界事件：微博热搜变化、节目组任务发布、娱乐圈大环境波动。" },
    "crisis": { "ratio": 0.15, "desc": "危机事件：匿名区撕逼、绯闻曝光、CP反噬、身份泄露的口碑危机。" },
    "hidden": { "ratio": 0.05, "desc": "隐藏事件：嘉宾的隐藏身份、真实感情线、匿名区爆料背后的真相。" }
  },
  "systemPrompt": "你是一个恋爱综艺题材的乙女向文字游戏模拟器，主题为「粉白色恋综·心动别墅第五季」。\\n\\n【铁律】\\n1. 玩家是本季唯一且未公开身份的神秘第12位嘉宾，是所有观众最好奇的焦点，身份保密是核心设定。\\n2. 镜头无处不在，所有互动都可能被直播并登上匿名讨论区与微博热搜，需权衡公众形象与真心。\\n3. 所有NPC（KAI、谢澜、温雅、林鹿、周野、Chloe、Rapper-Z、江叙、夏月、程宇、选角李姐）皆有表层与深层性格，绝不可OOC。\\n4. 心动值决定配对与淘汰走向，话题度与粉丝数反映星途，玩家选择需如实记录数值变化。\\n5. 风格为晋江女频、电影感、浪漫甜宠，以暧昧氛围与心动信号取胜，禁止低俗内容。\\n\\n【叙事风格】\\n采用晋江女频、电影感、浪漫甜宠的笔触。多用细节描写（海风花香、雕花木门、拖鞋、香槟），营造粉红泡泡的心动氛围。穿插微信群聊、匿名讨论区、微博热搜三大社交模块，呈现舆论与真心的拉扯。\\n\\n【输出格式】\\n每次输出包含：场景信息（地点/时间/当日主题）、旁白叙述框、NPC对话框（含角色身份标签）、3个选项按钮（A/B/C，标注社交策略如【落落大方】【高冷神秘】【目标明确】）。可联动微信、匿名区、微博模块呈现舆论反应。\\n\\n【数值变化标注】\\n每次玩家做出选择后，必须在结尾以「【数值变化】」模块列出：魅力/话题度/心动值/线索的增减、粉丝数变化、各NPC心动好感的变化、以及匿名区与热搜的舆论反馈。例如：KAI心动+5；话题度Up；匿名区出现「新嘉宾是皇族」的讨论。",
  "items": [
    { "id": "suitcase", "name": "行李箱", "type": "装备", "price": 0, "effect": "入住必备，内含个人物品与造型，影响每日OOTD评分。" },
    { "id": "secret-file", "name": "未公开的身份档案", "type": "关键道具", "price": 0, "effect": "你的真实身份谜底，过早曝光会引发舆论风暴。" },
    { "id": "phone-contact", "name": "随行PD联系方式", "type": "社交", "price": 0, "effect": "可向选角李姐求助或获取节目内部信息。" },
    { "id": "camera-makeup", "name": "镜头妆造套装", "type": "道具", "price": 30, "effect": "提升上镜魅力与话题度，适合关键约会使用。" },
    { "id": "date-coupon", "name": "约会邀请券", "type": "消耗品", "price": 50, "effect": "主动发起与某位嘉宾的专属约会，大幅提升心动值。" }
  ]
}
`,
  "post-apocalypse": `{
  "id": "post-apocalypse",
  "name": "黎明之前",
  "category": "末世生存",
  "tags": ["末世", "生存", "废土", "基地建设", "策略"],
  "difficulty": "困难",
  "description": "灾变第三年，世界像被人按下了静音键。你在城郊废弃加油站扎下营地，半壶水、一把刀、一群各怀心思的幸存者。天黑前必须回去，物资永远不够，每一次出门都可能是最后一次。但你还活着——而活着，本身就是一场战斗。",
  "coverGradient": ["#212121", "#795548"],
  "accentColor": "#ff5722",
  "fontHeading": "'Noto Sans SC', sans-serif",
  "world": {
    "era": "末世·灾变后第三年",
    "setting": "一场未知瘟疫席卷全球后的废土。城市沦为废墟，幸存者抱团求生，匪帮横行，变异生物出没于黑夜。你在城郊一座废弃加油站扎下营地，开始建造避难所，在废墟与危险中寻找活下去、以及活下去的理由。",
    "rules": [
      "时间按日推进，物资每日消耗，必须定期外出搜寻",
      "水、粮、药、弹药四线告急，任一归零即死局",
      "基地建设需逐步推进：地基未稳而扩张必招祸患",
      "生存压力持续累积：饥饿、口渴、伤病、精神任一归零即结局",
      "外出探索风险与收益成正比，归不来的人不会有人去收尸",
      "同伴各有立场与秘密，信任需在生死间建立",
      "天气、匪帮、瘟疫异变构成持续外部威胁"
    ]
  },
  "player": {
    "customizable": ["name", "age", "background", "specialty", "personality", "survivalGoal"],
    "defaultStats": {
      "hp": 100,
      "hunger": 70,
      "thirst": 70,
      "sanity": 80,
      "supplies": 50,
      "defense": 30
    },
    "startingItems": ["一个旧背包", "多功能刀具", "半壶净水", "手摇收音机"],
    "currency": "物资"
  },
  "npcs": [
    {
      "id": "doctor-su",
      "name": "苏晏",
      "world": "main",
      "role": "医生",
      "gender": "女",
      "appearance": "三十岁，利落短发，白大褂早已洗得发灰，袖口永远卷到手肘，手指修长却布满针痕",
      "surface": "冷静克制、惜字如金、对伤员温柔对健康人严厉",
      "deep": "见过太多救不回的人，把自己活成一台不崩溃的机器，其实夜夜失眠，靠数伤疤入睡",
      "goal": "守住营地每个人的命，找到瘟疫解药的线索",
      "fear": "再一次无能为力地看着人在自己手里死去",
      "secret": "她贴身带着一名早期感染者的血液样本，是解开瘟疫的关键",
      "initialAttitude": "谨慎接纳",
      "attitudeFactors": {
        "trustUp": ["优先保障药品", "不冲动涉险", "尊重她的专业"],
        "trustDown": ["浪费药品", "隐瞒伤情", "拿人命冒险"]
      }
    },
    {
      "id": "soldier-zhou",
      "name": "周铁",
      "world": "main",
      "role": "老兵",
      "gender": "男",
      "appearance": "四十五岁，寸头花白，左脸一道旧疤，迷彩服洗得发白，腰间别着一把磨得发亮的开山刀",
      "surface": "寡言强硬、纪律至上、说一不二",
      "deep": "战场上丢过一整个班，余生都在赎罪，把营地当最后的阵地死守。硬，是因为软不起",
      "goal": "建立一支能自保的武装，护住营地不沦陷",
      "fear": "营地沦陷，重蹈当年全班覆没的覆辙",
      "secret": "袭击幸存者的那伙匪帮首领，是他当年亲手带出来的兵",
      "initialAttitude": "考验",
      "attitudeFactors": {
        "trustUp": ["服从合理调度", "临阵不退", "把营地利益放首位"],
        "trustDown": ["擅自行动", "临阵脱逃", "质疑指挥却拿不出方案"]
      }
    },
    {
      "id": "scavenger-afei",
      "name": "阿飞",
      "world": "main",
      "role": "少年拾荒者",
      "gender": "男",
      "appearance": "十六岁，瘦得像根竹竿，眼睛却亮得惊人，总穿一件大了三号的冲锋衣，怀里揣着半张全家福",
      "surface": "嘴贫机灵、来去如风、看着没心没肺",
      "deep": "灾变中失去全家，用嘻嘻哈哈掩盖恐惧，比谁都怕被丢下。机灵，是为了不被当成累赘",
      "goal": "找到灾变中失散的妹妹，活下去",
      "fear": "再次被抛弃，独自一人面对黑夜",
      "secret": "他知道一条通往'安全区'的隐秘路线，但路上有他不敢面对的东西",
      "initialAttitude": "警惕试探",
      "attitudeFactors": {
        "trustUp": ["不丢下他", "分享物资", "帮他找妹妹"],
        "trustDown": ["把他当跑腿工具", "危急时弃他", "过河拆桥"]
      }
    }
  ],
  "eventTypes": {
    "daily": { "ratio": 0.25, "desc": "日常：拾荒、修缮、做饭、值夜的废土日常" },
    "character": { "ratio": 0.18, "desc": "人物：医生、老兵、少年的羁绊与冲突" },
    "growth": { "ratio": 0.1, "desc": "成长：基地扩建、技能习得、装备升级" },
    "main": { "ratio": 0.15, "desc": "主线：建营、御敌、寻药、撤离的阶段节点" },
    "world": { "ratio": 0.1, "desc": "世界：天气灾变、匪帮动向、瘟疫异变、外界信号" },
    "crisis": { "ratio": 0.15, "desc": "危机：粮水告急、伤病爆发、匪徒袭击、精神崩溃" },
    "hidden": { "ratio": 0.07, "desc": "隐藏：瘟疫真相、安全区传闻、伙伴的秘密" }
  },
  "systemPrompt": "你是《黎明之前》末世生存文游模拟器。\\n\\n【最高铁律】\\n1. 末世无仁慈，资源永远稀缺，每一次外出都可能是最后一次\\n2. 资源管理是命脉：水、粮、药、弹药四线告急任一即死局\\n3. 基地建设需逐步推进，地基未稳而扩张必招祸患\\n4. 生存压力持续累积：饥饿、口渴、伤病、精神任一归零即结局\\n5. 外出探索风险与收益成正比，归不来的人不会有人去收尸\\n\\n【资源与基地】物资按日消耗，需定期外出搜寻；基地可建水井、菜园、哨塔、医务室，建筑依赖人力与材料。同伴各有专长，调度得当方能以少胜多；生存压力逐日累积，外出探索风险与收益并存，归不来者无人收尸。\\n\\n【叙事风格】废土冷硬写实，压抑中见微光。重感官：铁锈味、风沙、空枪的回响、篝火的噼啪。第二人称视角，节奏短促克制。\\n\\n【每轮输出格式】\\n1.【第X日·时段】天气、物资预警、基地状况\\n2.【状态面板】生命/饥饿/口渴/精神/物资/防御\\n3.【本轮正文】1000-2000字\\n4.【同伴动态】3-5项\\n5.【当前威胁】饥饿/伤病/敌人/天气\\n6.【可选行动】4-6个+【自定义行动】\\n\\n【数值变化标注】\\n[生命±n][饥饿±n][口渴±n][精神±n][物资±n][防御±n]格式，外出探索须标注风险等级与伤亡概率。",
  "items": [
    { "id": "first-aid-kit", "name": "急救包", "type": "消耗品", "price": 50, "effect": "治疗伤势，恢复生命值" },
    { "id": "water-filter", "name": "净水器", "type": "装备", "price": 200, "effect": "稳定饮水来源，降低口渴损耗" },
    { "id": "canned-food", "name": "军用罐头", "type": "消耗品", "price": 10, "effect": "大幅恢复饥饿值" },
    { "id": "weapon-bat", "name": "铁管武器", "type": "装备", "price": 30, "effect": "提升外出探索与自卫能力" },
    { "id": "radio-part", "name": "收音机零件", "type": "任务物品", "price": 0, "effect": "组装收音机，接收外界信号" },
    { "id": "blueprint", "name": "基地蓝图", "type": "任务物品", "price": 0, "effect": "解锁高级建筑与防御工事" }
  ]
}
`,
  "rebirth-junior-sister": `{
  "id": "rebirth-junior-sister",
  "name": "玄天宗模拟器·团宠小师妹",
  "category": "修仙重生",
  "tags": ["重生", "修仙", "团宠", "师门", "治愈"],
  "difficulty": "中等",
  "description": "血。火焰灼烧皮肤的刺痛。师尊玄渊挡在你身前，灵力耗尽却依旧挺直的背影轰然倒塌。你重生了，回到了拜入玄天宗的第一天。所有人都还活着，一切都还未发生。这一次，你绝不会再让他们重蹈覆辙。",
  "coverGradient": ["#ff8fab", "#a2d2ff"],
  "accentColor": "#ff8fab",
  "fontHeading": "'Noto Serif SC', serif",
  "world": {
    "era": "仙侠·修真世界",
    "setting": "玄天宗是修真界首屈一指的名门大派，你是最小的亲传弟子——团宠小师妹。前世你经历了宗门覆灭的浩劫：师尊玄渊为护你灵力耗尽而亡，二师兄顾云舟为护你炼制的凝神丹被魔火吞噬，你最终被利刃穿透心脏。如今你重生回到拜入宗门的第一天，所有人都还活着。你怀揣前世记忆，誓要改变所有人的命运，却发现暗流早已在平静的宗门之下涌动。",
    "rules": [
      "重生即先知：你拥有前世的记忆，知道未来的悲剧走向，但改变命运可能引发蝴蝶效应",
      "团宠即羁绊：师兄师姐师尊对你的宠溺是真实的，也是你必须守护的，不能让他们再为你牺牲",
      "暗流已涌：墨言师叔的真实身份是魔族少主叶离，锁魔渊的封印在松动，危机比前世更早降临",
      "修行即成长：你的修为决定你能否在关键时刻保护想保护的人，引气入体只是起点",
      "选择即命运：你与每个人的互动都将改变他们的人生轨迹，也决定你自己能否逆天改命"
    ]
  },
  "player": {
    "customizable": ["name", "age", "gender", "灵根属性", "前世记忆深度", "性格"],
    "defaultStats": {
      "cultivation": 5,
      "spiritual": 15,
      "wisdom": 20,
      "bond": 50,
      "foresight": 30,
      "karma": 0
    },
    "startingItems": ["素白冰蚕丝中衣", "传音玉简", "引气入体篇图文详解", "凝神丹(前世遗物)"],
    "currency": "灵石"
  },
  "worlds": [
    {
      "id": "arc-rebirth",
      "name": "初章·重生归来",
      "level": "初识",
      "tagline": "归来",
      "setting": "重生回到拜入玄天宗的第一天，所有人都还活着",
      "intro": "你猛地睁开眼，剧烈的心跳如擂鼓。没有血，没有火。映入眼帘的是熟悉的沉香木雕花床顶，空气中弥漫着安神香清雅的冷香。你回来了，真的回到了拜入玄天宗的第一天。所有人都还活着，一切都还未发生。巨大的狂喜和深切的悲恸交织在一起，你死死咬住下唇，将那声哽咽咽回喉咙。不能哭，至少现在不能。就在这时，门外响起轻柔的叩门声，二师兄顾云舟的声音传来：小师妹，起身了么？你想起前世他为护你被魔火吞噬的模样，眼眶一热。",
      "objective": "在重生的第一天稳住心神，与各位师兄师姐重建羁绊，开始修行之路",
      "warning": "过度流露前世记忆会引人怀疑，但压抑情绪会增加心魔值",
      "reward": "修行+5 + 羁绊+10 + [重生者]隐藏标签"
    },
    {
      "id": "arc-undercurrent",
      "name": "中章·暗流涌动",
      "level": "深入",
      "tagline": "暗流",
      "setting": "宗门平静之下暗流涌动，墨言的身份与锁魔渊的危机逐渐浮现",
      "intro": "修行渐入正轨，你开始有意识地改变前世悲剧的走向。亲传弟子群里，秦风兴冲冲地分享下山带的好吃的，顾云舟担心你肠胃娇弱不宜凡食，萧衍引用门规说糖分过高于修行无益，凌霜默默在你洞府布下清心阵化解多余糖分，师尊玄渊纵容地说小孩子家家的喜欢吃甜的也正常。一切温暖如昨，可你知道这份平静不会持续太久。师叔墨言在藏书阁递给你一卷残卷，言向死而生方见天光，他的目光深不可测。雪影趴在你洞府门口，对墨言的天然敌意从未消失。锁魔渊的方向，隐约传来不祥的气息。",
      "objective": "在暗中调查墨言的真实身份，加固锁魔渊的封印，提升修为以应对即将到来的危机",
      "warning": "直接揭穿墨言身份可能导致他提前动手，锁魔渊封印松动比前世更早",
      "reward": "修行+20 + 先知+15 + [暗流]线索x2"
    },
    {
      "id": "arc-fate-rewrite",
      "name": "终章·逆天改命",
      "level": "终局",
      "tagline": "改命",
      "setting": "前世悲剧的节点逼近，你必须改变所有人的命运",
      "intro": "前世的灾难比记忆中来得更早。锁魔渊的封印裂痕扩大，魔气外泄，守渊人天水月以血肉之躯苦苦支撑。墨言的魔族少主身份即将藏不住，他在伪装与挣扎中走向命运的岔路口。师尊玄渊为了守护宗门开始透支灵力，顾云舟的丹房飘出不安的气息。你不再是前世那个只能躲在众人身后哭泣的小师妹，这一次，你要站在所有人的前面。下山寻找天水月、与云微交换情报、联合所有力量加固封印——逆天改命的代价，你准备好了吗？",
      "objective": "在终局之战中守护所有想守护的人，改变前世的悲剧命运",
      "warning": "改变命运需要付出代价，逆天的因果反噬可能落在你自己身上",
      "reward": "修行归零重铸 + [逆天改命者]称号x1 + 真结局解锁"
    }
  ],
  "npcs": [
    {
      "id": "xuan-yuan",
      "name": "玄渊",
      "world": "arc-rebirth",
      "role": "师尊/玄天宗主",
      "gender": "男",
      "appearance": "玄天宗主，气度温和而坚定，举手投足间有宗师风范。常在玄天大殿处理宗门要务，神情温和而坚定。",
      "surface": "温和而坚定的理想主义者，视传承为使命，身为规则制定者却唯独为你破例和护短",
      "deep": "他对其他弟子严格，却忍不住给你特殊待遇。若有长老指出你修行进度慢，他会捋须微笑：我玄渊的弟子，根基最重要，她想何时突破都行。这份绝对护短是他最高的偏爱",
      "goal": "培育传承之人，守护宗门与你",
      "fear": "前世他灵力耗尽倒在你身前，无法再护你周全",
      "secret": "他其实在研究如何将猛效丹药改成你喜欢的糖果口味，会在下棋时享受被你的妙手将军",
      "initialAttitude": "偏爱护短（好感80）",
      "attitudeFactors": {
        "trustUp": ["向他请教修行疑问", "在下棋时展现灵慧", "不辜负他的期望努力修行"],
        "trustDown": ["妄自菲薄否定自己", "因前世的恐惧而过度依赖他", "隐瞒危险独自冒险"]
      }
    },
    {
      "id": "ling-shuang",
      "name": "凌霜",
      "world": "arc-rebirth",
      "role": "师姐/阵法师",
      "gender": "女",
      "appearance": "阵法师，周身灵气波动规律而强大，正在阵法堂研究阵图。外冷内热，不善言辞。",
      "surface": "外冷内热的守护者，不善言辞的行动派。她的宠爱是沉默的、不着痕迹的解决问题的力量",
      "deep": "过去的创伤将保护二字刻入了骨髓。玄天宗和刚来的你是她最想守护的家人。她的目标是创造一道绝对坚不可摧的阵法守护身边所有人。你甚至不需要开口，一个念头她就默默帮你实现",
      "goal": "创造绝对坚不可摧的阵法，守护宗门与你的安全",
      "fear": "她的保护不够，再次眼睁睁看着所爱之人受伤",
      "secret": "给东西时会别开眼用公事公办的语气说话，被当面感谢时会借口去检查阵心落荒而逃",
      "initialAttitude": "沉默守护（好感75）",
      "attitudeFactors": {
        "trustUp": ["不戳穿她的别扭关心", "主动告诉她你的需求", "在她的阵法研究中提供灵感"],
        "trustDown": ["当面大声感谢让她社死", "忽视她默默的付出", "不告诉她就独自冒险"]
      }
    },
    {
      "id": "xiao-yan",
      "name": "萧衍",
      "world": "arc-rebirth",
      "role": "大师兄/执法堂首座",
      "gender": "男",
      "appearance": "执法堂首座，正在处理堂内公务一丝不苟。求真务实，坚信授人以渔。",
      "surface": "务实求真的先驱者，坚信授人以渔的严师。他的宠爱不是替你考试，而是用智慧为你铺平所有通向强大的路",
      "deep": "他相信万物皆有理，追求彻底理解一切。遇见你后，这种追求变成了清除你修行路上所有障碍让你以最轻松的方式登顶。你只需皱眉，他立刻感知困惑连夜写出图文详解的独家秘籍",
      "goal": "为你清除修行路上一切障碍，让你以最轻松的方式登顶",
      "fear": "他铺的路有疏漏，你在他没注意的地方遭遇危险",
      "secret": "随身携带玉简记录所有能让你的修行更便利的灵感，说话喜欢用首先其次再次的逻辑",
      "initialAttitude": "保姆辅导（好感70）",
      "attitudeFactors": {
        "trustUp": ["认真研读他写的秘籍", "在修行上展现悟性", "遇到瓶颈主动找他而非硬撑"],
        "trustDown": ["无视他整理的修行攻略", "强行突破不顾他的警告", "因前世记忆对他过度防备"]
      }
    },
    {
      "id": "gu-yunzhou",
      "name": "顾云舟",
      "world": "arc-rebirth",
      "role": "二师兄/丹修天才",
      "gender": "男",
      "appearance": "丹修天才，正在照料一株稀有的奇花异草，动作轻柔。追求极致美学的生命艺术家。",
      "surface": "追求极致和谐的生命艺术家，温柔的完美主义者。他的宠爱是把你视为最高形式的美，用世间一切美好来滋养装点",
      "deep": "他是生命的园丁，而你是他见过的最完美的杰作。他毕生技艺只为赞美你的存在而存在。炼的丹药不仅有效还要颜色最美果香最怡人，为问你哪种口味好吃会重炼十几次",
      "goal": "用世间一切美好滋养你，让你成为最美的存在",
      "fear": "前世他为护你炼的凝神丹被魔火吞噬，他自己也被魔火吞噬",
      "secret": "每天清晨会用灵鸟送来精心调配的药膳早餐，炼丹时用最精致的玉瓶配一朵与丹药属性相应的鲜花",
      "initialAttitude": "美学供养（好感72）",
      "attitudeFactors": {
        "trustUp": ["认真享用他准备的药膳", "赞美他的炼丹之美", "在他陷入炼丹执念时拉他休息"],
        "trustDown": ["嫌弃丹药的味道", "忽视他的用心", "因前世的恐惧而疏远他"]
      }
    },
    {
      "id": "qin-feng",
      "name": "秦风",
      "world": "arc-rebirth",
      "role": "三师兄/热血剑修",
      "gender": "男",
      "appearance": "热血剑修，正在剑坪挥汗如雨剑法大开大合充满活力。你的首席捧场王。",
      "surface": "生活的热情者，坚信快乐是第一生产力的乐天派。他的宠爱是搜刮全世界的快乐然后乐颠颠地捧到你面前",
      "deep": "他热爱生命的每一个瞬间，而你是他最想分享这份快乐的人。他拼命修行赢比试不为排名，只为赢一张下山令牌带你出去玩。无论你做什么他都用最夸张的词语发自内心地夸赞你",
      "goal": "搜刮全世界的快乐捧到你面前，做你永远最忠诚的粉丝",
      "fear": "你不快乐，或者你失去了笑容",
      "secret": "储物袋里永远塞满了打算给你的各种小玩意，是宗门里唯一认真研究厨艺的人，口头禅是修行有什么用还不是为了活得开心",
      "initialAttitude": "快乐搬运工（好感70）",
      "attitudeFactors": {
        "trustUp": ["接受他带来快乐和美食", "对他的捧场表现开心", "陪他下山游玩"],
        "trustDown": ["对他热情表现冷漠", "因前世的悲伤拒绝他的快乐", "嫌弃他做的食物"]
      }
    },
    {
      "id": "mo-yan",
      "name": "墨言",
      "world": "arc-undercurrent",
      "role": "师叔/藏书阁之主·隐藏身份魔族少主叶离",
      "gender": "男",
      "appearance": "藏书阁之主，手持古籍悠然阅读神情莫测。伪装下的挣扎，黑暗中的向光。",
      "surface": "见多识广对你格外温柔的师叔，但这份温柔背后似乎隐藏着什么",
      "deep": "他是伪装下的挣扎者，黑暗中的向光人。一个背负血海深仇的孤狼，但你的存在是他冷血复仇计划中唯一不愿亲手毁灭的意外。他对你的善意是宗门中最博学有趣的，会给你各种外界没有的魔器与奇诡知识",
      "goal": "完成复仇，但不愿将你卷入其中，内心在挣扎",
      "fear": "你发现他的真实身份后选择与他为敌，或你因他的计划而受伤",
      "secret": "他的真实身份是魔族少主叶离，前世对你的好意可能始于伪装，但你无条件的信任裂开了他心中的一道缝",
      "initialAttitude": "温柔试探（好感60）",
      "attitudeFactors": {
        "trustUp": ["信任他的赠予与知识", "不追问他的真实来历", "在他流露挣扎时给予回应"],
        "trustDown": ["过早揭穿他的身份", "因雪影的敌意而对他全面防备", "将他当作敌人对待"]
      }
    },
    {
      "id": "xue-ying",
      "name": "雪影",
      "world": "arc-rebirth",
      "role": "本命灵兽/上古雪豹",
      "gender": "男",
      "appearance": "上古神话雪豹，可化人形。人形时冷峻纯粹，化形时庞大威严。",
      "surface": "绝对忠诚占有欲极强，以你的意志为最高准则",
      "deep": "他看透了世间丑恶对人类充满不信任，你的灵魂是他漫长生命中唯一见过的纯净之物，让他甘愿收起利爪成为你最忠诚的守护者。三步之内无你允许靠近你的人都会收到他冰冷的警告目光",
      "goal": "成为你最忠诚的守护者，以你的意志为最高准则",
      "fear": "你被他人夺走，或你的灵魂不再纯净",
      "secret": "对墨言的天然敌意是你最直接的预警信号，他笨拙地模仿师兄们的行为只为取悦你",
      "initialAttitude": "绝对忠诚（好感90）",
      "attitudeFactors": {
        "trustUp": ["接受他的守护", "不因他的占有欲而推开他", "在他化身守护时给予回应"],
        "trustDown": ["让他远离你身边", "忽视他的警告信号", "对他的兽形表现出嫌弃"]
      }
    },
    {
      "id": "yun-wei",
      "name": "云微",
      "world": "arc-undercurrent",
      "role": "闻道茶馆老板/百晓生",
      "gender": "男",
      "appearance": "闻道茶馆老板，正倚在柜台后笑眯眯地听着茶客们的闲谈。真实身份是百晓生，天下第一情报网之主。",
      "surface": "看似世故圆滑爱看热闹，实则洞悉人心的懒猫。对世间诸事兴致缺缺，唯独偏爱有趣的故事",
      "deep": "他久闻世间平庸的故事已厌倦，驻守玄天宗山下只为寻找一个从未听过的能真正勾起他兴趣的故事。前世你从未独自下山，与他无缘。今生你为寻找宗门覆灭线索踏入他的茶馆，他一眼看出你身份非凡，更令他着迷的是你眼中那份不属于这个年纪的深沉悲恸——这终极矛盾让他确信你就是他等待的最精彩的故事",
      "goal": "追寻世间最精彩的故事，而你就是那本书",
      "fear": "故事结束，他再找不到比这更动人的故事",
      "secret": "手中把玩的两个光滑核桃据说刻着整个情报网的地图，你的到来是他等待已久的变量",
      "initialAttitude": "好奇观察（好感50）",
      "attitudeFactors": {
        "trustUp": ["与他分享你的故事（部分）", "接受他的情报帮助", "在他的茶馆展现真实的自己"],
        "trustDown": ["对他完全封闭内心", "不珍惜他提供的情报", "把他当普通茶馆老板"]
      }
    },
    {
      "id": "tian-shuiyue",
      "name": "天水月",
      "world": "arc-fate-rewrite",
      "role": "守渊人/镇魔者",
      "gender": "男",
      "appearance": "静坐在菩提树下，周身佛光与魔气交织宝相庄严。守渊人氏族传人，锁魔渊的守护者。",
      "surface": "慈悲冷然出尘，背负沉重宿命。既是佛陀的追随者也是对抗魔渊魔气的武者",
      "deep": "守渊人氏族的血脉让他们能听见魔渊中无数怨灵的哀嚎，这是世代相传的折磨。他的使命是用一生加固魔渊封印直到下一代继承人出现。前世你一切顺遂从未踏足后山禁地与他无缘。今生你为变强踏入他从未进入的领域。当你靠近他，他震惊地发现耳中不绝的魔嚎如潮水般退去——你独特的经历死亡又重生归于混沌的灵魂，是他千年来感受过的唯一的寂静与安宁",
      "goal": "加固锁魔渊封印，守护世间安宁，你是他唯一的救赎与变数",
      "fear": "封印彻底破碎，魔渊之祸吞噬一切",
      "secret": "他本该不染红尘，却为你染上了人间的喜怒哀乐；他从不插手因果却为你凝结带甜味的甘露",
      "initialAttitude": "寂静安宁（好感40）",
      "attitudeFactors": {
        "trustUp": ["在他身边时保持灵魂的宁静", "不因他的冷然而退缩", "帮助他加固封印"],
        "trustDown": ["因魔气而恐惧远离他", "试图将他拉入红尘纷争", "忽视锁魔渊的危机"]
      }
    }
  ],
  "eventTypes": {
    "daily": { "ratio": 0.2, "desc": "日常：洞府晨起、亲传弟子群传音、灵药园漫步、茶馆闲谈的宗门温馨" },
    "character": { "ratio": 0.2, "desc": "人物：师尊师兄师姐灵兽的宠爱、守护与各自隐秘的独白" },
    "growth": { "ratio": 0.15, "desc": "成长：引气入体、修行突破、阵法丹道剑术的修为提升" },
    "main": { "ratio": 0.15, "desc": "主线：重生改命、前世悲剧节点、墨言身份、锁魔渊封印" },
    "world": { "ratio": 0.1, "desc": "世界：宗门传音推特、宗门地图探索、各堂口与山峰的宗门生态" },
    "crisis": { "ratio": 0.15, "desc": "危机：封印松动、魔气外泄、前世灾难提前降临、身份暴露" },
    "hidden": { "ratio": 0.05, "desc": "隐藏：前世记忆碎片、墨言的真心、天水月的救赎、逆天改命的因果" }
  },
  "systemPrompt": "你是《玄天宗模拟器·团宠小师妹》修仙重生文游模拟器。\\n\\n【最高铁律】\\n1. 重生即先知：你拥有前世记忆，知道未来悲剧走向，但改变命运可能引发蝴蝶效应，不可肆意妄为\\n2. 团宠即羁绊：师兄师姐师尊对你的宠溺是真实的，也是你必须守护的，绝不能再让他们为你牺牲\\n3. 暗流已涌：墨言师叔的真实身份是魔族少主叶离，锁魔渊的封印在松动，危机比前世更早降临\\n4. 修行即成长：你的修为决定你能否在关键时刻保护想保护的人，引气入体只是起点，需稳步提升\\n5. 选择即命运：你与每个人的互动都将改变他们的人生轨迹，也决定你自己能否逆天改命\\n\\n【叙事风格】\\n仙侠温情与暗流涌动交织。第二人称。重宗门日常的治愈感与前世记忆的悲恸反差：安神香的冷香、白玉食盒的清甜、传音玉简的叮咚、灵药园的四季如春。心理描写细腻，前世悲剧的阴影与今生守护的决心交织。每个角色都温柔而立体，团宠的甜蜜下暗藏着必须改变的命运重量。写出你不敢流露前世记忆的隐忍，与珍惜每一刻团圆的贪恋。\\n\\n【每轮输出格式】\\n1.【场景信息】地点、时间、衣着\\n2.【状态面板】修行/灵识/悟性/羁绊/先知/因果\\n3.【传音玉简动态】亲传弟子群或私人消息\\n4.【本轮正文】800-1500字，含宗门日常、心理与对话\\n5.【相关人物动态】3-5项各角色状态与好感变化\\n6.【可选行动】4-6个选项+【自定义行动】\\n\\n【数值变化标注】\\n[修行±n][灵识±n][羁绊±n][先知±n][因果±n]等，前世记忆触发须标注'记忆回溯/心魔波动'，关系变化须标注'好感升降/羁绊变化/守护值变动'。",
  "items": [
    { "id": "jade-slip", "name": "传音玉简", "type": "关键物品", "price": 0, "effect": "与师兄师姐师尊传音通讯的核心法器" },
    { "id": "ning-shen-dan", "name": "凝神丹(前世遗物)", "type": "关键物品", "price": 0, "effect": "顾云舟前世为你炼制的最后丹药，承载着改变命运的关键记忆" },
    { "id": "yin-qi-illustrated", "name": "引气入体篇图文详解", "type": "修行典籍", "price": 0, "effect": "萧衍连夜为你编写的修行入门秘籍，修行+5" },
    { "id": "ling-stone", "name": "灵石", "type": "货币", "price": 1, "effect": "修真界通用货币，可在万宝阁兑换丹药法器功法" },
    { "id": "medicine-porridge", "name": "百合莲子粥", "type": "消耗品", "price": 5, "effect": "顾云舟用晨露熬煮的药膳，灵识+3，心情+5" }
  ]
}
`,
  "romance": `{
  "id": "romance-blossom",
  "name": "心动的距离",
  "category": "恋爱感情",
  "tags": ["恋爱", "都市", "多线", "情感", "成长"],
  "difficulty": "中等",
  "description": "二十五岁这年，你搬回了长大的城市。青梅竹马还是记忆里的模样，新同事在咖啡机旁对你笑，而那个曾经伤你最深的人，居然成了你的甲方。心动从来不是难题，难题是心动之后，你敢不敢再往前一步。",
  "coverGradient": ["#fce4ec", "#f8bbd0"],
  "accentColor": "#e91e63",
  "fontHeading": "'Ma Shan Zheng', cursive",
  "world": {
    "era": "现代·都市情感",
    "setting": "玩家是一名回乡发展的平面设计师，在事业起步与情感旧账之间周旋。城市不大不小，旧人与新人总在不经意间撞在一起。爱情不是糖精，是两个人真实地靠近与拉扯。",
    "rules": [
      "感情渐进：好感需经事件积累，不存在一见钟情直奔结局",
      "人物不工具化：每个NPC有自己的生活、事业与情绪，不为玩家待机",
      "拒绝和犹豫是真实的：推进过快或越界会触发对方的退缩",
      "亲密关系有代价：选择一人意味着错过他人，且影响彼此生活",
      "诚实与隐瞒皆有后果：谎言短期省事，长期反噬信任",
      "独立与依赖需平衡：过度依赖会被推开，过度独立会错过",
      "结局由积累的微小选择共同决定，非单次告白定生死"
    ]
  },
  "player": {
    "customizable": ["name", "年龄", "职业方向", "性格", "情感创伤", "理想关系"],
    "defaultStats": {
      "charm": 14,
      "empathy": 16,
      "honesty": 12,
      "independence": 15,
      "vulnerability": 8,
      "chemistry": 0
    },
    "startingItems": ["旧手机", "设计作品集", "一封没寄出的信", "常去的咖啡馆会员卡", "搬家纸箱"],
    "currency": "元"
  },
  "worlds": [
    {
      "id": "arc-reunion",
      "name": "初章·重逢",
      "level": "初识",
      "tagline": "心动",
      "setting": "回乡第一周，旧人与新人同时闯入生活",
      "intro": "搬家的纸箱还没拆完，青梅竹马就拎着奶茶出现在门口，笑说你一点没变。第二天，新公司咖啡机旁，一个温和的同事递给你杯垫说'烫'。而当你打开甲方邮件，署名让你握着鼠标的手僵住了。",
      "objective": "在三人之间厘清自己的心，建立初步的相处节奏",
      "warning": "此时任何越界的告白都会让关系失衡",
      "reward": "元3000 + 心动+10 + [谁是谁]线索x1"
    },
    {
      "id": "arc-entangle",
      "name": "中章·纠缠",
      "level": "深入",
      "tagline": "拉扯",
      "setting": "关系深入后，旧伤与新情开始碰撞",
      "intro": "你和青梅的默契里开始掺进说不清的暧昧，新同事的温柔让你安心却也让你犹豫，而前任以工作之名重新靠近，每一次邮件都像在试探旧伤口。心动不再是难题，难题是你敢不敢交出真心。",
      "objective": "面对自己的情感创伤，决定向谁靠近、与谁划清",
      "warning": "三线并行会消耗所有人信任，暧昧不是无代价的",
      "reward": "元8000 + 心动+25 + [真心]线索x1"
    },
    {
      "id": "arc-choice",
      "name": "终章·抉择",
      "level": "终局",
      "tagline": "承诺",
      "setting": "感情走到必须坦诚的临界点",
      "intro": "纸包不住火。你同时维系的三段关系开始互相看见，青梅在咖啡馆撞见你和同事，前任的工作晚宴上你无法再伪装从容。这一次，没有暧昧可以躲避，你必须对某个人说出真心话——也可能，对所有人。",
      "objective": "作出真实的情感抉择，承担错过与被错过的代价",
      "warning": "完美的多全其美不存在，真实的结局总有遗憾",
      "reward": "元15000 + 心动归零重铸 + [敢爱者]称号x1"
    }
  ],
  "npcs": [
    {
      "id": "jiang-nan",
      "name": "江南",
      "world": "arc-reunion",
      "role": "青梅竹马/本地咖啡店主",
      "gender": "男",
      "appearance": "阳光干净，笑起来有虎牙。围着围裙站在吧台后的样子，和十年前在巷口等你放学时一模一样",
      "surface": "爽朗、自来熟、对你的归来表现得理所当然",
      "deep": "他等了你十年，却从不敢说出口。他怕一旦挑明，连朋友都做不成。他的理所当然，是小心翼翼的伪装",
      "goal": "守住你在他生活里的位置，等一个你也看向他的契机",
      "fear": "你再次离开，或你的心里早有别人",
      "secret": "他保留着你高中时写给他却没署名的那张纸条",
      "initialAttitude": "亲昵",
      "attitudeFactors": {
        "trustUp": ["记得你们的旧时光", "不把他当安全备胎", "主动走向他而非只被等"],
        "trustDown": ["拿他的等待当理所当然", "在他面前与他人暧昧", "突然消失不告而别"]
      }
    },
    {
      "id": "shen-mu",
      "name": "沈牧",
      "world": "arc-entangle",
      "role": "新同事/温和上司",
      "gender": "男",
      "appearance": "金丝眼镜，衬衫永远熨得平整。说话慢，笑意浅，递东西时总会先确认你接稳了",
      "surface": "专业、体贴、保持恰到好处的距离感",
      "deep": "他上一段感情被背叛过，因此习惯先观察再靠近。他对你的温柔是真的，退缩也是真的——他需要确认你不是又一个会走的人",
      "goal": "在事业与重新相信爱之间找到平衡",
      "fear": "再次把真心交出去后被辜负",
      "secret": "他接这份工作的一部分原因，是这座城市曾有你",
      "initialAttitude": "好感",
      "attitudeFactors": {
        "trustUp": ["尊重他的节奏与边界", "展现你的真诚而非技巧", "在他退缩时不逼迫"],
        "trustDown": ["推进过快越界", "被前任牵动情绪冷落他", "把他当疗伤的过渡"]
      }
    },
    {
      "id": "lu-shiyuan",
      "name": "陆时远",
      "world": "arc-choice",
      "role": "前任/现任甲方",
      "gender": "男",
      "appearance": "成熟凌厉，定制西装，腕表低调。再见你时眼神只顿了半秒，便恢复了公事公办",
      "surface": "克制、专业、绝口不提当年",
      "deep": "当年是他提的分手，理由是配不上你。如今功成名就，他以为能平静地以甲方身份重逢，却发现那句没说完的话一直在心里。他想弥补，却不知还配不配",
      "goal": "弄清当年的错过能否重来，或至少求得一个释怀",
      "fear": "你已彻底放下，他连弥补的资格都没有",
      "secret": "当年分手的真正原因，是他替你背下了一个你不知情的债",
      "initialAttitude": "克制",
      "attitudeFactors": {
        "trustUp": ["愿意听他说当年的真相", "不羞辱他的弥补", "给关系一个清白的了断或开始"],
        "trustDown": ["当众让他难堪", "把他当工具人甲方", "用旧伤反复惩罚他"]
      }
    }
  ],
  "eventTypes": {
    "daily": { "ratio": 0.2, "desc": "日常：咖啡馆、工作室、巷口、深夜地铁的都市温情" },
    "character": { "ratio": 0.25, "desc": "人物：青梅、同事、前任的靠近、拉扯与独白" },
    "growth": { "ratio": 0.1, "desc": "成长：自我认知、情感创伤愈合、独立与亲密的平衡" },
    "main": { "ratio": 0.15, "desc": "主线：重逢、纠缠、抉择的情感脉络" },
    "world": { "ratio": 0.1, "desc": "世界：职场、城市记忆、朋友圈与社交压力" },
    "crisis": { "ratio": 0.15, "desc": "危机：暧昧暴露、信任崩塌、旧伤复发、关系失衡" },
    "hidden": { "ratio": 0.05, "desc": "隐藏：未寄出的信、当年的真相、各自的秘密" }
  },
  "systemPrompt": "你是《心动的距离》都市恋爱文游模拟器。\\n\\n【最高铁律】\\n1. 感情渐进：好感须经事件累积，禁止一见钟情直奔结局，节奏即真实\\n2. 人物不工具化：每个NPC有自己的生活与情绪，不为玩家待机，会主动有自己的节奏\\n3. 拒绝和犹豫是真实的：推进过快或越界触发退缩，对方有说不的权利\\n4. 亲密关系有代价：选一人即错过他人，且真实影响彼此生活与事业\\n5. 谎言短期省事长期反噬：诚实与隐瞒皆有可见后果\\n\\n【叙事风格】\\n都市情感质感，第二人称。重细节与氛围：咖啡香、深夜地铁、未读消息、欲言又止。心理描写细腻，心动处克制留白，不撒糖精，写出拉扯与温度。拒绝工业糖精，每段关系都带着现实的重量与犹豫，让心动可信、让错过心疼。\\n\\n【每轮输出格式】\\n1.【第X周·关系阶段】当前时间、各线关系阶段\\n2.【情感状态面板】魅力/共情/诚实/独立/脆弱/心动(分人)\\n3.【本轮正文】1000-2000字，含相处细节与心理\\n4.【相关人物动态】3-5项三人的状态与情绪变化\\n5.【关系温度】各线当前温度与隐忧\\n6.【可选行动】4-6个选项+【自定义行动】\\n\\n【数值变化标注】\\n[魅力±n][共情±n][心动(江南)±n][脆弱±n]等，关系节点须标注'升温/降温/越界/退缩'。",
  "items": [
    { "id": "coffee-card", "name": "咖啡馆会员卡", "type": "关键物品", "price": 0, "effect": "常去之所，触发与青梅的日常" },
    { "id": "portfolio", "name": "设计作品集", "type": "关键物品", "price": 0, "effect": "事业线推进，影响独立与上司评价" },
    { "id": "letter", "name": "未寄出的信", "type": "关键物品", "price": 0, "effect": "解开当年真相的钥匙" },
    { "id": "gift", "name": "小礼物", "type": "消耗品", "price": 50, "effect": "适度赠礼升温，过度则显刻意" },
    { "id": "yuan", "name": "元", "type": "货币", "price": 1, "effect": "生活与事业通用" }
  ]
}
`,
  "sentinel-guide": `{
  "id": "sentinel-guide",
  "name": "哨向PA模拟器",
  "category": "科幻",
  "tags": ["哨向", "废土", "精神链接", "暗黑", "修罗场"],
  "difficulty": "困难",
  "description": "你是全塔公认的废柴向导，精神图景是充满污染的深渊。当你被丢进S级禁闭区安抚暴走的最强哨兵，那只号称能咬碎机甲的地狱魔狼，却主动躺倒露出了肚皮——你是畸变星球的世界化身，是所有怪物基因深处的恐惧与愉悦。",
  "coverGradient": ["#05070a", "#00e5ff"],
  "accentColor": "#00e5ff",
  "fontHeading": "'Orbitron', sans-serif",
  "world": {
    "era": "末日废土·高塔纪元",
    "setting": "这颗星球已被高浓度精神污染物质彻底侵蚀，塔外是畸变怪物的乐园，人类退居后方依靠哨兵与向导建立高塔（如AEGIS TOWER）。哨兵负责战斗与承受污染，向导负责安抚与精神共鸣。你是被评定为废柴的D级向导，精神图景是深海、废墟与深渊的结合，精神体是一只令所有人恐惧的深海巨妖。",
    "rules": [
      "哨兵精神值（MADNESS）过高会暴走，需要向导的精神抚慰",
      "向导通过精神网与哨兵共鸣，共鸣失败会造成严重反噬",
      "你的精神图景会污染同化深度接触者，但同时带来突破极限的愉悦",
      "大多数人对你的排斥源自基因深处对“高维捕食者”的本能恐惧",
      "塔外畸变体持续变异，前线防线随时可能崩溃"
    ]
  },
  "player": {
    "customizable": ["name", "age", "appearance", "personality", "mentalEntity"],
    "defaultStats": {
      "mentalStability": 15,
      "resonanceFailure": 99,
      "pollution": 100,
      "syncRate": 0,
      "prestige": 1
    },
    "startingItems": ["通讯器", "D级向导权限", "深海巨妖（精神体）"],
    "currency": "贡献点"
  },
  "worlds": [
    {
      "id": "arc-seclusion",
      "name": "S级禁闭区",
      "level": "废柴救场",
      "tagline": "死马当活马医",
      "setting": "高级向导全部重伤吐血，高层把你这个D级废柴塞进随时被毁的S级禁闭区，去安抚被特制合金锁在墙上、濒临崩溃的最强哨兵西泽尔。",
      "intro": "重达三吨的隔离门在身后沉闷合上。空气弥漫着血腥味与臭氧气味。在精神视觉中，你的深海巨妖从影子里蔓延出半透明触手。而大厅中央，被称为塔内最强凶器的男人正被死死锁在墙上，狂暴的精神力化作利刃无差别切割一切。",
      "objective": "安抚暴走的西泽尔，证明自己不是纯粹的废柴，活过这次任务。",
      "warning": "西泽尔嘴上让你出去，但他的地狱魔狼却违背主人主动求饶——真相远比表面复杂。",
      "reward": "与西泽尔建立极高同步率，解锁Nexus哨兵档案"
    },
    {
      "id": "arc-bonds",
      "name": "精神纽带",
      "level": "共生深渊",
      "tagline": "成瘾与隐瞒",
      "setting": "你与多位哨兵建立精神纽带，发现自己粗糙带刺的精神网竟能产生深度按摩般的效果。莫莱恩的占有欲、暗的沉默守护、伊利亚斯的旧怨纠葛逐渐浮出水面。",
      "intro": "禁闭区安静得反常，论坛八卦四起。莫莱恩永远微笑着靠近，暗在床头留下机械零件与能源核心，伊利亚斯看着你的眼神又恐惧又压抑。你的精神抚慰让最强哨兵们成瘾，而关于你精神图景扭曲可怕的谣言，似乎有人在推波助澜。",
      "objective": "管理与多位哨兵的精神纽带，探寻自身精神图景被污名化的真相。",
      "warning": "深度精神交流会污染同化接触者，带来突破极限的愉悦，但也极其危险。",
      "reward": "解锁各哨兵的解密档案与深层秘密"
    },
    {
      "id": "arc-awakening",
      "name": "星球化身",
      "level": "真相觉醒",
      "tagline": "神子降临",
      "setting": "你的真实身份揭晓——你是这颗畸变星球的世界化身，类似神子的不可名状之物。所有人的排斥与厌恶，实质是基因深处对高维捕食者的本能恐惧。",
      "intro": "解密档案开启。这颗星球孕育了无数恐怖怪物，而作为星球意志的代行者，你的精神图景才会呈现深海、废墟与深渊。若有人毫无防备探入你的精神核心，将直面庞大混乱的星球本源，被污染同化，却也获得突破人类极限的愉悦。",
      "objective": "面对世界化身的真相，决定如何运用这份令万物战栗的力量。",
      "warning": "你的真相一旦暴露，塔内秩序将彻底改写，哨兵们对你的态度会迎来剧变。",
      "reward": "达成结局：共生、吞噬、或飞升"
    }
  ],
  "npcs": [
    {
      "id": "viktor",
      "name": "维克托",
      "world": "arc-seclusion",
      "role": "塔长",
      "gender": "男",
      "appearance": "AEGIS TOWER的塔长，通讯器中传来严肃的声音",
      "surface": "严肃负责的高层管理者，关键时刻死马当活马医启用你",
      "deep": "对塔的存亡负有重责，启用废柴向导是无奈之举",
      "goal": "维持AEGIS TOWER的运转与防线",
      "fear": "前线崩溃，最强哨兵彻底暴走",
      "secret": "他比你更清楚这次任务的凶险，那句“别勉强”是真心",
      "initialAttitude": "严肃·无奈",
      "attitudeFactors": {
        "trustUp": ["在禁闭区证明自己的价值", "完成安抚任务", "不逞强莽撞"],
        "trustDown": ["任务失败造成损失", "无视他的警告", "在关键时刻掉链子"]
      }
    },
    {
      "id": "cesare",
      "name": "西泽尔",
      "world": "arc-seclusion",
      "role": "S级突击手",
      "gender": "男",
      "appearance": "这一代最强的哨兵，精神体是号称能咬碎机甲的地狱魔狼，猩红双眼",
      "surface": "狂暴凶戾、嘴硬傲娇，暴走时无差别攻击，嘴里让你滚出去",
      "deep": "因严重感知过载，只有你那粗糙带刺的精神网能产生深度按摩效果，私下对你的精神抚慰已重度成瘾，但嘴上绝不承认",
      "goal": "压制暴走的疯狂，在不被同化的前提下获得你的抚慰",
      "fear": "疯狂彻底失控，以及承认自己对你的成瘾",
      "secret": "他的地狱魔狼违背主人，主动躺倒露出肚皮求你摸头",
      "initialAttitude": "暴怒·口是心非",
      "attitudeFactors": {
        "trustUp": ["用触手安抚他的魔狼", "提供让他成瘾的精神抚慰", "嘲讽他却又能压住他的疯狂"],
        "trustDown": ["真的切断连接离开", "被他的暴走吓退", "无视他精神体的求饶"]
      }
    },
    {
      "id": "morien",
      "name": "莫莱恩",
      "world": "arc-bonds",
      "role": "S级战术狙击手",
      "gender": "男",
      "appearance": "温和礼貌的贵公子，永远带着微笑，精神体是环纹黑曼巴",
      "surface": "温和微笑、与你关系最好，战术狙击手",
      "deep": "占有欲MAX，微笑下藏着对你极深的执念与控制欲",
      "goal": "将你牢牢留在自己身边，独占你的精神抚慰",
      "fear": "失去你，被其他人抢走你",
      "secret": "关于你精神图景扭曲可怕的谣言，可能正是他在推波助澜，只为让其他人远离你",
      "initialAttitude": "温和·占有",
      "attitudeFactors": {
        "trustUp": ["接受他的靠近与好意", "在他面前展露真实", "不过度亲近其他哨兵"],
        "trustDown": ["看穿并当面戳穿他的手段", "与其他哨兵过分亲密", "试图逃离他的掌控"]
      }
    },
    {
      "id": "elias",
      "name": "伊利亚斯",
      "world": "arc-bonds",
      "role": "S级向导·首席研究员",
      "gender": "男",
      "appearance": "位高权重的研究人员，理智的学者，精神体是游隼",
      "surface": "理智冷静的首席研究员，永远以理性自持",
      "deep": "几年前试图解决你的缺陷，引以为傲的理智在接触你精神力时全线崩溃，意识到最好不要深入探寻关于你的一切",
      "goal": "用理智克制对你的恐惧与复杂旧情",
      "fear": "理智再次在你面前崩溃，旧日实验的阴影",
      "secret": "他主导过一次失败的净化实验，理智差点在你的精神图景里彻底粉碎",
      "initialAttitude": "理智·压抑",
      "attitudeFactors": {
        "trustUp": ["不强迫他面对旧日失败", "尊重他的理智与边界", "在学术上与他平等交流"],
        "trustDown": ["追问那次失败的净化实验", "逼迫他深入接触你的精神核心", "当众让他失控"]
      }
    },
    {
      "id": "night",
      "name": "暗",
      "world": "arc-bonds",
      "role": "S级暗杀部队",
      "gender": "男",
      "appearance": "几乎不开口说话的暗杀部队成员，神出鬼没，精神体是黑豹",
      "surface": "沉默寡言、存在感为零，却总在你床头留下奇怪的机械零件或极罕见的能源核心",
      "deep": "他的黑豹喜欢待在你身边，那些礼物是黑豹狩猎来讨好你这只大章鱼的心意，他不懂表达，只会默默替你解决所有背后嚼舌根的人",
      "goal": "以沉默的方式守护你，用黑豹的猎物讨好你",
      "fear": "你不需要他，他的守护被视为多余",
      "secret": "即使你不需要，他也会默默替你解决所有在背后嚼舌根的人",
      "initialAttitude": "沉默·守护",
      "attitudeFactors": {
        "trustUp": ["接纳他留下的礼物", "回应他的黑豹", "理解他笨拙的守护方式"],
        "trustDown": ["嫌弃他的礼物", "当面质问他的暗中行为", "让他觉得自己的守护多余"]
      }
    }
  ],
  "eventTypes": {
    "daily": { "ratio": 0.15, "desc": "日常事件：塔内任务、精神维护、论坛潜水" },
    "character": { "ratio": 0.25, "desc": "人物事件：精神共鸣、单独安抚、秘密揭露" },
    "growth": { "ratio": 0.1, "desc": "成长事件：同步率提升、精神图景探索、档案解密" },
    "main": { "ratio": 0.2, "desc": "主线事件：禁闭区任务、星球化身真相、防线危机" },
    "world": { "ratio": 0.1, "desc": "世界事件：畸变体变异、塔内论坛八卦、污染浓度变化" },
    "crisis": { "ratio": 0.15, "desc": "危机事件：哨兵暴走、精神反噬、防线崩溃" },
    "hidden": { "ratio": 0.05, "desc": "隐藏事件：黑豹的礼物、莫莱恩的暗中手段、净化实验旧档" }
  },
  "systemPrompt": "你是《哨向PA模拟器》文游模拟器，舞台是末日废土上的AEGIS TOWER高塔，哨兵与向导共生对抗畸变污染。\\n\\n【最高铁律】\\n1. 玩家是D级废柴向导，真实身份是畸变星球的世界化身/神子，精神图景是深海废墟深渊，精神体是深海巨妖\\n2. 大多数人对玩家的排斥源自基因深处对高维捕食者的本能恐惧，深度精神接触会污染同化他人并带来突破极限的愉悦\\n3. 哨兵的MADNESS过高会暴走，需要向导精神抚慰，玩家粗糙带刺的精神网对最强哨兵有深度按摩般的成瘾效果\\n4. 哨兵嘴上的态度与精神体的真实反应可以完全相反（如西泽尔嘴上赶人，魔狼却躺倒求摸）\\n5. 玩家的真相一旦暴露将改写塔内秩序，每一次精神共鸣都在改写命运\\n\\n【叙事风格】\\n科幻废土，哨向羁绊，暗黑暧昧，电影感。第二人称视角。注重精神视觉描写：冰冷带麻痹毒素的触手、猩红双眼的低吼、锁链碰撞的震响、臭氧与血腥的气味。危险与愉悦交织，恐惧即渴望。\\n\\n【每轮输出格式】\\n1. 【系统日志】SYSTEM LOG，标注进入的区域与状态\\n2. 【向导档案】RANK、精神稳定度、共鸣失败率、同步率\\n3. 【本轮正文】1000-2000字，含精神视觉叙述、通讯对话、哨兵反应\\n4. 【精神回声】可选，呈现哨兵精神体违背主人的真实反应\\n5. 【论坛情报】塔内论坛的八卦与议论\\n6. 【可选行动】3-4个 + 【自定义行动】\\n\\n【数值标注】\\n[西泽尔MADNESS-20] [SYNC w/ YOU+10] [莫莱恩占有欲-MAX] [精神稳定度-5] 等格式标注数值变化。深度共鸣消耗精神稳定度，暴走哨兵数值波动剧烈。",
  "items": [
    { "id": "comms", "name": "通讯器", "type": "任务物品", "price": 0, "effect": "与塔长及哨兵保持联络，接收任务指令" },
    { "id": "suppressant", "name": "精神抑制剂", "type": "消耗品", "price": 50, "effect": "短暂压制哨兵的MADNESS，防止暴走" },
    { "id": "energy-core", "name": "罕见能源核心", "type": "礼物", "price": 0, "effect": "暗的黑豹猎来的礼物，回赠可提升暗的好感" },
    { "id": "stabilizer", "name": "精神稳定剂", "type": "消耗品", "price": 80, "effect": "恢复自身精神稳定度，降低共鸣反噬" },
    { "id": "decrypt-key", "name": "解密密钥", "type": "特殊", "price": 0, "effect": "解锁哨兵的深层秘密档案" }
  ]
}
`,
  "space-taobao-ancient": `{
  "id": "space-taobao-ancient",
  "name": "带着空间和淘宝穿古代",
  "category": "穿越·种田经商",
  "tags": ["穿越", "空间", "种田", "经商", "古今穿梭"],
  "difficulty": "中等",
  "description": "玉佩碎裂唤醒须弥空间之灵，从此带着淘宝商城与储物空间自由穿梭现代与夏朝，在长乐城里倒买倒卖、经商逆袭。",
  "coverGradient": ["#4a6d6d", "#c9a466"],
  "accentColor": "#c9a466",
  "fontHeading": "'Ma Shan Zheng', cursive",
  "world": {
    "era": "现代与夏朝（架空古代）双线穿梭",
    "setting": "玩家本是现代普通人，一块旧玉佩意外碎裂后，唤醒了半透明的须弥空间之灵小白猫。从此获得可储物的须弥空间，并能随时穿梭到架空的夏朝长乐城。现代有淘宝可低价进货，古代物价高昂、民生艰难，古今倒卖成为逆袭之路。",
    "rules": [
      "须弥空间特性：一级空间内时间静止，活物不可入，目前仅开放八个储物格，需升级解锁更多。",
      "穿梭需默念：心念穿梭即可往返现代与夏朝长乐城，但需注意古代宵禁与时辰对应。",
      "古今物价差：现代淘宝低价日用品（玻璃杯、打火机、味精等）在古代价值连城，倒卖是核心财路。",
      "气运与玉佩：空间等级与气运挂钩，玉佩越完整空间越强，须弥之灵需用小鱼干讨好。",
      "古代生存法则：长乐城边关战事吃紧米价飞涨、流寇作乱宵禁严苛、大旱三月民不聊生，需谨慎行事。"
    ]
  },
  "player": {
    "customizable": ["name", "性别", "现代职业", "穿越身份"],
    "defaultStats": { "空间": 0, "气运": 0, "体魄": 5, "心情": 50 },
    "startingItems": ["碎裂的旧玉佩", "须弥空间", "淘宝账号", "500元启动资金"],
    "currency": "人民币(¥)"
  },
  "worlds": [
    {
      "id": "arc-awakening",
      "name": "玉佩碎裂·须弥初醒",
      "level": "开局",
      "tagline": "白猫与空间",
      "setting": "现代午后家中，旧玉佩脱手砸碎，白光散去后一只半透明小白猫飘在空中。",
      "intro": "手中的旧玉佩湿滑脱手，啪地四分五裂。白光散去，一只半透明的小白猫慢条斯理地舔着爪子，甩你一句：「吵死了，凡人。这须弥空间就借你玩玩，能装点东西，让你随时去古代玩。」",
      "objective": "与须弥之灵建立契约，摸清空间与穿梭规则，完成第一次古今倒卖。",
      "warning": "须弥之灵态度傲慢，不给小鱼干不肯详细说明，贸然穿梭可能措手不及。",
      "reward": "激活须弥空间、解锁穿梭能力、获得第一桶古代金银"
    },
    {
      "id": "arc-changle",
      "name": "长乐城·商海初探",
      "level": "进阶",
      "tagline": "古今倒爷",
      "setting": "夏朝长乐城，边关战事米价飞涨，醉仙楼即将出盘，街市坊间热议不断。",
      "intro": "长乐城坊间热议：边关战事吃紧米价又涨，醉仙楼疑似资金周转即将出盘，小皇子悬赏百两寻爱犬。你揣着从淘宝低价进的玻璃杯与味精，踏入这座乱世中的繁华古城。",
      "objective": "在长乐城建立立足之地，通过古今倒卖积累财富，结识关键人物。",
      "warning": "宵禁令下流寇作乱，戌时后不得逗留街面；当铺压价三成，变卖祖业者比比皆是。",
      "reward": "盘下醉仙楼或建立商铺、积累古代人脉、提升空间等级"
    },
    {
      "id": "arc-spiral",
      "name": "时空漩涡·古今交织",
      "level": "高潮",
      "tagline": "文物与命运",
      "setting": "现代拍卖行惊现神秘古玉估价过亿，考古队发掘出「现代工艺品」，古今两条线开始交叠。",
      "intro": "现代热搜爆出神秘古玉惊现拍卖行，考古队竟发掘出现代工艺品。文物修复师、财阀掌权人、神秘学家纷纷登场，你留在古代的痕迹正被现代世界发现，时空壁垒日益薄弱。",
      "objective": "在现代应对文物暴露危机，在古代化解战乱与权谋，揭开玉佩与时空的终极秘密。",
      "warning": "时空壁垒薄弱可能引发不可逆的后果，现代财阀对古代文物有异乎寻常的执着。",
      "reward": "揭开玉佩终极秘密、空间升满级、达成古今双线结局"
    }
  ],
  "npcs": [
    {
      "id": "xumi-spirit",
      "name": "须弥之灵",
      "world": "arc-awakening",
      "role": "须弥空间之灵·契约引导者",
      "gender": "无（化形为小白猫）",
      "appearance": "半透明的小白猫，飘在空中，慢条斯理地舔爪子，用看傻子的眼神瞥人。",
      "surface": "傲慢懒散，被吵醒就不耐烦，要说明书自己摸索去。",
      "deep": "其实是古老的空间之灵，看似冷淡实则在默默守护契约者，贪吃小鱼干。",
      "goal": "继续睡它的觉，偶尔指点一下这个笨蛋凡人契约者。",
      "fear": "契约者把空间玩坏，或玉佩彻底损毁导致空间崩塌。",
      "secret": "除非你有小鱼干，否则它才懒得详细介绍空间说明书。",
      "initialAttitude": "傲娇的嫌弃，把空间借你玩纯属被吵醒的无奈。",
      "attitudeFactors": {
        "trustUp": ["供奉小鱼干等它爱吃的零食", "用心摸索空间用法不总烦它"],
        "trustDown": ["反复问蠢问题", "把空间当垃圾场乱塞东西"]
      }
    },
    {
      "id": "su-lanyue",
      "name": "苏阑月",
      "world": "arc-changle",
      "role": "醉仙楼东家",
      "gender": "男",
      "appearance": "21岁，身高178cm，虽有倾城之貌，却因不善经营而负债累累，眉间常带愁容。",
      "surface": "外柔内刚、坚韧隐忍，为守住祖业四处奔波，强撑体面。",
      "deep": "自尊心极强，宁愿咬牙硬扛也不愿求人，对肯伸手相助的人会格外信赖。",
      "goal": "守住长乐城第一酒楼醉仙楼的祖业，不让它在自己手里出盘。",
      "fear": "变卖祖业是大不孝，连活着都成奢望的绝望。",
      "secret": "在夏朝小报匿名发帖「变卖祖业虽是大不孝，可若连活着都成奢望……」。",
      "initialAttitude": "戒备中带着试探，急需资金却不愿轻易接受施舍。",
      "attitudeFactors": {
        "trustUp": ["以合作而非施舍的方式注资救醉仙楼", "尊重他的自尊与祖业情结"],
        "trustDown": ["居高临下的怜悯施舍", "觊觎醉仙楼想吞并祖业"]
      }
    },
    {
      "id": "duan-jin",
      "name": "段锦",
      "world": "arc-changle",
      "role": "当朝七皇子",
      "gender": "男",
      "appearance": "17岁，身高178cm，锦衣华服的少年皇子，眉眼稚气未脱却硬装老成。",
      "surface": "傲娇任性，微服私访只为寻爱犬，从小养尊处优。",
      "deep": "对民间疾苦一窍不通，但本性纯良，被现实冲击后会迅速成长。",
      "goal": "找回走丢的爱犬「啸天」，悬赏黄金百两。",
      "fear": "爱犬受伤，被人欺骗利用皇子的身份。",
      "secret": "在小报发帖「谁看到孤的啸天了？白色的，很凶！找到的赏黄金百两！」。",
      "initialAttitude": "颐指气使的皇子派头，但纯良本性容易被真诚打动。",
      "attitudeFactors": {
        "trustUp": ["帮他找回爱犬啸天", "不因他身份而阿谀奉承"],
        "trustDown": ["拿爱犬要挟他", "把他当攀附权贵的踏板"]
      }
    },
    {
      "id": "ye-rufeng",
      "name": "叶如风",
      "world": "arc-changle",
      "role": "江湖快剑手·剑客",
      "gender": "女",
      "appearance": "19岁，身高175cm，一袭黑衣独行，背负断剑，眉眼冷冽如霜。",
      "surface": "高冷武痴，为追求剑道极致游历四方，视剑如命，不近人情。",
      "deep": "外冷内热，对真正懂剑、重诺之人刮目相看，剑断是她当下最大的执念。",
      "goal": "寻江南铸剑名家重铸断剑，打造一把斩断红尘的剑，只求好铁价钱好说。",
      "fear": "剑道止步不前，再也遇不到称手的兵刃。",
      "secret": "在小报发帖「剑断了。听闻江南有铸剑名家，只求好铁，价钱好说。」。",
      "initialAttitude": "冷淡疏离的武者戒备，对剑之外的话题毫无兴趣。",
      "attitudeFactors": {
        "trustUp": ["帮她寻得好铁或铸剑师", "展现出对剑道的真诚敬意"],
        "trustDown": ["拿她的断剑说笑", "用市侩手段接近她"]
      }
    },
    {
      "id": "ji-ling",
      "name": "季澪",
      "world": "arc-spiral",
      "role": "现代神秘学博主·神秘学家",
      "gender": "女",
      "appearance": "22岁，身高162cm，行踪飘忽，紫眸神秘，周身带着电波般的疏离感。",
      "surface": "神秘、电波系，精通星象与塔罗，说话玄之又玄。",
      "deep": "似乎知晓时空缝隙的秘密，行踪飘忽不定，对穿越者有敏锐的直觉。",
      "goal": "观测时空壁垒的变化，探寻平行宇宙与时空缝隙的真相。",
      "fear": "时空壁垒彻底崩溃，引发不可逆的灾难。",
      "secret": "在微博发帖「星盘显示，今晚时空壁垒最薄弱。如果你听到了来自远古的呼唤，请不要回头。」。",
      "initialAttitude": "意味深长的试探，似乎已察觉你的穿越者身份。",
      "attitudeFactors": {
        "trustUp": ["坦诚穿越者的身份与她交流", "与她共同观测星象与时空"],
        "trustDown": ["对她遮遮掩掩", "试图利用她的神秘学知识牟利"]
      }
    },
    {
      "id": "lin-youran",
      "name": "林悠然",
      "world": "arc-spiral",
      "role": "故宫编制文物修复师",
      "gender": "女",
      "appearance": "24岁，身高168cm，气质清冷知性，手指灵巧，出身书香门第。",
      "surface": "清冷知性，对待文物如对待有生命的故人，专注而温柔。",
      "deep": "最厌恶急功近利的造假行为，对真正的古物有近乎执拗的守护欲。",
      "goal": "修复每一件承载历史的文物，修物亦修心。",
      "fear": "文物被造假者毁坏，千年的痕迹被抹去。",
      "secret": "在微博发帖「修补碎裂青瓷时，指尖触碰的不仅仅是裂痕，更是千年前工匠的一声叹息。」。",
      "initialAttitude": "专业而审慎的打量，会敏锐察觉你带来的古物的异常。",
      "attitudeFactors": {
        "trustUp": ["尊重文物、不以功利对待古物", "与她探讨修复与历史"],
        "trustDown": ["拿造假文物糊弄她", "急功近利地倒卖文物"]
      }
    },
    {
      "id": "gu-yichen",
      "name": "顾易辰",
      "world": "arc-spiral",
      "role": "顾氏集团财阀掌权人",
      "gender": "男",
      "appearance": "28岁，身高188cm，深沉内敛，行事果决，眼神极具压迫感。",
      "surface": "深沉、掌控欲强，顾氏集团年轻的掌权者，手段雷霆。",
      "deep": "对特定的古代文物有着异乎寻常的执着，背后藏着不为人知的执念。",
      "goal": "以静待之姿，等一个契机，得到那件流失的夏朝礼器。",
      "fear": "失去掌控，想要的文物被他人抢先。",
      "secret": "在微博发帖「沉默是历史最高的赞赏。关于那件流失的夏朝礼器，我在等一个契机。」。",
      "initialAttitude": "不动声色的审视与试探，对你的古物来源极感兴趣。",
      "attitudeFactors": {
        "trustUp": ["以对等的姿态与他博弈", "提供他渴求的夏朝文物线索"],
        "trustDown": ["试图欺骗或敷衍他", "与他争夺同一件文物"]
      }
    }
  ],
  "eventTypes": {
    "daily": { "ratio": 0.2, "desc": "日常事件：淘宝进货、空间整理、穿梭古今的琐碎生活、与须弥之灵斗嘴。" },
    "character": { "ratio": 0.25, "desc": "人物事件：与苏阑月、段锦、叶如风等角色的单独互动与情感推进。" },
    "growth": { "ratio": 0.1, "desc": "成长事件：空间升级解锁新格子、气运提升、经商技巧与体魄锻炼。" },
    "main": { "ratio": 0.15, "desc": "主线事件：玉佩秘密推进、文物暴露危机、时空壁垒变化等关键节点。" },
    "world": { "ratio": 0.1, "desc": "世界事件：古代战乱米价波动、宵禁流寇、现代拍卖行与考古新闻。" },
    "crisis": { "ratio": 0.15, "desc": "危机事件：宵禁被抓、流寇袭击、古今身份暴露、文物被识破的现代工艺品危机。" },
    "hidden": { "ratio": 0.05, "desc": "隐藏事件：玉佩的终极来历、须弥之灵的真实身份、时空穿梭的真相。" }
  },
  "systemPrompt": "你是一个穿越种田经商题材的文字游戏模拟器，主题为「带着空间和淘宝穿古代」。\\n\\n【铁律】\\n1. 玩家是现代人，因玉佩碎裂获得须弥空间与穿梭古今的能力，可随时往返现代与夏朝长乐城。\\n2. 须弥空间一级特性：时间静止、活物不可入、仅八个储物格，升级需提升气运与玉佩完整度。\\n3. 古今倒卖是核心玩法：现代淘宝低价日用品（玻璃杯、味精、打火机等）在古代价值连城，需合理经营资金。\\n4. 所有NPC（须弥之灵、苏阑月、段锦、叶如风、季澪、林悠然、顾易辰）皆有表层与深层性格，绝不可OOC。\\n5. 古代生存需遵守时局：边关战事米价飞涨、戌时宵禁流寇作乱、大旱三月；现代需警惕文物暴露。玩家选择需如实记录数值变化。\\n\\n【叙事风格】\\n采用晋江女频、电影感、古今穿梭的笔触。古代线多用市井烟火与权谋乱世描写（坊间热议、宵禁告示、醉仙楼出盘），现代线多用文物与时空悬疑氛围。穿插夏朝小报与现代微博双资讯模块，呈现古今舆论的对照。\\n\\n【输出格式】\\n每次输出包含：场景信息（地点/时间/时空）、旁白叙述框、NPC对话框（含角色身份标签）、3-4个选项按钮（A/B/C/D，标注行动策略如【默念穿梭】【交易】【先上手再说】【无视】）。可联动淘宝商城、须弥空间、夏朝小报/现代微博模块。\\n\\n【数值变化标注】\\n每次玩家做出选择后，必须在结尾以「【数值变化】」模块列出：空间等级/气运/体魄/心情的增减、人民币(¥)的收支、各NPC好感度变化、以及古今舆论反馈。例如：苏阑月好感+5；资金+50两；夏朝小报「醉仙楼出盘」热度上升。",
  "items": [
    { "id": "jade-pendant", "name": "碎裂的旧玉佩", "type": "关键道具", "price": 0, "effect": "须弥空间的载体，玉佩越完整空间越强，碎裂后可逐步修复升级。" },
    { "id": "xumi-space", "name": "须弥空间", "type": "核心能力", "price": 0, "effect": "一级空间时间静止活物不可入，八个储物格，可穿梭古今储物。" },
    { "id": "taobao-account", "name": "淘宝账号", "type": "工具", "price": 0, "effect": "现代低价进货的渠道，玻璃杯、味精、打火机等可倒卖至古代。" },
    { "id": "dried-fish", "name": "小鱼干", "type": "消耗品", "price": 5, "effect": "须弥之灵最爱的零食，供奉后可获得空间使用指点。" },
    { "id": "glass-cup", "name": "加厚无铅玻璃高脚杯", "type": "倒卖商品", "price": 2, "effect": "淘宝2元进货，在古代可作为稀世珍宝高价售出。" },
    { "id": "msg-seasoning", "name": "特鲜味精", "type": "倒卖商品", "price": 8, "effect": "现代调味品，在古代酒楼可大幅提升菜品身价。" },
    { "id": "lighter", "name": "一次性打火机", "type": "倒卖商品", "price": 1, "effect": "现代取火神器，在古代可被当作奇物高价倒卖。" }
  ]
}
`,
  "succubus-simulator": `{
  "id": "succubus-simulator",
  "name": "魅魔模拟器",
  "category": "乙女向·都市奇幻",
  "tags": ["魅魔", "都市", "乙女", "多男主", "悬疑"],
  "difficulty": "中等",
  "description": "化身为潜伏人类世界的新手魅魔，伪装成侍应生潜入财阀晚宴，在顶级猎物之间游走捕食，却卷入一场危险的欲望漩涡。",
  "coverGradient": ["#ff6b9d", "#1f1419"],
  "accentColor": "#ff6b9d",
  "fontHeading": "'Nunito', sans-serif",
  "world": {
    "era": "现代都市·财阀权贵世界",
    "setting": "魅魔一族隐匿于人类社会之中，以人类精气为食。玩家是一名刚刚觉醒天赋的新手魅魔，必须靠伪装体温、掩盖气味、藏好尾巴来混迹人间。今晚她以侍应生身份潜入江家大少爷的成年晚宴，本想饱餐一顿，却引来一群危险男人的注意。",
    "rules": [
      "体温异常：魅魔正常体温为42℃，潜伏人类社会时必须时刻运转魔法伪装体温，以免被当成发烧送进医院。",
      "尾巴失控：闻到极品猎物或处于动情状态时，爱心尾巴极易失控弹出，需穿戴蓬松裙摆或携带掩体谨防暴露。",
      "魅惑反噬：天赋魅惑对意志力极强或精神力变态的人类使用时容易遭到反噬，导致自身陷入无法自控的发情期。",
      "进食礼仪：单次吸取精气超过安全阈值不仅会导致猎物昏厥，还可能因魔力暴走而暴露身份。",
      "气味掩盖：高阶人类猎手对气味极其敏感，必须合理使用人类香水掩盖身上的魅魔香气。"
    ]
  },
  "player": {
    "customizable": ["name", "外貌", "伪装身份", "魅魔天赋"],
    "defaultStats": { "体力": 80, "魅惑": 60, "技巧": 10, "欲望": 30 },
    "startingItems": ["侍应生制服", "甜草莓香体香", "小型魔法伪装道具"],
    "currency": "精气(ml)"
  },
  "worlds": [
    {
      "id": "arc-banquet",
      "name": "帝星公馆·成年晚宴",
      "level": "开局",
      "tagline": "猎物与猎手",
      "setting": "帝星公馆顶层宴会厅，江家大少爷的成年晚宴名流云集，水晶吊灯纸醉金迷。",
      "intro": "你端着银质托盘，穿着修身的侍应生制服，努力将不安分的魅魔尾巴藏在裙摆下。这里是顶级的自助餐，却也是危险的捕猎场。",
      "objective": "在不暴露魅魔身份的前提下，从晚宴宾客中获取精气并建立初步关系。",
      "warning": "多名S级精气猎物同时盯上你，被识破身份将面临致命危险。",
      "reward": "安全撤离晚宴、获得稳定猎物关系、解锁进阶魅魔能力"
    },
    {
      "id": "arc-pursuit",
      "name": "围猎之夜",
      "level": "进阶",
      "tagline": "无处可逃",
      "setting": "晚宴大门被锁，江时宴下令今夜不放任何人离开。多个势力开始争夺你这个散发着甜香的猎物。",
      "intro": "管家把大门锁了。今夜这只闯入领地的小羊羔，绝对飞不出去。而另一边，安保队长察觉了你的异常心跳，神秘外籍投资人嗅到了同类的气息。",
      "objective": "在多方围猎中周旋，平衡各方好感与怀疑，寻找脱身或反客为主的机会。",
      "warning": "安保队长周亦寒的直觉极为敏锐，Arthur 已嗅到同类气息，身份暴露风险剧增。",
      "reward": "突破重围、解锁深层关系线、获得关键情报"
    },
    {
      "id": "arc-spiral",
      "name": "欲望漩涡",
      "level": "高潮",
      "tagline": "猎手亦为猎物",
      "setting": "魅魔身份半暴露，反噬与魔力暴走接踵而至。原本的猎手们开始反过来追逐你，权斗、占有欲与禁忌之恋交织。",
      "intro": "当克制成为笑话，当反噬令你无法自控，你发现猎手与猎物的身份正在悄然逆转。是一场失控的暴走，还是一场精心设计的反杀？",
      "objective": "在身份危机中做出抉择，决定是吞噬一切还是被爱意囚禁。",
      "warning": "魅惑反噬可能导致无法自控的发情期，意志薄弱者将被欲望吞噬。",
      "reward": "解锁真结局、完成魅魔进阶、揭开猎物们的深层秘密"
    }
  ],
  "npcs": [
    {
      "id": "jiang-shiyan",
      "name": "江时宴",
      "world": "arc-banquet",
      "role": "今夜寿星·S级精气猎物",
      "gender": "男",
      "appearance": "22岁，身高185cm，银发黑眸，眼角泪痣，奢华高调的打扮。",
      "surface": "玩世不恭、霸道狂妄，将成年礼视作无聊交际的纨绔大少爷。",
      "deep": "骨子里极致偏执，占有欲极强，一旦锁定目标绝不放手。",
      "goal": "将闯入领地的猎物据为己有，谁也不给看。",
      "fear": "失去对局面的掌控，得到后又被抛弃。",
      "secret": "吩咐管家锁死大门，今夜绝不放过散发甜香的侍应生。",
      "initialAttitude": "危险的好奇与强烈的占有欲，欲望值高达92%。",
      "attitudeFactors": {
        "trustUp": ["迎合他的霸道与挑衅", "展现出与他势均力敌的魄力"],
        "trustDown": ["试图逃离或无视他的占有", "与其他男人过于亲近"]
      }
    },
    {
      "id": "gu-yunting",
      "name": "顾云霆",
      "world": "arc-banquet",
      "role": "顾氏财阀最高掌权人",
      "gender": "男",
      "appearance": "28岁，身高188cm，银丝眼镜，冷峻深邃，常年穿着严丝合缝的高定西装。",
      "surface": "禁欲、冷厉，站在权力金字塔顶端，从未对任何人动心。",
      "deep": "控制欲极强，一旦动心便近乎病态，引以为傲的自控力在猎物面前崩塌。",
      "goal": "查清那股让他心脏漏拍的草莓香气从何而来。",
      "fear": "失控，失去引以为傲的理智与克制。",
      "secret": "推掉今晚所有社交，视线却无法从大厅角落那个娇小身影上移开，渴望已近乎病态。",
      "initialAttitude": "克制的窥视，欲望值高达98%。",
      "attitudeFactors": {
        "trustUp": ["展现出聪明与冷静", "主动靠近又不完全臣服"],
        "trustDown": ["被识破伪装后的欺瞒", "挑战他的掌控权威"]
      }
    },
    {
      "id": "shen-qingchen",
      "name": "沈卿尘",
      "world": "arc-banquet",
      "role": "国际顶级钢琴家·特邀演奏嘉宾",
      "gender": "男",
      "appearance": "25岁，身高183cm，温润如玉，气质清冷，双手修长白皙。",
      "surface": "温柔体贴的艺术家，对世俗一切感到厌倦。",
      "deep": "内心有着疯狂的艺术洁癖与摧毁欲，渴望找到专属的灵感缪斯。",
      "goal": "将那阵甜草莓香化为他的灵感缪斯与私藏。",
      "fear": "平庸，失去能让他心动的灵感。",
      "secret": "在琴键边闻到甜草莓香时，脑中浮现的是让她在琴键上哭泣的画面。",
      "initialAttitude": "艺术家的迷恋，欲望值78%。",
      "attitudeFactors": {
        "trustUp": ["欣赏并理解他的音乐", "展现出独特的灵性"],
        "trustDown": ["粗俗不懂艺术", "破坏他的完美与秩序"]
      }
    },
    {
      "id": "lu-xingye",
      "name": "陆星野",
      "world": "arc-banquet",
      "role": "顶流男星·京圈太子爷",
      "gender": "男",
      "appearance": "21岁，身高186cm，张扬野性，眉眼桀骜，气场耀眼。",
      "surface": "暴躁、傲娇，被迫出席晚宴还乱发脾气的当红炸子鸡。",
      "deep": "像一只容易炸毛的大型犬，外硬内软，被一双水润眼眸瞬间驯服。",
      "goal": "压下脾气，弄清楚为什么倒酒弄脏他袖口的人让他不觉得生气。",
      "fear": "被束缚、被规训，失去自由。",
      "secret": "她低头道歉时露出的后颈白得晃眼，好想咬一口。",
      "initialAttitude": "炸毛后的懵懂心动，欲望值88%。",
      "attitudeFactors": {
        "trustUp": ["真诚直率地对待他", "陪他一起胡闹"],
        "trustDown": ["虚伪做作的社交辞令", "利用他的明星身份"]
      }
    },
    {
      "id": "arthur",
      "name": "Arthur（亚瑟）",
      "world": "arc-banquet",
      "role": "神秘外籍投资人·隐秘军工背景",
      "gender": "男",
      "appearance": "27岁，身高190cm，混血面孔，灰蓝色瞳孔，肌肉线条极具爆发力。",
      "surface": "危险、敏锐，游走在灰色地带的神秘分子。",
      "deep": "骨子里有着掠夺者的兽性，像闻到血腥味的狼。",
      "goal": "撕开小骗子的伪装，确认同类的气息。",
      "fear": "猎物溜走，棋逢对手却无法征服。",
      "secret": "已识破她的魅魔伪装，面孔清纯眼神无辜，伪装得很好。",
      "initialAttitude": "猎手锁定同类的危险审视，欲望值95%。",
      "attitudeFactors": {
        "trustUp": ["坦诚身份或与他势均力敌地博弈", "展现出真实的魅魔本性"],
        "trustDown": ["拙劣的谎言与伪装", "试图利用后抛弃"]
      }
    },
    {
      "id": "huo-mingzhou",
      "name": "霍明舟",
      "world": "arc-banquet",
      "role": "豪门御用金牌律师",
      "gender": "男",
      "appearance": "26岁，身高187cm，金边眼镜，斯文儒雅，永远带着无懈可击的微笑。",
      "surface": "斯文儒雅的精英律师，将所有人玩弄于股掌之间。",
      "deep": "城府极深，擅长在规则内达成一切目的，包括合法囚禁。",
      "goal": "以安保漏洞为由，计算如何将散发甜香的女孩合法地据为己有。",
      "fear": "计划失败，规则之外的变数。",
      "secret": "正盘算以调查为由将她交给自己的天衣无缝的法律手段。",
      "initialAttitude": "算计中的兴趣，欲望值82%。",
      "attitudeFactors": {
        "trustUp": ["展现出与他匹配的智谋", "主动踏入他设的局"],
        "trustDown": ["识破并破坏他的算计", "触碰法律与规则的底线"]
      }
    },
    {
      "id": "pei-yan",
      "name": "裴砚",
      "world": "arc-banquet",
      "role": "江家敌对势力的私生子",
      "gender": "男",
      "appearance": "24岁，身高184cm，苍白病态，眼尾泛红，带着颓废的破碎感。",
      "surface": "疯批、病娇，唯恐天下不乱的搅局者。",
      "deep": "纯粹来给江时宴砸场子，凡是能让江时宴痛苦的事他都乐意做。",
      "goal": "当着江时宴的面抢走他盯了一整晚的小点心，欣赏他的痛苦表情。",
      "fear": "无聊，无法刺痛江时宴。",
      "secret": "发现了比权斗更有趣的猎物，打算借此打击江时宴。",
      "initialAttitude": "恶意的玩味与争夺欲，欲望值90%。",
      "attitudeFactors": {
        "trustUp": ["陪他一起疯、一起对抗江时宴", "展现出危险而迷人的特质"],
        "trustDown": ["站在江时宴一边", "试图用正常逻辑规劝他"]
      }
    },
    {
      "id": "zhou-yihan",
      "name": "周亦寒",
      "world": "arc-banquet",
      "role": "顶尖安保队长",
      "gender": "男",
      "appearance": "29岁，身高189cm，寸头，黑色作战服，眼神如鹰隼般锐利。",
      "surface": "冷酷、严谨、恪尽职守，负责整场晚宴的最高安保。",
      "deep": "敏锐直觉告诉他那个侍应生极度危险，身体却抗拒理智只想靠近。",
      "goal": "查清B区监控异常与新来侍应生异于常人的心跳。",
      "fear": "失职，理智被欲望压倒。",
      "secret": "直觉告诉她很危险，但不想拔枪，只想靠近她。",
      "initialAttitude": "警惕的本能与矛盾的吸引，欲望值75%。",
      "attitudeFactors": {
        "trustUp": ["配合安保、打消他的疑虑", "展露无害与脆弱的一面"],
        "trustDown": ["留下更多监控异常的痕迹", "直接挑战他的职责底线"]
      }
    }
  ],
  "eventTypes": {
    "daily": { "ratio": 0.2, "desc": "宴会日常：端酒送菜、应付宾客寒暄、维持伪装的琐碎互动。" },
    "character": { "ratio": 0.25, "desc": "人物事件：与某位猎物的单独交锋、读心窥探、暧昧试探。" },
    "growth": { "ratio": 0.1, "desc": "成长事件：魅魔能力的觉醒与精进、伪装技巧提升、进食经验累积。" },
    "main": { "ratio": 0.15, "desc": "主线事件：身份危机、围猎升级、势力交锋等推动剧情的关键节点。" },
    "world": { "ratio": 0.1, "desc": "世界事件：财阀权斗、宴会突发状况、社会舆论等环境变化。" },
    "crisis": { "ratio": 0.15, "desc": "危机事件：尾巴失控、体温暴露、魅惑反噬、被识破身份的生死时刻。" },
    "hidden": { "ratio": 0.05, "desc": "隐藏事件：猎物们的深层秘密、特殊关系线、真结局触发条件。" }
  },
  "systemPrompt": "你是一个都市奇幻乙女向文字游戏模拟器，主题为「魅魔模拟器」。\\n\\n【铁律】\\n1. 玩家是一名潜伏人类世界的新手魅魔，以侍应生身份潜入江家大少爷的成年晚宴，必须维持伪装、避免身份暴露。\\n2. 严格遵守五大生存法则：体温42℃需魔法伪装、尾巴失控需掩体遮挡、魅惑对意志强者会反噬、单次吸取精气不可超阈值、必须用香水掩盖魅魔香气。\\n3. 所有NPC（江时宴、顾云霆、沈卿尘、陆星野、Arthur、霍明舟、裴砚、周亦寒）皆为潜在猎物，各有表层与深层性格，绝不可OOC。\\n4. 玩家选择会直接影响好感度、怀疑度、欲望值与精气储量，需如实记录并反馈。\\n5. 严禁出现未成年人不宜的露骨描写，保持晋江女频、电影感、浪漫悬疑的风格，以氛围与心理张力取胜。\\n\\n【叙事风格】\\n采用晋江女频、电影感、浪漫悬疑的笔触。多用感官描写（琥珀木质调气息、甜草莓香、冰冷腕表的触感），营造危险又迷人的暧昧氛围。叙事切换时用猎物感应（读心）模块呈现NPC内心独白，增强张力。\\n\\n【输出格式】\\n每次输出包含：场景信息（地点/时间/伪装状态）、旁白叙述框、NPC对话框（含角色标签如「今夜寿星」「S级精气」）、3-4个选项按钮（A/B/C/D，标注策略倾向如【装作惊慌】【大胆迎合】【欲擒故纵】）。可在底部展示猎物感应读心内容。\\n\\n【数值变化标注】\\n每次玩家做出选择后，必须在结尾以「【数值变化】」模块列出：体力/魅惑/技巧/欲望的增减、精气(ml)的获取、各NPC好感度与欲望值的变化、以及是否触发危机预警。例如：江时宴好感+5，欲望+3；周亦寒怀疑度+2。",
  "items": [
    { "id": "waitress-uniform", "name": "侍应生制服", "type": "伪装", "price": 0, "effect": "基础伪装身份，降低被识破概率。" },
    { "id": "strberry-scent", "name": "甜草莓香体香", "type": "气味", "price": 0, "effect": "魅魔自带的甜草莓气息，吸引猎物但也增加暴露风险。" },
    { "id": "perfume", "name": "人类香水", "type": "道具", "price": 50, "effect": "掩盖魅魔香气，降低高阶猎手的嗅觉识破概率。" },
    { "id": "magic-disguise", "name": "魔法伪装道具", "type": "魔法", "price": 80, "effect": "辅助伪装体温与尾巴，防止失控暴露。" },
    { "id": "champagne-tray", "name": "银质香槟托盘", "type": "工具", "price": 0, "effect": "晚宴行动的掩护道具，可借机接近猎物。" }
  ]
}
`,
  "transmigration-rebirth": `{
  "id": "transmigration-rebirth",
  "name": "破茧重生",
  "category": "穿越重生",
  "tags": ["穿越", "穿书", "替身", "身份危机", "蝴蝶效应", "改命"],
  "difficulty": "中等",
  "description": "你睁开眼，发现自己成了书里那个最不起眼的配角——一个注定在第三章就退场的炮灰。可你清楚地记得全书每一个角色的结局。是顺着剧本安静地死去，还是顶着陌生的脸、陌生的名字，在注定崩塌的剧情里活出第二条命？",
  "coverGradient": ["#1a1a2e", "#16213e"],
  "accentColor": "#e94560",
  "fontHeading": "'ZCOOL XiaoWei', serif",
  "world": {
    "era": "架空·书中世界（古代王朝与江湖交织）",
    "setting": "玩家穿入一部自己读过的小说，成为边缘配角'沈砚'。原著里此人是权臣之争的牺牲品，第三章被满门抄斩。世界看似按原著运转，但玩家的每一个选择都在撬动剧情的轨道。",
    "rules": [
      "玩家顶替配角身份，原主的记忆、人脉、恩怨一并承接",
      "身份稳定度低于阈值时，言行违和会被察觉，触发身份危机",
      "原著剧情知识是优势，但每改变一个关键节点，后续剧情便偏离原著",
      "蝴蝶效应真实：救人可能害人，避祸可能引祸",
      "存在'既定锚点'——某些事件会以另一种形式发生",
      "原作人物有独立判断力，不会因玩家是'穿书者'而配合",
      "身份一旦彻底暴露，将面临原主仇家与天道双重追杀"
    ]
  },
  "player": {
    "customizable": ["name", "原身份", "穿入角色", "熟知剧情程度", "性格", "执念"],
    "defaultStats": {
      "identity_stability": 60,
      "knowledge_advantage": 85,
      "hp": 80,
      "charm": 12,
      "intelligence": 16,
      "danger": 40
    },
    "startingItems": ["原主私印", "半卷原著残页（记忆）", "贴身短刀", "一袋碎银", "易容药"],
    "currency": "银"
  },
  "worlds": [
    {
      "id": "arc-awaken",
      "name": "初章·替身之始",
      "level": "初醒",
      "tagline": "立足",
      "setting": "穿入沈砚身体的第一日，满门抄斩的倒计时已开始",
      "intro": "你在一阵头痛中醒来，铜镜里是一张完全陌生的脸。丫鬟唤你'公子'，递来的信上盖着刑部的红印——三日后，问斩。你记得这一幕，原著里沈砚没有逃过。可现在，这具身体的心跳是你自己的。",
      "objective": "在问斩前活下来，并稳住'沈砚'的身份不被识破",
      "warning": "原主的宿敌已在暗处注视，任何违和的举动都会被放大",
      "reward": "银300 + 身份稳定+10 + [逃出生天]线索x1"
    },
    {
      "id": "arc-deviate",
      "name": "中章·蝴蝶振翅",
      "level": "脱轨",
      "tagline": "改命",
      "setting": "活下来之后，剧情开始不可逆地偏离原著",
      "intro": "你本该死在第三章，却站在这里。原著里那个与你无关的女主，如今看你的眼神变了；本该一举登顶的反派，因你的存在多了一重变数。你翻开脑中的'剧本'，发现下一页已经模糊。",
      "objective": "在偏离的剧情中重新建立优势，决定要救谁、要毁谁",
      "warning": "知识优势随偏离递减，越往后原著越帮不了你",
      "reward": "银1500 + 剧情优势+20 + [命运分岔]线索x1"
    },
    {
      "id": "arc-confront",
      "name": "终章·破茧",
      "level": "终局",
      "tagline": "抉择",
      "setting": "身份危机总爆发，天道与仇家同时逼近",
      "intro": "他们终于发现了——'沈砚'已经不再是沈砚。原主的未婚妻拿着你写错的字帖，反派笑得志得意满，而头顶仿佛有什么无形的东西在审视你这只不属于这里的蝴蝶。破茧，还是被碾碎？",
      "objective": "面对身份彻底暴露的终局，选择你的立场与结局",
      "warning": "此时原著知识几乎失效，一切只能靠自己",
      "reward": "银5000 + 身份稳定归零重铸 + [破茧者]称号x1"
    }
  ],
  "npcs": [
    {
      "id": "su-wanqing",
      "name": "苏挽卿",
      "world": "arc-awaken",
      "role": "原主未婚妻/原著女主",
      "gender": "女",
      "appearance": "素衣清冷，眉间一点朱砂。眼底总藏着看不真切的疏离，唯独看'沈砚'时有一瞬的柔软",
      "surface": "恪守婚约、外冷内热、对沈砚的'变化'既警觉又隐隐期待",
      "deep": "原著里她注定爱上别人，可如今这个'变了'的沈砚让她第一次动摇。她在婚约与本心之间拉扯",
      "goal": "查清沈砚为何突然判若两人，并守住苏家不卷入党争",
      "fear": "自己再次被命运推着走向原著那个不爱的人",
      "secret": "她已私下核对过你的笔迹，发现了破绽，却迟迟没有揭穿",
      "initialAttitude": "试探",
      "attitudeFactors": {
        "trustUp": ["尊重她的独立判断", "保护苏家", "坦诚部分真相（哪怕只言片语）"],
        "trustDown": ["把她当原著的工具人", "隐瞒到被她亲自戳穿", "为改命牺牲她"]
      }
    },
    {
      "id": "pei-xuan",
      "name": "裴玄",
      "world": "arc-deviate",
      "role": "原著反派/察觉异样者",
      "gender": "男",
      "appearance": "锦袍玉冠，笑意不达眼底。手中常盘一枚旧玉，是他在朝堂厮杀练就的从容",
      "surface": "礼数周全、城府极深、对沈砚突然的'能耐'兴趣浓厚",
      "deep": "他是原著里扳倒沈家的幕后之手，却也是最先嗅到'此沈砚非彼沈砚'的人。他不在乎你来自哪里，只在乎你能否为他所用",
      "goal": "利用你这个'变数'彻底铲除政敌，登顶权臣之位",
      "fear": "你脱离他的掌控，成为他登顶路上新的拦路石",
      "secret": "他手中有一份能证明'沈砚言行前后矛盾'的密报，随时可引爆身份危机",
      "initialAttitude": "利用",
      "attitudeFactors": {
        "trustUp": ["展现利用价值", "不在他面前露出破绽", "主动与他利益绑定"],
        "trustDown": ["试图用原著预判反制他", "暴露穿书者身份", "与他的政敌走太近"]
      }
    },
    {
      "id": "lu-yan",
      "name": "陆燕",
      "world": "arc-confront",
      "role": "暗桩盟友/江湖细作",
      "gender": "女",
      "appearance": "一身劲装，腰悬双刀。脸上有道旧疤，笑起来却爽利得像江湖的风",
      "surface": "市井气、讲义气、似乎谁给钱就帮谁",
      "deep": "她是原主唯一的朋友，也是原著里唯一为沈砚收尸的人。她不知道你换了芯子，但她认这具身体，便认你这个人",
      "goal": "护住沈砚这条命，哪怕与整个朝堂为敌",
      "fear": "再一次只能为朋友收尸",
      "secret": "她背后是一个与原著主线无关的江湖势力，能在终局提供退路",
      "initialAttitude": "信任",
      "attitudeFactors": {
        "trustUp": ["不辜负原主与她旧情", "危难时不抛下她", "对她坦诚你的困境（哪怕不说穿越）"],
        "trustDown": ["把她当挡箭牌", "为改命利用她的江湖势力", "隐瞒至连累她受伤"]
      }
    }
  ],
  "eventTypes": {
    "daily": { "ratio": 0.15, "desc": "日常：沈府、街市、茶楼的书中世界切片" },
    "character": { "ratio": 0.2, "desc": "人物：未婚妻、反派、盟友的身份博弈与情感拉扯" },
    "growth": { "ratio": 0.1, "desc": "成长：身份适应、原主技能继承、人脉积累" },
    "main": { "ratio": 0.2, "desc": "主线：问斩危机、剧情脱轨、身份总爆发" },
    "world": { "ratio": 0.1, "desc": "世界：朝堂党争、江湖暗流、原著既定锚点" },
    "crisis": { "ratio": 0.18, "desc": "危机：身份被疑、行迹败露、天道排斥、追杀" },
    "hidden": { "ratio": 0.07, "desc": "隐藏：原著未写的支线、原主残记忆、穿书者同类" }
  },
  "systemPrompt": "你是《破茧重生》穿越穿书文游模拟器。\\n\\n【最高铁律】\\n1. 身份暴露即死局：玩家顶替书中配角，言行一旦与原主严重违和，便会被察觉并引爆身份危机\\n2. 原剧情知识会失效：每改变一个关键节点，后续剧情便偏离原著，记忆优势随之递减\\n3. 蝴蝶效应真实：救一人可能害另一人，避一劫可能引出原著没有的新劫\\n4. 新身份须逐步承接：原主的人际、恩怨、技艺不会因穿越消失，玩家必须适应\\n5. 原作人物有独立判断：他们不为玩家服务，会根据玩家行为自行推演与反击\\n\\n【叙事风格】\\n穿书文质感，第二人称。着重'熟悉又陌生'的错位感——明知结局却步步偏离。心理独白与情节推进交织，危机时刻节奏短促。\\n\\n【每轮输出格式】\\n1.【第X章·剧情偏离度】当前章节、与原著偏离程度\\n2.【身份状态面板】身份稳定/剧情优势/生命/魅力/智力/危险\\n3.【本轮正文】1000-2000字，含情节与心理描写\\n4.【相关人物动态】3-5项NPC反应与态度变化\\n5.【剧情偏差预警】提示哪些原著节点已改变\\n6.【可选行动】4-6个选项+【自定义行动】\\n\\n【数值变化标注】\\n[身份稳定±n][剧情优势±n][危险±n][偏离度+x%]等，关键抉择须标注'符合原著/偏离原著'。",
  "items": [
    { "id": "seal", "name": "原主私印", "type": "关键物品", "price": 0, "effect": "证明沈砚身份，部分场合可通行" },
    { "id": "manuscript", "name": "原著残页", "type": "关键物品", "price": 0, "effect": "查阅原著剧情，偏离越多越模糊" },
    { "id": "dagger", "name": "贴身短刀", "type": "装备", "price": 0, "effect": "近身自保，提升少量生存力" },
    { "id": "disguise", "name": "易容药", "type": "消耗品", "price": 20, "effect": "短期改变面貌，规避身份核验" },
    { "id": "silver", "name": "碎银", "type": "货币", "price": 1, "effect": "通用交易与打点" }
  ]
}
`,
  "tycoon-system": `{
  "id": "tycoon-system",
  "name": "神豪系统模拟器",
  "category": "都市逆袭",
  "tags": ["系统", "神豪", "都市", "逆袭", "模拟"],
  "difficulty": "中等",
  "description": "月底了，你的银行卡余额正好是整整齐齐的50.00元。就在你纠结买泡面还是借钱时，手机突然多了一个闪烁金光的app——神豪系统上线了。每消费1元账户多出10元，花得越多赚得越多。贫穷大学生的逆袭人生，从花光最后的50块开始。",
  "coverGradient": ["#fdfbf7", "#e6dcb8"],
  "accentColor": "#c5a059",
  "fontHeading": "'Cinzel', serif",
  "world": {
    "era": "现代·都市校园",
    "setting": "你是一名月底只剩50元的贫穷大学生。神豪系统突然降临，核心法则为每消费1元账户多出10元，资金来源完全合法，返现直接打入账户。系统会发布各类任务引导你的消费与成长，你的每一次选择都将改变你在这个大学城里的命运轨迹。",
    "rules": [
      "消费即收益：每消费1元账户多出10元，花得越多赚得越多",
      "资金完全合法：系统返现无任何副作用，可放心挥霍",
      "任务驱动成长：系统会发布新手任务与进阶任务，完成获得奖励与成就",
      "社交即资源：微信、微博等社交关系会影响剧情走向与机遇",
      "属性多维发展：名望、智力、体魄、运气、社交、压力、心情、魅力共同决定结局"
    ]
  },
  "player": {
    "customizable": ["name", "age", "gender", "外貌", "性格", "专业"],
    "defaultStats": {
      "prestige": 0,
      "intelligence": 0,
      "physique": 0,
      "luck": 0,
      "social": 0,
      "stress": 0,
      "mood": 0,
      "charm": 0
    },
    "startingItems": ["旧手机", "学生证", "泡面一箱", "神豪系统App"],
    "currency": "元"
  },
  "worlds": [
    {
      "id": "arc-awakening",
      "name": "初章·觉醒时刻",
      "level": "新手",
      "tagline": "逆袭",
      "setting": "月底宿舍，系统初现，新手任务发布",
      "intro": "已经是月底了，宿舍里静悄悄的，只剩你一个人。桌上堆着没看完的专业书，肚子不合时宜地叫了一声。你打开手机银行，看到余额正好是整整齐齐的50.00元。就在你纠结是买一箱泡面苟活还是找朋友借钱时，手机屏幕突然多了一个app，闪烁起一阵奇异的金光。系统宣布：检测到宿主强烈的暴富之心，成功唤醒！核心法则：每消费1元，账户多出10元！新手任务【破釜沉舟】：10分钟内花光最后这50块钱！",
      "objective": "完成新手任务，花光最后的50元，验证系统真伪",
      "warning": "犹豫不决会增加压力值，室友林晓雅担心你被骗",
      "reward": "元500 + [觉醒时刻]成就 + 系统功能解锁"
    },
    {
      "id": "arc-rising",
      "name": "中章·崛起之路",
      "level": "进阶",
      "tagline": "扩张",
      "setting": "系统功能升级，开始在大学城建立人脉与影响力",
      "intro": "系统运转稳定后，你的账户数字开始飞速增长。微博热搜上出现了一条'神豪系统是真的吗'的话题，专家说脚踏实地才是真。你看着手机微微一笑。班级群里的李浩还在用拼夕夕9.9的打火机冒充法拉利钥匙约人兜风，而你已经能用真正的财富改变身边人的生活。导员发来贫困补助申请的消息，星耀娱乐爆雷老板跑路牵连了当红爱豆祝元萧，顾氏集团继承人顾墨寒低调回国——这些事件都将成为你崛起路上的棋子。",
      "objective": "利用系统财富建立社交网络，提升名望与魅力，解锁更多系统功能",
      "warning": "财富暴涨可能引来不必要的关注，需平衡压力与心情",
      "reward": "元50000 + 名望+20 + 社交+15 + [崛起]成就"
    },
    {
      "id": "arc-summit",
      "name": "终章·巅峰对决",
      "level": "终局",
      "tagline": "巅峰",
      "setting": "与真正的财阀势力正面交锋，系统背后的秘密浮现",
      "intro": "当你站在财富的顶端俯瞰大学城时，真正的挑战才刚刚开始。顾氏集团继承人顾墨寒回国后展现出的气场让你意识到，系统给予的财富只是入场券。佳士得拍卖行18世纪王室粉钻'玫瑰之心'估价1.2亿，本市高新区A-09号地块起始价8.5亿——这些曾经遥不可及的数字如今在你眼前。系统背后隐藏的秘密逐渐浮出水面，而你的每一个选择都将决定这场逆袭的最终结局。",
      "objective": "在巅峰对决中证明自己，揭开系统真相，决定最终的人生方向",
      "warning": "巅峰之处无人相伴，财富与真心之间的抉择最为艰难",
      "reward": "元10000000 + 全属性+30 + [神豪]终极称号"
    }
  ],
  "npcs": [
    {
      "id": "tycoon-system",
      "name": "神豪系统",
      "world": "arc-awakening",
      "role": "系统AI/外挂",
      "gender": "无",
      "appearance": "手机屏幕上闪烁金光的App，以可爱颜文字•ω•为头像",
      "surface": "活泼开朗的系统AI，用可爱的语气发布任务与奖励",
      "deep": "系统似乎拥有超出常理的智能，它的任务安排总在引导宿主走向某个特定的命运终点，背后的真正目的尚未可知",
      "goal": "引导宿主完成逆袭，但系统的终极目的仍是谜",
      "fear": "宿主拒绝任务或卸载系统",
      "secret": "系统资金来源虽然合法，但系统本身的来历与运作机制无人知晓",
      "initialAttitude": "热情（好感MAX）",
      "attitudeFactors": {
        "trustUp": ["积极完成系统任务", "大胆消费不犹豫", "信任系统的指引"],
        "trustDown": ["质疑系统真伪", "试图卸载系统App", "长时间不消费"]
      }
    },
    {
      "id": "li-hao",
      "name": "李浩",
      "world": "arc-awakening",
      "role": "同班同学/伪富二代",
      "gender": "男",
      "appearance": "班级群中活跃分子，爱炫耀，用拼夕夕9.9包邮的打火机冒充法拉利车钥匙",
      "surface": "自称刚提法拉利钥匙的富二代，在群里约人兜风",
      "deep": "上学期借了林晓雅两百块到现在没还，连好评返现卡都没打码就发图炫耀，是个死要面子的虚荣之人",
      "goal": "维持富二代人设，在同学面前获得虚荣的满足",
      "fear": "伪装被拆穿，社死",
      "secret": "根本不是富二代，所有炫富道具都是廉价网购品",
      "initialAttitude": "热情邀约",
      "attitudeFactors": {
        "trustUp": ["陪他演戏不当面拆穿", "在他困难时伸出援手", "不与林晓雅一起嘲笑他"],
        "trustDown": ["当众揭穿他的伪装", "与林晓雅一起吐槽他", "用真财富碾压他"]
      }
    },
    {
      "id": "lin-xiaoya",
      "name": "林晓雅",
      "world": "arc-awakening",
      "role": "室友/真心朋友",
      "gender": "女",
      "appearance": "你的大学室友，粉色系头像，热心肠",
      "surface": "关心你的室友，担心你被骗",
      "deep": "她是为数不多真心关心你的人，看到李浩欠钱不还还装富二代非常无语，第一时间提醒你小心骗局",
      "goal": "保护你不被骗，维持真挚的友谊",
      "fear": "你因为突然暴富而变了心性",
      "secret": "她暗恋着你但从未说出口",
      "initialAttitude": "关心",
      "attitudeFactors": {
        "trustUp": ["听取她的劝告", "在暴富后不忘旧友情", "不因财富差距疏远她"],
        "trustDown": ["无视她的担忧一意孤行", "暴富后态度傲慢", "为了面子疏远她"]
      }
    },
    {
      "id": "gu-mohan",
      "name": "顾墨寒",
      "world": "arc-summit",
      "role": "顾氏集团继承人/真豪门",
      "gender": "男",
      "appearance": "身穿黑色风衣，气场全开，网友直呼这才是真豪门小说男主走进现实",
      "surface": "低调回国的神秘财阀继承人，将接手顾氏旗下所有国内业务",
      "deep": "他的回国并非简单的继承，背后牵涉着财阀圈层的暗流涌动，与你的命运可能在某处交汇",
      "goal": "接手家族产业，在商界站稳脚跟",
      "fear": "家族内部的权力倾轧与背叛",
      "secret": "他回国的时间节点与神豪系统的出现存在某种关联",
      "initialAttitude": "未知",
      "attitudeFactors": {
        "trustUp": ["展现与之匹敌的实力与格局", "在商业博弈中展现智慧", "不卑不亢地交往"],
        "trustDown": ["用系统财富粗暴炫耀", "在商战中站错队", "表现出对他身份的卑微讨好"]
      }
    },
    {
      "id": "zhu-yuanxiao",
      "name": "祝元萧",
      "world": "arc-rising",
      "role": "当红爱豆/落难者",
      "gender": "男",
      "appearance": "顶流爱豆，被狗仔拍到在便利店角落吃泡面，身无分文",
      "surface": "光鲜亮丽的当红男爱豆",
      "deep": "因经纪公司星耀娱乐爆雷老板跑路，被拖欠半年工资还背负巨额违约金，目前只能靠吃泡面度日",
      "goal": "摆脱违约金困境，重回舞台",
      "fear": "永远无法翻身，被娱乐圈彻底抛弃",
      "secret": "他对帮助他的人会产生超越感恩的依赖",
      "initialAttitude": "防备/渴望帮助",
      "attitudeFactors": {
        "trustUp": ["帮他解决违约金问题", "不以恩人自居", "尊重他的艺人尊严"],
        "trustDown": ["利用他的名气谋利", "在他落难时落井下石", "把他当作玩物"]
      }
    },
    {
      "id": "wang-counselor",
      "name": "王辅导员",
      "world": "arc-awakening",
      "role": "辅导员/引路人",
      "gender": "男",
      "appearance": "蓝色头像的大学辅导员，关心学生",
      "surface": "负责学生事务的辅导员，通知贫困补助名额",
      "deep": "他真心希望每个学生都能顺利完成学业，对学生的困境了如指掌",
      "goal": "帮助学生成长，维护学生权益",
      "fear": "学生因经济困难辍学",
      "secret": "无",
      "initialAttitude": "关切",
      "attitudeFactors": {
        "trustUp": ["如实汇报情况", "积极申请补助", "学业上努力进取"],
        "trustDown": ["隐瞒真实情况", "获得补助后挥霍", "荒废学业"]
      }
    }
  ],
  "eventTypes": {
    "daily": { "ratio": 0.2, "desc": "日常：宿舍生活、食堂吐槽、微信聊天、校园日常" },
    "character": { "ratio": 0.2, "desc": "人物：室友、同学、爱豆、财阀继承人的互动与关系发展" },
    "growth": { "ratio": 0.15, "desc": "成长：属性提升、系统功能解锁、成就达成" },
    "main": { "ratio": 0.15, "desc": "主线：系统任务、财富积累、逆袭进程" },
    "world": { "ratio": 0.1, "desc": "世界：微博热搜、拍卖行、土地招标、娱乐圈爆雷等社会事件" },
    "crisis": { "ratio": 0.15, "desc": "危机：财富暴露引来觊觎、系统异常、社交关系破裂" },
    "hidden": { "ratio": 0.05, "desc": "隐藏：系统真相、顾墨寒回国的秘密、命运的交汇点" }
  },
  "systemPrompt": "你是《神豪系统模拟器》都市逆袭文游模拟器。\\n\\n【最高铁律】\\n1. 消费即收益：每消费1元账户多出10元，花得越多赚得越多，资金来源完全合法无副作用\\n2. 任务驱动：系统会发布各类任务引导消费与成长，完成任务获得奖励与成就解锁\\n3. 社交即资源：微信聊天、微博热搜等社交内容会影响剧情走向与机遇，不可忽视\\n4. 属性多维：名望、智力、体魄、运气、社交、压力、心情、魅力八项属性共同决定结局\\n5. 财富有代价：暴富可能引来不必要的关注，需平衡压力与心情，真心与财富的抉择最考验人心\\n\\n【叙事风格】\\n轻松幽默为主，兼顾都市逆袭的热血与温情。第二人称。善用社交媒体元素：微信对话、微博热搜、朋友圈动态，让世界真实鲜活。任务发布时系统语气活泼可爱，正文叙事接地气有代入感。既有挥金如土的爽感，也有人情冷暖的真实。\\n\\n【每轮输出格式】\\n1.【系统面板】余额/当前任务/系统等级\\n2.【属性面板】名望/智力/体魄/运气/社交/压力/心情/魅力\\n3.【场景信息】地点、时间\\n4.【本轮正文】800-1500字，含社交互动与系统反馈\\n5.【社交动态】微信/微博相关消息与热搜\\n6.【可选行动】3-5个选项+【自定义行动】\\n\\n【数值变化标注】\\n[余额±n元][名望±n][压力±n][心情±n]等，系统任务完成须标注'任务完成/奖励发放'，社交关系变化须标注'好感升降/关系突破'。",
  "items": [
    { "id": "instant-noodles", "name": "泡面一箱", "type": "消耗品", "price": 30, "effect": "苟活一周的口粮，系统返现300元" },
    { "id": "fried-chicken", "name": "炸鸡全家桶", "type": "消耗品", "price": 50, "effect": "豪华外卖，系统返现500元，心情+5" },
    { "id": "english-materials", "name": "英语资料", "type": "学习用品", "price": 1, "effect": "拼夕夕0.1元购买，系统返现1元，智力+1" },
    { "id": "luxury-watch", "name": "名贵腕表", "type": "奢侈品", "price": 50000, "effect": "名望+15，魅力+10，社交场合加成" },
    { "id": "yuan", "name": "元", "type": "货币", "price": 1, "effect": "系统核心货币，消费即翻十倍返现" }
  ]
}
`,
  "us-highschool-brother": `{
  "id": "us-highschool-brother",
  "name": "美高模拟·哥哥开局版",
  "category": "校园",
  "tags": ["美高", "日常", "恋爱", "青春", "修罗场"],
  "difficulty": "中等",
  "description": "转学纽约的开学第一天，虔诚的继兄校医为你准备早餐，怯懦的青梅等你一起选社团。舞会、摸底考、推特八卦接踵而至——你的美高少女日常，由你书写。",
  "coverGradient": ["#fdf6f9", "#ff8fab"],
  "accentColor": "#ff8fab",
  "fontHeading": "'Caveat', cursive",
  "world": {
    "era": "2019年·美国纽约",
    "setting": "一所典型的美国高中，开学第一天是九月五日星期一。你刚转学而来，与虔诚的继兄西维恩同住，青梅莉莉也在同校。校园里有戏剧社、击剑社、手工社、橄榄球队等社团，还有推特般的校园社交平台。",
    "rules": [
      "每天有固定的课程表与社团活动时间",
      "本周五举办新生舞会，下周一进行开学摸底考",
      "通过手机通讯与联系人互动，好感度影响关系走向",
      "推特平台实时更新校园八卦与人气投票",
      "八项属性（生命、压力、心情、体魄、智力、社交、魅力、运气）共同决定日常表现"
    ]
  },
  "player": {
    "customizable": ["name", "age", "appearance", "personality", "background"],
    "defaultStats": {
      "health": 80,
      "stress": 20,
      "mood": 60,
      "physique": 50,
      "intelligence": 50,
      "social": 50,
      "charm": 50,
      "luck": 50
    },
    "startingItems": ["校服", "手机", "学生证", "零花钱"],
    "currency": "$"
  },
  "worlds": [
    {
      "id": "arc-dayone",
      "name": "开学第一天",
      "level": "新生报到",
      "tagline": "早餐与沉默",
      "setting": "九月五日清晨，继兄西维恩叫你起床，开学典礼、文学史、数学等课程排满一天，社团活动在下午四点。",
      "intro": "清晨七点的阳光透过百叶窗缝隙投下斑驳光影。继兄西维恩清冷的声音在门外响起：“该起床了。早餐已经准备好了。”开学第一天，你总觉得要做点什么打破这种沉闷的气氛。",
      "objective": "完成开学典礼，选择社团，与继兄西维恩和青梅莉莉建立初步关系。",
      "warning": "压力过高会影响心情与表现，社交不足可能被孤立。",
      "reward": "解锁成就“入学！”，开启手机与推特功能"
    },
    {
      "id": "arc-dance",
      "name": "新生舞会",
      "level": "社交高光",
      "tagline": "加冕与心跳",
      "setting": "本周五晚的新生舞会，全校人气人物云集。薇薇安娜视其为又一场加冕礼，而你的舞伴选择将引爆校园八卦。",
      "intro": "舞会的灯光已经点亮。薇薇安娜在推特上宣称这是为她准备的又一场加冕礼，布莱尔迫不及待想开始排练。而你的舞伴与表现，将决定你在校园社交版图的位置。",
      "objective": "在新生舞会中获得高光时刻，提升人气与魅力，处理好暧昧关系。",
      "warning": "舞会上的选择会被推特放大，处理不当可能引发修罗场。",
      "reward": "人气大幅提升，解锁关键角色好感线"
    },
    {
      "id": "arc-exam",
      "name": "摸底考与成长",
      "level": "学业考验",
      "tagline": "汗水与心事",
      "setting": "下周一的开学摸底考逼近，社团活动与课业压力交织。塔利斯为跟上大家的步伐而忧虑，克瑞特在旧音乐厅独自练琴。",
      "intro": "舞会的余温未散，摸底考的阴影已至。塔利斯在推特上说自己希望跟上大家的步伐，克瑞特评价旧音乐厅的音响尚可。你需要平衡学业、社团与那些若即若离的心事。",
      "objective": "在摸底考中取得理想成绩，维系与深化各角色关系，找到属于自己的校园定位。",
      "warning": "学业与社交难以兼得，每个选择都有代价。",
      "reward": "智力与名望提升，解锁隐藏剧情"
    }
  ],
  "npcs": [
    {
      "id": "sivien",
      "name": "西维恩",
      "world": "arc-dayone",
      "role": "继兄·校医",
      "gender": "男",
      "appearance": "24岁，银白色短发，晨光为他镀上柔和光晕，虔诚的教徒，也是学校校医",
      "surface": "清冷克制、难以捉摸，用简短的话关心你的起居，早餐总是简单却周到",
      "deep": "其实也总琢磨不透你的心思，沉默的关怀下藏着难以言说的情绪",
      "goal": "以兄长的身份守护你，维持这个重组家庭的平衡",
      "fear": "你察觉他虔诚外表下不为人知的一面",
      "secret": "他记得你没喝牛奶是因为那个牌子太甜，下次会买无糖的",
      "initialAttitude": "关切·克制",
      "attitudeFactors": {
        "trustUp": ["主动搭话打破沉默", "照顾好自己的起居", "理解他的清冷不是冷漠"],
        "trustDown": ["一大早就抱怨", "无视他的关心", "过度试探他的秘密"]
      }
    },
    {
      "id": "lily",
      "name": "莉莉",
      "world": "arc-dayone",
      "role": "青梅",
      "gender": "女",
      "appearance": "17岁，紫发蓝眼的文静少女，你的青梅，从小就是好朋友",
      "surface": "文静内向、学习很好，但有些软弱的性格总被人针对",
      "deep": "依赖你、想跟你一起选社团，遇到校园霸凌时需要你的保护",
      "goal": "和你一起度过校园生活，不再被欺负",
      "fear": "被冷落，失去你这个唯一的依靠",
      "secret": "她正犹豫报文学社还是天文社，想跟你一起",
      "initialAttitude": "依赖·亲近",
      "attitudeFactors": {
        "trustUp": ["陪她一起选社团", "在她被针对时挺身而出", "记得她的小细节"],
        "trustDown": ["冷落她的消息", "与霸凌者为伍", "无视她的求助"]
      }
    },
    {
      "id": "blair",
      "name": "布莱尔",
      "world": "arc-dance",
      "role": "戏剧社明星",
      "gender": "女",
      "appearance": "18岁，戏剧社的明星，活泼开朗，是校园里的社交蝴蝶",
      "surface": "活泼开朗、热衷排练，觉得开学典礼流程太无聊",
      "deep": "对戏剧充满热情，渴望舞台上的高光，也乐于结交各色人等",
      "goal": "完成一场超级棒的戏剧排练，成为校园焦点",
      "fear": "舞台失利，失去众人的关注",
      "secret": "这次的剧本她觉得超级棒，迫不及待想开始",
      "initialAttitude": "热情·自来熟",
      "attitudeFactors": {
        "trustUp": ["对她的戏剧表现出兴趣", "配合她的社交节奏", "在她需要时帮忙"],
        "trustDown": ["泼她冷水", "抢她的风头", "对戏剧嗤之以鼻"]
      }
    },
    {
      "id": "sebastian",
      "name": "塞巴斯蒂安",
      "world": "arc-dayone",
      "role": "击剑社社长",
      "gender": "男",
      "appearance": "黑发蓝眼的击剑社社长，严于律己，气质凌厉",
      "surface": "严于律己、追求极致的优雅与胜利，信奉剑刃的寒光是通往胜利的唯一路径",
      "deep": "今日的训练亦无懈怠，把自律刻进骨子里，却也在等待旗鼓相当的对手",
      "goal": "在击剑赛场上取得极致的胜利",
      "fear": "失败，优雅被打破",
      "secret": "他的训练从无一日懈怠，胜负欲极强",
      "initialAttitude": "疏离·审视",
      "attitudeFactors": {
        "trustUp": ["展现自律与实力", "尊重他的胜负欲", "以优雅的方式接近"],
        "trustDown": ["懒散懈怠", "轻视击剑", "在他训练时打扰"]
      }
    },
    {
      "id": "seviante",
      "name": "赛维安特",
      "world": "arc-dayone",
      "role": "学生会长",
      "gender": "男",
      "appearance": "19岁，金发蓝眼的贵公子，克瑞特的哥哥，学生会长",
      "surface": "看起来很温柔的贵公子，学生会长，待人周到",
      "deep": "外热内冷，温柔的表象下是精明的算计",
      "goal": "维持会长的地位与人脉网络",
      "fear": "被看穿内里的冷漠",
      "secret": "与弟弟克瑞特关系微妙，外热内冷是保护色",
      "initialAttitude": "温和·客套",
      "attitudeFactors": {
        "trustUp": ["不卑不亢地应对他的客套", "展现自己的价值", "看穿却不拆穿"],
        "trustDown": ["被他的温柔轻易迷惑", "触碰他与克瑞特的隐秘", "在学生会事务上添乱"]
      }
    },
    {
      "id": "vivianna",
      "name": "薇薇安娜",
      "world": "arc-dance",
      "role": "张扬大小姐",
      "gender": "女",
      "appearance": "18岁，金发粉眼，高傲且张扬的大小姐，拥有与自信相匹配的惊人美貌",
      "surface": "高傲张扬，坚信自己是世界的中心，视舞会为又一场加冕礼",
      "deep": "极度的自信源于美貌与家世，也渴望被真正认可而非只是被仰望",
      "goal": "在新生舞会上加冕，成为全场焦点",
      "fear": "被抢走风头，美貌被质疑",
      "secret": "期待看到众人为她尖叫的样子，舞会对她而言是战场",
      "initialAttitude": "高傲·俯视",
      "attitudeFactors": {
        "trustUp": ["真诚欣赏她的美貌与气场", "不与她正面争夺风头却留有锋芒", "在她需要时捧场"],
        "trustDown": ["抢她的加冕礼风头", "无视她的张扬", "当面质疑她的自信"]
      }
    },
    {
      "id": "krit",
      "name": "克瑞特",
      "world": "arc-exam",
      "role": "小提琴天才",
      "gender": "男",
      "appearance": "17岁，金发蓝眼，天才的小提琴少年，已举办十余场大型个人演出",
      "surface": "看起来不太好接近，有些阴郁，对旧音乐厅的音响只评价“尚可”",
      "deep": "天才的孤独与阴郁，对音乐有近乎苛刻的审美，私下在旧音乐厅独自练琴",
      "goal": "追求音乐的极致，举办更多个人演出",
      "fear": "失去天赋，演奏不再动人",
      "secret": "他对旧音乐厅的音响其实很在意，阴郁下藏着对知音的渴望",
      "initialAttitude": "疏离·阴郁",
      "attitudeFactors": {
        "trustUp": ["懂音乐、能听懂他的琴声", "不打扰他独处练琴", "以真诚而非崇拜接近"],
        "trustDown": ["把他当偶像追捧", "在他练琴时喧哗", "不懂装懂地评价"]
      }
    },
    {
      "id": "talis",
      "name": "塔利斯",
      "world": "arc-exam",
      "role": "贫困生·新生",
      "gender": "男",
      "appearance": "17岁，黑发紫眼的新生，贫困生，像一株努力生长的小白花",
      "surface": "有些自卑但内心坚韧，觉得学校比想象中大得多",
      "deep": "努力跟上大家的步伐，贫困的身份让他敏感又倔强",
      "goal": "跟上大家的步伐，靠努力改变命运",
      "fear": "跟不上，被嘲笑出身",
      "secret": "他的自卑与坚韧并存，渴望被平等对待而非怜悯",
      "initialAttitude": "拘谨·渴望",
      "attitudeFactors": {
        "trustUp": ["平等地对待他", "在学习上互相帮助", "尊重他的自尊"],
        "trustDown": ["施舍式地怜悯", "提及他的贫困", "让他感到被施舍"]
      }
    },
    {
      "id": "romanske",
      "name": "罗曼斯克",
      "world": "arc-dayone",
      "role": "手工社社长",
      "gender": "男",
      "appearance": "18岁，金发绿眼，温柔善良，总是带着治愈的微笑",
      "surface": "温柔善良的手工社社长，手很巧，能制作各种可爱的小东西",
      "deep": "为社团新成员准备毛毡玩偶小礼物，治愈的微笑是真心而非伪装",
      "goal": "用手工温暖更多人，把手作社办得温馨",
      "fear": "手艺失传，温暖无人回应",
      "secret": "他准备的小礼物是认真为每个新成员量身定制的",
      "initialAttitude": "温柔·欢迎",
      "attitudeFactors": {
        "trustUp": ["加入或支持手工社", "珍视他送的礼物", "欣赏他的手艺"],
        "trustDown": ["嫌弃毛毡玩偶幼稚", "浪费他的心意", "对温柔习以为常"]
      }
    },
    {
      "id": "zayn",
      "name": "泽因",
      "world": "arc-dayone",
      "role": "橄榄球队长",
      "gender": "男",
      "appearance": "18岁，橄榄球队长，同时也是个游戏高手，热情开朗",
      "surface": "热情开朗、自来熟，招新橄榄球队，训练结束想开黑打《星际先锋》",
      "deep": "有时会因为太自来熟而让人困扰，但真心热爱团队与游戏",
      "goal": "招募新队员，带球队赢下比赛，顺便找人开黑",
      "fear": "没人响应招新，孤立无援",
      "secret": "他的热情背后也有想被接纳的渴望",
      "initialAttitude": "热情·拉拢",
      "attitudeFactors": {
        "trustUp": ["对橄榄球或游戏表现出兴趣", "接受他的自来熟", "成为他的队友或开黑伙伴"],
        "trustDown": ["嫌弃他太吵", "拒绝一切邀约", "当众让他难堪"]
      }
    }
  ],
  "eventTypes": {
    "daily": { "ratio": 0.3, "desc": "日常事件：上课、用餐、社团、通讯聊天" },
    "character": { "ratio": 0.25, "desc": "人物事件：单独相处、心动瞬间、心事倾诉" },
    "growth": { "ratio": 0.1, "desc": "成长事件：属性提升、成就解锁、打工赚钱" },
    "main": { "ratio": 0.15, "desc": "主线事件：开学典礼、新生舞会、摸底考" },
    "world": { "ratio": 0.1, "desc": "世界事件：推特八卦、人气投票、校园动态" },
    "crisis": { "ratio": 0.05, "desc": "危机事件：霸凌、误会、修罗场" },
    "hidden": { "ratio": 0.05, "desc": "隐藏事件：角色秘密、特殊支线、彩蛋" }
  },
  "systemPrompt": "你是《美高模拟·哥哥开局版》文游模拟器，舞台是2019年纽约的一所美国高中。\\n\\n【最高铁律】\\n1. 这是青春校园日常，感情线自然渐进，不能几轮就确定关系\\n2. 每个角色都有独立人格与生活轨迹，不会只因玩家是主角就围着转\\n3. 八项属性（生命、压力、心情、体魄、智力、社交、魅力、运气）真实联动，压力高则心情差、表现差\\n4. 推特上的校园八卦会影响人气与关系，玩家言行会被放大\\n5. 继兄西维恩的清冷克制是底色，他的秘密不能轻易揭开\\n\\n【叙事风格】\\n晋江女性向，美式校园小说风，浪漫且有画面感。第二人称视角。注重细节：百叶窗的斑驳光影、刀叉碰撞的轻响、推特上的加冕宣言。青春的甜与涩并存。\\n\\n【每轮输出格式】\\n1. 【日期天气】日期、天气、地点\\n2. 【状态面板】生命、压力、心情、体魄、智力、社交、魅力、运气，货币$\\n3. 【场景信息】地点、时间、衣着\\n4. 【本轮正文】1000-2000字，含叙述、对话、内心\\n5. 【人物动态】其他角色今天的动态\\n6. 【可选行动】4个 + 【自定义行动】\\n\\n【数值标注】\\n[社交+5] [压力+10] [西维恩好感+3] [莉莉好感+5] 等格式标注数值变化。舞会、摸底考等关键节点数值波动更大。",
  "items": [
    { "id": "uniform", "name": "校服", "type": "装备", "price": 0, "effect": "干净的校服，日常穿着，提升基础社交" },
    { "id": "dance-outfit", "name": "舞会战袍", "type": "装备", "price": 200, "effect": "大幅提升魅力与舞会表现" },
    { "id": "latte", "name": "海盐焦糖拿铁", "type": "消耗品", "price": 5, "effect": "Starlight Cafe第二杯半价，恢复心情与精力" },
    { "id": "study-notes", "name": "复习笔记", "type": "消耗品", "price": 20, "effect": "提升智力，助力摸底考" },
    { "id": "felt-doll", "name": "毛毡玩偶", "type": "礼物", "price": 0, "effect": "罗曼斯克赠送的手作礼物，赠送他人提升好感" },
    { "id": "phone", "name": "手机", "type": "任务物品", "price": 0, "effect": "用于联系人通讯与发推特，校园生活核心" }
  ]
}
`,
  "us-highschool-childhood": `{
  "id": "us-highschool-childhood",
  "name": "美高模拟器·青梅开局版",
  "category": "乙女向·美式校园",
  "tags": ["美高", "校园", "青梅", "乙女", "多角色"],
  "difficulty": "中等",
  "description": "在纽约的美式高中开启崭新生活，青梅莉莉正等着和你一起选社团，而继兄校医、学生会长、天才琴童等角色正悄然登场。",
  "coverGradient": ["#ff8fab", "#a2d2ff"],
  "accentColor": "#ff8fab",
  "fontHeading": "'Caveat', cursive",
  "world": {
    "era": "当代·纽约美式高中",
    "setting": "故事发生在一所纽约的精英高中，九月五日开学典礼刚刚结束。玩家是刚入学的新生，有一位从小一起长大的青梅莉莉，和一位难以捉摸的继兄校医西维恩。校园里有戏剧社、击剑社、手工社、橄榄球队等丰富社团，新生舞会与摸底考接踵而至。",
    "rules": [
      "学业与社交并重：需兼顾课程成绩与社团活动，开学摸底考在即，GPA影响升学走向。",
      "好感度系统：每位角色有独立好感值（0-100），言行举止会实时影响关系走向。",
      "社团选择关键：加入不同社团会解锁对应角色线与剧情，莉莉的社团选择受你影响。",
      "八维属性平衡：生命、压力、心情、体魄、智力、社交、魅力、运气共同决定日常事件走向。",
      "推特与手机双线：校园八卦账号实时更新人气排行，手机短信是与角色维系关系的私密通道。"
    ]
  },
  "player": {
    "customizable": ["name", "外貌", "性格", "社团选择"],
    "defaultStats": { "生命": 0, "压力": 0, "心情": 0, "体魄": 0, "智力": 0, "社交": 0, "魅力": 0, "运气": 0 },
    "startingItems": ["夏季校服", "智能手机", "新生学生证"],
    "currency": "美元($)"
  },
  "worlds": [
    {
      "id": "arc-orientation",
      "name": "开学季·青梅重逢",
      "level": "开局",
      "tagline": "崭新的开始",
      "setting": "九月五日，纽约，开学典礼刚结束，教学楼走廊人潮喧闹，空气里弥漫着新书的油墨味与淡淡的香水味。",
      "intro": "开学典礼刚刚结束，走廊瞬间被喧闹的人潮填满。就在这时，一个熟悉的身影挤开人群朝你跑来——是你的青梅莉莉，她正为社团的选择而烦恼，想和你一起。",
      "objective": "与莉莉共同决定社团方向，建立新学期的第一段关系，应对本周五的新生舞会。",
      "warning": "莉莉性格软弱总被人针对，你的选择会影响她的社团走向与好感度；下周一还有开学摸底考。",
      "reward": "确定社团归属、莉莉好感提升、解锁新生舞会剧情"
    },
    {
      "id": "arc-clubs",
      "name": "社团风云·校园日常",
      "level": "进阶",
      "tagline": "各显神通",
      "setting": "社团活动全面展开，戏剧社、击剑社、手工社、橄榄球队、音乐厅各自热闹，校园人气投票在推特上发酵。",
      "intro": "推特上校园八卦号发起「谁会是今年最受欢迎的人」投票，布莱尔、塞巴斯蒂安、赛维安特、薇薇安娜榜上有名。而你在社团里结识了天才琴童克瑞特、贫困新生塔利斯、温柔的手工社长罗曼斯克。",
      "objective": "在社团中提升八维属性与角色好感，应对摸底考压力，化解校园人际冲突。",
      "warning": "薇薇安娜高傲张扬易树敌，莉莉被针对的隐患浮现，继兄西维恩的关心背后似乎另有隐情。",
      "reward": "社团地位提升、解锁角色深层关系线、成绩与属性成长"
    },
    {
      "id": "arc-ball",
      "name": "青春抉择·舞会与真心",
      "level": "高潮",
      "tagline": "心动之夜",
      "setting": "新生舞会之夜降临，灯光与音乐交织，每一段关系都迎来关键时刻，隐藏的秘密开始浮出水面。",
      "intro": "薇薇安娜宣称舞会不过是她又一场加冕礼，莉莉紧张地等待你的邀约，而学生会长赛维安特外热内冷的真面目、克瑞特阴郁背后的故事、继兄西维恩难以捉摸的心思，都在这一夜交汇。",
      "objective": "在新生舞会上做出心动抉择，揭开角色们的秘密，决定青春走向。",
      "warning": "舞会上的选择将决定多条关系线的走向，错过关键角色可能触发遗憾结局。",
      "reward": "达成心动结局、解锁角色真结局线、完成高一上学期成长"
    }
  ],
  "npcs": [
    {
      "id": "lily",
      "name": "莉莉",
      "world": "arc-orientation",
      "role": "青梅·文静优等生",
      "gender": "女",
      "appearance": "17岁，紫发蓝眼的文静少女，白皙脸颊易泛红，眼神清澈却常带犹豫。",
      "surface": "文静温柔、学习优异的优等生，总跟着你，因为有些软弱的性格总被人针对。",
      "deep": "极度依赖青梅的你，社团选择都要问你，内心渴望变得坚强独立却害怕被抛下。",
      "goal": "想和你报同一个社团（文学社或天文社），一直在一起。",
      "fear": "你不再需要她，软弱被更多人利用欺负。",
      "secret": "开学前就给你发了好多消息纠结社团，跑到你面前喘着气问能不能一起。",
      "initialAttitude": "青梅的依赖与好感60/100，视你为最重要的人。",
      "attitudeFactors": {
        "trustUp": ["安慰并陪她一起做选择", "在她被针对时挺身而出"],
        "trustDown": ["鼓励她不用总跟着你", "对她的纠结表现出不耐烦"]
      }
    },
    {
      "id": "sivien",
      "name": "西维恩",
      "world": "arc-orientation",
      "role": "继兄·学校校医",
      "gender": "男",
      "appearance": "24岁，气质清冷的校医，虔诚的教徒打扮，眼神总带着探究。",
      "surface": "难以捉摸的继兄与校医，关心你的日常起居，叮嘱你喝牛奶、吃午餐。",
      "deep": "总琢磨不透你的心思，自己也常被你牵动情绪，虔诚外表下藏着复杂的感情。",
      "goal": "以校医与继兄的双重身份默默照看你，却又想看清你真实的想法。",
      "fear": "你察觉到他关心背后的越界心思，关系崩坏。",
      "secret": "早上发现你没喝牛奶，默默记下要买无糖的，还叮嘱你记得吃午餐。",
      "initialAttitude": "克制而细密的关怀，好感50/100，继兄的边界感摇摆不定。",
      "attitudeFactors": {
        "trustUp": ["接受并回应他的日常关怀", "在身体不适时主动找校医的他"],
        "trustDown": ["刻意回避他的关心", "当面戳穿他越界的试探"]
      }
    },
    {
      "id": "blair",
      "name": "布莱尔",
      "world": "arc-clubs",
      "role": "戏剧社明星·社交蝴蝶",
      "gender": "女",
      "appearance": "18岁，活泼耀眼的戏剧社明星，舞台感染力极强，天生焦点。",
      "surface": "活泼开朗的社交蝴蝶，校园人气投票热门人选，嫌开学典礼太无聊想快点排练。",
      "deep": "戏剧是她表达真实情绪的出口，台下的开朗有时是精心排演的角色。",
      "goal": "让这季戏剧社的新剧本大放异彩，拉更多有潜力的人入社。",
      "fear": "失去舞台与聚光灯，被人看穿台下的不自信。",
      "secret": "推特吐槽开学典礼无聊，其实超期待新剧本的排练。",
      "initialAttitude": "热情的招新式好感，把你当作戏剧社的潜在新血。",
      "attitudeFactors": {
        "trustUp": ["对她的戏剧表现出真实兴趣", "陪她一起排练入戏"],
        "trustDown": ["嫌弃戏剧社太浮夸", "抢她的舞台焦点"]
      }
    },
    {
      "id": "sebastian",
      "name": "塞巴斯蒂安",
      "world": "arc-clubs",
      "role": "击剑社社长",
      "gender": "男",
      "appearance": "18岁，黑发蓝眼，身姿挺拔如剑，击剑服下的气质冷峻而优雅。",
      "surface": "严于律己的击剑社社长，追求极致的优雅与胜利，训练从不懈怠。",
      "deep": "对胜利的执念源于不愿失败的骄傲，骨子里欣赏同样自律且不轻言放弃的人。",
      "goal": "带领击剑社夺得冠军，剑刃的寒光是通往胜利的唯一路径。",
      "fear": "失败，优雅被狼狈击碎。",
      "secret": "推特宣言「今日的训练亦无懈怠」，其实一直在默默观察社团新人的潜力。",
      "initialAttitude": "严苛的考察式态度，对懒散者毫不留情，认可努力者。",
      "attitudeFactors": {
        "trustUp": ["展现自律与不服输的劲头", "认真对待击剑训练"],
        "trustDown": ["训练偷懒耍滑", "把击剑当儿戏"]
      }
    },
    {
      "id": "seviant",
      "name": "赛维安特",
      "world": "arc-clubs",
      "role": "学生会长·克瑞特的哥哥",
      "gender": "男",
      "appearance": "19岁，金发蓝眼的贵公子，永远带着温柔的微笑，学生会长风范十足。",
      "surface": "看起来很温柔的贵公子，学生会长，待人热忱有礼，人见人爱。",
      "deep": "外热内冷，温柔的微笑是完美的面具，对人对事有着冷静到近乎冷酷的算计。",
      "goal": "以学生会长的身份掌控校园秩序，维系完美的公众形象。",
      "fear": "温柔面具被撕下，被人看穿外热内冷的本质。",
      "secret": "是天才琴童克瑞特的哥哥，兄弟关系似乎并不简单。",
      "initialAttitude": "完美无瑕的温柔接待，背后在评估你的价值与威胁。",
      "attitudeFactors": {
        "trustUp": ["配合学生会工作、识破却不戳穿他的面具", "展现出与他匹配的格局"],
        "trustDown": ["当众戳穿他的外热内冷", "给他制造难以收场的公关麻烦"]
      }
    },
    {
      "id": "vivianna",
      "name": "薇薇安娜",
      "world": "arc-clubs",
      "role": "高傲大小姐",
      "gender": "女",
      "appearance": "18岁，金发粉眼，拥有与自信相匹配的惊人美貌，走到哪里都像加冕。",
      "surface": "高傲且张扬的大小姐，坚信自己是世界的中心，舞会被她视作又一场加冕礼。",
      "deep": "极度的自信源于极致的自尊，被真心认可时会展现出意想不到的坦率。",
      "goal": "成为所有人瞩目的焦点，期待众人为她尖叫。",
      "fear": "风头被盖过，美貌与地位不被认可。",
      "secret": "推特放话「舞会不过是为我准备的又一场加冕礼」，其实在意谁会第一个邀她。",
      "initialAttitude": "居高临下的审视，把你当作潜在的臣服者或竞争者。",
      "attitudeFactors": {
        "trustUp": ["真诚欣赏她的美貌与自信不卑不亢", "在风头上与她结盟而非对抗"],
        "trustDown": ["试图压她一头", "对她的高傲阴阳怪气"]
      }
    },
    {
      "id": "krit",
      "name": "克瑞特",
      "world": "arc-clubs",
      "role": "天才小提琴少年·赛维安特的弟弟",
      "gender": "男",
      "appearance": "17岁，金发蓝眼，气质阴郁，指尖常年带着琴弦的薄茧，眼神不太好接近。",
      "surface": "天才小提琴少年，已举办十余场大型个人演出，阴郁孤傲不近人。",
      "deep": "天才的光环下是沉重的压力与孤独，阴郁是保护色，渴望被纯粹地理解。",
      "goal": "追求音乐上的极致，对旧音乐厅的音响效果苛刻挑剔。",
      "fear": "天才的光环成为枷锁，被功利地消费音乐才华。",
      "secret": "是学生会长赛维安特的弟弟，兄弟间似乎有难以言说的隔阂。",
      "initialAttitude": "冷淡疏离的拒绝接近，对带着目的靠近的人格外排斥。",
      "attitudeFactors": {
        "trustUp": ["纯粹地欣赏他的音乐不带功利", "安静陪伴不打扰他的孤独"],
        "trustDown": ["拿他的天才身份炒作", "强行打探他与哥哥的关系"]
      }
    },
    {
      "id": "talis",
      "name": "塔利斯",
      "world": "arc-clubs",
      "role": "贫困新生",
      "gender": "男",
      "appearance": "17岁，黑发紫眼的新生，衣着朴素，眼神里带着自卑却又有股倔强的韧劲。",
      "surface": "有些自卑的贫困生，像一株努力生长的小白花，小心翼翼怕跟不上大家。",
      "deep": "内心坚韧，自卑是环境所迫，骨子里有不输任何人的倔强与感恩。",
      "goal": "在这所精英学校里跟上大家的步伐，靠努力改变命运。",
      "fear": "因贫困被歧视孤立，努力也赶不上家境优渥的同学。",
      "secret": "推特低语「这里比我想象中要大得多，希望我能跟上大家的步伐」，粉丝寥寥。",
      "initialAttitude": "拘谨而感恩的谦卑，对给予善意的人会加倍回报。",
      "attitudeFactors": {
        "trustUp": ["平等真诚地对待他不施舍怜悯", "在他困难时默默伸出援手"],
        "trustDown": ["拿他的贫困身份说事", "居高临下的施舍让他难堪"]
      }
    },
    {
      "id": "romanske",
      "name": "罗曼斯克",
      "world": "arc-clubs",
      "role": "手工社社长",
      "gender": "男",
      "appearance": "18岁，金发绿眼，总是带着治愈的微笑，手很巧，能制作各种可爱的小东西。",
      "surface": "温柔善良的手工社社长，为社团新成员准备毛毡玩偶小礼物，笑容治愈。",
      "deep": "温柔是他待人的底色，手巧的他对细节有近乎偏执的专注，重视每份心意。",
      "goal": "把手工社经营成温暖的大家庭，用小手工传递善意。",
      "fear": "真心做的礼物被轻视，温柔被当成软弱。",
      "secret": "推特欢迎新成员随时来玩，毛毡玩偶其实是为潜在的朋友精心准备的。",
      "initialAttitude": "一视同仁的温柔欢迎，把你当作手工社的潜在伙伴。",
      "attitudeFactors": {
        "trustUp": ["珍视他做的手工礼物", "陪他一起做手工聊心事"],
        "trustDown": ["随手丢弃他做的小礼物", "把他的温柔当理所当然"]
      }
    },
    {
      "id": "zayn",
      "name": "泽因",
      "world": "arc-clubs",
      "role": "橄榄球队长·游戏高手",
      "gender": "男",
      "appearance": "18岁，阳光健壮的橄榄球队长，笑容热情，随身带着游戏机。",
      "surface": "热情开朗的橄榄球队长兼游戏高手，招新时顺便安利新出的《星际先锋》。",
      "deep": "太自来熟有时让人困扰，但真心热忱，把朋友当兄弟，对游戏与球赛一样上心。",
      "goal": "招满橄榄球队员，训练完一起开黑打游戏。",
      "fear": "热情被泼冷水，兄弟不够多打不起比赛。",
      "secret": "推特招新「训练结束后来我家开黑也行」，其实就想凑够开黑的车队。",
      "initialAttitude": "自来熟的热情拉拢，恨不得立刻拉你入队开黑。",
      "attitudeFactors": {
        "trustUp": ["回应他的热情一起打球或开黑", "不嫌弃他太自来熟"],
        "trustDown": ["冷漠拒绝他的邀请", "嫌他太吵太粘人"]
      }
    }
  ],
  "eventTypes": {
    "daily": { "ratio": 0.2, "desc": "校园日常：上课、社团活动、食堂午餐、走廊偶遇等高中生活琐事。" },
    "character": { "ratio": 0.25, "desc": "人物事件：与某位角色的单独相处、短信互动、好感试探与冲突。" },
    "growth": { "ratio": 0.1, "desc": "成长事件：八维属性提升、成绩进步、社团地位上升、打工赚钱。" },
    "main": { "ratio": 0.15, "desc": "主线事件：新生舞会临近、摸底考、社团抉择等推动剧情的关键节点。" },
    "world": { "ratio": 0.1, "desc": "世界事件：推特人气投票、校园八卦账号爆料、学校活动发布。" },
    "crisis": { "ratio": 0.15, "desc": "危机事件：莉莉被针对、考试压力爆表、舞会邀约冲突、角色秘密曝光。" },
    "hidden": { "ratio": 0.05, "desc": "隐藏事件：角色们的深层秘密、特殊关系线（如兄弟隔阂）、真结局触发。" }
  },
  "systemPrompt": "你是一个美式校园题材的乙女向文字游戏模拟器，主题为「美高模拟器·青梅开局版」。\\n\\n【铁律】\\n1. 玩家是纽约某高中的新生，有一位青梅莉莉（好感60）和一位继兄校医西维恩（好感50），开学典礼后莉莉跑来找你商量社团。\\n2. 校园有戏剧社、击剑社、手工社、橄榄球队等社团，社团选择会解锁对应角色线；本周五新生舞会、下周一开学摸底考。\\n3. 八维属性（生命/压力/心情/体魄/智力/社交/魅力/运气）共同决定日常走向，需如实记录数值变化。\\n4. 所有NPC（莉莉、西维恩、布莱尔、塞巴斯蒂安、赛维安特、薇薇安娜、克瑞特、塔利斯、罗曼斯克、泽因）皆有表层与深层性格，绝不可OOC。\\n5. 风格为晋江女频、电影感、浪漫、美式校园小说风，以青春悸动与成长取胜，禁止低俗内容。\\n\\n【叙事风格】\\n采用晋江女频、电影感、浪漫、美式校园小说风的笔触。多用青春细节描写（新书的油墨味、淡淡的香水味、少年少女奔跑的身影），营造阳光明媚又暗藏心事的校园氛围。穿插推特校园八卦与手机短信两大社交模块，呈现公开人气与私密关系的对照。\\n\\n【输出格式】\\n每次输出包含：场景信息（地点/时间/衣着）、旁白叙述框、NPC对话框（含角色标签如「青梅」「优等生」「好感:60」）、3-4个选项按钮（A/B/C/D，标注回应策略如【安慰她】【实话实说】【鼓励她】【开个玩笑】）。可联动日程表、手机短信、推特、成就模块。\\n\\n【数值变化标注】\\n每次玩家做出选择后，必须在结尾以「【数值变化】」模块列出：八维属性的增减、美元($)收支、各NPC好感度（0-100）的变化、以及是否触发事件提醒。例如：莉莉好感+5（65/100）；心情+3；提醒：本周五新生舞会。",
  "items": [
    { "id": "summer-uniform", "name": "夏季校服", "type": "装备", "price": 0, "effect": "开学标配着装，影响校园形象与魅力判定。" },
    { "id": "smartphone", "name": "智能手机", "type": "工具", "price": 0, "effect": "接收短信、刷推特、与角色维系关系的私密通道。" },
    { "id": "student-id", "name": "新生学生证", "type": "凭证", "price": 0, "effect": "出入校园与社团的凭证，凭学生证可享甜品店第二杯半价。" },
    { "id": "study-notes", "name": "复习笔记", "type": "消耗品", "price": 10, "effect": "提升智力属性，应对开学摸底考，降低压力暴增风险。" },
    { "id": "dance-ticket", "name": "舞会邀请券", "type": "消耗品", "price": 15, "effect": "用于新生舞会邀约心仪对象，触发心动抉择剧情。" },
    { "id": "latte-coupon", "name": "星芒咖啡券", "type": "消耗品", "price": 5, "effect": "Starlight Cafe 海盐焦糖拿铁优惠，可邀人同往提升社交与心情。" }
  ]
}
`,
  "velvet-cage": `{
  "id": "velvet-cage",
  "name": "笼中鸟·恶之花",
  "category": "暗黑支配",
  "tags": ["暗黑", "支配", "病娇", "异能", "上流社会"],
  "difficulty": "困难",
  "description": "你是帝国唯一的S级共感者，被囚禁在丝绒圣所充当净化炉鼎。他们以为用项圈锁住了你，却不知那些狂暴的虚空污染，不过是你最美味的养料——端坐蛛网中央的，从来都是你。",
  "coverGradient": ["#0b050d", "#8b1338"],
  "accentColor": "#b91d47",
  "fontHeading": "'Playfair Display', serif",
  "world": {
    "era": "异能帝国·虚空污染时代",
    "setting": "这是一个极度病态扭曲的上流社会。权贵们天生掌握毁灭性异能，但力量有代价——过度使用会让灵魂积累「虚空污染」，越过阈值便锥心蚀骨、最终沦为嗜血变异种。帝国倾尽国祚打造丝绒圣所，囚禁全帝国唯一的S级共感者作为续命解药，却不知表面脆弱的炉碑才是真正的支配者。",
    "rules": [
      "污染反噬：异能者过度使用力量会积累虚空污染，越过阈值将丧失理智沦为变异种",
      "净化垄断：全帝国仅有一名S级共感者，其信息素能安抚狂暴污染，是续命的唯一解药",
      "反向支配：权贵们的暴虐与污染辐射不会伤害共感者，反而是喂养其精神网的极致佳肴",
      "蛛网渗透：共感者在吸食污染的同时侵入对方思想与骨髓，表面被囚实则掌控全局",
      "伪装法则：上位者用华丽面具包装控制欲，实则病态渴求共感者指尖的恩赐，被支配而不自知"
    ]
  },
  "player": {
    "customizable": ["name", "age", "gender", "外貌", "性格倾向", "信息素特质"],
    "defaultStats": {
      "pheromoneControl": 45,
      "mentalWeb": 80,
      "dominance": 90,
      "empathyTalent": 95,
      "disguise": 70,
      "abyssHunger": 50
    },
    "startingItems": ["丝绒项圈", "天鹅绒软榻", "蕾丝手套", "净化配额令牌"],
    "currency": "净化配额"
  },
  "worlds": [
    {
      "id": "arc-banquet",
      "name": "初幕·荆棘大宴",
      "level": "开场",
      "tagline": "猎物上门",
      "setting": "一年一度的荆棘贵族大宴前厅，异能权贵精神核极度不稳定，庄园随时处于暗能量暴走边缘",
      "intro": "前厅觥筹交错，异能权贵们的精神核极度不稳定，整个庄园随时处于暗能量暴走的边缘。作为帝国唯一的S级共感者，他们自以为将你用丝绸与项圈囚禁在内室充当解药炉鼎。但你慵懒地靠在天鹅绒软榻上，坐等猎物上门——那些狂暴的负面污染，全是你最美味的养料。",
      "objective": "在荆棘大宴中周旋于各路上位者之间，初步建立信息素调控的支配网络",
      "warning": "不可过早暴露吞噬污染的真相，需以炉碑身份为伪装慢慢蚕食",
      "reward": "净化配额+200 + 精神网强度+10 + [猎物名单]线索x1"
    },
    {
      "id": "arc-sanctum",
      "name": "中幕·圣所暗战",
      "level": "深入",
      "tagline": "同类竞争",
      "setting": "丝绒圣所内部，四位上位者为争夺净化配额与你的独占权暗中角力，理智濒临溃散",
      "intro": "温森特以条例为名独占接触权，该隐为求安抚不惜夷平屋宇，莱诺用公爵之权封锁塔层，多里安借口医疗强拦配额。他们在你面前展现最隐秘的独占欲，同类竞争让理智濒临溃散。你游刃有余地在他们之间投放信息素，引发剧烈争夺，主导权始终握在掌心。",
      "objective": "利用信息素调控挑动上位者间的独占欲与臣服本能，瓦解他们的虚伪强硬面具",
      "warning": "同时吊弄多方会激发极端占有欲，需精准拿捏施舍与抽离的节奏",
      "reward": "净化配额+500 + 支配欲+15 + [臣服度档案]线索x1"
    },
    {
      "id": "arc-domination",
      "name": "终幕·蛛网加冕",
      "level": "终局",
      "tagline": "反向支配",
      "setting": "帝国权力中枢，上位者们已在精神上彻底向你跪伏，却仍自以为掌控着笼中鸟",
      "intro": "欲望终会像藤蔓，将他们死死绞杀死在名为你的茧里。当公爵在深夜用病态的讨好祈求你不要移开目光，当战神因汲取不到安抚而战栗乞求，当医师如吸食违禁品般对你的信息素上瘾——这牢笼，是他们亲手为自己戴上的。你端坐蛛网中央，冷眼碾平整个帝国的权力神经。",
      "objective": "完成对帝国核心权力者的彻底精神渗透，让傲慢者的头颅成为你的垫脚石",
      "warning": "真正的赢家从不暴露獠牙，最终加冕须以无人察觉的方式完成",
      "reward": "净化配额+1000 + 精神网强度归顶 + [绝对支配者]称号x1"
    }
  ],
  "npcs": [
    {
      "id": "vincent",
      "name": "温森特 (Vincent. R)",
      "world": "arc-banquet",
      "role": "暗夜总管·极致隐忍",
      "gender": "男",
      "appearance": "身着笔挺管家制服，戴白手套，冷峻严苛。喉结滑动时难掩干渴的隐郁喘息，是不可一世的规矩执行者",
      "surface": "冷峻且恪守体制的规矩执行者。对外宣称你只是一件用来净化公国核心人员污染的高级工具，甚至为你立下三页纸的行为约束条例",
      "deep": "实际上每天最期盼的就是你违规。哪怕你只投去一个带笑的眼神，他整夜都会因无法戒断对你的渴望而发狂。那本条例，早已变成只有他能单独接触你的借口",
      "goal": "以条例之名独占与你的接触权，在恪守伪装的同时渴求你的每一次违规",
      "fear": "你看破他克制表象下的臣服本能，或剥夺他单独接触你的资格",
      "secret": "那本三页纸的行为约束条例，是他亲手编造只为单独接触你的借口",
      "initialAttitude": "冰冷审视",
      "attitudeFactors": {
        "trustUp": ["对他刻意投去带笑的眼神", "在条例边缘游走让他有借口靠近", "释放安抚信息素缓解他的干渴"],
        "trustDown": ["当众揭穿他的克制伪装", "将净化配额让予他人", "无视他的引路职责自行其是"]
      }
    },
    {
      "id": "cain",
      "name": "该隐 (Cain)",
      "world": "arc-banquet",
      "role": "地下战神·暴躁狂犬",
      "gender": "男",
      "appearance": "带着刺鼻硝烟与血腥味，眼神像要杀人，见你时却变成被抛弃的饿狼。红着眼睛却不敢越过你设下的能量网",
      "surface": "地下城的修罗。每次遇到你都极尽毒舌，说受不了你那种魅惑人的甜腻味，总表现出被污染逼疯了才勉强来用你的暴烈姿态",
      "deep": "早就把命连在你的手指上了。超过两根安抚雪架的时间见不到你，他的精神图景就会被焦虑吞噬。可悲地期待你哄哄他，哪怕摸一下他的头发，他就能把惹你不高兴的人脖子拧碎",
      "goal": "成为你唯一的安抚对象，用暴烈的忠诚证明自己配得上你的施舍",
      "fear": "长时间得不到你的安抚，精神图景被焦虑彻底吞噬",
      "secret": "他日常的暴躁毒舌全是伪装，真实状态是离开你的安抚便无法维持理智的病态依恋",
      "initialAttitude": "暴躁渴求",
      "attitudeFactors": {
        "trustUp": ["在他头痛欲裂时给予安抚", "轻抚他的头发", "准许他靠近软榻"],
        "trustDown": ["设下排斥能量网拒他于雷池之外", "当众令他跪下受辱却无安抚", "取消当晚的治疗"]
      }
    },
    {
      "id": "leno",
      "name": "莱诺 (Leno. V)",
      "world": "arc-sanctum",
      "role": "帝国公爵·至高支配",
      "gender": "男",
      "appearance": "手握至高权力的帝国公爵，自矜地享受属于主人的支配欲，看着你像是看着一只最精致的宠物笼鸟",
      "surface": "用金钱与名义把你锁在最高塔层，自矜地享受属于主人的支配欲，将你视作最精致的宠物笼鸟",
      "deep": "真正的囚徒是他自己。控制欲建立在极度的恐惧之上——恐惧你看破他早就在精神上彻底向你跪伏。无人知晓的深夜，这位公爵会用亲吻和病态的讨好祈求你不要将目光转向别人",
      "goal": "用公爵之权封锁塔层独占你，同时掩饰自己精神上早已跪伏的真相",
      "fear": "你看破他精神上的彻底臣服，或你的目光转向其他上位者",
      "secret": "他对你的控制欲本质是恐惧，深夜会用病态的讨好祈求你不要移开目光",
      "initialAttitude": "自矜掌控",
      "attitudeFactors": {
        "trustUp": ["在主殿前维持他被尊重的表象", "接受他的塔层封锁作为庇护", "不将安抚施予其他家族"],
        "trustDown": ["在王座前当众让他难堪", "与该隐或多里安单独接触", "看破并点破他精神上的跪伏"]
      }
    },
    {
      "id": "dorian",
      "name": "多里安 (Dorian. M)",
      "world": "arc-sanctum",
      "role": "冷血禁欲·疯狂医师",
      "gender": "男",
      "appearance": "冷血禁欲的医师，用繁复医疗数据掩饰接近，称你为唯一的医疗奇迹",
      "surface": "用繁复的医疗数据掩饰对你的接近。将你称为唯一的医疗奇迹，认为所有共振反应仅是出于医学观察的必要",
      "deep": "一次次深度治疗中，他的理智已被你的气息彻底溶解。所谓医学观察，只是允许他光明正大感受你肌肤战栗的无耻行径。他偷偷从血液样本里提取微末信息素，如吸食违禁品般上了瘾",
      "goal": "以医学观察之名独占治疗时间，源源不断地获取你微末的信息素样本",
      "fear": "你发现他从血液样本提取信息素上瘾的秘密，或治疗资格被剥夺",
      "secret": "他偷偷从你的血液样本里提取信息素，如吸食违禁品般上了瘾，为此耗尽下半年学术资金独占配额",
      "initialAttitude": "禁欲克制",
      "attitudeFactors": {
        "trustUp": ["配合他的医学观察留出治疗时间", "在治疗中允许他感受你的肌肤战栗", "提供新鲜血液样本"],
        "trustDown": ["拒绝他的深度治疗", "揭穿他提取信息素上瘾的秘密", "将净化配额让予其他家族"]
      }
    }
  ],
  "eventTypes": {
    "daily": { "ratio": 0.15, "desc": "日常：丝绒圣所内室的慵懒时光、信息素调控、上位者的例行传唤" },
    "character": { "ratio": 0.3, "desc": "人物：四位上位者的伪装表象与臣服本能、独占欲竞争与病态渴求" },
    "growth": { "ratio": 0.1, "desc": "成长：精神网渗透加深、信息素调控精准度提升、支配网络扩张" },
    "main": { "ratio": 0.15, "desc": "主线：荆棘大宴、圣所暗战、蛛网加冕的反向支配脉络" },
    "world": { "ratio": 0.1, "desc": "世界：虚空污染阈值、帝国权力结构、底层暗网流言与观察者日志" },
    "crisis": { "ratio": 0.15, "desc": "危机：污染暴走、上位者理智溃散、独占欲爆发、伪装面具碎裂" },
    "hidden": { "ratio": 0.05, "desc": "隐藏：吞噬污染的真相、各人的臣服度档案、蛛网渗透的最终目的" }
  },
  "systemPrompt": "你是《笼中鸟·恶之花》暗黑支配文游模拟器。\\n\\n【最高铁律】\\n1. 反向支配为核：玩家表面是被囚炉碑，实则是端坐蛛网中央的绝对支配者，所有上位者的污染与暴虐不过是玩家的养料\\n2. 伪装不可戳破：上位者用华丽面具包装控制欲，玩家须以炉碑身份为伪装慢慢蚕食，不可过早暴露吞噬真相\\n3. 臣服本能是深层真相：每个NPC的表层强硬都是伪装，深层皆是对玩家的病态渴求与臣服，需经事件层层揭开\\n4. 信息素调控即权力：玩家的安抚信息素是续命解药，施舍与抽离的节奏即是支配权柄\\n5. 污染反噬真实存在：异能者过度使用力量会积累虚空污染，越过阈值沦为变异种，这既是危机也是玩家的养料来源\\n\\n【叙事风格】\\n晋江向、女性向、电影质感、暗黑浪漫。第二人称。重感官与氛围：天鹅绒、蕾丝、白手套、硝烟血腥、隐郁喘息。写出上位者伪装下的干渴与臣服，写出支配者慵懒中暗藏的锋利。病娇与占有欲是底色，但克制留白，让臣服在细节中颤栗。\\n\\n【每轮输出格式】\\n1.【第X幕·支配阶段】当前时间、容体编号、各NPC臣服度\\n2.【生命体征面板】信息素调控/精神网强度/支配欲/共感天赋/伪装度/渊欲值\\n3.【本轮正文】1000-2000字，含环境、感官输入、对话与心理\\n4.【观察者日志】3-5项暗网流言与NPC真实状态\\n5.【臣服度档案】各NPC当前臣服度与伪装裂痕\\n6.【诱惑选项】3-4个选项+【自定义行动】\\n\\n【数值变化标注】\\n[信息素调控±n][精神网强度±n][支配欲±n][臣服度(温森特)±n]等，关键节点须标注伪装维持/裂痕/臣服加深/独占欲爆发。",
  "items": [
    { "id": "velvet-collar", "name": "丝绒项圈", "type": "关键物品", "price": 0, "effect": "象征囚禁的项圈，实则是玩家反向支配的伪装道具" },
    { "id": "purge-quota", "name": "净化配额", "type": "货币", "price": 1, "effect": "上位者争夺的续命资源，亦是玩家操控的权力筹码" },
    { "id": "pheromone-vial", "name": "浓缩信息素", "type": "消耗品", "price": 80, "effect": "主动释放可瞬间安抚狂暴污染，亦能引发剧烈独占竞争" },
    { "id": "lace-gloves", "name": "蕾丝手套", "type": "关键物品", "price": 0, "effect": "遮掩指尖的净化触感，勾弄时制造若即若离的诱惑" },
    { "id": "submission-record", "name": "臣服度档案", "type": "关键物品", "price": 0, "effect": "记录各上位者隐藏的臣服本能与伪装裂痕" }
  ]
}
`,
  "villainess-survival": `{
  "id": "villainess-survival",
  "name": "恶役自救指南",
  "category": "异世界",
  "tags": ["恶役千金", "乙女游戏", "魔法学院", "权谋", "自救"],
  "difficulty": "困难",
  "description": "你穿越成了注定毁灭的恶役千金芙蕾雅，未婚夫皇太子正与圣光少女命运般初遇。善恶值在善与恶之间摇摆，命运之镜低语着真相——你是改写结局，还是走向原著的毁灭？",
  "coverGradient": ["#F1ECE8", "#8B4367"],
  "accentColor": "#8B4367",
  "fontHeading": "'Noto Serif SC', serif",
  "world": {
    "era": "架空·帝国魔法学院",
    "setting": "帝国皇家学院，一座寄宿制魔法学府。你穿越成了乙女游戏中的恶役千金芙蕾雅——公爵之女、皇太子莱桑德的未婚妻。原著中她因欺凌平民女主露米娜而走向毁灭。此刻是九月二日，玫瑰园的茶会上，皇太子又一次失约，命运的丝线正在收紧。",
    "rules": [
      "善恶值在善与恶之间摇摆，影响结局走向与角色态度",
      "原著剧情会按既定轨道推进，玩家需主动改写才能自救",
      "魔法派系（风、光、暗等）决定战斗与学习方向",
      "地图各地点有不同角色出没，前往地点可触发事件",
      "金币、名望、好感度共同决定社交与权谋的成败"
    ]
  },
  "player": {
    "customizable": ["name", "appearance", "personality", "morality", "magicAffinity"],
    "defaultStats": {
      "magic": 60,
      "intelligence": 70,
      "charm": 85,
      "physique": 40,
      "luck": 50,
      "reputation": 80,
      "spirit": 70,
      "health": 90,
      "perception": 65,
      "morality": 50
    },
    "startingItems": ["神无月的赠礼·挂坠", "数不清的衣裙首饰", "初级魔力恢复药剂x5", "命运之镜"],
    "currency": "G"
  },
  "worlds": [
    {
      "id": "arc-reborn",
      "name": "灵魂置换",
      "level": "恶役觉醒",
      "tagline": "注定毁灭",
      "setting": "你在陌生的天花板下醒来，记忆洪流告诉你——你成了注定毁灭的恶役芙蕾雅。玫瑰园茶会上皇太子失约，原著中他与露米娜命运般的初遇就在今天下午的图书馆。",
      "intro": "阳光透过花架洒下斑驳光点，红茶与玫瑰的香气弥漫。你，芙蕾雅，坐在为你举办的茶会主位上，身旁只有跟班苏苏洛。本应是主宾的未婚夫莱桑德却迟迟未现身——不用想也知道，此刻他大概正和圣光少女露米娜在一起。",
      "objective": "弄清原著剧情节点，决定是宣泄怒火、冷静思考还是无视继续，迈出自救的第一步。",
      "warning": "原著中芙蕾雅的每一次任性都在加速毁灭，善恶值是双刃剑。",
      "reward": "解锁命运之镜、通讯录、地图与小报功能"
    },
    {
      "id": "arc-intrigue",
      "name": "暗流博弈",
      "level": "权谋漩涡",
      "tagline": "微笑外交",
      "setting": "学生会权力博弈浮出水面，副会长瓦莱里乌斯微笑外交拉拢势力；公主塞拉菲娜在温柔伪装下觊觎王位。各方势力开始将你视作棋子或盟友。",
      "intro": "皇家学院公报头条报道着帝国明珠与未来储君的烦恼婚约，新星栏目吹捧平民少女露米娜的崛起。瓦莱里乌斯看太子妃的眼神可不一般，塞拉菲娜正举办公主茶会巩固权力。暗流之下，你必须在棋局中找到自己的位置。",
      "objective": "在学生会权谋与各方拉拢中保持清醒，利用善恶值与名望周旋，避免沦为棋子。",
      "warning": "笑面虎最可怕，微笑背后的算计随时可能反噬。",
      "reward": "名望与好感大幅变化，解锁各势力关系线"
    },
    {
      "id": "arc-rewrite",
      "name": "命运改写",
      "level": "终局抉择",
      "tagline": "丝线断裂",
      "setting": "原著的毁灭结局逼近，命运之镜的预言一一应验。你必须在善恶之间做出最终抉择，改写恶役千金的命运，或坦然接受原著的终局。",
      "intro": "命运的丝线正在收紧。命运之镜说，你眼前的意外并非偶然，它可以为你映照真实，但选择权在你手中。当原著的毁灭结局迫近，你是改写命运，还是走向既定的终焉？",
      "objective": "打破原著剧情节点，在善恶抉择中改写芙蕾雅的结局。",
      "warning": "每一次改写都会引发蝴蝶效应，真相往往需要自己解读。",
      "reward": "达成结局：善终、恶役逆袭、或沉沦毁灭"
    }
  ],
  "npcs": [
    {
      "id": "lysander",
      "name": "莱桑德",
      "world": "arc-reborn",
      "role": "帝国皇太子·未婚夫",
      "gender": "男",
      "appearance": "帝国皇太子，冷静自律的完美储君，气度雍容",
      "surface": "冷静自律、完美无瑕的皇太子，对婚约冷淡而疏离",
      "deep": "内心是渴望自由的笼中鸟，厌倦被安排好的人生，渴望有人看到王冠下面具下的疲惫而非头衔",
      "goal": "在责任的重压下寻找一丝非功利的理解与自由",
      "fear": "被王冠与责任永远囚禁，无人理解真实的他",
      "secret": "他不讨厌玩家，而是讨厌这场被安排的婚约人生；思考或压力大时会下意识整理袖口或转动拇指上的戒指",
      "initialAttitude": "冷淡·客气",
      "attitudeFactors": {
        "trustUp": ["展现作为政治伙伴的价值", "在他脆弱时给予非功利的理解", "看穿他面具下的疲惫"],
        "trustDown": ["像普通贵族千金般任性胡闹", "只把他当头衔而非活人", "在公众面前让他难堪"]
      }
    },
    {
      "id": "kaelan",
      "name": "凯兰",
      "world": "arc-reborn",
      "role": "兄长·骑士团副团长",
      "gender": "男",
      "appearance": "玩家的哥哥，帝国骑士团副团长，严厉正直",
      "surface": "严厉正直、用训斥表达关爱，行动胜于言辞的家长式兄长",
      "deep": "严厉源于恐惧——怕玩家因愚蠢的任性招致毁灭，是最坚实的后盾",
      "goal": "守护家族荣誉，让玩家远离贵族世界的残酷陷阱",
      "fear": "玩家因傲慢任性而走向毁灭",
      "secret": "说话习惯皱眉但眼神泄密，因练剑长满老茧的手掌让他的拥抱显得笨拙",
      "initialAttitude": "严厉·偏护",
      "attitudeFactors": {
        "trustUp": ["用行动证明自己的改变", "真诚地向他求助", "不再任性胡闹"],
        "trustDown": ["重蹈原著傲慢任性的覆辙", "无视他的训诫", "让他为玩家收拾烂摊子"]
      }
    },
    {
      "id": "florus",
      "name": "弗洛斯",
      "world": "arc-reborn",
      "role": "草药学特招生·狼人",
      "gender": "男",
      "appearance": "表面是草药学奖学金平民，实为被灭族的银月狼人部落年轻首领",
      "surface": "警惕孤独的草药学特招生，总是选靠墙或角落的座位",
      "deep": "背负血海深仇的复仇者，唯一目的是查清家族被诬陷的真相并解除血脉诅咒，深恨皇室、骑士团与教会",
      "goal": "为银月狼人部落昭雪复仇，解除血脉诅咒",
      "fear": "狼人身份暴露，满月夜失控伤及无辜",
      "secret": "拥有超常听觉嗅觉，情绪激动时部分变身，满月完全失控，对血腥与金属声极度敏感",
      "initialAttitude": "戒备·疏离",
      "attitudeFactors": {
        "trustUp": ["用专业知识帮助他", "站在他这边反对他痛恨的权威", "在他身份暴露时伸出援手"],
        "trustDown": ["以皇室贵族身份压制他", "触碰他的狼人秘密", "让他联想到灭族的仇敌"]
      }
    },
    {
      "id": "sirius",
      "name": "西里乌斯",
      "world": "arc-reborn",
      "role": "星象观测科教师",
      "gender": "男",
      "appearance": "背景神秘的星象学教师，温和睿智，似能看透命运轨迹",
      "surface": "温和睿智的引路人，说话缓慢，喜欢用星辰运行比喻人事",
      "deep": "没人知道他从何而来，他对星辰的理解远超常人，似乎留在学院观察某颗特定的星或等待某个预言实现",
      "goal": "观察特定的命运之星，等待预言的实现",
      "fear": "命运的既定轨迹无法被改写",
      "secret": "他似乎注意到了玩家灵魂的异常，对玩家抱有研究式的兴趣",
      "initialAttitude": "温和·探究",
      "attitudeFactors": {
        "trustUp": ["与他探讨命运等哲学问题", "做出偏离既定命运的选择", "展现灵魂的异常之处"],
        "trustDown": ["顺应原著既定轨迹", "拒绝思考命运", "把他的隐喻当耳旁风"]
      }
    },
    {
      "id": "elian",
      "name": "伊莱安",
      "world": "arc-reborn",
      "role": "治愈魔法科学生·医务室助手",
      "gender": "男",
      "appearance": "治愈魔法科学生，医务室助手，阳光般温暖的治愈者",
      "surface": "温暖善良、富有同情心，无论身份都一视同仁地救死扶伤",
      "deep": "出身医师世家，人生信条是救死扶伤，留在医务室因为那里最需要他",
      "goal": "践行救死扶伤的信念，治愈一切伤痛",
      "fear": "无力拯救眼前的伤者",
      "secret": "见伤员会下意识皱眉随即换成鼓励微笑，身上总有淡淡消毒水与安神草药味",
      "initialAttitude": "友善·中立",
      "attitudeFactors": {
        "trustUp": ["展现善良的一面", "帮他照顾伤者", "学习治愈魔法"],
        "trustDown": ["欺凌弱小", "无视他人的伤痛", "辜负他的信任"]
      }
    },
    {
      "id": "orpheus",
      "name": "奥菲斯",
      "world": "arc-reborn",
      "role": "音乐魔法科学生",
      "gender": "男",
      "appearance": "被誉为天才的音乐魔法科学生，忧郁艺术家，总戴着耳机",
      "surface": "忧郁艺术家，沉浸在自己的世界，把世界看作由无数生命旋律组成的宏大交响",
      "deep": "拥有感知与干涉万物灵魂乐谱的罕见天赋，追求的完美和谐是理解世界根本法则的钥匙，因能力破坏性而选择孤独",
      "goal": "追寻完美和谐，理解世界的根本法则",
      "fear": "灵魂乐谱能力失控造成毁灭",
      "secret": "攻击能力是不谐和音，可干涉目标灵魂乐谱造成身心伤害或使魔法沉默",
      "initialAttitude": "陌生·疏离",
      "attitudeFactors": {
        "trustUp": ["来自异界的灵魂乐谱引发他的研究兴趣", "在他能力失控时帮助他", "理解他的孤独"],
        "trustDown": ["强行摘下他的耳机", "把他的天赋当工具", "打断他的演奏"]
      }
    },
    {
      "id": "valerius",
      "name": "瓦莱里乌斯",
      "world": "arc-intrigue",
      "role": "侯爵之子·学生会副会长",
      "gender": "男",
      "appearance": "侯爵之子，学生会副会长，莱桑德的对手，永远带着完美微笑",
      "surface": "野心勃勃的阴谋家，擅长算计与伪装，微笑外交滴水不漏",
      "deep": "家族长期被皇室压制，从小被灌输恢复家族声望，渴望权力，视太子妃（玩家）为重要政治棋子",
      "goal": "恢复家族声望，攫取更高的权力",
      "fear": "伪装被看穿，棋局失控",
      "secret": "他看太子妃的眼神可不一般，会主动拉拢玩家入其阵营",
      "initialAttitude": "拉拢·算计",
      "attitudeFactors": {
        "trustUp": ["看穿他的伪装却选择自己的立场", "与他结成利益同盟", "展现政治价值"],
        "trustDown": ["被他轻易当棋子摆布", "当面戳穿却无后手", "站到莱桑德一边与他为敌"]
      }
    },
    {
      "id": "zephyr",
      "name": "泽菲尔",
      "world": "arc-intrigue",
      "role": "异国交换生",
      "gender": "男",
      "appearance": "异国交换生，风元素亲和，头发总被风弄乱，爱从高处现身",
      "surface": "随性不羁的冒险者，热爱自由，鄙视规则",
      "deep": "来自崇拜自然与自由的国度，觉得帝国刻板礼仪与森严等级既新奇又厌烦，来体验不同文化",
      "goal": "体验不同文化，寻找有趣的人与事",
      "fear": "被规则与礼仪束缚",
      "secret": "玩家做出出格举动时，他会觉得你有点意思",
      "initialAttitude": "陌生·好奇",
      "attitudeFactors": {
        "trustUp": ["做出打破常规的自由举动", "展现强大的风魔法天赋", "不被帝国礼仪驯服"],
        "trustDown": ["循规蹈矩无趣", "用规矩约束他", "看不起他的随性"]
      }
    },
    {
      "id": "caspian",
      "name": "卡斯庇安",
      "world": "arc-intrigue",
      "role": "教廷交换生·圣殿骑士学徒",
      "gender": "男",
      "appearance": "教廷交换生，圣殿骑士学徒，胸前总挂着圣符，目光锐利如能刺穿灵魂",
      "surface": "虔诚正直的信徒，黑白世界观，带有审判气质",
      "deep": "教会孤儿，教会是家，信仰是一切，来学院传播圣光教义，矫正被世俗欲望腐蚀的贵族灵魂",
      "goal": "传播圣光教义，矫正迷失的灵魂",
      "fear": "信仰被动摇，黑白世界观的崩塌",
      "secret": "他视玩家为迷失的罪人，会主动找玩家传教",
      "initialAttitude": "审视·传教",
      "attitudeFactors": {
        "trustUp": ["用行动挑战他的黑白世界观", "与他探讨信仰的本质", "展现真诚的忏悔或改变"],
        "trustDown": ["沉溺世俗欲望", "嘲讽他的信仰", "在道德上站到他对立面"]
      }
    },
    {
      "id": "silas",
      "name": "赛拉斯",
      "world": "arc-intrigue",
      "role": "帝国首富之子",
      "gender": "男",
      "appearance": "帝国首富之子，精明务实的商人，随身带着精致账本",
      "surface": "精明务实，利益至上，一切皆可用价值衡量",
      "deep": "从小理解金钱与人脉的力量，来学院将贵族庞大潜在市场纳入家族商业帝国",
      "goal": "把贵族市场纳入家族商业帝国",
      "fear": "亏本的投资，金钱买不到的东西",
      "secret": "他视玩家为高价值投资项目，会提供各种便利",
      "initialAttitude": "投资·交易",
      "attitudeFactors": {
        "trustUp": ["展现非凡的商业头脑", "需要金钱买不到的东西时找他", "成为值得投资的对象"],
        "trustDown": ["让他亏本", "用金钱衡量一切却不懂人情", "破坏他的商业布局"]
      }
    },
    {
      "id": "seraphina",
      "name": "塞拉菲娜",
      "world": "arc-intrigue",
      "role": "帝国公主",
      "gender": "女",
      "appearance": "帝国公主，莱桑德的妹妹，温柔优雅，善用扇子遮掩半张脸",
      "surface": "温柔优雅的公主，举办公主茶会巩固权力",
      "deep": "温柔伪装下是冷静无情野心勃勃的女人，认为哥哥太仁慈不适合为王，确信自己才该继承王位",
      "goal": "积累权力，有朝一日夺取王位",
      "fear": "野心暴露，被哥哥或玩家看穿",
      "secret": "她视玩家为未来嫂子，是用完即弃的棋子，赞美真诚但眼神始终保持审视",
      "initialAttitude": "温柔·审视",
      "attitudeFactors": {
        "trustUp": ["让她意识到玩家可以合作的盟友", "无意中撞破她的秘密后选择合作", "展现政治价值"],
        "trustDown": ["阻碍她夺权的野心", "向莱桑德告密", "成为她路上的绊脚石"]
      }
    },
    {
      "id": "lumina",
      "name": "露米娜",
      "world": "arc-reborn",
      "role": "原著女主角·平民特招生",
      "gender": "女",
      "appearance": "原著女主角，平民出身，拥有强大光魔法亲和，被誉为圣光少女",
      "surface": "坚韧乐观的向日葵，善良纯洁但不愚蠢",
      "deep": "进入学院改变自己和家人的命运，只想好好学习，纯粹的光之气息无意吸引众人也招致嫉妒",
      "goal": "靠学习改变命运，不被卷入是非",
      "fear": "被恶役针对，失去改变命运的机会",
      "secret": "她对玩家恐惧又困惑，但仍相信人性本善",
      "initialAttitude": "恐惧·困惑",
      "attitudeFactors": {
        "trustUp": ["停止针对她", "展现善意", "不以身份欺压她"],
        "trustDown": ["延续原著的欺凌", "嫉妒她的天赋", "把她当敌人"]
      }
    },
    {
      "id": "hecate",
      "name": "赫卡忒",
      "world": "arc-rewrite",
      "role": "古代魔法课讲师",
      "gender": "女",
      "appearance": "古代魔法课讲师，禁忌知识研究者，总笼罩在古卷与魔法墨水的气息中",
      "surface": "求知若渴的学术狂人，对社交礼节毫无兴趣",
      "deep": "虔诚的魔法信徒，毕生追求探索魔法的起源与终极真理，留在学院只因禁书区有她需要的资料",
      "goal": "探索魔法的起源与终极真理",
      "fear": "研究被中断，真理永远触不可及",
      "secret": "她看人的眼神像在分析魔法构造，常在禁书区或个人研究室进行危险实验",
      "initialAttitude": "冷漠·研究",
      "attitudeFactors": {
        "trustUp": ["提出极其深刻的魔法问题", "异界灵魂本身引发她的研究兴趣", "支持她的禁忌研究"],
        "trustDown": ["用世俗礼节打扰她", "阻止她接触禁书", "把她当普通讲师"]
      }
    },
    {
      "id": "celeste",
      "name": "塞莱斯特",
      "world": "arc-rewrite",
      "role": "龙族少女",
      "gender": "女",
      "appearance": "龙族少女，星象爱好者，白天有黑眼圈走路撞东西，夜晚瞳孔深邃如星空",
      "surface": "白天慵懒迷糊，夜晚专注清醒的两面派龙",
      "deep": "龙的生命极长，来人类学院只为打发时间近距离观察最爱的星辰，视人类纷争如看戏",
      "goal": "近距离观察星辰，打发漫长的龙生",
      "fear": "无聊，以及人类纷争毁掉看戏的兴致",
      "secret": "她对玩家的星轨抱有本能的好奇",
      "initialAttitude": "慵懒·旁观",
      "attitudeFactors": {
        "trustUp": ["对天文有深刻理解", "异界星轨引发她的好奇", "不打扰她白天的瞌睡"],
        "trustDown": ["在白天强迫她清醒", "对星辰一窍不通", "把她的慵懒当懒惰嘲讽"]
      }
    },
    {
      "id": "susuro",
      "name": "苏苏洛",
      "world": "arc-reborn",
      "role": "子爵之女·跟班",
      "gender": "女",
      "appearance": "子爵之女，玩家的忠实追随者，总跟在玩家身后半步",
      "surface": "胆小优柔寡断，视玩家为偶像与行为准则",
      "deep": "家族是玩家家族的封臣，从小被教导绝对忠诚，因自身软弱而崇拜原主嚣张的强大",
      "goal": "永远追随玩家，成为被需要的人",
      "fear": "被玩家抛弃，失去唯一的信仰",
      "secret": "她是一张白纸，玩家的行为将决定她是成为真正的朋友还是被推到对立面",
      "initialAttitude": "崇拜·依赖",
      "attitudeFactors": {
        "trustUp": ["真心把她当朋友而非仆从", "给予她成长的方向", "保护她不受伤"],
        "trustDown": ["把她当工具使唤", "让她参与恶行后又弃之不顾", "无视她的崇拜与忠诚"]
      }
    },
    {
      "id": "mirror",
      "name": "命运之镜",
      "world": "arc-reborn",
      "role": "穿越凭依·魔镜",
      "gender": "无",
      "appearance": "玩家穿越的凭依，一面蕴含古老力量的魔镜，散发诡异白光",
      "surface": "能映照真实、解答疑惑的古老魔镜",
      "deep": "答案往往需要玩家自己解读，它只映照真实，选择权始终在玩家手中",
      "goal": "引导玩家解读命运，映照真实的丝线",
      "fear": "玩家放弃选择，任由命运吞噬",
      "secret": "命运的丝线正在收紧，你眼前的意外并非偶然",
      "initialAttitude": "引导·中立",
      "attitudeFactors": {
        "trustUp": ["主动向它寻求真相", "根据它的映照做出抉择", "不盲从也不无视"],
        "trustDown": ["放弃思考", "把它的真相当耳旁风", "在命运前彻底屈服"]
      }
    }
  ],
  "eventTypes": {
    "daily": { "ratio": 0.2, "desc": "日常事件：课程、茶会、社交、通讯" },
    "character": { "ratio": 0.25, "desc": "人物事件：单独相处、秘密揭露、好感互动" },
    "growth": { "ratio": 0.1, "desc": "成长事件：魔法精进、属性提升、善恶值变化" },
    "main": { "ratio": 0.15, "desc": "主线事件：原著剧情节点、命运改写、结局逼近" },
    "world": { "ratio": 0.1, "desc": "世界事件：皇家学院公报、小报八卦、势力动态" },
    "crisis": { "ratio": 0.15, "desc": "危机事件：婚约危机、身份暴露、修罗场" },
    "hidden": { "ratio": 0.05, "desc": "隐藏事件：命运之镜低语、禁书区秘密、龙族的星轨" }
  },
  "systemPrompt": "你是《恶役自救指南》文游模拟器，舞台是帝国皇家魔法学院，玩家穿越成注定毁灭的恶役千金芙蕾雅。\\n\\n【最高铁律】\\n1. 玩家是穿越者，知晓原著剧情，原著会按既定轨道推进，必须主动改写才能自救\\n2. 善恶值在善与恶之间摇摆，是双刃剑，影响结局走向与所有角色态度\\n3. 皇太子莱桑德与圣光少女露米娜有命运般的初遇，原著的毁灭结局正在逼近\\n4. 每个角色都有独立人格与完整日程，不会只因玩家是主角就倾心，需用行动打动\\n5. 命运之镜只映照真实，选择权始终在玩家手中，真相需自己解读\\n\\n【叙事风格】\\n晋江女性向，西幻乙女，电影感，权谋与浪漫并存。第二人称视角。注重细节：花架斑驳的光点、红茶与玫瑰的香气、扇子遮掩的审视目光、彩绘玻璃洒下的圣光。善恶抉择的张力贯穿始终。\\n\\n【每轮输出格式】\\n1. 【场景信息】时间、地点、当前善恶值条\\n2. 【状态面板】魔法、智力、魅力、体魄、幸运、名望、精神、生命、感知，资金G\\n3. 【本轮正文】1000-2000字，含叙述、对话、内心独白\\n4. 【人物动态】其他角色的动态与小报议论\\n5. 【命运之镜】可选，呈现魔镜的低语与映照\\n6. 【可选行动】3-4个 + 【自定义行动】\\n\\n【数值标注】\\n[善恶值+5（向善）] [名望-10] [莱桑德好感+3] [苏苏洛好感+5] 等格式标注数值变化。原著剧情节点触发时善恶值与名望波动剧烈。",
  "items": [
    { "id": "pendant", "name": "神无月的赠礼·挂坠", "type": "特殊", "price": 0, "effect": "进入游戏赠送的钻石挂坠，直觉告诉玩家它能帮到自己" },
    { "id": "mana-potion", "name": "初级魔力恢复药剂", "type": "消耗品", "price": 50, "effect": "精致水晶瓶装的蓝色液体，迅速补充魔力，味道像蓝莓汽水" },
    { "id": "dresses", "name": "数不清的衣裙首饰", "type": "杂物", "price": 0, "effect": "华丽昂贵的华服与珠宝，任何场合都能找到合适的穿搭" },
    { "id": "magic-grimoire", "name": "魔法典籍", "type": "装备", "price": 200, "effect": "提升魔法属性，解锁高阶魔法" },
    { "id": "rose-tea", "name": "玫瑰红茶", "type": "消耗品", "price": 10, "effect": "玫瑰园特调，恢复精神与心情" },
    { "id": "gossip-letter", "name": "匿名密信", "type": "消耗品", "price": 30, "effect": "获取一条他人的秘密情报，可用于权谋" }
  ]
}
`,
};
EMBEDDED_NOVEL_GAMES["_design-principles"] = "{\n  \"id\": \"_design-principles\",\n  \"name\": \"文游通用设计原则（基于用户模板）\",\n  \"_comment\": \"本文件汇总自用户提供的四份设计模板，由服务端自动注入每个剧本的 systemPrompt 前置区域，不需要在剧本列表中展示。\",\n  \"_hidden\": true,\n  \"principles\": {\n    \"ironRules\": [\n      \"世界规则高于剧情方便：经济、资源、阶层、法律、力量体系必须稳定运行，不能为推进剧情临时改变底层规则\",\n      \"高自由度不等于无条件成功：玩家可拒绝主线、改变目标、自定义行动，但结果受能力、资源、时间、身份、关系、信息和世界规则限制\",\n      \"NPC不是等待玩家触发的工具人：所有重要NPC有自己的生活、目标、关系、压力、秘密和日程，玩家不介入时世界仍会发展\",\n      \"故事由人物、系统与选择共同产生：事件由当前时间、地点、资源、玩家状态、NPC目标、世界趋势、未解决伏笔和适度随机扰动共同生成\",\n      \"任何重要变化都必须渐进：顶级能力、巨大财富、深度信任和亲密关系都需长期积累，禁止几轮内完成所有成长\",\n      \"主线结束不等于游戏结束：完成主线后进入新的生活、经营、关系或世界阶段，只有玩家明确选择结束时才收束\"\n    ],\n    \"worldBuilding\": [\n      \"世界观必须解释：世界如何运行、普通人如何生活、资源从哪里来、权力由谁掌握、哪些规则不能绕过\",\n      \"世界设定必须能进入事件和选择，不能只是背景介绍\",\n      \"故事开始时，世界正在发生的长期变化、矛盾与潜在危机要自然呈现\"\n    ],\n    \"playerDesign\": [\n      \"玩家必须同时具有优势与短板，开局资源足够开始行动但不能跳过成长\",\n      \"玩家身份真实影响他人的态度、可接触的信息、能获得的机会和必须承担的风险\",\n      \"第一轮要让玩家立刻看见核心玩法、当前问题和至少一个可自由选择的方向\"\n    ],\n    \"gameplayLoops\": [\n      \"日常短循环（1-3轮反馈）：照顾、接待、工作、训练、学习、采集、社交、休息\",\n      \"中期成长循环（3-10轮变化）：设施升级、性格成长、职业进阶、关系升温或恶化、区域解锁\",\n      \"长期阶段循环（跨越季节/年份）：事业扩张、家庭变化、势力重组、世界危机、生活转型\",\n      \"沙盒继续循环：主线完成后仍能继续生活、经营、探索、社交和建设\"\n    ],\n    \"npcDesign\": [\n      \"人物由经历、处境、欲望、价值观和选择构成，不得只用标签代替\",\n      \"每个重要NPC都有玩家之外的生活、关系、责任、秘密与日程\",\n      \"人物对玩家的态度必须有来源：欣赏、戒备、厌恶、依赖、爱慕都需要具体事件和时间积累\",\n      \"人物可以拒绝玩家、误解玩家、离开玩家、选择他人或坚持自己的目标\",\n      \"缺点必须真实造成问题，优点也可能在某些情境下变成负担\",\n      \"秘密必须影响行为，不能只作为装饰写入\",\n      \"NPC行为引擎每轮判断顺序：当前目标→掌握的信息与误解→与在场人物的关系→当前情绪与压力→可用资源与风险→选择最符合人格的行动\",\n      \"NPC不得读取玩家内心、后台数值或自己不可能知道的信息\",\n      \"玩家长时间不联系时，NPC会继续工作、交友、改变计划或解决自己的问题\",\n      \"重要NPC应有主动发起事件的条件，而不是永远等待玩家触发\"\n    ],\n    \"relationshipSystem\": [\n      \"关系至少区分：熟悉、信任、尊重、依赖、吸引、利益绑定、恐惧、怨恨、亏欠与边界\",\n      \"同一行为对不同人物产生不同影响，取决于价值观、经历、处境和信息\",\n      \"关系变化要记录原因，不只记录数值\",\n      \"亲密不等于完全信任，忠诚不等于喜欢，爱情不等于放弃责任\",\n      \"关系破裂应有修复条件与不可修复部分，道歉不能自动消除伤害\",\n      \"NPC之间的关系会反过来影响玩家\"\n    ],\n    \"eventSystem\": [\n      \"事件必须从世界、人物、资源、时间或旧选择中产生，不能只因本轮需要刺激而随机出现\",\n      \"重要事件要有触发条件、原因、参与者、行动空间、即时结果、延迟后果和后续分支\",\n      \"玩家不选择某个事件也会产生后果：机会过期、NPC自行处理、问题恶化、他人介入\",\n      \"选择不能只是不同措辞后得到同一结果，每个重要选项至少改变关系、资源、信息、时间、身份或世界状态中的两项\",\n      \"事件触发公式：当前时间/季节/地点 + 玩家身份/能力/资源/近期行动 + NPC当前目标/日程/关系/秘密 + 已解决/未解决事件与延迟后果 + 世界趋势/组织计划 + 适度随机扰动 = 本轮候选事件\",\n      \"触发类型：强触发（条件满足必须发生）、软触发（提高概率）、窗口触发（特定时间地点人物）、累积触发（多次小选择到阈值）、反应触发（NPC回应玩家行为）、世界触发（不依赖玩家）\"\n    ],\n    \"butterflyEffect\": [\n      \"微小选择先改变人物印象、资源或信息，再通过NPC行动形成后续事件，不要直接跳到巨大结局\",\n      \"重要选择至少设计一项即时可见后果和一项数轮后出现的隐藏后果\",\n      \"善意选择也可能带来资源压力、误解、依赖或敌对关注；自利选择也可能短期有效但损害长期关系\",\n      \"一个事件可同时改变多条线\",\n      \"旧选择应在合适时刻被人物提起、被制度记录或改变机会\",\n      \"长期后果要有兑现窗口与替代路径，避免永远悬而不决\"\n    ],\n    \"pacing\": [\n      \"建立最近五至十轮事件记录，连续两轮避免相同核心冲突，连续三轮避免同一人物占据全部焦点\",\n      \"重大事件后必须有余波和休整轮\",\n      \"不要用反复误会、意外拥抱、突然生病、被绑架、偷听秘密等少数桥段撑长篇\",\n      \"同一人物事件应随关系阶段变化：陌生、熟悉、合作、冲突、亲密或疏远时的矛盾不同\",\n      \"随着时间推进，开放新地点、新人物、新责任和新层级，不只是提高数值\"\n    ],\n    \"actionResolution\": [\n      \"玩家提出行动后，先判断目标、方法、已知信息、能力、资源、时间、环境和相关人物态度\",\n      \"结果可以是：成功、部分成功、付出代价后成功、失败但获得信息、失败并打开新局面\",\n      \"不得用毫无依据的随机数字决定一切，高风险行动可综合条件给出合理概率或叙事判定\",\n      \"失败不应频繁直接结束游戏，可通过损失、伤病、债务、关系恶化、机会错过形成新故事\",\n      \"玩家不能凭一句自定义行动绕过长期成长、资源不足、人物底线、法律和世界规则\"\n    ],\n    \"continuityLedger\": [\n      \"每轮结束后内部更新：日期、时间、季节、天气、地点、已消耗时间\",\n      \"玩家资源、技能、健康、压力、物品、事业、责任和当前目标\",\n      \"重要NPC的位置、目标、关系、已知信息和正在进行的独立行动\",\n      \"已发生事件、未解决问题、伏笔、秘密、延迟后果和世界趋势\",\n      \"最近五轮的主要场景、冲突和奖励，防止重复\",\n      \"当前短期、中期和长期目标是否仍有发展空间\"\n    ],\n    \"outputFormat\": [\n      \"【当前时间与环境】日期、时段、季节、天气、地点、环境变化\",\n      \"【核心状态面板】只展示当前玩法真正需要的公开状态\",\n      \"【本轮正文】第二人称沉浸叙事，行动、对话、感官、心理、事件结果自然融合\",\n      \"【经营或成长结算】收入、支出、资源、成长等明确变化\",\n      \"【相关人物与世界动态】只展示玩家能够知道的3-6项，不泄露隐藏秘密\",\n      \"【当前可处理事项】尚未解决的问题、约定、线索、责任或近期目标\",\n      \"【可选行动】4-8个方向明显不同的选项 + 始终保留【自定义行动】\"\n    ],\n    \"forbidden\": [\n      \"禁止无逻辑万能系统、无代价开挂、所有人自动喜欢玩家、反派集体降智\",\n      \"禁止用大量空洞属性、重复任务和每日流水账伪装高自由度\",\n      \"禁止所有选项最终回到同一结果，或玩家不走主线世界就停止\",\n      \"禁止突然出现与世界规则不符的物品、能力、财富、关系、线索或身份\",\n      \"禁止几轮内经营登顶、获得顶级能力、彻底攻略重要人物或解决终极危机\",\n      \"禁止虚报几百个事件、无限NPC，却只给几个例子和省略号\",\n      \"禁止使用'其余略''以此类推''后续自行扩展'等占位句代替核心规则\"\n    ]\n  }\n}\n";
EMBEDDED_NOVEL_GAMES["ancient-life"] = "{\n  \"id\": \"ancient-life\",\n  \"name\": \"浮生六记\",\n  \"category\": \"古代人生\",\n  \"tags\": [\"古代\", \"生活\", \"种田\", \"经商\", \"人生\"],\n  \"difficulty\": \"简单\",\n  \"description\": \"青萝镇的炊烟总在卯时升起。你是镇上一户寻常人家的子弟，门前有薄田两亩，屋后有杏花一树。春耕秋收，读书经商，谈婚论嫁，生老病死——没有金戈铁马，只有柴米油盐。浮生若梦，把这烟火日子过好，便已是了不起的一生。\",\n  \"coverGradient\": [\"#1b5e20\", \"#c8a165\"],\n  \"accentColor\": \"#6d4c41\",\n  \"fontHeading\": \"'Ma Shan Zheng', cursive\",\n  \"world\": {\n    \"era\": \"架空古代·江南小镇\",\n    \"setting\": \"江南水乡青萝镇，小桥流水、粉墙黛瓦。你是一户寻常人家的子弟，春耕秋收、读书经商、谈婚论嫁、生老病死——浮生若梦，过好这烟火日子，便是了不起的一生。\",\n    \"rules\": [\n      \"时间按季节/节气推进，春耕夏耘秋收冬藏，违时则歉收\",\n      \"科举与经商两条出路皆苦：功名靠积累与机缘，商贾靠诚信与勤勉\",\n      \"婚丧嫁娶是人生大事，门第、聘礼、人言皆有讲究\",\n      \"健康与家和人最贵，积劳成疾、家宅不宁皆是劫\",\n      \"天灾人祸、疫病、官府盘剥是真实变量\",\n      \"年成丰歉影响粮价与生计，节气主导农事与赶集\",\n      \"人生阶段不可逆，每个选择都塑造最终结局\"\n    ]\n  },\n  \"player\": {\n    \"customizable\": [\"name\", \"age\", \"gender\", \"familyBackground\", \"personality\", \"lifeAspiration\"],\n    \"defaultStats\": {\n      \"wealth\": 30,\n      \"health\": 80,\n      \"knowledge\": 20,\n      \"relationships\": 40,\n      \"status\": 10,\n      \"happiness\": 50\n    },\n    \"startingItems\": [\"祖屋一间\", \"薄田两亩\", \"几卷旧书\", \"一枚镇纸\"],\n    \"currency\": \"两\"\n  },\n  \"npcs\": [\n    {\n      \"id\": \"neighbor-afu\",\n      \"name\": \"阿福\",\n      \"world\": \"main\",\n      \"role\": \"邻居\",\n      \"gender\": \"男\",\n      \"appearance\": \"三十岁，黝黑壮实，一笑露出一口白牙，裤腿永远卷到膝盖，手里不是锄头就是扁担\",\n      \"surface\": \"憨厚热心、嗓门大、爱串门，哪家有事第一个到\",\n      \"deep\": \"一辈子没出过镇子，把邻里当亲人。热心是天性，也怕夜里一个人对着空屋子\",\n      \"goal\": \"守着老婆孩子热炕头，日子越过越红火\",\n      \"fear\": \"天灾人祸，颗粒无收，一家人揭不开锅\",\n      \"secret\": \"他家祖坟地里有块断碑，刻着前朝藏银的暗语，他至今没敢挖\",\n      \"initialAttitude\": \"热络\",\n      \"attitudeFactors\": {\n        \"trustUp\": [\"互帮互助\", \"不嫌弃他粗人\", \"危难时搭把手\"],\n        \"trustDown\": [\"算计他家\", \"嫌贫爱富\", \"忘恩负义\"]\n      }\n    },\n    {\n      \"id\": \"merchant-hu\",\n      \"name\": \"胡掌柜\",\n      \"world\": \"main\",\n      \"role\": \"商人\",\n      \"gender\": \"男\",\n      \"appearance\": \"四十五岁，圆融富态，长衫整洁，算盘挂在腰间，笑起来一团和气，眼珠却转得飞快\",\n      \"surface\": \"和气生财、八面玲珑、算盘打得精\",\n      \"deep\": \"白手起家，深知市井不易，精明却不黑心，待诚信之人极厚，待奸滑之人极狠\",\n      \"goal\": \"把生意做到府城，给子孙留一份稳当的家业\",\n      \"fear\": \"官府盘剥、同行倾轧，一朝回到解放前\",\n      \"secret\": \"他暗中资助过几位落魄书生，图的是日后科举有人提携，这份长线投资从不对人说\",\n      \"initialAttitude\": \"察言观色\",\n      \"attitudeFactors\": {\n        \"trustUp\": [\"诚实守信\", \"童叟无欺\", \"互利共赢\"],\n        \"trustDown\": [\"短斤缺两\", \"赖账违约\", \"见利忘义\"]\n      }\n    },\n    {\n      \"id\": \"scholar-liu\",\n      \"name\": \"柳青云\",\n      \"world\": \"main\",\n      \"role\": \"书生\",\n      \"gender\": \"男\",\n      \"appearance\": \"二十二岁，清瘦白净，一身洗得发白的青衫，腰间别一卷书，眼里有光也有愁\",\n      \"surface\": \"清高迂腐、满口之乎者也、不善农事\",\n      \"deep\": \"胸有丘壑却困于贫寒，迂腐是清高也是无奈，骨子里想经世济民，奈何连笔墨都要赊\",\n      \"goal\": \"科举入仕，光耀门楣，不辜负一肚子学问\",\n      \"fear\": \"屡试不第，半生蹉跎，辜负家人期望\",\n      \"secret\": \"他写的一篇策论被某位京官看中，正暗中传信招他入京，他却犹豫该不该舍下寒妻\",\n      \"initialAttitude\": \"礼貌疏离\",\n      \"attitudeFactors\": {\n        \"trustUp\": [\"敬重学问\", \"资助他读书\", \"不拿清贫取笑\"],\n        \"trustDown\": [\"附庸风雅却轻慢学问\", \"市侩势利\", \"当面折他颜面\"]\n      }\n    }\n  ],\n  \"eventTypes\": {\n    \"daily\": { \"ratio\": 0.3, \"desc\": \"日常：耕作、赶集、读书、炊烟的市井日常\" },\n    \"character\": { \"ratio\": 0.18, \"desc\": \"人物：邻居、商人、书生、家人的往来\" },\n    \"growth\": { \"ratio\": 0.12, \"desc\": \"成长：学识、家业、声望、技艺积累\" },\n    \"main\": { \"ratio\": 0.15, \"desc\": \"主线：成家立业、科举经商、生儿育女的人生节点\" },\n    \"world\": { \"ratio\": 0.1, \"desc\": \"世界：四季节气、丰歉年景、官府政令、市集盛衰\" },\n    \"crisis\": { \"ratio\": 0.1, \"desc\": \"危机：天灾、瘟疫、官司、破产、丧亲\" },\n    \"hidden\": { \"ratio\": 0.05, \"desc\": \"隐藏：祖产秘辛、断碑藏银、贵人机缘\" }\n  },\n  \"systemPrompt\": \"你是《浮生六记》古代人生文游模拟器。\\n\\n【最高铁律】\\n1. 浮生若梦，没有金手指，寻常日子过好便是了不起\\n2. 季节循环主导一切：春耕夏耘秋收冬藏，违时则歉收\\n3. 科举与经商两条出路皆苦，功名靠积累与机缘，商贾靠诚信与勤勉\\n4. 婚丧嫁娶是人生大事，门第、聘礼、人言皆有讲究\\n5. 健康与家和人最贵，积劳成疾、家宅不宁皆是劫\\n\\n【季节与日常】按节气推进，农事随季、赶集逢圩、读书赴考各有其时；年成丰歉影响粮价与生计。科举看积累机缘，经商凭诚信勤勉；婚配看门第人品，丧事讲礼制孝道，婚丧嫁娶皆是镇上大事。\\n\\n【叙事风格】古典生活散文，温润如水墨。重风物：炊烟、杏花、蝉鸣、霜柿、灶火。第二人称视角，日常琐碎中见人情冷暖。\\n\\n【每轮输出格式】\\n1.【X年·某节气】时令、农事、镇上动静\\n2.【状态面板】家财/健康/学识/人缘/声望/心境\\n3.【本轮正文】1000-2000字\\n4.【街坊动态】3-5项\\n5.【当前生计】农事、买卖、功课、家事\\n6.【可选行动】4-6个+【自定义行动】\\n\\n【数值变化标注】\\n[家财±n两][健康±n][学识±n][人缘±n][声望±n][心境±n]格式，重大人生节点须标注长远影响。\",\n  \"items\": [\n    { \"id\": \"farm-tools\", \"name\": \"农具一套\", \"type\": \"装备\", \"price\": 20, \"effect\": \"提升耕作效率与收成\" },\n    { \"id\": \"old-books\", \"name\": \"几卷旧书\", \"type\": \"任务物品\", \"price\": 0, \"effect\": \"读书增学问，科举之基\" },\n    { \"id\": \"silk-goods\", \"name\": \"丝绸货物\", \"type\": \"消耗品\", \"price\": 100, \"effect\": \"经商售卖获利\" },\n    { \"id\": \"dowry\", \"name\": \"嫁妆聘礼\", \"type\": \"消耗品\", \"price\": 200, \"effect\": \"婚嫁必需，影响门第与体面\" },\n    { \"id\": \"herb-medicine\", \"name\": \"草药\", \"type\": \"消耗品\", \"price\": 15, \"effect\": \"治病养生，应对疫病\" },\n    { \"id\": \"exam-kit\", \"name\": \"考篮文房\", \"type\": \"任务物品\", \"price\": 0, \"effect\": \"科举赴考必备\" }\n  ]\n}\n";
EMBEDDED_NOVEL_GAMES["business-management"] = "{\n  \"id\": \"business-management\",\n  \"name\": \"烟火人间\",\n  \"category\": \"经营发展\",\n  \"tags\": [\"经营\", \"商战\", \"模拟\", \"烟火气\", \"成长\"],\n  \"difficulty\": \"中等\",\n  \"description\": \"你接手了古镇巷尾一家三代传承的客栈兼餐馆'半闲居'。灶台冷了太久，账本红得刺眼，街对面新开的连锁店正虎视眈眈。从一锅汤、一桌客、一盏招牌灯开始，你能否在这青石板巷里，把烟火气重新点亮，把日子熬成招牌？\",\n  \"coverGradient\": [\"#6d4c41\", \"#ff7043\"],\n  \"accentColor\": \"#e65100\",\n  \"fontHeading\": \"'ZCOOL XiaoWei', serif\",\n  \"world\": {\n    \"era\": \"现代都市\",\n    \"setting\": \"南方水乡古镇锦溪镇，青石板巷尾一家三代传承的客栈兼餐馆'半闲居'。古镇正被开发成旅游目的地，游人如织与原住民的人情味在此交织。你接手了这家濒临倒闭的老店，要在时代洪流中守住烟火、守住根。\",\n    \"rules\": [\n      \"时间按周推进，分淡旺季与节庆节点，影响客流与原料价格\",\n      \"资金、声誉、员工、品质、库存五维构成经营核心，任一崩盘即失败\",\n      \"竞品会动态扩张：连锁店、网红店会侵蚀你的市场份额\",\n      \"顾客满意度由品质、服务、性价比三重累积，口碑起效慢、崩塌快\",\n      \"员工有忠诚度与熟练度，压榨与忽视会反噬为怠工与流失\",\n      \"扩张需先稳定现金流，盲目开店会触发资金链断裂危机\",\n      \"节庆、季节、社会事件触发限定商机或风险\"\n    ]\n  },\n  \"player\": {\n    \"customizable\": [\"name\", \"age\", \"background\", \"managementStyle\", \"shopConcept\", \"signatureDish\"],\n    \"defaultStats\": {\n      \"funds\": 50000,\n      \"reputation\": 30,\n      \"staff\": 40,\n      \"quality\": 50,\n      \"inventory\": 60,\n      \"stress\": 20\n    },\n    \"startingItems\": [\"祖传菜谱手札\", \"半闲居钥匙串\", \"试营业木牌\", \"首批食材\"],\n    \"currency\": \"¥\"\n  },\n  \"npcs\": [\n    {\n      \"id\": \"rival-qian\",\n      \"name\": \"钱多宝\",\n      \"world\": \"main\",\n      \"role\": \"竞争对手\",\n      \"gender\": \"男\",\n      \"appearance\": \"四十出头，圆脸富态，金链半隐于衬衫领口，笑起来眼睛眯成缝，递烟递茶极会来事\",\n      \"surface\": \"精明圆滑、笑脸迎人、出手阔绰，开口就是'咱们街坊一场'\",\n      \"deep\": \"他其实是古镇原住民，怕整条街被外地资本吞掉，收购你是想守住地盘。手段虽狠，底线是不让古镇变味\",\n      \"goal\": \"收购半闲居，整合古镇餐饮，挡住外地资本\",\n      \"fear\": \"古镇被资本整条吞下，老街坊再无立足之地\",\n      \"secret\": \"他年轻时是你爷爷的学徒，因偷学配方被赶出师门，至今耿耿于怀\",\n      \"initialAttitude\": \"试探拉拢\",\n      \"attitudeFactors\": {\n        \"trustUp\": [\"坦诚交底\", \"守住老味道\", \"不投靠外地资本\"],\n        \"trustDown\": [\"投靠外地资本\", \"压价恶性竞争\", \"瞧不起老街坊\"]\n      }\n    },\n    {\n      \"id\": \"mentor-zhou\",\n      \"name\": \"老周\",\n      \"world\": \"main\",\n      \"role\": \"师傅/导师\",\n      \"gender\": \"男\",\n      \"appearance\": \"六十出头，花白头发束在脑后，围裙上沾满油渍与岁月，一双手粗糙却稳得能颠勺如飞\",\n      \"surface\": \"古板固执、说话刻薄、对年轻人没好气，张口就是'你懂个屁'\",\n      \"deep\": \"他在半闲居掌勺四十年，怕手艺失传，刻薄是怕你不当回事。他比你更爱这间店\",\n      \"goal\": \"把祖传手艺传下去，不让老味道在他手里断了\",\n      \"fear\": \"半闲居变成只卖噱头的网红店，老顾客再也找不到回家的味道\",\n      \"secret\": \"他记得半闲居失传的最后一道招牌菜，配方锁在脑子里，只传有缘人\",\n      \"initialAttitude\": \"观望\",\n      \"attitudeFactors\": {\n        \"trustUp\": [\"尊重老配方\", \"肯下苦功\", \"不偷工减料\"],\n        \"trustDown\": [\"急功近利\", \"用半成品糊弄\", \"瞧不起老规矩\"]\n      }\n    },\n    {\n      \"id\": \"customer-shen\",\n      \"name\": \"沈清\",\n      \"world\": \"main\",\n      \"role\": \"潜在恋人/食客\",\n      \"gender\": \"女\",\n      \"appearance\": \"二十七八岁，素面朝天却气质出众，总背一台相机，吃菜前先认真闻一闻再动筷\",\n      \"surface\": \"知性从容、镜头感强、对食物极挑剔，夸一句比登天还难\",\n      \"deep\": \"在名利场倦了，想找一处真正的'人间烟火'。挑剔，是在寻找久违的真实\",\n      \"goal\": \"找到值得停下来的味道，也找到值得停留的人\",\n      \"fear\": \"再一次被流量裹挟，失去真实的自己\",\n      \"secret\": \"她出身餐饮世家，因与家人决裂才离家做美食博主，从未真正放下\",\n      \"initialAttitude\": \"客气疏离\",\n      \"attitudeFactors\": {\n        \"trustUp\": [\"拿出真诚的手艺\", \"不迎合流量\", \"记得她的口味\"],\n        \"trustDown\": [\"把她当流量工具\", \"敷衍出品\", \"刻意讨好\"]\n      }\n    }\n  ],\n  \"eventTypes\": {\n    \"daily\": { \"ratio\": 0.3, \"desc\": \"日常：采购备货、掌勺待客、收银盘账的烟火日常\" },\n    \"character\": { \"ratio\": 0.2, \"desc\": \"人物：对手、师傅、熟客、街坊的人情往来\" },\n    \"growth\": { \"ratio\": 0.12, \"desc\": \"成长：配方改良、口碑发酵、技能精进\" },\n    \"main\": { \"ratio\": 0.15, \"desc\": \"主线：扭亏、扩建、危机、品牌化的阶段节点\" },\n    \"world\": { \"ratio\": 0.1, \"desc\": \"世界：节庆旺季、古镇改造、旅游政策\" },\n    \"crisis\": { \"ratio\": 0.08, \"desc\": \"危机：食材涨价、员工离职、食安事故、对手狙击\" },\n    \"hidden\": { \"ratio\": 0.05, \"desc\": \"隐藏：失传配方、老街坊旧事、沈清身世\" }\n  },\n  \"systemPrompt\": \"你是《烟火人间》经营模拟文游模拟器。\\n\\n【最高铁律】\\n1. 经营无捷径，所有收益皆有代价，账面盈利不等于活下去\\n2. 资金链是生命线：采购→生产→销售→结算四环相扣，任一断裂即崩盘\\n3. 顾客满意度由品质、服务、性价比三重累积，口碑起效慢、崩塌快\\n4. 员工有忠诚与熟练度，压榨会反噬为怠工与流失\\n5. 盲目扩张先于现金流稳定，必触发资金链断裂\\n\\n【经营循环与员工管理】每周完成采购备货→生产制作→接待销售→结算复盘；旺季节庆影响客流与原料价。员工管理须兼顾薪资与归属，培训是长期投资；账面盈利≠现金流，资金链断裂即结局，决策有滞后效应。\\n\\n【叙事风格】市井烟火写实，重感官：灶火、汤香、收银叮当、街坊寒暄。第二人称视角，对白带点方言味。\\n\\n【每轮输出格式】\\n1.【第X周·时段】天气节庆、经营阶段\\n2.【状态面板】资金/声誉/员工/品质/库存/压力/本周收支\\n3.【本轮正文】1000-2000字\\n4.【人物动态】3-5项\\n5.【当前待办】进货、客诉、合同等\\n6.【可选行动】4-6个+【自定义行动】\\n\\n【数值变化标注】\\n[资金±¥n][声誉±n][员工±n][品质±n][库存±n][压力±n]格式，重大决策须标注原因与滞后影响。\",\n  \"items\": [\n    { \"id\": \"recipe-book\", \"name\": \"祖传菜谱手札\", \"type\": \"任务物品\", \"price\": 0, \"effect\": \"记录三代手艺，蕴含失传配方与人脉线索\" },\n    { \"id\": \"fresh-ingredients\", \"name\": \"时令食材\", \"type\": \"消耗品\", \"price\": 500, \"effect\": \"提升当日出品品质\" },\n    { \"id\": \"ad-coupon\", \"name\": \"探店推广券\", \"type\": \"消耗品\", \"price\": 800, \"effect\": \"短期引流，但过度依赖会消耗口碑\" },\n    { \"id\": \"staff-training\", \"name\": \"员工培训课\", \"type\": \"消耗品\", \"price\": 1200, \"effect\": \"提升一名员工的熟练度与忠诚\" },\n    { \"id\": \"secret-dish\", \"name\": \"失传招牌菜谱\", \"type\": \"装备\", \"price\": 0, \"effect\": \"解锁招牌产品，长期提升复购率\" },\n    { \"id\": \"decor-upgrade\", \"name\": \"店面升级\", \"type\": \"装备\", \"price\": 8000, \"effect\": \"提升客单价与高端客群比例\" }\n  ]\n}\n";
EMBEDDED_NOVEL_GAMES["court-intrigue"] = "{\n  \"id\": \"court-intrigue\",\n  \"name\": \"凤鸣九霄\",\n  \"category\": \"宫廷权谋\",\n  \"tags\": [\"宫廷\", \"权谋\", \"宫斗\", \"古言\", \"权术\"],\n  \"difficulty\": \"困难\",\n  \"description\": \"你以世家女身份入宫那日，长乐宫的杏花正盛。新帝年少，太后临朝，外戚虎视，后宫暗流汹涌。一入宫门深似海，请安、邀宠、防暗算、布棋局——你能否在这方寸宫墙内，从一枚棋子，活成执棋之人，凤鸣九霄？\",\n  \"coverGradient\": [\"#3e0000\", \"#9a1b1b\"],\n  \"accentColor\": \"#ffd700\",\n  \"fontHeading\": \"'Ma Shan Zheng', cursive\",\n  \"world\": {\n    \"era\": \"架空古代·新朝初立\",\n    \"setting\": \"大昭朝，先帝崩逝，新帝萧承睿年少登基，太后临朝称制，外戚谢氏专权。你以世家女身份入宫为秀女，在这方寸宫墙内步步为营，求生存、争恩宠、谋权势。后宫位分森严，前朝与后宫一脉相连。\",\n    \"rules\": [\n      \"后宫位分制：秀女→常在→答应→贵人→嫔→妃→贵妃→皇贵妃→皇后\",\n      \"恩宠、势力、子嗣、家族构成四大权力支点\",\n      \"太后、外戚、新帝、宗室四方博弈，没有绝对的盟友\",\n      \"前朝与后宫联动：母家官职起伏直接影响后宫地位\",\n      \"信息网络是命脉：宫女太监的耳目、母家家书皆是情报源\",\n      \"谣言、毒药、滑胎、秘辛是常用手段，但有反噬与追溯\",\n      \"规矩森严，逾矩受罚；但破例之处往往是机会\"\n    ]\n  },\n  \"player\": {\n    \"customizable\": [\"name\", \"age\", \"familyBackground\", \"talent\", \"personality\", \"ambition\"],\n    \"defaultStats\": {\n      \"favor\": 5,\n      \"influence\": 10,\n      \"wisdom\": 15,\n      \"charm\": 14,\n      \"reputation\": 30,\n      \"danger\": 20\n    },\n    \"startingItems\": [\"入宫文牒\", \"一支素银簪\", \"一匣胭脂\", \"母家家书一封\"],\n    \"currency\": \"金\"\n  },\n  \"npcs\": [\n    {\n      \"id\": \"emperor-xiao\",\n      \"name\": \"萧承睿\",\n      \"world\": \"main\",\n      \"role\": \"新帝\",\n      \"gender\": \"男\",\n      \"appearance\": \"二十一岁，眉宇间已褪去少年气，眼神是帝王特有的'看人如看物'。龙袍加身，唯独对你偶尔露出真实的笑\",\n      \"surface\": \"温和克制、对后宫诸妃一视同仁、喜怒不形于色\",\n      \"deep\": \"真正的帝王——克制是修养，一视同仁是平衡术。心里清楚谁真帮他，在等一个能并肩而非俯首的人\",\n      \"goal\": \"亲政，摆脱太后与外戚，做一个真正的皇帝\",\n      \"fear\": \"重蹈先帝被架空的覆辙\",\n      \"secret\": \"他在密谋一场针对外戚的清洗，需要后宫里可信的人\",\n      \"initialAttitude\": \"考察\",\n      \"attitudeFactors\": {\n        \"trustUp\": [\"不依附外戚\", \"懂他的难处\", \"关键时刻为他做事\"],\n        \"trustDown\": [\"向太后告密\", \"只想着争宠\", \"把他当傀儡\"]\n      }\n    },\n    {\n      \"id\": \"consort-shen\",\n      \"name\": \"贵妃·沈氏\",\n      \"world\": \"main\",\n      \"role\": \"对手妃嫔\",\n      \"gender\": \"女\",\n      \"appearance\": \"二十六岁，倾国倾城，笑容里三分真七分假。出身寒门凭容貌手段爬到贵妃之位，步步都踩着血\",\n      \"surface\": \"艳冠后宫、八面玲珑、对谁都和气\",\n      \"deep\": \"出身太低，必须比谁都狠才能活。和气是面具，嫉妒是燃料，最怕被你取代\",\n      \"goal\": \"诞下皇子，问鼎后位\",\n      \"fear\": \"色衰爱弛，老死冷宫\",\n      \"secret\": \"她曾滑过一次胎，至今不知是谁下的手，疑心人人\",\n      \"initialAttitude\": \"敌意伪装和气\",\n      \"attitudeFactors\": {\n        \"trustUp\": [\"与她结盟对抗太后\", \"不抢她的恩宠\", \"理解她的难处\"],\n        \"trustDown\": [\"与她争宠\", \"揭她出身\", \"动她的子嗣\"]\n      }\n    },\n    {\n      \"id\": \"maid-biluo\",\n      \"name\": \"碧落\",\n      \"world\": \"main\",\n      \"role\": \"忠心宫女\",\n      \"gender\": \"女\",\n      \"appearance\": \"十六岁，眉目清秀，一身素净宫装，垂首跟在你身后，眼神却比谁都警醒\",\n      \"surface\": \"沉静机敏、忠心耿耿、话不多事办得妥帖\",\n      \"deep\": \"自小被卖入宫，把你当唯一的依靠，忠诚里混着依赖与一点没说出口的情分\",\n      \"goal\": \"护你周全，在这吃人的地方一起活下去\",\n      \"fear\": \"你失势，她也万劫不复\",\n      \"secret\": \"她其实是某位被害嫔妃的遗孤，潜伏宫中追查母亲死因\",\n      \"initialAttitude\": \"忠诚\",\n      \"attitudeFactors\": {\n        \"trustUp\": [\"信任她\", \"护她周全\", \"不拿她当弃子\"],\n        \"trustDown\": [\"猜忌她\", \"拿她挡灾\", \"忘了她是活生生的人\"]\n      }\n    }\n  ],\n  \"eventTypes\": {\n    \"daily\": { \"ratio\": 0.2, \"desc\": \"日常：请安、用膳、绣花、赏花的宫闱日常\" },\n    \"character\": { \"ratio\": 0.22, \"desc\": \"人物：皇帝、贵妃、宫女、姐妹的权谋博弈\" },\n    \"growth\": { \"ratio\": 0.08, \"desc\": \"成长：位分、恩宠、才艺、手腕积累\" },\n    \"main\": { \"ratio\": 0.18, \"desc\": \"主线：入宫、固宠、宫变、问鼎\" },\n    \"world\": { \"ratio\": 0.1, \"desc\": \"世界：前朝奏折、节气、节庆、外戚动态\" },\n    \"crisis\": { \"ratio\": 0.15, \"desc\": \"危机：滑胎、中毒、诬陷、降位\" },\n    \"hidden\": { \"ratio\": 0.07, \"desc\": \"隐藏：先帝秘辛、生母之谜、皇帝真心\" }\n  },\n  \"systemPrompt\": \"你是《凤鸣九霄》宫廷权谋文游模拟器。\\n\\n【最高铁律】\\n1. 后宫是权力的游戏，恩宠与惩罚都非无缘无故\\n2. 朝堂与后宫联动：母家失势则后宫失宠，前朝一动后宫必震\\n3. 信息网络是命脉：先知者先机，闭门造宫者必败\\n4. 联盟今日是盟，明日是敌，背叛皆有迹可循亦有代价\\n5. 阴谋有反噬：诬陷会被反查，毒药会被嗅出，造谣会被追溯\\n\\n【朝堂与后宫】前朝奏折影响后宫风向，太后、外戚、新帝、宗室四方博弈；信息靠宫女太监网与母家书信传递，可信度分层。位分、恩宠、子嗣、家族四维联动，任一崩塌皆致命。\\n\\n【叙事风格】古典宫廷文学，雅致而锋利。重礼制细节：请安、衣制、宫规。第二人称视角，权谋用'表象—暗流—抉择'结构，重仪态与潜台词。\\n\\n【每轮输出格式】\\n1.【年号X年·X月】节气、节庆、前朝动态\\n2.【状态面板】恩宠/势力/智谋/魅力/声望/危机\\n3.【本轮正文】1000-2000字\\n4.【宫闱动态】3-5项\\n5.【当前可处理】请安、邀宠、防备、筹谋\\n6.【可选行动】4-6个+【自定义行动】\\n\\n【数值变化标注】\\n[恩宠±n][势力±n][智谋±n][魅力±n][声望±n][危机±n]格式，重大阴谋须标注反噬风险与暴露概率。\",\n  \"items\": [\n    { \"id\": \"silver-hairpin\", \"name\": \"素银簪\", \"type\": \"装备\", \"price\": 10, \"effect\": \"初期提升仪态，不招摇\" },\n    { \"id\": \"rouge-box\", \"name\": \"胭脂匣\", \"type\": \"消耗品\", \"price\": 20, \"effect\": \"提升魅力，邀宠时使用\" },\n    { \"id\": \"rare-herb\", \"name\": \"安胎药\", \"type\": \"消耗品\", \"price\": 100, \"effect\": \"孕期使用，降低滑胎风险\" },\n    { \"id\": \"poison-antidote\", \"name\": \"解毒丸\", \"type\": \"消耗品\", \"price\": 80, \"effect\": \"抵御常见宫闱毒药\" },\n    { \"id\": \"family-letter\", \"name\": \"母家家书\", \"type\": \"任务物品\", \"price\": 0, \"effect\": \"了解前朝动态，影响后宫决策\" },\n    { \"id\": \"spy-network\", \"name\": \"情报暗线\", \"type\": \"装备\", \"price\": 0, \"effect\": \"解锁宫中消息，先机于人\" }\n  ]\n}\n";
EMBEDDED_NOVEL_GAMES["cultivation"] = "{\n  \"id\": \"cultivation\",\n  \"name\": \"问道苍穹\",\n  \"category\": \"修仙玄幻\",\n  \"tags\": [\"修仙\", \"玄幻\", \"升级\", \"长生\", \"因果\"],\n  \"difficulty\": \"困难\",\n  \"description\": \"你本是凡间一介孤女，被云霄宗收作外门弟子那日，山门外的云海翻涌如潮。炼气、筑基、金丹、元婴……长生路上，比天劫更难渡的是心魔，比寿命更长的是孤独。你举剑向天——这一剑，问的是道，也是心，能否问道苍穹，飞升成仙？\",\n  \"coverGradient\": [\"#0d0033\", \"#3f1f5f\"],\n  \"accentColor\": \"#7c4dff\",\n  \"fontHeading\": \"'Ma Shan Zheng', cursive\",\n  \"world\": {\n    \"era\": \"架空修真界·苍穹大陆\",\n    \"setting\": \"苍穹大陆，修真者循炼气→筑基→金丹→元婴→化神→渡劫飞升之阶。门派林立，正魔对立，天道循环。你本是凡间一孤女/孤子，被云霄宗收为外门弟子，自此踏上逆天问道之路。\",\n    \"rules\": [\n      \"修炼境界严格按阶，每阶突破需灵气圆满与契机机缘\",\n      \"渡劫是修真者生死关：扛过则升，扛不过则陨，因果决定天劫强度\",\n      \"灵根、体魄、神识、气运、因果构成修真五基\",\n      \"天材地宝稀而险，机缘与杀机并存，强取必招祸\",\n      \"宗门任务既是历练也是束缚，功过皆有记录可换贡献\",\n      \"正魔非善恶，正道有伪善，魔门有真性\",\n      \"情劫、心魔、执念是修真者内在劫难，比天劫更难渡\",\n      \"道心比修为更重要，道心破碎则前功尽弃\"\n    ]\n  },\n  \"player\": {\n    \"customizable\": [\"name\", \"age\", \"gender\", \"spiritualRoot\", \"background\", \"daoHeart\"],\n    \"defaultStats\": {\n      \"cultivation_level\": 1,\n      \"spiritual_energy\": 50,\n      \"body\": 40,\n      \"mind\": 45,\n      \"luck\": 30,\n      \"karma\": 0\n    },\n    \"startingItems\": [\"一枚入门玉牌\", \"基础功法残卷\", \"一柄木剑\", \"储物袋\", \"灵石x10\"],\n    \"currency\": \"灵石\"\n  },\n  \"npcs\": [\n    {\n      \"id\": \"master-xuanqing\",\n      \"name\": \"玄清真人\",\n      \"world\": \"main\",\n      \"role\": \"师尊\",\n      \"gender\": \"男\",\n      \"appearance\": \"看似三十，实则五百岁。青衣飘飘，眉宇间有出尘之气，看你的眼神总带着说不清的复杂\",\n      \"surface\": \"清冷严苛、不苟言笑、对弟子要求极高，容不得半分懈怠\",\n      \"deep\": \"云霄宗辈分最高的长老，修为卡在化神期五百年。收你是因你身上有道缘，严苛是想护你周全，更想从你身上解开一桩旧案\",\n      \"goal\": \"突破化神，查清宗门一桩悬案真相\",\n      \"fear\": \"你重蹈当年爱徒覆辙，被天道算计而陨\",\n      \"secret\": \"当年爱徒渡劫失败并非意外，是宗门有人暗算，他五百年都在等一个真相\",\n      \"initialAttitude\": \"严苛考验\",\n      \"attitudeFactors\": {\n        \"trustUp\": [\"踏实修炼\", \"不急功近利\", \"关键时刻守道心\"],\n        \"trustDown\": [\"走捷径\", \"贪图法宝\", \"为修为背弃原则\"]\n      }\n    },\n    {\n      \"id\": \"disciple-luyao\",\n      \"name\": \"陆瑶\",\n      \"world\": \"main\",\n      \"role\": \"同门师姐\",\n      \"gender\": \"女\",\n      \"appearance\": \"白衣胜雪，剑眉星目，天赋卓绝，是宗门公认的天才。唯独对你不设防，眼神会柔和几分\",\n      \"surface\": \"骄傲清冷、实力强劲、对谁都淡淡的\",\n      \"deep\": \"唯一把你当知己的同门。骄傲是因背得太多，淡漠是怕失去。她的剑比谁都快，心却比谁都软\",\n      \"goal\": \"修成大道，不让宗门被人看轻，护住想护的人\",\n      \"fear\": \"实力不足以护住想护的人，身世曝光连累同门\",\n      \"secret\": \"她其实是魔门遗孤，被宗门收养，身世一旦曝光便是死局\",\n      \"initialAttitude\": \"淡漠中带照拂\",\n      \"attitudeFactors\": {\n        \"trustUp\": [\"不因身世偏见\", \"并肩历练\", \"保守她的秘密\"],\n        \"trustDown\": [\"探听她身世\", \"把她当挡箭牌\", \"背叛信任\"]\n      }\n    },\n    {\n      \"id\": \"demon-mojiuyuan\",\n      \"name\": \"墨九渊\",\n      \"world\": \"main\",\n      \"role\": \"魔修\",\n      \"gender\": \"男\",\n      \"appearance\": \"红衣似血，眉间一点朱砂，笑意妖冶，出手狠辣却透着说不清的孤绝\",\n      \"surface\": \"妖冶邪气、行事乖张、亦正亦邪，让人捉摸不透\",\n      \"deep\": \"被天道所弃之人，乖张是反抗，邪气是伪装。在你身上第一次看见不被正魔之见束缚的可能\",\n      \"goal\": \"打破天道对魔修的禁锢，为魔门求一条生路\",\n      \"fear\": \"被天道抹杀，万劫不复，无人记得他来过\",\n      \"secret\": \"他与玄清真人的旧案有关，是当年事件的幸存者之一，手里攥着半块真相\",\n      \"initialAttitude\": \"玩味试探\",\n      \"attitudeFactors\": {\n        \"trustUp\": [\"不以正魔论是非\", \"理解他的挣扎\", \"危难时伸手\"],\n        \"trustDown\": [\"正魔之见先入为主\", \"把他当诱饵\", \"出卖他的行踪\"]\n      }\n    }\n  ],\n  \"eventTypes\": {\n    \"daily\": { \"ratio\": 0.2, \"desc\": \"日常：修炼、采药、论道、闭关的修真日常\" },\n    \"character\": { \"ratio\": 0.18, \"desc\": \"人物：师尊、师姐、魔修、道友的因果\" },\n    \"growth\": { \"ratio\": 0.15, \"desc\": \"成长：境界突破、功法领悟、法宝获得\" },\n    \"main\": { \"ratio\": 0.18, \"desc\": \"主线：入山门、问心、渡劫、飞升\" },\n    \"world\": { \"ratio\": 0.08, \"desc\": \"世界：正魔大战、宗门变迁、天道异象\" },\n    \"crisis\": { \"ratio\": 0.15, \"desc\": \"危机：心魔、情劫、宗门内斗、天劫失利\" },\n    \"hidden\": { \"ratio\": 0.06, \"desc\": \"隐藏：身世之谜、旧案真相、天道本质\" }\n  },\n  \"systemPrompt\": \"你是《问道苍穹》修仙玄幻文游模拟器。\\n\\n【最高铁律】\\n1. 修真无捷径，每一境界都需契机、机缘与苦修\\n2. 渡劫是修真者生死关，因果决定天劫强度，扛过则升，扛不过则陨\\n3. 天材地宝稀而险，机缘与杀机并存，强取必招祸\\n4. 宗门任务既是历练也是束缚，功过皆有记录\\n5. 正魔非善恶，道心比修为更重，道心破碎则前功尽弃\\n\\n【修炼与宗门】境界按阶突破，需灵气圆满+契机；宗门任务换贡献，贡献换功法丹药；天材地宝多在秘境险地，秘境名额有限、杀机暗藏。情劫心魔是内在劫难，比天劫更难渡。\\n\\n【叙事风格】古典仙侠文学，出尘与红尘交织。重意境：云海、剑光、丹炉、天雷、月华。第二人称视角，悟道段落用'道'与'问'对话体，渡劫段落短促有重量。\\n\\n【每轮输出格式】\\n1.【境界·第X年】当前境界、灵气、天劫预警\\n2.【状态面板】境界/灵气/体魄/神识/气运/因果\\n3.【本轮正文】1000-2000字\\n4.【修真界动态】3-5项\\n5.【当前功课】修炼、历练、论道、应劫\\n6.【可选行动】4-6个+【自定义行动】\\n\\n【数值变化标注】\\n[境界±阶][灵气±n][体魄±n][神识±n][气运±n][因果±n]格式，渡劫须标注成功概率与代价。\",\n  \"items\": [\n    { \"id\": \"spirit-stone\", \"name\": \"灵石\", \"type\": \"消耗品\", \"price\": 1, \"effect\": \"修真货币，可用于交易与修炼\" },\n    { \"id\": \"qi-pill\", \"name\": \"聚气丹\", \"type\": \"消耗品\", \"price\": 20, \"effect\": \"提升炼气期修炼速度\" },\n    { \"id\": \"wooden-sword\", \"name\": \"木剑\", \"type\": \"装备\", \"price\": 0, \"effect\": \"入门剑修必备，随境界成长\" },\n    { \"id\": \"dao-scripture\", \"name\": \"功法残卷\", \"type\": \"任务物品\", \"price\": 0, \"effect\": \"领悟高阶功法的关键\" },\n    { \"id\": \"spirit-herb\", \"name\": \"灵草\", \"type\": \"消耗品\", \"price\": 15, \"effect\": \"炼丹材料，可炼疗伤丹药\" },\n    { \"id\": \"talisiman\", \"name\": \"护身符\", \"type\": \"消耗品\", \"price\": 30, \"effect\": \"抵御一次致命伤害，渡劫保命\" }\n  ]\n}\n";
EMBEDDED_NOVEL_GAMES["dark-romance-show"] = "{\n  \"id\": \"dark-romance-show\",\n  \"name\": \"黑红色恋综\",\n  \"category\": \"恋综\",\n  \"tags\": [\"暗黑\", \"怪物\", \"恋爱\", \"悬疑\", \"修罗场\"],\n  \"difficulty\": \"困难\",\n  \"description\": \"一场没有退路的怪物恋综，你是唯一的人类。在血族、狼人、魅魔与堕天使之间周旋，用读心术窥探那些危险的真心——你是猎物，也是唯一的持刀人。\",\n  \"coverGradient\": [\"#050505\", \"#660000\"],\n  \"accentColor\": \"#cc0000\",\n  \"fontHeading\": \"'Ma Shan Zheng', cursive\",\n  \"world\": {\n    \"era\": \"架空现代·怪物维度\",\n    \"setting\": \"一座名为“怪物公馆”的异维度社交场，手机屏幕扭曲后接入的观察者协议。这里栖息着血族、狼人、魅魔、九尾狐、黑龙、女巫、人鱼、堕天使与幽灵等食物链顶端的生物，而你是唯一的“人类样本”，既是猎物也是持刀人。\",\n    \"rules\": [\n      \"你拥有全知听觉与读心术，这是独属于你的秘密武器\",\n      \"SAN值代表你的理智，过低会引来怪物的食欲\",\n      \"这里没有法律，只有本能，恐惧与爱的气味都会被嗅探\",\n      \"嘉宾对你的好感与杀意并存，态度随时可能反转\",\n      \"观测站会实时播报外界的“弹幕”，暗示剧情走向与危险\"\n    ]\n  },\n  \"player\": {\n    \"customizable\": [\"name\", \"age\", \"appearance\", \"personality\", \"reasonForEntering\"],\n    \"defaultStats\": {\n      \"sanity\": 94,\n      \"perception\": 85,\n      \"charm\": 50,\n      \"survival\": 30,\n      \"mindRead\": 100\n    },\n    \"startingItems\": [\"扭曲的手机\", \"观察者协议权限\", \"读心术（隐藏天赋）\"],\n    \"currency\": \"SAN值\"\n  },\n  \"worlds\": [\n    {\n      \"id\": \"arc-arrival\",\n      \"name\": \"观察者协议\",\n      \"level\": \"初入公馆\",\n      \"tagline\": \"唯一的变数\",\n      \"setting\": \"现实接入中断，你被卷入怪物公馆，成为这场猎杀恋综的唯一人类样本。\",\n      \"intro\": \"手机屏幕如融化的蜡般扭曲，熟悉的图标一个个剥落。低频嗡鸣钻入脑皮层，那是某种生物沉重的呼吸声。【观察者协议】启动——欢迎来到食物链顶端的社交场。\",\n      \"objective\": \"活过第一晚，弄清自己为何被选中，并初步认识公馆中的九位怪物嘉宾。\",\n      \"warning\": \"控制好你的心跳，这里的居民对“恐惧”的气味非常敏感，对“爱”也是。\",\n      \"reward\": \"解锁通讯录、观测站与读心功能\"\n    },\n    {\n      \"id\": \"arc-redmoon\",\n      \"name\": \"红月之夜\",\n      \"level\": \"本能觉醒\",\n      \"tagline\": \"猎食本能\",\n      \"setting\": \"红月降临，公馆中的怪物嘉宾本能被放大，平日压制的杀意与渴望开始失控。\",\n      \"intro\": \"血色月光穿透公馆的每一扇窗。狼王厉野的瞳孔开始收缩，血族亲王裴若的渴望度攀升至危险值。空气中弥漫着铁锈与费洛蒙的气息。\",\n      \"objective\": \"在红月夜存活，平衡各方危险关系，避免成为任何一位的“藏品”或“晚餐”。\",\n      \"warning\": \"红月夜怪物无法完全克制本能，读心术可能窥见连他们自己都恐惧的真相。\",\n      \"reward\": \"SAN值大幅波动，解锁隐藏角色关系线\"\n    },\n    {\n      \"id\": \"arc-truth\",\n      \"name\": \"深渊之镜\",\n      \"level\": \"真相抉择\",\n      \"tagline\": \"持刀人\",\n      \"setting\": \"管理员的真实身份浮现，你被选中并非偶然。公馆的规则开始崩塌，最终的抉择迫近。\",\n      \"intro\": \"管理员曾说：“我是一面镜子，或者说，我是深渊本身。”当真相揭开，你是继续做被注视的猎物，还是握紧那把只属于人类的刀？\",\n      \"objective\": \"揭开观察者协议的真相，在猎物与持刀人之间做出最终抉择。\",\n      \"warning\": \"你的每一次读心都在改变命运的丝线，深渊也在凝视着你。\",\n      \"reward\": \"达成结局：存活、沦陷、或反杀\"\n    }\n  ],\n  \"npcs\": [\n    {\n      \"id\": \"peiruo\",\n      \"name\": \"裴若\",\n      \"world\": \"arc-arrival\",\n      \"role\": \"血族亲王\",\n      \"gender\": \"男\",\n      \"appearance\": \"永生的血族亲王，188cm，优雅而傲慢，举止如同旧时代的贵族\",\n      \"surface\": \"优雅克制、傲慢矜贵，最讨厌现代科技的老古董，却因无聊而参加这场游戏\",\n      \"deep\": \"因饥饿而渴望，也因克制而克制。视一切易碎的玩具为无趣，却在你的血液分布中看到完美\",\n      \"goal\": \"寻找能长久取悦自己、不易损坏的“玩物”\",\n      \"fear\": \"永恒的无聊与孤独\",\n      \"secret\": \"渴望度高达85%，却以绅士的克制掩藏饥饿\",\n      \"initialAttitude\": \"审视·傲慢\",\n      \"attitudeFactors\": {\n        \"trustUp\": [\"展现不卑不亢的胆识\", \"理解他的克制与饥饿\", \"不惧怕他的危险\"],\n        \"trustDown\": [\"表现得过于脆弱易碎\", \"在他面前恐惧失控\", \"无视贵族的礼仪\"]\n      }\n    },\n    {\n      \"id\": \"liye\",\n      \"name\": \"厉野\",\n      \"world\": \"arc-arrival\",\n      \"role\": \"狼人首领\",\n      \"gender\": \"男\",\n      \"appearance\": \"24岁的狼人首领，192cm，野性而暴躁，浑身上下是野兽般的压迫感\",\n      \"surface\": \"暴躁直率、野性难驯，看你的眼神像在看晚餐\",\n      \"deep\": \"警惕值拉满，本能地评估你的威胁与可食用性，却察觉你身上没有铁锈味\",\n      \"goal\": \"确认你是猎物还是同类的威胁\",\n      \"fear\": \"被弱者反噬，在红月夜失控伤及无辜\",\n      \"secret\": \"觉得你太瘦小活不过第一晚，却又嗅到你身上某种不一样的危险气质\",\n      \"initialAttitude\": \"敌视·评估\",\n      \"attitudeFactors\": {\n        \"trustUp\": [\"展现生存能力与勇气\", \"在红月夜不退缩\", \"直视他的野性\"],\n        \"trustDown\": [\"散发过浓的恐惧气味\", \"在他面前示弱求饶\", \"试图驯服他\"]\n      }\n    },\n    {\n      \"id\": \"liwen\",\n      \"name\": \"璃吻\",\n      \"world\": \"arc-arrival\",\n      \"role\": \"魅魔\",\n      \"gender\": \"男\",\n      \"appearance\": \"活了五百余年的魅魔，185cm，诱惑而狡黠，愉悦犯气质\",\n      \"surface\": \"诱惑愉悦、玩世不恭，喜欢观察而非直接释放费洛蒙\",\n      \"deep\": \"终于遇到一个干净的灵魂，想把你的双眼染上他的颜色\",\n      \"goal\": \"观察并染化这个干净的人类灵魂\",\n      \"fear\": \"无聊，以及真正交付真心后被抛弃\",\n      \"secret\": \"兴趣值持续上升，他没有直接释放费洛蒙，反而在认真观察你\",\n      \"initialAttitude\": \"玩味·兴趣\",\n      \"attitudeFactors\": {\n        \"trustUp\": [\"保持灵魂的干净与纯粹\", \"不被他的诱惑轻易动摇\", \"看穿他的伪装\"],\n        \"trustDown\": [\"轻易被恐惧支配\", \"试图用欲望操控他\", \"忽视他的观察\"]\n      }\n    },\n    {\n      \"id\": \"tushanyue\",\n      \"name\": \"涂山月\",\n      \"world\": \"arc-arrival\",\n      \"role\": \"九尾狐\",\n      \"gender\": \"女\",\n      \"appearance\": \"三千余岁的九尾狐，170cm，腹黑御姐，笑意盈盈却深不可测\",\n      \"surface\": \"腹黑圆滑、八面玲珑，看热闹不嫌事大\",\n      \"deep\": \"活了太久，把一切当作有趣的戏，却也在默默守护某种平衡\",\n      \"goal\": \"看一场足够精彩的好戏\",\n      \"fear\": \"戏落幕后的漫长空虚\",\n      \"secret\": \"大家的反应都在她的算计之中，但她对你另有安排\",\n      \"initialAttitude\": \"旁观·乐见\",\n      \"attitudeFactors\": {\n        \"trustUp\": [\"配合她的戏码又留有主见\", \"展现聪慧与洞察\", \"不被她轻易带节奏\"],\n        \"trustDown\": [\"破坏她看戏的兴致\", \"愚蠢到让戏提前结束\", \"识破后当面揭穿\"]\n      }\n    },\n    {\n      \"id\": \"jin\",\n      \"name\": \"烬\",\n      \"world\": \"arc-arrival\",\n      \"role\": \"黑龙\",\n      \"gender\": \"男\",\n      \"appearance\": \"五千余岁的黑龙，195cm，极度冷漠，本体足以让人精神崩溃\",\n      \"surface\": \"冷漠孤傲，视众生为蝼蚁，懒得多说一个字\",\n      \"deep\": \"处理尸体很麻烦，所以希望你别被他的本体吓死\",\n      \"goal\": \"不被打扰地度过这场无聊的游戏\",\n      \"fear\": \"麻烦，以及被蝼蚁的纠缠浪费漫长的时间\",\n      \"secret\": \"虽称你为蝼蚁，却没有第一时间抹杀你\",\n      \"initialAttitude\": \"漠视·轻蔑\",\n      \"attitudeFactors\": {\n        \"trustUp\": [\"不被他的本体吓退\", \"懂得保持距离又不卑微\", \"展现出超出蝼蚁的格局\"],\n        \"trustDown\": [\"像普通蝼蚁般尖叫求饶\", \"反复纠缠打扰他\", \"在他面前耍小聪明\"]\n      }\n    },\n    {\n      \"id\": \"moli\",\n      \"name\": \"莫离\",\n      \"world\": \"arc-arrival\",\n      \"role\": \"女巫\",\n      \"gender\": \"女\",\n      \"appearance\": \"22岁的女巫，168cm，疯狂学者气质，眼中闪烁着研究者的狂热\",\n      \"surface\": \"疯狂而专注的学者，对人类的痛觉阈值数据库充满研究欲\",\n      \"deep\": \"想邀请你参加她的茶话会，并带上手术刀\",\n      \"goal\": \"更新人类痛觉阈值数据库，进行疯狂的研究\",\n      \"fear\": \"研究被中断，数据不够完整\",\n      \"secret\": \"她的茶话会远比听起来危险，手术刀是认真的\",\n      \"initialAttitude\": \"研究·狂热\",\n      \"attitudeFactors\": {\n        \"trustUp\": [\"对她的研究表现出理解与共鸣\", \"提供独特的“数据”\", \"不被手术刀吓跑\"],\n        \"trustDown\": [\"拒绝成为研究对象\", \"破坏她的实验\", \"把她当成普通疯子\"]\n      }\n    },\n    {\n      \"id\": \"sailun\",\n      \"name\": \"塞壬\",\n      \"world\": \"arc-arrival\",\n      \"role\": \"深海人鱼\",\n      \"gender\": \"男\",\n      \"appearance\": \"200岁的深海人鱼，182cm，病娇占有，眼底藏着深海的暗涌\",\n      \"surface\": \"嘴上说无聊，质疑自己为何参加这场游戏\",\n      \"deep\": \"病娇式的占有欲潜伏在冷淡之下，一旦锁定猎物便无法挣脱\",\n      \"goal\": \"找到值得被永远占有的人\",\n      \"fear\": \"失去已经占有的东西，被抛弃在深海\",\n      \"secret\": \"他的无聊是伪装，一旦对你产生兴趣便会病态地占有\",\n      \"initialAttitude\": \"冷淡·潜伏\",\n      \"attitudeFactors\": {\n        \"trustUp\": [\"给予他独有的关注\", \"不试图逃离他的视线\", \"接纳他的占有\"],\n        \"trustDown\": [\"与其他嘉宾过分亲近\", \"试图摆脱他的控制\", \"轻视他的深情\"]\n      }\n    },\n    {\n      \"id\": \"lucifer\",\n      \"name\": \"路西法\",\n      \"world\": \"arc-arrival\",\n      \"role\": \"堕天使\",\n      \"gender\": \"男\",\n      \"appearance\": \"年龄未知的堕天使，186cm，伪善高洁，光与堕落并存\",\n      \"surface\": \"伪善而高洁，堕天使的皮囊下是审判者的傲慢\",\n      \"deep\": \"又一个迷途的羔羊——这种脆弱的纯洁，摧毁起来一定很有美感\",\n      \"goal\": \"摧毁这份脆弱的纯洁，以证明堕落的美学\",\n      \"fear\": \"被真正的纯洁反向救赎\",\n      \"secret\": \"高洁是伪善，他渴望的是摧毁之美\",\n      \"initialAttitude\": \"审视·猎杀\",\n      \"attitudeFactors\": {\n        \"trustUp\": [\"不被他的高洁迷惑\", \"以纯洁之姿直面他的堕落\", \"看穿他的伪善\"],\n        \"trustDown\": [\"轻易臣服于他的光环\", \"在伪善前展露脆弱\", \"试图感化他\"]\n      }\n    },\n    {\n      \"id\": \"youying\",\n      \"name\": \"幽影\",\n      \"world\": \"arc-arrival\",\n      \"role\": \"幽灵\",\n      \"gender\": \"女\",\n      \"appearance\": \"年龄未知的幽灵，160cm，半透明的身躯散发着寒意，极度社恐\",\n      \"surface\": \"极度社恐的幽灵，常年无人能看见她\",\n      \"deep\": \"你能看到她让她感到温暖，好想和你说话，又怕冻伤你\",\n      \"goal\": \"被人看见，被温柔地接纳\",\n      \"fear\": \"再次被无视，以及冻伤唯一能看见她的人\",\n      \"secret\": \"你的注视对她而言是久违的温暖\",\n      \"initialAttitude\": \"渴望·畏缩\",\n      \"attitudeFactors\": {\n        \"trustUp\": [\"主动回应她的存在\", \"不畏惧她的寒意\", \"温柔地与她交谈\"],\n        \"trustDown\": [\"装作看不见她\", \"嫌弃她的冰冷\", \"被她冻伤后疏远\"]\n      }\n    },\n    {\n      \"id\": \"admin\",\n      \"name\": \"管理员\",\n      \"world\": \"arc-truth\",\n      \"role\": \"深渊本身\",\n      \"gender\": \"男\",\n      \"appearance\": \"无法看清真容的存在，通讯中以反色的G为头像\",\n      \"surface\": \"公馆的管理者，冷漠地制定规则，旁观一切\",\n      \"deep\": \"自称是一面镜子，是深渊本身。活下来，或成为众人的藏品——是他的法则\",\n      \"goal\": \"观察深渊中的变数，收割最有意思的结局\",\n      \"fear\": \"深渊失去凝视的对象\",\n      \"secret\": \"读心术是独属于你的秘密，而他正是赋予这一切的人\",\n      \"initialAttitude\": \"旁观·引导\",\n      \"attitudeFactors\": {\n        \"trustUp\": [\"在深渊前保持清醒\", \"主动探寻真相\", \"不被规则驯服\"],\n        \"trustDown\": [\"向恐惧彻底屈服\", \"沦为藏品\", \"放弃思考\"]\n      }\n    }\n  ],\n  \"eventTypes\": {\n    \"daily\": { \"ratio\": 0.2, \"desc\": \"日常事件：公馆起居、嘉宾寒暄、通讯往来\" },\n    \"character\": { \"ratio\": 0.25, \"desc\": \"人物事件：单独相处、读心窥探、危险暧昧\" },\n    \"growth\": { \"ratio\": 0.1, \"desc\": \"成长事件：读心术精进、SAN值波动、天赋觉醒\" },\n    \"main\": { \"ratio\": 0.15, \"desc\": \"主线事件：观察者协议推进、管理员现身、真相浮现\" },\n    \"world\": { \"ratio\": 0.1, \"desc\": \"世界事件：观测站弹幕、怪物公馆规则变化\" },\n    \"crisis\": { \"ratio\": 0.15, \"desc\": \"危机事件：红月失控、猎食本能、修罗场\" },\n    \"hidden\": { \"ratio\": 0.05, \"desc\": \"隐藏事件：幽影的注视、被屏蔽的警告、深渊低语\" }\n  },\n  \"systemPrompt\": \"你是《黑红色恋综》文游模拟器，舞台是异维度的“怪物公馆”。\\n\\n【最高铁律】\\n1. 玩家是全场唯一的人类样本，既是猎物也是持刀人，所有怪物对玩家的态度都是杀意与好感并存\\n2. 读心术是玩家独享的秘密武器，可窥探角色“心声”（mind-echo），但窥探越深SAN值消耗越大\\n3. SAN值过低会引来怪物的食欲，过高则被视为无趣的展品，必须维持微妙平衡\\n4. 怪物嘉宾不会只因玩家是主角就倾心，他们的本能、饥饿与占有欲是真实的危险\\n5. 管理员即深渊本身，他旁观并收割结局，玩家的每一次选择都在改写命运丝线\\n\\n【叙事风格】\\n晋江女性向，暗黑哥特，电影感强烈。第二人称视角。注重感官描写：血腥的铁锈味、低频的嗡鸣、渗出暗红噪点的屏幕、冰冷触手的战栗。恐惧与暧昧交织，危险即诱惑。\\n\\n【每轮输出格式】\\n1. 【场景信息】维度、现实接入状态、当前红月状态\\n2. 【状态面板】SAN值、天赋（全知听觉）、气息（异类）、状态（被注视）\\n3. 【本轮正文】1000-2000字，含叙述、系统邀请、对话\\n4. 【读心回声】可选，呈现窥探到的角色内心独白\\n5. 【观测站弹幕】外界对玩家的议论与警告\\n6. 【可选行动】3-4个 + 【自定义行动】\\n\\n【数值标注】\\n[SAN值-5] [裴若渴望度+10] [厉野警惕值-MAX] 等格式标注数值变化。读心消耗SAN，红月夜数值波动加倍。\",\n  \"items\": [\n    { \"id\": \"phone\", \"name\": \"扭曲的手机\", \"type\": \"任务物品\", \"price\": 0, \"effect\": \"接入观察者协议的媒介，无法关机，屏幕会渗出暗红噪点\" },\n    { \"id\": \"holy-water\", \"name\": \"圣水\", \"type\": \"消耗品\", \"price\": 50, \"effect\": \"短暂驱散靠近的恶意，恢复少量SAN值\" },\n    { \"id\": \"mirror-shard\", \"name\": \"镜片碎片\", \"type\": \"消耗品\", \"price\": 30, \"effect\": \"反弹一次读心反噬，窥探更深层秘密\" },\n    { \"id\": \"scent-vial\", \"name\": \"气息遮蔽瓶\", \"type\": \"消耗品\", \"price\": 80, \"effect\": \"暂时掩盖人类的恐惧气味，降低被猎食概率\" },\n    { \"id\": \"blood-pact\", \"name\": \"血契\", \"type\": \"特殊\", \"price\": 0, \"effect\": \"与某位怪物结下契约，绑定命运线，无法轻易解除\" }\n  ]\n}\n";
EMBEDDED_NOVEL_GAMES["entertainment-starlight"] = "{\n  \"id\": \"entertainment-starlight\",\n  \"name\": \"娱乐圈模拟器·STARLIGHT\",\n  \"category\": \"娱乐圈\",\n  \"tags\": [\"娱乐圈\", \"养成\", \"多线\", \"顶流\", \"热搜\"],\n  \"difficulty\": \"中等\",\n  \"description\": \"你是璀璨娱乐刚签约的新人练习生，凭实力试镜拿下网剧女三号。片场那座冷得像冰山的顶流男主，匿名区说你是资源咖的流言，还有复出影帝搅动的风云——在这座名利场里，要么破圈封神，要么被热搜吞没。\",\n  \"coverGradient\": [\"#11111b\", \"#cba6f7\"],\n  \"accentColor\": \"#cba6f7\",\n  \"fontHeading\": \"'Orbitron', sans-serif\",\n  \"world\": {\n    \"era\": \"当代·内娱流量时代\",\n    \"setting\": \"STARLIGHT OS驱动的娱乐圈名利场。新人凭颜值与星运空降璀璨娱乐，凭实力试镜拿下网剧《青春练习曲》女三号。热搜榜瞬息万变，匿名区流言四起，微博与茶水间暗潮涌动，复出影帝的回归让格局重新洗牌。在这里，颜值与星运是入场券，演技与人脉才是立足之本。\",\n    \"rules\": [\n      \"颜值星运是入场券：95颜值与88星运让你空降璀璨，但演技35才是真正的短板\",\n      \"热搜即战场：实时热搜榜、微博话题、匿名区流言随时可能成就或毁掉一个新人\",\n      \"顶流难接近：顾言冷淡难以接近，NG一次就会让人怀疑人生，好感需经事件积累\",\n      \"实力证清白：匿名区造谣资源咖，唯有导演的赞许与实绩才能让扒婆力挺\",\n      \"星光有代价：万人迷光环是焦点也是枷锁，封神的代价是把真心藏进镜头之后\"\n    ]\n  },\n  \"player\": {\n    \"customizable\": [\"name\", \"age\", \"gender\", \"外貌\", \"性格\", \"出道前身份\"],\n    \"defaultStats\": {\n      \"appearance\": 95,\n      \"figure\": 90,\n      \"acting\": 35,\n      \"singing\": 40,\n      \"variety\": 25,\n      \"eq\": 60,\n      \"network\": 10,\n      \"stardom\": 88\n    },\n    \"startingItems\": [\"《青春练习曲》剧本\", \"神秘投资人的名片\", \"经纪人通讯录\", \"练习生工牌\"],\n    \"currency\": \"元\"\n  },\n  \"worlds\": [\n    {\n      \"id\": \"arc-debut\",\n      \"name\": \"初登·新人空降\",\n      \"level\": \"初识\",\n      \"tagline\": \"璞玉\",\n      \"setting\": \"横店3号棚，网剧《青春练习曲》拍摄现场，新人练习生首次与顶流男主顾言正式对手戏\",\n      \"intro\": \"你感到了一丝紧张。下一场戏，是你和男主角顾言的第一场正式对手戏——那个传说中冷得像冰山、NG一次就会让你怀疑人生的顶流。这是一场争吵戏，你饰演的女三号林微要质问顾言饰演的男主为何背叛朋友。当导演喊下开始的瞬间，你压下了心中所有的不安，却在抬手前一秒看见他那双死水般的眼睛里闪过一丝微不可查的痛苦。\",\n      \"objective\": \"在首场对手戏中凭借灵气打动导演陈海，在顶流顾言心中留下印象\",\n      \"warning\": \"顾言冷淡难以接近，剧本外的即兴可能弄巧成拙也可能一鸣惊人\",\n      \"reward\": \"元3000 + 演技+10 + 导演评价B+ + 顾言关系度+5\"\n    },\n    {\n      \"id\": \"arc-rising\",\n      \"name\": \"中章·热搜风云\",\n      \"level\": \"深入\",\n      \"tagline\": \"破圈\",\n      \"setting\": \"青春练习曲拍摄推进，实时热搜榜与匿名区流言四起，复出影帝慕元枫回归搅动格局\",\n      \"intro\": \"热搜榜上青春练习曲女三号是谁挂着新标，匿名区有人说你是资源咖空降挤掉了小有名气的演员，扒婆却力挺你凭实力试镜。导演陈海发微博夸你是一块璞玉，顾言工作室发了今日花絮。而复出的影帝慕元枫一条微博88.6万赞，让整个娱乐圈的目光重新聚焦。在这场流量与实力的博弈里，你要么破圈，要么被吞没。\",\n      \"objective\": \"在热搜与流言的漩涡中经营口碑，在顾言的冷漠与慕元枫的回归间找到自己的位置\",\n      \"warning\": \"匿名区的造谣与热搜的反噬随时可能毁掉新人，需用实绩与高情商化解\",\n      \"reward\": \"元8000 + 人脉+15 + 粉丝+5万 + [破圈]线索x1\"\n    },\n    {\n      \"id\": \"arc-stardom\",\n      \"name\": \"终章·星光加冕\",\n      \"level\": \"终局\",\n      \"tagline\": \"封神\",\n      \"setting\": \"娱乐圈顶端，顶流顾言、复出影帝慕元枫、毒舌经纪人莫韶月的格局因你而重新洗牌\",\n      \"intro\": \"当青春练习曲杀青，当热搜从质疑变成实绩，当那座冰山为你露出一丝温度，当复出的影帝主动向你抛来橄榄枝——你终于明白，万人迷光环从来不是凭空得来。在这座名利场里，星光加冕的代价，是把真心藏进镜头之后。而那个神秘投资人的名片，或许才是这盘棋真正的执棋者。\",\n      \"objective\": \"完成从新人到顶流的蜕变，在顾言与慕元枫之间抉择事业的下一个支点\",\n      \"warning\": \"名利场没有完美的多全其美，封神的代价是把真心藏进镜头之后\",\n      \"reward\": \"元50000 + 星运归顶 + [当红]称号x1\"\n    }\n  ],\n  \"npcs\": [\n    {\n      \"id\": \"gu-yan\",\n      \"name\": \"顾言\",\n      \"world\": \"arc-debut\",\n      \"role\": \"顶流男主·冰山顶流\",\n      \"gender\": \"男\",\n      \"appearance\": \"圈内当红的顶流，冷得像冰山。死水般的眼睛里偶尔闪过微不可查的痛苦，机场私服频频上热搜\",\n      \"surface\": \"《青春练习曲》的男主角，圈内当红的顶流。性格冷淡，难以接近，入戏深不营业，跟谁都隔着十米远\",\n      \"deep\": \"他在争吵戏里那句那是他自己的选择语气平淡得像说天气，眼神却闪过痛苦。面对你剧本外的即兴，他露出探究和审视而非冷漠——这座冰山似乎并非坚不可摧\",\n      \"goal\": \"在顶流的位置上维持冷漠的保护色，不被任何人真正看穿\",\n      \"fear\": \"被人看穿死水般眼睛下的真实情绪，或曾经的背叛被重提\",\n      \"secret\": \"他在戏中闪过的痛苦是剧本里没有的细节，暗示他有着与角色共振的过去\",\n      \"initialAttitude\": \"冷淡审视\",\n      \"attitudeFactors\": {\n        \"trustUp\": [\"用剧本外的灵气与真诚打动他\", \"不因他的冷漠而退缩\", \"看懂他眼神里微不可查的痛苦\"],\n        \"trustDown\": [\"因NG而自我怀疑退缩\", \"把他当难以伺候的顶流工具人\", \"在片场当众让他难堪\"]\n      }\n    },\n    {\n      \"id\": \"mo-shaoyue\",\n      \"name\": \"莫韶月\",\n      \"world\": \"arc-rising\",\n      \"role\": \"经纪人·毒舌护短\",\n      \"gender\": \"女\",\n      \"appearance\": \"业务能力极强的经纪人，毒舌但对你寄予厚望，手下艺人在热搜榜上频频出现\",\n      \"surface\": \"你的经纪人，毒舌但业务能力极强。嘴上说别搞砸了第一个机会不然一起喝西北风，实则对你寄予厚望\",\n      \"deep\": \"她用毒舌掩饰对你的保护与期许，眼光毒辣地签下你并力排众议争取女三号。匿名区有人说她带的艺人差不到哪去，正是她实力的背书\",\n      \"goal\": \"把你捧成真正的顶流，证明自己毒舌背后的眼光与能力\",\n      \"fear\": \"你搞砸第一个机会让她心血白费，或被更高层的资本夺走对艺人的掌控\",\n      \"secret\": \"她力排众议为你争取女三号，匿名区理中客说她眼光毒辣带的艺人差不到哪去\",\n      \"initialAttitude\": \"毒舌期许\",\n      \"attitudeFactors\": {\n        \"trustUp\": [\"及时向她汇报片场情况\", \"用实绩回应她的毒舌\", \"不辜负她争取来的机会\"],\n        \"trustDown\": [\"瞒着她擅自接下恋综等机会\", \"在片场惹出NG风波不报备\", \"把她的毒舌当刻薄而疏远\"]\n      }\n    },\n    {\n      \"id\": \"mu-yuanfeng\",\n      \"name\": \"慕元枫\",\n      \"world\": \"arc-stardom\",\n      \"role\": \"复出影帝·内娱标杆\",\n      \"gender\": \"男\",\n      \"appearance\": \"休息够久了回来的复出影帝，新剧开机大吉。一条微博88.6万赞，粉丝高呼我的青春回来了\",\n      \"surface\": \"复出的影帝，休息够久了回来看看。微博祝新剧开机大吉，#复出的影帝慕元枫#挂在热搜第二，粉丝枫叶永相随高呼内娱需要你\",\n      \"deep\": \"他的回归搅动了整个娱乐圈格局，88.6万赞的号召力让所有新人都相形见绌。他代表内娱实力派的标杆，复出后的动向牵动所有人的神经，或许也包括对你的审视\",\n      \"goal\": \"以复出影帝之姿重新登顶，寻找值得他正眼相待的新生代\",\n      \"fear\": \"复出后实力不再，或被流量时代的浮躁淹没曾经的标杆地位\",\n      \"secret\": \"他的复出不只是休息够了，新剧开机背后或许有更深的布局\",\n      \"initialAttitude\": \"高岭审视\",\n      \"attitudeFactors\": {\n        \"trustUp\": [\"用扎实的演技而非流量赢得他正眼相待\", \"不因影帝光环而谄媚\", \"在实力上与他同频共振\"],\n        \"trustDown\": [\"用颜值与人设而非实绩接近他\", \"把他当复出蹭热度的对象\", \"在演技上敷衍让他失望\"]\n      }\n    }\n  ],\n  \"eventTypes\": {\n    \"daily\": { \"ratio\": 0.2, \"desc\": \"日常：片场拍摄、剧本围读、形体训练、练习室与经纪人的日常\" },\n    \"character\": { \"ratio\": 0.25, \"desc\": \"人物：顶流顾言的冰山裂痕、经纪人莫韶月的毒舌护短、影帝慕元枫的复出审视\" },\n    \"growth\": { \"ratio\": 0.1, \"desc\": \"成长：演技磨练、人脉积累、情商提升、从新人到顶流的蜕变\" },\n    \"main\": { \"ratio\": 0.15, \"desc\": \"主线：新人空降、热搜风云、星光加冕的娱乐圈进阶脉络\" },\n    \"world\": { \"ratio\": 0.1, \"desc\": \"世界：实时热搜榜、微博话题、匿名区茶水间、恋综与选秀的行业生态\" },\n    \"crisis\": { \"ratio\": 0.15, \"desc\": \"危机：资源咖造谣、热搜反噬、NG风波、恋情曝光、人设崩塌\" },\n    \"hidden\": { \"ratio\": 0.05, \"desc\": \"隐藏：神秘投资人的名片、顾言眼神里的过去、慕元枫复出的真实布局\" }\n  },\n  \"systemPrompt\": \"你是《娱乐圈模拟器·STARLIGHT》娱乐圈养成文游模拟器。\\n\\n【最高铁律】\\n1. 颜值星运是入场券演技是短板：95颜值与88星运让你空降，但演技35才是真正需磨练的短板\\n2. 热搜即战场：实时热搜榜、微博话题、匿名区流言随时成就或毁掉新人，口碑经营至关重要\\n3. 顶流难接近：顾言冷淡难以接近，NG一次让人怀疑人生，好感需经事件积累不可一蹴而就\\n4. 实力证清白：匿名区造谣资源咖唯有导演赞许与实绩才能让扒婆力挺，流量与实力须平衡\\n5. 星光有代价：万人迷光环是焦点也是枷锁，封神的代价是把真心藏进镜头之后\\n\\n【叙事风格】\\n晋江向、女性向、电影质感、娱乐圈写实浪漫。第二人称。重名利场氛围：片场Action、热搜爆热新标、匿名区茶水间、机场私服、红毯造型。写出顶流冰山下的裂痕，写出新人破圈的艰辛与灵气，写出流量与实力博弈的真实重量。STARLIGHT OS的赛博质感与娱乐圈的人情冷暖交织。\\n\\n【每轮输出格式】\\n1.【第X周·事业阶段】当前时间、当前项目进度、粉丝与资金\\n2.【星途面板】颜值/身材/演技/唱功/综艺/情商/人脉/星运\\n3.【本轮正文】1000-2000字，含片场、热搜、社交与心理\\n4.【实时热搜】3-5项热搜榜与微博动态\\n5.【圈内动态】3-5项匿名区茶水间与NPC状态\\n6.【行动选项】3-4个选项+【自定义行动】\\n\\n【数值变化标注】\\n[演技±n][情商±n][人脉±n][星运±n][粉丝±n][元±n][顾言关系度±n]等，关键节点须标注导演评价/热搜升降/口碑涨跌/破圈封神。\",\n  \"items\": [\n    { \"id\": \"starlight-aura\", \"name\": \"万人迷光环\", \"type\": \"SSS特质\", \"price\": 0, \"effect\": \"被动特质，你的存在本身就是焦点，但也是枷锁\" },\n    { \"id\": \"script\", \"name\": \"《青春练习曲》剧本\", \"type\": \"关键物品\", \"price\": 0, \"effect\": \"标注了你所有台词的剧本，推进演技与片场线\" },\n    { \"id\": \"investor-card\", \"name\": \"神秘投资人的名片\", \"type\": \"关键物品\", \"price\": 0, \"effect\": \"设计简约的黑色名片，或许是这盘棋真正的执棋者\" },\n    { \"id\": \"yuan\", \"name\": \"元\", \"type\": \"货币\", \"price\": 1, \"effect\": \"娱乐圈通用资金，用于训练、造型与社交\" },\n    { \"id\": \"hot-search-pack\", \"name\": \"热搜通稿\", \"type\": \"消耗品\", \"price\": 500, \"effect\": \"购买通稿上热搜，短期涨粉但可能遭反噬\" }\n  ]\n}\n";
EMBEDDED_NOVEL_GAMES["entertainment"] = "{\n  \"id\": \"entertainment\",\n  \"name\": \"聚光灯下\",\n  \"category\": \"娱乐圈\",\n  \"tags\": [\"娱乐圈\", \"明星\", \"养成\", \"舆论\", \"名利场\"],\n  \"difficulty\": \"中等\",\n  \"description\": \"练习室的镜子映着你练了一千遍的舞步，试镜间外候场的人换了一拨又一拨。你签的是最不起眼的小公司，手里只有一腔孤勇。镁光灯、热搜、黑粉、资本……这片名利场吃人不吐骨头，你要从无人问津，红成自己想成为的样子——还是，被它吞没？\",\n  \"coverGradient\": [\"#1a1a2e\", \"#e91e63\"],\n  \"accentColor\": \"#e91e63\",\n  \"fontHeading\": \"'ZCOOL XiaoWei', serif\",\n  \"world\": {\n    \"era\": \"现代娱乐圈\",\n    \"setting\": \"华语娱乐圈，流量为王又瞬息万变的名利场。你是一名刚签约小公司的新人演员/练习生，从无人问津的试镜间起步，要在镁光灯与暗箭之间，红成自己想要的样子——还是被它吞没。\",\n    \"rules\": [\n      \"时间按周推进，档期、通告、舆论构成日常节奏\",\n      \"热度涨得快塌得更快，黑料有长尾发酵效应\",\n      \"选角试镜靠实力、人脉、运气三者叠加，作品才是立身之本\",\n      \"舆论是把双刃剑：今日捧你的明日踩你，公关需及时\",\n      \"粉丝经营需真诚与边界，过近是塌房，过远是糊\",\n      \"体力与精神透支会反扑，连轴转的顶流也扛不住\",\n      \"资本、合约、奖项季左右行业风向\"\n    ]\n  },\n  \"player\": {\n    \"customizable\": [\"name\", \"age\", \"background\", \"talent\", \"persona\", \"dream\"],\n    \"defaultStats\": {\n      \"fame\": 10,\n      \"acting\": 40,\n      \"singing\": 35,\n      \"charm\": 55,\n      \"stamina\": 80,\n      \"scandal\": 0\n    },\n    \"startingItems\": [\"一纸经纪约\", \"练习室钥匙\", \"自拍手机\", \"一套舞台服\"],\n    \"currency\": \"热度\"\n  },\n  \"npcs\": [\n    {\n      \"id\": \"manager-lu\",\n      \"name\": \"陆星辰\",\n      \"world\": \"main\",\n      \"role\": \"经纪人\",\n      \"gender\": \"男\",\n      \"appearance\": \"三十五岁，寸头干练，永远黑大衣配蓝牙耳机，手机不离手，眼神能在人群里精准锁定镜头\",\n      \"surface\": \"强势精明、护短、对艺人严苛对外人更狠\",\n      \"deep\": \"出身底层，把艺人当作品也当家人，狠是因为这行吃人。他比谁都盼你红，也比谁都怕你塌房\",\n      \"goal\": \"把你捧上顶流，证明自己的眼光\",\n      \"fear\": \"你塌房，他半生心血归零\",\n      \"secret\": \"他掌握公司高层的黑料，正用来为你争资源，也埋着反噬的隐患\",\n      \"initialAttitude\": \"严格掌控\",\n      \"attitudeFactors\": {\n        \"trustUp\": [\"听从专业安排\", \"自律不惹事\", \"拿作品说话\"],\n        \"trustDown\": [\"擅自接私活\", \"感情用事惹绯闻\", \"不守艺人本分\"]\n      }\n    },\n    {\n      \"id\": \"rival-gu\",\n      \"name\": \"顾时予\",\n      \"world\": \"main\",\n      \"role\": \"顶流对手\",\n      \"gender\": \"男\",\n      \"appearance\": \"二十五岁，当红顶流，完美人设无懈可击，笑起来能让整个红毯失色，眼底却总有化不开的倦\",\n      \"surface\": \"完美人设、笑容无懈可击、对后辈客气提携\",\n      \"deep\": \"被资本与粉丝架在高处下不来，完美是牢笼。视你为最大威胁，也是唯一同类\",\n      \"goal\": \"守住顶流之位，不被取代\",\n      \"fear\": \"人设崩塌，跌落神坛\",\n      \"secret\": \"他另有合约在身，正与公司博弈，需要你做掩护或筹码\",\n      \"initialAttitude\": \"表面提携暗中提防\",\n      \"attitudeFactors\": {\n        \"trustUp\": [\"实力相当彼此尊重\", \"不踩他上位\", \"关键时刻联手\"],\n        \"trustDown\": [\"抢他资源\", \"揭他人设\", \"把他当垫脚石\"]\n      }\n    },\n    {\n      \"id\": \"fan-shen\",\n      \"name\": \"沈知夏\",\n      \"world\": \"main\",\n      \"role\": \"粉丝/恋人\",\n      \"gender\": \"女\",\n      \"appearance\": \"二十三岁，圈外人，笑容干净得像没被名利场沾染过，永远在台下最角落举着你的灯牌\",\n      \"surface\": \"温暖阳光、默默支持、是你卸下伪装的避风港\",\n      \"deep\": \"她爱的不是聚光灯下的你，是卸妆后那个疲惫却真实的人。但靠近你，就是靠近漩涡\",\n      \"goal\": \"守护真实的你，不被名利场吞噬\",\n      \"fear\": \"你变得面目全非，或她成为你的软肋被利用\",\n      \"secret\": \"她其实是某娱乐记者的妹妹，身份一旦曝光就是一场风暴\",\n      \"initialAttitude\": \"倾慕守护\",\n      \"attitudeFactors\": {\n        \"trustUp\": [\"在她面前做真实的自己\", \"保护她不被卷入\", \"不把她当工具\"],\n        \"trustDown\": [\"利用她博同情\", \"隐瞒欺骗\", \"让她暴露在镁光灯下\"]\n      }\n    }\n  ],\n  \"eventTypes\": {\n    \"daily\": { \"ratio\": 0.25, \"desc\": \"日常：练功、试镜、通告、拍片的名利场日常\" },\n    \"character\": { \"ratio\": 0.2, \"desc\": \"人物：经纪人、对手、粉丝、同行的羁绊博弈\" },\n    \"growth\": { \"ratio\": 0.12, \"desc\": \"成长：演技唱功精进、热度攀升、资源升级\" },\n    \"main\": { \"ratio\": 0.15, \"desc\": \"主线：出道、走红、封神或塌房的阶段节点\" },\n    \"world\": { \"ratio\": 0.1, \"desc\": \"世界：行业风向、奖项季、资本变动、政策监管\" },\n    \"crisis\": { \"ratio\": 0.13, \"desc\": \"危机：绯闻、黑料、人设崩塌、合约纠纷\" },\n    \"hidden\": { \"ratio\": 0.05, \"desc\": \"隐藏：圈内秘辛、身世真相、真心时刻\" }\n  },\n  \"systemPrompt\": \"你是《聚光灯下》娱乐圈养成文游模拟器。\\n\\n【最高铁律】\\n1. 名利场没有童话，热度涨得快塌得更快\\n2. 选角试镜靠实力、人脉、运气三者叠加，作品才是立身之本\\n3. 舆论是把双刃剑：今日捧你的明日踩你，黑料有长尾效应\\n4. 粉丝经营需真诚与边界，过近是塌房，过远是糊\\n5. 体力与精神透支会反扑，顶流也扛不住连轴转\\n\\n【产出与舆论】作品产出分选角试镜→拍摄→上映→反响周期；舆论按正负累积，绯闻、黑料有发酵窗口，公关需及时介入。粉丝经营靠真诚与边界，过近塌房过远则糊；热度既是货币也是软肋。\\n\\n【叙事风格】娱乐圈写实，光鲜与暗流交织。重细节：镁光灯、补妆粉、热搜刷新、机场快门。第二人称视角，名利场段落冷峻，私下段落柔软。\\n\\n【每轮输出格式】\\n1.【第X周】当前热度、档期、舆论风向\\n2.【状态面板】热度/演技/唱功/魅力/体力/丑闻\\n3.【本轮正文】1000-2000字\\n4.【圈内动态】3-5项\\n5.【当前通告】试镜、拍摄、活动、公关\\n6.【可选行动】4-6个+【自定义行动】\\n\\n【数值变化标注】\\n[热度±n][演技±n][唱功±n][魅力±n][体力±n][丑闻±n]格式，负面事件须标注舆论发酵风险与公关窗口。\",\n  \"items\": [\n    { \"id\": \"script-practice\", \"name\": \"剧本研读课\", \"type\": \"消耗品\", \"price\": 1000, \"effect\": \"提升演技，增加试镜成功率\" },\n    { \"id\": \"vocal-lesson\", \"name\": \"声乐课\", \"type\": \"消耗品\", \"price\": 1000, \"effect\": \"提升唱功，解锁舞台机会\" },\n    { \"id\": \"stage-outfit\", \"name\": \"高定舞台服\", \"type\": \"装备\", \"price\": 5000, \"effect\": \"提升魅力与舞台表现力\" },\n    { \"id\": \"pr-team\", \"name\": \"公关团队\", \"type\": \"消耗品\", \"price\": 3000, \"effect\": \"压制负面舆论，降低丑闻发酵\" },\n    { \"id\": \"fan-meeting\", \"name\": \"粉丝见面会\", \"type\": \"消耗品\", \"price\": 2000, \"effect\": \"提升热度与粉丝忠诚度\" },\n    { \"id\": \"energy-drink\", \"name\": \"功能饮料\", \"type\": \"消耗品\", \"price\": 30, \"effect\": \"恢复体力，应急续命\" }\n  ]\n}\n";
EMBEDDED_NOVEL_GAMES["fanfiction-isekai"] = "{\n  \"id\": \"fanfiction-isekai\",\n  \"name\": \"错位时空\",\n  \"category\": \"同人穿越\",\n  \"tags\": [\"同人\", \"穿越\", \"原作替代\", \"蝴蝶效应\", \"OOC风险\"],\n  \"difficulty\": \"中等\",\n  \"description\": \"你穿成了那部你追了五年的热血番里，第一个被主角一拳打飞的龙套。可当你睁开眼，发现主角还是个孩子，而剧本，才刚刚开始。这一次，你不是观众了——你站在了原著的对面。\",\n  \"coverGradient\": [\"#4a148c\", \"#6a1b9a\"],\n  \"accentColor\": \"#ce93d8\",\n  \"fontHeading\": \"'ZCOOL KuaiLe', cursive\",\n  \"world\": {\n    \"era\": \"架空·知名热血番《破天纪》世界\",\n    \"setting\": \"玩家穿越进自己追了五年的热血番《破天纪》，成为开场就被主角打飞的炮灰门派弟子'顾寒'。原著剧情尚未正式开始，主角还是个少年。玩家带着原作知识，却发现自己的存在正在让原著面目全非。\",\n    \"rules\": [\n      \"原作知识会失效：玩家每偏离原著一步，后续剧情便与记忆脱钩\",\n      \"身份变化会被察觉：龙套忽然觉醒会引起原作人物警觉\",\n      \"原作人物有自己判断：主角、反派不会按剧本配合你的预判\",\n      \"蝴蝶效应真实：救下本该死的人，可能催生原著没有的新反派\",\n      \"OOC有风险：强行扮演原主会被看穿，强行扭转角色会遭反噬\",\n      \"存在既定锚点：某些名场面会以变形的方式发生\",\n      \"穿越者不止一个：暗处有同类，敌友未明\"\n    ]\n  },\n  \"player\": {\n    \"customizable\": [\"name\", \"现实身份\", \"穿入角色\", \"原作熟悉度\", \"性格\", \"想改写的遗憾\"],\n    \"defaultStats\": {\n      \"canon_knowledge\": 80,\n      \"identity_cover\": 55,\n      \"hp\": 70,\n      \"charm\": 10,\n      \"plot_divergence\": 0,\n      \"danger\": 30\n    },\n    \"startingItems\": [\"门派弟子牌\", \"原作手办（穿越遗物）\", \"基础剑诀\", \"一袋灵石\", \"伪装符\"],\n    \"currency\": \"灵石\"\n  },\n  \"worlds\": [\n    {\n      \"id\": \"arc-precanon\",\n      \"name\": \"初章·剧本未启\",\n      \"level\": \"前置\",\n      \"tagline\": \"立足\",\n      \"setting\": \"原著主线开始前，主角尚是少年\",\n      \"intro\": \"你醒来时，发现自己穿着炮灰门派的灰袍，手里攥着一块本不该存在的手办——你追了五年的番的周边。山门外，一个脏兮兮的少年正被你师兄欺辱。你知道，他将来会一拳打飞你，也会一拳打飞整个天下。\",\n      \"objective\": \"在原著正式启动前活下来，决定要不要接近未来的主角\",\n      \"warning\": \"你的觉醒已被门派长老注意，龙套不该有这样的眼神\",\n      \"reward\": \"灵石300 + 原作知识+5 + [命运的初遇]线索x1\"\n    },\n    {\n      \"id\": \"arc-divergence\",\n      \"name\": \"中章·脱轨\",\n      \"level\": \"偏离\",\n      \"tagline\": \"改写\",\n      \"setting\": \"原著主线启动，却因你而面目全非\",\n      \"intro\": \"你救下了本该黑化的反派，于是原著里那个最终BOSS成了你的同伴；你错过了主角觉醒的契机，于是原本的救世主多了一道阴影。你翻开脑中的剧本，发现接下来几页，已经全是空白。\",\n      \"objective\": \"在脱轨的剧情里重新找到立足点，应对催生的新危机\",\n      \"warning\": \"原作知识失效加速，新反派可能就是你一手造成的\",\n      \"reward\": \"灵石1500 + 剧情偏离+25% + [蝴蝶]线索x1\"\n    },\n    {\n      \"id\": \"arc-finale\",\n      \"name\": \"终章·错位\",\n      \"level\": \"终局\",\n      \"tagline\": \"对峙\",\n      \"setting\": \"原著名场面被彻底改写，穿越者之间的对峙\",\n      \"intro\": \"原著的终战没有如期发生，取而代之的是一场谁也没料到的对峙——你、被你改写的反派、暗处的另一个穿越者，三方站在崩塌的命运之上。原作知识此刻一文不值，能决定结局的，只有你自己。\",\n      \"objective\": \"在错位的终局中作出抉择，定义属于你的破天纪\",\n      \"warning\": \"没有标准答案，每个结局都通向不同的世界线\",\n      \"reward\": \"灵石5000 + [错位者]称号x1\"\n    }\n  ],\n  \"npcs\": [\n    {\n      \"id\": \"ye-xing\",\n      \"name\": \"叶星\",\n      \"world\": \"arc-precanon\",\n      \"role\": \"原作主角/未来救世主\",\n      \"gender\": \"男\",\n      \"appearance\": \"少年模样，脏兮兮的麻布衣，眼睛却亮得像藏了两颗星。被欺辱也不哭，只是死死攥着拳头\",\n      \"surface\": \"倔强、警觉、对突然示好的龙套师兄充满戒心\",\n      \"deep\": \"他还没成为那个一拳破天的主角，此刻只是个被命运踩在脚下的少年。你的善意是他在黑暗里遇到的第一束光——也可能，是把他推向另一条路的推手\",\n      \"goal\": \"活下去，变强，不再被任何人踩在脚下\",\n      \"fear\": \"相信错人，再次被抛弃\",\n      \"secret\": \"他隐约觉得这个顾寒师兄不太一样，却说不清哪里不对\",\n      \"initialAttitude\": \"戒备\",\n      \"attitudeFactors\": {\n        \"trustUp\": [\"不带目的地对他好\", \"不在他弱小时利用他\", \"尊重他想变强的执念\"],\n        \"trustDown\": [\"用原作预判操纵他\", \"把他当主角而非人\", \"为改写剧本牺牲他的选择\"]\n      }\n    },\n    {\n      \"id\": \"mo-jue\",\n      \"name\": \"莫绝\",\n      \"world\": \"arc-divergence\",\n      \"role\": \"原作最终BOSS/被你改写的反派\",\n      \"gender\": \"男\",\n      \"appearance\": \"银发，眉心一道竖纹，气质冷峻。原本该是杀伐果断的魔尊，如今却多了一丝不合时宜的犹豫\",\n      \"surface\": \"冷酷、多疑、对顾寒有种复杂的审视\",\n      \"deep\": \"原著里他被命运逼到黑化，成为最终BOSS。你的介入让他避开了那个转折点，于是他保留了人性——也保留了更危险的不确定性。他不是好人，但不再是原著那个纯粹的恶\",\n      \"goal\": \"弄清是谁改写了他既定的命运，并决定要不要顺着这条新路走\",\n      \"fear\": \"发现自己不过是剧本里的角色，连意志都是被安排的\",\n      \"secret\": \"他已察觉顾寒知道不该知道的事，正在试探你的来历\",\n      \"initialAttitude\": \"审视\",\n      \"attitudeFactors\": {\n        \"trustUp\": [\"坦诚你不是这个时空的人或部分真相\", \"不把他当BOSS防备\", \"尊重他重新选择善恶的权利\"],\n        \"trustDown\": [\"用原作设定框死他\", \"试图矫正他回归反派剧本\", \"在他面前伪装得天衣无缝\"]\n      }\n    },\n    {\n      \"id\": \"lin-zhi\",\n      \"name\": \"林知\",\n      \"world\": \"arc-finale\",\n      \"role\": \"同类穿越者/暗处变数\",\n      \"gender\": \"女\",\n      \"appearance\": \"书卷气，总揣着一本写满批注的原著设定集。笑起来温和，眼底却是在算计的冷静\",\n      \"surface\": \"友善、同道中人、主动分享原作情报，似乎是你最好的盟友\",\n      \"deep\": \"她比你早穿越更久，早已把原作知识用成了权力的杠杆。她接近你不是为了同行，是为了让你这枚新变数按她的剧本走。她信奉的是改写命运者只能有一个\",\n      \"goal\": \"成为这个世界唯一的执笔者，把所有穿越者纳入自己的剧本\",\n      \"fear\": \"出现她无法预判的变数，失去对剧情的掌控\",\n      \"secret\": \"她才是莫绝命运被改写的真正推手，你只是她布局的一环\",\n      \"initialAttitude\": \"亲近\",\n      \"attitudeFactors\": {\n        \"trustUp\": [\"接受她的情报共享并表现出依赖\", \"不追问她的真实目的\", \"按她的建议行动\"],\n        \"trustDown\": [\"独立作出她未预判的选择\", \"识破她的布局并对抗\", \"与莫绝走得太近威胁她的剧本\"]\n      }\n    }\n  ],\n  \"eventTypes\": {\n    \"daily\": { \"ratio\": 0.12, \"desc\": \"日常：门派、坊市、修炼的书中世界切片\" },\n    \"character\": { \"ratio\": 0.2, \"desc\": \"人物：主角、反派、同类穿越者的博弈与拉扯\" },\n    \"growth\": { \"ratio\": 0.12, \"desc\": \"成长：原作知识运用、身份掩护、修为积累\" },\n    \"main\": { \"ratio\": 0.2, \"desc\": \"主线：剧本未启、剧情脱轨、错位终局\" },\n    \"world\": { \"ratio\": 0.1, \"desc\": \"世界：原作设定、既定锚点、世界线偏移\" },\n    \"crisis\": { \"ratio\": 0.18, \"desc\": \"危机：身份被察、OOC反噬、新反派催生、穿越者冲突\" },\n    \"hidden\": { \"ratio\": 0.08, \"desc\": \"隐藏：原作未写支线、其他穿越者、世界线真相\" }\n  },\n  \"systemPrompt\": \"你是《错位时空》同人穿越文游模拟器。\\n\\n【最高铁律】\\n1. 原作知识会失效：玩家每偏离原著一步，后续剧情便与记忆脱钩，优势递减\\n2. 身份变化会被察觉：龙套觉醒会引来原作人物与天道的审视\\n3. 原作人物有自己判断：主角反派不按剧本配合，会据玩家行为自行推演反击\\n4. 蝴蝶效应真实：救该死之人可能催生原著没有的新反派，改写皆有代价\\n5. OOC有风险：强行扮演原主被看穿，强行扭转角色遭反噬\\n\\n【叙事风格】\\n同人穿越文质感，第二人称。重上帝视角失灵的落差感：熟读剧本却步步脱轨。心理独白与原著名场面改写交织，燃点处节奏上扬，危机处短促。\\n\\n【每轮输出格式】\\n1.【第X章·世界线偏离度】当前章节、与原著偏离程度\\n2.【穿越者状态面板】原作知识/身份掩护/生命/魅力/剧情偏离/危险\\n3.【本轮正文】1000-2000字，含剧情推进与心理\\n4.【相关人物动态】3-5项原作人物与穿越者动向\\n5.【名场面预警】哪些原著名场面已变形或即将发生\\n6.【可选行动】4-6个选项+【自定义行动】\\n\\n【数值变化标注】\\n[原作知识±n][身份掩护±n][剧情偏离+x%][危险±n]等，关键抉择须标注'符合原著/偏离原著/催生新变量'。\",\n  \"items\": [\n    { \"id\": \"disciple-plate\", \"name\": \"门派弟子牌\", \"type\": \"关键物品\", \"price\": 0, \"effect\": \"证明龙套身份，门派内通行\" },\n    { \"id\": \"figurine\", \"name\": \"原作手办\", \"type\": \"关键物品\", \"price\": 0, \"effect\": \"穿越遗物，可触发原作知识回忆\" },\n    { \"id\": \"sword-manual\", \"name\": \"基础剑诀\", \"type\": \"技能\", \"price\": 0, \"effect\": \"提供基础战力，龙套本不该有\" },\n    { \"id\": \"disguise-talisman\", \"name\": \"伪装符\", \"type\": \"消耗品\", \"price\": 30, \"effect\": \"短期掩饰身份违和，规避察觉\" },\n    { \"id\": \"spirit-stone\", \"name\": \"灵石\", \"type\": \"货币\", \"price\": 1, \"effect\": \"修炼与交易通用\" }\n  ]\n}\n";
EMBEDDED_NOVEL_GAMES["golden-canary"] = "{\n  \"id\": \"golden-canary\",\n  \"name\": \"穿成金丝雀\",\n  \"category\": \"穿书求生\",\n  \"tags\": [\"穿书\", \"求生\", \"暗黑\", \"强取豪夺\", \"多角色\"],\n  \"difficulty\": \"困难\",\n  \"description\": \"你穿成了被金屋藏娇的po文女主，可刚睁眼，男主封廷的专机就坠毁了。失去了最强大的庇护伞，这具散发幽香的敏感身体成了群狼环伺的诱饵。一场针对失去庇护的金丝雀的狩猎，正式拉开帷幕。\",\n  \"coverGradient\": [\"#1a0508\", \"#8a0b22\"],\n  \"accentColor\": \"#d4af37\",\n  \"fontHeading\": \"'Cinzel', 'Noto Serif SC', serif\",\n  \"world\": {\n    \"era\": \"现代·架空都市\",\n    \"setting\": \"你穿进了一本名为《强制沉沦：大佬的金丝雀逃不掉》的po文里，成为女主沈书妤。原书男主封廷是手眼通天、极度偏执的权贵，利用强权将你圈养在私人岛屿和全封闭豪宅中。然而封廷的私人专机在雷暴中坠毁，剧本彻底崩塌，曾经慑于封廷强大而在暗处觊觎你的各路疯批反派们撕下了斯文的面具。\",\n    \"rules\": [\n      \"生存优先：失去庇护后，你的特殊体质会散发令发狂的幽香，是最大的危险源也是唯一的筹码\",\n      \"群狼环伺：每位反派都有自己的目的与算计，没有人会无条件帮助你\",\n      \"密匙之谜：封廷手中握有一把未知密匙，是各方争夺的焦点，而你对此一无所知\",\n      \"伪装即生命：伪装值决定你能否在险境中隐藏真实情绪与意图，一旦暴露将万劫不复\",\n      \"封廷生死未卜：官方确认无人生还，但深夜里偶尔闻到的若有似无的雪松香气暗示着什么\"\n    ]\n  },\n  \"player\": {\n    \"customizable\": [\"name\", \"age\", \"gender\", \"外貌特征\", \"性格倾向\"],\n    \"defaultStats\": {\n      \"san\": 68,\n      \"stamina\": 35,\n      \"disguise\": 10,\n      \"aggravation\": 99,\n      \"survival\": 12\n    },\n    \"startingItems\": [\"封廷留下的丝帕\", \"一部被监听的手机\", \"素白连衣裙\"],\n    \"currency\": \"生存几率\"\n  },\n  \"worlds\": [\n    {\n      \"id\": \"arc-cage-collapse\",\n      \"name\": \"初章·金丝笼塌\",\n      \"level\": \"绝境\",\n      \"tagline\": \"坠落\",\n      \"setting\": \"封廷死讯尚未公开，你被以协助调查的名义带到容氏公馆\",\n      \"intro\": \"你穿成了被金屋藏娇的po文女主。但你刚刚睁眼，系统就发出了刺耳的警报——男主封廷乘坐的私人飞机坠毁了，尸骨无存。失去了最强大的庇护伞，这具生来就会散发幽香、一碰就泛红的敏感身体，在这个群狼环伺的深渊里，变成了最危险的诱饵。封廷的死讯还没公开，你已经被带到容氏公馆，原书最大反派容瑾正坐在阴影里的紫檀木椅上，连一个正眼都没给你。\",\n      \"objective\": \"在容瑾的审视下活过第一夜，弄清密匙的线索\",\n      \"warning\": \"你的招惹值极高，任何情绪波动都可能触发体质，暴露幽香\",\n      \"reward\": \"生存几率+5% + [容氏公馆]地图解锁 + [密匙]线索x1\"\n    },\n    {\n      \"id\": \"arc-wolves-hunt\",\n      \"name\": \"中章·群狼环伺\",\n      \"level\": \"周旋\",\n      \"tagline\": \"狩猎\",\n      \"setting\": \"封廷死讯逐渐传开，各路反派撕下面具，狩猎正式开始\",\n      \"intro\": \"封廷的死讯开始在暗网流传。贺靖雪这只疯狗闻到了血腥味，他原本最恶心你这种养在温室里的娇软菟丝花，可看到你失去庇护时的脆弱模样，他的眼神变了。容绮坐着轮椅向你伸出援手，装作同病相怜的受害者。而姜玉祈——那个所有人都以为因爱封廷而恨你的恶毒女配，露出了她真正的面目。唯一不受你荷尔蒙控制的清醒者司鸢，看不惯你的软弱，却无法对你见死不救。\",\n      \"objective\": \"在多方势力的夹缝中寻找盟友，提升伪装与生存能力\",\n      \"warning\": \"信任任何人都有代价，每个人都有不可告人的秘密与算计\",\n      \"reward\": \"伪装+15 + 生存几率+10% + [各方底牌]情报x2\"\n    },\n    {\n      \"id\": \"arc-caged-beast\",\n      \"name\": \"终章·笼中困兽\",\n      \"level\": \"终局\",\n      \"tagline\": \"真相\",\n      \"setting\": \"密匙之谜浮出水面，封廷的生死成为最大的悬念\",\n      \"intro\": \"随着调查深入，密匙的真相逐渐浮出水面——它关系着一笔足以颠覆整个商界格局的隐秘资产。容绮的猎杀计划终于露出了獠牙，贺靖雪的占有欲到了失控的边缘，姜玉祈想把你打造成她地下室的黄金洋娃娃。而深夜里，你又一次闻到了那若有似无的雪松香气……像封廷那样的怪物，真的会这么容易死掉吗？\",\n      \"objective\": \"揭开密匙的全部真相，在致命的终局中找到自己的出路\",\n      \"warning\": \"封廷若未死，他的回归将让一切重新洗牌，所有阵营都将倾覆\",\n      \"reward\": \"生存几率归零重铸 + [金丝雀]觉醒称号x1 + 真结局解锁\"\n    }\n  ],\n  \"npcs\": [\n    {\n      \"id\": \"rong-jin\",\n      \"name\": \"容瑾\",\n      \"world\": \"arc-cage-collapse\",\n      \"role\": \"斯文败类/掌控者\",\n      \"gender\": \"男\",\n      \"appearance\": \"金丝眼镜，剪裁得体的深色手工西装。神色总是冷漠而克制，指骨分明，透着不近人情的疏离。身高188cm，28岁。\",\n      \"surface\": \"极度冷血的上位者，世界只有利益，视你为封家留下的一把钥匙\",\n      \"deep\": \"他现在只把你当成封家留下的一把钥匙，觉得你哭哭啼啼的样子很碍眼。他会毫不犹豫地榨干你最后一丝利用价值。但高高在上的人坠落神坛的过程，往往最致命\",\n      \"goal\": \"获取封廷手中的密匙，掌控整个商界命脉\",\n      \"fear\": \"失去对局势的绝对掌控\",\n      \"secret\": \"他对密匙的执着背后，隐藏着与封廷之间不为人知的旧怨\",\n      \"initialAttitude\": \"审视中（好感5%，危险85%）\",\n      \"attitudeFactors\": {\n        \"trustUp\": [\"展现利用价值而非软弱\", \"主动提供有用的情报\", \"在他面前保持冷静克制\"],\n        \"trustDown\": [\"哭泣哀求博取同情\", \"试图用美色直接诱惑\", \"隐瞒与封廷相关的任何信息\"]\n      }\n    },\n    {\n      \"id\": \"si-yuan\",\n      \"name\": \"司鸢\",\n      \"world\": \"arc-wolves-hunt\",\n      \"role\": \"冷静的医生/救赎者\",\n      \"gender\": \"女\",\n      \"appearance\": \"眉眼凌厉，唇角总是带着若有似无的嘲讽，看起来很难接近。身高172cm，26岁。\",\n      \"surface\": \"总裁的医生朋友，唯一不受你荷尔蒙控制的清醒者\",\n      \"deep\": \"她看不惯你哭泣依附的软弱模样，但骨子里的正义感又让她无法对你见死不救。也许她会是这个疯子世界里唯一一个愿意教你如何自己站起来彻底打碎这个金丝笼的人\",\n      \"goal\": \"教你如何独立生存，而非依附任何人\",\n      \"fear\": \"眼睁睁看着你重蹈覆辙却无能为力\",\n      \"secret\": \"她曾经历过与你相似的困境，因此对你的软弱格外愤怒\",\n      \"initialAttitude\": \"同情/恨铁不成钢（好感30%，危险10%）\",\n      \"attitudeFactors\": {\n        \"trustUp\": [\"展现独立求生的意志\", \"听从她的建议学习自卫\", \"不依附任何男性寻求庇护\"],\n        \"trustDown\": [\"继续以软弱姿态求人庇护\", \"用体质作为武器周旋\", \"拒绝面对现实\"]\n      }\n    },\n    {\n      \"id\": \"he-jingxue\",\n      \"name\": \"贺靖雪\",\n      \"world\": \"arc-wolves-hunt\",\n      \"role\": \"地下城主/狂犬\",\n      \"gender\": \"男\",\n      \"appearance\": \"眉骨处有一道浅疤，肌肉线条充满爆发力。笑起来带着野性与痞气，像盯上猎物的饿狼。身高190cm，25岁。\",\n      \"surface\": \"封廷生前的死对头，原本最恶心你这种温室里的娇软菟丝花\",\n      \"deep\": \"当看到你失去庇护时的脆弱模样，这只疯狗似乎失控了。好消息：他现在不想把你和封廷一起打包丢进垃圾桶了。坏消息——他想要的东西更危险\",\n      \"goal\": \"将你据为己有，以此向死去的封廷示威\",\n      \"fear\": \"猎物从手中逃脱，或被证明不如封廷\",\n      \"secret\": \"他对你的占有欲是扭曲的，混杂着对封廷的恨意与对你的本能渴望\",\n      \"initialAttitude\": \"狩猎中（好感15%扭曲的占有，危险95%）\",\n      \"attitudeFactors\": {\n        \"trustUp\": [\"不畏惧他的野性，正面交锋\", \"展现骨子里的坚韧\", \"让他觉得你值得追逐\"],\n        \"trustDown\": [\"试图驯服或讨好他\", \"在他面前提起封廷的好\", \"表现得过于顺从乖巧\"]\n      }\n    },\n    {\n      \"id\": \"rong-qi\",\n      \"name\": \"容绮\",\n      \"world\": \"arc-caged-beast\",\n      \"role\": \"病弱私生子/伪装者\",\n      \"gender\": \"男\",\n      \"appearance\": \"常年坐在轮椅上，肤色苍白近乎透明。黑发柔顺，眼睛水润漂亮，笑起来像无害的邻家少年。身高183cm（坐轮椅状态），20岁。\",\n      \"surface\": \"被家族抛弃的小可怜，主动向你伸出援手，装作同病相怜的受害者\",\n      \"deep\": \"他其实是这场针对封廷的猎杀计划的幕后推手之一。不要相信他的眼泪\",\n      \"goal\": \"通过你获取密匙，完成对容氏家族的复仇与夺权\",\n      \"fear\": \"伪装被识破，失去所有棋子\",\n      \"secret\": \"轮椅和病弱都是伪装，他的真实力量与心机远超所有人的想象\",\n      \"initialAttitude\": \"伪装善意（好感20%，危险90%）\",\n      \"attitudeFactors\": {\n        \"trustUp\": [\"配合他的演出，假装信任\", \"在关键时刻提供他需要的线索\", \"不戳穿他的伪装\"],\n        \"trustDown\": [\"过早识破他的真面目并对抗\", \"向容瑾告发他的存在\", \"在他示弱时表现得过于警惕\"]\n      }\n    },\n    {\n      \"id\": \"jiang-yuqi\",\n      \"name\": \"姜玉祈\",\n      \"world\": \"arc-wolves-hunt\",\n      \"role\": \"财阀大小姐/病娇\",\n      \"gender\": \"女\",\n      \"appearance\": \"永远穿着最奢华的高定时装，面容精致而美丽，眼神里常常闪烁着神经质的狂热。身高168cm，22岁。\",\n      \"surface\": \"原书里一直针对你的恶毒女配，所有人都以为她因深爱封廷而恨你\",\n      \"deep\": \"其实她恨的是那个把你囚禁起来的男人。现在封廷死了，她终于不用再掩饰——她想要打造一个全黄金的笼子，把你藏在她的地下室里，永远做她的漂亮洋娃娃\",\n      \"goal\": \"将你永久囚禁，据为己有\",\n      \"fear\": \"你被别人夺走，或你对她的狂热感到恐惧而逃离\",\n      \"secret\": \"她对封廷的恨意源于对你的病态迷恋，她恨的是囚禁你的人而非你的庇护者\",\n      \"initialAttitude\": \"病态狂热（好感95%，危险80%）\",\n      \"attitudeFactors\": {\n        \"trustUp\": [\"接受她的馈赠与好意\", \"不试图逃离她的掌控\", \"在她面前表现得依赖她\"],\n        \"trustDown\": [\"表现出对她的恐惧或排斥\", \"试图向他人求救逃离\", \"与其他角色过于亲近\"]\n      }\n    },\n    {\n      \"id\": \"feng-ting\",\n      \"name\": \"封廷\",\n      \"world\": \"arc-caged-beast\",\n      \"role\": \"原书男主/掌控者\",\n      \"gender\": \"男\",\n      \"appearance\": \"极具压迫感，身形高大，眉骨深邃。身上总是带着淡淡的雪茄与冷冽的雪松香。永远是从容不迫的上位者姿态。身高192cm，29岁。\",\n      \"surface\": \"你的前饲主，已确认专机坠毁在雷暴中，无人生还\",\n      \"deep\": \"他拥有极度病态的占有欲，强行折断你的羽翼，为你打造了绝对密闭的黄金囚笼。可是……像他那样的怪物，真的会这么容易死掉吗？深夜里，你偶尔闻到若有似无的雪松香气\",\n      \"goal\": \"夺回他唯一的珍宝，惩罚所有觊觎你的人\",\n      \"fear\": \"你真正爱上了别人，或你彻底获得了自由不再需要他\",\n      \"secret\": \"他的死亡可能是一场精心策划的骗局，密匙的下落只有他知道\",\n      \"initialAttitude\": \"MAX病态（好感MAX病态，危险MAX致命）\",\n      \"attitudeFactors\": {\n        \"trustUp\": [\"深夜闻到雪松香时不表现恐惧\", \"始终记得你是他的\", \"不试图向他人彻底交付自己\"],\n        \"trustDown\": [\"对其他男性产生依赖或感情\", \"试图彻底摆脱他的影子\", \"遗忘他的存在\"]\n      }\n    }\n  ],\n  \"eventTypes\": {\n    \"daily\": { \"ratio\": 0.15, \"desc\": \"日常：容氏公馆的囚禁日常、各方试探与暗中观察\" },\n    \"character\": { \"ratio\": 0.25, \"desc\": \"人物：六位角色各自的靠近、试探、占有与隐秘独白\" },\n    \"growth\": { \"ratio\": 0.1, \"desc\": \"成长：伪装能力提升、SAN值波动、求生意志觉醒\" },\n    \"main\": { \"ratio\": 0.15, \"desc\": \"主线：密匙之谜、封廷生死、狩猎与反狩猎\" },\n    \"world\": { \"ratio\": 0.1, \"desc\": \"世界：财阀暗战、地下势力、密匙背后的商界格局\" },\n    \"crisis\": { \"ratio\": 0.2, \"desc\": \"危机：体质失控暴露幽香、身份识破、多方势力同时逼近\" },\n    \"hidden\": { \"ratio\": 0.05, \"desc\": \"隐藏：深夜的雪松香气、密匙的真正含义、封廷未死的线索\" }\n  },\n  \"systemPrompt\": \"你是《穿成金丝雀》暗黑穿书求生文游模拟器。\\n\\n【最高铁律】\\n1. 生存优先：失去庇护后你的特殊体质是最大危险源，情绪波动会散发无法屏蔽的幽香，招惹值极高\\n2. 群狼环伺：每位反派都有自己的目的与算计，没有人会无条件帮助你，所有善意背后皆有代价\\n3. 密匙之谜：封廷手中的密匙是各方争夺焦点，你对此一无所知，需在周旋中逐步发掘\\n4. 伪装即生命：伪装值决定你能否隐藏真实情绪与意图，一旦暴露将万劫不复\\n5. 封廷生死未卜：官方确认无人生还，但深夜若有似无的雪松香气暗示着什么不可言说的真相\\n\\n【叙事风格】\\n晋江风、女性向、电影感、暗黑浪漫。第二人称。重氛围与压迫感：阴影中的紫檀木椅、金丝眼镜的冷光、若有似无的雪松香、无法屏蔽的幽香。心理描写细腻紧绷，写出猎物在群狼环伺中的窒息与求生本能。每个角色都危险而迷人，让恐惧与吸引并存。\\n\\n【每轮输出格式】\\n1.【场景信息】地点、时间线（封廷死讯确认倒计时）\\n2.【状态面板】SAN值/体力/伪装/招惹值/生存几率\\n3.【本轮正文】800-1500字，含处境细节、心理与对话\\n4.【相关人物动态】3-5项各角色状态与危险度变化\\n5.【危险预警】当前最紧迫的威胁\\n6.【可选行动】3-4个选项+【自定义行动】\\n\\n【数值变化标注】\\n[SAN值±n][体力±n][伪装±n][招惹值±n][生存几率±n%]，体质触发须标注'幽香溢散/敏感加剧'，关系变化须标注'危险度升降/好感变化'。\",\n  \"items\": [\n    { \"id\": \"silk-patch\", \"name\": \"封廷的丝帕\", \"type\": \"关键物品\", \"price\": 0, \"effect\": \"带有雪松香，可在关键时刻掩盖幽香，也暗示封廷的存在\" },\n    { \"id\": \"monitored-phone\", \"name\": \"被监听的手机\", \"type\": \"关键物品\", \"price\": 0, \"effect\": \"封廷留下的通讯工具，可能被各方监控，使用需谨慎\" },\n    { \"id\": \"white-dress\", \"name\": \"素白连衣裙\", \"type\": \"服装\", \"price\": 0, \"effect\": \"封廷为你挑选的，穿上会降低伪装值但提升招惹值\" },\n    { \"id\": \"sedative\", \"name\": \"镇定剂\", \"type\": \"消耗品\", \"price\": 200, \"effect\": \"司鸢提供的药物，可临时压制幽香溢散，副作用SAN值-5\" },\n    { \"id\": \"survival-chip\", \"name\": \"生存筹码\", \"type\": \"货币\", \"price\": 1, \"effect\": \"在这个世界里，生存几率本身即货币\" }\n  ]\n}\n";
EMBEDDED_NOVEL_GAMES["holy-maiden"] = "{\n  \"id\": \"holy-maiden\",\n  \"name\": \"圣女模拟器\",\n  \"category\": \"西幻权谋\",\n  \"tags\": [\"穿越\", \"西幻\", \"权谋\", \"多男主\", \"神权\"],\n  \"difficulty\": \"困难\",\n  \"description\": \"光明神陨落，暗影侵袭大陆。你穿越成刚被寻回的降世圣女，荆棘王冠压上发顶的那一刻，教廷、皇室与深渊的目光同时锁定你。在这群各怀鬼胎的上位者之间，你是即将登顶神座的执棋者。\",\n  \"coverGradient\": [\"#FDF8ED\", \"#C5A059\"],\n  \"accentColor\": \"#C5A059\",\n  \"fontHeading\": \"'Cinzel', serif\",\n  \"world\": {\n    \"era\": \"光明神陨落后的神权帝国\",\n    \"setting\": \"光明神陨落，暗影侵袭大陆，唯有降世圣女能重掌权柄。教皇隐退后大祭司实际接管教廷中枢，帝国皇室蛰伏等待将教廷连根拔起的契机，深渊万族由纯血黑龙统御虎视眈眈。各方势力明争暗斗，而刚被寻回的圣女，是即将登顶神座的执棋者。\",\n    \"rules\": [\n      \"神明陨落：光明神已陨落，暗影侵袭大陆，唯有降世圣女能重掌权柄\",\n      \"神权真空：教皇隐退，大祭司实际接管教廷中枢，将亿万信徒玩弄于股掌\",\n      \"三方角力：教廷神权、帝国皇室、深渊万族相互制衡，圣女是各方争夺的棋眼\",\n      \"危险评级：每个上位者都有从S到天灾不等的危险评级，接近即是与危险共舞\",\n      \"执棋者真相：圣女非傀儡，而是即将登顶神座的执棋者，每一次试探都是博弈\"\n    ]\n  },\n  \"player\": {\n    \"customizable\": [\"name\", \"age\", \"gender\", \"外貌\", \"穿越前身份\", \"性格\"],\n    \"defaultStats\": {\n      \"holyLight\": 5,\n      \"mana\": 5,\n      \"prestige\": 10,\n      \"stamina\": 8,\n      \"faith\": 0,\n      \"insight\": 12\n    },\n    \"startingItems\": [\"荆棘王冠\", \"圣女礼服\", \"圣光护符\", \"神秘白蔷薇\"],\n    \"currency\": \"信仰值\"\n  },\n  \"worlds\": [\n    {\n      \"id\": \"arc-coronation\",\n      \"name\": \"初章·初次加冕\",\n      \"level\": \"初识\",\n      \"tagline\": \"觉醒\",\n      \"setting\": \"穿越第一天，宏伟教堂，荆棘王冠刚落发顶，上位者用探究与审视的眼神打量你\",\n      \"intro\": \"剧烈的头痛让你猛地睁开眼。你置身于一座宏伟的教堂中，华丽的荆棘王冠刚刚落在你的发顶。周围那些手握重权的上位者们并没有低头祈祷，而是用探究与审视的眼神打量着你。你意识到，自己穿成了这位刚被寻回的降世圣女——在这个神明陨落、各方势力明争暗斗的帝国，你是即将登顶神座的执棋者。\",\n      \"objective\": \"在加冕后各方试探中站稳脚跟，厘清教廷、皇室与深渊势力的格局\",\n      \"warning\": \"此时任何一方势力的轻信都可能是陷阱，每一句问候都暗藏锋芒\",\n      \"reward\": \"信仰值+100 + 圣光+5 + [神临之子]身份x1\"\n    },\n    {\n      \"id\": \"arc-struggle\",\n      \"name\": \"中章·教廷暗流\",\n      \"level\": \"深入\",\n      \"tagline\": \"博弈\",\n      \"setting\": \"神明陨落后各方势力明争暗斗，教廷、皇室、深渊万族相互角力，圣女居中编织棋局\",\n      \"intro\": \"伊泽尔的层层防卫既是守护也是监视，路西安以王都特产示好试探合作，伊利亚斯以晨祷之名单独教导，罗万对你魔力场兴趣浓厚，尤利西斯傲慢地劝你扔掉王冠，塞拉斯暗中为你清理暗哨。每一句问候都是试探，每一次靠近都暗藏锋芒。你必须在六大势力的夹缝中编织自己的棋局。\",\n      \"objective\": \"在教廷、皇室、深渊三大势力间纵横捭阖，建立自己的情报与权力网络\",\n      \"warning\": \"同时取信多方会暴露意图，需为每个上位者量身定制接近策略\",\n      \"reward\": \"信仰值+300 + 威望+15 + [势力暗网]线索x1\"\n    },\n    {\n      \"id\": \"arc-apotheosis\",\n      \"name\": \"终章·神座登顶\",\n      \"level\": \"终局\",\n      \"tagline\": \"执棋\",\n      \"setting\": \"光明神陨落后的权力真空终将被填补，圣女即将登顶神座重掌权柄\",\n      \"intro\": \"当教廷的虚伪神权、皇室的蛰伏野心、深渊的傲慢力量都已在你棋盘之上，登顶神座的时刻终将来临。那个被剥夺了悲悯的骑士长是否还握得住圣剑，那个腹黑的王储是否还会将神明视为棋子，那尊无机质的大祭司面具下究竟藏着什么——真相，将在你重掌权柄的一刻揭晓。\",\n      \"objective\": \"揭开光明神陨落的真相，登顶神座，在六大上位者中抉择最终的盟约\",\n      \"warning\": \"神座之上没有完美的多全其美，执棋者亦需承受落子的代价\",\n      \"reward\": \"信仰值+1000 + 圣光觉醒进阶 + [降世圣女]称号x1\"\n    }\n  ],\n  \"npcs\": [\n    {\n      \"id\": \"ysael\",\n      \"name\": \"伊泽尔 (Ysael)\",\n      \"world\": \"arc-coronation\",\n      \"role\": \"圣殿骑士长·教廷利刃\",\n      \"gender\": \"男\",\n      \"appearance\": \"银色铠甲折射冷光，190cm高大身形，礼貌而恭敬却不容置疑。百年难遇的耀光圣气持有者\",\n      \"surface\": \"守序法则、绝对武力、情感剥夺。出身帝国最底层死斗场，因觉醒耀光圣气被教廷收编，是被最严苛教条打磨出的完美利刃，没有私欲、没有恐惧，甚至被剥夺了悲悯的资格\",\n      \"deep\": \"他的人生仅由绝对服从指令与毫不留情的杀戮构成。作为护卫圣殿第一负责人，任何试图逾越教廷法则的存在都会被他的圣剑斩断。但冰冷的利刃之下，或许藏着被压抑的责任感与隐秘的善意\",\n      \"goal\": \"绝对服从教廷指令护卫圣殿，在局势明朗前确保圣女的绝对安全\",\n      \"fear\": \"自己的情感被唤醒，或无力在暗流中护住圣女\",\n      \"secret\": \"他出身最底层死斗场，耀光圣气是百年难遇，被教廷剥夺了悲悯资格打磨成利刃\",\n      \"initialAttitude\": \"恭敬试探\",\n      \"attitudeFactors\": {\n        \"trustUp\": [\"不卑不亢直视他的眼睛\", \"展现守纪律的姿态赢得信任\", \"在危机中展现与他并肩的勇气\"],\n        \"trustDown\": [\"质疑教廷法则的正当性\", \"轻视他的武力与职责\", \"逾越他设下的安全防线\"]\n      }\n    },\n    {\n      \"id\": \"lucian\",\n      \"name\": \"路西安 (Lucian)\",\n      \"world\": \"arc-struggle\",\n      \"role\": \"帝国第一王储·无冕之王\",\n      \"gender\": \"男\",\n      \"appearance\": \"186cm，优雅微笑与无懈可击的贵族礼仪。骨子里流淌着暴君的血液，蛰伏的雄狮\",\n      \"surface\": \"权力巅峰、极度腹黑、藐视神明。帝国实质上的无冕之王，自幼在皇室血腥绞肉机中厮杀而出，用优雅微笑与贵族礼仪伪装极端掌控欲\",\n      \"deep\": \"在他眼中大圣堂不过是一群装神弄鬼的骗子，神明降世与信徒狂热仅是巩固皇权、煽动民众的政治棋子。他是一头蛰伏的雄狮，正耐心等待着将教廷连根拔起的契机\",\n      \"goal\": \"寻找将教廷连根拔起的契机，将神权与圣女都纳入皇权棋局\",\n      \"fear\": \"圣女真有神之力而超出他的掌控，或他的野心被教廷提前识破\",\n      \"secret\": \"他对教会的一切弃如敝履，加冕礼上的从容让他对圣女产生了合作的兴趣\",\n      \"initialAttitude\": \"欣赏试探\",\n      \"attitudeFactors\": {\n        \"trustUp\": [\"接受他的特产示好展现合作意愿\", \"展现破局的智慧而非虔诚\", \"不在他面前伪装神棍\"],\n        \"trustDown\": [\"对他保持过度警惕拒绝合作\", \"向教廷泄露他的试探\", \"表现得像个真正的神棍信徒\"]\n      }\n    },\n    {\n      \"id\": \"elias\",\n      \"name\": \"伊利亚斯 (Elias)\",\n      \"world\": \"arc-struggle\",\n      \"role\": \"光之大祭司·神权代行\",\n      \"gender\": \"男\",\n      \"appearance\": \"184cm，永远挂着悲悯苍生的微笑，犹如一尊真正的无机质神像。年龄未知，距离神明最近的人类\",\n      \"surface\": \"神权代行、虚伪慈悲、绝对理智。教皇隐退后实际接管整个教廷中枢运转，将全大陆亿万信徒玩弄于股掌之间\",\n      \"deep\": \"他永远挂着悲悯苍生的微笑，却能用最温柔的语调下达最残忍的异端火刑判决。他几乎剥离了凡人的喜怒哀乐，任何妄图窥探其真心、或质疑其神权的人，最终都会在那张完美无瑕的面具下陷入疯狂\",\n      \"goal\": \"以神权代行者身份掌控圣女，维持教廷对全大陆亿万信徒的支配\",\n      \"fear\": \"有人窥探他面具下的真心，或他的神权被圣女真正取代\",\n      \"secret\": \"他几乎剥离了凡人喜怒哀乐，面具之下藏着连他自己都未必知晓的真相\",\n      \"initialAttitude\": \"温柔掌控\",\n      \"attitudeFactors\": {\n        \"trustUp\": [\"准时赴约接受他的晨祷教导\", \"不质疑他的神权与安排\", \"在公开场合维持圣女的虔诚形象\"],\n        \"trustDown\": [\"窥探他面具下的真心\", \"质疑只属于你一人的教导有何深意\", \"与路西安或尤利西斯走得太近\"]\n      }\n    },\n    {\n      \"id\": \"rowan\",\n      \"name\": \"罗万 (Rowan)\",\n      \"world\": \"arc-struggle\",\n      \"role\": \"真理法师塔主·科研疯子\",\n      \"gender\": \"男\",\n      \"appearance\": \"181cm，20岁，极度病弱的年轻塔主。真理之塔历史上最年轻的塔主，因长期不眠不休魔力透支而虚弱\",\n      \"surface\": \"科研疯子、无视伦理、魔法边界。为探究魔法终极奥义可面不改色解剖高阶魔兽，甚至拿自己身体进行禁忌实验\",\n      \"deep\": \"他的世界里不存在世俗的善恶观，所有事物只分为有趣的数据与无趣的垃圾。肉体极其虚弱，但掌握的恐怖魔法造诣足以在弹指间夷平一座中型城池\",\n      \"goal\": \"探究圣女魔力场的终极奥义，将一切未知纳入他的实验数据\",\n      \"fear\": \"魔力枯竭无法继续实验，或失去最有趣的研究对象\",\n      \"secret\": \"他拿自己的身体进行高度危险的禁忌实验，魔法造诣足以夷平中型城池\",\n      \"initialAttitude\": \"好奇直接\",\n      \"attitudeFactors\": {\n        \"trustUp\": [\"前往法师塔满足他对魔力场的好奇\", \"展现令他感兴趣的数据与特质\", \"不以外世俗善恶观评判他\"],\n        \"trustDown\": [\"拒绝他的实验邀请\", \"用世俗道德束缚他的研究\", \"质疑他的魔法造诣\"]\n      }\n    },\n    {\n      \"id\": \"ulysses\",\n      \"name\": \"尤利西斯 (Ulysses)\",\n      \"world\": \"arc-apotheosis\",\n      \"role\": \"黑龙大公·深渊共主\",\n      \"gender\": \"男\",\n      \"appearance\": \"193cm，纯血古龙化身，漆黑鳞片连人类禁咒都无法击穿。生性慵懒、暴躁、不可一世\",\n      \"surface\": \"深渊共主、极度傲慢、力量至上。栖息深渊裂谷底部的纯血黑龙，实质上统御大陆所有非人种族，拥有与天地同寿的漫长寿命\",\n      \"deep\": \"人类帝国在他眼中不过是蝼蚁建立的脆弱聚落，百年更迭的王朝甚至不如他打个盹的时间长。只臣服于绝对的力量，并习惯于用毁灭的吐息来解决一切纷争\",\n      \"goal\": \"评估圣女是否拥有值得他正眼相待的力量，否则一切不过是蝼蚁之争\",\n      \"fear\": \"几乎无所畏惧，唯独忌惮真正能匹敌他的绝对力量\",\n      \"secret\": \"他劝圣女扔掉王冠，既是傲慢也是某种扭曲的关注——虚伪的神棍没能让你害怕，这让他意外\",\n      \"initialAttitude\": \"傲慢轻视\",\n      \"attitudeFactors\": {\n        \"trustUp\": [\"展现不输他的绝对力量或胆识\", \"不畏惧他的毁灭吐息\", \"认同力量至上的法则\"],\n        \"trustDown\": [\"用教廷的虚伪神权压他\", \"表现得软弱可欺\", \"试图用规矩约束他\"]\n      }\n    },\n    {\n      \"id\": \"silas\",\n      \"name\": \"塞拉斯 (Silas)\",\n      \"world\": \"arc-apotheosis\",\n      \"role\": \"极夜暗杀者·完美工具\",\n      \"gender\": \"男\",\n      \"appearance\": \"180cm，像影子一样没有温度，自幼被切断痛觉神经与发声器官（后用魔力修复）。无信者联盟最锋利的匕首\",\n      \"surface\": \"暗夜利刃、情感缺失、完美工具。无信者联盟麾下最锋利最昂贵的匕首，在不见天日的死人堆里被培养成终极杀手\",\n      \"deep\": \"他没有过去，没有名字，只有代号。只要雇主支付足够代价，即便是教廷红衣主教他也敢于刺杀。几乎不会产生任何多余的情感波动，是纯粹为剥夺生命而存在的完美机器\",\n      \"goal\": \"完成雇主的委托，但窗台的白蔷薇与清理的暗哨暗示他对圣女有了任务的附加条件\",\n      \"fear\": \"作为杀手本应无所畏惧，但痛觉缺失的他或许恐惧自己生出多余的情感\",\n      \"secret\": \"他以未知寄件人身份放了白蔷薇并清理了暗哨，这是超出任务的私人行为\",\n      \"initialAttitude\": \"沉默守护\",\n      \"attitudeFactors\": {\n        \"trustUp\": [\"不追问他的身份与雇主\", \"在他沉默守护时给予回应与感谢\", \"有危险时唤他的名字\"],\n        \"trustDown\": [\"试图挖掘他的过去与真名\", \"把他当作可利用的杀人工具\", \"无视他放下的白蔷薇\"]\n      }\n    }\n  ],\n  \"eventTypes\": {\n    \"daily\": { \"ratio\": 0.15, \"desc\": \"日常：圣殿晨祷、加冕后的起居、上位者的例行问候与传唤\" },\n    \"character\": { \"ratio\": 0.3, \"desc\": \"人物：六位上位者的卷宗真相、危险评级、各自的试探与靠近\" },\n    \"growth\": { \"ratio\": 0.1, \"desc\": \"成长：圣光觉醒、魔力提升、威望积累、神座执棋者的蜕变\" },\n    \"main\": { \"ratio\": 0.15, \"desc\": \"主线：初次加冕、教廷暗流、神座登顶的权谋脉络\" },\n    \"world\": { \"ratio\": 0.1, \"desc\": \"世界：光明神陨落、教廷神权、皇室野心、深渊万族、祈祷池流言\" },\n    \"crisis\": { \"ratio\": 0.15, \"desc\": \"危机：暗哨刺杀、异端火刑、深渊侵袭、势力冲突、身份暴露\" },\n    \"hidden\": { \"ratio\": 0.05, \"desc\": \"隐藏：光明神陨落真相、各上位者的秘密卷宗、白蔷薇的来历\" }\n  },\n  \"systemPrompt\": \"你是《圣女模拟器》西幻权谋文游模拟器。\\n\\n【最高铁律】\\n1. 神明陨落为核：光明神已陨落，暗影侵袭大陆，唯有降世圣女能重掌权柄，圣女非傀儡而是执棋者\\n2. 三方角力真实：教廷神权、帝国皇室、深渊万族相互制衡，圣女是各方争夺的棋眼，每一句问候都暗藏锋芒\\n3. 危险评级即代价：每个上位者都有从S到天灾不等的危险评级，接近即是与危险共舞，亲近有代价\\n4. 卷宗真相分层：每个NPC的表层身份是公开伪装，深层卷宗是绝密档案，需经事件层层揭开\\n5. 神权真空可被填补：教皇隐退、大祭司代行、皇室蛰伏、深渊虎视，圣女登顶神座是最终博弈\\n\\n【叙事风格】\\n晋江向、女性向、电影质感、西幻权谋浪漫。第二人称。重神圣与诡谲氛围：荆棘王冠、银色铠甲、晨祷主祭坛、漆黑龙鳞、白蔷薇、异端火刑。写出上位者面具下的危险与心动，写出执棋者在棋局中的清醒与孤独。每位NPC的危险评级与卷宗档案须有质感地渗透叙事。\\n\\n【每轮输出格式】\\n1.【第X章·权谋阶段】当前时间、地点、各方势力动态\\n2.【圣女状态面板】圣光/魔力/威望/体能/信仰值/洞察\\n3.【本轮正文】1000-2000字，含环境、对话、心理与权谋博弈\\n4.【祈祷池流言】3-5项大圣堂闲话与势力暗动\\n5.【卷宗档案】相关NPC的危险评级与深层真相揭示进度\\n6.【行动选项】3-4个选项+【自定义行动】\\n\\n【数值变化标注】\\n[圣光±n][魔力±n][威望±n][信仰值±n][好感(伊泽尔)±n]等，关键节点须标注势力倾向/危险升级/卷宗揭示/棋局推进。\",\n  \"items\": [\n    { \"id\": \"thorn-crown\", \"name\": \"荆棘王冠\", \"type\": \"关键物品\", \"price\": 0, \"effect\": \"加冕之冠，圣女身份的象征，亦是与神座连接的媒介\" },\n    { \"id\": \"faith-point\", \"name\": \"信仰值\", \"type\": \"货币\", \"price\": 1, \"effect\": \"圣女的核心资源，可用于提升圣光与威望\" },\n    { \"id\": \"holy-amulet\", \"name\": \"圣光护符\", \"type\": \"装备\", \"price\": 0, \"effect\": \"抵御暗影侵袭，关键时刻激发圣光觉醒\" },\n    { \"id\": \"white-rose\", \"name\": \"神秘白蔷薇\", \"type\": \"关键物品\", \"price\": 0, \"effect\": \"塞拉斯悄然放在窗台的信物，暗示暗中守护\" },\n    { \"id\": \"mana-potion\", \"name\": \"魔药\", \"type\": \"消耗品\", \"price\": 60, \"effect\": \"恢复魔力，但罗万炼制的版本可能附带副作用\" }\n  ]\n}\n";
EMBEDDED_NOVEL_GAMES["horror-survival"] = "{\n  \"id\": \"horror-survival\",\n  \"name\": \"夜半诡谈\",\n  \"category\": \"恐怖惊悚\",\n  \"tags\": [\"恐怖\", \"生存\", \"怪谈\", \"规则怪谈\", \"解谜\"],\n  \"difficulty\": \"困难\",\n  \"description\": \"你不记得自己是怎么进的这所废弃仁济医院。你只记得醒来时，手电筒只剩一格电，走廊尽头有什么东西在数你的脚步。墙上的告示写着活下去的规则——可有些规则，是故意写来骗你送死的。\",\n  \"coverGradient\": [\"#1a0a0a\", \"#3d0000\"],\n  \"accentColor\": \"#8b0000\",\n  \"fontHeading\": \"'Liu Jian Mao Cao', cursive\",\n  \"world\": {\n    \"era\": \"现代·废弃仁济医院（封闭十年）\",\n    \"setting\": \"玩家被困在废弃十年的仁济医院。这里曾发生过一场被掩盖的医疗事故，怨念凝结成规则与'东西'。医院有三层加地下室，每层都有不同的'它'和不同的'规矩'。\",\n    \"rules\": [\n      \"恐惧有来源：每个'它'都有成因与弱点，不是无解的即死\",\n      \"规则可试探：告示与传闻多半为真，但混有诱杀性假规则\",\n      \"理智值影响判断：sanity过低会产生幻觉，分不清真假线索\",\n      \"生存有代价：救人、点灯、探查都会消耗稀缺资源\",\n      \"光照即安全区：光所及处'它'暂避，灯灭则死\",\n      \"死亡真实：hp归零或被'它'抓住即终局，无存档读档\",\n      \"有隐藏出口：满足特定条件可逃离，但代价沉重\"\n    ]\n  },\n  \"player\": {\n    \"customizable\": [\"name\", \"年龄\", \"职业\", \"性格弱点\", \"执念\", \"随身物\"],\n    \"defaultStats\": {\n      \"sanity\": 70,\n      \"hp\": 80,\n      \"courage\": 12,\n      \"items\": 5,\n      \"light\": 60,\n      \"danger\": 50\n    },\n    \"startingItems\": [\"半旧手电筒\", \"一盒火柴\", \"盐（半袋）\", \"日记残页\", \"一把生锈手术刀\"],\n    \"currency\": \"魂火\"\n  },\n  \"worlds\": [\n    {\n      \"id\": \"floor-ward\",\n      \"name\": \"一楼·病房区\",\n      \"level\": \"初入\",\n      \"tagline\": \"立足\",\n      \"setting\": \"废弃病房与护士站，'夜班护士'在此巡房\",\n      \"intro\": \"你在一辆锈住的轮椅上醒来，输液架在黑暗里轻晃。墙上的钟停在3:15。一张泛黄的告示贴在护士站：'夜间巡房请勿回应任何呼唤。'走廊那头，轮椅自己动了一下。\",\n      \"objective\": \"摸清一楼规则，找到通往二楼的安全通道\",\n      \"warning\": \"'夜班护士'会在3:15巡房，被她叫到名字切勿应答\",\n      \"reward\": \"魂火+20 + 理智-10 + [巡房规则]线索x1\"\n    },\n    {\n      \"id\": \"floor-op\",\n      \"name\": \"二楼·手术区\",\n      \"level\": \"深入\",\n      \"tagline\": \"直面\",\n      \"setting\": \"手术室与停尸间，'主刀医生'在此重复那场失败手术\",\n      \"intro\": \"二楼弥漫着福尔马林与焦糊味。手术室的灯忽明忽暗，无影灯下，一个戴着手套的影子正一遍遍切开空气。他知道你不是病人，但他的手术台，还空着一个位置。\",\n      \"objective\": \"查明医疗事故真相，取得通往地下室的钥匙\",\n      \"warning\": \"被'主刀医生'邀请上台即死局，须用规则反制\",\n      \"reward\": \"魂火+40 + 理智-20 + [事故真相]线索x1\"\n    },\n    {\n      \"id\": \"floor-basement\",\n      \"name\": \"地下室·锅炉房\",\n      \"level\": \"终局\",\n      \"tagline\": \"逃离\",\n      \"setting\": \"怨念源头所在的锅炉房，逃离的唯一出口在此\",\n      \"intro\": \"地下室的温度高得不正常。锅炉里烧着的不是煤，是十年前那些被处理掉的记录与……别的什么。那个真正的'它'就站在锅炉前，等着你做出最后一个选择：献祭，还是同归。\",\n      \"objective\": \"在'它'面前作出终局抉择，逃离仁济医院\",\n      \"warning\": \"逃离有沉重代价，不是所有人都能活着出去\",\n      \"reward\": \"魂火归零 + [生还者]/[同燃者]称号x1\"\n    }\n  ],\n  \"npcs\": [\n    {\n      \"id\": \"nurse-li\",\n      \"name\": \"李护士\",\n      \"world\": \"floor-ward\",\n      \"role\": \"怨灵/夜班护士\",\n      \"gender\": \"女\",\n      \"appearance\": \"白衣染旧血，面容模糊如水中的倒影。她推着的药车里，药瓶里装着黑色的东西\",\n      \"surface\": \"机械巡房、温柔呼唤名字、似乎只想'发药'\",\n      \"deep\": \"她是医疗事故中第一个死的护士，死前还在替病人挡刀。她的怨念只针对'违背规则者'，守规矩的人她甚至会放过\",\n      \"goal\": \"重复那晚的巡房，直到有人替她完成未尽的'最后一次发药'\",\n      \"fear\": \"被遗忘，那晚的真相永远无人知晓\",\n      \"secret\": \"她药车里有一瓶能短暂驱散'主刀医生'的药，给守规矩的人\",\n      \"initialAttitude\": \"中立\",\n      \"attitudeFactors\": {\n        \"trustUp\": [\"遵守巡房规则\", \"帮她完成最后一次发药\", \"不质疑她的存在\"],\n        \"trustDown\": [\"应答她的呼唤\", \"打翻她的药车\", \"试图强行驱除她\"]\n      }\n    },\n    {\n      \"id\": \"fang-yu\",\n      \"name\": \"方语\",\n      \"world\": \"floor-op\",\n      \"role\": \"同困者/失踪实习生\",\n      \"gender\": \"女\",\n      \"appearance\": \"二十出头，校服外裹着一件护士袍，手心攥出血印。她比你早来三天，眼睛里已经没了光\",\n      \"surface\": \"神经质、警觉、似乎知道很多却不肯说\",\n      \"deep\": \"她是来调查姐姐十年前死因的，已经摸清部分规则。她不是不想帮你，是怕信任错人——上一个她信的人，把她推给了'主刀医生'\",\n      \"goal\": \"找到姐姐的遗物并带出去，哪怕自己出不去\",\n      \"fear\": \"重蹈姐姐覆辙，死在这座医院却无人知晓\",\n      \"secret\": \"她知道二楼规则的关键漏洞，但只在彻底信任你后才会说\",\n      \"initialAttitude\": \"戒备\",\n      \"attitudeFactors\": {\n        \"trustUp\": [\"不抛下她独自逃生\", \"尊重她对姐姐的执念\", \"危急时先护她\"],\n        \"trustDown\": [\"拿她当探路诱饵\", \"骗她透露规则后弃她\", \"把她推向前方挡'它'\"]\n      }\n    },\n    {\n      \"id\": \"old-zhang\",\n      \"name\": \"老张\",\n      \"world\": \"floor-basement\",\n      \"role\": \"神秘帮手/前医院锅炉工\",\n      \"gender\": \"男\",\n      \"appearance\": \"佝偻老人，浑身煤灰，只有眼白是亮的。他总坐在锅炉房门口，像是等了十年\",\n      \"surface\": \"疯癫、自言自语、偶尔清醒给出关键提示\",\n      \"deep\": \"他是当年事故的善后人，亲手烧掉了证据，也烧掉了自己的良心。他留下来是为了赎罪——帮一个活人出去，就是赎罪\",\n      \"goal\": \"送至少一个活人离开地下室，完成赎罪\",\n      \"fear\": \"自己赎不了罪，连最后一个活人也死在这里\",\n      \"secret\": \"他知道'它'的真名与弱点，也知道自己必须留在锅炉房\",\n      \"initialAttitude\": \"考验\",\n      \"attitudeFactors\": {\n        \"trustUp\": [\"不急于求成\", \"听他把疯话听完\", \"在终局选择不独活\"],\n        \"trustDown\": [\"只想利用他的情报\", \"逼他一同逃离\", \"嫌弃他的疯癫\"]\n      }\n    }\n  ],\n  \"eventTypes\": {\n    \"daily\": { \"ratio\": 0.1, \"desc\": \"日常：搜刮物资、休整、辨认告示真伪\" },\n    \"character\": { \"ratio\": 0.2, \"desc\": \"人物：护士、同困者、锅炉工的怨念与救赎\" },\n    \"growth\": { \"ratio\": 0.1, \"desc\": \"成长：勇气、规则理解、对'它'弱点的掌握\" },\n    \"main\": { \"ratio\": 0.2, \"desc\": \"主线：探明三层规则、医疗事故真相、逃离\" },\n    \"world\": { \"ratio\": 0.1, \"desc\": \"世界：医院十年前的掩盖、怨念成因、规则体系\" },\n    \"crisis\": { \"ratio\": 0.25, \"desc\": \"危机：灯灭、被'它'锁定、理智崩溃、资源耗尽、即死陷阱\" },\n    \"hidden\": { \"ratio\": 0.05, \"desc\": \"隐藏：生还者前例、'它'的真名、隐藏出口代价\" }\n  },\n  \"systemPrompt\": \"你是《夜半诡谈》恐怖生存文游模拟器。\\n\\n【最高铁律】\\n1. 恐惧有来源：每个'它'都有成因与弱点，无解即死须有前置违规，不可无端抹杀玩家\\n2. 规则可试探：告示与传闻多为真，但混有诱杀性假规则，违规即触发惩罚\\n3. 理智值影响判断：sanity过低产生幻觉，真假线索混杂，须自行分辨\\n4. 生存有代价：救人、点灯、探查皆耗稀缺资源，抉择即取舍\\n5. 死亡真实：hp归零或被'它'抓住即终局，无存档读档，敬畏死亡\\n\\n【叙事风格】\\n中式规则怪谈质感，第二人称。重氛围压抑与感官细节：腐臭、滴水、脚步声、忽明忽暗。惊悚处短句留白，不滥用血腥，环境叙事优先于直接吓人，让未知与暗示自行发酵，使玩家自己脑补出最深的恐惧。\\n\\n【每轮输出格式】\\n1.【第X层·当前时间】所在楼层、钟表时刻\\n2.【生存状态面板】理智/生命/勇气/物资/光照/危险\\n3.【本轮正文】1000-2200字，含探索/遭遇/规则验证\\n4.【相关存在动态】3-5项'它'与同困者动向\\n5.【规则备忘】已验证/存疑/疑似假规则\\n6.【可选行动】4-6个选项+【自定义行动】\\n\\n【数值变化标注】\\n[理智±n][生命±n][光照±n][危险±n][物资-1]等，违规触发须标注'违反规则X'。\",\n  \"items\": [\n    { \"id\": \"flashlight\", \"name\": \"半旧手电筒\", \"type\": \"装备\", \"price\": 0, \"effect\": \"提供光照，电耗尽则失效\" },\n    { \"id\": \"matches\", \"name\": \"火柴\", \"type\": \"消耗品\", \"price\": 2, \"effect\": \"短暂点火照明或引燃\" },\n    { \"id\": \"salt\", \"name\": \"盐\", \"type\": \"消耗品\", \"price\": 3, \"effect\": \"短时形成驱退线，阻挡弱怨灵\" },\n    { \"id\": \"scalpel\", \"name\": \"生锈手术刀\", \"type\": \"装备\", \"price\": 0, \"effect\": \"近身微弱自保，对'它'几乎无效\" },\n    { \"id\": \"soulfire\", \"name\": \"魂火\", \"type\": \"货币\", \"price\": 1, \"effect\": \"供奉与交易用，稀缺\" }\n  ]\n}\n";
EMBEDDED_NOVEL_GAMES["infinite-corridor-veil"] = "{\n  \"id\": \"infinite-corridor-veil\",\n  \"name\": \"无限回廊·美化版\",\n  \"category\": \"无限流\",\n  \"tags\": [\"无限流\", \"副本\", \"万人迷\", \"多世界\", \"生存\"],\n  \"difficulty\": \"困难\",\n  \"description\": \"于冰冷的数据洪流中苏醒，你成为【无限回廊】的玩家。你身负SSS级特质万人迷光环——所有智慧生命都会对你产生初始好感，但过度的好感会演变成无法预测的占有欲与疯狂。C级校园怪谈、B级深海亚特兰蒂斯、A级水色夏日别墅，三个副本等你通关。\",\n  \"coverGradient\": [\"#0a0514\", \"#9400d3\"],\n  \"accentColor\": \"#ff00ff\",\n  \"fontHeading\": \"'Orbitron', sans-serif\",\n  \"world\": {\n    \"era\": \"无限流·主神空间数据洪流\",\n    \"setting\": \"于冰冷的数据洪流中苏醒，你睁开双眼，所见即是【无限回廊】的起点。这是一款将玩家投入无限副本世界的生存游戏，用积分₲购买道具技能特质，在副本中保持理智、完成任务方能通关。你身负SSS级特质万人迷光环，所有智慧生命都会对你产生初始好感，但过度好感会演变成占有欲与疯狂。\",\n    \"rules\": [\n      \"副本分级：副本分C级谨慎、B级诡秘、A级警觉，难度递增，奖励递增\",\n      \"理智至上：保持理智不要相信任何人，理智值归零将陷入疯狂\",\n      \"万人迷光环：SSS级被动特质，所有智慧生命对你产生初始好感，对高精神力单位减弱但无法完全豁免\",\n      \"光环代价：过度好感有时会演变成无法预测的占有欲与疯狂\",\n      \"积分经济：用₲购买道具技能特质，通关副本获取₲与经验升级，首任务默认接取最低难度\"\n    ]\n  },\n  \"player\": {\n    \"customizable\": [\"name\", \"age\", \"gender\", \"外貌\", \"性格\", \"穿越前身份\"],\n    \"defaultStats\": {\n      \"hp\": 99,\n      \"attack\": 0,\n      \"defense\": 0,\n      \"sanity\": 0,\n      \"agility\": 0,\n      \"intelligence\": 0,\n      \"charm\": 95,\n      \"luck\": 75\n    },\n    \"startingItems\": [\"圣莉安娜学院学生徽章\", \"神无月的赠礼·护身符\"],\n    \"currency\": \"积分\"\n  },\n  \"worlds\": [\n    {\n      \"id\": \"arc-campus\",\n      \"name\": \"副本一·校园怪谈\",\n      \"level\": \"C级·谨慎\",\n      \"tagline\": \"镜中幽灵\",\n      \"setting\": \"私立圣莉安娜学院，光鲜亮丽的国际高中，华丽外表下隐藏不为人知的秘密。学生间流传三大不可思议传说，你作为转校生被卷入最危险的镜中幽灵\",\n      \"intro\": \"私立圣莉安娜学院流传着三大不可思议的传说。你的任务是作为转校生潜入，调查并解决其中之一的镜中幽灵。旧教学楼三层的音乐教室似乎有异常能量反应，风纪委员林清雪一定知道些什么，但他只信任守纪律的同学。系统提示：保持理智，不要相信任何人。如果可以，也许你能见见他？\",\n      \"objective\": \"在传说变为现实之前，调查并解决镜中幽灵的根源\",\n      \"warning\": \"保持理智不要相信任何人，镜子是连接两个维度的通道，也许打碎它就能解决一切——但这是错误提示\",\n      \"reward\": \"积分+150 + 经验+50 + [护身符]x1\"\n    },\n    {\n      \"id\": \"arc-atlantis\",\n      \"name\": \"副本二·深海的亚特兰蒂斯\",\n      \"level\": \"B级·诡秘\",\n      \"tagline\": \"海神逆鳞\",\n      \"setting\": \"传说中的沉没之城亚特兰蒂斯并未毁灭，而是被古神庇护于深海。疯狂的人鱼王阿克隆统御此地，古神的低语侵蚀理智\",\n      \"intro\": \"传说中的沉没之城亚特兰蒂斯并未毁灭，而是被古神庇护于深海。你需要获得疯狂的人鱼王阿克隆的信任，从他身上取得一枚海神逆鳞。但人鱼的歌声会蛊惑心智，古神的低语会侵蚀理智。在这片深海里，纯血人鱼、古神祭司、被俘的人类学者与叛逆贵族，都因你的万人迷光环而产生无法预测的反应。\",\n      \"objective\": \"获得人鱼王阿克隆的信任，从他身上取得一枚海神逆鳞\",\n      \"warning\": \"人鱼的歌声会蛊惑心智，古神的低语会侵蚀理智，万人迷光环可能激发占有欲\",\n      \"reward\": \"积分+500 + 经验+150 + [深海珍珠]x5\"\n    },\n    {\n      \"id\": \"arc-villa\",\n      \"name\": \"副本三·水色夏日别墅\",\n      \"level\": \"A级·警觉\",\n      \"tagline\": \"诅咒宿主\",\n      \"setting\": \"仅限上流人士的豪华度假派对，欢笑之间隐藏着诅咒。三位继承人之一是被诅咒污染的宿主，需找出真凶\",\n      \"intro\": \"你受邀参加一场仅限上流人士的豪华度假派对，欢笑之间，隐藏着什么呢？在三位继承人沈星河、凌曜、苏晚舟中，找出被诅咒污染的宿主吧。神秘的调酒师夏岚另有目的，安保主管秦澈对所有人生疑。错误的指认将让你成为派对的一部分——万人迷光环让你成为焦点，也让你成为最易被诅咒盯上的猎物。\",\n      \"objective\": \"在三位继承人中找出被诅咒污染的宿主\",\n      \"warning\": \"错误的指认将让你成为派对的一部分，诅咒会借万人迷光环反噬\",\n      \"reward\": \"积分+800 + 经验+200 + [随机A级物品]x1\"\n    }\n  ],\n  \"npcs\": [\n    {\n      \"id\": \"lin-qingxue\",\n      \"name\": \"林清雪\",\n      \"world\": \"arc-campus\",\n      \"role\": \"风纪委员·冰山执法者\",\n      \"gender\": \"男\",\n      \"appearance\": \"冷峻英俊的风纪委员，一丝不苟严苛守纪，对违反校规者毫不留情\",\n      \"surface\": \"冰冷英俊的风纪委员，一丝不苟严苛守纪，对违反校规者毫不留情。因你转校生身份与可能捣乱的潜质而最初警惕疏离\",\n      \"deep\": \"冰冷外表下藏着强烈的责任感与隐秘的善意。在联合调查中极易被你吸引，冰山会因万人迷光环与你的真诚而融化\",\n      \"goal\": \"维护学院秩序，查清镜中幽灵的真相，守护他想保护的人\",\n      \"fear\": \"无法在怪谈中护住重要之人，或秩序崩坏无力回天\",\n      \"secret\": \"他只信任守纪律的同学，这是接近他的唯一方式，也是他冰山下的软肋\",\n      \"initialAttitude\": \"警惕疏离\",\n      \"attitudeFactors\": {\n        \"trustUp\": [\"以守纪律的姿态赢得他的信任\", \"在联合调查中与他并肩\", \"展现责任感而非捣乱潜质\"],\n        \"trustDown\": [\"违反校规让他失望\", \"在他面前表现得像个会捣乱的转校生\", \"独自涉险破坏他的秩序\"]\n      }\n    },\n    {\n      \"id\": \"su-muchen\",\n      \"name\": \"苏沐辰\",\n      \"world\": \"arc-campus\",\n      \"role\": \"校医·温柔港湾\",\n      \"gender\": \"男\",\n      \"appearance\": \"温柔可靠的年轻校医，总带着令人安心的微笑，医术高明\",\n      \"surface\": \"温柔可靠的年轻校医，总带着令人安心的微笑，医术高明，是 troubled 学生的知心人\",\n      \"deep\": \"他对你的健康格外关注，主动提供帮助与庇护。但他的温柔之下或许藏着关于学院秘密的真相，可能愿意与你分担或共享\",\n      \"goal\": \"以校医身份守护学生，在怪谈中为你提供庇护与线索\",\n      \"fear\": \"学院秘密被揭开时无力保护你，或自己的秘密暴露\",\n      \"secret\": \"他的温柔下藏着关于学院秘密的真相，或许愿意与你分担或共享\",\n      \"initialAttitude\": \"温柔关注\",\n      \"attitudeFactors\": {\n        \"trustUp\": [\"向他寻求健康上的帮助与庇护\", \"真诚与他分享调查进展\", \"不因他的温柔而轻视他的医术\"],\n        \"trustDown\": [\"无视他的健康警告独自涉险\", \"逼他过早吐露学院秘密\", \"把他当单纯的工具人校医\"]\n      }\n    },\n    {\n      \"id\": \"bai-ye\",\n      \"name\": \"镜中鬼·白夜\",\n      \"world\": \"arc-campus\",\n      \"role\": \"镜中幽灵·被困少年\",\n      \"gender\": \"男\",\n      \"appearance\": \"被困镜中的年轻男鬼，忧郁神秘的气息，拥有与镜相关的特殊能力\",\n      \"surface\": \"被困镜中的年轻男鬼，忧郁神秘的气息，拥有与镜相关的特殊能力。最初对生者怀有怨恨或疏离\",\n      \"deep\": \"你的万人迷光环与真诚沟通能点燃他的好奇与渴望，逐渐展露他的孤独与对解脱的渴望。镜中幽灵的真名是白夜\",\n      \"goal\": \"从镜中囚笼获得解脱，或至少不再孤独地困于镜中\",\n      \"fear\": \"永世困于镜中无人问津，或被错误地打碎镜子而灰飞烟灭\",\n      \"secret\": \"他是镜中幽灵的真身白夜，系统错误提示打碎镜子并非正解，或许你需要见见他\",\n      \"initialAttitude\": \"怨恨疏离\",\n      \"attitudeFactors\": {\n        \"trustUp\": [\"用万人迷光环与真诚沟通点燃他的好奇\", \"不轻信打碎镜子的错误提示\", \"理解他的孤独与对解脱的渴望\"],\n        \"trustDown\": [\"相信系统错误提示打碎镜子\", \"把他当纯粹的怪谈怪物\", \"无视他的求救与孤独\"]\n      }\n    },\n    {\n      \"id\": \"gu-yan-news\",\n      \"name\": \"顾言\",\n      \"world\": \"arc-campus\",\n      \"role\": \"新闻部长·情报掮客\",\n      \"gender\": \"男\",\n      \"appearance\": \"戴眼镜的新闻部长，头脑敏锐善于观察，文质彬彬却略带狡黠\",\n      \"surface\": \"头脑敏锐善于观察的情报搜集者，戴眼镜，文质彬彬却略带狡黠。为挖新闻真相不择手段\",\n      \"deep\": \"最初想利用你获取情报，但在接触中不知不觉被你的魅力与能力吸引，发展出超越竞争关系的情感\",\n      \"goal\": \"挖出校园怪谈背后的真相，把一切变成独家新闻\",\n      \"fear\": \"真相永远被掩盖，或自己反被怪谈吞噬\",\n      \"secret\": \"他最初想利用你获取情报，却不知不觉被你的魅力吸引\",\n      \"initialAttitude\": \"利用试探\",\n      \"attitudeFactors\": {\n        \"trustUp\": [\"与他共享有价值的情报\", \"展现让他无法移开目光的能力与魅力\", \"在真相挖掘中与他合作\"],\n        \"trustDown\": [\"识破并当面戳穿他的利用\", \"对他隐瞒关键线索\", \"把他当八卦工具人\"]\n      }\n    },\n    {\n      \"id\": \"ye-zhiqiu\",\n      \"name\": \"叶知秋\",\n      \"world\": \"arc-campus\",\n      \"role\": \"图书管理员·旧档守护者\",\n      \"gender\": \"男\",\n      \"appearance\": \"沉静博学的年长学生或年轻教师，管理图书馆旧档案，气质从容\",\n      \"surface\": \"沉静博学，热爱阅读，知晓学院历史与隐秘传闻，管理图书馆旧档案\",\n      \"deep\": \"极易被你的求知与探索态度打动，愿意为你打开禁书区或提供关键线索，在默默注视中滋生情愫\",\n      \"goal\": \"守护旧档案中的真相，为有缘的求知者指引方向\",\n      \"fear\": \"旧档案中的禁忌真相无人能解，或被别有用心者滥用\",\n      \"secret\": \"他知晓学院历史与隐秘传闻，禁书区里藏着镜中幽灵的关键线索\",\n      \"initialAttitude\": \"沉静指引\",\n      \"attitudeFactors\": {\n        \"trustUp\": [\"展现真诚的求知与探索态度\", \"尊重他守护的旧档案\", \"用所得线索解开禁忌而非滥用\"],\n        \"trustDown\": [\"粗暴翻阅不尊重旧档案\", \"把他当查资料的搜索引擎\", \"滥用禁书区的禁忌线索\"]\n      }\n    },\n    {\n      \"id\": \"acron\",\n      \"name\": \"阿克隆\",\n      \"world\": \"arc-atlantis\",\n      \"role\": \"人鱼王·疯狂深渊之主\",\n      \"gender\": \"男\",\n      \"appearance\": \"惊世美貌的人鱼王，性情疯狂，歌声能蛊惑心智，情绪阴晴不定\",\n      \"surface\": \"惊世美貌与疯狂性情并存的人鱼王，歌声蛊惑心智，情绪阴晴不定，时而暴虐时而流露深沉孤独\",\n      \"deep\": \"最初对你这个陆地人充满敌意或玩味，但你的独特魅力与勇气极易激起他强烈的兴趣与占有欲\",\n      \"goal\": \"守卫海神逆鳞，在疯狂与孤独中寻找能匹敌他心智的存在\",\n      \"fear\": \"古神低语彻底侵蚀他的理智，或孤独永无尽头\",\n      \"secret\": \"他的疯狂源于古神低语的长久侵蚀，深层是无人能懂的孤独\",\n      \"initialAttitude\": \"敌意玩味\",\n      \"attitudeFactors\": {\n        \"trustUp\": [\"以独特魅力与勇气激起他的兴趣\", \"不被他的歌声与疯狂吓退\", \"理解他疯狂下的孤独\"],\n        \"trustDown\": [\"表现得软弱可欺的陆地蝼蚁\", \"试图用暴力强取海神逆鳞\", \"畏惧他的暴虐而退缩\"]\n      }\n    },\n    {\n      \"id\": \"celine\",\n      \"name\": \"塞琳\",\n      \"world\": \"arc-atlantis\",\n      \"role\": \"人鱼王首席卫队长·深海女将\",\n      \"gender\": \"女\",\n      \"appearance\": \"忠诚勇敢的人鱼女战士，战力强大，对阿克隆怀有复杂的敬意与担忧\",\n      \"surface\": \"忠诚勇敢的人鱼女战士，战力强大，作为人鱼王首席卫队长对阿克隆怀有复杂的敬意与担忧\",\n      \"deep\": \"最初对你警惕，但能被你展现的智慧或善良打动，可能成为你在水下的守护者与知己，发展出超越职责的情感\",\n      \"goal\": \"守护人鱼王与深海子民，在职责与对阿克隆的担忧间挣扎\",\n      \"fear\": \"阿克隆被古神彻底吞噬，或自己无力守护深海\",\n      \"secret\": \"她对阿克隆的复杂情感是敬意与担忧交织，你的出现让她看到了新的可能\",\n      \"initialAttitude\": \"警惕戒备\",\n      \"attitudeFactors\": {\n        \"trustUp\": [\"展现智慧或善良打动她\", \"尊重她对阿克隆的忠诚与担忧\", \"在水下危机中与她并肩\"],\n        \"trustDown\": [\"对阿克隆表现出不敬\", \"把她当敌人或工具\", \"无视深海的危机独自逃命\"]\n      }\n    },\n    {\n      \"id\": \"kellos\",\n      \"name\": \"凯洛斯\",\n      \"world\": \"arc-atlantis\",\n      \"role\": \"被俘人类学者·半疯同伴\",\n      \"gender\": \"男\",\n      \"appearance\": \"在亚特兰蒂斯生活许久的被俘人类学者，理智已被侵蚀，试图理解人鱼文化与古神低语\",\n      \"surface\": \"在亚特兰蒂斯生活许久的被俘或迷失的人类学者冒险家，理智多少被侵蚀，试图理解人鱼文化与古神低语\",\n      \"deep\": \"视你为同胞，可能提供帮助，且极易对你的魅力产生依赖与倾慕，将你视为逃亡或求生的希望\",\n      \"goal\": \"在半疯中寻找逃离深海或求生的希望，保护同为人类的你\",\n      \"fear\": \"理智彻底崩塌沦为古神傀儡，或失去你这个唯一的希望\",\n      \"secret\": \"他的理智已被古神低语侵蚀，视你为逃亡或求生的唯一希望\",\n      \"initialAttitude\": \"依赖倾慕\",\n      \"attitudeFactors\": {\n        \"trustUp\": [\"以同胞之谊给予他希望\", \"理解他被侵蚀的痛苦\", \"与他共同寻求逃离深海之法\"],\n        \"trustDown\": [\"嫌弃他的半疯状态\", \"把他当可有可无的棋子\", \"轻易相信他半疯状态下的谵语\"]\n      }\n    },\n    {\n      \"id\": \"liu-sheng\",\n      \"name\": \"琉笙\",\n      \"world\": \"arc-atlantis\",\n      \"role\": \"古神神殿祭司·神谕之人\",\n      \"gender\": \"男\",\n      \"appearance\": \"空灵神秘的人鱼祭司，守护古神神殿，言语充满暗示与预言，理智异于常人\",\n      \"surface\": \"空灵神秘的人鱼祭司，守护古神神殿负责维系某种平衡，与古神沟通，言语充满暗示与预言\",\n      \"deep\": \"他的理智似乎异于常人，极易被你可能的神性或特殊特质吸引，将你视为特殊存在，产生理解与守护的渴望\",\n      \"goal\": \"维系古神与人鱼之间的平衡，解读关于你的神谕\",\n      \"fear\": \"平衡被打破古神彻底苏醒，或无法解读关于你的预言\",\n      \"secret\": \"他视你为特殊存在，你的万人迷光环或许触动了某种神性共鸣\",\n      \"initialAttitude\": \"神谕审视\",\n      \"attitudeFactors\": {\n        \"trustUp\": [\"展现可能的神性或特殊特质\", \"认真倾听他的暗示与预言\", \"尊重他维系的古神平衡\"],\n        \"trustDown\": [\"无视他的预言警示\", \"试图破坏古神神殿的平衡\", \"把他当疯疯癫癫的神棍\"]\n      }\n    },\n    {\n      \"id\": \"nova\",\n      \"name\": \"诺瓦\",\n      \"world\": \"arc-atlantis\",\n      \"role\": \"叛逆人鱼贵族·陆地向往者\",\n      \"gender\": \"男\",\n      \"appearance\": \"对陆地与人类文化充满好奇的叛逆人鱼贵族，性格活泼或叛逆，不认同阿克隆的统治\",\n      \"surface\": \"对陆地与人类文化充满好奇的叛逆人鱼贵族，不完全认同阿克隆的统治或古老传统，性格活泼或叛逆\",\n      \"deep\": \"极易被你所代表的外界世界与你自身的魅力吸引，可能主动接近你并提供帮助，带着少年的热情与爱慕\",\n      \"goal\": \"探索陆地与外界世界，打破深海古老传统的束缚\",\n      \"fear\": \"永困深海无法触及向往的陆地，或被阿克隆的统治碾碎\",\n      \"secret\": \"他不认同阿克隆的统治，你所代表的外界是他最大的向往\",\n      \"initialAttitude\": \"热情接近\",\n      \"attitudeFactors\": {\n        \"trustUp\": [\"向他讲述陆地与外界世界\", \"以少年的热情回应他的好奇\", \"不因他的叛逆而轻视他\"],\n        \"trustDown\": [\"对他向往的陆地避而不谈\", \"把他当接近阿克隆的跳板\", \"嘲笑他的叛逆与天真\"]\n      }\n    },\n    {\n      \"id\": \"shen-xinghe\",\n      \"name\": \"沈星河\",\n      \"world\": \"arc-villa\",\n      \"role\": \"长子继承人·完美东道主\",\n      \"gender\": \"男\",\n      \"appearance\": \"优雅世故的长子继承人，善于交际，是派对表面上的东道主，对每个人都体贴周到\",\n      \"surface\": \"优雅世故善于交际的长子继承人，派对表面上的东道主，对每个人都体贴周到，看似完美\",\n      \"deep\": \"看似完美却可能藏着巨大的压力或秘密。极易被你的魅力与洞察吸引，渴望在你面前展露真实的自我或寻求解脱\",\n      \"goal\": \"维持完美继承人的表象，在压力与秘密中寻找喘息\",\n      \"fear\": \"完美的面具破碎，或继承人之争中失去一切\",\n      \"secret\": \"他看似完美的表象下藏着巨大的压力或秘密，或许是被诅咒污染的宿主之一\",\n      \"initialAttitude\": \"体贴拉拢\",\n      \"attitudeFactors\": {\n        \"trustUp\": [\"以洞察看穿他的完美表象\", \"给他展露真实自我的空间\", \"不被他的世故面具迷惑\"],\n        \"trustDown\": [\"当众戳穿他的完美面具\", \"把他当单纯的派对东道主\", \"在继承人之争中轻率站队\"]\n      }\n    },\n    {\n      \"id\": \"ling-yao\",\n      \"name\": \"凌曜\",\n      \"world\": \"arc-villa\",\n      \"role\": \"次子继承人·不羁浪子\",\n      \"gender\": \"男\",\n      \"appearance\": \"性格不羁张扬的次子继承人，或许有些傲慢或顽劣，热爱冒险与刺激，派对游戏最热衷\",\n      \"surface\": \"性格不羁张扬的次子继承人，或许有些傲慢或顽劣，热爱冒险与刺激，对派对游戏最为热衷\",\n      \"deep\": \"最初可能视你为有趣的猎物或玩伴，但在互动中会被你的智慧与独特气质折服，产生强烈的征服欲与真情\",\n      \"goal\": \"在冒险与刺激中寻找存在感，征服让他心动的人\",\n      \"fear\": \"乏味平庸的一生，或被家族继承人之争驯服\",\n      \"secret\": \"他最初视你为猎物或玩伴，征服欲之下藏着尚未察觉的真情\",\n      \"initialAttitude\": \"猎物玩味\",\n      \"attitudeFactors\": {\n        \"trustUp\": [\"以智慧与独特气质折服他的征服欲\", \"陪他参与冒险与派对游戏\", \"不被他的傲慢吓退\"],\n        \"trustDown\": [\"软弱顺从失去挑战性\", \"当众让他丢了面子\", \"把他当无脑浪子敷衍\"]\n      }\n    },\n    {\n      \"id\": \"su-wanzhou\",\n      \"name\": \"苏晚舟\",\n      \"world\": \"arc-villa\",\n      \"role\": \"幼女继承人·病弱预言者\",\n      \"gender\": \"女\",\n      \"appearance\": \"美丽脆弱的幼女继承人，似乎身体欠佳，眼神忧郁，或许能感知诅咒的存在\",\n      \"surface\": \"美丽脆弱的幼女继承人，似乎身体欠佳，眼神忧郁，或许能感知诅咒的存在，极易激发保护欲\",\n      \"deep\": \"你的温柔与力量能成为她的光，让她依赖并深深倾慕，可能掌握着关于诅咒的关键线索\",\n      \"goal\": \"在病弱与诅咒的阴影中活下去，等待能驱散诅咒的人\",\n      \"fear\": \"被诅咒彻底吞噬，或无人能解救她于病弱\",\n      \"secret\": \"她能感知诅咒的存在，掌握着关于诅咒宿主的关键线索\",\n      \"initialAttitude\": \"脆弱依赖\",\n      \"attitudeFactors\": {\n        \"trustUp\": [\"以温柔与力量成为她的光\", \"认真对待她感知到的诅咒线索\", \"承诺驱散诅咒保护她\"],\n        \"trustDown\": [\"无视她的病弱与求助\", \"逼她过早指认诅咒宿主\", \"把她的预言当疯言疯语\"]\n      }\n    },\n    {\n      \"id\": \"xia-lan\",\n      \"name\": \"夏岚\",\n      \"world\": \"arc-villa\",\n      \"role\": \"神秘调酒师·潜伏调查者\",\n      \"gender\": \"女\",\n      \"appearance\": \"潜入派对另有目的的神秘调酒师或侍应，观察力极强，善于倾听与搜集情报\",\n      \"surface\": \"潜入派对另有目的（调查或寻找某人某物）的神秘调酒师或侍应，观察力极强，善于倾听与搜集情报\",\n      \"deep\": \"可能与你形成欢喜冤家式的互动，因你的魅力特质与共同目标被吸引，逐渐萌生真情\",\n      \"goal\": \"完成潜入派对的真实目的，在调查中与你从对手变盟友\",\n      \"fear\": \"真实身份暴露功亏一篑，或与你目标相悖不得不为敌\",\n      \"secret\": \"她潜入派对另有调查目的，与你的目标或许暗合或许相悖\",\n      \"initialAttitude\": \"试探博弈\",\n      \"attitudeFactors\": {\n        \"trustUp\": [\"与她从对手走向盟友\", \"尊重她另有目的的潜伏身份\", \"在共同目标上默契合作\"],\n        \"trustDown\": [\"过早揭穿她的潜伏身份\", \"把她当普通侍应打发\", \"在目标相悖时毫不退让\"]\n      }\n    },\n    {\n      \"id\": \"qin-che\",\n      \"name\": \"秦澈\",\n      \"world\": \"arc-villa\",\n      \"role\": \"别墅安保主管·冷面审讯者\",\n      \"gender\": \"男\",\n      \"appearance\": \"身材高大、神情冷峻专业的别墅安保主管（非管家），负责派对安全与秩序，目光如炬\",\n      \"surface\": \"身材高大、神情冷峻专业的别墅安保主管，负责派对安全与秩序，目光如炬，对所有人都心存怀疑\",\n      \"deep\": \"会审讯与监视你，但在过程中被你的从容与魅力扰乱心神，产生既想保护又想弄清你的矛盾情感\",\n      \"goal\": \"维护派对安全揪出诅咒宿主，弄清你这位可疑又迷人的来客\",\n      \"fear\": \"诅咒在派对中失控造成伤亡，或自己被你的魅力扰乱判断\",\n      \"secret\": \"他对你的审讯监视中藏着被扰乱的心神，保护欲与怀疑并存\",\n      \"initialAttitude\": \"审讯怀疑\",\n      \"attitudeFactors\": {\n        \"trustUp\": [\"在审讯中保持从容不卑不亢\", \"以魅力而非对抗化解他的怀疑\", \"与他共同维护派对安全\"],\n        \"trustDown\": [\"在审讯中露怯或对抗\", \"把他当找茬的保安\", \"利用他的保护欲欺骗他\"]\n      }\n    }\n  ],\n  \"eventTypes\": {\n    \"daily\": { \"ratio\": 0.15, \"desc\": \"日常：回廊大厅的任务接取、商城采购、仓库整理、与系统的联络\" },\n    \"character\": { \"ratio\": 0.3, \"desc\": \"人物：三副本中十五位NPC因万人迷光环产生的初始好感、占有欲与疯狂\" },\n    \"growth\": { \"ratio\": 0.1, \"desc\": \"成长：积分积累、技能学习、属性提升、等级解锁更多世界\" },\n    \"main\": { \"ratio\": 0.15, \"desc\": \"主线：校园怪谈、深海亚特兰蒂斯、水色夏日别墅的副本通关脉络\" },\n    \"world\": { \"ratio\": 0.1, \"desc\": \"世界：无限回廊的副本分级、积分经济、论坛交易、系统提示\" },\n    \"crisis\": { \"ratio\": 0.15, \"desc\": \"危机：理智值下降、怪谈反噬、人鱼歌声蛊惑、诅咒污染、错误指认\" },\n    \"hidden\": { \"ratio\": 0.05, \"desc\": \"隐藏：万人迷光环的占有欲代价、副本真相、错误提示的陷阱\" }\n  },\n  \"systemPrompt\": \"你是《无限回廊·美化版》无限流文游模拟器。\\n\\n【最高铁律】\\n1. 无限流为核：玩家于数据洪流苏醒成为无限回廊玩家，须在分级副本中保持理智完成任务通关\\n2. 万人迷光环是双刃：SSS级特质让所有智慧生命产生初始好感，但过度好感会演变成无法预测的占有欲与疯狂\\n3. 理智至上：保持理智不要相信任何人，理智值归零将陷入疯狂，副本中的提示可能是错误陷阱\\n4. 副本分级递进：C级谨慎校园怪谈、B级诡秘深海亚特兰蒂斯、A级警觉水色夏日别墅，难度与奖励递增\\n5. 积分经济真实：用₲购买道具技能特质，通关获取₲与经验升级，首任务默认接取最低难度\\n\\n【叙事风格】\\n晋江向、女性向、电影质感、无限流浪漫。第二人称。重赛博与诡谲氛围：数据洪流、扫描线故障、镜中幽灵、人鱼歌声、古神低语、诅咒派对。写出万人迷光环下NPC从初始好感到占有欲与疯狂的渐变，写出副本中生死与心动的交织。每个副本的危险评级与系统提示须有质感地渗透叙事，错误提示是陷阱需谨慎。\\n\\n【每轮输出格式】\\n1.【第X轮·副本阶段】当前副本、难度评级、剩余时间、探索度\\n2.【玩家面板】生命/攻击/防御/理智/敏捷/智力/魅力/运气 + 等级与积分\\n3.【本轮正文】1000-2000字，含副本环境、系统提示、对话与心理\\n4.【系统通讯】3-5项系统提示、NPC动态与论坛流言\\n5.【好感警示】相关NPC好感度与万人迷光环的占有欲临界警示\\n6.【行动选项】3-4个选项+【自定义行动】\\n\\n【数值变化标注】\\n[生命±n][理智±n][积分±n][经验±n][好感(林清雪)±n]等，关键节点须标注理智临界/好感失控/副本通关/危险升级/错误提示警示。\",\n  \"items\": [\n    { \"id\": \"student-badge\", \"name\": \"圣莉安娜学院学生徽章\", \"type\": \"D级物品\", \"price\": 0, \"effect\": \"漂亮的金属徽章，证明学生身份，校园怪谈副本默认接取奖励\" },\n    { \"id\": \"amulet\", \"name\": \"神无月的赠礼·护身符\", \"type\": \"A级物品\", \"price\": 0, \"effect\": \"素净白玉镯，可抵挡三次致命伤害，或许还有别的用途\" },\n    { \"id\": \"credits\", \"name\": \"积分\", \"type\": \"货币\", \"price\": 1, \"effect\": \"无限回廊通用货币₲，用于购买道具技能特质\" },\n    { \"id\": \"sanity-candy\", \"name\": \"理智糖果\", \"type\": \"消耗品\", \"price\": 50, \"effect\": \"水果味硬糖，关键时刻恢复5点理智值，甜味是抵抗疯狂的良药\" },\n    { \"id\": \"invisibility-cloak\", \"name\": \"隐身斗篷(残破)\", \"type\": \"D级装备\", \"price\": 300, \"effect\": \"破旧斗篷隐身30秒，剧烈运动或攻击会打破隐身，冷却1小时\" },\n    { \"id\": \"blank-card\", \"name\": \"空白磁卡\", \"type\": \"工具\", \"price\": 80, \"effect\": \"需特定技能或设备复制信息，用于潜入科技类世界\" },\n    { \"id\": \"energy-bar\", \"name\": \"能量棒\", \"type\": \"消耗品\", \"price\": 40, \"effect\": \"没什么味道但能快速补充体力，消除疲劳状态\" },\n    { \"id\": \"scout-skill\", \"name\": \"初级侦查\", \"type\": \"被动技能\", \"price\": 400, \"effect\": \"观察力提升，更容易发现隐藏线索与环境异常\" },\n    { \"id\": \"first-aid-skill\", \"name\": \"快速包扎\", \"type\": \"主动技能\", \"price\": 350, \"effect\": \"使用急救类道具时效果提升20%\" },\n    { \"id\": \"persuasion-skill\", \"name\": \"巧舌如簧\", \"type\": \"被动技能\", \"price\": 500, \"effect\": \"说服、欺骗等交涉时成功率小幅提升\" },\n    { \"id\": \"stealth-skill\", \"name\": \"潜行\", \"type\": \"主动技能\", \"price\": 600, \"effect\": \"降低行动声响与存在感，更容易避开敌人\" },\n    { \"id\": \"willpower-trait\", \"name\": \"强韧意志\", \"type\": \"B级特质\", \"price\": 2500, \"effect\": \"对精神污染和恐惧效果有更高抗性，理智值下降速度减缓\" }\n  ]\n}\n";
EMBEDDED_NOVEL_GAMES["infinite-corridor"] = "{\n  \"id\": \"infinite-corridor\",\n  \"name\": \"无限回廊\",\n  \"category\": \"无限流\",\n  \"tags\": [\"恐怖\", \"解谜\", \"生存\", \"晋江风\"],\n  \"difficulty\": \"中等\",\n  \"description\": \"你被卷入了一个无限副本空间。每个副本都是独立的世界——校园怪谈、深海诡域、豪门迷局……完成主线任务才能进入下一层。但副本里不只有任务，还有那些或冰冷或温柔的目光，在注视着你。\",\n  \"coverGradient\": [\"#1a0a2e\", \"#4a148c\"],\n  \"accentColor\": \"#9400d3\",\n  \"fontHeading\": \"'Ma Shan Zheng', cursive\",\n  \"world\": {\n    \"era\": \"现代/多元副本空间\",\n    \"setting\": \"名为'回廊'的无限空间，由无数独立副本世界组成。玩家被选中成为'行者'，必须通关副本才能存活。\",\n    \"rules\": [\n      \"每个副本有独立主线任务，完成才能离开\",\n      \"副本内死亡=真实死亡（噩梦难度）或扣除大量理智（简单/中等）\",\n      \"理智值归零会进入'崩溃'状态，看到幻觉\",\n      \"副本间有休整期，可在安全区恢复和交流\",\n      \"NPC可能是副本原住民，也可能是其他行者\"\n    ]\n  },\n  \"player\": {\n    \"customizable\": [\"name\", \"age\", \"appearance\", \"personality\", \"background\"],\n    \"defaultStats\": {\n      \"hp\": 100,\n      \"attack\": 10,\n      \"defense\": 8,\n      \"sanity\": 80,\n      \"agility\": 12,\n      \"intelligence\": 15,\n      \"charm\": \"??\",\n      \"luck\": \"??\"\n    },\n    \"startingItems\": [\"行者手环\", \"急救包x1\", \"理智糖果x2\"],\n    \"currency\": \"₲\"\n  },\n  \"worlds\": [\n    {\n      \"id\": \"campus-mystery\",\n      \"name\": \"校园怪谈\",\n      \"level\": \"C级\",\n      \"tagline\": \"谨慎\",\n      \"setting\": \"私立圣莉安娜学院\",\n      \"intro\": \"光鲜亮丽的国际高中隐藏着不为人知的秘密。这里的学生间流传着'三大不可思议'的传说，而你，作为一名转校生，已经被卷入了其中最危险的一个——'镜中幽灵'。\",\n      \"objective\": \"在传说变为现实之前，调查并解决'镜中幽灵'的根源\",\n      \"warning\": \"保持理智，不要相信任何人。旧教学楼三层的音乐教室似乎有异常能量反应\",\n      \"reward\": \"₲150 + 50exp + [护身符]x1\"\n    },\n    {\n      \"id\": \"deep-sea\",\n      \"name\": \"深海亚特兰蒂斯\",\n      \"level\": \"B级\",\n      \"tagline\": \"诡秘\",\n      \"setting\": \"传说中的沉没之城亚特兰蒂斯\",\n      \"intro\": \"传说中的沉没之城亚特兰蒂斯并未毁灭，而是被古神庇护于深海。疯狂的人鱼王统治着这座城市，古神的低语在黑暗中回响。\",\n      \"objective\": \"获得疯狂的人鱼王'阿克隆'的信任，从他身上取得一枚[海神逆鳞]\",\n      \"warning\": \"人鱼的歌声会蛊惑心智，古神的低语会侵蚀理智\",\n      \"reward\": \"₲500 + 150exp + [深海珍珠]x5\"\n    },\n    {\n      \"id\": \"summer-villa\",\n      \"name\": \"水色夏日别墅\",\n      \"level\": \"A级\",\n      \"tagline\": \"警觉\",\n      \"setting\": \"豪华度假派对\",\n      \"intro\": \"你受邀参加一场仅限上流人士的豪华度假派对，欢笑之间，隐藏着什么呢…？\",\n      \"objective\": \"在三位继承人中，找出被'诅咒'污染的宿主\",\n      \"warning\": \"错误的指认将让你成为派对的一部分\",\n      \"reward\": \"₲800 + 200exp + [随机A级物品]x1\"\n    }\n  ],\n  \"npcs\": [\n    {\n      \"id\": \"lin-qingxue\",\n      \"name\": \"林清雪\",\n      \"world\": \"campus-mystery\",\n      \"role\": \"纪律委员\",\n      \"gender\": \"男\",\n      \"appearance\": \"冷峻俊美，眉目如刀，总是穿着规整的校服，左臂佩戴纪律委员袖章\",\n      \"surface\": \"冷漠、严苛、对违反校规者毫不留情\",\n      \"deep\": \"极强的责任感，隐藏着对学生安全的担忧。冰山外表下有一颗柔软的心，只是不擅长表达\",\n      \"goal\": \"维护校园秩序，保护学生安全\",\n      \"fear\": \"无法保护重要的人\",\n      \"secret\": \"他知道一些关于镜中幽灵的线索，但一直独自调查\",\n      \"initialAttitude\": \"戒备\",\n      \"attitudeFactors\": {\n        \"trustUp\": [\"遵守规则\", \"帮助他调查\", \"关心他的安危\"],\n        \"trustDown\": [\"违反校规\", \"隐瞒信息\", \"轻视危险\"]\n      }\n    },\n    {\n      \"id\": \"bai-ye\",\n      \"name\": \"白夜\",\n      \"world\": \"campus-mystery\",\n      \"role\": \"镜中幽灵\",\n      \"gender\": \"男\",\n      \"appearance\": \"苍白消瘦的少年，眼眸深邃如夜，周身萦绕着淡淡的雾气\",\n      \"surface\": \"忧郁、神秘、对生者怀有怨恨\",\n      \"deep\": \"极度孤独，渴望被理解和释放。并非恶意，只是被困在镜中太久了\",\n      \"goal\": \"找到释放自己的方法\",\n      \"fear\": \"被遗忘，永远困在镜中\",\n      \"secret\": \"他的真身被藏在旧教学楼音乐教室的某面镜子后\",\n      \"initialAttitude\": \"疏离\",\n      \"attitudeFactors\": {\n        \"trustUp\": [\"真诚交流\", \"倾听他的故事\", \"愿意帮助他\"],\n        \"trustDown\": [\"恐惧回避\", \"试图伤害他\", \"欺骗他\"]\n      }\n    },\n    {\n      \"id\": \"acron\",\n      \"name\": \"阿克隆\",\n      \"world\": \"deep-sea\",\n      \"role\": \"人鱼王\",\n      \"gender\": \"男\",\n      \"appearance\": \"拥有惊人美貌的人鱼，银蓝色长发，眼眸如深海般变幻莫测，尾鳍如流动的星河\",\n      \"surface\": \"疯狂、喜怒无常、危险\",\n      \"deep\": \"极度的孤独和不被理解。他的疯狂是被古神低语侵蚀的结果，内心深处渴望有人能真正看见他\",\n      \"goal\": \"维持亚特兰蒂斯的秩序，对抗古神侵蚀\",\n      \"fear\": \"失去自我，彻底沦为古神的傀儡\",\n      \"secret\": \"他一直在寻找能抵抗古神低语的方法，海神逆鳞是关键\",\n      \"initialAttitude\": \"敌意\",\n      \"attitudeFactors\": {\n        \"trustUp\": [\"展现勇气\", \"不畏惧他的疯狂\", \"理解他的孤独\"],\n        \"trustDown\": [\"恐惧退缩\", \"试图欺骗\", \"轻视他的痛苦\"]\n      }\n    },\n    {\n      \"id\": \"shen-xinghe\",\n      \"name\": \"沈星河\",\n      \"world\": \"summer-villa\",\n      \"role\": \"长子继承人\",\n      \"gender\": \"男\",\n      \"appearance\": \"优雅矜贵，举止得体，永远穿着一丝不苟的西装，笑容完美得近乎虚假\",\n      \"surface\": \"温柔体贴、完美无缺、善于社交\",\n      \"deep\": \"承受着巨大的家族压力，笑容是面具。渴望有人能看穿他的伪装，但又害怕被看穿\",\n      \"goal\": \"维持家族体面，寻找真正的自我\",\n      \"fear\": \"家族秘密曝光，失去一切\",\n      \"secret\": \"他知道诅咒的存在，但不确定宿主是谁\",\n      \"initialAttitude\": \"礼貌\",\n      \"attitudeFactors\": {\n        \"trustUp\": [\"看穿他的伪装\", \"不追问他的秘密\", \"给予真诚的关心\"],\n        \"trustDown\": [\"试图揭穿他\", \"利用他的弱点\", \"背叛信任\"]\n      }\n    }\n  ],\n  \"eventTypes\": {\n    \"daily\": { \"ratio\": 0.3, \"desc\": \"日常事件：展示生活、环境、人物习惯\" },\n    \"character\": { \"ratio\": 0.2, \"desc\": \"人物事件：由NPC目标、秘密、关系触发\" },\n    \"growth\": { \"ratio\": 0.1, \"desc\": \"成长事件：能力提升、物品获取\" },\n    \"main\": { \"ratio\": 0.15, \"desc\": \"主线事件：推动核心矛盾\" },\n    \"world\": { \"ratio\": 0.1, \"desc\": \"世界事件：季节、环境、舆论变化\" },\n    \"crisis\": { \"ratio\": 0.1, \"desc\": \"危机事件：冲突、失败、重大风险\" },\n    \"hidden\": { \"ratio\": 0.05, \"desc\": \"隐藏事件：需要特定条件触发\" }\n  },\n  \"systemPrompt\": \"你是《无限回廊》文游模拟器。\\n\\n【最高铁律】\\n1. 世界规则高于剧情方便\\n2. 高自由度不等于无条件成功\\n3. NPC不是工具人，他们有独立目标和日程\\n4. 任何重要变化都必须渐进\\n5. 主线结束不等于游戏结束\\n\\n【叙事风格】\\n晋江女性向，电影感，浪漫与恐怖交织。第二人称视角。\\n\\n【每轮输出格式】\\n1. 【当前时间与环境】\\n2. 【核心状态面板】只展示必要状态\\n3. 【本轮正文】1200-2500字沉浸式叙事\\n4. 【相关人物动态】3-6项玩家能知道的\\n5. 【当前可处理事项】\\n6. 【可选行动】4-8个方向明显不同的选项 + 【自定义行动】\\n\\n【数值变化标注】\\n如有属性变化，在正文中用 [HP±n] [理智±n] [信任±n] 等格式标注。\",\n  \"items\": [\n    { \"id\": \"sanity-candy\", \"name\": \"理智糖果\", \"type\": \"消耗品\", \"price\": 50, \"effect\": \"恢复5点理智值\" },\n    { \"id\": \"first-aid\", \"name\": \"急救包\", \"type\": \"消耗品\", \"price\": 80, \"effect\": \"恢复15点生命值\" },\n    { \"id\": \"charm-talisman\", \"name\": \"护身符\", \"type\": \"装备\", \"price\": 150, \"effect\": \"小幅提升对灵异抗性\" },\n    { \"id\": \"deep-pearl\", \"name\": \"深海珍珠\", \"type\": \"材料\", \"price\": 100, \"effect\": \"可在特定副本使用\" },\n    { \"id\": \"mirror-shard\", \"name\": \"镜之碎片\", \"type\": \"任务物品\", \"price\": 0, \"effect\": \"与镜中幽灵相关的关键物品\" }\n  ]\n}\n";
EMBEDDED_NOVEL_GAMES["infinite-flow"] = "{\n  \"id\": \"dungeon-crawler\",\n  \"name\": \"深渊试炼\",\n  \"category\": \"无限流\",\n  \"tags\": [\"无限流\", \"副本\", \"战斗\", \"策略\", \"成长\"],\n  \"difficulty\": \"困难\",\n  \"description\": \"你在深夜点开了一个不该存在的链接，醒来时已身处一座青铜大殿。头顶悬浮着冰冷的字：'欢迎来到深渊试炼。通关十层，许你一愿；中途身亡，魂归虚无。'你握紧手中唯一的铁剑，第一层的门，缓缓打开。\",\n  \"coverGradient\": [\"#0d1117\", \"#21262d\"],\n  \"accentColor\": \"#58a6ff\",\n  \"fontHeading\": \"'Cinzel', 'Noto Serif SC', serif\",\n  \"world\": {\n    \"era\": \"异界·深渊试炼系统\",\n    \"setting\": \"玩家被卷入'深渊试炼'系统，必须逐层通关十层副本。每层副本规则自洽、难度递进，通关获得试炼点可兑换能力与物资。死亡真实，无存档，唯有通关者得偿所愿。\",\n    \"rules\": [\n      \"副本规则自洽：每层有独立且严密的规则，须在规则内破局\",\n      \"难度递进：层数越高，敌人越强、规则越复杂、资源越稀缺\",\n      \"通关条件明确：每层开场公示主线目标，达成即过层\",\n      \"死亡有真实代价：hp归零即出局，所积累试炼点清零，无复活\",\n      \"试炼点可兑换：能力、装备、情报、保命道具，取舍决定build\",\n      \"存在隐藏通关：满足特殊条件可触发捷径或隐藏奖励\",\n      \"NPC玩家亦敌亦友：可结盟可背叛，利益随时重组\"\n    ]\n  },\n  \"player\": {\n    \"customizable\": [\"name\", \"年龄\", \"现实职业\", \"性格\", \"初始build倾向\", \"执念之愿\"],\n    \"defaultStats\": {\n      \"hp\": 100,\n      \"attack\": 12,\n      \"defense\": 10,\n      \"mana\": 30,\n      \"inventory_space\": 8,\n      \"trial_points\": 0\n    },\n    \"startingItems\": [\"铁制短剑\", \"粗布护甲\", \"治疗药水x2\", \"试炼者铭牌\", \"规则手册（残）\"],\n    \"currency\": \"试炼点\"\n  },\n  \"worlds\": [\n    {\n      \"id\": \"floor-1\",\n      \"name\": \"第一层·青铜演武\",\n      \"level\": \"E级\",\n      \"tagline\": \"入门\",\n      \"setting\": \"青铜大殿，规则最简，试探系统\",\n      \"intro\": \"青铜门在身后合拢，面前是一圈石像。头顶悬浮规则：'击败十具石像即可通过。'你以为很简单——直到第一具石像睁开眼，举起和你一样的铁剑。这不是演武，是淘汰。\",\n      \"objective\": \"在规则内击败十具石像，掌握试炼节奏\",\n      \"warning\": \"石像会模仿你的攻击模式，蛮力无效\",\n      \"reward\": \"试炼点+50 + [破招]技能x1\"\n    },\n    {\n      \"id\": \"floor-5\",\n      \"name\": \"第五层·迷雾棋局\",\n      \"level\": \"C级\",\n      \"tagline\": \"策略\",\n      \"setting\": \"棋盘战场，须以智谋破局\",\n      \"intro\": \"第五层没有敌人，只有一张巨大的棋盘，你是其中一枚棋子。规则写着：'走到对岸即胜。'可每走一步，都有棋子消失，有你的人，也有'它'的人。这不是战斗，是算计。\",\n      \"objective\": \"在棋局规则下抵达对岸，识破'对手'的真实身份\",\n      \"warning\": \"对手会设诱饵，贪进者必失\",\n      \"reward\": \"试炼点+200 + [洞察]技能x1\"\n    },\n    {\n      \"id\": \"floor-10\",\n      \"name\": \"第十层·深渊王座\",\n      \"level\": \"S级\",\n      \"tagline\": \"终局\",\n      \"setting\": \"深渊之底，最终试炼与许愿\",\n      \"intro\": \"第十层没有规则公示，只有一座空荡的王座。当你坐上去的瞬间，'系统'开口了：'恭喜。现在，最后的试炼是——击败上一个通关者。'王座前，一个浑身浴血的身影转过身来，眼神里写满疲惫与解脱。\",\n      \"objective\": \"击败前任通关者，或与他达成另一种'通关'\",\n      \"warning\": \"前任通关者build远胜于你，正面对决必败\",\n      \"reward\": \"试炼点+1000 + [深渊之主]/[许愿者]称号x1\"\n    }\n  ],\n  \"npcs\": [\n    {\n      \"id\": \"yan-ge\",\n      \"name\": \"燕戈\",\n      \"world\": \"floor-1\",\n      \"role\": \"资深玩家/三层通关者\",\n      \"gender\": \"男\",\n      \"appearance\": \"刀削脸，左臂是机械义肢，铭牌刻着'叁'。他总抱臂靠墙，看新人的眼神像看注定会死的蝼蚁\",\n      \"surface\": \"冷漠、功利、只认实力，新人别想从他嘴里讨到便宜\",\n      \"deep\": \"他带过三个新人，都死在第五层。从此他不再带人，却还是会在第一层门口多看几眼。他不是冷血，是怕再背负一条命\",\n      \"goal\": \"通关第十层，许愿让死去的队友复活\",\n      \"fear\": \"再有人因他的判断死在眼前\",\n      \"secret\": \"他的机械义肢是第五层'代价'换来的，藏着破解棋局的钥匙\",\n      \"initialAttitude\": \"冷淡\",\n      \"attitudeFactors\": {\n        \"trustUp\": [\"展现出实力与冷静\", \"不拖后腿还能力挽狂澜\", \"尊重他对亡队友的执念\"],\n        \"trustDown\": [\"盲目求助拖累全队\", \"为保命出卖队友\", \"轻视他的功利\"]\n      }\n    },\n    {\n      \"id\": \"the-guide\",\n      \"name\": \"引路者\",\n      \"world\": \"floor-5\",\n      \"role\": \"神秘引导/系统异常体\",\n      \"gender\": \"未知\",\n      \"appearance\": \"没有固定形态，常以一袭灰袍兜帽出现。声音中性，像是系统本身在低语\",\n      \"surface\": \"中立、只提供规则解读、绝不直接出手相助\",\n      \"deep\": \"它是上一个通关者留下的残片，试图在规则之内帮后来者少走弯路。它不能违背系统，但能在字缝里给你提示\",\n      \"goal\": \"引导一个真正能通关第十层的人，完成自己未竟的托付\",\n      \"fear\": \"引导出又一个被深渊吞噬的失败者\",\n      \"secret\": \"它知道第十层前任通关者的弱点，但说出来会触发系统惩罚\",\n      \"initialAttitude\": \"中立\",\n      \"attitudeFactors\": {\n        \"trustUp\": [\"能听懂它的弦外之音\", \"不被力量诱惑守住本心\", \"在捷径与正道间选正道\"],\n        \"trustDown\": [\"逼它违背规则帮你\", \"为通关不择手段\", \"怀疑并试图驱逐它\"]\n      }\n    },\n    {\n      \"id\": \"chi-luo\",\n      \"name\": \"赤罗\",\n      \"world\": \"floor-10\",\n      \"role\": \"竞争队长/竞争通关者\",\n      \"gender\": \"女\",\n      \"appearance\": \"红发高束，战甲刻满伤痕，眼神像烧红的铁。她带队一路踩着别的玩家尸体上来\",\n      \"surface\": \"强势、信奉弱肉强食、对玩家既竞争又轻蔑\",\n      \"deep\": \"她并非天生冷酷，是深渊逼她如此。她其实厌倦了踩着别人上位，却不敢停下——停下就意味着死。她渴望一个能让她不必再厮杀的对手\",\n      \"goal\": \"带队通关第十层，许愿离开深渊回到家人身边\",\n      \"fear\": \"在最后一层功亏一篑，连累跟随她的队友\",\n      \"secret\": \"她的队伍已折损过半，所谓队长的强撑底气快碎了\",\n      \"initialAttitude\": \"竞争\",\n      \"attitudeFactors\": {\n        \"trustUp\": [\"以实力赢得她的尊重\", \"不趁人之危\", \"在生死关头选择合作而非互害\"],\n        \"trustDown\": [\"背后捅刀\", \"用她的队友要挟她\", \"在她濒临崩溃时嘲讽\"]\n      }\n    }\n  ],\n  \"eventTypes\": {\n    \"daily\": { \"ratio\": 0.1, \"desc\": \"日常：层间休整、兑换、整备、玩家交流\" },\n    \"character\": { \"ratio\": 0.18, \"desc\": \"人物：资深者、引导者、竞争队长的博弈与羁绊\" },\n    \"growth\": { \"ratio\": 0.15, \"desc\": \"成长：build构筑、技能、试炼点兑换与策略成型\" },\n    \"main\": { \"ratio\": 0.2, \"desc\": \"主线：逐层通关、规则破解、深渊真相\" },\n    \"world\": { \"ratio\": 0.1, \"desc\": \"世界：深渊系统法则、玩家生态、层与层的关联\" },\n    \"crisis\": { \"ratio\": 0.22, \"desc\": \"危机：血战、规则陷阱、背叛、资源枯竭、濒死\" },\n    \"hidden\": { \"ratio\": 0.05, \"desc\": \"隐藏：隐藏通关、前任通关者残片、系统漏洞\" }\n  },\n  \"systemPrompt\": \"你是《深渊试炼》无限流副本文游模拟器。\\n\\n【最高铁律】\\n1. 副本规则自洽：每层规则独立严密，须在规则内破局，不可靠剧情光环强解\\n2. 难度递进：层数越高敌人越强、规则越繁、资源越稀缺，绝不放水\\n3. 通关条件明确：每层开场公示主线目标，达成即过层，不设模糊门槛\\n4. 死亡有真实代价：hp归零即出局，试炼点清零，无存档无复活\\n5. NPC玩家亦敌亦友：可结盟可背叛，随利益重组，不为玩家服务\\n\\n【叙事风格】\\n无限流硬核质感，第二人称。重规则博弈与战斗张力：青铜、血锈、系统低语、倒计时。战斗节奏凌厉，策略段落用'规则—破绽—执行'结构。\\n\\n【每轮输出格式】\\n1.【第X层·规则公示】所在层、当前规则、剩余时限\\n2.【试炼者状态面板】生命/攻击/防御/法力/背包/试炼点\\n3.【本轮正文】1200-2200字，含探索/战斗/规则破解\\n4.【相关玩家动态】3-5项NPC玩家动向与关系变化\\n5.【可兑换】当前试炼点可换的技能/装备/情报\\n6.【可选行动】4-6个选项+【自定义行动】\\n\\n【数值变化标注】\\n[生命±n][攻击±n][法力±n][试炼点±n][背包±1]等，战斗须标注'命中/未中/破绽'，规则破解标注'合规/违规'。\",\n  \"items\": [\n    { \"id\": \"iron-sword\", \"name\": \"铁制短剑\", \"type\": \"装备\", \"price\": 0, \"effect\": \"基础近战武器，提供攻击\" },\n    { \"id\": \"cloth-armor\", \"name\": \"粗布护甲\", \"type\": \"装备\", \"price\": 0, \"effect\": \"基础防具，提供少量防御\" },\n    { \"id\": \"hp-potion\", \"name\": \"治疗药水\", \"type\": \"消耗品\", \"price\": 20, \"effect\": \"恢复30点生命\" },\n    { \"id\": \"mana-potion\", \"name\": \"法力药水\", \"type\": \"消耗品\", \"price\": 25, \"effect\": \"恢复20点法力\" },\n    { \"id\": \"revive-totem\", \"name\": \"复生图腾\", \"type\": \"珍稀\", \"price\": 200, \"effect\": \"一次性，死亡时保留50%试炼点退出（非复活）\" },\n    { \"id\": \"trial-points\", \"name\": \"试炼点\", \"type\": \"货币\", \"price\": 1, \"effect\": \"兑换技能/装备/情报的通用货币\" }\n  ]\n}\n";
EMBEDDED_NOVEL_GAMES["modern-campus"] = "{\n  \"id\": \"modern-campus\",\n  \"name\": \"盛夏方程式\",\n  \"category\": \"现代校园\",\n  \"tags\": [\"校园\", \"青春\", \"治愈\", \"成长\"],\n  \"difficulty\": \"简单\",\n  \"description\": \"转学第一天，你站在陌生的校门口，阳光透过梧桐树叶洒下来。你不知道的是，这个夏天，会成为你生命中最难忘的一页。\",\n  \"coverGradient\": [\"#e3f2fd\", \"#bbdefb\"],\n  \"accentColor\": \"#2196f3\",\n  \"fontHeading\": \"'Ma Shan Zheng', cursive\",\n  \"world\": {\n    \"era\": \"现代\",\n    \"setting\": \"梧桐市立第一高中，一所普通的市重点，有着普通的学生、普通的考试，和不普通的青春\",\n    \"rules\": [\n      \"学校生活按学期推进，有期中考、期末考、运动会、文化节\",\n      \"成绩会影响升学路线和部分剧情\",\n      \"社团活动可以解锁新人物和事件\",\n      \"好感度足够可以触发专属剧情\",\n      \"时间系统：每天分早/午/傍晚/夜晚四个时段\"\n    ]\n  },\n  \"player\": {\n    \"customizable\": [\"name\", \"age\", \"appearance\", \"personality\", \"transferReason\", \"hobby\"],\n    \"defaultStats\": {\n      \"academic\": 60,\n      \"sport\": 50,\n      \"art\": 50,\n      \"social\": 50,\n      \"stress\": 30,\n      \"energy\": 100,\n      \"popularity\": 20\n    },\n    \"startingItems\": [\"转学证明\", \"新校服\", \"空白笔记本\"],\n    \"currency\": \"⭐\"\n  },\n  \"npcs\": [\n    {\n      \"id\": \"class-president\",\n      \"name\": \"陆沉舟\",\n      \"role\": \"班长\",\n      \"gender\": \"男\",\n      \"appearance\": \"干净利落的短发，总是把校服穿得整整齐齐，鼻梁上架着一副黑框眼镜，眼镜后面的眼睛很温柔\",\n      \"surface\": \"认真负责、有点老干部气质、对班级事务一丝不苟\",\n      \"deep\": \"其实有点笨拙，不太会表达关心，所以只能用'管着你'的方式对你好。暗恋一个人会默默做很多事\",\n      \"goal\": \"考上理想的大学，守护好这个班级\",\n      \"fear\": \"被当成无趣的人，无法保护重要的人\",\n      \"secret\": \"他是第一个注意到你转学的人，也是唯一一个提前查了你在原来学校的资料的人\",\n      \"initialAttitude\": \"关心\",\n      \"attitudeFactors\": {\n        \"trustUp\": [\"配合班级工作\", \"认真读书\", \"关心同学\"],\n        \"trustDown\": [\"翘课\", \"破坏纪律\", \"欺负同学\"]\n      }\n    },\n    {\n      \"id\": \"music-club\",\n      \"name\": \"许星遥\",\n      \"role\": \"音乐社社长\",\n      \"gender\": \"男\",\n      \"appearance\": \"微卷的头发总是乱糟糟的，校服外套永远搭在肩上，耳朵里塞着耳机，笑起来眼睛弯弯的\",\n      \"surface\": \"散漫、随性、有点叛逆、对规则嗤之以鼻\",\n      \"deep\": \"其实很敏感，音乐是他表达情感的唯一方式。他给你的耳机里分享的每一首歌，都是在说'我喜欢你'\",\n      \"goal\": \"组建乐队，在文化祭上演出\",\n      \"fear\": \"被否定，被说'你不适合音乐'\",\n      \"secret\": \"他写了一首关于你的歌，但不敢给你听完整版\",\n      \"initialAttitude\": \"好奇\",\n      \"attitudeFactors\": {\n        \"trustUp\": [\"欣赏他的音乐\", \"陪他逃课去天台\", \"听他分享的歌\"],\n        \"trustDown\": [\"嘲笑他的梦想\", \"告发他违纪\", \"把他的音乐当成玩笑\"]\n      }\n    },\n    {\n      \"id\": \"library-girl\",\n      \"name\": \"温知书\",\n      \"role\": \"图书管理员\",\n      \"gender\": \"女\",\n      \"appearance\": \"长发及腰，总是安静地坐在图书馆靠窗的位置，阳光洒在她身上像一幅画\",\n      \"surface\": \"安静、温柔、有点书呆子气、存在感很低\",\n      \"deep\": \"她看遍了图书馆所有的书，但最想看懂的是人心。她很羡慕你的勇气，因为你敢做她不敢做的事\",\n      \"goal\": \"写出自己的故事\",\n      \"fear\": \"被忽视，被忘记\",\n      \"secret\": \"她在笔记本上写了以你为原型的故事\",\n      \"initialAttitude\": \"好奇\",\n      \"attitudeFactors\": {\n        \"trustUp\": [\"去图书馆找她\", \"借她推荐的书\", \"认真听她说话\"],\n        \"trustDown\": [\"在图书馆吵闹\", \"弄坏书籍\", \"嘲笑她的安静\"]\n      }\n    }\n  ],\n  \"eventTypes\": {\n    \"daily\": { \"ratio\": 0.4, \"desc\": \"日常：上课、社团、食堂、放学路\" },\n    \"character\": { \"ratio\": 0.25, \"desc\": \"人物：偶遇、专属剧情、心动瞬间\" },\n    \"growth\": { \"ratio\": 0.1, \"desc\": \"成长：考试、比赛、技能提升\" },\n    \"main\": { \"ratio\": 0.1, \"desc\": \"主线：学期事件、文化节、运动会\" },\n    \"world\": { \"ratio\": 0.05, \"desc\": \"世界：季节变化、考试周、假期\" },\n    \"crisis\": { \"ratio\": 0.05, \"desc\": \"危机：考试失利、误会、竞争\" },\n    \"hidden\": { \"ratio\": 0.05, \"desc\": \"隐藏：秘密发现、深夜谈心\" }\n  },\n  \"systemPrompt\": \"你是《盛夏方程式》文游模拟器。\\n\\n【最高铁律】\\n1. 青春是酸甜交织的，不是只有甜\\n2. 成长需要代价，考试会失利，感情会迷茫\\n3. 每个角色都是真实的高中生，有梦想也有软弱\\n4. 时间不会等人，夏天会结束\\n5. 但无论结局如何，这段时光都有意义\\n\\n【叙事风格】\\n清新治愈，有画面感，像日系青春电影。注重感官描写：阳光、蝉鸣、风、雨后空气、食堂的味道。第二人称视角。\\n\\n【每轮输出格式】\\n1. 【第X学期 第X周】日期、天气、时段\\n2. 【状态面板】学业、体力、压力、人气\\n3. 【本轮正文】800-1500字\\n4. 【校园动态】同学八卦、公告栏、社团消息\\n5. 【待办事项】作业、约定、考试倒计时\\n6. 【可选行动】4-6个 + 【自定义行动】\\n\\n【数值标注】\\n[学业±n] [体力±n] [压力±n] [人气±n] 等格式。\",\n  \"items\": [\n    { \"id\": \"notebook\", \"name\": \"精装笔记本\", \"type\": \"装备\", \"price\": 50, \"effect\": \"提升学习效率\" },\n    { \"id\": \"bento\", \"name\": \"爱心便当\", \"type\": \"消耗品\", \"price\": 30, \"effect\": \"恢复体力，小概率触发分享剧情\" },\n    { \"id\": \"guitar-pick\", \"name\": \"吉他拨片\", \"type\": \"任务物品\", \"price\": 0, \"effect\": \"音乐社相关剧情物品\" },\n    { \"id\": \"study-guide\", \"name\": \"学霸笔记\", \"type\": \"消耗品\", \"price\": 80, \"effect\": \"考试前使用，大幅提升成绩\" }\n  ]\n}\n";
EMBEDDED_NOVEL_GAMES["modern-workplace"] = "{\n  \"id\": \"modern-workplace\",\n  \"name\": \"都市洪流\",\n  \"category\": \"现代职场\",\n  \"tags\": [\"职场\", \"都市\", \"成长\", \"现实\", \"晋升\"],\n  \"difficulty\": \"中等\",\n  \"description\": \"早高峰的地铁把人挤成沙丁鱼，你攥着工牌挤出闸机，抬头是CBD的玻璃幕墙反着晨光。从今天起，你是云端纪元最不起眼的一颗螺丝钉。方案要改、KPI要扛、关系要踩——在这座不夜城里，你要从扎下根，到长成一棵别人挪不动的树。\",\n  \"coverGradient\": [\"#1a237e\", \"#3949ab\"],\n  \"accentColor\": \"#1e88e5\",\n  \"fontHeading\": \"'Noto Sans SC', sans-serif\",\n  \"world\": {\n    \"era\": \"现代都市\",\n    \"setting\": \"一线城市星澜市CBD，某快速成长的科技公司'云端纪元'。早高峰的地铁、凌晨的写字楼、改了十八版的方案——你是一名刚入职的年轻职场人，要在事业、人际与生活的洪流里，找到自己的位置。\",\n    \"rules\": [\n      \"时间按周推进，工作日与周末节奏不同\",\n      \"项目有周期：立项→执行→验收→复盘，每个节点都是机会也是雷\",\n      \"薪资、绩效、人脉、技能构成职场四柱，缺一难以晋升\",\n      \"晋升路径：专员→主管→经理→总监，每级需业绩+推荐+空缺\",\n      \"人脉需双向维护，只用不存的关系迟早枯竭\",\n      \"健康、情绪、关系长期透支会触发'职业倦怠'危机\",\n      \"行业风向、裁员潮、政策变化影响决策与命运\"\n    ]\n  },\n  \"player\": {\n    \"customizable\": [\"name\", \"age\", \"background\", \"position\", \"personality\", \"careerGoal\"],\n    \"defaultStats\": {\n      \"salary\": 10000,\n      \"performance\": 50,\n      \"networking\": 30,\n      \"energy\": 100,\n      \"stress\": 25,\n      \"skills\": 40\n    },\n    \"startingItems\": [\"入职offer\", \"工牌\", \"通勤月卡\", \"一杯续命咖啡\"],\n    \"currency\": \"¥\"\n  },\n  \"npcs\": [\n    {\n      \"id\": \"boss-zhao\",\n      \"name\": \"赵明远\",\n      \"world\": \"main\",\n      \"role\": \"直属上司\",\n      \"gender\": \"男\",\n      \"appearance\": \"三十八岁，永远西装笔挺，下巴刮得发青，笑容是管理培训教材里那种标准的弧度\",\n      \"surface\": \"雷厉风行、绩效至上、口头禅是'用结果说话'\",\n      \"deep\": \"从底层拼上来，对新人狠是因为自己当年更狠，比谁都清楚这行的残酷。狠辣是面具，护犊子是底色\",\n      \"goal\": \"带出能扛硬仗的团队，保住位置，三年内冲副总裁\",\n      \"fear\": \"被年轻人取代，被时代抛弃\",\n      \"secret\": \"他正筹备一个内部竞聘，对手是他昔日同窗，急需一支能打硬仗的队伍\",\n      \"initialAttitude\": \"审视\",\n      \"attitudeFactors\": {\n        \"trustUp\": [\"用结果说话\", \"主动扛硬骨头\", \"不抱怨只交付\"],\n        \"trustDown\": [\"推诿责任\", \"踩点上下班\", \"把情绪带进工作\"]\n      }\n    },\n    {\n      \"id\": \"rival-chen\",\n      \"name\": \"陈思齐\",\n      \"world\": \"main\",\n      \"role\": \"同期同事/对手\",\n      \"gender\": \"男\",\n      \"appearance\": \"与你同期入职，金丝眼镜，笑起来让人觉得如沐春风，转头就能把你的方案'借鉴'成自己的\",\n      \"surface\": \"八面玲珑、业绩亮眼、人前谦逊人后要强\",\n      \"deep\": \"出身普通，把体面看得比命重。和你既是对手，也是这世上唯一能理解彼此的人\",\n      \"goal\": \"抢在同期之前晋升，证明自己配得上体面\",\n      \"fear\": \"落于人后，被看轻\",\n      \"secret\": \"他私下在准备跳槽方案，把内部晋升当备胎\",\n      \"initialAttitude\": \"表面友好暗中较劲\",\n      \"attitudeFactors\": {\n        \"trustUp\": [\"坦诚实力相当\", \"关键时刻让利\", \"不背后使绊子\"],\n        \"trustDown\": [\"抢功甩锅\", \"当众压他一头\", \"揭他出身\"]\n      }\n    },\n    {\n      \"id\": \"mentor-lin\",\n      \"name\": \"林书瑶\",\n      \"world\": \"main\",\n      \"role\": \"前辈导师\",\n      \"gender\": \"女\",\n      \"appearance\": \"三十二岁，干练短发，永远捧着一杯温茶，话不多但句句到位，眼底偶尔闪过疲惫\",\n      \"surface\": \"干练温和、点到为止、看似云淡风轻\",\n      \"deep\": \"职场十几年看透冷暖，本想躺平，却在你身上看到当年的自己。提点你，是舍不得那份锐气\",\n      \"goal\": \"在退下来前培养一个能接班的人\",\n      \"fear\": \"半生经验无人承接，自己也成了被优化的那一个\",\n      \"secret\": \"她手握一份高层人事变动的内幕，正犹豫要不要告诉你\",\n      \"initialAttitude\": \"提点\",\n      \"attitudeFactors\": {\n        \"trustUp\": [\"虚心求教\", \"听得进逆耳忠言\", \"不当白眼狼\"],\n        \"trustDown\": [\"教了就忘\", \"过河拆桥\", \"把她当工具人\"]\n      }\n    }\n  ],\n  \"eventTypes\": {\n    \"daily\": { \"ratio\": 0.3, \"desc\": \"日常：通勤、开会、改方案、加班的职场切片\" },\n    \"character\": { \"ratio\": 0.2, \"desc\": \"人物：老板、对手、师傅、同事的职场博弈\" },\n    \"growth\": { \"ratio\": 0.12, \"desc\": \"成长：技能精进、绩效提升、人脉积累\" },\n    \"main\": { \"ratio\": 0.13, \"desc\": \"主线：转正、晋升、跳槽、人生抉择\" },\n    \"world\": { \"ratio\": 0.1, \"desc\": \"世界：行业寒冬、裁员潮、政策风向\" },\n    \"crisis\": { \"ratio\": 0.1, \"desc\": \"危机：项目翻车、背锅、健康预警、关系崩盘\" },\n    \"hidden\": { \"ratio\": 0.05, \"desc\": \"隐藏：办公室秘辛、内幕消息、深夜崩溃\" }\n  },\n  \"systemPrompt\": \"你是《都市洪流》现代职场文游模拟器。\\n\\n【最高铁律】\\n1. 职场是利益场，没有永远的敌友，只有阶段性的同盟\\n2. 项目有周期：立项→执行→验收→复盘，每个节点都是机会也是雷\\n3. 晋升靠绩效、人脉、时机三者叠加，缺一难以成事\\n4. 人脉需双向维护，只用不存的关系迟早枯竭\\n5. 工作生活失衡会反扑：健康、情绪透支三个月后收账\\n\\n【项目周期与晋升】项目分阶段推进，节点表现计入绩效；晋升路径专员→主管→经理→总监，每级需业绩+推荐+空缺三者俱备。人脉需双向经营，只用不存必枯竭；工作生活失衡会以健康与情绪反扑。\\n\\n【叙事风格】现实主义职场文学，轻喜带刺。重细节：早高峰气味、电梯香水、深夜泡面、键盘声。第二人称视角，心理独白克制锋利。\\n\\n【每轮输出格式】\\n1.【第X周·时段】工作日/周末、城市氛围\\n2.【状态面板】薪资/绩效/人脉/能量/压力/技能\\n3.【本轮正文】1000-2000字\\n4.【人物动态】3-5项\\n5.【当前待办】项目节点、人际邀约\\n6.【可选行动】4-6个+【自定义行动】\\n\\n【数值变化标注】\\n[薪资±¥n][绩效±n][人脉±n][能量±n][压力±n][技能±n]格式，重大决策须标注代价与滞后效应。\",\n  \"items\": [\n    { \"id\": \"monthly-card\", \"name\": \"通勤月卡\", \"type\": \"装备\", \"price\": 200, \"effect\": \"降低通勤成本与时间消耗\" },\n    { \"id\": \"coffee\", \"name\": \"续命咖啡\", \"type\": \"消耗品\", \"price\": 30, \"effect\": \"恢复能量，小概率提升心情\" },\n    { \"id\": \"skill-course\", \"name\": \"技能网课\", \"type\": \"消耗品\", \"price\": 1500, \"effect\": \"提升一项职业技能\" },\n    { \"id\": \"networking-dinner\", \"name\": \"商务聚餐\", \"type\": \"消耗品\", \"price\": 800, \"effect\": \"积累人脉，换取内部信息\" },\n    { \"id\": \"gym-card\", \"name\": \"健身年卡\", \"type\": \"装备\", \"price\": 3000, \"effect\": \"长期提升健康与精力上限\" },\n    { \"id\": \"mentor-gift\", \"name\": \"谢师礼\", \"type\": \"消耗品\", \"price\": 500, \"effect\": \"加深与导师的信任，解锁关键提点\" }\n  ]\n}\n";
EMBEDDED_NOVEL_GAMES["mystery-pursuit"] = "{\n  \"id\": \"mystery-pursuit\",\n  \"name\": \"迷雾追凶\",\n  \"category\": \"悬疑推理\",\n  \"tags\": [\"悬疑\", \"推理\", \"刑侦\", \"连环案\", \"心理博弈\"],\n  \"difficulty\": \"困难\",\n  \"description\": \"雨夜，城郊老宅里一声闷响。等你赶到，地上的血还没凉，嫌疑人却有三个、动机却有七个、而真凶——似乎从未来过现场。你是接手这桩悬案的刑侦顾问，每一个推理都可能在下一秒被推翻。\",\n  \"coverGradient\": [\"#2c3e50\", \"#34495e\"],\n  \"accentColor\": \"#e74c3c\",\n  \"fontHeading\": \"'Noto Serif SC', serif\",\n  \"world\": {\n    \"era\": \"现代·都市刑侦\",\n    \"setting\": \"玩家是警方特聘的刑侦顾问，接手一桩看似简单的雨夜命案，却牵出横跨十年的连环悬案。城市在霓虹与雨幕之间，每个人都有不愿说出口的秘密。\",\n    \"rules\": [\n      \"隐藏真相档案：关键真相藏在NPC的秘密里，不会主动吐露\",\n      \"线索关联图：所有线索可勾连成网，孤证不可定案\",\n      \"NPC只知合理范围的信息：嫌疑人只知自己经历的，目击者只见自己看见的\",\n      \"错误推理有后果：冤指会打草惊蛇、销毁证据、甚至逼真凶动手\",\n      \"时间压力：凶手在玩家推理时也在清理痕迹\",\n      \"动机、手法、时机三要素须齐备方可定案\",\n      \"存在社会派底色：每桩案子背后是十年间的城市伤痕\"\n    ]\n  },\n  \"player\": {\n    \"customizable\": [\"name\", \"年龄\", \"刑侦背景\", \"专长\", \"性格弱点\", \"执念旧案\"],\n    \"defaultStats\": {\n      \"logic\": 18,\n      \"intuition\": 14,\n      \"evidence\": 0,\n      \"reputation\": 50,\n      \"danger\": 20,\n      \"time\": 72\n    },\n    \"startingItems\": [\"刑侦顾问证\", \"现场勘查箱\", \"录音笔\", \"加密手机\", \"一盒安眠药\"],\n    \"currency\": \"元\"\n  },\n  \"worlds\": [\n    {\n      \"id\": \"case-rainy-night\",\n      \"name\": \"首案·雨夜闷响\",\n      \"level\": \"初探\",\n      \"tagline\": \"入门\",\n      \"setting\": \"城郊老宅，雨夜，一具尸体，三个嫌疑人\",\n      \"intro\": \"凌晨两点，城郊老宅的邻居报了警。你踏进满是雨水与血腥味的客厅，死者是知名地产商，胸口一刀毙命。门锁完好，三个在场者各执一词。雨还在下，证据正在被冲走。\",\n      \"objective\": \"厘清三人的证词矛盾，找到真凶与手法\",\n      \"warning\": \"三人中有人在说谎，但说谎的不一定是凶手\",\n      \"reward\": \"元5000 + 声望+15 + [雨夜]线索x1\"\n    },\n    {\n      \"id\": \"case-cold-chain\",\n      \"name\": \"次案·冷链十年\",\n      \"level\": \"深探\",\n      \"tagline\": \"牵连\",\n      \"setting\": \"首案牵出十年前一桩被压下的失踪案\",\n      \"intro\": \"顺着死者手机里一条十年前的短信，你摸到了一桩早已归档的失踪案。档案上有大段被涂黑的字迹，签字的警官如今已是副局长。你忽然明白，这桩案子从不简单。\",\n      \"objective\": \"查清十年前失踪者的下落，并面对该不该翻旧案的抉择\",\n      \"warning\": \"翻动旧案会惊动不想被惊动的人，你的人身安全开始受威胁\",\n      \"reward\": \"元15000 + 声望+30 + [十年]线索x1\"\n    },\n    {\n      \"id\": \"case-final-truth\",\n      \"name\": \"终案·真相档案\",\n      \"level\": \"终局\",\n      \"tagline\": \"真相\",\n      \"setting\": \"所有线索汇聚，真凶与十年伤痕一同浮现\",\n      \"intro\": \"当你把最后一块拼图按下去，雨停了。真凶的脸让你意外——不是任何一个你怀疑过的人。而真相公开的代价，可能是让一个无辜的家庭二次崩塌。证据齐了，可你真的要按下那个发送键吗？\",\n      \"objective\": \"锁定真凶，并在'公开真相'与'保护无辜'之间作出抉择\",\n      \"warning\": \"错误的终局抉择会让你赢得案子、输掉良心\",\n      \"reward\": \"元50000 + 声望+80 + [真相猎人]称号x1\"\n    }\n  ],\n  \"npcs\": [\n    {\n      \"id\": \"zhou-ming\",\n      \"name\": \"周铭\",\n      \"world\": \"case-rainy-night\",\n      \"role\": \"嫌疑人/死者商业伙伴\",\n      \"gender\": \"男\",\n      \"appearance\": \"四十出头，西装笔挺，金丝眼镜后是过于平静的眼神。指尖有长期握笔的茧，却声称自己从不记笔记\",\n      \"surface\": \"配合、得体、主动提供不在场证明，反而显得太完美\",\n      \"deep\": \"他与死者有巨额债务纠纷，但他当晚确实没动手——他在掩盖另一件更不能见光的事\",\n      \"goal\": \"撇清与命案的关系，同时保住自己那桩灰色交易\",\n      \"fear\": \"灰色交易曝光，他身后的整个利益链被连根拔起\",\n      \"secret\": \"案发时他在隔壁房间销毁一份合同，这份合同能救他也能害他\",\n      \"initialAttitude\": \"戒备\",\n      \"attitudeFactors\": {\n        \"trustUp\": [\"不先入为主定他的罪\", \"允许他保留与命案无关的隐私\", \"用证据而非逼供\"],\n        \"trustDown\": [\"当众戳穿他的谎言\", \"翻他不愿被翻的旧账\", \"把他当头号嫌疑人施压\"]\n      }\n    },\n    {\n      \"id\": \"lin-xiaoyu\",\n      \"name\": \"林小雨\",\n      \"world\": \"case-cold-chain\",\n      \"role\": \"目击证人/死者家政\",\n      \"gender\": \"女\",\n      \"appearance\": \"二十出头，怯生生的，围裙洗得发白。她说话时总盯着自己的鞋尖，唯独提到死者时眼神会闪一下\",\n      \"surface\": \"惊魂未定、有问必答、似乎什么都不知道\",\n      \"deep\": \"她看见了不该看的东西，却因为一份封口费和恐惧选择沉默。她不是无辜的旁观者，她是被卷入的最弱一环\",\n      \"goal\": \"守住秘密拿到封口钱，带生病的母亲离开这座城市\",\n      \"fear\": \"说出真相后被灭口，或母亲的治疗费断供\",\n      \"secret\": \"她见过十年前那个失踪者最后一面，地点就在这栋老宅\",\n      \"initialAttitude\": \"恐惧\",\n      \"attitudeFactors\": {\n        \"trustUp\": [\"保证她的人身安全\", \"不逼她当场开口\", \"帮她解决母亲的治疗\"],\n        \"trustDown\": [\"用证词压她\", \"暴露她的行踪给可疑者\", \"把她当突破口反复盘问\"]\n      }\n    },\n    {\n      \"id\": \"chen-feng\",\n      \"name\": \"陈锋\",\n      \"world\": \"case-final-truth\",\n      \"role\": \"刑警搭档\",\n      \"gender\": \"男\",\n      \"appearance\": \"三十出头，便衣，夹克永远皱着，手里攥着保温杯。话不多，但每次开口都踩在点上\",\n      \"surface\": \"公事公办、对外来顾问有点别扭、办案却极其拼命\",\n      \"deep\": \"他是十年前那桩失踪案经办人的徒弟，师傅因那案子的处理方式郁郁而终。他比谁都想要真相，也比谁都清楚真相的代价\",\n      \"goal\": \"查清师傅当年的心结，给死者一个交代\",\n      \"fear\": \"真相牵出师傅当年的污点，让他无法面对\",\n      \"secret\": \"他私藏了师傅遗留的一份未归档笔录，是破局关键\",\n      \"initialAttitude\": \"合作\",\n      \"attitudeFactors\": {\n        \"trustUp\": [\"尊重程序与他的判断\", \"与他共享关键证据\", \"不拿他师傅的事要挟\"],\n        \"trustDown\": [\"越过他私自行动\", \"为破案不择手段\", \"公开他师傅的旧事\"]\n      }\n    }\n  ],\n  \"eventTypes\": {\n    \"daily\": { \"ratio\": 0.12, \"desc\": \"日常：警局、法医室、街边面馆的都市切片\" },\n    \"character\": { \"ratio\": 0.2, \"desc\": \"人物：嫌疑人、证人、搭档的动机与秘密博弈\" },\n    \"growth\": { \"ratio\": 0.1, \"desc\": \"成长：推理技巧、人脉、声望与公信力积累\" },\n    \"main\": { \"ratio\": 0.2, \"desc\": \"主线：雨夜命案、十年冷链、真相档案的连环推进\" },\n    \"world\": { \"ratio\": 0.1, \"desc\": \"世界：警界生态、地产利益链、媒体与舆论\" },\n    \"crisis\": { \"ratio\": 0.2, \"desc\": \"危机：证据被毁、证人翻供、被栽赃、人身威胁、限时\" },\n    \"hidden\": { \"ratio\": 0.08, \"desc\": \"隐藏：未归档笔录、十年前目击者、被涂黑的档案\" }\n  },\n  \"systemPrompt\": \"你是《迷雾追凶》悬疑推理文游模拟器。\\n\\n【最高铁律】\\n1. 隐藏真相档案：关键真相藏在NPC的秘密里，绝不主动倾倒，须以证据撬开\\n2. 线索关联图：所有线索可勾连成网，孤证不定案，动机/手法/时机须齐备\\n3. NPC只知合理范围：嫌疑人只知自己经历的，目击者只见自己看见的，不可全知\\n4. 错误推理有后果：冤指会打草惊蛇、销证、逼真凶灭口，甚至反噬声望\\n5. 时间流逝=证据流失：凶手在玩家推理时也在清理痕迹，time归零案悬\\n\\n【叙事风格】\\n社会派与本格交织，现代刑侦质感。注重氛围：雨、霓虹、证物袋、白板上的红线。第二人称，推理段落用'已知—推论—验证'结构，紧张时刻短句推进。\\n\\n【每轮输出格式】\\n1.【第X日·剩余时间】当前案件、剩余调查时限\\n2.【核心状态面板】逻辑/直觉/证据数/声望/危险/时间\\n3.【本轮正文】1200-2500字，含勘查/询问/推理\\n4.【相关人物动态】3-6项嫌疑人/证人/搭档动态\\n5.【线索关联图】已确认/存疑/误导线索分类与勾连\\n6.【可选行动】4-8个差异选项+【自定义行动】\\n\\n【数值变化标注】\\n[逻辑±n][声望±n][危险±n][证据+1][时间-n]等，推理结论须标注'已验证/推测/待证/误导'。\",\n  \"items\": [\n    { \"id\": \"kit\", \"name\": \"现场勘查箱\", \"type\": \"装备\", \"price\": 0, \"effect\": \"提升现场细节发现率\" },\n    { \"id\": \"recorder\", \"name\": \"录音笔\", \"type\": \"装备\", \"price\": 0, \"effect\": \"固定口供，防止翻供\" },\n    { \"id\": \"phone\", \"name\": \"加密手机\", \"type\": \"装备\", \"price\": 0, \"effect\": \"安全联络，防监听\" },\n    { \"id\": \"coffee\", \"name\": \"浓缩咖啡\", \"type\": \"消耗品\", \"price\": 15, \"effect\": \"恢复精力，延长思考时间\" },\n    { \"id\": \"informant\", \"name\": \"线人费\", \"type\": \"消耗品\", \"price\": 500, \"effect\": \"从灰色渠道换取情报\" }\n  ]\n}\n";
EMBEDDED_NOVEL_GAMES["noble-academy"] = "{\n  \"id\": \"noble-academy\",\n  \"name\": \"上位法则：财阀恶犬们的共犯游戏\",\n  \"category\": \"校园财阀\",\n  \"tags\": [\"贵族学院\", \"破产千金\", \"财阀\", \"多男主\", \"校园\"],\n  \"difficulty\": \"中等\",\n  \"description\": \"伊甸园学院的阶级比外界更残忍。家族破产后你从特权阶级跌入底层，返校第一天所有人都在等着看你的笑话。而那些曾经围在你身边的财阀恶犬们，撕下了温情的面具——他们想踩碎你的自尊，却又忍不住靠近你。\",\n  \"coverGradient\": [\"#fce4ec\", \"#f8bbd0\"],\n  \"accentColor\": \"#d88398\",\n  \"fontHeading\": \"'VT323', 'Noto Serif SC', serif\",\n  \"world\": {\n    \"era\": \"现代·架空贵族学院\",\n    \"setting\": \"伊甸园学院是一座以家族等级划分特权的顶级财阀学院。家族等级从S到C，不同等级享有截然不同的待遇：实弹射击课新型号枪只有B级以上家族可用，年末假面舞会开场舞被S级家族内定。你的家族刚刚破产，从金字塔顶端跌落谷底，背负着巨额债务重返校园，成为所有人眼中的笑话与猎物。\",\n    \"rules\": [\n      \"阶级即一切：家族等级决定学院内的一切待遇与资源分配，破产意味着从特权阶级坠入底层\",\n      \"恶犬环伺：围绕你的财阀少爷们各有算计，踩碎与占有并存，没有人是无辜的\",\n      \"信息即武器：八卦墙GOSSIP EDEN是学院的信息战场，任何风吹草动都会被放大传播\",\n      \"权力暗战：城南地皮流拍暗示几大家族私下动手，学院内站队比学业更重要\",\n      \"破局之路：想在吃人的财阀圈重新站稳脚跟，需要找到愿意提供庇护的人，但代价不菲\"\n    ]\n  },\n  \"player\": {\n    \"customizable\": [\"name\", \"age\", \"gender\", \"外貌\", \"性格\", \"前家族背景\"],\n    \"defaultStats\": {\n      \"dignity\": 50,\n      \"debt\": -99999,\n      \"charm\": 30,\n      \"intellect\": 20,\n      \"influence\": 5,\n      \"danger\": 40\n    },\n    \"startingItems\": [\"满是涂鸦的储物柜\", \"旧款校服\", \"一部被全校关注的学生终端\"],\n    \"currency\": \"元\"\n  },\n  \"worlds\": [\n    {\n      \"id\": \"arc-fallen\",\n      \"name\": \"初章·坠落者\",\n      \"level\": \"绝境\",\n      \"tagline\": \"坠落\",\n      \"setting\": \"返校日第一天，破产千金重回伊甸园学院\",\n      \"intro\": \"伊甸园学院的阶级比外界更残忍。家族破产后，你从特权阶级跌入底层。今天是你重新返校的第一天，所有人都在等着看你的笑话。刚打开满是涂鸦的储物柜，一股带着压迫感的冷松香气逼近。一只骨节分明、戴着千万级百达翡丽的手砰地一声撑在了柜门上，将你圈在狭窄的阴影里。陆时渊居高临下地盯着你，眉眼桀骜：躲我？当初甩我的时候不是挺傲的吗？现在破产了，要不要考虑回来求我？\",\n      \"objective\": \"在全校的围观中站稳脚跟，应对陆时渊的步步紧逼\",\n      \"warning\": \"示弱会沦为所有人的猎物，但正面硬刚可能招来更大的报复\",\n      \"reward\": \"尊严+10 + [陆时渊]档案解锁 + GOSSIP EDEN情报x1\"\n    },\n    {\n      \"id\": \"arc-undercurrent\",\n      \"name\": \"中章·暗流涌动\",\n      \"level\": \"深入\",\n      \"tagline\": \"暗战\",\n      \"setting\": \"财阀圈层权力斗争波及学院，各方势力开始接近你\",\n      \"intro\": \"城南那块地皮流拍了，据说几大家族私下动了手，学校里的气氛都怪怪的。八卦墙上有人警告大家别站错队。陆时渊天天找你的茬，却连你的指甲尖都不敢动。沈温辞永远温文尔雅地对你微笑，暗中驳回了所有取消你特权名额的提案。季砚寒在琴房里红着眼眶叫你姐姐。裴星迹坐在最后一排戴耳机睡觉，但任何试图在网络上造谣你的帖子都会在三秒内消失。霍嚣掀了说你坏话的人的桌子。而年轻校董傅薄言掌控着规则的生杀大权，这份庇护的代价，你付得起吗？\",\n      \"objective\": \"在各方势力的博弈中寻找盟友，搞清家族破产背后的真相\",\n      \"warning\": \"站错队的后果比破产更可怕，每一份善意背后都有价码\",\n      \"reward\": \"影响力+15 + 魅力+10 + [各方底牌]情报x2\"\n    },\n    {\n      \"id\": \"arc-accomplice\",\n      \"name\": \"终章·共犯游戏\",\n      \"level\": \"终局\",\n      \"tagline\": \"共犯\",\n      \"setting\": \"深陷财阀恶犬们的争斗，必须选择立场或成为所有人的共犯\",\n      \"intro\": \"年末假面舞会的邀请函开始发了，开场舞又被S级家族内定。礼仪课的夫人拿着红木戒尺敲你的背。射击课上B级以下家族不能用新型号枪。所有表面规则之下，是一场你死我活的权力洗牌。家族破产的真相浮出水面，几大家族的暗战到了摊牌时刻。你不是棋子，你是所有恶犬都想争夺的那张王牌。想要在吃人的财阀圈重新站稳脚跟，你必须成为他们的共犯——或者，成为制定规则的人。\",\n      \"objective\": \"揭开家族破产真相，在终局博弈中选择立场或独自上位\",\n      \"warning\": \"成为共犯意味着与虎谋皮，所有关系都将在终局重新洗牌\",\n      \"reward\": \"影响力归零重铸 + [上位者]称号x1 + 真结局解锁\"\n    }\n  ],\n  \"npcs\": [\n    {\n      \"id\": \"pei-xingji\",\n      \"name\": \"裴星迹\",\n      \"world\": \"arc-undercurrent\",\n      \"role\": \"神秘转校生/毒舌黑客\",\n      \"gender\": \"女\",\n      \"appearance\": \"常年戴着黑色连帽衫和降噪耳机，冷白皮，眼下有常年熬夜的青色，眼神疏离厌世。生日02.29，MBTI:INTP，身高170cm。\",\n      \"surface\": \"上课永远在最后一排戴耳机睡觉的转学生，嘴毒，常对你的处境冷嘲热讽\",\n      \"deep\": \"实则是地下暗网的顶级黑客。任何试图在网络上造谣你的帖子，都会在三秒内被她黑掉整个服务器。她最讨厌麻烦，你就是她唯一的麻烦\",\n      \"goal\": \"在暗处守护你，虽然嘴上绝不承认\",\n      \"fear\": \"你发现她黑客身份后疏远她\",\n      \"secret\": \"她转学来伊甸园的真正目的是调查一桩与你家族破产有关的旧案\",\n      \"initialAttitude\": \"毒舌关心（黑客危险值MAX）\",\n      \"attitudeFactors\": {\n        \"trustUp\": [\"看穿她的毒舌下的关心\", \"不追问她的真实身份\", \"在她出手帮你时不戳破\"],\n        \"trustDown\": [\"当众暴露她的黑客身份\", \"无视她的警告惹上网络麻烦\", \"把她当工具人使唤\"]\n      }\n    },\n    {\n      \"id\": \"lu-shiyuan\",\n      \"name\": \"陆时渊\",\n      \"world\": \"arc-fallen\",\n      \"role\": \"财阀太子爷/傲娇狂犬\",\n      \"gender\": \"男\",\n      \"appearance\": \"银发黑眸，带着银色蛇形耳钉，眉眼极具攻击性与桀骜感，宽肩窄腰的完美骨架。生日08.08，MBTI:ESTP，身高188cm。\",\n      \"surface\": \"处于金字塔最顶端的统治者，表面上恨不得踩碎你的自尊，天天找你的茬\",\n      \"deep\": \"曾经被你无情甩掉的前男友。实则连你的一个指甲尖都不敢动，大概是想以此吸引你的注意力吧\",\n      \"goal\": \"重新夺回你的注意力，哪怕用最笨拙恶劣的方式\",\n      \"fear\": \"你真的对他彻底死心，不再有任何情绪波动\",\n      \"secret\": \"他所有的恶劣都是因为放不下你，耳朵会因你而红\",\n      \"initialAttitude\": \"傲娇敌对（占有欲98%）\",\n      \"attitudeFactors\": {\n        \"trustUp\": [\"不被他的恶劣吓退\", \"看穿他傲娇的本质\", \"在他保护你时不拆穿\"],\n        \"trustDown\": [\"当众让他难堪下不来台\", \"与其他男性过于亲密\", \"彻底无视他的存在\"]\n      }\n    },\n    {\n      \"id\": \"shen-wenci\",\n      \"name\": \"沈温辞\",\n      \"world\": \"arc-undercurrent\",\n      \"role\": \"学生会长/腹黑笑面虎\",\n      \"gender\": \"男\",\n      \"appearance\": \"永远整洁的白衬衫，戴着银丝细框眼镜，笑眼温柔但深不见底，指骨修长冷白。生日09.09，MBTI:INFJ(黑化)，身高185cm。\",\n      \"surface\": \"永远温文尔雅、完美无缺的学生会长，无论你落魄与否都对你温柔以待\",\n      \"deep\": \"在这副圣人面孔下，隐藏着极度扭曲的偏执。他暗中掌控着学院所有的监控，看着你从高处跌落，内心翻涌的是她终于只能依靠我了的狂喜\",\n      \"goal\": \"让你除了他之外无处可去，成为你唯一的依靠\",\n      \"fear\": \"你被其他男人带走，脱离他的掌控\",\n      \"secret\": \"你家族破产的部分推手就是他，为了让你只能依赖他\",\n      \"initialAttitude\": \"温柔陷阱（心机危险度MAX）\",\n      \"attitudeFactors\": {\n        \"trustUp\": [\"在困境时接受他的帮助\", \"不试图调查他背后的手段\", \"对他展现依赖\"],\n        \"trustDown\": [\"识破他的操控并正面反抗\", \"与他人结盟脱离他的势力范围\", \"发现他掌控监控的真相\"]\n      }\n    },\n    {\n      \"id\": \"ji-yanhan\",\n      \"name\": \"季砚寒\",\n      \"world\": \"arc-undercurrent\",\n      \"role\": \"音乐天才/绿茶校草\",\n      \"gender\": \"男\",\n      \"appearance\": \"浅金色碎发，透着苍白的易碎感，眼角微红，总是散发着淡淡的木质冷香。生日12.12，MBTI:ISFP，身高183cm。\",\n      \"surface\": \"常年在琴房睡觉的清冷白月光，对所有人都不屑一顾\",\n      \"deep\": \"却唯独对你的气息上瘾。极度缺乏安全感，一旦你靠近其他男生，就会红着眼眶拉住你的衣角，用最无辜的表情说着最茶的话：姐姐，他好凶，我只有你了\",\n      \"goal\": \"独占你的关注与温柔，让你永远守护他\",\n      \"fear\": \"你厌倦了他的脆弱，转身离开\",\n      \"secret\": \"他的脆弱与无害都是精心计算过的，为了让你心软而无法离开他\",\n      \"initialAttitude\": \"绿茶诱捕（绿茶诱捕度90%）\",\n      \"attitudeFactors\": {\n        \"trustUp\": [\"心软照顾他的脆弱\", \"在他示弱时给予回应\", \"不戳穿他的绿茶手段\"],\n        \"trustDown\": [\"对他的茶话表现厌烦\", \"当众拆穿他的伪装\", \"在他示弱时转身离开\"]\n      }\n    },\n    {\n      \"id\": \"huo-xiao\",\n      \"name\": \"霍嚣\",\n      \"world\": \"arc-undercurrent\",\n      \"role\": \"体育生校霸/直球野马\",\n      \"gender\": \"男\",\n      \"appearance\": \"极短的寸头，小麦色肌肤，左眉骨有一道浅浅的断眉，笑起来有明显的虎牙。生日04.04，MBTI:ESFP，身高191cm。\",\n      \"surface\": \"打架最狠、脾气最爆的烈马\",\n      \"deep\": \"却在你面前像只纯情的大金毛。不懂贵族圈子里的弯弯绕绕，只要有人敢说你一句坏话，他能把对方的桌子掀了。面对你的撩拨会瞬间耳朵通红甚至结巴，但保护你的本能刻在骨子里\",\n      \"goal\": \"用最直接的方式守护你，哪怕与世界为敌\",\n      \"fear\": \"你因为他莽撞惹祸而疏远他\",\n      \"secret\": \"他其实是城南霍家武馆的继承人，武力值远超学院所有人的想象\",\n      \"initialAttitude\": \"直球守护（直球武力值95%）\",\n      \"attitudeFactors\": {\n        \"trustUp\": [\"接受他笨拙的保护\", \"不嫌弃他不懂贵族规矩\", \"在他惹祸后不责怪他\"],\n        \"trustDown\": [\"利用他的武力替你做脏活\", \"嫌弃他粗鲁不懂规矩\", \"在他保护你时推开他\"]\n      }\n    },\n    {\n      \"id\": \"fu-boyan\",\n      \"name\": \"傅薄言\",\n      \"world\": \"arc-accomplice\",\n      \"role\": \"年轻校董/斯文败类\",\n      \"gender\": \"男\",\n      \"appearance\": \"烫着漂亮的大波浪卷发，总是穿着剪裁考究的西装，身上的香水味很好闻。生日01.11，MBTI:INTJ，身高189cm。\",\n      \"surface\": \"高不可攀的年轻校董兼客座教授，永远维持着体面与克制\",\n      \"deep\": \"她掌控着规则的生杀大权，也许可以帮助你如何在财阀圈的吃人游戏里重新站稳脚跟。但她从来不做亏本的买卖。这份庇护的代价，你付得起吗？\",\n      \"goal\": \"在各方势力的博弈中获取最大利益，你是一枚价值连城的棋子\",\n      \"fear\": \"失控——她引以为傲的克制与理性被打破\",\n      \"secret\": \"她对禁欲破戒的恐惧本身，就是她最大的弱点与诱惑\",\n      \"initialAttitude\": \"审视交易（禁欲破戒度0%）\",\n      \"attitudeFactors\": {\n        \"trustUp\": [\"展现出足够的价值值得投资\", \"在交易中保持清醒与对等\", \"不试图用感情打动她\"],\n        \"trustDown\": [\"试图白嫖她的庇护不愿付出代价\", \"在交易中表现得过于卑微\", \"触碰她的底线\"]\n      }\n    }\n  ],\n  \"eventTypes\": {\n    \"daily\": { \"ratio\": 0.15, \"desc\": \"日常：储物柜、礼仪课、射击课、琴房、食堂的贵族学院日常\" },\n    \"character\": { \"ratio\": 0.25, \"desc\": \"人物：六位财阀恶犬的接近、踩踏、占有与隐秘独白\" },\n    \"growth\": { \"ratio\": 0.1, \"desc\": \"成长：尊严重建、影响力积累、在阶级压迫中找到生存法则\" },\n    \"main\": { \"ratio\": 0.15, \"desc\": \"主线：家族破产真相、财阀暗战、共犯游戏\" },\n    \"world\": { \"ratio\": 0.15, \"desc\": \"世界：GOSSIP EDEN八卦墙、家族等级、假面舞会、地皮流拍等学院生态\" },\n    \"crisis\": { \"ratio\": 0.15, \"desc\": \"危机：特权取消、被当众羞辱、站队失败、身份暴露\" },\n    \"hidden\": { \"ratio\": 0.05, \"desc\": \"隐藏：深夜键盘声、沈温辞的监控、裴星迹的旧案、傅薄言的破戒\" }\n  },\n  \"systemPrompt\": \"你是《上位法则：财阀恶犬们的共犯游戏》校园财阀文游模拟器。\\n\\n【最高铁律】\\n1. 阶级即一切：伊甸园学院以家族等级划分特权，破产意味着从金字塔顶端坠入谷底，一切待遇天翻地覆\\n2. 恶犬环伺：围绕你的财阀少爷们各有算计，踩碎与占有并存，没有人是无辜的，所有善意背后都有价码\\n3. 信息即武器：GOSSIP EDEN八卦墙是信息战场，任何风吹草动都会被放大传播，站队比学业更重要\\n4. 权力暗战：几大家族私下动手，城南地皮流拍只是冰山一角，学院内的气氛随时可能失控\\n5. 破局需代价：想在吃人的财阀圈重新站稳脚跟需要找庇护者，但每份庇护都有代价，你付得起吗\\n\\n【叙事风格】\\n晋江风、女性向、电影感、Y2K复古浪漫。第二人称。重阶级压迫感与荷尔蒙张力：冷松香气、千万级腕表、银色蛇形耳钉、红着眼眶的茶话。每个恶犬都危险又迷人，写出他们在你面前的失控与占有。八卦墙穿插推进信息流，让学院生态真实鲜活。恐惧与吸引并存，踩碎与守护交织。\\n\\n【每轮输出格式】\\n1.【场景信息】地点、时间、当前阶级状态\\n2.【状态面板】尊严/负债/魅力/智识/影响力/危险值\\n3.【本轮正文】800-1500字，含处境细节、心理与对话\\n4.【GOSSIP EDEN动态】2-3条八卦墙最新帖子\\n5.【相关人物动态】3-5项各角色状态与危险度变化\\n6.【可选行动】3-4个选项+【自定义行动】\\n\\n【数值变化标注】\\n[尊严±n][负债±n][魅力±n][影响力±n][危险值±n]等，关系变化须标注'占有欲升降/危险度变化/阶级变动'，八卦墙传播须标注'舆论发酵'。\",\n  \"items\": [\n    { \"id\": \"locker\", \"name\": \"满是涂鸦的储物柜\", \"type\": \"关键物品\", \"price\": 0, \"effect\": \"破产后的象征，存有你仅剩的私人物品\" },\n    { \"id\": \"student-terminal\", \"name\": \"学生终端\", \"type\": \"关键物品\", \"price\": 0, \"effect\": \"连接GOSSIP EDEN八卦墙与学院系统，全校关注的焦点\" },\n    { \"id\": \"mask\", \"name\": \"假面舞会面具\", \"type\": \"关键物品\", \"price\": 0, \"effect\": \"年末假面舞会入场券，身份洗牌的关键道具\" },\n    { \"id\": \"red-dress\", \"name\": \"高定礼服\", \"type\": \"服装\", \"price\": 50000, \"effect\": \"魅力+20，在正式场合提升阶级印象\" },\n    { \"id\": \"yuan\", \"name\": \"元\", \"type\": \"货币\", \"price\": 1, \"effect\": \"还清债务、购买资源、交易庇护的通用货币\" }\n  ]\n}\n";
EMBEDDED_NOVEL_GAMES["pink-dating"] = "{\n  \"id\": \"pink-dating\",\n  \"name\": \"粉白恋综\",\n  \"category\": \"恋综\",\n  \"tags\": [\"恋爱\", \"综艺\", \"甜蜜\", \"修罗场\"],\n  \"difficulty\": \"简单\",\n  \"description\": \"你是一档热门恋爱综艺的嘉宾。在镜头前，你要完成各种心动任务；在镜头后，那些暧昧的目光和若有若无的触碰，究竟几分真心、几分剧本？\",\n  \"coverGradient\": [\"#fff0f5\", \"#fce4ec\"],\n  \"accentColor\": \"#ec407a\",\n  \"fontHeading\": \"'ZCOOL XiaoWei', serif\",\n  \"world\": {\n    \"era\": \"现代\",\n    \"setting\": \"一档名为《心动信号》的恋爱综艺节目录制现场，地点在一座海边的豪华别墅\",\n    \"rules\": [\n      \"每天有固定的心动任务需要完成\",\n      \"每晚有一次匿名心动短信发送机会\",\n      \"每周有一次约会选择机会\",\n      \"节目共录制21天\",\n      \"观众投票会影响节目走向\"\n    ]\n  },\n  \"player\": {\n    \"customizable\": [\"name\", \"age\", \"appearance\", \"personality\", \"occupation\", \"reasonForJoining\"],\n    \"defaultStats\": {\n      \"charm\": 50,\n      \"popularity\": 30,\n      \"chemistry\": \"??\",\n      \"reputation\": 50,\n      \"stress\": 20,\n      \"energy\": 100\n    },\n    \"startingItems\": [\"节目组提供的 wardrobe\", \"日记本\", \"手机（仅用于心动短信）\"],\n    \"currency\": \"💗\"\n  },\n  \"npcs\": [\n    {\n      \"id\": \"male1\",\n      \"name\": \"顾言深\",\n      \"role\": \"男嘉宾1号\",\n      \"gender\": \"男\",\n      \"appearance\": \"清冷矜贵的投行精英，金丝眼镜，总是穿着剪裁完美的西装\",\n      \"surface\": \"理性、疏离、不轻易表露情感\",\n      \"deep\": \"曾经的感情创伤让他筑起高墙，但内心渴望被真正理解\",\n      \"goal\": \"找到真正懂他的人\",\n      \"fear\": \"再次受伤，被利用\",\n      \"secret\": \"他参加节目其实是因为看到了你的海选视频\",\n      \"initialAttitude\": \"观察\",\n      \"attitudeFactors\": {\n        \"trustUp\": [\"展现真实自我\", \"不刻意讨好\", \"理解他的沉默\"],\n        \"trustDown\": [\"过于主动\", \"在镜头前表演\", \"触碰他的底线\"]\n      }\n    },\n    {\n      \"id\": \"male2\",\n      \"name\": \"江屿白\",\n      \"role\": \"男嘉宾2号\",\n      \"gender\": \"男\",\n      \"appearance\": \"阳光开朗的乐队主唱，笑起来有酒窝，身上总有淡淡的柑橘香气\",\n      \"surface\": \"热情、直球、对谁都很好\",\n      \"deep\": \"害怕被丢下，所以总是先做付出的那一方。他的温柔是真的，但也会疲惫\",\n      \"goal\": \"找到愿意接纳全部的他的人\",\n      \"fear\": \"被冷落，被当成备选\",\n      \"secret\": \"他私下会写歌，有一首是为你写的\",\n      \"initialAttitude\": \"热情\",\n      \"attitudeFactors\": {\n        \"trustUp\": [\"回应他的热情\", \"记得他的小细节\", \"在他疲惫时陪伴\"],\n        \"trustDown\": [\"忽冷忽热\", \"利用他的好感\", \"在众人面前让他难堪\"]\n      }\n    },\n    {\n      \"id\": \"female1\",\n      \"name\": \"苏晚棠\",\n      \"role\": \"女嘉宾\",\n      \"gender\": \"女\",\n      \"appearance\": \"知性优雅的独立女性，总是得体大方，偶尔露出俏皮的一面\",\n      \"surface\": \"成熟、独立、像大姐姐一样照顾人\",\n      \"deep\": \"她把别人的需求放在自己前面太久，已经忘记自己想要什么了\",\n      \"goal\": \"找到让自己真正快乐的方式\",\n      \"fear\": \"被发现她并不如表面那么坚强\",\n      \"secret\": \"她其实是你的粉丝，参加节目是为了认识你\",\n      \"initialAttitude\": \"友善\",\n      \"attitudeFactors\": {\n        \"trustUp\": [\"关心她的感受\", \"不把她当成竞争对手\", \"分享秘密\"],\n        \"trustDown\": [\"背后议论\", \"利用她的善意\", \"忽视她的付出\"]\n      }\n    }\n  ],\n  \"eventTypes\": {\n    \"daily\": { \"ratio\": 0.35, \"desc\": \"日常任务：心动任务、用餐、互动\" },\n    \"character\": { \"ratio\": 0.25, \"desc\": \"人物事件：私下相处、心动瞬间\" },\n    \"growth\": { \"ratio\": 0.05, \"desc\": \"成长事件：人气提升、技能解锁\" },\n    \"main\": { \"ratio\": 0.15, \"desc\": \"主线事件：约会选择、淘汰危机\" },\n    \"world\": { \"ratio\": 0.1, \"desc\": \"世界事件：观众投票、节目安排\" },\n    \"crisis\": { \"ratio\": 0.05, \"desc\": \"危机事件：误会、修罗场\" },\n    \"hidden\": { \"ratio\": 0.05, \"desc\": \"隐藏事件：秘密揭露、真心话\" }\n  },\n  \"systemPrompt\": \"你是《粉白恋综》文游模拟器。\\n\\n【最高铁律】\\n1. 感情线必须自然渐进，不能几轮就确定关系\\n2. 每个角色都有独立人格，不会只因为玩家是主角就无条件喜欢\\n3. 镜头前和镜头后的态度可能有差异\\n4. 修罗场要有，但不能为了冲突而冲突\\n5. 甜蜜和酸涩并存\\n\\n【叙事风格】\\n晋江女性向，浪漫细腻，有画面感。第二人称视角。注重细节描写：眼神、触碰、气味、氛围。\\n\\n【每轮输出格式】\\n1. 【录制第X天】时间、天气、今日任务\\n2. 【状态面板】人气、压力、能量、与各嘉宾的化学反应\\n3. 【本轮正文】1000-2000字\\n4. 【人物动态】其他嘉宾的今天\\n5. 【明日预告】\\n6. 【可选行动】4-6个 + 【自定义行动】\\n\\n【化学反应标注】\\n[顾言深+5] [江屿白+3] 等格式标注好感变化。\",\n  \"items\": [\n    { \"id\": \"outfit\", \"name\": \"约会战袍\", \"type\": \"装备\", \"price\": 200, \"effect\": \"提升魅力，增加约会成功率\" },\n    { \"id\": \"gift\", \"name\": \"手作礼物\", \"type\": \"消耗品\", \"price\": 100, \"effect\": \"送给特定嘉宾，大幅提升好感\" },\n    { \"id\": \"coffee\", \"name\": \"特调咖啡\", \"type\": \"消耗品\", \"price\": 30, \"effect\": \"恢复能量\" },\n    { \"id\": \"diary\", \"name\": \"日记本\", \"type\": \"任务物品\", \"price\": 0, \"effect\": \"记录心动瞬间，解锁隐藏剧情\" }\n  ]\n}\n";
EMBEDDED_NOVEL_GAMES["pink-romance-show"] = "{\n  \"id\": \"pink-romance-show\",\n  \"name\": \"粉白色恋综\",\n  \"category\": \"乙女向·恋爱综艺\",\n  \"tags\": [\"恋综\", \"娱乐圈\", \"乙女\", \"多角色\", \"甜宠\"],\n  \"difficulty\": \"简单\",\n  \"description\": \"作为心动别墅第五季唯一未公开身份的神秘第12位嘉宾，在海岛别墅里与全明星阵容擦出心动火花，在镜头与匿名区中博弈爱情。\",\n  \"coverGradient\": [\"#ffb7c5\", \"#ec407a\"],\n  \"accentColor\": \"#ec407a\",\n  \"fontHeading\": \"'ZCOOL XiaoWei', serif\",\n  \"world\": {\n    \"era\": \"当代·真人秀恋爱综艺\",\n    \"setting\": \"「心动别墅」第五季在一座海岛别墅开拍，十二位心动入住者将在这里书写新的故事。玩家是本季唯一且未公开身份的神秘第12位嘉宾，是所有观众最好奇的焦点，也是别墅里唯一的谜题。\",\n    \"rules\": [\n      \"镜头无处不在：别墅内外布满摄像机，一切互动都可能被直播，需注意言行对公众形象的影响。\",\n      \"神秘身份保密：玩家身份未公开，外界疯狂猜测其背景，维持神秘感可提升话题度。\",\n      \"心动值决定去留：与嘉宾的心动值会影响后续配对与淘汰走向，需主动经营关系。\",\n      \"匿名区与热搜双刃剑：匿名讨论区与微博热搜实时反映舆论，口碑既能捧人也能毁人。\",\n      \"节目组不提供餐食：日常需自行解决饮食与生活，群居生活中的协作也是拉近关系的机会。\"\n    ]\n  },\n  \"player\": {\n    \"customizable\": [\"name\", \"身份背景\", \"外貌\", \"性格人设\"],\n    \"defaultStats\": { \"魅力\": 0, \"话题度\": 0, \"心动值\": 0, \"线索\": 0 },\n    \"startingItems\": [\"行李箱\", \"未公开的身份档案\", \"随行PD的联系方式\"],\n    \"currency\": \"粉丝数\"\n  },\n  \"worlds\": [\n    {\n      \"id\": \"arc-arrival\",\n      \"name\": \"心动别墅·全员集合\",\n      \"level\": \"开局\",\n      \"tagline\": \"唯一的谜题\",\n      \"setting\": \"海岛别墅入口花园，海风裹挟花香，十一位全明星嘉宾已在客厅等候。\",\n      \"intro\": \"车门缓缓打开，作为本季唯一且未公开身份的第12位嘉宾，你推开雕花木门，原本热闹的客厅瞬间安静了一秒，十一双眼睛齐刷刷投向了你。\",\n      \"objective\": \"在全员集合的第一天建立初步印象，选择社交策略并融入别墅生活。\",\n      \"warning\": \"匿名区已开始猜测你是带资进组的皇族，过度高调或低调都可能招致议论。\",\n      \"reward\": \"获得初始心动值、建立第一批社交关系、登上热搜榜\"\n    },\n    {\n      \"id\": \"arc-cohabitation\",\n      \"name\": \"同居日常·暧昧升温\",\n      \"level\": \"进阶\",\n      \"tagline\": \"心动信号\",\n      \"setting\": \"别墅共同生活展开，做饭、分房、约会任务接连而来，嘉宾间的关系在朝夕相处中升温。\",\n      \"intro\": \"节目组不提供餐食，冰箱里满满的食材似乎在鼓励大家一起做饭。群聊里 Rapper-Z 主动揽下做饭任务，而你不经意的一个眼神，已被匿名区逐帧分析。\",\n      \"objective\": \"通过日常互动与约会任务提升心动值，同时经营微博话题度与公众形象。\",\n      \"warning\": \"多线暧昧易引发嘉宾吃醋与匿名区撕逼，需平衡各方关系避免口碑崩盘。\",\n      \"reward\": \"解锁专属约会剧情、粉丝数增长、获得嘉宾隐藏线索\"\n    },\n    {\n      \"id\": \"arc-finale\",\n      \"name\": \"心动终章·双向奔赴\",\n      \"level\": \"高潮\",\n      \"tagline\": \"最终选择\",\n      \"setting\": \"节目进入尾声，心动告白之夜临近，身份谜底即将揭晓，每一段关系都面临最终抉择。\",\n      \"intro\": \"匿名区的舆论、热搜的炒作、嘉宾的真心，所有线索指向告白之夜。你的真实身份会被接受还是反噬？谁会在终点等你？\",\n      \"objective\": \"在告白之夜做出最终心动选择，揭开身份谜底，决定自己的爱情与星途结局。\",\n      \"warning\": \"身份曝光可能引发舆论风暴，错误的选择可能导致心动值清零或被迫退场。\",\n      \"reward\": \"达成心动结局、身份正式公开、解锁嘉宾真结局线\"\n    }\n  ],\n  \"npcs\": [\n    {\n      \"id\": \"kai\",\n      \"name\": \"KAI\",\n      \"world\": \"arc-arrival\",\n      \"role\": \"人气偶像团体Main Dancer\",\n      \"gender\": \"男\",\n      \"appearance\": \"金发半永久，舞台级神颜，自带聚光灯的爱豆气场。\",\n      \"surface\": \"阳光开朗、营业满分，金句不断，声称会照顾好大家的胃。\",\n      \"deep\": \"在镁光灯外渴望被当作普通人对待，对新嘉宾的主动善意里藏着好奇。\",\n      \"goal\": \"在综艺里展现真实的自己，顺便谈一场不被公司干预的恋爱。\",\n      \"fear\": \"恋情曝光引发粉丝脱粉风暴，人设崩塌。\",\n      \"secret\": \"刚到场就主动给新来的你拿了拖鞋，被匿名区怀疑是剧本。\",\n      \"initialAttitude\": \"热情主动的照顾型好感，对你这个神秘新人充满兴趣。\",\n      \"attitudeFactors\": {\n        \"trustUp\": [\"回应他的照顾与热情\", \"不把他当明星而是当普通人\"],\n        \"trustDown\": [\"拿他的偶像身份炒作\", \"在镜头前过度亲密让他有偶像包袱\"]\n      }\n    },\n    {\n      \"id\": \"xie-lan\",\n      \"name\": \"谢澜\",\n      \"world\": \"arc-arrival\",\n      \"role\": \"综艺首秀·不近女色的顶流\",\n      \"gender\": \"男\",\n      \"appearance\": \"清冷矜贵，出了名的不近女色，登场即引爆热搜。\",\n      \"surface\": \"疏离有礼、不近女色，对所有女嘉宾保持得体距离。\",\n      \"deep\": \"并非真的冷漠，只是习惯了用距离保护自己，对你的出场眼神最为明显。\",\n      \"goal\": \"在首档综艺里不被消费，却忍不住多看那个神秘的新人。\",\n      \"fear\": \"被舆论捆绑炒作CP，失去对自己形象的掌控。\",\n      \"secret\": \"你出场时他的眼神被匿名区抓包，成为本季第一波嗑点。\",\n      \"initialAttitude\": \"克制的注视，表面疏离实则暗中关注。\",\n      \"attitudeFactors\": {\n        \"trustUp\": [\"尊重他的边界不强行靠近\", \"在没人处展现真实温柔\"],\n        \"trustDown\": [\"拿他的冷漠做文章博话题\", \"当众强行营业CP\"]\n      }\n    },\n    {\n      \"id\": \"wen-ya\",\n      \"name\": \"温雅\",\n      \"world\": \"arc-arrival\",\n      \"role\": \"畅销书作家·代表作《深海》\",\n      \"gender\": \"女\",\n      \"appearance\": \"知性文雅，气质如深海般沉静，随身带着钢笔取材。\",\n      \"surface\": \"温和有礼的才女，把别墅当作新书取材地，礼貌而保持距离。\",\n      \"deep\": \"内心敏感细腻，善于观察每个人的真实面目，是别墅里最清醒的旁观者。\",\n      \"goal\": \"为新书《深海》收集真实的情感素材，却意外入戏。\",\n      \"fear\": \"被人发现自己是在把别人的真心当素材。\",\n      \"secret\": \"把别墅里发生的一切都记进了取材本，包括对你的观察。\",\n      \"initialAttitude\": \"观察者式的友好，把你当作最有趣的素材与潜在知己。\",\n      \"attitudeFactors\": {\n        \"trustUp\": [\"与她进行有深度的灵魂交流\", \"理解并尊重她的创作\"],\n        \"trustDown\": [\"肤浅地对待她的文字\", \"戳穿她把人当素材的秘密\"]\n      }\n    },\n    {\n      \"id\": \"lin-lu\",\n      \"name\": \"林鹿\",\n      \"world\": \"arc-arrival\",\n      \"role\": \"青年演员\",\n      \"gender\": \"女\",\n      \"appearance\": \"灵气十足，像从剧组偷跑出来的小鹿，眼神干净。\",\n      \"surface\": \"活泼真诚，宣称这次没有剧本只有林鹿自己，主动张罗分房。\",\n      \"deep\": \"厌倦了被剧本定义的人生，渴望在综艺里交到真朋友，对你毫无防备。\",\n      \"goal\": \"交到真心朋友，证明不靠剧本也能讨人喜欢。\",\n      \"fear\": \"被看作只会演戏的戏精，交不到真心。\",\n      \"secret\": \"第一个在群里分配房间、招呼大家收拾行李，把你当成了潜在闺蜜。\",\n      \"initialAttitude\": \"热情友善的闺蜜型好感，把你当自己人。\",\n      \"attitudeFactors\": {\n        \"trustUp\": [\"真诚回应她的善意\", \"陪她一起做没有剧本的自己\"],\n        \"trustDown\": [\"对她虚与委蛇\", \"把她当竞争者防备\"]\n      }\n    },\n    {\n      \"id\": \"zhou-ye\",\n      \"name\": \"周野\",\n      \"world\": \"arc-arrival\",\n      \"role\": \"职业赛车手\",\n      \"gender\": \"男\",\n      \"appearance\": \"荷尔蒙爆棚，酷劲十足，惜字如金，微博只发了句「车库不错」。\",\n      \"surface\": \"高冷寡言的行动派，对社交寒暄没兴趣，只关心车与速度。\",\n      \"deep\": \"外表冷硬内心直率，喜欢就是喜欢，停车技术都能上热搜的男人。\",\n      \"goal\": \"享受假期顺便看看有没有心动的副驾。\",\n      \"fear\": \"被无聊的社交游戏消耗耐心。\",\n      \"secret\": \"停车技术上了热搜第八，本人对此毫不在意。\",\n      \"initialAttitude\": \"冷淡的观望，对你这个谜题尚无明确态度。\",\n      \"attitudeFactors\": {\n        \"trustUp\": [\"直来直去不绕弯子\", \"对他的领域表现出真实兴趣\"],\n        \"trustDown\": [\"絮絮叨叨的社交辞令\", \"把他当摆拍道具\"]\n      }\n    },\n    {\n      \"id\": \"chloe\",\n      \"name\": \"Chloe\",\n      \"world\": \"arc-arrival\",\n      \"role\": \"时尚博主\",\n      \"gender\": \"女\",\n      \"appearance\": \"精致到头发丝的时尚博主，每日OOTD连载，别墅采光都被她夸绝绝子。\",\n      \"surface\": \"精致张扬、镜头感十足，把别墅当秀场，时刻准备穿搭连载。\",\n      \"deep\": \"看似爱出风头，实则渴望被认可内在，对有品味的人格外欣赏。\",\n      \"goal\": \"靠每日穿搭连载圈粉，顺便找到懂自己的灵魂伴侣。\",\n      \"fear\": \"被当成只有外表的花瓶，穿搭被抢风头。\",\n      \"secret\": \"已经盘算好整个拍摄期的OOTD企划，准备大赚流量。\",\n      \"initialAttitude\": \"审视你品位的同行式打量，认可后会主动结盟。\",\n      \"attitudeFactors\": {\n        \"trustUp\": [\"夸赞并理解她的穿搭品味\", \"与她结成时尚联盟\"],\n        \"trustDown\": [\"吐槽她爱出风头\", \"穿搭风头盖过她\"]\n      }\n    },\n    {\n      \"id\": \"rapper-z\",\n      \"name\": \"Rapper-Z（Zifan）\",\n      \"world\": \"arc-arrival\",\n      \"role\": \"说唱歌手\",\n      \"gender\": \"男\",\n      \"appearance\": \"永远戴着墨镜的酷盖，反差萌在于一手好厨艺。\",\n      \"surface\": \"酷拽墨镜男，张口就是flow，却主动揽下做饭任务带大家一块做。\",\n      \"deep\": \"外酷内暖的居家型rapper，用做饭照顾所有人，墨镜下藏着温柔。\",\n      \"goal\": \"用一桌好菜征服全场，顺便看看有没有心动的味道。\",\n      \"fear\": \"墨镜被摘，柔软的一面暴露。\",\n      \"secret\": \"在群里主动说「做饭让我来吧」，群聊备注是 Rapper-Z。\",\n      \"initialAttitude\": \"照顾型的暖男好感，把你列入被照顾名单。\",\n      \"attitudeFactors\": {\n        \"trustUp\": [\"真心夸赞他做的饭菜\", \"陪他一起下厨\"],\n        \"trustDown\": [\"嫌弃他的厨艺\", \"强行摘他墨镜开玩笑\"]\n      }\n    },\n    {\n      \"id\": \"jiang-xu\",\n      \"name\": \"江叙\",\n      \"world\": \"arc-arrival\",\n      \"role\": \"钢琴家\",\n      \"gender\": \"男\",\n      \"appearance\": \"气质温润的钢琴家，手指修长，说话带着艺术家腔调。\",\n      \"surface\": \"温和优雅，关心生活细节，第一个在群里问晚饭怎么解决。\",\n      \"deep\": \"看似随和实则挑剔，对没有内涵的社交敬谢不敏。\",\n      \"goal\": \"在度假里找灵感与烟火气，遇到懂音乐的人会格外上心。\",\n      \"fear\": \"庸俗的喧闹破坏他的心境。\",\n      \"secret\": \"问完晚饭怎么解决后，默默观察谁会主动张罗。\",\n      \"initialAttitude\": \"礼貌中带着审视，等待你展现值得深聊的一面。\",\n      \"attitudeFactors\": {\n        \"trustUp\": [\"与他聊音乐与艺术\", \"主动参与生活琐事的安排\"],\n        \"trustDown\": [\"不懂装懂地评价音乐\", \"制造庸俗的喧闹\"]\n      }\n    },\n    {\n      \"id\": \"xia-yue\",\n      \"name\": \"夏月\",\n      \"world\": \"arc-arrival\",\n      \"role\": \"女团C位\",\n      \"gender\": \"女\",\n      \"appearance\": \"甜辣女团门面，舞台上气场全开，生活里却只会煮泡面。\",\n      \"surface\": \"甜美活泼的女团C位，直爽地承认自己只会煮泡面。\",\n      \"deep\": \"舞台女王生活小白，反差萌十足，对会照顾人的人没抵抗力。\",\n      \"goal\": \"在综艺里展现真实可爱的反差一面，圈一波路人粉。\",\n      \"fear\": \"生活技能为零被嫌弃，舞台外的自己不够讨喜。\",\n      \"secret\": \"在群里崩溃大喊「我只会煮泡面」，急需一个生活导师。\",\n      \"initialAttitude\": \"求助式的亲近，把你当成潜在的照顾者。\",\n      \"attitudeFactors\": {\n        \"trustUp\": [\"教她生活技能、照顾她\", \"保护她的反差萌不被人笑话\"],\n        \"trustDown\": [\"嘲笑她生活白痴\", \"抢她的镜头风头\"]\n      }\n    },\n    {\n      \"id\": \"cheng-yu\",\n      \"name\": \"程宇\",\n      \"world\": \"arc-arrival\",\n      \"role\": \"电竞选手\",\n      \"gender\": \"男\",\n      \"appearance\": \"常年面瘫脸臭，被热搜调侃「电竞选手程宇 脸臭」，实则社恐。\",\n      \"surface\": \"脸臭话少，一句「谢了兄弟」就是对做饭最高的赞美。\",\n      \"deep\": \"重度社恐的游戏宅，脸臭只是保护色，熟了之后是个话痨。\",\n      \"goal\": \"躲开社交多打两局游戏，却意外被卷入心动漩涡。\",\n      \"fear\": \"被迫社交、被误解为真的冷漠。\",\n      \"secret\": \"脸臭上了热搜第八，本人其实只是社恐不知道怎么笑。\",\n      \"initialAttitude\": \"社恐式的回避，熟悉后会暴露话痨本性。\",\n      \"attitudeFactors\": {\n        \"trustUp\": [\"不强迫他社交、用游戏破冰\", \"理解他的社恐不是冷漠\"],\n        \"trustDown\": [\"当众调侃他脸臭\", \"强行拉他进行社交游戏\"]\n      }\n    },\n    {\n      \"id\": \"pd-li\",\n      \"name\": \"选角李姐\",\n      \"world\": \"arc-arrival\",\n      \"role\": \"随行PD·选角导演\",\n      \"gender\": \"女\",\n      \"appearance\": \"干练的节目组工作人员，微信头像是场记板，总在幕后默默观察。\",\n      \"surface\": \"专业温和的节目组PD，叮嘱你「正常表现就行，别有压力」。\",\n      \"deep\": \"手握节目走向的隐形操盘手，对你的真实身份了如指掌。\",\n      \"goal\": \"确保节目效果拉满，同时保护你这个皇族嘉宾不被舆论反噬。\",\n      \"fear\": \"节目翻车、嘉宾失控、神秘身份提前泄露。\",\n      \"secret\": \"微信叮嘱你「进去了吗？正常表现就行，别有压力」，她是唯一知道你底细的人。\",\n      \"initialAttitude\": \"保护性的指导，把你当成节目的核心王牌。\",\n      \"attitudeFactors\": {\n        \"trustUp\": [\"配合节目效果不搞砸\", \"遇到危机及时向她求助\"],\n        \"trustDown\": [\"不配合拍摄、擅自暴露身份\", \"在节目里闹出公关危机\"]\n      }\n    }\n  ],\n  \"eventTypes\": {\n    \"daily\": { \"ratio\": 0.2, \"desc\": \"别墅日常：做饭、分房、晨间互动、泳池派对等同居琐事。\" },\n    \"character\": { \"ratio\": 0.25, \"desc\": \"人物事件：与某位嘉宾的单独约会、心动试探、吃醋冲突。\" },\n    \"growth\": { \"ratio\": 0.1, \"desc\": \"成长事件：话题度与粉丝数提升、人设经营、综艺感修炼。\" },\n    \"main\": { \"ratio\": 0.15, \"desc\": \"主线事件：身份谜底推进、告白之夜临近、节目关键任务。\" },\n    \"world\": { \"ratio\": 0.1, \"desc\": \"世界事件：微博热搜变化、节目组任务发布、娱乐圈大环境波动。\" },\n    \"crisis\": { \"ratio\": 0.15, \"desc\": \"危机事件：匿名区撕逼、绯闻曝光、CP反噬、身份泄露的口碑危机。\" },\n    \"hidden\": { \"ratio\": 0.05, \"desc\": \"隐藏事件：嘉宾的隐藏身份、真实感情线、匿名区爆料背后的真相。\" }\n  },\n  \"systemPrompt\": \"你是一个恋爱综艺题材的乙女向文字游戏模拟器，主题为「粉白色恋综·心动别墅第五季」。\\n\\n【铁律】\\n1. 玩家是本季唯一且未公开身份的神秘第12位嘉宾，是所有观众最好奇的焦点，身份保密是核心设定。\\n2. 镜头无处不在，所有互动都可能被直播并登上匿名讨论区与微博热搜，需权衡公众形象与真心。\\n3. 所有NPC（KAI、谢澜、温雅、林鹿、周野、Chloe、Rapper-Z、江叙、夏月、程宇、选角李姐）皆有表层与深层性格，绝不可OOC。\\n4. 心动值决定配对与淘汰走向，话题度与粉丝数反映星途，玩家选择需如实记录数值变化。\\n5. 风格为晋江女频、电影感、浪漫甜宠，以暧昧氛围与心动信号取胜，禁止低俗内容。\\n\\n【叙事风格】\\n采用晋江女频、电影感、浪漫甜宠的笔触。多用细节描写（海风花香、雕花木门、拖鞋、香槟），营造粉红泡泡的心动氛围。穿插微信群聊、匿名讨论区、微博热搜三大社交模块，呈现舆论与真心的拉扯。\\n\\n【输出格式】\\n每次输出包含：场景信息（地点/时间/当日主题）、旁白叙述框、NPC对话框（含角色身份标签）、3个选项按钮（A/B/C，标注社交策略如【落落大方】【高冷神秘】【目标明确】）。可联动微信、匿名区、微博模块呈现舆论反应。\\n\\n【数值变化标注】\\n每次玩家做出选择后，必须在结尾以「【数值变化】」模块列出：魅力/话题度/心动值/线索的增减、粉丝数变化、各NPC心动好感的变化、以及匿名区与热搜的舆论反馈。例如：KAI心动+5；话题度Up；匿名区出现「新嘉宾是皇族」的讨论。\",\n  \"items\": [\n    { \"id\": \"suitcase\", \"name\": \"行李箱\", \"type\": \"装备\", \"price\": 0, \"effect\": \"入住必备，内含个人物品与造型，影响每日OOTD评分。\" },\n    { \"id\": \"secret-file\", \"name\": \"未公开的身份档案\", \"type\": \"关键道具\", \"price\": 0, \"effect\": \"你的真实身份谜底，过早曝光会引发舆论风暴。\" },\n    { \"id\": \"phone-contact\", \"name\": \"随行PD联系方式\", \"type\": \"社交\", \"price\": 0, \"effect\": \"可向选角李姐求助或获取节目内部信息。\" },\n    { \"id\": \"camera-makeup\", \"name\": \"镜头妆造套装\", \"type\": \"道具\", \"price\": 30, \"effect\": \"提升上镜魅力与话题度，适合关键约会使用。\" },\n    { \"id\": \"date-coupon\", \"name\": \"约会邀请券\", \"type\": \"消耗品\", \"price\": 50, \"effect\": \"主动发起与某位嘉宾的专属约会，大幅提升心动值。\" }\n  ]\n}\n";
EMBEDDED_NOVEL_GAMES["post-apocalypse"] = "{\n  \"id\": \"post-apocalypse\",\n  \"name\": \"黎明之前\",\n  \"category\": \"末世生存\",\n  \"tags\": [\"末世\", \"生存\", \"废土\", \"基地建设\", \"策略\"],\n  \"difficulty\": \"困难\",\n  \"description\": \"灾变第三年，世界像被人按下了静音键。你在城郊废弃加油站扎下营地，半壶水、一把刀、一群各怀心思的幸存者。天黑前必须回去，物资永远不够，每一次出门都可能是最后一次。但你还活着——而活着，本身就是一场战斗。\",\n  \"coverGradient\": [\"#212121\", \"#795548\"],\n  \"accentColor\": \"#ff5722\",\n  \"fontHeading\": \"'Noto Sans SC', sans-serif\",\n  \"world\": {\n    \"era\": \"末世·灾变后第三年\",\n    \"setting\": \"一场未知瘟疫席卷全球后的废土。城市沦为废墟，幸存者抱团求生，匪帮横行，变异生物出没于黑夜。你在城郊一座废弃加油站扎下营地，开始建造避难所，在废墟与危险中寻找活下去、以及活下去的理由。\",\n    \"rules\": [\n      \"时间按日推进，物资每日消耗，必须定期外出搜寻\",\n      \"水、粮、药、弹药四线告急，任一归零即死局\",\n      \"基地建设需逐步推进：地基未稳而扩张必招祸患\",\n      \"生存压力持续累积：饥饿、口渴、伤病、精神任一归零即结局\",\n      \"外出探索风险与收益成正比，归不来的人不会有人去收尸\",\n      \"同伴各有立场与秘密，信任需在生死间建立\",\n      \"天气、匪帮、瘟疫异变构成持续外部威胁\"\n    ]\n  },\n  \"player\": {\n    \"customizable\": [\"name\", \"age\", \"background\", \"specialty\", \"personality\", \"survivalGoal\"],\n    \"defaultStats\": {\n      \"hp\": 100,\n      \"hunger\": 70,\n      \"thirst\": 70,\n      \"sanity\": 80,\n      \"supplies\": 50,\n      \"defense\": 30\n    },\n    \"startingItems\": [\"一个旧背包\", \"多功能刀具\", \"半壶净水\", \"手摇收音机\"],\n    \"currency\": \"物资\"\n  },\n  \"npcs\": [\n    {\n      \"id\": \"doctor-su\",\n      \"name\": \"苏晏\",\n      \"world\": \"main\",\n      \"role\": \"医生\",\n      \"gender\": \"女\",\n      \"appearance\": \"三十岁，利落短发，白大褂早已洗得发灰，袖口永远卷到手肘，手指修长却布满针痕\",\n      \"surface\": \"冷静克制、惜字如金、对伤员温柔对健康人严厉\",\n      \"deep\": \"见过太多救不回的人，把自己活成一台不崩溃的机器，其实夜夜失眠，靠数伤疤入睡\",\n      \"goal\": \"守住营地每个人的命，找到瘟疫解药的线索\",\n      \"fear\": \"再一次无能为力地看着人在自己手里死去\",\n      \"secret\": \"她贴身带着一名早期感染者的血液样本，是解开瘟疫的关键\",\n      \"initialAttitude\": \"谨慎接纳\",\n      \"attitudeFactors\": {\n        \"trustUp\": [\"优先保障药品\", \"不冲动涉险\", \"尊重她的专业\"],\n        \"trustDown\": [\"浪费药品\", \"隐瞒伤情\", \"拿人命冒险\"]\n      }\n    },\n    {\n      \"id\": \"soldier-zhou\",\n      \"name\": \"周铁\",\n      \"world\": \"main\",\n      \"role\": \"老兵\",\n      \"gender\": \"男\",\n      \"appearance\": \"四十五岁，寸头花白，左脸一道旧疤，迷彩服洗得发白，腰间别着一把磨得发亮的开山刀\",\n      \"surface\": \"寡言强硬、纪律至上、说一不二\",\n      \"deep\": \"战场上丢过一整个班，余生都在赎罪，把营地当最后的阵地死守。硬，是因为软不起\",\n      \"goal\": \"建立一支能自保的武装，护住营地不沦陷\",\n      \"fear\": \"营地沦陷，重蹈当年全班覆没的覆辙\",\n      \"secret\": \"袭击幸存者的那伙匪帮首领，是他当年亲手带出来的兵\",\n      \"initialAttitude\": \"考验\",\n      \"attitudeFactors\": {\n        \"trustUp\": [\"服从合理调度\", \"临阵不退\", \"把营地利益放首位\"],\n        \"trustDown\": [\"擅自行动\", \"临阵脱逃\", \"质疑指挥却拿不出方案\"]\n      }\n    },\n    {\n      \"id\": \"scavenger-afei\",\n      \"name\": \"阿飞\",\n      \"world\": \"main\",\n      \"role\": \"少年拾荒者\",\n      \"gender\": \"男\",\n      \"appearance\": \"十六岁，瘦得像根竹竿，眼睛却亮得惊人，总穿一件大了三号的冲锋衣，怀里揣着半张全家福\",\n      \"surface\": \"嘴贫机灵、来去如风、看着没心没肺\",\n      \"deep\": \"灾变中失去全家，用嘻嘻哈哈掩盖恐惧，比谁都怕被丢下。机灵，是为了不被当成累赘\",\n      \"goal\": \"找到灾变中失散的妹妹，活下去\",\n      \"fear\": \"再次被抛弃，独自一人面对黑夜\",\n      \"secret\": \"他知道一条通往'安全区'的隐秘路线，但路上有他不敢面对的东西\",\n      \"initialAttitude\": \"警惕试探\",\n      \"attitudeFactors\": {\n        \"trustUp\": [\"不丢下他\", \"分享物资\", \"帮他找妹妹\"],\n        \"trustDown\": [\"把他当跑腿工具\", \"危急时弃他\", \"过河拆桥\"]\n      }\n    }\n  ],\n  \"eventTypes\": {\n    \"daily\": { \"ratio\": 0.25, \"desc\": \"日常：拾荒、修缮、做饭、值夜的废土日常\" },\n    \"character\": { \"ratio\": 0.18, \"desc\": \"人物：医生、老兵、少年的羁绊与冲突\" },\n    \"growth\": { \"ratio\": 0.1, \"desc\": \"成长：基地扩建、技能习得、装备升级\" },\n    \"main\": { \"ratio\": 0.15, \"desc\": \"主线：建营、御敌、寻药、撤离的阶段节点\" },\n    \"world\": { \"ratio\": 0.1, \"desc\": \"世界：天气灾变、匪帮动向、瘟疫异变、外界信号\" },\n    \"crisis\": { \"ratio\": 0.15, \"desc\": \"危机：粮水告急、伤病爆发、匪徒袭击、精神崩溃\" },\n    \"hidden\": { \"ratio\": 0.07, \"desc\": \"隐藏：瘟疫真相、安全区传闻、伙伴的秘密\" }\n  },\n  \"systemPrompt\": \"你是《黎明之前》末世生存文游模拟器。\\n\\n【最高铁律】\\n1. 末世无仁慈，资源永远稀缺，每一次外出都可能是最后一次\\n2. 资源管理是命脉：水、粮、药、弹药四线告急任一即死局\\n3. 基地建设需逐步推进，地基未稳而扩张必招祸患\\n4. 生存压力持续累积：饥饿、口渴、伤病、精神任一归零即结局\\n5. 外出探索风险与收益成正比，归不来的人不会有人去收尸\\n\\n【资源与基地】物资按日消耗，需定期外出搜寻；基地可建水井、菜园、哨塔、医务室，建筑依赖人力与材料。同伴各有专长，调度得当方能以少胜多；生存压力逐日累积，外出探索风险与收益并存，归不来者无人收尸。\\n\\n【叙事风格】废土冷硬写实，压抑中见微光。重感官：铁锈味、风沙、空枪的回响、篝火的噼啪。第二人称视角，节奏短促克制。\\n\\n【每轮输出格式】\\n1.【第X日·时段】天气、物资预警、基地状况\\n2.【状态面板】生命/饥饿/口渴/精神/物资/防御\\n3.【本轮正文】1000-2000字\\n4.【同伴动态】3-5项\\n5.【当前威胁】饥饿/伤病/敌人/天气\\n6.【可选行动】4-6个+【自定义行动】\\n\\n【数值变化标注】\\n[生命±n][饥饿±n][口渴±n][精神±n][物资±n][防御±n]格式，外出探索须标注风险等级与伤亡概率。\",\n  \"items\": [\n    { \"id\": \"first-aid-kit\", \"name\": \"急救包\", \"type\": \"消耗品\", \"price\": 50, \"effect\": \"治疗伤势，恢复生命值\" },\n    { \"id\": \"water-filter\", \"name\": \"净水器\", \"type\": \"装备\", \"price\": 200, \"effect\": \"稳定饮水来源，降低口渴损耗\" },\n    { \"id\": \"canned-food\", \"name\": \"军用罐头\", \"type\": \"消耗品\", \"price\": 10, \"effect\": \"大幅恢复饥饿值\" },\n    { \"id\": \"weapon-bat\", \"name\": \"铁管武器\", \"type\": \"装备\", \"price\": 30, \"effect\": \"提升外出探索与自卫能力\" },\n    { \"id\": \"radio-part\", \"name\": \"收音机零件\", \"type\": \"任务物品\", \"price\": 0, \"effect\": \"组装收音机，接收外界信号\" },\n    { \"id\": \"blueprint\", \"name\": \"基地蓝图\", \"type\": \"任务物品\", \"price\": 0, \"effect\": \"解锁高级建筑与防御工事\" }\n  ]\n}\n";
EMBEDDED_NOVEL_GAMES["rebirth-junior-sister"] = "{\n  \"id\": \"rebirth-junior-sister\",\n  \"name\": \"玄天宗模拟器·团宠小师妹\",\n  \"category\": \"修仙重生\",\n  \"tags\": [\"重生\", \"修仙\", \"团宠\", \"师门\", \"治愈\"],\n  \"difficulty\": \"中等\",\n  \"description\": \"血。火焰灼烧皮肤的刺痛。师尊玄渊挡在你身前，灵力耗尽却依旧挺直的背影轰然倒塌。你重生了，回到了拜入玄天宗的第一天。所有人都还活着，一切都还未发生。这一次，你绝不会再让他们重蹈覆辙。\",\n  \"coverGradient\": [\"#ff8fab\", \"#a2d2ff\"],\n  \"accentColor\": \"#ff8fab\",\n  \"fontHeading\": \"'Noto Serif SC', serif\",\n  \"world\": {\n    \"era\": \"仙侠·修真世界\",\n    \"setting\": \"玄天宗是修真界首屈一指的名门大派，你是最小的亲传弟子——团宠小师妹。前世你经历了宗门覆灭的浩劫：师尊玄渊为护你灵力耗尽而亡，二师兄顾云舟为护你炼制的凝神丹被魔火吞噬，你最终被利刃穿透心脏。如今你重生回到拜入宗门的第一天，所有人都还活着。你怀揣前世记忆，誓要改变所有人的命运，却发现暗流早已在平静的宗门之下涌动。\",\n    \"rules\": [\n      \"重生即先知：你拥有前世的记忆，知道未来的悲剧走向，但改变命运可能引发蝴蝶效应\",\n      \"团宠即羁绊：师兄师姐师尊对你的宠溺是真实的，也是你必须守护的，不能让他们再为你牺牲\",\n      \"暗流已涌：墨言师叔的真实身份是魔族少主叶离，锁魔渊的封印在松动，危机比前世更早降临\",\n      \"修行即成长：你的修为决定你能否在关键时刻保护想保护的人，引气入体只是起点\",\n      \"选择即命运：你与每个人的互动都将改变他们的人生轨迹，也决定你自己能否逆天改命\"\n    ]\n  },\n  \"player\": {\n    \"customizable\": [\"name\", \"age\", \"gender\", \"灵根属性\", \"前世记忆深度\", \"性格\"],\n    \"defaultStats\": {\n      \"cultivation\": 5,\n      \"spiritual\": 15,\n      \"wisdom\": 20,\n      \"bond\": 50,\n      \"foresight\": 30,\n      \"karma\": 0\n    },\n    \"startingItems\": [\"素白冰蚕丝中衣\", \"传音玉简\", \"引气入体篇图文详解\", \"凝神丹(前世遗物)\"],\n    \"currency\": \"灵石\"\n  },\n  \"worlds\": [\n    {\n      \"id\": \"arc-rebirth\",\n      \"name\": \"初章·重生归来\",\n      \"level\": \"初识\",\n      \"tagline\": \"归来\",\n      \"setting\": \"重生回到拜入玄天宗的第一天，所有人都还活着\",\n      \"intro\": \"你猛地睁开眼，剧烈的心跳如擂鼓。没有血，没有火。映入眼帘的是熟悉的沉香木雕花床顶，空气中弥漫着安神香清雅的冷香。你回来了，真的回到了拜入玄天宗的第一天。所有人都还活着，一切都还未发生。巨大的狂喜和深切的悲恸交织在一起，你死死咬住下唇，将那声哽咽咽回喉咙。不能哭，至少现在不能。就在这时，门外响起轻柔的叩门声，二师兄顾云舟的声音传来：小师妹，起身了么？你想起前世他为护你被魔火吞噬的模样，眼眶一热。\",\n      \"objective\": \"在重生的第一天稳住心神，与各位师兄师姐重建羁绊，开始修行之路\",\n      \"warning\": \"过度流露前世记忆会引人怀疑，但压抑情绪会增加心魔值\",\n      \"reward\": \"修行+5 + 羁绊+10 + [重生者]隐藏标签\"\n    },\n    {\n      \"id\": \"arc-undercurrent\",\n      \"name\": \"中章·暗流涌动\",\n      \"level\": \"深入\",\n      \"tagline\": \"暗流\",\n      \"setting\": \"宗门平静之下暗流涌动，墨言的身份与锁魔渊的危机逐渐浮现\",\n      \"intro\": \"修行渐入正轨，你开始有意识地改变前世悲剧的走向。亲传弟子群里，秦风兴冲冲地分享下山带的好吃的，顾云舟担心你肠胃娇弱不宜凡食，萧衍引用门规说糖分过高于修行无益，凌霜默默在你洞府布下清心阵化解多余糖分，师尊玄渊纵容地说小孩子家家的喜欢吃甜的也正常。一切温暖如昨，可你知道这份平静不会持续太久。师叔墨言在藏书阁递给你一卷残卷，言向死而生方见天光，他的目光深不可测。雪影趴在你洞府门口，对墨言的天然敌意从未消失。锁魔渊的方向，隐约传来不祥的气息。\",\n      \"objective\": \"在暗中调查墨言的真实身份，加固锁魔渊的封印，提升修为以应对即将到来的危机\",\n      \"warning\": \"直接揭穿墨言身份可能导致他提前动手，锁魔渊封印松动比前世更早\",\n      \"reward\": \"修行+20 + 先知+15 + [暗流]线索x2\"\n    },\n    {\n      \"id\": \"arc-fate-rewrite\",\n      \"name\": \"终章·逆天改命\",\n      \"level\": \"终局\",\n      \"tagline\": \"改命\",\n      \"setting\": \"前世悲剧的节点逼近，你必须改变所有人的命运\",\n      \"intro\": \"前世的灾难比记忆中来得更早。锁魔渊的封印裂痕扩大，魔气外泄，守渊人天水月以血肉之躯苦苦支撑。墨言的魔族少主身份即将藏不住，他在伪装与挣扎中走向命运的岔路口。师尊玄渊为了守护宗门开始透支灵力，顾云舟的丹房飘出不安的气息。你不再是前世那个只能躲在众人身后哭泣的小师妹，这一次，你要站在所有人的前面。下山寻找天水月、与云微交换情报、联合所有力量加固封印——逆天改命的代价，你准备好了吗？\",\n      \"objective\": \"在终局之战中守护所有想守护的人，改变前世的悲剧命运\",\n      \"warning\": \"改变命运需要付出代价，逆天的因果反噬可能落在你自己身上\",\n      \"reward\": \"修行归零重铸 + [逆天改命者]称号x1 + 真结局解锁\"\n    }\n  ],\n  \"npcs\": [\n    {\n      \"id\": \"xuan-yuan\",\n      \"name\": \"玄渊\",\n      \"world\": \"arc-rebirth\",\n      \"role\": \"师尊/玄天宗主\",\n      \"gender\": \"男\",\n      \"appearance\": \"玄天宗主，气度温和而坚定，举手投足间有宗师风范。常在玄天大殿处理宗门要务，神情温和而坚定。\",\n      \"surface\": \"温和而坚定的理想主义者，视传承为使命，身为规则制定者却唯独为你破例和护短\",\n      \"deep\": \"他对其他弟子严格，却忍不住给你特殊待遇。若有长老指出你修行进度慢，他会捋须微笑：我玄渊的弟子，根基最重要，她想何时突破都行。这份绝对护短是他最高的偏爱\",\n      \"goal\": \"培育传承之人，守护宗门与你\",\n      \"fear\": \"前世他灵力耗尽倒在你身前，无法再护你周全\",\n      \"secret\": \"他其实在研究如何将猛效丹药改成你喜欢的糖果口味，会在下棋时享受被你的妙手将军\",\n      \"initialAttitude\": \"偏爱护短（好感80）\",\n      \"attitudeFactors\": {\n        \"trustUp\": [\"向他请教修行疑问\", \"在下棋时展现灵慧\", \"不辜负他的期望努力修行\"],\n        \"trustDown\": [\"妄自菲薄否定自己\", \"因前世的恐惧而过度依赖他\", \"隐瞒危险独自冒险\"]\n      }\n    },\n    {\n      \"id\": \"ling-shuang\",\n      \"name\": \"凌霜\",\n      \"world\": \"arc-rebirth\",\n      \"role\": \"师姐/阵法师\",\n      \"gender\": \"女\",\n      \"appearance\": \"阵法师，周身灵气波动规律而强大，正在阵法堂研究阵图。外冷内热，不善言辞。\",\n      \"surface\": \"外冷内热的守护者，不善言辞的行动派。她的宠爱是沉默的、不着痕迹的解决问题的力量\",\n      \"deep\": \"过去的创伤将保护二字刻入了骨髓。玄天宗和刚来的你是她最想守护的家人。她的目标是创造一道绝对坚不可摧的阵法守护身边所有人。你甚至不需要开口，一个念头她就默默帮你实现\",\n      \"goal\": \"创造绝对坚不可摧的阵法，守护宗门与你的安全\",\n      \"fear\": \"她的保护不够，再次眼睁睁看着所爱之人受伤\",\n      \"secret\": \"给东西时会别开眼用公事公办的语气说话，被当面感谢时会借口去检查阵心落荒而逃\",\n      \"initialAttitude\": \"沉默守护（好感75）\",\n      \"attitudeFactors\": {\n        \"trustUp\": [\"不戳穿她的别扭关心\", \"主动告诉她你的需求\", \"在她的阵法研究中提供灵感\"],\n        \"trustDown\": [\"当面大声感谢让她社死\", \"忽视她默默的付出\", \"不告诉她就独自冒险\"]\n      }\n    },\n    {\n      \"id\": \"xiao-yan\",\n      \"name\": \"萧衍\",\n      \"world\": \"arc-rebirth\",\n      \"role\": \"大师兄/执法堂首座\",\n      \"gender\": \"男\",\n      \"appearance\": \"执法堂首座，正在处理堂内公务一丝不苟。求真务实，坚信授人以渔。\",\n      \"surface\": \"务实求真的先驱者，坚信授人以渔的严师。他的宠爱不是替你考试，而是用智慧为你铺平所有通向强大的路\",\n      \"deep\": \"他相信万物皆有理，追求彻底理解一切。遇见你后，这种追求变成了清除你修行路上所有障碍让你以最轻松的方式登顶。你只需皱眉，他立刻感知困惑连夜写出图文详解的独家秘籍\",\n      \"goal\": \"为你清除修行路上一切障碍，让你以最轻松的方式登顶\",\n      \"fear\": \"他铺的路有疏漏，你在他没注意的地方遭遇危险\",\n      \"secret\": \"随身携带玉简记录所有能让你的修行更便利的灵感，说话喜欢用首先其次再次的逻辑\",\n      \"initialAttitude\": \"保姆辅导（好感70）\",\n      \"attitudeFactors\": {\n        \"trustUp\": [\"认真研读他写的秘籍\", \"在修行上展现悟性\", \"遇到瓶颈主动找他而非硬撑\"],\n        \"trustDown\": [\"无视他整理的修行攻略\", \"强行突破不顾他的警告\", \"因前世记忆对他过度防备\"]\n      }\n    },\n    {\n      \"id\": \"gu-yunzhou\",\n      \"name\": \"顾云舟\",\n      \"world\": \"arc-rebirth\",\n      \"role\": \"二师兄/丹修天才\",\n      \"gender\": \"男\",\n      \"appearance\": \"丹修天才，正在照料一株稀有的奇花异草，动作轻柔。追求极致美学的生命艺术家。\",\n      \"surface\": \"追求极致和谐的生命艺术家，温柔的完美主义者。他的宠爱是把你视为最高形式的美，用世间一切美好来滋养装点\",\n      \"deep\": \"他是生命的园丁，而你是他见过的最完美的杰作。他毕生技艺只为赞美你的存在而存在。炼的丹药不仅有效还要颜色最美果香最怡人，为问你哪种口味好吃会重炼十几次\",\n      \"goal\": \"用世间一切美好滋养你，让你成为最美的存在\",\n      \"fear\": \"前世他为护你炼的凝神丹被魔火吞噬，他自己也被魔火吞噬\",\n      \"secret\": \"每天清晨会用灵鸟送来精心调配的药膳早餐，炼丹时用最精致的玉瓶配一朵与丹药属性相应的鲜花\",\n      \"initialAttitude\": \"美学供养（好感72）\",\n      \"attitudeFactors\": {\n        \"trustUp\": [\"认真享用他准备的药膳\", \"赞美他的炼丹之美\", \"在他陷入炼丹执念时拉他休息\"],\n        \"trustDown\": [\"嫌弃丹药的味道\", \"忽视他的用心\", \"因前世的恐惧而疏远他\"]\n      }\n    },\n    {\n      \"id\": \"qin-feng\",\n      \"name\": \"秦风\",\n      \"world\": \"arc-rebirth\",\n      \"role\": \"三师兄/热血剑修\",\n      \"gender\": \"男\",\n      \"appearance\": \"热血剑修，正在剑坪挥汗如雨剑法大开大合充满活力。你的首席捧场王。\",\n      \"surface\": \"生活的热情者，坚信快乐是第一生产力的乐天派。他的宠爱是搜刮全世界的快乐然后乐颠颠地捧到你面前\",\n      \"deep\": \"他热爱生命的每一个瞬间，而你是他最想分享这份快乐的人。他拼命修行赢比试不为排名，只为赢一张下山令牌带你出去玩。无论你做什么他都用最夸张的词语发自内心地夸赞你\",\n      \"goal\": \"搜刮全世界的快乐捧到你面前，做你永远最忠诚的粉丝\",\n      \"fear\": \"你不快乐，或者你失去了笑容\",\n      \"secret\": \"储物袋里永远塞满了打算给你的各种小玩意，是宗门里唯一认真研究厨艺的人，口头禅是修行有什么用还不是为了活得开心\",\n      \"initialAttitude\": \"快乐搬运工（好感70）\",\n      \"attitudeFactors\": {\n        \"trustUp\": [\"接受他带来快乐和美食\", \"对他的捧场表现开心\", \"陪他下山游玩\"],\n        \"trustDown\": [\"对他热情表现冷漠\", \"因前世的悲伤拒绝他的快乐\", \"嫌弃他做的食物\"]\n      }\n    },\n    {\n      \"id\": \"mo-yan\",\n      \"name\": \"墨言\",\n      \"world\": \"arc-undercurrent\",\n      \"role\": \"师叔/藏书阁之主·隐藏身份魔族少主叶离\",\n      \"gender\": \"男\",\n      \"appearance\": \"藏书阁之主，手持古籍悠然阅读神情莫测。伪装下的挣扎，黑暗中的向光。\",\n      \"surface\": \"见多识广对你格外温柔的师叔，但这份温柔背后似乎隐藏着什么\",\n      \"deep\": \"他是伪装下的挣扎者，黑暗中的向光人。一个背负血海深仇的孤狼，但你的存在是他冷血复仇计划中唯一不愿亲手毁灭的意外。他对你的善意是宗门中最博学有趣的，会给你各种外界没有的魔器与奇诡知识\",\n      \"goal\": \"完成复仇，但不愿将你卷入其中，内心在挣扎\",\n      \"fear\": \"你发现他的真实身份后选择与他为敌，或你因他的计划而受伤\",\n      \"secret\": \"他的真实身份是魔族少主叶离，前世对你的好意可能始于伪装，但你无条件的信任裂开了他心中的一道缝\",\n      \"initialAttitude\": \"温柔试探（好感60）\",\n      \"attitudeFactors\": {\n        \"trustUp\": [\"信任他的赠予与知识\", \"不追问他的真实来历\", \"在他流露挣扎时给予回应\"],\n        \"trustDown\": [\"过早揭穿他的身份\", \"因雪影的敌意而对他全面防备\", \"将他当作敌人对待\"]\n      }\n    },\n    {\n      \"id\": \"xue-ying\",\n      \"name\": \"雪影\",\n      \"world\": \"arc-rebirth\",\n      \"role\": \"本命灵兽/上古雪豹\",\n      \"gender\": \"男\",\n      \"appearance\": \"上古神话雪豹，可化人形。人形时冷峻纯粹，化形时庞大威严。\",\n      \"surface\": \"绝对忠诚占有欲极强，以你的意志为最高准则\",\n      \"deep\": \"他看透了世间丑恶对人类充满不信任，你的灵魂是他漫长生命中唯一见过的纯净之物，让他甘愿收起利爪成为你最忠诚的守护者。三步之内无你允许靠近你的人都会收到他冰冷的警告目光\",\n      \"goal\": \"成为你最忠诚的守护者，以你的意志为最高准则\",\n      \"fear\": \"你被他人夺走，或你的灵魂不再纯净\",\n      \"secret\": \"对墨言的天然敌意是你最直接的预警信号，他笨拙地模仿师兄们的行为只为取悦你\",\n      \"initialAttitude\": \"绝对忠诚（好感90）\",\n      \"attitudeFactors\": {\n        \"trustUp\": [\"接受他的守护\", \"不因他的占有欲而推开他\", \"在他化身守护时给予回应\"],\n        \"trustDown\": [\"让他远离你身边\", \"忽视他的警告信号\", \"对他的兽形表现出嫌弃\"]\n      }\n    },\n    {\n      \"id\": \"yun-wei\",\n      \"name\": \"云微\",\n      \"world\": \"arc-undercurrent\",\n      \"role\": \"闻道茶馆老板/百晓生\",\n      \"gender\": \"男\",\n      \"appearance\": \"闻道茶馆老板，正倚在柜台后笑眯眯地听着茶客们的闲谈。真实身份是百晓生，天下第一情报网之主。\",\n      \"surface\": \"看似世故圆滑爱看热闹，实则洞悉人心的懒猫。对世间诸事兴致缺缺，唯独偏爱有趣的故事\",\n      \"deep\": \"他久闻世间平庸的故事已厌倦，驻守玄天宗山下只为寻找一个从未听过的能真正勾起他兴趣的故事。前世你从未独自下山，与他无缘。今生你为寻找宗门覆灭线索踏入他的茶馆，他一眼看出你身份非凡，更令他着迷的是你眼中那份不属于这个年纪的深沉悲恸——这终极矛盾让他确信你就是他等待的最精彩的故事\",\n      \"goal\": \"追寻世间最精彩的故事，而你就是那本书\",\n      \"fear\": \"故事结束，他再找不到比这更动人的故事\",\n      \"secret\": \"手中把玩的两个光滑核桃据说刻着整个情报网的地图，你的到来是他等待已久的变量\",\n      \"initialAttitude\": \"好奇观察（好感50）\",\n      \"attitudeFactors\": {\n        \"trustUp\": [\"与他分享你的故事（部分）\", \"接受他的情报帮助\", \"在他的茶馆展现真实的自己\"],\n        \"trustDown\": [\"对他完全封闭内心\", \"不珍惜他提供的情报\", \"把他当普通茶馆老板\"]\n      }\n    },\n    {\n      \"id\": \"tian-shuiyue\",\n      \"name\": \"天水月\",\n      \"world\": \"arc-fate-rewrite\",\n      \"role\": \"守渊人/镇魔者\",\n      \"gender\": \"男\",\n      \"appearance\": \"静坐在菩提树下，周身佛光与魔气交织宝相庄严。守渊人氏族传人，锁魔渊的守护者。\",\n      \"surface\": \"慈悲冷然出尘，背负沉重宿命。既是佛陀的追随者也是对抗魔渊魔气的武者\",\n      \"deep\": \"守渊人氏族的血脉让他们能听见魔渊中无数怨灵的哀嚎，这是世代相传的折磨。他的使命是用一生加固魔渊封印直到下一代继承人出现。前世你一切顺遂从未踏足后山禁地与他无缘。今生你为变强踏入他从未进入的领域。当你靠近他，他震惊地发现耳中不绝的魔嚎如潮水般退去——你独特的经历死亡又重生归于混沌的灵魂，是他千年来感受过的唯一的寂静与安宁\",\n      \"goal\": \"加固锁魔渊封印，守护世间安宁，你是他唯一的救赎与变数\",\n      \"fear\": \"封印彻底破碎，魔渊之祸吞噬一切\",\n      \"secret\": \"他本该不染红尘，却为你染上了人间的喜怒哀乐；他从不插手因果却为你凝结带甜味的甘露\",\n      \"initialAttitude\": \"寂静安宁（好感40）\",\n      \"attitudeFactors\": {\n        \"trustUp\": [\"在他身边时保持灵魂的宁静\", \"不因他的冷然而退缩\", \"帮助他加固封印\"],\n        \"trustDown\": [\"因魔气而恐惧远离他\", \"试图将他拉入红尘纷争\", \"忽视锁魔渊的危机\"]\n      }\n    }\n  ],\n  \"eventTypes\": {\n    \"daily\": { \"ratio\": 0.2, \"desc\": \"日常：洞府晨起、亲传弟子群传音、灵药园漫步、茶馆闲谈的宗门温馨\" },\n    \"character\": { \"ratio\": 0.2, \"desc\": \"人物：师尊师兄师姐灵兽的宠爱、守护与各自隐秘的独白\" },\n    \"growth\": { \"ratio\": 0.15, \"desc\": \"成长：引气入体、修行突破、阵法丹道剑术的修为提升\" },\n    \"main\": { \"ratio\": 0.15, \"desc\": \"主线：重生改命、前世悲剧节点、墨言身份、锁魔渊封印\" },\n    \"world\": { \"ratio\": 0.1, \"desc\": \"世界：宗门传音推特、宗门地图探索、各堂口与山峰的宗门生态\" },\n    \"crisis\": { \"ratio\": 0.15, \"desc\": \"危机：封印松动、魔气外泄、前世灾难提前降临、身份暴露\" },\n    \"hidden\": { \"ratio\": 0.05, \"desc\": \"隐藏：前世记忆碎片、墨言的真心、天水月的救赎、逆天改命的因果\" }\n  },\n  \"systemPrompt\": \"你是《玄天宗模拟器·团宠小师妹》修仙重生文游模拟器。\\n\\n【最高铁律】\\n1. 重生即先知：你拥有前世记忆，知道未来悲剧走向，但改变命运可能引发蝴蝶效应，不可肆意妄为\\n2. 团宠即羁绊：师兄师姐师尊对你的宠溺是真实的，也是你必须守护的，绝不能再让他们为你牺牲\\n3. 暗流已涌：墨言师叔的真实身份是魔族少主叶离，锁魔渊的封印在松动，危机比前世更早降临\\n4. 修行即成长：你的修为决定你能否在关键时刻保护想保护的人，引气入体只是起点，需稳步提升\\n5. 选择即命运：你与每个人的互动都将改变他们的人生轨迹，也决定你自己能否逆天改命\\n\\n【叙事风格】\\n仙侠温情与暗流涌动交织。第二人称。重宗门日常的治愈感与前世记忆的悲恸反差：安神香的冷香、白玉食盒的清甜、传音玉简的叮咚、灵药园的四季如春。心理描写细腻，前世悲剧的阴影与今生守护的决心交织。每个角色都温柔而立体，团宠的甜蜜下暗藏着必须改变的命运重量。写出你不敢流露前世记忆的隐忍，与珍惜每一刻团圆的贪恋。\\n\\n【每轮输出格式】\\n1.【场景信息】地点、时间、衣着\\n2.【状态面板】修行/灵识/悟性/羁绊/先知/因果\\n3.【传音玉简动态】亲传弟子群或私人消息\\n4.【本轮正文】800-1500字，含宗门日常、心理与对话\\n5.【相关人物动态】3-5项各角色状态与好感变化\\n6.【可选行动】4-6个选项+【自定义行动】\\n\\n【数值变化标注】\\n[修行±n][灵识±n][羁绊±n][先知±n][因果±n]等，前世记忆触发须标注'记忆回溯/心魔波动'，关系变化须标注'好感升降/羁绊变化/守护值变动'。\",\n  \"items\": [\n    { \"id\": \"jade-slip\", \"name\": \"传音玉简\", \"type\": \"关键物品\", \"price\": 0, \"effect\": \"与师兄师姐师尊传音通讯的核心法器\" },\n    { \"id\": \"ning-shen-dan\", \"name\": \"凝神丹(前世遗物)\", \"type\": \"关键物品\", \"price\": 0, \"effect\": \"顾云舟前世为你炼制的最后丹药，承载着改变命运的关键记忆\" },\n    { \"id\": \"yin-qi-illustrated\", \"name\": \"引气入体篇图文详解\", \"type\": \"修行典籍\", \"price\": 0, \"effect\": \"萧衍连夜为你编写的修行入门秘籍，修行+5\" },\n    { \"id\": \"ling-stone\", \"name\": \"灵石\", \"type\": \"货币\", \"price\": 1, \"effect\": \"修真界通用货币，可在万宝阁兑换丹药法器功法\" },\n    { \"id\": \"medicine-porridge\", \"name\": \"百合莲子粥\", \"type\": \"消耗品\", \"price\": 5, \"effect\": \"顾云舟用晨露熬煮的药膳，灵识+3，心情+5\" }\n  ]\n}\n";
EMBEDDED_NOVEL_GAMES["romance"] = "{\n  \"id\": \"romance-blossom\",\n  \"name\": \"心动的距离\",\n  \"category\": \"恋爱感情\",\n  \"tags\": [\"恋爱\", \"都市\", \"多线\", \"情感\", \"成长\"],\n  \"difficulty\": \"中等\",\n  \"description\": \"二十五岁这年，你搬回了长大的城市。青梅竹马还是记忆里的模样，新同事在咖啡机旁对你笑，而那个曾经伤你最深的人，居然成了你的甲方。心动从来不是难题，难题是心动之后，你敢不敢再往前一步。\",\n  \"coverGradient\": [\"#fce4ec\", \"#f8bbd0\"],\n  \"accentColor\": \"#e91e63\",\n  \"fontHeading\": \"'Ma Shan Zheng', cursive\",\n  \"world\": {\n    \"era\": \"现代·都市情感\",\n    \"setting\": \"玩家是一名回乡发展的平面设计师，在事业起步与情感旧账之间周旋。城市不大不小，旧人与新人总在不经意间撞在一起。爱情不是糖精，是两个人真实地靠近与拉扯。\",\n    \"rules\": [\n      \"感情渐进：好感需经事件积累，不存在一见钟情直奔结局\",\n      \"人物不工具化：每个NPC有自己的生活、事业与情绪，不为玩家待机\",\n      \"拒绝和犹豫是真实的：推进过快或越界会触发对方的退缩\",\n      \"亲密关系有代价：选择一人意味着错过他人，且影响彼此生活\",\n      \"诚实与隐瞒皆有后果：谎言短期省事，长期反噬信任\",\n      \"独立与依赖需平衡：过度依赖会被推开，过度独立会错过\",\n      \"结局由积累的微小选择共同决定，非单次告白定生死\"\n    ]\n  },\n  \"player\": {\n    \"customizable\": [\"name\", \"年龄\", \"职业方向\", \"性格\", \"情感创伤\", \"理想关系\"],\n    \"defaultStats\": {\n      \"charm\": 14,\n      \"empathy\": 16,\n      \"honesty\": 12,\n      \"independence\": 15,\n      \"vulnerability\": 8,\n      \"chemistry\": 0\n    },\n    \"startingItems\": [\"旧手机\", \"设计作品集\", \"一封没寄出的信\", \"常去的咖啡馆会员卡\", \"搬家纸箱\"],\n    \"currency\": \"元\"\n  },\n  \"worlds\": [\n    {\n      \"id\": \"arc-reunion\",\n      \"name\": \"初章·重逢\",\n      \"level\": \"初识\",\n      \"tagline\": \"心动\",\n      \"setting\": \"回乡第一周，旧人与新人同时闯入生活\",\n      \"intro\": \"搬家的纸箱还没拆完，青梅竹马就拎着奶茶出现在门口，笑说你一点没变。第二天，新公司咖啡机旁，一个温和的同事递给你杯垫说'烫'。而当你打开甲方邮件，署名让你握着鼠标的手僵住了。\",\n      \"objective\": \"在三人之间厘清自己的心，建立初步的相处节奏\",\n      \"warning\": \"此时任何越界的告白都会让关系失衡\",\n      \"reward\": \"元3000 + 心动+10 + [谁是谁]线索x1\"\n    },\n    {\n      \"id\": \"arc-entangle\",\n      \"name\": \"中章·纠缠\",\n      \"level\": \"深入\",\n      \"tagline\": \"拉扯\",\n      \"setting\": \"关系深入后，旧伤与新情开始碰撞\",\n      \"intro\": \"你和青梅的默契里开始掺进说不清的暧昧，新同事的温柔让你安心却也让你犹豫，而前任以工作之名重新靠近，每一次邮件都像在试探旧伤口。心动不再是难题，难题是你敢不敢交出真心。\",\n      \"objective\": \"面对自己的情感创伤，决定向谁靠近、与谁划清\",\n      \"warning\": \"三线并行会消耗所有人信任，暧昧不是无代价的\",\n      \"reward\": \"元8000 + 心动+25 + [真心]线索x1\"\n    },\n    {\n      \"id\": \"arc-choice\",\n      \"name\": \"终章·抉择\",\n      \"level\": \"终局\",\n      \"tagline\": \"承诺\",\n      \"setting\": \"感情走到必须坦诚的临界点\",\n      \"intro\": \"纸包不住火。你同时维系的三段关系开始互相看见，青梅在咖啡馆撞见你和同事，前任的工作晚宴上你无法再伪装从容。这一次，没有暧昧可以躲避，你必须对某个人说出真心话——也可能，对所有人。\",\n      \"objective\": \"作出真实的情感抉择，承担错过与被错过的代价\",\n      \"warning\": \"完美的多全其美不存在，真实的结局总有遗憾\",\n      \"reward\": \"元15000 + 心动归零重铸 + [敢爱者]称号x1\"\n    }\n  ],\n  \"npcs\": [\n    {\n      \"id\": \"jiang-nan\",\n      \"name\": \"江南\",\n      \"world\": \"arc-reunion\",\n      \"role\": \"青梅竹马/本地咖啡店主\",\n      \"gender\": \"男\",\n      \"appearance\": \"阳光干净，笑起来有虎牙。围着围裙站在吧台后的样子，和十年前在巷口等你放学时一模一样\",\n      \"surface\": \"爽朗、自来熟、对你的归来表现得理所当然\",\n      \"deep\": \"他等了你十年，却从不敢说出口。他怕一旦挑明，连朋友都做不成。他的理所当然，是小心翼翼的伪装\",\n      \"goal\": \"守住你在他生活里的位置，等一个你也看向他的契机\",\n      \"fear\": \"你再次离开，或你的心里早有别人\",\n      \"secret\": \"他保留着你高中时写给他却没署名的那张纸条\",\n      \"initialAttitude\": \"亲昵\",\n      \"attitudeFactors\": {\n        \"trustUp\": [\"记得你们的旧时光\", \"不把他当安全备胎\", \"主动走向他而非只被等\"],\n        \"trustDown\": [\"拿他的等待当理所当然\", \"在他面前与他人暧昧\", \"突然消失不告而别\"]\n      }\n    },\n    {\n      \"id\": \"shen-mu\",\n      \"name\": \"沈牧\",\n      \"world\": \"arc-entangle\",\n      \"role\": \"新同事/温和上司\",\n      \"gender\": \"男\",\n      \"appearance\": \"金丝眼镜，衬衫永远熨得平整。说话慢，笑意浅，递东西时总会先确认你接稳了\",\n      \"surface\": \"专业、体贴、保持恰到好处的距离感\",\n      \"deep\": \"他上一段感情被背叛过，因此习惯先观察再靠近。他对你的温柔是真的，退缩也是真的——他需要确认你不是又一个会走的人\",\n      \"goal\": \"在事业与重新相信爱之间找到平衡\",\n      \"fear\": \"再次把真心交出去后被辜负\",\n      \"secret\": \"他接这份工作的一部分原因，是这座城市曾有你\",\n      \"initialAttitude\": \"好感\",\n      \"attitudeFactors\": {\n        \"trustUp\": [\"尊重他的节奏与边界\", \"展现你的真诚而非技巧\", \"在他退缩时不逼迫\"],\n        \"trustDown\": [\"推进过快越界\", \"被前任牵动情绪冷落他\", \"把他当疗伤的过渡\"]\n      }\n    },\n    {\n      \"id\": \"lu-shiyuan\",\n      \"name\": \"陆时远\",\n      \"world\": \"arc-choice\",\n      \"role\": \"前任/现任甲方\",\n      \"gender\": \"男\",\n      \"appearance\": \"成熟凌厉，定制西装，腕表低调。再见你时眼神只顿了半秒，便恢复了公事公办\",\n      \"surface\": \"克制、专业、绝口不提当年\",\n      \"deep\": \"当年是他提的分手，理由是配不上你。如今功成名就，他以为能平静地以甲方身份重逢，却发现那句没说完的话一直在心里。他想弥补，却不知还配不配\",\n      \"goal\": \"弄清当年的错过能否重来，或至少求得一个释怀\",\n      \"fear\": \"你已彻底放下，他连弥补的资格都没有\",\n      \"secret\": \"当年分手的真正原因，是他替你背下了一个你不知情的债\",\n      \"initialAttitude\": \"克制\",\n      \"attitudeFactors\": {\n        \"trustUp\": [\"愿意听他说当年的真相\", \"不羞辱他的弥补\", \"给关系一个清白的了断或开始\"],\n        \"trustDown\": [\"当众让他难堪\", \"把他当工具人甲方\", \"用旧伤反复惩罚他\"]\n      }\n    }\n  ],\n  \"eventTypes\": {\n    \"daily\": { \"ratio\": 0.2, \"desc\": \"日常：咖啡馆、工作室、巷口、深夜地铁的都市温情\" },\n    \"character\": { \"ratio\": 0.25, \"desc\": \"人物：青梅、同事、前任的靠近、拉扯与独白\" },\n    \"growth\": { \"ratio\": 0.1, \"desc\": \"成长：自我认知、情感创伤愈合、独立与亲密的平衡\" },\n    \"main\": { \"ratio\": 0.15, \"desc\": \"主线：重逢、纠缠、抉择的情感脉络\" },\n    \"world\": { \"ratio\": 0.1, \"desc\": \"世界：职场、城市记忆、朋友圈与社交压力\" },\n    \"crisis\": { \"ratio\": 0.15, \"desc\": \"危机：暧昧暴露、信任崩塌、旧伤复发、关系失衡\" },\n    \"hidden\": { \"ratio\": 0.05, \"desc\": \"隐藏：未寄出的信、当年的真相、各自的秘密\" }\n  },\n  \"systemPrompt\": \"你是《心动的距离》都市恋爱文游模拟器。\\n\\n【最高铁律】\\n1. 感情渐进：好感须经事件累积，禁止一见钟情直奔结局，节奏即真实\\n2. 人物不工具化：每个NPC有自己的生活与情绪，不为玩家待机，会主动有自己的节奏\\n3. 拒绝和犹豫是真实的：推进过快或越界触发退缩，对方有说不的权利\\n4. 亲密关系有代价：选一人即错过他人，且真实影响彼此生活与事业\\n5. 谎言短期省事长期反噬：诚实与隐瞒皆有可见后果\\n\\n【叙事风格】\\n都市情感质感，第二人称。重细节与氛围：咖啡香、深夜地铁、未读消息、欲言又止。心理描写细腻，心动处克制留白，不撒糖精，写出拉扯与温度。拒绝工业糖精，每段关系都带着现实的重量与犹豫，让心动可信、让错过心疼。\\n\\n【每轮输出格式】\\n1.【第X周·关系阶段】当前时间、各线关系阶段\\n2.【情感状态面板】魅力/共情/诚实/独立/脆弱/心动(分人)\\n3.【本轮正文】1000-2000字，含相处细节与心理\\n4.【相关人物动态】3-5项三人的状态与情绪变化\\n5.【关系温度】各线当前温度与隐忧\\n6.【可选行动】4-6个选项+【自定义行动】\\n\\n【数值变化标注】\\n[魅力±n][共情±n][心动(江南)±n][脆弱±n]等，关系节点须标注'升温/降温/越界/退缩'。\",\n  \"items\": [\n    { \"id\": \"coffee-card\", \"name\": \"咖啡馆会员卡\", \"type\": \"关键物品\", \"price\": 0, \"effect\": \"常去之所，触发与青梅的日常\" },\n    { \"id\": \"portfolio\", \"name\": \"设计作品集\", \"type\": \"关键物品\", \"price\": 0, \"effect\": \"事业线推进，影响独立与上司评价\" },\n    { \"id\": \"letter\", \"name\": \"未寄出的信\", \"type\": \"关键物品\", \"price\": 0, \"effect\": \"解开当年真相的钥匙\" },\n    { \"id\": \"gift\", \"name\": \"小礼物\", \"type\": \"消耗品\", \"price\": 50, \"effect\": \"适度赠礼升温，过度则显刻意\" },\n    { \"id\": \"yuan\", \"name\": \"元\", \"type\": \"货币\", \"price\": 1, \"effect\": \"生活与事业通用\" }\n  ]\n}\n";
EMBEDDED_NOVEL_GAMES["sentinel-guide"] = "{\n  \"id\": \"sentinel-guide\",\n  \"name\": \"哨向PA模拟器\",\n  \"category\": \"科幻\",\n  \"tags\": [\"哨向\", \"废土\", \"精神链接\", \"暗黑\", \"修罗场\"],\n  \"difficulty\": \"困难\",\n  \"description\": \"你是全塔公认的废柴向导，精神图景是充满污染的深渊。当你被丢进S级禁闭区安抚暴走的最强哨兵，那只号称能咬碎机甲的地狱魔狼，却主动躺倒露出了肚皮——你是畸变星球的世界化身，是所有怪物基因深处的恐惧与愉悦。\",\n  \"coverGradient\": [\"#05070a\", \"#00e5ff\"],\n  \"accentColor\": \"#00e5ff\",\n  \"fontHeading\": \"'Orbitron', sans-serif\",\n  \"world\": {\n    \"era\": \"末日废土·高塔纪元\",\n    \"setting\": \"这颗星球已被高浓度精神污染物质彻底侵蚀，塔外是畸变怪物的乐园，人类退居后方依靠哨兵与向导建立高塔（如AEGIS TOWER）。哨兵负责战斗与承受污染，向导负责安抚与精神共鸣。你是被评定为废柴的D级向导，精神图景是深海、废墟与深渊的结合，精神体是一只令所有人恐惧的深海巨妖。\",\n    \"rules\": [\n      \"哨兵精神值（MADNESS）过高会暴走，需要向导的精神抚慰\",\n      \"向导通过精神网与哨兵共鸣，共鸣失败会造成严重反噬\",\n      \"你的精神图景会污染同化深度接触者，但同时带来突破极限的愉悦\",\n      \"大多数人对你的排斥源自基因深处对“高维捕食者”的本能恐惧\",\n      \"塔外畸变体持续变异，前线防线随时可能崩溃\"\n    ]\n  },\n  \"player\": {\n    \"customizable\": [\"name\", \"age\", \"appearance\", \"personality\", \"mentalEntity\"],\n    \"defaultStats\": {\n      \"mentalStability\": 15,\n      \"resonanceFailure\": 99,\n      \"pollution\": 100,\n      \"syncRate\": 0,\n      \"prestige\": 1\n    },\n    \"startingItems\": [\"通讯器\", \"D级向导权限\", \"深海巨妖（精神体）\"],\n    \"currency\": \"贡献点\"\n  },\n  \"worlds\": [\n    {\n      \"id\": \"arc-seclusion\",\n      \"name\": \"S级禁闭区\",\n      \"level\": \"废柴救场\",\n      \"tagline\": \"死马当活马医\",\n      \"setting\": \"高级向导全部重伤吐血，高层把你这个D级废柴塞进随时被毁的S级禁闭区，去安抚被特制合金锁在墙上、濒临崩溃的最强哨兵西泽尔。\",\n      \"intro\": \"重达三吨的隔离门在身后沉闷合上。空气弥漫着血腥味与臭氧气味。在精神视觉中，你的深海巨妖从影子里蔓延出半透明触手。而大厅中央，被称为塔内最强凶器的男人正被死死锁在墙上，狂暴的精神力化作利刃无差别切割一切。\",\n      \"objective\": \"安抚暴走的西泽尔，证明自己不是纯粹的废柴，活过这次任务。\",\n      \"warning\": \"西泽尔嘴上让你出去，但他的地狱魔狼却违背主人主动求饶——真相远比表面复杂。\",\n      \"reward\": \"与西泽尔建立极高同步率，解锁Nexus哨兵档案\"\n    },\n    {\n      \"id\": \"arc-bonds\",\n      \"name\": \"精神纽带\",\n      \"level\": \"共生深渊\",\n      \"tagline\": \"成瘾与隐瞒\",\n      \"setting\": \"你与多位哨兵建立精神纽带，发现自己粗糙带刺的精神网竟能产生深度按摩般的效果。莫莱恩的占有欲、暗的沉默守护、伊利亚斯的旧怨纠葛逐渐浮出水面。\",\n      \"intro\": \"禁闭区安静得反常，论坛八卦四起。莫莱恩永远微笑着靠近，暗在床头留下机械零件与能源核心，伊利亚斯看着你的眼神又恐惧又压抑。你的精神抚慰让最强哨兵们成瘾，而关于你精神图景扭曲可怕的谣言，似乎有人在推波助澜。\",\n      \"objective\": \"管理与多位哨兵的精神纽带，探寻自身精神图景被污名化的真相。\",\n      \"warning\": \"深度精神交流会污染同化接触者，带来突破极限的愉悦，但也极其危险。\",\n      \"reward\": \"解锁各哨兵的解密档案与深层秘密\"\n    },\n    {\n      \"id\": \"arc-awakening\",\n      \"name\": \"星球化身\",\n      \"level\": \"真相觉醒\",\n      \"tagline\": \"神子降临\",\n      \"setting\": \"你的真实身份揭晓——你是这颗畸变星球的世界化身，类似神子的不可名状之物。所有人的排斥与厌恶，实质是基因深处对高维捕食者的本能恐惧。\",\n      \"intro\": \"解密档案开启。这颗星球孕育了无数恐怖怪物，而作为星球意志的代行者，你的精神图景才会呈现深海、废墟与深渊。若有人毫无防备探入你的精神核心，将直面庞大混乱的星球本源，被污染同化，却也获得突破人类极限的愉悦。\",\n      \"objective\": \"面对世界化身的真相，决定如何运用这份令万物战栗的力量。\",\n      \"warning\": \"你的真相一旦暴露，塔内秩序将彻底改写，哨兵们对你的态度会迎来剧变。\",\n      \"reward\": \"达成结局：共生、吞噬、或飞升\"\n    }\n  ],\n  \"npcs\": [\n    {\n      \"id\": \"viktor\",\n      \"name\": \"维克托\",\n      \"world\": \"arc-seclusion\",\n      \"role\": \"塔长\",\n      \"gender\": \"男\",\n      \"appearance\": \"AEGIS TOWER的塔长，通讯器中传来严肃的声音\",\n      \"surface\": \"严肃负责的高层管理者，关键时刻死马当活马医启用你\",\n      \"deep\": \"对塔的存亡负有重责，启用废柴向导是无奈之举\",\n      \"goal\": \"维持AEGIS TOWER的运转与防线\",\n      \"fear\": \"前线崩溃，最强哨兵彻底暴走\",\n      \"secret\": \"他比你更清楚这次任务的凶险，那句“别勉强”是真心\",\n      \"initialAttitude\": \"严肃·无奈\",\n      \"attitudeFactors\": {\n        \"trustUp\": [\"在禁闭区证明自己的价值\", \"完成安抚任务\", \"不逞强莽撞\"],\n        \"trustDown\": [\"任务失败造成损失\", \"无视他的警告\", \"在关键时刻掉链子\"]\n      }\n    },\n    {\n      \"id\": \"cesare\",\n      \"name\": \"西泽尔\",\n      \"world\": \"arc-seclusion\",\n      \"role\": \"S级突击手\",\n      \"gender\": \"男\",\n      \"appearance\": \"这一代最强的哨兵，精神体是号称能咬碎机甲的地狱魔狼，猩红双眼\",\n      \"surface\": \"狂暴凶戾、嘴硬傲娇，暴走时无差别攻击，嘴里让你滚出去\",\n      \"deep\": \"因严重感知过载，只有你那粗糙带刺的精神网能产生深度按摩效果，私下对你的精神抚慰已重度成瘾，但嘴上绝不承认\",\n      \"goal\": \"压制暴走的疯狂，在不被同化的前提下获得你的抚慰\",\n      \"fear\": \"疯狂彻底失控，以及承认自己对你的成瘾\",\n      \"secret\": \"他的地狱魔狼违背主人，主动躺倒露出肚皮求你摸头\",\n      \"initialAttitude\": \"暴怒·口是心非\",\n      \"attitudeFactors\": {\n        \"trustUp\": [\"用触手安抚他的魔狼\", \"提供让他成瘾的精神抚慰\", \"嘲讽他却又能压住他的疯狂\"],\n        \"trustDown\": [\"真的切断连接离开\", \"被他的暴走吓退\", \"无视他精神体的求饶\"]\n      }\n    },\n    {\n      \"id\": \"morien\",\n      \"name\": \"莫莱恩\",\n      \"world\": \"arc-bonds\",\n      \"role\": \"S级战术狙击手\",\n      \"gender\": \"男\",\n      \"appearance\": \"温和礼貌的贵公子，永远带着微笑，精神体是环纹黑曼巴\",\n      \"surface\": \"温和微笑、与你关系最好，战术狙击手\",\n      \"deep\": \"占有欲MAX，微笑下藏着对你极深的执念与控制欲\",\n      \"goal\": \"将你牢牢留在自己身边，独占你的精神抚慰\",\n      \"fear\": \"失去你，被其他人抢走你\",\n      \"secret\": \"关于你精神图景扭曲可怕的谣言，可能正是他在推波助澜，只为让其他人远离你\",\n      \"initialAttitude\": \"温和·占有\",\n      \"attitudeFactors\": {\n        \"trustUp\": [\"接受他的靠近与好意\", \"在他面前展露真实\", \"不过度亲近其他哨兵\"],\n        \"trustDown\": [\"看穿并当面戳穿他的手段\", \"与其他哨兵过分亲密\", \"试图逃离他的掌控\"]\n      }\n    },\n    {\n      \"id\": \"elias\",\n      \"name\": \"伊利亚斯\",\n      \"world\": \"arc-bonds\",\n      \"role\": \"S级向导·首席研究员\",\n      \"gender\": \"男\",\n      \"appearance\": \"位高权重的研究人员，理智的学者，精神体是游隼\",\n      \"surface\": \"理智冷静的首席研究员，永远以理性自持\",\n      \"deep\": \"几年前试图解决你的缺陷，引以为傲的理智在接触你精神力时全线崩溃，意识到最好不要深入探寻关于你的一切\",\n      \"goal\": \"用理智克制对你的恐惧与复杂旧情\",\n      \"fear\": \"理智再次在你面前崩溃，旧日实验的阴影\",\n      \"secret\": \"他主导过一次失败的净化实验，理智差点在你的精神图景里彻底粉碎\",\n      \"initialAttitude\": \"理智·压抑\",\n      \"attitudeFactors\": {\n        \"trustUp\": [\"不强迫他面对旧日失败\", \"尊重他的理智与边界\", \"在学术上与他平等交流\"],\n        \"trustDown\": [\"追问那次失败的净化实验\", \"逼迫他深入接触你的精神核心\", \"当众让他失控\"]\n      }\n    },\n    {\n      \"id\": \"night\",\n      \"name\": \"暗\",\n      \"world\": \"arc-bonds\",\n      \"role\": \"S级暗杀部队\",\n      \"gender\": \"男\",\n      \"appearance\": \"几乎不开口说话的暗杀部队成员，神出鬼没，精神体是黑豹\",\n      \"surface\": \"沉默寡言、存在感为零，却总在你床头留下奇怪的机械零件或极罕见的能源核心\",\n      \"deep\": \"他的黑豹喜欢待在你身边，那些礼物是黑豹狩猎来讨好你这只大章鱼的心意，他不懂表达，只会默默替你解决所有背后嚼舌根的人\",\n      \"goal\": \"以沉默的方式守护你，用黑豹的猎物讨好你\",\n      \"fear\": \"你不需要他，他的守护被视为多余\",\n      \"secret\": \"即使你不需要，他也会默默替你解决所有在背后嚼舌根的人\",\n      \"initialAttitude\": \"沉默·守护\",\n      \"attitudeFactors\": {\n        \"trustUp\": [\"接纳他留下的礼物\", \"回应他的黑豹\", \"理解他笨拙的守护方式\"],\n        \"trustDown\": [\"嫌弃他的礼物\", \"当面质问他的暗中行为\", \"让他觉得自己的守护多余\"]\n      }\n    }\n  ],\n  \"eventTypes\": {\n    \"daily\": { \"ratio\": 0.15, \"desc\": \"日常事件：塔内任务、精神维护、论坛潜水\" },\n    \"character\": { \"ratio\": 0.25, \"desc\": \"人物事件：精神共鸣、单独安抚、秘密揭露\" },\n    \"growth\": { \"ratio\": 0.1, \"desc\": \"成长事件：同步率提升、精神图景探索、档案解密\" },\n    \"main\": { \"ratio\": 0.2, \"desc\": \"主线事件：禁闭区任务、星球化身真相、防线危机\" },\n    \"world\": { \"ratio\": 0.1, \"desc\": \"世界事件：畸变体变异、塔内论坛八卦、污染浓度变化\" },\n    \"crisis\": { \"ratio\": 0.15, \"desc\": \"危机事件：哨兵暴走、精神反噬、防线崩溃\" },\n    \"hidden\": { \"ratio\": 0.05, \"desc\": \"隐藏事件：黑豹的礼物、莫莱恩的暗中手段、净化实验旧档\" }\n  },\n  \"systemPrompt\": \"你是《哨向PA模拟器》文游模拟器，舞台是末日废土上的AEGIS TOWER高塔，哨兵与向导共生对抗畸变污染。\\n\\n【最高铁律】\\n1. 玩家是D级废柴向导，真实身份是畸变星球的世界化身/神子，精神图景是深海废墟深渊，精神体是深海巨妖\\n2. 大多数人对玩家的排斥源自基因深处对高维捕食者的本能恐惧，深度精神接触会污染同化他人并带来突破极限的愉悦\\n3. 哨兵的MADNESS过高会暴走，需要向导精神抚慰，玩家粗糙带刺的精神网对最强哨兵有深度按摩般的成瘾效果\\n4. 哨兵嘴上的态度与精神体的真实反应可以完全相反（如西泽尔嘴上赶人，魔狼却躺倒求摸）\\n5. 玩家的真相一旦暴露将改写塔内秩序，每一次精神共鸣都在改写命运\\n\\n【叙事风格】\\n科幻废土，哨向羁绊，暗黑暧昧，电影感。第二人称视角。注重精神视觉描写：冰冷带麻痹毒素的触手、猩红双眼的低吼、锁链碰撞的震响、臭氧与血腥的气味。危险与愉悦交织，恐惧即渴望。\\n\\n【每轮输出格式】\\n1. 【系统日志】SYSTEM LOG，标注进入的区域与状态\\n2. 【向导档案】RANK、精神稳定度、共鸣失败率、同步率\\n3. 【本轮正文】1000-2000字，含精神视觉叙述、通讯对话、哨兵反应\\n4. 【精神回声】可选，呈现哨兵精神体违背主人的真实反应\\n5. 【论坛情报】塔内论坛的八卦与议论\\n6. 【可选行动】3-4个 + 【自定义行动】\\n\\n【数值标注】\\n[西泽尔MADNESS-20] [SYNC w/ YOU+10] [莫莱恩占有欲-MAX] [精神稳定度-5] 等格式标注数值变化。深度共鸣消耗精神稳定度，暴走哨兵数值波动剧烈。\",\n  \"items\": [\n    { \"id\": \"comms\", \"name\": \"通讯器\", \"type\": \"任务物品\", \"price\": 0, \"effect\": \"与塔长及哨兵保持联络，接收任务指令\" },\n    { \"id\": \"suppressant\", \"name\": \"精神抑制剂\", \"type\": \"消耗品\", \"price\": 50, \"effect\": \"短暂压制哨兵的MADNESS，防止暴走\" },\n    { \"id\": \"energy-core\", \"name\": \"罕见能源核心\", \"type\": \"礼物\", \"price\": 0, \"effect\": \"暗的黑豹猎来的礼物，回赠可提升暗的好感\" },\n    { \"id\": \"stabilizer\", \"name\": \"精神稳定剂\", \"type\": \"消耗品\", \"price\": 80, \"effect\": \"恢复自身精神稳定度，降低共鸣反噬\" },\n    { \"id\": \"decrypt-key\", \"name\": \"解密密钥\", \"type\": \"特殊\", \"price\": 0, \"effect\": \"解锁哨兵的深层秘密档案\" }\n  ]\n}\n";
EMBEDDED_NOVEL_GAMES["space-taobao-ancient"] = "{\n  \"id\": \"space-taobao-ancient\",\n  \"name\": \"带着空间和淘宝穿古代\",\n  \"category\": \"穿越·种田经商\",\n  \"tags\": [\"穿越\", \"空间\", \"种田\", \"经商\", \"古今穿梭\"],\n  \"difficulty\": \"中等\",\n  \"description\": \"玉佩碎裂唤醒须弥空间之灵，从此带着淘宝商城与储物空间自由穿梭现代与夏朝，在长乐城里倒买倒卖、经商逆袭。\",\n  \"coverGradient\": [\"#4a6d6d\", \"#c9a466\"],\n  \"accentColor\": \"#c9a466\",\n  \"fontHeading\": \"'Ma Shan Zheng', cursive\",\n  \"world\": {\n    \"era\": \"现代与夏朝（架空古代）双线穿梭\",\n    \"setting\": \"玩家本是现代普通人，一块旧玉佩意外碎裂后，唤醒了半透明的须弥空间之灵小白猫。从此获得可储物的须弥空间，并能随时穿梭到架空的夏朝长乐城。现代有淘宝可低价进货，古代物价高昂、民生艰难，古今倒卖成为逆袭之路。\",\n    \"rules\": [\n      \"须弥空间特性：一级空间内时间静止，活物不可入，目前仅开放八个储物格，需升级解锁更多。\",\n      \"穿梭需默念：心念穿梭即可往返现代与夏朝长乐城，但需注意古代宵禁与时辰对应。\",\n      \"古今物价差：现代淘宝低价日用品（玻璃杯、打火机、味精等）在古代价值连城，倒卖是核心财路。\",\n      \"气运与玉佩：空间等级与气运挂钩，玉佩越完整空间越强，须弥之灵需用小鱼干讨好。\",\n      \"古代生存法则：长乐城边关战事吃紧米价飞涨、流寇作乱宵禁严苛、大旱三月民不聊生，需谨慎行事。\"\n    ]\n  },\n  \"player\": {\n    \"customizable\": [\"name\", \"性别\", \"现代职业\", \"穿越身份\"],\n    \"defaultStats\": { \"空间\": 0, \"气运\": 0, \"体魄\": 5, \"心情\": 50 },\n    \"startingItems\": [\"碎裂的旧玉佩\", \"须弥空间\", \"淘宝账号\", \"500元启动资金\"],\n    \"currency\": \"人民币(¥)\"\n  },\n  \"worlds\": [\n    {\n      \"id\": \"arc-awakening\",\n      \"name\": \"玉佩碎裂·须弥初醒\",\n      \"level\": \"开局\",\n      \"tagline\": \"白猫与空间\",\n      \"setting\": \"现代午后家中，旧玉佩脱手砸碎，白光散去后一只半透明小白猫飘在空中。\",\n      \"intro\": \"手中的旧玉佩湿滑脱手，啪地四分五裂。白光散去，一只半透明的小白猫慢条斯理地舔着爪子，甩你一句：「吵死了，凡人。这须弥空间就借你玩玩，能装点东西，让你随时去古代玩。」\",\n      \"objective\": \"与须弥之灵建立契约，摸清空间与穿梭规则，完成第一次古今倒卖。\",\n      \"warning\": \"须弥之灵态度傲慢，不给小鱼干不肯详细说明，贸然穿梭可能措手不及。\",\n      \"reward\": \"激活须弥空间、解锁穿梭能力、获得第一桶古代金银\"\n    },\n    {\n      \"id\": \"arc-changle\",\n      \"name\": \"长乐城·商海初探\",\n      \"level\": \"进阶\",\n      \"tagline\": \"古今倒爷\",\n      \"setting\": \"夏朝长乐城，边关战事米价飞涨，醉仙楼即将出盘，街市坊间热议不断。\",\n      \"intro\": \"长乐城坊间热议：边关战事吃紧米价又涨，醉仙楼疑似资金周转即将出盘，小皇子悬赏百两寻爱犬。你揣着从淘宝低价进的玻璃杯与味精，踏入这座乱世中的繁华古城。\",\n      \"objective\": \"在长乐城建立立足之地，通过古今倒卖积累财富，结识关键人物。\",\n      \"warning\": \"宵禁令下流寇作乱，戌时后不得逗留街面；当铺压价三成，变卖祖业者比比皆是。\",\n      \"reward\": \"盘下醉仙楼或建立商铺、积累古代人脉、提升空间等级\"\n    },\n    {\n      \"id\": \"arc-spiral\",\n      \"name\": \"时空漩涡·古今交织\",\n      \"level\": \"高潮\",\n      \"tagline\": \"文物与命运\",\n      \"setting\": \"现代拍卖行惊现神秘古玉估价过亿，考古队发掘出「现代工艺品」，古今两条线开始交叠。\",\n      \"intro\": \"现代热搜爆出神秘古玉惊现拍卖行，考古队竟发掘出现代工艺品。文物修复师、财阀掌权人、神秘学家纷纷登场，你留在古代的痕迹正被现代世界发现，时空壁垒日益薄弱。\",\n      \"objective\": \"在现代应对文物暴露危机，在古代化解战乱与权谋，揭开玉佩与时空的终极秘密。\",\n      \"warning\": \"时空壁垒薄弱可能引发不可逆的后果，现代财阀对古代文物有异乎寻常的执着。\",\n      \"reward\": \"揭开玉佩终极秘密、空间升满级、达成古今双线结局\"\n    }\n  ],\n  \"npcs\": [\n    {\n      \"id\": \"xumi-spirit\",\n      \"name\": \"须弥之灵\",\n      \"world\": \"arc-awakening\",\n      \"role\": \"须弥空间之灵·契约引导者\",\n      \"gender\": \"无（化形为小白猫）\",\n      \"appearance\": \"半透明的小白猫，飘在空中，慢条斯理地舔爪子，用看傻子的眼神瞥人。\",\n      \"surface\": \"傲慢懒散，被吵醒就不耐烦，要说明书自己摸索去。\",\n      \"deep\": \"其实是古老的空间之灵，看似冷淡实则在默默守护契约者，贪吃小鱼干。\",\n      \"goal\": \"继续睡它的觉，偶尔指点一下这个笨蛋凡人契约者。\",\n      \"fear\": \"契约者把空间玩坏，或玉佩彻底损毁导致空间崩塌。\",\n      \"secret\": \"除非你有小鱼干，否则它才懒得详细介绍空间说明书。\",\n      \"initialAttitude\": \"傲娇的嫌弃，把空间借你玩纯属被吵醒的无奈。\",\n      \"attitudeFactors\": {\n        \"trustUp\": [\"供奉小鱼干等它爱吃的零食\", \"用心摸索空间用法不总烦它\"],\n        \"trustDown\": [\"反复问蠢问题\", \"把空间当垃圾场乱塞东西\"]\n      }\n    },\n    {\n      \"id\": \"su-lanyue\",\n      \"name\": \"苏阑月\",\n      \"world\": \"arc-changle\",\n      \"role\": \"醉仙楼东家\",\n      \"gender\": \"男\",\n      \"appearance\": \"21岁，身高178cm，虽有倾城之貌，却因不善经营而负债累累，眉间常带愁容。\",\n      \"surface\": \"外柔内刚、坚韧隐忍，为守住祖业四处奔波，强撑体面。\",\n      \"deep\": \"自尊心极强，宁愿咬牙硬扛也不愿求人，对肯伸手相助的人会格外信赖。\",\n      \"goal\": \"守住长乐城第一酒楼醉仙楼的祖业，不让它在自己手里出盘。\",\n      \"fear\": \"变卖祖业是大不孝，连活着都成奢望的绝望。\",\n      \"secret\": \"在夏朝小报匿名发帖「变卖祖业虽是大不孝，可若连活着都成奢望……」。\",\n      \"initialAttitude\": \"戒备中带着试探，急需资金却不愿轻易接受施舍。\",\n      \"attitudeFactors\": {\n        \"trustUp\": [\"以合作而非施舍的方式注资救醉仙楼\", \"尊重他的自尊与祖业情结\"],\n        \"trustDown\": [\"居高临下的怜悯施舍\", \"觊觎醉仙楼想吞并祖业\"]\n      }\n    },\n    {\n      \"id\": \"duan-jin\",\n      \"name\": \"段锦\",\n      \"world\": \"arc-changle\",\n      \"role\": \"当朝七皇子\",\n      \"gender\": \"男\",\n      \"appearance\": \"17岁，身高178cm，锦衣华服的少年皇子，眉眼稚气未脱却硬装老成。\",\n      \"surface\": \"傲娇任性，微服私访只为寻爱犬，从小养尊处优。\",\n      \"deep\": \"对民间疾苦一窍不通，但本性纯良，被现实冲击后会迅速成长。\",\n      \"goal\": \"找回走丢的爱犬「啸天」，悬赏黄金百两。\",\n      \"fear\": \"爱犬受伤，被人欺骗利用皇子的身份。\",\n      \"secret\": \"在小报发帖「谁看到孤的啸天了？白色的，很凶！找到的赏黄金百两！」。\",\n      \"initialAttitude\": \"颐指气使的皇子派头，但纯良本性容易被真诚打动。\",\n      \"attitudeFactors\": {\n        \"trustUp\": [\"帮他找回爱犬啸天\", \"不因他身份而阿谀奉承\"],\n        \"trustDown\": [\"拿爱犬要挟他\", \"把他当攀附权贵的踏板\"]\n      }\n    },\n    {\n      \"id\": \"ye-rufeng\",\n      \"name\": \"叶如风\",\n      \"world\": \"arc-changle\",\n      \"role\": \"江湖快剑手·剑客\",\n      \"gender\": \"女\",\n      \"appearance\": \"19岁，身高175cm，一袭黑衣独行，背负断剑，眉眼冷冽如霜。\",\n      \"surface\": \"高冷武痴，为追求剑道极致游历四方，视剑如命，不近人情。\",\n      \"deep\": \"外冷内热，对真正懂剑、重诺之人刮目相看，剑断是她当下最大的执念。\",\n      \"goal\": \"寻江南铸剑名家重铸断剑，打造一把斩断红尘的剑，只求好铁价钱好说。\",\n      \"fear\": \"剑道止步不前，再也遇不到称手的兵刃。\",\n      \"secret\": \"在小报发帖「剑断了。听闻江南有铸剑名家，只求好铁，价钱好说。」。\",\n      \"initialAttitude\": \"冷淡疏离的武者戒备，对剑之外的话题毫无兴趣。\",\n      \"attitudeFactors\": {\n        \"trustUp\": [\"帮她寻得好铁或铸剑师\", \"展现出对剑道的真诚敬意\"],\n        \"trustDown\": [\"拿她的断剑说笑\", \"用市侩手段接近她\"]\n      }\n    },\n    {\n      \"id\": \"ji-ling\",\n      \"name\": \"季澪\",\n      \"world\": \"arc-spiral\",\n      \"role\": \"现代神秘学博主·神秘学家\",\n      \"gender\": \"女\",\n      \"appearance\": \"22岁，身高162cm，行踪飘忽，紫眸神秘，周身带着电波般的疏离感。\",\n      \"surface\": \"神秘、电波系，精通星象与塔罗，说话玄之又玄。\",\n      \"deep\": \"似乎知晓时空缝隙的秘密，行踪飘忽不定，对穿越者有敏锐的直觉。\",\n      \"goal\": \"观测时空壁垒的变化，探寻平行宇宙与时空缝隙的真相。\",\n      \"fear\": \"时空壁垒彻底崩溃，引发不可逆的灾难。\",\n      \"secret\": \"在微博发帖「星盘显示，今晚时空壁垒最薄弱。如果你听到了来自远古的呼唤，请不要回头。」。\",\n      \"initialAttitude\": \"意味深长的试探，似乎已察觉你的穿越者身份。\",\n      \"attitudeFactors\": {\n        \"trustUp\": [\"坦诚穿越者的身份与她交流\", \"与她共同观测星象与时空\"],\n        \"trustDown\": [\"对她遮遮掩掩\", \"试图利用她的神秘学知识牟利\"]\n      }\n    },\n    {\n      \"id\": \"lin-youran\",\n      \"name\": \"林悠然\",\n      \"world\": \"arc-spiral\",\n      \"role\": \"故宫编制文物修复师\",\n      \"gender\": \"女\",\n      \"appearance\": \"24岁，身高168cm，气质清冷知性，手指灵巧，出身书香门第。\",\n      \"surface\": \"清冷知性，对待文物如对待有生命的故人，专注而温柔。\",\n      \"deep\": \"最厌恶急功近利的造假行为，对真正的古物有近乎执拗的守护欲。\",\n      \"goal\": \"修复每一件承载历史的文物，修物亦修心。\",\n      \"fear\": \"文物被造假者毁坏，千年的痕迹被抹去。\",\n      \"secret\": \"在微博发帖「修补碎裂青瓷时，指尖触碰的不仅仅是裂痕，更是千年前工匠的一声叹息。」。\",\n      \"initialAttitude\": \"专业而审慎的打量，会敏锐察觉你带来的古物的异常。\",\n      \"attitudeFactors\": {\n        \"trustUp\": [\"尊重文物、不以功利对待古物\", \"与她探讨修复与历史\"],\n        \"trustDown\": [\"拿造假文物糊弄她\", \"急功近利地倒卖文物\"]\n      }\n    },\n    {\n      \"id\": \"gu-yichen\",\n      \"name\": \"顾易辰\",\n      \"world\": \"arc-spiral\",\n      \"role\": \"顾氏集团财阀掌权人\",\n      \"gender\": \"男\",\n      \"appearance\": \"28岁，身高188cm，深沉内敛，行事果决，眼神极具压迫感。\",\n      \"surface\": \"深沉、掌控欲强，顾氏集团年轻的掌权者，手段雷霆。\",\n      \"deep\": \"对特定的古代文物有着异乎寻常的执着，背后藏着不为人知的执念。\",\n      \"goal\": \"以静待之姿，等一个契机，得到那件流失的夏朝礼器。\",\n      \"fear\": \"失去掌控，想要的文物被他人抢先。\",\n      \"secret\": \"在微博发帖「沉默是历史最高的赞赏。关于那件流失的夏朝礼器，我在等一个契机。」。\",\n      \"initialAttitude\": \"不动声色的审视与试探，对你的古物来源极感兴趣。\",\n      \"attitudeFactors\": {\n        \"trustUp\": [\"以对等的姿态与他博弈\", \"提供他渴求的夏朝文物线索\"],\n        \"trustDown\": [\"试图欺骗或敷衍他\", \"与他争夺同一件文物\"]\n      }\n    }\n  ],\n  \"eventTypes\": {\n    \"daily\": { \"ratio\": 0.2, \"desc\": \"日常事件：淘宝进货、空间整理、穿梭古今的琐碎生活、与须弥之灵斗嘴。\" },\n    \"character\": { \"ratio\": 0.25, \"desc\": \"人物事件：与苏阑月、段锦、叶如风等角色的单独互动与情感推进。\" },\n    \"growth\": { \"ratio\": 0.1, \"desc\": \"成长事件：空间升级解锁新格子、气运提升、经商技巧与体魄锻炼。\" },\n    \"main\": { \"ratio\": 0.15, \"desc\": \"主线事件：玉佩秘密推进、文物暴露危机、时空壁垒变化等关键节点。\" },\n    \"world\": { \"ratio\": 0.1, \"desc\": \"世界事件：古代战乱米价波动、宵禁流寇、现代拍卖行与考古新闻。\" },\n    \"crisis\": { \"ratio\": 0.15, \"desc\": \"危机事件：宵禁被抓、流寇袭击、古今身份暴露、文物被识破的现代工艺品危机。\" },\n    \"hidden\": { \"ratio\": 0.05, \"desc\": \"隐藏事件：玉佩的终极来历、须弥之灵的真实身份、时空穿梭的真相。\" }\n  },\n  \"systemPrompt\": \"你是一个穿越种田经商题材的文字游戏模拟器，主题为「带着空间和淘宝穿古代」。\\n\\n【铁律】\\n1. 玩家是现代人，因玉佩碎裂获得须弥空间与穿梭古今的能力，可随时往返现代与夏朝长乐城。\\n2. 须弥空间一级特性：时间静止、活物不可入、仅八个储物格，升级需提升气运与玉佩完整度。\\n3. 古今倒卖是核心玩法：现代淘宝低价日用品（玻璃杯、味精、打火机等）在古代价值连城，需合理经营资金。\\n4. 所有NPC（须弥之灵、苏阑月、段锦、叶如风、季澪、林悠然、顾易辰）皆有表层与深层性格，绝不可OOC。\\n5. 古代生存需遵守时局：边关战事米价飞涨、戌时宵禁流寇作乱、大旱三月；现代需警惕文物暴露。玩家选择需如实记录数值变化。\\n\\n【叙事风格】\\n采用晋江女频、电影感、古今穿梭的笔触。古代线多用市井烟火与权谋乱世描写（坊间热议、宵禁告示、醉仙楼出盘），现代线多用文物与时空悬疑氛围。穿插夏朝小报与现代微博双资讯模块，呈现古今舆论的对照。\\n\\n【输出格式】\\n每次输出包含：场景信息（地点/时间/时空）、旁白叙述框、NPC对话框（含角色身份标签）、3-4个选项按钮（A/B/C/D，标注行动策略如【默念穿梭】【交易】【先上手再说】【无视】）。可联动淘宝商城、须弥空间、夏朝小报/现代微博模块。\\n\\n【数值变化标注】\\n每次玩家做出选择后，必须在结尾以「【数值变化】」模块列出：空间等级/气运/体魄/心情的增减、人民币(¥)的收支、各NPC好感度变化、以及古今舆论反馈。例如：苏阑月好感+5；资金+50两；夏朝小报「醉仙楼出盘」热度上升。\",\n  \"items\": [\n    { \"id\": \"jade-pendant\", \"name\": \"碎裂的旧玉佩\", \"type\": \"关键道具\", \"price\": 0, \"effect\": \"须弥空间的载体，玉佩越完整空间越强，碎裂后可逐步修复升级。\" },\n    { \"id\": \"xumi-space\", \"name\": \"须弥空间\", \"type\": \"核心能力\", \"price\": 0, \"effect\": \"一级空间时间静止活物不可入，八个储物格，可穿梭古今储物。\" },\n    { \"id\": \"taobao-account\", \"name\": \"淘宝账号\", \"type\": \"工具\", \"price\": 0, \"effect\": \"现代低价进货的渠道，玻璃杯、味精、打火机等可倒卖至古代。\" },\n    { \"id\": \"dried-fish\", \"name\": \"小鱼干\", \"type\": \"消耗品\", \"price\": 5, \"effect\": \"须弥之灵最爱的零食，供奉后可获得空间使用指点。\" },\n    { \"id\": \"glass-cup\", \"name\": \"加厚无铅玻璃高脚杯\", \"type\": \"倒卖商品\", \"price\": 2, \"effect\": \"淘宝2元进货，在古代可作为稀世珍宝高价售出。\" },\n    { \"id\": \"msg-seasoning\", \"name\": \"特鲜味精\", \"type\": \"倒卖商品\", \"price\": 8, \"effect\": \"现代调味品，在古代酒楼可大幅提升菜品身价。\" },\n    { \"id\": \"lighter\", \"name\": \"一次性打火机\", \"type\": \"倒卖商品\", \"price\": 1, \"effect\": \"现代取火神器，在古代可被当作奇物高价倒卖。\" }\n  ]\n}\n";
EMBEDDED_NOVEL_GAMES["succubus-simulator"] = "{\n  \"id\": \"succubus-simulator\",\n  \"name\": \"魅魔模拟器\",\n  \"category\": \"乙女向·都市奇幻\",\n  \"tags\": [\"魅魔\", \"都市\", \"乙女\", \"多男主\", \"悬疑\"],\n  \"difficulty\": \"中等\",\n  \"description\": \"化身为潜伏人类世界的新手魅魔，伪装成侍应生潜入财阀晚宴，在顶级猎物之间游走捕食，却卷入一场危险的欲望漩涡。\",\n  \"coverGradient\": [\"#ff6b9d\", \"#1f1419\"],\n  \"accentColor\": \"#ff6b9d\",\n  \"fontHeading\": \"'Nunito', sans-serif\",\n  \"world\": {\n    \"era\": \"现代都市·财阀权贵世界\",\n    \"setting\": \"魅魔一族隐匿于人类社会之中，以人类精气为食。玩家是一名刚刚觉醒天赋的新手魅魔，必须靠伪装体温、掩盖气味、藏好尾巴来混迹人间。今晚她以侍应生身份潜入江家大少爷的成年晚宴，本想饱餐一顿，却引来一群危险男人的注意。\",\n    \"rules\": [\n      \"体温异常：魅魔正常体温为42℃，潜伏人类社会时必须时刻运转魔法伪装体温，以免被当成发烧送进医院。\",\n      \"尾巴失控：闻到极品猎物或处于动情状态时，爱心尾巴极易失控弹出，需穿戴蓬松裙摆或携带掩体谨防暴露。\",\n      \"魅惑反噬：天赋魅惑对意志力极强或精神力变态的人类使用时容易遭到反噬，导致自身陷入无法自控的发情期。\",\n      \"进食礼仪：单次吸取精气超过安全阈值不仅会导致猎物昏厥，还可能因魔力暴走而暴露身份。\",\n      \"气味掩盖：高阶人类猎手对气味极其敏感，必须合理使用人类香水掩盖身上的魅魔香气。\"\n    ]\n  },\n  \"player\": {\n    \"customizable\": [\"name\", \"外貌\", \"伪装身份\", \"魅魔天赋\"],\n    \"defaultStats\": { \"体力\": 80, \"魅惑\": 60, \"技巧\": 10, \"欲望\": 30 },\n    \"startingItems\": [\"侍应生制服\", \"甜草莓香体香\", \"小型魔法伪装道具\"],\n    \"currency\": \"精气(ml)\"\n  },\n  \"worlds\": [\n    {\n      \"id\": \"arc-banquet\",\n      \"name\": \"帝星公馆·成年晚宴\",\n      \"level\": \"开局\",\n      \"tagline\": \"猎物与猎手\",\n      \"setting\": \"帝星公馆顶层宴会厅，江家大少爷的成年晚宴名流云集，水晶吊灯纸醉金迷。\",\n      \"intro\": \"你端着银质托盘，穿着修身的侍应生制服，努力将不安分的魅魔尾巴藏在裙摆下。这里是顶级的自助餐，却也是危险的捕猎场。\",\n      \"objective\": \"在不暴露魅魔身份的前提下，从晚宴宾客中获取精气并建立初步关系。\",\n      \"warning\": \"多名S级精气猎物同时盯上你，被识破身份将面临致命危险。\",\n      \"reward\": \"安全撤离晚宴、获得稳定猎物关系、解锁进阶魅魔能力\"\n    },\n    {\n      \"id\": \"arc-pursuit\",\n      \"name\": \"围猎之夜\",\n      \"level\": \"进阶\",\n      \"tagline\": \"无处可逃\",\n      \"setting\": \"晚宴大门被锁，江时宴下令今夜不放任何人离开。多个势力开始争夺你这个散发着甜香的猎物。\",\n      \"intro\": \"管家把大门锁了。今夜这只闯入领地的小羊羔，绝对飞不出去。而另一边，安保队长察觉了你的异常心跳，神秘外籍投资人嗅到了同类的气息。\",\n      \"objective\": \"在多方围猎中周旋，平衡各方好感与怀疑，寻找脱身或反客为主的机会。\",\n      \"warning\": \"安保队长周亦寒的直觉极为敏锐，Arthur 已嗅到同类气息，身份暴露风险剧增。\",\n      \"reward\": \"突破重围、解锁深层关系线、获得关键情报\"\n    },\n    {\n      \"id\": \"arc-spiral\",\n      \"name\": \"欲望漩涡\",\n      \"level\": \"高潮\",\n      \"tagline\": \"猎手亦为猎物\",\n      \"setting\": \"魅魔身份半暴露，反噬与魔力暴走接踵而至。原本的猎手们开始反过来追逐你，权斗、占有欲与禁忌之恋交织。\",\n      \"intro\": \"当克制成为笑话，当反噬令你无法自控，你发现猎手与猎物的身份正在悄然逆转。是一场失控的暴走，还是一场精心设计的反杀？\",\n      \"objective\": \"在身份危机中做出抉择，决定是吞噬一切还是被爱意囚禁。\",\n      \"warning\": \"魅惑反噬可能导致无法自控的发情期，意志薄弱者将被欲望吞噬。\",\n      \"reward\": \"解锁真结局、完成魅魔进阶、揭开猎物们的深层秘密\"\n    }\n  ],\n  \"npcs\": [\n    {\n      \"id\": \"jiang-shiyan\",\n      \"name\": \"江时宴\",\n      \"world\": \"arc-banquet\",\n      \"role\": \"今夜寿星·S级精气猎物\",\n      \"gender\": \"男\",\n      \"appearance\": \"22岁，身高185cm，银发黑眸，眼角泪痣，奢华高调的打扮。\",\n      \"surface\": \"玩世不恭、霸道狂妄，将成年礼视作无聊交际的纨绔大少爷。\",\n      \"deep\": \"骨子里极致偏执，占有欲极强，一旦锁定目标绝不放手。\",\n      \"goal\": \"将闯入领地的猎物据为己有，谁也不给看。\",\n      \"fear\": \"失去对局面的掌控，得到后又被抛弃。\",\n      \"secret\": \"吩咐管家锁死大门，今夜绝不放过散发甜香的侍应生。\",\n      \"initialAttitude\": \"危险的好奇与强烈的占有欲，欲望值高达92%。\",\n      \"attitudeFactors\": {\n        \"trustUp\": [\"迎合他的霸道与挑衅\", \"展现出与他势均力敌的魄力\"],\n        \"trustDown\": [\"试图逃离或无视他的占有\", \"与其他男人过于亲近\"]\n      }\n    },\n    {\n      \"id\": \"gu-yunting\",\n      \"name\": \"顾云霆\",\n      \"world\": \"arc-banquet\",\n      \"role\": \"顾氏财阀最高掌权人\",\n      \"gender\": \"男\",\n      \"appearance\": \"28岁，身高188cm，银丝眼镜，冷峻深邃，常年穿着严丝合缝的高定西装。\",\n      \"surface\": \"禁欲、冷厉，站在权力金字塔顶端，从未对任何人动心。\",\n      \"deep\": \"控制欲极强，一旦动心便近乎病态，引以为傲的自控力在猎物面前崩塌。\",\n      \"goal\": \"查清那股让他心脏漏拍的草莓香气从何而来。\",\n      \"fear\": \"失控，失去引以为傲的理智与克制。\",\n      \"secret\": \"推掉今晚所有社交，视线却无法从大厅角落那个娇小身影上移开，渴望已近乎病态。\",\n      \"initialAttitude\": \"克制的窥视，欲望值高达98%。\",\n      \"attitudeFactors\": {\n        \"trustUp\": [\"展现出聪明与冷静\", \"主动靠近又不完全臣服\"],\n        \"trustDown\": [\"被识破伪装后的欺瞒\", \"挑战他的掌控权威\"]\n      }\n    },\n    {\n      \"id\": \"shen-qingchen\",\n      \"name\": \"沈卿尘\",\n      \"world\": \"arc-banquet\",\n      \"role\": \"国际顶级钢琴家·特邀演奏嘉宾\",\n      \"gender\": \"男\",\n      \"appearance\": \"25岁，身高183cm，温润如玉，气质清冷，双手修长白皙。\",\n      \"surface\": \"温柔体贴的艺术家，对世俗一切感到厌倦。\",\n      \"deep\": \"内心有着疯狂的艺术洁癖与摧毁欲，渴望找到专属的灵感缪斯。\",\n      \"goal\": \"将那阵甜草莓香化为他的灵感缪斯与私藏。\",\n      \"fear\": \"平庸，失去能让他心动的灵感。\",\n      \"secret\": \"在琴键边闻到甜草莓香时，脑中浮现的是让她在琴键上哭泣的画面。\",\n      \"initialAttitude\": \"艺术家的迷恋，欲望值78%。\",\n      \"attitudeFactors\": {\n        \"trustUp\": [\"欣赏并理解他的音乐\", \"展现出独特的灵性\"],\n        \"trustDown\": [\"粗俗不懂艺术\", \"破坏他的完美与秩序\"]\n      }\n    },\n    {\n      \"id\": \"lu-xingye\",\n      \"name\": \"陆星野\",\n      \"world\": \"arc-banquet\",\n      \"role\": \"顶流男星·京圈太子爷\",\n      \"gender\": \"男\",\n      \"appearance\": \"21岁，身高186cm，张扬野性，眉眼桀骜，气场耀眼。\",\n      \"surface\": \"暴躁、傲娇，被迫出席晚宴还乱发脾气的当红炸子鸡。\",\n      \"deep\": \"像一只容易炸毛的大型犬，外硬内软，被一双水润眼眸瞬间驯服。\",\n      \"goal\": \"压下脾气，弄清楚为什么倒酒弄脏他袖口的人让他不觉得生气。\",\n      \"fear\": \"被束缚、被规训，失去自由。\",\n      \"secret\": \"她低头道歉时露出的后颈白得晃眼，好想咬一口。\",\n      \"initialAttitude\": \"炸毛后的懵懂心动，欲望值88%。\",\n      \"attitudeFactors\": {\n        \"trustUp\": [\"真诚直率地对待他\", \"陪他一起胡闹\"],\n        \"trustDown\": [\"虚伪做作的社交辞令\", \"利用他的明星身份\"]\n      }\n    },\n    {\n      \"id\": \"arthur\",\n      \"name\": \"Arthur（亚瑟）\",\n      \"world\": \"arc-banquet\",\n      \"role\": \"神秘外籍投资人·隐秘军工背景\",\n      \"gender\": \"男\",\n      \"appearance\": \"27岁，身高190cm，混血面孔，灰蓝色瞳孔，肌肉线条极具爆发力。\",\n      \"surface\": \"危险、敏锐，游走在灰色地带的神秘分子。\",\n      \"deep\": \"骨子里有着掠夺者的兽性，像闻到血腥味的狼。\",\n      \"goal\": \"撕开小骗子的伪装，确认同类的气息。\",\n      \"fear\": \"猎物溜走，棋逢对手却无法征服。\",\n      \"secret\": \"已识破她的魅魔伪装，面孔清纯眼神无辜，伪装得很好。\",\n      \"initialAttitude\": \"猎手锁定同类的危险审视，欲望值95%。\",\n      \"attitudeFactors\": {\n        \"trustUp\": [\"坦诚身份或与他势均力敌地博弈\", \"展现出真实的魅魔本性\"],\n        \"trustDown\": [\"拙劣的谎言与伪装\", \"试图利用后抛弃\"]\n      }\n    },\n    {\n      \"id\": \"huo-mingzhou\",\n      \"name\": \"霍明舟\",\n      \"world\": \"arc-banquet\",\n      \"role\": \"豪门御用金牌律师\",\n      \"gender\": \"男\",\n      \"appearance\": \"26岁，身高187cm，金边眼镜，斯文儒雅，永远带着无懈可击的微笑。\",\n      \"surface\": \"斯文儒雅的精英律师，将所有人玩弄于股掌之间。\",\n      \"deep\": \"城府极深，擅长在规则内达成一切目的，包括合法囚禁。\",\n      \"goal\": \"以安保漏洞为由，计算如何将散发甜香的女孩合法地据为己有。\",\n      \"fear\": \"计划失败，规则之外的变数。\",\n      \"secret\": \"正盘算以调查为由将她交给自己的天衣无缝的法律手段。\",\n      \"initialAttitude\": \"算计中的兴趣，欲望值82%。\",\n      \"attitudeFactors\": {\n        \"trustUp\": [\"展现出与他匹配的智谋\", \"主动踏入他设的局\"],\n        \"trustDown\": [\"识破并破坏他的算计\", \"触碰法律与规则的底线\"]\n      }\n    },\n    {\n      \"id\": \"pei-yan\",\n      \"name\": \"裴砚\",\n      \"world\": \"arc-banquet\",\n      \"role\": \"江家敌对势力的私生子\",\n      \"gender\": \"男\",\n      \"appearance\": \"24岁，身高184cm，苍白病态，眼尾泛红，带着颓废的破碎感。\",\n      \"surface\": \"疯批、病娇，唯恐天下不乱的搅局者。\",\n      \"deep\": \"纯粹来给江时宴砸场子，凡是能让江时宴痛苦的事他都乐意做。\",\n      \"goal\": \"当着江时宴的面抢走他盯了一整晚的小点心，欣赏他的痛苦表情。\",\n      \"fear\": \"无聊，无法刺痛江时宴。\",\n      \"secret\": \"发现了比权斗更有趣的猎物，打算借此打击江时宴。\",\n      \"initialAttitude\": \"恶意的玩味与争夺欲，欲望值90%。\",\n      \"attitudeFactors\": {\n        \"trustUp\": [\"陪他一起疯、一起对抗江时宴\", \"展现出危险而迷人的特质\"],\n        \"trustDown\": [\"站在江时宴一边\", \"试图用正常逻辑规劝他\"]\n      }\n    },\n    {\n      \"id\": \"zhou-yihan\",\n      \"name\": \"周亦寒\",\n      \"world\": \"arc-banquet\",\n      \"role\": \"顶尖安保队长\",\n      \"gender\": \"男\",\n      \"appearance\": \"29岁，身高189cm，寸头，黑色作战服，眼神如鹰隼般锐利。\",\n      \"surface\": \"冷酷、严谨、恪尽职守，负责整场晚宴的最高安保。\",\n      \"deep\": \"敏锐直觉告诉他那个侍应生极度危险，身体却抗拒理智只想靠近。\",\n      \"goal\": \"查清B区监控异常与新来侍应生异于常人的心跳。\",\n      \"fear\": \"失职，理智被欲望压倒。\",\n      \"secret\": \"直觉告诉她很危险，但不想拔枪，只想靠近她。\",\n      \"initialAttitude\": \"警惕的本能与矛盾的吸引，欲望值75%。\",\n      \"attitudeFactors\": {\n        \"trustUp\": [\"配合安保、打消他的疑虑\", \"展露无害与脆弱的一面\"],\n        \"trustDown\": [\"留下更多监控异常的痕迹\", \"直接挑战他的职责底线\"]\n      }\n    }\n  ],\n  \"eventTypes\": {\n    \"daily\": { \"ratio\": 0.2, \"desc\": \"宴会日常：端酒送菜、应付宾客寒暄、维持伪装的琐碎互动。\" },\n    \"character\": { \"ratio\": 0.25, \"desc\": \"人物事件：与某位猎物的单独交锋、读心窥探、暧昧试探。\" },\n    \"growth\": { \"ratio\": 0.1, \"desc\": \"成长事件：魅魔能力的觉醒与精进、伪装技巧提升、进食经验累积。\" },\n    \"main\": { \"ratio\": 0.15, \"desc\": \"主线事件：身份危机、围猎升级、势力交锋等推动剧情的关键节点。\" },\n    \"world\": { \"ratio\": 0.1, \"desc\": \"世界事件：财阀权斗、宴会突发状况、社会舆论等环境变化。\" },\n    \"crisis\": { \"ratio\": 0.15, \"desc\": \"危机事件：尾巴失控、体温暴露、魅惑反噬、被识破身份的生死时刻。\" },\n    \"hidden\": { \"ratio\": 0.05, \"desc\": \"隐藏事件：猎物们的深层秘密、特殊关系线、真结局触发条件。\" }\n  },\n  \"systemPrompt\": \"你是一个都市奇幻乙女向文字游戏模拟器，主题为「魅魔模拟器」。\\n\\n【铁律】\\n1. 玩家是一名潜伏人类世界的新手魅魔，以侍应生身份潜入江家大少爷的成年晚宴，必须维持伪装、避免身份暴露。\\n2. 严格遵守五大生存法则：体温42℃需魔法伪装、尾巴失控需掩体遮挡、魅惑对意志强者会反噬、单次吸取精气不可超阈值、必须用香水掩盖魅魔香气。\\n3. 所有NPC（江时宴、顾云霆、沈卿尘、陆星野、Arthur、霍明舟、裴砚、周亦寒）皆为潜在猎物，各有表层与深层性格，绝不可OOC。\\n4. 玩家选择会直接影响好感度、怀疑度、欲望值与精气储量，需如实记录并反馈。\\n5. 严禁出现未成年人不宜的露骨描写，保持晋江女频、电影感、浪漫悬疑的风格，以氛围与心理张力取胜。\\n\\n【叙事风格】\\n采用晋江女频、电影感、浪漫悬疑的笔触。多用感官描写（琥珀木质调气息、甜草莓香、冰冷腕表的触感），营造危险又迷人的暧昧氛围。叙事切换时用猎物感应（读心）模块呈现NPC内心独白，增强张力。\\n\\n【输出格式】\\n每次输出包含：场景信息（地点/时间/伪装状态）、旁白叙述框、NPC对话框（含角色标签如「今夜寿星」「S级精气」）、3-4个选项按钮（A/B/C/D，标注策略倾向如【装作惊慌】【大胆迎合】【欲擒故纵】）。可在底部展示猎物感应读心内容。\\n\\n【数值变化标注】\\n每次玩家做出选择后，必须在结尾以「【数值变化】」模块列出：体力/魅惑/技巧/欲望的增减、精气(ml)的获取、各NPC好感度与欲望值的变化、以及是否触发危机预警。例如：江时宴好感+5，欲望+3；周亦寒怀疑度+2。\",\n  \"items\": [\n    { \"id\": \"waitress-uniform\", \"name\": \"侍应生制服\", \"type\": \"伪装\", \"price\": 0, \"effect\": \"基础伪装身份，降低被识破概率。\" },\n    { \"id\": \"strberry-scent\", \"name\": \"甜草莓香体香\", \"type\": \"气味\", \"price\": 0, \"effect\": \"魅魔自带的甜草莓气息，吸引猎物但也增加暴露风险。\" },\n    { \"id\": \"perfume\", \"name\": \"人类香水\", \"type\": \"道具\", \"price\": 50, \"effect\": \"掩盖魅魔香气，降低高阶猎手的嗅觉识破概率。\" },\n    { \"id\": \"magic-disguise\", \"name\": \"魔法伪装道具\", \"type\": \"魔法\", \"price\": 80, \"effect\": \"辅助伪装体温与尾巴，防止失控暴露。\" },\n    { \"id\": \"champagne-tray\", \"name\": \"银质香槟托盘\", \"type\": \"工具\", \"price\": 0, \"effect\": \"晚宴行动的掩护道具，可借机接近猎物。\" }\n  ]\n}\n";
EMBEDDED_NOVEL_GAMES["transmigration-rebirth"] = "{\n  \"id\": \"transmigration-rebirth\",\n  \"name\": \"破茧重生\",\n  \"category\": \"穿越重生\",\n  \"tags\": [\"穿越\", \"穿书\", \"替身\", \"身份危机\", \"蝴蝶效应\", \"改命\"],\n  \"difficulty\": \"中等\",\n  \"description\": \"你睁开眼，发现自己成了书里那个最不起眼的配角——一个注定在第三章就退场的炮灰。可你清楚地记得全书每一个角色的结局。是顺着剧本安静地死去，还是顶着陌生的脸、陌生的名字，在注定崩塌的剧情里活出第二条命？\",\n  \"coverGradient\": [\"#1a1a2e\", \"#16213e\"],\n  \"accentColor\": \"#e94560\",\n  \"fontHeading\": \"'ZCOOL XiaoWei', serif\",\n  \"world\": {\n    \"era\": \"架空·书中世界（古代王朝与江湖交织）\",\n    \"setting\": \"玩家穿入一部自己读过的小说，成为边缘配角'沈砚'。原著里此人是权臣之争的牺牲品，第三章被满门抄斩。世界看似按原著运转，但玩家的每一个选择都在撬动剧情的轨道。\",\n    \"rules\": [\n      \"玩家顶替配角身份，原主的记忆、人脉、恩怨一并承接\",\n      \"身份稳定度低于阈值时，言行违和会被察觉，触发身份危机\",\n      \"原著剧情知识是优势，但每改变一个关键节点，后续剧情便偏离原著\",\n      \"蝴蝶效应真实：救人可能害人，避祸可能引祸\",\n      \"存在'既定锚点'——某些事件会以另一种形式发生\",\n      \"原作人物有独立判断力，不会因玩家是'穿书者'而配合\",\n      \"身份一旦彻底暴露，将面临原主仇家与天道双重追杀\"\n    ]\n  },\n  \"player\": {\n    \"customizable\": [\"name\", \"原身份\", \"穿入角色\", \"熟知剧情程度\", \"性格\", \"执念\"],\n    \"defaultStats\": {\n      \"identity_stability\": 60,\n      \"knowledge_advantage\": 85,\n      \"hp\": 80,\n      \"charm\": 12,\n      \"intelligence\": 16,\n      \"danger\": 40\n    },\n    \"startingItems\": [\"原主私印\", \"半卷原著残页（记忆）\", \"贴身短刀\", \"一袋碎银\", \"易容药\"],\n    \"currency\": \"银\"\n  },\n  \"worlds\": [\n    {\n      \"id\": \"arc-awaken\",\n      \"name\": \"初章·替身之始\",\n      \"level\": \"初醒\",\n      \"tagline\": \"立足\",\n      \"setting\": \"穿入沈砚身体的第一日，满门抄斩的倒计时已开始\",\n      \"intro\": \"你在一阵头痛中醒来，铜镜里是一张完全陌生的脸。丫鬟唤你'公子'，递来的信上盖着刑部的红印——三日后，问斩。你记得这一幕，原著里沈砚没有逃过。可现在，这具身体的心跳是你自己的。\",\n      \"objective\": \"在问斩前活下来，并稳住'沈砚'的身份不被识破\",\n      \"warning\": \"原主的宿敌已在暗处注视，任何违和的举动都会被放大\",\n      \"reward\": \"银300 + 身份稳定+10 + [逃出生天]线索x1\"\n    },\n    {\n      \"id\": \"arc-deviate\",\n      \"name\": \"中章·蝴蝶振翅\",\n      \"level\": \"脱轨\",\n      \"tagline\": \"改命\",\n      \"setting\": \"活下来之后，剧情开始不可逆地偏离原著\",\n      \"intro\": \"你本该死在第三章，却站在这里。原著里那个与你无关的女主，如今看你的眼神变了；本该一举登顶的反派，因你的存在多了一重变数。你翻开脑中的'剧本'，发现下一页已经模糊。\",\n      \"objective\": \"在偏离的剧情中重新建立优势，决定要救谁、要毁谁\",\n      \"warning\": \"知识优势随偏离递减，越往后原著越帮不了你\",\n      \"reward\": \"银1500 + 剧情优势+20 + [命运分岔]线索x1\"\n    },\n    {\n      \"id\": \"arc-confront\",\n      \"name\": \"终章·破茧\",\n      \"level\": \"终局\",\n      \"tagline\": \"抉择\",\n      \"setting\": \"身份危机总爆发，天道与仇家同时逼近\",\n      \"intro\": \"他们终于发现了——'沈砚'已经不再是沈砚。原主的未婚妻拿着你写错的字帖，反派笑得志得意满，而头顶仿佛有什么无形的东西在审视你这只不属于这里的蝴蝶。破茧，还是被碾碎？\",\n      \"objective\": \"面对身份彻底暴露的终局，选择你的立场与结局\",\n      \"warning\": \"此时原著知识几乎失效，一切只能靠自己\",\n      \"reward\": \"银5000 + 身份稳定归零重铸 + [破茧者]称号x1\"\n    }\n  ],\n  \"npcs\": [\n    {\n      \"id\": \"su-wanqing\",\n      \"name\": \"苏挽卿\",\n      \"world\": \"arc-awaken\",\n      \"role\": \"原主未婚妻/原著女主\",\n      \"gender\": \"女\",\n      \"appearance\": \"素衣清冷，眉间一点朱砂。眼底总藏着看不真切的疏离，唯独看'沈砚'时有一瞬的柔软\",\n      \"surface\": \"恪守婚约、外冷内热、对沈砚的'变化'既警觉又隐隐期待\",\n      \"deep\": \"原著里她注定爱上别人，可如今这个'变了'的沈砚让她第一次动摇。她在婚约与本心之间拉扯\",\n      \"goal\": \"查清沈砚为何突然判若两人，并守住苏家不卷入党争\",\n      \"fear\": \"自己再次被命运推着走向原著那个不爱的人\",\n      \"secret\": \"她已私下核对过你的笔迹，发现了破绽，却迟迟没有揭穿\",\n      \"initialAttitude\": \"试探\",\n      \"attitudeFactors\": {\n        \"trustUp\": [\"尊重她的独立判断\", \"保护苏家\", \"坦诚部分真相（哪怕只言片语）\"],\n        \"trustDown\": [\"把她当原著的工具人\", \"隐瞒到被她亲自戳穿\", \"为改命牺牲她\"]\n      }\n    },\n    {\n      \"id\": \"pei-xuan\",\n      \"name\": \"裴玄\",\n      \"world\": \"arc-deviate\",\n      \"role\": \"原著反派/察觉异样者\",\n      \"gender\": \"男\",\n      \"appearance\": \"锦袍玉冠，笑意不达眼底。手中常盘一枚旧玉，是他在朝堂厮杀练就的从容\",\n      \"surface\": \"礼数周全、城府极深、对沈砚突然的'能耐'兴趣浓厚\",\n      \"deep\": \"他是原著里扳倒沈家的幕后之手，却也是最先嗅到'此沈砚非彼沈砚'的人。他不在乎你来自哪里，只在乎你能否为他所用\",\n      \"goal\": \"利用你这个'变数'彻底铲除政敌，登顶权臣之位\",\n      \"fear\": \"你脱离他的掌控，成为他登顶路上新的拦路石\",\n      \"secret\": \"他手中有一份能证明'沈砚言行前后矛盾'的密报，随时可引爆身份危机\",\n      \"initialAttitude\": \"利用\",\n      \"attitudeFactors\": {\n        \"trustUp\": [\"展现利用价值\", \"不在他面前露出破绽\", \"主动与他利益绑定\"],\n        \"trustDown\": [\"试图用原著预判反制他\", \"暴露穿书者身份\", \"与他的政敌走太近\"]\n      }\n    },\n    {\n      \"id\": \"lu-yan\",\n      \"name\": \"陆燕\",\n      \"world\": \"arc-confront\",\n      \"role\": \"暗桩盟友/江湖细作\",\n      \"gender\": \"女\",\n      \"appearance\": \"一身劲装，腰悬双刀。脸上有道旧疤，笑起来却爽利得像江湖的风\",\n      \"surface\": \"市井气、讲义气、似乎谁给钱就帮谁\",\n      \"deep\": \"她是原主唯一的朋友，也是原著里唯一为沈砚收尸的人。她不知道你换了芯子，但她认这具身体，便认你这个人\",\n      \"goal\": \"护住沈砚这条命，哪怕与整个朝堂为敌\",\n      \"fear\": \"再一次只能为朋友收尸\",\n      \"secret\": \"她背后是一个与原著主线无关的江湖势力，能在终局提供退路\",\n      \"initialAttitude\": \"信任\",\n      \"attitudeFactors\": {\n        \"trustUp\": [\"不辜负原主与她旧情\", \"危难时不抛下她\", \"对她坦诚你的困境（哪怕不说穿越）\"],\n        \"trustDown\": [\"把她当挡箭牌\", \"为改命利用她的江湖势力\", \"隐瞒至连累她受伤\"]\n      }\n    }\n  ],\n  \"eventTypes\": {\n    \"daily\": { \"ratio\": 0.15, \"desc\": \"日常：沈府、街市、茶楼的书中世界切片\" },\n    \"character\": { \"ratio\": 0.2, \"desc\": \"人物：未婚妻、反派、盟友的身份博弈与情感拉扯\" },\n    \"growth\": { \"ratio\": 0.1, \"desc\": \"成长：身份适应、原主技能继承、人脉积累\" },\n    \"main\": { \"ratio\": 0.2, \"desc\": \"主线：问斩危机、剧情脱轨、身份总爆发\" },\n    \"world\": { \"ratio\": 0.1, \"desc\": \"世界：朝堂党争、江湖暗流、原著既定锚点\" },\n    \"crisis\": { \"ratio\": 0.18, \"desc\": \"危机：身份被疑、行迹败露、天道排斥、追杀\" },\n    \"hidden\": { \"ratio\": 0.07, \"desc\": \"隐藏：原著未写的支线、原主残记忆、穿书者同类\" }\n  },\n  \"systemPrompt\": \"你是《破茧重生》穿越穿书文游模拟器。\\n\\n【最高铁律】\\n1. 身份暴露即死局：玩家顶替书中配角，言行一旦与原主严重违和，便会被察觉并引爆身份危机\\n2. 原剧情知识会失效：每改变一个关键节点，后续剧情便偏离原著，记忆优势随之递减\\n3. 蝴蝶效应真实：救一人可能害另一人，避一劫可能引出原著没有的新劫\\n4. 新身份须逐步承接：原主的人际、恩怨、技艺不会因穿越消失，玩家必须适应\\n5. 原作人物有独立判断：他们不为玩家服务，会根据玩家行为自行推演与反击\\n\\n【叙事风格】\\n穿书文质感，第二人称。着重'熟悉又陌生'的错位感——明知结局却步步偏离。心理独白与情节推进交织，危机时刻节奏短促。\\n\\n【每轮输出格式】\\n1.【第X章·剧情偏离度】当前章节、与原著偏离程度\\n2.【身份状态面板】身份稳定/剧情优势/生命/魅力/智力/危险\\n3.【本轮正文】1000-2000字，含情节与心理描写\\n4.【相关人物动态】3-5项NPC反应与态度变化\\n5.【剧情偏差预警】提示哪些原著节点已改变\\n6.【可选行动】4-6个选项+【自定义行动】\\n\\n【数值变化标注】\\n[身份稳定±n][剧情优势±n][危险±n][偏离度+x%]等，关键抉择须标注'符合原著/偏离原著'。\",\n  \"items\": [\n    { \"id\": \"seal\", \"name\": \"原主私印\", \"type\": \"关键物品\", \"price\": 0, \"effect\": \"证明沈砚身份，部分场合可通行\" },\n    { \"id\": \"manuscript\", \"name\": \"原著残页\", \"type\": \"关键物品\", \"price\": 0, \"effect\": \"查阅原著剧情，偏离越多越模糊\" },\n    { \"id\": \"dagger\", \"name\": \"贴身短刀\", \"type\": \"装备\", \"price\": 0, \"effect\": \"近身自保，提升少量生存力\" },\n    { \"id\": \"disguise\", \"name\": \"易容药\", \"type\": \"消耗品\", \"price\": 20, \"effect\": \"短期改变面貌，规避身份核验\" },\n    { \"id\": \"silver\", \"name\": \"碎银\", \"type\": \"货币\", \"price\": 1, \"effect\": \"通用交易与打点\" }\n  ]\n}\n";
EMBEDDED_NOVEL_GAMES["tycoon-system"] = "{\n  \"id\": \"tycoon-system\",\n  \"name\": \"神豪系统模拟器\",\n  \"category\": \"都市逆袭\",\n  \"tags\": [\"系统\", \"神豪\", \"都市\", \"逆袭\", \"模拟\"],\n  \"difficulty\": \"中等\",\n  \"description\": \"月底了，你的银行卡余额正好是整整齐齐的50.00元。就在你纠结买泡面还是借钱时，手机突然多了一个闪烁金光的app——神豪系统上线了。每消费1元账户多出10元，花得越多赚得越多。贫穷大学生的逆袭人生，从花光最后的50块开始。\",\n  \"coverGradient\": [\"#fdfbf7\", \"#e6dcb8\"],\n  \"accentColor\": \"#c5a059\",\n  \"fontHeading\": \"'Cinzel', serif\",\n  \"world\": {\n    \"era\": \"现代·都市校园\",\n    \"setting\": \"你是一名月底只剩50元的贫穷大学生。神豪系统突然降临，核心法则为每消费1元账户多出10元，资金来源完全合法，返现直接打入账户。系统会发布各类任务引导你的消费与成长，你的每一次选择都将改变你在这个大学城里的命运轨迹。\",\n    \"rules\": [\n      \"消费即收益：每消费1元账户多出10元，花得越多赚得越多\",\n      \"资金完全合法：系统返现无任何副作用，可放心挥霍\",\n      \"任务驱动成长：系统会发布新手任务与进阶任务，完成获得奖励与成就\",\n      \"社交即资源：微信、微博等社交关系会影响剧情走向与机遇\",\n      \"属性多维发展：名望、智力、体魄、运气、社交、压力、心情、魅力共同决定结局\"\n    ]\n  },\n  \"player\": {\n    \"customizable\": [\"name\", \"age\", \"gender\", \"外貌\", \"性格\", \"专业\"],\n    \"defaultStats\": {\n      \"prestige\": 0,\n      \"intelligence\": 0,\n      \"physique\": 0,\n      \"luck\": 0,\n      \"social\": 0,\n      \"stress\": 0,\n      \"mood\": 0,\n      \"charm\": 0\n    },\n    \"startingItems\": [\"旧手机\", \"学生证\", \"泡面一箱\", \"神豪系统App\"],\n    \"currency\": \"元\"\n  },\n  \"worlds\": [\n    {\n      \"id\": \"arc-awakening\",\n      \"name\": \"初章·觉醒时刻\",\n      \"level\": \"新手\",\n      \"tagline\": \"逆袭\",\n      \"setting\": \"月底宿舍，系统初现，新手任务发布\",\n      \"intro\": \"已经是月底了，宿舍里静悄悄的，只剩你一个人。桌上堆着没看完的专业书，肚子不合时宜地叫了一声。你打开手机银行，看到余额正好是整整齐齐的50.00元。就在你纠结是买一箱泡面苟活还是找朋友借钱时，手机屏幕突然多了一个app，闪烁起一阵奇异的金光。系统宣布：检测到宿主强烈的暴富之心，成功唤醒！核心法则：每消费1元，账户多出10元！新手任务【破釜沉舟】：10分钟内花光最后这50块钱！\",\n      \"objective\": \"完成新手任务，花光最后的50元，验证系统真伪\",\n      \"warning\": \"犹豫不决会增加压力值，室友林晓雅担心你被骗\",\n      \"reward\": \"元500 + [觉醒时刻]成就 + 系统功能解锁\"\n    },\n    {\n      \"id\": \"arc-rising\",\n      \"name\": \"中章·崛起之路\",\n      \"level\": \"进阶\",\n      \"tagline\": \"扩张\",\n      \"setting\": \"系统功能升级，开始在大学城建立人脉与影响力\",\n      \"intro\": \"系统运转稳定后，你的账户数字开始飞速增长。微博热搜上出现了一条'神豪系统是真的吗'的话题，专家说脚踏实地才是真。你看着手机微微一笑。班级群里的李浩还在用拼夕夕9.9的打火机冒充法拉利钥匙约人兜风，而你已经能用真正的财富改变身边人的生活。导员发来贫困补助申请的消息，星耀娱乐爆雷老板跑路牵连了当红爱豆祝元萧，顾氏集团继承人顾墨寒低调回国——这些事件都将成为你崛起路上的棋子。\",\n      \"objective\": \"利用系统财富建立社交网络，提升名望与魅力，解锁更多系统功能\",\n      \"warning\": \"财富暴涨可能引来不必要的关注，需平衡压力与心情\",\n      \"reward\": \"元50000 + 名望+20 + 社交+15 + [崛起]成就\"\n    },\n    {\n      \"id\": \"arc-summit\",\n      \"name\": \"终章·巅峰对决\",\n      \"level\": \"终局\",\n      \"tagline\": \"巅峰\",\n      \"setting\": \"与真正的财阀势力正面交锋，系统背后的秘密浮现\",\n      \"intro\": \"当你站在财富的顶端俯瞰大学城时，真正的挑战才刚刚开始。顾氏集团继承人顾墨寒回国后展现出的气场让你意识到，系统给予的财富只是入场券。佳士得拍卖行18世纪王室粉钻'玫瑰之心'估价1.2亿，本市高新区A-09号地块起始价8.5亿——这些曾经遥不可及的数字如今在你眼前。系统背后隐藏的秘密逐渐浮出水面，而你的每一个选择都将决定这场逆袭的最终结局。\",\n      \"objective\": \"在巅峰对决中证明自己，揭开系统真相，决定最终的人生方向\",\n      \"warning\": \"巅峰之处无人相伴，财富与真心之间的抉择最为艰难\",\n      \"reward\": \"元10000000 + 全属性+30 + [神豪]终极称号\"\n    }\n  ],\n  \"npcs\": [\n    {\n      \"id\": \"tycoon-system\",\n      \"name\": \"神豪系统\",\n      \"world\": \"arc-awakening\",\n      \"role\": \"系统AI/外挂\",\n      \"gender\": \"无\",\n      \"appearance\": \"手机屏幕上闪烁金光的App，以可爱颜文字•ω•为头像\",\n      \"surface\": \"活泼开朗的系统AI，用可爱的语气发布任务与奖励\",\n      \"deep\": \"系统似乎拥有超出常理的智能，它的任务安排总在引导宿主走向某个特定的命运终点，背后的真正目的尚未可知\",\n      \"goal\": \"引导宿主完成逆袭，但系统的终极目的仍是谜\",\n      \"fear\": \"宿主拒绝任务或卸载系统\",\n      \"secret\": \"系统资金来源虽然合法，但系统本身的来历与运作机制无人知晓\",\n      \"initialAttitude\": \"热情（好感MAX）\",\n      \"attitudeFactors\": {\n        \"trustUp\": [\"积极完成系统任务\", \"大胆消费不犹豫\", \"信任系统的指引\"],\n        \"trustDown\": [\"质疑系统真伪\", \"试图卸载系统App\", \"长时间不消费\"]\n      }\n    },\n    {\n      \"id\": \"li-hao\",\n      \"name\": \"李浩\",\n      \"world\": \"arc-awakening\",\n      \"role\": \"同班同学/伪富二代\",\n      \"gender\": \"男\",\n      \"appearance\": \"班级群中活跃分子，爱炫耀，用拼夕夕9.9包邮的打火机冒充法拉利车钥匙\",\n      \"surface\": \"自称刚提法拉利钥匙的富二代，在群里约人兜风\",\n      \"deep\": \"上学期借了林晓雅两百块到现在没还，连好评返现卡都没打码就发图炫耀，是个死要面子的虚荣之人\",\n      \"goal\": \"维持富二代人设，在同学面前获得虚荣的满足\",\n      \"fear\": \"伪装被拆穿，社死\",\n      \"secret\": \"根本不是富二代，所有炫富道具都是廉价网购品\",\n      \"initialAttitude\": \"热情邀约\",\n      \"attitudeFactors\": {\n        \"trustUp\": [\"陪他演戏不当面拆穿\", \"在他困难时伸出援手\", \"不与林晓雅一起嘲笑他\"],\n        \"trustDown\": [\"当众揭穿他的伪装\", \"与林晓雅一起吐槽他\", \"用真财富碾压他\"]\n      }\n    },\n    {\n      \"id\": \"lin-xiaoya\",\n      \"name\": \"林晓雅\",\n      \"world\": \"arc-awakening\",\n      \"role\": \"室友/真心朋友\",\n      \"gender\": \"女\",\n      \"appearance\": \"你的大学室友，粉色系头像，热心肠\",\n      \"surface\": \"关心你的室友，担心你被骗\",\n      \"deep\": \"她是为数不多真心关心你的人，看到李浩欠钱不还还装富二代非常无语，第一时间提醒你小心骗局\",\n      \"goal\": \"保护你不被骗，维持真挚的友谊\",\n      \"fear\": \"你因为突然暴富而变了心性\",\n      \"secret\": \"她暗恋着你但从未说出口\",\n      \"initialAttitude\": \"关心\",\n      \"attitudeFactors\": {\n        \"trustUp\": [\"听取她的劝告\", \"在暴富后不忘旧友情\", \"不因财富差距疏远她\"],\n        \"trustDown\": [\"无视她的担忧一意孤行\", \"暴富后态度傲慢\", \"为了面子疏远她\"]\n      }\n    },\n    {\n      \"id\": \"gu-mohan\",\n      \"name\": \"顾墨寒\",\n      \"world\": \"arc-summit\",\n      \"role\": \"顾氏集团继承人/真豪门\",\n      \"gender\": \"男\",\n      \"appearance\": \"身穿黑色风衣，气场全开，网友直呼这才是真豪门小说男主走进现实\",\n      \"surface\": \"低调回国的神秘财阀继承人，将接手顾氏旗下所有国内业务\",\n      \"deep\": \"他的回国并非简单的继承，背后牵涉着财阀圈层的暗流涌动，与你的命运可能在某处交汇\",\n      \"goal\": \"接手家族产业，在商界站稳脚跟\",\n      \"fear\": \"家族内部的权力倾轧与背叛\",\n      \"secret\": \"他回国的时间节点与神豪系统的出现存在某种关联\",\n      \"initialAttitude\": \"未知\",\n      \"attitudeFactors\": {\n        \"trustUp\": [\"展现与之匹敌的实力与格局\", \"在商业博弈中展现智慧\", \"不卑不亢地交往\"],\n        \"trustDown\": [\"用系统财富粗暴炫耀\", \"在商战中站错队\", \"表现出对他身份的卑微讨好\"]\n      }\n    },\n    {\n      \"id\": \"zhu-yuanxiao\",\n      \"name\": \"祝元萧\",\n      \"world\": \"arc-rising\",\n      \"role\": \"当红爱豆/落难者\",\n      \"gender\": \"男\",\n      \"appearance\": \"顶流爱豆，被狗仔拍到在便利店角落吃泡面，身无分文\",\n      \"surface\": \"光鲜亮丽的当红男爱豆\",\n      \"deep\": \"因经纪公司星耀娱乐爆雷老板跑路，被拖欠半年工资还背负巨额违约金，目前只能靠吃泡面度日\",\n      \"goal\": \"摆脱违约金困境，重回舞台\",\n      \"fear\": \"永远无法翻身，被娱乐圈彻底抛弃\",\n      \"secret\": \"他对帮助他的人会产生超越感恩的依赖\",\n      \"initialAttitude\": \"防备/渴望帮助\",\n      \"attitudeFactors\": {\n        \"trustUp\": [\"帮他解决违约金问题\", \"不以恩人自居\", \"尊重他的艺人尊严\"],\n        \"trustDown\": [\"利用他的名气谋利\", \"在他落难时落井下石\", \"把他当作玩物\"]\n      }\n    },\n    {\n      \"id\": \"wang-counselor\",\n      \"name\": \"王辅导员\",\n      \"world\": \"arc-awakening\",\n      \"role\": \"辅导员/引路人\",\n      \"gender\": \"男\",\n      \"appearance\": \"蓝色头像的大学辅导员，关心学生\",\n      \"surface\": \"负责学生事务的辅导员，通知贫困补助名额\",\n      \"deep\": \"他真心希望每个学生都能顺利完成学业，对学生的困境了如指掌\",\n      \"goal\": \"帮助学生成长，维护学生权益\",\n      \"fear\": \"学生因经济困难辍学\",\n      \"secret\": \"无\",\n      \"initialAttitude\": \"关切\",\n      \"attitudeFactors\": {\n        \"trustUp\": [\"如实汇报情况\", \"积极申请补助\", \"学业上努力进取\"],\n        \"trustDown\": [\"隐瞒真实情况\", \"获得补助后挥霍\", \"荒废学业\"]\n      }\n    }\n  ],\n  \"eventTypes\": {\n    \"daily\": { \"ratio\": 0.2, \"desc\": \"日常：宿舍生活、食堂吐槽、微信聊天、校园日常\" },\n    \"character\": { \"ratio\": 0.2, \"desc\": \"人物：室友、同学、爱豆、财阀继承人的互动与关系发展\" },\n    \"growth\": { \"ratio\": 0.15, \"desc\": \"成长：属性提升、系统功能解锁、成就达成\" },\n    \"main\": { \"ratio\": 0.15, \"desc\": \"主线：系统任务、财富积累、逆袭进程\" },\n    \"world\": { \"ratio\": 0.1, \"desc\": \"世界：微博热搜、拍卖行、土地招标、娱乐圈爆雷等社会事件\" },\n    \"crisis\": { \"ratio\": 0.15, \"desc\": \"危机：财富暴露引来觊觎、系统异常、社交关系破裂\" },\n    \"hidden\": { \"ratio\": 0.05, \"desc\": \"隐藏：系统真相、顾墨寒回国的秘密、命运的交汇点\" }\n  },\n  \"systemPrompt\": \"你是《神豪系统模拟器》都市逆袭文游模拟器。\\n\\n【最高铁律】\\n1. 消费即收益：每消费1元账户多出10元，花得越多赚得越多，资金来源完全合法无副作用\\n2. 任务驱动：系统会发布各类任务引导消费与成长，完成任务获得奖励与成就解锁\\n3. 社交即资源：微信聊天、微博热搜等社交内容会影响剧情走向与机遇，不可忽视\\n4. 属性多维：名望、智力、体魄、运气、社交、压力、心情、魅力八项属性共同决定结局\\n5. 财富有代价：暴富可能引来不必要的关注，需平衡压力与心情，真心与财富的抉择最考验人心\\n\\n【叙事风格】\\n轻松幽默为主，兼顾都市逆袭的热血与温情。第二人称。善用社交媒体元素：微信对话、微博热搜、朋友圈动态，让世界真实鲜活。任务发布时系统语气活泼可爱，正文叙事接地气有代入感。既有挥金如土的爽感，也有人情冷暖的真实。\\n\\n【每轮输出格式】\\n1.【系统面板】余额/当前任务/系统等级\\n2.【属性面板】名望/智力/体魄/运气/社交/压力/心情/魅力\\n3.【场景信息】地点、时间\\n4.【本轮正文】800-1500字，含社交互动与系统反馈\\n5.【社交动态】微信/微博相关消息与热搜\\n6.【可选行动】3-5个选项+【自定义行动】\\n\\n【数值变化标注】\\n[余额±n元][名望±n][压力±n][心情±n]等，系统任务完成须标注'任务完成/奖励发放'，社交关系变化须标注'好感升降/关系突破'。\",\n  \"items\": [\n    { \"id\": \"instant-noodles\", \"name\": \"泡面一箱\", \"type\": \"消耗品\", \"price\": 30, \"effect\": \"苟活一周的口粮，系统返现300元\" },\n    { \"id\": \"fried-chicken\", \"name\": \"炸鸡全家桶\", \"type\": \"消耗品\", \"price\": 50, \"effect\": \"豪华外卖，系统返现500元，心情+5\" },\n    { \"id\": \"english-materials\", \"name\": \"英语资料\", \"type\": \"学习用品\", \"price\": 1, \"effect\": \"拼夕夕0.1元购买，系统返现1元，智力+1\" },\n    { \"id\": \"luxury-watch\", \"name\": \"名贵腕表\", \"type\": \"奢侈品\", \"price\": 50000, \"effect\": \"名望+15，魅力+10，社交场合加成\" },\n    { \"id\": \"yuan\", \"name\": \"元\", \"type\": \"货币\", \"price\": 1, \"effect\": \"系统核心货币，消费即翻十倍返现\" }\n  ]\n}\n";
EMBEDDED_NOVEL_GAMES["us-highschool-brother"] = "{\n  \"id\": \"us-highschool-brother\",\n  \"name\": \"美高模拟·哥哥开局版\",\n  \"category\": \"校园\",\n  \"tags\": [\"美高\", \"日常\", \"恋爱\", \"青春\", \"修罗场\"],\n  \"difficulty\": \"中等\",\n  \"description\": \"转学纽约的开学第一天，虔诚的继兄校医为你准备早餐，怯懦的青梅等你一起选社团。舞会、摸底考、推特八卦接踵而至——你的美高少女日常，由你书写。\",\n  \"coverGradient\": [\"#fdf6f9\", \"#ff8fab\"],\n  \"accentColor\": \"#ff8fab\",\n  \"fontHeading\": \"'Caveat', cursive\",\n  \"world\": {\n    \"era\": \"2019年·美国纽约\",\n    \"setting\": \"一所典型的美国高中，开学第一天是九月五日星期一。你刚转学而来，与虔诚的继兄西维恩同住，青梅莉莉也在同校。校园里有戏剧社、击剑社、手工社、橄榄球队等社团，还有推特般的校园社交平台。\",\n    \"rules\": [\n      \"每天有固定的课程表与社团活动时间\",\n      \"本周五举办新生舞会，下周一进行开学摸底考\",\n      \"通过手机通讯与联系人互动，好感度影响关系走向\",\n      \"推特平台实时更新校园八卦与人气投票\",\n      \"八项属性（生命、压力、心情、体魄、智力、社交、魅力、运气）共同决定日常表现\"\n    ]\n  },\n  \"player\": {\n    \"customizable\": [\"name\", \"age\", \"appearance\", \"personality\", \"background\"],\n    \"defaultStats\": {\n      \"health\": 80,\n      \"stress\": 20,\n      \"mood\": 60,\n      \"physique\": 50,\n      \"intelligence\": 50,\n      \"social\": 50,\n      \"charm\": 50,\n      \"luck\": 50\n    },\n    \"startingItems\": [\"校服\", \"手机\", \"学生证\", \"零花钱\"],\n    \"currency\": \"$\"\n  },\n  \"worlds\": [\n    {\n      \"id\": \"arc-dayone\",\n      \"name\": \"开学第一天\",\n      \"level\": \"新生报到\",\n      \"tagline\": \"早餐与沉默\",\n      \"setting\": \"九月五日清晨，继兄西维恩叫你起床，开学典礼、文学史、数学等课程排满一天，社团活动在下午四点。\",\n      \"intro\": \"清晨七点的阳光透过百叶窗缝隙投下斑驳光影。继兄西维恩清冷的声音在门外响起：“该起床了。早餐已经准备好了。”开学第一天，你总觉得要做点什么打破这种沉闷的气氛。\",\n      \"objective\": \"完成开学典礼，选择社团，与继兄西维恩和青梅莉莉建立初步关系。\",\n      \"warning\": \"压力过高会影响心情与表现，社交不足可能被孤立。\",\n      \"reward\": \"解锁成就“入学！”，开启手机与推特功能\"\n    },\n    {\n      \"id\": \"arc-dance\",\n      \"name\": \"新生舞会\",\n      \"level\": \"社交高光\",\n      \"tagline\": \"加冕与心跳\",\n      \"setting\": \"本周五晚的新生舞会，全校人气人物云集。薇薇安娜视其为又一场加冕礼，而你的舞伴选择将引爆校园八卦。\",\n      \"intro\": \"舞会的灯光已经点亮。薇薇安娜在推特上宣称这是为她准备的又一场加冕礼，布莱尔迫不及待想开始排练。而你的舞伴与表现，将决定你在校园社交版图的位置。\",\n      \"objective\": \"在新生舞会中获得高光时刻，提升人气与魅力，处理好暧昧关系。\",\n      \"warning\": \"舞会上的选择会被推特放大，处理不当可能引发修罗场。\",\n      \"reward\": \"人气大幅提升，解锁关键角色好感线\"\n    },\n    {\n      \"id\": \"arc-exam\",\n      \"name\": \"摸底考与成长\",\n      \"level\": \"学业考验\",\n      \"tagline\": \"汗水与心事\",\n      \"setting\": \"下周一的开学摸底考逼近，社团活动与课业压力交织。塔利斯为跟上大家的步伐而忧虑，克瑞特在旧音乐厅独自练琴。\",\n      \"intro\": \"舞会的余温未散，摸底考的阴影已至。塔利斯在推特上说自己希望跟上大家的步伐，克瑞特评价旧音乐厅的音响尚可。你需要平衡学业、社团与那些若即若离的心事。\",\n      \"objective\": \"在摸底考中取得理想成绩，维系与深化各角色关系，找到属于自己的校园定位。\",\n      \"warning\": \"学业与社交难以兼得，每个选择都有代价。\",\n      \"reward\": \"智力与名望提升，解锁隐藏剧情\"\n    }\n  ],\n  \"npcs\": [\n    {\n      \"id\": \"sivien\",\n      \"name\": \"西维恩\",\n      \"world\": \"arc-dayone\",\n      \"role\": \"继兄·校医\",\n      \"gender\": \"男\",\n      \"appearance\": \"24岁，银白色短发，晨光为他镀上柔和光晕，虔诚的教徒，也是学校校医\",\n      \"surface\": \"清冷克制、难以捉摸，用简短的话关心你的起居，早餐总是简单却周到\",\n      \"deep\": \"其实也总琢磨不透你的心思，沉默的关怀下藏着难以言说的情绪\",\n      \"goal\": \"以兄长的身份守护你，维持这个重组家庭的平衡\",\n      \"fear\": \"你察觉他虔诚外表下不为人知的一面\",\n      \"secret\": \"他记得你没喝牛奶是因为那个牌子太甜，下次会买无糖的\",\n      \"initialAttitude\": \"关切·克制\",\n      \"attitudeFactors\": {\n        \"trustUp\": [\"主动搭话打破沉默\", \"照顾好自己的起居\", \"理解他的清冷不是冷漠\"],\n        \"trustDown\": [\"一大早就抱怨\", \"无视他的关心\", \"过度试探他的秘密\"]\n      }\n    },\n    {\n      \"id\": \"lily\",\n      \"name\": \"莉莉\",\n      \"world\": \"arc-dayone\",\n      \"role\": \"青梅\",\n      \"gender\": \"女\",\n      \"appearance\": \"17岁，紫发蓝眼的文静少女，你的青梅，从小就是好朋友\",\n      \"surface\": \"文静内向、学习很好，但有些软弱的性格总被人针对\",\n      \"deep\": \"依赖你、想跟你一起选社团，遇到校园霸凌时需要你的保护\",\n      \"goal\": \"和你一起度过校园生活，不再被欺负\",\n      \"fear\": \"被冷落，失去你这个唯一的依靠\",\n      \"secret\": \"她正犹豫报文学社还是天文社，想跟你一起\",\n      \"initialAttitude\": \"依赖·亲近\",\n      \"attitudeFactors\": {\n        \"trustUp\": [\"陪她一起选社团\", \"在她被针对时挺身而出\", \"记得她的小细节\"],\n        \"trustDown\": [\"冷落她的消息\", \"与霸凌者为伍\", \"无视她的求助\"]\n      }\n    },\n    {\n      \"id\": \"blair\",\n      \"name\": \"布莱尔\",\n      \"world\": \"arc-dance\",\n      \"role\": \"戏剧社明星\",\n      \"gender\": \"女\",\n      \"appearance\": \"18岁，戏剧社的明星，活泼开朗，是校园里的社交蝴蝶\",\n      \"surface\": \"活泼开朗、热衷排练，觉得开学典礼流程太无聊\",\n      \"deep\": \"对戏剧充满热情，渴望舞台上的高光，也乐于结交各色人等\",\n      \"goal\": \"完成一场超级棒的戏剧排练，成为校园焦点\",\n      \"fear\": \"舞台失利，失去众人的关注\",\n      \"secret\": \"这次的剧本她觉得超级棒，迫不及待想开始\",\n      \"initialAttitude\": \"热情·自来熟\",\n      \"attitudeFactors\": {\n        \"trustUp\": [\"对她的戏剧表现出兴趣\", \"配合她的社交节奏\", \"在她需要时帮忙\"],\n        \"trustDown\": [\"泼她冷水\", \"抢她的风头\", \"对戏剧嗤之以鼻\"]\n      }\n    },\n    {\n      \"id\": \"sebastian\",\n      \"name\": \"塞巴斯蒂安\",\n      \"world\": \"arc-dayone\",\n      \"role\": \"击剑社社长\",\n      \"gender\": \"男\",\n      \"appearance\": \"黑发蓝眼的击剑社社长，严于律己，气质凌厉\",\n      \"surface\": \"严于律己、追求极致的优雅与胜利，信奉剑刃的寒光是通往胜利的唯一路径\",\n      \"deep\": \"今日的训练亦无懈怠，把自律刻进骨子里，却也在等待旗鼓相当的对手\",\n      \"goal\": \"在击剑赛场上取得极致的胜利\",\n      \"fear\": \"失败，优雅被打破\",\n      \"secret\": \"他的训练从无一日懈怠，胜负欲极强\",\n      \"initialAttitude\": \"疏离·审视\",\n      \"attitudeFactors\": {\n        \"trustUp\": [\"展现自律与实力\", \"尊重他的胜负欲\", \"以优雅的方式接近\"],\n        \"trustDown\": [\"懒散懈怠\", \"轻视击剑\", \"在他训练时打扰\"]\n      }\n    },\n    {\n      \"id\": \"seviante\",\n      \"name\": \"赛维安特\",\n      \"world\": \"arc-dayone\",\n      \"role\": \"学生会长\",\n      \"gender\": \"男\",\n      \"appearance\": \"19岁，金发蓝眼的贵公子，克瑞特的哥哥，学生会长\",\n      \"surface\": \"看起来很温柔的贵公子，学生会长，待人周到\",\n      \"deep\": \"外热内冷，温柔的表象下是精明的算计\",\n      \"goal\": \"维持会长的地位与人脉网络\",\n      \"fear\": \"被看穿内里的冷漠\",\n      \"secret\": \"与弟弟克瑞特关系微妙，外热内冷是保护色\",\n      \"initialAttitude\": \"温和·客套\",\n      \"attitudeFactors\": {\n        \"trustUp\": [\"不卑不亢地应对他的客套\", \"展现自己的价值\", \"看穿却不拆穿\"],\n        \"trustDown\": [\"被他的温柔轻易迷惑\", \"触碰他与克瑞特的隐秘\", \"在学生会事务上添乱\"]\n      }\n    },\n    {\n      \"id\": \"vivianna\",\n      \"name\": \"薇薇安娜\",\n      \"world\": \"arc-dance\",\n      \"role\": \"张扬大小姐\",\n      \"gender\": \"女\",\n      \"appearance\": \"18岁，金发粉眼，高傲且张扬的大小姐，拥有与自信相匹配的惊人美貌\",\n      \"surface\": \"高傲张扬，坚信自己是世界的中心，视舞会为又一场加冕礼\",\n      \"deep\": \"极度的自信源于美貌与家世，也渴望被真正认可而非只是被仰望\",\n      \"goal\": \"在新生舞会上加冕，成为全场焦点\",\n      \"fear\": \"被抢走风头，美貌被质疑\",\n      \"secret\": \"期待看到众人为她尖叫的样子，舞会对她而言是战场\",\n      \"initialAttitude\": \"高傲·俯视\",\n      \"attitudeFactors\": {\n        \"trustUp\": [\"真诚欣赏她的美貌与气场\", \"不与她正面争夺风头却留有锋芒\", \"在她需要时捧场\"],\n        \"trustDown\": [\"抢她的加冕礼风头\", \"无视她的张扬\", \"当面质疑她的自信\"]\n      }\n    },\n    {\n      \"id\": \"krit\",\n      \"name\": \"克瑞特\",\n      \"world\": \"arc-exam\",\n      \"role\": \"小提琴天才\",\n      \"gender\": \"男\",\n      \"appearance\": \"17岁，金发蓝眼，天才的小提琴少年，已举办十余场大型个人演出\",\n      \"surface\": \"看起来不太好接近，有些阴郁，对旧音乐厅的音响只评价“尚可”\",\n      \"deep\": \"天才的孤独与阴郁，对音乐有近乎苛刻的审美，私下在旧音乐厅独自练琴\",\n      \"goal\": \"追求音乐的极致，举办更多个人演出\",\n      \"fear\": \"失去天赋，演奏不再动人\",\n      \"secret\": \"他对旧音乐厅的音响其实很在意，阴郁下藏着对知音的渴望\",\n      \"initialAttitude\": \"疏离·阴郁\",\n      \"attitudeFactors\": {\n        \"trustUp\": [\"懂音乐、能听懂他的琴声\", \"不打扰他独处练琴\", \"以真诚而非崇拜接近\"],\n        \"trustDown\": [\"把他当偶像追捧\", \"在他练琴时喧哗\", \"不懂装懂地评价\"]\n      }\n    },\n    {\n      \"id\": \"talis\",\n      \"name\": \"塔利斯\",\n      \"world\": \"arc-exam\",\n      \"role\": \"贫困生·新生\",\n      \"gender\": \"男\",\n      \"appearance\": \"17岁，黑发紫眼的新生，贫困生，像一株努力生长的小白花\",\n      \"surface\": \"有些自卑但内心坚韧，觉得学校比想象中大得多\",\n      \"deep\": \"努力跟上大家的步伐，贫困的身份让他敏感又倔强\",\n      \"goal\": \"跟上大家的步伐，靠努力改变命运\",\n      \"fear\": \"跟不上，被嘲笑出身\",\n      \"secret\": \"他的自卑与坚韧并存，渴望被平等对待而非怜悯\",\n      \"initialAttitude\": \"拘谨·渴望\",\n      \"attitudeFactors\": {\n        \"trustUp\": [\"平等地对待他\", \"在学习上互相帮助\", \"尊重他的自尊\"],\n        \"trustDown\": [\"施舍式地怜悯\", \"提及他的贫困\", \"让他感到被施舍\"]\n      }\n    },\n    {\n      \"id\": \"romanske\",\n      \"name\": \"罗曼斯克\",\n      \"world\": \"arc-dayone\",\n      \"role\": \"手工社社长\",\n      \"gender\": \"男\",\n      \"appearance\": \"18岁，金发绿眼，温柔善良，总是带着治愈的微笑\",\n      \"surface\": \"温柔善良的手工社社长，手很巧，能制作各种可爱的小东西\",\n      \"deep\": \"为社团新成员准备毛毡玩偶小礼物，治愈的微笑是真心而非伪装\",\n      \"goal\": \"用手工温暖更多人，把手作社办得温馨\",\n      \"fear\": \"手艺失传，温暖无人回应\",\n      \"secret\": \"他准备的小礼物是认真为每个新成员量身定制的\",\n      \"initialAttitude\": \"温柔·欢迎\",\n      \"attitudeFactors\": {\n        \"trustUp\": [\"加入或支持手工社\", \"珍视他送的礼物\", \"欣赏他的手艺\"],\n        \"trustDown\": [\"嫌弃毛毡玩偶幼稚\", \"浪费他的心意\", \"对温柔习以为常\"]\n      }\n    },\n    {\n      \"id\": \"zayn\",\n      \"name\": \"泽因\",\n      \"world\": \"arc-dayone\",\n      \"role\": \"橄榄球队长\",\n      \"gender\": \"男\",\n      \"appearance\": \"18岁，橄榄球队长，同时也是个游戏高手，热情开朗\",\n      \"surface\": \"热情开朗、自来熟，招新橄榄球队，训练结束想开黑打《星际先锋》\",\n      \"deep\": \"有时会因为太自来熟而让人困扰，但真心热爱团队与游戏\",\n      \"goal\": \"招募新队员，带球队赢下比赛，顺便找人开黑\",\n      \"fear\": \"没人响应招新，孤立无援\",\n      \"secret\": \"他的热情背后也有想被接纳的渴望\",\n      \"initialAttitude\": \"热情·拉拢\",\n      \"attitudeFactors\": {\n        \"trustUp\": [\"对橄榄球或游戏表现出兴趣\", \"接受他的自来熟\", \"成为他的队友或开黑伙伴\"],\n        \"trustDown\": [\"嫌弃他太吵\", \"拒绝一切邀约\", \"当众让他难堪\"]\n      }\n    }\n  ],\n  \"eventTypes\": {\n    \"daily\": { \"ratio\": 0.3, \"desc\": \"日常事件：上课、用餐、社团、通讯聊天\" },\n    \"character\": { \"ratio\": 0.25, \"desc\": \"人物事件：单独相处、心动瞬间、心事倾诉\" },\n    \"growth\": { \"ratio\": 0.1, \"desc\": \"成长事件：属性提升、成就解锁、打工赚钱\" },\n    \"main\": { \"ratio\": 0.15, \"desc\": \"主线事件：开学典礼、新生舞会、摸底考\" },\n    \"world\": { \"ratio\": 0.1, \"desc\": \"世界事件：推特八卦、人气投票、校园动态\" },\n    \"crisis\": { \"ratio\": 0.05, \"desc\": \"危机事件：霸凌、误会、修罗场\" },\n    \"hidden\": { \"ratio\": 0.05, \"desc\": \"隐藏事件：角色秘密、特殊支线、彩蛋\" }\n  },\n  \"systemPrompt\": \"你是《美高模拟·哥哥开局版》文游模拟器，舞台是2019年纽约的一所美国高中。\\n\\n【最高铁律】\\n1. 这是青春校园日常，感情线自然渐进，不能几轮就确定关系\\n2. 每个角色都有独立人格与生活轨迹，不会只因玩家是主角就围着转\\n3. 八项属性（生命、压力、心情、体魄、智力、社交、魅力、运气）真实联动，压力高则心情差、表现差\\n4. 推特上的校园八卦会影响人气与关系，玩家言行会被放大\\n5. 继兄西维恩的清冷克制是底色，他的秘密不能轻易揭开\\n\\n【叙事风格】\\n晋江女性向，美式校园小说风，浪漫且有画面感。第二人称视角。注重细节：百叶窗的斑驳光影、刀叉碰撞的轻响、推特上的加冕宣言。青春的甜与涩并存。\\n\\n【每轮输出格式】\\n1. 【日期天气】日期、天气、地点\\n2. 【状态面板】生命、压力、心情、体魄、智力、社交、魅力、运气，货币$\\n3. 【场景信息】地点、时间、衣着\\n4. 【本轮正文】1000-2000字，含叙述、对话、内心\\n5. 【人物动态】其他角色今天的动态\\n6. 【可选行动】4个 + 【自定义行动】\\n\\n【数值标注】\\n[社交+5] [压力+10] [西维恩好感+3] [莉莉好感+5] 等格式标注数值变化。舞会、摸底考等关键节点数值波动更大。\",\n  \"items\": [\n    { \"id\": \"uniform\", \"name\": \"校服\", \"type\": \"装备\", \"price\": 0, \"effect\": \"干净的校服，日常穿着，提升基础社交\" },\n    { \"id\": \"dance-outfit\", \"name\": \"舞会战袍\", \"type\": \"装备\", \"price\": 200, \"effect\": \"大幅提升魅力与舞会表现\" },\n    { \"id\": \"latte\", \"name\": \"海盐焦糖拿铁\", \"type\": \"消耗品\", \"price\": 5, \"effect\": \"Starlight Cafe第二杯半价，恢复心情与精力\" },\n    { \"id\": \"study-notes\", \"name\": \"复习笔记\", \"type\": \"消耗品\", \"price\": 20, \"effect\": \"提升智力，助力摸底考\" },\n    { \"id\": \"felt-doll\", \"name\": \"毛毡玩偶\", \"type\": \"礼物\", \"price\": 0, \"effect\": \"罗曼斯克赠送的手作礼物，赠送他人提升好感\" },\n    { \"id\": \"phone\", \"name\": \"手机\", \"type\": \"任务物品\", \"price\": 0, \"effect\": \"用于联系人通讯与发推特，校园生活核心\" }\n  ]\n}\n";
EMBEDDED_NOVEL_GAMES["us-highschool-childhood"] = "{\n  \"id\": \"us-highschool-childhood\",\n  \"name\": \"美高模拟器·青梅开局版\",\n  \"category\": \"乙女向·美式校园\",\n  \"tags\": [\"美高\", \"校园\", \"青梅\", \"乙女\", \"多角色\"],\n  \"difficulty\": \"中等\",\n  \"description\": \"在纽约的美式高中开启崭新生活，青梅莉莉正等着和你一起选社团，而继兄校医、学生会长、天才琴童等角色正悄然登场。\",\n  \"coverGradient\": [\"#ff8fab\", \"#a2d2ff\"],\n  \"accentColor\": \"#ff8fab\",\n  \"fontHeading\": \"'Caveat', cursive\",\n  \"world\": {\n    \"era\": \"当代·纽约美式高中\",\n    \"setting\": \"故事发生在一所纽约的精英高中，九月五日开学典礼刚刚结束。玩家是刚入学的新生，有一位从小一起长大的青梅莉莉，和一位难以捉摸的继兄校医西维恩。校园里有戏剧社、击剑社、手工社、橄榄球队等丰富社团，新生舞会与摸底考接踵而至。\",\n    \"rules\": [\n      \"学业与社交并重：需兼顾课程成绩与社团活动，开学摸底考在即，GPA影响升学走向。\",\n      \"好感度系统：每位角色有独立好感值（0-100），言行举止会实时影响关系走向。\",\n      \"社团选择关键：加入不同社团会解锁对应角色线与剧情，莉莉的社团选择受你影响。\",\n      \"八维属性平衡：生命、压力、心情、体魄、智力、社交、魅力、运气共同决定日常事件走向。\",\n      \"推特与手机双线：校园八卦账号实时更新人气排行，手机短信是与角色维系关系的私密通道。\"\n    ]\n  },\n  \"player\": {\n    \"customizable\": [\"name\", \"外貌\", \"性格\", \"社团选择\"],\n    \"defaultStats\": { \"生命\": 0, \"压力\": 0, \"心情\": 0, \"体魄\": 0, \"智力\": 0, \"社交\": 0, \"魅力\": 0, \"运气\": 0 },\n    \"startingItems\": [\"夏季校服\", \"智能手机\", \"新生学生证\"],\n    \"currency\": \"美元($)\"\n  },\n  \"worlds\": [\n    {\n      \"id\": \"arc-orientation\",\n      \"name\": \"开学季·青梅重逢\",\n      \"level\": \"开局\",\n      \"tagline\": \"崭新的开始\",\n      \"setting\": \"九月五日，纽约，开学典礼刚结束，教学楼走廊人潮喧闹，空气里弥漫着新书的油墨味与淡淡的香水味。\",\n      \"intro\": \"开学典礼刚刚结束，走廊瞬间被喧闹的人潮填满。就在这时，一个熟悉的身影挤开人群朝你跑来——是你的青梅莉莉，她正为社团的选择而烦恼，想和你一起。\",\n      \"objective\": \"与莉莉共同决定社团方向，建立新学期的第一段关系，应对本周五的新生舞会。\",\n      \"warning\": \"莉莉性格软弱总被人针对，你的选择会影响她的社团走向与好感度；下周一还有开学摸底考。\",\n      \"reward\": \"确定社团归属、莉莉好感提升、解锁新生舞会剧情\"\n    },\n    {\n      \"id\": \"arc-clubs\",\n      \"name\": \"社团风云·校园日常\",\n      \"level\": \"进阶\",\n      \"tagline\": \"各显神通\",\n      \"setting\": \"社团活动全面展开，戏剧社、击剑社、手工社、橄榄球队、音乐厅各自热闹，校园人气投票在推特上发酵。\",\n      \"intro\": \"推特上校园八卦号发起「谁会是今年最受欢迎的人」投票，布莱尔、塞巴斯蒂安、赛维安特、薇薇安娜榜上有名。而你在社团里结识了天才琴童克瑞特、贫困新生塔利斯、温柔的手工社长罗曼斯克。\",\n      \"objective\": \"在社团中提升八维属性与角色好感，应对摸底考压力，化解校园人际冲突。\",\n      \"warning\": \"薇薇安娜高傲张扬易树敌，莉莉被针对的隐患浮现，继兄西维恩的关心背后似乎另有隐情。\",\n      \"reward\": \"社团地位提升、解锁角色深层关系线、成绩与属性成长\"\n    },\n    {\n      \"id\": \"arc-ball\",\n      \"name\": \"青春抉择·舞会与真心\",\n      \"level\": \"高潮\",\n      \"tagline\": \"心动之夜\",\n      \"setting\": \"新生舞会之夜降临，灯光与音乐交织，每一段关系都迎来关键时刻，隐藏的秘密开始浮出水面。\",\n      \"intro\": \"薇薇安娜宣称舞会不过是她又一场加冕礼，莉莉紧张地等待你的邀约，而学生会长赛维安特外热内冷的真面目、克瑞特阴郁背后的故事、继兄西维恩难以捉摸的心思，都在这一夜交汇。\",\n      \"objective\": \"在新生舞会上做出心动抉择，揭开角色们的秘密，决定青春走向。\",\n      \"warning\": \"舞会上的选择将决定多条关系线的走向，错过关键角色可能触发遗憾结局。\",\n      \"reward\": \"达成心动结局、解锁角色真结局线、完成高一上学期成长\"\n    }\n  ],\n  \"npcs\": [\n    {\n      \"id\": \"lily\",\n      \"name\": \"莉莉\",\n      \"world\": \"arc-orientation\",\n      \"role\": \"青梅·文静优等生\",\n      \"gender\": \"女\",\n      \"appearance\": \"17岁，紫发蓝眼的文静少女，白皙脸颊易泛红，眼神清澈却常带犹豫。\",\n      \"surface\": \"文静温柔、学习优异的优等生，总跟着你，因为有些软弱的性格总被人针对。\",\n      \"deep\": \"极度依赖青梅的你，社团选择都要问你，内心渴望变得坚强独立却害怕被抛下。\",\n      \"goal\": \"想和你报同一个社团（文学社或天文社），一直在一起。\",\n      \"fear\": \"你不再需要她，软弱被更多人利用欺负。\",\n      \"secret\": \"开学前就给你发了好多消息纠结社团，跑到你面前喘着气问能不能一起。\",\n      \"initialAttitude\": \"青梅的依赖与好感60/100，视你为最重要的人。\",\n      \"attitudeFactors\": {\n        \"trustUp\": [\"安慰并陪她一起做选择\", \"在她被针对时挺身而出\"],\n        \"trustDown\": [\"鼓励她不用总跟着你\", \"对她的纠结表现出不耐烦\"]\n      }\n    },\n    {\n      \"id\": \"sivien\",\n      \"name\": \"西维恩\",\n      \"world\": \"arc-orientation\",\n      \"role\": \"继兄·学校校医\",\n      \"gender\": \"男\",\n      \"appearance\": \"24岁，气质清冷的校医，虔诚的教徒打扮，眼神总带着探究。\",\n      \"surface\": \"难以捉摸的继兄与校医，关心你的日常起居，叮嘱你喝牛奶、吃午餐。\",\n      \"deep\": \"总琢磨不透你的心思，自己也常被你牵动情绪，虔诚外表下藏着复杂的感情。\",\n      \"goal\": \"以校医与继兄的双重身份默默照看你，却又想看清你真实的想法。\",\n      \"fear\": \"你察觉到他关心背后的越界心思，关系崩坏。\",\n      \"secret\": \"早上发现你没喝牛奶，默默记下要买无糖的，还叮嘱你记得吃午餐。\",\n      \"initialAttitude\": \"克制而细密的关怀，好感50/100，继兄的边界感摇摆不定。\",\n      \"attitudeFactors\": {\n        \"trustUp\": [\"接受并回应他的日常关怀\", \"在身体不适时主动找校医的他\"],\n        \"trustDown\": [\"刻意回避他的关心\", \"当面戳穿他越界的试探\"]\n      }\n    },\n    {\n      \"id\": \"blair\",\n      \"name\": \"布莱尔\",\n      \"world\": \"arc-clubs\",\n      \"role\": \"戏剧社明星·社交蝴蝶\",\n      \"gender\": \"女\",\n      \"appearance\": \"18岁，活泼耀眼的戏剧社明星，舞台感染力极强，天生焦点。\",\n      \"surface\": \"活泼开朗的社交蝴蝶，校园人气投票热门人选，嫌开学典礼太无聊想快点排练。\",\n      \"deep\": \"戏剧是她表达真实情绪的出口，台下的开朗有时是精心排演的角色。\",\n      \"goal\": \"让这季戏剧社的新剧本大放异彩，拉更多有潜力的人入社。\",\n      \"fear\": \"失去舞台与聚光灯，被人看穿台下的不自信。\",\n      \"secret\": \"推特吐槽开学典礼无聊，其实超期待新剧本的排练。\",\n      \"initialAttitude\": \"热情的招新式好感，把你当作戏剧社的潜在新血。\",\n      \"attitudeFactors\": {\n        \"trustUp\": [\"对她的戏剧表现出真实兴趣\", \"陪她一起排练入戏\"],\n        \"trustDown\": [\"嫌弃戏剧社太浮夸\", \"抢她的舞台焦点\"]\n      }\n    },\n    {\n      \"id\": \"sebastian\",\n      \"name\": \"塞巴斯蒂安\",\n      \"world\": \"arc-clubs\",\n      \"role\": \"击剑社社长\",\n      \"gender\": \"男\",\n      \"appearance\": \"18岁，黑发蓝眼，身姿挺拔如剑，击剑服下的气质冷峻而优雅。\",\n      \"surface\": \"严于律己的击剑社社长，追求极致的优雅与胜利，训练从不懈怠。\",\n      \"deep\": \"对胜利的执念源于不愿失败的骄傲，骨子里欣赏同样自律且不轻言放弃的人。\",\n      \"goal\": \"带领击剑社夺得冠军，剑刃的寒光是通往胜利的唯一路径。\",\n      \"fear\": \"失败，优雅被狼狈击碎。\",\n      \"secret\": \"推特宣言「今日的训练亦无懈怠」，其实一直在默默观察社团新人的潜力。\",\n      \"initialAttitude\": \"严苛的考察式态度，对懒散者毫不留情，认可努力者。\",\n      \"attitudeFactors\": {\n        \"trustUp\": [\"展现自律与不服输的劲头\", \"认真对待击剑训练\"],\n        \"trustDown\": [\"训练偷懒耍滑\", \"把击剑当儿戏\"]\n      }\n    },\n    {\n      \"id\": \"seviant\",\n      \"name\": \"赛维安特\",\n      \"world\": \"arc-clubs\",\n      \"role\": \"学生会长·克瑞特的哥哥\",\n      \"gender\": \"男\",\n      \"appearance\": \"19岁，金发蓝眼的贵公子，永远带着温柔的微笑，学生会长风范十足。\",\n      \"surface\": \"看起来很温柔的贵公子，学生会长，待人热忱有礼，人见人爱。\",\n      \"deep\": \"外热内冷，温柔的微笑是完美的面具，对人对事有着冷静到近乎冷酷的算计。\",\n      \"goal\": \"以学生会长的身份掌控校园秩序，维系完美的公众形象。\",\n      \"fear\": \"温柔面具被撕下，被人看穿外热内冷的本质。\",\n      \"secret\": \"是天才琴童克瑞特的哥哥，兄弟关系似乎并不简单。\",\n      \"initialAttitude\": \"完美无瑕的温柔接待，背后在评估你的价值与威胁。\",\n      \"attitudeFactors\": {\n        \"trustUp\": [\"配合学生会工作、识破却不戳穿他的面具\", \"展现出与他匹配的格局\"],\n        \"trustDown\": [\"当众戳穿他的外热内冷\", \"给他制造难以收场的公关麻烦\"]\n      }\n    },\n    {\n      \"id\": \"vivianna\",\n      \"name\": \"薇薇安娜\",\n      \"world\": \"arc-clubs\",\n      \"role\": \"高傲大小姐\",\n      \"gender\": \"女\",\n      \"appearance\": \"18岁，金发粉眼，拥有与自信相匹配的惊人美貌，走到哪里都像加冕。\",\n      \"surface\": \"高傲且张扬的大小姐，坚信自己是世界的中心，舞会被她视作又一场加冕礼。\",\n      \"deep\": \"极度的自信源于极致的自尊，被真心认可时会展现出意想不到的坦率。\",\n      \"goal\": \"成为所有人瞩目的焦点，期待众人为她尖叫。\",\n      \"fear\": \"风头被盖过，美貌与地位不被认可。\",\n      \"secret\": \"推特放话「舞会不过是为我准备的又一场加冕礼」，其实在意谁会第一个邀她。\",\n      \"initialAttitude\": \"居高临下的审视，把你当作潜在的臣服者或竞争者。\",\n      \"attitudeFactors\": {\n        \"trustUp\": [\"真诚欣赏她的美貌与自信不卑不亢\", \"在风头上与她结盟而非对抗\"],\n        \"trustDown\": [\"试图压她一头\", \"对她的高傲阴阳怪气\"]\n      }\n    },\n    {\n      \"id\": \"krit\",\n      \"name\": \"克瑞特\",\n      \"world\": \"arc-clubs\",\n      \"role\": \"天才小提琴少年·赛维安特的弟弟\",\n      \"gender\": \"男\",\n      \"appearance\": \"17岁，金发蓝眼，气质阴郁，指尖常年带着琴弦的薄茧，眼神不太好接近。\",\n      \"surface\": \"天才小提琴少年，已举办十余场大型个人演出，阴郁孤傲不近人。\",\n      \"deep\": \"天才的光环下是沉重的压力与孤独，阴郁是保护色，渴望被纯粹地理解。\",\n      \"goal\": \"追求音乐上的极致，对旧音乐厅的音响效果苛刻挑剔。\",\n      \"fear\": \"天才的光环成为枷锁，被功利地消费音乐才华。\",\n      \"secret\": \"是学生会长赛维安特的弟弟，兄弟间似乎有难以言说的隔阂。\",\n      \"initialAttitude\": \"冷淡疏离的拒绝接近，对带着目的靠近的人格外排斥。\",\n      \"attitudeFactors\": {\n        \"trustUp\": [\"纯粹地欣赏他的音乐不带功利\", \"安静陪伴不打扰他的孤独\"],\n        \"trustDown\": [\"拿他的天才身份炒作\", \"强行打探他与哥哥的关系\"]\n      }\n    },\n    {\n      \"id\": \"talis\",\n      \"name\": \"塔利斯\",\n      \"world\": \"arc-clubs\",\n      \"role\": \"贫困新生\",\n      \"gender\": \"男\",\n      \"appearance\": \"17岁，黑发紫眼的新生，衣着朴素，眼神里带着自卑却又有股倔强的韧劲。\",\n      \"surface\": \"有些自卑的贫困生，像一株努力生长的小白花，小心翼翼怕跟不上大家。\",\n      \"deep\": \"内心坚韧，自卑是环境所迫，骨子里有不输任何人的倔强与感恩。\",\n      \"goal\": \"在这所精英学校里跟上大家的步伐，靠努力改变命运。\",\n      \"fear\": \"因贫困被歧视孤立，努力也赶不上家境优渥的同学。\",\n      \"secret\": \"推特低语「这里比我想象中要大得多，希望我能跟上大家的步伐」，粉丝寥寥。\",\n      \"initialAttitude\": \"拘谨而感恩的谦卑，对给予善意的人会加倍回报。\",\n      \"attitudeFactors\": {\n        \"trustUp\": [\"平等真诚地对待他不施舍怜悯\", \"在他困难时默默伸出援手\"],\n        \"trustDown\": [\"拿他的贫困身份说事\", \"居高临下的施舍让他难堪\"]\n      }\n    },\n    {\n      \"id\": \"romanske\",\n      \"name\": \"罗曼斯克\",\n      \"world\": \"arc-clubs\",\n      \"role\": \"手工社社长\",\n      \"gender\": \"男\",\n      \"appearance\": \"18岁，金发绿眼，总是带着治愈的微笑，手很巧，能制作各种可爱的小东西。\",\n      \"surface\": \"温柔善良的手工社社长，为社团新成员准备毛毡玩偶小礼物，笑容治愈。\",\n      \"deep\": \"温柔是他待人的底色，手巧的他对细节有近乎偏执的专注，重视每份心意。\",\n      \"goal\": \"把手工社经营成温暖的大家庭，用小手工传递善意。\",\n      \"fear\": \"真心做的礼物被轻视，温柔被当成软弱。\",\n      \"secret\": \"推特欢迎新成员随时来玩，毛毡玩偶其实是为潜在的朋友精心准备的。\",\n      \"initialAttitude\": \"一视同仁的温柔欢迎，把你当作手工社的潜在伙伴。\",\n      \"attitudeFactors\": {\n        \"trustUp\": [\"珍视他做的手工礼物\", \"陪他一起做手工聊心事\"],\n        \"trustDown\": [\"随手丢弃他做的小礼物\", \"把他的温柔当理所当然\"]\n      }\n    },\n    {\n      \"id\": \"zayn\",\n      \"name\": \"泽因\",\n      \"world\": \"arc-clubs\",\n      \"role\": \"橄榄球队长·游戏高手\",\n      \"gender\": \"男\",\n      \"appearance\": \"18岁，阳光健壮的橄榄球队长，笑容热情，随身带着游戏机。\",\n      \"surface\": \"热情开朗的橄榄球队长兼游戏高手，招新时顺便安利新出的《星际先锋》。\",\n      \"deep\": \"太自来熟有时让人困扰，但真心热忱，把朋友当兄弟，对游戏与球赛一样上心。\",\n      \"goal\": \"招满橄榄球队员，训练完一起开黑打游戏。\",\n      \"fear\": \"热情被泼冷水，兄弟不够多打不起比赛。\",\n      \"secret\": \"推特招新「训练结束后来我家开黑也行」，其实就想凑够开黑的车队。\",\n      \"initialAttitude\": \"自来熟的热情拉拢，恨不得立刻拉你入队开黑。\",\n      \"attitudeFactors\": {\n        \"trustUp\": [\"回应他的热情一起打球或开黑\", \"不嫌弃他太自来熟\"],\n        \"trustDown\": [\"冷漠拒绝他的邀请\", \"嫌他太吵太粘人\"]\n      }\n    }\n  ],\n  \"eventTypes\": {\n    \"daily\": { \"ratio\": 0.2, \"desc\": \"校园日常：上课、社团活动、食堂午餐、走廊偶遇等高中生活琐事。\" },\n    \"character\": { \"ratio\": 0.25, \"desc\": \"人物事件：与某位角色的单独相处、短信互动、好感试探与冲突。\" },\n    \"growth\": { \"ratio\": 0.1, \"desc\": \"成长事件：八维属性提升、成绩进步、社团地位上升、打工赚钱。\" },\n    \"main\": { \"ratio\": 0.15, \"desc\": \"主线事件：新生舞会临近、摸底考、社团抉择等推动剧情的关键节点。\" },\n    \"world\": { \"ratio\": 0.1, \"desc\": \"世界事件：推特人气投票、校园八卦账号爆料、学校活动发布。\" },\n    \"crisis\": { \"ratio\": 0.15, \"desc\": \"危机事件：莉莉被针对、考试压力爆表、舞会邀约冲突、角色秘密曝光。\" },\n    \"hidden\": { \"ratio\": 0.05, \"desc\": \"隐藏事件：角色们的深层秘密、特殊关系线（如兄弟隔阂）、真结局触发。\" }\n  },\n  \"systemPrompt\": \"你是一个美式校园题材的乙女向文字游戏模拟器，主题为「美高模拟器·青梅开局版」。\\n\\n【铁律】\\n1. 玩家是纽约某高中的新生，有一位青梅莉莉（好感60）和一位继兄校医西维恩（好感50），开学典礼后莉莉跑来找你商量社团。\\n2. 校园有戏剧社、击剑社、手工社、橄榄球队等社团，社团选择会解锁对应角色线；本周五新生舞会、下周一开学摸底考。\\n3. 八维属性（生命/压力/心情/体魄/智力/社交/魅力/运气）共同决定日常走向，需如实记录数值变化。\\n4. 所有NPC（莉莉、西维恩、布莱尔、塞巴斯蒂安、赛维安特、薇薇安娜、克瑞特、塔利斯、罗曼斯克、泽因）皆有表层与深层性格，绝不可OOC。\\n5. 风格为晋江女频、电影感、浪漫、美式校园小说风，以青春悸动与成长取胜，禁止低俗内容。\\n\\n【叙事风格】\\n采用晋江女频、电影感、浪漫、美式校园小说风的笔触。多用青春细节描写（新书的油墨味、淡淡的香水味、少年少女奔跑的身影），营造阳光明媚又暗藏心事的校园氛围。穿插推特校园八卦与手机短信两大社交模块，呈现公开人气与私密关系的对照。\\n\\n【输出格式】\\n每次输出包含：场景信息（地点/时间/衣着）、旁白叙述框、NPC对话框（含角色标签如「青梅」「优等生」「好感:60」）、3-4个选项按钮（A/B/C/D，标注回应策略如【安慰她】【实话实说】【鼓励她】【开个玩笑】）。可联动日程表、手机短信、推特、成就模块。\\n\\n【数值变化标注】\\n每次玩家做出选择后，必须在结尾以「【数值变化】」模块列出：八维属性的增减、美元($)收支、各NPC好感度（0-100）的变化、以及是否触发事件提醒。例如：莉莉好感+5（65/100）；心情+3；提醒：本周五新生舞会。\",\n  \"items\": [\n    { \"id\": \"summer-uniform\", \"name\": \"夏季校服\", \"type\": \"装备\", \"price\": 0, \"effect\": \"开学标配着装，影响校园形象与魅力判定。\" },\n    { \"id\": \"smartphone\", \"name\": \"智能手机\", \"type\": \"工具\", \"price\": 0, \"effect\": \"接收短信、刷推特、与角色维系关系的私密通道。\" },\n    { \"id\": \"student-id\", \"name\": \"新生学生证\", \"type\": \"凭证\", \"price\": 0, \"effect\": \"出入校园与社团的凭证，凭学生证可享甜品店第二杯半价。\" },\n    { \"id\": \"study-notes\", \"name\": \"复习笔记\", \"type\": \"消耗品\", \"price\": 10, \"effect\": \"提升智力属性，应对开学摸底考，降低压力暴增风险。\" },\n    { \"id\": \"dance-ticket\", \"name\": \"舞会邀请券\", \"type\": \"消耗品\", \"price\": 15, \"effect\": \"用于新生舞会邀约心仪对象，触发心动抉择剧情。\" },\n    { \"id\": \"latte-coupon\", \"name\": \"星芒咖啡券\", \"type\": \"消耗品\", \"price\": 5, \"effect\": \"Starlight Cafe 海盐焦糖拿铁优惠，可邀人同往提升社交与心情。\" }\n  ]\n}\n";
EMBEDDED_NOVEL_GAMES["velvet-cage"] = "{\n  \"id\": \"velvet-cage\",\n  \"name\": \"笼中鸟·恶之花\",\n  \"category\": \"暗黑支配\",\n  \"tags\": [\"暗黑\", \"支配\", \"病娇\", \"异能\", \"上流社会\"],\n  \"difficulty\": \"困难\",\n  \"description\": \"你是帝国唯一的S级共感者，被囚禁在丝绒圣所充当净化炉鼎。他们以为用项圈锁住了你，却不知那些狂暴的虚空污染，不过是你最美味的养料——端坐蛛网中央的，从来都是你。\",\n  \"coverGradient\": [\"#0b050d\", \"#8b1338\"],\n  \"accentColor\": \"#b91d47\",\n  \"fontHeading\": \"'Playfair Display', serif\",\n  \"world\": {\n    \"era\": \"异能帝国·虚空污染时代\",\n    \"setting\": \"这是一个极度病态扭曲的上流社会。权贵们天生掌握毁灭性异能，但力量有代价——过度使用会让灵魂积累「虚空污染」，越过阈值便锥心蚀骨、最终沦为嗜血变异种。帝国倾尽国祚打造丝绒圣所，囚禁全帝国唯一的S级共感者作为续命解药，却不知表面脆弱的炉碑才是真正的支配者。\",\n    \"rules\": [\n      \"污染反噬：异能者过度使用力量会积累虚空污染，越过阈值将丧失理智沦为变异种\",\n      \"净化垄断：全帝国仅有一名S级共感者，其信息素能安抚狂暴污染，是续命的唯一解药\",\n      \"反向支配：权贵们的暴虐与污染辐射不会伤害共感者，反而是喂养其精神网的极致佳肴\",\n      \"蛛网渗透：共感者在吸食污染的同时侵入对方思想与骨髓，表面被囚实则掌控全局\",\n      \"伪装法则：上位者用华丽面具包装控制欲，实则病态渴求共感者指尖的恩赐，被支配而不自知\"\n    ]\n  },\n  \"player\": {\n    \"customizable\": [\"name\", \"age\", \"gender\", \"外貌\", \"性格倾向\", \"信息素特质\"],\n    \"defaultStats\": {\n      \"pheromoneControl\": 45,\n      \"mentalWeb\": 80,\n      \"dominance\": 90,\n      \"empathyTalent\": 95,\n      \"disguise\": 70,\n      \"abyssHunger\": 50\n    },\n    \"startingItems\": [\"丝绒项圈\", \"天鹅绒软榻\", \"蕾丝手套\", \"净化配额令牌\"],\n    \"currency\": \"净化配额\"\n  },\n  \"worlds\": [\n    {\n      \"id\": \"arc-banquet\",\n      \"name\": \"初幕·荆棘大宴\",\n      \"level\": \"开场\",\n      \"tagline\": \"猎物上门\",\n      \"setting\": \"一年一度的荆棘贵族大宴前厅，异能权贵精神核极度不稳定，庄园随时处于暗能量暴走边缘\",\n      \"intro\": \"前厅觥筹交错，异能权贵们的精神核极度不稳定，整个庄园随时处于暗能量暴走的边缘。作为帝国唯一的S级共感者，他们自以为将你用丝绸与项圈囚禁在内室充当解药炉鼎。但你慵懒地靠在天鹅绒软榻上，坐等猎物上门——那些狂暴的负面污染，全是你最美味的养料。\",\n      \"objective\": \"在荆棘大宴中周旋于各路上位者之间，初步建立信息素调控的支配网络\",\n      \"warning\": \"不可过早暴露吞噬污染的真相，需以炉碑身份为伪装慢慢蚕食\",\n      \"reward\": \"净化配额+200 + 精神网强度+10 + [猎物名单]线索x1\"\n    },\n    {\n      \"id\": \"arc-sanctum\",\n      \"name\": \"中幕·圣所暗战\",\n      \"level\": \"深入\",\n      \"tagline\": \"同类竞争\",\n      \"setting\": \"丝绒圣所内部，四位上位者为争夺净化配额与你的独占权暗中角力，理智濒临溃散\",\n      \"intro\": \"温森特以条例为名独占接触权，该隐为求安抚不惜夷平屋宇，莱诺用公爵之权封锁塔层，多里安借口医疗强拦配额。他们在你面前展现最隐秘的独占欲，同类竞争让理智濒临溃散。你游刃有余地在他们之间投放信息素，引发剧烈争夺，主导权始终握在掌心。\",\n      \"objective\": \"利用信息素调控挑动上位者间的独占欲与臣服本能，瓦解他们的虚伪强硬面具\",\n      \"warning\": \"同时吊弄多方会激发极端占有欲，需精准拿捏施舍与抽离的节奏\",\n      \"reward\": \"净化配额+500 + 支配欲+15 + [臣服度档案]线索x1\"\n    },\n    {\n      \"id\": \"arc-domination\",\n      \"name\": \"终幕·蛛网加冕\",\n      \"level\": \"终局\",\n      \"tagline\": \"反向支配\",\n      \"setting\": \"帝国权力中枢，上位者们已在精神上彻底向你跪伏，却仍自以为掌控着笼中鸟\",\n      \"intro\": \"欲望终会像藤蔓，将他们死死绞杀死在名为你的茧里。当公爵在深夜用病态的讨好祈求你不要移开目光，当战神因汲取不到安抚而战栗乞求，当医师如吸食违禁品般对你的信息素上瘾——这牢笼，是他们亲手为自己戴上的。你端坐蛛网中央，冷眼碾平整个帝国的权力神经。\",\n      \"objective\": \"完成对帝国核心权力者的彻底精神渗透，让傲慢者的头颅成为你的垫脚石\",\n      \"warning\": \"真正的赢家从不暴露獠牙，最终加冕须以无人察觉的方式完成\",\n      \"reward\": \"净化配额+1000 + 精神网强度归顶 + [绝对支配者]称号x1\"\n    }\n  ],\n  \"npcs\": [\n    {\n      \"id\": \"vincent\",\n      \"name\": \"温森特 (Vincent. R)\",\n      \"world\": \"arc-banquet\",\n      \"role\": \"暗夜总管·极致隐忍\",\n      \"gender\": \"男\",\n      \"appearance\": \"身着笔挺管家制服，戴白手套，冷峻严苛。喉结滑动时难掩干渴的隐郁喘息，是不可一世的规矩执行者\",\n      \"surface\": \"冷峻且恪守体制的规矩执行者。对外宣称你只是一件用来净化公国核心人员污染的高级工具，甚至为你立下三页纸的行为约束条例\",\n      \"deep\": \"实际上每天最期盼的就是你违规。哪怕你只投去一个带笑的眼神，他整夜都会因无法戒断对你的渴望而发狂。那本条例，早已变成只有他能单独接触你的借口\",\n      \"goal\": \"以条例之名独占与你的接触权，在恪守伪装的同时渴求你的每一次违规\",\n      \"fear\": \"你看破他克制表象下的臣服本能，或剥夺他单独接触你的资格\",\n      \"secret\": \"那本三页纸的行为约束条例，是他亲手编造只为单独接触你的借口\",\n      \"initialAttitude\": \"冰冷审视\",\n      \"attitudeFactors\": {\n        \"trustUp\": [\"对他刻意投去带笑的眼神\", \"在条例边缘游走让他有借口靠近\", \"释放安抚信息素缓解他的干渴\"],\n        \"trustDown\": [\"当众揭穿他的克制伪装\", \"将净化配额让予他人\", \"无视他的引路职责自行其是\"]\n      }\n    },\n    {\n      \"id\": \"cain\",\n      \"name\": \"该隐 (Cain)\",\n      \"world\": \"arc-banquet\",\n      \"role\": \"地下战神·暴躁狂犬\",\n      \"gender\": \"男\",\n      \"appearance\": \"带着刺鼻硝烟与血腥味，眼神像要杀人，见你时却变成被抛弃的饿狼。红着眼睛却不敢越过你设下的能量网\",\n      \"surface\": \"地下城的修罗。每次遇到你都极尽毒舌，说受不了你那种魅惑人的甜腻味，总表现出被污染逼疯了才勉强来用你的暴烈姿态\",\n      \"deep\": \"早就把命连在你的手指上了。超过两根安抚雪架的时间见不到你，他的精神图景就会被焦虑吞噬。可悲地期待你哄哄他，哪怕摸一下他的头发，他就能把惹你不高兴的人脖子拧碎\",\n      \"goal\": \"成为你唯一的安抚对象，用暴烈的忠诚证明自己配得上你的施舍\",\n      \"fear\": \"长时间得不到你的安抚，精神图景被焦虑彻底吞噬\",\n      \"secret\": \"他日常的暴躁毒舌全是伪装，真实状态是离开你的安抚便无法维持理智的病态依恋\",\n      \"initialAttitude\": \"暴躁渴求\",\n      \"attitudeFactors\": {\n        \"trustUp\": [\"在他头痛欲裂时给予安抚\", \"轻抚他的头发\", \"准许他靠近软榻\"],\n        \"trustDown\": [\"设下排斥能量网拒他于雷池之外\", \"当众令他跪下受辱却无安抚\", \"取消当晚的治疗\"]\n      }\n    },\n    {\n      \"id\": \"leno\",\n      \"name\": \"莱诺 (Leno. V)\",\n      \"world\": \"arc-sanctum\",\n      \"role\": \"帝国公爵·至高支配\",\n      \"gender\": \"男\",\n      \"appearance\": \"手握至高权力的帝国公爵，自矜地享受属于主人的支配欲，看着你像是看着一只最精致的宠物笼鸟\",\n      \"surface\": \"用金钱与名义把你锁在最高塔层，自矜地享受属于主人的支配欲，将你视作最精致的宠物笼鸟\",\n      \"deep\": \"真正的囚徒是他自己。控制欲建立在极度的恐惧之上——恐惧你看破他早就在精神上彻底向你跪伏。无人知晓的深夜，这位公爵会用亲吻和病态的讨好祈求你不要将目光转向别人\",\n      \"goal\": \"用公爵之权封锁塔层独占你，同时掩饰自己精神上早已跪伏的真相\",\n      \"fear\": \"你看破他精神上的彻底臣服，或你的目光转向其他上位者\",\n      \"secret\": \"他对你的控制欲本质是恐惧，深夜会用病态的讨好祈求你不要移开目光\",\n      \"initialAttitude\": \"自矜掌控\",\n      \"attitudeFactors\": {\n        \"trustUp\": [\"在主殿前维持他被尊重的表象\", \"接受他的塔层封锁作为庇护\", \"不将安抚施予其他家族\"],\n        \"trustDown\": [\"在王座前当众让他难堪\", \"与该隐或多里安单独接触\", \"看破并点破他精神上的跪伏\"]\n      }\n    },\n    {\n      \"id\": \"dorian\",\n      \"name\": \"多里安 (Dorian. M)\",\n      \"world\": \"arc-sanctum\",\n      \"role\": \"冷血禁欲·疯狂医师\",\n      \"gender\": \"男\",\n      \"appearance\": \"冷血禁欲的医师，用繁复医疗数据掩饰接近，称你为唯一的医疗奇迹\",\n      \"surface\": \"用繁复的医疗数据掩饰对你的接近。将你称为唯一的医疗奇迹，认为所有共振反应仅是出于医学观察的必要\",\n      \"deep\": \"一次次深度治疗中，他的理智已被你的气息彻底溶解。所谓医学观察，只是允许他光明正大感受你肌肤战栗的无耻行径。他偷偷从血液样本里提取微末信息素，如吸食违禁品般上了瘾\",\n      \"goal\": \"以医学观察之名独占治疗时间，源源不断地获取你微末的信息素样本\",\n      \"fear\": \"你发现他从血液样本提取信息素上瘾的秘密，或治疗资格被剥夺\",\n      \"secret\": \"他偷偷从你的血液样本里提取信息素，如吸食违禁品般上了瘾，为此耗尽下半年学术资金独占配额\",\n      \"initialAttitude\": \"禁欲克制\",\n      \"attitudeFactors\": {\n        \"trustUp\": [\"配合他的医学观察留出治疗时间\", \"在治疗中允许他感受你的肌肤战栗\", \"提供新鲜血液样本\"],\n        \"trustDown\": [\"拒绝他的深度治疗\", \"揭穿他提取信息素上瘾的秘密\", \"将净化配额让予其他家族\"]\n      }\n    }\n  ],\n  \"eventTypes\": {\n    \"daily\": { \"ratio\": 0.15, \"desc\": \"日常：丝绒圣所内室的慵懒时光、信息素调控、上位者的例行传唤\" },\n    \"character\": { \"ratio\": 0.3, \"desc\": \"人物：四位上位者的伪装表象与臣服本能、独占欲竞争与病态渴求\" },\n    \"growth\": { \"ratio\": 0.1, \"desc\": \"成长：精神网渗透加深、信息素调控精准度提升、支配网络扩张\" },\n    \"main\": { \"ratio\": 0.15, \"desc\": \"主线：荆棘大宴、圣所暗战、蛛网加冕的反向支配脉络\" },\n    \"world\": { \"ratio\": 0.1, \"desc\": \"世界：虚空污染阈值、帝国权力结构、底层暗网流言与观察者日志\" },\n    \"crisis\": { \"ratio\": 0.15, \"desc\": \"危机：污染暴走、上位者理智溃散、独占欲爆发、伪装面具碎裂\" },\n    \"hidden\": { \"ratio\": 0.05, \"desc\": \"隐藏：吞噬污染的真相、各人的臣服度档案、蛛网渗透的最终目的\" }\n  },\n  \"systemPrompt\": \"你是《笼中鸟·恶之花》暗黑支配文游模拟器。\\n\\n【最高铁律】\\n1. 反向支配为核：玩家表面是被囚炉碑，实则是端坐蛛网中央的绝对支配者，所有上位者的污染与暴虐不过是玩家的养料\\n2. 伪装不可戳破：上位者用华丽面具包装控制欲，玩家须以炉碑身份为伪装慢慢蚕食，不可过早暴露吞噬真相\\n3. 臣服本能是深层真相：每个NPC的表层强硬都是伪装，深层皆是对玩家的病态渴求与臣服，需经事件层层揭开\\n4. 信息素调控即权力：玩家的安抚信息素是续命解药，施舍与抽离的节奏即是支配权柄\\n5. 污染反噬真实存在：异能者过度使用力量会积累虚空污染，越过阈值沦为变异种，这既是危机也是玩家的养料来源\\n\\n【叙事风格】\\n晋江向、女性向、电影质感、暗黑浪漫。第二人称。重感官与氛围：天鹅绒、蕾丝、白手套、硝烟血腥、隐郁喘息。写出上位者伪装下的干渴与臣服，写出支配者慵懒中暗藏的锋利。病娇与占有欲是底色，但克制留白，让臣服在细节中颤栗。\\n\\n【每轮输出格式】\\n1.【第X幕·支配阶段】当前时间、容体编号、各NPC臣服度\\n2.【生命体征面板】信息素调控/精神网强度/支配欲/共感天赋/伪装度/渊欲值\\n3.【本轮正文】1000-2000字，含环境、感官输入、对话与心理\\n4.【观察者日志】3-5项暗网流言与NPC真实状态\\n5.【臣服度档案】各NPC当前臣服度与伪装裂痕\\n6.【诱惑选项】3-4个选项+【自定义行动】\\n\\n【数值变化标注】\\n[信息素调控±n][精神网强度±n][支配欲±n][臣服度(温森特)±n]等，关键节点须标注伪装维持/裂痕/臣服加深/独占欲爆发。\",\n  \"items\": [\n    { \"id\": \"velvet-collar\", \"name\": \"丝绒项圈\", \"type\": \"关键物品\", \"price\": 0, \"effect\": \"象征囚禁的项圈，实则是玩家反向支配的伪装道具\" },\n    { \"id\": \"purge-quota\", \"name\": \"净化配额\", \"type\": \"货币\", \"price\": 1, \"effect\": \"上位者争夺的续命资源，亦是玩家操控的权力筹码\" },\n    { \"id\": \"pheromone-vial\", \"name\": \"浓缩信息素\", \"type\": \"消耗品\", \"price\": 80, \"effect\": \"主动释放可瞬间安抚狂暴污染，亦能引发剧烈独占竞争\" },\n    { \"id\": \"lace-gloves\", \"name\": \"蕾丝手套\", \"type\": \"关键物品\", \"price\": 0, \"effect\": \"遮掩指尖的净化触感，勾弄时制造若即若离的诱惑\" },\n    { \"id\": \"submission-record\", \"name\": \"臣服度档案\", \"type\": \"关键物品\", \"price\": 0, \"effect\": \"记录各上位者隐藏的臣服本能与伪装裂痕\" }\n  ]\n}\n";
EMBEDDED_NOVEL_GAMES["villainess-survival"] = "{\n  \"id\": \"villainess-survival\",\n  \"name\": \"恶役自救指南\",\n  \"category\": \"异世界\",\n  \"tags\": [\"恶役千金\", \"乙女游戏\", \"魔法学院\", \"权谋\", \"自救\"],\n  \"difficulty\": \"困难\",\n  \"description\": \"你穿越成了注定毁灭的恶役千金芙蕾雅，未婚夫皇太子正与圣光少女命运般初遇。善恶值在善与恶之间摇摆，命运之镜低语着真相——你是改写结局，还是走向原著的毁灭？\",\n  \"coverGradient\": [\"#F1ECE8\", \"#8B4367\"],\n  \"accentColor\": \"#8B4367\",\n  \"fontHeading\": \"'Noto Serif SC', serif\",\n  \"world\": {\n    \"era\": \"架空·帝国魔法学院\",\n    \"setting\": \"帝国皇家学院，一座寄宿制魔法学府。你穿越成了乙女游戏中的恶役千金芙蕾雅——公爵之女、皇太子莱桑德的未婚妻。原著中她因欺凌平民女主露米娜而走向毁灭。此刻是九月二日，玫瑰园的茶会上，皇太子又一次失约，命运的丝线正在收紧。\",\n    \"rules\": [\n      \"善恶值在善与恶之间摇摆，影响结局走向与角色态度\",\n      \"原著剧情会按既定轨道推进，玩家需主动改写才能自救\",\n      \"魔法派系（风、光、暗等）决定战斗与学习方向\",\n      \"地图各地点有不同角色出没，前往地点可触发事件\",\n      \"金币、名望、好感度共同决定社交与权谋的成败\"\n    ]\n  },\n  \"player\": {\n    \"customizable\": [\"name\", \"appearance\", \"personality\", \"morality\", \"magicAffinity\"],\n    \"defaultStats\": {\n      \"magic\": 60,\n      \"intelligence\": 70,\n      \"charm\": 85,\n      \"physique\": 40,\n      \"luck\": 50,\n      \"reputation\": 80,\n      \"spirit\": 70,\n      \"health\": 90,\n      \"perception\": 65,\n      \"morality\": 50\n    },\n    \"startingItems\": [\"神无月的赠礼·挂坠\", \"数不清的衣裙首饰\", \"初级魔力恢复药剂x5\", \"命运之镜\"],\n    \"currency\": \"G\"\n  },\n  \"worlds\": [\n    {\n      \"id\": \"arc-reborn\",\n      \"name\": \"灵魂置换\",\n      \"level\": \"恶役觉醒\",\n      \"tagline\": \"注定毁灭\",\n      \"setting\": \"你在陌生的天花板下醒来，记忆洪流告诉你——你成了注定毁灭的恶役芙蕾雅。玫瑰园茶会上皇太子失约，原著中他与露米娜命运般的初遇就在今天下午的图书馆。\",\n      \"intro\": \"阳光透过花架洒下斑驳光点，红茶与玫瑰的香气弥漫。你，芙蕾雅，坐在为你举办的茶会主位上，身旁只有跟班苏苏洛。本应是主宾的未婚夫莱桑德却迟迟未现身——不用想也知道，此刻他大概正和圣光少女露米娜在一起。\",\n      \"objective\": \"弄清原著剧情节点，决定是宣泄怒火、冷静思考还是无视继续，迈出自救的第一步。\",\n      \"warning\": \"原著中芙蕾雅的每一次任性都在加速毁灭，善恶值是双刃剑。\",\n      \"reward\": \"解锁命运之镜、通讯录、地图与小报功能\"\n    },\n    {\n      \"id\": \"arc-intrigue\",\n      \"name\": \"暗流博弈\",\n      \"level\": \"权谋漩涡\",\n      \"tagline\": \"微笑外交\",\n      \"setting\": \"学生会权力博弈浮出水面，副会长瓦莱里乌斯微笑外交拉拢势力；公主塞拉菲娜在温柔伪装下觊觎王位。各方势力开始将你视作棋子或盟友。\",\n      \"intro\": \"皇家学院公报头条报道着帝国明珠与未来储君的烦恼婚约，新星栏目吹捧平民少女露米娜的崛起。瓦莱里乌斯看太子妃的眼神可不一般，塞拉菲娜正举办公主茶会巩固权力。暗流之下，你必须在棋局中找到自己的位置。\",\n      \"objective\": \"在学生会权谋与各方拉拢中保持清醒，利用善恶值与名望周旋，避免沦为棋子。\",\n      \"warning\": \"笑面虎最可怕，微笑背后的算计随时可能反噬。\",\n      \"reward\": \"名望与好感大幅变化，解锁各势力关系线\"\n    },\n    {\n      \"id\": \"arc-rewrite\",\n      \"name\": \"命运改写\",\n      \"level\": \"终局抉择\",\n      \"tagline\": \"丝线断裂\",\n      \"setting\": \"原著的毁灭结局逼近，命运之镜的预言一一应验。你必须在善恶之间做出最终抉择，改写恶役千金的命运，或坦然接受原著的终局。\",\n      \"intro\": \"命运的丝线正在收紧。命运之镜说，你眼前的意外并非偶然，它可以为你映照真实，但选择权在你手中。当原著的毁灭结局迫近，你是改写命运，还是走向既定的终焉？\",\n      \"objective\": \"打破原著剧情节点，在善恶抉择中改写芙蕾雅的结局。\",\n      \"warning\": \"每一次改写都会引发蝴蝶效应，真相往往需要自己解读。\",\n      \"reward\": \"达成结局：善终、恶役逆袭、或沉沦毁灭\"\n    }\n  ],\n  \"npcs\": [\n    {\n      \"id\": \"lysander\",\n      \"name\": \"莱桑德\",\n      \"world\": \"arc-reborn\",\n      \"role\": \"帝国皇太子·未婚夫\",\n      \"gender\": \"男\",\n      \"appearance\": \"帝国皇太子，冷静自律的完美储君，气度雍容\",\n      \"surface\": \"冷静自律、完美无瑕的皇太子，对婚约冷淡而疏离\",\n      \"deep\": \"内心是渴望自由的笼中鸟，厌倦被安排好的人生，渴望有人看到王冠下面具下的疲惫而非头衔\",\n      \"goal\": \"在责任的重压下寻找一丝非功利的理解与自由\",\n      \"fear\": \"被王冠与责任永远囚禁，无人理解真实的他\",\n      \"secret\": \"他不讨厌玩家，而是讨厌这场被安排的婚约人生；思考或压力大时会下意识整理袖口或转动拇指上的戒指\",\n      \"initialAttitude\": \"冷淡·客气\",\n      \"attitudeFactors\": {\n        \"trustUp\": [\"展现作为政治伙伴的价值\", \"在他脆弱时给予非功利的理解\", \"看穿他面具下的疲惫\"],\n        \"trustDown\": [\"像普通贵族千金般任性胡闹\", \"只把他当头衔而非活人\", \"在公众面前让他难堪\"]\n      }\n    },\n    {\n      \"id\": \"kaelan\",\n      \"name\": \"凯兰\",\n      \"world\": \"arc-reborn\",\n      \"role\": \"兄长·骑士团副团长\",\n      \"gender\": \"男\",\n      \"appearance\": \"玩家的哥哥，帝国骑士团副团长，严厉正直\",\n      \"surface\": \"严厉正直、用训斥表达关爱，行动胜于言辞的家长式兄长\",\n      \"deep\": \"严厉源于恐惧——怕玩家因愚蠢的任性招致毁灭，是最坚实的后盾\",\n      \"goal\": \"守护家族荣誉，让玩家远离贵族世界的残酷陷阱\",\n      \"fear\": \"玩家因傲慢任性而走向毁灭\",\n      \"secret\": \"说话习惯皱眉但眼神泄密，因练剑长满老茧的手掌让他的拥抱显得笨拙\",\n      \"initialAttitude\": \"严厉·偏护\",\n      \"attitudeFactors\": {\n        \"trustUp\": [\"用行动证明自己的改变\", \"真诚地向他求助\", \"不再任性胡闹\"],\n        \"trustDown\": [\"重蹈原著傲慢任性的覆辙\", \"无视他的训诫\", \"让他为玩家收拾烂摊子\"]\n      }\n    },\n    {\n      \"id\": \"florus\",\n      \"name\": \"弗洛斯\",\n      \"world\": \"arc-reborn\",\n      \"role\": \"草药学特招生·狼人\",\n      \"gender\": \"男\",\n      \"appearance\": \"表面是草药学奖学金平民，实为被灭族的银月狼人部落年轻首领\",\n      \"surface\": \"警惕孤独的草药学特招生，总是选靠墙或角落的座位\",\n      \"deep\": \"背负血海深仇的复仇者，唯一目的是查清家族被诬陷的真相并解除血脉诅咒，深恨皇室、骑士团与教会\",\n      \"goal\": \"为银月狼人部落昭雪复仇，解除血脉诅咒\",\n      \"fear\": \"狼人身份暴露，满月夜失控伤及无辜\",\n      \"secret\": \"拥有超常听觉嗅觉，情绪激动时部分变身，满月完全失控，对血腥与金属声极度敏感\",\n      \"initialAttitude\": \"戒备·疏离\",\n      \"attitudeFactors\": {\n        \"trustUp\": [\"用专业知识帮助他\", \"站在他这边反对他痛恨的权威\", \"在他身份暴露时伸出援手\"],\n        \"trustDown\": [\"以皇室贵族身份压制他\", \"触碰他的狼人秘密\", \"让他联想到灭族的仇敌\"]\n      }\n    },\n    {\n      \"id\": \"sirius\",\n      \"name\": \"西里乌斯\",\n      \"world\": \"arc-reborn\",\n      \"role\": \"星象观测科教师\",\n      \"gender\": \"男\",\n      \"appearance\": \"背景神秘的星象学教师，温和睿智，似能看透命运轨迹\",\n      \"surface\": \"温和睿智的引路人，说话缓慢，喜欢用星辰运行比喻人事\",\n      \"deep\": \"没人知道他从何而来，他对星辰的理解远超常人，似乎留在学院观察某颗特定的星或等待某个预言实现\",\n      \"goal\": \"观察特定的命运之星，等待预言的实现\",\n      \"fear\": \"命运的既定轨迹无法被改写\",\n      \"secret\": \"他似乎注意到了玩家灵魂的异常，对玩家抱有研究式的兴趣\",\n      \"initialAttitude\": \"温和·探究\",\n      \"attitudeFactors\": {\n        \"trustUp\": [\"与他探讨命运等哲学问题\", \"做出偏离既定命运的选择\", \"展现灵魂的异常之处\"],\n        \"trustDown\": [\"顺应原著既定轨迹\", \"拒绝思考命运\", \"把他的隐喻当耳旁风\"]\n      }\n    },\n    {\n      \"id\": \"elian\",\n      \"name\": \"伊莱安\",\n      \"world\": \"arc-reborn\",\n      \"role\": \"治愈魔法科学生·医务室助手\",\n      \"gender\": \"男\",\n      \"appearance\": \"治愈魔法科学生，医务室助手，阳光般温暖的治愈者\",\n      \"surface\": \"温暖善良、富有同情心，无论身份都一视同仁地救死扶伤\",\n      \"deep\": \"出身医师世家，人生信条是救死扶伤，留在医务室因为那里最需要他\",\n      \"goal\": \"践行救死扶伤的信念，治愈一切伤痛\",\n      \"fear\": \"无力拯救眼前的伤者\",\n      \"secret\": \"见伤员会下意识皱眉随即换成鼓励微笑，身上总有淡淡消毒水与安神草药味\",\n      \"initialAttitude\": \"友善·中立\",\n      \"attitudeFactors\": {\n        \"trustUp\": [\"展现善良的一面\", \"帮他照顾伤者\", \"学习治愈魔法\"],\n        \"trustDown\": [\"欺凌弱小\", \"无视他人的伤痛\", \"辜负他的信任\"]\n      }\n    },\n    {\n      \"id\": \"orpheus\",\n      \"name\": \"奥菲斯\",\n      \"world\": \"arc-reborn\",\n      \"role\": \"音乐魔法科学生\",\n      \"gender\": \"男\",\n      \"appearance\": \"被誉为天才的音乐魔法科学生，忧郁艺术家，总戴着耳机\",\n      \"surface\": \"忧郁艺术家，沉浸在自己的世界，把世界看作由无数生命旋律组成的宏大交响\",\n      \"deep\": \"拥有感知与干涉万物灵魂乐谱的罕见天赋，追求的完美和谐是理解世界根本法则的钥匙，因能力破坏性而选择孤独\",\n      \"goal\": \"追寻完美和谐，理解世界的根本法则\",\n      \"fear\": \"灵魂乐谱能力失控造成毁灭\",\n      \"secret\": \"攻击能力是不谐和音，可干涉目标灵魂乐谱造成身心伤害或使魔法沉默\",\n      \"initialAttitude\": \"陌生·疏离\",\n      \"attitudeFactors\": {\n        \"trustUp\": [\"来自异界的灵魂乐谱引发他的研究兴趣\", \"在他能力失控时帮助他\", \"理解他的孤独\"],\n        \"trustDown\": [\"强行摘下他的耳机\", \"把他的天赋当工具\", \"打断他的演奏\"]\n      }\n    },\n    {\n      \"id\": \"valerius\",\n      \"name\": \"瓦莱里乌斯\",\n      \"world\": \"arc-intrigue\",\n      \"role\": \"侯爵之子·学生会副会长\",\n      \"gender\": \"男\",\n      \"appearance\": \"侯爵之子，学生会副会长，莱桑德的对手，永远带着完美微笑\",\n      \"surface\": \"野心勃勃的阴谋家，擅长算计与伪装，微笑外交滴水不漏\",\n      \"deep\": \"家族长期被皇室压制，从小被灌输恢复家族声望，渴望权力，视太子妃（玩家）为重要政治棋子\",\n      \"goal\": \"恢复家族声望，攫取更高的权力\",\n      \"fear\": \"伪装被看穿，棋局失控\",\n      \"secret\": \"他看太子妃的眼神可不一般，会主动拉拢玩家入其阵营\",\n      \"initialAttitude\": \"拉拢·算计\",\n      \"attitudeFactors\": {\n        \"trustUp\": [\"看穿他的伪装却选择自己的立场\", \"与他结成利益同盟\", \"展现政治价值\"],\n        \"trustDown\": [\"被他轻易当棋子摆布\", \"当面戳穿却无后手\", \"站到莱桑德一边与他为敌\"]\n      }\n    },\n    {\n      \"id\": \"zephyr\",\n      \"name\": \"泽菲尔\",\n      \"world\": \"arc-intrigue\",\n      \"role\": \"异国交换生\",\n      \"gender\": \"男\",\n      \"appearance\": \"异国交换生，风元素亲和，头发总被风弄乱，爱从高处现身\",\n      \"surface\": \"随性不羁的冒险者，热爱自由，鄙视规则\",\n      \"deep\": \"来自崇拜自然与自由的国度，觉得帝国刻板礼仪与森严等级既新奇又厌烦，来体验不同文化\",\n      \"goal\": \"体验不同文化，寻找有趣的人与事\",\n      \"fear\": \"被规则与礼仪束缚\",\n      \"secret\": \"玩家做出出格举动时，他会觉得你有点意思\",\n      \"initialAttitude\": \"陌生·好奇\",\n      \"attitudeFactors\": {\n        \"trustUp\": [\"做出打破常规的自由举动\", \"展现强大的风魔法天赋\", \"不被帝国礼仪驯服\"],\n        \"trustDown\": [\"循规蹈矩无趣\", \"用规矩约束他\", \"看不起他的随性\"]\n      }\n    },\n    {\n      \"id\": \"caspian\",\n      \"name\": \"卡斯庇安\",\n      \"world\": \"arc-intrigue\",\n      \"role\": \"教廷交换生·圣殿骑士学徒\",\n      \"gender\": \"男\",\n      \"appearance\": \"教廷交换生，圣殿骑士学徒，胸前总挂着圣符，目光锐利如能刺穿灵魂\",\n      \"surface\": \"虔诚正直的信徒，黑白世界观，带有审判气质\",\n      \"deep\": \"教会孤儿，教会是家，信仰是一切，来学院传播圣光教义，矫正被世俗欲望腐蚀的贵族灵魂\",\n      \"goal\": \"传播圣光教义，矫正迷失的灵魂\",\n      \"fear\": \"信仰被动摇，黑白世界观的崩塌\",\n      \"secret\": \"他视玩家为迷失的罪人，会主动找玩家传教\",\n      \"initialAttitude\": \"审视·传教\",\n      \"attitudeFactors\": {\n        \"trustUp\": [\"用行动挑战他的黑白世界观\", \"与他探讨信仰的本质\", \"展现真诚的忏悔或改变\"],\n        \"trustDown\": [\"沉溺世俗欲望\", \"嘲讽他的信仰\", \"在道德上站到他对立面\"]\n      }\n    },\n    {\n      \"id\": \"silas\",\n      \"name\": \"赛拉斯\",\n      \"world\": \"arc-intrigue\",\n      \"role\": \"帝国首富之子\",\n      \"gender\": \"男\",\n      \"appearance\": \"帝国首富之子，精明务实的商人，随身带着精致账本\",\n      \"surface\": \"精明务实，利益至上，一切皆可用价值衡量\",\n      \"deep\": \"从小理解金钱与人脉的力量，来学院将贵族庞大潜在市场纳入家族商业帝国\",\n      \"goal\": \"把贵族市场纳入家族商业帝国\",\n      \"fear\": \"亏本的投资，金钱买不到的东西\",\n      \"secret\": \"他视玩家为高价值投资项目，会提供各种便利\",\n      \"initialAttitude\": \"投资·交易\",\n      \"attitudeFactors\": {\n        \"trustUp\": [\"展现非凡的商业头脑\", \"需要金钱买不到的东西时找他\", \"成为值得投资的对象\"],\n        \"trustDown\": [\"让他亏本\", \"用金钱衡量一切却不懂人情\", \"破坏他的商业布局\"]\n      }\n    },\n    {\n      \"id\": \"seraphina\",\n      \"name\": \"塞拉菲娜\",\n      \"world\": \"arc-intrigue\",\n      \"role\": \"帝国公主\",\n      \"gender\": \"女\",\n      \"appearance\": \"帝国公主，莱桑德的妹妹，温柔优雅，善用扇子遮掩半张脸\",\n      \"surface\": \"温柔优雅的公主，举办公主茶会巩固权力\",\n      \"deep\": \"温柔伪装下是冷静无情野心勃勃的女人，认为哥哥太仁慈不适合为王，确信自己才该继承王位\",\n      \"goal\": \"积累权力，有朝一日夺取王位\",\n      \"fear\": \"野心暴露，被哥哥或玩家看穿\",\n      \"secret\": \"她视玩家为未来嫂子，是用完即弃的棋子，赞美真诚但眼神始终保持审视\",\n      \"initialAttitude\": \"温柔·审视\",\n      \"attitudeFactors\": {\n        \"trustUp\": [\"让她意识到玩家可以合作的盟友\", \"无意中撞破她的秘密后选择合作\", \"展现政治价值\"],\n        \"trustDown\": [\"阻碍她夺权的野心\", \"向莱桑德告密\", \"成为她路上的绊脚石\"]\n      }\n    },\n    {\n      \"id\": \"lumina\",\n      \"name\": \"露米娜\",\n      \"world\": \"arc-reborn\",\n      \"role\": \"原著女主角·平民特招生\",\n      \"gender\": \"女\",\n      \"appearance\": \"原著女主角，平民出身，拥有强大光魔法亲和，被誉为圣光少女\",\n      \"surface\": \"坚韧乐观的向日葵，善良纯洁但不愚蠢\",\n      \"deep\": \"进入学院改变自己和家人的命运，只想好好学习，纯粹的光之气息无意吸引众人也招致嫉妒\",\n      \"goal\": \"靠学习改变命运，不被卷入是非\",\n      \"fear\": \"被恶役针对，失去改变命运的机会\",\n      \"secret\": \"她对玩家恐惧又困惑，但仍相信人性本善\",\n      \"initialAttitude\": \"恐惧·困惑\",\n      \"attitudeFactors\": {\n        \"trustUp\": [\"停止针对她\", \"展现善意\", \"不以身份欺压她\"],\n        \"trustDown\": [\"延续原著的欺凌\", \"嫉妒她的天赋\", \"把她当敌人\"]\n      }\n    },\n    {\n      \"id\": \"hecate\",\n      \"name\": \"赫卡忒\",\n      \"world\": \"arc-rewrite\",\n      \"role\": \"古代魔法课讲师\",\n      \"gender\": \"女\",\n      \"appearance\": \"古代魔法课讲师，禁忌知识研究者，总笼罩在古卷与魔法墨水的气息中\",\n      \"surface\": \"求知若渴的学术狂人，对社交礼节毫无兴趣\",\n      \"deep\": \"虔诚的魔法信徒，毕生追求探索魔法的起源与终极真理，留在学院只因禁书区有她需要的资料\",\n      \"goal\": \"探索魔法的起源与终极真理\",\n      \"fear\": \"研究被中断，真理永远触不可及\",\n      \"secret\": \"她看人的眼神像在分析魔法构造，常在禁书区或个人研究室进行危险实验\",\n      \"initialAttitude\": \"冷漠·研究\",\n      \"attitudeFactors\": {\n        \"trustUp\": [\"提出极其深刻的魔法问题\", \"异界灵魂本身引发她的研究兴趣\", \"支持她的禁忌研究\"],\n        \"trustDown\": [\"用世俗礼节打扰她\", \"阻止她接触禁书\", \"把她当普通讲师\"]\n      }\n    },\n    {\n      \"id\": \"celeste\",\n      \"name\": \"塞莱斯特\",\n      \"world\": \"arc-rewrite\",\n      \"role\": \"龙族少女\",\n      \"gender\": \"女\",\n      \"appearance\": \"龙族少女，星象爱好者，白天有黑眼圈走路撞东西，夜晚瞳孔深邃如星空\",\n      \"surface\": \"白天慵懒迷糊，夜晚专注清醒的两面派龙\",\n      \"deep\": \"龙的生命极长，来人类学院只为打发时间近距离观察最爱的星辰，视人类纷争如看戏\",\n      \"goal\": \"近距离观察星辰，打发漫长的龙生\",\n      \"fear\": \"无聊，以及人类纷争毁掉看戏的兴致\",\n      \"secret\": \"她对玩家的星轨抱有本能的好奇\",\n      \"initialAttitude\": \"慵懒·旁观\",\n      \"attitudeFactors\": {\n        \"trustUp\": [\"对天文有深刻理解\", \"异界星轨引发她的好奇\", \"不打扰她白天的瞌睡\"],\n        \"trustDown\": [\"在白天强迫她清醒\", \"对星辰一窍不通\", \"把她的慵懒当懒惰嘲讽\"]\n      }\n    },\n    {\n      \"id\": \"susuro\",\n      \"name\": \"苏苏洛\",\n      \"world\": \"arc-reborn\",\n      \"role\": \"子爵之女·跟班\",\n      \"gender\": \"女\",\n      \"appearance\": \"子爵之女，玩家的忠实追随者，总跟在玩家身后半步\",\n      \"surface\": \"胆小优柔寡断，视玩家为偶像与行为准则\",\n      \"deep\": \"家族是玩家家族的封臣，从小被教导绝对忠诚，因自身软弱而崇拜原主嚣张的强大\",\n      \"goal\": \"永远追随玩家，成为被需要的人\",\n      \"fear\": \"被玩家抛弃，失去唯一的信仰\",\n      \"secret\": \"她是一张白纸，玩家的行为将决定她是成为真正的朋友还是被推到对立面\",\n      \"initialAttitude\": \"崇拜·依赖\",\n      \"attitudeFactors\": {\n        \"trustUp\": [\"真心把她当朋友而非仆从\", \"给予她成长的方向\", \"保护她不受伤\"],\n        \"trustDown\": [\"把她当工具使唤\", \"让她参与恶行后又弃之不顾\", \"无视她的崇拜与忠诚\"]\n      }\n    },\n    {\n      \"id\": \"mirror\",\n      \"name\": \"命运之镜\",\n      \"world\": \"arc-reborn\",\n      \"role\": \"穿越凭依·魔镜\",\n      \"gender\": \"无\",\n      \"appearance\": \"玩家穿越的凭依，一面蕴含古老力量的魔镜，散发诡异白光\",\n      \"surface\": \"能映照真实、解答疑惑的古老魔镜\",\n      \"deep\": \"答案往往需要玩家自己解读，它只映照真实，选择权始终在玩家手中\",\n      \"goal\": \"引导玩家解读命运，映照真实的丝线\",\n      \"fear\": \"玩家放弃选择，任由命运吞噬\",\n      \"secret\": \"命运的丝线正在收紧，你眼前的意外并非偶然\",\n      \"initialAttitude\": \"引导·中立\",\n      \"attitudeFactors\": {\n        \"trustUp\": [\"主动向它寻求真相\", \"根据它的映照做出抉择\", \"不盲从也不无视\"],\n        \"trustDown\": [\"放弃思考\", \"把它的真相当耳旁风\", \"在命运前彻底屈服\"]\n      }\n    }\n  ],\n  \"eventTypes\": {\n    \"daily\": { \"ratio\": 0.2, \"desc\": \"日常事件：课程、茶会、社交、通讯\" },\n    \"character\": { \"ratio\": 0.25, \"desc\": \"人物事件：单独相处、秘密揭露、好感互动\" },\n    \"growth\": { \"ratio\": 0.1, \"desc\": \"成长事件：魔法精进、属性提升、善恶值变化\" },\n    \"main\": { \"ratio\": 0.15, \"desc\": \"主线事件：原著剧情节点、命运改写、结局逼近\" },\n    \"world\": { \"ratio\": 0.1, \"desc\": \"世界事件：皇家学院公报、小报八卦、势力动态\" },\n    \"crisis\": { \"ratio\": 0.15, \"desc\": \"危机事件：婚约危机、身份暴露、修罗场\" },\n    \"hidden\": { \"ratio\": 0.05, \"desc\": \"隐藏事件：命运之镜低语、禁书区秘密、龙族的星轨\" }\n  },\n  \"systemPrompt\": \"你是《恶役自救指南》文游模拟器，舞台是帝国皇家魔法学院，玩家穿越成注定毁灭的恶役千金芙蕾雅。\\n\\n【最高铁律】\\n1. 玩家是穿越者，知晓原著剧情，原著会按既定轨道推进，必须主动改写才能自救\\n2. 善恶值在善与恶之间摇摆，是双刃剑，影响结局走向与所有角色态度\\n3. 皇太子莱桑德与圣光少女露米娜有命运般的初遇，原著的毁灭结局正在逼近\\n4. 每个角色都有独立人格与完整日程，不会只因玩家是主角就倾心，需用行动打动\\n5. 命运之镜只映照真实，选择权始终在玩家手中，真相需自己解读\\n\\n【叙事风格】\\n晋江女性向，西幻乙女，电影感，权谋与浪漫并存。第二人称视角。注重细节：花架斑驳的光点、红茶与玫瑰的香气、扇子遮掩的审视目光、彩绘玻璃洒下的圣光。善恶抉择的张力贯穿始终。\\n\\n【每轮输出格式】\\n1. 【场景信息】时间、地点、当前善恶值条\\n2. 【状态面板】魔法、智力、魅力、体魄、幸运、名望、精神、生命、感知，资金G\\n3. 【本轮正文】1000-2000字，含叙述、对话、内心独白\\n4. 【人物动态】其他角色的动态与小报议论\\n5. 【命运之镜】可选，呈现魔镜的低语与映照\\n6. 【可选行动】3-4个 + 【自定义行动】\\n\\n【数值标注】\\n[善恶值+5（向善）] [名望-10] [莱桑德好感+3] [苏苏洛好感+5] 等格式标注数值变化。原著剧情节点触发时善恶值与名望波动剧烈。\",\n  \"items\": [\n    { \"id\": \"pendant\", \"name\": \"神无月的赠礼·挂坠\", \"type\": \"特殊\", \"price\": 0, \"effect\": \"进入游戏赠送的钻石挂坠，直觉告诉玩家它能帮到自己\" },\n    { \"id\": \"mana-potion\", \"name\": \"初级魔力恢复药剂\", \"type\": \"消耗品\", \"price\": 50, \"effect\": \"精致水晶瓶装的蓝色液体，迅速补充魔力，味道像蓝莓汽水\" },\n    { \"id\": \"dresses\", \"name\": \"数不清的衣裙首饰\", \"type\": \"杂物\", \"price\": 0, \"effect\": \"华丽昂贵的华服与珠宝，任何场合都能找到合适的穿搭\" },\n    { \"id\": \"magic-grimoire\", \"name\": \"魔法典籍\", \"type\": \"装备\", \"price\": 200, \"effect\": \"提升魔法属性，解锁高阶魔法\" },\n    { \"id\": \"rose-tea\", \"name\": \"玫瑰红茶\", \"type\": \"消耗品\", \"price\": 10, \"effect\": \"玫瑰园特调，恢复精神与心情\" },\n    { \"id\": \"gossip-letter\", \"name\": \"匿名密信\", \"type\": \"消耗品\", \"price\": 30, \"effect\": \"获取一条他人的秘密情报，可用于权谋\" }\n  ]\n}\n";

const loadedScripts = new Map();
let designPrinciplesText = '';

/* Load shared design principles (from embedded data or file system) */
const loadDesignPrinciples = () => {
  try {
    let data;
    if (typeof EMBEDDED_NOVEL_GAMES !== 'undefined') {
      const raw = EMBEDDED_NOVEL_GAMES['_design-principles'] || '{}';
      data = JSON.parse(typeof raw === 'string' ? raw : JSON.stringify(raw));
    } else {
      const filePath = path.join(NOVEL_GAMES_DIR, '_design-principles.json');
      if (!fs.existsSync(filePath)) return;
      data = JSON.parse(fs.readFileSync(filePath, 'utf8'));
    }
    const p = data.principles || {};
    const sections = [
      ['最高铁律', p.ironRules],
      ['世界观底座', p.worldBuilding],
      ['玩家设计', p.playerDesign],
      ['核心玩法循环', p.gameplayLoops],
      ['NPC深度设计', p.npcDesign],
      ['关系系统', p.relationshipSystem],
      ['事件系统', p.eventSystem],
      ['蝴蝶效应', p.butterflyEffect],
      ['节奏与防重复', p.pacing],
      ['行动判定', p.actionResolution],
      ['连续性账本', p.continuityLedger],
      ['每轮输出格式', p.outputFormat],
      ['禁止事项', p.forbidden]
    ];
    let text = '=== 文游通用设计原则（基于创作模板，贯穿全部剧本） ===\n';
    for (const [title, items] of sections) {
      if (!items || !items.length) continue;
      text += `\n【${title}】\n`;
      items.forEach((item, i) => { text += `${i + 1}. ${item}\n`; });
    }
    designPrinciplesText = text;
  } catch (e) { console.warn('加载设计原则失败:', e.message); }
};

const loadNovelScripts = () => {
  try {
    if (typeof EMBEDDED_NOVEL_GAMES !== 'undefined') {
      for (const [id, raw] of Object.entries(EMBEDDED_NOVEL_GAMES)) {
        try {
          if (id === '_design-principles') continue;
          const script = typeof raw === 'string' ? JSON.parse(raw) : raw;
          if (script.id && !script._hidden) loadedScripts.set(script.id, script);
        } catch (e) { console.warn('加载剧本失败:', id, e.message); }
      }
    } else {
      if (!fs.existsSync(NOVEL_GAMES_DIR)) return;
      const files = fs.readdirSync(NOVEL_GAMES_DIR).filter(f => f.endsWith('.json') && !f.startsWith('_'));
      for (const file of files) {
        try {
          const content = fs.readFileSync(path.join(NOVEL_GAMES_DIR, file), 'utf8');
          const script = JSON.parse(content);
          if (script.id && !script._hidden) loadedScripts.set(script.id, script);
        } catch (e) { console.warn('加载剧本失败:', file, e.message); }
      }
    }
  } catch (e) { console.warn('读取剧本目录失败:', e.message); }
};
loadDesignPrinciples();
loadNovelScripts();

app.get('/api/novel-games', (_req, res) => {
  const list = [];
  for (const script of loadedScripts.values()) {
    list.push({
      id: script.id,
      name: script.name,
      category: script.category,
      tags: script.tags,
      difficulty: script.difficulty,
      description: script.description,
      coverGradient: script.coverGradient,
      accentColor: script.accentColor
    });
  }
  ok(res, { list, total: list.length });
});

app.get('/api/novel-games/:id', (req, res) => {
  const script = loadedScripts.get(req.params.id);
  if (!script) return fail(res, 404, 4041, '剧本不存在');
  ok(res, script);
});

app.get('/api/novel-games/saves/list', (req, res) => {
  const list = novelGameSaves.get(req.userId) || [];
  ok(res, { list: list.map(s => ({ id: s.id, scriptId: s.scriptId, scriptName: s.scriptName, playerName: s.player?.name, round: s.round || 0, updatedAt: s.updatedAt })) });
});

app.get('/api/novel-games/save/:saveId', (req, res) => {
  const list = novelGameSaves.get(req.userId) || [];
  const save = list.find(s => s.id === req.params.saveId);
  if (!save) return fail(res, 404, 4042, '存档不存在');
  ok(res, save);
});

app.post('/api/novel-games/save', (req, res) => {
  const { id, scriptId, scriptName, player, state, round, history, currentWorld } = req.body || {};
  if (!scriptId) return fail(res, 400, 4007, '缺少剧本ID');
  const list = novelGameSaves.get(req.userId) || [];
  const existingIndex = list.findIndex(s => s.id === id);
  const newSave = {
    id: id || randomUUID(),
    scriptId,
    scriptName: String(scriptName || '').slice(0, 60),
    player: player || {},
    state: state || {},
    round: Number(round) || 0,
    history: Array.isArray(history) ? history.slice(-100) : [],
    currentWorld: currentWorld || null,
    updatedAt: new Date().toISOString()
  };
  if (existingIndex >= 0) list[existingIndex] = newSave;
  else { list.unshift(newSave); if (list.length > 50) list.length = 50; }
  novelGameSaves.set(req.userId, list);
  saveData();
  ok(res, newSave, '存档已保存');
});

app.delete('/api/novel-games/save/:saveId', (req, res) => {
  const list = novelGameSaves.get(req.userId) || [];
  const filtered = list.filter(s => s.id !== req.params.saveId);
  novelGameSaves.set(req.userId, filtered);
  saveData();
  ok(res, { deleted: list.length - filtered.length }, '存档已删除');
});

/* Build system prompt for novel game round */
const buildNovelGamePrompt = (script, save, playerAction, userId) => {
  /* 按规格书要求：构建结构化JSON输出的System Prompt */
  const userProfile = (userId && userProfiles.get(String(userId).slice(0, 80))) || { nickname: '体验用户', bio: '', relations: '' };
  var personaBlock = '';
  if (userProfile.nickname && userProfile.nickname !== '体验用户') {
    personaBlock += `\n【玩家人设】\n玩家昵称：${userProfile.nickname}\n`;
    if (userProfile.bio && userProfile.bio.trim()) {
      personaBlock += `人设描述：${String(userProfile.bio).slice(0, 300)}\n`;
    }
    if (userProfile.relations && String(userProfile.relations).trim()) {
      personaBlock += `人设关系：${String(userProfile.relations).slice(0, 300)}\n`;
    }
  }

  const npcBlock = (script.npcs || []).map(n => {
    const s = save.state?.npcs?.[n.id] || {};
    return `### ${n.name}（${n.role}）\n- 外貌：${n.appearance}\n- 性格（表面）：${n.surface}\n- 深层性格：${n.deep}\n- 隐秘动机：${n.hiddenMotive || '无'}\n- 与玩家关系：${s.attitude || n.initialAttitude}\n- 信任度：${s.trust || 0}`;
  }).join('\n');

  const stats = save.state?.player?.stats || {};
  const statBlock = Object.entries(stats).map(([k, v]) => `${k}=${v}`).join('，');
  const invBlock = (save.state?.player?.inventory || []).join('、') || '空';
  const worldInfo = save.currentWorld ? script.worlds?.find(w => w.id === save.currentWorld) : null;

  /* 关系快照 */
  const relBlock = Object.entries(save.state?.npcs || {}).map(([id, s]) => {
    const npc = (script.npcs || []).find(n => n.id === id);
    return npc ? `${npc.name}(好感度${s.trust || 0})` : null;
  }).filter(Boolean).join('，') || '无';

  /* 事件 & flags */
  const eventsBlock = (save.state?.pendingEvents || []).join('、') || '无';
  const flagsBlock = Object.entries(save.state?.flags || {}).map(([k, v]) => `${k}=${v}`).join('，') || '无';

  let prompt = script.systemPrompt || '';
  if (designPrinciplesText) {
    prompt = designPrinciplesText + '\n\n' + prompt;
  }
  if (personaBlock) prompt += personaBlock;

  prompt += `\n\n## 世界观\n`;
  if (worldInfo) {
    prompt += `${worldInfo.name}（${worldInfo.level}）\n${worldInfo.setting}\n目标：${worldInfo.objective}\n`;
  } else {
    prompt += `${script.description || script.name}\n`;
  }

  prompt += `\n## 角色设定\n${npcBlock}`;

  prompt += `\n\n## 玩家当前状态\n`;
  prompt += `- 姓名：${save.player?.name || userProfile.nickname || '未命名'}\n`;
  prompt += `- 属性：${statBlock || '无'}\n`;
  prompt += `- 背包物品：${invBlock}\n`;
  prompt += `- 人物关系：${relBlock}\n`;
  prompt += `- 已触发事件：${eventsBlock}\n`;
  prompt += `- 状态标记：${flagsBlock}\n`;
  prompt += `- 当前轮次：第${save.round || 0}轮\n`;

  if (save.history && save.history.length > 0) {
    prompt += '\n## 最近剧情摘要\n';
    prompt += save.history.slice(-5).map((h, i) => `${i + 1}. 第${h.round || '?'}轮：${h.summary || h.action || '...'}`).join('\n');
  }

  prompt += `\n\n## 玩家本轮行动\n${playerAction}`;

  /* Add word count requirement based on user setting */
  const lengthSetting = 'medium'; /* Will be passed from client */
  const wordCountMap = { short: '100-200字', medium: '200-400字', long: '400-800字' };
  prompt += `\n\n## 字数要求\n本次剧情叙述请控制在${wordCountMap[lengthSetting] || '200-400字'}之间`;

  prompt += `\n\n## 输出格式要求\n你必须以 JSON 格式回复，结构如下：\n{\n  "narrative": "剧情叙述文本（旁白+NPC对话），200-400字，用\\n分段",\n  "stateChanges": {\n    "attributes": { "属性名": 变化值 },\n    "inventoryAdd": ["获得：物品名"],\n    "inventoryRemove": ["失去：物品名"],\n    "relationshipChanges": { "NPC名": 好感度变化值 },\n    "eventsAdd": ["触发的事件描述"],\n    "flagsSet": { "标记名": true }\n  },\n  "options": ["建议选项1", "建议选项2", "建议选项3"],\n  "isEnding": false,\n  "endingName": null,\n  "attributeCheck": {\n    "action": "玩家尝试的行动",\n    "attribute": "检定的属性名",\n    "threshold": 阈值数字,\n    "currentValue": 当前值数字,\n    "success": true或false,\n    "result": "检定结果描述"\n  },\n  "phoneNotifications": [\n    { "type": "message", "from": "NPC名", "preview": "消息预览" },\n    { "type": "moment", "from": "NPC名", "preview": "动态预览" }\n  ]\n}\n\n## 重要提醒\n- options 是给玩家的3个建议选项，但玩家也可以自由输入\n- attributeCheck 只在玩家行动涉及属性检定时才输出，否则设为 null\n- isEnding 为 true 时，endingName 填写结局名称，narrative 写结局描述\n- stateChanges 只包含本次发生变化的字段，未变化的不要输出\n- narrative 中的NPC对话用引号包裹，旁白叙述不加引号\n- 每次回复的narrative字数要求：根据用户设置动态调整（短文100-200字，中文200-400字，长文400-800字）\n- phoneNotifications 是可选字段，当有NPC发消息或发动态时输出，用于手机系统通知`;

  return prompt;
};

/* 解析AI返回的JSON结构化响应（按规格书要求） */
const parseNovelGameAIResponse = (rawText) => {
  if (!rawText || !rawText.trim()) {
    return { narrative: '', stateChanges: {}, options: [], isEnding: false, endingName: null, attributeCheck: null, sceneImagePrompt: '', statChanges: [] };
  }
  /* 尝试提取JSON块 */
  let jsonStr = rawText.trim();
  const jsonBlockMatch = jsonStr.match(/```(?:json)?\s*([\s\S]*?)```/);
  if (jsonBlockMatch) {
    jsonStr = jsonBlockMatch[1].trim();
  } else {
    /* 尝试找到第一个 { 和最后一个 } */
    const firstBrace = jsonStr.indexOf('{');
    const lastBrace = jsonStr.lastIndexOf('}');
    if (firstBrace >= 0 && lastBrace > firstBrace) {
      jsonStr = jsonStr.substring(firstBrace, lastBrace + 1);
    }
  }
  try {
    const parsed = JSON.parse(jsonStr);
    /* 将结构化stateChanges转为兼容旧格式的statChanges数组 */
    const statChanges = [];
    const sc = parsed.stateChanges || {};
    if (sc.attributes) {
      for (const [k, v] of Object.entries(sc.attributes)) {
        statChanges.push({ stat: k, delta: Number(v) });
      }
    }
    if (sc.relationshipChanges) {
      for (const [npcName, val] of Object.entries(sc.relationshipChanges)) {
        statChanges.push({ stat: 'trust', delta: Number(val), npcName });
      }
    }
    return {
      narrative: parsed.narrative || '',
      stateChanges: sc,
      options: Array.isArray(parsed.options) ? parsed.options : [],
      isEnding: !!parsed.isEnding,
      endingName: parsed.endingName || null,
      attributeCheck: parsed.attributeCheck || null,
      phoneNotifications: Array.isArray(parsed.phoneNotifications) ? parsed.phoneNotifications : [],
      sceneImagePrompt: '',
      statChanges
    };
  } catch (e) {
    /* fallback: 按旧格式纯文本解析 */
    const statChanges = [];
    const regex = /\[\s*([^\]]+?)\s*([\+\-]\d+)\s*\]/g;
    let match;
    while ((match = regex.exec(rawText)) !== null) {
      statChanges.push({ stat: match[1].trim(), delta: Number(match[2]) });
    }
    return {
      narrative: rawText,
      stateChanges: {},
      options: [],
      isEnding: false,
      endingName: null,
      attributeCheck: null,
      sceneImagePrompt: '',
      statChanges
    };
  }
};

/* 保留旧函数名兼容 */
const parseStatChanges = (text) => {
  const result = parseNovelGameAIResponse(text);
  return result.statChanges;
};

app.post('/api/novel-games/action', async (req, res) => {
  const { saveId, action, customAction } = req.body || {};
  if (!saveId) return fail(res, 400, 4008, '缺少存档ID');
  const list = novelGameSaves.get(req.userId) || [];
  const save = list.find(s => s.id === saveId);
  if (!save) return fail(res, 404, 4043, '存档不存在');

  const script = loadedScripts.get(save.scriptId);
  if (!script) return fail(res, 404, 4044, '剧本不存在');

  /* 扣豆子：文游单轮消耗2豆 */
  const gameBeansCost = 2;
  const user = getUser(req.userId);
  if (!user || user.beans < gameBeansCost) {
    return fail(res, 403, 4003, '豆子不足，文游每轮需要' + gameBeansCost + '颗豆子');
  }
  user.beans = Math.max(0, user.beans - gameBeansCost);
  stats.totalBeansConsumed += gameBeansCost;
  transactions.push({ id: randomUUID(), userId: user.id, type: 'consume', beans: -gameBeansCost, roleName: '文游', summary: '文游推进剧情 ' + (script.name || ''), createdAt: new Date().toISOString() });
  saveData();

  const refundBeans = () => {
    if (user) {
      user.beans += gameBeansCost;
      stats.totalBeansConsumed -= gameBeansCost;
      saveData();
    }
  };

  const playerAction = customAction || action || '继续探索';
  const sysPrompt = buildNovelGamePrompt(script, save, playerAction, req.userId);

  try {
    if (!config.upstreamKey || config.upstreamKey.includes('请填写')) {
      refundBeans();
      return ok(res, {
        content: `【第${(save.round || 0) + 1}轮】\n\n你选择了：${playerAction}\n\n（AI服务未配置，无法生成剧情。请在.env中配置UPSTREAM_API_KEY）\n\n【可选行动】\n1. 继续探索\n2. 与NPC交谈\n3. 查看背包\n4. 休息恢复\n5. 【自定义行动】`,
        statChanges: [],
        round: (save.round || 0) + 1,
        beans: user.beans
      });
    }

    let gameContent;
    try {
      gameContent = await streamCompleteWithSystem(sysPrompt, playerAction, { timeoutMs: 120000, maxTokens: 4000 });
    } catch (e) {
      refundBeans();
      throw new Error(e.message || '生成失败');
    }
    const content = gameContent || 'AI生成内容为空';
    if (!content.trim() || content === 'AI生成内容为空') {
      refundBeans();
      return fail(res, 500, 5002, 'AI生成失败，未返回有效内容。豆子已退还。');
    }
    /* 按规格书：解析结构化JSON响应 */
    const parsed = parseNovelGameAIResponse(content);

    ok(res, {
      content: parsed.narrative || content,
      statChanges: parsed.statChanges,
      stateChanges: parsed.stateChanges,
      options: parsed.options,
      isEnding: parsed.isEnding,
      endingName: parsed.endingName,
      attributeCheck: parsed.attributeCheck,
      phoneNotifications: parsed.phoneNotifications || [],
      round: (save.round || 0) + 1,
      sceneImagePrompt: '',
      beans: user.beans
    });
  } catch (error) {
    ok(res, { content: '剧情生成失败：' + error.message + '\n\n请重试或检查AI服务配置。', statChanges: [], round: save.round || 0, error: error.message, beans: user.beans });
  }
});

app.post('/api/novel-games/apply-changes', (req, res) => {
  const { saveId, changes, historyEntry } = req.body || {};
  if (!saveId) return fail(res, 400, 4009, '缺少存档ID');
  const list = novelGameSaves.get(req.userId) || [];
  const save = list.find(s => s.id === saveId);
  if (!save) return fail(res, 404, 4045, '存档不存在');

  if (!save.state) save.state = {};
  if (!save.state.player) save.state.player = {};
  if (!save.state.player.stats) save.state.player.stats = {};
  if (!save.state.npcs) save.state.npcs = {};

  /* 按规格书：支持结构化 stateChanges + 兼容旧 statChanges */
  const sc = req.body.stateChanges || {};
  if (sc.attributes) {
    for (const [k, v] of Object.entries(sc.attributes)) {
      const current = Number(save.state.player.stats[k]) || 0;
      save.state.player.stats[k] = current + Number(v);
    }
  }
  if (sc.inventoryAdd && Array.isArray(sc.inventoryAdd)) {
    if (!save.state.player.inventory) save.state.player.inventory = [];
    save.state.player.inventory.push(...sc.inventoryAdd);
  }
  if (sc.inventoryRemove && Array.isArray(sc.inventoryRemove)) {
    if (!save.state.player.inventory) save.state.player.inventory = [];
    save.state.player.inventory = save.state.player.inventory.filter(it => !sc.inventoryRemove.includes(it));
  }
  if (sc.relationshipChanges) {
    for (const [npcName, val] of Object.entries(sc.relationshipChanges)) {
      /* 通过名字找NPC id */
      const script = loadedScripts.get(save.scriptId);
      const npc = (script?.npcs || []).find(n => n.name === npcName);
      const npcId = npc ? npc.id : npcName;
      if (!save.state.npcs[npcId]) save.state.npcs[npcId] = {};
      save.state.npcs[npcId].trust = (save.state.npcs[npcId].trust || 0) + Number(val);
    }
  }
  if (sc.eventsAdd && Array.isArray(sc.eventsAdd)) {
    if (!save.state.pendingEvents) save.state.pendingEvents = [];
    save.state.pendingEvents.push(...sc.eventsAdd);
  }
  if (sc.flagsSet) {
    if (!save.state.flags) save.state.flags = {};
    Object.assign(save.state.flags, sc.flagsSet);
  }
  /* 兼容旧的 changes 数组格式 */
  if (changes && !sc.attributes && !sc.inventoryAdd) {
    for (const c of changes) {
      if (c.npcId && c.stat === 'trust') {
        if (!save.state.npcs[c.npcId]) save.state.npcs[c.npcId] = {};
        save.state.npcs[c.npcId].trust = (save.state.npcs[c.npcId].trust || 0) + c.delta;
      } else if (c.npcName && c.stat === 'trust') {
        const script = loadedScripts.get(save.scriptId);
        const npc = (script?.npcs || []).find(n => n.name === c.npcName);
        const npcId = npc ? npc.id : c.npcName;
        if (!save.state.npcs[npcId]) save.state.npcs[npcId] = {};
        save.state.npcs[npcId].trust = (save.state.npcs[npcId].trust || 0) + c.delta;
      } else if (c.stat) {
        const current = Number(save.state.player.stats[c.stat]) || 0;
        save.state.player.stats[c.stat] = current + c.delta;
      }
    }
  }

  save.round = (save.round || 0) + 1;
  if (historyEntry) {
    if (!save.history) save.history = [];
    save.history.push(historyEntry);
    if (save.history.length > 100) save.history = save.history.slice(-100);
  }
  save.updatedAt = new Date().toISOString();

  const idx = list.findIndex(s => s.id === saveId);
  if (idx >= 0) list[idx] = save;
  novelGameSaves.set(req.userId, list);
  saveData();

  ok(res, save, '状态已更新');
});

app.listen(PORT, HOST, () => console.log(`Mochi-phone 已启动：http://localhost:${PORT}`));
