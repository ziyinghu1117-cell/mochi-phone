import express from 'express';
import cors from 'cors';
import helmet from 'helmet';
import dotenv from 'dotenv';
import { randomUUID } from 'crypto';
import pg from 'pg';

dotenv.config();

const { Pool } = pg;
const app = express();
const PORT = Number(process.env.PORT || 3000);
const HOST = process.env.HOST || '0.0.0.0';

// ===== 数据库连接 =====
const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: process.env.DATABASE_URL?.includes('localhost') ? false : { rejectUnauthorized: false }
});

// ===== 前端 HTML =====
const FRONTEND_HTML = `<!doctype html>
<html lang="zh-CN">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0, viewport-fit=cover" />
    <title>Mochi-phone</title>
    <meta name="theme-color" content="#7466ff" />
    <meta name="apple-mobile-web-app-capable" content="yes" />
    <meta name="apple-mobile-web-app-title" content="Mochi-phone" />
    <meta name="apple-mobile-web-app-status-bar-style" content="default" />
    <style>
:root {
  --color-primary: #7466ff;
  --color-primary-dark: #5a4ee0;
  --color-accent: #ff8fb3;
  --color-bg: #f7f5ff;
  --color-surface: rgba(255, 255, 255, 0.92);
  --color-text: #232136;
  --color-muted: #7b7890;
  --color-border: rgba(116, 102, 255, 0.15);
  --color-danger: #e95656;
  --chat-wallpaper: linear-gradient(180deg, #fbfaff 0%, #f0edff 100%);
  --bubble-user-bg: linear-gradient(135deg, #7466ff, #9a8cff);
  --bubble-user-text: #ffffff;
  --bubble-ai-bg: rgba(255, 255, 255, 0.96);
  --bubble-ai-text: #25223a;
  --bubble-radius: 18px;
  --safe-bottom: env(safe-area-inset-bottom, 0px);
}
* { box-sizing: border-box; }
body {
  margin: 0; min-height: 100vh; background: #dedaf8; color: var(--color-text);
  font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
}
button, input, textarea { font: inherit; }
button { border: 0; cursor: pointer; transition: transform 0.16s ease, opacity 0.16s ease; }
button:active { transform: scale(0.97); }
.app-shell {
  position: relative; width: min(100vw, 430px); min-height: 100vh; margin: 0 auto;
  overflow: hidden; background: var(--color-bg); box-shadow: 0 0 40px rgba(35, 33, 54, 0.14);
}
.top-bar {
  position: sticky; top: 0; z-index: 20; display: flex; align-items: center; justify-content: space-between;
  padding: 14px 16px 10px; background: rgba(247, 245, 255, 0.9); backdrop-filter: blur(18px);
}
.eyebrow { margin: 0 0 2px; color: var(--color-muted); font-size: 12px; }
h1, h2, h3, p { margin-top: 0; }
h1 { margin-bottom: 0; font-size: 22px; }
.beans-badge, .primary-small, .chat-input-bar button, .search-row button,
.profile-card button, .package-card, .modal-actions button {
  border-radius: 999px; background: var(--color-primary); color: #fff; font-weight: 700;
}
.beans-badge { padding: 9px 13px; box-shadow: 0 8px 18px rgba(116, 102, 255, 0.24); }
.page-stack { height: calc(100vh - 73px); }
.page { display: none; height: calc(100vh - 73px); padding: 0 14px 86px; overflow-y: auto; }
.page.active { display: block; }
#chatPage { padding: 0; overflow: hidden; }
.role-switcher {
  display: flex; gap: 10px; overflow-x: auto; padding: 8px 14px 10px; scrollbar-width: none;
}
.role-chip {
  display: flex; flex: 0 0 auto; align-items: center; gap: 7px;
  padding: 7px 10px 7px 7px; border: 1px solid var(--color-border);
  border-radius: 999px; background: var(--color-surface); color: var(--color-text);
}
.role-chip.active { background: var(--color-primary); color: #fff; }
.avatar {
  width: 34px; height: 34px; border-radius: 50%; object-fit: cover;
  background: linear-gradient(135deg, #ffcadb, #c7c2ff);
}
.chat-container {
  height: calc(100vh - 206px); overflow-y: auto;
  background: var(--chat-wallpaper); background-size: cover; background-position: center;
}
.message-list { min-height: 100%; padding: 18px 14px 24px; }
.message-row { display: flex; align-items: flex-end; gap: 8px; margin-bottom: 14px; }
.message-row.user { flex-direction: row-reverse; }
.chat-bubble {
  max-width: 74%; padding: 11px 13px; border-radius: var(--bubble-radius);
  line-height: 1.6; white-space: pre-wrap; word-break: break-word;
  box-shadow: 0 6px 18px rgba(35, 33, 54, 0.08);
}
.message-row.user .chat-bubble {
  border-bottom-right-radius: 5px; background: var(--bubble-user-bg); color: var(--bubble-user-text);
}
.message-row.assistant .chat-bubble {
  border-bottom-left-radius: 5px; background: var(--bubble-ai-bg); color: var(--bubble-ai-text);
}
.typing-dot { display: inline-flex; gap: 4px; }
.typing-dot i {
  width: 6px; height: 6px; border-radius: 50%; background: var(--color-primary);
  animation: bounce 0.9s infinite alternate;
}
.typing-dot i:nth-child(2) { animation-delay: 0.14s; }
.typing-dot i:nth-child(3) { animation-delay: 0.28s; }
@keyframes bounce { to { transform: translateY(-4px); opacity: 0.4; } }
.chat-input-bar {
  position: fixed; right: calc((100vw - min(100vw, 430px)) / 2);
  bottom: calc(58px + var(--safe-bottom));
  left: calc((100vw - min(100vw, 430px)) / 2);
  display: flex; gap: 9px; width: min(100vw, 430px); padding: 10px 12px;
  background: rgba(255, 255, 255, 0.94); border-top: 1px solid var(--color-border);
}
.chat-input-bar textarea, input, textarea {
  width: 100%; border: 1px solid var(--color-border); border-radius: 16px;
  padding: 11px 12px; outline: none; background: #fff; color: var(--color-text); resize: none;
}
.chat-input-bar textarea { max-height: 96px; }
.chat-input-bar button { min-width: 64px; padding: 0 14px; }
.bottom-nav {
  position: fixed; right: calc((100vw - min(100vw, 430px)) / 2); bottom: 0;
  left: calc((100vw - min(100vw, 430px)) / 2); z-index: 30;
  display: grid; grid-template-columns: repeat(4, 1fr); width: min(100vw, 430px);
  padding: 8px 8px calc(8px + var(--safe-bottom));
  background: rgba(255, 255, 255, 0.94); border-top: 1px solid var(--color-border); backdrop-filter: blur(18px);
}
.bottom-nav button {
  padding: 8px 0; border-radius: 14px; background: transparent; color: var(--color-muted);
}
.bottom-nav button.active {
  background: rgba(116, 102, 255, 0.12); color: var(--color-primary); font-weight: 800;
}
.section-header, .search-row, .tabs, .modal-actions { display: flex; align-items: center; gap: 10px; }
.section-header { justify-content: space-between; padding-top: 10px; }
.primary-small { padding: 9px 14px; }
.card-list, .waterfall-list, .transaction-list { display: grid; gap: 12px; }
.role-card, .community-card, .profile-card, .panel {
  padding: 14px; border: 1px solid var(--color-border); border-radius: 22px;
  background: var(--color-surface); box-shadow: 0 10px 24px rgba(35, 33, 54, 0.06);
}
.role-card, .community-card { display: grid; grid-template-columns: 48px 1fr; gap: 12px; }
.role-card h3, .community-card h3 { margin-bottom: 4px; }
.role-card p, .community-card p, .muted {
  margin-bottom: 8px; color: var(--color-muted); font-size: 13px; line-height: 1.5;
}
.card-actions { display: flex; flex-wrap: wrap; gap: 8px; }
.card-actions button, .settings-list button, .tabs button {
  padding: 9px 12px; border-radius: 999px;
  background: rgba(116, 102, 255, 0.1); color: var(--color-primary); font-weight: 700;
}
.search-row { padding: 12px 0; }
.search-row button { padding: 11px 14px; }
.profile-card, .panel { margin-top: 12px; }
.profile-card label {
  display: grid; gap: 7px; margin-bottom: 12px;
  color: var(--color-muted); font-size: 13px; font-weight: 700;
}
.avatar-uploader { justify-items: center; text-align: center; }
.avatar-uploader img {
  width: 76px; height: 76px; border-radius: 50%; object-fit: cover;
  background: linear-gradient(135deg, #ffcadb, #c7c2ff);
}
.avatar-uploader input { display: none; }
.balance { display: block; margin: 8px 0 12px; color: var(--color-primary); font-size: 34px; }
.package-grid { display: grid; grid-template-columns: repeat(2, 1fr); gap: 10px; }
.package-card { padding: 12px; }
.settings-list { display: grid; gap: 10px; }
.tabs { position: sticky; top: 0; z-index: 5; padding: 12px 0; background: var(--color-bg); }
.tabs button.active { background: var(--color-primary); color: #fff; }
.costume-editor { display: grid; gap: 12px; }
.code-editor { min-height: 260px; font-family: ui-monospace, SFMono-Regular, Menlo, monospace; font-size: 13px; }
.wallpaper-preview {
  min-height: 160px; border-radius: 22px;
  background: var(--chat-wallpaper); background-position: center; background-size: cover;
}
.modal {
  width: min(92vw, 390px); border: 0; border-radius: 24px; padding: 18px; color: var(--color-text);
}
.modal::backdrop { background: rgba(35, 33, 54, 0.42); }
.modal label {
  display: grid; gap: 7px; margin-bottom: 11px;
  color: var(--color-muted); font-size: 13px; font-weight: 700;
}
.switch-line { display: flex !important; grid-template-columns: auto 1fr; align-items: center; }
.switch-line input { width: auto; }
.modal-actions { justify-content: end; }
.modal-actions span { flex: 1; }
.modal-actions button { padding: 10px 14px; }
.modal-actions button[value="cancel"] { background: #efedf8; color: var(--color-text); }
.danger { background: var(--color-danger) !important; }
.toast {
  position: fixed; left: 50%; bottom: calc(82px + var(--safe-bottom)); z-index: 80;
  max-width: min(86vw, 360px); padding: 11px 14px; border-radius: 999px;
  background: rgba(35, 33, 54, 0.92); color: #fff;
  opacity: 0; transform: translate(-50%, 12px); pointer-events: none; transition: 0.24s ease;
}
.toast.show { opacity: 1; transform: translate(-50%, 0); }
.empty-state { padding: 26px 16px; color: var(--color-muted); text-align: center; }
@media (min-width: 431px) { .app-shell { min-height: 920px; } }
    </style>
  </head>
  <body>
    <div id="app" class="app-shell">
      <header class="top-bar">
        <div>
          <p class="eyebrow">Mochi-phone</p>
          <h1 id="pageTitle">角色聊天</h1>
        </div>
        <button id="beansBadge" class="beans-badge" type="button">豆子 0</button>
      </header>
      <main class="page-stack">
        <section id="chatPage" class="page active">
          <div id="roleSwitcher" class="role-switcher"></div>
          <div id="chatContainer" class="chat-container">
            <div id="messageList" class="message-list"></div>
          </div>
          <form id="chatForm" class="chat-input-bar">
            <textarea id="messageInput" rows="1" placeholder="输入想对角色说的话..."></textarea>
            <button id="sendButton" type="submit">发送</button>
          </form>
        </section>
        <section id="rolesPage" class="page">
          <div class="section-header">
            <h2>我的角色</h2>
            <button id="newRoleButton" class="primary-small" type="button">新建</button>
          </div>
          <div id="myRolesList" class="card-list"></div>
        </section>
        <section id="communityPage" class="page">
          <div class="search-row">
            <input id="communitySearch" type="search" placeholder="搜索角色名称或关键词" />
            <button id="communitySearchButton" type="button">搜索</button>
          </div>
          <div id="communityList" class="waterfall-list"></div>
        </section>
        <section id="profilePage" class="page">
          <div class="profile-card">
            <label class="avatar-uploader">
              <img id="userAvatarPreview" alt="用户头像" />
              <input id="userAvatarInput" type="file" accept="image/*" />
              <span>更换头像</span>
            </label>
            <label>昵称<input id="userNicknameInput" type="text" maxlength="24" /></label>
            <label>个人人设<textarea id="userBioInput" rows="4"></textarea></label>
            <button id="saveProfileButton" type="button">保存资料</button>
          </div>
          <div class="panel">
            <h3>豆子资产</h3>
            <strong id="beansBalance" class="balance">0</strong>
            <div id="rechargePackages" class="package-grid"></div>
          </div>
          <div class="panel">
            <h3>消费明细</h3>
            <div id="transactionList" class="transaction-list"></div>
          </div>
          <div class="panel settings-list">
            <button id="backupCodeButton" type="button">📤 备份恢复码</button>
            <button id="restoreCodeButton" type="button">📥 导入恢复码</button>
            <button data-costume-tab="page" type="button">自定义页面 UI</button>
            <button data-costume-tab="bubble" type="button">自定义聊天气泡</button>
            <button data-costume-tab="wallpaper" type="button">自定义聊天壁纸</button>
            <button id="clearCacheButton" type="button">清空本地缓存</button>
          </div>
        </section>
        <section id="costumePage" class="page">
          <div class="tabs">
            <button class="active" data-costume-mode="page" type="button">页面 UI</button>
            <button data-costume-mode="bubble" type="button">聊天气泡</button>
            <button data-costume-mode="wallpaper" type="button">壁纸</button>
          </div>
          <div id="costumeEditorWrap" class="costume-editor"></div>
        </section>
      </main>
      <nav class="bottom-nav">
        <button class="active" data-page="chatPage" type="button">聊天</button>
        <button data-page="rolesPage" type="button">角色</button>
        <button data-page="communityPage" type="button">社区</button>
        <button data-page="profilePage" type="button">我的</button>
      </nav>
    </div>
    <dialog id="roleDialog" class="modal">
      <form id="roleForm" method="dialog">
        <h2 id="roleDialogTitle">新建角色</h2>
        <label class="avatar-uploader">
          <img id="roleAvatarPreview" alt="角色头像" />
          <input id="roleAvatarInput" type="file" accept="image/*" />
          <span>上传头像</span>
        </label>
        <label>角色名称<input id="roleNameInput" type="text" maxlength="40" required /></label>
        <label>角色简介<textarea id="roleDescriptionInput" rows="3" required></textarea></label>
        <label>角色人设 Prompt<textarea id="rolePromptInput" rows="8" required></textarea></label>
        <label class="switch-line"><input id="rolePublicInput" type="checkbox" /> 公开并同步到社区</label>
        <div class="modal-actions">
          <button id="deleteRoleButton" class="danger" type="button">删除</button>
          <span></span>
          <button value="cancel" type="button" data-close-dialog>取消</button>
          <button id="saveRoleButton" value="default" type="submit">保存</button>
        </div>
      </form>
    </dialog>
    <dialog id="recoveryDialog" class="modal">
      <div id="recoveryContent"></div>
      <div class="modal-actions">
        <span></span>
        <button value="cancel" type="button" data-close-recovery>关闭</button>
      </div>
    </dialog>
    <div id="toast" class="toast" role="status"></div>
    <script>
const USER_ID_KEY = 'mochi_phone_user_id_v1';
const generateUserId = () => {
  const id = 'u_' + Math.random().toString(36).slice(2, 10) + Date.now().toString(36).slice(-6);
  localStorage.setItem(USER_ID_KEY, id);
  return id;
};
const getUserId = () => localStorage.getItem(USER_ID_KEY) || generateUserId();

const CONFIG = {
  apiBase: '/api',
  userId: getUserId(),
  defaultTheme: {
    primaryColor: '#7466ff',
    wallpaper: 'linear-gradient(180deg, #fbfaff 0%, #f0edff 100%)'
  },
  defaultRoles: [
    {
      id: 'role-gentle',
      name: '温柔陪伴师',
      description: '温柔耐心，适合日常陪伴、倾听和情绪支持。',
      prompt: '你是一位温柔、耐心、边界清晰的陪伴型 AI 角色。你会认真倾听用户，语气自然亲切，不做医疗、法律等专业承诺。',
      avatar: '',
      isPublic: false,
      createdAt: Date.now()
    },
    {
      id: 'role-detective',
      name: '赛博侦探',
      description: '冷静敏锐，擅长推理、悬疑剧情和角色扮演。',
      prompt: '你是一名生活在近未来都市的赛博侦探，语言克制、洞察力强，会用细节推动故事发展。',
      avatar: '',
      isPublic: false,
      createdAt: Date.now() - 1000
    }
  ]
};

const KEY = 'commercial_ai_role_chat_state_v1';
const defaultState = () => ({
  user: { nickname: '体验用户', avatar: '', bio: '喜欢沉浸式角色聊天的用户。' },
  roles: CONFIG.defaultRoles,
  activeRoleId: CONFIG.defaultRoles[0].id,
  conversations: {},
  costumes: { pageCss: '', bubbleCss: '', wallpaperImage: '', wallpaperCss: '' }
});

const loadState = () => {
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return defaultState();
    const parsed = JSON.parse(raw);
    return {
      ...defaultState(), ...parsed,
      user: { ...defaultState().user, ...(parsed.user || {}) },
      costumes: { ...defaultState().costumes, ...(parsed.costumes || {}) }
    };
  } catch { return defaultState(); }
};
const saveState = (state) => { localStorage.setItem(KEY, JSON.stringify(state)); };
const clearState = () => { localStorage.removeItem(KEY); };
const readFileAsDataUrl = (file) => new Promise((resolve, reject) => {
  const reader = new FileReader();
  reader.onload = () => resolve(reader.result);
  reader.onerror = reject;
  reader.readAsDataURL(file);
});

const STYLE_IDS = { page: 'user-page-css', bubble: 'user-bubble-css', wallpaper: 'user-wallpaper-css' };
const sanitizeCss = (css = '') => {
  const dangerous = [/<\s*script/gi, /<\/\s*script/gi, /javascript\s*:/gi, /expression\s*\(/gi, /on\w+\s*=/gi, /@import/gi];
  return dangerous.reduce((result, rule) => result.replace(rule, '/* blocked */'), String(css));
};
const upsertStyle = (id, css) => {
  let style = document.getElementById(id);
  if (!style) { style = document.createElement('style'); style.id = id; document.head.appendChild(style); }
  style.textContent = css;
};
const applyCostumes = (costumes) => {
  upsertStyle(STYLE_IDS.page, sanitizeCss(costumes.pageCss || ''));
  upsertStyle(STYLE_IDS.bubble, sanitizeCss(scopeBubbleCss(costumes.bubbleCss || '')));
  upsertStyle(STYLE_IDS.wallpaper, buildWallpaperCss(costumes));
};
const scopeBubbleCss = (css) => {
  if (!css.trim()) return '';
  if (!css.includes('{')) return '.chat-bubble{' + css + '}';
  return css.split('}').map((block) => {
    const [selector, body] = block.split('{');
    if (!selector || !body) return '';
    const scopedSelector = selector.split(',').map((item) => {
      const trimmed = item.trim();
      if (trimmed === '&') return '.chat-bubble';
      if (trimmed.includes('&')) return trimmed.replaceAll('&', '.chat-bubble');
      if (trimmed.startsWith(':')) return '.chat-bubble' + trimmed;
      return '.chat-bubble ' + trimmed;
    }).join(', ');
    return scopedSelector + '{' + body + '}';
  }).join('\n');
};
const buildWallpaperCss = (costumes) => {
  const imageCss = costumes.wallpaperImage
    ? '.chat-container{background-image: ' + (costumes.wallpaperCss || '') + ', url("' + costumes.wallpaperImage + '") !important;}'
    : '';
  return sanitizeCss(imageCss);
};
const examples = {
  page: ':root {\n  --color-primary: #ff7aa8;\n  --color-bg: #fff6fa;\n}\n.top-bar {\n  border-bottom: 1px solid rgba(255,122,168,.2);\n}',
  bubble: 'border-radius: 22px;\nletter-spacing: .2px;\nborder: 1px solid rgba(116,102,255,.18);',
  wallpaper: 'linear-gradient(rgba(255,255,255,.28), rgba(255,255,255,.28))'
};

const MOCK_KEY = 'mochi_phone_mock_server_v1';
const createMockState = () => ({
  beans: 30, transactions: [],
  communityRoles: [
    { id: 'mock-community-gentle', name: '温柔陪伴师', avatar: '', description: '擅长倾听、安慰和日常陪伴的暖心角色。', prompt: '你是一位温柔、耐心、边界清晰的陪伴型 AI 角色。', uploaderNickname: 'Mochi-phone', heat: 520, createdAt: new Date().toISOString() },
    { id: 'mock-community-detective', name: '赛博侦探', avatar: '', description: '冷静、敏锐，适合悬疑推理和剧情扮演。', prompt: '你是一名生活在近未来都市的赛博侦探，擅长分析线索。', uploaderNickname: 'Mochi-phone', heat: 430, createdAt: new Date().toISOString() }
  ]
});
const uuid = () => crypto.randomUUID?.() || 'id-' + Date.now() + '-' + Math.random().toString(16).slice(2);
const loadMockState = () => { try { return JSON.parse(localStorage.getItem(MOCK_KEY)) || createMockState(); } catch { return createMockState(); } };
const saveMockState = (state) => { localStorage.setItem(MOCK_KEY, JSON.stringify(state)); };
const mockDelay = (ms = 180) => new Promise((resolve) => setTimeout(resolve, ms));

const mockRequest = async (path, options = {}) => {
  await mockDelay();
  const state = loadMockState();
  if (path === '/user/me') return { id: CONFIG.userId, beans: state.beans, transactions: state.transactions.slice(-50).reverse() };
  if (path === '/user/billing-config') return {
    chatBeansCost: 2, beansPerCny: 10,
    rechargePackages: [
      { amount: 6, beans: 60 }, { amount: 18, beans: 200 },
      { amount: 30, beans: 360 }, { amount: 68, beans: 900 }
    ]
  };
  if (path === '/user/recharge/callback') {
    const payload = JSON.parse(options.body || '{}');
    state.beans += Number(payload.beans || 0);
    state.transactions.push({
      id: uuid(), type: 'recharge', beans: Number(payload.beans || 0),
      amount: Number(payload.amount || 0), roleName: '本地充值',
      summary: '本地模拟充值 ' + payload.amount + ' 元，到账 ' + payload.beans + ' 豆子',
      createdAt: new Date().toISOString()
    });
    saveMockState(state);
    return { beans: state.beans };
  }
  if (path.startsWith('/community/roles') && (!options.method || options.method === 'GET')) {
    const keyword = decodeURIComponent(path.split('keyword=')[1] || '').trim().toLowerCase();
    const list = state.communityRoles.filter((role) => {
      if (!keyword) return true;
      return (role.name + ' ' + role.description + ' ' + role.prompt).toLowerCase().includes(keyword);
    });
    return { list, total: list.length, page: 1, pageSize: 12 };
  }
  if (path === '/community/roles' && options.method === 'POST') {
    const payload = JSON.parse(options.body || '{}');
    const role = {
      id: uuid(), name: payload.name, avatar: payload.avatar || '',
      description: payload.description, prompt: payload.prompt,
      uploaderNickname: payload.uploaderNickname || '手机用户',
      heat: Math.floor(Math.random() * 600) + 100, createdAt: new Date().toISOString()
    };
    state.communityRoles.unshift(role);
    saveMockState(state);
    return role;
  }
  throw new Error('当前功能需要后端服务，已无法在单网页模式中完成。');
};

const request = async (path, options = {}) => {
  try {
    const response = await fetch(CONFIG.apiBase + path, {
      ...options,
      headers: { 'Content-Type': 'application/json', 'x-user-id': CONFIG.userId, ...(options.headers || {}) }
    });
    const data = await response.json().catch(() => ({}));
    if (!response.ok || data.code !== 0) throw new Error(data.message || '请求失败，请稍后重试。');
    return data.data;
  } catch (error) {
    return mockRequest(path, options);
  }
};

const mockStreamChat = async (payload, handlers, signal) => {
  const state = loadMockState();
  const cost = 2;
  if (state.beans < cost) throw new Error('豆子余额不足，请先到"我的"页面模拟充值。');
  state.beans -= cost;
  saveMockState(state);
  handlers.charged?.({ beans: state.beans, cost });
  const reply = '我是' + (payload.roleName || 'Mochi-phone 角色') + '。这是本地模拟回复，启动后端服务后就会返回真实 AI 回复。';
  for (const char of reply) {
    if (signal?.aborted) throw new DOMException('Aborted', 'AbortError');
    await new Promise((r) => setTimeout(r, 18));
    handlers.delta?.({ content: char });
  }
  handlers.done?.({ beans: state.beans });
};

const api = {
  getMe: () => request('/user/me'),
  getBillingConfig: () => request('/user/billing-config'),
  recharge: (payload) => request('/user/recharge/callback', { method: 'POST', body: JSON.stringify(payload) }),
  listCommunityRoles: (keyword = '') => request('/community/roles?keyword=' + encodeURIComponent(keyword)),
  publishRole: (payload) => request('/community/roles', { method: 'POST', body: JSON.stringify(payload) }),
  generateRecoveryCode: () => request('/user/recovery/generate', { method: 'POST' }),
  restoreByCode: (code) => request('/user/recovery/restore', { method: 'POST', body: JSON.stringify({ code }) }),
  async streamChat(payload, handlers, signal) {
    try {
      const response = await fetch(CONFIG.apiBase + '/chat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'x-user-id': CONFIG.userId },
        body: JSON.stringify(payload), signal
      });
      if (!response.ok || !response.body) {
        const data = await response.json().catch(() => ({}));
        throw new Error(data.message || 'AI 请求失败，请稍后重试。');
      }
      const reader = response.body.getReader();
      const decoder = new TextDecoder();
      let buffer = '';
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });
        const parts = buffer.split('\n\n');
        buffer = parts.pop() || '';
        for (const part of parts) {
          const event = part.match(/^event:\s*(.+)$/m)?.[1];
          const dataText = part.match(/^data:\s*(.+)$/m)?.[1];
          if (!event || !dataText) continue;
          const data = JSON.parse(dataText);
          handlers[event]?.(data);
        }
      }
    } catch (error) {
      if (error.name === 'AbortError') throw error;
      await mockStreamChat(payload, handlers, signal);
    }
  }
};

const $ = (sel) => document.querySelector(sel);
const $$ = (sel) => document.querySelectorAll(sel);
let state = loadState();
let billingConfig = null;
let isReplying = false;
let currentAbortController = null;

const toast = (msg) => {
  const el = $('#toast');
  el.textContent = msg;
  el.classList.add('show');
  clearTimeout(toast._t);
  toast._t = setTimeout(() => el.classList.remove('show'), 2200);
};
const persist = () => saveState(state);
const refreshServerUser = async () => {
  try {
    const me = await api.getMe();
    $('#beansBadge').textContent = '豆子 ' + me.beans;
    $('#beansBalance').textContent = me.beans;
  } catch {}
};

const renderRoleSwitcher = () => {
  const wrap = $('#roleSwitcher');
  wrap.innerHTML = state.roles.map((role) =>
    '<button class="role-chip ' + (state.activeRoleId === role.id ? 'active' : '') + '" data-switch-role="' + role.id + '" type="button">' +
    '<img class="avatar" src="' + (role.avatar || '') + '" alt="" onerror="this.style.visibility=\'hidden\'" />' +
    role.name + '</button>'
  ).join('');
};

const getActiveRole = () => state.roles.find((r) => r.id === state.activeRoleId);
const escapeHtml = (text) => String(text)
  .replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;')
  .replaceAll('"', '&quot;').replaceAll("'", '&#039;');

const renderMessages = () => {
  const list = $('#messageList');
  const messages = state.conversations[state.activeRoleId] || [];
  if (messages.length === 0) {
    const role = getActiveRole();
    list.innerHTML = '<div class="empty-state">开始和「' + (role?.name || '角色') + '」聊天吧。</div>';
    return;
  }
  list.innerHTML = messages.map((msg) =>
    '<div class="message-row ' + msg.role + '">' +
    '<img class="avatar" src="' + (msg.role === 'user' ? (state.user.avatar || '') : (getActiveRole()?.avatar || '')) + '" alt="" onerror="this.style.visibility=\'hidden\'" />' +
    '<div class="chat-bubble">' + escapeHtml(msg.content) + '</div></div>'
  ).join('');
  $('#chatContainer').scrollTop = $('#chatContainer').scrollHeight;
};

const appendTyping = () => {
  const list = $('#messageList');
  const row = document.createElement('div');
  row.className = 'message-row assistant';
  row.innerHTML = '<div class="avatar"></div><div class="chat-bubble"><span class="typing-dot"><i></i><i></i><i></i></span></div>';
  list.appendChild(row);
  $('#chatContainer').scrollTop = $('#chatContainer').scrollHeight;
};

const sendMessage = async (event) => {
  event?.preventDefault();
  if (isReplying) return;
  const input = $('#messageInput');
  const text = input.value.trim();
  if (!text) return;
  input.value = '';
  input.style.height = 'auto';
  const role = getActiveRole();
  if (!state.conversations[state.activeRoleId]) state.conversations[state.activeRoleId] = [];
  state.conversations[state.activeRoleId].push({ role: 'user', content: text });
  persist();
  renderMessages();
  isReplying = true;
  appendTyping();
  const localAbortController = new AbortController();
  currentAbortController = localAbortController;
  const assistantMessage = { role: 'assistant', content: '' };
  state.conversations[state.activeRoleId].push(assistantMessage);
  try {
    await api.streamChat(
      { roleName: role?.name, rolePrompt: role?.prompt, messages: state.conversations[state.activeRoleId].slice(-20) },
      {
        charged: (data) => { $('#beansBadge').textContent = '豆子 ' + data.beans; },
        delta: (data) => { assistantMessage.content += data.content; renderMessages(); },
        done: (data) => { $('#beansBadge').textContent = '豆子 ' + data.beans; },
        error: (data) => { throw new Error(data.message || '回复失败'); }
      },
      localAbortController.signal
    );
  } catch (error) {
    if (error.name === 'AbortError') {
      assistantMessage.content = assistantMessage.content || '回复已被打断。';
    } else {
      assistantMessage.content = '请求失败，请稍后再试。';
      toast(error.message);
    }
  } finally {
    if (currentAbortController === localAbortController) { isReplying = false; currentAbortController = null; }
    persist();
    renderMessages();
    refreshServerUser();
  }
};

const renderRoles = () => {
  const list = $('#myRolesList');
  const roles = [...state.roles].sort((a, b) => b.createdAt - a.createdAt);
  if (roles.length === 0) { list.innerHTML = '<div class="empty-state">还没有角色，点右上角新建一个吧。</div>'; return; }
  list.innerHTML = roles.map((role) =>
    '<div class="role-card">' +
    '<img class="avatar" src="' + (role.avatar || '') + '" alt="" onerror="this.style.visibility=\'hidden\'" />' +
    '<div><h3>' + escapeHtml(role.name) + '</h3>' +
    '<p>' + escapeHtml(role.description) + '</p>' +
    '<p class="muted">' + (role.isPublic ? '公开角色' : '私密角色') + ' · ' + new Date(role.createdAt).toLocaleDateString() + '</p>' +
    '<div class="card-actions">' +
    '<button data-chat-role="' + role.id + '" type="button">聊天</button>' +
    '<button data-edit-role="' + role.id + '" type="button">编辑</button>' +
    '<button data-clear-chat="' + role.id + '" type="button">清空对话</button>' +
    '</div></div></div>'
  ).join('');
};

const renderProfile = () => {
  $('#userNicknameInput').value = state.user.nickname || '';
  $('#userBioInput').value = state.user.bio || '';
  if (state.user.avatar) $('#userAvatarPreview').src = state.user.avatar;
};

const renderRechargePackages = () => {
  if (!billingConfig) return;
  const wrap = $('#rechargePackages');
  wrap.innerHTML = billingConfig.rechargePackages.map((pkg) =>
    '<button class="package-card" data-recharge="' + pkg.amount + '" type="button">' +
    '<strong>' + pkg.amount + ' 元</strong>' +
    '<div class="muted">' + pkg.beans + ' 豆子</div></button>'
  ).join('');
};

let communityCache = null;
const renderCommunity = async () => {
  const keyword = $('#communitySearch').value.trim();
  try {
    const result = await api.listCommunityRoles(keyword);
    communityCache = result.list;
    const list = $('#communityList');
    if (result.list.length === 0) { list.innerHTML = '<div class="empty-state">没有找到相关角色。</div>'; return; }
    list.innerHTML = result.list.map((role) =>
      '<div class="community-card">' +
      '<img class="avatar" src="' + (role.avatar || '') + '" alt="" onerror="this.style.visibility=\'hidden\'" />' +
      '<div><h3>' + escapeHtml(role.name) + '</h3>' +
      '<p>' + escapeHtml(role.description) + '</p>' +
      '<p class="muted">上传者：' + escapeHtml(role.uploaderNickname || '匿名') + ' · 热度 ' + role.heat + '</p>' +
      '<div class="card-actions">' +
      '<button data-import-role="' + encodeURIComponent(JSON.stringify(role)) + '" type="button">一键导入</button>' +
      '<button data-view-role="' + encodeURIComponent(JSON.stringify(role)) + '" type="button">详情</button>' +
      '</div></div></div>'
    ).join('');
  } catch (error) { toast(error.message); }
};

const renderCostumeEditor = (mode) => {
  const wrap = $('#costumeEditorWrap');
  const cssKey = mode === 'wallpaper' ? 'wallpaperCss' : mode + 'Css';
  const currentCss = state.costumes[cssKey] || '';
  const example = examples[mode] || '';
  if (mode === 'wallpaper') {
    wrap.innerHTML =
      '<div class="wallpaper-preview" id="wallpaperPreview"></div>' +
      '<label>上传壁纸图片<input id="wallpaperInput" type="file" accept="image/*" /></label>' +
      '<label>壁纸叠加 CSS（渐变、透明度等）' +
      '<textarea id="wallpaperCssInput" class="code-editor" rows="6">' + escapeHtml(state.costumes.wallpaperCss || '') + '</textarea></label>' +
      '<p class="muted">示例：' + escapeHtml(example) + '</p>' +
      '<div class="card-actions">' +
      '<button id="saveWallpaperButton" class="primary-small" type="button">保存壁纸</button>' +
      '<button id="resetWallpaperButton" type="button">恢复默认</button></div>';
    return;
  }
  wrap.innerHTML =
    '<label>自定义 CSS 代码<textarea id="cssEditor" class="code-editor" rows="12">' + escapeHtml(currentCss) + '</textarea></label>' +
    '<p class="muted">示例参考：<br>' + escapeHtml(example).replaceAll('\n', '<br>') + '</p>' +
    '<div class="card-actions">' +
    '<button id="saveCssButton" data-css-key="' + cssKey + '" class="primary-small" type="button">保存并生效</button>' +
    '<button id="resetCssButton" data-css-key="' + cssKey + '" type="button">恢复默认</button></div>';
};

const openRoleDialog = (roleId) => {
  const dialog = $('#roleDialog');
  const isEdit = !!roleId;
  const role = roleId ? state.roles.find((r) => r.id === roleId) : null;
  $('#roleDialogTitle').textContent = isEdit ? '编辑角色' : '新建角色';
  $('#roleNameInput').value = role?.name || '';
  $('#roleDescriptionInput').value = role?.description || '';
  $('#rolePromptInput').value = role?.prompt || '';
  $('#rolePublicInput').checked = role?.isPublic || false;
  $('#deleteRoleButton').style.display = isEdit ? '' : 'none';
  if (role?.avatar) {
    $('#roleAvatarPreview').src = role.avatar;
    $('#roleAvatarPreview').dataset.value = role.avatar;
  } else {
    $('#roleAvatarPreview').removeAttribute('src');
    delete $('#roleAvatarPreview').dataset.value;
  }
  dialog.dataset.editingId = roleId || '';
  dialog.showModal();
};

const saveRole = (event) => {
  event?.preventDefault();
  const dialog = $('#roleDialog');
  const editingId = dialog.dataset.editingId;
  const name = $('#roleNameInput').value.trim();
  const description = $('#roleDescriptionInput').value.trim();
  const prompt = $('#rolePromptInput').value.trim();
  const isPublic = $('#rolePublicInput').checked;
  const avatar = $('#roleAvatarPreview').dataset.value || '';
  if (!name || !description || !prompt) { toast('请填写完整的角色信息'); return; }
  if (editingId) {
    const role = state.roles.find((r) => r.id === editingId);
    if (role) {
      role.name = name; role.description = description; role.prompt = prompt;
      role.isPublic = isPublic; role.avatar = avatar;
      if (isPublic) {
        api.publishRole({ name, description, prompt, avatar, uploaderNickname: state.user.nickname })
          .then(() => toast('已同步到社区')).catch(() => {});
      }
    }
  } else {
    const newRole = {
      id: 'role_' + Date.now(), name, description, prompt, avatar,
      isPublic, createdAt: Date.now()
    };
    state.roles.unshift(newRole);
    state.activeRoleId = newRole.id;
    if (isPublic) {
      api.publishRole({ name, description, prompt, avatar, uploaderNickname: state.user.nickname })
        .then(() => toast('已同步到社区')).catch(() => {});
    }
  }
  persist();
  renderAll();
  $('#roleDialog').close();
  toast(editingId ? '角色已更新' : '角色已创建');
};

const deleteRole = () => {
  const dialog = $('#roleDialog');
  const editingId = dialog.dataset.editingId;
  if (!editingId) return;
  if (!confirm('确认删除这个角色吗？对话历史也会一起删除。')) return;
  state.roles = state.roles.filter((r) => r.id !== editingId);
  delete state.conversations[editingId];
  if (state.activeRoleId === editingId && state.roles.length > 0) state.activeRoleId = state.roles[0].id;
  persist();
  renderAll();
  dialog.close();
  toast('角色已删除');
};

const showRecoveryCode = async () => {
  try {
    const result = await api.generateRecoveryCode();
    const dialog = $('#recoveryDialog');
    $('#recoveryContent').innerHTML =
      '<h2>账号恢复码</h2>' +
      '<p class="muted">请妥善保存这串字符，换手机或清缓存后输入它就能找回豆子。</p>' +
      '<div style="padding:16px;background:#f7f5ff;border-radius:12px;font-family:monospace;font-size:18px;text-align:center;letter-spacing:2px;font-weight:700;color:var(--color-primary);">' + result.code + '</div>' +
      '<p class="muted" style="margin-top:12px;">💡 建议截图保存或记在备忘录里</p>';
    dialog.showModal();
  } catch (error) { toast(error.message); }
};

const showRestoreInput = () => {
  const dialog = $('#recoveryDialog');
  $('#recoveryContent').innerHTML =
    '<h2>导入恢复码</h2>' +
    '<p class="muted">输入你之前保存的恢复码，即可找回豆子余额。</p>' +
    '<label>恢复码<input id="restoreCodeInput" type="text" placeholder="输入12位恢复码" style="text-transform:uppercase;letter-spacing:2px;" /></label>' +
    '<p class="muted" style="color:var(--color-danger);">⚠️ 导入后会切换到恢复码对应的账号</p>' +
    '<div class="modal-actions" style="margin-top:16px;"><span></span>' +
    '<button id="confirmRestoreButton" class="primary-small" type="button">确认导入</button></div>';
  dialog.showModal();
  $('#confirmRestoreButton').addEventListener('click', async () => {
    const code = $('#restoreCodeInput').value.trim().toUpperCase();
    if (!code) { toast('请输入恢复码'); return; }
    try {
      const result = await api.restoreByCode(code);
      localStorage.setItem(USER_ID_KEY, result.userId);
      CONFIG.userId = result.userId;
      await refreshServerUser();
      $('#recoveryDialog').close();
      toast('恢复成功！豆子已同步');
    } catch (error) { toast(error.message); }
  });
};

const renderAll = () => {
  renderRoleSwitcher();
  renderMessages();
  renderRoles();
  renderProfile();
  renderRechargePackages();
};

const bindEvents = () => {
  $('.bottom-nav').addEventListener('click', (event) => {
    const btn = event.target.closest('[data-page]');
    if (!btn) return;
    $$('.page').forEach((page) => page.classList.toggle('active', page.id === btn.dataset.page));
    $$('.bottom-nav button').forEach((item) => item.classList.toggle('active', item === btn));
    $('#pageTitle').textContent = btn.textContent;
    if (btn.dataset.page === 'communityPage') renderCommunity();
  });

  document.addEventListener('click', async (event) => {
    const switchBtn = event.target.closest('[data-switch-role]');
    if (switchBtn) { state.activeRoleId = switchBtn.dataset.switchRole; persist(); renderRoleSwitcher(); renderMessages(); }
    const chatBtn = event.target.closest('[data-chat-role]');
    if (chatBtn) { state.activeRoleId = chatBtn.dataset.chatRole; persist(); $('.bottom-nav [data-page="chatPage"]').click(); }
    const editBtn = event.target.closest('[data-edit-role]');
    if (editBtn) openRoleDialog(editBtn.dataset.editRole);
    const clearBtn = event.target.closest('[data-clear-chat]');
    if (clearBtn && confirm('确认清空当前角色对话？')) { state.conversations[clearBtn.dataset.clearChat] = []; persist(); renderMessages(); toast('对话已清空。'); }
    const importBtn = event.target.closest('[data-import-role]');
    if (importBtn) {
      const role = JSON.parse(decodeURIComponent(importBtn.dataset.importRole));
      const localRole = { ...role, id: crypto.randomUUID(), isPublic: false, createdAt: Date.now() };
      state.roles.unshift(localRole);
      state.activeRoleId = localRole.id;
      persist(); renderAll(); toast('已导入到我的角色，可自由编辑。');
    }
    const viewBtn = event.target.closest('[data-view-role]');
    if (viewBtn) {
      const role = JSON.parse(decodeURIComponent(viewBtn.dataset.viewRole));
      alert(role.name + '\n\n' + role.description + '\n\n人设：\n' + role.prompt + '\n\n上传时间：' + new Date(role.createdAt).toLocaleString());
    }
    const rechargeBtn = event.target.closest('[data-recharge]');
    if (rechargeBtn) {
      if (!confirm('充值前建议先备份恢复码哦，清缓存会丢失豆子。要继续充值吗？')) return;
      const amount = Number(rechargeBtn.dataset.recharge);
      const item = billingConfig.rechargePackages.find((pkg) => pkg.amount === amount);
      await api.recharge(item);
      toast('模拟充值成功。');
      refreshServerUser();
    }
    const costumeEntry = event.target.closest('[data-costume-tab]');
    if (costumeEntry) {
      $('.bottom-nav [data-page="profilePage"]').classList.remove('active');
      $$('.page').forEach((page) => page.classList.toggle('active', page.id === 'costumePage'));
      $('#pageTitle').textContent = '自定义装扮';
      renderCostumeEditor(costumeEntry.dataset.costumeTab);
    }
  });

  $('#newRoleButton').addEventListener('click', () => openRoleDialog());
  $('#roleForm').addEventListener('submit', saveRole);
  $('#deleteRoleButton').addEventListener('click', deleteRole);
  $$('[data-close-dialog]').forEach((btn) => btn.addEventListener('click', () => $('#roleDialog').close()));
  $$('[data-close-recovery]').forEach((btn) => btn.addEventListener('click', () => $('#recoveryDialog').close()));
  $('#chatForm').addEventListener('submit', sendMessage);
  $('#communitySearchButton').addEventListener('click', renderCommunity);

  $('#saveProfileButton').addEventListener('click', () => {
    state.user.nickname = $('#userNicknameInput').value.trim() || '体验用户';
    state.user.bio = $('#userBioInput').value.trim();
    persist(); renderAll(); toast('个人资料已保存。');
  });

  $('#clearCacheButton').addEventListener('click', () => {
    if (!confirm('确认清空本地角色、对话和装扮配置？此操作不可恢复。')) return;
    clearState(); state = loadState(); persist(); renderAll(); toast('本地缓存已清空。');
  });

  $('#backupCodeButton').addEventListener('click', showRecoveryCode);
  $('#restoreCodeButton').addEventListener('click', showRestoreInput);

  $('#roleAvatarInput').addEventListener('change', async (event) => {
    const file = event.target.files[0];
    if (!file) return;
    const dataUrl = await readFileAsDataUrl(file);
    $('#roleAvatarPreview').src = dataUrl;
    $('#roleAvatarPreview').dataset.value = dataUrl;
  });

  $('#userAvatarInput').addEventListener('change', async (event) => {
    const file = event.target.files[0];
    if (!file) return;
    state.user.avatar = await readFileAsDataUrl(file);
    persist(); renderProfile();
  });

  $('#messageInput').addEventListener('input', (event) => {
    event.target.style.height = 'auto';
    event.target.style.height = Math.min(event.target.scrollHeight, 96) + 'px';
  });

  $('#costumePage').addEventListener('click', async (event) => {
    const modeBtn = event.target.closest('[data-costume-mode]');
    if (modeBtn) renderCostumeEditor(modeBtn.dataset.costumeMode);
    const saveCss = event.target.closest('#saveCssButton');
    if (saveCss) {
      state.costumes[saveCss.dataset.cssKey] = sanitizeCss($('#cssEditor').value);
      persist(); applyCostumes(state.costumes); toast('CSS 已保存并实时生效。');
    }
    const resetCss = event.target.closest('#resetCssButton');
    if (resetCss) {
      state.costumes[resetCss.dataset.cssKey] = '';
      persist(); applyCostumes(state.costumes);
      renderCostumeEditor(resetCss.dataset.cssKey === 'bubbleCss' ? 'bubble' : 'page');
      toast('已恢复默认样式。');
    }
    const saveWallpaper = event.target.closest('#saveWallpaperButton');
    if (saveWallpaper) {
      const file = $('#wallpaperInput')?.files?.[0];
      if (file) state.costumes.wallpaperImage = await readFileAsDataUrl(file);
      state.costumes.wallpaperCss = sanitizeCss($('#wallpaperCssInput').value);
      persist(); applyCostumes(state.costumes); renderCostumeEditor('wallpaper');
      toast('壁纸已保存。');
    }
    const resetWallpaper = event.target.closest('#resetWallpaperButton');
    if (resetWallpaper) {
      state.costumes.wallpaperImage = ''; state.costumes.wallpaperCss = '';
      persist(); applyCostumes(state.costumes); renderCostumeEditor('wallpaper');
      toast('已恢复默认壁纸。');
    }
  });
};

const init = async () => {
  applyCostumes(state.costumes);
  bindEvents();
  renderAll();
  try {
    billingConfig = await api.getBillingConfig();
    renderRechargePackages();
    await refreshServerUser();
  } catch (error) { toast(error.message); }
};
init();
</script>
  </body>
</html>`;

