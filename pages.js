/**
 * store.js — 全局状态管理 + localStorage 持久化
 * 所有数据都存在浏览器本地，刷新不丢失。
 */
(function () {
  'use strict';

  const STORE_KEY = CONFIG.storageKey;

  // —— 默认数据结构 ——
  function defaultData() {
    return {
      // 用户信息
      user: {
        name: '小墨的主人',
        id: String(Math.floor(Math.random() * 900000000) + 100000000),
        avatar: '🧑',         // emoji 头像
        beans: CONFIG.currency.startBalance,
        createdAt: Date.now(),
        lastDaily: 0,          // 上次签到时间戳
        days: 1,               // 使用天数
      },

      // 设置（运行时可覆盖 CONFIG）
      settings: {
        apiKey: CONFIG.api.apiKey,
        baseURL: CONFIG.api.baseURL,
        model: CONFIG.api.model,
        temperature: CONFIG.api.temperature,
        maxTokens: CONFIG.api.maxTokens,
        theme: 'pink',          // pink | blue | green | dark
        fontSize: 'medium',     // small | medium | large
        autoMemory: true,       // 自动沉淀回忆
        streaming: true,        // 流式输出
      },

      // 角色列表
      characters: [],

      // 聊天记录  { [charId]: [{role,content,time}] }
      chats: {},

      // 文游存档
      saves: [],

      // 当前文游进度
      currentGame: null,

      // 回忆（记忆）
      memories: [],

      // 世界书列表
      worldBooks: [],

      // 同人文生成历史
      fanfics: [],

      // 论坛帖子
      forumPosts: [],

      // 通知
      notifications: [],
    };
  }

  let data = null;

  // —— 加载 ——
  function load() {
    try {
      const raw = localStorage.getItem(STORE_KEY);
      if (raw) {
        data = JSON.parse(raw);
        // 合并新字段（版本兼容）
        const def = defaultData();
        for (const k in def) {
          if (data[k] === undefined) data[k] = def[k];
        }
        if (data.settings) {
          for (const k in def.settings) {
            if (data.settings[k] === undefined) data.settings[k] = def.settings[k];
          }
        }
      } else {
        data = defaultData();
        save();
      }
    } catch (e) {
      console.error('Store load error:', e);
      data = defaultData();
    }
    return data;
  }

  // —— 保存 ——
  function save() {
    try {
      localStorage.setItem(STORE_KEY, JSON.stringify(data));
    } catch (e) {
      console.error('Store save error:', e);
    }
  }

  // —— 获取 / 设置 ——
  function get() {
    if (!data) load();
    return data;
  }

  function set(partial) {
    if (!data) load();
    Object.assign(data, partial);
    save();
  }

  function update(path, value) {
    if (!data) load();
    const keys = path.split('.');
    let obj = data;
    for (let i = 0; i < keys.length - 1; i++) {
      if (!obj[keys[i]]) obj[keys[i]] = {};
      obj = obj[keys[i]];
    }
    obj[keys[keys.length - 1]] = value;
    save();
  }

  // —— 豆子 ——
  function addBeans(n) {
    if (!data) load();
    data.user.beans += n;
    if (data.user.beans < 0) data.user.beans = 0;
    save();
    return data.user.beans;
  }

  function spendBeans(n) {
    if (!data) load();
    if (data.user.beans < n) return false;
    data.user.beans -= n;
    save();
    return true;
  }

  // —— 签到 ——
  function dailyCheckIn() {
    if (!data) load();
    const today = new Date().toDateString();
    const last = data.user.lastDaily ? new Date(data.user.lastDaily).toDateString() : '';
    if (today === last) return { ok: false, msg: '今天已经签到过了哦~' };
    data.user.lastDaily = Date.now();
    data.user.beans += CONFIG.currency.dailyReward;
    data.user.days += 1;
    save();
    return { ok: true, msg: `签到成功！获得 ${CONFIG.currency.dailyReward} 豆子 🎉`, beans: data.user.beans };
  }

  // —— 重置 ——
  function reset() {
    localStorage.removeItem(STORE_KEY);
    data = defaultData();
    save();
  }

  // —— 导出 / 导入 ——
  function exportData() {
    if (!data) load();
    return JSON.stringify(data, null, 2);
  }

  function importData(jsonStr) {
    try {
      const obj = JSON.parse(jsonStr);
      data = Object.assign(defaultData(), obj);
      save();
      return true;
    } catch (e) {
      return false;
    }
  }

  // —— ID 生成 ——
  function uid() {
    return Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
  }

  window.Store = { load, save, get, set, update, addBeans, spendBeans, dailyCheckIn, reset, exportData, importData, uid };
})();
