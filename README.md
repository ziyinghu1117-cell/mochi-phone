# Mochi AI Chat v2.0 - 商用AI角色聊天平台

一款治愈系AI角色聊天平台，对标星野AI移动端交互体验，支持自定义角色、社区分享、个性装扮、用户系统、云端同步等功能。

## ✨ 功能特性

### 👤 用户系统
- **注册登录**：用户名+密码注册登录，JWT token鉴权
- **个人资料**：昵称、头像、个人简介可自定义
- **自动登录**：token存储本地，刷新自动校验
- **数据隔离**：每个用户数据完全独立，互不可见

### 💾 云端存储
- **SQLite数据库**：零配置文件数据库，开箱即用
- **角色云端同步**：角色数据存储在服务器，换设备也能看到
- **对话历史云端**：聊天记录永久保存，多端同步
- **交易记录**：所有充值消费记录可追溯

### 💰 米粒计费系统
- **按Token用量计费**：输入+输出token都计入用量，用多少扣多少
- **米粒兑换比例**：1000 token = 1 米粒（可配置）
- **新用户福利**：注册即送1000米粒（可配置）
- **实时扣费**：对话完成后按实际用量扣除

### 💳 支付系统
- **可插拔架构**：支持多种支付渠道，通过配置切换
- **模拟支付**：内置模拟支付，方便开发测试
- **微信/支付宝预留**：预留接入点，可快速对接真实支付
- **订单管理**：完整的订单生命周期管理

### 🎭 角色聊天
- 左右气泡布局，支持头像展示
- SSE流式输出，打字机逐字渲染
- 顶部角色切换栏，左右滑动切换
- 对话历史云端永久存储
- 支持多对话独立管理

### 👥 角色管理
- 创建自定义角色（头像、名称、人设、简介、标签）
- 编辑角色信息，不影响历史对话
- 删除角色（二次确认）
- 角色公开/私密设置

### 🌐 角色社区
- 社区广场展示公开角色
- 角色详情页查看完整人设
- 一键导入社区角色到本地
- 搜索筛选（最热/最新）
- 角色点赞功能

### 🎨 自定义装扮
- **页面UI自定义**：全局CSS样式覆盖
- **聊天气泡自定义**：仅作用于气泡样式
- **聊天壁纸自定义**：上传图片+透明度+模糊度
- 安全过滤危险内容

### 📊 数据明细
- **米粒明细**：所有收支记录，按类型筛选
- **充值记录**：所有订单状态可查
- **消费详情**：每次对话的token用量明细

## 🚀 快速开始

### 环境要求
- Node.js >= 16.0.0
- npm 或 yarn

### 安装部署

```bash
# 1. 解压项目
unzip mochi-ai-chat.zip
cd mochi-ai-chat

# 2. 安装依赖
npm install

# 3. 配置环境变量
cp .env.example .env
# 编辑 .env 文件，填入你的API密钥等配置

# 4. 启动服务
npm start

# 5. 访问应用
# 浏览器打开 http://localhost:3000
```

### 首次使用
1. 打开应用后，先注册一个账号
2. 注册成功自动登录，赠送初始米粒
3. 去「角色」页面创建你的第一个角色
4. 开始聊天体验！

## ⚙️ 配置说明

所有配置都在 `.env` 文件中，复制 `.env.example` 后修改即可。

### 上游API配置
| 配置项 | 说明 | 默认值 |
|--------|------|--------|
| `API_BASE_URL` | 上游API地址（OpenAI兼容格式） | `https://us.noviapi.com/v1` |
| `API_KEY` | 上游API密钥 | `your_api_key_here` |
| `DEFAULT_MODEL` | 默认使用的模型 | `gpt-3.5-turbo` |
| `API_COST_PER_CALL` | 上游单次调用成本（元，用于成本核算） | `0.01` |

### 服务器配置
| 配置项 | 说明 | 默认值 |
|--------|------|--------|
| `PORT` | 服务监听端口 | `3000` |
| `NODE_ENV` | 运行环境 | `development` |

