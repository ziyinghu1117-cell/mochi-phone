/**
 * Mochi Phone - AI API 代理服务器
 * 用于保护API密钥，处理跨域请求
 */

const express = require('express');
const cors = require('cors');
const http = require('http');
const https = require('https');
const url = require('url');

const app = express();
const PORT = process.env.PORT || 3001;

// ====== 配置 ======
const TARGET_API = process.env.TARGET_API || 'https://az.zlapi.vip';
const API_KEY = process.env.API_KEY || 'sk-YCm0hGZ8wlLzKz4U04yVraOF4aIaiEaJ2J2VV08Ju6u7KjCl';

// ====== 中间件 ======
app.use(cors());
app.use(express.json({ limit: '10mb' }));
app.use(express.static('../'));

// ====== 日志 ======
app.use((req, res, next) => {
  const now = new Date().toISOString();
  console.log(`[${now}] ${req.method} ${req.path}`);
  next();
});

// ====== 健康检查 ======
app.get('/api/health', (req, res) => {
  res.json({ status: 'ok', time: new Date().toISOString() });
});

// ====== AI API 代理 ======
app.all('/v1/*', async (req, res) => {
  const targetPath = req.path;
  const targetUrl = `${TARGET_API}${targetPath}`;

  console.log(`Proxy -> ${targetUrl}`);

  const parsed = url.parse(targetUrl);
  const client = parsed.protocol === 'https:' ? https : http;

  const options = {
    hostname: parsed.hostname,
    port: parsed.port || (parsed.protocol === 'https:' ? 443 : 80),
    path: parsed.path,
    method: req.method,
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${API_KEY}`,
      'Accept': 'application/json'
    }
  };

  // 转发流式请求
  if (req.body && req.body.stream) {
    options.headers['Accept'] = 'text/event-stream';
  }

  const proxyReq = client.request(options, (proxyRes) => {
    res.status(proxyRes.statusCode);
    Object.keys(proxyRes.headers).forEach(key => {
      res.setHeader(key, proxyRes.headers[key]);
    });
    proxyRes.pipe(res);
  });

  proxyReq.on('error', (err) => {
    console.error('Proxy error:', err);
    res.status(500).json({ error: 'Proxy error', message: err.message });
  });

  if (req.body) {
    proxyReq.write(JSON.stringify(req.body));
  }
  proxyReq.end();
});

// ====== 启动 ======
app.listen(PORT, () => {
  console.log(`
╔══════════════════════════════════════════╗
║      🍡 Mochi Phone 代理服务器已启动      ║
╠══════════════════════════════════════════╣
║  地址: http://localhost:${PORT}              ║
║  API:  ${TARGET_API}        ║
╚══════════════════════════════════════════╝
  `);
});
