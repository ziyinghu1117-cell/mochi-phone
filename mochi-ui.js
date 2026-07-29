/**
 * Mochi Core - 协议解析 & 聊天引擎增强
 * 独立模块，不依赖外部框架，仅挂载到 window.MochiCore
 */
(function () {
  'use strict';

  var MochiCore = {};

  /* ===== 协议标记正则 ===== */
  // 心声标记: 【心声】xxx  或  (心声)xxx  或  <heart>xxx</heart>
  var RE_HEART = /(?:【心声】|\(心声\)|<heart>)([\s\S]*?)(?:【\/心声】|\(\/心声\)|<\/heart>|$)/;
  // 图片标记: [img:url] 或 <img-msg url="xxx">
  var RE_IMG = /\[img:(https?:\/\/[^\]\s]+)\]/g;
  var RE_IMG_TAG = /<img-msg[^>]*url=["']([^"']+)["'][^>]*>/g;
  // 表情标记: [em:xxx] 贴纸
  var RE_STICKER = /\[sticker:([a-zA-Z0-9_-]+)\]/g;
  // 语音标记: [voice:id|duration]
  var RE_VOICE = /\[voice:([a-zA-Z0-9_-]+)\|(\d+)\]/g;
  // 通话标记: [call:video|duration] 或 [call:audio|missed]
  var RE_CALL = /\[call:(video|audio)\|(\d+|missed)\]/g;
  // 红包标记: [redpacket:amount|note]
  var RE_REDPACKET = /\[redpacket:([\d.]+)\|([^\]]*)\]/g;
  // 转账标记: [transfer:amount|note]
  var RE_TRANSFER = /\[transfer:([\d.]+)\|([^\]]*)\]/g;
  // 卡片标记: <card type="xxx" title="xxx" ...>...</card>
  var RE_CARD = /<card\s+([^>]*)>([\s\S]*?)<\/card>/g;
  // 思维链标记: <think>xxx</think>
  var RE_THINK = /<think>([\s\S]*?)<\/think>/g;
  // 分段标记: --- (三条短横线分段)
  var RE_SPLIT = /\n---\n/;
  // 动作描写: （xxx）或 (xxx) 在 offline 模式
  var RE_ACTION = /^[（(]([\s\S]+?)[）)]$/;

  /* ===== 协议解析 ===== */
  MochiCore.parseContent = function (rawContent, opts) {
    opts = opts || {};
    var mode = opts.mode || 'online';
    var segments = [];
    var text = rawContent || '';

    // 1. 提取思维链（不显示在气泡中）
    var thinkMatch = RE_THINK.exec(text);
    var thinking = '';
    if (thinkMatch) {
      thinking = thinkMatch[1].trim();
      text = text.replace(RE_THINK, '').trim();
    }

    // 2. 提取心声
    var heartText = '';
    var heartMatch = RE_HEART.exec(text);
    if (heartMatch) {
      heartText = heartMatch[1].trim();
      text = text.replace(RE_HEART, '').trim();
    }

    // 3. 按分段标记拆分多条气泡
    var parts = text.split(RE_SPLIT).filter(function (s) { return s.trim(); });
    if (!parts.length) parts = [text];

    parts.forEach(function (part) {
      part = part.trim();
      if (!part) return;
      var seg = { type: 'text', content: part, extras: [] };

      // 检查是否纯动作描写
      var actionMatch = RE_ACTION.exec(part);
      if (actionMatch && mode === 'offline') {
        seg.type = 'action';
        seg.content = actionMatch[1].trim();
        segments.push(seg);
        return;
      }

      // 提取图片
      var imgs = [];
      var imgReplaced = part.replace(RE_IMG, function (m, url) {
        imgs.push(url);
        return '';
      }).replace(RE_IMG_TAG, function (m, url) {
        imgs.push(url);
        return '';
      });
      if (imgs.length) {
        seg.extras.push({ kind: 'image', urls: imgs });
      }

      // 提取贴纸
      var stickers = [];
      var stickerReplaced = imgReplaced.replace(RE_STICKER, function (m, name) {
        stickers.push(name);
        return '';
      });
      if (stickers.length) {
        seg.extras.push({ kind: 'sticker', names: stickers });
      }

      // 提取语音
      var voices = [];
      var voiceReplaced = stickerReplaced.replace(RE_VOICE, function (m, id, dur) {
        voices.push({ id: id, duration: parseInt(dur, 10) });
        return '';
      });
      if (voices.length) {
        seg.extras.push({ kind: 'voice', items: voices });
      }

      // 提取通话
      var calls = [];
      var callReplaced = voiceReplaced.replace(RE_CALL, function (m, type, info) {
        calls.push({ type: type, duration: info === 'missed' ? -1 : parseInt(info, 10) });
        return '';
      });
      if (calls.length) {
        seg.extras.push({ kind: 'call', items: calls });
      }

      // 提取红包
      var redpackets = [];
      var rpReplaced = callReplaced.replace(RE_REDPACKET, function (m, amt, note) {
        redpackets.push({ amount: parseFloat(amt), note: note });
        return '';
      });
      if (redpackets.length) {
        seg.extras.push({ kind: 'redpacket', items: redpackets });
      }

      // 提取转账
      var transfers = [];
      var tfReplaced = rpReplaced.replace(RE_TRANSFER, function (m, amt, note) {
        transfers.push({ amount: parseFloat(amt), note: note });
        return '';
      });
      if (transfers.length) {
        seg.extras.push({ kind: 'transfer', items: transfers });
      }

      // 提取卡片
      var cards = [];
      var cardReplaced = tfReplaced.replace(RE_CARD, function (m, attrs, body) {
        var cardObj = { body: body.trim() };
        attrs.replace(/(\w+)=["']([^"']+)["']/g, function (_, k, v) { cardObj[k] = v; });
        cards.push(cardObj);
        return '';
      });
      if (cards.length) {
        seg.extras.push({ kind: 'card', items: cards });
      }

      seg.content = cardReplaced.trim();
      segments.push(seg);
    });

    return {
      segments: segments,
      thinking: thinking,
      heart: heartText
    };
  };

  /* ===== HTML 安全渲染 ===== */
  MochiCore.escapeHtml = function (text) {
    return String(text)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#039;');
  };

  /* ===== 链接化 ===== */
  MochiCore.linkify = function (text) {
    var escaped = MochiCore.escapeHtml(text);
    return escaped.replace(/(https?:\/\/[^\s<]+)/g, function (url) {
      return '<a href="' + url + '" target="_blank" rel="noopener" style="color:var(--color-primary);text-decoration:underline">' + url + '</a>';
    });
  };

  /* ===== 渲染单条气泡内容 ===== */
  MochiCore.renderBubbleContent = function (seg, msg) {
    var html = '';
    var isMe = msg.role === 'user';

    // 动作描写
    if (seg.type === 'action') {
      return '<div class="mc-action-text">' + MochiCore.escapeHtml(seg.content) + '</div>';
    }

    // 文本内容
    if (seg.content) {
      html += '<div class="mc-bubble-text">' + MochiCore.linkify(seg.content) + '</div>';
    }

    // 附加内容
    seg.extras.forEach(function (extra) {
      switch (extra.kind) {
        case 'image':
          html += '<div class="mc-bubble-images">';
          extra.urls.forEach(function (url) {
            html += '<img class="mc-bubble-img" src="' + MochiCore.escapeHtml(url) + '" loading="lazy" onclick="MochiMedia.previewImage(this.src)" />';
          });
          html += '</div>';
          break;
        case 'sticker':
          html += '<div class="mc-bubble-stickers">';
          extra.names.forEach(function (name) {
            html += '<span class="mc-sticker" onclick="MochiMedia.sendSticker(\'' + name + '\')">' + MochiCore.getStickerEmoji(name) + '</span>';
          });
          html += '</div>';
          break;
        case 'voice':
          extra.items.forEach(function (v) {
            html += '<div class="mc-voice-bubble" onclick="MochiMedia.playVoice(\'' + v.id + '\', this)">' +
              '<svg class="mc-voice-icon" viewBox="0 0 24 24" width="20" height="20"><path d="M12 1a3 3 0 0 0-3 3v8a3 3 0 0 0 6 0V4a3 3 0 0 0-3-3z"/><path d="M19 10v2a7 7 0 0 1-14 0v-2M12 19v4M8 23h8" fill="none" stroke="currentColor" stroke-width="2"/></svg>' +
              '<span class="mc-voice-bar"><span class="mc-voice-bar-fill"></span></span>' +
              '<span class="mc-voice-dur">' + v.duration + '"</span></div>';
          });
          break;
        case 'call':
          extra.items.forEach(function (c) {
            var isVideo = c.type === 'video';
            var icon = isVideo ? 'M23 7l-7 5 7 5V7z" fill="none" stroke="currentColor" stroke-width="2"/><rect x="1" y="5" width="15" height="14" rx="2" fill="none" stroke="currentColor" stroke-width="2' : 'M22 16.92v3a2 2 0 0 1-2.18 2 19.79 19.79 0 0 1-8.63-3.07 19.5 19.5 0 0 1-6-6 19.79 19.79 0 0 1-3.07-8.67A2 2 0 0 1 4.11 2h3a2 2 0 0 1 2 1.72c.13.96.37 1.9.7 2.81a2 2 0 0 1-.45 2.11L8.09 9.91a16 16 0 0 0 6 6l1.27-1.27a2 2 0 0 1 2.11-.45c.91.33 1.85.57 2.81.7A2 2 0 0 1 22 16.92z';
            var label = c.duration < 0 ? '未接听' : MochiCore.formatDuration(c.duration);
            html += '<div class="mc-call-bubble">' +
              '<svg viewBox="0 0 24 24" width="22" height="22"><path d="' + icon + '"/></svg>' +
              '<div class="mc-call-info"><span>' + (isVideo ? '视频通话' : '语音通话') + '</span><span class="mc-call-dur">' + label + '</span></div>' +
              (c.duration < 0 ? '' : '<button class="mc-call-callback" onclick="MochiMedia.startCall(\'' + c.type + '\')">回拨</button>') +
              '</div>';
          });
          break;
        case 'redpacket':
          extra.items.forEach(function (rp) {
            html += '<div class="mc-redpacket-bubble" onclick="MochiSocial.openRedpacket(this, ' + rp.amount + ', \'' + MochiCore.escapeHtml(rp.note) + '\')">' +
              '<div class="mc-rp-icon">$</div>' +
              '<div class="mc-rp-info"><span>红包</span><small>' + MochiCore.escapeHtml(rp.note || '恭喜发财') + '</small></div>' +
              '</div>';
          });
          break;
        case 'transfer':
          extra.items.forEach(function (tf) {
            html += '<div class="mc-transfer-bubble">' +
              '<div class="mc-tf-amount">$' + tf.amount + '</div>' +
              '<div class="mc-tf-note">' + MochiCore.escapeHtml(tf.note || '转账') + '</div>' +
              '</div>';
          });
          break;
        case 'card':
          extra.items.forEach(function (card) {
            html += '<div class="mc-card-bubble" data-type="' + MochiCore.escapeHtml(card.type || '') + '">' +
              (card.title ? '<div class="mc-card-title">' + MochiCore.escapeHtml(card.title) + '</div>' : '') +
              '<div class="mc-card-body">' + MochiCore.escapeHtml(card.body) + '</div>' +
              '</div>';
          });
          break;
      }
    });

    return html || '&nbsp;';
  };

  /* ===== 工具函数 ===== */
  MochiCore.formatDuration = function (seconds) {
    if (seconds < 60) return seconds + '秒';
    var m = Math.floor(seconds / 60);
    var s = seconds % 60;
    return m + ':' + (s < 10 ? '0' : '') + s;
  };

  MochiCore.getStickerEmoji = function (name) {
    var map = {
      smile: '😊', laugh: '😄', love: '😍', cry: '😢', angry: '😡',
      surprise: '😮', wink: '😉', cool: '😎', shy: '😊', sweat: '😅',
      ok: '👌', thumbsup: '👍', heart: '❤️', broken: '💔', fire: '🔥',
      star: '⭐', cake: '🎂', gift: '🎁', flower: '🌸', kiss: '😘',
      hug: '🤗', wave: '👋', clap: '👏', pray: '🙏', muscle: '💪',
      sleep: '😴', think: '🤔', dizzy: '😵', ghost: '👻', cat: '🐱'
    };
    return map[name] || ' [' + name + '] ';
  };

  /* ===== 增强渲染：替换原有 renderMessages 的气泡生成 ===== */
  MochiCore.enhanceRender = function () {
    if (!window.sendMessage || !window.renderMessages) return;
    // 标记已增强
    if (window._mochiEnhanced) return;
    window._mochiEnhanced = true;

    // 保存原始渲染函数
    var _origRender = window.renderMessages;

    window.renderMessages = function () {
      // 先调用原始渲染
      _origRender.call(this);

      // 然后增强：遍历每条 AI 消息，解析协议并替换内容
      var list = document.getElementById('messageList');
      if (!list) return;

      var role = window.activeRole ? window.activeRole() : null;
      var mode = (window.state && window.state.chatMode) || 'online';
      var messages = role && window.getMessages ? window.getMessages(role.id) : [];

      list.querySelectorAll('[data-msg-id]').forEach(function (row) {
        var msgId = row.getAttribute('data-msg-id');
        var msg = messages.find(function (m) { return m.id === msgId; });
        if (!msg || msg.role === 'user') return;
        if (row.getAttribute('data-mc-parsed')) return;
        row.setAttribute('data-mc-parsed', '1');

        var bubble = row.querySelector('.qq-room__bubble');
        if (!bubble) return;

        var parsed = MochiCore.parseContent(msg.content, { mode: mode });
        if (!parsed.segments.length && !parsed.heart) return;

        // 渲染多段气泡
        var html = '';
        parsed.segments.forEach(function (seg, idx) {
          if (idx > 0) html += '<div class="mc-bubble-divider"></div>';
          html += MochiCore.renderBubbleContent(seg, msg);
        });

        // 心声
        if (parsed.heart) {
          html += '<div class="mc-heart-voice" onclick="MochiSocial.showHeartVoice(\'' + (role ? role.id : '') + '\')">' +
            '<svg viewBox="0 0 24 24" width="14" height="14"><path d="M12 21l-1.45-1.32C5.4 15.36 2 12.28 2 8.5 2 5.42 4.42 3 7.5 3c1.74 0 3.41.81 4.5 2.09C13.09 3.81 14.76 3 16.5 3 19.58 3 22 5.42 22 8.5c0 3.78-3.4 6.86-8.55 11.18L12 21z" fill="currentColor"/></svg>' +
            '<span>' + MochiCore.escapeHtml(parsed.heart) + '</span></div>';
        }

        if (html.trim()) {
          bubble.innerHTML = html;
        }
      });
    };

    // 增强 sendMessage：在发送前注入规则和设置
    var _origSend = window.sendMessage;
    if (_origSend) {
      window.sendMessage = async function (event) {
        // 在发送前可以注入额外的上下文
        if (window.MochiAI && window.MochiAI.beforeSend) {
          await window.MochiAI.beforeSend();
        }
        return _origSend.call(this, event);
      };
    }
  };

  /* ===== 数据存储封装 ===== */
  MochiCore.store = {
    get: function (key, def) {
      try {
        var v = localStorage.getItem('mc_' + key);
        return v ? JSON.parse(v) : (def !== undefined ? def : null);
      } catch (e) { return def !== undefined ? def : null; }
    },
    set: function (key, val) {
      try { localStorage.setItem('mc_' + key, JSON.stringify(val)); } catch (e) {}
    },
    remove: function (key) {
      try { localStorage.removeItem('mc_' + key); } catch (e) {}
    }
  };

  /* ===== API 封装 ===== */
  MochiCore.api = {
    post: function (url, body) {
      return fetch('/api' + url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'x-session-token': localStorage.getItem('mochi_auth_token') || '' },
        body: JSON.stringify(body || {})
      }).then(function (r) { return r.json(); });
    },
    get: function (url) {
      return fetch('/api' + url, {
        headers: { 'x-session-token': localStorage.getItem('mochi_auth_token') || '' }
      }).then(function (r) { return r.json(); });
    },
    put: function (url, body) {
      return fetch('/api' + url, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json', 'x-session-token': localStorage.getItem('mochi_auth_token') || '' },
        body: JSON.stringify(body || {})
      }).then(function (r) { return r.json(); });
    },
    del: function (url) {
      return fetch('/api' + url, {
        method: 'DELETE',
        headers: { 'x-session-token': localStorage.getItem('mochi_auth_token') || '' }
      }).then(function (r) { return r.json(); });
    }
  };

  /* ===== Toast ===== */
  MochiCore.toast = function (msg) {
    if (window.toast) { window.toast(msg); return; }
    var t = document.createElement('div');
    t.textContent = msg;
    t.style.cssText = 'position:fixed;bottom:80px;left:50%;transform:translateX(-50%);background:rgba(0,0,0,0.75);color:#fff;padding:8px 20px;border-radius:20px;font-size:13px;z-index:99999;pointer-events:none;transition:opacity .3s';
    document.body.appendChild(t);
    setTimeout(function () { t.style.opacity = '0'; setTimeout(function () { t.remove(); }, 300); }, 2500);
  };

  /* ===== 初始化 ===== */
  MochiCore.init = function () {
    MochiCore.enhanceRender();
    // 通知其他模块核心已就绪
    window.dispatchEvent(new CustomEvent('mochi:core-ready'));
  };

  window.MochiCore = MochiCore;

  // 自动初始化（等 DOM 就绪后）
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', MochiCore.init);
  } else {
    MochiCore.init();
  }
})();
