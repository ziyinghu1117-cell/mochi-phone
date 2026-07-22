# Mochi-phone

移动端优先的商用级 AI 角色聊天产品，对标星野 AI、猫箱的交互体验。

## 功能特性

- 💬 角色聊天：流式输出、多角色切换、对话历史本地存储
- 🎭 角色管理：新建、编辑、删除角色，支持公开/私密设置
- 🌐 角色社区：公共社区广场，一键导入，发布分享
- 💰 豆子计费：虚拟货币体系，预扣费失败自动返还
- 🔐 匿名账号：自动生成用户ID，支持恢复码备份找回
- 🎨 自定义装扮：纯 CSS 自定义页面、气泡、壁纸

## 技术栈

- 前端：纯 HTML + CSS + 原生 JavaScript
- 后端：Node.js + Express
- 数据库：PostgreSQL
- 部署：Render

## 快速开始

### 本地运行

```bash
# 安装依赖
npm install

# 复制配置文件
cp .env.example .env
# 编辑 .env 填写 API 密钥等配置

# 启动服务
npm start
```

### Render 部署

1. Fork 本仓库到你的 GitHub
2. Render 新建 Web Service，连接你的仓库
3. 添加 PostgreSQL 数据库（免费版即可）
4. 配置环境变量：`UPSTREAM_API_KEY` 填写你的 AI 接口密钥
5. 部署完成即可访问

## 环境变量说明

| 变量名 | 说明 | 默认值 |
|--------|------|--------|
| `PORT` | 服务端口 | 3000 |
| `DATABASE_URL` | PostgreSQL 连接串 | 自动（Render） |
| `UPSTREAM_API_BASE` | 上游 AI API 地址 | https://us.noviapi.com/v1 |
| `UPSTREAM_API_KEY` | 上游 API 密钥 | sk-qhCYj6vb0pJsIKxhTMPmMaigtrh8y9saYrxRQEMrfqT2ZsoP|
| `UPSTREAM_MODEL` | 使用的模型名称 | gpt-4o-mini |
| `CHAT_BEANS_COST` | 单次对话消耗豆子 | 2 |
| `DEMO_INITIAL_BEANS` | 新用户初始豆子 | 30 |

## 项目结构

```
├── server.js          # 后端主文件（含前端内嵌）
├── package.json       # 依赖配置
└── .env.example       # 环境变量示例
```

## 安全规范

- 上游 API 密钥仅存储在后端环境变量
- 所有 AI 请求经后端中转，前端不接触密钥
- 自定义装扮仅纯 CSS，拦截危险内容
- 用户本地数据仅存浏览器，不上传第三方
