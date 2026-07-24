import express from 'express';
import cors from 'cors';
import helmet from 'helmet';
import dotenv from 'dotenv';
import fs from 'fs';
import path from 'path';
import { randomUUID } from 'crypto';
import { fileURLToPath } from 'url';

dotenv.config();

const app = express();
const PORT = Number(process.env.PORT || 3000);
const HOST = process.env.HOST || '0.0.0.0';
// FRONTEND_HTML is now served from public/index.html

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

const users = new Map();
const transactions = [];
const communityRoles = [];
const userMemories = new Map();
const userProfiles = new Map();
const directMessages = new Map();
const novelGameSaves = new Map();
const novelGameStates = new Map();
const stats = { totalRechargeCny: 0, totalBeansConsumed: 0, totalChatCount: 0, totalRefundBeans: 0 };

const DATA_DIR = process.env.DATA_DIR || path.join(path.dirname(fileURLToPath(import.meta.url)), '.data');
const DATA_FILE = process.env.DATA_FILE || path.join(DATA_DIR, 'mochi-phone-data.json');
let saveTimer = null;

const saveDataNow = () => {
  try {
    fs.mkdirSync(DATA_DIR, { recursive: true });
    const payload = {
      version: 1,
      updatedAt: new Date().toISOString(),
      users: [...users.values()],
      transactions: transactions.slice(-1000),
      memories: Object.fromEntries([...userMemories.entries()].map(([userId, list]) => [userId, list.slice(-300)])),
      profiles: Object.fromEntries([...userProfiles.entries()].map(([userId, p]) => [userId, p])),
      messages: Object.fromEntries([...directMessages.entries()].map(([userId, list]) => [userId, list.slice(-200)])),
      novelGames: Object.fromEntries([...novelGameSaves.entries()].map(([userId, list]) => [userId, list.slice(-50)])),
      stats
    };
    fs.writeFileSync(DATA_FILE, JSON.stringify(payload, null, 2), 'utf8');
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
  } catch (error) {
    console.warn('读取数据失败，将使用空数据启动：', error.message);
  }
};

loadData();
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

