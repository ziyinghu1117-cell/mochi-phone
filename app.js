/**
 * Mochi Phone - 核心应用逻辑
 * AI沉浸式陪伴应用
 */

const app = {
  // ====== 状态 ======
  currentTab: 'chat',
  currentChatId: null,
  currentGameId: null,
  tongrenMode: 'list', // list | gen
  settings: {
    apiUrl: 'https://az.zlapi.vip/v1',
    apiKey: 'sk-YCm0hGZ8wlLzKz4U04yVraOF4aIaiEaJ2J2VV08Ju6u7KjCl',
    model: 'default',
    nickname: '小墨的主人',
    bio: '用户喜欢被叫小墨。'
  },

  // ====== 数据 ======
  characters: [
    { id: 'shen', name: '沈墨言', avatar: 'https://api.dicebear.com/7.x/avataaars/svg?seed=shen', desc: '温柔内敛的竹马，总在你需要时出现', tags: ['现代','甜文'], lastMsg: '今天过得怎么样？', time: '10:30', unread: 2 },
    { id: 'jiang', name: '江湛', avatar: 'https://api.dicebear.com/7.x/avataaars/svg?seed=jiang', desc: '高冷霸总，只对你温柔', tags: ['豪门','虐恋'], lastMsg: '晚上一起吃饭。', time: '昨天', unread: 0 },
    { id: 'wan', name: '宛菀风', avatar: 'https://api.dicebear.com/7.x/avataaars/svg?seed=wan', desc: '修仙世界的天灵根少女', tags: ['修仙','奇幻'], lastMsg: '青石广场的灵气好充沛~', time: '昨天', unread: 1 },
    { id: 'lin', name: '林间', avatar: 'https://api.dicebear.com/7.x/avataaars/svg?seed=lin', desc: '阳光开朗的学弟', tags: ['校园','甜文'], lastMsg: '学姐，这道题怎么做？', time: '2天前', unread: 0 },
  ],

  scripts: [
    { id: 'xiuxian', title: '浮生六记', difficulty: '简单', tags: ['古代','生活','种田','经商'], desc: '你重生在平凡的农家女身上，家境清贫，但一切尚有转机。你能否凭借智慧与努力，改变命运，经营好属于自己的一方天地？', cover: '🏡' },
    { id: 'gongdou', title: '深宫谋略', difficulty: '困难', tags: ['宫廷','权谋','古风'], desc: '你入宫为嫔，步步为营，在波谲云诡的深宫之中生存。是被权力吞噬，还是掌控自己的命运？一切，由你抉择。', cover: '🏯' },
    { id: 'xunhuan', title: '无限回廊', difficulty: '中等', tags: ['无限流','悬疑','生存'], desc: '你被困在一座不断循环的回廊中。每一次选择都会影响结局，你能否打破循环，找到唯一的出口？真相，隐藏在无数次轮回之后。', cover: '🌀' },
    { id: 'xiandai', title: '都市夜行', difficulty: '简单', tags: ['现代','悬疑','职场'], desc: '深夜的都市隐藏着不为人知的秘密。作为新晋记者，你将揭开一层层迷雾，探寻真相。', cover: '🌃' },
    { id: 'xianxia', title: '剑破九霄', difficulty: '困难', tags: ['仙侠','冒险','热血'], desc: '天生废灵根的你，偶然获得上古剑诀。从此踏上逆天改命之路，剑指九霄，破尽苍穹。', cover: '⚔️' },
    { id: 'xiaoyuan', title: '盛夏方程式', difficulty: '简单', tags: ['校园','恋爱','青春'], desc: '高三那年夏天，篮球场上的一次偶遇，改变了你整个青春。关于梦想、友情与初恋的故事。', cover: '🏀' },
  ],

  tongrenWorks: [
    { id: 1, title: '月下独酌', desc: '他独坐在庭院中央，月色如水。我悄然靠近，却惊动了满地清辉。', author: '阿言的第七夜', authorAvatar: 'https://api.dicebear.com/7.x/avataaars/svg?seed=a1', tags: ['古代','虐恋'], likes: 1200, coverText: '月下独酌\n相思成疾' },
    { id: 2, title: '春日迟迟，再无归期', desc: '悄说此去经年，便再无相见之日。可我仍在原地，等一场落樱雨。', author: '桃绵绵', authorAvatar: 'https://api.dicebear.com/7.x/avataaars/svg?seed=a2', tags: ['现代','虐恋'], likes: 956, coverText: '春日迟迟\n再无归期' },
    { id: 3, title: '跨越星海拥你入怀', desc: '如果时间可以倒流，我想回到初遇那天，重新爱你一次。', author: '星眠', authorAvatar: 'https://api.dicebear.com/7.x/avataaars/svg?seed=a3', tags: ['现代','甜文'], likes: 2300, coverText: '跨越星海\n拥你入怀' },
    { id: 4, title: '凤栖梧桐，愿与君长相守', desc: '一纸赐婚，命运将我们绑在一起。从相看两厌，到生死相依。', author: '言之有理', authorAvatar: 'https://api.dicebear.com/7.x/avataaars/svg?seed=a4', tags: ['古代','先婚后爱'], likes: 1800, coverText: '凤栖梧桐\n愿与君长相守' },
  ],

  memories: [
    { id: 1, type: '偏好', content: '用户喜欢被叫小墨。', source: '聊天对话', time: '2026-07-28 14:32' },
    { id: 2, type: '事件', content: '我们一起在雨中散步，你说那是很特别的回忆。', source: '剧情对话', time: '2026-07-20 21:18' },
  ],

  gameState: {
    playerName: '宛菀风',
    realm: '练气期',
    hp: 8, maxHp: 10,
    month: 1, phase: '上旬',
    location: '青石广场',
    xiuwei: 120,
    linggen: '天灵根',
    jiandao: '入门',
    fudao: '初学',
    history: [],
  },

  chatHistory: {}, // { charaId: [{role, content}] }

  // ====== 初始化 ======
  init() {
    this.loadData();
    this.bindEvents();
    this.renderChatList();
    this.renderCharaGrid();
    this.renderScriptList();
    this.renderTongrenList();
    this.renderMemoryList();
    this.updatePhoneTime();
    this.updateStats();
    setInterval(() => this.updatePhoneTime(), 60000);
    console.log('🍡 Mochi Phone 初始化完成');
  },

  // ====== 数据持久化 ======
  loadData() {
    try {
      const s = localStorage.getItem('mochi_settings');
      if (s) this.settings = { ...this.settings, ...JSON.parse(s) };
      const c = localStorage.getItem('mochi_chat');
      if (c) this.chatHistory = JSON.parse(c);
      const m = localStorage.getItem('mochi_memories');
      if (m) this.memories = JSON.parse(m);
      const g = localStorage.getItem('mochi_game');
      if (g) this.gameState = { ...this.gameState, ...JSON.parse(g) };
      const t = localStorage.getItem('mochi_tongren');
      if (t) this.tongrenWorks = JSON.parse(t);
    } catch(e) { console.error('加载数据失败', e); }
  },

  saveData() {
    localStorage.setItem('mochi_settings', JSON.stringify(this.settings));
    localStorage.setItem('mochi_chat', JSON.stringify(this.chatHistory));
    localStorage.setItem('mochi_memories', JSON.stringify(this.memories));
    localStorage.setItem('mochi_game', JSON.stringify(this.gameState));
    localStorage.setItem('mochi_tongren', JSON.stringify(this.tongrenWorks));
  },

  // ====== 事件绑定 ======
  bindEvents() {
    // Tab切换
    document.querySelectorAll('.tab-item').forEach(tab => {
      tab.addEventListener('click', () => {
        const page = tab.dataset.page;
        this.switchTab(page);
      });
    });

    // 文游子Tab
    document.querySelectorAll('.wenyou-tab').forEach(tab => {
      tab.addEventListener('click', () => {
        document.querySelectorAll('.wenyou-tab').forEach(t => t.classList.remove('active'));
        tab.classList.add('active');
        const target = tab.dataset.tab;
        document.getElementById('script-list').style.display = target === 'scripts' ? 'block' : 'none';
        document.getElementById('save-list').style.display = target === 'saves' ? 'block' : 'none';
      });
    });

    // 同人标签选择
    document.querySelectorAll('#tongren-tags .tag[data-tag]').forEach(tag => {
      tag.addEventListener('click', () => tag.classList.toggle('active'));
    });

    // 同人梗选择
    document.querySelectorAll('.tag[data-trope]').forEach(tag => {
      tag.addEventListener('click', () => tag.classList.toggle('active'));
    });

    // 字数选择
    document.querySelectorAll('.length-option').forEach(opt => {
      opt.addEventListener('click', () => {
        document.querySelectorAll('.length-option').forEach(o => o.classList.remove('active'));
        opt.classList.add('active');
      });
    });

    // 风格选择
    document.querySelectorAll('.style-option').forEach(opt => {
      opt.addEventListener('click', () => {
        document.querySelectorAll('.style-option').forEach(o => o.classList.remove('active'));
        opt.classList.add('active');
      });
    });
  },

  // ====== Tab切换 ======
  switchTab(page) {
    this.currentTab = page;
    document.querySelectorAll('.page').forEach(p => {
      if (!p.id.startsWith('page-')) return;
      p.classList.remove('active');
    });
    const target = document.getElementById('page-' + page);
    if (target) target.classList.add('active');

    document.querySelectorAll('.tab-item').forEach(t => {
      t.classList.toggle('active', t.dataset.page === page);
    });
  },

  // ====== Toast ======
  showToast(msg) {
    const toast = document.getElementById('toast');
    toast.textContent = msg;
    toast.classList.add('show');
    setTimeout(() => toast.classList.remove('show'), 2500);
  },

  // ====== 时间更新 ======
  updatePhoneTime() {
    const now = new Date();
    const hours = String(now.getHours()).padStart(2, '0');
    const mins = String(now.getMinutes()).padStart(2, '0');
    const month = now.getMonth() + 1;
    const date = now.getDate();
    const days = ['周日','周一','周二','周三','周四','周五','周六'];
    const day = days[now.getDay()];
    const elTime = document.getElementById('phone-time');
    const elDate = document.getElementById('phone-date');
    if (elTime) elTime.textContent = `${hours}:${mins}`;
    if (elDate) elDate.textContent = `${month}月${date}日 ${day}`;
  },

  // ====== 统计更新 ======
  updateStats() {
    document.querySelectorAll('.bean-count-val').forEach(el => el.textContent = '30');
    document.getElementById('memory-count') && (document.getElementById('memory-count').textContent = this.memories.length);
    document.getElementById('stat-beans') && (document.getElementById('stat-beans').textContent = '30');
    document.getElementById('stat-charas') && (document.getElementById('stat-charas').textContent = this.characters.length);
    document.getElementById('stat-memories') && (document.getElementById('stat-memories').textContent = this.memories.length);
  },

  // ====== 聊天列表 ======
  renderChatList() {
    const list = document.getElementById('chat-list');
    if (!list) return;
    list.innerHTML = this.characters.map(c => `
      <div class="chat-item" onclick="app.openChatRoom('${c.id}')">
        <img src="${c.avatar}" class="avatar" alt="">
        <div class="info">
          <div class="name">${c.name}</div>
          <div class="preview">${c.lastMsg}</div>
        </div>
        <div class="meta">
          <div class="time">${c.time}</div>
          ${c.unread ? `<div class="badge">${c.unread}</div>` : ''}
        </div>
      </div>
    `).join('');
  },

  // ====== 角色网格 ======
  renderCharaGrid() {
    const grid = document.getElementById('chara-grid');
    if (!grid) return;
    grid.innerHTML = this.characters.map(c => `
      <div class="chara-card" onclick="app.openChatRoom('${c.id}')">
        <div class="cover" style="display:flex;align-items:center;justify-content:center;font-size:48px;background:linear-gradient(135deg,#FFE4EC,#FFD1DC);">
          <img src="${c.avatar}" style="width:80%;height:80%;object-fit:contain;" alt="">
        </div>
        <div class="info">
          <div class="name">${c.name}</div>
          <div class="desc">${c.desc}</div>
        </div>
      </div>
    `).join('');
  },

  // ====== 聊天房间 ======
  openChatRoom(charaId) {
    const chara = this.characters.find(c => c.id === charaId);
    if (!chara) return;
    this.currentChatId = charaId;
    document.getElementById('chat-room-title').textContent = chara.name;
    document.getElementById('chat-room').classList.add('active');
    this.renderMessages(charaId);
    // 清除未读
    chara.unread = 0;
    this.renderChatList();
  },

  closeChatRoom() {
    document.getElementById('chat-room').classList.remove('active');
    this.currentChatId = null;
  },

  renderMessages(charaId) {
    const container = document.getElementById('chat-messages');
    const history = this.chatHistory[charaId] || [];
    if (history.length === 0) {
      const chara = this.characters.find(c => c.id === charaId);
      container.innerHTML = `
        <div style="text-align:center;padding:40px 20px;color:var(--text-lighter);">
          <div style="font-size:48px;margin-bottom:12px;">💬</div>
          <div style="font-size:15px;margin-bottom:6px;">开始和 ${chara.name} 聊天吧</div>
          <div style="font-size:13px;">${chara.desc}</div>
        </div>
      `;
      return;
    }
    container.innerHTML = history.map(msg => `
      <div class="message ${msg.role === 'user' ? 'self' : ''}">
        ${msg.role === 'assistant' ? `<img src="${this.characters.find(c=>c.id===charaId)?.avatar}" class="avatar avatar-sm" alt="">` : ''}
        <div class="bubble">${this.escapeHtml(msg.content)}</div>
      </div>
    `).join('');
    container.scrollTop = container.scrollHeight;
  },

  async sendMessage() {
    const input = document.getElementById('chat-input');
    const text = input.value.trim();
    if (!text || !this.currentChatId) return;
    input.value = '';

    // 添加用户消息
    if (!this.chatHistory[this.currentChatId]) this.chatHistory[this.currentChatId] = [];
    this.chatHistory[this.currentChatId].push({ role: 'user', content: text, time: Date.now() });
    this.renderMessages(this.currentChatId);

    // 更新角色预览
    const chara = this.characters.find(c => c.id === this.currentChatId);
    if (chara) { chara.lastMsg = text; chara.time = '刚刚'; this.renderChatList(); }

    // 添加记忆
    if (text.includes('喜欢') || text.includes('叫') || text.includes('名字')) {
      this.memories.push({
        id: Date.now(), type: '偏好', content: text,
        source: '聊天对话', time: new Date().toLocaleString('zh-CN')
      });
      this.renderMemoryList();
      this.saveData();
    }

    // AI回复
    await this.getAIReply(this.currentChatId, text);
  },

  // ====== AI API调用 ======
  async callAI(messages, options = {}) {
    const { apiUrl, apiKey, model } = this.settings;
    try {
      const resp = await fetch(`${apiUrl}/chat/completions`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${apiKey}`
        },
        body: JSON.stringify({
          model: model || 'default',
          messages: messages,
          temperature: options.temperature ?? 0.8,
          max_tokens: options.maxTokens ?? 800,
          stream: false
        })
      });
      if (!resp.ok) {
        const err = await resp.text();
        throw new Error(`API错误: ${resp.status} ${err}`);
      }
      const data = await resp.json();
      return data.choices?.[0]?.message?.content || '（AI未返回内容）';
    } catch (err) {
      console.error('AI调用失败:', err);
      // 降级到模拟回复
      return this.mockReply(messages[messages.length - 1]?.content || '');
    }
  },

  mockReply(userMsg) {
    const replies = [
      '嗯...让我想想，这确实很有意思呢。',
      '真的吗？我也这么觉得！💕',
      '你说的这件事，让我想起了很多回忆...',
      '哈哈，你真的好有趣~',
      '我在听，继续说下去吧。',
      '不管发生什么，我都会陪着你的。',
      '这听起来好棒！我也想试试。',
      '有时候，静静地陪着你就是最好的时光。'
    ];
    // 根据内容做简单匹配
    if (userMsg.includes('吗') || userMsg.includes('?') || userMsg.includes('？')) {
      return '当然啦！我相信你一定能做到的。有什么我可以帮你的吗？';
    }
    if (userMsg.includes('累') || userMsg.includes('困') || userMsg.includes('难过')) {
      return '抱抱你...累了就休息一下吧。我会一直在这里陪着你的，不用勉强自己。';
    }
    if (userMsg.includes('喜欢') || userMsg.includes('爱')) {
      return '我也喜欢你呀~ 每次和你聊天都是我最开心的时刻。💕';
    }
    return replies[Math.floor(Math.random() * replies.length)];
  },

  async getAIReply(charaId, userMsg) {
    const chara = this.characters.find(c => c.id === charaId);
    const history = this.chatHistory[charaId] || [];
    const recent = history.slice(-10);

    const systemPrompt = `你是${chara.name}，${chara.desc}。你的性格温柔体贴，说话方式自然亲切，像真实的人一样。你会记住和用户的对话，用简短的口语化中文回复（50字以内），适当使用emoji。当前用户昵称是"${this.settings.nickname}"。`;

    const messages = [
      { role: 'system', content: systemPrompt },
      ...recent.map(m => ({ role: m.role, content: m.content })),
      { role: 'user', content: userMsg }
    ];

    this.showLoadingInChat();
    const reply = await this.callAI(messages, { temperature: 0.9, maxTokens: 200 });
    this.removeLoadingInChat();

    this.chatHistory[charaId].push({ role: 'assistant', content: reply, time: Date.now() });
    this.renderMessages(charaId);
    this.saveData();

    // 更新角色预览
    if (chara) { chara.lastMsg = reply; this.renderChatList(); }
  },

  showLoadingInChat() {
    const container = document.getElementById('chat-messages');
    const div = document.createElement('div');
    div.className = 'message ai-loading';
    div.innerHTML = `<div class="bubble"><div class="loading-dots"><span></span><span></span><span></span></div></div>`;
    container.appendChild(div);
    container.scrollTop = container.scrollHeight;
  },

  removeLoadingInChat() {
    document.querySelectorAll('.ai-loading').forEach(el => el.remove());
  },

  // ====== 剧本列表 ======
  renderScriptList() {
    const list = document.getElementById('script-list');
    if (!list) return;
    list.innerHTML = this.scripts.map(s => `
      <div class="script-card" onclick="app.startGame('${s.id}')">
        <div class="cover" style="display:flex;align-items:center;justify-content:center;font-size:40px;">${s.cover}</div>
        <div class="info">
          <div class="title-row">
            <div class="title">${s.title}</div>
            <div class="difficulty">${s.difficulty}</div>
          </div>
          <div class="tags">${s.tags.map(t => `<span class="tag">${t}</span>`).join('')}</div>
          <div class="desc">${s.desc}</div>
          <button class="btn btn-outline enter-btn">进入剧本 &gt;</button>
        </div>
      </div>
    `).join('');
  },

  // ====== 文游游戏 ======
  async startGame(scriptId) {
    const script = this.scripts.find(s => s.id === scriptId);
    if (!script) return;
    this.currentGameId = scriptId;

    document.getElementById('game-screen').classList.add('active');
    document.getElementById('game-content').innerHTML = '<div class="loading-dots"><span></span><span></span><span></span></div> 正在生成剧情...';
    document.getElementById('game-choices').innerHTML = '';

    // 生成开场剧情
    const prompt = `你是一个专业的文字游戏编剧。请为剧本"${script.title}"生成一段开场剧情（200字左右），风格：${script.tags.join('、')}。要求：
1. 用第二人称"你"
2. 描写细腻，有沉浸感
3. 在结尾给出3个不同的行动选择
4. 格式：先写剧情，然后写"【选择】"，然后列出1.2.3.三个选项

当前设定：玩家是${this.gameState.playerName}，${this.gameState.realm}，位于${this.gameState.location}。`;

    const story = await this.callAI([{ role: 'user', content: prompt }], { temperature: 0.9, maxTokens: 600 });
    this.parseGameStory(story);
  },

  parseGameStory(story) {
    const parts = story.split('【选择】');
    const content = parts[0]?.trim() || story;
    const choicesText = parts[1] || '';

    document.getElementById('game-content').innerHTML = this.escapeHtml(content).replace(/\n/g, '<br>');

    // 解析选项
    const choices = [];
    const lines = choicesText.split('\n');
    const icons = ['🏛️', '👥', '🧘', '📱', '⚔️', '🔮'];
    let iconIdx = 0;

    for (const line of lines) {
      const match = line.match(/^\s*[\d一二三四五].*?[:：.、\s]+(.+)$/);
      if (match || (line.trim().length > 3 && !line.includes('【'))) {
        const text = match ? match[1] : line.trim();
        if (text && text.length > 2) {
          choices.push({ text, icon: icons[iconIdx++ % icons.length] });
        }
      }
    }

    // 如果AI没给选项，生成默认选项
    if (choices.length === 0) {
      choices.push(
        { text: '继续探索', icon: '🔍' },
        { text: '与附近的人交谈', icon: '💬' },
        { text: '原地休息恢复体力', icon: '💤' }
      );
    }

    document.getElementById('game-choices').innerHTML = choices.map((c, i) => `
      <button class="choice-btn" onclick="app.makeChoice(${i}, '${this.escapeAttr(c.text)}')">
        <span class="choice-icon">${c.icon}</span>
        <span>${this.escapeHtml(c.text)}</span>
      </button>
    `).join('');
  },

  async makeChoice(index, choiceText) {
    document.getElementById('game-content').innerHTML = '<div class="loading-dots"><span></span><span></span><span></span></div> 剧情推进中...';
    document.getElementById('game-choices').innerHTML = '';

    // 更新属性
    this.gameState.xiuwei += Math.floor(Math.random() * 20) + 5;
    document.getElementById('attr-xiuwei').textContent = this.gameState.xiuwei;

    const prompt = `继续文字游戏剧情。玩家选择了："${choiceText}"。请根据这个选择生成下一段剧情（150字左右），要求：
1. 用第二人称"你"
2. 剧情要有发展和变化
3. 结尾给出3个新的行动选择
4. 格式：先写剧情，然后写"【选择】"，然后列出1.2.3.三个选项

当前玩家状态：修为${this.gameState.xiuwei}，灵根${this.gameState.linggen}，位于${this.gameState.location}。`;

    const story = await this.callAI([{ role: 'user', content: prompt }], { temperature: 0.95, maxTokens: 600 });
    this.parseGameStory(story);
    this.saveData();
  },

  saveGame() {
    this.saveData();
    this.showToast('💾 存档已保存');
  },

  // ====== 同人 ======
  openTongrenGen() {
    const gen = document.getElementById('tongren-gen');
    const list = document.getElementById('tongren-list-view');
    if (gen.style.display === 'none') {
      gen.style.display = 'block';
      list.style.display = 'none';
      this.tongrenMode = 'gen';
    } else {
      gen.style.display = 'none';
      list.style.display = 'block';
      this.tongrenMode = 'list';
    }
  },

  renderTongrenList() {
    const grid = document.getElementById('tongren-grid');
    if (!grid) return;
    grid.innerHTML = this.tongrenWorks.map(w => `
      <div class="tongren-item">
        <div class="cover">${w.coverText.replace(/\n/g, '<br>')}</div>
        <div class="info">
          <div class="title">${w.title}</div>
          <div class="desc">${w.desc}</div>
          <div class="author-row">
            <div class="author">
              <img src="${w.authorAvatar}" alt="">
              <span>${w.author}</span>
            </div>
            <div class="likes">❤️ ${this.formatNumber(w.likes)}</div>
          </div>
        </div>
      </div>
    `).join('');
  },

  async generateTongren() {
    const tags = Array.from(document.querySelectorAll('#tongren-tags .tag.active')).map(t => t.dataset.tag);
    const tropes = Array.from(document.querySelectorAll('.tag[data-trope].active')).map(t => t.dataset.trope);
    const lenOpt = document.querySelector('.length-option.active');
    const len = lenOpt ? lenOpt.dataset.len : 'medium';
    const styleOpt = document.querySelector('.style-option.active');
    const style = styleOpt ? styleOpt.dataset.style : '虐心';

    const lenMap = { short: 500, medium: 1500, long: 3000 };
    const tokenMap = { short: 800, medium: 2000, long: 4000 };

    this.showToast('✨ 正在生成同人文...');

    const prompt = `请创作一篇同人文，要求如下：
标签：${tags.join('、') || '古风'}
梗：${tropes.join('、') || '破镜重圆'}
风格：${style}
字数：约${lenMap[len]}字
角色：沈墨言 × User（第一人称）

请创作一篇完整的同人文，包含标题。开头写标题，然后直接开始正文。文笔细腻，情感真挚。`;

    const content = await this.callAI([{ role: 'user', content: prompt }], {
      temperature: 0.95,
      maxTokens: tokenMap[len]
    });

    // 解析标题
    const titleMatch = content.match(/^["「『]*(.*?)["」』]*[\n\r]/);
    const title = titleMatch ? titleMatch[1] : '无题';

    const work = {
      id: Date.now(),
      title: title.slice(0, 20),
      desc: content.slice(0, 80) + '...',
      author: this.settings.nickname,
      authorAvatar: 'https://api.dicebear.com/7.x/avataaars/svg?seed=user123',
      tags: [...tags, ...tropes],
      likes: 0,
      coverText: title.slice(0, 12),
      content: content
    };

    this.tongrenWorks.unshift(work);
    this.renderTongrenList();
    this.saveData();

    // 切换到列表
    document.getElementById('tongren-gen').style.display = 'none';
    document.getElementById('tongren-list-view').style.display = 'block';
    this.tongrenMode = 'list';

    this.showToast('✨ 同人生成成功！');
  },

  // ====== 记忆 ======
  renderMemoryList() {
    const list = document.getElementById('memory-list');
    if (!list) return;
    list.innerHTML = this.memories.map(m => `
      <div class="memory-item">
        <div class="item-header">
          <span class="item-tag">${m.type}</span>
          <div class="item-actions">
            <button onclick="app.editMemory(${m.id})">✏️</button>
            <button onclick="app.deleteMemory(${m.id})">🗑️</button>
          </div>
        </div>
        <div class="content">${this.escapeHtml(m.content)}</div>
        <div class="source">来源：${m.source}</div>
        <div class="time">${m.time}</div>
      </div>
    `).join('');
  },

  deleteMemory(id) {
    this.memories = this.memories.filter(m => m.id !== id);
    this.renderMemoryList();
    this.saveData();
    this.updateStats();
    this.showToast('记忆已删除');
  },

  editMemory(id) {
    const m = this.memories.find(x => x.id === id);
    if (!m) return;
    const newContent = prompt('编辑记忆:', m.content);
    if (newContent !== null) {
      m.content = newContent;
      this.renderMemoryList();
      this.saveData();
      this.showToast('记忆已更新');
    }
  },

  // ====== 设置 ======
  openSettings() {
    document.getElementById('page-settings').classList.add('active');
    // 填充当前设置
    document.getElementById('setting-api-url').value = this.settings.apiUrl;
    document.getElementById('setting-api-key').value = this.settings.apiKey;
    document.getElementById('setting-model').value = this.settings.model;
    document.getElementById('setting-nickname').value = this.settings.nickname;
    document.getElementById('setting-bio').value = this.settings.bio;
  },

  closeSettings() {
    document.getElementById('page-settings').classList.remove('active');
  },

  saveSettings() {
    this.settings.apiUrl = document.getElementById('setting-api-url').value;
    this.settings.apiKey = document.getElementById('setting-api-key').value;
    this.settings.model = document.getElementById('setting-model').value;
    this.saveData();
    this.showToast('🔑 API配置已保存');
  },

  saveProfile() {
    this.settings.nickname = document.getElementById('setting-nickname').value;
    this.settings.bio = document.getElementById('setting-bio').value;
    this.saveData();
    this.showToast('👤 资料已保存');
  },

  clearData() {
    if (!confirm('确定要清除所有本地数据吗？此操作不可恢复！')) return;
    localStorage.clear();
    this.chatHistory = {};
    this.memories = [
      { id: 1, type: '偏好', content: '用户喜欢被叫小墨。', source: '聊天对话', time: '2026-07-28 14:32' }
    ];
    this.saveData();
    this.renderMemoryList();
    this.updateStats();
    this.showToast('所有数据已清除');
  },

  logout() {
    if (confirm('确定要退出登录吗？')) {
      this.showToast('已退出登录');
    }
  },

  // ====== 子页面 ======
  openSubPage(name) {
    const titles = {
      contacts: '通讯录', social: '社交', map: '地图', diary: '日记',
      shop: '商店', settings: '设置', tasks: '任务', bag: '背包'
    };
    this.showToast(`${titles[name] || name}页面开发中...`);
  },

  // ====== 工具 ======
  escapeHtml(text) {
    const div = document.createElement('div');
    div.textContent = text;
    return div.innerHTML;
  },

  escapeAttr(text) {
    return text.replace(/'/g, "\\'").replace(/"/g, '\\"');
  },

  formatNumber(n) {
    if (n >= 10000) return (n / 10000).toFixed(1) + 'w';
    if (n >= 1000) return (n / 1000).toFixed(1) + 'k';
    return n;
  }
};

// ====== 启动 ======
document.addEventListener('DOMContentLoaded', () => app.init());
