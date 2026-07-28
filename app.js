/**
 * AI Phone Simulator - 完整应用脚本
 * 包含：API封装、手机模拟器、聊天、文游、世界书、剧本编辑器、设置
 */

// ==================== API 请求封装 ====================
const API = {
    getConfig() {
        const settings = JSON.parse(localStorage.getItem('settings') || '{}');
        return {
            apiUrl: settings.apiUrl || '',
            apiKey: settings.apiKey || '',
            model: settings.model || 'gpt-3.5-turbo',
            temperature: settings.temperature !== undefined ? settings.temperature : 0.7,
            maxTokens: settings.maxTokens || 2048
        };
    },
    useProxy() {
        const config = this.getConfig();
        if (!config.apiUrl) return true;
        return config.apiUrl.startsWith('/') || config.apiUrl.startsWith(window.location.origin);
    },
    async chatStream(options) {
        const { messages, onMessage, onDone, onError, worldbook = null, character = null, scenario = null, gameMode = false } = options;
        const config = this.getConfig();
        try {
            let response;
            if (this.useProxy()) {
                response = await fetch('/api/chat', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ messages, model: config.model, stream: true, worldbook, character, scenario, gameMode, temperature: config.temperature, maxTokens: config.maxTokens })
                });
            } else {
                const systemPrompt = this.buildSystemPrompt({ worldbook, character, scenario, gameMode });
                const fullMessages = [{ role: 'system', content: systemPrompt }, ...messages];
                response = await fetch(`${config.apiUrl}/chat/completions`, {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${config.apiKey}` },
                    body: JSON.stringify({ model: config.model, messages: fullMessages, stream: true, temperature: config.temperature, max_tokens: config.maxTokens })
                });
            }
            if (!response.ok) {
                const errorText = await response.text();
                throw new Error(`API 请求失败: ${response.status} - ${errorText}`);
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
                    if (trimmed.startsWith('data: ')) {
                        const data = trimmed.slice(6);
                        if (data === '[DONE]') { onDone && onDone(fullContent); return; }
                        try {
                            const parsed = JSON.parse(data);
                            if (parsed.content !== undefined) {
                                fullContent += parsed.content;
                                onMessage && onMessage(parsed.content, fullContent);
                            } else if (parsed.choices && parsed.choices[0]) {
                                const content = parsed.choices[0].delta?.content;
                                if (content) { fullContent += content; onMessage && onMessage(content, fullContent); }
                            }
                        } catch (e) {}
                    } else if (trimmed.startsWith('event: error')) {
                        const nextLine = lines[lines.indexOf(line) + 1];
                        if (nextLine && nextLine.startsWith('data: ')) {
                            const errorData = JSON.parse(nextLine.slice(6));
                            throw new Error(errorData.error || errorData.message || '未知错误');
                        }
                    }
                }
            }
            onDone && onDone(fullContent);
        } catch (error) {
            console.error('Chat stream error:', error);
            onError && onError(error);
        }
    },
    async chat(messages, options = {}) {
        const config = this.getConfig();
        const { worldbook = null, character = null, scenario = null, gameMode = false } = options;
        try {
            let response;
            if (this.useProxy()) {
                response = await fetch('/api/chat', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ messages, model: config.model, stream: false, worldbook, character, scenario, gameMode, temperature: config.temperature, maxTokens: config.maxTokens })
                });
            } else {
                const systemPrompt = this.buildSystemPrompt({ worldbook, character, scenario, gameMode });
                const fullMessages = [{ role: 'system', content: systemPrompt }, ...messages];
                response = await fetch(`${config.apiUrl}/chat/completions`, {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${config.apiKey}` },
                    body: JSON.stringify({ model: config.model, messages: fullMessages, stream: false, temperature: config.temperature, max_tokens: config.maxTokens })
                });
            }
            if (!response.ok) throw new Error(`API 请求失败: ${response.status}`);
            const data = await response.json();
            return this.useProxy() ? data.content : (data.choices?.[0]?.message?.content || '');
        } catch (error) {
            console.error('Chat error:', error);
            throw error;
        }
    },
    buildSystemPrompt(options = {}) {
        const { worldbook = null, character = null, scenario = null, gameMode = false } = options;
        let systemPrompt = '';
        if (gameMode) {
            systemPrompt += `你是一个AI文字游戏主持人。请根据玩家的行动推进剧情，保持沉浸感和连贯性。
规则：
1. 用第三人称叙述剧情发展
2. 描述环境、人物动作和对话
3. 根据玩家选择合理推进故事
4. 保持角色性格一致性
5. 适当增加悬念和戏剧性
`;
        } else {
            systemPrompt += `你是一个AI对话助手。请自然、流畅地与用户交流。
`;
        }
        if (worldbook && worldbook.entries && worldbook.entries.length > 0) {
            systemPrompt += `【世界观设定】
以下是当前世界的背景设定，请严格遵守：
`;
            worldbook.entries.forEach((entry, index) => {
                if (entry.enabled !== false) systemPrompt += `${index + 1}. ${entry.key}: ${entry.content}\n`;
            });
            systemPrompt += '\n';
        }
        if (character) {
            systemPrompt += `【角色设定】
你正在扮演以下角色，请严格按照角色设定进行对话：
姓名：${character.name || '未知'}
性格：${character.personality || '未知'}
外貌：${character.appearance || '未知'}
背景：${character.background || '未知'}
说话风格：${character.speechStyle || '自然'}
`;
            if (character.extraInfo) systemPrompt += `其他设定：${character.extraInfo}\n`;
            systemPrompt += '\n';
        }
        if (scenario) systemPrompt += `【当前场景】\n${scenario}\n`;
        return systemPrompt;
    },
    async testConnection(apiUrl, apiKey) {
        try {
            const response = await fetch(`${apiUrl}/models`, { headers: { 'Authorization': `Bearer ${apiKey}` } });
            return response.ok;
        } catch (error) {
            console.error('Test connection error:', error);
            return false;
        }
    }
};

// ==================== 手机模拟器核心 ====================
const Phone = {
    currentApp: null,
    appHistory: [],
    init() {
        this.updateStatusBar();
        this.bindEvents();
        this.loadSettings();
        setInterval(() => this.updateStatusBar(), 1000);
    },
    updateStatusBar() {
        const now = new Date();
        const hours = now.getHours().toString().padStart(2, '0');
        const minutes = now.getMinutes().toString().padStart(2, '0');
        document.getElementById('status-time').textContent = `${hours}:${minutes}`;
        const battery = Math.floor(Math.random() * 20) + 80;
        document.getElementById('status-battery').textContent = `${battery}%`;
    },
    bindEvents() {
        document.querySelectorAll('.app-icon, .dock-icon').forEach(icon => {
            icon.addEventListener('click', () => this.openApp(icon.dataset.app));
        });
        document.querySelectorAll('.back-btn').forEach(btn => {
            btn.addEventListener('click', () => this.goBack());
        });
        document.querySelector('.home-indicator').addEventListener('click', () => this.goHome());
        document.getElementById('modal-close').addEventListener('click', () => this.closeModal());
        document.getElementById('modal').addEventListener('click', (e) => {
            if (e.target.id === 'modal') this.closeModal();
        });
    },
    openApp(appName) {
        const appScreen = document.getElementById(`${appName}-app`);
        if (!appScreen) return;
        if (this.currentApp) {
            this.appHistory.push(this.currentApp);
            const currentScreen = document.getElementById(`${this.currentApp}-app`);
            if (currentScreen) currentScreen.classList.remove('active');
        }
        document.getElementById('home-screen').classList.remove('active');
        appScreen.classList.add('active');
        this.currentApp = appName;
    },
    goBack() {
        if (this.appHistory.length > 0) {
            const prevApp = this.appHistory.pop();
            const currentScreen = document.getElementById(`${this.currentApp}-app`);
            const prevScreen = document.getElementById(`${prevApp}-app`);
            if (currentScreen) currentScreen.classList.remove('active');
            if (prevScreen) prevScreen.classList.add('active');
            this.currentApp = prevApp;
        } else {
            this.goHome();
        }
    },
    goHome() {
        if (this.currentApp) {
            const currentScreen = document.getElementById(`${this.currentApp}-app`);
            if (currentScreen) currentScreen.classList.remove('active');
        }
        document.getElementById('home-screen').classList.add('active');
        this.currentApp = null;
        this.appHistory = [];
    },
    showModal(title, content, footer = null) {
        document.getElementById('modal-title').textContent = title;
        document.getElementById('modal-body').innerHTML = content;
        const footerEl = document.getElementById('modal-footer');
        if (footer) { footerEl.innerHTML = footer; footerEl.style.display = 'flex'; }
        else { footerEl.style.display = 'none'; }
        document.getElementById('modal').classList.add('active');
    },
    closeModal() {
        document.getElementById('modal').classList.remove('active');
    },
    showToast(message, duration = 2000) {
        const toast = document.getElementById('toast');
        toast.textContent = message;
        toast.classList.add('show');
        setTimeout(() => toast.classList.remove('show'), duration);
    },
    loadSettings() {
        const settings = JSON.parse(localStorage.getItem('settings') || '{}');
        if (settings.theme) this.applyTheme(settings.theme);
        if (settings.fontSize) this.applyFontSize(settings.fontSize);
    },
    applyTheme(theme) {
        if (theme === 'auto') {
            const prefersDark = window.matchMedia('(prefers-color-scheme: dark)').matches;
            document.documentElement.setAttribute('data-theme', prefersDark ? 'dark' : 'light');
        } else {
            document.documentElement.setAttribute('data-theme', theme);
        }
    },
    applyFontSize(size) {
        const root = document.documentElement;
        switch (size) {
            case 'small': root.style.fontSize = '14px'; break;
            case 'medium': root.style.fontSize = '16px'; break;
            case 'large': root.style.fontSize = '18px'; break;
        }
    },
    generateId() {
        return Date.now().toString(36) + Math.random().toString(36).substr(2);
    },
    formatTime(timestamp) {
        const date = new Date(timestamp);
        const now = new Date();
        const diff = now - date;
        if (diff < 60000) return '刚刚';
        else if (diff < 3600000) return `${Math.floor(diff / 60000)}分钟前`;
        else if (diff < 86400000) return `${Math.floor(diff / 3600000)}小时前`;
        else return `${date.getMonth() + 1}/${date.getDate()}`;
    }
};

