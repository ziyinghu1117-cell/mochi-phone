/**
 * Mochi AI Chat - 前端核心逻辑
 * 功能：聊天、角色管理、社区、个人中心、自定义装扮
 */

// ==================== 全局状态 ====================
const AppState = {
  currentPage: 'chat',
  currentCharacterId: null,
  characters: [],
  chatHistory: {}, // characterId -> messages[]
  userProfile: {
    nickname: '新用户',
    avatar: '',
    description: ''
  },
  deviceId: '',
  beans: 0,
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
  }
};

// ==================== 本地存储键 ====================
const STORAGE_KEYS = {
  CHARACTERS: 'mochi_characters',
  CHAT_HISTORY: 'mochi_chat_history',
  USER_PROFILE: 'mochi_user_profile',
  DEVICE_ID: 'mochi_device_id',
  THEME_CONFIG: 'mochi_theme_config'
};

// ==================== 初始化 ====================
document.addEventListener('DOMContentLoaded', () => {
  initApp();
});

function initApp() {
  loadFromStorage();
  generateDeviceId();
  setupEventListeners();
  renderCharacters();
  renderCharacterSwitcher();
  loadUserInfo();
  loadCommunityCharacters();
  applyThemeConfig();
  
  // 默认选中第一个角色
  if (AppState.characters.length > 0) {
    switchCharacter(AppState.characters[0].id);
  }
}

// ==================== 本地存储 ====================
function saveToStorage() {
  localStorage.setItem(STORAGE_KEYS.CHARACTERS, JSON.stringify(AppState.characters));
  localStorage.setItem(STORAGE_KEYS.CHAT_HISTORY, JSON.stringify(AppState.chatHistory));
  localStorage.setItem(STORAGE_KEYS.USER_PROFILE, JSON.stringify(AppState.userProfile));
  localStorage.setItem(STORAGE_KEYS.THEME_CONFIG, JSON.stringify(AppState.themeConfig));
}

function loadFromStorage() {
  try {
    const chars = localStorage.getItem(STORAGE_KEYS.CHARACTERS);
    if (chars) AppState.characters = JSON.parse(chars);
    
    const history = localStorage.getItem(STORAGE_KEYS.CHAT_HISTORY);
    if (history) AppState.chatHistory = JSON.parse(history);
    
    const profile = localStorage.getItem(STORAGE_KEYS.USER_PROFILE);
    if (profile) AppState.userProfile = JSON.parse(profile);
    
    const theme = localStorage.getItem(STORAGE_KEYS.THEME_CONFIG);
    if (theme) AppState.themeConfig = JSON.parse(theme);
  } catch (e) {
    console.error('加载本地存储失败:', e);
  }
}

function generateDeviceId() {
  let deviceId = localStorage.getItem(STORAGE_KEYS.DEVICE_ID);
  if (!deviceId) {
    deviceId = 'device_' + Date.now() + '_' + Math.random().toString(36).substr(2, 9);
    localStorage.setItem(STORAGE_KEYS.DEVICE_ID, deviceId);
  }
  AppState.deviceId = deviceId;
}

