/**
 * Mochi AI Chat - 前端核心逻辑 v2.2
 * 功能：登录注册、聊天、角色管理、社区、个人中心、自定义装扮、兑换码支付
 * 
 * v2.2 更新：
 * - 修复聊天发送逻辑 bug
 * - 优化错误提示
 * - 新增兑换码功能
 * - 新增收款码展示
 */

// ==================== 全局状态 ====================
const AppState = {
  isLoggedIn: false,
  token: '',
  user: {
    id: null,
    username: '',
    nickname: '',
    avatar: '',
    description: '',
    rice_balance: 0
  },
  currentPage: 'chat',
  currentCharacterId: null,
  currentConversationId: null,
  characters: [],
  conversations: {}, // characterId -> conversationId
  chatHistory: {}, // conversationId -> messages[]
  isSending: false,
  abortController: null,
  communitySort: 'hot',
  communitySearch: '',
  themeConfig: {
    uiCss: '',
    bubbleCss: '',
    wallpaper: '',
    wallpaperOpacity: 30,
    wallpaperBlur: 0
  },
  txFilterType: 'all',
  rechargeTiers: []
};

// ==================== 本地存储键 ====================
const STORAGE_KEYS = {
  TOKEN: 'mochi_token',
  THEME_CONFIG: 'mochi_theme_config'
};

// ==================== API 请求封装 ====================
const API = {
  async request(path, options = {}) {
    const headers = {
      'Content-Type': 'application/json',
      ...options.headers
    };
    
    if (AppState.token) {
      headers['Authorization'] = `Bearer ${AppState.token}`;
    }

    const response = await fetch(path, {
      ...options,
      headers
    });

    const data = await response.json();
    
    if (!response.ok) {
      if (response.status === 401) {
        AppState.isLoggedIn = false;
        AppState.token = '';
        localStorage.removeItem(STORAGE_KEYS.TOKEN);
        showLoginPage();
        throw new Error(data.error || '登录已过期');
      }
      throw new Error(data.error || '请求失败');
    }
    
    return data;
  },

  get(path) {
    return this.request(path, { method: 'GET' });
  },

  post(path, data) {
    return this.request(path, {
      method: 'POST',
      body: JSON.stringify(data || {})
    });
  },

  put(path, data) {
    return this.request(path, {
      method: 'PUT',
      body: JSON.stringify(data || {})
    });
  },

  delete(path) {
    return this.request(path, { method: 'DELETE' });
  }
};

// ==================== 初始化 ====================
document.addEventListener('DOMContentLoaded', () => {
  initApp();
});

function initApp() {
  loadThemeFromStorage();
  applyThemeConfig();
  setupEventListeners();

  // 检查是否已登录
  const token = localStorage.getItem(STORAGE_KEYS.TOKEN);
  if (token) {
    AppState.token = token;
    checkAuth();
  } else {
    showLoginPage();
  }
}

// ==================== 登录相关 ====================
function showLoginPage() {
  document.querySelectorAll('.page').forEach(p => p.classList.remove('active'));
  document.getElementById('page-login').classList.add('active');
  document.getElementById('bottomNav').style.display = 'none';
}

function showMainApp() {
  document.querySelectorAll('.page').forEach(p => p.classList.remove('active'));
  document.getElementById('page-chat').classList.add('active');
  document.getElementById('bottomNav').style.display = 'flex';
  AppState.currentPage = 'chat';
}

async function checkAuth() {
  try {
    const res = await API.get('/api/auth/me');
    if (res.success) {
      AppState.isLoggedIn = true;
      AppState.user = res.data;
      await loadUserData();
      showMainApp();
    }
  } catch (err) {
    AppState.token = '';
    localStorage.removeItem(STORAGE_KEYS.TOKEN);
    showLoginPage();
  }
}

async function handleLogin() {
  const username = document.getElementById('loginUsername').value.trim();
  const password = document.getElementById('loginPassword').value;

  if (!username || !password) {
    showToast('请输入用户名和密码');
    return;
  }

  try {
    const res = await API.post('/api/auth/login', { username, password });
    if (res.success) {
      AppState.token = res.data.token;
      AppState.user = res.data.user;
      AppState.isLoggedIn = true;
      localStorage.setItem(STORAGE_KEYS.TOKEN, res.data.token);
      
      await loadUserData();
      showMainApp();
      showToast('登录成功');
    }
  } catch (err) {
    showToast(err.message);
  }
}

async function handleRegister() {
  const username = document.getElementById('registerUsername').value.trim();
  const password = document.getElementById('registerPassword').value;
  const confirmPassword = document.getElementById('registerConfirmPassword').value;

  if (!username || !password) {
    showToast('请输入用户名和密码');
    return;
  }

  if (password !== confirmPassword) {
    showToast('两次密码输入不一致');
    return;
  }

  if (password.length < 6) {
    showToast('密码长度不能少于6位');
    return;
  }

  try {
    const res = await API.post('/api/auth/register', { username, password });
    if (res.success) {
      AppState.token = res.data.token;
      AppState.user = res.data.user;
      AppState.isLoggedIn = true;
      localStorage.setItem(STORAGE_KEYS.TOKEN, res.data.token);
      
      await loadUserData();
      showMainApp();
      showToast('注册成功，欢迎加入！');
    }
  } catch (err) {
    showToast(err.message);
  }
}

function handleLogout() {
  showConfirm('确定要退出登录吗？', () => {
    AppState.isLoggedIn = false;
    AppState.token = '';
    AppState.user = { id: null, username: '', nickname: '', avatar: '', rice_balance: 0 };
    AppState.characters = [];
    AppState.chatHistory = {};
    AppState.conversations = {};
    localStorage.removeItem(STORAGE_KEYS.TOKEN);
    showLoginPage();
    showToast('已退出登录');
  });
}

