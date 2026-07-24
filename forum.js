/* === Forum System (Xiaohongshu style) === */
/* This file is loaded after the main script, so it can access: state, activeRole(), getMessages(), escapeHtml(), $(), toast() */

var FORUM_AVATAR_KEYS = [
  '/avatars/avatar1.png', '/avatars/avatar2.png', '/avatars/avatar3.png', '/avatars/avatar4.png',
  '/avatars/avatar5.png', '/avatars/avatar6.png', '/avatars/avatar7.png', '/avatars/avatar8.png'
];

var forumGetAvatarSrc = function(index) {
  var key = FORUM_AVATAR_KEYS[index % FORUM_AVATAR_KEYS.length];
  if (typeof FORUM_AVATAR_BASE64 === 'object' && FORUM_AVATAR_BASE64[key]) {
    return FORUM_AVATAR_BASE64[key];
  }
  return key;
};

var FORUM_GRADIENTS = [
  ['#ffcadb', '#7466ff'], ['#a8edea', '#fed6e3'], ['#fbc2eb', '#a18cd1'],
  ['#fad0c4', '#ffd1ff'], ['#a1c4fd', '#c2e9fb'], ['#f093fb', '#f5576c'],
  ['#4facfe', '#00f2fe'], ['#43e97b', '#38f9d7'], ['#fa709a', '#fee140'],
  ['#30cfd0', '#330867'], ['#a8edea', '#84fab0'], ['#ff9a9e', '#fecfef']
];

var forumCurrentTab = 'following';
var forumPostsCache = { following: [], recommended: [], gossip: [] };
var forumCommentsCache = {};
var forumLoading = { following: false, recommended: false, gossip: false };
var forumUserRole = null;
var forumCurrentPostId = null;
var forumWorldRole = null;

/* === World selector === */
var populateWorldSelect = function() {
  var sel = document.getElementById('forumWorldSelect');
  if (!sel) return;
  sel.innerHTML = '<option value="">全部世界</option>';
  var roles = (typeof state !== 'undefined' && state.roles) ? state.roles : [];
  var communityRoles = (typeof communityRoles !== 'undefined') ? communityRoles : [];
  var allRoles = roles.concat(communityRoles);
  var seen = {};
  allRoles.forEach(function(r) {
    if (r && r.name && !seen[r.name]) {
      seen[r.name] = true;
      var opt = document.createElement('option');
      opt.value = r.name;
      opt.textContent = r.name + ' 的世界';
      sel.appendChild(opt);
    }
  });
};

var onWorldSelectChange = function() {
  var sel = document.getElementById('forumWorldSelect');
  if (!sel) return;
  var name = sel.value;
  if (!name) {
    forumWorldRole = null;
  } else {
    var roles = (typeof state !== 'undefined' && state.roles) ? state.roles : [];
    var communityRoles = (typeof communityRoles !== 'undefined') ? communityRoles : [];
    var found = roles.concat(communityRoles).find(function(r) { return r.name === name; });
    forumWorldRole = found ? { name: found.name, prompt: found.prompt || '' } : { name: name, prompt: '' };
  }
  forumPostsCache = { following: [], recommended: [], gossip: [] };
  if (forumView === 'feed') {
    loadForumTab(forumCurrentTab);
  } else {
    loadForumTab('recommended');
  }
};

/* === Open / Close === */
var forumView = 'home'; /* 'home' or 'feed' */

var showForumHome = function() {
  forumView = 'home';
  var home = document.getElementById('forumHomePage');
  var feed = document.getElementById('forumFeedWrap');
  if (home) home.classList.remove('hidden');
  if (feed) feed.classList.add('hidden');
  var fab = document.getElementById('forumFab');
  if (fab) fab.style.display = 'none';
  renderForumHomeHot();
};

var enterForumFeed = function(tab) {
  forumView = 'feed';
  var home = document.getElementById('forumHomePage');
  var feed = document.getElementById('forumFeedWrap');
  if (home) home.classList.add('hidden');
  if (feed) feed.classList.remove('hidden');
  var fab = document.getElementById('forumFab');
  if (fab) fab.style.display = 'grid';
  if (tab) forumCurrentTab = tab;
  document.querySelectorAll('.forum-tab-item').forEach(function(t) {
    t.classList.toggle('active', t.dataset.forumTab === forumCurrentTab);
  });
  forumPostsCache = { following: [], recommended: [], gossip: [] };
  loadForumTab(forumCurrentTab);
};