const summarizeMemory = (userMsg, replyText, roleName) => {
  const raw = String(userMsg || '').replace(/\s+/g, ' ').trim();
  const reply = String(replyText || '').replace(/\s+/g, ' ').trim();
  if (!raw || raw.length < 2 || raw.length > 260) return null;
  if (/^(你好|在吗|嗯|哦|好|哈哈|谢谢|再见|晚安|早安|是的|对的|不是|没有|可以|好的|行|ok)[。！？!?.\s]*$/i.test(raw)) return null;

  let content = '';
  const rn = roleName || '角色';

  if (/我叫|叫我|称呼|昵称/.test(raw)) {
    const m = raw.match(/(?:叫我|称呼我|我是)([^\s,，。.！!？?]+)/);
    content = m ? `用户希望被称呼为"${m[1]}"。` : `用户提到了自己的名字或称呼偏好。`;
  } else if (/^(我喜欢|我爱|我超爱|我超喜欢)/.test(raw)) {
    const m = raw.match(/(?:喜欢|爱|超爱|超喜欢)([^\s,，。.！!？?]+)/);
    content = m ? `用户很喜欢${m[1]}，这是TA的偏好之一。` : `用户表达了对某事物的喜爱。`;
  } else if (/^(我不喜欢|我讨厌|我讨厌|我反感|我不想)|不想说|不要|别问|算了|随便/.test(raw)) {
    const m = raw.match(/(?:不喜欢|讨厌|反感|不想|不要)([^\s,，。.！!？?]+)/);
    content = m ? `用户不太喜欢${m[1]}，后续聊天里要尊重TA的边界。` : `用户表现出回避或拒绝继续展开的话题，${rn}需要温柔地尊重TA的边界。`;
  } else if (/(心情|心情不好|心情好|开心|难过|伤心|哭|生气|害怕|焦虑|压力|孤独|幸福|感动)/.test(raw)) {
    if (/开心|幸福|高兴|快乐|好开心/.test(raw)) {
      content = raw.length > 20 ? `用户分享了一件开心的事：${raw}` : `用户今天心情不错，似乎遇到了开心的事情。`;
    } else {
      content = raw.length > 20 ? `用户倾诉了一些烦恼：${raw}` : `用户似乎心情不太好，${rn}给予了温柔的陪伴和安慰。`;
    }
  } else if (/(上班|下班|加班|工作|老板|同事|开会|面试|辞职|考试|学习|作业|老师|学校)/.test(raw)) {
    content = raw.length > 30 ? `用户聊到了工作或学习方面的事情：${raw}` : `用户分享了工作或学习中的一些经历，${rn}认真地倾听了。`;
  } else if (/(累|困|饿|生病|医院|感冒|发烧|头痛|失眠)/.test(raw)) {
    content = raw.length > 20 ? `用户提到了身体状况：${raw}` : `用户身体有些不舒服，${rn}叮嘱TA要好好照顾自己。`;
  } else if (/(旅行|出去玩|旅游|出发|到达|机场|火车|酒店|景点)/.test(raw)) {
    content = raw.length > 30 ? `用户正在旅行或计划旅行：${raw}` : `用户提到了旅行相关的话题，${rn}和TA聊得很开心。`;
  } else if (/(约定|约定了|说好了|答应|承诺|一起|我们)/.test(raw)) {
    content = `用户和${rn}之间有了一个小小的约定：${raw}`;
  } else if (/(生日|节日|过年|圣诞|纪念|庆祝|礼物)/.test(raw)) {
    content = raw.length > 30 ? `用户聊到了一个特别的日子：${raw}` : `用户提到了一个值得记住的特别日子。`;
  } else if (/(家人|爸爸|妈妈|哥哥|姐姐|弟弟|妹妹|男朋友|女朋友|老公|老婆|对象|朋友|闺蜜|兄弟)/.test(raw)) {
    content = raw.length > 30 ? `用户提到了自己身边的人：${raw}` : `用户向${rn}分享了关于身边人的事情。`;
  } else if (/(想|想念|思念|怀念|记得|回忆|以前|小时候|长大|过去|曾经)/.test(raw)) {
    content = raw.length > 30 ? `用户回忆起了一些往事：${raw}` : `用户陷入了回忆，向${rn}倾诉了一些过去的事情。`;
  } else if (/(游戏|动漫|电影|音乐|读书|追剧|追番|小说|画画|吉他|钢琴|运动|健身)/.test(raw)) {
    content = raw.length > 30 ? `用户聊到了自己的兴趣爱好：${raw}` : `用户和${rn}聊到了兴趣爱好相关的话题。`;
  } else if (/(买了|购物|下单|快递|收到|到了|新衣服|新手机|新电脑)/.test(raw)) {
    content = `用户分享了购物相关的话题：${raw.length > 50 ? raw.slice(0, 50) + '...' : raw}`;
  } else if (/(搬家|租房|新房|装修|布置|打扫)/.test(raw)) {
    content = `用户提到了生活方面的事情：${raw.length > 50 ? raw.slice(0, 50) + '...' : raw}`;
  } else if (/(吃饭|美食|做饭|餐厅|外卖|零食|奶茶|咖啡|蛋糕|火锅)/.test(raw)) {
    content = `用户和${rn}聊到了美食相关的话题。`;
  } else if (reply && reply.length > 10) {
    const shortReply = reply.length > 60 ? reply.slice(0, 60) + '...' : reply;
    content = `用户和${rn}聊了一个话题。用户说："${raw.length > 40 ? raw.slice(0, 40) + '...' : raw}"${rn}温柔地回应了TA。`;
  } else {
    content = `用户向${rn}倾诉了一些心事。`;
  }

  return content;
};

const buildAutoMemory = ({ userId, roleId, roleName, lastUserMessage, assistantReply, sourceMessageIds = [] }) => {
  const content = summarizeMemory(lastUserMessage, assistantReply, roleName);
  if (!content) return null;
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
    uploaderNickname: String(role.uploaderNickname || '匿名用户').slice(0, 24),
    heat: Math.floor(Math.random() * 800) + 20,
    createdAt: new Date().toISOString()
  };
  communityRoles.unshift(item);
  return item;
};

