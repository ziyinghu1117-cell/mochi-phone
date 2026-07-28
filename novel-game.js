/* === Novel Game (文游) Module — moku.chat warm earth-tone redesign ===
 * UU-style text-based game. Vanilla JS, no modules.
 * Depends on globals from index.html: request, toast, escapeHtml, $, $$, CONFIG, state.
 *
 * HTML hooks (already present in index.html):
 *   #novelGamePage            - section.page (toggled .active)
 *   #novelGameContainer       - .novel-container (flex shell)
 *     #novelGameMain          - tabs + list view (剧本库 / 我的存档)
 *       .novel-tabs [data-novel-tab="scripts|saves"]
 *       #novelGameContent     - list render target
 *     #novelGameStory         - .novel-story (display:none initially)
 *       #novelPhonePanel      - legacy in-game phone overlay
 *       .novel-story-header   - #novelStoryBack / #novelSaveBtn (+ hidden time/round badges)
 *       #novelStatusBar       - character status header card (avatar/name/gender/date/round/stats grid)
 *       #novelStoryScroll     - .novel-story-scroll (scrollable per-tab content)
 *         #novelStoryContent  - render target for the active story tab
 *       #novelActionPanel     - 7-tab bottom navigation (剧情/人脉/手机/属性/事件/资产/设置)
 *   #novelModal / #novelModalContent - character creation modal
 */

/* ------------------------------------------------------------------ *
 * API layer
 * ------------------------------------------------------------------ */
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

/* ------------------------------------------------------------------ *
 * State
 * ------------------------------------------------------------------ */
let novelState = {
  scripts: [],
  saves: [],
  currentTab: 'scripts',
  currentScript: null,   // full script object (world/player/npcs/...)
  currentSave: null,     // current save object being played
  lastResult: null,      // last action API result
  isLoading: false,
  phoneView: 'home',     // home/contacts/social/map/diary/shop/settings/quests/inventory
  storyTab: 'story',     // story/connections/phone/attributes/events/assets/settings
  lastNarrativeHtml: '', // cached 剧情 narrative (so tab switching preserves it)
  lastActions: [],       // cached choice actions for the 剧情 tab
  scriptCategory: '全部', // category filter for script list
  scriptSubTag: '',      // sub-tag filter within category
  scriptSearch: '',       // search keyword for script list
  lastPlayerAction: '',   // last player action for regeneration
  phoneNotifications: [], // pending phone notifications from AI
  phoneMessages: {},      // chat messages with NPCs: { npcId: [{from, content, time}] }
  phoneMoments: [],       // NPC social feed posts
  phoneWallet: 0,         // in-game wallet balance
  narrativeHistory: [],   // array of all narrative HTML blocks for scrolling
  storyLength: 'medium',  // short/medium/long
  storyLengthWords: { short: [100, 200], medium: [200, 400], long: [400, 800] }
};

/* ------------------------------------------------------------------ *
 * Dynamic label maps (scripts use world-specific, mostly English keys)
 * ------------------------------------------------------------------ */
const STAT_LABELS = {
  // cultivation / xianxia
  cultivation_level: '境界', spiritual_energy: '灵气', body: '体魄', mind: '神识',
  luck: '气运', karma: '因果', dao: '道行', realm: '境界', spiritual_root: '灵根',
  // combat / survival / infinite-flow
  hp: '气血', health: '生命', attack: '攻击', defense: '防御', sanity: '理智',
  agility: '敏捷', intelligence: '智力', charm: '魅力', wisdom: '智慧',
  // modern campus
  academic: '学业', study: '学业', sport: '运动', athletics: '运动', art: '艺术',
  social: '社交', stress: '压力', energy: '体力', popularity: '人气',
  // magic / noble / court
  magic: '魔力', mana: '法力', reputation: '名望', fame: '名望', spirit: '精神',
  perception: '感知', morality: '善恶', physique: '体魄', endurance: '耐力',
  // generic
  money: '金钱', gold: '金币', wealth: '财富', faith: '信仰', power: '力量',
  courage: '勇气', trust: '信任', exp: '经验', experience: '经验', level: '等级',
  influence: '影响力', authority: '权势', mood: '心情', relationship: '关系',
  san: '理智', mp: '法力', sp: '体力',
  // additional common English keys for Chinese fallback
  strength: '力量', dex: '敏捷', dexterity: '敏捷', charisma: '魅力',
  vitality: '活力', stamina: '体力', willpower: '意志力', luck_stat: '运气',
  speed: '速度', accuracy: '精准', evasion: '闪避', crit: '暴击',
  defense_rate: '防御率', resistance: '抗性', skill: '技巧', talent: '天赋',
  creativity: '创造力', logic: '逻辑', emotion: '情感', intuition: '直觉',
  discipline: '纪律', loyalty: '忠诚', honor: '荣誉', prestige: '威望',
  resources: '资源', supplies: '物资', food: '食物', water: '饮水',
  shelter: '庇护所', warmth: '温暖', hunger: '饥饿', thirst: '口渴',
  fatigue: '疲劳', injury: '伤势', infection: '感染', radiation: '辐射',
  stealth: '隐匿', survival: '生存', crafting: '制造', cooking: '烹饪',
  medicine: '医术', leadership: '领导力', negotiation: '谈判', trading: '交易',
  navigation: '导航', engineering: '工程', science: '科学', technology: '科技',
  magic_power: '魔法威力', magic_control: '魔法掌控', elemental: '元素亲和',
  dark_power: '暗之力', light_power: '光之力', nature: '自然之力',
  fire: '火焰', ice: '冰霜', thunder: '雷电', wind: '风之力',
  earth: '大地之力', water_magic: '水之力', healing: '治愈',
  summoning: '召唤术', enchantment: '附魔', alchemy: '炼金术',
  swordsmanship: '剑术', archery: '箭术', martial_arts: '武艺',
  marksmanship: '枪法', riding: '骑术', swimming: '游泳',
  climbing: '攀爬', cooking_skill: '厨艺', music: '音乐',
  painting: '绘画', writing: '写作', singing: '歌唱',
  dancing: '舞蹈', gardening: '园艺', fishing: '钓鱼',
  mining: '采矿', lumbering: '伐木', farming: '农耕',
  tailoring: '裁缝', smithing: '锻造', jewelcrafting: '珠宝加工',
  carpentry: '木工', masonry: '石工', pottery: '陶艺',
  brewing: '酿造', tanning: '制革', weaving: '编织',
  // business / management
  funds: '资金', staff: '员工', quality: '品质', inventory: '库存',
  salary: '薪资', performance: '业绩', networking: '人脉', skills: '技能',
  // court / noble
  favor: '恩宠', dignity: '尊严', debt: '负债', intellect: '才智',
  // romance / dating
  chemistry: '心动值', empathy: '共情', honesty: '真诚',
  independence: '独立', vulnerability: '脆弱',
  // mystery / investigation
  evidence: '证据', time: '时间',
  // transmigration / isekai
  identity_stability: '身份稳定', knowledge_advantage: '先知优势',
  canon_knowledge: '原作知识', identity_cover: '身份伪装',
  plot_divergence: '剧情偏离',
  // horror / survival
  items: '物品', light: '光源', aggravation: '恶化',
  // ancient life
  knowledge: '学识', relationships: '人脉', status: '地位', happiness: '幸福',
  // entertainment
  acting: '演技', singing: '歌艺', scandal: '绯闻', persona: '人设',
  figure: '身材', variety: '综艺感', eq: '情商', network: '人脉', stardom: '星途',
  appearance: '颜值',
  // golden canary / disguise
  disguise: '伪装', survival_instinct: '求生本能',
  // infinite flow
  inventory_space: '背包容量', trial_points: '试炼积分',
  // dark romance
  mindRead: '读心',
  // holy maiden
  holyLight: '圣光', insight: '洞察',
  // velvet cage / sentinel-guide
  pheromoneControl: '信息素控制', mentalWeb: '精神网', dominance: '支配力',
  empathyTalent: '共情天赋', abyssHunger: '深渊饥渴',
  mentalStability: '精神稳定', resonanceFailure: '共振失控',
  pollution: '污染', syncRate: '同步率',
  // rebirth junior sister
  cultivation: '修为', spiritual: '灵性', bond: '羁绊', foresight: '预知'
};

const FIELD_LABELS = {
  name: '角色姓名', age: '年龄', gender: '性别', appearance: '外貌',
  personality: '性格', background: '背景经历', spiritualRoot: '灵根',
  daoHeart: '道心', transferReason: '转学原因', hobby: '兴趣特长',
  morality: '善恶倾向', magicAffinity: '魔法亲和', cultivation: '修炼功法',
  origin: '出身', race: '种族', title: '身份称号', wish: '心愿',
  secret: '隐秘之事', flaw: '性格缺陷', talent: '天赋', ability: '能力',
  belief: '信仰', codename: '代号', alias: '别名', job: '职业',
  // business / management
  managementStyle: '经营风格', shopConcept: '店铺理念', signatureDish: '招牌菜',
  // court / noble / ancient
  familyBackground: '家族背景', ambition: '野心', lifeAspiration: '人生理想',
  // dating / entertainment
  occupation: '职业', reasonForJoining: '加入原因', careerGoal: '职业目标',
  persona: '人设', dream: '梦想',
  // survival / dark
  specialty: '特长', survivalGoal: '生存目标', reasonForEntering: '进入原因',
  mentalEntity: '精神实体'
};

// Fields rendered as a single-line input; everything else becomes a textarea.
const SHORT_FIELDS = new Set(['name', 'age', 'gender', 'race', 'title', 'codename', 'alias']);

const statLabel = (key) => (Object.prototype.hasOwnProperty.call(STAT_LABELS, key) ? STAT_LABELS[key] : key);
const fieldLabel = (key) => (Object.prototype.hasOwnProperty.call(FIELD_LABELS, key) ? FIELD_LABELS[key] : key);

const DEFAULT_ACTIONS = ['继续探索', '与NPC交谈', '查看周围', '休息恢复'];

