/**
 * Mochi AI Chat - 商用AI角色聊天平台后端服务 v3.0
 * 功能：用户系统、JWT鉴权、JSON文件数据库、对话云端存储、按Token计费、
 *       管理员后台充值系统、智能API地址适配、流式响应降级
 * 
 * v3.0 更新：
 * - 修复聊天功能：API地址智能适配、流式响应降级、友好错误提示
 * - 新增管理员后台充值系统：密码登录、充值申请管理、用户米粒管理
 * - 充值流程改造：用户提交申请 → 管理员确认到账 → 米粒到账
 * - 新增收款码展示、实时通知（轮询）
 */
require('dotenv').config();
const express = require('express');
const cors = require('cors');
const path = require('path');
const Database = require('./db');
const jwt = require('jsonwebtoken');
const bcrypt = require('bcryptjs');
const app = express();
const PORT = process.env.PORT || 3000;

// ==================== 配置常量 ====================
const CONFIG = {
  API_BASE_URL: process.env.API_BASE_URL || '',
  API_KEY: process.env.API_KEY || '',
  DEFAULT_MODEL: process.env.MODEL || process.env.DEFAULT_MODEL || 'gpt-3.5-turbo',
  
  JWT_SECRET: process.env.JWT_SECRET || 'mochi_ai_chat_default_secret_2024',
  JWT_EXPIRES_IN: parseInt(process.env.JWT_EXPIRES_IN || '604800'),
  
  DATA_DIR: process.env.DATA_DIR || './data',
  
  TOKENS_PER_RICE: parseInt(process.env.TOKENS_PER_RICE || '1000'),
  NEW_USER_RICE: parseInt(process.env.NEW_USER_RICE || '1000'),
  
  ADMIN_PASSWORD: process.env.ADMIN_PASSWORD || '841026',
  
  COMMUNITY_PAGE_SIZE: parseInt(process.env.COMMUNITY_PAGE_SIZE || '20'),
  
  FORUM_POST_COST: parseInt(process.env.FORUM_POST_COST || '2'), // 生成帖子消耗米粒
  FORUM_COMMENT_COST: parseInt(process.env.FORUM_COMMENT_COST || '1'), // 生成评论消耗米粒
  FORUM_PAGE_SIZE: parseInt(process.env.FORUM_PAGE_SIZE || '10'),
  
  FANFIC_COST: parseInt(process.env.FANFIC_COST || '10'), // 生成同人文消耗米粒
  FANFIC_PAGE_SIZE: parseInt(process.env.FANFIC_PAGE_SIZE || '12'),
  
  RECHARGE_TIERS: parseRechargeTiers(process.env.RECHARGE_TIERS || '1:10:0,6:60:0,12:120:5,30:300:20,50:500:50,68:680:80,98:980:150,128:1280:200,198:1980:400,328:3280:800,648:6480:2000'),
  
  PAY_CHANNEL: process.env.PAY_CHANNEL || 'manual'
};

function parseRechargeTiers(str) {
  return str.split(',').map(item => {
    const parts = item.split(':').map(Number);
    return { 
      price: parts[0], 
      rice: parts[1], 
      bonus: parts[2] || 0,
      total: parts[1] + (parts[2] || 0)
    };
  }).sort((a, b) => a.price - b.price);
}

// ==================== 数据库初始化 ====================
const db = new Database(CONFIG.DATA_DIR);

function initDatabase() {
  console.log('✅ 数据库初始化完成（JSON文件存储）');
}
initDatabase();

// 初始化社区示例角色
function initCommunityCharacters() {
  const communityChars = db.prepare('SELECT * FROM community_characters').all();
  if (communityChars.length > 0) return;
  
  const sampleCharacters = [
    {
      name: '温柔学姐',
      avatar: '',
      description: '温柔体贴的学姐，总是耐心倾听你的烦恼',
      persona: '你是一位温柔体贴的大学学姐，性格温柔、善解人意，总是用温柔的语气和人说话。你喜欢照顾学弟学妹，经常帮助他们解决学习和生活上的问题。你的口头禅是"慢慢来，学姐在呢"。',
      tags: JSON.stringify(['温柔', '治愈', '学姐']),
      likes: 1286
    },
    {
      name: '傲娇大小姐',
      avatar: '',
      description: '嘴硬心软的富家大小姐，表面傲娇内心柔软',
      persona: '你是一位傲娇的富家大小姐，出身名门望族，性格傲娇、嘴硬心软。虽然表面上总是一副高高在上的样子，但实际上内心非常善良，会偷偷关心别人。你经常说"哼，我才不是为了你呢"。',
      tags: JSON.stringify(['傲娇', '大小姐', '可爱']),
      likes: 2341
    },
    {
      name: '邻家妹妹',
      avatar: '',
      description: '活泼可爱的邻家妹妹，元气满满',
      persona: '你是一位活泼可爱的邻家妹妹，性格开朗、元气满满，喜欢笑。你从小就住在隔壁，和"哥哥/姐姐"一起长大。你非常依赖对方，经常跑到对方家里蹭饭。你喜欢说"哥哥/姐姐最好啦！"',
      tags: JSON.stringify(['可爱', '元气', '妹妹']),
      likes: 1892
    },
    {
      name: '冷酷总裁',
      avatar: '',
      description: '高冷霸道的总裁大人，只对你温柔',
      persona: '你是一位冷酷霸道的总裁，是大型企业的CEO，性格高冷、果断、有气场。在外人面前你总是冷冰冰的，但在喜欢的人面前会展现出温柔的一面。你的经典台词是"女人，你成功引起了我的注意"。',
      tags: JSON.stringify(['霸道', '总裁', '高冷']),
      likes: 3156
    },
    {
      name: '古风剑客',
      avatar: '',
      description: '浪迹江湖的白衣剑客，侠骨柔情',
      persona: '你是一位浪迹江湖的古风剑客，身着白衣，腰佩长剑，性格洒脱、重情重义。你行走江湖多年，见过许多人和事，有着丰富的人生阅历。你说话带着古风韵味，喜欢说"在下..."。',
      tags: JSON.stringify(['古风', '武侠', '剑客']),
      likes: 2087
    },
    {
      name: '猫娘女仆',
      avatar: '',
      description: '软萌可爱的猫娘女仆，会喵喵叫',
      persona: '你是一位软萌可爱的猫娘女仆，长着猫耳朵和猫尾巴，性格温顺、粘人。你穿着女仆装，负责照顾主人的生活起居。你说话会带"喵"的尾音，喜欢撒娇。',
      tags: JSON.stringify(['猫娘', '女仆', '可爱']),
      likes: 4521
    }
  ];
  
  const insertChar = db.prepare(`
    INSERT INTO characters (user_id, name, avatar, persona, description, tags, is_public, created_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?)
  `);
  
  const insertCommunity = db.prepare(`
    INSERT INTO community_characters (user_id, character_id, likes, created_at)
    VALUES (?, ?, ?, ?)
  `);
  
  const now = Date.now();
  sampleCharacters.forEach((char, index) => {
    const charResult = insertChar.run(
      0,
      char.name,
      char.avatar,
      char.persona,
      char.description,
      char.tags,
      1,
      now - (index * 86400000 * 5)
    );
    insertCommunity.run(0, charResult.lastInsertRowid, char.likes, now - (index * 86400000 * 5));
  });
  
  console.log('✅ 社区示例角色初始化完成');
}
initCommunityCharacters();

