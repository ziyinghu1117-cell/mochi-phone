/* === Direct Messages (私信) System === */

var dmCurrentRole = null;
var dmMessages = [];

var openDmOverlay = function() {
  var overlay = document.getElementById('dmOverlay');
  if (!overlay) return;
  overlay.classList.add('active');
  renderDmRoleBar();
  dmCurrentRole = null;
  dmMessages = [];
  renderDmChatList();
};

var closeDmOverlay = function() {
  var overlay = document.getElementById('dmOverlay');
  if (overlay) overlay.classList.remove('active');
};

var renderDmRoleBar = function() {
  var bar = document.getElementById('dmRoleBar');
  if (!bar) return;
  var roles = (typeof state !== 'undefined' && state.roles) ? state.roles : [];
  if (roles.length === 0) {
    bar.innerHTML = '<span style="color:#999;font-size:.8rem;padding:6px">请先创建或选择角色</span>';
    return;
  }
  bar.innerHTML = roles.map(function(r) {
    return '<button class="dm-role-chip' + (dmCurrentRole && dmCurrentRole.name === r.name ? ' active' : '') + '" data-dm-role="' + escapeHtml(r.name) + '">' + escapeHtml(r.name) + '</button>';
  }).join('');
  bar.querySelectorAll('[data-dm-role]').forEach(function(chip) {
    chip.addEventListener('click', function() {
      var name = this.dataset.dmRole;
      var role = roles.find(function(r) { return r.name === name; });
      if (role) selectDmRole(role);
    });
  });
};

var selectDmRole = function(role) {
  dmCurrentRole = role;
  renderDmRoleBar();
  loadDmMessages();
};

var loadDmMessages = async function() {
  if (!dmCurrentRole) return;
  var list = document.getElementById('dmChatList');
  if (list) list.innerHTML = '<div class="forum-loading">加载中...</div>';
  try {
    var resp = await fetch('/api/messages', { headers: { 'X-User-Id': (state.userId || 'demo-user') } });
    var data = await resp.json();
    if (data && data.data && data.data.list) {
      dmMessages = data.data.list.filter(function(m) { return m.role === dmCurrentRole.name; });
    }
  } catch (e) {
    dmMessages = [];
  }
  renderDmChatList();
};

var renderDmChatList = function() {
  var list = document.getElementById('dmChatList');
  if (!list) return;
  if (!dmCurrentRole) {
    list.innerHTML = '<div class="forum-loading">选择一个角色开始私信</div>';
    return;
  }
  if (dmMessages.length === 0) {
    list.innerHTML = '<div class="forum-loading">还没有私信记录，发一条试试吧~</div>';
    return;
  }
  list.innerHTML = dmMessages.slice().reverse().map(function(m) {
    var time = m.createdAt ? new Date(m.createdAt).toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit' }) : '';
    return '<div class="dm-bubble ' + (m.fromUser ? 'from-user' : 'from-role') + '">'
      + '<div>' + escapeHtml(m.content || '') + '</div>'
      + '<div class="dm-time">' + escapeHtml(time) + '</div>'
      + '</div>';
  }).join('');
  list.scrollTop = list.scrollHeight;
};

var sendDmMessage = async function() {
  var input = document.getElementById('dmInput');
  if (!input || !input.value.trim() || !dmCurrentRole) return;
  var text = input.value.trim();
  input.value = '';

  /* Optimistic: show user message immediately */
  dmMessages.push({ id: 'tmp-' + Date.now(), role: dmCurrentRole.name, content: text, fromUser: true, createdAt: new Date().toISOString() });
  renderDmChatList();

  try {
    /* Save to server */
    await fetch('/api/messages', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-User-Id': (state.userId || 'demo-user') },
      body: JSON.stringify({ role: dmCurrentRole.name, content: text, fromUser: true })
    });

    /* Get AI reply */
    var replyResp = await fetch('/api/messages/reply', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-User-Id': (state.userId || 'demo-user') },
      body: JSON.stringify({
        role: dmCurrentRole.name,
        rolePrompt: dmCurrentRole.prompt || '',
        userMessage: text
      })
    });
    var replyData = await replyResp.json();
    if (replyData && replyData.data && replyData.data.reply) {
      dmMessages.push({ id: 'tmp-r-' + Date.now(), role: dmCurrentRole.name, content: replyData.data.reply, fromUser: false, createdAt: new Date().toISOString() });
      /* Save reply to server */
      await fetch('/api/messages', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'X-User-Id': (state.userId || 'demo-user') },
        body: JSON.stringify({ role: dmCurrentRole.name, content: replyData.data.reply, fromUser: false })
      });
    }
    renderDmChatList();
  } catch (e) {
    if (typeof toast === 'function') toast('发送失败，请重试');
  }
};

/* === Bind DM events === */
var bindDmEvents = function() {
  var openBtn = document.getElementById('openMessagesBtn');
  if (openBtn) openBtn.addEventListener('click', openDmOverlay);

  var closeBtn = document.getElementById('dmCloseBtn');
  if (closeBtn) closeBtn.addEventListener('click', closeDmOverlay);

  var sendBtn = document.getElementById('dmSendBtn');
  if (sendBtn) sendBtn.addEventListener('click', sendDmMessage);

  var dmInput = document.getElementById('dmInput');
  if (dmInput) dmInput.addEventListener('keydown', function(e) {
    if (e.key === 'Enter') sendDmMessage();
  });
};

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', bindDmEvents);
} else {
  bindDmEvents();
}