/* Emoji icons for common stats (used in the status grid + attributes tab) */
const STAT_ICONS = {
  hp: '❤️', health: '❤️', vitality: '❤️', stamina: '⚡', energy: '⚡', sp: '⚡',
  attack: '⚔️', strength: '💪', defense: '🛡️', agility: '💨', speed: '💨', dexterity: '💨', dex: '💨',
  intelligence: '🧠', wisdom: '🧠', mind: '🧠', intellect: '🧠', perception: '👁️',
  charm: '✨', charisma: '✨', appearance: '✨', beauty: '✨',
  luck: '🍀', fortune: '🍀', karma: '⚖️',
  money: '💰', gold: '💰', wealth: '💰', funds: '💰', resources: '📦',
  cultivation_level: '🔮', realm: '🔮', cultivation: '🔮', spiritual_energy: '🔮',
  magic: '🔮', mana: '🔮', mp: '🔮', spiritual: '🔮',
  reputation: '👑', fame: '👑', influence: '👑', authority: '👑', status: '👑', prestige: '👑', dignity: '👑',
  academic: '📚', study: '📚', knowledge: '📚', science: '🔬', technology: '🔬', logic: '🧩',
  sport: '🏃', athletics: '🏃',
  art: '🎨', music: '🎵', painting: '🎨', writing: '✍️', singing: '🎤', dancing: '💃',
  social: '🤝', networking: '🤝', relationships: '🤝', trust: '🤝', loyalty: '🤝',
  sanity: '🧘', spirit: '🧘', mentalStability: '🧘', willpower: '🧘',
  mood: '😊', happiness: '😊', emotion: '😊',
  stress: '😰', pressure: '😰', fatigue: '😩',
  courage: '🦁', bravery: '🦁',
  level: '⭐', exp: '⭐', experience: '⭐', talent: '🌟',
  skill: '🎯', accuracy: '🎯', crit: '🎯',
  evasion: '🍃', stealth: '🍃',
  cooking: '🍳', cooking_skill: '🍳', medicine: '⚕️', healing: '⚕️',
  leadership: '⚑', negotiation: '🗣️', trading: '💱',
  faith: '🙏', morality: '☯️', honor: '🎖️',
  survival: '🏕️', endurance: '🏕️', physique: '💪', body: '💪'
};
const statIcon = (key) => (Object.prototype.hasOwnProperty.call(STAT_ICONS, key) ? STAT_ICONS[key] : '🔹');

/* ------------------------------------------------------------------ *
 * Small render helpers
 * ------------------------------------------------------------------ */
const novelLoadingHtml = (msg) =>
  `<div class="novel-loading"><div class="novel-loading-spinner"></div><span>${escapeHtml(msg || '加载中...')}</span></div>`;

const novelEmptyHtml = (icon, msg, sub) =>
  `<div class="novel-empty"><div class="novel-empty-icon">${icon}</div>` +
  `<p class="novel-empty-text">${escapeHtml(msg || '')}</p>` +
  (sub ? `<p class="novel-empty-sub">${escapeHtml(sub)}</p>` : '') + `</div>`;

/* Compute an in-game calendar date string from the round number. */
const novelDateStr = (round) => {
  const r = Math.max(0, Number(round) || 0);
  const start = new Date(2024, 0, 1);
  const d = new Date(start.getTime() + r * 86400000);
  return `${d.getMonth() + 1}月${d.getDate()}日`;
};

/* Pull display info about the current player. */
const novelPlayerInfo = () => {
  const save = novelState.currentSave || {};
  const player = (save.state && save.state.player) || {};
  const name = (save.player && save.player.name) || player.name || '旅人';
  const gender = (save.player && save.player.gender) || player.gender || '';
  const stats = player.stats || {};
  const round = Math.max(save.round || 0, 1);
  return { name, gender, stats, round, player };
};

/* ------------------------------------------------------------------ *
 * Script list
 * ------------------------------------------------------------------ */
const renderNovelScripts = () => {
  const container = $('#novelGameContent');
  if (!container) return;

  // extract unique categories
  const allCats = [...new Set(novelState.scripts.map((s) => s.category || '').filter(Boolean))];
  allCats.unshift('全部');

  // filter scripts by category and search
  const currentSubTag = novelState.scriptSubTag || '';
  const filtered = novelState.scripts.filter((s) => {
    if (currentSubTag && !(s.tags || []).includes(currentSubTag)) return false;
    if (novelState.scriptSearch) {
      const kw = novelState.scriptSearch.toLowerCase();
      const haystack = [s.name, s.category, s.description || '', ...(s.tags || [])].join(' ').toLowerCase();
      if (!haystack.includes(kw)) return false;
    }
    return true;
  });

  // render sub-tags only (no category bar)
  const allSubTags = [...new Set(novelState.scripts.flatMap((s) => s.tags || []))];

  const catBarHtml = (allSubTags.length
    ? `<div class="novel-subtag-bar" style="display:flex;gap:6px;padding:4px 0 8px;overflow-x:auto">` +
        `<span class="novel-subtag-chip${!currentSubTag ? ' active' : ''}" data-novel-subtag="" style="padding:4px 12px;border-radius:12px;font-size:11px;cursor:pointer;white-space:nowrap;background:${!currentSubTag ? '#8B7355' : '#f5f0eb'};color:${!currentSubTag ? '#fff' : '#8B7355'}">\全\部</span>` +
        allSubTags.map((t) =>
          `<span class="novel-subtag-chip${currentSubTag === t ? ' active' : ''}" data-novel-subtag="${escapeHtml(t)}" style="padding:4px 12px;border-radius:12px;font-size:11px;cursor:pointer;white-space:nowrap;background:${currentSubTag === t ? '#8B7355' : '#f5f0eb'};color:${currentSubTag === t ? '#fff' : '#8B7355'}">${escapeHtml(t)}</span>`
        ).join('') +
      `</div>`
    : '');

  // render search box
  const searchHtml = `<div class="novel-search-wrap">` +
    `<input type="text" class="novel-search-input" placeholder="搜索剧本…" value="${escapeHtml(novelState.scriptSearch)}" />` +
  `</div>`;

  if (!filtered.length) {
    container.innerHTML = catBarHtml + searchHtml +
      novelEmptyHtml('🔍', '没有匹配的剧本', '试试其他分类或关键词');
    bindNovelScriptFilters(container);
    return;
  }

  container.innerHTML =
    catBarHtml + searchHtml +
    `<div class="novel-script-list">` +
    filtered.map((s) => {
      const grad = (s.coverGradient && s.coverGradient.length >= 2)
        ? s.coverGradient.join(', ')
        : '#C9A97A, #8B7355';
      const accent = s.accentColor || '#8B7355';
      const diff = s.difficulty || '中等';
      const diffCls = diff === '简单' ? 'easy' : (diff === '困难' ? 'hard' : 'medium');
      const tags = (s.tags || []).slice(0, 4);
      const desc = s.description || '';
      const shortDesc = desc.length > 84 ? desc.slice(0, 84) + '…' : desc;
      return (
        `<div class="novel-script-card" data-action="open-script" data-script-id="${escapeHtml(s.id)}" style="--card-accent:${escapeHtml(accent)}">` +
          `<div class="novel-script-cover" style="background:linear-gradient(135deg, ${grad});">` +
            `<div class="novel-script-cover-mask"></div>` +
            `<div class="novel-script-cover-text">` +
              `<span class="novel-script-cat">${escapeHtml(s.category || '')}</span>` +
              `<h3>${escapeHtml(s.name)}</h3>` +
            `</div>` +
            `<span class="novel-script-diff ${diffCls}">${escapeHtml(diff)}</span>` +
          `</div>` +
          `<div class="novel-script-info">` +
            (tags.length ? `<div class="novel-script-tags">${tags.map((t) => `<span class="novel-tag">${escapeHtml(t)}</span>`).join('')}</div>` : '') +
            `<p class="novel-script-desc">${escapeHtml(shortDesc)}</p>` +
            `<div class="novel-script-cta">进入剧本 ›</div>` +
          `</div>` +
        `</div>`
      );
    }).join('') +
    `</div>`;

  bindNovelScriptFilters(container);
};

/* ------------------------------------------------------------------ *
 * Bind category chips and search input inside the script list view
 * ------------------------------------------------------------------ */
const bindNovelScriptFilters = (container) => {
  // sub-tag chip clicks
  container.querySelectorAll('.novel-subtag-chip').forEach((chip) => {
    chip.addEventListener('click', () => {
      novelState.scriptSubTag = chip.dataset.novelSubtag || '';
      renderNovelScripts();
    });
  });
  // search input
  const searchInput = container.querySelector('.novel-search-input');
  if (searchInput) {
    searchInput.addEventListener('input', () => {
      novelState.scriptSearch = searchInput.value;
      renderNovelScripts();
    });
  }
};

/* ------------------------------------------------------------------ *
 * Save list
 * ------------------------------------------------------------------ */
