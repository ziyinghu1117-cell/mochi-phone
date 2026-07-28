/* =======================================================================
/* === 全局豆子刷新函数（forum.js 自包含，不依赖外部作用域） === */
var forumRefreshBeans = async function() {
  try {
    if (typeof window.refreshServerUser === 'function') {
      await window.refreshServerUser();
      return;
    }
  } catch(e) {}
  /* 回退：直接请求服务器获取豆子 */
  try {
    var userId = (typeof CONFIG !== 'undefined' && CONFIG.userId) ? CONFIG.userId : '';
    var resp = await fetch('/api/user/me', { headers: { 'x-user-id': userId } });
    var data = await resp.json();
    if (data && data.data) {
      var beans = data.data.beans;
      var badge = document.getElementById('beansBadge');
      var balance = document.getElementById('beansBalance');
      if (badge) badge.textContent = '豆子 ' + beans;
      if (balance) balance.textContent = beans + ' 豆子';
      var forumBeans = document.getElementById('dfBeansDisplay') || document.getElementById('sfBeansDisplay');
      if (forumBeans) forumBeans.textContent = beans;
    }
  } catch(e) {}
};
/* 覆盖所有 refreshServerUser 调用，确保 forum.js 内部也能刷新豆子 */
if (typeof window.refreshServerUser !== 'function') {
  window.refreshServerUser = forumRefreshBeans;
}
/* =======================================================================
 * Forum System - Two overlay forums accessed from the phone interface
 *   1. Social Forum  (Twitter/Weibo dark theme)  -> #socialForumOverlay
 *   2. Doujin Forum  (LOFTER light theme)        -> #doujinForumOverlay
 *
 * Loaded after the main script + forum-avatars-base64.js, so it can use:
 *   state, activeRole(), getMessages(), escapeHtml(), $(), $$(), toast(),
 *   request(), CONFIG.userId, FORUM_AVATAR_BASE64
 *
 * Exported globals: openSocialForum, closeSocialForum,
 *                   openDoujinForum, closeDoujinForum
 * ======================================================================= */

/* ----------------------------------------------------------------------
 * Shared helpers & constants
 * -------------------------------------------------------------------- */

var FORUM_AVATAR_KEYS = [
  '/avatars/avatar1.png', '/avatars/avatar2.png', '/avatars/avatar3.png', '/avatars/avatar4.png',
  '/avatars/avatar5.png', '/avatars/avatar6.png', '/avatars/avatar7.png', '/avatars/avatar8.png'
];

/* Resolve an avatar index to a base64 data url (or fall back to the path). */
var forumGetAvatarSrc = function (index) {
  var key = FORUM_AVATAR_KEYS[(index || 0) % FORUM_AVATAR_KEYS.length];
  if (typeof FORUM_AVATAR_BASE64 === 'object' && FORUM_AVATAR_BASE64 && FORUM_AVATAR_BASE64[key]) {
    return FORUM_AVATAR_BASE64[key];
  }
  return key;
};

/* Cover gradients reused by both forums. */
var FORUM_GRADIENTS = [
  ['#FFD6E0', '#FF6B9D'], ['#a8edea', '#fed6e3'], ['#fbc2eb', '#f8a4c8'],
  ['#fad0c4', '#ffd1ff'], ['#c2e9fb', '#f0c6e8'], ['#f093fb', '#f5576c'],
  ['#4facfe', '#00f2fe'], ['#43e97b', '#38f9d7'], ['#fa709a', '#fee140'],
  ['#30cfd0', '#f5576c'], ['#a8edea', '#84fab0'], ['#ff9a9e', '#fecfef']
];

/* Solid gradient backgrounds for initial-based avatars (divs). */
var SF_AVATAR_GRADIENTS = [
  'linear-gradient(135deg,#FF6B9D,#FF8FB1)',
  'linear-gradient(135deg,#e74c3c,#c0392b)',
  'linear-gradient(135deg,#8b5cf6,#6d28d9)',
  'linear-gradient(135deg,#10b981,#059669)',
  'linear-gradient(135deg,#f59e0b,#d97706)',
  'linear-gradient(135deg,#ef4444,#b91c1c)',
  'linear-gradient(135deg,#06b6d4,#0891b2)',
  'linear-gradient(135deg,#ec4899,#be185d)'
];

var forumAvatarGradient = function (index) {
  return SF_AVATAR_GRADIENTS[(index || 0) % SF_AVATAR_GRADIENTS.length];
};

var forumInitial = function (name) {
  var n = String(name || '匿').trim();
  return n ? n.charAt(0) : '?';
};

var forumToast = function (msg) {
  if (typeof toast === 'function') toast(msg);
};

/* Build a handle like @xxx from a display name. */
var forumHandle = function (name) {
  return '@' + String(name || 'anon').replace(/[\\s@]+/g, '').substring(0, 12).toLowerCase();
};

/* === 后台生成任务系统 === */
var bgTaskState = {
  pending: {},    /* taskId -> { type, context, onDone, onFail } */
  notified: {}    /* taskId -> true (already notified) */
};

/* 轮询单个任务直到完成 */
var bgPollTask = function (taskId, onDone, onFail) {
  var attempts = 0;
  var maxAttempts = 400; /* 最多轮询400次 (~10分钟) */
  var poll = function () {
    attempts++;
    if (attempts > maxAttempts) {
      onFail && onFail('生成超时：已等待约10分钟仍未完成，请稍后在"我的作品"中查看或重新生成');
      delete bgTaskState.pending[taskId];
      return;
    }
    request('/bg-tasks/' + taskId, { method: 'GET' }).then(function (result) {
      if (result && result.status === 'done') {
        delete bgTaskState.pending[taskId];
        onDone && onDone(result.result);
      } else if (result && result.status === 'failed') {
        delete bgTaskState.pending[taskId];
        onFail && onFail(result.error || '生成失败');
      } else {
        setTimeout(poll, 1500);
      }
    }).catch(function () {
      setTimeout(poll, 1500);
    });
  };
  setTimeout(poll, 1000);
};

/* 检查所有后台任务（页面打开/返回时调用） */
var bgCheckAllTasks = function () {
  request('/bg-tasks', { method: 'GET' }).then(function (result) {
    if (!result || !result.list) return;
    result.list.forEach(function (task) {
      if (task.status === 'pending' && !bgTaskState.pending[task.id]) {
        /* 任务仍在进行中，开始轮询 */
        bgTaskState.pending[task.id] = { type: task.type };
        bgPollTask(task.id, function (res) {
          bgNotifyDone(task.type, task.label, res);
        }, function (err) {
          forumToast(task.label + '失败：' + err);
        });
      } else if (task.status === 'done' && !bgTaskState.notified[task.id]) {
        /* 任务已完成但未被通知（用户离开过） */
        bgTaskState.notified[task.id] = true;
        request('/bg-tasks/' + task.id, { method: 'GET' }).then(function (detail) {
          if (detail && detail.result) {
            bgNotifyDone(task.type, task.label, detail.result);
          }
          /* 删除已通知的任务 */
          request('/bg-tasks/' + task.id, { method: 'DELETE' }).catch(function () {});
        }).catch(function () {});
      } else if (task.status === 'failed' && !bgTaskState.notified[task.id]) {
        bgTaskState.notified[task.id] = true;
        forumToast(task.label + '失败：' + (task.error || '未知错误'));
        request('/bg-tasks/' + task.id, { method: 'DELETE' }).catch(function () {});
      }
    });
  }).catch(function () {});
};

/* 任务完成通知 */
var bgNotifyDone = function (type, label, result) {
  forumToast(label + '完成！');
  if (type === 'forum' && result && result.posts) {
    /* 如果在论坛页面，更新帖子 */
    var tab = result.tab;
    if (sfState.active && sfState.currentView === 'feed' && tab === sfState.currentTab) {
      sfState.posts[tab] = result.posts;
      result.posts.forEach(function (p) {
        if (!sfState.commentsCache[p.id]) sfState.commentsCache[p.id] = p.commentsList || [];
      });
      try { localStorage.setItem('sf_posts_' + tab, JSON.stringify(sfState.posts[tab])); } catch (e) {}
      sfRenderTimeline(tab);
    } else {
      /* 缓存结果供下次显示 */
      sfState.posts[tab] = result.posts;
      try { localStorage.setItem('sf_posts_' + tab, JSON.stringify(sfState.posts[tab])); } catch (e) {}
    }
  } else if (type === 'doujin-work' && result && result.work) {
    /* 生成的作品添加到书架(allWorks)，不添加到发布作品(userWorks) */
    var work = result.work;
    if (!work.coverGradient) work.coverGradient = FORUM_GRADIENTS[Math.floor(Math.random() * FORUM_GRADIENTS.length)];
    if (typeof work.avatarIndex !== 'number') work.avatarIndex = 0;
    work._generated = true;
    dfState.allWorks.unshift(work);
    dfMergeAllWorks([work]);
    dfSaveWorksCache();
    /* 如果在生成页面，打开作品详情 */
    if (dfState.currentView === 'dfGeneratePage') {
      dfOpenWorkDetail(work.id);
    } else {
      forumToast('新作品已生成，查看书架');
    }
  } else if (type === 'doujin-list' && result && result.works) {
    var tag = result.tag || '全部';
    result.works.forEach(function (w, i) {
      if (!w.coverGradient) w.coverGradient = FORUM_GRADIENTS[i % FORUM_GRADIENTS.length];
      if (typeof w.avatarIndex !== 'number') w.avatarIndex = i % 8;
    });
    dfState.worksCache[tag] = result.works;
    dfMergeAllWorks(result.works);
    dfSaveWorksCache();
    if (dfState.active && dfState.currentView === 'library' && dfState.currentTag === tag) {
      dfRenderWorks(dfGetDisplayWorks(tag), forumEl('dfHomeContent'));
    } else {
      forumToast('同人文列表已更新，查看首页');
    }
  }
};

/* Helper: pick a random gradient pair for post images */
var forumRandomGradient = function (seed) {
  if (typeof seed === 'number') {
    return FORUM_GRADIENTS[seed % FORUM_GRADIENTS.length];
  }
  return FORUM_GRADIENTS[Math.floor(Math.random() * FORUM_GRADIENTS.length)];
};

/* Helper: build gradient CSS string */
var forumGradientCss = function (grad) {
  if (!grad || grad.length < 2) return 'linear-gradient(135deg,#FF6B9D,#FFB6C1)';
  return 'linear-gradient(135deg,' + grad[0] + ',' + grad[1] + ')';
};

/* Helper: safe querySelector */
var forumEl = function (id) {
  return document.getElementById(id);
};

/* Helper: format number like 1.2k */
var forumFormatNum = function (n) {
  n = Number(n) || 0;
  if (n >= 10000) return (n / 10000).toFixed(1) + 'w';
  if (n >= 1000) return (n / 1000).toFixed(1) + 'k';
  return String(n);
};

/* Pink healing palette (used across the new profile / doujin surfaces). */
var FORUM_PINK = {
  primary: '#FF6B9D',
  light: '#FFB6C1',
  bgSoft: '#FFF5F7',
  bgSofter: '#FFF0F5',
  ink: '#5b3a4a'
};

/* Resolve the current chat role's avatar to a usable src. */
var forumRoleAvatarSrc = function (role) {
  if (!role) return forumGetAvatarSrc(0);
  if (role.avatar) return role.avatar;
  if (typeof avatarOf === 'function') return avatarOf(role.name, role.avatar);
  return forumGetAvatarSrc(0);
};

/* A cute pink mascot (inline SVG) used in empty states + generate page. */
var forumMascotSvg = function (size) {
  size = size || 96;
  return '<svg xmlns="http://www.w3.org/2000/svg" width="' + size + '" height="' + size
    + '" viewBox="0 0 96 96">'
    + '<defs><linearGradient id="fmG" x1="0" x2="1" y1="0" y2="1">'
    + '<stop stop-color="#FFE4EE"/><stop offset="1" stop-color="#FFB6C1"/></linearGradient></defs>'
    + '<ellipse cx="48" cy="74" rx="30" ry="8" fill="#FFD3DE" opacity=".6"/>'
    + '<circle cx="48" cy="50" r="26" fill="url(#fmG)" stroke="#FF6B9D" stroke-width="2"/>'
    + '<ellipse cx="33" cy="30" rx="7" ry="12" fill="#FFC4D6" stroke="#FF6B9D" stroke-width="1.5" transform="rotate(-18 33 30)"/>'
    + '<ellipse cx="63" cy="30" rx="7" ry="12" fill="#FFC4D6" stroke="#FF6B9D" stroke-width="1.5" transform="rotate(18 63 30)"/>'
    + '<circle cx="39" cy="48" r="3.2" fill="#5b3a4a"/>'
    + '<circle cx="57" cy="48" r="3.2" fill="#5b3a4a"/>'
    + '<circle cx="40.2" cy="47" r="1" fill="#fff"/><circle cx="58.2" cy="47" r="1" fill="#fff"/>'
    + '<path d="M42 58 Q48 63 54 58" stroke="#FF6B9D" stroke-width="2.4" fill="none" stroke-linecap="round"/>'
    + '<circle cx="32" cy="55" r="3.4" fill="#FF8FB1" opacity=".55"/>'
    + '<circle cx="64" cy="55" r="3.4" fill="#FF8FB1" opacity=".55"/>'
    + '</svg>';
};

/* Inject pink healing-系 overrides once. Keeps all styling inside forum.js. */
var forumPinkStylesInjected = false;
var forumInjectPinkStyles = function () {
  if (forumPinkStylesInjected) return;
  forumPinkStylesInjected = true;
  var css = ''
    /* ---- social forum: pink FAB ---- */
    + '#sfFab{background:linear-gradient(135deg,#FF6B9D,#FFB6C1)!important;'
    + 'box-shadow:0 6px 18px rgba(255,107,157,.45)!important;color:#fff!important;font-size:26px}'
    + '#sfFab:active{transform:scale(.92)}'

    /* ---- social forum: pink bottom nav + sub-tabs ---- */
    + '.sf-bottom-nav{background:rgba(255,255,255,.98)!important;border-top:1px solid rgba(255,107,157,.15)!important;'
    + 'box-shadow:0 -2px 12px rgba(255,107,157,.06)!important}'
    + '.sf-tab{color:#a87b8c!important}'
    + '.sf-tab.active{color:#FF6B9D!important}'
    + '.sf-sub-tab{color:#a87b8c!important}'
    + '.sf-sub-tab.active{color:#FF6B9D!important;border-color:#FF6B9D!important}'

    /* ---- social forum: pink profile (me) view ---- */
    + '#sfMeView{background:linear-gradient(180deg,#FFF0F5 0%,#FFF5F7 240px,#fff 480px);min-height:100%}'
    + '.sf-profile-header{background:transparent!important;padding:24px 16px 8px!important}'
    + '.sf-profile-card{background:#fff;border-radius:22px;padding:18px 16px;box-shadow:0 6px 22px rgba(255,107,157,.12);'
    + 'border:1px solid rgba(255,182,193,.4)}'
    + '.sf-profile-top{display:flex;flex-direction:column;align-items:center;text-align:center}'
    + '.sf-profile-avatar-wrap{position:relative;width:88px;height:88px;margin-bottom:10px}'
    + '.sf-profile-avatar-wrap .sf-pa-img,.sf-profile-avatar-wrap .sf-pa-div{width:88px;height:88px;border-radius:50%;'
    + 'object-fit:cover;border:3px solid #fff;box-shadow:0 4px 14px rgba(255,107,157,.25);display:flex;align-items:center;'
    + 'justify-content:center;color:#fff;font-size:34px;font-weight:700;cursor:pointer}'
    + '.sf-profile-camera{position:absolute;right:-2px;bottom:-2px;width:28px;height:28px;border-radius:50%;'
    + 'background:linear-gradient(135deg,#FF6B9D,#FFB6C1);border:2px solid #fff;display:flex;align-items:center;'
    + 'justify-content:center;color:#fff;font-size:13px;cursor:pointer;box-shadow:0 2px 6px rgba(255,107,157,.4)}'
    + '.sf-profile-name-row{display:flex;align-items:center;justify-content:center;gap:6px;color:#3a2230;font-size:19px;font-weight:800}'
    + '.sf-profile-edit{cursor:pointer;color:#FF6B9D;font-size:15px;line-height:1}'
    + '.sf-profile-tag{display:inline-block;margin-top:8px;padding:3px 12px;border-radius:999px;font-size:12px;font-weight:700;'
    + 'color:#FF6B9D;background:linear-gradient(135deg,#FFE4EE,#FFF0F5);border:1px solid rgba(255,107,157,.25)}'
    + '.sf-profile-bio{margin-top:6px;color:#8a6a78;font-size:13px;line-height:1.5}'
    + '.sf-profile-stat{display:flex;gap:8px;padding:14px 0 4px;background:transparent!important}'
    + '.sf-profile-stat-item{flex:1;text-align:center;background:linear-gradient(135deg,#FFF0F5,#FFF5F7);'
    + 'border-radius:14px;padding:10px 4px;border:1px solid rgba(255,182,193,.35)}'
    + '.sf-profile-stat-item .num{color:#FF6B9D;font-size:18px;font-weight:800}'
    + '.sf-profile-stat-item .label{color:#a87b8c;font-size:11px;margin-top:2px}'
    + '.sf-profile-body{padding:0 12px 90px}'
    + '.sf-profile-empty{text-align:center;padding:36px 20px;color:#a87b8c}'
    + '.sf-profile-empty .mascot{margin:0 auto 12px;display:block}'
    + '.sf-profile-empty .tip{margin-top:10px;color:#FF6B9D;font-weight:700;font-size:14px}'
    + '.sf-profile-section-title{color:#a87b8c;font-size:13px;font-weight:700;margin:14px 4px 8px}'

    /* ---- doujin home: pairing bar + trope bar + generate button ---- */
    + '#dfHomeHeader{background:#FFF5F7;padding:10px;position:relative;z-index:5}'
    + '.df-bottom-nav{border-top:1px solid rgba(255,107,157,.12)!important}'
    + '.df-tab{color:#a87b8c!important}'
    + '.df-tab.active{color:#FF6B9D!important}'
    + '.df-pairing{display:flex;align-items:center;justify-content:center;gap:12px;padding:14px 12px 8px}'
    + '.df-pairing-side{display:flex;flex-direction:column;align-items:center;gap:4px;cursor:pointer;min-width:64px}'
    + '.df-pairing-avatar{width:54px;height:54px;border-radius:50%;display:flex;align-items:center;justify-content:center;'
    + 'color:#fff;font-size:20px;font-weight:700;overflow:hidden;border:3px solid #fff;'
    + 'box-shadow:0 3px 10px rgba(255,107,157,.25)}'
    + '.df-pairing-avatar img{width:100%;height:100%;object-fit:cover}'
    + '.df-pairing-name{font-size:12px;color:#5b3a4a;font-weight:700;max-width:72px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}'
    + '.df-pairing-x{font-size:18px;color:#FF6B9D;font-weight:800}'
    + '.df-pairing-change{font-size:10px;color:#FF6B9D;font-weight:600}'
    + '.df-home-gen-btn{margin:4px 12px 10px;padding:10px;border-radius:16px;text-align:center;color:#fff;font-weight:700;'
    + 'font-size:14px;background:linear-gradient(135deg,#FF6B9D,#FFB6C1);box-shadow:0 4px 12px rgba(255,107,157,.3);cursor:pointer}'
    + '.df-home-gen-btn:active{transform:scale(.98)}'
    + '.df-trope-bar{padding:4px 8px 12px}'
    + '.df-trope-bar-label{font-size:12px;color:#a87b8c;font-weight:700;padding:0 4px 6px}'
    + '.df-trope-chips{display:flex;flex-wrap:wrap;gap:6px;padding:0 4px}'
    + '.df-trope-chip{padding:4px 10px;border-radius:999px;background:#FFF0F5;color:#FF6B9D;font-size:12px;font-weight:600;'
    + 'border:1px solid rgba(255,107,157,.25);cursor:pointer;white-space:nowrap}'
    + '.df-trope-chip.selected{background:linear-gradient(135deg,#FF6B9D,#FFB6C1);color:#fff;border-color:transparent}'
    + '.df-trope-chip.add{background:#fff;border:1px dashed #FF6B9D;color:#FF6B9D}'
    + '.df-trope-chip.mgr{background:#fff;border:1px solid rgba(255,107,157,.3);color:#a87b8c}'

    /* ---- doujin generate page ---- */
    + '#dfGeneratePage{background:linear-gradient(180deg,#FFF0F5 0%,#fff 200px)}'
    + '.df-gen-back{display:flex;align-items:center;gap:10px;padding:10px 14px;background:#fff;border-bottom:1px solid rgba(255,107,157,.12);position:sticky;top:0;z-index:5}'
    + '.df-gen-back span{color:#3a2230;font-size:16px;font-weight:800}'
    + '.df-gen-back button{width:32px;height:32px;border-radius:50%;border:0;background:#FFF0F5;color:#FF6B9D;font-size:16px;cursor:pointer}'
    + '.df-gen-content{padding:16px 14px 24px}'
    + '.df-gen-section{background:#fff;border-radius:18px;padding:14px;margin-bottom:12px;box-shadow:0 3px 12px rgba(255,107,157,.08);border:1px solid rgba(255,182,193,.3)}'
    + '.df-gen-section-label{color:#a87b8c;font-size:13px;font-weight:700;margin-bottom:10px}'
    + '.df-gen-pairing{display:flex;align-items:center;justify-content:center;gap:14px;padding:6px 0 4px}'
    + '.df-gen-char{display:flex;flex-direction:column;align-items:center;gap:4px;cursor:pointer}'
    + '.df-gen-char-avatar{width:60px;height:60px;border-radius:50%;display:flex;align-items:center;justify-content:center;'
    + 'color:#fff;font-size:22px;font-weight:700;overflow:hidden;border:3px solid #fff;box-shadow:0 3px 10px rgba(255,107,157,.25)}'
    + '.df-gen-char-avatar img{width:100%;height:100%;object-fit:cover}'
    + '.df-gen-char-name{font-size:12px;color:#5b3a4a;font-weight:700}'
    + '.df-gen-char-x{font-size:20px;color:#FF6B9D;font-weight:800}'
    + '.df-gen-chips{display:flex;flex-wrap:wrap;gap:8px}'
    + '.df-gen-tags,.df-gen-tropes{display:flex;flex-wrap:wrap;gap:8px}'
    + '.df-gen-tag-chip,.df-gen-trope-chip{position:relative;padding:6px 14px;border-radius:999px;background:#FFF0F5;'
    + 'color:#FF6B9D;font-size:13px;font-weight:600;border:1px solid rgba(255,107,157,.25);cursor:pointer}'
    + '.df-gen-tag-chip.selected,.df-gen-trope-chip.selected{background:linear-gradient(135deg,#FF6B9D,#FFB6C1);color:#fff;border-color:transparent}'
    + '.df-gen-tag-chip.selected::before,.df-gen-trope-chip.selected::before{content:"\\\\2713 ";font-weight:800}'
    + '.df-trope-delete{margin-left:6px;color:inherit;opacity:.7;font-size:14px;line-height:1;cursor:pointer;font-weight:800}'
    + '.df-trope-delete:hover{opacity:1}'
    + '.df-tag-delete{margin-left:6px;color:inherit;opacity:.7;font-size:14px;line-height:1;cursor:pointer;font-weight:800}'
    + '.df-tag-delete:hover{opacity:1}'
    + '.df-gen-tag-chip.add,.df-gen-trope-chip.add{background:#fff;border:1px dashed #FF6B9D;color:#FF6B9D}'
    + '.df-trope-chip .df-trope-delete{color:#fff}'
    + '.df-trope-chip:not(.selected) .df-trope-delete{color:#FF6B9D}'
    + '.df-gen-custom{display:flex;gap:6px;margin-top:8px}'
    + '.df-gen-options{display:flex;flex-wrap:wrap;gap:8px}'
    + '.df-gen-option{padding:8px 14px;border-radius:14px;background:#FFF0F5;color:#FF6B9D;font-size:13px;font-weight:600;'
    + 'border:1px solid rgba(255,107,157,.25);cursor:pointer}'
    + '.df-gen-option.selected{background:linear-gradient(135deg,#FF6B9D,#FFB6C1);color:#fff;border-color:transparent}'
    + '.df-gen-request-input{width:100%;padding:10px 12px;border:1.5px solid #f0d0dc;border-radius:10px;font-size:13px;color:#333;background:#fff;resize:vertical;font-family:inherit;line-height:1.6;box-sizing:border-box;outline:none;transition:border-color .2s}'
    + '.df-gen-request-input:focus{border-color:#FF6B9D}'
    + '.df-gen-request-input::placeholder{color:#c0a0b0}'
    + '.df-gen-bottom-btn{width:100%;padding:15px;border:0;border-radius:18px;'
    + 'background:linear-gradient(135deg,#FF6B9D,#FFB6C1);color:#fff;font-size:16px;font-weight:800;cursor:pointer;'
    + 'box-shadow:0 6px 18px rgba(255,107,157,.35);margin-bottom:10px}'
    + '.df-gen-bottom-btn:active{transform:scale(.98)}'
    + '.df-gen-mascot{display:flex;flex-direction:column;align-items:center;padding:18px 0 6px;color:#a87b8c;font-size:12px}'
    + '.df-home-persona-row{display:flex;align-items:center;gap:10px}'
    + '.df-home-persona-info{flex:1;min-width:0}'
    + '.df-home-persona-name{font-size:14px;font-weight:700;color:#333}'
    + '.df-home-persona-bio{font-size:12px;color:#999;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}'
    + '.df-home-persona-edit-btn{padding:6px 14px;border:1px solid #FF6B9D;border-radius:999px;background:#fff;color:#FF6B9D;font-size:12px;font-weight:600;cursor:pointer}'
    + '.df-home-community-entry{display:flex;align-items:center;gap:10px;padding:12px;border-radius:14px;background:linear-gradient(135deg,#FFF0F5,#FFE4EC);cursor:pointer;transition:transform .15s}'
    + '.df-home-community-entry:active{transform:scale(.98)}'
    + '.df-community-grid{display:flex;flex-direction:column;gap:10px}'
    + '.df-persona-add-btn{padding:6px 12px;border:1px solid #FF6B9D;border-radius:999px;background:#fff;color:#FF6B9D;font-size:12px;font-weight:600;cursor:pointer;white-space:nowrap}'
    + '.df-persona-add-btn:active{transform:scale(.95)}'
    + '.df-persona-card-private{padding:2px 8px;border-radius:999px;font-size:10px;font-weight:600;background:#fff3e0;color:#e65100}'
    + '@keyframes dfSpin{to{transform:rotate(360deg)}}'

    /* ---- character picker overlay ---- */
    + '#dfCharPicker{position:absolute;inset:0;z-index:300;background:rgba(0,0,0,.45);display:none;align-items:center;justify-content:center;padding:24px}'
    + '#dfCharPicker.active{display:flex}'
    + '.df-char-picker-card{width:100%;max-width:320px;max-height:70vh;overflow-y:auto;background:#fff;border-radius:20px;padding:14px}'
    + '.df-char-picker-title{font-size:15px;font-weight:800;color:#3a2230;margin-bottom:10px;text-align:center}'
    + '.df-char-picker-item{display:flex;align-items:center;gap:10px;padding:10px;border-radius:14px;cursor:pointer}'
    + '.df-char-picker-item:active{background:#FFF0F5}'
    + '.df-char-picker-item.selected{background:linear-gradient(135deg,#FFF0F5,#FFF5F7)}'
    + '.df-char-picker-item img,.df-char-picker-item .ph{width:38px;height:38px;border-radius:50%;object-fit:cover;'
    + 'background:linear-gradient(135deg,#FF6B9D,#FFB6C1);display:flex;align-items:center;justify-content:center;color:#fff;font-weight:700}'
    + '.df-char-picker-item .nm{flex:1;color:#3a2230;font-size:14px;font-weight:600}'
    + '.df-char-picker-close{width:100%;margin-top:8px;padding:10px;border:0;border-radius:14px;background:#FFF0F5;color:#FF6B9D;font-weight:700;cursor:pointer}'
    + '.df-picker-tabs{display:flex;gap:6px;margin-bottom:10px}'
    + '.df-picker-tab{flex:1;padding:8px 4px;border-radius:10px;font-size:13px;font-weight:700;cursor:pointer;text-align:center;background:#FFF0F5;color:#a87b8c;transition:all .2s}'
    + '.df-picker-tab.active{background:linear-gradient(135deg,#FF6B9D,#FFB6C1);color:#fff}'
    + '.df-persona-card{display:flex;align-items:flex-start;gap:10px;padding:10px;border-radius:14px;cursor:pointer;margin-bottom:6px;position:relative}'
    + '.df-persona-card:active{background:#FFF0F5}'
    + '.df-persona-card.selected{background:linear-gradient(135deg,#FFF0F5,#FFF5F7)}'
    + '.df-persona-card-avatar{width:40px;height:40px;border-radius:50%;object-fit:cover;flex-shrink:0;background:linear-gradient(135deg,#FF6B9D,#FFB6C1);display:flex;align-items:center;justify-content:center;color:#fff;font-weight:700;font-size:16px}'
    + '.df-persona-card-info{flex:1;min-width:0}'
    + '.df-persona-card-name{font-size:14px;font-weight:700;color:#3a2230;margin-bottom:2px}'
    + '.df-persona-card-desc{font-size:12px;color:#999;line-height:1.4;overflow:hidden;text-overflow:ellipsis;display:-webkit-box;-webkit-line-clamp:2;-webkit-box-orient:vertical}'
    + '.df-persona-card-tags{display:flex;flex-wrap:wrap;gap:4px;margin-top:4px}'
    + '.df-persona-card-tag{font-size:10px;padding:1px 6px;border-radius:6px;background:rgba(255,107,157,.12);color:#FF6B9D}'
    + '.df-persona-card-del{position:absolute;top:8px;right:8px;width:22px;height:22px;border-radius:50%;background:rgba(255,107,157,.15);color:#FF6B9D;display:flex;align-items:center;justify-content:center;font-size:14px;cursor:pointer;font-weight:700}'
    + '.df-persona-card-edit{position:absolute;top:8px;right:36px;font-size:11px;padding:2px 8px;border-radius:8px;background:rgba(255,107,157,.12);color:#FF6B9D;cursor:pointer;font-weight:600}'
    + '.df-persona-card-private{position:absolute;top:8px;right:72px;font-size:10px;padding:1px 6px;border-radius:6px;background:#e8e8e8;color:#999}'
    + '.df-persona-create-btn{width:100%;padding:10px;border:1.5px dashed #FF6B9D;border-radius:14px;background:transparent;color:#FF6B9D;font-weight:700;cursor:pointer;margin-bottom:8px}'
    + '.df-persona-empty{text-align:center;color:#bbb;font-size:13px;padding:20px}'
    + '.df-community-search{padding:6px 8px}'
    + '.df-community-search-input{width:100%;box-sizing:border-box;font-size:13px;padding:8px 12px;border-radius:12px;border:1px solid rgba(255,107,157,.25);background:#FFF0F5;color:#5b3a4a;outline:none;font-family:inherit}'
    + '.df-community-search-input::placeholder{color:#ccaabb}'
    + '.df-community-search-input:focus{border-color:#FF6B9D}'
    + '.df-community-tag-filter{display:flex;flex-wrap:wrap;gap:6px;padding:4px 8px 8px}'
    + '.df-community-tag-chip{font-size:11px;padding:3px 10px;border-radius:12px;background:rgba(255,107,157,.08);color:#a87b8c;cursor:pointer;transition:all .15s;border:1px solid transparent}'
    + '.df-community-tag-chip.active{background:rgba(255,107,157,.2);color:#FF6B9D;border-color:rgba(255,107,157,.4);font-weight:600}'
    + '.df-persona-modal-field{margin-bottom:12px}'
    + '.df-persona-modal-field label{display:block;font-size:13px;font-weight:700;color:#a87b8c;margin-bottom:5px}'
    + '.df-persona-modal-field input,.df-persona-modal-field textarea{width:100%;box-sizing:border-box;font-size:14px;padding:10px 12px;border-radius:12px;border:1px solid rgba(255,107,157,.25);background:#FFF0F5;color:#5b3a4a;font-family:inherit}'
    + '.df-persona-modal-field textarea{resize:vertical;line-height:1.5}'
    + '.df-persona-avatar-upload{display:flex;align-items:center;gap:10px}'
    + '.df-persona-avatar-preview{width:50px;height:50px;border-radius:50%;object-fit:cover;background:linear-gradient(135deg,#FF6B9D,#FFB6C1);display:flex;align-items:center;justify-content:center;color:#fff;font-weight:700}'
    + '.df-persona-avatar-btn{padding:6px 12px;border-radius:10px;border:1px solid rgba(255,107,157,.3);background:#fff;color:#FF6B9D;font-size:12px;font-weight:600;cursor:pointer}'
    + '.df-persona-toggle{display:flex;align-items:center;gap:8px}'
    + '.df-persona-toggle-switch{width:40px;height:22px;border-radius:11px;background:#ddd;position:relative;cursor:pointer;transition:background .2s}'
    + '.df-persona-toggle-switch.on{background:#FF6B9D}'
    + '.df-persona-toggle-switch::after{content:"";position:absolute;top:2px;left:2px;width:18px;height:18px;border-radius:50%;background:#fff;transition:transform .2s}'
    + '.df-persona-toggle-switch.on::after{transform:translateX(18px)}'
    + '.df-persona-toggle-label{font-size:13px;color:#a87b8c}'

    /* ---- shared modal (trope creation + 催更) ---- */
    + '.df-modal-overlay{position:absolute;inset:0;z-index:400;background:rgba(0,0,0,.45);display:none;align-items:center;justify-content:center;padding:24px}'
    + '.df-modal-overlay.active{display:flex}'
    + '.df-modal-card{width:100%;max-width:340px;max-height:80vh;overflow-y:auto;background:#fff;border-radius:20px;padding:18px;'
    + 'box-shadow:0 12px 40px rgba(0,0,0,.2)}'
    + '.df-modal-title{font-size:17px;font-weight:800;color:#3a2230;text-align:center;margin-bottom:14px}'
    + '.df-modal-field{margin-bottom:14px}'
    + '.df-modal-field label{display:block;color:#a87b8c;font-size:13px;font-weight:700;margin-bottom:6px}'
    + '.df-modal-field .df-input,.df-modal-field .df-textarea{width:100%;box-sizing:border-box;font-size:14px;padding:10px 12px;'
    + 'border-radius:12px;border:1px solid rgba(255,107,157,.25);background:#FFF0F5;color:#5b3a4a}'
    + '.df-modal-field .df-textarea{resize:vertical;font-family:inherit;line-height:1.5}'
    + '.df-modal-actions{display:flex;gap:10px;margin-top:6px}'
    + '.df-modal-btn{flex:1;padding:11px;border:0;border-radius:14px;font-size:14px;font-weight:700;cursor:pointer}'
    + '.df-modal-btn.cancel{background:#FFF0F5;color:#a87b8c}'
    + '.df-modal-btn.save{background:linear-gradient(135deg,#FF6B9D,#FFB6C1);color:#fff;box-shadow:0 4px 12px rgba(255,107,157,.3)}'
    + '.df-slider{width:100%;accent-color:#FF6B9D;cursor:pointer}'
    + '.df-continue-cost{margin:4px 0 2px;color:#5b3a4a;font-size:14px;font-weight:700;text-align:center}'
    + '.df-continue-cost b{color:#FF6B9D;font-size:18px}'
    + '.df-continue-tip{color:#a87b8c;font-size:12px;text-align:center;margin-bottom:10px}'
    + '.df-modal-mask{position:absolute;inset:0;z-index:450;background:rgba(0,0,0,.45);display:flex;align-items:center;justify-content:center;padding:24px}'
    + '.df-trope-mgr-card{width:100%;max-width:340px;max-height:80vh;overflow-y:auto;background:#fff;border-radius:20px;padding:18px;box-shadow:0 12px 40px rgba(0,0,0,.2)}'
    + '.df-trope-mgr-list{margin-bottom:14px}'
    + '.df-mgr-trope-item{display:flex;align-items:center;gap:8px;padding:10px 12px;border-radius:12px;background:#FFF0F5;margin-bottom:6px}'
    + '.df-mgr-trope-name{flex:1;font-size:14px;color:#5b3a4a;font-weight:600}'
    + '.df-mgr-trope-tag{font-size:11px;padding:2px 8px;border-radius:8px;background:#FF6B9D;color:#fff;font-weight:600}'
    + '.df-mgr-trope-tag.preset{background:#a18cd1}'
    + '.df-mgr-trope-del{width:24px;height:24px;display:flex;align-items:center;justify-content:center;border-radius:50%;background:rgba(255,107,157,.15);color:#FF6B9D;font-size:16px;cursor:pointer;font-weight:700}'
    + '.df-mgr-trope-del:active{background:rgba(255,107,157,.3)}'
    + '.df-trope-mgr-actions{display:flex;gap:10px}'
    + '.df-trope-mgr-btn{flex:1;padding:11px;border:0;border-radius:14px;font-size:14px;font-weight:700;cursor:pointer}'
    + '.df-trope-mgr-btn.restore{background:#FFF0F5;color:#a87b8c}'
    + '.df-trope-mgr-btn.close{background:linear-gradient(135deg,#FF6B9D,#FFB6C1);color:#fff;box-shadow:0 4px 12px rgba(255,107,157,.3)}'

    /* ---- bookshelf grid (2 per row) ---- */
    + '.df-bookshelf-grid{display:grid;grid-template-columns:1fr 1fr;gap:12px;padding:12px}'
    + '.df-book-card{background:#fff;border-radius:16px;overflow:hidden;cursor:pointer;box-shadow:0 3px 12px rgba(255,107,157,.08);'
    + 'border:1px solid rgba(255,182,193,.3);transition:transform .12s}'
    + '.df-book-card:active{transform:scale(.97)}'
    + '.df-book-cover{position:relative;height:140px;display:flex;align-items:center;justify-content:center;padding:12px}'
    + '.df-book-cover::after{content:"";position:absolute;inset:0;background:radial-gradient(circle at 30% 25%,rgba(255,255,255,.3),transparent 60%)}'
    + '.df-book-cover-title{position:relative;color:#fff;font-size:15px;font-weight:800;text-align:center;line-height:1.4;'
    + 'text-shadow:0 1px 4px rgba(0,0,0,.25);display:-webkit-box;-webkit-line-clamp:3;-webkit-box-orient:vertical;overflow:hidden}'
    + '.df-book-cover-chapters{position:absolute;right:8px;bottom:8px;background:rgba(255,255,255,.85);color:#FF6B9D;font-size:10px;'
    + 'font-weight:700;padding:2px 8px;border-radius:999px;z-index:1}'
    + '.df-book-title{padding:8px 10px 2px;color:#3a2230;font-size:13px;font-weight:700;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}'
    + '.df-book-author{padding:0 10px 10px;color:#a87b8c;font-size:11px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}'

    /* ---- book detail page ---- */
    + '.df-book-detail-content{padding:16px 14px 28px}'
    + '.df-book-detail-cover{height:150px;border-radius:16px;display:flex;align-items:center;justify-content:center;margin-bottom:14px;'
    + 'position:relative;overflow:hidden}'
    + '.df-book-detail-cover::after{content:"";position:absolute;inset:0;background:radial-gradient(circle at 30% 25%,rgba(255,255,255,.3),transparent 60%)}'
    + '.df-book-detail-cover .df-book-cover-title{position:relative;font-size:20px;-webkit-line-clamp:4}'
    + '.df-book-detail-head{position:relative;margin-bottom:12px}'
    + '.df-book-detail-title{color:#3a2230;font-size:18px;font-weight:800;line-height:1.4}'
    + '.df-book-detail-author{color:#a87b8c;font-size:13px;margin-top:4px}'
    + '.df-book-detail-collected{display:inline-block;margin-top:8px;background:linear-gradient(135deg,#FF6B9D,#FFB6C1);color:#fff;'
    + 'font-size:11px;font-weight:700;padding:3px 10px;border-radius:999px}'
    + '.df-continue-btn{width:100%;padding:12px;border:0;border-radius:16px;background:linear-gradient(135deg,#FF6B9D,#FFB6C1);'
    + 'color:#fff;font-size:15px;font-weight:800;cursor:pointer;box-shadow:0 4px 12px rgba(255,107,157,.3);margin-bottom:16px}'
    + '.df-continue-btn:active{transform:scale(.98)}'
    + '.df-book-detail-section{background:#fff;border-radius:16px;padding:14px;margin-bottom:12px;'
    + 'box-shadow:0 3px 12px rgba(255,107,157,.06);border:1px solid rgba(255,182,193,.25)}'
    + '.df-book-detail-section-label{color:#a87b8c;font-size:13px;font-weight:700;margin-bottom:10px}'
    + '.df-chapter-list{display:flex;flex-direction:column;gap:6px}'
    + '.df-chapter-item{display:flex;align-items:center;justify-content:space-between;padding:10px 12px;border-radius:12px;cursor:pointer;'
    + 'background:#FFF0F5;border:1px solid transparent}'
    + '.df-chapter-item:active{background:#FFE4EE}'
    + '.df-chapter-item.active{background:linear-gradient(135deg,#FFF0F5,#FFF5F7);border-color:rgba(255,107,157,.3)}'
    + '.df-chapter-title{color:#3a2230;font-size:13px;font-weight:600;flex:1;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}'
    + '.df-chapter-read{color:#FF6B9D;font-size:11px;font-weight:700;background:#fff;padding:2px 8px;border-radius:999px;border:1px solid rgba(255,107,157,.25)}'
    + '.df-chapter-delete{margin-left:8px;color:#ccc;font-size:16px;line-height:1;cursor:pointer;padding:4px 6px;border-radius:6px;flex-shrink:0}'
    + '.df-chapter-delete:hover{color:#e74c3c;background:rgba(231,76,60,.1)}'
    + '.df-book-detail-chapter-body{color:#3a2230;font-size:14px;line-height:1.8;white-space:pre-wrap;word-break:break-word}'
    + '.df-update-next-btn{width:100%;padding:13px;border:0;border-radius:16px;background:#fff;color:#FF6B9D;font-size:15px;font-weight:800;'
    + 'cursor:pointer;border:1px dashed #FF6B9D;margin-top:4px}'
    + '.df-update-next-btn:active{transform:scale(.98)}';

  var style = document.createElement('style');
  style.setAttribute('data-forum-pink', '1');
  style.textContent = css;
  document.head.appendChild(style);
};


