/**
 * MochiMedia - Rich media module for the Mochi chat application.
 * Self-contained IIFE, attaches to window.MochiMedia.
 *
 * Features:
 *   1. Image messages (URL or base64 upload) + fullscreen preview
 *   2. Sticker / emoticon panel
 *   3. Voice messages (MediaRecorder -> API upload -> animated playback)
 *   4. Call simulation overlay (audio/video) producing a [call:...] record
 *   5. Rich HTML cards rendered safely inside chat bubbles
 *
 * Depends on (provided by the host app):
 *   window.MochiCore            -> { api, store, toast, escapeHtml, getStickerEmoji, parseContent, renderBubbleContent }
 *   window.activeRole()         -> { id, name, avatar, ... }
 *   window.getMessages(roleId)  -> message array (live reference)
 *   window.state.chatMode       -> 'online' | 'offline'
 *   window.persist() / window.renderMessages()
 *   #messageInput (textarea) / #chatForm (form) / #messageList / #chatToolsBtn
 *
 * Original vanilla-JS implementation.
 */
(function () {
  'use strict';

  /* ================================================================
   * Private state
   * ================================================================ */
  var STICKERS = [
    'smile', 'laugh', 'love', 'cry', 'angry', 'surprise', 'wink', 'cool',
    'shy', 'sweat', 'ok', 'thumbsup', 'heart', 'broken', 'fire', 'star',
    'cake', 'gift', 'flower', 'kiss', 'hug', 'wave', 'clap', 'pray',
    'muscle', 'sleep', 'think', 'dizzy', 'ghost', 'cat'
  ];

  // Markers that indicate a message carries rich (non-plain-text) content.
  var RE_RICH = /\[(?:img|sticker|voice|call|redpacket|transfer):|<img-msg|<card\s|<think>|(?:【心声】|\(心声\)|<heart>)/i;
  var RE_CARD_COMPLETE = /<card[\s\S]*?<\/card>/i;

  var recState = { active: false, recorder: null, stream: null, chunks: [], start: 0, timer: null, maxTimer: null };
  var voiceState = { audio: null, restore: null };
  var callState = { overlay: null, type: 'audio', connected: false, connectedAt: 0, timer: null, connectTimer: null };
  var enhanceScheduled = false;

  /* ================================================================
   * Tiny helpers
   * ================================================================ */
  function $(id) { return document.getElementById(id); }

  function localEscape(t) {
    return String(t == null ? '' : t)
      .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;').replace(/'/g, '&#039;');
  }
  function esc(t) {
    try { if (window.MochiCore && MochiCore.escapeHtml) return MochiCore.escapeHtml(t); } catch (e) {}
    return localEscape(t);
  }
  function toast(msg) {
    try { if (window.MochiCore && MochiCore.toast) return MochiCore.toast(msg); } catch (e) {}
    try { if (typeof window.toast === 'function') return window.toast(msg); } catch (e) {}
    var t = document.createElement('div');
    t.textContent = msg;
    t.style.cssText = 'position:fixed;bottom:80px;left:50%;transform:translateX(-50%);background:rgba(0,0,0,.78);color:#fff;padding:8px 18px;border-radius:20px;font-size:13px;z-index:100020;pointer-events:none';
    document.body.appendChild(t);
    setTimeout(function () { t.style.transition = 'opacity .3s'; t.style.opacity = '0'; setTimeout(function () { t.remove(); }, 300); }, 2200);
  }
  function stickerEmoji(name) {
    try { return window.MochiCore.getStickerEmoji(name); } catch (e) { return ''; }
  }
  function pad2(n) { n = String(n); return n.length < 2 ? '0' + n : n; }
  function mmId() { return 'mm_' + Date.now().toString(36) + '_' + Math.random().toString(36).slice(2, 8); }

  /* ---- Host-app global accessors (work whether the app exposes them on
   * `window` or as top-level lexical bindings in a classic script). ---- */
  function getRole() {
    try { if (typeof activeRole === 'function') return activeRole(); } catch (e) {}
    try { if (typeof window.activeRole === 'function') return window.activeRole(); } catch (e) {}
    return null;
  }
  function getMsgs(roleId) {
    try { if (typeof getMessages === 'function') return getMessages(roleId); } catch (e) {}
    try { if (typeof window.getMessages === 'function') return window.getMessages(roleId); } catch (e) {}
    return null;
  }
  function persistState() {
    try { if (typeof persist === 'function') { persist(); return true; } } catch (e) {}
    try { if (typeof window.persist === 'function') { window.persist(); return true; } } catch (e) {}
    return false;
  }
  function rerender() {
    try { if (typeof renderMessages === 'function') return renderMessages(); } catch (e) {}
    try { if (typeof window.renderMessages === 'function') return window.renderMessages(); } catch (e) {}
  }
  function chatMode() {
    try { if (typeof state !== 'undefined' && state) return state.chatMode || 'online'; } catch (e) {}
    try { if (window.state) return window.state.chatMode || 'online'; } catch (e) {}
    return 'online';
  }

  /* ---- Input / send helpers ---- */
  function insertText(text) {
    var input = $('messageInput');
    if (!input || text == null) return;
    text = String(text);
    var s = input.selectionStart, e = input.selectionEnd;
    if (s == null || s < 0) { s = input.value.length; e = s; }
    input.value = input.value.slice(0, s) + text + input.value.slice(e);
    var pos = s + text.length;
    input.focus();
    try { input.setSelectionRange(pos, pos); } catch (_) {}
    try { input.dispatchEvent(new Event('input', { bubbles: true })); } catch (_) {}
  }

  // Append a tag to the current input text and submit the chat form so the
  // host app's sendMessage handler picks it up (and triggers an AI reply).
  function composeAndSend(text) {
    var input = $('messageInput');
    if (input) {
      var cur = input.value.trim();
      input.value = (cur ? cur + ' ' : '') + text;
      try { input.dispatchEvent(new Event('input', { bubbles: true })); } catch (_) {}
    }
    var form = $('chatForm');
    if (form) {
      try { form.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true })); }
      catch (e) { /* fall through */ }
    }
  }

  // Push a user message directly (no AI reply) - used for call records.
  function pushUserMessage(content) {
    var role = getRole();
    if (!role) { toast('请先选择一个角色'); return; }
    var msgs = getMsgs(role.id);
    if (!msgs || typeof msgs.push !== 'function') { composeAndSend(content); return; }
    msgs.push({ id: mmId(), role: 'user', content: content, createdAt: Date.now() });
    persistState();
    rerender();
  }

  /* ================================================================
   * Styles (injected once)
   * ================================================================ */
  function injectStyles() {
    if ($('mochi-media-styles')) return;
    var css = '' +
      /* ---- generic overlays / dialogs ---- */
      '.mm-overlay{position:fixed;inset:0;z-index:100010;display:flex;align-items:center;justify-content:center;background:rgba(0,0,0,.55)}' +
      '.mm-close{position:absolute;top:12px;right:16px;width:34px;height:34px;border:none;border-radius:50%;background:rgba(255,255,255,.2);color:#fff;font-size:22px;line-height:1;cursor:pointer;display:flex;align-items:center;justify-content:center}' +
      '.mm-close:hover{background:rgba(255,255,255,.34)}' +
      '.mm-btn{appearance:none;border:1px solid #eee;background:#f7f7f7;color:#333;padding:9px 16px;border-radius:20px;font-size:13px;cursor:pointer;transition:background .15s,filter .15s;font-family:inherit}' +
      '.mm-btn:hover{background:#efefef}' +
      '.mm-btn-primary{background:var(--color-primary,#FF6B9D);border-color:var(--color-primary,#FF6B9D);color:#fff}' +
      '.mm-btn-primary:hover{filter:brightness(1.06);background:var(--color-primary,#FF6B9D)}' +
      '.mm-btn-danger{background:#ff4d4f;border-color:#ff4d4f;color:#fff}' +
      '.mm-btn-danger:hover{background:#ff3a3c}' +
      /* ---- image preview ---- */
      '.mm-image-preview{background:rgba(0,0,0,.92)}' +
      '.mm-image-preview .mm-preview-img{max-width:92vw;max-height:88vh;border-radius:8px;box-shadow:0 8px 40px rgba(0,0,0,.5);cursor:zoom-out}' +
      /* ---- dialog ---- */
      '.mm-dialog-overlay{background:rgba(0,0,0,.45)}' +
      '.mm-dialog{position:relative;width:min(420px,92vw);background:#fff;border-radius:16px;padding:22px 20px 18px;box-shadow:0 12px 40px rgba(0,0,0,.2);animation:mmPop .18s ease}' +
      '.mm-dialog-title{font-size:16px;font-weight:700;margin-bottom:14px;color:#333}' +
      '.mm-input{width:100%;box-sizing:border-box;padding:10px 12px;border:1px solid #eee;border-radius:10px;font-size:14px;outline:none;margin-bottom:14px;font-family:inherit}' +
      '.mm-input:focus{border-color:var(--color-primary,#FF6B9D)}' +
      '.mm-dialog-actions{display:flex;gap:10px;flex-wrap:wrap}' +
      '.mm-dialog-hint{margin-top:12px;font-size:12px;color:#999}' +
      '.mm-file-hidden{display:none}' +
      /* ---- media menu ---- */
      '.mm-media-menu{position:fixed;z-index:100000;background:#fff;border-radius:14px;box-shadow:0 8px 30px rgba(0,0,0,.18);padding:8px;display:grid;grid-template-columns:repeat(5,1fr);gap:4px;animation:mmPop .15s ease}' +
      '.mm-media-item{display:flex;flex-direction:column;align-items:center;gap:4px;border:none;background:transparent;padding:10px 8px;border-radius:10px;cursor:pointer;font-size:12px;color:#555;font-family:inherit}' +
      '.mm-media-item:hover{background:#f5f5f5}' +
      '.mm-media-icon{font-size:22px;line-height:1}' +
      /* ---- sticker panel ---- */
      '.mm-sticker-panel{position:fixed;z-index:100000;width:min(340px,92vw);background:#fff;border-radius:14px;box-shadow:0 8px 30px rgba(0,0,0,.18);padding:10px;animation:mmPop .15s ease}' +
      '.mm-sticker-head{display:flex;align-items:center;gap:8px;padding:0 4px 8px;border-bottom:1px solid #f0f0f0;margin-bottom:8px}' +
      '.mm-sticker-head>span:first-child{font-size:13px;font-weight:700;color:#333;flex:1}' +
      '.mm-sticker-mode{border:1px solid #eee;background:#f7f7f7;color:#666;padding:4px 10px;border-radius:12px;font-size:11px;cursor:pointer;font-family:inherit}' +
      '.mm-sticker-mode:hover{background:#efefef}' +
      '.mm-close-sm{position:static;width:24px;height:24px;background:transparent;color:#999}' +
      '.mm-sticker-grid{display:grid;grid-template-columns:repeat(6,1fr);gap:4px;max-height:230px;overflow:auto}' +
      '.mm-sticker-item{font-size:24px;border:none;background:transparent;padding:6px;border-radius:8px;cursor:pointer;line-height:1.4}' +
      '.mm-sticker-item:hover{background:#f5f5f5}' +
      /* ---- record indicator ---- */
      '.mm-record-indicator{position:fixed;left:50%;bottom:80px;transform:translateX(-50%);z-index:100005;display:flex;align-items:center;gap:10px;background:#1f1f1f;color:#fff;padding:9px 14px;border-radius:24px;box-shadow:0 6px 20px rgba(0,0,0,.3);animation:mmFade .15s ease}' +
      '.mm-record-dot{width:9px;height:9px;border-radius:50%;background:#ff4d4f;animation:mmPulse 1s infinite}' +
      '.mm-record-label{font-size:13px}' +
      '.mm-record-timer{font-size:13px;font-variant-numeric:tabular-nums;opacity:.9}' +
      /* ---- call overlay ---- */
      '.mm-call-overlay{background:linear-gradient(160deg,#2a2a35,#15151c);flex-direction:column;color:#fff}' +
      '.mm-call-video{background:linear-gradient(160deg,#1c2a3a,#0f1620)}' +
      '.mm-call-content{display:flex;flex-direction:column;align-items:center;gap:14px}' +
      '.mm-call-type{font-size:13px;letter-spacing:2px;opacity:.7;text-transform:uppercase}' +
      '.mm-call-avatar{width:96px;height:96px;border-radius:50%;overflow:hidden;background:linear-gradient(135deg,#FF6B9D,#FFB6C1);display:flex;align-items:center;justify-content:center;box-shadow:0 0 0 4px rgba(255,255,255,.12);animation:mmPulse 2.2s infinite}' +
      '.mm-call-avatar-img{width:100%;height:100%;object-fit:cover}' +
      '.mm-call-avatar-initial{font-size:40px;font-weight:700;color:#fff}' +
      '.mm-call-name{font-size:20px;font-weight:600}' +
      '.mm-call-status{font-size:13px;opacity:.75;min-height:18px}' +
      '.mm-call-timer{font-size:15px;font-variant-numeric:tabular-nums;opacity:.9;min-height:20px}' +
      '.mm-call-end{margin-top:18px;background:#ff4d4f;border:none;color:#fff;padding:12px 28px;border-radius:30px;font-size:14px;cursor:pointer;display:flex;align-items:center;gap:8px;font-family:inherit}' +
      '.mm-call-end:hover{background:#ff3a3c}' +
      /* ---- voice waveform ---- */
      '.mc-voice-bubble.mm-voice-playing .mc-voice-icon{color:var(--color-primary,#FF6B9D)}' +
      '.mm-voice-wave{display:inline-flex;align-items:center;gap:2px;height:18px;width:64px}' +
      '.mm-voice-wave i{flex:1;display:block;width:2px;height:30%;background:#c8c8c8;border-radius:1px;animation:mmBar .9s ease-in-out infinite alternate}' +
      '.mm-voice-wave i.mm-bar-played{background:var(--color-primary,#FF6B9D)}' +
      /* ---- rich card ---- */
      '.mc-card-bubble.mm-card{max-width:280px;border-radius:12px;overflow:hidden;border:1px solid #eee;background:#fafafa;margin:4px 0}' +
      '.mm-card .mc-card-title{font-weight:700;font-size:14px;padding:8px 12px 4px;color:#333}' +
      '.mm-card .mc-card-body{padding:4px 12px 10px;font-size:13px;color:#444;line-height:1.6;word-break:break-word}' +
      '.mm-card .mc-card-body img{max-width:100%;border-radius:8px;height:auto}' +
      '.mm-card .mc-card-body a{color:var(--color-primary,#FF6B9D)}' +
      '.mm-card .mc-card-body :first-child{margin-top:0}' +
      '.mm-card .mc-card-body :last-child{margin-bottom:0}' +
      /* ---- bubble media classes (mc-*) used by MochiCore renderer ---- */
      '.mc-bubble-text{word-break:break-word;line-height:1.55}' +
      '.mc-bubble-divider{height:6px}' +
      '.mc-bubble-images{display:flex;flex-wrap:wrap;gap:4px;margin-top:4px}' +
      '.mc-bubble-img{max-width:200px;max-height:200px;border-radius:8px;cursor:pointer;display:block}' +
      '.mc-bubble-stickers{font-size:40px;line-height:1.2;margin-top:2px}' +
      '.mc-sticker{cursor:pointer;display:inline-block}' +
      '.mc-voice-bubble{display:inline-flex;align-items:center;gap:8px;min-width:150px;padding:8px 12px;border-radius:18px;background:rgba(0,0,0,.04);cursor:pointer}' +
      '.mc-voice-icon{color:#888;flex:0 0 auto}' +
      '.mc-voice-bar{flex:1;height:18px;min-width:70px;display:flex;align-items:center}' +
      '.mc-voice-bar-fill{display:block;height:100%;width:100%;border-radius:4px;background:linear-gradient(90deg,var(--color-primary,#FF6B9D),#ffb6c1);opacity:.5}' +
      '.mc-voice-dur{font-size:12px;color:#888;flex:0 0 auto}' +
      '.mc-call-bubble{display:flex;align-items:center;gap:10px;padding:8px 12px;border-radius:12px;background:rgba(0,0,0,.04);min-width:170px}' +
      '.mc-call-info{display:flex;flex-direction:column;font-size:13px;flex:1}' +
      '.mc-call-dur{font-size:12px;color:#888}' +
      '.mc-call-callback{border:1px solid var(--color-primary,#FF6B9D);background:transparent;color:var(--color-primary,#FF6B9D);border-radius:14px;padding:3px 10px;font-size:11px;cursor:pointer;font-family:inherit}' +
      '.mc-redpacket-bubble{display:flex;align-items:center;gap:10px;padding:10px 14px;border-radius:10px;background:linear-gradient(135deg,#fa5252,#ff8787);color:#fff;cursor:pointer;min-width:180px}' +
      '.mc-rp-icon{width:34px;height:34px;border-radius:6px;background:rgba(255,255,255,.25);display:flex;align-items:center;justify-content:center;font-weight:700}' +
      '.mc-rp-info{display:flex;flex-direction:column;font-size:13px}' +
      '.mc-rp-info small{font-size:11px;opacity:.85}' +
      '.mc-transfer-bubble{padding:10px 14px;border-radius:10px;background:#f7f7f7;min-width:160px}' +
      '.mc-tf-amount{font-weight:700;color:#fa5252;font-size:16px}' +
      '.mc-tf-note{font-size:12px;color:#888}' +
      '.mc-heart-voice{display:inline-flex;align-items:center;gap:5px;margin-top:6px;padding:3px 9px;border-radius:12px;background:rgba(255,107,157,.12);color:var(--color-primary,#FF6B9D);font-size:12px;cursor:pointer}' +
      '.mc-action-text{font-style:italic;color:#888;opacity:.9}' +
      /* ---- keyframes ---- */
      '@keyframes mmBar{0%{height:20%}100%{height:100%}}' +
      '@keyframes mmPulse{0%,100%{transform:scale(1);opacity:1}50%{transform:scale(1.06);opacity:.82}}' +
      '@keyframes mmPop{from{transform:scale(.96) translateY(6px);opacity:0}to{transform:scale(1) translateY(0);opacity:1}}' +
      '@keyframes mmFade{from{opacity:0}to{opacity:1}}';
    var style = document.createElement('style');
    style.id = 'mochi-media-styles';
    style.textContent = css;
    document.head.appendChild(style);
  }

  /* ================================================================
   * 1. Images
   * ================================================================ */
  function previewImage(url) {
    if (!url) return;
    var existing = $('mmImagePreview');
    if (existing) existing.remove();
    var ov = document.createElement('div');
    ov.className = 'mm-overlay mm-image-preview';
    ov.id = 'mmImagePreview';
    ov.innerHTML = '<button class="mm-close" type="button" aria-label="关闭">\u00d7</button>' +
      '<img class="mm-preview-img" src="' + esc(url) + '" alt="" />';
    ov.addEventListener('click', function () { ov.remove(); });
    document.body.appendChild(ov);
  }

  function sendImage(url) {
    if (!url) return;
    url = String(url).trim();
    if (!url) return;
    // [img:url] only matches http(s) URLs in the core parser; base64 data
    // URLs are carried via <img-msg url="..."> which the parser also reads.
    var tag = /^data:/i.test(url) ? '<img-msg url="' + url + '">' : '[img:' + url + ']';
    closeImagePicker();
    composeAndSend(tag);
  }

  function openImagePicker() {
    closeImagePicker();
    var ov = document.createElement('div');
    ov.className = 'mm-overlay mm-dialog-overlay';
    ov.id = 'mmImagePicker';
    ov.innerHTML =
      '<div class="mm-dialog">' +
        '<button class="mm-close" type="button">\u00d7</button>' +
        '<div class="mm-dialog-title">发送图片</div>' +
        '<input class="mm-input" id="mmImgUrl" type="url" placeholder="粘贴图片链接 https://..." />' +
        '<div class="mm-dialog-actions">' +
          '<button class="mm-btn mm-btn-primary" id="mmImgSend" type="button">发送链接</button>' +
          '<label class="mm-btn" for="mmImgFile">上传本地图片</label>' +
          '<input class="mm-file-hidden" id="mmImgFile" type="file" accept="image/*" hidden />' +
        '</div>' +
        '<div class="mm-dialog-hint">支持图片链接或本地上传（大图自动压缩为 JPEG）</div>' +
      '</div>';
    document.body.appendChild(ov);

    function done() { closeImagePicker(); }
    ov.addEventListener('click', function (e) { if (e.target === ov) done(); });
    var closeBtn = ov.querySelector('.mm-close');
    if (closeBtn) closeBtn.addEventListener('click', done);
    var sendBtn = ov.querySelector('#mmImgSend');
    if (sendBtn) sendBtn.addEventListener('click', function () {
      var u = (ov.querySelector('#mmImgUrl').value || '').trim();
      if (!u) { toast('请输入图片链接'); return; }
      sendImage(u);
    });
    var fileInput = ov.querySelector('#mmImgFile');
    if (fileInput) fileInput.addEventListener('change', function (e) {
      var f = e.target.files && e.target.files[0];
      if (!f) return;
      toast('处理图片中…');
      compressImage(f, 1280, 0.82, function (dataUrl) {
        if (!dataUrl) { toast('图片读取失败'); return; }
        sendImage(dataUrl);
      });
    });
    var urlInput = ov.querySelector('#mmImgUrl');
    if (urlInput) setTimeout(function () { urlInput.focus(); }, 50);
  }
  function closeImagePicker() { var el = $('mmImagePicker'); if (el) el.remove(); }

  function fileToDataUrl(file, cb) {
    var r = new FileReader();
    r.onload = function () { cb(r.result); };
    r.onerror = function () { cb(null); };
    r.readAsDataURL(file);
  }

  // Downscale large raster images so base64 does not blow up localStorage.
  function compressImage(file, maxDim, quality, cb) {
    if (!/^image\/(png|jpe?g|webp|bmp)$/i.test(file.type)) { fileToDataUrl(file, cb); return; }
    fileToDataUrl(file, function (dataUrl) {
      if (!dataUrl) { cb(null); return; }
      if (file.size < 500 * 1024) { cb(dataUrl); return; }
      var img = new Image();
      img.onload = function () {
        var scale = Math.min(1, maxDim / Math.max(img.width, img.height));
        if (scale >= 1) { cb(dataUrl); return; }
        var cw = Math.round(img.width * scale), ch = Math.round(img.height * scale);
        var canvas = document.createElement('canvas');
        canvas.width = cw; canvas.height = ch;
        try {
          var ctx = canvas.getContext('2d');
          ctx.drawImage(img, 0, 0, cw, ch);
          cb(canvas.toDataURL('image/jpeg', quality));
        } catch (e) { cb(dataUrl); }
      };
      img.onerror = function () { cb(dataUrl); };
      img.src = dataUrl;
    });
  }

  /* ================================================================
   * 2. Stickers / emoticons
   * ================================================================ */
  function openStickerPanel() {
    var existing = $('mmStickerPanel');
    if (existing) { existing.remove(); return; }
    var panel = document.createElement('div');
    panel.id = 'mmStickerPanel';
    panel.className = 'mm-sticker-panel';
    var html = '<div class="mm-sticker-head"><span>表情贴纸</span>' +
      '<button class="mm-sticker-mode" id="mmStickerMode" type="button">直接发送</button>' +
      '<button class="mm-close mm-close-sm" type="button">\u00d7</button></div><div class="mm-sticker-grid">';
    for (var i = 0; i < STICKERS.length; i++) {
      html += '<button class="mm-sticker-item" data-name="' + esc(STICKERS[i]) + '" type="button">' + stickerEmoji(STICKERS[i]) + '</button>';
    }
    html += '</div>';
    panel.innerHTML = html;
    document.body.appendChild(panel);

    var sendMode = true;
    var modeBtn = panel.querySelector('#mmStickerMode');
    if (modeBtn) modeBtn.addEventListener('click', function () {
      sendMode = !sendMode;
      modeBtn.textContent = sendMode ? '直接发送' : '插入输入框';
    });
    var closeBtn = panel.querySelector('.mm-close');
    if (closeBtn) closeBtn.addEventListener('click', function () { panel.remove(); });
    var items = panel.querySelectorAll('.mm-sticker-item');
    for (var j = 0; j < items.length; j++) {
      (function (btn) {
        btn.addEventListener('click', function () {
          var name = btn.getAttribute('data-name');
          if (sendMode) { sendSticker(name); panel.remove(); }
          else { insertText('[sticker:' + name + ']'); }
        });
      })(items[j]);
    }
    positionNearToolbar(panel, 340);
    dismissOnOutside(panel, null, function () { panel.remove(); });
  }

  function sendSticker(name) {
    if (!name) return;
    composeAndSend('[sticker:' + name + ']');
  }

  /* ================================================================
   * 3. Voice messages
   * ================================================================ */
  function pickMime() {
    if (typeof window.MediaRecorder === 'undefined') return '';
    var types = ['audio/webm;codecs=opus', 'audio/webm', 'audio/ogg;codecs=opus', 'audio/mp4', 'audio/mpeg'];
    for (var i = 0; i < types.length; i++) {
      try { if (MediaRecorder.isTypeSupported(types[i])) return types[i]; } catch (e) {}
    }
    return '';
  }

  function startRecord() {
    if (recState.active) { toast('正在录音…'); return; }
    if (!window.navigator || !navigator.mediaDevices || typeof navigator.mediaDevices.getUserMedia !== 'function') {
      toast('当前环境不支持语音录制'); return;
    }
    if (typeof window.MediaRecorder === 'undefined') { toast('当前浏览器不支持语音录制'); return; }
    if (!getRole()) { toast('请先选择一个角色'); return; }

    navigator.mediaDevices.getUserMedia({ audio: true }).then(function (stream) {
      recState.stream = stream;
      recState.chunks = [];
      var mime = pickMime();
      var rec;
      try { rec = mime ? new MediaRecorder(stream, { mimeType: mime }) : new MediaRecorder(stream); }
      catch (e) { rec = new MediaRecorder(stream); }
      recState.recorder = rec;
      rec.ondataavailable = function (e) { if (e.data && e.data.size) recState.chunks.push(e.data); };
      rec.onstop = onRecorderStop;
      rec.onerror = function () { toast('录音出错'); stopRecord(); };
      rec.start();
      recState.active = true;
      recState.start = Date.now();
      showRecordIndicator();
      recState.maxTimer = setTimeout(function () { if (recState.active) stopRecord(); }, 60000);
    }).catch(function (err) {
      var name = err && err.name;
      if (name === 'NotAllowedError' || name === 'SecurityError') toast('麦克风权限被拒绝，请在浏览器设置中允许');
      else if (name === 'NotFoundError' || name === 'DevicesNotFoundError') toast('未找到麦克风设备');
      else toast('无法访问麦克风：' + (err && err.message ? err.message : '未知错误'));
    });
  }

  function stopRecord() {
    if (!recState.active) return;
    recState.active = false;
    if (recState.maxTimer) { clearTimeout(recState.maxTimer); recState.maxTimer = null; }
    if (recState.timer) { clearInterval(recState.timer); recState.timer = null; }
    var rec = recState.recorder;
    if (rec && rec.state !== 'inactive') { try { rec.stop(); } catch (e) {} }
  }

  function toggleRecord() { if (recState.active) stopRecord(); else startRecord(); }

  function onRecorderStop() {
    if (recState.stream) {
      recState.stream.getTracks().forEach(function (t) { try { t.stop(); } catch (e) {} });
      recState.stream = null;
    }
    closeRecordIndicator();
    var duration = Math.max(1, Math.round((Date.now() - recState.start) / 1000));
    var mime = recState.recorder && recState.recorder.mimeType ? recState.recorder.mimeType : 'audio/webm';
    var blob = new Blob(recState.chunks, { type: mime });
    recState.chunks = [];
    recState.recorder = null;
    if (!blob || blob.size < 200) { toast('录音太短，已取消'); return; }

    var core = window.MochiCore;
    if (!core || !core.api || !core.api.post) { toast('API 不可用，无法上传'); return; }
    toast('正在上传语音…');
    var reader = new FileReader();
    reader.onload = function () {
      var dataUrl = reader.result;
      if (!dataUrl) { toast('语音处理失败'); return; }
      core.api.post('/voice/upload', { blob: dataUrl, duration: duration }).then(function (res) {
        var data = (res && res.data) || {};
        var id = data.id;
        if (!id) { toast((res && res.message) || '语音上传失败'); return; }
        composeAndSend('[voice:' + id + '|' + (data.duration || duration) + ']');
      }).catch(function () { toast('语音上传失败，请重试'); });
    };
    reader.onerror = function () { toast('语音处理失败'); };
    reader.readAsDataURL(blob);
  }

  function showRecordIndicator() {
    closeRecordIndicator();
    var el = document.createElement('div');
    el.className = 'mm-record-indicator';
    el.id = 'mmRecordIndicator';
    el.innerHTML = '<span class="mm-record-dot"></span><span class="mm-record-label">录音中</span>' +
      '<span class="mm-record-timer" id="mmRecordTimer">00:00</span>' +
      '<button class="mm-btn mm-btn-danger" type="button">停止并发送</button>';
    document.body.appendChild(el);
    var stopBtn = el.querySelector('button');
    if (stopBtn) stopBtn.addEventListener('click', stopRecord);
    recState.timer = setInterval(function () {
      var s = Math.floor((Date.now() - recState.start) / 1000);
      var t = $('mmRecordTimer');
      if (t) t.textContent = pad2(Math.floor(s / 60)) + ':' + pad2(s % 60);
    }, 500);
  }
  function closeRecordIndicator() { var el = $('mmRecordIndicator'); if (el) el.remove(); }

  function playVoice(id, element) {
    if (!id) return;
    stopCurrentVoice();
    var core = window.MochiCore;
    if (!core || !core.api || !core.api.get) { toast('API 不可用'); return; }
    if (!element) element = document.querySelector('.mc-voice-bubble');
    var bar = element ? element.querySelector('.mc-voice-bar') : null;
    var durEl = element ? element.querySelector('.mc-voice-dur') : null;
    var origBarHtml = bar ? bar.innerHTML : '';
    var origDur = durEl ? durEl.textContent : '';
    var N = 20;
    var wave = document.createElement('span');
    wave.className = 'mm-voice-wave';
    for (var i = 0; i < N; i++) {
      var b = document.createElement('i');
      b.style.animationDelay = (i * 40) + 'ms';
      wave.appendChild(b);
    }
    if (bar) { bar.innerHTML = ''; bar.appendChild(wave); }
    if (element) element.classList.add('mm-voice-playing');
    if (durEl) durEl.textContent = '...';

    function restore() {
      if (bar && bar.isConnected) bar.innerHTML = origBarHtml;
      if (durEl && durEl.isConnected) durEl.textContent = origDur;
      if (element) element.classList.remove('mm-voice-playing');
      if (voiceState.audio) { try { voiceState.audio.pause(); } catch (e) {} }
      voiceState.audio = null;
      voiceState.restore = null;
    }
    voiceState.restore = restore;

    core.api.get('/voice/' + encodeURIComponent(id)).then(function (res) {
      var data = (res && res.data) || {};
      if (!data.blob) { toast((res && res.message) || '语音加载失败'); restore(); return; }
      var AudioCtor = window.Audio;
      if (typeof AudioCtor !== 'function') { toast('当前环境不支持音频播放'); restore(); return; }
      var audio;
      try { audio = new AudioCtor(data.blob); }
      catch (e) { toast('音频加载失败'); restore(); return; }
      voiceState.audio = audio;
      audio.addEventListener('timeupdate', function () {
        if (!audio.duration) return;
        var filled = Math.round((audio.currentTime / audio.duration) * N);
        var bars = wave.children;
        for (var k = 0; k < bars.length; k++) {
          if (k < filled) bars[k].classList.add('mm-bar-played');
          else bars[k].classList.remove('mm-bar-played');
        }
      });
      audio.addEventListener('ended', restore);
      audio.addEventListener('error', function () { toast('语音播放失败'); restore(); });
      if (durEl && data.duration) durEl.textContent = data.duration + '"';
      try {
        var p = audio.play();
        if (p && typeof p.catch === 'function') p.catch(function () { toast('无法播放语音'); restore(); });
      } catch (e) { toast('无法播放语音'); restore(); }
    }).catch(function () { toast('语音加载失败'); restore(); });
  }

  function stopCurrentVoice() { if (voiceState.restore) voiceState.restore(); }

  /* ================================================================
   * 4. Call simulation
   * ================================================================ */
  function startCall(type) {
    type = (type === 'video') ? 'video' : 'audio';
    if (callState.overlay) { toast('正在通话中'); return; }
    var role = getRole();
    if (!role) { toast('请先选择一个角色'); return; }
    closeMenusAndPanels();
    callState.type = type;
    callState.connected = false;
    callState.connectedAt = 0;

    var ov = document.createElement('div');
    ov.className = 'mm-overlay mm-call-overlay' + (type === 'video' ? ' mm-call-video' : '');
    ov.id = 'mmCallOverlay';
    var ava = role.avatar
      ? '<img class="mm-call-avatar-img" src="' + esc(role.avatar) + '" alt="" />'
      : '<div class="mm-call-avatar-initial">' + esc((role.name || '?').slice(0, 1)) + '</div>';
    ov.innerHTML =
      '<div class="mm-call-content">' +
        '<div class="mm-call-type">' + (type === 'video' ? '视频通话' : '语音通话') + '</div>' +
        '<div class="mm-call-avatar">' + ava + '</div>' +
        '<div class="mm-call-name">' + esc(role.name || '') + '</div>' +
        '<div class="mm-call-status" id="mmCallStatus">正在呼叫…</div>' +
        '<div class="mm-call-timer" id="mmCallTimer">00:00</div>' +
        '<button class="mm-call-end" id="mmCallEnd" type="button">\u2316 挂断</button>' +
      '</div>';
    document.body.appendChild(ov);
    callState.overlay = ov;

    var endBtn = ov.querySelector('#mmCallEnd');
    if (endBtn) endBtn.addEventListener('click', function () { endCall(); });

    callState.connectTimer = setTimeout(function () {
      if (!callState.overlay) return;
      callState.connected = true;
      callState.connectedAt = Date.now();
      var st = $('mmCallStatus');
      if (st) st.textContent = '通话中';
      callState.timer = setInterval(updateCallTimer, 500);
      updateCallTimer();
    }, 1800);
  }

  function updateCallTimer() {
    if (!callState.connectedAt) return;
    var s = Math.floor((Date.now() - callState.connectedAt) / 1000);
    var t = $('mmCallTimer');
    if (t) t.textContent = pad2(Math.floor(s / 60)) + ':' + pad2(s % 60);
  }

  function endCall(duration) {
    if (!callState.overlay) return;
    var type = callState.type;
    if (duration == null) {
      duration = callState.connectedAt ? Math.floor((Date.now() - callState.connectedAt) / 1000) : 0;
    }
    if (callState.timer) { clearInterval(callState.timer); callState.timer = null; }
    if (callState.connectTimer) { clearTimeout(callState.connectTimer); callState.connectTimer = null; }
    var ov = callState.overlay;
    callState.overlay = null;
    callState.connected = false;
    callState.connectedAt = 0;
    if (ov) ov.remove();

    pushUserMessage('[call:' + type + '|' + duration + ']');
  }

  /* ================================================================
   * 5. Rich HTML cards
   * ================================================================ */
  // Sanitize arbitrary HTML for safe rendering inside a chat bubble.
  // Returns an HTML string (or a DOM node if opts.container is true).
  function renderCard(html, opts) {
    opts = opts || {};
    var raw = html == null ? '' : String(html);
    var doc;
    try { doc = new DOMParser().parseFromString(raw, 'text/html'); }
    catch (e) {
      var d = document.createElement('div');
      d.textContent = raw;
      return opts.container ? d : d.innerHTML;
    }
    var strip = doc.querySelectorAll('script,style,iframe,object,embed,link,meta,base,form,input,button');
    for (var i = strip.length - 1; i >= 0; i--) strip[i].remove();
    var all = doc.querySelectorAll('*');
    for (var j = 0; j < all.length; j++) {
      var el = all[j];
      var attrs = el.attributes;
      for (var k = attrs.length - 1; k >= 0; k--) {
        var an = attrs[k].name.toLowerCase();
        var av = attrs[k].value || '';
        if (an.indexOf('on') === 0) { el.removeAttribute(attrs[k].name); continue; }
        if ((an === 'href' || an === 'src' || an === 'xlink:href') && /^\s*javascript:/i.test(av)) {
          el.removeAttribute(attrs[k].name);
        }
      }
      // Force external links to open safely in a new tab.
      if (el.tagName === 'A') { el.setAttribute('target', '_blank'); el.setAttribute('rel', 'noopener noreferrer'); }
    }
    var body = doc.body || doc.documentElement;
    var inner = body.innerHTML;
    if (opts.container) {
      var div = document.createElement('div');
      div.className = 'mm-card-content';
      div.innerHTML = inner;
      return div;
    }
    return inner;
  }

  /* ================================================================
   * Bubble rendering enhancement
   * The host app renders user messages as plain escaped text, and
   * MochiCore only enhances assistant bubbles. This pass renders rich
   * tags inside USER bubbles (so sent images/stickers/voice/calls show
   * up as real media) and upgrades <card> bodies to rich HTML.
   * ================================================================ */
  function renderSegmentRich(seg, msg) {
    var core = window.MochiCore;
    var cardExtras = [];
    var otherExtras = [];
    (seg.extras || []).forEach(function (e) { if (e.kind === 'card') cardExtras.push(e); else otherExtras.push(e); });
    var segClone = { type: seg.type, content: seg.content, extras: otherExtras };
    var html = (seg.content || otherExtras.length) ? core.renderBubbleContent(segClone, msg) : '';
    for (var i = 0; i < cardExtras.length; i++) {
      var card = cardExtras[i];
      html += '<div class="mc-card-bubble mm-card" data-type="' + esc(card.type || '') + '">' +
        (card.title ? '<div class="mc-card-title">' + esc(card.title) + '</div>' : '') +
        '<div class="mc-card-body mm-card-body">' + renderCard(card.body || '') + '</div>' +
        '</div>';
    }
    return html;
  }

  function renderFullBubble(bubble, msg, mode) {
    var core = window.MochiCore;
    var parsed = core.parseContent(msg.content, { mode: mode });
    var html = '';
    if (parsed.segments && parsed.segments.length) {
      for (var i = 0; i < parsed.segments.length; i++) {
        if (i > 0) html += '<div class="mc-bubble-divider"></div>';
        html += renderSegmentRich(parsed.segments[i], msg);
      }
    }
    if (msg.role === 'assistant' && parsed.heart) {
      var role = getRole();
      html += '<div class="mc-heart-voice" onclick="if(window.MochiSocial&amp;&amp;MochiSocial.showHeartVoice)MochiSocial.showHeartVoice(\'' + esc(role ? role.id : '') + '\')">' +
        '<svg viewBox="0 0 24 24" width="14" height="14"><path d="M12 21l-1.45-1.32C5.4 15.36 2 12.28 2 8.5 2 5.42 4.42 3 7.5 3c1.74 0 3.41.81 4.5 2.09C13.09 3.81 14.76 3 16.5 3 19.58 3 22 5.42 22 8.5c0 3.78-3.4 6.86-8.55 11.18L12 21z" fill="currentColor"/></svg>' +
        '<span>' + esc(parsed.heart) + '</span></div>';
    }
    if (html.trim()) bubble.innerHTML = html;
  }

  function enhanceBubbles() {
    var list = $('messageList');
    if (!list) return;
    var core = window.MochiCore;
    if (!core || typeof core.parseContent !== 'function' || typeof core.renderBubbleContent !== 'function') return;
    var role = getRole();
    var messages = role ? getMsgs(role.id) : null;
    if (!messages) return;
    var mode = chatMode();
    var coreActive = !!window._mochiEnhanced;
    var rows = list.querySelectorAll('[data-msg-id]');
    for (var r = 0; r < rows.length; r++) {
      var row = rows[r];
      var msgId = row.getAttribute('data-msg-id');
      var msg = null;
      for (var m = 0; m < messages.length; m++) { if (messages[m].id === msgId) { msg = messages[m]; break; } }
      if (!msg || !msg.content) continue;
      var bubble = row.querySelector('.qq-room__bubble');
      if (!bubble) continue;
      var content = msg.content;
      var isUser = msg.role === 'user';
      var should;
      if (isUser) {
        should = RE_RICH.test(content);
      } else {
        should = RE_CARD_COMPLETE.test(content) || (!coreActive && RE_RICH.test(content));
      }
      if (!should) continue;
      try { renderFullBubble(bubble, msg, mode); } catch (e) { /* leave default */ }
    }
  }

  function scheduleEnhance() {
    if (enhanceScheduled) return;
    enhanceScheduled = true;
    var run = function () { enhanceScheduled = false; try { enhanceBubbles(); } catch (e) {} };
    if (window.requestAnimationFrame) requestAnimationFrame(run);
    else setTimeout(run, 16);
  }

  function setupEnhancer() {
    var list = $('messageList');
    if (list && !list.__mmObs) {
      list.__mmObs = true;
      try {
        var obs = new MutationObserver(scheduleEnhance);
        obs.observe(list, { childList: true, subtree: true });
      } catch (e) {}
      try { enhanceBubbles(); } catch (e) {}
      return true;
    }
    return false;
  }

  /* ================================================================
   * Media menu + toolbar wiring
   * ================================================================ */
  function closeMenusAndPanels() {
    var m = $('mmMediaMenu'); if (m) m.remove();
    var p = $('mmStickerPanel'); if (p) p.remove();
  }

  function openMediaMenu() {
    var existing = $('mmMediaMenu');
    if (existing) { existing.remove(); return; }
    var btn = $('chatToolsBtn');
    var menu = document.createElement('div');
    menu.id = 'mmMediaMenu';
    menu.className = 'mm-media-menu';
    var items = [
      { k: 'image', label: '图片', icon: '\ud83d\uddbc\ufe0f' },
      { k: 'sticker', label: '表情', icon: '\ud83d\ude00' },
      { k: 'voice', label: '语音', icon: '\ud83c\udfa4' },
      { k: 'call-audio', label: '语音通话', icon: '\ud83d\udcde' },
      { k: 'call-video', label: '视频通话', icon: '\ud83d\udcf9' }
    ];
    var html = '';
    for (var i = 0; i < items.length; i++) {
      html += '<button type="button" data-mm-act="' + items[i].k + '" class="mm-media-item">' +
        '<span class="mm-media-icon">' + items[i].icon + '</span><span>' + items[i].label + '</span></button>';
    }
    menu.innerHTML = html;
    document.body.appendChild(menu);
    positionNearToolbar(menu, 260);

    var btns = menu.querySelectorAll('[data-mm-act]');
    for (var j = 0; j < btns.length; j++) {
      (function (b) {
        b.addEventListener('click', function () {
          var k = b.getAttribute('data-mm-act');
          menu.remove();
          if (k === 'image') openImagePicker();
          else if (k === 'sticker') openStickerPanel();
          else if (k === 'voice') toggleRecord();
          else if (k === 'call-audio') startCall('audio');
          else if (k === 'call-video') startCall('video');
        });
      })(btns[j]);
    }
    dismissOnOutside(menu, btn, function () { menu.remove(); });
  }

  function attachToolbar(btn) {
    // MochiUI handles the tools button via event delegation
    // We only provide the media methods for the tools panel to call
  }

  /* ---- shared positioning / dismissal helpers ---- */
  function positionNearToolbar(el, width) {
    var btn = $('chatToolsBtn');
    if (!btn) { el.style.left = '12px'; el.style.bottom = '80px'; return; }
    var r = btn.getBoundingClientRect();
    var left = Math.max(8, Math.min(r.left, window.innerWidth - (width || 280) - 8));
    el.style.left = left + 'px';
    el.style.bottom = (window.innerHeight - r.top + 8) + 'px';
  }

  function dismissOnOutside(el, exclude, onClose) {
    setTimeout(function () {
      function handler(e) {
        if (!el.parentNode) { document.removeEventListener('click', handler, true); return; }
        if (el.contains(e.target)) return;
        if (exclude && exclude.contains(e.target)) return;
        document.removeEventListener('click', handler, true);
        onClose();
      }
      document.addEventListener('click', handler, true);
    }, 0);
  }

  /* ================================================================
   * Init + public API
   * ================================================================ */
  function init() {
    if (window._mochiMediaReady) return;
    window._mochiMediaReady = true;
    injectStyles();
    attachToolbar();
    if (!setupEnhancer()) {
      // #messageList may mount later; retry a couple of times.
      var tries = 0;
      var t = setInterval(function () {
        tries++;
        if (setupEnhancer() || tries > 20) clearInterval(t);
      }, 300);
    }
  }

  window.MochiMedia = {
    // images
    previewImage: previewImage,
    sendImage: sendImage,
    openImagePicker: openImagePicker,
    // stickers
    openStickerPanel: openStickerPanel,
    sendSticker: sendSticker,
    // voice
    startRecord: startRecord,
    stopRecord: stopRecord,
    toggleRecord: toggleRecord,
    playVoice: playVoice,
    // calls
    startCall: startCall,
    endCall: endCall,
    // text + cards + misc
    insertText: insertText,
    renderCard: renderCard,
    attachToolbar: attachToolbar,
    closeMenus: closeMenusAndPanels,
    init: init,
    // internal hook used by the enhancer (also handy for debugging)
    enhanceBubbles: enhanceBubbles
  };

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();
