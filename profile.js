/**
 * MochiSocial - 社交功能模块（心声 / 情诗 / 朋友圈 / 群聊 / 红包 / 钱包 / 翻译 / 通知）
 * 独立 IIFE，仅挂载到 window.MochiSocial，依赖 window.MochiCore 与全局聊天方法。
 * 样式自包含：注入一次 <style>，配合行内 style，粉色治愈主题（主色 #FF6B9D）。
 */
(function () {
  'use strict';

  var MochiSocial = { version: '1.0.0', _hvMem: {} };

  /* ===== 依赖（带降级）===== */
  var api = (window.MochiCore && window.MochiCore.api) || null;
  var store = (window.MochiCore && window.MochiCore.store) || {
    get: function (k, d) { try { var v = localStorage.getItem('mc_' + k); return v ? JSON.parse(v) : (d !== undefined ? d : null); } catch (e) { return d !== undefined ? d : null; } },
    set: function (k, v) { try { localStorage.setItem('mc_' + k, JSON.stringify(v)); } catch (e) {} },
    remove: function (k) { try { localStorage.removeItem('mc_' + k); } catch (e) {} }
  };
  function esc(s) {
    if (window.MochiCore && window.MochiCore.escapeHtml) return window.MochiCore.escapeHtml(s);
    return String(s == null ? '' : s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#039;');
  }
  function toast(msg) {
    if (window.MochiCore && window.MochiCore.toast) return window.MochiCore.toast(msg);
    if (typeof window.toast === 'function') return window.toast(msg);
  }
  function each(list, fn) { for (var i = 0; i < list.length; i++) fn(list[i], i); }
  function uuid() { return 'ms-' + Date.now().toString(36) + '-' + Math.random().toString(36).slice(2, 8); }

  /* ===== 全局信息辅助 ===== */
  function activeRoleSafe() { try { return window.activeRole ? window.activeRole() : null; } catch (e) { return null; } }
  function roleById(id) {
    var roles = (window.state && window.state.roles) || [];
    for (var i = 0; i < roles.length; i++) if (roles[i].id === id) return roles[i];
    return null;
  }
  function roleByName(name) {
    var roles = (window.state && window.state.roles) || [];
    for (var i = 0; i < roles.length; i++) if (roles[i].name === name) return roles[i];
    return null;
  }
  function roleAvatar(role) {
    if (!role) return avatarFor('AI', '');
    if (role.avatar) return role.avatar;
    return avatarFor(role.name, role.avatar);
  }
  function avatarFor(name, seed) { try { if (window.avatarOf) return window.avatarOf(name, seed); } catch (e) {} return ''; }
  function currentUser() {
    var u = (window.state && window.state.user) || {};
    return { nickname: u.nickname || '我', avatar: u.avatar || '', bio: u.bio || '' };
  }
  function getUserId() {
    var u = currentUser();
    if (u.nickname && u.nickname !== '我') return u.nickname;
    var id = store.get('uid', null);
    if (!id) { id = 'u' + uuid(); store.set('uid', id); }
    return id;
  }
  function formatTime(ts) {
    if (!ts) return '';
    var d = ts instanceof Date ? ts : new Date(ts);
    if (isNaN(d.getTime())) return '';
    var diff = (Date.now() - d.getTime()) / 1000;
    if (diff < 60) return '刚刚';
    if (diff < 3600) return Math.floor(diff / 60) + '分钟前';
    if (diff < 86400) return Math.floor(diff / 3600) + '小时前';
    if (diff < 604800) return Math.floor(diff / 86400) + '天前';
    return (d.getMonth() + 1) + '月' + d.getDate() + '日';
  }

  /* ===== 样式注入（自包含，仅注入一次）===== */
  var _stylesInjected = false;
  function injectStyles() {
    if (_stylesInjected) return;
    _stylesInjected = true;
    var css = ''
      + '.ms-overlay{position:fixed;inset:0;background:rgba(91,58,74,.45);backdrop-filter:blur(3px);-webkit-backdrop-filter:blur(3px);display:flex;align-items:flex-end;justify-content:center;z-index:100000;opacity:0;transition:opacity .25s}'
      + '.ms-overlay.ms-show{opacity:1}'
      + '.ms-overlay-bare{align-items:center;justify-content:center}'
      + '.ms-overlay-full{align-items:stretch}'
      + '.ms-modal{background:#fff;width:100%;max-width:440px;max-height:86vh;border-radius:22px 22px 0 0;box-shadow:0 -8px 40px rgba(255,107,157,.25);display:flex;flex-direction:column;overflow:hidden;transform:translateY(40px);transition:transform .28s cubic-bezier(.2,.8,.2,1)}'
      + '.ms-overlay.ms-show .ms-modal{transform:translateY(0)}'
      + '.ms-modal-wide{max-width:480px}'
      + '.ms-modal-full{max-width:100%;max-height:100vh;height:100vh;border-radius:0}'
      + '.ms-modal>.ms-panel,.ms-modal>.ms-moments{flex:1;min-height:0}'
      + '.ms-panel{display:flex;flex-direction:column;height:100%}'
      + '.ms-head{display:flex;align-items:flex-start;justify-content:space-between;padding:16px 18px;border-bottom:1px solid #FFE4EE;flex:0 0 auto}'
      + '.ms-head-titles h3{margin:0;font-size:17px;color:#5b3a4a;font-weight:700}'
      + '.ms-head-titles small{display:block;color:#FF8FB1;font-size:12px;margin-top:2px}'
      + '.ms-close{border:0;background:#FFF0F5;color:#FF6B9D;width:32px;height:32px;border-radius:50%;font-size:20px;line-height:1;cursor:pointer;transition:background .2s;flex:0 0 auto}'
      + '.ms-close:hover{background:#FFD6E0}'
      + '.ms-body{padding:16px 18px;overflow-y:auto;flex:1 1 auto;-webkit-overflow-scrolling:touch}'
      + '.ms-foot{padding:12px 18px;border-top:1px solid #FFE4EE;display:flex;gap:10px;justify-content:flex-end;flex:0 0 auto}'
      + '.ms-btn{border:0;border-radius:999px;padding:10px 20px;font-size:14px;font-weight:600;cursor:pointer;transition:transform .15s,box-shadow .2s;font-family:inherit}'
      + '.ms-btn:active{transform:scale(.96)}'
      + '.ms-btn-primary{background:linear-gradient(135deg,#FF6B9D,#FF8FB1);color:#fff;box-shadow:0 4px 12px rgba(255,107,157,.35)}'
      + '.ms-btn-light{background:#FFF0F5;color:#FF6B9D;border:1px solid #FFD6E0}'
      + '.ms-btn-ghost{background:#f5f5f5;color:#666}'
      + '.ms-btn-sm{padding:6px 14px;font-size:12px}'
      + '.ms-input,.ms-textarea{width:100%;box-sizing:border-box;border:1px solid #FFD6E0;border-radius:12px;padding:10px 12px;font-size:14px;color:#5b3a4a;background:#fff;outline:none;transition:border-color .2s;font-family:inherit}'
      + '.ms-input:focus,.ms-textarea:focus{border-color:#FF6B9D}'
      + '.ms-textarea{resize:vertical;min-height:48px}'
      + '.ms-input-sm{padding:6px 10px;font-size:13px}'
      + '.ms-loading{display:flex;align-items:center;justify-content:center;gap:8px;color:#FF8FB1;padding:30px 0;font-size:14px}'
      + '.ms-spinner{width:18px;height:18px;border:2px solid #FFD6E0;border-top-color:#FF6B9D;border-radius:50%;animation:ms-spin .7s linear infinite}'
      + '.ms-empty{text-align:center;color:#bbb;padding:36px 10px;font-size:14px;line-height:1.6}'
      + '@keyframes ms-spin{to{transform:rotate(360deg)}}'
      /* 心声 */
      + '.ms-heart-list{display:flex;flex-direction:column;gap:12px}'
      + '.ms-heart-item{position:relative;background:linear-gradient(135deg,#FFF0F5,#FFF5F7);border-radius:16px;padding:14px 16px 12px 40px;border:1px solid #FFE4EE}'
      + '.ms-heart-quote{position:absolute;left:12px;top:6px;font-size:38px;color:#FFC4D6;font-family:Georgia,serif;line-height:1}'
      + '.ms-heart-text{color:#5b3a4a;font-size:14px;line-height:1.7;white-space:pre-wrap;word-break:break-word}'
      + '.ms-heart-time{margin-top:8px;color:#FF8FB1;font-size:11px;text-align:right}'
      /* 情诗 */
      + '.ms-poem-list{display:flex;flex-direction:column;gap:14px}'
      + '.ms-poem-card{background:linear-gradient(135deg,#FFF5F7,#FFF0F5);border:1px solid #FFE4EE;border-radius:16px;padding:18px}'
      + '.ms-poem-title{color:#FF6B9D;font-size:15px;font-weight:700;margin-bottom:8px}'
      + '.ms-poem-content{color:#5b3a4a;font-size:14px;line-height:1.9;white-space:pre-wrap;font-style:italic}'
      + '.ms-poem-time{margin-top:10px;color:#FF8FB1;font-size:11px;text-align:right}'
      /* 朋友圈 */
      + '.ms-moments{display:flex;flex-direction:column;height:100%;background:#f5f5f7}'
      + '.ms-moments-head{display:flex;align-items:center;justify-content:space-between;padding:12px 14px;background:#fff;border-bottom:1px solid #eee;flex:0 0 auto}'
      + '.ms-moments-head h3{margin:0;font-size:16px;color:#5b3a4a}'
      + '.ms-icon-btn{border:0;background:transparent;color:#FF6B9D;font-size:22px;cursor:pointer;width:34px;height:34px;border-radius:50%;display:flex;align-items:center;justify-content:center}'
      + '.ms-icon-btn:hover{background:#FFF0F5}'
      + '.ms-icon-spacer{width:34px;height:34px;flex:0 0 auto}'
      + '.ms-moments-cover{height:120px;background:linear-gradient(135deg,#FF6B9D,#FFB6C1);position:relative;flex:0 0 auto}'
      + '.ms-moments-me{position:absolute;right:14px;bottom:-26px;display:flex;align-items:center;gap:8px;background:#fff;padding:4px 14px 4px 4px;border-radius:14px;box-shadow:0 2px 10px rgba(0,0,0,.1)}'
      + '.ms-moments-me-avatar{width:46px;height:46px;border-radius:10px;object-fit:cover}'
      + '.ms-moments-me span{color:#5b3a4a;font-weight:600;font-size:14px}'
      + '.ms-moments-body{flex:1;overflow-y:auto;padding:38px 12px 20px;-webkit-overflow-scrolling:touch}'
      + '.ms-mom-composer{background:#fff;border-radius:14px;padding:12px;margin-bottom:12px;box-shadow:0 1px 4px rgba(0,0,0,.04)}'
      + '.ms-mom-composer-foot{display:flex;align-items:center;justify-content:space-between;margin-top:8px}'
      + '.ms-hint{color:#bbb;font-size:12px}'
      + '.ms-mom-item{display:flex;gap:10px;background:#fff;border-radius:14px;padding:14px;margin-bottom:12px;box-shadow:0 1px 4px rgba(0,0,0,.04)}'
      + '.ms-mom-avatar{width:42px;height:42px;border-radius:8px;object-fit:cover;flex:0 0 auto;background:#FFE4EE}'
      + '.ms-mom-main{flex:1;min-width:0}'
      + '.ms-mom-name{color:#FF6B9D;font-weight:700;font-size:14px;margin-bottom:4px}'
      + '.ms-mom-text{color:#333;font-size:14px;line-height:1.6;white-space:pre-wrap;word-break:break-word}'
      + '.ms-mom-imgs{display:grid;grid-template-columns:repeat(3,1fr);gap:5px;margin-top:8px}'
      + '.ms-mom-imgs.one{display:block;max-width:72%}'
      + '.ms-mom-imgs img{width:100%;aspect-ratio:1;object-fit:cover;border-radius:6px;cursor:pointer;background:#f5f5f5}'
      + '.ms-mom-imgs.one img{aspect-ratio:auto;max-height:200px;border-radius:8px}'
      + '.ms-mom-bar{display:flex;align-items:center;justify-content:space-between;margin-top:10px}'
      + '.ms-mom-time{color:#bbb;font-size:12px}'
      + '.ms-mom-actions{display:flex;gap:6px}'
      + '.ms-mom-act{border:0;background:#FFF0F5;color:#FF6B9D;border-radius:8px;padding:4px 10px;font-size:12px;cursor:pointer}'
      + '.ms-mom-act:hover{background:#FFD6E0}'
      + '.ms-mom-box{background:#f7f7f7;border-radius:8px;padding:8px 10px;margin-top:8px}'
      + '.ms-mom-likes{color:#FF6B9D;font-size:13px;margin-bottom:4px;word-break:break-all}'
      + '.ms-mom-comment{color:#333;font-size:13px;line-height:1.5;padding:1px 0;word-break:break-word}'
      + '.ms-mom-comment b{color:#FF6B9D;font-weight:600}'
      + '.ms-mom-comment-input{display:flex;gap:6px;margin-top:8px}'
      /* 群聊 */
      + '.ms-group-list{display:flex;flex-direction:column;gap:10px}'
      + '.ms-group-item{display:flex;align-items:center;gap:12px;background:#fff;border:1px solid #FFE4EE;border-radius:14px;padding:12px 14px}'
      + '.ms-group-icon{width:44px;height:44px;border-radius:12px;background:linear-gradient(135deg,#FF6B9D,#FFB6C1);color:#fff;display:flex;align-items:center;justify-content:center;font-size:20px;font-weight:700;flex:0 0 auto}'
      + '.ms-group-info{flex:1;min-width:0}'
      + '.ms-group-name{color:#5b3a4a;font-weight:700;font-size:15px}'
      + '.ms-group-members{display:flex;align-items:center;margin-top:6px}'
      + '.ms-group-av{width:22px;height:22px;border-radius:50%;border:2px solid #fff;object-fit:cover;margin-left:-6px;background:#FFE4EE}'
      + '.ms-group-av:first-child{margin-left:0}'
      + '.ms-group-count{color:#999;font-size:12px;margin-left:8px}'
      + '.ms-group-time{color:#bbb;font-size:11px;flex:0 0 auto}'
      + '.ms-check-list{display:flex;flex-direction:column;gap:8px}'
      + '.ms-check{display:flex;align-items:center;gap:10px;padding:8px 10px;border:1px solid #FFE4EE;border-radius:12px;cursor:pointer}'
      + '.ms-check input{accent-color:#FF6B9D}'
      + '.ms-check-av{width:30px;height:30px;border-radius:50%;object-fit:cover}'
      + '.ms-check span{color:#5b3a4a;font-size:14px}'
      /* 红包 */
      + '.ms-rp-overlay{display:flex;align-items:center;justify-content:center;height:100%;width:100%}'
      + '.ms-rp-envelope{width:280px;height:360px;border-radius:18px;background:linear-gradient(160deg,#E84855,#FF6B9D);position:relative;overflow:hidden;box-shadow:0 10px 40px rgba(232,72,85,.45);display:flex;flex-direction:column;align-items:center;justify-content:center;color:#fff;animation:ms-rp-in .4s ease}'
      + '@keyframes ms-rp-in{from{transform:scale(.8);opacity:0}to{transform:scale(1);opacity:1}}'
      + '.ms-rp-flap{position:absolute;top:0;left:0;right:0;height:96px;background:linear-gradient(160deg,#ff7a8a,#FF6B9D);transition:transform .6s;transform-origin:top;z-index:3}'
      + '.ms-rp-open .ms-rp-flap{transform:rotateX(180deg)}'
      + '.ms-rp-body{position:relative;z-index:2;display:flex;flex-direction:column;align-items:center;gap:8px;padding-top:44px}'
      + '.ms-rp-logo{font-size:54px;line-height:1}'
      + '.ms-rp-greeting{font-size:22px;font-weight:700;letter-spacing:2px}'
      + '.ms-rp-note{font-size:13px;opacity:.92;max-width:220px;text-align:center}'
      + '.ms-rp-open-btn{margin-top:16px;width:64px;height:64px;border-radius:50%;border:3px solid #fff;background:rgba(255,255,255,.18);color:#fff;font-size:24px;font-weight:700;cursor:pointer;animation:ms-pulse 1.4s ease-in-out infinite}'
      + '@keyframes ms-pulse{0%,100%{box-shadow:0 0 0 0 rgba(255,255,255,.5)}50%{box-shadow:0 0 0 14px rgba(255,255,255,0)}}'
      + '.ms-rp-result{display:flex;flex-direction:column;align-items:center;justify-content:center;color:#fff;text-align:center;background:linear-gradient(160deg,#E84855,#FF6B9D);width:280px;height:360px;border-radius:18px;box-shadow:0 10px 40px rgba(232,72,85,.45);animation:ms-rp-in .4s ease}'
      + '.ms-rp-coins{font-size:50px;line-height:1}'
      + '.ms-rp-amount{font-size:36px;font-weight:800;margin-top:8px}'
      + '.ms-rp-note2{font-size:13px;opacity:.92;margin-top:6px;max-width:220px}'
      + '.ms-rp-from{font-size:12px;opacity:.8;margin-top:4px}'
      + '.ms-rp-sent{display:flex;align-items:center;gap:10px;background:linear-gradient(135deg,#E84855,#FF6B9D);color:#fff;border-radius:12px;padding:12px 14px;max-width:220px;box-shadow:0 4px 12px rgba(232,72,85,.3)}'
      + '.ms-rp-sent-icon{font-size:28px;line-height:1}'
      + '.ms-rp-sent-info{display:flex;flex-direction:column}'
      + '.ms-rp-sent-info span{font-weight:700;font-size:14px}'
      + '.ms-rp-sent-info small{font-size:11px;opacity:.92}'
      /* 钱包 */
      + '.ms-wallet-card{background:linear-gradient(135deg,#FF6B9D,#FF8FB1);border-radius:18px;padding:22px;color:#fff;text-align:center;margin-bottom:18px;box-shadow:0 8px 24px rgba(255,107,157,.3)}'
      + '.ms-wallet-label{font-size:13px;opacity:.9}'
      + '.ms-wallet-balance{font-size:34px;font-weight:800;margin:6px 0 14px}'
      + '.ms-wallet-section{margin-top:6px}'
      + '.ms-section-title{color:#999;font-size:13px;margin-bottom:10px}'
      + '.ms-tx-list{display:flex;flex-direction:column;gap:8px}'
      + '.ms-tx-item{display:flex;align-items:center;gap:12px;background:#fff;border:1px solid #f0f0f0;border-radius:12px;padding:12px 14px}'
      + '.ms-tx-icon{width:36px;height:36px;border-radius:50%;display:flex;align-items:center;justify-content:center;font-size:16px;font-weight:700;flex:0 0 auto}'
      + '.ms-tx-icon.in{background:#E8F5E9;color:#2e7d32}'
      + '.ms-tx-icon.out{background:#FFF0F5;color:#E84855}'
      + '.ms-tx-main{flex:1;min-width:0}'
      + '.ms-tx-title{color:#333;font-size:14px;font-weight:600;word-break:break-word}'
      + '.ms-tx-time{color:#bbb;font-size:11px;margin-top:2px}'
      + '.ms-tx-amount{font-size:15px;font-weight:700;flex:0 0 auto}'
      + '.ms-tx-amount.in{color:#2e7d32}'
      + '.ms-tx-amount.out{color:#E84855}'
      /* 分段选择 / 翻译 / 通知 / 预览 */
      + '.ms-seg{display:flex;background:#FFF0F5;border-radius:10px;padding:3px}'
      + '.ms-seg-btn{flex:1;border:0;background:transparent;padding:8px;color:#FF8FB1;font-size:14px;font-weight:600;cursor:pointer;border-radius:8px;transition:all .2s}'
      + '.ms-seg-btn.active{background:#fff;color:#FF6B9D;box-shadow:0 2px 6px rgba(255,107,157,.2)}'
      + '.ms-tr-block{margin-bottom:14px}'
      + '.ms-tr-label{color:#FF8FB1;font-size:12px;margin-bottom:6px}'
      + '.ms-tr-text{background:#FFF5F7;border-radius:12px;padding:12px 14px;color:#5b3a4a;font-size:14px;line-height:1.7;white-space:pre-wrap;word-break:break-word;border:1px solid #FFE4EE}'
      + '.ms-notify-wrap{position:fixed;top:0;left:0;right:0;z-index:200000;display:flex;flex-direction:column;align-items:center;padding:10px;gap:8px;pointer-events:none}'
      + '.ms-notify{pointer-events:auto;display:flex;align-items:center;gap:10px;background:rgba(255,255,255,.97);backdrop-filter:blur(8px);-webkit-backdrop-filter:blur(8px);border-radius:14px;padding:10px 12px;box-shadow:0 6px 24px rgba(255,107,157,.25);border:1px solid #FFE4EE;max-width:92%;width:380px;transform:translateY(-90px);opacity:0;transition:transform .32s cubic-bezier(.2,.8,.2,1),opacity .32s;cursor:pointer}'
      + '.ms-notify.ms-show{transform:translateY(0);opacity:1}'
      + '.ms-notify-icon{width:36px;height:36px;border-radius:50%;background:linear-gradient(135deg,#FF6B9D,#FFB6C1);display:flex;align-items:center;justify-content:center;font-size:18px;flex:0 0 auto}'
      + '.ms-notify-text{flex:1;min-width:0}'
      + '.ms-notify-text b{display:block;color:#5b3a4a;font-size:14px}'
      + '.ms-notify-text span{display:block;color:#888;font-size:12px;margin-top:1px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}'
      + '.ms-notify-x{border:0;background:transparent;color:#ccc;font-size:18px;cursor:pointer;flex:0 0 auto;line-height:1}'
      + '.ms-img-preview{display:flex;align-items:center;justify-content:center;height:100%;width:100%}'
      + '.ms-img-preview img{max-width:92%;max-height:86vh;border-radius:12px;box-shadow:0 8px 40px rgba(0,0,0,.4)}';
    var st = document.createElement('style');
    st.id = 'mochi-social-css';
    st.textContent = css;
    document.head.appendChild(st);
  }

  /* ===== 通用弹层系统 ===== */
  var overlayStack = [];
  function openOverlay(content, opts) {
    opts = opts || {};
    injectStyles();
    var ov = document.createElement('div');
    ov.className = 'ms-overlay' + (opts.fullscreen ? ' ms-overlay-full' : '') + (opts.bare ? ' ms-overlay-bare' : '');
    ov.setAttribute('data-ms-overlay', '1');
    if (opts.bare) {
      ov.innerHTML = content;
    } else {
      var card = document.createElement('div');
      card.className = 'ms-modal' + (opts.fullscreen ? ' ms-modal-full' : '') + (opts.wide ? ' ms-modal-wide' : '');
      if (opts.maxWidth) card.style.maxWidth = opts.maxWidth;
      card.innerHTML = content;
      ov.appendChild(card);
    }
    document.body.appendChild(ov);
    if (!opts.sticky) {
      ov.addEventListener('click', function (e) { if (e.target === ov) closeOverlay(ov); });
    }
    if (opts.onClose) ov._onClose = opts.onClose;
    overlayStack.push(ov);
    requestAnimationFrame(function () { ov.classList.add('ms-show'); });
    return ov;
  }
  function closeOverlay(ov) {
    if (!ov || !ov.parentNode) return;
    ov.classList.remove('ms-show');
    var cb = ov._onClose;
    setTimeout(function () {
      if (ov.parentNode) ov.parentNode.removeChild(ov);
      var i = overlayStack.indexOf(ov);
      if (i >= 0) overlayStack.splice(i, 1);
      if (cb) { try { cb(); } catch (e) {} }
    }, 260);
  }
  function closeTopOverlay() { if (overlayStack.length) closeOverlay(overlayStack[overlayStack.length - 1]); }
  MochiSocial._closeTop = closeTopOverlay;

  function modalHeader(title, subtitle) {
    return '<div class="ms-head"><div class="ms-head-titles"><h3>' + esc(title) + '</h3>' + (subtitle ? '<small>' + esc(subtitle) + '</small>' : '') + '</div><button class="ms-close" onclick="MochiSocial._closeTop()">&times;</button></div>';
  }
  function loadingBox() { return '<div class="ms-loading"><span class="ms-spinner"></span>加载中…</div>'; }
  function emptyBox(text) { return '<div class="ms-empty">' + esc(text || '暂无内容') + '</div>'; }
  function bodyEl(id) { return document.getElementById(id); }

  /* ===== 1. 心声 Heart Voice ===== */
  function _heartSet(roleId) {
    if (store) return store.get('hv_' + roleId, []) || [];
    return MochiSocial._hvMem[roleId] || (MochiSocial._hvMem[roleId] = []);
  }
  function _heartHas(roleId, text) { return _heartSet(roleId).indexOf(text) >= 0; }
  function _heartAdd(roleId, text) {
    if (store) { var s = store.get('hv_' + roleId, []) || []; if (s.indexOf(text) < 0) { s.push(text); store.set('hv_' + roleId, s); } return; }
    var m = MochiSocial._hvMem[roleId] || (MochiSocial._hvMem[roleId] = []); if (m.indexOf(text) < 0) m.push(text);
  }

  MochiSocial.showHeartVoice = function (roleId) {
    var role = roleById(roleId) || activeRoleSafe();
    var rid = roleId || (role && role.id);
    var name = role ? role.name : 'TA';
    var html = '<div class="ms-panel">' + modalHeader(name + ' 的心声', '那些没说出口的小心思')
      + '<div class="ms-body" id="msHeartBody">' + loadingBox() + '</div></div>';
    openOverlay(html, { wide: true });
    if (rid) loadHeartVoices(rid);
    else { var b = bodyEl('msHeartBody'); if (b) b.innerHTML = emptyBox('暂无角色'); }
  };
  function loadHeartVoices(rid) {
    var b = bodyEl('msHeartBody'); if (!b) return;
    if (!api) { b.innerHTML = emptyBox('功能未就绪'); return; }
    api.get('/heartvoices/' + encodeURIComponent(rid)).then(function (res) {
      var list = (res && res.list) || [];
      if (!list.length) { var r = roleById(rid); b.innerHTML = emptyBox('还没有心声，多和 ' + (r ? r.name : 'TA') + ' 聊聊吧~'); return; }
      var html = '<div class="ms-heart-list">';
      each(list, function (it) {
        html += '<div class="ms-heart-item"><div class="ms-heart-quote">&ldquo;</div>'
          + '<div class="ms-heart-text">' + esc(it.text) + '</div>'
          + '<div class="ms-heart-time">' + esc(formatTime(it.createdAt)) + '</div></div>';
      });
      b.innerHTML = html + '</div>';
    }).catch(function () { b.innerHTML = emptyBox('加载失败，请重试'); });
  }
  MochiSocial.saveHeartVoice = function (roleId, text) {
    if (!roleId || !text || !api) return Promise.resolve(null);
    if (_heartHas(roleId, text)) return Promise.resolve(null);
    _heartAdd(roleId, text);
    return api.post('/heartvoices/' + encodeURIComponent(roleId), { text: text })
      .then(function (res) { return res; })
      .catch(function () { return null; });
  };

  /* ===== 2. 情诗 Love Poems ===== */
  MochiSocial.showLovePoems = function (roleId) {
    var role = roleById(roleId) || activeRoleSafe();
    var rid = roleId || (role && role.id);
    var name = role ? role.name : 'TA';
    var html = '<div class="ms-panel">' + modalHeader(name + ' 写给你的情诗', '字字句句，皆是心意')
      + '<div class="ms-body" id="msPoemBody">' + loadingBox() + '</div>'
      + '<div class="ms-foot"><button class="ms-btn ms-btn-ghost" onclick="MochiSocial._refreshPoems()">再读一遍</button></div></div>';
    openOverlay(html, { wide: true });
    MochiSocial._poemRid = rid;
    loadPoems(rid);
  };
  MochiSocial._refreshPoems = function () { loadPoems(MochiSocial._poemRid); };
  function loadPoems(rid) {
    var b = bodyEl('msPoemBody'); if (!b) return;
    b.innerHTML = loadingBox();
    if (!rid || !api) { b.innerHTML = emptyBox('功能未就绪'); return; }
    api.get('/love-poems/' + encodeURIComponent(rid)).then(function (res) {
      var list = (res && res.list) || [];
      if (!list.length) { b.innerHTML = emptyBox('还没有情诗~'); return; }
      var html = '<div class="ms-poem-list">';
      each(list, function (p, i) {
        var title = p.title || ('情诗 · ' + (i + 1));
        var content = p.content || p.text || '';
        html += '<div class="ms-poem-card"><div class="ms-poem-title">' + esc(title) + '</div>'
          + '<div class="ms-poem-content">' + esc(content).replace(/\n/g, '<br>') + '</div>'
          + (p.createdAt ? '<div class="ms-poem-time">' + esc(formatTime(p.createdAt)) + '</div>' : '') + '</div>';
      });
      b.innerHTML = html + '</div>';
    }).catch(function () { b.innerHTML = emptyBox('加载失败，请重试'); });
  }

  /* ===== 3. 朋友圈 Moments ===== */
  var _imgRegistry = [];
  MochiSocial.showMoments = function () {
    var u = currentUser();
    var html = '<div class="ms-moments">'
      + '<div class="ms-moments-head"><button class="ms-icon-btn" onclick="MochiSocial._closeTop()">&#8249;</button>'
      + '<h3>朋友圈</h3><span class="ms-icon-spacer"></span></div>'
      + '<div class="ms-moments-cover"><div class="ms-moments-me"><img class="ms-moments-me-avatar" src="' + esc(u.avatar || avatarFor(u.nickname, '')) + '"><span>' + esc(u.nickname) + '</span></div></div>'
      + '<div class="ms-moments-body" id="msMomentsBody">' + loadingBox() + '</div></div>';
    openOverlay(html, { fullscreen: true, sticky: true });
    loadMoments();
  };
  function loadMoments() {
    var body = bodyEl('msMomentsBody'); if (!body) return;
    var composer = '<div class="ms-mom-composer">'
      + '<textarea id="msMomText" class="ms-textarea" placeholder="这一刻的想法…" rows="2"></textarea>'
      + '<input id="msMomImgs" class="ms-input" placeholder="图片链接，多个用空格分隔（可选）" style="margin-top:8px">'
      + '<div class="ms-mom-composer-foot"><span class="ms-hint">发表到朋友圈</span>'
      + '<button class="ms-btn ms-btn-primary ms-btn-sm" onclick="MochiSocial._postMomentFromComposer()">发表</button></div></div>';
    body.innerHTML = composer + '<div id="msMomFeed">' + loadingBox() + '</div>';
    if (!api) { var f = bodyEl('msMomFeed'); if (f) f.innerHTML = emptyBox('功能未就绪'); return; }
    api.get('/moments').then(function (res) { renderMomentsFeed((res && res.list) || []); })
      .catch(function () { var f = bodyEl('msMomFeed'); if (f) f.innerHTML = emptyBox('加载失败'); });
  }
  function renderMomentsFeed(list) {
    _imgRegistry = [];
    var feed = bodyEl('msMomFeed'); if (!feed) return;
    if (!list.length) { feed.innerHTML = emptyBox('还没有动态，发第一条吧~'); return; }
    var uid = getUserId();
    var html = '';
    each(list, function (m) {
      var imgs = m.images || [];
      var liked = m.likes && uid && m.likes.indexOf(uid) >= 0;
      var likeNames = (m.likes || []).map(function (l) { return l === uid ? '我' : l; });
      var htmlImgs = '';
      if (imgs.length === 1) {
        _imgRegistry.push(imgs[0]);
        htmlImgs = '<div class="ms-mom-imgs one"><img src="' + esc(imgs[0]) + '" onclick="MochiSocial._previewImg(' + (_imgRegistry.length - 1) + ')"></div>';
      } else if (imgs.length > 1) {
        htmlImgs = '<div class="ms-mom-imgs">';
        each(imgs.slice(0, 9), function (u) { _imgRegistry.push(u); htmlImgs += '<img src="' + esc(u) + '" onclick="MochiSocial._previewImg(' + (_imgRegistry.length - 1) + ')">'; });
        htmlImgs += '</div>';
      }
      var comments = m.comments || [];
      var htmlCmts = '';
      if (comments.length) {
        htmlCmts = '<div class="ms-mom-comments" id="msCmts_' + esc(m.id) + '">';
        each(comments, function (c) { htmlCmts += '<div class="ms-mom-comment"><b>' + esc(c.name === uid ? '我' : c.name) + '</b>：' + esc(c.text) + '</div>'; });
        htmlCmts += '</div>';
      } else {
        htmlCmts = '<div class="ms-mom-comments" id="msCmts_' + esc(m.id) + '" style="display:none"></div>';
      }
      html += '<div class="ms-mom-item">'
        + '<img class="ms-mom-avatar" src="' + esc(m.authorAvatar || avatarFor(m.authorName, '')) + '">'
        + '<div class="ms-mom-main"><div class="ms-mom-name">' + esc(m.authorName) + '</div>'
        + '<div class="ms-mom-text">' + esc(m.text).replace(/\n/g, '<br>') + '</div>' + htmlImgs
        + '<div class="ms-mom-bar"><span class="ms-mom-time">' + esc(formatTime(m.createdAt)) + '</span>'
        + '<div class="ms-mom-actions">'
        + '<button class="ms-mom-act" id="msLikeBtn_' + esc(m.id) + '" data-liked="' + (liked ? 1 : 0) + '" data-count="' + (m.likes ? m.likes.length : 0) + '" onclick="MochiSocial._toggleLike(\'' + esc(m.id) + '\')">' + (liked ? '❤️' : '🤍') + ' ' + (m.likes ? m.likes.length : 0) + '</button>'
        + '<button class="ms-mom-act" onclick="MochiSocial._focusComment(\'' + esc(m.id) + '\')">💬 评论</button>'
        + '</div></div>'
        + '<div class="ms-mom-box"><div class="ms-mom-likes" id="msLikeNames_' + esc(m.id) + '"' + (likeNames.length ? '' : ' style="display:none"') + '>' + (likeNames.length ? '❤ ' + esc(likeNames.join('，')) : '') + '</div>' + htmlCmts + '</div>'
        + '<div class="ms-mom-comment-input"><input class="ms-input ms-input-sm" id="msCmtInp_' + esc(m.id) + '" placeholder="评论…"><button class="ms-btn ms-btn-ghost ms-btn-sm" onclick="MochiSocial._submitComment(\'' + esc(m.id) + '\')">发送</button></div>'
        + '</div></div>';
    });
    feed.innerHTML = html;
  }
  MochiSocial._postMomentFromComposer = function () {
    var t = bodyEl('msMomText'), i = bodyEl('msMomImgs');
    if (!t) return;
    var text = t.value.trim();
    if (!text) { toast('写点什么吧~'); return; }
    var imgs = (i && i.value.trim()) ? i.value.trim().split(/\s+/).filter(Boolean) : [];
    MochiSocial.postMoment(text, imgs).then(function () { t.value = ''; if (i) i.value = ''; }).catch(function () {});
  };
  MochiSocial.postMoment = function (text, images) {
    var u = currentUser();
    if (!api) { toast('功能未就绪'); return Promise.reject(new Error('no api')); }
    return api.post('/moments', { text: text, images: images || [], authorName: u.nickname, authorAvatar: u.avatar || avatarFor(u.nickname, '') })
      .then(function (res) { toast('已发表~'); loadMoments(); return res; })
      .catch(function (e) { toast('发表失败'); throw e; });
  };
  MochiSocial.likeMoment = function (id) {
    if (!api || !id) return Promise.resolve();
    return api.post('/moments/' + encodeURIComponent(id) + '/like', { userId: getUserId() }).catch(function () {});
  };
  MochiSocial._toggleLike = function (id) {
    var btn = bodyEl('msLikeBtn_' + id);
    var liked = btn && btn.getAttribute('data-liked') === '1';
    var newLiked = !liked;
    if (btn) {
      var count = parseInt(btn.getAttribute('data-count') || '0', 10);
      var nc = newLiked ? count + 1 : Math.max(0, count - 1);
      btn.setAttribute('data-liked', newLiked ? '1' : '0');
      btn.setAttribute('data-count', String(nc));
      btn.innerHTML = (newLiked ? '❤️' : '🤍') + ' ' + nc;
    }
    var namesEl = bodyEl('msLikeNames_' + id);
    if (namesEl) {
      var has = namesEl.style.display !== 'none';
      if (newLiked && !has) { namesEl.innerHTML = '❤ 我'; namesEl.style.display = ''; }
      else if (!newLiked && namesEl.innerHTML.replace(/<[^>]+>/g, '').replace(/\s/g, '') === '❤我') { namesEl.innerHTML = ''; namesEl.style.display = 'none'; }
    }
    MochiSocial.likeMoment(id);
  };
  MochiSocial.commentMoment = function (id, text) {
    if (!api) return Promise.reject(new Error('no api'));
    return api.post('/moments/' + encodeURIComponent(id) + '/comment', { userId: getUserId(), name: currentUser().nickname, text: text })
      .then(function (res) { return res; });
  };
  MochiSocial._submitComment = function (id) {
    var inp = bodyEl('msCmtInp_' + id); if (!inp) return;
    var text = inp.value.trim(); if (!text) return;
    var name = currentUser().nickname;
    var cmtsEl = bodyEl('msCmts_' + id);
    if (cmtsEl) {
      var c = document.createElement('div'); c.className = 'ms-mom-comment';
      c.innerHTML = '<b>' + esc(name) + '</b>：' + esc(text);
      cmtsEl.appendChild(c); cmtsEl.style.display = '';
    }
    inp.value = '';
    MochiSocial.commentMoment(id, text).catch(function () { toast('评论失败'); });
  };
  MochiSocial._focusComment = function (id) { var inp = bodyEl('msCmtInp_' + id); if (inp) { inp.focus(); } };
  MochiSocial._previewImg = function (idx) {
    var url = _imgRegistry[idx];
    if (!url) return;
    openOverlay('<div class="ms-img-preview"><img src="' + esc(url) + '"></div>', { bare: true });
  };

  /* ===== 4. 群聊 Group Chat ===== */
  MochiSocial.showGroups = function () {
    var html = '<div class="ms-panel">' + modalHeader('群聊', '和多个角色一起聊天')
      + '<div class="ms-body" id="msGroupBody">' + loadingBox() + '</div>'
      + '<div class="ms-foot"><button class="ms-btn ms-btn-primary" onclick="MochiSocial._newGroupForm()">+ 新建群聊</button></div></div>';
    openOverlay(html, { wide: true });
    loadGroups();
  };
  function loadGroups() {
    var b = bodyEl('msGroupBody'); if (!b) return;
    b.innerHTML = loadingBox();
    if (!api) { b.innerHTML = emptyBox('功能未就绪'); return; }
    api.get('/groups').then(function (res) {
      var list = (res && res.list) || [];
      if (!list.length) { b.innerHTML = emptyBox('还没有群聊，新建一个吧~'); return; }
      var html = '<div class="ms-group-list">';
      each(list, function (g) {
        var members = g.members || [];
        var avatars = '';
        each(members.slice(0, 5), function (mn) { var r = roleByName(mn); avatars += '<img class="ms-group-av" src="' + esc(r ? roleAvatar(r) : avatarFor(mn, '')) + '" title="' + esc(mn) + '">'; });
        html += '<div class="ms-group-item"><div class="ms-group-icon">#</div>'
          + '<div class="ms-group-info"><div class="ms-group-name">' + esc(g.name) + '</div>'
          + '<div class="ms-group-members">' + avatars + '<span class="ms-group-count">' + members.length + ' 人</span></div></div>'
          + '<div class="ms-group-time">' + esc(formatTime(g.createdAt)) + '</div></div>';
      });
      b.innerHTML = html + '</div>';
    }).catch(function () { b.innerHTML = emptyBox('加载失败'); });
  }
  MochiSocial._newGroupForm = function () {
    var roles = (window.state && window.state.roles) || [];
    var opts = '';
    each(roles, function (r) {
      opts += '<label class="ms-check"><input type="checkbox" value="' + esc(r.id) + '"><img class="ms-check-av" src="' + esc(roleAvatar(r)) + '"><span>' + esc(r.name) + '</span></label>';
    });
    if (!opts) opts = '<div class="ms-empty">还没有可选角色</div>';
    var html = '<div class="ms-panel">' + modalHeader('新建群聊', '选择成员')
      + '<div class="ms-body"><input id="msGroupName" class="ms-input" placeholder="群聊名称" style="margin-bottom:12px"><div class="ms-check-list">' + opts + '</div></div>'
      + '<div class="ms-foot"><button class="ms-btn ms-btn-ghost" onclick="MochiSocial._closeTop()">取消</button><button class="ms-btn ms-btn-primary" onclick="MochiSocial._createGroupFromForm()">创建</button></div></div>';
    openOverlay(html, { wide: true });
  };
  MochiSocial._createGroupFromForm = function () {
    var nameEl = bodyEl('msGroupName');
    var name = nameEl ? nameEl.value.trim() : '';
    if (!name) { toast('请输入群聊名称'); return; }
    var members = [];
    var checks = document.querySelectorAll('.ms-check-list input[type=checkbox]:checked');
    each(checks, function (c) { var r = roleById(c.value); if (r) members.push(r.name); });
    if (members.length < 2) { toast('至少选择 2 个成员'); return; }
    MochiSocial.createGroup(name, members).then(function () { closeTopOverlay(); loadGroups(); }).catch(function () {});
  };
  MochiSocial.createGroup = function (name, members) {
    if (!api) { toast('功能未就绪'); return Promise.reject(new Error('no api')); }
    return api.post('/groups', { name: name, members: members || [] })
      .then(function (res) { toast('群聊已创建'); return res; })
      .catch(function (e) { toast('创建失败'); throw e; });
  };

  /* ===== 5. 红包 Red Packet ===== */
  MochiSocial.openRedpacket = function (element, amount, note) {
    amount = Number(amount) || 0;
    note = note || '';
    injectStyles();
    var html = '<div class="ms-rp-overlay"><div class="ms-rp-envelope" id="msRpEnvelope">'
      + '<div class="ms-rp-flap"></div>'
      + '<div class="ms-rp-body"><div class="ms-rp-logo">🧧</div>'
      + '<div class="ms-rp-greeting">恭喜发财</div>'
      + '<div class="ms-rp-note">' + esc(note || '大吉大利') + '</div>'
      + '<button class="ms-rp-open-btn" id="msRpOpenBtn">開</button></div></div></div>';
    var ov = openOverlay(html, { bare: true, sticky: true });
    var btn = ov.querySelector('#msRpOpenBtn');
    if (btn) btn.addEventListener('click', function () { _openRpResult(amount, note, ov); });
  };
  function _openRpResult(amount, note, ov) {
    var env = ov.querySelector('#msRpEnvelope'); if (env) env.classList.add('ms-rp-open');
    var btn = ov.querySelector('#msRpOpenBtn'); if (btn) btn.style.display = 'none';
    setTimeout(function () {
      var wrap = ov.querySelector('.ms-rp-overlay'); if (!wrap) return;
      wrap.innerHTML = '<div class="ms-rp-result"><div class="ms-rp-coins">💰</div>'
        + '<div class="ms-rp-amount">¥' + amount.toFixed(2) + '</div>'
        + '<div class="ms-rp-note2">' + esc(note || '恭喜发财，大吉大利') + '</div>'
        + '<div class="ms-rp-from">已领取，存入钱包</div>'
        + '<button class="ms-btn ms-btn-light" id="msRpClose" style="margin-top:18px">开心收下</button></div>';
      var c = ov.querySelector('#msRpClose');
      if (c) c.addEventListener('click', function () { closeOverlay(ov); });
      MochiSocial.notify('收到红包', '¥' + amount.toFixed(2) + (note ? ' ' + note : ''));
    }, 700);
  }
  MochiSocial.sendRedpacket = function (amount, note) {
    amount = Number(amount);
    if (!amount || amount <= 0) { toast('请输入金额'); return Promise.reject(new Error('invalid amount')); }
    if (!api) { toast('功能未就绪'); return Promise.reject(new Error('no api')); }
    var role = activeRoleSafe();
    var groupId = role ? role.id : null;
    return api.post('/redpacket/send', { amount: amount, type: 'chat', note: note || '恭喜发财', groupId: groupId })
      .then(function (res) {
        toast('红包已发出 ¥' + amount.toFixed(2));
        _insertUserMessage('[redpacket:' + amount.toFixed(2) + '|' + (note || '恭喜发财') + ']');
        return res;
      })
      .catch(function (e) { toast('发送失败'); throw e; });
  };
  function _insertUserMessage(content) {
    try {
      var role = activeRoleSafe(); if (!role) return;
      var msgs = window.getMessages ? window.getMessages(role.id) : null;
      if (msgs) {
        msgs.push({ id: uuid(), role: 'user', content: content, createdAt: Date.now() });
        if (typeof persist === 'function') { try { persist(); } catch (e) {} }
        if (window.renderMessages) window.renderMessages();
      }
    } catch (e) {}
  }

  /* ===== 6. 钱包 Wallet ===== */
  MochiSocial.showWallet = function () {
    var html = '<div class="ms-panel">' + modalHeader('钱包', '余额与交易记录')
      + '<div class="ms-body" id="msWalletBody">' + loadingBox() + '</div></div>';
    openOverlay(html, { wide: true });
    loadWallet();
  };
  function loadWallet() {
    var b = bodyEl('msWalletBody'); if (!b) return;
    b.innerHTML = loadingBox();
    if (!api) { b.innerHTML = emptyBox('功能未就绪'); return; }
    api.get('/wallet').then(function (res) {
      var balance = (res && res.balance != null) ? res.balance : 0;
      var txs = (res && res.transactions) || [];
      var html = '<div class="ms-wallet-card"><div class="ms-wallet-label">可用余额</div>'
        + '<div class="ms-wallet-balance">¥' + esc(String(Number(balance).toFixed(2))) + '</div>'
        + '<button class="ms-btn ms-btn-light" onclick="MochiSocial._transferForm()">转账</button></div>'
        + '<div class="ms-wallet-section"><div class="ms-section-title">交易记录</div>';
      if (!txs.length) { html += emptyBox('暂无交易记录'); }
      else {
        html += '<div class="ms-tx-list">';
        each(txs, function (t) {
          var out = (t.direction === 'out' || t.direction === 'send');
          var amt = Number(t.amount || 0);
          html += '<div class="ms-tx-item"><div class="ms-tx-icon ' + (out ? 'out' : 'in') + '">' + (out ? '↑' : '↓') + '</div>'
            + '<div class="ms-tx-main"><div class="ms-tx-title">' + esc(t.note || (out ? '转出' : '转入')) + '</div>'
            + '<div class="ms-tx-time">' + esc(formatTime(t.createdAt)) + '</div></div>'
            + '<div class="ms-tx-amount ' + (out ? 'out' : 'in') + '">' + (out ? '-' : '+') + '¥' + amt.toFixed(2) + '</div></div>';
        });
        html += '</div>';
      }
      b.innerHTML = html + '</div>';
    }).catch(function () { b.innerHTML = emptyBox('加载失败'); });
  }
  MochiSocial._transferForm = function () {
    var html = '<div class="ms-panel">' + modalHeader('转账', '')
      + '<div class="ms-body">'
      + '<div class="ms-seg" id="msTfDir"><button class="ms-seg-btn active" data-dir="out" onclick="MochiSocial._segPick(this)">转出</button><button class="ms-seg-btn" data-dir="in" onclick="MochiSocial._segPick(this)">转入</button></div>'
      + '<input id="msTfAmount" class="ms-input" type="number" min="0.01" step="0.01" placeholder="金额" style="margin-top:12px">'
      + '<input id="msTfNote" class="ms-input" placeholder="备注（可选）" style="margin-top:8px"></div>'
      + '<div class="ms-foot"><button class="ms-btn ms-btn-ghost" onclick="MochiSocial._closeTop()">取消</button><button class="ms-btn ms-btn-primary" onclick="MochiSocial._submitTransfer()">确认</button></div></div>';
    openOverlay(html, { wide: true });
  };
  MochiSocial._segPick = function (btn) {
    var seg = btn.parentNode;
    each(seg.querySelectorAll('.ms-seg-btn'), function (x) { x.classList.remove('active'); });
    btn.classList.add('active');
  };
  MochiSocial._submitTransfer = function () {
    var dirEl = document.querySelector('#msTfDir .ms-seg-btn.active');
    var dir = dirEl ? dirEl.getAttribute('data-dir') : 'out';
    var amtEl = bodyEl('msTfAmount');
    var amt = parseFloat(amtEl ? amtEl.value : '');
    var noteEl = bodyEl('msTfNote');
    var note = noteEl ? noteEl.value : '';
    if (!amt || amt <= 0) { toast('请输入金额'); return; }
    MochiSocial.transfer(dir, amt, note).then(function () { closeTopOverlay(); loadWallet(); }).catch(function () {});
  };
  MochiSocial.transfer = function (direction, amount, note) {
    if (!api) { toast('功能未就绪'); return Promise.reject(new Error('no api')); }
    return api.post('/wallet/transfer', { amount: Number(amount), direction: direction, note: note || '' })
      .then(function (res) { toast(direction === 'out' ? '已转出 ¥' + Number(amount).toFixed(2) : '已转入 ¥' + Number(amount).toFixed(2)); return res; })
      .catch(function (e) { toast('转账失败'); throw e; });
  };

  /* ===== 7. 翻译 Translation ===== */
  MochiSocial.translateMessage = function (text) {
    if (!text) { toast('没有可翻译的内容'); return Promise.resolve(); }
    var target = /[\u4e00-\u9fff]/.test(text) ? 'en' : 'zh';
    return _openTranslatePanel(text, target);
  };
  function _openTranslatePanel(text, target) {
    var html = '<div class="ms-panel">' + modalHeader('翻译', '目标：' + (target === 'en' ? 'English' : '中文'))
      + '<div class="ms-body" id="msTrBody">'
      + '<div class="ms-tr-block"><div class="ms-tr-label">原文</div><div class="ms-tr-text">' + esc(text) + '</div></div>'
      + '<div class="ms-tr-block"><div class="ms-tr-label">译文</div><div class="ms-tr-text" id="msTrOut">' + loadingBox() + '</div></div></div>'
      + '<div class="ms-foot"><button class="ms-btn ms-btn-ghost" onclick="MochiSocial._swapTarget()">切换语言</button><button class="ms-btn ms-btn-ghost" onclick="MochiSocial._closeTop()">关闭</button></div></div>';
    openOverlay(html, { wide: true });
    _doTranslate(text, target);
  }
  function _doTranslate(text, target) {
    MochiSocial._tr = { text: text, target: target };
    var out = bodyEl('msTrOut');
    if (out) out.innerHTML = loadingBox();
    if (!api) { if (out) out.innerHTML = emptyBox('功能未就绪'); return; }
    api.post('/translate', { text: text, target: target }).then(function (res) {
      if (out) out.innerHTML = esc((res && res.translated) || '（无结果）');
    }).catch(function () { if (out) out.innerHTML = emptyBox('翻译失败'); });
  }
  MochiSocial._swapTarget = function () {
    var c = MochiSocial._tr; if (!c) return;
    var nt = c.target === 'en' ? 'zh' : 'en';
    var subs = document.querySelectorAll('.ms-head-titles small');
    if (subs.length) subs[subs.length - 1].textContent = '目标：' + (nt === 'en' ? 'English' : '中文');
    _doTranslate(c.text, nt);
  };

  /* ===== 8. 通知 Notifications ===== */
  MochiSocial.notify = function (title, body) {
    injectStyles();
    var container = document.getElementById('msNotifyWrap');
    if (!container) {
      container = document.createElement('div');
      container.id = 'msNotifyWrap';
      container.className = 'ms-notify-wrap';
      document.body.appendChild(container);
    }
    var banner = document.createElement('div');
    banner.className = 'ms-notify';
    banner.innerHTML = '<div class="ms-notify-icon">🔔</div>'
      + '<div class="ms-notify-text"><b>' + esc(title) + '</b>' + (body ? '<span>' + esc(body) + '</span>' : '') + '</div>'
      + '<button class="ms-notify-x" aria-label="关闭">&times;</button>';
    container.appendChild(banner);
    requestAnimationFrame(function () { banner.classList.add('ms-show'); });
    var close = function () {
      banner.classList.remove('ms-show');
      setTimeout(function () { if (banner.parentNode) banner.parentNode.removeChild(banner); }, 320);
    };
    var x = banner.querySelector('.ms-notify-x');
    if (x) x.addEventListener('click', function (e) { e.stopPropagation(); close(); });
    var timer = setTimeout(close, 5000);
    banner.addEventListener('click', function () { clearTimeout(timer); close(); });
  };

  /* ===== 渲染钩子：用户红包气泡美化 + 心声自动存档 ===== */
  function _beautifyUserBubbles() {
    try {
      var list = document.getElementById('messageList'); if (!list) return;
      var role = activeRoleSafe(); if (!role) return;
      var msgs = window.getMessages ? window.getMessages(role.id) : [];
      var rows = list.querySelectorAll('[data-msg-id]');
      each(rows, function (row) {
        var msgId = row.getAttribute('data-msg-id');
        var msg = null;
        for (var i = 0; i < msgs.length; i++) { if (msgs[i].id === msgId) { msg = msgs[i]; break; } }
        if (!msg || msg.role !== 'user') return;
        if (row.getAttribute('data-ms-rp')) return;
        var m = /\[redpacket:([\d.]+)\|([^\]]*)\]/.exec(msg.content || '');
        if (!m) return;
        row.setAttribute('data-ms-rp', '1');
        var bubble = row.querySelector('.qq-room__bubble');
        if (bubble) {
          bubble.innerHTML = '<div class="ms-rp-sent"><div class="ms-rp-sent-icon">🧧</div>'
            + '<div class="ms-rp-sent-info"><span>红包</span><small>¥' + esc(m[1]) + ' · ' + esc(m[2] || '恭喜发财') + '</small></div></div>';
        }
      });
    } catch (e) {}
  }
  var _heartTimer = null;
  function _scheduleHeartScan() {
    if (_heartTimer) clearTimeout(_heartTimer);
    _heartTimer = setTimeout(_scanHeartVoices, 900);
  }
  function _scanHeartVoices() {
    try {
      if (!window.MochiCore || !window.MochiCore.parseContent || !api) return;
      var role = activeRoleSafe(); if (!role) return;
      var msgs = window.getMessages ? window.getMessages(role.id) : [];
      each(msgs, function (m) {
        if (m.role !== 'assistant') return;
        var parsed = window.MochiCore.parseContent(m.content || '', {});
        if (!parsed || !parsed.heart) return;
        if (!_heartHas(role.id, parsed.heart)) MochiSocial.saveHeartVoice(role.id, parsed.heart);
      });
    } catch (e) {}
  }
  function _installHooks() {
    if (window._msHooksInstalled) return;
    if (typeof window.renderMessages !== 'function') {
      window.addEventListener('mochi:core-ready', _installHooks, { once: true });
      return;
    }
    window._msHooksInstalled = true;
    var prev = window.renderMessages;
    window.renderMessages = function () {
      var r = prev.apply(this, arguments);
      try { _beautifyUserBubbles(); } catch (e) {}
      try { _scheduleHeartScan(); } catch (e) {}
      return r;
    };
    document.addEventListener('keydown', function (e) {
      if ((e.key === 'Escape' || e.keyCode === 27) && overlayStack.length) closeTopOverlay();
    });
  }

  /* ===== 初始化 ===== */
  MochiSocial.init = function () {
    injectStyles();
    _installHooks();
  };

  window.MochiSocial = MochiSocial;
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', MochiSocial.init);
  } else {
    MochiSocial.init();
  }
})();