// ==================== AI聊天应用 ====================
const Chat = {
    chats: [],
    currentChatId: null,
    isTyping: false,
    currentCharacter: null,
    currentWorldbook: null,
    init() {
        this.loadChats();
        this.bindEvents();
        this.renderChatList();
        if (this.chats.length === 0) this.createNewChat();
        else { this.currentChatId = this.chats[0].id; this.renderMessages(); }
    },
    bindEvents() {
        document.getElementById('chat-send').addEventListener('click', () => this.sendMessage());
        document.getElementById('chat-input').addEventListener('keydown', (e) => {
            if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); this.sendMessage(); }
        });
        document.getElementById('chat-input').addEventListener('input', (e) => {
            e.target.style.height = 'auto';
            e.target.style.height = Math.min(e.target.scrollHeight, 120) + 'px';
        });
        document.querySelector('[data-action="new-chat"]').addEventListener('click', () => this.createNewChat());
        document.querySelectorAll('.chat-tools .tool-btn').forEach(btn => {
            btn.addEventListener('click', () => this.handleToolClick(btn.dataset.tool));
        });
    },
    loadChats() {
        const saved = localStorage.getItem('chat_chats');
        if (saved) this.chats = JSON.parse(saved);
    },
    saveChats() { localStorage.setItem('chat_chats', JSON.stringify(this.chats)); },
    createNewChat() {
        const newChat = { id: Phone.generateId(), title: '新对话', messages: [], createdAt: Date.now(), updatedAt: Date.now() };
        this.chats.unshift(newChat);
        this.currentChatId = newChat.id;
        this.saveChats();
        this.renderChatList();
        this.renderMessages();
    },
    getCurrentChat() { return this.chats.find(c => c.id === this.currentChatId); },
    renderChatList() {
        const list = document.getElementById('chat-list');
        list.innerHTML = '';
        this.chats.forEach(chat => {
            const item = document.createElement('div');
            item.className = `chat-item ${chat.id === this.currentChatId ? 'active' : ''}`;
            item.innerHTML = `<span class="chat-item-title">${chat.title}</span><button class="chat-item-delete" data-id="${chat.id}">×</button>`;
            item.addEventListener('click', (e) => {
                if (e.target.classList.contains('chat-item-delete')) { e.stopPropagation(); this.deleteChat(e.target.dataset.id); }
                else this.switchChat(chat.id);
            });
            list.appendChild(item);
        });
    },
    switchChat(chatId) {
        this.currentChatId = chatId;
        this.renderChatList();
        this.renderMessages();
    },
    deleteChat(chatId) {
        this.chats = this.chats.filter(c => c.id !== chatId);
        if (this.currentChatId === chatId) {
            if (this.chats.length > 0) this.currentChatId = this.chats[0].id;
            else { this.createNewChat(); return; }
        }
        this.saveChats();
        this.renderChatList();
        this.renderMessages();
    },
    renderMessages() {
        const chat = this.getCurrentChat();
        if (!chat) return;
        const container = document.getElementById('chat-messages');
        container.innerHTML = '';
        chat.messages.forEach(msg => this.appendMessage(msg.role, msg.content, false));
        container.scrollTop = container.scrollHeight;
    },
    appendMessage(role, content, animate = true) {
        const container = document.getElementById('chat-messages');
        const messageEl = document.createElement('div');
        messageEl.className = `message ${role}`;
        const bubble = document.createElement('div');
        bubble.className = 'message-bubble';
        bubble.textContent = content;
        const time = document.createElement('div');
        time.className = 'message-time';
        time.textContent = Phone.formatTime(Date.now());
        messageEl.appendChild(bubble);
        messageEl.appendChild(time);
        container.appendChild(messageEl);
        if (animate) container.scrollTop = container.scrollHeight;
        return bubble;
    },
    async sendMessage() {
        if (this.isTyping) return;
        const input = document.getElementById('chat-input');
        const text = input.value.trim();
        if (!text) return;
        const chat = this.getCurrentChat();
        if (!chat) return;
        chat.messages.push({ role: 'user', content: text, timestamp: Date.now() });
        if (chat.messages.length === 1) chat.title = text.slice(0, 20) + (text.length > 20 ? '...' : '');
        chat.updatedAt = Date.now();
        this.saveChats();
        input.value = '';
        input.style.height = 'auto';
        this.appendMessage('user', text);
        this.renderChatList();
        this.showTypingIndicator();
        this.isTyping = true;
        try {
            const worldbook = this.getCurrentWorldbook();
            const character = this.currentCharacter;
            let fullResponse = '';
            const assistantBubble = this.appendMessage('assistant', '');
            await API.chatStream({
                messages: chat.messages.map(m => ({ role: m.role, content: m.content })),
                worldbook, character, gameMode: false,
                onMessage: (chunk, full) => {
                    fullResponse = full;
                    assistantBubble.textContent = full;
                    document.getElementById('chat-messages').scrollTop = document.getElementById('chat-messages').scrollHeight;
                },
                onDone: () => {
                    chat.messages.push({ role: 'assistant', content: fullResponse, timestamp: Date.now() });
                    chat.updatedAt = Date.now();
                    this.saveChats();
                    this.hideTypingIndicator();
                    this.isTyping = false;
                },
                onError: (error) => {
                    assistantBubble.textContent = `❌ 错误: ${error.message}`;
                    assistantBubble.style.color = 'var(--danger-color)';
                    this.hideTypingIndicator();
                    this.isTyping = false;
                }
            });
        } catch (error) {
            console.error('Send message error:', error);
            this.appendMessage('assistant', `❌ 发送失败: ${error.message}`);
            this.hideTypingIndicator();
            this.isTyping = false;
        }
    },
    showTypingIndicator() {
        const container = document.getElementById('chat-messages');
        const typing = document.createElement('div');
        typing.className = 'message assistant typing';
        typing.id = 'typing-indicator';
        typing.innerHTML = `<div class="message-bubble"><span class="typing-dot"></span><span class="typing-dot"></span><span class="typing-dot"></span></div>`;
        container.appendChild(typing);
        container.scrollTop = container.scrollHeight;
    },
    hideTypingIndicator() {
        const indicator = document.getElementById('typing-indicator');
        if (indicator) indicator.remove();
    },
    handleToolClick(tool) {
        switch (tool) {
            case 'emoji': this.showEmojiPicker(); break;
            case 'character': this.showCharacterSelector(); break;
            case 'worldbook': this.showWorldbookSelector(); break;
        }
    },
    showEmojiPicker() {
        const emojis = ['😀', '😂', '🤣', '😊', '😍', '🥰', '😎', '🤔', '😴', '😭', '😡', '🥺', '👍', '👎', '❤️', '🔥', '✨', '🎉', '💪', '👏', '🙏', '💯', '⭐', '🌟'];
        let html = '<div class="emoji-picker">';
        emojis.forEach(emoji => { html += `<div class="emoji-item" data-emoji="${emoji}">${emoji}</div>`; });
        html += '</div>';
        Phone.showModal('表情', html);
        setTimeout(() => {
            document.querySelectorAll('.emoji-item').forEach(item => {
                item.addEventListener('click', () => {
                    document.getElementById('chat-input').value += item.dataset.emoji;
                    document.getElementById('chat-input').focus();
                    Phone.closeModal();
                });
            });
        }, 100);
    },
    showCharacterSelector() {
        const characters = JSON.parse(localStorage.getItem('worldbook_characters') || '[]');
        let html = '<div class="character-selector">';
        html += `<div class="character-option ${!this.currentCharacter ? 'selected' : ''}" data-id=""><div class="character-option-name">默认助手</div><div class="character-option-desc">通用AI助手</div></div>`;
        characters.forEach(char => {
            html += `<div class="character-option ${this.currentCharacter?.id === char.id ? 'selected' : ''}" data-id="${char.id}"><div class="character-option-name">${char.name}</div><div class="character-option-desc">${char.personality || '暂无描述'}</div></div>`;
        });
        html += '</div>';
        Phone.showModal('选择角色', html);
        setTimeout(() => {
            document.querySelectorAll('.character-option').forEach(option => {
                option.addEventListener('click', () => {
                    const charId = option.dataset.id;
                    this.currentCharacter = charId ? characters.find(c => c.id === charId) : null;
                    Phone.closeModal();
                    Phone.showToast(this.currentCharacter ? `已选择: ${this.currentCharacter.name}` : '已切换为默认助手');
                });
            });
        }, 100);
    },
    showWorldbookSelector() {
        const worlds = JSON.parse(localStorage.getItem('worldbook_worlds') || '[]');
        let html = '<div class="character-selector">';
        html += `<div class="character-option ${!this.currentWorldbook ? 'selected' : ''}" data-id=""><div class="character-option-name">无世界观</div><div class="character-option-desc">不使用世界书设定</div></div>`;
        worlds.forEach(world => {
            html += `<div class="character-option ${this.currentWorldbook?.id === world.id ? 'selected' : ''}" data-id="${world.id}"><div class="character-option-name">${world.name}</div><div class="character-option-desc">${world.description || '暂无描述'}</div></div>`;
        });
        html += '</div>';
        Phone.showModal('选择世界观', html);
        setTimeout(() => {
            document.querySelectorAll('.character-option').forEach(option => {
                option.addEventListener('click', () => {
                    const worldId = option.dataset.id;
                    this.currentWorldbook = worldId ? worlds.find(w => w.id === worldId) : null;
                    Phone.closeModal();
                    Phone.showToast(this.currentWorldbook ? `已加载: ${this.currentWorldbook.name}` : '已清除世界观');
                });
            });
        }, 100);
    },
    getCurrentWorldbook() {
        if (!this.currentWorldbook) return null;
        return { entries: this.currentWorldbook.entries || [] };
    }
};

