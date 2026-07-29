/**
 * Mochi UI - 界面整合模块
 * 将所有功能模块接入主界面，添加工具栏入口和导航
 */
(function () {
  'use strict';

  var MochiUI = {};

  /* ===== 工具栏面板 ===== */
  MochiUI.createToolsPanel = function () {
    if (document.getElementById('mcToolsPanel')) return;

    var panel = document.createElement('div');
    panel.id = 'mcToolsPanel';
    panel.className = 'mc-tools-panel';
    panel.innerHTML = '' +
      '<div class="mc-tools-grid">' +
        '<button class="mc-tool-item" data-action="image"><span class="mc-tool-icon">🖼</span><span>图片</span></button>' +
        '<button class="mc-tool-item" data-action="sticker"><span class="mc-tool-icon">😊</span><span>表情</span></button>' +
        '<button class="mc-tool-item" data-action="voice"><span class="mc-tool-icon">🎤</span><span>语音</span></button>' +
        '<button class="mc-tool-item" data-action="call-audio"><span class="mc-tool-icon">📞</span><span>语音通话</span></button>' +
        '<button class="mc-tool-item" data-action="call-video"><span class="mc-tool-icon">📹</span><span>视频通话</span></button>' +
        '<button class="mc-tool-item" data-action="redpacket"><span class="mc-tool-icon">🧧</span><span>红包</span></button>' +
        '<button class="mc-tool-item" data-action="transfer"><span class="mc-tool-icon">💸</span><span>转账</span></button>' +
        '<button class="mc-tool-item" data-action="heart"><span class="mc-tool-icon">💗</span><span>心声</span></button>' +
        '<button class="mc-tool-item" data-action="poem"><span class="mc-tool-icon">💌</span><span>情诗</span></button>' +
        '<button class="mc-tool-item" data-action="translate"><span class="mc-tool-icon">🌐</span><span>翻译</span></button>' +
        '<button class="mc-tool-item" data-action="moments"><span class="mc-tool-icon">📰</span><span>朋友圈</span></button>' +
        '<button class="mc-tool-item" data-action="wallet"><span class="mc-tool-icon">💰</span><span>钱包</span></button>' +
        '<button class="mc-tool-item" data-action="groups"><span class="mc-tool-icon">👥</span><span>群聊</span></button>' +
        '<button class="mc-tool-item" data-action="album"><span class="mc-tool-icon">🖼</span><span>相册</span></button>' +
        '<button class="mc-tool-item" data-action="settings"><span class="mc-tool-icon">⚙</span><span>设置</span></button>' +
        '<button class="mc-tool-item" data-action="rule-presets"><span class="mc-tool-icon">🧠</span><span>AI规则</span></button>' +
        '<button class="mc-tool-item" data-action="contact-settings"><span class="mc-tool-icon">👤</span><span>角色设置</span></button>' +
      '</div>';

    document.body.appendChild(panel);

    // 点击面板外关闭
    panel.addEventListener('click', function (e) {
      if (e.target === panel) panel.classList.remove('show');
    });

    // 绑定工具按钮
    panel.querySelectorAll('.mc-tool-item').forEach(function (btn) {
      btn.addEventListener('click', function () {
        var action = this.getAttribute('data-action');
        MochiUI.handleToolAction(action);
        panel.classList.remove('show');
      });
    });
  };

  /* ===== 工具动作分发 ===== */
  MochiUI.handleToolAction = function (action) {
    var role = window.activeRole ? window.activeRole() : null;
    var M = window.MochiMedia;
    var S = window.MochiSocial;
    var Settings = window.MochiSettings;

    switch (action) {
      case 'image':
        if (M && M.openImagePicker) M.openImagePicker();
        break;
      case 'sticker':
        if (M && M.openStickerPanel) M.openStickerPanel();
        break;
      case 'voice':
        if (M && M.toggleRecord) M.toggleRecord();
        else if (M && M.startRecord) M.startRecord();
        break;
      case 'call-audio':
        if (M && M.startCall) M.startCall('audio');
        break;
      case 'call-video':
        if (M && M.startCall) M.startCall('video');
        break;
      case 'redpacket':
        MochiUI.showRedpacketDialog();
        break;
      case 'transfer':
        MochiUI.showTransferDialog();
        break;
      case 'heart':
        if (S && S.showHeartVoice && role) S.showHeartVoice(role.id);
        else if (S && S.showHeartVoice) S.showHeartVoice('');
        break;
      case 'poem':
        if (S && S.showLovePoems && role) S.showLovePoems(role.id);
        else if (S && S.showLovePoems) S.showLovePoems('');
        break;
      case 'translate':
        MochiUI.showTranslateDialog();
        break;
      case 'moments':
        if (S && S.showMoments) S.showMoments();
        break;
      case 'wallet':
        if (S && S.showWallet) S.showWallet();
        break;
      case 'groups':
        if (S && S.showGroups) S.showGroups();
        break;
      case 'album':
        if (Settings && Settings.showAlbum) Settings.showAlbum();
        break;
      case 'settings':
        if (Settings && Settings.showGlobalSettings) Settings.showGlobalSettings();
        break;
      case 'rule-presets':
        if (Settings && Settings.showRulePresets) Settings.showRulePresets();
        break;
      case 'contact-settings':
        if (!role) { MochiUI.toast('请先选择一个角色'); return; }
        if (Settings && Settings.showContactSettings) Settings.showContactSettings(role.id);
        break;
    }
  };

  /* ===== 红包对话框 ===== */
  MochiUI.showRedpacketDialog = function () {
    var overlay = MochiUI.createModal('发红包', '');
    overlay.body.innerHTML = '' +
      '<div style="padding:20px;text-align:center">' +
        '<input id="mcRpAmount" type="number" placeholder="金额" min="0.01" max="888" step="0.01" style="width:80%;padding:12px;border:1px solid #eee;border-radius:10px;font-size:18px;text-align:center;margin-bottom:12px">' +
        '<input id="mcRpNote" type="text" placeholder="恭喜发财，大吉大利" style="width:80%;padding:10px;border:1px solid #eee;border-radius:10px;font-size:14px;margin-bottom:16px">' +
        '<button id="mcRpSend" style="width:80%;padding:12px;background:linear-gradient(135deg,#FF6B9D,#FFB6C1);color:#fff;border:none;border-radius:10px;font-size:16px;cursor:pointer">发红包</button>' +
      '</div>';

    overlay.body.querySelector('#mcRpSend').addEventListener('click', function () {
      var amt = parseFloat(overlay.body.querySelector('#mcRpAmount').value) || 0;
      var note = overlay.body.querySelector('#mcRpNote').value || '恭喜发财';
      if (amt < 0.01) { MochiUI.toast('金额至少0.01'); return; }
      if (window.MochiSocial && window.MochiSocial.sendRedpacket) {
        window.MochiSocial.sendRedpacket(amt, note);
      }
      overlay.close();
    });
  };

  /* ===== 转账对话框 ===== */
  MochiUI.showTransferDialog = function () {
    var overlay = MochiUI.createModal('转账', '');
    overlay.body.innerHTML = '' +
      '<div style="padding:20px;text-align:center">' +
        '<input id="mcTfAmount" type="number" placeholder="金额" min="0.01" step="0.01" style="width:80%;padding:12px;border:1px solid #eee;border-radius:10px;font-size:18px;text-align:center;margin-bottom:12px">' +
        '<input id="mcTfNote" type="text" placeholder="备注" style="width:80%;padding:10px;border:1px solid #eee;border-radius:10px;font-size:14px;margin-bottom:16px">' +
        '<button id="mcTfSend" style="width:80%;padding:12px;background:linear-gradient(135deg,#FF6B9D,#FFB6C1);color:#fff;border:none;border-radius:10px;font-size:16px;cursor:pointer">转账</button>' +
      '</div>';

    overlay.body.querySelector('#mcTfSend').addEventListener('click', function () {
      var amt = parseFloat(overlay.body.querySelector('#mcTfAmount').value) || 0;
      var note = overlay.body.querySelector('#mcTfNote').value || '转账';
      if (amt < 0.01) { MochiUI.toast('金额至少0.01'); return; }
      // 插入转账消息
      var input = document.getElementById('messageInput');
      if (input) {
        input.value = '[transfer:' + amt + '|' + note + ']';
        var form = document.getElementById('chatForm');
        if (form) form.dispatchEvent(new Event('submit', { cancelable: true }));
      }
      overlay.close();
    });
  };

  /* ===== 翻译对话框 ===== */
  MochiUI.showTranslateDialog = function () {
    var overlay = MochiUI.createModal('翻译', '');
    overlay.body.innerHTML = '' +
      '<div style="padding:20px">' +
        '<textarea id="mcTrInput" placeholder="输入要翻译的文本" style="width:100%;height:80px;padding:10px;border:1px solid #eee;border-radius:10px;font-size:14px;resize:none;margin-bottom:12px"></textarea>' +
        '<select id="mcTrTarget" style="width:100%;padding:8px;border:1px solid #eee;border-radius:8px;margin-bottom:12px">' +
          '<option value="zh">翻译为中文</option>' +
          '<option value="en">翻译为英文</option>' +
          '<option value="ja">翻译为日文</option>' +
          '<option value="ko">翻译为韩文</option>' +
        '</select>' +
        '<button id="mcTrBtn" style="width:100%;padding:10px;background:#FF6B9D;color:#fff;border:none;border-radius:8px;cursor:pointer">翻译</button>' +
        '<div id="mcTrResult" style="margin-top:12px;padding:12px;background:#f9f9f9;border-radius:8px;font-size:14px;display:none"></div>' +
      '</div>';

    overlay.body.querySelector('#mcTrBtn').addEventListener('click', function () {
      var text = overlay.body.querySelector('#mcTrInput').value.trim();
      var target = overlay.body.querySelector('#mcTrTarget').value;
      if (!text) return;
      var result = overlay.body.querySelector('#mcTrResult');
      result.style.display = 'block';
      result.textContent = '翻译中...';
      if (window.MochiCore && window.MochiCore.api) {
        window.MochiCore.api.post('/translate', { text: text, target: target }).then(function (res) {
          var data = res.data || res;
          result.textContent = data.translated || data.original || '翻译结果为空';
        }).catch(function () { result.textContent = '翻译失败'; });
      }
    });
  };

  /* ===== 通用模态框 ===== */
  MochiUI.createModal = function (title, content) {
    var overlay = document.createElement('div');
    overlay.className = 'mc-modal-overlay';
    overlay.innerHTML = '' +
      '<div class="mc-modal-box">' +
        '<div class="mc-modal-head">' +
          '<span class="mc-modal-title">' + (title || '') + '</span>' +
          '<button class="mc-modal-close" type="button">✕</button>' +
        '</div>' +
        '<div class="mc-modal-body">' + (content || '') + '</div>' +
      '</div>';

    document.body.appendChild(overlay);
    requestAnimationFrame(function () { overlay.classList.add('show'); });

    var closeBtn = overlay.querySelector('.mc-modal-close');
    var body = overlay.querySelector('.mc-modal-body');

    function close() {
      overlay.classList.remove('show');
      setTimeout(function () { overlay.remove(); }, 250);
    }
    closeBtn.addEventListener('click', close);
    overlay.addEventListener('click', function (e) { if (e.target === overlay) close(); });

    return { overlay: overlay, body: body, close: close };
  };

  /* ===== Toast ===== */
  MochiUI.toast = function (msg) {
    if (window.MochiCore && window.MochiCore.toast) { window.MochiCore.toast(msg); return; }
    if (window.toast) { window.toast(msg); return; }
    var t = document.createElement('div');
    t.textContent = msg;
    t.style.cssText = 'position:fixed;bottom:80px;left:50%;transform:translateX(-50%);background:rgba(0,0,0,0.75);color:#fff;padding:8px 20px;border-radius:20px;font-size:13px;z-index:99999';
    document.body.appendChild(t);
    setTimeout(function () { t.remove(); }, 2500);
  };

  /* ===== 绑定工具按钮 ===== */
  MochiUI.bindToolsButton = function () {
    var btn = document.getElementById('chatToolsBtn');
    if (!btn) return;

    // Override onclick directly - most robust approach
    btn.onclick = function (e) {
      if (e) { e.preventDefault(); e.stopPropagation(); }
      var panel = document.getElementById('mcToolsPanel');
      if (panel) {
        panel.classList.toggle('show');
      }
      return false;
    };

    // Also use MutationObserver to re-bind if button is replaced
    if (!MochiUI._btnObserver) {
      MochiUI._btnObserver = new MutationObserver(function () {
        var newBtn = document.getElementById('chatToolsBtn');
        if (newBtn && newBtn.onclick !== MochiUI._lastOnClick) {
          MochiUI._lastOnClick = function (e) {
            if (e) { e.preventDefault(); e.stopPropagation(); }
            var panel = document.getElementById('mcToolsPanel');
            if (panel) panel.classList.toggle('show');
            return false;
          };
          newBtn.onclick = MochiUI._lastOnClick;
        }
      });
      MochiUI._btnObserver.observe(document.body, { childList: true, subtree: true });
    }
  };

  /* ===== 添加聊天头部快捷按钮 ===== */
  MochiUI.addChatHeaderButtons = function () {
    var header = document.querySelector('.qq-room__head');
    if (!header || document.getElementById('mcHeaderBtns')) return;

    var btns = document.createElement('div');
    btns.id = 'mcHeaderBtns';
    btns.style.cssText = 'display:flex;gap:6px;align-items:center';
    btns.innerHTML = '' +
      '<button id="mcHeartBtn" class="mc-head-btn" type="button" title="心声" style="background:none;border:none;font-size:18px;cursor:pointer;padding:4px">💗</button>' +
      '<button id="mcWalletBtn" class="mc-head-btn" type="button" title="钱包" style="background:none;border:none;font-size:18px;cursor:pointer;padding:4px">💰</button>';

    header.appendChild(btns);

    document.getElementById('mcHeartBtn').addEventListener('click', function () {
      var role = window.activeRole ? window.activeRole() : null;
      if (window.MochiSocial && window.MochiSocial.showHeartVoice) {
        window.MochiSocial.showHeartVoice(role ? role.id : '');
      }
    });

    document.getElementById('mcWalletBtn').addEventListener('click', function () {
      if (window.MochiSocial && window.MochiSocial.showWallet) {
        window.MochiSocial.showWallet();
      }
    });
  };

  /* ===== 添加底部导航入口 ===== */
  MochiUI.addNavEntries = function () {
    // 查找底部导航栏
    var nav = document.querySelector('.bottom-nav, .app-nav, [class*="nav"]');
    if (!nav || document.getElementById('mcNavEntries')) return;

    var entries = document.createElement('div');
    entries.id = 'mcNavEntries';
    entries.style.cssText = 'display:flex;gap:4px;padding:4px';
    entries.innerHTML = '' +
      '<button class="mc-nav-btn" data-action="moments" style="flex:1;background:none;border:none;font-size:11px;cursor:pointer;padding:8px 4px;color:var(--color-muted)">朋友圈</button>' +
      '<button class="mc-nav-btn" data-action="album" style="flex:1;background:none;border:none;font-size:11px;cursor:pointer;padding:8px 4px;color:var(--color-muted)">相册</button>' +
      '<button class="mc-nav-btn" data-action="settings" style="flex:1;background:none;border:none;font-size:11px;cursor:pointer;padding:8px 4px;color:var(--color-muted)">设置</button>';

    nav.appendChild(entries);

    entries.querySelectorAll('.mc-nav-btn').forEach(function (btn) {
      btn.addEventListener('click', function () {
        MochiUI.handleToolAction(this.getAttribute('data-action'));
      });
    });
  };

  /* ===== 长按消息菜单 ===== */
  MochiUI.setupMessageContextMenu = function () {
    if (document.getElementById('mcCtxMenu')) return;
    var menu = document.createElement('div');
    menu.id = 'mcCtxMenu';
    menu.className = 'mc-ctx-menu';
    menu.innerHTML = '' +
      '<button data-act="copy">复制</button>' +
      '<button data-act="translate">翻译</button>' +
      '<button data-act="delete">删除</button>';
    document.body.appendChild(menu);

    menu.querySelectorAll('button').forEach(function (btn) {
      btn.addEventListener('click', function () {
        var act = this.getAttribute('data-act');
        var msgId = menu.getAttribute('data-msg-id');
        MochiUI.handleContextAction(act, msgId);
        menu.classList.remove('show');
      });
    });

    // 绑定消息长按
    var list = document.getElementById('messageList');
    if (list) {
      list.addEventListener('contextmenu', function (e) {
        var row = e.target.closest('[data-msg-id]');
        if (!row) return;
        e.preventDefault();
        menu.setAttribute('data-msg-id', row.getAttribute('data-msg-id'));
        menu.style.left = e.clientX + 'px';
        menu.style.top = e.clientY + 'px';
        menu.classList.add('show');
      });

      // 触摸长按
      var touchTimer = null;
      list.addEventListener('touchstart', function (e) {
        var row = e.target.closest('[data-msg-id]');
        if (!row) return;
        touchTimer = setTimeout(function () {
          menu.setAttribute('data-msg-id', row.getAttribute('data-msg-id'));
          var touch = e.touches[0];
          menu.style.left = touch.clientX + 'px';
          menu.style.top = touch.clientY + 'px';
          menu.classList.add('show');
        }, 500);
      });
      list.addEventListener('touchend', function () { clearTimeout(touchTimer); });
      list.addEventListener('touchmove', function () { clearTimeout(touchTimer); });
    }

    document.addEventListener('click', function () { menu.classList.remove('show'); });
  };

  MochiUI.handleContextAction = function (act, msgId) {
    var role = window.activeRole ? window.activeRole() : null;
    if (!role || !window.getMessages) return;
    var messages = window.getMessages(role.id);
    var msg = messages.find(function (m) { return m.id === msgId; });
    if (!msg) return;

    switch (act) {
      case 'copy':
        if (navigator.clipboard) navigator.clipboard.writeText(msg.content);
        else { var ta = document.createElement('textarea'); ta.value = msg.content; document.body.appendChild(ta); ta.select(); document.execCommand('copy'); ta.remove(); }
        MochiUI.toast('已复制');
        break;
      case 'translate':
        if (window.MochiSocial && window.MochiSocial.translateMessage) {
          window.MochiSocial.translateMessage(msg.content);
        }
        break;
      case 'delete':
        var idx = messages.indexOf(msg);
        if (idx >= 0) {
          messages.splice(idx, 1);
          if (window.persist) window.persist();
          if (window.renderMessages) window.renderMessages();
          MochiUI.toast('已删除');
        }
        break;
    }
  };

  /* ===== 初始化 ===== */
  MochiUI.init = function () {
    MochiUI.createToolsPanel();
    MochiUI.bindToolsButton();
    MochiUI.addChatHeaderButtons();
    MochiUI.setupMessageContextMenu();

    // 延迟添加导航（等页面完全渲染）
    setTimeout(MochiUI.addNavEntries, 500);

    // 监听页面切换，重新绑定
    var observer = new MutationObserver(function () {
      MochiUI.bindToolsButton();
    });
    observer.observe(document.body, { childList: true, subtree: true });
  };

  window.MochiUI = MochiUI;

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', MochiUI.init);
  } else {
    MochiUI.init();
  }
})();