publishCommunityRole({ name: '温柔陪伴师', description: '擅长倾听、安慰和日常陪伴的暖心角色。', prompt: '你是一位温柔、耐心、边界清晰的陪伴型 AI 角色。', uploaderNickname: 'Mochi-phone' });
publishCommunityRole({ name: '赛博侦探', description: '冷静、敏锐，适合悬疑推理和剧情扮演。', prompt: '你是一名生活在近未来都市的赛博侦探，擅长分析线索。', uploaderNickname: 'Mochi-phone' });

app.use(helmet({ contentSecurityPolicy: false }));
app.use(cors({ origin: true }));
app.use(express.json({ limit: '5mb' }));
// Serve static files: try public/ first, then root (for Render without subfolders)
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PUBLIC_DIR = path.join(__dirname, 'public');
const ROOT_DIR = __dirname;
const publicExists = fs.existsSync(PUBLIC_DIR);
app.use(express.static(publicExists ? PUBLIC_DIR : ROOT_DIR));
if (!publicExists) app.use(express.static(ROOT_DIR));

app.use((req, _res, next) => {
  req.userId = String(req.headers['x-user-id'] || 'demo-user').slice(0, 80);
  next();
});

// Serve index.html from wherever it exists
const indexPath = fs.existsSync(path.join(PUBLIC_DIR, 'index.html'))
  ? path.join(PUBLIC_DIR, 'index.html')
  : fs.existsSync(path.join(ROOT_DIR, 'index.html'))
    ? path.join(ROOT_DIR, 'index.html')
    : path.join(PUBLIC_DIR, 'index.html');

app.get('/', (_req, res) => {
  res.sendFile(indexPath);
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
  const list = communityRoles.filter((role) => !keyword || `${role.name} ${role.description} ${role.prompt}`.toLowerCase().includes(keyword));
  ok(res, { list, total: list.length, page: 1, pageSize: 12 });
});

app.post('/api/community/roles', (req, res) => {
  const { name, description, prompt, avatar, uploaderNickname } = req.body || {};
  if (!name || !description || !prompt) return fail(res, 400, 4002, '发布角色需要填写名称、简介和人设。');
  ok(res, publishCommunityRole({ name, description, prompt, avatar, uploaderNickname }), '角色已发布到社区');
});

