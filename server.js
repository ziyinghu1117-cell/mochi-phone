import express from 'express';
import cors from 'cors';
import helmet from 'helmet';
import dotenv from 'dotenv';
import { randomUUID } from 'crypto';

dotenv.config();

const app = express();
const PORT = Number(process.env.PORT || 3000);
const HOST = process.env.HOST || '0.0.0.0';
const FRONTEND_HTML = `<!doctype html>\n<html lang=\"zh-CN\">\n  <head>\n    <meta charset=\"UTF-8\" />\n    <meta name=\"viewport\" content=\"width=device-width, initial-scale=1.0, viewport-fit=cover\" />\n    <title>Mochi-phone</title>\n    <style>\n      * { margin: 0; padding: 0; box-sizing: border-box; }\n      body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; background: #e8e5ff; display: flex; justify-content: center; min-height: 100vh; }\n      .phone { width: 100%; max-width: 420px; background: #f8f7ff; display: flex; flex-direction: column; min-height: 100vh; position: relative; }\n      .header { padding: 16px; background: linear-gradient(135deg, #f0edff, #e8e5ff); position: sticky; top: 0; z-index: 10; }\n      .header h1 { font-size: 20px; font-weight: 600; color: #333; margin-bottom: 12px; }\n      .beans-badge { position: absolute; top: 16px; right: 16px; background: #7c6cf5; color: white; padding: 6px 14px; border-radius: 20px; font-size: 14px; font-weight: 500; }\n      .role-tabs { display: flex; gap: 8px; overflow-x: auto; padding-bottom: 4px; }\n      .role-tab { display: flex; align-items: center; gap: 6px; padding: 8px 14px; border-radius: 20px; background: white; cursor: pointer; white-space: nowrap; font-size: 14px; border: 2px solid transparent; flex-shrink: 0; }\n      .role-tab.active { background: #7c6cf5; color: white; border-color: #7c6cf5; }\n      .role-avatar { width: 24px; height: 24px; border-radius: 50%; background: linear-gradient(135deg, #b8a9ff, #ffb8d9); display: flex; align-items: center; justify-content: center; font-size: 12px; color: white; font-weight: 600; }\n      .chat-area { flex: 1; padding: 16px; overflow-y: auto; display: flex; flex-direction: column; gap: 12px; }\n      .chat-empty { text-align: center; color: #999; padding: 40px 20px; font-size: 14px; }\n      .message { display: flex; gap: 8px; max-width: 85%; }\n      .message.user { align-self: flex-end; flex-direction: row-reverse; }\n      .message-avatar { width: 32px; height: 32px; border-radius: 50%; background: linear-gradient(135deg, #b8a9ff, #ffb8d9); flex-shrink: 0; display: flex; align-items: center; justify-content: center; font-size: 12px; color: white; font-weight: 600; }\n      .message.user .message-avatar { background: linear-gradient(135deg, #7c6cf5, #9b8cf5); }\n      .message-bubble { padding: 10px 14px; border-radius: 18px; background: white; font-size: 14px; line-height: 1.6; word-break: break-word; box-shadow: 0 2px 8px rgba(0,0,0,0.04); }\n      .message.user .message-bubble { background: #7c6cf5; color: white; }\n      .message-bubble.typing { display: flex; gap: 4px; padding: 14px 16px; }\n      .typing-dot { width: 6px; height: 6px; border-radius: 50%; background: #ccc; animation: typing 1.4s infinite; }\n      .typing-dot:nth-child(2) { animation-delay: 0.2s; }\n      .typing-dot:nth-child(3) { animation-delay: 0.4s; }\n      @keyframes typing { 0%, 60%, 100% { transform: translateY(0); opacity: 0.4; } 30% { transform: translateY(-4px); opacity: 1; } }\n      .input-area { padding: 12px 16px; background: white; border-top: 1px solid #f0f0f0; display: flex; gap: 8px; align-items: flex-end; }\n      .input-area textarea { flex: 1; border: 1px solid #e0e0e0; border-radius: 20px; padding: 10px 16px; font-size: 14px; resize: none; max-height: 100px; outline: none; font-family: inherit; }\n      .input-area textarea:focus { border-color: #7c6cf5; }\n      .send-btn { background: #7c6cf5; color: white; border: none; border-radius: 20px; padding: 10px 20px; font-size: 14px; cursor: pointer; font-weight: 500; }\n      .send-btn:disabled { opacity: 0.5; cursor: not-allowed; }\n      .bottom-nav { display: flex; background: white; border-top: 1px solid #f0f0f0; padding: 8px 0; padding-bottom: max(8px, env(safe-area-inset-bottom)); }\n      .nav-item { flex: 1; text-align: center; padding: 6px; cursor: pointer; font-size: 12px; color: #999; }\n      .nav-item.active { color: #7c6cf5; font-weight: 500; }\n      .refund-toast { position: fixed; top: 20px; left: 50%; transform: translateX(-50%); background: #52c41a; color: white; padding: 10px 20px; border-radius: 8px; font-size: 14px; z-index: 1000; animation: slideDown 0.3s ease; }\n      @keyframes slideDown { from { opacity: 0; transform: translateX(-50%) translateY(-20px); } to { opacity: 1; transform: translateX(-50%) translateY(0); } }\n    </style>\n  </head>\n  <body>\n    <div class=\"phone\">\n      <div class=\"header\">\n        <h1>角色聊天</h1>\n        <div class=\"beans-badge\" id=\"beansBadge\">豆子 0</div>\n        <div class=\"role-tabs\" id=\"roleTabs\"></div>\n      </div>\n      <div class=\"chat-area\" id=\"chatArea\">\n        <div class=\"chat-empty\">开始和「温柔陪伴师」聊天吧。</div>\n      </div>\n      <div class=\"input-area\">\n        <textarea id=\"messageInput\" placeholder=\"输入想对角色说的话...\" rows=\"1\"></textarea>\n        <button class=\"send-btn\" id=\"sendBtn\" onclick=\"sendMessage()\">发送</button>\n      </div>\n      <div class=\"bottom-nav\">\n        <div class=\"nav-item active\">聊天</div>\n        <div class=\"nav-item\">角色</div>\n        <div class=\"nav-item\">社区</div>\n        <div class=\"nav-item\">我的</div>\n      </div>\n    </div>\n    <script>\n      let currentRole = null;\n      let roles = [];\n      let userId = localStorage.getItem('mochi_user_id') || 'demo-' + Math.random().toString(36).slice(2, 10);\n      localStorage.setItem('mochi_user_id', userId);\n      let isSending = false;\n\n      async function loadRoles() {\n        try {\n          const res = await fetch('/api/community/roles');\n          const data = await res.json();\n          roles = data.data.list;\n          renderRoleTabs();\n          if (roles.length > 0) selectRole(roles[0]);\n        } catch(e) { console.error(e); }\n      }\n\n      function renderRoleTabs() {\n        const tabs = document.getElementById('roleTabs');\n        tabs.innerHTML = roles.map((r, i) => `\n          <div class=\"role-tab ${i===0?'active':''}\" onclick=\"selectRole(roles[${i}])\">\n            <div class=\"role-avatar\">${r.name.slice(0,1)}</div>\n            ${r.name}\n          </div>\n        `).join('');\n      }\n\n      function selectRole(role) {\n        currentRole = role;\n        document.querySelectorAll('.role-tab').forEach((t, i) => t.classList.toggle('active', roles[i].id === role.id));\n        document.getElementById('chatArea').innerHTML = `<div class=\"chat-empty\">开始和「${role.name}」聊天吧。</div>`;\n      }\n\n      async function loadUserInfo() {\n        try {\n          const res = await fetch('/api/user/me', { headers: { 'x-user-id': userId } });\n          const data = await res.json();\n          document.getElementById('beansBadge').textContent = '豆子 ' + data.data.beans;\n        } catch(e) { console.error(e); }\n      }\n\n      async function sendMessage() {\n        if (isSending) return;\n        const input = document.getElementById('messageInput');\n        const text = input.value.trim();\n        if (!text || !currentRole) return;\n        isSending = true;\n        document.getElementById('sendBtn').disabled = true;\n\n        const chatArea = document.getElementById('chatArea');\n        if (chatArea.querySelector('.chat-empty')) chatArea.innerHTML = '';\n\n        chatArea.innerHTML += `\n          <div class=\"message user\">\n            <div class=\"message-avatar\">体</div>\n            <div class=\"message-bubble\">${text.replace(/</g,'&lt;')}</div>\n          </div>\n        `;\n\n        const aiMsgId = 'ai-' + Date.now();\n        chatArea.innerHTML += `\n          <div class=\"message\" id=\"${aiMsgId}\">\n            <div class=\"message-avatar\">${currentRole.name.slice(0,1)}</div>\n            <div class=\"message-bubble typing\">\n              <div class=\"typing-dot\"></div><div class=\"typing-dot\"></div><div class=\"typing-dot\"></div>\n            </div>\n          </div>\n        `;\n        chatArea.scrollTop = chatArea.scrollHeight;\n        input.value = '';\n\n        try {\n          const eventSource = new EventSource('/api/chat/stream?roleId=' + encodeURIComponent(currentRole.id) + '&message=' + encodeURIComponent(text), { headers: { 'x-user-id': userId } });\n          let fullContent = '';\n          let bubbleEl = null;\n\n          eventSource.addEventListener('delta', (e) => {\n            const data = JSON.parse(e.data);\n            fullContent += data.content;\n            if (!bubbleEl) {\n              const msgEl = document.getElementById(aiMsgId);\n              msgEl.querySelector('.message-bubble').outerHTML = `<div class=\"message-bubble\">${fullContent.replace(/\\n/g,'<br>')}</div>`;\n              bubbleEl = msgEl.querySelector('.message-bubble');\n            } else {\n              bubbleEl.innerHTML = fullContent.replace(/\\n/g,'<br>');\n            }\n            chatArea.scrollTop = chatArea.scrollHeight;\n          });\n\n          eventSource.addEventListener('refund', (e) => {\n            const data = JSON.parse(e.data);\n            document.getElementById('beansBadge').textContent = '豆子 ' + data.beans;\n            showToast(data.reason + '，豆子已退还');\n          });\n\n          eventSource.addEventListener('done', () => {\n            eventSource.close();\n            loadUserInfo();\n            isSending = false;\n            document.getElementById('sendBtn').disabled = false;\n          });\n\n          eventSource.onerror = () => {\n            eventSource.close();\n            isSending = false;\n            document.getElementById('sendBtn').disabled = false;\n          };\n        } catch(e) {\n          isSending = false;\n          document.getElementById('sendBtn').disabled = false;\n          console.error(e);\n        }\n      }\n\n      function showToast(text) {\n        const toast = document.createElement('div');\n        toast.className = 'refund-toast';\n        toast.textContent = text;\n        document.body.appendChild(toast);\n        setTimeout(() => toast.remove(), 2500);\n      }\n\n      document.getElementById('messageInput').addEventListener('keydown', (e) => {\n        if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); sendMessage(); }\n      });\n\n      loadRoles();\n      loadUserInfo();\n    </script>\n  </body>\n</html>`;