// ==================== 事件监听 ====================
function setupEventListeners() {
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
  document.getElementById('menuBeans').addEventListener('click', openBeansDetail);

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

  // 清空缓存
  document.getElementById('menuClear').addEventListener('click', clearCache);

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

  // 聊天菜单
  document.getElementById('btnChatMenu').addEventListener('click', showChatMenu);

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
function switchCharacter(characterId) {
  AppState.currentCharacterId = characterId;
  
  // 更新切换栏
  document.querySelectorAll('.switcher-item').forEach(item => {
    item.classList.toggle('active', item.dataset.id === characterId);
  });

  // 渲染消息
  renderMessages();
  
  // 滚动到底部
  scrollToBottom();
}

function renderCharacterSwitcher() {
  const switcher = document.getElementById('characterSwitcher');
  
  if (AppState.characters.length === 0) {
    switcher.innerHTML = '<div style="color: var(--text-tertiary); font-size: 13px; padding: 10px 0;">暂无角色，去「角色」页面创建吧</div>';
    return;
  }

  switcher.innerHTML = AppState.characters.map(char => `
    <div class="switcher-item ${char.id === AppState.currentCharacterId ? 'active' : ''}" data-id="${char.id}">
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

// ==================== 聊天功能 ====================
function renderMessages() {
  const container = document.getElementById('chatMessages');
  const characterId = AppState.currentCharacterId;
  
  if (!characterId) {
    container.innerHTML = '<div style="text-align: center; color: var(--text-tertiary); padding: 40px 0;">请先选择或创建一个角色</div>';
    return;
  }

  const messages = AppState.chatHistory[characterId] || [];
  
  if (messages.length === 0) {
    const char = AppState.characters.find(c => c.id === characterId);
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
  const character = AppState.characters.find(c => c.id === AppState.currentCharacterId);
  
  let avatarHtml = '';
  if (isUser) {
    avatarHtml = AppState.userProfile.avatar 
      ? `<img src="${AppState.userProfile.avatar}" alt="我">`
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
        ${msg.time ? `<div class="message-time">${formatTime(msg.time)}</div>` : ''}
      </div>
    </div>
  `;
}

function sendMessage() {
  const input = document.getElementById('chatInput');
  const text = input.value.trim();
  
  if (!text || AppState.isSending) return;
  if (!AppState.currentCharacterId) {
    showToast('请先选择一个角色');
    return;
  }

  const characterId = AppState.currentCharacterId;
  const character = AppState.characters.find(c => c.id === characterId);
  
  if (!character) {
    showToast('角色不存在');
    return;
  }

  // 添加用户消息
  const userMsg = {
    role: 'user',
    content: text,
    time: Date.now()
  };
  
  if (!AppState.chatHistory[characterId]) {
    AppState.chatHistory[characterId] = [];
  }
  AppState.chatHistory[characterId].push(userMsg);
  
  input.value = '';
  input.style.height = 'auto';
  
  renderMessages();
  scrollToBottom();
  saveToStorage();

  // 发送AI请求
  sendAiRequest(characterId, character);
}

async function sendAiRequest(characterId, character) {
  AppState.isSending = true;
  document.getElementById('btnSend').disabled = true;

  // 添加AI消息占位（打字动画）
  const aiMsg = {
    role: 'assistant',
    content: '',
    time: Date.now(),
    isTyping: true
  };
  AppState.chatHistory[characterId].push(aiMsg);
  
  renderMessages();
  scrollToBottom();

  try {
    const messages = AppState.chatHistory[characterId]
      .filter(m => !m.isTyping)
      .map(m => ({ role: m.role, content: m.content }));

    const response = await fetch('/api/chat', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-device-id': AppState.deviceId
      },
      body: JSON.stringify({
        messages,
        characterPrompt: character.prompt,
        characterName: character.name,
        stream: true
      })
    });

    if (response.status === 402) {
      throw new Error('豆子不足，请先充值');
    }

    if (!response.ok) {
      throw new Error('请求失败');
    }

    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    let buffer = '';
    let fullContent = '';

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
            throw new Error(parsed.error);
          }
          if (parsed.content) {
            fullContent += parsed.content;
            // 更新消息
            const msgs = AppState.chatHistory[characterId];
            const lastMsg = msgs[msgs.length - 1];
            if (lastMsg && lastMsg.isTyping) {
              lastMsg.content = fullContent;
              updateLastMessage();
            }
          }
        } catch (e) {
          // 忽略解析错误
        }
      }
    }

    // 完成消息
    const msgs = AppState.chatHistory[characterId];
    const lastMsg = msgs[msgs.length - 1];
    if (lastMsg && lastMsg.isTyping) {
      lastMsg.isTyping = false;
      lastMsg.content = fullContent || '（无响应内容）';
    }

    // 刷新豆子余额
    loadUserInfo();

  } catch (err) {
    console.error('聊天请求失败:', err);
    
    // 移除占位消息
    const msgs = AppState.chatHistory[characterId];
    if (msgs.length > 0 && msgs[msgs.length - 1].isTyping) {
      msgs.pop();
    }
    
    showToast(err.message || '发送失败，请重试');
  } finally {
    AppState.isSending = false;
    document.getElementById('btnSend').disabled = false;
    renderMessages();
    scrollToBottom();
    saveToStorage();
  }
}

