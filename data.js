/**
 * pages.js — 所有页面渲染器
 * 每个页面是一个函数，负责渲染 HTML 并绑定事件。
 */
(function () {
  'use strict';

  const Pages = {};
  let chatCurrentChar = null; // 当前聊天的角色 ID

  // ============ 工具函数 ============
  function el(id) { return document.getElementById(id); }
  function esc(s) { return (s || '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;'); }
  function timeStr(ts) {
    const d = new Date(ts);
    const now = new Date();
    if (d.toDateString() === now.toDateString()) {
      return d.getHours().toString().padStart(2, '0') + ':' + d.getMinutes().toString().padStart(2, '0');
    }
    return (d.getMonth() + 1) + '/' + d.getDate();
  }
  function getChar(id) { return Store.get().characters.find(c => c.id === id); }
  function getWorldBook(id) { return id ? Store.get().worldBooks.find(w => w.id === id) : null; }

  // ============ 首页 / 手机 ============
  Pages.home = function () {
    const data = Store.get();
    const now = new Date();
    const hh = now.getHours().toString().padStart(2, '0');
    const mm = now.getMinutes().toString().padStart(2, '0');
    const weekdays = ['周日', '周一', '周二', '周三', '周四', '周五', '周六'];
    const dateStr = `${now.getMonth() + 1}月${now.getDate()}日 ${weekdays[now.getDay()]}`;

    // 取第一个角色作为首页 companion
    const companion = data.characters[0] || { name: '小墨', avatar: '🍡', tag: '陪伴师' };

    const memCount = data.memories.length;

    el('page-container').innerHTML = `
      <div class="page">
        <div class="page-header">
          <div class="page-title">手机 <span class="sparkle">✨</span></div>
          <div class="bean-badge">🍡 豆子 ${data.user.beans}</div>
        </div>

        <div class="home-hero">
          <div class="home-clock">${hh}:${mm}</div>
          <div class="home-date">${dateStr}</div>
          <div class="home-mascot">🍡</div>
          <div class="home-companion">
            <div class="avatar">${companion.avatar || '🍡'}</div>
            <div class="home-companion-info">
              <div class="home-companion-name">${esc(companion.name)}</div>
              <div class="home-companion-status">今天也要开心哦~❤️</div>
            </div>
          </div>
        </div>

        <div class="home-mem-link" onclick="App.navigate('memory')">
          <div>
            <div class="text-sm text-muted">联系人 / 关系 / 回忆 ✨</div>
            <div class="text-sm" style="margin-top:4px">已沉淀回忆</div>
          </div>
          <div class="home-mem-count">${memCount}</div>
        </div>

        <div class="func-grid">
          <div class="func-item" onclick="App.navigate('chat')">
            <div class="func-icon bg-social">💬</div>
            <div class="func-label">聊天</div>
          </div>
          <div class="func-item" onclick="App.navigate('tongren')">
            <div class="func-icon bg-tongren">✏️</div>
            <div class="func-label">同人</div>
          </div>
          <div class="func-item" onclick="App.navigate('worldbook')">
            <div class="func-icon bg-worldbook">🌐</div>
            <div class="func-label">世界书</div>
          </div>
          <div class="func-item" onclick="App.navigate('forum')">
            <div class="func-icon bg-anniversary">💌</div>
            <div class="func-label">论坛</div>
          </div>
          <div class="func-item" onclick="App.navigate('wenyu')">
            <div class="func-icon bg-quest">📖</div>
            <div class="func-label">文游</div>
          </div>
          <div class="func-item" onclick="App.navigate('character')">
            <div class="func-icon bg-contacts">🎭</div>
            <div class="func-label">角色</div>
          </div>
          <div class="func-item" onclick="App.navigate('profile')">
            <div class="func-icon bg-diary">📝</div>
            <div class="func-label">日记</div>
          </div>
          <div class="func-item" onclick="App.navigate('settings')">
            <div class="func-icon bg-settings">⚙️</div>
            <div class="func-label">设置</div>
          </div>
        </div>

        <div class="card mt-16">
          <div class="flex-between mb-8">
            <span style="font-weight:700">每日签到</span>
            <span class="text-sm text-muted">连续 ${data.user.days} 天</span>
          </div>
          <button class="btn btn-primary btn-block" onclick="App.dailyCheckIn(this)">🍭 签到领豆子</button>
        </div>
      </div>
    `;
  };

  // ============ 聊天列表 ============
  Pages.chat = function () {
    const data = Store.get();
    const chars = data.characters;

    let listHtml = '';
    if (chars.length === 0) {
      listHtml = `
        <div class="empty-state">
          <div class="empty-mascot">💬</div>
          <div class="empty-text">还没有聊天对象</div>
          <div class="empty-sub">去「角色」页创建一个角色吧</div>
        </div>`;
    } else {
      listHtml = chars.map(c => {
        const msgs = data.chats[c.id] || [];
        const last = msgs[msgs.length - 1];
        const lastText = last ? (last.role === 'user' ? '我: ' : '') + last.content.slice(0, 40) : c.greeting ? c.greeting.slice(0, 40) : '开始对话吧~';
        return `
          <div class="chat-list-item" onclick="App.openChat('${c.id}')">
            <div class="avatar">${c.avatar || '🎭'}</div>
            <div class="chat-list-info">
              <div class="chat-list-name">${esc(c.name)} ${c.tag ? `<span class="tag tag-pink" style="font-size:9px;padding:1px 6px">${esc(c.tag)}</span>` : ''}</div>
              <div class="chat-list-last">${esc(lastText)}</div>
            </div>
            <div class="chat-list-time">${last ? timeStr(last.time) : ''}</div>
          </div>`;
      }).join('');
    }

    el('page-container').innerHTML = `
      <div class="page">
        <div class="page-header">
          <div class="page-title">聊天 <span class="sparkle">✨</span></div>
          <div class="bean-badge">🍡 豆子 ${data.user.beans}</div>
        </div>
        ${listHtml}
      </div>
    `;
  };

  // ============ 聊天对话 ============
  Pages.chatView = function (charId) {
    chatCurrentChar = charId;
    const char = getChar(charId);
    if (!char) { App.navigate('chat'); return; }

    const data = Store.get();
    let msgs = data.chats[charId] || [];

    // 如果没有消息，用 greeting 开场
    if (msgs.length === 0 && char.greeting) {
      msgs = [{ role: 'assistant', content: char.greeting, time: Date.now() }];
      data.chats[charId] = msgs;
      Store.save();
    }

    el('page-container').innerHTML = `
      <div class="chat-view">
        <div class="chat-header">
          <span class="chat-back" onclick="App.navigate('chat')">‹</span>
          <div class="avatar avatar-sm">${char.avatar || '🎭'}</div>
          <div style="flex:1">
            <div style="font-weight:700;font-size:15px">${esc(char.name)}</div>
            <div class="text-sm text-muted">${esc(char.tag || '在线')}</div>
          </div>
          <span style="font-size:20px;cursor:pointer" onclick="App.clearChat('${charId}')">🗑</span>
        </div>
        <div class="chat-messages" id="chat-messages">
          ${msgs.map(m => renderMsg(m, char)).join('')}
        </div>
        <div class="chat-input-bar">
          <input class="chat-input" id="chat-input" placeholder="说点什么…" 
                 onkeydown="if(event.key==='Enter')App.sendChatMsg()" 
                 ${App.chatBusy ? 'disabled' : ''}>
          <button class="chat-send" onclick="App.sendChatMsg()" ${App.chatBusy ? 'disabled' : ''}>↑</button>
        </div>
      </div>
    `;
    scrollChatBottom();
  };

  function renderMsg(m, char) {
    if (m.role === 'user') {
      return `<div class="msg-bubble msg-user">${esc(m.content)}</div>`;
    }
    return `<div class="msg-bubble msg-ai">
      ${m.role === 'assistant' ? `<div class="msg-name">${esc(char.name)}</div>` : ''}
      ${esc(m.content)}
    </div>`;
  }

  function scrollChatBottom() {
    const c = el('chat-messages');
    if (c) c.scrollTop = c.scrollHeight;
  }

  // 暴露给 app.js 调用
  Pages.chatScrollBottom = scrollChatBottom;
  Pages.renderMsg = renderMsg;
  Pages.getChatCurrentChar = () => chatCurrentChar;

  // ============ 角色页 ============
  Pages.character = function () {
    const data = Store.get();

    let listHtml = '';
    if (data.characters.length === 0) {
      listHtml = `
        <div class="empty-state">
          <div class="empty-mascot">🎭</div>
          <div class="empty-text">还没有角色</div>
          <div class="empty-sub">点击右上角创建角色</div>
        </div>`;
    } else {
      listHtml = data.characters.map(c => `
        <div class="char-card" onclick="App.openChat('${c.id}')">
          <div class="avatar">${c.avatar || '🎭'}</div>
          <div class="char-card-info">
            <div class="char-card-name">${esc(c.name)} ${c.tag ? `<span class="tag tag-pink" style="font-size:9px;padding:1px 6px">${esc(c.tag)}</span>` : ''}</div>
            <div class="char-card-desc">${esc(c.persona || '').slice(0, 80)}</div>
          </div>
          <div style="display:flex;flex-direction:column;gap:8px">
            <span style="font-size:16px;cursor:pointer" onclick="event.stopPropagation();App.editChar('${c.id}')">✏️</span>
            <span style="font-size:16px;cursor:pointer" onclick="event.stopPropagation();App.deleteChar('${c.id}')">🗑</span>
          </div>
        </div>`).join('');
    }

    el('page-container').innerHTML = `
      <div class="page">
        <div class="page-header">
          <div class="page-title">角色 <span class="sparkle">✨</span></div>
          <button class="btn btn-primary btn-sm" onclick="App.editChar(null)">＋ 创建</button>
        </div>
        ${listHtml}
      </div>
    `;
  };

  // ============ 文游页 ============
  Pages.wenyu = function (tab) {
    tab = tab || 'library';
    const data = Store.get();
    const scripts = window.DEFAULT_SCRIPTS || [];

    let contentHtml = '';
    if (tab === 'library') {
      contentHtml = scripts.map(s => {
        const diffTag = s.difficulty === '简单' ? 'tag-green' : s.difficulty === '困难' ? 'tag-dark' : 'tag-blue';
        return `
          <div class="script-card">
            <div class="script-cover" style="background:${s.coverColor || '#FFB6C1'}33">${s.cover || '📖'}</div>
            <div class="script-info">
              <div class="script-title">${esc(s.title)}</div>
              <div class="script-tags">
                <span class="tag ${diffTag}">${esc(s.difficulty)}</span>
                ${s.tags.map(t => `<span class="tag tag-pink">${esc(t)}</span>`).join('')}
              </div>
              <div class="script-synopsis">${esc(s.synopsis)}</div>
              <div class="script-enter">
                <button class="btn btn-outline btn-sm" onclick="App.startGame('${s.id}')">进入剧本 ›</button>
              </div>
            </div>
          </div>`;
      }).join('');
    } else {
      // 我的存档
      if (data.saves.length === 0) {
        contentHtml = `
          <div class="empty-state">
            <div class="empty-mascot">💾</div>
            <div class="empty-text">还没有存档</div>
            <div class="empty-sub">在游戏中点击「存档」即可保存进度</div>
          </div>`;
      } else {
        contentHtml = data.saves.map(sv => {
          const script = scripts.find(s => s.id === sv.scriptId);
          return `
            <div class="script-card">
              <div class="script-cover" style="background:${(script && script.coverColor) || '#FFB6C1'}33">${(script && script.cover) || '💾'}</div>
              <div class="script-info">
                <div class="script-title">${esc(script ? script.title : '未知剧本')}</div>
                <div class="script-synopsis">第${sv.turn || 1}回合 · ${esc(sv.location || '未知地点')}</div>
                <div class="script-enter">
                  <button class="btn btn-outline btn-sm" onclick="App.loadGame('${sv.id}')">继续 ›</button>
                  <button class="btn btn-sm" style="margin-left:6px;color:#F44336" onclick="App.deleteSave('${sv.id}')">删除</button>
                </div>
              </div>
            </div>`;
        }).join('');
      }
    }

    el('page-container').innerHTML = `
      <div class="page">
        <div class="page-header">
          <div class="page-title">文游 <span class="sparkle">✨</span></div>
          <div class="bean-badge">🍡 豆子 ${data.user.beans}</div>
        </div>
        <div class="wenyu-tabs">
          <div class="wenyu-tab ${tab === 'library' ? 'active' : ''}" onclick="App.navigate('wenyu','library')">剧本库</div>
          <div class="wenyu-tab ${tab === 'saves' ? 'active' : ''}" onclick="App.navigate('wenyu','saves')">我的存档</div>
        </div>
        ${contentHtml}
      </div>
    `;
  };

  // ============ 文游游戏内 ============
  Pages.gameView = function () {
    const data = Store.get();
    const game = data.currentGame;
    if (!game) { App.navigate('wenyu'); return; }

    const script = (window.DEFAULT_SCRIPTS || []).find(s => s.id === game.scriptId);

    // 状态栏
    const statsHtml = Object.entries(game.stats || {}).map(([k, v]) => {
      if (typeof v === 'number') {
        return `<div class="game-stat"><span class="game-stat-icon">📊</span>${k}: ${v}</div>`;
      }
      return `<div class="game-stat"><span class="game-stat-icon">📊</span>${k}: ${esc(String(v))}</div>`;
    }).join('');

    el('page-container').innerHTML = `
      <div class="page">
        <div class="page-header">
          <div style="display:flex;align-items:center;gap:8px">
            <span class="chat-back" onclick="App.exitGame()">‹</span>
            <div class="page-title" style="font-size:18px">${esc(script ? script.title : '文游')}</div>
          </div>
          <button class="btn btn-outline btn-sm" onclick="App.saveGame()">💾 存档</button>
        </div>

        <div class="game-stats-bar">
          <div class="game-stat"><span class="game-stat-icon">⚡</span>体力 ${game.stats?.体力 ?? '-'}</div>
          ${statsHtml}
        </div>

        <div class="game-char-bar">
          <div class="avatar avatar-sm">${game.charAvatar || '🧑'}</div>
          <div style="flex:1">
            <div class="game-char-name">${esc(game.charName || '主角')}</div>
            <div class="game-char-stage">${esc(game.stage || '')}</div>
          </div>
          <div class="text-sm text-muted">${esc(game.location || '')}</div>
        </div>

        <div class="game-narrative" id="game-narrative">${esc(game.narrative || '加载中…')}</div>

        <div class="game-actions" id="game-actions">
          ${(game.options || []).map((opt, i) => `
            <div class="game-action" onclick="App.gameChoose(${i})">
              <div style="display:flex;align-items:center;gap:8px">
                <span class="game-action-icon">${opt.icon || '▶'}</span>
                <span>${esc(opt.text)}</span>
              </div>
              <span class="game-action-arrow">›</span>
            </div>
          `).join('')}
          ${(!game.options || game.options.length === 0) ? `
            <div class="game-action" onclick="App.gameCustomInput()">
              <div style="display:flex;align-items:center;gap:8px">
                <span class="game-action-icon">✏️</span>
                <span>自由输入行动…</span>
              </div>
              <span class="game-action-arrow">›</span>
            </div>
          ` : ''}
        </div>
      </div>
    `;
  };

  // ============ 记忆页 ============
  Pages.memory = function () {
    const data = Store.get();
    const mems = data.memories;

    let listHtml = '';
    if (mems.length === 0) {
      listHtml = `
        <div class="empty-state">
          <div class="empty-mascot">✨</div>
          <div class="empty-text">还没有沉淀的回忆</div>
          <div class="empty-sub">和角色聊天后，AI 会自动提取记忆哦</div>
        </div>`;
    } else {
      listHtml = mems.slice().reverse().map(m => `
        <div class="mem-card">
          <div class="mem-card-top">
            <span class="mem-card-cat">${esc(m.category || '记忆')}</span>
            <span class="mem-card-time">${timeStr(m.time)}</span>
          </div>
          <div class="mem-card-text">${esc(m.content)}</div>
          <div class="mem-card-source">来源: ${esc(m.source || '聊天')} ${m.sourceChar ? '· ' + esc(m.sourceChar) : ''}</div>
          <div style="display:flex;gap:8px;margin-top:8px">
            <span class="text-sm" style="color:var(--primary);cursor:pointer" onclick="App.editMemory('${m.id}')">编辑</span>
            <span class="text-sm" style="color:#F44336;cursor:pointer" onclick="App.deleteMemory('${m.id}')">删除</span>
          </div>
        </div>`).join('');
    }

    el('page-container').innerHTML = `
      <div class="page">
        <div class="page-header">
          <div class="page-title">记忆 <span class="sparkle">✨</span></div>
          <button class="btn btn-primary btn-sm" onclick="App.addMemory()">＋ 新增</button>
        </div>
        <div class="mem-summary">
          <div class="mem-count">${mems.length}</div>
          <div class="mem-label">已沉淀回忆 · 与你之间的点滴，都被好好珍藏</div>
          <div style="font-size:36px;margin-top:8px">🍡</div>
        </div>
        ${listHtml}
      </div>
    `;
  };

  // ============ 我的页 ============
  Pages.profile = function () {
    const data = Store.get();
    const u = data.user;

    el('page-container').innerHTML = `
      <div class="page">
        <div class="page-header">
          <div class="page-title">我的 <span class="sparkle">✨</span></div>
          <span style="font-size:20px;cursor:pointer" onclick="App.navigate('settings')">⚙️</span>
        </div>

        <div class="profile-header">
          <div class="profile-avatar">${u.avatar || '🧑'}</div>
          <div class="profile-name">${esc(u.name)} <span style="font-size:14px;cursor:pointer" onclick="App.editUserName()">✏️</span></div>
          <div class="profile-id">ID: ${u.id}</div>
        </div>

        <div class="profile-stats">
          <div class="profile-stat">
            <div class="profile-stat-num">${u.beans}</div>
            <div class="profile-stat-label">豆子</div>
          </div>
          <div class="profile-stat">
            <div class="profile-stat-num">${data.characters.length}</div>
            <div class="profile-stat-label">角色</div>
          </div>
          <div class="profile-stat">
            <div class="profile-stat-num">${data.memories.length}</div>
            <div class="profile-stat-label">回忆</div>
          </div>
          <div class="profile-stat">
            <div class="profile-stat-num">${u.days}</div>
            <div class="profile-stat-label">天数</div>
          </div>
        </div>

        <div class="card">
          <div class="list-item" onclick="App.navigate('settings')">
            <span class="list-item-icon">⚙️</span>
            <div class="list-item-content"><div class="list-item-title">设置</div><div class="list-item-sub">API / 主题 / 字号</div></div>
            <span class="list-item-arrow">›</span>
          </div>
          <div class="list-item" onclick="App.navigate('worldbook')">
            <span class="list-item-icon">🌐</span>
            <div class="list-item-content"><div class="list-item-title">世界书</div><div class="list-item-sub">${data.worldBooks.length} 本</div></div>
            <span class="list-item-arrow">›</span>
          </div>
          <div class="list-item" onclick="App.exportData()">
            <span class="list-item-icon">📤</span>
            <div class="list-item-content"><div class="list-item-title">导出数据</div><div class="list-item-sub">备份所有存档和记忆</div></div>
            <span class="list-item-arrow">›</span>
          </div>
          <div class="list-item" onclick="App.importData()">
            <span class="list-item-icon">📥</span>
            <div class="list-item-content"><div class="list-item-title">导入数据</div><div class="list-item-sub">从备份恢复</div></div>
            <span class="list-item-arrow">›</span>
          </div>
          <div class="list-item" onclick="App.about()">
            <span class="list-item-icon">ℹ️</span>
            <div class="list-item-content"><div class="list-item-title">关于 Mochi-Phone</div><div class="list-item-sub">v${CONFIG.app.version}</div></div>
            <span class="list-item-arrow">›</span>
          </div>
          <div class="list-item" onclick="App.resetData()" style="color:#F44336">
            <span class="list-item-icon">🗑</span>
            <div class="list-item-content"><div class="list-item-title" style="color:#F44336">重置所有数据</div></div>
            <span class="list-item-arrow">›</span>
          </div>
        </div>
      </div>
    `;
  };

  // ============ 设置页 ============
  Pages.settings = function () {
    const s = Store.get().settings;
    const modelOpts = CONFIG.api.modelOptions.map(m =>
      `<option value="${m}" ${m === s.model ? 'selected' : ''}>${m}</option>`
    ).join('');
    const themeOpts = [
      { v: 'pink', l: '粉色' }, { v: 'blue', l: '蓝色' }, { v: 'green', l: '绿色' }, { v: 'dark', l: '暗色' }
    ].map(t => `<option value="${t.v}" ${t.v === s.theme ? 'selected' : ''}>${t.l}</option>`).join('');
    const fontOpts = [
      { v: 'small', l: '小' }, { v: 'medium', l: '中' }, { v: 'large', l: '大' }
    ].map(t => `<option value="${t.v}" ${t.v === s.fontSize ? 'selected' : ''}>${t.l}</option>`).join('');

    el('page-container').innerHTML = `
      <div class="page">
        <div class="page-header">
          <div style="display:flex;align-items:center;gap:8px">
            <span class="chat-back" onclick="App.navigate('profile')">‹</span>
            <div class="page-title" style="font-size:18px">设置</div>
          </div>
        </div>

        <div class="settings-group">
          <div class="settings-group-title">API 配置</div>
          <div class="settings-card">
            <div class="setting-row" style="flex-direction:column;align-items:stretch;gap:6px">
              <label>API 地址</label>
              <input class="input" id="set-baseurl" value="${esc(s.baseURL)}">
            </div>
            <div class="setting-row" style="flex-direction:column;align-items:stretch;gap:6px">
              <label>API 密钥</label>
              <input class="input" id="set-apikey" type="password" value="${esc(s.apiKey)}" placeholder="sk-...">
            </div>
            <div class="setting-row">
              <label>模型</label>
              <select class="select" id="set-model" style="max-width:180px">${modelOpts}</select>
            </div>
            <div class="setting-row">
              <label>温度 (${s.temperature})</label>
              <input type="range" min="0" max="2" step="0.05" value="${s.temperature}" 
                     oninput="this.previousElementSibling.textContent='温度 ('+this.value+')'" 
                     onchange="Store.update('settings.temperature',parseFloat(this.value))" style="width:120px">
            </div>
            <div class="setting-row">
              <label>最大 Token</label>
              <input class="input" type="number" id="set-maxtokens" value="${s.maxTokens}" style="max-width:100px">
            </div>
            <div class="setting-row">
              <label>流式输出</label>
              <label class="switch">
                <input type="checkbox" id="set-streaming" ${s.streaming ? 'checked' : ''}>
                <span class="switch-slider"></span>
              </label>
            </div>
            <div class="setting-row">
              <label>自动沉淀记忆</label>
              <label class="switch">
                <input type="checkbox" id="set-automem" ${s.autoMemory ? 'checked' : ''}>
                <span class="switch-slider"></span>
              </label>
            </div>
          </div>
          <div style="display:flex;gap:8px;margin-top:10px">
            <button class="btn btn-primary btn-block" onclick="App.saveSettings()">保存设置</button>
            <button class="btn btn-outline" onclick="App.testApi()">测试连接</button>
          </div>
        </div>

        <div class="settings-group">
          <div class="settings-group-title">外观</div>
          <div class="settings-card">
            <div class="setting-row">
              <label>主题</label>
              <select class="select" id="set-theme" onchange="App.applyTheme(this.value)">${themeOpts}</select>
            </div>
            <div class="setting-row">
              <label>字号</label>
              <select class="select" id="set-fontsize" onchange="App.applyFontSize(this.value)">${fontOpts}</select>
            </div>
          </div>
        </div>
      </div>
    `;
  };

  // ============ 同人文页 ============
  Pages.tongren = function () {
    const data = Store.get();
    const chars = data.characters;

    const allTags = ['古代', '现代', '甜文', '虐恋', '穿越', '校园', '奇幻', '豪门', '悬疑', '重生', '宫斗', '修仙'];
    const allTropes = ['破镜重圆', '先婚后爱', '失忆梗', '青梅竹马', '欢喜冤家', '强强联手', '霸道总裁', '日久生情', '双向暗恋', '破镜重圆'];

    el('page-container').innerHTML = `
      <div class="page">
        <div class="page-header">
          <div style="display:flex;align-items:center;gap:8px">
            <span class="chat-back" onclick="App.navigate('home')">‹</span>
            <div class="page-title" style="font-size:18px">同人 <span class="sparkle">✏️</span></div>
          </div>
          <button class="btn btn-primary btn-sm" onclick="App.genFanfic()">✨ 生成</button>
        </div>

        <div class="tongren-char-pair">
          <div class="tongren-char-slot" onclick="App.selectFanficChar(0)">
            <div class="avatar avatar-lg" id="fc-0">${chars[0] ? chars[0].avatar : '👨'}</div>
            <div class="tongren-char-name" id="fn-0">${chars[0] ? esc(chars[0].name) : '选择角色'}</div>
            <div class="tongren-char-tag">${chars[0] ? esc(chars[0].tag || '角色') : '主角A'}</div>
          </div>
          <div class="tongren-x">×</div>
          <div class="tongren-char-slot" onclick="App.selectFanficChar(1)">
            <div class="avatar avatar-lg" id="fc-1" style="background:var(--primary-lighter)">🧑</div>
            <div class="tongren-char-name" id="fn-1">你自己</div>
            <div class="tongren-char-tag">主角B</div>
          </div>
        </div>

        <div class="section-title">
          <span>选择标签 ✨</span>
          <span class="section-action" onclick="App.fanficToggleAllTags()">智能推荐</span>
        </div>
        <div class="tag-group" id="fanfic-tags">
          ${allTags.map(t => `<span class="tag tag-clickable tag-pink" onclick="App.fanficToggleTag(this,'${t}')">${t}</span>`).join('')}
        </div>

        <div class="section-title">同人梗</div>
        <div class="tag-group" id="fanfic-tropes">
          ${allTropes.map(t => `<span class="tag tag-clickable tag-pink" onclick="App.fanficToggleTrope(this,'${t}')">${t}</span>`).join('')}
        </div>

        <div class="section-title">字数</div>
        <div class="word-count-options" id="fanfic-wc">
          <div class="wc-option" data-wc="500" onclick="App.fanficSelectWC(this)"><div class="wc-option-label">短篇</div><div class="wc-option-sub">500字</div></div>
          <div class="wc-option active" data-wc="1500" onclick="App.fanficSelectWC(this)"><div class="wc-option-label">中篇</div><div class="wc-option-sub">1500字</div></div>
          <div class="wc-option" data-wc="3000" onclick="App.fanficSelectWC(this)"><div class="wc-option-label">长篇</div><div class="wc-option-sub">3000字</div></div>
        </div>

        <div class="section-title">风格</div>
        <div class="style-options" id="fanfic-style">
          <div class="style-option" data-st="虐心" onclick="App.fanficSelectStyle(this)"><div class="style-option-icon">💔</div><div class="style-option-label">虐心</div></div>
          <div class="style-option active" data-st="甜蜜" onclick="App.fanficSelectStyle(this)"><div class="style-option-icon">💕</div><div class="style-option-label">甜蜜</div></div>
          <div class="style-option" data-st="搞笑" onclick="App.fanficSelectStyle(this)"><div class="style-option-icon">😄</div><div class="style-option-label">搞笑</div></div>
          <div class="style-option" data-st="正剧" onclick="App.fanficSelectStyle(this)"><div class="style-option-icon">🎭</div><div class="style-option-label">正剧</div></div>
        </div>

        <button class="btn btn-primary btn-block mt-16" onclick="App.genFanfic()">✨ 生成同人文</button>
        <div class="text-center text-sm text-muted mt-8">内容由 AI 生成，请注意辨别 ℹ️</div>

        <div id="fanfic-result-area"></div>
      </div>
    `;

    // 存储选择状态
    App.fanficState = {
      char0: chars[0] ? chars[0].id : null,
      char1: null, // null = 自己
      tags: [],
      tropes: [],
      wc: 1500,
      style: '甜蜜',
    };
  };

  // ============ 论坛页 ============
  Pages.forum = function () {
    const data = Store.get();

    let postsHtml = '';
    if (data.forumPosts.length === 0) {
      postsHtml = `
        <div class="empty-state">
          <div class="empty-mascot">💌</div>
          <div class="empty-text">还没有帖子</div>
          <div class="empty-sub">让 AI 角色发一条动态吧</div>
        </div>`;
    } else {
      postsHtml = data.forumPosts.slice().reverse().map(p => `
        <div class="forum-post">
          <div class="forum-post-header">
            <div class="avatar avatar-sm">${p.avatar || '🎭'}</div>
            <div style="flex:1">
              <div class="forum-post-user">${esc(p.user)}</div>
              <div class="forum-post-time">${timeStr(p.time)}</div>
            </div>
          </div>
          <div class="forum-post-content">${esc(p.content)}</div>
          <div class="forum-post-actions">
            <div class="forum-post-action ${p.liked ? 'liked' : ''}" onclick="App.forumLike('${p.id}')">💬 ${p.comments || 0}</div>
            <div class="forum-post-action ${p.liked ? 'liked' : ''}" onclick="App.forumLike('${p.id}')">❤️ ${p.likes || 0}</div>
            <div class="forum-post-action">👁 ${p.views || 0}</div>
          </div>
        </div>`).join('');
    }

    el('page-container').innerHTML = `
      <div class="page">
        <div class="page-header">
          <div style="display:flex;align-items:center;gap:8px">
            <span class="chat-back" onclick="App.navigate('home')">‹</span>
            <div class="page-title" style="font-size:18px">论坛 <span class="sparkle">✨</span></div>
          </div>
          <button class="btn btn-primary btn-sm" onclick="App.forumGenerate()">✨ 生成动态</button>
        </div>
        ${postsHtml}
      </div>
    `;
  };

  // ============ 世界书页 ============
  Pages.worldbook = function () {
    const data = Store.get();

    let wbHtml = '';
    data.worldBooks.forEach(wb => {
      const entriesHtml = wb.entries.map(e => `
        <div class="wb-entry" onclick="App.editWbEntry('${wb.id}','${e.id}')">
          <div class="wb-entry-top">
            <div class="wb-entry-title">${esc(e.title)}</div>
            <div>
              ${e.constant ? '<span class="wb-entry-badge wb-badge-const">常驻</span>' : '<span class="wb-entry-badge wb-badge-kw">关键词</span>'}
              <span class="wb-entry-badge wb-badge-kw" style="cursor:pointer" onclick="event.stopPropagation();App.deleteWbEntry('${wb.id}','${e.id}')">删</span>
            </div>
          </div>
          ${e.keywords && e.keywords.length ? `<div class="wb-entry-keywords">关键词: ${e.keywords.map(k => '#' + esc(k)).join(' ')}</div>` : ''}
          <div class="wb-entry-content">${esc(e.content)}</div>
        </div>`).join('');

      wbHtml += `
        <div class="card">
          <div class="flex-between mb-8">
            <div style="font-weight:700;font-size:16px">📚 ${esc(wb.name)}</div>
            <button class="btn btn-outline btn-sm" onclick="App.addWbEntry('${wb.id}')">＋ 条目</button>
          </div>
          <div class="text-sm text-muted mb-8">全局设定：</div>
          <div class="text-sm" style="white-space:pre-wrap;line-height:1.6;color:var(--text-secondary);margin-bottom:12px">${esc(wb.globalSetting || '（未设置）')}</div>
          <button class="btn btn-outline btn-sm" onclick="App.editWbGlobal('${wb.id}')">编辑全局设定</button>
          <div style="margin-top:12px">
            ${entriesHtml || '<div class="text-sm text-muted text-center" style="padding:20px">暂无条目</div>'}
          </div>
        </div>`;
    });

    el('page-container').innerHTML = `
      <div class="page">
        <div class="page-header">
          <div style="display:flex;align-items:center;gap:8px">
            <span class="chat-back" onclick="App.navigate('home')">‹</span>
            <div class="page-title" style="font-size:18px">世界书 <span class="sparkle">✨</span></div>
          </div>
          <button class="btn btn-primary btn-sm" onclick="App.createWorldBook()">＋ 新建</button>
        </div>
        <div class="card" style="background:var(--gradient-soft)">
          <div class="text-sm" style="line-height:1.8">
            <b>📖 世界书是什么？</b><br>
            世界书定义了你的故事世界：角色、地点、规则、物品等。<br>
            当对话中出现<b>关键词</b>时，对应条目会自动注入 AI 的上下文，让 AI 更了解你的世界。<br>
            <b>常驻</b>条目则始终注入。
          </div>
        </div>
        ${wbHtml || '<div class="empty-state"><div class="empty-mascot">🌐</div><div class="empty-text">还没有世界书</div></div>'}
      </div>
    `;
  };

  window.Pages = Pages;
})();