var renderForumHomeHot = function() {
  var container = document.getElementById('forumHotList');
  if (!container) return;
  /* Gather hot posts from all cached tabs */
  var allPosts = [];
  for (var tab in forumPostsCache) {
    forumPostsCache[tab].forEach(function(p) { allPosts.push(p); });
  }
  /* Sort by likes, take top 5 */
  allPosts.sort(function(a, b) { return (b.likes || 0) - (a.likes || 0); });
  var hot = allPosts.slice(0, 5);
  if (hot.length === 0) {
    container.innerHTML = '<div class="forum-hot-item"><span class="forum-hot-rank r1">1</span><div class="forum-hot-text"><h5>暂无热议</h5><p>进入广场查看更多内容</p></div><span class="forum-hot-likes">♥ 0</span></div>';
    return;
  }
  container.innerHTML = hot.map(function(post, idx) {
    var rankClass = 'r' + (idx + 1);
    var preview = String(post.content || '').substring(0, 40);
    var author = post.authorName || '匿名';
    var likes = post.likes || 0;
    return '<div class="forum-hot-item" data-post-id="' + escapeHtml(post.id || '') + '">'
      + '<span class="forum-hot-rank ' + rankClass + '">' + (idx + 1) + '</span>'
      + '<div class="forum-hot-text"><h5>' + escapeHtml(preview) + '</h5><p>@' + escapeHtml(author) + '</p></div>'
      + '<span class="forum-hot-likes">♥ ' + likes + '</span>'
      + '</div>';
  }).join('');
};

var openForumPage = function() {
  forumUserRole = (typeof activeRole === 'function') ? activeRole() : null;
  forumCurrentTab = 'following';
  forumPostsCache = { following: [], recommended: [], gossip: [] };
  populateWorldSelect();
  showForumHome();
  /* Preload hot posts in background */
  loadForumTab('recommended');
};

var openForumOverlay = function(role) {
  forumUserRole = role || null;
  var forumNavBtn = document.querySelector('.bottom-nav [data-page="forumPage"]');
  if (forumNavBtn) {
    forumNavBtn.click();
  }
  forumCurrentTab = 'following';
  forumPostsCache = { following: [], recommended: [], gossip: [] };
  populateWorldSelect();
  showForumHome();
  loadForumTab('recommended');
};

var closeForumOverlay = function() {
  closeForumDetail();
  closeForumPostModal();
};

/* === Tab switching === */
var switchForumTab = function(tab) {
  forumCurrentTab = tab;
  document.querySelectorAll('.forum-tab-item').forEach(function(t) {
    t.classList.toggle('active', t.dataset.forumTab === tab);
  });
  if (forumPostsCache[tab].length === 0 && !forumLoading[tab]) {
    loadForumTab(tab);
  } else {
    renderForumPosts(tab);
  }
};

/* === Load posts from API === */
var loadForumTab = async function(tab) {
  forumLoading[tab] = true;
  var list = document.getElementById('forumPostList');
  if (list) list.innerHTML = '<div class="forum-loading">正在加载...</div>';

  try {
    var role = forumUserRole || (typeof activeRole === 'function' ? activeRole() : null);
    var messages = [];
    if (role && typeof getMessages === 'function') {
      messages = getMessages(role.id).slice(-10).map(function(m) {
        return { role: m.role, content: m.content };
      });
    }

    var memList = [];
    try {
      var memUrl = '/api/memories' + (role && role.id ? '?roleId=' + encodeURIComponent(role.id) : '');
      var memResp = await fetch(memUrl, { headers: { 'X-User-Id': (state.userId || 'demo-user') } });
      var memData = await memResp.json();
      if (memData && memData.data && memData.data.list) {
        memList = memData.data.list.slice(0, 8);
      }
    } catch (e) {}

    var resp = await fetch('/api/forum/generate', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-User-Id': (state.userId || 'demo-user') },
      body: JSON.stringify({
        tab: tab,
        roleName: (role ? role.name : ''),
        rolePrompt: (role ? role.prompt : ''),
        recentMessages: messages,
        memories: memList,
        worldRole: forumWorldRole || null
      })
    });
    var data = await resp.json();
    if (data && data.data && data.data.posts) {
      forumPostsCache[tab] = data.data.posts;
      data.data.posts.forEach(function(p) {
        if (!forumCommentsCache[p.id]) forumCommentsCache[p.id] = p.commentsList || [];
      });
    }
  } catch (error) {
    console.warn('Forum load error:', error);
  }

  forumLoading[tab] = false;
  if (tab === forumCurrentTab && forumView === 'feed') renderForumPosts(tab);
  /* Always refresh homepage hot list when new posts arrive */
  if (forumView === 'home') renderForumHomeHot();
};

