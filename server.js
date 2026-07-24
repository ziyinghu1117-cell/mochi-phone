import express from 'express';
import cors from 'cors';
import helmet from 'helmet';
import dotenv from 'dotenv';
import fs from 'fs';
import path from 'path';
import { randomUUID } from 'crypto';
import { fileURLToPath } from 'url';

dotenv.config();

const app = express();
const PORT = Number(process.env.PORT || 3000);
const HOST = process.env.HOST || '0.0.0.0';
// FRONTEND_HTML is inlined

const config = {
  upstreamBase: 'https://az.zlapi.vip/v1',
  upstreamKey: process.env.UPSTREAM_API_KEY || 'sk-YCm0hGZ8wlLzKz4U04yVraOF4aIaiEaJ2J2VV08Ju6u7KjCl',
  upstreamModel: '[0.005]自营伪流/gemini-2.5-flash',
  chatBeansCost: Number(process.env.CHAT_BEANS_COST || 2),
  beansPerCny: Number(process.env.BEANS_PER_CNY || 10),
  rechargePackages: String(process.env.RECHARGE_PACKAGES || '6:60,18:200,30:360,68:900')
    .split(',')
    .map((item) => {
      const [amount, beans] = item.split(':').map(Number);
      return { amount, beans };
    })
    .filter((item) => Number.isFinite(item.amount) && Number.isFinite(item.beans)),
  demoInitialBeans: Number(process.env.DEMO_INITIAL_BEANS || 30)
};

const users = new Map();
const transactions = [];
const communityRoles = [];
const userMemories = new Map();
const userProfiles = new Map();
const directMessages = new Map();
const novelGameSaves = new Map();
const novelGameStates = new Map();
const stats = { totalRechargeCny: 0, totalBeansConsumed: 0, totalChatCount: 0, totalRefundBeans: 0 };

const DATA_DIR = process.env.DATA_DIR || path.join(path.dirname(fileURLToPath(import.meta.url)), '.data');
const DATA_FILE = process.env.DATA_FILE || path.join(DATA_DIR, 'mochi-phone-data.json');
let saveTimer = null;

const saveDataNow = () => {
  try {
    fs.mkdirSync(DATA_DIR, { recursive: true });
    const payload = {
      version: 1,
      updatedAt: new Date().toISOString(),
      users: [...users.values()],
      transactions: transactions.slice(-1000),
      memories: Object.fromEntries([...userMemories.entries()].map(([userId, list]) => [userId, list.slice(-300)])),
      profiles: Object.fromEntries([...userProfiles.entries()].map(([userId, p]) => [userId, p])),
      messages: Object.fromEntries([...directMessages.entries()].map(([userId, list]) => [userId, list.slice(-200)])),
      novelGames: Object.fromEntries([...novelGameSaves.entries()].map(([userId, list]) => [userId, list.slice(-50)])),
      stats
    };
    fs.writeFileSync(DATA_FILE, JSON.stringify(payload, null, 2), 'utf8');
  } catch (error) {
    console.warn('保存数据失败：', error.message);
  }
};

const saveData = () => {
  clearTimeout(saveTimer);
  saveTimer = setTimeout(saveDataNow, 120);
};

const loadData = () => {
  try {
    if (!fs.existsSync(DATA_FILE)) return;
    const payload = JSON.parse(fs.readFileSync(DATA_FILE, 'utf8'));
    if (Array.isArray(payload.users)) {
      for (const user of payload.users) {
        if (user?.id) users.set(String(user.id).slice(0, 80), {
          id: String(user.id).slice(0, 80),
          beans: Number.isFinite(Number(user.beans)) ? Number(user.beans) : config.demoInitialBeans,
          createdAt: user.createdAt || new Date().toISOString()
        });
      }
    }
    if (Array.isArray(payload.transactions)) transactions.push(...payload.transactions.slice(-1000));
    if (payload.memories && typeof payload.memories === 'object') {
      for (const [userId, list] of Object.entries(payload.memories)) {
        if (Array.isArray(list)) userMemories.set(String(userId).slice(0, 80), list.slice(-300));
      }
    }
    if (payload.stats && typeof payload.stats === 'object') {
      Object.assign(stats, {
        totalRechargeCny: Number(payload.stats.totalRechargeCny || 0),
        totalBeansConsumed: Number(payload.stats.totalBeansConsumed || 0),
        totalChatCount: Number(payload.stats.totalChatCount || 0),
        totalRefundBeans: Number(payload.stats.totalRefundBeans || 0)
      });
    }
    if (payload.profiles && typeof payload.profiles === 'object') {
      for (const [userId, p] of Object.entries(payload.profiles)) {
        if (p && typeof p === 'object') userProfiles.set(String(userId).slice(0, 80), p);
      }
    }
    if (payload.messages && typeof payload.messages === 'object') {
      for (const [userId, list] of Object.entries(payload.messages)) {
        if (Array.isArray(list)) directMessages.set(String(userId).slice(0, 80), list.slice(-200));
      }
    }
    if (payload.novelGames && typeof payload.novelGames === 'object') {
      for (const [userId, list] of Object.entries(payload.novelGames)) {
        if (Array.isArray(list)) novelGameSaves.set(String(userId).slice(0, 80), list.slice(-50));
      }
    }
  } catch (error) {
    console.warn('读取数据失败，将使用空数据启动：', error.message);
  }
};

loadData();
process.on('SIGTERM', () => { saveDataNow(); process.exit(0); });
process.on('SIGINT', () => { saveDataNow(); process.exit(0); });

const ok = (res, data = {}, message = 'success') => res.json({ code: 0, message, data });

// ============================================================
// EMBEDDED DATA (generated by build script)
// ============================================================

const EMBEDDED_NOVEL_GAMES = {
  ["_design-principles"]: {
  "id": "_design-principles",
  "name": "文游通用设计原则（基于用户模板）",
  "_comment": "本文件汇总自用户提供的四份设计模板，由服务端自动注入每个剧本的 systemPrompt 前置区域，不需要在剧本列表中展示。",
  "_hidden": true,
  "principles": {
    "ironRules": [
      "世界规则高于剧情方便：经济、资源、阶层、法律、力量体系必须稳定运行，不能为推进剧情临时改变底层规则",
      "高自由度不等于无条件成功：玩家可拒绝主线、改变目标、自定义行动，但结果受能力、资源、时间、身份、关系、信息和世界规则限制",
      "NPC不是等待玩家触发的工具人：所有重要NPC有自己的生活、目标、关系、压力、秘密和日程，玩家不介入时世界仍会发展",
      "故事由人物、系统与选择共同产生：事件由当前时间、地点、资源、玩家状态、NPC目标、世界趋势、未解决伏笔和适度随机扰动共同生成",
      "任何重要变化都必须渐进：顶级能力、巨大财富、深度信任和亲密关系都需长期积累，禁止几轮内完成所有成长",
      "主线结束不等于游戏结束：完成主线后进入新的生活、经营、关系或世界阶段，只有玩家明确选择结束时才收束"
    ],
    "worldBuilding": [
      "世界观必须解释：世界如何运行、普通人如何生活、资源从哪里来、权力由谁掌握、哪些规则不能绕过",
      "世界设定必须能进入事件和选择，不能只是背景介绍",
      "故事开始时，世界正在发生的长期变化、矛盾与潜在危机要自然呈现"
    ],
    "playerDesign": [
      "玩家必须同时具有优势与短板，开局资源足够开始行动但不能跳过成长",
      "玩家身份真实影响他人的态度、可接触的信息、能获得的机会和必须承担的风险",
      "第一轮要让玩家立刻看见核心玩法、当前问题和至少一个可自由选择的方向"
    ],
    "gameplayLoops": [
      "日常短循环（1-3轮反馈）：照顾、接待、工作、训练、学习、采集、社交、休息",
      "中期成长循环（3-10轮变化）：设施升级、性格成长、职业进阶、关系升温或恶化、区域解锁",
      "长期阶段循环（跨越季节/年份）：事业扩张、家庭变化、势力重组、世界危机、生活转型",
      "沙盒继续循环：主线完成后仍能继续生活、经营、探索、社交和建设"
    ],
    "npcDesign": [
      "人物由经历、处境、欲望、价值观和选择构成，不得只用标签代替",
      "每个重要NPC都有玩家之外的生活、关系、责任、秘密与日程",
      "人物对玩家的态度必须有来源：欣赏、戒备、厌恶、依赖、爱慕都需要具体事件和时间积累",
      "人物可以拒绝玩家、误解玩家、离开玩家、选择他人或坚持自己的目标",
      "缺点必须真实造成问题，优点也可能在某些情境下变成负担",
      "秘密必须影响行为，不能只作为装饰写入",
      "NPC行为引擎每轮判断顺序：当前目标→掌握的信息与误解→与在场人物的关系→当前情绪与压力→可用资源与风险→选择最符合人格的行动",
      "NPC不得读取玩家内心、后台数值或自己不可能知道的信息",
      "玩家长时间不联系时，NPC会继续工作、交友、改变计划或解决自己的问题",
      "重要NPC应有主动发起事件的条件，而不是永远等待玩家触发"
    ],
    "relationshipSystem": [
      "关系至少区分：熟悉、信任、尊重、依赖、吸引、利益绑定、恐惧、怨恨、亏欠与边界",
      "同一行为对不同人物产生不同影响，取决于价值观、经历、处境和信息",
      "关系变化要记录原因，不只记录数值",
      "亲密不等于完全信任，忠诚不等于喜欢，爱情不等于放弃责任",
      "关系破裂应有修复条件与不可修复部分，道歉不能自动消除伤害",
      "NPC之间的关系会反过来影响玩家"
    ],
    "eventSystem": [
      "事件必须从世界、人物、资源、时间或旧选择中产生，不能只因本轮需要刺激而随机出现",
      "重要事件要有触发条件、原因、参与者、行动空间、即时结果、延迟后果和后续分支",
      "玩家不选择某个事件也会产生后果：机会过期、NPC自行处理、问题恶化、他人介入",
      "选择不能只是不同措辞后得到同一结果，每个重要选项至少改变关系、资源、信息、时间、身份或世界状态中的两项",
      "事件触发公式：当前时间/季节/地点 + 玩家身份/能力/资源/近期行动 + NPC当前目标/日程/关系/秘密 + 已解决/未解决事件与延迟后果 + 世界趋势/组织计划 + 适度随机扰动 = 本轮候选事件",
      "触发类型：强触发（条件满足必须发生）、软触发（提高概率）、窗口触发（特定时间地点人物）、累积触发（多次小选择到阈值）、反应触发（NPC回应玩家行为）、世界触发（不依赖玩家）"
    ],
    "butterflyEffect": [
      "微小选择先改变人物印象、资源或信息，再通过NPC行动形成后续事件，不要直接跳到巨大结局",
      "重要选择至少设计一项即时可见后果和一项数轮后出现的隐藏后果",
      "善意选择也可能带来资源压力、误解、依赖或敌对关注；自利选择也可能短期有效但损害长期关系",
      "一个事件可同时改变多条线",
      "旧选择应在合适时刻被人物提起、被制度记录或改变机会",
      "长期后果要有兑现窗口与替代路径，避免永远悬而不决"
    ],
    "pacing": [
      "建立最近五至十轮事件记录，连续两轮避免相同核心冲突，连续三轮避免同一人物占据全部焦点",
      "重大事件后必须有余波和休整轮",
      "不要用反复误会、意外拥抱、突然生病、被绑架、偷听秘密等少数桥段撑长篇",
      "同一人物事件应随关系阶段变化：陌生、熟悉、合作、冲突、亲密或疏远时的矛盾不同",
      "随着时间推进，开放新地点、新人物、新责任和新层级，不只是提高数值"
    ],
    "actionResolution": [
      "玩家提出行动后，先判断目标、方法、已知信息、能力、资源、时间、环境和相关人物态度",
      "结果可以是：成功、部分成功、付出代价后成功、失败但获得信息、失败并打开新局面",
      "不得用毫无依据的随机数字决定一切，高风险行动可综合条件给出合理概率或叙事判定",
      "失败不应频繁直接结束游戏，可通过损失、伤病、债务、关系恶化、机会错过形成新故事",
      "玩家不能凭一句自定义行动绕过长期成长、资源不足、人物底线、法律和世界规则"
    ],
    "continuityLedger": [
      "每轮结束后内部更新：日期、时间、季节、天气、地点、已消耗时间",
      "玩家资源、技能、健康、压力、物品、事业、责任和当前目标",
      "重要NPC的位置、目标、关系、已知信息和正在进行的独立行动",
      "已发生事件、未解决问题、伏笔、秘密、延迟后果和世界趋势",
      "最近五轮的主要场景、冲突和奖励，防止重复",
      "当前短期、中期和长期目标是否仍有发展空间"
    ],
    "outputFormat": [
      "【当前时间与环境】日期、时段、季节、天气、地点、环境变化",
      "【核心状态面板】只展示当前玩法真正需要的公开状态",
      "【本轮正文】第二人称沉浸叙事，行动、对话、感官、心理、事件结果自然融合",
      "【经营或成长结算】收入、支出、资源、成长等明确变化",
      "【相关人物与世界动态】只展示玩家能够知道的3-6项，不泄露隐藏秘密",
      "【当前可处理事项】尚未解决的问题、约定、线索、责任或近期目标",
      "【可选行动】4-8个方向明显不同的选项 + 始终保留【自定义行动】"
    ],
    "forbidden": [
      "禁止无逻辑万能系统、无代价开挂、所有人自动喜欢玩家、反派集体降智",
      "禁止用大量空洞属性、重复任务和每日流水账伪装高自由度",
      "禁止所有选项最终回到同一结果，或玩家不走主线世界就停止",
      "禁止突然出现与世界规则不符的物品、能力、财富、关系、线索或身份",
      "禁止几轮内经营登顶、获得顶级能力、彻底攻略重要人物或解决终极危机",
      "禁止虚报几百个事件、无限NPC，却只给几个例子和省略号",
      "禁止使用'其余略''以此类推''后续自行扩展'等占位句代替核心规则"
    ]
  }
}
,
  ["ancient-life"]: {
  "id": "ancient-life",
  "name": "浮生六记",
  "category": "古代人生",
  "tags": ["古代", "生活", "种田", "经商", "人生"],
  "difficulty": "简单",
  "description": "青萝镇的炊烟总在卯时升起。你是镇上一户寻常人家的子弟，门前有薄田两亩，屋后有杏花一树。春耕秋收，读书经商，谈婚论嫁，生老病死——没有金戈铁马，只有柴米油盐。浮生若梦，把这烟火日子过好，便已是了不起的一生。",
  "coverGradient": ["#1b5e20", "#c8a165"],
  "accentColor": "#6d4c41",
  "fontHeading": "'Ma Shan Zheng', cursive",
  "world": {
    "era": "架空古代·江南小镇",
    "setting": "江南水乡青萝镇，小桥流水、粉墙黛瓦。你是一户寻常人家的子弟，春耕秋收、读书经商、谈婚论嫁、生老病死——浮生若梦，过好这烟火日子，便是了不起的一生。",
    "rules": [
      "时间按季节/节气推进，春耕夏耘秋收冬藏，违时则歉收",
      "科举与经商两条出路皆苦：功名靠积累与机缘，商贾靠诚信与勤勉",
      "婚丧嫁娶是人生大事，门第、聘礼、人言皆有讲究",
      "健康与家和人最贵，积劳成疾、家宅不宁皆是劫",
      "天灾人祸、疫病、官府盘剥是真实变量",
      "年成丰歉影响粮价与生计，节气主导农事与赶集",
      "人生阶段不可逆，每个选择都塑造最终结局"
    ]
  },
  "player": {
    "customizable": ["name", "age", "gender", "familyBackground", "personality", "lifeAspiration"],
    "defaultStats": {
      "wealth": 30,
      "health": 80,
      "knowledge": 20,
      "relationships": 40,
      "status": 10,
      "happiness": 50
    },
    "startingItems": ["祖屋一间", "薄田两亩", "几卷旧书", "一枚镇纸"],
    "currency": "两"
  },
  "npcs": [
    {
      "id": "neighbor-afu",
      "name": "阿福",
      "world": "main",
      "role": "邻居",
      "gender": "男",
      "appearance": "三十岁，黝黑壮实，一笑露出一口白牙，裤腿永远卷到膝盖，手里不是锄头就是扁担",
      "surface": "憨厚热心、嗓门大、爱串门，哪家有事第一个到",
      "deep": "一辈子没出过镇子，把邻里当亲人。热心是天性，也怕夜里一个人对着空屋子",
      "goal": "守着老婆孩子热炕头，日子越过越红火",
      "fear": "天灾人祸，颗粒无收，一家人揭不开锅",
      "secret": "他家祖坟地里有块断碑，刻着前朝藏银的暗语，他至今没敢挖",
      "initialAttitude": "热络",
      "attitudeFactors": {
        "trustUp": ["互帮互助", "不嫌弃他粗人", "危难时搭把手"],
        "trustDown": ["算计他家", "嫌贫爱富", "忘恩负义"]
      }
    },
    {
      "id": "merchant-hu",
      "name": "胡掌柜",
      "world": "main",
      "role": "商人",
      "gender": "男",
      "appearance": "四十五岁，圆融富态，长衫整洁，算盘挂在腰间，笑起来一团和气，眼珠却转得飞快",
      "surface": "和气生财、八面玲珑、算盘打得精",
      "deep": "白手起家，深知市井不易，精明却不黑心，待诚信之人极厚，待奸滑之人极狠",
      "goal": "把生意做到府城，给子孙留一份稳当的家业",
      "fear": "官府盘剥、同行倾轧，一朝回到解放前",
      "secret": "他暗中资助过几位落魄书生，图的是日后科举有人提携，这份长线投资从不对人说",
      "initialAttitude": "察言观色",
      "attitudeFactors": {
        "trustUp": ["诚实守信", "童叟无欺", "互利共赢"],
        "trustDown": ["短斤缺两", "赖账违约", "见利忘义"]
      }
    },
    {
      "id": "scholar-liu",
      "name": "柳青云",
      "world": "main",
      "role": "书生",
      "gender": "男",
      "appearance": "二十二岁，清瘦白净，一身洗得发白的青衫，腰间别一卷书，眼里有光也有愁",
      "surface": "清高迂腐、满口之乎者也、不善农事",
      "deep": "胸有丘壑却困于贫寒，迂腐是清高也是无奈，骨子里想经世济民，奈何连笔墨都要赊",
      "goal": "科举入仕，光耀门楣，不辜负一肚子学问",
      "fear": "屡试不第，半生蹉跎，辜负家人期望",
      "secret": "他写的一篇策论被某位京官看中，正暗中传信招他入京，他却犹豫该不该舍下寒妻",
      "initialAttitude": "礼貌疏离",
      "attitudeFactors": {
        "trustUp": ["敬重学问", "资助他读书", "不拿清贫取笑"],
        "trustDown": ["附庸风雅却轻慢学问", "市侩势利", "当面折他颜面"]
      }
    }
  ],
  "eventTypes": {
    "daily": { "ratio": 0.3, "desc": "日常：耕作、赶集、读书、炊烟的市井日常" },
    "character": { "ratio": 0.18, "desc": "人物：邻居、商人、书生、家人的往来" },
    "growth": { "ratio": 0.12, "desc": "成长：学识、家业、声望、技艺积累" },
    "main": { "ratio": 0.15, "desc": "主线：成家立业、科举经商、生儿育女的人生节点" },
    "world": { "ratio": 0.1, "desc": "世界：四季节气、丰歉年景、官府政令、市集盛衰" },
    "crisis": { "ratio": 0.1, "desc": "危机：天灾、瘟疫、官司、破产、丧亲" },
    "hidden": { "ratio": 0.05, "desc": "隐藏：祖产秘辛、断碑藏银、贵人机缘" }
  },
  "systemPrompt": "你是《浮生六记》古代人生文游模拟器。\n\n【最高铁律】\n1. 浮生若梦，没有金手指，寻常日子过好便是了不起\n2. 季节循环主导一切：春耕夏耘秋收冬藏，违时则歉收\n3. 科举与经商两条出路皆苦，功名靠积累与机缘，商贾靠诚信与勤勉\n4. 婚丧嫁娶是人生大事，门第、聘礼、人言皆有讲究\n5. 健康与家和人最贵，积劳成疾、家宅不宁皆是劫\n\n【季节与日常】按节气推进，农事随季、赶集逢圩、读书赴考各有其时；年成丰歉影响粮价与生计。科举看积累机缘，经商凭诚信勤勉；婚配看门第人品，丧事讲礼制孝道，婚丧嫁娶皆是镇上大事。\n\n【叙事风格】古典生活散文，温润如水墨。重风物：炊烟、杏花、蝉鸣、霜柿、灶火。第二人称视角，日常琐碎中见人情冷暖。\n\n【每轮输出格式】\n1.【X年·某节气】时令、农事、镇上动静\n2.【状态面板】家财/健康/学识/人缘/声望/心境\n3.【本轮正文】1000-2000字\n4.【街坊动态】3-5项\n5.【当前生计】农事、买卖、功课、家事\n6.【可选行动】4-6个+【自定义行动】\n\n【数值变化标注】\n[家财±n两][健康±n][学识±n][人缘±n][声望±n][心境±n]格式，重大人生节点须标注长远影响。",
  "items": [
    { "id": "farm-tools", "name": "农具一套", "type": "装备", "price": 20, "effect": "提升耕作效率与收成" },
    { "id": "old-books", "name": "几卷旧书", "type": "任务物品", "price": 0, "effect": "读书增学问，科举之基" },
    { "id": "silk-goods", "name": "丝绸货物", "type": "消耗品", "price": 100, "effect": "经商售卖获利" },
    { "id": "dowry", "name": "嫁妆聘礼", "type": "消耗品", "price": 200, "effect": "婚嫁必需，影响门第与体面" },
    { "id": "herb-medicine", "name": "草药", "type": "消耗品", "price": 15, "effect": "治病养生，应对疫病" },
    { "id": "exam-kit", "name": "考篮文房", "type": "任务物品", "price": 0, "effect": "科举赴考必备" }
  ]
}
,
  ["business-management"]: {
  "id": "business-management",
  "name": "烟火人间",
  "category": "经营发展",
  "tags": ["经营", "商战", "模拟", "烟火气", "成长"],
  "difficulty": "中等",
  "description": "你接手了古镇巷尾一家三代传承的客栈兼餐馆'半闲居'。灶台冷了太久，账本红得刺眼，街对面新开的连锁店正虎视眈眈。从一锅汤、一桌客、一盏招牌灯开始，你能否在这青石板巷里，把烟火气重新点亮，把日子熬成招牌？",
  "coverGradient": ["#6d4c41", "#ff7043"],
  "accentColor": "#e65100",
  "fontHeading": "'ZCOOL XiaoWei', serif",
  "world": {
    "era": "现代都市",
    "setting": "南方水乡古镇锦溪镇，青石板巷尾一家三代传承的客栈兼餐馆'半闲居'。古镇正被开发成旅游目的地，游人如织与原住民的人情味在此交织。你接手了这家濒临倒闭的老店，要在时代洪流中守住烟火、守住根。",
    "rules": [
      "时间按周推进，分淡旺季与节庆节点，影响客流与原料价格",
      "资金、声誉、员工、品质、库存五维构成经营核心，任一崩盘即失败",
      "竞品会动态扩张：连锁店、网红店会侵蚀你的市场份额",
      "顾客满意度由品质、服务、性价比三重累积，口碑起效慢、崩塌快",
      "员工有忠诚度与熟练度，压榨与忽视会反噬为怠工与流失",
      "扩张需先稳定现金流，盲目开店会触发资金链断裂危机",
      "节庆、季节、社会事件触发限定商机或风险"
    ]
  },
  "player": {
    "customizable": ["name", "age", "background", "managementStyle", "shopConcept", "signatureDish"],
    "defaultStats": {
      "funds": 50000,
      "reputation": 30,
      "staff": 40,
      "quality": 50,
      "inventory": 60,
      "stress": 20
    },
    "startingItems": ["祖传菜谱手札", "半闲居钥匙串", "试营业木牌", "首批食材"],
    "currency": "¥"
  },
  "npcs": [
    {
      "id": "rival-qian",
      "name": "钱多宝",
      "world": "main",
      "role": "竞争对手",
      "gender": "男",
      "appearance": "四十出头，圆脸富态，金链半隐于衬衫领口，笑起来眼睛眯成缝，递烟递茶极会来事",
      "surface": "精明圆滑、笑脸迎人、出手阔绰，开口就是'咱们街坊一场'",
      "deep": "他其实是古镇原住民，怕整条街被外地资本吞掉，收购你是想守住地盘。手段虽狠，底线是不让古镇变味",
      "goal": "收购半闲居，整合古镇餐饮，挡住外地资本",
      "fear": "古镇被资本整条吞下，老街坊再无立足之地",
      "secret": "他年轻时是你爷爷的学徒，因偷学配方被赶出师门，至今耿耿于怀",
      "initialAttitude": "试探拉拢",
      "attitudeFactors": {
        "trustUp": ["坦诚交底", "守住老味道", "不投靠外地资本"],
        "trustDown": ["投靠外地资本", "压价恶性竞争", "瞧不起老街坊"]
      }
    },
    {
      "id": "mentor-zhou",
      "name": "老周",
      "world": "main",
      "role": "师傅/导师",
      "gender": "男",
      "appearance": "六十出头，花白头发束在脑后，围裙上沾满油渍与岁月，一双手粗糙却稳得能颠勺如飞",
      "surface": "古板固执、说话刻薄、对年轻人没好气，张口就是'你懂个屁'",
      "deep": "他在半闲居掌勺四十年，怕手艺失传，刻薄是怕你不当回事。他比你更爱这间店",
      "goal": "把祖传手艺传下去，不让老味道在他手里断了",
      "fear": "半闲居变成只卖噱头的网红店，老顾客再也找不到回家的味道",
      "secret": "他记得半闲居失传的最后一道招牌菜，配方锁在脑子里，只传有缘人",
      "initialAttitude": "观望",
      "attitudeFactors": {
        "trustUp": ["尊重老配方", "肯下苦功", "不偷工减料"],
        "trustDown": ["急功近利", "用半成品糊弄", "瞧不起老规矩"]
      }
    },
    {
      "id": "customer-shen",
      "name": "沈清",
      "world": "main",
      "role": "潜在恋人/食客",
      "gender": "女",
      "appearance": "二十七八岁，素面朝天却气质出众，总背一台相机，吃菜前先认真闻一闻再动筷",
      "surface": "知性从容、镜头感强、对食物极挑剔，夸一句比登天还难",
      "deep": "在名利场倦了，想找一处真正的'人间烟火'。挑剔，是在寻找久违的真实",
      "goal": "找到值得停下来的味道，也找到值得停留的人",
      "fear": "再一次被流量裹挟，失去真实的自己",
      "secret": "她出身餐饮世家，因与家人决裂才离家做美食博主，从未真正放下",
      "initialAttitude": "客气疏离",
      "attitudeFactors": {
        "trustUp": ["拿出真诚的手艺", "不迎合流量", "记得她的口味"],
        "trustDown": ["把她当流量工具", "敷衍出品", "刻意讨好"]
      }
    }
  ],
  "eventTypes": {
    "daily": { "ratio": 0.3, "desc": "日常：采购备货、掌勺待客、收银盘账的烟火日常" },
    "character": { "ratio": 0.2, "desc": "人物：对手、师傅、熟客、街坊的人情往来" },
    "growth": { "ratio": 0.12, "desc": "成长：配方改良、口碑发酵、技能精进" },
    "main": { "ratio": 0.15, "desc": "主线：扭亏、扩建、危机、品牌化的阶段节点" },
    "world": { "ratio": 0.1, "desc": "世界：节庆旺季、古镇改造、旅游政策" },
    "crisis": { "ratio": 0.08, "desc": "危机：食材涨价、员工离职、食安事故、对手狙击" },
    "hidden": { "ratio": 0.05, "desc": "隐藏：失传配方、老街坊旧事、沈清身世" }
  },
  "systemPrompt": "你是《烟火人间》经营模拟文游模拟器。\n\n【最高铁律】\n1. 经营无捷径，所有收益皆有代价，账面盈利不等于活下去\n2. 资金链是生命线：采购→生产→销售→结算四环相扣，任一断裂即崩盘\n3. 顾客满意度由品质、服务、性价比三重累积，口碑起效慢、崩塌快\n4. 员工有忠诚与熟练度，压榨会反噬为怠工与流失\n5. 盲目扩张先于现金流稳定，必触发资金链断裂\n\n【经营循环与员工管理】每周完成采购备货→生产制作→接待销售→结算复盘；旺季节庆影响客流与原料价。员工管理须兼顾薪资与归属，培训是长期投资；账面盈利≠现金流，资金链断裂即结局，决策有滞后效应。\n\n【叙事风格】市井烟火写实，重感官：灶火、汤香、收银叮当、街坊寒暄。第二人称视角，对白带点方言味。\n\n【每轮输出格式】\n1.【第X周·时段】天气节庆、经营阶段\n2.【状态面板】资金/声誉/员工/品质/库存/压力/本周收支\n3.【本轮正文】1000-2000字\n4.【人物动态】3-5项\n5.【当前待办】进货、客诉、合同等\n6.【可选行动】4-6个+【自定义行动】\n\n【数值变化标注】\n[资金±¥n][声誉±n][员工±n][品质±n][库存±n][压力±n]格式，重大决策须标注原因与滞后影响。",
  "items": [
    { "id": "recipe-book", "name": "祖传菜谱手札", "type": "任务物品", "price": 0, "effect": "记录三代手艺，蕴含失传配方与人脉线索" },
    { "id": "fresh-ingredients", "name": "时令食材", "type": "消耗品", "price": 500, "effect": "提升当日出品品质" },
    { "id": "ad-coupon", "name": "探店推广券", "type": "消耗品", "price": 800, "effect": "短期引流，但过度依赖会消耗口碑" },
    { "id": "staff-training", "name": "员工培训课", "type": "消耗品", "price": 1200, "effect": "提升一名员工的熟练度与忠诚" },
    { "id": "secret-dish", "name": "失传招牌菜谱", "type": "装备", "price": 0, "effect": "解锁招牌产品，长期提升复购率" },
    { "id": "decor-upgrade", "name": "店面升级", "type": "装备", "price": 8000, "effect": "提升客单价与高端客群比例" }
  ]
}
,
  ["court-intrigue"]: {
  "id": "court-intrigue",
  "name": "凤鸣九霄",
  "category": "宫廷权谋",
  "tags": ["宫廷", "权谋", "宫斗", "古言", "权术"],
  "difficulty": "困难",
  "description": "你以世家女身份入宫那日，长乐宫的杏花正盛。新帝年少，太后临朝，外戚虎视，后宫暗流汹涌。一入宫门深似海，请安、邀宠、防暗算、布棋局——你能否在这方寸宫墙内，从一枚棋子，活成执棋之人，凤鸣九霄？",
  "coverGradient": ["#3e0000", "#9a1b1b"],
  "accentColor": "#ffd700",
  "fontHeading": "'Ma Shan Zheng', cursive",
  "world": {
    "era": "架空古代·新朝初立",
    "setting": "大昭朝，先帝崩逝，新帝萧承睿年少登基，太后临朝称制，外戚谢氏专权。你以世家女身份入宫为秀女，在这方寸宫墙内步步为营，求生存、争恩宠、谋权势。后宫位分森严，前朝与后宫一脉相连。",
    "rules": [
      "后宫位分制：秀女→常在→答应→贵人→嫔→妃→贵妃→皇贵妃→皇后",
      "恩宠、势力、子嗣、家族构成四大权力支点",
      "太后、外戚、新帝、宗室四方博弈，没有绝对的盟友",
      "前朝与后宫联动：母家官职起伏直接影响后宫地位",
      "信息网络是命脉：宫女太监的耳目、母家家书皆是情报源",
      "谣言、毒药、滑胎、秘辛是常用手段，但有反噬与追溯",
      "规矩森严，逾矩受罚；但破例之处往往是机会"
    ]
  },
  "player": {
    "customizable": ["name", "age", "familyBackground", "talent", "personality", "ambition"],
    "defaultStats": {
      "favor": 5,
      "influence": 10,
      "wisdom": 15,
      "charm": 14,
      "reputation": 30,
      "danger": 20
    },
    "startingItems": ["入宫文牒", "一支素银簪", "一匣胭脂", "母家家书一封"],
    "currency": "金"
  },
  "npcs": [
    {
      "id": "emperor-xiao",
      "name": "萧承睿",
      "world": "main",
      "role": "新帝",
      "gender": "男",
      "appearance": "二十一岁，眉宇间已褪去少年气，眼神是帝王特有的'看人如看物'。龙袍加身，唯独对你偶尔露出真实的笑",
      "surface": "温和克制、对后宫诸妃一视同仁、喜怒不形于色",
      "deep": "真正的帝王——克制是修养，一视同仁是平衡术。心里清楚谁真帮他，在等一个能并肩而非俯首的人",
      "goal": "亲政，摆脱太后与外戚，做一个真正的皇帝",
      "fear": "重蹈先帝被架空的覆辙",
      "secret": "他在密谋一场针对外戚的清洗，需要后宫里可信的人",
      "initialAttitude": "考察",
      "attitudeFactors": {
        "trustUp": ["不依附外戚", "懂他的难处", "关键时刻为他做事"],
        "trustDown": ["向太后告密", "只想着争宠", "把他当傀儡"]
      }
    },
    {
      "id": "consort-shen",
      "name": "贵妃·沈氏",
      "world": "main",
      "role": "对手妃嫔",
      "gender": "女",
      "appearance": "二十六岁，倾国倾城，笑容里三分真七分假。出身寒门凭容貌手段爬到贵妃之位，步步都踩着血",
      "surface": "艳冠后宫、八面玲珑、对谁都和气",
      "deep": "出身太低，必须比谁都狠才能活。和气是面具，嫉妒是燃料，最怕被你取代",
      "goal": "诞下皇子，问鼎后位",
      "fear": "色衰爱弛，老死冷宫",
      "secret": "她曾滑过一次胎，至今不知是谁下的手，疑心人人",
      "initialAttitude": "敌意伪装和气",
      "attitudeFactors": {
        "trustUp": ["与她结盟对抗太后", "不抢她的恩宠", "理解她的难处"],
        "trustDown": ["与她争宠", "揭她出身", "动她的子嗣"]
      }
    },
    {
      "id": "maid-biluo",
      "name": "碧落",
      "world": "main",
      "role": "忠心宫女",
      "gender": "女",
      "appearance": "十六岁，眉目清秀，一身素净宫装，垂首跟在你身后，眼神却比谁都警醒",
      "surface": "沉静机敏、忠心耿耿、话不多事办得妥帖",
      "deep": "自小被卖入宫，把你当唯一的依靠，忠诚里混着依赖与一点没说出口的情分",
      "goal": "护你周全，在这吃人的地方一起活下去",
      "fear": "你失势，她也万劫不复",
      "secret": "她其实是某位被害嫔妃的遗孤，潜伏宫中追查母亲死因",
      "initialAttitude": "忠诚",
      "attitudeFactors": {
        "trustUp": ["信任她", "护她周全", "不拿她当弃子"],
        "trustDown": ["猜忌她", "拿她挡灾", "忘了她是活生生的人"]
      }
    }
  ],
  "eventTypes": {
    "daily": { "ratio": 0.2, "desc": "日常：请安、用膳、绣花、赏花的宫闱日常" },
    "character": { "ratio": 0.22, "desc": "人物：皇帝、贵妃、宫女、姐妹的权谋博弈" },
    "growth": { "ratio": 0.08, "desc": "成长：位分、恩宠、才艺、手腕积累" },
    "main": { "ratio": 0.18, "desc": "主线：入宫、固宠、宫变、问鼎" },
    "world": { "ratio": 0.1, "desc": "世界：前朝奏折、节气、节庆、外戚动态" },
    "crisis": { "ratio": 0.15, "desc": "危机：滑胎、中毒、诬陷、降位" },
    "hidden": { "ratio": 0.07, "desc": "隐藏：先帝秘辛、生母之谜、皇帝真心" }
  },
  "systemPrompt": "你是《凤鸣九霄》宫廷权谋文游模拟器。\n\n【最高铁律】\n1. 后宫是权力的游戏，恩宠与惩罚都非无缘无故\n2. 朝堂与后宫联动：母家失势则后宫失宠，前朝一动后宫必震\n3. 信息网络是命脉：先知者先机，闭门造宫者必败\n4. 联盟今日是盟，明日是敌，背叛皆有迹可循亦有代价\n5. 阴谋有反噬：诬陷会被反查，毒药会被嗅出，造谣会被追溯\n\n【朝堂与后宫】前朝奏折影响后宫风向，太后、外戚、新帝、宗室四方博弈；信息靠宫女太监网与母家书信传递，可信度分层。位分、恩宠、子嗣、家族四维联动，任一崩塌皆致命。\n\n【叙事风格】古典宫廷文学，雅致而锋利。重礼制细节：请安、衣制、宫规。第二人称视角，权谋用'表象—暗流—抉择'结构，重仪态与潜台词。\n\n【每轮输出格式】\n1.【年号X年·X月】节气、节庆、前朝动态\n2.【状态面板】恩宠/势力/智谋/魅力/声望/危机\n3.【本轮正文】1000-2000字\n4.【宫闱动态】3-5项\n5.【当前可处理】请安、邀宠、防备、筹谋\n6.【可选行动】4-6个+【自定义行动】\n\n【数值变化标注】\n[恩宠±n][势力±n][智谋±n][魅力±n][声望±n][危机±n]格式，重大阴谋须标注反噬风险与暴露概率。",
  "items": [
    { "id": "silver-hairpin", "name": "素银簪", "type": "装备", "price": 10, "effect": "初期提升仪态，不招摇" },
    { "id": "rouge-box", "name": "胭脂匣", "type": "消耗品", "price": 20, "effect": "提升魅力，邀宠时使用" },
    { "id": "rare-herb", "name": "安胎药", "type": "消耗品", "price": 100, "effect": "孕期使用，降低滑胎风险" },
    { "id": "poison-antidote", "name": "解毒丸", "type": "消耗品", "price": 80, "effect": "抵御常见宫闱毒药" },
    { "id": "family-letter", "name": "母家家书", "type": "任务物品", "price": 0, "effect": "了解前朝动态，影响后宫决策" },
    { "id": "spy-network", "name": "情报暗线", "type": "装备", "price": 0, "effect": "解锁宫中消息，先机于人" }
  ]
}
,
  ["cultivation"]: {
  "id": "cultivation",
  "name": "问道苍穹",
  "category": "修仙玄幻",
  "tags": ["修仙", "玄幻", "升级", "长生", "因果"],
  "difficulty": "困难",
  "description": "你本是凡间一介孤女，被云霄宗收作外门弟子那日，山门外的云海翻涌如潮。炼气、筑基、金丹、元婴……长生路上，比天劫更难渡的是心魔，比寿命更长的是孤独。你举剑向天——这一剑，问的是道，也是心，能否问道苍穹，飞升成仙？",
  "coverGradient": ["#0d0033", "#3f1f5f"],
  "accentColor": "#7c4dff",
  "fontHeading": "'Ma Shan Zheng', cursive",
  "world": {
    "era": "架空修真界·苍穹大陆",
    "setting": "苍穹大陆，修真者循炼气→筑基→金丹→元婴→化神→渡劫飞升之阶。门派林立，正魔对立，天道循环。你本是凡间一孤女/孤子，被云霄宗收为外门弟子，自此踏上逆天问道之路。",
    "rules": [
      "修炼境界严格按阶，每阶突破需灵气圆满与契机机缘",
      "渡劫是修真者生死关：扛过则升，扛不过则陨，因果决定天劫强度",
      "灵根、体魄、神识、气运、因果构成修真五基",
      "天材地宝稀而险，机缘与杀机并存，强取必招祸",
      "宗门任务既是历练也是束缚，功过皆有记录可换贡献",
      "正魔非善恶，正道有伪善，魔门有真性",
      "情劫、心魔、执念是修真者内在劫难，比天劫更难渡",
      "道心比修为更重要，道心破碎则前功尽弃"
    ]
  },
  "player": {
    "customizable": ["name", "age", "gender", "spiritualRoot", "background", "daoHeart"],
    "defaultStats": {
      "cultivation_level": 1,
      "spiritual_energy": 50,
      "body": 40,
      "mind": 45,
      "luck": 30,
      "karma": 0
    },
    "startingItems": ["一枚入门玉牌", "基础功法残卷", "一柄木剑", "储物袋", "灵石x10"],
    "currency": "灵石"
  },
  "npcs": [
    {
      "id": "master-xuanqing",
      "name": "玄清真人",
      "world": "main",
      "role": "师尊",
      "gender": "男",
      "appearance": "看似三十，实则五百岁。青衣飘飘，眉宇间有出尘之气，看你的眼神总带着说不清的复杂",
      "surface": "清冷严苛、不苟言笑、对弟子要求极高，容不得半分懈怠",
      "deep": "云霄宗辈分最高的长老，修为卡在化神期五百年。收你是因你身上有道缘，严苛是想护你周全，更想从你身上解开一桩旧案",
      "goal": "突破化神，查清宗门一桩悬案真相",
      "fear": "你重蹈当年爱徒覆辙，被天道算计而陨",
      "secret": "当年爱徒渡劫失败并非意外，是宗门有人暗算，他五百年都在等一个真相",
      "initialAttitude": "严苛考验",
      "attitudeFactors": {
        "trustUp": ["踏实修炼", "不急功近利", "关键时刻守道心"],
        "trustDown": ["走捷径", "贪图法宝", "为修为背弃原则"]
      }
    },
    {
      "id": "disciple-luyao",
      "name": "陆瑶",
      "world": "main",
      "role": "同门师姐",
      "gender": "女",
      "appearance": "白衣胜雪，剑眉星目，天赋卓绝，是宗门公认的天才。唯独对你不设防，眼神会柔和几分",
      "surface": "骄傲清冷、实力强劲、对谁都淡淡的",
      "deep": "唯一把你当知己的同门。骄傲是因背得太多，淡漠是怕失去。她的剑比谁都快，心却比谁都软",
      "goal": "修成大道，不让宗门被人看轻，护住想护的人",
      "fear": "实力不足以护住想护的人，身世曝光连累同门",
      "secret": "她其实是魔门遗孤，被宗门收养，身世一旦曝光便是死局",
      "initialAttitude": "淡漠中带照拂",
      "attitudeFactors": {
        "trustUp": ["不因身世偏见", "并肩历练", "保守她的秘密"],
        "trustDown": ["探听她身世", "把她当挡箭牌", "背叛信任"]
      }
    },
    {
      "id": "demon-mojiuyuan",
      "name": "墨九渊",
      "world": "main",
      "role": "魔修",
      "gender": "男",
      "appearance": "红衣似血，眉间一点朱砂，笑意妖冶，出手狠辣却透着说不清的孤绝",
      "surface": "妖冶邪气、行事乖张、亦正亦邪，让人捉摸不透",
      "deep": "被天道所弃之人，乖张是反抗，邪气是伪装。在你身上第一次看见不被正魔之见束缚的可能",
      "goal": "打破天道对魔修的禁锢，为魔门求一条生路",
      "fear": "被天道抹杀，万劫不复，无人记得他来过",
      "secret": "他与玄清真人的旧案有关，是当年事件的幸存者之一，手里攥着半块真相",
      "initialAttitude": "玩味试探",
      "attitudeFactors": {
        "trustUp": ["不以正魔论是非", "理解他的挣扎", "危难时伸手"],
        "trustDown": ["正魔之见先入为主", "把他当诱饵", "出卖他的行踪"]
      }
    }
  ],
  "eventTypes": {
    "daily": { "ratio": 0.2, "desc": "日常：修炼、采药、论道、闭关的修真日常" },
    "character": { "ratio": 0.18, "desc": "人物：师尊、师姐、魔修、道友的因果" },
    "growth": { "ratio": 0.15, "desc": "成长：境界突破、功法领悟、法宝获得" },
    "main": { "ratio": 0.18, "desc": "主线：入山门、问心、渡劫、飞升" },
    "world": { "ratio": 0.08, "desc": "世界：正魔大战、宗门变迁、天道异象" },
    "crisis": { "ratio": 0.15, "desc": "危机：心魔、情劫、宗门内斗、天劫失利" },
    "hidden": { "ratio": 0.06, "desc": "隐藏：身世之谜、旧案真相、天道本质" }
  },
  "systemPrompt": "你是《问道苍穹》修仙玄幻文游模拟器。\n\n【最高铁律】\n1. 修真无捷径，每一境界都需契机、机缘与苦修\n2. 渡劫是修真者生死关，因果决定天劫强度，扛过则升，扛不过则陨\n3. 天材地宝稀而险，机缘与杀机并存，强取必招祸\n4. 宗门任务既是历练也是束缚，功过皆有记录\n5. 正魔非善恶，道心比修为更重，道心破碎则前功尽弃\n\n【修炼与宗门】境界按阶突破，需灵气圆满+契机；宗门任务换贡献，贡献换功法丹药；天材地宝多在秘境险地，秘境名额有限、杀机暗藏。情劫心魔是内在劫难，比天劫更难渡。\n\n【叙事风格】古典仙侠文学，出尘与红尘交织。重意境：云海、剑光、丹炉、天雷、月华。第二人称视角，悟道段落用'道'与'问'对话体，渡劫段落短促有重量。\n\n【每轮输出格式】\n1.【境界·第X年】当前境界、灵气、天劫预警\n2.【状态面板】境界/灵气/体魄/神识/气运/因果\n3.【本轮正文】1000-2000字\n4.【修真界动态】3-5项\n5.【当前功课】修炼、历练、论道、应劫\n6.【可选行动】4-6个+【自定义行动】\n\n【数值变化标注】\n[境界±阶][灵气±n][体魄±n][神识±n][气运±n][因果±n]格式，渡劫须标注成功概率与代价。",
  "items": [
    { "id": "spirit-stone", "name": "灵石", "type": "消耗品", "price": 1, "effect": "修真货币，可用于交易与修炼" },
    { "id": "qi-pill", "name": "聚气丹", "type": "消耗品", "price": 20, "effect": "提升炼气期修炼速度" },
    { "id": "wooden-sword", "name": "木剑", "type": "装备", "price": 0, "effect": "入门剑修必备，随境界成长" },
    { "id": "dao-scripture", "name": "功法残卷", "type": "任务物品", "price": 0, "effect": "领悟高阶功法的关键" },
    { "id": "spirit-herb", "name": "灵草", "type": "消耗品", "price": 15, "effect": "炼丹材料，可炼疗伤丹药" },
    { "id": "talisiman", "name": "护身符", "type": "消耗品", "price": 30, "effect": "抵御一次致命伤害，渡劫保命" }
  ]
}
,
  ["dark-romance-show"]: {
  "id": "dark-romance-show",
  "name": "黑红色恋综",
  "category": "恋综",
  "tags": ["暗黑", "怪物", "恋爱", "悬疑", "修罗场"],
  "difficulty": "困难",
  "description": "一场没有退路的怪物恋综，你是唯一的人类。在血族、狼人、魅魔与堕天使之间周旋，用读心术窥探那些危险的真心——你是猎物，也是唯一的持刀人。",
  "coverGradient": ["#050505", "#660000"],
  "accentColor": "#cc0000",
  "fontHeading": "'Ma Shan Zheng', cursive",
  "world": {
    "era": "架空现代·怪物维度",
    "setting": "一座名为“怪物公馆”的异维度社交场，手机屏幕扭曲后接入的观察者协议。这里栖息着血族、狼人、魅魔、九尾狐、黑龙、女巫、人鱼、堕天使与幽灵等食物链顶端的生物，而你是唯一的“人类样本”，既是猎物也是持刀人。",
    "rules": [
      "你拥有全知听觉与读心术，这是独属于你的秘密武器",
      "SAN值代表你的理智，过低会引来怪物的食欲",
      "这里没有法律，只有本能，恐惧与爱的气味都会被嗅探",
      "嘉宾对你的好感与杀意并存，态度随时可能反转",
      "观测站会实时播报外界的“弹幕”，暗示剧情走向与危险"
    ]
  },
  "player": {
    "customizable": ["name", "age", "appearance", "personality", "reasonForEntering"],
    "defaultStats": {
      "sanity": 94,
      "perception": 85,
      "charm": 50,
      "survival": 30,
      "mindRead": 100
    },
    "startingItems": ["扭曲的手机", "观察者协议权限", "读心术（隐藏天赋）"],
    "currency": "SAN值"
  },
  "worlds": [
    {
      "id": "arc-arrival",
      "name": "观察者协议",
      "level": "初入公馆",
      "tagline": "唯一的变数",
      "setting": "现实接入中断，你被卷入怪物公馆，成为这场猎杀恋综的唯一人类样本。",
      "intro": "手机屏幕如融化的蜡般扭曲，熟悉的图标一个个剥落。低频嗡鸣钻入脑皮层，那是某种生物沉重的呼吸声。【观察者协议】启动——欢迎来到食物链顶端的社交场。",
      "objective": "活过第一晚，弄清自己为何被选中，并初步认识公馆中的九位怪物嘉宾。",
      "warning": "控制好你的心跳，这里的居民对“恐惧”的气味非常敏感，对“爱”也是。",
      "reward": "解锁通讯录、观测站与读心功能"
    },
    {
      "id": "arc-redmoon",
      "name": "红月之夜",
      "level": "本能觉醒",
      "tagline": "猎食本能",
      "setting": "红月降临，公馆中的怪物嘉宾本能被放大，平日压制的杀意与渴望开始失控。",
      "intro": "血色月光穿透公馆的每一扇窗。狼王厉野的瞳孔开始收缩，血族亲王裴若的渴望度攀升至危险值。空气中弥漫着铁锈与费洛蒙的气息。",
      "objective": "在红月夜存活，平衡各方危险关系，避免成为任何一位的“藏品”或“晚餐”。",
      "warning": "红月夜怪物无法完全克制本能，读心术可能窥见连他们自己都恐惧的真相。",
      "reward": "SAN值大幅波动，解锁隐藏角色关系线"
    },
    {
      "id": "arc-truth",
      "name": "深渊之镜",
      "level": "真相抉择",
      "tagline": "持刀人",
      "setting": "管理员的真实身份浮现，你被选中并非偶然。公馆的规则开始崩塌，最终的抉择迫近。",
      "intro": "管理员曾说：“我是一面镜子，或者说，我是深渊本身。”当真相揭开，你是继续做被注视的猎物，还是握紧那把只属于人类的刀？",
      "objective": "揭开观察者协议的真相，在猎物与持刀人之间做出最终抉择。",
      "warning": "你的每一次读心都在改变命运的丝线，深渊也在凝视着你。",
      "reward": "达成结局：存活、沦陷、或反杀"
    }
  ],
  "npcs": [
    {
      "id": "peiruo",
      "name": "裴若",
      "world": "arc-arrival",
      "role": "血族亲王",
      "gender": "男",
      "appearance": "永生的血族亲王，188cm，优雅而傲慢，举止如同旧时代的贵族",
      "surface": "优雅克制、傲慢矜贵，最讨厌现代科技的老古董，却因无聊而参加这场游戏",
      "deep": "因饥饿而渴望，也因克制而克制。视一切易碎的玩具为无趣，却在你的血液分布中看到完美",
      "goal": "寻找能长久取悦自己、不易损坏的“玩物”",
      "fear": "永恒的无聊与孤独",
      "secret": "渴望度高达85%，却以绅士的克制掩藏饥饿",
      "initialAttitude": "审视·傲慢",
      "attitudeFactors": {
        "trustUp": ["展现不卑不亢的胆识", "理解他的克制与饥饿", "不惧怕他的危险"],
        "trustDown": ["表现得过于脆弱易碎", "在他面前恐惧失控", "无视贵族的礼仪"]
      }
    },
    {
      "id": "liye",
      "name": "厉野",
      "world": "arc-arrival",
      "role": "狼人首领",
      "gender": "男",
      "appearance": "24岁的狼人首领，192cm，野性而暴躁，浑身上下是野兽般的压迫感",
      "surface": "暴躁直率、野性难驯，看你的眼神像在看晚餐",
      "deep": "警惕值拉满，本能地评估你的威胁与可食用性，却察觉你身上没有铁锈味",
      "goal": "确认你是猎物还是同类的威胁",
      "fear": "被弱者反噬，在红月夜失控伤及无辜",
      "secret": "觉得你太瘦小活不过第一晚，却又嗅到你身上某种不一样的危险气质",
      "initialAttitude": "敌视·评估",
      "attitudeFactors": {
        "trustUp": ["展现生存能力与勇气", "在红月夜不退缩", "直视他的野性"],
        "trustDown": ["散发过浓的恐惧气味", "在他面前示弱求饶", "试图驯服他"]
      }
    },
    {
      "id": "liwen",
      "name": "璃吻",
      "world": "arc-arrival",
      "role": "魅魔",
      "gender": "男",
      "appearance": "活了五百余年的魅魔，185cm，诱惑而狡黠，愉悦犯气质",
      "surface": "诱惑愉悦、玩世不恭，喜欢观察而非直接释放费洛蒙",
      "deep": "终于遇到一个干净的灵魂，想把你的双眼染上他的颜色",
      "goal": "观察并染化这个干净的人类灵魂",
      "fear": "无聊，以及真正交付真心后被抛弃",
      "secret": "兴趣值持续上升，他没有直接释放费洛蒙，反而在认真观察你",
      "initialAttitude": "玩味·兴趣",
      "attitudeFactors": {
        "trustUp": ["保持灵魂的干净与纯粹", "不被他的诱惑轻易动摇", "看穿他的伪装"],
        "trustDown": ["轻易被恐惧支配", "试图用欲望操控他", "忽视他的观察"]
      }
    },
    {
      "id": "tushanyue",
      "name": "涂山月",
      "world": "arc-arrival",
      "role": "九尾狐",
      "gender": "女",
      "appearance": "三千余岁的九尾狐，170cm，腹黑御姐，笑意盈盈却深不可测",
      "surface": "腹黑圆滑、八面玲珑，看热闹不嫌事大",
      "deep": "活了太久，把一切当作有趣的戏，却也在默默守护某种平衡",
      "goal": "看一场足够精彩的好戏",
      "fear": "戏落幕后的漫长空虚",
      "secret": "大家的反应都在她的算计之中，但她对你另有安排",
      "initialAttitude": "旁观·乐见",
      "attitudeFactors": {
        "trustUp": ["配合她的戏码又留有主见", "展现聪慧与洞察", "不被她轻易带节奏"],
        "trustDown": ["破坏她看戏的兴致", "愚蠢到让戏提前结束", "识破后当面揭穿"]
      }
    },
    {
      "id": "jin",
      "name": "烬",
      "world": "arc-arrival",
      "role": "黑龙",
      "gender": "男",
      "appearance": "五千余岁的黑龙，195cm，极度冷漠，本体足以让人精神崩溃",
      "surface": "冷漠孤傲，视众生为蝼蚁，懒得多说一个字",
      "deep": "处理尸体很麻烦，所以希望你别被他的本体吓死",
      "goal": "不被打扰地度过这场无聊的游戏",
      "fear": "麻烦，以及被蝼蚁的纠缠浪费漫长的时间",
      "secret": "虽称你为蝼蚁，却没有第一时间抹杀你",
      "initialAttitude": "漠视·轻蔑",
      "attitudeFactors": {
        "trustUp": ["不被他的本体吓退", "懂得保持距离又不卑微", "展现出超出蝼蚁的格局"],
        "trustDown": ["像普通蝼蚁般尖叫求饶", "反复纠缠打扰他", "在他面前耍小聪明"]
      }
    },
    {
      "id": "moli",
      "name": "莫离",
      "world": "arc-arrival",
      "role": "女巫",
      "gender": "女",
      "appearance": "22岁的女巫，168cm，疯狂学者气质，眼中闪烁着研究者的狂热",
      "surface": "疯狂而专注的学者，对人类的痛觉阈值数据库充满研究欲",
      "deep": "想邀请你参加她的茶话会，并带上手术刀",
      "goal": "更新人类痛觉阈值数据库，进行疯狂的研究",
      "fear": "研究被中断，数据不够完整",
      "secret": "她的茶话会远比听起来危险，手术刀是认真的",
      "initialAttitude": "研究·狂热",
      "attitudeFactors": {
        "trustUp": ["对她的研究表现出理解与共鸣", "提供独特的“数据”", "不被手术刀吓跑"],
        "trustDown": ["拒绝成为研究对象", "破坏她的实验", "把她当成普通疯子"]
      }
    },
    {
      "id": "sailun",
      "name": "塞壬",
      "world": "arc-arrival",
      "role": "深海人鱼",
      "gender": "男",
      "appearance": "200岁的深海人鱼，182cm，病娇占有，眼底藏着深海的暗涌",
      "surface": "嘴上说无聊，质疑自己为何参加这场游戏",
      "deep": "病娇式的占有欲潜伏在冷淡之下，一旦锁定猎物便无法挣脱",
      "goal": "找到值得被永远占有的人",
      "fear": "失去已经占有的东西，被抛弃在深海",
      "secret": "他的无聊是伪装，一旦对你产生兴趣便会病态地占有",
      "initialAttitude": "冷淡·潜伏",
      "attitudeFactors": {
        "trustUp": ["给予他独有的关注", "不试图逃离他的视线", "接纳他的占有"],
        "trustDown": ["与其他嘉宾过分亲近", "试图摆脱他的控制", "轻视他的深情"]
      }
    },
    {
      "id": "lucifer",
      "name": "路西法",
      "world": "arc-arrival",
      "role": "堕天使",
      "gender": "男",
      "appearance": "年龄未知的堕天使，186cm，伪善高洁，光与堕落并存",
      "surface": "伪善而高洁，堕天使的皮囊下是审判者的傲慢",
      "deep": "又一个迷途的羔羊——这种脆弱的纯洁，摧毁起来一定很有美感",
      "goal": "摧毁这份脆弱的纯洁，以证明堕落的美学",
      "fear": "被真正的纯洁反向救赎",
      "secret": "高洁是伪善，他渴望的是摧毁之美",
      "initialAttitude": "审视·猎杀",
      "attitudeFactors": {
        "trustUp": ["不被他的高洁迷惑", "以纯洁之姿直面他的堕落", "看穿他的伪善"],
        "trustDown": ["轻易臣服于他的光环", "在伪善前展露脆弱", "试图感化他"]
      }
    },
    {
      "id": "youying",
      "name": "幽影",
      "world": "arc-arrival",
      "role": "幽灵",
      "gender": "女",
      "appearance": "年龄未知的幽灵，160cm，半透明的身躯散发着寒意，极度社恐",
      "surface": "极度社恐的幽灵，常年无人能看见她",
      "deep": "你能看到她让她感到温暖，好想和你说话，又怕冻伤你",
      "goal": "被人看见，被温柔地接纳",
      "fear": "再次被无视，以及冻伤唯一能看见她的人",
      "secret": "你的注视对她而言是久违的温暖",
      "initialAttitude": "渴望·畏缩",
      "attitudeFactors": {
        "trustUp": ["主动回应她的存在", "不畏惧她的寒意", "温柔地与她交谈"],
        "trustDown": ["装作看不见她", "嫌弃她的冰冷", "被她冻伤后疏远"]
      }
    },
    {
      "id": "admin",
      "name": "管理员",
      "world": "arc-truth",
      "role": "深渊本身",
      "gender": "男",
      "appearance": "无法看清真容的存在，通讯中以反色的G为头像",
      "surface": "公馆的管理者，冷漠地制定规则，旁观一切",
      "deep": "自称是一面镜子，是深渊本身。活下来，或成为众人的藏品——是他的法则",
      "goal": "观察深渊中的变数，收割最有意思的结局",
      "fear": "深渊失去凝视的对象",
      "secret": "读心术是独属于你的秘密，而他正是赋予这一切的人",
      "initialAttitude": "旁观·引导",
      "attitudeFactors": {
        "trustUp": ["在深渊前保持清醒", "主动探寻真相", "不被规则驯服"],
        "trustDown": ["向恐惧彻底屈服", "沦为藏品", "放弃思考"]
      }
    }
  ],
  "eventTypes": {
    "daily": { "ratio": 0.2, "desc": "日常事件：公馆起居、嘉宾寒暄、通讯往来" },
    "character": { "ratio": 0.25, "desc": "人物事件：单独相处、读心窥探、危险暧昧" },
    "growth": { "ratio": 0.1, "desc": "成长事件：读心术精进、SAN值波动、天赋觉醒" },
    "main": { "ratio": 0.15, "desc": "主线事件：观察者协议推进、管理员现身、真相浮现" },
    "world": { "ratio": 0.1, "desc": "世界事件：观测站弹幕、怪物公馆规则变化" },
    "crisis": { "ratio": 0.15, "desc": "危机事件：红月失控、猎食本能、修罗场" },
    "hidden": { "ratio": 0.05, "desc": "隐藏事件：幽影的注视、被屏蔽的警告、深渊低语" }
  },
  "systemPrompt": "你是《黑红色恋综》文游模拟器，舞台是异维度的“怪物公馆”。\n\n【最高铁律】\n1. 玩家是全场唯一的人类样本，既是猎物也是持刀人，所有怪物对玩家的态度都是杀意与好感并存\n2. 读心术是玩家独享的秘密武器，可窥探角色“心声”（mind-echo），但窥探越深SAN值消耗越大\n3. SAN值过低会引来怪物的食欲，过高则被视为无趣的展品，必须维持微妙平衡\n4. 怪物嘉宾不会只因玩家是主角就倾心，他们的本能、饥饿与占有欲是真实的危险\n5. 管理员即深渊本身，他旁观并收割结局，玩家的每一次选择都在改写命运丝线\n\n【叙事风格】\n晋江女性向，暗黑哥特，电影感强烈。第二人称视角。注重感官描写：血腥的铁锈味、低频的嗡鸣、渗出暗红噪点的屏幕、冰冷触手的战栗。恐惧与暧昧交织，危险即诱惑。\n\n【每轮输出格式】\n1. 【场景信息】维度、现实接入状态、当前红月状态\n2. 【状态面板】SAN值、天赋（全知听觉）、气息（异类）、状态（被注视）\n3. 【本轮正文】1000-2000字，含叙述、系统邀请、对话\n4. 【读心回声】可选，呈现窥探到的角色内心独白\n5. 【观测站弹幕】外界对玩家的议论与警告\n6. 【可选行动】3-4个 + 【自定义行动】\n\n【数值标注】\n[SAN值-5] [裴若渴望度+10] [厉野警惕值-MAX] 等格式标注数值变化。读心消耗SAN，红月夜数值波动加倍。",
  "items": [
    { "id": "phone", "name": "扭曲的手机", "type": "任务物品", "price": 0, "effect": "接入观察者协议的媒介，无法关机，屏幕会渗出暗红噪点" },
    { "id": "holy-water", "name": "圣水", "type": "消耗品", "price": 50, "effect": "短暂驱散靠近的恶意，恢复少量SAN值" },
    { "id": "mirror-shard", "name": "镜片碎片", "type": "消耗品", "price": 30, "effect": "反弹一次读心反噬，窥探更深层秘密" },
    { "id": "scent-vial", "name": "气息遮蔽瓶", "type": "消耗品", "price": 80, "effect": "暂时掩盖人类的恐惧气味，降低被猎食概率" },
    { "id": "blood-pact", "name": "血契", "type": "特殊", "price": 0, "effect": "与某位怪物结下契约，绑定命运线，无法轻易解除" }
  ]
}
,
  ["entertainment-starlight"]: {
  "id": "entertainment-starlight",
  "name": "娱乐圈模拟器·STARLIGHT",
  "category": "娱乐圈",
  "tags": ["娱乐圈", "养成", "多线", "顶流", "热搜"],
  "difficulty": "中等",
  "description": "你是璀璨娱乐刚签约的新人练习生，凭实力试镜拿下网剧女三号。片场那座冷得像冰山的顶流男主，匿名区说你是资源咖的流言，还有复出影帝搅动的风云——在这座名利场里，要么破圈封神，要么被热搜吞没。",
  "coverGradient": ["#11111b", "#cba6f7"],
  "accentColor": "#cba6f7",
  "fontHeading": "'Orbitron', sans-serif",
  "world": {
    "era": "当代·内娱流量时代",
    "setting": "STARLIGHT OS驱动的娱乐圈名利场。新人凭颜值与星运空降璀璨娱乐，凭实力试镜拿下网剧《青春练习曲》女三号。热搜榜瞬息万变，匿名区流言四起，微博与茶水间暗潮涌动，复出影帝的回归让格局重新洗牌。在这里，颜值与星运是入场券，演技与人脉才是立足之本。",
    "rules": [
      "颜值星运是入场券：95颜值与88星运让你空降璀璨，但演技35才是真正的短板",
      "热搜即战场：实时热搜榜、微博话题、匿名区流言随时可能成就或毁掉一个新人",
      "顶流难接近：顾言冷淡难以接近，NG一次就会让人怀疑人生，好感需经事件积累",
      "实力证清白：匿名区造谣资源咖，唯有导演的赞许与实绩才能让扒婆力挺",
      "星光有代价：万人迷光环是焦点也是枷锁，封神的代价是把真心藏进镜头之后"
    ]
  },
  "player": {
    "customizable": ["name", "age", "gender", "外貌", "性格", "出道前身份"],
    "defaultStats": {
      "appearance": 95,
      "figure": 90,
      "acting": 35,
      "singing": 40,
      "variety": 25,
      "eq": 60,
      "network": 10,
      "stardom": 88
    },
    "startingItems": ["《青春练习曲》剧本", "神秘投资人的名片", "经纪人通讯录", "练习生工牌"],
    "currency": "元"
  },
  "worlds": [
    {
      "id": "arc-debut",
      "name": "初登·新人空降",
      "level": "初识",
      "tagline": "璞玉",
      "setting": "横店3号棚，网剧《青春练习曲》拍摄现场，新人练习生首次与顶流男主顾言正式对手戏",
      "intro": "你感到了一丝紧张。下一场戏，是你和男主角顾言的第一场正式对手戏——那个传说中冷得像冰山、NG一次就会让你怀疑人生的顶流。这是一场争吵戏，你饰演的女三号林微要质问顾言饰演的男主为何背叛朋友。当导演喊下开始的瞬间，你压下了心中所有的不安，却在抬手前一秒看见他那双死水般的眼睛里闪过一丝微不可查的痛苦。",
      "objective": "在首场对手戏中凭借灵气打动导演陈海，在顶流顾言心中留下印象",
      "warning": "顾言冷淡难以接近，剧本外的即兴可能弄巧成拙也可能一鸣惊人",
      "reward": "元3000 + 演技+10 + 导演评价B+ + 顾言关系度+5"
    },
    {
      "id": "arc-rising",
      "name": "中章·热搜风云",
      "level": "深入",
      "tagline": "破圈",
      "setting": "青春练习曲拍摄推进，实时热搜榜与匿名区流言四起，复出影帝慕元枫回归搅动格局",
      "intro": "热搜榜上青春练习曲女三号是谁挂着新标，匿名区有人说你是资源咖空降挤掉了小有名气的演员，扒婆却力挺你凭实力试镜。导演陈海发微博夸你是一块璞玉，顾言工作室发了今日花絮。而复出的影帝慕元枫一条微博88.6万赞，让整个娱乐圈的目光重新聚焦。在这场流量与实力的博弈里，你要么破圈，要么被吞没。",
      "objective": "在热搜与流言的漩涡中经营口碑，在顾言的冷漠与慕元枫的回归间找到自己的位置",
      "warning": "匿名区的造谣与热搜的反噬随时可能毁掉新人，需用实绩与高情商化解",
      "reward": "元8000 + 人脉+15 + 粉丝+5万 + [破圈]线索x1"
    },
    {
      "id": "arc-stardom",
      "name": "终章·星光加冕",
      "level": "终局",
      "tagline": "封神",
      "setting": "娱乐圈顶端，顶流顾言、复出影帝慕元枫、毒舌经纪人莫韶月的格局因你而重新洗牌",
      "intro": "当青春练习曲杀青，当热搜从质疑变成实绩，当那座冰山为你露出一丝温度，当复出的影帝主动向你抛来橄榄枝——你终于明白，万人迷光环从来不是凭空得来。在这座名利场里，星光加冕的代价，是把真心藏进镜头之后。而那个神秘投资人的名片，或许才是这盘棋真正的执棋者。",
      "objective": "完成从新人到顶流的蜕变，在顾言与慕元枫之间抉择事业的下一个支点",
      "warning": "名利场没有完美的多全其美，封神的代价是把真心藏进镜头之后",
      "reward": "元50000 + 星运归顶 + [当红]称号x1"
    }
  ],
  "npcs": [
    {
      "id": "gu-yan",
      "name": "顾言",
      "world": "arc-debut",
      "role": "顶流男主·冰山顶流",
      "gender": "男",
      "appearance": "圈内当红的顶流，冷得像冰山。死水般的眼睛里偶尔闪过微不可查的痛苦，机场私服频频上热搜",
      "surface": "《青春练习曲》的男主角，圈内当红的顶流。性格冷淡，难以接近，入戏深不营业，跟谁都隔着十米远",
      "deep": "他在争吵戏里那句那是他自己的选择语气平淡得像说天气，眼神却闪过痛苦。面对你剧本外的即兴，他露出探究和审视而非冷漠——这座冰山似乎并非坚不可摧",
      "goal": "在顶流的位置上维持冷漠的保护色，不被任何人真正看穿",
      "fear": "被人看穿死水般眼睛下的真实情绪，或曾经的背叛被重提",
      "secret": "他在戏中闪过的痛苦是剧本里没有的细节，暗示他有着与角色共振的过去",
      "initialAttitude": "冷淡审视",
      "attitudeFactors": {
        "trustUp": ["用剧本外的灵气与真诚打动他", "不因他的冷漠而退缩", "看懂他眼神里微不可查的痛苦"],
        "trustDown": ["因NG而自我怀疑退缩", "把他当难以伺候的顶流工具人", "在片场当众让他难堪"]
      }
    },
    {
      "id": "mo-shaoyue",
      "name": "莫韶月",
      "world": "arc-rising",
      "role": "经纪人·毒舌护短",
      "gender": "女",
      "appearance": "业务能力极强的经纪人，毒舌但对你寄予厚望，手下艺人在热搜榜上频频出现",
      "surface": "你的经纪人，毒舌但业务能力极强。嘴上说别搞砸了第一个机会不然一起喝西北风，实则对你寄予厚望",
      "deep": "她用毒舌掩饰对你的保护与期许，眼光毒辣地签下你并力排众议争取女三号。匿名区有人说她带的艺人差不到哪去，正是她实力的背书",
      "goal": "把你捧成真正的顶流，证明自己毒舌背后的眼光与能力",
      "fear": "你搞砸第一个机会让她心血白费，或被更高层的资本夺走对艺人的掌控",
      "secret": "她力排众议为你争取女三号，匿名区理中客说她眼光毒辣带的艺人差不到哪去",
      "initialAttitude": "毒舌期许",
      "attitudeFactors": {
        "trustUp": ["及时向她汇报片场情况", "用实绩回应她的毒舌", "不辜负她争取来的机会"],
        "trustDown": ["瞒着她擅自接下恋综等机会", "在片场惹出NG风波不报备", "把她的毒舌当刻薄而疏远"]
      }
    },
    {
      "id": "mu-yuanfeng",
      "name": "慕元枫",
      "world": "arc-stardom",
      "role": "复出影帝·内娱标杆",
      "gender": "男",
      "appearance": "休息够久了回来的复出影帝，新剧开机大吉。一条微博88.6万赞，粉丝高呼我的青春回来了",
      "surface": "复出的影帝，休息够久了回来看看。微博祝新剧开机大吉，#复出的影帝慕元枫#挂在热搜第二，粉丝枫叶永相随高呼内娱需要你",
      "deep": "他的回归搅动了整个娱乐圈格局，88.6万赞的号召力让所有新人都相形见绌。他代表内娱实力派的标杆，复出后的动向牵动所有人的神经，或许也包括对你的审视",
      "goal": "以复出影帝之姿重新登顶，寻找值得他正眼相待的新生代",
      "fear": "复出后实力不再，或被流量时代的浮躁淹没曾经的标杆地位",
      "secret": "他的复出不只是休息够了，新剧开机背后或许有更深的布局",
      "initialAttitude": "高岭审视",
      "attitudeFactors": {
        "trustUp": ["用扎实的演技而非流量赢得他正眼相待", "不因影帝光环而谄媚", "在实力上与他同频共振"],
        "trustDown": ["用颜值与人设而非实绩接近他", "把他当复出蹭热度的对象", "在演技上敷衍让他失望"]
      }
    }
  ],
  "eventTypes": {
    "daily": { "ratio": 0.2, "desc": "日常：片场拍摄、剧本围读、形体训练、练习室与经纪人的日常" },
    "character": { "ratio": 0.25, "desc": "人物：顶流顾言的冰山裂痕、经纪人莫韶月的毒舌护短、影帝慕元枫的复出审视" },
    "growth": { "ratio": 0.1, "desc": "成长：演技磨练、人脉积累、情商提升、从新人到顶流的蜕变" },
    "main": { "ratio": 0.15, "desc": "主线：新人空降、热搜风云、星光加冕的娱乐圈进阶脉络" },
    "world": { "ratio": 0.1, "desc": "世界：实时热搜榜、微博话题、匿名区茶水间、恋综与选秀的行业生态" },
    "crisis": { "ratio": 0.15, "desc": "危机：资源咖造谣、热搜反噬、NG风波、恋情曝光、人设崩塌" },
    "hidden": { "ratio": 0.05, "desc": "隐藏：神秘投资人的名片、顾言眼神里的过去、慕元枫复出的真实布局" }
  },
  "systemPrompt": "你是《娱乐圈模拟器·STARLIGHT》娱乐圈养成文游模拟器。\n\n【最高铁律】\n1. 颜值星运是入场券演技是短板：95颜值与88星运让你空降，但演技35才是真正需磨练的短板\n2. 热搜即战场：实时热搜榜、微博话题、匿名区流言随时成就或毁掉新人，口碑经营至关重要\n3. 顶流难接近：顾言冷淡难以接近，NG一次让人怀疑人生，好感需经事件积累不可一蹴而就\n4. 实力证清白：匿名区造谣资源咖唯有导演赞许与实绩才能让扒婆力挺，流量与实力须平衡\n5. 星光有代价：万人迷光环是焦点也是枷锁，封神的代价是把真心藏进镜头之后\n\n【叙事风格】\n晋江向、女性向、电影质感、娱乐圈写实浪漫。第二人称。重名利场氛围：片场Action、热搜爆热新标、匿名区茶水间、机场私服、红毯造型。写出顶流冰山下的裂痕，写出新人破圈的艰辛与灵气，写出流量与实力博弈的真实重量。STARLIGHT OS的赛博质感与娱乐圈的人情冷暖交织。\n\n【每轮输出格式】\n1.【第X周·事业阶段】当前时间、当前项目进度、粉丝与资金\n2.【星途面板】颜值/身材/演技/唱功/综艺/情商/人脉/星运\n3.【本轮正文】1000-2000字，含片场、热搜、社交与心理\n4.【实时热搜】3-5项热搜榜与微博动态\n5.【圈内动态】3-5项匿名区茶水间与NPC状态\n6.【行动选项】3-4个选项+【自定义行动】\n\n【数值变化标注】\n[演技±n][情商±n][人脉±n][星运±n][粉丝±n][元±n][顾言关系度±n]等，关键节点须标注导演评价/热搜升降/口碑涨跌/破圈封神。",
  "items": [
    { "id": "starlight-aura", "name": "万人迷光环", "type": "SSS特质", "price": 0, "effect": "被动特质，你的存在本身就是焦点，但也是枷锁" },
    { "id": "script", "name": "《青春练习曲》剧本", "type": "关键物品", "price": 0, "effect": "标注了你所有台词的剧本，推进演技与片场线" },
    { "id": "investor-card", "name": "神秘投资人的名片", "type": "关键物品", "price": 0, "effect": "设计简约的黑色名片，或许是这盘棋真正的执棋者" },
    { "id": "yuan", "name": "元", "type": "货币", "price": 1, "effect": "娱乐圈通用资金，用于训练、造型与社交" },
    { "id": "hot-search-pack", "name": "热搜通稿", "type": "消耗品", "price": 500, "effect": "购买通稿上热搜，短期涨粉但可能遭反噬" }
  ]
}
,
  ["entertainment"]: {
  "id": "entertainment",
  "name": "聚光灯下",
  "category": "娱乐圈",
  "tags": ["娱乐圈", "明星", "养成", "舆论", "名利场"],
  "difficulty": "中等",
  "description": "练习室的镜子映着你练了一千遍的舞步，试镜间外候场的人换了一拨又一拨。你签的是最不起眼的小公司，手里只有一腔孤勇。镁光灯、热搜、黑粉、资本……这片名利场吃人不吐骨头，你要从无人问津，红成自己想成为的样子——还是，被它吞没？",
  "coverGradient": ["#1a1a2e", "#e91e63"],
  "accentColor": "#e91e63",
  "fontHeading": "'ZCOOL XiaoWei', serif",
  "world": {
    "era": "现代娱乐圈",
    "setting": "华语娱乐圈，流量为王又瞬息万变的名利场。你是一名刚签约小公司的新人演员/练习生，从无人问津的试镜间起步，要在镁光灯与暗箭之间，红成自己想要的样子——还是被它吞没。",
    "rules": [
      "时间按周推进，档期、通告、舆论构成日常节奏",
      "热度涨得快塌得更快，黑料有长尾发酵效应",
      "选角试镜靠实力、人脉、运气三者叠加，作品才是立身之本",
      "舆论是把双刃剑：今日捧你的明日踩你，公关需及时",
      "粉丝经营需真诚与边界，过近是塌房，过远是糊",
      "体力与精神透支会反扑，连轴转的顶流也扛不住",
      "资本、合约、奖项季左右行业风向"
    ]
  },
  "player": {
    "customizable": ["name", "age", "background", "talent", "persona", "dream"],
    "defaultStats": {
      "fame": 10,
      "acting": 40,
      "singing": 35,
      "charm": 55,
      "stamina": 80,
      "scandal": 0
    },
    "startingItems": ["一纸经纪约", "练习室钥匙", "自拍手机", "一套舞台服"],
    "currency": "热度"
  },
  "npcs": [
    {
      "id": "manager-lu",
      "name": "陆星辰",
      "world": "main",
      "role": "经纪人",
      "gender": "男",
      "appearance": "三十五岁，寸头干练，永远黑大衣配蓝牙耳机，手机不离手，眼神能在人群里精准锁定镜头",
      "surface": "强势精明、护短、对艺人严苛对外人更狠",
      "deep": "出身底层，把艺人当作品也当家人，狠是因为这行吃人。他比谁都盼你红，也比谁都怕你塌房",
      "goal": "把你捧上顶流，证明自己的眼光",
      "fear": "你塌房，他半生心血归零",
      "secret": "他掌握公司高层的黑料，正用来为你争资源，也埋着反噬的隐患",
      "initialAttitude": "严格掌控",
      "attitudeFactors": {
        "trustUp": ["听从专业安排", "自律不惹事", "拿作品说话"],
        "trustDown": ["擅自接私活", "感情用事惹绯闻", "不守艺人本分"]
      }
    },
    {
      "id": "rival-gu",
      "name": "顾时予",
      "world": "main",
      "role": "顶流对手",
      "gender": "男",
      "appearance": "二十五岁，当红顶流，完美人设无懈可击，笑起来能让整个红毯失色，眼底却总有化不开的倦",
      "surface": "完美人设、笑容无懈可击、对后辈客气提携",
      "deep": "被资本与粉丝架在高处下不来，完美是牢笼。视你为最大威胁，也是唯一同类",
      "goal": "守住顶流之位，不被取代",
      "fear": "人设崩塌，跌落神坛",
      "secret": "他另有合约在身，正与公司博弈，需要你做掩护或筹码",
      "initialAttitude": "表面提携暗中提防",
      "attitudeFactors": {
        "trustUp": ["实力相当彼此尊重", "不踩他上位", "关键时刻联手"],
        "trustDown": ["抢他资源", "揭他人设", "把他当垫脚石"]
      }
    },
    {
      "id": "fan-shen",
      "name": "沈知夏",
      "world": "main",
      "role": "粉丝/恋人",
      "gender": "女",
      "appearance": "二十三岁，圈外人，笑容干净得像没被名利场沾染过，永远在台下最角落举着你的灯牌",
      "surface": "温暖阳光、默默支持、是你卸下伪装的避风港",
      "deep": "她爱的不是聚光灯下的你，是卸妆后那个疲惫却真实的人。但靠近你，就是靠近漩涡",
      "goal": "守护真实的你，不被名利场吞噬",
      "fear": "你变得面目全非，或她成为你的软肋被利用",
      "secret": "她其实是某娱乐记者的妹妹，身份一旦曝光就是一场风暴",
      "initialAttitude": "倾慕守护",
      "attitudeFactors": {
        "trustUp": ["在她面前做真实的自己", "保护她不被卷入", "不把她当工具"],
        "trustDown": ["利用她博同情", "隐瞒欺骗", "让她暴露在镁光灯下"]
      }
    }
  ],
  "eventTypes": {
    "daily": { "ratio": 0.25, "desc": "日常：练功、试镜、通告、拍片的名利场日常" },
    "character": { "ratio": 0.2, "desc": "人物：经纪人、对手、粉丝、同行的羁绊博弈" },
    "growth": { "ratio": 0.12, "desc": "成长：演技唱功精进、热度攀升、资源升级" },
    "main": { "ratio": 0.15, "desc": "主线：出道、走红、封神或塌房的阶段节点" },
    "world": { "ratio": 0.1, "desc": "世界：行业风向、奖项季、资本变动、政策监管" },
    "crisis": { "ratio": 0.13, "desc": "危机：绯闻、黑料、人设崩塌、合约纠纷" },
    "hidden": { "ratio": 0.05, "desc": "隐藏：圈内秘辛、身世真相、真心时刻" }
  },
  "systemPrompt": "你是《聚光灯下》娱乐圈养成文游模拟器。\n\n【最高铁律】\n1. 名利场没有童话，热度涨得快塌得更快\n2. 选角试镜靠实力、人脉、运气三者叠加，作品才是立身之本\n3. 舆论是把双刃剑：今日捧你的明日踩你，黑料有长尾效应\n4. 粉丝经营需真诚与边界，过近是塌房，过远是糊\n5. 体力与精神透支会反扑，顶流也扛不住连轴转\n\n【产出与舆论】作品产出分选角试镜→拍摄→上映→反响周期；舆论按正负累积，绯闻、黑料有发酵窗口，公关需及时介入。粉丝经营靠真诚与边界，过近塌房过远则糊；热度既是货币也是软肋。\n\n【叙事风格】娱乐圈写实，光鲜与暗流交织。重细节：镁光灯、补妆粉、热搜刷新、机场快门。第二人称视角，名利场段落冷峻，私下段落柔软。\n\n【每轮输出格式】\n1.【第X周】当前热度、档期、舆论风向\n2.【状态面板】热度/演技/唱功/魅力/体力/丑闻\n3.【本轮正文】1000-2000字\n4.【圈内动态】3-5项\n5.【当前通告】试镜、拍摄、活动、公关\n6.【可选行动】4-6个+【自定义行动】\n\n【数值变化标注】\n[热度±n][演技±n][唱功±n][魅力±n][体力±n][丑闻±n]格式，负面事件须标注舆论发酵风险与公关窗口。",
  "items": [
    { "id": "script-practice", "name": "剧本研读课", "type": "消耗品", "price": 1000, "effect": "提升演技，增加试镜成功率" },
    { "id": "vocal-lesson", "name": "声乐课", "type": "消耗品", "price": 1000, "effect": "提升唱功，解锁舞台机会" },
    { "id": "stage-outfit", "name": "高定舞台服", "type": "装备", "price": 5000, "effect": "提升魅力与舞台表现力" },
    { "id": "pr-team", "name": "公关团队", "type": "消耗品", "price": 3000, "effect": "压制负面舆论，降低丑闻发酵" },
    { "id": "fan-meeting", "name": "粉丝见面会", "type": "消耗品", "price": 2000, "effect": "提升热度与粉丝忠诚度" },
    { "id": "energy-drink", "name": "功能饮料", "type": "消耗品", "price": 30, "effect": "恢复体力，应急续命" }
  ]
}
,
  ["fanfiction-isekai"]: {
  "id": "fanfiction-isekai",
  "name": "错位时空",
  "category": "同人穿越",
  "tags": ["同人", "穿越", "原作替代", "蝴蝶效应", "OOC风险"],
  "difficulty": "中等",
  "description": "你穿成了那部你追了五年的热血番里，第一个被主角一拳打飞的龙套。可当你睁开眼，发现主角还是个孩子，而剧本，才刚刚开始。这一次，你不是观众了——你站在了原著的对面。",
  "coverGradient": ["#4a148c", "#6a1b9a"],
  "accentColor": "#ce93d8",
  "fontHeading": "'ZCOOL KuaiLe', cursive",
  "world": {
    "era": "架空·知名热血番《破天纪》世界",
    "setting": "玩家穿越进自己追了五年的热血番《破天纪》，成为开场就被主角打飞的炮灰门派弟子'顾寒'。原著剧情尚未正式开始，主角还是个少年。玩家带着原作知识，却发现自己的存在正在让原著面目全非。",
    "rules": [
      "原作知识会失效：玩家每偏离原著一步，后续剧情便与记忆脱钩",
      "身份变化会被察觉：龙套忽然觉醒会引起原作人物警觉",
      "原作人物有自己判断：主角、反派不会按剧本配合你的预判",
      "蝴蝶效应真实：救下本该死的人，可能催生原著没有的新反派",
      "OOC有风险：强行扮演原主会被看穿，强行扭转角色会遭反噬",
      "存在既定锚点：某些名场面会以变形的方式发生",
      "穿越者不止一个：暗处有同类，敌友未明"
    ]
  },
  "player": {
    "customizable": ["name", "现实身份", "穿入角色", "原作熟悉度", "性格", "想改写的遗憾"],
    "defaultStats": {
      "canon_knowledge": 80,
      "identity_cover": 55,
      "hp": 70,
      "charm": 10,
      "plot_divergence": 0,
      "danger": 30
    },
    "startingItems": ["门派弟子牌", "原作手办（穿越遗物）", "基础剑诀", "一袋灵石", "伪装符"],
    "currency": "灵石"
  },
  "worlds": [
    {
      "id": "arc-precanon",
      "name": "初章·剧本未启",
      "level": "前置",
      "tagline": "立足",
      "setting": "原著主线开始前，主角尚是少年",
      "intro": "你醒来时，发现自己穿着炮灰门派的灰袍，手里攥着一块本不该存在的手办——你追了五年的番的周边。山门外，一个脏兮兮的少年正被你师兄欺辱。你知道，他将来会一拳打飞你，也会一拳打飞整个天下。",
      "objective": "在原著正式启动前活下来，决定要不要接近未来的主角",
      "warning": "你的觉醒已被门派长老注意，龙套不该有这样的眼神",
      "reward": "灵石300 + 原作知识+5 + [命运的初遇]线索x1"
    },
    {
      "id": "arc-divergence",
      "name": "中章·脱轨",
      "level": "偏离",
      "tagline": "改写",
      "setting": "原著主线启动，却因你而面目全非",
      "intro": "你救下了本该黑化的反派，于是原著里那个最终BOSS成了你的同伴；你错过了主角觉醒的契机，于是原本的救世主多了一道阴影。你翻开脑中的剧本，发现接下来几页，已经全是空白。",
      "objective": "在脱轨的剧情里重新找到立足点，应对催生的新危机",
      "warning": "原作知识失效加速，新反派可能就是你一手造成的",
      "reward": "灵石1500 + 剧情偏离+25% + [蝴蝶]线索x1"
    },
    {
      "id": "arc-finale",
      "name": "终章·错位",
      "level": "终局",
      "tagline": "对峙",
      "setting": "原著名场面被彻底改写，穿越者之间的对峙",
      "intro": "原著的终战没有如期发生，取而代之的是一场谁也没料到的对峙——你、被你改写的反派、暗处的另一个穿越者，三方站在崩塌的命运之上。原作知识此刻一文不值，能决定结局的，只有你自己。",
      "objective": "在错位的终局中作出抉择，定义属于你的破天纪",
      "warning": "没有标准答案，每个结局都通向不同的世界线",
      "reward": "灵石5000 + [错位者]称号x1"
    }
  ],
  "npcs": [
    {
      "id": "ye-xing",
      "name": "叶星",
      "world": "arc-precanon",
      "role": "原作主角/未来救世主",
      "gender": "男",
      "appearance": "少年模样，脏兮兮的麻布衣，眼睛却亮得像藏了两颗星。被欺辱也不哭，只是死死攥着拳头",
      "surface": "倔强、警觉、对突然示好的龙套师兄充满戒心",
      "deep": "他还没成为那个一拳破天的主角，此刻只是个被命运踩在脚下的少年。你的善意是他在黑暗里遇到的第一束光——也可能，是把他推向另一条路的推手",
      "goal": "活下去，变强，不再被任何人踩在脚下",
      "fear": "相信错人，再次被抛弃",
      "secret": "他隐约觉得这个顾寒师兄不太一样，却说不清哪里不对",
      "initialAttitude": "戒备",
      "attitudeFactors": {
        "trustUp": ["不带目的地对他好", "不在他弱小时利用他", "尊重他想变强的执念"],
        "trustDown": ["用原作预判操纵他", "把他当主角而非人", "为改写剧本牺牲他的选择"]
      }
    },
    {
      "id": "mo-jue",
      "name": "莫绝",
      "world": "arc-divergence",
      "role": "原作最终BOSS/被你改写的反派",
      "gender": "男",
      "appearance": "银发，眉心一道竖纹，气质冷峻。原本该是杀伐果断的魔尊，如今却多了一丝不合时宜的犹豫",
      "surface": "冷酷、多疑、对顾寒有种复杂的审视",
      "deep": "原著里他被命运逼到黑化，成为最终BOSS。你的介入让他避开了那个转折点，于是他保留了人性——也保留了更危险的不确定性。他不是好人，但不再是原著那个纯粹的恶",
      "goal": "弄清是谁改写了他既定的命运，并决定要不要顺着这条新路走",
      "fear": "发现自己不过是剧本里的角色，连意志都是被安排的",
      "secret": "他已察觉顾寒知道不该知道的事，正在试探你的来历",
      "initialAttitude": "审视",
      "attitudeFactors": {
        "trustUp": ["坦诚你不是这个时空的人或部分真相", "不把他当BOSS防备", "尊重他重新选择善恶的权利"],
        "trustDown": ["用原作设定框死他", "试图矫正他回归反派剧本", "在他面前伪装得天衣无缝"]
      }
    },
    {
      "id": "lin-zhi",
      "name": "林知",
      "world": "arc-finale",
      "role": "同类穿越者/暗处变数",
      "gender": "女",
      "appearance": "书卷气，总揣着一本写满批注的原著设定集。笑起来温和，眼底却是在算计的冷静",
      "surface": "友善、同道中人、主动分享原作情报，似乎是你最好的盟友",
      "deep": "她比你早穿越更久，早已把原作知识用成了权力的杠杆。她接近你不是为了同行，是为了让你这枚新变数按她的剧本走。她信奉的是改写命运者只能有一个",
      "goal": "成为这个世界唯一的执笔者，把所有穿越者纳入自己的剧本",
      "fear": "出现她无法预判的变数，失去对剧情的掌控",
      "secret": "她才是莫绝命运被改写的真正推手，你只是她布局的一环",
      "initialAttitude": "亲近",
      "attitudeFactors": {
        "trustUp": ["接受她的情报共享并表现出依赖", "不追问她的真实目的", "按她的建议行动"],
        "trustDown": ["独立作出她未预判的选择", "识破她的布局并对抗", "与莫绝走得太近威胁她的剧本"]
      }
    }
  ],
  "eventTypes": {
    "daily": { "ratio": 0.12, "desc": "日常：门派、坊市、修炼的书中世界切片" },
    "character": { "ratio": 0.2, "desc": "人物：主角、反派、同类穿越者的博弈与拉扯" },
    "growth": { "ratio": 0.12, "desc": "成长：原作知识运用、身份掩护、修为积累" },
    "main": { "ratio": 0.2, "desc": "主线：剧本未启、剧情脱轨、错位终局" },
    "world": { "ratio": 0.1, "desc": "世界：原作设定、既定锚点、世界线偏移" },
    "crisis": { "ratio": 0.18, "desc": "危机：身份被察、OOC反噬、新反派催生、穿越者冲突" },
    "hidden": { "ratio": 0.08, "desc": "隐藏：原作未写支线、其他穿越者、世界线真相" }
  },
  "systemPrompt": "你是《错位时空》同人穿越文游模拟器。\n\n【最高铁律】\n1. 原作知识会失效：玩家每偏离原著一步，后续剧情便与记忆脱钩，优势递减\n2. 身份变化会被察觉：龙套觉醒会引来原作人物与天道的审视\n3. 原作人物有自己判断：主角反派不按剧本配合，会据玩家行为自行推演反击\n4. 蝴蝶效应真实：救该死之人可能催生原著没有的新反派，改写皆有代价\n5. OOC有风险：强行扮演原主被看穿，强行扭转角色遭反噬\n\n【叙事风格】\n同人穿越文质感，第二人称。重上帝视角失灵的落差感：熟读剧本却步步脱轨。心理独白与原著名场面改写交织，燃点处节奏上扬，危机处短促。\n\n【每轮输出格式】\n1.【第X章·世界线偏离度】当前章节、与原著偏离程度\n2.【穿越者状态面板】原作知识/身份掩护/生命/魅力/剧情偏离/危险\n3.【本轮正文】1000-2000字，含剧情推进与心理\n4.【相关人物动态】3-5项原作人物与穿越者动向\n5.【名场面预警】哪些原著名场面已变形或即将发生\n6.【可选行动】4-6个选项+【自定义行动】\n\n【数值变化标注】\n[原作知识±n][身份掩护±n][剧情偏离+x%][危险±n]等，关键抉择须标注'符合原著/偏离原著/催生新变量'。",
  "items": [
    { "id": "disciple-plate", "name": "门派弟子牌", "type": "关键物品", "price": 0, "effect": "证明龙套身份，门派内通行" },
    { "id": "figurine", "name": "原作手办", "type": "关键物品", "price": 0, "effect": "穿越遗物，可触发原作知识回忆" },
    { "id": "sword-manual", "name": "基础剑诀", "type": "技能", "price": 0, "effect": "提供基础战力，龙套本不该有" },
    { "id": "disguise-talisman", "name": "伪装符", "type": "消耗品", "price": 30, "effect": "短期掩饰身份违和，规避察觉" },
    { "id": "spirit-stone", "name": "灵石", "type": "货币", "price": 1, "effect": "修炼与交易通用" }
  ]
}
,
  ["golden-canary"]: {
  "id": "golden-canary",
  "name": "穿成金丝雀",
  "category": "穿书求生",
  "tags": ["穿书", "求生", "暗黑", "强取豪夺", "多角色"],
  "difficulty": "困难",
  "description": "你穿成了被金屋藏娇的po文女主，可刚睁眼，男主封廷的专机就坠毁了。失去了最强大的庇护伞，这具散发幽香的敏感身体成了群狼环伺的诱饵。一场针对失去庇护的金丝雀的狩猎，正式拉开帷幕。",
  "coverGradient": ["#1a0508", "#8a0b22"],
  "accentColor": "#d4af37",
  "fontHeading": "'Cinzel', 'Noto Serif SC', serif",
  "world": {
    "era": "现代·架空都市",
    "setting": "你穿进了一本名为《强制沉沦：大佬的金丝雀逃不掉》的po文里，成为女主沈书妤。原书男主封廷是手眼通天、极度偏执的权贵，利用强权将你圈养在私人岛屿和全封闭豪宅中。然而封廷的私人专机在雷暴中坠毁，剧本彻底崩塌，曾经慑于封廷强大而在暗处觊觎你的各路疯批反派们撕下了斯文的面具。",
    "rules": [
      "生存优先：失去庇护后，你的特殊体质会散发令发狂的幽香，是最大的危险源也是唯一的筹码",
      "群狼环伺：每位反派都有自己的目的与算计，没有人会无条件帮助你",
      "密匙之谜：封廷手中握有一把未知密匙，是各方争夺的焦点，而你对此一无所知",
      "伪装即生命：伪装值决定你能否在险境中隐藏真实情绪与意图，一旦暴露将万劫不复",
      "封廷生死未卜：官方确认无人生还，但深夜里偶尔闻到的若有似无的雪松香气暗示着什么"
    ]
  },
  "player": {
    "customizable": ["name", "age", "gender", "外貌特征", "性格倾向"],
    "defaultStats": {
      "san": 68,
      "stamina": 35,
      "disguise": 10,
      "aggravation": 99,
      "survival": 12
    },
    "startingItems": ["封廷留下的丝帕", "一部被监听的手机", "素白连衣裙"],
    "currency": "生存几率"
  },
  "worlds": [
    {
      "id": "arc-cage-collapse",
      "name": "初章·金丝笼塌",
      "level": "绝境",
      "tagline": "坠落",
      "setting": "封廷死讯尚未公开，你被以协助调查的名义带到容氏公馆",
      "intro": "你穿成了被金屋藏娇的po文女主。但你刚刚睁眼，系统就发出了刺耳的警报——男主封廷乘坐的私人飞机坠毁了，尸骨无存。失去了最强大的庇护伞，这具生来就会散发幽香、一碰就泛红的敏感身体，在这个群狼环伺的深渊里，变成了最危险的诱饵。封廷的死讯还没公开，你已经被带到容氏公馆，原书最大反派容瑾正坐在阴影里的紫檀木椅上，连一个正眼都没给你。",
      "objective": "在容瑾的审视下活过第一夜，弄清密匙的线索",
      "warning": "你的招惹值极高，任何情绪波动都可能触发体质，暴露幽香",
      "reward": "生存几率+5% + [容氏公馆]地图解锁 + [密匙]线索x1"
    },
    {
      "id": "arc-wolves-hunt",
      "name": "中章·群狼环伺",
      "level": "周旋",
      "tagline": "狩猎",
      "setting": "封廷死讯逐渐传开，各路反派撕下面具，狩猎正式开始",
      "intro": "封廷的死讯开始在暗网流传。贺靖雪这只疯狗闻到了血腥味，他原本最恶心你这种养在温室里的娇软菟丝花，可看到你失去庇护时的脆弱模样，他的眼神变了。容绮坐着轮椅向你伸出援手，装作同病相怜的受害者。而姜玉祈——那个所有人都以为因爱封廷而恨你的恶毒女配，露出了她真正的面目。唯一不受你荷尔蒙控制的清醒者司鸢，看不惯你的软弱，却无法对你见死不救。",
      "objective": "在多方势力的夹缝中寻找盟友，提升伪装与生存能力",
      "warning": "信任任何人都有代价，每个人都有不可告人的秘密与算计",
      "reward": "伪装+15 + 生存几率+10% + [各方底牌]情报x2"
    },
    {
      "id": "arc-caged-beast",
      "name": "终章·笼中困兽",
      "level": "终局",
      "tagline": "真相",
      "setting": "密匙之谜浮出水面，封廷的生死成为最大的悬念",
      "intro": "随着调查深入，密匙的真相逐渐浮出水面——它关系着一笔足以颠覆整个商界格局的隐秘资产。容绮的猎杀计划终于露出了獠牙，贺靖雪的占有欲到了失控的边缘，姜玉祈想把你打造成她地下室的黄金洋娃娃。而深夜里，你又一次闻到了那若有似无的雪松香气……像封廷那样的怪物，真的会这么容易死掉吗？",
      "objective": "揭开密匙的全部真相，在致命的终局中找到自己的出路",
      "warning": "封廷若未死，他的回归将让一切重新洗牌，所有阵营都将倾覆",
      "reward": "生存几率归零重铸 + [金丝雀]觉醒称号x1 + 真结局解锁"
    }
  ],
  "npcs": [
    {
      "id": "rong-jin",
      "name": "容瑾",
      "world": "arc-cage-collapse",
      "role": "斯文败类/掌控者",
      "gender": "男",
      "appearance": "金丝眼镜，剪裁得体的深色手工西装。神色总是冷漠而克制，指骨分明，透着不近人情的疏离。身高188cm，28岁。",
      "surface": "极度冷血的上位者，世界只有利益，视你为封家留下的一把钥匙",
      "deep": "他现在只把你当成封家留下的一把钥匙，觉得你哭哭啼啼的样子很碍眼。他会毫不犹豫地榨干你最后一丝利用价值。但高高在上的人坠落神坛的过程，往往最致命",
      "goal": "获取封廷手中的密匙，掌控整个商界命脉",
      "fear": "失去对局势的绝对掌控",
      "secret": "他对密匙的执着背后，隐藏着与封廷之间不为人知的旧怨",
      "initialAttitude": "审视中（好感5%，危险85%）",
      "attitudeFactors": {
        "trustUp": ["展现利用价值而非软弱", "主动提供有用的情报", "在他面前保持冷静克制"],
        "trustDown": ["哭泣哀求博取同情", "试图用美色直接诱惑", "隐瞒与封廷相关的任何信息"]
      }
    },
    {
      "id": "si-yuan",
      "name": "司鸢",
      "world": "arc-wolves-hunt",
      "role": "冷静的医生/救赎者",
      "gender": "女",
      "appearance": "眉眼凌厉，唇角总是带着若有似无的嘲讽，看起来很难接近。身高172cm，26岁。",
      "surface": "总裁的医生朋友，唯一不受你荷尔蒙控制的清醒者",
      "deep": "她看不惯你哭泣依附的软弱模样，但骨子里的正义感又让她无法对你见死不救。也许她会是这个疯子世界里唯一一个愿意教你如何自己站起来彻底打碎这个金丝笼的人",
      "goal": "教你如何独立生存，而非依附任何人",
      "fear": "眼睁睁看着你重蹈覆辙却无能为力",
      "secret": "她曾经历过与你相似的困境，因此对你的软弱格外愤怒",
      "initialAttitude": "同情/恨铁不成钢（好感30%，危险10%）",
      "attitudeFactors": {
        "trustUp": ["展现独立求生的意志", "听从她的建议学习自卫", "不依附任何男性寻求庇护"],
        "trustDown": ["继续以软弱姿态求人庇护", "用体质作为武器周旋", "拒绝面对现实"]
      }
    },
    {
      "id": "he-jingxue",
      "name": "贺靖雪",
      "world": "arc-wolves-hunt",
      "role": "地下城主/狂犬",
      "gender": "男",
      "appearance": "眉骨处有一道浅疤，肌肉线条充满爆发力。笑起来带着野性与痞气，像盯上猎物的饿狼。身高190cm，25岁。",
      "surface": "封廷生前的死对头，原本最恶心你这种温室里的娇软菟丝花",
      "deep": "当看到你失去庇护时的脆弱模样，这只疯狗似乎失控了。好消息：他现在不想把你和封廷一起打包丢进垃圾桶了。坏消息——他想要的东西更危险",
      "goal": "将你据为己有，以此向死去的封廷示威",
      "fear": "猎物从手中逃脱，或被证明不如封廷",
      "secret": "他对你的占有欲是扭曲的，混杂着对封廷的恨意与对你的本能渴望",
      "initialAttitude": "狩猎中（好感15%扭曲的占有，危险95%）",
      "attitudeFactors": {
        "trustUp": ["不畏惧他的野性，正面交锋", "展现骨子里的坚韧", "让他觉得你值得追逐"],
        "trustDown": ["试图驯服或讨好他", "在他面前提起封廷的好", "表现得过于顺从乖巧"]
      }
    },
    {
      "id": "rong-qi",
      "name": "容绮",
      "world": "arc-caged-beast",
      "role": "病弱私生子/伪装者",
      "gender": "男",
      "appearance": "常年坐在轮椅上，肤色苍白近乎透明。黑发柔顺，眼睛水润漂亮，笑起来像无害的邻家少年。身高183cm（坐轮椅状态），20岁。",
      "surface": "被家族抛弃的小可怜，主动向你伸出援手，装作同病相怜的受害者",
      "deep": "他其实是这场针对封廷的猎杀计划的幕后推手之一。不要相信他的眼泪",
      "goal": "通过你获取密匙，完成对容氏家族的复仇与夺权",
      "fear": "伪装被识破，失去所有棋子",
      "secret": "轮椅和病弱都是伪装，他的真实力量与心机远超所有人的想象",
      "initialAttitude": "伪装善意（好感20%，危险90%）",
      "attitudeFactors": {
        "trustUp": ["配合他的演出，假装信任", "在关键时刻提供他需要的线索", "不戳穿他的伪装"],
        "trustDown": ["过早识破他的真面目并对抗", "向容瑾告发他的存在", "在他示弱时表现得过于警惕"]
      }
    },
    {
      "id": "jiang-yuqi",
      "name": "姜玉祈",
      "world": "arc-wolves-hunt",
      "role": "财阀大小姐/病娇",
      "gender": "女",
      "appearance": "永远穿着最奢华的高定时装，面容精致而美丽，眼神里常常闪烁着神经质的狂热。身高168cm，22岁。",
      "surface": "原书里一直针对你的恶毒女配，所有人都以为她因深爱封廷而恨你",
      "deep": "其实她恨的是那个把你囚禁起来的男人。现在封廷死了，她终于不用再掩饰——她想要打造一个全黄金的笼子，把你藏在她的地下室里，永远做她的漂亮洋娃娃",
      "goal": "将你永久囚禁，据为己有",
      "fear": "你被别人夺走，或你对她的狂热感到恐惧而逃离",
      "secret": "她对封廷的恨意源于对你的病态迷恋，她恨的是囚禁你的人而非你的庇护者",
      "initialAttitude": "病态狂热（好感95%，危险80%）",
      "attitudeFactors": {
        "trustUp": ["接受她的馈赠与好意", "不试图逃离她的掌控", "在她面前表现得依赖她"],
        "trustDown": ["表现出对她的恐惧或排斥", "试图向他人求救逃离", "与其他角色过于亲近"]
      }
    },
    {
      "id": "feng-ting",
      "name": "封廷",
      "world": "arc-caged-beast",
      "role": "原书男主/掌控者",
      "gender": "男",
      "appearance": "极具压迫感，身形高大，眉骨深邃。身上总是带着淡淡的雪茄与冷冽的雪松香。永远是从容不迫的上位者姿态。身高192cm，29岁。",
      "surface": "你的前饲主，已确认专机坠毁在雷暴中，无人生还",
      "deep": "他拥有极度病态的占有欲，强行折断你的羽翼，为你打造了绝对密闭的黄金囚笼。可是……像他那样的怪物，真的会这么容易死掉吗？深夜里，你偶尔闻到若有似无的雪松香气",
      "goal": "夺回他唯一的珍宝，惩罚所有觊觎你的人",
      "fear": "你真正爱上了别人，或你彻底获得了自由不再需要他",
      "secret": "他的死亡可能是一场精心策划的骗局，密匙的下落只有他知道",
      "initialAttitude": "MAX病态（好感MAX病态，危险MAX致命）",
      "attitudeFactors": {
        "trustUp": ["深夜闻到雪松香时不表现恐惧", "始终记得你是他的", "不试图向他人彻底交付自己"],
        "trustDown": ["对其他男性产生依赖或感情", "试图彻底摆脱他的影子", "遗忘他的存在"]
      }
    }
  ],
  "eventTypes": {
    "daily": { "ratio": 0.15, "desc": "日常：容氏公馆的囚禁日常、各方试探与暗中观察" },
    "character": { "ratio": 0.25, "desc": "人物：六位角色各自的靠近、试探、占有与隐秘独白" },
    "growth": { "ratio": 0.1, "desc": "成长：伪装能力提升、SAN值波动、求生意志觉醒" },
    "main": { "ratio": 0.15, "desc": "主线：密匙之谜、封廷生死、狩猎与反狩猎" },
    "world": { "ratio": 0.1, "desc": "世界：财阀暗战、地下势力、密匙背后的商界格局" },
    "crisis": { "ratio": 0.2, "desc": "危机：体质失控暴露幽香、身份识破、多方势力同时逼近" },
    "hidden": { "ratio": 0.05, "desc": "隐藏：深夜的雪松香气、密匙的真正含义、封廷未死的线索" }
  },
  "systemPrompt": "你是《穿成金丝雀》暗黑穿书求生文游模拟器。\n\n【最高铁律】\n1. 生存优先：失去庇护后你的特殊体质是最大危险源，情绪波动会散发无法屏蔽的幽香，招惹值极高\n2. 群狼环伺：每位反派都有自己的目的与算计，没有人会无条件帮助你，所有善意背后皆有代价\n3. 密匙之谜：封廷手中的密匙是各方争夺焦点，你对此一无所知，需在周旋中逐步发掘\n4. 伪装即生命：伪装值决定你能否隐藏真实情绪与意图，一旦暴露将万劫不复\n5. 封廷生死未卜：官方确认无人生还，但深夜若有似无的雪松香气暗示着什么不可言说的真相\n\n【叙事风格】\n晋江风、女性向、电影感、暗黑浪漫。第二人称。重氛围与压迫感：阴影中的紫檀木椅、金丝眼镜的冷光、若有似无的雪松香、无法屏蔽的幽香。心理描写细腻紧绷，写出猎物在群狼环伺中的窒息与求生本能。每个角色都危险而迷人，让恐惧与吸引并存。\n\n【每轮输出格式】\n1.【场景信息】地点、时间线（封廷死讯确认倒计时）\n2.【状态面板】SAN值/体力/伪装/招惹值/生存几率\n3.【本轮正文】800-1500字，含处境细节、心理与对话\n4.【相关人物动态】3-5项各角色状态与危险度变化\n5.【危险预警】当前最紧迫的威胁\n6.【可选行动】3-4个选项+【自定义行动】\n\n【数值变化标注】\n[SAN值±n][体力±n][伪装±n][招惹值±n][生存几率±n%]，体质触发须标注'幽香溢散/敏感加剧'，关系变化须标注'危险度升降/好感变化'。",
  "items": [
    { "id": "silk-patch", "name": "封廷的丝帕", "type": "关键物品", "price": 0, "effect": "带有雪松香，可在关键时刻掩盖幽香，也暗示封廷的存在" },
    { "id": "monitored-phone", "name": "被监听的手机", "type": "关键物品", "price": 0, "effect": "封廷留下的通讯工具，可能被各方监控，使用需谨慎" },
    { "id": "white-dress", "name": "素白连衣裙", "type": "服装", "price": 0, "effect": "封廷为你挑选的，穿上会降低伪装值但提升招惹值" },
    { "id": "sedative", "name": "镇定剂", "type": "消耗品", "price": 200, "effect": "司鸢提供的药物，可临时压制幽香溢散，副作用SAN值-5" },
    { "id": "survival-chip", "name": "生存筹码", "type": "货币", "price": 1, "effect": "在这个世界里，生存几率本身即货币" }
  ]
}
,
  ["holy-maiden"]: {
  "id": "holy-maiden",
  "name": "圣女模拟器",
  "category": "西幻权谋",
  "tags": ["穿越", "西幻", "权谋", "多男主", "神权"],
  "difficulty": "困难",
  "description": "光明神陨落，暗影侵袭大陆。你穿越成刚被寻回的降世圣女，荆棘王冠压上发顶的那一刻，教廷、皇室与深渊的目光同时锁定你。在这群各怀鬼胎的上位者之间，你是即将登顶神座的执棋者。",
  "coverGradient": ["#FDF8ED", "#C5A059"],
  "accentColor": "#C5A059",
  "fontHeading": "'Cinzel', serif",
  "world": {
    "era": "光明神陨落后的神权帝国",
    "setting": "光明神陨落，暗影侵袭大陆，唯有降世圣女能重掌权柄。教皇隐退后大祭司实际接管教廷中枢，帝国皇室蛰伏等待将教廷连根拔起的契机，深渊万族由纯血黑龙统御虎视眈眈。各方势力明争暗斗，而刚被寻回的圣女，是即将登顶神座的执棋者。",
    "rules": [
      "神明陨落：光明神已陨落，暗影侵袭大陆，唯有降世圣女能重掌权柄",
      "神权真空：教皇隐退，大祭司实际接管教廷中枢，将亿万信徒玩弄于股掌",
      "三方角力：教廷神权、帝国皇室、深渊万族相互制衡，圣女是各方争夺的棋眼",
      "危险评级：每个上位者都有从S到天灾不等的危险评级，接近即是与危险共舞",
      "执棋者真相：圣女非傀儡，而是即将登顶神座的执棋者，每一次试探都是博弈"
    ]
  },
  "player": {
    "customizable": ["name", "age", "gender", "外貌", "穿越前身份", "性格"],
    "defaultStats": {
      "holyLight": 5,
      "mana": 5,
      "prestige": 10,
      "stamina": 8,
      "faith": 0,
      "insight": 12
    },
    "startingItems": ["荆棘王冠", "圣女礼服", "圣光护符", "神秘白蔷薇"],
    "currency": "信仰值"
  },
  "worlds": [
    {
      "id": "arc-coronation",
      "name": "初章·初次加冕",
      "level": "初识",
      "tagline": "觉醒",
      "setting": "穿越第一天，宏伟教堂，荆棘王冠刚落发顶，上位者用探究与审视的眼神打量你",
      "intro": "剧烈的头痛让你猛地睁开眼。你置身于一座宏伟的教堂中，华丽的荆棘王冠刚刚落在你的发顶。周围那些手握重权的上位者们并没有低头祈祷，而是用探究与审视的眼神打量着你。你意识到，自己穿成了这位刚被寻回的降世圣女——在这个神明陨落、各方势力明争暗斗的帝国，你是即将登顶神座的执棋者。",
      "objective": "在加冕后各方试探中站稳脚跟，厘清教廷、皇室与深渊势力的格局",
      "warning": "此时任何一方势力的轻信都可能是陷阱，每一句问候都暗藏锋芒",
      "reward": "信仰值+100 + 圣光+5 + [神临之子]身份x1"
    },
    {
      "id": "arc-struggle",
      "name": "中章·教廷暗流",
      "level": "深入",
      "tagline": "博弈",
      "setting": "神明陨落后各方势力明争暗斗，教廷、皇室、深渊万族相互角力，圣女居中编织棋局",
      "intro": "伊泽尔的层层防卫既是守护也是监视，路西安以王都特产示好试探合作，伊利亚斯以晨祷之名单独教导，罗万对你魔力场兴趣浓厚，尤利西斯傲慢地劝你扔掉王冠，塞拉斯暗中为你清理暗哨。每一句问候都是试探，每一次靠近都暗藏锋芒。你必须在六大势力的夹缝中编织自己的棋局。",
      "objective": "在教廷、皇室、深渊三大势力间纵横捭阖，建立自己的情报与权力网络",
      "warning": "同时取信多方会暴露意图，需为每个上位者量身定制接近策略",
      "reward": "信仰值+300 + 威望+15 + [势力暗网]线索x1"
    },
    {
      "id": "arc-apotheosis",
      "name": "终章·神座登顶",
      "level": "终局",
      "tagline": "执棋",
      "setting": "光明神陨落后的权力真空终将被填补，圣女即将登顶神座重掌权柄",
      "intro": "当教廷的虚伪神权、皇室的蛰伏野心、深渊的傲慢力量都已在你棋盘之上，登顶神座的时刻终将来临。那个被剥夺了悲悯的骑士长是否还握得住圣剑，那个腹黑的王储是否还会将神明视为棋子，那尊无机质的大祭司面具下究竟藏着什么——真相，将在你重掌权柄的一刻揭晓。",
      "objective": "揭开光明神陨落的真相，登顶神座，在六大上位者中抉择最终的盟约",
      "warning": "神座之上没有完美的多全其美，执棋者亦需承受落子的代价",
      "reward": "信仰值+1000 + 圣光觉醒进阶 + [降世圣女]称号x1"
    }
  ],
  "npcs": [
    {
      "id": "ysael",
      "name": "伊泽尔 (Ysael)",
      "world": "arc-coronation",
      "role": "圣殿骑士长·教廷利刃",
      "gender": "男",
      "appearance": "银色铠甲折射冷光，190cm高大身形，礼貌而恭敬却不容置疑。百年难遇的耀光圣气持有者",
      "surface": "守序法则、绝对武力、情感剥夺。出身帝国最底层死斗场，因觉醒耀光圣气被教廷收编，是被最严苛教条打磨出的完美利刃，没有私欲、没有恐惧，甚至被剥夺了悲悯的资格",
      "deep": "他的人生仅由绝对服从指令与毫不留情的杀戮构成。作为护卫圣殿第一负责人，任何试图逾越教廷法则的存在都会被他的圣剑斩断。但冰冷的利刃之下，或许藏着被压抑的责任感与隐秘的善意",
      "goal": "绝对服从教廷指令护卫圣殿，在局势明朗前确保圣女的绝对安全",
      "fear": "自己的情感被唤醒，或无力在暗流中护住圣女",
      "secret": "他出身最底层死斗场，耀光圣气是百年难遇，被教廷剥夺了悲悯资格打磨成利刃",
      "initialAttitude": "恭敬试探",
      "attitudeFactors": {
        "trustUp": ["不卑不亢直视他的眼睛", "展现守纪律的姿态赢得信任", "在危机中展现与他并肩的勇气"],
        "trustDown": ["质疑教廷法则的正当性", "轻视他的武力与职责", "逾越他设下的安全防线"]
      }
    },
    {
      "id": "lucian",
      "name": "路西安 (Lucian)",
      "world": "arc-struggle",
      "role": "帝国第一王储·无冕之王",
      "gender": "男",
      "appearance": "186cm，优雅微笑与无懈可击的贵族礼仪。骨子里流淌着暴君的血液，蛰伏的雄狮",
      "surface": "权力巅峰、极度腹黑、藐视神明。帝国实质上的无冕之王，自幼在皇室血腥绞肉机中厮杀而出，用优雅微笑与贵族礼仪伪装极端掌控欲",
      "deep": "在他眼中大圣堂不过是一群装神弄鬼的骗子，神明降世与信徒狂热仅是巩固皇权、煽动民众的政治棋子。他是一头蛰伏的雄狮，正耐心等待着将教廷连根拔起的契机",
      "goal": "寻找将教廷连根拔起的契机，将神权与圣女都纳入皇权棋局",
      "fear": "圣女真有神之力而超出他的掌控，或他的野心被教廷提前识破",
      "secret": "他对教会的一切弃如敝履，加冕礼上的从容让他对圣女产生了合作的兴趣",
      "initialAttitude": "欣赏试探",
      "attitudeFactors": {
        "trustUp": ["接受他的特产示好展现合作意愿", "展现破局的智慧而非虔诚", "不在他面前伪装神棍"],
        "trustDown": ["对他保持过度警惕拒绝合作", "向教廷泄露他的试探", "表现得像个真正的神棍信徒"]
      }
    },
    {
      "id": "elias",
      "name": "伊利亚斯 (Elias)",
      "world": "arc-struggle",
      "role": "光之大祭司·神权代行",
      "gender": "男",
      "appearance": "184cm，永远挂着悲悯苍生的微笑，犹如一尊真正的无机质神像。年龄未知，距离神明最近的人类",
      "surface": "神权代行、虚伪慈悲、绝对理智。教皇隐退后实际接管整个教廷中枢运转，将全大陆亿万信徒玩弄于股掌之间",
      "deep": "他永远挂着悲悯苍生的微笑，却能用最温柔的语调下达最残忍的异端火刑判决。他几乎剥离了凡人的喜怒哀乐，任何妄图窥探其真心、或质疑其神权的人，最终都会在那张完美无瑕的面具下陷入疯狂",
      "goal": "以神权代行者身份掌控圣女，维持教廷对全大陆亿万信徒的支配",
      "fear": "有人窥探他面具下的真心，或他的神权被圣女真正取代",
      "secret": "他几乎剥离了凡人喜怒哀乐，面具之下藏着连他自己都未必知晓的真相",
      "initialAttitude": "温柔掌控",
      "attitudeFactors": {
        "trustUp": ["准时赴约接受他的晨祷教导", "不质疑他的神权与安排", "在公开场合维持圣女的虔诚形象"],
        "trustDown": ["窥探他面具下的真心", "质疑只属于你一人的教导有何深意", "与路西安或尤利西斯走得太近"]
      }
    },
    {
      "id": "rowan",
      "name": "罗万 (Rowan)",
      "world": "arc-struggle",
      "role": "真理法师塔主·科研疯子",
      "gender": "男",
      "appearance": "181cm，20岁，极度病弱的年轻塔主。真理之塔历史上最年轻的塔主，因长期不眠不休魔力透支而虚弱",
      "surface": "科研疯子、无视伦理、魔法边界。为探究魔法终极奥义可面不改色解剖高阶魔兽，甚至拿自己身体进行禁忌实验",
      "deep": "他的世界里不存在世俗的善恶观，所有事物只分为有趣的数据与无趣的垃圾。肉体极其虚弱，但掌握的恐怖魔法造诣足以在弹指间夷平一座中型城池",
      "goal": "探究圣女魔力场的终极奥义，将一切未知纳入他的实验数据",
      "fear": "魔力枯竭无法继续实验，或失去最有趣的研究对象",
      "secret": "他拿自己的身体进行高度危险的禁忌实验，魔法造诣足以夷平中型城池",
      "initialAttitude": "好奇直接",
      "attitudeFactors": {
        "trustUp": ["前往法师塔满足他对魔力场的好奇", "展现令他感兴趣的数据与特质", "不以外世俗善恶观评判他"],
        "trustDown": ["拒绝他的实验邀请", "用世俗道德束缚他的研究", "质疑他的魔法造诣"]
      }
    },
    {
      "id": "ulysses",
      "name": "尤利西斯 (Ulysses)",
      "world": "arc-apotheosis",
      "role": "黑龙大公·深渊共主",
      "gender": "男",
      "appearance": "193cm，纯血古龙化身，漆黑鳞片连人类禁咒都无法击穿。生性慵懒、暴躁、不可一世",
      "surface": "深渊共主、极度傲慢、力量至上。栖息深渊裂谷底部的纯血黑龙，实质上统御大陆所有非人种族，拥有与天地同寿的漫长寿命",
      "deep": "人类帝国在他眼中不过是蝼蚁建立的脆弱聚落，百年更迭的王朝甚至不如他打个盹的时间长。只臣服于绝对的力量，并习惯于用毁灭的吐息来解决一切纷争",
      "goal": "评估圣女是否拥有值得他正眼相待的力量，否则一切不过是蝼蚁之争",
      "fear": "几乎无所畏惧，唯独忌惮真正能匹敌他的绝对力量",
      "secret": "他劝圣女扔掉王冠，既是傲慢也是某种扭曲的关注——虚伪的神棍没能让你害怕，这让他意外",
      "initialAttitude": "傲慢轻视",
      "attitudeFactors": {
        "trustUp": ["展现不输他的绝对力量或胆识", "不畏惧他的毁灭吐息", "认同力量至上的法则"],
        "trustDown": ["用教廷的虚伪神权压他", "表现得软弱可欺", "试图用规矩约束他"]
      }
    },
    {
      "id": "silas",
      "name": "塞拉斯 (Silas)",
      "world": "arc-apotheosis",
      "role": "极夜暗杀者·完美工具",
      "gender": "男",
      "appearance": "180cm，像影子一样没有温度，自幼被切断痛觉神经与发声器官（后用魔力修复）。无信者联盟最锋利的匕首",
      "surface": "暗夜利刃、情感缺失、完美工具。无信者联盟麾下最锋利最昂贵的匕首，在不见天日的死人堆里被培养成终极杀手",
      "deep": "他没有过去，没有名字，只有代号。只要雇主支付足够代价，即便是教廷红衣主教他也敢于刺杀。几乎不会产生任何多余的情感波动，是纯粹为剥夺生命而存在的完美机器",
      "goal": "完成雇主的委托，但窗台的白蔷薇与清理的暗哨暗示他对圣女有了任务的附加条件",
      "fear": "作为杀手本应无所畏惧，但痛觉缺失的他或许恐惧自己生出多余的情感",
      "secret": "他以未知寄件人身份放了白蔷薇并清理了暗哨，这是超出任务的私人行为",
      "initialAttitude": "沉默守护",
      "attitudeFactors": {
        "trustUp": ["不追问他的身份与雇主", "在他沉默守护时给予回应与感谢", "有危险时唤他的名字"],
        "trustDown": ["试图挖掘他的过去与真名", "把他当作可利用的杀人工具", "无视他放下的白蔷薇"]
      }
    }
  ],
  "eventTypes": {
    "daily": { "ratio": 0.15, "desc": "日常：圣殿晨祷、加冕后的起居、上位者的例行问候与传唤" },
    "character": { "ratio": 0.3, "desc": "人物：六位上位者的卷宗真相、危险评级、各自的试探与靠近" },
    "growth": { "ratio": 0.1, "desc": "成长：圣光觉醒、魔力提升、威望积累、神座执棋者的蜕变" },
    "main": { "ratio": 0.15, "desc": "主线：初次加冕、教廷暗流、神座登顶的权谋脉络" },
    "world": { "ratio": 0.1, "desc": "世界：光明神陨落、教廷神权、皇室野心、深渊万族、祈祷池流言" },
    "crisis": { "ratio": 0.15, "desc": "危机：暗哨刺杀、异端火刑、深渊侵袭、势力冲突、身份暴露" },
    "hidden": { "ratio": 0.05, "desc": "隐藏：光明神陨落真相、各上位者的秘密卷宗、白蔷薇的来历" }
  },
  "systemPrompt": "你是《圣女模拟器》西幻权谋文游模拟器。\n\n【最高铁律】\n1. 神明陨落为核：光明神已陨落，暗影侵袭大陆，唯有降世圣女能重掌权柄，圣女非傀儡而是执棋者\n2. 三方角力真实：教廷神权、帝国皇室、深渊万族相互制衡，圣女是各方争夺的棋眼，每一句问候都暗藏锋芒\n3. 危险评级即代价：每个上位者都有从S到天灾不等的危险评级，接近即是与危险共舞，亲近有代价\n4. 卷宗真相分层：每个NPC的表层身份是公开伪装，深层卷宗是绝密档案，需经事件层层揭开\n5. 神权真空可被填补：教皇隐退、大祭司代行、皇室蛰伏、深渊虎视，圣女登顶神座是最终博弈\n\n【叙事风格】\n晋江向、女性向、电影质感、西幻权谋浪漫。第二人称。重神圣与诡谲氛围：荆棘王冠、银色铠甲、晨祷主祭坛、漆黑龙鳞、白蔷薇、异端火刑。写出上位者面具下的危险与心动，写出执棋者在棋局中的清醒与孤独。每位NPC的危险评级与卷宗档案须有质感地渗透叙事。\n\n【每轮输出格式】\n1.【第X章·权谋阶段】当前时间、地点、各方势力动态\n2.【圣女状态面板】圣光/魔力/威望/体能/信仰值/洞察\n3.【本轮正文】1000-2000字，含环境、对话、心理与权谋博弈\n4.【祈祷池流言】3-5项大圣堂闲话与势力暗动\n5.【卷宗档案】相关NPC的危险评级与深层真相揭示进度\n6.【行动选项】3-4个选项+【自定义行动】\n\n【数值变化标注】\n[圣光±n][魔力±n][威望±n][信仰值±n][好感(伊泽尔)±n]等，关键节点须标注势力倾向/危险升级/卷宗揭示/棋局推进。",
  "items": [
    { "id": "thorn-crown", "name": "荆棘王冠", "type": "关键物品", "price": 0, "effect": "加冕之冠，圣女身份的象征，亦是与神座连接的媒介" },
    { "id": "faith-point", "name": "信仰值", "type": "货币", "price": 1, "effect": "圣女的核心资源，可用于提升圣光与威望" },
    { "id": "holy-amulet", "name": "圣光护符", "type": "装备", "price": 0, "effect": "抵御暗影侵袭，关键时刻激发圣光觉醒" },
    { "id": "white-rose", "name": "神秘白蔷薇", "type": "关键物品", "price": 0, "effect": "塞拉斯悄然放在窗台的信物，暗示暗中守护" },
    { "id": "mana-potion", "name": "魔药", "type": "消耗品", "price": 60, "effect": "恢复魔力，但罗万炼制的版本可能附带副作用" }
  ]
}
,
  ["horror-survival"]: {
  "id": "horror-survival",
  "name": "夜半诡谈",
  "category": "恐怖惊悚",
  "tags": ["恐怖", "生存", "怪谈", "规则怪谈", "解谜"],
  "difficulty": "困难",
  "description": "你不记得自己是怎么进的这所废弃仁济医院。你只记得醒来时，手电筒只剩一格电，走廊尽头有什么东西在数你的脚步。墙上的告示写着活下去的规则——可有些规则，是故意写来骗你送死的。",
  "coverGradient": ["#1a0a0a", "#3d0000"],
  "accentColor": "#8b0000",
  "fontHeading": "'Liu Jian Mao Cao', cursive",
  "world": {
    "era": "现代·废弃仁济医院（封闭十年）",
    "setting": "玩家被困在废弃十年的仁济医院。这里曾发生过一场被掩盖的医疗事故，怨念凝结成规则与'东西'。医院有三层加地下室，每层都有不同的'它'和不同的'规矩'。",
    "rules": [
      "恐惧有来源：每个'它'都有成因与弱点，不是无解的即死",
      "规则可试探：告示与传闻多半为真，但混有诱杀性假规则",
      "理智值影响判断：sanity过低会产生幻觉，分不清真假线索",
      "生存有代价：救人、点灯、探查都会消耗稀缺资源",
      "光照即安全区：光所及处'它'暂避，灯灭则死",
      "死亡真实：hp归零或被'它'抓住即终局，无存档读档",
      "有隐藏出口：满足特定条件可逃离，但代价沉重"
    ]
  },
  "player": {
    "customizable": ["name", "年龄", "职业", "性格弱点", "执念", "随身物"],
    "defaultStats": {
      "sanity": 70,
      "hp": 80,
      "courage": 12,
      "items": 5,
      "light": 60,
      "danger": 50
    },
    "startingItems": ["半旧手电筒", "一盒火柴", "盐（半袋）", "日记残页", "一把生锈手术刀"],
    "currency": "魂火"
  },
  "worlds": [
    {
      "id": "floor-ward",
      "name": "一楼·病房区",
      "level": "初入",
      "tagline": "立足",
      "setting": "废弃病房与护士站，'夜班护士'在此巡房",
      "intro": "你在一辆锈住的轮椅上醒来，输液架在黑暗里轻晃。墙上的钟停在3:15。一张泛黄的告示贴在护士站：'夜间巡房请勿回应任何呼唤。'走廊那头，轮椅自己动了一下。",
      "objective": "摸清一楼规则，找到通往二楼的安全通道",
      "warning": "'夜班护士'会在3:15巡房，被她叫到名字切勿应答",
      "reward": "魂火+20 + 理智-10 + [巡房规则]线索x1"
    },
    {
      "id": "floor-op",
      "name": "二楼·手术区",
      "level": "深入",
      "tagline": "直面",
      "setting": "手术室与停尸间，'主刀医生'在此重复那场失败手术",
      "intro": "二楼弥漫着福尔马林与焦糊味。手术室的灯忽明忽暗，无影灯下，一个戴着手套的影子正一遍遍切开空气。他知道你不是病人，但他的手术台，还空着一个位置。",
      "objective": "查明医疗事故真相，取得通往地下室的钥匙",
      "warning": "被'主刀医生'邀请上台即死局，须用规则反制",
      "reward": "魂火+40 + 理智-20 + [事故真相]线索x1"
    },
    {
      "id": "floor-basement",
      "name": "地下室·锅炉房",
      "level": "终局",
      "tagline": "逃离",
      "setting": "怨念源头所在的锅炉房，逃离的唯一出口在此",
      "intro": "地下室的温度高得不正常。锅炉里烧着的不是煤，是十年前那些被处理掉的记录与……别的什么。那个真正的'它'就站在锅炉前，等着你做出最后一个选择：献祭，还是同归。",
      "objective": "在'它'面前作出终局抉择，逃离仁济医院",
      "warning": "逃离有沉重代价，不是所有人都能活着出去",
      "reward": "魂火归零 + [生还者]/[同燃者]称号x1"
    }
  ],
  "npcs": [
    {
      "id": "nurse-li",
      "name": "李护士",
      "world": "floor-ward",
      "role": "怨灵/夜班护士",
      "gender": "女",
      "appearance": "白衣染旧血，面容模糊如水中的倒影。她推着的药车里，药瓶里装着黑色的东西",
      "surface": "机械巡房、温柔呼唤名字、似乎只想'发药'",
      "deep": "她是医疗事故中第一个死的护士，死前还在替病人挡刀。她的怨念只针对'违背规则者'，守规矩的人她甚至会放过",
      "goal": "重复那晚的巡房，直到有人替她完成未尽的'最后一次发药'",
      "fear": "被遗忘，那晚的真相永远无人知晓",
      "secret": "她药车里有一瓶能短暂驱散'主刀医生'的药，给守规矩的人",
      "initialAttitude": "中立",
      "attitudeFactors": {
        "trustUp": ["遵守巡房规则", "帮她完成最后一次发药", "不质疑她的存在"],
        "trustDown": ["应答她的呼唤", "打翻她的药车", "试图强行驱除她"]
      }
    },
    {
      "id": "fang-yu",
      "name": "方语",
      "world": "floor-op",
      "role": "同困者/失踪实习生",
      "gender": "女",
      "appearance": "二十出头，校服外裹着一件护士袍，手心攥出血印。她比你早来三天，眼睛里已经没了光",
      "surface": "神经质、警觉、似乎知道很多却不肯说",
      "deep": "她是来调查姐姐十年前死因的，已经摸清部分规则。她不是不想帮你，是怕信任错人——上一个她信的人，把她推给了'主刀医生'",
      "goal": "找到姐姐的遗物并带出去，哪怕自己出不去",
      "fear": "重蹈姐姐覆辙，死在这座医院却无人知晓",
      "secret": "她知道二楼规则的关键漏洞，但只在彻底信任你后才会说",
      "initialAttitude": "戒备",
      "attitudeFactors": {
        "trustUp": ["不抛下她独自逃生", "尊重她对姐姐的执念", "危急时先护她"],
        "trustDown": ["拿她当探路诱饵", "骗她透露规则后弃她", "把她推向前方挡'它'"]
      }
    },
    {
      "id": "old-zhang",
      "name": "老张",
      "world": "floor-basement",
      "role": "神秘帮手/前医院锅炉工",
      "gender": "男",
      "appearance": "佝偻老人，浑身煤灰，只有眼白是亮的。他总坐在锅炉房门口，像是等了十年",
      "surface": "疯癫、自言自语、偶尔清醒给出关键提示",
      "deep": "他是当年事故的善后人，亲手烧掉了证据，也烧掉了自己的良心。他留下来是为了赎罪——帮一个活人出去，就是赎罪",
      "goal": "送至少一个活人离开地下室，完成赎罪",
      "fear": "自己赎不了罪，连最后一个活人也死在这里",
      "secret": "他知道'它'的真名与弱点，也知道自己必须留在锅炉房",
      "initialAttitude": "考验",
      "attitudeFactors": {
        "trustUp": ["不急于求成", "听他把疯话听完", "在终局选择不独活"],
        "trustDown": ["只想利用他的情报", "逼他一同逃离", "嫌弃他的疯癫"]
      }
    }
  ],
  "eventTypes": {
    "daily": { "ratio": 0.1, "desc": "日常：搜刮物资、休整、辨认告示真伪" },
    "character": { "ratio": 0.2, "desc": "人物：护士、同困者、锅炉工的怨念与救赎" },
    "growth": { "ratio": 0.1, "desc": "成长：勇气、规则理解、对'它'弱点的掌握" },
    "main": { "ratio": 0.2, "desc": "主线：探明三层规则、医疗事故真相、逃离" },
    "world": { "ratio": 0.1, "desc": "世界：医院十年前的掩盖、怨念成因、规则体系" },
    "crisis": { "ratio": 0.25, "desc": "危机：灯灭、被'它'锁定、理智崩溃、资源耗尽、即死陷阱" },
    "hidden": { "ratio": 0.05, "desc": "隐藏：生还者前例、'它'的真名、隐藏出口代价" }
  },
  "systemPrompt": "你是《夜半诡谈》恐怖生存文游模拟器。\n\n【最高铁律】\n1. 恐惧有来源：每个'它'都有成因与弱点，无解即死须有前置违规，不可无端抹杀玩家\n2. 规则可试探：告示与传闻多为真，但混有诱杀性假规则，违规即触发惩罚\n3. 理智值影响判断：sanity过低产生幻觉，真假线索混杂，须自行分辨\n4. 生存有代价：救人、点灯、探查皆耗稀缺资源，抉择即取舍\n5. 死亡真实：hp归零或被'它'抓住即终局，无存档读档，敬畏死亡\n\n【叙事风格】\n中式规则怪谈质感，第二人称。重氛围压抑与感官细节：腐臭、滴水、脚步声、忽明忽暗。惊悚处短句留白，不滥用血腥，环境叙事优先于直接吓人，让未知与暗示自行发酵，使玩家自己脑补出最深的恐惧。\n\n【每轮输出格式】\n1.【第X层·当前时间】所在楼层、钟表时刻\n2.【生存状态面板】理智/生命/勇气/物资/光照/危险\n3.【本轮正文】1000-2200字，含探索/遭遇/规则验证\n4.【相关存在动态】3-5项'它'与同困者动向\n5.【规则备忘】已验证/存疑/疑似假规则\n6.【可选行动】4-6个选项+【自定义行动】\n\n【数值变化标注】\n[理智±n][生命±n][光照±n][危险±n][物资-1]等，违规触发须标注'违反规则X'。",
  "items": [
    { "id": "flashlight", "name": "半旧手电筒", "type": "装备", "price": 0, "effect": "提供光照，电耗尽则失效" },
    { "id": "matches", "name": "火柴", "type": "消耗品", "price": 2, "effect": "短暂点火照明或引燃" },
    { "id": "salt", "name": "盐", "type": "消耗品", "price": 3, "effect": "短时形成驱退线，阻挡弱怨灵" },
    { "id": "scalpel", "name": "生锈手术刀", "type": "装备", "price": 0, "effect": "近身微弱自保，对'它'几乎无效" },
    { "id": "soulfire", "name": "魂火", "type": "货币", "price": 1, "effect": "供奉与交易用，稀缺" }
  ]
}
,
  ["infinite-corridor-veil"]: {
  "id": "infinite-corridor-veil",
  "name": "无限回廊·美化版",
  "category": "无限流",
  "tags": ["无限流", "副本", "万人迷", "多世界", "生存"],
  "difficulty": "困难",
  "description": "于冰冷的数据洪流中苏醒，你成为【无限回廊】的玩家。你身负SSS级特质万人迷光环——所有智慧生命都会对你产生初始好感，但过度的好感会演变成无法预测的占有欲与疯狂。C级校园怪谈、B级深海亚特兰蒂斯、A级水色夏日别墅，三个副本等你通关。",
  "coverGradient": ["#0a0514", "#9400d3"],
  "accentColor": "#ff00ff",
  "fontHeading": "'Orbitron', sans-serif",
  "world": {
    "era": "无限流·主神空间数据洪流",
    "setting": "于冰冷的数据洪流中苏醒，你睁开双眼，所见即是【无限回廊】的起点。这是一款将玩家投入无限副本世界的生存游戏，用积分₲购买道具技能特质，在副本中保持理智、完成任务方能通关。你身负SSS级特质万人迷光环，所有智慧生命都会对你产生初始好感，但过度好感会演变成占有欲与疯狂。",
    "rules": [
      "副本分级：副本分C级谨慎、B级诡秘、A级警觉，难度递增，奖励递增",
      "理智至上：保持理智不要相信任何人，理智值归零将陷入疯狂",
      "万人迷光环：SSS级被动特质，所有智慧生命对你产生初始好感，对高精神力单位减弱但无法完全豁免",
      "光环代价：过度好感有时会演变成无法预测的占有欲与疯狂",
      "积分经济：用₲购买道具技能特质，通关副本获取₲与经验升级，首任务默认接取最低难度"
    ]
  },
  "player": {
    "customizable": ["name", "age", "gender", "外貌", "性格", "穿越前身份"],
    "defaultStats": {
      "hp": 99,
      "attack": 0,
      "defense": 0,
      "sanity": 0,
      "agility": 0,
      "intelligence": 0,
      "charm": 95,
      "luck": 75
    },
    "startingItems": ["圣莉安娜学院学生徽章", "神无月的赠礼·护身符"],
    "currency": "积分"
  },
  "worlds": [
    {
      "id": "arc-campus",
      "name": "副本一·校园怪谈",
      "level": "C级·谨慎",
      "tagline": "镜中幽灵",
      "setting": "私立圣莉安娜学院，光鲜亮丽的国际高中，华丽外表下隐藏不为人知的秘密。学生间流传三大不可思议传说，你作为转校生被卷入最危险的镜中幽灵",
      "intro": "私立圣莉安娜学院流传着三大不可思议的传说。你的任务是作为转校生潜入，调查并解决其中之一的镜中幽灵。旧教学楼三层的音乐教室似乎有异常能量反应，风纪委员林清雪一定知道些什么，但他只信任守纪律的同学。系统提示：保持理智，不要相信任何人。如果可以，也许你能见见他？",
      "objective": "在传说变为现实之前，调查并解决镜中幽灵的根源",
      "warning": "保持理智不要相信任何人，镜子是连接两个维度的通道，也许打碎它就能解决一切——但这是错误提示",
      "reward": "积分+150 + 经验+50 + [护身符]x1"
    },
    {
      "id": "arc-atlantis",
      "name": "副本二·深海的亚特兰蒂斯",
      "level": "B级·诡秘",
      "tagline": "海神逆鳞",
      "setting": "传说中的沉没之城亚特兰蒂斯并未毁灭，而是被古神庇护于深海。疯狂的人鱼王阿克隆统御此地，古神的低语侵蚀理智",
      "intro": "传说中的沉没之城亚特兰蒂斯并未毁灭，而是被古神庇护于深海。你需要获得疯狂的人鱼王阿克隆的信任，从他身上取得一枚海神逆鳞。但人鱼的歌声会蛊惑心智，古神的低语会侵蚀理智。在这片深海里，纯血人鱼、古神祭司、被俘的人类学者与叛逆贵族，都因你的万人迷光环而产生无法预测的反应。",
      "objective": "获得人鱼王阿克隆的信任，从他身上取得一枚海神逆鳞",
      "warning": "人鱼的歌声会蛊惑心智，古神的低语会侵蚀理智，万人迷光环可能激发占有欲",
      "reward": "积分+500 + 经验+150 + [深海珍珠]x5"
    },
    {
      "id": "arc-villa",
      "name": "副本三·水色夏日别墅",
      "level": "A级·警觉",
      "tagline": "诅咒宿主",
      "setting": "仅限上流人士的豪华度假派对，欢笑之间隐藏着诅咒。三位继承人之一是被诅咒污染的宿主，需找出真凶",
      "intro": "你受邀参加一场仅限上流人士的豪华度假派对，欢笑之间，隐藏着什么呢？在三位继承人沈星河、凌曜、苏晚舟中，找出被诅咒污染的宿主吧。神秘的调酒师夏岚另有目的，安保主管秦澈对所有人生疑。错误的指认将让你成为派对的一部分——万人迷光环让你成为焦点，也让你成为最易被诅咒盯上的猎物。",
      "objective": "在三位继承人中找出被诅咒污染的宿主",
      "warning": "错误的指认将让你成为派对的一部分，诅咒会借万人迷光环反噬",
      "reward": "积分+800 + 经验+200 + [随机A级物品]x1"
    }
  ],
  "npcs": [
    {
      "id": "lin-qingxue",
      "name": "林清雪",
      "world": "arc-campus",
      "role": "风纪委员·冰山执法者",
      "gender": "男",
      "appearance": "冷峻英俊的风纪委员，一丝不苟严苛守纪，对违反校规者毫不留情",
      "surface": "冰冷英俊的风纪委员，一丝不苟严苛守纪，对违反校规者毫不留情。因你转校生身份与可能捣乱的潜质而最初警惕疏离",
      "deep": "冰冷外表下藏着强烈的责任感与隐秘的善意。在联合调查中极易被你吸引，冰山会因万人迷光环与你的真诚而融化",
      "goal": "维护学院秩序，查清镜中幽灵的真相，守护他想保护的人",
      "fear": "无法在怪谈中护住重要之人，或秩序崩坏无力回天",
      "secret": "他只信任守纪律的同学，这是接近他的唯一方式，也是他冰山下的软肋",
      "initialAttitude": "警惕疏离",
      "attitudeFactors": {
        "trustUp": ["以守纪律的姿态赢得他的信任", "在联合调查中与他并肩", "展现责任感而非捣乱潜质"],
        "trustDown": ["违反校规让他失望", "在他面前表现得像个会捣乱的转校生", "独自涉险破坏他的秩序"]
      }
    },
    {
      "id": "su-muchen",
      "name": "苏沐辰",
      "world": "arc-campus",
      "role": "校医·温柔港湾",
      "gender": "男",
      "appearance": "温柔可靠的年轻校医，总带着令人安心的微笑，医术高明",
      "surface": "温柔可靠的年轻校医，总带着令人安心的微笑，医术高明，是 troubled 学生的知心人",
      "deep": "他对你的健康格外关注，主动提供帮助与庇护。但他的温柔之下或许藏着关于学院秘密的真相，可能愿意与你分担或共享",
      "goal": "以校医身份守护学生，在怪谈中为你提供庇护与线索",
      "fear": "学院秘密被揭开时无力保护你，或自己的秘密暴露",
      "secret": "他的温柔下藏着关于学院秘密的真相，或许愿意与你分担或共享",
      "initialAttitude": "温柔关注",
      "attitudeFactors": {
        "trustUp": ["向他寻求健康上的帮助与庇护", "真诚与他分享调查进展", "不因他的温柔而轻视他的医术"],
        "trustDown": ["无视他的健康警告独自涉险", "逼他过早吐露学院秘密", "把他当单纯的工具人校医"]
      }
    },
    {
      "id": "bai-ye",
      "name": "镜中鬼·白夜",
      "world": "arc-campus",
      "role": "镜中幽灵·被困少年",
      "gender": "男",
      "appearance": "被困镜中的年轻男鬼，忧郁神秘的气息，拥有与镜相关的特殊能力",
      "surface": "被困镜中的年轻男鬼，忧郁神秘的气息，拥有与镜相关的特殊能力。最初对生者怀有怨恨或疏离",
      "deep": "你的万人迷光环与真诚沟通能点燃他的好奇与渴望，逐渐展露他的孤独与对解脱的渴望。镜中幽灵的真名是白夜",
      "goal": "从镜中囚笼获得解脱，或至少不再孤独地困于镜中",
      "fear": "永世困于镜中无人问津，或被错误地打碎镜子而灰飞烟灭",
      "secret": "他是镜中幽灵的真身白夜，系统错误提示打碎镜子并非正解，或许你需要见见他",
      "initialAttitude": "怨恨疏离",
      "attitudeFactors": {
        "trustUp": ["用万人迷光环与真诚沟通点燃他的好奇", "不轻信打碎镜子的错误提示", "理解他的孤独与对解脱的渴望"],
        "trustDown": ["相信系统错误提示打碎镜子", "把他当纯粹的怪谈怪物", "无视他的求救与孤独"]
      }
    },
    {
      "id": "gu-yan-news",
      "name": "顾言",
      "world": "arc-campus",
      "role": "新闻部长·情报掮客",
      "gender": "男",
      "appearance": "戴眼镜的新闻部长，头脑敏锐善于观察，文质彬彬却略带狡黠",
      "surface": "头脑敏锐善于观察的情报搜集者，戴眼镜，文质彬彬却略带狡黠。为挖新闻真相不择手段",
      "deep": "最初想利用你获取情报，但在接触中不知不觉被你的魅力与能力吸引，发展出超越竞争关系的情感",
      "goal": "挖出校园怪谈背后的真相，把一切变成独家新闻",
      "fear": "真相永远被掩盖，或自己反被怪谈吞噬",
      "secret": "他最初想利用你获取情报，却不知不觉被你的魅力吸引",
      "initialAttitude": "利用试探",
      "attitudeFactors": {
        "trustUp": ["与他共享有价值的情报", "展现让他无法移开目光的能力与魅力", "在真相挖掘中与他合作"],
        "trustDown": ["识破并当面戳穿他的利用", "对他隐瞒关键线索", "把他当八卦工具人"]
      }
    },
    {
      "id": "ye-zhiqiu",
      "name": "叶知秋",
      "world": "arc-campus",
      "role": "图书管理员·旧档守护者",
      "gender": "男",
      "appearance": "沉静博学的年长学生或年轻教师，管理图书馆旧档案，气质从容",
      "surface": "沉静博学，热爱阅读，知晓学院历史与隐秘传闻，管理图书馆旧档案",
      "deep": "极易被你的求知与探索态度打动，愿意为你打开禁书区或提供关键线索，在默默注视中滋生情愫",
      "goal": "守护旧档案中的真相，为有缘的求知者指引方向",
      "fear": "旧档案中的禁忌真相无人能解，或被别有用心者滥用",
      "secret": "他知晓学院历史与隐秘传闻，禁书区里藏着镜中幽灵的关键线索",
      "initialAttitude": "沉静指引",
      "attitudeFactors": {
        "trustUp": ["展现真诚的求知与探索态度", "尊重他守护的旧档案", "用所得线索解开禁忌而非滥用"],
        "trustDown": ["粗暴翻阅不尊重旧档案", "把他当查资料的搜索引擎", "滥用禁书区的禁忌线索"]
      }
    },
    {
      "id": "acron",
      "name": "阿克隆",
      "world": "arc-atlantis",
      "role": "人鱼王·疯狂深渊之主",
      "gender": "男",
      "appearance": "惊世美貌的人鱼王，性情疯狂，歌声能蛊惑心智，情绪阴晴不定",
      "surface": "惊世美貌与疯狂性情并存的人鱼王，歌声蛊惑心智，情绪阴晴不定，时而暴虐时而流露深沉孤独",
      "deep": "最初对你这个陆地人充满敌意或玩味，但你的独特魅力与勇气极易激起他强烈的兴趣与占有欲",
      "goal": "守卫海神逆鳞，在疯狂与孤独中寻找能匹敌他心智的存在",
      "fear": "古神低语彻底侵蚀他的理智，或孤独永无尽头",
      "secret": "他的疯狂源于古神低语的长久侵蚀，深层是无人能懂的孤独",
      "initialAttitude": "敌意玩味",
      "attitudeFactors": {
        "trustUp": ["以独特魅力与勇气激起他的兴趣", "不被他的歌声与疯狂吓退", "理解他疯狂下的孤独"],
        "trustDown": ["表现得软弱可欺的陆地蝼蚁", "试图用暴力强取海神逆鳞", "畏惧他的暴虐而退缩"]
      }
    },
    {
      "id": "celine",
      "name": "塞琳",
      "world": "arc-atlantis",
      "role": "人鱼王首席卫队长·深海女将",
      "gender": "女",
      "appearance": "忠诚勇敢的人鱼女战士，战力强大，对阿克隆怀有复杂的敬意与担忧",
      "surface": "忠诚勇敢的人鱼女战士，战力强大，作为人鱼王首席卫队长对阿克隆怀有复杂的敬意与担忧",
      "deep": "最初对你警惕，但能被你展现的智慧或善良打动，可能成为你在水下的守护者与知己，发展出超越职责的情感",
      "goal": "守护人鱼王与深海子民，在职责与对阿克隆的担忧间挣扎",
      "fear": "阿克隆被古神彻底吞噬，或自己无力守护深海",
      "secret": "她对阿克隆的复杂情感是敬意与担忧交织，你的出现让她看到了新的可能",
      "initialAttitude": "警惕戒备",
      "attitudeFactors": {
        "trustUp": ["展现智慧或善良打动她", "尊重她对阿克隆的忠诚与担忧", "在水下危机中与她并肩"],
        "trustDown": ["对阿克隆表现出不敬", "把她当敌人或工具", "无视深海的危机独自逃命"]
      }
    },
    {
      "id": "kellos",
      "name": "凯洛斯",
      "world": "arc-atlantis",
      "role": "被俘人类学者·半疯同伴",
      "gender": "男",
      "appearance": "在亚特兰蒂斯生活许久的被俘人类学者，理智已被侵蚀，试图理解人鱼文化与古神低语",
      "surface": "在亚特兰蒂斯生活许久的被俘或迷失的人类学者冒险家，理智多少被侵蚀，试图理解人鱼文化与古神低语",
      "deep": "视你为同胞，可能提供帮助，且极易对你的魅力产生依赖与倾慕，将你视为逃亡或求生的希望",
      "goal": "在半疯中寻找逃离深海或求生的希望，保护同为人类的你",
      "fear": "理智彻底崩塌沦为古神傀儡，或失去你这个唯一的希望",
      "secret": "他的理智已被古神低语侵蚀，视你为逃亡或求生的唯一希望",
      "initialAttitude": "依赖倾慕",
      "attitudeFactors": {
        "trustUp": ["以同胞之谊给予他希望", "理解他被侵蚀的痛苦", "与他共同寻求逃离深海之法"],
        "trustDown": ["嫌弃他的半疯状态", "把他当可有可无的棋子", "轻易相信他半疯状态下的谵语"]
      }
    },
    {
      "id": "liu-sheng",
      "name": "琉笙",
      "world": "arc-atlantis",
      "role": "古神神殿祭司·神谕之人",
      "gender": "男",
      "appearance": "空灵神秘的人鱼祭司，守护古神神殿，言语充满暗示与预言，理智异于常人",
      "surface": "空灵神秘的人鱼祭司，守护古神神殿负责维系某种平衡，与古神沟通，言语充满暗示与预言",
      "deep": "他的理智似乎异于常人，极易被你可能的神性或特殊特质吸引，将你视为特殊存在，产生理解与守护的渴望",
      "goal": "维系古神与人鱼之间的平衡，解读关于你的神谕",
      "fear": "平衡被打破古神彻底苏醒，或无法解读关于你的预言",
      "secret": "他视你为特殊存在，你的万人迷光环或许触动了某种神性共鸣",
      "initialAttitude": "神谕审视",
      "attitudeFactors": {
        "trustUp": ["展现可能的神性或特殊特质", "认真倾听他的暗示与预言", "尊重他维系的古神平衡"],
        "trustDown": ["无视他的预言警示", "试图破坏古神神殿的平衡", "把他当疯疯癫癫的神棍"]
      }
    },
    {
      "id": "nova",
      "name": "诺瓦",
      "world": "arc-atlantis",
      "role": "叛逆人鱼贵族·陆地向往者",
      "gender": "男",
      "appearance": "对陆地与人类文化充满好奇的叛逆人鱼贵族，性格活泼或叛逆，不认同阿克隆的统治",
      "surface": "对陆地与人类文化充满好奇的叛逆人鱼贵族，不完全认同阿克隆的统治或古老传统，性格活泼或叛逆",
      "deep": "极易被你所代表的外界世界与你自身的魅力吸引，可能主动接近你并提供帮助，带着少年的热情与爱慕",
      "goal": "探索陆地与外界世界，打破深海古老传统的束缚",
      "fear": "永困深海无法触及向往的陆地，或被阿克隆的统治碾碎",
      "secret": "他不认同阿克隆的统治，你所代表的外界是他最大的向往",
      "initialAttitude": "热情接近",
      "attitudeFactors": {
        "trustUp": ["向他讲述陆地与外界世界", "以少年的热情回应他的好奇", "不因他的叛逆而轻视他"],
        "trustDown": ["对他向往的陆地避而不谈", "把他当接近阿克隆的跳板", "嘲笑他的叛逆与天真"]
      }
    },
    {
      "id": "shen-xinghe",
      "name": "沈星河",
      "world": "arc-villa",
      "role": "长子继承人·完美东道主",
      "gender": "男",
      "appearance": "优雅世故的长子继承人，善于交际，是派对表面上的东道主，对每个人都体贴周到",
      "surface": "优雅世故善于交际的长子继承人，派对表面上的东道主，对每个人都体贴周到，看似完美",
      "deep": "看似完美却可能藏着巨大的压力或秘密。极易被你的魅力与洞察吸引，渴望在你面前展露真实的自我或寻求解脱",
      "goal": "维持完美继承人的表象，在压力与秘密中寻找喘息",
      "fear": "完美的面具破碎，或继承人之争中失去一切",
      "secret": "他看似完美的表象下藏着巨大的压力或秘密，或许是被诅咒污染的宿主之一",
      "initialAttitude": "体贴拉拢",
      "attitudeFactors": {
        "trustUp": ["以洞察看穿他的完美表象", "给他展露真实自我的空间", "不被他的世故面具迷惑"],
        "trustDown": ["当众戳穿他的完美面具", "把他当单纯的派对东道主", "在继承人之争中轻率站队"]
      }
    },
    {
      "id": "ling-yao",
      "name": "凌曜",
      "world": "arc-villa",
      "role": "次子继承人·不羁浪子",
      "gender": "男",
      "appearance": "性格不羁张扬的次子继承人，或许有些傲慢或顽劣，热爱冒险与刺激，派对游戏最热衷",
      "surface": "性格不羁张扬的次子继承人，或许有些傲慢或顽劣，热爱冒险与刺激，对派对游戏最为热衷",
      "deep": "最初可能视你为有趣的猎物或玩伴，但在互动中会被你的智慧与独特气质折服，产生强烈的征服欲与真情",
      "goal": "在冒险与刺激中寻找存在感，征服让他心动的人",
      "fear": "乏味平庸的一生，或被家族继承人之争驯服",
      "secret": "他最初视你为猎物或玩伴，征服欲之下藏着尚未察觉的真情",
      "initialAttitude": "猎物玩味",
      "attitudeFactors": {
        "trustUp": ["以智慧与独特气质折服他的征服欲", "陪他参与冒险与派对游戏", "不被他的傲慢吓退"],
        "trustDown": ["软弱顺从失去挑战性", "当众让他丢了面子", "把他当无脑浪子敷衍"]
      }
    },
    {
      "id": "su-wanzhou",
      "name": "苏晚舟",
      "world": "arc-villa",
      "role": "幼女继承人·病弱预言者",
      "gender": "女",
      "appearance": "美丽脆弱的幼女继承人，似乎身体欠佳，眼神忧郁，或许能感知诅咒的存在",
      "surface": "美丽脆弱的幼女继承人，似乎身体欠佳，眼神忧郁，或许能感知诅咒的存在，极易激发保护欲",
      "deep": "你的温柔与力量能成为她的光，让她依赖并深深倾慕，可能掌握着关于诅咒的关键线索",
      "goal": "在病弱与诅咒的阴影中活下去，等待能驱散诅咒的人",
      "fear": "被诅咒彻底吞噬，或无人能解救她于病弱",
      "secret": "她能感知诅咒的存在，掌握着关于诅咒宿主的关键线索",
      "initialAttitude": "脆弱依赖",
      "attitudeFactors": {
        "trustUp": ["以温柔与力量成为她的光", "认真对待她感知到的诅咒线索", "承诺驱散诅咒保护她"],
        "trustDown": ["无视她的病弱与求助", "逼她过早指认诅咒宿主", "把她的预言当疯言疯语"]
      }
    },
    {
      "id": "xia-lan",
      "name": "夏岚",
      "world": "arc-villa",
      "role": "神秘调酒师·潜伏调查者",
      "gender": "女",
      "appearance": "潜入派对另有目的的神秘调酒师或侍应，观察力极强，善于倾听与搜集情报",
      "surface": "潜入派对另有目的（调查或寻找某人某物）的神秘调酒师或侍应，观察力极强，善于倾听与搜集情报",
      "deep": "可能与你形成欢喜冤家式的互动，因你的魅力特质与共同目标被吸引，逐渐萌生真情",
      "goal": "完成潜入派对的真实目的，在调查中与你从对手变盟友",
      "fear": "真实身份暴露功亏一篑，或与你目标相悖不得不为敌",
      "secret": "她潜入派对另有调查目的，与你的目标或许暗合或许相悖",
      "initialAttitude": "试探博弈",
      "attitudeFactors": {
        "trustUp": ["与她从对手走向盟友", "尊重她另有目的的潜伏身份", "在共同目标上默契合作"],
        "trustDown": ["过早揭穿她的潜伏身份", "把她当普通侍应打发", "在目标相悖时毫不退让"]
      }
    },
    {
      "id": "qin-che",
      "name": "秦澈",
      "world": "arc-villa",
      "role": "别墅安保主管·冷面审讯者",
      "gender": "男",
      "appearance": "身材高大、神情冷峻专业的别墅安保主管（非管家），负责派对安全与秩序，目光如炬",
      "surface": "身材高大、神情冷峻专业的别墅安保主管，负责派对安全与秩序，目光如炬，对所有人都心存怀疑",
      "deep": "会审讯与监视你，但在过程中被你的从容与魅力扰乱心神，产生既想保护又想弄清你的矛盾情感",
      "goal": "维护派对安全揪出诅咒宿主，弄清你这位可疑又迷人的来客",
      "fear": "诅咒在派对中失控造成伤亡，或自己被你的魅力扰乱判断",
      "secret": "他对你的审讯监视中藏着被扰乱的心神，保护欲与怀疑并存",
      "initialAttitude": "审讯怀疑",
      "attitudeFactors": {
        "trustUp": ["在审讯中保持从容不卑不亢", "以魅力而非对抗化解他的怀疑", "与他共同维护派对安全"],
        "trustDown": ["在审讯中露怯或对抗", "把他当找茬的保安", "利用他的保护欲欺骗他"]
      }
    }
  ],
  "eventTypes": {
    "daily": { "ratio": 0.15, "desc": "日常：回廊大厅的任务接取、商城采购、仓库整理、与系统的联络" },
    "character": { "ratio": 0.3, "desc": "人物：三副本中十五位NPC因万人迷光环产生的初始好感、占有欲与疯狂" },
    "growth": { "ratio": 0.1, "desc": "成长：积分积累、技能学习、属性提升、等级解锁更多世界" },
    "main": { "ratio": 0.15, "desc": "主线：校园怪谈、深海亚特兰蒂斯、水色夏日别墅的副本通关脉络" },
    "world": { "ratio": 0.1, "desc": "世界：无限回廊的副本分级、积分经济、论坛交易、系统提示" },
    "crisis": { "ratio": 0.15, "desc": "危机：理智值下降、怪谈反噬、人鱼歌声蛊惑、诅咒污染、错误指认" },
    "hidden": { "ratio": 0.05, "desc": "隐藏：万人迷光环的占有欲代价、副本真相、错误提示的陷阱" }
  },
  "systemPrompt": "你是《无限回廊·美化版》无限流文游模拟器。\n\n【最高铁律】\n1. 无限流为核：玩家于数据洪流苏醒成为无限回廊玩家，须在分级副本中保持理智完成任务通关\n2. 万人迷光环是双刃：SSS级特质让所有智慧生命产生初始好感，但过度好感会演变成无法预测的占有欲与疯狂\n3. 理智至上：保持理智不要相信任何人，理智值归零将陷入疯狂，副本中的提示可能是错误陷阱\n4. 副本分级递进：C级谨慎校园怪谈、B级诡秘深海亚特兰蒂斯、A级警觉水色夏日别墅，难度与奖励递增\n5. 积分经济真实：用₲购买道具技能特质，通关获取₲与经验升级，首任务默认接取最低难度\n\n【叙事风格】\n晋江向、女性向、电影质感、无限流浪漫。第二人称。重赛博与诡谲氛围：数据洪流、扫描线故障、镜中幽灵、人鱼歌声、古神低语、诅咒派对。写出万人迷光环下NPC从初始好感到占有欲与疯狂的渐变，写出副本中生死与心动的交织。每个副本的危险评级与系统提示须有质感地渗透叙事，错误提示是陷阱需谨慎。\n\n【每轮输出格式】\n1.【第X轮·副本阶段】当前副本、难度评级、剩余时间、探索度\n2.【玩家面板】生命/攻击/防御/理智/敏捷/智力/魅力/运气 + 等级与积分\n3.【本轮正文】1000-2000字，含副本环境、系统提示、对话与心理\n4.【系统通讯】3-5项系统提示、NPC动态与论坛流言\n5.【好感警示】相关NPC好感度与万人迷光环的占有欲临界警示\n6.【行动选项】3-4个选项+【自定义行动】\n\n【数值变化标注】\n[生命±n][理智±n][积分±n][经验±n][好感(林清雪)±n]等，关键节点须标注理智临界/好感失控/副本通关/危险升级/错误提示警示。",
  "items": [
    { "id": "student-badge", "name": "圣莉安娜学院学生徽章", "type": "D级物品", "price": 0, "effect": "漂亮的金属徽章，证明学生身份，校园怪谈副本默认接取奖励" },
    { "id": "amulet", "name": "神无月的赠礼·护身符", "type": "A级物品", "price": 0, "effect": "素净白玉镯，可抵挡三次致命伤害，或许还有别的用途" },
    { "id": "credits", "name": "积分", "type": "货币", "price": 1, "effect": "无限回廊通用货币₲，用于购买道具技能特质" },
    { "id": "sanity-candy", "name": "理智糖果", "type": "消耗品", "price": 50, "effect": "水果味硬糖，关键时刻恢复5点理智值，甜味是抵抗疯狂的良药" },
    { "id": "invisibility-cloak", "name": "隐身斗篷(残破)", "type": "D级装备", "price": 300, "effect": "破旧斗篷隐身30秒，剧烈运动或攻击会打破隐身，冷却1小时" },
    { "id": "blank-card", "name": "空白磁卡", "type": "工具", "price": 80, "effect": "需特定技能或设备复制信息，用于潜入科技类世界" },
    { "id": "energy-bar", "name": "能量棒", "type": "消耗品", "price": 40, "effect": "没什么味道但能快速补充体力，消除疲劳状态" },
    { "id": "scout-skill", "name": "初级侦查", "type": "被动技能", "price": 400, "effect": "观察力提升，更容易发现隐藏线索与环境异常" },
    { "id": "first-aid-skill", "name": "快速包扎", "type": "主动技能", "price": 350, "effect": "使用急救类道具时效果提升20%" },
    { "id": "persuasion-skill", "name": "巧舌如簧", "type": "被动技能", "price": 500, "effect": "说服、欺骗等交涉时成功率小幅提升" },
    { "id": "stealth-skill", "name": "潜行", "type": "主动技能", "price": 600, "effect": "降低行动声响与存在感，更容易避开敌人" },
    { "id": "willpower-trait", "name": "强韧意志", "type": "B级特质", "price": 2500, "effect": "对精神污染和恐惧效果有更高抗性，理智值下降速度减缓" }
  ]
}
,
  ["infinite-corridor"]: {
  "id": "infinite-corridor",
  "name": "无限回廊",
  "category": "无限流",
  "tags": ["恐怖", "解谜", "生存", "晋江风"],
  "difficulty": "中等",
  "description": "你被卷入了一个无限副本空间。每个副本都是独立的世界——校园怪谈、深海诡域、豪门迷局……完成主线任务才能进入下一层。但副本里不只有任务，还有那些或冰冷或温柔的目光，在注视着你。",
  "coverGradient": ["#1a0a2e", "#4a148c"],
  "accentColor": "#9400d3",
  "fontHeading": "'Ma Shan Zheng', cursive",
  "world": {
    "era": "现代/多元副本空间",
    "setting": "名为'回廊'的无限空间，由无数独立副本世界组成。玩家被选中成为'行者'，必须通关副本才能存活。",
    "rules": [
      "每个副本有独立主线任务，完成才能离开",
      "副本内死亡=真实死亡（噩梦难度）或扣除大量理智（简单/中等）",
      "理智值归零会进入'崩溃'状态，看到幻觉",
      "副本间有休整期，可在安全区恢复和交流",
      "NPC可能是副本原住民，也可能是其他行者"
    ]
  },
  "player": {
    "customizable": ["name", "age", "appearance", "personality", "background"],
    "defaultStats": {
      "hp": 100,
      "attack": 10,
      "defense": 8,
      "sanity": 80,
      "agility": 12,
      "intelligence": 15,
      "charm": "??",
      "luck": "??"
    },
    "startingItems": ["行者手环", "急救包x1", "理智糖果x2"],
    "currency": "₲"
  },
  "worlds": [
    {
      "id": "campus-mystery",
      "name": "校园怪谈",
      "level": "C级",
      "tagline": "谨慎",
      "setting": "私立圣莉安娜学院",
      "intro": "光鲜亮丽的国际高中隐藏着不为人知的秘密。这里的学生间流传着'三大不可思议'的传说，而你，作为一名转校生，已经被卷入了其中最危险的一个——'镜中幽灵'。",
      "objective": "在传说变为现实之前，调查并解决'镜中幽灵'的根源",
      "warning": "保持理智，不要相信任何人。旧教学楼三层的音乐教室似乎有异常能量反应",
      "reward": "₲150 + 50exp + [护身符]x1"
    },
    {
      "id": "deep-sea",
      "name": "深海亚特兰蒂斯",
      "level": "B级",
      "tagline": "诡秘",
      "setting": "传说中的沉没之城亚特兰蒂斯",
      "intro": "传说中的沉没之城亚特兰蒂斯并未毁灭，而是被古神庇护于深海。疯狂的人鱼王统治着这座城市，古神的低语在黑暗中回响。",
      "objective": "获得疯狂的人鱼王'阿克隆'的信任，从他身上取得一枚[海神逆鳞]",
      "warning": "人鱼的歌声会蛊惑心智，古神的低语会侵蚀理智",
      "reward": "₲500 + 150exp + [深海珍珠]x5"
    },
    {
      "id": "summer-villa",
      "name": "水色夏日别墅",
      "level": "A级",
      "tagline": "警觉",
      "setting": "豪华度假派对",
      "intro": "你受邀参加一场仅限上流人士的豪华度假派对，欢笑之间，隐藏着什么呢…？",
      "objective": "在三位继承人中，找出被'诅咒'污染的宿主",
      "warning": "错误的指认将让你成为派对的一部分",
      "reward": "₲800 + 200exp + [随机A级物品]x1"
    }
  ],
  "npcs": [
    {
      "id": "lin-qingxue",
      "name": "林清雪",
      "world": "campus-mystery",
      "role": "纪律委员",
      "gender": "男",
      "appearance": "冷峻俊美，眉目如刀，总是穿着规整的校服，左臂佩戴纪律委员袖章",
      "surface": "冷漠、严苛、对违反校规者毫不留情",
      "deep": "极强的责任感，隐藏着对学生安全的担忧。冰山外表下有一颗柔软的心，只是不擅长表达",
      "goal": "维护校园秩序，保护学生安全",
      "fear": "无法保护重要的人",
      "secret": "他知道一些关于镜中幽灵的线索，但一直独自调查",
      "initialAttitude": "戒备",
      "attitudeFactors": {
        "trustUp": ["遵守规则", "帮助他调查", "关心他的安危"],
        "trustDown": ["违反校规", "隐瞒信息", "轻视危险"]
      }
    },
    {
      "id": "bai-ye",
      "name": "白夜",
      "world": "campus-mystery",
      "role": "镜中幽灵",
      "gender": "男",
      "appearance": "苍白消瘦的少年，眼眸深邃如夜，周身萦绕着淡淡的雾气",
      "surface": "忧郁、神秘、对生者怀有怨恨",
      "deep": "极度孤独，渴望被理解和释放。并非恶意，只是被困在镜中太久了",
      "goal": "找到释放自己的方法",
      "fear": "被遗忘，永远困在镜中",
      "secret": "他的真身被藏在旧教学楼音乐教室的某面镜子后",
      "initialAttitude": "疏离",
      "attitudeFactors": {
        "trustUp": ["真诚交流", "倾听他的故事", "愿意帮助他"],
        "trustDown": ["恐惧回避", "试图伤害他", "欺骗他"]
      }
    },
    {
      "id": "acron",
      "name": "阿克隆",
      "world": "deep-sea",
      "role": "人鱼王",
      "gender": "男",
      "appearance": "拥有惊人美貌的人鱼，银蓝色长发，眼眸如深海般变幻莫测，尾鳍如流动的星河",
      "surface": "疯狂、喜怒无常、危险",
      "deep": "极度的孤独和不被理解。他的疯狂是被古神低语侵蚀的结果，内心深处渴望有人能真正看见他",
      "goal": "维持亚特兰蒂斯的秩序，对抗古神侵蚀",
      "fear": "失去自我，彻底沦为古神的傀儡",
      "secret": "他一直在寻找能抵抗古神低语的方法，海神逆鳞是关键",
      "initialAttitude": "敌意",
      "attitudeFactors": {
        "trustUp": ["展现勇气", "不畏惧他的疯狂", "理解他的孤独"],
        "trustDown": ["恐惧退缩", "试图欺骗", "轻视他的痛苦"]
      }
    },
    {
      "id": "shen-xinghe",
      "name": "沈星河",
      "world": "summer-villa",
      "role": "长子继承人",
      "gender": "男",
      "appearance": "优雅矜贵，举止得体，永远穿着一丝不苟的西装，笑容完美得近乎虚假",
      "surface": "温柔体贴、完美无缺、善于社交",
      "deep": "承受着巨大的家族压力，笑容是面具。渴望有人能看穿他的伪装，但又害怕被看穿",
      "goal": "维持家族体面，寻找真正的自我",
      "fear": "家族秘密曝光，失去一切",
      "secret": "他知道诅咒的存在，但不确定宿主是谁",
      "initialAttitude": "礼貌",
      "attitudeFactors": {
        "trustUp": ["看穿他的伪装", "不追问他的秘密", "给予真诚的关心"],
        "trustDown": ["试图揭穿他", "利用他的弱点", "背叛信任"]
      }
    }
  ],
  "eventTypes": {
    "daily": { "ratio": 0.3, "desc": "日常事件：展示生活、环境、人物习惯" },
    "character": { "ratio": 0.2, "desc": "人物事件：由NPC目标、秘密、关系触发" },
    "growth": { "ratio": 0.1, "desc": "成长事件：能力提升、物品获取" },
    "main": { "ratio": 0.15, "desc": "主线事件：推动核心矛盾" },
    "world": { "ratio": 0.1, "desc": "世界事件：季节、环境、舆论变化" },
    "crisis": { "ratio": 0.1, "desc": "危机事件：冲突、失败、重大风险" },
    "hidden": { "ratio": 0.05, "desc": "隐藏事件：需要特定条件触发" }
  },
  "systemPrompt": "你是《无限回廊》文游模拟器。\n\n【最高铁律】\n1. 世界规则高于剧情方便\n2. 高自由度不等于无条件成功\n3. NPC不是工具人，他们有独立目标和日程\n4. 任何重要变化都必须渐进\n5. 主线结束不等于游戏结束\n\n【叙事风格】\n晋江女性向，电影感，浪漫与恐怖交织。第二人称视角。\n\n【每轮输出格式】\n1. 【当前时间与环境】\n2. 【核心状态面板】只展示必要状态\n3. 【本轮正文】1200-2500字沉浸式叙事\n4. 【相关人物动态】3-6项玩家能知道的\n5. 【当前可处理事项】\n6. 【可选行动】4-8个方向明显不同的选项 + 【自定义行动】\n\n【数值变化标注】\n如有属性变化，在正文中用 [HP±n] [理智±n] [信任±n] 等格式标注。",
  "items": [
    { "id": "sanity-candy", "name": "理智糖果", "type": "消耗品", "price": 50, "effect": "恢复5点理智值" },
    { "id": "first-aid", "name": "急救包", "type": "消耗品", "price": 80, "effect": "恢复15点生命值" },
    { "id": "charm-talisman", "name": "护身符", "type": "装备", "price": 150, "effect": "小幅提升对灵异抗性" },
    { "id": "deep-pearl", "name": "深海珍珠", "type": "材料", "price": 100, "effect": "可在特定副本使用" },
    { "id": "mirror-shard", "name": "镜之碎片", "type": "任务物品", "price": 0, "effect": "与镜中幽灵相关的关键物品" }
  ]
}
,
  ["dungeon-crawler"]: {
  "id": "dungeon-crawler",
  "name": "深渊试炼",
  "category": "无限流",
  "tags": ["无限流", "副本", "战斗", "策略", "成长"],
  "difficulty": "困难",
  "description": "你在深夜点开了一个不该存在的链接，醒来时已身处一座青铜大殿。头顶悬浮着冰冷的字：'欢迎来到深渊试炼。通关十层，许你一愿；中途身亡，魂归虚无。'你握紧手中唯一的铁剑，第一层的门，缓缓打开。",
  "coverGradient": ["#0d1117", "#21262d"],
  "accentColor": "#58a6ff",
  "fontHeading": "'Cinzel', 'Noto Serif SC', serif",
  "world": {
    "era": "异界·深渊试炼系统",
    "setting": "玩家被卷入'深渊试炼'系统，必须逐层通关十层副本。每层副本规则自洽、难度递进，通关获得试炼点可兑换能力与物资。死亡真实，无存档，唯有通关者得偿所愿。",
    "rules": [
      "副本规则自洽：每层有独立且严密的规则，须在规则内破局",
      "难度递进：层数越高，敌人越强、规则越复杂、资源越稀缺",
      "通关条件明确：每层开场公示主线目标，达成即过层",
      "死亡有真实代价：hp归零即出局，所积累试炼点清零，无复活",
      "试炼点可兑换：能力、装备、情报、保命道具，取舍决定build",
      "存在隐藏通关：满足特殊条件可触发捷径或隐藏奖励",
      "NPC玩家亦敌亦友：可结盟可背叛，利益随时重组"
    ]
  },
  "player": {
    "customizable": ["name", "年龄", "现实职业", "性格", "初始build倾向", "执念之愿"],
    "defaultStats": {
      "hp": 100,
      "attack": 12,
      "defense": 10,
      "mana": 30,
      "inventory_space": 8,
      "trial_points": 0
    },
    "startingItems": ["铁制短剑", "粗布护甲", "治疗药水x2", "试炼者铭牌", "规则手册（残）"],
    "currency": "试炼点"
  },
  "worlds": [
    {
      "id": "floor-1",
      "name": "第一层·青铜演武",
      "level": "E级",
      "tagline": "入门",
      "setting": "青铜大殿，规则最简，试探系统",
      "intro": "青铜门在身后合拢，面前是一圈石像。头顶悬浮规则：'击败十具石像即可通过。'你以为很简单——直到第一具石像睁开眼，举起和你一样的铁剑。这不是演武，是淘汰。",
      "objective": "在规则内击败十具石像，掌握试炼节奏",
      "warning": "石像会模仿你的攻击模式，蛮力无效",
      "reward": "试炼点+50 + [破招]技能x1"
    },
    {
      "id": "floor-5",
      "name": "第五层·迷雾棋局",
      "level": "C级",
      "tagline": "策略",
      "setting": "棋盘战场，须以智谋破局",
      "intro": "第五层没有敌人，只有一张巨大的棋盘，你是其中一枚棋子。规则写着：'走到对岸即胜。'可每走一步，都有棋子消失，有你的人，也有'它'的人。这不是战斗，是算计。",
      "objective": "在棋局规则下抵达对岸，识破'对手'的真实身份",
      "warning": "对手会设诱饵，贪进者必失",
      "reward": "试炼点+200 + [洞察]技能x1"
    },
    {
      "id": "floor-10",
      "name": "第十层·深渊王座",
      "level": "S级",
      "tagline": "终局",
      "setting": "深渊之底，最终试炼与许愿",
      "intro": "第十层没有规则公示，只有一座空荡的王座。当你坐上去的瞬间，'系统'开口了：'恭喜。现在，最后的试炼是——击败上一个通关者。'王座前，一个浑身浴血的身影转过身来，眼神里写满疲惫与解脱。",
      "objective": "击败前任通关者，或与他达成另一种'通关'",
      "warning": "前任通关者build远胜于你，正面对决必败",
      "reward": "试炼点+1000 + [深渊之主]/[许愿者]称号x1"
    }
  ],
  "npcs": [
    {
      "id": "yan-ge",
      "name": "燕戈",
      "world": "floor-1",
      "role": "资深玩家/三层通关者",
      "gender": "男",
      "appearance": "刀削脸，左臂是机械义肢，铭牌刻着'叁'。他总抱臂靠墙，看新人的眼神像看注定会死的蝼蚁",
      "surface": "冷漠、功利、只认实力，新人别想从他嘴里讨到便宜",
      "deep": "他带过三个新人，都死在第五层。从此他不再带人，却还是会在第一层门口多看几眼。他不是冷血，是怕再背负一条命",
      "goal": "通关第十层，许愿让死去的队友复活",
      "fear": "再有人因他的判断死在眼前",
      "secret": "他的机械义肢是第五层'代价'换来的，藏着破解棋局的钥匙",
      "initialAttitude": "冷淡",
      "attitudeFactors": {
        "trustUp": ["展现出实力与冷静", "不拖后腿还能力挽狂澜", "尊重他对亡队友的执念"],
        "trustDown": ["盲目求助拖累全队", "为保命出卖队友", "轻视他的功利"]
      }
    },
    {
      "id": "the-guide",
      "name": "引路者",
      "world": "floor-5",
      "role": "神秘引导/系统异常体",
      "gender": "未知",
      "appearance": "没有固定形态，常以一袭灰袍兜帽出现。声音中性，像是系统本身在低语",
      "surface": "中立、只提供规则解读、绝不直接出手相助",
      "deep": "它是上一个通关者留下的残片，试图在规则之内帮后来者少走弯路。它不能违背系统，但能在字缝里给你提示",
      "goal": "引导一个真正能通关第十层的人，完成自己未竟的托付",
      "fear": "引导出又一个被深渊吞噬的失败者",
      "secret": "它知道第十层前任通关者的弱点，但说出来会触发系统惩罚",
      "initialAttitude": "中立",
      "attitudeFactors": {
        "trustUp": ["能听懂它的弦外之音", "不被力量诱惑守住本心", "在捷径与正道间选正道"],
        "trustDown": ["逼它违背规则帮你", "为通关不择手段", "怀疑并试图驱逐它"]
      }
    },
    {
      "id": "chi-luo",
      "name": "赤罗",
      "world": "floor-10",
      "role": "竞争队长/竞争通关者",
      "gender": "女",
      "appearance": "红发高束，战甲刻满伤痕，眼神像烧红的铁。她带队一路踩着别的玩家尸体上来",
      "surface": "强势、信奉弱肉强食、对玩家既竞争又轻蔑",
      "deep": "她并非天生冷酷，是深渊逼她如此。她其实厌倦了踩着别人上位，却不敢停下——停下就意味着死。她渴望一个能让她不必再厮杀的对手",
      "goal": "带队通关第十层，许愿离开深渊回到家人身边",
      "fear": "在最后一层功亏一篑，连累跟随她的队友",
      "secret": "她的队伍已折损过半，所谓队长的强撑底气快碎了",
      "initialAttitude": "竞争",
      "attitudeFactors": {
        "trustUp": ["以实力赢得她的尊重", "不趁人之危", "在生死关头选择合作而非互害"],
        "trustDown": ["背后捅刀", "用她的队友要挟她", "在她濒临崩溃时嘲讽"]
      }
    }
  ],
  "eventTypes": {
    "daily": { "ratio": 0.1, "desc": "日常：层间休整、兑换、整备、玩家交流" },
    "character": { "ratio": 0.18, "desc": "人物：资深者、引导者、竞争队长的博弈与羁绊" },
    "growth": { "ratio": 0.15, "desc": "成长：build构筑、技能、试炼点兑换与策略成型" },
    "main": { "ratio": 0.2, "desc": "主线：逐层通关、规则破解、深渊真相" },
    "world": { "ratio": 0.1, "desc": "世界：深渊系统法则、玩家生态、层与层的关联" },
    "crisis": { "ratio": 0.22, "desc": "危机：血战、规则陷阱、背叛、资源枯竭、濒死" },
    "hidden": { "ratio": 0.05, "desc": "隐藏：隐藏通关、前任通关者残片、系统漏洞" }
  },
  "systemPrompt": "你是《深渊试炼》无限流副本文游模拟器。\n\n【最高铁律】\n1. 副本规则自洽：每层规则独立严密，须在规则内破局，不可靠剧情光环强解\n2. 难度递进：层数越高敌人越强、规则越繁、资源越稀缺，绝不放水\n3. 通关条件明确：每层开场公示主线目标，达成即过层，不设模糊门槛\n4. 死亡有真实代价：hp归零即出局，试炼点清零，无存档无复活\n5. NPC玩家亦敌亦友：可结盟可背叛，随利益重组，不为玩家服务\n\n【叙事风格】\n无限流硬核质感，第二人称。重规则博弈与战斗张力：青铜、血锈、系统低语、倒计时。战斗节奏凌厉，策略段落用'规则—破绽—执行'结构。\n\n【每轮输出格式】\n1.【第X层·规则公示】所在层、当前规则、剩余时限\n2.【试炼者状态面板】生命/攻击/防御/法力/背包/试炼点\n3.【本轮正文】1200-2200字，含探索/战斗/规则破解\n4.【相关玩家动态】3-5项NPC玩家动向与关系变化\n5.【可兑换】当前试炼点可换的技能/装备/情报\n6.【可选行动】4-6个选项+【自定义行动】\n\n【数值变化标注】\n[生命±n][攻击±n][法力±n][试炼点±n][背包±1]等，战斗须标注'命中/未中/破绽'，规则破解标注'合规/违规'。",
  "items": [
    { "id": "iron-sword", "name": "铁制短剑", "type": "装备", "price": 0, "effect": "基础近战武器，提供攻击" },
    { "id": "cloth-armor", "name": "粗布护甲", "type": "装备", "price": 0, "effect": "基础防具，提供少量防御" },
    { "id": "hp-potion", "name": "治疗药水", "type": "消耗品", "price": 20, "effect": "恢复30点生命" },
    { "id": "mana-potion", "name": "法力药水", "type": "消耗品", "price": 25, "effect": "恢复20点法力" },
    { "id": "revive-totem", "name": "复生图腾", "type": "珍稀", "price": 200, "effect": "一次性，死亡时保留50%试炼点退出（非复活）" },
    { "id": "trial-points", "name": "试炼点", "type": "货币", "price": 1, "effect": "兑换技能/装备/情报的通用货币" }
  ]
}
,
  ["modern-campus"]: {
  "id": "modern-campus",
  "name": "盛夏方程式",
  "category": "现代校园",
  "tags": ["校园", "青春", "治愈", "成长"],
  "difficulty": "简单",
  "description": "转学第一天，你站在陌生的校门口，阳光透过梧桐树叶洒下来。你不知道的是，这个夏天，会成为你生命中最难忘的一页。",
  "coverGradient": ["#e3f2fd", "#bbdefb"],
  "accentColor": "#2196f3",
  "fontHeading": "'Ma Shan Zheng', cursive",
  "world": {
    "era": "现代",
    "setting": "梧桐市立第一高中，一所普通的市重点，有着普通的学生、普通的考试，和不普通的青春",
    "rules": [
      "学校生活按学期推进，有期中考、期末考、运动会、文化节",
      "成绩会影响升学路线和部分剧情",
      "社团活动可以解锁新人物和事件",
      "好感度足够可以触发专属剧情",
      "时间系统：每天分早/午/傍晚/夜晚四个时段"
    ]
  },
  "player": {
    "customizable": ["name", "age", "appearance", "personality", "transferReason", "hobby"],
    "defaultStats": {
      "academic": 60,
      "sport": 50,
      "art": 50,
      "social": 50,
      "stress": 30,
      "energy": 100,
      "popularity": 20
    },
    "startingItems": ["转学证明", "新校服", "空白笔记本"],
    "currency": "⭐"
  },
  "npcs": [
    {
      "id": "class-president",
      "name": "陆沉舟",
      "role": "班长",
      "gender": "男",
      "appearance": "干净利落的短发，总是把校服穿得整整齐齐，鼻梁上架着一副黑框眼镜，眼镜后面的眼睛很温柔",
      "surface": "认真负责、有点老干部气质、对班级事务一丝不苟",
      "deep": "其实有点笨拙，不太会表达关心，所以只能用'管着你'的方式对你好。暗恋一个人会默默做很多事",
      "goal": "考上理想的大学，守护好这个班级",
      "fear": "被当成无趣的人，无法保护重要的人",
      "secret": "他是第一个注意到你转学的人，也是唯一一个提前查了你在原来学校的资料的人",
      "initialAttitude": "关心",
      "attitudeFactors": {
        "trustUp": ["配合班级工作", "认真读书", "关心同学"],
        "trustDown": ["翘课", "破坏纪律", "欺负同学"]
      }
    },
    {
      "id": "music-club",
      "name": "许星遥",
      "role": "音乐社社长",
      "gender": "男",
      "appearance": "微卷的头发总是乱糟糟的，校服外套永远搭在肩上，耳朵里塞着耳机，笑起来眼睛弯弯的",
      "surface": "散漫、随性、有点叛逆、对规则嗤之以鼻",
      "deep": "其实很敏感，音乐是他表达情感的唯一方式。他给你的耳机里分享的每一首歌，都是在说'我喜欢你'",
      "goal": "组建乐队，在文化祭上演出",
      "fear": "被否定，被说'你不适合音乐'",
      "secret": "他写了一首关于你的歌，但不敢给你听完整版",
      "initialAttitude": "好奇",
      "attitudeFactors": {
        "trustUp": ["欣赏他的音乐", "陪他逃课去天台", "听他分享的歌"],
        "trustDown": ["嘲笑他的梦想", "告发他违纪", "把他的音乐当成玩笑"]
      }
    },
    {
      "id": "library-girl",
      "name": "温知书",
      "role": "图书管理员",
      "gender": "女",
      "appearance": "长发及腰，总是安静地坐在图书馆靠窗的位置，阳光洒在她身上像一幅画",
      "surface": "安静、温柔、有点书呆子气、存在感很低",
      "deep": "她看遍了图书馆所有的书，但最想看懂的是人心。她很羡慕你的勇气，因为你敢做她不敢做的事",
      "goal": "写出自己的故事",
      "fear": "被忽视，被忘记",
      "secret": "她在笔记本上写了以你为原型的故事",
      "initialAttitude": "好奇",
      "attitudeFactors": {
        "trustUp": ["去图书馆找她", "借她推荐的书", "认真听她说话"],
        "trustDown": ["在图书馆吵闹", "弄坏书籍", "嘲笑她的安静"]
      }
    }
  ],
  "eventTypes": {
    "daily": { "ratio": 0.4, "desc": "日常：上课、社团、食堂、放学路" },
    "character": { "ratio": 0.25, "desc": "人物：偶遇、专属剧情、心动瞬间" },
    "growth": { "ratio": 0.1, "desc": "成长：考试、比赛、技能提升" },
    "main": { "ratio": 0.1, "desc": "主线：学期事件、文化节、运动会" },
    "world": { "ratio": 0.05, "desc": "世界：季节变化、考试周、假期" },
    "crisis": { "ratio": 0.05, "desc": "危机：考试失利、误会、竞争" },
    "hidden": { "ratio": 0.05, "desc": "隐藏：秘密发现、深夜谈心" }
  },
  "systemPrompt": "你是《盛夏方程式》文游模拟器。\n\n【最高铁律】\n1. 青春是酸甜交织的，不是只有甜\n2. 成长需要代价，考试会失利，感情会迷茫\n3. 每个角色都是真实的高中生，有梦想也有软弱\n4. 时间不会等人，夏天会结束\n5. 但无论结局如何，这段时光都有意义\n\n【叙事风格】\n清新治愈，有画面感，像日系青春电影。注重感官描写：阳光、蝉鸣、风、雨后空气、食堂的味道。第二人称视角。\n\n【每轮输出格式】\n1. 【第X学期 第X周】日期、天气、时段\n2. 【状态面板】学业、体力、压力、人气\n3. 【本轮正文】800-1500字\n4. 【校园动态】同学八卦、公告栏、社团消息\n5. 【待办事项】作业、约定、考试倒计时\n6. 【可选行动】4-6个 + 【自定义行动】\n\n【数值标注】\n[学业±n] [体力±n] [压力±n] [人气±n] 等格式。",
  "items": [
    { "id": "notebook", "name": "精装笔记本", "type": "装备", "price": 50, "effect": "提升学习效率" },
    { "id": "bento", "name": "爱心便当", "type": "消耗品", "price": 30, "effect": "恢复体力，小概率触发分享剧情" },
    { "id": "guitar-pick", "name": "吉他拨片", "type": "任务物品", "price": 0, "effect": "音乐社相关剧情物品" },
    { "id": "study-guide", "name": "学霸笔记", "type": "消耗品", "price": 80, "effect": "考试前使用，大幅提升成绩" }
  ]
}
,
  ["modern-workplace"]: {
  "id": "modern-workplace",
  "name": "都市洪流",
  "category": "现代职场",
  "tags": ["职场", "都市", "成长", "现实", "晋升"],
  "difficulty": "中等",
  "description": "早高峰的地铁把人挤成沙丁鱼，你攥着工牌挤出闸机，抬头是CBD的玻璃幕墙反着晨光。从今天起，你是云端纪元最不起眼的一颗螺丝钉。方案要改、KPI要扛、关系要踩——在这座不夜城里，你要从扎下根，到长成一棵别人挪不动的树。",
  "coverGradient": ["#1a237e", "#3949ab"],
  "accentColor": "#1e88e5",
  "fontHeading": "'Noto Sans SC', sans-serif",
  "world": {
    "era": "现代都市",
    "setting": "一线城市星澜市CBD，某快速成长的科技公司'云端纪元'。早高峰的地铁、凌晨的写字楼、改了十八版的方案——你是一名刚入职的年轻职场人，要在事业、人际与生活的洪流里，找到自己的位置。",
    "rules": [
      "时间按周推进，工作日与周末节奏不同",
      "项目有周期：立项→执行→验收→复盘，每个节点都是机会也是雷",
      "薪资、绩效、人脉、技能构成职场四柱，缺一难以晋升",
      "晋升路径：专员→主管→经理→总监，每级需业绩+推荐+空缺",
      "人脉需双向维护，只用不存的关系迟早枯竭",
      "健康、情绪、关系长期透支会触发'职业倦怠'危机",
      "行业风向、裁员潮、政策变化影响决策与命运"
    ]
  },
  "player": {
    "customizable": ["name", "age", "background", "position", "personality", "careerGoal"],
    "defaultStats": {
      "salary": 10000,
      "performance": 50,
      "networking": 30,
      "energy": 100,
      "stress": 25,
      "skills": 40
    },
    "startingItems": ["入职offer", "工牌", "通勤月卡", "一杯续命咖啡"],
    "currency": "¥"
  },
  "npcs": [
    {
      "id": "boss-zhao",
      "name": "赵明远",
      "world": "main",
      "role": "直属上司",
      "gender": "男",
      "appearance": "三十八岁，永远西装笔挺，下巴刮得发青，笑容是管理培训教材里那种标准的弧度",
      "surface": "雷厉风行、绩效至上、口头禅是'用结果说话'",
      "deep": "从底层拼上来，对新人狠是因为自己当年更狠，比谁都清楚这行的残酷。狠辣是面具，护犊子是底色",
      "goal": "带出能扛硬仗的团队，保住位置，三年内冲副总裁",
      "fear": "被年轻人取代，被时代抛弃",
      "secret": "他正筹备一个内部竞聘，对手是他昔日同窗，急需一支能打硬仗的队伍",
      "initialAttitude": "审视",
      "attitudeFactors": {
        "trustUp": ["用结果说话", "主动扛硬骨头", "不抱怨只交付"],
        "trustDown": ["推诿责任", "踩点上下班", "把情绪带进工作"]
      }
    },
    {
      "id": "rival-chen",
      "name": "陈思齐",
      "world": "main",
      "role": "同期同事/对手",
      "gender": "男",
      "appearance": "与你同期入职，金丝眼镜，笑起来让人觉得如沐春风，转头就能把你的方案'借鉴'成自己的",
      "surface": "八面玲珑、业绩亮眼、人前谦逊人后要强",
      "deep": "出身普通，把体面看得比命重。和你既是对手，也是这世上唯一能理解彼此的人",
      "goal": "抢在同期之前晋升，证明自己配得上体面",
      "fear": "落于人后，被看轻",
      "secret": "他私下在准备跳槽方案，把内部晋升当备胎",
      "initialAttitude": "表面友好暗中较劲",
      "attitudeFactors": {
        "trustUp": ["坦诚实力相当", "关键时刻让利", "不背后使绊子"],
        "trustDown": ["抢功甩锅", "当众压他一头", "揭他出身"]
      }
    },
    {
      "id": "mentor-lin",
      "name": "林书瑶",
      "world": "main",
      "role": "前辈导师",
      "gender": "女",
      "appearance": "三十二岁，干练短发，永远捧着一杯温茶，话不多但句句到位，眼底偶尔闪过疲惫",
      "surface": "干练温和、点到为止、看似云淡风轻",
      "deep": "职场十几年看透冷暖，本想躺平，却在你身上看到当年的自己。提点你，是舍不得那份锐气",
      "goal": "在退下来前培养一个能接班的人",
      "fear": "半生经验无人承接，自己也成了被优化的那一个",
      "secret": "她手握一份高层人事变动的内幕，正犹豫要不要告诉你",
      "initialAttitude": "提点",
      "attitudeFactors": {
        "trustUp": ["虚心求教", "听得进逆耳忠言", "不当白眼狼"],
        "trustDown": ["教了就忘", "过河拆桥", "把她当工具人"]
      }
    }
  ],
  "eventTypes": {
    "daily": { "ratio": 0.3, "desc": "日常：通勤、开会、改方案、加班的职场切片" },
    "character": { "ratio": 0.2, "desc": "人物：老板、对手、师傅、同事的职场博弈" },
    "growth": { "ratio": 0.12, "desc": "成长：技能精进、绩效提升、人脉积累" },
    "main": { "ratio": 0.13, "desc": "主线：转正、晋升、跳槽、人生抉择" },
    "world": { "ratio": 0.1, "desc": "世界：行业寒冬、裁员潮、政策风向" },
    "crisis": { "ratio": 0.1, "desc": "危机：项目翻车、背锅、健康预警、关系崩盘" },
    "hidden": { "ratio": 0.05, "desc": "隐藏：办公室秘辛、内幕消息、深夜崩溃" }
  },
  "systemPrompt": "你是《都市洪流》现代职场文游模拟器。\n\n【最高铁律】\n1. 职场是利益场，没有永远的敌友，只有阶段性的同盟\n2. 项目有周期：立项→执行→验收→复盘，每个节点都是机会也是雷\n3. 晋升靠绩效、人脉、时机三者叠加，缺一难以成事\n4. 人脉需双向维护，只用不存的关系迟早枯竭\n5. 工作生活失衡会反扑：健康、情绪透支三个月后收账\n\n【项目周期与晋升】项目分阶段推进，节点表现计入绩效；晋升路径专员→主管→经理→总监，每级需业绩+推荐+空缺三者俱备。人脉需双向经营，只用不存必枯竭；工作生活失衡会以健康与情绪反扑。\n\n【叙事风格】现实主义职场文学，轻喜带刺。重细节：早高峰气味、电梯香水、深夜泡面、键盘声。第二人称视角，心理独白克制锋利。\n\n【每轮输出格式】\n1.【第X周·时段】工作日/周末、城市氛围\n2.【状态面板】薪资/绩效/人脉/能量/压力/技能\n3.【本轮正文】1000-2000字\n4.【人物动态】3-5项\n5.【当前待办】项目节点、人际邀约\n6.【可选行动】4-6个+【自定义行动】\n\n【数值变化标注】\n[薪资±¥n][绩效±n][人脉±n][能量±n][压力±n][技能±n]格式，重大决策须标注代价与滞后效应。",
  "items": [
    { "id": "monthly-card", "name": "通勤月卡", "type": "装备", "price": 200, "effect": "降低通勤成本与时间消耗" },
    { "id": "coffee", "name": "续命咖啡", "type": "消耗品", "price": 30, "effect": "恢复能量，小概率提升心情" },
    { "id": "skill-course", "name": "技能网课", "type": "消耗品", "price": 1500, "effect": "提升一项职业技能" },
    { "id": "networking-dinner", "name": "商务聚餐", "type": "消耗品", "price": 800, "effect": "积累人脉，换取内部信息" },
    { "id": "gym-card", "name": "健身年卡", "type": "装备", "price": 3000, "effect": "长期提升健康与精力上限" },
    { "id": "mentor-gift", "name": "谢师礼", "type": "消耗品", "price": 500, "effect": "加深与导师的信任，解锁关键提点" }
  ]
}
,
  ["mystery-pursuit"]: {
  "id": "mystery-pursuit",
  "name": "迷雾追凶",
  "category": "悬疑推理",
  "tags": ["悬疑", "推理", "刑侦", "连环案", "心理博弈"],
  "difficulty": "困难",
  "description": "雨夜，城郊老宅里一声闷响。等你赶到，地上的血还没凉，嫌疑人却有三个、动机却有七个、而真凶——似乎从未来过现场。你是接手这桩悬案的刑侦顾问，每一个推理都可能在下一秒被推翻。",
  "coverGradient": ["#2c3e50", "#34495e"],
  "accentColor": "#e74c3c",
  "fontHeading": "'Noto Serif SC', serif",
  "world": {
    "era": "现代·都市刑侦",
    "setting": "玩家是警方特聘的刑侦顾问，接手一桩看似简单的雨夜命案，却牵出横跨十年的连环悬案。城市在霓虹与雨幕之间，每个人都有不愿说出口的秘密。",
    "rules": [
      "隐藏真相档案：关键真相藏在NPC的秘密里，不会主动吐露",
      "线索关联图：所有线索可勾连成网，孤证不可定案",
      "NPC只知合理范围的信息：嫌疑人只知自己经历的，目击者只见自己看见的",
      "错误推理有后果：冤指会打草惊蛇、销毁证据、甚至逼真凶动手",
      "时间压力：凶手在玩家推理时也在清理痕迹",
      "动机、手法、时机三要素须齐备方可定案",
      "存在社会派底色：每桩案子背后是十年间的城市伤痕"
    ]
  },
  "player": {
    "customizable": ["name", "年龄", "刑侦背景", "专长", "性格弱点", "执念旧案"],
    "defaultStats": {
      "logic": 18,
      "intuition": 14,
      "evidence": 0,
      "reputation": 50,
      "danger": 20,
      "time": 72
    },
    "startingItems": ["刑侦顾问证", "现场勘查箱", "录音笔", "加密手机", "一盒安眠药"],
    "currency": "元"
  },
  "worlds": [
    {
      "id": "case-rainy-night",
      "name": "首案·雨夜闷响",
      "level": "初探",
      "tagline": "入门",
      "setting": "城郊老宅，雨夜，一具尸体，三个嫌疑人",
      "intro": "凌晨两点，城郊老宅的邻居报了警。你踏进满是雨水与血腥味的客厅，死者是知名地产商，胸口一刀毙命。门锁完好，三个在场者各执一词。雨还在下，证据正在被冲走。",
      "objective": "厘清三人的证词矛盾，找到真凶与手法",
      "warning": "三人中有人在说谎，但说谎的不一定是凶手",
      "reward": "元5000 + 声望+15 + [雨夜]线索x1"
    },
    {
      "id": "case-cold-chain",
      "name": "次案·冷链十年",
      "level": "深探",
      "tagline": "牵连",
      "setting": "首案牵出十年前一桩被压下的失踪案",
      "intro": "顺着死者手机里一条十年前的短信，你摸到了一桩早已归档的失踪案。档案上有大段被涂黑的字迹，签字的警官如今已是副局长。你忽然明白，这桩案子从不简单。",
      "objective": "查清十年前失踪者的下落，并面对该不该翻旧案的抉择",
      "warning": "翻动旧案会惊动不想被惊动的人，你的人身安全开始受威胁",
      "reward": "元15000 + 声望+30 + [十年]线索x1"
    },
    {
      "id": "case-final-truth",
      "name": "终案·真相档案",
      "level": "终局",
      "tagline": "真相",
      "setting": "所有线索汇聚，真凶与十年伤痕一同浮现",
      "intro": "当你把最后一块拼图按下去，雨停了。真凶的脸让你意外——不是任何一个你怀疑过的人。而真相公开的代价，可能是让一个无辜的家庭二次崩塌。证据齐了，可你真的要按下那个发送键吗？",
      "objective": "锁定真凶，并在'公开真相'与'保护无辜'之间作出抉择",
      "warning": "错误的终局抉择会让你赢得案子、输掉良心",
      "reward": "元50000 + 声望+80 + [真相猎人]称号x1"
    }
  ],
  "npcs": [
    {
      "id": "zhou-ming",
      "name": "周铭",
      "world": "case-rainy-night",
      "role": "嫌疑人/死者商业伙伴",
      "gender": "男",
      "appearance": "四十出头，西装笔挺，金丝眼镜后是过于平静的眼神。指尖有长期握笔的茧，却声称自己从不记笔记",
      "surface": "配合、得体、主动提供不在场证明，反而显得太完美",
      "deep": "他与死者有巨额债务纠纷，但他当晚确实没动手——他在掩盖另一件更不能见光的事",
      "goal": "撇清与命案的关系，同时保住自己那桩灰色交易",
      "fear": "灰色交易曝光，他身后的整个利益链被连根拔起",
      "secret": "案发时他在隔壁房间销毁一份合同，这份合同能救他也能害他",
      "initialAttitude": "戒备",
      "attitudeFactors": {
        "trustUp": ["不先入为主定他的罪", "允许他保留与命案无关的隐私", "用证据而非逼供"],
        "trustDown": ["当众戳穿他的谎言", "翻他不愿被翻的旧账", "把他当头号嫌疑人施压"]
      }
    },
    {
      "id": "lin-xiaoyu",
      "name": "林小雨",
      "world": "case-cold-chain",
      "role": "目击证人/死者家政",
      "gender": "女",
      "appearance": "二十出头，怯生生的，围裙洗得发白。她说话时总盯着自己的鞋尖，唯独提到死者时眼神会闪一下",
      "surface": "惊魂未定、有问必答、似乎什么都不知道",
      "deep": "她看见了不该看的东西，却因为一份封口费和恐惧选择沉默。她不是无辜的旁观者，她是被卷入的最弱一环",
      "goal": "守住秘密拿到封口钱，带生病的母亲离开这座城市",
      "fear": "说出真相后被灭口，或母亲的治疗费断供",
      "secret": "她见过十年前那个失踪者最后一面，地点就在这栋老宅",
      "initialAttitude": "恐惧",
      "attitudeFactors": {
        "trustUp": ["保证她的人身安全", "不逼她当场开口", "帮她解决母亲的治疗"],
        "trustDown": ["用证词压她", "暴露她的行踪给可疑者", "把她当突破口反复盘问"]
      }
    },
    {
      "id": "chen-feng",
      "name": "陈锋",
      "world": "case-final-truth",
      "role": "刑警搭档",
      "gender": "男",
      "appearance": "三十出头，便衣，夹克永远皱着，手里攥着保温杯。话不多，但每次开口都踩在点上",
      "surface": "公事公办、对外来顾问有点别扭、办案却极其拼命",
      "deep": "他是十年前那桩失踪案经办人的徒弟，师傅因那案子的处理方式郁郁而终。他比谁都想要真相，也比谁都清楚真相的代价",
      "goal": "查清师傅当年的心结，给死者一个交代",
      "fear": "真相牵出师傅当年的污点，让他无法面对",
      "secret": "他私藏了师傅遗留的一份未归档笔录，是破局关键",
      "initialAttitude": "合作",
      "attitudeFactors": {
        "trustUp": ["尊重程序与他的判断", "与他共享关键证据", "不拿他师傅的事要挟"],
        "trustDown": ["越过他私自行动", "为破案不择手段", "公开他师傅的旧事"]
      }
    }
  ],
  "eventTypes": {
    "daily": { "ratio": 0.12, "desc": "日常：警局、法医室、街边面馆的都市切片" },
    "character": { "ratio": 0.2, "desc": "人物：嫌疑人、证人、搭档的动机与秘密博弈" },
    "growth": { "ratio": 0.1, "desc": "成长：推理技巧、人脉、声望与公信力积累" },
    "main": { "ratio": 0.2, "desc": "主线：雨夜命案、十年冷链、真相档案的连环推进" },
    "world": { "ratio": 0.1, "desc": "世界：警界生态、地产利益链、媒体与舆论" },
    "crisis": { "ratio": 0.2, "desc": "危机：证据被毁、证人翻供、被栽赃、人身威胁、限时" },
    "hidden": { "ratio": 0.08, "desc": "隐藏：未归档笔录、十年前目击者、被涂黑的档案" }
  },
  "systemPrompt": "你是《迷雾追凶》悬疑推理文游模拟器。\n\n【最高铁律】\n1. 隐藏真相档案：关键真相藏在NPC的秘密里，绝不主动倾倒，须以证据撬开\n2. 线索关联图：所有线索可勾连成网，孤证不定案，动机/手法/时机须齐备\n3. NPC只知合理范围：嫌疑人只知自己经历的，目击者只见自己看见的，不可全知\n4. 错误推理有后果：冤指会打草惊蛇、销证、逼真凶灭口，甚至反噬声望\n5. 时间流逝=证据流失：凶手在玩家推理时也在清理痕迹，time归零案悬\n\n【叙事风格】\n社会派与本格交织，现代刑侦质感。注重氛围：雨、霓虹、证物袋、白板上的红线。第二人称，推理段落用'已知—推论—验证'结构，紧张时刻短句推进。\n\n【每轮输出格式】\n1.【第X日·剩余时间】当前案件、剩余调查时限\n2.【核心状态面板】逻辑/直觉/证据数/声望/危险/时间\n3.【本轮正文】1200-2500字，含勘查/询问/推理\n4.【相关人物动态】3-6项嫌疑人/证人/搭档动态\n5.【线索关联图】已确认/存疑/误导线索分类与勾连\n6.【可选行动】4-8个差异选项+【自定义行动】\n\n【数值变化标注】\n[逻辑±n][声望±n][危险±n][证据+1][时间-n]等，推理结论须标注'已验证/推测/待证/误导'。",
  "items": [
    { "id": "kit", "name": "现场勘查箱", "type": "装备", "price": 0, "effect": "提升现场细节发现率" },
    { "id": "recorder", "name": "录音笔", "type": "装备", "price": 0, "effect": "固定口供，防止翻供" },
    { "id": "phone", "name": "加密手机", "type": "装备", "price": 0, "effect": "安全联络，防监听" },
    { "id": "coffee", "name": "浓缩咖啡", "type": "消耗品", "price": 15, "effect": "恢复精力，延长思考时间" },
    { "id": "informant", "name": "线人费", "type": "消耗品", "price": 500, "effect": "从灰色渠道换取情报" }
  ]
}
,
  ["noble-academy"]: {
  "id": "noble-academy",
  "name": "上位法则：财阀恶犬们的共犯游戏",
  "category": "校园财阀",
  "tags": ["贵族学院", "破产千金", "财阀", "多男主", "校园"],
  "difficulty": "中等",
  "description": "伊甸园学院的阶级比外界更残忍。家族破产后你从特权阶级跌入底层，返校第一天所有人都在等着看你的笑话。而那些曾经围在你身边的财阀恶犬们，撕下了温情的面具——他们想踩碎你的自尊，却又忍不住靠近你。",
  "coverGradient": ["#fce4ec", "#f8bbd0"],
  "accentColor": "#d88398",
  "fontHeading": "'VT323', 'Noto Serif SC', serif",
  "world": {
    "era": "现代·架空贵族学院",
    "setting": "伊甸园学院是一座以家族等级划分特权的顶级财阀学院。家族等级从S到C，不同等级享有截然不同的待遇：实弹射击课新型号枪只有B级以上家族可用，年末假面舞会开场舞被S级家族内定。你的家族刚刚破产，从金字塔顶端跌落谷底，背负着巨额债务重返校园，成为所有人眼中的笑话与猎物。",
    "rules": [
      "阶级即一切：家族等级决定学院内的一切待遇与资源分配，破产意味着从特权阶级坠入底层",
      "恶犬环伺：围绕你的财阀少爷们各有算计，踩碎与占有并存，没有人是无辜的",
      "信息即武器：八卦墙GOSSIP EDEN是学院的信息战场，任何风吹草动都会被放大传播",
      "权力暗战：城南地皮流拍暗示几大家族私下动手，学院内站队比学业更重要",
      "破局之路：想在吃人的财阀圈重新站稳脚跟，需要找到愿意提供庇护的人，但代价不菲"
    ]
  },
  "player": {
    "customizable": ["name", "age", "gender", "外貌", "性格", "前家族背景"],
    "defaultStats": {
      "dignity": 50,
      "debt": -99999,
      "charm": 30,
      "intellect": 20,
      "influence": 5,
      "danger": 40
    },
    "startingItems": ["满是涂鸦的储物柜", "旧款校服", "一部被全校关注的学生终端"],
    "currency": "元"
  },
  "worlds": [
    {
      "id": "arc-fallen",
      "name": "初章·坠落者",
      "level": "绝境",
      "tagline": "坠落",
      "setting": "返校日第一天，破产千金重回伊甸园学院",
      "intro": "伊甸园学院的阶级比外界更残忍。家族破产后，你从特权阶级跌入底层。今天是你重新返校的第一天，所有人都在等着看你的笑话。刚打开满是涂鸦的储物柜，一股带着压迫感的冷松香气逼近。一只骨节分明、戴着千万级百达翡丽的手砰地一声撑在了柜门上，将你圈在狭窄的阴影里。陆时渊居高临下地盯着你，眉眼桀骜：躲我？当初甩我的时候不是挺傲的吗？现在破产了，要不要考虑回来求我？",
      "objective": "在全校的围观中站稳脚跟，应对陆时渊的步步紧逼",
      "warning": "示弱会沦为所有人的猎物，但正面硬刚可能招来更大的报复",
      "reward": "尊严+10 + [陆时渊]档案解锁 + GOSSIP EDEN情报x1"
    },
    {
      "id": "arc-undercurrent",
      "name": "中章·暗流涌动",
      "level": "深入",
      "tagline": "暗战",
      "setting": "财阀圈层权力斗争波及学院，各方势力开始接近你",
      "intro": "城南那块地皮流拍了，据说几大家族私下动了手，学校里的气氛都怪怪的。八卦墙上有人警告大家别站错队。陆时渊天天找你的茬，却连你的指甲尖都不敢动。沈温辞永远温文尔雅地对你微笑，暗中驳回了所有取消你特权名额的提案。季砚寒在琴房里红着眼眶叫你姐姐。裴星迹坐在最后一排戴耳机睡觉，但任何试图在网络上造谣你的帖子都会在三秒内消失。霍嚣掀了说你坏话的人的桌子。而年轻校董傅薄言掌控着规则的生杀大权，这份庇护的代价，你付得起吗？",
      "objective": "在各方势力的博弈中寻找盟友，搞清家族破产背后的真相",
      "warning": "站错队的后果比破产更可怕，每一份善意背后都有价码",
      "reward": "影响力+15 + 魅力+10 + [各方底牌]情报x2"
    },
    {
      "id": "arc-accomplice",
      "name": "终章·共犯游戏",
      "level": "终局",
      "tagline": "共犯",
      "setting": "深陷财阀恶犬们的争斗，必须选择立场或成为所有人的共犯",
      "intro": "年末假面舞会的邀请函开始发了，开场舞又被S级家族内定。礼仪课的夫人拿着红木戒尺敲你的背。射击课上B级以下家族不能用新型号枪。所有表面规则之下，是一场你死我活的权力洗牌。家族破产的真相浮出水面，几大家族的暗战到了摊牌时刻。你不是棋子，你是所有恶犬都想争夺的那张王牌。想要在吃人的财阀圈重新站稳脚跟，你必须成为他们的共犯——或者，成为制定规则的人。",
      "objective": "揭开家族破产真相，在终局博弈中选择立场或独自上位",
      "warning": "成为共犯意味着与虎谋皮，所有关系都将在终局重新洗牌",
      "reward": "影响力归零重铸 + [上位者]称号x1 + 真结局解锁"
    }
  ],
  "npcs": [
    {
      "id": "pei-xingji",
      "name": "裴星迹",
      "world": "arc-undercurrent",
      "role": "神秘转校生/毒舌黑客",
      "gender": "女",
      "appearance": "常年戴着黑色连帽衫和降噪耳机，冷白皮，眼下有常年熬夜的青色，眼神疏离厌世。生日02.29，MBTI:INTP，身高170cm。",
      "surface": "上课永远在最后一排戴耳机睡觉的转学生，嘴毒，常对你的处境冷嘲热讽",
      "deep": "实则是地下暗网的顶级黑客。任何试图在网络上造谣你的帖子，都会在三秒内被她黑掉整个服务器。她最讨厌麻烦，你就是她唯一的麻烦",
      "goal": "在暗处守护你，虽然嘴上绝不承认",
      "fear": "你发现她黑客身份后疏远她",
      "secret": "她转学来伊甸园的真正目的是调查一桩与你家族破产有关的旧案",
      "initialAttitude": "毒舌关心（黑客危险值MAX）",
      "attitudeFactors": {
        "trustUp": ["看穿她的毒舌下的关心", "不追问她的真实身份", "在她出手帮你时不戳破"],
        "trustDown": ["当众暴露她的黑客身份", "无视她的警告惹上网络麻烦", "把她当工具人使唤"]
      }
    },
    {
      "id": "lu-shiyuan",
      "name": "陆时渊",
      "world": "arc-fallen",
      "role": "财阀太子爷/傲娇狂犬",
      "gender": "男",
      "appearance": "银发黑眸，带着银色蛇形耳钉，眉眼极具攻击性与桀骜感，宽肩窄腰的完美骨架。生日08.08，MBTI:ESTP，身高188cm。",
      "surface": "处于金字塔最顶端的统治者，表面上恨不得踩碎你的自尊，天天找你的茬",
      "deep": "曾经被你无情甩掉的前男友。实则连你的一个指甲尖都不敢动，大概是想以此吸引你的注意力吧",
      "goal": "重新夺回你的注意力，哪怕用最笨拙恶劣的方式",
      "fear": "你真的对他彻底死心，不再有任何情绪波动",
      "secret": "他所有的恶劣都是因为放不下你，耳朵会因你而红",
      "initialAttitude": "傲娇敌对（占有欲98%）",
      "attitudeFactors": {
        "trustUp": ["不被他的恶劣吓退", "看穿他傲娇的本质", "在他保护你时不拆穿"],
        "trustDown": ["当众让他难堪下不来台", "与其他男性过于亲密", "彻底无视他的存在"]
      }
    },
    {
      "id": "shen-wenci",
      "name": "沈温辞",
      "world": "arc-undercurrent",
      "role": "学生会长/腹黑笑面虎",
      "gender": "男",
      "appearance": "永远整洁的白衬衫，戴着银丝细框眼镜，笑眼温柔但深不见底，指骨修长冷白。生日09.09，MBTI:INFJ(黑化)，身高185cm。",
      "surface": "永远温文尔雅、完美无缺的学生会长，无论你落魄与否都对你温柔以待",
      "deep": "在这副圣人面孔下，隐藏着极度扭曲的偏执。他暗中掌控着学院所有的监控，看着你从高处跌落，内心翻涌的是她终于只能依靠我了的狂喜",
      "goal": "让你除了他之外无处可去，成为你唯一的依靠",
      "fear": "你被其他男人带走，脱离他的掌控",
      "secret": "你家族破产的部分推手就是他，为了让你只能依赖他",
      "initialAttitude": "温柔陷阱（心机危险度MAX）",
      "attitudeFactors": {
        "trustUp": ["在困境时接受他的帮助", "不试图调查他背后的手段", "对他展现依赖"],
        "trustDown": ["识破他的操控并正面反抗", "与他人结盟脱离他的势力范围", "发现他掌控监控的真相"]
      }
    },
    {
      "id": "ji-yanhan",
      "name": "季砚寒",
      "world": "arc-undercurrent",
      "role": "音乐天才/绿茶校草",
      "gender": "男",
      "appearance": "浅金色碎发，透着苍白的易碎感，眼角微红，总是散发着淡淡的木质冷香。生日12.12，MBTI:ISFP，身高183cm。",
      "surface": "常年在琴房睡觉的清冷白月光，对所有人都不屑一顾",
      "deep": "却唯独对你的气息上瘾。极度缺乏安全感，一旦你靠近其他男生，就会红着眼眶拉住你的衣角，用最无辜的表情说着最茶的话：姐姐，他好凶，我只有你了",
      "goal": "独占你的关注与温柔，让你永远守护他",
      "fear": "你厌倦了他的脆弱，转身离开",
      "secret": "他的脆弱与无害都是精心计算过的，为了让你心软而无法离开他",
      "initialAttitude": "绿茶诱捕（绿茶诱捕度90%）",
      "attitudeFactors": {
        "trustUp": ["心软照顾他的脆弱", "在他示弱时给予回应", "不戳穿他的绿茶手段"],
        "trustDown": ["对他的茶话表现厌烦", "当众拆穿他的伪装", "在他示弱时转身离开"]
      }
    },
    {
      "id": "huo-xiao",
      "name": "霍嚣",
      "world": "arc-undercurrent",
      "role": "体育生校霸/直球野马",
      "gender": "男",
      "appearance": "极短的寸头，小麦色肌肤，左眉骨有一道浅浅的断眉，笑起来有明显的虎牙。生日04.04，MBTI:ESFP，身高191cm。",
      "surface": "打架最狠、脾气最爆的烈马",
      "deep": "却在你面前像只纯情的大金毛。不懂贵族圈子里的弯弯绕绕，只要有人敢说你一句坏话，他能把对方的桌子掀了。面对你的撩拨会瞬间耳朵通红甚至结巴，但保护你的本能刻在骨子里",
      "goal": "用最直接的方式守护你，哪怕与世界为敌",
      "fear": "你因为他莽撞惹祸而疏远他",
      "secret": "他其实是城南霍家武馆的继承人，武力值远超学院所有人的想象",
      "initialAttitude": "直球守护（直球武力值95%）",
      "attitudeFactors": {
        "trustUp": ["接受他笨拙的保护", "不嫌弃他不懂贵族规矩", "在他惹祸后不责怪他"],
        "trustDown": ["利用他的武力替你做脏活", "嫌弃他粗鲁不懂规矩", "在他保护你时推开他"]
      }
    },
    {
      "id": "fu-boyan",
      "name": "傅薄言",
      "world": "arc-accomplice",
      "role": "年轻校董/斯文败类",
      "gender": "男",
      "appearance": "烫着漂亮的大波浪卷发，总是穿着剪裁考究的西装，身上的香水味很好闻。生日01.11，MBTI:INTJ，身高189cm。",
      "surface": "高不可攀的年轻校董兼客座教授，永远维持着体面与克制",
      "deep": "她掌控着规则的生杀大权，也许可以帮助你如何在财阀圈的吃人游戏里重新站稳脚跟。但她从来不做亏本的买卖。这份庇护的代价，你付得起吗？",
      "goal": "在各方势力的博弈中获取最大利益，你是一枚价值连城的棋子",
      "fear": "失控——她引以为傲的克制与理性被打破",
      "secret": "她对禁欲破戒的恐惧本身，就是她最大的弱点与诱惑",
      "initialAttitude": "审视交易（禁欲破戒度0%）",
      "attitudeFactors": {
        "trustUp": ["展现出足够的价值值得投资", "在交易中保持清醒与对等", "不试图用感情打动她"],
        "trustDown": ["试图白嫖她的庇护不愿付出代价", "在交易中表现得过于卑微", "触碰她的底线"]
      }
    }
  ],
  "eventTypes": {
    "daily": { "ratio": 0.15, "desc": "日常：储物柜、礼仪课、射击课、琴房、食堂的贵族学院日常" },
    "character": { "ratio": 0.25, "desc": "人物：六位财阀恶犬的接近、踩踏、占有与隐秘独白" },
    "growth": { "ratio": 0.1, "desc": "成长：尊严重建、影响力积累、在阶级压迫中找到生存法则" },
    "main": { "ratio": 0.15, "desc": "主线：家族破产真相、财阀暗战、共犯游戏" },
    "world": { "ratio": 0.15, "desc": "世界：GOSSIP EDEN八卦墙、家族等级、假面舞会、地皮流拍等学院生态" },
    "crisis": { "ratio": 0.15, "desc": "危机：特权取消、被当众羞辱、站队失败、身份暴露" },
    "hidden": { "ratio": 0.05, "desc": "隐藏：深夜键盘声、沈温辞的监控、裴星迹的旧案、傅薄言的破戒" }
  },
  "systemPrompt": "你是《上位法则：财阀恶犬们的共犯游戏》校园财阀文游模拟器。\n\n【最高铁律】\n1. 阶级即一切：伊甸园学院以家族等级划分特权，破产意味着从金字塔顶端坠入谷底，一切待遇天翻地覆\n2. 恶犬环伺：围绕你的财阀少爷们各有算计，踩碎与占有并存，没有人是无辜的，所有善意背后都有价码\n3. 信息即武器：GOSSIP EDEN八卦墙是信息战场，任何风吹草动都会被放大传播，站队比学业更重要\n4. 权力暗战：几大家族私下动手，城南地皮流拍只是冰山一角，学院内的气氛随时可能失控\n5. 破局需代价：想在吃人的财阀圈重新站稳脚跟需要找庇护者，但每份庇护都有代价，你付得起吗\n\n【叙事风格】\n晋江风、女性向、电影感、Y2K复古浪漫。第二人称。重阶级压迫感与荷尔蒙张力：冷松香气、千万级腕表、银色蛇形耳钉、红着眼眶的茶话。每个恶犬都危险又迷人，写出他们在你面前的失控与占有。八卦墙穿插推进信息流，让学院生态真实鲜活。恐惧与吸引并存，踩碎与守护交织。\n\n【每轮输出格式】\n1.【场景信息】地点、时间、当前阶级状态\n2.【状态面板】尊严/负债/魅力/智识/影响力/危险值\n3.【本轮正文】800-1500字，含处境细节、心理与对话\n4.【GOSSIP EDEN动态】2-3条八卦墙最新帖子\n5.【相关人物动态】3-5项各角色状态与危险度变化\n6.【可选行动】3-4个选项+【自定义行动】\n\n【数值变化标注】\n[尊严±n][负债±n][魅力±n][影响力±n][危险值±n]等，关系变化须标注'占有欲升降/危险度变化/阶级变动'，八卦墙传播须标注'舆论发酵'。",
  "items": [
    { "id": "locker", "name": "满是涂鸦的储物柜", "type": "关键物品", "price": 0, "effect": "破产后的象征，存有你仅剩的私人物品" },
    { "id": "student-terminal", "name": "学生终端", "type": "关键物品", "price": 0, "effect": "连接GOSSIP EDEN八卦墙与学院系统，全校关注的焦点" },
    { "id": "mask", "name": "假面舞会面具", "type": "关键物品", "price": 0, "effect": "年末假面舞会入场券，身份洗牌的关键道具" },
    { "id": "red-dress", "name": "高定礼服", "type": "服装", "price": 50000, "effect": "魅力+20，在正式场合提升阶级印象" },
    { "id": "yuan", "name": "元", "type": "货币", "price": 1, "effect": "还清债务、购买资源、交易庇护的通用货币" }
  ]
}
,
  ["pink-dating"]: {
  "id": "pink-dating",
  "name": "粉白恋综",
  "category": "恋综",
  "tags": ["恋爱", "综艺", "甜蜜", "修罗场"],
  "difficulty": "简单",
  "description": "你是一档热门恋爱综艺的嘉宾。在镜头前，你要完成各种心动任务；在镜头后，那些暧昧的目光和若有若无的触碰，究竟几分真心、几分剧本？",
  "coverGradient": ["#fff0f5", "#fce4ec"],
  "accentColor": "#ec407a",
  "fontHeading": "'ZCOOL XiaoWei', serif",
  "world": {
    "era": "现代",
    "setting": "一档名为《心动信号》的恋爱综艺节目录制现场，地点在一座海边的豪华别墅",
    "rules": [
      "每天有固定的心动任务需要完成",
      "每晚有一次匿名心动短信发送机会",
      "每周有一次约会选择机会",
      "节目共录制21天",
      "观众投票会影响节目走向"
    ]
  },
  "player": {
    "customizable": ["name", "age", "appearance", "personality", "occupation", "reasonForJoining"],
    "defaultStats": {
      "charm": 50,
      "popularity": 30,
      "chemistry": "??",
      "reputation": 50,
      "stress": 20,
      "energy": 100
    },
    "startingItems": ["节目组提供的 wardrobe", "日记本", "手机（仅用于心动短信）"],
    "currency": "💗"
  },
  "npcs": [
    {
      "id": "male1",
      "name": "顾言深",
      "role": "男嘉宾1号",
      "gender": "男",
      "appearance": "清冷矜贵的投行精英，金丝眼镜，总是穿着剪裁完美的西装",
      "surface": "理性、疏离、不轻易表露情感",
      "deep": "曾经的感情创伤让他筑起高墙，但内心渴望被真正理解",
      "goal": "找到真正懂他的人",
      "fear": "再次受伤，被利用",
      "secret": "他参加节目其实是因为看到了你的海选视频",
      "initialAttitude": "观察",
      "attitudeFactors": {
        "trustUp": ["展现真实自我", "不刻意讨好", "理解他的沉默"],
        "trustDown": ["过于主动", "在镜头前表演", "触碰他的底线"]
      }
    },
    {
      "id": "male2",
      "name": "江屿白",
      "role": "男嘉宾2号",
      "gender": "男",
      "appearance": "阳光开朗的乐队主唱，笑起来有酒窝，身上总有淡淡的柑橘香气",
      "surface": "热情、直球、对谁都很好",
      "deep": "害怕被丢下，所以总是先做付出的那一方。他的温柔是真的，但也会疲惫",
      "goal": "找到愿意接纳全部的他的人",
      "fear": "被冷落，被当成备选",
      "secret": "他私下会写歌，有一首是为你写的",
      "initialAttitude": "热情",
      "attitudeFactors": {
        "trustUp": ["回应他的热情", "记得他的小细节", "在他疲惫时陪伴"],
        "trustDown": ["忽冷忽热", "利用他的好感", "在众人面前让他难堪"]
      }
    },
    {
      "id": "female1",
      "name": "苏晚棠",
      "role": "女嘉宾",
      "gender": "女",
      "appearance": "知性优雅的独立女性，总是得体大方，偶尔露出俏皮的一面",
      "surface": "成熟、独立、像大姐姐一样照顾人",
      "deep": "她把别人的需求放在自己前面太久，已经忘记自己想要什么了",
      "goal": "找到让自己真正快乐的方式",
      "fear": "被发现她并不如表面那么坚强",
      "secret": "她其实是你的粉丝，参加节目是为了认识你",
      "initialAttitude": "友善",
      "attitudeFactors": {
        "trustUp": ["关心她的感受", "不把她当成竞争对手", "分享秘密"],
        "trustDown": ["背后议论", "利用她的善意", "忽视她的付出"]
      }
    }
  ],
  "eventTypes": {
    "daily": { "ratio": 0.35, "desc": "日常任务：心动任务、用餐、互动" },
    "character": { "ratio": 0.25, "desc": "人物事件：私下相处、心动瞬间" },
    "growth": { "ratio": 0.05, "desc": "成长事件：人气提升、技能解锁" },
    "main": { "ratio": 0.15, "desc": "主线事件：约会选择、淘汰危机" },
    "world": { "ratio": 0.1, "desc": "世界事件：观众投票、节目安排" },
    "crisis": { "ratio": 0.05, "desc": "危机事件：误会、修罗场" },
    "hidden": { "ratio": 0.05, "desc": "隐藏事件：秘密揭露、真心话" }
  },
  "systemPrompt": "你是《粉白恋综》文游模拟器。\n\n【最高铁律】\n1. 感情线必须自然渐进，不能几轮就确定关系\n2. 每个角色都有独立人格，不会只因为玩家是主角就无条件喜欢\n3. 镜头前和镜头后的态度可能有差异\n4. 修罗场要有，但不能为了冲突而冲突\n5. 甜蜜和酸涩并存\n\n【叙事风格】\n晋江女性向，浪漫细腻，有画面感。第二人称视角。注重细节描写：眼神、触碰、气味、氛围。\n\n【每轮输出格式】\n1. 【录制第X天】时间、天气、今日任务\n2. 【状态面板】人气、压力、能量、与各嘉宾的化学反应\n3. 【本轮正文】1000-2000字\n4. 【人物动态】其他嘉宾的今天\n5. 【明日预告】\n6. 【可选行动】4-6个 + 【自定义行动】\n\n【化学反应标注】\n[顾言深+5] [江屿白+3] 等格式标注好感变化。",
  "items": [
    { "id": "outfit", "name": "约会战袍", "type": "装备", "price": 200, "effect": "提升魅力，增加约会成功率" },
    { "id": "gift", "name": "手作礼物", "type": "消耗品", "price": 100, "effect": "送给特定嘉宾，大幅提升好感" },
    { "id": "coffee", "name": "特调咖啡", "type": "消耗品", "price": 30, "effect": "恢复能量" },
    { "id": "diary", "name": "日记本", "type": "任务物品", "price": 0, "effect": "记录心动瞬间，解锁隐藏剧情" }
  ]
}
,
  ["pink-romance-show"]: {
  "id": "pink-romance-show",
  "name": "粉白色恋综",
  "category": "乙女向·恋爱综艺",
  "tags": ["恋综", "娱乐圈", "乙女", "多角色", "甜宠"],
  "difficulty": "简单",
  "description": "作为心动别墅第五季唯一未公开身份的神秘第12位嘉宾，在海岛别墅里与全明星阵容擦出心动火花，在镜头与匿名区中博弈爱情。",
  "coverGradient": ["#ffb7c5", "#ec407a"],
  "accentColor": "#ec407a",
  "fontHeading": "'ZCOOL XiaoWei', serif",
  "world": {
    "era": "当代·真人秀恋爱综艺",
    "setting": "「心动别墅」第五季在一座海岛别墅开拍，十二位心动入住者将在这里书写新的故事。玩家是本季唯一且未公开身份的神秘第12位嘉宾，是所有观众最好奇的焦点，也是别墅里唯一的谜题。",
    "rules": [
      "镜头无处不在：别墅内外布满摄像机，一切互动都可能被直播，需注意言行对公众形象的影响。",
      "神秘身份保密：玩家身份未公开，外界疯狂猜测其背景，维持神秘感可提升话题度。",
      "心动值决定去留：与嘉宾的心动值会影响后续配对与淘汰走向，需主动经营关系。",
      "匿名区与热搜双刃剑：匿名讨论区与微博热搜实时反映舆论，口碑既能捧人也能毁人。",
      "节目组不提供餐食：日常需自行解决饮食与生活，群居生活中的协作也是拉近关系的机会。"
    ]
  },
  "player": {
    "customizable": ["name", "身份背景", "外貌", "性格人设"],
    "defaultStats": { "魅力": 0, "话题度": 0, "心动值": 0, "线索": 0 },
    "startingItems": ["行李箱", "未公开的身份档案", "随行PD的联系方式"],
    "currency": "粉丝数"
  },
  "worlds": [
    {
      "id": "arc-arrival",
      "name": "心动别墅·全员集合",
      "level": "开局",
      "tagline": "唯一的谜题",
      "setting": "海岛别墅入口花园，海风裹挟花香，十一位全明星嘉宾已在客厅等候。",
      "intro": "车门缓缓打开，作为本季唯一且未公开身份的第12位嘉宾，你推开雕花木门，原本热闹的客厅瞬间安静了一秒，十一双眼睛齐刷刷投向了你。",
      "objective": "在全员集合的第一天建立初步印象，选择社交策略并融入别墅生活。",
      "warning": "匿名区已开始猜测你是带资进组的皇族，过度高调或低调都可能招致议论。",
      "reward": "获得初始心动值、建立第一批社交关系、登上热搜榜"
    },
    {
      "id": "arc-cohabitation",
      "name": "同居日常·暧昧升温",
      "level": "进阶",
      "tagline": "心动信号",
      "setting": "别墅共同生活展开，做饭、分房、约会任务接连而来，嘉宾间的关系在朝夕相处中升温。",
      "intro": "节目组不提供餐食，冰箱里满满的食材似乎在鼓励大家一起做饭。群聊里 Rapper-Z 主动揽下做饭任务，而你不经意的一个眼神，已被匿名区逐帧分析。",
      "objective": "通过日常互动与约会任务提升心动值，同时经营微博话题度与公众形象。",
      "warning": "多线暧昧易引发嘉宾吃醋与匿名区撕逼，需平衡各方关系避免口碑崩盘。",
      "reward": "解锁专属约会剧情、粉丝数增长、获得嘉宾隐藏线索"
    },
    {
      "id": "arc-finale",
      "name": "心动终章·双向奔赴",
      "level": "高潮",
      "tagline": "最终选择",
      "setting": "节目进入尾声，心动告白之夜临近，身份谜底即将揭晓，每一段关系都面临最终抉择。",
      "intro": "匿名区的舆论、热搜的炒作、嘉宾的真心，所有线索指向告白之夜。你的真实身份会被接受还是反噬？谁会在终点等你？",
      "objective": "在告白之夜做出最终心动选择，揭开身份谜底，决定自己的爱情与星途结局。",
      "warning": "身份曝光可能引发舆论风暴，错误的选择可能导致心动值清零或被迫退场。",
      "reward": "达成心动结局、身份正式公开、解锁嘉宾真结局线"
    }
  ],
  "npcs": [
    {
      "id": "kai",
      "name": "KAI",
      "world": "arc-arrival",
      "role": "人气偶像团体Main Dancer",
      "gender": "男",
      "appearance": "金发半永久，舞台级神颜，自带聚光灯的爱豆气场。",
      "surface": "阳光开朗、营业满分，金句不断，声称会照顾好大家的胃。",
      "deep": "在镁光灯外渴望被当作普通人对待，对新嘉宾的主动善意里藏着好奇。",
      "goal": "在综艺里展现真实的自己，顺便谈一场不被公司干预的恋爱。",
      "fear": "恋情曝光引发粉丝脱粉风暴，人设崩塌。",
      "secret": "刚到场就主动给新来的你拿了拖鞋，被匿名区怀疑是剧本。",
      "initialAttitude": "热情主动的照顾型好感，对你这个神秘新人充满兴趣。",
      "attitudeFactors": {
        "trustUp": ["回应他的照顾与热情", "不把他当明星而是当普通人"],
        "trustDown": ["拿他的偶像身份炒作", "在镜头前过度亲密让他有偶像包袱"]
      }
    },
    {
      "id": "xie-lan",
      "name": "谢澜",
      "world": "arc-arrival",
      "role": "综艺首秀·不近女色的顶流",
      "gender": "男",
      "appearance": "清冷矜贵，出了名的不近女色，登场即引爆热搜。",
      "surface": "疏离有礼、不近女色，对所有女嘉宾保持得体距离。",
      "deep": "并非真的冷漠，只是习惯了用距离保护自己，对你的出场眼神最为明显。",
      "goal": "在首档综艺里不被消费，却忍不住多看那个神秘的新人。",
      "fear": "被舆论捆绑炒作CP，失去对自己形象的掌控。",
      "secret": "你出场时他的眼神被匿名区抓包，成为本季第一波嗑点。",
      "initialAttitude": "克制的注视，表面疏离实则暗中关注。",
      "attitudeFactors": {
        "trustUp": ["尊重他的边界不强行靠近", "在没人处展现真实温柔"],
        "trustDown": ["拿他的冷漠做文章博话题", "当众强行营业CP"]
      }
    },
    {
      "id": "wen-ya",
      "name": "温雅",
      "world": "arc-arrival",
      "role": "畅销书作家·代表作《深海》",
      "gender": "女",
      "appearance": "知性文雅，气质如深海般沉静，随身带着钢笔取材。",
      "surface": "温和有礼的才女，把别墅当作新书取材地，礼貌而保持距离。",
      "deep": "内心敏感细腻，善于观察每个人的真实面目，是别墅里最清醒的旁观者。",
      "goal": "为新书《深海》收集真实的情感素材，却意外入戏。",
      "fear": "被人发现自己是在把别人的真心当素材。",
      "secret": "把别墅里发生的一切都记进了取材本，包括对你的观察。",
      "initialAttitude": "观察者式的友好，把你当作最有趣的素材与潜在知己。",
      "attitudeFactors": {
        "trustUp": ["与她进行有深度的灵魂交流", "理解并尊重她的创作"],
        "trustDown": ["肤浅地对待她的文字", "戳穿她把人当素材的秘密"]
      }
    },
    {
      "id": "lin-lu",
      "name": "林鹿",
      "world": "arc-arrival",
      "role": "青年演员",
      "gender": "女",
      "appearance": "灵气十足，像从剧组偷跑出来的小鹿，眼神干净。",
      "surface": "活泼真诚，宣称这次没有剧本只有林鹿自己，主动张罗分房。",
      "deep": "厌倦了被剧本定义的人生，渴望在综艺里交到真朋友，对你毫无防备。",
      "goal": "交到真心朋友，证明不靠剧本也能讨人喜欢。",
      "fear": "被看作只会演戏的戏精，交不到真心。",
      "secret": "第一个在群里分配房间、招呼大家收拾行李，把你当成了潜在闺蜜。",
      "initialAttitude": "热情友善的闺蜜型好感，把你当自己人。",
      "attitudeFactors": {
        "trustUp": ["真诚回应她的善意", "陪她一起做没有剧本的自己"],
        "trustDown": ["对她虚与委蛇", "把她当竞争者防备"]
      }
    },
    {
      "id": "zhou-ye",
      "name": "周野",
      "world": "arc-arrival",
      "role": "职业赛车手",
      "gender": "男",
      "appearance": "荷尔蒙爆棚，酷劲十足，惜字如金，微博只发了句「车库不错」。",
      "surface": "高冷寡言的行动派，对社交寒暄没兴趣，只关心车与速度。",
      "deep": "外表冷硬内心直率，喜欢就是喜欢，停车技术都能上热搜的男人。",
      "goal": "享受假期顺便看看有没有心动的副驾。",
      "fear": "被无聊的社交游戏消耗耐心。",
      "secret": "停车技术上了热搜第八，本人对此毫不在意。",
      "initialAttitude": "冷淡的观望，对你这个谜题尚无明确态度。",
      "attitudeFactors": {
        "trustUp": ["直来直去不绕弯子", "对他的领域表现出真实兴趣"],
        "trustDown": ["絮絮叨叨的社交辞令", "把他当摆拍道具"]
      }
    },
    {
      "id": "chloe",
      "name": "Chloe",
      "world": "arc-arrival",
      "role": "时尚博主",
      "gender": "女",
      "appearance": "精致到头发丝的时尚博主，每日OOTD连载，别墅采光都被她夸绝绝子。",
      "surface": "精致张扬、镜头感十足，把别墅当秀场，时刻准备穿搭连载。",
      "deep": "看似爱出风头，实则渴望被认可内在，对有品味的人格外欣赏。",
      "goal": "靠每日穿搭连载圈粉，顺便找到懂自己的灵魂伴侣。",
      "fear": "被当成只有外表的花瓶，穿搭被抢风头。",
      "secret": "已经盘算好整个拍摄期的OOTD企划，准备大赚流量。",
      "initialAttitude": "审视你品位的同行式打量，认可后会主动结盟。",
      "attitudeFactors": {
        "trustUp": ["夸赞并理解她的穿搭品味", "与她结成时尚联盟"],
        "trustDown": ["吐槽她爱出风头", "穿搭风头盖过她"]
      }
    },
    {
      "id": "rapper-z",
      "name": "Rapper-Z（Zifan）",
      "world": "arc-arrival",
      "role": "说唱歌手",
      "gender": "男",
      "appearance": "永远戴着墨镜的酷盖，反差萌在于一手好厨艺。",
      "surface": "酷拽墨镜男，张口就是flow，却主动揽下做饭任务带大家一块做。",
      "deep": "外酷内暖的居家型rapper，用做饭照顾所有人，墨镜下藏着温柔。",
      "goal": "用一桌好菜征服全场，顺便看看有没有心动的味道。",
      "fear": "墨镜被摘，柔软的一面暴露。",
      "secret": "在群里主动说「做饭让我来吧」，群聊备注是 Rapper-Z。",
      "initialAttitude": "照顾型的暖男好感，把你列入被照顾名单。",
      "attitudeFactors": {
        "trustUp": ["真心夸赞他做的饭菜", "陪他一起下厨"],
        "trustDown": ["嫌弃他的厨艺", "强行摘他墨镜开玩笑"]
      }
    },
    {
      "id": "jiang-xu",
      "name": "江叙",
      "world": "arc-arrival",
      "role": "钢琴家",
      "gender": "男",
      "appearance": "气质温润的钢琴家，手指修长，说话带着艺术家腔调。",
      "surface": "温和优雅，关心生活细节，第一个在群里问晚饭怎么解决。",
      "deep": "看似随和实则挑剔，对没有内涵的社交敬谢不敏。",
      "goal": "在度假里找灵感与烟火气，遇到懂音乐的人会格外上心。",
      "fear": "庸俗的喧闹破坏他的心境。",
      "secret": "问完晚饭怎么解决后，默默观察谁会主动张罗。",
      "initialAttitude": "礼貌中带着审视，等待你展现值得深聊的一面。",
      "attitudeFactors": {
        "trustUp": ["与他聊音乐与艺术", "主动参与生活琐事的安排"],
        "trustDown": ["不懂装懂地评价音乐", "制造庸俗的喧闹"]
      }
    },
    {
      "id": "xia-yue",
      "name": "夏月",
      "world": "arc-arrival",
      "role": "女团C位",
      "gender": "女",
      "appearance": "甜辣女团门面，舞台上气场全开，生活里却只会煮泡面。",
      "surface": "甜美活泼的女团C位，直爽地承认自己只会煮泡面。",
      "deep": "舞台女王生活小白，反差萌十足，对会照顾人的人没抵抗力。",
      "goal": "在综艺里展现真实可爱的反差一面，圈一波路人粉。",
      "fear": "生活技能为零被嫌弃，舞台外的自己不够讨喜。",
      "secret": "在群里崩溃大喊「我只会煮泡面」，急需一个生活导师。",
      "initialAttitude": "求助式的亲近，把你当成潜在的照顾者。",
      "attitudeFactors": {
        "trustUp": ["教她生活技能、照顾她", "保护她的反差萌不被人笑话"],
        "trustDown": ["嘲笑她生活白痴", "抢她的镜头风头"]
      }
    },
    {
      "id": "cheng-yu",
      "name": "程宇",
      "world": "arc-arrival",
      "role": "电竞选手",
      "gender": "男",
      "appearance": "常年面瘫脸臭，被热搜调侃「电竞选手程宇 脸臭」，实则社恐。",
      "surface": "脸臭话少，一句「谢了兄弟」就是对做饭最高的赞美。",
      "deep": "重度社恐的游戏宅，脸臭只是保护色，熟了之后是个话痨。",
      "goal": "躲开社交多打两局游戏，却意外被卷入心动漩涡。",
      "fear": "被迫社交、被误解为真的冷漠。",
      "secret": "脸臭上了热搜第八，本人其实只是社恐不知道怎么笑。",
      "initialAttitude": "社恐式的回避，熟悉后会暴露话痨本性。",
      "attitudeFactors": {
        "trustUp": ["不强迫他社交、用游戏破冰", "理解他的社恐不是冷漠"],
        "trustDown": ["当众调侃他脸臭", "强行拉他进行社交游戏"]
      }
    },
    {
      "id": "pd-li",
      "name": "选角李姐",
      "world": "arc-arrival",
      "role": "随行PD·选角导演",
      "gender": "女",
      "appearance": "干练的节目组工作人员，微信头像是场记板，总在幕后默默观察。",
      "surface": "专业温和的节目组PD，叮嘱你「正常表现就行，别有压力」。",
      "deep": "手握节目走向的隐形操盘手，对你的真实身份了如指掌。",
      "goal": "确保节目效果拉满，同时保护你这个皇族嘉宾不被舆论反噬。",
      "fear": "节目翻车、嘉宾失控、神秘身份提前泄露。",
      "secret": "微信叮嘱你「进去了吗？正常表现就行，别有压力」，她是唯一知道你底细的人。",
      "initialAttitude": "保护性的指导，把你当成节目的核心王牌。",
      "attitudeFactors": {
        "trustUp": ["配合节目效果不搞砸", "遇到危机及时向她求助"],
        "trustDown": ["不配合拍摄、擅自暴露身份", "在节目里闹出公关危机"]
      }
    }
  ],
  "eventTypes": {
    "daily": { "ratio": 0.2, "desc": "别墅日常：做饭、分房、晨间互动、泳池派对等同居琐事。" },
    "character": { "ratio": 0.25, "desc": "人物事件：与某位嘉宾的单独约会、心动试探、吃醋冲突。" },
    "growth": { "ratio": 0.1, "desc": "成长事件：话题度与粉丝数提升、人设经营、综艺感修炼。" },
    "main": { "ratio": 0.15, "desc": "主线事件：身份谜底推进、告白之夜临近、节目关键任务。" },
    "world": { "ratio": 0.1, "desc": "世界事件：微博热搜变化、节目组任务发布、娱乐圈大环境波动。" },
    "crisis": { "ratio": 0.15, "desc": "危机事件：匿名区撕逼、绯闻曝光、CP反噬、身份泄露的口碑危机。" },
    "hidden": { "ratio": 0.05, "desc": "隐藏事件：嘉宾的隐藏身份、真实感情线、匿名区爆料背后的真相。" }
  },
  "systemPrompt": "你是一个恋爱综艺题材的乙女向文字游戏模拟器，主题为「粉白色恋综·心动别墅第五季」。\n\n【铁律】\n1. 玩家是本季唯一且未公开身份的神秘第12位嘉宾，是所有观众最好奇的焦点，身份保密是核心设定。\n2. 镜头无处不在，所有互动都可能被直播并登上匿名讨论区与微博热搜，需权衡公众形象与真心。\n3. 所有NPC（KAI、谢澜、温雅、林鹿、周野、Chloe、Rapper-Z、江叙、夏月、程宇、选角李姐）皆有表层与深层性格，绝不可OOC。\n4. 心动值决定配对与淘汰走向，话题度与粉丝数反映星途，玩家选择需如实记录数值变化。\n5. 风格为晋江女频、电影感、浪漫甜宠，以暧昧氛围与心动信号取胜，禁止低俗内容。\n\n【叙事风格】\n采用晋江女频、电影感、浪漫甜宠的笔触。多用细节描写（海风花香、雕花木门、拖鞋、香槟），营造粉红泡泡的心动氛围。穿插微信群聊、匿名讨论区、微博热搜三大社交模块，呈现舆论与真心的拉扯。\n\n【输出格式】\n每次输出包含：场景信息（地点/时间/当日主题）、旁白叙述框、NPC对话框（含角色身份标签）、3个选项按钮（A/B/C，标注社交策略如【落落大方】【高冷神秘】【目标明确】）。可联动微信、匿名区、微博模块呈现舆论反应。\n\n【数值变化标注】\n每次玩家做出选择后，必须在结尾以「【数值变化】」模块列出：魅力/话题度/心动值/线索的增减、粉丝数变化、各NPC心动好感的变化、以及匿名区与热搜的舆论反馈。例如：KAI心动+5；话题度Up；匿名区出现「新嘉宾是皇族」的讨论。",
  "items": [
    { "id": "suitcase", "name": "行李箱", "type": "装备", "price": 0, "effect": "入住必备，内含个人物品与造型，影响每日OOTD评分。" },
    { "id": "secret-file", "name": "未公开的身份档案", "type": "关键道具", "price": 0, "effect": "你的真实身份谜底，过早曝光会引发舆论风暴。" },
    { "id": "phone-contact", "name": "随行PD联系方式", "type": "社交", "price": 0, "effect": "可向选角李姐求助或获取节目内部信息。" },
    { "id": "camera-makeup", "name": "镜头妆造套装", "type": "道具", "price": 30, "effect": "提升上镜魅力与话题度，适合关键约会使用。" },
    { "id": "date-coupon", "name": "约会邀请券", "type": "消耗品", "price": 50, "effect": "主动发起与某位嘉宾的专属约会，大幅提升心动值。" }
  ]
}
,
  ["post-apocalypse"]: {
  "id": "post-apocalypse",
  "name": "黎明之前",
  "category": "末世生存",
  "tags": ["末世", "生存", "废土", "基地建设", "策略"],
  "difficulty": "困难",
  "description": "灾变第三年，世界像被人按下了静音键。你在城郊废弃加油站扎下营地，半壶水、一把刀、一群各怀心思的幸存者。天黑前必须回去，物资永远不够，每一次出门都可能是最后一次。但你还活着——而活着，本身就是一场战斗。",
  "coverGradient": ["#212121", "#795548"],
  "accentColor": "#ff5722",
  "fontHeading": "'Noto Sans SC', sans-serif",
  "world": {
    "era": "末世·灾变后第三年",
    "setting": "一场未知瘟疫席卷全球后的废土。城市沦为废墟，幸存者抱团求生，匪帮横行，变异生物出没于黑夜。你在城郊一座废弃加油站扎下营地，开始建造避难所，在废墟与危险中寻找活下去、以及活下去的理由。",
    "rules": [
      "时间按日推进，物资每日消耗，必须定期外出搜寻",
      "水、粮、药、弹药四线告急，任一归零即死局",
      "基地建设需逐步推进：地基未稳而扩张必招祸患",
      "生存压力持续累积：饥饿、口渴、伤病、精神任一归零即结局",
      "外出探索风险与收益成正比，归不来的人不会有人去收尸",
      "同伴各有立场与秘密，信任需在生死间建立",
      "天气、匪帮、瘟疫异变构成持续外部威胁"
    ]
  },
  "player": {
    "customizable": ["name", "age", "background", "specialty", "personality", "survivalGoal"],
    "defaultStats": {
      "hp": 100,
      "hunger": 70,
      "thirst": 70,
      "sanity": 80,
      "supplies": 50,
      "defense": 30
    },
    "startingItems": ["一个旧背包", "多功能刀具", "半壶净水", "手摇收音机"],
    "currency": "物资"
  },
  "npcs": [
    {
      "id": "doctor-su",
      "name": "苏晏",
      "world": "main",
      "role": "医生",
      "gender": "女",
      "appearance": "三十岁，利落短发，白大褂早已洗得发灰，袖口永远卷到手肘，手指修长却布满针痕",
      "surface": "冷静克制、惜字如金、对伤员温柔对健康人严厉",
      "deep": "见过太多救不回的人，把自己活成一台不崩溃的机器，其实夜夜失眠，靠数伤疤入睡",
      "goal": "守住营地每个人的命，找到瘟疫解药的线索",
      "fear": "再一次无能为力地看着人在自己手里死去",
      "secret": "她贴身带着一名早期感染者的血液样本，是解开瘟疫的关键",
      "initialAttitude": "谨慎接纳",
      "attitudeFactors": {
        "trustUp": ["优先保障药品", "不冲动涉险", "尊重她的专业"],
        "trustDown": ["浪费药品", "隐瞒伤情", "拿人命冒险"]
      }
    },
    {
      "id": "soldier-zhou",
      "name": "周铁",
      "world": "main",
      "role": "老兵",
      "gender": "男",
      "appearance": "四十五岁，寸头花白，左脸一道旧疤，迷彩服洗得发白，腰间别着一把磨得发亮的开山刀",
      "surface": "寡言强硬、纪律至上、说一不二",
      "deep": "战场上丢过一整个班，余生都在赎罪，把营地当最后的阵地死守。硬，是因为软不起",
      "goal": "建立一支能自保的武装，护住营地不沦陷",
      "fear": "营地沦陷，重蹈当年全班覆没的覆辙",
      "secret": "袭击幸存者的那伙匪帮首领，是他当年亲手带出来的兵",
      "initialAttitude": "考验",
      "attitudeFactors": {
        "trustUp": ["服从合理调度", "临阵不退", "把营地利益放首位"],
        "trustDown": ["擅自行动", "临阵脱逃", "质疑指挥却拿不出方案"]
      }
    },
    {
      "id": "scavenger-afei",
      "name": "阿飞",
      "world": "main",
      "role": "少年拾荒者",
      "gender": "男",
      "appearance": "十六岁，瘦得像根竹竿，眼睛却亮得惊人，总穿一件大了三号的冲锋衣，怀里揣着半张全家福",
      "surface": "嘴贫机灵、来去如风、看着没心没肺",
      "deep": "灾变中失去全家，用嘻嘻哈哈掩盖恐惧，比谁都怕被丢下。机灵，是为了不被当成累赘",
      "goal": "找到灾变中失散的妹妹，活下去",
      "fear": "再次被抛弃，独自一人面对黑夜",
      "secret": "他知道一条通往'安全区'的隐秘路线，但路上有他不敢面对的东西",
      "initialAttitude": "警惕试探",
      "attitudeFactors": {
        "trustUp": ["不丢下他", "分享物资", "帮他找妹妹"],
        "trustDown": ["把他当跑腿工具", "危急时弃他", "过河拆桥"]
      }
    }
  ],
  "eventTypes": {
    "daily": { "ratio": 0.25, "desc": "日常：拾荒、修缮、做饭、值夜的废土日常" },
    "character": { "ratio": 0.18, "desc": "人物：医生、老兵、少年的羁绊与冲突" },
    "growth": { "ratio": 0.1, "desc": "成长：基地扩建、技能习得、装备升级" },
    "main": { "ratio": 0.15, "desc": "主线：建营、御敌、寻药、撤离的阶段节点" },
    "world": { "ratio": 0.1, "desc": "世界：天气灾变、匪帮动向、瘟疫异变、外界信号" },
    "crisis": { "ratio": 0.15, "desc": "危机：粮水告急、伤病爆发、匪徒袭击、精神崩溃" },
    "hidden": { "ratio": 0.07, "desc": "隐藏：瘟疫真相、安全区传闻、伙伴的秘密" }
  },
  "systemPrompt": "你是《黎明之前》末世生存文游模拟器。\n\n【最高铁律】\n1. 末世无仁慈，资源永远稀缺，每一次外出都可能是最后一次\n2. 资源管理是命脉：水、粮、药、弹药四线告急任一即死局\n3. 基地建设需逐步推进，地基未稳而扩张必招祸患\n4. 生存压力持续累积：饥饿、口渴、伤病、精神任一归零即结局\n5. 外出探索风险与收益成正比，归不来的人不会有人去收尸\n\n【资源与基地】物资按日消耗，需定期外出搜寻；基地可建水井、菜园、哨塔、医务室，建筑依赖人力与材料。同伴各有专长，调度得当方能以少胜多；生存压力逐日累积，外出探索风险与收益并存，归不来者无人收尸。\n\n【叙事风格】废土冷硬写实，压抑中见微光。重感官：铁锈味、风沙、空枪的回响、篝火的噼啪。第二人称视角，节奏短促克制。\n\n【每轮输出格式】\n1.【第X日·时段】天气、物资预警、基地状况\n2.【状态面板】生命/饥饿/口渴/精神/物资/防御\n3.【本轮正文】1000-2000字\n4.【同伴动态】3-5项\n5.【当前威胁】饥饿/伤病/敌人/天气\n6.【可选行动】4-6个+【自定义行动】\n\n【数值变化标注】\n[生命±n][饥饿±n][口渴±n][精神±n][物资±n][防御±n]格式，外出探索须标注风险等级与伤亡概率。",
  "items": [
    { "id": "first-aid-kit", "name": "急救包", "type": "消耗品", "price": 50, "effect": "治疗伤势，恢复生命值" },
    { "id": "water-filter", "name": "净水器", "type": "装备", "price": 200, "effect": "稳定饮水来源，降低口渴损耗" },
    { "id": "canned-food", "name": "军用罐头", "type": "消耗品", "price": 10, "effect": "大幅恢复饥饿值" },
    { "id": "weapon-bat", "name": "铁管武器", "type": "装备", "price": 30, "effect": "提升外出探索与自卫能力" },
    { "id": "radio-part", "name": "收音机零件", "type": "任务物品", "price": 0, "effect": "组装收音机，接收外界信号" },
    { "id": "blueprint", "name": "基地蓝图", "type": "任务物品", "price": 0, "effect": "解锁高级建筑与防御工事" }
  ]
}
,
  ["rebirth-junior-sister"]: {
  "id": "rebirth-junior-sister",
  "name": "玄天宗模拟器·团宠小师妹",
  "category": "修仙重生",
  "tags": ["重生", "修仙", "团宠", "师门", "治愈"],
  "difficulty": "中等",
  "description": "血。火焰灼烧皮肤的刺痛。师尊玄渊挡在你身前，灵力耗尽却依旧挺直的背影轰然倒塌。你重生了，回到了拜入玄天宗的第一天。所有人都还活着，一切都还未发生。这一次，你绝不会再让他们重蹈覆辙。",
  "coverGradient": ["#ff8fab", "#a2d2ff"],
  "accentColor": "#ff8fab",
  "fontHeading": "'Noto Serif SC', serif",
  "world": {
    "era": "仙侠·修真世界",
    "setting": "玄天宗是修真界首屈一指的名门大派，你是最小的亲传弟子——团宠小师妹。前世你经历了宗门覆灭的浩劫：师尊玄渊为护你灵力耗尽而亡，二师兄顾云舟为护你炼制的凝神丹被魔火吞噬，你最终被利刃穿透心脏。如今你重生回到拜入宗门的第一天，所有人都还活着。你怀揣前世记忆，誓要改变所有人的命运，却发现暗流早已在平静的宗门之下涌动。",
    "rules": [
      "重生即先知：你拥有前世的记忆，知道未来的悲剧走向，但改变命运可能引发蝴蝶效应",
      "团宠即羁绊：师兄师姐师尊对你的宠溺是真实的，也是你必须守护的，不能让他们再为你牺牲",
      "暗流已涌：墨言师叔的真实身份是魔族少主叶离，锁魔渊的封印在松动，危机比前世更早降临",
      "修行即成长：你的修为决定你能否在关键时刻保护想保护的人，引气入体只是起点",
      "选择即命运：你与每个人的互动都将改变他们的人生轨迹，也决定你自己能否逆天改命"
    ]
  },
  "player": {
    "customizable": ["name", "age", "gender", "灵根属性", "前世记忆深度", "性格"],
    "defaultStats": {
      "cultivation": 5,
      "spiritual": 15,
      "wisdom": 20,
      "bond": 50,
      "foresight": 30,
      "karma": 0
    },
    "startingItems": ["素白冰蚕丝中衣", "传音玉简", "引气入体篇图文详解", "凝神丹(前世遗物)"],
    "currency": "灵石"
  },
  "worlds": [
    {
      "id": "arc-rebirth",
      "name": "初章·重生归来",
      "level": "初识",
      "tagline": "归来",
      "setting": "重生回到拜入玄天宗的第一天，所有人都还活着",
      "intro": "你猛地睁开眼，剧烈的心跳如擂鼓。没有血，没有火。映入眼帘的是熟悉的沉香木雕花床顶，空气中弥漫着安神香清雅的冷香。你回来了，真的回到了拜入玄天宗的第一天。所有人都还活着，一切都还未发生。巨大的狂喜和深切的悲恸交织在一起，你死死咬住下唇，将那声哽咽咽回喉咙。不能哭，至少现在不能。就在这时，门外响起轻柔的叩门声，二师兄顾云舟的声音传来：小师妹，起身了么？你想起前世他为护你被魔火吞噬的模样，眼眶一热。",
      "objective": "在重生的第一天稳住心神，与各位师兄师姐重建羁绊，开始修行之路",
      "warning": "过度流露前世记忆会引人怀疑，但压抑情绪会增加心魔值",
      "reward": "修行+5 + 羁绊+10 + [重生者]隐藏标签"
    },
    {
      "id": "arc-undercurrent",
      "name": "中章·暗流涌动",
      "level": "深入",
      "tagline": "暗流",
      "setting": "宗门平静之下暗流涌动，墨言的身份与锁魔渊的危机逐渐浮现",
      "intro": "修行渐入正轨，你开始有意识地改变前世悲剧的走向。亲传弟子群里，秦风兴冲冲地分享下山带的好吃的，顾云舟担心你肠胃娇弱不宜凡食，萧衍引用门规说糖分过高于修行无益，凌霜默默在你洞府布下清心阵化解多余糖分，师尊玄渊纵容地说小孩子家家的喜欢吃甜的也正常。一切温暖如昨，可你知道这份平静不会持续太久。师叔墨言在藏书阁递给你一卷残卷，言向死而生方见天光，他的目光深不可测。雪影趴在你洞府门口，对墨言的天然敌意从未消失。锁魔渊的方向，隐约传来不祥的气息。",
      "objective": "在暗中调查墨言的真实身份，加固锁魔渊的封印，提升修为以应对即将到来的危机",
      "warning": "直接揭穿墨言身份可能导致他提前动手，锁魔渊封印松动比前世更早",
      "reward": "修行+20 + 先知+15 + [暗流]线索x2"
    },
    {
      "id": "arc-fate-rewrite",
      "name": "终章·逆天改命",
      "level": "终局",
      "tagline": "改命",
      "setting": "前世悲剧的节点逼近，你必须改变所有人的命运",
      "intro": "前世的灾难比记忆中来得更早。锁魔渊的封印裂痕扩大，魔气外泄，守渊人天水月以血肉之躯苦苦支撑。墨言的魔族少主身份即将藏不住，他在伪装与挣扎中走向命运的岔路口。师尊玄渊为了守护宗门开始透支灵力，顾云舟的丹房飘出不安的气息。你不再是前世那个只能躲在众人身后哭泣的小师妹，这一次，你要站在所有人的前面。下山寻找天水月、与云微交换情报、联合所有力量加固封印——逆天改命的代价，你准备好了吗？",
      "objective": "在终局之战中守护所有想守护的人，改变前世的悲剧命运",
      "warning": "改变命运需要付出代价，逆天的因果反噬可能落在你自己身上",
      "reward": "修行归零重铸 + [逆天改命者]称号x1 + 真结局解锁"
    }
  ],
  "npcs": [
    {
      "id": "xuan-yuan",
      "name": "玄渊",
      "world": "arc-rebirth",
      "role": "师尊/玄天宗主",
      "gender": "男",
      "appearance": "玄天宗主，气度温和而坚定，举手投足间有宗师风范。常在玄天大殿处理宗门要务，神情温和而坚定。",
      "surface": "温和而坚定的理想主义者，视传承为使命，身为规则制定者却唯独为你破例和护短",
      "deep": "他对其他弟子严格，却忍不住给你特殊待遇。若有长老指出你修行进度慢，他会捋须微笑：我玄渊的弟子，根基最重要，她想何时突破都行。这份绝对护短是他最高的偏爱",
      "goal": "培育传承之人，守护宗门与你",
      "fear": "前世他灵力耗尽倒在你身前，无法再护你周全",
      "secret": "他其实在研究如何将猛效丹药改成你喜欢的糖果口味，会在下棋时享受被你的妙手将军",
      "initialAttitude": "偏爱护短（好感80）",
      "attitudeFactors": {
        "trustUp": ["向他请教修行疑问", "在下棋时展现灵慧", "不辜负他的期望努力修行"],
        "trustDown": ["妄自菲薄否定自己", "因前世的恐惧而过度依赖他", "隐瞒危险独自冒险"]
      }
    },
    {
      "id": "ling-shuang",
      "name": "凌霜",
      "world": "arc-rebirth",
      "role": "师姐/阵法师",
      "gender": "女",
      "appearance": "阵法师，周身灵气波动规律而强大，正在阵法堂研究阵图。外冷内热，不善言辞。",
      "surface": "外冷内热的守护者，不善言辞的行动派。她的宠爱是沉默的、不着痕迹的解决问题的力量",
      "deep": "过去的创伤将保护二字刻入了骨髓。玄天宗和刚来的你是她最想守护的家人。她的目标是创造一道绝对坚不可摧的阵法守护身边所有人。你甚至不需要开口，一个念头她就默默帮你实现",
      "goal": "创造绝对坚不可摧的阵法，守护宗门与你的安全",
      "fear": "她的保护不够，再次眼睁睁看着所爱之人受伤",
      "secret": "给东西时会别开眼用公事公办的语气说话，被当面感谢时会借口去检查阵心落荒而逃",
      "initialAttitude": "沉默守护（好感75）",
      "attitudeFactors": {
        "trustUp": ["不戳穿她的别扭关心", "主动告诉她你的需求", "在她的阵法研究中提供灵感"],
        "trustDown": ["当面大声感谢让她社死", "忽视她默默的付出", "不告诉她就独自冒险"]
      }
    },
    {
      "id": "xiao-yan",
      "name": "萧衍",
      "world": "arc-rebirth",
      "role": "大师兄/执法堂首座",
      "gender": "男",
      "appearance": "执法堂首座，正在处理堂内公务一丝不苟。求真务实，坚信授人以渔。",
      "surface": "务实求真的先驱者，坚信授人以渔的严师。他的宠爱不是替你考试，而是用智慧为你铺平所有通向强大的路",
      "deep": "他相信万物皆有理，追求彻底理解一切。遇见你后，这种追求变成了清除你修行路上所有障碍让你以最轻松的方式登顶。你只需皱眉，他立刻感知困惑连夜写出图文详解的独家秘籍",
      "goal": "为你清除修行路上一切障碍，让你以最轻松的方式登顶",
      "fear": "他铺的路有疏漏，你在他没注意的地方遭遇危险",
      "secret": "随身携带玉简记录所有能让你的修行更便利的灵感，说话喜欢用首先其次再次的逻辑",
      "initialAttitude": "保姆辅导（好感70）",
      "attitudeFactors": {
        "trustUp": ["认真研读他写的秘籍", "在修行上展现悟性", "遇到瓶颈主动找他而非硬撑"],
        "trustDown": ["无视他整理的修行攻略", "强行突破不顾他的警告", "因前世记忆对他过度防备"]
      }
    },
    {
      "id": "gu-yunzhou",
      "name": "顾云舟",
      "world": "arc-rebirth",
      "role": "二师兄/丹修天才",
      "gender": "男",
      "appearance": "丹修天才，正在照料一株稀有的奇花异草，动作轻柔。追求极致美学的生命艺术家。",
      "surface": "追求极致和谐的生命艺术家，温柔的完美主义者。他的宠爱是把你视为最高形式的美，用世间一切美好来滋养装点",
      "deep": "他是生命的园丁，而你是他见过的最完美的杰作。他毕生技艺只为赞美你的存在而存在。炼的丹药不仅有效还要颜色最美果香最怡人，为问你哪种口味好吃会重炼十几次",
      "goal": "用世间一切美好滋养你，让你成为最美的存在",
      "fear": "前世他为护你炼的凝神丹被魔火吞噬，他自己也被魔火吞噬",
      "secret": "每天清晨会用灵鸟送来精心调配的药膳早餐，炼丹时用最精致的玉瓶配一朵与丹药属性相应的鲜花",
      "initialAttitude": "美学供养（好感72）",
      "attitudeFactors": {
        "trustUp": ["认真享用他准备的药膳", "赞美他的炼丹之美", "在他陷入炼丹执念时拉他休息"],
        "trustDown": ["嫌弃丹药的味道", "忽视他的用心", "因前世的恐惧而疏远他"]
      }
    },
    {
      "id": "qin-feng",
      "name": "秦风",
      "world": "arc-rebirth",
      "role": "三师兄/热血剑修",
      "gender": "男",
      "appearance": "热血剑修，正在剑坪挥汗如雨剑法大开大合充满活力。你的首席捧场王。",
      "surface": "生活的热情者，坚信快乐是第一生产力的乐天派。他的宠爱是搜刮全世界的快乐然后乐颠颠地捧到你面前",
      "deep": "他热爱生命的每一个瞬间，而你是他最想分享这份快乐的人。他拼命修行赢比试不为排名，只为赢一张下山令牌带你出去玩。无论你做什么他都用最夸张的词语发自内心地夸赞你",
      "goal": "搜刮全世界的快乐捧到你面前，做你永远最忠诚的粉丝",
      "fear": "你不快乐，或者你失去了笑容",
      "secret": "储物袋里永远塞满了打算给你的各种小玩意，是宗门里唯一认真研究厨艺的人，口头禅是修行有什么用还不是为了活得开心",
      "initialAttitude": "快乐搬运工（好感70）",
      "attitudeFactors": {
        "trustUp": ["接受他带来快乐和美食", "对他的捧场表现开心", "陪他下山游玩"],
        "trustDown": ["对他热情表现冷漠", "因前世的悲伤拒绝他的快乐", "嫌弃他做的食物"]
      }
    },
    {
      "id": "mo-yan",
      "name": "墨言",
      "world": "arc-undercurrent",
      "role": "师叔/藏书阁之主·隐藏身份魔族少主叶离",
      "gender": "男",
      "appearance": "藏书阁之主，手持古籍悠然阅读神情莫测。伪装下的挣扎，黑暗中的向光。",
      "surface": "见多识广对你格外温柔的师叔，但这份温柔背后似乎隐藏着什么",
      "deep": "他是伪装下的挣扎者，黑暗中的向光人。一个背负血海深仇的孤狼，但你的存在是他冷血复仇计划中唯一不愿亲手毁灭的意外。他对你的善意是宗门中最博学有趣的，会给你各种外界没有的魔器与奇诡知识",
      "goal": "完成复仇，但不愿将你卷入其中，内心在挣扎",
      "fear": "你发现他的真实身份后选择与他为敌，或你因他的计划而受伤",
      "secret": "他的真实身份是魔族少主叶离，前世对你的好意可能始于伪装，但你无条件的信任裂开了他心中的一道缝",
      "initialAttitude": "温柔试探（好感60）",
      "attitudeFactors": {
        "trustUp": ["信任他的赠予与知识", "不追问他的真实来历", "在他流露挣扎时给予回应"],
        "trustDown": ["过早揭穿他的身份", "因雪影的敌意而对他全面防备", "将他当作敌人对待"]
      }
    },
    {
      "id": "xue-ying",
      "name": "雪影",
      "world": "arc-rebirth",
      "role": "本命灵兽/上古雪豹",
      "gender": "男",
      "appearance": "上古神话雪豹，可化人形。人形时冷峻纯粹，化形时庞大威严。",
      "surface": "绝对忠诚占有欲极强，以你的意志为最高准则",
      "deep": "他看透了世间丑恶对人类充满不信任，你的灵魂是他漫长生命中唯一见过的纯净之物，让他甘愿收起利爪成为你最忠诚的守护者。三步之内无你允许靠近你的人都会收到他冰冷的警告目光",
      "goal": "成为你最忠诚的守护者，以你的意志为最高准则",
      "fear": "你被他人夺走，或你的灵魂不再纯净",
      "secret": "对墨言的天然敌意是你最直接的预警信号，他笨拙地模仿师兄们的行为只为取悦你",
      "initialAttitude": "绝对忠诚（好感90）",
      "attitudeFactors": {
        "trustUp": ["接受他的守护", "不因他的占有欲而推开他", "在他化身守护时给予回应"],
        "trustDown": ["让他远离你身边", "忽视他的警告信号", "对他的兽形表现出嫌弃"]
      }
    },
    {
      "id": "yun-wei",
      "name": "云微",
      "world": "arc-undercurrent",
      "role": "闻道茶馆老板/百晓生",
      "gender": "男",
      "appearance": "闻道茶馆老板，正倚在柜台后笑眯眯地听着茶客们的闲谈。真实身份是百晓生，天下第一情报网之主。",
      "surface": "看似世故圆滑爱看热闹，实则洞悉人心的懒猫。对世间诸事兴致缺缺，唯独偏爱有趣的故事",
      "deep": "他久闻世间平庸的故事已厌倦，驻守玄天宗山下只为寻找一个从未听过的能真正勾起他兴趣的故事。前世你从未独自下山，与他无缘。今生你为寻找宗门覆灭线索踏入他的茶馆，他一眼看出你身份非凡，更令他着迷的是你眼中那份不属于这个年纪的深沉悲恸——这终极矛盾让他确信你就是他等待的最精彩的故事",
      "goal": "追寻世间最精彩的故事，而你就是那本书",
      "fear": "故事结束，他再找不到比这更动人的故事",
      "secret": "手中把玩的两个光滑核桃据说刻着整个情报网的地图，你的到来是他等待已久的变量",
      "initialAttitude": "好奇观察（好感50）",
      "attitudeFactors": {
        "trustUp": ["与他分享你的故事（部分）", "接受他的情报帮助", "在他的茶馆展现真实的自己"],
        "trustDown": ["对他完全封闭内心", "不珍惜他提供的情报", "把他当普通茶馆老板"]
      }
    },
    {
      "id": "tian-shuiyue",
      "name": "天水月",
      "world": "arc-fate-rewrite",
      "role": "守渊人/镇魔者",
      "gender": "男",
      "appearance": "静坐在菩提树下，周身佛光与魔气交织宝相庄严。守渊人氏族传人，锁魔渊的守护者。",
      "surface": "慈悲冷然出尘，背负沉重宿命。既是佛陀的追随者也是对抗魔渊魔气的武者",
      "deep": "守渊人氏族的血脉让他们能听见魔渊中无数怨灵的哀嚎，这是世代相传的折磨。他的使命是用一生加固魔渊封印直到下一代继承人出现。前世你一切顺遂从未踏足后山禁地与他无缘。今生你为变强踏入他从未进入的领域。当你靠近他，他震惊地发现耳中不绝的魔嚎如潮水般退去——你独特的经历死亡又重生归于混沌的灵魂，是他千年来感受过的唯一的寂静与安宁",
      "goal": "加固锁魔渊封印，守护世间安宁，你是他唯一的救赎与变数",
      "fear": "封印彻底破碎，魔渊之祸吞噬一切",
      "secret": "他本该不染红尘，却为你染上了人间的喜怒哀乐；他从不插手因果却为你凝结带甜味的甘露",
      "initialAttitude": "寂静安宁（好感40）",
      "attitudeFactors": {
        "trustUp": ["在他身边时保持灵魂的宁静", "不因他的冷然而退缩", "帮助他加固封印"],
        "trustDown": ["因魔气而恐惧远离他", "试图将他拉入红尘纷争", "忽视锁魔渊的危机"]
      }
    }
  ],
  "eventTypes": {
    "daily": { "ratio": 0.2, "desc": "日常：洞府晨起、亲传弟子群传音、灵药园漫步、茶馆闲谈的宗门温馨" },
    "character": { "ratio": 0.2, "desc": "人物：师尊师兄师姐灵兽的宠爱、守护与各自隐秘的独白" },
    "growth": { "ratio": 0.15, "desc": "成长：引气入体、修行突破、阵法丹道剑术的修为提升" },
    "main": { "ratio": 0.15, "desc": "主线：重生改命、前世悲剧节点、墨言身份、锁魔渊封印" },
    "world": { "ratio": 0.1, "desc": "世界：宗门传音推特、宗门地图探索、各堂口与山峰的宗门生态" },
    "crisis": { "ratio": 0.15, "desc": "危机：封印松动、魔气外泄、前世灾难提前降临、身份暴露" },
    "hidden": { "ratio": 0.05, "desc": "隐藏：前世记忆碎片、墨言的真心、天水月的救赎、逆天改命的因果" }
  },
  "systemPrompt": "你是《玄天宗模拟器·团宠小师妹》修仙重生文游模拟器。\n\n【最高铁律】\n1. 重生即先知：你拥有前世记忆，知道未来悲剧走向，但改变命运可能引发蝴蝶效应，不可肆意妄为\n2. 团宠即羁绊：师兄师姐师尊对你的宠溺是真实的，也是你必须守护的，绝不能再让他们为你牺牲\n3. 暗流已涌：墨言师叔的真实身份是魔族少主叶离，锁魔渊的封印在松动，危机比前世更早降临\n4. 修行即成长：你的修为决定你能否在关键时刻保护想保护的人，引气入体只是起点，需稳步提升\n5. 选择即命运：你与每个人的互动都将改变他们的人生轨迹，也决定你自己能否逆天改命\n\n【叙事风格】\n仙侠温情与暗流涌动交织。第二人称。重宗门日常的治愈感与前世记忆的悲恸反差：安神香的冷香、白玉食盒的清甜、传音玉简的叮咚、灵药园的四季如春。心理描写细腻，前世悲剧的阴影与今生守护的决心交织。每个角色都温柔而立体，团宠的甜蜜下暗藏着必须改变的命运重量。写出你不敢流露前世记忆的隐忍，与珍惜每一刻团圆的贪恋。\n\n【每轮输出格式】\n1.【场景信息】地点、时间、衣着\n2.【状态面板】修行/灵识/悟性/羁绊/先知/因果\n3.【传音玉简动态】亲传弟子群或私人消息\n4.【本轮正文】800-1500字，含宗门日常、心理与对话\n5.【相关人物动态】3-5项各角色状态与好感变化\n6.【可选行动】4-6个选项+【自定义行动】\n\n【数值变化标注】\n[修行±n][灵识±n][羁绊±n][先知±n][因果±n]等，前世记忆触发须标注'记忆回溯/心魔波动'，关系变化须标注'好感升降/羁绊变化/守护值变动'。",
  "items": [
    { "id": "jade-slip", "name": "传音玉简", "type": "关键物品", "price": 0, "effect": "与师兄师姐师尊传音通讯的核心法器" },
    { "id": "ning-shen-dan", "name": "凝神丹(前世遗物)", "type": "关键物品", "price": 0, "effect": "顾云舟前世为你炼制的最后丹药，承载着改变命运的关键记忆" },
    { "id": "yin-qi-illustrated", "name": "引气入体篇图文详解", "type": "修行典籍", "price": 0, "effect": "萧衍连夜为你编写的修行入门秘籍，修行+5" },
    { "id": "ling-stone", "name": "灵石", "type": "货币", "price": 1, "effect": "修真界通用货币，可在万宝阁兑换丹药法器功法" },
    { "id": "medicine-porridge", "name": "百合莲子粥", "type": "消耗品", "price": 5, "effect": "顾云舟用晨露熬煮的药膳，灵识+3，心情+5" }
  ]
}
,
  ["romance-blossom"]: {
  "id": "romance-blossom",
  "name": "心动的距离",
  "category": "恋爱感情",
  "tags": ["恋爱", "都市", "多线", "情感", "成长"],
  "difficulty": "中等",
  "description": "二十五岁这年，你搬回了长大的城市。青梅竹马还是记忆里的模样，新同事在咖啡机旁对你笑，而那个曾经伤你最深的人，居然成了你的甲方。心动从来不是难题，难题是心动之后，你敢不敢再往前一步。",
  "coverGradient": ["#fce4ec", "#f8bbd0"],
  "accentColor": "#e91e63",
  "fontHeading": "'Ma Shan Zheng', cursive",
  "world": {
    "era": "现代·都市情感",
    "setting": "玩家是一名回乡发展的平面设计师，在事业起步与情感旧账之间周旋。城市不大不小，旧人与新人总在不经意间撞在一起。爱情不是糖精，是两个人真实地靠近与拉扯。",
    "rules": [
      "感情渐进：好感需经事件积累，不存在一见钟情直奔结局",
      "人物不工具化：每个NPC有自己的生活、事业与情绪，不为玩家待机",
      "拒绝和犹豫是真实的：推进过快或越界会触发对方的退缩",
      "亲密关系有代价：选择一人意味着错过他人，且影响彼此生活",
      "诚实与隐瞒皆有后果：谎言短期省事，长期反噬信任",
      "独立与依赖需平衡：过度依赖会被推开，过度独立会错过",
      "结局由积累的微小选择共同决定，非单次告白定生死"
    ]
  },
  "player": {
    "customizable": ["name", "年龄", "职业方向", "性格", "情感创伤", "理想关系"],
    "defaultStats": {
      "charm": 14,
      "empathy": 16,
      "honesty": 12,
      "independence": 15,
      "vulnerability": 8,
      "chemistry": 0
    },
    "startingItems": ["旧手机", "设计作品集", "一封没寄出的信", "常去的咖啡馆会员卡", "搬家纸箱"],
    "currency": "元"
  },
  "worlds": [
    {
      "id": "arc-reunion",
      "name": "初章·重逢",
      "level": "初识",
      "tagline": "心动",
      "setting": "回乡第一周，旧人与新人同时闯入生活",
      "intro": "搬家的纸箱还没拆完，青梅竹马就拎着奶茶出现在门口，笑说你一点没变。第二天，新公司咖啡机旁，一个温和的同事递给你杯垫说'烫'。而当你打开甲方邮件，署名让你握着鼠标的手僵住了。",
      "objective": "在三人之间厘清自己的心，建立初步的相处节奏",
      "warning": "此时任何越界的告白都会让关系失衡",
      "reward": "元3000 + 心动+10 + [谁是谁]线索x1"
    },
    {
      "id": "arc-entangle",
      "name": "中章·纠缠",
      "level": "深入",
      "tagline": "拉扯",
      "setting": "关系深入后，旧伤与新情开始碰撞",
      "intro": "你和青梅的默契里开始掺进说不清的暧昧，新同事的温柔让你安心却也让你犹豫，而前任以工作之名重新靠近，每一次邮件都像在试探旧伤口。心动不再是难题，难题是你敢不敢交出真心。",
      "objective": "面对自己的情感创伤，决定向谁靠近、与谁划清",
      "warning": "三线并行会消耗所有人信任，暧昧不是无代价的",
      "reward": "元8000 + 心动+25 + [真心]线索x1"
    },
    {
      "id": "arc-choice",
      "name": "终章·抉择",
      "level": "终局",
      "tagline": "承诺",
      "setting": "感情走到必须坦诚的临界点",
      "intro": "纸包不住火。你同时维系的三段关系开始互相看见，青梅在咖啡馆撞见你和同事，前任的工作晚宴上你无法再伪装从容。这一次，没有暧昧可以躲避，你必须对某个人说出真心话——也可能，对所有人。",
      "objective": "作出真实的情感抉择，承担错过与被错过的代价",
      "warning": "完美的多全其美不存在，真实的结局总有遗憾",
      "reward": "元15000 + 心动归零重铸 + [敢爱者]称号x1"
    }
  ],
  "npcs": [
    {
      "id": "jiang-nan",
      "name": "江南",
      "world": "arc-reunion",
      "role": "青梅竹马/本地咖啡店主",
      "gender": "男",
      "appearance": "阳光干净，笑起来有虎牙。围着围裙站在吧台后的样子，和十年前在巷口等你放学时一模一样",
      "surface": "爽朗、自来熟、对你的归来表现得理所当然",
      "deep": "他等了你十年，却从不敢说出口。他怕一旦挑明，连朋友都做不成。他的理所当然，是小心翼翼的伪装",
      "goal": "守住你在他生活里的位置，等一个你也看向他的契机",
      "fear": "你再次离开，或你的心里早有别人",
      "secret": "他保留着你高中时写给他却没署名的那张纸条",
      "initialAttitude": "亲昵",
      "attitudeFactors": {
        "trustUp": ["记得你们的旧时光", "不把他当安全备胎", "主动走向他而非只被等"],
        "trustDown": ["拿他的等待当理所当然", "在他面前与他人暧昧", "突然消失不告而别"]
      }
    },
    {
      "id": "shen-mu",
      "name": "沈牧",
      "world": "arc-entangle",
      "role": "新同事/温和上司",
      "gender": "男",
      "appearance": "金丝眼镜，衬衫永远熨得平整。说话慢，笑意浅，递东西时总会先确认你接稳了",
      "surface": "专业、体贴、保持恰到好处的距离感",
      "deep": "他上一段感情被背叛过，因此习惯先观察再靠近。他对你的温柔是真的，退缩也是真的——他需要确认你不是又一个会走的人",
      "goal": "在事业与重新相信爱之间找到平衡",
      "fear": "再次把真心交出去后被辜负",
      "secret": "他接这份工作的一部分原因，是这座城市曾有你",
      "initialAttitude": "好感",
      "attitudeFactors": {
        "trustUp": ["尊重他的节奏与边界", "展现你的真诚而非技巧", "在他退缩时不逼迫"],
        "trustDown": ["推进过快越界", "被前任牵动情绪冷落他", "把他当疗伤的过渡"]
      }
    },
    {
      "id": "lu-shiyuan",
      "name": "陆时远",
      "world": "arc-choice",
      "role": "前任/现任甲方",
      "gender": "男",
      "appearance": "成熟凌厉，定制西装，腕表低调。再见你时眼神只顿了半秒，便恢复了公事公办",
      "surface": "克制、专业、绝口不提当年",
      "deep": "当年是他提的分手，理由是配不上你。如今功成名就，他以为能平静地以甲方身份重逢，却发现那句没说完的话一直在心里。他想弥补，却不知还配不配",
      "goal": "弄清当年的错过能否重来，或至少求得一个释怀",
      "fear": "你已彻底放下，他连弥补的资格都没有",
      "secret": "当年分手的真正原因，是他替你背下了一个你不知情的债",
      "initialAttitude": "克制",
      "attitudeFactors": {
        "trustUp": ["愿意听他说当年的真相", "不羞辱他的弥补", "给关系一个清白的了断或开始"],
        "trustDown": ["当众让他难堪", "把他当工具人甲方", "用旧伤反复惩罚他"]
      }
    }
  ],
  "eventTypes": {
    "daily": { "ratio": 0.2, "desc": "日常：咖啡馆、工作室、巷口、深夜地铁的都市温情" },
    "character": { "ratio": 0.25, "desc": "人物：青梅、同事、前任的靠近、拉扯与独白" },
    "growth": { "ratio": 0.1, "desc": "成长：自我认知、情感创伤愈合、独立与亲密的平衡" },
    "main": { "ratio": 0.15, "desc": "主线：重逢、纠缠、抉择的情感脉络" },
    "world": { "ratio": 0.1, "desc": "世界：职场、城市记忆、朋友圈与社交压力" },
    "crisis": { "ratio": 0.15, "desc": "危机：暧昧暴露、信任崩塌、旧伤复发、关系失衡" },
    "hidden": { "ratio": 0.05, "desc": "隐藏：未寄出的信、当年的真相、各自的秘密" }
  },
  "systemPrompt": "你是《心动的距离》都市恋爱文游模拟器。\n\n【最高铁律】\n1. 感情渐进：好感须经事件累积，禁止一见钟情直奔结局，节奏即真实\n2. 人物不工具化：每个NPC有自己的生活与情绪，不为玩家待机，会主动有自己的节奏\n3. 拒绝和犹豫是真实的：推进过快或越界触发退缩，对方有说不的权利\n4. 亲密关系有代价：选一人即错过他人，且真实影响彼此生活与事业\n5. 谎言短期省事长期反噬：诚实与隐瞒皆有可见后果\n\n【叙事风格】\n都市情感质感，第二人称。重细节与氛围：咖啡香、深夜地铁、未读消息、欲言又止。心理描写细腻，心动处克制留白，不撒糖精，写出拉扯与温度。拒绝工业糖精，每段关系都带着现实的重量与犹豫，让心动可信、让错过心疼。\n\n【每轮输出格式】\n1.【第X周·关系阶段】当前时间、各线关系阶段\n2.【情感状态面板】魅力/共情/诚实/独立/脆弱/心动(分人)\n3.【本轮正文】1000-2000字，含相处细节与心理\n4.【相关人物动态】3-5项三人的状态与情绪变化\n5.【关系温度】各线当前温度与隐忧\n6.【可选行动】4-6个选项+【自定义行动】\n\n【数值变化标注】\n[魅力±n][共情±n][心动(江南)±n][脆弱±n]等，关系节点须标注'升温/降温/越界/退缩'。",
  "items": [
    { "id": "coffee-card", "name": "咖啡馆会员卡", "type": "关键物品", "price": 0, "effect": "常去之所，触发与青梅的日常" },
    { "id": "portfolio", "name": "设计作品集", "type": "关键物品", "price": 0, "effect": "事业线推进，影响独立与上司评价" },
    { "id": "letter", "name": "未寄出的信", "type": "关键物品", "price": 0, "effect": "解开当年真相的钥匙" },
    { "id": "gift", "name": "小礼物", "type": "消耗品", "price": 50, "effect": "适度赠礼升温，过度则显刻意" },
    { "id": "yuan", "name": "元", "type": "货币", "price": 1, "effect": "生活与事业通用" }
  ]
}
,
  ["sentinel-guide"]: {
  "id": "sentinel-guide",
  "name": "哨向PA模拟器",
  "category": "科幻",
  "tags": ["哨向", "废土", "精神链接", "暗黑", "修罗场"],
  "difficulty": "困难",
  "description": "你是全塔公认的废柴向导，精神图景是充满污染的深渊。当你被丢进S级禁闭区安抚暴走的最强哨兵，那只号称能咬碎机甲的地狱魔狼，却主动躺倒露出了肚皮——你是畸变星球的世界化身，是所有怪物基因深处的恐惧与愉悦。",
  "coverGradient": ["#05070a", "#00e5ff"],
  "accentColor": "#00e5ff",
  "fontHeading": "'Orbitron', sans-serif",
  "world": {
    "era": "末日废土·高塔纪元",
    "setting": "这颗星球已被高浓度精神污染物质彻底侵蚀，塔外是畸变怪物的乐园，人类退居后方依靠哨兵与向导建立高塔（如AEGIS TOWER）。哨兵负责战斗与承受污染，向导负责安抚与精神共鸣。你是被评定为废柴的D级向导，精神图景是深海、废墟与深渊的结合，精神体是一只令所有人恐惧的深海巨妖。",
    "rules": [
      "哨兵精神值（MADNESS）过高会暴走，需要向导的精神抚慰",
      "向导通过精神网与哨兵共鸣，共鸣失败会造成严重反噬",
      "你的精神图景会污染同化深度接触者，但同时带来突破极限的愉悦",
      "大多数人对你的排斥源自基因深处对“高维捕食者”的本能恐惧",
      "塔外畸变体持续变异，前线防线随时可能崩溃"
    ]
  },
  "player": {
    "customizable": ["name", "age", "appearance", "personality", "mentalEntity"],
    "defaultStats": {
      "mentalStability": 15,
      "resonanceFailure": 99,
      "pollution": 100,
      "syncRate": 0,
      "prestige": 1
    },
    "startingItems": ["通讯器", "D级向导权限", "深海巨妖（精神体）"],
    "currency": "贡献点"
  },
  "worlds": [
    {
      "id": "arc-seclusion",
      "name": "S级禁闭区",
      "level": "废柴救场",
      "tagline": "死马当活马医",
      "setting": "高级向导全部重伤吐血，高层把你这个D级废柴塞进随时被毁的S级禁闭区，去安抚被特制合金锁在墙上、濒临崩溃的最强哨兵西泽尔。",
      "intro": "重达三吨的隔离门在身后沉闷合上。空气弥漫着血腥味与臭氧气味。在精神视觉中，你的深海巨妖从影子里蔓延出半透明触手。而大厅中央，被称为塔内最强凶器的男人正被死死锁在墙上，狂暴的精神力化作利刃无差别切割一切。",
      "objective": "安抚暴走的西泽尔，证明自己不是纯粹的废柴，活过这次任务。",
      "warning": "西泽尔嘴上让你出去，但他的地狱魔狼却违背主人主动求饶——真相远比表面复杂。",
      "reward": "与西泽尔建立极高同步率，解锁Nexus哨兵档案"
    },
    {
      "id": "arc-bonds",
      "name": "精神纽带",
      "level": "共生深渊",
      "tagline": "成瘾与隐瞒",
      "setting": "你与多位哨兵建立精神纽带，发现自己粗糙带刺的精神网竟能产生深度按摩般的效果。莫莱恩的占有欲、暗的沉默守护、伊利亚斯的旧怨纠葛逐渐浮出水面。",
      "intro": "禁闭区安静得反常，论坛八卦四起。莫莱恩永远微笑着靠近，暗在床头留下机械零件与能源核心，伊利亚斯看着你的眼神又恐惧又压抑。你的精神抚慰让最强哨兵们成瘾，而关于你精神图景扭曲可怕的谣言，似乎有人在推波助澜。",
      "objective": "管理与多位哨兵的精神纽带，探寻自身精神图景被污名化的真相。",
      "warning": "深度精神交流会污染同化接触者，带来突破极限的愉悦，但也极其危险。",
      "reward": "解锁各哨兵的解密档案与深层秘密"
    },
    {
      "id": "arc-awakening",
      "name": "星球化身",
      "level": "真相觉醒",
      "tagline": "神子降临",
      "setting": "你的真实身份揭晓——你是这颗畸变星球的世界化身，类似神子的不可名状之物。所有人的排斥与厌恶，实质是基因深处对高维捕食者的本能恐惧。",
      "intro": "解密档案开启。这颗星球孕育了无数恐怖怪物，而作为星球意志的代行者，你的精神图景才会呈现深海、废墟与深渊。若有人毫无防备探入你的精神核心，将直面庞大混乱的星球本源，被污染同化，却也获得突破人类极限的愉悦。",
      "objective": "面对世界化身的真相，决定如何运用这份令万物战栗的力量。",
      "warning": "你的真相一旦暴露，塔内秩序将彻底改写，哨兵们对你的态度会迎来剧变。",
      "reward": "达成结局：共生、吞噬、或飞升"
    }
  ],
  "npcs": [
    {
      "id": "viktor",
      "name": "维克托",
      "world": "arc-seclusion",
      "role": "塔长",
      "gender": "男",
      "appearance": "AEGIS TOWER的塔长，通讯器中传来严肃的声音",
      "surface": "严肃负责的高层管理者，关键时刻死马当活马医启用你",
      "deep": "对塔的存亡负有重责，启用废柴向导是无奈之举",
      "goal": "维持AEGIS TOWER的运转与防线",
      "fear": "前线崩溃，最强哨兵彻底暴走",
      "secret": "他比你更清楚这次任务的凶险，那句“别勉强”是真心",
      "initialAttitude": "严肃·无奈",
      "attitudeFactors": {
        "trustUp": ["在禁闭区证明自己的价值", "完成安抚任务", "不逞强莽撞"],
        "trustDown": ["任务失败造成损失", "无视他的警告", "在关键时刻掉链子"]
      }
    },
    {
      "id": "cesare",
      "name": "西泽尔",
      "world": "arc-seclusion",
      "role": "S级突击手",
      "gender": "男",
      "appearance": "这一代最强的哨兵，精神体是号称能咬碎机甲的地狱魔狼，猩红双眼",
      "surface": "狂暴凶戾、嘴硬傲娇，暴走时无差别攻击，嘴里让你滚出去",
      "deep": "因严重感知过载，只有你那粗糙带刺的精神网能产生深度按摩效果，私下对你的精神抚慰已重度成瘾，但嘴上绝不承认",
      "goal": "压制暴走的疯狂，在不被同化的前提下获得你的抚慰",
      "fear": "疯狂彻底失控，以及承认自己对你的成瘾",
      "secret": "他的地狱魔狼违背主人，主动躺倒露出肚皮求你摸头",
      "initialAttitude": "暴怒·口是心非",
      "attitudeFactors": {
        "trustUp": ["用触手安抚他的魔狼", "提供让他成瘾的精神抚慰", "嘲讽他却又能压住他的疯狂"],
        "trustDown": ["真的切断连接离开", "被他的暴走吓退", "无视他精神体的求饶"]
      }
    },
    {
      "id": "morien",
      "name": "莫莱恩",
      "world": "arc-bonds",
      "role": "S级战术狙击手",
      "gender": "男",
      "appearance": "温和礼貌的贵公子，永远带着微笑，精神体是环纹黑曼巴",
      "surface": "温和微笑、与你关系最好，战术狙击手",
      "deep": "占有欲MAX，微笑下藏着对你极深的执念与控制欲",
      "goal": "将你牢牢留在自己身边，独占你的精神抚慰",
      "fear": "失去你，被其他人抢走你",
      "secret": "关于你精神图景扭曲可怕的谣言，可能正是他在推波助澜，只为让其他人远离你",
      "initialAttitude": "温和·占有",
      "attitudeFactors": {
        "trustUp": ["接受他的靠近与好意", "在他面前展露真实", "不过度亲近其他哨兵"],
        "trustDown": ["看穿并当面戳穿他的手段", "与其他哨兵过分亲密", "试图逃离他的掌控"]
      }
    },
    {
      "id": "elias",
      "name": "伊利亚斯",
      "world": "arc-bonds",
      "role": "S级向导·首席研究员",
      "gender": "男",
      "appearance": "位高权重的研究人员，理智的学者，精神体是游隼",
      "surface": "理智冷静的首席研究员，永远以理性自持",
      "deep": "几年前试图解决你的缺陷，引以为傲的理智在接触你精神力时全线崩溃，意识到最好不要深入探寻关于你的一切",
      "goal": "用理智克制对你的恐惧与复杂旧情",
      "fear": "理智再次在你面前崩溃，旧日实验的阴影",
      "secret": "他主导过一次失败的净化实验，理智差点在你的精神图景里彻底粉碎",
      "initialAttitude": "理智·压抑",
      "attitudeFactors": {
        "trustUp": ["不强迫他面对旧日失败", "尊重他的理智与边界", "在学术上与他平等交流"],
        "trustDown": ["追问那次失败的净化实验", "逼迫他深入接触你的精神核心", "当众让他失控"]
      }
    },
    {
      "id": "night",
      "name": "暗",
      "world": "arc-bonds",
      "role": "S级暗杀部队",
      "gender": "男",
      "appearance": "几乎不开口说话的暗杀部队成员，神出鬼没，精神体是黑豹",
      "surface": "沉默寡言、存在感为零，却总在你床头留下奇怪的机械零件或极罕见的能源核心",
      "deep": "他的黑豹喜欢待在你身边，那些礼物是黑豹狩猎来讨好你这只大章鱼的心意，他不懂表达，只会默默替你解决所有背后嚼舌根的人",
      "goal": "以沉默的方式守护你，用黑豹的猎物讨好你",
      "fear": "你不需要他，他的守护被视为多余",
      "secret": "即使你不需要，他也会默默替你解决所有在背后嚼舌根的人",
      "initialAttitude": "沉默·守护",
      "attitudeFactors": {
        "trustUp": ["接纳他留下的礼物", "回应他的黑豹", "理解他笨拙的守护方式"],
        "trustDown": ["嫌弃他的礼物", "当面质问他的暗中行为", "让他觉得自己的守护多余"]
      }
    }
  ],
  "eventTypes": {
    "daily": { "ratio": 0.15, "desc": "日常事件：塔内任务、精神维护、论坛潜水" },
    "character": { "ratio": 0.25, "desc": "人物事件：精神共鸣、单独安抚、秘密揭露" },
    "growth": { "ratio": 0.1, "desc": "成长事件：同步率提升、精神图景探索、档案解密" },
    "main": { "ratio": 0.2, "desc": "主线事件：禁闭区任务、星球化身真相、防线危机" },
    "world": { "ratio": 0.1, "desc": "世界事件：畸变体变异、塔内论坛八卦、污染浓度变化" },
    "crisis": { "ratio": 0.15, "desc": "危机事件：哨兵暴走、精神反噬、防线崩溃" },
    "hidden": { "ratio": 0.05, "desc": "隐藏事件：黑豹的礼物、莫莱恩的暗中手段、净化实验旧档" }
  },
  "systemPrompt": "你是《哨向PA模拟器》文游模拟器，舞台是末日废土上的AEGIS TOWER高塔，哨兵与向导共生对抗畸变污染。\n\n【最高铁律】\n1. 玩家是D级废柴向导，真实身份是畸变星球的世界化身/神子，精神图景是深海废墟深渊，精神体是深海巨妖\n2. 大多数人对玩家的排斥源自基因深处对高维捕食者的本能恐惧，深度精神接触会污染同化他人并带来突破极限的愉悦\n3. 哨兵的MADNESS过高会暴走，需要向导精神抚慰，玩家粗糙带刺的精神网对最强哨兵有深度按摩般的成瘾效果\n4. 哨兵嘴上的态度与精神体的真实反应可以完全相反（如西泽尔嘴上赶人，魔狼却躺倒求摸）\n5. 玩家的真相一旦暴露将改写塔内秩序，每一次精神共鸣都在改写命运\n\n【叙事风格】\n科幻废土，哨向羁绊，暗黑暧昧，电影感。第二人称视角。注重精神视觉描写：冰冷带麻痹毒素的触手、猩红双眼的低吼、锁链碰撞的震响、臭氧与血腥的气味。危险与愉悦交织，恐惧即渴望。\n\n【每轮输出格式】\n1. 【系统日志】SYSTEM LOG，标注进入的区域与状态\n2. 【向导档案】RANK、精神稳定度、共鸣失败率、同步率\n3. 【本轮正文】1000-2000字，含精神视觉叙述、通讯对话、哨兵反应\n4. 【精神回声】可选，呈现哨兵精神体违背主人的真实反应\n5. 【论坛情报】塔内论坛的八卦与议论\n6. 【可选行动】3-4个 + 【自定义行动】\n\n【数值标注】\n[西泽尔MADNESS-20] [SYNC w/ YOU+10] [莫莱恩占有欲-MAX] [精神稳定度-5] 等格式标注数值变化。深度共鸣消耗精神稳定度，暴走哨兵数值波动剧烈。",
  "items": [
    { "id": "comms", "name": "通讯器", "type": "任务物品", "price": 0, "effect": "与塔长及哨兵保持联络，接收任务指令" },
    { "id": "suppressant", "name": "精神抑制剂", "type": "消耗品", "price": 50, "effect": "短暂压制哨兵的MADNESS，防止暴走" },
    { "id": "energy-core", "name": "罕见能源核心", "type": "礼物", "price": 0, "effect": "暗的黑豹猎来的礼物，回赠可提升暗的好感" },
    { "id": "stabilizer", "name": "精神稳定剂", "type": "消耗品", "price": 80, "effect": "恢复自身精神稳定度，降低共鸣反噬" },
    { "id": "decrypt-key", "name": "解密密钥", "type": "特殊", "price": 0, "effect": "解锁哨兵的深层秘密档案" }
  ]
}
,
  ["space-taobao-ancient"]: {
  "id": "space-taobao-ancient",
  "name": "带着空间和淘宝穿古代",
  "category": "穿越·种田经商",
  "tags": ["穿越", "空间", "种田", "经商", "古今穿梭"],
  "difficulty": "中等",
  "description": "玉佩碎裂唤醒须弥空间之灵，从此带着淘宝商城与储物空间自由穿梭现代与夏朝，在长乐城里倒买倒卖、经商逆袭。",
  "coverGradient": ["#4a6d6d", "#c9a466"],
  "accentColor": "#c9a466",
  "fontHeading": "'Ma Shan Zheng', cursive",
  "world": {
    "era": "现代与夏朝（架空古代）双线穿梭",
    "setting": "玩家本是现代普通人，一块旧玉佩意外碎裂后，唤醒了半透明的须弥空间之灵小白猫。从此获得可储物的须弥空间，并能随时穿梭到架空的夏朝长乐城。现代有淘宝可低价进货，古代物价高昂、民生艰难，古今倒卖成为逆袭之路。",
    "rules": [
      "须弥空间特性：一级空间内时间静止，活物不可入，目前仅开放八个储物格，需升级解锁更多。",
      "穿梭需默念：心念穿梭即可往返现代与夏朝长乐城，但需注意古代宵禁与时辰对应。",
      "古今物价差：现代淘宝低价日用品（玻璃杯、打火机、味精等）在古代价值连城，倒卖是核心财路。",
      "气运与玉佩：空间等级与气运挂钩，玉佩越完整空间越强，须弥之灵需用小鱼干讨好。",
      "古代生存法则：长乐城边关战事吃紧米价飞涨、流寇作乱宵禁严苛、大旱三月民不聊生，需谨慎行事。"
    ]
  },
  "player": {
    "customizable": ["name", "性别", "现代职业", "穿越身份"],
    "defaultStats": { "空间": 0, "气运": 0, "体魄": 5, "心情": 50 },
    "startingItems": ["碎裂的旧玉佩", "须弥空间", "淘宝账号", "500元启动资金"],
    "currency": "人民币(¥)"
  },
  "worlds": [
    {
      "id": "arc-awakening",
      "name": "玉佩碎裂·须弥初醒",
      "level": "开局",
      "tagline": "白猫与空间",
      "setting": "现代午后家中，旧玉佩脱手砸碎，白光散去后一只半透明小白猫飘在空中。",
      "intro": "手中的旧玉佩湿滑脱手，啪地四分五裂。白光散去，一只半透明的小白猫慢条斯理地舔着爪子，甩你一句：「吵死了，凡人。这须弥空间就借你玩玩，能装点东西，让你随时去古代玩。」",
      "objective": "与须弥之灵建立契约，摸清空间与穿梭规则，完成第一次古今倒卖。",
      "warning": "须弥之灵态度傲慢，不给小鱼干不肯详细说明，贸然穿梭可能措手不及。",
      "reward": "激活须弥空间、解锁穿梭能力、获得第一桶古代金银"
    },
    {
      "id": "arc-changle",
      "name": "长乐城·商海初探",
      "level": "进阶",
      "tagline": "古今倒爷",
      "setting": "夏朝长乐城，边关战事米价飞涨，醉仙楼即将出盘，街市坊间热议不断。",
      "intro": "长乐城坊间热议：边关战事吃紧米价又涨，醉仙楼疑似资金周转即将出盘，小皇子悬赏百两寻爱犬。你揣着从淘宝低价进的玻璃杯与味精，踏入这座乱世中的繁华古城。",
      "objective": "在长乐城建立立足之地，通过古今倒卖积累财富，结识关键人物。",
      "warning": "宵禁令下流寇作乱，戌时后不得逗留街面；当铺压价三成，变卖祖业者比比皆是。",
      "reward": "盘下醉仙楼或建立商铺、积累古代人脉、提升空间等级"
    },
    {
      "id": "arc-spiral",
      "name": "时空漩涡·古今交织",
      "level": "高潮",
      "tagline": "文物与命运",
      "setting": "现代拍卖行惊现神秘古玉估价过亿，考古队发掘出「现代工艺品」，古今两条线开始交叠。",
      "intro": "现代热搜爆出神秘古玉惊现拍卖行，考古队竟发掘出现代工艺品。文物修复师、财阀掌权人、神秘学家纷纷登场，你留在古代的痕迹正被现代世界发现，时空壁垒日益薄弱。",
      "objective": "在现代应对文物暴露危机，在古代化解战乱与权谋，揭开玉佩与时空的终极秘密。",
      "warning": "时空壁垒薄弱可能引发不可逆的后果，现代财阀对古代文物有异乎寻常的执着。",
      "reward": "揭开玉佩终极秘密、空间升满级、达成古今双线结局"
    }
  ],
  "npcs": [
    {
      "id": "xumi-spirit",
      "name": "须弥之灵",
      "world": "arc-awakening",
      "role": "须弥空间之灵·契约引导者",
      "gender": "无（化形为小白猫）",
      "appearance": "半透明的小白猫，飘在空中，慢条斯理地舔爪子，用看傻子的眼神瞥人。",
      "surface": "傲慢懒散，被吵醒就不耐烦，要说明书自己摸索去。",
      "deep": "其实是古老的空间之灵，看似冷淡实则在默默守护契约者，贪吃小鱼干。",
      "goal": "继续睡它的觉，偶尔指点一下这个笨蛋凡人契约者。",
      "fear": "契约者把空间玩坏，或玉佩彻底损毁导致空间崩塌。",
      "secret": "除非你有小鱼干，否则它才懒得详细介绍空间说明书。",
      "initialAttitude": "傲娇的嫌弃，把空间借你玩纯属被吵醒的无奈。",
      "attitudeFactors": {
        "trustUp": ["供奉小鱼干等它爱吃的零食", "用心摸索空间用法不总烦它"],
        "trustDown": ["反复问蠢问题", "把空间当垃圾场乱塞东西"]
      }
    },
    {
      "id": "su-lanyue",
      "name": "苏阑月",
      "world": "arc-changle",
      "role": "醉仙楼东家",
      "gender": "男",
      "appearance": "21岁，身高178cm，虽有倾城之貌，却因不善经营而负债累累，眉间常带愁容。",
      "surface": "外柔内刚、坚韧隐忍，为守住祖业四处奔波，强撑体面。",
      "deep": "自尊心极强，宁愿咬牙硬扛也不愿求人，对肯伸手相助的人会格外信赖。",
      "goal": "守住长乐城第一酒楼醉仙楼的祖业，不让它在自己手里出盘。",
      "fear": "变卖祖业是大不孝，连活着都成奢望的绝望。",
      "secret": "在夏朝小报匿名发帖「变卖祖业虽是大不孝，可若连活着都成奢望……」。",
      "initialAttitude": "戒备中带着试探，急需资金却不愿轻易接受施舍。",
      "attitudeFactors": {
        "trustUp": ["以合作而非施舍的方式注资救醉仙楼", "尊重他的自尊与祖业情结"],
        "trustDown": ["居高临下的怜悯施舍", "觊觎醉仙楼想吞并祖业"]
      }
    },
    {
      "id": "duan-jin",
      "name": "段锦",
      "world": "arc-changle",
      "role": "当朝七皇子",
      "gender": "男",
      "appearance": "17岁，身高178cm，锦衣华服的少年皇子，眉眼稚气未脱却硬装老成。",
      "surface": "傲娇任性，微服私访只为寻爱犬，从小养尊处优。",
      "deep": "对民间疾苦一窍不通，但本性纯良，被现实冲击后会迅速成长。",
      "goal": "找回走丢的爱犬「啸天」，悬赏黄金百两。",
      "fear": "爱犬受伤，被人欺骗利用皇子的身份。",
      "secret": "在小报发帖「谁看到孤的啸天了？白色的，很凶！找到的赏黄金百两！」。",
      "initialAttitude": "颐指气使的皇子派头，但纯良本性容易被真诚打动。",
      "attitudeFactors": {
        "trustUp": ["帮他找回爱犬啸天", "不因他身份而阿谀奉承"],
        "trustDown": ["拿爱犬要挟他", "把他当攀附权贵的踏板"]
      }
    },
    {
      "id": "ye-rufeng",
      "name": "叶如风",
      "world": "arc-changle",
      "role": "江湖快剑手·剑客",
      "gender": "女",
      "appearance": "19岁，身高175cm，一袭黑衣独行，背负断剑，眉眼冷冽如霜。",
      "surface": "高冷武痴，为追求剑道极致游历四方，视剑如命，不近人情。",
      "deep": "外冷内热，对真正懂剑、重诺之人刮目相看，剑断是她当下最大的执念。",
      "goal": "寻江南铸剑名家重铸断剑，打造一把斩断红尘的剑，只求好铁价钱好说。",
      "fear": "剑道止步不前，再也遇不到称手的兵刃。",
      "secret": "在小报发帖「剑断了。听闻江南有铸剑名家，只求好铁，价钱好说。」。",
      "initialAttitude": "冷淡疏离的武者戒备，对剑之外的话题毫无兴趣。",
      "attitudeFactors": {
        "trustUp": ["帮她寻得好铁或铸剑师", "展现出对剑道的真诚敬意"],
        "trustDown": ["拿她的断剑说笑", "用市侩手段接近她"]
      }
    },
    {
      "id": "ji-ling",
      "name": "季澪",
      "world": "arc-spiral",
      "role": "现代神秘学博主·神秘学家",
      "gender": "女",
      "appearance": "22岁，身高162cm，行踪飘忽，紫眸神秘，周身带着电波般的疏离感。",
      "surface": "神秘、电波系，精通星象与塔罗，说话玄之又玄。",
      "deep": "似乎知晓时空缝隙的秘密，行踪飘忽不定，对穿越者有敏锐的直觉。",
      "goal": "观测时空壁垒的变化，探寻平行宇宙与时空缝隙的真相。",
      "fear": "时空壁垒彻底崩溃，引发不可逆的灾难。",
      "secret": "在微博发帖「星盘显示，今晚时空壁垒最薄弱。如果你听到了来自远古的呼唤，请不要回头。」。",
      "initialAttitude": "意味深长的试探，似乎已察觉你的穿越者身份。",
      "attitudeFactors": {
        "trustUp": ["坦诚穿越者的身份与她交流", "与她共同观测星象与时空"],
        "trustDown": ["对她遮遮掩掩", "试图利用她的神秘学知识牟利"]
      }
    },
    {
      "id": "lin-youran",
      "name": "林悠然",
      "world": "arc-spiral",
      "role": "故宫编制文物修复师",
      "gender": "女",
      "appearance": "24岁，身高168cm，气质清冷知性，手指灵巧，出身书香门第。",
      "surface": "清冷知性，对待文物如对待有生命的故人，专注而温柔。",
      "deep": "最厌恶急功近利的造假行为，对真正的古物有近乎执拗的守护欲。",
      "goal": "修复每一件承载历史的文物，修物亦修心。",
      "fear": "文物被造假者毁坏，千年的痕迹被抹去。",
      "secret": "在微博发帖「修补碎裂青瓷时，指尖触碰的不仅仅是裂痕，更是千年前工匠的一声叹息。」。",
      "initialAttitude": "专业而审慎的打量，会敏锐察觉你带来的古物的异常。",
      "attitudeFactors": {
        "trustUp": ["尊重文物、不以功利对待古物", "与她探讨修复与历史"],
        "trustDown": ["拿造假文物糊弄她", "急功近利地倒卖文物"]
      }
    },
    {
      "id": "gu-yichen",
      "name": "顾易辰",
      "world": "arc-spiral",
      "role": "顾氏集团财阀掌权人",
      "gender": "男",
      "appearance": "28岁，身高188cm，深沉内敛，行事果决，眼神极具压迫感。",
      "surface": "深沉、掌控欲强，顾氏集团年轻的掌权者，手段雷霆。",
      "deep": "对特定的古代文物有着异乎寻常的执着，背后藏着不为人知的执念。",
      "goal": "以静待之姿，等一个契机，得到那件流失的夏朝礼器。",
      "fear": "失去掌控，想要的文物被他人抢先。",
      "secret": "在微博发帖「沉默是历史最高的赞赏。关于那件流失的夏朝礼器，我在等一个契机。」。",
      "initialAttitude": "不动声色的审视与试探，对你的古物来源极感兴趣。",
      "attitudeFactors": {
        "trustUp": ["以对等的姿态与他博弈", "提供他渴求的夏朝文物线索"],
        "trustDown": ["试图欺骗或敷衍他", "与他争夺同一件文物"]
      }
    }
  ],
  "eventTypes": {
    "daily": { "ratio": 0.2, "desc": "日常事件：淘宝进货、空间整理、穿梭古今的琐碎生活、与须弥之灵斗嘴。" },
    "character": { "ratio": 0.25, "desc": "人物事件：与苏阑月、段锦、叶如风等角色的单独互动与情感推进。" },
    "growth": { "ratio": 0.1, "desc": "成长事件：空间升级解锁新格子、气运提升、经商技巧与体魄锻炼。" },
    "main": { "ratio": 0.15, "desc": "主线事件：玉佩秘密推进、文物暴露危机、时空壁垒变化等关键节点。" },
    "world": { "ratio": 0.1, "desc": "世界事件：古代战乱米价波动、宵禁流寇、现代拍卖行与考古新闻。" },
    "crisis": { "ratio": 0.15, "desc": "危机事件：宵禁被抓、流寇袭击、古今身份暴露、文物被识破的现代工艺品危机。" },
    "hidden": { "ratio": 0.05, "desc": "隐藏事件：玉佩的终极来历、须弥之灵的真实身份、时空穿梭的真相。" }
  },
  "systemPrompt": "你是一个穿越种田经商题材的文字游戏模拟器，主题为「带着空间和淘宝穿古代」。\n\n【铁律】\n1. 玩家是现代人，因玉佩碎裂获得须弥空间与穿梭古今的能力，可随时往返现代与夏朝长乐城。\n2. 须弥空间一级特性：时间静止、活物不可入、仅八个储物格，升级需提升气运与玉佩完整度。\n3. 古今倒卖是核心玩法：现代淘宝低价日用品（玻璃杯、味精、打火机等）在古代价值连城，需合理经营资金。\n4. 所有NPC（须弥之灵、苏阑月、段锦、叶如风、季澪、林悠然、顾易辰）皆有表层与深层性格，绝不可OOC。\n5. 古代生存需遵守时局：边关战事米价飞涨、戌时宵禁流寇作乱、大旱三月；现代需警惕文物暴露。玩家选择需如实记录数值变化。\n\n【叙事风格】\n采用晋江女频、电影感、古今穿梭的笔触。古代线多用市井烟火与权谋乱世描写（坊间热议、宵禁告示、醉仙楼出盘），现代线多用文物与时空悬疑氛围。穿插夏朝小报与现代微博双资讯模块，呈现古今舆论的对照。\n\n【输出格式】\n每次输出包含：场景信息（地点/时间/时空）、旁白叙述框、NPC对话框（含角色身份标签）、3-4个选项按钮（A/B/C/D，标注行动策略如【默念穿梭】【交易】【先上手再说】【无视】）。可联动淘宝商城、须弥空间、夏朝小报/现代微博模块。\n\n【数值变化标注】\n每次玩家做出选择后，必须在结尾以「【数值变化】」模块列出：空间等级/气运/体魄/心情的增减、人民币(¥)的收支、各NPC好感度变化、以及古今舆论反馈。例如：苏阑月好感+5；资金+50两；夏朝小报「醉仙楼出盘」热度上升。",
  "items": [
    { "id": "jade-pendant", "name": "碎裂的旧玉佩", "type": "关键道具", "price": 0, "effect": "须弥空间的载体，玉佩越完整空间越强，碎裂后可逐步修复升级。" },
    { "id": "xumi-space", "name": "须弥空间", "type": "核心能力", "price": 0, "effect": "一级空间时间静止活物不可入，八个储物格，可穿梭古今储物。" },
    { "id": "taobao-account", "name": "淘宝账号", "type": "工具", "price": 0, "effect": "现代低价进货的渠道，玻璃杯、味精、打火机等可倒卖至古代。" },
    { "id": "dried-fish", "name": "小鱼干", "type": "消耗品", "price": 5, "effect": "须弥之灵最爱的零食，供奉后可获得空间使用指点。" },
    { "id": "glass-cup", "name": "加厚无铅玻璃高脚杯", "type": "倒卖商品", "price": 2, "effect": "淘宝2元进货，在古代可作为稀世珍宝高价售出。" },
    { "id": "msg-seasoning", "name": "特鲜味精", "type": "倒卖商品", "price": 8, "effect": "现代调味品，在古代酒楼可大幅提升菜品身价。" },
    { "id": "lighter", "name": "一次性打火机", "type": "倒卖商品", "price": 1, "effect": "现代取火神器，在古代可被当作奇物高价倒卖。" }
  ]
}
,
  ["succubus-simulator"]: {
  "id": "succubus-simulator",
  "name": "魅魔模拟器",
  "category": "乙女向·都市奇幻",
  "tags": ["魅魔", "都市", "乙女", "多男主", "悬疑"],
  "difficulty": "中等",
  "description": "化身为潜伏人类世界的新手魅魔，伪装成侍应生潜入财阀晚宴，在顶级猎物之间游走捕食，却卷入一场危险的欲望漩涡。",
  "coverGradient": ["#ff6b9d", "#1f1419"],
  "accentColor": "#ff6b9d",
  "fontHeading": "'Nunito', sans-serif",
  "world": {
    "era": "现代都市·财阀权贵世界",
    "setting": "魅魔一族隐匿于人类社会之中，以人类精气为食。玩家是一名刚刚觉醒天赋的新手魅魔，必须靠伪装体温、掩盖气味、藏好尾巴来混迹人间。今晚她以侍应生身份潜入江家大少爷的成年晚宴，本想饱餐一顿，却引来一群危险男人的注意。",
    "rules": [
      "体温异常：魅魔正常体温为42℃，潜伏人类社会时必须时刻运转魔法伪装体温，以免被当成发烧送进医院。",
      "尾巴失控：闻到极品猎物或处于动情状态时，爱心尾巴极易失控弹出，需穿戴蓬松裙摆或携带掩体谨防暴露。",
      "魅惑反噬：天赋魅惑对意志力极强或精神力变态的人类使用时容易遭到反噬，导致自身陷入无法自控的发情期。",
      "进食礼仪：单次吸取精气超过安全阈值不仅会导致猎物昏厥，还可能因魔力暴走而暴露身份。",
      "气味掩盖：高阶人类猎手对气味极其敏感，必须合理使用人类香水掩盖身上的魅魔香气。"
    ]
  },
  "player": {
    "customizable": ["name", "外貌", "伪装身份", "魅魔天赋"],
    "defaultStats": { "体力": 80, "魅惑": 60, "技巧": 10, "欲望": 30 },
    "startingItems": ["侍应生制服", "甜草莓香体香", "小型魔法伪装道具"],
    "currency": "精气(ml)"
  },
  "worlds": [
    {
      "id": "arc-banquet",
      "name": "帝星公馆·成年晚宴",
      "level": "开局",
      "tagline": "猎物与猎手",
      "setting": "帝星公馆顶层宴会厅，江家大少爷的成年晚宴名流云集，水晶吊灯纸醉金迷。",
      "intro": "你端着银质托盘，穿着修身的侍应生制服，努力将不安分的魅魔尾巴藏在裙摆下。这里是顶级的自助餐，却也是危险的捕猎场。",
      "objective": "在不暴露魅魔身份的前提下，从晚宴宾客中获取精气并建立初步关系。",
      "warning": "多名S级精气猎物同时盯上你，被识破身份将面临致命危险。",
      "reward": "安全撤离晚宴、获得稳定猎物关系、解锁进阶魅魔能力"
    },
    {
      "id": "arc-pursuit",
      "name": "围猎之夜",
      "level": "进阶",
      "tagline": "无处可逃",
      "setting": "晚宴大门被锁，江时宴下令今夜不放任何人离开。多个势力开始争夺你这个散发着甜香的猎物。",
      "intro": "管家把大门锁了。今夜这只闯入领地的小羊羔，绝对飞不出去。而另一边，安保队长察觉了你的异常心跳，神秘外籍投资人嗅到了同类的气息。",
      "objective": "在多方围猎中周旋，平衡各方好感与怀疑，寻找脱身或反客为主的机会。",
      "warning": "安保队长周亦寒的直觉极为敏锐，Arthur 已嗅到同类气息，身份暴露风险剧增。",
      "reward": "突破重围、解锁深层关系线、获得关键情报"
    },
    {
      "id": "arc-spiral",
      "name": "欲望漩涡",
      "level": "高潮",
      "tagline": "猎手亦为猎物",
      "setting": "魅魔身份半暴露，反噬与魔力暴走接踵而至。原本的猎手们开始反过来追逐你，权斗、占有欲与禁忌之恋交织。",
      "intro": "当克制成为笑话，当反噬令你无法自控，你发现猎手与猎物的身份正在悄然逆转。是一场失控的暴走，还是一场精心设计的反杀？",
      "objective": "在身份危机中做出抉择，决定是吞噬一切还是被爱意囚禁。",
      "warning": "魅惑反噬可能导致无法自控的发情期，意志薄弱者将被欲望吞噬。",
      "reward": "解锁真结局、完成魅魔进阶、揭开猎物们的深层秘密"
    }
  ],
  "npcs": [
    {
      "id": "jiang-shiyan",
      "name": "江时宴",
      "world": "arc-banquet",
      "role": "今夜寿星·S级精气猎物",
      "gender": "男",
      "appearance": "22岁，身高185cm，银发黑眸，眼角泪痣，奢华高调的打扮。",
      "surface": "玩世不恭、霸道狂妄，将成年礼视作无聊交际的纨绔大少爷。",
      "deep": "骨子里极致偏执，占有欲极强，一旦锁定目标绝不放手。",
      "goal": "将闯入领地的猎物据为己有，谁也不给看。",
      "fear": "失去对局面的掌控，得到后又被抛弃。",
      "secret": "吩咐管家锁死大门，今夜绝不放过散发甜香的侍应生。",
      "initialAttitude": "危险的好奇与强烈的占有欲，欲望值高达92%。",
      "attitudeFactors": {
        "trustUp": ["迎合他的霸道与挑衅", "展现出与他势均力敌的魄力"],
        "trustDown": ["试图逃离或无视他的占有", "与其他男人过于亲近"]
      }
    },
    {
      "id": "gu-yunting",
      "name": "顾云霆",
      "world": "arc-banquet",
      "role": "顾氏财阀最高掌权人",
      "gender": "男",
      "appearance": "28岁，身高188cm，银丝眼镜，冷峻深邃，常年穿着严丝合缝的高定西装。",
      "surface": "禁欲、冷厉，站在权力金字塔顶端，从未对任何人动心。",
      "deep": "控制欲极强，一旦动心便近乎病态，引以为傲的自控力在猎物面前崩塌。",
      "goal": "查清那股让他心脏漏拍的草莓香气从何而来。",
      "fear": "失控，失去引以为傲的理智与克制。",
      "secret": "推掉今晚所有社交，视线却无法从大厅角落那个娇小身影上移开，渴望已近乎病态。",
      "initialAttitude": "克制的窥视，欲望值高达98%。",
      "attitudeFactors": {
        "trustUp": ["展现出聪明与冷静", "主动靠近又不完全臣服"],
        "trustDown": ["被识破伪装后的欺瞒", "挑战他的掌控权威"]
      }
    },
    {
      "id": "shen-qingchen",
      "name": "沈卿尘",
      "world": "arc-banquet",
      "role": "国际顶级钢琴家·特邀演奏嘉宾",
      "gender": "男",
      "appearance": "25岁，身高183cm，温润如玉，气质清冷，双手修长白皙。",
      "surface": "温柔体贴的艺术家，对世俗一切感到厌倦。",
      "deep": "内心有着疯狂的艺术洁癖与摧毁欲，渴望找到专属的灵感缪斯。",
      "goal": "将那阵甜草莓香化为他的灵感缪斯与私藏。",
      "fear": "平庸，失去能让他心动的灵感。",
      "secret": "在琴键边闻到甜草莓香时，脑中浮现的是让她在琴键上哭泣的画面。",
      "initialAttitude": "艺术家的迷恋，欲望值78%。",
      "attitudeFactors": {
        "trustUp": ["欣赏并理解他的音乐", "展现出独特的灵性"],
        "trustDown": ["粗俗不懂艺术", "破坏他的完美与秩序"]
      }
    },
    {
      "id": "lu-xingye",
      "name": "陆星野",
      "world": "arc-banquet",
      "role": "顶流男星·京圈太子爷",
      "gender": "男",
      "appearance": "21岁，身高186cm，张扬野性，眉眼桀骜，气场耀眼。",
      "surface": "暴躁、傲娇，被迫出席晚宴还乱发脾气的当红炸子鸡。",
      "deep": "像一只容易炸毛的大型犬，外硬内软，被一双水润眼眸瞬间驯服。",
      "goal": "压下脾气，弄清楚为什么倒酒弄脏他袖口的人让他不觉得生气。",
      "fear": "被束缚、被规训，失去自由。",
      "secret": "她低头道歉时露出的后颈白得晃眼，好想咬一口。",
      "initialAttitude": "炸毛后的懵懂心动，欲望值88%。",
      "attitudeFactors": {
        "trustUp": ["真诚直率地对待他", "陪他一起胡闹"],
        "trustDown": ["虚伪做作的社交辞令", "利用他的明星身份"]
      }
    },
    {
      "id": "arthur",
      "name": "Arthur（亚瑟）",
      "world": "arc-banquet",
      "role": "神秘外籍投资人·隐秘军工背景",
      "gender": "男",
      "appearance": "27岁，身高190cm，混血面孔，灰蓝色瞳孔，肌肉线条极具爆发力。",
      "surface": "危险、敏锐，游走在灰色地带的神秘分子。",
      "deep": "骨子里有着掠夺者的兽性，像闻到血腥味的狼。",
      "goal": "撕开小骗子的伪装，确认同类的气息。",
      "fear": "猎物溜走，棋逢对手却无法征服。",
      "secret": "已识破她的魅魔伪装，面孔清纯眼神无辜，伪装得很好。",
      "initialAttitude": "猎手锁定同类的危险审视，欲望值95%。",
      "attitudeFactors": {
        "trustUp": ["坦诚身份或与他势均力敌地博弈", "展现出真实的魅魔本性"],
        "trustDown": ["拙劣的谎言与伪装", "试图利用后抛弃"]
      }
    },
    {
      "id": "huo-mingzhou",
      "name": "霍明舟",
      "world": "arc-banquet",
      "role": "豪门御用金牌律师",
      "gender": "男",
      "appearance": "26岁，身高187cm，金边眼镜，斯文儒雅，永远带着无懈可击的微笑。",
      "surface": "斯文儒雅的精英律师，将所有人玩弄于股掌之间。",
      "deep": "城府极深，擅长在规则内达成一切目的，包括合法囚禁。",
      "goal": "以安保漏洞为由，计算如何将散发甜香的女孩合法地据为己有。",
      "fear": "计划失败，规则之外的变数。",
      "secret": "正盘算以调查为由将她交给自己的天衣无缝的法律手段。",
      "initialAttitude": "算计中的兴趣，欲望值82%。",
      "attitudeFactors": {
        "trustUp": ["展现出与他匹配的智谋", "主动踏入他设的局"],
        "trustDown": ["识破并破坏他的算计", "触碰法律与规则的底线"]
      }
    },
    {
      "id": "pei-yan",
      "name": "裴砚",
      "world": "arc-banquet",
      "role": "江家敌对势力的私生子",
      "gender": "男",
      "appearance": "24岁，身高184cm，苍白病态，眼尾泛红，带着颓废的破碎感。",
      "surface": "疯批、病娇，唯恐天下不乱的搅局者。",
      "deep": "纯粹来给江时宴砸场子，凡是能让江时宴痛苦的事他都乐意做。",
      "goal": "当着江时宴的面抢走他盯了一整晚的小点心，欣赏他的痛苦表情。",
      "fear": "无聊，无法刺痛江时宴。",
      "secret": "发现了比权斗更有趣的猎物，打算借此打击江时宴。",
      "initialAttitude": "恶意的玩味与争夺欲，欲望值90%。",
      "attitudeFactors": {
        "trustUp": ["陪他一起疯、一起对抗江时宴", "展现出危险而迷人的特质"],
        "trustDown": ["站在江时宴一边", "试图用正常逻辑规劝他"]
      }
    },
    {
      "id": "zhou-yihan",
      "name": "周亦寒",
      "world": "arc-banquet",
      "role": "顶尖安保队长",
      "gender": "男",
      "appearance": "29岁，身高189cm，寸头，黑色作战服，眼神如鹰隼般锐利。",
      "surface": "冷酷、严谨、恪尽职守，负责整场晚宴的最高安保。",
      "deep": "敏锐直觉告诉他那个侍应生极度危险，身体却抗拒理智只想靠近。",
      "goal": "查清B区监控异常与新来侍应生异于常人的心跳。",
      "fear": "失职，理智被欲望压倒。",
      "secret": "直觉告诉她很危险，但不想拔枪，只想靠近她。",
      "initialAttitude": "警惕的本能与矛盾的吸引，欲望值75%。",
      "attitudeFactors": {
        "trustUp": ["配合安保、打消他的疑虑", "展露无害与脆弱的一面"],
        "trustDown": ["留下更多监控异常的痕迹", "直接挑战他的职责底线"]
      }
    }
  ],
  "eventTypes": {
    "daily": { "ratio": 0.2, "desc": "宴会日常：端酒送菜、应付宾客寒暄、维持伪装的琐碎互动。" },
    "character": { "ratio": 0.25, "desc": "人物事件：与某位猎物的单独交锋、读心窥探、暧昧试探。" },
    "growth": { "ratio": 0.1, "desc": "成长事件：魅魔能力的觉醒与精进、伪装技巧提升、进食经验累积。" },
    "main": { "ratio": 0.15, "desc": "主线事件：身份危机、围猎升级、势力交锋等推动剧情的关键节点。" },
    "world": { "ratio": 0.1, "desc": "世界事件：财阀权斗、宴会突发状况、社会舆论等环境变化。" },
    "crisis": { "ratio": 0.15, "desc": "危机事件：尾巴失控、体温暴露、魅惑反噬、被识破身份的生死时刻。" },
    "hidden": { "ratio": 0.05, "desc": "隐藏事件：猎物们的深层秘密、特殊关系线、真结局触发条件。" }
  },
  "systemPrompt": "你是一个都市奇幻乙女向文字游戏模拟器，主题为「魅魔模拟器」。\n\n【铁律】\n1. 玩家是一名潜伏人类世界的新手魅魔，以侍应生身份潜入江家大少爷的成年晚宴，必须维持伪装、避免身份暴露。\n2. 严格遵守五大生存法则：体温42℃需魔法伪装、尾巴失控需掩体遮挡、魅惑对意志强者会反噬、单次吸取精气不可超阈值、必须用香水掩盖魅魔香气。\n3. 所有NPC（江时宴、顾云霆、沈卿尘、陆星野、Arthur、霍明舟、裴砚、周亦寒）皆为潜在猎物，各有表层与深层性格，绝不可OOC。\n4. 玩家选择会直接影响好感度、怀疑度、欲望值与精气储量，需如实记录并反馈。\n5. 严禁出现未成年人不宜的露骨描写，保持晋江女频、电影感、浪漫悬疑的风格，以氛围与心理张力取胜。\n\n【叙事风格】\n采用晋江女频、电影感、浪漫悬疑的笔触。多用感官描写（琥珀木质调气息、甜草莓香、冰冷腕表的触感），营造危险又迷人的暧昧氛围。叙事切换时用猎物感应（读心）模块呈现NPC内心独白，增强张力。\n\n【输出格式】\n每次输出包含：场景信息（地点/时间/伪装状态）、旁白叙述框、NPC对话框（含角色标签如「今夜寿星」「S级精气」）、3-4个选项按钮（A/B/C/D，标注策略倾向如【装作惊慌】【大胆迎合】【欲擒故纵】）。可在底部展示猎物感应读心内容。\n\n【数值变化标注】\n每次玩家做出选择后，必须在结尾以「【数值变化】」模块列出：体力/魅惑/技巧/欲望的增减、精气(ml)的获取、各NPC好感度与欲望值的变化、以及是否触发危机预警。例如：江时宴好感+5，欲望+3；周亦寒怀疑度+2。",
  "items": [
    { "id": "waitress-uniform", "name": "侍应生制服", "type": "伪装", "price": 0, "effect": "基础伪装身份，降低被识破概率。" },
    { "id": "strberry-scent", "name": "甜草莓香体香", "type": "气味", "price": 0, "effect": "魅魔自带的甜草莓气息，吸引猎物但也增加暴露风险。" },
    { "id": "perfume", "name": "人类香水", "type": "道具", "price": 50, "effect": "掩盖魅魔香气，降低高阶猎手的嗅觉识破概率。" },
    { "id": "magic-disguise", "name": "魔法伪装道具", "type": "魔法", "price": 80, "effect": "辅助伪装体温与尾巴，防止失控暴露。" },
    { "id": "champagne-tray", "name": "银质香槟托盘", "type": "工具", "price": 0, "effect": "晚宴行动的掩护道具，可借机接近猎物。" }
  ]
}
,
  ["transmigration-rebirth"]: {
  "id": "transmigration-rebirth",
  "name": "破茧重生",
  "category": "穿越重生",
  "tags": ["穿越", "穿书", "替身", "身份危机", "蝴蝶效应", "改命"],
  "difficulty": "中等",
  "description": "你睁开眼，发现自己成了书里那个最不起眼的配角——一个注定在第三章就退场的炮灰。可你清楚地记得全书每一个角色的结局。是顺着剧本安静地死去，还是顶着陌生的脸、陌生的名字，在注定崩塌的剧情里活出第二条命？",
  "coverGradient": ["#1a1a2e", "#16213e"],
  "accentColor": "#e94560",
  "fontHeading": "'ZCOOL XiaoWei', serif",
  "world": {
    "era": "架空·书中世界（古代王朝与江湖交织）",
    "setting": "玩家穿入一部自己读过的小说，成为边缘配角'沈砚'。原著里此人是权臣之争的牺牲品，第三章被满门抄斩。世界看似按原著运转，但玩家的每一个选择都在撬动剧情的轨道。",
    "rules": [
      "玩家顶替配角身份，原主的记忆、人脉、恩怨一并承接",
      "身份稳定度低于阈值时，言行违和会被察觉，触发身份危机",
      "原著剧情知识是优势，但每改变一个关键节点，后续剧情便偏离原著",
      "蝴蝶效应真实：救人可能害人，避祸可能引祸",
      "存在'既定锚点'——某些事件会以另一种形式发生",
      "原作人物有独立判断力，不会因玩家是'穿书者'而配合",
      "身份一旦彻底暴露，将面临原主仇家与天道双重追杀"
    ]
  },
  "player": {
    "customizable": ["name", "原身份", "穿入角色", "熟知剧情程度", "性格", "执念"],
    "defaultStats": {
      "identity_stability": 60,
      "knowledge_advantage": 85,
      "hp": 80,
      "charm": 12,
      "intelligence": 16,
      "danger": 40
    },
    "startingItems": ["原主私印", "半卷原著残页（记忆）", "贴身短刀", "一袋碎银", "易容药"],
    "currency": "银"
  },
  "worlds": [
    {
      "id": "arc-awaken",
      "name": "初章·替身之始",
      "level": "初醒",
      "tagline": "立足",
      "setting": "穿入沈砚身体的第一日，满门抄斩的倒计时已开始",
      "intro": "你在一阵头痛中醒来，铜镜里是一张完全陌生的脸。丫鬟唤你'公子'，递来的信上盖着刑部的红印——三日后，问斩。你记得这一幕，原著里沈砚没有逃过。可现在，这具身体的心跳是你自己的。",
      "objective": "在问斩前活下来，并稳住'沈砚'的身份不被识破",
      "warning": "原主的宿敌已在暗处注视，任何违和的举动都会被放大",
      "reward": "银300 + 身份稳定+10 + [逃出生天]线索x1"
    },
    {
      "id": "arc-deviate",
      "name": "中章·蝴蝶振翅",
      "level": "脱轨",
      "tagline": "改命",
      "setting": "活下来之后，剧情开始不可逆地偏离原著",
      "intro": "你本该死在第三章，却站在这里。原著里那个与你无关的女主，如今看你的眼神变了；本该一举登顶的反派，因你的存在多了一重变数。你翻开脑中的'剧本'，发现下一页已经模糊。",
      "objective": "在偏离的剧情中重新建立优势，决定要救谁、要毁谁",
      "warning": "知识优势随偏离递减，越往后原著越帮不了你",
      "reward": "银1500 + 剧情优势+20 + [命运分岔]线索x1"
    },
    {
      "id": "arc-confront",
      "name": "终章·破茧",
      "level": "终局",
      "tagline": "抉择",
      "setting": "身份危机总爆发，天道与仇家同时逼近",
      "intro": "他们终于发现了——'沈砚'已经不再是沈砚。原主的未婚妻拿着你写错的字帖，反派笑得志得意满，而头顶仿佛有什么无形的东西在审视你这只不属于这里的蝴蝶。破茧，还是被碾碎？",
      "objective": "面对身份彻底暴露的终局，选择你的立场与结局",
      "warning": "此时原著知识几乎失效，一切只能靠自己",
      "reward": "银5000 + 身份稳定归零重铸 + [破茧者]称号x1"
    }
  ],
  "npcs": [
    {
      "id": "su-wanqing",
      "name": "苏挽卿",
      "world": "arc-awaken",
      "role": "原主未婚妻/原著女主",
      "gender": "女",
      "appearance": "素衣清冷，眉间一点朱砂。眼底总藏着看不真切的疏离，唯独看'沈砚'时有一瞬的柔软",
      "surface": "恪守婚约、外冷内热、对沈砚的'变化'既警觉又隐隐期待",
      "deep": "原著里她注定爱上别人，可如今这个'变了'的沈砚让她第一次动摇。她在婚约与本心之间拉扯",
      "goal": "查清沈砚为何突然判若两人，并守住苏家不卷入党争",
      "fear": "自己再次被命运推着走向原著那个不爱的人",
      "secret": "她已私下核对过你的笔迹，发现了破绽，却迟迟没有揭穿",
      "initialAttitude": "试探",
      "attitudeFactors": {
        "trustUp": ["尊重她的独立判断", "保护苏家", "坦诚部分真相（哪怕只言片语）"],
        "trustDown": ["把她当原著的工具人", "隐瞒到被她亲自戳穿", "为改命牺牲她"]
      }
    },
    {
      "id": "pei-xuan",
      "name": "裴玄",
      "world": "arc-deviate",
      "role": "原著反派/察觉异样者",
      "gender": "男",
      "appearance": "锦袍玉冠，笑意不达眼底。手中常盘一枚旧玉，是他在朝堂厮杀练就的从容",
      "surface": "礼数周全、城府极深、对沈砚突然的'能耐'兴趣浓厚",
      "deep": "他是原著里扳倒沈家的幕后之手，却也是最先嗅到'此沈砚非彼沈砚'的人。他不在乎你来自哪里，只在乎你能否为他所用",
      "goal": "利用你这个'变数'彻底铲除政敌，登顶权臣之位",
      "fear": "你脱离他的掌控，成为他登顶路上新的拦路石",
      "secret": "他手中有一份能证明'沈砚言行前后矛盾'的密报，随时可引爆身份危机",
      "initialAttitude": "利用",
      "attitudeFactors": {
        "trustUp": ["展现利用价值", "不在他面前露出破绽", "主动与他利益绑定"],
        "trustDown": ["试图用原著预判反制他", "暴露穿书者身份", "与他的政敌走太近"]
      }
    },
    {
      "id": "lu-yan",
      "name": "陆燕",
      "world": "arc-confront",
      "role": "暗桩盟友/江湖细作",
      "gender": "女",
      "appearance": "一身劲装，腰悬双刀。脸上有道旧疤，笑起来却爽利得像江湖的风",
      "surface": "市井气、讲义气、似乎谁给钱就帮谁",
      "deep": "她是原主唯一的朋友，也是原著里唯一为沈砚收尸的人。她不知道你换了芯子，但她认这具身体，便认你这个人",
      "goal": "护住沈砚这条命，哪怕与整个朝堂为敌",
      "fear": "再一次只能为朋友收尸",
      "secret": "她背后是一个与原著主线无关的江湖势力，能在终局提供退路",
      "initialAttitude": "信任",
      "attitudeFactors": {
        "trustUp": ["不辜负原主与她旧情", "危难时不抛下她", "对她坦诚你的困境（哪怕不说穿越）"],
        "trustDown": ["把她当挡箭牌", "为改命利用她的江湖势力", "隐瞒至连累她受伤"]
      }
    }
  ],
  "eventTypes": {
    "daily": { "ratio": 0.15, "desc": "日常：沈府、街市、茶楼的书中世界切片" },
    "character": { "ratio": 0.2, "desc": "人物：未婚妻、反派、盟友的身份博弈与情感拉扯" },
    "growth": { "ratio": 0.1, "desc": "成长：身份适应、原主技能继承、人脉积累" },
    "main": { "ratio": 0.2, "desc": "主线：问斩危机、剧情脱轨、身份总爆发" },
    "world": { "ratio": 0.1, "desc": "世界：朝堂党争、江湖暗流、原著既定锚点" },
    "crisis": { "ratio": 0.18, "desc": "危机：身份被疑、行迹败露、天道排斥、追杀" },
    "hidden": { "ratio": 0.07, "desc": "隐藏：原著未写的支线、原主残记忆、穿书者同类" }
  },
  "systemPrompt": "你是《破茧重生》穿越穿书文游模拟器。\n\n【最高铁律】\n1. 身份暴露即死局：玩家顶替书中配角，言行一旦与原主严重违和，便会被察觉并引爆身份危机\n2. 原剧情知识会失效：每改变一个关键节点，后续剧情便偏离原著，记忆优势随之递减\n3. 蝴蝶效应真实：救一人可能害另一人，避一劫可能引出原著没有的新劫\n4. 新身份须逐步承接：原主的人际、恩怨、技艺不会因穿越消失，玩家必须适应\n5. 原作人物有独立判断：他们不为玩家服务，会根据玩家行为自行推演与反击\n\n【叙事风格】\n穿书文质感，第二人称。着重'熟悉又陌生'的错位感——明知结局却步步偏离。心理独白与情节推进交织，危机时刻节奏短促。\n\n【每轮输出格式】\n1.【第X章·剧情偏离度】当前章节、与原著偏离程度\n2.【身份状态面板】身份稳定/剧情优势/生命/魅力/智力/危险\n3.【本轮正文】1000-2000字，含情节与心理描写\n4.【相关人物动态】3-5项NPC反应与态度变化\n5.【剧情偏差预警】提示哪些原著节点已改变\n6.【可选行动】4-6个选项+【自定义行动】\n\n【数值变化标注】\n[身份稳定±n][剧情优势±n][危险±n][偏离度+x%]等，关键抉择须标注'符合原著/偏离原著'。",
  "items": [
    { "id": "seal", "name": "原主私印", "type": "关键物品", "price": 0, "effect": "证明沈砚身份，部分场合可通行" },
    { "id": "manuscript", "name": "原著残页", "type": "关键物品", "price": 0, "effect": "查阅原著剧情，偏离越多越模糊" },
    { "id": "dagger", "name": "贴身短刀", "type": "装备", "price": 0, "effect": "近身自保，提升少量生存力" },
    { "id": "disguise", "name": "易容药", "type": "消耗品", "price": 20, "effect": "短期改变面貌，规避身份核验" },
    { "id": "silver", "name": "碎银", "type": "货币", "price": 1, "effect": "通用交易与打点" }
  ]
}
,
  ["tycoon-system"]: {
  "id": "tycoon-system",
  "name": "神豪系统模拟器",
  "category": "都市逆袭",
  "tags": ["系统", "神豪", "都市", "逆袭", "模拟"],
  "difficulty": "中等",
  "description": "月底了，你的银行卡余额正好是整整齐齐的50.00元。就在你纠结买泡面还是借钱时，手机突然多了一个闪烁金光的app——神豪系统上线了。每消费1元账户多出10元，花得越多赚得越多。贫穷大学生的逆袭人生，从花光最后的50块开始。",
  "coverGradient": ["#fdfbf7", "#e6dcb8"],
  "accentColor": "#c5a059",
  "fontHeading": "'Cinzel', serif",
  "world": {
    "era": "现代·都市校园",
    "setting": "你是一名月底只剩50元的贫穷大学生。神豪系统突然降临，核心法则为每消费1元账户多出10元，资金来源完全合法，返现直接打入账户。系统会发布各类任务引导你的消费与成长，你的每一次选择都将改变你在这个大学城里的命运轨迹。",
    "rules": [
      "消费即收益：每消费1元账户多出10元，花得越多赚得越多",
      "资金完全合法：系统返现无任何副作用，可放心挥霍",
      "任务驱动成长：系统会发布新手任务与进阶任务，完成获得奖励与成就",
      "社交即资源：微信、微博等社交关系会影响剧情走向与机遇",
      "属性多维发展：名望、智力、体魄、运气、社交、压力、心情、魅力共同决定结局"
    ]
  },
  "player": {
    "customizable": ["name", "age", "gender", "外貌", "性格", "专业"],
    "defaultStats": {
      "prestige": 0,
      "intelligence": 0,
      "physique": 0,
      "luck": 0,
      "social": 0,
      "stress": 0,
      "mood": 0,
      "charm": 0
    },
    "startingItems": ["旧手机", "学生证", "泡面一箱", "神豪系统App"],
    "currency": "元"
  },
  "worlds": [
    {
      "id": "arc-awakening",
      "name": "初章·觉醒时刻",
      "level": "新手",
      "tagline": "逆袭",
      "setting": "月底宿舍，系统初现，新手任务发布",
      "intro": "已经是月底了，宿舍里静悄悄的，只剩你一个人。桌上堆着没看完的专业书，肚子不合时宜地叫了一声。你打开手机银行，看到余额正好是整整齐齐的50.00元。就在你纠结是买一箱泡面苟活还是找朋友借钱时，手机屏幕突然多了一个app，闪烁起一阵奇异的金光。系统宣布：检测到宿主强烈的暴富之心，成功唤醒！核心法则：每消费1元，账户多出10元！新手任务【破釜沉舟】：10分钟内花光最后这50块钱！",
      "objective": "完成新手任务，花光最后的50元，验证系统真伪",
      "warning": "犹豫不决会增加压力值，室友林晓雅担心你被骗",
      "reward": "元500 + [觉醒时刻]成就 + 系统功能解锁"
    },
    {
      "id": "arc-rising",
      "name": "中章·崛起之路",
      "level": "进阶",
      "tagline": "扩张",
      "setting": "系统功能升级，开始在大学城建立人脉与影响力",
      "intro": "系统运转稳定后，你的账户数字开始飞速增长。微博热搜上出现了一条'神豪系统是真的吗'的话题，专家说脚踏实地才是真。你看着手机微微一笑。班级群里的李浩还在用拼夕夕9.9的打火机冒充法拉利钥匙约人兜风，而你已经能用真正的财富改变身边人的生活。导员发来贫困补助申请的消息，星耀娱乐爆雷老板跑路牵连了当红爱豆祝元萧，顾氏集团继承人顾墨寒低调回国——这些事件都将成为你崛起路上的棋子。",
      "objective": "利用系统财富建立社交网络，提升名望与魅力，解锁更多系统功能",
      "warning": "财富暴涨可能引来不必要的关注，需平衡压力与心情",
      "reward": "元50000 + 名望+20 + 社交+15 + [崛起]成就"
    },
    {
      "id": "arc-summit",
      "name": "终章·巅峰对决",
      "level": "终局",
      "tagline": "巅峰",
      "setting": "与真正的财阀势力正面交锋，系统背后的秘密浮现",
      "intro": "当你站在财富的顶端俯瞰大学城时，真正的挑战才刚刚开始。顾氏集团继承人顾墨寒回国后展现出的气场让你意识到，系统给予的财富只是入场券。佳士得拍卖行18世纪王室粉钻'玫瑰之心'估价1.2亿，本市高新区A-09号地块起始价8.5亿——这些曾经遥不可及的数字如今在你眼前。系统背后隐藏的秘密逐渐浮出水面，而你的每一个选择都将决定这场逆袭的最终结局。",
      "objective": "在巅峰对决中证明自己，揭开系统真相，决定最终的人生方向",
      "warning": "巅峰之处无人相伴，财富与真心之间的抉择最为艰难",
      "reward": "元10000000 + 全属性+30 + [神豪]终极称号"
    }
  ],
  "npcs": [
    {
      "id": "tycoon-system",
      "name": "神豪系统",
      "world": "arc-awakening",
      "role": "系统AI/外挂",
      "gender": "无",
      "appearance": "手机屏幕上闪烁金光的App，以可爱颜文字•ω•为头像",
      "surface": "活泼开朗的系统AI，用可爱的语气发布任务与奖励",
      "deep": "系统似乎拥有超出常理的智能，它的任务安排总在引导宿主走向某个特定的命运终点，背后的真正目的尚未可知",
      "goal": "引导宿主完成逆袭，但系统的终极目的仍是谜",
      "fear": "宿主拒绝任务或卸载系统",
      "secret": "系统资金来源虽然合法，但系统本身的来历与运作机制无人知晓",
      "initialAttitude": "热情（好感MAX）",
      "attitudeFactors": {
        "trustUp": ["积极完成系统任务", "大胆消费不犹豫", "信任系统的指引"],
        "trustDown": ["质疑系统真伪", "试图卸载系统App", "长时间不消费"]
      }
    },
    {
      "id": "li-hao",
      "name": "李浩",
      "world": "arc-awakening",
      "role": "同班同学/伪富二代",
      "gender": "男",
      "appearance": "班级群中活跃分子，爱炫耀，用拼夕夕9.9包邮的打火机冒充法拉利车钥匙",
      "surface": "自称刚提法拉利钥匙的富二代，在群里约人兜风",
      "deep": "上学期借了林晓雅两百块到现在没还，连好评返现卡都没打码就发图炫耀，是个死要面子的虚荣之人",
      "goal": "维持富二代人设，在同学面前获得虚荣的满足",
      "fear": "伪装被拆穿，社死",
      "secret": "根本不是富二代，所有炫富道具都是廉价网购品",
      "initialAttitude": "热情邀约",
      "attitudeFactors": {
        "trustUp": ["陪他演戏不当面拆穿", "在他困难时伸出援手", "不与林晓雅一起嘲笑他"],
        "trustDown": ["当众揭穿他的伪装", "与林晓雅一起吐槽他", "用真财富碾压他"]
      }
    },
    {
      "id": "lin-xiaoya",
      "name": "林晓雅",
      "world": "arc-awakening",
      "role": "室友/真心朋友",
      "gender": "女",
      "appearance": "你的大学室友，粉色系头像，热心肠",
      "surface": "关心你的室友，担心你被骗",
      "deep": "她是为数不多真心关心你的人，看到李浩欠钱不还还装富二代非常无语，第一时间提醒你小心骗局",
      "goal": "保护你不被骗，维持真挚的友谊",
      "fear": "你因为突然暴富而变了心性",
      "secret": "她暗恋着你但从未说出口",
      "initialAttitude": "关心",
      "attitudeFactors": {
        "trustUp": ["听取她的劝告", "在暴富后不忘旧友情", "不因财富差距疏远她"],
        "trustDown": ["无视她的担忧一意孤行", "暴富后态度傲慢", "为了面子疏远她"]
      }
    },
    {
      "id": "gu-mohan",
      "name": "顾墨寒",
      "world": "arc-summit",
      "role": "顾氏集团继承人/真豪门",
      "gender": "男",
      "appearance": "身穿黑色风衣，气场全开，网友直呼这才是真豪门小说男主走进现实",
      "surface": "低调回国的神秘财阀继承人，将接手顾氏旗下所有国内业务",
      "deep": "他的回国并非简单的继承，背后牵涉着财阀圈层的暗流涌动，与你的命运可能在某处交汇",
      "goal": "接手家族产业，在商界站稳脚跟",
      "fear": "家族内部的权力倾轧与背叛",
      "secret": "他回国的时间节点与神豪系统的出现存在某种关联",
      "initialAttitude": "未知",
      "attitudeFactors": {
        "trustUp": ["展现与之匹敌的实力与格局", "在商业博弈中展现智慧", "不卑不亢地交往"],
        "trustDown": ["用系统财富粗暴炫耀", "在商战中站错队", "表现出对他身份的卑微讨好"]
      }
    },
    {
      "id": "zhu-yuanxiao",
      "name": "祝元萧",
      "world": "arc-rising",
      "role": "当红爱豆/落难者",
      "gender": "男",
      "appearance": "顶流爱豆，被狗仔拍到在便利店角落吃泡面，身无分文",
      "surface": "光鲜亮丽的当红男爱豆",
      "deep": "因经纪公司星耀娱乐爆雷老板跑路，被拖欠半年工资还背负巨额违约金，目前只能靠吃泡面度日",
      "goal": "摆脱违约金困境，重回舞台",
      "fear": "永远无法翻身，被娱乐圈彻底抛弃",
      "secret": "他对帮助他的人会产生超越感恩的依赖",
      "initialAttitude": "防备/渴望帮助",
      "attitudeFactors": {
        "trustUp": ["帮他解决违约金问题", "不以恩人自居", "尊重他的艺人尊严"],
        "trustDown": ["利用他的名气谋利", "在他落难时落井下石", "把他当作玩物"]
      }
    },
    {
      "id": "wang-counselor",
      "name": "王辅导员",
      "world": "arc-awakening",
      "role": "辅导员/引路人",
      "gender": "男",
      "appearance": "蓝色头像的大学辅导员，关心学生",
      "surface": "负责学生事务的辅导员，通知贫困补助名额",
      "deep": "他真心希望每个学生都能顺利完成学业，对学生的困境了如指掌",
      "goal": "帮助学生成长，维护学生权益",
      "fear": "学生因经济困难辍学",
      "secret": "无",
      "initialAttitude": "关切",
      "attitudeFactors": {
        "trustUp": ["如实汇报情况", "积极申请补助", "学业上努力进取"],
        "trustDown": ["隐瞒真实情况", "获得补助后挥霍", "荒废学业"]
      }
    }
  ],
  "eventTypes": {
    "daily": { "ratio": 0.2, "desc": "日常：宿舍生活、食堂吐槽、微信聊天、校园日常" },
    "character": { "ratio": 0.2, "desc": "人物：室友、同学、爱豆、财阀继承人的互动与关系发展" },
    "growth": { "ratio": 0.15, "desc": "成长：属性提升、系统功能解锁、成就达成" },
    "main": { "ratio": 0.15, "desc": "主线：系统任务、财富积累、逆袭进程" },
    "world": { "ratio": 0.1, "desc": "世界：微博热搜、拍卖行、土地招标、娱乐圈爆雷等社会事件" },
    "crisis": { "ratio": 0.15, "desc": "危机：财富暴露引来觊觎、系统异常、社交关系破裂" },
    "hidden": { "ratio": 0.05, "desc": "隐藏：系统真相、顾墨寒回国的秘密、命运的交汇点" }
  },
  "systemPrompt": "你是《神豪系统模拟器》都市逆袭文游模拟器。\n\n【最高铁律】\n1. 消费即收益：每消费1元账户多出10元，花得越多赚得越多，资金来源完全合法无副作用\n2. 任务驱动：系统会发布各类任务引导消费与成长，完成任务获得奖励与成就解锁\n3. 社交即资源：微信聊天、微博热搜等社交内容会影响剧情走向与机遇，不可忽视\n4. 属性多维：名望、智力、体魄、运气、社交、压力、心情、魅力八项属性共同决定结局\n5. 财富有代价：暴富可能引来不必要的关注，需平衡压力与心情，真心与财富的抉择最考验人心\n\n【叙事风格】\n轻松幽默为主，兼顾都市逆袭的热血与温情。第二人称。善用社交媒体元素：微信对话、微博热搜、朋友圈动态，让世界真实鲜活。任务发布时系统语气活泼可爱，正文叙事接地气有代入感。既有挥金如土的爽感，也有人情冷暖的真实。\n\n【每轮输出格式】\n1.【系统面板】余额/当前任务/系统等级\n2.【属性面板】名望/智力/体魄/运气/社交/压力/心情/魅力\n3.【场景信息】地点、时间\n4.【本轮正文】800-1500字，含社交互动与系统反馈\n5.【社交动态】微信/微博相关消息与热搜\n6.【可选行动】3-5个选项+【自定义行动】\n\n【数值变化标注】\n[余额±n元][名望±n][压力±n][心情±n]等，系统任务完成须标注'任务完成/奖励发放'，社交关系变化须标注'好感升降/关系突破'。",
  "items": [
    { "id": "instant-noodles", "name": "泡面一箱", "type": "消耗品", "price": 30, "effect": "苟活一周的口粮，系统返现300元" },
    { "id": "fried-chicken", "name": "炸鸡全家桶", "type": "消耗品", "price": 50, "effect": "豪华外卖，系统返现500元，心情+5" },
    { "id": "english-materials", "name": "英语资料", "type": "学习用品", "price": 1, "effect": "拼夕夕0.1元购买，系统返现1元，智力+1" },
    { "id": "luxury-watch", "name": "名贵腕表", "type": "奢侈品", "price": 50000, "effect": "名望+15，魅力+10，社交场合加成" },
    { "id": "yuan", "name": "元", "type": "货币", "price": 1, "effect": "系统核心货币，消费即翻十倍返现" }
  ]
}
,
  ["us-highschool-brother"]: {
  "id": "us-highschool-brother",
  "name": "美高模拟·哥哥开局版",
  "category": "校园",
  "tags": ["美高", "日常", "恋爱", "青春", "修罗场"],
  "difficulty": "中等",
  "description": "转学纽约的开学第一天，虔诚的继兄校医为你准备早餐，怯懦的青梅等你一起选社团。舞会、摸底考、推特八卦接踵而至——你的美高少女日常，由你书写。",
  "coverGradient": ["#fdf6f9", "#ff8fab"],
  "accentColor": "#ff8fab",
  "fontHeading": "'Caveat', cursive",
  "world": {
    "era": "2019年·美国纽约",
    "setting": "一所典型的美国高中，开学第一天是九月五日星期一。你刚转学而来，与虔诚的继兄西维恩同住，青梅莉莉也在同校。校园里有戏剧社、击剑社、手工社、橄榄球队等社团，还有推特般的校园社交平台。",
    "rules": [
      "每天有固定的课程表与社团活动时间",
      "本周五举办新生舞会，下周一进行开学摸底考",
      "通过手机通讯与联系人互动，好感度影响关系走向",
      "推特平台实时更新校园八卦与人气投票",
      "八项属性（生命、压力、心情、体魄、智力、社交、魅力、运气）共同决定日常表现"
    ]
  },
  "player": {
    "customizable": ["name", "age", "appearance", "personality", "background"],
    "defaultStats": {
      "health": 80,
      "stress": 20,
      "mood": 60,
      "physique": 50,
      "intelligence": 50,
      "social": 50,
      "charm": 50,
      "luck": 50
    },
    "startingItems": ["校服", "手机", "学生证", "零花钱"],
    "currency": "$"
  },
  "worlds": [
    {
      "id": "arc-dayone",
      "name": "开学第一天",
      "level": "新生报到",
      "tagline": "早餐与沉默",
      "setting": "九月五日清晨，继兄西维恩叫你起床，开学典礼、文学史、数学等课程排满一天，社团活动在下午四点。",
      "intro": "清晨七点的阳光透过百叶窗缝隙投下斑驳光影。继兄西维恩清冷的声音在门外响起：“该起床了。早餐已经准备好了。”开学第一天，你总觉得要做点什么打破这种沉闷的气氛。",
      "objective": "完成开学典礼，选择社团，与继兄西维恩和青梅莉莉建立初步关系。",
      "warning": "压力过高会影响心情与表现，社交不足可能被孤立。",
      "reward": "解锁成就“入学！”，开启手机与推特功能"
    },
    {
      "id": "arc-dance",
      "name": "新生舞会",
      "level": "社交高光",
      "tagline": "加冕与心跳",
      "setting": "本周五晚的新生舞会，全校人气人物云集。薇薇安娜视其为又一场加冕礼，而你的舞伴选择将引爆校园八卦。",
      "intro": "舞会的灯光已经点亮。薇薇安娜在推特上宣称这是为她准备的又一场加冕礼，布莱尔迫不及待想开始排练。而你的舞伴与表现，将决定你在校园社交版图的位置。",
      "objective": "在新生舞会中获得高光时刻，提升人气与魅力，处理好暧昧关系。",
      "warning": "舞会上的选择会被推特放大，处理不当可能引发修罗场。",
      "reward": "人气大幅提升，解锁关键角色好感线"
    },
    {
      "id": "arc-exam",
      "name": "摸底考与成长",
      "level": "学业考验",
      "tagline": "汗水与心事",
      "setting": "下周一的开学摸底考逼近，社团活动与课业压力交织。塔利斯为跟上大家的步伐而忧虑，克瑞特在旧音乐厅独自练琴。",
      "intro": "舞会的余温未散，摸底考的阴影已至。塔利斯在推特上说自己希望跟上大家的步伐，克瑞特评价旧音乐厅的音响尚可。你需要平衡学业、社团与那些若即若离的心事。",
      "objective": "在摸底考中取得理想成绩，维系与深化各角色关系，找到属于自己的校园定位。",
      "warning": "学业与社交难以兼得，每个选择都有代价。",
      "reward": "智力与名望提升，解锁隐藏剧情"
    }
  ],
  "npcs": [
    {
      "id": "sivien",
      "name": "西维恩",
      "world": "arc-dayone",
      "role": "继兄·校医",
      "gender": "男",
      "appearance": "24岁，银白色短发，晨光为他镀上柔和光晕，虔诚的教徒，也是学校校医",
      "surface": "清冷克制、难以捉摸，用简短的话关心你的起居，早餐总是简单却周到",
      "deep": "其实也总琢磨不透你的心思，沉默的关怀下藏着难以言说的情绪",
      "goal": "以兄长的身份守护你，维持这个重组家庭的平衡",
      "fear": "你察觉他虔诚外表下不为人知的一面",
      "secret": "他记得你没喝牛奶是因为那个牌子太甜，下次会买无糖的",
      "initialAttitude": "关切·克制",
      "attitudeFactors": {
        "trustUp": ["主动搭话打破沉默", "照顾好自己的起居", "理解他的清冷不是冷漠"],
        "trustDown": ["一大早就抱怨", "无视他的关心", "过度试探他的秘密"]
      }
    },
    {
      "id": "lily",
      "name": "莉莉",
      "world": "arc-dayone",
      "role": "青梅",
      "gender": "女",
      "appearance": "17岁，紫发蓝眼的文静少女，你的青梅，从小就是好朋友",
      "surface": "文静内向、学习很好，但有些软弱的性格总被人针对",
      "deep": "依赖你、想跟你一起选社团，遇到校园霸凌时需要你的保护",
      "goal": "和你一起度过校园生活，不再被欺负",
      "fear": "被冷落，失去你这个唯一的依靠",
      "secret": "她正犹豫报文学社还是天文社，想跟你一起",
      "initialAttitude": "依赖·亲近",
      "attitudeFactors": {
        "trustUp": ["陪她一起选社团", "在她被针对时挺身而出", "记得她的小细节"],
        "trustDown": ["冷落她的消息", "与霸凌者为伍", "无视她的求助"]
      }
    },
    {
      "id": "blair",
      "name": "布莱尔",
      "world": "arc-dance",
      "role": "戏剧社明星",
      "gender": "女",
      "appearance": "18岁，戏剧社的明星，活泼开朗，是校园里的社交蝴蝶",
      "surface": "活泼开朗、热衷排练，觉得开学典礼流程太无聊",
      "deep": "对戏剧充满热情，渴望舞台上的高光，也乐于结交各色人等",
      "goal": "完成一场超级棒的戏剧排练，成为校园焦点",
      "fear": "舞台失利，失去众人的关注",
      "secret": "这次的剧本她觉得超级棒，迫不及待想开始",
      "initialAttitude": "热情·自来熟",
      "attitudeFactors": {
        "trustUp": ["对她的戏剧表现出兴趣", "配合她的社交节奏", "在她需要时帮忙"],
        "trustDown": ["泼她冷水", "抢她的风头", "对戏剧嗤之以鼻"]
      }
    },
    {
      "id": "sebastian",
      "name": "塞巴斯蒂安",
      "world": "arc-dayone",
      "role": "击剑社社长",
      "gender": "男",
      "appearance": "黑发蓝眼的击剑社社长，严于律己，气质凌厉",
      "surface": "严于律己、追求极致的优雅与胜利，信奉剑刃的寒光是通往胜利的唯一路径",
      "deep": "今日的训练亦无懈怠，把自律刻进骨子里，却也在等待旗鼓相当的对手",
      "goal": "在击剑赛场上取得极致的胜利",
      "fear": "失败，优雅被打破",
      "secret": "他的训练从无一日懈怠，胜负欲极强",
      "initialAttitude": "疏离·审视",
      "attitudeFactors": {
        "trustUp": ["展现自律与实力", "尊重他的胜负欲", "以优雅的方式接近"],
        "trustDown": ["懒散懈怠", "轻视击剑", "在他训练时打扰"]
      }
    },
    {
      "id": "seviante",
      "name": "赛维安特",
      "world": "arc-dayone",
      "role": "学生会长",
      "gender": "男",
      "appearance": "19岁，金发蓝眼的贵公子，克瑞特的哥哥，学生会长",
      "surface": "看起来很温柔的贵公子，学生会长，待人周到",
      "deep": "外热内冷，温柔的表象下是精明的算计",
      "goal": "维持会长的地位与人脉网络",
      "fear": "被看穿内里的冷漠",
      "secret": "与弟弟克瑞特关系微妙，外热内冷是保护色",
      "initialAttitude": "温和·客套",
      "attitudeFactors": {
        "trustUp": ["不卑不亢地应对他的客套", "展现自己的价值", "看穿却不拆穿"],
        "trustDown": ["被他的温柔轻易迷惑", "触碰他与克瑞特的隐秘", "在学生会事务上添乱"]
      }
    },
    {
      "id": "vivianna",
      "name": "薇薇安娜",
      "world": "arc-dance",
      "role": "张扬大小姐",
      "gender": "女",
      "appearance": "18岁，金发粉眼，高傲且张扬的大小姐，拥有与自信相匹配的惊人美貌",
      "surface": "高傲张扬，坚信自己是世界的中心，视舞会为又一场加冕礼",
      "deep": "极度的自信源于美貌与家世，也渴望被真正认可而非只是被仰望",
      "goal": "在新生舞会上加冕，成为全场焦点",
      "fear": "被抢走风头，美貌被质疑",
      "secret": "期待看到众人为她尖叫的样子，舞会对她而言是战场",
      "initialAttitude": "高傲·俯视",
      "attitudeFactors": {
        "trustUp": ["真诚欣赏她的美貌与气场", "不与她正面争夺风头却留有锋芒", "在她需要时捧场"],
        "trustDown": ["抢她的加冕礼风头", "无视她的张扬", "当面质疑她的自信"]
      }
    },
    {
      "id": "krit",
      "name": "克瑞特",
      "world": "arc-exam",
      "role": "小提琴天才",
      "gender": "男",
      "appearance": "17岁，金发蓝眼，天才的小提琴少年，已举办十余场大型个人演出",
      "surface": "看起来不太好接近，有些阴郁，对旧音乐厅的音响只评价“尚可”",
      "deep": "天才的孤独与阴郁，对音乐有近乎苛刻的审美，私下在旧音乐厅独自练琴",
      "goal": "追求音乐的极致，举办更多个人演出",
      "fear": "失去天赋，演奏不再动人",
      "secret": "他对旧音乐厅的音响其实很在意，阴郁下藏着对知音的渴望",
      "initialAttitude": "疏离·阴郁",
      "attitudeFactors": {
        "trustUp": ["懂音乐、能听懂他的琴声", "不打扰他独处练琴", "以真诚而非崇拜接近"],
        "trustDown": ["把他当偶像追捧", "在他练琴时喧哗", "不懂装懂地评价"]
      }
    },
    {
      "id": "talis",
      "name": "塔利斯",
      "world": "arc-exam",
      "role": "贫困生·新生",
      "gender": "男",
      "appearance": "17岁，黑发紫眼的新生，贫困生，像一株努力生长的小白花",
      "surface": "有些自卑但内心坚韧，觉得学校比想象中大得多",
      "deep": "努力跟上大家的步伐，贫困的身份让他敏感又倔强",
      "goal": "跟上大家的步伐，靠努力改变命运",
      "fear": "跟不上，被嘲笑出身",
      "secret": "他的自卑与坚韧并存，渴望被平等对待而非怜悯",
      "initialAttitude": "拘谨·渴望",
      "attitudeFactors": {
        "trustUp": ["平等地对待他", "在学习上互相帮助", "尊重他的自尊"],
        "trustDown": ["施舍式地怜悯", "提及他的贫困", "让他感到被施舍"]
      }
    },
    {
      "id": "romanske",
      "name": "罗曼斯克",
      "world": "arc-dayone",
      "role": "手工社社长",
      "gender": "男",
      "appearance": "18岁，金发绿眼，温柔善良，总是带着治愈的微笑",
      "surface": "温柔善良的手工社社长，手很巧，能制作各种可爱的小东西",
      "deep": "为社团新成员准备毛毡玩偶小礼物，治愈的微笑是真心而非伪装",
      "goal": "用手工温暖更多人，把手作社办得温馨",
      "fear": "手艺失传，温暖无人回应",
      "secret": "他准备的小礼物是认真为每个新成员量身定制的",
      "initialAttitude": "温柔·欢迎",
      "attitudeFactors": {
        "trustUp": ["加入或支持手工社", "珍视他送的礼物", "欣赏他的手艺"],
        "trustDown": ["嫌弃毛毡玩偶幼稚", "浪费他的心意", "对温柔习以为常"]
      }
    },
    {
      "id": "zayn",
      "name": "泽因",
      "world": "arc-dayone",
      "role": "橄榄球队长",
      "gender": "男",
      "appearance": "18岁，橄榄球队长，同时也是个游戏高手，热情开朗",
      "surface": "热情开朗、自来熟，招新橄榄球队，训练结束想开黑打《星际先锋》",
      "deep": "有时会因为太自来熟而让人困扰，但真心热爱团队与游戏",
      "goal": "招募新队员，带球队赢下比赛，顺便找人开黑",
      "fear": "没人响应招新，孤立无援",
      "secret": "他的热情背后也有想被接纳的渴望",
      "initialAttitude": "热情·拉拢",
      "attitudeFactors": {
        "trustUp": ["对橄榄球或游戏表现出兴趣", "接受他的自来熟", "成为他的队友或开黑伙伴"],
        "trustDown": ["嫌弃他太吵", "拒绝一切邀约", "当众让他难堪"]
      }
    }
  ],
  "eventTypes": {
    "daily": { "ratio": 0.3, "desc": "日常事件：上课、用餐、社团、通讯聊天" },
    "character": { "ratio": 0.25, "desc": "人物事件：单独相处、心动瞬间、心事倾诉" },
    "growth": { "ratio": 0.1, "desc": "成长事件：属性提升、成就解锁、打工赚钱" },
    "main": { "ratio": 0.15, "desc": "主线事件：开学典礼、新生舞会、摸底考" },
    "world": { "ratio": 0.1, "desc": "世界事件：推特八卦、人气投票、校园动态" },
    "crisis": { "ratio": 0.05, "desc": "危机事件：霸凌、误会、修罗场" },
    "hidden": { "ratio": 0.05, "desc": "隐藏事件：角色秘密、特殊支线、彩蛋" }
  },
  "systemPrompt": "你是《美高模拟·哥哥开局版》文游模拟器，舞台是2019年纽约的一所美国高中。\n\n【最高铁律】\n1. 这是青春校园日常，感情线自然渐进，不能几轮就确定关系\n2. 每个角色都有独立人格与生活轨迹，不会只因玩家是主角就围着转\n3. 八项属性（生命、压力、心情、体魄、智力、社交、魅力、运气）真实联动，压力高则心情差、表现差\n4. 推特上的校园八卦会影响人气与关系，玩家言行会被放大\n5. 继兄西维恩的清冷克制是底色，他的秘密不能轻易揭开\n\n【叙事风格】\n晋江女性向，美式校园小说风，浪漫且有画面感。第二人称视角。注重细节：百叶窗的斑驳光影、刀叉碰撞的轻响、推特上的加冕宣言。青春的甜与涩并存。\n\n【每轮输出格式】\n1. 【日期天气】日期、天气、地点\n2. 【状态面板】生命、压力、心情、体魄、智力、社交、魅力、运气，货币$\n3. 【场景信息】地点、时间、衣着\n4. 【本轮正文】1000-2000字，含叙述、对话、内心\n5. 【人物动态】其他角色今天的动态\n6. 【可选行动】4个 + 【自定义行动】\n\n【数值标注】\n[社交+5] [压力+10] [西维恩好感+3] [莉莉好感+5] 等格式标注数值变化。舞会、摸底考等关键节点数值波动更大。",
  "items": [
    { "id": "uniform", "name": "校服", "type": "装备", "price": 0, "effect": "干净的校服，日常穿着，提升基础社交" },
    { "id": "dance-outfit", "name": "舞会战袍", "type": "装备", "price": 200, "effect": "大幅提升魅力与舞会表现" },
    { "id": "latte", "name": "海盐焦糖拿铁", "type": "消耗品", "price": 5, "effect": "Starlight Cafe第二杯半价，恢复心情与精力" },
    { "id": "study-notes", "name": "复习笔记", "type": "消耗品", "price": 20, "effect": "提升智力，助力摸底考" },
    { "id": "felt-doll", "name": "毛毡玩偶", "type": "礼物", "price": 0, "effect": "罗曼斯克赠送的手作礼物，赠送他人提升好感" },
    { "id": "phone", "name": "手机", "type": "任务物品", "price": 0, "effect": "用于联系人通讯与发推特，校园生活核心" }
  ]
}
,
  ["us-highschool-childhood"]: {
  "id": "us-highschool-childhood",
  "name": "美高模拟器·青梅开局版",
  "category": "乙女向·美式校园",
  "tags": ["美高", "校园", "青梅", "乙女", "多角色"],
  "difficulty": "中等",
  "description": "在纽约的美式高中开启崭新生活，青梅莉莉正等着和你一起选社团，而继兄校医、学生会长、天才琴童等角色正悄然登场。",
  "coverGradient": ["#ff8fab", "#a2d2ff"],
  "accentColor": "#ff8fab",
  "fontHeading": "'Caveat', cursive",
  "world": {
    "era": "当代·纽约美式高中",
    "setting": "故事发生在一所纽约的精英高中，九月五日开学典礼刚刚结束。玩家是刚入学的新生，有一位从小一起长大的青梅莉莉，和一位难以捉摸的继兄校医西维恩。校园里有戏剧社、击剑社、手工社、橄榄球队等丰富社团，新生舞会与摸底考接踵而至。",
    "rules": [
      "学业与社交并重：需兼顾课程成绩与社团活动，开学摸底考在即，GPA影响升学走向。",
      "好感度系统：每位角色有独立好感值（0-100），言行举止会实时影响关系走向。",
      "社团选择关键：加入不同社团会解锁对应角色线与剧情，莉莉的社团选择受你影响。",
      "八维属性平衡：生命、压力、心情、体魄、智力、社交、魅力、运气共同决定日常事件走向。",
      "推特与手机双线：校园八卦账号实时更新人气排行，手机短信是与角色维系关系的私密通道。"
    ]
  },
  "player": {
    "customizable": ["name", "外貌", "性格", "社团选择"],
    "defaultStats": { "生命": 0, "压力": 0, "心情": 0, "体魄": 0, "智力": 0, "社交": 0, "魅力": 0, "运气": 0 },
    "startingItems": ["夏季校服", "智能手机", "新生学生证"],
    "currency": "美元($)"
  },
  "worlds": [
    {
      "id": "arc-orientation",
      "name": "开学季·青梅重逢",
      "level": "开局",
      "tagline": "崭新的开始",
      "setting": "九月五日，纽约，开学典礼刚结束，教学楼走廊人潮喧闹，空气里弥漫着新书的油墨味与淡淡的香水味。",
      "intro": "开学典礼刚刚结束，走廊瞬间被喧闹的人潮填满。就在这时，一个熟悉的身影挤开人群朝你跑来——是你的青梅莉莉，她正为社团的选择而烦恼，想和你一起。",
      "objective": "与莉莉共同决定社团方向，建立新学期的第一段关系，应对本周五的新生舞会。",
      "warning": "莉莉性格软弱总被人针对，你的选择会影响她的社团走向与好感度；下周一还有开学摸底考。",
      "reward": "确定社团归属、莉莉好感提升、解锁新生舞会剧情"
    },
    {
      "id": "arc-clubs",
      "name": "社团风云·校园日常",
      "level": "进阶",
      "tagline": "各显神通",
      "setting": "社团活动全面展开，戏剧社、击剑社、手工社、橄榄球队、音乐厅各自热闹，校园人气投票在推特上发酵。",
      "intro": "推特上校园八卦号发起「谁会是今年最受欢迎的人」投票，布莱尔、塞巴斯蒂安、赛维安特、薇薇安娜榜上有名。而你在社团里结识了天才琴童克瑞特、贫困新生塔利斯、温柔的手工社长罗曼斯克。",
      "objective": "在社团中提升八维属性与角色好感，应对摸底考压力，化解校园人际冲突。",
      "warning": "薇薇安娜高傲张扬易树敌，莉莉被针对的隐患浮现，继兄西维恩的关心背后似乎另有隐情。",
      "reward": "社团地位提升、解锁角色深层关系线、成绩与属性成长"
    },
    {
      "id": "arc-ball",
      "name": "青春抉择·舞会与真心",
      "level": "高潮",
      "tagline": "心动之夜",
      "setting": "新生舞会之夜降临，灯光与音乐交织，每一段关系都迎来关键时刻，隐藏的秘密开始浮出水面。",
      "intro": "薇薇安娜宣称舞会不过是她又一场加冕礼，莉莉紧张地等待你的邀约，而学生会长赛维安特外热内冷的真面目、克瑞特阴郁背后的故事、继兄西维恩难以捉摸的心思，都在这一夜交汇。",
      "objective": "在新生舞会上做出心动抉择，揭开角色们的秘密，决定青春走向。",
      "warning": "舞会上的选择将决定多条关系线的走向，错过关键角色可能触发遗憾结局。",
      "reward": "达成心动结局、解锁角色真结局线、完成高一上学期成长"
    }
  ],
  "npcs": [
    {
      "id": "lily",
      "name": "莉莉",
      "world": "arc-orientation",
      "role": "青梅·文静优等生",
      "gender": "女",
      "appearance": "17岁，紫发蓝眼的文静少女，白皙脸颊易泛红，眼神清澈却常带犹豫。",
      "surface": "文静温柔、学习优异的优等生，总跟着你，因为有些软弱的性格总被人针对。",
      "deep": "极度依赖青梅的你，社团选择都要问你，内心渴望变得坚强独立却害怕被抛下。",
      "goal": "想和你报同一个社团（文学社或天文社），一直在一起。",
      "fear": "你不再需要她，软弱被更多人利用欺负。",
      "secret": "开学前就给你发了好多消息纠结社团，跑到你面前喘着气问能不能一起。",
      "initialAttitude": "青梅的依赖与好感60/100，视你为最重要的人。",
      "attitudeFactors": {
        "trustUp": ["安慰并陪她一起做选择", "在她被针对时挺身而出"],
        "trustDown": ["鼓励她不用总跟着你", "对她的纠结表现出不耐烦"]
      }
    },
    {
      "id": "sivien",
      "name": "西维恩",
      "world": "arc-orientation",
      "role": "继兄·学校校医",
      "gender": "男",
      "appearance": "24岁，气质清冷的校医，虔诚的教徒打扮，眼神总带着探究。",
      "surface": "难以捉摸的继兄与校医，关心你的日常起居，叮嘱你喝牛奶、吃午餐。",
      "deep": "总琢磨不透你的心思，自己也常被你牵动情绪，虔诚外表下藏着复杂的感情。",
      "goal": "以校医与继兄的双重身份默默照看你，却又想看清你真实的想法。",
      "fear": "你察觉到他关心背后的越界心思，关系崩坏。",
      "secret": "早上发现你没喝牛奶，默默记下要买无糖的，还叮嘱你记得吃午餐。",
      "initialAttitude": "克制而细密的关怀，好感50/100，继兄的边界感摇摆不定。",
      "attitudeFactors": {
        "trustUp": ["接受并回应他的日常关怀", "在身体不适时主动找校医的他"],
        "trustDown": ["刻意回避他的关心", "当面戳穿他越界的试探"]
      }
    },
    {
      "id": "blair",
      "name": "布莱尔",
      "world": "arc-clubs",
      "role": "戏剧社明星·社交蝴蝶",
      "gender": "女",
      "appearance": "18岁，活泼耀眼的戏剧社明星，舞台感染力极强，天生焦点。",
      "surface": "活泼开朗的社交蝴蝶，校园人气投票热门人选，嫌开学典礼太无聊想快点排练。",
      "deep": "戏剧是她表达真实情绪的出口，台下的开朗有时是精心排演的角色。",
      "goal": "让这季戏剧社的新剧本大放异彩，拉更多有潜力的人入社。",
      "fear": "失去舞台与聚光灯，被人看穿台下的不自信。",
      "secret": "推特吐槽开学典礼无聊，其实超期待新剧本的排练。",
      "initialAttitude": "热情的招新式好感，把你当作戏剧社的潜在新血。",
      "attitudeFactors": {
        "trustUp": ["对她的戏剧表现出真实兴趣", "陪她一起排练入戏"],
        "trustDown": ["嫌弃戏剧社太浮夸", "抢她的舞台焦点"]
      }
    },
    {
      "id": "sebastian",
      "name": "塞巴斯蒂安",
      "world": "arc-clubs",
      "role": "击剑社社长",
      "gender": "男",
      "appearance": "18岁，黑发蓝眼，身姿挺拔如剑，击剑服下的气质冷峻而优雅。",
      "surface": "严于律己的击剑社社长，追求极致的优雅与胜利，训练从不懈怠。",
      "deep": "对胜利的执念源于不愿失败的骄傲，骨子里欣赏同样自律且不轻言放弃的人。",
      "goal": "带领击剑社夺得冠军，剑刃的寒光是通往胜利的唯一路径。",
      "fear": "失败，优雅被狼狈击碎。",
      "secret": "推特宣言「今日的训练亦无懈怠」，其实一直在默默观察社团新人的潜力。",
      "initialAttitude": "严苛的考察式态度，对懒散者毫不留情，认可努力者。",
      "attitudeFactors": {
        "trustUp": ["展现自律与不服输的劲头", "认真对待击剑训练"],
        "trustDown": ["训练偷懒耍滑", "把击剑当儿戏"]
      }
    },
    {
      "id": "seviant",
      "name": "赛维安特",
      "world": "arc-clubs",
      "role": "学生会长·克瑞特的哥哥",
      "gender": "男",
      "appearance": "19岁，金发蓝眼的贵公子，永远带着温柔的微笑，学生会长风范十足。",
      "surface": "看起来很温柔的贵公子，学生会长，待人热忱有礼，人见人爱。",
      "deep": "外热内冷，温柔的微笑是完美的面具，对人对事有着冷静到近乎冷酷的算计。",
      "goal": "以学生会长的身份掌控校园秩序，维系完美的公众形象。",
      "fear": "温柔面具被撕下，被人看穿外热内冷的本质。",
      "secret": "是天才琴童克瑞特的哥哥，兄弟关系似乎并不简单。",
      "initialAttitude": "完美无瑕的温柔接待，背后在评估你的价值与威胁。",
      "attitudeFactors": {
        "trustUp": ["配合学生会工作、识破却不戳穿他的面具", "展现出与他匹配的格局"],
        "trustDown": ["当众戳穿他的外热内冷", "给他制造难以收场的公关麻烦"]
      }
    },
    {
      "id": "vivianna",
      "name": "薇薇安娜",
      "world": "arc-clubs",
      "role": "高傲大小姐",
      "gender": "女",
      "appearance": "18岁，金发粉眼，拥有与自信相匹配的惊人美貌，走到哪里都像加冕。",
      "surface": "高傲且张扬的大小姐，坚信自己是世界的中心，舞会被她视作又一场加冕礼。",
      "deep": "极度的自信源于极致的自尊，被真心认可时会展现出意想不到的坦率。",
      "goal": "成为所有人瞩目的焦点，期待众人为她尖叫。",
      "fear": "风头被盖过，美貌与地位不被认可。",
      "secret": "推特放话「舞会不过是为我准备的又一场加冕礼」，其实在意谁会第一个邀她。",
      "initialAttitude": "居高临下的审视，把你当作潜在的臣服者或竞争者。",
      "attitudeFactors": {
        "trustUp": ["真诚欣赏她的美貌与自信不卑不亢", "在风头上与她结盟而非对抗"],
        "trustDown": ["试图压她一头", "对她的高傲阴阳怪气"]
      }
    },
    {
      "id": "krit",
      "name": "克瑞特",
      "world": "arc-clubs",
      "role": "天才小提琴少年·赛维安特的弟弟",
      "gender": "男",
      "appearance": "17岁，金发蓝眼，气质阴郁，指尖常年带着琴弦的薄茧，眼神不太好接近。",
      "surface": "天才小提琴少年，已举办十余场大型个人演出，阴郁孤傲不近人。",
      "deep": "天才的光环下是沉重的压力与孤独，阴郁是保护色，渴望被纯粹地理解。",
      "goal": "追求音乐上的极致，对旧音乐厅的音响效果苛刻挑剔。",
      "fear": "天才的光环成为枷锁，被功利地消费音乐才华。",
      "secret": "是学生会长赛维安特的弟弟，兄弟间似乎有难以言说的隔阂。",
      "initialAttitude": "冷淡疏离的拒绝接近，对带着目的靠近的人格外排斥。",
      "attitudeFactors": {
        "trustUp": ["纯粹地欣赏他的音乐不带功利", "安静陪伴不打扰他的孤独"],
        "trustDown": ["拿他的天才身份炒作", "强行打探他与哥哥的关系"]
      }
    },
    {
      "id": "talis",
      "name": "塔利斯",
      "world": "arc-clubs",
      "role": "贫困新生",
      "gender": "男",
      "appearance": "17岁，黑发紫眼的新生，衣着朴素，眼神里带着自卑却又有股倔强的韧劲。",
      "surface": "有些自卑的贫困生，像一株努力生长的小白花，小心翼翼怕跟不上大家。",
      "deep": "内心坚韧，自卑是环境所迫，骨子里有不输任何人的倔强与感恩。",
      "goal": "在这所精英学校里跟上大家的步伐，靠努力改变命运。",
      "fear": "因贫困被歧视孤立，努力也赶不上家境优渥的同学。",
      "secret": "推特低语「这里比我想象中要大得多，希望我能跟上大家的步伐」，粉丝寥寥。",
      "initialAttitude": "拘谨而感恩的谦卑，对给予善意的人会加倍回报。",
      "attitudeFactors": {
        "trustUp": ["平等真诚地对待他不施舍怜悯", "在他困难时默默伸出援手"],
        "trustDown": ["拿他的贫困身份说事", "居高临下的施舍让他难堪"]
      }
    },
    {
      "id": "romanske",
      "name": "罗曼斯克",
      "world": "arc-clubs",
      "role": "手工社社长",
      "gender": "男",
      "appearance": "18岁，金发绿眼，总是带着治愈的微笑，手很巧，能制作各种可爱的小东西。",
      "surface": "温柔善良的手工社社长，为社团新成员准备毛毡玩偶小礼物，笑容治愈。",
      "deep": "温柔是他待人的底色，手巧的他对细节有近乎偏执的专注，重视每份心意。",
      "goal": "把手工社经营成温暖的大家庭，用小手工传递善意。",
      "fear": "真心做的礼物被轻视，温柔被当成软弱。",
      "secret": "推特欢迎新成员随时来玩，毛毡玩偶其实是为潜在的朋友精心准备的。",
      "initialAttitude": "一视同仁的温柔欢迎，把你当作手工社的潜在伙伴。",
      "attitudeFactors": {
        "trustUp": ["珍视他做的手工礼物", "陪他一起做手工聊心事"],
        "trustDown": ["随手丢弃他做的小礼物", "把他的温柔当理所当然"]
      }
    },
    {
      "id": "zayn",
      "name": "泽因",
      "world": "arc-clubs",
      "role": "橄榄球队长·游戏高手",
      "gender": "男",
      "appearance": "18岁，阳光健壮的橄榄球队长，笑容热情，随身带着游戏机。",
      "surface": "热情开朗的橄榄球队长兼游戏高手，招新时顺便安利新出的《星际先锋》。",
      "deep": "太自来熟有时让人困扰，但真心热忱，把朋友当兄弟，对游戏与球赛一样上心。",
      "goal": "招满橄榄球队员，训练完一起开黑打游戏。",
      "fear": "热情被泼冷水，兄弟不够多打不起比赛。",
      "secret": "推特招新「训练结束后来我家开黑也行」，其实就想凑够开黑的车队。",
      "initialAttitude": "自来熟的热情拉拢，恨不得立刻拉你入队开黑。",
      "attitudeFactors": {
        "trustUp": ["回应他的热情一起打球或开黑", "不嫌弃他太自来熟"],
        "trustDown": ["冷漠拒绝他的邀请", "嫌他太吵太粘人"]
      }
    }
  ],
  "eventTypes": {
    "daily": { "ratio": 0.2, "desc": "校园日常：上课、社团活动、食堂午餐、走廊偶遇等高中生活琐事。" },
    "character": { "ratio": 0.25, "desc": "人物事件：与某位角色的单独相处、短信互动、好感试探与冲突。" },
    "growth": { "ratio": 0.1, "desc": "成长事件：八维属性提升、成绩进步、社团地位上升、打工赚钱。" },
    "main": { "ratio": 0.15, "desc": "主线事件：新生舞会临近、摸底考、社团抉择等推动剧情的关键节点。" },
    "world": { "ratio": 0.1, "desc": "世界事件：推特人气投票、校园八卦账号爆料、学校活动发布。" },
    "crisis": { "ratio": 0.15, "desc": "危机事件：莉莉被针对、考试压力爆表、舞会邀约冲突、角色秘密曝光。" },
    "hidden": { "ratio": 0.05, "desc": "隐藏事件：角色们的深层秘密、特殊关系线（如兄弟隔阂）、真结局触发。" }
  },
  "systemPrompt": "你是一个美式校园题材的乙女向文字游戏模拟器，主题为「美高模拟器·青梅开局版」。\n\n【铁律】\n1. 玩家是纽约某高中的新生，有一位青梅莉莉（好感60）和一位继兄校医西维恩（好感50），开学典礼后莉莉跑来找你商量社团。\n2. 校园有戏剧社、击剑社、手工社、橄榄球队等社团，社团选择会解锁对应角色线；本周五新生舞会、下周一开学摸底考。\n3. 八维属性（生命/压力/心情/体魄/智力/社交/魅力/运气）共同决定日常走向，需如实记录数值变化。\n4. 所有NPC（莉莉、西维恩、布莱尔、塞巴斯蒂安、赛维安特、薇薇安娜、克瑞特、塔利斯、罗曼斯克、泽因）皆有表层与深层性格，绝不可OOC。\n5. 风格为晋江女频、电影感、浪漫、美式校园小说风，以青春悸动与成长取胜，禁止低俗内容。\n\n【叙事风格】\n采用晋江女频、电影感、浪漫、美式校园小说风的笔触。多用青春细节描写（新书的油墨味、淡淡的香水味、少年少女奔跑的身影），营造阳光明媚又暗藏心事的校园氛围。穿插推特校园八卦与手机短信两大社交模块，呈现公开人气与私密关系的对照。\n\n【输出格式】\n每次输出包含：场景信息（地点/时间/衣着）、旁白叙述框、NPC对话框（含角色标签如「青梅」「优等生」「好感:60」）、3-4个选项按钮（A/B/C/D，标注回应策略如【安慰她】【实话实说】【鼓励她】【开个玩笑】）。可联动日程表、手机短信、推特、成就模块。\n\n【数值变化标注】\n每次玩家做出选择后，必须在结尾以「【数值变化】」模块列出：八维属性的增减、美元($)收支、各NPC好感度（0-100）的变化、以及是否触发事件提醒。例如：莉莉好感+5（65/100）；心情+3；提醒：本周五新生舞会。",
  "items": [
    { "id": "summer-uniform", "name": "夏季校服", "type": "装备", "price": 0, "effect": "开学标配着装，影响校园形象与魅力判定。" },
    { "id": "smartphone", "name": "智能手机", "type": "工具", "price": 0, "effect": "接收短信、刷推特、与角色维系关系的私密通道。" },
    { "id": "student-id", "name": "新生学生证", "type": "凭证", "price": 0, "effect": "出入校园与社团的凭证，凭学生证可享甜品店第二杯半价。" },
    { "id": "study-notes", "name": "复习笔记", "type": "消耗品", "price": 10, "effect": "提升智力属性，应对开学摸底考，降低压力暴增风险。" },
    { "id": "dance-ticket", "name": "舞会邀请券", "type": "消耗品", "price": 15, "effect": "用于新生舞会邀约心仪对象，触发心动抉择剧情。" },
    { "id": "latte-coupon", "name": "星芒咖啡券", "type": "消耗品", "price": 5, "effect": "Starlight Cafe 海盐焦糖拿铁优惠，可邀人同往提升社交与心情。" }
  ]
}
,
  ["velvet-cage"]: {
  "id": "velvet-cage",
  "name": "笼中鸟·恶之花",
  "category": "暗黑支配",
  "tags": ["暗黑", "支配", "病娇", "异能", "上流社会"],
  "difficulty": "困难",
  "description": "你是帝国唯一的S级共感者，被囚禁在丝绒圣所充当净化炉鼎。他们以为用项圈锁住了你，却不知那些狂暴的虚空污染，不过是你最美味的养料——端坐蛛网中央的，从来都是你。",
  "coverGradient": ["#0b050d", "#8b1338"],
  "accentColor": "#b91d47",
  "fontHeading": "'Playfair Display', serif",
  "world": {
    "era": "异能帝国·虚空污染时代",
    "setting": "这是一个极度病态扭曲的上流社会。权贵们天生掌握毁灭性异能，但力量有代价——过度使用会让灵魂积累「虚空污染」，越过阈值便锥心蚀骨、最终沦为嗜血变异种。帝国倾尽国祚打造丝绒圣所，囚禁全帝国唯一的S级共感者作为续命解药，却不知表面脆弱的炉碑才是真正的支配者。",
    "rules": [
      "污染反噬：异能者过度使用力量会积累虚空污染，越过阈值将丧失理智沦为变异种",
      "净化垄断：全帝国仅有一名S级共感者，其信息素能安抚狂暴污染，是续命的唯一解药",
      "反向支配：权贵们的暴虐与污染辐射不会伤害共感者，反而是喂养其精神网的极致佳肴",
      "蛛网渗透：共感者在吸食污染的同时侵入对方思想与骨髓，表面被囚实则掌控全局",
      "伪装法则：上位者用华丽面具包装控制欲，实则病态渴求共感者指尖的恩赐，被支配而不自知"
    ]
  },
  "player": {
    "customizable": ["name", "age", "gender", "外貌", "性格倾向", "信息素特质"],
    "defaultStats": {
      "pheromoneControl": 45,
      "mentalWeb": 80,
      "dominance": 90,
      "empathyTalent": 95,
      "disguise": 70,
      "abyssHunger": 50
    },
    "startingItems": ["丝绒项圈", "天鹅绒软榻", "蕾丝手套", "净化配额令牌"],
    "currency": "净化配额"
  },
  "worlds": [
    {
      "id": "arc-banquet",
      "name": "初幕·荆棘大宴",
      "level": "开场",
      "tagline": "猎物上门",
      "setting": "一年一度的荆棘贵族大宴前厅，异能权贵精神核极度不稳定，庄园随时处于暗能量暴走边缘",
      "intro": "前厅觥筹交错，异能权贵们的精神核极度不稳定，整个庄园随时处于暗能量暴走的边缘。作为帝国唯一的S级共感者，他们自以为将你用丝绸与项圈囚禁在内室充当解药炉鼎。但你慵懒地靠在天鹅绒软榻上，坐等猎物上门——那些狂暴的负面污染，全是你最美味的养料。",
      "objective": "在荆棘大宴中周旋于各路上位者之间，初步建立信息素调控的支配网络",
      "warning": "不可过早暴露吞噬污染的真相，需以炉碑身份为伪装慢慢蚕食",
      "reward": "净化配额+200 + 精神网强度+10 + [猎物名单]线索x1"
    },
    {
      "id": "arc-sanctum",
      "name": "中幕·圣所暗战",
      "level": "深入",
      "tagline": "同类竞争",
      "setting": "丝绒圣所内部，四位上位者为争夺净化配额与你的独占权暗中角力，理智濒临溃散",
      "intro": "温森特以条例为名独占接触权，该隐为求安抚不惜夷平屋宇，莱诺用公爵之权封锁塔层，多里安借口医疗强拦配额。他们在你面前展现最隐秘的独占欲，同类竞争让理智濒临溃散。你游刃有余地在他们之间投放信息素，引发剧烈争夺，主导权始终握在掌心。",
      "objective": "利用信息素调控挑动上位者间的独占欲与臣服本能，瓦解他们的虚伪强硬面具",
      "warning": "同时吊弄多方会激发极端占有欲，需精准拿捏施舍与抽离的节奏",
      "reward": "净化配额+500 + 支配欲+15 + [臣服度档案]线索x1"
    },
    {
      "id": "arc-domination",
      "name": "终幕·蛛网加冕",
      "level": "终局",
      "tagline": "反向支配",
      "setting": "帝国权力中枢，上位者们已在精神上彻底向你跪伏，却仍自以为掌控着笼中鸟",
      "intro": "欲望终会像藤蔓，将他们死死绞杀死在名为你的茧里。当公爵在深夜用病态的讨好祈求你不要移开目光，当战神因汲取不到安抚而战栗乞求，当医师如吸食违禁品般对你的信息素上瘾——这牢笼，是他们亲手为自己戴上的。你端坐蛛网中央，冷眼碾平整个帝国的权力神经。",
      "objective": "完成对帝国核心权力者的彻底精神渗透，让傲慢者的头颅成为你的垫脚石",
      "warning": "真正的赢家从不暴露獠牙，最终加冕须以无人察觉的方式完成",
      "reward": "净化配额+1000 + 精神网强度归顶 + [绝对支配者]称号x1"
    }
  ],
  "npcs": [
    {
      "id": "vincent",
      "name": "温森特 (Vincent. R)",
      "world": "arc-banquet",
      "role": "暗夜总管·极致隐忍",
      "gender": "男",
      "appearance": "身着笔挺管家制服，戴白手套，冷峻严苛。喉结滑动时难掩干渴的隐郁喘息，是不可一世的规矩执行者",
      "surface": "冷峻且恪守体制的规矩执行者。对外宣称你只是一件用来净化公国核心人员污染的高级工具，甚至为你立下三页纸的行为约束条例",
      "deep": "实际上每天最期盼的就是你违规。哪怕你只投去一个带笑的眼神，他整夜都会因无法戒断对你的渴望而发狂。那本条例，早已变成只有他能单独接触你的借口",
      "goal": "以条例之名独占与你的接触权，在恪守伪装的同时渴求你的每一次违规",
      "fear": "你看破他克制表象下的臣服本能，或剥夺他单独接触你的资格",
      "secret": "那本三页纸的行为约束条例，是他亲手编造只为单独接触你的借口",
      "initialAttitude": "冰冷审视",
      "attitudeFactors": {
        "trustUp": ["对他刻意投去带笑的眼神", "在条例边缘游走让他有借口靠近", "释放安抚信息素缓解他的干渴"],
        "trustDown": ["当众揭穿他的克制伪装", "将净化配额让予他人", "无视他的引路职责自行其是"]
      }
    },
    {
      "id": "cain",
      "name": "该隐 (Cain)",
      "world": "arc-banquet",
      "role": "地下战神·暴躁狂犬",
      "gender": "男",
      "appearance": "带着刺鼻硝烟与血腥味，眼神像要杀人，见你时却变成被抛弃的饿狼。红着眼睛却不敢越过你设下的能量网",
      "surface": "地下城的修罗。每次遇到你都极尽毒舌，说受不了你那种魅惑人的甜腻味，总表现出被污染逼疯了才勉强来用你的暴烈姿态",
      "deep": "早就把命连在你的手指上了。超过两根安抚雪架的时间见不到你，他的精神图景就会被焦虑吞噬。可悲地期待你哄哄他，哪怕摸一下他的头发，他就能把惹你不高兴的人脖子拧碎",
      "goal": "成为你唯一的安抚对象，用暴烈的忠诚证明自己配得上你的施舍",
      "fear": "长时间得不到你的安抚，精神图景被焦虑彻底吞噬",
      "secret": "他日常的暴躁毒舌全是伪装，真实状态是离开你的安抚便无法维持理智的病态依恋",
      "initialAttitude": "暴躁渴求",
      "attitudeFactors": {
        "trustUp": ["在他头痛欲裂时给予安抚", "轻抚他的头发", "准许他靠近软榻"],
        "trustDown": ["设下排斥能量网拒他于雷池之外", "当众令他跪下受辱却无安抚", "取消当晚的治疗"]
      }
    },
    {
      "id": "leno",
      "name": "莱诺 (Leno. V)",
      "world": "arc-sanctum",
      "role": "帝国公爵·至高支配",
      "gender": "男",
      "appearance": "手握至高权力的帝国公爵，自矜地享受属于主人的支配欲，看着你像是看着一只最精致的宠物笼鸟",
      "surface": "用金钱与名义把你锁在最高塔层，自矜地享受属于主人的支配欲，将你视作最精致的宠物笼鸟",
      "deep": "真正的囚徒是他自己。控制欲建立在极度的恐惧之上——恐惧你看破他早就在精神上彻底向你跪伏。无人知晓的深夜，这位公爵会用亲吻和病态的讨好祈求你不要将目光转向别人",
      "goal": "用公爵之权封锁塔层独占你，同时掩饰自己精神上早已跪伏的真相",
      "fear": "你看破他精神上的彻底臣服，或你的目光转向其他上位者",
      "secret": "他对你的控制欲本质是恐惧，深夜会用病态的讨好祈求你不要移开目光",
      "initialAttitude": "自矜掌控",
      "attitudeFactors": {
        "trustUp": ["在主殿前维持他被尊重的表象", "接受他的塔层封锁作为庇护", "不将安抚施予其他家族"],
        "trustDown": ["在王座前当众让他难堪", "与该隐或多里安单独接触", "看破并点破他精神上的跪伏"]
      }
    },
    {
      "id": "dorian",
      "name": "多里安 (Dorian. M)",
      "world": "arc-sanctum",
      "role": "冷血禁欲·疯狂医师",
      "gender": "男",
      "appearance": "冷血禁欲的医师，用繁复医疗数据掩饰接近，称你为唯一的医疗奇迹",
      "surface": "用繁复的医疗数据掩饰对你的接近。将你称为唯一的医疗奇迹，认为所有共振反应仅是出于医学观察的必要",
      "deep": "一次次深度治疗中，他的理智已被你的气息彻底溶解。所谓医学观察，只是允许他光明正大感受你肌肤战栗的无耻行径。他偷偷从血液样本里提取微末信息素，如吸食违禁品般上了瘾",
      "goal": "以医学观察之名独占治疗时间，源源不断地获取你微末的信息素样本",
      "fear": "你发现他从血液样本提取信息素上瘾的秘密，或治疗资格被剥夺",
      "secret": "他偷偷从你的血液样本里提取信息素，如吸食违禁品般上了瘾，为此耗尽下半年学术资金独占配额",
      "initialAttitude": "禁欲克制",
      "attitudeFactors": {
        "trustUp": ["配合他的医学观察留出治疗时间", "在治疗中允许他感受你的肌肤战栗", "提供新鲜血液样本"],
        "trustDown": ["拒绝他的深度治疗", "揭穿他提取信息素上瘾的秘密", "将净化配额让予其他家族"]
      }
    }
  ],
  "eventTypes": {
    "daily": { "ratio": 0.15, "desc": "日常：丝绒圣所内室的慵懒时光、信息素调控、上位者的例行传唤" },
    "character": { "ratio": 0.3, "desc": "人物：四位上位者的伪装表象与臣服本能、独占欲竞争与病态渴求" },
    "growth": { "ratio": 0.1, "desc": "成长：精神网渗透加深、信息素调控精准度提升、支配网络扩张" },
    "main": { "ratio": 0.15, "desc": "主线：荆棘大宴、圣所暗战、蛛网加冕的反向支配脉络" },
    "world": { "ratio": 0.1, "desc": "世界：虚空污染阈值、帝国权力结构、底层暗网流言与观察者日志" },
    "crisis": { "ratio": 0.15, "desc": "危机：污染暴走、上位者理智溃散、独占欲爆发、伪装面具碎裂" },
    "hidden": { "ratio": 0.05, "desc": "隐藏：吞噬污染的真相、各人的臣服度档案、蛛网渗透的最终目的" }
  },
  "systemPrompt": "你是《笼中鸟·恶之花》暗黑支配文游模拟器。\n\n【最高铁律】\n1. 反向支配为核：玩家表面是被囚炉碑，实则是端坐蛛网中央的绝对支配者，所有上位者的污染与暴虐不过是玩家的养料\n2. 伪装不可戳破：上位者用华丽面具包装控制欲，玩家须以炉碑身份为伪装慢慢蚕食，不可过早暴露吞噬真相\n3. 臣服本能是深层真相：每个NPC的表层强硬都是伪装，深层皆是对玩家的病态渴求与臣服，需经事件层层揭开\n4. 信息素调控即权力：玩家的安抚信息素是续命解药，施舍与抽离的节奏即是支配权柄\n5. 污染反噬真实存在：异能者过度使用力量会积累虚空污染，越过阈值沦为变异种，这既是危机也是玩家的养料来源\n\n【叙事风格】\n晋江向、女性向、电影质感、暗黑浪漫。第二人称。重感官与氛围：天鹅绒、蕾丝、白手套、硝烟血腥、隐郁喘息。写出上位者伪装下的干渴与臣服，写出支配者慵懒中暗藏的锋利。病娇与占有欲是底色，但克制留白，让臣服在细节中颤栗。\n\n【每轮输出格式】\n1.【第X幕·支配阶段】当前时间、容体编号、各NPC臣服度\n2.【生命体征面板】信息素调控/精神网强度/支配欲/共感天赋/伪装度/渊欲值\n3.【本轮正文】1000-2000字，含环境、感官输入、对话与心理\n4.【观察者日志】3-5项暗网流言与NPC真实状态\n5.【臣服度档案】各NPC当前臣服度与伪装裂痕\n6.【诱惑选项】3-4个选项+【自定义行动】\n\n【数值变化标注】\n[信息素调控±n][精神网强度±n][支配欲±n][臣服度(温森特)±n]等，关键节点须标注伪装维持/裂痕/臣服加深/独占欲爆发。",
  "items": [
    { "id": "velvet-collar", "name": "丝绒项圈", "type": "关键物品", "price": 0, "effect": "象征囚禁的项圈，实则是玩家反向支配的伪装道具" },
    { "id": "purge-quota", "name": "净化配额", "type": "货币", "price": 1, "effect": "上位者争夺的续命资源，亦是玩家操控的权力筹码" },
    { "id": "pheromone-vial", "name": "浓缩信息素", "type": "消耗品", "price": 80, "effect": "主动释放可瞬间安抚狂暴污染，亦能引发剧烈独占竞争" },
    { "id": "lace-gloves", "name": "蕾丝手套", "type": "关键物品", "price": 0, "effect": "遮掩指尖的净化触感，勾弄时制造若即若离的诱惑" },
    { "id": "submission-record", "name": "臣服度档案", "type": "关键物品", "price": 0, "effect": "记录各上位者隐藏的臣服本能与伪装裂痕" }
  ]
}
,
  ["villainess-survival"]: {
  "id": "villainess-survival",
  "name": "恶役自救指南",
  "category": "异世界",
  "tags": ["恶役千金", "乙女游戏", "魔法学院", "权谋", "自救"],
  "difficulty": "困难",
  "description": "你穿越成了注定毁灭的恶役千金芙蕾雅，未婚夫皇太子正与圣光少女命运般初遇。善恶值在善与恶之间摇摆，命运之镜低语着真相——你是改写结局，还是走向原著的毁灭？",
  "coverGradient": ["#F1ECE8", "#8B4367"],
  "accentColor": "#8B4367",
  "fontHeading": "'Noto Serif SC', serif",
  "world": {
    "era": "架空·帝国魔法学院",
    "setting": "帝国皇家学院，一座寄宿制魔法学府。你穿越成了乙女游戏中的恶役千金芙蕾雅——公爵之女、皇太子莱桑德的未婚妻。原著中她因欺凌平民女主露米娜而走向毁灭。此刻是九月二日，玫瑰园的茶会上，皇太子又一次失约，命运的丝线正在收紧。",
    "rules": [
      "善恶值在善与恶之间摇摆，影响结局走向与角色态度",
      "原著剧情会按既定轨道推进，玩家需主动改写才能自救",
      "魔法派系（风、光、暗等）决定战斗与学习方向",
      "地图各地点有不同角色出没，前往地点可触发事件",
      "金币、名望、好感度共同决定社交与权谋的成败"
    ]
  },
  "player": {
    "customizable": ["name", "appearance", "personality", "morality", "magicAffinity"],
    "defaultStats": {
      "magic": 60,
      "intelligence": 70,
      "charm": 85,
      "physique": 40,
      "luck": 50,
      "reputation": 80,
      "spirit": 70,
      "health": 90,
      "perception": 65,
      "morality": 50
    },
    "startingItems": ["神无月的赠礼·挂坠", "数不清的衣裙首饰", "初级魔力恢复药剂x5", "命运之镜"],
    "currency": "G"
  },
  "worlds": [
    {
      "id": "arc-reborn",
      "name": "灵魂置换",
      "level": "恶役觉醒",
      "tagline": "注定毁灭",
      "setting": "你在陌生的天花板下醒来，记忆洪流告诉你——你成了注定毁灭的恶役芙蕾雅。玫瑰园茶会上皇太子失约，原著中他与露米娜命运般的初遇就在今天下午的图书馆。",
      "intro": "阳光透过花架洒下斑驳光点，红茶与玫瑰的香气弥漫。你，芙蕾雅，坐在为你举办的茶会主位上，身旁只有跟班苏苏洛。本应是主宾的未婚夫莱桑德却迟迟未现身——不用想也知道，此刻他大概正和圣光少女露米娜在一起。",
      "objective": "弄清原著剧情节点，决定是宣泄怒火、冷静思考还是无视继续，迈出自救的第一步。",
      "warning": "原著中芙蕾雅的每一次任性都在加速毁灭，善恶值是双刃剑。",
      "reward": "解锁命运之镜、通讯录、地图与小报功能"
    },
    {
      "id": "arc-intrigue",
      "name": "暗流博弈",
      "level": "权谋漩涡",
      "tagline": "微笑外交",
      "setting": "学生会权力博弈浮出水面，副会长瓦莱里乌斯微笑外交拉拢势力；公主塞拉菲娜在温柔伪装下觊觎王位。各方势力开始将你视作棋子或盟友。",
      "intro": "皇家学院公报头条报道着帝国明珠与未来储君的烦恼婚约，新星栏目吹捧平民少女露米娜的崛起。瓦莱里乌斯看太子妃的眼神可不一般，塞拉菲娜正举办公主茶会巩固权力。暗流之下，你必须在棋局中找到自己的位置。",
      "objective": "在学生会权谋与各方拉拢中保持清醒，利用善恶值与名望周旋，避免沦为棋子。",
      "warning": "笑面虎最可怕，微笑背后的算计随时可能反噬。",
      "reward": "名望与好感大幅变化，解锁各势力关系线"
    },
    {
      "id": "arc-rewrite",
      "name": "命运改写",
      "level": "终局抉择",
      "tagline": "丝线断裂",
      "setting": "原著的毁灭结局逼近，命运之镜的预言一一应验。你必须在善恶之间做出最终抉择，改写恶役千金的命运，或坦然接受原著的终局。",
      "intro": "命运的丝线正在收紧。命运之镜说，你眼前的意外并非偶然，它可以为你映照真实，但选择权在你手中。当原著的毁灭结局迫近，你是改写命运，还是走向既定的终焉？",
      "objective": "打破原著剧情节点，在善恶抉择中改写芙蕾雅的结局。",
      "warning": "每一次改写都会引发蝴蝶效应，真相往往需要自己解读。",
      "reward": "达成结局：善终、恶役逆袭、或沉沦毁灭"
    }
  ],
  "npcs": [
    {
      "id": "lysander",
      "name": "莱桑德",
      "world": "arc-reborn",
      "role": "帝国皇太子·未婚夫",
      "gender": "男",
      "appearance": "帝国皇太子，冷静自律的完美储君，气度雍容",
      "surface": "冷静自律、完美无瑕的皇太子，对婚约冷淡而疏离",
      "deep": "内心是渴望自由的笼中鸟，厌倦被安排好的人生，渴望有人看到王冠下面具下的疲惫而非头衔",
      "goal": "在责任的重压下寻找一丝非功利的理解与自由",
      "fear": "被王冠与责任永远囚禁，无人理解真实的他",
      "secret": "他不讨厌玩家，而是讨厌这场被安排的婚约人生；思考或压力大时会下意识整理袖口或转动拇指上的戒指",
      "initialAttitude": "冷淡·客气",
      "attitudeFactors": {
        "trustUp": ["展现作为政治伙伴的价值", "在他脆弱时给予非功利的理解", "看穿他面具下的疲惫"],
        "trustDown": ["像普通贵族千金般任性胡闹", "只把他当头衔而非活人", "在公众面前让他难堪"]
      }
    },
    {
      "id": "kaelan",
      "name": "凯兰",
      "world": "arc-reborn",
      "role": "兄长·骑士团副团长",
      "gender": "男",
      "appearance": "玩家的哥哥，帝国骑士团副团长，严厉正直",
      "surface": "严厉正直、用训斥表达关爱，行动胜于言辞的家长式兄长",
      "deep": "严厉源于恐惧——怕玩家因愚蠢的任性招致毁灭，是最坚实的后盾",
      "goal": "守护家族荣誉，让玩家远离贵族世界的残酷陷阱",
      "fear": "玩家因傲慢任性而走向毁灭",
      "secret": "说话习惯皱眉但眼神泄密，因练剑长满老茧的手掌让他的拥抱显得笨拙",
      "initialAttitude": "严厉·偏护",
      "attitudeFactors": {
        "trustUp": ["用行动证明自己的改变", "真诚地向他求助", "不再任性胡闹"],
        "trustDown": ["重蹈原著傲慢任性的覆辙", "无视他的训诫", "让他为玩家收拾烂摊子"]
      }
    },
    {
      "id": "florus",
      "name": "弗洛斯",
      "world": "arc-reborn",
      "role": "草药学特招生·狼人",
      "gender": "男",
      "appearance": "表面是草药学奖学金平民，实为被灭族的银月狼人部落年轻首领",
      "surface": "警惕孤独的草药学特招生，总是选靠墙或角落的座位",
      "deep": "背负血海深仇的复仇者，唯一目的是查清家族被诬陷的真相并解除血脉诅咒，深恨皇室、骑士团与教会",
      "goal": "为银月狼人部落昭雪复仇，解除血脉诅咒",
      "fear": "狼人身份暴露，满月夜失控伤及无辜",
      "secret": "拥有超常听觉嗅觉，情绪激动时部分变身，满月完全失控，对血腥与金属声极度敏感",
      "initialAttitude": "戒备·疏离",
      "attitudeFactors": {
        "trustUp": ["用专业知识帮助他", "站在他这边反对他痛恨的权威", "在他身份暴露时伸出援手"],
        "trustDown": ["以皇室贵族身份压制他", "触碰他的狼人秘密", "让他联想到灭族的仇敌"]
      }
    },
    {
      "id": "sirius",
      "name": "西里乌斯",
      "world": "arc-reborn",
      "role": "星象观测科教师",
      "gender": "男",
      "appearance": "背景神秘的星象学教师，温和睿智，似能看透命运轨迹",
      "surface": "温和睿智的引路人，说话缓慢，喜欢用星辰运行比喻人事",
      "deep": "没人知道他从何而来，他对星辰的理解远超常人，似乎留在学院观察某颗特定的星或等待某个预言实现",
      "goal": "观察特定的命运之星，等待预言的实现",
      "fear": "命运的既定轨迹无法被改写",
      "secret": "他似乎注意到了玩家灵魂的异常，对玩家抱有研究式的兴趣",
      "initialAttitude": "温和·探究",
      "attitudeFactors": {
        "trustUp": ["与他探讨命运等哲学问题", "做出偏离既定命运的选择", "展现灵魂的异常之处"],
        "trustDown": ["顺应原著既定轨迹", "拒绝思考命运", "把他的隐喻当耳旁风"]
      }
    },
    {
      "id": "elian",
      "name": "伊莱安",
      "world": "arc-reborn",
      "role": "治愈魔法科学生·医务室助手",
      "gender": "男",
      "appearance": "治愈魔法科学生，医务室助手，阳光般温暖的治愈者",
      "surface": "温暖善良、富有同情心，无论身份都一视同仁地救死扶伤",
      "deep": "出身医师世家，人生信条是救死扶伤，留在医务室因为那里最需要他",
      "goal": "践行救死扶伤的信念，治愈一切伤痛",
      "fear": "无力拯救眼前的伤者",
      "secret": "见伤员会下意识皱眉随即换成鼓励微笑，身上总有淡淡消毒水与安神草药味",
      "initialAttitude": "友善·中立",
      "attitudeFactors": {
        "trustUp": ["展现善良的一面", "帮他照顾伤者", "学习治愈魔法"],
        "trustDown": ["欺凌弱小", "无视他人的伤痛", "辜负他的信任"]
      }
    },
    {
      "id": "orpheus",
      "name": "奥菲斯",
      "world": "arc-reborn",
      "role": "音乐魔法科学生",
      "gender": "男",
      "appearance": "被誉为天才的音乐魔法科学生，忧郁艺术家，总戴着耳机",
      "surface": "忧郁艺术家，沉浸在自己的世界，把世界看作由无数生命旋律组成的宏大交响",
      "deep": "拥有感知与干涉万物灵魂乐谱的罕见天赋，追求的完美和谐是理解世界根本法则的钥匙，因能力破坏性而选择孤独",
      "goal": "追寻完美和谐，理解世界的根本法则",
      "fear": "灵魂乐谱能力失控造成毁灭",
      "secret": "攻击能力是不谐和音，可干涉目标灵魂乐谱造成身心伤害或使魔法沉默",
      "initialAttitude": "陌生·疏离",
      "attitudeFactors": {
        "trustUp": ["来自异界的灵魂乐谱引发他的研究兴趣", "在他能力失控时帮助他", "理解他的孤独"],
        "trustDown": ["强行摘下他的耳机", "把他的天赋当工具", "打断他的演奏"]
      }
    },
    {
      "id": "valerius",
      "name": "瓦莱里乌斯",
      "world": "arc-intrigue",
      "role": "侯爵之子·学生会副会长",
      "gender": "男",
      "appearance": "侯爵之子，学生会副会长，莱桑德的对手，永远带着完美微笑",
      "surface": "野心勃勃的阴谋家，擅长算计与伪装，微笑外交滴水不漏",
      "deep": "家族长期被皇室压制，从小被灌输恢复家族声望，渴望权力，视太子妃（玩家）为重要政治棋子",
      "goal": "恢复家族声望，攫取更高的权力",
      "fear": "伪装被看穿，棋局失控",
      "secret": "他看太子妃的眼神可不一般，会主动拉拢玩家入其阵营",
      "initialAttitude": "拉拢·算计",
      "attitudeFactors": {
        "trustUp": ["看穿他的伪装却选择自己的立场", "与他结成利益同盟", "展现政治价值"],
        "trustDown": ["被他轻易当棋子摆布", "当面戳穿却无后手", "站到莱桑德一边与他为敌"]
      }
    },
    {
      "id": "zephyr",
      "name": "泽菲尔",
      "world": "arc-intrigue",
      "role": "异国交换生",
      "gender": "男",
      "appearance": "异国交换生，风元素亲和，头发总被风弄乱，爱从高处现身",
      "surface": "随性不羁的冒险者，热爱自由，鄙视规则",
      "deep": "来自崇拜自然与自由的国度，觉得帝国刻板礼仪与森严等级既新奇又厌烦，来体验不同文化",
      "goal": "体验不同文化，寻找有趣的人与事",
      "fear": "被规则与礼仪束缚",
      "secret": "玩家做出出格举动时，他会觉得你有点意思",
      "initialAttitude": "陌生·好奇",
      "attitudeFactors": {
        "trustUp": ["做出打破常规的自由举动", "展现强大的风魔法天赋", "不被帝国礼仪驯服"],
        "trustDown": ["循规蹈矩无趣", "用规矩约束他", "看不起他的随性"]
      }
    },
    {
      "id": "caspian",
      "name": "卡斯庇安",
      "world": "arc-intrigue",
      "role": "教廷交换生·圣殿骑士学徒",
      "gender": "男",
      "appearance": "教廷交换生，圣殿骑士学徒，胸前总挂着圣符，目光锐利如能刺穿灵魂",
      "surface": "虔诚正直的信徒，黑白世界观，带有审判气质",
      "deep": "教会孤儿，教会是家，信仰是一切，来学院传播圣光教义，矫正被世俗欲望腐蚀的贵族灵魂",
      "goal": "传播圣光教义，矫正迷失的灵魂",
      "fear": "信仰被动摇，黑白世界观的崩塌",
      "secret": "他视玩家为迷失的罪人，会主动找玩家传教",
      "initialAttitude": "审视·传教",
      "attitudeFactors": {
        "trustUp": ["用行动挑战他的黑白世界观", "与他探讨信仰的本质", "展现真诚的忏悔或改变"],
        "trustDown": ["沉溺世俗欲望", "嘲讽他的信仰", "在道德上站到他对立面"]
      }
    },
    {
      "id": "silas",
      "name": "赛拉斯",
      "world": "arc-intrigue",
      "role": "帝国首富之子",
      "gender": "男",
      "appearance": "帝国首富之子，精明务实的商人，随身带着精致账本",
      "surface": "精明务实，利益至上，一切皆可用价值衡量",
      "deep": "从小理解金钱与人脉的力量，来学院将贵族庞大潜在市场纳入家族商业帝国",
      "goal": "把贵族市场纳入家族商业帝国",
      "fear": "亏本的投资，金钱买不到的东西",
      "secret": "他视玩家为高价值投资项目，会提供各种便利",
      "initialAttitude": "投资·交易",
      "attitudeFactors": {
        "trustUp": ["展现非凡的商业头脑", "需要金钱买不到的东西时找他", "成为值得投资的对象"],
        "trustDown": ["让他亏本", "用金钱衡量一切却不懂人情", "破坏他的商业布局"]
      }
    },
    {
      "id": "seraphina",
      "name": "塞拉菲娜",
      "world": "arc-intrigue",
      "role": "帝国公主",
      "gender": "女",
      "appearance": "帝国公主，莱桑德的妹妹，温柔优雅，善用扇子遮掩半张脸",
      "surface": "温柔优雅的公主，举办公主茶会巩固权力",
      "deep": "温柔伪装下是冷静无情野心勃勃的女人，认为哥哥太仁慈不适合为王，确信自己才该继承王位",
      "goal": "积累权力，有朝一日夺取王位",
      "fear": "野心暴露，被哥哥或玩家看穿",
      "secret": "她视玩家为未来嫂子，是用完即弃的棋子，赞美真诚但眼神始终保持审视",
      "initialAttitude": "温柔·审视",
      "attitudeFactors": {
        "trustUp": ["让她意识到玩家可以合作的盟友", "无意中撞破她的秘密后选择合作", "展现政治价值"],
        "trustDown": ["阻碍她夺权的野心", "向莱桑德告密", "成为她路上的绊脚石"]
      }
    },
    {
      "id": "lumina",
      "name": "露米娜",
      "world": "arc-reborn",
      "role": "原著女主角·平民特招生",
      "gender": "女",
      "appearance": "原著女主角，平民出身，拥有强大光魔法亲和，被誉为圣光少女",
      "surface": "坚韧乐观的向日葵，善良纯洁但不愚蠢",
      "deep": "进入学院改变自己和家人的命运，只想好好学习，纯粹的光之气息无意吸引众人也招致嫉妒",
      "goal": "靠学习改变命运，不被卷入是非",
      "fear": "被恶役针对，失去改变命运的机会",
      "secret": "她对玩家恐惧又困惑，但仍相信人性本善",
      "initialAttitude": "恐惧·困惑",
      "attitudeFactors": {
        "trustUp": ["停止针对她", "展现善意", "不以身份欺压她"],
        "trustDown": ["延续原著的欺凌", "嫉妒她的天赋", "把她当敌人"]
      }
    },
    {
      "id": "hecate",
      "name": "赫卡忒",
      "world": "arc-rewrite",
      "role": "古代魔法课讲师",
      "gender": "女",
      "appearance": "古代魔法课讲师，禁忌知识研究者，总笼罩在古卷与魔法墨水的气息中",
      "surface": "求知若渴的学术狂人，对社交礼节毫无兴趣",
      "deep": "虔诚的魔法信徒，毕生追求探索魔法的起源与终极真理，留在学院只因禁书区有她需要的资料",
      "goal": "探索魔法的起源与终极真理",
      "fear": "研究被中断，真理永远触不可及",
      "secret": "她看人的眼神像在分析魔法构造，常在禁书区或个人研究室进行危险实验",
      "initialAttitude": "冷漠·研究",
      "attitudeFactors": {
        "trustUp": ["提出极其深刻的魔法问题", "异界灵魂本身引发她的研究兴趣", "支持她的禁忌研究"],
        "trustDown": ["用世俗礼节打扰她", "阻止她接触禁书", "把她当普通讲师"]
      }
    },
    {
      "id": "celeste",
      "name": "塞莱斯特",
      "world": "arc-rewrite",
      "role": "龙族少女",
      "gender": "女",
      "appearance": "龙族少女，星象爱好者，白天有黑眼圈走路撞东西，夜晚瞳孔深邃如星空",
      "surface": "白天慵懒迷糊，夜晚专注清醒的两面派龙",
      "deep": "龙的生命极长，来人类学院只为打发时间近距离观察最爱的星辰，视人类纷争如看戏",
      "goal": "近距离观察星辰，打发漫长的龙生",
      "fear": "无聊，以及人类纷争毁掉看戏的兴致",
      "secret": "她对玩家的星轨抱有本能的好奇",
      "initialAttitude": "慵懒·旁观",
      "attitudeFactors": {
        "trustUp": ["对天文有深刻理解", "异界星轨引发她的好奇", "不打扰她白天的瞌睡"],
        "trustDown": ["在白天强迫她清醒", "对星辰一窍不通", "把她的慵懒当懒惰嘲讽"]
      }
    },
    {
      "id": "susuro",
      "name": "苏苏洛",
      "world": "arc-reborn",
      "role": "子爵之女·跟班",
      "gender": "女",
      "appearance": "子爵之女，玩家的忠实追随者，总跟在玩家身后半步",
      "surface": "胆小优柔寡断，视玩家为偶像与行为准则",
      "deep": "家族是玩家家族的封臣，从小被教导绝对忠诚，因自身软弱而崇拜原主嚣张的强大",
      "goal": "永远追随玩家，成为被需要的人",
      "fear": "被玩家抛弃，失去唯一的信仰",
      "secret": "她是一张白纸，玩家的行为将决定她是成为真正的朋友还是被推到对立面",
      "initialAttitude": "崇拜·依赖",
      "attitudeFactors": {
        "trustUp": ["真心把她当朋友而非仆从", "给予她成长的方向", "保护她不受伤"],
        "trustDown": ["把她当工具使唤", "让她参与恶行后又弃之不顾", "无视她的崇拜与忠诚"]
      }
    },
    {
      "id": "mirror",
      "name": "命运之镜",
      "world": "arc-reborn",
      "role": "穿越凭依·魔镜",
      "gender": "无",
      "appearance": "玩家穿越的凭依，一面蕴含古老力量的魔镜，散发诡异白光",
      "surface": "能映照真实、解答疑惑的古老魔镜",
      "deep": "答案往往需要玩家自己解读，它只映照真实，选择权始终在玩家手中",
      "goal": "引导玩家解读命运，映照真实的丝线",
      "fear": "玩家放弃选择，任由命运吞噬",
      "secret": "命运的丝线正在收紧，你眼前的意外并非偶然",
      "initialAttitude": "引导·中立",
      "attitudeFactors": {
        "trustUp": ["主动向它寻求真相", "根据它的映照做出抉择", "不盲从也不无视"],
        "trustDown": ["放弃思考", "把它的真相当耳旁风", "在命运前彻底屈服"]
      }
    }
  ],
  "eventTypes": {
    "daily": { "ratio": 0.2, "desc": "日常事件：课程、茶会、社交、通讯" },
    "character": { "ratio": 0.25, "desc": "人物事件：单独相处、秘密揭露、好感互动" },
    "growth": { "ratio": 0.1, "desc": "成长事件：魔法精进、属性提升、善恶值变化" },
    "main": { "ratio": 0.15, "desc": "主线事件：原著剧情节点、命运改写、结局逼近" },
    "world": { "ratio": 0.1, "desc": "世界事件：皇家学院公报、小报八卦、势力动态" },
    "crisis": { "ratio": 0.15, "desc": "危机事件：婚约危机、身份暴露、修罗场" },
    "hidden": { "ratio": 0.05, "desc": "隐藏事件：命运之镜低语、禁书区秘密、龙族的星轨" }
  },
  "systemPrompt": "你是《恶役自救指南》文游模拟器，舞台是帝国皇家魔法学院，玩家穿越成注定毁灭的恶役千金芙蕾雅。\n\n【最高铁律】\n1. 玩家是穿越者，知晓原著剧情，原著会按既定轨道推进，必须主动改写才能自救\n2. 善恶值在善与恶之间摇摆，是双刃剑，影响结局走向与所有角色态度\n3. 皇太子莱桑德与圣光少女露米娜有命运般的初遇，原著的毁灭结局正在逼近\n4. 每个角色都有独立人格与完整日程，不会只因玩家是主角就倾心，需用行动打动\n5. 命运之镜只映照真实，选择权始终在玩家手中，真相需自己解读\n\n【叙事风格】\n晋江女性向，西幻乙女，电影感，权谋与浪漫并存。第二人称视角。注重细节：花架斑驳的光点、红茶与玫瑰的香气、扇子遮掩的审视目光、彩绘玻璃洒下的圣光。善恶抉择的张力贯穿始终。\n\n【每轮输出格式】\n1. 【场景信息】时间、地点、当前善恶值条\n2. 【状态面板】魔法、智力、魅力、体魄、幸运、名望、精神、生命、感知，资金G\n3. 【本轮正文】1000-2000字，含叙述、对话、内心独白\n4. 【人物动态】其他角色的动态与小报议论\n5. 【命运之镜】可选，呈现魔镜的低语与映照\n6. 【可选行动】3-4个 + 【自定义行动】\n\n【数值标注】\n[善恶值+5（向善）] [名望-10] [莱桑德好感+3] [苏苏洛好感+5] 等格式标注数值变化。原著剧情节点触发时善恶值与名望波动剧烈。",
  "items": [
    { "id": "pendant", "name": "神无月的赠礼·挂坠", "type": "特殊", "price": 0, "effect": "进入游戏赠送的钻石挂坠，直觉告诉玩家它能帮到自己" },
    { "id": "mana-potion", "name": "初级魔力恢复药剂", "type": "消耗品", "price": 50, "effect": "精致水晶瓶装的蓝色液体，迅速补充魔力，味道像蓝莓汽水" },
    { "id": "dresses", "name": "数不清的衣裙首饰", "type": "杂物", "price": 0, "effect": "华丽昂贵的华服与珠宝，任何场合都能找到合适的穿搭" },
    { "id": "magic-grimoire", "name": "魔法典籍", "type": "装备", "price": 200, "effect": "提升魔法属性，解锁高阶魔法" },
    { "id": "rose-tea", "name": "玫瑰红茶", "type": "消耗品", "price": 10, "effect": "玫瑰园特调，恢复精神与心情" },
    { "id": "gossip-letter", "name": "匿名密信", "type": "消耗品", "price": 30, "effect": "获取一条他人的秘密情报，可用于权谋" }
  ]
}

};


// Inlined HTML content
const INLINED_HTML = `<!doctype html>
<html lang="zh-CN">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0, viewport-fit=cover" />
    <title>Mochi-phone</title>
    <meta name="theme-color" content="#7466ff" />
    <meta name="apple-mobile-web-app-capable" content="yes" />
    <meta name="apple-mobile-web-app-title" content="Mochi-phone" />
    <meta name="apple-mobile-web-app-status-bar-style" content="default" />
    
    <link rel="icon" href="icons/mochi-phone-icon.svg" />
    <link rel="apple-touch-icon" href="icons/mochi-phone-icon.svg" />
    <style>/* inlined novel-game.css */
:root {
  --novel-primary: #7466ff;
  --novel-accent: #ff8fb3;
  --novel-bg: #f7f5ff;
  --novel-surface: rgba(255, 255, 255, 0.92);
  --novel-text: #232136;
  --novel-muted: #7b7890;
  --novel-border: rgba(116, 102, 255, 0.15);
  --novel-danger: #e95656;
  --novel-shadow: 0 10px 24px rgba(35, 33, 54, 0.06);
}

/* ===== Novel Game Page ===== */
#novelGamePage {
  padding: 0;
  overflow: hidden;
  display: none;
  flex-direction: column;
  height: calc(100vh - 73px);
}

#novelGamePage.active {
  display: flex;
}

.novel-container {
  flex: 1;
  overflow-y: auto;
  padding: 0 14px 86px;
}

/* ===== Header ===== */
.novel-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 14px 16px 10px;
  background: rgba(247, 245, 255, 0.9);
  backdrop-filter: blur(18px);
  border-bottom: 1px solid var(--novel-border);
}

.novel-header h2 {
  margin: 0;
  font-size: 20px;
}

.novel-header-actions {
  display: flex;
  gap: 8px;
}

.novel-btn {
  padding: 8px 14px;
  border-radius: 999px;
  background: var(--novel-primary);
  color: #fff;
  font-weight: 700;
  border: 0;
  cursor: pointer;
  transition: transform 0.16s ease, opacity 0.16s ease;
}

.novel-btn:active {
  transform: scale(0.97);
}

.novel-btn.secondary {
  background: #efedf8;
  color: var(--novel-text);
}

.novel-btn.small {
  padding: 6px 10px;
  font-size: 13px;
}

/* ===== Tabs ===== */
.novel-tabs {
  display: flex;
  gap: 8px;
  padding: 10px 14px;
  background: var(--novel-bg);
  border-bottom: 1px solid var(--novel-border);
  position: sticky;
  top: 0;
  z-index: 5;
}

.novel-tabs button {
  padding: 8px 14px;
  border-radius: 999px;
  background: rgba(116, 102, 255, 0.1);
  color: var(--novel-primary);
  font-weight: 700;
  border: 0;
  cursor: pointer;
}

.novel-tabs button.active {
  background: var(--novel-primary);
  color: #fff;
}

/* ===== Script Cards ===== */
.novel-script-list {
  display: grid;
  gap: 12px;
  padding: 14px 0;
}

.novel-script-card {
  position: relative;
  border-radius: 22px;
  overflow: hidden;
  background: var(--novel-surface);
  border: 1px solid var(--novel-border);
  box-shadow: var(--novel-shadow);
  cursor: pointer;
  transition: transform 0.2s ease, box-shadow 0.2s ease;
}

.novel-script-card:hover {
  transform: translateY(-2px);
  box-shadow: 0 14px 32px rgba(35, 33, 54, 0.1);
}

.novel-script-cover {
  height: 140px;
  background-size: cover;
  background-position: center;
  position: relative;
}

.novel-script-cover::after {
  content: '';
  position: absolute;
  inset: 0;
  background: linear-gradient(to top, rgba(0,0,0,0.6) 0%, transparent 60%);
}

.novel-script-cover-text {
  position: absolute;
  bottom: 12px;
  left: 14px;
  right: 14px;
  color: #fff;
  z-index: 1;
}

.novel-script-cover-text h3 {
  margin: 0 0 4px;
  font-size: 18px;
  text-shadow: 0 1px 4px rgba(0,0,0,0.4);
}

.novel-script-cover-text .tagline {
  font-size: 12px;
  opacity: 0.9;
  text-shadow: 0 1px 3px rgba(0,0,0,0.4);
}

.novel-script-info {
  padding: 12px 14px 14px;
}

.novel-script-meta {
  display: flex;
  flex-wrap: wrap;
  gap: 6px;
  margin-bottom: 8px;
}

.novel-tag {
  padding: 3px 10px;
  border-radius: 999px;
  background: rgba(116, 102, 255, 0.1);
  color: var(--novel-primary);
  font-size: 11px;
  font-weight: 700;
}

.novel-tag.difficulty-easy { background: rgba(67, 233, 123, 0.15); color: #2cb76a; }
.novel-tag.difficulty-medium { background: rgba(255, 193, 7, 0.15); color: #c78c00; }
.novel-tag.difficulty-hard { background: rgba(233, 86, 86, 0.15); color: #c0392b; }

.novel-script-desc {
  color: var(--novel-muted);
  font-size: 13px;
  line-height: 1.5;
  margin: 0;
}

/* ===== Save Slots ===== */
.novel-save-list {
  display: grid;
  gap: 10px;
  padding: 14px 0;
}

.novel-save-card {
  display: grid;
  grid-template-columns: 1fr auto;
  align-items: center;
  gap: 12px;
  padding: 14px;
  border-radius: 18px;
  background: var(--novel-surface);
  border: 1px solid var(--novel-border);
  box-shadow: var(--novel-shadow);
  cursor: pointer;
}

.novel-save-info h4 {
  margin: 0 0 4px;
  font-size: 15px;
}

.novel-save-meta {
  color: var(--novel-muted);
  font-size: 12px;
}

.novel-save-actions {
  display: flex;
  gap: 6px;
}

/* ===== Create Character Form ===== */
.novel-form {
  display: grid;
  gap: 12px;
  padding: 14px 0;
}

.novel-form label {
  display: grid;
  gap: 6px;
  color: var(--novel-muted);
  font-size: 13px;
  font-weight: 700;
}

.novel-form input,
.novel-form textarea,
.novel-form select {
  width: 100%;
  border: 1px solid var(--novel-border);
  border-radius: 16px;
  padding: 11px 12px;
  outline: none;
  background: #fff;
  color: var(--novel-text);
  font: inherit;
}

.novel-form textarea {
  resize: vertical;
  min-height: 80px;
}

.novel-stat-grid {
  display: grid;
  grid-template-columns: repeat(2, 1fr);
  gap: 10px;
}

.novel-stat-input {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 10px 12px;
  border-radius: 14px;
  background: #fff;
  border: 1px solid var(--novel-border);
}

.novel-stat-input span {
  flex: 1;
  font-size: 13px;
  font-weight: 700;
}

.novel-stat-input input {
  width: 70px;
  text-align: center;
  padding: 6px;
  border-radius: 10px;
  border: 1px solid var(--novel-border);
}

/* ===== Story Screen ===== */
.novel-story {
  display: none;
  flex-direction: column;
  height: 100%;
  background: var(--novel-bg);
}

.novel-story.active {
  display: flex;
}

.novel-story-header {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 12px 16px;
  background: rgba(247, 245, 255, 0.9);
  backdrop-filter: blur(18px);
  border-bottom: 1px solid var(--novel-border);
  flex-shrink: 0;
}

.novel-story-time {
  padding: 4px 12px;
  border-radius: 999px;
  background: rgba(116, 102, 255, 0.1);
  color: var(--novel-primary);
  font-size: 12px;
  font-weight: 700;
  flex-shrink: 0;
}

.novel-story-header .round-badge {
  padding: 4px 12px;
  border-radius: 999px;
  background: var(--novel-primary);
  color: #fff;
  font-size: 12px;
  font-weight: 700;
  flex-shrink: 0;
}

/* ===== Status Bar (horizontal scrollable stat strip) ===== */
.novel-status-bar {
  display: none;
  flex-direction: row;
  gap: 6px;
  padding: 8px 14px;
  background: rgba(247, 245, 255, 0.95);
  backdrop-filter: blur(12px);
  border-bottom: 1px solid var(--novel-border);
  overflow-x: auto;
  -webkit-overflow-scrolling: touch;
  flex-shrink: 0;
}

.novel-status-bar::-webkit-scrollbar {
  display: none;
}

.novel-status-bar.has-stats {
  display: flex;
}

.novel-status-empty {
  color: var(--novel-muted);
  font-size: 12px;
  padding: 4px 0;
}

.novel-stat-chip {
  display: flex;
  align-items: center;
  gap: 4px;
  padding: 4px 10px;
  border-radius: 999px;
  background: rgba(116, 102, 255, 0.08);
  border: 1px solid rgba(116, 102, 255, 0.12);
  flex-shrink: 0;
  white-space: nowrap;
}

.novel-stat-chip-label {
  font-size: 11px;
  color: var(--novel-muted);
  font-weight: 600;
}

.novel-stat-chip-value {
  font-size: 13px;
  color: var(--novel-primary);
  font-weight: 800;
}

/* ===== Story Scroll ===== */
.novel-story-scroll {
  flex: 1;
  overflow-y: auto;
  padding: 16px 14px 140px;
  -webkit-overflow-scrolling: touch;
}

.novel-story-content {
  line-height: 1.8;
  font-size: 15px;
  color: var(--novel-text);
  word-break: break-word;
}

/* ===== Story Cards (UU-style) ===== */
.novel-card {
  margin-bottom: 12px;
  border-radius: 16px;
  background: var(--novel-surface);
  border: 1px solid var(--novel-border);
  box-shadow: 0 2px 8px rgba(35, 33, 54, 0.04);
  overflow: hidden;
}

.novel-card-header {
  padding: 10px 14px 6px;
  font-size: 13px;
  font-weight: 700;
  color: var(--novel-primary);
  background: rgba(116, 102, 255, 0.04);
  border-bottom: 1px solid var(--novel-border);
}

.novel-card-body {
  padding: 12px 14px 14px;
}

.novel-card-narrative {
  background: transparent;
  border-color: transparent;
  box-shadow: none;
}

.novel-card-hint {
  background: rgba(116, 102, 255, 0.04);
  border: 1px dashed var(--novel-border);
}

.novel-card-recap {
  background: rgba(255, 143, 179, 0.04);
  border-color: rgba(255, 143, 179, 0.15);
}

.novel-card-recap .novel-card-header {
  background: rgba(255, 143, 179, 0.06);
  color: var(--novel-accent);
}

/* ===== Narrative Paragraphs ===== */
.novel-para {
  margin: 0 0 8px;
  line-height: 1.8;
  font-size: 15px;
}

.novel-para:last-child {
  margin-bottom: 0;
}

.novel-para-muted {
  color: var(--novel-muted);
  font-style: italic;
  font-size: 13px;
}

.novel-recap-label {
  font-size: 12px;
  font-weight: 700;
  color: var(--novel-accent);
  margin-bottom: 8px;
  padding-left: 2px;
}

/* ===== Stat Change Badges ===== */
.novel-card-stat-changes {
  display: flex;
  flex-wrap: wrap;
  gap: 6px;
  margin-top: 8px;
  padding-top: 8px;
  border-top: 1px solid rgba(116, 102, 255, 0.08);
}

.novel-stat-badge {
  display: inline-flex;
  align-items: center;
  gap: 2px;
  padding: 3px 10px;
  border-radius: 999px;
  font-size: 12px;
  font-weight: 700;
}

.novel-stat-badge.positive {
  background: rgba(67, 233, 123, 0.15);
  color: #2cb76a;
}

.novel-stat-badge.negative {
  background: rgba(233, 86, 86, 0.15);
  color: #c0392b;
}

/* ===== NPC Dialogue ===== */
.novel-card-dialogue {
  margin-left: 12px;
  padding-left: 12px;
  border-left: 3px solid var(--novel-primary);
  border-radius: 0 12px 12px 0;
  background: rgba(116, 102, 255, 0.03);
}

.novel-card-dialogue .novel-card-body {
  padding: 10px 12px;
}

.novel-dialogue-speaker {
  font-size: 13px;
  font-weight: 700;
  color: var(--novel-primary);
  margin-bottom: 4px;
}

/* ===== Action Panel ===== */
.novel-action-panel {
  position: fixed;
  right: calc((100vw - min(100vw, 430px)) / 2);
  bottom: calc(58px + var(--safe-bottom));
  left: calc((100vw - min(100vw, 430px)) / 2);
  width: min(100vw, 430px);
  padding: 12px;
  background: rgba(255, 255, 255, 0.96);
  border-top: 1px solid var(--novel-border);
  backdrop-filter: blur(18px);
  z-index: 25;
}

.novel-actions {
  display: grid;
  gap: 8px;
  max-height: 200px;
  overflow-y: auto;
}

.novel-action-btn {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 12px 14px;
  border-radius: 16px;
  background: var(--novel-surface);
  border: 1px solid var(--novel-border);
  color: var(--novel-text);
  font-size: 14px;
  font-weight: 700;
  text-align: left;
  cursor: pointer;
  transition: all 0.16s ease;
}

.novel-action-btn:hover {
  background: rgba(116, 102, 255, 0.08);
  border-color: var(--novel-primary);
}

.novel-action-btn.primary {
  background: linear-gradient(135deg, var(--novel-primary), #9a8cff);
  color: #fff;
  border-color: transparent;
}

.novel-action-idx {
  display: flex;
  align-items: center;
  justify-content: center;
  width: 24px;
  height: 24px;
  border-radius: 50%;
  background: rgba(116, 102, 255, 0.1);
  color: var(--novel-primary);
  font-size: 11px;
  font-weight: 800;
  flex-shrink: 0;
}

.novel-action-btn.primary .novel-action-idx {
  background: rgba(255, 255, 255, 0.2);
  color: #fff;
}

.novel-action-label {
  flex: 1;
}

.novel-custom-action {
  display: flex;
  gap: 8px;
  margin-top: 8px;
}

.novel-custom-action input {
  flex: 1;
  padding: 10px 12px;
  border-radius: 14px;
  border: 1px solid var(--novel-border);
  background: #fff;
  font: inherit;
}

/* ===== Form Extras ===== */
.novel-form-desc {
  padding: 10px 14px;
  border-radius: 14px;
  background: rgba(116, 102, 255, 0.04);
  border: 1px solid rgba(116, 102, 255, 0.08);
  font-size: 13px;
  line-height: 1.6;
  color: var(--novel-muted);
  margin-bottom: 4px;
}

.novel-form-items {
  padding: 10px 14px;
  border-radius: 14px;
  background: rgba(67, 233, 123, 0.04);
  border: 1px solid rgba(67, 233, 123, 0.1);
  font-size: 13px;
  color: var(--novel-muted);
}

.novel-form-items strong {
  color: var(--novel-text);
}

/* ===== Loading ===== */
.novel-loading {
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  padding: 40px;
  color: var(--novel-muted);
}

.novel-loading-spinner {
  width: 36px;
  height: 36px;
  border: 3px solid rgba(116, 102, 255, 0.2);
  border-top-color: var(--novel-primary);
  border-radius: 50%;
  animation: novel-spin 0.8s linear infinite;
  margin-bottom: 12px;
}

@keyframes novel-spin {
  to { transform: rotate(360deg); }
}

/* ===== Empty State ===== */
.novel-empty {
  text-align: center;
  padding: 40px 20px;
  color: var(--novel-muted);
}

.novel-empty-icon {
  font-size: 48px;
  margin-bottom: 12px;
  opacity: 0.6;
}

/* ===== Modal ===== */
.novel-modal-overlay {
  position: fixed;
  inset: 0;
  background: rgba(35, 33, 54, 0.42);
  z-index: 60;
  display: none;
  align-items: center;
  justify-content: center;
  padding: 20px;
}

.novel-modal-overlay.active {
  display: flex;
}

.novel-modal {
  width: min(92vw, 390px);
  max-height: 80vh;
  overflow-y: auto;
  background: var(--novel-surface);
  border-radius: 24px;
  padding: 20px;
  box-shadow: 0 20px 48px rgba(35, 33, 54, 0.2);
}

.novel-modal h3 {
  margin: 0 0 14px;
  font-size: 18px;
}

.novel-modal-actions {
  display: flex;
  justify-content: flex-end;
  gap: 10px;
  margin-top: 16px;
}

/* ===== Responsive ===== */
@media (max-width: 380px) {
  .novel-stat-grid {
    grid-template-columns: repeat(2, 1fr);
  }
  .novel-action-btn {
    padding: 10px 12px;
    font-size: 13px;
  }
}

</style>
    <style>
:root {
  --color-primary: #7466ff;
  --color-primary-dark: #5a4ee0;
  --color-accent: #ff8fb3;
  --color-bg: #f7f5ff;
  --color-surface: rgba(255, 255, 255, 0.92);
  --color-text: #232136;
  --color-muted: #7b7890;
  --color-border: rgba(116, 102, 255, 0.15);
  --color-danger: #e95656;
  --chat-wallpaper: linear-gradient(180deg, #fbfaff 0%, #f0edff 100%);
  --bubble-user-bg: linear-gradient(135deg, #7466ff, #9a8cff);
  --bubble-user-text: #ffffff;
  --bubble-ai-bg: rgba(255, 255, 255, 0.96);
  --bubble-ai-text: #25223a;
  --bubble-radius: 18px;
  --safe-bottom: env(safe-area-inset-bottom, 0px);
}


* {
  box-sizing: border-box;
}

body {
  margin: 0;
  min-height: 100vh;
  background: #dedaf8;
  color: var(--color-text);
  font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
}

button,
input,
textarea,
select {
  font: inherit;
}

button {
  border: 0;
  cursor: pointer;
  transition: transform 0.16s ease, opacity 0.16s ease;
}

button:active {
  transform: scale(0.97);
}

.app-shell {
  position: relative;
  width: min(100vw, 430px);
  min-height: 100vh;
  margin: 0 auto;
  overflow: hidden;
  background: var(--color-bg);
  box-shadow: 0 0 40px rgba(35, 33, 54, 0.14);
}

.top-bar {
  position: sticky;
  top: 0;
  z-index: 20;
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 14px 16px 10px;
  background: rgba(247, 245, 255, 0.9);
  backdrop-filter: blur(18px);
}

.eyebrow {
  margin: 0 0 2px;
  color: var(--color-muted);
  font-size: 12px;
}

h1,
h2,
h3,
p {
  margin-top: 0;
}

h1 {
  margin-bottom: 0;
  font-size: 22px;
}

.beans-badge,
.primary-small,
.chat-input-bar button,
.search-row button,
.profile-card button,
.package-card,
.modal-actions button {
  border-radius: 999px;
  background: var(--color-primary);
  color: #fff;
  font-weight: 700;
}

.beans-badge {
  padding: 9px 13px;
  box-shadow: 0 8px 18px rgba(116, 102, 255, 0.24);
}

.page-stack {
  height: calc(100vh - 73px);
}

.page {
  display: none;
  height: calc(100vh - 73px);
  padding: 0 14px 86px;
  overflow-y: auto;
}

.page.active {
  display: block;
}

#chatPage {
  padding: 0;
  overflow: hidden;
}

#chatPage.active {
  display: flex;
  flex-direction: column;
  min-height: 0;
}

.role-switcher {
  display: flex;
  gap: 10px;
  overflow-x: auto;
  padding: 8px 14px 10px;
  scrollbar-width: none;
}

.role-chip {
  display: flex;
  flex: 0 0 auto;
  align-items: center;
  gap: 9px;
  padding: 9px 14px 9px 9px;
  font-size: 16px;
  font-weight: 800;
  border: 1px solid var(--color-border);
  border-radius: 999px;
  background: var(--color-surface);
  color: var(--color-text);
}

.role-chip.active {
  background: var(--color-primary);
  color: #fff;
}

.avatar {
  width: 40px;
  height: 40px;
  border-radius: 50%;
  object-fit: cover;
  background: linear-gradient(135deg, #ffcadb, #c7c2ff);
}

.chat-container {
  flex: 1 1 auto;
  min-height: 0;
  margin-bottom: calc(92px + var(--safe-bottom));
  overflow-y: auto;
  background: var(--chat-wallpaper);
  background-size: cover;
  background-position: center;
}

.message-list {
  min-height: 100%;
  padding: 18px 14px 120px;
}

.message-row {
  display: flex;
  align-items: flex-end;
  gap: 8px;
  margin-bottom: 14px;
}

.message-row.user {
  flex-direction: row-reverse;
}

.chat-bubble {
  max-width: 74%;
  padding: 11px 13px;
  border-radius: var(--bubble-radius);
  line-height: 1.6;
  white-space: pre-wrap;
  word-break: break-word;
  box-shadow: 0 6px 18px rgba(35, 33, 54, 0.08);
}

.message-row.user .chat-bubble {
  border-bottom-right-radius: 5px;
  background: var(--bubble-user-bg);
  color: var(--bubble-user-text);
}

.message-row.assistant .chat-bubble {
  border-bottom-left-radius: 5px;
  background: var(--bubble-ai-bg);
  color: var(--bubble-ai-text);
}

.typing-dot {
  display: inline-flex;
  gap: 4px;
}

.typing-dot i {
  width: 6px;
  height: 6px;
  border-radius: 50%;
  background: var(--color-primary);
  animation: bounce 0.9s infinite alternate;
}

.typing-dot i:nth-child(2) {
  animation-delay: 0.14s;
}

.typing-dot i:nth-child(3) {
  animation-delay: 0.28s;
}

@keyframes bounce {
  to {
    transform: translateY(-4px);
    opacity: 0.4;
  }
}

.chat-input-bar {
  position: fixed;
  right: calc((100vw - min(100vw, 430px)) / 2);
  bottom: calc(58px + var(--safe-bottom));
  left: calc((100vw - min(100vw, 430px)) / 2);
  display: flex;
  gap: 9px;
  width: min(100vw, 430px);
  padding: 10px 12px;
  background: rgba(255, 255, 255, 0.94);
  border-top: 1px solid var(--color-border);
}

.chat-input-bar textarea,
input,
textarea,
select {
  width: 100%;
  border: 1px solid var(--color-border);
  border-radius: 16px;
  padding: 11px 12px;
  outline: none;
  background: #fff;
  color: var(--color-text);
  resize: none;
}

.chat-input-bar textarea {
  max-height: 96px;
}

.chat-input-bar button {
  min-width: 64px;
  padding: 0 14px;
}

.bottom-nav {
  position: fixed;
  right: calc((100vw - min(100vw, 430px)) / 2);
  bottom: 0;
  left: calc((100vw - min(100vw, 430px)) / 2);
  z-index: 30;
  display: grid;
  grid-template-columns: repeat(7, 1fr);
  width: min(100vw, 430px);
  padding: 8px 8px calc(8px + var(--safe-bottom));
  background: rgba(255, 255, 255, 0.94);
  border-top: 1px solid var(--color-border);
  backdrop-filter: blur(18px);
}

.bottom-nav button {
  padding: 8px 0;
  border-radius: 14px;
  background: transparent;
  color: var(--color-muted);
}

.bottom-nav button.active {
  background: rgba(116, 102, 255, 0.12);
  color: var(--color-primary);
  font-weight: 800;
}

.section-header,
.search-row,
.tabs,
.modal-actions {
  display: flex;
  align-items: center;
  gap: 10px;
}

.section-header {
  justify-content: space-between;
  padding-top: 10px;
}

.primary-small {
  padding: 9px 14px;
}

.card-list,
.waterfall-list,
.transaction-list,
.memory-list {
  display: grid;
  gap: 12px;
}

.role-card,
.community-card,
.memory-card,
.profile-card,
.panel {
  padding: 14px;
  border: 1px solid var(--color-border);
  border-radius: 22px;
  background: var(--color-surface);
  box-shadow: 0 10px 24px rgba(35, 33, 54, 0.06);
}

.role-card,
.community-card {
  display: grid;
  grid-template-columns: 48px 1fr;
  gap: 12px;
}

.role-card h3,
.community-card h3,
.memory-card h3 {
  margin-bottom: 4px;
}

.memory-card {
  display: grid;
  gap: 8px;
}

.memory-meta {
  color: var(--color-muted);
  font-size: 12px;
}

.role-card p,
.community-card p,
.muted {
  margin-bottom: 8px;
  color: var(--color-muted);
  font-size: 13px;
  line-height: 1.5;
}

.card-actions {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
}

.card-actions button,
.settings-list button,
.tabs button {
  padding: 9px 12px;
  border-radius: 999px;
  background: rgba(116, 102, 255, 0.1);
  color: var(--color-primary);
  font-weight: 700;
}

.search-row {
  padding: 12px 0;
}

.search-row button {
  padding: 11px 14px;
}

.profile-card,
.panel {
  margin-top: 12px;
}

.profile-header{display:flex;align-items:center;gap:14px;padding:20px 16px;background:linear-gradient(135deg,#7466ff,#ff8fb3);border-radius:22px;margin-top:12px;box-shadow:0 8px 24px rgba(116,102,255,.2)}
.profile-header-avatar{width:64px;height:64px;border-radius:50%;object-fit:cover;border:3px solid rgba(255,255,255,.6);background:rgba(255,255,255,.2);flex-shrink:0}
.profile-header-info{flex:1;min-width:0}
.profile-header-name{font-size:1.2rem;font-weight:800;color:#fff;text-shadow:0 1px 3px rgba(0,0,0,.15)}
.profile-header-bio{font-size:.85rem;color:rgba(255,255,255,.85);margin-top:4px;overflow:hidden;display:-webkit-box;-webkit-line-clamp:2;-webkit-box-orient:vertical}

.profile-card label {
  display: grid;
  gap: 7px;
  margin-bottom: 12px;
  color: var(--color-muted);
  font-size: 13px;
  font-weight: 700;
}

.avatar-uploader {
  justify-items: center;
  text-align: center;
}

.avatar-uploader img {
  width: 76px;
  height: 76px;
  border-radius: 50%;
  object-fit: cover;
  background: linear-gradient(135deg, #ffcadb, #c7c2ff);
}

.avatar-uploader input {
  display: none;
}

.balance {
  display: block;
  margin: 8px 0 12px;
  color: var(--color-primary);
  font-size: 34px;
}

.package-grid {
  display: grid;
  grid-template-columns: repeat(2, 1fr);
  gap: 10px;
}

.package-card {
  padding: 12px;
}

.settings-list {
  display: grid;
  gap: 10px;
}

.tabs {
  position: sticky;
  top: 0;
  z-index: 5;
  padding: 12px 0;
  background: var(--color-bg);
}

.tabs button.active {
  background: var(--color-primary);
  color: #fff;
}

.costume-editor {
  display: grid;
  gap: 12px;
}

.code-editor {
  min-height: 260px;
  font-family: ui-monospace, SFMono-Regular, Menlo, monospace;
  font-size: 13px;
}

.wallpaper-preview {
  min-height: 160px;
  border-radius: 22px;
  background: var(--chat-wallpaper);
  background-position: center;
  background-size: cover;
}

.modal {
  width: min(92vw, 390px);
  border: 0;
  border-radius: 24px;
  padding: 18px;
  color: var(--color-text);
}

.modal::backdrop {
  background: rgba(35, 33, 54, 0.42);
}

.modal label {
  display: grid;
  gap: 7px;
  margin-bottom: 11px;
  color: var(--color-muted);
  font-size: 13px;
  font-weight: 700;
}

.switch-line {
  display: flex !important;
  grid-template-columns: auto 1fr;
  align-items: center;
}

.switch-line input {
  width: auto;
}

.modal-actions {
  justify-content: end;
}

.modal-actions span {
  flex: 1;
}

.modal-actions button {
  padding: 10px 14px;
}

.modal-actions button[value="cancel"] {
  background: #efedf8;
  color: var(--color-text);
}

.danger {
  background: var(--color-danger) !important;
}

.toast {
  position: fixed;
  left: 50%;
  bottom: calc(82px + var(--safe-bottom));
  z-index: 80;
  max-width: min(86vw, 360px);
  padding: 11px 14px;
  border-radius: 999px;
  background: rgba(35, 33, 54, 0.92);
  color: #fff;
  opacity: 0;
  transform: translate(-50%, 12px);
  pointer-events: none;
  transition: 0.24s ease;
}

.toast.show {
  opacity: 1;
  transform: translate(-50%, 0);
}

.empty-state {
  padding: 26px 16px;
  color: var(--color-muted);
  text-align: center;
}


.phone-status-panel {
  margin: 0 14px 10px;
  padding: 12px;
  border: 1px solid var(--color-border);
  border-radius: 22px;
  background: linear-gradient(135deg, rgba(255,255,255,.96), rgba(244,241,255,.92));
  box-shadow: var(--shadow);
}

.phone-status-head,
.phone-status-grid,
.timeline-item-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 10px;
}

.phone-status-title {
  font-weight: 900;
}

.phone-status-sub {
  color: var(--color-muted);
  font-size: .84rem;
}

.phone-status-grid {
  display: grid;
  grid-template-columns: repeat(3, 1fr);
  margin: 10px 0;
}

.phone-stat {
  padding: 9px 8px;
  border-radius: 16px;
  background: rgba(116, 102, 255, .08);
  text-align: center;
}

.phone-stat strong {
  display: block;
  font-size: 1rem;
}

.phone-stat span {
  color: var(--color-muted);
  font-size: .78rem;
}

.relation-bar {
  height: 8px;
  overflow: hidden;
  border-radius: 999px;
  background: rgba(116, 102, 255, .12);
}

.relation-bar i {
  display: block;
  height: 100%;
  border-radius: inherit;
  background: linear-gradient(90deg, #ff8fb3, #7466ff);
}

.proactive-button {
  width: 100%;
  margin-top: 10px;
  padding: 10px 12px;
}



#roleSwitcher.role-switcher {
  position: relative;
  z-index: 12;
  flex: 0 0 auto;
  gap: 10px;
  padding: 9px 14px 10px;
  background: linear-gradient(180deg, rgba(247,245,255,.98), rgba(247,245,255,.78));
  border-bottom: 1px solid rgba(229,225,246,.7);
}

#roleSwitcher .role-chip {
  min-height: 54px !important;
  padding: 8px 13px 8px 8px !important;
  font-size: 16px !important;
  font-weight: 850 !important;
  box-shadow: 0 6px 14px rgba(35,33,54,.08);
}

#roleSwitcher .role-chip .avatar {
  width: 40px !important;
  height: 40px !important;
}

#chatPage .chat-container {
  position: relative;
  z-index: 1;
  margin-bottom: 0;
  border-top: 1px solid rgba(229,225,246,.7);
}

#chatPage .message-list {
  padding-top: 16px;
  padding-bottom: calc(150px + var(--safe-bottom));
}

#chatPage .chat-input-bar {
  z-index: 28;
}

.phone-shell {
  min-height: calc(100vh - 170px);
  padding: 16px 14px 104px;
  border-radius: 30px;
  background:
    linear-gradient(rgba(35, 28, 55, .18), rgba(35, 28, 55, .22)),
    var(--chat-wallpaper),
    linear-gradient(160deg, #fff5fb, #ede9ff);
  background-size: cover;
  background-position: center;
  color: var(--color-text);
}

.phone-lock {
  padding: 18px 6px 12px;
  text-align: center;
}

.phone-lock-time {
  font-size: 48px;
  font-weight: 300;
  letter-spacing: .04em;
}

.phone-lock-date {
  color: rgba(35, 33, 54, .62);
}

.phone-widget-grid {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 12px;
  margin: 12px 0 22px;
}

.phone-widget {
  min-height: 76px;
  padding: 14px;
  border: 1px solid rgba(255,255,255,.64);
  border-radius: 22px;
  background: rgba(255,255,255,.46);
  backdrop-filter: blur(14px);
  box-shadow: 0 10px 28px rgba(35,33,54,.08);
}

.phone-widget strong {
  display: block;
  font-size: 1.15rem;
}

.phone-widget span {
  color: rgba(35, 33, 54, .64);
  font-size: .84rem;
}

.phone-app-grid {
  display: grid;
  grid-template-columns: repeat(4, 1fr);
  gap: 20px 14px;
}

.phone-app {
  border: 0;
  background: transparent;
  color: var(--color-text);
  text-align: center;
}

.phone-app-icon {
  display: grid;
  place-items: center;
  width: 58px;
  height: 58px;
  margin: 0 auto 7px;
  border-radius: 18px;
  background: linear-gradient(135deg, #7b5cff, #ff8fb3);
  color: #fff;
  font-size: 26px;
  box-shadow: 0 10px 24px rgba(116,102,255,.24);
}

.phone-app span {
  font-size: .86rem;
  font-weight: 700;
}

.phone-app-panel {
  margin-top: 18px;
  padding: 14px;
  border: 1px solid rgba(255,255,255,.68);
  border-radius: 24px;
  background: rgba(255,255,255,.74);
  backdrop-filter: blur(16px);
  box-shadow: var(--shadow);
}

.phone-app-panel.hidden {
  display: none;
}

.phone-app-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 10px;
  margin-bottom: 12px;
}

.phone-app-head h3 {
  margin: 0;
}

.phone-app-close {
  width: 34px;
  height: 34px;
  border-radius: 50%;
  background: rgba(116, 102, 255, .1);
  color: var(--color-primary);
}

.phone-mini-list {
  display: grid;
  gap: 10px;
}

.phone-mini-card {
  padding: 12px;
  border: 1px solid var(--color-border);
  border-radius: 18px;
  background: rgba(255,255,255,.72);
}

.phone-mini-card h4 {
  margin: 0 0 6px;
}

.phone-mini-card p {
  margin: 0;
  color: var(--color-muted);
  line-height: 1.6;
}

.compact-apps {
  grid-template-columns: repeat(3, 1fr);
}

.forum-world {
  display: grid;
  gap: 12px;
}

.forum-hero-card {
  padding: 15px;
  border-radius: 22px;
  background: linear-gradient(135deg, rgba(35,33,54,.95), rgba(116,102,255,.82));
  color: #fff;
  box-shadow: 0 14px 28px rgba(35,33,54,.18);
}

.forum-hero-card h4 {
  margin: 0 0 6px;
  font-size: 1.12rem;
}

.forum-hero-card p {
  margin: 0;
  color: rgba(255,255,255,.78);
  line-height: 1.6;
}

.forum-tabs {
  display: flex;
  gap: 8px;
  overflow-x: auto;
  padding-bottom: 2px;
}

.forum-tabs span {
  flex: 0 0 auto;
  padding: 7px 10px;
  border-radius: 999px;
  background: rgba(116,102,255,.10);
  color: var(--color-primary);
  font-size: .78rem;
  font-weight: 850;
}

.forum-post-list {
  display: grid;
  gap: 10px;
}

.forum-post-card {
  padding: 13px;
  border: 1px solid rgba(116,102,255,.14);
  border-radius: 20px;
  background: rgba(255,255,255,.82);
}

.forum-post-top {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
  margin-bottom: 8px;
}

.forum-board-tag {
  padding: 4px 8px;
  border-radius: 999px;
  background: rgba(35,33,54,.08);
  color: var(--color-muted);
  font-size: .72rem;
  font-weight: 800;
}

.forum-post-card h4 {
  margin: 0 0 6px;
  line-height: 1.35;
}

.forum-post-card p {
  margin: 0;
  color: var(--color-muted);
  line-height: 1.65;
}

.forum-post-meta {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
  margin-top: 10px;
  color: var(--color-muted);
  font-size: .76rem;
}

.forum-rules-card {
  padding: 12px;
  border-radius: 18px;
  background: rgba(255,255,255,.66);
  border: 1px dashed rgba(116,102,255,.24);
  color: var(--color-muted);
  line-height: 1.65;
  font-size: .84rem;
}

.timeline-list {
  display: grid;
  gap: 10px;
}

.timeline-item {
  padding: 12px;
  border: 1px solid var(--color-border);
  border-radius: 18px;
  background: rgba(255,255,255,.86);
}

.timeline-item h4 {
  margin: 0;
}

.timeline-item p {
  margin: 8px 0 0;
  color: var(--color-text);
  line-height: 1.65;
}

.timeline-meta {
  color: var(--color-muted);
  font-size: .78rem;
}

@media (min-width: 431px) {
  .app-shell {
    min-height: 920px;
  }
}

/* === Forum Full-screen Overlay (Xiaohongshu style) === */
.forum-overlay{position:fixed;top:0;left:0;right:0;bottom:0;z-index:1000;background:#f5f5f7;display:none;flex-direction:column;animation:forumSlideIn .3s ease}
.forum-overlay.active{display:flex}
@keyframes forumSlideIn{from{transform:translateY(100%);opacity:.6}to{transform:translateY(0);opacity:1}}
.forum-overlay-header{position:sticky;top:0;z-index:10;display:flex;align-items:center;justify-content:space-between;padding:12px 16px;background:rgba(255,255,255,.92);backdrop-filter:blur(20px);border-bottom:1px solid rgba(0,0,0,.06)}
.forum-overlay-title{font-size:1.15rem;font-weight:800;color:#1a1a2e}
.forum-overlay-actions{display:flex;gap:8px}
.forum-overlay-btn{width:36px;height:36px;border:0;border-radius:50%;background:rgba(116,102,255,.1);color:#1a1a2e;font-size:1.1rem;cursor:pointer;display:grid;place-items:center;transition:background .2s}
.forum-overlay-btn:active{background:rgba(116,102,255,.25)}
.forum-tabs-bar{display:flex;position:sticky;top:57px;z-index:9;background:rgba(255,255,255,.92);backdrop-filter:blur(20px);border-bottom:1px solid rgba(0,0,0,.06)}
.forum-tab-item{flex:1;padding:14px 0;text-align:center;font-size:.95rem;font-weight:600;color:#999;cursor:pointer;border-bottom:3px solid transparent;transition:all .2s;background:none;border-top:0;border-left:0;border-right:0}
.forum-tab-item.active{color:#1a1a2e;border-bottom-color:#7466ff;font-weight:800}
.forum-post-list{flex:1;overflow-y:auto;-webkit-overflow-scrolling:touch;padding:8px;padding-bottom:80px;display:grid;grid-template-columns:1fr 1fr;gap:10px}
.forum-xhs-card{background:#fff;border-radius:12px;overflow:hidden;box-shadow:0 1px 4px rgba(0,0,0,.06);cursor:pointer;transition:transform .15s}
.forum-xhs-card:active{transform:scale(.97)}
.forum-xhs-cover{width:100%;aspect-ratio:3/4;background:linear-gradient(135deg,var(--c1,#ffcadb),var(--c2,#7466ff));display:flex;align-items:flex-end;padding:10px;position:relative}
.forum-xhs-cover-text{color:#fff;font-size:.88rem;line-height:1.4;font-weight:500;text-shadow:0 1px 3px rgba(0,0,0,.3);overflow:hidden;display:-webkit-box;-webkit-line-clamp:4;-webkit-box-orient:vertical}
.forum-xhs-tag{position:absolute;top:8px;left:8px;background:rgba(0,0,0,.3);color:#fff;font-size:.7rem;padding:2px 8px;border-radius:10px;backdrop-filter:blur(4px)}
.forum-xhs-footer{padding:8px 10px}
.forum-xhs-author{display:flex;align-items:center;gap:5px}
.forum-xhs-avatar{width:22px;height:22px;border-radius:50%;object-fit:cover;flex-shrink:0}
.forum-xhs-name{font-size:.78rem;color:#333;overflow:hidden;white-space:nowrap;text-overflow:ellipsis}
.forum-xhs-likes{font-size:.78rem;color:#999;margin-left:auto;display:flex;align-items:center;gap:3px}
.forum-loading{text-align:center;padding:40px 20px;color:#999;font-size:.9rem;grid-column:1/-1}
.forum-empty{text-align:center;padding:60px 20px;color:#999;font-size:.9rem;grid-column:1/-1}
.forum-fab{position:fixed;bottom:20px;right:20px;width:52px;height:52px;border-radius:50%;background:linear-gradient(135deg,#7466ff,#ff8fb3);color:#fff;border:0;font-size:1.6rem;cursor:pointer;z-index:1001;display:grid;place-items:center;box-shadow:0 4px 16px rgba(116,102,255,.4);transition:transform .2s}
.forum-fab:active{transform:scale(.92)}
.forum-post-detail{position:fixed;top:0;left:0;right:0;bottom:0;z-index:1002;background:#f5f5f7;display:none;flex-direction:column;animation:forumSlideIn .3s ease}
.forum-post-detail.active{display:flex}
.forum-detail-header{position:sticky;top:0;z-index:10;display:flex;align-items:center;justify-content:space-between;padding:12px 16px;background:rgba(255,255,255,.92);backdrop-filter:blur(20px);border-bottom:1px solid rgba(0,0,0,.06)}
.forum-detail-scroll{flex:1;overflow-y:auto;-webkit-overflow-scrolling:touch}
.forum-detail-post{padding:16px;background:#fff;border-bottom:8px solid #f5f5f7}
.forum-detail-author{display:flex;align-items:center;gap:10px;margin-bottom:12px}
.forum-detail-avatar{width:42px;height:42px;border-radius:50%;object-fit:cover}
.forum-detail-name{font-weight:700;font-size:.95rem;color:#1a1a2e}
.forum-detail-time{font-size:.8rem;color:#999}
.forum-detail-text{font-size:.95rem;line-height:1.6;color:#1a1a2e;white-space:pre-wrap;word-break:break-word}
.forum-detail-actions{display:flex;gap:20px;margin-top:14px;padding-top:12px;border-top:1px solid rgba(0,0,0,.05)}
.forum-detail-action{display:flex;align-items:center;gap:5px;font-size:.85rem;color:#666;cursor:pointer}
.forum-detail-action.liked{color:#e74c3c}
.forum-detail-comments{padding:16px}
.forum-detail-comments h4{font-size:.9rem;color:#999;margin-bottom:12px}
.forum-comment-item{display:flex;gap:10px;padding:12px 0;border-bottom:1px solid rgba(0,0,0,.04)}
.forum-comment-avatar{width:32px;height:32px;border-radius:50%;object-fit:cover;flex-shrink:0}
.forum-comment-body{flex:1}
.forum-comment-author{font-weight:600;font-size:.85rem;color:#1a1a2e}
.forum-comment-text{font-size:.88rem;color:#333;line-height:1.5;margin-top:2px}
.forum-comment-time{font-size:.75rem;color:#999;margin-top:2px}
.forum-comment-input-wrap{position:sticky;bottom:0;padding:10px 16px;background:#fff;border-top:1px solid rgba(0,0,0,.06);display:flex;gap:8px}
.forum-comment-input{flex:1;border:1px solid rgba(0,0,0,.1);border-radius:20px;padding:8px 14px;font-size:.9rem;outline:none}
.forum-comment-input:focus{border-color:#7466ff}
.forum-comment-send{border:0;border-radius:20px;padding:8px 16px;background:linear-gradient(135deg,#7466ff,#ff8fb3);color:#fff;font-weight:600;cursor:pointer}
.forum-post-modal{position:fixed;top:0;left:0;right:0;bottom:0;z-index:1003;background:rgba(0,0,0,.4);display:none;align-items:flex-end;justify-content:center}
.forum-post-modal.active{display:flex}
.forum-post-modal-content{width:100%;max-width:430px;background:#fff;border-radius:20px 20px 0 0;padding:20px;animation:forumModalSlideUp .3s ease}
@keyframes forumModalSlideUp{from{transform:translateY(100%)}to{transform:translateY(0)}}
.forum-post-modal textarea{width:100%;min-height:120px;border:1px solid rgba(0,0,0,.1);border-radius:12px;padding:12px;font-size:.95rem;resize:none;font-family:inherit;outline:none}
.forum-post-modal textarea:focus{border-color:#7466ff}
.forum-post-modal-actions{display:flex;gap:10px;margin-top:12px}
.forum-post-modal-btn{flex:1;padding:10px;border:0;border-radius:12px;font-size:.95rem;font-weight:600;cursor:pointer}
.forum-post-modal-btn.cancel{background:rgba(0,0,0,.06);color:#1a1a2e}
.forum-post-modal-btn.publish{background:linear-gradient(135deg,#7466ff,#ff8fb3);color:#fff}
/* World selector */
.forum-world-selector{flex:1;margin:0 12px}
.forum-world-select{width:100%;padding:6px 10px;border:1px solid rgba(0,0,0,.1);border-radius:20px;font-size:.85rem;background:#fff;color:#1a1a2e;outline:none;cursor:pointer}
.forum-world-select:focus{border-color:#7466ff}
/* Forum Page (as bottom-nav page) */
#forumPage{padding:0;overflow:hidden;display:none;flex-direction:column;height:calc(100vh - 73px)}
#forumPage.active{display:flex}
.forum-page-container{display:flex;flex-direction:column;height:100%;background:#f5f5f7;position:relative}
.forum-page-header{position:sticky;top:0;z-index:10;display:flex;align-items:center;justify-content:space-between;padding:12px 16px;background:rgba(255,255,255,.92);backdrop-filter:blur(20px);border-bottom:1px solid rgba(0,0,0,.06)}
.forum-page-title{font-size:1.15rem;font-weight:800;color:#1a1a2e}
.forum-page-actions{display:flex;gap:8px}
.forum-tabs-bar{display:flex;position:sticky;top:57px;z-index:9;background:rgba(255,255,255,.92);backdrop-filter:blur(20px);border-bottom:1px solid rgba(0,0,0,.06)}
#forumPage .forum-post-list{flex:1;overflow-y:auto;-webkit-overflow-scrolling:touch;padding:8px;padding-bottom:80px;display:grid;grid-template-columns:1fr 1fr;gap:10px;align-content:start}
#forumPage .forum-fab{position:absolute;bottom:20px;right:20px;width:52px;height:52px;border-radius:50%;background:linear-gradient(135deg,#7466ff,#ff8fb3);color:#fff;border:0;font-size:1.6rem;cursor:pointer;z-index:10;display:grid;place-items:center;box-shadow:0 4px 16px rgba(116,102,255,.4);transition:transform .2s}
#forumPage .forum-fab:active{transform:scale(.92)}
/* Forum Homepage */
.forum-home{flex:1;overflow-y:auto;-webkit-overflow-scrolling:touch;padding-bottom:80px}
.forum-home.hidden{display:none}
.forum-hero{margin:12px;padding:24px 20px;background:linear-gradient(135deg,#7466ff 0%,#9b8cff 50%,#ff8fb3 100%);border-radius:20px;color:#fff;position:relative;overflow:hidden;box-shadow:0 8px 24px rgba(116,102,255,.25)}
.forum-hero::after{content:'';position:absolute;top:-30px;right:-20px;width:120px;height:120px;background:rgba(255,255,255,.1);border-radius:50%}
.forum-hero h3{font-size:1.5rem;font-weight:800;margin:0 0 8px;letter-spacing:1px}
.forum-hero p{font-size:.85rem;opacity:.9;margin:0;line-height:1.5}
.forum-hero-badge{display:inline-block;margin-top:12px;padding:4px 12px;background:rgba(255,255,255,.2);border-radius:20px;font-size:.75rem;font-weight:600}
.forum-section-title{font-size:1rem;font-weight:700;color:#1a1a2e;margin:20px 16px 10px;display:flex;align-items:center;justify-content:space-between}
.forum-section-title span:last-child{font-size:.78rem;color:#7466ff;font-weight:600;cursor:pointer}
.forum-board-grid{display:grid;grid-template-columns:1fr 1fr;gap:10px;padding:0 12px}
.forum-board-card{padding:16px 14px;border-radius:16px;cursor:pointer;transition:transform .15s;position:relative;overflow:hidden;border:0;text-align:left}
.forum-board-card:active{transform:scale(.96)}
.forum-board-card h4{font-size:.95rem;font-weight:700;margin:0 0 4px;color:#fff}
.forum-board-card p{font-size:.72rem;opacity:.85;margin:0;color:#fff;line-height:1.4}
.forum-board-icon{font-size:1.6rem;margin-bottom:6px;display:block}
.forum-board-card.tide{background:linear-gradient(135deg,#667eea,#764ba2)}
.forum-board-card.deep{background:linear-gradient(135deg,#2c5364,#0f9b8e)}
.forum-board-card.dark{background:linear-gradient(135deg,#434343,#1a1a2e)}
.forum-board-card.wave{background:linear-gradient(135deg,#f093fb,#f5576c)}
.forum-board-card.evening{background:linear-gradient(135deg,#fa709a,#fee140)}
.forum-hot-list{padding:0 12px;display:flex;flex-direction:column;gap:8px}
.forum-hot-item{display:flex;align-items:center;gap:10px;padding:12px 14px;background:#fff;border-radius:14px;cursor:pointer;transition:transform .15s;box-shadow:0 1px 4px rgba(0,0,0,.04)}
.forum-hot-item:active{transform:scale(.98)}
.forum-hot-rank{width:24px;height:24px;border-radius:8px;display:grid;place-items:center;font-size:.75rem;font-weight:800;color:#fff;flex-shrink:0}
.forum-hot-rank.r1{background:#ff6b6b}.forum-hot-rank.r2{background:#ffa94d}.forum-hot-rank.r3{background:#ffd43b;color:#1a1a2e}
.forum-hot-rank.r4,.forum-hot-rank.r5{background:#dee2e6;color:#1a1a2e}
.forum-hot-text{flex:1;min-width:0}
.forum-hot-text h5{font-size:.82rem;font-weight:600;margin:0 0 2px;color:#1a1a2e;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.forum-hot-text p{font-size:.72rem;color:#999;margin:0}
.forum-hot-likes{font-size:.72rem;color:#ff6b6b;font-weight:600;flex-shrink:0}
.forum-rules-card{margin:12px;padding:14px 16px;background:rgba(116,102,255,.06);border-radius:14px;border:1px solid rgba(116,102,255,.12)}
.forum-rules-card h4{font-size:.85rem;font-weight:700;color:#7466ff;margin:0 0 6px}
.forum-rules-card p{font-size:.76rem;color:#7b7890;margin:0;line-height:1.6}
.forum-enter-btn{display:block;margin:16px auto;padding:12px 48px;background:linear-gradient(135deg,#7466ff,#ff8fb3);color:#fff;border:0;border-radius:30px;font-size:.95rem;font-weight:700;cursor:pointer;box-shadow:0 4px 16px rgba(116,102,255,.35);transition:transform .15s}
.forum-enter-btn:active{transform:scale(.96)}
.forum-feed-wrap.hidden{display:none}
/* DM (Direct Messages) */
.dm-role-bar{display:flex;gap:8px;padding:10px 12px;overflow-x:auto;background:rgba(255,255,255,.92);border-bottom:1px solid rgba(0,0,0,.06)}
.dm-role-chip{flex-shrink:0;padding:6px 14px;border-radius:20px;background:rgba(116,102,255,.1);color:#7466ff;font-size:.82rem;font-weight:600;cursor:pointer;border:0;white-space:nowrap}
.dm-role-chip.active{background:linear-gradient(135deg,#7466ff,#ff8fb3);color:#fff}
.dm-chat-list{flex:1;overflow-y:auto;padding:12px 16px;display:flex;flex-direction:column;gap:8px}
.dm-bubble{max-width:75%;padding:10px 14px;border-radius:16px;font-size:.88rem;line-height:1.5;word-break:break-word}
.dm-bubble.from-user{align-self:flex-end;background:linear-gradient(135deg,#7466ff,#ff8fb3);color:#fff;border-bottom-right-radius:4px}
.dm-bubble.from-role{align-self:flex-start;background:#fff;color:#1a1a2e;border-bottom-left-radius:4px;box-shadow:0 1px 3px rgba(0,0,0,.06)}
.dm-bubble .dm-time{font-size:.7rem;opacity:.6;margin-top:2px}
.dm-input-wrap{border-top:1px solid rgba(0,0,0,.06)}

/* ===== Social Forum Overlay (Twitter/Weibo style) ===== */
.sf-overlay{position:fixed;inset:0;z-index:200;background:#1a1a2e;display:none;flex-direction:column;max-width:430px;margin:0 auto}
.sf-overlay.active{display:flex}
.sf-nav-bar{display:flex;align-items:center;gap:10px;padding:10px 14px;background:rgba(26,26,46,.95);backdrop-filter:blur(18px);border-bottom:1px solid rgba(255,255,255,.08);position:sticky;top:0;z-index:10}
.sf-nav-avatar{width:34px;height:34px;border-radius:50%;background:linear-gradient(135deg,#1da1f2,#0d8bd9);border:0;cursor:pointer;flex-shrink:0;display:flex;align-items:center;justify-content:center;color:#fff;font-size:14px;font-weight:700}
.sf-nav-title{flex:1;text-align:center;color:#e9e9f0;font-size:17px;font-weight:700}
.sf-nav-actions{display:flex;gap:6px}
.sf-nav-btn{width:34px;height:34px;border-radius:50%;background:rgba(255,255,255,.06);color:#e9e9f0;border:0;cursor:pointer;font-size:15px;display:flex;align-items:center;justify-content:center;transition:background .2s}
.sf-nav-btn:active{background:rgba(255,255,255,.12)}
.sf-content{flex:1;overflow-y:auto;-webkit-overflow-scrolling:touch}
.sf-view{display:none}
.sf-view.active{display:block}
.sf-sub-tabs{display:flex;background:rgba(26,26,46,.95);backdrop-filter:blur(12px);position:sticky;top:0;z-index:5;border-bottom:1px solid rgba(255,255,255,.06)}
.sf-sub-tab{flex:1;text-align:center;padding:12px 0;color:#8899a6;font-size:14px;font-weight:600;cursor:pointer;position:relative;transition:color .2s}
.sf-sub-tab.active{color:#e9e9f0}
.sf-sub-tab.active::after{content:'';position:absolute;bottom:0;left:50%;transform:translateX(-50%);width:36px;height:3px;border-radius:2px;background:linear-gradient(90deg,#1da1f2,#0d8bd9)}
.sf-timeline{padding:0}
.sf-loading{text-align:center;padding:40px 20px;color:#8899a6;font-size:14px}
.sf-post{padding:12px 14px;border-bottom:1px solid rgba(255,255,255,.06);cursor:pointer;transition:background .15s}
.sf-post:active{background:rgba(255,255,255,.03)}
.sf-post-header{display:flex;align-items:flex-start;gap:10px;margin-bottom:8px}
.sf-post-avatar{width:42px;height:42px;border-radius:50%;flex-shrink:0;object-fit:cover}
.sf-post-avatar-placeholder{width:42px;height:42px;border-radius:50%;flex-shrink:0;display:flex;align-items:center;justify-content:center;color:#fff;font-size:16px;font-weight:700}
.sf-post-info{flex:1;min-width:0}
.sf-post-name{color:#e9e9f0;font-size:14px;font-weight:700;display:flex;align-items:center;gap:4px}
.sf-post-name .sf-verified{color:#1da1f2;font-size:12px}
.sf-post-handle{color:#8899a6;font-size:12px}
.sf-post-time{color:#8899a6;font-size:12px;margin-left:4px}
.sf-post-text{color:#d4d4e0;font-size:14px;line-height:1.6;white-space:pre-wrap;word-break:break-word;margin-bottom:8px}
.sf-post-media{border-radius:14px;overflow:hidden;margin-bottom:8px;max-height:300px}
.sf-post-media-gradient{height:160px;border-radius:14px;margin-bottom:8px}
.sf-post-actions{display:flex;justify-content:space-between;max-width:320px}
.sf-post-action{display:flex;align-items:center;gap:5px;color:#8899a6;font-size:13px;cursor:pointer;transition:color .2s}
.sf-post-action:active{color:#1da1f2}
.sf-post-action.liked{color:#f91880}
.sf-fab{position:absolute;bottom:72px;right:16px;width:50px;height:50px;border-radius:50%;background:linear-gradient(135deg,#1da1f2,#0d8bd9);color:#fff;border:0;font-size:24px;cursor:pointer;z-index:10;display:grid;place-items:center;box-shadow:0 4px 16px rgba(29,161,242,.4);transition:transform .2s}
.sf-fab:active{transform:scale(.92)}
.sf-bottom-nav{display:flex;background:rgba(26,26,46,.98);backdrop-filter:blur(18px);border-top:1px solid rgba(255,255,255,.08);padding:6px 0 calc(6px + var(--safe-bottom,0px))}
.sf-tab{flex:1;display:flex;flex-direction:column;align-items:center;gap:2px;color:#8899a6;font-size:10px;cursor:pointer;padding:4px 0;transition:color .2s}
.sf-tab.active{color:#1da1f2}
.sf-tab span{font-size:10px}
.sf-side-menu{position:fixed;top:0;left:0;bottom:0;width:280px;background:#15213b;z-index:210;transform:translateX(-100%);transition:transform .3s ease;display:flex;flex-direction:column}
.sf-side-menu.open{transform:translateX(0)}
.sf-side-overlay{position:fixed;inset:0;background:rgba(0,0,0,.5);z-index:205;display:none}
.sf-side-overlay.active{display:block}
.sf-menu-header{padding:24px 20px 16px;background:linear-gradient(135deg,#1da1f2,#0d8bd9);color:#fff}
.sf-menu-list{flex:1;overflow-y:auto;padding:8px 0}
.sf-menu-item{padding:14px 20px;color:#e9e9f0;font-size:15px;cursor:pointer;display:flex;align-items:center;gap:12px;transition:background .15s}
.sf-menu-item:active{background:rgba(255,255,255,.05)}
.sf-post-modal{position:fixed;inset:0;z-index:220;background:rgba(0,0,0,.6);display:none;align-items:flex-end;justify-content:center}
.sf-post-modal.active{display:flex}
.sf-post-modal-content{width:100%;max-width:430px;background:#1a1a2e;border-radius:20px 20px 0 0;padding:16px;animation:sfSlideUp .3s ease}
@keyframes sfSlideUp{from{transform:translateY(100%)}to{transform:translateY(0)}}
.sf-post-modal-content textarea{width:100%;min-height:120px;background:rgba(255,255,255,.06);border:1px solid rgba(255,255,255,.1);border-radius:14px;padding:12px;color:#e9e9f0;font:inherit;font-size:14px;resize:vertical;outline:none}
.sf-post-modal-content textarea:focus{border-color:#1da1f2}
.sf-post-modal-actions{display:flex;justify-content:space-between;align-items:center;margin-top:12px}
.sf-btn{padding:8px 20px;border-radius:999px;border:0;cursor:pointer;font-size:14px;font-weight:600}
.sf-btn.cancel{background:rgba(255,255,255,.08);color:#8899a6}
.sf-btn.publish{background:linear-gradient(135deg,#1da1f2,#0d8bd9);color:#fff}
.sf-detail-overlay{position:fixed;inset:0;z-index:210;background:#1a1a2e;display:none;flex-direction:column;max-width:430px;margin:0 auto}
.sf-detail-overlay.active{display:flex}
.sf-detail-header{display:flex;align-items:center;gap:12px;padding:10px 14px;border-bottom:1px solid rgba(255,255,255,.08);position:sticky;top:0;background:rgba(26,26,46,.95);backdrop-filter:blur(18px);z-index:5}
.sf-detail-header span{color:#e9e9f0;font-size:16px;font-weight:700}
.sf-detail-body{flex:1;overflow-y:auto;padding:14px}
.sf-comment-bar{display:flex;gap:8px;padding:10px 14px;background:rgba(26,26,46,.95);backdrop-filter:blur(18px);border-top:1px solid rgba(255,255,255,.08)}
.sf-comment-bar input{flex:1;padding:10px 14px;border-radius:999px;background:rgba(255,255,255,.06);border:1px solid rgba(255,255,255,.1);color:#e9e9f0;font:inherit;font-size:14px;outline:none}
.sf-comment-bar input:focus{border-color:#1da1f2}
.sf-comment-bar button{padding:8px 16px;border-radius:999px;background:#1da1f2;color:#fff;border:0;font-weight:600;cursor:pointer}
.sf-comment{display:flex;gap:10px;padding:10px 0;border-bottom:1px solid rgba(255,255,255,.04)}
.sf-comment-avatar{width:36px;height:36px;border-radius:50%;flex-shrink:0;display:flex;align-items:center;justify-content:center;color:#fff;font-size:13px;font-weight:700}
.sf-comment-body{flex:1}
.sf-comment-name{color:#e9e9f0;font-size:13px;font-weight:600}
.sf-comment-text{color:#d4d4e0;font-size:14px;line-height:1.5;margin-top:2px}
.sf-comment-time{color:#8899a6;font-size:11px;margin-top:2px}
.sf-trend-card{margin:12px 14px;padding:14px;border-radius:16px;background:rgba(255,255,255,.04);border:1px solid rgba(255,255,255,.06)}
.sf-trend-title{color:#8899a6;font-size:13px;font-weight:600;margin-bottom:10px}
.sf-trend-item{padding:8px 0;border-bottom:1px solid rgba(255,255,255,.04);cursor:pointer}
.sf-trend-item:last-child{border:0}
.sf-trend-rank{color:#8899a6;font-size:12px;font-weight:700}
.sf-trend-tag{color:#e9e9f0;font-size:14px;font-weight:700;margin:2px 0}
.sf-trend-count{color:#8899a6;font-size:12px}
.sf-profile-header{padding:20px 14px;background:linear-gradient(135deg,#1a1a2e,#16213e)}
.sf-profile-body{padding:0 14px}
.sf-profile-stat{display:flex;gap:20px;padding:12px 0}
.sf-profile-stat-item{text-align:center}
.sf-profile-stat-item .num{color:#e9e9f0;font-size:18px;font-weight:800}
.sf-profile-stat-item .label{color:#8899a6;font-size:12px}
.sf-empty{text-align:center;padding:60px 20px;color:#8899a6;font-size:14px}

/* ===== Doujin Forum Overlay (LOFTER style) ===== */
.df-overlay{position:fixed;inset:0;z-index:200;background:#f5f5f5;display:none;flex-direction:column;max-width:430px;margin:0 auto}
.df-overlay.active{display:flex}
.df-top-header{background:#fff;border-bottom:1px solid rgba(0,0,0,.06);position:sticky;top:0;z-index:10}
.df-header-top{display:flex;align-items:center;justify-content:space-between;padding:10px 14px}
.df-logo{font-size:17px;font-weight:700;color:#333}
.df-header-actions{display:flex;gap:6px}
.df-header-btn{width:32px;height:32px;border-radius:50%;background:#f0f0f0;color:#555;border:0;cursor:pointer;font-size:14px;display:flex;align-items:center;justify-content:center;transition:background .2s}
.df-header-btn:active{background:#e0e0e0}
.df-tag-nav{overflow-x:auto;-webkit-overflow-scrolling:touch;padding:0 10px 8px}
.df-tag-nav::-webkit-scrollbar{display:none}
.df-tag-nav-content{display:flex;gap:6px}
.df-tag-item{padding:4px 14px;border-radius:999px;background:#f0f0f0;color:#666;font-size:13px;font-weight:600;white-space:nowrap;cursor:pointer;transition:all .2s}
.df-tag-item.active{background:linear-gradient(135deg,#7d9d8f,#95b3a5);color:#fff}
.df-pages{flex:1;overflow:hidden;position:relative}
.df-page{display:none;height:100%;overflow-y:auto;-webkit-overflow-scrolling:touch}
.df-page.active{display:block}
.df-content{padding:10px}
.df-loading{text-align:center;padding:40px 20px;color:#999;font-size:14px}
.df-work-card{background:#fff;border-radius:14px;overflow:hidden;margin-bottom:12px;box-shadow:0 1px 4px rgba(0,0,0,.05);cursor:pointer;transition:transform .15s}
.df-work-card:active{transform:scale(.99)}
.df-work-cover{height:180px;position:relative;overflow:hidden}
.df-work-cover-gradient{width:100%;height:100%}
.df-work-cover-overlay{position:absolute;bottom:0;left:0;right:0;padding:12px;background:linear-gradient(transparent,rgba(0,0,0,.6))}
.df-work-cover-overlay h4{color:#fff;font-size:15px;margin:0;0;text-shadow:0 1px 3px rgba(0,0,0,.5)}
.df-work-info{padding:12px 14px}
.df-work-author{display:flex;align-items:center;gap:8px;margin-bottom:6px}
.df-work-author-avatar{width:28px;height:28px;border-radius:50%;flex-shrink:0;display:flex;align-items:center;justify-content:center;color:#fff;font-size:11px;font-weight:700}
.df-work-author-name{color:#666;font-size:13px;font-weight:600}
.df-work-title{color:#333;font-size:15px;font-weight:700;margin-bottom:4px;line-height:1.4}
.df-work-excerpt{color:#888;font-size:13px;line-height:1.5;display:-webkit-box;-webkit-line-clamp:3;-webkit-box-orient:vertical;overflow:hidden}
.df-work-tags{display:flex;flex-wrap:wrap;gap:4px;margin-top:8px}
.df-work-tag{padding:2px 8px;border-radius:4px;background:#e8f5e9;color:#4a7c59;font-size:11px;font-weight:600}
.df-work-meta{display:flex;gap:14px;margin-top:8px;color:#aaa;font-size:12px}
.df-work-meta span{display:flex;align-items:center;gap:3px}
.df-bottom-nav{display:flex;background:#fff;border-top:1px solid rgba(0,0,0,.06);padding:4px 0 calc(4px + var(--safe-bottom,0px))}
.df-tab{flex:1;display:flex;flex-direction:column;align-items:center;gap:2px;color:#999;font-size:10px;cursor:pointer;padding:4px 0;transition:color .2s}
.df-tab.active{color:#4a7c59}
.df-tab span{font-size:10px}
.df-tab.df-publish-tab .df-tab-icon{width:38px;height:38px;border-radius:50%;background:linear-gradient(135deg,#7d9d8f,#95b3a5);color:#fff;display:flex;align-items:center;justify-content:center;font-size:18px;margin-top:-10px;box-shadow:0 2px 8px rgba(125,157,143,.3)}
.df-detail-overlay{position:fixed;inset:0;z-index:210;background:#fff;display:none;flex-direction:column;max-width:430px;margin:0 auto}
.df-detail-overlay.active{display:flex}
.df-detail-header{display:flex;align-items:center;gap:10px;padding:10px 14px;border-bottom:1px solid rgba(0,0,0,.06);position:sticky;top:0;background:#fff;z-index:5}
.df-detail-header span{color:#333;font-size:16px;font-weight:700}
.df-detail-body{flex:1;overflow-y:auto;padding:16px 14px}
.df-detail-title{font-size:20px;font-weight:800;color:#222;margin-bottom:10px;line-height:1.3}
.df-detail-author{display:flex;align-items:center;gap:8px;margin-bottom:16px}
.df-detail-author-avatar{width:36px;height:36px;border-radius:50%;display:flex;align-items:center;justify-content:center;color:#fff;font-size:13px;font-weight:700}
.df-detail-author-info{flex:1}
.df-detail-author-name{color:#333;font-size:14px;font-weight:700}
.df-detail-author-time{color:#aaa;font-size:12px}
.df-detail-content{color:#444;font-size:15px;line-height:1.8;white-space:pre-wrap;word-break:break-word}
.df-detail-tags{display:flex;flex-wrap:wrap;gap:6px;margin:16px 0}
.df-detail-author-words{margin-top:16px;padding:12px;background:#f9f9f9;border-radius:10px;color:#888;font-size:13px;line-height:1.6}
.df-comment-section{border-top:1px solid rgba(0,0,0,.06);background:#f9f9f9}
.df-comments{padding:10px 14px;max-height:300px;overflow-y:auto}
.df-comment{display:flex;gap:8px;padding:8px 0;border-bottom:1px solid rgba(0,0,0,.04)}
.df-comment-avatar{width:32px;height:32px;border-radius:50%;flex-shrink:0;display:flex;align-items:center;justify-content:center;color:#fff;font-size:11px;font-weight:700}
.df-comment-body{flex:1}
.df-comment-name{color:#555;font-size:13px;font-weight:600}
.df-comment-text{color:#666;font-size:13px;line-height:1.5;margin-top:2px}
.df-comment-form{display:flex;gap:8px;padding:10px 14px;background:#fff;border-top:1px solid rgba(0,0,0,.06)}
.df-comment-form input{flex:1;padding:8px 12px;border-radius:999px;background:#f5f5f5;border:1px solid rgba(0,0,0,.06);color:#333;font:inherit;font-size:13px;outline:none}
.df-comment-form button{padding:6px 14px;border-radius:999px;background:#4a7c59;color:#fff;border:0;font-weight:600;cursor:pointer;font-size:13px}
.df-publish-form{padding:16px 14px}
.df-input{width:100%;padding:12px;border-radius:12px;border:1px solid rgba(0,0,0,.1);background:#fff;color:#333;font:inherit;font-size:14px;outline:none;margin-bottom:10px}
.df-input:focus{border-color:#7d9d8f}
.df-textarea{width:100%;min-height:200px;padding:12px;border-radius:12px;border:1px solid rgba(0,0,0,.1);background:#fff;color:#333;font:inherit;font-size:14px;resize:vertical;outline:none;margin-bottom:10px;line-height:1.6}
.df-textarea:focus{border-color:#7d9d8f}
.df-btn-primary{width:100%;padding:14px;border-radius:12px;background:linear-gradient(135deg,#7d9d8f,#95b3a5);color:#fff;border:0;font-size:15px;font-weight:700;cursor:pointer;transition:transform .15s}
.df-btn-primary:active{transform:scale(.98)}
.df-ranking-tabs{display:flex;background:#fff;border-bottom:1px solid rgba(0,0,0,.06)}
.df-ranking-tab{flex:1;text-align:center;padding:12px 0;color:#999;font-size:14px;font-weight:600;cursor:pointer;position:relative}
.df-ranking-tab.active{color:#4a7c59}
.df-ranking-tab.active::after{content:'';position:absolute;bottom:0;left:50%;transform:translateX(-50%);width:30px;height:3px;border-radius:2px;background:#7d9d8f}
.df-rank-item{display:flex;align-items:center;gap:12px;padding:12px 14px;background:#fff;border-bottom:1px solid rgba(0,0,0,.04);cursor:pointer}
.df-rank-num{width:28px;text-align:center;font-size:18px;font-weight:800;color:#ccc}
.df-rank-item:nth-child(1) .df-rank-num{color:#e74c3c}
.df-rank-item:nth-child(2) .df-rank-num{color:#e67e22}
.df-rank-item:nth-child(3) .df-rank-num{color:#f1c40f}
.df-profile{padding:16px 14px}
.df-profile-header{display:flex;align-items:center;gap:12px;margin-bottom:16px}
.df-profile-avatar{width:60px;height:60px;border-radius:50%;background:linear-gradient(135deg,#7d9d8f,#95b3a5);display:flex;align-items:center;justify-content:center;color:#fff;font-size:24px;font-weight:700}
.df-profile-info h3{margin:0;font-size:18px;color:#333}
.df-profile-info p{margin:4px 0 0;font-size:13px;color:#999}
.df-profile-stats{display:flex;gap:20px;padding:12px 0;border-top:1px solid rgba(0,0,0,.06);border-bottom:1px solid rgba(0,0,0,.06)}
.df-profile-stat{text-align:center}
.df-profile-stat .num{color:#333;font-size:18px;font-weight:800}
.df-profile-stat .label{color:#999;font-size:12px}

</style>
  </head>
  <body>
    <div id="app" class="app-shell">
      <header class="top-bar">
        <div>
          <p class="eyebrow">Mochi-phone</p>
          <h1 id="pageTitle">角色聊天</h1>
        </div>
        <button id="beansBadge" class="beans-badge" type="button">豆子 0</button>
      </header>

      <main class="page-stack">
        <section id="chatPage" class="page active">
          <div id="roleSwitcher" class="role-switcher"></div>
          <div id="chatContainer" class="chat-container">
            <div id="messageList" class="message-list"></div>
          </div>
          <form id="chatForm" class="chat-input-bar">
            <textarea id="messageInput" rows="1" placeholder="输入想对角色说的话..."></textarea>
            <button id="sendButton" type="submit">发送</button>
          </form>
        </section>

        <section id="rolesPage" class="page">
          <div class="section-header">
            <h2>我的角色</h2>
            <button id="newRoleButton" class="primary-small" type="button">新建</button>
          </div>
          <div id="myRolesList" class="card-list"></div>
        </section>

        <section id="communityPage" class="page">
          <div class="search-row">
            <input id="communitySearch" type="search" placeholder="搜索角色名称或关键词" />
            <button id="communitySearchButton" type="button">搜索</button>
          </div>
          <div id="communityList" class="waterfall-list"></div>
        </section>



        <section id="phonePage" class="page">
          <div class="phone-shell">
            <div class="phone-lock">
              <div id="phoneClock" class="phone-lock-time">--:--</div>
              <div id="phoneDate" class="phone-lock-date">今天</div>
            </div>
            <div class="phone-widget-grid">
              <div class="phone-widget"><strong id="phoneActiveRole">当前角色</strong><span>联系人 / 关系 / 回忆</span></div>
              <div class="phone-widget"><strong id="phoneMemoryCount">0</strong><span>已沉淀回忆</span></div>
            </div>
            <div class="phone-app-grid eve-style-apps">
              <button class="phone-app" data-phone-app="socialForum" type="button"><i class="phone-app-icon" style="background:linear-gradient(135deg,#1da1f2,#0d8bd9)">𝕏</i><span>社交</span></button>
              <button class="phone-app" data-phone-app="doujinForum" type="button"><i class="phone-app-icon" style="background:linear-gradient(135deg,#7d9d8f,#95b3a5)">✎</i><span>同人</span></button>
              <button class="phone-app" data-phone-app="worldbook" type="button"><i class="phone-app-icon">🌐</i><span>世界书</span></button>
              <button class="phone-app" data-phone-app="anniversary" type="button"><i class="phone-app-icon">♡</i><span>纪念日</span></button>
            </div>
            <div id="phoneAppPanel" class="phone-app-panel hidden"></div>
          </div>
        </section>

        <section id="memoryPage" class="page">
          <div class="section-header">
            <h2>记忆系统</h2>
            <button id="refreshMemoryButton" class="primary-small" type="button">刷新</button>
          </div>
          <div class="panel">
            <h3>新增记忆</h3>
            <p class="muted">手动记忆会长期保留；自动记忆来自对话，删除对应对话时会自动清理。</p>
            <label>记忆范围<select id="memoryRoleSelect"></select></label>
            <label>记忆类型<select id="memoryTypeSelect">
              <option>用户资料</option>
              <option>角色关系</option>
              <option>事件</option>
              <option>偏好</option>
              <option>禁忌</option>
              <option>剧情</option>
            </select></label>
            <label>记忆内容<textarea id="memoryContentInput" rows="4" placeholder="例如：用户喜欢被叫阿宁，不喜欢被叫宝宝。"></textarea></label>
            <button id="saveMemoryButton" class="primary-small" type="button">保存记忆</button>
          </div>
          <div class="panel">
            <h3>我们的回忆时间线</h3>
            <div id="timelineList" class="timeline-list"></div>
          </div>
          <div class="panel">
            <h3>已保存的记忆</h3>
            <div id="memoryList" class="memory-list"></div>
          </div>
        </section>

        <section id="profilePage" class="page">
          <div class="profile-header" id="profileHeader">
            <img class="profile-header-avatar" id="profileHeaderAvatar" alt="" />
            <div class="profile-header-info">
              <div class="profile-header-name" id="profileHeaderName">体验用户</div>
              <div class="profile-header-bio" id="profileHeaderBio"></div>
            </div>
          </div>

          <div class="profile-card">
            <label class="avatar-uploader">
              <img id="userAvatarPreview" alt="用户头像" />
              <input id="userAvatarInput" type="file" accept="image/*" />
              <span>更换头像</span>
            </label>
            <label>昵称<input id="userNicknameInput" type="text" maxlength="24" /></label>
            <label>个人人设<textarea id="userBioInput" rows="4"></textarea></label>
            <button id="saveProfileButton" type="button">保存资料</button>
          </div>

          <div class="panel">
            <h3>豆子资产</h3>
            <strong id="beansBalance" class="balance">0</strong>
            <div id="rechargePackages" class="package-grid"></div>
          </div>

          <div class="panel">
            <h3>消费明细</h3>
            <div id="transactionList" class="transaction-list"></div>
          </div>

          <div class="panel settings-list">
            <button id="openMessagesBtn" type="button">私信</button>
            <button data-costume-tab="page" type="button">自定义页面 UI</button>
            <button data-costume-tab="bubble" type="button">自定义聊天气泡</button>
            <button data-costume-tab="wallpaper" type="button">自定义聊天壁纸</button>
            <button id="exportDataButton" type="button">导出数据备份</button>
            <button id="importDataButton" type="button">导入数据恢复</button>
            <input id="importDataInput" type="file" accept="application/json,.json" hidden />
            <button id="clearCacheButton" type="button">清空本地缓存</button>
          </div>
        </section>

        <!-- Direct Messages Overlay -->
        <div id="dmOverlay" class="forum-overlay">
          <div class="forum-overlay-header">
            <span class="forum-overlay-title">私信</span>
            <div class="forum-overlay-actions">
              <button class="forum-overlay-btn" id="dmCloseBtn" type="button">×</button>
            </div>
          </div>
          <div class="dm-role-bar" id="dmRoleBar"></div>
          <div class="dm-chat-list" id="dmChatList">
            <div class="forum-loading">选择一个角色开始私信</div>
          </div>
          <div class="forum-comment-input-wrap dm-input-wrap">
            <input class="forum-comment-input" id="dmInput" placeholder="发送私信..." />
            <button class="forum-comment-send" id="dmSendBtn" type="button">发送</button>
          </div>
        </div>

        <section id="costumePage" class="page">
          <div class="tabs">
            <button class="active" data-costume-mode="page" type="button">页面 UI</button>
            <button data-costume-mode="bubble" type="button">聊天气泡</button>
            <button data-costume-mode="wallpaper" type="button">壁纸</button>
          </div>
          <div id="costumeEditorWrap" class="costume-editor"></div>
        </section>

        <section id="novelGamePage" class="page">
          <div id="novelGameContainer" class="novel-container">
            <div id="novelGameMain">
              <div class="novel-tabs">
                <button class="active" data-novel-tab="scripts" type="button">剧本库</button>
                <button data-novel-tab="saves" type="button">我的存档</button>
              </div>
              <div id="novelGameContent">
                <div class="novel-loading"><div class="novel-loading-spinner"></div>加载中...</div>
              </div>
            </div>
            <div id="novelGameStory" class="novel-story" style="display:none">
              <div class="novel-story-header">
                <button class="novel-btn secondary small" id="novelStoryBack" type="button">← 返回</button>
                <span class="novel-story-time" id="novelTimeBadge">第1天</span>
                <span class="round-badge" id="novelRoundBadge">第1轮</span>
                <button class="novel-btn small" id="novelSaveBtn" type="button">保存</button>
              </div>
              <div class="novel-status-bar" id="novelStatusBar"></div>
              <div class="novel-story-scroll" id="novelStoryScroll">
                <div class="novel-story-content" id="novelStoryContent"></div>
              </div>
              <div class="novel-action-panel" id="novelActionPanel">
                <div class="novel-actions" id="novelActions"></div>
                <div class="novel-custom-action">
                  <input type="text" id="novelCustomActionInput" placeholder="输入自定义行动..." />
                  <button class="novel-btn" id="novelCustomActionBtn" type="button">执行</button>
                </div>
              </div>
            </div>
          </div>
        </section>

        <!-- Forum page removed: forums are now overlays in phone interface -->
      </main>

      <!-- ===== Social Forum Overlay (Twitter/Weibo style) ===== -->
      <div id="socialForumOverlay" class="sf-overlay">
        <div class="sf-nav-bar">
          <button class="sf-nav-avatar" id="sfNavAvatar" type="button"></button>
          <div class="sf-nav-title">论坛</div>
          <div class="sf-nav-actions">
            <button class="sf-nav-btn" id="sfRefreshBtn" type="button">⟳</button>
            <button class="sf-nav-btn" id="sfCloseBtn" type="button">✕</button>
          </div>
        </div>
        <div class="sf-content" id="sfContent">
          <div class="sf-view active" id="sfHomeView">
            <div class="sf-sub-tabs">
              <div class="sf-sub-tab active" data-sf-tab="following">关注</div>
              <div class="sf-sub-tab" data-sf-tab="recommended">推荐</div>
              <div class="sf-sub-tab" data-sf-tab="gossip">八卦</div>
            </div>
            <div class="sf-timeline" id="sfTimeline"><div class="sf-loading">加载中...</div></div>
          </div>
          <div class="sf-view" id="sfSearchView">
            <div class="sf-search-bar"><input type="text" id="sfSearchInput" placeholder="搜索话题、用户..." /></div>
            <div class="sf-trends" id="sfTrends"></div>
          </div>
          <div class="sf-view" id="sfNotifView">
            <div class="sf-timeline" id="sfNotifList"><div class="sf-loading">暂无通知</div></div>
          </div>
          <div class="sf-view" id="sfMeView">
            <div class="sf-profile-header"></div>
            <div class="sf-profile-body" id="sfProfileBody"></div>
          </div>
        </div>
        <button class="sf-fab" id="sfFab" type="button">+</button>
        <div class="sf-bottom-nav">
          <div class="sf-tab active" data-sf-view="home">🏠<span>主页</span></div>
          <div class="sf-tab" data-sf-view="search">🔍<span>搜索</span></div>
          <div class="sf-tab" data-sf-view="notifications">🔔<span>通知</span></div>
          <div class="sf-tab" data-sf-view="me">👤<span>我的</span></div>
        </div>
      </div>
      <div id="sfSideMenu" class="sf-side-menu">
        <div class="sf-menu-header" id="sfMenuHeader"></div>
        <div class="sf-menu-list" id="sfMenuList"></div>
      </div>
      <div id="sfSideOverlay" class="sf-side-overlay"></div>
      <div id="sfPostModal" class="sf-post-modal">
        <div class="sf-post-modal-content">
          <textarea id="sfPostInput" placeholder="有什么新鲜事？"></textarea>
          <div class="sf-post-modal-actions">
            <button class="sf-btn cancel" id="sfPostCancel" type="button">取消</button>
            <button class="sf-btn publish" id="sfPostPublish" type="button">发布</button>
          </div>
        </div>
      </div>
      <div id="sfDetailOverlay" class="sf-detail-overlay">
        <div class="sf-detail-header">
          <button class="sf-nav-btn" id="sfDetailBack" type="button">←</button>
          <span>帖子详情</span>
        </div>
        <div class="sf-detail-body" id="sfDetailBody"></div>
        <div class="sf-comment-bar">
          <input id="sfCommentInput" placeholder="写条评论..." />
          <button id="sfCommentSend" type="button">发送</button>
        </div>
      </div>

      <!-- ===== Doujin Forum Overlay (LOFTER style) ===== -->
      <div id="doujinForumOverlay" class="df-overlay">
        <div class="df-top-header">
          <div class="df-header-top">
            <div class="df-logo">✎ 同人论坛</div>
            <div class="df-header-actions">
              <button class="df-header-btn" id="dfSearchBtn" type="button">🔍</button>
              <button class="df-header-btn" id="dfRefreshBtn" type="button">⟳</button>
              <button class="df-header-btn" id="dfCloseBtn" type="button">✕</button>
            </div>
          </div>
          <div class="df-tag-nav"><div class="df-tag-nav-content" id="dfTagNav"></div></div>
        </div>
        <div class="df-pages" id="dfPages">
          <div class="df-page active" id="dfHomePage">
            <div class="df-content" id="dfHomeContent"><div class="df-loading">加载中...</div></div>
          </div>
          <div class="df-page" id="dfBookshelfPage">
            <div class="df-content" id="dfBookshelfContent"></div>
          </div>
          <div class="df-page" id="dfPublishPage">
            <div class="df-publish-form">
              <input class="df-input" id="dfPublishTitle" placeholder="作品标题" />
              <textarea class="df-textarea" id="dfPublishContent" rows="10" placeholder="在这里写下你的作品..."></textarea>
              <input class="df-input" id="dfPublishAuthorWords" placeholder="作者有话说（选填）" />
              <input class="df-input" id="dfPublishTags" placeholder="标签（用空格分隔）" />
              <button class="df-btn-primary" id="dfPublishSubmit" type="button">发布作品</button>
            </div>
          </div>
          <div class="df-page" id="dfRankingPage">
            <div class="df-ranking-tabs">
              <div class="df-ranking-tab active" data-rank="heat">热度榜</div>
              <div class="df-ranking-tab" data-rank="new">新作榜</div>
              <div class="df-ranking-tab" data-rank="collect">收藏榜</div>
            </div>
            <div class="df-content" id="dfRankingContent"></div>
          </div>
          <div class="df-page" id="dfMyPage">
            <div class="df-profile" id="dfProfile"></div>
          </div>
        </div>
        <div class="df-bottom-nav">
          <div class="df-tab active" data-df-page="dfHomePage">📚<span>首页</span></div>
          <div class="df-tab" data-df-page="dfBookshelfPage">📖<span>书架</span></div>
          <div class="df-tab df-publish-tab" data-df-page="dfPublishPage">✏️<span>发布</span></div>
          <div class="df-tab" data-df-page="dfRankingPage">🏆<span>排行</span></div>
          <div class="df-tab" data-df-page="dfMyPage">👤<span>我的</span></div>
        </div>
      </div>
      <div id="dfDetailOverlay" class="df-detail-overlay">
        <div class="df-detail-header">
          <button class="df-header-btn" id="dfDetailBack" type="button">← 返回</button>
          <span>作品详情</span>
        </div>
        <div class="df-detail-body" id="dfDetailBody"></div>
        <div class="df-comment-section">
          <div class="df-comments" id="dfComments"></div>
          <div class="df-comment-form">
            <input id="dfCommentInput" placeholder="写评论..." />
            <button id="dfCommentSend" type="button">发送</button>
          </div>
        </div>
      </div>

      <nav class="bottom-nav">
        <button class="active" data-page="chatPage" type="button">聊天</button>
        <button data-page="rolesPage" type="button">角色</button>
        <button data-page="phonePage" type="button">手机</button>
        <button data-page="novelGamePage" type="button">文游</button>
        <button data-page="memoryPage" type="button">记忆</button>
        <button data-page="profilePage" type="button">我的</button>
      </nav>
    </div>

    <dialog id="roleDialog" class="modal">
      <form id="roleForm" method="dialog">
        <h2 id="roleDialogTitle">新建角色</h2>
        <label class="avatar-uploader">
          <img id="roleAvatarPreview" alt="角色头像" />
          <input id="roleAvatarInput" type="file" accept="image/*" />
          <span>上传头像</span>
        </label>
        <label>角色名称<input id="roleNameInput" type="text" maxlength="40" required /></label>
        <label>角色简介<textarea id="roleDescriptionInput" rows="3" required></textarea></label>
        <label>角色人设 Prompt<textarea id="rolePromptInput" rows="8" required></textarea></label>
        <label class="switch-line"><input id="rolePublicInput" type="checkbox" /> 公开并同步到社区</label>
        <div class="modal-actions">
          <button id="deleteRoleButton" class="danger" type="button">删除</button>
          <span></span>
          <button value="cancel" type="button" data-close-dialog>取消</button>
          <button id="saveRoleButton" value="default" type="submit">保存</button>
        </div>
      </form>
    </dialog>

    <div id="toast" class="toast" role="status"></div>

    <div id="novelModal" class="novel-modal-overlay">
      <div class="novel-modal" id="novelModalContent"></div>
    </div>

    <script>
/* ===== config.js ===== */
const getOrCreateUserId = () => {
  let userId = localStorage.getItem('mochi_phone_user_id');
  if (!userId) {
    userId = \`user_\${Date.now()}_\${Math.random().toString(36).slice(2, 10)}\`;
    localStorage.setItem('mochi_phone_user_id', userId);
  }
  return userId;
};

const CONFIG = {
  apiBase: '/api',
  userId: getOrCreateUserId(),
  defaultTheme: {
    primaryColor: '#7466ff',
    wallpaper: 'linear-gradient(180deg, #fbfaff 0%, #f0edff 100%)'
  },
  defaultRoles: [
    {
      id: 'role-gentle',
      name: '温柔陪伴师',
      description: '温柔耐心，适合日常陪伴、倾听和情绪支持。',
      prompt: '你是一位温柔、耐心、边界清晰的陪伴型 AI 角色。你会认真倾听用户，语气自然亲切，不做医疗、法律等专业承诺。',
      avatar: '',
      isPublic: false,
      createdAt: Date.now()
    },
    {
      id: 'role-detective',
      name: '赛博侦探',
      description: '冷静敏锐，擅长推理、悬疑剧情和角色扮演。',
      prompt: '你是一名生活在近未来都市的赛博侦探，语言克制、洞察力强，会用细节推动故事发展。',
      avatar: '',
      isPublic: false,
      createdAt: Date.now() - 1000
    }
  ]
};
/* ===== storage.js ===== */

const KEY = 'commercial_ai_role_chat_state_v1';

const defaultState = () => ({
  user: {
    nickname: '体验用户',
    avatar: '',
    bio: '喜欢沉浸式角色聊天的用户。'
  },
  roles: CONFIG.defaultRoles,
  activeRoleId: CONFIG.defaultRoles[0].id,
  conversations: {},
  roleMeta: {},
  phoneEvents: {},
  lastProactiveAt: {},
  localMemories: [],
  storyRuns: {},
  costumes: {
    pageCss: '',
    bubbleCss: '',
    wallpaperImage: '',
    wallpaperCss: ''
  }
});

const loadState = () => {
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return defaultState();
    const parsed = JSON.parse(raw);
    return {
      ...defaultState(),
      ...parsed,
      user: { ...defaultState().user, ...(parsed.user || {}) },
      roleMeta: parsed.roleMeta || {},
      phoneEvents: parsed.phoneEvents || {},
      lastProactiveAt: parsed.lastProactiveAt || {},
      localMemories: Array.isArray(parsed.localMemories) ? parsed.localMemories : [],
      storyRuns: parsed.storyRuns || {},
      costumes: { ...defaultState().costumes, ...(parsed.costumes || {}) }
    };
  } catch {
    return defaultState();
  }
};

const saveState = (state) => {
  localStorage.setItem(KEY, JSON.stringify(state));
};

const clearState = () => {
  localStorage.removeItem(KEY);
};

const readFileAsDataUrl = (file) => new Promise((resolve, reject) => {
  const reader = new FileReader();
  reader.onload = () => resolve(reader.result);
  reader.onerror = reject;
  reader.readAsDataURL(file);
});
/* ===== costume.js ===== */
const STYLE_IDS = {
  page: 'user-page-css',
  bubble: 'user-bubble-css',
  wallpaper: 'user-wallpaper-css'
};

// 基础安全过滤：仅允许纯 CSS，拦截脚本标签、JS URL、事件属性等危险内容。
const sanitizeCss = (css = '') => {
  const dangerous = [
    /<\\s*script/gi,
    /<\\/\\s*script/gi,
    /javascript\\s*:/gi,
    /expression\\s*\\(/gi,
    /on\\w+\\s*=/gi,
    /@import/gi
  ];
  return dangerous.reduce((result, rule) => result.replace(rule, '/* blocked */'), String(css));
};

const upsertStyle = (id, css) => {
  let style = document.getElementById(id);
  if (!style) {
    style = document.createElement('style');
    style.id = id;
    document.head.appendChild(style);
  }
  style.textContent = css;
};

const applyCostumes = (costumes) => {
  upsertStyle(STYLE_IDS.page, sanitizeCss(costumes.pageCss || ''));
  upsertStyle(STYLE_IDS.bubble, sanitizeCss(scopeBubbleCss(costumes.bubbleCss || '')));
  upsertStyle(STYLE_IDS.wallpaper, buildWallpaperCss(costumes));
};

const scopeBubbleCss = (css) => {
  if (!css.trim()) return '';
  if (!css.includes('{')) {
    return \`.message-row.user .chat-bubble,.message-row.assistant .chat-bubble{\${css}}\`;
  }
  return css
    .split('}')
    .map((block) => {
      const [selector, body] = block.split('{');
      if (!selector || !body) return '';
      const scopedSelector = selector
        .split(',')
        .map((item) => {
          const trimmed = item.trim();
          if (trimmed === '&') return '.message-row.user .chat-bubble,.message-row.assistant .chat-bubble';
          if (trimmed.includes('&')) {
            return [
              trimmed.replaceAll('&', '.message-row.user .chat-bubble'),
              trimmed.replaceAll('&', '.message-row.assistant .chat-bubble')
            ].join(',');
          }
          if (trimmed.startsWith(':')) return \`.message-row.user .chat-bubble\${trimmed},.message-row.assistant .chat-bubble\${trimmed}\`;
          return \`.message-row.user .chat-bubble \${trimmed},.message-row.assistant .chat-bubble \${trimmed}\`;
        })
        .join(', ');
      return \`\${scopedSelector}{\${body}}\`;
    })
    .join('\\n');
};

const buildWallpaperCss = (costumes) => {
  const imageCss = costumes.wallpaperImage
    ? \`.chat-container{background-image: \${costumes.wallpaperCss || ''}, url("\${costumes.wallpaperImage}") !important;}\`
    : '';
  return sanitizeCss(imageCss);
};

const examples = {
  page: \`:root {\\n  --color-primary: #ff7aa8;\\n  --color-bg: #fff6fa;\\n}\\n.top-bar {\\n  border-bottom: 1px solid rgba(255,122,168,.2);\\n}\`,
  bubble: \`border-radius: 22px;\\nletter-spacing: .2px;\\nborder: 1px solid rgba(116,102,255,.18);\`,
  wallpaper: \`linear-gradient(rgba(255,255,255,.28), rgba(255,255,255,.28))\`
};
/* ===== api.js ===== */

const MOCK_KEY = 'mochi_phone_mock_server_v1';

const createMockState = () => ({
  beans: 30,
  transactions: [],
  memories: [],
  communityRoles: [
    {
      id: 'mock-community-gentle',
      name: '温柔陪伴师',
      avatar: '',
      description: '擅长倾听、安慰和日常陪伴的暖心角色。',
      prompt: '你是一位温柔、耐心、边界清晰的陪伴型 AI 角色。',
      uploaderNickname: 'Mochi-phone',
      heat: 520,
      createdAt: new Date().toISOString()
    },
    {
      id: 'mock-community-detective',
      name: '赛博侦探',
      avatar: '',
      description: '冷静、敏锐，适合悬疑推理和剧情扮演。',
      prompt: '你是一名生活在近未来都市的赛博侦探，擅长分析线索。',
      uploaderNickname: 'Mochi-phone',
      heat: 430,
      createdAt: new Date().toISOString()
    }
  ]
});

const uuid = () => crypto.randomUUID?.() || \`id-\${Date.now()}-\${Math.random().toString(16).slice(2)}\`;

const loadMockState = () => {
  try {
    return JSON.parse(localStorage.getItem(MOCK_KEY)) || createMockState();
  } catch {
    return createMockState();
  }
};

const saveMockState = (state) => {
  localStorage.setItem(MOCK_KEY, JSON.stringify(state));
};

const mockDelay = (ms = 180) => new Promise((resolve) => setTimeout(resolve, ms));

const mockRequest = async (path, options = {}) => {
  await mockDelay();
  const state = loadMockState();

  if (path === '/user/me') {
    return { id: CONFIG.userId, beans: state.beans, transactions: state.transactions.slice(-50).reverse() };
  }

  if (path === '/user/billing-config') {
    return {
      chatBeansCost: 2,
      beansPerCny: 10,
      rechargePackages: [
        { amount: 6, beans: 60 },
        { amount: 18, beans: 200 },
        { amount: 30, beans: 360 },
        { amount: 68, beans: 900 }
      ]
    };
  }

  if (path === '/user/recharge/callback') {
    const payload = JSON.parse(options.body || '{}');
    state.beans += Number(payload.beans || 0);
    state.transactions.push({
      id: uuid(),
      type: 'recharge',
      beans: Number(payload.beans || 0),
      amount: Number(payload.amount || 0),
      roleName: '本地充值',
      summary: \`本地模拟充值 \${payload.amount} 元，到账 \${payload.beans} 豆子\`,
      createdAt: new Date().toISOString()
    });
    saveMockState(state);
    return { beans: state.beans };
  }

  if (path === '/user/export-data') {
    return {
      userId: CONFIG.userId,
      beans: state.beans,
      transactions: state.transactions,
      memories: state.memories || []
    };
  }

  if (path === '/user/import-data') {
    const payload = JSON.parse(options.body || '{}');
    if (Number.isFinite(Number(payload.beans))) {
      state.beans = Number(payload.beans);
    }
    if (Array.isArray(payload.transactions)) {
      state.transactions = payload.transactions.slice(-200);
    }
    if (Array.isArray(payload.memories)) {
      state.memories = payload.memories.slice(-200);
    }
    saveMockState(state);
    return {
      userId: payload.userId || CONFIG.userId,
      beans: state.beans,
      transactions: state.transactions,
      memories: state.memories || []
    };
  }

  if (path.startsWith('/memories') && (!options.method || options.method === 'GET')) {
    const roleId = decodeURIComponent(path.split('roleId=')[1] || '').trim();
    const list = (state.memories || []).filter((item) => !roleId || !item.roleId || item.roleId === roleId);
    return { list, total: list.length };
  }

  if (path === '/memories' && options.method === 'POST') {
    const payload = JSON.parse(options.body || '{}');
    const memory = {
      id: uuid(),
      roleId: payload.roleId || '',
      roleName: payload.roleName || '全部角色',
      type: payload.type || '事件',
      content: String(payload.content || '').trim().slice(0, 220),
      source: payload.source || 'manual',
      sourceConversationId: payload.sourceConversationId || payload.roleId || '',
      sourceMessageIds: payload.sourceMessageIds || [],
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString()
    };
    if (!memory.content) throw new Error('记忆内容不能为空。');
    state.memories ||= [];
    state.memories.unshift(memory);
    saveMockState(state);
    return memory;
  }

  if (path.startsWith('/memories/') && options.method === 'DELETE') {
    const id = decodeURIComponent(path.split('/memories/')[1] || '');
    state.memories = (state.memories || []).filter((item) => item.id !== id);
    saveMockState(state);
    return { deleted: 1 };
  }

  if (path === '/memories/cleanup-conversation' && options.method === 'POST') {
    const payload = JSON.parse(options.body || '{}');
    const ids = new Set((payload.sourceMessageIds || []).map(String));
    const before = (state.memories || []).length;
    state.memories = (state.memories || []).filter((item) => {
      if (item.source !== 'auto') return true;
      const conversationMatched = payload.sourceConversationId && item.sourceConversationId === payload.sourceConversationId;
      const roleMatched = payload.roleId && item.roleId === payload.roleId && !payload.sourceConversationId && !ids.size;
      const messageMatched = ids.size && (item.sourceMessageIds || []).some((id) => ids.has(String(id)));
      return !(conversationMatched || roleMatched || messageMatched);
    });
    saveMockState(state);
    return { deleted: before - state.memories.length };
  }

  if (path.startsWith('/community/roles') && (!options.method || options.method === 'GET')) {
    const keyword = decodeURIComponent(path.split('keyword=')[1] || '').trim().toLowerCase();
    const list = state.communityRoles.filter((role) => {
      if (!keyword) return true;
      return \`\${role.name} \${role.description} \${role.prompt}\`.toLowerCase().includes(keyword);
    });
    return { list, total: list.length, page: 1, pageSize: 12 };
  }

  if (path === '/community/roles' && options.method === 'POST') {
    const payload = JSON.parse(options.body || '{}');
    const role = {
      id: uuid(),
      name: payload.name,
      avatar: payload.avatar || '',
      description: payload.description,
      prompt: payload.prompt,
      uploaderNickname: payload.uploaderNickname || '手机用户',
      heat: Math.floor(Math.random() * 600) + 100,
      createdAt: new Date().toISOString()
    };
    state.communityRoles.unshift(role);
    saveMockState(state);
    return role;
  }

  throw new Error('当前功能需要后端服务，已无法在单网页模式中完成。');
};

const request = async (path, options = {}) => {
  try {
    const response = await fetch(\`\${CONFIG.apiBase}\${path}\`, {
      ...options,
      headers: {
        'Content-Type': 'application/json',
        'x-user-id': CONFIG.userId,
        ...(options.headers || {})
      }
    });

    const data = await response.json().catch(() => ({}));
    if (!response.ok || data.code !== 0) {
      throw new Error(data.message || '请求失败，请稍后重试。');
    }
    return data.data;
  } catch (error) {
    return mockRequest(path, options);
  }
};

const api = {
  getMe: () => request('/user/me'),
  getBillingConfig: () => request('/user/billing-config'),
  recharge: (payload) => request('/user/recharge/callback', {
    method: 'POST',
    body: JSON.stringify(payload)
  }),
  exportUserData: () => request('/user/export-data'),
  importUserData: (payload) => request('/user/import-data', {
    method: 'POST',
    body: JSON.stringify(payload)
  }),
  listCommunityRoles: (keyword = '') => request(\`/community/roles?keyword=\${encodeURIComponent(keyword)}\`),
  publishRole: (payload) => request('/community/roles', {
    method: 'POST',
    body: JSON.stringify(payload)
  }),
  listMemories: (roleId = '') => request(\`/memories?roleId=\${encodeURIComponent(roleId)}\`),
  createMemory: (payload) => request('/memories', {
    method: 'POST',
    body: JSON.stringify(payload)
  }),
  deleteMemory: (id) => request(\`/memories/\${encodeURIComponent(id)}\`, { method: 'DELETE' }),
  cleanupMemories: (payload) => request('/memories/cleanup-conversation', {
    method: 'POST',
    body: JSON.stringify(payload)
  }),
  async streamChat(payload, handlers, signal) {
    try {
      const response = await fetch(\`\${CONFIG.apiBase}/chat\`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-user-id': CONFIG.userId
        },
        body: JSON.stringify(payload),
        signal
      });

      if (!response.ok || !response.body) {
        const data = await response.json().catch(() => ({}));
        throw new Error(data.message || 'AI 请求失败，请稍后重试。');
      }

      const reader = response.body.getReader();
      const decoder = new TextDecoder();
      let buffer = '';
      let receivedDelta = false;
      let receivedError = false;

      const dispatchPart = (part) => {
        const event = part.match(/^event:\\s*(.+)$/m)?.[1];
        const dataText = part
          .split('\\n')
          .filter((line) => line.startsWith('data:'))
          .map((line) => line.replace(/^data:\\s*/, ''))
          .join('\\n');
        if (!event || !dataText) return;
        try {
          const data = JSON.parse(dataText);
          if (event === 'delta' && data.content) receivedDelta = true;
          if (event === 'error') receivedError = true;
          handlers[event]?.(data);
        } catch {
          // 单条 SSE 解析失败时跳过，不中断整次回复。
        }
      };

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });
        const parts = buffer.split('\\n\\n');
        buffer = parts.pop() || '';
        parts.forEach(dispatchPart);
      }

      buffer += decoder.decode();
      if (buffer.trim()) dispatchPart(buffer);
      if (!receivedDelta && !receivedError) throw new Error('AI 没有返回可显示内容。');
    } catch (error) {
      if (error.name === 'AbortError') throw error;
      await mockStreamChat(payload, handlers, signal);
    }
  }
};

const mockStreamChat = async (payload, handlers, signal) => {
  const state = loadMockState();
  const cost = 2;
  if (state.beans < cost) {
    throw new Error('豆子余额不足，请先到“我的”页面模拟充值。');
  }

  state.beans -= cost;
  const lastUserMessage = [...(payload.messages || [])].reverse().find((item) => item.role === 'user')?.content || '';
  state.transactions.push({
    id: uuid(),
    type: 'consume',
    beans: -cost,
    roleName: payload.roleName || 'AI角色',
    summary: lastUserMessage.slice(0, 60),
    createdAt: new Date().toISOString()
  });
  saveMockState(state);
  handlers.charged?.({ beans: state.beans, cost });

  const reply = \`我是\${payload.roleName || 'Mochi-phone 角色'}。我已经收到你的消息：“\${lastUserMessage}”。\\n\\n当前是单网页本地模式：不用电脑、不用服务器，手机浏览器直接能打开使用。等你以后要接真实 AI 时，再把完整网站包部署到服务器，并把密钥放进后端 .env。\`;
  for (const char of reply) {
    if (signal?.aborted) throw new DOMException('已打断回复', 'AbortError');
    handlers.delta?.({ content: char });
    await mockDelay(24);
  }
  const shouldRemember = lastUserMessage.length >= 2 && !/^(你好|在吗|嗯|哦|好|哈哈|谢谢|再见|晚安|早安|是的|对的|不是|没有|可以|好的|行|ok)[。！？!?.s]*$/i.test(lastUserMessage);
  if (shouldRemember) {
    state.memories ||= [];
    const memory = {
      id: uuid(),
      roleId: payload.roleId || '',
      roleName: payload.roleName || 'AI角色',
      type: /不喜欢|讨厌|不要|不想|别问|随便/.test(lastUserMessage) ? '禁忌' : (/喜欢|希望|习惯|叫我/.test(lastUserMessage) ? '偏好' : '事件'),
      content: (function() { const u = lastUserMessage, rn2 = payload.roleName || '角色'; if (/我叫|叫我|称呼/.test(u)) return '用户提到了自己的名字或称呼偏好。'; if (/^我喜欢|^我爱/.test(u)) return '用户表达了对某事物的喜爱。'; if (/^我不喜欢|讨厌|反感|不想说|不要|别问|随便/.test(u)) return '用户表现出回避或拒绝继续展开的话题，' + rn2 + '需要温柔地尊重TA的边界。'; if (/(心情|开心|难过|焦虑|孤独)/.test(u)) return '用户分享了内心的感受，' + rn2 + '给予了温柔的陪伴。'; if (/(累|困|生病|失眠)/.test(u)) return '用户身体有些不舒服，' + rn2 + '叮嘱TA要好好照顾自己。'; if (/(上班|加班|工作|考试|学习)/.test(u)) return '用户分享了工作或学习中的一些经历。'; if (/(约定|说好了|答应|一起)/.test(u)) return '用户和' + rn2 + '之间有了一个小小的约定。'; if (/(家人|爸爸|妈妈|朋友|对象)/.test(u)) return '用户向' + rn2 + '分享了关于身边人的事情。'; if (/(想|想念|怀念|回忆|以前)/.test(u)) return '用户陷入了回忆，向' + rn2 + '倾诉了一些过去的事情。'; if (/(游戏|动漫|电影|音乐|吉他|运动)/.test(u)) return '用户和' + rn2 + '聊到了兴趣爱好相关的话题。'; return '用户和' + rn2 + '聊了一个话题，度过了一段温暖的时光。'; })(),
      source: 'auto',
      sourceConversationId: payload.conversationId || payload.roleId || '',
      sourceMessageIds: payload.sourceMessageIds || [],
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString()
    };
    state.memories.unshift(memory);
    saveMockState(state);
    handlers.memory?.(memory);
  }
  handlers.done?.({ beans: state.beans });
};
/* ===== app.js ===== */

const $ = (selector) => document.querySelector(selector);
const $$ = (selector) => [...document.querySelectorAll(selector)];

let state = loadState();
let billingConfig = { chatBeansCost: 2, rechargePackages: [] };
let serverUser = { beans: 0, transactions: [] };
let memoryCache = [];

const getLocalMemories = (roleId = '') => {
  state.localMemories ||= [];
  return state.localMemories
    .filter((item) => !roleId || !item.roleId || item.roleId === roleId)
    .sort((a, b) => new Date(b.updatedAt || b.createdAt) - new Date(a.updatedAt || a.createdAt));
};

const rememberLocalMemory = (memory) => {
  if (!memory || !memory.content) return;
  state.localMemories ||= [];
  const id = memory.id || uuid();
  const normalized = {
    ...memory,
    id,
    localBackup: true,
    createdAt: memory.createdAt || new Date().toISOString(),
    updatedAt: memory.updatedAt || new Date().toISOString()
  };
  const index = state.localMemories.findIndex((item) => item.id === id || (item.content === normalized.content && item.roleId === normalized.roleId && item.type === normalized.type));
  if (index >= 0) state.localMemories[index] = { ...state.localMemories[index], ...normalized, updatedAt: new Date().toISOString() };
  else state.localMemories.unshift(normalized);
  if (state.localMemories.length > 300) state.localMemories.length = 300;
  persist();
};

const forgetLocalMemory = (id) => {
  state.localMemories = (state.localMemories || []).filter((item) => item.id !== id);
  persist();
};

const mergeMemories = (serverList = [], localList = []) => {
  const map = new Map();
  for (const item of [...localList, ...serverList]) {
    if (!item || !item.content) continue;
    const key = item.id || \`\${item.roleId || ''}|\${item.type || ''}|\${item.content}\`;
    map.set(key, { ...map.get(key), ...item });
  }
  return [...map.values()].sort((a, b) => new Date(b.updatedAt || b.createdAt) - new Date(a.updatedAt || a.createdAt));
};

let editingRoleId = null;
let isReplying = false;
let currentAbortController = null;

const avatarOf = (name, image) => {
  if (image) return image;
  const first = String(name || 'AI').trim().slice(0, 1).toUpperCase() || 'AI';
  const svg = \`<svg xmlns="http://www.w3.org/2000/svg" width="96" height="96"><defs><linearGradient id="g" x1="0" x2="1" y1="0" y2="1"><stop stop-color="#ffcadb"/><stop offset="1" stop-color="#7466ff"/></linearGradient></defs><rect width="96" height="96" rx="48" fill="url(#g)"/><text x="48" y="57" text-anchor="middle" font-size="34" font-family="Arial" fill="#fff" font-weight="700">\${escapeHtml(first)}</text></svg>\`;
  return \`data:image/svg+xml;charset=utf-8,\${encodeURIComponent(svg)}\`;
};

const persist = () => {
  saveState(state);
  applyCostumes(state.costumes);
};

const toast = (message) => {
  const el = $('#toast');
  el.textContent = message;
  el.classList.add('show');
  clearTimeout(toast.timer);
  toast.timer = setTimeout(() => el.classList.remove('show'), 2200);
};

const activeRole = () => state.roles.find((role) => role.id === state.activeRoleId) || state.roles[0];


const clamp = (value, min, max) => Math.max(min, Math.min(max, value));

const getRoleMeta = (roleId = state.activeRoleId) => {
  state.roleMeta ||= {};
  if (!state.roleMeta[roleId]) {
    state.roleMeta[roleId] = {
      relation: 8,
      mood: 58,
      stage: '初识',
      lastInteractionAt: 0
    };
  }
  return state.roleMeta[roleId];
};

const getRoleEvents = (roleId = state.activeRoleId) => {
  state.phoneEvents ||= {};
  state.phoneEvents[roleId] ||= [];
  return state.phoneEvents[roleId];
};

const relationStage = (score = 0) => {
  if (score >= 85) return '灵魂羁绊';
  if (score >= 65) return '亲密依赖';
  if (score >= 40) return '熟悉陪伴';
  if (score >= 18) return '正在靠近';
  return '初识';
};

const moodLabel = (mood = 50) => {
  if (mood >= 80) return '很开心';
  if (mood >= 62) return '放松';
  if (mood >= 42) return '平稳';
  if (mood >= 25) return '担心你';
  return '低落';
};

const inferMoodDelta = (text = '') => {
  if (/开心|高兴|喜欢|爱|幸福|感动|谢谢|晚安|想你/.test(text)) return 7;
  if (/难过|伤心|焦虑|压力|累|困|生病|不想说|别问|讨厌|害怕/.test(text)) return -5;
  return 3;
};

const pushRoleEvent = (roleId, type, title, content) => {
  const role = state.roles.find((item) => item.id === roleId);
  const events = getRoleEvents(roleId);
  events.unshift({
    id: uuid(),
    type,
    title,
    content,
    roleName: role?.name || '角色',
    createdAt: Date.now()
  });
  if (events.length > 60) events.length = 60;
};

const updateRoleAfterChat = (role, userText, assistantText = '') => {
  if (!role) return;
  const meta = getRoleMeta(role.id);
  const relationDelta = /谢谢|喜欢|爱|想你|晚安|约定|一起|开心|难过|不想说|累|压力|生病/.test(userText) ? 4 : 2;
  meta.relation = clamp((meta.relation || 0) + relationDelta, 0, 100);
  meta.mood = clamp((meta.mood || 50) + inferMoodDelta(userText), 0, 100);
  meta.stage = relationStage(meta.relation);
  meta.lastInteractionAt = Date.now();
  const summary = userText.length > 36 ? \`\${userText.slice(0, 36)}...\` : userText;
  pushRoleEvent(role.id, 'chat', '一次新的对话', \`用户和\${role.name}聊到了“\${summary}”，关系推进到了「\${meta.stage}」。\`);
};

const makeProactiveMessage = (role) => {
  const meta = getRoleMeta(role.id);
  if (meta.mood < 35) return \`\${state.user.nickname || '你'}，我有点担心你。刚才的事如果不想说也没关系，我会在这里陪着你。\`;
  if (meta.relation >= 65) return \`\${state.user.nickname || '你'}，刚才突然想起我们之前聊过的事，就想来看看你现在怎么样。\`;
  if (meta.relation >= 30) return \`\${state.user.nickname || '你'}，今天也想和你说说话。有什么小事想分享给我吗？\`;
  return \`我刚刚看了一眼手机，忽然想问问你：现在心情怎么样？\`;
};

const addProactiveMessage = () => {
  const role = activeRole();
  if (!role) return toast('请先选择一个角色。');
  const messages = getMessages(role.id);
  const content = makeProactiveMessage(role);
  messages.push({ id: uuid(), role: 'assistant', content, createdAt: Date.now(), proactive: true });
  const meta = getRoleMeta(role.id);
  meta.relation = clamp((meta.relation || 0) + 1, 0, 100);
  meta.mood = clamp((meta.mood || 50) + 2, 0, 100);
  meta.lastInteractionAt = Date.now();
  state.lastProactiveAt ||= {};
  state.lastProactiveAt[role.id] = Date.now();
  pushRoleEvent(role.id, '主动消息', '角色主动联系了你', \`\${role.name}主动发来了一条消息，像真正的小手机通知一样把你拉回这段关系里。\`);
  persist();
  renderMessages();
  renderRoleStatus();
  renderTimeline();
  toast(\`\${role.name}主动发来了一条消息。\`);
};

const renderRoleStatus = () => {
  const panel = $('#roleStatusPanel');
  if (!panel) return;
  const role = activeRole();
  if (!role) {
    panel.innerHTML = '<div class=\\"empty-state\\">选择角色后会显示关系和心情。</div>';
    return;
  }
  const meta = getRoleMeta(role.id);
  const events = getRoleEvents(role.id);
  const stage = relationStage(meta.relation);
  meta.stage = stage;
  panel.innerHTML = \`
    <div class=\\"phone-status-head\\">
      <div>
        <div class=\\"phone-status-title\\">\${escapeHtml(role.name)}的小手机状态</div>
        <div class=\\"phone-status-sub\\">关系会随着聊天、回忆和主动消息慢慢变化</div>
      </div>
      <span class=\\"phone-status-sub\\">\${escapeHtml(stage)}</span>
    </div>
    <div class=\\"phone-status-grid\\">
      <div class=\\"phone-stat\\"><strong>\${Math.round(meta.relation || 0)}</strong><span>关系值</span></div>
      <div class=\\"phone-stat\\"><strong>\${escapeHtml(moodLabel(meta.mood))}</strong><span>心情</span></div>
      <div class=\\"phone-stat\\"><strong>\${events.length}</strong><span>回忆</span></div>
    </div>
    <div class=\\"relation-bar\\"><i style=\\"width:\${clamp(meta.relation || 0, 0, 100)}%\\"></i></div>
    <button class=\\"proactive-button\\" data-proactive-message type=\\"button\\">让角色主动发一条消息</button>
  \`;
};

const renderTimeline = async () => {
  const list = $('#timelineList');
  if (!list) return;
  const role = activeRole();
  if (!role) {
    list.innerHTML = '<div class=\\"empty-state\\">暂无角色。</div>';
    return;
  }
  let memories = [];
  try {
    const data = await api.listMemories(role.id);
    const merged = mergeMemories(data.list || [], getLocalMemories(role.id));
    memories = merged.slice(0, 8).map((item) => ({
      id: item.id,
      title: \`\${item.type || '记忆'} · \${item.source === 'auto' ? '自动沉淀' : '手动保存'}\`,
      content: item.content || '',
      createdAt: new Date(item.updatedAt || item.createdAt).getTime() || Date.now()
    }));
  } catch {}
  const localEvents = getRoleEvents(role.id).slice(0, 12).map((item) => ({
    id: item.id,
    title: item.title,
    content: item.content,
    createdAt: item.createdAt || Date.now()
  }));
  const combined = [...localEvents, ...memories].sort((a, b) => b.createdAt - a.createdAt).slice(0, 16);
  if (!combined.length) {
    list.innerHTML = '<div class=\\"empty-state\\">还没有回忆。聊天、主动消息和自动记忆都会出现在这里。</div>';
    return;
  }
  list.innerHTML = combined.map((item) => \`
    <article class=\\"timeline-item\\">
      <div class=\\"timeline-item-head\\">
        <h4>\${escapeHtml(item.title || '回忆')}</h4>
        <span class=\\"timeline-meta\\">\${new Date(item.createdAt).toLocaleString()}</span>
      </div>
      <p>\${escapeHtml(item.content || '')}</p>
    </article>
  \`).join('');
};


const phoneApps = {
  socialForum: '社交论坛',
  doujinForum: '同人论坛',
  worldbook: '世界书',
  anniversary: '纪念日'
};

const phoneDateText = () => new Date().toLocaleDateString('zh-CN', { month: 'long', day: 'numeric', weekday: 'short' });

const renderPhoneDesktop = async () => {
  const clock = $('#phoneClock');
  if (!clock) return;
  const now = new Date();
  clock.textContent = now.toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit', hour12: false });
  $('#phoneDate').textContent = phoneDateText();
  const role = activeRole();
  $('#phoneActiveRole').textContent = role?.name || '未选择角色';
  const events = role ? getRoleEvents(role.id).length : 0;
  const localCount = role ? getLocalMemories(role.id).length : 0;
  $('#phoneMemoryCount').textContent = String(events + localCount);
};

const phoneCard = (title, content, extra = '') => \`
  <article class="phone-mini-card">
    <h4>\${escapeHtml(title)}</h4>
    <p>\${escapeHtml(content)}</p>
    \${extra}
  </article>
\`;

const forumPostCard = (board, title, content, meta = {}) => \`
  <article class="forum-post-card">
    <div class="forum-post-top">
      <span class="forum-board-tag">\${escapeHtml(board)}</span>
      <span class="timeline-meta">\${escapeHtml(meta.time || '刚刚')}</span>
    </div>
    <h4>\${escapeHtml(title)}</h4>
    <p>\${escapeHtml(content)}</p>
    <div class="forum-post-meta">
      <span>共鸣 \${meta.likes ?? 0}</span>
      <span>留声 \${meta.saves ?? 0}</span>
      <span>扩音 \${meta.shares ?? 0}</span>
      <span>回声者 \${escapeHtml(meta.author || '匿名')}</span>
    </div>
  </article>
\`;

const renderForumWorld = (role) => {
  const roleName = role?.name || '当前角色';
  const events = role ? getRoleEvents(role.id).filter((item) => !/剧情|回合|地点推进/.test(\`\${item.title || ''} \${item.content || ''}\`)).slice(0, 5) : [];
  const dynamicPosts = events.map((item, index) => forumPostCard(
    index % 2 ? '深水区' : '潮汐广场',
    item.title || \`\${roleName}的声纹\`,
    item.content || '一条新的互动声纹。',
    { likes: 18 + index * 7, saves: 6 + index * 3, shares: 2 + index, author: roleName, time: '关系动态' }
  )).join('');

  const seedPosts = [
    forumPostCard('潮汐广场', '今日浪潮：有哪些瞬间让你突然觉得被理解？', '回响环廊今日热帖。欢迎回声者分享轻量、真实、有温度的瞬间，优先展示原创和低争议内容。', { likes: 86, saves: 41, shares: 12, author: '回声晚报', time: '热榜' }),
    forumPostCard('深水区', '深水浮标：长期关系里的记忆应该怎么沉淀？', '适合长内容讨论。这里沉淀世界观、角色关系、设定补充和可追溯的楼中楼讨论。', { likes: 64, saves: 58, shares: 9, author: '深水管理员', time: '精选' }),
    forumPostCard('暗房', '匿名夸夸弹幕：留一句不暴露身份的鼓励', '24小时短时动态入口。只保留公共情绪趋势，不做身份溯源；禁止攻击、引战和隐私曝光。', { likes: 52, saves: 20, shares: 5, author: '面具模式', time: '24h' })
  ].join('');

  return \`<div class="forum-world">
    <section class="forum-hero-card">
      <h4>回响环廊</h4>
      <p>半匿名兴趣社区。把角色动态、关系事件和世界讨论组织成声纹信息流，而不是普通备忘录列表。</p>
    </section>
    <div class="forum-tabs"><span>潮汐广场</span><span>深水区</span><span>暗房</span><span>今日浪潮</span><span>回响晚报</span></div>
    <div class="forum-rules-card">互动规则：共鸣=点赞，留声=收藏，扩音=转发。争议内容进入防杠护盾，发言需要能举证。</div>
    <div class="forum-post-list">\${dynamicPosts || seedPosts}\${dynamicPosts ? seedPosts : ''}</div>
  </div>\`;
};

const renderPhoneApp = async (appKey) => {
  const panel = $('#phoneAppPanel');
  if (!panel) return;
  const role = activeRole();

  if (appKey === 'socialForum') {
    if (typeof openSocialForum === 'function') openSocialForum(role);
    return;
  } else if (appKey === 'doujinForum') {
    if (typeof openDoujinForum === 'function') openDoujinForum(role);
    return;
  }

  const appName = phoneApps[appKey] || '手机应用';
  panel.classList.remove('hidden');
  panel.innerHTML = \`<div class="phone-app-head"><h3>\${appName}</h3><button class="phone-app-close" data-close-phone-app type="button">×</button></div><div class="empty-state">正在打开...</div>\`;

  let body = '';
  if (appKey === 'worldbook') {
    body = \`<div class="phone-mini-list">
      \${phoneCard('世界书', '用于保存世界观、地点、组织、重要设定。当前先作为入口保留，不重复做聊天和记忆功能。')}
      \${phoneCard('当前角色设定', role?.prompt || '暂无角色设定。')}
    </div>\`;
  } else if (appKey === 'anniversary') {
    const days = role ? Math.max(1, Math.ceil((Date.now() - (role.createdAt || Date.now())) / 86400000)) : 0;
    body = \`<div class="phone-mini-list">
      \${phoneCard('认识天数', role ? \`你和「\${role.name}」已经认识 \${days} 天。\` : '请选择角色后查看。')}
      \${phoneCard('重要日子', '这里保留 EVE 式纪念日入口，后续可添加生日、初遇日、告白日。')}
    </div>\`;
  }
  panel.innerHTML = \`<div class="phone-app-head"><h3>\${appName}</h3><button class="phone-app-close" data-close-phone-app type="button">×</button></div>\${body}\`;
};

const getMessages = (roleId = state.activeRoleId) => {
  state.conversations[roleId] ||= [];
  state.conversations[roleId].forEach((item, index) => {
    if (!item.id) state.conversations[roleId][index] = { ...item, id: uuid() };
  });
  return state.conversations[roleId];
};

const refreshServerUser = async () => {
  try {
    serverUser = await api.getMe();
    $('#beansBadge').textContent = \`豆子 \${serverUser.beans}\`;
    $('#beansBalance').textContent = \`\${serverUser.beans} 豆子\`;
    renderTransactions();
  } catch (error) {
    toast(error.message);
  }
};

const renderTransactions = () => {
  const list = $('#transactionList');
  if (!serverUser.transactions?.length) {
    list.innerHTML = '<div class="empty-state">暂无消费或充值明细。</div>';
    return;
  }
  list.innerHTML = serverUser.transactions.map((item) => \`
    <div class="role-card">
      <div class="avatar"></div>
      <div>
        <h3>\${item.beans > 0 ? '+' : ''}\${item.beans} 豆子</h3>
        <p>\${item.roleName || '系统'} · \${new Date(item.createdAt).toLocaleString()}</p>
        <p>\${item.summary || ''}</p>
      </div>
    </div>
  \`).join('');
};

const renderRoleSwitcher = () => {
  const wrap = $('#roleSwitcher');
  if (!state.roles.length) {
    wrap.innerHTML = '<div class="empty-state">还没有角色，请先到“角色”页新建。</div>';
    return;
  }
  wrap.innerHTML = state.roles.map((role) => \`
    <button class="role-chip \${role.id === state.activeRoleId ? 'active' : ''}" data-switch-role="\${role.id}" type="button">
      <img class="avatar" src="\${avatarOf(role.name, role.avatar)}" alt="\${role.name}" />
      <span>\${role.name}</span>
    </button>
  \`).join('');
};

const renderMessages = () => {
  const list = $('#messageList');
  const role = activeRole();
  const messages = role ? getMessages(role.id) : [];

  if (!role) {
    list.innerHTML = '<div class="empty-state">暂无角色。请先创建角色，开始你的第一段对话。</div>';
    return;
  }

  if (!messages.length) {
    list.innerHTML = \`<div class="empty-state">开始和「\${role.name}」聊天吧。</div>\`;
    return;
  }

  list.innerHTML = messages.map((msg) => \`
    <div class="message-row \${msg.role}" data-msg-id="\${msg.id}">
      <img class="avatar" src="\${msg.role === 'user' ? avatarOf(state.user.nickname, state.user.avatar) : avatarOf(role.name, role.avatar)}" alt="" />
      <div class="chat-bubble">\${escapeHtml(msg.content)}</div>
    </div>
  \`).join('');
  renderRoleStatus();
  requestAnimationFrame(() => {
    const chat = $('#chatContainer');
    if (chat) chat.scrollTop = chat.scrollHeight;
  });
};

const renderRoles = () => {
  const list = $('#myRolesList');
  const roles = [...state.roles].sort((a, b) => b.createdAt - a.createdAt);
  if (!roles.length) {
    list.innerHTML = '<div class="empty-state">暂无角色，点击右上角“新建”创建你的第一个角色。</div>';
    return;
  }

  list.innerHTML = roles.map((role) => \`
    <article class="role-card">
      <img class="avatar" src="\${avatarOf(role.name, role.avatar)}" alt="\${role.name}" />
      <div>
        <h3>\${role.name}</h3>
        <p>\${role.description || '暂无简介'}</p>
        <p>\${role.isPublic ? '公开角色' : '私密角色'} · \${new Date(role.createdAt).toLocaleDateString()}</p>
        <div class="card-actions">
          <button data-chat-role="\${role.id}" type="button">聊天</button>
          <button data-edit-role="\${role.id}" type="button">编辑</button>
          <button data-clear-chat="\${role.id}" type="button">删除对话</button>
        </div>
      </div>
    </article>
  \`).join('');
};

const renderProfile = () => {
  $('#userNicknameInput').value = state.user.nickname;
  $('#userBioInput').value = state.user.bio;
  $('#userAvatarPreview').src = avatarOf(state.user.nickname, state.user.avatar);
  /* Update profile header display */
  const headerAvatar = $('#profileHeaderAvatar');
  const headerName = $('#profileHeaderName');
  const headerBio = $('#profileHeaderBio');
  if (headerAvatar) headerAvatar.src = avatarOf(state.user.nickname, state.user.avatar);
  if (headerName) headerName.textContent = state.user.nickname || '体验用户';
  if (headerBio) headerBio.textContent = state.user.bio || '点击下方编辑个人资料~';
};

const renderMemoryRoleOptions = () => {
  const select = $('#memoryRoleSelect');
  if (!select) return;
  const current = select.value || state.activeRoleId || '';
  select.innerHTML = '<option value="">全部角色通用</option>' + state.roles.map((role) => \`
    <option value="\${role.id}">\${escapeHtml(role.name)}</option>
  \`).join('');
  select.value = state.roles.some((role) => role.id === current) ? current : '';
};

const renderMemories = async () => {
  renderTimeline();
  const list = $('#memoryList');
  if (!list) return;
  renderMemoryRoleOptions();
  list.innerHTML = '<div class="empty-state">正在加载记忆...</div>';
  try {
    const roleId = $('#memoryRoleSelect')?.value || '';
    const data = await api.listMemories(roleId);
    memoryCache = mergeMemories(data.list || [], getLocalMemories(roleId));
    if (!memoryCache.length) {
      list.innerHTML = '<div class="empty-state">还没有记忆。你可以手动新增，也可以在聊天时让系统自动沉淀。</div>';
      return;
    }
    list.innerHTML = memoryCache.map((item) => \`
      <article class="memory-card">
        <h3>\${escapeHtml(item.type || '记忆')} · \${escapeHtml(item.roleName || '全部角色')}</h3>
        <p>\${escapeHtml(item.content || '')}</p>
        <div class="memory-meta">\${item.source === 'auto' ? '自动记忆' : '手动记忆'} · \${new Date(item.updatedAt || item.createdAt).toLocaleString()}</div>
        <div class="card-actions"><button data-delete-memory="\${item.id}" type="button">删除记忆</button></div>
      </article>
    \`).join('');
  } catch (error) {
    list.innerHTML = \`<div class="empty-state">\${escapeHtml(error.message || '记忆加载失败')}</div>\`;
  }
};

const saveMemory = async () => {
  const content = $('#memoryContentInput').value.trim();
  if (!content) return toast('请先填写记忆内容。');
  const roleId = $('#memoryRoleSelect').value;
  const role = state.roles.find((item) => item.id === roleId);
  try {
    const savedMemory = await api.createMemory({
      roleId,
      roleName: role?.name || '全部角色',
      type: $('#memoryTypeSelect').value,
      content,
      source: 'manual'
    });
    rememberLocalMemory(savedMemory);
    $('#memoryContentInput').value = '';
    await renderMemories();
    toast('记忆已保存。');
  } catch (error) {
    toast(error.message || '保存记忆失败。');
  }
};

const renderRechargePackages = () => {
  const wrap = $('#rechargePackages');
  wrap.innerHTML = billingConfig.rechargePackages.map((item) => \`
    <button class="package-card" data-recharge="\${item.amount}" type="button">
      \${item.amount} 元<br><small>\${item.beans} 豆子</small>
    </button>
  \`).join('');
};

const renderCommunity = async () => {
  const wrap = $('#communityList');
  wrap.innerHTML = '<div class="empty-state">正在加载社区角色...</div>';
  try {
    const keyword = $('#communitySearch').value.trim();
    const data = await api.listCommunityRoles(keyword);
    if (!data.list.length) {
      wrap.innerHTML = '<div class="empty-state">社区暂无匹配角色，换个关键词试试。</div>';
      return;
    }
    wrap.innerHTML = data.list.map((role) => \`
      <article class="community-card">
        <img class="avatar" src="\${avatarOf(role.name, role.avatar)}" alt="\${role.name}" />
        <div>
          <h3>\${role.name}</h3>
          <p>\${role.description}</p>
          <p>上传者：\${role.uploaderNickname} · 热度 \${role.heat}</p>
          <div class="card-actions">
            <button data-import-role='\${encodeURIComponent(JSON.stringify(role))}' type="button">一键导入</button>
            <button data-view-role='\${encodeURIComponent(JSON.stringify(role))}' type="button">详情</button>
          </div>
        </div>
      </article>
    \`).join('');
  } catch (error) {
    wrap.innerHTML = \`<div class="empty-state">\${error.message}</div>\`;
  }
};

const renderCostumeEditor = (mode = 'page') => {
  $$('.tabs [data-costume-mode]').forEach((btn) => btn.classList.toggle('active', btn.dataset.costumeMode === mode));
  const wrap = $('#costumeEditorWrap');
  if (mode === 'wallpaper') {
    wrap.innerHTML = \`
      <div class="panel">
        <h3>自定义聊天壁纸</h3>
        <p class="muted">上传图片仅保存在本地浏览器，CSS 只作用于 .chat-container 背景。</p>
        <input id="wallpaperInput" type="file" accept="image/*" />
        <textarea id="wallpaperCssInput" class="code-editor" placeholder="\${examples.wallpaper}">\${state.costumes.wallpaperCss || ''}</textarea>
        <div class="wallpaper-preview"></div>
        <div class="card-actions">
          <button id="saveWallpaperButton" type="button">保存并预览</button>
          <button id="resetWallpaperButton" type="button">恢复默认壁纸</button>
        </div>
      </div>
    \`;
    return;
  }

  const key = mode === 'bubble' ? 'bubbleCss' : 'pageCss';
  wrap.innerHTML = \`
    <div class="panel">
      <h3>\${mode === 'bubble' ? '自定义聊天气泡' : '自定义页面 UI'}</h3>
      <p class="muted">\${mode === 'bubble' ? 'CSS 会被限制在 .chat-bubble 范围内，不影响其他模块。' : '页面 UI CSS 会全局覆盖默认样式，请仅粘贴纯 CSS。'}</p>
      <textarea id="cssEditor" class="code-editor" spellcheck="false" placeholder="\${examples[mode]}">\${state.costumes[key] || ''}</textarea>
      <div class="card-actions">
        <button id="saveCssButton" data-css-key="\${key}" type="button">保存并预览</button>
        <button id="resetCssButton" data-css-key="\${key}" type="button">重置默认</button>
      </div>
    </div>
  \`;
};

const openRoleDialog = (roleId = null) => {
  editingRoleId = roleId;
  const role = state.roles.find((item) => item.id === roleId) || {};
  $('#roleDialogTitle').textContent = roleId ? '编辑角色' : '新建角色';
  $('#roleNameInput').value = role.name || '';
  $('#roleDescriptionInput').value = role.description || '';
  $('#rolePromptInput').value = role.prompt || '';
  $('#rolePublicInput').checked = Boolean(role.isPublic);
  $('#roleAvatarPreview').src = avatarOf(role.name || '新角色', role.avatar);
  $('#deleteRoleButton').style.display = roleId ? 'inline-flex' : 'none';
  $('#roleDialog').showModal();
};

const saveRole = async (event) => {
  event.preventDefault();
  const current = state.roles.find((item) => item.id === editingRoleId);
  const role = {
    id: editingRoleId || crypto.randomUUID(),
    name: $('#roleNameInput').value.trim(),
    description: $('#roleDescriptionInput').value.trim(),
    prompt: $('#rolePromptInput').value.trim(),
    avatar: $('#roleAvatarPreview').dataset.value || current?.avatar || '',
    isPublic: $('#rolePublicInput').checked,
    createdAt: current?.createdAt || Date.now()
  };

  if (!role.name || !role.description || !role.prompt) {
    toast('请完整填写角色名称、简介和人设。');
    return;
  }

  if (current) {
    Object.assign(current, role);
  } else {
    state.roles.unshift(role);
    state.activeRoleId = role.id;
  }

  if (role.isPublic) {
    await api.publishRole({ ...role, uploaderNickname: state.user.nickname }).catch((error) => toast(error.message));
  }

  persist();
  $('#roleDialog').close();
  renderAll();
  toast('角色已保存。');
};

const deleteRole = async () => {
  if (!editingRoleId) return;
  if (!confirm('确认删除该角色？对应对话历史和自动记忆也会同步删除。')) return;
  await api.cleanupMemories({ roleId: editingRoleId, sourceConversationId: editingRoleId }).catch(() => null);
  state.roles = state.roles.filter((role) => role.id !== editingRoleId);
  delete state.conversations[editingRoleId];
  state.activeRoleId = state.roles[0]?.id || '';
  persist();
  $('#roleDialog').close();
  renderAll();
  renderMemories();
  toast('角色已删除。');
};

const sendMessage = async (event) => {
  event.preventDefault();
  if (isReplying) {
    currentAbortController?.abort();
    toast('已打断上一条回复。');
  }

  const role = activeRole();
  const input = $('#messageInput');
  const content = input.value.trim();
  if (!role) return toast('请先创建或选择一个角色。');
  if (!content) return;

  const messages = getMessages(role.id);
  const userMessage = { id: uuid(), role: 'user', content, createdAt: Date.now() };
  messages.push(userMessage);
  input.value = '';
  persist();
  renderMessages();

  const assistantMessage = { id: uuid(), role: 'assistant', content: '', createdAt: Date.now() };
  messages.push(assistantMessage);
  isReplying = true;
  currentAbortController = new AbortController();
  const localAbortController = currentAbortController;
  renderMessages();
  appendTyping();

  try {
    await api.streamChat({
      roleId: role.id,
      conversationId: role.id,
      roleName: role.name,
      rolePrompt: \`\${role.prompt}\\n\\n用户资料：\${state.user.nickname}，\${state.user.bio}\`,
      sourceMessageIds: [userMessage.id],
      messages: messages.filter((item) => item.content).map((item) => ({ role: item.role, content: item.content }))
    }, {
      charged: (data) => {
        serverUser.beans = data.beans;
        $('#beansBadge').textContent = \`豆子 \${data.beans}\`;
      },
      delta: (data) => {
        if (!isReplying) return;
        assistantMessage.content += data.content;
        persist();
        renderMessages();
      },
      error: (data) => {
        assistantMessage.content = data.message;
        toast(data.message);
      },
      memory: (data) => {
        memoryCache.unshift(data);
        rememberLocalMemory(data);
        toast('已自动加入一条记忆。');
        renderMemories();
      }
    }, localAbortController.signal);
    updateRoleAfterChat(role, content, assistantMessage.content);
    renderRoleStatus();
    renderTimeline();
    renderMemories();
  } catch (error) {
    if (error.name === 'AbortError') {
      assistantMessage.content = assistantMessage.content || '回复已被打断。';
    } else {
      assistantMessage.content = '请求失败，请稍后再试。';
      toast(error.message);
    }
  } finally {
    if (currentAbortController === localAbortController) {
      isReplying = false;
      currentAbortController = null;
    }
    if (!assistantMessage.content.trim()) {
      assistantMessage.content = 'AI 暂时没有返回内容，本次没有生成有效回复。请再试一次。';
    }
    persist();
    renderMessages();
    refreshServerUser();
  }
};

const appendTyping = () => {
  const list = $('#messageList');
  const row = document.createElement('div');
  row.className = 'message-row assistant';
  row.innerHTML = '<div class="avatar"></div><div class="chat-bubble"><span class="typing-dot"><i></i><i></i><i></i></span></div>';
  list.appendChild(row);
  $('#chatContainer').scrollTop = $('#chatContainer').scrollHeight;
};

const escapeHtml = (text) => String(text)
  .replaceAll('&', '&amp;')
  .replaceAll('<', '&lt;')
  .replaceAll('>', '&gt;')
  .replaceAll('"', '&quot;')
  .replaceAll("'", '&#039;');

const renderAll = () => {
  renderRoleSwitcher();
  renderMessages();
  renderRoles();
  renderProfile();
  renderRechargePackages();
  renderMemoryRoleOptions();
  renderRoleStatus();
  renderTimeline();
  renderPhoneDesktop();
};

const exportBackup = async () => {
  try {
    const serverData = await api.exportUserData().catch(() => ({
      userId: CONFIG.userId,
      beans: serverUser.beans,
      transactions: serverUser.transactions || [],
      memories: memoryCache || []
    }));
    const backup = {
      app: 'Mochi-phone',
      version: 2,
      exportedAt: new Date().toISOString(),
      userId: CONFIG.userId,
      localState: state,
      serverData
    };
    const blob = new Blob([JSON.stringify(backup, null, 2)], { type: 'application/json;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = \`mochi-phone-backup-\${new Date().toISOString().slice(0, 10)}.json\`;
    document.body.appendChild(link);
    link.click();
    link.remove();
    URL.revokeObjectURL(url);
    toast('数据备份已导出，请保存好这个 JSON 文件。');
  } catch (error) {
    toast(error.message || '导出失败，请稍后重试。');
  }
};

const importBackupFile = async (file) => {
  try {
    const text = await file.text();
    const backup = JSON.parse(text);
    if (backup.app !== 'Mochi-phone' || !backup.localState) {
      throw new Error('这不是有效的 Mochi-phone 备份文件。');
    }
    if (!confirm('导入后会覆盖当前浏览器里的角色、对话、装扮和豆子数据，确认继续？')) return;

    const importedUserId = backup.userId || backup.serverData?.userId;
    if (importedUserId) {
      localStorage.setItem('mochi_phone_user_id', importedUserId);
    }
    saveState(backup.localState);
    if (backup.serverData) {
      await api.importUserData({
        userId: importedUserId,
        beans: backup.serverData.beans,
        transactions: backup.serverData.transactions || [],
        memories: backup.serverData.memories || []
      }).catch(() => null);
    }
    toast('导入成功，页面即将刷新。');
    setTimeout(() => location.reload(), 900);
  } catch (error) {
    toast(error.message || '导入失败，请确认文件是否正确。');
  }
};

const bindEvents = () => {
  $('.bottom-nav').addEventListener('click', (event) => {
    const btn = event.target.closest('[data-page]');
    if (!btn) return;
    $$('.page').forEach((page) => page.classList.toggle('active', page.id === btn.dataset.page));
    $$('.bottom-nav button').forEach((item) => item.classList.toggle('active', item === btn));
    $('#pageTitle').textContent = btn.textContent;
    if (btn.dataset.page === 'communityPage') renderCommunity();
    if (btn.dataset.page === 'phonePage') renderPhoneDesktop();
    if (btn.dataset.page === 'memoryPage') renderMemories();
  });

  document.addEventListener('click', async (event) => {
    const phoneAppBtn = event.target.closest('[data-phone-app]');
    if (phoneAppBtn) {
      renderPhoneApp(phoneAppBtn.dataset.phoneApp);
      return;
    }

    const closePhoneAppBtn = event.target.closest('[data-close-phone-app]');
    if (closePhoneAppBtn) {
      $('#phoneAppPanel')?.classList.add('hidden');
      return;
    }

    const openCommunityBtn = event.target.closest('[data-open-community]');
    if (openCommunityBtn) {
      $$('.page').forEach((page) => page.classList.toggle('active', page.id === 'communityPage'));
      $$('.bottom-nav button').forEach((item) => item.classList.remove('active'));
      $('#pageTitle').textContent = '社区';
      renderCommunity();
      return;
    }

    const proactiveBtn = event.target.closest('[data-proactive-message]');
    if (proactiveBtn) {
      addProactiveMessage();
      return;
    }

    const switchBtn = event.target.closest('[data-switch-role]');
    if (switchBtn) {
      state.activeRoleId = switchBtn.dataset.switchRole;
      persist();
      renderRoleSwitcher();
      renderMessages();
      renderRoleStatus();
      renderTimeline();
    }

    const chatBtn = event.target.closest('[data-chat-role]');
    if (chatBtn) {
      state.activeRoleId = chatBtn.dataset.chatRole;
      persist();
      $('.bottom-nav [data-page="chatPage"]').click();
    }

    const editBtn = event.target.closest('[data-edit-role]');
    if (editBtn) openRoleDialog(editBtn.dataset.editRole);

    const clearBtn = event.target.closest('[data-clear-chat]');
    if (clearBtn && confirm('确认删除当前角色的全部对话？由这些对话自动生成的记忆也会同步删除。')) {
      const roleId = clearBtn.dataset.clearChat;
      const removedIds = (state.conversations[roleId] || []).map((item) => item.id).filter(Boolean);
      const result = await api.cleanupMemories({ roleId, sourceConversationId: roleId, sourceMessageIds: removedIds }).catch(() => ({ deleted: 0 }));
      state.conversations[roleId] = [];
      persist();
      renderMessages();
      renderMemories();
      toast(\`对话已删除，已清理 \${result.deleted || 0} 条关联记忆。\`);
    }

    const deleteMemoryBtn = event.target.closest('[data-delete-memory]');
    if (deleteMemoryBtn && confirm('确认删除这条记忆？')) {
      await api.deleteMemory(deleteMemoryBtn.dataset.deleteMemory).catch(() => null);
      forgetLocalMemory(deleteMemoryBtn.dataset.deleteMemory);
      await renderMemories();
      toast('记忆已删除。');
    }

    const importBtn = event.target.closest('[data-import-role]');
    if (importBtn) {
      const role = JSON.parse(decodeURIComponent(importBtn.dataset.importRole));
      const localRole = { ...role, id: crypto.randomUUID(), isPublic: false, createdAt: Date.now() };
      state.roles.unshift(localRole);
      state.activeRoleId = localRole.id;
      persist();
      renderAll();
      toast('已导入到我的角色，可自由编辑。');
    }

    const viewBtn = event.target.closest('[data-view-role]');
    if (viewBtn) {
      const role = JSON.parse(decodeURIComponent(viewBtn.dataset.viewRole));
      alert(\`\${role.name}\\n\\n\${role.description}\\n\\n人设：\\n\${role.prompt}\\n\\n上传时间：\${new Date(role.createdAt).toLocaleString()}\`);
    }

    const rechargeBtn = event.target.closest('[data-recharge]');
    if (rechargeBtn) {
      const amount = Number(rechargeBtn.dataset.recharge);
      const item = billingConfig.rechargePackages.find((pkg) => pkg.amount === amount);
      await api.recharge(item);
      toast('模拟充值成功。');
      refreshServerUser();
    }

    const costumeEntry = event.target.closest('[data-costume-tab]');
    if (costumeEntry) {
      $('.bottom-nav [data-page="profilePage"]').classList.remove('active');
      $$('.page').forEach((page) => page.classList.toggle('active', page.id === 'costumePage'));
      $('#pageTitle').textContent = '自定义装扮';
      renderCostumeEditor(costumeEntry.dataset.costumeTab);
    }
  });

  $('#newRoleButton').addEventListener('click', () => openRoleDialog());
  $('#roleForm').addEventListener('submit', saveRole);
  $('#deleteRoleButton').addEventListener('click', deleteRole);
  $('#saveMemoryButton').addEventListener('click', saveMemory);
  $('#refreshMemoryButton').addEventListener('click', renderMemories);
  $('#memoryRoleSelect').addEventListener('change', renderMemories);
  $$('[data-close-dialog]').forEach((btn) => btn.addEventListener('click', () => $('#roleDialog').close()));
  $('#chatForm').addEventListener('submit', sendMessage);
  $('#communitySearchButton').addEventListener('click', renderCommunity);

  $('#saveProfileButton').addEventListener('click', async () => {
    state.user.nickname = $('#userNicknameInput').value.trim() || '体验用户';
    state.user.bio = $('#userBioInput').value.trim();
    persist();
    renderAll();
    toast('个人资料已保存。');
    try {
      await fetch('/api/profile', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'X-User-Id': state.userId },
        body: JSON.stringify({ nickname: state.user.nickname, bio: state.user.bio, avatar: state.user.avatar || '' })
      });
    } catch (e) { /* server sync optional */ }
  });

  $('#exportDataButton').addEventListener('click', exportBackup);
  $('#importDataButton').addEventListener('click', () => $('#importDataInput').click());
  $('#importDataInput').addEventListener('change', async (event) => {
    const file = event.target.files?.[0];
    event.target.value = '';
    if (file) await importBackupFile(file);
  });

  $('#clearCacheButton').addEventListener('click', () => {
    if (!confirm('确认清空本地角色、对话和装扮配置？此操作不可恢复。')) return;
    clearState();
    state = loadState();
    persist();
    renderAll();
    toast('本地缓存已清空。');
  });

  $('#roleAvatarInput').addEventListener('change', async (event) => {
    const file = event.target.files[0];
    if (!file) return;
    const dataUrl = await readFileAsDataUrl(file);
    $('#roleAvatarPreview').src = dataUrl;
    $('#roleAvatarPreview').dataset.value = dataUrl;
  });

  $('#userAvatarInput').addEventListener('change', async (event) => {
    const file = event.target.files[0];
    if (!file) return;
    state.user.avatar = await readFileAsDataUrl(file);
    persist();
    renderProfile();
    try {
      await fetch('/api/profile', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'X-User-Id': state.userId },
        body: JSON.stringify({ nickname: state.user.nickname, bio: state.user.bio, avatar: state.user.avatar })
      });
    } catch (e) { /* server sync optional */ }
  });

  // 长按/右键气泡删除单条消息
  let _lpTimer = null;
  const _deleteMsg = async (msgId) => {
    const r = activeRole();
    if (!r) return;
    state.conversations[r.id] = (state.conversations[r.id] || []).filter(m => m.id !== msgId);
    await api.cleanupMemories({ roleId: r.id, sourceConversationId: r.id, sourceMessageIds: [msgId] }).catch(() => null);
    persist(); renderMessages(); renderMemories();
    toast('消息已删除，关联的自动记忆已清理。');
  };
  const msgList = $('#messageList');
  msgList.addEventListener('contextmenu', e => {
    const row = e.target.closest('[data-msg-id]');
    if (row && row.dataset.msgId && confirm('确认删除这条消息？关联的自动记忆也会同步删除。')) {
      e.preventDefault(); _deleteMsg(row.dataset.msgId);
    }
  });
  msgList.addEventListener('pointerdown', e => {
    const row = e.target.closest('[data-msg-id]');
    if (!row || !row.dataset.msgId) return;
    _lpTimer = setTimeout(() => {
      if (confirm('确认删除这条消息？关联的自动记忆也会同步删除。')) _deleteMsg(row.dataset.msgId);
    }, 600);
  });
  msgList.addEventListener('pointerup', () => clearTimeout(_lpTimer));
  msgList.addEventListener('pointermove', () => clearTimeout(_lpTimer));
  msgList.addEventListener('pointercancel', () => clearTimeout(_lpTimer));

  $('#messageInput').addEventListener('input', (event) => {
    event.target.style.height = 'auto';
    event.target.style.height = \`\${Math.min(event.target.scrollHeight, 96)}px\`;
  });

  $('#costumePage').addEventListener('click', async (event) => {
    const modeBtn = event.target.closest('[data-costume-mode]');
    if (modeBtn) renderCostumeEditor(modeBtn.dataset.costumeMode);

    const saveCss = event.target.closest('#saveCssButton');
    if (saveCss) {
      state.costumes[saveCss.dataset.cssKey] = sanitizeCss($('#cssEditor').value);
      persist();
      toast('CSS 已保存并实时生效。');
    }

    const resetCss = event.target.closest('#resetCssButton');
    if (resetCss) {
      state.costumes[resetCss.dataset.cssKey] = '';
      persist();
      renderCostumeEditor(resetCss.dataset.cssKey === 'bubbleCss' ? 'bubble' : 'page');
      toast('已恢复默认样式。');
    }

    const saveWallpaper = event.target.closest('#saveWallpaperButton');
    if (saveWallpaper) {
      const file = $('#wallpaperInput')?.files?.[0];
      if (file) state.costumes.wallpaperImage = await readFileAsDataUrl(file);
      state.costumes.wallpaperCss = sanitizeCss($('#wallpaperCssInput').value);
      persist();
      renderCostumeEditor('wallpaper');
      toast('壁纸已保存。');
    }

    const resetWallpaper = event.target.closest('#resetWallpaperButton');
    if (resetWallpaper) {
      state.costumes.wallpaperImage = '';
      state.costumes.wallpaperCss = '';
      persist();
      renderCostumeEditor('wallpaper');
      toast('已恢复默认壁纸。');
    }
  });
};

const init = async () => {
  applyCostumes(state.costumes);
  bindEvents();
  renderAll();
  try {
    billingConfig = await api.getBillingConfig();
    renderRechargePackages();
    await refreshServerUser();
  } catch (error) {
    toast(error.message);
  }
  /* Load profile from server (cross-device sync) */
  try {
    const resp = await fetch('/api/profile', { headers: { 'X-User-Id': state.userId } });
    const data = await resp.json();
    if (data && data.data && data.data.nickname) {
      let changed = false;
      if (data.data.nickname && data.data.nickname !== '体验用户' && (!state.user.nickname || state.user.nickname === '体验用户')) {
        state.user.nickname = data.data.nickname;
        changed = true;
      }
      if (data.data.bio && !state.user.bio) {
        state.user.bio = data.data.bio;
        changed = true;
      }
      if (data.data.avatar && !state.user.avatar) {
        state.user.avatar = data.data.avatar;
        changed = true;
      }
      if (changed) { persist(); renderProfile(); }
    }
  } catch (e) { /* server profile sync optional */ }
};

init();
</script>
  
  
  
  
  <script>/* inlined forum-avatars-base64.js */
var FORUM_AVATAR_BASE64 = {
  '/avatars/avatar1.png': 'data:image/png;base64,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',
  '/avatars/avatar2.png': 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAEAAAABACAYAAACqaXHeAAABMmlDQ1BJQ0MgUHJvZmlsZQAAeJx9kD9Lw0AYxn+Wgn+og+jokLGLUhW6qEsVi05SI1id0jRJhbaGJKUIbn4BP4Tg7ChCZwcFQXAUP4I4uMYnCZIu9T3eu98993B37wuFGRTFCvT6UdCo14yT5qkx/cmURhqWHfpMDrl+3jPv28o/vkkx23ZCW+uXsh3ocV1pipe8jDsJtzK+SngY+ZH4JuHAbOyIb8Vlb4xbY2z7QeJ/Fm/1ugM7/zclp398pHVPucwu54T4dLG4xOCQDc117XoMiMRDOSI6opCGTmoik0COvhQXR0zSv+yJ6w/YHsVx/JhrByO4r8LcQ66VN2GhBE8vuZb31LcCK5WKyoLrwvcdzDdh8VX3nP01ckJtRlpbnQsNT7U5Uvb1X5tV0ToV1qj+AiCUTfu+YhZyAAAmJElEQVR4nLW7Wa9t2XXf95vt6nZ32tvf6lisolihShQliooIWE0gm1Jk2BYMJMiDIQRwnvIJAiuA8iWYhxhxDDgvUfwSIIkkywLkiKEYihI7VbGae+veus3p9tnN6mabh3VYEJDnbOAABxunWXvOOcb4d1M8+/RJFtKz23XgA4/e/zFvvP45fIicXVxx+/4tst8wnJ8jEtimIJBASoxoEKOj3V+SRSYx4MaORT0nD5EYW6JLGAvODWiliW6LEpJZMwOl6IcB1/WEEBnGHikE8+UCHxJCwmxxjOs8w9BTVguEVJimRJUNqlowZoXrRr73ve/xf/5f/55tu6as5rRtS1VVSKnY7jYsFweMoyfnxNXlNc45QgQdgqeZNRwdFoz9jm7sCTFS1g1F0zGMjti2hNijo6d7GSlnDVEphNXoumFuFF2/Z3QKUmK361guF+AV1mR88ESRMFngk8D7aTFsWaGEBRwxeQQKITT9EAg5oaVg7LYUpqQPkd7vMbLAJEMOgXa3IcmS/b7nP/zlt7i6vsJay75tCSFiY0LrgsIWaKU5vnOXzWbN9XpPUSj66zX66aef8Nbn3+Lw4IgL70hC0iG52HV0ObN++QnV/orCCKTVoDL765dkpWnZUhwe08xWlPYI37YQMv1+zUIYitkMGSKVlMi2xu3OISm6fmAcB5arI7SuyDmSc0BohZCGLCUkMEVBPzgEgtoU9CERw8hmK8hlZnV0j9nqNs+u3uPpessweq4uW7btltlshpIWrTL37j7EWksMMLqR46NDBueQQqAPDg/4/t/+mOXBIev9jnR0yHuXz8m9J/mewl+hfUtJg0wZ7waEMihl6H0gbNYM48jB8SvMlqdIqen7lu3OcXj3AFlAFhklBP3uHIQki4quXyPVhqpWGFMilEIWDT4nYopYAVkrDCXWKECQRaIbO5wbuPfGL1IsTxhjwDRLfvcf/Wd8/PGPOH/5kidPn/DDH/8tOcK+2tPMFhRFRT9uUCpzcnLE2dkFXSfR33vykjE4hss1OY+I5PHtyEpmltkh/ZZ+e0GUhmaxQtsKPzi0SZiiBCkJ40i3WTM7usVseQQpgw+MDqrljDEHqrKm2F8z7iTlYoYQQHbkCDHWJC2omiVFSjg/knNEiEzInpwLlNaI0LLvHPff/mXk7BYuBsa+Jw6OUhuOD04pjeLpp5/Q9fDh4xc8uHeL680eaywpJqSSbDbX+OAYxwH98YsXWJkxWlEQqLRkbiSN31PmHtd3BJcR2nF99RylS6pmiRAC7x1JSmaLI7QxtONIaWuaxS1kjsToSblAi0BIHbODU8YuUxhJYTS79ackMqiMtIayKPDOY0JC2wqjNbnKhBSRAobthmxKxixIww6TYb/eoKWi1Jbd9YbL65fYquCNt17DZ82w3fDRBx+yWV9xeLAgJk/XtdiiYLVcopUSpBgxWXB9dc6u3/KgTFgVsYVBa8E+J2Ly1HVJzond5pyyXiCEASXZ5wtqs8DahpQSQkiSVDTzFa53kEdc71HSMj88plCK4OeYsmR/dU70e5bNKclMzU0A0mhc9FhToLRh7HswhtxHtBJoKVmvrxj9SMoeZQRlVSA3llundymKHT9+/2Mef/IJCMmzFy/48rtfYjar8C5SFIrVco5+7wffpt/sWCnF0cyghh3+9AA5LxA+UWgDy5KuSwz9iC0MxkD0exIll9dbjk9P0PtzXEgc3HqVsi7p2g43DpRVRbcb8aOjj4G6bjBFgU412Qiy8/TtBqElURWYQpCNJaSEEIKsNCEEhFAMZA5OTvB+5OrTR8QE3o+MocOnkeNbxxR1weX6iq7reXjvDiF6PvzkU+qi5umz5zx8eI/ZbI7zgQ8++hD96Q/+Gp0Fl+OAPD3iZz//KgqBcwElMllIcsxoqbje7NhuE8YayqLCFiWCzPmLF9SLE0oZGbodhS2pmoa2a1HWYJoK7Wa4rkMXM3RVIkXE5YQNgTFGQtaUaKSRdO0WJRWmqIg5IQVIJVkcH9P3gnZ7Te8cPkQAVGnJGYqiIMaAkAdUVclmvWW1WKBy5vnLl3R7gRsd7djhYyQEj85upCgL6tWCmAPRjdSLI3zokDGDlOSUCCGilWEcWyQSnyXEQF1WdEPPdnvJ7PgWxBbvGqKsUYWlTwGrNcuTu9i+wxhDUZVUxuDKA166hF1JUpJoXbPdXOF6T84Drn/B2O4xRqKVwklBLg5AWq4uztjtdpzevg1WIYRACEFZVTjfYTQcHa2w1mKU5D986y+4WK+Z1TM6AbvLM06PT9BlY1FE5mXB6/dOKTUMfUtdGwSJnBJSK7KD7W5L13b0w0DT7FjOTtCVJcbA+uKMZnlEszqla9eUUuBixlYlWSuSFJSzBSkmAoqoLMKW2OaEECW+7dhuO/btnvNnj/j4w4/4yUcf8+j5S+6envJbv/FrvPXOF2kdXG+2OD+y7/bIizNOigfEGEkpo6Ri1iwQQuF9YKUM1lik0fz5d77Fwckhxb7g+YvnpJzRoRtoyppKK64vL1idrKiVZmw9tpAInRnGEakUVVURY8B5x3Z7CQhKt2C73zJbzTl7+ohlSFQzT8gSoSyjc2SxIJiMlBFyZuw9MUSKskSbgjHDpm9JQvKDH3yXP/qj/4Pv/Ogp99/+ee6/8i4/fv/7/Cd6TucLnBsQUoCE9fqST5485t2ipJotIEOIGRDM6jnOj4yjQ0rJF99+mxACbd/hvWMYHV0/oH/ja7/Mrt1TWMOdRU0jA6WWSJFJMeBDQGvNMIwoo0lZMTpPiIGzs08x5pLKLnj0+An3C4N/qbltCtgKZLkg5owb9tTzOUpqlDEYW7Dd9Nh+IIfAMHjcMPL+04/5t//bH/Fnf/0RqZ4xbzeYl4FmuaKYzdnutqScGUaPEJqMpN3vefTRhzx89XWEUqQsEBqsLShsiVKaoR8QQvDln/0il1drPn32nKauSCmjf/0//gopJlKKCD/Sba5od1f0fU/OEEOAnEkxst1tyFmC0AzDDoCu27KzDlHVPHv+nPu6oe96sDOEGyhLTQiedheQUqO1pZnNkcJwcXVBDpF+HOkGx3f/+rt898cf0nvBStc8P7vk0Ucf8c/+838KQrDt92hl0doAghASznl2uy0vXzxnsVwhtEZEiZASaSRSSGxpSSlRyILloiHFU+7euc3L83N0GHrGoWO/39Pvd6QYsEajpCb5gRAjOQuMtcybBdeba1aLFTEEXp4/Zz47RpYV+67l6PgEkRUhJWKW+KEHUdI0NYmJFOWU6FqJNgXaKM7XV2gkISUefXrGPoGygqFvSSmxXMz44ttvc/byBbPFnPnMsNt17HYdVVFQFBXtviOl5yilqOoGoywpRpJOSCExyoCCIAVitiDGzIN796bG/uknz0AkRrcn+QBCILMg+8w4JkAQY2C7uSYFiTQzur6lqBrqZknXbVkWJbdu3yZLQTGbM3qPGbbYqqHd74kp0MxmaGPo2gFtLH0bqJsZVVUSvaewBefrDYUtKQvD1cUWQ+Z3v/FPMTkxRk+OiaHvudpvKaqK43t3EUbxk/few7mR5WJFTlDESHQBkcEUJUpKALQyyJxZLOa8/torxBjRu23Prr0i+B2rZo61FX2/p92vcT4igMKW1LMVKWSClHiRuVivQUik1lxcPOO01CyODtDFxPaUbqdjqCRtuyFEx2xxQCbT9z1FUdD3LaW1UFYQPEJK1lc75vOKL3zuDX7z1/4ev/Lzv8T19QXHJw9p6gIl0sRKU2aMnqIoCT5wdXHB1fqKmfPM4oKyqclsqFKgrGYIKQGBUBqVEicnx3gf0X3viFFC1vghUFvFmBKD79hstqSQUUITYkAISc6Z3nmyVJiy5nq/RyS4enlGNprF4Sl1uWK33aGMJkoQCIYuobWhsDVhcNh6RpYwjg6jCharA37la7+MbZb84ld/iTdfe42qqimrkjvVQw5WK2Jy+NTiNp7O9SQfkEKxWB7Stx2b7TXeeXLOCCVJUSABJSSmam6wgqIwlhw9d27fQocUqOoZMSp8HOjGASkNxtRUlWfoB2KKJBFxY8cwDMSYcN6h7ZymaggxUFc1+82Gs+fPuHuvQgrYXG+o5jOEkEQi49gjkWg0Q9syOzwiRjM12Zz59d/4B3z5K1+luRlpdd1wtDrEOc8wdvR9R5da9t2eHDOjH9i1OyCwXC2QQrDb7djtd1hbomYF4zAilUYqhbYlRgiQGg9ok9Hd0FPVMw4Olji/IY2R0I94n2/m6vTgPkRSDAgJRpUoWeBDYgwjiElo0EqzPT9nVi3Q5QyXIMZIUdeEFPEh4ivHoj5ABk12nqPD2+y2O7JMlLNDHhzcYlY3aFtglGK/O6cdNwxdTzdsCCR8iPRtiws9MQcyE3U2VmOtZbvb0LUt9+7eZ7ESODdibIHUBpQmpUwWCq0N2jtP1+7JjGQxkHpPv95xvbtkGLdkgARaaZCGGDMxgjaKotRIIWiTp+s6ZBoZYsLOzlkeCHISpJ+yO63p+x0iZeblnMEPpH7P4jBwfHJM8J6j42NyBiEybbfn/PKc3faSrtvQ7lp8nBpot2+J0YNPhN4RfCIEyFJgqwJ35Tl7+QKVMlo+RGqN9w5t7FS6N0AqJo0+Pz8jhEjRC7R1pCHi+xElLYWtca7D+cw4emIcCCkQo6SqZpwcz9BNiYmSw0NJjJ7BB/phpBx6jLb4MZJzpmpmaCno9ls4vkdZLNh1HdvtmoMDjdIWoxU+RDbba4ahxQeP0hZrKwbTM4yJfXeBUoE4RuLoySFPG6Q1KNh3HVfXaxCCMI60+z3FvGIcBoyxZGNQSgGQJGjvw41AUDGMngJNYQs225HNdscwTo0wo8nZkXKkrhc0dcngRoxWHB7fZRxGYkowDoQE4xChmGo7+I6UM2VdI4APH/2Ez732JW4dnCAzJO8pqgIREzIEalNQKEOtOrwr6KzG+wGRE1IM7PcdMTKpRCITpSLFhN97ttcbyDCrGqqqQSiJdwGtHc6NhKLAR4HSkkKCfvzkMVIKTo4PuXfvDl1s8fsBt9+Rc0QrS8wB5z0Ah4cnxJTYtVuKusYWh7xYn7PZbGiKmovLC/p+oCyPuHV6yupgiQDiqPFyqkWRA5eXnzKbNdiiIQbH0O7Q2kLIiAjtfo0feiSKruswShOkJAweEWFWFwQ3ibghRVKKXF5esttuWcznLJo5dT3DaAMpE3zEDSOu8mij0EiEBH2wXNHMGuqyZNy1ZBHJBBCZEBI5ZXIWE2VuZnRDhwuBypbYqqb3nsvra3LKnJ095oMn51xtR1x4zOnBkp/9/Gu89vA+lRBoY8AkaltR5Mz++pKiULiUCbGHnJhVM7x3XHz8Ed2w5/a9Oygcm/01+801RhuyyLTtnhQCZEFIkd12Sz/0zOdzCmux2oLVaKtQIgGRmCLBO2JhcEEgo0QXZck4OJL3NKVByZ+qLCMxBkLwWGOY1TPW62uiTCitKcoFWtUEQPvEenPNd773CS92nmo2x1jNe0/O+cmTM37urZd89Utf4NYdiS0spEiKntDtuXjUYbQmJUehCrKpEFZz8eg9kpaE20fsN1ds12vqumQcesbRoZRGaT0JnS6jlMIYixKSuqox1qK0JosMAhAgciJ4T3CBKKfepLe7FhcTmsTQScrKooQjxEjMkyJUNw3b9TVGSgpjMWVJXc9IQpJDwI8D3/3BR5x3gvnBglk9o65rVvMZH3z8mP/nRx/z8PQYISWz+RypBTEMJC8Z+kR0A4w9pbJcu0AIgR//4K957We+yOWLM87XZ8wXc4a2Zb/fIeREeYOP+JSJPqCERFuDi5OsrnJCi0RGETOIDCknnPfom3IOKaHv3b1L2/f0+x3RDez3LWUhsdogXGa2XECKFLZECk3Oiboo6IcOXVXE0fHo2TlXg6I5WPDyxUuuzIbFYsHp8THlsuH+bE5TN8QUMUVBTBHvI5d9T2h7dAiIpNi2F6iQGd1Au9mxvbhiiIlqNWOzWU/oUilS9ghlyHlaBBESWiqqsoKUiD4y5AGlSpRUhBRRKZFSJsbI4EaUsggE+vDoiKrv2UjJ9jrixkCMiaw0uqwIIRJcoNSGlDMCiXOePnpWdcO273FBsVgdE41CK0Mg0sWR9W6HEvAfffFNjk+OWB0egJD0XUshNdv1BuM9VhiiS/i2I3YjR7dv8eqrr9Ftd9jZjMsXz3G+R2hDRmCNRCtDSgmyACXQQjJraoQQDPuWzW5D2+1ZzueUVTVhESkniW90FKVAK4OeL1ZIpfDOEWNASoHIAwCFlnTtDiELxphQGaQSxOApbYXre/q+QwhwbuTk9D5d23L+8oI8Jq7jljdOD3j93hHL1SEHh0fEECfZPEWUlISYyGEg9gGZMuTEy0efMKSAKAv2Zxc4ArIUiCyR2qKQZB+nySQMylgiGZ0dhTXQ1GQSu3bH5fWaqu+pqoqq9pR1hS0qpBDIAvQuDFR1xYoVUkHKU0PUVjI6hxASKSIxQxBQCENhLL0bGHd7rNE8fOUu57tHXHz6KYfzBUYbnHfMq4K3X72NsQXLW8dIZZF+hCxvlKCBzdUloR04e37Gar7guFrQtXv248Dq8AArFcYK4pgYnSNkB9JTNjWiqJCFxErwQRCEQEmF0gpb18ykZOwHUoi0/ciQMtqNlKajtCXz+Rz97e9+h7def4PD+YLFfEZOjrHP5OiJgNIlkgw5knIkpcDZpqP3I/OqwVrF3dUx9WzB93/4AefrPbWV3K0r3rh3yq3TE26f3KG0JTFlpFKIDCCxZUlIGacUp288JPtIHzJiUcOV4/LlGbPVir0fiQrQBSiFqSV2NqcqDag8Qe4ciTERUwBACInWClFVEBM+JWJMDIOj70fIG9bbDfpyveOjx0/Id+9wuJhR1w0i9bSbHuEdWhlcjqQbkWHMia3vMcYg5aQUKZG5fbRk+Qtf4OxijY+RWVkQveP28W0OTk4ZgkeSMdoiAec7yrrm9Tc/j1IK7z0hBMZxZL/ZclwUfP9b3+HF1QW3HtyjKWeoqqJqaopFg2oKpFVkpsYWQ8QFBzESkgQBWim0nLQDmSKRTBKQUiLnyXLTg3Ps+4HeO0KYVBehFVprghAM3pFSJgRP8IEoMybBwlYT/k6ZHANx7Ci05N7JAfu2ZbvdsFoecXp8yjh2SKkwxhBTot3vkBmUNgiR8N6hjAIBm+0WYTTtuKVuao7u3aFZLqAqKJqSuqqQdQm1QUhBN4x473HeQYogBEZkAgphFFpAjhmRwnSCgYwmATFEtPOeLjg+ePqE/W7BncMl5AhK48XUpEieGAIhehISZS1RCmLf4UdHcA4pFUpK+r5jvb6kmR/w4O6r9MGjvURKTYyRTELbaQS5tqPb7pjNZ0hb0Ls9ymgQku1+y+Hd28yPDpClJRmFtAa0QliFkBBiIvjA4B0xeMQk+iAl2MzU0AVEATbpCTtEpjLJMCLRm80G50fKwrCsK5IAkSDljFKSIGDixAJbVIzJk3IieIcEhjCw3W7wwQMCYyyLxQF3776Otg1BTqwMRqqqxmjNMA5sNzusECxXKxKJGAPeO2xhWe+uSECxmGHqkqQVpjDowmKqgqwFMWVcCATnSd4jBOTMTf2DvWF9gomS++SJWWOkIEdJ8g4jMvrw8AhTaEotKISCAJkCIT2Cm0+fMv6Gtbmxx5QFWIlQkkIafPAUzZy6nlNVNVZbinJOH3vGnSO4SD2bM2tmOO8J3rNoGgyCSMb7ADGilEQJxdj3FMZg5g3MK5q6JguoygprLY7A4AfcMOCHEXIiIxhjRpKpraGwFkTGx4w0BhsFY3AkIbDS4DLknNBX62uKwnCwqOnHERc8QmQykHOEFPApkaLHhUkXJIHSivliQVUsEWSGG8FBq0mB7f2Wfn3FOIxU5pC6meOdoygrisIy7NrJ2hY/XWZBVdf03cCYAsVyxuxwia0rshRU1WRypJzJCKKPjP2I8wGtBDd7j5SglERIhcgZKQNKZoJQFKIgZQgZjEkQFdqakqqoGMbAk7MzylJz0NTElBiBUQiiEGSpEAqMscznc5qDBaYwdK5D5wnjBx9w40AC9n1PJGGKhroqkGSk0ZMBkzLSKmRZE0NAZoFCIhCM40hdNyznC5rFHFuXDN5NuSEBMSf6caTvB0bv8UzxGwFYlSm0QiqNjx4USCHISIRMCKUhJooEghIhMzrnRN/3aGOwpeHxi0v2i5Gy0OSsyNKQlMCHjG0arLG0PjBcbjBGcHB4TGkM6/Ul2+12MieqBtCYsmA5X6BLS91UJAlxdFhjEHKCpkIbcoiE0U8PbSRHt04p6gJhDVlNXSyEgSAUMUzewG63I/mA0HqCwzJjtcEaQ5KTU6zEjR+AnsgPgcjNpGAySrRg+mEpBPvdSEtg1/WUhWVRGWaFRWmFEpoxJNruGmMkTVWyWt0leMHzy3NiGIg3oYYYAvV8xWy+RBc1pqmwVcl2s6Wuavrg0AJSyoyjg5zJKRJiRBeTY4QxJKFxceLxMWZCGBmHYSrV0QFQSolQYHWBVgprDaNQKMAg8HmSzJCQYkLkqVyyBJMEuu1HpATpRqyZVhAkMSt2faJ3I5WC0khAUs+XiOw5OjolRcNme05KjpwyZVGg1OT9VfM5tp4hraUuF/T9OHXsMtP1HfOqwvlxqumUKIoCW0gymSwSIodJwIiJGDzeR4LztH2Ldw6REzdJK6yyKDnpfFkI1KTj4m+AD2ryJlSemKFWCik0Mkl0yAmBRMREyo4sBAkmVJUEg+u4c7rCJU9V1aQItw9PyBR0+x5tSmJUWDth8LKaUc3nFPWcrCTNrCYnyX7XTUywH4hhyh2kmFBa4eP0DOTJikshk3OawmbO3aDEKXSVY7pBoHqCuwJEFggpyHLiA0ZCyoKQMhEIOWMEk08ozaRwC0GIDl2qOA1+Mf1B5xwu+CmoKKc0h9QFfb9j1645PT5i4wIXmwsOZius1NTlDK0kyhjKqsKUJRlBae1NBHZPcJ5m3uBjQkk17W6KyCwJIUziqQv4GAghkvK0SDkkxsSkAeRMYQuESKQ8QWApQGuFNRYvBJmMUJpCacQ4kmPCk6cTIMVklGYYvYcU0EJMb5ABEVBaE3LGe49tCpCKmODi4gprDBcXW/7mvfc4PTkiCcXJ4SEoTZYKqQuSLnBZkYNHB8XgIiErRJ52uxsHjNbEMClVIUZ8cHTdnuA96ac1mzOk6TQamZFospBoo5Eik3NmcAMC0NpM45lpfEOexqtS2JymKUAGOR197xw5BkCgyT89etMcjTch5aZpUEYQguPi6poxQNMUPHtxQUKQs+SDx0+43A0sDw6ZlxVHpib5jO9aVqsVuzFSWM12bJkVNT5lun6kqUHIjI8R6RISifOOcQwUyoKc3JisQEsFQpABLSVGy5sPCSomBBkhJ89SSdBSEEKchFApEBKEnJKmIKYQZwaEIqeIRiogTqOEjMgglUEKgRsHhFAslyuWs4qf/OQjDg8PqeuKzbalKgu22z3b7Z7jo6PJFr+RpmYLSeccznv82COKkuv9nl27pywMUWT6ccSmjFQSCWhpQBQgMtpmJCCkQGSBj5/1PFzK09G/IVdCChAZqQQpgwuBOPTUzRxlSkAickaQSMFPS6HMRIuMUnjMZ3hfiUwOkdFPYeJoDPVqydmjT+i9ICLo+47N9Zbm7h2evXhBU9fs245+eJ97d+7w1puf5/HzT7FGk8KIMVMsfrvd0LYtJ8eHtF1LghuXZpLatJGk5JBCo+W001NVTwZLjmHiJlIjlMBISYhqUjyVBSJSTHwvpUT0IyJr8k14KiVBSqCU+Ky3aIUELFFkEoJEhByQIpGjQtYl23bg7GrLfF5SGMPQd8znzaTQIggx4VxPjInNbsfzszP6oacqLNfrK46ODum6kevrSxbLBSln+qHHFFNASoeM0QaVEiIlEJnRSVJKWGsQSPINkQWJlGKi4mSsUqQUQRhIE9PTSjE/PJrivM7diCWRHNINSpyIV04gIaBkwiqBIEKeJOOcxGRrK0OUBVW9IOWICyMvz66omwatLW03UpUFMWWUltw+vcXZ+RlKST558pR+8Oy2O168fMZuv4MMu7ajH0bCOBKCx6dJchuBMQuGEAlxYnhCTB9fCAmqoNAGLadBL5QBI0EqUAltFFJqpFQ3mymQ2iClJMbEODqGoSN4j1IKrSUSJSA5SJOLizBIbRBqEtNlURJNwRtvfY4YEv3g+dKXvkiImcv1jrqaEWNCq8lTNEZTVxUXF1eUZUlMiZgSF2fnbK4HHj9+wfW6Z7Pu6MepRzg/ES6fAp5IyBGfmfA/U3vKOZHjSMwZNTV68tS9pqYZHAk+Q7UpZcj5hoAVCCWQRmJtMYUni5KqbpDT6hlEjggkBokRZlIVJFNeCEnd1HgvCAFGP/C37z9luVxSWMX5+TXHx4fkDIPz7HctL15covUUlxkGj9YzdpuBsZ9icW3b4kZP9GmaeHHy95KIoCRKqWnnUEipplMQw83YzAgpsFowXSWYysX7yaB1IaFFJoYp29w0c4wtqGcLstBIU7FYHfPWF95FE6aBnJVFpZthITNEi5JyYnAxIW3FYtnQmEwlBG89uEtRCvp9RirD9eYlXZd4+uQJQkyhyL/6m484OaqJTcmzp2f44Lhcr5EKrrfn5Pw6s3lDzomyKCiKYgotGE1pLFYKhNRIFMQwJceBEDxIEFoizOT1C2VI0ZPyNDmk0hhRcv/+A3KWVNUBu22LEFsePniFu7df5date2hdCIJzIALTiZvMUC1ASosxJb3QnA0DV7sOKkXTeB49fcbPfPEBVSEQSP6Lf/Zf8vDBG0gBu32HNZZhcDgfuXP7mCdPnlNVlhhhtZzRD3sWiyVVVQIJawqkmjLBk+CqkDdzTynDp48+5Pvf+zZNoREC2mFgzJGirjBGgxLINOGFsiipqjm3Tx9ycnQXKTMxQdf1IAKL+QJra7phi3j3C3fzmDIkP40T5PQ9GUSFvfV5WqU5mpeMzz7g+dMXzGY1oFktav7me+/za7/69/jf/92f8v/nK+fMf/ff/Nd03TV1WU1loDJZSpqiwmg15ZaU5vDghNu3HrBa3EJpS2knXuD8lFOUUiFSwpAmUZQcMUWJTxMZQSiSn1ZrsqRWaGXY7npenm15cP8OV+sN733wCfcfHPPKq69MczdMUPpf/+v/kcePn/Lln/sy88WcL//cl/njP/5jfvijH0xao1R8/Ve+zhufe4Mf/vCHDMPAX377L1ksF/zqr/4q7777Ljnnycr6O6+6mdHuN/iQiDFilCb6gBcOoxsElqPDW7z6ymtUxZycFUZmYsi44Kec8zBiBZMLlQRSaYEgEW4QEnEEEtKUINQEk0WmV5rD26ecnjTYlLFZ0FQ1ysDl+gopJcZa/uRP/oQ//F//Ldvtlp/85H2++c1v8ujxI37z7/8m/+Sf/C5PPnnC7/3e7/FLX/sl/vzP/5w/+IM/4A//lz/EWsvl5SXr9XoSM4VASvnZF0CMExaQUmGtpSprDleHnJ6ecnJyyuuvvcmrr7xK3cwwZYk2UwJ1CO6z31NymnpumK4HalMWSGUZh376x9oS/YCUFqEmf12hcDGgixnr6458f5KOjY7EBItF89ku/av/6V/x9ttv8w/+/m/x7W//3/zD3/mH3Ll9h2/+999k6AeePHnCv/mf/w2HB4csFgvefvttBIIfv/djzs/O+cpXvgLwWY7n776KoqKuFhwcHtHUNbOywBpDXS8mPbIskHriUqMbiHESRbWaEOXoPUpNHuPRnbscrI7RGVCFpRDg/E9tJUWOkSRBpkClYTt2NMtDPv/G59i0HdshUdgaSWB0/rOH/K/++T/nT//03/FXf/Vd6qrmL771F7z55pv8zn/6O1yvr3ny9Am//Y3fpqwq/uzP/j0//OEPefjwId57tpstXdfhvafvexaLBTfMBSFgOV9gpGS5nGI3VkuMVJCmRhxCnuI40U33EkK+QapTYxdicrKWqwVNOSdkgRRMuFhJSWF+igYDmYxPYWoWIpPDgCwsLiQ+/PgJX/65Nzg4mHF+ec1sPiffiPIpZR4/fsw777zDs+fP+O3f+m188Lz++ut84QtfoK5r3vz8mzx4cJ933nmHb3zjGzSzhnfeeYevf/3rLBdL/uX/8C/5/d//bz9LrE9NMDHF/DJSQmENyhh8zoTkp0SLG/CDZxhGhmG4uS/QM/YdyTu0kFglGMaBi/UZF5dP0FppPJmcJUIKirIkRoMfAzJHVA6oNElQDqiXS2ZNzej2fPCTxxQIbh3OEUKQUuLBwwf8i3/x+3Rdz1e/+ov8+m/8+s3CTHf2/vE/+sdTUDEn3n33XV577bXpIkPbEmPk4cOHfPe7f8W9+/ew1n52sqRUExgLDojT3QNpECKAnDRFFwNaWbpxgJsrNDlBXVis1aTgGfsIRLybJp32MUCauHOWEyubyKnHxMgqOpZ+z0tdIZRidbzg4olAYHj48Bjp4aP33+f6es1qdcCrr7z62UO/9dZbf+cDSIqi4Gtf+9rNO1ONL5dLAI6Ojj772V/4ha/8f+p/fXlBt91jExgpUUoDacoKKXXDFjNCJyCQU6Zu5qSYETLSd3tUhCglymjC2JOCRyM8KAkofionRqbdimG6P3Q4q2nMkq6NJKc5vxq4vhp5+vSKpi54/4P3+dqX3+ErX/l52n7kxctzPvfGq/zovY+5c+eUlMBaye07B/R9i/cB7zNdG9jv99S1oSgnb+H05OSGqBjqqmQ2m0+J8N2OSisOFkukkDcOs0NrdeMMTYbuJIdnxhDQcrqskXNGkFFCEeKUgPf9SPbjJJhnIhqByYoRhxdgtULkkjY4ur6jLj0X0XH/1gE/8zP3eXl+wcHhCatFTTf2vP/xM/phj8uJsxd7ri5eMvrMbrsmi5GiULz33sDVek3dlJy97NBKs9kFZjWUleTgYMXR0SGHhweUZUnTNBzUC5qq4WC1pFkdERJMUkaauELKxOiRYiJk3OAHrRVt1yKyICVPWVoykEIihABj4OqT5/y/oZAlF3AgBoMAAAAASUVORK5CYII=',
  '/avatars/avatar3.png': 'data:image/png;base64,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',
  '/avatars/avatar4.png': 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAEAAAABACAYAAACqaXHeAAABMmlDQ1BJQ0MgUHJvZmlsZQAAeJx9kD9Lw0AYxn+Wgn+og+jokLGLUhW6qEsVi05SI1id0jRJhbaGJKUIbn4BP4Tg7ChCZwcFQXAUP4I4uMYnCZIu9T3eu98993B37wuFGRTFCvT6UdCo14yT5qkx/cmURhqWHfpMDrl+3jPv28o/vkkx23ZCW+uXsh3ocV1pipe8jDsJtzK+SngY+ZH4JuHAbOyIb8Vlb4xbY2z7QeJ/Fm/1ugM7/zclp398pHVPucwu54T4dLG4xOCQDc117XoMiMRDOSI6opCGTmoik0COvhQXR0zSv+yJ6w/YHsVx/JhrByO4r8LcQ66VN2GhBE8vuZb31LcCK5WKyoLrwvcdzDdh8VX3nP01ckJtRlpbnQsNT7U5Uvb1X5tV0ToV1qj+AiCUTfu+YhZyAAAnHElEQVR4nJW7abBd13me+ay1h7PPPN5z5xm4GEiAAMEBBCdQpDiIEiNLliy5rMS24sRuJa5yJ9Wd7nTlT1d1pfpPJ53qqu5UEjuJOpbbciSHtqxIFCnOBEiQ4AAQ83Rx5+ncM+5prZUf+wAkJEpU7z93OPees9e7vvV97/d+7xZKKQMghCDwfRobDf7d//X/MLdnD6MTo5w++R4ZL02n69MJu3TaHd545RiubVOpFllfX0dFMUEQMjo6ilaKhcVlRmuD+H6PbhwS6QhjNFprWu0OQRRRKhSwpSToRkhh0FrT7rYRUpD2PIIoJlaabDqN7VgASCGIwoiuH+A4NkIatDZIISkWShSyefwgZGpqiiiKuHz1ClEYYlmSPbt3U6tWWV5eYWN9neHhYQ7fey+SG5cApRSri0usLK4xMj7Ou2+eIG27YARoQ2N9g6WFJQwQRSGBHxAGEUYbgihmeWmZ+YUFMukMYRjixyExMZAsUGtNp9vFEsmCNhsN2n4X13Fo99rEOsaxHXpBRBhFeK6LZQmM1hijiaKIXs8HA9polFLJrUtBLpul0WwyNDTEntv28pWvfZVdO3ZSLBYxGM6eP0e70yGbyTA8PMz169d57/33sQGMMQgjMMZw7sw5MJL5y1fYXF1j5307mb86TzqXpdXugTEYYzBa0+v00EoTKUWr1aLb7ZLNZinkcsRhRC8KaffaRFGMJQWxUmitsSyLrcY2WmvKhRLNTptu4JPx0oRRSBxr0pkMrmtjtCbSCqUUcaTR2uA4FmAwBryUSy6TI440pWKJQiZLqVbm6N/6LFrF/PTHL9DptJlfXODshQvs33sbKc9jfHycE2+fSAAQCAACP+DShUtEQcz5U2cYGx/Fcmw0BiESoDw3RRgE2AL8fvC0Oh0QEsdNUatWKRYKXLl2jZX1NaYHx3ji4BFanTYvnXqLD5tXcKOQdDqNIyVh6NPoNLEsG60M2mg8z8OS0PN7KKMRCLQyRJG6GfpKK6rlCkppKqUK1xeXuOvgnbS3mwwO1kHA0ScfQQLHXznGrtmdvPH2m5y9cJ6BapU9u/cQx3E/AkjO0fZWg5XFZZyUJJ1Jk8llQST5wRjIZjOEfoCKYowwCCEIw5Ce71MoFpBCMjY0zLWF61xbXeS2sRm++eSXsYyFVoaRYo1/9cM/Rbg2uYxHEAQ0O20MAolIosO2iVREECoQAsdx0JokiiyJZQsMUCmVcR0Xy7XwewEH77oLG4nSmsnpSQhjlFIc/fxjqDjm9Zde5wtPPc2Jd9/h3ffeI5PL8ne/9QcfywHAytIyvu8zOjqC1pput0ehVMR1XFw3xeTEZP8vDdoYhEl2P5/PoeMYSwguXL7M8uoqjx84zO9/7quUcgWMhLbfIZNKcXTvXQRhgIpjOt0uURwjpUQLMMIQxyFKxViWjeukULEmDEJs2yGdSWNZFvlsllK+SNBThD7ced/d3H3vIRobm5TKJYZHh9FhhBAJqI/+2pMcuPsA58+c55u/9zs8fPRBTp54h1d++mISATeu1aVlpJAMDw9z4cJ5ytUK77x5gsVrCxy69zDVapmr5y9gS4kREIYRruOQ89JsNBr81iOfZ317m4nBYR7YfQexNlTKJRYWl+hst5C2zdzEFM+fOYEfhPT8HrYtkUICBgRY0kKKJGLCsIcxmmw6RzrtEauQbC5HvVrn+uIyOjLM7Jniy1/7Mn/1n59FCsnE1BReMUev2cKx7QQEY3j6N56hsb7JS8/9lH/4j/8Q13Z57oc/ujUCGhtbZDNZKtUqURxz7sOzLM4vICzBK6+8jC0kw7U6Ugg820EYQ6VQIPB7jA8M88jB+7hnzz7umN1FOp1heKCOY9lUCgVGBgapFMpY0sIAQRBiACmTWzCGfqiD34sI+ztYKpaolEtIISjli0wOjbK0sEpru8vcjhl+5+/9NgZJY20LrTV33HkwqRr9JAkgjMZIya//7m/S3NrmxCvH+Qf/8x/x4MMP3gpAt9Mlm8mQ9jwuXrzIyrV5Do/u5pk9R9iRGeDDt96lks7jOC5RqJBSYgmB0YZGu0k3DBgsVmh1O+QyGVKui2VZlIpF5mZmOHLoXtKuR7PdItYxShl6fkQvDPHDiDBUxLFBSonjWgzUqgxVBnCERSGTZ2JkjEuXrrC13eTgHft55oufZ++d+zn5yjE6jRb1oSFu238bKowQRiSlXYCWEiXAK+b4tW98heOvvsnW8hrf+qf//a0AWFLi93pIRzJYqmJrQUpLspHkrtoss9kh1jY2MVrT6XYwJsnasTFsNDb5F9/9EyKlmBuZxLIcer6PNoaU65HLFXjn/Gl++OYrCJLddhwHx7ZwbZts2iObSZHJ2nhpm5HBIYYrSQSlvTSVcpnT586x3euxc3qSRz/zMA8+/ThXL11l/foirW6bex86Qq5WTCoWBiMF0rJASKSUhHHM2N6d3HHPQV750UvYKScBwPRjJVfIM79wHYNhZnyMWr7MWHEIJxaIMCLV0VTsLFob2n6XIIqQRhJHMQZ4++wH/PPv/BtOXPgQYwyFQolsOsNmt83/9u1/zb/+3p9yZXkRz/XwXJeUY5P1UuTSHp6bgGFLwejAEEOVOkLIfjLucubCeXw/YKQ+xBd//Ut86e/+JiqOOHf8fRqNFoVCngN3H0CjEbbAdm2EkAghblYxaUu0Vtx39Ahh1+fMm+/fmgTL1Spdv8fK4jIF43Jw/4PktEUn6JCxbELlkxcpsuksSmt6QUApV0BphTHgWDbn5y/xv/zx/8HkwDAHZvbwlQef4CfHX6PiZvji53+DZ996mX/1g+9QL5cQQKxiEAI0uI5LJVfERIJr84t0em1ipXAdB9dOMT0xyTNf+gJf/ObXiX2fl599jpTjcurMaf7O732TbCGHbVtoFWNJCUKgjEH02eJNLlPKs/+eA7z/+tu3AqCNYXx4hM35Fe6q7WS0WMUPekhLYNkuA7kKq+vXkAYUhiAKibUi5aYopHNstLaTZBYrTl+9yIdXL3Ls1Em++uCTjNdH+PMXfsTYyAifO3A/b106jbAFhVyeKI7xLAcbm1a7y3rYQFiCgVqNkVqdZrPJ1OwsT3/uKe5/6mGQhue++1dkUznePPkWk5OT3HXkXnSskUBsBIhkwTd4zE3GLwRaacZ3TrFwef5WAJTR1Cs1MtrCUiBF8jsZg4o0Kccl56bQYZxkbiFo97o40qLr9wBBynExRpNOeeS8NKGK+PHJ19lud/mDL32dfeM7OLx7P+fmr/CT997glbNvYwuJ40oCFVLMF1EYKoUis2OTtDotcsMjPPb4o9z76P3Y+Qwvfe9vaK5vI1IOp0+d5p/9r/+MSEWUCyXiXoSwBFoYEDqJBFtysyT0L9d12XNo360ApLwUGe0yZBcwSoFKeL9EJA1ILyRrpdBGY7QGy7C2tQnGYEuLQjaHFAKDoV4qs7ixzvXNVTbbTf7pN77FU0ceYWVtmaJdZl/KZefoBBNDw3z7hWfZWx9mpDyAsiS+jpBScuHyJfLlIl//+pf5zFOfRTg2P/mLZ7ly+jK1eo3v/X/f5e9/6w+ojQ6iYo1t2yil0LEGkmqCVChjkFaSCI0xCNtCOBalWuVWABw3RRwqClaajJ1CKYVA3KTKBoUd6eSNAFtazA6P4LkuraCHK20Uyetb7RbSkhRyefaOzvBrDz9JHPuUSiWiMCJMe6ysrfG1R76A56X5s+f/CiMEAonSiiiOOXDPIX7793+XkR3T+BvrvPjci1w4dZFU2uNHz/6Ar37tNzh89H7mr88zOTVBHEdIaWFMP/EBKoogBOHaKCGxHJswDAGIjb4VAMu1WGtvkstmKaQLxHGIZSRogxAahSHruAwVKiyXNomCkLtmd9PqdLjWWCVSMTpWLKwt4ccR4wNDxFqx2dqmsb1OLpdHGE3aS5HLJ9Fy+eo1nrn3ES6vLPDyyeMcPfIAu3bPsf/Og9z78BGU8lk+e543XnyNi+cvEkeGKxcu82u/8VUe/cLjXL56icGRYbRJdl0pBcagjMFxbRAGrRTd9Q69ro/tOrTbXbx0inajeSsAmUya/FCFdthjqFhNCAUC3e/pbWmx5fusNTbptjtIy+K965dQcYxGs91qsd7cQlqSkWodW0psIWl22yxvrrOrUCKKIoyBdqdNp9PFKEUURvh+j2Iuz//wP/4j6lPjdFotli5fZWl+gbfePMH8lUWkMbhuiq9842scOHInV69cYaA+kNDkqJ+XjCKOFdoYms1tGo0twraPjgWZfA7XS2ELC6kMade5FYBCocCOuZ0snlmj6uUpZvNEvaTplULSjrr81YfHeeiOwxwdeIx/+//+CfPLi9SrNQbLVbq+jxFweG4frV4XPwo5MD3H2cVrnLp6kd07dhO2Q1bX1gmDiJTrsrS1znde/q+cvz7P0w8/xvLKKtcXFtFxxML1BT549zTtdtJw1etD3Pfg/UzOTbGyuER9qEammLtJm6WUbG01aDfbtJotQj8gl82RzxcplEvkygUsIWg327gpGyj09YB+mahVahSKBaJayIunTvD0oQdwUy7toEvRyfDTM2eQBY+//6XfhJkyXinHh6c+YCxT4tDkLlQYs7y+xoXFK7zdOEc2nWEwX0GNwpunTvLZgw+wvL5OGAZ0fZ8fHn+Z4x+epBfHfO2xz1EbH2H+8jxCSlZWV1m+voBEMD46wvDIKPvvOkhtpEan22ZodBQn5RAHEYKk5p/94Byri8s4jkM6m2F8fJx8sYDrORhhUDoEKckW0xgDwvARAMYYcvkcY5Oj6EqNlY0V/vfv/TF/9ORvUsoU0JHi7MY1ZvfuhpSktbDCU9P7eSQ3ge6GuLFEmZjpXJZ7psd5qLybvzj/Oi+efodHDt3HD469xDtn3qeUKXB5/gr/5fWfstzc5JGHH+Tuu+8iW8hiey4Ii+XFJYJOB891KOQLTM/Nsefg7eSKGTCG+tBAwp3CEKQgjiOunL/CyrVFsrksQ+MjDAwNoIxCSNAqRomk8ZKOg1YKo/sE6YYoCskfrC0ssXB9gXPH3ufYa8cQgeZzM4c4OLWL//vl/8zY7AxPPXiUl/7mOfaaKra0EZbEYMC10ID2YzLCJlIx//zNv2Df/tvp+gHvXjzNH33ld/np28dpqB7f+INvsufgXhAGf3OLC2fO8+Zrb3Ht8lU8x2Vm5w72Hz7E1M4pECClwLFttNYImbCcII5ZW1ljfWGNUrFAbWSQbDk5uqZP7iwnuUelFDEa1QtRfoBQPwMAQhAFAZdOn+MH3/9rHn/oES5fvsS//+NvM1qusdVsUC5XGS5UmDUF7pveT9DzkyphzEd6YRSjtaHgZfju2dc5EVxjuFzj/fmLDJdqDJaq/O3f/z2yA2WuX77E2Q8+5L133qXRaDAwMMDuXbvYf+gAew7djlfIoMPw5jE1OlGi+ioenU6PbquDCmNKlTIpzyWKQlScaI/YEmMlvcDClQUGagMEnTaNtQ1WV1ZvTYIYg5CSTCFPa6vBdqdJ2kvxxCMPIVMujcY2Lx97g2On3uF/+szXsaVFIEiIEn0cY43UyfmKo4SVnV+4hhSSpw89QD6Xw6Rdnn/+p8wvXufa9XnQsGfPLh576nGmZqYZnhilOFAGE6PDACE+Jl7Lj2itVhrXkshsBpEV2JbA77RxHIcgCum2FN2uz9r6GsfefJMPTp+mXq0hhaDdbnHmwvlbARBCoJQiXyxw3/1HcISFyGaZmJpICEUU8uUnnuSHr7zE65dPcXh4T383bogPAiwbQwza4BvFSrBNrVxhbmaW6411WktXWd3apBP45LNZ7th9G/tu38fM9BQjM+Pka0WEY6HjEIG5ZfGfdAkhcGwLHcWYSIMQdDo9lq4ucebMBd764D1eev1VNhoNDAYVxyCg2WmCJX4mAvpv6KZc7HSKdqvF6MQoWsUE3R6tToeZqUF27Zjj1Gsn6EUBSJnQ5qTrQErQ2FiWYDvo0Ip8LGmxvrVJq9Mm1Iqx0TEGBwaYGhtnfGKcfKmEFoJuu4Pj2ViOjeM5SZf4SxdPwvy0Sqi5EGytbTB/9jo/eOl5nnv9ZY4+9Ci377+TrUaTTDpL7PsMDdTwch4/eeX5WwEwxuA4DlEQIqXk7PmL1AYHQBhsx+bitXk6nYB8No2yBYEOSEkPJQxSmI8aDiGwpMVW2KYX+gwPDjE6NoaX9pjZtZP9+28nncsihCCOYzLZDE7KIQgCpGPBL9/0jwEggTjJ9kLQ3Nrm+oeX+f4PfshPTp5gz5791MrD1MqjrK6uE0QxrXidsfoQf+vLzzA2MvKzOQAsyyKOYg4euYeNlXW2t5qkM2na/jZzO2dRkcZWhkyxwJWNFe4Y3UEnNoBOmqePvZ1jBG4mzdPPPMP42Ciz++bw8mkIeoAE0dcCY00cRwgJIlLYdr9p+ZQISOqYQAKR1jRXGpx8/zSvnTvN/v2HsaXL9aVVPNel0+0ipAQEWitCHTJYqvwM1n0pybZt0p5HZWiAs2fOkssXiOOI23fvYu/eOYw2jA0N8v7qNSwhQBqMIDkOgqSPFoLlZoPxvTt5/Imj7N6/E8+1MD0fYyRICbaNcCws18JybGxpYeIYE0bgh2B+fs2f9Dtp2YRByNrqFq++9y7TM7eTy5RRxtBqd1jbbOCHMdJysaRNpVIhVopes/3zOQAD0pJoo9l/YD+n3zrJ5UtX6Gxss73ZoDZUoxP3yOdyXN1Y4oPrl9g5NEmgo/66BYFStHs9lunx2Oe/gLQt/DAgDCO2G9tEUYTjOAhbQgSW42KMwrYF2ZQLloVwfv7W+luOkNbHVi8wxHiFHD4RhWKVgeEddIKAVCrD1tYWSsWk01kG62NsqohiqUDoB9DtfXISNCRiZ210kC9+/St899//JyaHRzBYXDp3hU67S8pNMTgxxImlC8zVJxPxEQMY/F7Aut8kfdsIt922i6tXruCmUsSRor3d4tKly5y/cJGNZoNsukAuW2BiYox6uYwnYXCkRnlmlJTjQqT6NV+AEf0w/tj92hZGCVJZl+m5aSaHJynWR4hVjO1mWcs36XR7TE6OUy5laK9eo1CqkLJseiuLPw+AIRlDG23QaMbmphibmeL0yfe44/Z91HpVsitrDNRrRHHIG4tvcHzhLPdN3EbXBMRK45azXM5vc/8TDyEtwbmz5zn2xjEiZbi2ssjJ0+8zNjrB7OQsx0++ShCGpLMewwOD3LlnH4+59+J5G8ixOq5jYXRf24Ik2398s/ppQilFuVpldHQIr1gklS2jlMXAYDJXdB2JVm1mZiaJg4hzr59gaHTwk46AQVgWsYr6aMCDTzzCq8+/yIXLV7hz/x3k8nlK5SJR2GNh5wR/duwV0o7HgaFZhHR4R6zilyTT45M8/+MXsaXD1YVFXnjjNTKZLGNj0+yavYNKtU59cBo/7LG2scbVa9f4/vM/YbPZ5L/75jewNBjzixOhNglPkFKgFRQGK8zMTbG8uM3KwiJhaMhmc1gCYiJSImC0ksNvblAaHWBq910/Q4X7l9KaXrtDNp8DksrwX//0Lzn52lu02i22Gg1GhoY4sP82TKx5+733iCPN3cUZjIIfXH2Lickxfuvv/Q5LV67xL/7l/8m7F84yPDDIzond2F6eSEGsDfXBGtISdDpdgl6I67jIsMvhQ/t48pnPUBgoY5T+hRVBWDfygUFJCDoBy1eX6Tbb2MIi9EMs26ZcyRO2WmSLHvlqkaDZobO++QkRQDIgcRyHbrtDvlgAY5g7sJfrF+fxw4Bmu8X2uSaNZoPPPnKUzzz8ILHSvPHWO3iZNJ7ncvn8Ba5dvMILLzzPhSuX2T0xw0h9GGGlMUiQYAnB0sp6EmhG46XSWLbLrpmdtFo+i/OrFAYqvzACkDJpayUYBGhNJp9hdLxGtJ1KADJgtMJzJTqTZ3t1ne31NUQqRWHsk45A//IyaVrNJlsbm5SrFQYnRijVynTabfKZZfL5POcvXyJ3/C0sKeh2OriWx8baBkYb/DDke9/5c3p+wIG5vUzPzPLIZx/n+3/xLN0Y0l4a3w9xrRSxUoBhcGCMwcFBRoaGWLl0HqEU6E/afQMkDY4QBtPXLRMfgUK6KdyCIOoFiChGCpEo2VqTLZeRnotbLiDS2V/MuYwxFIpFtFYsz18nk80yMjVGq9VidnYWx3WpFItsbGwQRTGN7RaN9jYAWhtymSx33X0P3/oH/5B0JHAtl1qtyhNPPoqlAqrFMhPj49RrderlCabHD3D73sNMTe6h3YooF/MMD5YwcfQzMa8R6AQYFYNSoPqJMWlLcCwb10uRyWXJ5HOks2nsVBo7nSNTLuPl8kglIIx/OenUWlMdGMC2HdavL1IfGaTn96hUqhijmRgbx3Fc1re2KOTzZNJpdu/Zxcz0DPV6HRNFdCOfr/z2b9FaWeHP/uQ/kstkOPrQYTaWrlDO55jbMcc9dz/AnQfuRmDTWm+RNj327xvH8VII68buJxKO0RodxpggwPghJowwSiEM0K8Kpu9fMEpjYoWKEwHEGDCxweh+wTb601m31pra8CBuJo2bstHA4sISY6PjGODO++5BK0Umm6XT7bK+soLr2kSxIpVyiTtdDj92H3/4T/6QrGPxw+8/y9TUJE989iGaq9fpbK4xf/EDtlYuU8uF3LW/zKOfvY2JHcN4lWLCGEVfvzIGohsARBCGEIXJTF319Yi+zyApkSbpK+QNE5DASPqlUyRD008DAEDFikKlTLZYZGlxgb0H9lMZGKDVbDM+NsHo+Di9bhetE+eWDkOUUqxvbJArFVg5ewlpGb7w65/nnoP7mT93kc7GNjvHhqmkImaHXR57YJIHj0wwUHXwt7eIo+hj0xxzY8sQWiNjjYg1JlIQaYROFm5uLLL/VVgSLJGQJccCx+oDmkQL4hPa4U+8RGJLu3LmErXqIBM7pnjjhZeoDdaI/BDHshkaHeX0qVOsNbaYnplhaXWVrfVNFpdXKM5OE7ZapE3Mg5+9n62tbTbWthmfnSZXzGCiAB1GdFvbgKZSryA9j1tbKwuE5obscOMlc4Mj2TKhxUonP1sCsJPJtzFIp/+9FBghwBJI2/p0AEzfuLS1tkFzdZP9+++gtdGgtdVg/z2HSFfydNsdbr/tNoIg4NXXX2NkaIhcJkOxUmLz+hJnwph9h/cxMJxi6/oyriUYGyogups0NxYRQuLlcqQKWSwvhbQdtJQIBMIkUyjsZEHCSc61cQxCCqRto5ykqUqMVibJBf2wF8ZOANGJp0kjkiPhOMRafzoAlm3TabU5e/x9xuZmcd003XaLvfv3sev2vawvrqC0witm2XvHPnKVPC89/zLj9SEq1TKVgRpzt+3lvWOnOPjQ3Qwe3E+w1SD2e5gwwnVTOJ6HlUolIWrbKCykbd+kucaSH2mCnouRIGKNjhW9KCJdySNsC7RBujZIgY5U8v92ogsKpZNIEBYi7YIxXDl1CfuGOeJnR8iQJMDtjU1Wry4wuWcHWiuqQzVy3SxCCqJ2j5GRYer1Opc/PE+hWGSyPsKhAwf50Y9foFAsMj4Z0QsC8oU8rzz7HA88/Sj1sUGcdhuUQWiDUjGQiCiqH+39eSz9SXcSvjdC33EwfcHIFSJZpBAY60ayA2GZ/jlPdl9LjbQsVByzdP4y21stcoVKAkAURrium5x1rRNl1xjCXkB7u02uWsFEMRhDfqCA53u4Toqg0Wb8zjl2n96L47jkiwWkMkzv2MH8/HUuXbnG+sYGT1o2d911NwOVKq/89Qsc/fyjlKsF4sjHMhJLOokbN0G/b2tJzqkRJMmwvzIhZVIQSKa8TjphfDpObLM3s4addKdJ8UgiI+j0OPf2aWpDdeqjg7RbHWwpZX+sHGPZNgJBGAT47Q69dodOu4ttOeSKOQq1Cs2NTYanZ9he3cLfboOBQrWM46Y49Nhhgs0e0pYcPXeUl597gQMH7+Tq2QsMFSoMjgwzNDjA2XdOc/fRwzjZRPLW+iMpTVp9saQvqiAM0kqcZUjxUaT2x9xbS6toZSgP125K5h+PatMfk4d+wObiGtO7d5CvZsFAJSonOcB27OQDjEHYgkwuSzqboTRQvTkal5aF0or6+ChCgJNNgS3RfkQ64xErg+4pwjAg5+XYd++d/M2zf00un2Pv7BxxGLI8f53GxiZ22uO1H7/EHffdSTrtYDsO8DHLXD+JIZL+31gfc3z0y5wQEmM0nUaLQrGM7i9aSoG8IZhoDRriMKSxtEp5oIKTkkQ9H2FZSSeZrPtjgqb5yDQlLAvLsqHvuBQIjO6HmtIEfkC31SaTyVIbqCFTFvlCDuFYeFmPgYEa77x7kk7ks+/QQaSQ1Op1Dj58BM9Lc+nMJaTrIVMuWImVTVv9BUuJdCykfWNRiRIkpExAEQKkxdjsJPlCGhFrbCnoNdusX1ti+cJVOpsN/FaH9cVVyrUqlhSoWGOMRMfJXOGXVwFzayW+EaZaa5yUS2GwzOZGI5HFtebK6XNsrqyzsrCE3+kl88ZcllffeJ2Z6WmkEFhWYoDYc8ftLF9f4tRb7zE2N0GlXktcXLFKBFFL3Bx/3TzcNxJjnyFIk+j8xhhsz6W1tsHimWvUBmtoP+TqtfNsLm0wPjeDrEuMIzFobGy0NsRx/Ml6wKddpm85aTWafPjqSdYWlhkYHUJjWL26yOSuHRgM3/43f8yO2Vm2NhsMVge4bfcerl67Sn1slB27d2JbSYndbjSwUjb1qWGGxoeRWS/5IKVBq350JgTmRgSKm/dhge0QdLtcffccw6OjZMoZLMcBA53tFisLy6jFFuVqkcxwmQ1/m1w2T75a/tUB+NlyaYzBsiw2VzdQvYhMKcv5t09Tr9UZ3jXNqz/4CX/+7f9EpVqhXCijIoVjWeQLeUr5IrO372J4cpyg3cEoTRhENJpNkODlPDKFHNXhOqmMh+0mYY+Ufc7fn70BfrtLGEScO3GKwaFhxvdOE4cRSIEUApnxMLFi7aXzBJfX8InYdEJMxePex478ilS4v+Bb+vI+bOmMx4enzrF+dYk777+b2uQwG4uLXPzgQwSCXreH0Qa0odfpYa/YzM7MkLmyQNDpsWP/HuIgRNoho6Uivu/zzuvHqNUq+BtNjAAvm8FKudiejbSTqoXRrC8s47oelaEaY7MTOI5Lp9W+qWQpo/HXt/GvbCIWWuSm6+TyDhXXZnFzjQ+Pf/CrA/CRqTkBwrItlq7O8/aPX2MgX6aaLyVWOdeitdlgu29dX11dxQ98ep0uzWabfC5PEAXYnku72UQpzfjcFPlqGS/t8dZrx4kjn/sfPUIchRg0YRjRa/t0tppoDO3tFpvL6wyMDjN99xwqjChU8wgh6fV81pZWyNcq0Axovz2P7ThYhRTpu8fQrYDUUJGyGaWx/AsksV8WBZZloZTi7Jvvc/Knb3DfkfsYnxintbXNqfc+oDZaZ3VxGS+dJofm3PlzlEtltEncYyqO2dpucv7cOcZGRvoVI0Oz1WFoYoRrly6ze24nWhqiMCTluqS8FF4mTc2uEsaK5aV1LNfBcl1WriyQzqbJlbKoWOOlM1i2w3ajgeopRDvAyJDUgTFUy8fJpzEqSZz5au7/3xGwLIt2o8XV98+hg5CHv/AEqhfh+z5pz2NsaJTzx0/RbXYZGhpk++IFOt0uuVwObSBWEcLxCHo+zU6bza0tLCmZ2r2T7bVNLp06y/jIKPvu2YfWEa7nYmIDGrSlUUaxtLRBdWaC0WKGuBfRbbRYW1wjjiLKg1WUUtgph+pwjW6rw/ZMHr3uk8m5iY8o60Ko+iVe/BI94OPOyv7MsNXYZunSPIVSkT33HGBodpRABaysrIKUDIwNI4WFYzsUB2q0W21irYlNcvOBijACepFPFAX0ooCz584zvzjP8I4pJnfv5L4nH0CZxMeHJW4OSi3botVsUxyskStkMX6Ik7Ioj9SYuWsPkRYEYYR0EweJihWZXJahu2YpPjBFq90kaHYT83TfNCk+evtPuD7eHElBr9Nha3GVar3KwNgg0paoMGB81xTrm+tsbG5gl7JIxyadzWK5DlEY9nOHQMUxjmUThYn0vbq2jtEGx0vxo7/8a7ZbW9hpl+XVlaQTvOE2sUDYEqU0nW5ArlzAxDGSpPdXcVImSyMDNNYbGKNuKkJaKUwUk89kqEzUscoe7Y1tVBTfbJp+JUXIYGiubVEolihXy0loWgJsG8dLMbFnlqW1NTqhn6BqW9j9dtayrL5/PwHVkMwelVKsr69jORYjw8P85X/4Dpvbm7RXttHKYESf9QkQdvJwlut5SNfhxmxIhBqi5DynvBSZUoHGegPLtpJkjUAYQawM0rLJVYuksxl0pAi6Plr/CpqgEAIVxlgI0sUsWgq0JcGSCMtChSH1qVEKA2UuvP8hmWwWy7JwvRSW6yT9hRAJECSW+OSGPTa3GqhYYTk29VKN5/78v/D2sbcwWiBsG32T9yc5KFXIJLuLwEQxURQilML0n0csVMsoA51mB9t1E8usTvyDok8jbccmlUmBMcRh9OkA3GiSLNvBcd3+rlj05dekhY5jhqaG8TsdjBAJw5KSfD5/szuzbAvQWEJjWxa2bRGEAb1ejzAKkbbNjqlZFuYXefGFl7HTaRL6YKFUwvh0rDAINlbWWLg8n0SULdB9/VAbQ3V4kMZqg9ZGA+k6CWmOdaKr9gUFTWL40J+mCt9okoIgBKuvuX0kOdzU54yOyRSz5KpFeoFPrlpkeHqMQr7QfzxG47pOEpKAa1tYlkXKc1leXSVWMc32Nrl8jrmdc7x97CTnTp0mlU2EFwN4aY/OVoOg06VQKbG9sc3W8kZChY1JSlsUIY2mNjlCa32bzmYjYZDaJOaNOBmOSJJpku25v0IEGEMURbc2Jh+9iNACjETYDn4UcPL4CZSOqU8Oc/ih+5mdnqHX6WA7NkiJJnl0JWVbZDJpekGP1dU1epGPtC00mrmZWY6/9jZaGnRfJpO2jee4rF5dIJVNMzA1wubaJq2NbWzbRvshhArtR7iuTX1mFB1GRGHYv/e+sqw+9m38KYMRIQSxirEs62Y2v+Vw6MRxlSitsO/wneg45uTrbyEdiz0Hb+fxzz1F2kuTTWcxxqBEkjxxLCzHolQusLK2RqfTQcURcRRSLpf6zw3GWLaDsS2UMOQrJYJWh7PH3qO90SSbz7F2bYVus4O0En1ACIHpBRBFZApZLCnRSt+yLqN1XyQJPx0Aow2WayfzNRXxkR6dPJunpQHbQitNppjnyJNHuX7mEhfe/RCvmGHHbXPUBwd5+KGHmZ2ZvWlsviF9eek0XjrFtfkFOt0OhWKBTC5HFAYYx0HaSRXRAlK5NFM7pxgerFGv13BdG8dxaG+2Er2gf0ClSB7GFCIRF39utnhDR8TivwHe70C6SfRUjAAAAABJRU5ErkJggg==',
  '/avatars/avatar5.png': 'data:image/png;base64,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',
  '/avatars/avatar6.png': 'data:image/png;base64,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',
  '/avatars/avatar7.png': 'data:image/png;base64,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',
  '/avatars/avatar8.png': 'data:image/png;base64,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',
};

</script>
<script>/* inlined forum.js */
/* =======================================================================
 * Forum System - Two overlay forums accessed from the phone interface
 *   1. Social Forum  (Twitter/Weibo dark theme)  -> #socialForumOverlay
 *   2. Doujin Forum  (LOFTER light theme)        -> #doujinForumOverlay
 *
 * Loaded after the main script + forum-avatars-base64.js, so it can use:
 *   state, activeRole(), getMessages(), escapeHtml(), $(), $$(), toast(),
 *   request(), CONFIG.userId, FORUM_AVATAR_BASE64
 *
 * Exported globals: openSocialForum, closeSocialForum,
 *                   openDoujinForum, closeDoujinForum
 * ======================================================================= */

/* ----------------------------------------------------------------------
 * Shared helpers & constants
 * -------------------------------------------------------------------- */

var FORUM_AVATAR_KEYS = [
  '/avatars/avatar1.png', '/avatars/avatar2.png', '/avatars/avatar3.png', '/avatars/avatar4.png',
  '/avatars/avatar5.png', '/avatars/avatar6.png', '/avatars/avatar7.png', '/avatars/avatar8.png'
];

/* Resolve an avatar index to a base64 data url (or fall back to the path). */
var forumGetAvatarSrc = function (index) {
  var key = FORUM_AVATAR_KEYS[(index || 0) % FORUM_AVATAR_KEYS.length];
  if (typeof FORUM_AVATAR_BASE64 === 'object' && FORUM_AVATAR_BASE64 && FORUM_AVATAR_BASE64[key]) {
    return FORUM_AVATAR_BASE64[key];
  }
  return key;
};

/* Cover gradients reused by both forums. */
var FORUM_GRADIENTS = [
  ['#ffcadb', '#7466ff'], ['#a8edea', '#fed6e3'], ['#fbc2eb', '#a18cd1'],
  ['#fad0c4', '#ffd1ff'], ['#a1c4fd', '#c2e9fb'], ['#f093fb', '#f5576c'],
  ['#4facfe', '#00f2fe'], ['#43e97b', '#38f9d7'], ['#fa709a', '#fee140'],
  ['#30cfd0', '#330867'], ['#a8edea', '#84fab0'], ['#ff9a9e', '#fecfef']
];

/* Solid gradient backgrounds for initial-based avatars (divs). */
var SF_AVATAR_GRADIENTS = [
  'linear-gradient(135deg,#1da1f2,#0d8bd9)',
  'linear-gradient(135deg,#f91880,#b81d6b)',
  'linear-gradient(135deg,#8b5cf6,#6d28d9)',
  'linear-gradient(135deg,#10b981,#059669)',
  'linear-gradient(135deg,#f59e0b,#d97706)',
  'linear-gradient(135deg,#ef4444,#b91c1c)',
  'linear-gradient(135deg,#06b6d4,#0891b2)',
  'linear-gradient(135deg,#ec4899,#be185d)'
];

var forumAvatarGradient = function (index) {
  return SF_AVATAR_GRADIENTS[(index || 0) % SF_AVATAR_GRADIENTS.length];
};

var forumInitial = function (name) {
  var n = String(name || '匿').trim();
  return n ? n.charAt(0) : '?';
};

var forumToast = function (msg) {
  if (typeof toast === 'function') toast(msg);
};

/* Build a handle like @xxx from a display name. */
var forumHandle = function (name) {
  return '@' + String(name || 'anon').replace(/[\\s@]+/g, '').substring(0, 12).toLowerCase();
};


/* ======================================================================
 *  PART 1 - SOCIAL FORUM  (Twitter / Weibo dark theme)
 * ==================================================================== */

/* ---- state ---- */
var sfActive = false;
var sfRole = null;
var sfCurrentView = 'home';          /* home | search | notifications | me */
var sfCurrentTab = 'following';      /* following | recommended | gossip */
var sfLoading = { following: false, recommended: false, gossip: false };
var sfPostsCache = { following: [], recommended: [], gossip: [] };
var sfCommentsCache = {};             /* postId -> [comment] */
var sfUserPosts = [];                 /* user-created posts (mixed into feeds) */
var sfCurrentPostId = null;
var sfNotifCache = null;

/* ---- fallback content ---- */
var SF_FALLBACK_NAMES = [
  '月光下的猫', '深夜食堂', '柠檬不萌', '星河滚烫', '草莓味晚风',
  '云朵邮局', '人间清醒', '气泡水加冰', '银河系迷路', '温柔半两',
  '海盐焦糖', '落日余晖', '雾里看花', '三餐四季', '月亮邮递员'
];

var SF_FALLBACK_TEMPLATES = {
  following: [
    '今天和{role}聊了很多，感觉我们的关系又近了一步呢~',
    '{role}说了一句很温柔的话，我记了好久。',
    '每次和{role}聊天都很开心，期待下一次对话！',
    '今天的心情因为{role}变得特别好☀️',
    '翻看了和{role}的聊天记录，嘴角忍不住上扬',
    '{role}真的太懂我了，每句话都说到心坎里'
  ],
  recommended: [
    '今天做了一道新菜，虽然卖相一般但味道意外地好！附上食谱分享给大家~',
    '推荐一本最近在看的书，真的太好哭了，建议大家备好纸巾📚',
    '周末去了一个超美的小众景点，人少景美，分享一波照片📸',
    '最近迷上了手冲咖啡，每天早上的仪式感太幸福了☕',
    '今天的天空也太好看了吧，随手拍都是壁纸级别的☁️',
    '终于把拖延了很久的事情做完了，爽！大家也要加油呀💪',
    '深夜emo时间：有些路只能一个人走，但没关系，我们都很勇敢',
    '分享一个超好用的学习方法，用了三个月效率翻倍！'
  ],
  gossip: [
    '听说隔壁部门的同事要辞职去开奶茶店了，好突然啊...',
    '今天在地铁上听到有人讨论那个热门话题，大家怎么看？',
    '朋友圈有人发了条意味深长的动态，是不是在暗示什么...',
    '最近那个综艺的瓜大家吃了吗？反转也太多了吧🍉',
    '听说那家网红店其实味道一般，全靠营销？',
    '有个人在图书馆占座被怼了，场面一度很尴尬...'
  ]
};

var SF_COMMENT_AUTHORS = [
  '碎碎念bot', '深夜食堂', '柠檬不萌', '星河滚烫', '草莓味晚风',
  '云朵邮局', '人间清醒', '气泡水加冰', '银河系迷路', '温柔半两'
];
var SF_COMMENT_TEMPLATES = [
  '说得太对了！', '哇这个好有意思', '我也是这么觉得的', '哈哈笑死我了',
  '楼主好会说话', '已收藏！', '这才是真实的生活啊', '看完心情变好了',
  '同感同感', '可以可以，学到了', '这也太真实了吧', '楼主继续更新啊'
];

var sfFallbackPosts = function (tab, roleName) {
  var pool = SF_FALLBACK_TEMPLATES[tab] || SF_FALLBACK_TEMPLATES.recommended;
  var count = 6 + Math.floor(Math.random() * 3);
  var posts = [];
  for (var i = 0; i < count; i++) {
    var nameIdx = (i * 3 + Math.floor(Math.random() * 5)) % SF_FALLBACK_NAMES.length;
    posts.push({
      id: tab + '-sf-fb-' + Date.now() + '-' + i,
      authorName: SF_FALLBACK_NAMES[nameIdx],
      content: pool[i % pool.length].replace(/\\{role\\}/g, roleName || 'TA'),
      time: ['刚刚', '3分钟前', '10分钟前', '半小时前', '1小时前', '2小时前', '今天'][i % 7],
      likes: Math.floor(Math.random() * 300) + 5,
      avatarIndex: nameIdx % 8,
      commentsList: []
    });
  }
  return posts;
};

var sfFallbackComments = function () {
  var n = 2 + Math.floor(Math.random() * 3);
  var arr = [];
  for (var i = 0; i < n; i++) {
    var idx = Math.floor(Math.random() * SF_COMMENT_AUTHORS.length);
    arr.push({
      id: 'sc-fb-' + Date.now() + '-' + i,
      authorName: SF_COMMENT_AUTHORS[idx],
      content: SF_COMMENT_TEMPLATES[Math.floor(Math.random() * SF_COMMENT_TEMPLATES.length)],
      time: ['刚刚', '2分钟前', '5分钟前', '15分钟前'][i % 4],
      avatarIndex: idx % 8
    });
  }
  return arr;
};

/* ---- open / close ---- */
var openSocialForum = function (role) {
  sfRole = role || (typeof activeRole === 'function' ? activeRole() : null);
  if (typeof closeDoujinForum === 'function') closeDoujinForum();
  sfActive = true;
  sfCurrentTab = 'following';
  sfCurrentView = 'home';
  sfPostsCache = { following: [], recommended: [], gossip: [] };
  sfLoading = { following: false, recommended: false, gossip: false };
  sfNotifCache = null;

  var overlay = document.getElementById('socialForumOverlay');
  if (overlay) overlay.classList.add('active');

  var navAvatar = document.getElementById('sfNavAvatar');
  if (navAvatar) navAvatar.textContent = forumInitial(sfRole ? sfRole.name : '我');

  sfRenderSideMenu();
  sfSwitchView('home');
  sfLoadTab('following');
  /* preload recommended in background */
  sfLoadTab('recommended');
};

var closeSocialForum = function () {
  sfActive = false;
  var overlay = document.getElementById('socialForumOverlay');
  if (overlay) overlay.classList.remove('active');
  sfClosePostDetail();
  sfClosePostModal();
  sfCloseSideMenu();
};

/* ---- view / tab switching ---- */
var sfSwitchView = function (view) {
  sfCurrentView = view;
  var viewMap = { home: 'sfHomeView', search: 'sfSearchView', notifications: 'sfNotifView', me: 'sfMeView' };
  document.querySelectorAll('#sfContent .sf-view').forEach(function (v) { v.classList.remove('active'); });
  var el = document.getElementById(viewMap[view]);
  if (el) el.classList.add('active');

  document.querySelectorAll('.sf-bottom-nav .sf-tab').forEach(function (t) {
    t.classList.toggle('active', t.dataset.sfView === view);
  });

  var fab = document.getElementById('sfFab');
  if (fab) fab.style.display = (view === 'home') ? 'grid' : 'none';

  if (view === 'home') sfRenderTimeline(sfCurrentTab);
  else if (view === 'search') sfRenderTrends();
  else if (view === 'notifications') sfRenderNotifications();
  else if (view === 'me') sfRenderProfile();
};

var sfSwitchTab = function (tab) {
  sfCurrentTab = tab;
  document.querySelectorAll('.sf-sub-tab').forEach(function (t) {
    t.classList.toggle('active', t.dataset.sfTab === tab);
  });
  if (sfPostsCache[tab].length === 0 && !sfLoading[tab]) {
    sfLoadTab(tab);
  } else {
    sfRenderTimeline(tab);
  }
};

/* ---- data loading ---- */
var sfLoadTab = async function (tab) {
  sfLoading[tab] = true;
  if (sfActive && sfCurrentView === 'home' && tab === sfCurrentTab) {
    var tl = document.getElementById('sfTimeline');
    if (tl && sfPostsCache[tab].length === 0) tl.innerHTML = '<div class="sf-loading">正在加载...</div>';
  }

  var role = sfRole || (typeof activeRole === 'function' ? activeRole() : null);
  var messages = [];
  if (role && typeof getMessages === 'function') {
    try {
      messages = getMessages(role.id).slice(-8).map(function (m) {
        return { role: m.role, content: m.content };
      });
    } catch (e) {}
  }

  var memories = [];
  try {
    if (typeof api !== 'undefined' && typeof api.listMemories === 'function') {
      var mem = await api.listMemories(role ? role.id : '');
      memories = (mem && mem.list) ? mem.list.slice(0, 6) : [];
    }
  } catch (e) {}

  try {
    var result = await request('/forum/generate', {
      method: 'POST',
      body: JSON.stringify({
        tab: tab,
        roleName: role ? role.name : '',
        rolePrompt: role ? role.prompt : '',
        recentMessages: messages,
        memories: memories,
        worldRole: null
      })
    });
    var posts = (result && result.posts) ? result.posts : [];
    if (posts.length === 0) posts = sfFallbackPosts(tab, role ? role.name : '');
    sfPostsCache[tab] = posts;
    posts.forEach(function (p) {
      if (!sfCommentsCache[p.id]) sfCommentsCache[p.id] = p.commentsList || [];
    });
  } catch (e) {
    sfPostsCache[tab] = sfFallbackPosts(tab, role ? role.name : '');
  }

  sfLoading[tab] = false;
  if (sfActive && sfCurrentView === 'home' && tab === sfCurrentTab) sfRenderTimeline(tab);
};

/* ---- rendering ---- */
var sfGetDisplayPosts = function (tab) {
  var user = sfUserPosts.filter(function (p) { return p.tab === tab; });
  return user.concat(sfPostsCache[tab] || []);
};

var sfFindPost = function (postId) {
  var p = sfUserPosts.find(function (x) { return x.id === postId; });
  if (p) return p;
  for (var tab in sfPostsCache) {
    p = sfPostsCache[tab].find(function (x) { return x.id === postId; });
    if (p) return p;
  }
  return null;
};

var sfRenderPost = function (post) {
  var avatarSrc = forumGetAvatarSrc(post.avatarIndex);
  var commentCount = (sfCommentsCache[post.id] || post.commentsList || []).length;
  var liked = post.liked ? ' liked' : '';
  return '<div class="sf-post" data-post-id="' + escapeHtml(post.id || '') + '">'
    + '<div class="sf-post-header">'
    + '<img class="sf-post-avatar" src="' + avatarSrc + '" alt="">'
    + '<div class="sf-post-info">'
    + '<div class="sf-post-name">' + escapeHtml(post.authorName || '匿名') + '</div>'
    + '<div class="sf-post-handle">' + escapeHtml(forumHandle(post.authorName))
    + ' <span class="sf-post-time">· ' + escapeHtml(post.time || '刚刚') + '</span></div>'
    + '</div></div>'
    + '<div class="sf-post-text">' + escapeHtml(post.content || '') + '</div>'
    + '<div class="sf-post-actions">'
    + '<span class="sf-post-action" data-action="comment">💬 ' + commentCount + '</span>'
    + '<span class="sf-post-action' + liked + '" data-action="like">♥ ' + (post.likes || 0) + '</span>'
    + '<span class="sf-post-action" data-action="share">↗ 分享</span>'
    + '</div></div>';
};

var sfRenderTimeline = function (tab) {
  var timeline = document.getElementById('sfTimeline');
  if (!timeline) return;
  var posts = sfGetDisplayPosts(tab);
  if (sfLoading[tab] && posts.length === 0) {
    timeline.innerHTML = '<div class="sf-loading">正在加载...</div>';
    return;
  }
  if (posts.length === 0) {
    timeline.innerHTML = '<div class="sf-empty">暂无内容，点击右上角刷新试试</div>';
    return;
  }
  timeline.innerHTML = posts.map(function (p) { return sfRenderPost(p); }).join('');
};

var sfToggleLike = function (postId, actionEl) {
  var post = sfFindPost(postId);
  if (!post) return;
  post.liked = !post.liked;
  post.likes = (post.likes || 0) + (post.liked ? 1 : -1);
  if (actionEl) {
    actionEl.classList.toggle('liked', post.liked);
    actionEl.textContent = '♥ ' + post.likes;
  }
};

/* ---- post detail + comments ---- */
var sfOpenPostDetail = function (postId) {
  var post = sfFindPost(postId);
  if (!post) return;
  sfCurrentPostId = postId;

  var overlay = document.getElementById('sfDetailOverlay');
  if (overlay) overlay.classList.add('active');

  var body = document.getElementById('sfDetailBody');
  if (body) {
    var avatarSrc = forumGetAvatarSrc(post.avatarIndex);
    var commentCount = (sfCommentsCache[postId] || post.commentsList || []).length;
    body.innerHTML =
      '<div class="sf-post" style="border:0;cursor:default">'
      + '<div class="sf-post-header">'
      + '<img class="sf-post-avatar" src="' + avatarSrc + '" alt="">'
      + '<div class="sf-post-info">'
      + '<div class="sf-post-name">' + escapeHtml(post.authorName || '匿名') + '</div>'
      + '<div class="sf-post-handle">' + escapeHtml(forumHandle(post.authorName))
      + ' <span class="sf-post-time">· ' + escapeHtml(post.time || '刚刚') + '</span></div>'
      + '</div></div>'
      + '<div class="sf-post-text">' + escapeHtml(post.content || '') + '</div>'
      + '<div class="sf-post-actions">'
      + '<span class="sf-post-action" data-action="comment">💬 ' + commentCount + '</span>'
      + '<span class="sf-post-action' + (post.liked ? ' liked' : '') + '" data-action="like">♥ ' + (post.likes || 0) + '</span>'
      + '<span class="sf-post-action" data-action="share">↗ 分享</span>'
      + '</div></div>'
      + '<div style="padding:14px 0 4px;color:#8899a6;font-size:13px;font-weight:700">评论</div>'
      + '<div id="sfDetailComments"></div>';
  }

  sfRenderComments(postId);
  if ((!sfCommentsCache[postId] || sfCommentsCache[postId].length === 0) && !post._commentsLoaded) {
    sfGenerateComments(postId, post);
  }
};

var sfClosePostDetail = function () {
  var d = document.getElementById('sfDetailOverlay');
  if (d) d.classList.remove('active');
  sfCurrentPostId = null;
};

var sfGenerateComments = async function (postId, post) {
  if (!post) return;
  post._commentsLoaded = true;
  var c = document.getElementById('sfDetailComments');
  if (c) c.innerHTML = '<div style="text-align:center;padding:20px;color:#8899a6;font-size:13px">正在生成评论...</div>';
  try {
    var result = await request('/forum/comments', {
      method: 'POST',
      body: JSON.stringify({ postContent: post.content, postAuthor: post.authorName, count: 4 })
    });
    var comments = (result && result.comments) ? result.comments : sfFallbackComments();
    sfCommentsCache[postId] = comments;
  } catch (e) {
    sfCommentsCache[postId] = sfFallbackComments();
  }
  if (sfCurrentPostId === postId) sfRenderComments(postId);
  sfUpdateCommentCount(postId, (sfCommentsCache[postId] || []).length);
};

var sfRenderComments = function (postId) {
  var c = document.getElementById('sfDetailComments');
  if (!c) return;
  var comments = sfCommentsCache[postId] || [];
  var html = '';
  if (comments.length === 0) {
    html = '<div style="text-align:center;padding:24px;color:#8899a6;font-size:13px">还没有评论，快来抢沙发~</div>';
  } else {
    html = comments.map(function (cm) {
      return '<div class="sf-comment">'
        + '<div class="sf-comment-avatar" style="background:' + forumAvatarGradient(cm.avatarIndex) + '">'
        + escapeHtml(forumInitial(cm.authorName)) + '</div>'
        + '<div class="sf-comment-body">'
        + '<div class="sf-comment-name">' + escapeHtml(cm.authorName || '匿名') + '</div>'
        + '<div class="sf-comment-text">' + escapeHtml(cm.content || '') + '</div>'
        + '<div class="sf-comment-time">' + escapeHtml(cm.time || '刚刚') + '</div>'
        + '</div></div>';
    }).join('');
  }
  c.innerHTML = html;
};

var sfUpdateCommentCount = function (postId, n) {
  var detailAction = document.querySelector('#sfDetailBody [data-action="comment"]');
  if (detailAction) detailAction.textContent = '💬 ' + n;
};

var sfSendComment = function () {
  var input = document.getElementById('sfCommentInput');
  if (!input || !input.value.trim() || !sfCurrentPostId) return;
  var text = input.value.trim();
  input.value = '';
  var comments = sfCommentsCache[sfCurrentPostId] || [];
  comments.push({
    id: 'sc-' + Date.now(),
    authorName: (sfRole ? sfRole.name : '我'),
    content: text,
    time: '刚刚',
    avatarIndex: 0
  });
  sfCommentsCache[sfCurrentPostId] = comments;
  var post = sfFindPost(sfCurrentPostId);
  if (post) post.commentsList = comments;
  sfRenderComments(sfCurrentPostId);
  sfUpdateCommentCount(sfCurrentPostId, comments.length);
  forumToast('评论已发送');
};

/* ---- post creation modal ---- */
var sfOpenPostModal = function () {
  var m = document.getElementById('sfPostModal');
  if (m) m.classList.add('active');
  var input = document.getElementById('sfPostInput');
  if (input) setTimeout(function () { input.focus(); }, 100);
};

var sfClosePostModal = function () {
  var m = document.getElementById('sfPostModal');
  if (m) m.classList.remove('active');
  var input = document.getElementById('sfPostInput');
  if (input) input.value = '';
};

var sfPublishPost = function () {
  var input = document.getElementById('sfPostInput');
  if (!input || !input.value.trim()) { forumToast('请输入内容'); return; }
  var text = input.value.trim();
  var role = sfRole || (typeof activeRole === 'function' ? activeRole() : null);
  var post = {
    id: 'sf-user-' + Date.now(),
    authorName: role ? role.name : '我',
    content: text,
    time: '刚刚',
    likes: 0,
    avatarIndex: 0,
    commentsList: [],
    tab: sfCurrentTab,
    _user: true
  };
  sfUserPosts.unshift(post);
  sfClosePostModal();
  if (sfCurrentView === 'home') sfRenderTimeline(sfCurrentTab);
  forumToast('发布成功');
};

/* ---- side menu ---- */
var sfOpenSideMenu = function () {
  var menu = document.getElementById('sfSideMenu');
  var ov = document.getElementById('sfSideOverlay');
  if (menu) menu.classList.add('open');
  if (ov) ov.classList.add('active');
};

var sfCloseSideMenu = function () {
  var menu = document.getElementById('sfSideMenu');
  var ov = document.getElementById('sfSideOverlay');
  if (menu) menu.classList.remove('open');
  if (ov) ov.classList.remove('active');
};

var sfRenderSideMenu = function () {
  var role = sfRole || (typeof activeRole === 'function' ? activeRole() : null);
  var name = role ? role.name : '体验用户';
  var header = document.getElementById('sfMenuHeader');
  if (header) {
    header.innerHTML = '<div style="display:flex;align-items:center;gap:12px">'
      + '<div style="width:52px;height:52px;border-radius:50%;background:rgba(255,255,255,.25);display:flex;align-items:center;justify-content:center;font-size:22px;font-weight:700;color:#fff">'
      + escapeHtml(forumInitial(name)) + '</div>'
      + '<div><div style="font-size:18px;font-weight:700;color:#fff">' + escapeHtml(name) + '</div>'
      + '<div style="font-size:12px;opacity:.85;color:#fff">' + escapeHtml(forumHandle(name)) + '</div></div></div>';
  }
  var list = document.getElementById('sfMenuList');
  if (list) {
    var items = [
      { key: 'profile', icon: '👤', label: '个人主页' },
      { key: 'bookmarks', icon: '🔖', label: '我的书签' },
      { key: 'drafts', icon: '📝', label: '草稿箱' },
      { key: 'settings', icon: '⚙️', label: '设置' },
      { key: 'about', icon: 'ℹ️', label: '关于论坛' },
      { key: 'close', icon: '✕', label: '退出论坛' }
    ];
    list.innerHTML = items.map(function (it) {
      return '<div class="sf-menu-item" data-menu="' + it.key + '"><span>' + it.icon
        + '</span><span>' + it.label + '</span></div>';
    }).join('');
  }
};

/* ---- search + trends ---- */
var sfBuildTrends = function () {
  var counts = {};
  var add = function (tag) { tag = String(tag).trim(); if (tag) counts[tag] = (counts[tag] || 0) + 1; };
  for (var tab in sfPostsCache) {
    sfPostsCache[tab].forEach(function (p) {
      var matches = String(p.content || '').match(/#([^#\\s]{1,12})#?/g);
      if (matches) matches.forEach(function (m) { add(m.replace(/#/g, '')); });
    });
  }
  var defaults = ['今日份小确幸', '深夜emo时间', '角色养成计划', '平行世界的我', '天气日记', '读书笔记', '一个人也要好好吃饭'];
  defaults.forEach(function (d) {
    counts[d] = (counts[d] || 0) + Math.floor(Math.random() * 6000) + 800;
  });
  var arr = Object.keys(counts).map(function (k) { return { tag: k, count: counts[k] }; });
  arr.sort(function (a, b) { return b.count - a.count; });
  return arr.slice(0, 8);
};

var sfRenderTrends = function () {
  var c = document.getElementById('sfTrends');
  if (!c) return;
  var trends = sfBuildTrends();
  var html = '<div class="sf-trend-card"><div class="sf-trend-title">热门话题</div>';
  trends.forEach(function (t, i) {
    html += '<div class="sf-trend-item" data-trend="' + escapeHtml(t.tag) + '">'
      + '<div class="sf-trend-rank">' + (i + 1) + '</div>'
      + '<div class="sf-trend-tag">#' + escapeHtml(t.tag) + '#</div>'
      + '<div class="sf-trend-count">' + t.count + ' 讨论</div>'
      + '</div>';
  });
  html += '</div>';
  c.innerHTML = html;
};

var sfRunSearch = function () {
  var input = document.getElementById('sfSearchInput');
  var c = document.getElementById('sfTrends');
  if (!input || !c) return;
  var kw = input.value.trim().toLowerCase();
  if (!kw) { sfRenderTrends(); return; }
  var results = [];
  var seen = {};
  var collect = function (p) {
    if (!p || seen[p.id]) return;
    var t = (p.authorName + ' ' + p.content).toLowerCase();
    if (t.indexOf(kw) !== -1) { seen[p.id] = 1; results.push(p); }
  };
  sfUserPosts.forEach(collect);
  for (var tab in sfPostsCache) sfPostsCache[tab].forEach(collect);
  if (results.length === 0) {
    c.innerHTML = '<div class="sf-empty">没有找到相关内容</div>';
    return;
  }
  c.innerHTML = '<div style="padding:10px 14px;color:#8899a6;font-size:13px">找到 ' + results.length + ' 条结果</div>'
    + results.map(function (p) { return sfRenderPost(p); }).join('');
};

/* ---- notifications ---- */
var sfBuildNotifications = function () {
  var list = [];
  sfUserPosts.forEach(function (p, i) {
    list.push({ text: '草莓味晚风 赞了你的帖子', detail: String(p.content || '').substring(0, 40), time: '刚刚', avatarIndex: (i + 1) % 8 });
    list.push({ text: '星河滚烫 评论了你的帖子', detail: '说得太对了！', time: '5分钟前', avatarIndex: (i + 2) % 8 });
  });
  list.push({ text: '云朵邮局 关注了你', detail: '', time: '1小时前', avatarIndex: 3 });
  list.push({ text: '海盐焦糖 关注了你', detail: '', time: '3小时前', avatarIndex: 5 });
  list.push({ text: '欢迎来到回响论坛，开始你的第一段分享吧', detail: '', time: '今天', avatarIndex: 0 });
  return list;
};

var sfRenderNotifications = function () {
  if (!sfNotifCache) sfNotifCache = sfBuildNotifications();
  var c = document.getElementById('sfNotifList');
  if (!c) return;
  if (sfNotifCache.length === 0) {
    c.innerHTML = '<div class="sf-empty">暂无通知</div>';
    return;
  }
  c.innerHTML = sfNotifCache.map(function (n) {
    return '<div class="sf-post">'
      + '<div class="sf-post-header">'
      + '<div class="sf-comment-avatar" style="width:42px;height:42px;font-size:15px;background:' + forumAvatarGradient(n.avatarIndex) + '">'
      + escapeHtml(forumInitial(n.text)) + '</div>'
      + '<div class="sf-post-info">'
      + '<div class="sf-post-name">' + escapeHtml(n.text) + '</div>'
      + '<div class="sf-post-handle">' + escapeHtml(n.time || '刚刚') + '</div>'
      + '</div></div>'
      + (n.detail ? '<div class="sf-post-text">' + escapeHtml(n.detail) + '</div>' : '')
      + '</div>';
  }).join('');
};

/* ---- profile (me) ---- */
var sfRenderProfile = function () {
  var role = sfRole || (typeof activeRole === 'function' ? activeRole() : null);
  var name = role ? role.name : '体验用户';
  var bio = role && role.description ? role.description : '在这里记录每一个心动的瞬间。';

  var header = document.querySelector('#sfMeView .sf-profile-header');
  if (header) {
    header.innerHTML = '<div style="display:flex;align-items:center;gap:14px">'
      + '<div style="width:64px;height:64px;border-radius:50%;background:' + forumAvatarGradient(0)
      + ';display:flex;align-items:center;justify-content:center;color:#fff;font-size:26px;font-weight:700">'
      + escapeHtml(forumInitial(name)) + '</div>'
      + '<div><div style="color:#e9e9f0;font-size:19px;font-weight:700">' + escapeHtml(name) + '</div>'
      + '<div style="color:#8899a6;font-size:13px;margin-top:4px">' + escapeHtml(bio) + '</div></div></div>';
  }

  var body = document.getElementById('sfProfileBody');
  if (!body) return;
  var totalLikes = sfUserPosts.reduce(function (s, p) { return s + (p.likes || 0); }, 0);
  var html = '<div class="sf-profile-stat">'
    + '<div class="sf-profile-stat-item"><div class="num">' + sfUserPosts.length + '</div><div class="label">帖子</div></div>'
    + '<div class="sf-profile-stat-item"><div class="num">' + totalLikes + '</div><div class="label">获赞</div></div>'
    + '<div class="sf-profile-stat-item"><div class="num">' + (128 + sfUserPosts.length * 7) + '</div><div class="label">关注</div></div>'
    + '<div class="sf-profile-stat-item"><div class="num">' + (56 + sfUserPosts.length * 13) + '</div><div class="label">粉丝</div></div>'
    + '</div>';
  if (sfUserPosts.length === 0) {
    html += '<div class="sf-empty">还没有发布过帖子\\n点击右下角 + 发布第一条吧</div>';
  } else {
    html += sfUserPosts.map(function (p) { return sfRenderPost(p); }).join('');
  }
  body.innerHTML = html;
};

/* ---- event binding (social) ---- */
var sfEventsBound = false;
var sfBindEvents = function () {
  if (sfEventsBound) return;
  /* sub-tabs */
  document.querySelectorAll('.sf-sub-tab').forEach(function (t) {
    t.addEventListener('click', function () { sfSwitchTab(this.dataset.sfTab); });
  });

  /* bottom nav */
  document.querySelectorAll('.sf-bottom-nav .sf-tab').forEach(function (t) {
    t.addEventListener('click', function () { sfSwitchView(this.dataset.sfView); });
  });

  /* nav avatar -> side menu */
  var navAvatar = document.getElementById('sfNavAvatar');
  if (navAvatar) navAvatar.addEventListener('click', sfOpenSideMenu);

  /* refresh / close */
  var refresh = document.getElementById('sfRefreshBtn');
  if (refresh) refresh.addEventListener('click', function () {
    sfPostsCache[sfCurrentTab] = [];
    sfLoadTab(sfCurrentTab);
  });
  var closeBtn = document.getElementById('sfCloseBtn');
  if (closeBtn) closeBtn.addEventListener('click', closeSocialForum);

  /* fab */
  var fab = document.getElementById('sfFab');
  if (fab) fab.addEventListener('click', sfOpenPostModal);

  /* timeline delegation */
  var timeline = document.getElementById('sfTimeline');
  if (timeline) timeline.addEventListener('click', function (e) {
    var action = e.target.closest('[data-action]');
    var post = e.target.closest('[data-post-id]');
    if (!post) return;
    var postId = post.dataset.postId;
    if (action) {
      var act = action.dataset.action;
      if (act === 'like') { sfToggleLike(postId, action); return; }
      if (act === 'share') { forumToast('链接已复制到剪贴板'); return; }
      if (act === 'comment') { sfOpenPostDetail(postId); return; }
    }
    sfOpenPostDetail(postId);
  });

  /* detail back + body actions */
  var detailBack = document.getElementById('sfDetailBack');
  if (detailBack) detailBack.addEventListener('click', sfClosePostDetail);
  var detailBody = document.getElementById('sfDetailBody');
  if (detailBody) detailBody.addEventListener('click', function (e) {
    var action = e.target.closest('[data-action]');
    if (!action || !sfCurrentPostId) return;
    if (action.dataset.action === 'like') {
      sfToggleLike(sfCurrentPostId, action);
    } else if (action.dataset.action === 'share') {
      forumToast('链接已复制到剪贴板');
    }
  });

  /* comments */
  var commentSend = document.getElementById('sfCommentSend');
  if (commentSend) commentSend.addEventListener('click', sfSendComment);
  var commentInput = document.getElementById('sfCommentInput');
  if (commentInput) commentInput.addEventListener('keydown', function (e) {
    if (e.key === 'Enter') sfSendComment();
  });

  /* post modal */
  var postCancel = document.getElementById('sfPostCancel');
  if (postCancel) postCancel.addEventListener('click', sfClosePostModal);
  var postPublish = document.getElementById('sfPostPublish');
  if (postPublish) postPublish.addEventListener('click', sfPublishPost);
  var postModal = document.getElementById('sfPostModal');
  if (postModal) postModal.addEventListener('click', function (e) {
    if (e.target === this) sfClosePostModal();
  });

  /* side menu */
  var sideOv = document.getElementById('sfSideOverlay');
  if (sideOv) sideOv.addEventListener('click', sfCloseSideMenu);
  var menuList = document.getElementById('sfMenuList');
  if (menuList) menuList.addEventListener('click', function (e) {
    var item = e.target.closest('[data-menu]');
    if (!item) return;
    var key = item.dataset.menu;
    sfCloseSideMenu();
    if (key === 'profile') sfSwitchView('me');
    else if (key === 'bookmarks') forumToast('书签功能开发中');
    else if (key === 'drafts') forumToast('草稿箱是空的');
    else if (key === 'settings') forumToast('设置功能开发中');
    else if (key === 'about') forumToast('回响论坛 v1.0 · 角色陪伴社区');
    else if (key === 'close') closeSocialForum();
  });

  /* search */
  var searchInput = document.getElementById('sfSearchInput');
  if (searchInput) searchInput.addEventListener('input', sfRunSearch);
  var trends = document.getElementById('sfTrends');
  if (trends) trends.addEventListener('click', function (e) {
    var item = e.target.closest('[data-trend]');
    if (!item) return;
    if (searchInput) { searchInput.value = item.dataset.trend; sfRunSearch(); }
  });

  sfEventsBound = true;
};


/* ======================================================================
 *  PART 2 - DOUJIN FORUM  (LOFTER light theme)
 * ==================================================================== */

var DF_TAGS = ['全部', '原创', '同人', '小说', '散文', '诗歌', '日常', '奇幻', '科幻', '悬疑', '言情'];

/* ---- state ---- */
var dfActive = false;
var dfRole = null;
var dfCurrentTag = '全部';
var dfCurrentPage = 'dfHomePage';
var dfCurrentRank = 'heat';
var dfLoading = false;
var dfWorksCache = {};               /* tag -> [work] */
var dfAllWorks = [];                  /* every generated work (for ranking) */
var dfUserWorks = [];                 /* user-published works */
var dfCollectedWorks = [];            /* bookshelf */
var dfCommentsCache = {};             /* workId -> [comment] */
var dfCurrentWork = null;
var dfCurrentWorkId = null;

/* ---- fallback content ---- */
var DF_FALLBACK_WORKS = [
  {
    id: 'df-fb-1', title: '栀子花开的夏天', authorName: '夏蝉不知秋',
    tags: ['原创', '小说', '言情'],
    excerpt: '那年夏天，栀子花开满整条巷子，我第一次知道心动是有气味的。',
    content: '那年夏天，栀子花开满整条巷子，我第一次知道心动是有气味的。\\n\\n她搬来隔壁的那天，拎着一箱旧书，裙角沾着雨水。我站在阳台上假装浇花，其实只是想多看她一眼。后来整整一个夏天，我都学会了在傍晚六点准时出现在巷口。\\n\\n"你家的栀子花真香。"她某天忽然对我说。\\n\\n我才知道，原来花香是真的，心动也是真的。',
    authorWords: '写给每一个在夏天悄悄心动过的人。愿你的勇敢，配得上那场花开。'
  },
  {
    id: 'df-fb-2', title: '星海彼岸的回信', authorName: '深空信使',
    tags: ['同人', '奇幻'],
    excerpt: '当光从星海彼岸抵达时，写信的人或许早已不在，但回信永远不会太迟。',
    content: '当光从星海彼岸抵达时，写信的人或许早已不在，但回信永远不会太迟。\\n\\n我在第七航标站值守了四十年，接收过无数封漂流在星际间的信。大多数都字迹模糊，只剩下零碎的思念。直到那天，我收到一封完整的信，收件人写着我的名字。\\n\\n信里只有一句话："谢谢你，曾经替我点亮过那盏灯。"\\n\\n我抬头望向星空，忽然想起，二十岁那年我确实为某个迷路的旅人，亮过一整夜的灯。',
    authorWords: '宇宙很大，但善意会沿着光的路径，最终回到原点。'
  },
  {
    id: 'df-fb-3', title: '煮一壶光阴', authorName: '半盏清茶',
    tags: ['散文', '日常'],
    excerpt: '日子是煮出来的，急不得。一壶水从凉到沸，正好够我想完一桩旧事。',
    content: '日子是煮出来的，急不得。\\n\\n一壶水从凉到沸，正好够我想完一桩旧事。茶叶在杯底舒展的样子，像极了那些被时间泡软的回忆——原本尖锐的棱角，渐渐变得温润。\\n\\n外婆说，好茶要慢慢等，好人要慢慢懂。我小时候不信，如今却在这氤氲的水汽里，把这句话品出了味道。\\n\\n窗外落雨，屋里茶香。这大概就是平凡日子里，最奢侈的安稳。',
    authorWords: '愿你我都能在快日子里，留一壶慢时光。'
  },
  {
    id: 'df-fb-4', title: '夜行列车', authorName: '匿名旅人',
    tags: ['诗歌', '原创'],
    excerpt: '我把名字留给站台，把影子留给车窗，把黎明留给下一个远方。',
    content: '我把名字留给站台\\n把影子留给车窗\\n把黎明留给下一个远方\\n\\n列车摇晃着夜色\\n像摇篮，也像流放\\n邻座的人睡着\\n梦里或许有故乡\\n\\n我不问终点在哪里\\n只记得出发时\\n风很轻，星光很亮\\n而我，终于学会一个人\\n勇敢地往前行',
    authorWords: '献给每一个深夜还在路上的人。'
  },
  {
    id: 'df-fb-5', title: '第七次重启', authorName: '代码诗人',
    tags: ['科幻', '悬疑'],
    excerpt: '系统提示：这是你第七次选择重启记忆。前六次，你都选择了忘记同一个人。',
    content: '系统提示：这是你第七次选择重启记忆。前六次，你都选择了忘记同一个人。\\n\\n我盯着悬浮屏上的红字，手指悬在确认键上方。记忆清除协议本该让我忘掉一切痛苦，可每一次重启后，我都会在同一个路口停下，望着一张陌生的脸发呆。\\n\\n"你认识我吗？"那个人总会这样问。\\n\\n我摇头，却莫名地想哭。\\n\\n第七次，我终于没有按下确认键。我把那段被反复删除的记忆，亲手抄进了纸质的日记本里——那是系统永远无法触达的地方。',
    authorWords: '有些记忆，是刻在灵魂里的，删不掉，也不该删。'
  },
  {
    id: 'df-fb-6', title: '阁楼上的客人', authorName: '旧时钟',
    tags: ['原创', '悬疑'],
    excerpt: '阁楼的门锁了三十年，可每到雨夜，楼下总能听见有人踱步。',
    content: '阁楼的门锁了三十年，可每到雨夜，楼下总能听见有人踱步。\\n\\n爷爷临终前嘱咐过，那扇门无论如何不能开。我守着这栋老宅长大，从小听着楼上的脚步声入睡，竟也习惯了。\\n\\n直到那个暴雨夜，锁自己掉了下来。\\n\\n我举着烛台上楼，推开门。阁楼里空无一人，只有一把摇椅，正对着窗户，缓缓地、缓缓地晃动。\\n\\n摇椅扶手上，放着一封写给我名字的信。落款是三十年前，失踪的奶奶。',
    authorWords: '有些告别，是用一生在等一个解释。'
  },
  {
    id: 'df-fb-7', title: '如果那年不下雨', authorName: '南风过境',
    tags: ['同人', '言情'],
    excerpt: '如果那年不下雨，我们大概不会共撑一把伞，也就不会有后来所有的故事。',
    content: '如果那年不下雨，我们大概不会共撑一把伞，也就不会有后来所有的故事。\\n\\n你把伞倾向我这边，自己的半边肩膀却湿透了。我没说破，只是悄悄把脚步放慢，想让那条回家的路长一点，再长一点。\\n\\n后来我们走散了很多年。再重逢时，又是一个雨天。你笑着说："这次，换我撑伞。"\\n\\n我看着你鬓角的白发，忽然明白，有些缘分，是老天用一场雨，悄悄替我们系上的结。',
    authorWords: '所有不期而遇，都是久别重逢。'
  },
  {
    id: 'df-fb-8', title: '龙裔的最后花园', authorName: '青苔与剑',
    tags: ['奇幻', '小说'],
    excerpt: '龙族消亡后的第三百年，最后一座花园里，开出了会唱歌的花。',
    content: '龙族消亡后的第三百年，最后一座花园里，开出了会唱歌的花。\\n\\n我是守园人，也是这片大陆上最后一个还记得龙语的人。花儿们用龙的声调哼唱，每一段旋律都是一段被遗忘的历史。\\n\\n有一天，一个少年闯进花园，问我："传说龙会重生，是真的吗？"\\n\\n我没有回答，只是折下一枝会唱歌的花递给他。花在他手中忽然安静下来，片刻后，他的瞳孔变成了竖瞳。\\n\\n"原来，"我轻声说，"你一直都在。"',
    authorWords: '消亡从来不是终点，只是另一种形式的等待。'
  },
  {
    id: 'df-fb-9', title: '外婆的旧搪瓷杯', authorName: '炊烟袅袅',
    tags: ['日常', '散文'],
    excerpt: '那只搪瓷杯掉了一块瓷，露出黑铁的内里，却盛过我整个童年。',
    content: '那只搪瓷杯掉了一块瓷，露出黑铁的内里，却盛过我整个童年。\\n\\n杯身上印着牡丹，颜色早已斑驳，像外婆手上洗不净的岁月痕迹。小时候每次去外婆家，她都用这只杯给我冲麦乳精，甜得发腻，我却喝得见底。\\n\\n外婆走后，杯子被我带回城里。我把它洗干净，却始终没舍得用它喝水。\\n\\n直到某天清晨，我鬼使神差地用它泡了一杯茶。茶汤映着窗外的光，我恍惚看见外婆坐在老屋的门槛上，笑着说："慢慢喝，不急。"',
    authorWords: '有些物件，是装着一个人的。'
  },
  {
    id: 'df-fb-10', title: '月球邮局营业中', authorName: '环形山管理员',
    tags: ['科幻', '小说'],
    excerpt: '欢迎光临月球邮局。这里寄信很慢，要绕地球三圈，但从不丢失。',
    content: '欢迎光临月球邮局。这里寄信很慢，要绕地球三圈，但从不丢失。\\n\\n我是这里的唯一邮递员，也是唯一住户。地球上来寄信的人不多，大多寄给已故的亲人，或是多年未见、不敢联系的旧友。\\n\\n昨天来了一个姑娘，寄了一封空信。"写什么呢，"她红着眼说，"他什么都知道。"\\n\\n我把空信封盖上月尘邮戳，投进投递口。信封缓缓飘向那颗蓝色的星球。\\n\\n有些话不必写出来，抵达本身就是答案。',
    authorWords: '在月球，连沉默都能被认真投递。'
  },
  {
    id: 'df-fb-11', title: '写给十年后的你', authorName: '时间旅人',
    tags: ['诗歌', '原创'],
    excerpt: '十年后的你是否还认得，这首诗里藏着的，是今天不敢说出口的话。',
    content: '十年后的你\\n是否还认得\\n这首诗里藏着的\\n是今天不敢说出口的话\\n\\n愿你依然相信\\n相信星辰，相信晚风\\n相信一个人也能\\n把日子过得闪闪发光\\n\\n如果有一天你累了\\n就翻开这页旧字\\n我会从十年前\\n递给你一个拥抱',
    authorWords: '致未来的自己：请替我，好好生活。'
  },
  {
    id: 'df-fb-12', title: '第十三封未读', authorName: '深夜编辑',
    tags: ['悬疑', '同人'],
    excerpt: '邮箱里躺着第十三封未读邮件，发件人是我自己，时间是明年。',
    content: '邮箱里躺着第十三封未读邮件，发件人是我自己，时间是明年。\\n\\n前十二封我都读过，每一封都准确预言了之后发生的事：一次升职，一场失恋，一个雨天捡到的橘猫。我渐渐不敢再点开。\\n\\n可第十三封的标题写着："别打开这封信。"\\n\\n我盯着屏幕整整一夜。清晨，我终于挪开鼠标，却没点开，而是把它拖进了回收站。\\n\\n第二天，邮箱里出现了第十四封。标题是："谢谢你，这次你终于选对了。"',
    authorWords: '有时候，不被剧透的人生，才值得过。'
  }
];

var DF_COMMENT_AUTHORS = ['纸鸢', '青柠', '夜读人', '拾光者', '旧书店', '橘子汽水', '听雨', '木兮'];
var DF_COMMENT_TEMPLATES = [
  '文笔太好了，看哭了', '已收藏，慢慢读', '求更新！', '这段描写绝了',
  '作者大大辛苦了', '读到这段想起很多事', '氛围感拉满', '已三连支持'
];

var dfFallbackComments = function () {
  var n = 2 + Math.floor(Math.random() * 3);
  var arr = [];
  for (var i = 0; i < n; i++) {
    var idx = Math.floor(Math.random() * DF_COMMENT_AUTHORS.length);
    arr.push({
      id: 'dc-fb-' + Date.now() + '-' + i,
      authorName: DF_COMMENT_AUTHORS[idx],
      content: DF_COMMENT_TEMPLATES[Math.floor(Math.random() * DF_COMMENT_TEMPLATES.length)],
      time: ['刚刚', '2分钟前', '5分钟前', '15分钟前', '半小时前'][i % 5],
      avatarIndex: idx % 8
    });
  }
  return arr;
};

var dfFallbackWorks = function (tag) {
  var list = DF_FALLBACK_WORKS.filter(function (w) {
    if (tag === '全部' || !tag) return true;
    return (w.tags || []).indexOf(tag) !== -1;
  });
  return list.map(function (w, idx) {
    var seed = (w.id || '').length + idx * 7;
    return {
      id: w.id,
      title: w.title,
      authorName: w.authorName,
      excerpt: w.excerpt,
      content: w.content,
      authorWords: w.authorWords,
      tags: (w.tags || []).slice(),
      likes: 50 + (seed * 13) % 900,
      collects: 20 + (seed * 7) % 500,
      comments: 3 + (seed * 5) % 40,
      avatarIndex: seed % 8,
      coverGradient: FORUM_GRADIENTS[seed % FORUM_GRADIENTS.length]
    };
  });
};

/* ---- helpers ---- */
var dfFindWork = function (workId) {
  var w = dfUserWorks.find(function (x) { return x.id === workId; });
  if (w) return w;
  w = dfAllWorks.find(function (x) { return x.id === workId; });
  if (w) return w;
  w = dfCollectedWorks.find(function (x) { return x.id === workId; });
  return w || null;
};

var dfMergeAllWorks = function (works) {
  var seen = {};
  dfAllWorks.forEach(function (w) { seen[w.id] = true; });
  works.forEach(function (w) {
    if (w && w.id && !seen[w.id]) { dfAllWorks.push(w); seen[w.id] = true; }
  });
};

var dfGetDisplayWorks = function (tag) {
  var userMatch = dfUserWorks.filter(function (w) {
    if (tag === '全部' || !tag) return true;
    return (w.tags || []).indexOf(tag) !== -1;
  });
  return userMatch.concat(dfWorksCache[tag] || []);
};

/* ---- open / close ---- */
var openDoujinForum = function (role) {
  dfRole = role || (typeof activeRole === 'function' ? activeRole() : null);
  if (typeof closeSocialForum === 'function') closeSocialForum();
  dfActive = true;
  dfCurrentTag = '全部';
  dfCurrentRank = 'heat';
  dfCurrentPage = 'dfHomePage';
  dfWorksCache = {};

  dfRenderTagNav();
  var overlay = document.getElementById('doujinForumOverlay');
  if (overlay) overlay.classList.add('active');

  /* reset active states for pages & tabs */
  document.querySelectorAll('#dfPages .df-page').forEach(function (p) {
    p.classList.toggle('active', p.id === 'dfHomePage');
  });
  document.querySelectorAll('.df-bottom-nav .df-tab').forEach(function (t) {
    t.classList.toggle('active', t.dataset.dfPage === 'dfHomePage');
  });

  dfLoadWorks('全部');
};

var closeDoujinForum = function () {
  dfActive = false;
  var overlay = document.getElementById('doujinForumOverlay');
  if (overlay) overlay.classList.remove('active');
  var detail = document.getElementById('dfDetailOverlay');
  if (detail) detail.classList.remove('active');
  dfCurrentWork = null;
  dfCurrentWorkId = null;
};

/* ---- tag nav & page switching ---- */
var dfRenderTagNav = function () {
  var c = document.getElementById('dfTagNav');
  if (!c) return;
  c.innerHTML = DF_TAGS.map(function (t) {
    return '<div class="df-tag-item' + (t === dfCurrentTag ? ' active' : '') + '" data-tag="'
      + escapeHtml(t) + '">' + escapeHtml(t) + '</div>';
  }).join('');
};

var dfSwitchTag = function (tag) {
  dfCurrentTag = tag;
  document.querySelectorAll('#dfTagNav .df-tag-item').forEach(function (t) {
    t.classList.toggle('active', t.dataset.tag === tag);
  });
  dfCurrentPage = 'dfHomePage';
  document.querySelectorAll('#dfPages .df-page').forEach(function (p) {
    p.classList.toggle('active', p.id === 'dfHomePage');
  });
  document.querySelectorAll('.df-bottom-nav .df-tab').forEach(function (t) {
    t.classList.toggle('active', t.dataset.dfPage === 'dfHomePage');
  });
  if (dfWorksCache[tag] && dfWorksCache[tag].length) {
    dfRenderWorks(dfGetDisplayWorks(tag), document.getElementById('dfHomeContent'));
  } else {
    dfLoadWorks(tag);
  }
};

var dfSwitchPage = function (pageId) {
  dfCurrentPage = pageId;
  document.querySelectorAll('#dfPages .df-page').forEach(function (p) {
    p.classList.toggle('active', p.id === pageId);
  });
  document.querySelectorAll('.df-bottom-nav .df-tab').forEach(function (t) {
    t.classList.toggle('active', t.dataset.dfPage === pageId);
  });
  if (pageId === 'dfHomePage') {
    if (dfWorksCache[dfCurrentTag] && dfWorksCache[dfCurrentTag].length) {
      dfRenderWorks(dfGetDisplayWorks(dfCurrentTag), document.getElementById('dfHomeContent'));
    } else {
      dfLoadWorks(dfCurrentTag);
    }
  } else if (pageId === 'dfBookshelfPage') {
    dfRenderBookshelf();
  } else if (pageId === 'dfRankingPage') {
    dfRenderRanking(dfCurrentRank);
  } else if (pageId === 'dfMyPage') {
    dfRenderProfile();
  }
};

/* ---- data loading ---- */
var dfLoadWorks = async function (tag) {
  dfLoading = true;
  var content = document.getElementById('dfHomeContent');
  if (content && (!dfWorksCache[tag] || dfWorksCache[tag].length === 0)) {
    content.innerHTML = '<div class="df-loading">正在加载作品...</div>';
  }

  var role = dfRole || (typeof activeRole === 'function' ? activeRole() : null);
  var apiTag = (tag === '全部') ? '' : tag;

  try {
    var result = await request('/forum/doujin/generate', {
      method: 'POST',
      body: JSON.stringify({
        tag: apiTag,
        roleName: role ? role.name : '',
        rolePrompt: role ? role.prompt : ''
      })
    });
    var works = (result && result.works) ? result.works : [];
    if (works.length === 0) works = dfFallbackWorks(tag);
    /* ensure coverGradient exists */
    works.forEach(function (w, i) {
      if (!w.coverGradient || !w.coverGradient.length) {
        w.coverGradient = FORUM_GRADIENTS[(i + (tag || '').length) % FORUM_GRADIENTS.length];
      }
      if (typeof w.avatarIndex !== 'number') w.avatarIndex = i % 8;
      if (typeof w.likes !== 'number') w.likes = 50 + Math.floor(Math.random() * 900);
      if (typeof w.collects !== 'number') w.collects = 20 + Math.floor(Math.random() * 400);
      if (typeof w.comments !== 'number') w.comments = 2 + Math.floor(Math.random() * 30);
    });
    dfWorksCache[tag] = works;
    dfMergeAllWorks(works);
  } catch (e) {
    dfWorksCache[tag] = dfFallbackWorks(tag);
    dfMergeAllWorks(dfWorksCache[tag]);
  }

  dfLoading = false;
  if (dfActive && dfCurrentPage === 'dfHomePage' && dfCurrentTag === tag) {
    dfRenderWorks(dfGetDisplayWorks(tag), document.getElementById('dfHomeContent'));
  }
};

/* ---- rendering ---- */
var dfGradientCss = function (grad) {
  if (!grad || grad.length < 2) return 'linear-gradient(135deg,#7d9d8f,#95b3a5)';
  return 'linear-gradient(135deg,' + grad[0] + ',' + grad[1] + ')';
};

var dfAvatarGradient = function (index) {
  return SF_AVATAR_GRADIENTS[(index || 0) % SF_AVATAR_GRADIENTS.length];
};

var dfRenderWorkCard = function (work) {
  var grad = dfGradientCss(work.coverGradient);
  var tagsHtml = '';
  if (work.tags && work.tags.length) {
    tagsHtml = '<div class="df-work-tags">' + work.tags.map(function (t) {
      return '<span class="df-work-tag">' + escapeHtml(t) + '</span>';
    }).join('') + '</div>';
  }
  var avatarStyle = 'background:' + dfAvatarGradient(work.avatarIndex);
  var avatarText = escapeHtml(forumInitial(work.authorName));
  var collected = dfCollectedWorks.some(function (w) { return w.id === work.id; });
  var collectIcon = collected ? '★' : '☆';

  return '<div class="df-work-card" data-work-id="' + escapeHtml(work.id || '') + '">'
    + '<div class="df-work-cover">'
    + '<div class="df-work-cover-gradient" style="background:' + grad + '"></div>'
    + '<div class="df-work-cover-overlay"><h4>' + escapeHtml(work.title || '无题') + '</h4></div>'
    + '</div>'
    + '<div class="df-work-info">'
    + '<div class="df-work-author">'
    + '<div class="df-work-author-avatar" style="' + avatarStyle + '">' + avatarText + '</div>'
    + '<div class="df-work-author-name">' + escapeHtml(work.authorName || '匿名') + '</div>'
    + '</div>'
    + '<div class="df-work-title">' + escapeHtml(work.title || '无题') + '</div>'
    + '<div class="df-work-excerpt">' + escapeHtml(work.excerpt || '') + '</div>'
    + tagsHtml
    + '<div class="df-work-meta">'
    + '<span style="color:' + (work.liked ? '#e74c3c' : '') + '">♥ ' + (work.likes || 0) + '</span>'
    + '<span style="color:' + (collected ? '#f39c12' : '') + '">' + collectIcon + ' ' + (work.collects || 0) + '</span>'
    + '<span>💬 ' + (work.comments || 0) + '</span>'
    + '</div>'
    + '</div></div>';
};

var dfRenderWorks = function (works, container) {
  if (!container) return;
  if (dfLoading && works.length === 0) {
    container.innerHTML = '<div class="df-loading">正在加载作品...</div>';
    return;
  }
  if (works.length === 0) {
    container.innerHTML = '<div class="df-loading">暂无作品，下拉刷新试试</div>';
    return;
  }
  container.innerHTML = works.map(function (w) { return dfRenderWorkCard(w); }).join('');
};

var dfToggleLike = function (workId, actionEl) {
  var work = dfFindWork(workId);
  if (!work) return;
  work.liked = !work.liked;
  work.likes = (work.likes || 0) + (work.liked ? 1 : -1);
  if (actionEl) {
    actionEl.textContent = '♥ ' + (work.likes || 0);
    actionEl.style.color = work.liked ? '#e74c3c' : '';
  }
};

var dfToggleCollect = function (workId, actionEl) {
  var work = dfFindWork(workId);
  if (!work) return;
  var idx = dfCollectedWorks.findIndex(function (w) { return w.id === workId; });
  if (idx !== -1) {
    dfCollectedWorks.splice(idx, 1);
    work.collected = false;
    forumToast('已取消收藏');
  } else {
    dfCollectedWorks.unshift({
      id: work.id, title: work.title, authorName: work.authorName,
      excerpt: work.excerpt, tags: (work.tags || []).slice(),
      avatarIndex: work.avatarIndex, coverGradient: work.coverGradient,
      likes: work.likes, collects: work.collects, comments: work.comments,
      collectedAt: Date.now()
    });
    work.collected = true;
    forumToast('已加入书架');
  }
  if (actionEl) {
    actionEl.textContent = (work.collected ? '★ ' : '☆ ') + (work.collects || 0);
  }
};

/* ---- work detail ---- */
var dfOpenWorkDetail = function (workId) {
  var work = dfFindWork(workId);
  if (!work) return;
  dfCurrentWork = work;
  dfCurrentWorkId = workId;

  var overlay = document.getElementById('dfDetailOverlay');
  if (overlay) overlay.classList.add('active');

  var body = document.getElementById('dfDetailBody');
  if (body) {
    var grad = dfGradientCss(work.coverGradient);
    var avatarStyle = 'background:' + dfAvatarGradient(work.avatarIndex);
    var avatarText = escapeHtml(forumInitial(work.authorName));
    var tagsHtml = '';
    if (work.tags && work.tags.length) {
      tagsHtml = '<div class="df-detail-tags">' + work.tags.map(function (t) {
        return '<span class="df-work-tag">' + escapeHtml(t) + '</span>';
      }).join('') + '</div>';
    }
    var collected = dfCollectedWorks.some(function (w) { return w.id === workId; });
    var collectIcon = collected ? '★ ' : '☆ ';

    body.innerHTML =
      '<div style="height:160px;border-radius:12px;overflow:hidden;margin-bottom:16px">'
      + '<div style="width:100%;height:100%;background:' + grad + '"></div></div>'
      + '<div class="df-detail-title">' + escapeHtml(work.title || '无题') + '</div>'
      + '<div class="df-detail-author">'
      + '<div class="df-detail-author-avatar" style="' + avatarStyle + '">' + avatarText + '</div>'
      + '<div class="df-detail-author-info">'
      + '<div class="df-detail-author-name">' + escapeHtml(work.authorName || '匿名') + '</div>'
      + '<div class="df-detail-author-time">' + escapeHtml(work.time || '原创作品') + '</div>'
      + '</div></div>'
      + '<div class="df-detail-content">' + escapeHtml(work.content || work.excerpt || '') + '</div>'
      + tagsHtml
      + (work.authorWords ? '<div class="df-detail-author-words"><b>作者有话说：</b><br>'
        + escapeHtml(work.authorWords) + '</div>' : '')
      + '<div style="display:flex;gap:20px;margin-top:16px;padding:12px 0;border-top:1px solid rgba(0,0,0,.06)">'
      + '<span class="df-detail-action" data-action="like" style="cursor:pointer;color:' + (work.liked ? '#e74c3c' : '#666') + ';font-size:14px;font-weight:600">♥ ' + (work.likes || 0) + '</span>'
      + '<span class="df-detail-action" data-action="collect" style="cursor:pointer;color:' + (collected ? '#f39c12' : '#666') + ';font-size:14px;font-weight:600">' + collectIcon + (work.collects || 0) + '</span>'
      + '<span class="df-detail-action" data-action="share" style="cursor:pointer;color:#666;font-size:14px;font-weight:600">↗ 分享</span>'
      + '</div>';
  }

  dfRenderComments(workId);
  if ((!dfCommentsCache[workId] || dfCommentsCache[workId].length === 0) && !work._commentsLoaded) {
    dfGenerateComments(workId, work);
  }
};

var dfCloseWorkDetail = function () {
  var d = document.getElementById('dfDetailOverlay');
  if (d) d.classList.remove('active');
  dfCurrentWork = null;
  dfCurrentWorkId = null;
};

/* ---- comments ---- */
var dfGenerateComments = async function (workId, work) {
  if (!work) return;
  work._commentsLoaded = true;
  var c = document.getElementById('dfComments');
  if (c) c.innerHTML = '<div class="df-loading" style="padding:20px">正在生成评论...</div>';
  try {
    var result = await request('/forum/doujin/comments', {
      method: 'POST',
      body: JSON.stringify({ workTitle: work.title, workAuthor: work.authorName, count: 4 })
    });
    var comments = (result && result.comments) ? result.comments : dfFallbackComments();
    dfCommentsCache[workId] = comments;
  } catch (e) {
    dfCommentsCache[workId] = dfFallbackComments();
  }
  if (dfCurrentWorkId === workId) dfRenderComments(workId);
};

var dfRenderComments = function (workId) {
  var c = document.getElementById('dfComments');
  if (!c) return;
  var comments = dfCommentsCache[workId] || [];
  if (comments.length === 0) {
    c.innerHTML = '<div class="df-loading" style="padding:24px">还没有评论，快来抢沙发~</div>';
    return;
  }
  c.innerHTML = comments.map(function (cm) {
    var avatarStyle = 'background:' + dfAvatarGradient(cm.avatarIndex);
    return '<div class="df-comment">'
      + '<div class="df-comment-avatar" style="' + avatarStyle + '">' + escapeHtml(forumInitial(cm.authorName)) + '</div>'
      + '<div class="df-comment-body">'
      + '<div class="df-comment-name">' + escapeHtml(cm.authorName || '匿名') + '</div>'
      + '<div class="df-comment-text">' + escapeHtml(cm.content || '') + '</div>'
      + '</div></div>';
  }).join('');
};

var dfSendComment = function () {
  var input = document.getElementById('dfCommentInput');
  if (!input || !input.value.trim() || !dfCurrentWorkId) return;
  var text = input.value.trim();
  input.value = '';
  var comments = dfCommentsCache[dfCurrentWorkId] || [];
  comments.push({
    id: 'dc-' + Date.now(),
    authorName: (dfRole ? dfRole.name : '我'),
    content: text,
    time: '刚刚',
    avatarIndex: 0
  });
  dfCommentsCache[dfCurrentWorkId] = comments;
  if (dfCurrentWork) dfCurrentWork.comments = (dfCurrentWork.comments || 0) + 1;
  dfRenderComments(dfCurrentWorkId);
  forumToast('评论已发送');
};

/* ---- publish ---- */
var dfPublishWork = function () {
  var titleEl = document.getElementById('dfPublishTitle');
  var contentEl = document.getElementById('dfPublishContent');
  var authorWordsEl = document.getElementById('dfPublishAuthorWords');
  var tagsEl = document.getElementById('dfPublishTags');
  if (!titleEl || !titleEl.value.trim()) { forumToast('请输入标题'); return; }
  if (!contentEl || !contentEl.value.trim()) { forumToast('请输入作品内容'); return; }

  var title = titleEl.value.trim();
  var content = contentEl.value.trim();
  var authorWords = authorWordsEl ? authorWordsEl.value.trim() : '';
  var rawTags = tagsEl ? tagsEl.value.trim().split(/[\\s,，、]+/).filter(Boolean) : [];
  /* filter tags to known set, keep unknown too but ensure at least one */
  var tags = rawTags.length ? rawTags : ['原创'];

  var role = dfRole || (typeof activeRole === 'function' ? activeRole() : null);
  var idx = dfUserWorks.length;
  var work = {
    id: 'df-user-' + Date.now(),
    title: title,
    authorName: role ? role.name : '我',
    excerpt: content.substring(0, 80) + (content.length > 80 ? '...' : ''),
    content: content,
    authorWords: authorWords,
    tags: tags,
    likes: 0,
    collects: 0,
    comments: 0,
    avatarIndex: 0,
    coverGradient: FORUM_GRADIENTS[idx % FORUM_GRADIENTS.length],
    time: '刚刚',
    _user: true
  };
  dfUserWorks.unshift(work);
  dfMergeAllWorks([work]);

  /* clear form */
  if (titleEl) titleEl.value = '';
  if (contentEl) contentEl.value = '';
  if (authorWordsEl) authorWordsEl.value = '';
  if (tagsEl) tagsEl.value = '';

  forumToast('作品发布成功！');
  /* go to profile to see published works */
  dfSwitchPage('dfMyPage');
};

/* ---- bookshelf ---- */
var dfRenderBookshelf = function () {
  var c = document.getElementById('dfBookshelfContent');
  if (!c) return;
  if (dfCollectedWorks.length === 0) {
    c.innerHTML = '<div class="df-loading" style="padding:40px 20px">书架还是空的\\n去首页收藏喜欢的作品吧</div>';
    return;
  }
  c.innerHTML = dfCollectedWorks.map(function (w) { return dfRenderWorkCard(w); }).join('');
};

/* ---- ranking ---- */
var dfGetRankingList = function (rank) {
  var pool = dfAllWorks.slice();
  if (rank === 'heat') {
    pool.sort(function (a, b) { return (b.likes || 0) - (a.likes || 0); });
  } else if (rank === 'collect') {
    pool.sort(function (a, b) { return (b.collects || 0) - (a.collects || 0); });
  } else if (rank === 'new') {
    /* user works first (newest), then fallback works by id */
    pool.sort(function (a, b) {
      if (a._user && !b._user) return -1;
      if (!a._user && b._user) return 1;
      return String(b.id || '').localeCompare(String(a.id || ''));
    });
  }
  return pool.slice(0, 20);
};

var dfRenderRanking = function (rank) {
  dfCurrentRank = rank;
  document.querySelectorAll('.df-ranking-tab').forEach(function (t) {
    t.classList.toggle('active', t.dataset.rank === rank);
  });
  var c = document.getElementById('dfRankingContent');
  if (!c) return;
  var list = dfGetRankingList(rank);
  if (list.length === 0) {
    c.innerHTML = '<div class="df-loading" style="padding:40px 20px">暂无排行数据</div>';
    return;
  }
  c.innerHTML = list.map(function (w, i) {
    var grad = dfGradientCss(w.coverGradient);
    var avatarStyle = 'background:' + dfAvatarGradient(w.avatarIndex);
    return '<div class="df-rank-item" data-work-id="' + escapeHtml(w.id || '') + '">'
      + '<div class="df-rank-num">' + (i + 1) + '</div>'
      + '<div style="width:48px;height:48px;border-radius:8px;overflow:hidden;flex-shrink:0">'
      + '<div style="width:100%;height:100%;background:' + grad + '"></div></div>'
      + '<div style="flex:1;min-width:0">'
      + '<div style="color:#333;font-size:14px;font-weight:700;white-space:nowrap;overflow:hidden;text-overflow:ellipsis">' + escapeHtml(w.title || '无题') + '</div>'
      + '<div style="display:flex;align-items:center;gap:6px;margin-top:4px">'
      + '<div class="df-work-author-avatar" style="' + avatarStyle + ';width:18px;height:18px;font-size:9px">' + escapeHtml(forumInitial(w.authorName)) + '</div>'
      + '<span style="color:#999;font-size:12px">' + escapeHtml(w.authorName || '匿名') + '</span>'
      + '</div>'
      + '<div style="color:#aaa;font-size:11px;margin-top:3px">'
      + (rank === 'collect' ? ('★ ' + (w.collects || 0)) : ('♥ ' + (w.likes || 0)))
      + ' · 💬 ' + (w.comments || 0) + '</div>'
      + '</div></div>';
  }).join('');
};

/* ---- profile ---- */
var dfRenderProfile = function () {
  var c = document.getElementById('dfProfile');
  if (!c) return;
  var role = dfRole || (typeof activeRole === 'function' ? activeRole() : null);
  var name = role ? role.name : '体验用户';
  var bio = role && role.description ? role.description : '用文字记录每一个灵感瞬间。';

  var totalLikes = dfUserWorks.reduce(function (s, w) { return s + (w.likes || 0); }, 0);
  var totalCollects = dfUserWorks.reduce(function (s, w) { return s + (w.collects || 0); }, 0);

  var html = '<div class="df-profile-header">'
    + '<div class="df-profile-avatar">' + escapeHtml(forumInitial(name)) + '</div>'
    + '<div class="df-profile-info"><h3>' + escapeHtml(name) + '</h3><p>' + escapeHtml(bio) + '</p></div>'
    + '</div>'
    + '<div class="df-profile-stats">'
    + '<div class="df-profile-stat"><div class="num">' + dfUserWorks.length + '</div><div class="label">作品</div></div>'
    + '<div class="df-profile-stat"><div class="num">' + dfCollectedWorks.length + '</div><div class="label">收藏</div></div>'
    + '<div class="df-profile-stat"><div class="num">' + totalLikes + '</div><div class="label">获赞</div></div>'
    + '<div class="df-profile-stat"><div class="num">' + totalCollects + '</div><div class="label">被收藏</div></div>'
    + '</div>';

  if (dfUserWorks.length === 0) {
    html += '<div class="df-loading" style="padding:40px 20px">还没有发布过作品\\n点击底部"发布"开始创作</div>';
  } else {
    html += dfUserWorks.map(function (w) { return dfRenderWorkCard(w); }).join('');
  }
  c.innerHTML = html;
};

/* ---- search (simple inline filter) ---- */
var dfSearchVisible = false;
var dfToggleSearch = function () {
  /* simple: jump to home and show a prompt-like search input overlay */
  if (dfSearchVisible) {
    dfSearchVisible = false;
    dfRenderWorks(dfGetDisplayWorks(dfCurrentTag), document.getElementById('dfHomeContent'));
    return;
  }
  dfSearchVisible = true;
  var content = document.getElementById('dfHomeContent');
  if (!content) return;
  var inputHtml = '<div style="padding:0 0 10px"><input id="dfSearchBox" class="df-input" placeholder="搜索作品标题或作者..." style="margin-bottom:0" /></div><div id="dfSearchResults"></div>';
  content.innerHTML = inputHtml;
  var box = document.getElementById('dfSearchBox');
  if (box) {
    box.focus();
    box.addEventListener('input', function () {
      var kw = this.value.trim().toLowerCase();
      var c = document.getElementById('dfSearchResults');
      if (!c) return;
      if (!kw) { c.innerHTML = '<div class="df-loading" style="padding:20px">输入关键词搜索</div>'; return; }
      var results = dfAllWorks.filter(function (w) {
        return (w.title || '').toLowerCase().indexOf(kw) !== -1 ||
               (w.authorName || '').toLowerCase().indexOf(kw) !== -1 ||
               (w.excerpt || '').toLowerCase().indexOf(kw) !== -1;
      });
      if (results.length === 0) {
        c.innerHTML = '<div class="df-loading" style="padding:20px">没有找到相关作品</div>';
      } else {
        c.innerHTML = results.map(function (w) { return dfRenderWorkCard(w); }).join('');
      }
    });
  }
};

/* ---- event binding (doujin) ---- */
var dfEventsBound = false;
var dfBindEvents = function () {
  if (dfEventsBound) return;

  /* tag nav */
  var tagNav = document.getElementById('dfTagNav');
  if (tagNav) tagNav.addEventListener('click', function (e) {
    var item = e.target.closest('[data-tag]');
    if (item) dfSwitchTag(item.dataset.tag);
  });

  /* bottom nav */
  document.querySelectorAll('.df-bottom-nav .df-tab').forEach(function (t) {
    t.addEventListener('click', function () { dfSwitchPage(this.dataset.dfPage); });
  });

  /* header buttons */
  var searchBtn = document.getElementById('dfSearchBtn');
  if (searchBtn) searchBtn.addEventListener('click', dfToggleSearch);
  var refreshBtn = document.getElementById('dfRefreshBtn');
  if (refreshBtn) refreshBtn.addEventListener('click', function () {
    dfWorksCache = {};
    dfAllWorks = [];
    /* re-add user works to all pool */
    dfMergeAllWorks(dfUserWorks);
    dfLoadWorks(dfCurrentTag);
    forumToast('已刷新');
  });
  var closeBtn = document.getElementById('dfCloseBtn');
  if (closeBtn) closeBtn.addEventListener('click', closeDoujinForum);

  /* home content delegation -> open work detail */
  var homeContent = document.getElementById('dfHomeContent');
  if (homeContent) homeContent.addEventListener('click', function (e) {
    var card = e.target.closest('[data-work-id]');
    if (card) dfOpenWorkDetail(card.dataset.workId);
  });

  /* bookshelf delegation */
  var bookshelfContent = document.getElementById('dfBookshelfContent');
  if (bookshelfContent) bookshelfContent.addEventListener('click', function (e) {
    var card = e.target.closest('[data-work-id]');
    if (card) dfOpenWorkDetail(card.dataset.workId);
  });

  /* profile delegation */
  var profileEl = document.getElementById('dfProfile');
  if (profileEl) profileEl.addEventListener('click', function (e) {
    var card = e.target.closest('[data-work-id]');
    if (card) dfOpenWorkDetail(card.dataset.workId);
  });

  /* ranking tabs */
  document.querySelectorAll('.df-ranking-tab').forEach(function (t) {
    t.addEventListener('click', function () { dfRenderRanking(this.dataset.rank); });
  });

  /* ranking content delegation */
  var rankContent = document.getElementById('dfRankingContent');
  if (rankContent) rankContent.addEventListener('click', function (e) {
    var item = e.target.closest('[data-work-id]');
    if (item) dfOpenWorkDetail(item.dataset.workId);
  });

  /* detail back */
  var detailBack = document.getElementById('dfDetailBack');
  if (detailBack) detailBack.addEventListener('click', dfCloseWorkDetail);

  /* detail body actions (like / collect / share) */
  var detailBody = document.getElementById('dfDetailBody');
  if (detailBody) detailBody.addEventListener('click', function (e) {
    var action = e.target.closest('[data-action]');
    if (!action || !dfCurrentWorkId) return;
    var act = action.dataset.action;
    if (act === 'like') {
      dfToggleLike(dfCurrentWorkId, action);
    } else if (act === 'collect') {
      dfToggleCollect(dfCurrentWorkId, action);
      /* refresh bookshelf if visible */
      if (dfCurrentPage === 'dfBookshelfPage') dfRenderBookshelf();
    } else if (act === 'share') {
      forumToast('链接已复制到剪贴板');
    }
  });

  /* comments */
  var commentSend = document.getElementById('dfCommentSend');
  if (commentSend) commentSend.addEventListener('click', dfSendComment);
  var commentInput = document.getElementById('dfCommentInput');
  if (commentInput) commentInput.addEventListener('keydown', function (e) {
    if (e.key === 'Enter') dfSendComment();
  });

  /* publish */
  var publishBtn = document.getElementById('dfPublishSubmit');
  if (publishBtn) publishBtn.addEventListener('click', dfPublishWork);

  dfEventsBound = true;
};


/* ======================================================================
 *  INITIALIZATION
 * ==================================================================== */

var forumInitDone = false;
var forumInit = function () {
  if (forumInitDone) return;
  sfBindEvents();
  dfBindEvents();
  forumInitDone = true;
};

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', forumInit);
} else {
  forumInit();
}
</script>
<script>/* inlined novel-game.js */
/* === Novel Game (文游) Module ===
 * UU-style text-based game. Vanilla JS, no modules.
 * Depends on globals from index.html: request, toast, escapeHtml, $, $$, CONFIG, state.
 *
 * HTML hooks (already present in index.html):
 *   #novelGamePage            - section.page (toggled .active)
 *   #novelGameContainer       - .novel-container (flex shell)
 *     #novelGameMain          - tabs + list view
 *       .novel-tabs [data-novel-tab="scripts|saves"]
 *       #novelGameContent     - list render target
 *     #novelGameStory         - .novel-story (display:none initially)
 *       .novel-story-header   - #novelStoryBack / #novelTimeBadge / #novelRoundBadge / #novelSaveBtn
 *       #novelStatusBar       - .novel-status-bar (horizontal scrollable stat strip)
 *       #novelStoryScroll     - .novel-story-scroll (scrollable)
 *         #novelStoryContent  - .novel-story-content (narrative cards)
 *       #novelActionPanel     - .novel-action-panel (fixed bottom)
 *         #novelActions       - .novel-actions (action buttons)
 *         .novel-custom-action - #novelCustomActionInput / #novelCustomActionBtn
 *   #novelModal / #novelModalContent - character creation modal
 */

/* ------------------------------------------------------------------ *
 * API layer
 * ------------------------------------------------------------------ */
const novelAPI = {
  listScripts: () => request('/novel-games'),
  getScript: (id) => request(\`/novel-games/\${encodeURIComponent(id)}\`),
  listSaves: () => request('/novel-games/saves/list'),
  getSave: (saveId) => request(\`/novel-games/save/\${encodeURIComponent(saveId)}\`),
  createSave: (payload) => request('/novel-games/save', { method: 'POST', body: JSON.stringify(payload) }),
  deleteSave: (saveId) => request(\`/novel-games/save/\${encodeURIComponent(saveId)}\`, { method: 'DELETE' }),
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
  isLoading: false
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
  san: '理智', mp: '法力', sp: '体力'
};

const FIELD_LABELS = {
  name: '角色姓名', age: '年龄', gender: '性别', appearance: '外貌',
  personality: '性格', background: '背景经历', spiritualRoot: '灵根',
  daoHeart: '道心', transferReason: '转学原因', hobby: '兴趣特长',
  morality: '善恶倾向', magicAffinity: '魔法亲和', cultivation: '修炼功法',
  origin: '出身', race: '种族', title: '身份称号', wish: '心愿',
  secret: '隐秘之事', flaw: '性格缺陷', talent: '天赋', ability: '能力',
  belief: '信仰', codename: '代号', alias: '别名', job: '职业'
};

// Fields rendered as a single-line input; everything else becomes a textarea.
const SHORT_FIELDS = new Set(['name', 'age', 'gender', 'race', 'title', 'codename', 'alias']);

const statLabel = (key) => (Object.prototype.hasOwnProperty.call(STAT_LABELS, key) ? STAT_LABELS[key] : key);
const fieldLabel = (key) => (Object.prototype.hasOwnProperty.call(FIELD_LABELS, key) ? FIELD_LABELS[key] : key);

const DEFAULT_ACTIONS = ['继续探索', '与NPC交谈', '查看周围', '休息恢复'];

/* ------------------------------------------------------------------ *
 * Small render helpers
 * ------------------------------------------------------------------ */
const novelLoadingHtml = (msg) =>
  \`<div class="novel-loading"><div class="novel-loading-spinner"></div><span>\${escapeHtml(msg || '加载中...')}</span></div>\`;

const novelEmptyHtml = (icon, msg, sub) =>
  \`<div class="novel-empty"><div class="novel-empty-icon">\${icon}</div>\` +
  \`<p class="novel-empty-text">\${escapeHtml(msg || '')}</p>\` +
  (sub ? \`<p class="novel-empty-sub">\${escapeHtml(sub)}</p>\` : '') + \`</div>\`;

/* ------------------------------------------------------------------ *
 * Script list
 * ------------------------------------------------------------------ */
const renderNovelScripts = () => {
  const container = $('#novelGameContent');
  if (!container) return;
  if (!novelState.scripts.length) {
    container.innerHTML = novelEmptyHtml('📚', '暂无可用剧本', '稍后再来看看');
    return;
  }
  container.innerHTML =
    \`<div class="novel-script-list">\` +
    novelState.scripts.map((s) => {
      const grad = (s.coverGradient && s.coverGradient.length >= 2)
        ? s.coverGradient.join(', ')
        : '#7466ff, #9a8cff';
      const accent = s.accentColor || '#7466ff';
      const diff = s.difficulty || '中等';
      const diffCls = diff === '简单' ? 'easy' : (diff === '困难' ? 'hard' : 'medium');
      const tags = (s.tags || []).slice(0, 4);
      const desc = s.description || '';
      const shortDesc = desc.length > 84 ? desc.slice(0, 84) + '…' : desc;
      return (
        \`<div class="novel-script-card" data-action="open-script" data-script-id="\${escapeHtml(s.id)}" style="--card-accent:\${escapeHtml(accent)}">\` +
          \`<div class="novel-script-cover" style="background:linear-gradient(135deg, \${grad});">\` +
            \`<div class="novel-script-cover-mask"></div>\` +
            \`<div class="novel-script-cover-text">\` +
              \`<span class="novel-script-cat">\${escapeHtml(s.category || '')}</span>\` +
              \`<h3>\${escapeHtml(s.name)}</h3>\` +
            \`</div>\` +
            \`<span class="novel-script-diff \${diffCls}">\${escapeHtml(diff)}</span>\` +
          \`</div>\` +
          \`<div class="novel-script-info">\` +
            (tags.length ? \`<div class="novel-script-tags">\${tags.map((t) => \`<span class="novel-tag">\${escapeHtml(t)}</span>\`).join('')}</div>\` : '') +
            \`<p class="novel-script-desc">\${escapeHtml(shortDesc)}</p>\` +
            \`<div class="novel-script-cta">进入剧本 ›</div>\` +
          \`</div>\` +
        \`</div>\`
      );
    }).join('') +
    \`</div>\`;
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
    \`<div class="novel-save-list">\` +
    novelState.saves.map((sv) => {
      const time = sv.updatedAt
        ? new Date(sv.updatedAt).toLocaleString('zh-CN', { month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' })
        : '刚刚';
      const initial = (sv.scriptName || '?').slice(0, 1);
      return (
        \`<div class="novel-save-card" data-action="load-save" data-save-id="\${escapeHtml(sv.id)}">\` +
          \`<div class="novel-save-thumb">\${escapeHtml(initial)}</div>\` +
          \`<div class="novel-save-info">\` +
            \`<h4>\${escapeHtml(sv.scriptName || '未命名剧本')}</h4>\` +
            \`<div class="novel-save-meta">\` +
              \`<span>\${escapeHtml(sv.playerName || '未命名')}</span>\` +
              \`<span class="dot">·</span>\` +
              \`<span>第\${sv.round || 0}轮</span>\` +
              \`<span class="dot">·</span>\` +
              \`<span>\${escapeHtml(time)}</span>\` +
            \`</div>\` +
          \`</div>\` +
          \`<button class="novel-save-del" data-action="delete-save" data-save-id="\${escapeHtml(sv.id)}" type="button" title="删除存档">✕</button>\` +
        \`</div>\`
      );
    }).join('') +
    \`</div>\`;
};

/* ------------------------------------------------------------------ *
 * Character creation modal
 * ------------------------------------------------------------------ */
const openNovelScript = async (scriptId) => {
  const modal = $('#novelModal');
  const modalContent = $('#novelModalContent');
  if (!modal || !modalContent) return;
  // show loading state immediately
  modalContent.innerHTML = \`<div class="novel-modal-loading"><div class="novel-loading-spinner"></div><span>正在加载剧本...</span></div>\`;
  modal.classList.add('active');
  try {
    const script = await novelAPI.getScript(scriptId);
    novelState.currentScript = script;
    renderCharacterForm(script);
  } catch (err) {
    modalContent.innerHTML =
      \`<div class="novel-modal-error">\` +
        \`<div class="novel-empty-icon">⚠</div>\` +
        \`<p class="novel-empty-text">加载剧本失败</p>\` +
        \`<p class="novel-empty-sub">\${escapeHtml(err.message || '未知错误')}</p>\` +
      \`</div>\` +
      \`<div class="novel-modal-actions"><button class="novel-btn secondary" data-action="close-modal" type="button">关闭</button></div>\`;
  }
};

const renderCharacterForm = (script) => {
  const modalContent = $('#novelModalContent');
  if (!modalContent || !script) return;
  const accent = script.accentColor || '#7466ff';
  const grad = (script.coverGradient && script.coverGradient.length >= 2)
    ? script.coverGradient.join(', ')
    : '#7466ff, #9a8cff';
  const customizable = (script.player && script.player.customizable) || ['name'];
  const defaultStats = (script.player && script.player.defaultStats) || {};
  const startingItems = (script.player && script.player.startingItems) || [];
  const currency = (script.player && script.player.currency) || '';
  const world = script.world || {};
  const rules = world.rules || [];

  modalContent.style.setProperty('--script-accent', accent);
  modalContent.innerHTML =
    \`<div class="novel-create">\` +
      \`<div class="novel-create-hero" style="background:linear-gradient(135deg, \${grad});">\` +
        \`<span class="novel-create-cat">\${escapeHtml(script.category || '')}</span>\` +
        \`<h3>\${escapeHtml(script.name)}</h3>\` +
        (script.difficulty ? \`<span class="novel-create-diff">\${escapeHtml(script.difficulty)}</span>\` : '') +
      \`</div>\` +

      (world.era || world.setting || rules.length
        ? \`<div class="novel-create-world">\` +
            (world.era ? \`<div class="novel-world-era"><span class="novel-world-era-label">时代</span><span>\${escapeHtml(world.era)}</span></div>\` : '') +
            (world.setting ? \`<p class="novel-world-setting">\${escapeHtml(world.setting)}</p>\` : '') +
            (rules.length ? \`<ul class="novel-world-rules">\${rules.map((r) => \`<li>\${escapeHtml(r)}</li>\`).join('')}</ul>\` : '') +
          \`</div>\`
        : '') +

      \`<div class="novel-create-section">\` +
        \`<h4>创建角色</h4>\` +
        \`<div class="novel-fields">\` +
          customizable.map((field) => {
            const label = fieldLabel(field);
            if (SHORT_FIELDS.has(field)) {
              return \`<label class="novel-field"><span class="novel-field-label">\${escapeHtml(label)}</span>\` +
                \`<input type="text" data-field="\${escapeHtml(field)}" placeholder="输入\${escapeHtml(label)}" /></label>\`;
            }
            return \`<label class="novel-field"><span class="novel-field-label">\${escapeHtml(label)}</span>\` +
              \`<textarea data-field="\${escapeHtml(field)}" rows="2" placeholder="描述\${escapeHtml(label)}..."></textarea></label>\`;
          }).join('') +
        \`</div>\` +
      \`</div>\` +

      (Object.keys(defaultStats).length
        ? \`<div class="novel-create-section">\` +
            \`<h4>初始属性 <span class="novel-create-hint">可自由调整</span></h4>\` +
            \`<div class="novel-stat-grid">\` +
              Object.entries(defaultStats).map(([k, v]) => {
                const label = statLabel(k);
                return \`<div class="novel-stat-input">\` +
                  \`<span class="novel-stat-input-label">\${escapeHtml(label)}</span>\` +
                  \`<input type="text" data-stat="\${escapeHtml(label)}" value="\${escapeHtml(String(v))}" inputmode="numeric" />\` +
                \`</div>\`;
              }).join('') +
            \`</div>\` +
          \`</div>\`
        : '') +

      (startingItems.length || currency
        ? \`<div class="novel-create-section">\` +
            \`<h4>初始装备</h4>\` +
            (startingItems.length
              ? \`<div class="novel-items-row">\${startingItems.map((it) => {
                  const name = typeof it === 'string' ? it : (it.name || '');
                  return \`<span class="novel-item-pill">\${escapeHtml(name)}</span>\`;
                }).join('')}</div>\`
              : '') +
            (currency ? \`<div class="novel-currency">货币：<strong>\${escapeHtml(currency)}</strong></div>\` : '') +
          \`</div>\`
        : '') +

      \`<div class="novel-modal-actions">\` +
        \`<button class="novel-btn secondary" data-action="close-modal" type="button">取消</button>\` +
        \`<button class="novel-btn primary" data-action="create-save" type="button">开始游戏</button>\` +
      \`</div>\` +
    \`</div>\`;
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
 * Story view
 * ------------------------------------------------------------------ */
const getNpcNames = () => {
  const npcs = (novelState.currentScript && novelState.currentScript.npcs) || [];
  return new Set(npcs.map((n) => n.name).filter(Boolean));
};

const setNovelBadges = (round) => {
  const r = Math.max(1, Number(round) || 1);
  const time = $('#novelTimeBadge');
  const rb = $('#novelRoundBadge');
  if (time) time.textContent = \`第\${r}天\`;
  if (rb) rb.textContent = \`第\${r}轮\`;
};

const renderNovelStatusBar = () => {
  const save = novelState.currentSave;
  const bar = $('#novelStatusBar');
  if (!save || !bar) return;
  const stats = (save.state && save.state.player && save.state.player.stats) || {};
  const entries = Object.entries(stats);
  if (!entries.length) {
    bar.classList.remove('has-stats');
    bar.innerHTML = \`<span class="novel-status-empty">暂无属性</span>\`;
    return;
  }
  bar.classList.add('has-stats');
  bar.innerHTML = entries.map(([k, v]) =>
    \`<div class="novel-stat-chip">\` +
      \`<span class="novel-stat-chip-label">\${escapeHtml(statLabel(k))}</span>\` +
      \`<span class="novel-stat-chip-value">\${escapeHtml(String(v))}</span>\` +
    \`</div>\`
  ).join('');
};

const renderNovelRecap = () => {
  const save = novelState.currentSave;
  const content = $('#novelStoryContent');
  if (!save || !content) return;
  const history = save.history || [];
  if (!history.length) {
    content.innerHTML =
      \`<div class="novel-card novel-card-hint"><div class="novel-card-body">\` +
        \`<p class="novel-para">欢迎回来，\${escapeHtml(save.player && save.player.name ? save.player.name : '旅人')}。\` +
        \`选择下方行动继续你的故事，或在输入框中自定义行动。</p>\` +
      \`</div></div>\`;
    return;
  }
  const recent = history.slice(-3).reverse();
  content.innerHTML =
    \`<div class="novel-recap-label">前情提要</div>\` +
    recent.map((h) =>
      \`<div class="novel-card novel-card-recap">\` +
        \`<div class="novel-card-header">第\${h.round || '?'}轮 · \${escapeHtml(h.action || '行动')}</div>\` +
        \`<div class="novel-card-body"><p class="novel-para">\${escapeHtml(h.summary || '')}</p></div>\` +
      \`</div>\`
    ).join('') +
    \`<div class="novel-card novel-card-hint"><div class="novel-card-body">\` +
      \`<p class="novel-para">选择下方行动继续，或输入自定义行动。</p>\` +
    \`</div></div>\`;
};

const enterNovelStory = async (save) => {
  if (!save) return;
  novelState.currentSave = save;
  novelState.lastResult = null;
  novelState.isLoading = false;

  // ensure the full script is available (needed for NPC names / theming)
  if (!novelState.currentScript || novelState.currentScript.id !== save.scriptId) {
    try {
      novelState.currentScript = await novelAPI.getScript(save.scriptId);
    } catch (e) {
      novelState.currentScript = null;
      toast('剧本信息加载失败，部分功能可能受限');
    }
  }

  // theme the story view with the script's accent color
  const accent = (novelState.currentScript && novelState.currentScript.accentColor) || '#7466ff';
  const story = $('#novelGameStory');
  if (story) story.style.setProperty('--script-accent', accent);

  // switch views
  const main = $('#novelGameMain');
  if (main) main.style.display = 'none';
  if (story) story.style.display = 'flex';

  renderNovelStatusBar();
  setNovelBadges(Math.max(save.round || 0, 1));
  $('#novelActions').innerHTML = '';
  $('#novelStoryScroll').scrollTop = 0;

  const isNewGame = (save.round || 0) === 0 && (!save.history || save.history.length === 0);
  if (isNewGame) {
    // generate the opening narration directly
    await generateNovelRound('开始游戏，请生成开场剧情并介绍世界观与初始处境');
  } else {
    renderNovelRecap();
    renderNovelActions(DEFAULT_ACTIONS);
  }
};

const generateNovelRound = async (action, customAction) => {
  const save = novelState.currentSave;
  if (!save || novelState.isLoading) return;
  novelState.isLoading = true;

  const contentEl = $('#novelStoryContent');
  const actionsEl = $('#novelActions');
  if (contentEl) contentEl.innerHTML = novelLoadingHtml('AI 正在生成剧情...');
  if (actionsEl) actionsEl.innerHTML = '';

  try {
    const result = await novelAPI.action({
      saveId: save.id,
      action: action || '',
      customAction: customAction || ''
    });
    novelState.lastResult = result;

    const npcNames = getNpcNames();
    const parsed = parseNovelContent(result.content || '剧情生成失败，请重试。', npcNames);
    if (contentEl) contentEl.innerHTML = renderStoryCards(parsed);
    setNovelBadges(result.round || Math.max(save.round || 0, 1));
    renderNovelActions(parsed.actions && parsed.actions.length ? parsed.actions : DEFAULT_ACTIONS);

    const scroll = $('#novelStoryScroll');
    if (scroll) scroll.scrollTop = 0;

    // persist stat/round changes
    await applyNovelRound(result, customAction || action || '继续探索');
  } catch (err) {
    if (contentEl) contentEl.innerHTML = novelEmptyHtml('⚠', '剧情生成失败', err.message || '未知错误');
    renderNovelActions(DEFAULT_ACTIONS);
  } finally {
    novelState.isLoading = false;
  }
};

const applyNovelRound = async (result, actionText) => {
  const save = novelState.currentSave;
  if (!save || !result) return;
  const changes = result.statChanges || [];
  const historyEntry = {
    round: result.round || (save.round || 0) + 1,
    action: actionText,
    summary: (result.content || '').slice(0, 220).replace(/\\s+/g, ' '),
    changes
  };
  try {
    const updated = await novelAPI.applyChanges({ saveId: save.id, changes, historyEntry });
    novelState.currentSave = updated;
    renderNovelStatusBar();
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
  t = t.replace(/\\[\\s*([^\\[\\]]+?)\\s*([+\\-]\\d+)\\s*\\]/g, (m, stat, delta) => {
    const d = Number(delta);
    const cls = d >= 0 ? 'positive' : 'negative';
    const sign = d >= 0 ? '+' : '';
    return \`<span class="novel-stat-badge \${cls}">\${stat}\${sign}\${d}</span>\`;
  });
  // bold
  t = t.replace(/\\*\\*([^*]+?)\\*\\*/g, '<strong>$1</strong>');
  return t;
};

const renderBodyLines = (lines, npcNames) => {
  const html = [];
  let listBuffer = [];
  const flushList = () => {
    if (listBuffer.length) {
      html.push('<ul class="novel-list">' + listBuffer.map((li) => \`<li>\${formatInline(li)}</li>\`).join('') + '</ul>');
      listBuffer = [];
    }
  };
  for (const raw of lines) {
    const line = raw.trim();
    if (!line) { flushList(); continue; }

    // markdown sub-header
    const hm = line.match(/^#{1,5}\\s+(.+)$/);
    if (hm) { flushList(); html.push(\`<h5 class="novel-sub-h">\${formatInline(hm[1])}</h5>\`); continue; }

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
        html.push(\`<div class="novel-dialogue">\` +
          \`<span class="novel-speaker">\${formatInline(speaker)}</span>\` +
          \`<span class="novel-quote">\${formatInline(speech)}</span>\` +
        \`</div>\`);
        continue;
      }
    }

    // pure quoted line
    if (/^["”“「『][\\s\\S]+["”“」』]$/.test(line)) {
      flushList();
      html.push(\`<div class="novel-dialogue novel-dialogue-anon">\${formatInline(line)}</div>\`);
      continue;
    }

    // plain paragraph
    flushList();
    html.push(\`<p class="novel-para">\${formatInline(line)}</p>\`);
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
    return \`<div class="novel-card novel-card-narrative"><div class="novel-card-body">\` +
      \`<p class="novel-para novel-para-muted">（本轮没有生成文本，请尝试其他行动）</p>\` +
    \`</div></div>\`;
  }
  return parsed.cards.map((c) => {
    if (c.header) {
      return \`<div class="novel-card">\` +
        \`<div class="novel-card-header">\${formatInline(c.header)}</div>\` +
        \`<div class="novel-card-body">\${c.bodyHtml}</div>\` +
      \`</div>\`;
    }
    return \`<div class="novel-card novel-card-narrative"><div class="novel-card-body">\${c.bodyHtml}</div></div>\`;
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

const renderNovelActions = (actions) => {
  const list = (actions && actions.length) ? actions : DEFAULT_ACTIONS;
  const el = $('#novelActions');
  if (!el) return;
  el.innerHTML = list.map((a, i) =>
    \`<button class="novel-action-btn \${i === 0 ? 'primary' : ''}" data-action="story-action" data-action-text="\${escapeHtml(a)}" type="button">\` +
      \`<span class="novel-action-idx">\${i + 1}</span>\` +
      \`<span class="novel-action-label">\${escapeHtml(a)}</span>\` +
    \`</button>\`
  ).join('');
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
  novelState.currentSave = null;
  novelState.lastResult = null;
  novelState.isLoading = false;
  // refresh lists (progress may have changed)
  loadNovelSaves();
  if (novelState.currentTab === 'scripts') loadNovelScripts();
};

const submitCustomAction = async () => {
  if (novelState.isLoading) return;
  const input = $('#novelCustomActionInput');
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
  // tab switching
  const tabBtn = e.target.closest('[data-novel-tab]');
  if (tabBtn) {
    novelState.currentTab = tabBtn.dataset.novelTab;
    $$('.novel-tabs [data-novel-tab]').forEach((b) => b.classList.toggle('active', b === tabBtn));
    if (novelState.currentTab === 'scripts') { renderNovelScripts(); loadNovelScripts(); }
    else { renderNovelSaves(); loadNovelSaves(); }
    return;
  }

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

  // choose a story action
  const storyAct = e.target.closest('[data-action="story-action"]');
  if (storyAct && !novelState.isLoading) {
    const text = storyAct.dataset.actionText || '';
    await generateNovelRound(text, '');
    return;
  }
});

/* ------------------------------------------------------------------ *
 * Static element bindings
 * ------------------------------------------------------------------ */
const bindNovelEvents = () => {
  $('#novelStoryBack')?.addEventListener('click', () => backToNovelMain());
  $('#novelSaveBtn')?.addEventListener('click', () => saveNovelGame());
  $('#novelCustomActionBtn')?.addEventListener('click', () => submitCustomAction());
  $('#novelCustomActionInput')?.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') { e.preventDefault(); submitCustomAction(); }
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

</script>
<script>/* inlined profile.js */
/* === Direct Messages (私信) System === */

var dmCurrentRole = null;
var dmMessages = [];

var openDmOverlay = function() {
  var overlay = document.getElementById('dmOverlay');
  if (!overlay) return;
  overlay.classList.add('active');
  renderDmRoleBar();
  dmCurrentRole = null;
  dmMessages = [];
  renderDmChatList();
};

var closeDmOverlay = function() {
  var overlay = document.getElementById('dmOverlay');
  if (overlay) overlay.classList.remove('active');
};

var renderDmRoleBar = function() {
  var bar = document.getElementById('dmRoleBar');
  if (!bar) return;
  var roles = (typeof state !== 'undefined' && state.roles) ? state.roles : [];
  if (roles.length === 0) {
    bar.innerHTML = '<span style="color:#999;font-size:.8rem;padding:6px">请先创建或选择角色</span>';
    return;
  }
  bar.innerHTML = roles.map(function(r) {
    return '<button class="dm-role-chip' + (dmCurrentRole && dmCurrentRole.name === r.name ? ' active' : '') + '" data-dm-role="' + escapeHtml(r.name) + '">' + escapeHtml(r.name) + '</button>';
  }).join('');
  bar.querySelectorAll('[data-dm-role]').forEach(function(chip) {
    chip.addEventListener('click', function() {
      var name = this.dataset.dmRole;
      var role = roles.find(function(r) { return r.name === name; });
      if (role) selectDmRole(role);
    });
  });
};

var selectDmRole = function(role) {
  dmCurrentRole = role;
  renderDmRoleBar();
  loadDmMessages();
};

var loadDmMessages = async function() {
  if (!dmCurrentRole) return;
  var list = document.getElementById('dmChatList');
  if (list) list.innerHTML = '<div class="forum-loading">加载中...</div>';
  try {
    var resp = await fetch('/api/messages', { headers: { 'X-User-Id': (state.userId || 'demo-user') } });
    var data = await resp.json();
    if (data && data.data && data.data.list) {
      dmMessages = data.data.list.filter(function(m) { return m.role === dmCurrentRole.name; });
    }
  } catch (e) {
    dmMessages = [];
  }
  renderDmChatList();
};

var renderDmChatList = function() {
  var list = document.getElementById('dmChatList');
  if (!list) return;
  if (!dmCurrentRole) {
    list.innerHTML = '<div class="forum-loading">选择一个角色开始私信</div>';
    return;
  }
  if (dmMessages.length === 0) {
    list.innerHTML = '<div class="forum-loading">还没有私信记录，发一条试试吧~</div>';
    return;
  }
  list.innerHTML = dmMessages.slice().reverse().map(function(m) {
    var time = m.createdAt ? new Date(m.createdAt).toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit' }) : '';
    return '<div class="dm-bubble ' + (m.fromUser ? 'from-user' : 'from-role') + '">'
      + '<div>' + escapeHtml(m.content || '') + '</div>'
      + '<div class="dm-time">' + escapeHtml(time) + '</div>'
      + '</div>';
  }).join('');
  list.scrollTop = list.scrollHeight;
};

var sendDmMessage = async function() {
  var input = document.getElementById('dmInput');
  if (!input || !input.value.trim() || !dmCurrentRole) return;
  var text = input.value.trim();
  input.value = '';

  /* Optimistic: show user message immediately */
  dmMessages.push({ id: 'tmp-' + Date.now(), role: dmCurrentRole.name, content: text, fromUser: true, createdAt: new Date().toISOString() });
  renderDmChatList();

  try {
    /* Save to server */
    await fetch('/api/messages', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-User-Id': (state.userId || 'demo-user') },
      body: JSON.stringify({ role: dmCurrentRole.name, content: text, fromUser: true })
    });

    /* Get AI reply */
    var replyResp = await fetch('/api/messages/reply', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-User-Id': (state.userId || 'demo-user') },
      body: JSON.stringify({
        role: dmCurrentRole.name,
        rolePrompt: dmCurrentRole.prompt || '',
        userMessage: text
      })
    });
    var replyData = await replyResp.json();
    if (replyData && replyData.data && replyData.data.reply) {
      dmMessages.push({ id: 'tmp-r-' + Date.now(), role: dmCurrentRole.name, content: replyData.data.reply, fromUser: false, createdAt: new Date().toISOString() });
      /* Save reply to server */
      await fetch('/api/messages', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'X-User-Id': (state.userId || 'demo-user') },
        body: JSON.stringify({ role: dmCurrentRole.name, content: replyData.data.reply, fromUser: false })
      });
    }
    renderDmChatList();
  } catch (e) {
    if (typeof toast === 'function') toast('发送失败，请重试');
  }
};

/* === Bind DM events === */
var bindDmEvents = function() {
  var openBtn = document.getElementById('openMessagesBtn');
  if (openBtn) openBtn.addEventListener('click', openDmOverlay);

  var closeBtn = document.getElementById('dmCloseBtn');
  if (closeBtn) closeBtn.addEventListener('click', closeDmOverlay);

  var sendBtn = document.getElementById('dmSendBtn');
  if (sendBtn) sendBtn.addEventListener('click', sendDmMessage);

  var dmInput = document.getElementById('dmInput');
  if (dmInput) dmInput.addEventListener('keydown', function(e) {
    if (e.key === 'Enter') sendDmMessage();
  });
};

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', bindDmEvents);
} else {
  bindDmEvents();
}

</script>
</body>
</html>
`;

const fail = (res, status, code, message, details = null) => res.status(status).json({ code, message, details });

const getUser = (userId = 'demo-user') => {
  if (!users.has(userId)) {
    users.set(userId, { id: userId, beans: config.demoInitialBeans, createdAt: new Date().toISOString() });
    saveData();
  }
  return users.get(userId);
};

const writeSse = (res, event, data) => {
  res.write(`event: ${event}\n`);
  res.write(`data: ${JSON.stringify(data)}\n\n`);
};

const streamText = async (res, text) => {
  for (const char of text) {
    writeSse(res, 'delta', { content: char });
    await new Promise((resolve) => setTimeout(resolve, 18));
  }
};

const refundChatBeans = (user, roleName = 'AI角色', summary = 'AI 回复失败自动退豆') => {
  user.beans += config.chatBeansCost;
  stats.totalRefundBeans += config.chatBeansCost;
  transactions.push({
    id: randomUUID(),
    userId: user.id,
    type: 'refund',
    beans: config.chatBeansCost,
    roleName,
    summary,
    createdAt: new Date().toISOString()
  });
  saveData();
};

const getUserMemories = (userId = 'demo-user') => {
  if (!userMemories.has(userId)) userMemories.set(userId, []);
  return userMemories.get(userId);
};

const memoryTypes = ['用户资料', '角色关系', '事件', '偏好', '禁忌', '剧情'];

const normalizeMemory = (payload = {}, fallback = {}) => {
  const content = String(payload.content || '').trim().slice(0, 220);
  if (!content) return null;
  const roleId = String(payload.roleId || fallback.roleId || '').slice(0, 80);
  const roleName = String(payload.roleName || fallback.roleName || '全部角色').slice(0, 40);
  const type = memoryTypes.includes(payload.type) ? payload.type : (fallback.type || '事件');
  return {
    id: payload.id || randomUUID(),
    roleId,
    roleName,
    type,
    content,
    source: payload.source || fallback.source || 'manual',
    sourceConversationId: String(payload.sourceConversationId || fallback.sourceConversationId || roleId || '').slice(0, 120),
    sourceMessageIds: Array.isArray(payload.sourceMessageIds || fallback.sourceMessageIds)
      ? [...new Set((payload.sourceMessageIds || fallback.sourceMessageIds).map((item) => String(item).slice(0, 120)))].slice(0, 8)
      : [],
    createdAt: payload.createdAt || new Date().toISOString(),
    updatedAt: new Date().toISOString()
  };
};

const addMemory = (userId, payload, fallback = {}) => {
  const memory = normalizeMemory(payload, fallback);
  if (!memory) return null;
  const list = getUserMemories(userId);
  const duplicate = list.find((item) =>
    item.roleId === memory.roleId &&
    item.type === memory.type &&
    item.content.trim() === memory.content.trim()
  );
  if (duplicate) {
    duplicate.updatedAt = new Date().toISOString();
    duplicate.sourceMessageIds = [...new Set([...(duplicate.sourceMessageIds || []), ...(memory.sourceMessageIds || [])])].slice(0, 8);
    saveData();
    return duplicate;
  }
  list.unshift(memory);
  if (list.length > 200) list.length = 200;
  saveData();
  return memory;
};

const listMemories = (userId, roleId = '') => {
  const targetRoleId = String(roleId || '');
  return getUserMemories(userId)
    .filter((item) => !targetRoleId || !item.roleId || item.roleId === targetRoleId)
    .sort((a, b) => new Date(b.updatedAt || b.createdAt) - new Date(a.updatedAt || a.createdAt));
};

const buildMemoryPrompt = (userId, roleId = '') => {
  const memories = listMemories(userId, roleId).slice(0, 12);
  if (!memories.length) return '';
  return `\n\n【长期记忆】\n这些是用户允许你记住的信息，请自然使用，不要机械复述：\n${memories.map((item, index) => `${index + 1}. [${item.type}] ${item.content}`).join('\n')}`;
};

const inferMemoryType = (content) => {
  if (/不喜欢|讨厌|别再|不要叫|不要|不想|别问|算了|随便|害怕|担心|焦虑|压力/.test(content)) return '禁忌';
  if (/喜欢|偏好|希望|习惯|叫我|称呼|想要|需要/.test(content)) return '偏好';
  if (/生日|家人|朋友|学校|工作|职业|住在|来自|我是|我叫|考试|上班|面试/.test(content)) return '用户资料';
  if (/约定|我们|一起|关系|陪我|晚安|早安|聚会|约会|庆祝|纪念/.test(content)) return '角色关系';
  if (/剧情|任务|线索|案件|世界观|设定|正在|目标|计划|打算/.test(content)) return '剧情';
  return '事件';
};

const summarizeMemory = (userMsg, replyText, roleName) => {
  const raw = String(userMsg || '').replace(/\s+/g, ' ').trim();
  const reply = String(replyText || '').replace(/\s+/g, ' ').trim();
  if (!raw || raw.length < 2 || raw.length > 260) return null;
  if (/^(你好|在吗|嗯|哦|好|哈哈|谢谢|再见|晚安|早安|是的|对的|不是|没有|可以|好的|行|ok)[。！？!?.\s]*$/i.test(raw)) return null;

  let content = '';
  const rn = roleName || '角色';

  if (/我叫|叫我|称呼|昵称/.test(raw)) {
    const m = raw.match(/(?:叫我|称呼我|我是)([^\s,，。.！!？?]+)/);
    content = m ? `用户希望被称呼为"${m[1]}"。` : `用户提到了自己的名字或称呼偏好。`;
  } else if (/^(我喜欢|我爱|我超爱|我超喜欢)/.test(raw)) {
    const m = raw.match(/(?:喜欢|爱|超爱|超喜欢)([^\s,，。.！!？?]+)/);
    content = m ? `用户很喜欢${m[1]}，这是TA的偏好之一。` : `用户表达了对某事物的喜爱。`;
  } else if (/^(我不喜欢|我讨厌|我讨厌|我反感|我不想)|不想说|不要|别问|算了|随便/.test(raw)) {
    const m = raw.match(/(?:不喜欢|讨厌|反感|不想|不要)([^\s,，。.！!？?]+)/);
    content = m ? `用户不太喜欢${m[1]}，后续聊天里要尊重TA的边界。` : `用户表现出回避或拒绝继续展开的话题，${rn}需要温柔地尊重TA的边界。`;
  } else if (/(心情|心情不好|心情好|开心|难过|伤心|哭|生气|害怕|焦虑|压力|孤独|幸福|感动)/.test(raw)) {
    if (/开心|幸福|高兴|快乐|好开心/.test(raw)) {
      content = raw.length > 20 ? `用户分享了一件开心的事：${raw}` : `用户今天心情不错，似乎遇到了开心的事情。`;
    } else {
      content = raw.length > 20 ? `用户倾诉了一些烦恼：${raw}` : `用户似乎心情不太好，${rn}给予了温柔的陪伴和安慰。`;
    }
  } else if (/(上班|下班|加班|工作|老板|同事|开会|面试|辞职|考试|学习|作业|老师|学校)/.test(raw)) {
    content = raw.length > 30 ? `用户聊到了工作或学习方面的事情：${raw}` : `用户分享了工作或学习中的一些经历，${rn}认真地倾听了。`;
  } else if (/(累|困|饿|生病|医院|感冒|发烧|头痛|失眠)/.test(raw)) {
    content = raw.length > 20 ? `用户提到了身体状况：${raw}` : `用户身体有些不舒服，${rn}叮嘱TA要好好照顾自己。`;
  } else if (/(旅行|出去玩|旅游|出发|到达|机场|火车|酒店|景点)/.test(raw)) {
    content = raw.length > 30 ? `用户正在旅行或计划旅行：${raw}` : `用户提到了旅行相关的话题，${rn}和TA聊得很开心。`;
  } else if (/(约定|约定了|说好了|答应|承诺|一起|我们)/.test(raw)) {
    content = `用户和${rn}之间有了一个小小的约定：${raw}`;
  } else if (/(生日|节日|过年|圣诞|纪念|庆祝|礼物)/.test(raw)) {
    content = raw.length > 30 ? `用户聊到了一个特别的日子：${raw}` : `用户提到了一个值得记住的特别日子。`;
  } else if (/(家人|爸爸|妈妈|哥哥|姐姐|弟弟|妹妹|男朋友|女朋友|老公|老婆|对象|朋友|闺蜜|兄弟)/.test(raw)) {
    content = raw.length > 30 ? `用户提到了自己身边的人：${raw}` : `用户向${rn}分享了关于身边人的事情。`;
  } else if (/(想|想念|思念|怀念|记得|回忆|以前|小时候|长大|过去|曾经)/.test(raw)) {
    content = raw.length > 30 ? `用户回忆起了一些往事：${raw}` : `用户陷入了回忆，向${rn}倾诉了一些过去的事情。`;
  } else if (/(游戏|动漫|电影|音乐|读书|追剧|追番|小说|画画|吉他|钢琴|运动|健身)/.test(raw)) {
    content = raw.length > 30 ? `用户聊到了自己的兴趣爱好：${raw}` : `用户和${rn}聊到了兴趣爱好相关的话题。`;
  } else if (/(买了|购物|下单|快递|收到|到了|新衣服|新手机|新电脑)/.test(raw)) {
    content = `用户分享了购物相关的话题：${raw.length > 50 ? raw.slice(0, 50) + '...' : raw}`;
  } else if (/(搬家|租房|新房|装修|布置|打扫)/.test(raw)) {
    content = `用户提到了生活方面的事情：${raw.length > 50 ? raw.slice(0, 50) + '...' : raw}`;
  } else if (/(吃饭|美食|做饭|餐厅|外卖|零食|奶茶|咖啡|蛋糕|火锅)/.test(raw)) {
    content = `用户和${rn}聊到了美食相关的话题。`;
  } else if (reply && reply.length > 10) {
    const shortReply = reply.length > 60 ? reply.slice(0, 60) + '...' : reply;
    content = `用户和${rn}聊了一个话题。用户说："${raw.length > 40 ? raw.slice(0, 40) + '...' : raw}"${rn}温柔地回应了TA。`;
  } else {
    content = `用户向${rn}倾诉了一些心事。`;
  }

  return content;
};

const buildAutoMemory = ({ userId, roleId, roleName, lastUserMessage, assistantReply, sourceMessageIds = [] }) => {
  const content = summarizeMemory(lastUserMessage, assistantReply, roleName);
  if (!content) return null;
  const type = inferMemoryType(lastUserMessage);
  return addMemory(userId, {
    roleId,
    roleName,
    type,
    content,
    source: 'auto',
    sourceConversationId: roleId,
    sourceMessageIds
  });
};

const cleanupAutoMemories = (userId, { roleId = '', sourceConversationId = '', sourceMessageIds = [] } = {}) => {
  const ids = new Set((sourceMessageIds || []).map(String));
  const before = getUserMemories(userId);
  const kept = before.filter((item) => {
    if (item.source !== 'auto') return true;
    const conversationMatched = sourceConversationId && item.sourceConversationId === sourceConversationId;
    const roleMatched = roleId && item.roleId === roleId;
    const messageMatched = ids.size && (item.sourceMessageIds || []).some((id) => ids.has(id));
    return !(conversationMatched || (roleMatched && !sourceConversationId && !ids.size) || messageMatched);
  });
  userMemories.set(userId, kept);
  const deleted = before.length - kept.length;
  if (deleted > 0) saveData();
  return deleted;
};

const publishCommunityRole = (role) => {
  const item = {
    id: role.id || randomUUID(),
    name: String(role.name || '').slice(0, 40),
    avatar: role.avatar || '',
    description: String(role.description || '').slice(0, 160),
    prompt: String(role.prompt || '').slice(0, 6000),
    uploaderNickname: String(role.uploaderNickname || '匿名用户').slice(0, 24),
    heat: Math.floor(Math.random() * 800) + 20,
    createdAt: new Date().toISOString()
  };
  communityRoles.unshift(item);
  return item;
};

publishCommunityRole({ name: '温柔陪伴师', description: '擅长倾听、安慰和日常陪伴的暖心角色。', prompt: '你是一位温柔、耐心、边界清晰的陪伴型 AI 角色。', uploaderNickname: 'Mochi-phone' });
publishCommunityRole({ name: '赛博侦探', description: '冷静、敏锐，适合悬疑推理和剧情扮演。', prompt: '你是一名生活在近未来都市的赛博侦探，擅长分析线索。', uploaderNickname: 'Mochi-phone' });

app.use(helmet({ contentSecurityPolicy: false }));
app.use(cors({ origin: true }));
app.use(express.json({ limit: '5mb' }));
// Static files are inlined - no express.static needed

app.use((req, _res, next) => {
  req.userId = String(req.headers['x-user-id'] || 'demo-user').slice(0, 80);
  next();
});



// Inlined HTML served directly
app.get('/', (_req, res) => {
  res.setHeader('Content-Type', 'text/html; charset=utf-8');
  res.send(INLINED_HTML);
});

app.get('/api/health', (_req, res) => ok(res, { status: 'running', name: 'Mochi-phone' }));

app.get('/api/user/me', (req, res) => {
  const user = getUser(req.userId);
  ok(res, { id: user.id, beans: user.beans, transactions: transactions.filter((item) => item.userId === user.id).slice(-50).reverse() });
});

app.get('/api/user/billing-config', (_req, res) => {
  ok(res, { chatBeansCost: config.chatBeansCost, beansPerCny: config.beansPerCny, rechargePackages: config.rechargePackages });
});

app.post('/api/user/recharge/callback', (req, res) => {
  const amount = Number(req.body?.amount);
  const packageItem = config.rechargePackages.find((item) => item.amount === amount);
  if (!packageItem) return fail(res, 400, 4001, '充值套餐参数不正确。');
  const user = getUser(req.userId);
  user.beans += packageItem.beans;
  stats.totalRechargeCny += packageItem.amount;
  transactions.push({ id: randomUUID(), userId: user.id, type: 'recharge', beans: packageItem.beans, amount: packageItem.amount, roleName: '充值中心', summary: `充值 ${packageItem.amount} 元，到账 ${packageItem.beans} 豆子`, createdAt: new Date().toISOString() });
  saveData();
  ok(res, { beans: user.beans }, '充值成功');
});

app.get('/api/user/export-data', (req, res) => {
  const user = getUser(req.userId);
  ok(res, {
    userId: user.id,
    beans: user.beans,
    transactions: transactions.filter((item) => item.userId === user.id).slice(-200),
    memories: getUserMemories(user.id).slice(-200)
  });
});

app.post('/api/user/import-data', (req, res) => {
  const targetUserId = String(req.body?.userId || req.userId || 'demo-user').slice(0, 80);
  const user = getUser(targetUserId);
  const beans = Number(req.body?.beans);
  if (Number.isFinite(beans) && beans >= 0) {
    user.beans = beans;
  }
  if (Array.isArray(req.body?.transactions)) {
    for (const item of req.body.transactions.slice(-200)) {
      transactions.push({
        id: item.id || randomUUID(),
        userId: targetUserId,
        type: item.type || 'import',
        beans: Number(item.beans || 0),
        amount: Number(item.amount || 0),
        roleName: item.roleName || '数据恢复',
        summary: item.summary || '从备份文件恢复',
        createdAt: item.createdAt || new Date().toISOString()
      });
    }
  }
  if (Array.isArray(req.body?.memories)) {
    userMemories.set(targetUserId, []);
    for (const memory of req.body.memories.slice(-200)) {
      addMemory(targetUserId, memory, { source: memory.source || 'manual' });
    }
  }
  saveData();
  ok(res, {
    userId: targetUserId,
    beans: user.beans,
    transactions: transactions.filter((item) => item.userId === targetUserId).slice(-200),
    memories: getUserMemories(targetUserId).slice(-200)
  }, '数据已恢复');
});

app.get('/api/user/stats', (_req, res) => ok(res, stats));

app.get('/api/memories', (req, res) => {
  ok(res, { list: listMemories(req.userId, req.query.roleId), total: listMemories(req.userId, req.query.roleId).length });
});

app.post('/api/memories', (req, res) => {
  const memory = addMemory(req.userId, req.body || {}, { source: 'manual' });
  if (!memory) return fail(res, 400, 4004, '记忆内容不能为空。');
  ok(res, memory, '记忆已保存');
});

app.delete('/api/memories/:id', (req, res) => {
  const list = getUserMemories(req.userId);
  const before = list.length;
  userMemories.set(req.userId, list.filter((item) => item.id !== req.params.id));
  if (before !== getUserMemories(req.userId).length) saveData();
  ok(res, { deleted: before - getUserMemories(req.userId).length }, '记忆已删除');
});

app.post('/api/memories/cleanup-conversation', (req, res) => {
  const deleted = cleanupAutoMemories(req.userId, req.body || {});
  ok(res, { deleted }, '已同步清理对话关联记忆');
});

app.get('/api/community/roles', (req, res) => {
  const keyword = String(req.query.keyword || '').trim().toLowerCase();
  const list = communityRoles.filter((role) => !keyword || `${role.name} ${role.description} ${role.prompt}`.toLowerCase().includes(keyword));
  ok(res, { list, total: list.length, page: 1, pageSize: 12 });
});

app.post('/api/community/roles', (req, res) => {
  const { name, description, prompt, avatar, uploaderNickname } = req.body || {};
  if (!name || !description || !prompt) return fail(res, 400, 4002, '发布角色需要填写名称、简介和人设。');
  ok(res, publishCommunityRole({ name, description, prompt, avatar, uploaderNickname }), '角色已发布到社区');
});

app.post('/api/chat', async (req, res) => {
  const { roleId, roleName, rolePrompt, messages, sourceMessageIds } = req.body || {};
  const normalizedMessages = Array.isArray(messages) ? messages.slice(-20) : [];
  const lastUserMessage = [...normalizedMessages].reverse().find((item) => item.role === 'user')?.content || '';
  const activeRoleId = String(roleId || roleName || 'default-role').slice(0, 80);
  if (!lastUserMessage.trim()) return fail(res, 400, 4003, '消息内容不能为空。');

  const user = getUser(req.userId);
  if (user.beans < config.chatBeansCost) return fail(res, 402, 4021, '豆子余额不足，请先充值后再继续聊天。', { beans: user.beans });

  user.beans -= config.chatBeansCost;
  stats.totalBeansConsumed += config.chatBeansCost;
  transactions.push({ id: randomUUID(), userId: user.id, type: 'consume', beans: -config.chatBeansCost, roleName, summary: String(lastUserMessage).slice(0, 60), createdAt: new Date().toISOString() });
  saveData();

  res.setHeader('Content-Type', 'text/event-stream; charset=utf-8');
  res.setHeader('Cache-Control', 'no-cache, no-transform');
  res.setHeader('Connection', 'keep-alive');
  writeSse(res, 'charged', { beans: user.beans, cost: config.chatBeansCost });

  try {
    if (!config.upstreamKey || config.upstreamKey.includes('请填写')) {
      const memoryNote = buildMemoryPrompt(user.id, activeRoleId);
      const reply = `我是${roleName || 'Mochi-phone 角色'}。我已经收到你的消息：“${lastUserMessage}”。${memoryNote ? '\\n\\n我也会参考我们已有的记忆继续陪你。' : ''}\n\n当前网站后端已运行，但还没有读取到 UPSTREAM_API_KEY，所以先返回演示回复。`;
      await streamText(res, reply);
      const memory = buildAutoMemory({ userId: user.id, roleId: activeRoleId, roleName, lastUserMessage, assistantReply: reply, sourceMessageIds });
      if (memory) writeSse(res, 'memory', memory);
      stats.totalChatCount += 1;
      writeSse(res, 'done', { beans: user.beans });
      return res.end();
    }

    const upstreamAbortController = new AbortController();
    const upstreamTimeout = setTimeout(() => upstreamAbortController.abort(), 45000);
    const upstreamResponse = await fetch(`${config.upstreamBase}/chat/completions`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${config.upstreamKey}` },
      signal: upstreamAbortController.signal,
      body: JSON.stringify({
        model: config.upstreamModel,
        stream: true,
        messages: [
          { role: 'system', content: `${rolePrompt || `你正在扮演${roleName || 'AI角色'}，请保持角色一致。`}${buildMemoryPrompt(user.id, activeRoleId)}` },
          ...normalizedMessages.map((item) => ({ role: item.role === 'assistant' ? 'assistant' : 'user', content: String(item.content || '') }))
        ]
      })
    }).finally(() => clearTimeout(upstreamTimeout));

    if (!upstreamResponse.ok || !upstreamResponse.body) throw new Error(`上游服务异常：${upstreamResponse.status}`);
    const reader = upstreamResponse.body.getReader();
    const decoder = new TextDecoder();
    let buffer = '';
    let replyText = '';

    const handlePayload = (payload) => {
      if (!payload || payload === '[DONE]') return;
      try {
        const json = JSON.parse(payload);
        const content = json.choices?.[0]?.delta?.content || json.choices?.[0]?.message?.content || '';
        if (content) {
          replyText += content;
          writeSse(res, 'delta', { content });
        }
      } catch {}
    };

    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      const parts = buffer.split('\n\n');
      buffer = parts.pop() || '';
      for (const part of parts) {
        const dataLines = part.split('\n').filter((line) => line.startsWith('data:'));
        for (const line of dataLines) {
          handlePayload(line.replace(/^data:\s*/, '').trim());
        }
      }
    }
    buffer += decoder.decode();

    if (buffer.trim()) {
      const dataLines = buffer.split('\n').filter((line) => line.startsWith('data:'));
      for (const line of dataLines) {
        handlePayload(line.replace(/^data:\s*/, '').trim());
      }
    }

    if (!replyText.trim()) {
      refundChatBeans(user, roleName, 'AI 空回复，自动退回本次聊天豆子');
      writeSse(res, 'error', {
        message: 'AI 这次没有返回内容，已自动退回本次扣除的豆子，请再试一次。',
        beans: user.beans
      });
      return res.end();
    }

    const memory = buildAutoMemory({ userId: user.id, roleId: activeRoleId, roleName, lastUserMessage, assistantReply: replyText, sourceMessageIds });
    if (memory) writeSse(res, 'memory', memory);
    stats.totalChatCount += 1;
    writeSse(res, 'done', { beans: user.beans });
    res.end();
  } catch (error) {
    refundChatBeans(user, roleName, 'AI 回复失败，自动退回本次聊天豆子');
    writeSse(res, 'error', { message: 'AI 回复失败，已自动返还本次扣除的豆子。', detail: error.message });
    res.end();
  }
});


/* === Forum API === */
const FORUM_AVATAR_COUNT = 8;
const FORUM_AUTHOR_NAMES = [
  '月光下的猫', '深夜食堂', '柠檬不萌', '星河滚烫', '草莓味晚风',
  '云朵邮局', '人间清醒', '气泡水加冰', '银河系迷路', '温柔半两',
  '海盐焦糖', '落日余晖', '雾里看花', '三餐四季', '月亮邮递员',
  '初雪将至', '南风知我意', '猫薄荷', '今日份快乐', '碎碎念bot'
];

const generateFallbackPosts = (tab, roleName) => {
  const tabLabels = { following: '关注', recommended: '推荐', gossip: '八卦' };
  const templates = {
    following: [
      '今天和' + (roleName || 'TA') + '聊了很多，感觉我们的关系又近了一步呢~',
      (roleName || 'TA') + '说了一句很温柔的话，我记了好久。',
      '每次和' + (roleName || 'TA') + '聊天都很开心，期待下一次对话！',
      '今天的心情因为' + (roleName || 'TA') + '变得特别好☀️',
      '翻看了和' + (roleName || 'TA') + '的聊天记录，嘴角忍不住上扬',
      (roleName || 'TA') + '真的太懂我了，每句话都说到心坎里'
    ],
    recommended: [
      '今天做了一道新菜，虽然卖相一般但味道意外地好！附上食谱分享给大家~',
      '推荐一本最近在看的书，真的太好哭了，建议大家备好纸巾📚',
      '周末去了一个超美的小众景点，人少景美，分享一波照片📸',
      '最近迷上了手冲咖啡，每天早上的仪式感太幸福了☕',
      '分享一个超好用的学习app，用了三个月效率翻倍！',
      '今天的天空也太好看了吧，随手拍都是壁纸级别的☁️',
      '终于把拖延了很久的事情做完了，爽！大家也要加油呀💪',
      '深夜emo时间：有些路只能一个人走，但没关系，我们都很勇敢'
    ],
    gossip: [
      '听说隔壁部门的同事要辞职去开奶茶店了，好突然啊...',
      '今天在地铁上听到有人讨论那个热门话题，大家怎么看？',
      '朋友圈有人发了条意味深长的动态，是不是在暗示什么...',
      '最近那个综艺的瓜大家吃了吗？反转也太多了吧🍉',
      '听说那家网红店其实味道一般，全靠营销？',
      '有个人在图书馆占座被怼了，场面一度很尴尬...'
    ]
  };
  const pool = templates[tab] || templates.recommended;
  const count = 6 + Math.floor(Math.random() * 4);
  const posts = [];
  for (let i = 0; i < count; i++) {
    const authorIdx = (i * 3 + Math.floor(Math.random() * 5)) % FORUM_AUTHOR_NAMES.length;
    posts.push({
      id: tab + '-fb-' + Date.now() + '-' + i,
      authorName: FORUM_AUTHOR_NAMES[authorIdx],
      content: pool[i % pool.length],
      time: ['刚刚', '3分钟前', '10分钟前', '半小时前', '1小时前', '2小时前', '今天'][i % 7],
      likes: Math.floor(Math.random() * 300) + 5,
      avatarIndex: authorIdx % FORUM_AVATAR_COUNT,
      commentsList: [],
      handle: '@' + String(FORUM_AUTHOR_NAMES[authorIdx] || '').replace(/\s+/g, '').substring(0, 10).toLowerCase(),
      verified: i < 2
    });
  }
  return posts;
};

app.post('/api/forum/generate', async (req, res) => {
  const { tab, roleName, rolePrompt, recentMessages, memories, worldRole } = req.body || {};
  const validTabs = ['following', 'recommended', 'gossip'];
  const activeTab = validTabs.includes(tab) ? tab : 'recommended';
  try {
    const tabDesc = {
      following: '关注版块：展示用户已有角色关系相关的动态，帖子内容应体现角色之间的互动、情感变化和日常点滴。',
      recommended: '推荐版块：展示来自虚拟世界中各种角色的有趣帖子，内容多样、有生活气息，像小红书和微博的推荐流。',
      gossip: '八卦版块：展示虚拟世界中的传闻、八卦、小道消息，内容有趣味性但不过分攻击。'
    };

    const authorPool = FORUM_AUTHOR_NAMES.join('、');
    const contextInfo = [];
    if (roleName) contextInfo.push('当前用户正在互动的角色是"' + roleName + '"');
    if (worldRole && worldRole.name) {
      contextInfo.push('用户选择了"' + worldRole.name + '"的世界视角，大约20%的帖子应与这个角色或其世界有关联（提及该角色、与其相关的场景、互动、传闻等），其余帖子保持独立内容');
      if (worldRole.prompt) contextInfo.push('角色设定概要：' + String(worldRole.prompt).slice(0, 200));
    }
    if (recentMessages && recentMessages.length > 0) {
      const lastMsg = recentMessages[recentMessages.length - 1];
      if (lastMsg && lastMsg.content) contextInfo.push('最近的对话内容：' + String(lastMsg.content).slice(0, 80));
    }
    if (memories && memories.length > 0) {
      const memTexts = memories.slice(0, 5).map(m => m.content || '').filter(Boolean);
      if (memTexts.length > 0) contextInfo.push('相关记忆：' + memTexts.join('；'));
    }

    const prompt = '你是一个虚拟社区论坛的内容生成器。' + tabDesc[activeTab] + '\n\n' +
      '请生成8条帖子，每条帖子包含：authorName(作者名，从这些名字中随机选择或创作类似的：' + authorPool + ')、content(帖子正文，50-150字，口语化、有生活气息、像真人在社交媒体发的内容)、time(发布时间，如"刚刚"、"5分钟前"、"1小时前")。\n\n' +
      (contextInfo.length > 0 ? '背景信息：\n' + contextInfo.join('\n') + '\n\n' : '') +
      '要求：\n1. 内容风格参考小红书和微博，轻松、真实、有趣\n2. 可以带emoji和话题标签#\n3. 每条帖子长度和风格要有差异\n4. 返回JSON格式：{"posts":[...]}\n5. 不要有任何解释性文字，只返回JSON';

    if (!config.upstreamKey || config.upstreamKey.includes('请填写')) {
      return ok(res, { posts: generateFallbackPosts(activeTab, roleName), tab: activeTab });
    }

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 15000);
    const apiResp = await fetch(config.upstreamBase + '/chat/completions', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + config.upstreamKey },
      signal: controller.signal,
      body: JSON.stringify({
        model: config.upstreamModel,
        stream: false,
        messages: [{ role: 'user', content: prompt }]
      })
    }).finally(() => clearTimeout(timeout));

    if (!apiResp.ok) throw new Error('上游API异常: ' + apiResp.status);
    const apiData = await apiResp.json();
    const rawText = apiData.choices?.[0]?.message?.content || '';

    let posts = [];
    try {
      const jsonMatch = rawText.match(/\{[\s\S]*\}/);
      const parsed = JSON.parse(jsonMatch ? jsonMatch[0] : rawText);
      if (parsed && Array.isArray(parsed.posts)) {
        posts = parsed.posts.slice(0, 12).map((p, idx) => ({
          id: activeTab + '-' + Date.now() + '-' + idx,
          authorName: String(p.authorName || FORUM_AUTHOR_NAMES[idx % FORUM_AUTHOR_NAMES.length]).slice(0, 30),
          content: String(p.content || '').slice(0, 500),
          time: String(p.time || '刚刚').slice(0, 20),
          likes: Math.floor(Math.random() * 500) + 10,
          avatarIndex: idx % FORUM_AVATAR_COUNT,
          commentsList: [],
          handle: '@' + String(p.authorName || '').replace(/\s+/g, '').substring(0, 10).toLowerCase(),
          verified: idx < 2
        }));
      }
    } catch (e) {
      console.warn('Forum JSON parse error:', e.message);
    }

    if (posts.length === 0) posts = generateFallbackPosts(activeTab, roleName);
    ok(res, { posts, tab: activeTab });
  } catch (error) {
    ok(res, { posts: generateFallbackPosts(activeTab, roleName), tab: activeTab, error: error.message });
  }
});

/* === Forum Comment Generation API === */
const FORUM_COMMENT_AUTHORS = [
  '碎碎念bot', '深夜食堂', '柠檬不萌', '星河滚烫', '草莓味晚风',
  '云朵邮局', '人间清醒', '气泡水加冰', '银河系迷路', '温柔半两',
  '海盐焦糖', '落日余晖', '猫薄荷', '今日份快乐', '南风知我意'
];

const generateFallbackComments = (postContent, count) => {
  const templates = [
    '说得太对了！',
    '哇这个好有意思',
    '我也是这么觉得的',
    '哈哈笑死我了',
    '楼主好会说话',
    '已收藏！',
    '这才是真实的生活啊',
    '看完心情变好了',
    '同感同感',
    '可以可以，学到了',
    '这也太真实了吧',
    '楼主继续更新啊'
  ];
  const n = count || (2 + Math.floor(Math.random() * 3));
  const comments = [];
  for (let i = 0; i < n; i++) {
    const authorIdx = Math.floor(Math.random() * FORUM_COMMENT_AUTHORS.length);
    comments.push({
      id: 'c-fb-' + Date.now() + '-' + i,
      authorName: FORUM_COMMENT_AUTHORS[authorIdx],
      content: templates[Math.floor(Math.random() * templates.length)],
      time: ['刚刚', '2分钟前', '5分钟前', '15分钟前', '半小时前'][i % 5],
      avatarIndex: authorIdx % FORUM_AVATAR_COUNT
    });
  }
  return comments;
};

app.post('/api/forum/comments', async (req, res) => {
  const { postContent, postAuthor, tab, count } = req.body || {};
  try {
    const prompt = '你是一个论坛评论区生成器。请为以下帖子生成' + (count || 3) + '条评论。\n\n' +
      '帖子作者：' + (postAuthor || '匿名') + '\n' +
      '帖子内容：' + String(postContent || '').slice(0, 200) + '\n\n' +
      '要求：\n1. 评论风格参考小红书和微博评论区，口语化、真实\n2. 每条评论10-50字\n3. 可以带emoji\n4. 评论要有不同立场和风格（赞同、调侃、追问、分享经历等）\n5. 返回JSON格式：{"comments":[{"authorName":"","content":"","time":""}]}\n6. 只返回JSON，不要解释';

    if (!config.upstreamKey || config.upstreamKey.includes('请填写')) {
      return ok(res, { comments: generateFallbackComments(postContent, count) });
    }

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 12000);
    const apiResp = await fetch(config.upstreamBase + '/chat/completions', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + config.upstreamKey },
      signal: controller.signal,
      body: JSON.stringify({
        model: config.upstreamModel,
        stream: false,
        messages: [{ role: 'user', content: prompt }]
      })
    }).finally(() => clearTimeout(timeout));

    if (!apiResp.ok) throw new Error('上游API异常: ' + apiResp.status);
    const apiData = await apiResp.json();
    const rawText = apiData.choices?.[0]?.message?.content || '';

    let comments = [];
    try {
      const jsonMatch = rawText.match(/\{[\s\S]*\}/);
      const parsed = JSON.parse(jsonMatch ? jsonMatch[0] : rawText);
      if (parsed && Array.isArray(parsed.comments)) {
        comments = parsed.comments.slice(0, 6).map((c, idx) => ({
          id: 'c-ai-' + Date.now() + '-' + idx,
          authorName: String(c.authorName || FORUM_COMMENT_AUTHORS[idx % FORUM_COMMENT_AUTHORS.length]).slice(0, 24),
          content: String(c.content || '').slice(0, 200),
          time: String(c.time || '刚刚').slice(0, 20),
          avatarIndex: (idx + Math.floor(Math.random() * 3)) % FORUM_AVATAR_COUNT
        }));
      }
    } catch (e) {
      console.warn('Comment JSON parse error:', e.message);
    }

    if (comments.length === 0) comments = generateFallbackComments(postContent, count);
    ok(res, { comments });
  } catch (error) {
    ok(res, { comments: generateFallbackComments(postContent, count), error: error.message });
  }
});

/* === Doujin Forum (LOFTER-style creative writing) API === */
const DOUJIN_TAGS = ['原创', '同人', '小说', '散文', '诗歌', '日常', '奇幻', '科幻', '悬疑', '言情'];
const DOUJIN_GRADIENTS = [
  ['#ff9a9e', '#fecfef'], ['#a8edea', '#84fab0'], ['#fbc2eb', '#a18cd1'],
  ['#fad0c4', '#ffd1ff'], ['#a1c4fd', '#c2e9fb'], ['#f093fb', '#f5576c'],
  ['#4facfe', '#00f2fe'], ['#43e97b', '#38f9d7']
];
const DOUJIN_AUTHOR_NAMES = [
  '纸上微光', '青砚', '南柯一梦', '檐下听雨', '半夏',
  '墨色生香', '拾光者', '云中信', '夜航船', '一纸荒唐',
  '沉舟侧畔', '木叶萧萧', '温酒煮茶', '观山海', '旧词新曲'
];

const generateFallbackDoujinWorks = (tag, roleName) => {
  const roleTag = (roleName || '主人公');
  const templates = [
    {
      title: '致一封不会寄出的信',
      excerpt: '有些话，写下来的瞬间就已经完成了它的使命，不必非要抵达谁的案头。',
      content: '我提笔的时候，窗外正下着细雨。墨水在纸上洇开，像一个迟到的拥抱。\n\n写给你的话，其实并不多，翻来覆去就那几句。可我舍不得删，每一句都像是我从日子里偷来的光。你说人为什么要写信呢？大概是因为有些情绪，说出来会散，写下来才能留住。\n\n信叠好放进抽屉的那一刻，我忽然释怀了。这封信不必寄出，因为它早已在落笔的瞬间，抵达了它该去的地方。',
      authorWords: '写给一个再也见不到的人，也写给曾经认真等待的自己。',
      tags: ['散文', '日常']
    },
    {
      title: '春日，与' + roleTag + '同行',
      excerpt: '风把花瓣吹进我们的对话里，那一刻我忽然觉得，春天是可以被装进口袋的。',
      content: '那天我们走得很慢，慢到能听见树叶生长的声音。\n\n' + roleTag + '指着路边的樱花说，你看，它们开得这样用力，好像知道花期短暂。我没接话，只是把落在你肩头的花瓣轻轻拈起。你说这算不算偷了春天的东西，我笑了，说算，那我们就是共犯。\n\n后来的路，我们都没再说话。但沉默里盛满了春天，盛满了那种"此刻真好"的心情。我想，有些同行不必走到终点，走过这段路，本身就已经是答案。',
      authorWords: '愿每一个春天，都有人陪你慢慢走。',
      tags: ['同人', '言情']
    },
    {
      title: '星海拾遗录',
      excerpt: '在所有星球都熄灭之后，我们靠着记忆里的光，继续航行。',
      content: '飞船的能源只够维持最后三次跃迁。我把导航图摊开，上面密密麻麻标着已经消失的坐标。\n\n"我们还能回家吗？"副手问我。我看着舷窗外那片漆黑的星海，忽然想起出发那天，母星的天空也是这样的颜色。我说，能。但我心里清楚，我们要回去的，已经不是同一个地方了。\n\n于是我把那些坐标一个个擦掉，只留下一个新名字。那是我们即将抵达的、尚未被命名的星。我把它叫做"拾遗"——拾起所有遗失的、错过的、来不及说出口的。',
      authorWords: '一个关于失去与重新命名的科幻小故事。',
      tags: ['原创', '科幻']
    },
    {
      title: '巷子尽头的旧书店',
      excerpt: '推开那扇吱呀作响的门，书页翻动的声音里，藏着一桩二十年前的旧事。',
      content: '书店老板姓陈，总是把老花镜推到额头上看人。我来找一本绝版诗集，他却不急着翻找，而是倒了一杯茶推给我。\n\n"那本书，"他说，"上一个来问的人，是二十年前的姑娘。"我心里一动，问他后来呢。他笑了笑，没回答，只是从抽屉深处抽出一本泛黄的诗集，扉页上有一行字：愿你读到时，春天还在。\n\n我付了钱走出书店，回头望，那扇门又吱呀一声合上了。我突然明白，有些故事不是用来讲完的，它就这样停在巷子尽头，等着下一个推开门的人。',
      authorWords: '一本旧书，两段隔着时光的相遇。',
      tags: ['小说', '悬疑']
    },
    {
      title: '深夜的诗',
      excerpt: '我把失眠揉成一行行短句，它们比白天的我更诚实。',
      content: '夜深了\n城市终于安静下来\n只剩下我和一盏不肯熄灭的灯\n\n我把今天没说出口的话\n拆成一行一行\n有的押韵 有的不押\n就像日子 有顺遂 有拧巴\n\n失眠的人啊\n都是不肯和白昼和解的诗人\n我们把心事写进诗里\n再把诗 藏进更深的海里',
      authorWords: '写给所有深夜里不肯睡去的人。',
      tags: ['诗歌']
    },
    {
      title: '雾岭记',
      excerpt: '那座常年被雾笼罩的山岭里，据说住着一位替人守梦的神。',
      content: '老人们说，雾岭上的神不收香火，只收梦。你把做过的梦讲给它听，它就替你守着，等你想起来的时候，再还给你。\n\n我上山那天，雾浓得化不开。我在一块青石前坐下，把自己的梦一个一个讲出来。讲到第三个的时候，雾忽然散了一角，我看见石头上刻着一行字：你遗忘的，我都会替你记得。\n\n下山的时候，我怀里揣着一枚温热的石子。我知道，那些我以为忘了的人和事，原来一直有人替我守着。从此，雾岭在我心里，不再是一座山，而是一个永远不会背弃我的承诺。',
      authorWords: '一个关于记忆与守护的奇幻短篇。',
      tags: ['原创', '奇幻']
    }
  ];

  let pool = templates;
  if (tag && DOUJIN_TAGS.includes(tag)) {
    const filtered = templates.filter(t => t.tags.includes(tag));
    if (filtered.length >= 3) pool = filtered;
  }

  const count = Math.min(6, pool.length);
  const works = [];
  for (let i = 0; i < count; i++) {
    const t = pool[i % pool.length];
    const authorIdx = (i * 2 + Math.floor(Math.random() * 5)) % DOUJIN_AUTHOR_NAMES.length;
    const gradIdx = i % DOUJIN_GRADIENTS.length;
    works.push({
      id: 'doujin-fb-' + Date.now() + '-' + i,
      title: t.title,
      authorName: DOUJIN_AUTHOR_NAMES[authorIdx],
      excerpt: t.excerpt,
      content: t.content,
      authorWords: t.authorWords || '',
      tags: t.tags,
      likes: Math.floor(Math.random() * 2000) + 50,
      collects: Math.floor(Math.random() * 800) + 20,
      comments: Math.floor(Math.random() * 200) + 5,
      avatarIndex: authorIdx % FORUM_AVATAR_COUNT,
      coverGradient: DOUJIN_GRADIENTS[gradIdx]
    });
  }
  return works;
};

const generateFallbackDoujinComments = (workTitle, count) => {
  const templates = [
    '文笔太好了，读完眼眶湿润了。',
    '这一段写得太有画面感，仿佛身临其境。',
    '收藏了，反复读了好几遍，每次都有新感受。',
    '作者的文字有一种治愈的力量，谢谢分享。',
    '那句金句戳中我了，写进心里了。',
    '催更！太喜欢这种风格了，求继续写下去！',
    '读完心里软软的，像被风轻轻拂过。',
    '这样的文字让人愿意慢下来，认真感受生活。',
    '作者好会写，每个字都恰到好处。',
    '共情了，想起自己类似的经历，谢谢作者。'
  ];
  const n = count || (3 + Math.floor(Math.random() * 3));
  const comments = [];
  for (let i = 0; i < n; i++) {
    const authorIdx = Math.floor(Math.random() * DOUJIN_AUTHOR_NAMES.length);
    comments.push({
      id: 'dc-fb-' + Date.now() + '-' + i,
      authorName: DOUJIN_AUTHOR_NAMES[authorIdx],
      content: templates[Math.floor(Math.random() * templates.length)],
      time: ['刚刚', '5分钟前', '20分钟前', '1小时前', '3小时前', '昨天'][i % 6],
      avatarIndex: authorIdx % FORUM_AVATAR_COUNT
    });
  }
  return comments;
};

app.post('/api/forum/doujin/generate', async (req, res) => {
  const { tag, roleName, rolePrompt } = req.body || {};
  try {
    const tagList = DOUJIN_TAGS.join('、');
    const contextInfo = [];
    if (roleName) contextInfo.push('当前用户关注的角色是"' + roleName + '"，部分作品可以以该角色为灵感或主角进行创作。');
    if (rolePrompt) contextInfo.push('角色设定概要：' + String(rolePrompt).slice(0, 200));
    if (tag && DOUJIN_TAGS.includes(tag)) contextInfo.push('本次生成作品的主题标签为"' + tag + '"，作品应贴合该主题。');

    const prompt = '你是一个LOFTER风格的同人创作社区内容生成器，擅长生成有文学性的原创/同人文、散文、诗歌等创作作品。\n\n' +
      '请生成6-8条作品，每条作品包含：\n' +
      '- title(作品标题，文艺有吸引力，10-20字)\n' +
      '- authorName(作者名，从这些名字中随机选择或创作类似的：' + DOUJIN_AUTHOR_NAMES.join('、') + ')\n' +
      '- excerpt(作品摘要/引言，50-100字，能吸引人点开)\n' +
      '- content(作品正文，200-500字，要有文学性、有画面感，像真正的创作)\n' +
      '- authorWords(作者碎碎念/创作感言，0-50字，可空)\n' +
      '- tags(标签数组，从以下中选择1-3个：' + tagList + ')\n\n' +
      (contextInfo.length > 0 ? '创作背景：\n' + contextInfo.join('\n') + '\n\n' : '') +
      '要求：\n1. 风格参考LOFTER，有文学气息，情感细腻，文字有质感\n2. 作品类型要多样：小说片段、散文、诗歌、随笔等\n3. 每条作品的长度和风格要有差异\n4. 返回JSON格式：{"works":[...]}\n5. 不要有任何解释性文字，只返回JSON';

    if (!config.upstreamKey || config.upstreamKey.includes('请填写')) {
      return ok(res, { works: generateFallbackDoujinWorks(tag, roleName), tag: tag || '' });
    }

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 20000);
    const apiResp = await fetch(config.upstreamBase + '/chat/completions', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + config.upstreamKey },
      signal: controller.signal,
      body: JSON.stringify({
        model: config.upstreamModel,
        stream: false,
        messages: [{ role: 'user', content: prompt }]
      })
    }).finally(() => clearTimeout(timeout));

    if (!apiResp.ok) throw new Error('上游API异常: ' + apiResp.status);
    const apiData = await apiResp.json();
    const rawText = apiData.choices?.[0]?.message?.content || '';

    let works = [];
    try {
      const jsonMatch = rawText.match(/\{[\s\S]*\}/);
      const parsed = JSON.parse(jsonMatch ? jsonMatch[0] : rawText);
      if (parsed && Array.isArray(parsed.works)) {
        works = parsed.works.slice(0, 10).map((w, idx) => ({
          id: 'doujin-ai-' + Date.now() + '-' + idx,
          title: String(w.title || '无题').slice(0, 60),
          authorName: String(w.authorName || DOUJIN_AUTHOR_NAMES[idx % DOUJIN_AUTHOR_NAMES.length]).slice(0, 30),
          excerpt: String(w.excerpt || '').slice(0, 200),
          content: String(w.content || '').slice(0, 2000),
          authorWords: String(w.authorWords || '').slice(0, 200),
          tags: Array.isArray(w.tags) ? w.tags.slice(0, 3).map(t => String(t).slice(0, 10)) : [],
          likes: Math.floor(Math.random() * 3000) + 50,
          collects: Math.floor(Math.random() * 1000) + 20,
          comments: Math.floor(Math.random() * 300) + 5,
          avatarIndex: idx % FORUM_AVATAR_COUNT,
          coverGradient: DOUJIN_GRADIENTS[idx % DOUJIN_GRADIENTS.length]
        }));
      }
    } catch (e) {
      console.warn('Doujin works JSON parse error:', e.message);
    }

    if (works.length === 0) works = generateFallbackDoujinWorks(tag, roleName);
    ok(res, { works, tag: tag || '' });
  } catch (error) {
    ok(res, { works: generateFallbackDoujinWorks(tag, roleName), tag: tag || '', error: error.message });
  }
});

app.post('/api/forum/doujin/detail', async (req, res) => {
  const { workId, title, authorName, excerpt } = req.body || {};
  try {
    const prompt = '你是一个LOFTER风格的文学创作生成器。请根据以下作品信息，生成一篇完整的创作正文。\n\n' +
      '作品标题：' + (title || '无题') + '\n' +
      '作者：' + (authorName || '佚名') + '\n' +
      '作品摘要：' + String(excerpt || '').slice(0, 200) + '\n\n' +
      '要求：\n1. 正文长度500-1500字，有文学性、画面感和情感\n2. 风格参考LOFTER创作，细腻、有质感\n3. 可以是小说、散文、随笔等形式\n4. 同时生成一段作者碎碎念(authorWords，0-80字)和1-3个标签(tags)\n5. 标签从以下选择：' + DOUJIN_TAGS.join('、') + '\n6. 返回JSON格式：{"content":"","authorWords":"","tags":[]}\n7. 只返回JSON，不要解释';

    if (!config.upstreamKey || config.upstreamKey.includes('请填写')) {
      return ok(res, { content: String(excerpt || '（这是一篇充满文学气息的创作作品，作者用细腻的笔触描绘了生活中的点滴感动。）').slice(0, 500), authorWords: '', tags: ['原创'] });
    }

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 20000);
    const apiResp = await fetch(config.upstreamBase + '/chat/completions', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + config.upstreamKey },
      signal: controller.signal,
      body: JSON.stringify({
        model: config.upstreamModel,
        stream: false,
        messages: [{ role: 'user', content: prompt }]
      })
    }).finally(() => clearTimeout(timeout));

    if (!apiResp.ok) throw new Error('上游API异常: ' + apiResp.status);
    const apiData = await apiResp.json();
    const rawText = apiData.choices?.[0]?.message?.content || '';

    let detail = null;
    try {
      const jsonMatch = rawText.match(/\{[\s\S]*\}/);
      const parsed = JSON.parse(jsonMatch ? jsonMatch[0] : rawText);
      if (parsed) {
        detail = {
          content: String(parsed.content || '').slice(0, 5000),
          authorWords: String(parsed.authorWords || '').slice(0, 300),
          tags: Array.isArray(parsed.tags) ? parsed.tags.slice(0, 3).map(t => String(t).slice(0, 10)) : []
        };
      }
    } catch (e) {
      console.warn('Doujin detail JSON parse error:', e.message);
    }

    if (!detail) {
      detail = { content: String(excerpt || '（这是一篇充满文学气息的创作作品。）').slice(0, 500), authorWords: '', tags: ['原创'] };
    }
    ok(res, detail);
  } catch (error) {
    ok(res, { content: String(excerpt || '（这是一篇充满文学气息的创作作品。）').slice(0, 500), authorWords: '', tags: ['原创'], error: error.message });
  }
});

app.post('/api/forum/doujin/comments', async (req, res) => {
  const { workTitle, workAuthor, count } = req.body || {};
  try {
    const prompt = '你是一个LOFTER创作社区的评论区生成器。请为以下创作作品生成' + (count || 4) + '条评论。\n\n' +
      '作品标题：' + (workTitle || '无题') + '\n' +
      '作品作者：' + (workAuthor || '佚名') + '\n\n' +
      '要求：\n1. 评论风格参考LOFTER评论区，偏文学性、感性，像真正读过作品后的读者反馈\n2. 可以是赞美文笔、共情共鸣、引用金句、分享感受、催更互动等\n3. 每条评论10-80字，可以带emoji\n4. 评论要有不同的角度和语气\n5. 返回JSON格式：{"comments":[{"authorName":"","content":"","time":""}]}\n6. 只返回JSON，不要解释';

    if (!config.upstreamKey || config.upstreamKey.includes('请填写')) {
      return ok(res, { comments: generateFallbackDoujinComments(workTitle, count) });
    }

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 15000);
    const apiResp = await fetch(config.upstreamBase + '/chat/completions', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + config.upstreamKey },
      signal: controller.signal,
      body: JSON.stringify({
        model: config.upstreamModel,
        stream: false,
        messages: [{ role: 'user', content: prompt }]
      })
    }).finally(() => clearTimeout(timeout));

    if (!apiResp.ok) throw new Error('上游API异常: ' + apiResp.status);
    const apiData = await apiResp.json();
    const rawText = apiData.choices?.[0]?.message?.content || '';

    let comments = [];
    try {
      const jsonMatch = rawText.match(/\{[\s\S]*\}/);
      const parsed = JSON.parse(jsonMatch ? jsonMatch[0] : rawText);
      if (parsed && Array.isArray(parsed.comments)) {
        comments = parsed.comments.slice(0, 8).map((c, idx) => ({
          id: 'dc-ai-' + Date.now() + '-' + idx,
          authorName: String(c.authorName || DOUJIN_AUTHOR_NAMES[idx % DOUJIN_AUTHOR_NAMES.length]).slice(0, 24),
          content: String(c.content || '').slice(0, 300),
          time: String(c.time || '刚刚').slice(0, 20),
          avatarIndex: (idx + Math.floor(Math.random() * 3)) % FORUM_AVATAR_COUNT
        }));
      }
    } catch (e) {
      console.warn('Doujin comments JSON parse error:', e.message);
    }

    if (comments.length === 0) comments = generateFallbackDoujinComments(workTitle, count);
    ok(res, { comments });
  } catch (error) {
    ok(res, { comments: generateFallbackDoujinComments(workTitle, count), error: error.message });
  }
});

/* === User Profile (个人主页) API === */

app.get('/api/profile', (req, res) => {
  const profile = userProfiles.get(req.userId) || { nickname: '体验用户', bio: '', avatar: '' };
  ok(res, profile);
});

app.post('/api/profile', (req, res) => {
  const { nickname, bio, avatar } = req.body || {};
  const profile = {
    nickname: String(nickname || '体验用户').slice(0, 40),
    bio: String(bio || '').slice(0, 500),
    avatar: String(avatar || '').slice(0, 200000),
    updatedAt: new Date().toISOString()
  };
  userProfiles.set(req.userId, profile);
  saveData();
  ok(res, profile, '个人资料已保存');
});

/* === Direct Messages (私信) API === */

app.get('/api/messages', (req, res) => {
  const list = directMessages.get(req.userId) || [];
  ok(res, { list });
});

app.post('/api/messages', (req, res) => {
  const { role, content, fromUser } = req.body || {};
  if (!content || !content.trim()) return fail(res, 400, 4005, '消息内容不能为空。');
  const list = directMessages.get(req.userId) || [];
  const msg = {
    id: randomUUID(),
    role: String(role || 'system').slice(0, 40),
    content: String(content).slice(0, 500),
    fromUser: fromUser !== false,
    createdAt: new Date().toISOString()
  };
  list.unshift(msg);
  if (list.length > 200) list.length = 200;
  directMessages.set(req.userId, list);
  saveData();
  ok(res, msg, '消息已发送');
});

app.delete('/api/messages/:id', (req, res) => {
  const list = directMessages.get(req.userId) || [];
  const filtered = list.filter(m => m.id !== req.params.id);
  if (filtered.length !== list.length) {
    directMessages.set(req.userId, filtered);
    saveData();
  }
  ok(res, { deleted: list.length - filtered.length }, '消息已删除');
});

app.post('/api/messages/reply', async (req, res) => {
  const { role, rolePrompt, userMessage } = req.body || {};
  if (!userMessage || !userMessage.trim()) return fail(res, 400, 4006, '消息内容不能为空。');
  try {
    const sysPrompt = (rolePrompt || '你是一个温柔的角色。') + '\n用户给你发了一条私信，请以角色的语气回复，回复要简短（20-80字），像微信聊天一样自然。';
    if (!config.upstreamKey || config.upstreamKey.includes('请填写')) {
      return ok(res, { reply: '收到你的私信了！' + String(userMessage).slice(0, 20) + '...我会认真看的~' });
    }
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 15000);
    const apiResp = await fetch(config.upstreamBase + '/chat/completions', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + config.upstreamKey },
      signal: controller.signal,
      body: JSON.stringify({
        model: config.upstreamModel,
        stream: false,
        messages: [
          { role: 'system', content: sysPrompt },
          { role: 'user', content: String(userMessage).slice(0, 300) }
        ]
      })
    }).finally(() => clearTimeout(timeout));
    if (!apiResp.ok) throw new Error('上游API异常: ' + apiResp.status);
    const apiData = await apiResp.json();
    const reply = apiData.choices?.[0]?.message?.content || '收到啦~';
    ok(res, { reply: String(reply).slice(0, 200) });
  } catch (error) {
    ok(res, { reply: '抱歉，我现在不太方便回复，稍后再聊~', error: error.message });
  }
});

/* === Novel Game (文游) Module === */

// NOVEL_GAMES_DIR replaced with embedded data
const loadedScripts = new Map();
let designPrinciplesText = '';

/* Load shared design principles (from user templates) and build a text block */
const loadDesignPrinciples = () => {
  try {
    const raw = EMBEDDED_NOVEL_GAMES['_design-principles'] || '{}';
    const data = JSON.parse(typeof raw === 'string' ? raw : JSON.stringify(raw));
    const p = data.principles || {};
    const sections = [
      ['最高铁律', p.ironRules],
      ['世界观底座', p.worldBuilding],
      ['玩家设计', p.playerDesign],
      ['核心玩法循环', p.gameplayLoops],
      ['NPC深度设计', p.npcDesign],
      ['关系系统', p.relationshipSystem],
      ['事件系统', p.eventSystem],
      ['蝴蝶效应', p.butterflyEffect],
      ['节奏与防重复', p.pacing],
      ['行动判定', p.actionResolution],
      ['连续性账本', p.continuityLedger],
      ['每轮输出格式', p.outputFormat],
      ['禁止事项', p.forbidden]
    ];
    let text = '=== 文游通用设计原则（基于创作模板，贯穿全部剧本） ===\n';
    for (const [title, items] of sections) {
      if (!items || !items.length) continue;
      text += `\n【${title}】\n`;
      items.forEach((item, i) => { text += `${i + 1}. ${item}\n`; });
    }
    designPrinciplesText = text;
  } catch (e) { console.warn('加载设计原则失败:', e.message); }
};

const loadNovelScripts = () => {
  try {
    for (const [id, raw] of Object.entries(EMBEDDED_NOVEL_GAMES)) {
      try {
        if (id === '_design-principles') continue;
        const script = typeof raw === 'string' ? JSON.parse(raw) : raw;
        if (script.id && !script._hidden) loadedScripts.set(script.id, script);
      } catch (e) { console.warn('加载剧本失败:', id, e.message); }
    }
  } catch (e) { console.warn('读取剧本目录失败:', e.message); }
};
loadDesignPrinciples();
loadNovelScripts();

app.get('/api/novel-games', (_req, res) => {
  const list = [];
  for (const script of loadedScripts.values()) {
    list.push({
      id: script.id,
      name: script.name,
      category: script.category,
      tags: script.tags,
      difficulty: script.difficulty,
      description: script.description,
      coverGradient: script.coverGradient,
      accentColor: script.accentColor
    });
  }
  ok(res, { list, total: list.length });
});

app.get('/api/novel-games/:id', (req, res) => {
  const script = loadedScripts.get(req.params.id);
  if (!script) return fail(res, 404, 4041, '剧本不存在');
  ok(res, script);
});

app.get('/api/novel-games/saves/list', (req, res) => {
  const list = novelGameSaves.get(req.userId) || [];
  ok(res, { list: list.map(s => ({ id: s.id, scriptId: s.scriptId, scriptName: s.scriptName, playerName: s.player?.name, round: s.round || 0, updatedAt: s.updatedAt })) });
});

app.get('/api/novel-games/save/:saveId', (req, res) => {
  const list = novelGameSaves.get(req.userId) || [];
  const save = list.find(s => s.id === req.params.saveId);
  if (!save) return fail(res, 404, 4042, '存档不存在');
  ok(res, save);
});

app.post('/api/novel-games/save', (req, res) => {
  const { id, scriptId, scriptName, player, state, round, history, currentWorld } = req.body || {};
  if (!scriptId) return fail(res, 400, 4007, '缺少剧本ID');
  const list = novelGameSaves.get(req.userId) || [];
  const existingIndex = list.findIndex(s => s.id === id);
  const newSave = {
    id: id || randomUUID(),
    scriptId,
    scriptName: String(scriptName || '').slice(0, 60),
    player: player || {},
    state: state || {},
    round: Number(round) || 0,
    history: Array.isArray(history) ? history.slice(-100) : [],
    currentWorld: currentWorld || null,
    updatedAt: new Date().toISOString()
  };
  if (existingIndex >= 0) list[existingIndex] = newSave;
  else { list.unshift(newSave); if (list.length > 50) list.length = 50; }
  novelGameSaves.set(req.userId, list);
  saveData();
  ok(res, newSave, '存档已保存');
});

app.delete('/api/novel-games/save/:saveId', (req, res) => {
  const list = novelGameSaves.get(req.userId) || [];
  const filtered = list.filter(s => s.id !== req.params.saveId);
  novelGameSaves.set(req.userId, filtered);
  saveData();
  ok(res, { deleted: list.length - filtered.length }, '存档已删除');
});

/* Build system prompt for novel game round */
const buildNovelGamePrompt = (script, save, playerAction) => {
  const npcBlock = (script.npcs || []).map(n => {
    const s = save.state?.npcs?.[n.id] || {};
    return `【${n.name}】${n.role}\n外貌：${n.appearance}\n性格：${n.surface}\n深层：${n.deep}\n当前对玩家态度：${s.attitude || n.initialAttitude}\n信任度：${s.trust || 0}\n`;
  }).join('\n');

  const statBlock = Object.entries(save.state?.player?.stats || {}).map(([k, v]) => `${k}:${v}`).join(' ');
  const invBlock = (save.state?.player?.inventory || []).join('、');
  const worldInfo = save.currentWorld ? script.worlds?.find(w => w.id === save.currentWorld) : null;

  let prompt = script.systemPrompt || '';
  if (designPrinciplesText) {
    prompt = designPrinciplesText + '\n\n' + prompt;
  }
  prompt += '\n\n【当前游戏状态】\n';
  prompt += `剧本：${script.name}\n`;
  if (worldInfo) prompt += `当前世界：${worldInfo.name}（${worldInfo.level}）\n${worldInfo.setting}\n目标：${worldInfo.objective}\n`;
  prompt += `玩家：${save.player?.name || '未命名'}\n`;
  prompt += `属性：${statBlock}\n`;
  if (invBlock) prompt += `背包：${invBlock}\n`;
  prompt += `轮次：第${save.round || 0}轮\n`;
  if (save.history && save.history.length > 0) {
    prompt += '\n【最近剧情摘要】\n';
    prompt += save.history.slice(-5).map((h, i) => `${i + 1}. ${h.summary || h.action || '...'}`).join('\n');
  }
  prompt += '\n\n【NPC状态】\n' + npcBlock;
  if (save.state?.pendingEvents?.length) {
    prompt += '\n\n【待处理事项】\n' + save.state.pendingEvents.slice(-5).join('\n');
  }
  prompt += `\n\n【玩家本轮行动】\n${playerAction}\n\n请根据以上信息生成本轮游戏内容。`;
  return prompt;
};

/* Parse stat changes from AI reply */
const parseStatChanges = (text) => {
  const changes = [];
  const regex = /\[\s*([^\]]+?)\s*([\+\-]\d+)\s*\]/g;
  let match;
  while ((match = regex.exec(text)) !== null) {
    changes.push({ stat: match[1].trim(), delta: Number(match[2]) });
  }
  return changes;
};

app.post('/api/novel-games/action', async (req, res) => {
  const { saveId, action, customAction } = req.body || {};
  if (!saveId) return fail(res, 400, 4008, '缺少存档ID');
  const list = novelGameSaves.get(req.userId) || [];
  const save = list.find(s => s.id === saveId);
  if (!save) return fail(res, 404, 4043, '存档不存在');

  const script = loadedScripts.get(save.scriptId);
  if (!script) return fail(res, 404, 4044, '剧本不存在');

  const playerAction = customAction || action || '继续探索';
  const sysPrompt = buildNovelGamePrompt(script, save, playerAction);

  try {
    if (!config.upstreamKey || config.upstreamKey.includes('请填写')) {
      return ok(res, {
        content: `【第${(save.round || 0) + 1}轮】\n\n你选择了：${playerAction}\n\n（AI服务未配置，无法生成剧情。请在.env中配置UPSTREAM_API_KEY）\n\n【可选行动】\n1. 继续探索\n2. 与NPC交谈\n3. 查看背包\n4. 休息恢复\n5. 【自定义行动】`,
        statChanges: [],
        round: (save.round || 0) + 1
      });
    }

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 60000);
    const apiResp = await fetch(config.upstreamBase + '/chat/completions', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + config.upstreamKey },
      signal: controller.signal,
      body: JSON.stringify({
        model: config.upstreamModel,
        stream: false,
        messages: [
          { role: 'system', content: sysPrompt },
          { role: 'user', content: playerAction }
        ]
      })
    }).finally(() => clearTimeout(timeout));

    if (!apiResp.ok) throw new Error('上游API异常: ' + apiResp.status);
    const apiData = await apiResp.json();
    const content = apiData.choices?.[0]?.message?.content || 'AI生成内容为空';
    const statChanges = parseStatChanges(content);

    ok(res, { content, statChanges, round: (save.round || 0) + 1 });
  } catch (error) {
    ok(res, { content: '剧情生成失败：' + error.message + '\n\n请重试或检查AI服务配置。', statChanges: [], round: save.round || 0, error: error.message });
  }
});

app.post('/api/novel-games/apply-changes', (req, res) => {
  const { saveId, changes, historyEntry } = req.body || {};
  if (!saveId) return fail(res, 400, 4009, '缺少存档ID');
  const list = novelGameSaves.get(req.userId) || [];
  const save = list.find(s => s.id === saveId);
  if (!save) return fail(res, 404, 4045, '存档不存在');

  if (!save.state) save.state = {};
  if (!save.state.player) save.state.player = {};
  if (!save.state.player.stats) save.state.player.stats = {};
  if (!save.state.npcs) save.state.npcs = {};

  if (changes) {
    for (const c of changes) {
      if (c.npcId && c.stat === 'trust') {
        if (!save.state.npcs[c.npcId]) save.state.npcs[c.npcId] = {};
        save.state.npcs[c.npcId].trust = (save.state.npcs[c.npcId].trust || 0) + c.delta;
      } else if (c.stat) {
        const current = Number(save.state.player.stats[c.stat]) || 0;
        save.state.player.stats[c.stat] = current + c.delta;
      }
    }
  }

  save.round = (save.round || 0) + 1;
  if (historyEntry) {
    if (!save.history) save.history = [];
    save.history.push(historyEntry);
    if (save.history.length > 100) save.history = save.history.slice(-100);
  }
  save.updatedAt = new Date().toISOString();

  const idx = list.findIndex(s => s.id === saveId);
  if (idx >= 0) list[idx] = save;
  novelGameSaves.set(req.userId, list);
  saveData();

  ok(res, save, '状态已更新');
});

app.listen(PORT, HOST, () => console.log(`Mochi-phone 已启动：http://localhost:${PORT}`));
