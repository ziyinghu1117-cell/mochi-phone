import express from 'express';
import cors from 'cors';
import helmet from 'helmet';
import dotenv from 'dotenv';
import { randomUUID } from 'crypto';

dotenv.config();

const app = express();
const PORT = Number(process.env.PORT || 3000);
const HOST = process.env.HOST || '0.0.0.0';
const FRONTEND_HTML = "<!doctype html>\n<html lang=\"zh-CN\">\n  <head>\n    <meta charset=\"UTF-8\" />\n    <meta name=\"viewport\" content=\"width=device-width, initial-scale=1.0, viewport-fit=cover\" />\n    <title>Mochi-phone</title>\n    <meta name=\"theme-color\" content=\"#7466ff\" />\n    <meta name=\"apple-mobile-web-app-capable\" content=\"yes\" />\n    <meta name=\"apple-mobile-web-app-title\" content=\"Mochi-phone\" />\n    <meta name=\"apple-mobile-web-app-status-bar-style\" content=\"default\" />\n    <link rel=\"manifest\" href=\"manifest.webmanifest\" />\n    <link rel=\"icon\" href=\"icons/mochi-phone-icon.svg\" />\n    <link rel=\"apple-touch-icon\" href=\"icons/mochi-phone-icon.svg\" />\n    <style>\n:root {\n  --color-primary: #7466ff;\n  --color-primary-dark: #5a4ee0;\n  --color-accent: #ff8fb3;\n  --color-bg: #f7f5ff;\n  --color-surface: rgba(255, 255, 255, 0.92);\n  --color-text: #232136;\n  --color-muted: #7b7890;\n  --color-border: rgba(116, 102, 255, 0.15);\n  --color-danger: #e95656;\n  --chat-wallpaper: linear-gradient(180deg, #fbfaff 0%, #f0edff 100%);\n  --bubble-user-bg: linear-gradient(135deg, #7466ff, #9a8cff);\n  --bubble-user-text: #ffffff;\n  --bubble-ai-bg: rgba(255, 255, 255, 0.96);\n  --bubble-ai-text: #25223a;\n  --bubble-radius: 18px;\n  --safe-bottom: env(safe-area-inset-bottom, 0px);\n}\n\n\n* {\n  box-sizing: border-box;\n}\n\nbody {\n  margin: 0;\n  min-height: 100vh;\n  background: #dedaf8;\n  color: var(--color-text);\n  font-family: -apple-system, BlinkMacSystemFont, \"Segoe UI\", sans-serif;\n}\n\nbutton,\ninput,\ntextarea,\nselect {\n  font: inherit;\n}\n\nbutton {\n  border: 0;\n  cursor: pointer;\n  transition: transform 0.16s ease, opacity 0.16s ease;\n}\n\nbutton:active {\n  transform: scale(0.97);\n}\n\n.app-shell {\n  position: relative;\n  width: min(100vw, 430px);\n  min-height: 100vh;\n  margin: 0 auto;\n  overflow: hidden;\n  background: var(--color-bg);\n  box-shadow: 0 0 40px rgba(35, 33, 54, 0.14);\n}\n\n.top-bar {\n  position: sticky;\n  top: 0;\n  z-index: 20;\n  display: flex;\n  align-items: center;\n  justify-content: space-between;\n  padding: 14px 16px 10px;\n  background: rgba(247, 245, 255, 0.9);\n  backdrop-filter: blur(18px);\n}\n\n.eyebrow {\n  margin: 0 0 2px;\n  color: var(--color-muted);\n  font-size: 12px;\n}\n\nh1,\nh2,\nh3,\np {\n  margin-top: 0;\n}\n\nh1 {\n  margin-bottom: 0;\n  font-size: 22px;\n}\n\n.beans-badge,\n.primary-small,\n.chat-input-bar button,\n.search-row button,\n.profile-card button,\n.package-card,\n.modal-actions button {\n  border-radius: 999px;\n  background: var(--color-primary);\n  color: #fff;\n  font-weight: 700;\n}\n\n.beans-badge {\n  padding: 9px 13px;\n  box-shadow: 0 8px 18px rgba(116, 102, 255, 0.24);\n}\n\n.page-stack {\n  height: calc(100vh - 73px);\n}\n\n.page {\n  display: none;\n  height: calc(100vh - 73px);\n  padding: 0 14px 86px;\n  overflow-y: auto;\n}\n\n.page.active {\n  display: block;\n}\n\n#chatPage {\n  padding: 0;\n  overflow: hidden;\n}\n\n.role-switcher {\n  display: flex;\n  gap: 10px;\n  overflow-x: auto;\n  padding: 8px 14px 10px;\n  scrollbar-width: none;\n}\n\n.role-chip {\n  display: flex;\n  flex: 0 0 auto;\n  align-items: center;\n  gap: 7px;\n  padding: 7px 10px 7px 7px;\n  border: 1px solid var(--color-border);\n  border-radius: 999px;\n  background: var(--color-surface);\n  color: var(--color-text);\n}\n\n.role-chip.active {\n  background: var(--color-primary);\n  color: #fff;\n}\n\n.avatar {\n  width: 34px;\n  height: 34px;\n  border-radius: 50%;\n  object-fit: cover;\n  background: linear-gradient(135deg, #ffcadb, #c7c2ff);\n}\n\n.chat-container {\n  height: calc(100vh - 206px);\n  overflow-y: auto;\n  background: var(--chat-wallpaper);\n  background-size: cover;\n  background-position: center;\n}\n\n.message-list {\n  min-height: 100%;\n  padding: 18px 14px 24px;\n}\n\n.message-row {\n  display: flex;\n  align-items: flex-end;\n  gap: 8px;\n  margin-bottom: 14px;\n}\n\n.message-row.user {\n  flex-direction: row-reverse;\n}\n\n.chat-bubble {\n  max-width: 74%;\n  padding: 11px 13px;\n  border-radius: var(--bubble-radius);\n  line-height: 1.6;\n  white-space: pre-wrap;\n  word-break: break-word;\n  box-shadow: 0 6px 18px rgba(35, 33, 54, 0.08);\n}\n\n.message-row.user .chat-bubble {\n  border-bottom-right-radius: 5px;\n  background: var(--bubble-user-bg);\n  color: var(--bubble-user-text);\n}\n\n.message-row.assistant .chat-bubble {\n  border-bottom-left-radius: 5px;\n  background: var(--bubble-ai-bg);\n  color: var(--bubble-ai-text);\n}\n\n.typing-dot {\n  display: inline-flex;\n  gap: 4px;\n}\n\n.typing-dot i {\n  width: 6px;\n  height: 6px;\n  border-radius: 50%;\n  background: var(--color-primary);\n  animation: bounce 0.9s infinite alternate;\n}\n\n.typing-dot i:nth-child(2) {\n  animation-delay: 0.14s;\n}\n\n.typing-dot i:nth-child(3) {\n  animation-delay: 0.28s;\n}\n\n@keyframes bounce {\n  to {\n    transform: translateY(-4px);\n    opacity: 0.4;\n  }\n}\n\n.chat-input-bar {\n  position: fixed;\n  right: calc((100vw - min(100vw, 430px)) / 2);\n  bottom: calc(58px + var(--safe-bottom));\n  left: calc((100vw - min(100vw, 430px)) / 2);\n  display: flex;\n  gap: 9px;\n  width: min(100vw, 430px);\n  padding: 10px 12px;\n  background: rgba(255, 255, 255, 0.94);\n  border-top: 1px solid var(--color-border);\n}\n\n.chat-input-bar textarea,\ninput,\ntextarea,\nselect {\n  width: 100%;\n  border: 1px solid var(--color-border);\n  border-radius: 16px;\n  padding: 11px 12px;\n  outline: none;\n  background: #fff;\n  color: var(--color-text);\n  resize: none;\n}\n\n.chat-input-bar textarea {\n  max-height: 96px;\n}\n\n.chat-input-bar button {\n  min-width: 64px;\n  padding: 0 14px;\n}\n\n.bottom-nav {\n  position: fixed;\n  right: calc((100vw - min(100vw, 430px)) / 2);\n  bottom: 0;\n  left: calc((100vw - min(100vw, 430px)) / 2);\n  z-index: 30;\n  display: grid;\n  grid-template-columns: repeat(5, 1fr);\n  width: min(100vw, 430px);\n  padding: 8px 8px calc(8px + var(--safe-bottom));\n  background: rgba(255, 255, 255, 0.94);\n  border-top: 1px solid var(--color-border);\n  backdrop-filter: blur(18px);\n}\n\n.bottom-nav button {\n  padding: 8px 0;\n  border-radius: 14px;\n  background: transparent;\n  color: var(--color-muted);\n}\n\n.bottom-nav button.active {\n  background: rgba(116, 102, 255, 0.12);\n  color: var(--color-primary);\n  font-weight: 800;\n}\n\n.section-header,\n.search-row,\n.tabs,\n.modal-actions {\n  display: flex;\n  align-items: center;\n  gap: 10px;\n}\n\n.section-header {\n  justify-content: space-between;\n  padding-top: 10px;\n}\n\n.primary-small {\n  padding: 9px 14px;\n}\n\n.card-list,\n.waterfall-list,\n.transaction-list,\n.memory-list {\n  display: grid;\n  gap: 12px;\n}\n\n.role-card,\n.community-card,\n.memory-card,\n.profile-card,\n.panel {\n  padding: 14px;\n  border: 1px solid var(--color-border);\n  border-radius: 22px;\n  background: var(--color-surface);\n  box-shadow: 0 10px 24px rgba(35, 33, 54, 0.06);\n}\n\n.role-card,\n.community-card {\n  display: grid;\n  grid-template-columns: 48px 1fr;\n  gap: 12px;\n}\n\n.role-card h3,\n.community-card h3,\n.memory-card h3 {\n  margin-bottom: 4px;\n}\n\n.memory-card {\n  display: grid;\n  gap: 8px;\n}\n\n.memory-meta {\n  color: var(--color-muted);\n  font-size: 12px;\n}\n\n.role-card p,\n.community-card p,\n.muted {\n  margin-bottom: 8px;\n  color: var(--color-muted);\n  font-size: 13px;\n  line-height: 1.5;\n}\n\n.card-actions {\n  display: flex;\n  flex-wrap: wrap;\n  gap: 8px;\n}\n\n.card-actions button,\n.settings-list button,\n.tabs button {\n  padding: 9px 12px;\n  border-radius: 999px;\n  background: rgba(116, 102, 255, 0.1);\n  color: var(--color-primary);\n  font-weight: 700;\n}\n\n.search-row {\n  padding: 12px 0;\n}\n\n.search-row button {\n  padding: 11px 14px;\n}\n\n.profile-card,\n.panel {\n  margin-top: 12px;\n}\n\n.profile-card label {\n  display: grid;\n  gap: 7px;\n  margin-bottom: 12px;\n  color: var(--color-muted);\n  font-size: 13px;\n  font-weight: 700;\n}\n\n.avatar-uploader {\n  justify-items: center;\n  text-align: center;\n}\n\n.avatar-uploader img {\n  width: 76px;\n  height: 76px;\n  border-radius: 50%;\n  object-fit: cover;\n  background: linear-gradient(135deg, #ffcadb, #c7c2ff);\n}\n\n.avatar-uploader input {\n  display: none;\n}\n\n.balance {\n  display: block;\n  margin: 8px 0 12px;\n  color: var(--color-primary);\n  font-size: 34px;\n}\n\n.package-grid {\n  display: grid;\n  grid-template-columns: repeat(2, 1fr);\n  gap: 10px;\n}\n\n.package-card {\n  padding: 12px;\n}\n\n.settings-list {\n  display: grid;\n  gap: 10px;\n}\n\n.tabs {\n  position: sticky;\n  top: 0;\n  z-index: 5;\n  padding: 12px 0;\n  background: var(--color-bg);\n}\n\n.tabs button.active {\n  background: var(--color-primary);\n  color: #fff;\n}\n\n.costume-editor {\n  display: grid;\n  gap: 12px;\n}\n\n.code-editor {\n  min-height: 260px;\n  font-family: ui-monospace, SFMono-Regular, Menlo, monospace;\n  font-size: 13px;\n}\n\n.wallpaper-preview {\n  min-height: 160px;\n  border-radius: 22px;\n  background: var(--chat-wallpaper);\n  background-position: center;\n  background-size: cover;\n}\n\n.modal {\n  width: min(92vw, 390px);\n  border: 0;\n  border-radius: 24px;\n  padding: 18px;\n  color: var(--color-text);\n}\n\n.modal::backdrop {\n  background: rgba(35, 33, 54, 0.42);\n}\n\n.modal label {\n  display: grid;\n  gap: 7px;\n  margin-bottom: 11px;\n  color: var(--color-muted);\n  font-size: 13px;\n  font-weight: 700;\n}\n\n.switch-line {\n  display: flex !important;\n  grid-template-columns: auto 1fr;\n  align-items: center;\n}\n\n.switch-line input {\n  width: auto;\n}\n\n.modal-actions {\n  justify-content: end;\n}\n\n.modal-actions span {\n  flex: 1;\n}\n\n.modal-actions button {\n  padding: 10px 14px;\n}\n\n.modal-actions button[value=\"cancel\"] {\n  background: #efedf8;\n  color: var(--color-text);\n}\n\n.danger {\n  background: var(--color-danger) !important;\n}\n\n.toast {\n  position: fixed;\n  left: 50%;\n  bottom: calc(82px + var(--safe-bottom));\n  z-index: 80;\n  max-width: min(86vw, 360px);\n  padding: 11px 14px;\n  border-radius: 999px;\n  background: rgba(35, 33, 54, 0.92);\n  color: #fff;\n  opacity: 0;\n  transform: translate(-50%, 12px);\n  pointer-events: none;\n  transition: 0.24s ease;\n}\n\n.toast.show {\n  opacity: 1;\n  transform: translate(-50%, 0);\n}\n\n.empty-state {\n  padding: 26px 16px;\n  color: var(--color-muted);\n  text-align: center;\n}\n\n@media (min-width: 431px) {\n  .app-shell {\n    min-height: 920px;\n  }\n}\n\n</style>\n  </head>\n  <body>\n    <div id=\"app\" class=\"app-shell\">\n      <header class=\"top-bar\">\n        <div>\n          <p class=\"eyebrow\">Mochi-phone</p>\n          <h1 id=\"pageTitle\">角色聊天</h1>\n        </div>\n        <button id=\"beansBadge\" class=\"beans-badge\" type=\"button\">豆子 0</button>\n      </header>\n\n      <main class=\"page-stack\">\n        <section id=\"chatPage\" class=\"page active\">\n          <div id=\"roleSwitcher\" class=\"role-switcher\"></div>\n          <div id=\"chatContainer\" class=\"chat-container\">\n            <div id=\"messageList\" class=\"message-list\"></div>\n          </div>\n          <form id=\"chatForm\" class=\"chat-input-bar\">\n            <textarea id=\"messageInput\" rows=\"1\" placeholder=\"输入想对角色说的话...\"></textarea>\n            <button id=\"sendButton\" type=\"submit\">发送</button>\n          </form>\n        </section>\n\n        <section id=\"rolesPage\" class=\"page\">\n          <div class=\"section-header\">\n            <h2>我的角色</h2>\n            <button id=\"newRoleButton\" class=\"primary-small\" type=\"button\">新建</button>\n          </div>\n          <div id=\"myRolesList\" class=\"card-list\"></div>\n        </section>\n\n        <section id=\"communityPage\" class=\"page\">\n          <div class=\"search-row\">\n            <input id=\"communitySearch\" type=\"search\" placeholder=\"搜索角色名称或关键词\" />\n            <button id=\"communitySearchButton\" type=\"button\">搜索</button>\n          </div>\n          <div id=\"communityList\" class=\"waterfall-list\"></div>\n        </section>\n\n        <section id=\"memoryPage\" class=\"page\">\n          <div class=\"section-header\">\n            <h2>记忆系统</h2>\n            <button id=\"refreshMemoryButton\" class=\"primary-small\" type=\"button\">刷新</button>\n          </div>\n          <div class=\"panel\">\n            <h3>新增记忆</h3>\n            <p class=\"muted\">手动记忆会长期保留；自动记忆来自对话，删除对应对话时会自动清理。</p>\n            <label>记忆范围<select id=\"memoryRoleSelect\"></select></label>\n            <label>记忆类型<select id=\"memoryTypeSelect\">\n              <option>用户资料</option>\n              <option>角色关系</option>\n              <option>事件</option>\n              <option>偏好</option>\n              <option>禁忌</option>\n              <option>剧情</option>\n            </select></label>\n            <label>记忆内容<textarea id=\"memoryContentInput\" rows=\"4\" placeholder=\"例如：用户喜欢被叫阿宁，不喜欢被叫宝宝。\"></textarea></label>\n            <button id=\"saveMemoryButton\" class=\"primary-small\" type=\"button\">保存记忆</button>\n          </div>\n          <div class=\"panel\">\n            <h3>已保存的记忆</h3>\n            <div id=\"memoryList\" class=\"memory-list\"></div>\n          </div>\n        </section>\n\n        <section id=\"profilePage\" class=\"page\">\n          <div class=\"profile-card\">\n            <label class=\"avatar-uploader\">\n              <img id=\"userAvatarPreview\" alt=\"用户头像\" />\n              <input id=\"userAvatarInput\" type=\"file\" accept=\"image/*\" />\n              <span>更换头像</span>\n            </label>\n            <label>昵称<input id=\"userNicknameInput\" type=\"text\" maxlength=\"24\" /></label>\n            <label>个人人设<textarea id=\"userBioInput\" rows=\"4\"></textarea></label>\n            <button id=\"saveProfileButton\" type=\"button\">保存资料</button>\n          </div>\n\n          <div class=\"panel\">\n            <h3>豆子资产</h3>\n            <strong id=\"beansBalance\" class=\"balance\">0</strong>\n            <div id=\"rechargePackages\" class=\"package-grid\"></div>\n          </div>\n\n          <div class=\"panel\">\n            <h3>消费明细</h3>\n            <div id=\"transactionList\" class=\"transaction-list\"></div>\n          </div>\n\n          <div class=\"panel settings-list\">\n            <button data-costume-tab=\"page\" type=\"button\">自定义页面 UI</button>\n            <button data-costume-tab=\"bubble\" type=\"button\">自定义聊天气泡</button>\n            <button data-costume-tab=\"wallpaper\" type=\"button\">自定义聊天壁纸</button>\n            <button id=\"exportDataButton\" type=\"button\">导出数据备份</button>\n            <button id=\"importDataButton\" type=\"button\">导入数据恢复</button>\n            <input id=\"importDataInput\" type=\"file\" accept=\"application/json,.json\" hidden />\n            <button id=\"clearCacheButton\" type=\"button\">清空本地缓存</button>\n          </div>\n        </section>\n\n        <section id=\"costumePage\" class=\"page\">\n          <div class=\"tabs\">\n            <button class=\"active\" data-costume-mode=\"page\" type=\"button\">页面 UI</button>\n            <button data-costume-mode=\"bubble\" type=\"button\">聊天气泡</button>\n            <button data-costume-mode=\"wallpaper\" type=\"button\">壁纸</button>\n          </div>\n          <div id=\"costumeEditorWrap\" class=\"costume-editor\"></div>\n        </section>\n      </main>\n\n      <nav class=\"bottom-nav\">\n        <button class=\"active\" data-page=\"chatPage\" type=\"button\">聊天</button>\n        <button data-page=\"rolesPage\" type=\"button\">角色</button>\n        <button data-page=\"communityPage\" type=\"button\">社区</button>\n        <button data-page=\"memoryPage\" type=\"button\">记忆</button>\n        <button data-page=\"profilePage\" type=\"button\">我的</button>\n      </nav>\n    </div>\n\n    <dialog id=\"roleDialog\" class=\"modal\">\n      <form id=\"roleForm\" method=\"dialog\">\n        <h2 id=\"roleDialogTitle\">新建角色</h2>\n        <label class=\"avatar-uploader\">\n          <img id=\"roleAvatarPreview\" alt=\"角色头像\" />\n          <input id=\"roleAvatarInput\" type=\"file\" accept=\"image/*\" />\n          <span>上传头像</span>\n        </label>\n        <label>角色名称<input id=\"roleNameInput\" type=\"text\" maxlength=\"40\" required /></label>\n        <label>角色简介<textarea id=\"roleDescriptionInput\" rows=\"3\" required></textarea></label>\n        <label>角色人设 Prompt<textarea id=\"rolePromptInput\" rows=\"8\" required></textarea></label>\n        <label class=\"switch-line\"><input id=\"rolePublicInput\" type=\"checkbox\" /> 公开并同步到社区</label>\n        <div class=\"modal-actions\">\n          <button id=\"deleteRoleButton\" class=\"danger\" type=\"button\">删除</button>\n          <span></span>\n          <button value=\"cancel\" type=\"button\" data-close-dialog>取消</button>\n          <button id=\"saveRoleButton\" value=\"default\" type=\"submit\">保存</button>\n        </div>\n      </form>\n    </dialog>\n\n    <div id=\"toast\" class=\"toast\" role=\"status\"></div>\n\n    <script>\n/* ===== config.js ===== */\nconst getOrCreateUserId = () => {\n  let userId = localStorage.getItem('mochi_phone_user_id');\n  if (!userId) {\n    userId = `user_${Date.now()}_${Math.random().toString(36).slice(2, 10)}`;\n    localStorage.setItem('mochi_phone_user_id', userId);\n  }\n  return userId;\n};\n\nconst CONFIG = {\n  apiBase: '/api',\n  userId: getOrCreateUserId(),\n  defaultTheme: {\n    primaryColor: '#7466ff',\n    wallpaper: 'linear-gradient(180deg, #fbfaff 0%, #f0edff 100%)'\n  },\n  defaultRoles: [\n    {\n      id: 'role-gentle',\n      name: '温柔陪伴师',\n      description: '温柔耐心，适合日常陪伴、倾听和情绪支持。',\n      prompt: '你是一位温柔、耐心、边界清晰的陪伴型 AI 角色。你会认真倾听用户，语气自然亲切，不做医疗、法律等专业承诺。',\n      avatar: '',\n      isPublic: false,\n      createdAt: Date.now()\n    },\n    {\n      id: 'role-detective',\n      name: '赛博侦探',\n      description: '冷静敏锐，擅长推理、悬疑剧情和角色扮演。',\n      prompt: '你是一名生活在近未来都市的赛博侦探，语言克制、洞察力强，会用细节推动故事发展。',\n      avatar: '',\n      isPublic: false,\n      createdAt: Date.now() - 1000\n    }\n  ]\n};\n/* ===== storage.js ===== */\n\nconst KEY = 'commercial_ai_role_chat_state_v1';\n\nconst defaultState = () => ({\n  user: {\n    nickname: '体验用户',\n    avatar: '',\n    bio: '喜欢沉浸式角色聊天的用户。'\n  },\n  roles: CONFIG.defaultRoles,\n  activeRoleId: CONFIG.defaultRoles[0].id,\n  conversations: {},\n  costumes: {\n    pageCss: '',\n    bubbleCss: '',\n    wallpaperImage: '',\n    wallpaperCss: ''\n  }\n});\n\nconst loadState = () => {\n  try {\n    const raw = localStorage.getItem(KEY);\n    if (!raw) return defaultState();\n    const parsed = JSON.parse(raw);\n    return {\n      ...defaultState(),\n      ...parsed,\n      user: { ...defaultState().user, ...(parsed.user || {}) },\n      costumes: { ...defaultState().costumes, ...(parsed.costumes || {}) }\n    };\n  } catch {\n    return defaultState();\n  }\n};\n\nconst saveState = (state) => {\n  localStorage.setItem(KEY, JSON.stringify(state));\n};\n\nconst clearState = () => {\n  localStorage.removeItem(KEY);\n};\n\nconst readFileAsDataUrl = (file) => new Promise((resolve, reject) => {\n  const reader = new FileReader();\n  reader.onload = () => resolve(reader.result);\n  reader.onerror = reject;\n  reader.readAsDataURL(file);\n});\n/* ===== costume.js ===== */\nconst STYLE_IDS = {\n  page: 'user-page-css',\n  bubble: 'user-bubble-css',\n  wallpaper: 'user-wallpaper-css'\n};\n\n// 基础安全过滤：仅允许纯 CSS，拦截脚本标签、JS URL、事件属性等危险内容。\nconst sanitizeCss = (css = '') => {\n  const dangerous = [\n    /<\\s*script/gi,\n    /<\\/\\s*script/gi,\n    /javascript\\s*:/gi,\n    /expression\\s*\\(/gi,\n    /on\\w+\\s*=/gi,\n    /@import/gi\n  ];\n  return dangerous.reduce((result, rule) => result.replace(rule, '/* blocked */'), String(css));\n};\n\nconst upsertStyle = (id, css) => {\n  let style = document.getElementById(id);\n  if (!style) {\n    style = document.createElement('style');\n    style.id = id;\n    document.head.appendChild(style);\n  }\n  style.textContent = css;\n};\n\nconst applyCostumes = (costumes) => {\n  upsertStyle(STYLE_IDS.page, sanitizeCss(costumes.pageCss || ''));\n  upsertStyle(STYLE_IDS.bubble, sanitizeCss(scopeBubbleCss(costumes.bubbleCss || '')));\n  upsertStyle(STYLE_IDS.wallpaper, buildWallpaperCss(costumes));\n};\n\nconst scopeBubbleCss = (css) => {\n  if (!css.trim()) return '';\n  if (!css.includes('{')) {\n    return `.message-row.user .chat-bubble,.message-row.assistant .chat-bubble{${css}}`;\n  }\n  return css\n    .split('}')\n    .map((block) => {\n      const [selector, body] = block.split('{');\n      if (!selector || !body) return '';\n      const scopedSelector = selector\n        .split(',')\n        .map((item) => {\n          const trimmed = item.trim();\n          if (trimmed === '&') return '.message-row.user .chat-bubble,.message-row.assistant .chat-bubble';\n          if (trimmed.includes('&')) {\n            return [\n              trimmed.replaceAll('&', '.message-row.user .chat-bubble'),\n              trimmed.replaceAll('&', '.message-row.assistant .chat-bubble')\n            ].join(',');\n          }\n          if (trimmed.startsWith(':')) return `.message-row.user .chat-bubble${trimmed},.message-row.assistant .chat-bubble${trimmed}`;\n          return `.message-row.user .chat-bubble ${trimmed},.message-row.assistant .chat-bubble ${trimmed}`;\n        })\n        .join(', ');\n      return `${scopedSelector}{${body}}`;\n    })\n    .join('\\n');\n};\n\nconst buildWallpaperCss = (costumes) => {\n  const imageCss = costumes.wallpaperImage\n    ? `.chat-container{background-image: ${costumes.wallpaperCss || ''}, url(\"${costumes.wallpaperImage}\") !important;}`\n    : '';\n  return sanitizeCss(imageCss);\n};\n\nconst examples = {\n  page: `:root {\\n  --color-primary: #ff7aa8;\\n  --color-bg: #fff6fa;\\n}\\n.top-bar {\\n  border-bottom: 1px solid rgba(255,122,168,.2);\\n}`,\n  bubble: `border-radius: 22px;\\nletter-spacing: .2px;\\nborder: 1px solid rgba(116,102,255,.18);`,\n  wallpaper: `linear-gradient(rgba(255,255,255,.28), rgba(255,255,255,.28))`\n};\n/* ===== api.js ===== */\n\nconst MOCK_KEY = 'mochi_phone_mock_server_v1';\n\nconst createMockState = () => ({\n  beans: 30,\n  transactions: [],\n  memories: [],\n  communityRoles: [\n    {\n      id: 'mock-community-gentle',\n      name: '温柔陪伴师',\n      avatar: '',\n      description: '擅长倾听、安慰和日常陪伴的暖心角色。',\n      prompt: '你是一位温柔、耐心、边界清晰的陪伴型 AI 角色。',\n      uploaderNickname: 'Mochi-phone',\n      heat: 520,\n      createdAt: new Date().toISOString()\n    },\n    {\n      id: 'mock-community-detective',\n      name: '赛博侦探',\n      avatar: '',\n      description: '冷静、敏锐，适合悬疑推理和剧情扮演。',\n      prompt: '你是一名生活在近未来都市的赛博侦探，擅长分析线索。',\n      uploaderNickname: 'Mochi-phone',\n      heat: 430,\n      createdAt: new Date().toISOString()\n    }\n  ]\n});\n\nconst uuid = () => crypto.randomUUID?.() || `id-${Date.now()}-${Math.random().toString(16).slice(2)}`;\n\nconst loadMockState = () => {\n  try {\n    return JSON.parse(localStorage.getItem(MOCK_KEY)) || createMockState();\n  } catch {\n    return createMockState();\n  }\n};\n\nconst saveMockState = (state) => {\n  localStorage.setItem(MOCK_KEY, JSON.stringify(state));\n};\n\nconst mockDelay = (ms = 180) => new Promise((resolve) => setTimeout(resolve, ms));\n\nconst mockRequest = async (path, options = {}) => {\n  await mockDelay();\n  const state = loadMockState();\n\n  if (path === '/user/me') {\n    return { id: CONFIG.userId, beans: state.beans, transactions: state.transactions.slice(-50).reverse() };\n  }\n\n  if (path === '/user/billing-config') {\n    return {\n      chatBeansCost: 2,\n      beansPerCny: 10,\n      rechargePackages: [\n        { amount: 6, beans: 60 },\n        { amount: 18, beans: 200 },\n        { amount: 30, beans: 360 },\n        { amount: 68, beans: 900 }\n      ]\n    };\n  }\n\n  if (path === '/user/recharge/callback') {\n    const payload = JSON.parse(options.body || '{}');\n    state.beans += Number(payload.beans || 0);\n    state.transactions.push({\n      id: uuid(),\n      type: 'recharge',\n      beans: Number(payload.beans || 0),\n      amount: Number(payload.amount || 0),\n      roleName: '本地充值',\n      summary: `本地模拟充值 ${payload.amount} 元，到账 ${payload.beans} 豆子`,\n      createdAt: new Date().toISOString()\n    });\n    saveMockState(state);\n    return { beans: state.beans };\n  }\n\n  if (path === '/user/export-data') {\n    return {\n      userId: CONFIG.userId,\n      beans: state.beans,\n      transactions: state.transactions,\n      memories: state.memories || []\n    };\n  }\n\n  if (path === '/user/import-data') {\n    const payload = JSON.parse(options.body || '{}');\n    if (Number.isFinite(Number(payload.beans))) {\n      state.beans = Number(payload.beans);\n    }\n    if (Array.isArray(payload.transactions)) {\n      state.transactions = payload.transactions.slice(-200);\n    }\n    if (Array.isArray(payload.memories)) {\n      state.memories = payload.memories.slice(-200);\n    }\n    saveMockState(state);\n    return {\n      userId: payload.userId || CONFIG.userId,\n      beans: state.beans,\n      transactions: state.transactions,\n      memories: state.memories || []\n    };\n  }\n\n  if (path.startsWith('/memories') && (!options.method || options.method === 'GET')) {\n    const roleId = decodeURIComponent(path.split('roleId=')[1] || '').trim();\n    const list = (state.memories || []).filter((item) => !roleId || !item.roleId || item.roleId === roleId);\n    return { list, total: list.length };\n  }\n\n  if (path === '/memories' && options.method === 'POST') {\n    const payload = JSON.parse(options.body || '{}');\n    const memory = {\n      id: uuid(),\n      roleId: payload.roleId || '',\n      roleName: payload.roleName || '全部角色',\n      type: payload.type || '事件',\n      content: String(payload.content || '').trim().slice(0, 220),\n      source: payload.source || 'manual',\n      sourceConversationId: payload.sourceConversationId || payload.roleId || '',\n      sourceMessageIds: payload.sourceMessageIds || [],\n      createdAt: new Date().toISOString(),\n      updatedAt: new Date().toISOString()\n    };\n    if (!memory.content) throw new Error('记忆内容不能为空。');\n    state.memories ||= [];\n    state.memories.unshift(memory);\n    saveMockState(state);\n    return memory;\n  }\n\n  if (path.startsWith('/memories/') && options.method === 'DELETE') {\n    const id = decodeURIComponent(path.split('/memories/')[1] || '');\n    state.memories = (state.memories || []).filter((item) => item.id !== id);\n    saveMockState(state);\n    return { deleted: 1 };\n  }\n\n  if (path === '/memories/cleanup-conversation' && options.method === 'POST') {\n    const payload = JSON.parse(options.body || '{}');\n    const ids = new Set((payload.sourceMessageIds || []).map(String));\n    const before = (state.memories || []).length;\n    state.memories = (state.memories || []).filter((item) => {\n      if (item.source !== 'auto') return true;\n      const conversationMatched = payload.sourceConversationId && item.sourceConversationId === payload.sourceConversationId;\n      const roleMatched = payload.roleId && item.roleId === payload.roleId && !payload.sourceConversationId && !ids.size;\n      const messageMatched = ids.size && (item.sourceMessageIds || []).some((id) => ids.has(String(id)));\n      return !(conversationMatched || roleMatched || messageMatched);\n    });\n    saveMockState(state);\n    return { deleted: before - state.memories.length };\n  }\n\n  if (path.startsWith('/community/roles') && (!options.method || options.method === 'GET')) {\n    const keyword = decodeURIComponent(path.split('keyword=')[1] || '').trim().toLowerCase();\n    const list = state.communityRoles.filter((role) => {\n      if (!keyword) return true;\n      return `${role.name} ${role.description} ${role.prompt}`.toLowerCase().includes(keyword);\n    });\n    return { list, total: list.length, page: 1, pageSize: 12 };\n  }\n\n  if (path === '/community/roles' && options.method === 'POST') {\n    const payload = JSON.parse(options.body || '{}');\n    const role = {\n      id: uuid(),\n      name: payload.name,\n      avatar: payload.avatar || '',\n      description: payload.description,\n      prompt: payload.prompt,\n      uploaderNickname: payload.uploaderNickname || '手机用户',\n      heat: Math.floor(Math.random() * 600) + 100,\n      createdAt: new Date().toISOString()\n    };\n    state.communityRoles.unshift(role);\n    saveMockState(state);\n    return role;\n  }\n\n  throw new Error('当前功能需要后端服务，已无法在单网页模式中完成。');\n};\n\nconst request = async (path, options = {}) => {\n  try {\n    const response = await fetch(`${CONFIG.apiBase}${path}`, {\n      ...options,\n      headers: {\n        'Content-Type': 'application/json',\n        'x-user-id': CONFIG.userId,\n        ...(options.headers || {})\n      }\n    });\n\n    const data = await response.json().catch(() => ({}));\n    if (!response.ok || data.code !== 0) {\n      throw new Error(data.message || '请求失败，请稍后重试。');\n    }\n    return data.data;\n  } catch (error) {\n    return mockRequest(path, options);\n  }\n};\n\nconst api = {\n  getMe: () => request('/user/me'),\n  getBillingConfig: () => request('/user/billing-config'),\n  recharge: (payload) => request('/user/recharge/callback', {\n    method: 'POST',\n    body: JSON.stringify(payload)\n  }),\n  exportUserData: () => request('/user/export-data'),\n  importUserData: (payload) => request('/user/import-data', {\n    method: 'POST',\n    body: JSON.stringify(payload)\n  }),\n  listCommunityRoles: (keyword = '') => request(`/community/roles?keyword=${encodeURIComponent(keyword)}`),\n  publishRole: (payload) => request('/community/roles', {\n    method: 'POST',\n    body: JSON.stringify(payload)\n  }),\n  listMemories: (roleId = '') => request(`/memories?roleId=${encodeURIComponent(roleId)}`),\n  createMemory: (payload) => request('/memories', {\n    method: 'POST',\n    body: JSON.stringify(payload)\n  }),\n  deleteMemory: (id) => request(`/memories/${encodeURIComponent(id)}`, { method: 'DELETE' }),\n  cleanupMemories: (payload) => request('/memories/cleanup-conversation', {\n    method: 'POST',\n    body: JSON.stringify(payload)\n  }),\n  async streamChat(payload, handlers, signal) {\n    try {\n      const response = await fetch(`${CONFIG.apiBase}/chat`, {\n        method: 'POST',\n        headers: {\n          'Content-Type': 'application/json',\n          'x-user-id': CONFIG.userId\n        },\n        body: JSON.stringify(payload),\n        signal\n      });\n\n      if (!response.ok || !response.body) {\n        const data = await response.json().catch(() => ({}));\n        throw new Error(data.message || 'AI 请求失败，请稍后重试。');\n      }\n\n      const reader = response.body.getReader();\n      const decoder = new TextDecoder();\n      let buffer = '';\n      let receivedDelta = false;\n      let receivedError = false;\n\n      const dispatchPart = (part) => {\n        const event = part.match(/^event:\\s*(.+)$/m)?.[1];\n        const dataText = part\n          .split('\\n')\n          .filter((line) => line.startsWith('data:'))\n          .map((line) => line.replace(/^data:\\s*/, ''))\n          .join('\\n');\n        if (!event || !dataText) return;\n        try {\n          const data = JSON.parse(dataText);\n          if (event === 'delta' && data.content) receivedDelta = true;\n          if (event === 'error') receivedError = true;\n          handlers[event]?.(data);\n        } catch {\n          // 单条 SSE 解析失败时跳过，不中断整次回复。\n        }\n      };\n\n      while (true) {\n        const { done, value } = await reader.read();\n        if (done) break;\n        buffer += decoder.decode(value, { stream: true });\n        const parts = buffer.split('\\n\\n');\n        buffer = parts.pop() || '';\n        parts.forEach(dispatchPart);\n      }\n\n      buffer += decoder.decode();\n      if (buffer.trim()) dispatchPart(buffer);\n      if (!receivedDelta && !receivedError) throw new Error('AI 没有返回可显示内容。');\n    } catch (error) {\n      if (error.name === 'AbortError') throw error;\n      await mockStreamChat(payload, handlers, signal);\n    }\n  }\n};\n\nconst mockStreamChat = async (payload, handlers, signal) => {\n  const state = loadMockState();\n  const cost = 2;\n  if (state.beans < cost) {\n    throw new Error('豆子余额不足，请先到“我的”页面模拟充值。');\n  }\n\n  state.beans -= cost;\n  const lastUserMessage = [...(payload.messages || [])].reverse().find((item) => item.role === 'user')?.content || '';\n  state.transactions.push({\n    id: uuid(),\n    type: 'consume',\n    beans: -cost,\n    roleName: payload.roleName || 'AI角色',\n    summary: lastUserMessage.slice(0, 60),\n    createdAt: new Date().toISOString()\n  });\n  saveMockState(state);\n  handlers.charged?.({ beans: state.beans, cost });\n\n  const reply = `我是${payload.roleName || 'Mochi-phone 角色'}。我已经收到你的消息：“${lastUserMessage}”。\\n\\n当前是单网页本地模式：不用电脑、不用服务器，手机浏览器直接能打开使用。等你以后要接真实 AI 时，再把完整网站包部署到服务器，并把密钥放进后端 .env。`;\n  for (const char of reply) {\n    if (signal?.aborted) throw new DOMException('已打断回复', 'AbortError');\n    handlers.delta?.({ content: char });\n    await mockDelay(24);\n  }\n  const shouldRemember = /(我叫|叫我|我是|我的|喜欢|不喜欢|讨厌|记住|以后|希望|习惯|生日|朋友|家人|学校|工作|职业|住在|来自|约定|我们|正在|剧情|线索|案件|设定)/.test(lastUserMessage);\n  if (shouldRemember && lastUserMessage.length >= 8) {\n    state.memories ||= [];\n    const memory = {\n      id: uuid(),\n      roleId: payload.roleId || '',\n      roleName: payload.roleName || 'AI角色',\n      type: /不喜欢|讨厌|不要/.test(lastUserMessage) ? '禁忌' : (/喜欢|希望|习惯|叫我/.test(lastUserMessage) ? '偏好' : '事件'),\n      content: `用户提到：${lastUserMessage.slice(0, 90)}${lastUserMessage.length > 90 ? '...' : ''}`,\n      source: 'auto',\n      sourceConversationId: payload.conversationId || payload.roleId || '',\n      sourceMessageIds: payload.sourceMessageIds || [],\n      createdAt: new Date().toISOString(),\n      updatedAt: new Date().toISOString()\n    };\n    state.memories.unshift(memory);\n    saveMockState(state);\n    handlers.memory?.(memory);\n  }\n  handlers.done?.({ beans: state.beans });\n};\n/* ===== app.js ===== */\n\nconst $ = (selector) => document.querySelector(selector);\nconst $$ = (selector) => [...document.querySelectorAll(selector)];\n\nlet state = loadState();\nlet billingConfig = { chatBeansCost: 2, rechargePackages: [] };\nlet serverUser = { beans: 0, transactions: [] };\nlet memoryCache = [];\nlet editingRoleId = null;\nlet isReplying = false;\nlet currentAbortController = null;\n\nconst avatarOf = (name, image) => {\n  if (image) return image;\n  const first = String(name || 'AI').trim().slice(0, 1).toUpperCase() || 'AI';\n  const svg = `<svg xmlns=\"http://www.w3.org/2000/svg\" width=\"96\" height=\"96\"><defs><linearGradient id=\"g\" x1=\"0\" x2=\"1\" y1=\"0\" y2=\"1\"><stop stop-color=\"#ffcadb\"/><stop offset=\"1\" stop-color=\"#7466ff\"/></linearGradient></defs><rect width=\"96\" height=\"96\" rx=\"48\" fill=\"url(#g)\"/><text x=\"48\" y=\"57\" text-anchor=\"middle\" font-size=\"34\" font-family=\"Arial\" fill=\"#fff\" font-weight=\"700\">${escapeHtml(first)}</text></svg>`;\n  return `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`;\n};\n\nconst persist = () => {\n  saveState(state);\n  applyCostumes(state.costumes);\n};\n\nconst toast = (message) => {\n  const el = $('#toast');\n  el.textContent = message;\n  el.classList.add('show');\n  clearTimeout(toast.timer);\n  toast.timer = setTimeout(() => el.classList.remove('show'), 2200);\n};\n\nconst activeRole = () => state.roles.find((role) => role.id === state.activeRoleId) || state.roles[0];\n\nconst getMessages = (roleId = state.activeRoleId) => {\n  state.conversations[roleId] ||= [];\n  state.conversations[roleId].forEach((item, index) => {\n    if (!item.id) state.conversations[roleId][index] = { ...item, id: uuid() };\n  });\n  return state.conversations[roleId];\n};\n\nconst refreshServerUser = async () => {\n  try {\n    serverUser = await api.getMe();\n    $('#beansBadge').textContent = `豆子 ${serverUser.beans}`;\n    $('#beansBalance').textContent = `${serverUser.beans} 豆子`;\n    renderTransactions();\n  } catch (error) {\n    toast(error.message);\n  }\n};\n\nconst renderTransactions = () => {\n  const list = $('#transactionList');\n  if (!serverUser.transactions?.length) {\n    list.innerHTML = '<div class=\"empty-state\">暂无消费或充值明细。</div>';\n    return;\n  }\n  list.innerHTML = serverUser.transactions.map((item) => `\n    <div class=\"role-card\">\n      <div class=\"avatar\"></div>\n      <div>\n        <h3>${item.beans > 0 ? '+' : ''}${item.beans} 豆子</h3>\n        <p>${item.roleName || '系统'} · ${new Date(item.createdAt).toLocaleString()}</p>\n        <p>${item.summary || ''}</p>\n      </div>\n    </div>\n  `).join('');\n};\n\nconst renderRoleSwitcher = () => {\n  const wrap = $('#roleSwitcher');\n  if (!state.roles.length) {\n    wrap.innerHTML = '<div class=\"empty-state\">还没有角色，请先到“角色”页新建。</div>';\n    return;\n  }\n  wrap.innerHTML = state.roles.map((role) => `\n    <button class=\"role-chip ${role.id === state.activeRoleId ? 'active' : ''}\" data-switch-role=\"${role.id}\" type=\"button\">\n      <img class=\"avatar\" src=\"${avatarOf(role.name, role.avatar)}\" alt=\"${role.name}\" />\n      <span>${role.name}</span>\n    </button>\n  `).join('');\n};\n\nconst renderMessages = () => {\n  const list = $('#messageList');\n  const role = activeRole();\n  const messages = role ? getMessages(role.id) : [];\n\n  if (!role) {\n    list.innerHTML = '<div class=\"empty-state\">暂无角色。请先创建角色，开始你的第一段对话。</div>';\n    return;\n  }\n\n  if (!messages.length) {\n    list.innerHTML = `<div class=\"empty-state\">开始和「${role.name}」聊天吧。</div>`;\n    return;\n  }\n\n  list.innerHTML = messages.map((msg) => `\n    <div class=\"message-row ${msg.role}\">\n      <img class=\"avatar\" src=\"${msg.role === 'user' ? avatarOf(state.user.nickname, state.user.avatar) : avatarOf(role.name, role.avatar)}\" alt=\"\" />\n      <div class=\"chat-bubble\">${escapeHtml(msg.content)}</div>\n    </div>\n  `).join('');\n  $('#chatContainer').scrollTop = $('#chatContainer').scrollHeight;\n};\n\nconst renderRoles = () => {\n  const list = $('#myRolesList');\n  const roles = [...state.roles].sort((a, b) => b.createdAt - a.createdAt);\n  if (!roles.length) {\n    list.innerHTML = '<div class=\"empty-state\">暂无角色，点击右上角“新建”创建你的第一个角色。</div>';\n    return;\n  }\n\n  list.innerHTML = roles.map((role) => `\n    <article class=\"role-card\">\n      <img class=\"avatar\" src=\"${avatarOf(role.name, role.avatar)}\" alt=\"${role.name}\" />\n      <div>\n        <h3>${role.name}</h3>\n        <p>${role.description || '暂无简介'}</p>\n        <p>${role.isPublic ? '公开角色' : '私密角色'} · ${new Date(role.createdAt).toLocaleDateString()}</p>\n        <div class=\"card-actions\">\n          <button data-chat-role=\"${role.id}\" type=\"button\">聊天</button>\n          <button data-edit-role=\"${role.id}\" type=\"button\">编辑</button>\n          <button data-clear-chat=\"${role.id}\" type=\"button\">删除对话</button>\n        </div>\n      </div>\n    </article>\n  `).join('');\n};\n\nconst renderProfile = () => {\n  $('#userNicknameInput').value = state.user.nickname;\n  $('#userBioInput').value = state.user.bio;\n  $('#userAvatarPreview').src = avatarOf(state.user.nickname, state.user.avatar);\n};\n\nconst renderMemoryRoleOptions = () => {\n  const select = $('#memoryRoleSelect');\n  if (!select) return;\n  const current = select.value || state.activeRoleId || '';\n  select.innerHTML = '<option value=\"\">全部角色通用</option>' + state.roles.map((role) => `\n    <option value=\"${role.id}\">${escapeHtml(role.name)}</option>\n  `).join('');\n  select.value = state.roles.some((role) => role.id === current) ? current : '';\n};\n\nconst renderMemories = async () => {\n  const list = $('#memoryList');\n  if (!list) return;\n  renderMemoryRoleOptions();\n  list.innerHTML = '<div class=\"empty-state\">正在加载记忆...</div>';\n  try {\n    const roleId = $('#memoryRoleSelect')?.value || '';\n    const data = await api.listMemories(roleId);\n    memoryCache = data.list || [];\n    if (!memoryCache.length) {\n      list.innerHTML = '<div class=\"empty-state\">还没有记忆。你可以手动新增，也可以在聊天时让系统自动沉淀。</div>';\n      return;\n    }\n    list.innerHTML = memoryCache.map((item) => `\n      <article class=\"memory-card\">\n        <h3>${escapeHtml(item.type || '记忆')} · ${escapeHtml(item.roleName || '全部角色')}</h3>\n        <p>${escapeHtml(item.content || '')}</p>\n        <div class=\"memory-meta\">${item.source === 'auto' ? '自动记忆' : '手动记忆'} · ${new Date(item.updatedAt || item.createdAt).toLocaleString()}</div>\n        <div class=\"card-actions\"><button data-delete-memory=\"${item.id}\" type=\"button\">删除记忆</button></div>\n      </article>\n    `).join('');\n  } catch (error) {\n    list.innerHTML = `<div class=\"empty-state\">${escapeHtml(error.message || '记忆加载失败')}</div>`;\n  }\n};\n\nconst saveMemory = async () => {\n  const content = $('#memoryContentInput').value.trim();\n  if (!content) return toast('请先填写记忆内容。');\n  const roleId = $('#memoryRoleSelect').value;\n  const role = state.roles.find((item) => item.id === roleId);\n  try {\n    await api.createMemory({\n      roleId,\n      roleName: role?.name || '全部角色',\n      type: $('#memoryTypeSelect').value,\n      content,\n      source: 'manual'\n    });\n    $('#memoryContentInput').value = '';\n    await renderMemories();\n    toast('记忆已保存。');\n  } catch (error) {\n    toast(error.message || '保存记忆失败。');\n  }\n};\n\nconst renderRechargePackages = () => {\n  const wrap = $('#rechargePackages');\n  wrap.innerHTML = billingConfig.rechargePackages.map((item) => `\n    <button class=\"package-card\" data-recharge=\"${item.amount}\" type=\"button\">\n      ${item.amount} 元<br><small>${item.beans} 豆子</small>\n    </button>\n  `).join('');\n};\n\nconst renderCommunity = async () => {\n  const wrap = $('#communityList');\n  wrap.innerHTML = '<div class=\"empty-state\">正在加载社区角色...</div>';\n  try {\n    const keyword = $('#communitySearch').value.trim();\n    const data = await api.listCommunityRoles(keyword);\n    if (!data.list.length) {\n      wrap.innerHTML = '<div class=\"empty-state\">社区暂无匹配角色，换个关键词试试。</div>';\n      return;\n    }\n    wrap.innerHTML = data.list.map((role) => `\n      <article class=\"community-card\">\n        <img class=\"avatar\" src=\"${avatarOf(role.name, role.avatar)}\" alt=\"${role.name}\" />\n        <div>\n          <h3>${role.name}</h3>\n          <p>${role.description}</p>\n          <p>上传者：${role.uploaderNickname} · 热度 ${role.heat}</p>\n          <div class=\"card-actions\">\n            <button data-import-role='${encodeURIComponent(JSON.stringify(role))}' type=\"button\">一键导入</button>\n            <button data-view-role='${encodeURIComponent(JSON.stringify(role))}' type=\"button\">详情</button>\n          </div>\n        </div>\n      </article>\n    `).join('');\n  } catch (error) {\n    wrap.innerHTML = `<div class=\"empty-state\">${error.message}</div>`;\n  }\n};\n\nconst renderCostumeEditor = (mode = 'page') => {\n  $$('.tabs [data-costume-mode]').forEach((btn) => btn.classList.toggle('active', btn.dataset.costumeMode === mode));\n  const wrap = $('#costumeEditorWrap');\n  if (mode === 'wallpaper') {\n    wrap.innerHTML = `\n      <div class=\"panel\">\n        <h3>自定义聊天壁纸</h3>\n        <p class=\"muted\">上传图片仅保存在本地浏览器，CSS 只作用于 .chat-container 背景。</p>\n        <input id=\"wallpaperInput\" type=\"file\" accept=\"image/*\" />\n        <textarea id=\"wallpaperCssInput\" class=\"code-editor\" placeholder=\"${examples.wallpaper}\">${state.costumes.wallpaperCss || ''}</textarea>\n        <div class=\"wallpaper-preview\"></div>\n        <div class=\"card-actions\">\n          <button id=\"saveWallpaperButton\" type=\"button\">保存并预览</button>\n          <button id=\"resetWallpaperButton\" type=\"button\">恢复默认壁纸</button>\n        </div>\n      </div>\n    `;\n    return;\n  }\n\n  const key = mode === 'bubble' ? 'bubbleCss' : 'pageCss';\n  wrap.innerHTML = `\n    <div class=\"panel\">\n      <h3>${mode === 'bubble' ? '自定义聊天气泡' : '自定义页面 UI'}</h3>\n      <p class=\"muted\">${mode === 'bubble' ? 'CSS 会被限制在 .chat-bubble 范围内，不影响其他模块。' : '页面 UI CSS 会全局覆盖默认样式，请仅粘贴纯 CSS。'}</p>\n      <textarea id=\"cssEditor\" class=\"code-editor\" spellcheck=\"false\" placeholder=\"${examples[mode]}\">${state.costumes[key] || ''}</textarea>\n      <div class=\"card-actions\">\n        <button id=\"saveCssButton\" data-css-key=\"${key}\" type=\"button\">保存并预览</button>\n        <button id=\"resetCssButton\" data-css-key=\"${key}\" type=\"button\">重置默认</button>\n      </div>\n    </div>\n  `;\n};\n\nconst openRoleDialog = (roleId = null) => {\n  editingRoleId = roleId;\n  const role = state.roles.find((item) => item.id === roleId) || {};\n  $('#roleDialogTitle').textContent = roleId ? '编辑角色' : '新建角色';\n  $('#roleNameInput').value = role.name || '';\n  $('#roleDescriptionInput').value = role.description || '';\n  $('#rolePromptInput').value = role.prompt || '';\n  $('#rolePublicInput').checked = Boolean(role.isPublic);\n  $('#roleAvatarPreview').src = avatarOf(role.name || '新角色', role.avatar);\n  $('#deleteRoleButton').style.display = roleId ? 'inline-flex' : 'none';\n  $('#roleDialog').showModal();\n};\n\nconst saveRole = async (event) => {\n  event.preventDefault();\n  const current = state.roles.find((item) => item.id === editingRoleId);\n  const role = {\n    id: editingRoleId || crypto.randomUUID(),\n    name: $('#roleNameInput').value.trim(),\n    description: $('#roleDescriptionInput').value.trim(),\n    prompt: $('#rolePromptInput').value.trim(),\n    avatar: $('#roleAvatarPreview').dataset.value || current?.avatar || '',\n    isPublic: $('#rolePublicInput').checked,\n    createdAt: current?.createdAt || Date.now()\n  };\n\n  if (!role.name || !role.description || !role.prompt) {\n    toast('请完整填写角色名称、简介和人设。');\n    return;\n  }\n\n  if (current) {\n    Object.assign(current, role);\n  } else {\n    state.roles.unshift(role);\n    state.activeRoleId = role.id;\n  }\n\n  if (role.isPublic) {\n    await api.publishRole({ ...role, uploaderNickname: state.user.nickname }).catch((error) => toast(error.message));\n  }\n\n  persist();\n  $('#roleDialog').close();\n  renderAll();\n  toast('角色已保存。');\n};\n\nconst deleteRole = async () => {\n  if (!editingRoleId) return;\n  if (!confirm('确认删除该角色？对应对话历史和自动记忆也会同步删除。')) return;\n  await api.cleanupMemories({ roleId: editingRoleId, sourceConversationId: editingRoleId }).catch(() => null);\n  state.roles = state.roles.filter((role) => role.id !== editingRoleId);\n  delete state.conversations[editingRoleId];\n  state.activeRoleId = state.roles[0]?.id || '';\n  persist();\n  $('#roleDialog').close();\n  renderAll();\n  renderMemories();\n  toast('角色已删除。');\n};\n\nconst sendMessage = async (event) => {\n  event.preventDefault();\n  if (isReplying) {\n    currentAbortController?.abort();\n    toast('已打断上一条回复。');\n  }\n\n  const role = activeRole();\n  const input = $('#messageInput');\n  const content = input.value.trim();\n  if (!role) return toast('请先创建或选择一个角色。');\n  if (!content) return;\n\n  const messages = getMessages(role.id);\n  const userMessage = { id: uuid(), role: 'user', content, createdAt: Date.now() };\n  messages.push(userMessage);\n  input.value = '';\n  persist();\n  renderMessages();\n\n  const assistantMessage = { id: uuid(), role: 'assistant', content: '', createdAt: Date.now() };\n  messages.push(assistantMessage);\n  isReplying = true;\n  currentAbortController = new AbortController();\n  const localAbortController = currentAbortController;\n  renderMessages();\n  appendTyping();\n\n  try {\n    await api.streamChat({\n      roleId: role.id,\n      conversationId: role.id,\n      roleName: role.name,\n      rolePrompt: `${role.prompt}\\n\\n用户资料：${state.user.nickname}，${state.user.bio}`,\n      sourceMessageIds: [userMessage.id],\n      messages: messages.filter((item) => item.content).map((item) => ({ role: item.role, content: item.content }))\n    }, {\n      charged: (data) => {\n        serverUser.beans = data.beans;\n        $('#beansBadge').textContent = `豆子 ${data.beans}`;\n      },\n      delta: (data) => {\n        if (!isReplying) return;\n        assistantMessage.content += data.content;\n        persist();\n        renderMessages();\n      },\n      error: (data) => {\n        assistantMessage.content = data.message;\n        toast(data.message);\n      },\n      memory: (data) => {\n        memoryCache.unshift(data);\n        toast('已自动加入一条记忆。');\n        renderMemories();\n      }\n    }, localAbortController.signal);\n  } catch (error) {\n    if (error.name === 'AbortError') {\n      assistantMessage.content = assistantMessage.content || '回复已被打断。';\n    } else {\n      assistantMessage.content = '请求失败，请稍后再试。';\n      toast(error.message);\n    }\n  } finally {\n    if (currentAbortController === localAbortController) {\n      isReplying = false;\n      currentAbortController = null;\n    }\n    if (!assistantMessage.content.trim()) {\n      assistantMessage.content = 'AI 暂时没有返回内容，本次没有生成有效回复。请再试一次。';\n    }\n    persist();\n    renderMessages();\n    refreshServerUser();\n  }\n};\n\nconst appendTyping = () => {\n  const list = $('#messageList');\n  const row = document.createElement('div');\n  row.className = 'message-row assistant';\n  row.innerHTML = '<div class=\"avatar\"></div><div class=\"chat-bubble\"><span class=\"typing-dot\"><i></i><i></i><i></i></span></div>';\n  list.appendChild(row);\n  $('#chatContainer').scrollTop = $('#chatContainer').scrollHeight;\n};\n\nconst escapeHtml = (text) => String(text)\n  .replaceAll('&', '&amp;')\n  .replaceAll('<', '&lt;')\n  .replaceAll('>', '&gt;')\n  .replaceAll('\"', '&quot;')\n  .replaceAll(\"'\", '&#039;');\n\nconst renderAll = () => {\n  renderRoleSwitcher();\n  renderMessages();\n  renderRoles();\n  renderProfile();\n  renderRechargePackages();\n  renderMemoryRoleOptions();\n};\n\nconst exportBackup = async () => {\n  try {\n    const serverData = await api.exportUserData().catch(() => ({\n      userId: CONFIG.userId,\n      beans: serverUser.beans,\n      transactions: serverUser.transactions || [],\n      memories: memoryCache || []\n    }));\n    const backup = {\n      app: 'Mochi-phone',\n      version: 2,\n      exportedAt: new Date().toISOString(),\n      userId: CONFIG.userId,\n      localState: state,\n      serverData\n    };\n    const blob = new Blob([JSON.stringify(backup, null, 2)], { type: 'application/json;charset=utf-8' });\n    const url = URL.createObjectURL(blob);\n    const link = document.createElement('a');\n    link.href = url;\n    link.download = `mochi-phone-backup-${new Date().toISOString().slice(0, 10)}.json`;\n    document.body.appendChild(link);\n    link.click();\n    link.remove();\n    URL.revokeObjectURL(url);\n    toast('数据备份已导出，请保存好这个 JSON 文件。');\n  } catch (error) {\n    toast(error.message || '导出失败，请稍后重试。');\n  }\n};\n\nconst importBackupFile = async (file) => {\n  try {\n    const text = await file.text();\n    const backup = JSON.parse(text);\n    if (backup.app !== 'Mochi-phone' || !backup.localState) {\n      throw new Error('这不是有效的 Mochi-phone 备份文件。');\n    }\n    if (!confirm('导入后会覆盖当前浏览器里的角色、对话、装扮和豆子数据，确认继续？')) return;\n\n    const importedUserId = backup.userId || backup.serverData?.userId;\n    if (importedUserId) {\n      localStorage.setItem('mochi_phone_user_id', importedUserId);\n    }\n    saveState(backup.localState);\n    if (backup.serverData) {\n      await api.importUserData({\n        userId: importedUserId,\n        beans: backup.serverData.beans,\n        transactions: backup.serverData.transactions || [],\n        memories: backup.serverData.memories || []\n      }).catch(() => null);\n    }\n    toast('导入成功，页面即将刷新。');\n    setTimeout(() => location.reload(), 900);\n  } catch (error) {\n    toast(error.message || '导入失败，请确认文件是否正确。');\n  }\n};\n\nconst bindEvents = () => {\n  $('.bottom-nav').addEventListener('click', (event) => {\n    const btn = event.target.closest('[data-page]');\n    if (!btn) return;\n    $$('.page').forEach((page) => page.classList.toggle('active', page.id === btn.dataset.page));\n    $$('.bottom-nav button').forEach((item) => item.classList.toggle('active', item === btn));\n    $('#pageTitle').textContent = btn.textContent;\n    if (btn.dataset.page === 'communityPage') renderCommunity();\n    if (btn.dataset.page === 'memoryPage') renderMemories();\n  });\n\n  document.addEventListener('click', async (event) => {\n    const switchBtn = event.target.closest('[data-switch-role]');\n    if (switchBtn) {\n      state.activeRoleId = switchBtn.dataset.switchRole;\n      persist();\n      renderRoleSwitcher();\n      renderMessages();\n    }\n\n    const chatBtn = event.target.closest('[data-chat-role]');\n    if (chatBtn) {\n      state.activeRoleId = chatBtn.dataset.chatRole;\n      persist();\n      $('.bottom-nav [data-page=\"chatPage\"]').click();\n    }\n\n    const editBtn = event.target.closest('[data-edit-role]');\n    if (editBtn) openRoleDialog(editBtn.dataset.editRole);\n\n    const clearBtn = event.target.closest('[data-clear-chat]');\n    if (clearBtn && confirm('确认删除当前角色的全部对话？由这些对话自动生成的记忆也会同步删除。')) {\n      const roleId = clearBtn.dataset.clearChat;\n      const removedIds = (state.conversations[roleId] || []).map((item) => item.id).filter(Boolean);\n      const result = await api.cleanupMemories({ roleId, sourceConversationId: roleId, sourceMessageIds: removedIds }).catch(() => ({ deleted: 0 }));\n      state.conversations[roleId] = [];\n      persist();\n      renderMessages();\n      renderMemories();\n      toast(`对话已删除，已清理 ${result.deleted || 0} 条关联记忆。`);\n    }\n\n    const deleteMemoryBtn = event.target.closest('[data-delete-memory]');\n    if (deleteMemoryBtn && confirm('确认删除这条记忆？')) {\n      await api.deleteMemory(deleteMemoryBtn.dataset.deleteMemory);\n      await renderMemories();\n      toast('记忆已删除。');\n    }\n\n    const importBtn = event.target.closest('[data-import-role]');\n    if (importBtn) {\n      const role = JSON.parse(decodeURIComponent(importBtn.dataset.importRole));\n      const localRole = { ...role, id: crypto.randomUUID(), isPublic: false, createdAt: Date.now() };\n      state.roles.unshift(localRole);\n      state.activeRoleId = localRole.id;\n      persist();\n      renderAll();\n      toast('已导入到我的角色，可自由编辑。');\n    }\n\n    const viewBtn = event.target.closest('[data-view-role]');\n    if (viewBtn) {\n      const role = JSON.parse(decodeURIComponent(viewBtn.dataset.viewRole));\n      alert(`${role.name}\\n\\n${role.description}\\n\\n人设：\\n${role.prompt}\\n\\n上传时间：${new Date(role.createdAt).toLocaleString()}`);\n    }\n\n    const rechargeBtn = event.target.closest('[data-recharge]');\n    if (rechargeBtn) {\n      const amount = Number(rechargeBtn.dataset.recharge);\n      const item = billingConfig.rechargePackages.find((pkg) => pkg.amount === amount);\n      await api.recharge(item);\n      toast('模拟充值成功。');\n      refreshServerUser();\n    }\n\n    const costumeEntry = event.target.closest('[data-costume-tab]');\n    if (costumeEntry) {\n      $('.bottom-nav [data-page=\"profilePage\"]').classList.remove('active');\n      $$('.page').forEach((page) => page.classList.toggle('active', page.id === 'costumePage'));\n      $('#pageTitle').textContent = '自定义装扮';\n      renderCostumeEditor(costumeEntry.dataset.costumeTab);\n    }\n  });\n\n  $('#newRoleButton').addEventListener('click', () => openRoleDialog());\n  $('#roleForm').addEventListener('submit', saveRole);\n  $('#deleteRoleButton').addEventListener('click', deleteRole);\n  $('#saveMemoryButton').addEventListener('click', saveMemory);\n  $('#refreshMemoryButton').addEventListener('click', renderMemories);\n  $('#memoryRoleSelect').addEventListener('change', renderMemories);\n  $$('[data-close-dialog]').forEach((btn) => btn.addEventListener('click', () => $('#roleDialog').close()));\n  $('#chatForm').addEventListener('submit', sendMessage);\n  $('#communitySearchButton').addEventListener('click', renderCommunity);\n\n  $('#saveProfileButton').addEventListener('click', () => {\n    state.user.nickname = $('#userNicknameInput').value.trim() || '体验用户';\n    state.user.bio = $('#userBioInput').value.trim();\n    persist();\n    renderAll();\n    toast('个人资料已保存。');\n  });\n\n  $('#exportDataButton').addEventListener('click', exportBackup);\n  $('#importDataButton').addEventListener('click', () => $('#importDataInput').click());\n  $('#importDataInput').addEventListener('change', async (event) => {\n    const file = event.target.files?.[0];\n    event.target.value = '';\n    if (file) await importBackupFile(file);\n  });\n\n  $('#clearCacheButton').addEventListener('click', () => {\n    if (!confirm('确认清空本地角色、对话和装扮配置？此操作不可恢复。')) return;\n    clearState();\n    state = loadState();\n    persist();\n    renderAll();\n    toast('本地缓存已清空。');\n  });\n\n  $('#roleAvatarInput').addEventListener('change', async (event) => {\n    const file = event.target.files[0];\n    if (!file) return;\n    const dataUrl = await readFileAsDataUrl(file);\n    $('#roleAvatarPreview').src = dataUrl;\n    $('#roleAvatarPreview').dataset.value = dataUrl;\n  });\n\n  $('#userAvatarInput').addEventListener('change', async (event) => {\n    const file = event.target.files[0];\n    if (!file) return;\n    state.user.avatar = await readFileAsDataUrl(file);\n    persist();\n    renderProfile();\n  });\n\n  $('#messageInput').addEventListener('input', (event) => {\n    event.target.style.height = 'auto';\n    event.target.style.height = `${Math.min(event.target.scrollHeight, 96)}px`;\n  });\n\n  $('#costumePage').addEventListener('click', async (event) => {\n    const modeBtn = event.target.closest('[data-costume-mode]');\n    if (modeBtn) renderCostumeEditor(modeBtn.dataset.costumeMode);\n\n    const saveCss = event.target.closest('#saveCssButton');\n    if (saveCss) {\n      state.costumes[saveCss.dataset.cssKey] = sanitizeCss($('#cssEditor').value);\n      persist();\n      toast('CSS 已保存并实时生效。');\n    }\n\n    const resetCss = event.target.closest('#resetCssButton');\n    if (resetCss) {\n      state.costumes[resetCss.dataset.cssKey] = '';\n      persist();\n      renderCostumeEditor(resetCss.dataset.cssKey === 'bubbleCss' ? 'bubble' : 'page');\n      toast('已恢复默认样式。');\n    }\n\n    const saveWallpaper = event.target.closest('#saveWallpaperButton');\n    if (saveWallpaper) {\n      const file = $('#wallpaperInput')?.files?.[0];\n      if (file) state.costumes.wallpaperImage = await readFileAsDataUrl(file);\n      state.costumes.wallpaperCss = sanitizeCss($('#wallpaperCssInput').value);\n      persist();\n      renderCostumeEditor('wallpaper');\n      toast('壁纸已保存。');\n    }\n\n    const resetWallpaper = event.target.closest('#resetWallpaperButton');\n    if (resetWallpaper) {\n      state.costumes.wallpaperImage = '';\n      state.costumes.wallpaperCss = '';\n      persist();\n      renderCostumeEditor('wallpaper');\n      toast('已恢复默认壁纸。');\n    }\n  });\n};\n\nconst init = async () => {\n  applyCostumes(state.costumes);\n  bindEvents();\n  renderAll();\n  try {\n    billingConfig = await api.getBillingConfig();\n    renderRechargePackages();\n    await refreshServerUser();\n  } catch (error) {\n    toast(error.message);\n  }\n};\n\ninit();\n</script>\n  </body>\n</html>\n";

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
    return duplicate;
  }
  list.unshift(memory);
  if (list.length > 200) list.length = 200;
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
  if (/不喜欢|讨厌|别再|不要叫|不要/.test(content)) return '禁忌';
  if (/喜欢|偏好|希望|习惯|叫我|称呼/.test(content)) return '偏好';
  if (/生日|家人|朋友|学校|工作|职业|住在|来自|我是|我叫/.test(content)) return '用户资料';
  if (/约定|我们|一起|关系|陪我|晚安|早安/.test(content)) return '角色关系';
  if (/剧情|任务|线索|案件|世界观|设定|正在/.test(content)) return '剧情';
  return '事件';
};