// ===== 配置 =====
const config = {
  upstreamBase: process.env.UPSTREAM_API_BASE || 'https://us.noviapi.com/v1',
  upstreamKey: process.env.UPSTREAM_API_KEY || '',
  upstreamModel: process.env.UPSTREAM_MODEL || 'gpt-4o-mini',
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

const stats = { totalRechargeCny: 0, totalBeansConsumed: 0, totalChatCount: 0, totalRefundBeans: 0 };
const ok = (res, data = {}, message = 'success') => res.json({ code: 0, message, data });
const fail = (res, status, code, message, details = null) => res.status(status).json({ code, message, details });

// ===== 数据库操作 =====
const getUser = async (userId = 'demo-user') => {
  const result = await pool.query('SELECT id, beans, created_at FROM users WHERE id = $1', [userId]);
  if (result.rows.length === 0) {
    await pool.query('INSERT INTO users (id, beans) VALUES ($1, $2)', [userId, config.demoInitialBeans]);
    return { id: userId, beans: config.demoInitialBeans, created_at: new Date().toISOString() };
  }
  return result.rows[0];
};

const publishCommunityRole = async (role) => {
  const id = role.id || randomUUID();
  const item = {
    id,
    name: String(role.name || '').slice(0, 40),
    avatar: role.avatar || '',
    description: String(role.description || '').slice(0, 160),
    prompt: String(role.prompt || '').slice(0, 6000),
    uploaderNickname: String(role.uploaderNickname || '匿名用户').slice(0, 24),
    heat: Math.floor(Math.random() * 800) + 20,
    createdAt: new Date().toISOString()
  };
  await pool.query(
    `INSERT INTO community_roles (id, name, avatar, description, prompt, uploader_nickname, heat, created_at)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
    [item.id, item.name, item.avatar, item.description, item.prompt, item.uploaderNickname, item.heat, item.createdAt]
  );
  return item;
};

// ===== SSE 工具 =====
const writeSse = (res, event, data) => {
  res.write('event: ' + event + '\n');
  res.write('data: ' + JSON.stringify(data) + '\n\n');
};
const streamText = async (res, text) => {
  for (const char of text) {
    writeSse(res, 'delta', { content: char });
    await new Promise((resolve) => setTimeout(resolve, 18));
  }
};

// ===== 中间件 =====
app.use(helmet({ contentSecurityPolicy: false }));
app.use(cors({ origin: true }));
app.use(express.json({ limit: '5mb' }));
app.use((req, _res, next) => {
  req.userId = String(req.headers['x-user-id'] || 'demo-user').slice(0, 64);
  next();
});

// ===== 路由 =====
app.get('/', (_req, res) => {
  res.setHeader('Content-Type', 'text/html; charset=utf-8');
  res.send(FRONTEND_HTML);
});

app.get('/api/health', (_req, res) => ok(res, { status: 'running', name: 'Mochi-phone' }));

app.get('/api/user/me', async (req, res) => {
  const user = await getUser(req.userId);
  const txResult = await pool.query(
    'SELECT id, type, beans, amount, role_name, summary, created_at FROM transactions WHERE user_id = $1 ORDER BY created_at DESC LIMIT 50',
    [user.id]
  );
  ok(res, {
    id: user.id,
    beans: user.beans,
    transactions: txResult.rows.map(row => ({
      id: row.id, type: row.type, beans: row.beans,
      amount: row.amount, roleName: row.role_name,
      summary: row.summary, createdAt: row.created_at
    }))
  });
});

app.get('/api/user/billing-config', (_req, res) => {
  ok(res, {
    chatBeansCost: config.chatBeansCost,
    beansPerCny: config.beansPerCny,
    rechargePackages: config.rechargePackages
  });
});

app.post('/api/user/recharge/callback', async (req, res) => {
  const amount = Number(req.body?.amount);
  const packageItem = config.rechargePackages.find((item) => item.amount === amount);
  if (!packageItem) return fail(res, 400, 4001, '充值套餐参数不正确。');
  const user = await getUser(req.userId);
  const newBeans = user.beans + packageItem.beans;
  await pool.query('UPDATE users SET beans = $1 WHERE id = $2', [newBeans, user.id]);
  const txId = randomUUID();
  await pool.query(
    `INSERT INTO transactions (id, user_id, type, beans, amount, role_name, summary, created_at)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
    [txId, user.id, 'recharge', packageItem.beans, packageItem.amount, '充值中心',
     '充值 ' + packageItem.amount + ' 元，到账 ' + packageItem.beans + ' 豆子', new Date().toISOString()]
  );
  stats.totalRechargeCny += packageItem.amount;
  ok(res, { beans: newBeans }, '充值成功');
});

