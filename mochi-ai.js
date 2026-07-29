/**
 * Mochi AI - AI Behavior Module
 * Self-contained IIFE that attaches to window.MochiAI.
 *
 * Features:
 *   1. Memory extraction  – keyword-based extraction after each AI reply
 *   2. Conversation summary – auto-summarize when history exceeds threshold
 *   3. Time awareness – inject current date/time into system prompts
 *   4. Proactive messages – periodic background messages from the AI character
 *   5. Rule system – load/save thinking-chain & output-format rule presets
 *
 * Depends on globals from the host app (MochiCore, api, state, activeRole,
 * getMessages, persist, renderMessages, toast, uuid, appendTyping, …).
 * Globals are resolved at call-time so the module works whether or not the
 * host attaches them to `window`.
 */
(function () {
  'use strict';

  if (window.MochiAI) return; // guard against double-init

  var MochiAI = {};

  /* ================================================================
   * Global Resolver
   * The host app declares functions as top-level `const`, which are
   * accessible to other scripts in the global scope but are NOT
   * properties of `window`.  This resolver tries `window[name]`
   * first, then falls back to an indirect eval in the global scope.
   * ================================================================ */
  function resolveGlobal(name) {
    if (typeof window[name] !== 'undefined') return window[name];
    try { return (0, eval)(name); } catch (e) { return undefined; }
  }

  /** Safely call a function that may not exist. */
  function safeCall(fn) {
    if (typeof fn !== 'function') return undefined;
    var args = Array.prototype.slice.call(arguments, 1);
    try { return fn.apply(null, args); } catch (e) { return undefined; }
  }

  /* ================================================================
   * Defaults
   * ================================================================ */
  var DEFAULT_SETTINGS = {
    timeAwareness: true,
    memoryCount: 20,
    summaryTrigger: 30,
    backgroundMessage: true
  };

  var DEFAULT_RULES = {
    thinking: [
      { id: 'default', name: 'Default Thinking Chain', content: '', enabled: true }
    ],
    operation: [
      { id: 'op1', name: 'Three-Part Output', content: 'thinking -> main text -> heart voice', enabled: true },
      { id: 'op2', name: 'Stay in Character', content: 'Always stay in character as the role', enabled: true },
      { id: 'op3', name: 'Read Full Context', content: 'Review all conversation history before replying', enabled: true }
    ]
  };

  /* ================================================================
   * Internal State
   * ================================================================ */
  var settings = mergeDefaults({}, DEFAULT_SETTINGS);
  var rules = { thinking: [], operation: [] };
  var summaries = {};            // { roleId: summaryString }
  var lastSummarizedCount = {};  // { roleId: number }
  var proactiveTimer = null;
  var proactiveInProgress = false;
  var initialized = false;

  function mergeDefaults(target, source) {
    target = target || {};
    for (var k in source) {
      if (source.hasOwnProperty(k) && target[k] === undefined) target[k] = source[k];
    }
    return target;
  }

  /* ================================================================
   * 3. Time Awareness
   * ================================================================ */

  /**
   * Returns a human-readable time-context block for injection into prompts.
   * @returns {string}
   */
  MochiAI.getTimeContext = function () {
    var now = new Date();
    var days = ['Sunday', 'Monday', 'Tuesday', 'Wednesday',
                'Thursday', 'Friday', 'Saturday'];
    var dateStr = now.toLocaleDateString('en-US', {
      year: 'numeric', month: 'long', day: 'numeric'
    });
    var timeStr = now.toLocaleTimeString('en-US', {
      hour: '2-digit', minute: '2-digit'
    });
    var h = now.getHours();
    var period;
    if (h < 5) period = 'late night';
    else if (h < 12) period = 'morning';
    else if (h < 17) period = 'afternoon';
    else if (h < 21) period = 'evening';
    else period = 'night';

    return '[Time Context]\n' +
      'Date: ' + dateStr + ' (' + days[now.getDay()] + ')\n' +
      'Time: ' + timeStr + '\n' +
      'Period: ' + period;
  };

  /* ================================================================
   * 1. Memory Extraction
   * ================================================================ */

  /** Keyword patterns for memory extraction. */
  var MEMORY_PATTERNS = [
    { re: /(?:I|we)\s+(?:really\s+)?(?:like|love|enjoy|prefer|hate|dislike)\s+([^.,!?;\n]{2,60})/gi, type: 'preference' },
    { re: /(?:my name is|call me|I am|I'm)\s+([^.,!?;\n]{2,40})/gi, type: 'identity' },
    { re: /(?:my birthday is|birthday'?s on|born on)\s+([^.,!?;\n]{2,40})/gi, type: 'birthday' },
    { re: /(?:I live in|I'm from|I'm in|my city is|my hometown is)\s+([^.,!?;\n]{2,40})/gi, type: 'location' },
    { re: /(?:I work at|I study at|my job is|I go to|I attend)\s+([^.,!?;\n]{2,50})/gi, type: 'occupation' },
    { re: /(?:we are|we've been|our anniversary|we started|we met|we became)\s+([^.,!?;\n]{2,60})/gi, type: 'relationship' },
    { re: /(?:today is|tomorrow is|yesterday was|next week is|this weekend)\s+([^.,!?;\n]{2,60})/gi, type: 'event' },
    { re: /(?:remember that|don't forget|it'?s important|note that|keep in mind)\s+([^.,!?;\n]{2,80})/gi, type: 'important' }
  ];

  /**
   * Extract key memories from text using keyword-based pattern matching.
   * @param {string} text - Input text (typically the user's message).
   * @returns {Array<{type:string, content:string, createdAt:string}>}
   */
  MochiAI.extractMemory = function (text) {
    if (!text || typeof text !== 'string') return [];
    var memories = [];
    var limit = settings.memoryCount || 20;

    for (var i = 0; i < MEMORY_PATTERNS.length && memories.length < limit; i++) {
      var m;
      MEMORY_PATTERNS[i].re.lastIndex = 0; // reset regex state
      while ((m = MEMORY_PATTERNS[i].re.exec(text)) !== null) {
        var content = (m[1] || '').trim();
        if (content && content.length >= 2 && memories.length < limit) {
          memories.push({
            type: MEMORY_PATTERNS[i].type,
            content: content,
            createdAt: new Date().toISOString()
          });
        }
      }
    }
    return memories;
  };

  /** Extract memories from both user and AI text, then persist via API. */
  function extractAndSaveMemories(role, userText, aiText) {
    var memories = MochiAI.extractMemory(userText);
    if (!memories.length) return;

    var apiObj = resolveGlobal('api');
    var createMemory = apiObj ? apiObj.createMemory : null;

    // Fallback to MochiCore.api.post
    if (typeof createMemory !== 'function') {
      var mc = window.MochiCore;
      if (mc && mc.api) {
        createMemory = function (payload) { return mc.api.post('/memories', payload); };
      }
    }
    if (typeof createMemory !== 'function') return;

    memories.forEach(function (mem) {
      try {
        var p = createMemory({
          roleId: role.id || '',
          roleName: role.name || '',
          type: mem.type,
          content: mem.content,
          source: 'auto',
          sourceConversationId: role.id || '',
          sourceMessageIds: []
        });
        if (p && typeof p.catch === 'function') p.catch(function () {});
      } catch (e) { /* ignore individual failures */ }
    });
  }

  /* ================================================================
   * Heart Voice Extraction & API
   * ================================================================ */

  /** Heart-voice markers used by the protocol parser. */
  var RE_HEART = /(?:【心声】|\(心声\)|<heart>)([\s\S]*?)(?:【\/心声】|\(\/心声\)|<\/heart>|$)/;

  /** Extract heart-voice text from an AI reply. */
  function extractHeartVoice(aiText) {
    if (!aiText) return '';
    // Prefer MochiCore.parseContent when available
    var mc = window.MochiCore;
    if (mc && typeof mc.parseContent === 'function') {
      var parsed = mc.parseContent(aiText);
      if (parsed && parsed.heart) return parsed.heart;
    }
    // Fallback: direct regex
    var m = RE_HEART.exec(aiText);
    return m ? (m[1] || '').trim() : '';
  }

  /**
   * Save a heart voice entry for a role.
   * @param {string} roleId
   * @param {string} text
   */
  MochiAI.saveHeartVoice = function (roleId, text) {
    if (!roleId || !text) return;
    var mc = window.MochiCore;
    if (mc && mc.api) {
      var p = mc.api.post('/heartvoices/' + encodeURIComponent(roleId), { text: String(text).slice(0, 500) });
      if (p && typeof p.catch === 'function') p.catch(function () {});
    }
  };

  /**
   * Get heart voices for a role.
   * @param {string} roleId
   * @returns {Promise<Array>}
   */
  MochiAI.getHeartVoices = function (roleId) {
    var mc = window.MochiCore;
    if (mc && mc.api) {
      return mc.api.get('/heartvoices/' + encodeURIComponent(roleId)).then(function (res) {
        return (res && res.list) || [];
      }).catch(function () { return []; });
    }
    return Promise.resolve([]);
  };

  /* ================================================================
   * 2. Conversation Summary
   * ================================================================ */

  /**
   * Call the summary API for a set of messages.
   * @param {Array<{role:string,content:string}>} messages
   * @returns {Promise<{summary:string, messageCount:number}>}
   */
  MochiAI.generateSummary = function (messages) {
    if (!messages || !messages.length) {
      return Promise.resolve({ summary: '', messageCount: 0 });
    }
    var mc = window.MochiCore;
    if (mc && mc.api) {
      return mc.api.post('/chat/summary', { messages: messages })
        .catch(function () { return { summary: '', messageCount: messages.length }; });
    }
    return Promise.resolve({ summary: '', messageCount: messages.length });
  };

  /** Check if conversation exceeds the summary trigger and auto-summarize. */
  function checkSummaryTrigger(role) {
    var trigger = settings.summaryTrigger || 30;
    var messages = safeCall(resolveGlobal('getMessages'), role.id) || [];
    if (messages.length <= trigger) return;

    // Keep the most recent 10 messages for immediate context; summarize the rest.
    var KEEP_RECENT = 10;
    var olderCount = messages.length - KEEP_RECENT;
    var alreadySummarized = lastSummarizedCount[role.id] || 0;
    if (olderCount <= alreadySummarized) return; // nothing new to summarize

    var toSummarize = messages.slice(alreadySummarized, olderCount).map(function (m) {
      return { role: m.role, content: m.content };
    });

    MochiAI.generateSummary(toSummarize).then(function (result) {
      if (!result || !result.summary) return;
      var existing = summaries[role.id] || '';
      summaries[role.id] = (existing ? existing + '\n' : '') + result.summary;
      lastSummarizedCount[role.id] = olderCount;
      // Persist locally
      var mc = window.MochiCore;
      if (mc && mc.store) {
        mc.store.set('ai_summaries', summaries);
        mc.store.set('ai_summary_counts', lastSummarizedCount);
      }
    }).catch(function () { /* silent */ });
  }

  /* ================================================================
   * 5. Rule System + System Prompt Building
   * ================================================================ */

  /**
   * Build an enhanced system prompt for a role.
   * Combines the base role prompt with time context, conversation
   * summary, thinking rules, and output-format rules.
   * @param {{id:string, name:string, prompt:string}} role
   * @returns {string}
   */
  MochiAI.buildSystemPrompt = function (role) {
    if (!role) return '';
    var parts = [];

    // 1. Base role prompt
    if (role.prompt) parts.push(role.prompt);

    // 2. Time awareness
    if (settings.timeAwareness) {
      parts.push(MochiAI.getTimeContext());
    }

    // 3. Conversation summary (if available)
    var summary = summaries[role.id];
    if (summary) {
      parts.push('[Conversation Summary]\n' + summary);
    }

    // 4. Thinking-chain rules (enabled only)
    var thinkingRules = (rules.thinking || []).filter(function (r) {
      return r.enabled && r.content;
    });
    if (thinkingRules.length) {
      parts.push('[Thinking Rules]\n' +
        thinkingRules.map(function (r) { return '- ' + r.content; }).join('\n'));
    }

    // 5. Output-format rules (enabled only)
    var opRules = (rules.operation || []).filter(function (r) {
      return r.enabled && r.content;
    });
    if (opRules.length) {
      parts.push('[Output Rules]\n' +
        opRules.map(function (r) { return '- ' + r.content; }).join('\n'));
    }

    return parts.filter(Boolean).join('\n\n');
  };

  /* ================================================================
   * beforeSend / afterReceive
   * ================================================================ */

  /**
   * Called before sending a message.
   * Returns the enhanced system prompt and time context for the
   * current role.  The actual prompt injection is handled by the
   * streamChat wrapper (see hookStreamChat), so this method is
   * primarily for manual / external callers.
   * @returns {{systemPrompt:string, timeContext:string, role:object}|null}
   */
  MochiAI.beforeSend = function () {
    var role = safeCall(resolveGlobal('activeRole'));
    if (!role) return null;
    var prompt = MochiAI.buildSystemPrompt(role);
    return {
      systemPrompt: prompt,
      timeContext: settings.timeAwareness ? MochiAI.getTimeContext() : '',
      role: role
    };
  };

  /**
   * Called after an AI reply is received.
   * Extracts memories, saves heart voice, and checks the summary trigger.
   * @param {{id:string,name:string}} role
   * @param {string} userMsg  – the user's message text
   * @param {string} aiReply   – the AI's reply text
   */
  MochiAI.afterReceive = function (role, userMsg, aiReply) {
    if (!role || (!userMsg && !aiReply)) return;

    // 1. Extract and save memories from the user's message
    try { extractAndSaveMemories(role, userMsg || '', aiReply || ''); } catch (e) {}

    // 2. Save heart voice (if present in the AI reply)
    try {
      var heart = extractHeartVoice(aiReply);
      if (heart) MochiAI.saveHeartVoice(role.id, heart);
    } catch (e) {}

    // 3. Check conversation summary trigger
    try { checkSummaryTrigger(role); } catch (e) {}
  };

  /* ================================================================
   * Settings Load / Save
   * ================================================================ */

  /** Load chat settings from local store (sync) then API (async). */
  MochiAI.loadSettings = function () {
    var mc = window.MochiCore;

    // 1. Local store (immediate)
    if (mc && mc.store) {
      var stored = mc.store.get('chatSettings');
      if (stored && stored.global) {
        settings = mergeDefaults(stored.global, mergeDefaults({}, DEFAULT_SETTINGS));
      } else if (stored) {
        settings = mergeDefaults(stored, mergeDefaults({}, DEFAULT_SETTINGS));
      }
    }

    // 2. API (async override)
    if (mc && mc.api) {
      mc.api.get('/chat-settings').then(function (res) {
        if (res && res.global) {
          settings = mergeDefaults(res.global, mergeDefaults({}, DEFAULT_SETTINGS));
          if (mc.store) mc.store.set('chatSettings', res);
        }
      }).catch(function () { /* use stored/defaults */ });
    }
    return settings;
  };

  /**
   * Save chat settings to local store and API.
   * @param {object} [newSettings] – optional new settings to merge
   */
  MochiAI.saveSettings = function (newSettings) {
    if (newSettings) {
      settings = mergeDefaults(newSettings, mergeDefaults({}, DEFAULT_SETTINGS));
    }
    var data = { global: settings, perContact: {} };
    var mc = window.MochiCore;
    if (mc && mc.store) mc.store.set('chatSettings', data);
    if (mc && mc.api) {
      var p = mc.api.put('/chat-settings', data);
      if (p && typeof p.catch === 'function') p.catch(function () {});
    }
  };

  /* ================================================================
   * Rules Load / Save
   * ================================================================ */

  /** Load rule presets from local store (sync) then API (async). */
  MochiAI.loadRules = function () {
    var mc = window.MochiCore;

    // 1. Local store (immediate)
    if (mc && mc.store) {
      var stored = mc.store.get('rulePresets');
      if (stored) {
        rules = {
          thinking: stored.thinking || [],
          operation: stored.operation || []
        };
      }
    }

    // 2. API (async override)
    if (mc && mc.api) {
      mc.api.get('/rule-presets').then(function (res) {
        if (res) {
          rules = {
            thinking: res.thinking || [],
            operation: res.operation || []
          };
          if (mc.store) mc.store.set('rulePresets', rules);
        }
      }).catch(function () { /* use stored/defaults */ });
    }
    return rules;
  };

  /**
   * Save rule presets to local store and API.
   * @param {object} [newRules] – optional new rules {thinking, operation}
   */
  MochiAI.saveRules = function (newRules) {
    if (newRules) {
      rules = {
        thinking: newRules.thinking || [],
        operation: newRules.operation || []
      };
    }
    var mc = window.MochiCore;
    if (mc && mc.store) mc.store.set('rulePresets', rules);
    if (mc && mc.api) {
      var p = mc.api.put('/rule-presets', rules);
      if (p && typeof p.catch === 'function') p.catch(function () {});
    }
  };

  /* ================================================================
   * 4. Proactive Messages
   * ================================================================ */

  /**
   * Schedule the next proactive background message.
   * Uses a random delay of 2-5 minutes.  Clears any existing timer.
   */
  MochiAI.scheduleProactiveMessage = function () {
    if (proactiveTimer) {
      clearTimeout(proactiveTimer);
      proactiveTimer = null;
    }
    if (!settings.backgroundMessage) return;

    // Random 2-5 minute delay
    var delay = (2 + Math.random() * 3) * 60 * 1000;

    proactiveTimer = setTimeout(function () {
      MochiAI._sendProactiveMessage()
        .then(function () { MochiAI.scheduleProactiveMessage(); })
        .catch(function () { MochiAI.scheduleProactiveMessage(); });
    }, delay);
  };

  /**
   * Generate and deliver a single proactive message from the AI character.
   * @returns {Promise<void>}
   * @private
   */
  MochiAI._sendProactiveMessage = function () {
    return new Promise(function (resolve) {

      // --- Pre-condition checks ---
      if (!settings.backgroundMessage) { resolve(); return; }
      if (proactiveInProgress) { resolve(); return; }

      var state = resolveGlobal('state');
      if (!state) { resolve(); return; }

      // Only send proactive messages in online mode
      if ((state.chatMode || 'online') !== 'online') { resolve(); return; }

      // Skip if AI is currently replying
      var isReplying = resolveGlobal('isReplying');
      if (isReplying) { resolve(); return; }

      var role = safeCall(resolveGlobal('activeRole'));
      if (!role || !role.id) { resolve(); return; }

      var apiObj = resolveGlobal('api');
      if (!apiObj || typeof apiObj.streamChat !== 'function') { resolve(); return; }

      var messages = safeCall(resolveGlobal('getMessages'), role.id) || [];

      // Skip if last message was less than 1 minute ago
      if (messages.length > 0) {
        var last = messages[messages.length - 1];
        if (last && last.createdAt && (Date.now() - last.createdAt) < 60000) {
          resolve();
          return;
        }
      }

      // --- Create assistant message placeholder ---
      proactiveInProgress = true;
      var uuidFn = resolveGlobal('uuid');
      var msgId = typeof uuidFn === 'function'
        ? uuidFn()
        : 'proactive-' + Date.now() + '-' + Math.random().toString(16).slice(2);

      var assistantMessage = {
        id: msgId,
        role: 'assistant',
        content: '',
        createdAt: Date.now(),
        proactive: true
      };
      messages.push(assistantMessage);

      // --- UI helpers ---
      var persistFn = resolveGlobal('persist');
      var renderFn = resolveGlobal('renderMessages');
      var appendTypingFn = resolveGlobal('appendTyping');
      var removeTypingFn = resolveGlobal('removeTyping');

      if (typeof appendTypingFn === 'function') appendTypingFn();
      if (typeof renderFn === 'function') renderFn();

      // --- Build proactive prompt ---
      var enhancedPrompt = MochiAI.buildSystemPrompt(role);
      enhancedPrompt += '\n\n[Proactive Message Instruction]\n' +
        'Based on the current time of day and your relationship with the user, ' +
        'initiate a natural, spontaneous message. Do not wait for the user to ' +
        'speak first. Reference the time of day, recent topics, or your shared ' +
        'history to make the message feel organic and in-character.';

      var recentMessages = messages
        .filter(function (m) { return m.content; })
        .slice(-10)
        .map(function (m) { return { role: m.role, content: m.content }; });

      // --- Cleanup helper ---
      function cleanup() {
        proactiveInProgress = false;
        if (!assistantMessage.content.trim()) {
          var idx = messages.indexOf(assistantMessage);
          if (idx > -1) messages.splice(idx, 1);
        }
        if (typeof removeTypingFn === 'function') removeTypingFn();
        if (typeof persistFn === 'function') persistFn();
        if (typeof renderFn === 'function') renderFn();
      }

      // --- Stream the proactive message ---
      try {
        var streamPromise = apiObj.streamChat({
          roleId: role.id,
          conversationId: role.id,
          roleName: role.name,
          rolePrompt: enhancedPrompt,
          sourceMessageIds: [],
          worldBookIds: role.worldBookIds || [],
          chatMode: state.chatMode || 'online',
          messages: recentMessages,
          proactive: true
        }, {
          delta: function (data) {
            if (data && data.content) {
              assistantMessage.content += data.content;
              if (typeof persistFn === 'function') persistFn();
              if (typeof renderFn === 'function') renderFn();
            }
          },
          error: function (data) {
            if (!assistantMessage.content.trim() && data && data.message) {
              assistantMessage.content = '';
            }
          }
        }, null);

        if (streamPromise && typeof streamPromise.then === 'function') {
          streamPromise.then(cleanup).catch(cleanup);
        } else {
          cleanup();
        }
        resolve();
      } catch (e) {
        cleanup();
        resolve();
      }
    });
  };

  /* ================================================================
   * Stream Chat Hook
   *
   * Wraps api.streamChat to:
   *   - Inject the enhanced system prompt (time + rules) before chat
   *   - Capture the full AI response during streaming
   *   - Call afterReceive after the chat completes
   *
   * This works by modifying a property on the `api` object (which is
   * a const but whose properties are mutable).
   * ================================================================ */
  function hookStreamChat() {
    var apiObj = resolveGlobal('api');
    if (!apiObj || typeof apiObj.streamChat !== 'function') return false;
    if (apiObj._mochiAIHooked) return true;

    apiObj._mochiAIHooked = true;
    var origStreamChat = apiObj.streamChat;

    apiObj.streamChat = async function (payload, handlers, signal) {
      // --- BEFORE: Inject enhanced prompt (skip for proactive messages) ---
      if (payload && payload.rolePrompt && !payload.proactive) {
        var role = {
          id: payload.roleId,
          name: payload.roleName,
          prompt: payload.rolePrompt
        };
        var enhanced = MochiAI.buildSystemPrompt(role);
        if (enhanced) payload.rolePrompt = enhanced;
      }

      // --- Wrap handlers to capture full response ---
      var fullResponse = '';
      var wrappedHandlers = {};
      if (handlers) {
        for (var key in handlers) {
          if (handlers.hasOwnProperty(key)) wrappedHandlers[key] = handlers[key];
        }
      }
      var origDelta = handlers && handlers.delta;
      wrappedHandlers.delta = function (data) {
        if (data && data.content) fullResponse += data.content;
        if (typeof origDelta === 'function') origDelta(data);
      };

      // --- Call original streamChat ---
      try {
        await origStreamChat.call(apiObj, payload, wrappedHandlers, signal);

        // --- AFTER: Call afterReceive (skip for proactive messages) ---
        if (!payload.proactive && fullResponse) {
          var postRole = {
            id: payload.roleId,
            name: payload.roleName,
            prompt: payload.rolePrompt
          };
          // Find the last user message from the payload
          var userMsg = '';
          var msgs = payload.messages || [];
          for (var i = msgs.length - 1; i >= 0; i--) {
            if (msgs[i].role === 'user') {
              userMsg = msgs[i].content;
              break;
            }
          }
          if (userMsg) {
            try { MochiAI.afterReceive(postRole, userMsg, fullResponse); }
            catch (e) { /* never let afterReceive break the chat */ }
          }
        }
      } finally {
        // Always reschedule proactive messages after a chat completes
        MochiAI.scheduleProactiveMessage();
      }
    };

    return true;
  }

  /* ================================================================
   * Initialization
   * ================================================================ */

  /**
   * Initialize the MochiAI module.
   * Loads settings/rules, restores summaries, hooks streamChat,
   * and starts the proactive message scheduler.
   */
  MochiAI.init = function () {
    if (initialized) return;
    initialized = true;

    // Load settings and rules (store first, then API)
    MochiAI.loadSettings();
    MochiAI.loadRules();

    // Restore saved summaries
    var mc = window.MochiCore;
    if (mc && mc.store) {
      var savedSummaries = mc.store.get('ai_summaries');
      if (savedSummaries) summaries = savedSummaries;
      var savedCounts = mc.store.get('ai_summary_counts');
      if (savedCounts) lastSummarizedCount = savedCounts;
    }

    // Hook streamChat (retry if api not yet available)
    var retries = 0;
    (function tryHook() {
      if (hookStreamChat()) return;
      if (retries < 12) {
        retries++;
        setTimeout(tryHook, 500);
      }
    })();

    // Start proactive message scheduler
    MochiAI.scheduleProactiveMessage();

    // Notify other modules
    window.dispatchEvent(new CustomEvent('mochi:ai-ready'));
  };

  /* ================================================================
   * Attach & Auto-init
   * ================================================================ */
  window.MochiAI = MochiAI;

  function autoInit() {
    if (window.MochiCore) {
      MochiAI.init();
    } else {
      // Wait for MochiCore to be ready
      var once = false;
      function doInit() {
        if (once) return;
        once = true;
        setTimeout(MochiAI.init, 50);
      }
      window.addEventListener('mochi:core-ready', doInit, { once: true });
      // Fallback timeout
      setTimeout(doInit, 1500);
    }
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', autoInit);
  } else {
    autoInit();
  }
})();
