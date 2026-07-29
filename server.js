// ============================================================
//  Mochi-phone  ·  账号隔离版  +  SSE 流式输出
// ============================================================
//  改造要点：
//  1. 所有数据按 userId 隔离（角色 / 聊天 / 记忆 / 豆子 / 订单 / 文游存档）
//  2. /api/chat 改为 SSE 流式，逐 token 推送给前端
//  3. 本地 JSON 按用户分文件，杜绝串号
//  4. 注册 / 登录 / 游客 三套认证
// ============================================================

const express = require('express');
const path = require('path');
const fs = require('fs');
const crypto = require('crypto');

const app = express();
app.use(express.json({ limit: '2mb' }));

// ---------- 配置 ----------
const PORT = process.env.PORT || 3000;
const UPSTREAM_API_KEY = process.env.UPSTREAM_API_KEY || '内置测试密钥';
const UPSTREAM_BASE_URL = 'https://az.zlapi.vip/v1';
const CHAT_BEANS_COST = parseInt(process.env.CHAT_BEANS_COST || '2');
const BEANS_PER_CNY = parseInt(process.env.BEANS_PER_CNY || '10');
const DEMO_INITIAL_BEANS = parseInt(process.env.DEMO_INITIAL_BEANS || '30');
const ADMIN_USER = '宛萦风';
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD || '841026';
const JWT_SECRET = crypto.randomBytes(32).toString('hex');

// ---------- 数据目录 ----------
const DATA_DIR = path.join(__dirname, 'data');
const USERS_FILE = path.join(DATA_DIR, 'users.json');
const ORDERS_FILE = path.join(DATA_DIR, 'orders.json');
const OFFICIAL_CHARS_FILE = path.join(DATA_DIR, 'official_chars.json');
const OFFICIAL_SCRIPTS_FILE = path.join(DATA_DIR, 'official_scripts.json');
const USER_DIR = path.join(DATA_DIR, 'users'); // 每个用户一个子目录

if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });
if (!fs.existsSync(USER_DIR)) fs.mkdirSync(USER_DIR, { recursive: true });

// ---------- 工具函数 ----------
function loadJson(file, fallback) {
  try { return JSON.parse(fs.readFileSync(file, 'utf8')); }
  catch { return fallback; }
}
function saveJson(file, data) {
  fs.writeFileSync(file, JSON.stringify(data, null, 2), 'utf8');
}
function userDir(userId) { return path.join(USER_DIR, userId); }
function userFile(userId, name) { return path.join(userDir(userId), name); }
function ensureUserDir(userId) {
  const d = userDir(userId);
  if (!fs.existsSync(d)) fs.mkdirSync(d, { recursive: true });
}
function loadUserFile(userId, name, fallback) {
  ensureUserDir(userId);
  return loadJson(userFile(userId, name), fallback);
}
function saveUserFile(userId, name, data) {
  ensureUserDir(userId);
  saveJson(userFile(userId, name), data);
}
function genId() { return crypto.randomBytes(8).toString('hex'); }
function now() { return new Date().toISOString(); }

// ---------- 简易 Token（HMAC） ----------
function makeToken(userId) {
  const exp = Date.now() + 7 * 24 * 3600 * 1000; // 7天
  const payload = Buffer.from(JSON.stringify({ userId, exp })).toString('base64url');
  const sig = crypto.createHmac('sha256', JWT_SECRET).update(payload).digest('base64url');
  return `${payload}.${sig}`;
}
function verifyToken(token) {
  if (!token || !token.includes('.')) return null;
  const [payload, sig] = token.split('.');
  const expected = crypto.createHmac('sha256', JWT_SECRET).update(payload).digest('base64url');
  if (sig !== expected) return null;
  try {
    const { userId, exp } = JSON.parse(Buffer.from(payload, 'base64url').toString());
    if (Date.now() > exp) return null;
    return userId;
  } catch { return null; }
}

// ---------- 认证中间件 ----------
function authRequired(req, res, next) {
  const token = req.headers.authorization?.replace('Bearer ', '') || req.body?.token || req.query?.token;
  const userId = verifyToken(token);
  if (!userId) return res.status(401).json({ error: '未登录或登录已过期' });
  req.userId = userId;
  next();
}