/* ======================================================================
 *  PART 1 - SOCIAL FORUM  (Twitter / Weibo dark theme)
 * ==================================================================== */

/* ---- state ---- */
var sfState = {
  active: false,
  currentTab: 'following',
  posts: { following: [], recommended: [], gossip: [] },
  currentRole: null,
  isLoading: false,
  sideMenuOpen: false,
  userProfile: { posts: 0, followers: 0, following: 0, likes: 0, avatar: null },
  currentView: 'feed',
  userPosts: [],
  commentsCache: {},
  currentPostId: null,
  notifCache: null,
  loading: { following: false, recommended: false, gossip: false },
  followedRoles: [], // 已关注的角色 [{id, name, prompt, avatar}]
  likedPosts: [], // 点赞过的帖子记录
  savedPosts: [], // 收藏过的帖子记录
  profileTab: 'posts', // 个人主页当前标签页
};

var sfSaveFollowedRoles = function () {
  try { localStorage.setItem('sf_followed_roles', JSON.stringify(sfState.followedRoles)); } catch(e) {}
};

/* ---- cache versioning: invalidate old cached posts when code updates ---- */
var SF_CACHE_VERSION = 'v2_20260725';
try {
  var storedVer = localStorage.getItem('sf_cache_version');
  if (storedVer !== SF_CACHE_VERSION) {
    ['following', 'recommended', 'gossip'].forEach(function(t) {
      localStorage.removeItem('sf_posts_' + t);
    });
    localStorage.setItem('sf_cache_version', SF_CACHE_VERSION);
  }
} catch(e) {}

/* ---- fallback content ---- */
var SF_FALLBACK_NAMES = [
  '月光下的猫', '深夜食堂', '柠檬不萌', '星河滚烫', '草莓味晚风',
  '云朵邮局', '人间清醒', '气泡水加冰', '银河系迷路', '温柔半两',
  '海盐焦糖', '落日余晖', '雾里看花', '三餐四季', '月亮邮递员'
];

var SF_VERIFIED_NAMES = ['月光下的猫', '星河滚烫', '云朵邮局', '人间清醒', '落日余晖'];

/* 角色自己发的帖子模板（第一人称，角色视角） */
var SF_FOLLOWING_TEMPLATES_SHORT = [
  '今天天气不错，心情也很好☀️',
  '刚读完一本书，感触挺深的。',
  '下班路上的晚霞太美了。',
  '今天学了个新技能，开心！',
  '深夜了，睡不着，来碎碎念一下。',
  '今天遇到一件有趣的事，忍不住想分享。'
];

var SF_FOLLOWING_TEMPLATES_MEDIUM = [
  '今天发生了一件事让我很有感触。有些路确实只能一个人走，但正因为如此，每一步都算数。感谢一直陪伴我的人，你们是我前进的动力💪 #生活感悟 #日常',
  '最近在思考一个问题：我们到底在追求什么？名利？安稳？还是内心真正的平静？也许每个人答案不同，但我觉得，能做自己喜欢的事，就已经很幸福了。',
  '今天和一位老朋友重逢，聊了很多往事。时间过得真快，有些记忆已经模糊了，但那份温暖的感觉还在。珍惜身边的人，珍惜当下的每一刻吧✨',
  '工作了一天，虽然很累但很充实。每当完成一个项目，那种成就感是什么都替代不了的。继续加油，为了更好的自己！#打工人的日常'
];

var SF_FOLLOWING_TEMPLATES_LONG = [
  '今天想认真记录一下最近的心境变化。这段时间经历了很多，有起有落，但回头看看，每一段经历都让我成长了不少。\\n\\n以前总觉得时间还很长，很多事情可以慢慢来。但现在越来越意识到，当下的每一刻都是独一无二的。那些你以为会一直都在的人和事，可能某天就悄悄改变了。\\n\\n所以，想做什么就去做吧，想说什么就去说吧。别等到失去了才后悔。这段话也是写给自己看的，提醒自己要珍惜眼前人，活在当下。🌟 #感悟 #生活记录',
  '今天翻到了以前写的一些笔记，突然很感慨。那时候的自己，稚嫩、冲动，但也很真诚。虽然有些想法现在看来很天真，但那份热情和勇气，是现在的我需要重新找回的东西。\\n\\n人生就是这样一个不断告别过去、拥抱未来的过程吧。不后悔走过的每一步，因为正是这些经历，塑造了今天的我。\\n\\n接下来想尝试一些新的事物，走出舒适区。也许会失败，但至少不会遗憾。大家一起加油吧！💪 #成长 #自我反思'
];

/* 推荐页帖子模板 - 多种类型和字数混合 */
var SF_RECOMMENDED_TEMPLATES = [
  /* 短帖 50-150字 */
  '今天的天空也太好看了吧，随手拍都是壁纸级别的☁️',
  '终于把拖延了很久的事情做完了，爽！💪',
  '深夜emo：有些路只能一个人走，但没关系。',
  '今天的小确幸：买到了最后一份限定蛋糕🍰',
  '突然下暴雨了，没带伞，淋成落汤鸡但莫名很开心😂',
  /* 中等帖 150-300字 */
  '今天做了一道新菜，虽然卖相一般但味道意外地好！简单说一下做法：先将食材处理干净，然后热锅下油，爆香蒜末后放入主料翻炒，最后加调料收汁。整个过程不到二十分钟，非常适合上班族。分享给大家，有空可以试试~🍳 #美食 #家常菜',
  '推荐一本最近在看的书，真的太好哭了。讲的是一个人在逆境中不放弃的故事，每一章都让我想起自己曾经经历过的低谷。书里有句话印象很深："黑夜再长，天总会亮的。"建议大家备好纸巾，但读完之后会觉得充满了力量📚 #读书推荐',
  '周末去了一个超美的小众景点，人少景美。一路上经过了好几个小村庄，每个地方都有自己的味道。最惊喜的是傍晚的日落，金色的光芒洒在山谷里，那种宁静的感觉城市里完全体会不到。分享一波照片📸 #旅行 #小众景点',
  /* 长帖 300-500字 */
  '最近迷上了手冲咖啡，每天早上的仪式感太幸福了。从选豆子、磨粉、烧水到注水，每一个步骤都需要耐心和专注。刚开始做的时候总是掌握不好水温和粉的粗细，做出来的咖啡要么太苦要么太淡。但经过一周的练习，终于找到了适合自己的比例。\\n\\n其实手冲咖啡最大的魅力不在于味道本身，而在于那个过程。清晨起来，安静的厨房里只有水流的声音，闻着咖啡豆的香气，感觉整个人都被治愈了。这大概就是生活中最简单也最真实的幸福感吧☕ #手冲咖啡 #生活仪式感',
  '深夜想聊聊一个话题：我们为什么总是害怕改变？\\n\\n最近身边好几个朋友都在面临选择的十字路口——换工作、搬家、结束一段关系。每个人都在犹豫，害怕做出错误的决定。但仔细想想，维持现状就一定是正确的吗？\\n\\n我自己也经历过类似的挣扎。曾经在一个不太喜欢的岗位上待了两年，每天按部就班，虽然安稳但总觉得缺了点什么。后来终于鼓起勇气辞职，虽然过程很曲折，但现在回头看，那是我做过最正确的决定之一。\\n\\n所以想告诉正在犹豫的你：改变确实可怕，但遗憾更可怕。与其在原地纠结，不如迈出那一步。即使结果不如预期，至少你尝试过了，不会在未来的某天后悔"当初为什么没有..."。共勉🌙 #深夜思考 #人生选择'
];

var SF_GOSSIP_TEMPLATES = [
  '听说隔壁部门的同事要辞职去开奶茶店了，好突然啊...',
  '今天在地铁上听到有人讨论那个热门话题，大家怎么看？',
  '朋友圈有人发了条意味深长的动态，是不是在暗示什么...',
  '最近那个综艺的瓜大家吃了吗？反转也太多了吧🍉',
  '听说那家网红店其实味道一般，全靠营销？',
  '有个人在图书馆占座被怼了，场面一度很尴尬...',
  '震惊！据说某位大V的真实身份居然是...算了不敢说🤫',
  '今天听到一个八卦，简直比电视剧还精彩，大家身边有什么类似的吗？'
];

var SF_COMMENT_AUTHORS = [
  '碎碎念bot', '深夜食堂', '柠檬不萌', '星河滚烫', '草莓味晚风',
  '云朵邮局', '人间清醒', '气泡水加冰', '银河系迷路', '温柔半两'
];
var SF_COMMENT_TEMPLATES = [
  '说得太对了！', '哇这个好有意思', '我也是这么觉得的', '哈哈笑死我了',
  '楼主好会说话', '已收藏！', '这才是真实的生活啊', '看完心情变好了',
  '同感同感', '可以可以，学到了', '这也太真实了吧', '楼主继续更新啊'
];

var sfFallbackPosts = function (tab, roleName, followedRolesData) {
  var isFollowing = (tab === 'following');
  var isGossip = (tab === 'gossip');
  var roles = Array.isArray(followedRolesData) ? followedRolesData : [];
  if (roles.length === 0 && roleName) {
    roles = [{ name: roleName, prompt: '', avatar: null }];
  }

  var count = isFollowing ? Math.max(6, roles.length * 2) : (6 + Math.floor(Math.random() * 3));
  var posts = [];

  /* 帖子模板按长度分组：短/中/长 */
  var allTemplates = isFollowing
    ? SF_FOLLOWING_TEMPLATES_SHORT.concat(SF_FOLLOWING_TEMPLATES_MEDIUM, SF_FOLLOWING_TEMPLATES_LONG)
    : isGossip
      ? SF_GOSSIP_TEMPLATES
      : SF_RECOMMENDED_TEMPLATES;
  var shortT = SF_FOLLOWING_TEMPLATES_SHORT;
  var medT = SF_FOLLOWING_TEMPLATES_MEDIUM;
  var longT = SF_FOLLOWING_TEMPLATES_LONG;
  var recT = SF_RECOMMENDED_TEMPLATES;
  var gosT = SF_GOSSIP_TEMPLATES;

  for (var i = 0; i < count; i++) {
    var nameIdx = (i * 3 + Math.floor(Math.random() * 5)) % SF_FALLBACK_NAMES.length;
    var author, content, roleData = null;

    if (isFollowing) {
      /* 关注页：角色自己发的帖子，轮换使用不同角色 */
      roleData = roles[i % roles.length];
      author = roleData.name || roleName || 'TA';
      /* 混合不同长度：约30%短、40%中、30%长 */
      var lenBucket = i % 10;
      if (lenBucket < 3) {
        content = shortT[Math.floor(Math.random() * shortT.length)];
      } else if (lenBucket < 7) {
        content = medT[Math.floor(Math.random() * medT.length)];
      } else {
        content = longT[Math.floor(Math.random() * longT.length)];
      }
    } else if (isGossip) {
      author = SF_FALLBACK_NAMES[nameIdx];
      content = gosT[i % gosT.length];
    } else {
      /* 推荐页：混合不同长度和类型 */
      author = SF_FALLBACK_NAMES[nameIdx];
      content = recT[i % recT.length];
    }

    var post = {
      id: tab + '-sf-fb-' + Date.now() + '-' + i,
      authorName: author,
      handle: forumHandle(author),
      verified: isFollowing ? false : (SF_VERIFIED_NAMES.indexOf(SF_FALLBACK_NAMES[nameIdx]) !== -1),
      content: content,
      time: ['刚刚', '3分钟前', '10分钟前', '半小时前', '1小时前', '6小时前', '今天'][i % 7],
      likes: Math.floor(Math.random() * 300) + 5,
      reposts: Math.floor(Math.random() * 50),
      comments: Math.floor(Math.random() * 60) + 1,
      views: Math.floor(Math.random() * 8000) + 200,
      avatarIndex: isFollowing ? 0 : (nameIdx % 8),
      imageGradient: forumRandomGradient(nameIdx),
      commentsList: []
    };
    /* following posts: role-authored, use role avatar */
    if (isFollowing) {
      post.roleAuthored = true;
      post.imageGradient = ['#FF6B9D', '#FFB6C1'];
      if (roleData) {
        post.roleAvatar = forumRoleAvatarSrc(roleData);
      }
    }
    posts.push(post);
  }
  return posts;
};

var sfFallbackComments = function () {
  var n = 2 + Math.floor(Math.random() * 3);
  var arr = [];
  for (var i = 0; i < n; i++) {
    var idx = Math.floor(Math.random() * SF_COMMENT_AUTHORS.length);
    arr.push({
      id: 'sc-fb-' + Date.now() + '-' + i,
      authorName: SF_COMMENT_AUTHORS[idx],
      content: SF_COMMENT_TEMPLATES[Math.floor(Math.random() * SF_COMMENT_TEMPLATES.length)],
      time: ['刚刚', '2分钟前', '5分钟前', '15分钟前'][i % 4],
      avatarIndex: idx % 8
    });
  }
  return arr;
};

/* ---- open / close ---- */
var openSocialForum = function (role) {
  sfState.currentRole = role || (typeof activeRole === 'function' ? activeRole() : null);
  if (typeof closeDoujinForum === 'function') closeDoujinForum();
  sfState.active = true;
  sfState.currentTab = 'following';
  sfState.currentView = 'me';
  sfState.posts = {};
  ['following', 'recommended', 'gossip'].forEach(function(t) {
    try {
      var saved = localStorage.getItem('sf_posts_' + t);
      sfState.posts[t] = saved ? JSON.parse(saved) : [];
    } catch(e) { sfState.posts[t] = []; }
  });
  sfState.loading = { following: false, recommended: false, gossip: false };
  sfState.notifCache = null;
  sfState.isLoading = false;
  sfState.sideMenuOpen = false;

  /* 检查后台任务 */
  bgCheckAllTasks();

  /* load saved profile */
  try {
    var saved = localStorage.getItem('sf_user_profile');
    if (saved) {
      var parsed = JSON.parse(saved);
      sfState.userProfile.avatar = parsed.avatar || null;
    }
  } catch (e) {}

  /* load saved followedRoles */
  try {
    var savedFollowed = localStorage.getItem('sf_followed_roles');
    if (savedFollowed) {
      try { sfState.followedRoles = JSON.parse(savedFollowed); } catch(e) {}
    }
  } catch(e) {}
  // 如果followed为空但当前有角色，自动添加当前角色
  if (sfState.followedRoles.length === 0 && sfState.currentRole) {
    sfState.followedRoles.push({
      id: sfState.currentRole.id,
      name: sfState.currentRole.name,
      prompt: (sfState.currentRole.prompt || '').slice(0, 200),
      avatar: sfState.currentRole.avatar || sfState.currentRole.image
    });
    sfSaveFollowedRoles();
  }

  var overlay = forumEl('socialForumOverlay');
  if (overlay) overlay.classList.add('active');

  sfRenderSideMenu();
  sfRenderNavAvatar();
  sfSwitchView('me');
  /* 不自动加载，等用户点击生成按钮 */
};

/* 渲染左上角导航头像（使用用户主页的头像/昵称，而非角色信息） */
var sfRenderNavAvatar = function () {
  sfLoadProfileMeta();
  var navAvatar = forumEl('sfNavAvatar');
  if (!navAvatar) return;
  var name = sfState.userProfile.displayName || '体验用户';
  var avatarSrc = sfState.userProfile.avatar || null;
  if (avatarSrc) {
    navAvatar.innerHTML = '<img src="' + avatarSrc + '" style="width:100%;height:100%;border-radius:50%;object-fit:cover" alt="" />';
  } else {
    navAvatar.innerHTML = escapeHtml(forumInitial(name));
  }
};

var closeSocialForum = function () {
  sfState.active = false;
  var overlay = forumEl('socialForumOverlay');
  if (overlay) overlay.classList.remove('active');
  sfClosePostDetail();
  sfClosePostModal();
  sfCloseSideMenu();
};

/* ---- view switching ---- */
var sfSwitchView = function (view) {
  /* 'home' (bottom nav) and 'feed' (internal) refer to the same home view */
  var normView = (view === 'home') ? 'feed' : view;
  sfState.currentView = normView;
  /* hide all views */
  document.querySelectorAll('#sfContent .sf-view').forEach(function (v) {
    v.classList.remove('active');
  });

  var viewMap = {
    feed: 'sfHomeView',
    search: 'sfSearchView',
    notifications: 'sfNotifView',
    me: 'sfMeView'
  };
  var el = forumEl(viewMap[normView]);
  if (el) el.classList.add('active');

  /* update bottom nav (home tab highlights for the feed view too) */
  document.querySelectorAll('.sf-bottom-nav .sf-tab').forEach(function (t) {
    var tv = t.dataset.sfView;
    t.classList.toggle('active', tv === normView || (normView === 'me' && tv === 'me'));
  });

  /* FAB visible on feed + profile so users can publish from either */
  var fab = forumEl('sfFab');
  if (fab) fab.style.display = (normView === 'feed' || normView === 'me') ? 'grid' : 'none';

  if (normView === 'feed') sfRenderTimeline(sfState.currentTab);
  else if (normView === 'search') sfRenderTrends();
  else if (normView === 'notifications') sfRenderNotifications();
  else if (normView === 'me') sfRenderProfile();
};

/* ---- followed roles UI ---- */
var sfGetAllRoles = function () {
  var allRoles = [];
  try {
    if (typeof state === 'object' && state.roles) {
      allRoles = state.roles.map(function(r) {
        return { id: r.id, name: r.name, prompt: (r.prompt || '').slice(0, 200), avatar: r.avatar || r.image };
      });
    }
  } catch(e) {}
  return allRoles;
};

var sfRenderFollowedRoles = function () {
  var container = forumEl('sfFollowedRoles');
  if (!container) return;
  if (sfState.followedRoles.length === 0) {
    container.innerHTML = '<div class="sf-followed-empty">暂未关注角色，点击下方添加</div>';
  } else {
    var items = sfState.followedRoles.map(function(r, i) {
      var avatarSrc = forumRoleAvatarSrc(r);
      return '<div class="sf-followed-item">'
        + '<img class="sf-followed-avatar" src="' + escapeHtml(avatarSrc) + '" />'
        + '<span class="sf-followed-name">' + escapeHtml(r.name || '未命名') + '</span>'
        + '<button class="sf-followed-remove" data-sf-remove-role="' + i + '">&times;</button>'
        + '</div>';
    }).join('');
    container.innerHTML = items;
  }
};

var sfOpenRolePicker = function () {
  var allRoles = sfGetAllRoles();
  var followedIds = sfState.followedRoles.map(function(r) { return r.id; });

  var itemsHtml = allRoles.map(function(r) {
    var isFollowed = followedIds.indexOf(r.id) !== -1;
    var avatarSrc = forumRoleAvatarSrc(r);
    return '<div class="sf-role-picker-item' + (isFollowed ? ' followed' : '') + '" data-sf-pick-role-id="' + escapeHtml(r.id || '') + '" data-sf-pick-role-name="' + escapeHtml(r.name || '') + '">'
      + '<img class="sf-role-picker-avatar" src="' + escapeHtml(avatarSrc) + '" />'
      + '<span class="sf-role-picker-name">' + escapeHtml(r.name || '未命名') + '</span>'
      + (isFollowed ? '<span class="sf-role-picker-check">&#10003;</span>' : '')
      + '</div>';
  }).join('');

  var overlay = forumEl('sfRolePickerOverlay');
  if (!overlay) return;
  overlay.innerHTML = '<div class="sf-role-picker-card">'
    + '<div class="sf-role-picker-title">选择角色</div>'
    + '<div class="sf-role-picker-list">' + (itemsHtml || '<div style="color:#888;padding:20px;text-align:center">没有可添加的角色</div>') + '</div>'
    + '<button class="sf-role-picker-close-btn" id="sfRolePickerCloseBtn">关闭</button>'
    + '</div>';
  overlay.classList.add('active');

  var closeBtn = document.getElementById('sfRolePickerCloseBtn');
  if (closeBtn) closeBtn.addEventListener('click', sfCloseRolePicker);

  overlay.querySelectorAll('[data-sf-pick-role-id]').forEach(function(el) {
    el.addEventListener('click', function() {
      var roleId = el.dataset.sfPickRoleId;
      var roleName = el.dataset.sfPickRoleName;
      var idx = -1;
      for (var i = 0; i < sfState.followedRoles.length; i++) {
        if (sfState.followedRoles[i].id === roleId) { idx = i; break; }
      }
      if (idx !== -1) {
        sfState.followedRoles.splice(idx, 1);
      } else {
        var roleData = allRoles.find(function(r) { return r.id === roleId; });
        if (roleData) sfState.followedRoles.push(roleData);
      }
      sfSaveFollowedRoles();
      sfOpenRolePicker(); // 重新渲染列表
      sfRenderFollowedRoles();
    });
  });
};

var sfCloseRolePicker = function () {
  var overlay = forumEl('sfRolePickerOverlay');
  if (overlay) overlay.classList.remove('active');
};

var sfSwitchTab = function (tab) {
  sfState.currentTab = tab;
  document.querySelectorAll('.sf-sub-tab').forEach(function (t) {
    t.classList.toggle('active', t.dataset.sfTab === tab);
  });
  sfRenderTimeline(tab);
};

/* ---- data loading ---- */
var sfLoadTab = async function (tab) {
  sfState.loading[tab] = true;
  sfState.isLoading = true;
  if (sfState.active && sfState.currentView === 'feed' && tab === sfState.currentTab) {
    var tl = forumEl('sfTimeline');
    if (tl && sfState.posts[tab].length === 0) {
      tl.innerHTML = '<div class="sf-loading">正在加载...</div>';
    }
  }

  var role = sfState.currentRole || (typeof activeRole === 'function' ? activeRole() : null);
  var messages = [];
  if (role && typeof getMessages === 'function') {
    try {
      messages = getMessages(role.id).slice(-8).map(function (m) {
        return { role: m.role, content: m.content };
      });
    } catch (e) {}
  }

  var memories = [];
  try {
    if (typeof api !== 'undefined' && typeof api.listMemories === 'function') {
      var mem = await api.listMemories(role ? role.id : '');
      memories = (mem && mem.list) ? mem.list.slice(0, 6) : [];
    }
  } catch (e) {}

  try {
    var result = await request('/forum/generate', {
      method: 'POST',
      body: JSON.stringify({
        tab: tab,
        followedRoles: tab === 'following' ? sfState.followedRoles : [],
        roleName: role ? role.name : '',
        rolePrompt: role ? role.prompt : '',
        recentMessages: messages,
        memories: memories,
        worldRole: null,
        background: true
      })
    });

    /* 后台模式：服务器立即返回 taskId */
    if (result && result.background && result.taskId) {
      bgTaskState.pending[result.taskId] = { type: 'forum' };
      bgPollTask(result.taskId, function (res) {
        bgNotifyDone('forum', '生成论坛帖子', res);
        sfState.loading[tab] = false;
        sfState.isLoading = false;
        if (sfState.active && sfState.currentView === 'feed' && tab === sfState.currentTab) {
          sfRenderTimeline(tab);
        }
      }, function (err) {
        sfState.loading[tab] = false;
        sfState.isLoading = false;
        forumToast('生成失败：' + err);
        if (sfState.active && sfState.currentView === 'feed' && tab === sfState.currentTab) {
          sfRenderTimeline(tab);
        }
      });
      return;
    }

    /* 同步模式（兼容旧服务器） */
    if (result && result.error) {
      forumToast('AI生成失败：' + result.error);
    }
    var posts = (result && result.posts) ? result.posts : [];
    /* no fallback: if AI returned nothing, show empty state */
    /* normalize posts */
    posts.forEach(function (p, i) {
      if (!p.handle) p.handle = forumHandle(p.authorName);
      if (typeof p.verified !== 'boolean') p.verified = false;
      if (typeof p.reposts !== 'number') p.reposts = Math.floor(Math.random() * 50);
      if (typeof p.comments !== 'number') p.comments = (p.commentsList || []).length;
      if (typeof p.views !== 'number') p.views = Math.floor(Math.random() * 8000) + 200;
      if (!p.imageGradient) p.imageGradient = forumRandomGradient(i);
      /* "following" = 角色发布的帖子，authorName由AI根据followedRoles决定 */
      if (tab === 'following') {
        p.roleAuthored = true;
        // 不强制修改 authorName，让AI按角色分配
        p.verified = false;
        // 根据authorName匹配对应的角色头像
        if (sfState.followedRoles.length > 0) {
          var matchedRole = sfState.followedRoles.find(function(r) { return r.name === p.authorName; });
          if (matchedRole) {
            p.roleAvatar = forumRoleAvatarSrc(matchedRole);
            p.handle = forumHandle(matchedRole.name);
          }
        } else if (role) {
          // 无followedRoles时回退到当前角色
          p.authorName = role.name;
          p.handle = forumHandle(role.name);
          p.roleAvatar = forumRoleAvatarSrc(role);
        }
      }
    });
    sfState.posts[tab] = posts;
    posts.forEach(function (p) {
      if (!sfState.commentsCache[p.id]) sfState.commentsCache[p.id] = p.commentsList || [];
    });
    /* 持久化帖子到localStorage */
    try {
      localStorage.setItem('sf_posts_' + tab, JSON.stringify(sfState.posts[tab]));
    } catch(e) {}
  } catch (e) {
    sfState.posts[tab] = [];
    var msg = (e && e.message) ? e.message : '';
    if (msg.indexOf('豆子不足') !== -1 || msg.indexOf('403') !== -1) {
      forumToast('豆子不足，生成帖子需要3颗豆子');
    } else {
      forumToast('生成失败：' + (msg || '请稍后重试'));
    }
  }

  sfState.loading[tab] = false;
  sfState.isLoading = false;
  if (sfState.active && sfState.currentView === 'feed' && tab === sfState.currentTab) {
    sfRenderTimeline(tab);
  }
};

