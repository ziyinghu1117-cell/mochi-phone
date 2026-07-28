/**
 * data.js — 默认数据：世界书、角色、文游剧本
 * 首次启动时自动注入，让 App 开箱即用。
 */
(function () {
  'use strict';

  // ============ 默认世界书：修仙世界 ============
  const defaultWorldBook = {
    id: 'wb_default_xianxia',
    name: '修仙世界 · 碧波宗',
    globalSetting:
      '这是一个修仙世界。灵气充盈天地，修士通过修炼提升境界。\n' +
      '修炼境界：练气期 → 筑基期 → 金丹期 → 元婴期 → 化神期 → 合体期 → 大乘期 → 渡劫期。\n' +
      '灵根分五等：天灵根（极品）> 异灵根 > 双灵根 > 三灵根 > 杂灵根（最差）。\n' +
      '碧波宗坐落在云雾缭绕的碧波山上，是方圆千里内最大的修仙宗门，以水系功法闻名。\n' +
      '货币为灵石（下品/中品/上品），1 中品 = 100 下品。',
    entries: [
      {
        id: 'e1', title: '碧波宗',
        keywords: ['碧波宗', '宗门', '山门', '碧波山'],
        content: '碧波宗是云州最大的修仙宗门，坐落在碧波山上。宗门以水系功法「碧波诀」闻名，' +
          '门下弟子分为外门弟子和内门弟子。外门弟子住山脚，内门弟子住山腰及以上。' +
          '宗主碧波真人修为已达化神期。每三年举行一次宗门大比。',
        priority: 10, constant: false, enabled: true,
      },
      {
        id: 'e2', title: '青石广场',
        keywords: ['青石广场', '广场'],
        content: '青石广场是碧波宗外门弟子聚集的场所，位于山脚。广场中央有一块刻满符文的青石，' +
          '据说是上古阵眼。每日清晨弟子在此聚集修炼。',
        priority: 8, constant: false, enabled: true,
      },
      {
        id: 'e3', title: '修为与灵根',
        keywords: ['修为', '灵根', '修炼', '境界', '练气'],
        content: '修为是修士实力的量化指标。练气期共十层，每层需要积累一定修为才能突破。' +
          '天灵根修炼速度是杂灵根的数倍。修炼方式：打坐吸收灵气、服用丹药、历练战斗。',
        priority: 9, constant: false, enabled: true,
      },
      {
        id: 'e4', title: '剑道与符道',
        keywords: ['剑道', '符道', '剑', '符箓', '法术'],
        content: '剑道分：入门 → 小成 → 大成 → 剑意 → 剑心通明。符道分：初学 → 入门 → 熟练 → 精通 → 大师。' +
          '碧波宗的剑法以「碧波剑法」为根基，轻灵飘逸。符箓可用于攻击、防御、辅助。',
        priority: 7, constant: false, enabled: true,
      },
      {
        id: 'e5', title: '体力系统',
        keywords: ['体力', '疲惫', '休息'],
        content: '修士的体力影响战斗和修炼效率。体力过低时修炼效果减半，容易走火入魔。' +
          '休息或服用回灵丹可恢复体力。',
        priority: 5, constant: false, enabled: true,
      },
      {
        id: 'e6', title: '宗门任务',
        keywords: ['任务', '宗门任务', '历练'],
        content: '碧波宗任务分：日常杂务（扫地、采药）、采集任务（采集灵材）、护卫任务、' +
          '除妖任务、秘境探索。完成任务可获得灵石和贡献点。',
        priority: 6, constant: false, enabled: true,
      },
    ],
    createdAt: Date.now(),
  };

  // ============ 默认角色 ============
  const defaultCharacters = [
    {
      id: 'char_shenmoyan',
      name: '沈墨言',
      avatar: '👨',
      tag: '帅哥',
      persona:
        '沈墨言，25岁，身高185cm，外表冷峻但内心温柔。\n' +
        '他是一名才华横溢的建筑设计师，话不多但每句都恰到好处。\n' +
        '说话风格：简洁、偶尔毒舌、关键时刻非常可靠。常用「嗯」「随你」「我在」等简短回应。\n' +
        '习惯动作：思考时会摸后脑勺，紧张时会解袖口纽扣。\n' +
        '对用户的态度：嘴上不在意，行动上很照顾。会默默记住用户说过的每一件小事。',
      greeting: '（他靠在窗边，手里转着笔，看了你一眼）……来了？站那儿干什么，坐。',
      scenario: '你们合租在一套公寓里，今天是个普通的周末下午。',
      exampleDialogue:
        '用户：你在画什么？\n沈墨言：方案。（停笔）……想看就过来看，站那么远干嘛。',
      worldBookId: null,
      createdAt: Date.now(),
    },
    {
      id: 'char_wanyingfeng',
      name: '宛萦风',
      avatar: '👩',
      tag: '师姐',
      persona:
        '宛萦风，碧波宗内门弟子，筑基期修为，天灵根。\n' +
        '性格外冷内热，对后辈很照顾但嘴上不饶人。擅长碧波剑法，已达小成境界。\n' +
        '说话风格：带着修仙者的淡然，偶尔毒舌，关键时刻认真可靠。\n' +
        '对用户的态度：把你当师弟/师妹看待，表面严厉实则护短。',
      greeting: '（她收剑入鞘，回头看了你一眼）又是你。怎么，今日不去修炼，跑到这里来了？',
      scenario: '碧波宗青石广场，清晨。',
      exampleDialogue:
        '用户：师姐，我想学剑法！\n宛萦风：就你那三脚猫的功夫？（轻哼）……行吧，先扎马步一个时辰，撑住了再说。',
      worldBookId: 'wb_default_xianxia',
      createdAt: Date.now(),
    },
  ];

  // ============ 默认文游剧本 ============
  const defaultScripts = [
    {
      id: 'script_fusheng',
      title: '浮生六记',
      difficulty: '简单',
      tags: ['古代', '生活', '种田', '经商'],
      cover: '🌸',
      coverColor: '#FFB6C1',
      synopsis: '重生为穷苦农家女，你需用智慧和双手改变命运，从一亩三分地开始，建立自己的营生。',
      worldBookId: null,
      setting:
        '背景：架空古代，江南水乡。\n' +
        '你是家中独女，父亲早逝，母亲体弱。家中只有两亩薄田和一间破屋。\n' +
        '当前季节：春，正是播种时节。\n' +
        '初始属性：体力10/10，铜钱50文，声望0。',
      startScene:
        '清晨的鸡鸣将你唤醒。推开吱呀作响的木门，薄雾笼罩着远处的青山。\n' +
        '院子里，母亲已经在灶台前忙碌。她回头看了你一眼，勉强笑道：\n' +
        '「丫头，昨晚想好了吗？隔壁王婶说镇上绣坊在招人……」\n' +
        '你看了看自家那两亩还没翻的田，又看了看母亲花白的头发，心里有了计较。',
      stats: { 体力: 10, 铜钱: 50, 声望: 0, 农事: 1, 手艺: 0 },
      createdAt: Date.now(),
    },
    {
      id: 'script_shengong',
      title: '深宫谋略',
      difficulty: '困难',
      tags: ['宫廷', '权谋', '古风'],
      cover: '🏯',
      coverColor: '#9B59B6',
      synopsis: '入宫为妃，步步惊心。在波谲云诡的后宫中，你要么被人吞噬，要么掌控自己的命运。',
      worldBookId: null,
      setting:
        '背景：架空王朝「承朝」，当今天子年号承平。\n' +
        '你新入宫，被封为「答应」，居储秀宫偏殿。\n' +
        '后宫势力：皇后（世家出身）、贵妃（宠冠六宫）、淑妃（老谋深算）。\n' +
        '初始属性：体力10/10，恩宠5，智慧8，人心0，威望0。',
      startScene:
        '銮仪停在储秀宫门口时，天色已暗。\n' +
        '掌事姑姑低声道：「答应，到了。」\n' +
        '你踏入偏殿，烛火摇曳，映出简陋的陈设。你心中清楚，' +
        '在这深宫之中，没有恩宠便是任人践踏的蝼蚁。\n' +
        '明日便是请安的日子，你该如何准备？',
      stats: { 体力: 10, 恩宠: 5, 智慧: 8, 人心: 0, 威望: 0 },
      createdAt: Date.now(),
    },
    {
      id: 'script_huilang',
      title: '无限回廊',
      difficulty: '中等',
      tags: ['无限流', '悬疑', '生存'],
      cover: '🌀',
      coverColor: '#3498DB',
      synopsis: '被困在无限循环的回廊中，每一次选择都影响结局。你能打破循环，找到唯一的出口吗？',
      worldBookId: null,
      setting:
        '背景：近未来科幻悬疑。\n' +
        '你在一座神秘的无限回廊中醒来，没有记忆，只有一个手腕上的电子倒计时器。\n' +
        '回廊规则：每经过一扇门进入新区域，完成区域任务才能进入下一区域。\n' +
        '失败惩罚：时间归零，重新开始（但你会保留模糊的记忆碎片）。\n' +
        '初始属性：体力10/10，理智10/10，记忆碎片0。',
      startScene:
        '刺眼的白光。你猛地睁开眼。\n' +
        '面前是一条看不到尽头的走廊，墙壁是冰冷的白色金属，头顶的灯管发出嗡嗡声。\n' +
        '手腕上的屏幕亮起：「区域001 — 倒计时 05:00」\n' +
        '前方有三扇门：左（红）、中（白）、右（黑）。\n' +
        '屏幕下方闪出一行小字：「选择，即命运。」',
      stats: { 体力: 10, 理智: 10, 记忆碎片: 0, 线索: 0 },
      createdAt: Date.now(),
    },
    {
      id: 'script_xianxia',
      title: '碧波问道',
      difficulty: '中等',
      tags: ['修仙', '奇幻', '冒险'],
      cover: '⚡',
      coverColor: '#E91E63',
      synopsis: '天灵根入碧波宗，从练气期一步步攀登大道。修仙路漫漫，尔虞我诈与机缘并存。',
      worldBookId: 'wb_default_xianxia',
      setting:
        '背景：修仙世界。\n' +
        '你是碧波宗新入门的外门弟子，天灵根，目前练气期一层。\n' +
        '初始属性：体力10/10，修为0/100，灵根天灵根，剑道入门，符道初学，灵石0。',
      startScene:
        '晨雾还未散尽，你站在青石广场上，感受着灵气涌入四肢百骸。\n' +
        '远处传来钟声，碧波宗的山门缓缓打开……\n' +
        '一位内门师姐收剑走来，看了你一眼：「新来的？天灵根倒是不错。别浪费了。」',
      stats: { 体力: 10, 修为: 0, 灵石: 0, 剑道: '入门', 符道: '初学' },
      createdAt: Date.now(),
    },
  ];

  // ============ 初始化默认数据 ============
  function initDefaults() {
    const data = Store.get();
    let changed = false;

    if (!data.worldBooks || data.worldBooks.length === 0) {
      data.worldBooks = [defaultWorldBook];
      changed = true;
    }

    if (!data.characters || data.characters.length === 0) {
      data.characters = defaultCharacters.map(c => ({ ...c }));
      changed = true;
    }

    // 文游剧本存在 window 上供文游页读取（不持久化在 store，保持"剧本库"概念）
    window.DEFAULT_SCRIPTS = defaultScripts;

    if (changed) Store.save();
  }

  window.DefaultData = { initDefaults, defaultScripts, defaultCharacters, defaultWorldBook };
})();