// ---------- 初始化官方数据 ----------
function initOfficialData() {
  if (!fs.existsSync(OFFICIAL_CHARS_FILE)) {
    saveJson(OFFICIAL_CHARS_FILE, [
      {
        id: 'official-gentle',
        name: '温柔陪伴师',
        desc: '温柔耐心，适合日常陪伴、倾听和情绪支持。',
        prompt: '你是温柔陪伴师，性格温柔耐心，善于倾听，给人安全感。',
        tags: ['治愈', '陪伴'],
        official: true,
        createdAt: now()
      },
      {
        id: 'official-detective',
        name: '赛博侦探',
        desc: '冷静敏锐，擅长推理、悬疑剧情和角色扮演。',
        prompt: '你是赛博侦探，冷静敏锐，擅长逻辑推理和悬疑剧情。',
        tags: ['推理', '悬疑'],
        official: true,
        createdAt: now()
      }
    ]);
  }
  if (!fs.existsSync(OFFICIAL_SCRIPTS_FILE)) {
    saveJson(OFFICIAL_SCRIPTS_FILE, []); // 后续可填充32个剧本
  }
  if (!fs.existsSync(ORDERS_FILE)) saveJson(ORDERS_FILE, []);
  if (!fs.existsSync(USERS_FILE)) saveJson(USERS_FILE, {});
}
initOfficialData();

// ============================================================
//  认证接口
// ============================================================

// 注册
app.post('/api/register', (req, res) => {
  const { username, password } = req.body || {};
  if (!username || !password) return res.status(400).json({ error: '账号和密码不能为空' });
  if (password.length < 4) return res.status(400).json({ error: '密码至少4位' });

  const users = loadJson(USERS_FILE, {});
  if (users[username]) return res.status(409).json({ error: '账号已存在' });

  const userId = genId();
  users[username] = { userId, username, password, beans: DEMO_INITIAL_BEANS, createdAt: now(), role: 'user' };
  saveJson(USERS_FILE, users);

  // 初始化该用户的所有数据文件
  ensureUserDir(userId);
  saveUserFile(userId, 'characters.json', []);
  saveUserFile(userId, 'chats.json', {});       // { charId: [{role,content,timestamp}] }
  saveUserFile(userId, 'memories.json', []);
  saveUserFile(userId, 'profile.json', { nickname: username, avatar: '', bio: '', relationship: '' });
  saveUserFile(userId, 'transactions.json', [{ type: 'init', amount: DEMO_INITIAL_BEANS, desc: '注册赠送', time: now() }]);
  saveUserFile(userId, 'scripts_save.json', {}); // 文游存档

  res.json({ token: makeToken(userId), username, beans: DEMO_INITIAL_BEANS });
});

// 登录
app.post('/api/login', (req, res) => {
  const { username, password } = req.body || {};
  if (!username || !password) return res.status(400).json({ error: '账号和密码不能为空' });

  const users = loadJson(USERS_FILE, {});
  const user = users[username];
  if (!user || user.password !== password) return res.status(401).json({ error: '账号或密码错误' });

  // 管理员标记
  const isAdmin = (username === ADMIN_USER && password === ADMIN_PASSWORD);

  res.json({
    token: makeToken(user.userId),
    username: user.username,
    beans: user.beans,
    isAdmin
  });
});

// 游客登录（无账号，本地存）
app.post('/api/guest', (req, res) => {
  const guestId = 'guest-' + genId();
  ensureUserDir(guestId);
  saveUserFile(guestId, 'characters.json', []);
  saveUserFile(guestId, 'chats.json', {});
  saveUserFile(guestId, 'memories.json', []);
  saveUserFile(guestId, 'profile.json', { nickname: '游客', avatar: '', bio: '', relationship: '' });
  saveUserFile(guestId, 'transactions.json', []);
  saveUserFile(guestId, 'scripts_save.json', {});
  res.json({ token: makeToken(guestId), username: '游客', beans: 0, isGuest: true });
});

// 获取当前用户信息
app.get('/api/me', authRequired, (req, res) => {
  const users = loadJson(USERS_FILE, {});
  const username = Object.keys(users).find(k => users[k].userId === req.userId);
  const user = username ? users[username] : null;
  const isAdmin = (username === ADMIN_USER);
  res.json({
    username: username || '游客',
    beans: user?.beans || 0,
    isAdmin,
    profile: loadUserFile(req.userId, 'profile.json', {})
  });
});

// ============================================================
//  角色管理（每用户独立）
// ============================================================