/* === Render posts (Xiaohongshu double-column grid) === */
var renderForumPosts = function(tab) {
  var list = document.getElementById('forumPostList');
  if (!list) return;
  var posts = forumPostsCache[tab] || [];
  if (posts.length === 0) {
    list.innerHTML = '<div class="forum-empty">暂无内容，点击右上角刷新试试</div>';
    return;
  }

  list.innerHTML = posts.map(function(post, idx) {
    var avatarSrc = forumGetAvatarSrc(post.avatarIndex);
    var grad = FORUM_GRADIENTS[idx % FORUM_GRADIENTS.length];
    var handle = '@' + String(post.authorName || 'anon').replace(/\s+/g, '').substring(0, 10).toLowerCase();
    var previewText = String(post.content || '').substring(0, 80);
    var tabLabels = { following: '关注', recommended: '推荐', gossip: '八卦' };
    var tag = tabLabels[tab] || '推荐';
    var likes = post.likes || Math.floor(Math.random() * 200) + 10;

    return '<div class="forum-xhs-card" data-post-id="' + escapeHtml(post.id || '') + '" style="--c1:' + grad[0] + ';--c2:' + grad[1] + '">'
      + '<div class="forum-xhs-cover">'
      + '<span class="forum-xhs-tag">' + escapeHtml(tag) + '</span>'
      + '<div class="forum-xhs-cover-text">' + escapeHtml(previewText) + '</div>'
      + '</div>'
      + '<div class="forum-xhs-footer">'
      + '<div class="forum-xhs-author">'
      + '<img class="forum-xhs-avatar" src="' + avatarSrc + '" alt="">'
      + '<span class="forum-xhs-name">' + escapeHtml(post.authorName || '匿名') + '</span>'
      + '<span class="forum-xhs-likes">♥ ' + likes + '</span>'
      + '</div>'
      + '</div>'
      + '</div>';
  }).join('');
};

/* === Post detail === */
var openPostDetail = function(postId) {
  var post = null;
  for (var tab in forumPostsCache) {
    var found = forumPostsCache[tab].find(function(p) { return p.id === postId; });
    if (found) { post = found; break; }
  }
  if (!post) return;

  forumCurrentPostId = postId;
  var detail = document.getElementById('forumPostDetail');
  if (!detail) return;
  detail.classList.add('active');

  var avatarSrc = forumGetAvatarSrc(post.avatarIndex);
  var content = document.getElementById('forumDetailContent');
  if (content) {
    content.innerHTML = '<div class="forum-detail-post">'
      + '<div class="forum-detail-author">'
      + '<img class="forum-detail-avatar" src="' + avatarSrc + '" alt="">'
      + '<div>'
      + '<div class="forum-detail-name">' + escapeHtml(post.authorName || '匿名') + '</div>'
      + '<div class="forum-detail-time">' + escapeHtml(post.time || '刚刚') + '</div>'
      + '</div>'
      + '</div>'
      + '<div class="forum-detail-text">' + escapeHtml(post.content || '') + '</div>'
      + '<div class="forum-detail-actions">'
      + '<span class="forum-detail-action' + (post.liked ? ' liked' : '') + '" data-action="like">♥ ' + (post.likes || 0) + '</span>'
      + '<span class="forum-detail-action" data-action="comment">💬 ' + (forumCommentsCache[postId] || []).length + '</span>'
      + '<span class="forum-detail-action" data-action="share">↗ 分享</span>'
      + '</div>'
      + '</div>';
  }

  renderForumComments(postId);
  /* Auto-generate comments if none exist */
  if ((!forumCommentsCache[postId] || forumCommentsCache[postId].length === 0) && !post._commentsLoaded) {
    generateForumComments(postId, post);
  }
};