app.post('/api/chat', async (req, res) => {
  const { roleId, roleName, rolePrompt, messages, sourceMessageIds } = req.body || {};
  const normalizedMessages = Array.isArray(messages) ? messages.slice(-20) : [];
  const lastUserMessage = [...normalizedMessages].reverse().find((item) => item.role === 'user')?.content || '';
  const activeRoleId = String(roleId || roleName || 'default-role').slice(0, 80);
  if (!lastUserMessage.trim()) return fail(res, 400, 4003, '消息内容不能为空。');

  const user = getUser(req.userId);
  if (user.beans < config.chatBeansCost) return fail(res, 402, 4021, '豆子余额不足，请先充值后再继续聊天。', { beans: user.beans });

  user.beans -= config.chatBeansCost;
  stats.totalBeansConsumed += config.chatBeansCost;
  transactions.push({ id: randomUUID(), userId: user.id, type: 'consume', beans: -config.chatBeansCost, roleName, summary: String(lastUserMessage).slice(0, 60), createdAt: new Date().toISOString() });
  saveData();

  res.setHeader('Content-Type', 'text/event-stream; charset=utf-8');
  res.setHeader('Cache-Control', 'no-cache, no-transform');
  res.setHeader('Connection', 'keep-alive');
  writeSse(res, 'charged', { beans: user.beans, cost: config.chatBeansCost });

  try {
    if (!config.upstreamKey || config.upstreamKey.includes('请填写')) {
      const memoryNote = buildMemoryPrompt(user.id, activeRoleId);
      const reply = `我是${roleName || 'Mochi-phone 角色'}。我已经收到你的消息：“${lastUserMessage}”。${memoryNote ? '\\n\\n我也会参考我们已有的记忆继续陪你。' : ''}\n\n当前网站后端已运行，但还没有读取到 UPSTREAM_API_KEY，所以先返回演示回复。`;
      await streamText(res, reply);
      const memory = buildAutoMemory({ userId: user.id, roleId: activeRoleId, roleName, lastUserMessage, assistantReply: reply, sourceMessageIds });
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
          { role: 'system', content: `${rolePrompt || `你正在扮演${roleName || 'AI角色'}，请保持角色一致。`}${buildMemoryPrompt(user.id, activeRoleId)}` },
          ...normalizedMessages.map((item) => ({ role: item.role === 'assistant' ? 'assistant' : 'user', content: String(item.content || '') }))
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

    const memory = buildAutoMemory({ userId: user.id, roleId: activeRoleId, roleName, lastUserMessage, assistantReply: replyText, sourceMessageIds });
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

const generateFallbackPosts = (tab, roleName) => {
  const tabLabels = { following: '关注', recommended: '推荐', gossip: '八卦' };
  const templates = {
    following: [
      '今天和' + (roleName || 'TA') + '聊了很多，感觉我们的关系又近了一步呢~',
      (roleName || 'TA') + '说了一句很温柔的话，我记了好久。',
      '每次和' + (roleName || 'TA') + '聊天都很开心，期待下一次对话！',
      '今天的心情因为' + (roleName || 'TA') + '变得特别好☀️',
      '翻看了和' + (roleName || 'TA') + '的聊天记录，嘴角忍不住上扬',
      (roleName || 'TA') + '真的太懂我了，每句话都说到心坎里'
    ],
    recommended: [
      '今天做了一道新菜，虽然卖相一般但味道意外地好！附上食谱分享给大家~',
      '推荐一本最近在看的书，真的太好哭了，建议大家备好纸巾📚',
      '周末去了一个超美的小众景点，人少景美，分享一波照片📸',
      '最近迷上了手冲咖啡，每天早上的仪式感太幸福了☕',
      '分享一个超好用的学习app，用了三个月效率翻倍！',
      '今天的天空也太好看了吧，随手拍都是壁纸级别的☁️',
      '终于把拖延了很久的事情做完了，爽！大家也要加油呀💪',
      '深夜emo时间：有些路只能一个人走，但没关系，我们都很勇敢'
    ],
    gossip: [
      '听说隔壁部门的同事要辞职去开奶茶店了，好突然啊...',
      '今天在地铁上听到有人讨论那个热门话题，大家怎么看？',
      '朋友圈有人发了条意味深长的动态，是不是在暗示什么...',
      '最近那个综艺的瓜大家吃了吗？反转也太多了吧🍉',
      '听说那家网红店其实味道一般，全靠营销？',
      '有个人在图书馆占座被怼了，场面一度很尴尬...'
    ]
  };
  const pool = templates[tab] || templates.recommended;
  const count = 6 + Math.floor(Math.random() * 4);
  const posts = [];
  for (let i = 0; i < count; i++) {
    const authorIdx = (i * 3 + Math.floor(Math.random() * 5)) % FORUM_AUTHOR_NAMES.length;
    posts.push({
      id: tab + '-fb-' + Date.now() + '-' + i,
      authorName: FORUM_AUTHOR_NAMES[authorIdx],
      content: pool[i % pool.length],
      time: ['刚刚', '3分钟前', '10分钟前', '半小时前', '1小时前', '2小时前', '今天'][i % 7],
      likes: Math.floor(Math.random() * 300) + 5,
      avatarIndex: authorIdx % FORUM_AVATAR_COUNT,
      commentsList: []
    });
  }
  return posts;
};

app.post('/api/forum/generate', async (req, res) => {
  const { tab, roleName, rolePrompt, recentMessages, memories, worldRole } = req.body || {};
  const validTabs = ['following', 'recommended', 'gossip'];
  const activeTab = validTabs.includes(tab) ? tab : 'recommended';
  try {
    const tabDesc = {
      following: '关注版块：展示用户已有角色关系相关的动态，帖子内容应体现角色之间的互动、情感变化和日常点滴。',
      recommended: '推荐版块：展示来自虚拟世界中各种角色的有趣帖子，内容多样、有生活气息，像小红书和微博的推荐流。',
      gossip: '八卦版块：展示虚拟世界中的传闻、八卦、小道消息，内容有趣味性但不过分攻击。'
    };

    const authorPool = FORUM_AUTHOR_NAMES.join('、');
    const contextInfo = [];
    if (roleName) contextInfo.push('当前用户正在互动的角色是"' + roleName + '"');
    if (worldRole && worldRole.name) {
      contextInfo.push('用户选择了"' + worldRole.name + '"的世界视角，大约20%的帖子应与这个角色或其世界有关联（提及该角色、与其相关的场景、互动、传闻等），其余帖子保持独立内容');
      if (worldRole.prompt) contextInfo.push('角色设定概要：' + String(worldRole.prompt).slice(0, 200));
    }
    if (recentMessages && recentMessages.length > 0) {
      const lastMsg = recentMessages[recentMessages.length - 1];
      if (lastMsg && lastMsg.content) contextInfo.push('最近的对话内容：' + String(lastMsg.content).slice(0, 80));
    }
    if (memories && memories.length > 0) {
      const memTexts = memories.slice(0, 5).map(m => m.content || '').filter(Boolean);
      if (memTexts.length > 0) contextInfo.push('相关记忆：' + memTexts.join('；'));
    }

    const prompt = '你是一个虚拟社区论坛的内容生成器。' + tabDesc[activeTab] + '\n\n' +
      '请生成8条帖子，每条帖子包含：authorName(作者名，从这些名字中随机选择或创作类似的：' + authorPool + ')、content(帖子正文，50-150字，口语化、有生活气息、像真人在社交媒体发的内容)、time(发布时间，如"刚刚"、"5分钟前"、"1小时前")。\n\n' +
      (contextInfo.length > 0 ? '背景信息：\n' + contextInfo.join('\n') + '\n\n' : '') +
      '要求：\n1. 内容风格参考小红书和微博，轻松、真实、有趣\n2. 可以带emoji和话题标签#\n3. 每条帖子长度和风格要有差异\n4. 返回JSON格式：{"posts":[...]}\n5. 不要有任何解释性文字，只返回JSON';

    if (!config.upstreamKey || config.upstreamKey.includes('请填写')) {
      return ok(res, { posts: generateFallbackPosts(activeTab, roleName), tab: activeTab });
    }

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 15000);
    const apiResp = await fetch(config.upstreamBase + '/chat/completions', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + config.upstreamKey },
      signal: controller.signal,
      body: JSON.stringify({
        model: config.upstreamModel,
        stream: false,
        messages: [{ role: 'user', content: prompt }]
      })
    }).finally(() => clearTimeout(timeout));

    if (!apiResp.ok) throw new Error('上游API异常: ' + apiResp.status);
    const apiData = await apiResp.json();
    const rawText = apiData.choices?.[0]?.message?.content || '';

    let posts = [];
    try {
      const jsonMatch = rawText.match(/\{[\s\S]*\}/);
      const parsed = JSON.parse(jsonMatch ? jsonMatch[0] : rawText);
      if (parsed && Array.isArray(parsed.posts)) {
        posts = parsed.posts.slice(0, 12).map((p, idx) => ({
          id: activeTab + '-' + Date.now() + '-' + idx,
          authorName: String(p.authorName || FORUM_AUTHOR_NAMES[idx % FORUM_AUTHOR_NAMES.length]).slice(0, 30),
          content: String(p.content || '').slice(0, 500),
          time: String(p.time || '刚刚').slice(0, 20),
          likes: Math.floor(Math.random() * 500) + 10,
          avatarIndex: idx % FORUM_AVATAR_COUNT,
          commentsList: []
        }));
      }
    } catch (e) {
      console.warn('Forum JSON parse error:', e.message);
    }

    if (posts.length === 0) posts = generateFallbackPosts(activeTab, roleName);
    ok(res, { posts, tab: activeTab });
  } catch (error) {
    ok(res, { posts: generateFallbackPosts(activeTab, roleName), tab: activeTab, error: error.message });
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
  try {
    const prompt = '你是一个论坛评论区生成器。请为以下帖子生成' + (count || 3) + '条评论。\n\n' +
      '帖子作者：' + (postAuthor || '匿名') + '\n' +
      '帖子内容：' + String(postContent || '').slice(0, 200) + '\n\n' +
      '要求：\n1. 评论风格参考小红书和微博评论区，口语化、真实\n2. 每条评论10-50字\n3. 可以带emoji\n4. 评论要有不同立场和风格（赞同、调侃、追问、分享经历等）\n5. 返回JSON格式：{"comments":[{"authorName":"","content":"","time":""}]}\n6. 只返回JSON，不要解释';

    if (!config.upstreamKey || config.upstreamKey.includes('请填写')) {
      return ok(res, { comments: generateFallbackComments(postContent, count) });
    }

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 12000);
    const apiResp = await fetch(config.upstreamBase + '/chat/completions', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + config.upstreamKey },
      signal: controller.signal,
      body: JSON.stringify({
        model: config.upstreamModel,
        stream: false,
        messages: [{ role: 'user', content: prompt }]
      })
    }).finally(() => clearTimeout(timeout));

    if (!apiResp.ok) throw new Error('上游API异常: ' + apiResp.status);
    const apiData = await apiResp.json();
    const rawText = apiData.choices?.[0]?.message?.content || '';

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

    if (comments.length === 0) comments = generateFallbackComments(postContent, count);
    ok(res, { comments });
  } catch (error) {
    ok(res, { comments: generateFallbackComments(postContent, count), error: error.message });
  }
});

