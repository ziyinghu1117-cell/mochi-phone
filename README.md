# Mochi Phone - 角色手机模拟器

一个基于 Node.js + Express 的角色手机模拟器 Web 应用，支持查看角色手机内容、文字游戏、社区互动等功能。

## 功能特性

### 手机桌面
- **微信** - 角色间即时通讯
- **应用商店** - 安装/管理应用
- **社交** - 社交论坛
- **同人** - 同人创作论坛
- **查手机** - 查看任意角色的手机内容（微信、短信、朋友圈、相册、浏览器等20个应用）

### 查手机功能
- 每次生成消耗 **2颗米粒**
- 支持 **后台生成**：点击生成后退出查手机，生成会继续进行
- **生成完成提醒**：生成完毕后弹出通知，可在任意页面看到
- 桌面图标显示生成状态（⏳生成中 / ✓已生成）
- 20个应用：微信、短信、朋友圈、通话、相册、备忘录、待办、抖音、小红书、B站、音乐、小说、健康、游戏、网盘、浏览器、购物、外卖、情侣、资产
- 生成内容服务端持久化存储

### 文字游戏
- 多章节故事推进，支持累计故事历史
- 字数模式选择（短篇1米 / 标准2米 / 长篇3米）
- 书签收藏与叙述消息删除
- 实时好感度变化
- 数据完整持久化，临时退出不丢失

### 数据存储
- 服务端数据持久化（PostgreSQL / JSON 文件）
- localStorage 客户端缓存
- 登出时完整清理本地数据

## 快速开始

### 环境要求
- Node.js >= 18
- npm

### 安装与运行

```bash
# 1. 解压项目文件
unzip mochi-phone-complete-v3.zip
cd mochi-phone

# 2. 安装依赖
npm install

# 3. 启动服务
npm start
# 或
node server.js
```

启动后访问 http://localhost:3000 即可使用。

### 环境变量（可选）

可在项目根目录创建 `.env` 文件配置：

```env
# 数据库（可选，不配置则使用本地 JSON 文件存储）
DATABASE_URL=postgresql://user:password@localhost:5432/mochi_phone

# 邮件服务（可选）
BREVO_API_KEY=your_api_key
BREVO_SENDER_EMAIL=noreply@example.com
EMAIL_USER=your_email
EMAIL_PASS=your_password
```

不配置任何环境变量也能正常运行，数据存储在 `.data/mochi-phone-data.json`。

## 项目结构

```
mochi-phone/
├── server.js            # 主程序（前端+后端一体）
├── package.json         # 依赖配置
├── package-lock.json    # 依赖锁定
├── README.md            # 说明文档
└── .data/               # 运行时数据（自动创建）
    └── mochi-phone-data.json
```

## 技术栈

- **后端**: Node.js, Express, Helmet, CORS
- **数据库**: PostgreSQL（可选）/ 本地 JSON 文件
- **前端**: 原生 HTML/CSS/JavaScript
- **其他**: dotenv（环境变量）, nodemailer（邮件）

## 使用说明

1. 打开页面后可选择注册/登录，或点击「游客访问」直接体验
2. 进入手机桌面后，点击应用图标使用对应功能
3. 点击「查手机」选择角色，查看该角色的手机内容
4. 在查手机中点击任意应用图标，消耗2米粒生成内容
5. 生成过程中可退出查手机，后台会继续生成，完成后弹出提醒
6. 文字游戏中可在设置里选择字数模式

## 版本历史

- v1.0.0 (2026-08-05) - 完整版，包含查手机功能（2米粒消耗+后台生成+完成提醒）、文字游戏字数模式、数据持久化等全部功能
