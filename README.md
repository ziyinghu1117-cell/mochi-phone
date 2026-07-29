# Mochi-phone 🌸

粉色治愈系 AI 角色扮演应用 —— **账号隔离版 + SSE 流式输出**

## 本次改造内容

### 🔐 账号数据彻底隔离
- 每个用户拥有独立的数据目录 `data/users/<userId>/`
- 角色、聊天记录、记忆、豆子、订单、文游存档全部按 `userId` 分文件存储
- 跨用户数据访问在代码层就被拦截（`authRequired` 中间件）
- 支持三种身份：注册用户 / 登录用户 / 游客（游客数据独立不污染）

### ⚡ SSE 流式聊天
- `/api/chat` 改为 Server-Sent Events 流式输出
- 前端逐 token 渲染，打字机效果
- 上游 `az.zlapi.vip` 已确认支持 `stream=true`

### 📁 数据目录结构
```
data/
├── users.json              # 账号表 { username: { userId, password, beans, ... } }
├── orders.json             # 充值订单
├── official_chars.json     # 官方人设
├── official_scripts.json   # 官方文游剧本
└── users/
    ├── <userId>/characters.json   # 该用户自建角色
    ├── <userId>/chats.json        # 该用户所有聊天记录
    ├── <userId>/memories.json     # 该用户记忆
    ├── <userId>/profile.json      # 该用户资料
    ├── <userId>/transactions.json # 该用户消费明细
    └── <userId>/scripts_save.json# 该用户文游存档
```

## 快速部署（Render）

1. Fork 本仓库
2. 在 Render 创建 New Web Service → 连接 GitHub 仓库
3. 设置环境变量（参考 `.env.example`）
4. 点击 Deploy

## 环境变量

| 变量 | 说明 | 默认值 |
|---|---|---|
| PORT | 服务器端口 | 3000 |
| UPSTREAM_API_KEY | AI 上游 API 密钥 | 内置测试密钥 |
| CHAT_BEANS_COST | 每次聊天消耗豆子 | 2 |
| BEANS_PER_CNY | 每元兑换豆子数 | 10 |
| DEMO_INITIAL_BEANS | 新用户初始豆子 | 30 |
| ADMIN_PASSWORD | 管理员后台密码 | 841026 |

## 本地开发

```bash
npm install
npm start
# 访问 http://localhost:3000
```

## 管理员

用户名 `宛萦风` + 密码 `841026` 登录后自动跳转后台。

## 技术栈

- 后端：Node.js + Express（无额外依赖，原生 SSE）
- 前端：单文件 SPA（无构建步骤）
- AI：OpenAI 兼容接口（az.zlapi.vip 代理）
- 存储：JSON 文件（开发）/ PostgreSQL（生产可扩展）

## License

MIT