/* === User Profile (个人主页) API === */

app.get('/api/profile', (req, res) => {
  const profile = userProfiles.get(req.userId) || { nickname: '体验用户', bio: '', avatar: '' };
  ok(res, profile);
});

app.post('/api/profile', (req, res) => {
  const { nickname, bio, avatar } = req.body || {};
  const profile = {
    nickname: String(nickname || '体验用户').slice(0, 40),
    bio: String(bio || '').slice(0, 500),
    avatar: String(avatar || '').slice(0, 200000),
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
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 15000);
    const apiResp = await fetch(config.upstreamBase + '/chat/completions', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + config.upstreamKey },
      signal: controller.signal,
      body: JSON.stringify({
        model: config.upstreamModel,
        stream: false,
        messages: [
          { role: 'system', content: sysPrompt },
          { role: 'user', content: String(userMessage).slice(0, 300) }
        ]
      })
    }).finally(() => clearTimeout(timeout));
    if (!apiResp.ok) throw new Error('上游API异常: ' + apiResp.status);
    const apiData = await apiResp.json();
    const reply = apiData.choices?.[0]?.message?.content || '收到啦~';
    ok(res, { reply: String(reply).slice(0, 200) });
  } catch (error) {
    ok(res, { reply: '抱歉，我现在不太方便回复，稍后再聊~', error: error.message });
  }
});

