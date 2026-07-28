/**
 * Mochi AI Chat - 商用AI角色聊天平台后端服务 v2.0
 * 功能：用户系统、JWT鉴权、SQLite数据库、对话云端存储、按Token计费、支付系统、社区管理
 */
require('dotenv').config();
const express = require('express');
const cors = require('cors');
const path = require('path');
const Database = require('better-sqlite3');
const jwt = require('jsonwebtoken');
const bcrypt = require('bcryptjs');
const app = express();
const PORT = process.env.PORT || 3000;

// ==================== 配置常量 ====================
const CONFIG = {
  API_BASE_URL: process.env.API_BASE_URL || 'https://us.noviapi.com/v1',
  API_KEY: process.env.API_KEY || '',
  DEFAULT_MODEL: process.env.DEFAULT_MODEL || 'gpt-3.5-turbo',
  API_COST_PER_CALL: parseFloat(process.env.API_COST_PER_CALL || '0.01'),
  
  JWT_SECRET: process.env.JWT_SECRET || 'mochi_ai_chat_default_secret',
  JWT_EXPIRES_IN: parseInt(process.env.JWT_EXPIRES_IN || '604800'),
  
  DB_PATH: process.env.DB_PATH || './mochi.db',
  
  TOKENS_PER_RICE: parseInt(process.env.TOKENS_PER_RICE || '1000'),
  NEW_USER_RICE: parseInt(process.env.NEW_USER_RICE || '1000'),
  
  COMMUNITY_PAGE_SIZE: parseInt(process.env.COMMUNITY_PAGE_SIZE || '20'),
  
  RECHARGE_TIERS: parseRechargeTiers(process.env.RECHARGE_TIERS || '6:60:0,30:300:30,68:680:80,128:1280:200,328:3280:600,648:6480:1500'),
  
  PAY_CHANNEL: process.env.PAY_CHANNEL || 'mock'
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
const db = new Database(CONFIG.DB_PATH);
db.pragma('journal_mode = WAL');
db.pragma('foreign_keys = ON');

function initDatabase() {
  // 用户表
  db.exec(`
    CREATE TABLE IF NOT EXISTS users (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      username TEXT UNIQUE NOT NULL,
      password_hash TEXT NOT NULL,
      nickname TEXT DEFAULT '新用户',
      avatar TEXT DEFAULT '',
      description TEXT DEFAULT '',
      rice_balance INTEGER DEFAULT 0,
      created_at INTEGER NOT NULL
    );
  `);

  // 角色表
  db.exec(`
    CREATE TABLE IF NOT EXISTS characters (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id INTEGER NOT NULL,
      name TEXT NOT NULL,
      avatar TEXT DEFAULT '',
      persona TEXT NOT NULL,
      description TEXT DEFAULT '',
      tags TEXT DEFAULT '[]',
      is_public INTEGER DEFAULT 0,
      created_at INTEGER NOT NULL,
      FOREIGN KEY (user_id) REFERENCES users(id)
    );
  `);

  // 对话表
  db.exec(`
    CREATE TABLE IF NOT EXISTS conversations (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id INTEGER NOT NULL,
      character_id INTEGER NOT NULL,
      created_at INTEGER NOT NULL,
      updated_at INTEGER NOT NULL,
      FOREIGN KEY (user_id) REFERENCES users(id),
      FOREIGN KEY (character_id) REFERENCES characters(id)
    );
  `);

  // 消息表
  db.exec(`
    CREATE TABLE IF NOT EXISTS messages (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      conversation_id INTEGER NOT NULL,
      role TEXT NOT NULL,
      content TEXT NOT NULL,
      created_at INTEGER NOT NULL,
      FOREIGN KEY (conversation_id) REFERENCES conversations(id)
    );
  `);

  // 交易记录表
  db.exec(`
    CREATE TABLE IF NOT EXISTS transactions (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id INTEGER NOT NULL,
      type TEXT NOT NULL,
      amount INTEGER NOT NULL,
      balance_after INTEGER NOT NULL,
      description TEXT DEFAULT '',
      detail TEXT DEFAULT '',
      created_at INTEGER NOT NULL,
      FOREIGN KEY (user_id) REFERENCES users(id)
    );
  `);

  // 社区角色表
  db.exec(`
    CREATE TABLE IF NOT EXISTS community_characters (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id INTEGER NOT NULL,
      character_id INTEGER NOT NULL,
      likes INTEGER DEFAULT 0,
      created_at INTEGER NOT NULL,
      FOREIGN KEY (user_id) REFERENCES users(id),
      FOREIGN KEY (character_id) REFERENCES characters(id)
    );
  `);

  // 订单表
  db.exec(`
    CREATE TABLE IF NOT EXISTS orders (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id INTEGER NOT NULL,
      order_no TEXT UNIQUE NOT NULL,
      amount REAL NOT NULL,
      rice_amount INTEGER NOT NULL,
      status TEXT DEFAULT 'pending',
      pay_method TEXT DEFAULT '',
      created_at INTEGER NOT NULL,
      paid_at INTEGER,
      FOREIGN KEY (user_id) REFERENCES users(id)
    );
  `);

  console.log('✅ 数据库初始化完成');
}
initDatabase();

// 初始化社区示例角色
function initCommunityCharacters() {
  const count = db.prepare('SELECT COUNT(*) as count FROM community_characters').get();
  if (count.count > 0) return;

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
    VALUES (0, ?, ?, ?, ?, ?, 1, ?)
  `);
  
  const insertCommunity = db.prepare(`
    INSERT INTO community_characters (user_id, character_id, likes, created_at)
    VALUES (0, ?, ?, ?)
  `);

  const now = Date.now();
  sampleCharacters.forEach((char, index) => {
    const charResult = insertChar.run(
      char.name,
      char.avatar,
      char.persona,
      char.description,
      char.tags,
      now - (index * 86400000 * 5)
    );
    insertCommunity.run(charResult.lastInsertRowid, char.likes, now - (index * 86400000 * 5));
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

// ==================== 中间件 ====================
app.use(cors());
app.use(express.json({ limit: '10mb' }));
app.use(express.static(__dirname));

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

    let query = 'SELECT * FROM transactions WHERE user_id = ?';
    const params = [userId];

    if (type) {
      query += ' AND type = ?';
      params.push(type);
    }

    query += ' ORDER BY created_at DESC LIMIT ? OFFSET ?';
    params.push(size, (pageNum - 1) * size);

    const txs = db.prepare(query).all(...params);
    res.json({ success: true, data: txs });
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
    const deleteMsg = db.prepare('DELETE FROM messages WHERE conversation_id = ?');
    conversations.forEach(c => deleteMsg.run(c.id));

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

    let query = `
      SELECT c.*, ch.name as character_name, ch.avatar as character_avatar
      FROM conversations c
      JOIN characters ch ON c.character_id = ch.id
      WHERE c.user_id = ?
    `;
    const params = [userId];

    if (characterId) {
      query += ' AND c.character_id = ?';
      params.push(characterId);
    }

    query += ' ORDER BY c.updated_at DESC';

    const conversations = db.prepare(query).all(...params);
    res.json({ success: true, data: conversations });
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

// 创建充值订单
app.post('/api/recharge/create', authMiddleware, (req, res) => {
  try {
    const userId = req.user.id;
    const { tierIndex } = req.body;

    const tier = CONFIG.RECHARGE_TIERS[tierIndex];
    if (!tier) {
      return res.status(400).json({ success: false, error: '无效的充值档位' });
    }

    const orderNo = generateOrderNo();
    const now = Date.now();

    db.prepare(`
      INSERT INTO orders (user_id, order_no, amount, rice_amount, status, pay_method, created_at)
      VALUES (?, ?, ?, ?, 'pending', ?, ?)
    `).run(userId, orderNo, tier.price, tier.total, CONFIG.PAY_CHANNEL, now);

    // 模拟支付直接返回成功
    let payUrl = '';
    if (CONFIG.PAY_CHANNEL === 'mock') {
      payUrl = '';
    }

    res.json({
      success: true,
      data: {
        orderNo,
        price: tier.price,
        rice: tier.total,
        payUrl
      }
    });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// 模拟支付成功（测试用）
app.post('/api/recharge/simulate', authMiddleware, (req, res) => {
  try {
    const userId = req.user.id;
    const { tierIndex } = req.body;

    const tier = CONFIG.RECHARGE_TIERS[tierIndex];
    if (!tier) {
      return res.status(400).json({ success: false, error: '无效的充值档位' });
    }

    const orderNo = generateOrderNo();
    const now = Date.now();

    // 创建订单
    db.prepare(`
      INSERT INTO orders (user_id, order_no, amount, rice_amount, status, pay_method, created_at, paid_at)
      VALUES (?, ?, ?, ?, 'paid', ?, ?, ?)
    `).run(userId, orderNo, tier.price, tier.total, CONFIG.PAY_CHANNEL, now, now);

    // 更新用户余额
    const user = db.prepare('SELECT * FROM users WHERE id = ?').get(userId);
    const newBalance = user.rice_balance + tier.total;
    db.prepare('UPDATE users SET rice_balance = ? WHERE id = ?').run(newBalance, userId);

    // 记录交易
    db.prepare(`
      INSERT INTO transactions (user_id, type, amount, balance_after, description, created_at)
      VALUES (?, 'recharge', ?, ?, '充值' + tier.price + '元', ?)
    `).run(userId, tier.total, newBalance, now);

    res.json({ success: true, data: { rice_balance: newBalance } });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// 支付回调
app.post('/api/recharge/callback', (req, res) => {
  try {
    const { orderNo, status } = req.body;
    
    if (status === 'success') {
      const order = db.prepare('SELECT * FROM orders WHERE order_no = ?').get(orderNo);
      if (order && order.status === 'pending') {
        const now = Date.now();
        
        // 更新订单状态
        db.prepare('UPDATE orders SET status = ?, paid_at = ? WHERE order_no = ?').run('paid', now, orderNo);
        
        // 更新用户余额
        const user = db.prepare('SELECT * FROM users WHERE id = ?').get(order.user_id);
        const newBalance = user.rice_balance + order.rice_amount;
        db.prepare('UPDATE users SET rice_balance = ? WHERE id = ?').run(newBalance, order.user_id);
        
        // 记录交易
        db.prepare(`
          INSERT INTO transactions (user_id, type, amount, balance_after, description, created_at)
          VALUES (?, 'recharge', ?, ?, '充值' + order.amount + '元', ?)
        `).run(order.user_id, order.rice_amount, newBalance, now);
      }
    }
    
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// 获取订单列表
app.get('/api/orders', authMiddleware, (req, res) => {
  try {
    const userId = req.user.id;
    const { status, page = 1, pageSize = 20 } = req.query;
    const size = parseInt(pageSize);
    const pageNum = parseInt(page);

    let query = 'SELECT * FROM orders WHERE user_id = ?';
    const params = [userId];

    if (status) {
      query += ' AND status = ?';
      params.push(status);
    }

    query += ' ORDER BY created_at DESC LIMIT ? OFFSET ?';
    params.push(size, (pageNum - 1) * size);

    const orders = db.prepare(query).all(...params);
    res.json({ success: true, data: orders });
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

    let query = `
      SELECT cc.*, c.name, c.avatar, c.description, c.tags, u.nickname as author
      FROM community_characters cc
      JOIN characters c ON cc.character_id = c.id
      LEFT JOIN users u ON cc.user_id = u.id
      WHERE c.is_public = 1
    `;
    const params = [];

    // 搜索过滤
    if (search) {
      const keyword = `%${search.toLowerCase()}%`;
      query += ` AND (LOWER(c.name) LIKE ? OR LOWER(c.description) LIKE ?)`;
      params.push(keyword, keyword);
    }

    // 排序
    if (sort === 'hot') {
      query += ' ORDER BY cc.likes DESC';
    } else if (sort === 'new') {
      query += ' ORDER BY cc.created_at DESC';
    }

    const total = db.prepare(query.replace('SELECT cc.*, c.name, c.avatar, c.description, c.tags, u.nickname as author', 'SELECT COUNT(*) as count')).get(...params).count;

    query += ' LIMIT ? OFFSET ?';
    params.push(size, (pageNum - 1) * size);

    const characters = db.prepare(query).all(...params).map(c => ({
      id: c.id,
      name: c.name,
      avatar: c.avatar,
      description: c.description,
      author: c.author || '官方',
      likes: c.likes,
      createdAt: c.created_at,
      tags: JSON.parse(c.tags || '[]')
    }));

    res.json({ success: true, data: { list: characters, total, page: pageNum, pageSize: size } });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// 获取角色详情
app.get('/api/community/characters/:id', (req, res) => {
  try {
    const id = req.params.id;
    
    const char = db.prepare(`
      SELECT cc.*, c.name, c.avatar, c.description, c.persona, c.tags, u.nickname as author
      FROM community_characters cc
      JOIN characters c ON cc.character_id = c.id
      LEFT JOIN users u ON cc.user_id = u.id
      WHERE cc.id = ? AND c.is_public = 1
    `).get(id);

    if (!char) {
      return res.status(404).json({ success: false, error: '角色不存在' });
    }

    res.json({
      success: true,
      data: {
        id: char.id,
        name: char.name,
        avatar: char.avatar,
        description: char.description,
        persona: char.persona,
        author: char.author || '官方',
        likes: char.likes,
        createdAt: char.created_at,
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
    return res.status(400).json({ success: false, error: '消息内容不能为空' });
  }

  if (!characterId) {
    return res.status(400).json({ success: false, error: '角色ID不能为空' });
  }

  // 获取角色信息
  const character = db.prepare('SELECT * FROM characters WHERE id = ?').get(characterId);
  if (!character) {
    return res.status(404).json({ success: false, error: '角色不存在' });
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
      return res.status(404).json({ success: false, error: '对话不存在' });
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

  // 估算输入token数（粗略估算，实际以上游返回为准）
  const estimatedInputTokens = messages.reduce((sum, m) => sum + m.content.length / 2, 0);
  const estimatedCost = Math.ceil(estimatedInputTokens / CONFIG.TOKENS_PER_RICE);

  // 检查余额（预扣估算值）
  if (user.rice_balance < estimatedCost) {
    return res.status(402).json({ success: false, error: '米粒不足，请先充值', code: 'RICE_NOT_ENOUGH' });
  }

  try {
    // 构建系统提示词
    const systemPrompt = character.persona
      ? `${character.persona}\n\n请严格按照以上设定进行对话，保持角色设定的一致性。不要提及你是AI或语言模型，要完全代入角色。`
      : '你是一个友好的AI助手，请用自然的语气与用户对话。';

    // 构建请求消息
    const requestMessages = [
      { role: 'system', content: systemPrompt },
      ...messages.map(m => ({ role: m.role, content: m.content }))
    ];

    // 调用上游API
    const response = await fetch(`${CONFIG.API_BASE_URL}/chat/completions`, {
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

    if (!response.ok) {
      throw new Error(`上游API请求失败: ${response.status}`);
    }

    if (stream) {
      // SSE流式响应
      res.setHeader('Content-Type', 'text/event-stream');
      res.setHeader('Cache-Control', 'no-cache');
      res.setHeader('Connection', 'keep-alive');

      const reader = response.body.getReader();
      const decoder = new TextDecoder();
      let buffer = '';
      let fullContent = '';
      let usage = null;

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split('\n');
        buffer = lines.pop() || '';

        for (const line of lines) {
          const trimmed = line.trim();
          if (!trimmed || !trimmed.startsWith('data:')) continue;

          const data = trimmed.slice(5).trim();
          if (data === '[DONE]') {
            // 流结束，处理计费
            const inputTokens = usage?.prompt_tokens || Math.ceil(requestMessages.reduce((s, m) => s + m.content.length / 2, 0));
            const outputTokens = usage?.completion_tokens || Math.ceil(fullContent.length / 2);
            const totalTokens = inputTokens + outputTokens;
            const riceCost = Math.ceil(totalTokens / CONFIG.TOKENS_PER_RICE);

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
      if (!usage) {
        const inputTokens = Math.ceil(requestMessages.reduce((s, m) => s + m.content.length / 2, 0));
        const outputTokens = Math.ceil(fullContent.length / 2);
        const totalTokens = inputTokens + outputTokens;
        const riceCost = Math.ceil(totalTokens / CONFIG.TOKENS_PER_RICE);

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
      }

      res.write('data: [DONE]\n\n');
      res.end();
    } else {
      // 非流式响应
      const data = await response.json();
      const content = data.choices?.[0]?.message?.content || '';
      const usage = data.usage || {};

      const inputTokens = usage.prompt_tokens || 0;
      const outputTokens = usage.completion_tokens || 0;
      const totalTokens = inputTokens + outputTokens;
      const riceCost = Math.ceil(totalTokens / CONFIG.TOKENS_PER_RICE);

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
  } catch (err) {
    console.error('聊天请求失败:', err);
    
    if (stream) {
      res.setHeader('Content-Type', 'text/event-stream');
      res.write(`data: ${JSON.stringify({ error: err.message })}\n\n`);
      res.write('data: [DONE]\n\n');
      res.end();
    } else {
      res.status(500).json({ success: false, error: err.message });
    }
  }
});

// ==================== 运营统计API ====================
app.get('/api/admin/stats', (req, res) => {
  try {
    const totalUsers = db.prepare('SELECT COUNT(*) as count FROM users').get().count;
    const totalRice = db.prepare('SELECT SUM(rice_balance) as total FROM users').get().total || 0;
    const totalRecharge = db.prepare("SELECT SUM(amount) as total FROM transactions WHERE type = 'recharge'").get().total || 0;
    const totalConsume = db.prepare("SELECT SUM(amount) as total FROM transactions WHERE type = 'consume'").get().total || 0;
    const totalCharacters = db.prepare('SELECT COUNT(*) as count FROM characters').get().count;
    const totalConversations = db.prepare('SELECT COUNT(*) as count FROM conversations').get().count;
    const totalOrders = db.prepare('SELECT COUNT(*) as count FROM orders').get().count;

    res.json({
      success: true,
      data: {
        totalUsers,
        totalRice,
        totalRecharge,
        totalConsume,
        totalCharacters,
        totalConversations,
        totalOrders
      }
    });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// ==================== 健康检查 ====================
app.get('/api/health', (req, res) => {
  res.json({ success: true, data: { status: 'ok', timestamp: Date.now() } });
});

// ==================== SPA路由回退 ====================
app.get('*', (req, res) => {
  res.sendFile(path.join(__dirname, 'index.html'));
});

// ==================== 启动服务 ====================
app.listen(PORT, () => {
  console.log(`\n🚀 Mochi AI Chat v2.0 服务已启动`);
  console.log(`📍 服务地址: http://localhost:${PORT}`);
  console.log(`💰 计费方式: 按Token用量计费 (${CONFIG.TOKENS_PER_RICE} token = 1米粒)`);
  console.log(`🎁 新用户赠送: ${CONFIG.NEW_USER_RICE} 米粒`);
  console.log(`💾 数据库: ${CONFIG.DB_PATH}`);
  console.log(`🔐 支付渠道: ${CONFIG.PAY_CHANNEL}\n`);
});
