# 第二版优化-Phase5B 验收说明（QA 检索决策接入）

本文件是执行清单 `Phase 5` 中 5.7 的验收产出，对应代码：`apps/web/app/api/qa/route.ts`、`apps/web/lib/qa/intent.ts`、`apps/web/lib/qa/config.ts`。

定位：5A（图谱）、5B（QA 接入）已完成；本文件固化 5B 的检索顺序、意图分类、多轮判断、扩图与停止规则，供后续 5C 评测收敛对照。

---

## 1. QA 检索顺序（5.2）

QA（notes 模式）按固定顺序逐级补召回，每级命中即用、未命中下沉，全程有 `retrieval_stage` 标记与日志：

1. coarse recall：按 title/summary/content 关键词粗筛候选 note（`coarseRecallNotes`）。
2. scoped vector：在候选 note 内做向量召回（`match_note_chunks_in_notes`）→ `retrieval_stage=scoped_vector`。
3. global vector：全局向量召回（`match_note_chunks`）→ `global_vector`。
4. source vector：原文切片召回（`match_source_chunks`）→ `source_vector`。
5. adaptive vector：放宽阈值重试 → `adaptive_vector`。
6. keyword fallback：关键词兜底摘取 → `keyword_fallback`。
7. followup reuse（5.4）：续问指代时直接复用上一轮引用 note → `+followup_reuse`。
8. graph expand（5.5）：证据稀疏时图谱扩检索 → `graph_expanded_vector` 或 `+graph_skip`。

定位说明：内化切片（note_chunks）负责知识定位，原文切片（source_chunks）负责证据支撑；图谱承担第二阶段扩检索，不作为首跳入口。

---

## 2. QA 意图分类（5.3）

分两层，互相正交：

### 主意图（`detectIntent`）
- `fact_query` 事实查询
- `summary` 总结归纳
- `comparison` 对比决策
- `action_advice` 执行建议
- `retrospective` 复盘反思

### 扩展意图（`detectExpansionIntent`，本轮新增）
- `evidence_strengthening` 求依据/证据/原因 → 偏好 `supports`
- `example_request` 求例子/案例/模板/用法 → 偏好 `example_of`
- `related_topic_expansion` 求相关/类似/延伸 → 偏好 `related`
- `none` 无明确扩展偏好 → 回退主意图优先级

扩展意图只决定“图谱扩检索的关系类型偏好”，不替代主意图。

---

## 3. 多轮追问与语义连续性（5.4）

“连续消息”不等于“相关追问”，连续性判断采用两个信号：

1. `isSemanticallyContinuous`：当前问题与上一轮用户问题的查询词有重叠 → 语义连续。
2. `isFollowupReference`（R7-C02）：命中“继续/接着/上一个/上面/上述/刚才/之前/那个/展开/详细说/顺着…”等指代/延续词 → 续问指代。

只要满足任一信号，才允许复用上一轮命中的知识 note：
- Stage 3.7 follow-up reuse：续问指代时不受稀疏门控限制，直接对上一轮引用 note 做向量召回融合（阈值放宽到 `threshold-0.12`，下限 0.48）。这是为“自信地召回错”场景兜底。
- Stage 4 seed 复用：语义连续或续问指代时，把上一轮引用 note 加入图谱扩检索种子。

另：同会话主题重排（R7-C01，`reorderChunksBySessionTopic`）在融合后、喂模型前，为命中“当前问题+最近2轮用户问题”主题词的 chunk 加有界加分（上限 +0.15，仅排序不过滤），降低偏题召回盖过在题证据的概率。

---

## 4. 图谱扩检索与停止规则（5.5 / 5.6）

### 扩检索关系偏好（5.5）
- 优先按扩展意图映射：evidence_strengthening→supports / example_request→example_of / related_topic_expansion→related（`relationPriorityByExpansion` 把偏好类型提到优先级队首）。
- 无扩展意图时回退主意图映射（`relationPriorityByIntent`）。
- 判断不清时保守：扩图仅在证据稀疏（`chunks < max(4, topK*0.8)`）时触发，不激进扩图。

### 停止规则（5.6）
扩图“够用即停”，停机原因记录在 `graph_expand.stop_reason`：
- `no_seed` 无种子
- `budget_reached` 达到扩展预算（`QA_GRAPH_EXPAND_BUDGET`，默认 14）
- `hop_limit` 达到跳数上限（`QA_GRAPH_EXPAND_HOPS`，默认 1）
- `frontier_exhausted` 前沿无新节点
- `no_relations` 无可用关系边
- 且仅当扩展增益 `gain >= QA_GRAPH_EXPAND_MIN_GAIN`（默认 1）才真正并入扩检索结果，否则 `+graph_skip`。

### 回答策略三档（5.6，本轮新增 `deriveAnswerStrategy`）
基于证据档位 + 召回宽度判定，并写入回答指令与回包 `answer_strategy`：
- `answerable`（证据强）→ 直接答。
- `partial`（证据中等/稀疏）→ 先给最稳判断，再用“不确定项”明确边界与缺口。
- `insufficient`（证据过弱/无）→ 只给能被支撑的有限结论，明确说明无法可靠回答；关联判断类问题可明确答“暂无直接关联”（R7-C03）。

判定规则：high→answerable；low→(chunks≥2 ? partial : insufficient)；unknown→(chunks≥3 ? partial : insufficient)；无 chunks→insufficient（早返回兜底）。

---

## 5. 可观测字段（回归评测用）

回包与日志可用于 5C 评测对照：
- `retrieval_stage`：实际命中的检索级别（含 `+followup_reuse` / `+graph_skip` 后缀）。
- `answer_strategy`：answerable / partial / insufficient。
- `intent_expansion`：扩展意图。
- `graph_expand`：`seed_count` / `reused_seed_count` / `semantically_continuous` / `followup_reference` / `followup_reuse_applied` / `expansion_intent` / `expanded_count` / `gain` / `traversed_edges` / `stop_reason` / `relation_priority`。
- 日志：`[qa] start/coarse_recall/scoped_vector_hit/source_vector_hit/followup_reuse_hit/graph_expand/success`。

---

## 6. 与执行清单 5.7 的对应

- 5.7 输出 QA 检索顺序说明 → 本文件第 1 节。
- 5.7 输出 QA 意图分类规范 → 本文件第 2 节。
- 5.7 输出多轮追问判断规则 → 本文件第 3 节。
- 5.7 输出图谱扩检索与停止规则 → 本文件第 4 节。

### 本阶段未覆盖（留作后续）
- QA 错误扩图率指标埋点（计划 3.3 新增指标，属 5C 评测口径，需结合实跑数据）。
- 决策/回答双角色 prompt 全量改造（Phase 6，需先确认）。

### 验收方式
本文件为“规则与链路”验收；行为指标（同 7 题 QA 复测）仍按 benchmark 结果表 R9 口径，由用户实跑后回填，不在本文件内编造数据。
