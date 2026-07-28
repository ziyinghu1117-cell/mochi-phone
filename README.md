<!DOCTYPE html>
<html lang="zh-CN">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0, maximum-scale=1.0, user-scalable=no, viewport-fit=cover">
  <title>Mochi Phone - AI沉浸式陪伴</title>
  <link rel="stylesheet" href="css/app.css">
</head>
<body>
  <div id="app">
    <!-- Toast 提示 -->
    <div class="toast" id="toast"></div>

    <!-- ==================== 聊天页面 ==================== -->
    <div class="page active" id="page-chat">
      <div class="app-header">
        <div class="title">Mochi<span class="sparkle">✦</span></div>
        <div class="header-right">
          <div class="bean-count">🫘 <span id="bean-count">30</span> &gt;</div>
        </div>
      </div>
      <div class="scroll-view">
        <div class="chat-list" id="chat-list">
          <!-- 动态生成 -->
        </div>
      </div>
    </div>

    <!-- ==================== 角色页面 ==================== -->
    <div class="page" id="page-chara">
      <div class="app-header">
        <div class="title">角色<span class="sparkle">✦</span></div>
        <div class="header-right">
          <div class="bean-count">🫘 <span class="bean-count-val">30</span> &gt;</div>
        </div>
      </div>
      <div class="scroll-view">
        <div class="chara-grid" id="chara-grid">
          <!-- 动态生成 -->
        </div>
      </div>
    </div>

    <!-- ==================== 手机页面 ==================== -->
    <div class="page" id="page-phone">
      <div class="app-header">
        <div class="title">mochi-phone</div>
        <div class="header-right">
          <div class="bean-count">🫘 <span class="bean-count-val">30</span> &gt;</div>
        </div>
      </div>
      <div class="scroll-view">
        <div class="phone-home">
          <div class="phone-banner">
            <div class="time" id="phone-time">14:52</div>
            <div class="date" id="phone-date">7月24日 周五</div>
            <div class="companion">
              <img src="https://api.dicebear.com/7.x/avataaars/svg?seed=companion" alt="">
              <div class="text">
                温柔陪伴师
                <small>今天也要开心哦~ 💕</small>
              </div>
            </div>
            <div class="mochi">🍡</div>
          </div>

          <div class="phone-section-title">✨ 联系人 / 关系 / 回忆</div>
          <div style="display:flex;justify-content:space-between;align-items:center;padding:0 8px;margin-bottom:16px;">
            <span style="font-size:13px;color:var(--text-light);">已沉淀回忆</span>
            <span style="font-size:28px;color:var(--primary);font-weight:300;">2<span style="font-size:14px;">条</span></span>
          </div>

          <div class="phone-apps">
            <div class="phone-app" onclick="app.showToast('社交功能开发中')">
              <div class="icon" style="background:linear-gradient(135deg,#A8D8FF,#6BB6FF);">❌</div>
              <div class="label">社交</div>
            </div>
            <div class="phone-app" onclick="app.switchTab('tongren')">
              <div class="icon" style="background:linear-gradient(135deg,#B5F0C8,#7EDAA8);">✏️</div>
              <div class="label">同人</div>
            </div>
            <div class="phone-app" onclick="app.showToast('世界书功能开发中')">
              <div class="icon" style="background:linear-gradient(135deg,#D4C4FF,#A890FF);">🌐</div>
              <div class="label">世界书</div>
            </div>
            <div class="phone-app" onclick="app.showToast('纪念日功能开发中')">
              <div class="icon" style="background:linear-gradient(135deg,#FFB8D0,#FF85A2);">💖</div>
              <div class="label">纪念日</div>
            </div>
          </div>

          <div class="phone-section-title">📱 功能应用</div>
          <div class="phone-apps">
            <div class="phone-app" onclick="app.openSubPage('contacts')">
              <div class="icon" style="background:linear-gradient(135deg,#FFE4A0,#FFC860);">👤</div>
              <div class="label">通讯录</div>
            </div>
            <div class="phone-app" onclick="app.openSubPage('social')">
              <div class="icon" style="background:linear-gradient(135deg,#A8D8FF,#6BB6FF);">💬</div>
              <div class="label">社交</div>
            </div>
            <div class="phone-app" onclick="app.openSubPage('map')">
              <div class="icon" style="background:linear-gradient(135deg,#B5F0C8,#7EDAA8);">🗺️</div>
              <div class="label">地图</div>
            </div>
            <div class="phone-app" onclick="app.openSubPage('diary')">
              <div class="icon" style="background:linear-gradient(135deg,#FFB8D0,#FF85A2);">📔</div>
              <div class="label">日记</div>
            </div>
            <div class="phone-app" onclick="app.openSubPage('shop')">
              <div class="icon" style="background:linear-gradient(135deg,#D4C4FF,#A890FF);">🛍️</div>
              <div class="label">商店</div>
            </div>
            <div class="phone-app" onclick="app.openSettings()">
              <div class="icon" style="background:linear-gradient(135deg,#E0E0E0,#BDBDBD);">⚙️</div>
              <div class="label">设置</div>
            </div>
            <div class="phone-app" onclick="app.openSubPage('tasks')">
              <div class="icon" style="background:linear-gradient(135deg,#FFE4A0,#FFC860);">📜</div>
              <div class="label">任务</div>
            </div>
            <div class="phone-app" onclick="app.openSubPage('bag')">
              <div class="icon" style="background:linear-gradient(135deg,#D4C4FF,#A890FF);">🎒</div>
              <div class="label">背包</div>
            </div>
          </div>
        </div>
      </div>
    </div>

    <!-- ==================== 文游页面 ==================== -->
    <div class="page" id="page-wenyou">
      <div class="app-header">
        <div class="title">文游<span class="sparkle">✦</span></div>
        <div class="header-right">
          <div class="bean-count">🫘 <span class="bean-count-val">30</span> &gt;</div>
        </div>
      </div>
      <div class="scroll-view">
        <div class="wenyou-tabs">
          <button class="wenyou-tab active" data-tab="scripts">剧本库</button>
          <button class="wenyou-tab" data-tab="saves">我的存档</button>
        </div>
        <div class="script-list" id="script-list">
          <!-- 动态生成 -->
        </div>
        <div class="script-list" id="save-list" style="display:none;">
          <div class="empty-state">
            <div class="icon">📁</div>
            <div class="text">还没有存档</div>
            <div class="sub">开始一个剧本，存档会自动保存到这里</div>
          </div>
        </div>
      </div>
    </div>

    <!-- ==================== 同人页面 ==================== -->
    <div class="page" id="page-tongren">
      <div class="app-header">
        <div class="title">同人<span class="sparkle">✦</span></div>
        <div class="header-right">
          <button class="btn btn-primary" style="padding:6px 14px;font-size:12px;" onclick="app.openTongrenGen()">✨ 生成</button>
        </div>
      </div>
      <div class="scroll-view">
        <!-- 生成器界面 -->
        <div id="tongren-gen" style="display:none;">
          <div class="tongren-header">
            <div class="tongren-pair">
              <div class="chara">
                <img src="https://api.dicebear.com/7.x/avataaars/svg?seed=shen" alt="">
                <div class="name">沈墨言</div>
                <div class="role">帅哥</div>
              </div>
              <div class="cross">✕</div>
              <div class="chara">
                <img src="https://api.dicebear.com/7.x/avataaars/svg?seed=user" alt="">
                <div class="name">User</div>
                <div class="role">你自己</div>
              </div>
            </div>
          </div>

          <div class="tongren-section">
            <div class="sec-title">✨ 选择标签 <span style="margin-left:auto;font-size:12px;color:var(--primary);cursor:pointer;">💡 智能推荐</span></div>
            <div class="tag-selector" id="tongren-tags">
              <span class="tag active" data-tag="古代">古代</span>
              <span class="tag active" data-tag="甜文">甜文</span>
              <span class="tag" data-tag="虐恋">虐恋</span>
              <span class="tag" data-tag="穿越">穿越</span>
              <span class="tag" data-tag="校园">校园</span>
              <span class="tag" data-tag="现代">现代</span>
              <span class="tag" data-tag="奇幻">奇幻</span>
              <span class="tag" data-tag="豪门">豪门</span>
              <span class="tag" data-tag="悬疑">悬疑</span>
              <span class="tag" style="border:1px dashed var(--primary-light);background:white;cursor:pointer;">+ 自定义</span>
            </div>
          </div>

          <div class="tongren-section">
            <div class="sec-title">✨ 同人梗 <span style="margin-left:auto;font-size:12px;color:var(--text-light);cursor:pointer;">管理预设 &gt;</span></div>
            <div class="tag-selector">
              <span class="tag active" data-trope="破镜重圆">破镜重圆</span>
              <span class="tag active" data-trope="先婚后爱">先婚后爱</span>
              <span class="tag" data-trope="失忆梗">失忆梗</span>
              <span class="tag" style="border:1px dashed var(--primary-light);background:white;cursor:pointer;">+ 添加梗</span>
            </div>
          </div>

          <div class="tongren-section">
            <div class="sec-title">✨ 字数</div>
            <div class="length-selector">
              <div class="length-option" data-len="short"><div class="len-title">短篇</div><div class="len-sub">500字</div></div>
              <div class="length-option active" data-len="medium"><div class="len-title">中篇</div><div class="len-sub">1500字</div></div>
              <div class="length-option" data-len="long"><div class="len-title">长篇</div><div class="len-sub">3000字</div></div>
            </div>
          </div>

          <div class="tongren-section">
            <div class="sec-title">✨ 风格</div>
            <div class="style-selector">
              <div class="style-option active" data-style="虐心">💔 虐心</div>
              <div class="style-option" data-style="甜蜜">🤍 甜蜜</div>
              <div class="style-option" data-style="搞笑">😄 搞笑</div>
              <div class="style-option" data-style="正剧">🎭 正剧</div>
            </div>
          </div>

          <button class="btn btn-primary generate-btn" onclick="app.generateTongren()">
            ✨ 生成同人文
          </button>
          <div style="text-align:center;font-size:12px;color:var(--text-lighter);margin-bottom:16px;">内容由 AI 生成，请注意辨别 ⓘ</div>
        </div>

        <!-- 同人列表 -->
        <div id="tongren-list-view">
          <div class="tongren-list">
            <div class="tongren-card" id="tongren-grid">
              <!-- 动态生成 -->
            </div>
          </div>
        </div>
      </div>
    </div>

    <!-- ==================== 记忆页面 ==================== -->
    <div class="page" id="page-memory">
      <div class="app-header">
        <div class="title">记忆<span class="sparkle">✦</span></div>
        <div class="header-right">
          <div class="bean-count">🫘 <span class="bean-count-val">30</span> &gt;</div>
        </div>
      </div>
      <div class="scroll-view">
        <div class="memory-header">
          <div class="memory-card">
            <div class="left">
              <div class="icon">💭</div>
              <div class="text">
                <div class="title">已沉淀回忆</div>
                <div class="sub">与你之间的点滴，都被好好珍藏</div>
              </div>
            </div>
            <div class="count" id="memory-count">2</div>
          </div>
        </div>
        <div class="memory-list" id="memory-list">
          <!-- 动态生成 -->
        </div>
      </div>
    </div>

    <!-- ==================== 我的页面 ==================== -->
    <div class="page" id="page-profile">
      <div class="app-header">
        <div class="title">我的<span class="sparkle">✦</span></div>
        <div class="header-right">
          <button class="btn btn-outline" style="padding:6px 12px;font-size:12px;" onclick="app.openSettings()">⚙️</button>
        </div>
      </div>
      <div class="scroll-view">
        <div class="profile-header">
          <div class="avatar-wrap">
            <img src="https://api.dicebear.com/7.x/avataaars/svg?seed=user123" class="avatar" alt="">
            <div class="edit">📷</div>
          </div>
          <div class="nickname">小墨的主人 ✏️</div>
          <div class="userid">ID: 102345678 🔗</div>
        </div>
        <div class="profile-stats">
          <div class="profile-stat">
            <div class="num" id="stat-beans">30</div>
            <div class="label">豆子</div>
          </div>
          <div class="profile-stat">
            <div class="num" id="stat-charas">2</div>
            <div class="label">角色</div>
          </div>
          <div class="profile-stat">
            <div class="num" id="stat-memories">2</div>
            <div class="label">回忆</div>
          </div>
          <div class="profile-stat">
            <div class="num" id="stat-days">1</div>
            <div class="label">天数</div>
          </div>
        </div>
        <div class="profile-menu">
          <div class="menu-item" onclick="app.showToast('账户充值开发中')">
            <div class="menu-icon" style="background:#FFE4EC;">🫘</div>
            <div class="menu-text">账户与充值</div>
            <div class="menu-arrow">豆子 30 &gt;</div>
          </div>
          <div class="menu-item" onclick="app.openSettings()">
            <div class="menu-icon" style="background:#E4F0FF;">⚙️</div>
            <div class="menu-text">偏好设置</div>
            <div class="menu-arrow">&gt;</div>
          </div>
          <div class="menu-item" onclick="app.showToast('主题换装开发中')">
            <div class="menu-icon" style="background:#F0E4FF;">👕</div>
            <div class="menu-text">主题换装</div>
            <div class="menu-arrow">&gt;</div>
          </div>
          <div class="menu-item" onclick="app.showToast('Mochi Phone v1.0.0')">
            <div class="menu-icon" style="background:#FFF4E4;">ℹ️</div>
            <div class="menu-text">关于 Mochi-phone</div>
            <div class="menu-arrow">&gt;</div>
          </div>
          <div class="menu-item" onclick="app.logout()">
            <div class="menu-icon" style="background:#FFE4E4;">🚪</div>
            <div class="menu-text">退出登录</div>
            <div class="menu-arrow">&gt;</div>
          </div>
        </div>
      </div>
    </div>

    <!-- ==================== 设置页面 (全屏覆盖) ==================== -->
    <div class="page" id="page-settings" style="position:fixed;top:0;left:0;right:0;bottom:0;z-index:300;background:var(--bg-gradient);">
      <div class="app-header">
        <button class="btn btn-outline" style="padding:6px 12px;font-size:12px;" onclick="app.closeSettings()">← 返回</button>
        <div class="title">设置<span class="sparkle">✦</span></div>
        <div style="width:60px;"></div>
      </div>
      <div class="scroll-view">
        <div class="settings-page">
          <div class="section">
            <div class="section-title">🔑 AI API 配置</div>
            <div class="form-group">
              <label>API 地址</label>
              <input type="text" id="setting-api-url" value="https://az.zlapi.vip/v1">
            </div>
            <div class="form-group">
              <label>API 密钥</label>
              <input type="password" id="setting-api-key" value="sk-YCm0hGZ8wlLzKz4U04yVraOF4aIaiEaJ2J2VV08Ju6u7KjCl">
            </div>
            <div class="form-group">
              <label>模型名称</label>
              <input type="text" id="setting-model" value="default">
            </div>
            <button class="btn btn-primary" style="width:100%;margin-top:8px;" onclick="app.saveSettings()">保存配置</button>
          </div>

          <div class="section">
            <div class="section-title">👤 个人信息</div>
            <div class="form-group">
              <label>昵称</label>
              <input type="text" id="setting-nickname" value="小墨的主人">
            </div>
            <div class="form-group">
              <label>个人简介</label>
              <textarea id="setting-bio" placeholder="写点什么...">用户喜欢被叫小墨。</textarea>
            </div>
            <button class="btn btn-primary" style="width:100%;margin-top:8px;" onclick="app.saveProfile()">保存资料</button>
          </div>

          <div class="section">
            <div class="section-title">⚠️ 数据管理</div>
            <button class="btn btn-outline" style="width:100%;color:#FF5C5C;border-color:#FFB8B8;" onclick="app.clearData()">🗑️ 清除所有本地数据</button>
          </div>
        </div>
      </div>
    </div>

    <!-- ==================== 聊天房间 (全屏覆盖) ==================== -->
    <div class="chat-room" id="chat-room">
      <div class="app-header">
        <button class="btn btn-outline" style="padding:6px 12px;font-size:12px;" onclick="app.closeChatRoom()">← 返回</button>
        <div class="title" id="chat-room-title">角色名</div>
        <div style="width:60px;"></div>
      </div>
      <div class="chat-messages" id="chat-messages"></div>
      <div class="chat-input-bar">
        <input type="text" id="chat-input" placeholder="输入消息..." onkeydown="if(event.key==='Enter')app.sendMessage()">
        <button class="send-btn" onclick="app.sendMessage()">➤</button>
      </div>
    </div>

    <!-- ==================== 文游游戏画面 (全屏覆盖) ==================== -->
    <div class="game-screen" id="game-screen">
      <div class="game-header">
        <div class="player-info">
          <img src="https://api.dicebear.com/7.x/avataaars/svg?seed=player" id="game-avatar" alt="">
          <div>
            <div class="name" id="game-player-name">宛菀风</div>
            <div class="realm" id="game-realm">练气期</div>
          </div>
        </div>
        <button class="btn btn-outline save-btn" onclick="app.saveGame()">💾 存读档</button>
      </div>
      <div class="game-stats">
        <div class="game-stat">⚡ 体力 <span id="game-hp">8/10</span></div>
        <div class="game-stat">🕐 第<span id="game-time">1</span>月·<span id="game-phase">上旬</span></div>
        <div class="game-stat">📍 <span id="game-location">青石广场</span></div>
      </div>
      <div class="game-story" id="game-story">
        <div class="story-attrs" id="game-attrs">
          <div class="story-attr"><div class="label">🪷 修为</div><div class="value" id="attr-xiuwei">120</div></div>
          <div class="story-attr"><div class="label">🌿 灵根</div><div class="value" id="attr-linggen">天灵根</div></div>
          <div class="story-attr"><div class="label">⚔️ 剑道</div><div class="value" id="attr-jiandao">入门</div></div>
          <div class="story-attr"><div class="label">📜 符道</div><div class="value" id="attr-fudao">初学</div></div>
        </div>
        <div class="story-card">
          <div class="chapter-title">✨ 剧情 ✨</div>
          <div class="content" id="game-content">正在加载剧情...</div>
        </div>
      </div>
      <div class="story-choices" id="game-choices"></div>
    </div>

    <!-- ==================== 底部Tab栏 ==================== -->
    <div class="tab-bar">
      <button class="tab-item active" data-page="chat">
        <span class="tab-icon">💬</span>
        <span>聊天</span>
      </button>
      <button class="tab-item" data-page="chara">
        <span class="tab-icon">👤</span>
        <span>角色</span>
      </button>
      <button class="tab-item" data-page="phone">
        <span class="tab-icon">📱</span>
        <span>手机</span>
      </button>
      <button class="tab-item" data-page="wenyou">
        <span class="tab-icon">📖</span>
        <span>文游</span>
      </button>
      <button class="tab-item" data-page="memory">
        <span class="tab-icon">⭐</span>
        <span>记忆</span>
      </button>
      <button class="tab-item" data-page="profile">
        <span class="tab-icon">😊</span>
        <span>我的</span>
      </button>
    </div>
  </div>

  <script src="js/app.js"></script>
</body>
</html>