const renderNovelSaves = () => {
  const container = $('#novelGameContent');
  if (!container) return;
  if (!novelState.saves.length) {
    container.innerHTML = novelEmptyHtml('💾', '还没有存档', '去剧本库开始一段新故事吧');
    return;
  }
  container.innerHTML =
    `<div class="novel-save-list">` +
    novelState.saves.map((sv) => {
      const time = sv.updatedAt
        ? new Date(sv.updatedAt).toLocaleString('zh-CN', { month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' })
        : '刚刚';
      const initial = (sv.scriptName || '?').slice(0, 1);
      return (
        `<div class="novel-save-card" data-action="load-save" data-save-id="${escapeHtml(sv.id)}">` +
          `<div class="novel-save-thumb">${escapeHtml(initial)}</div>` +
          `<div class="novel-save-info">` +
            `<h4>${escapeHtml(sv.scriptName || '未命名剧本')}</h4>` +
            `<div class="novel-save-meta">` +
              `<span>${escapeHtml(sv.playerName || '未命名')}</span>` +
              `<span class="dot">·</span>` +
              `<span>第${sv.round || 0}轮</span>` +
              `<span class="dot">·</span>` +
              `<span>${escapeHtml(time)}</span>` +
            `</div>` +
          `</div>` +
          `<button class="novel-save-del" data-action="delete-save" data-save-id="${escapeHtml(sv.id)}" type="button" title="删除存档">✕</button>` +
        `</div>`
      );
    }).join('') +
    `</div>`;
};

/* ------------------------------------------------------------------ *
 * Character creation modal
 * ------------------------------------------------------------------ */
const openNovelScript = async (scriptId) => {
  const modal = $('#novelModal');
  const modalContent = $('#novelModalContent');
  if (!modal || !modalContent) return;
  // show loading state immediately
  modalContent.innerHTML = `<div class="novel-modal-loading"><div class="novel-loading-spinner"></div><span>正在加载剧本...</span></div>`;
  modal.classList.add('active');
  try {
    const script = await novelAPI.getScript(scriptId);
    novelState.currentScript = script;
    renderCharacterForm(script);
  } catch (err) {
    modalContent.innerHTML =
      `<div class="novel-modal-error">` +
        `<div class="novel-empty-icon">⚠</div>` +
        `<p class="novel-empty-text">加载剧本失败</p>` +
        `<p class="novel-empty-sub">${escapeHtml(err.message || '未知错误')}</p>` +
      `</div>` +
      `<div class="novel-modal-actions"><button class="novel-btn secondary" data-action="close-modal" type="button">关闭</button></div>`;
  }
};

const renderCharacterForm = (script) => {
  const modalContent = $('#novelModalContent');
  if (!modalContent || !script) return;
  const accent = script.accentColor || '#8B7355';
  /* 检查是否有已有存档 */
  const existingSaves = novelState.saves.filter(s => s.scriptId === script.id);
  const grad = (script.coverGradient && script.coverGradient.length >= 2)
    ? script.coverGradient.join(', ')
    : '#C9A97A, #8B7355';
  const customizable = (script.player && script.player.customizable) || ['name'];
  const defaultStats = (script.player && script.player.defaultStats) || {};
  const startingItems = (script.player && script.player.startingItems) || [];
  const currency = (script.player && script.player.currency) || '';
  const world = script.world || {};
  const rules = world.rules || [];

  modalContent.style.setProperty('--script-accent', accent);
  modalContent.innerHTML =
    `<div class="novel-create">` +
      `<div class="novel-create-hero" style="background:linear-gradient(135deg, ${grad});">` +
        `<span class="novel-create-cat">${escapeHtml(script.category || '')}</span>` +
        `<h3>${escapeHtml(script.name)}</h3>` +
        (script.difficulty ? `<span class="novel-create-diff">${escapeHtml(script.difficulty)}</span>` : '') +
      `</div>` +

      (world.era || world.setting || rules.length
        ? `<div class="novel-create-world">` +
            (world.era ? `<div class="novel-world-era"><span class="novel-world-era-label">时代</span><span>${escapeHtml(world.era)}</span></div>` : '') +
            (world.setting ? `<p class="novel-world-setting">${escapeHtml(world.setting)}</p>` : '') +
            (rules.length ? `<ul class="novel-world-rules">${rules.map((r) => `<li>${escapeHtml(r)}</li>`).join('')}</ul>` : '') +
          `</div>`
        : '') +
      /* NPC 角色设定展示 */
      ((script.npcs && script.npcs.length)
        ? `<div class="novel-create-section"><h4>角色设定</h4><div style="display:flex;flex-direction:column;gap:8px">` +
            script.npcs.map((npc) => `<div style="display:flex;align-items:center;gap:8px;padding:8px 0;border-bottom:1px solid #eee"><div style="width:32px;height:32px;border-radius:50%;background:linear-gradient(135deg,${accent},#C9A97A);flex-shrink:0"></div><div><div style="font-weight:600;font-size:14px">${escapeHtml(npc.name || '未知')}</div><div style="font-size:12px;color:#999">${escapeHtml(npc.role || npc.title || '角色')}</div></div></div>`).join('') +
          `</div></div>`
        : '') +

      /* 目标任务展示 */
      (script.objective
        ? `<div class="novel-create-section"><h4>目标任务</h4><p style="font-size:14px;color:#666;line-height:1.6">${escapeHtml(script.objective)}</p></div>`
        : '') +

      /* 已有存档时显示继续选项 */
      (existingSaves.length
        ? `<div class="novel-create-section"><h4>存档管理</h4>${existingSaves.map((sv) => `<div data-action="load-save" data-save-id="${escapeHtml(sv.id)}" style="display:flex;justify-content:space-between;align-items:center;padding:10px 12px;border:1px solid #eee;border-radius:8px;margin-bottom:6px;cursor:pointer"><div><div style="font-weight:600;font-size:13px">${escapeHtml(sv.playerName || '未命名')}</div><div style="font-size:11px;color:#999">第${sv.round || 0}轮 · ${new Date(sv.updatedAt).toLocaleDateString('zh-CN')}</div></div><span style="color:${accent};font-size:13px">继续 ›</span></div>`).join('')}</div>`
        : '') +


      `<div class="novel-create-section">` +
        `<h4>创建角色</h4>` +
        `<div class="novel-fields">` +
          customizable.map((field) => {
            const label = fieldLabel(field);
            if (SHORT_FIELDS.has(field)) {
              return `<label class="novel-field"><span class="novel-field-label">${escapeHtml(label)}</span>` +
                `<input type="text" data-field="${escapeHtml(field)}" placeholder="输入${escapeHtml(label)}" /></label>`;
            }
            return `<label class="novel-field"><span class="novel-field-label">${escapeHtml(label)}</span>` +
              `<textarea data-field="${escapeHtml(field)}" rows="2" placeholder="描述${escapeHtml(label)}..."></textarea></label>`;
          }).join('') +
        `</div>` +
      `</div>` +

      (Object.keys(defaultStats).length
        ? `<div class="novel-create-section">` +
            `<h4>初始属性 <span class="novel-create-hint">可自由调整</span></h4>` +
            `<div class="novel-stat-grid">` +
              Object.entries(defaultStats).map(([k, v]) => {
                const label = statLabel(k);
                return `<div class="novel-stat-input">` +
                  `<span class="novel-stat-input-label">${escapeHtml(label)}</span>` +
                  `<input type="text" data-stat="${escapeHtml(label)}" value="${escapeHtml(String(v))}" inputmode="numeric" />` +
                `</div>`;
              }).join('') +
            `</div>` +
          `</div>`
        : '') +

      (startingItems.length || currency
        ? `<div class="novel-create-section">` +
            `<h4>初始装备</h4>` +
            (startingItems.length
              ? `<div class="novel-items-row">${startingItems.map((it) => {
                  const name = typeof it === 'string' ? it : (it.name || '');
                  return `<span class="novel-item-pill">${escapeHtml(name)}</span>`;
                }).join('')}</div>`
              : '') +
            (currency ? `<div class="novel-currency">货币：<strong>${escapeHtml(currency)}</strong></div>` : '') +
          `</div>`
        : '') +

      `<div class="novel-modal-actions">` +
        `<button class="novel-btn secondary" data-action="close-modal" type="button">取消</button>` +
        `<button class="novel-btn primary" data-action="create-save" type="button">开始游戏</button>` +
      `</div>` +
    `</div>`;
};

const createNovelSave = async () => {
  const script = novelState.currentScript;
  const modalContent = $('#novelModalContent');
  if (!script || !modalContent) return;

  // collect customizable fields
  const player = {};
  modalContent.querySelectorAll('[data-field]').forEach((el) => {
    player[el.dataset.field] = (el.value || '').trim();
  });
  if (!player.name) player.name = '未命名';

  // collect stats (keys remapped to localized labels so they line up with
  // the AI's [stat±n] badges and the server's apply-changes step)
  const stats = {};
  modalContent.querySelectorAll('input[data-stat]').forEach((el) => {
    const key = el.dataset.stat;
    const raw = (el.value || '').trim() || String(el.defaultValue || '').trim();
    const isNum = /^-?\\d+(\\.\\d+)?$/.test(raw);
    stats[key] = isNum ? Number(raw) : raw;
  });

  // init NPC states
  const npcs = {};
  (script.npcs || []).forEach((npc) => {
    npcs[npc.id] = { trust: 0, attitude: npc.initialAttitude || '陌生' };
  });

  const state = {
    player: { ...player, stats, inventory: [...((script.player && script.player.startingItems) || [])] },
    npcs,
    pendingEvents: []
  };

  const payload = {
    scriptId: script.id,
    scriptName: script.name,
    player,
    state,
    round: 0,
    history: [],
    currentWorld: (script.worlds && script.worlds[0] && script.worlds[0].id) || null
  };

  const btn = modalContent.querySelector('[data-action="create-save"]');
  if (btn) { btn.disabled = true; btn.textContent = '创建中...'; }

  try {
    toast('正在创建角色...');
    const save = await novelAPI.createSave(payload);
    novelState.currentSave = save;
    closeNovelModal();
    await enterNovelStory(save);
  } catch (err) {
    toast('创建失败：' + (err.message || '未知错误'));
  } finally {
    if (btn) { btn.disabled = false; btn.textContent = '开始游戏'; }
  }
};

const closeNovelModal = () => {
  const modal = $('#novelModal');
  const modalContent = $('#novelModalContent');
  if (modal) modal.classList.remove('active');
  if (modalContent) modalContent.style.removeProperty('--script-accent');
};

/* ------------------------------------------------------------------ *
 * Story view — character status header card
 * ------------------------------------------------------------------ */
const getNpcNames = () => {
  const npcs = (novelState.currentScript && novelState.currentScript.npcs) || [];
  return new Set(npcs.map((n) => n.name).filter(Boolean));
};

const setNovelBadges = (round) => {
  const r = Math.max(1, Number(round) || 1);
  const time = $('#novelTimeBadge');
  const rb = $('#novelRoundBadge');
  if (time) time.textContent = `第${r}天`;
  if (rb) rb.textContent = `第${r}轮`;
  /* 属性栏已移至属性模块，无需在此渲染 */
};

/* 属性栏已从剧情页面移除，属性信息在属性模块中展示 */
const renderNovelStatusBar = () => {
  const save = novelState.currentSave;
  const bar = $('#novelStatusBar');
  if (!save || !bar) return;
  const { name, gender, stats, round } = novelPlayerInfo();
  const statEntries = Object.entries(stats).slice(0, 8);
  const dateStr = novelDateStr(round);

  bar.classList.add('has-stats');
  bar.innerHTML =
    `<div class="novel-status-card">` +
      `<div class="novel-status-top">` +
        `<div class="novel-status-avatar">${escapeHtml((name || '?').slice(0, 1))}</div>` +
        `<div class="novel-status-id">` +
          `<div class="novel-status-name">${escapeHtml(name)}</div>` +
          `<div class="novel-status-tags">` +
            (gender ? `<span class="novel-tag-pill">${escapeHtml(gender)}</span>` : '') +
            `<span class="novel-tag-pill ghost">第${round}轮</span>` +
            `<span class="novel-tag-pill ghost" style="color:#FF6B9D">每轮2豆</span>` +
          `</div>` +
        `</div>` +
        `<div class="novel-status-date">` +
          `<span class="novel-status-date-main">${escapeHtml(dateStr)}</span>` +
          `<span class="novel-status-date-sub">第${round}天</span>` +
        `</div>` +
      `</div>` +
      (statEntries.length
        ? `<div class="novel-status-grid">` +
            statEntries.map(([k, v]) =>
              `<div class="novel-stat-cell">` +
                `<span class="novel-stat-cell-icon">${statIcon(k)}</span>` +
                `<span class="novel-stat-cell-label">${escapeHtml(statLabel(k))}</span>` +
                `<span class="novel-stat-cell-value">${escapeHtml(String(v))}</span>` +
              `</div>`
            ).join('') +
          `</div>`
        : `<div class="novel-status-empty">暂无属性</div>`) +
    `</div>`;
};

/* ------------------------------------------------------------------ *
 * Story view — 7-tab bottom navigation
 * ------------------------------------------------------------------ */
const STORY_TABS = [
  { id: 'story', icon: '📖', label: '剧情' },
  { id: 'connections', icon: '👥', label: '人脉' },
  { id: 'phone', icon: '📱', label: '手机' },
  { id: 'attributes', icon: '📊', label: '属性' },
  { id: 'events', icon: '📌', label: '事件' },
  { id: 'assets', icon: '💰', label: '资产' },
  { id: 'settings', icon: '⚙️', label: '设置' }
];

const storyTabBadge = (tabId) => {
  const save = novelState.currentSave;
  if (!save) return '';
  if (tabId === 'events') {
    const n = (save.history || []).length;
    return n > 0 ? String(n) : '';
  }
  if (tabId === 'connections') {
    const npcs = (novelState.currentScript && novelState.currentScript.npcs) || [];
    return npcs.length > 0 ? String(npcs.length) : '';
  }
  return '';
};

const renderTabBarHtml = () =>
  `<nav class="novel-tabbar">` +
    STORY_TABS.map((t) => {
      const badge = storyTabBadge(t.id);
      return `<button class="novel-tabbar-btn" data-story-tab="${t.id}" type="button">` +
        `<span class="novel-tabbar-icon">${t.icon}</span>` +
        `<span class="novel-tabbar-label">${t.label}</span>` +
        (badge ? `<span class="novel-tabbar-badge">${escapeHtml(badge)}</span>` : '') +
      `</button>`;
    }).join('') +
  `</nav>`;

const updateTabBarActive = () => {
  const cur = novelState.storyTab || 'story';
  $$('.novel-tabbar-btn').forEach((b) => {
    b.classList.toggle('active', b.dataset.storyTab === cur);
  });
};

const refreshTabBar = () => {
  const panel = $('#novelActionPanel');
  if (!panel) return;
  const existing = panel.querySelector('.novel-tabbar');
  if (existing) existing.outerHTML = renderTabBarHtml();
  updateTabBarActive();
};

/* Inject the 7-tab bar into the fixed bottom panel and hide the legacy
 * action controls (choices + custom input now live inside the 剧情 content). */
const buildStoryLayout = () => {
  const panel = $('#novelActionPanel');
  if (panel) {
    if (!panel.querySelector('.novel-tabbar')) {
      panel.insertAdjacentHTML('beforeend', renderTabBarHtml());
    }
  }
  const acts = $('#novelActions');
  const custom = document.querySelector('#novelActionPanel .novel-custom-action');
  if (acts) acts.style.display = 'none';
  if (custom) custom.style.display = 'none';
  updateTabBarActive();
};

const switchStoryTab = (tab) => {
  novelState.storyTab = tab;
  updateTabBarActive();
  renderStoryTabContent();
  const scroll = $('#novelStoryScroll');
  if (scroll) scroll.scrollTop = 0;
};

const renderStoryTabContent = () => {
  const content = $('#novelStoryContent');
  if (!content) return;
  const tab = novelState.storyTab || 'story';
  let html = '';
  if (tab === 'story') html = renderStoryTab();
  else if (tab === 'connections') html = renderConnectionsTab();
  else if (tab === 'phone') html = renderPhoneTab();
  else if (tab === 'attributes') html = renderAttributesTab();
  else if (tab === 'events') html = renderEventsTab();
  else if (tab === 'assets') html = renderAssetsTab();
  else if (tab === 'settings') html = renderSettingsTab();
  content.innerHTML = html;
};

/* ------------------------------------------------------------------ *
 * 剧情 (Story) tab
 * ------------------------------------------------------------------ */
const renderWelcomeNarrative = () => {
  const { name } = novelPlayerInfo();
  return `<div class="novel-card novel-card-narrative"><div class="novel-card-body">` +
    `<p class="novel-para">欢迎回来，${escapeHtml(name)}。选择下方行动继续你的故事，或在输入框中自定义行动。</p>` +
  `</div></div>`;
};

const renderStoryTab = () => {
  /* Render all narrative history for scrolling */
  const historyHtml = novelState.narrativeHistory.length
    ? novelState.narrativeHistory.map((entry, idx) => {
        return '<div class="novel-narrative-block" data-round="' + entry.round + '">'
          + '<div class="novel-round-label">第' + entry.round + '轮 · ' + escapeHtml(entry.action || '') + '</div>'
          + entry.html
          + '</div>';
      }).join('')
    : (novelState.lastNarrativeHtml || renderWelcomeNarrative());

  const actions = (novelState.lastActions && novelState.lastActions.length) ? novelState.lastActions : DEFAULT_ACTIONS;
  const letters = ['A', 'B', 'C', 'D', 'E', 'F'];
  const choicesHtml = actions.slice(0, 6).map((a, i) =>
    `<button class="novel-choice-btn" data-action="story-action" data-action-text="${escapeHtml(a)}" type="button">` +
      `<span class="novel-choice-letter">${letters[i] || (i + 1)}</span>` +
      `<span class="novel-choice-text">${escapeHtml(a)}</span>` +
      `<span class="novel-choice-edit" title="编辑">✎</span>` +
    `</button>`
  ).join('');
  return `<div class="novel-story-tab">` +
    `<div class="novel-narrative-history">${historyHtml}</div>` +
    `<div class="novel-choices">${choicesHtml}</div>` +
    (novelState.lastPlayerAction
      ? `<button class="novel-regen-btn" data-action="regenerate" type="button">重新生成</button>`
      : '') +
    `<div class="novel-custom-row">` +
      `<input type="text" class="novel-custom-input" placeholder="输入自定义行动…" />` +
      `<button class="novel-custom-send" data-action="custom-action" type="button" title="发送">➤</button>` +
    `</div>` +
  `</div>`;
};

const renderNovelRecap = () => {
  const save = novelState.currentSave;
  if (!save) return;
  const history = save.history || [];
  let html;
  if (!history.length) {
    html = renderWelcomeNarrative();
  } else {
    const recent = history.slice(-3).reverse();
    html =
      `<div class="novel-recap-label">前情提要</div>` +
      recent.map((h) =>
        `<div class="novel-card novel-card-recap">` +
          `<div class="novel-card-header">第${h.round || '?'}轮 · ${escapeHtml(h.action || '行动')}</div>` +
          `<div class="novel-card-body"><p class="novel-para">${escapeHtml(h.summary || '')}</p></div>` +
        `</div>`
      ).join('') +
      `<div class="novel-card novel-card-hint"><div class="novel-card-body">` +
        `<p class="novel-para">选择下方行动继续，或输入自定义行动。</p>` +
      `</div></div>`;
  }
  novelState.lastNarrativeHtml = html;
  novelState.lastActions = DEFAULT_ACTIONS.slice();
};

/* ------------------------------------------------------------------ *
 * 人脉 (Connections) tab
 * ------------------------------------------------------------------ */
const renderConnectionsTab = () => {
  const save = novelState.currentSave || {};
  const script = novelState.currentScript || {};
  const npcs = script.npcs || [];
  const npcStates = (save.state && save.state.npcs) || {};
  if (!npcs.length) {
    return `<div class="novel-tab-section"><h4 class="novel-section-title"><span class="novel-section-icon">👥</span>人脉关系</h4>` +
      novelEmptyHtml('👥', '暂无人脉', '剧情推进后将结识更多角色') + `</div>`;
  }
  const cards = npcs.map((npc) => {
    const st = npcStates[npc.id] || {};
    const trust = st.trust != null ? Number(st.trust) : 0;
    const name = npc.name || '未知角色';
    const role = npc.role || npc.title || npc.initialAttitude || st.attitude || '角色';
    const desc = npc.description || npc.appearance || npc.personality || '';
    const quote = npc.intro || npc.dialogue || npc.personality || '';
    const hearts = Math.max(0, Math.min(5, Math.round(trust / 20)));
    return `<div class="novel-npc-card">` +
      `<div class="novel-npc-avatar"></div>` +
      `<div class="novel-npc-main">` +
        `<div class="novel-npc-head">` +
          `<span class="novel-npc-name">${escapeHtml(name)}</span>` +
          `<span class="novel-tag-pill">${escapeHtml(role)}</span>` +
        `</div>` +
        `<div class="novel-npc-aff">${'♥'.repeat(hearts)}${'♡'.repeat(5 - hearts)}</div>` +
        (desc ? `<p class="novel-npc-desc">${escapeHtml(desc.length > 60 ? desc.slice(0, 60) + '…' : desc)}</p>` : '') +
        (quote ? `<p class="novel-npc-quote">“${escapeHtml(quote.length > 40 ? quote.slice(0, 40) + '…' : quote)}”</p>` : '') +
      `</div>` +
    `</div>`;
  }).join('');
  return `<div class="novel-tab-section"><h4 class="novel-section-title"><span class="novel-section-icon">👥</span>人脉关系</h4>${cards}</div>`;
};

/* ------------------------------------------------------------------ *
 * 手机 (Phone) tab — simulated home screen
 * ------------------------------------------------------------------ */
const renderPhoneTab = () => {
  const { name, round } = novelPlayerInfo();
  const now = new Date();
  const time = String(now.getHours()).padStart(2, '0') + ':' + String(now.getMinutes()).padStart(2, '0');
  const dateStr = `${now.getFullYear()}年${now.getMonth() + 1}月${now.getDate()}日`;
  const week = ['周日', '周一', '周二', '周三', '周四', '周五', '周六'][now.getDay()];
  const apps = [
    { icon: '👥', name: '通讯录', tab: 'connections' },
    { icon: '💬', name: '社交', tab: '' },
    { icon: '🗺️', name: '地图', tab: '' },
    { icon: '📔', name: '日记', tab: '' },
    { icon: '🛒', name: '商店', tab: '' },
    { icon: '📜', name: '任务', tab: 'events' },
    { icon: '🎒', name: '背包', tab: 'assets' },
    { icon: '⚙️', name: '设置', tab: 'settings' }
  ];
  const appsHtml = apps.map((a) =>
    `<button class="novel-phone-icon" data-phone-tab="${escapeHtml(a.tab)}" type="button">` +
      `<span class="novel-phone-icon-circle">${a.icon}</span>` +
      `<span class="novel-phone-icon-name">${escapeHtml(a.name)}</span>` +
    `</button>`
  ).join('');
  return `<div class="novel-phone-home">` +
    `<div class="novel-phone-clock">` +
      `<div class="novel-phone-clock-time">${time}</div>` +
      `<div class="novel-phone-clock-date">${escapeHtml(dateStr)} ${escapeHtml(week)} · 第${round}天</div>` +
    `</div>` +
    `<div class="novel-phone-widgets">` +
      `<div class="novel-phone-widget"><span class="novel-phone-widget-icon">🌤️</span><div><strong>${escapeHtml(name)}</strong><span>当前角色</span></div></div>` +
      `<div class="novel-phone-widget"><span class="novel-phone-widget-icon">📌</span><div><strong>第${round}轮</strong><span>剧情进度</span></div></div>` +
    `</div>` +
    `<div class="novel-phone-appgrid">${appsHtml}</div>` +
  `</div>`;
};

/* ------------------------------------------------------------------ *
 * 属性 (Attributes) tab
 * ------------------------------------------------------------------ */
const renderAttributesTab = () => {
  const save = novelState.currentSave;
  if (!save) return novelEmptyHtml('📊', '暂无角色信息');
  const { name, gender, stats, player, round } = novelPlayerInfo();
  const dateStr = novelDateStr(round);
  const fields = ['name', 'gender', 'age', 'appearance', 'personality', 'background'];
  const fieldRows = fields.map((f) => {
    const val = (save.player && save.player[f]) || player[f] || '';
    return { key: f, label: fieldLabel(f), val };
  });
  const statsEntries = Object.entries(stats);
  return `<div class="novel-tab-section">` +
    `<div class="novel-profile-card">` +
      `<div class="novel-profile-avatar">${escapeHtml((name || '?').slice(0, 1))}</div>` +
      `<div class="novel-profile-name">${escapeHtml(name)}</div>` +
      (gender ? `<span class="novel-tag-pill">${escapeHtml(gender)}</span>` : '') +
      `<span class="novel-tag-pill ghost">第${round}轮</span>` +
      `<span class="novel-tag-pill ghost">${escapeHtml(dateStr)}</span>` +
    `</div>` +
    `<div class="novel-attr-group">` +
      `<h5 class="novel-attr-group-title">基本信息</h5>` +
      fieldRows.map((f) =>
        `<div class="novel-attr-row" data-action="edit-attribute" data-key="${escapeHtml(f.key)}">` +
          `<span class="novel-attr-label">${escapeHtml(f.label)}</span>` +
          `<span class="novel-attr-value">${f.val ? escapeHtml(f.val) : '<span class="novel-attr-placeholder">点击编辑</span>'}</span>` +
        `</div>`
      ).join('') +
    `</div>` +
    `<div class="novel-attr-group">` +
      `<h5 class="novel-attr-group-title">属性数值</h5>` +
      `<div class="novel-attr-grid">` +
        statsEntries.map(([k, v]) =>
          `<div class="novel-attr-cell" data-action="edit-stat" data-key="${escapeHtml(k)}">` +
            `<span class="novel-attr-cell-icon">${statIcon(k)}</span>` +
            `<span class="novel-attr-cell-label">${escapeHtml(statLabel(k))}</span>` +
            `<span class="novel-attr-cell-value">${escapeHtml(String(v))}</span>` +
          `</div>`
        ).join('') +
      `</div>` +
    `</div>` +
  `</div>`;
};

/* ------------------------------------------------------------------ *
 * 事件 (Events) tab
 * ------------------------------------------------------------------ */
const renderEventsTab = () => {
  const save = novelState.currentSave || {};
  const history = save.history || [];
  const head = `<h4 class="novel-section-title"><span class="novel-section-icon">🔖</span>关键事件</h4>`;
  if (!history.length) {
    return `<div class="novel-tab-section">${head}` + novelEmptyHtml('📌', '暂无事件', '剧情推进后将记录关键事件') + `</div>`;
  }
  const items = history.slice().reverse();
  const cards = items.map((h) => {
    const round = h.round || '?';
    const title = h.action || '行动';
    const preview = (h.summary || '').replace(/\s+/g, ' ');
    const short = preview.length > 60 ? preview.slice(0, 60) + '…' : preview;
    return `<div class="novel-event-card">` +
      `<div class="novel-event-icon">📌</div>` +
      `<div class="novel-event-body">` +
        `<div class="novel-event-head">` +
          `<span class="novel-event-title">${escapeHtml(title)}</span>` +
          `<span class="novel-event-round">第${round}轮</span>` +
        `</div>` +
        `<p class="novel-event-preview">${escapeHtml(short)}</p>` +
      `</div>` +
    `</div>`;
  }).join('');
  return `<div class="novel-tab-section">${head}${cards}</div>`;
};

/* ------------------------------------------------------------------ *
 * 资产 (Assets) tab
 * ------------------------------------------------------------------ */
const renderAssetsTab = () => {
  const save = novelState.currentSave;
  if (!save) return novelEmptyHtml('💰', '暂无资产');
  const { stats, round, player } = novelPlayerInfo();
  const inventory = player.inventory || [];
  const npcCount = Object.keys((save.state && save.state.npcs) || {}).length;
  const goals = [
    { name: '剧情推进', pct: Math.min(100, Math.round(round / 30 * 100)) },
    { name: '人际拓展', pct: Math.min(100, Math.round(npcCount / 5 * 100)) }
  ];
  const goalsHtml = goals.map((g) =>
    `<div class="novel-goal">` +
      `<div class="novel-goal-head"><span>${escapeHtml(g.name)}</span><span>${g.pct}%</span></div>` +
      `<div class="novel-goal-bar"><div class="novel-goal-fill" style="width:${g.pct}%"></div></div>` +
    `</div>`
  ).join('');
  const invHtml = inventory.length ? inventory.map((it) => {
    const name = typeof it === 'string' ? it : (it.name || '物品');
    const source = (typeof it === 'object' && it.source) ? it.source : '初始装备';
    return `<div class="novel-asset-card">` +
      `<div class="novel-asset-icon">📦</div>` +
      `<div class="novel-asset-info">` +
        `<span class="novel-asset-name">${escapeHtml(name)}</span>` +
        `<span class="novel-asset-source">${escapeHtml(source)}</span>` +
      `</div>` +
    `</div>`;
  }).join('') : `<p class="novel-empty-sub">暂无物品</p>`;
  return `<div class="novel-tab-section">` +
    `<h4 class="novel-section-title"><span class="novel-section-icon">🎯</span>目标</h4>` +
    `<div class="novel-goals">${goalsHtml}</div>` +
    `<h4 class="novel-section-title"><span class="novel-section-icon">💰</span>资产</h4>` +
    `<div class="novel-assets">${invHtml}</div>` +
  `</div>`;
};

/* ------------------------------------------------------------------ *
 * 设置 (Settings) tab
 * ------------------------------------------------------------------ */
const renderSettingsTab = () => {
  const save = novelState.currentSave;
  const time = save && save.updatedAt ? new Date(save.updatedAt).toLocaleString('zh-CN') : '刚刚';
  const cloudSaves = (novelState.saves || []).filter((s) => s.id !== (save && save.id)).slice(0, 3);
  const cloudHtml = cloudSaves.length ? cloudSaves.map((s) =>
    `<div class="novel-save-slot" data-action="load-save" data-save-id="${escapeHtml(s.id)}">` +
      `<div class="novel-save-slot-info">` +
        `<strong>${escapeHtml(s.scriptName || '存档')}</strong>` +
        `<span>${escapeHtml(s.playerName || '')} · 第${s.round || 0}轮</span>` +
      `</div>` +
      `<span class="novel-save-slot-go">载入</span>` +
    `</div>`
  ).join('') : `<p class="novel-empty-sub">暂无其他存档</p>`;
  /* Story length options */
  const lengthOptions = [
    { key: 'short', label: '短文', range: '100-200字' },
    { key: 'medium', label: '中文', range: '200-400字' },
    { key: 'long', label: '长文', range: '400-800字' }
  ];
  const currentLength = novelState.storyLength || 'medium';
  const lengthHtml = lengthOptions.map(opt =>
    `<label class="novel-length-option${opt.key === currentLength ? ' active' : ''}" data-length="${opt.key}">` +
      `<input type="radio" name="storyLength" value="${opt.key}" ${opt.key === currentLength ? 'checked' : ''} style="display:none" />` +
      `<span class="novel-length-label">${opt.label}</span>` +
      `<span class="novel-length-range">${opt.range}</span>` +
    `</label>`
  ).join('');

  return `<div class="novel-tab-section">` +
    `<h4 class="novel-section-title"><span class="novel-section-icon">✍️</span>剧情字数</h4>` +
    `<div class="novel-length-grid">${lengthHtml}</div>` +
    `<div class="novel-settings-actions">` +
      `<button class="novel-btn secondary" data-action="exit-game" type="button">退出</button>` +
      `<button class="novel-btn" data-action="save-game" type="button">存档</button>` +
    `</div>` +
    `<h4 class="novel-section-title"><span class="novel-section-icon"></span>存档管理</h4>` +
    `<div class="novel-save-block">` +
      `<div class="novel-save-block-head"><span>本地存档</span><span class="novel-save-block-time">${escapeHtml(time)}</span></div>` +
      `<button class="novel-btn block" data-action="save-game" type="button">覆盖存档</button>` +
    `</div>` +
    `<div class="novel-save-block">` +
      `<div class="novel-save-block-head"><span>云端存档</span></div>` +
      cloudHtml +
    `</div>` +
  `</div>`;
};

/* Inline editors for the 属性 tab (local-only; persists on explicit save). */
const handleEditAttribute = (row) => {
  const key = row.dataset.key;
  const save = novelState.currentSave;
  if (!save || !key) return;
  if (!save.player) save.player = {};
  const cur = save.player[key] || '';
  const nv = prompt('编辑' + fieldLabel(key), cur);
  if (nv == null) return;
  save.player[key] = nv.trim();
  renderStoryTabContent();
};

const handleEditStat = (cell) => {
  const key = cell.dataset.key;
  const save = novelState.currentSave;
  if (!save || !save.state || !save.state.player || !key) return;
  const stats = save.state.player.stats || (save.state.player.stats = {});
  const cur = stats[key] != null ? String(stats[key]) : '';
  const nv = prompt('编辑 ' + statLabel(key), cur);
  if (nv == null) return;
  const t = nv.trim();
  const isNum = /^-?\\d+(\\.\\d+)?$/.test(t);
  stats[key] = isNum ? Number(t) : t;
  /* 属性栏在属性模块中，切换到属性页时自动刷新 */
  if (novelState.storyTab === 'attributes') renderStoryTabContent();
};

/* ------------------------------------------------------------------ *
 * Story view — entering / round generation
 * ------------------------------------------------------------------ */
const enterNovelStory = async (save) => {
  if (!save) return;
  novelState.currentSave = save;
  novelState.lastResult = null;
  novelState.isLoading = false;
  novelState.storyTab = 'story';
  novelState.lastNarrativeHtml = '';
  novelState.narrativeHistory = [];
  novelState.lastActions = DEFAULT_ACTIONS.slice();

  // ensure the full script is available (needed for NPC names / theming)
  if (!novelState.currentScript || novelState.currentScript.id !== save.scriptId) {
    try {
      novelState.currentScript = await novelAPI.getScript(save.scriptId);
    } catch (e) {
      novelState.currentScript = null;
      toast('剧本信息加载失败，部分功能可能受限');
    }
  }

  // theme the story view with a warm earth-tone accent
  const story = $('#novelGameStory');
  if (story) story.style.setProperty('--script-accent', '#8B7355');

  // switch views
  const main = $('#novelGameMain');
  if (main) main.style.display = 'none';
  if (story) story.style.display = 'flex';

  buildStoryLayout();
  setNovelBadges(Math.max(save.round || 0, 1));
  if ($('#novelStoryScroll')) $('#novelStoryScroll').scrollTop = 0;

  const isNewGame = (save.round || 0) === 0 && (!save.history || save.history.length === 0);
  if (isNewGame) {
    // generate the opening narration directly
    await generateNovelRound('开始游戏，请生成开场剧情并介绍世界观与初始处境');
  } else {
    renderNovelRecap();
    renderStoryTabContent();
  }
};

const generateNovelRound = async (action, customAction) => {
  const save = novelState.currentSave;
  if (!save || novelState.isLoading) return;
  novelState.isLoading = true;
  novelState.lastPlayerAction = action || customAction || '';

  if (novelState.storyTab === 'story') {
    const contentEl = $('#novelStoryContent');
    if (contentEl) contentEl.innerHTML = `<div class="novel-story-tab"><div class="novel-narrative">${novelLoadingHtml('AI 正在生成剧情...')}</div></div>`;
  }

  try {
    const result = await novelAPI.action({
      saveId: save.id,
      action: action || '',
      customAction: customAction || ''
    });
    novelState.lastResult = result;
  /* Handle phone notifications from AI */
  if (result.phoneNotifications && Array.isArray(result.phoneNotifications)) {
    novelState.phoneNotifications.push(...result.phoneNotifications);
    /* Process notifications into messages/moments */
    result.phoneNotifications.forEach(notif => {
      if (notif.type === 'message' && notif.from) {
        const npcId = notif.from;
        if (!novelState.phoneMessages[npcId]) novelState.phoneMessages[npcId] = [];
        novelState.phoneMessages[npcId].push({
          from: notif.from,
          content: notif.preview || '',
          time: new Date().toISOString()
        });
      } else if (notif.type === 'moment' && notif.from) {
        novelState.phoneMoments.unshift({
          from: notif.from,
          content: notif.preview || '',
          time: new Date().toISOString()
        });
      }
    });
  }

    /* 按规格书：处理结构化AI响应 */
    const narrative = result.content || '剧情生成失败，请重试。';
    let html = '';

    /* 属性检定面板 */
    if (result.attributeCheck) html += renderAttributeCheck(result.attributeCheck);

    /* 结局横幅 */
    if (result.isEnding && result.endingName) {
      html += renderEndingBanner(result.endingName, narrative);
    }

    /* 剧情正文（用旧解析器处理纯文本部分） */
    const npcNames = getNpcNames();
    const parsed = parseNovelContent(narrative, npcNames);
    html += renderStoryCards(parsed);

    /* 状态变化摘要 */
    const sc = result.stateChanges || {};
    const changesSummary = renderStateChangesSummary(sc, result.statChanges);
    if (changesSummary) html += changesSummary;

    /* Append to narrative history instead of replacing */
    novelState.lastNarrativeHtml = html;
    novelState.narrativeHistory.push({
      round: result.round || (save.round || 0) + 1,
      action: novelState.lastPlayerAction,
      html: html
    });

    /* 选项：优先用结构化options，fallback到文本提取 */
    if (result.options && result.options.length) {
      novelState.lastActions = result.options.slice(0, 6);
    } else {
      novelState.lastActions = (parsed.actions && parsed.actions.length) ? parsed.actions : DEFAULT_ACTIONS.slice();
    }

    setNovelBadges(result.round || Math.max(save.round || 0, 1));

    if (novelState.storyTab === 'story') renderStoryTabContent();
    refreshTabBar();

    const scroll = $('#novelStoryScroll');
    if (scroll) scroll.scrollTop = scroll.scrollHeight;

    await applyNovelRound(result, customAction || action || '继续探索');
  } catch (err) {
    novelState.lastNarrativeHtml = novelEmptyHtml('⚠', '剧情生成失败', err.message || '未知错误');
    novelState.lastActions = DEFAULT_ACTIONS.slice();
    if (novelState.storyTab === 'story') renderStoryTabContent();
  } finally {
    novelState.isLoading = false;
  }
};

const applyNovelRound = async (result, actionText) => {
  const save = novelState.currentSave;
  if (!save || !result) return;
  const changes = result.statChanges || [];
  const stateChanges = result.stateChanges || {};
  const historyEntry = {
    round: result.round || (save.round || 0) + 1,
    action: actionText,
    summary: (result.content || '').slice(0, 220).replace(/\s+/g, ' '),
    changes,
    isEnding: result.isEnding || false,
    endingName: result.endingName || null
  };
  try {
    const updated = await novelAPI.applyChanges({ saveId: save.id, changes, stateChanges, historyEntry });
    novelState.currentSave = updated;
    if (novelState.storyTab === 'attributes') renderStoryTabContent();
    if (novelState.storyTab === 'connections') renderStoryTabContent();
    refreshTabBar();
  } catch (err) {
    toast('状态同步失败：' + (err.message || ''));
  }
};

/* ------------------------------------------------------------------ *
 * Content parsing (UU-style card-based narrative)
 * ------------------------------------------------------------------ */
const formatInline = (text) => {
  if (!text) return '';
  let t = text; // text is already HTML-escaped upstream
  // stat change badges:  [stat+n]  [stat-n]  [境界+1阶]
  t = t.replace(/\[\s*([^\[\]]+?)\s*([+\-]\d+)\s*\]/g, (m, stat, delta) => {
    const d = Number(delta);
    const cls = d >= 0 ? 'positive' : 'negative';
    const sign = d >= 0 ? '+' : '';
    return `<span class="novel-stat-badge ${cls}">${stat}${sign}${d}</span>`;
  });
  // bold
  t = t.replace(/\*\*([^*]+?)\*\*/g, '<strong>$1</strong>');
  return t;
};

const renderBodyLines = (lines, npcNames) => {
  const html = [];
  let listBuffer = [];
  const flushList = () => {
    if (listBuffer.length) {
      html.push('<ul class="novel-list">' + listBuffer.map((li) => `<li>${formatInline(li)}</li>`).join('') + '</ul>');
      listBuffer = [];
    }
  };
  for (const raw of lines) {
    const line = raw.trim();
    if (!line) { flushList(); continue; }

    // markdown sub-header
    const hm = line.match(/^#{1,5}\\s+(.+)$/);
    if (hm) { flushList(); html.push(`<h5 class="novel-sub-h">${formatInline(hm[1])}</h5>`); continue; }

    // list item:  1. / 1、 / 1) / ① / - / * / •
    const lm = line.match(/^(?:\\d+[.、)]\\s*|[①②③④⑤⑥⑦⑧⑨⑩]\\s*|[-*•]\\s+)(.+)$/);
    if (lm) { listBuffer.push(lm[1].trim()); continue; }

    // dialogue:  Speaker：speech  (speaker is a known NPC, or speech opens with a quote)
    const dm = line.match(/^([^\\s【】()():：]{1,10})[：:]\\s*(.+)$/);
    if (dm) {
      const speaker = dm[1];
      const speech = dm[2];
      const isNpc = npcNames && npcNames.has(speaker);
      const startsQuote = /^["”“「『]/.test(speech);
      if (isNpc || startsQuote) {
        flushList();
        html.push(`<div class="novel-dialogue">` +
          `<span class="novel-speaker">${formatInline(speaker)}</span>` +
          `<span class="novel-quote">${formatInline(speech)}</span>` +
        `</div>`);
        continue;
      }
    }

    // pure quoted line
    if (/^["”“「『][\\s\\S]+["”“」』]$/.test(line)) {
      flushList();
      html.push(`<div class="novel-dialogue novel-dialogue-anon">${formatInline(line)}</div>`);
      continue;
    }

    // plain paragraph
    flushList();
    html.push(`<p class="novel-para">${formatInline(line)}</p>`);
  }
  flushList();
  return html.join('');
};

const parseNovelContent = (text, npcNames) => {
  const escaped = escapeHtml(text || '');
  const lines = escaped.split('\\n');
  const cards = [];
  let header = null;
  let body = [];
  let actions = [];
  let isActions = false;

  const flush = () => {
    while (body.length && !body[0].trim()) body.shift();
    while (body.length && !body[body.length - 1].trim()) body.pop();
    if (header === null && body.length === 0) { header = null; body = []; isActions = false; return; }
    if (isActions) {
      actions = extractActions(body);
      isActions = false;
    } else {
      cards.push({ header, bodyHtml: renderBodyLines(body, npcNames) });
    }
    header = null;
    body = [];
  };

  for (const raw of lines) {
    const m = raw.match(/^【([^】]+)】(.*)$/);
    if (m) {
      flush();
      const title = m[1].trim();
      const rest = m[2];
      isActions = /可选行动|行动选择|你的选择|接下来|行动选项|选择行动|请选择|你可以选择/.test(title);
      header = title;
      body = rest ? [rest] : [];
    } else {
      body.push(raw);
    }
  }
  flush();

  return { cards, actions };
};


const renderStoryCards = (parsed) => {
  if (!parsed.cards.length) {
    return `<div class="novel-card novel-card-narrative"><div class="novel-card-body">` +
      `<p class="novel-para novel-para-muted">（本轮没有生成文本，请尝试其他行动）</p>` +
    `</div></div>`;
  }
  return parsed.cards.map((c) => {
    if (c.header) {
      return `<div class="novel-card">` +
        `<div class="novel-card-header">${formatInline(c.header)}</div>` +
        `<div class="novel-card-body">${c.bodyHtml}</div>` +
      `</div>`;
    }
    return `<div class="novel-card novel-card-narrative"><div class="novel-card-body">${c.bodyHtml}</div></div>`;
  }).join('');
};

const extractActions = (lines) => {
  const actions = [];
  for (const raw of lines) {
    const line = raw.trim();
    if (!line) continue;
    // split when another numbered marker appears on the same line
    const parts = line.split(/(?=\\s*\\d+[.、)]|\\s*[①②③④⑤⑥⑦⑧⑨⑩])/);
    for (let part of parts) {
      part = part.trim();
      const m = part.match(/^(?:\\d+[.、)]\\s*|[①②③④⑤⑥⑦⑧⑨⑩]\\s*|[-*•]\\s+)(.+)$/);
      if (!m) continue;
      let a = m[1].trim().replace(/【[^】]*】/g, '').trim();
      if (!a) continue;
      if (/自定义|自行输入|自由行动/.test(a)) continue;
      actions.push(a);
    }
  }
  if (!actions.length) return DEFAULT_ACTIONS.slice();
  return actions.slice(0, 6);
};

/* Keep the function name for compatibility; choices are now rendered as part
 * of the 剧情 tab content. This caches the actions and refreshes the view. */
const renderNovelActions = (actions) => {
  const list = (actions && actions.length) ? actions : DEFAULT_ACTIONS;
  novelState.lastActions = list.slice();
  if (novelState.storyTab === 'story') renderStoryTabContent();
};

/* ------------------------------------------------------------------ *
 * 规格书新增：属性检定面板渲染
 * ------------------------------------------------------------------ */
const renderAttributeCheck = (check) => {
  if (!check) return '';
  const successClass = check.success ? 'novel-check-success' : 'novel-check-fail';
  const icon = check.success ? '✅' : '❌';
  const label = check.success ? '检定成功' : '检定失败';
  return `<div class="novel-attribute-check ${successClass}">` +
    `<div class="novel-check-header">` +
      `<span class="novel-check-icon">${icon}</span>` +
      `<span class="novel-check-label">属性检定：${label}</span>` +
    `</div>` +
    `<div class="novel-check-body">` +
      `<div class="novel-check-row"><span>行动</span><span>${escapeHtml(check.action || '')}</span></div>` +
      `<div class="novel-check-row"><span>检定属性</span><span>${escapeHtml(check.attribute || '')}</span></div>` +
      `<div class="novel-check-row"><span>需要</span><span class="novel-check-threshold">≥ ${check.threshold || 0}</span></div>` +
      `<div class="novel-check-row"><span>当前</span><span class="novel-check-value">${check.currentValue || 0}</span></div>` +
      `<div class="novel-check-result">${escapeHtml(check.result || '')}</div>` +
    `</div>` +
  `</div>`;
};

/* ------------------------------------------------------------------ *
 * 规格书新增：结局横幅渲染
 * ------------------------------------------------------------------ */
const renderEndingBanner = (endingName, narrative) => {
  return `<div class="novel-ending-banner">` +
    `<div class="novel-ending-stars">✦ ✦ ✦</div>` +
    `<div class="novel-ending-title">— 结局达成 —</div>` +
    `<div class="novel-ending-name">${escapeHtml(endingName)}</div>` +
    `<div class="novel-ending-narrative">${escapeHtml((narrative || '').slice(0, 300))}</div>` +
    `<div class="novel-ending-stars">✦ ✦ ✦</div>` +
  `</div>`;
};

/* ------------------------------------------------------------------ *
 * 规格书新增：状态变化摘要渲染
 * ------------------------------------------------------------------ */
const renderStateChangesSummary = (sc, legacyChanges) => {
  const badges = [];
  if (sc && sc.attributes) {
    for (const [k, v] of Object.entries(sc.attributes)) {
      const d = Number(v);
      const cls = d >= 0 ? 'positive' : 'negative';
      const sign = d >= 0 ? '+' : '';
      badges.push(`<span class="novel-stat-badge ${cls}">${escapeHtml(k)} ${sign}${d}</span>`);
    }
  }
  if (sc && sc.inventoryAdd) {
    for (const item of sc.inventoryAdd) {
      badges.push(`<span class="novel-stat-badge positive">🎒 ${escapeHtml(item)}</span>`);
    }
  }
  if (sc && sc.inventoryRemove) {
    for (const item of sc.inventoryRemove) {
      badges.push(`<span class="novel-stat-badge negative">🎒 -${escapeHtml(item)}</span>`);
    }
  }
  if (sc && sc.relationshipChanges) {
    for (const [npc, val] of Object.entries(sc.relationshipChanges)) {
      const d = Number(val);
      const cls = d >= 0 ? 'positive' : 'negative';
      const sign = d >= 0 ? '+' : '';
      badges.push(`<span class="novel-stat-badge ${cls}">♥ ${escapeHtml(npc)} ${sign}${d}</span>`);
    }
  }
  /* fallback到旧格式 */
  if (!badges.length && legacyChanges) {
    for (const c of legacyChanges) {
      const d = Number(c.delta);
      const cls = d >= 0 ? 'positive' : 'negative';
      const sign = d >= 0 ? '+' : '';
      badges.push(`<span class="novel-stat-badge ${cls}">${escapeHtml(c.stat)} ${sign}${d}</span>`);
    }
  }
  if (!badges.length) return '';
  return `<div class="novel-changes-summary"><span class="novel-changes-label">状态变化</span><div class="novel-changes-badges">${badges.join('')}</div></div>`;
};

/* ------------------------------------------------------------------ *
 * In-game phone panel (legacy overlay, opened when an action mentions 手机)
 * ------------------------------------------------------------------ */
var openInGamePhone = function() {
  novelState.phoneView = 'home';
  var phonePanel = $('#novelPhonePanel');
  if (!phonePanel) return;
  phonePanel.classList.add('active');
  renderInGamePhone();
};

var closeInGamePhone = function() {
  var phonePanel = $('#novelPhonePanel');
  if (!phonePanel) return;
  phonePanel.classList.remove('active');
};

var renderInGamePhone = function() {
  var phonePanel = $('#novelPhonePanel');
  if (!phonePanel) return;

  var save = novelState.currentSave;
  var playerName = save ? save.characterName || (save.player && save.player.name) || '你' : '你';
  var realm = save && save.state && save.state.player ? (save.state.player.realm || '凡人') : '凡人';
  var vitality = save && save.state && save.state.player ? (save.state.player.vitality || 8) : 8;
  var maxVitality = 10;

  var apps = [
    { id: 'contacts', icon: '📖', name: '通讯录', desc: 'NPC联系人', color: '#C9A97A' },
    { id: 'social', icon: '💬', name: '社交', desc: '宗门与好友', color: '#A88B6D' },
    { id: 'map', icon: '🗺️', name: '地图', desc: '世界探索', color: '#8B7355' },
    { id: 'diary', icon: '🌸', name: '日记', desc: '记录与回忆', color: '#D9B38C' },
    { id: 'shop', icon: '🛍️', name: '商店', desc: '购买物品', color: '#B08968' },
    { id: 'settings', icon: '⚙️', name: '设置', desc: '游戏设置', color: '#9C8A78' },
    { id: 'quests', icon: '📜', name: '任务', desc: '主线与支线', color: '#C9A97A', hasNotification: true },
    { id: 'inventory', icon: '🎒', name: '背包', desc: '道具与物品', color: '#A88B6D' }
  ];

  var appsHtml = apps.map(function(app) {
    var notification = app.hasNotification ? '<span class="novel-phone-app-notification">!</span>' : '';
    var activeClass = novelState.phoneView === app.id ? ' active' : '';
    return '<button class="novel-phone-app' + activeClass + '" data-phone-app="' + app.id + '" type="button">' +
      '<div class="novel-phone-app-icon" style="background:' + app.color + '">' + app.icon + '</div>' +
      '<span class="novel-phone-app-name">' + app.name + '</span>' +
      notification +
    '</button>';
  }).join('');

  phonePanel.innerHTML =
    '<div class="novel-phone-header">' +
      '<button class="novel-phone-back" type="button">‹</button>' +
      '<span class="novel-phone-title">手机</span>' +
      '<span class="novel-phone-time">' + (save && save.state ? save.state.gameTime || '第1月·上旬' : '第1月·上旬') + '</span>' +
    '</div>' +
    '<div class="novel-phone-status">' +
      '<div class="novel-phone-status-avatar">' + escapeHtml(playerName.charAt(0)) + '</div>' +
      '<div class="novel-phone-status-info">' +
        '<span class="novel-phone-status-name">' + escapeHtml(playerName) + '</span>' +
        '<span class="novel-phone-status-realm">' + escapeHtml(realm) + '</span>' +
      '</div>' +
      '<div class="novel-phone-status-bars">' +
        '<div class="novel-phone-status-bar"><span>体力 ' + vitality + '/' + maxVitality + '</span></div>' +
      '</div>' +
    '</div>' +
    '<div class="novel-phone-apps">' + appsHtml + '</div>';
};

var switchPhoneApp = function(appId) {
  novelState.phoneView = appId;
  renderInGamePhone();
};

/* ------------------------------------------------------------------ *
 * Save / navigation
 * ------------------------------------------------------------------ */
const saveNovelGame = async () => {
  const save = novelState.currentSave;
  if (!save) return;
  try {
    await novelAPI.createSave(save);
    toast('存档已保存');
  } catch (err) {
    toast('保存失败：' + (err.message || ''));
  }
};

const backToNovelMain = () => {
  const story = $('#novelGameStory');
  const main = $('#novelGameMain');
  if (story) story.style.display = 'none';
  if (main) main.style.display = '';
  const phonePanel = $('#novelPhonePanel');
  if (phonePanel) phonePanel.classList.remove('active');
  novelState.currentSave = null;
  novelState.lastResult = null;
  novelState.isLoading = false;
  novelState.storyTab = 'story';
  novelState.lastNarrativeHtml = '';
  novelState.lastActions = DEFAULT_ACTIONS.slice();
  // refresh lists (progress may have changed)
  loadNovelSaves();
  if (novelState.currentTab === 'scripts') loadNovelScripts();
};

const submitCustomAction = async () => {
  if (novelState.isLoading) return;
  const input = document.querySelector('#novelStoryContent .novel-custom-input');
  const val = (input && input.value || '').trim();
  if (!val) { toast('请输入自定义行动'); return; }
  if (input) input.value = '';
  await generateNovelRound('', val);
};

/* ------------------------------------------------------------------ *
 * Data loading
 * ------------------------------------------------------------------ */
const loadNovelScripts = async () => {
  try {
    const data = await novelAPI.listScripts();
    novelState.scripts = (data && data.list) || [];
  } catch (err) {
    console.warn('加载剧本失败', err);
    novelState.scripts = [];
  }
  if (novelState.currentTab === 'scripts') renderNovelScripts();
};

const loadNovelSaves = async () => {
  try {
    const data = await novelAPI.listSaves();
    novelState.saves = (data && data.list) || [];
  } catch (err) {
    console.warn('加载存档失败', err);
    novelState.saves = [];
  }
  if (novelState.currentTab === 'saves') renderNovelSaves();
};

/* ------------------------------------------------------------------ *
 * Event delegation (dynamic content)
 * ------------------------------------------------------------------ */
document.addEventListener('click', async (e) => {
  // main view tab switching (剧本库 / 我的存档)
  const tabBtn = e.target.closest('[data-novel-tab]');
  if (tabBtn) {
    novelState.currentTab = tabBtn.dataset.novelTab;
    $$('.novel-tabs [data-novel-tab]').forEach((b) => b.classList.toggle('active', b === tabBtn));
    if (novelState.currentTab === 'scripts') { renderNovelScripts(); loadNovelScripts(); }
    else { renderNovelSaves(); loadNovelSaves(); }
    return;
  }

  // in-game 7-tab switching
  const storyTabBtn = e.target.closest('[data-story-tab]');
  if (storyTabBtn) { switchStoryTab(storyTabBtn.dataset.storyTab); return; }

  // phone home screen app icon -> jump to a related tab
  const phoneTabBtn = e.target.closest('[data-phone-tab]');
  if (phoneTabBtn && phoneTabBtn.dataset.phoneTab) { switchStoryTab(phoneTabBtn.dataset.phoneTab); return; }

  // legacy in-game phone overlay: close button + app switching
  if (e.target.closest('.novel-phone-back')) { closeInGamePhone(); return; }
  const phoneAppBtn = e.target.closest('[data-phone-app]');
  if (phoneAppBtn) { switchPhoneApp(phoneAppBtn.dataset.phoneApp); return; }

  // open a script -> character creation modal
  const openScript = e.target.closest('[data-action="open-script"]');
  if (openScript) { openNovelScript(openScript.dataset.scriptId); return; }

  // create save from modal
  if (e.target.closest('[data-action="create-save"]')) { createNovelSave(); return; }

  // close modal
  if (e.target.closest('[data-action="close-modal"]')) { closeNovelModal(); return; }

  // delete save (stopPropagation so the card's load handler doesn't fire)
  const delBtn = e.target.closest('[data-action="delete-save"]');
  if (delBtn) {
    e.stopPropagation();
    const saveId = delBtn.dataset.saveId;
    if (!confirm('确认删除这个存档？此操作不可恢复。')) return;
    try {
      await novelAPI.deleteSave(saveId);
      toast('存档已删除');
      loadNovelSaves();
    } catch (err) {
      toast('删除失败：' + (err.message || ''));
    }
    return;
  }

  // load save -> enter story
  const loadSave = e.target.closest('[data-action="load-save"]');
  if (loadSave) {
    const saveId = loadSave.dataset.saveId;
    try {
      const save = await novelAPI.getSave(saveId);
      await enterNovelStory(save);
    } catch (err) {
      toast('加载存档失败：' + (err.message || ''));
    }
    return;
  }

  // choose a story action (A/B/C choices)
  const storyAct = e.target.closest('[data-action="story-action"]');
  if (storyAct && !novelState.isLoading) {
    const text = storyAct.dataset.actionText || '';
    // if action mentions phone, open the in-game phone panel instead of an API call
    if (/手机/.test(text)) {
      openInGamePhone();
      return;
    }
    await generateNovelRound(text, '');
    return;
  }

  // regenerate last round
  const regenBtn = e.target.closest('[data-action="regenerate"]');
  if (regenBtn && !novelState.isLoading && novelState.lastPlayerAction && novelState.lastResult) {
    await generateNovelRound(novelState.lastPlayerAction, '');
    return;
  }

  // custom action send button
  if (e.target.closest('[data-action="custom-action"]')) { submitCustomAction(); return; }

  // save / exit from the 设置 tab
  if (e.target.closest('[data-action="save-game"]')) { saveNovelGame(); return; }
  if (e.target.closest('[data-action="exit-game"]')) { backToNovelMain(); return; }

  // inline editors in the 属性 tab
  const editAttr = e.target.closest('[data-action="edit-attribute"]');
  if (editAttr) { handleEditAttribute(editAttr); return; }
  const editStat = e.target.closest('[data-action="edit-stat"]');
  if (editStat) { handleEditStat(editStat); return; }
});

/* ------------------------------------------------------------------ *
 * Static element bindings
 * ------------------------------------------------------------------ */
const bindNovelEvents = () => {
  $('#novelStoryBack')?.addEventListener('click', () => backToNovelMain());
  $('#novelSaveBtn')?.addEventListener('click', () => saveNovelGame());

  // custom action: Enter key (delegated so it survives re-rendering of the input)
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' && e.target && e.target.classList && e.target.classList.contains('novel-custom-input')) {
      e.preventDefault();
      submitCustomAction();
    }
  });

  // click on the overlay backdrop (outside the modal box) closes the modal
  const modal = $('#novelModal');
  if (modal) {
    modal.addEventListener('click', (e) => {
      if (e.target === modal) closeNovelModal();
    });
  }
};

/* ------------------------------------------------------------------ *
 * Init
 * ------------------------------------------------------------------ */
const initNovelGame = () => {
  bindNovelEvents();
  if (novelState.currentTab === 'scripts') renderNovelScripts();
  else renderNovelSaves();
  loadNovelScripts();
  loadNovelSaves();
};

// Reload data when the page becomes active (debounced).
let novelReloadTimer = null;
const observeNovelPage = () => {
  const page = $('#novelGamePage');
  if (!page) return;
  const observer = new MutationObserver(() => {
    if (!page.classList.contains('active')) return;
    clearTimeout(novelReloadTimer);
    novelReloadTimer = setTimeout(() => {
      loadNovelScripts();
      loadNovelSaves();
    }, 200);
  });
  observer.observe(page, { attributes: true, attributeFilter: ['class'] });
};

// Delay init to ensure the DOM (and globals from index.html) is ready.
setTimeout(() => {
  initNovelGame();
  observeNovelPage();
}, 100);