function updateLastMessage() {
  const container = document.getElementById('chatMessages');
  const messages = container.querySelectorAll('.message-item');
  const lastMsg = messages[messages.length - 1];
  if (lastMsg) {
    const characterId = AppState.currentCharacterId;
    const msgs = AppState.chatHistory[characterId];
    const lastAiMsg = msgs[msgs.length - 1];
    if (lastAiMsg) {
      const bubble = lastMsg.querySelector('.chat-bubble');
      if (bubble) {
        bubble.textContent = lastAiMsg.content;
      }
    }
  }
  scrollToBottom();
}

function scrollToBottom() {
  const container = document.getElementById('chatMessages');
  container.scrollTop = container.scrollHeight;
}

// ==================== 角色管理 ====================
function renderCharacters() {
  const list = document.getElementById('characterList');
  const empty = document.getElementById('characterEmpty');
  
  if (AppState.characters.length === 0) {
    list.innerHTML = '';
    empty.style.display = 'flex';
    return;
  }

  empty.style.display = 'none';
  
  list.innerHTML = AppState.characters.map(char => `
    <div class="character-card" data-id="${char.id}">
      <div class="character-card-avatar">
        ${char.avatar ? `<img src="${char.avatar}" alt="${char.name}">` : '<span class="avatar-placeholder">👤</span>'}
      </div>
      <div class="character-card-info">
        <div class="character-card-name">${escapeHtml(char.name)}</div>
        <div class="character-card-desc">${escapeHtml(char.description || '暂无简介')}</div>
      </div>
      <div class="character-card-actions">
        <button class="character-card-btn chat" data-action="chat" data-id="${char.id}">聊天</button>
        <button class="character-card-btn edit" data-action="edit" data-id="${char.id}">编辑</button>
      </div>
    </div>
  `).join('');

  // 绑定事件
  list.querySelectorAll('.character-card-btn').forEach(btn => {
    btn.addEventListener('click', (e) => {
      e.stopPropagation();
      const action = btn.dataset.action;
      const id = btn.dataset.id;
      
      if (action === 'chat') {
        switchCharacter(id);
        switchPage('chat');
      } else if (action === 'edit') {
        openCharacterEdit(id);
      }
    });
  });

  // 卡片点击编辑
  list.querySelectorAll('.character-card').forEach(card => {
    card.addEventListener('click', () => {
      openCharacterEdit(card.dataset.id);
    });
  });
}

let _editingCharacterId = null;
let _tempAvatar = '';

function openCharacterEdit(characterId = null) {
  _editingCharacterId = characterId;
  _tempAvatar = '';
  
  const title = document.getElementById('characterEditTitle');
  const nameInput = document.getElementById('characterName');
  const descInput = document.getElementById('characterDesc');
  const promptInput = document.getElementById('characterPrompt');
  const tagsInput = document.getElementById('characterTags');
  const publicCheck = document.getElementById('characterPublic');
  const avatarPreview = document.getElementById('characterAvatarPreview');

  if (characterId) {
    const char = AppState.characters.find(c => c.id === characterId);
    if (char) {
      title.textContent = '编辑角色';
      nameInput.value = char.name;
      descInput.value = char.description || '';
      promptInput.value = char.prompt || '';
      tagsInput.value = (char.tags || []).join(',');
      publicCheck.checked = char.isPublic || false;
      
      if (char.avatar) {
        avatarPreview.innerHTML = `<img src="${char.avatar}" alt="头像">`;
        _tempAvatar = char.avatar;
      } else {
        avatarPreview.innerHTML = '<span class="avatar-placeholder">👤</span>';
      }
    }
  } else {
    title.textContent = '创建角色';
    nameInput.value = '';
    descInput.value = '';
    promptInput.value = '';
    tagsInput.value = '';
    publicCheck.checked = false;
    avatarPreview.innerHTML = '<span class="avatar-placeholder">👤</span>';
  }

  openModal('modalCharacterEdit');
}

