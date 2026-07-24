/* === Novel Game (文游) Module === */
/* Depends on: CONFIG, request, api, toast, $, $$ from index.html */

const novelAPI = {
  listScripts: () => request('/novel-games'),
  getScript: (id) => request(`/novel-games/${encodeURIComponent(id)}`),
  listSaves: () => request('/novel-games/saves/list'),
  getSave: (saveId) => request(`/novel-games/save/${encodeURIComponent(saveId)}`),
  createSave: (payload) => request('/novel-games/save', { method: 'POST', body: JSON.stringify(payload) }),
  deleteSave: (saveId) => request(`/novel-games/save/${encodeURIComponent(saveId)}`, { method: 'DELETE' }),
  action: (payload) => request('/novel-games/action', { method: 'POST', body: JSON.stringify(payload) }),
  applyChanges: (payload) => request('/novel-games/apply-changes', { method: 'POST', body: JSON.stringify(payload) })
};

let novelState = {
  scripts: [],
  saves: [],
  currentTab: 'scripts',
  currentScript: null,
  currentSave: null,
  isLoading: false
};

const $n = (sel) => document.querySelector(sel);
const $$n = (sel) => Array.from(document.querySelectorAll(sel));

/* ===== Render: Script List ===== */
const renderNovelScripts = () => {
  const container = $n('#novelGameContent');
  if (!container) return;

  if (novelState.scripts.length === 0) {
    container.innerHTML = `
      <div class="novel-empty">
        <div class="novel-empty-icon">📚</div>
        <p>暂无可用剧本</p>
      </div>`;
    return;
  }

  container.innerHTML = `<div class="novel-script-list">
    ${novelState.scripts.map((s) => {
      const gradient = (s.coverGradient || ['#7466ff', '#9a8cff']).join(', ');
      const diffClass = s.difficulty === '简单' ? 'difficulty-easy' : (s.difficulty === '困难' ? 'difficulty-hard' : 'difficulty-medium');
      return `
      <div class="novel-script-card" data-script-id="${escapeHtml(s.id)}" data-action="open-script">
        <div class="novel-script-cover" style="background: linear-gradient(135deg, ${gradient});">
          <div class="novel-script-cover-text">
            <h3>${escapeHtml(s.name)}</h3>
            <div class="tagline">${escapeHtml(s.category || '')} · ${escapeHtml(s.difficulty || '')}</div>
          </div>
        </div>
        <div class="novel-script-info">
          <div class="novel-script-meta">
            ${(s.tags || []).map((t) => `<span class="novel-tag">${escapeHtml(t)}</span>`).join('')}
            <span class="novel-tag ${diffClass}">${escapeHtml(s.difficulty || '中等')}</span>
          </div>
          <p class="novel-script-desc">${escapeHtml(s.description || '').slice(0, 120)}${(s.description || '').length > 120 ? '...' : ''}</p>
        </div>
      </div>`;
    }).join('')}
  </div>`;
};

/* ===== Render: Save List ===== */
const renderNovelSaves = () => {
  const container = $n('#novelGameContent');
  if (!container) return;

  if (novelState.saves.length === 0) {
    container.innerHTML = `
      <div class="novel-empty">
        <div class="novel-empty-icon">💾</div>
        <p>还没有存档</p>
        <p style="font-size:13px;margin-top:8px;">去剧本库选择一个剧本开始游戏吧</p>
      </div>`;
    return;
  }

  container.innerHTML = `<div class="novel-save-list">
    ${novelState.saves.map((save) => `
      <div class="novel-save-card" data-save-id="${escapeHtml(save.id)}" data-action="load-save">
        <div class="novel-save-info">
          <h4>${escapeHtml(save.scriptName || '未命名剧本')}</h4>
          <div class="novel-save-meta">
            角色: ${escapeHtml(save.playerName || '未命名')} · 第${save.round || 0}轮 · ${save.updatedAt ? new Date(save.updatedAt).toLocaleString() : '刚刚'}
          </div>
        </div>
        <div class="novel-save-actions">
          <button class="novel-btn small" data-save-id="${escapeHtml(save.id)}" data-action="enter-save">进入</button>
          <button class="novel-btn secondary small" data-save-id="${escapeHtml(save.id)}" data-action="delete-save">删除</button>
        </div>
      </div>
    `).join('')}
  </div>`;
};