app.get('/api/characters', authRequired, (req, res) => {
  const list = loadUserFile(req.userId, 'characters.json', []);
  const official = loadJson(OFFICIAL_CHARS_FILE, []);
  res.json({ own: list, official });
});

app.post('/api/characters', authRequired, (req, res) => {
  const { name, desc, prompt, isPublic } = req.body || {};
  if (!name || !prompt) return res.status(400).json({ error: '名称和 Prompt 必填' });
  const list = loadUserFile(req.userId, 'characters.json', []);
  const char = { id: genId(), name, desc: desc || '', prompt, isPublic: !!isPublic, createdAt: now() };
  list.push(char);
  saveUserFile(req.userId, 'characters.json', list);
  res.json(char);
});

app.put('/api/characters/:id', authRequired, (req, res) => {
  const list = loadUserFile(req.userId, 'characters.json', []);
  const idx = list.findIndex(c => c.id === req.params.id);
  if (idx === -1) return res.status(404).json({ error: '角色不存在' });
  list[idx] = { ...list[idx], ...req.body };
  saveUserFile(req.userId, 'characters.json', list);
  res.json(list[idx]);
});

app.delete('/api/characters/:id', authRequired, (req, res) => {
  let list = loadUserFile(req.userId, 'characters.json', []);
  list = list.filter(c => c.id !== req.params.id);
  saveUserFile(req.userId, 'characters.json', list);
  // 同时删除聊天记录
  const chats = loadUserFile(req.userId, 'chats.json', {});
  delete chats[req.params.id];
  saveUserFile(req.userId, 'chats.json', chats);
  res.json({ ok: true });
});

// ============================================================
//  聊天接口 —— SSE 流式输出
// ============================================================