// ==================== AI文游应用 ====================
const Game = {
    currentGame: null,
    isGenerating: false,
    saves: [],
    attributes: { health: 100, mana: 50, stamina: 100, gold: 0 },
    currentCharacter: null,
    currentWorld: null,
    init() {
        this.loadSaves();
        this.loadAttributes();
        this.bindEvents();
        this.renderAttributes();
        this.renderSaves();
        const savedGame = localStorage.getItem('game_current');
        if (savedGame) {
            this.currentGame = JSON.parse(savedGame);
            this.renderStory();
            this.updateGameInfo();
        } else {
            this.showStartScreen();
        }
    },
    bindEvents() {
        document.getElementById('game-submit').addEventListener('click', () => this.submitAction());
        document.getElementById('game-input').addEventListener('keydown', (e) => { if (e.key === 'Enter') this.submitAction(); });
        document.getElementById('btn-save').addEventListener('click', () => this.saveGame());
        document.getElementById('btn-load').addEventListener('click', () => this.showLoadDialog());
        document.querySelector('[data-action="game-menu"]').addEventListener('click', () => this.toggleSidebar());
    },
    showStartScreen() {
        const story = document.getElementById('game-story');
        story.innerHTML = `
            <div style="text-align: center; padding: 40px 20px;">
                <div style="font-size: 64px; margin-bottom: 20px;">🎮</div>
                <h2 style="font-size: 24px; margin-bottom: 12px; color: var(--text-primary);">AI文游</h2>
                <p style="color: var(--text-tertiary); margin-bottom: 30px;">开启你的冒险之旅</p>
                <button class="btn-primary" onclick="Game.startNewGame()">开始新游戏</button>
                <button class="btn-secondary" onclick="Game.showLoadDialog()">读取存档</button>
                <button class="btn-secondary" onclick="Game.selectCharacter()">选择角色</button>
                <button class="btn-secondary" onclick="Game.selectWorld()">选择世界</button>
            </div>
        `;
    },
    startNewGame() {
        this.currentGame = { id: Phone.generateId(), story: [], messages: [], createdAt: Date.now(), updatedAt: Date.now() };
        this.attributes = { health: 100, mana: 50, stamina: 100, gold: 0 };
        this.saveCurrentGame();
        this.saveAttributes();
        this.renderAttributes();
        this.updateGameInfo();
        this.generateOpening();
    },
    async generateOpening() {
        this.isGenerating = true;
        document.getElementById('game-submit').disabled = true;
        const story = document.getElementById('game-story');
        story.innerHTML = '<div class="story-paragraph">正在生成世界...</div>';
        try {
            const worldbook = this.getCurrentWorldbook();
            const character = this.currentCharacter;
            const prompt = `请生成一个文字冒险游戏的开场剧情。
要求：
1. 描述主角所处的环境和背景
2. 介绍当前的情境和目标
3. 给出3-4个可选的行动方向
4. 保持悬念和探索感
5. 用中文，第三人称叙述
格式：
先用一段文字描述开场场景，然后列出可选行动。`;
            let fullResponse = '';
            const storyEl = document.createElement('div');
            storyEl.className = 'story-paragraph';
            story.innerHTML = '';
            story.appendChild(storyEl);
            await API.chatStream({
                messages: [{ role: 'user', content: prompt }],
                worldbook, character, gameMode: true,
                onMessage: (chunk, full) => {
                    fullResponse = full;
                    storyEl.textContent = full;
                    story.scrollTop = story.scrollHeight;
                },
                onDone: () => {
                    this.currentGame.story.push({ type: 'narration', content: fullResponse, timestamp: Date.now() });
                    this.currentGame.messages.push({ role: 'assistant', content: fullResponse });
                    this.saveCurrentGame();
                    this.generateActionOptions(fullResponse);
                    this.isGenerating = false;
                    document.getElementById('game-submit').disabled = false;
                },
                onError: (error) => {
                    storyEl.textContent = `❌ 生成失败: ${error.message}`;
                    this.isGenerating = false;
                    document.getElementById('game-submit').disabled = false;
                }
            });
        } catch (error) {
            console.error('Generate opening error:', error);
            this.isGenerating = false;
            document.getElementById('game-submit').disabled = false;
        }
    },
    generateActionOptions(context) {
        const actions = ['继续探索', '观察周围环境', '与附近的人交谈', '休息一下'];
        this.renderActionOptions(actions);
    },
    renderActionOptions(actions) {
        const container = document.getElementById('game-actions');
        container.innerHTML = '';
        actions.forEach(action => {
            const btn = document.createElement('button');
            btn.className = 'action-btn';
            btn.textContent = action;
            btn.addEventListener('click', () => {
                document.getElementById('game-input').value = action;
                this.submitAction();
            });
            container.appendChild(btn);
        });
    },
    async submitAction() {
        if (this.isGenerating || !this.currentGame) return;
        const input = document.getElementById('game-input');
        const action = input.value.trim();
        if (!action) return;
        this.isGenerating = true;
        document.getElementById('game-submit').disabled = true;
        this.currentGame.story.push({ type: 'action', content: action, timestamp: Date.now() });
        this.currentGame.messages.push({ role: 'user', content: action });
        this.saveCurrentGame();
        const story = document.getElementById('game-story');
        const actionEl = document.createElement('div');
        actionEl.className = 'story-paragraph story-action';
        actionEl.textContent = `> ${action}`;
        story.appendChild(actionEl);
        input.value = '';
        try {
            const worldbook = this.getCurrentWorldbook();
            const character = this.currentCharacter;
            let fullResponse = '';
            const responseEl = document.createElement('div');
            responseEl.className = 'story-paragraph';
            story.appendChild(responseEl);
            await API.chatStream({
                messages: this.currentGame.messages.map(m => ({ role: m.role, content: m.content })),
                worldbook, character, gameMode: true,
                onMessage: (chunk, full) => {
                    fullResponse = full;
                    responseEl.textContent = full;
                    story.scrollTop = story.scrollHeight;
                },
                onDone: () => {
                    this.currentGame.story.push({ type: 'narration', content: fullResponse, timestamp: Date.now() });
                    this.currentGame.messages.push({ role: 'assistant', content: fullResponse });
                    this.saveCurrentGame();
                    this.generateActionOptions(fullResponse);
                    this.updateRandomAttributes();
                    this.isGenerating = false;
                    document.getElementById('game-submit').disabled = false;
                },
                onError: (error) => {
                    responseEl.textContent = `❌ 生成失败: ${error.message}`;
                    this.isGenerating = false;
                    document.getElementById('game-submit').disabled = false;
                }
            });
        } catch (error) {
            console.error('Submit action error:', error);
            this.isGenerating = false;
            document.getElementById('game-submit').disabled = false;
        }
    },
    renderStory() {
        if (!this.currentGame) return;
        const story = document.getElementById('game-story');
        story.innerHTML = '';
        this.currentGame.story.forEach(item => {
            const el = document.createElement('div');
            el.className = `story-paragraph ${item.type === 'action' ? 'story-action' : ''}`;
            el.textContent = item.type === 'action' ? `> ${item.content}` : item.content;
            story.appendChild(el);
        });
        story.scrollTop = story.scrollHeight;
    },
    renderAttributes() {
        const container = document.getElementById('game-attributes');
        container.innerHTML = '';
        const attrConfig = [
            { key: 'health', label: '生命值', class: 'health', icon: '❤️' },
            { key: 'mana', label: '法力值', class: 'mana', icon: '💎' },
            { key: 'stamina', label: '体力值', class: 'stamina', icon: '⚡' },
            { key: 'gold', label: '金币', class: 'gold', icon: '💰' }
        ];
        attrConfig.forEach(attr => {
            const value = this.attributes[attr.key] || 0;
            const max = attr.key === 'gold' ? 9999 : 100;
            const percent = Math.min((value / max) * 100, 100);
            const bar = document.createElement('div');
            bar.className = 'attribute-bar';
            bar.innerHTML = `
                <div class="attribute-label"><span>${attr.icon} ${attr.label}</span><span>${value}${attr.key === 'gold' ? '' : '/' + max}</span></div>
                <div class="attribute-track"><div class="attribute-fill ${attr.class}" style="width: ${percent}%"></div></div>
            `;
            container.appendChild(bar);
        });
    },
    updateRandomAttributes() {
        const changes = {
            health: Math.floor(Math.random() * 10) - 5,
            stamina: Math.floor(Math.random() * 15) - 10,
            gold: Math.floor(Math.random() * 20) - 5
        };
        Object.keys(changes).forEach(key => {
            this.attributes[key] = Math.max(0, Math.min(key === 'gold' ? 9999 : 100, this.attributes[key] + changes[key]));
        });
        this.saveAttributes();
        this.renderAttributes();
    },
    saveCurrentGame() {
        if (this.currentGame) {
            this.currentGame.updatedAt = Date.now();
            localStorage.setItem('game_current', JSON.stringify(this.currentGame));
        }
    },
    saveAttributes() { localStorage.setItem('game_attributes', JSON.stringify(this.attributes)); },
    loadAttributes() {
        const saved = localStorage.getItem('game_attributes');
        if (saved) this.attributes = JSON.parse(saved);
    },
    saveGame() {
        if (!this.currentGame) return;
        const saveName = prompt('输入存档名称:', `存档 ${this.saves.length + 1}`);
        if (!saveName) return;
        const saveData = {
            id: Phone.generateId(), name: saveName,
            game: JSON.parse(JSON.stringify(this.currentGame)),
            attributes: JSON.parse(JSON.stringify(this.attributes)),
            savedAt: Date.now()
        };
        this.saves.unshift(saveData);
        this.saveSaves();
        this.renderSaves();
        Phone.showToast('存档成功');
    },
    loadSaves() {
        const saved = localStorage.getItem('game_saves');
        if (saved) this.saves = JSON.parse(saved);
    },
    saveSaves() { localStorage.setItem('game_saves', JSON.stringify(this.saves)); },
    renderSaves() {
        const list = document.getElementById('save-list');
        list.innerHTML = '';
        if (this.saves.length === 0) {
            list.innerHTML = '<p style="color: var(--text-tertiary); font-size: 13px; text-align: center; padding: 20px 0;">暂无存档</p>';
            return;
        }
        this.saves.forEach(save => {
            const item = document.createElement('div');
            item.className = 'save-item';
            item.innerHTML = `<span class="save-name">${save.name}</span><span class="save-time">${Phone.formatTime(save.savedAt)}</span>`;
            item.addEventListener('click', () => {
                if (confirm(`确定读取存档 "${save.name}" 吗？当前进度将丢失。`)) this.loadSave(save);
            });
            list.appendChild(item);
        });
    },
    loadSave(save) {
        this.currentGame = JSON.parse(JSON.stringify(save.game));
        this.attributes = JSON.parse(JSON.stringify(save.attributes));
        this.saveCurrentGame();
        this.saveAttributes();
        this.renderStory();
        this.renderAttributes();
        this.updateGameInfo();
        Phone.closeModal();
        Phone.showToast('读取成功');
    },
    showLoadDialog() {
        if (this.saves.length === 0) { Phone.showToast('暂无存档'); return; }
        let html = '<div style="max-height: 300px; overflow-y: auto;">';
        this.saves.forEach(save => {
            html += `<div class="save-item" style="cursor: pointer;" onclick="Game.loadSaveById('${save.id}')"><span class="save-name">${save.name}</span><span class="save-time">${Phone.formatTime(save.savedAt)}</span></div>`;
        });
        html += '</div>';
        Phone.showModal('读取存档', html);
    },
    loadSaveById(id) {
        const save = this.saves.find(s => s.id === id);
        if (save) this.loadSave(save);
    },
    toggleSidebar() { document.querySelector('.game-sidebar').classList.toggle('open'); },
    updateGameInfo() {
        document.getElementById('game-character').textContent = this.currentCharacter ? this.currentCharacter.name : '冒险者';
        document.getElementById('game-world').textContent = this.currentWorld ? this.currentWorld.name : '默认世界';
    },
    selectCharacter() {
        const characters = JSON.parse(localStorage.getItem('worldbook_characters') || '[]');
        let html = '<div class="character-selector">';
        html += `<div class="character-option ${!this.currentCharacter ? 'selected' : ''}" onclick="Game.setCharacter(null)"><div class="character-option-name">默认冒险者</div><div class="character-option-desc">普通的冒险者</div></div>`;
        characters.forEach(char => {
            html += `<div class="character-option ${this.currentCharacter?.id === char.id ? 'selected' : ''}" onclick="Game.setCharacter('${char.id}')"><div class="character-option-name">${char.name}</div><div class="character-option-desc">${char.personality || '暂无描述'}</div></div>`;
        });
        html += '</div>';
        Phone.showModal('选择角色', html);
    },
    setCharacter(charId) {
        if (charId) {
            const characters = JSON.parse(localStorage.getItem('worldbook_characters') || '[]');
            this.currentCharacter = characters.find(c => c.id === charId);
        } else {
            this.currentCharacter = null;
        }
        this.updateGameInfo();
        Phone.closeModal();
        Phone.showToast('角色已更新');
    },
    selectWorld() {
        const worlds = JSON.parse(localStorage.getItem('worldbook_worlds') || '[]');
        let html = '<div class="character-selector">';
        html += `<div class="character-option ${!this.currentWorld ? 'selected' : ''}" onclick="Game.setWorld(null)"><div class="character-option-name">默认世界</div><div class="character-option-desc">通用奇幻世界</div></div>`;
        worlds.forEach(world => {
            html += `<div class="character-option ${this.currentWorld?.id === world.id ? 'selected' : ''}" onclick="Game.setWorld('${world.id}')"><div class="character-option-name">${world.name}</div><div class="character-option-desc">${world.description || '暂无描述'}</div></div>`;
        });
        html += '</div>';
        Phone.showModal('选择世界', html);
    },
    setWorld(worldId) {
        if (worldId) {
            const worlds = JSON.parse(localStorage.getItem('worldbook_worlds') || '[]');
            this.currentWorld = worlds.find(w => w.id === worldId);
        } else {
            this.currentWorld = null;
        }
        this.updateGameInfo();
        Phone.closeModal();
        Phone.showToast('世界已更新');
    },
    getCurrentWorldbook() {
        if (!this.currentWorld) return null;
        return { entries: this.currentWorld.entries || [] };
    }
};

