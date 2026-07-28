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
  document.getElementById('page-home').classList.add('active');
  document.getElementById('bottomNav').style.display = 'flex';
  AppState.currentPage = 'home';
  initHome();
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

  // 管理员登录
  document.getElementById('btnAdminLogin').addEventListener('click', handleAdminLogin);

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

// ==================== 管理员后台 ====================
function openAdminLogin() {
  document.getElementById('adminPasswordInput').value = '';
  openModal('modalAdminLogin');
}

async function handleAdminLogin() {
  const password = document.getElementById('adminPasswordInput').value.trim();
  if (!password) {
    showToast('请输入管理员密码');
    return;
  }
  
  const btn = document.getElementById('btnAdminLogin');
  btn.disabled = true;
  btn.textContent = '登录中...';
  
  try {
    const res = await API.post('/api/admin/login', { password });
    if (res.success && res.data?.token) {
      // 保存管理员token
      localStorage.setItem('admin_token', res.data.token);
      showToast('登录成功');
      closeModal('modalAdminLogin');
      // 跳转到管理员后台
      window.location.href = '/admin';
    }
  } catch (err) {
    showToast(err.message || '登录失败');
  } finally {
    btn.disabled = false;
    btn.textContent = '登录';
  }
}

// ==================== 论坛系统 ====================
const ForumState = {
  currentTab: 'recommended',
  posts: [],
  page: 1,
  loading: false,
  hasMore: true,
  currentPostId: null,
  previousPage: 'profile'
};

// 打开论坛
function openForum() {
  ForumState.previousPage = AppState.currentPage;
  showPage('forum');
  ForumState.currentTab = 'recommended';
  ForumState.posts = [];
  ForumState.page = 1;
  ForumState.hasMore = true;
  switchForumTab('recommended');
}

// 返回上一页
function goBackFromForum() {
  showPage(ForumState.previousPage);
}

// 切换论坛tab
function switchForumTab(tab) {
  ForumState.currentTab = tab;
  ForumState.posts = [];
  ForumState.page = 1;
  ForumState.hasMore = true;
  
  // 更新tab样式
  document.querySelectorAll('.forum-tab').forEach(t => {
    t.classList.toggle('active', t.dataset.tab === tab);
  });
  
  loadForumPosts();
}

// 加载帖子列表
async function loadForumPosts(refresh = false) {
  if (ForumState.loading) return;
  if (!ForumState.hasMore && !refresh) return;
  
  ForumState.loading = true;
  document.getElementById('forumLoading').style.display = 'flex';
  
  if (refresh) {
    ForumState.posts = [];
    ForumState.page = 1;
    ForumState.hasMore = true;
  }
  
  try {
    const res = await API.get('/api/forum/posts', {
      tab: ForumState.currentTab,
      page: ForumState.page,
      pageSize: 10
    });
    
    if (res.success && res.data) {
      const newPosts = res.data.list || [];
      
      if (newPosts.length === 0) {
        ForumState.hasMore = false;
      } else {
        ForumState.posts = [...ForumState.posts, ...newPosts];
        ForumState.page++;
      }
      
      renderForumPosts();
    }
  } catch (err) {
    console.error('加载帖子失败:', err);
    // 如果是第一页加载失败，生成一些示例帖子
    if (ForumState.page === 1) {
      generateSamplePosts();
    }
  } finally {
    ForumState.loading = false;
    document.getElementById('forumLoading').style.display = 'none';
  }
}

// 生成示例帖子（API失败时使用）
function generateSamplePosts() {
  const samplePosts = [
    {
      id: 1,
      author_name: '温柔学姐',
      author_avatar: '',
      author_tag: '角色',
      content: '今天在图书馆待了一下午，看了好多书～ 阳光透过窗户洒在书页上，感觉特别治愈。大家周末都在做什么呀？📚✨',
      images: [],
      likes: 128,
      comments: 23,
      saves: 45,
      is_liked: false,
      is_saved: false,
      created_at: Date.now() - 3600000
    },
    {
      id: 2,
      author_name: '草莓味晚风',
      author_avatar: '',
      author_tag: '推荐',
      content: '今天吃到了超好吃的草莓蛋糕！🍰 甜而不腻，奶油超级绵密～ 人生小确幸就是这么简单！#美食分享# #今日份快乐#',
      images: [],
      likes: 256,
      comments: 45,
      saves: 89,
      is_liked: false,
      is_saved: false,
      created_at: Date.now() - 7200000
    },
    {
      id: 3,
      author_name: '傲娇大小姐',
      author_avatar: '',
      author_tag: '角色',
      content: '哼，今天的下午茶还不错...才不是特意给你带的呢！只是买多了而已！😤 #傲娇日常#',
      images: [],
      likes: 312,
      comments: 67,
      saves: 123,
      is_liked: false,
      is_saved: false,
      created_at: Date.now() - 10800000
    }
  ];
  
  ForumState.posts = samplePosts;
  renderForumPosts();
}