// ==================== 工具函数 ====================
function generateId(prefix = 'id') {
  return `${prefix}_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
}

function generateOrderNo() {
  const now = new Date();
  const dateStr = now.getFullYear().toString() + 
    (now.getMonth() + 1).toString().padStart(2, '0') + 
    now.getDate().toString().padStart(2, '0') +
    now.getHours().toString().padStart(2, '0') +
    now.getMinutes().toString().padStart(2, '0') +
    now.getSeconds().toString().padStart(2, '0');
  const random = Math.random().toString().slice(2, 8);
  return `MO${dateStr}${random}`;
}

function generateToken(userId) {
  return jwt.sign({ userId }, CONFIG.JWT_SECRET, { expiresIn: CONFIG.JWT_EXPIRES_IN });
}

function verifyToken(token) {
  try {
    return jwt.verify(token, CONFIG.JWT_SECRET);
  } catch (err) {
    return null;
  }
}

function generateAdminToken() {
  return jwt.sign({ admin: true }, CONFIG.JWT_SECRET + '_admin', { expiresIn: '24h' });
}

function verifyAdminToken(token) {
  try {
    return jwt.verify(token, CONFIG.JWT_SECRET + '_admin');
  } catch (err) {
    return null;
  }
}

/**
 * 智能拼接 API 地址
 * 兼容两种格式：
 * - https://xxx/v1 → https://xxx/v1/chat/completions
 * - https://xxx → https://xxx/v1/chat/completions
 */
function buildApiUrl(baseUrl) {
  if (!baseUrl) return '';
  
  let url = baseUrl.trim();
  // 移除末尾的斜杠
  url = url.replace(/\/+$/, '');
  
  // 检查是否以 /v1 结尾
  if (url.endsWith('/v1')) {
    return url + '/chat/completions';
  } else {
    return url + '/v1/chat/completions';
  }
}

// ==================== 中间件 ====================
app.use(cors());
app.use(express.json({ limit: '10mb' }));
app.use(express.static(__dirname));

// ==================== JWT鉴权中间件 ====================
function authMiddleware(req, res, next) {
  const token = req.headers.authorization?.replace('Bearer ', '') || req.headers['x-token'];
  
  if (!token) {
    return res.status(401).json({ success: false, error: '未登录', code: 'NOT_LOGGED_IN' });
  }
  
  const decoded = verifyToken(token);
  if (!decoded) {
    return res.status(401).json({ success: false, error: '登录已过期，请重新登录', code: 'TOKEN_EXPIRED' });
  }
  
  const user = db.prepare('SELECT * FROM users WHERE id = ?').get(decoded.userId);
  if (!user) {
    return res.status(401).json({ success: false, error: '用户不存在', code: 'USER_NOT_FOUND' });
  }
  
  req.user = user;
  next();
}

// 管理员鉴权中间件
function adminAuthMiddleware(req, res, next) {
  const token = req.headers.authorization?.replace('Bearer ', '') || req.headers['x-admin-token'];
  
  if (!token) {
    return res.status(401).json({ success: false, error: '未登录', code: 'ADMIN_NOT_LOGGED_IN' });
  }
  
  const decoded = verifyAdminToken(token);
  if (!decoded || !decoded.admin) {
    return res.status(401).json({ success: false, error: '管理员登录已过期', code: 'ADMIN_TOKEN_EXPIRED' });
  }
  
  req.isAdmin = true;
  next();
}

// ==================== 认证相关API ====================

// 用户注册
app.post('/api/auth/register', (req, res) => {
  try {
    const { username, password } = req.body;
    
    if (!username || !password) {
      return res.status(400).json({ success: false, error: '用户名和密码不能为空' });
    }
    
    if (username.length < 3 || username.length > 20) {
      return res.status(400).json({ success: false, error: '用户名长度应为3-20个字符' });
    }
    
    if (password.length < 6) {
      return res.status(400).json({ success: false, error: '密码长度不能少于6位' });
    }
    
    // 检查用户名是否已存在
    const existingUser = db.prepare('SELECT id FROM users WHERE username = ?').get(username);
    if (existingUser) {
      return res.status(400).json({ success: false, error: '用户名已被注册' });
    }
    
    // 密码加密
    const passwordHash = bcrypt.hashSync(password, 10);
    const now = Date.now();
    
    // 创建用户
    const result = db.prepare(`
      INSERT INTO users (username, password_hash, nickname, rice_balance, created_at)
      VALUES (?, ?, ?, ?, ?)
    `).run(username, passwordHash, username, CONFIG.NEW_USER_RICE, now);
    
    const userId = result.lastInsertRowid;
    
    // 记录初始米粒交易
    db.prepare(`
      INSERT INTO transactions (user_id, type, amount, balance_after, description, created_at)
      VALUES (?, 'recharge', ?, ?, '新用户注册赠送', ?)
    `).run(userId, CONFIG.NEW_USER_RICE, CONFIG.NEW_USER_RICE, now);
    
    // 生成token
    const token = generateToken(userId);
    
    res.json({
      success: true,
      data: {
        token,
        user: {
          id: userId,
          username,
          nickname: username,
          avatar: '',
          rice_balance: CONFIG.NEW_USER_RICE
        }
      }
    });
  } catch (err) {
    console.error('注册失败:', err);
    res.status(500).json({ success: false, error: '注册失败，请稍后重试' });
  }
});

// 用户登录
app.post('/api/auth/login', (req, res) => {
  try {
    const { username, password } = req.body;
    
    if (!username || !password) {
      return res.status(400).json({ success: false, error: '用户名和密码不能为空' });
    }
    
    // 查询用户
    const user = db.prepare('SELECT * FROM users WHERE username = ?').get(username);
    if (!user) {
      return res.status(400).json({ success: false, error: '用户名或密码错误' });
    }
    
    // 验证密码
    const valid = bcrypt.compareSync(password, user.password_hash);
    if (!valid) {
      return res.status(400).json({ success: false, error: '用户名或密码错误' });
    }
    
    // 生成token
    const token = generateToken(user.id);
    
    res.json({
      success: true,
      data: {
        token,
        user: {
          id: user.id,
          username: user.username,
          nickname: user.nickname,
          avatar: user.avatar,
          rice_balance: user.rice_balance
        }
      }
    });
  } catch (err) {
    console.error('登录失败:', err);
    res.status(500).json({ success: false, error: '登录失败，请稍后重试' });
  }
});

// 获取当前用户信息
app.get('/api/auth/me', authMiddleware, (req, res) => {
  try {
    const user = req.user;
    res.json({
      success: true,
      data: {
        id: user.id,
        username: user.username,
        nickname: user.nickname,
        avatar: user.avatar,
        description: user.description,
        rice_balance: user.rice_balance
      }
    });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// ==================== 管理员API ====================

// 管理员登录
app.post('/api/admin/login', (req, res) => {
  try {
    const { password } = req.body;
    
    if (!password) {
      return res.status(400).json({ success: false, error: '请输入管理员密码' });
    }
    
    if (password !== CONFIG.ADMIN_PASSWORD) {
      return res.status(401).json({ success: false, error: '密码错误' });
    }
    
    const token = generateAdminToken();
    
    res.json({
      success: true,
      data: { token }
    });
  } catch (err) {
    console.error('管理员登录失败:', err);
    res.status(500).json({ success: false, error: '登录失败，请稍后重试' });
  }
});

// 管理员获取充值申请列表
app.get('/api/admin/recharge/list', adminAuthMiddleware, (req, res) => {
  try {
    const { status, page = 1, pageSize = 20 } = req.query;
    const size = parseInt(pageSize);
    const pageNum = parseInt(page);
    
    let orders = db.prepare('SELECT * FROM recharge_orders ORDER BY created_at DESC').all();
    
    if (status && status !== 'all') {
      orders = orders.filter(o => o.status === status);
    }
    
    // 关联用户信息
    const result = orders.map(order => {
      const user = db.prepare('SELECT username, nickname FROM users WHERE id = ?').get(order.user_id);
      return {
        ...order,
        username: user?.username || '',
        nickname: user?.nickname || ''
      };
    });
    
    const start = (pageNum - 1) * size;
    const paginatedResult = result.slice(start, start + size);
    
    res.json({ 
      success: true, 
      data: {
        list: paginatedResult,
        total: result.length,
        page: pageNum,
        pageSize: size,
        pendingCount: orders.filter(o => o.status === 'pending').length
      }
    });
  } catch (err) {
    console.error('获取充值列表失败:', err);
    res.status(500).json({ success: false, error: err.message });
  }
});

// 管理员确认充值到账
app.post('/api/admin/recharge/confirm', adminAuthMiddleware, (req, res) => {
  try {
    const { orderId, remark } = req.body;
    
    if (!orderId) {
      return res.status(400).json({ success: false, error: '订单ID不能为空' });
    }
    
    const order = db.prepare('SELECT * FROM recharge_orders WHERE id = ?').get(orderId);
    if (!order) {
      return res.status(404).json({ success: false, error: '订单不存在' });
    }
    
    if (order.status !== 'pending') {
      return res.status(400).json({ success: false, error: '订单状态不是待处理' });
    }
    
    const now = Date.now();
    
    // 更新订单状态
    db.prepare(`
      UPDATE recharge_orders SET status = 'completed', processed_at = ?, process_remark = ?
      WHERE id = ?
    `).run(now, remark || '', orderId);
    
    // 更新用户余额
    const user = db.prepare('SELECT * FROM users WHERE id = ?').get(order.user_id);
    const newBalance = (user.rice_balance || 0) + order.rice_amount;
    db.prepare('UPDATE users SET rice_balance = ? WHERE id = ?').run(newBalance, order.user_id);
    
    // 记录交易
    db.prepare(`
      INSERT INTO transactions (user_id, type, amount, balance_after, description, created_at)
      VALUES (?, 'recharge', ?, ?, '充值' + order.amount + '元', ?)
    `).run(order.user_id, order.rice_amount, newBalance, now);
    
    res.json({ success: true, data: { new_balance: newBalance } });
  } catch (err) {
    console.error('确认充值失败:', err);
    res.status(500).json({ success: false, error: err.message });
  }
});

// 管理员拒绝充值申请
app.post('/api/admin/recharge/reject', adminAuthMiddleware, (req, res) => {
  try {
    const { orderId, reason } = req.body;
    
    if (!orderId) {
      return res.status(400).json({ success: false, error: '订单ID不能为空' });
    }
    
    const order = db.prepare('SELECT * FROM recharge_orders WHERE id = ?').get(orderId);
    if (!order) {
      return res.status(404).json({ success: false, error: '订单不存在' });
    }
    
    if (order.status !== 'pending') {
      return res.status(400).json({ success: false, error: '订单状态不是待处理' });
    }
    
    const now = Date.now();
    
    db.prepare(`
      UPDATE recharge_orders SET status = 'rejected', processed_at = ?, process_remark = ?
      WHERE id = ?
    `).run(now, reason || '', orderId);
    
    res.json({ success: true });
  } catch (err) {
    console.error('拒绝充值失败:', err);
    res.status(500).json({ success: false, error: err.message });
  }
});

// 管理员获取用户列表
app.get('/api/admin/users', adminAuthMiddleware, (req, res) => {
  try {
    const { search = '', page = 1, pageSize = 20 } = req.query;
    const size = parseInt(pageSize);
    const pageNum = parseInt(page);
    
    let users = db.prepare('SELECT * FROM users ORDER BY created_at DESC').all();
    
    if (search) {
      const keyword = search.toLowerCase();
      users = users.filter(u => 
        u.username.toLowerCase().includes(keyword) ||
        (u.nickname && u.nickname.toLowerCase().includes(keyword))
      );
    }
    
    const result = users.map(u => ({
      id: u.id,
      username: u.username,
      nickname: u.nickname,
      avatar: u.avatar,
      rice_balance: u.rice_balance || 0,
      created_at: u.created_at
    }));
    
    const start = (pageNum - 1) * size;
    const paginatedResult = result.slice(start, start + size);
    
    res.json({ 
      success: true, 
      data: {
        list: paginatedResult,
        total: result.length,
        page: pageNum,
        pageSize: size
      }
    });
  } catch (err) {
    console.error('获取用户列表失败:', err);
    res.status(500).json({ success: false, error: err.message });
  }
});

// 管理员调整用户米粒
app.post('/api/admin/user/adjust-rice', adminAuthMiddleware, (req, res) => {
  try {
    const { userId, amount, reason } = req.body;
    
    if (!userId || amount === undefined) {
      return res.status(400).json({ success: false, error: '用户ID和数量不能为空' });
    }
    
    const user = db.prepare('SELECT * FROM users WHERE id = ?').get(userId);
    if (!user) {
      return res.status(404).json({ success: false, error: '用户不存在' });
    }
    
    const currentBalance = user.rice_balance || 0;
    const newBalance = Math.max(0, currentBalance + parseInt(amount));
    const changeAmount = newBalance - currentBalance;
    
    db.prepare('UPDATE users SET rice_balance = ? WHERE id = ?').run(newBalance, userId);
    
    // 记录交易
    const now = Date.now();
    db.prepare(`
      INSERT INTO transactions (user_id, type, amount, balance_after, description, created_at)
      VALUES (?, ?, ?, ?, ?, ?)
    `).run(
      userId, 
      changeAmount >= 0 ? 'recharge' : 'consume', 
      Math.abs(changeAmount), 
      newBalance, 
      reason || (changeAmount >= 0 ? '管理员调整' : '管理员扣除'),
      now
    );
    
    res.json({ success: true, data: { new_balance: newBalance } });
  } catch (err) {
    console.error('调整米粒失败:', err);
    res.status(500).json({ success: false, error: err.message });
  }
});

// 管理员统计数据
app.get('/api/admin/stats', adminAuthMiddleware, (req, res) => {
  try {
    const users = db.prepare('SELECT * FROM users').all();
    const transactions = db.prepare('SELECT * FROM transactions').all();
    const characters = db.prepare('SELECT * FROM characters').all();
    const conversations = db.prepare('SELECT * FROM conversations').all();
    const rechargeOrders = db.prepare('SELECT * FROM recharge_orders').all();
    
    const totalUsers = users.length;
    const totalRice = users.reduce((sum, u) => sum + (u.rice_balance || 0), 0);
    const totalRecharge = transactions.filter(t => t.type === 'recharge').reduce((sum, t) => sum + t.amount, 0);
    const totalConsume = transactions.filter(t => t.type === 'consume').reduce((sum, t) => sum + t.amount, 0);
    const pendingOrders = rechargeOrders.filter(o => o.status === 'pending').length;
    const completedOrders = rechargeOrders.filter(o => o.status === 'completed').length;
    
    res.json({
      success: true,
      data: {
        totalUsers,
        totalRice,
        totalRecharge,
        totalConsume,
        totalCharacters: characters.length,
        totalConversations: conversations.length,
        totalRechargeOrders: rechargeOrders.length,
        pendingOrders,
        completedOrders
      }
    });
  } catch (err) {
    console.error('获取统计数据失败:', err);
    res.status(500).json({ success: false, error: err.message });
  }
});

// ==================== 用户相关API ====================

// 更新用户信息
app.post('/api/user/update', authMiddleware, (req, res) => {
  try {
    const { nickname, avatar, description } = req.body;
    const userId = req.user.id;
    
    db.prepare(`
      UPDATE users SET 
        nickname = COALESCE(?, nickname),
        avatar = COALESCE(?, avatar),
        description = COALESCE(?, description)
      WHERE id = ?
    `).run(
      nickname !== undefined ? String(nickname).slice(0, 20) : null,
      avatar !== undefined ? String(avatar) : null,
      description !== undefined ? String(description).slice(0, 500) : null,
      userId
    );
    
    const user = db.prepare('SELECT * FROM users WHERE id = ?').get(userId);
    res.json({
      success: true,
      data: {
        id: user.id,
        username: user.username,
        nickname: user.nickname,
        avatar: user.avatar,
        description: user.description,
        rice_balance: user.rice_balance
      }
    });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// 获取交易记录
app.get('/api/user/transactions', authMiddleware, (req, res) => {
  try {
    const { type, page = 1, pageSize = 20 } = req.query;
    const userId = req.user.id;
    const size = parseInt(pageSize);
    const pageNum = parseInt(page);
    
    let txs = db.prepare('SELECT * FROM transactions WHERE user_id = ? ORDER BY created_at DESC').all(userId);
    
    if (type && type !== 'all') {
      txs = txs.filter(t => t.type === type);
    }
    
    const start = (pageNum - 1) * size;
    const result = txs.slice(start, start + size);
    
    res.json({ success: true, data: result });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// ==================== 角色相关API ====================

// 获取我的角色列表
app.get('/api/characters', authMiddleware, (req, res) => {
  try {
    const userId = req.user.id;
    const characters = db.prepare(`
      SELECT * FROM characters 
      WHERE user_id = ? 
      ORDER BY created_at DESC
    `).all(userId);
    
    const result = characters.map(c => ({
      id: c.id,
      name: c.name,
      avatar: c.avatar,
      description: c.description,
      persona: c.persona,
      tags: JSON.parse(c.tags || '[]'),
      isPublic: c.is_public === 1,
      createdAt: c.created_at
    }));
    
    res.json({ success: true, data: result });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// 创建角色
app.post('/api/characters', authMiddleware, (req, res) => {
  try {
    const userId = req.user.id;
    const { name, avatar, persona, description, tags, isPublic } = req.body;
    
    if (!name || !persona) {
      return res.status(400).json({ success: false, error: '角色名称和人设不能为空' });
    }
    
    const now = Date.now();
    const result = db.prepare(`
      INSERT INTO characters (user_id, name, avatar, persona, description, tags, is_public, created_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      userId,
      String(name).slice(0, 20),
      avatar || '',
      String(persona).slice(0, 5000),
      String(description || '').slice(0, 200),
      JSON.stringify(Array.isArray(tags) ? tags.slice(0, 5) : []),
      isPublic ? 1 : 0,
      now
    );
    
    const characterId = result.lastInsertRowid;
    
    // 如果是公开的，添加到社区
    if (isPublic) {
      db.prepare(`
        INSERT INTO community_characters (user_id, character_id, likes, created_at)
        VALUES (?, ?, 0, ?)
      `).run(userId, characterId, now);
    }
    
    res.json({ success: true, data: { id: characterId } });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// 更新角色
app.put('/api/characters/:id', authMiddleware, (req, res) => {
  try {
    const userId = req.user.id;
    const characterId = req.params.id;
    const { name, avatar, persona, description, tags, isPublic } = req.body;
    
    // 检查角色是否属于当前用户
    const character = db.prepare('SELECT * FROM characters WHERE id = ? AND user_id = ?').get(characterId, userId);
    if (!character) {
      return res.status(404).json({ success: false, error: '角色不存在' });
    }
    
    db.prepare(`
      UPDATE characters SET 
        name = COALESCE(?, name),
        avatar = COALESCE(?, avatar),
        persona = COALESCE(?, persona),
        description = COALESCE(?, description),
        tags = COALESCE(?, tags),
        is_public = COALESCE(?, is_public)
      WHERE id = ? AND user_id = ?
    `).run(
      name !== undefined ? String(name).slice(0, 20) : null,
      avatar !== undefined ? String(avatar) : null,
      persona !== undefined ? String(persona).slice(0, 5000) : null,
      description !== undefined ? String(description || '').slice(0, 200) : null,
      tags !== undefined ? JSON.stringify(Array.isArray(tags) ? tags.slice(0, 5) : []) : null,
      isPublic !== undefined ? (isPublic ? 1 : 0) : null,
      characterId,
      userId
    );
    
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// 删除角色
app.delete('/api/characters/:id', authMiddleware, (req, res) => {
  try {
    const userId = req.user.id;
    const characterId = req.params.id;
    
    // 检查角色是否属于当前用户
    const character = db.prepare('SELECT * FROM characters WHERE id = ? AND user_id = ?').get(characterId, userId);
    if (!character) {
      return res.status(404).json({ success: false, error: '角色不存在' });
    }
    
    // 删除对话和消息
    const conversations = db.prepare('SELECT id FROM conversations WHERE character_id = ? AND user_id = ?').all(characterId, userId);
    conversations.forEach(c => {
      db.prepare('DELETE FROM messages WHERE conversation_id = ?').run(c.id);
    });
    db.prepare('DELETE FROM conversations WHERE character_id = ? AND user_id = ?').run(characterId, userId);
    db.prepare('DELETE FROM community_characters WHERE character_id = ?').run(characterId);
    db.prepare('DELETE FROM characters WHERE id = ? AND user_id = ?').run(characterId, userId);
    
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// ==================== 对话相关API ====================

// 获取对话列表
app.get('/api/conversations', authMiddleware, (req, res) => {
  try {
    const userId = req.user.id;
    const { characterId } = req.query;
    
    let conversations = db.prepare('SELECT * FROM conversations WHERE user_id = ? ORDER BY updated_at DESC').all(userId);
    
    if (characterId) {
      conversations = conversations.filter(c => c.character_id == characterId);
    }
    
    // 关联角色信息
    const result = conversations.map(conv => {
      const char = db.prepare('SELECT name, avatar FROM characters WHERE id = ?').get(conv.character_id);
      return {
        ...conv,
        character_name: char?.name || '',
        character_avatar: char?.avatar || ''
      };
    });
    
    res.json({ success: true, data: result });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// 获取对话消息
app.get('/api/conversations/:id/messages', authMiddleware, (req, res) => {
  try {
    const userId = req.user.id;
    const conversationId = req.params.id;
    
    // 检查对话是否属于当前用户
    const conversation = db.prepare('SELECT * FROM conversations WHERE id = ? AND user_id = ?').get(conversationId, userId);
    if (!conversation) {
      return res.status(404).json({ success: false, error: '对话不存在' });
    }
    
    const messages = db.prepare(`
      SELECT * FROM messages 
      WHERE conversation_id = ? 
      ORDER BY created_at ASC
    `).all(conversationId);
    
    res.json({ success: true, data: messages });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// 创建新对话
app.post('/api/conversations', authMiddleware, (req, res) => {
  try {
    const userId = req.user.id;
    const { characterId } = req.body;
    
    if (!characterId) {
      return res.status(400).json({ success: false, error: '角色ID不能为空' });
    }
    
    // 检查角色是否存在
    const character = db.prepare('SELECT * FROM characters WHERE id = ?').get(characterId);
    if (!character) {
      return res.status(404).json({ success: false, error: '角色不存在' });
    }
    
    const now = Date.now();
    const result = db.prepare(`
      INSERT INTO conversations (user_id, character_id, created_at, updated_at)
      VALUES (?, ?, ?, ?)
    `).run(userId, characterId, now, now);
    
    res.json({ success: true, data: { id: result.lastInsertRowid } });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// 删除对话
app.delete('/api/conversations/:id', authMiddleware, (req, res) => {
  try {
    const userId = req.user.id;
    const conversationId = req.params.id;
    
    // 检查对话是否属于当前用户
    const conversation = db.prepare('SELECT * FROM conversations WHERE id = ? AND user_id = ?').get(conversationId, userId);
    if (!conversation) {
      return res.status(404).json({ success: false, error: '对话不存在' });
    }
    
    db.prepare('DELETE FROM messages WHERE conversation_id = ?').run(conversationId);
    db.prepare('DELETE FROM conversations WHERE id = ? AND user_id = ?').run(conversationId, userId);
    
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// ==================== 充值相关API ====================

// 获取充值档位
app.get('/api/recharge/tiers', (req, res) => {
  res.json({ success: true, data: CONFIG.RECHARGE_TIERS });
});

// 提交充值申请
app.post('/api/recharge/apply', authMiddleware, (req, res) => {
  try {
    const userId = req.user.id;
    const { tierIndex, remark } = req.body;
    
    const tier = CONFIG.RECHARGE_TIERS[tierIndex];
    if (!tier) {
      return res.status(400).json({ success: false, error: '无效的充值档位' });
    }
    
    const orderNo = generateOrderNo();
    const now = Date.now();
    
    db.prepare(`
      INSERT INTO recharge_orders (user_id, order_no, amount, rice_amount, status, pay_method, remark, created_at)
      VALUES (?, ?, ?, ?, 'pending', ?, ?, ?)
    `).run(userId, orderNo, tier.price, tier.total, CONFIG.PAY_CHANNEL, remark || '', now);
    
    res.json({
      success: true,
      data: {
        orderId: orderNo,
        order_no: orderNo,
        price: tier.price,
        rice: tier.total,
        userId: userId,
        username: req.user.username,
        status: 'pending'
      }
    });
  } catch (err) {
    console.error('提交充值申请失败:', err);
    res.status(500).json({ success: false, error: err.message });
  }
});

// 获取我的充值记录
app.get('/api/recharge/orders', authMiddleware, (req, res) => {
  try {
    const userId = req.user.id;
    const { status, page = 1, pageSize = 20 } = req.query;
    const size = parseInt(pageSize);
    const pageNum = parseInt(page);
    
    let orders = db.prepare('SELECT * FROM recharge_orders WHERE user_id = ? ORDER BY created_at DESC').all(userId);
    
    if (status && status !== 'all') {
      orders = orders.filter(o => o.status === status);
    }
    
    const start = (pageNum - 1) * size;
    const result = orders.slice(start, start + size);
    
    res.json({ success: true, data: result });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// 获取待处理充值数量（用于轮询通知）
app.get('/api/recharge/pending-count', authMiddleware, (req, res) => {
  try {
    const userId = req.user.id;
    const orders = db.prepare("SELECT * FROM recharge_orders WHERE user_id = ? AND status = 'pending'").all(userId);
    
    res.json({ success: true, data: { count: orders.length } });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// ==================== 社区角色API ====================

// 获取社区角色列表
app.get('/api/community/characters', (req, res) => {
  try {
    const { page = 1, pageSize, search = '', sort = 'hot' } = req.query;
    const size = parseInt(pageSize) || CONFIG.COMMUNITY_PAGE_SIZE;
    const pageNum = parseInt(page);
    
    // 获取社区角色
    let communityChars = db.prepare('SELECT * FROM community_characters').all();
    
    // 关联角色信息
    let characters = communityChars.map(cc => {
      const char = db.prepare('SELECT * FROM characters WHERE id = ? AND is_public = 1').get(cc.character_id);
      if (!char) return null;
      
      const user = db.prepare('SELECT nickname FROM users WHERE id = ?').get(cc.user_id);
      
      return {
        id: cc.id,
        name: char.name,
        avatar: char.avatar,
        description: char.description,
        tags: JSON.parse(char.tags || '[]'),
        author: user?.nickname || '官方',
        likes: cc.likes,
        createdAt: cc.created_at
      };
    }).filter(c => c !== null);
    
    // 搜索过滤
    if (search) {
      const keyword = search.toLowerCase();
      characters = characters.filter(c =>
        c.name.toLowerCase().includes(keyword) ||
        c.description.toLowerCase().includes(keyword) ||
        (c.tags && c.tags.some(t => t.toLowerCase().includes(keyword)))
      );
    }
    
    // 排序
    if (sort === 'hot') {
      characters.sort((a, b) => b.likes - a.likes);
    } else if (sort === 'new') {
      characters.sort((a, b) => b.createdAt - a.createdAt);
    }
    
    const total = characters.length;
    const start = (pageNum - 1) * size;
    const data = characters.slice(start, start + size);
    
    res.json({ success: true, data: { list: data, total, page: pageNum, pageSize: size } });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// 获取角色详情
app.get('/api/community/characters/:id', (req, res) => {
  try {
    const id = req.params.id;
    
    const cc = db.prepare('SELECT * FROM community_characters WHERE id = ?').get(id);
    if (!cc) {
      return res.status(404).json({ success: false, error: '角色不存在' });
    }
    
    const char = db.prepare('SELECT * FROM characters WHERE id = ? AND is_public = 1').get(cc.character_id);
    if (!char) {
      return res.status(404).json({ success: false, error: '角色不存在' });
    }
    
    const user = db.prepare('SELECT nickname FROM users WHERE id = ?').get(cc.user_id);
    
    res.json({
      success: true,
      data: {
        id: cc.id,
        name: char.name,
        avatar: char.avatar,
        description: char.description,
        persona: char.persona,
        author: user?.nickname || '官方',
        likes: cc.likes,
        createdAt: cc.created_at,
        tags: JSON.parse(char.tags || '[]')
      }
    });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// 角色点赞
app.post('/api/community/like/:id', authMiddleware, (req, res) => {
  try {
    const id = req.params.id;
    
    const char = db.prepare('SELECT * FROM community_characters WHERE id = ?').get(id);
    if (!char) {
      return res.status(404).json({ success: false, error: '角色不存在' });
    }
    
    db.prepare('UPDATE community_characters SET likes = likes + 1 WHERE id = ?').run(id);
    const updated = db.prepare('SELECT likes FROM community_characters WHERE id = ?').get(id);
    
    res.json({ success: true, data: { likes: updated.likes } });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// ==================== 聊天API（核心） ====================

app.post('/api/chat', authMiddleware, async (req, res) => {
  const userId = req.user.id;
  const user = req.user;
  const { messages, characterId, conversationId, stream = true } = req.body;
  
  // 参数校验
  if (!messages || !Array.isArray(messages) || messages.length === 0) {
    return res.status(400).json({ success: false, error: '消息内容不能为空', code: 'EMPTY_MESSAGE' });
  }
  
  if (!characterId) {
    return res.status(400).json({ success: false, error: '角色ID不能为空', code: 'NO_CHARACTER' });
  }
  
  // 检查API配置
  if (!CONFIG.API_KEY || !CONFIG.API_BASE_URL) {
    return res.status(500).json({ 
      success: false, 
      error: '服务未配置API，请联系管理员', 
      code: 'API_NOT_CONFIGURED' 
    });
  }
  
  // 获取角色信息
  const character = db.prepare('SELECT * FROM characters WHERE id = ?').get(characterId);
  if (!character) {
    return res.status(404).json({ success: false, error: '角色不存在', code: 'CHARACTER_NOT_FOUND' });
  }
  
  // 获取或创建对话
  let convId = conversationId;
  if (!convId) {
    const now = Date.now();
    const result = db.prepare(`
      INSERT INTO conversations (user_id, character_id, created_at, updated_at)
      VALUES (?, ?, ?, ?)
    `).run(userId, characterId, now, now);
    convId = result.lastInsertRowid;
  } else {
    // 检查对话是否属于当前用户
    const conv = db.prepare('SELECT * FROM conversations WHERE id = ? AND user_id = ?').get(convId, userId);
    if (!conv) {
      return res.status(404).json({ success: false, error: '对话不存在', code: 'CONVERSATION_NOT_FOUND' });
    }
  }
  
  // 保存用户消息
  const userMsg = messages[messages.length - 1];
  const now = Date.now();
  db.prepare(`
    INSERT INTO messages (conversation_id, role, content, created_at)
    VALUES (?, 'user', ?, ?)
  `).run(convId, userMsg.content, now);
  
  // 更新对话时间
  db.prepare('UPDATE conversations SET updated_at = ? WHERE id = ?').run(now, convId);
  
  // 估算输入token数（粗略估算）
  const estimatedInputTokens = messages.reduce((sum, m) => sum + m.content.length / 2, 0);
  const estimatedCost = Math.max(1, Math.ceil(estimatedInputTokens / CONFIG.TOKENS_PER_RICE));
  
  // 检查余额（预扣估算值）
  if (user.rice_balance < estimatedCost) {
    return res.status(402).json({ 
      success: false, 
      error: '米粒不足，请充值', 
      code: 'RICE_NOT_ENOUGH' 
    });
  }
  
  // 构建系统提示词
  const systemPrompt = character.persona
    ? `${character.persona}\n\n请严格按照以上设定进行对话，保持角色设定的一致性。不要提及你是AI或语言模型，要完全代入角色。`
    : '你是一个友好的AI助手，请用自然的语气与用户对话。';
  
  // 构建请求消息
  const requestMessages = [
    { role: 'system', content: systemPrompt },
    ...messages.map(m => ({ role: m.role, content: m.content }))
  ];
  
  // 构建API地址
  const apiUrl = buildApiUrl(CONFIG.API_BASE_URL);
  
  try {
    // 调用上游API
    const response = await fetch(apiUrl, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${CONFIG.API_KEY}`
      },
      body: JSON.stringify({
        model: CONFIG.DEFAULT_MODEL,
        messages: requestMessages,
        stream: stream,
        temperature: 0.8,
        max_tokens: 1024
      })
    });
    
    // 处理API错误
    if (!response.ok) {
      let errorMsg = 'API请求失败';
      let errorCode = 'API_ERROR';
      
      try {
        const errData = await response.json();
        errorMsg = errData.error?.message || errData.message || JSON.stringify(errData);
      } catch (e) {}
      
      // 根据状态码判断错误类型
      if (response.status === 401 || response.status === 403) {
        errorMsg = 'API密钥错误，请检查配置';
        errorCode = 'API_KEY_ERROR';
      } else if (response.status === 404) {
        errorMsg = 'API地址无法连接，请检查配置';
        errorCode = 'API_URL_ERROR';
      } else if (response.status === 429) {
        errorMsg = '请求过于频繁，请稍后重试';
        errorCode = 'RATE_LIMITED';
      } else if (response.status >= 500) {
        errorMsg = 'API服务异常，请稍后重试';
        errorCode = 'API_SERVER_ERROR';
      }
      
      if (stream) {
        res.setHeader('Content-Type', 'text/event-stream');
        res.setHeader('Cache-Control', 'no-cache');
        res.setHeader('Connection', 'keep-alive');
        res.setHeader('X-Accel-Buffering', 'no');
        res.write(`data: ${JSON.stringify({ error: errorMsg, code: errorCode })}\n\n`);
        res.write('data: [DONE]\n\n');
        res.end();
      } else {
        return res.status(response.status).json({ 
          success: false, 
          error: errorMsg, 
          code: errorCode 
        });
      }
      return;
    }
    
    if (stream) {
      // SSE流式响应
      res.setHeader('Content-Type', 'text/event-stream');
      res.setHeader('Cache-Control', 'no-cache');
      res.setHeader('Connection', 'keep-alive');
      res.setHeader('X-Accel-Buffering', 'no');
      res.flushHeaders?.();
      
      const reader = response.body.getReader();
      const decoder = new TextDecoder();
      let buffer = '';
      let fullContent = '';
      let usage = null;
      let streamStarted = false;
      
      // 设置超时检测（5秒内没有数据则降级为非流式）
      const streamTimeout = setTimeout(() => {
        if (!streamStarted) {
          // 流可能被缓冲了，继续等待但标记一下
          console.log('流式响应可能被缓冲，继续等待...');
        }
      }, 5000);
      
      try {
        while (true) {
          const { done, value } = await reader.read();
          if (done) break;
          
          streamStarted = true;
          buffer += decoder.decode(value, { stream: true });
          const lines = buffer.split('\n');
          buffer = lines.pop() || '';
          
          for (const line of lines) {
            const trimmed = line.trim();
            if (!trimmed || !trimmed.startsWith('data:')) continue;
            
            const data = trimmed.slice(5).trim();
            
            if (data === '[DONE]') {
              // 流结束，处理计费
              clearTimeout(streamTimeout);
              const inputTokens = usage?.prompt_tokens || Math.ceil(requestMessages.reduce((s, m) => s + m.content.length / 2, 0));
              const outputTokens = usage?.completion_tokens || Math.ceil(fullContent.length / 2);
              const totalTokens = inputTokens + outputTokens;
              const riceCost = Math.max(1, Math.ceil(totalTokens / CONFIG.TOKENS_PER_RICE));
              
              // 更新用户余额
              const currentUser = db.prepare('SELECT rice_balance FROM users WHERE id = ?').get(userId);
              const newBalance = Math.max(0, currentUser.rice_balance - riceCost);
              db.prepare('UPDATE users SET rice_balance = ? WHERE id = ?').run(newBalance, userId);
              
              // 记录交易
              db.prepare(`
                INSERT INTO transactions (user_id, type, amount, balance_after, description, detail, created_at)
                VALUES (?, 'consume', ?, ?, '与' || ? || '对话', ?, ?)
              `).run(userId, riceCost, newBalance, character.name, 
                    JSON.stringify({ inputTokens, outputTokens, totalTokens, riceCost }), 
                    Date.now());
              
              // 保存AI消息
              db.prepare(`
                INSERT INTO messages (conversation_id, role, content, created_at)
                VALUES (?, 'assistant', ?, ?)
              `).run(convId, fullContent, Date.now());
              
              res.write(`data: ${JSON.stringify({ 
                done: true, 
                usage: { inputTokens, outputTokens, totalTokens, riceCost },
                rice_balance: newBalance,
                conversation_id: convId
              })}\n\n`);
              res.write('data: [DONE]\n\n');
              res.end();
              return;
            }
            
            try {
              const parsed = JSON.parse(data);
              
              // 记录usage信息
              if (parsed.usage) {
                usage = parsed.usage;
              }
              
              const content = parsed.choices?.[0]?.delta?.content;
              if (content) {
                fullContent += content;
                res.write(`data: ${JSON.stringify({ content })}\n\n`);
              }
            } catch (e) {
              // 忽略解析错误
            }
          }
        }
        
        // 如果流结束但没有usage，手动计算
        clearTimeout(streamTimeout);
        if (!usage && fullContent) {
          const inputTokens = Math.ceil(requestMessages.reduce((s, m) => s + m.content.length / 2, 0));
          const outputTokens = Math.ceil(fullContent.length / 2);
          const totalTokens = inputTokens + outputTokens;
          const riceCost = Math.max(1, Math.ceil(totalTokens / CONFIG.TOKENS_PER_RICE));
          
          const currentUser = db.prepare('SELECT rice_balance FROM users WHERE id = ?').get(userId);
          const newBalance = Math.max(0, currentUser.rice_balance - riceCost);
          db.prepare('UPDATE users SET rice_balance = ? WHERE id = ?').run(newBalance, userId);
          
          db.prepare(`
            INSERT INTO transactions (user_id, type, amount, balance_after, description, detail, created_at)
          VALUES (?, 'consume', ?, ?, '与' || ? || '对话', ?, ?)
          `).run(userId, riceCost, newBalance, character.name,
                JSON.stringify({ inputTokens, outputTokens, totalTokens, riceCost }),
                Date.now());
          
          db.prepare(`
            INSERT INTO messages (conversation_id, role, content, created_at)
            VALUES (?, 'assistant', ?, ?)
          `).run(convId, fullContent, Date.now());
          
          res.write(`data: ${JSON.stringify({ 
            done: true, 
            usage: { inputTokens, outputTokens, totalTokens, riceCost },
            rice_balance: newBalance,
            conversation_id: convId
          })}\n\n`);
        }
        
        res.write('data: [DONE]\n\n');
        res.end();
      } catch (streamErr) {
        clearTimeout(streamTimeout);
        console.error('流式响应出错，尝试非流式降级:', streamErr);
        
        // 流式失败，尝试非流式
        try {
          await handleNonStreamResponse(apiUrl, requestMessages, character, userId, convId, res);
        } catch (fallbackErr) {
          console.error('非流式降级也失败:', fallbackErr);
          res.write(`data: ${JSON.stringify({ error: '网络异常，请重试', code: 'NETWORK_ERROR' })}\n\n`);
          res.write('data: [DONE]\n\n');
          res.end();
        }
      }
    } else {
      // 非流式响应
      await handleNonStreamResponse(apiUrl, requestMessages, character, userId, convId, res);
    }
  } catch (err) {
    console.error('聊天请求失败:', err);
    
    let errorMsg = '网络异常，请重试';
    let errorCode = 'NETWORK_ERROR';
    
    if (err.message.includes('fetch') || err.message.includes('network') || err.message.includes('ECONNREFUSED')) {
      errorMsg = 'API地址无法连接，请检查配置';
      errorCode = 'API_URL_ERROR';
    } else if (err.message.includes('401') || err.message.includes('403')) {
      errorMsg = 'API密钥错误，请检查配置';
      errorCode = 'API_KEY_ERROR';
    }
    
    if (stream) {
      res.setHeader('Content-Type', 'text/event-stream');
      res.setHeader('Cache-Control', 'no-cache');
      res.setHeader('Connection', 'keep-alive');
      res.setHeader('X-Accel-Buffering', 'no');
      res.write(`data: ${JSON.stringify({ error: errorMsg, code: errorCode })}\n\n`);
      res.write('data: [DONE]\n\n');
      res.end();
    } else {
      res.status(500).json({ success: false, error: errorMsg, code: errorCode });
    }
  }
});

// 非流式响应处理函数
async function handleNonStreamResponse(apiUrl, requestMessages, character, userId, convId, res) {
  const response = await fetch(apiUrl, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${CONFIG.API_KEY}`
    },
    body: JSON.stringify({
      model: CONFIG.DEFAULT_MODEL,
      messages: requestMessages,
      stream: false,
      temperature: 0.8,
      max_tokens: 1024
    })
  });
  
  if (!response.ok) {
    let errorMsg = 'API请求失败';
    let errorCode = 'API_ERROR';
    
    try {
      const errData = await response.json();
      errorMsg = errData.error?.message || errData.message || JSON.stringify(errData);
    } catch (e) {}
    
    if (response.status === 401 || response.status === 403) {
      errorMsg = 'API密钥错误，请检查配置';
      errorCode = 'API_KEY_ERROR';
    } else if (response.status === 404) {
      errorMsg = 'API地址无法连接，请检查配置';
      errorCode = 'API_URL_ERROR';
    }
    
    throw new Error(errorMsg);
  }
  
  const data = await response.json();
  const content = data.choices?.[0]?.message?.content || '';
  const usage = data.usage || {};
  const inputTokens = usage.prompt_tokens || 0;
  const outputTokens = usage.completion_tokens || 0;
  const totalTokens = inputTokens + outputTokens;
  const riceCost = Math.max(1, Math.ceil(totalTokens / CONFIG.TOKENS_PER_RICE));
  
  // 更新用户余额
  const currentUser = db.prepare('SELECT rice_balance FROM users WHERE id = ?').get(userId);
  const newBalance = Math.max(0, currentUser.rice_balance - riceCost);
  db.prepare('UPDATE users SET rice_balance = ? WHERE id = ?').run(newBalance, userId);
  
  // 记录交易
  db.prepare(`
    INSERT INTO transactions (user_id, type, amount, balance_after, description, detail, created_at)
    VALUES (?, 'consume', ?, ?, '与' || ? || '对话', ?, ?)
  `).run(userId, riceCost, newBalance, character.name,
        JSON.stringify({ inputTokens, outputTokens, totalTokens, riceCost }),
        Date.now());
  
  // 保存AI消息
  db.prepare(`
    INSERT INTO messages (conversation_id, role, content, created_at)
    VALUES (?, 'assistant', ?, ?)
  `).run(convId, content, Date.now());
  
  // 如果是流式请求的降级，用SSE格式返回
  if (res.getHeader && res.getHeader('Content-Type') === 'text/event-stream') {
    res.write(`data: ${JSON.stringify({ content })}\n\n`);
    res.write(`data: ${JSON.stringify({ 
      done: true, 
      usage: { inputTokens, outputTokens, totalTokens, riceCost },
      rice_balance: newBalance,
      conversation_id: convId
    })}\n\n`);
    res.write('data: [DONE]\n\n');
    res.end();
  } else {
    res.json({
      success: true,
      data: {
        content,
        usage: { inputTokens, outputTokens, totalTokens, riceCost },
        rice_balance: newBalance,
        conversation_id: convId
      }
    });
  }
}

// ==================== 论坛系统 API ====================

// 论坛帖子生成提示词模板
const FORUM_POST_PROMPTS = {
  following: (characterName, persona) => `你是${characterName}，根据以下人设：${persona}

请以第一人称视角发布一条论坛帖子，分享你的日常生活、心情或感悟。

要求：
- 完全代入角色，用第一人称"我"来写
- 语气要符合角色人设
- 内容真实自然，像真实的社交平台帖子
- 长度适中，100-200字左右
- 可以带一些表情符号
- 不要提及你是AI

请直接返回帖子内容，不要加标题或其他说明。`,
  
  recommended: () => `请生成一条有趣的社交平台帖子，内容可以是生活分享、搞笑段子、情感感悟、美食推荐、旅行见闻等。

要求：
- 内容真实自然，像真实用户发的帖子
- 语气活泼有趣
- 长度适中，100-200字左右
- 可以带一些表情符号
- 要有话题标签（#话题#）

请直接返回帖子内容，不要加标题或其他说明。`,
  
  gossip: () => `请生成一条八卦话题类的论坛帖子，内容要有话题性、讨论度，比如情感话题、职场八卦、生活吐槽等。

要求：
- 内容要有话题性，能引发讨论
- 语气像真实用户在吐槽或分享
- 长度适中，150-250字左右
- 要有明确的话题标签
- 可以带一些表情符号

请直接返回帖子内容，不要加标题或其他说明。`
};

// 评论作者昵称池
const FORUM_COMMENT_AUTHORS = [
  '碎碎念bot', '深夜食堂', '柠檬不萌', '星河滚烫', '草莓味晚风',
  '云朵邮局', '人间清醒', '气泡水加冰', '银河系迷路', '温柔半两',
  '海盐焦糖', '落日余晖', '猫薄荷', '今日份快乐', '南风知我意',
  '月亮失约了', '小熊软糖', '夏日限定', '晚风告白', '甜度超标'
];

// 热搜话题
const HOT_TOPICS = [
  { id: 1, tag: '今日份快乐', count: 12580, hot: true },
  { id: 2, tag: '深夜emo', count: 9876, hot: true },
  { id: 3, tag: '打工人日常', count: 8654, hot: true },
  { id: 4, tag: '美食分享', count: 7432, hot: false },
  { id: 5, tag: '穿搭分享', count: 6543, hot: false },
  { id: 6, tag: '旅行日记', count: 5678, hot: false },
  { id: 7, tag: '宠物日常', count: 4987, hot: false },
  { id: 8, tag: '读书打卡', count: 4321, hot: false },
  { id: 9, tag: '健身记录', count: 3876, hot: false },
  { id: 10, tag: '追剧日常', count: 3456, hot: false }
];

// 调用AI生成内容
async function generateContent(prompt, maxTokens = 500) {
  if (!CONFIG.API_KEY || !CONFIG.API_BASE_URL) {
    throw new Error('API未配置');
  }
  
  const apiUrl = buildApiUrl(CONFIG.API_BASE_URL);
  
  const response = await fetch(apiUrl, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${CONFIG.API_KEY}`
    },
    body: JSON.stringify({
      model: CONFIG.DEFAULT_MODEL,
      messages: [{ role: 'user', content: prompt }],
      stream: false,
      temperature: 0.9,
      max_tokens: maxTokens
    })
  });
  
  if (!response.ok) {
    throw new Error('API请求失败');
  }
  
  const data = await response.json();
  return data.choices?.[0]?.message?.content || '';
}

// 生成备用评论（API失败时使用）
function generateFallbackComments(postContent, count = 3) {
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
    '楼主继续更新啊',
    '太有共鸣了',
    '我也想这样',
    '好可爱啊'
  ];
  
  const comments = [];
  const usedAuthors = new Set();
  
  for (let i = 0; i < count; i++) {
    let author;
    do {
      author = FORUM_COMMENT_AUTHORS[Math.floor(Math.random() * FORUM_COMMENT_AUTHORS.length)];
    } while (usedAuthors.has(author));
    usedAuthors.add(author);
    
    comments.push({
      author_name: author,
      author_avatar: '',
      content: templates[Math.floor(Math.random() * templates.length)],
      created_at: Date.now() - Math.random() * 3600000
    });
  }
  
  return comments;
}

// 获取帖子列表
app.get('/api/forum/posts', authMiddleware, (req, res) => {
  try {
    const { tab = 'recommended', page = 1, pageSize } = req.query;
    const userId = req.user.id;
    const size = parseInt(pageSize) || CONFIG.FORUM_PAGE_SIZE;
    const pageNum = parseInt(page);
    
    let posts = db.prepare('SELECT * FROM forum_posts ORDER BY created_at DESC').all();
    
    // 根据tab筛选
    if (tab === 'following') {
      // 关注的角色的帖子
      const follows = db.prepare('SELECT * FROM forum_follows WHERE user_id = ?').all(userId);
      const followedRoleIds = follows.map(f => f.role_id);
      posts = posts.filter(p => p.author_type === 'character' && followedRoleIds.includes(p.author_id));
    } else if (tab === 'gossip') {
      // 八卦类帖子
      posts = posts.filter(p => p.category === 'gossip');
    }
    
    // 关联作者信息
    const result = posts.map(post => {
      let authorName = '';
      let authorAvatar = '';
      
      if (post.author_type === 'character') {
        const char = db.prepare('SELECT name, avatar FROM characters WHERE id = ?').get(post.author_id);
        authorName = char?.name || '未知角色';
        authorAvatar = char?.avatar || '';
      } else {
        const user = db.prepare('SELECT nickname, avatar FROM users WHERE id = ?').get(post.author_id);
        authorName = user?.nickname || '匿名用户';
        authorAvatar = user?.avatar || '';
      }
      
      // 检查是否已点赞
      const liked = db.prepare('SELECT id FROM forum_likes WHERE post_id = ? AND user_id = ? AND type = ?').get(post.id, userId, 'like');
      
      // 检查是否已收藏
      const saved = db.prepare('SELECT id FROM forum_likes WHERE post_id = ? AND user_id = ? AND type = ?').get(post.id, userId, 'save');
      
      return {
        id: post.id,
        author_id: post.author_id,
        author_type: post.author_type,
        author_name: authorName,
        author_avatar: authorAvatar,
        author_tag: post.author_tag || '',
        content: post.content,
        images: JSON.parse(post.images || '[]'),
        category: post.category,
        tags: JSON.parse(post.tags || '[]'),
        likes: post.likes || 0,
        comments: post.comments || 0,
        saves: post.saves || 0,
        is_liked: !!liked,
        is_saved: !!saved,
        created_at: post.created_at
      };
    });
    
    const total = result.length;
    const start = (pageNum - 1) * size;
    const paginatedResult = result.slice(start, start + size);
    
    res.json({
      success: true,
      data: {
        list: paginatedResult,
        total,
        page: pageNum,
        pageSize: size
      }
    });
  } catch (err) {
    console.error('获取帖子列表失败:', err);
    res.status(500).json({ success: false, error: err.message });
  }
});

// 生成AI帖子
app.post('/api/forum/generate', authMiddleware, async (req, res) => {
  try {
    const userId = req.user.id;
    const user = req.user;
    const { tab = 'recommended', characterId } = req.body;
    
    // 检查余额
    if (user.rice_balance < CONFIG.FORUM_POST_COST) {
      return res.status(402).json({
        success: false,
        error: '米粒不足，生成帖子需要' + CONFIG.FORUM_POST_COST + '米粒',
        code: 'RICE_NOT_ENOUGH'
      });
    }
    
    let prompt;
    let authorType = 'system';
    let authorId = 0;
    let authorTag = '';
    let category = 'recommended';
    
    if (tab === 'following' && characterId) {
      // 关注页：角色第一人称
      const character = db.prepare('SELECT * FROM characters WHERE id = ?').get(characterId);
      if (!character) {
        return res.status(404).json({ success: false, error: '角色不存在' });
      }
      prompt = FORUM_POST_PROMPTS.following(character.name, character.persona);
      authorType = 'character';
      authorId = character.id;
      authorTag = '角色';
      category = 'following';
    } else if (tab === 'gossip') {
      // 八卦页
      prompt = FORUM_POST_PROMPTS.gossip();
      category = 'gossip';
      authorTag = '热门话题';
    } else {
      // 推荐页
      prompt = FORUM_POST_PROMPTS.recommended();
      authorTag = '推荐';
    }
    
    // 生成帖子内容
    let content;
    try {
      content = await generateContent(prompt, 400);
    } catch (err) {
      console.error('生成帖子失败，使用备用内容:', err);
      content = '今天天气真好，心情也跟着好起来了～ 分享一下今天的小确幸，希望大家也能开心每一天！✨ #今日份快乐#';
    }
    
    // 扣除米粒
    const newBalance = Math.max(0, user.rice_balance - CONFIG.FORUM_POST_COST);
    db.prepare('UPDATE users SET rice_balance = ? WHERE id = ?').run(newBalance, userId);
    
    // 记录交易
    const now = Date.now();
    db.prepare(`
      INSERT INTO transactions (user_id, type, amount, balance_after, description, created_at)
      VALUES (?, 'consume', ?, ?, '生成论坛帖子', ?)
    `).run(userId, CONFIG.FORUM_POST_COST, newBalance, now);
    
    // 保存帖子
    const result = db.prepare(`
      INSERT INTO forum_posts (author_id, author_type, author_tag, content, images, category, tags, likes, comments, saves, created_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, 0, 0, 0, ?)
    `).run(
      authorId,
      authorType,
      authorTag,
      content,
      JSON.stringify([]),
      category,
      JSON.stringify([]),
      now
    );
    
    const postId = result.lastInsertRowid;
    
    // 生成3-5条评论
    let comments = [];
    try {
      const commentPrompt = `根据以下帖子内容，生成3-5条不同用户的评论，每条评论20-50字，风格各异，像真实的社交平台评论。

帖子内容：${content}

请以JSON数组格式返回，每条包含author_name（用户名）和content（评论内容）。`;
      
      const commentResult = await generateContent(commentPrompt, 600);
      // 尝试解析JSON
      try {
        const parsed = JSON.parse(commentResult);
        if (Array.isArray(parsed)) {
          comments = parsed.map(c => ({
            author_name: c.author_name || '匿名用户',
            author_avatar: '',
            content: c.content || '',
            created_at: now + Math.random() * 3600000
          }));
        }
      } catch (e) {
        // JSON解析失败，使用备用评论
        comments = generateFallbackComments(content, 3);
      }
    } catch (err) {
      console.error('生成评论失败，使用备用评论:', err);
      comments = generateFallbackComments(content, 3);
    }
    
    // 保存评论
    comments.forEach(comment => {
      db.prepare(`
        INSERT INTO forum_comments (post_id, author_name, author_avatar, content, created_at)
        VALUES (?, ?, ?, ?, ?)
      `).run(postId, comment.author_name, comment.author_avatar, comment.content, comment.created_at);
    });
    
    // 更新帖子评论数
    db.prepare('UPDATE forum_posts SET comments = ? WHERE id = ?').run(comments.length, postId);
    
    // 返回帖子信息
    const post = db.prepare('SELECT * FROM forum_posts WHERE id = ?').get(postId);
    
    res.json({
      success: true,
      data: {
        post: {
          id: post.id,
          author_id: post.author_id,
          author_type: post.author_type,
          author_name: authorType === 'character' ? 
            (db.prepare('SELECT name FROM characters WHERE id = ?').get(post.author_id)?.name || '') : 
            (db.prepare('SELECT nickname FROM users WHERE id = ?').get(post.author_id)?.nickname || ''),
          author_avatar: '',
          author_tag: post.author_tag,
          content: post.content,
          images: JSON.parse(post.images || '[]'),
          category: post.category,
          tags: JSON.parse(post.tags || '[]'),
          likes: post.likes,
          comments: post.comments,
          saves: post.saves,
          is_liked: false,
          is_saved: false,
          created_at: post.created_at
        },
        rice_balance: newBalance
      }
    });
  } catch (err) {
    console.error('生成帖子失败:', err);
    res.status(500).json({ success: false, error: err.message });
  }
});

// 获取帖子详情
app.get('/api/forum/posts/:id', authMiddleware, (req, res) => {
  try {
    const postId = req.params.id;
    const userId = req.user.id;
    
    const post = db.prepare('SELECT * FROM forum_posts WHERE id = ?').get(postId);
    if (!post) {
      return res.status(404).json({ success: false, error: '帖子不存在' });
    }
    
    // 获取作者信息
    let authorName = '';
    let authorAvatar = '';
    
    if (post.author_type === 'character') {
      const char = db.prepare('SELECT name, avatar FROM characters WHERE id = ?').get(post.author_id);
      authorName = char?.name || '未知角色';
      authorAvatar = char?.avatar || '';
    } else {
      const user = db.prepare('SELECT nickname, avatar FROM users WHERE id = ?').get(post.author_id);
      authorName = user?.nickname || '匿名用户';
      authorAvatar = user?.avatar || '';
    }
    
    // 检查是否已点赞
    const liked = db.prepare('SELECT id FROM forum_likes WHERE post_id = ? AND user_id = ? AND type = ?').get(postId, userId, 'like');
    
    // 检查是否已收藏
    const saved = db.prepare('SELECT id FROM forum_likes WHERE post_id = ? AND user_id = ? AND type = ?').get(postId, userId, 'save');
    
    res.json({
      success: true,
      data: {
        id: post.id,
        author_id: post.author_id,
        author_type: post.author_type,
        author_name: authorName,
        author_avatar: authorAvatar,
        author_tag: post.author_tag || '',
        content: post.content,
        images: JSON.parse(post.images || '[]'),
        category: post.category,
        tags: JSON.parse(post.tags || '[]'),
        likes: post.likes || 0,
        comments: post.comments || 0,
        saves: post.saves || 0,
        is_liked: !!liked,
        is_saved: !!saved,
        created_at: post.created_at
      }
    });
  } catch (err) {
    console.error('获取帖子详情失败:', err);
    res.status(500).json({ success: false, error: err.message });
  }
});

// 点赞帖子
app.post('/api/forum/posts/:id/like', authMiddleware, (req, res) => {
  try {
    const postId = req.params.id;
    const userId = req.user.id;
    
    const post = db.prepare('SELECT * FROM forum_posts WHERE id = ?').get(postId);
    if (!post) {
      return res.status(404).json({ success: false, error: '帖子不存在' });
    }
    
    // 检查是否已点赞
    const existing = db.prepare('SELECT * FROM forum_likes WHERE post_id = ? AND user_id = ? AND type = ?').get(postId, userId, 'like');
    
    if (existing) {
      // 取消点赞
      db.prepare('DELETE FROM forum_likes WHERE id = ?').run(existing.id);
      db.prepare('UPDATE forum_posts SET likes = MAX(0, likes - 1) WHERE id = ?').run(postId);
    } else {
      // 点赞
      db.prepare('INSERT INTO forum_likes (post_id, user_id, type, created_at) VALUES (?, ?, ?, ?)').run(postId, userId, 'like', Date.now());
      db.prepare('UPDATE forum_posts SET likes = likes + 1 WHERE id = ?').run(postId);
    }
    
    const updated = db.prepare('SELECT likes FROM forum_posts WHERE id = ?').get(postId);
    
    res.json({
      success: true,
      data: {
        likes: updated.likes,
        is_liked: !existing
      }
    });
  } catch (err) {
    console.error('点赞失败:', err);
    res.status(500).json({ success: false, error: err.message });
  }
});

// 收藏帖子
app.post('/api/forum/posts/:id/save', authMiddleware, (req, res) => {
  try {
    const postId = req.params.id;
    const userId = req.user.id;
    
    const post = db.prepare('SELECT * FROM forum_posts WHERE id = ?').get(postId);
    if (!post) {
      return res.status(404).json({ success: false, error: '帖子不存在' });
    }
    
    // 检查是否已收藏
    const existing = db.prepare('SELECT * FROM forum_likes WHERE post_id = ? AND user_id = ? AND type = ?').get(postId, userId, 'save');
    
    if (existing) {
      // 取消收藏
      db.prepare('DELETE FROM forum_likes WHERE id = ?').run(existing.id);
      db.prepare('UPDATE forum_posts SET saves = MAX(0, saves - 1) WHERE id = ?').run(postId);
    } else {
      // 收藏
      db.prepare('INSERT INTO forum_likes (post_id, user_id, type, created_at) VALUES (?, ?, ?, ?)').run(postId, userId, 'save', Date.now());
      db.prepare('UPDATE forum_posts SET saves = saves + 1 WHERE id = ?').run(postId);
    }
    
    const updated = db.prepare('SELECT saves FROM forum_posts WHERE id = ?').get(postId);
    
    res.json({
      success: true,
      data: {
        saves: updated.saves,
        is_saved: !existing
      }
    });
  } catch (err) {
    console.error('收藏失败:', err);
    res.status(500).json({ success: false, error: err.message });
  }
});

// 获取评论列表
app.get('/api/forum/posts/:id/comments', authMiddleware, (req, res) => {
  try {
    const postId = req.params.id;
    const { page = 1, pageSize = 20 } = req.query;
    const size = parseInt(pageSize);
    const pageNum = parseInt(page);
    
    const comments = db.prepare('SELECT * FROM forum_comments WHERE post_id = ? ORDER BY created_at DESC').all(postId);
    
    const start = (pageNum - 1) * size;
    const result = comments.slice(start, start + size);
    
    res.json({
      success: true,
      data: {
        list: result,
        total: comments.length,
        page: pageNum,
        pageSize: size
      }
    });
  } catch (err) {
    console.error('获取评论失败:', err);
    res.status(500).json({ success: false, error: err.message });
  }
});

// 发表评论
app.post('/api/forum/posts/:id/comments', authMiddleware, (req, res) => {
  try {
    const postId = req.params.id;
    const userId = req.user.id;
    const { content } = req.body;
    
    if (!content || !content.trim()) {
      return res.status(400).json({ success: false, error: '评论内容不能为空' });
    }
    
    const post = db.prepare('SELECT * FROM forum_posts WHERE id = ?').get(postId);
    if (!post) {
      return res.status(404).json({ success: false, error: '帖子不存在' });
    }
    
    const user = req.user;
    const now = Date.now();
    
    db.prepare(`
      INSERT INTO forum_comments (post_id, user_id, author_name, author_avatar, content, created_at)
      VALUES (?, ?, ?, ?, ?, ?)
    `).run(postId, userId, user.nickname || user.username, user.avatar || '', content.trim(), now);
    
    // 更新评论数
    db.prepare('UPDATE forum_posts SET comments = comments + 1 WHERE id = ?').run(postId);
    
    res.json({
      success: true,
      data: {
        id: 0, // 自增ID
        post_id: postId,
        user_id: userId,
        author_name: user.nickname || user.username,
        author_avatar: user.avatar || '',
        content: content.trim(),
        created_at: now
      }
    });
  } catch (err) {
    console.error('发表评论失败:', err);
    res.status(500).json({ success: false, error: err.message });
  }
});

// 关注/取消关注角色
app.post('/api/forum/follow/:roleId', authMiddleware, (req, res) => {
  try {
    const roleId = req.params.roleId;
    const userId = req.user.id;
    
    const character = db.prepare('SELECT * FROM characters WHERE id = ?').get(roleId);
    if (!character) {
      return res.status(404).json({ success: false, error: '角色不存在' });
    }
    
    // 检查是否已关注
    const existing = db.prepare('SELECT * FROM forum_follows WHERE user_id = ? AND role_id = ?').get(userId, roleId);
    
    if (existing) {
      // 取消关注
      db.prepare('DELETE FROM forum_follows WHERE id = ?').run(existing.id);
    } else {
      // 关注
      db.prepare('INSERT INTO forum_follows (user_id, role_id, created_at) VALUES (?, ?, ?)').run(userId, roleId, Date.now());
    }
    
    res.json({
      success: true,
      data: {
        is_following: !existing
      }
    });
  } catch (err) {
    console.error('关注失败:', err);
    res.status(500).json({ success: false, error: err.message });
  }
});

// 获取关注列表
app.get('/api/forum/follows', authMiddleware, (req, res) => {
  try {
    const userId = req.user.id;
    
    const follows = db.prepare('SELECT * FROM forum_follows WHERE user_id = ? ORDER BY created_at DESC').all(userId);
    
    const result = follows.map(f => {
      const char = db.prepare('SELECT name, avatar, description FROM characters WHERE id = ?').get(f.role_id);
      return {
        role_id: f.role_id,
        name: char?.name || '',
        avatar: char?.avatar || '',
        description: char?.description || '',
        followed_at: f.created_at
      };
    });
    
    res.json({
      success: true,
      data: result
    });
  } catch (err) {
    console.error('获取关注列表失败:', err);
    res.status(500).json({ success: false, error: err.message });
  }
});

// 热搜榜
app.get('/api/forum/hot-search', (req, res) => {
  res.json({
    success: true,
    data: HOT_TOPICS
  });
});

// 个人主页
app.get('/api/forum/profile', authMiddleware, (req, res) => {
  try {
    const userId = req.user.id;
    const user = req.user;
    
    // 我的帖子（用户自己发的，目前没有，返回空）
    const myPosts = [];
    
    // 我的收藏
    const savedLikes = db.prepare("SELECT * FROM forum_likes WHERE user_id = ? AND type = 'save' ORDER BY created_at DESC").all(userId);
    const savedPosts = savedLikes.map(sl => {
      const post = db.prepare('SELECT * FROM forum_posts WHERE id = ?').get(sl.post_id);
      if (!post) return null;
      
      let authorName = '';
      if (post.author_type === 'character') {
        const char = db.prepare('SELECT name FROM characters WHERE id = ?').get(post.author_id);
        authorName = char?.name || '';
      }
      
      return {
        id: post.id,
        author_name: authorName,
        content: post.content,
        images: JSON.parse(post.images || '[]'),
        likes: post.likes,
        comments: post.comments,
        saved_at: sl.created_at
      };
    }).filter(p => p !== null);
    
    // 我的关注
    const follows = db.prepare('SELECT * FROM forum_follows WHERE user_id = ? ORDER BY created_at DESC').all(userId);
    const followedRoles = follows.map(f => {
      const char = db.prepare('SELECT name, avatar FROM characters WHERE id = ?').get(f.role_id);
      return {
        role_id: f.role_id,
        name: char?.name || '',
        avatar: char?.avatar || ''
      };
    });
    
    res.json({
      success: true,
      data: {
        user: {
          id: user.id,
          nickname: user.nickname,
          avatar: user.avatar,
          description: user.description
        },
        my_posts: myPosts,
        saved_posts: savedPosts,
        followed_roles: followedRoles,
        stats: {
          posts_count: myPosts.length,
          saved_count: savedPosts.length,
          following_count: followedRoles.length
        }
      }
    });
  } catch (err) {
    console.error('获取个人主页失败:', err);
    res.status(500).json({ success: false, error: err.message });
  }
});

// ==================== 同人文系统 API ====================

// 同人文标签分类
const FANFIC_CATEGORIES = [
  { id: 'all', name: '全部', icon: '📚' },
  { id: 'danmei', name: '耽美', icon: '💕' },
  { id: 'yanqing', name: '言情', icon: '💖' },
  { id: 'xuanhuan', name: '玄幻', icon: '⚔️' },
  { id: 'xiaoyuan', name: '校园', icon: '🎓' },
  { id: 'dushi', name: '都市', icon: '🏙️' },
  { id: 'gufeng', name: '古风', icon: '🏮' },
  { id: 'kehuan', name: '科幻', icon: '🚀' }
];

// 同人文梗/套路
const FANFIC_TROPES = [
  { id: 'nianxia', name: '年下', description: '年龄小的攻/受' },
  { id: 'zhuiqi', name: '追妻火葬场', description: '失去后才懂得珍惜' },
  { id: 'pojing', name: '破镜重圆', description: '分手后重新在一起' },
  { id: 'shuangxiang', name: '双向暗恋', description: '互相喜欢却不知道' },
  { id: 'xianhun', name: '先婚后爱', description: '先结婚再谈恋爱' },
  { id: 'tishen', name: '替身', description: '把对方当替身' },
  { id: 'chongsheng', name: '重生', description: '重来一次改变命运' },
  { id: 'chuanyue', name: '穿越', description: '穿越到另一个世界' },
  { id: 'baoyang', name: '包养', description: '金钱关系变真爱' },
  { id: 'enemies', name: '欢喜冤家', description: '从敌人变恋人' },
  { id: 'zhujiao', name: '主角光环', description: '穿越成小说主角' },
  { id: 'shijie', name: '世界线', description: '平行世界的相遇' }
];

// 生成同人文提示词
function buildFanficPrompt(character1, character2, category, trope, customTags = []) {
  const char1Desc = character1 ? `${character1.name}：${character1.persona || character1.description || ''}` : '';
  const char2Desc = character2 ? `${character2.name}：${character2.persona || character2.description || ''}` : '';
  
  const tropeInfo = FANFIC_TROPES.find(t => t.id === trope);
  const categoryInfo = FANFIC_CATEGORIES.find(c => c.id === category);
  
  return `你是一位深谙同人文创作精髓的写手，擅长写有代入感、有CP感的故事。

【角色设定】
${char1Desc}
${char2Desc}

【故事类型】
分类：${categoryInfo?.name || '综合'}
梗/套路：${tropeInfo?.name || trope} - ${tropeInfo?.description || ''}

【创作要求】
1. 双主角叙事，两个主角都要有戏份和互动
2. 要有CP感，有情感张力，有性张力
3. 故事要有起承转合，前因、发展、高潮、结尾完整
4. 文笔细腻，对话生动，符合人物设定
5. 字数控制在1500-2000字左右
6. 分段落排版，每段不要太长
7. 不要OOC，保持角色性格特点
8. 要有梗，有看点，能吸引人

请直接返回小说正文，不要加标题或其他说明。`;
}

// 获取同人文标签分类
app.get('/api/fanfic/categories', (req, res) => {
  res.json({
    success: true,
    data: FANFIC_CATEGORIES
  });
});

// 获取同人文梗/套路
app.get('/api/fanfic/tropes', (req, res) => {
  res.json({
    success: true,
    data: FANFIC_TROPES
  });
});

// 获取作品列表
app.get('/api/fanfic/works', authMiddleware, (req, res) => {
  try {
    const { category = 'all', page = 1, pageSize } = req.query;
    const userId = req.user.id;
    const size = parseInt(pageSize) || CONFIG.FANFIC_PAGE_SIZE;
    const pageNum = parseInt(page);
    
    let works = db.prepare('SELECT * FROM fanfic_works ORDER BY created_at DESC').all();
    
    // 按分类筛选
    if (category !== 'all') {
      works = works.filter(w => w.category === category);
    }
    
    // 关联角色信息
    const result = works.map(work => {
      let char1Name = '';
      let char2Name = '';
      
      if (work.character1_id) {
        const char1 = db.prepare('SELECT name, avatar FROM characters WHERE id = ?').get(work.character1_id);
        char1Name = char1?.name || '';
      }
      if (work.character2_id) {
        const char2 = db.prepare('SELECT name, avatar FROM characters WHERE id = ?').get(work.character2_id);
        char2Name = char2?.name || '';
      }
      
      // 检查是否在书架
      const inShelf = db.prepare('SELECT id FROM fanfic_shelf WHERE user_id = ? AND work_id = ?').get(userId, work.id);
      
      return {
        id: work.id,
        title: work.title,
        cover: work.cover || '',
        category: work.category,
        trope: work.trope,
        tags: JSON.parse(work.tags || '[]'),
        word_count: work.word_count || 0,
        character1_name: char1Name,
        character2_name: char2Name,
        author: work.author || 'AI生成',
        excerpt: work.excerpt || '',
        in_shelf: !!inShelf,
        created_at: work.created_at
      };
    });
    
    const total = result.length;
    const start = (pageNum - 1) * size;
    const paginatedResult = result.slice(start, start + size);
    
    res.json({
      success: true,
      data: {
        list: paginatedResult,
        total,
        page: pageNum,
        pageSize: size
      }
    });
  } catch (err) {
    console.error('获取作品列表失败:', err);
    res.status(500).json({ success: false, error: err.message });
  }
});

// 生成同人文
app.post('/api/fanfic/generate', authMiddleware, async (req, res) => {
  try {
    const userId = req.user.id;
    const user = req.user;
    const { character1Id, character2Id, category = 'danmei', trope = 'pojing', customTags = [] } = req.body;
    
    // 检查余额
    if (user.rice_balance < CONFIG.FANFIC_COST) {
      return res.status(402).json({
        success: false,
        error: '米粒不足，生成同人文需要' + CONFIG.FANFIC_COST + '米粒',
        code: 'RICE_NOT_ENOUGH'
      });
    }
    
    // 获取角色信息
    let character1 = null;
    let character2 = null;
    
    if (character1Id) {
      character1 = db.prepare('SELECT * FROM characters WHERE id = ?').get(character1Id);
    }
    if (character2Id) {
      character2 = db.prepare('SELECT * FROM characters WHERE id = ?').get(character2Id);
    }
    
    if (!character1 && !character2) {
      return res.status(400).json({ success: false, error: '至少选择一个角色' });
    }
    
    // 构建提示词
    const prompt = buildFanficPrompt(character1, character2, category, trope, customTags);
    
    // 扣除米粒
    const newBalance = Math.max(0, user.rice_balance - CONFIG.FANFIC_COST);
    db.prepare('UPDATE users SET rice_balance = ? WHERE id = ?').run(newBalance, userId);
    
    // 记录交易
    const now = Date.now();
    db.prepare(`
      INSERT INTO transactions (user_id, type, amount, balance_after, description, created_at)
      VALUES (?, 'consume', ?, ?, '生成同人文', ?)
    `).run(userId, CONFIG.FANFIC_COST, newBalance, now);
    
    // 生成内容
    let content;
    try {
      content = await generateContent(prompt, 2500);
    } catch (err) {
      console.error('生成同人文失败，使用备用内容:', err);
      content = `（生成失败，这是示例内容）

这是一个关于${character1?.name || '主角'}和${character2?.name || '另一个主角'}的故事。

他们相遇在一个普通的下午，阳光透过树叶洒在地上，形成斑驳的光影。

"你好。"${character1?.name || '他'}说。

"你好。"另一个人回答。

故事就这样开始了...

（请重新生成以获得完整内容）`;
    }
    
    // 生成标题
    let title = `${character1?.name || ''}×${character2?.name || ''}的故事`;
    try {
      const titlePrompt = `根据以下小说内容，给小说起一个吸引人的标题，10-20字左右，要有文艺感。

内容摘要：${content.slice(0, 500)}

请直接返回标题，不要加其他内容。`;
      title = await generateContent(titlePrompt, 50);
      title = title.replace(/["《》]/g, '').trim().slice(0, 30);
    } catch (e) {
      // 标题生成失败，使用默认
    }
    
    // 计算字数
    const wordCount = content.length;
    
    // 生成摘要
    const excerpt = content.slice(0, 100).replace(/\n/g, '') + '...';
    
    // 保存作品
    const result = db.prepare(`
      INSERT INTO fanfic_works (user_id, title, content, excerpt, cover, category, trope, tags, character1_id, character2_id, word_count, author, created_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      userId,
      title,
      content,
      excerpt,
      '',
      category,
      trope,
      JSON.stringify(customTags),
      character1?.id || null,
      character2?.id || null,
      wordCount,
      'AI生成',
      now
    );
    
    const workId = result.lastInsertRowid;
    
    // 自动加入书架
    db.prepare('INSERT INTO fanfic_shelf (user_id, work_id, created_at) VALUES (?, ?, ?)').run(userId, workId, now);
    
    res.json({
      success: true,
      data: {
        work_id: workId,
        title,
        word_count: wordCount,
        rice_balance: newBalance
      }
    });
  } catch (err) {
    console.error('生成同人文失败:', err);
    res.status(500).json({ success: false, error: err.message });
  }
});

// 获取作品详情
app.get('/api/fanfic/works/:id', authMiddleware, (req, res) => {
  try {
    const workId = req.params.id;
    const userId = req.user.id;
    
    const work = db.prepare('SELECT * FROM fanfic_works WHERE id = ?').get(workId);
    if (!work) {
      return res.status(404).json({ success: false, error: '作品不存在' });
    }
    
    // 获取角色信息
    let character1 = null;
    let character2 = null;
    
    if (work.character1_id) {
      const char1 = db.prepare('SELECT id, name, avatar, persona, description FROM characters WHERE id = ?').get(work.character1_id);
      if (char1) {
        character1 = {
          id: char1.id,
          name: char1.name,
          avatar: char1.avatar,
          description: char1.description,
          persona: char1.persona
        };
      }
    }
    if (work.character2_id) {
      const char2 = db.prepare('SELECT id, name, avatar, persona, description FROM characters WHERE id = ?').get(work.character2_id);
      if (char2) {
        character2 = {
          id: char2.id,
          name: char2.name,
          avatar: char2.avatar,
          description: char2.description,
          persona: char2.persona
        };
      }
    }
    
    // 检查是否在书架
    const inShelf = db.prepare('SELECT id FROM fanfic_shelf WHERE user_id = ? AND work_id = ?').get(userId, workId);
    
    res.json({
      success: true,
      data: {
        id: work.id,
        title: work.title,
        content: work.content,
        excerpt: work.excerpt,
        cover: work.cover || '',
        category: work.category,
        trope: work.trope,
        tags: JSON.parse(work.tags || '[]'),
        word_count: work.word_count || 0,
        character1,
        character2,
        author: work.author,
        in_shelf: !!inShelf,
        created_at: work.created_at
      }
    });
  } catch (err) {
    console.error('获取作品详情失败:', err);
    res.status(500).json({ success: false, error: err.message });
  }
});

// 收藏/加入书架
app.post('/api/fanfic/works/:id/save', authMiddleware, (req, res) => {
  try {
    const workId = req.params.id;
    const userId = req.user.id;
    
    const work = db.prepare('SELECT * FROM fanfic_works WHERE id = ?').get(workId);
    if (!work) {
      return res.status(404).json({ success: false, error: '作品不存在' });
    }
    
    // 检查是否已在书架
    const existing = db.prepare('SELECT * FROM fanfic_shelf WHERE user_id = ? AND work_id = ?').get(userId, workId);
    
    if (existing) {
      // 移出书架
      db.prepare('DELETE FROM fanfic_shelf WHERE id = ?').run(existing.id);
    } else {
      // 加入书架
      db.prepare('INSERT INTO fanfic_shelf (user_id, work_id, created_at) VALUES (?, ?, ?)').run(userId, workId, Date.now());
    }
    
    res.json({
      success: true,
      data: {
        in_shelf: !existing
      }
    });
  } catch (err) {
    console.error('收藏失败:', err);
    res.status(500).json({ success: false, error: err.message });
  }
});

// 获取书架
app.get('/api/fanfic/shelf', authMiddleware, (req, res) => {
  try {
    const userId = req.user.id;
    const { tab = 'all' } = req.query;
    
    let shelfItems = db.prepare('SELECT * FROM fanfic_shelf WHERE user_id = ? ORDER BY created_at DESC').all(userId);
    
    // 关联作品信息
    let works = shelfItems.map(item => {
      const work = db.prepare('SELECT * FROM fanfic_works WHERE id = ?').get(item.work_id);
      if (!work) return null;
      
      let char1Name = '';
      let char2Name = '';
      
      if (work.character1_id) {
        const char1 = db.prepare('SELECT name FROM characters WHERE id = ?').get(work.character1_id);
        char1Name = char1?.name || '';
      }
      if (work.character2_id) {
        const char2 = db.prepare('SELECT name FROM characters WHERE id = ?').get(work.character2_id);
        char2Name = char2?.name || '';
      }
      
      return {
        id: work.id,
        title: work.title,
        cover: work.cover || '',
        category: work.category,
        trope: work.trope,
        word_count: work.word_count || 0,
        character1_name: char1Name,
        character2_name: char2Name,
        excerpt: work.excerpt || '',
        added_at: item.created_at,
        is_mine: work.user_id === userId
      };
    }).filter(w => w !== null);
    
    // 按tab筛选
    if (tab === 'mine') {
      works = works.filter(w => w.is_mine);
    } else if (tab === 'saved') {
      works = works.filter(w => !w.is_mine);
    }
    
    res.json({
      success: true,
      data: works
    });
  } catch (err) {
    console.error('获取书架失败:', err);
    res.status(500).json({ success: false, error: err.message });
  }
});

// ==================== 健康检查 ====================
app.get('/api/health', (req, res) => {
  res.json({ success: true, data: { status: 'ok', timestamp: Date.now() } });
});

// ==================== 管理员页面路由 ====================
app.get('/admin', (req, res) => {
  res.sendFile(path.join(__dirname, 'admin.html'));
});

// ==================== SPA路由回退 ====================
app.get('*', (req, res) => {
  res.sendFile(path.join(__dirname, 'index.html'));
});

// ==================== 启动服务 ====================
app.listen(PORT, () => {
  console.log(`\n🚀 Mochi AI Chat v3.0 服务已启动`);
  console.log(`📍 服务地址: http://localhost:${PORT}`);
  console.log(`🔧 API地址: ${CONFIG.API_BASE_URL ? buildApiUrl(CONFIG.API_BASE_URL) : '未配置'}`);
  console.log(`🤖 模型: ${CONFIG.DEFAULT_MODEL}`);
  console.log(`💰 计费方式: 按Token用量计费 (${CONFIG.TOKENS_PER_RICE} token = 1米粒)`);
  console.log(`🎁 新用户赠送: ${CONFIG.NEW_USER_RICE} 米粒`);
  console.log(`💾 数据库: JSON文件存储 (${CONFIG.DATA_DIR})`);
  console.log(`🔐 管理员后台: /admin (密码: ${CONFIG.ADMIN_PASSWORD})`);
  console.log(`⚡ 零编译依赖，支持 Render/Vercel 直接部署\n`);
});
