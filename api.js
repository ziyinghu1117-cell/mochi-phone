/**
 * Mochi-Phone 配置文件
 * ====================================================================
 * ⚠️  安全警告 / SECURITY WARNING
 * 此文件包含 API 密钥。如果你要把项目放到公开的 GitHub 仓库，
 * 强烈建议你把 apiKey 改成空字符串，改用环境变量或在本地填写。
 * 任何人拿到这个密钥都能消耗你的 API 额度！
 * ====================================================================
 */
const CONFIG = {
  // —— API 配置 ——
  api: {
    baseURL: 'https://az.zlapi.vip/v1',
    apiKey: 'sk-YCm0hGZ8wlLzKz4U04yVraOF4aIaiEaJ2J2VV08Ju6u7KjCl',
    // 默认模型，可在「设置」页修改。常见可用值：gpt-4o-mini / gpt-4o / claude-3-5-sonnet / deepseek-chat 等
    model: 'gpt-4o-mini',
    // 备选模型列表（设置页下拉用）
    modelOptions: [
      'gpt-4o-mini',
      'gpt-4o',
      'gpt-3.5-turbo',
      'claude-3-5-sonnet',
      'claude-3-haiku',
      'deepseek-chat',
      'deepseek-reasoner',
      'gemini-2.0-flash',
      'gemini-1.5-pro',
    ],
    temperature: 0.85,
    maxTokens: 2000,
  },

  // —— 应用信息 ——
  app: {
    name: 'Mochi-Phone',
    version: '1.0.0',
    subtitle: '温柔陪伴 · 文游世界',
  },

  // —— 货币（豆子）—— 纯本地，每天签到 +10，聊天/文游消耗
  currency: {
    dailyReward: 10,
    chatCost: 1,
    wenyuCost: 2,
    fanficCost: 3,
    startBalance: 30,
  },

  // —— 存储 key ——
  storageKey: 'mochi_phone_data_v1',
};

// 暴露到全局
window.CONFIG = CONFIG;