function handleCharacterAvatar(e) {
  const file = e.target.files[0];
  if (!file) return;
  
  const reader = new FileReader();
  reader.onload = (event) => {
    _tempAvatar = event.target.result;
    document.getElementById('characterAvatarPreview').innerHTML = `<img src="${_tempAvatar}" alt="头像">`;
  };
  reader.readAsDataURL(file);
}

function saveCharacter() {
  const name = document.getElementById('characterName').value.trim();
  const description = document.getElementById('characterDesc').value.trim();
  const prompt = document.getElementById('characterPrompt').value.trim();
  const tagsStr = document.getElementById('characterTags').value.trim();
  const isPublic = document.getElementById('characterPublic').checked;

  if (!name) {
    showToast('请输入角色名称');
    return;
  }
  if (!prompt) {
    showToast('请输入角色人设');
    return;
  }

  const tags = tagsStr ? tagsStr.split(/[,，]/).map(t => t.trim()).filter(Boolean) : [];

  if (_editingCharacterId) {
    // 编辑
    const index = AppState.characters.findIndex(c => c.id === _editingCharacterId);
    if (index > -1) {
      AppState.characters[index] = {
        ...AppState.characters[index],
        name,
        description,
        prompt,
        tags,
        isPublic,
        avatar: _tempAvatar || AppState.characters[index].avatar
      };
    }
    showToast('角色已更新');
  } else {
    // 新建
    const newChar = {
      id: 'char_' + Date.now() + '_' + Math.random().toString(36).substr(2, 6),
      name,
      description,
      prompt,
      tags,
      isPublic,
      avatar: _tempAvatar,
      createdAt: Date.now()
    };
    AppState.characters.unshift(newChar);
    AppState.chatHistory[newChar.id] = [];
    
    // 如果是第一个角色，自动选中
    if (AppState.characters.length === 1) {
      AppState.currentCharacterId = newChar.id;
    }
    
    showToast('角色创建成功');
  }

  saveToStorage();
  renderCharacters();
  renderCharacterSwitcher();
  closeModal('modalCharacterEdit');
}

// ==================== 社区功能 ====================
let _communityCharacters = [];
let _currentDetailChar = null;

async function loadCommunityCharacters() {
  const list = document.getElementById('communityList');
  list.innerHTML = '<div class="loading"><div class="loading-spinner"></div></div>';

  try {
    const params = new URLSearchParams({
      page: 1,
      pageSize: 20,
      sort: AppState.communitySort,
      search: AppState.communitySearch
    });

    const response = await fetch('/api/community/characters?' + params.toString(), {
      headers: { 'x-device-id': AppState.deviceId }
    });
    const data = await response.json();

    if (data.success) {
      _communityCharacters = data.data.list;
      renderCommunityList();
    } else {
      throw new Error(data.error || '加载失败');
    }
  } catch (err) {
    console.error('加载社区角色失败:', err);
    list.innerHTML = '<div style="text-align: center; color: var(--text-tertiary); padding: 40px 0;">加载失败，请重试</div>';
  }
}

function renderCommunityList() {
  const list = document.getElementById('communityList');
  
  if (_communityCharacters.length === 0) {
    list.innerHTML = '<div style="text-align: center; color: var(--text-tertiary); padding: 40px 0;">暂无角色</div>';
    return;
  }

  list.innerHTML = _communityCharacters.map(char => `
    <div class="community-card" data-id="${char.id}">
      <div class="community-card-header">
        <div class="community-card-avatar">
          ${char.avatar ? `<img src="${char.avatar}" alt="${char.name}">` : '<span class="avatar-placeholder">👤</span>'}
        </div>
        <div class="community-card-info">
          <div class="community-card-name">${escapeHtml(char.name)}</div>
          <div class="community-card-author">by ${escapeHtml(char.author || '匿名')}</div>
        </div>
      </div>
      <div class="community-card-desc">${escapeHtml(char.description || '暂无简介')}</div>
      <div class="community-card-footer">
        <div class="community-card-tags">
          ${(char.tags || []).slice(0, 3).map(tag => `<span class="community-tag">${escapeHtml(tag)}</span>`).join('')}
        </div>
        <div class="community-card-stats">
          <span class="community-stat">❤️ ${char.likes || 0}</span>
        </div>
      </div>
    </div>
  `).join('');

  // 绑定点击事件
  list.querySelectorAll('.community-card').forEach(card => {
    card.addEventListener('click', () => {
      openCharacterDetail(card.dataset.id);
    });
  });
}

