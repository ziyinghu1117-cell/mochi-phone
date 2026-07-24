# Mochi-phone 麻薯手机

AI 角色扮演手机模拟器，集成聊天、角色卡、论坛社区（回响环廊）、文字游戏（文游）、记忆系统和用户中心。

## 特性

- **AI 聊天**：多角色对话，支持上下文记忆
- **角色卡**：自定义角色创建与社区角色市场
- **回响环廊论坛**：小红书风格社区，含板块导航、热议榜、发帖评论
- **文游模块**：32 个内置剧本，AI 驱动的文字冒险游戏
  - 恋爱、修仙、宫廷、末世、无限流、悬疑、校园、娱乐圈等全品类
  - 完整的存档/读档系统
  - 属性成长、NPC 关系、蝴蝶效应
  - 基于设计模板的通用设计原则注入
- **记忆系统**：自动提取和管理对话记忆
- **私信系统**：与角色的一对一私信

## 快速开始

### 本地运行

1. 安装依赖：
```bash
npm install
```

2. 复制环境配置：
```bash
cp .env.example .env
```

3. 编辑 `.env`，填入你的上游 API 密钥：
```
UPSTREAM_API_KEY=你的真实API密钥
```

4. 启动服务：
```bash
npm start
```

5. 打开浏览器访问 `http://localhost:3000`

### 部署到 Render

1. 将代码推送到 GitHub 仓库
2. 在 Render 创建新的 Web Service
3. 选择仓库，配置如下：
   - **Build Command**: `npm install`
   - **Start Command**: `npm start`
4. 添加环境变量：
   - `UPSTREAM_API_KEY`：你的上游 API 密钥
   - 其他变量参见 `.env.example`
5. 部署即可

## 环境变量

| 变量 | 说明 | 默认值 |
|------|------|--------|
| UPSTREAM_API_KEY | 上游 AI API 密钥（必填） | - |
| UPSTREAM_API_BASE | 上游 API 地址 | https://az.zlapi.vip/v1 |
| UPSTREAM_MODEL | 使用的模型 | [0.005]自营伪流/gemini-2.5-flash |
| CHAT_BEANS_COST | 每次聊天消耗的豆子 | 2 |
| BEANS_PER_CNY | 每元对应的豆子数 | 10 |
| RECHARGE_PACKAGES | 充值套餐（金额:豆子） | 6:60,18:200,30:360,68:900 |
| DEMO_INITIAL_BEANS | 新用户初始豆子 | 30 |
| DATA_DIR | 数据存储目录 | .data |
| PORT | 服务端口 | 3000 |

## 文件结构

本项目为单文件部署，所有前端代码（HTML/CSS/JS）、头像图片和 32 个文游剧本均已内嵌在 `server.js` 中：

```
mochi-phone/
├── server.js          # 主服务文件（包含所有代码）
├── package.json       # 依赖配置
├── .env.example       # 环境变量模板
└── README.md          # 本文件
```

## 技术栈

- **后端**：Node.js + Express
- **前端**：原生 HTML/CSS/JavaScript（无构建步骤）
- **AI**：兼容 OpenAI API 格式的上游服务
- **数据持久化**：JSON 文件存储

## 文游剧本列表

内置 32 个剧本，涵盖：
- 恋爱感情、都市校园、娱乐圈
- 修仙玄幻、古代人生、宫廷权谋
- 末世生存、恐怖惊悚、悬疑推理
- 无限流、穿越重生、经营发展
- 同人衍生、哨向设定等

## 许可

MIT
