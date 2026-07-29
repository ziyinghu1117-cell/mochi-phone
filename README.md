# Mochi-phone

一个粉色治愈系的 AI 角色扮演应用，支持聊天、同人创作、文游、人设社区和记忆系统。

---

## 新增功能：真实支付 + 管理员后端

### 支付流程

1. 用户在 **我的** 页面点击充值套餐
2. 弹出支付弹窗，显示 **收款码** + 用户 ID
3. 用户扫码付款，并在备注中填写自己的 **用户 ID**
4. 用户在弹窗中输入 **付款备注 ID / 交易号**
5. 提交后，订单状态变为 **待审核**
6. 管理员在后台审批通过后，豆子 **自动发放** 到用户账户

### 管理员后端

- **访问地址**：`https://你的域名/admin`
- **登录密码**：默认 `841026`（可通过环境变量 `ADMIN_PASSWORD` 修改）
- **功能**：
  - 统计概览（总订单、待审核、已通过、已拒绝、总收入、用户数）
  - 充值订单管理（筛选、通过、拒绝、详情查看）
  - 审批通过后自动发放豆子

---

## 快速部署（Render）

1. Fork 本仓库到你的 GitHub
2. 在 [Render](https://render.com) 创建 **New Web Service**
3. 连接你的 GitHub 仓库
4. 设置环境变量（参考 `.env.example`）
5. 点击 Deploy

---

## 环境变量

| 变量 | 说明 | 默认值 |
|------|------|--------|
| `PORT` | 服务器端口 | `3000` |
| `UPSTREAM_API_KEY` | AI 上游 API 密钥 | 内置测试密钥 |
| `CHAT_BEANS_COST` | 每次聊天消耗豆子 | `2` |
| `BEANS_PER_CNY` | 每元兑换豆子数 | `10` |
| `RECHARGE_PACKAGES` | 充值套餐（金额:豆子） | `6:60,18:200,30:360,68:900` |
| `DEMO_INITIAL_BEANS` | 新用户初始豆子 | `30` |
| `ADMIN_PASSWORD` | 管理员后台密码 | `841026` |
| `DATABASE_URL` | PostgreSQL 连接字符串 | 空（使用本地 JSON） |

---

## 本地开发

```bash
# 安装依赖
npm install

# 启动开发服务器（使用本地 JSON 文件存储）
npm start

# 访问
http://localhost:3000
```

---

## 技术栈

- **后端**：Node.js + Express
- **前端**：原生 HTML/CSS/JavaScript（单页面应用）
- **AI**：兼容 OpenAI API 格式（默认通过 az.zlapi.vip 代理）
- **数据持久化**：PostgreSQL（生产环境）/ JSON 文件（开发环境）

---

## 收款码说明

收款码已以 **Base64** 形式内嵌在 `server.js` 中，无需额外文件。如需更换收款码，请修改代码中的 `QR_CODE_BASE64` 常量。

---

## 项目结构

```
mochi-phone/
├── server.js          # 主服务文件（含前端代码 + 32个文游剧本）
├── package.json       # 依赖配置
├── .env.example       # 环境变量模板
└── README.md          # 本文件
```

---

## 许可证

MIT