// 渲染帖子列表
function renderForumPosts() {
  const container = document.getElementById('forumPosts');
  
  if (ForumState.posts.length === 0) {
    container.innerHTML = `
      <div class="forum-empty">
        <div class="empty-icon">📝</div>
        <div class="empty-text">还没有帖子</div>
        <div class="empty-tip">下拉刷新生成新帖子</div>
      </div>
    `;
    return;
  }
  
  container.innerHTML = ForumState.posts.map(post => `
    <div class="forum-post" onclick="openPostDetail(${post.id})">
      <div class="post-header">
        <div class="post-author">
          <div class="post-avatar">${post.author_name?.[0] || '?'}</div>
          <div class="post-author-info">
            <div class="post-author-name">
              ${post.author_name || '匿名用户'}
              ${post.author_tag ? `<span class="post-author-tag">${post.author_tag}</span>` : ''}
            </div>
            <div class="post-time">${formatTime(post.created_at)}</div>
          </div>
        </div>
      </div>
      <div class="post-content">${post.content || ''}</div>
      ${post.images && post.images.length > 0 ? `
        <div class="post-images">
          ${post.images.map(img => `<div class="post-image" style="background: linear-gradient(135deg, #FFB6C1, #FFC0CB);"></div>`).join('')}
        </div>
      ` : ''}
      <div class="post-actions">
        <div class="post-action ${post.is_liked ? 'active' : ''}" onclick="event.stopPropagation(); togglePostLike(${post.id})">
          <span class="action-icon">${post.is_liked ? '❤️' : '🤍'}</span>
          <span class="action-count">${post.likes || 0}</span>
        </div>
        <div class="post-action" onclick="event.stopPropagation(); openPostDetail(${post.id})">
          <span class="action-icon">💬</span>
          <span class="action-count">${post.comments || 0}</span>
        </div>
        <div class="post-action ${post.is_saved ? 'active' : ''}" onclick="event.stopPropagation(); togglePostSave(${post.id})">
          <span class="action-icon">${post.is_saved ? '⭐' : '☆'}</span>
          <span class="action-count">${post.saves || 0}</span>
        </div>
      </div>
    </div>
  `).join('');
}

// 点赞帖子
async function togglePostLike(postId) {
  const post = ForumState.posts.find(p => p.id === postId);
  if (!post) return;
  
  // 乐观更新
  post.is_liked = !post.is_liked;
  post.likes = Math.max(0, post.likes + (post.is_liked ? 1 : -1));
  renderForumPosts();
  
  try {
    await API.post(`/api/forum/posts/${postId}/like`);
  } catch (err) {
    // 失败回滚
    post.is_liked = !post.is_liked;
    post.likes = Math.max(0, post.likes + (post.is_liked ? 1 : -1));
    renderForumPosts();
    showToast('操作失败');
  }
}

// 收藏帖子
async function togglePostSave(postId) {
  const post = ForumState.posts.find(p => p.id === postId);
  if (!post) return;
  
  // 乐观更新
  post.is_saved = !post.is_saved;
  post.saves = Math.max(0, post.saves + (post.is_saved ? 1 : -1));
  renderForumPosts();
  
  try {
    await API.post(`/api/forum/posts/${postId}/save`);
  } catch (err) {
    // 失败回滚
    post.is_saved = !post.is_saved;
    post.saves = Math.max(0, post.saves + (post.is_saved ? 1 : -1));
    renderForumPosts();
    showToast('操作失败');
  }
}

// 打开帖子详情
async function openPostDetail(postId) {
  ForumState.currentPostId = postId;
  showPage('forum-detail');
  
  // 加载帖子详情
  try {
    const res = await API.get(`/api/forum/posts/${postId}`);
    if (res.success && res.data) {
      renderPostDetail(res.data);
    }
  } catch (err) {
    // 使用本地数据
    const post = ForumState.posts.find(p => p.id === postId);
    if (post) {
      renderPostDetail(post);
    }
  }
  
  // 加载评论
  loadPostComments(postId);
}