/* ===== Render: Script Detail / Create Character ===== */
const openScriptDetail = async (scriptId) => {
  const script = novelState.scripts.find((s) => s.id === scriptId);
  if (!script) return;
  novelState.currentScript = script;

  const modalContent = $n('#novelModalContent');
  const modal = $n('#novelModal');

  const customizable = script.player?.customizable || ['name'];
  const defaultStats = script.player?.defaultStats || {};

  let statsHtml = '';
  if (Object.keys(defaultStats).length > 0) {
    statsHtml = `<div class="novel-stat-grid">
      ${Object.entries(defaultStats).map(([k, v]) => `
        <div class="novel-stat-input">
          <span>${escapeHtml(k)}</span>
          <input type="text" data-stat="${escapeHtml(k)}" value="${escapeHtml(String(v))}" />
        </div>
      `).join('')}
    </div>`;
  }

  modalContent.innerHTML = `
    <h3>开始游戏：${escapeHtml(script.name)}</h3>
    <div class="novel-form">
      ${customizable.includes('name') ? `<label>角色姓名<input type="text" id="novelPlayerName" placeholder="输入你的名字" /></label>` : ''}
      ${customizable.includes('age') ? `<label>年龄<input type="text" id="novelPlayerAge" placeholder="年龄" /></label>` : ''}
      ${customizable.includes('appearance') ? `<label>外貌<textarea id="novelPlayerAppearance" rows="2" placeholder="描述你的外貌..."></textarea></label>` : ''}
      ${customizable.includes('personality') ? `<label>性格<textarea id="novelPlayerPersonality" rows="2" placeholder="描述你的性格..."></textarea></label>` : ''}
      ${customizable.includes('background') ? `<label>背景<textarea id="novelPlayerBackground" rows="3" placeholder="你的出身和经历..."></textarea></label>` : ''}
      <label>初始属性</label>
      ${statsHtml}
    </div>
    <div class="novel-modal-actions">
      <button class="novel-btn secondary" data-action="close-modal">取消</button>
      <button class="novel-btn" data-action="create-save">开始游戏</button>
    </div>
  `;

  modal.classList.add('active');
};

/* ===== Create Save ===== */
const createNovelSave = async () => {
  const script = novelState.currentScript;
  if (!script) return;

  const name = $n('#novelPlayerName')?.value.trim() || '未命名';
  const age = $n('#novelPlayerAge')?.value.trim() || '';
  const appearance = $n('#novelPlayerAppearance')?.value.trim() || '';
  const personality = $n('#novelPlayerPersonality')?.value.trim() || '';
  const background = $n('#novelPlayerBackground')?.value.trim() || '';

  const stats = {};
  $n('.novel-stat-grid')?.querySelectorAll('input[data-stat]')?.forEach((input) => {
    const val = input.value.trim();
    stats[input.dataset.stat] = isNaN(Number(val)) ? val : Number(val);
  });

  const player = { name, age, appearance, personality, background };
  const state = {
    player: { ...player, stats },
    npcs: {},
    inventory: script.player?.startingItems || [],
    pendingEvents: []
  };

  // Initialize NPC states
  (script.npcs || []).forEach((npc) => {
    state.npcs[npc.id] = { trust: 0, attitude: npc.initialAttitude || '陌生' };
  });

  const payload = {
    scriptId: script.id,
    scriptName: script.name,
    player,
    state,
    round: 0,
    history: [],
    currentWorld: script.worlds?.[0]?.id || null
  };

  try {
    toast('正在创建存档...');
    const save = await novelAPI.createSave(payload);
    novelState.currentSave = save;
    closeNovelModal();
    enterNovelLobby(save);
  } catch (err) {
    toast('创建存档失败：' + (err.message || '未知错误'));
  }
};

