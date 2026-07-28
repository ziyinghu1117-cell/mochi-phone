/**
 * api.js — OpenAI 兼容 API 客户端
 * 支持：普通对话、流式输出、文游专用结构化输出
 */
(function () {
  'use strict';

  function getSettings() {
    return Store.get().settings;
  }

  /**
   * 核心：调用 /chat/completions
   * @param {Array} messages  [{role, content}]
   * @param {Object} opts     { stream, onChunk, temperature, maxTokens, signal }
   */
  async function chat(messages, opts = {}) {
    const s = getSettings();
    const url = s.baseURL.replace(/\/+$/, '') + '/chat/completions';
    const body = {
      model: opts.model || s.model,
      messages: messages,
      temperature: opts.temperature ?? s.temperature,
      max_tokens: opts.maxTokens ?? s.maxTokens,
      stream: opts.stream && s.streaming ? true : false,
    };

    if (!s.apiKey) {
      throw new Error('未配置 API 密钥，请到「设置」页填写。');
    }

    const headers = {
      'Content-Type': 'application/json',
      'Authorization': 'Bearer ' + s.apiKey,
    };

    // —— 流式 ——
    if (body.stream) {
      return streamChat(url, headers, body, opts.onChunk, opts.signal);
    }

    // —— 非流式 ——
    const resp = await fetch(url, {
      method: 'POST',
      headers,
      body: JSON.stringify(body),
      signal: opts.signal,
    });

    if (!resp.ok) {
      const txt = await resp.text().catch(() => '');
      throw new Error(`API 错误 ${resp.status}: ${txt.slice(0, 300)}`);
    }

    const json = await resp.json();
    const content = json.choices?.[0]?.message?.content || '';
    return content;
  }

  // —— 流式处理 ——
  async function streamChat(url, headers, body, onChunk, signal) {
    const resp = await fetch(url, {
      method: 'POST',
      headers,
      body: JSON.stringify(body),
      signal,
    });

    if (!resp.ok) {
      const txt = await resp.text().catch(() => '');
      throw new Error(`API 错误 ${resp.status}: ${txt.slice(0, 300)}`);
    }

    const reader = resp.body.getReader();
    const decoder = new TextDecoder();
    let full = '';
    let buffer = '';

    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split('\n');
      buffer = lines.pop() || '';

      for (const line of lines) {
        const trimmed = line.trim();
        if (!trimmed || !trimmed.startsWith('data:')) continue;
        const data = trimmed.slice(5).trim();
        if (data === '[DONE]') continue;
        try {
          const json = JSON.parse(data);
          const delta = json.choices?.[0]?.delta?.content || '';
          if (delta) {
            full += delta;
            if (onChunk) onChunk(delta, full);
          }
        } catch (e) { /* skip */ }
      }
    }
    return full;
  }

  /**
   * 简易对话封装：自动拼 system + 历史
   */
  async function talk(systemPrompt, history, userMsg, opts = {}) {
    const messages = [{ role: 'system', content: systemPrompt }];
    for (const m of history) {
      messages.push({ role: m.role, content: m.content });
    }
    messages.push({ role: 'user', content: userMsg });
    return chat(messages, opts);
  }

  /**
   * 测试连接
   */
  async function testConnection() {
    try {
      const r = await chat(
        [{ role: 'user', content: '请回复"连接成功"四个字。' }],
        { stream: false, maxTokens: 20, temperature: 0 }
      );
      return { ok: true, msg: r };
    } catch (e) {
      return { ok: false, msg: e.message };
    }
  }

  window.API = { chat, talk, testConnection };
})();
