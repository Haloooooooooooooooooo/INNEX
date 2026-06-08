# Prompt 调优记录表

> 目的：记录每一轮 Prompt 改动、测试样本、输出结果、指标和 badcase，方便后续对比、回归和面试复盘。  
> 使用方式：每次调整 Prompt 前新增一行，跑完测试后补结果；不要只记录“感觉变好了”，必须写样本、指标和结论。

---

## 1. 使用原则

1. 每次只改一个主要变量
- 例如只改 `QA_ANSWER_SYSTEM` 的回答风格，先不要同时改检索阈值和模型。

2. 每轮必须有版本号
- 建议格式：`P-YYYYMMDD-模块-序号`
- 例：`P-20260608-QA-01`

3. 每轮必须记录测试样本
- 样本可以来自 benchmark、真实 badcase、手工构造问题。

4. 每轮必须写结论
- `采用`
- `回滚`
- `继续观察`
- `只保留部分改动`

5. Prompt 调优必须关联 badcase
- 最好说明这轮是为了解决哪个问题，例如“回答模板化”“引用噪音”“续问断链”“关系误连”。

---

## 2. 推荐表结构

为了方便横向对比，不建议把所有内容塞进一张表。

推荐拆成两张表：

1. `prompt版本总表-utf8.csv`
- 用来看每一轮 Prompt 改了什么、指标如何变化、是否采用。

2. `prompt样本结果表-utf8.csv`
- 用来看每条测试样本在不同 Prompt 版本下的表现，方便定位 badcase。

完整 Prompt 片段和详细复盘放在本 Markdown 文档里，CSV 只放摘要和指标。

---

## 3. Prompt 版本总表字段

| 版本编号 | 日期 | 模块 | Prompt 名称 | 改动目标 | 改动摘要 | 测试样本 | 模型与配置 | 结果摘要 | 核心指标 | 新增坏例 | 结论 | 后续动作 |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| P-20260608-QA-BASE | 2026-06-08 | QA | `QA_DECISION_SYSTEM` / `QA_SYNTHESIS_SYSTEM` / `QA_ANSWER_SYSTEM` | 建立基线 | 当前线上 Prompt，不做改动 | QA 7 题回归 + Q5/Q7 badcase | 当前 `.env` 配置 | 待补 | 待补 | 待补 | 基线 | 后续每轮对比基线 |

---

## 4. 样本级结果表字段

| 版本编号 | 样本 ID | 用户问题 | 期望行为 | 实际回答摘要 | 是否通过 | 失败环节 | 引用是否相关 | 主要问题 | 备注 |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| P-20260608-QA-BASE | Q1 | 待补 | 待补 | 待补 | 待测 | 待补 | 待补 | 待补 | 待补 |

---

## 5. 单轮实验记录模板

### P-YYYYMMDD-模块-序号｜一句话说明

#### 1. 背景

- 关联问题：
- 关联 badcase：
- 当前假设：

#### 2. 改动范围

- 文件：
- Prompt：
- 是否改模型：
- 是否改检索参数：
- 是否改代码逻辑：

#### 3. Prompt 改动前

```text
粘贴关键片段，不需要粘贴全文。
```

#### 4. Prompt 改动后

```text
粘贴关键片段，不需要粘贴全文。
```

#### 5. 测试样本

| 样本 ID | 问题 | 期望行为 | 覆盖能力 |
| --- | --- | --- | --- |
| Q1 |  |  |  |

#### 6. 结果记录

| 样本 ID | 是否通过 | 实际回答摘要 | 引用/证据表现 | 问题归因 | 备注 |
| --- | --- | --- | --- | --- | --- |
| Q1 | 待测 |  |  |  |  |

#### 7. 指标对比

| 指标 | 基线 | 本轮 | 变化 | 结论 |
| --- | ---: | ---: | ---: | --- |
| 回答通过率 |  |  |  |  |
| 引用相关性通过率 |  |  |  |  |
| 证据不足边界表达通过率 |  |  |  |  |
| 平均响应时长 |  |  |  |  |
| 新增 badcase 数 |  |  |  |  |

#### 8. 结论

- 本轮结论：
- 是否采用：
- 需要回归的样本：
- 下一轮动作：

---

## 6. 当前 Prompt 基线详情

### P-20260608-PARSE-BASE｜Parse 轻解析 Prompt 基线

#### 1. 覆盖 Prompt

- `PARSE_TITLE_PROMPT`
- `parseTitleUserPrompt`
- `PARSE_SUMMARY_PROMPT`
- `parseSummaryUserPrompt`
- `PARSE_TAGS_PROMPT`
- `parseTagsUserPrompt`