// ==================== 世界书系统 ====================
const Worldbook = {
    worlds: [],
    characters: [],
    locations: [],
    currentTab: 'worlds',
    init() {
        this.loadData();
        this.bindEvents();
        this.renderAll();
        if (this.worlds.length === 0 && this.characters.length === 0) this.addSampleData();
    },
    bindEvents() {
        document.querySelectorAll('.worldbook-tabs .tab-btn').forEach(btn => {
            btn.addEventListener('click', () => this.switchTab(btn.dataset.tab));
        });
        document.querySelector('[data-action="add-world"]').addEventListener('click', () => this.showAddDialog(this.currentTab));
        document.getElementById('btn-import').addEventListener('click', () => this.importJSON());
        document.getElementById('btn-export').addEventListener('click', () => this.exportJSON());
    },
    loadData() {
        this.worlds = JSON.parse(localStorage.getItem('worldbook_worlds') || '[]');
        this.characters = JSON.parse(localStorage.getItem('worldbook_characters') || '[]');
        this.locations = JSON.parse(localStorage.getItem('worldbook_locations') || '[]');
    },
    saveData() {
        localStorage.setItem('worldbook_worlds', JSON.stringify(this.worlds));
        localStorage.setItem('worldbook_characters', JSON.stringify(this.characters));
        localStorage.setItem('worldbook_locations', JSON.stringify(this.locations));
    },
    switchTab(tab) {
        this.currentTab = tab;
        document.querySelectorAll('.worldbook-tabs .tab-btn').forEach(btn => {
            btn.classList.toggle('active', btn.dataset.tab === tab);
        });
        document.querySelectorAll('.tab-content').forEach(content => {
            content.classList.toggle('active', content.id === `tab-${tab}`);
        });
    },
    renderAll() {
        this.renderWorlds();
        this.renderCharacters();
        this.renderLocations();
    },
    renderWorlds() {
        const list = document.getElementById('world-list');
        list.innerHTML = '';
        const addBtn = document.createElement('div');
        addBtn.className = 'add-card';
        addBtn.innerHTML = `<div class="add-card-icon">+</div><div class="add-card-text">新建世界观</div>`;
        addBtn.addEventListener('click', () => this.showAddDialog('worlds'));
        list.appendChild(addBtn);
        this.worlds.forEach(world => {
            const card = document.createElement('div');
            card.className = 'world-card';
            card.innerHTML = `
                <div class="card-header"><span class="card-title">${world.name}</span><div class="card-actions"><button class="card-action-btn" data-action="edit">✏️</button><button class="card-action-btn" data-action="delete">🗑️</button></div></div>
                <div class="card-desc">${world.description || '暂无描述'}</div>
                <div class="card-meta"><span>${world.entries?.length || 0} 条设定</span><span>${Phone.formatTime(world.updatedAt || world.createdAt)}</span></div>
            `;
            card.querySelector('[data-action="edit"]').addEventListener('click', (e) => { e.stopPropagation(); this.showEditDialog('world', world); });
            card.querySelector('[data-action="delete"]').addEventListener('click', (e) => { e.stopPropagation(); this.deleteItem('world', world.id); });
            card.addEventListener('click', () => this.showEntriesDialog(world));
            list.appendChild(card);
        });
    },
    renderCharacters() {
        const list = document.getElementById('character-list');
        list.innerHTML = '';
        const addBtn = document.createElement('div');
        addBtn.className = 'add-card';
        addBtn.innerHTML = `<div class="add-card-icon">+</div><div class="add-card-text">新建角色卡</div>`;
        addBtn.addEventListener('click', () => this.showAddDialog('characters'));
        list.appendChild(addBtn);
        this.characters.forEach(char => {
            const card = document.createElement('div');
            card.className = 'character-card';
            card.innerHTML = `
                <div class="card-header"><span class="card-title">${char.name}</span><div class="card-actions"><button class="card-action-btn" data-action="edit">✏️</button><button class="card-action-btn" data-action="delete">🗑️</button></div></div>
                <div class="card-desc">${char.personality || '暂无描述'}</div>
                <div class="card-meta"><span>${char.appearance || '未知外貌'}</span></div>
            `;
            card.querySelector('[data-action="edit"]').addEventListener('click', (e) => { e.stopPropagation(); this.showEditDialog('character', char); });
            card.querySelector('[data-action="delete"]').addEventListener('click', (e) => { e.stopPropagation(); this.deleteItem('character', char.id); });
            list.appendChild(card);
        });
    },
    renderLocations() {
        const list = document.getElementById('location-list');
        list.innerHTML = '';
        const addBtn = document.createElement('div');
        addBtn.className = 'add-card';
        addBtn.innerHTML = `<div class="add-card-icon">+</div><div class="add-card-text">新建地点卡</div>`;
        addBtn.addEventListener('click', () => this.showAddDialog('locations'));
        list.appendChild(addBtn);
        this.locations.forEach(loc => {
            const card = document.createElement('div');
            card.className = 'location-card';
            card.innerHTML = `
                <div class="card-header"><span class="card-title">${loc.name}</span><div class="card-actions"><button class="card-action-btn" data-action="edit">✏️</button><button class="card-action-btn" data-action="delete">🗑️</button></div></div>
                <div class="card-desc">${loc.description || '暂无描述'}</div>
                <div class="card-meta"><span>${loc.type || '地点'}</span></div>
            `;
            card.querySelector('[data-action="edit"]').addEventListener('click', (e) => { e.stopPropagation(); this.showEditDialog('location', loc); });
            card.querySelector('[data-action="delete"]').addEventListener('click', (e) => { e.stopPropagation(); this.deleteItem('location', loc.id); });
            list.appendChild(card);
        });
    },
    showAddDialog(type) {
        const titles = { worlds: '新建世界观', characters: '新建角色卡', locations: '新建地点卡' };
        const itemType = type === 'worlds' ? 'world' : type === 'characters' ? 'character' : 'location';
        const content = this.getEditorForm(itemType, {});
        Phone.showModal(titles[type], content, `
            <button class="btn-secondary" onclick="Phone.closeModal()">取消</button>
            <button class="btn-primary" onclick="Worldbook.saveNew('${itemType}')">创建</button>
        `);
    },
    showEditDialog(type, item) {
        const titles = { world: '编辑世界观', character: '编辑角色卡', location: '编辑地点卡' };
        const content = this.getEditorForm(type, item);
        Phone.showModal(titles[type], content, `
            <button class="btn-secondary" onclick="Phone.closeModal()">取消</button>
            <button class="btn-primary" onclick="Worldbook.saveEdit('${type}', '${item.id}')">保存</button>
        `);
    },
    getEditorForm(type, item) {
        if (type === 'world') {
            return `<div class="editor-form">
                <label>名称</label><input type="text" id="edit-name" value="${item.name || ''}" placeholder="输入世界观名称">
                <label>描述</label><textarea id="edit-description" placeholder="简要描述这个世界...">${item.description || ''}</textarea>
            </div>`;
        } else if (type === 'character') {
            return `<div class="editor-form">
                <label>姓名</label><input type="text" id="edit-name" value="${item.name || ''}" placeholder="角色姓名">
                <label>性格</label><input type="text" id="edit-personality" value="${item.personality || ''}" placeholder="性格特点">
                <label>外貌</label><input type="text" id="edit-appearance" value="${item.appearance || ''}" placeholder="外貌描述">
                <label>背景故事</label><textarea id="edit-background" placeholder="角色背景...">${item.background || ''}</textarea>
                <label>说话风格</label><input type="text" id="edit-speechStyle" value="${item.speechStyle || ''}" placeholder="说话方式">
            </div>`;
        } else if (type === 'location') {
            return `<div class="editor-form">
                <label>名称</label><input type="text" id="edit-name" value="${item.name || ''}" placeholder="地点名称">
                <label>类型</label><input type="text" id="edit-type" value="${item.type || ''}" placeholder="地点类型（城市/森林/地牢等）">
                <label>描述</label><textarea id="edit-description" placeholder="地点描述...">${item.description || ''}</textarea>
            </div>`;
        }
        return '';
    },
    saveNew(type) {
        const newItem = { id: Phone.generateId(), createdAt: Date.now(), updatedAt: Date.now() };
        if (type === 'world') {
            newItem.name = document.getElementById('edit-name').value || '未命名世界';
            newItem.description = document.getElementById('edit-description').value;
            newItem.entries = [];
            this.worlds.push(newItem);
        } else if (type === 'character') {
            newItem.name = document.getElementById('edit-name').value || '未命名角色';
            newItem.personality = document.getElementById('edit-personality').value;
            newItem.appearance = document.getElementById('edit-appearance').value;
            newItem.background = document.getElementById('edit-background').value;
            newItem.speechStyle = document.getElementById('edit-speechStyle').value;
            this.characters.push(newItem);
        } else if (type === 'location') {
            newItem.name = document.getElementById('edit-name').value || '未命名地点';
            newItem.type = document.getElementById('edit-type').value;
            newItem.description = document.getElementById('edit-description').value;
            this.locations.push(newItem);
        }
        this.saveData();
        this.renderAll();
        Phone.closeModal();
        Phone.showToast('创建成功');
    },
    saveEdit(type, id) {
        let item, list;
        if (type === 'world') { list = this.worlds; item = this.worlds.find(w => w.id === id); }
        else if (type === 'character') { list = this.characters; item = this.characters.find(c => c.id === id); }
        else if (type === 'location') { list = this.locations; item = this.locations.find(l => l.id === id); }
        if (!item) return;
        if (type === 'world') {
            item.name = document.getElementById('edit-name').value;
            item.description = document.getElementById('edit-description').value;
        } else if (type === 'character') {
            item.name = document.getElementById('edit-name').value;
            item.personality = document.getElementById('edit-personality').value;
            item.appearance = document.getElementById('edit-appearance').value;
            item.background = document.getElementById('edit-background').value;
            item.speechStyle = document.getElementById('edit-speechStyle').value;
        } else if (type === 'location') {
            item.name = document.getElementById('edit-name').value;
            item.type = document.getElementById('edit-type').value;
            item.description = document.getElementById('edit-description').value;
        }
        item.updatedAt = Date.now();
        this.saveData();
        this.renderAll();
        Phone.closeModal();
        Phone.showToast('保存成功');
    },
    deleteItem(type, id) {
        if (!confirm('确定要删除吗？此操作不可恢复。')) return;
        if (type === 'world') this.worlds = this.worlds.filter(w => w.id !== id);
        else if (type === 'character') this.characters = this.characters.filter(c => c.id !== id);
        else if (type === 'location') this.locations = this.locations.filter(l => l.id !== id);
        this.saveData();
        this.renderAll();
        Phone.showToast('已删除');
    },
    showEntriesDialog(world) {
        let entriesHtml = '';
        if (world.entries && world.entries.length > 0) {
            entriesHtml = '<div class="entries-list">';
            world.entries.forEach((entry, index) => {
                entriesHtml += `
                    <div class="entry-item">
                        <div class="entry-content"><div class="entry-key">${entry.key}</div><div class="entry-text">${entry.content}</div></div>
                        <div class="entry-toggle"><label class="switch"><input type="checkbox" ${entry.enabled !== false ? 'checked' : ''} onchange="Worldbook.toggleEntry('${world.id}', ${index})"><span class="slider"></span></label></div>
                    </div>
                `;
            });
            entriesHtml += '</div>';
        } else {
            entriesHtml = '<p style="color: var(--text-tertiary); text-align: center; padding: 20px;">暂无设定条目</p>';
        }
        const content = `
            <div>
                <h3 style="margin-bottom: 12px; font-size: 16px;">${world.name} - 设定条目</h3>
                ${entriesHtml}
                <div style="margin-top: 16px; padding-top: 16px; border-top: 1px solid var(--border-color);">
                    <label>关键词</label><input type="text" id="new-entry-key" placeholder="例如：魔法体系、历史事件">
                    <label>内容</label><textarea id="new-entry-content" placeholder="设定详情..." rows="3"></textarea>
                </div>
            </div>
        `;
        Phone.showModal('世界观设定', content, `
            <button class="btn-secondary" onclick="Phone.closeModal()">关闭</button>
            <button class="btn-primary" onclick="Worldbook.addEntry('${world.id}')">添加条目</button>
        `);
    },
    addEntry(worldId) {
        const world = this.worlds.find(w => w.id === worldId);
        if (!world) return;
        const key = document.getElementById('new-entry-key').value.trim();
        const content = document.getElementById('new-entry-content').value.trim();
        if (!key || !content) { Phone.showToast('请填写完整'); return; }
        if (!world.entries) world.entries = [];
        world.entries.push({ key, content, enabled: true, createdAt: Date.now() });
        world.updatedAt = Date.now();
        this.saveData();
        this.renderAll();
        this.showEntriesDialog(world);
        Phone.showToast('添加成功');
    },
    toggleEntry(worldId, index) {
        const world = this.worlds.find(w => w.id === worldId);
        if (!world || !world.entries || !world.entries[index]) return;
        world.entries[index].enabled = !world.entries[index].enabled;
        world.updatedAt = Date.now();
        this.saveData();
    },
    exportJSON() {
        const data = { version: '1.0', exportedAt: Date.now(), worlds: this.worlds, characters: this.characters, locations: this.locations };
        const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = `worldbook_export_${Date.now()}.json`;
        a.click();
        URL.revokeObjectURL(url);
        Phone.showToast('导出成功');
    },
    importJSON() {
        const input = document.createElement('input');
        input.type = 'file';
        input.accept = '.json';
        input.onchange = (e) => {
            const file = e.target.files[0];
            if (!file) return;
            const reader = new FileReader();
            reader.onload = (e) => {
                try {
                    const data = JSON.parse(e.target.result);
                    if (data.worlds) this.worlds = [...this.worlds, ...data.worlds];
                    if (data.characters) this.characters = [...this.characters, ...data.characters];
                    if (data.locations) this.locations = [...this.locations, ...data.locations];
                    this.saveData();
                    this.renderAll();
                    Phone.showToast('导入成功');
                } catch (error) {
                    Phone.showToast('导入失败：文件格式错误');
                }
            };
            reader.readAsText(file);
        };
        input.click();
    },
    addSampleData() {
        this.worlds = [{
            id: Phone.generateId(), name: '奇幻大陆', description: '一个充满魔法与冒险的中世纪奇幻世界',
            entries: [
                { key: '魔法体系', content: '魔法分为元素魔法、召唤魔法、死灵魔法三大类，需要天赋和刻苦修炼才能掌握。', enabled: true },
                { key: '历史背景', content: '三百年前，人类联合精灵、矮人击退了魔族入侵，建立了现在的王国体系。', enabled: true },
                { key: '货币系统', content: '通用货币为金币、银币、铜币，1金币=100银币=10000铜币。', enabled: true }
            ],
            createdAt: Date.now(), updatedAt: Date.now()
        }];
        this.characters = [
            { id: Phone.generateId(), name: '艾琳娜', personality: '温柔善良，勇敢坚强', appearance: '金色长发，蓝色眼眸，身穿白色法师袍', background: '出身贵族家庭的天才法师，为了寻找失踪的父亲踏上冒险之旅。', speechStyle: '优雅礼貌，偶尔会露出小女生的一面', createdAt: Date.now(), updatedAt: Date.now() },
            { id: Phone.generateId(), name: '雷恩', personality: '豪爽仗义，有点好色但很有原则', appearance: '黑色短发，身材魁梧，背着一把巨剑', background: '佣兵公会的S级佣兵，曾经是王国骑士团的成员。', speechStyle: '大大咧咧，说话直接，喜欢用"老子"自称', createdAt: Date.now(), updatedAt: Date.now() }
        ];
        this.locations = [
            { id: Phone.generateId(), name: '王都', type: '城市', description: '王国的首都，繁华的商业中心，也是王宫所在地。', createdAt: Date.now(), updatedAt: Date.now() },
            { id: Phone.generateId(), name: '幽暗森林', type: '森林', description: '位于王国边境的神秘森林，据说里面住着精灵和各种魔兽。', createdAt: Date.now(), updatedAt: Date.now() }
        ];
        this.saveData();
        this.renderAll();
    }
};