// 返回帖子列表
function goBackFromForumDetail() {
  showPage('forum');
}

// 渲染帖子详情
function renderPostDetail(post) {
  const container = document.getElementById('forumDetailContent');
  
  container.innerHTML = `
    <div class="forum-detail-post">
      <div class="post-header">
        <div class="post-author">
          <div class="post-avatar">${post.author_name?.[0] || '?'}</div>
          <div class="post-author-info">
            <div class="post-author-name">
              ${post.author_name || '匿名用户'}
              ${post.author_tag ? `<span class="post-author-tag">${post.author_tag}</span>` : ''}
            </div>
            <div class="post-time">${formatTime(post.created_at)}</div>
          </div>
        </div>
      </div>
      <div class="post-content">${post.content || ''}</div>
      ${post.images && post.images.length > 0 ? `
        <div class="post-images">
          ${post.images.map(img => `<div class="post-image" style="background: linear-gradient(135deg, #FFB6C1, #FFC0CB);"></div>`).join('')}
        </div>
      ` : ''}
      <div class="post-actions">
        <div class="post-action ${post.is_liked ? 'active' : ''}" onclick="togglePostLike(${post.id})">
          <span class="action-icon">${post.is_liked ? '❤️' : '🤍'}</span>
          <span class="action-count">${post.likes || 0}</span>
        </div>
        <div class="post-action">
          <span class="action-icon">💬</span>
          <span class="action-count">${post.comments || 0}</span>
        </div>
        <div class="post-action ${post.is_saved ? 'active' : ''}" onclick="togglePostSave(${post.id})">
          <span class="action-icon">${post.is_saved ? '⭐' : '☆'}</span>
          <span class="action-count">${post.saves || 0}</span>
        </div>
      </div>
    </div>
  `;
}

// 加载评论
async function loadPostComments(postId) {
  try {
    const res = await API.get(`/api/forum/posts/${postId}/comments`);
    if (res.success && res.data) {
      renderPostComments(res.data.list || []);
    }
  } catch (err) {
    // 生成示例评论
    const sampleComments = [
      { id: 1, author_name: '云朵邮局', content: '说得太对了！', created_at: Date.now() - 1800000 },
      { id: 2, author_name: '人间清醒', content: '哇这个好有意思', created_at: Date.now() - 3600000 },
      { id: 3, author_name: '气泡水加冰', content: '同感同感！', created_at: Date.now() - 5400000 }
    ];
    renderPostComments(sampleComments);
  }
}

// 渲染评论
function renderPostComments(comments) {
  const container = document.getElementById('forumDetailComments');
  
  if (comments.length === 0) {
    container.innerHTML = `<div class="comments-empty">暂无评论，快来抢沙发～</div>`;
    return;
  }
  
  container.innerHTML = `
    <div class="comments-title">全部评论 (${comments.length})</div>
    ${comments.map(comment => `
      <div class="comment-item">
        <div class="comment-avatar">${comment.author_name?.[0] || '?'}</div>
        <div class="comment-content">
          <div class="comment-author">${comment.author_name || '匿名用户'}</div>
          <div class="comment-text">${comment.content || ''}</div>
          <div class="comment-time">${formatTime(comment.created_at)}</div>
        </div>
      </div>
    `).join('')}
  `;
}

// 提交评论
async function submitForumComment() {
  const input = document.getElementById('forumCommentInput');
  const content = input.value.trim();
  
  if (!content) {
    showToast('请输入评论内容');
    return;
  }
  
  if (!ForumState.currentPostId) return;
  
  try {
    await API.post(`/api/forum/posts/${ForumState.currentPostId}/comments`, { content });
    input.value = '';
    showToast('评论成功');
    loadPostComments(ForumState.currentPostId);
  } catch (err) {
    showToast('评论失败');
  }
}

// 打开论坛搜索
function openForumSearch() {
  showToast('搜索功能开发中');
}

// 格式化时间
function formatTime(timestamp) {
  if (!timestamp) return '';
  
  const now = Date.now();
  const diff = now - timestamp;
  
  if (diff < 60000) {
    return '刚刚';
  } else if (diff < 3600000) {
    return Math.floor(diff / 60000) + '分钟前';
  } else if (diff < 86400000) {
    return Math.floor(diff / 3600000) + '小时前';
  } else {
    return Math.floor(diff / 86400000) + '天前';
  }
}