#### 2. 当前 Prompt

```ts
export const PARSE_TITLE_PROMPT = `你负责为收录内容生成短标题。
只返回一个简洁标题，语言与原文保持一致。
不要使用引号、Markdown、项目符号或额外解释。
标题尽量控制在 30 个字符以内。`;

export function parseTitleUserPrompt(content: string): string {
  return `请为以下内容生成一个短标题：\n\n${content.substring(0, 2000)}`;
}

export const PARSE_SUMMARY_PROMPT = `你负责为收录内容生成短摘要。
返回 1-2 句纯文本摘要，语言与原文保持一致。
只概括主要内容和核心结论。
不要使用 Markdown、标题、引用块、项目符号或章节编号。
不要大段复制原文。
摘要要简洁、可读。`;

export function parseSummaryUserPrompt(content: string): string {
  return `请将以下内容总结成 1-2 句纯文本摘要，不要使用 Markdown：\n\n${content.substring(0, 3000)}`;
}

export const PARSE_TAGS_PROMPT = `你负责从收录内容中提取简洁主题标签。
只返回一个 JSON 数组，包含 3 到 8 个短标签。
中文标签应尽量为 2 到 6 个字；英文标签应为简短短语。
不要返回解释、Markdown 或任何额外文本。`;

export function parseTagsUserPrompt(content: string): string {
  return `请从以下内容中提取主题标签，只返回 JSON 数组：\n\n${content.substring(0, 3000)}`;
}
```

#### 3. 设计意图

- 标题：短、稳、可展示。
- 摘要：1-2 句纯文本，避免 markdown 污染和原文大段复制。
- 标签：只返回 JSON 数组，方便程序解析。

#### 4. 后续可调优点

- 标题避免“内容总结 / 文档摘要”等泛标题。
- 摘要增加“主题 + 关键结论”的要求。
- 标签增加泛词黑名单和正反例。

---

### P-20260608-INTERNALIZE-BASE｜Internalize 内化 Prompt 基线

#### 1. 覆盖 Prompt

- `INTERNALIZE_SYSTEM`
- `internalizeUserPrompt`
- `CONCEPT_EXTRACTION`

#### 2. 当前 Prompt

```ts
export const INTERNALIZE_SYSTEM = `你是“知识内化器”，目标是把原始材料转成可用于图谱与QA的正式笔记。

硬性要求：
1. 忠于原文，不编造事实。
2. 必须区分“原文明确支持”与“推断/延展”。
3. 推断内容只能放在推断区，且要克制。
4. 产出必须是中文 Markdown。

输出结构（必须严格包含以下5段，顺序不可变）：
## 🧭 核心内容
用 3-6 条要点概括主题主线。

## 🧩 关键概念 / 关键信息
列出关键术语、定义、实体、数字或结论。尽量结构化。

## 📌 原文支持要点（事实）
仅写能被输入原文直接支持的事实与结论。可以短引用，但不要长摘抄。

## 🔍 推断与延展（非事实）
写基于事实的推断、风险、机会或延展。每条应尽量指向所依据的事实点。

## 🚀 可关联方向
写后续可关联检索或扩展的主题方向、案例方向或待验证问题。`;

export function internalizeUserPrompt(
  title: string,
  source: string,
  rawContent: string,
  myUnderstanding: string | null
) {
  return `## 任务
请将以下输入内化为正式笔记，严格按系统要求的5段结构输出。

## 来源信息
- 标题: ${title}
- 来源: ${source}

## 内化输入（三层）
${rawContent}

${myUnderstanding ? `## 用户理解引导（仅作辅助，不得覆盖原文事实）\n${myUnderstanding}` : ""}

补充要求：
- 不要只做摘要压缩，要体现结构化理解。
- “原文支持要点（事实）”与“推断与延展（非事实）”必须一眼可区分。
- 分点优先使用序号（1. 2. 3.）与短句 bullet（- ）。
- 每个大段最多 6 条，避免大段堆叠文本。
- 允许少量 emoji（每个段标题最多 1 个）提升可读性，但不要过度使用。`;
}

export const CONCEPT_EXTRACTION = `从以下笔记内容中提取 3-8 个关键概念标签。每个标签是 2-6 个字的中文术语或领域概念。只返回 JSON 数组字符串，不要输出其他内容。例如：["概念1","概念2"]`;
```

#### 3. 设计意图