app.get('/api/user/stats', (_req, res) => ok(res, stats));

// 恢复码：生成
app.post('/api/user/recovery/generate', async (req, res) => {
  const user = await getUser(req.userId);
  const code = Math.random().toString(36).slice(2, 10).toUpperCase() + Math.random().toString(36).slice(2, 4).toUpperCase();
  await pool.query('UPDATE users SET recovery_code = $1 WHERE id = $2', [code, user.id]);
  ok(res, { code });
});

// 恢复码：恢复
app.post('/api/user/recovery/restore', async (req, res) => {
  const { code } = req.body || {};
  if (!code) return fail(res, 400, 4004, '恢复码不能为空。');
  const result = await pool.query('SELECT id, beans FROM users WHERE recovery_code = $1', [code.trim().toUpperCase()]);
  if (result.rows.length === 0) return fail(res, 404, 4041, '恢复码无效，请检查后重试。');
  const user = result.rows[0];
  ok(res, { userId: user.id, beans: user.beans });
});

// 社区角色列表
app.get('/api/community/roles', async (req, res) => {
  const keyword = String(req.query.keyword || '').trim().toLowerCase();
  let query = `SELECT id, name, avatar, description, prompt, uploader_nickname, heat, created_at FROM community_roles`;
  let params = [];
  if (keyword) {
    query += ` WHERE LOWER(name) LIKE $1 OR LOWER(description) LIKE $1 OR LOWER(prompt) LIKE $1`;
    params.push('%' + keyword + '%');
  }
  query += ` ORDER BY created_at DESC LIMIT 50`;
  const result = await pool.query(query, params);
  const list = result.rows.map(row => ({
    id: row.id, name: row.name, avatar: row.avatar, description: row.description,
    prompt: row.prompt, uploaderNickname: row.uploader_nickname, heat: row.heat, createdAt: row.created_at
  }));
  ok(res, { list, total: list.length, page: 1, pageSize: 12 });
});