var generateForumComments = async function(postId, post) {
  if (!post) return;
  post._commentsLoaded = true;
  var container = document.getElementById('forumDetailComments');
  if (container) container.innerHTML = '<h4>评论</h4><div class="forum-loading">正在生成评论...</div>';
  try {
    var resp = await fetch('/api/forum/comments', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-User-Id': (state.userId || 'demo-user') },
      body: JSON.stringify({ postContent: post.content, postAuthor: post.authorName, count: 3 })
    });
    var data = await resp.json();
    if (data && data.data && data.data.comments) {
      forumCommentsCache[postId] = data.data.comments;
      if (forumCurrentPostId === postId) renderForumComments(postId);
      /* Update comment count in actions bar */
      var commentAction = document.querySelector('[data-action="comment"]');
      if (commentAction) commentAction.textContent = '💬 ' + data.data.comments.length;
    }
  } catch (e) {
    console.warn('Comment generation error:', e);
  }
};

var closeForumDetail = function() {
  var detail = document.getElementById('forumPostDetail');
  if (detail) detail.classList.remove('active');
  forumCurrentPostId = null;
};

var renderForumComments = function(postId) {
  var container = document.getElementById('forumDetailComments');
  if (!container) return;
  var comments = forumCommentsCache[postId] || [];
  var html = '<h4>评论 ' + comments.length + '</h4>';
  if (comments.length === 0) {
    html += '<div style="text-align:center;padding:20px;color:#999;font-size:.85rem">还没有评论，快来抢沙发吧~</div>';
  } else {
    html += comments.map(function(c) {
      var avatarSrc = forumGetAvatarSrc(c.avatarIndex);
      return '<div class="forum-comment-item">'
        + '<img class="forum-comment-avatar" src="' + avatarSrc + '" alt="">'
        + '<div class="forum-comment-body">'
        + '<div class="forum-comment-author">' + escapeHtml(c.authorName || '匿名') + '</div>'
        + '<div class="forum-comment-text">' + escapeHtml(c.content || '') + '</div>'
        + '<div class="forum-comment-time">' + escapeHtml(c.time || '刚刚') + '</div>'
        + '</div>'
        + '</div>';
    }).join('');
  }
  container.innerHTML = html;
};

var sendForumComment = function() {
  var input = document.getElementById('forumCommentInput');
  if (!input || !input.value.trim() || !forumCurrentPostId) return;
  var text = input.value.trim();
  input.value = '';
  var comments = forumCommentsCache[forumCurrentPostId] || [];
  comments.push({
    id: 'c' + Date.now(),
    authorName: '我',
    content: text,
    time: '刚刚',
    avatarIndex: Math.floor(Math.random() * 8)
  });
  forumCommentsCache[forumCurrentPostId] = comments;
  renderForumComments(forumCurrentPostId);
  if (typeof toast === 'function') toast('评论已发送');
};

/* === Post creation modal === */
var openForumPostModal = function() {
  var modal = document.getElementById('forumPostModal');
  if (modal) modal.classList.add('active');
};

var closeForumPostModal = function() {
  var modal = document.getElementById('forumPostModal');
  if (modal) modal.classList.remove('active');
  var input = document.getElementById('forumPostInput');
  if (input) input.value = '';
};

var publishForumPost = function() {
  var input = document.getElementById('forumPostInput');
  if (!input || !input.value.trim()) {
    if (typeof toast === 'function') toast('请输入内容');
    return;
  }
  var text = input.value.trim();
  var role = forumUserRole || (typeof activeRole === 'function' ? activeRole() : null);
  var tabLabels = { following: '关注', recommended: '推荐', gossip: '八卦' };

  var newPost = {
    id: 'p' + Date.now(),
    authorName: (role ? role.name : '我'),
    content: text,
    time: '刚刚',
    likes: 0,
    avatarIndex: Math.floor(Math.random() * 8),
    commentsList: []
  };

  if (!forumPostsCache[forumCurrentTab]) forumPostsCache[forumCurrentTab] = [];
  forumPostsCache[forumCurrentTab].unshift(newPost);
  closeForumPostModal();
  renderForumPosts(forumCurrentTab);
  if (typeof toast === 'function') toast('发布成功');
};