// ==================== 同人文系统 ====================
const FanficState = {
  currentCategory: 'all',
  works: [],
  page: 1,
  loading: false,
  hasMore: true,
  currentWorkId: null,
  previousPage: 'profile',
  selectedCharacters: [],
  selectedCategory: 'danmei',
  selectedTrope: 'pojing'
};

// 打开同人文
function openFanfic() {
  FanficState.previousPage = AppState.currentPage;
  showPage('fanfic');
  FanficState.currentCategory = 'all';
  FanficState.works = [];
  FanficState.page = 1;
  FanficState.hasMore = true;
  
  initFanficCategories();
  loadFanficWorks();
}

// 返回上一页
function goBackFromFanfic() {
  showPage(FanficState.previousPage);
}

// 初始化分类标签
function initFanficCategories() {
  const categories = [
    { id: 'all', name: '全部', icon: '📚' },
    { id: 'danmei', name: '耽美', icon: '💕' },
    { id: 'yanqing', name: '言情', icon: '💖' },
    { id: 'xuanhuan', name: '玄幻', icon: '⚔️' },
    { id: 'xiaoyuan', name: '校园', icon: '🎓' },
    { id: 'dushi', name: '都市', icon: '🏙️' },
    { id: 'gufeng', name: '古风', icon: '🏮' },
    { id: 'kehuan', name: '科幻', icon: '🚀' }
  ];
  
  const container = document.getElementById('fanficCategories');
  container.innerHTML = categories.map(cat => `
    <div class="fanfic-category ${cat.id === FanficState.currentCategory ? 'active' : ''}" 
         onclick="switchFanficCategory('${cat.id}')">
      <span class="category-icon">${cat.icon}</span>
      <span class="category-name">${cat.name}</span>
    </div>
  `).join('');
}

// 切换分类
function switchFanficCategory(categoryId) {
  FanficState.currentCategory = categoryId;
  FanficState.works = [];
  FanficState.page = 1;
  FanficState.hasMore = true;
  
  // 更新样式
  document.querySelectorAll('.fanfic-category').forEach(cat => {
    cat.classList.toggle('active', cat.querySelector('.category-name')?.textContent === 
      ['全部','耽美','言情','玄幻','校园','都市','古风','科幻'][
        ['all','danmei','yanqing','xuanhuan','xiaoyuan','dushi','gufeng','kehuan'].indexOf(categoryId)
      ]
    );
  });
  
  loadFanficWorks();
}

// 加载作品列表
async function loadFanficWorks(refresh = false) {
  if (FanficState.loading) return;
  if (!FanficState.hasMore && !refresh) return;
  
  FanficState.loading = true;
  document.getElementById('fanficLoading').style.display = 'flex';
  
  if (refresh) {
    FanficState.works = [];
    FanficState.page = 1;
    FanficState.hasMore = true;
  }
  
  try {
    const res = await API.get('/api/fanfic/works', {
      category: FanficState.currentCategory,
      page: FanficState.page,
      pageSize: 12
    });
    
    if (res.success && res.data) {
      const newWorks = res.data.list || [];
      
      if (newWorks.length === 0) {
        FanficState.hasMore = false;
      } else {
        FanficState.works = [...FanficState.works, ...newWorks];
        FanficState.page++;
      }
      
      renderFanficWorks();
    }
  } catch (err) {
    console.error('加载作品失败:', err);
    // 生成示例作品
    if (FanficState.page === 1) {
      generateSampleFanficWorks();
    }
  } finally {
    FanficState.loading = false;
    document.getElementById('fanficLoading').style.display = 'none';
  }
}

// 生成示例作品
function generateSampleFanficWorks() {
  const sampleWorks = [
    {
      id: 1,
      title: '温柔学姐的秘密',
      cover: '',
      category: 'danmei',
      word_count: 15680,
      character1_name: '温柔学姐',
      character2_name: '你',
      excerpt: '她总是那么温柔，直到那天我发现了她的秘密...',
      in_shelf: false
    },
    {
      id: 2,
      title: '傲娇大小姐追妻记',
      cover: '',
      category: 'yanqing',
      word_count: 23450,
      character1_name: '傲娇大小姐',
      character2_name: '你',
      excerpt: '"哼，我才不是喜欢你呢！" 她红着脸说。',
      in_shelf: false
    },
    {
      id: 3,
      title: '邻家妹妹的夏天',
      cover: '',
      category: 'xiaoyuan',
      word_count: 12340,
      character1_name: '邻家妹妹',
      character2_name: '你',
      excerpt: '那个夏天，蝉鸣不止，心动也不止...',
      in_shelf: false
    },
    {
      id: 4,
      title: '总裁的替身情人',
      cover: '',
      category: 'dushi',
      word_count: 34560,
      character1_name: '冷酷总裁',
      character2_name: '你',
      excerpt: '"你只是她的替身，别妄想其他。"',
      in_shelf: false
    }
  ];
  
  FanficState.works = sampleWorks;
  renderFanficWorks();
}

