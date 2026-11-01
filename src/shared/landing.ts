/**
 * 理论主张的落点表。
 *
 * 这张表回答一个问题：**一条主张在软件里变成了什么。**
 *
 * 为什么单独立一张表，而不是给每条主张加个字段：
 * 一、格式统一才能校验。落点写成一个可解析的 ref，检查器就能验它存在；
 *    写成一句自然语言（「在 analyze 里」），谁也验不了，两年后改坏了没人知道。
 * 二、一张表能看全。分布本身是信息：哪一编全落在提示词上、哪一编只有边界栏撑着，
 *    摊在一屏里看得见，散在 96 个对象里看不见。
 *
 * 这张表出现的原因（第十三到十七轮的反省）：
 * 07 文档把 70 条标成「行为层」。那个词把两种完全不同的情况混在一起——
 * 真的有提示词指令（只是没有对应字段），和根本没有落点（只有库里那一行字）。
 * 混着的后果是：一批「装饰性条目」藏在一个听起来中性的词下面，
 * 而库自己写着「指不出落点的就不该进这个库」。这张表把那句话执行掉。
 *
 * ref 语法（检查器 check:landing 按这四种解析）：
 *   block:<块 id>            提示词内核块，如 block:core.gate-four
 *   lens:<理论>/<部分>       透镜片段，部分取 worldview|procedure|rules|scopeGuard|checksSpec|lensShape|index
 *   code:<文件>#<标识符>     源码里的函数/类型/常量，文件相对项目根，如 code:src/main/analyze.ts#resolveSupports
 *   ui:<组件>#<区块 id>      界面区块，如 ui:Diagnosis.tsx#sec-limits
 *
 * 硬规矩（check:landing 会验）：
 *   1. 每条主张至少一个落点。一条都没有的，要么补落点，要么从库里删掉——
 *      留在这里只会让「96 条」这个数字虚胖。
 *   2. ref 必须真的存在。块改名、函数改名、区块改名，这里没跟着改就报错。
 *   3. at 必须具体到能被反驳。写「影响报告措辞」不算，写「结论字段存主张句而非主题」才算。
 */
export type LandKind = 'block' | 'lens' | 'code' | 'ui';

export interface Land {
  k: LandKind;
  ref: string;
  /** 这条主张在那一处变成了什么动作。一句话，具体到能被反驳。 */
  at: string;
}