// ==================== 剧本编辑器 ====================
const Editor = {
    nodes: [],
    connections: [],
    selectedNode: null,
    selectedConnection: null,
    isDragging: false,
    dragNode: null,
    dragOffset: { x: 0, y: 0 },
    isConnecting: false,
    connectionStart: null,
    currentScript: null,
    previewMode: false,
    previewCurrentNode: null,
    init() {
        this.loadScript();
        this.bindEvents();
        this.renderNodes();
        this.renderConnections();
        if (this.nodes.length === 0) this.addNode('start', 100, 100, '游戏开始', '欢迎来到这个世界，你的冒险即将开始...');
    },
    bindEvents() {
        document.querySelectorAll('.editor-toolbar .tool-btn').forEach(btn => {
            btn.addEventListener('click', () => this.handleToolClick(btn.dataset.tool));
        });
        const canvas = document.getElementById('editor-canvas');
        canvas.addEventListener('mousedown', (e) => this.onMouseDown(e));
        canvas.addEventListener('mousemove', (e) => this.onMouseMove(e));
        canvas.addEventListener('mouseup', (e) => this.onMouseUp(e));
        canvas.addEventListener('mouseleave', (e) => this.onMouseUp(e));
        canvas.addEventListener('touchstart', (e) => this.onTouchStart(e));
        canvas.addEventListener('touchmove', (e) => this.onTouchMove(e));
        canvas.addEventListener('touchend', (e) => this.onTouchEnd(e));
        document.getElementById('btn-add-branch').addEventListener('click', () => this.addBranch());
        document.getElementById('node-title').addEventListener('input', (e) => {
            if (this.selectedNode) { this.selectedNode.title = e.target.value; this.renderNodes(); this.saveScript(); }
        });
        document.getElementById('node-content').addEventListener('input', (e) => {
            if (this.selectedNode) { this.selectedNode.content = e.target.value; this.renderNodes(); this.saveScript(); }
        });
    },
    handleToolClick(tool) {
        switch (tool) {
            case 'add-node': this.addNode('normal', 200, 200, '新节点', '在这里输入剧情内容...'); break;
            case 'add-branch': if (this.selectedNode) this.addBranch(); else Phone.showToast('请先选择一个节点'); break;
            case 'preview': this.togglePreview(); break;
            case 'save': this.saveScript(); Phone.showToast('保存成功'); break;
        }
    },
    addNode(type, x, y, title, content) {
        const node = { id: Phone.generateId(), type: type || 'normal', x: x, y: y, title: title || '新节点', content: content || '', branches: [] };
        this.nodes.push(node);
        this.selectedNode = node;
        this.renderNodes();
        this.renderConnections();
        this.updatePropertiesPanel();
        this.saveScript();
        return node;
    },
    deleteNode(nodeId) {
        this.nodes = this.nodes.filter(n => n.id !== nodeId);
        this.connections = this.connections.filter(c => c.from !== nodeId && c.to !== nodeId);
        if (this.selectedNode?.id === nodeId) { this.selectedNode = null; this.updatePropertiesPanel(); }
        this.renderNodes();
        this.renderConnections();
        this.saveScript();
    },
    addBranch() {
        if (!this.selectedNode) return;
        const branch = { id: Phone.generateId(), text: '新选项', targetNode: null };
        this.selectedNode.branches.push(branch);
        this.renderBranches();
        this.saveScript();
    },
    deleteBranch(branchId) {
        if (!this.selectedNode) return;
        this.selectedNode.branches = this.selectedNode.branches.filter(b => b.id !== branchId);
        this.connections = this.connections.filter(c => {
            const branch = this.selectedNode.branches.find(b => b.id === c.branchId);
            return c.from !== this.selectedNode.id || branch;
        });
        this.renderBranches();
        this.renderConnections();
        this.saveScript();
    },
    renderNodes() {
        const container = document.getElementById('editor-nodes');
        container.innerHTML = '';
        this.nodes.forEach(node => {
            const nodeEl = document.createElement('div');
            nodeEl.className = `editor-node ${node.type} ${this.selectedNode?.id === node.id ? 'selected' : ''}`;
            nodeEl.style.left = node.x + 'px';
            nodeEl.style.top = node.y + 'px';
            nodeEl.dataset.nodeId = node.id;
            const typeLabels = { start: '开始', end: '结束', normal: '剧情', choice: '选择' };
            nodeEl.innerHTML = `
                <div class="node-header"><span class="node-title">${node.title}</span><span class="node-type">${typeLabels[node.type] || '节点'}</span></div>
                <div class="node-body">${node.content.slice(0, 50)}${node.content.length > 50 ? '...' : ''}</div>
                <div class="node-ports">
                    ${node.type !== 'start' ? '<div class="port input" data-port="input"></div>' : ''}
                    ${node.type !== 'end' ? '<div class="port output" data-port="output"></div>' : ''}
                </div>
            `;
            nodeEl.addEventListener('mousedown', (e) => { if (e.target.classList.contains('port')) return; this.startDrag(e, node); });
            nodeEl.addEventListener('click', (e) => { if (e.target.classList.contains('port')) return; this.selectNode(node); });
            const outputPort = nodeEl.querySelector('.port.output');
            if (outputPort) outputPort.addEventListener('mousedown', (e) => { e.stopPropagation(); this.startConnection(node, e); });
            const inputPort = nodeEl.querySelector('.port.input');
            if (inputPort) inputPort.addEventListener('mouseup', (e) => { e.stopPropagation(); this.endConnection(node); });
            container.appendChild(nodeEl);
        });
    },
    renderConnections() {
        const svg = document.getElementById('editor-connections');
        svg.innerHTML = '';
        this.connections.forEach(conn => {
            const fromNode = this.nodes.find(n => n.id === conn.from);
            const toNode = this.nodes.find(n => n.id === conn.to);
            if (!fromNode || !toNode) return;
            const fromX = fromNode.x + 180, fromY = fromNode.y + 60;
            const toX = toNode.x, toY = toNode.y + 60;
            const midX = (fromX + toX) / 2;
            const path = document.createElementNS('http://www.w3.org/2000/svg', 'path');
            path.setAttribute('d', `M ${fromX} ${fromY} C ${midX} ${fromY}, ${midX} ${toY}, ${toX} ${toY}`);
            path.setAttribute('class', `connection-line ${this.selectedConnection === conn.id ? 'selected' : ''}`);
            path.dataset.connectionId = conn.id;
            path.addEventListener('click', () => this.selectConnection(conn));
            svg.appendChild(path);
        });
    },
    selectNode(node) {
        this.selectedNode = node;
        this.selectedConnection = null;
        this.renderNodes();
        this.renderConnections();
        this.updatePropertiesPanel();
        document.querySelector('.editor-properties').classList.add('open');
    },
    selectConnection(conn) {
        this.selectedConnection = conn.id;
        this.selectedNode = null;
        this.renderNodes();
        this.renderConnections();
        if (confirm('确定删除这条连接吗？')) this.deleteConnection(conn.id);
    },
    deleteConnection(connId) {
        this.connections = this.connections.filter(c => c.id !== connId);
        this.selectedConnection = null;
        this.renderConnections();
        this.saveScript();
    },
    updatePropertiesPanel() {
        if (!this.selectedNode) {
            document.getElementById('node-title').value = '';
            document.getElementById('node-content').value = '';
            document.getElementById('node-branches').innerHTML = '';
            return;
        }
        document.getElementById('node-title').value = this.selectedNode.title;
        document.getElementById('node-content').value = this.selectedNode.content;
        this.renderBranches();
    },
    renderBranches() {
        const container = document.getElementById('node-branches');
        if (!this.selectedNode) { container.innerHTML = ''; return; }
        container.innerHTML = '';
        this.selectedNode.branches.forEach((branch, index) => {
            const item = document.createElement('div');
            item.className = 'branch-item';
            item.innerHTML = `<input type="text" value="${branch.text}" data-branch-id="${branch.id}" placeholder="选项文字"><button class="branch-delete" onclick="Editor.deleteBranch('${branch.id}')">×</button>`;
            item.querySelector('input').addEventListener('input', (e) => { branch.text = e.target.value; this.saveScript(); });
            container.appendChild(item);
        });
    },
    startDrag(e, node) {
        this.isDragging = true;
        this.dragNode = node;
        const rect = e.currentTarget.getBoundingClientRect();
        this.dragOffset.x = e.clientX - rect.left;
        this.dragOffset.y = e.clientY - rect.top;
    },
    startConnection(node, e) {
        this.isConnecting = true;
        this.connectionStart = node;
    },
    endConnection(targetNode) {
        if (this.isConnecting && this.connectionStart && this.connectionStart.id !== targetNode.id) {
            const exists = this.connections.some(c => c.from === this.connectionStart.id && c.to === targetNode.id);
            if (!exists) {
                const conn = { id: Phone.generateId(), from: this.connectionStart.id, to: targetNode.id, branchId: null };
                this.connections.push(conn);
                this.renderConnections();
                this.saveScript();
            }
        }
        this.isConnecting = false;
        this.connectionStart = null;
    },
    onMouseDown(e) {
        if (e.target.id === 'editor-canvas' || e.target.id === 'editor-nodes') {
            this.selectedNode = null;
            this.selectedConnection = null;
            this.renderNodes();
            this.renderConnections();
            document.querySelector('.editor-properties').classList.remove('open');
        }
    },
    onMouseMove(e) {
        if (this.isDragging && this.dragNode) {
            const canvasRect = document.getElementById('editor-canvas').getBoundingClientRect();
            this.dragNode.x = e.clientX - canvasRect.left - this.dragOffset.x + document.getElementById('editor-canvas').scrollLeft;
            this.dragNode.y = e.clientY - canvasRect.top - this.dragOffset.y + document.getElementById('editor-canvas').scrollTop;
            this.renderNodes();
            this.renderConnections();
        }
    },
    onMouseUp(e) {
        if (this.isDragging) { this.isDragging = false; this.dragNode = null; this.saveScript(); }
        if (this.isConnecting) { this.isConnecting = false; this.connectionStart = null; }
    },
    onTouchStart(e) {
        const touch = e.touches[0];
        this.onMouseDown(new MouseEvent('mousedown', { clientX: touch.clientX, clientY: touch.clientY }));
    },
    onTouchMove(e) {
        e.preventDefault();
        const touch = e.touches[0];
        this.onMouseMove(new MouseEvent('mousemove', { clientX: touch.clientX, clientY: touch.clientY }));
    },
    onTouchEnd(e) {
        this.onMouseUp(new MouseEvent('mouseup', {}));
    },
    togglePreview() {
        this.previewMode = !this.previewMode;
        const app = document.getElementById('editor-app');
        if (this.previewMode) { app.classList.add('preview-mode'); this.startPreview(); }
        else { app.classList.remove('preview-mode'); }
    },
    startPreview() {
        const startNode = this.nodes.find(n => n.type === 'start');
        if (!startNode) { Phone.showToast('没有找到开始节点'); this.togglePreview(); return; }
        this.previewCurrentNode = startNode;
        this.renderPreview();
    },
    renderPreview() {
        if (!this.previewCurrentNode) return;
        let content = document.querySelector('.preview-content');
        if (!content) {
            content = document.createElement('div');
            content.className = 'preview-content';
            document.getElementById('editor-app').insertBefore(content, document.querySelector('.editor-properties'));
        }
        const node = this.previewCurrentNode;
        const outConnections = this.connections.filter(c => c.from === node.id);
        let choicesHtml = '';
        if (node.branches && node.branches.length > 0) {
            node.branches.forEach(branch => {
                const conn = outConnections.find(c => c.branchId === branch.id);
                if (conn) choicesHtml += `<button class="preview-choice-btn" onclick="Editor.previewGoTo('${conn.to}')">${branch.text}</button>`;
            });
        } else if (outConnections.length > 0) {
            choicesHtml = `<button class="preview-choice-btn" onclick="Editor.previewGoTo('${outConnections[0].to}')">继续</button>`;
        }
        if (node.type === 'end') choicesHtml = '<p style="text-align: center; color: var(--text-tertiary);">— 故事结束 —</p>';
        content.innerHTML = `
            <div class="preview-story"><h3 style="margin-bottom: 16px;">${node.title}</h3><p>${node.content}</p></div>
            <div class="preview-choices">
                ${choicesHtml}
                <button class="btn-secondary" onclick="Editor.togglePreview()" style="margin-top: 20px;">退出预览</button>
            </div>
        `;
    },
    previewGoTo(nodeId) {
        const node = this.nodes.find(n => n.id === nodeId);
        if (node) { this.previewCurrentNode = node; this.renderPreview(); }
    },
    saveScript() {
        const script = { id: this.currentScript?.id || Phone.generateId(), name: '未命名剧本', nodes: this.nodes, connections: this.connections, updatedAt: Date.now() };
        localStorage.setItem('editor_current_script', JSON.stringify(script));
        this.currentScript = script;
    },
    loadScript() {
        const saved = localStorage.getItem('editor_current_script');
        if (saved) {
            try {
                const script = JSON.parse(saved);
                this.currentScript = script;
                this.nodes = script.nodes || [];
                this.connections = script.connections || [];
            } catch (e) { console.error('Load script error:', e); }
        }
    }
};