// ==================== 加载用户数据 ====================
async function loadUserData() {
  try {
    // 加载角色列表
    const charsRes = await API.get('/api/characters');
    if (charsRes.success) {
      AppState.characters = charsRes.data;
    }

    // 加载对话列表
    const convRes = await API.get('/api/conversations');
    if (convRes.success) {
      AppState.conversations = {};
      convRes.data.forEach(conv => {
        AppState.conversations[conv.character_id] = conv.id;
      });
    }

    // 渲染UI
    renderCharacters();
    renderCharacterSwitcher();
    renderProfile();

    // 默认选中第一个角色
    if (AppState.characters.length > 0) {
      await switchCharacter(AppState.characters[0].id);
    }
  } catch (err) {
    console.error('加载用户数据失败:', err);
  }
}

// ==================== 本地存储（主题） ====================
function saveThemeToStorage() {
  localStorage.setItem(STORAGE_KEYS.THEME_CONFIG, JSON.stringify(AppState.themeConfig));
}

function loadThemeFromStorage() {
  try {
    const theme = localStorage.getItem(STORAGE_KEYS.THEME_CONFIG);
    if (theme) AppState.themeConfig = JSON.parse(theme);
  } catch (e) {
    console.error('加载主题配置失败:', e);
  }
}

// ==================== 事件监听 ====================
function setupEventListeners() {
  // 登录注册
  document.getElementById('btnLogin').addEventListener('click', handleLogin);
  document.getElementById('btnRegister').addEventListener('click', handleRegister);
  
  document.querySelectorAll('.login-tab').forEach(tab => {
    tab.addEventListener('click', () => {
      document.querySelectorAll('.login-tab').forEach(t => t.classList.remove('active'));
      tab.classList.add('active');
      
      const tabName = tab.dataset.tab;
      document.getElementById('loginForm').classList.toggle('active', tabName === 'login');
      document.getElementById('registerForm').classList.toggle('active', tabName === 'register');
    });
  });

  // 底部导航
  document.querySelectorAll('.nav-item').forEach(item => {
    item.addEventListener('click', () => {
      const page = item.dataset.page;
      switchPage(page);
    });
  });

  // 发送消息
  document.getElementById('btnSend').addEventListener('click', sendMessage);
  document.getElementById('chatInput').addEventListener('keydown', (e) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      sendMessage();
    }
  });

  // 输入框自动高度
  document.getElementById('chatInput').addEventListener('input', function() {
    this.style.height = 'auto';
    this.style.height = Math.min(this.scrollHeight, 120) + 'px';
  });

  // 角色相关
  document.getElementById('btnAddCharacter').addEventListener('click', () => openCharacterEdit());
  document.getElementById('btnSaveCharacter').addEventListener('click', saveCharacter);
  document.getElementById('btnUploadAvatar').addEventListener('click', () => {
    document.getElementById('characterAvatarInput').click();
  });
  document.getElementById('characterAvatarInput').addEventListener('change', handleCharacterAvatar);

  // 个人资料
  document.getElementById('btnEditProfile').addEventListener('click', openProfileEdit);
  document.getElementById('btnSaveProfile').addEventListener('click', saveProfile);
  document.getElementById('btnUploadProfileAvatar').addEventListener('click', () => {
    document.getElementById('profileAvatarInput').click();
  });
  document.getElementById('profileAvatarInput').addEventListener('change', handleProfileAvatar);

  // 充值
  document.getElementById('btnRecharge').addEventListener('click', openRecharge);
  document.getElementById('menuRice').addEventListener('click', openRiceDetail);
  document.getElementById('menuOrders').addEventListener('click', openOrders);
  document.getElementById('menuLogout').addEventListener('click', handleLogout);

  // 兑换码
  document.getElementById('menuRedeemCode').addEventListener('click', openRedeemCode);
  document.getElementById('btnRedeemSubmit').addEventListener('click', handleRedeemCode);

  // 交易记录筛选
  document.querySelectorAll('[data-tx-type]').forEach(tab => {
    tab.addEventListener('click', () => {
      document.querySelectorAll('[data-tx-type]').forEach(t => t.classList.remove('active'));
      tab.classList.add('active');
      AppState.txFilterType = tab.dataset.txType;
      loadTransactions();
    });
  });

  // 装扮
  document.getElementById('menuTheme').addEventListener('click', openTheme);
  document.querySelectorAll('.theme-tab').forEach(tab => {
    tab.addEventListener('click', () => switchThemeTab(tab.dataset.themeTab));
  });
  document.getElementById('btnApplyUi').addEventListener('click', applyUiCss);
  document.getElementById('btnResetUi').addEventListener('click', resetUiCss);
  document.getElementById('btnApplyBubble').addEventListener('click', applyBubbleCss);
  document.getElementById('btnResetBubble').addEventListener('click', resetBubbleCss);
  document.getElementById('btnUploadWallpaper').addEventListener('click', () => {
    document.getElementById('wallpaperInput').click();
  });
  document.getElementById('wallpaperInput').addEventListener('change', handleWallpaperUpload);
  document.getElementById('wallpaperOpacity').addEventListener('input', function() {
    document.getElementById('wallpaperOpacityValue').textContent = this.value + '%';
  });
  document.getElementById('wallpaperBlur').addEventListener('input', function() {
    document.getElementById('wallpaperBlurValue').textContent = this.value + 'px';
  });
  document.getElementById('btnApplyWallpaper').addEventListener('click', applyWallpaper);
  document.getElementById('btnResetWallpaper').addEventListener('click', resetWallpaper);

  // 关于
  document.getElementById('menuAbout').addEventListener('click', () => openModal('modalAbout'));

  // 社区搜索
  document.getElementById('communitySearch').addEventListener('input', debounce(() => {
    AppState.communitySearch = document.getElementById('communitySearch').value;
    loadCommunityCharacters();
  }, 300));

  // 社区筛选
  document.querySelectorAll('.filter-tab').forEach(tab => {
    tab.addEventListener('click', () => {
      document.querySelectorAll('.filter-tab').forEach(t => t.classList.remove('active'));
      tab.classList.add('active');
      AppState.communitySort = tab.dataset.sort;
      loadCommunityCharacters();
    });
  });

  // 导入角色
  document.getElementById('btnImportCharacter').addEventListener('click', importCharacter);

  // 弹窗关闭
  document.querySelectorAll('.modal-close, [data-modal]').forEach(btn => {
    btn.addEventListener('click', () => {
      const modalId = btn.dataset.modal || btn.closest('.modal').id;
      closeModal(modalId);
    });
  });

  // 点击遮罩关闭弹窗
  document.querySelectorAll('.modal-overlay').forEach(overlay => {
    overlay.addEventListener('click', () => {
      const modal = overlay.closest('.modal');
      closeModal(modal.id);
    });
  });

  // 确认对话框
  document.getElementById('btnConfirmCancel').addEventListener('click', () => {
    closeModal('modalConfirm');
    if (window._confirmCancel) window._confirmCancel();
  });
  document.getElementById('btnConfirmOk').addEventListener('click', () => {
    closeModal('modalConfirm');
    if (window._confirmOk) window._confirmOk();
  });
}