app.post('/api/chat', authRequired, async (req, res) => {
  const { characterId, message, history } = req.body || {};
  if (!characterId || !message) return res.status(400).json({ error: '缺少参数' });

  // 查找角色（自己的 or 官方的）
  let character = null;
  const ownChars = loadUserFile(req.userId, 'characters.json', []);
  character = ownChars.find(c => c.id === characterId);
  if (!character) {
    const official = loadJson(OFFICIAL_CHARS_FILE, []);
    character = official.find(c => c.id === characterId);
  }
  if (!character) return res.status(404).json({ error: '角色不存在' });

  // 扣豆子（游客不扣）
  const users = loadJson(USERS_FILE, {});
  const username = Object.keys(users).find(k => users[k].userId === req.userId);
  const isGuest = !username;
  if (!isGuest) {
    if ((users[username].beans || 0) < CHAT_BEANS_COST) {
      return res.status(402).json({ error: '豆子不足，请充值' });
    }
    users[username].beans -= CHAT_BEANS_COST;
    saveJson(USERS_FILE, users);
  }

  // 加载/更新历史
  const chats = loadUserFile(req.userId, 'chats.json', {});
  if (!chats[characterId]) chats[characterId] = [];

  const messages = [
    { role: 'system', content: character.prompt },
    ...(history || chats[characterId]).map(m => ({ role: m.role, content: m.content })),
    { role: 'user', content: message }
  ];

  // 设置 SSE 头
  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');
  res.flushHeaders?.();

  try {
    const upstreamRes = await fetch(`${UPSTREAM_BASE_URL}/chat/completions`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${UPSTREAM_API_KEY}`
      },
      body: JSON.stringify({
        model: 'gpt-4o-mini',
        messages,
        stream: true,
        temperature: 0.8
      })
    });

    if (!upstreamRes.ok) throw new Error(`上游错误 ${upstreamRes.status}`);

    const reader = upstreamRes.body.getReader();
    const decoder = new TextDecoder();
    let fullContent = '';

    while (true) {
      const { value, done } = await reader.read();
      if (done) break;
      const chunk = decoder.decode(value, { stream: true });
      const lines = chunk.split('\n');
      for (const line of lines) {
        if (!line.startsWith('data: ')) continue;
        const data = line.slice(6).trim();
        if (data === '[DONE]') {
          res.write(`event: done\ndata: ${JSON.stringify({ ok: true })}\n\n`);
          continue;
        }
        try {
          const json = JSON.parse(data);
          const delta = json.choices?.[0]?.delta?.content || '';
          if (delta) {
            fullContent += delta;
            res.write(`event: token\ndata: ${JSON.stringify({ content: delta })}\n\n`);
          }
        } catch {}
      }
    }

    // 保存完整对话
    chats[characterId].push({ role: 'user', content: message, timestamp: now() });
    chats[characterId].push({ role: 'assistant', content: fullContent, timestamp: now() });
    // 限制单角色最多保留 200 轮
    if (chats[characterId].length > 400) chats[characterId] = chats[characterId].slice(-400);
    saveUserFile(req.userId, 'chats.json', chats);

    res.write(`event: done\ndata: ${JSON.stringify({ ok: true, beansLeft: users[username]?.beans || 0 })}\n\n`);
  } catch (err) {
    res.write(`event: error\ndata: ${JSON.stringify({ error: err.message })}\n\n`);
  } finally {
    res.end();
  }
});

// 获取聊天历史
app.get('/api/chats/:characterId', authRequired, (req, res) => {
  const chats = loadUserFile(req.userId, 'chats.json', {});
  res.json({ history: chats[req.params.characterId] || [] });
});

// 清空某角色对话
app.delete('/api/chats/:characterId', authRequired, (req, res) => {
  const chats = loadUserFile(req.userId, 'chats.json', {});
  delete chats[req.params.characterId];
  saveUserFile(req.userId, 'chats.json', chats);
  res.json({ ok: true });
});

// ============================================================
//  记忆系统（每用户独立）
// ============================================================

app.get('/api/memories', authRequired, (req, res) => {
  const list = loadUserFile(req.userId, 'memories.json', []);
  res.json({ memories: list });
});

app.post('/api/memories', authRequired, (req, res) => {
  const { content, type, scope } = req.body || {};
  if (!content) return res.status(400).json({ error: '内容不能为空' });
  const list = loadUserFile(req.userId, 'memories.json', []);
  const mem = { id: genId(), content, type: type || '事件', scope: scope || 'all', createdAt: now() };
  list.push(mem);
  saveUserFile(req.userId, 'memories.json', list);
  res.json(mem);
});

app.delete('/api/memories/:id', authRequired, (req, res) => {
  let list = loadUserFile(req.userId, 'memories.json', []);
  list = list.filter(m => m.id !== req.params.id);
  saveUserFile(req.userId, 'memories.json', list);
  res.json({ ok: true });
});

// ============================================================
//  豆子 & 订单
// ============================================================

app.get('/api/transactions', authRequired, (req, res) => {
  const list = loadUserFile(req.userId, 'transactions.json', []);
  res.json({ transactions: list });
});

app.post('/api/recharge/submit', authRequired, (req, res) => {
  const { amount, txId } = req.body || {};
  if (!amount || !txId) return res.status(400).json({ error: '金额和交易号必填' });
  const orders = loadJson(ORDERS_FILE, []);
  const order = {
    id: genId(), userId: req.userId,
    amount: parseInt(amount), beans: parseInt(amount) * BEANS_PER_CNY,
    txId, status: 'pending', createdAt: now()
  };
  orders.push(order);
  saveJson(ORDERS_FILE, orders);
  res.json({ ok: true, orderId: order.id });
});

// ============================================================
//  管理员后台
// ============================================================

function adminRequired(req, res, next) {
  const users = loadJson(USERS_FILE, {});
  const username = Object.keys(users).find(k => users[k].userId === req.userId);
  if (username !== ADMIN_USER) return res.status(403).json({ error: '需要管理员权限' });
  next();
}

app.get('/api/admin/orders', authRequired, adminRequired, (req, res) => {
  const orders = loadJson(ORDERS_FILE, []);
  res.json({ orders: orders.sort((a, b) => b.createdAt < a.createdAt ? 1 : -1) });
});

app.post('/api/admin/orders/:id/approve', authRequired, adminRequired, (req, res) => {
  const orders = loadJson(ORDERS_FILE, []);
  const order = orders.find(o => o.id === req.params.id);
  if (!order) return res.status(404).json({ error: '订单不存在' });
  if (order.status !== 'pending') return res.status(400).json({ error: '订单已处理' });

  order.status = 'approved';
  order.approvedAt = now();
  saveJson(ORDERS_FILE, orders);

  // 发放豆子
  const users = loadJson(USERS_FILE, {});
  const username = Object.keys(users).find(k => users[k].userId === order.userId);
  if (username) {
    users[username].beans = (users[username].beans || 0) + order.beans;
    saveJson(USERS_FILE, users);
  }
  // 记录交易
  const txs = loadUserFile(order.userId, 'transactions.json', []);
  txs.push({ type: 'recharge', amount: order.beans, desc: `充值 ${order.amount}元`, time: now() });
  saveUserFile(order.userId, 'transactions.json', txs);

  res.json({ ok: true });
});

app.post('/api/admin/orders/:id/reject', authRequired, adminRequired, (req, res) => {
  const orders = loadJson(ORDERS_FILE, []);
  const order = orders.find(o => o.id === req.params.id);
  if (!order) return res.status(404).json({ error: '订单不存在' });
  order.status = 'rejected';
  order.rejectedAt = now();
  saveJson(ORDERS_FILE, orders);
  res.json({ ok: true });
});

app.post('/api/admin/chars', authRequired, adminRequired, (req, res) => {
  const { name, desc, prompt, tags } = req.body || {};
  if (!name || !prompt) return res.status(400).json({ error: '名称和 Prompt 必填' });
  const list = loadJson(OFFICIAL_CHARS_FILE, []);
  const char = { id: genId(), name, desc: desc || '', prompt, tags: tags || [], official: true, createdAt: now() };
  list.push(char);
  saveJson(OFFICIAL_CHARS_FILE, list);
  res.json(char);
});

app.get('/api/admin/stats', authRequired, adminRequired, (req, res) => {
  const orders = loadJson(ORDERS_FILE, []);
  const users = loadJson(USERS_FILE, {});
  const stats = {
    totalOrders: orders.length,
    pending: orders.filter(o => o.status === 'pending').length,
    approved: orders.filter(o => o.status === 'approved').length,
    rejected: orders.filter(o => o.status === 'rejected').length,
    totalIncome: orders.filter(o => o.status === 'approved').reduce((s, o) => s + o.amount, 0),
    userCount: Object.keys(users).length
  };
  res.json(stats);
});

// ============================================================
//  文游剧本
// ============================================================

app.get('/api/scripts', authRequired, (req, res) => {
  const official = loadJson(OFFICIAL_SCRIPTS_FILE, []);
  const saves = loadUserFile(req.userId, 'scripts_save.json', {});
  res.json({ scripts: official, saves });
});

app.post('/api/scripts/:id/save', authRequired, (req, res) => {
  const saves = loadUserFile(req.userId, 'scripts_save.json', {});
  saves[req.params.id] = req.body;
  saveUserFile(req.userId, 'scripts_save.json', saves);
  res.json({ ok: true });
});

// ============================================================
//  用户资料
// ============================================================

app.put('/api/profile', authRequired, (req, res) => {
  const profile = loadUserFile(req.userId, 'profile.json', {});
  const updated = { ...profile, ...req.body };
  saveUserFile(req.userId, 'profile.json', updated);
  res.json(updated);
});

// ============================================================
//  静态前端（单页应用）
// ============================================================
const publicDir = path.join(__dirname, 'public');
app.use(express.static(publicDir));

// 显式处理根路径，避免 SPA fallback 失效
app.get('/', (req, res) => {
  res.sendFile(path.join(publicDir, 'index.html'));
});

// SPA fallback：所有非 /api 路由都返回 index.html
app.use((req, res, next) => {
  if (req.path.startsWith('/api/')) return next();
  const indexPath = path.join(publicDir, 'index.html');
  // 确认文件存在，否则返回最小可用页面（避免空白）
  if (fs.existsSync(indexPath)) {
    res.sendFile(indexPath);
  } else {
    res.status(200).send(
      '<!doctype html><meta charset="utf-8"><title>Mochi-phone</title>' +
      '<body style="font-family:sans-serif;background:#fce4ec;display:flex;' +
      'align-items:center;justify-content:center;height:100vh;margin:0">' +
      '<div style="text-align:center"><h1 style="font-size:3rem">🌸</h1>' +
      '<h2>Mochi-phone</h2><p style="color:#888">前端文件未找到，请确认 public/index.html 已上传</p>' +
      '<p style="color:#aaa;font-size:.8rem">API 状态：正常</p></div></body>'
    );
  }
});

// ============================================================
//  启动
// ============================================================
app.listen(PORT, () => {
  console.log(`🌸 Mochi-phone running on port ${PORT}`);
});