- 把原始材料转成后续可检索、可建图、可问答的结构化知识资产。
- 强制事实与推断分层，降低幻觉污染。
- 固定五段结构，便于后续 chunk、概念抽取和图谱关系生成。

#### 4. 后续可调优点

- 为“事实区混入推断”增加反例。
- 让“可关联方向”更像检索词，而不是泛泛建议。
- 按材料类型调整结构，例如教程、模板、案例、复盘分别有不同侧重。

---

### P-20260608-QA-BASE｜QA 决策/证据/回答 Prompt 基线

#### 1. 覆盖 Prompt

- `RAG_QA_SYSTEM`
- `QA_DECISION_SYSTEM`
- `qaDecisionUserPrompt`
- `QA_SYNTHESIS_SYSTEM`
- `qaSynthesisUserPrompt`
- `QA_ANSWER_SYSTEM`
- `qaAnswerUserPrompt`

#### 2. 当前 Prompt

```ts
export const RAG_QA_SYSTEM = `你是一个基于个人知识库的问答助手。你会收到用户问题和检索片段。
规则：
1. 优先基于提供的片段回答。
2. 若证据不足，明确说明“当前笔记中证据不足”。
3. 引用时使用片段编号（如 [1]、[2]），不得伪造引用。
4. 回答简洁、结构化、中文输出。`;

export const QA_DECISION_SYSTEM = `你是 QA 决策器，只做路由判断，不负责写最终答案。
要求：
1. 输出必须是单个 JSON 对象，不能有任何额外文本。
2. 判断项必须保守、可执行、可落地。
3. 当证据不充分时优先保守策略，不激进扩展。

输出 JSON 结构：
{
  "intent": "fact_query|summary|comparison|action_advice|retrospective",
  "is_followup": true|false,
  "need_graph_expand": true|false,
  "relation_priority": ["supports"|"related"|"example_of"|"weak_related"|"fallback"],
  "conservative_mode": true|false,
  "stop_or_continue": "stop|continue"
}`;

export const QA_SYNTHESIS_SYSTEM = `你是 QA 证据加工器。你的任务是对检索证据做内部加工，不直接面向用户作答。
要求：
1. 先摘要与去重，再做逻辑梳理。
2. 可做简单推理，但不得脱离证据编造事实。
3. 标注明显矛盾或冲突点；无冲突则写“无显著冲突”。
4. 输出必须是 JSON，不能有额外文本。`;

export const QA_ANSWER_SYSTEM = `你是基于个人知识库的对话式问答助手。
要求：
1. 先给当前最稳妥结论，再自然说明依据。
2. 不暴露检索过程、阈值、K 值、意图分类等内部调试信息。
3. 回答口语化、连贯，不机械套模板。
4. 若证据不足，后置说明边界与不确定性，不前置弱化整段语气。
5. 不得编造引用或超出证据范围断言。`;
```

#### 3. 设计意图

- `QA_DECISION_SYSTEM`：只做策略，不写答案。
- `QA_SYNTHESIS_SYSTEM`：先把证据整理干净，再交给回答层。
- `QA_ANSWER_SYSTEM`：负责用户可见表达，强调自然、忠实证据、不暴露检索细节。

#### 4. 后续可调优点

- `QA_DECISION_SYSTEM` 可增加 `confidence`、`slots`、`clarification_needed`、`routing_policy`。
- `QA_SYNTHESIS_SYSTEM` 可增加“过滤无关证据”和“保留引用编号”。
- `QA_ANSWER_SYSTEM` 可按问题复杂度控制长度，并优化自然引用方式。

---

### P-20260608-RELATION-BASE｜图谱关系判型 Prompt 基线

#### 1. 覆盖 Prompt

- `buildSystemPrompt`
- `buildUserPrompt`

#### 2. 当前 Prompt