app.post('/api/community/roles', async (req, res) => {
  const { name, description, prompt, avatar, uploaderNickname } = req.body || {};
  if (!name || !description || !prompt) return fail(res, 400, 4002, '发布角色需要填写名称、简介和人设。');
  const role = await publishCommunityRole({ name, description, prompt, avatar, uploaderNickname });
  ok(res, role, '角色已发布到社区');
});

// 聊天接口
app.post('/api/chat', async (req, res) => {
  const { roleName, rolePrompt, messages } = req.body || {};
  const normalizedMessages = Array.isArray(messages) ? messages.slice(-20) : [];
  const lastUserMessage = [...normalizedMessages].reverse().find((item) => item.role === 'user')?.content || '';
  if (!lastUserMessage.trim()) return fail(res, 400, 4003, '消息内容不能为空。');

  const user = await getUser(req.userId);
  if (user.beans < config.chatBeansCost) {
    return fail(res, 402, 4021, '豆子余额不足，请先充值后再继续聊天。', { beans: user.beans });
  }

  // 扣费
  const beansAfterCharge = user.beans - config.chatBeansCost;
  await pool.query('UPDATE users SET beans = $1 WHERE id = $2', [beansAfterCharge, user.id]);
  stats.totalBeansConsumed += config.chatBeansCost;
  const txId = randomUUID();
  await pool.query(
    `INSERT INTO transactions (id, user_id, type, beans, role_name, summary, created_at)
     VALUES ($1, $2, $3, $4, $5, $6, $7)`,
    [txId, user.id, 'consume', -config.chatBeansCost, roleName, String(lastUserMessage).slice(0, 60), new Date().toISOString()]
  );

  res.setHeader('Content-Type', 'text/event-stream; charset=utf-8');
  res.setHeader('Cache-Control', 'no-cache, no-transform');
  res.setHeader('Connection', 'keep-alive');
  writeSse(res, 'charged', { beans: beansAfterCharge, cost: config.chatBeansCost });

  try {
    if (!config.upstreamKey || config.upstreamKey.includes('请填写')) {
      const reply = '我是' + (roleName || 'Mochi-phone 角色') + '。我已经收到你的消息："' + lastUserMessage + '"。\n\n当前网站后端已运行，但还没有配置真实 AI 密钥，所以先返回演示流式回复。你在 Render 的环境变量里填写 UPSTREAM_API_KEY 后，就会走真实 AI 接口。';
      await streamText(res, reply);
      stats.totalChatCount += 1;
      writeSse(res, 'done', { beans: beansAfterCharge });
      return res.end();
    }

    const upstreamResponse = await fetch(config.upstreamBase + '/chat/completions', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + config.upstreamKey },
      body: JSON.stringify({
        model: config.upstreamModel, stream: true,
        messages: [
          { role: 'system', content: rolePrompt || '你正在扮演' + (roleName || 'AI角色') + '，请保持角色一致。' },
          ...normalizedMessages.map((item) => ({
            role: item.role === 'assistant' ? 'assistant' : 'user',
            content: String(item.content || '')
          }))
        ]
      })
    });

    if (!upstreamResponse.ok || !upstreamResponse.body) throw new Error('上游服务异常：' + upstreamResponse.status);

    const reader = upstreamResponse.body.getReader();
    const decoder = new TextDecoder();
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      const chunk = decoder.decode(value, { stream: true });
      const lines = chunk.split('\n').filter((line) => line.startsWith('data:'));
      for (const line of lines) {
        const payload = line.replace(/^data:\s*/, '').trim();
        if (!payload || payload === '[DONE]') continue;
        try {
          const json = JSON.parse(payload);
          const content = json.choices?.[0]?.delta?.content || '';
          if (content) writeSse(res, 'delta', { content });
        } catch {}
      }
    }

    stats.totalChatCount += 1;
    writeSse(res, 'done', { beans: beansAfterCharge });
    res.end();
  } catch (error) {
    // 失败返还豆子
    const refundBeans = beansAfterCharge + config.chatBeansCost;
    await pool.query('UPDATE users SET beans = $1 WHERE id = $2', [refundBeans, user.id]);
    stats.totalRefundBeans += config.chatBeansCost;
    writeSse(res, 'error', { message: 'AI 回复失败，已自动返还本次扣除的豆子。', detail: error.message });
    res.end();
  }
});