/* ---- rendering: post card ---- */
var sfGetDisplayPosts = function (tab) {
  var user = sfState.userPosts.filter(function (p) { return p.tab === tab; });
  return user.concat(sfState.posts[tab] || []);
};

var sfFindPost = function (postId) {
  var p = sfState.userPosts.find(function (x) { return x.id === postId; });
  if (p) return p;
  for (var tab in sfState.posts) {
    p = sfState.posts[tab].find(function (x) { return x.id === postId; });
    if (p) return p;
  }
  return null;
};

var sfRenderPost = function (post) {
  var avatarSrc = post.roleAvatar || forumGetAvatarSrc(post.avatarIndex);
  var commentCount = (sfState.commentsCache[post.id] || post.commentsList || []).length;
  var liked = post.liked ? ' liked' : '';
  var verifiedHtml = post.verified ? '<span class="sf-post-verified">&#10003;</span>' : '';
  var imageGrad = post.imageGradient ? forumGradientCss(post.imageGradient) : '';

  var html = '<div class="sf-post" data-post-id="' + escapeHtml(post.id || '') + '">'
    + '<div class="sf-post-header">'
    + '<img class="sf-post-avatar" src="' + avatarSrc + '" alt="" />'
    + '<div class="sf-post-meta">'
    + '<span class="sf-post-name">' + escapeHtml(post.authorName || '匿名') + '</span>'
    + '<span class="sf-post-handle">' + escapeHtml(post.handle || forumHandle(post.authorName)) + '</span>'
    + verifiedHtml
    + '</div>'
    + '<span class="sf-post-time">' + escapeHtml(post.time || '刚刚') + '</span>'
    + '</div>';

  /* post image: gradient placeholder cover */
  if (imageGrad) {
    html += '<div class="sf-post-image" style="background:' + imageGrad + '"></div>';
  }

  /* post content */
  var contentText = escapeHtml(post.content || '');
  html += '<div class="sf-post-content">' + contentText + '</div>';

  /* actions */
  html += '<div class="sf-post-actions">'
    + '<span class="sf-post-action" data-action="comment">&#128172; ' + commentCount + '</span>'
    + '<span class="sf-post-action" data-action="repost">&#8619;&#65039; ' + (post.reposts || 0) + '</span>'
    + '<span class="sf-post-action' + liked + '" data-action="like">&#10084;&#65039; ' + (post.likes || 0) + '</span>'
    + '<span class="sf-post-action" data-action="views">&#128065;&#65039; ' + forumFormatNum(post.views || 0) + '</span>'
    + '</div></div>';

  return html;
};

var sfRenderTimeline = function (tab) {
  var timeline = forumEl('sfTimeline');
  if (!timeline) return;

  /* 关注页：顶部显示已关注角色区域 */
  var followedHtml = '';
  if (tab === 'following') {
    sfRenderFollowedRoles();
    followedHtml = '<div class="sf-followed-section">'
      + '<div id="sfFollowedRoles"></div>'
      + '<button class="sf-followed-add-btn" id="sfAddRoleBtn">+ 添加角色</button>'
      + '</div>';
  }

  var posts = sfGetDisplayPosts(tab);
  if (sfState.loading[tab] && posts.length === 0) {
    timeline.innerHTML = followedHtml + '<div class="sf-loading">正在加载...</div>';
    return;
  }
  if (posts.length === 0) {
    timeline.innerHTML = followedHtml + '<div class="sf-empty">'
      + '<div style="margin-bottom:20px;font-size:15px;color:#888">还没有内容哦~</div>'
      + '<button class="sf-generate-btn" data-sf-generate="' + tab + '">'
      + '✨ 生成新动态 <span class="cost">（消耗3豆子）</span></button>'
      + '</div>';
    sfAttachFollowedEvents();
    return;
  }
  timeline.innerHTML = followedHtml + posts.map(function (p) { return sfRenderPost(p); }).join('')
    + '<div style="text-align:center;padding:10px 0 20px">'
    + '<button class="sf-refresh-btn" data-sf-refresh="' + tab + '">换一批 ✨</button>'
    + '</div>';

  sfAttachFollowedEvents();

  /* add expand behavior for long posts */
  timeline.querySelectorAll('.sf-post-content').forEach(function (el) {
    if (el.scrollHeight > el.clientHeight + 2) {
      el.classList.add('collapsed');
      var btn = document.createElement('span');
      btn.className = 'sf-post-expand';
      btn.textContent = '展开';
      btn.addEventListener('click', function () {
        el.classList.remove('collapsed');
        btn.remove();
      });
      el.parentNode.insertBefore(btn, el.nextSibling);
    }
  });
};

var sfAttachFollowedEvents = function () {
  /* 重新渲染关注列表 */
  var followedContainer = forumEl('sfFollowedRoles');
  if (followedContainer) sfRenderFollowedRoles();

  /* 添加角色按钮 */
  var addBtn = document.getElementById('sfAddRoleBtn');
  if (addBtn) {
    addBtn.addEventListener('click', function () {
      sfOpenRolePicker();
    });
  }

  /* 删除角色按钮 */
  document.querySelectorAll('[data-sf-remove-role]').forEach(function(btn) {
    btn.addEventListener('click', function(e) {
      e.stopPropagation();
      var idx = parseInt(btn.dataset.sfRemoveRole, 10);
      if (!isNaN(idx) && idx >= 0 && idx < sfState.followedRoles.length) {
        sfState.followedRoles.splice(idx, 1);
        sfSaveFollowedRoles();
        sfRenderFollowedRoles();
      }
    });
  });
};

var sfToggleLike = function (postId, actionEl) {
  var post = sfFindPost(postId);
  if (!post) return;
  post.liked = !post.liked;
  post.likes = (post.likes || 0) + (post.liked ? 1 : -1);
  if (actionEl) {
    actionEl.classList.toggle('liked', post.liked);
    actionEl.innerHTML = '&#10084;&#65039; ' + post.likes;
  }
  /* 记录点赞到 likedPosts */
  if (!sfState.likedPosts) sfState.likedPosts = [];
  if (post.liked) {
    /* 检查是否已存在 */
    var existIdx = sfState.likedPosts.findIndex(function(p) { return p.id === postId; });
    if (existIdx === -1) {
      /* 创建帖子快照 */
      var snapshot = JSON.parse(JSON.stringify(post));
      snapshot.liked = true;
      sfState.likedPosts.unshift(snapshot);
      sfSaveLikedPosts();
    }
  } else {
    /* 取消点赞则从记录中移除 */
    var remIdx = sfState.likedPosts.findIndex(function(p) { return p.id === postId; });
    if (remIdx !== -1) {
      sfState.likedPosts.splice(remIdx, 1);
      sfSaveLikedPosts();
    }
  }
};

/* Toggle save/collect for a forum post */
var sfToggleSave = function (postId, actionEl) {
  var post = sfFindPost(postId);
  if (!post) return;
  if (!sfState.savedPosts) sfState.savedPosts = [];
  var existIdx = sfState.savedPosts.findIndex(function(p) { return p.id === postId; });
  if (existIdx === -1) {
    var snapshot = JSON.parse(JSON.stringify(post));
    sfState.savedPosts.unshift(snapshot);
    sfSaveSavedPosts();
    if (actionEl) {
      actionEl.classList.add('saved');
      actionEl.innerHTML = '&#128274; 已收藏';
    }
    forumToast('已收藏');
  } else {
    sfState.savedPosts.splice(existIdx, 1);
    sfSaveSavedPosts();
    if (actionEl) {
      actionEl.classList.remove('saved');
      actionEl.innerHTML = '&#128274; 收藏';
    }
    forumToast('已取消收藏');
  }
};

/* ---- post detail + comments ---- */
var sfOpenPostDetail = function (postId) {
  var post = sfFindPost(postId);
  if (!post) return;
  sfState.currentPostId = postId;

  var overlay = forumEl('sfDetailOverlay');
  if (overlay) overlay.classList.add('active');

  var body = forumEl('sfDetailBody');
  if (body) {
    var avatarSrc = post.roleAvatar || forumGetAvatarSrc(post.avatarIndex);
    var commentCount = (sfState.commentsCache[postId] || post.commentsList || []).length;
    var verifiedHtml = post.verified ? '<span class="sf-post-verified">&#10003;</span>' : '';
    var imageGrad = post.imageGradient ? forumGradientCss(post.imageGradient) : '';

    var inner = '<div class="sf-post" style="border:0;cursor:default">'
      + '<div class="sf-post-header">'
      + '<img class="sf-post-avatar" src="' + avatarSrc + '" alt="" />'
      + '<div class="sf-post-meta">'
      + '<span class="sf-post-name">' + escapeHtml(post.authorName || '匿名') + '</span>'
      + '<span class="sf-post-handle">' + escapeHtml(post.handle || forumHandle(post.authorName)) + '</span>'
      + verifiedHtml
      + '</div>'
      + '<span class="sf-post-time">' + escapeHtml(post.time || '刚刚') + '</span>'
      + '</div>';

    if (imageGrad) {
      inner += '<div class="sf-post-image" style="background:' + imageGrad + '"></div>';
    }

    inner += '<div class="sf-post-content">' + escapeHtml(post.content || '') + '</div>'
      + '<div class="sf-post-actions">'
      + '<span class="sf-post-action" data-action="comment">&#128172; ' + commentCount + '</span>'
      + '<span class="sf-post-action" data-action="repost">&#8619;&#65039; ' + (post.reposts || 0) + '</span>'
      + '<span class="sf-post-action' + (post.liked ? ' liked' : '') + '" data-action="like">&#10084;&#65039; ' + (post.likes || 0) + '</span>'
      + '<span class="sf-post-action" data-action="views">&#128065;&#65039; ' + forumFormatNum(post.views || 0) + '</span>'
      + '</div></div>'
      + '<div style="padding:14px 0 4px;color:#999;font-size:13px;font-weight:700">评论</div>'
      + '<div id="sfDetailComments"></div>';

    body.innerHTML = inner;
  }

  sfRenderComments(postId);
  /* 评论不再自动生成，用户需点击"生成评论"按钮 */
  if ((!sfState.commentsCache[postId] || sfState.commentsCache[postId].length === 0) && !post._commentsLoaded) {
    var cc = forumEl('sfDetailComments');
    if (cc) cc.innerHTML = '<div style="text-align:center;padding:20px">'
      + '<div style="color:#999;font-size:13px;margin-bottom:12px">\u8fd8\u6ca1\u6709\u8bc4\u8bba\uff0c\u70b9\u51fb\u751f\u6210\u8bc4\u8bba\uff08\u6d88\u80171\u8c46\uff09</div>'
      + '<button id="sfGenCommentBtn" style="padding:8px 20px;border:1px solid #FF6B9D;border-radius:20px;background:#FF6B9D;color:#fff;font-size:13px;cursor:pointer">\u0f50\u0f50 \u751f\u6210\u8bc4\u8bba</button>'
      + '</div>';
    var genBtn = forumEl('sfGenCommentBtn');
    if (genBtn) genBtn.addEventListener('click', function() {
      sfGenerateComments(postId, post);
    });
  }
};

var sfClosePostDetail = function () {
  var d = forumEl('sfDetailOverlay');
  if (d) d.classList.remove('active');
  sfState.currentPostId = null;
};

var sfGenerateComments = async function (postId, post) {
  if (!post) return;
  post._commentsLoaded = true;
  var c = forumEl('sfDetailComments');
  if (c) c.innerHTML = '<div style="text-align:center;padding:20px;color:#999;font-size:13px">正在生成评论（消耗1豆）...</div>';
  try {
    var result = await request('/forum/comments', {
      method: 'POST',
      body: JSON.stringify({ postContent: post.content, postAuthor: post.authorName, count: 4 })
    });
    var comments = (result && result.comments) ? result.comments : sfFallbackComments();
    sfState.commentsCache[postId] = comments;
    /* 刷新豆子显示 */
    if (typeof window.refreshServerUser === 'function') window.refreshServerUser();
  } catch (e) {
    sfState.commentsCache[postId] = sfFallbackComments();
    forumToast('评论生成失败：' + (e && e.message ? e.message : '请稍后重试'));
    if (typeof window.refreshServerUser === 'function') window.refreshServerUser();
  }
  if (sfState.currentPostId === postId) sfRenderComments(postId);
  sfUpdateCommentCount(postId, (sfState.commentsCache[postId] || []).length);
};

var sfRenderComments = function (postId) {
  var c = forumEl('sfDetailComments');
  if (!c) return;
  var comments = sfState.commentsCache[postId] || [];
  var html = '';
  if (comments.length === 0) {
    html = '<div style="text-align:center;padding:24px;color:#999;font-size:13px">还没有评论，快来抢沙发~</div>';
  } else {
    html = comments.map(function (cm) {
      return '<div class="sf-comment">'
        + '<div class="sf-comment-avatar" style="background:' + forumAvatarGradient(cm.avatarIndex) + '">'
        + escapeHtml(forumInitial(cm.authorName)) + '</div>'
        + '<div class="sf-comment-body">'
        + '<div class="sf-comment-name">' + escapeHtml(cm.authorName || '匿名') + '</div>'
        + '<div class="sf-comment-text">' + escapeHtml(cm.content || '') + '</div>'
        + '<div class="sf-comment-time">' + escapeHtml(cm.time || '刚刚') + '</div>'
        + '</div></div>';
    }).join('');
  }
  c.innerHTML = html;
};

var sfUpdateCommentCount = function (postId, n) {
  var detailAction = document.querySelector('#sfDetailBody [data-action="comment"]');
  if (detailAction) detailAction.innerHTML = '&#128172; ' + n;
};

var sfSendComment = function () {
  var input = forumEl('sfCommentInput');
  if (!input || !input.value.trim() || !sfState.currentPostId) return;
  var text = input.value.trim();
  input.value = '';
  var comments = sfState.commentsCache[sfState.currentPostId] || [];
  comments.push({
    id: 'sc-' + Date.now(),
    authorName: (sfState.currentRole ? sfState.currentRole.name : '我'),
    content: text,
    time: '刚刚',
    avatarIndex: 0
  });
  sfState.commentsCache[sfState.currentPostId] = comments;
  var post = sfFindPost(sfState.currentPostId);
  if (post) {
    post.commentsList = comments;
    post.comments = comments.length;
  }
  sfRenderComments(sfState.currentPostId);
  sfUpdateCommentCount(sfState.currentPostId, comments.length);
  forumToast('评论已发送');
};

/* ---- post creation modal ---- */
var sfOpenPostModal = function () {
  var m = forumEl('sfPostModal');
  if (m) m.classList.add('active');
  var input = forumEl('sfPostInput');
  if (input) setTimeout(function () { input.focus(); }, 100);
};

var sfClosePostModal = function () {
  var m = forumEl('sfPostModal');
  if (m) m.classList.remove('active');
  var input = forumEl('sfPostInput');
  if (input) input.value = '';
};

var sfPublishPost = function () {
  var input = forumEl('sfPostInput');
  if (!input || !input.value.trim()) { forumToast('请输入内容'); return; }
  var text = input.value.trim();
  var role = sfState.currentRole || (typeof activeRole === 'function' ? activeRole() : null);
  var userNickname = (typeof dfGetUserPersona === 'function')
    ? (dfGetUserPersona().nickname || '我')
    : ((window.CONFIG && window.CONFIG.userId) ? '用户' : '我');
  /* 使用用户主页设置的头像 */
  var userAvatar = null;
  try {
    var saved = localStorage.getItem('sf_user_profile');
    if (saved) {
      var parsed = JSON.parse(saved);
      if (parsed.avatar) userAvatar = parsed.avatar;
    }
  } catch(e) {}
  if (!userAvatar && sfState.userProfile.avatar) userAvatar = sfState.userProfile.avatar;

  var post = {
    id: 'sf-user-' + Date.now(),
    authorName: userNickname,
    handle: forumHandle(userNickname || (role ? role.name : '我')),
    verified: false,
    content: text,
    time: '刚刚',
    likes: 0,
    reposts: 0,
    comments: 0,
    views: 0,
    avatarIndex: 0,
    roleAvatar: userAvatar, /* 用户自己的头像 */
    imageGradient: null,
    commentsList: [],
    tab: sfState.currentTab,
    _user: true
  };
  sfState.userPosts.unshift(post);
  sfState.userProfile.posts = sfState.userPosts.length;
  sfClosePostModal();
  /* 始终刷新当前标签页的时间线，确保用户帖子可见 */
  sfRenderTimeline(sfState.currentTab);
  forumToast('发布成功');
};

/* ---- side menu ---- */
var sfOpenSideMenu = function () {
  sfState.sideMenuOpen = true;
  var menu = forumEl('sfSideMenu');
  var ov = forumEl('sfSideOverlay');
  if (menu) menu.classList.add('open');
  if (ov) ov.classList.add('active');
};

var sfCloseSideMenu = function () {
  sfState.sideMenuOpen = false;
  var menu = forumEl('sfSideMenu');
  var ov = forumEl('sfSideOverlay');
  if (menu) menu.classList.remove('open');
  if (ov) ov.classList.remove('active');
};

var sfRenderSideMenu = function () {
  /* 使用用户自己的昵称和头像，而不是角色信息 */
  sfLoadProfileMeta();
  var name = sfState.userProfile.displayName || '体验用户';
  var avatarSrc = sfState.userProfile.avatar || null;
  var header = forumEl('sfMenuHeader');
  if (header) {
    var avatarHtml;
    if (avatarSrc) {
      avatarHtml = '<img src="' + avatarSrc + '" style="width:52px;height:52px;border-radius:50%;object-fit:cover" alt="" />';
    } else {
      avatarHtml = escapeHtml(forumInitial(name));
    }
    header.innerHTML = '<div style="display:flex;align-items:center;gap:12px">'
      + '<div style="width:52px;height:52px;border-radius:50%;background:rgba(255,255,255,.25);display:flex;align-items:center;justify-content:center;font-size:22px;font-weight:700;color:#fff;overflow:hidden">'
      + avatarHtml + '</div>'
      + '<div><div style="font-size:18px;font-weight:700;color:#fff">' + escapeHtml(name) + '</div>'
      + '<div style="font-size:12px;opacity:.85;color:#fff">@' + escapeHtml(name) + '</div></div></div>';
  }
  var list = forumEl('sfMenuList');
  if (list) {
    var items = [
      { key: 'profile', icon: '&#128100;', label: '个人主页' },
      { key: 'bookmarks', icon: '&#128278;', label: '我的书签' },
      { key: 'drafts', icon: '&#128221;', label: '草稿箱' },
      { key: 'settings', icon: '&#9881;&#65039;', label: '设置' },
      { key: 'about', icon: '&#8505;&#65039;', label: '关于论坛' },
      { key: 'close', icon: '&#10005;', label: '退出论坛' }
    ];
    list.innerHTML = items.map(function (it) {
      return '<div class="sf-menu-item" data-menu="' + it.key + '"><span>' + it.icon
        + '</span><span>' + it.label + '</span></div>';
    }).join('');
  }
};