// 渲染作品列表
function renderFanficWorks() {
  const container = document.getElementById('fanficGrid');
  
  if (FanficState.works.length === 0) {
    container.innerHTML = `
      <div class="fanfic-empty">
        <div class="empty-icon">📖</div>
        <div class="empty-text">还没有作品</div>
        <div class="empty-tip">点击右下角生成你的第一篇</div>
      </div>
    `;
    return;
  }
  
  container.innerHTML = FanficState.works.map(work => `
    <div class="fanfic-card" onclick="openFanficDetail(${work.id})">
      <div class="fanfic-cover" style="background: linear-gradient(135deg, #FFB6C1, #FF69B4);">
        <div class="fanfic-cover-title">${work.title?.slice(0, 4) || ''}</div>
      </div>
      <div class="fanfic-info">
        <div class="fanfic-title">${work.title || '无题'}</div>
        <div class="fanfic-meta">
          <span class="fanfic-words">${Math.floor((work.word_count || 0) / 1000)}k字</span>
          <span class="fanfic-chars">${work.character1_name || ''}×${work.character2_name || ''}</span>
        </div>
        ${work.in_shelf ? '<div class="fanfic-shelf-badge">已收藏</div>' : ''}
      </div>
    </div>
  `).join('');
}

// 打开发布页面
function openFanficGenerate() {
  showPage('fanfic-generate');
  FanficState.selectedCharacters = [];
  FanficState.selectedCategory = 'danmei';
  FanficState.selectedTrope = 'pojing';
  
  initFanficGeneratePage();
}

// 返回同人文首页
function goBackFromFanficGenerate() {
  showPage('fanfic');
}

// 初始化生成页面
async function initFanficGeneratePage() {
  // 加载角色列表
  try {
    const res = await API.get('/api/characters');
    if (res.success && res.data) {
      renderFanficCharacters(res.data || []);
    }
  } catch (err) {
    // 使用示例角色
    const sampleChars = [
      { id: 1, name: '温柔学姐', avatar: '' },
      { id: 2, name: '傲娇大小姐', avatar: '' },
      { id: 3, name: '邻家妹妹', avatar: '' },
      { id: 4, name: '冷酷总裁', avatar: '' }
    ];
    renderFanficCharacters(sampleChars);
  }
  
  // 渲染分类
  const categories = [
    { id: 'danmei', name: '耽美' },
    { id: 'yanqing', name: '言情' },
    { id: 'xuanhuan', name: '玄幻' },
    { id: 'xiaoyuan', name: '校园' },
    { id: 'dushi', name: '都市' },
    { id: 'gufeng', name: '古风' }
  ];
  
  document.getElementById('fanficGenCategories').innerHTML = categories.map(cat => `
    <div class="gen-category ${cat.id === FanficState.selectedCategory ? 'active' : ''}" 
         onclick="selectFanficCategory('${cat.id}')">
      ${cat.name}
    </div>
  `).join('');
  
  // 渲染梗
  const tropes = [
    { id: 'nianxia', name: '年下' },
    { id: 'zhuiqi', name: '追妻火葬场' },
    { id: 'pojing', name: '破镜重圆' },
    { id: 'shuangxiang', name: '双向暗恋' },
    { id: 'xianhun', name: '先婚后爱' },
    { id: 'tishen', name: '替身' },
    { id: 'chongsheng', name: '重生' },
    { id: 'chuanyue', name: '穿越' },
    { id: 'abo', name: 'ABO' },
    { id: 'qiangzhi', name: '强制爱' },
    { id: 'baiyueguang', name: '白月光' },
    { id: 'zhushazhi', name: '朱砂痣' },
    { id: 'qingdi', name: '情敌变情人' },
    { id: 'qingmei', name: '青梅竹马' },
    { id: 'huanxi', name: '欢喜冤家' },
    { id: 'baoyang', name: '包养' }
  ];
  
  document.getElementById('fanficGenTropes').innerHTML = tropes.map(trope => `
    <div class="gen-trope ${trope.id === FanficState.selectedTrope ? 'active' : ''}" 
         onclick="selectFanficTrope('${trope.id}')">
      ${trope.name}
    </div>
  `).join('');
}