/* === Novel Game (文游) Module === */

const NOVEL_GAMES_DIR = path.join(__dirname, 'novel-games');
const loadedScripts = new Map();
let designPrinciplesText = '';

/* Load shared design principles (from user templates) and build a text block */
const loadDesignPrinciples = () => {
  try {
    const filePath = path.join(NOVEL_GAMES_DIR, '_design-principles.json');
    if (!fs.existsSync(filePath)) return;
    const data = JSON.parse(fs.readFileSync(filePath, 'utf8'));
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
    if (!fs.existsSync(NOVEL_GAMES_DIR)) return;
    const files = fs.readdirSync(NOVEL_GAMES_DIR).filter(f => f.endsWith('.json') && !f.startsWith('_'));
    for (const file of files) {
      try {
        const content = fs.readFileSync(path.join(NOVEL_GAMES_DIR, file), 'utf8');
        const script = JSON.parse(content);
        if (script.id && !script._hidden) loadedScripts.set(script.id, script);
      } catch (e) { console.warn('加载剧本失败:', file, e.message); }
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
const buildNovelGamePrompt = (script, save, playerAction) => {
  const npcBlock = (script.npcs || []).map(n => {
    const s = save.state?.npcs?.[n.id] || {};
    return `【${n.name}】${n.role}\n外貌：${n.appearance}\n性格：${n.surface}\n深层：${n.deep}\n当前对玩家态度：${s.attitude || n.initialAttitude}\n信任度：${s.trust || 0}\n`;
  }).join('\n');

  const statBlock = Object.entries(save.state?.player?.stats || {}).map(([k, v]) => `${k}:${v}`).join(' ');
  const invBlock = (save.state?.player?.inventory || []).join('、');
  const worldInfo = save.currentWorld ? script.worlds?.find(w => w.id === save.currentWorld) : null;

  let prompt = script.systemPrompt || '';
  if (designPrinciplesText) {
    prompt = designPrinciplesText + '\n\n' + prompt;
  }
  prompt += '\n\n【当前游戏状态】\n';
  prompt += `剧本：${script.name}\n`;
  if (worldInfo) prompt += `当前世界：${worldInfo.name}（${worldInfo.level}）\n${worldInfo.setting}\n目标：${worldInfo.objective}\n`;
  prompt += `玩家：${save.player?.name || '未命名'}\n`;
  prompt += `属性：${statBlock}\n`;
  if (invBlock) prompt += `背包：${invBlock}\n`;
  prompt += `轮次：第${save.round || 0}轮\n`;
  if (save.history && save.history.length > 0) {
    prompt += '\n【最近剧情摘要】\n';
    prompt += save.history.slice(-5).map((h, i) => `${i + 1}. ${h.summary || h.action || '...'}`).join('\n');
  }
  prompt += '\n\n【NPC状态】\n' + npcBlock;
  if (save.state?.pendingEvents?.length) {
    prompt += '\n\n【待处理事项】\n' + save.state.pendingEvents.slice(-5).join('\n');
  }
  prompt += `\n\n【玩家本轮行动】\n${playerAction}\n\n请根据以上信息生成本轮游戏内容。`;
  return prompt;
};

/* Parse stat changes from AI reply */
const parseStatChanges = (text) => {
  const changes = [];
  const regex = /\[\s*([^\]]+?)\s*([\+\-]\d+)\s*\]/g;
  let match;
  while ((match = regex.exec(text)) !== null) {
    changes.push({ stat: match[1].trim(), delta: Number(match[2]) });
  }
  return changes;
};

app.post('/api/novel-games/action', async (req, res) => {
  const { saveId, action, customAction } = req.body || {};
  if (!saveId) return fail(res, 400, 4008, '缺少存档ID');
  const list = novelGameSaves.get(req.userId) || [];
  const save = list.find(s => s.id === saveId);
  if (!save) return fail(res, 404, 4043, '存档不存在');

  const script = loadedScripts.get(save.scriptId);
  if (!script) return fail(res, 404, 4044, '剧本不存在');

  const playerAction = customAction || action || '继续探索';
  const sysPrompt = buildNovelGamePrompt(script, save, playerAction);

  try {
    if (!config.upstreamKey || config.upstreamKey.includes('请填写')) {
      return ok(res, {
        content: `【第${(save.round || 0) + 1}轮】\n\n你选择了：${playerAction}\n\n（AI服务未配置，无法生成剧情。请在.env中配置UPSTREAM_API_KEY）\n\n【可选行动】\n1. 继续探索\n2. 与NPC交谈\n3. 查看背包\n4. 休息恢复\n5. 【自定义行动】`,
        statChanges: [],
        round: (save.round || 0) + 1
      });
    }

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 60000);
    const apiResp = await fetch(config.upstreamBase + '/chat/completions', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + config.upstreamKey },
      signal: controller.signal,
      body: JSON.stringify({
        model: config.upstreamModel,
        stream: false,
        messages: [
          { role: 'system', content: sysPrompt },
          { role: 'user', content: playerAction }
        ]
      })
    }).finally(() => clearTimeout(timeout));

    if (!apiResp.ok) throw new Error('上游API异常: ' + apiResp.status);
    const apiData = await apiResp.json();
    const content = apiData.choices?.[0]?.message?.content || 'AI生成内容为空';
    const statChanges = parseStatChanges(content);

    ok(res, { content, statChanges, round: (save.round || 0) + 1 });
  } catch (error) {
    ok(res, { content: '剧情生成失败：' + error.message + '\n\n请重试或检查AI服务配置。', statChanges: [], round: save.round || 0, error: error.message });
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

  if (changes) {
    for (const c of changes) {
      if (c.npcId && c.stat === 'trust') {
        if (!save.state.npcs[c.npcId]) save.state.npcs[c.npcId] = {};
        save.state.npcs[c.npcId].trust = (save.state.npcs[c.npcId].trust || 0) + c.delta;
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
