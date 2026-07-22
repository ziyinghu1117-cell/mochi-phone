# Mochi-phone 手机上传前后端版

这是为手机部署准备的精简完整前后端版本。

只需要把这几个文件上传到 GitHub 仓库根目录：

- `server.js`
- `package.json`
- `.env.example`
- `README.md`

Render 配置：

Build Command:

```bash
npm install
```

Start Command:

```bash
npm start
```

环境变量：

这个版本已经内置你的 API 地址和模型：

```env
UPSTREAM_API_BASE=https://az.zlapi.vip/v1
UPSTREAM_MODEL=[0.005]自营伪流/gemini-2.5-flash
```

所以 Render 里最重要的是只要填：

```env
UPSTREAM_API_KEY=你的真实上游API密钥
```

其他环境变量可选：

```env
HOST=0.0.0.0
PORT=3000
CHAT_BEANS_COST=2
BEANS_PER_CNY=10
RECHARGE_PACKAGES=6:60,18:200,30:360,68:900
DEMO_INITIAL_BEANS=30
```

不填写 `UPSTREAM_API_KEY` 时，会返回演示流式回复。