// ==================== 设置/配置中心 ====================
const Settings = {
    settings: {},
    init() {
        this.loadSettings();
        this.bindEvents();
        this.renderSettings();
    },
    loadSettings() {
        const saved = localStorage.getItem('settings');
        if (saved) this.settings = JSON.parse(saved);
        else this.settings = { apiUrl: '', apiKey: '', model: 'gpt-3.5-turbo', temperature: 0.7, theme: 'auto', fontSize: 'medium', typewriter: true };
    },
    saveSettings() { localStorage.setItem('settings', JSON.stringify(this.settings)); },
    bindEvents() {
        document.getElementById('setting-api-url').addEventListener('input', (e) => { this.settings.apiUrl = e.target.value; this.saveSettings(); });
        document.getElementById('setting-api-key').addEventListener('input', (e) => { this.settings.apiKey = e.target.value; this.saveSettings(); });
        document.getElementById('setting-model').addEventListener('change', (e) => { this.settings.model = e.target.value; this.saveSettings(); });
        document.getElementById('setting-temperature').addEventListener('input', (e) => {
            this.settings.temperature = parseFloat(e.target.value);
            document.getElementById('temp-value').textContent = e.target.value;
            this.saveSettings();
        });
        document.getElementById('btn-test-api').addEventListener('click', () => this.testApiConnection());
        document.getElementById('setting-theme').addEventListener('change', (e) => { this.settings.theme = e.target.value; this.saveSettings(); Phone.applyTheme(e.target.value); });
        document.getElementById('setting-font-size').addEventListener('change', (e) => { this.settings.fontSize = e.target.value; this.saveSettings(); Phone.applyFontSize(e.target.value); });
        document.getElementById('setting-typewriter').addEventListener('change', (e) => { this.settings.typewriter = e.target.checked; this.saveSettings(); });
        document.getElementById('btn-export-all').addEventListener('click', () => this.exportAllData());
        document.getElementById('btn-import-all').addEventListener('click', () => this.importAllData());
        document.getElementById('btn-clear-data').addEventListener('click', () => this.clearAllData());
    },
    renderSettings() {
        document.getElementById('setting-api-url').value = this.settings.apiUrl || '';
        document.getElementById('setting-api-key').value = this.settings.apiKey || '';
        document.getElementById('setting-model').value = this.settings.model || 'gpt-3.5-turbo';
        document.getElementById('setting-temperature').value = this.settings.temperature || 0.7;
        document.getElementById('temp-value').textContent = this.settings.temperature || 0.7;
        document.getElementById('setting-theme').value = this.settings.theme || 'auto';
        document.getElementById('setting-font-size').value = this.settings.fontSize || 'medium';
        document.getElementById('setting-typewriter').checked = this.settings.typewriter !== false;
    },
    async testApiConnection() {
        const apiUrl = this.settings.apiUrl;
        const apiKey = this.settings.apiKey;
        if (!apiUrl || !apiKey) { Phone.showToast('请先填写API地址和密钥'); return; }
        const btn = document.getElementById('btn-test-api');
        const originalText = btn.textContent;
        btn.textContent = '测试中...';
        btn.disabled = true;
        try {
            const ok = await API.testConnection(apiUrl, apiKey);
            Phone.showToast(ok ? '✅ 连接成功' : '❌ 连接失败，请检查配置');
        } catch (error) {
            Phone.showToast('❌ 连接失败: ' + error.message);
        }
        btn.textContent = originalText;
        btn.disabled = false;
    },
    exportAllData() {
        const data = {
            version: '1.0', exportedAt: Date.now(),
            settings: this.settings,
            chat: { chats: JSON.parse(localStorage.getItem('chat_chats') || '[]') },
            game: {
                current: JSON.parse(localStorage.getItem('game_current') || 'null'),
                saves: JSON.parse(localStorage.getItem('game_saves') || '[]'),
                attributes: JSON.parse(localStorage.getItem('game_attributes') || '{}')
            },
            worldbook: {
                worlds: JSON.parse(localStorage.getItem('worldbook_worlds') || '[]'),
                characters: JSON.parse(localStorage.getItem('worldbook_characters') || '[]'),
                locations: JSON.parse(localStorage.getItem('worldbook_locations') || '[]')
            },
            editor: { currentScript: JSON.parse(localStorage.getItem('editor_current_script') || 'null') }
        };
        const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = `ai_phone_backup_${Date.now()}.json`;
        a.click();
        URL.revokeObjectURL(url);
        Phone.showToast('导出成功');
    },
    importAllData() {
        const input = document.createElement('input');
        input.type = 'file';
        input.accept = '.json';
        input.onchange = (e) => {
            const file = e.target.files[0];
            if (!file) return;
            if (!confirm('导入数据将覆盖现有数据，确定继续吗？')) return;
            const reader = new FileReader();
            reader.onload = (e) => {
                try {
                    const data = JSON.parse(e.target.result);
                    if (data.settings) { localStorage.setItem('settings', JSON.stringify(data.settings)); this.settings = data.settings; this.renderSettings(); }
                    if (data.chat?.chats) localStorage.setItem('chat_chats', JSON.stringify(data.chat.chats));
                    if (data.game) {
                        if (data.game.current) localStorage.setItem('game_current', JSON.stringify(data.game.current));
                        if (data.game.saves) localStorage.setItem('game_saves', JSON.stringify(data.game.saves));
                        if (data.game.attributes) localStorage.setItem('game_attributes', JSON.stringify(data.game.attributes));
                    }
                    if (data.worldbook) {
                        if (data.worldbook.worlds) localStorage.setItem('worldbook_worlds', JSON.stringify(data.worldbook.worlds));
                        if (data.worldbook.characters) localStorage.setItem('worldbook_characters', JSON.stringify(data.worldbook.characters));
                        if (data.worldbook.locations) localStorage.setItem('worldbook_locations', JSON.stringify(data.worldbook.locations));
                    }
                    if (data.editor?.currentScript) localStorage.setItem('editor_current_script', JSON.stringify(data.editor.currentScript));
                    Phone.showToast('导入成功，请刷新页面');
                    setTimeout(() => location.reload(), 1000);
                } catch (error) {
                    Phone.showToast('导入失败：文件格式错误');
                }
            };
            reader.readAsText(file);
        };
        input.click();
    },
    clearAllData() {
        if (!confirm('确定要清除所有数据吗？此操作不可恢复！')) return;
        if (!confirm('再次确认：所有聊天记录、游戏存档、世界书、剧本都将被删除！')) return;
        const keysToKeep = ['settings'];
        Object.keys(localStorage).forEach(key => { if (!keysToKeep.includes(key)) localStorage.removeItem(key); });
        Phone.showToast('数据已清除，请刷新页面');
        setTimeout(() => location.reload(), 1000);
    }
};

// ==================== 应用入口 ====================
const App = {
    init() {
        console.log('🚀 AI Phone Simulator 启动中...');
        Phone.init();
        Chat.init();
        Game.init();
        Worldbook.init();
        Editor.init();
        Settings.init();
        console.log('✅ AI Phone Simulator 启动完成');
    }
};

document.addEventListener('DOMContentLoaded', () => App.init());
