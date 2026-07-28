/**
 * app.js — 主应用逻辑：路由、事件处理、文游引擎、各种 action
 */
(function () {
  'use strict';

  const App = {};
  App.chatBusy = false;
  App.currentPage = 'home';
  App.currentTab = null;
  App.fanficState = null;
  let gameAbortController = null;

  // ============ 工具 ============
  function el(id) { return document.getElementById(id); }
  function esc(s) { return (s || '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;'); }

  App.toast = function (msg, type) {
    const c = el('toast-container');
    const t = document.createElement('div');
    t.className = 'toast' + (type ? ' ' + type : '');
    t.textContent = msg;
    c.appendChild(t);
    setTimeout(() => { t.style.opacity = '0'; t.style.transition = 'opacity 0.3s'; setTimeout(() => t.remove(), 300); }, 2500);
  };

  App.showLoading = function (text) {
    const o = el('loading-overlay');
    if (text) el('loading-overlay').querySelector('.loading-text').textContent = text;
    o.classList.add('show');
  };
  App.hideLoading = function () { el('loading-overlay').classList.remove('show'); };

  App.showModal = function (html) {
    el('modal-content').innerHTML = html;
    el('modal-overlay').classList.add('show');
  };
  App.closeModal = function () { el('modal-overlay').classList.remove('show'); };

  // ============ 初始化 ============
  App.init = function () {
    Store.load();
    DefaultData.initDefaults();
    const s = Store.get().settings;
    document.body.setAttribute('data-theme', s.theme);
    document.body.setAttribute('data-font', s.fontSize);

    // 导航事件
    document.querySelectorAll('.nav-item').forEach(item => {
      item.addEventListener('click', () => App.navigate(item.dataset.page));
    });

    // 更新时钟
    updateClock();
    setInterval(updateClock, 30000);

    App.navigate('home');
  };

  function updateClock() {
    const now = new Date();
    const h = now.getHours().toString().padStart(2, '0');
    const m = now.getMinutes().toString().padStart(2, '0');
    const t = el('status-bar')?.querySelector('.sb-time');
    if (t) t.textContent = h + ':' + m;
  }

  // ============ 路由 ============
  App.navigate = function (page, tab) {
    App.currentPage = page;
    App.currentTab = tab;

    // 更新底部导航高亮
    document.querySelectorAll('.nav-item').forEach(item => {
      item.classList.toggle('active', item.dataset.page === page);
    });

    // 子页面（非底部导航的页面也隐藏底部导航对应高亮）
    const navPages = ['chat', 'character', 'home', 'wenyu', 'memory', 'profile'];
    if (!navPages.includes(page)) {
      document.querySelectorAll('.nav-item').forEach(i => i.classList.remove('active'));
    }

    // 渲染对应页面
    const pageMap = {
      home: Pages.home,
      chat: Pages.chat,
      character: Pages.character,
      wenyu: () => Pages.wenyu(tab),
      memory: Pages.memory,
      profile: Pages.profile,
      settings: Pages.settings,
      tongren: Pages.tongren,
      forum: Pages.forum,
      worldbook: Pages.worldbook,
      game: Pages.gameView,
    };

    if (page === 'chat' && App._pendingChatChar) {
      Pages.chatView(App._pendingChatChar);
      App._pendingChatChar = null;
      return;
    }

    const fn = pageMap[page];
    if (fn) fn();
    else Pages.home();

    // 滚动到顶部
    el('page-container').scrollTop = 0;
  };

  // ============ 聊天 ============
  App.openChat = function (charId) {
    App._pendingChatChar = charId;
    App.navigate('chat');
    // navigate('chat') 会检测 _pendingChatChar 并调用 chatView
  };

  App.clearChat = function (charId) {
    App.showModal(`
      <div class="modal-title">清空聊天记录？</div>
      <div class="text-center text-sm text-muted">此操作不可撤销</div>
      <div class="modal-actions">
        <button class="btn btn-outline" onclick="App.closeModal()">取消</button>
        <button class="btn btn-primary" style="background:#F44336" onclick="App._doClearChat('${charId}')">清空</button>
      </div>
    `);
  };
  App._doClearChat = function (charId) {
    const data = Store.get();
    delete data.chats[charId];
    Store.save();
    App.closeModal();
    Pages.chatView(charId);
    App.toast('已清空', 'success');
  };

  App.sendChatMsg = async function () {
    if (App.chatBusy) return;
    const input = el('chat-input');
    if (!input) return;
    const text = input.value.trim();
    if (!text) return;

    const charId = Pages.getChatCurrentChar();
    const char = Store.get().characters.find(c => c.id === charId);
    if (!char) return;

    // 豆子检查
    if (!Store.spendBeans(CONFIG.currency.chatCost)) {
      App.toast('豆子不足！去签到领取吧~', 'warn');
      return;
    }

    // 添加用户消息
    const data = Store.get();
    if (!data.chats[charId]) data.chats[charId] = [];
    const history = data.chats[charId];
    history.push({ role: 'user', content: text, time: Date.now() });
    Store.save();

    input.value = '';
    input.disabled = true;
    App.chatBusy = true;
    el('chat-send')?.setAttribute('disabled', '');

    // 渲染用户消息 + typing indicator
    const msgArea = el('chat-messages');
    msgArea.insertAdjacentHTML('beforeend',
      `<div class="msg-bubble msg-user">${esc(text)}</div>`);
    msgArea.insertAdjacentHTML('beforeend',
      `<div class="msg-bubble msg-ai" id="typing-bubble"><div class="msg-name">${esc(char.name)}</div><div class="typing-dots"><span></span><span></span><span></span></div></div>`);
    msgArea.scrollTop = msgArea.scrollHeight;

    // 构建 system prompt
    const wb = char.worldBookId ? Store.get().worldBooks.find(w => w.id === char.worldBookId) : null;
    const recentMsgs = history.slice(-8);
    const sysPrompt = WorldBook.buildSystemPrompt(char, wb, data.memories, recentMsgs);

    try {
      // 用于流式更新的 AI 消息容器
      const typingBubble = el('typing-bubble');
      let aiContent = '';
      let firstChunk = true;

      await API.talk(sysPrompt, history.slice(0, -1), text, {
        stream: true,
        onChunk: (delta, full) => {
          if (firstChunk) {
            firstChunk = false;
            if (typingBubble) {
              typingBubble.innerHTML = `<div class="msg-name">${esc(char.name)}</div><span id="ai-stream"></span>`;
            }
          }
          aiContent = full;
          const streamEl = typingBubble?.querySelector('#ai-stream');
          if (streamEl) {
            streamEl.textContent = aiContent;
            msgArea.scrollTop = msgArea.scrollHeight;
          }
        },
      });

      // 完成
      if (typingBubble) {
        typingBubble.innerHTML = `<div class="msg-name">${esc(char.name)}</div>${esc(aiContent)}`;
        typingBubble.removeAttribute('id');
      }

      // 保存 AI 回复
      history.push({ role: 'assistant', content: aiContent, time: Date.now() });
      Store.save();

      // 自动沉淀记忆
      if (Store.get().settings.autoMemory && history.length >= 4) {
        try {
          const mems = await WorldBook.precipitateMemories(char.name, history);
          if (mems.length) {
            const added = WorldBook.saveMemories(mems);
            if (added > 0) App.toast(`沉淀了 ${added} 条新回忆 ✨`, 'success');
          }
        } catch (e) { /* silent */ }
      }
    } catch (e) {
      const tb = el('typing-bubble');
      if (tb) tb.remove();
      // 回退豆子
      Store.addBeans(CONFIG.currency.chatCost);
      App.toast('出错了: ' + e.message, 'error');
    } finally {
      App.chatBusy = false;
      const inp = el('chat-input');
      if (inp) inp.disabled = false;
      el('chat-send')?.removeAttribute('disabled');
    }
  };

  // ============ 角色管理 ============
  App.editChar = function (id) {
    const data = Store.get();
    const char = id ? data.characters.find(c => c.id === id) : null;
    const wbOpts = ['<option value="">无</option>'].concat(
      data.worldBooks.map(w => `<option value="${w.id}" ${char && char.worldBookId === w.id ? 'selected' : ''}>${esc(w.name)}</option>`)
    ).join('');

    App.showModal(`
      <div class="modal-title">${char ? '编辑角色' : '创建角色'}</div>
      <div style="margin-bottom:12px">
        <label class="field-label">头像（emoji）</label>
        <input class="input" id="char-avatar" value="${char ? esc(char.avatar) : '🎭'}" maxlength="4" style="text-align:center;font-size:24px">
      </div>
      <div style="margin-bottom:12px">
        <label class="field-label">名字</label>
        <input class="input" id="char-name" value="${char ? esc(char.name) : ''}" placeholder="角色名">
      </div>
      <div style="margin-bottom:12px">
        <label class="field-label">标签</label>
        <input class="input" id="char-tag" value="${char ? esc(char.tag || '') : ''}" placeholder="如：帅哥 / 师姐 / 老板">
      </div>
      <div style="margin-bottom:12px">
        <label class="field-label">人设 / 性格</label>
        <textarea class="textarea" id="char-persona" placeholder="详细描述角色的性格、外貌、说话风格、背景等…">${char ? esc(char.persona || '') : ''}</textarea>
      </div>
      <div style="margin-bottom:12px">
        <label class="field-label">开场白</label>
        <textarea class="textarea" id="char-greeting" placeholder="角色的第一句话…">${char ? esc(char.greeting || '') : ''}</textarea>
      </div>
      <div style="margin-bottom:12px">
        <label class="field-label">当前场景</label>
        <input class="input" id="char-scenario" value="${char ? esc(char.scenario || '') : ''}" placeholder="如：咖啡厅 / 修仙世界">
      </div>
      <div style="margin-bottom:12px">
        <label class="field-label">对话示例（可选）</label>
        <textarea class="textarea" id="char-example" placeholder="用户：xxx&#10;角色：xxx">${char ? esc(char.exampleDialogue || '') : ''}</textarea>
      </div>
      <div style="margin-bottom:12px">
        <label class="field-label">关联世界书</label>
        <select class="select" id="char-wb">${wbOpts}</select>
      </div>
      <div class="modal-actions">
        <button class="btn btn-outline" onclick="App.closeModal()">取消</button>
        <button class="btn btn-primary" onclick="App._saveChar('${id || ''}')">保存</button>
      </div>
    `);
  };

  App._saveChar = function (id) {
    const data = Store.get();
    const char = id ? data.characters.find(c => c.id === id) : { id: Store.uid(), createdAt: Date.now() };
    char.avatar = el('char-avatar').value.trim() || '🎭';
    char.name = el('char-name').value.trim() || '未命名';
    char.tag = el('char-tag').value.trim();
    char.persona = el('char-persona').value.trim();
    char.greeting = el('char-greeting').value.trim();
    char.scenario = el('char-scenario').value.trim();
    char.exampleDialogue = el('char-example').value.trim();
    char.worldBookId = el('char-wb').value || null;

    if (!id) data.characters.push(char);
    Store.save();
    App.closeModal();
    Pages.character();
    App.toast(id ? '已更新' : '已创建', 'success');
  };

  App.deleteChar = function (id) {
    App.showModal(`
      <div class="modal-title">删除角色？</div>
      <div class="text-center text-sm text-muted">聊天记录也会一并删除</div>
      <div class="modal-actions">
        <button class="btn btn-outline" onclick="App.closeModal()">取消</button>
        <button class="btn btn-primary" style="background:#F44336" onclick="App._doDeleteChar('${id}')">删除</button>
      </div>
    `);
  };
  App._doDeleteChar = function (id) {
    const data = Store.get();
    data.characters = data.characters.filter(c => c.id !== id);
    delete data.chats[id];
    Store.save();
    App.closeModal();
    Pages.character();
    App.toast('已删除', 'success');
  };

  // ============ 文游引擎 ============
  App.startGame = async function (scriptId) {
    const script = (window.DEFAULT_SCRIPTS || []).find(s => s.id === scriptId);
    if (!script) return;

    // 豆子检查
    if (!Store.spendBeans(CONFIG.currency.wenyuCost)) {
      App.toast('豆子不足！去签到领取吧~', 'warn');
      return;
    }

    const data = Store.get();
    const wb = script.worldBookId ? data.worldBooks.find(w => w.id === script.worldBookId) : null;

    // 初始化游戏状态
    data.currentGame = {
      scriptId: scriptId,
      charName: '主角',
      charAvatar: '🧑',
      stage: script.difficulty,
      location: '',
      stats: JSON.parse(JSON.stringify(script.stats || {})),
      narrative: '',
      options: [],
      history: [],
      turn: 0,
      startedAt: Date.now(),
    };
    Store.save();

    App.navigate('game');
    App.showLoading('故事正在展开…');

    try {
      const sysPrompt = buildGameSystemPrompt(script, wb, data.currentGame);
      const result = await API.chat(
        [
          { role: 'system', content: sysPrompt },
          { role: 'user', content: '请开始游戏，输出开场剧情和选项。玩家还没有做出任何选择。' },
        ],
        { stream: false, maxTokens: 1500, temperature: 0.9 }
      );

      const parsed = parseGameResponse(result);
      const game = Store.get().currentGame;
      game.narrative = parsed.narrative;
      game.options = parsed.options;
      game.location = parsed.location || '';
      applyStatChanges(game, parsed.statChanges);
      game.history.push({ type: 'start', narrative: parsed.narrative });
      game.turn = 1;
      Store.save();

      App.hideLoading();
      Pages.gameView();
    } catch (e) {
      App.hideLoading();
      App.toast('游戏启动失败: ' + e.message, 'error');
      App.navigate('wenyu');
    }
  };

  function buildGameSystemPrompt(script, wb, game) {
    const parts = [];
    parts.push('你是一个文字冒险游戏引擎（Game Master）。你需要根据玩家的选择推进剧情。');
    parts.push('## 剧本设定\n' + (script.setting || ''));
    parts.push('## 开场场景\n' + (script.startScene || ''));

    if (wb && wb.globalSetting) parts.push('## 世界设定\n' + wb.globalSetting);
    if (wb && wb.entries && wb.entries.length) {
      parts.push('## 世界书条目\n' + wb.entries.map(e => `### ${e.title}\n${e.content}`).join('\n\n'));
    }

    // 当前状态
    const statsText = Object.entries(game.stats || {}).map(([k, v]) => `${k}: ${v}`).join('，');
    parts.push('## 当前角色状态\n' + statsText);
    if (game.location) parts.push('当前位置：' + game.location);

    // 历史
    if (game.history && game.history.length) {
      const recent = game.history.slice(-6);
      parts.push('## 最近剧情摘要\n' + recent.map(h =>
        h.type === 'choice' ? `玩家选择: ${h.choice}` : h.narrative?.slice(0, 100)
      ).join('\n'));
    }

    parts.push(
      '## 输出格式（严格遵守）\n' +
      '每次回复必须包含以下三个部分，用标记分隔：\n\n' +
      '【剧情】\n' +
      '（200-400字的剧情描述，第二人称"你"视角，生动有画面感，包含环境描写、对话和事件）\n\n' +
      '【选项】\n' +
      '1. 第一个行动选项\n' +
      '2. 第二个行动选项\n' +
      '3. 第三个行动选项\n' +
      '4. 第四个行动选项\n' +
      '（选项应多样有趣，涵盖探索/社交/战斗/休息等不同方向）\n\n' +
      '【状态】\n' +
      '位置: 当前地点名称\n' +
      '体力变化: +0 或 -1 等\n' +
      '其他属性变化: 如 修为+10, 铜钱-5 等（无变化写"无"）\n\n' +
      '注意：剧情要根据玩家选择合理推进，不要重复之前的内容。保持紧张感和趣味性。'
    );

    return parts.join('\n\n');
  }

  function parseGameResponse(text) {
    const result = { narrative: '', options: [], statChanges: {}, location: '' };

    // 提取剧情
    const narrMatch = text.match(/【剧情】([\s\S]*?)(?=【选项】|$)/);
    if (narrMatch) result.narrative = narrMatch[1].trim();
    else result.narrative = text.trim();

    // 提取选项
    const optMatch = text.match(/【选项】([\s\S]*?)(?=【状态】|$)/);
    if (optMatch) {
      const lines = optMatch[1].trim().split('\n');
      for (const line of lines) {
        const m = line.match(/^\s*\d+[.、)]\s*(.+)/);
        if (m) {
          const text = m[1].trim();
          const icon = text.includes('探索') || text.includes('前往') ? '🏛' :
                       text.includes('聊') || text.includes('攀谈') || text.includes('找') ? '👥' :
                       text.includes('修炼') || text.includes('打坐') || text.includes('休息') ? '🧘' :
                       text.includes('战斗') || text.includes('攻击') ? '⚔' :
                       text.includes('买') || text.includes('商店') ? '🛒' : '▶';
          result.options.push({ text, icon });
        }
      }
    }

    // 提取状态
    const stateMatch = text.match(/【状态】([\s\S]*?)$/);
    if (stateMatch) {
      const stateText = stateMatch[1].trim();
      const locMatch = stateText.match(/位置[:：]\s*(.+)/);
      if (locMatch) result.location = locMatch[1].trim();

      const changes = {};
      const changeLines = stateText.split('\n');
      for (const line of changeLines) {
        const m = line.match(/([\u4e00-\u9fa5\w]+)\s*[：:]\s*([+-]?\d+)/);
        if (m) {
          changes[m[1].trim()] = parseInt(m[2]);
        }
      }
      result.statChanges = changes;
    }

    return result;
  }

  function applyStatChanges(game, changes) {
    if (!changes) return;
    for (const [key, delta] of Object.entries(changes)) {
      if (game.stats[key] !== undefined && typeof game.stats[key] === 'number') {
        game.stats[key] += delta;
        if (key === '体力') game.stats[key] = Math.min(10, Math.max(0, game.stats[key]));
      } else if (game.stats[key] === undefined) {
        game.stats[key] = delta;
      }
    }
  }

  App.gameChoose = async function (index) {
    const game = Store.get().currentGame;
    if (!game || !game.options[index]) return;

    const choice = game.options[index];
    await gameAdvance(choice.text);
  };

  App.gameCustomInput = function () {
    App.showModal(`
      <div class="modal-title">自由行动</div>
      <textarea class="textarea" id="game-custom-input" placeholder="输入你想做的事…" style="min-height:100px"></textarea>
      <div class="modal-actions">
        <button class="btn btn-outline" onclick="App.closeModal()">取消</button>
        <button class="btn btn-primary" onclick="App._gameCustomGo()">执行</button>
      </div>
    `);
  };
  App._gameCustomGo = async function () {
    const text = el('game-custom-input').value.trim();
    if (!text) return;
    App.closeModal();
    await gameAdvance(text);
  };

  async function gameAdvance(choice) {
    const data = Store.get();
    const game = data.currentGame;
    if (!game) return;

    // 豆子
    if (!Store.spendBeans(1)) {
      App.toast('豆子不足！', 'warn');
      return;
    }

    const script = (window.DEFAULT_SCRIPTS || []).find(s => s.id === game.scriptId);
    const wb = script?.worldBookId ? data.worldBooks.find(w => w.id === script.worldBookId) : null;

    game.options = []; // 清空选项防止重复点击
    Store.save();
    Pages.gameView();

    // 显示加载
    const narrEl = el('game-narrative');
    if (narrEl) narrEl.innerHTML = '正在推进剧情…<br><div class="typing-dots"><span></span><span></span><span></span></div>';
    const actionsEl = el('game-actions');
    if (actionsEl) actionsEl.innerHTML = '';

    try {
      const sysPrompt = buildGameSystemPrompt(script, wb, game);
      const result = await API.chat(
        [
          { role: 'system', content: sysPrompt },
          { role: 'user', content: `玩家选择了: ${choice}\n\n请推进剧情，按照规定格式输出。` },
        ],
        { stream: false, maxTokens: 1500, temperature: 0.9 }
      );

      const parsed = parseGameResponse(result);
      game.narrative = parsed.narrative;
      game.options = parsed.options;
      if (parsed.location) game.location = parsed.location;
      applyStatChanges(game, parsed.statChanges);
      game.history.push({ type: 'choice', choice, narrative: parsed.narrative });
      game.turn++;
      Store.save();

      Pages.gameView();
    } catch (e) {
      App.toast('推进失败: ' + e.message, 'error');
      if (narrEl) narrEl.textContent = '出错了，请重试…';
    }
  }

  App.saveGame = function () {
    const data = Store.get();
    const game = data.currentGame;
    if (!game) return;

    const script = (window.DEFAULT_SCRIPTS || []).find(s => s.id === game.scriptId);
    const save = {
      id: Store.uid(),
      scriptId: game.scriptId,
      scriptTitle: script?.title || '未知',
      turn: game.turn,
      location: game.location,
      stats: JSON.parse(JSON.stringify(game.stats)),
      narrative: game.narrative,
      options: JSON.parse(JSON.stringify(game.options)),
      history: JSON.parse(JSON.stringify(game.history)),
      charName: game.charName,
      charAvatar: game.charAvatar,
      stage: game.stage,
      savedAt: Date.now(),
    };
    data.saves.push(save);
    Store.save();
    App.toast('已存档！', 'success');
  };

  App.loadGame = function (saveId) {
    const data = Store.get();
    const save = data.saves.find(s => s.id === saveId);
    if (!save) return;

    data.currentGame = {
      scriptId: save.scriptId,
      charName: save.charName,
      charAvatar: save.charAvatar,
      stage: save.stage,
      location: save.location,
      stats: save.stats,
      narrative: save.narrative,
      options: save.options,
      history: save.history,
      turn: save.turn,
      startedAt: Date.now(),
    };
    Store.save();
    App.navigate('game');
  };

  App.deleteSave = function (saveId) {
    const data = Store.get();
    data.saves = data.saves.filter(s => s.id !== saveId);
    Store.save();
    Pages.wenyu('saves');
    App.toast('已删除', 'success');
  };

  App.exitGame = function () {
    App.showModal(`
      <div class="modal-title">退出游戏？</div>
      <div class="text-center text-sm text-muted">未保存的进度将丢失</div>
      <div class="modal-actions">
        <button class="btn btn-outline" onclick="App.closeModal()">继续游戏</button>
        <button class="btn btn-primary" onclick="App._doExitGame()">退出</button>
      </div>
    `);
  };
  App._doExitGame = function () {
    Store.update('currentGame', null);
    App.closeModal();
    App.navigate('wenyu');
  };

  // ============ 记忆管理 ============
  App.addMemory = function () {
    App._editMemoryForm(null);
  };
  App.editMemory = function (id) {
    App._editMemoryForm(id);
  };
  App._editMemoryForm = function (id) {
    const data = Store.get();
    const m = id ? data.memories.find(x => x.id === id) : null;
    App.showModal(`
      <div class="modal-title">${id ? '编辑回忆' : '新增回忆'}</div>
      <div style="margin-bottom:12px">
        <label class="field-label">分类</label>
        <select class="select" id="mem-cat">
          ${['偏好', '事件', '关系', '其他'].map(c => `<option value="${c}" ${m && m.category === c ? 'selected' : ''}>${c}</option>`).join('')}
        </select>
      </div>
      <div style="margin-bottom:12px">
        <label class="field-label">内容</label>
        <textarea class="textarea" id="mem-content" placeholder="记住这件事…">${m ? esc(m.content) : ''}</textarea>
      </div>
      <div class="modal-actions">
        <button class="btn btn-outline" onclick="App.closeModal()">取消</button>
        <button class="btn btn-primary" onclick="App._saveMemory('${id || ''}')">保存</button>
      </div>
    `);
  };
  App._saveMemory = function (id) {
    const data = Store.get();
    const m = id ? data.memories.find(x => x.id === id) : { id: Store.uid(), time: Date.now(), source: '手动添加' };
    m.category = el('mem-cat').value;
    m.content = el('mem-content').value.trim();
    if (!m.content) { App.toast('内容不能为空', 'warn'); return; }
    if (!id) data.memories.push(m);
    Store.save();
    App.closeModal();
    Pages.memory();
    App.toast('已保存', 'success');
  };
  App.deleteMemory = function (id) {
    const data = Store.get();
    data.memories = data.memories.filter(m => m.id !== id);
    Store.save();
    Pages.memory();
    App.toast('已删除', 'success');
  };

  // ============ 用户名 ============
  App.editUserName = function () {
    const u = Store.get().user;
    App.showModal(`
      <div class="modal-title">修改昵称</div>
      <div style="margin-bottom:12px">
        <label class="field-label">头像（emoji）</label>
        <input class="input" id="user-avatar" value="${esc(u.avatar)}" style="text-align:center;font-size:24px" maxlength="4">
      </div>
      <div style="margin-bottom:12px">
        <label class="field-label">昵称</label>
        <input class="input" id="user-name" value="${esc(u.name)}">
      </div>
      <div class="modal-actions">
        <button class="btn btn-outline" onclick="App.closeModal()">取消</button>
        <button class="btn btn-primary" onclick="App._saveUserName()">保存</button>
      </div>
    `);
  };
  App._saveUserName = function () {
    Store.update('user.name', el('user-name').value.trim() || '小墨的主人');
    Store.update('user.avatar', el('user-avatar').value.trim() || '🧑');
    App.closeModal();
    Pages.profile();
    App.toast('已保存', 'success');
  };

  // ============ 签到 ============
  App.dailyCheckIn = function (btn) {
    const r = Store.dailyCheckIn();
    App.toast(r.msg, r.ok ? 'success' : 'warn');
    if (r.ok) Pages.home();
  };

  // ============ 设置 ============
  App.saveSettings = function () {
    const s = Store.get().settings;
    s.baseURL = el('set-baseurl').value.trim();
    s.apiKey = el('set-apikey').value.trim();
    s.model = el('set-model').value;
    s.maxTokens = parseInt(el('set-maxtokens').value) || 2000;
    s.streaming = el('set-streaming').checked;
    s.autoMemory = el('set-automem').checked;
    Store.save();
    App.toast('设置已保存', 'success');
  };

  App.testApi = async function () {
    App.toast('正在测试…');
    const r = await API.testConnection();
    if (r.ok) App.toast('连接成功！模型回复: ' + r.msg.slice(0, 30), 'success');
    else App.toast('连接失败: ' + r.msg, 'error');
  };

  App.applyTheme = function (theme) {
    document.body.setAttribute('data-theme', theme);
    Store.update('settings.theme', theme);
  };
  App.applyFontSize = function (size) {
    document.body.setAttribute('data-font', size);
    Store.update('settings.fontSize', size);
  };

  // ============ 同人文 ============
  App.selectFanficChar = function (slot) {
    const data = Store.get();
    const opts = data.characters.map(c =>
      `<div class="list-item" onclick="App._fanficPickChar(${slot},'${c.id}')">
        <div class="avatar avatar-sm">${c.avatar || '🎭'}</div>
        <div class="list-item-content"><div class="list-item-title">${esc(c.name)}</div></div>
        <span class="list-item-arrow">›</span>
      </div>`
    ).join('');
    const selfOpt = slot === 1 ? `
      <div class="list-item" onclick="App._fanficPickChar(${slot},'__self__')">
        <div class="avatar avatar-sm">🧑</div>
        <div class="list-item-content"><div class="list-item-title">你自己</div></div>
        <span class="list-item-arrow">›</span>
      </div>` : '';
    App.showModal(`
      <div class="modal-title">选择角色</div>
      ${selfOpt}${opts}
      <div class="modal-actions"><button class="btn btn-outline btn-block" onclick="App.closeModal()">取消</button></div>
    `);
  };
  App._fanficPickChar = function (slot, charId) {
    if (charId === '__self__') {
      App.fanficState['char' + slot] = null;
      el('fc-' + slot).textContent = '🧑';
      el('fn-' + slot).textContent = '你自己';
    } else {
      const c = Store.get().characters.find(x => x.id === charId);
      if (c) {
        App.fanficState['char' + slot] = charId;
        el('fc-' + slot).textContent = c.avatar || '🎭';
        el('fn-' + slot).textContent = c.name;
      }
    }
    App.closeModal();
  };

  App.fanficToggleTag = function (elem, tag) {
    const idx = App.fanficState.tags.indexOf(tag);
    if (idx >= 0) { App.fanficState.tags.splice(idx, 1); elem.classList.remove('tag-selected'); }
    else { App.fanficState.tags.push(tag); elem.classList.add('tag-selected'); }
  };
  App.fanficToggleTrope = function (elem, trope) {
    const idx = App.fanficState.tropes.indexOf(trope);
    if (idx >= 0) { App.fanficState.tropes.splice(idx, 1); elem.classList.remove('tag-selected'); }
    else { App.fanficState.tropes.push(trope); elem.classList.add('tag-selected'); }
  };
  App.fanficToggleAllTags = function () {
    document.querySelectorAll('#fanfic-tags .tag').forEach(t => {
      if (!t.classList.contains('tag-selected')) t.click();
    });
  };
  App.fanficSelectWC = function (elem) {
    document.querySelectorAll('#fanfic-wc .wc-option').forEach(e => e.classList.remove('active'));
    elem.classList.add('active');
    App.fanficState.wc = parseInt(elem.dataset.wc);
  };
  App.fanficSelectStyle = function (elem) {
    document.querySelectorAll('#fanfic-style .style-option').forEach(e => e.classList.remove('active'));
    elem.classList.add('active');
    App.fanficState.style = elem.dataset.st;
  };

  App.genFanfic = async function () {
    const st = App.fanficState;
    const data = Store.get();

    // 豆子
    if (!Store.spendBeans(CONFIG.currency.fanficCost)) {
      App.toast('豆子不足！', 'warn');
      return;
    }

    const char0 = st.char0 ? data.characters.find(c => c.id === st.char0) : null;
    const char0Name = char0 ? char0.name : '主角A';
    const char0Desc = char0 ? (char0.persona || '').slice(0, 200) : '';
    const char1Name = st.char1 ? data.characters.find(c => c.id === st.char1)?.name : '你（读者）';

    const prompt =
      `请写一篇同人文。\n` +
      `CP: ${char0Name} × ${char1Name}\n` +
      (char0Desc ? `角色A设定: ${char0Desc}\n` : '') +
      `标签: ${st.tags.join('、') || '自由发挥'}\n` +
      `梗: ${st.tropes.join('、') || '无'}\n` +
      `风格: ${st.style}\n` +
      `字数: 约${st.wc}字\n\n` +
      `请直接输出小说正文，不要加标题前缀。开头可以有一个合适的标题。`;

    App.showLoading('正在创作同人文…');
    try {
      const result = await API.chat(
        [
          { role: 'system', content: '你是一个优秀的网络小说作家，擅长写同人文和言情故事。文笔细腻，情感丰富，善用对话和细节描写。' },
          { role: 'user', content: prompt },
        ],
        { stream: false, maxTokens: Math.min(st.wc * 2, 4000), temperature: 0.95 }
      );

      App.hideLoading();
      const area = el('fanfic-result-area');
      if (area) {
        area.innerHTML = `
          <div class="fanfic-result">
            <div class="fanfic-title">✨ ${esc(char0Name)} × ${esc(char1Name)}</div>
            ${esc(result)}
          </div>
          <div style="display:flex;gap:8px;margin-top:12px">
            <button class="btn btn-outline btn-block" onclick="App._copyFanfic()">📋 复制</button>
            <button class="btn btn-primary btn-block" onclick="App.genFanfic()">🔄 再写一篇</button>
          </div>
        `;
        area.scrollIntoView({ behavior: 'smooth' });
        // 保存
        data.fanfics.push({ id: Store.uid(), content: result, chars: [char0Name, char1Name], time: Date.now() });
        Store.save();
      }
    } catch (e) {
      App.hideLoading();
      Store.addBeans(CONFIG.currency.fanficCost);
      App.toast('生成失败: ' + e.message, 'error');
    }
  };
  App._copyFanfic = function () {
    const text = el('fanfic-result-area')?.querySelector('.fanfic-result')?.innerText || '';
    navigator.clipboard.writeText(text).then(() => App.toast('已复制到剪贴板', 'success'));
  };

  // ============ 论坛 ============
  App.forumGenerate = async function () {
    const data = Store.get();
    if (data.characters.length === 0) {
      App.toast('请先创建角色', 'warn');
      return;
    }
    if (!Store.spendBeans(1)) { App.toast('豆子不足！', 'warn'); return; }

    // 随机选一个角色发帖
    const char = data.characters[Math.floor(Math.random() * data.characters.length)];

    App.showLoading('角色正在发动态…');
    try {
      const result = await API.chat(
        [
          { role: 'system', content: `你是「${char.name}」，${char.persona || ''}\n请以这个角色的身份发一条社交媒体动态（类似微博/朋友圈），内容是日常生活的分享，50-150字，可以带emoji。只输出动态内容，不要加引号或其他说明。` },
          { role: 'user', content: '发一条新动态吧' },
        ],
        { stream: false, maxTokens: 300, temperature: 1.0 }
      );

      App.hideLoading();
      data.forumPosts.push({
        id: Store.uid(),
        user: char.name,
        avatar: char.avatar || '🎭',
        content: result.trim(),
        time: Date.now(),
        likes: Math.floor(Math.random() * 200) + 50,
        comments: Math.floor(Math.random() * 30) + 5,
        views: Math.floor(Math.random() * 3000) + 500,
        liked: false,
      });
      Store.save();
      Pages.forum();
      App.toast('动态已发布', 'success');
    } catch (e) {
      App.hideLoading();
      Store.addBeans(1);
      App.toast('生成失败: ' + e.message, 'error');
    }
  };

  App.forumLike = function (postId) {
    const data = Store.get();
    const p = data.forumPosts.find(x => x.id === postId);
    if (p) {
      p.liked = !p.liked;
      p.likes += p.liked ? 1 : -1;
      Store.save();
      Pages.forum();
    }
  };

  // ============ 世界书 ============
  App.createWorldBook = function () {
    App.showModal(`
      <div class="modal-title">新建世界书</div>
      <div style="margin-bottom:12px">
        <label class="field-label">名称</label>
        <input class="input" id="wb-name" placeholder="如：修仙世界">
      </div>
      <div style="margin-bottom:12px">
        <label class="field-label">全局设定</label>
        <textarea class="textarea" id="wb-global" placeholder="整个世界的基础设定…"></textarea>
      </div>
      <div class="modal-actions">
        <button class="btn btn-outline" onclick="App.closeModal()">取消</button>
        <button class="btn btn-primary" onclick="App._createWb()">创建</button>
      </div>
    `);
  };
  App._createWb = function () {
    const wb = WorldBook.createWorldBook(el('wb-name').value.trim() || '新世界书');
    wb.globalSetting = el('wb-global').value.trim();
    Store.get().worldBooks.push(wb);
    Store.save();
    App.closeModal();
    Pages.worldbook();
    App.toast('已创建', 'success');
  };

  App.editWbGlobal = function (wbId) {
    const wb = Store.get().worldBooks.find(w => w.id === wbId);
    if (!wb) return;
    App.showModal(`
      <div class="modal-title">编辑全局设定</div>
      <textarea class="textarea" id="wb-global-edit" style="min-height:160px">${esc(wb.globalSetting || '')}</textarea>
      <div class="modal-actions">
        <button class="btn btn-outline" onclick="App.closeModal()">取消</button>
        <button class="btn btn-primary" onclick="App._saveWbGlobal('${wbId}')">保存</button>
      </div>
    `);
  };
  App._saveWbGlobal = function (wbId) {
    const wb = Store.get().worldBooks.find(w => w.id === wbId);
    wb.globalSetting = el('wb-global-edit').value.trim();
    Store.save();
    App.closeModal();
    Pages.worldbook();
    App.toast('已保存', 'success');
  };

  App.addWbEntry = function (wbId) {
    App._editWbEntryForm(wbId, null);
  };
  App.editWbEntry = function (wbId, entryId) {
    App._editWbEntryForm(wbId, entryId);
  };
  App._editWbEntryForm = function (wbId, entryId) {
    const wb = Store.get().worldBooks.find(w => w.id === wbId);
    const e = entryId ? wb.entries.find(x => x.id === entryId) : null;
    App.showModal(`
      <div class="modal-title">${entryId ? '编辑条目' : '新增条目'}</div>
      <div style="margin-bottom:12px">
        <label class="field-label">标题</label>
        <input class="input" id="entry-title" value="${e ? esc(e.title) : ''}" placeholder="如：碧波宗">
      </div>
      <div style="margin-bottom:12px">
        <label class="field-label">关键词（逗号分隔）</label>
        <input class="input" id="entry-keywords" value="${e ? esc((e.keywords || []).join(', ')) : ''}" placeholder="碧波宗, 宗门, 山门">
      </div>
      <div style="margin-bottom:12px">
        <label class="field-label">内容</label>
        <textarea class="textarea" id="entry-content" style="min-height:100px">${e ? esc(e.content) : ''}</textarea>
      </div>
      <div style="margin-bottom:12px">
        <label class="field-label">优先级（数字越大越优先）</label>
        <input class="input" type="number" id="entry-priority" value="${e ? (e.priority || 0) : 0}">
      </div>
      <div style="margin-bottom:12px">
        <label class="field-label">常驻条目（始终注入）</label>
        <label class="switch">
          <input type="checkbox" id="entry-constant" ${e && e.constant ? 'checked' : ''}>
          <span class="switch-slider"></span>
        </label>
      </div>
      <div class="modal-actions">
        <button class="btn btn-outline" onclick="App.closeModal()">取消</button>
        <button class="btn btn-primary" onclick="App._saveWbEntry('${wbId}','${entryId || ''}')">保存</button>
      </div>
    `);
  };
  App._saveWbEntry = function (wbId, entryId) {
    const wb = Store.get().worldBooks.find(w => w.id === wbId);
    const e = entryId ? wb.entries.find(x => x.id === entryId) : { id: Store.uid() };
    e.title = el('entry-title').value.trim() || '未命名';
    e.keywords = el('entry-keywords').value.split(/[,，]/).map(s => s.trim()).filter(Boolean);
    e.content = el('entry-content').value.trim();
    e.priority = parseInt(el('entry-priority').value) || 0;
    e.constant = el('entry-constant').checked;
    e.enabled = true;
    if (!entryId) wb.entries.push(e);
    Store.save();
    App.closeModal();
    Pages.worldbook();
    App.toast('已保存', 'success');
  };
  App.deleteWbEntry = function (wbId, entryId) {
    const wb = Store.get().worldBooks.find(w => w.id === wbId);
    wb.entries = wb.entries.filter(e => e.id !== entryId);
    Store.save();
    Pages.worldbook();
    App.toast('已删除', 'success');
  };

  // ============ 数据管理 ============
  App.exportData = function () {
    const json = Store.exportData();
    const blob = new Blob([json], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'mochi-phone-backup-' + new Date().toISOString().slice(0, 10) + '.json';
    a.click();
    URL.revokeObjectURL(url);
    App.toast('已导出备份', 'success');
  };

  App.importData = function () {
    App.showModal(`
      <div class="modal-title">导入数据</div>
      <div class="text-sm text-muted mb-16">选择之前导出的备份文件（.json）</div>
      <input type="file" accept=".json" id="import-file" style="width:100%;margin-bottom:12px">
      <div class="text-sm" style="color:#F44336">注意：导入会覆盖当前所有数据</div>
      <div class="modal-actions">
        <button class="btn btn-outline" onclick="App.closeModal()">取消</button>
        <button class="btn btn-primary" onclick="App._doImport()">导入</button>
      </div>
    `);
  };
  App._doImport = function () {
    const file = el('import-file').files[0];
    if (!file) { App.toast('请选择文件', 'warn'); return; }
    const reader = new FileReader();
    reader.onload = function () {
      if (Store.importData(reader.result)) {
        App.closeModal();
        DefaultData.initDefaults();
        App.navigate('home');
        App.toast('导入成功', 'success');
      } else {
        App.toast('导入失败：文件格式错误', 'error');
      }
    };
    reader.readAsText(file);
  };

  App.about = function () {
    App.showModal(`
      <div class="modal-title">🍡 Mochi-Phone</div>
      <div class="text-center" style="line-height:2">
        <div style="font-size:48px;margin-bottom:12px">🍡</div>
        <div style="font-weight:700;font-size:16px">Mochi-Phone v${CONFIG.app.version}</div>
        <div class="text-sm text-muted">温柔陪伴 · 文游世界</div>
        <div style="margin-top:16px;text-align:left" class="text-sm">
          一个开源的 AI 陪伴 + 文字游戏平台。<br>
          ✅ 角色聊天 + 世界书 + 记忆沉淀<br>
          ✅ 文字冒险游戏引擎（存档/读档）<br>
          ✅ 同人文生成器<br>
          ✅ AI 论坛动态<br>
          ✅ 多主题 / 纯本地存储 / 自托管<br>
        </div>
        <div class="text-sm text-muted" style="margin-top:16px">所有数据存储在浏览器本地，不会上传到服务器。</div>
      </div>
      <div class="modal-actions">
        <button class="btn btn-primary btn-block" onclick="App.closeModal()">好的</button>
      </div>
    `);
  };

  App.resetData = function () {
    App.showModal(`
      <div class="modal-title" style="color:#F44336">重置所有数据？</div>
      <div class="text-center text-sm text-muted">这将删除所有角色、聊天、存档、记忆和设置，不可恢复！</div>
      <div class="modal-actions">
        <button class="btn btn-outline" onclick="App.closeModal()">取消</button>
        <button class="btn btn-primary" style="background:#F44336" onclick="App._doReset()">重置</button>
      </div>
    `);
  };
  App._doReset = function () {
    Store.reset();
    DefaultData.initDefaults();
    App.closeModal();
    App.navigate('home');
    App.toast('已重置', 'success');
  };

  // ============ 启动 ============
  window.App = App;
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', App.init);
  } else {
    App.init();
  }
})();