async function openCharacterDetail(characterId) {
  const char = _communityCharacters.find(c => c.id === characterId);
  if (!char) return;

  _currentDetailChar = char;

  document.getElementById('detailName').textContent = char.name;
  document.getElementById('detailDesc').textContent = char.description || '';
  document.getElementById('detailAuthor').textContent = char.author || '匿名';
  document.getElementById('detailLikes').textContent = char.likes || 0;
  document.getElementById('detailPrompt').textContent = char.prompt || '暂无设定';

  const avatarEl = document.getElementById('detailAvatar');
  if (char.avatar) {
    avatarEl.innerHTML = `<img src="${char.avatar}" alt="${char.name}">`;
  } else {
    avatarEl.innerHTML = '<span class="avatar-placeholder">👤</span>';
  }

  const tagsEl = document.getElementById('detailTags');
  tagsEl.innerHTML = (char.tags || []).map(tag => `<span class="detail-tag">${escapeHtml(tag)}</span>`).join('');

  openModal('modalCharacterDetail');
}

function importCharacter() {
  if (!_currentDetailChar) return;
  
  const char = _currentDetailChar;
  
  // 检查是否已导入
  const exists = AppState.characters.find(c => c.name === char.name);
  if (exists) {
    showToast('该角色已存在');
    return;
  }

  const newChar = {
    id: 'char_' + Date.now() + '_' + Math.random().toString(36).substr(2, 6),
    name: char.name,
    description: char.description,
    prompt: char.prompt,
    tags: char.tags || [],
    avatar: char.avatar,
    isPublic: false,
    createdAt: Date.now(),
    importedFrom: char.id
  };

  AppState.characters.unshift(newChar);
  AppState.chatHistory[newChar.id] = [];

  if (AppState.characters.length === 1) {
    AppState.currentCharacterId = newChar.id;
  }

  saveToStorage();
  renderCharacters();
  renderCharacterSwitcher();
  closeModal('modalCharacterDetail');
  showToast('角色导入成功');
}

// ==================== 个人中心 ====================
function renderProfile() {
  document.getElementById('profileNickname').textContent = AppState.userProfile.nickname || '新用户';
  document.getElementById('profileDesc').textContent = AppState.userProfile.description || '点击编辑个人资料';
  
  const avatarEl = document.getElementById('profileAvatar');
  if (AppState.userProfile.avatar) {
    avatarEl.innerHTML = `<img src="${AppState.userProfile.avatar}" alt="头像">`;
  } else {
    avatarEl.innerHTML = '<span class="avatar-placeholder">👤</span>';
  }
}

async function loadUserInfo() {
  try {
    const response = await fetch('/api/user/info', {
      headers: { 'x-device-id': AppState.deviceId }
    });
    const data = await response.json();
    
    if (data.success) {
      AppState.beans = data.data.beans || 0;
      document.getElementById('beansAmount').textContent = AppState.beans;
    }
  } catch (err) {
    console.error('加载用户信息失败:', err);
  }
}

function openProfileEdit() {
  document.getElementById('profileNicknameInput').value = AppState.userProfile.nickname || '';
  document.getElementById('profileDescInput').value = AppState.userProfile.description || '';
  
  const preview = document.getElementById('profileAvatarPreview');
  if (AppState.userProfile.avatar) {
    preview.innerHTML = `<img src="${AppState.userProfile.avatar}" alt="头像">`;
  } else {
    preview.innerHTML = '<span class="avatar-placeholder">👤</span>';
  }
  
  _tempProfileAvatar = AppState.userProfile.avatar || '';
  openModal('modalProfileEdit');
}

let _tempProfileAvatar = '';

function handleProfileAvatar(e) {
  const file = e.target.files[0];
  if (!file) return;
  
  const reader = new FileReader();
  reader.onload = (event) => {
    _tempProfileAvatar = event.target.result;
    document.getElementById('profileAvatarPreview').innerHTML = `<img src="${_tempProfileAvatar}" alt="头像">`;
  };
  reader.readAsDataURL(file);
}