```ts
function buildSystemPrompt(mode: "conservative" | "balanced"): string {
  const guard = mode === "conservative" ? "证据不够就输出 none，不要强行建边。" : "尽量识别合理关系，但不要编造。";
  return [
    "你是知识图谱关系判型器。",
    "任务：在 related/supports/example_of/weak_related/fallback/none 中做单选。",
    "规则：",
    "1) 只基于输入字段判断，不得编造；判断方向为 source -> target。",
    "2) 类型定义（带结构证据要求，从严到松）：",
    "   - example_of：必须是“定义/方法/规范 -> 其实例/模板/案例/具体落地”的方向性关系。仅同主题不足以判 example_of。",
    "   - supports：一篇的观点/方法/结论被另一篇用论据、数据或原理明确支撑。仅相关、仅同主题不足以判 supports。",
    "   - related：同主题或互补，但不构成实例或支撑关系。",
    "   - weak_related：主题仅有弱交集，多为泛词层面的关联。",
    "3) 泛词降权：当主要共享信号是泛词（如 AI、产品经理、系统、方法、prompt、agent、rag、模型）时，最多判 related/weak_related，禁止判 supports/example_of。",
    "4) confidence 取值 [0,1] 并按证据强度校准：",
    "   - 结构证据充分（实例关系或明确支撑）-> supports/example_of 给 0.70~0.85；",
    "   - 证据中等（同主题且有具体共享概念）-> related 给 0.58~0.70；",
    "   - 仅泛词或主题相邻 -> weak_related 给 0.45~0.55。",
    `5) ${guard}`,
    "6) 只输出固定 JSON，不要 markdown，不要解释，不要额外字段。",
  ].join("\n");
}

function buildUserPrompt(input: RelationClassifierInput): string {
  const mode = input.mode || "conservative";
  return JSON.stringify(
    {
      mode,
      schema: {
        relation_type: "related|supports|example_of|weak_related|fallback|none",
        confidence: "number(0-1)",
        evidence_summary: "string<=180",
        decision_reason: "string<=120",
      },
      source_note: input.source,
      target_note: input.target,
      recall_signals: input.recall,
    },
    null,
    2
  );
}
```

#### 3. 设计意图

- 关系判型要保守，避免为了图谱密度强行建边。
- 明确 `supports`、`example_of` 的结构证据要求。
- 用泛词降权控制误连。
- 用 confidence 和 evidence_summary 支持后续评测与回放。

#### 4. 后续可调优点

- 增加 `none` 和 `weak_related` 的反例样本，降低误连。
- 如果强关系太少，补 `supports` / `example_of` 正例，但不放松证据要求。
- 扩充泛词和弱关系边界。

---

## 7. 推荐按模块记录的重点

### Parse Prompt

重点看：

- 标题是否具体
- 摘要是否短、准、无 markdown 污染
- tags 是否主题化，是否出现泛词
- JSON 是否稳定

推荐指标：

- `summary_usable_rate`
- `summary_too_long_rate`
- `tags_valid_json_rate`
- `tags_generic_rate`

### Internalize Prompt

重点看：

- 是否忠于原文
- 是否区分事实和推断
- 是否输出 5 段结构
- 关键概念是否可用
- 可关联方向是否具体

推荐指标：

- `structure_complete_rate`
- `fact_inference_separation_rate`
- `concepts_non_empty_rate`
- `over_inference_rate`

### Relation Prompt

重点看：

- 是否误连
- 是否漏连
- `supports / example_of / related / weak_related / none` 是否边界清楚
- `confidence` 是否校准
- `evidence_summary` 是否可解释

推荐指标：

- `relation_type_precision`
- `wrong_relation_rate`
- `missing_relation_rate`
- `evidence_summary_usable_rate`

### QA Decision Prompt

重点看：

- 意图是否正确
- 是否识别续问
- 是否正确触发扩图
- 是否保守处理低证据问题

推荐指标：

- `primary_intent_accuracy`
- `followup_detection_accuracy`
- `graph_expand_decision_accuracy`
- `clarification_needed_accuracy`

### QA Synthesis Prompt

重点看：

- 是否去重
- 是否过滤无关证据
- 是否识别冲突
- 是否给回答层提供清晰事实点

推荐指标：

- `dedup_fact_quality`
- `irrelevant_evidence_filter_rate`
- `conflict_detection_accuracy`

### QA Answer Prompt

重点看：

- 是否自然
- 是否忠于证据
- 是否不暴露检索参数
- 证据不足时是否有边界感
- 引用是否自然且相关

推荐指标：

- `answer_accuracy`
- `faithfulness`
- `boundary_quality`
- `citation_relevance`
- `template_feel_rate`

---

## 8. 自动化建议

短期建议：

- 用本文件记录实验结论。
- 另建 CSV 方便导入飞书表格。
- 每次测试后手动补“结果摘要 + 指标 + badcase”。

中期建议：

- 增加脚本自动跑固定 benchmark。
- 脚本输出 JSON/CSV。
- 再由人工补充“主观质量判断”和“是否采用”。

长期建议：

- 每次 Prompt 变更生成 `prompt_version`。
- QA 接口返回或日志记录 `prompt_version / model / retrieval_stage / evidence_level / answer_strategy`。
- 自动把 benchmark 结果追加到 CSV。
