/**
 * Mochi App - 主应用逻辑
 * 页面导航、角色管理、聊天引擎、Miya风格协议解析、消息渲染
 */
(function () {
  'use strict';

  /* ===== 全局状态 ===== */
  var App = {
    currentPage: 'chatPage',
    chatMode: 'online',
    activeRoleData: null,
    messages: [],
    chatHistory: {},
    sending: false,
    toolsPanelOpen: false,
    worldBookDialogOpen: false,
    currentWorldBookRole: null,
    communityTab: 'official'
  };

  /* 暴露给其他模块 */
  window.MochiApp = App;
  window.activeRole = function () { return App.activeRoleData; };

  /* ===== 工具函数 ===== */
  App.uuid = function () {
    return 'msg_' + Date.now() + '_' + Math.random().toString(36).slice(2, 8);
  };

  App.toast = function (msg, duration) {
    var t = document.getElementById('chatToast');
    if (!t) {
      t = document.createElement('div');
      t.id = 'chatToast';
      t.style.cssText = 'position:fixed;bottom:80px;left:50%;transform:translateX(-50%);background:rgba(0,0,0,0.75);color:#fff;padding:8px 20px;border-radius:20px;font-size:13px;z-index:99999;transition:opacity 0.3s';
      document.body.appendChild(t);
    }
    t.textContent = msg;
    t.style.opacity = '1';
    t.style.display = 'block';
    clearTimeout(t._timer);
    t._timer = setTimeout(function () {
      t.style.opacity = '0';
      setTimeout(function () { t.style.display = 'none'; }, 300);
    }, duration || 2500);
  };

  App.api = {
    get: function (url) {
      return fetch(url).then(function (r) { return r.json(); });
    },
    post: function (url, body) {
      return fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body)
      }).then(function (r) { return r.json(); });
    },
    put: function (url, body) {
      return fetch(url, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body)
      }).then(function (r) { return r.json(); });
    },
    del: function (url) {
      return fetch(url, { method: 'DELETE' }).then(function (r) { return r.json(); });
    }
  };

  /* ===== 页面导航 ===== */
  App.showPage = function (pageId) {
    var pages = document.querySelectorAll('.page');
    pages.forEach(function (p) {
      p.classList.remove('active');
    });
    var target = document.getElementById(pageId);
    if (target) target.classList.add('active');

    var navBtns = document.querySelectorAll('.bottom-nav button');
    navBtns.forEach(function (b) {
      b.classList.toggle('active', b.getAttribute('data-page') === pageId);
    });

    App.currentPage = pageId;

    var titles = {
      chatPage: '角色聊天',
      rolesPage: '我的角色',
      communityPage: '人设社区',
      phonePage: '手机',
      novelGamePage: '文字游戏',
      memoryPage: '记忆系统',
      profilePage: '我的'
    };
    var titleEl = document.getElementById('pageTitle');
    if (titleEl) titleEl.textContent = titles[pageId] || 'Mochi-phone';

    if (pageId === 'rolesPage') App.loadRoles();
    if (pageId === 'communityPage') App.loadCommunity();
    if (pageId === 'memoryPage') App.loadMemories();
    if (pageId === 'profilePage') App.loadProfile();
  };

  /* ===== 角色管理 ===== */
  App.loadRoles = function () {
    App.api.get('/api/community/roles?scope=mine').then(function (res) {
      var list = (res.data && res.data.list) || [];
      var container = document.getElementById('myRolesList');
      if (!container) return;
      if (!list.length) {
        container.innerHTML = '<div style="text-align:center;padding:40px 20px;color:#999"><p>还没有角色，去人设社区选一个吧</p><button onclick="MochiApp.showPage(\'communityPage\')" style="margin-top:12px;padding:8px 24px;border:none;border-radius:20px;background:#FF6B9D;color:#fff;font-size:14px;cursor:pointer">去社区</button></div>';
        return;
      }
      container.innerHTML = list.map(function (role) {
        return App.renderRoleCard(role, true);
      }).join('');
      container.querySelectorAll('[data-role-id]').forEach(function (card) {
        card.addEventListener('click', function () {
          var roleId = this.getAttribute('data-role-id');
          var role = list.find(function (r) { return r.id === roleId; });
          if (role) App.selectRole(role);
        });
      });
    }).catch(function () {
      App.loadOfficialRoles();
    });
  };

  App.loadOfficialRoles = function () {
    App.api.get('/api/community/roles?scope=public').then(function (res) {
      var list = (res.data && res.data.list) || [];
      var container = document.getElementById('myRolesList');
      if (!container) return;
      var official = list.filter(function (r) { return r.ownerId === 'system'; });
      if (!official.length) official = list.slice(0, 6);
      container.innerHTML = official.map(function (role) {
        return App.renderRoleCard(role, false);
      }).join('');
      container.querySelectorAll('[data-role-id]').forEach(function (card) {
        card.addEventListener('click', function () {
          var roleId = this.getAttribute('data-role-id');
          var role = official.find(function (r) { return r.id === roleId; });
          if (role) App.selectRole(role);
        });
      });
    });
  };

  App.renderRoleCard = function (role, isMine = false) {
    var avatar = role.avatar || '/avatars/avatar1.png';
    var tags = (role.tags || []).slice(0, 3).map(function (t) {
      return '<span class="role-tag">' + escapeHtml(t) + '</span>';
    }).join('');
    return '<div class="role-card" data-role-id="' + role.id + '">' +
      '<div class="role-card-avatar"><img src="' + avatar + '" alt="" onerror="this.src=\'/avatars/avatar1.png\'"></div>' +
      '<div class="role-card-info">' +
        '<div class="role-card-name">' + escapeHtml(role.name) + '</div>' +
        '<div class="role-card-desc">' + escapeHtml((role.description || '').slice(0, 60)) + '</div>' +
        '<div class="role-card-tags">' + tags + '</div>' +
      '</div>' +
      (isMine ? '<button class="role-card-action" onclick="event.stopPropagation();MochiApp.selectRoleById(\'' + role.id + '\',\'' + escapeHtml(role.name) + '\')">聊天</button>' : '') +
    '</div>';
  };

  App.selectRole = function (role) {
    App.activeRoleData = role;
    var chatKey = 'chat_' + role.id;
    App.messages = App.chatHistory[chatKey] || [];

    /* 重置思维链/心声状态 */
    App._lastThinking = '';
    App._lastHeartVoice = '';
    App.updateThinkingBtn(false);
    /* 恢复最近一条AI消息的思维链 */
    var lastAiMsg = App.messages.slice().reverse().find(function (m) {
      return m.role === 'assistant' && m.thinking;
    });
    if (lastAiMsg) {
      App._lastThinking = lastAiMsg.thinking;
      App._lastHeartVoice = lastAiMsg.heartVoice || '';
      App.updateThinkingBtn(true);
    }

    var nameEl = document.getElementById('chatHeadName');
    if (nameEl) nameEl.textContent = role.name;
    var avatarEl = document.getElementById('chatHeadAvatar');
    if (avatarEl) avatarEl.src = role.avatar || '/avatars/avatar1.png';

    App.renderMessages();
    App.showPage('chatPage');
  };

  App.selectRoleById = function (roleId, roleName) {
    App.api.get('/api/community/roles?scope=all').then(function (res) {
      var list = (res.data && res.data.list) || [];
      var role = list.find(function (r) { return r.id === roleId; });
      if (role) {
        App.selectRole(role);
      } else {
        App.selectRole({ id: roleId, name: roleName, prompt: '', avatar: '/avatars/avatar1.png' });
      }
    });
  };

  /* ===== 聊天模式切换 ===== */
  App.setChatMode = function (mode) {
    App.chatMode = mode;
    var onlineBtn = document.getElementById('chatModeOnline');
    var offlineBtn = document.getElementById('chatModeOffline');
    var hintEl = document.getElementById('chatModeHint');
    if (onlineBtn) onlineBtn.classList.toggle('active', mode === 'online');
    if (offlineBtn) offlineBtn.classList.toggle('active', mode === 'offline');
    if (hintEl) {
      hintEl.textContent = mode === 'online' ? '微信风格短对话' : '剧情模式，带旁白描写';
    }
    var input = document.getElementById('messageInput');
    if (input) {
      input.placeholder = mode === 'online' ? '说点什么...' : '描述你的行动或对话...';
    }
  };

  /* ===== Miya风格协议解析 ===== */
  var RE_QUOTE = /^引用[-－—]\s*(.+)$/;
  var RE_VOICE = /^语音[-－—]\s*(.+)$/;
  var RE_STICKER = /^表情包[-－—]\s*(.+)$/;
  var RE_IMAGE = /^图片[-－—]\s*(.+)$/;
  var RE_LOCATION = /^位置[-－—]\s*(.+)$/;
  var RE_TRANSFER = /^转账[-－—]\s*(.+)$/;
  var RE_TRANSFER_RECEIPT = /^转账回执[-－—]\s*(.+)$/;
  var RE_TAKEOUT = /^外卖[-－—]\s*(.+)$/;
  var RE_GIFT = /^送礼[-－—]\s*(.+)$/;
  var RE_GROUP_RED_PACKET = /^红包[-－—](拼手气|专属)[-－—](.+)$/;
  var RE_LOVE_POEM = /^情诗[-－—]\s*(.+)$/;
  var RE_RECALL = /^撤回[-－—]\s*(.+)$/;
  var RE_NARRATION = /^旁(?:白)?\s*[-－—：:]\s*(.+)$/;
  var RE_ROLE_CALL_VOICE = /^发起语音通话\s*[。．.!！?？…~～]*$/;
  var RE_ROLE_CALL_VIDEO = /^发起视频通话\s*[。．.!！?？…~～]*$/;
  var RE_TRANSLATION = /^译文[-－—：:]\s*(.+)$/;
  var RE_MOMENTS_POST = /^【发朋友圈[：:]\s*([\s\S]*?)】$/;

  App.parseOnlineMessage = function (text) {
    var raw = String(text || '');
    var segments = [];

    /* 先提取 ```html 代码块（多行），替换为占位标记 */
    var htmlBlocks = [];
    raw = raw.replace(/```html\s*\n([\s\S]*?)```/gi, function (_, code) {
      var idx = htmlBlocks.length;
      htmlBlocks.push(code.trim());
      return '\n§HTMLBLOCK' + idx + '§\n';
    });

    var lines = raw.split(/\r?\n/);

    for (var i = 0; i < lines.length; i++) {
      var line = lines[i].trim();
      if (!line) continue;

      /* HTML交互页占位标记 */
      var htmlMatch = line.match(/^§HTMLBLOCK(\d+)§$/);
      if (htmlMatch) {
        segments.push({ type: 'html', content: htmlBlocks[parseInt(htmlMatch[1], 10)] || '' });
        continue;
      }

      var m;
      if (m = line.match(RE_QUOTE)) {
        var quoteParts = splitQuoteReply(m[1]);
        segments.push({ type: 'quote', quotedText: quoteParts.quoted, replyText: quoteParts.reply });
      } else if (m = line.match(RE_VOICE)) {
        segments.push({ type: 'voice', content: m[1].trim(), duration: parseDuration(m[1]) });
      } else if (m = line.match(RE_STICKER)) {
        segments.push({ type: 'sticker', content: m[1].trim() });
      } else if (m = line.match(RE_IMAGE)) {
        segments.push({ type: 'image', url: m[1].trim(), caption: '' });
      } else if (m = line.match(RE_LOCATION)) {
        var locParts = m[1].split(/[|｜]/);
        segments.push({ type: 'location', name: (locParts[0] || '').trim(), address: (locParts[1] || '').trim() });
      } else if (m = line.match(RE_TRANSFER)) {
        var tfParts = m[1].split(/[|｜]/);
        segments.push({ type: 'transfer', amount: parseFloat(tfParts[0]) || 0, note: (tfParts[1] || '').trim() });
      } else if (m = line.match(RE_TRANSFER_RECEIPT)) {
        var trParts = m[1].split(/[|｜]/);
        segments.push({ type: 'transfer_receipt', amount: parseFloat(trParts[0]) || 0, status: (trParts[1] || '已收').trim() });
      } else if (m = line.match(RE_TAKEOUT)) {
        segments.push({ type: 'takeout', content: m[1].trim() });
      } else if (m = line.match(RE_GIFT)) {
        segments.push({ type: 'gift', content: m[1].trim() });
      } else if (m = line.match(RE_GROUP_RED_PACKET)) {
        segments.push({ type: 'redpacket', mode: m[1], content: m[2].trim() });
      } else if (m = line.match(RE_LOVE_POEM)) {
        segments.push({ type: 'love_poem', content: m[1].trim() });
      } else if (m = line.match(RE_RECALL)) {
        segments.push({ type: 'recall', content: m[1].trim() });
      } else if (m = line.match(RE_NARRATION)) {
        segments.push({ type: 'narration', content: m[1].trim() });
      } else if (line.match(RE_ROLE_CALL_VOICE)) {
        segments.push({ type: 'call_voice' });
      } else if (line.match(RE_ROLE_CALL_VIDEO)) {
        segments.push({ type: 'call_video' });
      } else if (m = line.match(RE_TRANSLATION)) {
        segments.push({ type: 'translation', content: m[1].trim() });
      } else if (m = line.match(RE_MOMENTS_POST)) {
        segments.push({ type: 'moments_post', content: m[1].trim() });
      } else {
        segments.push({ type: 'text', content: line });
      }
    }
    return segments;
  };

  function splitQuoteReply(raw) {
    var separators = ['：', ':', '——', '—', '–', '→', '=>', '->', '｜', '|', '；', ';'];
    var s = String(raw || '').trim();
    for (var i = 0; i < separators.length; i++) {
      var sep = separators[i];
      var idx = s.lastIndexOf(sep);
      if (idx > 0) {
        var quoted = s.slice(0, idx).trim();
        var reply = s.slice(idx + sep.length).trim();
        if (quoted && reply) return { quoted: quoted, reply: reply };
      }
    }
    return { quoted: s, reply: '' };
  }

  function parseDuration(text) {
    var m = String(text).match(/(\d+)\s*秒/);
    if (m) return parseInt(m[1], 10);
    m = String(text).match(/(\d+)/);
    return m ? parseInt(m[1], 10) : 5;
  }

  /* 线下模式解析 */
  App.parseOfflineMessage = function (text) {
    var lines = String(text || '').split(/\r?\n/);
    var segments = [];
    for (var i = 0; i < lines.length; i++) {
      var line = lines[i].trim();
      if (!line) continue;
      var actionMatch = line.match(/^[（(]([\s\S]+?)[）)]$/);
      if (actionMatch) {
        segments.push({ type: 'action', content: actionMatch[1].trim() });
      } else {
        segments.push({ type: 'text', content: line });
      }
    }
    return segments;
  };

  App.parseMessage = function (text, mode) {
    if (mode === 'offline') return App.parseOfflineMessage(text);
    return App.parseOnlineMessage(text);
  };

  /* ===== 思维链/心声提取 ===== */
  /* 从AI回复中提取 <thinking> 和 <miyavoice> 标签内容，并返回干净正文 */
  App.extractMeta = function (text) {
    var raw = String(text || '');
    var thinking = '';
    var heartVoice = '';
    var clean = raw;

    /* 提取完整的 thinking 块 */
    var thinkMatch = clean.match(/<thinking>([\s\S]*?)<\/thinking>/i);
    if (thinkMatch) {
      thinking = thinkMatch[1].trim();
      clean = clean.replace(/<thinking>[\s\S]*?<\/thinking>/gi, '');
    }
    /* 处理流式输出中未闭合的 thinking */
    var openThink = clean.match(/<thinking>([\s\S]*)$/i);
    if (openThink) {
      if (!thinking) thinking = openThink[1].trim();
      clean = clean.replace(/<thinking>[\s\S]*$/i, '');
    }

    /* 提取完整的 miyavoice 块 */
    var hvMatch = clean.match(/<miyavoice>([\s\S]*?)<\/miyavoice>/i);
    if (hvMatch) {
      heartVoice = hvMatch[1].trim();
      clean = clean.replace(/<miyavoice>[\s\S]*?<\/miyavoice>/gi, '');
    }
    /* 处理流式输出中未闭合的 miyavoice */
    var openHv = clean.match(/<miyavoice>([\s\S]*)$/i);
    if (openHv) {
      if (!heartVoice) heartVoice = openHv[1].trim();
      clean = clean.replace(/<miyavoice>[\s\S]*$/i, '');
    }

    /* 清除残留碎片 */
    clean = clean.replace(/<\/?thinking>/gi, '').replace(/<\/?miyavoice>/gi, '').replace(/<\/?miyanextpush>/gi, '');
    /* 剥离完整的 miyanextpush 块 */
    clean = clean.replace(/<miyanextpush>[\s\S]*?<\/miyanextpush>/gi, '');

    /* 回退：AI可能把 thinking 写成普通文字而非标签 */
    if (!thinking) {
      var fallbackThink = clean.match(/^thinking\s*\n([\s\S]*?)(?:\n\s*\n|$)/i);
      if (fallbackThink) {
        var thinkContent = fallbackThink[1].trim();
        /* 只有当内容看起来像思考（不是短消息）时才提取 */
        if (thinkContent.length > 15 && thinkContent.split(/\n/).length >= 1) {
          thinking = thinkContent;
          clean = clean.replace(/^thinking\s*\n[\s\S]*?(?:\n\s*\n)/i, '').trim();
        }
      }
    }

    /* 检测并移除泄漏到正文的思维内容（AI有时在</thinking>后继续写分析） */
    var leakPatterns = [
      /^[（(]?分析[,，：:]/,
      /^[（(]?情境分析[,，：:]/,
      /^[（(]?回复构思[,，：:]/,
      /^[（(]?人设代入[,，：:]/,
      /^[（(]?长期记忆调用[,，：:]/,
      /^[（(]?文本组织[,，：:]/,
      /^[（(]?表情选择[,，：:]/,
      /^因此[，,]我的回复应该/,
      /^我的回复[应该要包含]/,
      /^回复[应该要包含]/,
      /^\d+[、.．]\s*(回应|表达|简单|强调|表现|说|可以|加上)/
    ];
    var cleanLines = clean.split(/\r?\n/);
    var leakedThinking = '';
    var realContentLines = [];
    var inLeakBlock = false;
    for (var li = 0; li < cleanLines.length; li++) {
      var line = cleanLines[li].trim();
      var isLeak = false;
      for (var pi = 0; pi < leakPatterns.length; pi++) {
        if (leakPatterns[pi].test(line)) {
          isLeak = true;
          break;
        }
      }
      /* 编号列表延续行也算泄漏 */
      if (inLeakBlock && /^\d+[、.．]\s*/.test(line)) {
        isLeak = true;
      }
      if (isLeak) {
        inLeakBlock = true;
        if (leakedThinking) leakedThinking += '\n';
        leakedThinking += line;
      } else {
        inLeakBlock = false;
        realContentLines.push(cleanLines[li]);
      }
    }
    if (leakedThinking && leakedThinking.length > 20) {
      if (thinking) {
        thinking = thinking + '\n' + leakedThinking;
      } else {
        thinking = leakedThinking;
      }
      clean = realContentLines.join('\n').trim();
    }

    clean = clean.trim();

    return { thinking: thinking, heartVoice: heartVoice, clean: clean };
  };

  /* 格式化心声内容为可读HTML */
  App.formatHeartVoice = function (hv) {
    if (!hv) return '';
    var lines = String(hv).split(/\r?\n/);
    var html = '';
    var gaugesHtml = '';
    var textFields = [];
    var fields = [
      { key: '好感度', icon: '💖', cls: 'hv-affection', color: '#FF6B9D', isGauge: true },
      { key: '欲望值', icon: '🔥', cls: 'hv-desire', color: '#FF6B35', isGauge: true },
      { key: '行为动作', icon: '🎬', cls: 'hv-action', isGauge: false },
      { key: '角色心声', icon: '💭', cls: 'hv-monologue', isGauge: false }
    ];
    for (var i = 0; i < lines.length; i++) {
      var line = lines[i].trim();
      if (!line) continue;
      var matched = false;
      for (var j = 0; j < fields.length; j++) {
        var f = fields[j];
        var m = line.match(new RegExp('^' + f.key + '\\s*[-－—：:]\\s*(.+)'));
        if (m) {
          var val = m[1].trim();
          if (f.isGauge) {
            /* SVG 仪表盘 */
            gaugesHtml += App.renderHvGauge(f.key, val, 100, f.color, f.icon);
          } else {
            textFields.push('<div class="hv-field ' + f.cls + '">' +
              '<span class="hv-label">' + f.icon + ' ' + f.key + '</span>' +
              '<span class="hv-value">' + escapeHtml(val) + '</span></div>');
          }
          matched = true;
          break;
        }
      }
      if (!matched) {
        textFields.push('<div class="hv-field hv-extra">' + escapeHtml(line) + '</div>');
      }
    }
    /* 仪表盘行 */
    if (gaugesHtml) {
      html += '<div class="hv-gauges-row">' + gaugesHtml + '</div>';
    }
    /* 文本字段 */
    html += textFields.join('');
    return html || '<div class="hv-extra">' + escapeHtml(hv) + '</div>';
  };

  /* ===== 消息渲染 ===== */
  App.renderMessages = function () {
    var container = document.getElementById('messageList');
    if (!container) return;
    container.innerHTML = '';

    if (!App.messages.length) {
      container.innerHTML = '<div class="chat-empty"><div class="chat-empty-icon">💬</div><p>开始和TA聊天吧</p></div>';
      return;
    }

    var staggerIdx = 0;
    App.messages.forEach(function (msg, idx) {
      var showTime = (idx === 0 || (Date.now() - (App.messages[idx - 1].ts || 0)) > 5 * 60 * 1000);
      App.appendMessageElement(container, msg, showTime, staggerIdx);
      staggerIdx++;
    });

    App.scrollToBottom();
  };

  App.appendMessageElement = function (container, msg, showTime, staggerIdx) {
    var role = msg.role;
    if (showTime && msg.ts) {
      var timeEl = document.createElement('div');
      timeEl.className = 'chat-time';
      timeEl.textContent = formatTime(msg.ts);
      container.appendChild(timeEl);
    }

    var segments = App.parseMessage(msg.content || '', App.chatMode);
    segments.forEach(function (seg, idx) {
      /* 心声指示器只显示在第一条气泡上 */
      var bubbleMsg = idx === 0 ? msg : { role: msg.role, content: msg.content };
      var bubble = App.createBubble(role, seg, bubbleMsg);
      /* 错峰动画 */
      if (staggerIdx !== undefined && staggerIdx < 20) {
        bubble.style.animationDelay = (staggerIdx * 0.08) + 's';
        bubble.classList.add('msg-stagger');
      }
      /* 主动消息标记 */
      if (msg.proactive) {
        bubble.classList.add('proactive');
      }
      /* 长按菜单 */
      bubble.addEventListener('touchstart', function (e) {
        App._longPressTimer = setTimeout(function () {
          App.showContextMenu(e, msg, seg);
        }, 500);
      });
      bubble.addEventListener('touchend', function () {
        clearTimeout(App._longPressTimer);
      });
      bubble.addEventListener('touchmove', function () {
        clearTimeout(App._longPressTimer);
      });
      bubble.addEventListener('contextmenu', function (e) {
        e.preventDefault();
        App.showContextMenu(e, msg, seg);
      });
      container.appendChild(bubble);
    });
  };

  App.createBubble = function (role, seg, msg) {
    var wrapper = document.createElement('div');
    wrapper.className = 'msg-row msg-' + (role === 'user' ? 'right' : 'left');

    if (role !== 'user') {
      var avatar = document.createElement('div');
      avatar.className = 'msg-avatar';
      /* 有心声时添加指示器 */
      if (msg && msg.heartVoice) {
        avatar.classList.add('msg-avatar--hv');
        avatar.title = '点击查看心声';
        avatar.style.cursor = 'pointer';
        avatar.addEventListener('click', function () {
          App.showHeartVoicePopup(msg.heartVoice);
        });
      }
      var avatarImg = document.createElement('img');
      avatarImg.src = (App.activeRoleData && App.activeRoleData.avatar) || '/avatars/avatar1.png';
      avatarImg.onerror = function () { this.src = '/avatars/avatar1.png'; };
      avatar.appendChild(avatarImg);
      /* 心声小红心 */
      if (msg && msg.heartVoice) {
        var hvBadge = document.createElement('span');
        hvBadge.className = 'hv-badge';
        hvBadge.innerHTML = '💗';
        avatar.appendChild(hvBadge);
      }
      wrapper.appendChild(avatar);
    }

    var content = document.createElement('div');
    content.className = 'msg-content';

    var html = App.renderSegment(seg, role);
    content.innerHTML = html;

    wrapper.appendChild(content);
    return wrapper;
  };

  App.renderSegment = function (seg, role) {
    var bubbleClass = role === 'user' ? 'bubble bubble-user' : 'bubble bubble-ai';
    switch (seg.type) {
      case 'text':
        return '<div class="' + bubbleClass + '">' + escapeHtml(seg.content) + '</div>';
      case 'action':
        return '<div class="bubble-narration">' + escapeHtml(seg.content) + '</div>';
      case 'narration':
        return '<div class="bubble-narration">' + escapeHtml(seg.content) + '</div>';
      case 'quote':
        return '<div class="' + bubbleClass + ' bubble-quote">' +
          '<div class="quote-ref">' + escapeHtml(seg.quotedText) + '</div>' +
          '<div class="quote-reply">' + escapeHtml(seg.replyText || '') + '</div>' +
        '</div>';
      case 'voice':
        return '<div class="' + bubbleClass + ' bubble-voice">' +
          '<span class="voice-icon">🎤</span>' +
          '<div class="voice-bar"><div class="voice-bar-fill"></div></div>' +
          '<span class="voice-duration">' + seg.duration + '"</span>' +
          '<div class="voice-text">' + escapeHtml(seg.content) + '</div>' +
        '</div>';
      case 'sticker':
        return '<div class="bubble-sticker"><div class="sticker-emoji">' + getStickerEmoji(seg.content) + '</div><div class="sticker-label">' + escapeHtml(seg.content) + '</div></div>';
      case 'image':
        return '<div class="bubble-image"><img src="' + escapeAttr(seg.url) + '" alt="" onerror="this.style.display=\'none\'"><div class="image-caption">' + escapeHtml(seg.caption || '') + '</div></div>';
      case 'location':
        return '<div class="' + bubbleClass + ' bubble-location">' +
          '<span class="loc-icon">📍</span>' +
          '<div class="loc-info"><div class="loc-name">' + escapeHtml(seg.name) + '</div><div class="loc-addr">' + escapeHtml(seg.address) + '</div></div>' +
        '</div>';
      case 'transfer':
        return '<div class="bubble-card bubble-transfer">' +
          '<div class="card-header"><span>💸 转账</span></div>' +
          '<div class="card-amount">¥' + seg.amount.toFixed(2) + '</div>' +
          '<div class="card-note">' + escapeHtml(seg.note) + '</div>' +
        '</div>';
      case 'transfer_receipt':
        return '<div class="bubble-card bubble-transfer-receipt">' +
          '<div class="card-header"><span>✅ 转账已收</span></div>' +
          '<div class="card-amount">¥' + seg.amount.toFixed(2) + '</div>' +
          '<div class="card-status">' + escapeHtml(seg.status) + '</div>' +
        '</div>';
      case 'redpacket':
        return '<div class="bubble-card bubble-redpacket">' +
          '<div class="rp-header">🧧 ' + escapeHtml(seg.mode === '拼手气' ? '拼手气红包' : '专属红包') + '</div>' +
          '<div class="rp-greeting">' + escapeHtml(seg.content) + '</div>' +
          '<div class="rp-footer">微信红包</div>' +
        '</div>';
      case 'gift':
        return '<div class="' + bubbleClass + ' bubble-gift">' +
          '<div class="gift-icon">🎁</div>' +
          '<div class="gift-text">' + escapeHtml(seg.content) + '</div>' +
        '</div>';
      case 'takeout':
        return '<div class="bubble-card bubble-takeout">' +
          '<div class="card-header"><span>🍔 外卖</span></div>' +
          '<div class="card-body">' + escapeHtml(seg.content) + '</div>' +
        '</div>';
      case 'love_poem':
        return '<div class="' + bubbleClass + ' bubble-poem">' +
          '<div class="poem-icon">💌</div>' +
          '<div class="poem-text">' + escapeHtml(seg.content).replace(/\n/g, '<br>') + '</div>' +
        '</div>';
      case 'call_voice':
        return '<div class="bubble-call"><span class="call-icon">📞</span><span>语音通话</span><span class="call-duration">' + escapeHtml(seg.duration || '') + '</span></div>';
      case 'call_video':
        return '<div class="bubble-call"><span class="call-icon">📹</span><span>视频通话</span><span class="call-duration">' + escapeHtml(seg.duration || '') + '</span></div>';
      case 'translation':
        return '<div class="' + bubbleClass + ' bubble-translation">' +
          '<span class="trans-icon">🌐</span>' +
          '<div class="trans-text">' + escapeHtml(seg.content) + '</div>' +
        '</div>';
      case 'recall':
        return '<div class="bubble-recall">' + escapeHtml(seg.content || '消息已撤回') + '</div>';
      case 'moments_post':
        return '<div class="bubble-card bubble-moments">' +
          '<div class="card-header"><span>📢 朋友圈动态</span></div>' +
          '<div class="card-body">' + escapeHtml(seg.content).replace(/\n/g, '<br>') + '</div>' +
        '</div>';
      case 'html':
        return '<div class="bubble-html-sandbox" data-html="' + encodeURIComponent(seg.content || '') + '">' +
          '<div class="html-sandbox-header"><span>🎮 交互卡片</span><button class="html-sandbox-fullscreen" onclick="App.openHtmlFullscreen(this)">⤢</button></div>' +
          '<iframe class="html-sandbox-iframe" sandbox="allow-scripts" srcdoc="' + String(seg.content || '').replace(/&/g,'&amp;').replace(/"/g,'&quot;').replace(/'/g,'&#39;') + '"></iframe>' +
        '</div>';
      default:
        return '<div class="' + bubbleClass + '">' + escapeHtml(seg.content || '') + '</div>';
    }
  };

  App.appendStreamingMessage = function (role, content) {
    var container = document.getElementById('messageList');
    if (!container) return;

    var segments = App.parseMessage(content, App.chatMode);
    if (!segments.length) return;

    var lastSeg = segments[segments.length - 1];

    if (!App._streamingRow || App._streamingRole !== role) {
      App._streamingRow = document.createElement('div');
      App._streamingRow.className = 'msg-row msg-' + (role === 'user' ? 'right' : 'left');
      if (role !== 'user') {
        var avatar = document.createElement('div');
        avatar.className = 'msg-avatar';
        var avatarImg = document.createElement('img');
        avatarImg.src = (App.activeRoleData && App.activeRoleData.avatar) || '/avatars/avatar1.png';
        avatarImg.onerror = function () { this.src = '/avatars/avatar1.png'; };
        avatar.appendChild(avatarImg);
        App._streamingRow.appendChild(avatar);
      }
      App._streamingContent = document.createElement('div');
      App._streamingContent.className = 'msg-content';
      App._streamingRow.appendChild(App._streamingContent);
      container.appendChild(App._streamingRow);
      App._streamingRole = role;
      App._streamingSegments = [];
    }

    App._streamingContent.innerHTML = segments.map(function (seg) {
      return App.renderSegment(seg, role);
    }).join('');

    App.scrollToBottom();
  };

  App.finishStreaming = function () {
    App._streamingRow = null;
    App._streamingContent = null;
    App._streamingRole = null;
    App._streamingSegments = null;
  };

  App.showTypingIndicator = function () {
    var container = document.getElementById('messageList');
    if (!container) return;
    var existing = document.getElementById('typingIndicator');
    if (existing) return;

    var row = document.createElement('div');
    row.id = 'typingIndicator';
    row.className = 'msg-row msg-left';
    var avatar = document.createElement('div');
    avatar.className = 'msg-avatar';
    var avatarImg = document.createElement('img');
    avatarImg.src = (App.activeRoleData && App.activeRoleData.avatar) || '/avatars/avatar1.png';
    avatar.appendChild(avatarImg);
    row.appendChild(avatar);

    var content = document.createElement('div');
    content.className = 'msg-content';
    content.innerHTML = '<div class="bubble bubble-ai typing-bubble"><span class="typing-dot"></span><span class="typing-dot"></span><span class="typing-dot"></span></div>';
    row.appendChild(content);

    container.appendChild(row);
    App.scrollToBottom();
  };

  App.hideTypingIndicator = function () {
    var el = document.getElementById('typingIndicator');
    if (el) el.remove();
  };

  App.scrollToBottom = function () {
    var container = document.getElementById('chatContainer');
    if (container) {
      requestAnimationFrame(function () {
        container.scrollTop = container.scrollHeight;
      });
    }
  };

  /* ===== 发送消息 ===== */
  App.sendMessage = function () {
    var input = document.getElementById('messageInput');
    if (!input) return;
    var text = input.value.trim();
    if (!text) return;
    if (App.sending) return;
    if (!App.activeRoleData) {
      App.toast('请先选择一个角色');
      App.showPage('rolesPage');
      return;
    }

    input.value = '';
    input.style.height = 'auto';

    /* 如果有引用回复，在消息前加上引用标记 */
    var sendText = text;
    if (App._quoteReply && App._quoteReply.text) {
      sendText = '引用-' + App._quoteReply.text + ' / ' + text;
      App.cancelQuoteReply();
    }

    var userMsg = {
      id: App.uuid(),
      role: 'user',
      content: sendText,
      ts: Date.now()
    };
    App.messages.push(userMsg);

    if (!App.chatHistory['chat_' + App.activeRoleData.id]) {
      App.chatHistory['chat_' + App.activeRoleData.id] = [];
    }
    App.chatHistory['chat_' + App.activeRoleData.id].push(userMsg);

    App.renderMessages();
    App.sending = true;
    App.showTypingIndicator();

    var sendBtn = document.getElementById('sendButton');
    if (sendBtn) sendBtn.disabled = true;

    var replyText = '';
    var sourceMessageIds = App.messages.slice(-5).map(function (m) { return m.id; });

    fetch('/api/chat', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        roleId: App.activeRoleData.id,
        roleName: App.activeRoleData.name,
        rolePrompt: App.activeRoleData.prompt || '',
        roleAvatar: App.activeRoleData.avatar || '',
        messages: App.messages.slice(-20).map(function (m) {
          return { role: m.role, content: m.content };
        }),
        sourceMessageIds: sourceMessageIds,
        worldBookIds: App.activeRoleData.worldBookIds || [],
        chatMode: App.chatMode,
        prevHeartVoice: App._lastHeartVoiceParsed || null
      })
    }).then(function (response) {
      var reader = response.body.getReader();
      var decoder = new TextDecoder();
      var buffer = '';

      App.hideTypingIndicator();

      function processBuffer() {
        var parts = buffer.split('\n\n');
        buffer = parts.pop() || '';
        for (var i = 0; i < parts.length; i++) {
          var part = parts[i];
          var dataLines = part.split('\n').filter(function (l) { return l.startsWith('data:'); });
          for (var j = 0; j < dataLines.length; j++) {
            var data = dataLines[j].replace(/^data:\s*/, '').trim();
            if (!data || data === '[DONE]') continue;
            try {
              var evt = JSON.parse(data);
              App.handleSSEEvent(evt, { replyText: function () { return replyText; }, setReply: function (t) { replyText = t; } });
            } catch (e) {}
          }
        }
      }

      function readChunk() {
        reader.read().then(function (result) {
          if (result.done) {
            if (buffer.trim()) processBuffer();
            App.finalizeSend(replyText);
            return;
          }
          buffer += decoder.decode(result.value, { stream: true });
          processBuffer();
          readChunk();
        }).catch(function (err) {
          App.finalizeSend(replyText, err);
        });
      }

      readChunk();
    }).catch(function (err) {
      App.hideTypingIndicator();
      App.sending = false;
      if (sendBtn) sendBtn.disabled = false;
      App.toast('发送失败: ' + err.message);
    });
  };

  App.handleSSEEvent = function (evt, ctx) {
    if (evt.type === 'charged') {
      App.updateBeans(evt.data && evt.data.beans);
    } else if (evt.type === 'ping') {
      /* 心跳：显示正在思考提示 */
      if (!App._streamingRow) {
        App.showTypingIndicator();
      }
    } else if (evt.type === 'heartvoice') {
      /* 服务器解析的心声数据 */
      if (evt.data) {
        App._lastHeartVoiceParsed = evt.data;
      }
    } else if (evt.type === 'nextpush') {
      /* 主动消息已调度 */
      if (evt.data && evt.data.atMs) {
        var delayMin = Math.round((evt.data.atMs - Date.now()) / 60000);
        if (delayMin > 0 && delayMin < 1440) {
          App._nextPushAt = evt.data.atMs;
        }
      }
    } else if (evt.type === 'delta') {
      /* 收到delta时隐藏typing indicator */
      App.hideTypingIndicator();
      var content = (evt.data && evt.data.content) || '';
      ctx.setReply(ctx.replyText() + content);
      /* 提取思维链和心声，只渲染干净正文 */
      var meta = App.extractMeta(ctx.replyText());
      App._streamingThinking = meta.thinking;
      App._streamingHeartVoice = meta.heartVoice;
      App.appendStreamingMessage('assistant', meta.clean);
    } else if (evt.type === 'done') {
      if (evt.data && evt.data.beans !== undefined) {
        App.updateBeans(evt.data.beans);
      }
    } else if (evt.type === 'error') {
      App.hideTypingIndicator();
      App.toast((evt.data && evt.data.message) || 'AI回复失败');
      if (evt.data && evt.data.beans !== undefined) {
        App.updateBeans(evt.data.beans);
      }
    } else if (evt.type === 'memory') {
      /* 自动记忆已保存 */
      if (evt.data && evt.data.content) {
        App.toast('🧠 记住了：' + evt.data.content.slice(0, 30));
      }
    }
  };

  App.finalizeSend = function (replyText, err) {
    App.finishStreaming();
    App.sending = false;
    var sendBtn = document.getElementById('sendButton');
    if (sendBtn) sendBtn.disabled = false;

    if (err) {
      App.toast('网络错误: ' + err.message);
      return;
    }

    if (replyText && replyText.trim()) {
      var meta = App.extractMeta(replyText);
      if (!meta.clean.trim()) return;
      var aiMsg = {
        id: App.uuid(),
        role: 'assistant',
        content: meta.clean,
        thinking: meta.thinking || App._streamingThinking || '',
        heartVoice: meta.heartVoice || App._streamingHeartVoice || '',
        ts: Date.now()
      };
      App.messages.push(aiMsg);
      if (App.activeRoleData && App.chatHistory['chat_' + App.activeRoleData.id]) {
        App.chatHistory['chat_' + App.activeRoleData.id].push(aiMsg);
      }
      /* 更新思维链/心声缓存 */
      if (aiMsg.thinking) {
        App._lastThinking = aiMsg.thinking;
        App.updateThinkingBtn(true);
      }
      /* 若客户端未提取到心声但服务端发送了heartvoice事件，使用服务端数据构造心声 */
      if (!aiMsg.heartVoice && App._lastHeartVoiceParsed && App._lastHeartVoiceParsed.affection != null) {
        var sp = App._lastHeartVoiceParsed;
        aiMsg.heartVoice = '好感度-' + sp.affection + '\n欲望值-' + (sp.desire != null ? sp.desire : 0) +
          '\n行为动作-' + (sp.action || '') + '\n角色心声-' + (sp.monologue || '');
      }
      if (aiMsg.heartVoice) {
        App._lastHeartVoice = aiMsg.heartVoice;
        /* 解析心声为结构化数据，供下轮请求使用 */
        var hvLines = aiMsg.heartVoice.split(/\r?\n/);
        var parsed = {};
        for (var hi = 0; hi < hvLines.length; hi++) {
          var hl = hvLines[hi].trim();
          var hm;
          if (hm = hl.match(/好感度\s*[-－—：:]\s*(\d+)/)) parsed.affection = parseInt(hm[1], 10);
          else if (hm = hl.match(/欲望值\s*[-－—：:]\s*(\d+)/)) parsed.desire = parseInt(hm[1], 10);
          else if (hm = hl.match(/行为动作\s*[-－—：:]\s*(.+)/)) parsed.action = hm[1].trim();
          else if (hm = hl.match(/角色心声\s*[-－—：:]\s*(.+)/)) parsed.monologue = hm[1].trim();
        }
        App._lastHeartVoiceParsed = parsed;
      }
      App._streamingThinking = null;
      App._streamingHeartVoice = null;
      App.renderMessages();
    }
  };

  App.updateBeans = function (beans) {
    var badge = document.getElementById('beansBadge');
    if (badge) badge.textContent = '豆子 ' + (beans !== undefined ? beans : '?');
    var balance = document.getElementById('beansBalance');
    if (balance) balance.textContent = beans !== undefined ? beans : '?';
  };

  /* ===== 社区 ===== */
  App.loadCommunity = function () {
    var scope = App.communityTab === 'official' ? 'public' : (App.communityTab === 'mine' ? 'mine' : 'public');
    var url = '/api/community/roles?scope=' + scope;
    var searchInput = document.getElementById('communitySearch');
    if (searchInput && searchInput.value.trim()) {
      url += '&keyword=' + encodeURIComponent(searchInput.value.trim());
    }
    App.api.get(url).then(function (res) {
      var list = (res.data && res.data.list) || [];
      if (App.communityTab === 'official') {
        list = list.filter(function (r) { return r.ownerId === 'system'; });
      } else if (App.communityTab === 'user') {
        list = list.filter(function (r) { return r.ownerId !== 'system'; });
      }
      var container = document.getElementById('communityList');
      if (!container) return;
      if (!list.length) {
        container.innerHTML = '<div style="text-align:center;padding:40px;color:#999">暂无角色</div>';
        return;
      }
      container.innerHTML = list.map(function (role) {
        return '<div class="community-card" data-role-id="' + role.id + '">' +
          '<div class="community-card-avatar"><img src="' + (role.avatar || '/avatars/avatar1.png') + '" alt="" onerror="this.src=\'/avatars/avatar1.png\'"></div>' +
          '<div class="community-card-info">' +
            '<div class="community-card-name">' + escapeHtml(role.name) + '</div>' +
            '<div class="community-card-desc">' + escapeHtml((role.description || role.prompt || '').slice(0, 80)) + '</div>' +
          '</div>' +
          '<button class="community-card-btn" data-role-id="' + role.id + '">选择</button>' +
        '</div>';
      }).join('');
      container.querySelectorAll('.community-card-btn').forEach(function (btn) {
        btn.addEventListener('click', function (e) {
          e.stopPropagation();
          var roleId = this.getAttribute('data-role-id');
          var role = list.find(function (r) { return r.id === roleId; });
          if (role) App.selectRole(role);
        });
      });
    });
  };

  /* ===== 记忆 ===== */
  App.loadMemories = function () {
    App.api.get('/api/memories').then(function (res) {
      var list = (res.data && res.data.list) || [];
      var container = document.getElementById('memoryList');
      if (!container) return;
      if (!list.length) {
        container.innerHTML = '<div style="text-align:center;padding:20px;color:#999">还没有记忆</div>';
        return;
      }
      container.innerHTML = list.map(function (mem) {
        return '<div class="memory-item">' +
          '<div class="memory-item-type">' + escapeHtml(mem.type || '记忆') + '</div>' +
          '<div class="memory-item-content">' + escapeHtml(mem.content) + '</div>' +
          '<div class="memory-item-meta">' + (mem.roleName || '全局') + ' · ' + (mem.auto ? '自动' : '手动') + '</div>' +
          '<button class="memory-item-del" data-mem-id="' + mem.id + '">删除</button>' +
        '</div>';
      }).join('');
      container.querySelectorAll('.memory-item-del').forEach(function (btn) {
        btn.addEventListener('click', function () {
          var memId = this.getAttribute('data-mem-id');
          App.api.del('/api/memories/' + memId).then(function () { App.loadMemories(); });
        });
      });
    });
  };

  App.saveMemory = function () {
    var roleSelect = document.getElementById('memoryRoleSelect');
    var typeSelect = document.getElementById('memoryTypeSelect');
    var contentInput = document.getElementById('memoryContentInput');
    if (!contentInput || !contentInput.value.trim()) {
      App.toast('请输入记忆内容');
      return;
    }
    App.api.post('/api/memories', {
      roleId: roleSelect ? roleSelect.value : '',
      type: typeSelect ? typeSelect.value : '事件',
      content: contentInput.value.trim(),
      auto: false
    }).then(function (res) {
      if (res.code === 0) {
        App.toast('记忆已保存');
        contentInput.value = '';
        App.loadMemories();
      } else {
        App.toast(res.message || '保存失败');
      }
    });
  };

  /* ===== 个人资料 ===== */
  App.loadProfile = function () {
    App.api.get('/api/profile').then(function (res) {
      var data = res.data || {};
      var nameEl = document.getElementById('profileHeaderName');
      if (nameEl) nameEl.textContent = data.nickname || '体验用户';
      var bioEl = document.getElementById('profileHeaderBio');
      if (bioEl) bioEl.textContent = data.bio || '';
      var avatarEl = document.getElementById('profileHeaderAvatar');
      if (avatarEl) avatarEl.src = data.avatar || '/avatars/avatar1.png';
      var nickInput = document.getElementById('userNicknameInput');
      if (nickInput) nickInput.value = data.nickname || '';
      var bioInput = document.getElementById('userBioInput');
      if (bioInput) bioInput.value = data.bio || '';
      var relInput = document.getElementById('userRelationsInput');
      if (relInput) relInput.value = data.relations || '';
      var avatarPreview = document.getElementById('userAvatarPreview');
      if (avatarPreview) avatarPreview.src = data.avatar || '/avatars/avatar1.png';
    });
    App.api.get('/api/user/me').then(function (res) {
      if (res.data && res.data.beans !== undefined) {
        App.updateBeans(res.data.beans);
      }
    });
    App.loadTransactions();
  };

  App.saveProfile = function () {
    var nickInput = document.getElementById('userNicknameInput');
    var bioInput = document.getElementById('userBioInput');
    var relInput = document.getElementById('userRelationsInput');
    var avatarPreview = document.getElementById('userAvatarPreview');

    App.api.post('/api/profile', {
      nickname: nickInput ? nickInput.value : '',
      bio: bioInput ? bioInput.value : '',
      relations: relInput ? relInput.value : '',
      avatar: avatarPreview ? avatarPreview.src : ''
    }).then(function (res) {
      if (res.code === 0) {
        App.toast('资料已保存');
        App.loadProfile();
      } else {
        App.toast(res.message || '保存失败');
      }
    });
  };

  App.loadTransactions = function () {
    App.api.get('/api/user/stats').then(function (res) {
      /* stats endpoint returns general stats */
    });
  };

  /* ===== 世界书 ===== */
  App.openWorldBook = function () {
    App.api.get('/api/worldbooks').then(function (res) {
      var list = (res.data && res.data.list) || [];
      var panel = document.getElementById('phoneAppPanel');
      if (!panel) return;
      panel.classList.remove('hidden');
      panel.innerHTML = '<div style="padding:16px">' +
        '<div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:12px">' +
          '<h3 style="margin:0">世界书管理</h3>' +
          '<button onclick="MochiApp.showWorldBookDialog()" style="padding:6px 16px;border:none;border-radius:8px;background:#FF6B9D;color:#fff;cursor:pointer">+ 新建</button>' +
        '</div>' +
        '<div id="worldBookList">' + (list.length ? list.map(function (wb) {
          return '<div class="worldbook-item" data-wb-id="' + wb.id + '">' +
            '<div class="wb-name">' + escapeHtml(wb.name) + '</div>' +
            '<div class="wb-desc">' + escapeHtml((wb.description || '').slice(0, 80)) + '</div>' +
            '<div class="wb-entry-count">' + (wb.entries ? wb.entries.length : 0) + ' 条词条</div>' +
          '</div>';
        }).join('') : '<div style="text-align:center;padding:20px;color:#999">还没有世界书</div>') + '</div>' +
      '</div>';
    });
  };

  App.showWorldBookDialog = function () {
    var dialog = document.getElementById('worldBookDialog');
    if (dialog) dialog.style.display = 'flex';
  };

  App.closeWorldBookDialog = function () {
    var dialog = document.getElementById('worldBookDialog');
    if (dialog) dialog.style.display = 'none';
  };

  App.saveWorldBook = function () {
    var nameInput = document.getElementById('wbNameInput');
    var descInput = document.getElementById('wbDescInput');
    var entriesInput = document.getElementById('wbEntriesInput');
    if (!nameInput || !nameInput.value.trim()) {
      App.toast('请输入世界书名称');
      return;
    }
    var entries = [];
    if (entriesInput && entriesInput.value.trim()) {
      try {
        entries = JSON.parse(entriesInput.value);
      } catch (e) {
        App.toast('条目JSON格式错误');
        return;
      }
    }
    App.api.post('/api/worldbooks', {
      name: nameInput.value.trim(),
      description: descInput ? descInput.value : '',
      entries: entries
    }).then(function (res) {
      if (res.code === 0) {
        App.toast('世界书已保存');
        App.closeWorldBookDialog();
        App.openWorldBook();
      } else {
        App.toast(res.message || '保存失败');
      }
    });
  };

  /* ===== 思维链/心声弹窗 ===== */
  App.updateThinkingBtn = function (visible) {
    var btn = document.getElementById('chatThinkingBtn');
    if (btn) btn.style.display = visible ? 'flex' : 'none';
  };

  /* ===== 长按上下文菜单 ===== */
  /* HTML交互页全屏查看 */
  App.openHtmlFullscreen = function (btn) {
    var container = btn.closest('.bubble-html-sandbox');
    if (!container) return;
    var html = decodeURIComponent(container.getAttribute('data-html') || '');
    var overlay = document.createElement('div');
    overlay.className = 'mc-html-fullscreen-overlay';
    overlay.style.cssText = 'position:fixed;top:0;left:0;right:0;bottom:0;background:rgba(0,0,0,0.85);z-index:9999;display:flex;flex-direction:column;';
    overlay.innerHTML =
      '<div style="display:flex;justify-content:space-between;align-items:center;padding:12px 16px;color:#fff;background:#1a1a2e;">' +
      '<span style="font-size:14px;">🎮 交互卡片</span>' +
      '<button style="background:none;border:none;color:#fff;font-size:24px;cursor:pointer;" onclick="this.closest(\'.mc-html-fullscreen-overlay\').remove()">✕</button>' +
      '</div>' +
      '<iframe style="flex:1;border:none;width:100%;background:#fff;" sandbox="allow-scripts" srcdoc="' + escapeAttr(html) + '"></iframe>';
    document.body.appendChild(overlay);
  };

  App.showContextMenu = function (e, msg, seg) {
    /* 移除已有菜单 */
    var existing = document.getElementById('mcCtxMenu');
    if (existing) existing.remove();

    var touch = e.touches ? e.touches[0] : e;
    var x = touch.clientX || (e.pageX || 0);
    var y = touch.clientY || (e.pageY || 0);

    var menu = document.createElement('div');
    menu.id = 'mcCtxMenu';
    menu.className = 'mc-ctx-menu show';
    menu.style.left = Math.min(x, window.innerWidth - 160) + 'px';
    menu.style.top = Math.max(y - 100, 10) + 'px';

    var text = '';
    if (seg.type === 'text') text = seg.content;
    else if (seg.type === 'quote') text = seg.replyText || seg.quotedText;
    else text = seg.content || '';

    menu.innerHTML = '<button class="ctx-item" data-action="copy">📋 复制</button>' +
      '<button class="ctx-item" data-action="quote">↩ 引用</button>' +
      '<button class="ctx-item" data-action="delete">🗑 删除</button>';

    document.body.appendChild(menu);

    /* 点击外部关闭 */
    setTimeout(function () {
      document.addEventListener('click', closeMenu, { once: true });
    }, 100);

    function closeMenu() {
      menu.remove();
    }

    menu.querySelectorAll('.ctx-item').forEach(function (btn) {
      btn.addEventListener('click', function () {
        var action = this.getAttribute('data-action');
        closeMenu();
        if (action === 'copy') {
          if (text) {
            navigator.clipboard ? navigator.clipboard.writeText(text) : App.toast('已复制');
            App.toast('已复制');
          }
        } else if (action === 'quote') {
          App.startQuoteReply(text, msg);
        } else if (action === 'delete') {
          var idx = App.messages.indexOf(msg);
          if (idx >= 0) {
            App.messages.splice(idx, 1);
            if (App.activeRoleData && App.chatHistory['chat_' + App.activeRoleData.id]) {
              var hist = App.chatHistory['chat_' + App.activeRoleData.id];
              var hIdx = hist.indexOf(msg);
              if (hIdx >= 0) hist.splice(hIdx, 1);
            }
            App.renderMessages();
            App.toast('已删除');
          }
        }
      });
    });
  };

  /* ===== 引用回复 ===== */
  App.startQuoteReply = function (quotedText, msg) {
    App._quoteReply = {
      text: quotedText.slice(0, 100),
      msgId: msg.id
    };
    /* 显示引用预览条 */
    var bar = document.getElementById('quoteReplyBar');
    if (!bar) {
      bar = document.createElement('div');
      bar.id = 'quoteReplyBar';
      bar.className = 'quote-reply-bar';
      var inputArea = document.querySelector('.chat-input-area') || document.getElementById('chatForm');
      if (inputArea && inputArea.parentNode) {
        inputArea.parentNode.insertBefore(bar, inputArea);
      }
    }
    bar.innerHTML = '<div class="quote-reply-content">' +
      '<span class="quote-reply-icon">↩</span>' +
      '<span class="quote-reply-text">' + escapeHtml(App._quoteReply.text) + '</span>' +
      '<button class="quote-reply-cancel" type="button">✕</button></div>';
    bar.style.display = 'flex';
    bar.querySelector('.quote-reply-cancel').addEventListener('click', function () {
      App.cancelQuoteReply();
    });
    /* 聚焦输入框 */
    var input = document.getElementById('messageInput');
    if (input) input.focus();
  };

  App.cancelQuoteReply = function () {
    App._quoteReply = null;
    var bar = document.getElementById('quoteReplyBar');
    if (bar) bar.style.display = 'none';
  };

  /* ===== SVG 仪表盘心声 ===== */
  App.renderHvGauge = function (label, value, max, color, icon) {
    var num = parseInt(value, 10);
    if (isNaN(num)) return '<div class="hv-field"><span class="hv-label">' + icon + ' ' + label + '</span><span class="hv-value">' + escapeHtml(value) + '</span></div>';
    var pct = Math.max(0, Math.min(100, num));
    var r = 28;
    var circumference = 2 * Math.PI * r;
    var dashOffset = circumference * (1 - pct / 100);
    return '<div class="hv-gauge-item">' +
      '<svg class="hv-gauge-svg" viewBox="0 0 72 72">' +
        '<circle cx="36" cy="36" r="' + r + '" fill="none" stroke="rgba(0,0,0,0.06)" stroke-width="5"/>' +
        '<circle cx="36" cy="36" r="' + r + '" fill="none" stroke="' + color + '" stroke-width="5" stroke-linecap="round" ' +
          'stroke-dasharray="' + circumference + '" stroke-dashoffset="' + dashOffset + '" ' +
          'transform="rotate(-90 36 36)" style="transition:stroke-dashoffset 0.6s ease"/>' +
        '<text x="36" y="40" text-anchor="middle" font-size="18" font-weight="700" fill="' + color + '">' + num + '</text>' +
      '</svg>' +
      '<div class="hv-gauge-label">' + icon + ' ' + label + '</div>' +
    '</div>';
  };

  /* ===== 主动消息轮询 ===== */
  App.startProactivePolling = function () {
    if (App._proactiveTimer) clearInterval(App._proactiveTimer);
    App._proactiveTimer = setInterval(function () {
      if (App.sending) return;
      if (!App.activeRoleData) return;
      /* 只在聊天页面时轮询 */
      if (App.currentPage !== 'chatPage') return;

      App.api.get('/api/chat/proactive').then(function (res) {
        if (res.code === 0 && res.data && res.data.hasMessage) {
          var data = res.data;
          /* 提取元数据 */
          var meta = App.extractMeta(data.content);
          var aiMsg = {
            id: App.uuid(),
            role: 'assistant',
            content: meta.clean,
            thinking: meta.thinking || '',
            heartVoice: meta.heartVoice || '',
            ts: Date.now(),
            proactive: true
          };
          /* 如果服务端有心声数据，补充 */
          if (!aiMsg.heartVoice && data.heartVoice) {
            var hv = data.heartVoice;
            aiMsg.heartVoice = '好感度-' + (hv.affection != null ? hv.affection : '?') +
              '\n欲望值-' + (hv.desire != null ? hv.desire : '?') +
              '\n行为动作-' + (hv.action || '') +
              '\n角色心声-' + (hv.monologue || '');
          }
          App.messages.push(aiMsg);
          if (App.activeRoleData && App.chatHistory['chat_' + App.activeRoleData.id]) {
            App.chatHistory['chat_' + App.activeRoleData.id].push(aiMsg);
          }
          if (aiMsg.thinking) {
            App._lastThinking = aiMsg.thinking;
            App.updateThinkingBtn(true);
          }
          if (aiMsg.heartVoice) {
            App._lastHeartVoice = aiMsg.heartVoice;
          }
          App.renderMessages();
          /* 播放通知提示 */
          App.toast('💌 ' + (data.roleName || 'TA') + ' 主动找你了');
        }
      }).catch(function () {});
    }, 30000); /* 每30秒检查一次 */
  };

  App.showThinkingPopup = function (content) {
    if (!content || !content.trim()) {
      App.toast('暂无思维链内容');
      return;
    }
    var overlay = document.createElement('div');
    overlay.className = 'mc-modal-overlay';
    overlay.innerHTML = '<div class="mc-modal-box mc-think-box">' +
      '<div class="mc-modal-head">' +
        '<span class="mc-modal-title">💭 思维链</span>' +
        '<button class="mc-modal-close" type="button">✕</button>' +
      '</div>' +
      '<div class="mc-modal-body mc-think-body">' + escapeHtml(content).replace(/\n/g, '<br>') + '</div>' +
    '</div>';
    document.body.appendChild(overlay);
    requestAnimationFrame(function () { overlay.classList.add('show'); });
    function close() { overlay.classList.remove('show'); setTimeout(function () { overlay.remove(); }, 250); }
    overlay.querySelector('.mc-modal-close').addEventListener('click', close);
    overlay.addEventListener('click', function (e) { if (e.target === overlay) close(); });
  };

  App.showHeartVoicePopup = function (content) {
    if (!content || !content.trim()) {
      App.toast('暂无心声内容');
      return;
    }
    var role = App.activeRoleData || {};
    var overlay = document.createElement('div');
    overlay.className = 'mc-modal-overlay';
    overlay.innerHTML = '<div class="mc-modal-box mc-hv-box">' +
      '<div class="mc-hv-head">' +
        '<img class="mc-hv-avatar" src="' + escapeAttr(role.avatar || '/avatars/avatar1.png') + '" alt="">' +
        '<div class="mc-hv-title">' +
          '<div class="mc-hv-name">' + escapeHtml(role.name || '角色') + ' 的心声</div>' +
          '<div class="mc-hv-sub">💗 点击查看TA的内心</div>' +
        '</div>' +
        '<button class="mc-modal-close" type="button">✕</button>' +
      '</div>' +
      '<div class="mc-modal-body mc-hv-body">' + App.formatHeartVoice(content) + '</div>' +
    '</div>';
    document.body.appendChild(overlay);
    requestAnimationFrame(function () { overlay.classList.add('show'); });
    function close() { overlay.classList.remove('show'); setTimeout(function () { overlay.remove(); }, 250); }
    overlay.querySelector('.mc-modal-close').addEventListener('click', close);
    overlay.addEventListener('click', function (e) { if (e.target === overlay) close(); });
  };

  /* ===== 退出登录 ===== */
  App.doLogout = function () {
    localStorage.removeItem('mochi_auth_token');
    localStorage.removeItem('mochi_phone_user_id');
    localStorage.removeItem('commercial_ai_role_chat_state_v1');
    location.reload();
  };

  /* ===== 初始化 ===== */
  App.init = function () {
    /* 页面导航 */
    var navBtns = document.querySelectorAll('.bottom-nav button[data-page]');
    navBtns.forEach(function (btn) {
      btn.addEventListener('click', function () {
        App.showPage(this.getAttribute('data-page'));
      });
    });

    /* 聊天模式切换 */
    var onlineBtn = document.getElementById('chatModeOnline');
    var offlineBtn = document.getElementById('chatModeOffline');
    if (onlineBtn) onlineBtn.addEventListener('click', function () { App.setChatMode('online'); });
    if (offlineBtn) offlineBtn.addEventListener('click', function () { App.setChatMode('offline'); });

    /* 发送消息 */
    var chatForm = document.getElementById('chatForm');
    if (chatForm) {
      chatForm.addEventListener('submit', function (e) {
        e.preventDefault();
        App.sendMessage();
      });
    }

    /* 输入框自动调整高度 */
    var messageInput = document.getElementById('messageInput');
    if (messageInput) {
      messageInput.addEventListener('input', function () {
        this.style.height = 'auto';
        this.style.height = Math.min(this.scrollHeight, 120) + 'px';
      });
      messageInput.addEventListener('keydown', function (e) {
        if (e.key === 'Enter' && !e.shiftKey) {
          e.preventDefault();
          App.sendMessage();
        }
      });
    }

    /* 工具按钮 */
    var toolsBtn = document.getElementById('chatToolsBtn');
    if (toolsBtn) {
      toolsBtn.addEventListener('click', function (e) {
        e.preventDefault();
        e.stopPropagation();
        if (window.MochiUI && window.MochiUI.createToolsPanel) {
          window.MochiUI.createToolsPanel();
          var panel = document.getElementById('mcToolsPanel');
          if (panel) panel.classList.toggle('show');
        } else {
          App.showQuickTools();
        }
      });
    }

    /* 返回按钮 */
    var backBtn = document.getElementById('chatBackBtn');
    if (backBtn) {
      backBtn.addEventListener('click', function () {
        App.showPage('rolesPage');
      });
    }

    /* 菜单按钮 */
    var menuBtn = document.getElementById('chatMenuBtn');
    if (menuBtn) {
      menuBtn.addEventListener('click', function () {
        App.showChatMenu();
      });
    }

    /* 思维链按钮 - 动态注入到聊天头部 */
    var menuParent = menuBtn ? menuBtn.parentElement : null;
    if (menuParent && !document.getElementById('chatThinkingBtn')) {
      var thinkBtn = document.createElement('button');
      thinkBtn.type = 'button';
      thinkBtn.id = 'chatThinkingBtn';
      thinkBtn.className = 'qq-room-thinking-btn';
      thinkBtn.setAttribute('aria-label', '思维链');
      thinkBtn.style.display = 'none';
      thinkBtn.innerHTML = '<svg viewBox="0 0 24 24" width="20" height="20"><path d="M9 21h6M12 17c-3 0-5-2-5-5 0-1 .3-2 .8-2.8C8 7 9 5 11 5c0 2 1 3 2 3s2-1 2-3c2 0 3 2 3.2 4.2.5.8.8 1.8.8 2.8 0 3-2 5-5 5z" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"/></svg>';
      thinkBtn.addEventListener('click', function () {
        App.showThinkingPopup(App._lastThinking || '');
      });
      menuParent.insertBefore(thinkBtn, menuBtn);
    }

    /* 社区标签 */
    var commTabs = document.querySelectorAll('.comm-tab');
    commTabs.forEach(function (tab) {
      tab.addEventListener('click', function () {
        commTabs.forEach(function (t) {
          t.style.background = '#fff';
          t.style.color = '#666';
          t.style.border = '1px solid #ddd';
        });
        this.style.background = '#FF6B9D';
        this.style.color = '#fff';
        this.style.border = 'none';
        App.communityTab = this.getAttribute('data-comm-tab');
        App.loadCommunity();
      });
    });

    /* 社区搜索 */
    var searchBtn = document.getElementById('communitySearchButton');
    if (searchBtn) searchBtn.addEventListener('click', function () { App.loadCommunity(); });
    var searchInput = document.getElementById('communitySearch');
    if (searchInput) {
      searchInput.addEventListener('keydown', function (e) {
        if (e.key === 'Enter') App.loadCommunity();
      });
    }

    /* 新建角色 */
    var newRoleBtn = document.getElementById('newRoleButton');
    if (newRoleBtn) newRoleBtn.addEventListener('click', function () {
      App.showRoleEditor();
    });

    /* 记忆保存 */
    var saveMemBtn = document.getElementById('saveMemoryButton');
    if (saveMemBtn) saveMemBtn.addEventListener('click', function () { App.saveMemory(); });
    var refreshMemBtn = document.getElementById('refreshMemoryButton');
    if (refreshMemBtn) refreshMemBtn.addEventListener('click', function () { App.loadMemories(); });

    /* 资料保存 */
    var saveProfileBtn = document.getElementById('saveProfileButton');
    if (saveProfileBtn) saveProfileBtn.addEventListener('click', function () { App.saveProfile(); });

    /* 头像上传 */
    var avatarInput = document.getElementById('userAvatarInput');
    if (avatarInput) {
      avatarInput.addEventListener('change', function (e) {
        var file = e.target.files[0];
        if (!file) return;
        var reader = new FileReader();
        reader.onload = function (ev) {
          var preview = document.getElementById('userAvatarPreview');
          if (preview) preview.src = ev.target.result;
        };
        reader.readAsDataURL(file);
      });
    }

    /* 手机页面应用 */
    var phoneApps = document.querySelectorAll('[data-phone-app]');
    phoneApps.forEach(function (app) {
      app.addEventListener('click', function () {
        var appName = this.getAttribute('data-phone-app');
        if (appName === 'worldbook') App.openWorldBook();
        else if (appName === 'socialForum') App.openForum('social');
        else if (appName === 'doujinForum') App.openForum('doujin');
        else App.toast('功能开发中');
      });
    });

    /* 清空缓存 */
    var clearCacheBtn = document.getElementById('clearCacheButton');
    if (clearCacheBtn) {
      clearCacheBtn.addEventListener('click', function () {
        if (confirm('确定要清空本地缓存吗？聊天记录将被清除。')) {
          var keys = Object.keys(localStorage).filter(function (k) {
            return k.startsWith('chat_') || k.startsWith('sf_') || k.startsWith('mochi_');
          });
          keys.forEach(function (k) { localStorage.removeItem(k); });
          App.messages = [];
          App.chatHistory = {};
          App.toast('缓存已清空');
          location.reload();
        }
      });
    }

    /* 导出数据 */
    var exportBtn = document.getElementById('exportDataButton');
    if (exportBtn) {
      exportBtn.addEventListener('click', function () {
        window.open('/api/user/export-data', '_blank');
      });
    }

    /* 导入数据 */
    var importBtn = document.getElementById('importDataButton');
    var importInput = document.getElementById('importDataInput');
    if (importBtn && importInput) {
      importBtn.addEventListener('click', function () { importInput.click(); });
      importInput.addEventListener('change', function (e) {
        var file = e.target.files[0];
        if (!file) return;
        var reader = new FileReader();
        reader.onload = function (ev) {
          try {
            var data = JSON.parse(ev.target.result);
            App.api.post('/api/user/import-data', data).then(function (res) {
              if (res.code === 0) {
                App.toast('导入成功');
                location.reload();
              } else {
                App.toast(res.message || '导入失败');
              }
            });
          } catch (err) {
            App.toast('文件格式错误');
          }
        };
        reader.readAsText(file);
      });
    }

    /* 时钟 */
    App.updateClock();
    setInterval(function () { App.updateClock(); }, 1000);

    /* 主动消息轮询 */
    App.startProactivePolling();

    /* 初始化工具面板 */
    if (window.MochiUI && window.MochiUI.createToolsPanel) {
      window.MochiUI.createToolsPanel();
    }

    /* 检查登录状态 */
    var token = localStorage.getItem('mochi_auth_token');
    if (token) {
      App.checkAuthAndInit();
    } else {
      App.loadInitialData();
    }
  };

  App.checkAuthAndInit = function () {
    fetch('/api/auth/me', { headers: { 'x-session-token': localStorage.getItem('mochi_auth_token') } })
      .then(function (r) { return r.json(); })
      .then(function (res) {
        if (res.code === 0 && res.data && res.data.loggedIn) {
          if (res.data.isAdmin) {
            var adminBtn = document.getElementById('adminEntryBtn');
            if (adminBtn) adminBtn.style.display = 'inline-block';
          }
          var logoutBtn = document.getElementById('logoutBtn');
          if (logoutBtn) logoutBtn.style.display = 'inline-block';
          App.loadInitialData();
        } else {
          localStorage.removeItem('mochi_auth_token');
          App.loadInitialData();
        }
      })
      .catch(function () { App.loadInitialData(); });
  };

  App.loadInitialData = function () {
    App.loadRoles();
    App.updateBeans(0);
    App.api.get('/api/user/me').then(function (res) {
      if (res.data && res.data.beans !== undefined) {
        App.updateBeans(res.data.beans);
      }
    }).catch(function () {});

    /* 加载聊天设置 */
    App.api.get('/api/chat-settings').then(function (res) {
      if (res.data && res.data.chatMode) {
        App.setChatMode(res.data.chatMode);
      }
    }).catch(function () {});
  };

  App.updateClock = function () {
    var clockEl = document.getElementById('phoneClock');
    var dateEl = document.getElementById('phoneDate');
    if (!clockEl) return;
    var now = new Date();
    var h = String(now.getHours()).padStart(2, '0');
    var m = String(now.getMinutes()).padStart(2, '0');
    clockEl.textContent = h + ':' + m;
    if (dateEl) {
      var days = ['日', '一', '二', '三', '四', '五', '六'];
      dateEl.textContent = (now.getMonth() + 1) + '月' + now.getDate() + '日 星期' + days[now.getDay()];
    }
  };

  /* 快捷工具 */
  App.showQuickTools = function () {
    var existing = document.getElementById('quickToolsPanel');
    if (existing) { existing.remove(); return; }

    var panel = document.createElement('div');
    panel.id = 'quickToolsPanel';
    panel.className = 'mc-tools-panel show';
    panel.innerHTML = '<div class="mc-tools-grid">' +
      '<button class="mc-tool-item" data-tool="image"><span class="mc-tool-icon">🖼</span><span>图片</span></button>' +
      '<button class="mc-tool-item" data-tool="sticker"><span class="mc-tool-icon">😊</span><span>表情</span></button>' +
      '<button class="mc-tool-item" data-tool="voice"><span class="mc-tool-icon">🎤</span><span>语音</span></button>' +
      '<button class="mc-tool-item" data-tool="redpacket"><span class="mc-tool-icon">🧧</span><span>红包</span></button>' +
      '<button class="mc-tool-item" data-tool="transfer"><span class="mc-tool-icon">💸</span><span>转账</span></button>' +
      '<button class="mc-tool-item" data-tool="location"><span class="mc-tool-icon">📍</span><span>位置</span></button>' +
      '<button class="mc-tool-item" data-tool="call"><span class="mc-tool-icon">📞</span><span>通话</span></button>' +
      '<button class="mc-tool-item" data-tool="poem"><span class="mc-tool-icon">💌</span><span>情诗</span></button>' +
      '<button class="mc-tool-item" data-tool="rule-presets"><span class="mc-tool-icon">🧠</span><span>AI规则</span></button>' +
    '</div>';
    document.body.appendChild(panel);

    panel.addEventListener('click', function (e) {
      if (e.target === panel) panel.remove();
    });

    panel.querySelectorAll('.mc-tool-item').forEach(function (btn) {
      btn.addEventListener('click', function () {
        var tool = this.getAttribute('data-tool');
        App.handleQuickTool(tool);
        panel.remove();
      });
    });
  };

  App.handleQuickTool = function (tool) {
    var input = document.getElementById('messageInput');
    if (!input) return;
    switch (tool) {
      case 'image':
        App.toast('输入 图片-描述 来发送图片');
        break;
      case 'sticker':
        input.value = '表情包-';
        input.focus();
        break;
      case 'voice':
        input.value = '语音-';
        input.focus();
        break;
      case 'redpacket':
        App.showRedpacketDialog();
        break;
      case 'transfer':
        App.showTransferDialog();
        break;
      case 'location':
        input.value = '位置-';
        input.focus();
        break;
      case 'call':
        input.value = '发起语音通话';
        break;
      case 'poem':
        input.value = '情诗-';
        input.focus();
        break;
      case 'rule-presets':
        if (window.MochiSettings && window.MochiSettings.showRulePresets) {
          window.MochiSettings.showRulePresets();
        } else {
          App.toast('规则预设功能加载中...');
        }
        break;
    }
  };

  App.showRedpacketDialog = function () {
    var overlay = document.createElement('div');
    overlay.className = 'mc-modal-overlay';
    overlay.innerHTML = '<div class="mc-modal-box"><div class="mc-modal-head"><span class="mc-modal-title">发红包</span><button class="mc-modal-close" type="button">✕</button></div><div class="mc-modal-body"><div style="padding:20px;text-align:center"><input id="rpAmount" type="number" placeholder="金额" min="0.01" style="width:80%;padding:12px;border:1px solid #eee;border-radius:10px;font-size:18px;text-align:center;margin-bottom:12px"><input id="rpNote" type="text" placeholder="恭喜发财" style="width:80%;padding:10px;border:1px solid #eee;border-radius:10px;margin-bottom:16px"><button id="rpSend" style="width:80%;padding:12px;background:linear-gradient(135deg,#FF6B9D,#FFB6C1);color:#fff;border:none;border-radius:10px;font-size:16px;cursor:pointer">发红包</button></div></div></div>';
    document.body.appendChild(overlay);
    requestAnimationFrame(function () { overlay.classList.add('show'); });
    function close() { overlay.classList.remove('show'); setTimeout(function () { overlay.remove(); }, 250); }
    overlay.querySelector('.mc-modal-close').addEventListener('click', close);
    overlay.addEventListener('click', function (e) { if (e.target === overlay) close(); });
    overlay.querySelector('#rpSend').addEventListener('click', function () {
      var amt = parseFloat(overlay.querySelector('#rpAmount').value) || 0;
      var note = overlay.querySelector('#rpNote').value || '恭喜发财';
      if (amt < 0.01) { App.toast('金额至少0.01'); return; }
      var input = document.getElementById('messageInput');
      if (input) {
        input.value = '红包-拼手气-' + amt + '|' + note;
        var form = document.getElementById('chatForm');
        if (form) form.dispatchEvent(new Event('submit', { cancelable: true }));
      }
      close();
    });
  };

  App.showTransferDialog = function () {
    var overlay = document.createElement('div');
    overlay.className = 'mc-modal-overlay';
    overlay.innerHTML = '<div class="mc-modal-box"><div class="mc-modal-head"><span class="mc-modal-title">转账</span><button class="mc-modal-close" type="button">✕</button></div><div class="mc-modal-body"><div style="padding:20px;text-align:center"><input id="tfAmount" type="number" placeholder="金额" min="0.01" style="width:80%;padding:12px;border:1px solid #eee;border-radius:10px;font-size:18px;text-align:center;margin-bottom:12px"><input id="tfNote" type="text" placeholder="备注" style="width:80%;padding:10px;border:1px solid #eee;border-radius:10px;margin-bottom:16px"><button id="tfSend" style="width:80%;padding:12px;background:linear-gradient(135deg,#FF6B9D,#FFB6C1);color:#fff;border:none;border-radius:10px;font-size:16px;cursor:pointer">转账</button></div></div></div>';
    document.body.appendChild(overlay);
    requestAnimationFrame(function () { overlay.classList.add('show'); });
    function close() { overlay.classList.remove('show'); setTimeout(function () { overlay.remove(); }, 250); }
    overlay.querySelector('.mc-modal-close').addEventListener('click', close);
    overlay.addEventListener('click', function (e) { if (e.target === overlay) close(); });
    overlay.querySelector('#tfSend').addEventListener('click', function () {
      var amt = parseFloat(overlay.querySelector('#tfAmount').value) || 0;
      var note = overlay.querySelector('#tfNote').value || '转账';
      if (amt < 0.01) { App.toast('金额至少0.01'); return; }
      var input = document.getElementById('messageInput');
      if (input) {
        input.value = '转账-' + amt + '|' + note;
        var form = document.getElementById('chatForm');
        if (form) form.dispatchEvent(new Event('submit', { cancelable: true }));
      }
      close();
    });
  };

  App.showChatMenu = function () {
    if (!App.activeRoleData) { App.toast('请先选择角色'); return; }
    var overlay = document.createElement('div');
    overlay.className = 'mc-modal-overlay';
    overlay.innerHTML = '<div class="mc-modal-box"><div class="mc-modal-head"><span class="mc-modal-title">' + escapeHtml(App.activeRoleData.name) + '</span><button class="mc-modal-close" type="button">✕</button></div><div class="mc-modal-body"><div style="padding:12px">' +
      '<button class="menu-item" data-action="clear" style="display:block;width:100%;padding:12px;border:none;background:none;text-align:left;font-size:14px;cursor:pointer;border-bottom:1px solid #eee">清空聊天记录</button>' +
      '<button class="menu-item" data-action="worldbook" style="display:block;width:100%;padding:12px;border:none;background:none;text-align:left;font-size:14px;cursor:pointer;border-bottom:1px solid #eee">世界书设置</button>' +
      '<button class="menu-item" data-action="mode" style="display:block;width:100%;padding:12px;border:none;background:none;text-align:left;font-size:14px;cursor:pointer;border-bottom:1px solid #eee">切换聊天模式</button>' +
      '<button class="menu-item" data-action="settings" style="display:block;width:100%;padding:12px;border:none;background:none;text-align:left;font-size:14px;cursor:pointer">聊天设置</button>' +
    '</div></div></div>';
    document.body.appendChild(overlay);
    requestAnimationFrame(function () { overlay.classList.add('show'); });
    function close() { overlay.classList.remove('show'); setTimeout(function () { overlay.remove(); }, 250); }
    overlay.querySelector('.mc-modal-close').addEventListener('click', close);
    overlay.addEventListener('click', function (e) { if (e.target === overlay) close(); });
    overlay.querySelectorAll('.menu-item').forEach(function (btn) {
      btn.addEventListener('click', function () {
        var action = this.getAttribute('data-action');
        close();
        if (action === 'clear') {
          if (confirm('确定清空聊天记录？')) {
            App.messages = [];
            if (App.activeRoleData) {
              App.chatHistory['chat_' + App.activeRoleData.id] = [];
            }
            App.renderMessages();
            App.toast('已清空');
          }
        } else if (action === 'worldbook') {
          App.openWorldBook();
        } else if (action === 'mode') {
          App.setChatMode(App.chatMode === 'online' ? 'offline' : 'online');
        } else if (action === 'settings') {
          App.toast('设置功能开发中');
        }
      });
    });
  };

  App.showRoleEditor = function () {
    var overlay = document.createElement('div');
    overlay.className = 'mc-modal-overlay';
    overlay.innerHTML = '<div class="mc-modal-box"><div class="mc-modal-head"><span class="mc-modal-title">新建角色</span><button class="mc-modal-close" type="button">✕</button></div><div class="mc-modal-body"><div style="padding:20px">' +
      '<label style="display:block;margin-bottom:12px"><span style="display:block;margin-bottom:4px;font-size:13px;color:#666">角色名称</span><input id="newRoleName" type="text" maxlength="40" style="width:100%;padding:10px;border:1px solid #eee;border-radius:8px;box-sizing:border-box"></label>' +
      '<label style="display:block;margin-bottom:12px"><span style="display:block;margin-bottom:4px;font-size:13px;color:#666">角色描述</span><input id="newRoleDesc" type="text" maxlength="160" style="width:100%;padding:10px;border:1px solid #eee;border-radius:8px;box-sizing:border-box"></label>' +
      '<label style="display:block;margin-bottom:12px"><span style="display:block;margin-bottom:4px;font-size:13px;color:#666">人设提示词</span><textarea id="newRolePrompt" rows="6" style="width:100%;padding:10px;border:1px solid #eee;border-radius:8px;box-sizing:border-box;resize:vertical" placeholder="详细描述角色的性格、背景、说话方式..."></textarea></label>' +
      '<label style="display:block;margin-bottom:16px"><span style="display:block;margin-bottom:4px;font-size:13px;color:#666">头像URL（可选）</span><input id="newRoleAvatar" type="text" style="width:100%;padding:10px;border:1px solid #eee;border-radius:8px;box-sizing:border-box" placeholder="/avatars/avatar1.png"></label>' +
      '<button id="newRoleSave" style="width:100%;padding:12px;background:linear-gradient(135deg,#FF6B9D,#FFB6C1);color:#fff;border:none;border-radius:10px;font-size:16px;cursor:pointer">创建</button>' +
    '</div></div></div>';
    document.body.appendChild(overlay);
    requestAnimationFrame(function () { overlay.classList.add('show'); });
    function close() { overlay.classList.remove('show'); setTimeout(function () { overlay.remove(); }, 250); }
    overlay.querySelector('.mc-modal-close').addEventListener('click', close);
    overlay.addEventListener('click', function (e) { if (e.target === overlay) close(); });
    overlay.querySelector('#newRoleSave').addEventListener('click', function () {
      var name = overlay.querySelector('#newRoleName').value.trim();
      var prompt = overlay.querySelector('#newRolePrompt').value.trim();
      if (!name || !prompt) { App.toast('请填写名称和人设'); return; }
      App.api.post('/api/community/roles', {
        name: name,
        description: overlay.querySelector('#newRoleDesc').value,
        prompt: prompt,
        avatar: overlay.querySelector('#newRoleAvatar').value || '/avatars/avatar1.png',
        isPublic: false
      }).then(function (res) {
        if (res.code === 0) {
          App.toast('角色已创建');
          close();
          App.loadRoles();
        } else {
          App.toast(res.message || '创建失败');
        }
      });
    });
  };

  /* ===== 论坛 ===== */
  App.openForum = function (type) {
    if (window.ForumApp) {
      window.ForumApp.open(type);
    } else {
      App.toast('论坛功能加载中...');
      /* 动态加载 forum.js */
      var script = document.createElement('script');
      script.src = '/forum.js';
      script.onload = function () {
        if (window.ForumApp) window.ForumApp.open(type);
      };
      document.head.appendChild(script);
    }
  };

  /* ===== 私信 ===== */
  App.openMessages = function () {
    var overlay = document.getElementById('dmOverlay');
    if (overlay) {
      overlay.style.display = 'flex';
      App.loadMessages();
    }
  };

  App.loadMessages = function () {
    App.api.get('/api/messages').then(function (res) {
      var list = (res.data && res.data.list) || [];
      var container = document.querySelector('#dmOverlay .dm-list');
      if (!container) return;
      if (!list.length) {
        container.innerHTML = '<div style="text-align:center;padding:40px;color:#999">暂无私信</div>';
        return;
      }
      container.innerHTML = list.map(function (msg) {
        return '<div class="dm-item">' +
          '<div class="dm-from">' + escapeHtml(msg.fromName || '匿名') + '</div>' +
          '<div class="dm-content">' + escapeHtml(msg.content) + '</div>' +
          '<div class="dm-time">' + formatTime(new Date(msg.createdAt).getTime()) + '</div>' +
        '</div>';
      }).join('');
    });
  };

  /* ===== 辅助函数 ===== */
  function escapeHtml(text) {
    var div = document.createElement('div');
    div.textContent = String(text || '');
    return div.innerHTML;
  }

  function escapeAttr(text) {
    return String(text || '').replace(/"/g, '&quot;').replace(/'/g, '&#39;');
  }

  function formatTime(ts) {
    if (!ts) return '';
    var d = new Date(ts);
    var now = new Date();
    var h = String(d.getHours()).padStart(2, '0');
    var m = String(d.getMinutes()).padStart(2, '0');
    if (d.toDateString() === now.toDateString()) {
      return h + ':' + m;
    }
    return (d.getMonth() + 1) + '/' + d.getDate() + ' ' + h + ':' + m;
  }

  function getStickerEmoji(name) {
    var map = {
      '开心': '😄', '大笑': '😆', '微笑': '😊', '害羞': '😳',
      '生气': '😡', '哭泣': '😢', '惊讶': '😱', '爱心': '😍',
      '飞吻': '😘', '调皮': '😜', '思考': '🤔', '睡觉': '😴',
      '点赞': '👍', '鼓掌': '👏', '加油': '💪', ' OK': '👌',
      '抱抱': '🤗', '亲亲': '💋', '玫瑰': '🌹', '蛋糕': '🍰'
    };
    for (var key in map) {
      if (String(name).indexOf(key) >= 0) return map[key];
    }
    return '😊';
  }

  /* 暴露给全局 */
  window.doLogout = App.doLogout;
  window.closeWorldBookDialog = App.closeWorldBookDialog;
  window.saveWorldBook = App.saveWorldBook;

  /* DOM Ready */
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', App.init);
  } else {
    App.init();
  }

})();