// ==================== 页面切换 ====================
function switchPage(page) {
  AppState.currentPage = page;
  
  document.querySelectorAll('.page').forEach(p => p.classList.remove('active'));
  document.getElementById('page-' + page).classList.add('active');
  
  document.querySelectorAll('.nav-item').forEach(item => {
    item.classList.toggle('active', item.dataset.page === page);
  });

  if (page === 'characters') {
    renderCharacters();
  } else if (page === 'community') {
    loadCommunityCharacters();
  } else if (page === 'profile') {
    renderProfile();
  }
}

// ==================== 角色切换 ====================
async function switchCharacter(characterId) {
  AppState.currentCharacterId = characterId;
  
  // 更新切换栏
  document.querySelectorAll('.switcher-item').forEach(item => {
    item.classList.toggle('active', item.dataset.id == characterId);
  });

  // 加载对话历史
  await loadConversation(characterId);
  
  // 渲染消息
  renderMessages();
  
  // 滚动到底部
  scrollToBottom();
}

async function loadConversation(characterId) {
  const convId = AppState.conversations[characterId];
  if (!convId) {
    AppState.currentConversationId = null;
    return;
  }

  try {
    const res = await API.get(`/api/conversations/${convId}/messages`);
    if (res.success) {
      AppState.chatHistory[convId] = res.data;
      AppState.currentConversationId = convId;
    }
  } catch (err) {
    console.error('加载对话失败:', err);
  }
}

function renderCharacterSwitcher() {
  const switcher = document.getElementById('characterSwitcher');
  
  if (AppState.characters.length === 0) {
    switcher.innerHTML = '<div style="color: var(--text-tertiary); font-size: 13px; padding: 10px 0;">暂无角色，去「角色」页面创建吧</div>';
    return;
  }

  switcher.innerHTML = AppState.characters.map(char => `
    <div class="switcher-item ${char.id == AppState.currentCharacterId ? 'active' : ''}" data-id="${char.id}">
      <div class="switcher-avatar">
        ${char.avatar ? `<img src="${char.avatar}" alt="${char.name}">` : '<span class="avatar-placeholder">👤</span>'}
      </div>
      <div class="switcher-name">${escapeHtml(char.name)}</div>
    </div>
  `).join('');

  // 绑定点击事件
  switcher.querySelectorAll('.switcher-item').forEach(item => {
    item.addEventListener('click', () => {
      switchCharacter(item.dataset.id);
    });
  });
}

// ==================== 聊天功能（已修复） ====================
function renderMessages() {
  const container = document.getElementById('chatMessages');
  const convId = AppState.currentConversationId;
  
  if (!convId || !AppState.currentCharacterId) {
    container.innerHTML = '<div style="text-align: center; color: var(--text-tertiary); padding: 40px 0;">请先选择或创建一个角色</div>';
    return;
  }

  const messages = AppState.chatHistory[convId] || [];
  
  if (messages.length === 0) {
    const char = AppState.characters.find(c => c.id == AppState.currentCharacterId);
    container.innerHTML = `
      <div style="text-align: center; padding: 40px 20px;">
        <div style="font-size: 48px; margin-bottom: 16px; opacity: 0.6;">${char?.avatar ? '' : '👋'}</div>
        <div style="color: var(--text-secondary); font-size: 15px;">和${escapeHtml(char?.name || 'AI')}打个招呼吧</div>
      </div>
    `;
    return;
  }

  container.innerHTML = messages.map(msg => renderMessage(msg)).join('');
}

function renderMessage(msg) {
  const isUser = msg.role === 'user';
  const character = AppState.characters.find(c => c.id == AppState.currentCharacterId);
  
  let avatarHtml = '';
  if (isUser) {
    avatarHtml = AppState.user.avatar 
      ? `<img src="${AppState.user.avatar}" alt="我">`
      : '<span class="avatar-placeholder">👤</span>';
  } else {
    avatarHtml = character?.avatar 
      ? `<img src="${character.avatar}" alt="${character.name}">`
      : '<span class="avatar-placeholder">🤖</span>';
  }

  return `
    <div class="message-item ${isUser ? 'user' : 'ai'}">
      <div class="message-avatar">${avatarHtml}</div>
      <div class="message-content">
        <div class="chat-bubble">${msg.content ? escapeHtml(msg.content) : ''}</div>
        ${msg.created_at ? `<div class="message-time">${formatTime(msg.created_at)}</div>` : ''}
      </div>
    </div>
  `;
}