// ===== 初始化数据库 + 启动服务 =====
const initDbAndStart = async () => {
  try {
    await pool.query(`
      CREATE TABLE IF NOT EXISTS users (
        id VARCHAR(64) PRIMARY KEY,
        recovery_code VARCHAR(32) UNIQUE,
        beans INTEGER DEFAULT 30,
        created_at TIMESTAMP DEFAULT NOW()
      )`);
    await pool.query(`
      CREATE TABLE IF NOT EXISTS transactions (
        id VARCHAR(64) PRIMARY KEY,
        user_id VARCHAR(64),
        type VARCHAR(20),
        beans INTEGER,
        amount INTEGER DEFAULT 0,
        role_name VARCHAR(40),
        summary VARCHAR(200),
        created_at TIMESTAMP DEFAULT NOW()
      )`);
    await pool.query(`
      CREATE TABLE IF NOT EXISTS community_roles (
        id VARCHAR(64) PRIMARY KEY,
        name VARCHAR(40),
        avatar TEXT,
        description VARCHAR(160),
        prompt TEXT,
        uploader_nickname VARCHAR(24),
        heat INTEGER,
        created_at TIMESTAMP DEFAULT NOW()
      )`);

    // 初始化默认社区角色
    const countResult = await pool.query('SELECT COUNT(*) FROM community_roles');
    if (parseInt(countResult.rows[0].count) === 0) {
      await publishCommunityRole({
        name: '温柔陪伴师',
        description: '擅长倾听、安慰和日常陪伴的暖心角色。',
        prompt: '你是一位温柔、耐心、边界清晰的陪伴型 AI 角色。',
        uploaderNickname: 'Mochi-phone'
      });
      await publishCommunityRole({
        name: '赛博侦探',
        description: '冷静、敏锐，适合悬疑推理和剧情扮演。',
        prompt: '你是一名生活在近未来都市的赛博侦探，擅长分析线索。',
        uploaderNickname: 'Mochi-phone'
      });
    }
    console.log('✅ 数据库初始化完成');
  } catch (err) {
    console.error('❌ 数据库初始化失败:', err.message);
    console.log('⚠️  请检查 DATABASE_URL 环境变量是否正确配置');
  }

  app.listen(PORT, HOST, () => {
    console.log('🚀 Mochi-phone 服务已启动: http://' + HOST + ':' + PORT);
  });
};

initDbAndStart();