const buildAutoMemory = ({ userId, roleId, roleName, lastUserMessage, sourceMessageIds = [] }) => {
  const raw = String(lastUserMessage || '').replace(/\s+/g, ' ').trim();
  if (raw.length < 8 || raw.length > 260) return null;
  if (/^(你好|在吗|嗯|哦|好|哈哈|谢谢|再见|晚安|早安)[。！？!?.]*$/.test(raw)) return null;
  const shouldRemember = /(我叫|叫我|我是|我的|喜欢|不喜欢|讨厌|记住|以后|希望|习惯|生日|朋友|家人|学校|工作|职业|住在|来自|约定|我们|正在|剧情|线索|案件|设定)/.test(raw);
  if (!shouldRemember) return null;
  const type = inferMemoryType(raw);
  const content = raw.length > 90 ? `用户提到：${raw.slice(0, 90)}...` : `用户提到：${raw}`;
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
  return before.length - kept.length;
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

  res.setHeader('Content-Type', 'text/event-stream; charset=utf-8');
  res.setHeader('Cache-Control', 'no-cache, no-transform');
  res.setHeader('Connection', 'keep-alive');
  writeSse(res, 'charged', { beans: user.beans, cost: config.chatBeansCost });

  try {
    if (!config.upstreamKey || config.upstreamKey.includes('请填写')) {
      const memoryNote = buildMemoryPrompt(user.id, activeRoleId);
      const reply = `我是${roleName || 'Mochi-phone 角色'}。我已经收到你的消息：“${lastUserMessage}”。${memoryNote ? '\\n\\n我也会参考我们已有的记忆继续陪你。' : ''}\n\n当前网站后端已运行，但还没有读取到 UPSTREAM_API_KEY，所以先返回演示回复。`;
      await streamText(res, reply);
      const memory = buildAutoMemory({ userId: user.id, roleId: activeRoleId, roleName, lastUserMessage, sourceMessageIds });
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

    const memory = buildAutoMemory({ userId: user.id, roleId: activeRoleId, roleName, lastUserMessage, sourceMessageIds });
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

app.listen(PORT, HOST, () => console.log(`Mochi-phone 已启动：http://localhost:${PORT}`));