async function saveProfile() {
  const nickname = document.getElementById('profileNicknameInput').value.trim();
  const description = document.getElementById('profileDescInput').value.trim();

  if (!nickname) {
    showToast('请输入昵称');
    return;
  }

  AppState.userProfile.nickname = nickname;
  AppState.userProfile.description = description;
  AppState.userProfile.avatar = _tempProfileAvatar;

  saveToStorage();
  renderProfile();

  // 同步到后端
  try {
    await fetch('/api/user/update', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-device-id': AppState.deviceId
      },
      body: JSON.stringify({ nickname, avatar: _tempProfileAvatar, description })
    });
  } catch (e) {
    // 忽略错误
  }

  closeModal('modalProfileEdit');
  showToast('资料已更新');
}

// ==================== 充值 ====================
async function openRecharge() {
  try {
    const response = await fetch('/api/recharge/tiers', {
      headers: { 'x-device-id': AppState.deviceId }
    });
    const data = await response.json();
    
    if (data.success) {
      const tiers = data.data;
      document.getElementById('rechargeBalance').textContent = AppState.beans;
      
      const container = document.getElementById('rechargeTiers');
      container.innerHTML = tiers.map((tier, index) => `
        <div class="recharge-tier ${index === 2 ? 'hot' : ''}" data-index="${index}">
          <div class="recharge-tier-beans">${tier.beans}</div>
          <div class="recharge-tier-price">¥${tier.price}</div>
        </div>
      `).join('');

      container.querySelectorAll('.recharge-tier').forEach(tier => {
        tier.addEventListener('click', () => {
          simulateRecharge(parseInt(tier.dataset.index));
        });
      });
    }
  } catch (err) {
    showToast('加载充值档位失败');
  }

  openModal('modalRecharge');
}

async function simulateRecharge(tierIndex) {
  try {
    const response = await fetch('/api/recharge/simulate', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-device-id': AppState.deviceId
      },
      body: JSON.stringify({ tierIndex })
    });
    const data = await response.json();
    
    if (data.success) {
      AppState.beans = data.data.beans;
      document.getElementById('beansAmount').textContent = AppState.beans;
      document.getElementById('rechargeBalance').textContent = AppState.beans;
      showToast('充值成功！');
    } else {
      showToast(data.error || '充值失败');
    }
  } catch (err) {
    showToast('充值失败');
  }
}

