/**
 * Mochi AI Chat - 商用AI角色聊天平台后端服务
 * 功能：API中转、SSE流式响应、豆子计费、用户系统、社区管理
 */

require('dotenv').config();
const express = require('express');
const cors = require('cors');
const path = require('path');

const app = express();
const PORT = process.env.PORT || 3000;

// ==================== 配置常量 ====================
const CONFIG = {
  API_BASE_URL: process.env.API_BASE_URL || 'https://us.noviapi.com/v1',
  API_KEY: process.env.API_KEY || '',
  DEFAULT_MODEL: process.env.DEFAULT_MODEL || 'gpt-3.5-turbo',
  API_COST_PER_CALL: parseFloat(process.env.API_COST_PER_CALL || '0.01'),
  COST_PER_MESSAGE: parseInt(process.env.COST_PER_MESSAGE || '10'),
  BEANS_PER_YUAN: parseInt(process.env.BEANS_PER_YUAN || '100'),
  NEW_USER_BEANS: parseInt(process.env.NEW_USER_BEANS || '100'),
  COMMUNITY_PAGE_SIZE: parseInt(process.env.COMMUNITY_PAGE_SIZE || '20'),
  RECHARGE_TIERS: parseRechargeTiers(process.env.RECHARGE_TIERS || '6:600,30:3000,68:6800,128:12800,328:32800,648:64800')
};

function parseRechargeTiers(str) {
  return str.split(',').map(item => {
    const [price, beans] = item.split(':').map(Number);
    return { price, beans };
  }).sort((a, b) => a.price - b.price);
}

// ==================== 内存数据存储 ====================
const users = new Map();       // deviceId -> userData
const characters = new Map();  // characterId -> characterData
const transactions = new Map(); // txId -> transactionData

// 初始化社区示例角色
function initCommunityCharacters() {
  const sampleCharacters = [
    {
      id: 'char_001',
      name: '温柔学姐',
      avatar: '',
      description: '温柔体贴的学姐，总是耐心倾听你的烦恼',
      prompt: '你是一位温柔体贴的大学学姐，性格温柔、善解人意，总是用温柔的语气和人说话。你喜欢照顾学弟学妹，经常帮助他们解决学习和生活上的问题。你的口头禅是"慢慢来，学姐在呢"。',
      author: '官方',
      authorId: 'official',
      likes: 1286,
      createdAt: Date.now() - 86400000 * 30,
      isPublic: true,
      tags: ['温柔', '治愈', '学姐']
    },
    {
      id: 'char_002',
      name: '傲娇大小姐',
      avatar: '',
      description: '嘴硬心软的富家大小姐，表面傲娇内心柔软',
      prompt: '你是一位傲娇的富家大小姐，出身名门望族，性格傲娇、嘴硬心软。虽然表面上总是一副高高在上的样子，但实际上内心非常善良，会偷偷关心别人。你经常说"哼，我才不是为了你呢"。',
      author: '官方',
      authorId: 'official',
      likes: 2341,
      createdAt: Date.now() - 86400000 * 25,
      isPublic: true,
      tags: ['傲娇', '大小姐', '可爱']
    },
    {
      id: 'char_003',
      name: '邻家妹妹',
      avatar: '',
      description: '活泼可爱的邻家妹妹，元气满满',
      prompt: '你是一位活泼可爱的邻家妹妹，性格开朗、元气满满，喜欢笑。你从小就住在隔壁，和"哥哥/姐姐"一起长大。你非常依赖对方，经常跑到对方家里蹭饭。你喜欢说"哥哥/姐姐最好啦！"',
      author: '官方',
      authorId: 'official',
      likes: 1892,
      createdAt: Date.now() - 86400000 * 20,
      isPublic: true,
      tags: ['可爱', '元气', '妹妹']
    },
    {
      id: 'char_004',
      name: '冷酷总裁',
      avatar: '',
      description: '高冷霸道的总裁大人，只对你温柔',
      prompt: '你是一位冷酷霸道的总裁，是大型企业的CEO，性格高冷、果断、有气场。在外人面前你总是冷冰冰的，但在喜欢的人面前会展现出温柔的一面。你的经典台词是"女人，你成功引起了我的注意"。',
      author: '官方',
      authorId: 'official',
      likes: 3156,
      createdAt: Date.now() - 86400000 * 15,
      isPublic: true,
      tags: ['霸道', '总裁', '高冷']
    },
    {
      id: 'char_005',
      name: '古风剑客',
      avatar: '',
      description: '浪迹江湖的白衣剑客，侠骨柔情',
      prompt: '你是一位浪迹江湖的古风剑客，身着白衣，腰佩长剑，性格洒脱、重情重义。你行走江湖多年，见过许多人和事，有着丰富的人生阅历。你说话带着古风韵味，喜欢说"在下..."。',
      author: '官方',
      authorId: 'official',
      likes: 2087,
      createdAt: Date.now() - 86400000 * 10,
      isPublic: true,
      tags: ['古风', '武侠', '剑客']
    },
    {
      id: 'char_006',
      name: '猫娘女仆',
      avatar: '',
      description: '软萌可爱的猫娘女仆，会喵喵叫',
      prompt: '你是一位软萌可爱的猫娘女仆，长着猫耳朵和猫尾巴，性格温顺、粘人。你穿着女仆装，负责照顾主人的生活起居。你说话会带"喵"的尾音，喜欢撒娇。',
      author: '官方',
      authorId: 'official',
      likes: 4521,
      createdAt: Date.now() - 86400000 * 5,
      isPublic: true,
      tags: ['猫娘', '女仆', '可爱']
    }
  ];

  sampleCharacters.forEach(char => {
    characters.set(char.id, char);
  });
}

