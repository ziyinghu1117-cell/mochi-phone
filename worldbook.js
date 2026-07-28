/**
 * worldbook.js — 世界书引擎 + 记忆沉淀
 *
 * 世界书（World Book / Lorebook）：定义世界设定、角色、规则、地点等。
 * 当关键词在上下文中出现时，对应条目自动注入 system prompt。
 *
 * 记忆沉淀：对话结束后让 AI 提取关键记忆（偏好/事件），持久化并在后续注入。
 */
(function () {
  'use strict';

  // ============ 世界书 ============

  /**
   * 构建完整的 system prompt
   * @param {Object} char       角色定义 {name, persona, greeting, scenario}
   * @param {Object} worldBook  世界书 {entries:[], globalSetting}
   * @param {Array}  memories   记忆列表 [{category, content}]
   * @param {Array}  recentMsgs 最近几条消息 [{role, content}]
   * @param {Object} extra      额外指令
   */
  function buildSystemPrompt(char, worldBook, memories, recentMsgs, extra) {
    const parts = [];

    // 1. 角色核心定义
    if (char) {
      parts.push('## 你的身份');
      let charBlock = `你是「${char.name}」。`;
      if (char.persona) charBlock += '\n' + char.persona;
      if (char.scenario) charBlock += '\n\n## 当前场景\n' + char.scenario;
      if (char.greeting) charBlock += '\n\n## 开场白\n' + char.greeting;
      if (char.exampleDialogue) charBlock += '\n\n## 对话示例\n' + char.exampleDialogue;
      parts.push(charBlock);
    }

    // 2. 世界书全局设定（constant）
    if (worldBook && worldBook.globalSetting) {
      parts.push('## 世界设定\n' + worldBook.globalSetting);
    }

    // 3. 世界书条目（关键词匹配）
    if (worldBook && worldBook.entries && worldBook.entries.length) {
      const ctx = (recentMsgs || []).map(m => m.content || '').join('\n');
      const matched = matchEntries(worldBook.entries, ctx, char);
      if (matched.length) {
        parts.push('## 世界书条目（关键词触发）');
        for (const e of matched) {
          parts.push(`### ${e.title || '条目'}\n${e.content}`);
        }
      }
    }

    // 4. 记忆
    if (memories && memories.length) {
      const memText = memories.slice(-15).map(m =>
        `- [${m.category || '记忆'}] ${m.content}`
      ).join('\n');
      parts.push('## 关于用户的记忆（请在对话中自然体现）\n' + memText);
    }

    // 5. 额外指令
    if (extra) {
      if (extra.style) parts.push('## 写作风格\n' + extra.style);
      if (extra.rules) parts.push('## 规则\n' + extra.rules);
    }

    // 6. 通用行为规则
    parts.push(
      '## 行为准则\n' +
      '- 始终保持角色一致性，不要出戏。\n' +
      '- 用生动、有画面感的文字描写，避免干巴巴的陈述。\n' +
      '- 主动推动情节，不要只是被动回答。\n' +
      '- 每次回复控制在 200-500 字，除非用户要求更长。'
    );

    return parts.join('\n\n');
  }

  /**
   * 关键词匹配
   */
  function matchEntries(entries, context, char) {
    const ctx = (context || '').toLowerCase();
    const charText = char ? (char.name + ' ' + (char.persona || '')).toLowerCase() : '';
    const full = ctx + ' ' + charText;

    const matched = entries.filter(e => {
      if (!e.enabled) return false;
      if (e.constant) return true; // 常驻条目
      if (!e.keywords || !e.keywords.length) return false;
      return e.keywords.some(kw => kw.trim() && full.includes(kw.trim().toLowerCase()));
    });

    // 按优先级排序（高优先）
    matched.sort((a, b) => (b.priority || 0) - (a.priority || 0));

    // 限制注入数量，避免 prompt 过长
    return matched.slice(0, 12);
  }

  /**
   * 创建空世界书
   */
  function createWorldBook(name) {
    return {
      id: Store.uid(),
      name: name || '新世界书',
      globalSetting: '',
      entries: [],
      createdAt: Date.now(),
    };
  }

  /**
   * 添加条目
   */
  function addEntry(wb, entry) {
    wb.entries.push({
      id: Store.uid(),
      title: entry.title || '未命名条目',
      keywords: entry.keywords || [],
      content: entry.content || '',
      priority: entry.priority || 0,
      constant: entry.constant || false,
      enabled: true,
    });
  }

  // ============ 记忆沉淀 ============

  /**
   * 让 AI 从对话中提取记忆
   * @param {String} charName   角色名
   * @param {Array}  messages   完整对话 [{role, content}]
   * @returns {Promise<Array>}  [{category, content}]
   */
  async function precipitateMemories(charName, messages) {
    const recent = messages.slice(-20);
    const dialogue = recent.map(m => `${m.role === 'user' ? '用户' : charName}: ${m.content}`).join('\n');

    const sys =
      '你是一个记忆提取助手。请从以下对话中提取值得长期记住的信息（用户偏好、重要事件、关系进展等）。\n' +
      '如果没有值得提取的信息，返回空数组。\n' +
      '严格按 JSON 数组格式输出，不要输出其他内容。格式：\n' +
      '[{"category":"偏好|事件|关系|其他","content":"简短描述"}]\n' +
      '最多提取 3 条，每条 content 不超过 50 字。';

    try {
      const result = await API.chat(
        [
          { role: 'system', content: sys },
          { role: 'user', content: dialogue },
        ],
        { stream: false, maxTokens: 300, temperature: 0.3 }
      );

      // 提取 JSON
      const match = result.match(/\[[\s\S]*\]/);
      if (match) {
        const arr = JSON.parse(match[0]);
        return arr.filter(m => m.category && m.content).map(m => ({
          id: Store.uid(),
          category: m.category,
          content: m.content,
          source: '聊天对话',
          sourceChar: charName,
          time: Date.now(),
        }));
      }
    } catch (e) {
      console.error('Memory precipitation error:', e);
    }
    return [];
  }

  /**
   * 保存记忆（去重）
   */
  function saveMemories(newMems) {
    const data = Store.get();
    const existing = new Set(data.memories.map(m => m.content));
    let added = 0;
    for (const m of newMems) {
      if (!existing.has(m.content)) {
        data.memories.push(m);
        existing.add(m.content);
        added++;
      }
    }
    Store.save();
    return added;
  }

  window.WorldBook = {
    buildSystemPrompt,
    matchEntries,
    createWorldBook,
    addEntry,
    precipitateMemories,
    saveMemories,
  };
})();