// 渲染角色选择
function renderFanficCharacters(characters) {
  const container = document.getElementById('fanficGenCharacters');
  
  if (characters.length === 0) {
    container.innerHTML = '<div class="gen-empty">还没有角色，先去创建角色吧</div>';
    return;
  }
  
  container.innerHTML = characters.map(char => `
    <div class="gen-character ${FanficState.selectedCharacters.includes(char.id) ? 'selected' : ''}" 
         onclick="toggleFanficCharacter(${char.id})">
      <div class="gen-char-avatar">${char.name?.[0] || '?'}</div>
      <div class="gen-char-name">${char.name || ''}</div>
    </div>
  `).join('');
}

// 切换角色选择
function toggleFanficCharacter(charId) {
  const index = FanficState.selectedCharacters.indexOf(charId);
  
  if (index > -1) {
    FanficState.selectedCharacters.splice(index, 1);
  } else {
    if (FanficState.selectedCharacters.length >= 2) {
      showToast('最多选择2个角色');
      return;
    }
    FanficState.selectedCharacters.push(charId);
  }
  
  // 重新渲染
  initFanficGeneratePage();
}

// 选择分类
function selectFanficCategory(categoryId) {
  FanficState.selectedCategory = categoryId;
  document.querySelectorAll('.gen-category').forEach(cat => {
    cat.classList.toggle('active', cat.textContent === 
      ['耽美','言情','玄幻','校园','都市','古风'][
        ['danmei','yanqing','xuanhuan','xiaoyuan','dushi','gufeng'].indexOf(categoryId)
      ]
    );
  });
}

// 选择梗
function selectFanficTrope(tropeId) {
  FanficState.selectedTrope = tropeId;
  document.querySelectorAll('.gen-trope').forEach(trope => {
    trope.classList.toggle('active', trope.textContent === 
      ['年下','追妻火葬场','破镜重圆','双向暗恋','先婚后爱','替身','重生','穿越','ABO','强制爱','白月光','朱砂痣','情敌变情人','青梅竹马','欢喜冤家','包养'][
        ['nianxia','zhuiqi','pojing','shuangxiang','xianhun','tishen','chongsheng','chuanyue','abo','qiangzhi','baiyueguang','zhushazhi','qingdi','qingmei','huanxi','baoyang'].indexOf(tropeId)
      ]
    );
  });
}

// 生成同人文
async function generateFanfic() {
  if (FanficState.selectedCharacters.length === 0) {
    showToast('请至少选择一个角色');
    return;
  }
  
  const btn = document.getElementById('fanficGenBtn');
  btn.disabled = true;
  btn.textContent = '生成中...';
  
  try {
    const customTags = document.getElementById('fanficCustomTags').value.trim();
    const tags = customTags ? customTags.split(',').map(t => t.trim()).filter(t => t) : [];
    
    const res = await API.post('/api/fanfic/generate', {
      character1Id: FanficState.selectedCharacters[0],
      character2Id: FanficState.selectedCharacters[1],
      category: FanficState.selectedCategory,
      trope: FanficState.selectedTrope,
      customTags: tags
    });
    
    if (res.success && res.data) {
      showToast('生成成功！');
      // 打开详情页
      openFanficDetail(res.data.work_id);
    }
  } catch (err) {
    showToast(err.message || '生成失败');
  } finally {
    btn.disabled = false;
    btn.textContent = '✨ 开始生成';
  }
}

// 打开作品详情
async function openFanficDetail(workId) {
  FanficState.currentWorkId = workId;
  showPage('fanfic-detail');
  
  try {
    const res = await API.get(`/api/fanfic/works/${workId}`);
    if (res.success && res.data) {
      renderFanficDetail(res.data);
    }
  } catch (err) {
    // 生成示例内容
    renderSampleFanficDetail(workId);
  }
}