/* === Bind forum events === */
var bindForumEvents = function() {
  /* Tab switching */
  document.querySelectorAll('.forum-tab-item').forEach(function(tab) {
    tab.addEventListener('click', function() {
      switchForumTab(this.dataset.forumTab);
    });
  });

  /* Forum homepage: enter feed buttons */
  var enterFeedBtns = ['forumEnterBtn', 'forumEnterFeed', 'forumHotMore'];
  enterFeedBtns.forEach(function(id) {
    var btn = document.getElementById(id);
    if (btn) btn.addEventListener('click', function() { enterForumFeed('following'); });
  });

  /* Forum homepage: board cards */
  document.querySelectorAll('.forum-board-card').forEach(function(card) {
    card.addEventListener('click', function() {
      var board = this.dataset.board;
      var tabMap = { tide: 'following', deep: 'recommended', dark: 'gossip', wave: 'recommended', evening: 'recommended' };
      enterForumFeed(tabMap[board] || 'recommended');
    });
  });

  /* Forum homepage: hot post click */
  var hotList = document.getElementById('forumHotList');
  if (hotList) hotList.addEventListener('click', function(e) {
    var item = e.target.closest('[data-post-id]');
    if (item && item.dataset.postId) openPostDetail(item.dataset.postId);
  });

  /* World selector */
  var worldSel = document.getElementById('forumWorldSelect');
  if (worldSel) worldSel.addEventListener('change', onWorldSelectChange);

  /* Refresh */
  var refreshBtn = document.getElementById('forumRefreshBtn');
  if (refreshBtn) refreshBtn.addEventListener('click', function() {
    forumPostsCache[forumCurrentTab] = [];
    loadForumTab(forumCurrentTab);
  });

  /* FAB - create post */
  var fab = document.getElementById('forumFab');
  if (fab) fab.addEventListener('click', openForumPostModal);

  /* Post list - click to open detail (event delegation) */
  var postList = document.getElementById('forumPostList');
  if (postList) postList.addEventListener('click', function(e) {
    var card = e.target.closest('[data-post-id]');
    if (card && card.dataset.postId) openPostDetail(card.dataset.postId);
  });

  /* Post detail close */
  var detailClose = document.getElementById('forumDetailCloseBtn');
  if (detailClose) detailClose.addEventListener('click', closeForumDetail);

  /* Comment send */
  var commentSend = document.getElementById('forumCommentSend');
  if (commentSend) commentSend.addEventListener('click', sendForumComment);

  var commentInput = document.getElementById('forumCommentInput');
  if (commentInput) commentInput.addEventListener('keydown', function(e) {
    if (e.key === 'Enter') sendForumComment();
  });

  /* Post modal */
  var postCancel = document.getElementById('forumPostCancel');
  if (postCancel) postCancel.addEventListener('click', closeForumPostModal);

  var postPublish = document.getElementById('forumPostPublish');
  if (postPublish) postPublish.addEventListener('click', publishForumPost);

  /* Close modal on background click */
  var postModal = document.getElementById('forumPostModal');
  if (postModal) postModal.addEventListener('click', function(e) {
    if (e.target === this) closeForumPostModal();
  });

  /* Like action in detail */
  var detailContent = document.getElementById('forumDetailContent');
  if (detailContent) detailContent.addEventListener('click', function(e) {
    var action = e.target.closest('[data-action]');
    if (!action) return;
    if (action.dataset.action === 'like' && forumCurrentPostId) {
      for (var tab in forumPostsCache) {
        var post = forumPostsCache[tab].find(function(p) { return p.id === forumCurrentPostId; });
        if (post) {
          post.liked = !post.liked;
          post.likes = (post.likes || 0) + (post.liked ? 1 : -1);
          action.classList.toggle('liked', post.liked);
          action.textContent = '♥ ' + post.likes;
          break;
        }
      }
    }
  });
};

/* Auto-bind events when DOM is ready */
if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', bindForumEvents);
} else {
  bindForumEvents();
}