async function sendMessage() {
  const input = document.getElementById('chatInput');
  const text = input.value.trim();
  
  if (!text || AppState.isSending) return;

  if (!AppState.currentCharacterId) {
    showToast('请先选择一个角色');
    return;
  }

  const characterId = AppState.currentCharacterId;
  const character = AppState.characters.find(c => c.id == characterId);
  
  if (!character) {
    showToast('角色不存在');
    return;
  }

  input.value = '';
  input.style.height = 'auto';

  // 获取或创建对话
  let convId = AppState.conversations[characterId];
  if (!convId) {
    try {
      const res = await API.post('/api/conversations', { characterId });
      if (res.success) {
        convId = res.data.id;
        AppState.conversations[characterId] = convId;
        AppState.chatHistory[convId] = [];
        AppState.currentConversationId = convId;
      }
    } catch (err) {
      showToast('创建对话失败');
      return;
    }
  }

  // 添加用户消息到本地
  const userMsg = {
    role: 'user',
    content: text,
    created_at: Date.now()
  };
  
  if (!AppState.chatHistory[convId]) {
    AppState.chatHistory[convId] = [];
  }
  AppState.chatHistory[convId].push(userMsg);
  renderMessages();
  scrollToBottom();

  // 发送AI请求
  AppState.isSending = true;
  await sendAiRequest(character, convId);
  AppState.isSending = false;
}

