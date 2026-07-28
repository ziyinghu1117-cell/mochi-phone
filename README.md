<!DOCTYPE html>
<html lang="zh-CN">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0, maximum-scale=1.0, user-scalable=no">
  <title>Mochi-Phone · 温柔陪伴 · 文游世界</title>
  <link rel="stylesheet" href="css/style.css">
  <link rel="icon" href="data:image/svg+xml,<svg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 100 100'><text y='.9em' font-size='90'>🍡</text></svg>">
</head>
<body>
  <!-- ====== 手机外壳（桌面端居中显示，移动端全屏） ====== -->
  <div id="phone-frame">
    <!-- 状态栏 -->
    <div id="status-bar">
      <span class="sb-time">9:41</span>
      <div class="sb-notch"></div>
      <div class="sb-right">
        <span class="sb-signal">●●●●</span>
        <span class="sb-wifi">▽</span>
        <span class="sb-battery">▮</span>
      </div>
    </div>

    <!-- 页面容器 -->
    <div id="page-container"></div>

    <!-- 底部导航 -->
    <div id="bottom-nav">
      <div class="nav-item" data-page="chat">
        <span class="nav-icon">💬</span>
        <span class="nav-label">聊天</span>
      </div>
      <div class="nav-item" data-page="character">
        <span class="nav-icon">🎭</span>
        <span class="nav-label">角色</span>
      </div>
      <div class="nav-item" data-page="home">
        <span class="nav-icon">📱</span>
        <span class="nav-label">手机</span>
      </div>
      <div class="nav-item" data-page="wenyu">
        <span class="nav-icon">📖</span>
        <span class="nav-label">文游</span>
      </div>
      <div class="nav-item" data-page="memory">
        <span class="nav-icon">✨</span>
        <span class="nav-label">记忆</span>
      </div>
      <div class="nav-item" data-page="profile">
        <span class="nav-icon">👤</span>
        <span class="nav-label">我的</span>
      </div>
    </div>

    <!-- Home indicator -->
    <div id="home-indicator"></div>
  </div>

  <!-- 全局 Toast -->
  <div id="toast-container"></div>

  <!-- 全局 Modal -->
  <div id="modal-overlay">
    <div id="modal-box">
      <div id="modal-content"></div>
    </div>
  </div>

  <!-- 全局 Loading -->
  <div id="loading-overlay">
    <div class="loading-mascot">🍡</div>
    <div class="loading-text">正在生成中…</div>
  </div>

  <!-- ====== JS（按顺序加载） ====== -->
  <script src="js/config.js"></script>
  <script src="js/store.js"></script>
  <script src="js/api.js"></script>
  <script src="js/worldbook.js"></script>
  <script src="js/data.js"></script>
  <script src="js/pages.js"></script>
  <script src="js/app.js"></script>
</body>
</html>