### JWT鉴权配置
| 配置项 | 说明 | 默认值 |
|--------|------|--------|
| `JWT_SECRET` | JWT签名密钥（生产环境务必修改） | `your_jwt_secret_key_here` |
| `JWT_EXPIRES_IN` | Token过期时间（秒） | `604800`（7天） |

### 数据库配置
| 配置项 | 说明 | 默认值 |
|--------|------|--------|
| `DB_PATH` | SQLite数据库文件路径 | `./mochi.db` |

### 米粒计费配置
| 配置项 | 说明 | 默认值 |
|--------|------|--------|
| `TOKENS_PER_RICE` | 多少token兑换1米粒 | `1000` |
| `NEW_USER_RICE` | 新用户注册赠送米粒数 | `1000` |

### 充值档位配置
| 配置项 | 说明 | 默认值 |
|--------|------|--------|
| `RECHARGE_TIERS` | 充值档位列表（格式：金额:米粒数:赠送数,...） | `6:60:0,30:300:30,68:680:80,128:1280:200,328:3280:600,648:6480:1500` |

### 支付配置
| 配置项 | 说明 | 默认值 |
|--------|------|--------|
| `PAY_CHANNEL` | 支付渠道：mock/wechat/alipay | `mock` |
| `WECHAT_APP_ID` | 微信支付AppID | - |
| `WECHAT_MCH_ID` | 微信支付商户号 | - |
| `WECHAT_API_KEY` | 微信支付API密钥 | - |
| `WECHAT_NOTIFY_URL` | 微信支付回调地址 | - |
| `ALIPAY_APP_ID` | 支付宝AppID | - |
| `ALIPAY_PRIVATE_KEY` | 支付宝私钥 | - |
| `ALIPAY_PUBLIC_KEY` | 支付宝公钥 | - |
| `ALIPAY_NOTIFY_URL` | 支付宝回调地址 | - |

### 社区配置
| 配置项 | 说明 | 默认值 |
|--------|------|--------|
| `COMMUNITY_PAGE_SIZE` | 社区单页加载数量 | `20` |

## 📁 目录结构

```
mochi-ai-chat/
├── index.html          # 前端主页面（登录+主应用）
├── style.css           # 样式文件（粉色系移动端风格）
├── app.js              # 前端核心逻辑
├── server.js           # 后端服务（Express + SQLite + JWT）
├── package.json        # 项目依赖配置
├── .env.example        # 环境配置模板
├── mochi.db            # SQLite数据库文件（首次运行自动生成）
└── README.md           # 项目说明文档
```

## 🗄️ 数据库设计

### users 用户表
- id: 用户ID
- username: 用户名（唯一）
- password_hash: 密码哈希（bcrypt加密）
- nickname: 昵称
- avatar: 头像
- description: 个人简介
- rice_balance: 米粒余额
- created_at: 创建时间

### characters 角色表
- id: 角色ID
- user_id: 所属用户ID
- name: 角色名称
- avatar: 角色头像
- persona: 角色人设
- description: 角色简介
- tags: 标签（JSON数组）
- is_public: 是否公开
- created_at: 创建时间

### conversations 对话表
- id: 对话ID
- user_id: 用户ID
- character_id: 角色ID
- created_at: 创建时间
- updated_at: 更新时间

### messages 消息表
- id: 消息ID
- conversation_id: 对话ID
- role: 角色（user/assistant）
- content: 消息内容
- created_at: 创建时间

### transactions 交易记录表
- id: 交易ID
- user_id: 用户ID
- type: 类型（recharge/consume）
- amount: 数量
- balance_after: 交易后余额
- description: 描述
- detail: 详细信息（JSON）
- created_at: 创建时间

### community_characters 社区角色表
- id: 社区角色ID
- user_id: 上传者ID
- character_id: 角色ID
- likes: 点赞数
- created_at: 创建时间

### orders 订单表
- id: 订单ID
- user_id: 用户ID
- order_no: 订单号（唯一）
- amount: 金额
- rice_amount: 米粒数量
- status: 状态（pending/paid/cancelled）
- pay_method: 支付方式
- created_at: 创建时间
- paid_at: 支付时间

## 🔒 安全说明

