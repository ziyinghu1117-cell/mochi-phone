/**
 * AI Phone Simulator - 后端服务
 * 功能：API代理、SSE流式响应、静态文件服务
 */
require('dotenv').config();
const express = require('express');
const cors = require('cors');
const path = require('path');
const app = express();
const PORT = process.env.PORT || 3000;

// 中间件
app.use(cors());
app.use(express.json({ limit: '10mb' }));
app.use(express.static(__dirname));

// API 基础配置
const API_BASE_URL = process.env.API_BASE_URL || 'https://az.zlapi.vip/v1';
const API_KEY = process.env.API_KEY || '';
const DEFAULT_MODEL = process.env.DEFAULT_MODEL || 'gpt-3.5-turbo';

/**
 * 构建系统提示词
 * 注入世界书设定和角色设定
 */
function buildSystemPrompt(options = {}) {
  const { worldbook = null, character = null, scenario = null, gameMode = false } = options;
  
  let systemPrompt = '';
  
  // 基础设定
  if (gameMode) {
    systemPrompt += `你是一个AI文字游戏主持人。请根据玩家的行动推进剧情，保持沉浸感和连贯性。
规则：
1. 用第三人称叙述剧情发展
2. 描述环境、人物动作和对话
3. 根据玩家选择合理推进故事
4. 保持角色性格一致性
5. 适当增加悬念和戏剧性

`;
  } else {
    systemPrompt += `你是一个AI对话助手。请自然、流畅地与用户交流。

`;
  }
  
  // 注入世界书设定
  if (worldbook && worldbook.entries && worldbook.entries.length > 0) {
    systemPrompt += `【世界观设定】
以下是当前世界的背景设定，请严格遵守：
`;
    worldbook.entries.forEach((entry, index) => {
      if (entry.enabled !== false) {
        systemPrompt += `${index + 1}. ${entry.key}: ${entry.content}\n`;
      }
    });
    systemPrompt += '\n';
  }
  
  // 注入角色设定
  if (character) {
    systemPrompt += `【角色设定】
你正在扮演以下角色，请严格按照角色设定进行对话：
姓名：${character.name || '未知'}
性格：${character.personality || '未知'}
外貌：${character.appearance || '未知'}
背景：${character.background || '未知'}
说话风格：${character.speechStyle || '自然'}
`;
    if (character.extraInfo) {
      systemPrompt += `其他设定：${character.extraInfo}\n`;
    }
    systemPrompt += '\n';
  }
  
  // 注入场景设定
  if (scenario) {
    systemPrompt += `【当前场景】
${scenario}

`;
  }
  
  return systemPrompt;
}

/**
 * 聊天API代理 - 支持SSE流式响应
 */
app.post('/api/chat', async (req, res) => {
  try {
    const { messages, model, stream = true, worldbook, character, scenario, gameMode, temperature, maxTokens } = req.body;
    
    if (!messages || !Array.isArray(messages)) {
      return res.status(400).json({ error: 'messages 参数无效' });
    }
    
    // 构建完整的消息列表
    const systemPrompt = buildSystemPrompt({ worldbook, character, scenario, gameMode });
    
    const fullMessages = [
      { role: 'system', content: systemPrompt },
      ...messages
    ];
    
    const requestBody = {
      model: model || DEFAULT_MODEL,
      messages: fullMessages,
      stream: stream,
      temperature: temperature !== undefined ? temperature : 0.7,
      max_tokens: maxTokens || 2048
    };
    
    if (stream) {
      // SSE 流式响应
      res.setHeader('Content-Type', 'text/event-stream');
      res.setHeader('Cache-Control', 'no-cache');
      res.setHeader('Connection', 'keep-alive');
      res.setHeader('X-Accel-Buffering', 'no');
      
      try {
        const response = await fetch(`${API_BASE_URL}/chat/completions`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${API_KEY}`
          },
          body: JSON.stringify(requestBody)
        });
        
        if (!response.ok) {
          const errorText = await response.text();
          res.write(`event: error\ndata: ${JSON.stringify({ error: `API请求失败: ${response.status}`, detail: errorText })}\n\n`);
          res.end();
          return;
        }
        
        const reader = response.body.getReader();
        const decoder = new TextDecoder();
        let buffer = '';
        
        while (true) {
          const { done, value } = await reader.read();
          if (done) break;
          
          buffer += decoder.decode(value, { stream: true });
          const lines = buffer.split('\n');
          buffer = lines.pop() || '';
          
          for (const line of lines) {
            const trimmed = line.trim();
            if (trimmed.startsWith('data: ')) {
              const data = trimmed.slice(6);
              if (data === '[DONE]') {
                res.write('data: [DONE]\n\n');
                res.end();
                return;
              }
              try {
                const parsed = JSON.parse(data);
                const content = parsed.choices?.[0]?.delta?.content;
                if (content) {
                  res.write(`data: ${JSON.stringify({ content })}\n\n`);
                }
              } catch (e) {
                // 忽略解析错误
              }
            }
          }
        }
        
        res.write('data: [DONE]\n\n');
        res.end();
        
      } catch (error) {
        res.write(`event: error\ndata: ${JSON.stringify({ error: error.message })}\n\n`);
        res.end();
      }
    } else {
      // 非流式响应
      const response = await fetch(`${API_BASE_URL}/chat/completions`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${API_KEY}`
        },
        body: JSON.stringify(requestBody)
      });
      
      if (!response.ok) {
        const errorText = await response.text();
        return res.status(response.status).json({ error: 'API请求失败', detail: errorText });
      }
      
      const data = await response.json();
      res.json({
        content: data.choices?.[0]?.message?.content || '',
        usage: data.usage
      });
    }
    
  } catch (error) {
    console.error('Chat API error:', error);
    res.status(500).json({ error: '服务器内部错误', message: error.message });
  }
});

/**
 * 模型列表API
 */
app.get('/api/models', async (req, res) => {
  try {
    const response = await fetch(`${API_BASE_URL}/models`, {
      headers: {
        'Authorization': `Bearer ${API_KEY}`
      }
    });
    
    if (!response.ok) {
      return res.status(response.status).json({ error: '获取模型列表失败' });
    }
    
    const data = await response.json();
    res.json(data);
  } catch (error) {
    console.error('Models API error:', error);
    res.status(500).json({ error: '服务器内部错误' });
  }
});

/**
 * 健康检查
 */
app.get('/api/health', (req, res) => {
  res.json({
    status: 'ok',
    timestamp: new Date().toISOString(),
    apiConfigured: !!API_KEY,
    version: '1.0.0'
  });
});

// SPA 路由回退
app.get('*', (req, res) => {
  res.sendFile(path.join(__dirname, 'index.html'));
});

// 启动服务器
app.listen(PORT, () => {
  console.log(`
╔════════════════════════════════════════════════════════════╗
║         AI Phone Simulator 服务器已启动                    ║
╠════════════════════════════════════════════════════════════╣
║  本地访问: http://localhost:${PORT}                           ║
║  API地址: ${API_BASE_URL}                             ║
║  模式: ${API_KEY ? '已配置API密钥' : '⚠️  未配置API密钥'}                            ║
╚════════════════════════════════════════════════════════════╝
  `);
});

module.exports = app;
