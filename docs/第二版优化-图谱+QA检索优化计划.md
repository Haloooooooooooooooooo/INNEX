# 第二版优化-图谱+QA检索优化计划

## 1. 目标与范围

本计划聚焦 `Phase 5`（QA 检索与 Agent 决策升级），并与当前图谱能力联动优化。

核心目标：

1. 提升图谱关系召回，尤其是“语义相近但字面不同”的关联识别能力。
2. 保持关系可解释性：每条关系边可回溯 `relation_type + confidence + evidence_summary`。
3. 让图谱关系直接服务 QA 检索与回答组织，而非仅做可视化展示。

范围边界：

1. 本文覆盖 `Phase 5`，不直接展开 `Phase 6` 的回答风格与双角色 prompt 全量改造。
2. 图谱关系类型仍限定在：`related / supports / example_of`。
3. 采用“同轮设计、分步上线”：先图谱，后 QA 接入，最后统一评测收敛。

---

## 2. 总体策略

采用三段式落地：

1. Phase 5A：图谱关系生成升级（先做）
2. Phase 5B：QA 检索决策接入图谱关系
3. Phase 5C：基于 benchmark 回归评测与参数收敛

总体原则：

1. 保守上线，先提召回，再控误连。
2. 结构化日志先行，保证每步可回放、可审计。
3. 任何模型选型/换模型/prompt 改动，均先与你确认再执行。

---

## 3. 分阶段执行计划

## 3.1 Phase 5A：图谱关系生成升级（预计 1-2 天）

目标：替换当前“轻规则判型”短板，提升语义关系识别能力。

执行项：

1. 保留 embedding 粗召回链路（不推翻已有主链路）。
2. 新增 relation-classifier（大模型判型）环节，替换 `inferRelationTypeLite` 的主判型职责。
3. relation-classifier 输入：
   - 源 note：title/summary/tags/concepts
   - 候选 note：title/summary/tags/concepts
   - 召回信号：similarity、overlap、关键词命中
   - 证据片段：top chunk（内化片段+事实片段）
4. relation-classifier 输出（结构化 JSON）：
   - `relation_type`（related/supports/example_of）
   - `confidence`（0-1）
   - `evidence_summary`（可读）
   - `decision_reason`（短）
5. 新增同义归一层（首批词典）：
   - prompt/提示词/提示语
   - A/B test/AB测试/A-B测试
   - RAG/检索增强
   - agent/智能体
6. 保守模式：
   - 低置信关系可入库但默认弱展示
   - 不直接提升为 QA 高置信证据

产出：

1. 图谱关系召回提升版本（可回放日志）。
2. 标准化关系证据输出 schema（供 QA 直接消费）。

---

## 3.2 Phase 5B：QA 检索决策接入（预计 1-2 天）

目标：将图谱关系转化为 QA 检索收益，而非“只连边不利用”。

执行项：

1. 固定 QA 检索顺序（与执行清单对齐）：
   - 先内化资产
   - 再原文资产
   - 证据不足再扩图
2. 新增意图驱动的 relation hook：
   - evidence strengthening -> 优先 `supports`
   - example request -> 优先 `example_of`
   - related-topic expansion -> 优先 `related`
3. 多轮连续性门控：
   - 仅语义连续时允许复用上一轮图谱扩检索上下文
4. 停止规则（够用即停）：
   - 证据已足够
   - 扩展收益下降
   - 继续扩图仍无法补齐关键证据

产出：

1. QA 侧关系扩检索决策链路。
2. 可观察日志（意图、扩图触发原因、停止原因）。

---

## 3.3 Phase 5C：评测与收敛（预计 0.5-1 天）

目标：验证“召回提升”与“误连可控”是否同时成立。

评测样本：

1. 强相关组：S02 / S03 / S04
2. 中相关组：S08 / S10 / S05

核心指标：

1. `relation_recall@K`
2. `relation_type_precision`
3. `evidence_summary_usable_rate`
4. `graph_relation_qa_reuse_rate`
5. QA 错误扩图率（新增）

收敛动作：

1. 调整 relation-classifier 触发阈值。
2. 调整 QA 扩图权重与停止条件。
3. 调整低置信边默认展示/消费策略。

---

## 4. 对应执行清单（Phase 5）映射

1. 5.1 QA 总体形态固定：通过 agent-guided RAG 约束落地。
2. 5.2 QA 检索顺序：内化 -> 原文 -> 扩图，强制日志校验。
3. 5.3 QA 意图分类：主意图 + 扩展意图；关系类型仅作扩检索偏好。
4. 5.4 多轮连续性判断：仅语义连续允许借助图谱上下文。
5. 5.5 图谱扩检索决策：按意图映射关系类型偏好。
6. 5.6 Agent 停止规则：够用即停，避免无收益扩图。
7. 5.7 验收：以日志回放 + benchmark 指标完成阶段验收。

---

## 5. 模型与 Prompt 协作机制（与你共决策）

以下事项必须与你确认后执行：

1. relation-classifier 模型选型
2. 是否换模型/换供应商
3. relation-classifier prompt 模板与输出字段
4. 阈值策略（召回优先 vs 精度优先）
5. QA relation hook 权重策略

建议协作节奏：

1. 每次改动前给你“改动卡片”（改什么、为什么、风险、回滚方式）。
2. 你确认后再动代码。
3. 每次改动后给你“对比结果卡片”（指标变化+案例变化）。

---

## 6. 风险与防护

风险：

1. 召回提升后误连增加
2. 大模型成本与时延上升
3. QA 过度扩图导致噪声放大

防护：

1. 分层置信度消费（低置信不进高置信回答）
2. 仅对 TopN 候选调用 relation-classifier
3. 先保守权重上线，再逐步放开
4. 所有链路可观测、可回放、可回滚

---

## 7. 执行确认点

开始执行前仅需你确认两项：

1. 是否启用“保守模式”作为第一版默认（建议：是）
2. 是否在第一轮就启用 QA relation hook（建议：是，温和权重）

确认后按 `5A -> 5B -> 5C` 顺序执行。