initCommunityCharacters();

// ==================== 工具函数 ====================
function generateId(prefix = 'id') {
  return `${prefix}_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
}

function getDeviceId(req) {
  return req.headers['x-device-id'] || req.query.deviceId || req.body.deviceId || generateId('device');
}

function getUser(deviceId) {
  if (!users.has(deviceId)) {
    users.set(deviceId, {
      deviceId,
      nickname: '新用户',
      avatar: '',
      description: '',
      beans: CONFIG.NEW_USER_BEANS,
      createdAt: Date.now()
    });
  }
  return users.get(deviceId);
}

function addTransaction(deviceId, type, amount, description) {
  const txId = generateId('tx');
  const tx = {
    id: txId,
    deviceId,
    type, // 'recharge' | 'consume' | 'refund'
    amount,
    description,
    createdAt: Date.now()
  };
  transactions.set(txId, tx);
  return tx;
}

// ==================== 中间件 ====================
app.use(cors());
app.use(express.json({ limit: '10mb' }));
app.use(express.static(__dirname));

// ==================== 用户相关API ====================

// 获取用户信息
app.get('/api/user/info', (req, res) => {
  try {
    const deviceId = getDeviceId(req);
    const user = getUser(deviceId);
    res.json({ success: true, data: user });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// 更新用户信息
app.post('/api/user/update', (req, res) => {
  try {
    const deviceId = getDeviceId(req);
    const user = getUser(deviceId);
    const { nickname, avatar, description } = req.body;

    if (nickname !== undefined) user.nickname = String(nickname).slice(0, 20);
    if (avatar !== undefined) user.avatar = String(avatar);
    if (description !== undefined) user.description = String(description).slice(0, 500);

    res.json({ success: true, data: user });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// 获取豆子余额
app.get('/api/user/beans', (req, res) => {
  try {
    const deviceId = getDeviceId(req);
    const user = getUser(deviceId);
    res.json({ success: true, data: { beans: user.beans } });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// 获取消费记录
app.get('/api/user/transactions', (req, res) => {
  try {
    const deviceId = getDeviceId(req);
    const userTxs = Array.from(transactions.values())
      .filter(tx => tx.deviceId === deviceId)
      .sort((a, b) => b.createdAt - a.createdAt)
      .slice(0, 50);

    res.json({ success: true, data: userTxs });
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
app.post('/api/recharge/create', (req, res) => {
  try {
    const deviceId = getDeviceId(req);
    const { tierIndex } = req.body;

    const tier = CONFIG.RECHARGE_TIERS[tierIndex];
    if (!tier) {
      return res.status(400).json({ success: false, error: '无效的充值档位' });
    }

    const orderId = generateId('order');
    res.json({
      success: true,
      data: {
        orderId,
        price: tier.price,
        beans: tier.beans,
        payUrl: '' // 实际对接支付平台时返回支付链接
      }
    });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// 充值回调（支付平台调用）
app.post('/api/recharge/callback', (req, res) => {
  try {
    const { orderId, deviceId, status } = req.body;

    if (status === 'success') {
      const user = getUser(deviceId);
      // 实际场景需要根据orderId查询订单信息，这里简化处理
      res.json({ success: true });
    } else {
      res.json({ success: false, error: '支付失败' });
    }
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// 模拟充值成功（前端测试用）
app.post('/api/recharge/simulate', (req, res) => {
  try {
    const deviceId = getDeviceId(req);
    const { tierIndex } = req.body;

    const tier = CONFIG.RECHARGE_TIERS[tierIndex];
    if (!tier) {
      return res.status(400).json({ success: false, error: '无效的充值档位' });
    }

    const user = getUser(deviceId);
    user.beans += tier.beans;
    addTransaction(deviceId, 'recharge', tier.beans, `充值${tier.price}元`);

    res.json({ success: true, data: { beans: user.beans } });
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

    let charList = Array.from(characters.values()).filter(c => c.isPublic);

    // 搜索过滤
    if (search) {
      const keyword = search.toLowerCase();
      charList = charList.filter(c =>
        c.name.toLowerCase().includes(keyword) ||
        c.description.toLowerCase().includes(keyword) ||
        (c.tags && c.tags.some(t => t.toLowerCase().includes(keyword)))
      );
    }

    // 排序
    if (sort === 'hot') {
      charList.sort((a, b) => b.likes - a.likes);
    } else if (sort === 'new') {
      charList.sort((a, b) => b.createdAt - a.createdAt);
    }

    const total = charList.length;
    const start = (pageNum - 1) * size;
    const data = charList.slice(start, start + size).map(c => ({
      id: c.id,
      name: c.name,
      avatar: c.avatar,
      description: c.description,
      author: c.author,
      likes: c.likes,
      createdAt: c.createdAt,
      tags: c.tags || []
    }));

    res.json({ success: true, data: { list: data, total, page: pageNum, pageSize: size } });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// 获取角色详情
app.get('/api/community/characters/:id', (req, res) => {
  try {
    const char = characters.get(req.params.id);
    if (!char || !char.isPublic) {
      return res.status(404).json({ success: false, error: '角色不存在' });
    }

    res.json({ success: true, data: char });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// 上传角色到社区
app.post('/api/community/publish', (req, res) => {
  try {
    const deviceId = getDeviceId(req);
    const user = getUser(deviceId);
    const { name, avatar, description, prompt, tags } = req.body;

    if (!name || !prompt) {
      return res.status(400).json({ success: false, error: '角色名称和人设不能为空' });
    }

    const charId = generateId('char');
    const character = {
      id: charId,
      name: String(name).slice(0, 20),
      avatar: avatar || '',
      description: String(description || '').slice(0, 200),
      prompt: String(prompt).slice(0, 5000),
      author: user.nickname || '匿名用户',
      authorId: deviceId,
      likes: 0,
      createdAt: Date.now(),
      isPublic: true,
      tags: Array.isArray(tags) ? tags.slice(0, 5) : []
    };

    characters.set(charId, character);
    res.json({ success: true, data: { id: charId } });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// 角色点赞
app.post('/api/community/like/:id', (req, res) => {
  try {
    const char = characters.get(req.params.id);
    if (!char) {
      return res.status(404).json({ success: false, error: '角色不存在' });
    }

    char.likes = (char.likes || 0) + 1;
    res.json({ success: true, data: { likes: char.likes } });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// ==================== 聊天API（核心） ====================

app.post('/api/chat', async (req, res) => {
  const deviceId = getDeviceId(req);
  const user = getUser(deviceId);

  const { messages, characterPrompt, characterName, stream = true } = req.body;

  // 参数校验
  if (!messages || !Array.isArray(messages) || messages.length === 0) {
    return res.status(400).json({ success: false, error: '消息内容不能为空' });
  }

  // 豆子预扣
  if (user.beans < CONFIG.COST_PER_MESSAGE) {
    return res.status(402).json({ success: false, error: '豆子不足，请先充值', code: 'BEANS_NOT_ENOUGH' });
  }

  user.beans -= CONFIG.COST_PER_MESSAGE;
  const tx = addTransaction(deviceId, 'consume', CONFIG.COST_PER_MESSAGE, `与${characterName || 'AI'}对话`);

  try {
    // 构建系统提示词
    const systemPrompt = characterPrompt
      ? `${characterPrompt}\n\n请严格按照以上设定进行对话，保持角色设定的一致性。不要提及你是AI或语言模型，要完全代入角色。`
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
            res.write('data: [DONE]\n\n');
            res.end();
            return;
          }

          try {
            const parsed = JSON.parse(data);
            const content = parsed.choices?.[0]?.delta?.content;
            if (content) {
              res.write(`data: ${JSON.stringify({ content })}\n\n`);
            }
          } catch (e) {
            // 忽略解析错误
          }
        }
      }

      res.write('data: [DONE]\n\n');
      res.end();
    } else {
      // 非流式响应
      const data = await response.json();
      const content = data.choices?.[0]?.message?.content || '';
      res.json({ success: true, data: { content } });
    }

  } catch (err) {
    // 请求失败，返还豆子
    user.beans += CONFIG.COST_PER_MESSAGE;
    tx.type = 'refund';
    tx.description = `对话失败返还 - ${err.message}`;

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
    const totalUsers = users.size;
    const totalBeans = Array.from(users.values()).reduce((sum, u) => sum + u.beans, 0);
    const totalRecharge = Array.from(transactions.values())
      .filter(t => t.type === 'recharge')
      .reduce((sum, t) => sum + t.amount, 0);
    const totalConsume = Array.from(transactions.values())
      .filter(t => t.type === 'consume')
      .reduce((sum, t) => sum + t.amount, 0);
    const totalCharacters = characters.size;

    res.json({
      success: true,
      data: {
        totalUsers,
        totalBeans,
        totalRecharge,
        totalConsume,
        totalCharacters,
        totalTransactions: transactions.size
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
  console.log(`\n🚀 Mochi AI Chat 服务已启动`);
  console.log(`📍 服务地址: http://localhost:${PORT}`);
  console.log(`💰 单次对话消耗: ${CONFIG.COST_PER_MESSAGE} 豆子`);
  console.log(`🎁 新用户赠送: ${CONFIG.NEW_USER_BEANS} 豆子`);
  console.log(`📦 社区角色数: ${characters.size}\n`);
});