1. **API密钥安全**：上游API密钥仅存储在后端 `.env` 文件中，前端代码不会暴露任何密钥
2. **请求中转**：所有AI对话请求必须经由后端中转，前端不直接调用上游API
3. **密码安全**：用户密码使用bcrypt加密存储，不可逆
4. **JWT鉴权**：所有接口需要token鉴权，防止未授权访问
5. **数据隔离**：用户数据完全隔离，A用户看不到B用户的任何数据
6. **装扮安全**：自定义装扮仅支持纯CSS样式覆盖，自动过滤script标签、JS代码等危险内容
7. **参数校验**：后端接口做好参数校验，防止恶意请求

## 🎨 UI设计风格

- **主色调**：粉色系（#FF9EC8、#FFB8D6），柔和少女风
- **背景**：浅粉色渐变，温馨治愈
- **卡片**：白色圆角卡片，轻微阴影
- **按钮**：粉色渐变胶囊按钮
- **布局**：移动端优先，竖屏设计
- **底部导航**：4个Tab（聊天、角色、社区、我的）

## 🔧 技术栈

- **前端**：纯HTML + CSS + 原生JavaScript
- **后端**：Node.js + Express
- **数据库**：SQLite (better-sqlite3)
- **鉴权**：JWT (jsonwebtoken)
- **加密**：bcryptjs
- **API**：OpenAI兼容格式 /v1/chat/completions
- **流式响应**：SSE (Server-Sent Events)

## 📱 适配说明

- 优先适配手机竖屏（375px - 430px）
- 支持安全区域适配（刘海屏、底部Home条）
- 触控友好，按钮尺寸适合手指点击
- 最大宽度480px，桌面端居中显示

## 🚀 部署到生产环境

### 使用 Render 部署
1. 将代码推送到 GitHub 仓库
2. 在 Render 上创建新的 Web Service
3. 连接 GitHub 仓库
4. 配置环境变量（在 Render 控制面板中设置）
5. 部署命令：`npm install && npm start`
6. 注意：SQLite数据库文件在Render上会在重启后丢失，建议挂载持久化磁盘或使用外部数据库

### 使用 Vercel 部署
需要配置 serverless 函数，或使用 Express 适配器。SQLite可能不支持，建议改用其他数据库。

### 使用 Docker 部署
```dockerfile
FROM node:18-alpine
WORKDIR /app
COPY package*.json ./
RUN npm install --production
COPY . .
EXPOSE 3000
CMD ["npm", "start"]
```

### 生产环境建议
1. **数据库**：生产环境建议将SQLite替换为MySQL/PostgreSQL等专业数据库
2. **支付对接**：根据需要对接微信支付/支付宝等真实支付渠道
3. **HTTPS**：务必配置HTTPS，确保数据传输安全
4. **JWT密钥**：修改JWT_SECRET为复杂随机字符串
5. **备份**：定期备份数据库文件

## 💳 支付对接说明

### 当前支持
- **模拟支付（mock）**：默认模式，点击充值直接到账，用于开发测试

### 对接微信支付
1. 在 `.env` 中设置 `PAY_CHANNEL=wechat`
2. 填写微信支付相关配置（APPID、商户号、API密钥等）
3. 在 `server.js` 中实现微信支付的下单、回调逻辑
4. 前端增加微信支付二维码展示

### 对接支付宝
1. 在 `.env` 中设置 `PAY_CHANNEL=alipay`
2. 填写支付宝相关配置（APPID、私钥、公钥等）
3. 在 `server.js` 中实现支付宝的下单、回调逻辑
4. 前端增加支付宝支付跳转

## 📝 升级说明（v1.x → v2.0）

### 重大变更
1. **用户系统**：新增注册登录，不再使用设备ID匿名访问
2. **数据库**：从内存存储升级为SQLite持久化存储
3. **计费方式**：从按次固定扣费改为按Token用量计费
4. **云端同步**：对话历史、角色数据全部云端存储
5. **命名统一**：「豆子」统一更名为「米粒」

### 数据迁移
v1.x版本的本地数据无法直接迁移到v2.0，需要重新注册账号并创建角色。

## 📄 License

MIT License