export const LANDING: Record<string, Land[]> = {
  /* ── 一 · 论证是什么 ── */
  'T1-01': [
    { k: 'ui', ref: 'Diagnosis.tsx#sec-structure', at: '结构与语境分成两栏，结论与前提画进结构图，这段话在做什么进语境栏' },
    { k: 'code', ref: 'src/shared/types.ts#Diagnosis', at: '结构字段与 context.issue 并存，不合并成一个「大意」' },
  ],
  'T1-02': [
    { k: 'block', ref: 'core.three-never', at: '第三条：抒情、提问、纯陈述、口号、命令都不是论证，照实说它是什么' },
    { k: 'code', ref: 'src/main/analyze.ts#normalizeDiagnosis', at: 'applicable 为假时检查项为空，不补结论与前提' },
  ],
  'T1-03': [
    { k: 'code', ref: 'src/main/analyze.ts#LEVELS', at: '档位只有 withstands/weakened/fails/undetermined 四值，没有分数栏' },
    { k: 'ui', ref: 'Diagnosis.tsx#sec-verdict', at: '判定给档位并写明撤回条件，不给对错二元' },
  ],
  'T1-04': [
    { k: 'ui', ref: 'Diagnosis.tsx#sec-lens', at: '一次只呈现一副透镜的判定，界面上没有总分栏，透镜冲突照实并列' },
  ],
  'T1-05': [
    { k: 'code', ref: 'src/shared/types.ts#Conclusion', at: '结论存主张句（他要你信的那句），不存主题；结构图右端照此标注' },
  ],
  'T1-06': [
    { k: 'code', ref: 'src/shared/types.ts#LensDetail', at: 'lens.applicable 单独存在：一副透镜可判不适用，而整篇仍照常出报告' },
  ],
  'T1-07': [
    { k: 'code', ref: 'src/main/analyze.ts#resolveSupports', at: 'supports 解析成多对一链；断一条只减它自己那份支撑，不连坐' },
  ],
  'T1-08': [
    { k: 'code', ref: 'src/main/analyze.ts#normalizeClaim', at: 'implicit=true 时必须给 implicitBasis，缺了记诊断，不静默补白' },
  ],

  /* ── 二 · 好论证凭什么 ── */
  'T2-01': [
    { k: 'ui', ref: 'Diagnosis.tsx#sec-lens', at: '每副透镜报自己的系统名与尺子，冲突不调和、不取平均' },
  ],
  'T2-02': [
    { k: 'block', ref: 'core.gate-four', at: '交付前四道检查按漏斗顺序问；前一关未过时写明「未评」，跳过必须留痕' },
  ],
  'T2-03': [
    { k: 'ui', ref: 'Diagnosis.tsx#sec-defeat', at: '击败因素与反证各自成块，不并进「充分性」一项打分' },
  ],
  'T2-04': [
    { k: 'ui', ref: 'Diagnosis.tsx#sec-checks', at: '可接受性一栏同时写状态与「对谁可接受」，不只写一个词' },
  ],
  'T2-05': [
    { k: 'ui', ref: 'Diagnosis.tsx#sec-checks', at: '接受性拆三问分别作答：本身可信、有无独立支持、是否落在共同起点内' },
  ],
  'T2-06': [
    { k: 'lens', ref: 'ars/rules', at: '「判充分性前必须写出论证负担；写不出负担，充分性写无法判定并说明原因」' },
  ],
  'T2-07': [
    { k: 'code', ref: 'src/shared/types.ts#Claim', at: 'claim.burden 是字段；推卸责任记「未建立」，不记「已推翻」' },
  ],
  'T2-08': [
    { k: 'lens', ref: 'ars/checksSpec', at: '充分性一栏输出「在该负担下够不够」，不输出绝对化的够/不够' },
  ],
  'T2-09': [
    { k: 'code', ref: 'src/shared/types.ts#DefeatKind', at: 'undermining 与 rebutting 两型分开存，削弱不写成「论证不成立」' },
  ],
  'T2-10': [
    { k: 'code', ref: 'src/shared/types.ts#withdrawIf', at: 'selfCheck.withdrawIf 是必填字段，报告末尾照出「什么情况下该撤回」' },
  ],
  'T2-11': [
    { k: 'lens', ref: 'ars/rules', at: '「三项标准各自独立评级，不许合成总分」' },
  ],

  /* ── 三 · 型式的认识论 ── */
  'T3-01': [
    { k: 'lens', ref: 'walton/index', at: '型式表作检索材料附后；认不出写 none，型式名不进结论' },
  ],
  'T3-02': [
    { k: 'lens', ref: 'walton/checksSpec', at: '检查项由所选型式的那组 CQ 逐条展开，不另立通用清单' },
  ],
  'T3-03': [
    { k: 'code', ref: 'src/shared/types.ts#SchemeDefinition', at: 'criticalQuestions 每条必须带 why——写不出守哪一环的 CQ 进不了库' },
  ],
  'T3-04': [
    { k: 'code', ref: 'src/shared/limits.ts#limitsOf', at: '边界栏第一条明写不设动机字段：型式误用与故意误导在框架内分不开' },
  ],
  'T3-05': [
    { k: 'lens', ref: 'walton/lensShape', at: 'lens 对象里型式只出现在候选字段，不参与 level 计算' },
  ],
  'T3-06': [
    { k: 'lens', ref: 'walton/procedure', at: '判定顺序把 meta 类 CQ 排在最前；命中即改判适用性' },
  ],
  'T3-07': [
    { k: 'code', ref: 'src/shared/topics.ts#topicsOf', at: '类比栏第一问是「差异是否切断担保」，不数相似点' },
  ],
  'T3-08': [
    { k: 'code', ref: 'src/shared/topics.ts#topicsOf', at: '因果栏三问含「还有什么也能解释它」——相关不等于因果的操作形式' },
  ],
  'T3-09': [
    { k: 'code', ref: 'src/shared/topics.ts#topicsOf', at: '统计项问样本怎么来的、基数多大、跟什么比；第三问最常被省略' },
  ],
  'T3-10': [
    { k: 'code', ref: 'src/shared/topics.ts#topicsOf', at: '来源栏按领域内、引用真实、有共识、无利益冲突四条展开' },
  ],
  'T3-11': [
    { k: 'code', ref: 'src/shared/topics.ts#topicsOf', at: '实践推理栏三问是替代方案、副作用、价值排序，动机不在其中' },
  ],
  'T3-12': [
    { k: 'code', ref: 'src/shared/topics.ts#topicsOf', at: '定义栏只问一句：这个词的含义从前提走到结论变过没有' },
  ],
  'T3-13': [
    { k: 'code', ref: 'src/shared/topics.ts#topicsOf', at: '类比栏的举证负担写给提出方：一个落在担保上的差异就够' },
  ],
  'T3-14': [
    { k: 'code', ref: 'src/main/kb/schemes.ts#argument-from-precedent', at: '先例与类比在型式库里是两条，分开识别，合并会把两类担保混成一个' },
  ],
  'T3-15': [
    { k: 'code', ref: 'src/main/kb/schemes.ts#correlation-causation', at: '相关—因果与因果—效果分列两条：前者要排除替代解释，后者要交代机制' },
  ],
  'T3-16': [
    { k: 'code', ref: 'src/main/kb/schemes.ts#position-to-know', at: '亲历与专家分列两条：前者查看不看得见，后者查领域、共识、利益' },
  ],
  'T3-17': [
    { k: 'code', ref: 'src/main/kb/schemes.ts#practical-basic', at: '实践推理的 CQ 里有替代方案与副作用，没有「结论是否为真」' },
  ],
  'T3-18': [
    { k: 'code', ref: 'src/shared/types.ts#PtaStatementType', at: 'policy 与 value 分开计：政策命题缺可行性前提时判未定' },
  ],

  /* ── 四 · 语境 ── */
  'T4-01': [
    { k: 'lens', ref: 'pragma/scopeGuard', at: 'aimedAtResolution 为假时整副透镜判不适用，不硬判——全应用最严的一道范围门' },
  ],
  'T4-02': [
    { k: 'lens', ref: 'pragma/rules', at: '规则按已判定的对话类型取用；同一招式在不同类型下结论不同' },
  ],
  'T4-03': [
    { k: 'ui', ref: 'Diagnosis.tsx#sec-checks', at: '可接受性判定必须带「对谁」；受众未定时照实写判不动' },
  ],
  'T4-04': [
    { k: 'code', ref: 'src/shared/types.ts#Claim', at: 'burden 由语境字段推出，代码里不写死一张固定的责任表' },
  ],
  'T4-05': [
    { k: 'lens', ref: 'pragma/scopeGuard', at: 'opposingPosition 为空时整副判不适用，不许凑满十项' },
  ],
  'T4-06': [
    { k: 'code', ref: 'src/shared/topics.ts#topicsOf', at: '预设栏单列一问：这一问里藏着哪个假定' },
  ],
  'T4-07': [
    { k: 'code', ref: 'src/shared/types.ts#Context', at: 'audienceKind 是字段，决定可接受性的偏置方向；判不出写 unknown' },
  ],
  'T4-08': [
    { k: 'code', ref: 'src/main/prompt/registry.ts#userTemplateFor', at: 'user 模板第 5 条：判对话类型前先想清是不是共同求解，说服不是默认值' },
  ],
  'T4-09': [
    { k: 'code', ref: 'src/shared/topics.ts#topicsOf', at: '预设栏也扫名词化与限定词；扫不到也照列，并写明依据强弱' },
  ],
  'T4-10': [
    { k: 'block', ref: 'q.answerable', at: '管「这个问题本身能不能答」，答不了要说清缺什么' },
    { k: 'block', ref: 'q.language', at: '管「有没有夹带未经同意的假定」——与上一块分开，因为毛病不同' },
  ],

  /* ── 五 · 谬误 ── */
  'T5-01': [
    { k: 'lens', ref: 'copi/lensShape', at: '名录透镜 verdict 恒 undetermined、whatIsRefuted 恒 nothing：只给对照，不给结论' },
  ],
  'T5-02': [
    { k: 'lens', ref: 'copi/rules', at: '同一违规有多个名字时并列写出，不选一个「最对的」' },
  ],
  'T5-03': [
    { k: 'code', ref: 'src/main/kb/fallacies.ts#whenLegitimate', at: 'whenLegitimate 是条目必填；命名前先排除「此处合法」' },
  ],
  'T5-04': [
    { k: 'lens', ref: 'copi/rules', at: '命名须过三道门槛：条件齐备、无更简解释、此处合法已排除' },
  ],
  'T5-05': [
    { k: 'lens', ref: 'copi/rules', at: '解释错误优先给启发式捷径，不把错误一律读成故意' },
  ],
  'T5-06': [
    { k: 'lens', ref: 'copi/index', at: '针对人身加第四条元问题：打折依据是具体条件还是身份特征' },
  ],
  'T5-07': [
    { k: 'lens', ref: 'copi/rules', at: '给「滑坡」候选时必须写明断在哪一环；写不出按凭空断言处理' },
  ],
  'T5-08': [
    { k: 'code', ref: 'src/shared/topics.ts#topicsOf', at: '利益冲突成立时输出的是「该核查」，不是「该不信」' },
  ],
  'T5-09': [
    { k: 'code', ref: 'src/shared/topics.ts#topicsOf', at: '只认一词多义那一种含混；模糊与笼统不标，否则命名变噪音' },
  ],
  'T5-10': [
    { k: 'code', ref: 'src/main/kb/schemes.ts#verbal-classification', at: '按类属下判断的 CQ 问类属与属性，不问定义是否精确' },
  ],

  /* ── 六 · 机器能做什么 ── */
  'T6-01': [
    { k: 'code', ref: 'src/main/analyze.ts#CONFS', at: 'confidence 只有五档取值；报告里不出现「已证明」一类措辞' },
  ],
  'T6-02': [
    { k: 'block', ref: 'core.credibility', at: '涉及可信度、身份、动机的判断走单独一块：分不清具体条件与身份特征就退回此处合法' },
  ],
  'T6-03': [
    { k: 'code', ref: 'src/main/analyze.ts#normalizeDiagnosis', at: '模型输出不是最终结果：过归一化、去重、守卫才落屏' },
  ],
  'T6-04': [
    { k: 'code', ref: 'src/main/prompt/registry.ts#SAMPLING', at: '按模式给温度上限，诊断 0.2；用户设置只能往低处调' },
  ],
  'T6-05': [
    { k: 'ui', ref: 'Diagnosis.tsx#sec-verdict', at: '档位、此处合法、本工具站哪边、争议四样并列输出，不合并成一句结论' },
  ],
  'T6-06': [
    { k: 'code', ref: 'src/shared/segment.ts#worthSegmenting', at: '长文先切分再逐段分析；切分是本地启发式，给出切点与依据' },
  ],
  'T6-07': [
    { k: 'code', ref: 'src/main/prompt/registry.ts#PROMPT_VERSION', at: '提示词带版本与指纹，随每份报告落盘；旧存档不回填假版本' },
  ],
  'T6-08': [
    { k: 'code', ref: 'src/main/analyze.ts#repairMessage', at: '解析失败回喂一次，只声明修格式；第二次仍失败照常记用量' },
  ],

  /* ── 七 · 理论到代码 ── */
  'T7-01': [
    { k: 'code', ref: 'src/shared/theory-base.ts#TheoryClaim', at: 'decides 是必填字段；本表（landing.ts）把「指得出」从纸面要求变成可校验的 ref' },
  ],
  'T7-02': [
    { k: 'code', ref: 'src/main/analyze.ts#normalizeDiagnosis', at: '程序层裁决在模型输出之后执行：模型说了不算' },
  ],
  'T7-03': [
    { k: 'code', ref: 'src/shared/theory-base.ts#EvidenceTier', at: 'A/B/C 三档与 tag、confidence 是同一条纪律在三个层面的执行' },
  ],
  'T7-04': [
    { k: 'ui', ref: 'Diagnosis.tsx#sec-lens', at: '每副透镜带 blind 栏：写清它看不见什么，而不是宣称全面' },
  ],
  'T7-05': [
    { k: 'code', ref: 'src/shared/types.ts#normalizeMode', at: '模式不认识不降级成诊断；不给档位的模式强制 undetermined 并写诊断留痕' },
  ],
  'T7-06': [
    { k: 'code', ref: 'scripts/check-theory.ts#warn', at: '断言收集进 errors，非空即失败；各检查器带下限断言，删条目会让总数断言响' },
  ],
  'T7-07': [
    { k: 'code', ref: 'src/shared/topics.ts#topicsOf', at: '专题、对照、边界、争议命中全部本地算，不进提示词、不加 token' },
  ],

  /* ── 八 · 批判性思维 ── */
  'T8-01': [
    { k: 'code', ref: 'src/shared/limits.ts#limitsOf', at: '边界栏第一组写明解读只代劳一半、自我校准完全不代劳' },
  ],
  'T8-02': [
    { k: 'code', ref: 'src/shared/limits.ts#limitsOf', at: '边界栏明写不评说话者是否开放真诚、不给用户打分' },
  ],
  'T8-03': [
    { k: 'block', ref: 'rc.ambiguity', at: '补出来的假设写进 unknowns，不许默认读者自明；不要求模型声明它从哪个视角读' },
  ],
  'T8-04': [
    { k: 'code', ref: 'src/shared/types.ts#steelman', at: '九标准里只有「公平」单独立栏（steelman），其余散在检查项里不各占一栏' },
  ],
  'T8-05': [
    { k: 'code', ref: 'src/shared/types.ts#steelman', at: 'steelman 与 refutations 是两个字段，不合并——合并就是把让步伪装成检查' },
  ],
  'T8-06': [
    { k: 'code', ref: 'src/shared/topics.ts#topicsOf', at: '替代解释由本地列出，模型这次没想到也照列' },
  ],
  'T8-07': [
    { k: 'code', ref: 'src/shared/limits.ts#limitsOf', at: '边界栏第一条就是「它不回查自己」，不留给用户自己发现' },
  ],
  'T8-08': [
    { k: 'code', ref: 'src/shared/types.ts#MODE_META', at: 'givesVerdict 为假的模式由代码强制 level=undetermined，不靠模型自觉' },
  ],
  'T8-09': [
    { k: 'block', ref: 'q.aim', at: '要求问题对准文本的目标，而不是对准审讯' },
  ],
  'T8-10': [
    { k: 'code', ref: 'src/main/analyze.ts#LEVELS', at: '档位不输出百分比或两位小数的置信度：那会被当成测量结果' },
  ],
  'T8-11': [
    { k: 'code', ref: 'src/main/analyze.ts#normalizeLabels', at: 'labels 只记候选名，不因命名自动下调档位；不给档位的模式下命名另有处置（查谬误保留但要求位置，重构与提问清空）' },
  ],
  'T8-12': [
    { k: 'code', ref: 'src/shared/limits.ts#limitsOf', at: '边界栏明写不按领域换标准：只列该领域该问的问题，不改阈值' },
  ],

  /* ── 九 · 哲学与人文视野 ── */
  'T9-01': [
    { k: 'code', ref: 'src/shared/limits.ts#limitsOf', at: '边界栏明写只评 logos，ethos 与 pathos 既不评也不裁' },
  ],
  'T9-02': [
    { k: 'code', ref: 'src/shared/types.ts#Context', at: 'audienceKind 决定可接受性的偏置方向，但档位不因受众切换而改写' },
  ],
  'T9-03': [
    { k: 'code', ref: 'src/shared/limits.ts#limitsOf', at: '边界栏明写假定文本真诚，不检测欺骗、宣传与操纵意图' },
  ],
  'T9-04': [
    { k: 'block', ref: 'rc.ambiguity', at: '取最强读法，其余合理解法写进 unknowns；禁止挑一种读法当它唯一' },
  ],
  'T9-05': [
    { k: 'code', ref: 'src/shared/objection.ts#objectionKey', at: '异议按字段与范围定位，落在被断言的命题上；「他说得难听」不是异议' },
  ],
  'T9-06': [
    { k: 'code', ref: 'src/shared/limits.ts#limitsOf', at: '边界栏明写不评估制度性权力：只把「凭什么被相信」摊成可查的几问' },
  ],
  'T9-07': [
    { k: 'code', ref: 'src/shared/limits.ts#limitsOf', at: '边界栏明写不声明视角，并写明代价：沉默会被读成默认立场' },
  ],
  'T9-08': [
    { k: 'code', ref: 'src/shared/limits.ts#limitsOf', at: '边界栏明写只有一套规范，不用「兼容多元传统」把局限盖过去' },
  ],
  'T9-09': [
    { k: 'code', ref: 'src/shared/types.ts#PtaStatementType', at: '价值前提与事实前提分开计，不许拿事实前提充当价值前提' },
  ],
  'T9-10': [
    { k: 'code', ref: 'src/shared/limits.ts#limitsOf', at: '边界栏明写检查不递归：前提不被要求自身也被证明' },
  ],
  'T9-11': [
    { k: 'code', ref: 'src/main/analyze.ts#normalizeDiagnosis', at: '一条检查项没过不判整篇 fails：level 由各条支撑链各自算' },
  ],
  'T9-12': [
    { k: 'block', ref: 'rc.role', at: '写明角色是重构者不是代言人：不声称「作者真正想说的是」' },
    { k: 'code', ref: 'src/shared/limits.ts#limitsOf', at: '边界栏明写做的是说明不是理解' },
  ],

  /* ── 十 · 其他论证传统 ── */
  'T10-01': [
    { k: 'code', ref: 'src/shared/topics.ts#topicsOf', at: '类比栏只问相似点是否落在担保链上；「凭什么算同一类」这一问没有' },
  ],
  'T10-02': [
    { k: 'block', ref: 'core.reconstruct', at: '名落定义专题、辞落 conclusion、说落前提与 supports——三层各有位置' },
  ],
  'T10-03': [
    { k: 'code', ref: 'src/shared/limits.ts#limitsOf', at: '边界栏写清它没有文本以外的世界：不查史实、不做调查、不评政策效果' },
  ],
  'T10-04': [
    { k: 'code', ref: 'src/shared/topics.ts#topicsOf', at: '定义栏只查一词多义，不查名的外延与内涵分几层，也给不出判定' },
  ],
  'T10-05': [
    { k: 'lens', ref: 'copi/rules', at: '命名要过三道门槛、且不自动降档——名为了辨实，不为显得高明' },
  ],
  'T10-06': [
    { k: 'code', ref: 'src/shared/limits.ts#limitsOf', at: '边界栏明写没有因明透镜：汉传论式会被套进图尔敏，那是范畴错误' },
  ],
};

/** 落点种类的中文名，界面与文档共用。 */
export const LAND_KIND_LABEL: Record<LandKind, string> = {
  block: '提示词',
  lens: '透镜片段',
  code: '代码',
  ui: '界面',
};