/* ---- search + trends ---- */
var sfBuildTrends = function () {
  var counts = {};
  var add = function (tag) { tag = String(tag).trim(); if (tag) counts[tag] = (counts[tag] || 0) + 1; };
  for (var tab in sfState.posts) {
    sfState.posts[tab].forEach(function (p) {
      var matches = String(p.content || '').match(/#([^#\\s]{1,12})#?/g);
      if (matches) matches.forEach(function (m) { add(m.replace(/#/g, '')); });
    });
  }
  var defaults = ['今日份小确幸', '深夜emo时间', '角色养成计划', '平行世界的我', '天气日记', '读书笔记', '一个人也要好好吃饭'];
  defaults.forEach(function (d) {
    counts[d] = (counts[d] || 0) + Math.floor(Math.random() * 6000) + 800;
  });
  var arr = Object.keys(counts).map(function (k) { return { tag: k, count: counts[k] }; });
  arr.sort(function (a, b) { return b.count - a.count; });
  return arr.slice(0, 8);
};

var sfRenderTrends = function () {
  var c = forumEl('sfTrends');
  if (!c) return;
  var trends = sfBuildTrends();
  var html = '<div class="sf-trend-card"><div class="sf-trend-title">热门话题</div>';
  trends.forEach(function (t, i) {
    html += '<div class="sf-trend-item" data-trend="' + escapeHtml(t.tag) + '">'
      + '<div class="sf-trend-rank">' + (i + 1) + '</div>'
      + '<div class="sf-trend-tag">#' + escapeHtml(t.tag) + '#</div>'
      + '<div class="sf-trend-count">' + t.count + ' 讨论</div>'
      + '</div>';
  });
  html += '</div>';
  c.innerHTML = html;
};

var sfRunSearch = function () {
  var input = forumEl('sfSearchInput');
  var c = forumEl('sfTrends');
  if (!input || !c) return;
  var kw = input.value.trim().toLowerCase();
  if (!kw) { sfRenderTrends(); return; }
  var results = [];
  var seen = {};
  var collect = function (p) {
    if (!p || seen[p.id]) return;
    var t = (p.authorName + ' ' + (p.handle || '') + ' ' + p.content).toLowerCase();
    if (t.indexOf(kw) !== -1) { seen[p.id] = 1; results.push(p); }
  };
  sfState.userPosts.forEach(collect);
  for (var tab in sfState.posts) sfState.posts[tab].forEach(collect);
  if (results.length === 0) {
    c.innerHTML = '<div class="sf-empty">没有找到相关内容</div>';
    return;
  }
  c.innerHTML = '<div style="padding:10px 14px;color:#999;font-size:13px">找到 ' + results.length + ' 条结果</div>'
    + results.map(function (p) { return sfRenderPost(p); }).join('');
};

/* ---- notifications ---- */
var sfBuildNotifications = function () {
  var list = [];
  sfState.userPosts.forEach(function (p, i) {
    list.push({ text: '草莓味晚风 赞了你的帖子', detail: String(p.content || '').substring(0, 40), time: '刚刚', avatarIndex: (i + 1) % 8 });
    list.push({ text: '星河滚烫 评论了你的帖子', detail: '说得太对了！', time: '5分钟前', avatarIndex: (i + 2) % 8 });
  });
  list.push({ text: '云朵邮局 关注了你', detail: '', time: '1小时前', avatarIndex: 3 });
  list.push({ text: '海盐焦糖 关注了你', detail: '', time: '3小时前', avatarIndex: 5 });
  list.push({ text: '欢迎来到回响论坛，开始你的第一段分享吧', detail: '', time: '今天', avatarIndex: 0 });
  return list;
};

var sfRenderNotifications = function () {
  if (!sfState.notifCache) sfState.notifCache = sfBuildNotifications();
  var c = forumEl('sfNotifList');
  if (!c) return;
  if (sfState.notifCache.length === 0) {
    c.innerHTML = '<div class="sf-empty">暂无通知</div>';
    return;
  }
  c.innerHTML = sfState.notifCache.map(function (n) {
    return '<div class="sf-post">'
      + '<div class="sf-post-header">'
      + '<div class="sf-comment-avatar" style="width:42px;height:42px;font-size:15px;background:' + forumAvatarGradient(n.avatarIndex) + '">'
      + escapeHtml(forumInitial(n.text)) + '</div>'
      + '<div class="sf-post-info">'
      + '<div class="sf-post-name">' + escapeHtml(n.text) + '</div>'
      + '<div class="sf-post-handle">' + escapeHtml(n.time || '刚刚') + '</div>'
      + '</div></div>'
      + (n.detail ? '<div class="sf-post-text">' + escapeHtml(n.detail) + '</div>' : '')
      + '</div>';
  }).join('');
};

/* ---- profile (me) — pink healing-系 personal homepage ---- */
/* Read saved display name / identity tag (avatar is already on sfState.userProfile). */
var sfLoadProfileMeta = function () {
  try {
    var saved = localStorage.getItem('sf_user_profile');
    if (saved) {
      var parsed = JSON.parse(saved);
      sfState.userProfile.avatar = parsed.avatar || sfState.userProfile.avatar || null;
      sfState.userProfile.displayName = parsed.displayName || null;
      sfState.userProfile.identityTag = parsed.identityTag || null;
      sfState.userProfile.bio = parsed.bio || null;
      sfState.userProfile.followers = parsed.followers || 0;
      sfState.userProfile.following = parsed.following || 0;
    }
    /* 加载点赞和收藏记录 */
    var liked = localStorage.getItem('sf_liked_posts');
    if (liked) sfState.likedPosts = JSON.parse(liked) || [];
    var savedP = localStorage.getItem('sf_saved_posts');
    if (savedP) sfState.savedPosts = JSON.parse(savedP) || [];
  } catch (e) {}
};
var sfSaveLikedPosts = function () {
  try { localStorage.setItem('sf_liked_posts', JSON.stringify(sfState.likedPosts || [])); } catch(e) {}
};
var sfSaveSavedPosts = function () {
  try { localStorage.setItem('sf_saved_posts', JSON.stringify(sfState.savedPosts || [])); } catch(e) {}
};
var sfSaveProfileMeta = function () {
  try {
    localStorage.setItem('sf_user_profile', JSON.stringify({
      avatar: sfState.userProfile.avatar || null,
      displayName: sfState.userProfile.displayName || null,
      identityTag: sfState.userProfile.identityTag || null,
      bio: sfState.userProfile.bio || null,
      followers: sfState.userProfile.followers || 0,
      following: sfState.userProfile.following || 0
    }));
  } catch (e) {}
};

var sfRenderProfile = function () {
  sfLoadProfileMeta();
  /* 不再回退到角色信息，使用用户自己设置的昵称 */
  var name = sfState.userProfile.displayName || '体验用户';
  var bio = sfState.userProfile.bio || '在这里记录每一个心动的瞬间。';
  var tag = sfState.userProfile.identityTag || '心动嘉宾';

  /* compute stats - 使用用户可编辑的值，回退到计算值 */
  var totalLikes = sfState.userPosts.reduce(function (s, p) { return s + (p.likes || 0); }, 0);
  sfState.userProfile.posts = sfState.userPosts.length;
  sfState.userProfile.likes = totalLikes;
  /* 粉丝和关注数可由用户手动修改，存在 localStorage 中 */
  if (!sfState.userProfile.followers) sfState.userProfile.followers = 56 + sfState.userPosts.length * 13;
  if (!sfState.userProfile.following) sfState.userProfile.following = 128 + sfState.userPosts.length * 7;

  /* 收藏的帖子 */
  var savedPosts = sfState.savedPosts || [];
  /* 点赞过的帖子 */
  var likedPosts = sfState.likedPosts || [];

  var header = document.querySelector('#sfMeView .sf-profile-header');
  if (header) {
    var avatarInner;
    if (sfState.userProfile.avatar) {
      avatarInner = '<img class="sf-pa-img" src="' + sfState.userProfile.avatar + '" alt="" />';
    } else {
      avatarInner = '<div class="sf-pa-div" style="background:' + forumAvatarGradient(0) + '">'
        + escapeHtml(forumInitial(name)) + '</div>';
    }
    header.innerHTML = '<div class="sf-profile-card">'
      + '<div class="sf-profile-top">'
      + '<div class="sf-profile-avatar-wrap">'
      + avatarInner
      + '<div class="sf-profile-camera" id="sfProfileCamera" title="更换头像">&#128247;</div>'
      + '</div>'
      + '<div class="sf-profile-name-row">'
      + '<span id="sfProfileName">' + escapeHtml(name) + '</span>'
      + '<span class="sf-profile-edit" id="sfProfileEditName" title="编辑昵称">&#9998;</span>'
      + '</div>'
      + '<div class="sf-profile-tag" id="sfProfileTag" title="点击修改身份标签">' + escapeHtml(tag) + '</div>'
      + '<div class="sf-profile-bio" id="sfProfileBio" style="cursor:pointer" title="点击修改简介">' + escapeHtml(bio) + '</div>'
      + '</div>'
      + '<div class="sf-profile-stat">'
      + '<div class="sf-profile-stat-item"><div class="num">' + sfState.userProfile.posts + '</div><div class="label">帖子</div></div>'
      + '<div class="sf-profile-stat-item"><div class="num">' + sfState.userProfile.likes + '</div><div class="label">获赞</div></div>'
      + '<div class="sf-profile-stat-item" id="sfStatFollowing" style="cursor:pointer" title="点击修改" ><div class="num">' + sfState.userProfile.following + '</div><div class="label">关注</div></div>'
      + '<div class="sf-profile-stat-item" id="sfStatFollowers" style="cursor:pointer" title="点击修改" ><div class="num">' + sfState.userProfile.followers + '</div><div class="label">粉丝</div></div>'
      + '</div>'
      + '</div>';

    /* bind avatar + camera to file picker */
    var avatarTrigger = header.querySelector('#sfProfileCamera, .sf-pa-img, .sf-pa-div');
    if (avatarTrigger) avatarTrigger.addEventListener('click', sfHandleAvatarUpload);
    /* bind name edit */
    var editName = header.querySelector('#sfProfileEditName');
    if (editName) editName.addEventListener('click', sfEditProfileName);
    /* bind identity tag edit */
    var tagEl = header.querySelector('#sfProfileTag');
    if (tagEl) tagEl.addEventListener('click', sfEditProfileTag);
    /* bind bio edit */
    var bioEl = header.querySelector('#sfProfileBio');
    if (bioEl) bioEl.addEventListener('click', sfEditProfileBio);
    /* bind followers/following edit */
    var followingEl = header.querySelector('#sfStatFollowing');
    if (followingEl) followingEl.addEventListener('click', function() { sfEditStatNumber('following'); });
    var followersEl = header.querySelector('#sfStatFollowers');
    if (followersEl) followersEl.addEventListener('click', function() { sfEditStatNumber('followers'); });
  }

  var body = forumEl('sfProfileBody');
  if (!body) return;

  /* 获取当前选中的标签页 */
  if (!sfState.profileTab) sfState.profileTab = 'posts';
  var savedPosts = sfState.savedPosts || [];
  var likedPosts = sfState.likedPosts || [];

  var html = '<div style="display:flex;border-bottom:1px solid rgba(0,0,0,.06);margin-bottom:12px">'
    + '<div class="sf-profile-tab' + (sfState.profileTab === 'posts' ? ' active' : '') + '" data-profile-tab="posts" style="flex:1;text-align:center;padding:10px 0;font-size:14px;font-weight:' + (sfState.profileTab === 'posts' ? '700' : '400') + ';color:' + (sfState.profileTab === 'posts' ? '#FF6B9D' : '#999') + ';cursor:pointer;border-bottom:' + (sfState.profileTab === 'posts' ? '2px solid #FF6B9D' : 'none') + '">帖子 ' + sfState.userPosts.length + '</div>'
    + '<div class="sf-profile-tab' + (sfState.profileTab === 'likes' ? ' active' : '') + '" data-profile-tab="likes" style="flex:1;text-align:center;padding:10px 0;font-size:14px;font-weight:' + (sfState.profileTab === 'likes' ? '700' : '400') + ';color:' + (sfState.profileTab === 'likes' ? '#FF6B9D' : '#999') + ';cursor:pointer;border-bottom:' + (sfState.profileTab === 'likes' ? '2px solid #FF6B9D' : 'none') + '">点赞 ' + likedPosts.length + '</div>'
    + '<div class="sf-profile-tab' + (sfState.profileTab === 'saved' ? ' active' : '') + '" data-profile-tab="saved" style="flex:1;text-align:center;padding:10px 0;font-size:14px;font-weight:' + (sfState.profileTab === 'saved' ? '700' : '400') + ';color:' + (sfState.profileTab === 'saved' ? '#FF6B9D' : '#999') + ';cursor:pointer;border-bottom:' + (sfState.profileTab === 'saved' ? '2px solid #FF6B9D' : 'none') + '">收藏 ' + savedPosts.length + '</div>'
    + '</div>';

  if (sfState.profileTab === 'posts') {
    if (sfState.userPosts.length === 0) {
      html += '<div class="sf-profile-empty">'
        + '<div class="mascot">' + forumMascotSvg(110) + '</div>'
        + '<div>还没有发布过帖子</div>'
        + '<div class="tip">点击右下角 ✦ 发布第一条吧 ✦</div>'
        + '</div>';
    } else {
      html += sfState.userPosts.map(function (p) { return sfRenderPost(p); }).join('');
    }
  } else if (sfState.profileTab === 'likes') {
    if (likedPosts.length === 0) {
      html += '<div class="sf-profile-empty"><div style="padding:40px 20px;text-align:center;color:#999;font-size:14px">还没有点赞过帖子</div></div>';
    } else {
      html += likedPosts.map(function (p) { return sfRenderPost(p); }).join('');
    }
  } else if (sfState.profileTab === 'saved') {
    if (savedPosts.length === 0) {
      html += '<div class="sf-profile-empty"><div style="padding:40px 20px;text-align:center;color:#999;font-size:14px">还没有收藏过帖子</div></div>';
    } else {
      html += savedPosts.map(function (p) { return sfRenderPost(p); }).join('');
    }
  }

  body.innerHTML = html;

  /* bind tab clicks */
  var tabs = body.querySelectorAll('[data-profile-tab]');
  tabs.forEach(function(tab) {
    tab.addEventListener('click', function() {
      sfState.profileTab = this.dataset.profileTab;
      sfRenderProfile();
    });
  });
};

/* Edit display name (stored locally; falls back to role name). */
var sfEditProfileName = function () {
  var role = sfState.currentRole || (typeof activeRole === 'function' ? activeRole() : null);
  var cur = sfState.userProfile.displayName || (role ? role.name : '体验用户');
  sfShowTextInputModal('修改昵称', '输入新的昵称', cur, function(val) {
    if (!val) { forumToast('昵称不能为空'); return; }
    sfState.userProfile.displayName = val.substring(0, 20);
    sfSaveProfileMeta();
    sfRenderProfile();
    sfRenderNavAvatar();
    forumToast('昵称已更新');
  });
};

/* Edit identity tag (e.g. 帅哥 / 心动嘉宾). */
var sfEditProfileTag = function () {
  var cur = sfState.userProfile.identityTag || '心动嘉宾';
  sfShowTextInputModal('修改身份标签', '如：帅哥、心动嘉宾', cur, function(val) {
    if (!val) { forumToast('标签不能为空'); return; }
    sfState.userProfile.identityTag = val.substring(0, 8);
    sfSaveProfileMeta();
    sfRenderProfile();
    forumToast('标签已更新');
  });
};

/* Edit bio (个人简介) */
var sfShowTextInputModal = function(title, placeholder, currentValue, callback) {
  var existing = document.getElementById('sfTextInputModal');
  if (existing) existing.remove();
  var overlay = document.createElement('div');
  overlay.id = 'sfTextInputModal';
  overlay.style.cssText = 'position:fixed;top:0;left:0;width:100%;height:100%;background:rgba(0,0,0,.5);z-index:10000;display:flex;align-items:center;justify-content:center;padding:20px';
  overlay.innerHTML = '<div style="background:#fff;border-radius:16px;padding:24px;width:100%;max-width:340px">'
    + '<div style="font-size:16px;font-weight:700;color:#333;margin-bottom:16px">' + title + '</div>'
    + '<textarea id="sfTextInputField" placeholder="' + placeholder + '" style="width:100%;padding:12px 16px;border:1px solid #ddd;border-radius:10px;font-size:15px;outline:none;box-sizing:border-box;min-height:80px;resize:vertical" maxlength="100">' + currentValue + '</textarea>'
    + '<div style="display:flex;gap:10px;margin-top:16px">'
    + '<button id="sfTextInputCancel" style="flex:1;padding:10px;border:1px solid #ddd;border-radius:10px;background:#fff;color:#666;font-size:14px;cursor:pointer">取消</button>'
    + '<button id="sfTextInputConfirm" style="flex:1;padding:10px;border:0;border-radius:10px;background:#FF6B9D;color:#fff;font-size:14px;font-weight:600;cursor:pointer">确认</button>'
    + '</div></div>';
  document.body.appendChild(overlay);
  var input = document.getElementById('sfTextInputField');
  var cancelBtn = document.getElementById('sfTextInputCancel');
  var confirmBtn = document.getElementById('sfTextInputConfirm');
  if (input) { input.focus(); input.select(); }
  if (cancelBtn) cancelBtn.addEventListener('click', function() { overlay.remove(); });
  if (confirmBtn) confirmBtn.addEventListener('click', function() {
    var val = input ? input.value.trim() : '';
    overlay.remove();
    callback(val);
  });
  overlay.addEventListener('click', function(e) {
    if (e.target === overlay) overlay.remove();
  });
};
/* Global wrapper for tag adding - called from inline onclick */
var dfAddCustomTag = function(source) {
  dfShowTagInputModal(function(newTag) {
    newTag = String(newTag).trim();
    if (!newTag) return;
    if (dfState.customTags.indexOf(newTag) === -1 && DF_TAGS.indexOf(newTag) === -1) {
      dfState.customTags.push(newTag);
      dfSaveCustomTags();
    }
    if (dfState.selectedTags.indexOf(newTag) === -1) dfState.selectedTags.push(newTag);
    if (source === 'home') dfRenderHomeHeader();
    else dfRenderGeneratePage();
  });
};


var sfShowNumberInputModal = function(title, currentValue, callback) {
  var existing = document.getElementById('sfNumberInputModal');
  if (existing) existing.remove();
  var overlay = document.createElement('div');
  overlay.id = 'sfNumberInputModal';
  overlay.style.cssText = 'position:fixed;top:0;left:0;width:100%;height:100%;background:rgba(0,0,0,.5);z-index:10000;display:flex;align-items:center;justify-content:center;padding:20px';
  overlay.innerHTML = '<div style="background:#fff;border-radius:16px;padding:24px;width:100%;max-width:340px">'
    + '<div style="font-size:16px;font-weight:700;color:#333;margin-bottom:16px">' + title + '</div>'
    + '<input id="sfNumberInputField" type="number" value="' + currentValue + '" style="width:100%;padding:12px 16px;border:1px solid #ddd;border-radius:10px;font-size:15px;outline:none;box-sizing:border-box" min="0" max="999999" />'
    + '<div style="display:flex;gap:10px;margin-top:16px">'
    + '<button id="sfNumberInputCancel" style="flex:1;padding:10px;border:1px solid #ddd;border-radius:10px;background:#fff;color:#666;font-size:14px;cursor:pointer">取消</button>'
    + '<button id="sfNumberInputConfirm" style="flex:1;padding:10px;border:0;border-radius:10px;background:#FF6B9D;color:#fff;font-size:14px;font-weight:600;cursor:pointer">确认</button>'
    + '</div></div>';
  document.body.appendChild(overlay);
  var input = document.getElementById('sfNumberInputField');
  var cancelBtn = document.getElementById('sfNumberInputCancel');
  var confirmBtn = document.getElementById('sfNumberInputConfirm');
  if (input) { input.focus(); input.select(); }
  if (cancelBtn) cancelBtn.addEventListener('click', function() { overlay.remove(); });
  if (confirmBtn) confirmBtn.addEventListener('click', function() {
    var val = parseInt(input ? input.value : '0', 10) || 0;
    overlay.remove();
    callback(val);
  });
  overlay.addEventListener('click', function(e) {
    if (e.target === overlay) overlay.remove();
  });
};

var sfEditProfileBio = function () {
  var cur = sfState.userProfile.bio || '';
  sfShowTextInputModal('修改简介', '输入你的个人简介', cur, function(val) {
    if (!val) { forumToast('简介不能为空'); return; }
    sfState.userProfile.bio = val.substring(0, 100);
    sfSaveProfileMeta();
    sfRenderProfile();
    forumToast('简介已更新');
  });
};

var sfEditStatNumber = function (field) {
  var cur = sfState.userProfile[field] || 0;
  var label = field === 'followers' ? '粉丝数' : '关注数';
  sfShowNumberInputModal('修改' + label, cur, function(val) {
    sfState.userProfile[field] = val;
    sfSaveProfileMeta();
    sfRenderProfile();
    forumToast(label + '已更新');
  });
};

/* hidden file input for avatar upload */
var sfAvatarFileInput = null;

var sfHandleAvatarUpload = function () {
  if (!sfAvatarFileInput) {
    sfAvatarFileInput = document.createElement('input');
    sfAvatarFileInput.type = 'file';
    sfAvatarFileInput.accept = 'image/*';
    sfAvatarFileInput.style.display = 'none';
    sfAvatarFileInput.addEventListener('change', sfProcessAvatarFile);
    document.body.appendChild(sfAvatarFileInput);
  }
  sfAvatarFileInput.click();
};

var sfProcessAvatarFile = function (e) {
  var file = e.target && e.target.files && e.target.files[0];
  if (!file) return;
  var reader = new FileReader();
  reader.onload = function (ev) {
    var dataUrl = ev.target.result;
    sfState.userProfile.avatar = dataUrl;
    /* persist (keeps displayName / identityTag) */
    sfSaveProfileMeta();
    /* save to server */
    try {
      request('/profile', {
        method: 'POST',
        body: JSON.stringify({ avatar: dataUrl })
      });
    } catch (err) {}
    /* re-render profile */
    if (sfState.currentView === 'me') sfRenderProfile();
    /* update nav avatar */
    sfRenderNavAvatar();
    forumToast('头像已更新');
  };
  reader.readAsDataURL(file);
  /* reset input so same file can be picked again */
  sfAvatarFileInput.value = '';
};

/* ---- event binding (social) ---- */
var sfEventsBound = false;
var sfBindEvents = function () {
  if (sfEventsBound) return;
  /* sub-tabs */
  document.querySelectorAll('.sf-sub-tab').forEach(function (t) {
    t.addEventListener('click', function () { sfSwitchTab(this.dataset.sfTab); });
  });

  /* bottom nav */
  document.querySelectorAll('.sf-bottom-nav .sf-tab').forEach(function (t) {
    t.addEventListener('click', function () { sfSwitchView(this.dataset.sfView); });
  });

  /* nav avatar -> side menu */
  var navAvatar = forumEl('sfNavAvatar');
  if (navAvatar) navAvatar.addEventListener('click', sfOpenSideMenu);

  /* refresh / close */
  var refresh = forumEl('sfRefreshBtn');
  if (refresh) refresh.addEventListener('click', function () {
    sfState.posts[sfState.currentTab] = [];
    sfRenderTimeline(sfState.currentTab);
  });
  var closeBtn = forumEl('sfCloseBtn');
  if (closeBtn) closeBtn.addEventListener('click', closeSocialForum);

  /* fab */
  var fab = forumEl('sfFab');
  if (fab) fab.addEventListener('click', sfOpenPostModal);

  /* timeline delegation */
  var timeline = forumEl('sfTimeline');
  if (timeline) timeline.addEventListener('click', function (e) {
    /* skip if expand button was clicked */
    if (e.target.classList.contains('sf-post-expand')) return;
    /* generate / refresh buttons */
    var genBtn = e.target.closest('[data-sf-generate]');
    if (genBtn) {
      sfState.posts[genBtn.dataset.sfGenerate] = [];
      try { localStorage.removeItem('sf_posts_' + genBtn.dataset.sfGenerate); } catch(e) {}
      sfLoadTab(genBtn.dataset.sfGenerate);
      return;
    }
    var refBtn = e.target.closest('[data-sf-refresh]');
    if (refBtn) {
      sfState.posts[refBtn.dataset.sfRefresh] = [];
      try { localStorage.removeItem('sf_posts_' + refBtn.dataset.sfRefresh); } catch(e) {}
      sfLoadTab(refBtn.dataset.sfRefresh);
      return;
    }
    var action = e.target.closest('[data-action]');
    var post = e.target.closest('[data-post-id]');
    if (!post) return;
    var postId = post.dataset.postId;
    if (action) {
      var act = action.dataset.action;
      if (act === 'like') { sfToggleLike(postId, action); return; }
      if (act === 'save') { sfToggleSave(postId, action); return; }
      if (act === 'repost') { forumToast('已转发'); return; }
      if (act === 'views') return;
      if (act === 'comment') { sfOpenPostDetail(postId); return; }
    }
    sfOpenPostDetail(postId);
  });

  /* detail back + body actions */
  var detailBack = forumEl('sfDetailBack');
  if (detailBack) detailBack.addEventListener('click', sfClosePostDetail);
  var detailBody = forumEl('sfDetailBody');
  if (detailBody) detailBody.addEventListener('click', function (e) {
    var action = e.target.closest('[data-action]');
    if (!action || !sfState.currentPostId) return;
    if (action.dataset.action === 'like') {
      sfToggleLike(sfState.currentPostId, action);
    } else if (action.dataset.action === 'save') {
      sfToggleSave(sfState.currentPostId, action);
    } else if (action.dataset.action === 'repost') {
      forumToast('已转发');
    } else if (action.dataset.action === 'share') {
      forumToast('链接已复制到剪贴板');
    }
  });

  /* comments */
  var commentSend = forumEl('sfCommentSend');
  if (commentSend) commentSend.addEventListener('click', sfSendComment);
  var commentInput = forumEl('sfCommentInput');
  if (commentInput) commentInput.addEventListener('keydown', function (e) {
    if (e.key === 'Enter') sfSendComment();
  });

  /* post modal */
  var postCancel = forumEl('sfPostCancel');
  if (postCancel) postCancel.addEventListener('click', sfClosePostModal);
  var postPublish = forumEl('sfPostPublish');
  if (postPublish) postPublish.addEventListener('click', sfPublishPost);
  var postModal = forumEl('sfPostModal');
  if (postModal) postModal.addEventListener('click', function (e) {
    if (e.target === this) sfClosePostModal();
  });

  /* side menu */
  var sideOv = forumEl('sfSideOverlay');
  if (sideOv) sideOv.addEventListener('click', sfCloseSideMenu);
  var menuList = forumEl('sfMenuList');
  if (menuList) menuList.addEventListener('click', function (e) {
    var item = e.target.closest('[data-menu]');
    if (!item) return;
    var key = item.dataset.menu;
    sfCloseSideMenu();
    if (key === 'profile') sfSwitchView('me');
    else if (key === 'bookmarks') forumToast('书签功能开发中');
    else if (key === 'drafts') forumToast('草稿箱是空的');
    else if (key === 'settings') sfOpenSettingsPanel();
    else if (key === 'about') forumToast('回响论坛 v1.0 · 角色陪伴社区');
    else if (key === 'close') closeSocialForum();
  });

  /* search */
  var searchInput = forumEl('sfSearchInput');
  if (searchInput) searchInput.addEventListener('input', sfRunSearch);
  var trends = forumEl('sfTrends');
  if (trends) trends.addEventListener('click', function (e) {
    var item = e.target.closest('[data-trend]');
    if (!item) return;
    if (searchInput) { searchInput.value = item.dataset.trend; sfRunSearch(); }
  });

  sfEventsBound = true;
};

/* Settings Panel */
var sfOpenSettingsPanel = function () {
  var existing = forumEl('sfSettingsMask');
  if (existing) { existing.remove(); return; }
  var timePerception = sfState.settings && sfState.settings.timePerception ? ' checked' : '';
  var html = '<div class="df-modal-mask" id="sfSettingsMask">'
    + '<div class="df-modal-card" style="max-width:340px;padding:24px 20px">'
    + '<div style="font-size:17px;font-weight:800;color:#3a2230;margin-bottom:18px;text-align:center">设置</div>'
    + '<div style="display:flex;align-items:center;justify-content:space-between;padding:14px 0;border-bottom:1px solid #f0e8ec">'
    + '<div><div style="font-size:14px;font-weight:700;color:#3a2230">时间感知</div><div style="font-size:12px;color:#a87b8c;margin-top:2px">开启后AI会感知当前真实时间</div></div>'
    + '<label class="df-toggle-wrap"><input type="checkbox" id="sfTimePerceptionToggle"' + timePerception + ' class="df-toggle-input" /><span class="df-toggle-track"><span class="df-toggle-thumb"></span></span></label>'
    + '</div>'
    + '<button type="button" id="sfSettingsClose" style="width:100%;margin-top:18px;padding:12px;border:none;border-radius:14px;background:linear-gradient(135deg,#FF6B9D,#FFB6C1);color:#fff;font-size:15px;font-weight:700;cursor:pointer">关闭</button>'
    + '</div></div>';
  document.body.insertAdjacentHTML('beforeend', html);

  var toggle = forumEl('sfTimePerceptionToggle');
  if (toggle) toggle.addEventListener('change', function () {
    if (!sfState.settings) sfState.settings = {};
    sfState.settings.timePerception = this.checked;
    try { localStorage.setItem('sfState', JSON.stringify(sfState)); } catch(e) {}
  });

  var closeBtn = forumEl('sfSettingsClose');
  if (closeBtn) closeBtn.addEventListener('click', function () {
    var mask = forumEl('sfSettingsMask');
    if (mask) mask.remove();
  });

  var mask = forumEl('sfSettingsMask');
  if (mask) mask.addEventListener('click', function (e) {
    if (e.target === mask) mask.remove();
  });
};

/* Create Persona Modal */
var sfOpenCreatePersonaModal = function () {
  var existing = forumEl('sfCreatePersonaMask');
  if (existing) { existing.remove(); return; }
  var html = '<div class="df-modal-mask" id="sfCreatePersonaMask">'
    + '<div class="df-modal-card" style="max-width:380px;padding:24px 20px;max-height:85vh;overflow-y:auto">'
    + '<div style="font-size:17px;font-weight:800;color:#3a2230;margin-bottom:18px;text-align:center">创建人设</div>'
    /* Avatar upload */
    + '<div style="text-align:center;margin-bottom:16px">'
    + '<div id="sfPersonaAvatarWrap" style="width:80px;height:80px;border-radius:50%;background:#ffe0e6;margin:0 auto;overflow:hidden;cursor:pointer;display:flex;align-items:center;justify-content:center;border:2px dashed #FF6B9D">'
    + '<span id="sfPersonaAvatarText" style="font-size:12px;color:#FF6B9D">上传头像</span>'
    + '<img id="sfPersonaAvatarImg" style="display:none;width:100%;height:100%;object-fit:cover" />'
    + '</div>'
    + '<input type="file" id="sfPersonaAvatarInput" accept="image/*" style="display:none" />'
    + '</div>'
    /* Name */
    + '<div style="margin-bottom:12px">'
    + '<label style="font-size:13px;font-weight:700;color:#3a2230;display:block;margin-bottom:4px">姓名</label>'
    + '<input type="text" id="sfPersonaName" placeholder="输入角色名称" maxlength="40" style="width:100%;padding:10px 12px;border:1px solid #f0d0d8;border-radius:10px;font-size:14px;box-sizing:border-box;outline:none" />'
    + '</div>'
    /* Persona description */
    + '<div style="margin-bottom:12px">'
    + '<label style="font-size:13px;font-weight:700;color:#3a2230;display:block;margin-bottom:4px">人设描述</label>'
    + '<textarea id="sfPersonaDesc" placeholder="性格/背景/特征/与用户的关系等" rows="4" style="width:100%;padding:10px 12px;border:1px solid #f0d0d8;border-radius:10px;font-size:14px;box-sizing:border-box;outline:none;resize:vertical"></textarea>'
    + '</div>'
    /* Prompt */
    + '<div style="margin-bottom:12px">'
    + '<label style="font-size:13px;font-weight:700;color:#3a2230;display:block;margin-bottom:4px">人设提示词</label>'
    + '<textarea id="sfPersonaPrompt" placeholder="AI角色设定（详细的行为和对话指引）" rows="4" style="width:100%;padding:10px 12px;border:1px solid #f0d0d8;border-radius:10px;font-size:14px;box-sizing:border-box;outline:none;resize:vertical"></textarea>'
    + '</div>'
    /* Public/Private */
    + '<div style="margin-bottom:16px;display:flex;align-items:center;justify-content:space-between;padding:10px 0">'
    + '<div><div style="font-size:14px;font-weight:700;color:#3a2230">公开人设</div><div style="font-size:12px;color:#a87b8c;margin-top:2px">开启后所有用户都能看到</div></div>'
    + '<label class="df-toggle-wrap"><input type="checkbox" id="sfPersonaPublic" class="df-toggle-input" /><span class="df-toggle-track"><span class="df-toggle-thumb"></span></span></label>'
    + '</div>'
    /* Buttons */
    + '<div style="display:flex;gap:10px">'
    + '<button type="button" id="sfPersonaCancel" style="flex:1;padding:12px;border:1px solid #f0d0d8;border-radius:14px;background:#fff;color:#FF6B9D;font-size:15px;font-weight:700;cursor:pointer">取消</button>'
    + '<button type="button" id="sfPersonaSubmit" style="flex:1;padding:12px;border:none;border-radius:14px;background:linear-gradient(135deg,#FF6B9D,#FFB6C1);color:#fff;font-size:15px;font-weight:700;cursor:pointer">创建</button>'
    + '</div>'
    + '</div></div>';
  document.body.insertAdjacentHTML('beforeend', html);

  var avatarData = '';

  /* Avatar upload */
  var avatarWrap = forumEl('sfPersonaAvatarWrap');
  var avatarInput = forumEl('sfPersonaAvatarInput');
  var avatarImg = forumEl('sfPersonaAvatarImg');
  var avatarText = forumEl('sfPersonaAvatarText');

  if (avatarWrap) avatarWrap.addEventListener('click', function () { avatarInput.click(); });
  if (avatarInput) avatarInput.addEventListener('change', function (e) {
    var file = e.target.files[0];
    if (!file) return;
    var reader = new FileReader();
    reader.onload = function (ev) {
      avatarData = ev.target.result;
      avatarImg.src = avatarData;
      avatarImg.style.display = 'block';
      avatarText.style.display = 'none';
    };
    reader.readAsDataURL(file);
  });

  /* Cancel */
  var cancelBtn = forumEl('sfPersonaCancel');
  if (cancelBtn) cancelBtn.addEventListener('click', function () {
    var mask = forumEl('sfCreatePersonaMask');
    if (mask) mask.remove();
  });

  /* Submit */
  var submitBtn = forumEl('sfPersonaSubmit');
  if (submitBtn) submitBtn.addEventListener('click', async function () {
    var name = (forumEl('sfPersonaName').value || '').trim();
    var desc = (forumEl('sfPersonaDesc').value || '').trim();
    var promptText = (forumEl('sfPersonaPrompt').value || '').trim();
    var isPublic = forumEl('sfPersonaPublic').checked;

    if (!name) { forumToast('请填写人设名称'); return; }
    if (!desc) { forumToast('请填写人设描述'); return; }

    /* Create the role locally */
    var role = {
      id: crypto.randomUUID ? crypto.randomUUID() : ('r' + Date.now() + Math.random().toString(36).slice(2, 8)),
      name: name,
      description: desc,
      prompt: promptText || desc,
      avatar: avatarData || '',
      isPublic: isPublic,
      tags: [],
      createdAt: Date.now(),
      uploaderNickname: (sfState.user && sfState.user.nickname) || '用户'
    };

    /* Add to local state */
    if (!state.roles) state.roles = [];
    state.roles.unshift(role);
    state.activeRoleId = role.id;
    persist();

    /* If public, publish to community */
    if (isPublic) {
      await api.publishRole({ ...role, uploaderNickname: state.user.nickname }).catch(function(err) { forumToast(err.message || '发布失败'); });
    }

    renderAll();
    forumToast('人设创建成功！');
    var mask = forumEl('sfCreatePersonaMask');
    if (mask) mask.remove();
  });

  /* Click mask to close */
  var mask = forumEl('sfCreatePersonaMask');
  if (mask) mask.addEventListener('click', function (e) {
    if (e.target === mask) mask.remove();
  });
};


/* ======================================================================
 *  PART 2 - DOUJIN FORUM  (LOFTER light theme)
 * ==================================================================== */

/* ---- preset tags ---- */
var DF_TAGS = ['全部', '古代', '现代', '虐恋', '甜文', '穿越', '校园', '奇幻', '豪门', '悬疑', '玄幻', '科幻'];

/* ---- state ---- */
var dfState = {
  active: false,
  currentTag: '',
  selectedCharacter: null,
  selectedTags: [],
  selectedTropes: [], // 多选的同人梗 (存名称字符串)
  tropePresets: ['破镜重圆', '先婚后爱', '失忆梗', '替身恋人', '双向暗恋', '强制爱', '青梅竹马', '虐恋情深'],
  customTropes: [], // 用户自定义梗，每个是 {name, content}
  customTags: [], // 用户自定义标签
  deletedPresetTags: [], // 用户删除的预设标签
  wordCount: '1200',
  style: '虐心',
  customRequest: '',
  area: '原著向',
  works: [],
  bookmarks: [], // 书架收藏，每个是 {work, chapters: [{title, content, read}], currentChapter}
  currentView: 'library', // library/generate/detail/bookshelf/bookDetail/continue
  _generating: false, /* 生成中标志，阻止旧内容重新渲染 */
  currentBook: null, // 当前查看的书架作品
  /* internal */
  role: null,
  currentRank: 'heat',
  loading: false,
  worksCache: {},
  allWorks: [],
  userWorks: [],
  collectedWorks: [],
  commentsCache: {},
  currentWork: null,
  currentWorkId: null,
  searchVisible: false,
  pickerTab: 'roles', /* roles | community | mine */
  communityPersonas: [],
  communitySearch: '',
  communityTagFilter: null,
  userDisplayName: null,
  userAvatarSrc: null,
  userIdentityTag: null,
  myPersonas: [],
  personasLoaded: false
};

/* Load trope & tag data from localStorage */
var dfLoadTropeData = function () {
  try {
    var presets = localStorage.getItem('df_trope_presets');
    if (presets) dfState.tropePresets = JSON.parse(presets);
  } catch (e) {}
  try {
    var customs = localStorage.getItem('df_custom_tropes');
    if (customs) {
      var parsed = JSON.parse(customs);
      /* 兼容旧版本（字符串数组） -> 转成 {name, content} */
      dfState.customTropes = (parsed || []).map(function (t) {
        if (typeof t === 'string') return { name: t, content: '' };
        return t;
      });
    }
  } catch (e) {}
  try {
    var tags = localStorage.getItem('df_custom_tags');
    if (tags) dfState.customTags = JSON.parse(tags) || [];
  } catch (e) {}
  try {
    var delTags = localStorage.getItem('df_deleted_preset_tags');
    if (delTags) dfState.deletedPresetTags = JSON.parse(delTags) || [];
  } catch (e) {}
  try {
    var bm = localStorage.getItem('df_bookmarks');
    if (bm) dfState.bookmarks = JSON.parse(bm) || [];
  } catch (e) {}
};

/* Save trope data to localStorage */
var dfSaveTropeData = function () {
  try {
    localStorage.setItem('df_trope_presets', JSON.stringify(dfState.tropePresets));
  } catch (e) {}
  try {
    localStorage.setItem('df_custom_tropes', JSON.stringify(dfState.customTropes));
  } catch (e) {}
};

/* Save custom tags to localStorage */
var dfSaveCustomTags = function () {
  try {
    localStorage.setItem('df_custom_tags', JSON.stringify(dfState.customTags));
  } catch (e) {}
  try {
    localStorage.setItem('df_deleted_preset_tags', JSON.stringify(dfState.deletedPresetTags));
  } catch (e) {}
};

/* 自定义标签输入弹窗（替代 window.prompt，移动端兼容） */
var dfShowTagInputModal = function(callback) {
  var existing = document.getElementById('dfTagInputModal');
  if (existing) existing.remove();
  var overlay = document.createElement('div');
  overlay.id = 'dfTagInputModal';
  overlay.style.cssText = 'position:fixed;top:0;left:0;width:100%;height:100%;background:rgba(0,0,0,.5);z-index:10000;display:flex;align-items:center;justify-content:center;padding:20px';
  overlay.innerHTML = '<div style="background:#fff;border-radius:16px;padding:24px;width:100%;max-width:340px">'
    + '<div style="font-size:16px;font-weight:700;color:#333;margin-bottom:16px">添加标签</div>'
    + '<input id="dfTagInputField" type="text" placeholder="输入标签名称（如：古风、校园、虐恋）" style="width:100%;padding:12px 16px;border:1px solid #ddd;border-radius:10px;font-size:15px;outline:none;box-sizing:border-box" maxlength="10" />'
    + '<div style="display:flex;gap:10px;margin-top:16px">'
    + '<button id="dfTagInputCancel" style="flex:1;padding:10px;border:1px solid #ddd;border-radius:10px;background:#fff;color:#666;font-size:14px;cursor:pointer">取消</button>'
    + '<button id="dfTagInputConfirm" style="flex:1;padding:10px;border:0;border-radius:10px;background:#FF6B9D;color:#fff;font-size:14px;font-weight:600;cursor:pointer">确认</button>'
    + '</div></div>';
  document.body.appendChild(overlay);
  var input = document.getElementById('dfTagInputField');
  var cancelBtn = document.getElementById('dfTagInputCancel');
  var confirmBtn = document.getElementById('dfTagInputConfirm');
  if (input) {
    input.focus();
    input.addEventListener('keydown', function(e) {
      if (e.key === 'Enter') { e.preventDefault(); confirmBtn.click(); }
      if (e.key === 'Escape') { overlay.remove(); }
    });
  }
  if (cancelBtn) cancelBtn.addEventListener('click', function() { overlay.remove(); });
  if (confirmBtn) confirmBtn.addEventListener('click', function() {
    var val = input ? input.value.trim() : '';
    overlay.remove();
    if (val) callback(val);
  });
  overlay.addEventListener('click', function(e) {
    if (e.target === overlay) overlay.remove();
  });
};

/* Save bookmarks to localStorage */
var dfSaveBookmarks = function () {
  try {
    localStorage.setItem('df_bookmarks', JSON.stringify(dfState.bookmarks));
  } catch (e) {}
};

/* ---- fallback content ---- */
var DF_FALLBACK_WORKS = [
  {
    id: 'df-fb-1', title: '栀子花开的夏天', authorName: '夏蝉不知秋',
    tags: ['古代', '甜文'],
    excerpt: '那年夏天，栀子花开满整条巷子，我第一次知道心动是有气味的。',
    content: '那年夏天，栀子花开满整条巷子，我第一次知道心动是有气味的。\\n\\n她搬来隔壁的那天，拎着一箱旧书，裙角沾着雨水。我站在阳台上假装浇花，其实只是想多看她一眼。后来整整一个夏天，我都学会了在傍晚六点准时出现在巷口。\\n\\n"你家的栀子花真香。"她某天忽然对我说。\\n\\n我才知道，原来花香是真的，心动也是真的。',
    authorWords: '写给每一个在夏天悄悄心动过的人。愿你的勇敢，配得上那场花开。'
  },
  {
    id: 'df-fb-2', title: '星海彼岸的回信', authorName: '深空信使',
    tags: ['玄幻', '科幻'],
    excerpt: '当光从星海彼岸抵达时，写信的人或许早已不在，但回信永远不会太迟。',
    content: '当光从星海彼岸抵达时，写信的人或许早已不在，但回信永远不会太迟。\\n\\n我在第七航标站值守了四十年，接收过无数封漂流在星际间的信。大多数都字迹模糊，只剩下零碎的思念。直到那天，我收到一封完整的信，收件人写着我的名字。\\n\\n信里只有一句话："谢谢你，曾经替我点亮过那盏灯。"\\n\\n我抬头望向星空，忽然想起，二十岁那年我确实为某个迷路的旅人，亮过一整夜的灯。',
    authorWords: '宇宙很大，但善意会沿着光的路径，最终回到原点。'
  },
  {
    id: 'df-fb-3', title: '煮一壶光阴', authorName: '半盏清茶',
    tags: ['现代', '甜文'],
    excerpt: '日子是煮出来的，急不得。一壶水从凉到沸，正好够我想完一桩旧事。',
    content: '日子是煮出来的，急不得。\\n\\n一壶水从凉到沸，正好够我想完一桩旧事。茶叶在杯底舒展的样子，像极了那些被时间泡软的回忆——原本尖锐的棱角，渐渐变得温润。\\n\\n外婆说，好茶要慢慢等，好人要慢慢懂。我小时候不信，如今却在这氤氲的水汽里，把这句话品出了味道。\\n\\n窗外落雨，屋里茶香。这大概就是平凡日子里，最奢侈的安稳。',
    authorWords: '愿你我都能在快日子里，留一壶慢时光。'
  },
  {
    id: 'df-fb-4', title: '夜行列车', authorName: '匿名旅人',
    tags: ['现代', '虐恋'],
    excerpt: '我把名字留给站台，把影子留给车窗，把黎明留给下一个远方。',
    content: '我把名字留给站台\\n把影子留给车窗\\n把黎明留给下一个远方\\n\\n列车摇晃着夜色\\n像摇篮，也像流放\\n邻座的人睡着\\n梦里或许有故乡\\n\\n我不问终点在哪里\\n只记得出发时\\n风很轻，星光很亮\\n而我，终于学会一个人\\n勇敢地往前行',
    authorWords: '献给每一个深夜还在路上的人。'
  },
  {
    id: 'df-fb-5', title: '第七次重启', authorName: '代码诗人',
    tags: ['科幻', '悬疑'],
    excerpt: '系统提示：这是你第七次选择重启记忆。前六次，你都选择了忘记同一个人。',
    content: '系统提示：这是你第七次选择重启记忆。前六次，你都选择了忘记同一个人。\\n\\n我盯着悬浮屏上的红字，手指悬在确认键上方。记忆清除协议本该让我忘掉一切痛苦，可每一次重启后，我都会在同一个路口停下，望着一张陌生的脸发呆。\\n\\n"你认识我吗？"那个人总会这样问。\\n\\n我摇头，却莫名地想哭。\\n\\n第七次，我终于没有按下确认键。我把那段被反复删除的记忆，亲手抄进了纸质的日记本里——那是系统永远无法触达的地方。',
    authorWords: '有些记忆，是刻在灵魂里的，删不掉，也不该删。'
  },
  {
    id: 'df-fb-6', title: '阁楼上的客人', authorName: '旧时钟',
    tags: ['豪门', '悬疑'],
    excerpt: '阁楼的门锁了三十年，可每到雨夜，楼下总能听见有人踱步。',
    content: '阁楼的门锁了三十年，可每到雨夜，楼下总能听见有人踱步。\\n\\n爷爷临终前嘱咐过，那扇门无论如何不能开。我守着这栋老宅长大，从小听着楼上的脚步声入睡，竟也习惯了。\\n\\n直到那个暴雨夜，锁自己掉了下来。\\n\\n我举着烛台上楼，推开门。阁楼里空无一人，只有一把摇椅，正对着窗户，缓缓地、缓缓地晃动。\\n\\n摇椅扶手上，放着一封写给我名字的信。落款是三十年前，失踪的奶奶。',
    authorWords: '有些告别，是用一生在等一个解释。'
  },
  {
    id: 'df-fb-7', title: '如果那年不下雨', authorName: '南风过境',
    tags: ['校园', '虐恋'],
    excerpt: '如果那年不下雨，我们大概不会共撑一把伞，也就不会有后来所有的故事。',
    content: '如果那年不下雨，我们大概不会共撑一把伞，也就不会有后来所有的故事。\\n\\n你把伞倾向我这边，自己的半边肩膀却湿透了。我没说破，只是悄悄把脚步放慢，想让那条回家的路长一点，再长一点。\\n\\n后来我们走散了很多年。再重逢时，又是一个雨天。你笑着说："这次，换我撑伞。"\\n\\n我看着你鬓角的白发，忽然明白，有些缘分，是老天用一场雨，悄悄替我们系上的结。',
    authorWords: '所有不期而遇，都是久别重逢。'
  },
  {
    id: 'df-fb-8', title: '龙裔的最后花园', authorName: '青苔与剑',
    tags: ['奇幻', '玄幻'],
    excerpt: '龙族消亡后的第三百年，最后一座花园里，开出了会唱歌的花。',
    content: '龙族消亡后的第三百年，最后一座花园里，开出了会唱歌的花。\\n\\n我是守园人，也是这片大陆上最后一个还记得龙语的人。花儿们用龙的声调哼唱，每一段旋律都是一段被遗忘的历史。\\n\\n有一天，一个少年闯进花园，问我："传说龙会重生，是真的吗？"\\n\\n我没有回答，只是折下一枝会唱歌的花递给他。花在他手中忽然安静下来，片刻后，他的瞳孔变成了竖瞳。\\n\\n"原来，"我轻声说，"你一直都在。"',
    authorWords: '消亡从来不是终点，只是另一种形式的等待。'
  },
  {
    id: 'df-fb-9', title: '穿越之长安夜雨', authorName: '炊烟袅袅',
    tags: ['穿越', '古代'],
    excerpt: '那只搪瓷杯掉了一块瓷，露出黑铁的内里，却盛过我整个童年。',
    content: '雨打长安城，灯火万家明。\\n\\n她醒来时，身在一间陌生的阁楼里。窗外是飞檐斗拱、雕梁画栋，空气中弥漫着檀香与墨汁的气息。她低头看自己的手——纤长、白皙，指甲修剪得整整齐齐。\\n\\n这不是她的手。她记得自己是一个普通的博物馆研究员，昨晚加班整理唐代文物时趴在桌上睡着了。\\n\\n可现在，她成了唐朝长安城里一个闺阁小姐。\\n\\n门被推开，一个丫鬟端着铜盆走进来："小姐，该梳妆了。今日长公主府设宴，老爷让您务必出席。"',
    authorWords: '穿越千年，只为与你在长安的雨夜相遇。'
  },
  {
    id: 'df-fb-10', title: '月球邮局营业中', authorName: '环形山管理员',
    tags: ['科幻', '奇幻'],
    excerpt: '欢迎光临月球邮局。这里寄信很慢，要绕地球三圈，但从不丢失。',
    content: '欢迎光临月球邮局。这里寄信很慢，要绕地球三圈，但从不丢失。\\n\\n我是这里的唯一邮递员，也是唯一住户。地球上来寄信的人不多，大多寄给已故的亲人，或是多年未见、不敢联系的旧友。\\n\\n昨天来了一个姑娘，寄了一封空信。"写什么呢，"她红着眼说，"他什么都知道。"\\n\\n我把空信封盖上月尘邮戳，投进投递口。信封缓缓飘向那颗蓝色的星球。\\n\\n有些话不必写出来，抵达本身就是答案。',
    authorWords: '在月球，连沉默都能被认真投递。'
  },
  {
    id: 'df-fb-11', title: '豪门契约：替身新娘', authorName: '时间旅人',
    tags: ['豪门', '虐恋'],
    excerpt: '十年后的你是否还认得，这首诗里藏着的，是今天不敢说出口的话。',
    content: '签下那份协议时，她知道这只是一场交易。\\n\\n他需要一个妻子来安抚病危的祖母，她需要一笔钱来偿还父亲留下的巨债。三个月的婚姻，各取所需，到期就离婚，干干净净。\\n\\n可她没想到，那个看似冷酷的男人，会在深夜为她熬一碗姜汤，因为她淋了雨。会在她被亲戚刁难时，不动声色地挡在前面。\\n\\n"你以为我在演戏？"他某天忽然问。\\n\\n她不敢回答，因为她的心跳已经暴露了一切。',
    authorWords: '有些契约，签下容易，撕毁很难。'
  },
  {
    id: 'df-fb-12', title: '第十三封未读', authorName: '深夜编辑',
    tags: ['悬疑', '现代'],
    excerpt: '邮箱里躺着第十三封未读邮件，发件人是我自己，时间是明年。',
    content: '邮箱里躺着第十三封未读邮件，发件人是我自己，时间是明年。\\n\\n前十二封我都读过，每一封都准确预言了之后发生的事：一次升职，一场失恋，一个雨天捡到的橘猫。我渐渐不敢再点开。\\n\\n可第十三封的标题写着："别打开这封信。"\\n\\n我盯着屏幕整整一夜。清晨，我终于挪开鼠标，却没点开，而是把它拖进了回收站。\\n\\n第二天，邮箱里出现了第十四封。标题是："谢谢你，这次你终于选对了。"',
    authorWords: '有时候，不被剧透的人生，才值得过。'
  }
];

var DF_COMMENT_AUTHORS = ['纸鸢', '青柠', '夜读人', '拾光者', '旧书店', '橘子汽水', '听雨', '木兮'];
var DF_COMMENT_TEMPLATES = [
  '文笔太好了，看哭了', '已收藏，慢慢读', '求更新！', '这段描写绝了',
  '作者大大辛苦了', '读到这段想起很多事', '氛围感拉满', '已三连支持'
];

var dfFallbackComments = function () {
  var n = 2 + Math.floor(Math.random() * 3);
  var arr = [];
  for (var i = 0; i < n; i++) {
    var idx = Math.floor(Math.random() * DF_COMMENT_AUTHORS.length);
    arr.push({
      id: 'dc-fb-' + Date.now() + '-' + i,
      authorName: DF_COMMENT_AUTHORS[idx],
      content: DF_COMMENT_TEMPLATES[Math.floor(Math.random() * DF_COMMENT_TEMPLATES.length)],
      time: ['刚刚', '2分钟前', '5分钟前', '15分钟前', '半小时前'][i % 5],
      avatarIndex: idx % 8
    });
  }
  return arr;
};

var dfFallbackWorks = function (tag) {
  var list = DF_FALLBACK_WORKS.filter(function (w) {
    if (tag === '全部' || !tag) return true;
    return (w.tags || []).indexOf(tag) !== -1;
  });
  return list.map(function (w, idx) {
    var seed = (w.id || '').length + idx * 7;
    return {
      id: w.id,
      title: w.title,
      authorName: w.authorName,
      excerpt: w.excerpt,
      content: w.content,
      authorWords: w.authorWords,
      tags: (w.tags || []).slice(),
      likes: 50 + (seed * 13) % 900,
      collects: 20 + (seed * 7) % 500,
      comments: 3 + (seed * 5) % 40,
      avatarIndex: seed % 8,
      coverGradient: FORUM_GRADIENTS[seed % FORUM_GRADIENTS.length]
    };
  });
};

/* ---- helpers ---- */
var dfFindWork = function (workId) {
  var w = dfState.userWorks.find(function (x) { return x.id === workId; });
  if (w) return w;
  w = dfState.allWorks.find(function (x) { return x.id === workId; });
  if (w) return w;
  w = dfState.collectedWorks.find(function (x) { return x.id === workId; });
  return w || null;
};

var dfMergeAllWorks = function (works) {
  var seen = {};
  dfState.allWorks.forEach(function (w) { seen[w.id] = true; });
  works.forEach(function (w) {
    if (w && w.id && !seen[w.id]) { dfState.allWorks.push(w); seen[w.id] = true; }
  });
};

/* 持久化同人文数据到 localStorage */
var dfSaveWorksCache = function () {
  try {
    /* 生成的作品不持久化，刷新后自动消失 */
    /* 只持久化用户发布的作品和收藏（加入书架）的作品 */
    localStorage.removeItem('df_all_works');
    localStorage.setItem('df_user_works', JSON.stringify(dfState.userWorks.slice(0, 100)));
    localStorage.setItem('df_collected_works', JSON.stringify(dfState.collectedWorks.slice(0, 100)));
  } catch (e) {}
};

var dfGetDisplayWorks = function (tag) {
  /* 只显示用户自己发布的作品（不显示AI生成的作品） */
  var source = (dfState.userWorks && dfState.userWorks.length > 0) ? dfState.userWorks : dfState.allWorks;
  var match = source.filter(function (w) {
    if (tag === '全部' || !tag) return true;
    return (w.tags || []).indexOf(tag) !== -1;
  });
  return match;
};

var dfAvatarGradient = function (index) {
  return SF_AVATAR_GRADIENTS[(index || 0) % SF_AVATAR_GRADIENTS.length];
};

/* ---- open / close ---- */
var openDoujinForum = function (role) {
  dfState.role = role || (typeof activeRole === 'function' ? activeRole() : null);
  if (typeof closeSocialForum === 'function') closeSocialForum();
  dfState.active = true;
  dfState.currentTag = '全部';
  dfState.currentRank = 'heat';
  dfState.currentView = 'library';
  dfState.worksCache = {};
  dfState.loading = false;
  dfState.searchVisible = false;

  /* 恢复同人文缓存数据：只恢复发布的作品和收藏的作品，不恢复生成的作品 */
  try {
    var cachedUserWorks = localStorage.getItem('df_user_works');
    if (cachedUserWorks) {
      dfState.userWorks = JSON.parse(cachedUserWorks);
    }
    var cachedCollected = localStorage.getItem('df_collected_works');
    if (cachedCollected) {
      dfState.collectedWorks = JSON.parse(cachedCollected);
    }
    /* 从发布的作品和收藏的作品重建 allWorks（不含生成的作品） */
    dfState.allWorks = [];
    dfMergeAllWorks(dfState.userWorks);
    dfMergeAllWorks(dfState.collectedWorks);
    /* 填充 worksCache 使得标签筛选可用 */
    dfState.allWorks.forEach(function (w) {
      var tags = w.tags || ['全部'];
      tags.forEach(function (t) {
        if (!dfState.worksCache[t]) dfState.worksCache[t] = [];
        if (!dfState.worksCache[t].find(function (c) { return c.id === w.id; })) {
          dfState.worksCache[t].push(w);
        }
      });
      if (!dfState.worksCache['全部']) dfState.worksCache['全部'] = [];
      if (!dfState.worksCache['全部'].find(function (c) { return c.id === w.id; })) {
        dfState.worksCache['全部'].push(w);
      }
    });
  } catch (e) {}

  /* 检查后台任务 */
  bgCheckAllTasks();

  /* load trope data */
  dfLoadTropeData();

  /* select the role as the character */
  if (role) {
    dfState.selectedCharacter = {
      id: role.id,
      name: role.name,
      avatar: role.avatar || null
    };
  }

  dfRenderTagNav();
  dfEnsureHomeHeader();
  dfRenderHomeHeader();
  dfRenderNavAvatar();
  dfEnsureGeneratePage();
  dfEnsureCharPicker();
  var overlay = forumEl('doujinForumOverlay');
  if (overlay) overlay.classList.add('active');

  /* reset active states for pages & tabs */
  document.querySelectorAll('#dfPages .df-page').forEach(function (p) {
    p.classList.toggle('active', p.id === 'dfHomePage');
  });
  document.querySelectorAll('.df-bottom-nav .df-tab').forEach(function (t) {
    t.classList.toggle('active', t.dataset.dfPage === 'dfHomePage');
  });

  /* 清空首页内容区，避免残留上次生成的作品 */
  var _homeContent = forumEl('dfHomeContent');
  if (_homeContent) _homeContent.innerHTML = '';
  dfRenderWorksList();
};

var closeDoujinForum = function () {
  dfState.active = false;
  dfState._generating = false;
  var overlay = forumEl('doujinForumOverlay');
  if (overlay) overlay.classList.remove('active');
  var detail = forumEl('dfDetailOverlay');
  if (detail) detail.classList.remove('active');
  dfState.currentWork = null;
  dfState.currentWorkId = null;
  /* 清空首页内容区，避免重新打开时残留上次生成的作品 */
  var homeContent = forumEl('dfHomeContent');
  if (homeContent) homeContent.innerHTML = '';
};

/* ---- home header: character pairing bar + generate button + trope bar ---- */
var dfSelectedChar = function () {
  var sc = dfState.selectedCharacter;
  if (sc && sc.name) return sc;
  var role = dfState.role || (typeof activeRole === 'function' ? activeRole() : null);
  if (role) return { id: role.id, name: role.name, avatar: role.avatar || null };
  return { id: null, name: '选择角色', avatar: null };
};

/* 获取用户人设信息（含人设关系）— 优先从 localStorage 读取已保存的人设，其次从 state.user 读取 */
var dfGetUserPersona = function () {
  /* 1. 优先从全局 state.user 读取（App主页"我的"页面设置的用户昵称和人设，最新数据） */
  try {
    if (typeof state !== 'undefined' && state.user) {
      var nick = state.user.nickname || '体验用户';
      if (nick !== '体验用户') {
        return { nickname: nick, bio: state.user.bio || '', avatar: state.user.avatar || '', relations: state.user.relations || '' };
      }
    }
  } catch(e) {}
  /* 2. 其次检查 sf_user_profile（与社交论坛共享的用户主页数据） */
  try {
    var saved = localStorage.getItem('sf_user_profile');
    if (saved) {
      var parsed = JSON.parse(saved);
      if (parsed && parsed.displayName && parsed.displayName !== '体验用户') {
        return { nickname: parsed.displayName, bio: parsed.bio || '', avatar: parsed.avatar || '', relations: parsed.relations || '' };
      }
    }
  } catch(e) {}
  /* 3. 最后尝试从服务器同步（异步，返回默认值，但触发同步） */
  try {
    if (typeof window !== 'undefined' && !window._personaSyncing) {
      window._personaSyncing = true;
      fetch('/api/profile', { headers: { 'X-User-Id': (typeof CONFIG !== 'undefined' && CONFIG.userId) ? CONFIG.userId : '' } })
        .then(function(r) { return r.json(); })
        .then(function(data) {
          if (data && data.data && data.data.nickname && data.data.nickname !== '体验用户') {
            try {
              localStorage.setItem('sf_user_profile', JSON.stringify({
                displayName: data.data.nickname,
                bio: data.data.bio || '',
                avatar: data.data.avatar || '',
                relations: data.data.relations || ''
              }));
            } catch(e) {}
          }
        })
        .catch(function() {})
        .finally(function() { window._personaSyncing = false; });
    }
  } catch(e) {}
  return { nickname: '体验用户', bio: '', avatar: '', relations: '' };
};

/* 渲染同人论坛左上角导航头像（使用用户主页的头像/昵称，而非角色信息） */
var dfRenderNavAvatar = function () {
  var navAvatar = forumEl('dfNavAvatar');
  if (!navAvatar) return;
  /* 优先读取 sf_user_profile（与社交论坛共享用户主页数据） */
  var name = '体验用户';
  var avatarSrc = null;
  try {
    var saved = localStorage.getItem('sf_user_profile');
    if (saved) {
      var parsed = JSON.parse(saved);
      if (parsed.displayName) name = parsed.displayName;
      if (parsed.avatar) avatarSrc = parsed.avatar;
    }
  } catch (e) {}
  if (!avatarSrc) {
    /* 回退到 state.user.avatar */
    var p = dfGetUserPersona();
    if (p.avatar) avatarSrc = p.avatar;
    if (p.nickname) name = p.nickname;
  }
  if (avatarSrc) {
    navAvatar.innerHTML = '<img src="' + avatarSrc + '" style="width:100%;height:100%;border-radius:50%;object-fit:cover" alt="" />';
  } else {
    navAvatar.innerHTML = escapeHtml(forumInitial(name));
  }
  /* 点击导航头像跳转到"我的"页面 */
  navAvatar.onclick = function () { dfSwitchPage('dfMyPage'); };
};

/* Build avatar HTML for the user persona side (shows image if available, else gradient initial) */
var dfUserAvatarHtml = function (size) {
  size = size || 54;
  var p = dfGetUserPersona();
  if (p.avatar) {
    return '<div class="df-pairing-avatar" style="width:' + size + 'px;height:' + size + 'px"><img src="' + p.avatar + '" alt=""/></div>';
  }
  var initial = (p.nickname || 'U').charAt(0);
  return '<div class="df-pairing-avatar" style="width:' + size + 'px;height:' + size + 'px;background:linear-gradient(135deg,#FF6B9D,#FFB6C1)">' + escapeHtml(initial) + '</div>';
};

var dfCharAvatarHtml = function (char, size) {
  size = size || 54;
  if (char && char.avatar) {
    return '<div class="df-pairing-avatar" style="width:' + size + 'px;height:' + size + 'px"><img src="' + char.avatar + '" alt=""/></div>';
  }
  var initial = char && char.name ? forumInitial(char.name) : '?';
  return '<div class="df-pairing-avatar" style="width:' + size + 'px;height:' + size
    + 'px;background:linear-gradient(135deg,#FF6B9D,#FFB6C1)">' + escapeHtml(initial) + '</div>';
};

var dfEnsureHomeHeader = function () {
  var home = forumEl('dfHomePage');
  if (!home) return;
  var header = forumEl('dfHomeHeader');
  if (!header) {
    header = document.createElement('div');
    header.id = 'dfHomeHeader';
    home.insertBefore(header, home.firstChild);
    /* delegated clicks (survive re-renders of header.innerHTML) */
    header.addEventListener('click', function (e) {
      /* generate button */
      if (e.target.closest('#dfHomeGenBtn')) { dfGenerateWork(); return; }
      /* character picker */
      if (e.target.closest('#dfPairRole')) { dfOpenCharPicker(); return; }
      /* persona edit */
      if (e.target.closest('#dfHomePersonaEdit')) { dfOpenPersonaEditor(); return; }
      /* community entry -> navigate to community page */

      /* add tag */
      if (e.target.closest('#dfHomeTagAdd')) {
        dfShowTagInputModal(function(newTag) {
          newTag = String(newTag).trim();
          if (!newTag) return;
          if (dfState.customTags.indexOf(newTag) === -1 && DF_TAGS.indexOf(newTag) === -1) {
            dfState.customTags.push(newTag);
            dfSaveCustomTags();
          }
          if (dfState.selectedTags.indexOf(newTag) === -1) dfState.selectedTags.push(newTag);
          dfRenderHomeHeader();
        });
        return;
      }
      /* tag delete — only custom tags can be deleted, preset tags cannot */
      var tagDel = e.target.closest('[data-tag-del]');
      if (tagDel) {
        var delTag = tagDel.dataset.tagDel;
        var ti = dfState.customTags.indexOf(delTag);
        if (ti !== -1) {
          dfState.customTags.splice(ti, 1);
          var sti = dfState.selectedTags.indexOf(delTag);
          if (sti !== -1) dfState.selectedTags.splice(sti, 1);
          dfSaveCustomTags();
          dfRenderHomeHeader();
        }
        return;
      }
      /* tag toggle */
      var tagChip = e.target.closest('[data-gen-tag]');
      if (tagChip) {
        var tag = tagChip.dataset.genTag;
        var tagIdx = dfState.selectedTags.indexOf(tag);
        if (tagIdx !== -1) {
          dfState.selectedTags.splice(tagIdx, 1);
          tagChip.classList.remove('selected');
        } else {
          dfState.selectedTags.push(tag);
          tagChip.classList.add('selected');
        }
        return;
      }
      /* trope add */
      if (e.target.closest('#dfHomeTropeAdd')) { dfOpenTropeModal(); return; }
      /* trope delete */
      var tropeDelBtn = e.target.closest('[data-trope-del]');
      if (tropeDelBtn) {
        dfDeleteTropeByName(tropeDelBtn.dataset.tropeDel);
        return;
      }
      /* trope toggle */
      var tropeChip = e.target.closest('[data-home-trope]');
      if (tropeChip) {
        var trope = tropeChip.dataset.homeTrope;
        var idx = dfState.selectedTropes.indexOf(trope);
        if (idx !== -1) {
          dfState.selectedTropes.splice(idx, 1);
          tropeChip.classList.remove('selected');
        } else {
          dfState.selectedTropes.push(trope);
          tropeChip.classList.add('selected');
        }
        return;
      }
      /* word count */
      var wordOpt = e.target.closest('[data-word-count]');
      if (wordOpt) {
        dfState.wordCount = wordOpt.dataset.wordCount;
        header.querySelectorAll('[data-word-count]').forEach(function (el) {
          el.classList.toggle('selected', el.dataset.wordCount === dfState.wordCount);
        });
        return;
      }
      /* home area */
      var homeAreaOpt = e.target.closest('[data-home-area]');
      if (homeAreaOpt) {
        dfState.area = homeAreaOpt.dataset.homeArea;
        header.querySelectorAll('[data-home-area]').forEach(function (el) {
          el.classList.toggle('selected', el.dataset.homeArea === dfState.area);
        });
        return;
      }
    });
  }
  /* home customRequest textarea binding */
  var homeReqInput = forumEl('dfHomeRequestInput');
  if (homeReqInput) {
    homeReqInput.addEventListener('input', function () {
      dfState.customRequest = homeReqInput.value;
    });
  }
};

/* Build a unified list of all tropes: presets + custom ({name, content, isCustom}) */
var dfAllTropes = function () {
  var list = dfState.tropePresets.map(function (name) {
    return { name: name, content: '', isCustom: false };
  });
  dfState.customTropes.forEach(function (t) {
    if (t && t.name) list.push({ name: t.name, content: t.content || '', isCustom: true });
  });
  return list;
};

var dfRenderHomeHeader = function () {
  var header = forumEl('dfHomeHeader');
  if (!header) return;
  var ch = dfSelectedChar();
  var userPersona = dfGetUserPersona();

  /* tag chips */
  var presetTags = DF_TAGS.filter(function (t) { return t !== '全部'; });
  var presetTagChips = presetTags.map(function (t) {
    var selected = dfState.selectedTags.indexOf(t) !== -1 ? ' selected' : '';
    return '<span class="df-gen-tag-chip' + selected + '" data-gen-tag="' + escapeHtml(t) + '">' + escapeHtml(t) + '</span>';
  }).join('');
  var customTagChips = (dfState.customTags || []).map(function (t) {
    var selected = dfState.selectedTags.indexOf(t) !== -1 ? ' selected' : '';
    return '<span class="df-gen-tag-chip' + selected + '" data-gen-tag="' + escapeHtml(t) + '">' + escapeHtml(t)
      + '<span class="df-tag-delete" data-tag-del="' + escapeHtml(t) + '" title="删除">&times;</span></span>';
  }).join('');
  var tagChipsHtml = presetTagChips + customTagChips
    + '<button type="button" class="df-gen-tag-chip add" id="dfHomeTagAdd" style="border:none;outline:none;-webkit-appearance:none;appearance:none" >+ 添加标签</button>';

  /* trope chips */
  var allTropes = dfAllTropes();
  var tropeChipsHtml = allTropes.map(function (t) {
    var selected = dfState.selectedTropes.indexOf(t.name) !== -1 ? ' selected' : '';
    var deleteBtn = t.isCustom ? '<span class="df-trope-delete" data-trope-del="' + escapeHtml(t.name) + '" title="删除">&times;</span>' : '';
    return '<span class="df-gen-trope-chip' + selected + '" data-home-trope="' + escapeHtml(t.name) + '">' + escapeHtml(t.name) + deleteBtn + '</span>';
  }).join('');
  tropeChipsHtml += '<button type="button" class="df-gen-trope-chip add" id="dfHomeTropeAdd" style="border:none;outline:none;-webkit-appearance:none;appearance:none">+ 创建新同人梗</button>';

  /* word count options */
  var wordOptions = [
    { value: '1000', label: '短打 800-1000字' },
    { value: '1200', label: '标准 1000-1500字' },
    { value: '1500', label: '长打 1200-1500字' }
  ];
  var wordCountHtml = wordOptions.map(function (opt) {
    var selected = dfState.wordCount === opt.value ? ' selected' : '';
    return '<span class="df-gen-option' + selected + '" data-word-count="' + opt.value + '">' + opt.label + '</span>';
  }).join('');

  /* 人设编辑区 */
  var personaEditHtml = '<div class="df-gen-section" id="dfHomePersonaSection">'
    + '<div class="df-gen-section-label">我的人设</div>'
    + '<div class="df-home-persona-row">'
    + dfUserAvatarHtml(48)
    + '<div class="df-home-persona-info">'
    + '<div class="df-home-persona-name">' + escapeHtml(userPersona.nickname || '体验用户') + '</div>'
    + '<div class="df-home-persona-bio">' + (userPersona.bio ? escapeHtml(userPersona.bio.slice(0, 50)) + (userPersona.bio.length > 50 ? '...' : '') : '点击设置人设') + '</div>'
    + '</div>'
    + '<button class="df-home-persona-edit-btn" id="dfHomePersonaEdit" type="button">编辑</button>'
    + '</div></div>';

  /* 人设社区已移至顶层模块 */

  header.innerHTML = '<div class="df-pairing">'
    + '<div class="df-pairing-side" id="dfPairRole">'
    + dfCharAvatarHtml(ch, 54)
    + '<div class="df-pairing-name">' + escapeHtml(ch.name) + '</div>'
    + '<div class="df-pairing-change">点击更换</div>'
    + '</div>'
    + '<span class="df-pairing-x">&times;</span>'
    + '<div class="df-pairing-side">'
    + dfUserAvatarHtml(54)
    + '<div class="df-pairing-name">' + escapeHtml(userPersona.nickname || 'User') + '</div>'
    + '<div class="df-pairing-change">' + (userPersona.bio ? '人设已设' : '未设人设') + '</div>'
    + '</div>'
    + '</div>'

    /* tags */
    + '<div class="df-gen-section">'
    + '<div class="df-gen-section-label">标签（点击选择）</div>'
    + '<div class="df-gen-tags">' + tagChipsHtml + '</div>'
    + '</div>'

    /* tropes */
    + '<div class="df-gen-section">'
    + '<div class="df-gen-section-label">同人梗（点击选择）</div>'
    + '<div class="df-gen-tropes">' + tropeChipsHtml + '</div>'
    + '</div>'

    /* word count */
    + '<div class="df-gen-section">'
    + '<div class="df-gen-section-label">字数</div>'
    + '<div class="df-gen-options">' + wordCountHtml + '</div>'
    + '</div>'

    /* custom request (要求) */
    + '<div class="df-gen-section">'
    + '<div class="df-gen-section-label">要求（选填）</div>'
    + '<textarea class="df-gen-request-input" id="dfHomeRequestInput" rows="3" placeholder="描述你的创作要求，例如：希望是甜文，校园背景...">' + escapeHtml(dfState.customRequest || '') + '</textarea>'
    + '</div>'

    /* area (区域/世界观) */
    + '<div class="df-gen-section">'
    + '<div class="df-gen-section-label">区域/世界观</div>'
    + '<div class="df-gen-options" id="dfHomeArea">'
    + ['原著向','现代AU','校园AU','特殊设定'].map(function(a){
        var sel = dfState.area === a ? ' selected' : '';
        return '<span class="df-gen-option' + sel + '" data-home-area="' + a + '">' + a + '</span>';
      }).join('')
    + '</div>'
    + '</div>'

    /* persona edit */
    + personaEditHtml

    /* generate button */
    + '<button class="df-gen-bottom-btn" id="dfHomeGenBtn" type="button">&#10024; 生成同人文</button>';
};

/* Delete a trope by name — only custom tropes can be deleted, preset tropes are protected */
var dfDeleteTrope = function (name) {
  /* only custom tropes can be deleted */
  var cIdx = dfState.customTropes.findIndex(function (t) { return t && t.name === name; });
  if (cIdx !== -1) {
    dfState.customTropes.splice(cIdx, 1);
  } else {
    /* preset tropes cannot be deleted */
    forumToast('系统预设梗不可删除');
    return;
  }
  var selIdx = dfState.selectedTropes.indexOf(name);
  if (selIdx !== -1) dfState.selectedTropes.splice(selIdx, 1);
  dfSaveTropeData();
  dfRenderHomeHeader();
  if (dfState.currentView === 'dfGeneratePage') dfRenderGeneratePage();
  forumToast('已删除梗：' + name);
};
/* alias for backward compat */
var dfDeleteTropeByName = dfDeleteTrope;

var dfHomeManagePresets = function () {
  var allTropes = dfAllTropes();
  var itemsHtml = allTropes.map(function (t) {
    var delBtn = t.isCustom ? '<span class="df-mgr-trope-del" data-mgr-trope-del="' + escapeHtml(t.name) + '">&times;</span>' : '';
    return '<div class="df-mgr-trope-item">'
      + '<span class="df-mgr-trope-name">' + escapeHtml(t.name) + '</span>'
      + (t.isCustom ? '<span class="df-mgr-trope-tag">自定义</span>' : '<span class="df-mgr-trope-tag preset">预设</span>')
      + delBtn
      + '</div>';
  }).join('');
  var html = '<div class="df-modal-mask" id="dfTropeMgrMask">'
    + '<div class="df-modal-card df-trope-mgr-card">'
    + '<div class="df-modal-title">管理同人梗</div>'
    + '<div class="df-trope-mgr-list">' + (itemsHtml || '<div style="text-align:center;color:#999;padding:20px">暂无同人梗</div>') + '</div>'
    + '<div class="df-trope-mgr-actions">'
    + '<button class="df-trope-mgr-btn restore" id="dfTropeMgrRestore">恢复默认预设</button>'
    + '<button class="df-trope-mgr-btn close" id="dfTropeMgrClose">完成</button>'
    + '</div>'
    + '</div></div>';
  var old = forumEl('dfTropeMgrMask');
  if (old) old.remove();
  var overlay = forumEl('doujinForumOverlay');
  if (overlay) overlay.insertAdjacentHTML('beforeend', html);
  var mask = forumEl('dfTropeMgrMask');
  if (!mask) return;
  mask.addEventListener('click', function (e) {
    if (e.target === mask || e.target.closest('#dfTropeMgrClose')) {
      mask.remove();
      return;
    }
    var delBtn = e.target.closest('[data-mgr-trope-del]');
    if (delBtn) {
      var name = delBtn.dataset.mgrTropeDel;
      dfDeleteTrope(name);
      /* refresh modal list */
      var refreshed = dfAllTropes();
      var refreshHtml = refreshed.map(function (t) {
        return '<div class="df-mgr-trope-item">'
          + '<span class="df-mgr-trope-name">' + escapeHtml(t.name) + '</span>'
          + (t.isCustom ? '<span class="df-mgr-trope-tag">自定义</span>' : '<span class="df-mgr-trope-tag preset">预设</span>')
          + '<span class="df-mgr-trope-del" data-mgr-trope-del="' + escapeHtml(t.name) + '">&times;</span>'
          + '</div>';
      }).join('');
      var listEl = mask.querySelector('.df-trope-mgr-list');
      if (listEl) listEl.innerHTML = refreshHtml || '<div style="text-align:center;color:#999;padding:20px">暂无同人梗</div>';
      return;
    }
    if (e.target.closest('#dfTropeMgrRestore')) {
      if (!window.confirm('恢复默认梗预设？当前的自定义梗不会丢失。')) return;
      dfState.tropePresets = ['破镜重圆', '先婚后爱', '失忆梗', '替身恋人', '双向暗恋', '强制爱', '青梅竹马', '虐恋情深'];
      dfSaveTropeData();
      dfRenderHomeHeader();
      if (dfState.currentView === 'dfGeneratePage') dfRenderGeneratePage();
      forumToast('已恢复默认预设');
      /* refresh modal */
      mask.remove();
      dfHomeManagePresets();
    }
  });
};

/* ---- character picker (with persona community tabs) ---- */
var dfEnsureCharPicker = function () {
  if (forumEl('dfCharPicker')) return;
  var overlay = forumEl('doujinForumOverlay');
  if (!overlay) return;
  var picker = document.createElement('div');
  picker.id = 'dfCharPicker';
  overlay.appendChild(picker);
};

var dfRenderPickerContent = function () {
  var picker = forumEl('dfCharPicker');
  if (!picker || !picker.classList.contains('active')) return;
  var tab = dfState.pickerTab;
  var cur = dfSelectedChar();
  var contentHtml = '';

  if (tab === 'roles') {
    var roles = (typeof state !== 'undefined' && state && state.roles) ? state.roles : [];
    if (roles.length === 0) {
      contentHtml = '<div class="df-persona-empty">暂无角色，请先在聊天页创建角色</div>';
    } else {
      contentHtml = roles.map(function (r) {
        var sel = (cur.id && r.id === cur.id) ? ' selected' : '';
        var av = r.avatar
          ? '<img src="' + r.avatar + '" alt=""/>'
          : '<div class="ph">' + escapeHtml(forumInitial(r.name)) + '</div>';
        return '<div class="df-char-picker-item' + sel + '" data-char-id="' + escapeHtml(r.id || '') + '">'
          + av + '<div class="nm">' + escapeHtml(r.name || '未命名') + '</div></div>';
      }).join('');
    }
  } else if (tab === 'community') {
    var cl = dfState.communityPersonas || [];
    /* extract all unique tags for filter chips */
    var allTags = [];
    var tagSet = {};
    cl.forEach(function (p) {
      (p.tags || []).forEach(function (t) {
        if (!tagSet[t]) { tagSet[t] = true; allTags.push(t); }
      });
    });
    /* filter by search text and tag */
    var filtered = cl.filter(function (p) {
      var q = (dfState.communitySearch || '').toLowerCase();
      var matchSearch = !q
        || (p.name || '').toLowerCase().indexOf(q) !== -1
        || (p.description || '').toLowerCase().indexOf(q) !== -1
        || (p.tags || []).some(function (t) { return t.toLowerCase().indexOf(q) !== -1; });
      var matchTag = !dfState.communityTagFilter || (p.tags || []).indexOf(dfState.communityTagFilter) !== -1;
      return matchSearch && matchTag;
    });
    /* build tag filter chips */
    var tagFilterHtml = allTags.map(function (t) {
      var active = dfState.communityTagFilter === t ? ' active' : '';
      return '<span class="df-community-tag-chip' + active + '" data-community-tag="' + escapeHtml(t) + '">' + escapeHtml(t) + '</span>';
    }).join('');
    /* build search bar */
    var searchBarHtml = '<div class="df-community-search">'
      + '<input type="text" class="df-community-search-input" id="dfCommunitySearchInput" placeholder="搜索人设（名称/描述/标签）" value="' + escapeHtml(dfState.communitySearch || '') + '" />'
      + '</div>';
    /* build tag filter bar */
    var tagBarHtml = allTags.length > 0
      ? '<div class="df-community-tag-filter" id="dfCommunityTagFilter">' + tagFilterHtml + '</div>'
      : '';
    /* build persona list */
    var listHtml = '';
    if (filtered.length === 0) {
      listHtml = '<div class="df-persona-empty">' + (cl.length === 0 ? '社区暂无人设，快来发布第一个吧' : '没有匹配的人设') + '</div>';
    } else {
      listHtml = filtered.map(function (p) {
        var sel = (cur.id === ('persona-' + p.id)) ? ' selected' : '';
        var av = p.avatar
          ? '<img class="df-persona-card-avatar" src="' + p.avatar + '" alt=""/>'
          : '<div class="df-persona-card-avatar">' + escapeHtml(forumInitial(p.name)) + '</div>';
        var tagsHtml = (p.tags || []).map(function (t) {
          return '<span class="df-persona-card-tag">' + escapeHtml(t) + '</span>';
        }).join('');
        return '<div class="df-persona-card' + sel + '" data-persona-id="' + escapeHtml(p.id || '') + '">'
          + av
          + '<div class="df-persona-card-info">'
          + '<div class="df-persona-card-name">' + escapeHtml(p.name || '未命名') + '</div>'
          + '<div class="df-persona-card-desc">' + escapeHtml(p.description || '') + '</div>'
          + (tagsHtml ? '<div class="df-persona-card-tags">' + tagsHtml + '</div>' : '')
          + '</div></div>';
      }).join('');
    }
    contentHtml = searchBarHtml + tagBarHtml + listHtml;
  } else if (tab === 'mine') {
    contentHtml = '<button class="df-persona-create-btn" id="dfPersonaCreateBtn">+ 创建新人设</button>';
    var ml = dfState.myPersonas;
    if (!ml || ml.length === 0) {
      contentHtml += '<div class="df-persona-empty">还没有创建过人设</div>';
    } else {
      contentHtml += ml.map(function (p) {
        var sel = (cur.id === ('persona-' + p.id)) ? ' selected' : '';
        var av = p.avatar
          ? '<img class="df-persona-card-avatar" src="' + p.avatar + '" alt=""/>'
          : '<div class="df-persona-card-avatar">' + escapeHtml(forumInitial(p.name)) + '</div>';
        var tagsHtml = (p.tags || []).map(function (t) {
          return '<span class="df-persona-card-tag">' + escapeHtml(t) + '</span>';
        }).join('');
        var privateBadge = p.isPublic === false ? '<span class="df-persona-card-private">私密</span>' : '';
        return '<div class="df-persona-card' + sel + '" data-persona-id="' + escapeHtml(p.id || '') + '">'
          + av
          + '<div class="df-persona-card-info">'
          + '<div class="df-persona-card-name">' + escapeHtml(p.name || '未命名') + '</div>'
          + '<div class="df-persona-card-desc">' + escapeHtml(p.description || '') + '</div>'
          + (tagsHtml ? '<div class="df-persona-card-tags">' + tagsHtml + '</div>' : '')
          + '</div>'
          + privateBadge
          + '<span class="df-persona-card-edit" data-persona-edit="' + escapeHtml(p.id || '') + '" title="编辑">编辑</span>'
          + '<span class="df-persona-card-del" data-persona-del="' + escapeHtml(p.id || '') + '" title="删除">&times;</span>'
          + '</div>';
      }).join('');
    }
  }

  var tabHtml = '<div class="df-picker-tabs">'
    + '<div class="df-picker-tab' + (tab === 'roles' ? ' active' : '') + '" data-picker-tab="roles">我的角色</div>'
    + '<div class="df-picker-tab' + (tab === 'community' ? ' active' : '') + '" data-picker-tab="community">人设社区</div>'
    + '<div class="df-picker-tab' + (tab === 'mine' ? ' active' : '') + '" data-picker-tab="mine">我的人设</div>'
    + '</div>';

  picker.innerHTML = '<div class="df-char-picker-card">'
    + '<div class="df-char-picker-title">选择角色</div>'
    + tabHtml
    + contentHtml
    + '<button class="df-char-picker-close" id="dfCharPickerClose">关闭</button>'
    + '</div>';

  /* bind community search input */
  var searchInput = picker.querySelector('#dfCommunitySearchInput');
  if (searchInput) {
    searchInput.addEventListener('input', function () {
      dfState.communitySearch = this.value;
      dfRenderPickerContent();
    });
    /* restore cursor position after re-render */
    searchInput.focus();
    var len = searchInput.value.length;
    searchInput.setSelectionRange(len, len);
  }
};

var dfOpenCharPicker = function () {
  dfEnsureCharPicker();
  var picker = forumEl('dfCharPicker');
  if (!picker) return;
  picker.classList.add('active');
  dfRenderPickerContent();
  /* fetch personas in background */
  dfLoadPersonas();
};

var dfLoadPersonas = function () {
  if (typeof api === 'undefined') return;
  /* fetch public community personas */
  api.listPersonas('public').then(function (data) {
    dfState.communityPersonas = (data && data.list) || [];
    dfState.personasLoaded = true;
    if (dfState.pickerTab === 'community') dfRenderPickerContent();
    if (dfState.currentView === 'dfCommunityPage') dfRenderCommunityPage();
  }).catch(function () {});
  /* fetch my personas */
  api.listPersonas('mine').then(function (data) {
    dfState.myPersonas = (data && data.list) || [];
    if (dfState.pickerTab === 'mine') dfRenderPickerContent();
    if (dfState.currentView === 'dfCommunityPage') dfRenderCommunityPage();
  }).catch(function () {});
};

var dfSwitchPickerTab = function (tab) {
  dfState.pickerTab = tab;
  dfRenderPickerContent();
};

var dfCloseCharPicker = function () {
  var picker = forumEl('dfCharPicker');
  if (picker) picker.classList.remove('active');
};

var dfSelectCharacter = function (roleId) {
  var roles = (typeof state !== 'undefined' && state && state.roles) ? state.roles : [];
  var role = roles.find(function (r) { return r.id === roleId; });
  if (role) {
    dfState.selectedCharacter = { id: role.id, name: role.name, avatar: role.avatar || null, prompt: role.prompt || '' };
  }
  dfCloseCharPicker();
  dfRenderHomeHeader();
  if (dfState.currentView === 'dfGeneratePage') dfRenderGeneratePage();
  if (role) forumToast('已选择角色：' + role.name);
};

var dfSelectPersona = function (personaId) {
  var persona = null;
  var isMine = dfState.myPersonas.some(function (p) {
    if (p.id === personaId) { persona = p; return true; }
    return false;
  });
  if (!persona) {
    dfState.communityPersonas.some(function (p) {
      if (p.id === personaId) { persona = p; return true; }
      return false;
    });
  }
  if (persona) {
    dfState.selectedCharacter = {
      id: 'persona-' + persona.id,
      name: persona.name,
      avatar: persona.avatar || null,
      prompt: persona.prompt || persona.description || ''
    };
    dfCloseCharPicker();
    dfRenderHomeHeader();
    if (dfState.currentView === 'dfGeneratePage') dfRenderGeneratePage();
    forumToast('已选择人设：' + persona.name);
  }
};

var dfDeletePersonaById = function (personaId) {
  if (!window.confirm('确定删除这个人设？')) return;
  if (typeof api === 'undefined') return;
  api.deletePersona(personaId).then(function () {
    dfState.myPersonas = dfState.myPersonas.filter(function (p) { return p.id !== personaId; });
    dfRenderPickerContent();
    forumToast('人设已删除');
  }).catch(function (err) {
    forumToast('删除失败：' + (err.message || '未知错误'));
  });
};

/* ---- persona creation/editing modal ---- */
var dfOpenPersonaModal = function (editId) {
  var editPersona = null;
  if (editId) {
    editPersona = dfState.myPersonas.find(function (p) { return p.id === editId; });
  }
  var old = forumEl('dfPersonaModalMask');
  if (old) old.remove();
  var overlay = forumEl('doujinForumOverlay');
  if (!overlay) return;

  var p = editPersona || {};
  var avatarHtml = p.avatar
    ? '<img class="df-persona-avatar-preview" src="' + p.avatar + '" alt=""/>'
    : '<div class="df-persona-avatar-preview" id="dfPersonaAvatarPh">' + escapeHtml(forumInitial(p.name || '人')) + '</div>';

  var html = '<div class="df-modal-mask" id="dfPersonaModalMask">'
    + '<div class="df-modal-card" style="max-width:340px">'
    + '<div class="df-modal-title">' + (editPersona ? '编辑人设' : '创建人设') + '</div>'
    + '<div class="df-persona-modal-field">'
    + '<label>头像</label>'
    + '<div class="df-persona-avatar-upload">'
    + avatarHtml
    + '<button class="df-persona-avatar-btn" id="dfPersonaAvatarBtn">上传头像</button>'
    + '<input type="file" id="dfPersonaAvatarFile" accept="image/*" style="display:none"/>'
    + '</div>'
    + '</div>'
    + '<div class="df-persona-modal-field">'
    + '<label>人设名称</label>'
    + '<input type="text" id="dfPersonaName" class="df-input" placeholder="给这个人取个名字" value="' + escapeHtml(p.name || '') + '" />'
    + '</div>'
    + '<div class="df-persona-modal-field">'
    + '<label>简介（一句话描述）</label>'
    + '<input type="text" id="dfPersonaDesc" class="df-input" placeholder="如：温柔体贴的邻家学长" value="' + escapeHtml(p.description || '') + '" />'
    + '</div>'
    + '<div class="df-persona-modal-field">'
    + '<label>人设详情（性格、背景、说话风格等）</label>'
    + '<textarea id="dfPersonaPrompt" class="df-textarea" rows="4" placeholder="描述这个人的性格、背景、说话方式...">' + escapeHtml(p.prompt || '') + '</textarea>'
    + '</div>'
    + '<div class="df-persona-modal-field">'
    + '<label>标签（逗号分隔，最多8个）</label>'
    + '<input type="text" id="dfPersonaTags" class="df-input" placeholder="如：温柔, 学长, 治愈" value="' + escapeHtml((p.tags || []).join(', ')) + '" />'
    + '</div>'
    + '<div class="df-persona-modal-field">'
    + '<label>是否公开到社区</label>'
    + '<div class="df-persona-toggle">'
    + '<div class="df-persona-toggle-switch' + (p.isPublic !== false ? ' on' : '') + '" id="dfPersonaToggle"></div>'
    + '<span class="df-persona-toggle-label" id="dfPersonaToggleLabel">' + (p.isPublic !== false ? '公开（所有人可用）' : '私密（仅自己可用）') + '</span>'
    + '</div>'
    + '</div>'
    + '<div class="df-modal-actions">'
    + '<button class="df-modal-btn cancel" id="dfPersonaCancel">取消</button>'
    + '<button class="df-modal-btn save" id="dfPersonaSave">' + (editPersona ? '保存' : '创建') + '</button>'
    + '</div>'
    + '</div></div>';

  overlay.insertAdjacentHTML('beforeend', html);
  var mask = forumEl('dfPersonaModalMask');
  if (!mask) return;

  /* state for avatar and toggle */
  var avatarData = p.avatar || '';
  var isPublic = p.isPublic !== false;

  /* avatar upload */
  var fileInput = mask.querySelector('#dfPersonaAvatarFile');
  var avatarBtn = mask.querySelector('#dfPersonaAvatarBtn');
  if (avatarBtn && fileInput) {
    avatarBtn.addEventListener('click', function () { fileInput.click(); });
    fileInput.addEventListener('change', function (e) {
      var file = e.target.files[0];
      if (!file) return;
      var reader = new FileReader();
      reader.onload = function (ev) {
        avatarData = ev.target.result;
        var preview = mask.querySelector('.df-persona-avatar-preview');
        if (preview) {
          var img = document.createElement('img');
          img.className = 'df-persona-avatar-preview';
          img.src = avatarData;
          preview.replaceWith(img);
        }
      };
      reader.readAsDataURL(file);
    });
  }

  /* toggle */
  var toggle = mask.querySelector('#dfPersonaToggle');
  var toggleLabel = mask.querySelector('#dfPersonaToggleLabel');
  if (toggle) {
    toggle.addEventListener('click', function () {
      isPublic = !isPublic;
      toggle.classList.toggle('on', isPublic);
      if (toggleLabel) toggleLabel.textContent = isPublic ? '公开（所有人可用）' : '私密（仅自己可用）';
    });
  }

  /* close/cancel */
  mask.addEventListener('click', function (e) {
    if (e.target === mask || e.target.closest('#dfPersonaCancel')) {
      mask.remove();
      return;
    }
    /* save */
    if (e.target.closest('#dfPersonaSave')) {
      var name = (mask.querySelector('#dfPersonaName') || {}).value || '';
      var desc = (mask.querySelector('#dfPersonaDesc') || {}).value || '';
      var prompt = (mask.querySelector('#dfPersonaPrompt') || {}).value || '';
      var tagsStr = (mask.querySelector('#dfPersonaTags') || {}).value || '';
      if (!name.trim()) { forumToast('请填写人设名称'); return; }
      if (!desc.trim()) { forumToast('请填写简介'); return; }
      if (!prompt.trim()) { forumToast('请填写人设详情'); return; }
      var tags = tagsStr.split(/[,，]/).map(function (t) { return t.trim(); }).filter(function (t) { return t; }).slice(0, 8);
      var payload = { name: name.trim(), description: desc.trim(), prompt: prompt.trim(), tags: tags, avatar: avatarData, isPublic: isPublic };
      forumToast('正在保存...');
      if (editId && typeof api !== 'undefined') {
        api.updatePersona(editId, payload).then(function (saved) {
          /* update local list */
          var idx = dfState.myPersonas.findIndex(function (p) { return p.id === editId; });
          if (idx !== -1) dfState.myPersonas[idx] = saved;
          mask.remove();
          dfRenderPickerContent();
          forumToast('人设已更新');
        }).catch(function (err) { forumToast('保存失败：' + (err.message || '')); });
      } else if (typeof api !== 'undefined') {
        api.publishRole(payload).then(function (saved) {
          dfState.myPersonas.unshift(saved);
          if (isPublic) dfState.communityPersonas.unshift(saved);
          mask.remove();
          dfRenderPickerContent();
          forumToast('人设已创建');
        }).catch(function (err) { forumToast('创建失败：' + (err.message || '')); });
      }
    }
  });
};

/* ---- trope creation modal (popup-style, two inputs) ---- */
var dfEnsureTropeModal = function () {
  if (forumEl('dfTropeModal')) return;
  var overlay = forumEl('doujinForumOverlay');
  if (!overlay) return;
  var modal = document.createElement('div');
  modal.id = 'dfTropeModal';
  modal.className = 'df-modal-overlay';
  modal.innerHTML = '<div class="df-modal-card">'
    + '<div class="df-modal-title">创建新同人梗</div>'
    + '<div class="df-modal-field">'
    + '<label>同人梗名称 (例如：信息素错乱)</label>'
    + '<input type="text" id="dfTropeModalName" class="df-input" placeholder="信息素错乱" />'
    + '</div>'
    + '<div class="df-modal-field">'
    + '<label>同人梗的具体内容/设定</label>'
    + '<textarea id="dfTropeModalContent" class="df-textarea" rows="4" placeholder="同人梗的具体内容/设定..."></textarea>'
    + '</div>'
    + '<div class="df-modal-actions">'
    + '<button type="button" class="df-modal-btn cancel" id="dfTropeModalCancel">取消</button>'
    + '<button type="button" class="df-modal-btn save" id="dfTropeModalSave">保存</button>'
    + '</div>'
    + '</div>';
  overlay.appendChild(modal);
  modal.addEventListener('click', function (e) {
    if (e.target === modal) dfCloseTropeModal();
    if (e.target.closest('#dfTropeModalCancel')) dfCloseTropeModal();
    if (e.target.closest('#dfTropeModalSave')) dfSaveNewTrope();
  });
};

/* 首页人设编辑器 */
var dfOpenPersonaEditor = function () {
  var p = dfGetUserPersona();
  var curName = p.nickname || '体验用户';
  var curBio = p.bio || '';
  var newName = window.prompt('设置昵称', curName);
  if (newName === null) return;
  newName = String(newName).trim() || '体验用户';
  var newBio = window.prompt('设置人设描述（性格/背景/特征等）', curBio);
  if (newBio === null) return;
  newBio = String(newBio).trim();
  /* 保存到 state.user */
  try {
    if (typeof state !== 'undefined' && state.user) {
      state.user.nickname = newName;
      state.user.bio = newBio;
    }
  } catch (e) {}
  /* 同时保存到 localStorage 与社交论坛共享 */
  try {
    var saved = localStorage.getItem('sf_user_profile');
    var parsed = saved ? JSON.parse(saved) : {};
    parsed.displayName = newName;
    if (!parsed.avatar && p.avatar) parsed.avatar = p.avatar;
    localStorage.setItem('sf_user_profile', JSON.stringify(parsed));
  } catch (e) {}
  /* 更新服务端 */
  try {
    request('/profile', {
      method: 'POST',
      body: JSON.stringify({ nickname: newName, bio: newBio })
    });
  } catch (err) {}
  dfRenderHomeHeader();
  dfRenderNavAvatar();
  forumToast('人设已更新');
};

var dfOpenTropeModal = function () {
  dfEnsureTropeModal();
  var modal = forumEl('dfTropeModal');
  if (!modal) return;
  var nameInput = forumEl('dfTropeModalName');
  var contentInput = forumEl('dfTropeModalContent');
  if (nameInput) nameInput.value = '';
  if (contentInput) contentInput.value = '';
  modal.classList.add('active');
  if (nameInput) setTimeout(function () { nameInput.focus(); }, 50);
};

var dfCloseTropeModal = function () {
  var modal = forumEl('dfTropeModal');
  if (modal) modal.classList.remove('active');
};

var dfSaveNewTrope = function () {
  var nameInput = forumEl('dfTropeModalName');
  var contentInput = forumEl('dfTropeModalContent');
  var name = nameInput ? String(nameInput.value).trim() : '';
  var content = contentInput ? String(contentInput.value).trim() : '';
  if (!name) { forumToast('请输入同人梗名称'); return; }
  /* avoid duplicate names */
  var exists = dfState.tropePresets.indexOf(name) !== -1
    || dfState.customTropes.some(function (t) { return t && t.name === name; });
  if (!exists) {
    dfState.customTropes.push({ name: name, content: content });
    dfSaveTropeData();
  }
  if (dfState.selectedTropes.indexOf(name) === -1) dfState.selectedTropes.push(name);
  dfCloseTropeModal();
  dfRenderHomeHeader();
  if (dfState.currentView === 'dfGeneratePage') dfRenderGeneratePage();
  forumToast('已添加梗：' + name);
};

/* ---- ensure generate page exists (created dynamically, HTML has no slot) ---- */
var dfEnsureGeneratePage = function () {
  var pages = forumEl('dfPages');
  if (!pages) return;
  if (forumEl('dfGeneratePage')) return;
  var page = document.createElement('div');
  page.className = 'df-page';
  page.id = 'dfGeneratePage';
  page.innerHTML = '<div class="df-gen-back">'
    + '<button id="dfGenBack" type="button">&#8592;</button>'
    + '<span>生成同人文</span>'
    + '</div>'
    + '<div class="df-gen-content" id="dfGenerateContent"></div>';
  pages.appendChild(page);
};

var dfOpenGeneratePage = function () {
  dfEnsureGeneratePage();
  dfSwitchPage('dfGeneratePage');
};

/* ---- tag nav & page switching ---- */
var dfRenderTagNav = function () {
  var c = forumEl('dfTagNav');
  if (!c) return;
  var visibleTags = DF_TAGS.filter(function (t) {
    return t === '全部';
  });
  c.innerHTML = visibleTags.map(function (t) {
    return '<div class="df-tag-item' + (t === dfState.currentTag ? ' active' : '') + '" data-tag="'
      + escapeHtml(t) + '">' + escapeHtml(t) + '</div>';
  }).join('');
};

var dfSwitchTag = function (tag) {
  dfState.currentTag = tag;
  document.querySelectorAll('#dfTagNav .df-tag-item').forEach(function (t) {
    t.classList.toggle('active', t.dataset.tag === tag);
  });
  dfState.currentView = 'library';
  document.querySelectorAll('#dfPages .df-page').forEach(function (p) {
    p.classList.toggle('active', p.id === 'dfHomePage');
  });
  document.querySelectorAll('.df-bottom-nav .df-tab').forEach(function (t) {
    t.classList.toggle('active', t.dataset.dfPage === 'dfHomePage');
  });
  dfRenderWorksList();
};

/* ---- community page (persona community as standalone module) ---- */
var dfRenderCommunityPage = function () {
  var c = forumEl('dfCommunityContent');
  if (!c) return;

  var cl = dfState.communityPersonas || [];
  var myCl = dfState.myPersonas || [];

  /* extract all unique tags for filter chips */
  var allTags = [];
  var tagSet = {};
  cl.forEach(function (p) {
    (p.tags || []).forEach(function (t) {
      if (!tagSet[t]) { tagSet[t] = true; allTags.push(t); }
    });
  });
  myCl.forEach(function (p) {
    if (p.isPublic !== false) {
      (p.tags || []).forEach(function (t) {
        if (!tagSet[t]) { tagSet[t] = true; allTags.push(t); }
      });
    }
  });

  /* filter by search text and tag */
  var combined = cl.slice();
  myCl.forEach(function (p) {
    if (p.isPublic !== false && !combined.find(function (c) { return c.id === p.id; })) {
      combined.push(p);
    }
  });
  var filtered = combined.filter(function (p) {
    var q = (dfState.communitySearch || '').toLowerCase();
    var matchSearch = !q
      || (p.name || '').toLowerCase().indexOf(q) !== -1
      || (p.description || '').toLowerCase().indexOf(q) !== -1
      || (p.tags || []).some(function (t) { return t.toLowerCase().indexOf(q) !== -1; });
    var matchTag = !dfState.communityTagFilter || (p.tags || []).indexOf(dfState.communityTagFilter) !== -1;
    return matchSearch && matchTag;
  });

  /* build tag filter chips */
  var tagFilterHtml = allTags.map(function (t) {
    var active = dfState.communityTagFilter === t ? ' active' : '';
    return '<span class="df-community-tag-chip' + active + '" data-community-tag="' + escapeHtml(t) + '">' + escapeHtml(t) + '</span>';
  }).join('');

  /* build search bar */
  var searchBarHtml = '<div class="df-community-search">'
    + '<input type="text" class="df-community-search-input" id="dfCommunityPageSearch" placeholder="搜索人设（名称/描述/标签）" value="' + escapeHtml(dfState.communitySearch || '') + '" />'
    + '</div>';

  /* build tag filter bar */
  var tagBarHtml = allTags.length > 0
    ? '<div class="df-community-tag-filter" id="dfCommunityPageTagFilter">' + tagFilterHtml + '</div>'
    : '';

  /* build persona list */
  var listHtml = '';
  if (filtered.length === 0) {
    listHtml = '<div class="df-persona-empty" style="padding:40px 20px">'
      + '<div style="font-size:40px;margin-bottom:10px">👥</div>'
      + (combined.length === 0 ? '社区暂无人设<br>点击下方按钮发布第一个吧' : '没有匹配的人设')
      + '</div>';
  } else {
    listHtml = '<div class="df-community-grid">' + filtered.map(function (p) {
      var av = p.avatar
        ? '<img class="df-persona-card-avatar" src="' + p.avatar + '" alt=""/>'
        : '<div class="df-persona-card-avatar">' + escapeHtml(forumInitial(p.name)) + '</div>';
      var tagsHtml = (p.tags || []).map(function (t) {
        return '<span class="df-persona-card-tag">' + escapeHtml(t) + '</span>';
      }).join('');
      return '<div class="df-persona-card" data-persona-id="' + escapeHtml(p.id || '') + '">'
        + av
        + '<div class="df-persona-card-info">'
        + '<div class="df-persona-card-name">' + escapeHtml(p.name || '未命名') + '</div>'
        + '<div class="df-persona-card-desc">' + escapeHtml(p.description || '') + '</div>'
        + (tagsHtml ? '<div class="df-persona-card-tags">' + tagsHtml + '</div>' : '')
        + '</div>'
        + '<button class="df-persona-add-btn" data-persona-add="' + escapeHtml(p.id || '') + '">+ 添加</button>'
        + '</div>';
    }).join('') + '</div>';
  }

  /* my personas section */
  var myListHtml = '';
  if (myCl.length > 0) {
    myListHtml = '<div class="df-gen-section" style="margin-top:14px">'
      + '<div class="df-gen-section-label">我的人设</div>'
      + myCl.map(function (p) {
        var av = p.avatar
          ? '<img class="df-persona-card-avatar" src="' + p.avatar + '" alt=""/>'
          : '<div class="df-persona-card-avatar">' + escapeHtml(forumInitial(p.name)) + '</div>';
        var tagsHtml = (p.tags || []).map(function (t) {
          return '<span class="df-persona-card-tag">' + escapeHtml(t) + '</span>';
        }).join('');
        var privateBadge = p.isPublic === false ? '<span class="df-persona-card-private">私密</span>' : '<span class="df-persona-card-private" style="background:#e8f5e9;color:#2e7d32">公开</span>';
        return '<div class="df-persona-card">'
          + av
          + '<div class="df-persona-card-info">'
          + '<div class="df-persona-card-name">' + escapeHtml(p.name || '未命名') + '</div>'
          + '<div class="df-persona-card-desc">' + escapeHtml(p.description || '') + '</div>'
          + (tagsHtml ? '<div class="df-persona-card-tags">' + tagsHtml + '</div>' : '')
          + '</div>'
          + privateBadge
          + '<span class="df-persona-card-edit" data-persona-edit="' + escapeHtml(p.id || '') + '" title="编辑">编辑</span>'
          + '<span class="df-persona-card-del" data-persona-del="' + escapeHtml(p.id || '') + '" title="删除">&times;</span>'
          + '</div>';
      }).join('') + '</div>';
  }

  c.innerHTML = '<div style="padding:10px">'
    + searchBarHtml
    + tagBarHtml
    + listHtml
    + '<button class="df-gen-bottom-btn" id="dfCommunityCreateBtn" type="button" style="margin-top:14px">+ 创建新人设</button>'
    + myListHtml
    + '</div>';

  /* bind search input */
  var searchInput = c.querySelector('#dfCommunityPageSearch');
  if (searchInput) {
    searchInput.addEventListener('input', function () {
      dfState.communitySearch = this.value;
      dfRenderCommunityPage();
      var restored = c.querySelector('#dfCommunityPageSearch');
      if (restored) {
        restored.focus();
        var len = restored.value.length;
        restored.setSelectionRange(len, len);
      }
    });
  }

  /* bind tag filter */
  c.querySelectorAll('[data-community-tag]').forEach(function (chip) {
    chip.addEventListener('click', function () {
      var tag = this.dataset.communityTag;
      dfState.communityTagFilter = (dfState.communityTagFilter === tag) ? null : tag;
      dfRenderCommunityPage();
    });
  });

  /* bind create button */
  var createBtn = c.querySelector('#dfCommunityCreateBtn');
  if (createBtn) {
    createBtn.addEventListener('click', function () {
      dfOpenPersonaModal();
    });
  }

  /* bind persona edit/delete */
  c.querySelectorAll('[data-persona-edit]').forEach(function (btn) {
    btn.addEventListener('click', function (e) {
      e.stopPropagation();
      dfOpenPersonaModal(this.dataset.personaEdit);
    });
  });
  c.querySelectorAll('[data-persona-del]').forEach(function (btn) {
    btn.addEventListener('click', function (e) {
      e.stopPropagation();
      dfDeletePersonaById(this.dataset.personaDel);
    });
  });

  /* bind persona add (from community) */
  c.querySelectorAll('[data-persona-add]').forEach(function (btn) {
    btn.addEventListener('click', function (e) {
      e.stopPropagation();
      var pid = this.dataset.personaAdd;
      var persona = (dfState.communityPersonas || []).find(function (p) { return p.id === pid; });
      if (!persona) persona = (dfState.myPersonas || []).find(function (p) { return p.id === pid; });
      if (persona) {
        dfSelectPersona(pid);
        forumToast('已添加人设：' + persona.name);
      }
    });
  });

  /* bind persona card click (select) */
  c.querySelectorAll('[data-persona-id]').forEach(function (card) {
    card.addEventListener('click', function (e) {
      if (e.target.closest('button') || e.target.closest('[data-persona-edit]') || e.target.closest('[data-persona-del]') || e.target.closest('[data-persona-add]')) return;
      dfSelectPersona(this.dataset.personaId);
    });
  });

  /* load personas if not loaded */
  if (!dfState.personasLoaded) {
    dfLoadPersonas();
  }
};

var dfSwitchPage = function (pageId) {
  dfState.currentView = pageId;
  document.querySelectorAll('#dfPages .df-page').forEach(function (p) {
    p.classList.toggle('active', p.id === pageId);
  });
  document.querySelectorAll('.df-bottom-nav .df-tab').forEach(function (t) {
    t.classList.toggle('active', t.dataset.dfPage === pageId);
  });
  if (pageId === 'dfHomePage') {
    dfRenderWorksList();
  } else if (pageId === 'dfBookshelfPage') {
    dfRenderBookshelf();
  } else if (pageId === 'dfBookDetailPage') {
    dfRenderBookDetail();
  } else if (pageId === 'dfCommunityPage') {
    if (!dfState.personasLoaded) dfLoadPersonas();
    dfRenderCommunityPage();
  } else if (pageId === 'dfMyPage') {
    dfRenderProfile();
  } else if (pageId === 'dfGeneratePage') {
    dfRenderGeneratePage();
  }
};

/* ---- data loading ---- */
var dfLoadWorks = async function (tag) {
  dfState.loading = true;
  var content = forumEl('dfHomeContent');
  if (content && (!dfState.worksCache[tag] || dfState.worksCache[tag].length === 0)) {
    content.innerHTML = '<div class="df-loading">正在加载作品...</div>';
  }

  var role = dfState.role || (typeof activeRole === 'function' ? activeRole() : null);
  var apiTag = (tag === '全部') ? '' : tag;

  try {
    var result = await request('/forum/doujin/generate', {
      method: 'POST',
      body: JSON.stringify({
        tag: apiTag,
        roleName: role ? role.name : '',
        rolePrompt: role ? role.prompt : '',
        background: true
      })
    });

    /* 后台模式：服务器立即返回 taskId */
    if (result && result.background && result.taskId) {
      bgTaskState.pending[result.taskId] = { type: 'doujin-list' };
      bgPollTask(result.taskId, function (res) {
        bgNotifyDone('doujin-list', '生成同人文列表', res);
        dfState.loading = false;
        if (dfState.active && dfState.currentView === 'library' && dfState.currentTag === tag) {
          dfRenderWorks(dfGetDisplayWorks(tag), forumEl('dfHomeContent'));
        }
      }, function (err) {
        dfState.loading = false;
        dfState.worksCache[tag] = [];
        forumToast('生成失败：' + err);
        if (dfState.active && dfState.currentView === 'library' && dfState.currentTag === tag) {
          dfRenderWorks([], forumEl('dfHomeContent'));
        }
      });
      return;
    }

    /* 同步模式（兼容旧服务器） */
    if (result && result.error) {
      forumToast('AI生成失败：' + result.error);
    }
    var works = (result && result.works) ? result.works : [];
    /* no fallback: if AI returned nothing, show empty state */
    /* normalize works */
    works.forEach(function (w, i) {
      if (!w.coverGradient || !w.coverGradient.length) {
        w.coverGradient = FORUM_GRADIENTS[(i + (tag || '').length) % FORUM_GRADIENTS.length];
      }
      if (typeof w.avatarIndex !== 'number') w.avatarIndex = i % 8;
      if (typeof w.likes !== 'number') w.likes = 50 + Math.floor(Math.random() * 900);
      if (typeof w.collects !== 'number') w.collects = 20 + Math.floor(Math.random() * 400);
      if (typeof w.comments !== 'number') w.comments = 2 + Math.floor(Math.random() * 30);
    });
    dfState.worksCache[tag] = works;
    dfMergeAllWorks(works);
    dfSaveWorksCache();
  } catch (e) {
    var msg = (e && e.message) ? e.message : '';
    dfState.worksCache[tag] = [];
    if (msg.indexOf('豆子不足') !== -1 || msg.indexOf('403') !== -1) {
      forumToast('豆子不足，生成同人文需要5颗豆子');
    } else {
      forumToast('生成失败：' + (msg || '请稍后重试'));
    }
  }

  dfState.loading = false;
  if (dfState.active && dfState.currentView === 'library' && dfState.currentTag === tag) {
    dfRenderWorks(dfGetDisplayWorks(tag), forumEl('dfHomeContent'));
  }
};

/* ---- rendering: work card (waterfall) ---- */
var dfRenderWorkCard = function (work) {
  var grad = forumGradientCss(work.coverGradient);
  var tagsHtml = '';
  if (work.tags && work.tags.length) {
    tagsHtml = '<div class="df-work-tags">' + work.tags.map(function (t) {
      return '<span class="df-work-tag">' + escapeHtml(t) + '</span>';
    }).join('') + '</div>';
  }
  var avatarStyle = 'background:' + dfAvatarGradient(work.avatarIndex);
  var avatarText = escapeHtml(forumInitial(work.authorName));
  var collected = dfState.collectedWorks.some(function (w) { return w.id === work.id; });
  var collectIcon = collected ? '&#9733;' : '&#9734;';

  return '<div class="df-work-card" data-work-id="' + escapeHtml(work.id || '') + '">'
    + '<div class="df-work-cover" style="background:' + grad + '">'
    + '<span class="df-work-cover-title">' + escapeHtml(work.title || '无题') + '</span>'
    + '</div>'
    + '<div class="df-work-info">'
    + '<h3 class="df-work-title">' + escapeHtml(work.title || '无题') + '</h3>'
    + '<p class="df-work-excerpt">' + escapeHtml(work.excerpt || '') + '</p>'
    + '<div class="df-work-meta">'
    + '<span>' + escapeHtml(work.authorName || '匿名') + '</span>'
    + '<span>' + (work.tags || []).slice(0, 2).join('·') + '</span>'
    + '</div>'
    + '<div class="df-work-stats">'
    + '<span>&#10084;&#65039; ' + forumFormatNum(work.likes || 0) + '</span>'
    + '</div>'
    + '</div></div>';
};

var dfRenderWorks = function (works, container) {
  if (!container) return;
  if (dfState.loading && works.length === 0) {
    container.innerHTML = '<div class="df-loading">正在加载作品...</div>';
    return;
  }
  if (works.length === 0) {
    container.innerHTML = '<div style="text-align:center;padding:60px 20px;color:#999">'
      + '<div style="margin-bottom:20px;font-size:15px;color:#888">还没有作品哦~</div>'
      + '<button class="df-generate-btn" data-df-generate="' + (dfState.currentTag || '全部') + '">'
      + '✨ 生成新作品 <span class="cost">（消耗5豆子）</span></button>'
      + '</div>';
    return;
  }
  container.innerHTML = works.map(function (w) { return dfRenderWorkCard(w); }).join('')
    + '<div style="text-align:center;padding:10px 0 20px">'
    + '<button class="df-refresh-btn" data-df-refresh="' + (dfState.currentTag || '全部') + '">重新生成 ✨</button>'
    + '</div>';
};

/* Wrapper that renders works list with generate/refresh button based on cache state */
var dfRenderWorksList = function () {
  var tag = dfState.currentTag || '全部';
  var content = forumEl('dfHomeContent');
  if (!content) return;
  /* 生成中不重新渲染列表，保留加载指示器 */
  if (dfState._generating) return;
  var works = dfGetDisplayWorks(tag);
  if (works.length === 0) {
    content.innerHTML = '<div class="df-loading" style="padding:30px 20px;color:#bbb;font-size:13px">还没有作品，点击上方"生成同人文"开始创作吧~</div>';
    return;
  }
  dfRenderWorks(works, content);
};

var dfToggleLike = function (workId, actionEl) {
  var work = dfFindWork(workId);
  if (!work) return;
  work.liked = !work.liked;
  work.likes = (work.likes || 0) + (work.liked ? 1 : -1);
  if (actionEl) {
    actionEl.innerHTML = '&#10084;&#65039; ' + (work.likes || 0);
    actionEl.style.color = work.liked ? '#e74c3c' : '';
  }
};

var dfToggleCollect = function (workId, actionEl) {
  var work = dfFindWork(workId);
  if (!work) return;
  var idx = dfState.collectedWorks.findIndex(function (w) { return w.id === workId; });
  var bmIdx = dfState.bookmarks.findIndex(function (b) { return b.work && b.work.id === workId; });
  if (idx !== -1) {
    dfState.collectedWorks.splice(idx, 1);
    work.collected = false;
    if (bmIdx !== -1) dfState.bookmarks.splice(bmIdx, 1);
    dfSaveBookmarks();
    forumToast('已取消收藏');
  } else {
    var snapshot = {
      id: work.id, title: work.title, authorName: work.authorName,
      excerpt: work.excerpt, content: work.content, authorWords: work.authorWords,
      tags: (work.tags || []).slice(),
      avatarIndex: work.avatarIndex, coverGradient: work.coverGradient,
      likes: work.likes, collects: work.collects, comments: work.comments,
      collectedAt: Date.now()
    };
    dfState.collectedWorks.unshift(snapshot);
    /* create a bookmark with the first chapter = the work's original content */
    if (bmIdx === -1) {
      dfState.bookmarks.unshift({
        work: snapshot,
        chapters: [{
          title: '第一章：故事开端',
          content: work.content || work.excerpt || '',
          read: false
        }],
        currentChapter: 0
      });
      dfSaveBookmarks();
    }
    work.collected = true;
    forumToast('已加入书架');
  }
  if (actionEl) {
    actionEl.textContent = (work.collected ? '★ ' : '☆ ') + (work.collects || 0);
  }
};

/* ---- bookmark helpers ---- */
var dfFindBookmark = function (workId) {
  return dfState.bookmarks.find(function (b) { return b.work && b.work.id === workId; }) || null;
};

/* Convert a chapter index (1-based) to a Chinese chapter title prefix. */
var dfChapterTitlePrefix = function (n) {
  var cn = ['零', '一', '二', '三', '四', '五', '六', '七', '八', '九', '十'];
  if (n <= 10) return '第' + cn[n] + '章';
  if (n < 20) return '第十' + cn[n - 10] + '章';
  /* fall back to arabic numerals for larger numbers */
  return '第' + n + '章';
};

/* ---- work detail ---- */
var dfOpenWorkDetail = function (workId) {
  var work = dfFindWork(workId);
  if (!work) return;
  dfState.currentWork = work;
  dfState.currentWorkId = workId;

  var overlay = forumEl('dfDetailOverlay');
  if (overlay) overlay.classList.add('active');

  var body = forumEl('dfDetailBody');
  if (body) {
    var grad = forumGradientCss(work.coverGradient);
    var avatarIdx = typeof work.avatarIndex === 'number' ? work.avatarIndex : 0;
    var avatarSrc = forumGetAvatarSrc(avatarIdx);
    var tagsHtml = '';
    if (work.tags && work.tags.length) {
      tagsHtml = '<div class="df-detail-tags">' + work.tags.map(function (t) {
        return '<span class="df-work-tag">' + escapeHtml(t) + '</span>';
      }).join('') + '</div>';
    }
    var collected = dfState.collectedWorks.some(function (w) { return w.id === workId; });
    var collectIcon = collected ? '★ ' : '☆ ';

    body.innerHTML =
      '<div style="height:160px;border-radius:12px;overflow:hidden;margin-bottom:16px">'
      + '<div style="width:100%;height:100%;background:' + grad + '"></div></div>'
      + '<div class="df-detail-title">' + escapeHtml(work.title || '无题') + '</div>'
      + '<div class="df-detail-author">'
      + '<div class="df-detail-author-avatar" style="background-image:url(\'' + avatarSrc + '\');background-size:cover;background-position:center"></div>'
      + '<div class="df-detail-author-info">'
      + '<div class="df-detail-author-name">' + escapeHtml(work.authorName || '匿名') + '</div>'
      + '<div class="df-detail-author-time">' + escapeHtml(work.time || '原创作品') + '</div>'
      + '</div></div>'
      + '<div class="df-detail-content">' + escapeHtml(work.content || work.excerpt || '') + '</div>'
      + tagsHtml
      + (work.authorWords ? '<div class="df-detail-author-words"><b>作者有话说：</b><br>'
        + escapeHtml(work.authorWords) + '</div>' : '')
      + '<div style="display:flex;gap:20px;margin-top:16px;padding:12px 0;border-top:1px solid rgba(0,0,0,.06)">'
      + '<span class="df-detail-action" data-action="like" style="cursor:pointer;color:' + (work.liked ? '#e74c3c' : '#666') + ';font-size:14px;font-weight:600">&#10084;&#65039; ' + (work.likes || 0) + '</span>'
      + '<span class="df-detail-action" data-action="collect" style="cursor:pointer;color:' + (collected ? '#f39c12' : '#666') + ';font-size:14px;font-weight:600">' + collectIcon + (work.collects || 0) + '</span>'
      + '<span class="df-detail-action" data-action="share" style="cursor:pointer;color:#666;font-size:14px;font-weight:600">&#8599;&#65039; 分享</span>'
      + '</div>';
  }

  /* 评论不自动生成，用户需点击"生成评论"按钮（消耗1豆） */
  dfRenderComments(workId);
  if ((!dfState.commentsCache[workId] || dfState.commentsCache[workId].length === 0) && !work._commentsLoaded) {
    var cc = forumEl('dfComments');
    if (cc) cc.innerHTML = '<div style="padding:20px;text-align:center;color:#999;font-size:13px">还没有评论，点击下方按钮生成评论（消耗1豆）<br/><button id="dfGenCommentBtn" style="margin-top:10px;padding:8px 20px;border:1px solid #FF6B9D;border-radius:20px;background:transparent;color:#FF6B9D;font-size:13px;cursor:pointer">生成评论</button></div>';
    var genBtn = forumEl('dfGenCommentBtn');
    if (genBtn) genBtn.addEventListener('click', function() { dfGenerateComments(workId, work); });
  }
};

var dfCloseWorkDetail = function () {
  var d = forumEl('dfDetailOverlay');
  if (d) d.classList.remove('active');
  dfState.currentWork = null;
  dfState.currentWorkId = null;
  /* 关闭详情后重新渲染首页作品列表，恢复完整列表而非只显示上次生成的作品 */
  dfRenderWorksList();
};

/* ---- comments ---- */
var dfGenerateComments = async function (workId, work) {
  if (!work) return;
  work._commentsLoaded = true;
  var c = forumEl('dfComments');
  if (c) c.innerHTML = '<div class="df-loading" style="padding:20px">正在生成评论...（消耗1豆）</div>';
  try {
    var result = await request('/forum/doujin/comments', {
      method: 'POST',
      body: JSON.stringify({ workTitle: work.title, workAuthor: work.authorName, count: 4 })
    });
    var comments = (result && result.comments) ? result.comments : dfFallbackComments();
    dfState.commentsCache[workId] = comments;
    /* 刷新豆子显示 */
    if (typeof window.refreshServerUser === 'function') window.refreshServerUser();
  } catch (e) {
    dfState.commentsCache[workId] = dfFallbackComments();
    forumToast('评论生成失败：' + (e && e.message ? e.message : '请稍后重试'));
    if (typeof window.refreshServerUser === 'function') window.refreshServerUser();
  }
  if (dfState.currentWorkId === workId) dfRenderComments(workId);
};

var dfRenderComments = function (workId) {
  var c = forumEl('dfComments');
  if (!c) return;
  var comments = dfState.commentsCache[workId] || [];
  if (comments.length === 0) {
    c.innerHTML = '<div class="df-loading" style="padding:24px">还没有评论，快来抢沙发~</div>';
    return;
  }
  c.innerHTML = comments.map(function (cm) {
    var avatarStyle = 'background:' + dfAvatarGradient(cm.avatarIndex);
    return '<div class="df-comment">'
      + '<div class="df-comment-avatar" style="' + avatarStyle + '">' + escapeHtml(forumInitial(cm.authorName)) + '</div>'
      + '<div class="df-comment-body">'
      + '<div class="df-comment-name">' + escapeHtml(cm.authorName || '匿名') + '</div>'
      + '<div class="df-comment-text">' + escapeHtml(cm.content || '') + '</div>'
      + '</div></div>';
  }).join('');
};

var dfSendComment = function () {
  var input = forumEl('dfCommentInput');
  if (!input || !input.value.trim() || !dfState.currentWorkId) return;
  var text = input.value.trim();
  input.value = '';
  var comments = dfState.commentsCache[dfState.currentWorkId] || [];
  comments.push({
    id: 'dc-' + Date.now(),
    authorName: (dfState.role ? dfState.role.name : '我'),
    content: text,
    time: '刚刚',
    avatarIndex: 0
  });
  dfState.commentsCache[dfState.currentWorkId] = comments;
  if (dfState.currentWork) dfState.currentWork.comments = (dfState.currentWork.comments || 0) + 1;
  dfRenderComments(dfState.currentWorkId);
  forumToast('评论已发送');
};

/* ---- publish (manual) ---- */
var dfPublishWork = function () {
  var titleEl = forumEl('dfPublishTitle');
  var contentEl = forumEl('dfPublishContent');
  var authorWordsEl = forumEl('dfPublishAuthorWords');
  var tagsEl = forumEl('dfPublishTags');
  if (!titleEl || !titleEl.value.trim()) { forumToast('请输入标题'); return; }
  if (!contentEl || !contentEl.value.trim()) { forumToast('请输入作品内容'); return; }

  var title = titleEl.value.trim();
  var content = contentEl.value.trim();
  var authorWords = authorWordsEl ? authorWordsEl.value.trim() : '';
  var rawTags = tagsEl ? tagsEl.value.trim().split(/[\\s,，、]+/).filter(Boolean) : [];
  var tags = rawTags.length ? rawTags : ['原创'];

  var role = dfState.role || (typeof activeRole === 'function' ? activeRole() : null);
  var idx = dfState.userWorks.length;
  var work = {
    id: 'df-user-' + Date.now(),
    title: title,
    authorName: role ? role.name : '我',
    excerpt: content.substring(0, 80) + (content.length > 80 ? '...' : ''),
    content: content,
    authorWords: authorWords,
    tags: tags,
    likes: 0,
    collects: 0,
    comments: 0,
    avatarIndex: 0,
    coverGradient: FORUM_GRADIENTS[idx % FORUM_GRADIENTS.length],
    time: '刚刚',
    _user: true
  };
  dfState.userWorks.unshift(work);
  dfMergeAllWorks([work]);

  if (titleEl) titleEl.value = '';
  if (contentEl) contentEl.value = '';
  if (authorWordsEl) authorWordsEl.value = '';
  if (tagsEl) tagsEl.value = '';

  forumToast('作品发布成功！');
  dfSwitchPage('dfMyPage');
};

/* ---- generate page (pink healing-系) ---- */
var dfRenderGeneratePage = function () {
  dfEnsureGeneratePage();
  var c = forumEl('dfGenerateContent');
  if (!c) return;

  var ch = dfSelectedChar();
  /* 生成页面不显示头像图片，只显示名字 */
  var charAvatarHtml = '<div class="df-gen-char-avatar" style="background:linear-gradient(135deg,#FF6B9D,#FFB6C1)">'
    + escapeHtml(forumInitial(ch.name)) + '</div>';

  /* tag chips (multi-select with ✓). Preset tags (deletable) + custom tags (deletable) + add button */
  var presetTags = DF_TAGS.filter(function (t) { return t !== '全部'; });
  var presetTagChips = presetTags.map(function (t) {
    var selected = dfState.selectedTags.indexOf(t) !== -1 ? ' selected' : '';
    return '<span class="df-gen-tag-chip' + selected + '" data-gen-tag="' + escapeHtml(t) + '">' + escapeHtml(t) + '</span>';
  }).join('');
  var customTagChips = (dfState.customTags || []).map(function (t) {
    var selected = dfState.selectedTags.indexOf(t) !== -1 ? ' selected' : '';
    return '<span class="df-gen-tag-chip' + selected + '" data-gen-tag="' + escapeHtml(t) + '">' + escapeHtml(t)
      + '<span class="df-tag-delete" data-tag-del="' + escapeHtml(t) + '" title="删除">&times;</span></span>';
  }).join('');
  var tagChipsHtml = presetTagChips + customTagChips
    + '<button type="button" class="df-gen-tag-chip add" id="dfGenTagAdd" style="border:none;outline:none;-webkit-appearance:none;appearance:none" >+ 添加标签</button>';

  /* trope chips (multi-select with ✓, custom tropes deletable) + create button */
  var allTropes = dfAllTropes();
  var tropeChipsHtml = allTropes.map(function (t) {
    var selected = dfState.selectedTropes.indexOf(t.name) !== -1 ? ' selected' : '';
    var deleteBtn = t.isCustom ? '<span class="df-trope-delete" data-trope-del="' + escapeHtml(t.name) + '" title="删除">&times;</span>' : '';
    return '<span class="df-gen-trope-chip' + selected + '" data-trope="' + escapeHtml(t.name) + '">' + escapeHtml(t.name) + deleteBtn + '</span>';
  }).join('');
  tropeChipsHtml += '<button type="button" class="df-gen-trope-chip add" id="dfGenTropeAdd" style="border:none;outline:none;-webkit-appearance:none;appearance:none">+ 创建新同人梗</button>';

  /* word count options - adapted for 300-800 range */
  var wordOptions = [
    { value: '1000', label: '短打 800-1000字' },
    { value: '1200', label: '标准 1000-1500字' },
    { value: '1500', label: '长打 1200-1500字' }
  ];
  var wordCountHtml = wordOptions.map(function (opt) {
    var selected = dfState.wordCount === opt.value ? ' selected' : '';
    return '<span class="df-gen-option' + selected + '" data-word-count="' + opt.value + '">' + opt.label + '</span>';
  }).join('');

  var html = ''
    /* character × User persona pairing (click role to change) */
    + '<div class="df-gen-section">'
    + '<div class="df-gen-section-label">角色配对</div>'
    + '<div class="df-gen-pairing">'
    + '<div class="df-gen-char" id="dfGenCharRole">'
    + charAvatarHtml
    + '<span class="df-gen-char-name">' + escapeHtml(ch.name) + '</span>'
    + '</div>'
    + '<span class="df-gen-char-x">&times;</span>'
    + '<div class="df-gen-char" id="dfGenUserPersona">'
    + '<div class="df-gen-char-avatar" style="background:linear-gradient(135deg,#FF6B9D,#FFB6C1)">' + escapeHtml((dfGetUserPersona().nickname || 'U').charAt(0)) + '</div>'
    + '<span class="df-gen-char-name">' + escapeHtml(dfGetUserPersona().nickname || 'User') + '</span>'
    + '</div>'
    + '</div>'
    + (dfGetUserPersona().bio ? '<div style="font-size:0.75rem;color:#999;margin-top:6px;padding:0 4px">人设：' + escapeHtml(dfGetUserPersona().bio.slice(0, 60)) + (dfGetUserPersona().bio.length > 60 ? '...' : '') + '</div>' : '<div style="font-size:0.75rem;color:#ccc;margin-top:6px;padding:0 4px">未设置人设，点击主页"编辑个人资料"添加</div>')
    + '</div>'

    /* tags */
    + '<div class="df-gen-section">'
    + '<div class="df-gen-section-label">标签（点击选择）</div>'
    + '<div class="df-gen-tags" id="dfGenTags">' + tagChipsHtml + '</div>'
    + '</div>'

    /* tropes */
    + '<div class="df-gen-section">'
    + '<div class="df-gen-section-label">同人梗（点击选择）</div>'
    + '<div class="df-gen-tropes" id="dfGenTropes">' + tropeChipsHtml + '</div>'
    + '</div>'

    /* word count */
    + '<div class="df-gen-section">'
    + '<div class="df-gen-section-label">字数</div>'
    + '<div class="df-gen-options" id="dfGenWordCount">' + wordCountHtml + '</div>'
    + '</div>'

    /* custom request (要求) */
    + '<div class="df-gen-section">'
    + '<div class="df-gen-section-label">要求（选填）</div>'
    + '<textarea class="df-gen-request-input" id="dfGenRequestInput" rows="3" placeholder="描述你的创作要求，例如：希望是甜文，校园背景，两人第一次约会的场景...">' + escapeHtml(dfState.customRequest || '') + '</textarea>'
    + '</div>'

    /* area (区域/世界观) */
    + '<div class="df-gen-section">'
    + '<div class="df-gen-section-label">区域/世界观</div>'
    + '<div class="df-gen-options" id="dfGenArea">'
    + ['原著向','现代AU','校园AU','特殊设定'].map(function(a){
        var sel = dfState.area === a ? ' selected' : '';
        return '<span class="df-gen-option' + sel + '" data-area="' + a + '">' + a + '</span>';
      }).join('')
    + '</div>'
    + '</div>'

    /* bottom mascot */
    + '<div class="df-gen-mascot">'
    + forumMascotSvg(84)
    + '<div style="margin-top:6px">让灵感化作一段心动的故事吧~</div>'
    + '</div>'

    /* bottom pink generate button */
    + '<button class="df-gen-bottom-btn" id="dfGenBottomBtn" type="button">&#10024; 生成同人文</button>';

  c.innerHTML = html;

  /* bind generate page events */
  dfBindGeneratePageEvents(c);
};

var dfBindGeneratePageEvents = function (container) {
  if (!container) return;

  /* character role -> open picker */
  var charRole = forumEl('dfGenCharRole');
  if (charRole) charRole.addEventListener('click', dfOpenCharPicker);

  container.addEventListener('click', function (e) {
    /* tag delete — only custom tags can be deleted, preset tags cannot */
    var tagDel = e.target.closest('[data-tag-del]');
    if (tagDel) {
      var delTag = tagDel.dataset.tagDel;
      var ti = dfState.customTags.indexOf(delTag);
      if (ti !== -1) {
        dfState.customTags.splice(ti, 1);
        var sti = dfState.selectedTags.indexOf(delTag);
        if (sti !== -1) dfState.selectedTags.splice(sti, 1);
        dfSaveCustomTags();
        dfRenderGeneratePage();
      }
      return;
    }

    /* "+ 添加标签" button -> prompt for a new custom tag */
    if (e.target.closest('#dfGenTagAdd')) {
      dfShowTagInputModal(function(newTag) {
        newTag = String(newTag).trim();
        if (!newTag) return;
        if (dfState.customTags.indexOf(newTag) === -1 && DF_TAGS.indexOf(newTag) === -1) {
          dfState.customTags.push(newTag);
          dfSaveCustomTags();
        }
        if (dfState.selectedTags.indexOf(newTag) === -1) dfState.selectedTags.push(newTag);
        dfRenderGeneratePage();
      });
      return;
    }

    /* tag chips toggle (ignore delete & add buttons) */
    var tagChip = e.target.closest('[data-gen-tag]');
    if (tagChip) {
      var tag = tagChip.dataset.genTag;
      var idx = dfState.selectedTags.indexOf(tag);
      if (idx !== -1) {
        dfState.selectedTags.splice(idx, 1);
        tagChip.classList.remove('selected');
      } else {
        dfState.selectedTags.push(tag);
        tagChip.classList.add('selected');
      }
      return;
    }

    /* "+ 创建新同人梗" button -> open modal */
    if (e.target.closest('#dfGenTropeAdd')) {
      dfOpenTropeModal();
      return;
    }

    /* trope delete (custom only, by name) */
    var tropeDel = e.target.closest('[data-trope-del]');
    if (tropeDel) {
      dfDeleteTropeByName(tropeDel.dataset.tropeDel);
      return;
    }

    /* trope chips toggle */
    var tropeChip = e.target.closest('[data-trope]');
    if (tropeChip) {
      var trope = tropeChip.dataset.trope;
      var tIdx = dfState.selectedTropes.indexOf(trope);
      if (tIdx !== -1) {
        dfState.selectedTropes.splice(tIdx, 1);
        tropeChip.classList.remove('selected');
      } else {
        dfState.selectedTropes.push(trope);
        tropeChip.classList.add('selected');
      }
      /* keep home trope bar in sync */
      dfRenderHomeHeader();
      return;
    }

    /* area options */
    var areaOpt = e.target.closest('[data-area]');
    if (areaOpt) {
      dfState.area = areaOpt.dataset.area;
      container.querySelectorAll('[data-area]').forEach(function (el) {
        el.classList.toggle('selected', el.dataset.area === dfState.area);
      });
      return;
    }

    /* word count options */
    var wordOpt = e.target.closest('[data-word-count]');
    if (wordOpt) {
      dfState.wordCount = wordOpt.dataset.wordCount;
      container.querySelectorAll('[data-word-count]').forEach(function (el) {
        el.classList.toggle('selected', el.dataset.wordCount === dfState.wordCount);
      });
      return;
    }

    /* bottom generate button */
    if (e.target.closest('#dfGenBottomBtn')) {
      dfGenerateWork();
      return;
    }
  });

  /* customRequest textarea input binding */
  var reqInput = forumEl('dfGenRequestInput');
  if (reqInput) {
    reqInput.addEventListener('input', function () {
      dfState.customRequest = reqInput.value;
    });
  }
};

/* ---- generate work ---- */
var dfShowGenLoading = function (text) {
  /* 不创建全屏遮罩，加载状态已在列表区域显示 */
  var old = forumEl('dfGenLoading');
  if (old) old.remove();
};

var dfHideGenLoading = function () {
  var el = forumEl('dfGenLoading');
  if (el) el.remove();
};

var dfGenerateWork = async function () {
  var role = dfState.role || (typeof activeRole === 'function' ? activeRole() : null);
  dfState._generating = true;

  /* 兼容首页按钮(dfHomeGenBtn)和生成页按钮(dfGenBottomBtn) */
  var genBtn = forumEl('dfHomeGenBtn') || forumEl('dfGenBottomBtn');
  if (genBtn) {
    genBtn.textContent = '生成中...';
    genBtn.style.opacity = '0.6';
    genBtn.style.pointerEvents = 'none';
  }
  /* 清空旧内容，只显示加载状态（用户要求：生成时只显示加载中） */
  var listContainer = forumEl('dfHomeContent') || forumEl('dfGenerateContent') || forumEl('dfHomeList') || forumEl('dfGenList');
  if (listContainer) {
    listContainer.innerHTML = '<div id="dfGenLoadingCard" style="padding:60px 20px;text-align:center"><div style="width:40px;height:40px;border:3px solid #FFB6C1;border-top-color:#FF6B9D;border-radius:50%;animation:dfSpin .8s linear infinite;margin:0 auto 16px"></div><div style="color:#FF6B9D;font-size:15px;font-weight:700">正在生成同人文...</div><div style="color:#a87b8c;font-size:12px;margin-top:8px">AI正在创作中，请稍候</div></div>';
  }
  /* Force repaint on mobile */
  if (listContainer) { void listContainer.offsetHeight; }
  /* 不创建全屏遮罩，只在列表区域显示加载状态 */

  var userPersona = dfGetUserPersona();
  var selChar = dfState.selectedCharacter;
  var payload = {
    roleName: selChar ? selChar.name : (role ? role.name : ''),
    rolePrompt: selChar ? (selChar.prompt || '') : (role ? role.prompt : ''),
    tags: dfState.selectedTags.slice(),
    /* selected tropes passed to the generation API; custom tropes carry their content */
    tropes: dfState.selectedTropes.map(function (name) {
      var custom = dfState.customTropes.find(function (c) { return c && c.name === name; });
      return custom ? { name: custom.name, content: custom.content || '' } : name;
    }),
    wordCount: dfState.wordCount,
    characterName: selChar ? selChar.name : (role ? role.name : ''),
    userPersona: { nickname: userPersona.nickname || '体验用户', bio: userPersona.bio || '', avatar: userPersona.avatar || '', relations: userPersona.relations || '' },
    customRequest: (dfState.customRequest || '').trim(),
    area: dfState.area || '原著向',
    background: true
  };

  try {
    var result = await request('/forum/doujin/generate-work', {
      method: 'POST',
      body: JSON.stringify(payload)
    });

    /* 后台模式：服务器立即返回 taskId */
    if (result && result.background && result.taskId) {
      bgTaskState.pending[result.taskId] = { type: 'doujin-work' };
      forumToast('已提交后台生成，完成后会通知你');
      dfHideGenLoading();
      if (genBtn) {
        genBtn.innerHTML = '&#10024; 生成同人文';
        genBtn.style.opacity = '';
        genBtn.style.pointerEvents = '';
      }
      bgPollTask(result.taskId, function (res) {
        dfHideGenLoading();
        if (genBtn) {
          genBtn.innerHTML = '&#10024; 生成同人文';
          genBtn.style.opacity = '';
          genBtn.style.pointerEvents = '';
        }
        dfState._generating = false;
        /* 移除加载指示器 */
        var loadingCard = document.getElementById('dfGenLoadingCard');
        if (loadingCard) loadingCard.remove();
        if (typeof window.refreshServerUser === 'function') window.refreshServerUser();
        if (res && res.work) {
          var work = res.work;
          if (!work.coverGradient) work.coverGradient = FORUM_GRADIENTS[Math.floor(Math.random() * FORUM_GRADIENTS.length)];
          if (typeof work.avatarIndex !== 'number') work.avatarIndex = 0;
          if (typeof work.likes !== 'number') work.likes = 0;
          if (typeof work.collects !== 'number') work.collects = 0;
          if (typeof work.comments !== 'number') work.comments = 0;
          work._generated = true;
          /* 生成的作品放入书架(allWorks)，不放入发布作品(userWorks) */
          dfState.allWorks.unshift(work);
          dfMergeAllWorks([work]);
          dfSaveWorksCache();
          forumToast('同人文生成完成！已加入书架');
          /* 只显示新生成的作品，不恢复旧作品列表 */
          var _bgContent = forumEl('dfHomeContent');
          if (_bgContent) { _bgContent.innerHTML = ''; dfRenderWorks([work], _bgContent); }
          dfOpenWorkDetail(work.id);
        }
      }, function (err) {
        dfHideGenLoading();
        dfState._generating = false;
        var errLoadingCard = document.getElementById('dfGenLoadingCard');
        if (errLoadingCard) errLoadingCard.remove();
        if (genBtn) {
          genBtn.innerHTML = '&#10024; 生成同人文';
          genBtn.style.opacity = '';
          genBtn.style.pointerEvents = '';
        }
        forumToast('生成失败：' + err + ' 豆子已退还。');
      });
      return;
    }

    /* 同步模式（兼容旧服务器） */
    dfHideGenLoading();
    dfState._generating = false;
    var syncLoadingCard = document.getElementById('dfGenLoadingCard');
    if (syncLoadingCard) syncLoadingCard.remove();
    if (typeof window.refreshServerUser === 'function') window.refreshServerUser();
    if (result && result.work) {
      var work = result.work;
      if (!work.coverGradient) work.coverGradient = FORUM_GRADIENTS[Math.floor(Math.random() * FORUM_GRADIENTS.length)];
      if (typeof work.avatarIndex !== 'number') work.avatarIndex = 0;
      if (typeof work.likes !== 'number') work.likes = 0;
      if (typeof work.collects !== 'number') work.collects = 0;
      if (typeof work.comments !== 'number') work.comments = 0;
      work._generated = true;
      /* 生成的作品放入书架(allWorks)，不放入发布作品(userWorks) */
      dfState.allWorks.unshift(work);
      dfMergeAllWorks([work]);
      dfSaveWorksCache();
      forumToast('同人文生成成功！已加入书架');
      /* 只显示新生成的作品，不恢复旧作品列表 */
      var _syncContent = forumEl('dfHomeContent');
      if (_syncContent) { _syncContent.innerHTML = ''; dfRenderWorks([work], _syncContent); }
      dfOpenWorkDetail(work.id);
    } else {
      forumToast('生成失败，请稍后重试。豆子已退还。');
    }
  } catch (e) {
    dfHideGenLoading();
    dfState._generating = false;
    var catchLoadingCard = document.getElementById('dfGenLoadingCard');
    if (catchLoadingCard) catchLoadingCard.remove();
    forumToast('生成失败：' + (e && e.message ? e.message : '请稍后重试') + ' 豆子已退还。');
  }

  if (genBtn) {
    genBtn.innerHTML = '&#10024; 生成同人文';
    genBtn.style.opacity = '';
    genBtn.style.pointerEvents = '';
  }
};

/* ---- bookshelf ---- */
/* ---- global capture-phase click handlers (reliable event handling) ---- */
document.addEventListener('click', function(e) {
  /* tag add buttons - works on both home page and generate page */
  var tagBtn = e.target.closest('#dfHomeTagAdd, #dfGenTagAdd');
  if (tagBtn) {
    e.stopPropagation();
    e.preventDefault();
    dfShowTagInputModal(function(newTag) {
      newTag = String(newTag).trim();
      if (!newTag) return;
      if (dfState.customTags.indexOf(newTag) === -1 && DF_TAGS.indexOf(newTag) === -1) {
        dfState.customTags.push(newTag);
        dfSaveCustomTags();
      }
      if (dfState.selectedTags.indexOf(newTag) === -1) dfState.selectedTags.push(newTag);
      if (tagBtn.id === 'dfHomeTagAdd') dfRenderHomeHeader();
      else dfRenderGeneratePage();
    });
    return;
  }
  /* profile stat items (followers/following) */
  var statEl = e.target.closest('#sfStatFollowing, #sfStatFollowers');
  if (statEl) {
    e.stopPropagation();
    e.preventDefault();
    var _field = statEl.id === 'sfStatFollowing' ? 'following' : 'followers';
    sfEditStatNumber(_field);
    return;
  }
}, true);

var dfRenderBookshelf = function () {
  var c = forumEl('dfBookshelfContent');
  if (!c) return;
  if (dfState.bookmarks.length === 0) {
    c.innerHTML = '<div class="df-loading" style="padding:40px 20px">书架还是空的<br />去首页收藏喜欢的作品吧</div>';
    return;
  }
  var html = '<div class="df-bookshelf-grid">'
    + dfState.bookmarks.map(function (b, idx) {
        var w = b.work || {};
        /* 书架使用论坛头像作为封面图片 */
        var avatarIdx = typeof w.avatarIndex === 'number' ? w.avatarIndex : (idx % 8);
        var avatarSrc = forumGetAvatarSrc(avatarIdx);
        var chapterCount = (b.chapters || []).length;
        return '<div class="df-book-card" data-book-id="' + escapeHtml(w.id || '') + '">'
          + '<div class="df-book-cover" style="background-image:url(\'' + avatarSrc + '\');background-size:cover;background-position:center">'
          + '<span class="df-book-cover-title">' + escapeHtml(w.title || '无题') + '</span>'
          + (chapterCount > 1 ? '<span class="df-book-cover-chapters">' + chapterCount + '章</span>' : '')
          + '</div>'
          + '<div class="df-book-title">' + escapeHtml(w.title || '无题') + '</div>'
          + '<div class="df-book-author">' + escapeHtml(w.authorName || '匿名') + '</div>'
          + '</div>';
      }).join('')
    + '</div>';
  c.innerHTML = html;
};

/* ---- book detail page (bookshelf -> a collected work with chapters) ---- */
var dfEnsureBookDetailPage = function () {
  var pages = forumEl('dfPages');
  if (!pages) return;
  if (forumEl('dfBookDetailPage')) return;
  var page = document.createElement('div');
  page.className = 'df-page';
  page.id = 'dfBookDetailPage';
  page.innerHTML = '<div class="df-gen-back">'
    + '<button id="dfBookDetailBack" type="button">&#8592;</button>'
    + '<span>书籍详情</span>'
    + '</div>'
    + '<div class="df-book-detail-content" id="dfBookDetailContent"></div>';
  pages.appendChild(page);
};

var dfOpenBookDetail = function (workId) {
  var bm = dfFindBookmark(workId);
  if (!bm) { forumToast('未找到该书'); return; }
  dfState.currentBook = bm;
  dfEnsureBookDetailPage();
  /* if no chapter has been read yet, mark the first as the current chapter to read */
  if (bm.currentChapter == null) bm.currentChapter = 0;
  dfSwitchPage('dfBookDetailPage');
};

var dfRenderBookDetail = function () {
  var c = forumEl('dfBookDetailContent');
  if (!c) return;
  var bm = dfState.currentBook;
  if (!bm || !bm.work) {
    c.innerHTML = '<div class="df-loading" style="padding:40px 20px">未选择书籍</div>';
    return;
  }
  var w = bm.work;
  var avatarIdx = typeof w.avatarIndex === 'number' ? w.avatarIndex : 0;
  var avatarSrc = forumGetAvatarSrc(avatarIdx);
  var chapters = bm.chapters || [];
  var cur = (typeof bm.currentChapter === 'number') ? bm.currentChapter : 0;
  if (cur < 0) cur = 0;
  if (cur >= chapters.length) cur = chapters.length - 1;
  var activeChapter = chapters[cur];

  var chaptersHtml = chapters.map(function (ch, i) {
    var isActive = (i === cur) ? ' active' : '';
    var readTag = ch.read ? '<span class="df-chapter-read">已读</span>' : '';
    /* 第一章不可删除，其余章节可删除 */
    var delBtn = (i > 0) ? '<span class="df-chapter-delete" data-chapter-del="' + i + '" title="删除此章">&times;</span>' : '';
    return '<div class="df-chapter-item' + isActive + '" data-chapter-idx="' + i + '">'
      + '<span class="df-chapter-title">' + escapeHtml(ch.title || (dfChapterTitlePrefix(i + 1))) + '</span>'
      + readTag
      + delBtn
      + '</div>';
  }).join('');

  var contentHtml = activeChapter
    ? '<div class="df-book-detail-chapter-body">' + escapeHtml(activeChapter.content || '').replace(/\\n/g, '<br>') + '</div>'
    : '<div class="df-loading" style="padding:24px">暂无可读章节，点击"更新下一章"开始追更</div>';

  c.innerHTML = '<div class="df-book-detail-cover" style="background-image:url(\'' + avatarSrc + '\');background-size:cover;background-position:center">'
    + '<span class="df-book-cover-title">' + escapeHtml(w.title || '无题') + '</span>'
    + '</div>'
    + '<div class="df-book-detail-head">'
    + '<div class="df-book-detail-title">' + escapeHtml(w.title || '无题') + '</div>'
    + '<div class="df-book-detail-author">' + escapeHtml(w.authorName || '匿名') + '</div>'
    + '<span class="df-book-detail-collected">已收藏</span>'
    + '</div>'
    + '<button class="df-continue-btn" id="dfBookContinueBtn" type="button">&#128140; 催更</button>'
    + '<div class="df-book-detail-section">'
    + '<div class="df-book-detail-section-label">目录</div>'
    + '<div class="df-chapter-list" id="dfChapterList">' + chaptersHtml + '</div>'
    + '</div>'
    + '<div class="df-book-detail-section">'
    + '<div class="df-book-detail-section-label" id="dfReadingLabel">'
    + (activeChapter ? escapeHtml(activeChapter.title || dfChapterTitlePrefix(cur + 1)) : '阅读')
    + '</div>'
    + '<div id="dfChapterReading">' + contentHtml + '</div>'
    + '</div>'
    + '<button class="df-update-next-btn" id="dfUpdateNextBtn" type="button">&#10024; 更新下一章</button>';
};

/* Read a chapter: set as current + mark as read + re-render */
var dfReadChapter = function (chapterIdx) {
  var bm = dfState.currentBook;
  if (!bm) return;
  var chapters = bm.chapters || [];
  if (chapterIdx < 0 || chapterIdx >= chapters.length) return;
  bm.currentChapter = chapterIdx;
  chapters[chapterIdx].read = true;
  dfSaveBookmarks();
  dfRenderBookDetail();
};

/* Delete a chapter (except the first one) */
var dfDeleteChapter = function (chapterIdx) {
  var bm = dfState.currentBook;
  if (!bm) return;
  var chapters = bm.chapters || [];
  if (chapterIdx <= 0 || chapterIdx >= chapters.length) return;
  chapters.splice(chapterIdx, 1);
  /* adjust current chapter index */
  if (bm.currentChapter >= chapters.length) bm.currentChapter = chapters.length - 1;
  if (bm.currentChapter < 0) bm.currentChapter = 0;
  dfSaveBookmarks();
  dfRenderBookDetail();
  dfRenderBookshelf();
  forumToast('已删除第' + (chapterIdx + 1) + '章');
};

/* ---- 催更 (continue) modal ---- */
var dfEnsureContinueModal = function () {
  if (forumEl('dfContinueModal')) return;
  var overlay = forumEl('doujinForumOverlay');
  if (!overlay) return;
  var modal = document.createElement('div');
  modal.id = 'dfContinueModal';
  modal.className = 'df-modal-overlay';
  modal.innerHTML = '<div class="df-modal-card">'
    + '<div class="df-modal-title">催更</div>'
    + '<div class="df-modal-field">'
    + '<label>催更章节数：<b id="dfContinueCount">1</b> 章</label>'
    + '<input type="range" id="dfContinueSlider" min="1" max="10" step="1" value="1" class="df-slider" />'
    + '</div>'
    + '<div class="df-modal-field">'
    + '<label>指定剧情走向 (可选)</label>'
    + '<textarea id="dfContinuePlot" class="df-textarea" rows="3" placeholder=""></textarea>'
    + '</div>'
    + '<div class="df-continue-cost">需支付 <b id="dfContinueCost">5</b> 豆子（虚拟货币）</div>'
    + '<div class="df-continue-tip">请确认好再支付</div>'
    + '<div class="df-modal-actions">'
    + '<button type="button" class="df-modal-btn cancel" id="dfContinueCancel">取消</button>'
    + '<button type="button" class="df-modal-btn save" id="dfContinuePay">去支付</button>'
    + '</div>'
    + '</div>';
  overlay.appendChild(modal);
  modal.addEventListener('click', function (e) {
    if (e.target === modal) dfCloseContinueModal();
    if (e.target.closest('#dfContinueCancel')) dfCloseContinueModal();
    if (e.target.closest('#dfContinuePay')) dfSubmitContinue();
  });
  var slider = modal.querySelector('#dfContinueSlider');
  if (slider) {
    slider.addEventListener('input', function () {
      var n = parseInt(slider.value, 10) || 1;
      var cnt = modal.querySelector('#dfContinueCount');
      var cost = modal.querySelector('#dfContinueCost');
      if (cnt) cnt.textContent = n;
      if (cost) cost.textContent = n * 5;
    });
  }
};

var dfOpenContinueModal = function () {
  var bm = dfState.currentBook;
  if (!bm) { forumToast('请先选择一本书'); return; }
  dfEnsureContinueModal();
  var modal = forumEl('dfContinueModal');
  if (!modal) return;
  var slider = forumEl('dfContinueSlider');
  var plot = forumEl('dfContinuePlot');
  if (slider) slider.value = 1;
  if (plot) plot.value = '';
  var cnt = forumEl('dfContinueCount');
  var cost = forumEl('dfContinueCost');
  if (cnt) cnt.textContent = 1;
  if (cost) cost.textContent = 5;
  modal.classList.add('active');
};

var dfCloseContinueModal = function () {
  var modal = forumEl('dfContinueModal');
  if (modal) modal.classList.remove('active');
};

/* Charge beans — 已废弃，豆子由服务端统一扣减。
 * 保留函数签名以兼容旧调用点，但不再本地扣减。
 * 所有豆子消耗由后端API处理，前端通过 refreshServerUser() 同步。 */
var dfChargeBeans = function (cost) {
  /* 服务端会检查豆子余额并扣减，前端不再本地扣减 */
  return true;
};

var dfSubmitContinue = async function () {
  var bm = dfState.currentBook;
  if (!bm) { dfCloseContinueModal(); return; }
  var slider = forumEl('dfContinueSlider');
  var plotInput = forumEl('dfContinuePlot');
  var count = slider ? (parseInt(slider.value, 10) || 1) : 1;
  var plot = plotInput ? String(plotInput.value).trim() : '';

  /* 豆子由服务端扣减，不再使用本地 mock 扣减，避免刷新后豆子不一致 */
  dfCloseContinueModal();
  dfRenderBookDetailGenerating(count);

  var role = dfState.role || (typeof activeRole === 'function' ? activeRole() : null);
  var w = bm.work;
  var userPersona = (typeof dfGetUserPersona === 'function') ? dfGetUserPersona() : { nickname: '体验用户', bio: '' };
  var payload = {
    workId: w.id,
    title: w.title,
    authorName: w.authorName,
    roleName: role ? role.name : '',
    rolePrompt: role ? role.prompt : '',
    chapterCount: count,
    plotDirection: plot,
    userPersona: { nickname: userPersona.nickname || '体验用户', bio: userPersona.bio || '', avatar: userPersona.avatar || '', relations: userPersona.relations || '' },
    /* 后端期望 existingContent (字符串) 和 chapterNum */
    existingContent: (bm.chapters || []).map(function (ch) {
      return ch.title + '\\n' + ch.content;
    }).join('\\n---\\n'),
    chapterNum: (bm.chapters || []).length + 1,
    customRequest: plot
  };

  var newChapters = [];
  try {
    var result = await request('/forum/doujin/continue', {
      method: 'POST',
      body: JSON.stringify(payload)
    });
    if (result && result.chapters && result.chapters.length) {
      newChapters = result.chapters;
    } else if (result && result.chapter) {
      newChapters = [result.chapter];
    }
  } catch (e) {}

  /* fallback if API fails / returns nothing */
  if (newChapters.length === 0) {
    forumToast('生成失败，请稍后重试。豆子已退还。');
    if (typeof window.refreshServerUser === 'function') window.refreshServerUser();
    dfRenderBookDetail();
    return;
  }

  /* append generated chapters to the bookmark */
  newChapters.forEach(function (ch) {
    bm.chapters.push({
      title: ch.title || dfChapterTitlePrefix(bm.chapters.length + 1),
      content: ch.content || '',
      read: false
    });
  });
  /* auto-jump to the first newly generated chapter */
  if (newChapters.length) {
    bm.currentChapter = bm.chapters.length - newChapters.length;
    bm.chapters[bm.currentChapter].read = true;
  }
  dfSaveBookmarks();
  dfRenderBookDetail();
  dfRenderBookshelf();
  /* 刷新豆子显示，确保与服务端一致 */
  if (typeof window.refreshServerUser === 'function') window.refreshServerUser();
  forumToast('已生成 ' + newChapters.length + ' 章新内容');
};

/* transient "generating" view while the continue API runs */
var dfRenderBookDetailGenerating = function (count) {
  var c = forumEl('dfChapterReading');
  if (c) {
    c.innerHTML = '<div class="df-loading" style="padding:24px">正在生成 ' + count + ' 章新内容，请稍候...</div>';
  }
  var label = forumEl('dfReadingLabel');
  if (label) label.textContent = '生成中...';
};

/* ---- ranking ---- */
var dfGetRankingList = function (rank) {
  var pool = dfState.allWorks.slice();
  if (rank === 'heat') {
    pool.sort(function (a, b) { return (b.likes || 0) - (a.likes || 0); });
  } else if (rank === 'collect') {
    pool.sort(function (a, b) { return (b.collects || 0) - (a.collects || 0); });
  } else if (rank === 'new') {
    pool.sort(function (a, b) {
      if (a._user && !b._user) return -1;
      if (!a._user && b._user) return 1;
      return String(b.id || '').localeCompare(String(a.id || ''));
    });
  }
  return pool.slice(0, 20);
};

var dfRenderRanking = function (rank) {
  dfState.currentRank = rank;
  document.querySelectorAll('.df-ranking-tab').forEach(function (t) {
    t.classList.toggle('active', t.dataset.rank === rank);
  });
  var c = forumEl('dfRankingContent');
  if (!c) return;
  var list = dfGetRankingList(rank);
  if (list.length === 0) {
    c.innerHTML = '<div class="df-loading" style="padding:40px 20px">暂无排行数据</div>';
    return;
  }
  c.innerHTML = list.map(function (w, i) {
    var grad = forumGradientCss(w.coverGradient);
    var avatarStyle = 'background:' + dfAvatarGradient(w.avatarIndex);
    return '<div class="df-rank-item" data-work-id="' + escapeHtml(w.id || '') + '">'
      + '<div class="df-rank-num">' + (i + 1) + '</div>'
      + '<div style="width:48px;height:48px;border-radius:8px;overflow:hidden;flex-shrink:0">'
      + '<div style="width:100%;height:100%;background:' + grad + '"></div></div>'
      + '<div style="flex:1;min-width:0">'
      + '<div style="color:#333;font-size:14px;font-weight:700;white-space:nowrap;overflow:hidden;text-overflow:ellipsis">' + escapeHtml(w.title || '无题') + '</div>'
      + '<div style="display:flex;align-items:center;gap:6px;margin-top:4px">'
      + '<div class="df-work-author-avatar" style="' + avatarStyle + ';width:18px;height:18px;font-size:9px">' + escapeHtml(forumInitial(w.authorName)) + '</div>'
      + '<span style="color:#999;font-size:12px">' + escapeHtml(w.authorName || '匿名') + '</span>'
      + '</div>'
      + '<div style="color:#aaa;font-size:11px;margin-top:3px">'
      + (rank === 'collect' ? ('&#9733; ' + (w.collects || 0)) : ('&#10084;&#65039; ' + (w.likes || 0)))
      + ' &#128172; ' + (w.comments || 0) + '</div>'
      + '</div></div>';
  }).join('');
};

/* ---- profile ---- */
var dfRenderProfile = function () {
  var c = forumEl('dfProfile');
  if (!c) return;
  /* 1. 优先从全局 state.user 读取（App主页"我的"页面设置的用户昵称和人设，最新数据） */
  try {
    if (typeof state !== 'undefined' && state.user) {
      if (state.user.nickname && state.user.nickname !== '体验用户') {
        dfState.userDisplayName = state.user.nickname;
      }
      if (state.user.avatar) {
        dfState.userAvatarSrc = state.user.avatar;
      }
      if (state.user.bio) {
        dfState.userBio = state.user.bio;
      }
    }
  } catch (e) {}
  /* 2. 其次从 sf_user_profile 读取（与社交论坛共享的用户主页数据），仅补充 state.user 缺少的字段 */
  try {
    var saved = localStorage.getItem('sf_user_profile');
    if (saved) {
      var parsed = JSON.parse(saved);
      if (parsed.displayName && parsed.displayName !== '体验用户' && !dfState.userDisplayName) {
        dfState.userDisplayName = parsed.displayName;
      }
      if (parsed.avatar && !dfState.userAvatarSrc) {
        dfState.userAvatarSrc = parsed.avatar;
      }
      if (parsed.identityTag && !dfState.userIdentityTag) {
        dfState.userIdentityTag = parsed.identityTag;
      }
      if (parsed.bio && !dfState.userBio) {
        dfState.userBio = parsed.bio;
      }
    }
  } catch (e) {}
  var name = dfState.userDisplayName || '体验用户';
  var tag = dfState.userIdentityTag || '创作达人';
  var bio = dfState.userBio || '用文字记录每一个灵感瞬间。';

  /* 作品数和统计使用 userWorks（仅用户自己发布的作品），而非 allWorks（包含生成的作品） */
  var totalLikes = dfState.userWorks.reduce(function (s, w) { return s + (w.likes || 0); }, 0);
  var totalCollects = dfState.userWorks.reduce(function (s, w) { return s + (w.collects || 0); }, 0);

  var avatarInner;
  if (dfState.userAvatarSrc) {
    avatarInner = '<img style="width:60px;height:60px;border-radius:50%;object-fit:cover" src="' + dfState.userAvatarSrc + '" alt="" />';
  } else {
    avatarInner = '<div class="df-profile-avatar">' + escapeHtml(forumInitial(name)) + '</div>';
  }

  var html = '<div class="df-profile-header">'
    + avatarInner
    + '<div class="df-profile-info"><h3>' + escapeHtml(name) + '</h3><p>' + escapeHtml(tag) + '</p></div>'
    + '</div>'
    + '<div class="df-profile-stats">'
    + '<div class="df-profile-stat"><div class="num">' + dfState.userWorks.length + '</div><div class="label">作品</div></div>'
    + '<div class="df-profile-stat"><div class="num">' + dfState.collectedWorks.length + '</div><div class="label">收藏</div></div>'
    + '<div class="df-profile-stat"><div class="num">' + totalLikes + '</div><div class="label">获赞</div></div>'
    + '<div class="df-profile-stat"><div class="num">' + totalCollects + '</div><div class="label">被收藏</div></div>'
    + '</div>';

  /* "我的"页面只显示用户自己发布的作品(userWorks)，不显示生成的作品(allWorks) */
  if (dfState.userWorks.length === 0) {
    html += '<div class="df-loading" style="padding:40px 20px">还没有发布的作品<br />点击下方"发布"按钮发布你的第一篇作品</div>';
  } else {
    html += dfState.userWorks.map(function (w) { return dfRenderWorkCard(w); }).join('');
  }
  c.innerHTML = html;
  /* 同步更新左上角导航头像 */
  dfRenderNavAvatar();
};

/* ---- search (simple inline filter) ---- */
var dfToggleSearch = function () {
  if (dfState.searchVisible) {
    dfState.searchVisible = false;
    dfRenderWorks(dfGetDisplayWorks(dfState.currentTag), forumEl('dfHomeContent'));
    return;
  }
  dfState.searchVisible = true;
  var content = forumEl('dfHomeContent');
  if (!content) return;
  var inputHtml = '<div style="padding:0 0 10px"><input id="dfSearchBox" class="df-input" placeholder="搜索作品标题或作者..." style="margin-bottom:0" /></div><div id="dfSearchResults"></div>';
  content.innerHTML = inputHtml;
  var box = forumEl('dfSearchBox');
  if (box) {
    box.focus();
    box.addEventListener('input', function () {
      var kw = this.value.trim().toLowerCase();
      var c = forumEl('dfSearchResults');
      if (!c) return;
      if (!kw) { c.innerHTML = '<div class="df-loading" style="padding:20px">输入关键词搜索</div>'; return; }
      var results = dfState.allWorks.filter(function (w) {
        return (w.title || '').toLowerCase().indexOf(kw) !== -1 ||
               (w.authorName || '').toLowerCase().indexOf(kw) !== -1 ||
               (w.excerpt || '').toLowerCase().indexOf(kw) !== -1;
      });
      if (results.length === 0) {
        c.innerHTML = '<div class="df-loading" style="padding:20px">没有找到相关作品</div>';
      } else {
        c.innerHTML = results.map(function (w) { return dfRenderWorkCard(w); }).join('');
      }
    });
  }
};

/* ---- event binding (doujin) ---- */
var dfEventsBound = false;
var dfBindEvents = function () {
  if (dfEventsBound) return;

  /* tag nav */
  var tagNav = forumEl('dfTagNav');
  if (tagNav) tagNav.addEventListener('click', function (e) {
    var item = e.target.closest('[data-tag]');
    if (item) dfSwitchTag(item.dataset.tag);
  });

  /* bottom nav */
  document.querySelectorAll('.df-bottom-nav .df-tab').forEach(function (t) {
    t.addEventListener('click', function () { dfSwitchPage(this.dataset.dfPage); });
  });

  /* header buttons */
  var searchBtn = forumEl('dfSearchBtn');
  if (searchBtn) searchBtn.addEventListener('click', dfToggleSearch);
  var refreshBtn = forumEl('dfRefreshBtn');
  if (refreshBtn) refreshBtn.addEventListener('click', function () {
    /* 刷新时清空生成的作品，只保留发布的和收藏的 */
    dfState.worksCache = {};
    dfState.allWorks = [];
    dfMergeAllWorks(dfState.userWorks);
    dfMergeAllWorks(dfState.collectedWorks);
    /* 清除旧的生成作品缓存 */
    localStorage.removeItem('df_all_works');
    dfRenderWorksList();
    forumToast('已刷新，生成的作品已清空');
  });
  var closeBtn = forumEl('dfCloseBtn');
  if (closeBtn) closeBtn.addEventListener('click', closeDoujinForum);

  /* home content delegation -> open work detail */
  var homeContent = forumEl('dfHomeContent');
  if (homeContent) homeContent.addEventListener('click', function (e) {
    /* generate / refresh buttons */
    var genBtn = e.target.closest('[data-df-generate]');
    if (genBtn) {
      dfState.worksCache[genBtn.dataset.dfGenerate] = [];
      dfLoadWorks(genBtn.dataset.dfGenerate);
      return;
    }
    var refBtn = e.target.closest('[data-df-refresh]');
    if (refBtn) {
      dfState.worksCache[refBtn.dataset.dfRefresh] = [];
      dfLoadWorks(refBtn.dataset.dfRefresh);
      return;
    }
    var card = e.target.closest('[data-work-id]');
    if (card) dfOpenWorkDetail(card.dataset.workId);
  });

  /* bookshelf delegation -> open book detail (grid cards use data-book-id) */
  var bookshelfContent = forumEl('dfBookshelfContent');
  if (bookshelfContent) bookshelfContent.addEventListener('click', function (e) {
    var card = e.target.closest('[data-book-id]');
    if (card) dfOpenBookDetail(card.dataset.bookId);
  });

  /* profile delegation */
  var profileEl = forumEl('dfProfile');
  if (profileEl) profileEl.addEventListener('click', function (e) {
    var card = e.target.closest('[data-work-id]');
    if (card) dfOpenWorkDetail(card.dataset.workId);
  });

  /* ranking tabs */
  document.querySelectorAll('.df-ranking-tab').forEach(function (t) {
    t.addEventListener('click', function () { dfRenderRanking(this.dataset.rank); });
  });

  /* ranking content delegation */
  var rankContent = forumEl('dfRankingContent');
  if (rankContent) rankContent.addEventListener('click', function (e) {
    var item = e.target.closest('[data-work-id]');
    if (item) dfOpenWorkDetail(item.dataset.workId);
  });

  /* detail back */
  var detailBack = forumEl('dfDetailBack');
  if (detailBack) detailBack.addEventListener('click', dfCloseWorkDetail);

  /* detail body actions (like / collect / share) */
  var detailBody = forumEl('dfDetailBody');
  if (detailBody) detailBody.addEventListener('click', function (e) {
    var action = e.target.closest('[data-action]');
    if (!action || !dfState.currentWorkId) return;
    var act = action.dataset.action;
    if (act === 'like') {
      dfToggleLike(dfState.currentWorkId, action);
    } else if (act === 'collect') {
      dfToggleCollect(dfState.currentWorkId, action);
      if (dfState.currentView === 'dfBookshelfPage') dfRenderBookshelf();
    } else if (act === 'share') {
      forumToast('链接已复制到剪贴板');
    }
  });

  /* comments */
  var commentSend = forumEl('dfCommentSend');
  if (commentSend) commentSend.addEventListener('click', dfSendComment);
  var commentInput = forumEl('dfCommentInput');
  if (commentInput) commentInput.addEventListener('keydown', function (e) {
    if (e.key === 'Enter') dfSendComment();
  });

  /* publish */
  var publishBtn = forumEl('dfPublishSubmit');
  if (publishBtn) publishBtn.addEventListener('click', dfPublishWork);

  /* generate page back button (dynamically created -> delegate on document) */
  document.addEventListener('click', function (e) {
    if (e.target.closest('#dfGenBack')) {
      dfSwitchPage('dfHomePage');
      return;
    }
    /* character picker close */
    if (e.target.closest('#dfCharPickerClose')) {
      dfCloseCharPicker();
      return;
    }
    /* picker tab switching */
    var pickerTab = e.target.closest('[data-picker-tab]');
    if (pickerTab && forumEl('dfCharPicker') && forumEl('dfCharPicker').classList.contains('active')) {
      dfSwitchPickerTab(pickerTab.dataset.pickerTab);
      return;
    }
    /* community tag chip filter */
    var communityTagChip = e.target.closest('[data-community-tag]');
    if (communityTagChip && forumEl('dfCharPicker') && forumEl('dfCharPicker').classList.contains('active')) {
      var tag = communityTagChip.dataset.communityTag;
      dfState.communityTagFilter = (dfState.communityTagFilter === tag) ? null : tag;
      dfRenderPickerContent();
      return;
    }
    /* create persona button */
    if (e.target.closest('#dfPersonaCreateBtn')) {
      dfOpenPersonaModal();
      return;
    }
    /* persona delete */
    var personaDel = e.target.closest('[data-persona-del]');
    if (personaDel) {
      e.stopPropagation();
      dfDeletePersonaById(personaDel.dataset.personaDel);
      return;
    }
    /* persona edit */
    var personaEdit = e.target.closest('[data-persona-edit]');
    if (personaEdit) {
      e.stopPropagation();
      dfOpenPersonaModal(personaEdit.dataset.personaEdit);
      return;
    }
    /* persona selection */
    var personaItem = e.target.closest('[data-persona-id]');
    if (personaItem && forumEl('dfCharPicker') && forumEl('dfCharPicker').classList.contains('active')) {
      dfSelectPersona(personaItem.dataset.personaId);
      return;
    }
    /* character picker item selection */
    var charItem = e.target.closest('[data-char-id]');
    if (charItem && forumEl('dfCharPicker') && forumEl('dfCharPicker').classList.contains('active')) {
      dfSelectCharacter(charItem.dataset.charId);
      return;
    }
    /* book detail back -> back to bookshelf */
    if (e.target.closest('#dfBookDetailBack')) {
      dfSwitchPage('dfBookshelfPage');
      return;
    }
    /* book detail: 催更 button + 更新下一章 button both open the continue modal */
    if (e.target.closest('#dfBookContinueBtn') || e.target.closest('#dfUpdateNextBtn')) {
      dfOpenContinueModal();
      return;
    }
    /* book detail: delete a chapter (except first) */
    var chapterDel = e.target.closest('[data-chapter-del]');
    if (chapterDel) {
      var delIdx = parseInt(chapterDel.dataset.chapterDel, 10);
      if (delIdx > 0) dfDeleteChapter(delIdx);
      return;
    }
    /* book detail: click a chapter to read it */
    var chapterItem = e.target.closest('[data-chapter-idx]');
    if (chapterItem) {
      dfReadChapter(parseInt(chapterItem.dataset.chapterIdx, 10));
      return;
    }
  });

  dfEventsBound = true;
};


/* ======================================================================
 *  INITIALIZATION
 * ==================================================================== */

var forumInitDone = false;
var forumInit = function () {
  if (forumInitDone) return;
  forumInjectPinkStyles();
  sfBindEvents();
  dfBindEvents();
  forumInitDone = true;
};

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', forumInit);
} else {
  forumInit();
}