// 渲染示例作品详情
function renderSampleFanficDetail(workId) {
  const work = FanficState.works.find(w => w.id === workId) || { title: '示例作品' };
  
  document.getElementById('fanficDetailTitle').textContent = work.title || '无题';
  
  document.getElementById('fanficDetailContent').innerHTML = `
    <div class="fanfic-detail-header">
      <div class="fanfic-detail-cover" style="background: linear-gradient(135deg, #FFB6C1, #FF69B4);">
        <div class="fanfic-cover-title">${work.title?.slice(0, 4) || ''}</div>
      </div>
      <div class="fanfic-detail-info">
        <h1 class="fanfic-detail-title">${work.title || '无题'}</h1>
        <div class="fanfic-detail-meta">
          <span>${Math.floor((work.word_count || 15000) / 1000)}k字</span>
          <span>·</span>
          <span>${work.character1_name || ''}×${work.character2_name || ''}</span>
        </div>
        <div class="fanfic-detail-tags">
          <span class="fanfic-tag">${work.category || '综合'}</span>
        </div>
      </div>
    </div>
    
    <div class="fanfic-detail-chars">
      <div class="detail-char-card">
        <div class="detail-char-avatar">${work.character1_name?.[0] || '?'}</div>
        <div class="detail-char-name">${work.character1_name || '主角'}</div>
        <div class="detail-char-desc">主角</div>
      </div>
      <div class="detail-char-vs">×</div>
      <div class="detail-char-card">
        <div class="detail-char-avatar">${work.character2_name?.[0] || '你'}</div>
        <div class="detail-char-name">${work.character2_name || '你'}</div>
        <div class="detail-char-desc">你</div>
      </div>
    </div>
    
    <div class="fanfic-detail-content-text">
      <p>这是一个关于${work.character1_name || '主角'}和${work.character2_name || '你'}的故事。</p>
      <p>他们相遇在一个普通的下午，阳光透过树叶洒在地上，形成斑驳的光影。</p>
      <p>"你好。"${work.character1_name || '他'}说。</p>
      <p>"你好。"另一个人回答。</p>
      <p>故事就这样开始了...</p>
      <p style="text-align: center; color: #999; margin-top: 40px;">（点击生成按钮获取完整内容）</p>
    </div>
  `;
}

// 渲染作品详情
function renderFanficDetail(work) {
  document.getElementById('fanficDetailTitle').textContent = work.title || '无题';
  
  // 更新收藏按钮
  const saveBtn = document.getElementById('fanficSaveBtn');
  saveBtn.textContent = work.in_shelf ? '⭐' : '☆';
  
  document.getElementById('fanficDetailContent').innerHTML = `
    <div class="fanfic-detail-header">
      <div class="fanfic-detail-cover" style="background: linear-gradient(135deg, #FFB6C1, #FF69B4);">
        <div class="fanfic-cover-title">${work.title?.slice(0, 4) || ''}</div>
      </div>
      <div class="fanfic-detail-info">
        <h1 class="fanfic-detail-title">${work.title || '无题'}</h1>
        <div class="fanfic-detail-meta">
          <span>${Math.floor((work.word_count || 0) / 1000)}k字</span>
          <span>·</span>
          <span>${work.character1?.name || ''}×${work.character2?.name || ''}</span>
        </div>
        <div class="fanfic-detail-tags">
          ${(work.tags || []).map(tag => `<span class="fanfic-tag">${tag}</span>`).join('')}
        </div>
      </div>
    </div>
    
    ${work.character1 || work.character2 ? `
    <div class="fanfic-detail-chars">
      ${work.character1 ? `
      <div class="detail-char-card">
        <div class="detail-char-avatar">${work.character1.name?.[0] || '?'}</div>
        <div class="detail-char-name">${work.character1.name || ''}</div>
        <div class="detail-char-desc">${work.character1.description || '主角'}</div>
      </div>
      ` : ''}
      ${work.character1 && work.character2 ? '<div class="detail-char-vs">×</div>' : ''}
      ${work.character2 ? `
      <div class="detail-char-card">
        <div class="detail-char-avatar">${work.character2.name?.[0] || '?'}</div>
        <div class="detail-char-name">${work.character2.name || ''}</div>
        <div class="detail-char-desc">${work.character2.description || '你'}</div>
      </div>
      ` : ''}
    </div>
    ` : ''}
    
    <div class="fanfic-detail-content-text">
      ${(work.content || '').split('\n').filter(p => p.trim()).map(p => `<p>${p}</p>`).join('')}
    </div>
  `;
}

// 返回作品列表
function goBackFromFanficDetail() {
  showPage('fanfic');
}

// 收藏/取消收藏
async function toggleFanficSave() {
  if (!FanficState.currentWorkId) return;
  
  try {
    const res = await API.post(`/api/fanfic/works/${FanficState.currentWorkId}/save`);
    if (res.success && res.data) {
      const saveBtn = document.getElementById('fanficSaveBtn');
      saveBtn.textContent = res.data.in_shelf ? '⭐' : '☆';
      showToast(res.data.in_shelf ? '已加入书架' : '已移出书架');
    }
  } catch (err) {
    showToast('操作失败');
  }
}