const config = {
  upstreamBase: 'https://az.zlapi.vip/v1',
  upstreamKey: process.env.UPSTREAM_API_KEY || '',
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
const stats = { totalRechargeCny: 0, totalBeansConsumed: 0, totalChatCount: 0, totalRefundBeans: 0 };

const ok = (res, data = {}, message = 'success') => res.json({ code: 0, message, data });
const fail = (res, status, code, message, details = null) => res.status(status).json({ code, message, details });

const getUser = (userId = 'demo-user') => {
  if (!users.has(userId)) users.set(userId, { id: userId, beans: config.demoInitialBeans, createdAt: new Date().toISOString() });
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
app.use((req, _res, next) => {
  req.userId = String(req.headers['x-user-id'] || 'demo-user').slice(0, 80);
  next();
});

app.get('/', (_req, res) => {
  res.setHeader('Content-Type', 'text/html; charset=utf-8');
  res.send(FRONTEND_HTML);
});

app.get('/api/health', (_req, res) => ok(res, { status: 'running', name: 'Mochi-phone' }));

app.get('/api/user/me', (req, res) => {
  const user = getUser(req.userId);
  ok(res, { id: user.id, beans: user.beans, transactions: transactions.filter(item => item.userId === user.id).slice(-50).reverse() });
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
  ok(res, { beans: user.beans }, '充值成功');
});

app.get('/api/user/export-data', (req, res) => {
  const user = getUser(req.userId);
  ok(res, {
    userId: user.id,
    beans: user.beans,
    transactions: transactions.filter(item => item.userId === user.id).slice(-200)
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
        amount: item.amount || 0,
        roleName: item.roleName || '数据恢复',
        summary: item.summary || '从备份文件恢复',
        createdAt: item.createdAt || new Date().toISOString()
      });
    }
  }
  ok(res, {
    userId: targetUserId,
    beans: user.beans,
    transactions: transactions.filter(item => item.userId === targetUserId).slice(-200)
  }, '数据已恢复');
});