/* ===== Close Modal ===== */
const closeNovelModal = () => {
  $n('#novelModal')?.classList.remove('active');
};

/* ===== Enter Lobby ===== */
const enterNovelLobby = async (save) => {
  if (!save) return;
  novelState.currentSave = save;

  // Hide main, show lobby
  $n('#novelGameMain').style.display = 'none';
  $n('#novelGameStory').style.display = 'none';
  $n('#novelGameStory').classList.remove('active');
  const lobby = $n('#novelGameLobby');
  lobby.style.display = '';
  lobby.classList.add('active');

  const script = novelState.scripts.find((s) => s.id === save.scriptId) || {};
  $n('#novelLobbyTitle').textContent = save.scriptName || '游戏大厅';
  $n('#novelLobbySubtitle').textContent = `角色: ${save.player?.name || '未命名'} · 第${save.round || 0}轮`;

  const stats = save.state?.player?.stats || {};
  const npcs = save.state?.npcs || {};
  const inventory = save.state?.inventory || [];

  const worldInfo = script.worlds?.find((w) => w.id === save.currentWorld);

  let html = '';

  // World info
  if (worldInfo) {
    html += `<div class="panel" style="margin-bottom:14px">
      <h4>🌍 当前世界：${escapeHtml(worldInfo.name || '')}</h4>
      <p class="muted">${escapeHtml(worldInfo.setting || '')}</p>
      <p class="muted" style="margin-top:6px">目标：${escapeHtml(worldInfo.objective || '')}</p>
    </div>`;
  }

  // Stats
  if (Object.keys(stats).length > 0) {
    html += `<div class="novel-status-panel">`;
    html += Object.entries(stats).map(([k, v]) => `
      <div class="novel-status-item">
        <span class="value">${escapeHtml(String(v))}</span>
        <span class="label">${escapeHtml(k)}</span>
      </div>
    `).join('');
    html += `</div>`;
  }

  // NPCs
  const scriptNpcs = script.npcs || [];
  if (scriptNpcs.length > 0) {
    html += `<h4 style="margin:14px 0 8px">人物关系</h4>`;
    html += `<div class="novel-npc-list">`;
    html += scriptNpcs.map((npc) => {
      const s = npcs[npc.id] || {};
      const trust = Number(s.trust) || 0;
      const attitude = s.attitude || npc.initialAttitude || '陌生';
      return `
        <div class="novel-npc-card">
          <div class="novel-npc-avatar">${escapeHtml(npc.name?.[0] || '?')}</div>
          <div class="novel-npc-info">
            <h4>${escapeHtml(npc.name)} <span style="font-weight:400;color:var(--novel-muted);font-size:12px">${escapeHtml(npc.role || '')}</span></h4>
            <div class="attitude">态度：${escapeHtml(attitude)} · 信任 ${trust}</div>
            <div class="trust-bar"><div class="trust-bar-fill" style="width:${Math.max(0, Math.min(100, trust + 50))}%"></div></div>
          </div>
        </div>
      `;
    }).join('');
    html += `</div>`;
  }

  // Inventory
  if (inventory.length > 0) {
    html += `<h4 style="margin:14px 0 8px">背包 (${inventory.length})</h4>`;
    html += `<div class="novel-inventory-grid">`;
    html += inventory.map((item) => {
      const name = typeof item === 'string' ? item : item.name;
      return `
        <div class="novel-item-card">
          <div class="item-icon">🎒</div>
          <div class="item-name">${escapeHtml(name)}</div>
        </div>
      `;
    }).join('');
    html += `</div>`;
  }

  // Actions
  html += `<div style="margin-top:20px;display:grid;gap:10px">
    <button class="novel-btn primary" data-action="start-story" style="padding:14px">▶ 继续剧情</button>
    <button class="novel-btn secondary" data-action="back-to-main" style="padding:12px">← 返回主界面</button>
  </div>`;

  $n('#novelLobbyBody').innerHTML = html;
};