// 打开书架
function openFanficShelf() {
  showToast('书架功能开发中');
}

// ==================== 手机桌面 ====================
const HomeState = {
  currentApp: null
};

// 更新时间
function updateHomeTime() {
  const now = new Date();
  const hours = now.getHours().toString().padStart(2, '0');
  const minutes = now.getMinutes().toString().padStart(2, '0');
  
  const timeStr = `${hours}:${minutes}`;
  document.getElementById('statusTime').textContent = timeStr;
  document.getElementById('homeTime').textContent = timeStr;
  
  const days = ['星期日', '星期一', '星期二', '星期三', '星期四', '星期五', '星期六'];
  const month = now.getMonth() + 1;
  const date = now.getDate();
  const day = days[now.getDay()];
  
  document.getElementById('homeDate').textContent = `${day} ${month}月${date}日`;
}

// 打开APP
function openApp(appName) {
  HomeState.currentApp = appName;
  
  // 播放打开动画
  const overlay = document.getElementById('appOpenOverlay');
  const icon = document.getElementById('appOpenIcon');
  
  // 设置图标样式
  const iconClasses = {
    'chat': 'chat-icon',
    'characters': 'chars-icon',
    'community': 'community-icon',
    'forum': 'forum-icon',
    'fanfic': 'fanfic-icon',
    'profile': 'profile-icon'
  };
  
  const iconEmojis = {
    'chat': '💬',
    'characters': '🎭',
    'community': '🌐',
    'forum': '📝',
    'fanfic': '📖',
    'profile': '👤'
  };
  
  icon.className = 'app-open-icon ' + (iconClasses[appName] || '');
  icon.textContent = iconEmojis[appName] || '📱';
  
  // 显示遮罩
  overlay.classList.add('active');
  
  // 动画结束后跳转到对应页面
  setTimeout(() => {
    overlay.classList.remove('active');
    
    if (appName === 'forum') {
      openForum();
    } else if (appName === 'fanfic') {
      openFanfic();
    } else {
      switchPage(appName);
    }
  }, 300);
}

// 返回桌面
function goHome() {
  switchPage('home');
  HomeState.currentApp = null;
}

// 初始化桌面
function initHome() {
  updateHomeTime();
  setInterval(updateHomeTime, 60000);
}

// ==================== 论坛侧边栏 ====================
// 打开侧边栏
function openForumSidebar() {
  document.getElementById('forumSidebarOverlay').classList.add('active');
  document.getElementById('forumSidebar').classList.add('active');
  
  // 更新用户信息
  if (AppState.user) {
    document.getElementById('sidebarAvatar').textContent = (AppState.user.nickname || AppState.user.username || '?')[0];
    document.getElementById('sidebarName').textContent = AppState.user.nickname || AppState.user.username || '用户';
    document.getElementById('sidebarTag').textContent = AppState.user.forum_tag || '萌新';
  }
}

// 关闭侧边栏
function closeForumSidebar() {
  document.getElementById('forumSidebarOverlay').classList.remove('active');
  document.getElementById('forumSidebar').classList.remove('active');
}

// 我的主页
function goToForumProfile() {
  closeForumSidebar();
  showToast('我的主页功能开发中');
}

// 我的收藏
function goToForumFavorites() {
  closeForumSidebar();
  showToast('我的收藏功能开发中');
}

// 我的关注
function goToForumFollows() {
  closeForumSidebar();
  showToast('我的关注功能开发中');
}

// 热搜榜
function goToHotSearch() {
  closeForumSidebar();
  showToast('热搜榜功能开发中');
}

// 修改身份标签
function editProfileTag() {
  closeForumSidebar();
  showToast('修改身份标签功能开发中');
}

// 返回论坛（从桌面进入时返回桌面）
function goBackFromForum() {
  goHome();
}

// ==================== 同人文字数选择 ====================
// 选择字数
function selectFanficLength(length) {
  FanficState.selectedLength = length;
  
  document.querySelectorAll('.gen-length-option').forEach(opt => {
    opt.classList.toggle('active', opt.dataset.length === length);
  });
  
  // 更新消耗米粒数
  const costMap = { short: 10, medium: 25, long: 50 };
  const cost = costMap[length] || 10;
  document.querySelector('.cost-rice').textContent = cost;
}