async function openBeansDetail() {
  document.getElementById('beansSummaryBalance').textContent = AppState.beans;
  
  const list = document.getElementById('transactionList');
  list.innerHTML = '<div class="loading"><div class="loading-spinner"></div></div>';

  try {
    const response = await fetch('/api/user/transactions', {
      headers: { 'x-device-id': AppState.deviceId }
    });
    const data = await response.json();
    
    if (data.success) {
      const txs = data.data;
      if (txs.length === 0) {
        list.innerHTML = '<div style="text-align: center; color: var(--text-tertiary); padding: 20px 0;">暂无记录</div>';
      } else {
        list.innerHTML = txs.map(tx => `
          <div class="transaction-item">
            <div class="transaction-info">
              <div class="transaction-desc">${escapeHtml(tx.description)}</div>
              <div class="transaction-time">${formatTime(tx.createdAt)}</div>
            </div>
            <div class="transaction-amount ${tx.type === 'recharge' ? 'positive' : 'negative'}">
              ${tx.type === 'recharge' ? '+' : '-'}${tx.amount}
            </div>
          </div>
        `).join('');
      }
    }
  } catch (err) {
    list.innerHTML = '<div style="text-align: center; color: var(--text-tertiary); padding: 20px 0;">加载失败</div>';
  }

  openModal('modalBeansDetail');
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

function sanitizeCss(css) {
  // 过滤危险内容
  return css
    .replace(/<script[^>]*>[\s\S]*?<\/script>/gi, '')
    .replace(/javascript:/gi, '')
    .replace(/on\w+\s*=/gi, '')
    .replace(/expression\s*\(/gi, '');
}

function applyUiCss() {
  const css = document.getElementById('cssUi').value;
  const safeCss = sanitizeCss(css);
  
  AppState.themeConfig.uiCss = safeCss;
  document.getElementById('customUiStyle').textContent = safeCss;
  
  saveToStorage();
  showToast('样式已应用');
}

function resetUiCss() {
  AppState.themeConfig.uiCss = '';
  document.getElementById('cssUi').value = '';
  document.getElementById('customUiStyle').textContent = '';
  saveToStorage();
  showToast('已重置');
}

function applyBubbleCss() {
  const css = document.getElementById('cssBubble').value;
  const safeCss = sanitizeCss(css);
  
  AppState.themeConfig.bubbleCss = safeCss;
  document.getElementById('customBubbleStyle').textContent = `.chat-bubble { ${safeCss} }`;
  
  saveToStorage();
  showToast('气泡样式已应用');
}

function resetBubbleCss() {
  AppState.themeConfig.bubbleCss = '';
  document.getElementById('cssBubble').value = '';
  document.getElementById('customBubbleStyle').textContent = '';
  saveToStorage();
  showToast('已重置');
}

let _tempWallpaper = '';

function handleWallpaperUpload(e) {
  const file = e.target.files[0];
  if (!file) return;
  
  const reader = new FileReader();
  reader.onload = (event) => {
    _tempWallpaper = event.target.result;
    showToast('壁纸已选择，点击应用生效');
  };
  reader.readAsDataURL(file);
}

function applyWallpaper() {
  if (!_tempWallpaper && !AppState.themeConfig.wallpaper) {
    showToast('请先上传壁纸');
    return;
  }

  const opacity = parseInt(document.getElementById('wallpaperOpacity').value);
  const blur = parseInt(document.getElementById('wallpaperBlur').value);
  
  if (_tempWallpaper) {
    AppState.themeConfig.wallpaper = _tempWallpaper;
  }
  AppState.themeConfig.wallpaperOpacity = opacity;
  AppState.themeConfig.wallpaperBlur = blur;

  applyWallpaperStyle();
  saveToStorage();
  showToast('壁纸已应用');
}

function applyWallpaperStyle() {
  const chatPage = document.getElementById('page-chat');
  const wallpaper = AppState.themeConfig.wallpaper;
  const opacity = AppState.themeConfig.wallpaperOpacity / 100;
  const blur = AppState.themeConfig.wallpaperBlur;

  if (wallpaper) {
    chatPage.style.backgroundImage = `url(${wallpaper})`;
    chatPage.style.backgroundSize = 'cover';
    chatPage.style.backgroundPosition = 'center';
    chatPage.style.filter = `blur(${blur}px)`;
    chatPage.style.opacity = 1;
    
    // 用伪元素实现透明度
    const existingStyle = document.getElementById('wallpaperStyle');
    if (!existingStyle) {
      const style = document.createElement('style');
      style.id = 'wallpaperStyle';
      document.head.appendChild(style);
    }
    document.getElementById('wallpaperStyle').textContent = `
      #page-chat::before {
        content: '';
        position: absolute;
        top: 0;
        left: 0;
        right: 0;
        bottom: 0;
        background: var(--bg-gradient-soft);
        opacity: ${1 - opacity};
        z-index: 0;
      }
      #page-chat > * {
        position: relative;
        z-index: 1;
      }
    `;
  }
}

function resetWallpaper() {
  AppState.themeConfig.wallpaper = '';
  AppState.themeConfig.wallpaperOpacity = 30;
  AppState.themeConfig.wallpaperBlur = 0;
  _tempWallpaper = '';
  
  document.getElementById('wallpaperOpacity').value = 30;
  document.getElementById('wallpaperOpacityValue').textContent = '30%';
  document.getElementById('wallpaperBlur').value = 0;
  document.getElementById('wallpaperBlurValue').textContent = '0px';
  
  const chatPage = document.getElementById('page-chat');
  chatPage.style.backgroundImage = '';
  chatPage.style.filter = '';
  
  const style = document.getElementById('wallpaperStyle');
  if (style) style.remove();
  
  saveToStorage();
  showToast('已重置');
}

function applyThemeConfig() {
  // 应用UI样式
  if (AppState.themeConfig.uiCss) {
    document.getElementById('customUiStyle').textContent = AppState.themeConfig.uiCss;
  }
  
  // 应用气泡样式
  if (AppState.themeConfig.bubbleCss) {
    document.getElementById('customBubbleStyle').textContent = `.chat-bubble { ${AppState.themeConfig.bubbleCss} }`;
  }
  
  // 应用壁纸
  if (AppState.themeConfig.wallpaper) {
    applyWallpaperStyle();
  }
}

// ==================== 聊天菜单 ====================
function showChatMenu() {
  if (!AppState.currentCharacterId) {
    showToast('请先选择角色');
    return;
  }
  
  showConfirm('清空对话', '确定要清空当前对话记录吗？此操作不可恢复。', () => {
    AppState.chatHistory[AppState.currentCharacterId] = [];
    renderMessages();
    saveToStorage();
    showToast('对话已清空');
  });
}

// ==================== 清空缓存 ====================
function clearCache() {
  showConfirm('清空缓存', '确定要清空所有本地数据吗？包括角色、对话历史和装扮设置。此操作不可恢复。', () => {
    localStorage.removeItem(STORAGE_KEYS.CHARACTERS);
    localStorage.removeItem(STORAGE_KEYS.CHAT_HISTORY);
    localStorage.removeItem(STORAGE_KEYS.USER_PROFILE);
    localStorage.removeItem(STORAGE_KEYS.THEME_CONFIG);
    
    AppState.characters = [];
    AppState.chatHistory = {};
    AppState.currentCharacterId = null;
    AppState.userProfile = { nickname: '新用户', avatar: '', description: '' };
    AppState.themeConfig = { uiCss: '', bubbleCss: '', wallpaper: '', wallpaperOpacity: 30, wallpaperBlur: 0 };
    
    document.getElementById('customUiStyle').textContent = '';
    document.getElementById('customBubbleStyle').textContent = '';
    const wallpaperStyle = document.getElementById('wallpaperStyle');
    if (wallpaperStyle) wallpaperStyle.remove();
    
    renderCharacters();
    renderCharacterSwitcher();
    renderProfile();
    renderMessages();
    
    showToast('缓存已清空');
  });
}

// ==================== 弹窗控制 ====================
function openModal(modalId) {
  document.getElementById(modalId).classList.add('active');
  document.body.style.overflow = 'hidden';
}

function closeModal(modalId) {
  document.getElementById(modalId).classList.remove('active');
  document.body.style.overflow = '';
}

// ==================== 确认对话框 ====================
function showConfirm(title, message, onOk, onCancel) {
  document.getElementById('confirmTitle').textContent = title;
  document.getElementById('confirmMessage').textContent = message;
  window._confirmOk = onOk;
  window._confirmCancel = onCancel;
  openModal('modalConfirm');
}

// ==================== Toast 提示 ====================
let _toastTimer = null;

function showToast(message, duration = 2000) {
  const toast = document.getElementById('toast');
  toast.textContent = message;
  toast.classList.add('show');
  
  if (_toastTimer) clearTimeout(_toastTimer);
  _toastTimer = setTimeout(() => {
    toast.classList.remove('show');
  }, duration);
}

// ==================== 工具函数 ====================
function escapeHtml(text) {
  const div = document.createElement('div');
  div.textContent = text;
  return div.innerHTML;
}

function formatTime(timestamp) {
  const date = new Date(timestamp);
  const now = new Date();
  const diff = now - date;
  
  if (diff < 60000) return '刚刚';
  if (diff < 3600000) return Math.floor(diff / 60000) + '分钟前';
  if (diff < 86400000) return Math.floor(diff / 3600000) + '小时前';
  
  const month = date.getMonth() + 1;
  const day = date.getDate();
  const hours = date.getHours().toString().padStart(2, '0');
  const minutes = date.getMinutes().toString().padStart(2, '0');
  
  if (diff < 604800000) {
    return `${month}月${day}日 ${hours}:${minutes}`;
  }
  
  return `${date.getFullYear()}/${month}/${day}`;
}

function debounce(func, wait) {
  let timeout;
  return function executedFunction(...args) {
    const later = () => {
      clearTimeout(timeout);
      func(...args);
    };
    clearTimeout(timeout);
    timeout = setTimeout(later, wait);
  };
}