/* ===== Start Story ===== */
const startNovelStory = () => {
  const lobby = $n('#novelGameLobby');
  lobby.style.display = 'none';
  lobby.classList.remove('active');

  const story = $n('#novelGameStory');
  story.style.display = '';
  story.classList.add('active');

  $n('#novelRoundBadge').textContent = `第${(novelState.currentSave?.round || 0) + 1}轮`;
  $n('#novelStoryContent').innerHTML = `<div class="novel-loading"><div class="novel-loading-spinner"></div>正在进入世界...</div>`;
  $n('#novelActions').innerHTML = '';

  // If first round, generate intro; otherwise let player choose action
  const save = novelState.currentSave;
  if (save && save.round === 0 && (!save.history || save.history.length === 0)) {
    generateNovelRound('开始游戏');
  } else {
    $n('#novelStoryContent').innerHTML = `<div class="novel-empty">
      <div class="novel-empty-icon">📖</div>
      <p>选择下方行动继续剧情，或输入自定义行动</p>
    </div>`;
    renderNovelActions();
  }
};

/* ===== Generate Round ===== */
const generateNovelRound = async (action, customAction) => {
  const save = novelState.currentSave;
  if (!save) return;

  novelState.isLoading = true;
  $n('#novelStoryContent').innerHTML = `<div class="novel-loading"><div class="novel-loading-spinner"></div>AI正在生成剧情...</div>`;
  $n('#novelActions').innerHTML = '';

  try {
    const result = await novelAPI.action({
      saveId: save.id,
      action,
      customAction
    });

    novelState.lastResult = result;
    novelState.isLoading = false;

    // Render content
    const contentHtml = parseNovelContent(result.content || '剧情生成失败，请重试。');
    $n('#novelStoryContent').innerHTML = contentHtml;
    $n('#novelRoundBadge').textContent = `第${result.round || save.round + 1}轮`;

    // Render actions from content or defaults
    renderNovelActions(extractActionsFromContent(result.content));

    // Scroll to top
    $n('#novelStoryScroll').scrollTop = 0;
  } catch (err) {
    novelState.isLoading = false;
    $n('#novelStoryContent').innerHTML = `<div class="novel-empty">
      <div class="novel-empty-icon">⚠️</div>
      <p>剧情生成失败</p>
      <p style="font-size:13px">${escapeHtml(err.message || '未知错误')}</p>
    </div>`;
    renderNovelActions();
  }
};