app.get('/api/user/stats', (_req, res) => ok(res, stats));

app.get('/api/community/roles', (req, res) => {
  const keyword = String(req.query.keyword || '').trim().toLowerCase();
  const list = communityRoles.filter((role) => !keyword || `${role.name} ${role.description} ${role.prompt}`.toLowerCase().includes(keyword));
  ok(res, { list, total: list.length, page: 1, pageSize: 12 });
});

// ========== 聊天接口（含空回复退豆子） ==========
app.get('/api/chat/stream', async (req, res) => {
  const user = getUser(req.userId);
  const roleId = String(req.query.roleId || '');
  const message = String(req.query.message || '').trim();

  if (!message) return fail(res, 400, 1001, '消息内容不能为空');

  const role = communityRoles.find(r => r.id === roleId) || communityRoles[0];

  // 豆子检查
  if (user.beans < config.chatBeansCost) {
    return fail(res, 402, 2001, '豆子不足，请充值后再聊。');
  }

  // 先扣费
  const deductedBeans = config.chatBeansCost;
  user.beans -= deductedBeans;
  stats.totalBeansConsumed += deductedBeans;
  stats.totalChatCount++;

  // 设置 SSE 响应头
  res.setHeader('Content-Type', 'text/event-stream; charset=utf-8');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');

  let replyContent = '';
  let hasError = false;

  try {
    if (!config.upstreamKey) {
      // 没有配置 API 密钥，返回降级提示
      const fallbackText = `我是${role.name}。我已经收到你的消息："${message}"。\n\n当前网站后端已运行，但还没有读取到 UPSTREAM_API_KEY 环境变量。请在 Render 后台配置后才能使用真实 AI 回复。`;
      await streamText(res, fallbackText);
      replyContent = fallbackText;
    } else {
      // 调用真实上游 API
      const messages = [
        { role: 'system', content: role.prompt || '你是一个友好的AI助手。' },
        { role: 'user', content: message }
      ];

      const apiRes = await fetch(`${config.upstreamBase}/chat/completions`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${config.upstreamKey}`
        },
        body: JSON.stringify({
          model: config.upstreamModel,
          messages: messages,
          stream: true,
          temperature: 0.8
        })
      });

      if (!apiRes.ok) {
        throw new Error(`API 请求失败: ${apiRes.status}`);
      }

      const reader = apiRes.body.getReader();
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
          if (!trimmed || !trimmed.startsWith('data: ')) continue;
          const dataStr = trimmed.slice(6).trim();
          if (dataStr === '[DONE]') continue;

          try {
            const data = JSON.parse(dataStr);
            const delta = data.choices?.[0]?.delta?.content || '';
            if (delta) {
              replyContent += delta;
              writeSse(res, 'delta', { content: delta });
            }
          } catch (e) {
            // 忽略解析错误
          }
        }
      }
    }
  } catch (err) {
    console.error('Chat error:', err);
    hasError = true;
  }

  // ===== 空回复退豆子逻辑 =====
  if (hasError || replyContent.trim().length < 5) {
    user.beans += deductedBeans;
    stats.totalBeansConsumed -= deductedBeans;
    stats.totalRefundBeans += deductedBeans;

    transactions.push({
      id: randomUUID(),
      userId: user.id,
      type: 'refund',
      beans: deductedBeans,
      roleName: '系统退款',
      summary: `AI回复异常，退还 ${deductedBeans} 豆子`,
      createdAt: new Date().toISOString()
    });

    writeSse(res, 'refund', { beans: user.beans, reason: '回复生成失败' });
  }

  writeSse(res, 'done', { beans: user.beans });
  res.end();
});

app.listen(PORT, HOST, () => {
  console.log(`Mochi-phone server running on http://${HOST}:${PORT}`);
});