async function sendAiRequest(character, convId) {
  try {
    // 添加AI消息占位
    const aiMsg = {
      role: 'assistant',
      content: '',
      created_at: Date.now()
    };
    AppState.chatHistory[convId].push(aiMsg);
    renderMessages();
    scrollToBottom();

    // 构建发送给后端的消息（只发送历史消息，不包含AI占位）
    const historyMessages = AppState.chatHistory[convId]
      .filter(m => m.role === 'user' || m.role === 'assistant')
      .filter((m, idx, arr) => !(m.role === 'assistant' && idx === arr.length - 1 && m.content === ''))
      .map(m => ({ role: m.role, content: m.content }));

    const response = await fetch('/api/chat', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${AppState.token}`
      },
      body: JSON.stringify({
        messages: historyMessages,
        characterId: character.id,
        conversationId: convId,
        stream: true
      })
    });

    if (!response.ok) {
      let errData = {};
      try {
        errData = await response.json();
      } catch (e) {}
      
      // 根据错误码显示友好提示
      const errorMsg = getFriendlyError(errData.code, errData.error);
      throw new Error(errorMsg);
    }

    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    let buffer = '';
    let fullContent = '';
    let hasError = false;

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
        if (data === '[DONE]') continue;

        try {
          const parsed = JSON.parse(data);
          
          if (parsed.error) {
            hasError = true;
            const errorMsg = getFriendlyError(parsed.code, parsed.error);
            throw new Error(errorMsg);
          }

          if (parsed.done) {
            // 更新余额
            if (parsed.rice_balance !== undefined) {
              AppState.user.rice_balance = parsed.rice_balance;
              updateRiceDisplay();
            }
            continue;
          }

          if (parsed.content) {
            fullContent += parsed.content;
            // 更新最后一条消息
            const lastMsg = AppState.chatHistory[convId][AppState.chatHistory[convId].length - 1];
            if (lastMsg && lastMsg.role === 'assistant') {
              lastMsg.content = fullContent;
              updateLastMessage();
              scrollToBottom();
            }
          }
        } catch (e) {
          if (hasError) throw e;
          // 忽略解析错误
        }
      }
    }

    // 如果没有内容，可能是流式失败了
    if (!fullContent) {
      throw new Error('未收到回复，请重试');
    }

  } catch (err) {
    console.error('AI请求失败:', err);
    showToast(err.message);
    
    // 移除失败的AI消息
    const msgs = AppState.chatHistory[convId];
    if (msgs && msgs.length > 0 && msgs[msgs.length - 1].role === 'assistant') {
      msgs.pop();
      renderMessages();
    }
  }
}

/**
 * 根据错误码返回友好的错误提示
 */
function getFriendlyError(code, defaultMsg) {
  const errorMap = {
    'API_KEY_ERROR': 'API密钥错误，请检查配置',
    'API_URL_ERROR': 'API地址无法连接，请检查地址配置',
    'API_BALANCE_ERROR': 'API余额不足，请联系管理员',
    'API_MODEL_ERROR': '模型不存在，请检查模型配置',
    'API_RATE_LIMIT': '请求过于频繁，请稍后再试',
    'API_SERVER_ERROR': 'API服务暂不可用，请稍后重试',
    'API_NOT_CONFIGURED': '服务未配置API，请联系管理员',
    'RICE_NOT_ENOUGH': '米粒不足，请充值',
    'NOT_LOGGED_IN': '请先登录',
    'TOKEN_EXPIRED': '登录已过期，请重新登录',
    'NETWORK_ERROR': '网络异常，请重试'
  };
  return errorMap[code] || defaultMsg || '请求失败，请重试';
}

function updateLastMessage() {
  const container = document.getElementById('chatMessages');
  const messages = container.querySelectorAll('.message-item');
  const lastMsg = messages[messages.length - 1];
  if (lastMsg) {
    const convId = AppState.currentConversationId;
    const msgs = AppState.chatHistory[convId];
    const lastAiMsg = msgs[msgs.length - 1];
    if (lastAiMsg) {
      const bubble = lastMsg.querySelector('.chat-bubble');
      if (bubble) {
        bubble.textContent = lastAiMsg.content;
      }
    }
  }
}

function scrollToBottom() {
  const container = document.getElementById('chatMessages');
  container.scrollTop = container.scrollHeight;
}

// ==================== 兑换码功能 ====================
function openRedeemCode() {
  document.getElementById('redeemCodeInput').value = '';
  openModal('modalRedeemCode');
}

async function handleRedeemCode() {
  const code = document.getElementById('redeemCodeInput').value.trim();
  
  if (!code) {
    showToast('请输入兑换码');
    return;
  }

  try {
    const res = await API.post('/api/code/redeem', { code });
    if (res.success) {
      AppState.user.rice_balance = res.data.rice_balance;
      updateRiceDisplay();
      showToast(`兑换成功！获得 ${res.data.rice_amount} 米粒`);
      closeModal('modalRedeemCode');
    }
  } catch (err) {
    showToast(err.message);
  }
}

// ==================== 角色管理 ====================
function renderCharacters() {
  const container = document.getElementById('characterList');
  const empty = document.getElementById('characterEmpty');
  
  if (AppState.characters.length === 0) {
    container.innerHTML = '';
    empty.style.display = 'block';
    return;
  }

  empty.style.display = 'none';
  container.innerHTML = AppState.characters.map(char => `
    <div class="character-card" data-id="${char.id}">
      <div class="character-avatar">
        ${char.avatar ? `<img src="${char.avatar}" alt="${char.name}">` : '<span class="avatar-placeholder">👤</span>'}
      </div>
      <div class="character-info">
        <div class="character-name">${escapeHtml(char.name)}</div>
        <div class="character-desc">${escapeHtml(char.description || '暂无简介')}</div>
      </div>
      <div class="character-actions">
        <button class="icon-btn small" onclick="editCharacter(${char.id})" title="编辑">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
            <path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/>
            <path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"/>
          </svg>
        </button>
        <button class="icon-btn small" onclick="deleteCharacter(${char.id})" title="删除">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
            <polyline points="3 6 5 6 21 6"/>
            <path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/>
          </svg>
        </button>
      </div>
    </div>
  `).join('');
}

let editingCharacterId = null;

function openCharacterEdit(characterId = null) {
  editingCharacterId = characterId;
  const title = characterId ? '编辑角色' : '创建角色';
  document.getElementById('characterEditTitle').textContent = title;

  if (characterId) {
    const char = AppState.characters.find(c => c.id == characterId);
    if (char) {
      document.getElementById('characterName').value = char.name;
      document.getElementById('characterDesc').value = char.description || '';
      document.getElementById('characterPrompt').value = char.persona || '';
      document.getElementById('characterTags').value = (char.tags || []).join(', ');
      document.getElementById('characterPublic').checked = char.isPublic;
      
      const preview = document.getElementById('characterAvatarPreview');
      if (char.avatar) {
        preview.innerHTML = `<img src="${char.avatar}" alt="头像">`;
      } else {
        preview.innerHTML = '<span class="avatar-placeholder">👤</span>';
      }
    }
  } else {
    document.getElementById('characterName').value = '';
    document.getElementById('characterDesc').value = '';
    document.getElementById('characterPrompt').value = '';
    document.getElementById('characterTags').value = '';
    document.getElementById('characterPublic').checked = false;
    document.getElementById('characterAvatarPreview').innerHTML = '<span class="avatar-placeholder">👤</span>';
  }

  openModal('modalCharacterEdit');
}

function editCharacter(id) {
  openCharacterEdit(id);
}

async function saveCharacter() {
  const name = document.getElementById('characterName').value.trim();
  const description = document.getElementById('characterDesc').value.trim();
  const persona = document.getElementById('characterPrompt').value.trim();
  const tagsStr = document.getElementById('characterTags').value.trim();
  const isPublic = document.getElementById('characterPublic').checked;
  const avatar = document.getElementById('characterAvatarPreview').querySelector('img')?.src || '';

  if (!name) {
    showToast('请输入角色名称');
    return;
  }

  if (!persona) {
    showToast('请输入角色人设');
    return;
  }

  const tags = tagsStr ? tagsStr.split(/[,，]/).map(t => t.trim()).filter(t => t) : [];

  try {
    if (editingCharacterId) {
      // 更新
      await API.put(`/api/characters/${editingCharacterId}`, {
        name, avatar, persona, description, tags, isPublic
      });
      
      // 更新本地状态
      const index = AppState.characters.findIndex(c => c.id == editingCharacterId);
      if (index !== -1) {
        AppState.characters[index] = { ...AppState.characters[index], name, avatar, persona, description, tags, isPublic };
      }
      
      showToast('角色已更新');
    } else {
      // 创建
      const res = await API.post('/api/characters', {
        name, avatar, persona, description, tags, isPublic
      });
      
      if (res.success) {
        const newChar = {
          id: res.data.id,
          name, avatar, persona, description, tags, isPublic,
          created_at: Date.now()
        };
        AppState.characters.unshift(newChar);
        showToast('角色创建成功');
      }
    }

    closeModal('modalCharacterEdit');
    renderCharacters();
    renderCharacterSwitcher();
  } catch (err) {
    showToast(err.message);
  }
}

function deleteCharacter(id) {
  const char = AppState.characters.find(c => c.id == id);
  showConfirm(`确定要删除「${char?.name || '该角色'}」吗？删除后对话记录也会一并删除。`, async () => {
    try {
      await API.delete(`/api/characters/${id}`);
      
      AppState.characters = AppState.characters.filter(c => c.id != id);
      delete AppState.conversations[id];
      
      if (AppState.currentCharacterId == id) {
        AppState.currentCharacterId = null;
        AppState.currentConversationId = null;
        if (AppState.characters.length > 0) {
          switchCharacter(AppState.characters[0].id);
        } else {
          renderMessages();
        }
      }
      
      renderCharacters();
      renderCharacterSwitcher();
      showToast('角色已删除');
    } catch (err) {
      showToast(err.message);
    }
  });
}

function handleCharacterAvatar(e) {
  const file = e.target.files[0];
  if (!file) return;
  const reader = new FileReader();
  reader.onload = (event) => {
    document.getElementById('characterAvatarPreview').innerHTML = `<img src="${event.target.result}" alt="头像">`;
  };
  reader.readAsDataURL(file);
}

// ==================== 社区功能 ====================
let currentDetailCharacter = null;

async function loadCommunityCharacters() {
  try {
    const params = new URLSearchParams({
      page: 1,
      sort: AppState.communitySort,
      search: AppState.communitySearch
    });
    
    const res = await API.get(`/api/community/characters?${params}`);
    if (res.success) {
      renderCommunityList(res.data.list);
    }
  } catch (err) {
    console.error('加载社区角色失败:', err);
  }
}

function renderCommunityList(characters) {
  const container = document.getElementById('communityList');
  
  if (characters.length === 0) {
    container.innerHTML = '<div style="text-align: center; padding: 40px 0; color: var(--text-tertiary);">暂无角色</div>';
    return;
  }

  container.innerHTML = characters.map(char => `
    <div class="community-card" data-id="${char.id}" onclick="openCharacterDetail(${char.id})">
      <div class="community-avatar">
        ${char.avatar ? `<img src="${char.avatar}" alt="${char.name}">` : '<span class="avatar-placeholder">👤</span>'}
      </div>
      <div class="community-info">
        <div class="community-name">${escapeHtml(char.name)}</div>
        <div class="community-desc">${escapeHtml(char.description || '暂无简介')}</div>
        <div class="community-tags">
          ${(char.tags || []).slice(0, 3).map(tag => `<span class="tag">${escapeHtml(tag)}</span>`).join('')}
        </div>
      </div>
      <div class="community-likes">
        <svg viewBox="0 0 24 24" fill="currentColor">
          <path d="M20.84 4.61a5.5 5.5 0 0 0-7.78 0L12 5.67l-1.06-1.06a5.5 5.5 0 0 0-7.78 7.78l1.06 1.06L12 21.23l7.78-7.78 1.06-1.06a5.5 5.5 0 0 0 0-7.78z"/>
        </svg>
        ${char.likes}
      </div>
    </div>
  `).join('');
}

async function openCharacterDetail(id) {
  try {
    const res = await API.get(`/api/community/characters/${id}`);
    if (res.success) {
      currentDetailCharacter = res.data;
      
      document.getElementById('detailName').textContent = res.data.name;
      document.getElementById('detailDesc').textContent = res.data.description || '';
      document.getElementById('detailAuthor').textContent = res.data.author;
      document.getElementById('detailLikes').textContent = res.data.likes;
      document.getElementById('detailPrompt').textContent = res.data.persona || '';
      
      const avatar = document.getElementById('detailAvatar');
      if (res.data.avatar) {
        avatar.innerHTML = `<img src="${res.data.avatar}" alt="${res.data.name}">`;
      } else {
        avatar.innerHTML = '<span class="avatar-placeholder">👤</span>';
      }
      
      const tagsContainer = document.getElementById('detailTags');
      tagsContainer.innerHTML = (res.data.tags || []).map(tag => 
        `<span class="tag">${escapeHtml(tag)}</span>`
      ).join('');
      
      openModal('modalCharacterDetail');
    }
  } catch (err) {
    showToast(err.message);
  }
}

async function importCharacter() {
  if (!currentDetailCharacter) return;

  try {
    const res = await API.post('/api/characters', {
      name: currentDetailCharacter.name,
      avatar: currentDetailCharacter.avatar,
      persona: currentDetailCharacter.persona,
      description: currentDetailCharacter.description,
      tags: currentDetailCharacter.tags,
      isPublic: false
    });

    if (res.success) {
      const newChar = {
        id: res.data.id,
        name: currentDetailCharacter.name,
        avatar: currentDetailCharacter.avatar,
        persona: currentDetailCharacter.persona,
        description: currentDetailCharacter.description,
        tags: currentDetailCharacter.tags,
        isPublic: false,
        created_at: Date.now()
      };
      AppState.characters.unshift(newChar);
      
      closeModal('modalCharacterDetail');
      renderCharacters();
      renderCharacterSwitcher();
      showToast('角色导入成功');
      
      // 点赞
      try {
        await API.post(`/api/community/like/${currentDetailCharacter.id}`);
      } catch (e) {}
    }
  } catch (err) {
    showToast(err.message);
  }
}

// ==================== 个人中心 ====================
function renderProfile() {
  document.getElementById('profileNickname').textContent = AppState.user.nickname || '新用户';
  document.getElementById('profileDesc').textContent = AppState.user.description || '点击编辑个人资料';
  
  const avatar = document.getElementById('profileAvatar');
  if (AppState.user.avatar) {
    avatar.innerHTML = `<img src="${AppState.user.avatar}" alt="头像">`;
  } else {
    avatar.innerHTML = '<span class="avatar-placeholder">👤</span>';
  }

  updateRiceDisplay();
}

function updateRiceDisplay() {
  document.getElementById('riceAmount').textContent = AppState.user.rice_balance || 0;
}

function openProfileEdit() {
  document.getElementById('profileNicknameInput').value = AppState.user.nickname || '';
  document.getElementById('profileDescInput').value = AppState.user.description || '';
  
  const preview = document.getElementById('profileAvatarPreview');
  if (AppState.user.avatar) {
    preview.innerHTML = `<img src="${AppState.user.avatar}" alt="头像">`;
  } else {
    preview.innerHTML = '<span class="avatar-placeholder">👤</span>';
  }
  
  openModal('modalProfileEdit');
}

async function saveProfile() {
  const nickname = document.getElementById('profileNicknameInput').value.trim();
  const description = document.getElementById('profileDescInput').value.trim();
  const avatar = document.getElementById('profileAvatarPreview').querySelector('img')?.src || '';

  try {
    const res = await API.post('/api/user/update', { nickname, description, avatar });
    if (res.success) {
      AppState.user = { ...AppState.user, ...res.data };
      renderProfile();
      closeModal('modalProfileEdit');
      showToast('资料已更新');
    }
  } catch (err) {
    showToast(err.message);
  }
}

function handleProfileAvatar(e) {
  const file = e.target.files[0];
  if (!file) return;
  const reader = new FileReader();
  reader.onload = (event) => {
    document.getElementById('profileAvatarPreview').innerHTML = `<img src="${event.target.result}" alt="头像">`;
  };
  reader.readAsDataURL(file);
}

// ==================== 充值相关 ====================
async function openRecharge() {
  try {
    const res = await API.get('/api/recharge/tiers');
    if (res.success) {
      AppState.rechargeTiers = res.data;
      renderRechargeTiers(res.data);
    }
  } catch (err) {
    showToast(err.message);
  }
  
  document.getElementById('rechargeBalance').textContent = AppState.user.rice_balance || 0;
  openModal('modalRecharge');
}

function renderRechargeTiers(tiers) {
  const container = document.getElementById('rechargeTiers');
  container.innerHTML = tiers.map((tier, index) => `
    <div class="recharge-tier" onclick="handleRecharge(${index})">
      <div class="recharge-tier-rice">
        ${tier.rice}
        ${tier.bonus > 0 ? `<span class="recharge-bonus">+${tier.bonus}</span>` : ''}
      </div>
      <div class="recharge-tier-price">¥${tier.price}</div>
    </div>
  `).join('');
}

function handleRecharge(tierIndex) {
  const tier = AppState.rechargeTiers[tierIndex];
  if (!tier) return;
  
  // 显示支付弹窗
  document.getElementById('paymentAmount').textContent = tier.price;
  document.getElementById('paymentRice').textContent = tier.rice + tier.bonus;
  document.getElementById('paymentUserId').textContent = AppState.user.id;
  
  // 重置步骤
  document.getElementById('paymentStep1').style.display = 'block';
  document.getElementById('paymentStep2').style.display = 'none';
  
  closeModal('modalRecharge');
  openModal('modalPayment');
}

async function submitRechargeApply() {
  const btn = document.getElementById('btnSubmitRecharge');
  btn.disabled = true;
  btn.textContent = '提交中...';
  
  try {
    // 找到当前选中的档位（通过金额匹配）
    const amount = parseFloat(document.getElementById('paymentAmount').textContent);
    const tier = AppState.rechargeTiers.find(t => t.price === amount);
    
    if (!tier) {
      showToast('充值档位错误');
      return;
    }
    
    const res = await API.post('/api/recharge/apply', { 
      tierIndex: AppState.rechargeTiers.indexOf(tier) 
    });
    
    if (res.success) {
      // 显示成功步骤
      document.getElementById('paymentStep1').style.display = 'none';
      document.getElementById('paymentStep2').style.display = 'block';
      document.getElementById('paymentOrderNo').textContent = res.data.order_no;
    }
  } catch (err) {
    showToast(err.message);
  } finally {
    btn.disabled = false;
    btn.textContent = '我已付款，提交申请';
  }
}

async function openRiceDetail() {
  document.getElementById('riceSummaryBalance').textContent = AppState.user.rice_balance || 0;
  AppState.txFilterType = 'all';
  await loadTransactions();
  openModal('modalRiceDetail');
}

async function loadTransactions() {
  try {
    const params = new URLSearchParams();
    if (AppState.txFilterType !== 'all') {
      params.set('type', AppState.txFilterType);
    }
    
    const res = await API.get(`/api/user/transactions?${params}`);
    if (res.success) {
      renderTransactions(res.data);
    }
  } catch (err) {
    console.error('加载交易记录失败:', err);
  }
}

function renderTransactions(transactions) {
  const container = document.getElementById('transactionList');
  
  if (transactions.length === 0) {
    container.innerHTML = '<div style="text-align: center; padding: 40px 0; color: var(--text-tertiary);">暂无记录</div>';
    return;
  }

  container.innerHTML = transactions.map(tx => `
    <div class="transaction-item">
      <div class="transaction-info">
        <div class="transaction-desc">${escapeHtml(tx.description)}</div>
        <div class="transaction-time">${formatTime(tx.created_at)}</div>
      </div>
      <div class="transaction-amount ${tx.type === 'recharge' ? 'positive' : 'negative'}">
        ${tx.type === 'recharge' ? '+' : '-'}${tx.amount}
      </div>
    </div>
  `).join('');
}

async function openOrders() {
  try {
    const res = await API.get('/api/recharge/orders');
    if (res.success) {
      renderOrders(res.data.list || res.data);
    }
  } catch (err) {
    showToast(err.message);
  }
  openModal('modalOrders');
}

function renderOrders(orders) {
  const container = document.getElementById('orderList');
  
  if (orders.length === 0) {
    container.innerHTML = '<div style="text-align: center; padding: 40px 0; color: var(--text-tertiary);">暂无订单</div>';
    return;
  }

  const statusMap = {
    pending: { text: '待确认', class: 'pending' },
    completed: { text: '已完成', class: 'completed' },
    rejected: { text: '已拒绝', class: 'rejected' }
  };

  container.innerHTML = orders.map(order => {
    const status = statusMap[order.status] || { text: order.status, class: '' };
    return `
    <div class="order-item">
      <div class="order-info">
        <div class="order-no">订单号：${order.order_no || order.id}</div>
        <div class="order-time">${formatTime(order.created_at)}</div>
        ${order.process_remark ? `<div class="order-remark" style="font-size: 12px; color: #999; margin-top: 4px;">${escapeHtml(order.process_remark)}</div>` : ''}
      </div>
      <div class="order-amount">
        <div class="order-rice">${order.rice_amount} 米粒</div>
        <div class="order-price">¥${order.amount}</div>
      </div>
      <div class="order-status ${status.class}">
        ${status.text}
      </div>
    </div>
  `}).join('');
}

// ==================== 自定义装扮 ====================
function openTheme() {
  document.getElementById('cssUi').value = AppState.themeConfig.uiCss || '';
  document.getElementById('cssBubble').value = AppState.themeConfig.bubbleCss || '';
  document.getElementById('wallpaperOpacity').value = AppState.themeConfig.wallpaperOpacity || 30;
  document.getElementById('wallpaperOpacityValue').textContent = (AppState.themeConfig.wallpaperOpacity || 30) + '%';
  document.getElementById('wallpaperBlur').value = AppState.themeConfig.wallpaperBlur || 0;
  document.getElementById('wallpaperBlurValue').textContent = (AppState.themeConfig.wallpaperBlur || 0) + 'px';
  
  openModal('modalTheme');
}

function switchThemeTab(tab) {
  document.querySelectorAll('.theme-tab').forEach(t => t.classList.remove('active'));
  document.querySelector(`.theme-tab[data-theme-tab="${tab}"]`).classList.add('active');
  
  document.querySelectorAll('.theme-panel').forEach(p => p.classList.remove('active'));
  document.getElementById('themePanel' + tab.charAt(0).toUpperCase() + tab.slice(1)).classList.add('active');
}

function applyUiCss() {
  const css = document.getElementById('cssUi').value;
  const sanitized = sanitizeCss(css);
  AppState.themeConfig.uiCss = sanitized;
  document.getElementById('customUiStyle').textContent = sanitized;
  saveThemeToStorage();
  showToast('样式已应用');
}

function resetUiCss() {
  AppState.themeConfig.uiCss = '';
  document.getElementById('customUiStyle').textContent = '';
  document.getElementById('cssUi').value = '';
  saveThemeToStorage();
  showToast('已重置');
}

function applyBubbleCss() {
  const css = document.getElementById('cssBubble').value;
  const sanitized = sanitizeCss(css);
  AppState.themeConfig.bubbleCss = sanitized;
  document.getElementById('customBubbleStyle').textContent = `.chat-bubble { ${sanitized} }`;
  saveThemeToStorage();
  showToast('气泡样式已应用');
}

function resetBubbleCss() {
  AppState.themeConfig.bubbleCss = '';
  document.getElementById('customBubbleStyle').textContent = '';
  document.getElementById('cssBubble').value = '';
  saveThemeToStorage();
  showToast('已重置');
}

function handleWallpaperUpload(e) {
  const file = e.target.files[0];
  if (!file) return;
  const reader = new FileReader();
  reader.onload = (event) => {
    AppState.themeConfig.wallpaper = event.target.result;
    showToast('壁纸已选择，点击应用生效');
  };
  reader.readAsDataURL(file);
}

function applyWallpaper() {
  const opacity = parseInt(document.getElementById('wallpaperOpacity').value);
  const blur = parseInt(document.getElementById('wallpaperBlur').value);
  
  AppState.themeConfig.wallpaperOpacity = opacity;
  AppState.themeConfig.wallpaperBlur = blur;
  
  applyWallpaperStyle();
  saveThemeToStorage();
  showToast('壁纸已应用');
}

function resetWallpaper() {
  AppState.themeConfig.wallpaper = '';
  AppState.themeConfig.wallpaperOpacity = 30;
  AppState.themeConfig.wallpaperBlur = 0;
  
  document.getElementById('wallpaperOpacity').value = 30;
  document.getElementById('wallpaperOpacityValue').textContent = '30%';
  document.getElementById('wallpaperBlur').value = 0;
  document.getElementById('wallpaperBlurValue').textContent = '0px';
  
  applyWallpaperStyle();
  saveThemeToStorage();
  showToast('已重置');
}

function applyWallpaperStyle() {
  const chatPage = document.getElementById('page-chat');
  const chatMessages = document.getElementById('chatMessages');
  
  if (AppState.themeConfig.wallpaper) {
    chatMessages.style.backgroundImage = `url(${AppState.themeConfig.wallpaper})`;
    chatMessages.style.backgroundSize = 'cover';
    chatMessages.style.backgroundPosition = 'center';
    chatMessages.style.opacity = 1;
    
    // 使用伪元素方式实现透明度
    chatMessages.style.setProperty('--wallpaper-opacity', AppState.themeConfig.wallpaperOpacity / 100);
    chatMessages.style.setProperty('--wallpaper-blur', AppState.themeConfig.wallpaperBlur + 'px');
  } else {
    chatMessages.style.backgroundImage = '';
  }
}

function applyThemeConfig() {
  if (AppState.themeConfig.uiCss) {
    document.getElementById('customUiStyle').textContent = AppState.themeConfig.uiCss;
  }
  if (AppState.themeConfig.bubbleCss) {
    document.getElementById('customBubbleStyle').textContent = `.chat-bubble { ${AppState.themeConfig.bubbleCss} }`;
  }
  if (AppState.themeConfig.wallpaper) {
    setTimeout(applyWallpaperStyle, 100);
  }
}

// ==================== 工具函数 ====================
function showToast(message, duration = 2000) {
  const toast = document.getElementById('toast');
  toast.textContent = message;
  toast.classList.add('show');
  
  setTimeout(() => {
    toast.classList.remove('show');
  }, duration);
}

function openModal(modalId) {
  document.getElementById(modalId).classList.add('active');
}

function closeModal(modalId) {
  document.getElementById(modalId).classList.remove('active');
}

function showConfirm(message, onOk, onCancel) {
  document.getElementById('confirmMessage').textContent = message;
  window._confirmOk = onOk;
  window._confirmCancel = onCancel;
  openModal('modalConfirm');
}

function formatTime(timestamp) {
  const date = new Date(timestamp);
  const now = new Date();
  const diff = now - date;
  
  if (diff < 60000) {
    return '刚刚';
  } else if (diff < 3600000) {
    return Math.floor(diff / 60000) + '分钟前';
  } else if (diff < 86400000) {
    return Math.floor(diff / 3600000) + '小时前';
  } else if (diff < 604800000) {
    return Math.floor(diff / 86400000) + '天前';
  } else {
    return date.getFullYear() + '-' + 
      (date.getMonth() + 1).toString().padStart(2, '0') + '-' + 
      date.getDate().toString().padStart(2, '0');
  }
}

function escapeHtml(text) {
  const div = document.createElement('div');
  div.textContent = text;
  return div.innerHTML;
}

function debounce(func, wait) {
  let timeout;
  return function(...args) {
    clearTimeout(timeout);
    timeout = setTimeout(() => func.apply(this, args), wait);
  };
}

function sanitizeCss(css) {
  if (!css) return '';
  // 移除危险内容
  let sanitized = css.replace(/<script[^>]*>[\s\S]*?<\/script>/gi, '');
  sanitized = sanitized.replace(/javascript:/gi, '');
  sanitized = sanitized.replace(/on\w+\s*=/gi, '');
  sanitized = sanitized.replace(/expression\s*\(/gi, '');
  return sanitized;
}