/* ===== Parse Content ===== */
const parseNovelContent = (text) => {
  if (!text) return '';
  // Highlight stat changes
  let html = escapeHtml(text)
    .replace(/\[(HP|理智|信任|攻击|防御|敏捷|智力|魅力|运气|经验|金钱)([\+\-]\d+)\]/g, '<span class="stat-change">$1$2</span>')
    .replace(/\[(.+?)([\+\-]\d+)\]/g, '<span class="stat-change">$1$2</span>');

  // Convert markdown-like headers
  html = html.replace(/^#{1,2}\s+(.+)$/gm, '<h4>$1</h4>');

  return html;
};

/* ===== Extract Actions ===== */
const extractActionsFromContent = (text) => {
  if (!text) return [];
  const actions = [];
  const lines = text.split('\n');
  let inOptions = false;

  for (const line of lines) {
    const trimmed = line.trim();
    if (/可选行动|行动选择|你可以选择|接下来/.test(trimmed)) {
      inOptions = true;
      continue;
    }
    if (inOptions && /^\d+[\.\、\.]\s*(.+)/.test(trimmed)) {
      const m = trimmed.match(/^\d+[\.\、\.]\s*(.+)/);
      if (m) actions.push(m[1].trim());
    }
    if (inOptions && trimmed.startsWith('【')) {
      inOptions = false;
    }
  }

  // If no actions extracted, provide defaults
  if (actions.length === 0) {
    return ['继续探索', '与NPC交谈', '查看周围', '休息恢复'];
  }
  return actions;
};

/* ===== Render Actions ===== */
const renderNovelActions = (actions) => {
  const list = actions || ['继续探索', '与NPC交谈', '查看周围', '休息恢复'];
  $n('#novelActions').innerHTML = list.map((a, i) => `
    <button class="novel-action-btn ${i === 0 ? 'primary' : ''}" data-action="story-action" data-action-text="${escapeHtml(a)}">
      ${escapeHtml(a)}
    </button>
  `).join('') + `
    <button class="novel-action-btn" data-action="story-action" data-action-text="" data-custom="1">【自定义行动】</button>
  `;
};

/* ===== Apply Round Changes ===== */
const applyNovelRound = async () => {
  const result = novelState.lastResult;
  const save = novelState.currentSave;
  if (!result || !save) return;

  const changes = result.statChanges || [];
  const historyEntry = {
    round: result.round || save.round + 1,
    action: result.playerAction || '继续探索',
    summary: (result.content || '').slice(0, 200).replace(/\n/g, ' ') + '...',
    changes
  };

  try {
    const updated = await novelAPI.applyChanges({
      saveId: save.id,
      changes,
      historyEntry
    });
    novelState.currentSave = updated;
    $n('#novelRoundBadge').textContent = `第${updated.round || 0}轮`;
    toast('状态已更新');
  } catch (err) {
    toast('保存状态失败：' + (err.message || '未知错误'));
  }
};

/* ===== Save Game ===== */
const saveNovelGame = async () => {
  const save = novelState.currentSave;
  if (!save) return;

  try {
    await novelAPI.createSave(save);
    toast('存档已保存');
  } catch (err) {
    toast('存档失败：' + (err.message || '未知错误'));
  }
};

/* ===== Back to Main ===== */
const backToNovelMain = () => {
  $n('#novelGameLobby').style.display = 'none';
  $n('#novelGameLobby').classList.remove('active');
  $n('#novelGameStory').style.display = 'none';
  $n('#novelGameStory').classList.remove('active');
  $n('#novelGameMain').style.display = '';
  novelState.currentSave = null;
  loadNovelSaves();
};

/* ===== Load Data ===== */
const loadNovelScripts = async () => {
  try {
    const data = await novelAPI.listScripts();
    novelState.scripts = data?.list || [];
    if (novelState.currentTab === 'scripts') renderNovelScripts();
  } catch (err) {
    console.warn('加载剧本失败', err);
    novelState.scripts = [];
    renderNovelScripts();
  }
};

const loadNovelSaves = async () => {
  try {
    const data = await novelAPI.listSaves();
    novelState.saves = data?.list || [];
    if (novelState.currentTab === 'saves') renderNovelSaves();
  } catch (err) {
    console.warn('加载存档失败', err);
    novelState.saves = [];
    renderNovelSaves();
  }
};

/* ===== Event Delegation ===== */
document.addEventListener('click', async (e) => {
  // Tab switching
  const tabBtn = e.target.closest('[data-novel-tab]');
  if (tabBtn) {
    novelState.currentTab = tabBtn.dataset.novelTab;
    $$n('[data-novel-tab]').forEach((b) => b.classList.toggle('active', b === tabBtn));
    if (novelState.currentTab === 'scripts') renderNovelScripts();
    else renderNovelSaves();
    return;
  }

  // Open script
  const scriptCard = e.target.closest('[data-action="open-script"]');
  if (scriptCard) {
    openScriptDetail(scriptCard.dataset.scriptId);
    return;
  }

  // Create save
  const createBtn = e.target.closest('[data-action="create-save"]');
  if (createBtn) {
    await createNovelSave();
    return;
  }

  // Close modal
  const closeModalBtn = e.target.closest('[data-action="close-modal"]');
  if (closeModalBtn) {
    closeNovelModal();
    return;
  }

  // Load save (enter lobby)
  const loadSaveBtn = e.target.closest('[data-action="load-save"], [data-action="enter-save"]');
  if (loadSaveBtn) {
    const saveId = loadSaveBtn.dataset.saveId;
    try {
      const save = await novelAPI.getSave(saveId);
      novelState.currentSave = save;
      enterNovelLobby(save);
    } catch (err) {
      toast('加载存档失败：' + (err.message || '未知错误'));
    }
    return;
  }

  // Delete save
  const deleteSaveBtn = e.target.closest('[data-action="delete-save"]');
  if (deleteSaveBtn) {
    const saveId = deleteSaveBtn.dataset.saveId;
    if (!confirm('确认删除这个存档？此操作不可恢复。')) return;
    try {
      await novelAPI.deleteSave(saveId);
      toast('存档已删除');
      loadNovelSaves();
    } catch (err) {
      toast('删除失败：' + (err.message || '未知错误'));
    }
    return;
  }

  // Lobby actions
  const startStoryBtn = e.target.closest('[data-action="start-story"]');
  if (startStoryBtn) {
    startNovelStory();
    return;
  }

  const backMainBtn = e.target.closest('[data-action="back-to-main"]');
  if (backMainBtn) {
    backToNovelMain();
    return;
  }

  // Story actions
  const storyActionBtn = e.target.closest('[data-action="story-action"]');
  if (storyActionBtn && !novelState.isLoading) {
    const actionText = storyActionBtn.dataset.actionText;
    const isCustom = storyActionBtn.dataset.custom;
    if (isCustom) {
      const input = $n('#novelCustomActionInput');
      const customAction = input?.value.trim();
      if (!customAction) {
        toast('请输入自定义行动');
        return;
      }
      input.value = '';
      await generateNovelRound('', customAction);
    } else {
      await generateNovelRound(actionText);
    }
    return;
  }
});

/* ===== Bind direct events ===== */
const bindNovelEvents = () => {
  $n('#novelStoryBack')?.addEventListener('click', () => {
    backToNovelMain();
  });

  $n('#novelSaveBtn')?.addEventListener('click', () => {
    saveNovelGame();
  });

  $n('#novelCustomActionBtn')?.addEventListener('click', async () => {
    if (novelState.isLoading) return;
    const input = $n('#novelCustomActionInput');
    const customAction = input?.value.trim();
    if (!customAction) {
      toast('请输入自定义行动');
      return;
    }
    input.value = '';
    await generateNovelRound('', customAction);
  });

  $n('#novelCustomActionInput')?.addEventListener('keydown', async (e) => {
    if (e.key === 'Enter' && !novelState.isLoading) {
      const customAction = e.target.value.trim();
      if (!customAction) return;
      e.target.value = '';
      await generateNovelRound('', customAction);
    }
  });
};

/* ===== Init ===== */
const initNovelGame = () => {
  // Render initial state
  if (novelState.currentTab === 'scripts') renderNovelScripts();
  else renderNovelSaves();

  loadNovelScripts();
  loadNovelSaves();
  bindNovelEvents();
};

// Auto-init when page becomes active
const novelPageObserver = () => {
  const page = $n('#novelGamePage');
  if (!page) return;

  const observer = new MutationObserver((mutations) => {
    for (const m of mutations) {
      if (m.attributeName === 'class' && page.classList.contains('active')) {
        loadNovelScripts();
        loadNovelSaves();
      }
    }
  });
  observer.observe(page, { attributes: true });
};

// Delay init to ensure DOM is ready
setTimeout(() => {
  initNovelGame();
  novelPageObserver();
}, 100);
