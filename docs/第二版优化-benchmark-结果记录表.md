# 第二版优化 Benchmark 结果记录表

## 使用说明
这份文档用于记录 benchmark 的实际运行结果，建议配合以下文档一起使用：

- [第二版优化-benchmark-v0.md](/e:/my_vibecoding/INNEX/docs/第二版优化-benchmark-v0.md)
- [第二版优化-过程记录.md](/e:/my_vibecoding/INNEX/docs/第二版优化-过程记录.md)

记录原则：
1. 每条样本至少记录录入解析结果。
2. 如果做了内化，继续补充内化结果。
3. 如果后面做了图谱或 QA，再继续补充。
4. 统一使用三档结论：`通过` / `部分通过` / `失败`。
5. 每一轮测试结束后，必须当轮更新本表（禁止攒多轮后再补记）。
6. 每轮至少补三项：`测试轮次/版本`、`A/B 对比结论`、`新增 badcase`。

---

## 状态判断建议

### 录入解析
- `通过`
  - 类型识别正确
  - 原文保留基本完整
  - summary 可用
  - tags 基本合理
- `部分通过`
  - 主流程成功
  - 但 summary/tags/原文质量一般
  - 或 deferred 行为合理但结果还不完整
- `失败`
  - 类型识别错误
  - 原文缺失严重
  - summary/tags 明显不可用
  - 主流程失败

### 内化
- `通过`
  - 忠于原文
  - 结构清晰
  - 正式摘要/标签/概念可用
- `部分通过`
  - 能看但不够稳
  - 有轻微失真或组织一般
- `失败`
  - 丢关键信息
  - 推断污染事实
  - 结构明显失控

### 图谱
- `通过`
  - 建边合理
  - 类型大体正确
  - 证据/置信度说得通
- `部分通过`
  - 有关联但偏弱
  - 关系类型不够准
- `失败`
  - 误连严重
  - 漏连严重
  - 或关系类型超出当前 Phase4 范围

### QA
- `通过`
  - 回答正确
  - 依据合理
  - 边界表达合适
- `部分通过`
  - 基本正确
  - 但证据、表达或扩图策略一般
- `失败`
  - 答错
  - 乱答
  - 没有合理回到原文

---

## 失败原因分类建议
- `type_detect_wrong`
- `url_parse_empty`
- `summary_too_long`
- `summary_too_weak`
- `summary_markdown_polluted`
- `tags_too_generic`
- `tags_structure_polluted`
- `ocr_missing`
- `ocr_garbled`
- `pdf_extract_failed`
- `doc_extract_noisy`
- `deferred_not_triggered`
- `deferred_not_completed`
- `internalize_lost_facts`
- `internalize_over_inferred`
- `graph_missing_relation`
- `graph_wrong_relation`
- `graph_relation_type_out_of_scope`
- `graph_evidence_incomplete`
- `graph_confidence_misaligned`
- `graph_evidence_summary_weak`
- `qa_wrong_answer`
- `qa_missing_evidence`
- `qa_followup_misjudged`

---

## 结果总表

| ID | 样本名/类型 | 录入解析 | 内化 | 图谱 | QA | 当前主要问题 | 备注 |
| --- | --- | --- | --- | --- | --- | --- | --- |
| S01 | 小红书链接 01 | 通过 | 通过 | 待测 | 待测 |  | 内化结构完整（核心内容/关键概念/事实/推断/可关联方向齐全），事实与推断分层清晰；parse_debug 核心信号正常：url_platform=xiaohongshu；url_image_count=4；inline_image_ocr_count=4；xhs_image_ocr_succeeded:4；xhs_external_crawler_used:4 |
| S02 | Prompt A/B Test 文字 | 通过 | 通过 | 待测 | 待测 |  | 内化生成成功（status=success, generation_error=null），结构完整 |
| S03 | Prompt A/B Test 图片 | 通过 | 通过 | 待测 | 待测 |  | 内化生成成功（status=success, generation_error=null），结构完整 |
| S04 | Prompt 输出规范 图片 | 通过 | 通过 | 待测 | 待测 |  | 内化生成成功（status=success, generation_error=null），结构完整 |
| S05 | AI 产品经理 PRD 模板 PDF | 通过 | 通过 | 待测 | 待测 |  | 内化生成成功（status=success, generation_error=null），deferred 后可产出草稿 |
| S06 | 公众号链接 | 通过 | 通过 | 待测 | 待测 |  | 内化生成成功（status=success, generation_error=null） |
| S07 | 小红书链接 02 | 通过 | 通过 | 待测 | 待测 |  | 内化生成成功（status=success, generation_error=null） |
| S08 | AI 意图识别评估 文字 | 通过 | 通过 | 待测 | 待测 |  | 内化生成成功（status=success, generation_error=null） |
| S09 | 小红书链接 03 | 通过 | 通过 | 待测 | 待测 |  | 内化生成成功（status=success, generation_error=null） |
| S10 | 技术栈 MD 文档 | 通过 | 通过 | 待测 | 待测 |  | 内化生成成功（status=success, generation_error=null） |
| S11 | Java REST API 教案 DOCX | 通过 | 部分通过 | 待测 | 待测 | concepts 缺失 | 内化生成成功（status=success, generation_error=null），但 `concepts=[]` |

---

## 统一优化待办（全样本测完后执行）

- Phase3 汇总：
  - 内化样本成功率：9/10 通过，1/10 部分通过，0 失败（基于 `phase3测试结果.txt` 中 S02-S11）。
  - 主要剩余问题：S11 的结构化概念抽取为空（`concepts=[]`），建议补概念回填与最小数量兜底（如 <3 时触发二次抽取）。

- S06（公众号链接）：
  - 问题：`url_body` 噪音偏多，且当前存在 `4000` 字截断。
  - 影响：原文纯净度与后续内化质量。
  - 处理时机：等本轮 benchmark 全样本录入测完后，统一做 URL 正文清洗与分段策略优化。

- Phase4 图谱专项（新增）：
  - 关系类型范围：仅允许 `related / supports / example_of`。
  - 边证据完整度：每条边检查 `relation_type + confidence + evidence_summary`。
  - 建议新增汇总指标：
    - `relation_type_precision`
    - `evidence_summary_usable_rate`
    - `graph_relation_qa_reuse_rate`

---

## 单条记录模板

```md
## SXX 样本名
- 类型：
- 录入时间：
- 当前版本：

### 录入解析
- 结果：通过 / 部分通过 / 失败
- 观察：
- 失败原因标签：
- 结果样例：

### 内化
- 结果：通过 / 部分通过 / 失败
- 观察：
- 失败原因标签：

### 图谱
- 结果：通过 / 部分通过 / 失败
- 观察：
- 失败原因标签：
- 关系类型分布：related / supports / example_of
- 证据完整度：完整边数 / 总边数
- 证据摘要可用性：可用 / 不可用（简述原因）

### QA
- 结果：通过 / 部分通过 / 失败
- 观察：
- 失败原因标签：

### 后续动作
- 
```

---

## 建议记录节奏

### 第一轮
建议先只填：
- `录入解析`
- `当前主要问题`

### 第二轮
录入层稳定后，再补：
- `内化`

### 第三轮
图谱和 QA 能力开始升级后，再逐步补：
- `图谱`
- `QA`

---

## 每轮更新最小清单（强制）

每轮测试后，至少补充以下内容：

1. 测试轮次标识（如 `R1 / R2`）与代码版本（commit 或日期）。
2. 本轮 A/B 输入（例如 graph JSON 文件名或样本批次）。
3. 核心对比结果（节点数、边数、关系类型分布、通过/部分通过/失败数量）。
4. 新增 badcase 列表（样本 ID、现象、原因标签、是否复现）。
5. 下一轮动作（参数调整或 prompt/模型改动点）。

---

## 固定 Badcase 模板（每轮复用）

使用方式：
1. 每轮测试后新增一个小节：`Rxx Badcase`。
2. 每条 badcase 填一行，先记录现象，不急着下结论。
3. 我们先一起确认“原因标签”和“修复动作”后，再补最后两列。

### Rxx Badcase 记录表（复制使用）

| Case ID | 样本/边 | 问题类型 | 现象描述 | 证据（日志/JSON/截图） | 原因标签（待确认） | 修复动作（待确认） | 状态 |
| --- | --- | --- | --- | --- | --- | --- | --- |
| Rxx-C01 | 例如：S02-S04 | 漏连/误连/强度错判/证据弱 | 例如：应为中相关但未建边 | graph JSON / 控制台日志 / 截图链接 | `graph_missing_relation` | 例如：调低 related 阈值到 0.56 | 待分析 |
| Rxx-C02 |  |  |  |  |  |  | 待分析 |
| Rxx-C03 |  |  |  |  |  |  | 待分析 |

### 问题类型枚举（建议）

- 漏连：应该有关系但没建边
- 误连：不该连却建边
- 强度错判：边建了，但强弱明显不合理
- 类型错判：`related/supports/example_of` 判错
- 证据弱：`evidence_summary` 不可解释或过泛

### 状态枚举（建议）

- `待分析`
- `已确认待修复`
- `修复中`
- `已修复待回归`
- `已关闭`

---

## 和过程记录的联动方式
建议规则：
1. benchmark 结果表记录“现象”。
2. 过程记录文档记录“为什么、怎么修、修了什么”。

例如：
- 结果表里写：`S10 summary_markdown_polluted`
- 过程记录里写：`已新增 markdown 清洗和 summary 归一化`

这样后续复盘会非常清晰。


## R3（2026-05-30）图谱语义建边增强回归（待你跑完后补结果值）

- 版本：Phase5A 语义增强版（v4-pro + 分类型阈值 + 同义归一 + weak/fallback）
- 变更点：
  - `weak_related/fallback` 引入并可视化分层
  - 关系类型分阈值
  - LLM 判型候选数提升（默认24）
  - 同义词归一（Prompt/AB/Agent/RAG）
- 本轮 A/B 输入：
  - A：上一轮 baseline graph JSON
  - B：本轮重内化后的 graph JSON
- 本轮需回填指标：
  - node_count / edge_count
  - relationTypeCounts（含 weak_related/fallback）
  - 强边准确率（supports/example_of）
  - 弱边可用率（weak_related/fallback）
  - badcase（ID + 原因标签）
- 重点观察样本：
  - S01/S07/S09：应有弱到中 related（Agent主题）
  - S11：独立样本，默认不要求建边

---

## R2 Badcase（2026-05-29，A/B 首轮 JSON 对比沉淀）

轮次背景：
- A：`innex-graph-1780061894323.json`
- B：`innex-graph-1780063891996.json`
- 对比结论：召回提升（边数 `1 -> 4`），但存在类型/强度错判与 fallback 主导问题。

| Case ID | 样本/边 | 问题类型 | 现象描述 | 证据（日志/JSON/截图） | 原因标签（待确认） | 修复动作（待确认） | 状态 |
| --- | --- | --- | --- | --- | --- | --- | --- |
| R2-C01 | S05-S08（PRD模板 -> 意图识别） | 类型错判/强度错判 | 被判为 `example_of` 且置信度约 `0.60`，但更像弱 `related` | B JSON 边明细 | `graph_confidence_misaligned` | 提高 `example_of` 阈值，低证据降级为 `fallback/weak_related` | 已确认待修复 |
| R2-C02 | 全局关系生成 | 证据弱 | 关系证据主要来自 `structured_overlap_fallback`，LLM 判型增益不足 | B JSON `evidence.method` 分布 | `graph_evidence_summary_weak` | 提高 LLM 判型覆盖候选数，并记录 `llm_decision vs fallback` 来源 | 已确认待修复 |
| R2-C03 | S01/S07/S09 主题组 | 漏连 | Agent 主题相关样本在该轮仍偏稀疏，未形成稳定弱到中相关网络 | 图谱截图 + B JSON | `graph_missing_relation` | 引入同义归一 + 关联方向加权 + 弱边分层入库 | 已确认待修复 |

---

## R3 初评（2026-05-30，截图评估，待JSON复核）

输入说明：
- 当前仅收到图谱截图（未附本轮 JSON 文件名），以下为初评结论，后续以 JSON 指标复核为准。

初评观察：
1. 召回较前轮继续提升，已出现更明显的主题簇（Prompt/Agent/产品方向有聚集趋势）。
2. 仍存在“跨簇连边偏长且视觉交叉较多”的问题，影响关系强弱可读性。
3. 局部存在“可能偏弱关系被放入主可见层”的风险，需继续依赖 weak/fallback 分层与阈值收敛。

初评结论：
- 图谱状态：`部分通过`
- 主要问题标签：
  - `graph_confidence_misaligned`
  - `graph_evidence_summary_weak`
  - `graph_missing_relation`（个别主题对仍有漏连风险）

下一步动作（已执行一部分）：
1. 布局侧：按关系强度动态边长（强关系更近，弱关系更远）；降低重力、增强斥力，使不同簇自然拉开。
2. 验收侧：补充本轮 JSON 后回填 `node_count / edge_count / relationTypeCounts / badcase`，更新本节为正式 R3 结果。

---

## R4（2026-05-30，JSON正式评测）

输入：
- `innex-graph-1780120142743.json`

核心指标：
- `node_count=11`
- `edge_count=17`
- `relationTypeCounts`：
  - `related=9`
  - `example_of=5`
  - `supports=3`
- `confidenceStats`：
  - `high=3`
  - `mid=14`
  - `low=0`
- `evidence.method`：
  - `structured_overlap_fallback=17/17`

本轮结论：
- 图谱状态：`部分通过`

评价：
1. 召回覆盖相比早期明显提升（边数充足，不再大面积孤点）。
2. 但判型质量仍不稳：`example_of` 数量偏高，且多条边集中在 `0.60` 临界分。
3. 证据来源单一：全部依赖 `structured_overlap_fallback`，说明 LLM 判型信号在这轮未有效进入主链路。

### R4 Badcase

| Case ID | 样本/边 | 问题类型 | 现象描述 | 证据（日志/JSON/截图） | 原因标签（待确认） | 修复动作（待确认） | 状态 |
| --- | --- | --- | --- | --- | --- | --- | --- |
| R4-C01 | 多条 `example_of@0.60`（如 Prompt/Agent 混连） | 类型错判/强度错判 | 语义更像弱 related，却被判为 example_of | `innex-graph-1780120142743.json` | `graph_confidence_misaligned` | 提高 `example_of` 准入阈值，并增加“定义-实例”结构证据约束 | 已确认待修复 |
| R4-C02 | 全部边 | 证据弱 | `evidence.method` 全为 fallback，缺少 LLM 结构化判型痕迹 | `innex-graph-1780120142743.json` | `graph_evidence_summary_weak` | 提升 LLM 判型命中率并强制记录 `llm_decision` 字段 | 已确认待修复 |
| R4-C03 | Prompt 主题簇内部 | 强度错判 | 大量边拥挤在中档置信度，强弱分层不明显 | 图谱截图 + JSON confidence 分布 | `graph_confidence_misaligned` | 拉开 `supports/related/weak` 阈值间距，补充负样本校准 | 已确认待修复 |

---

## R5（2026-05-30，JSON正式评测）

输入：
- `innex-graph-1780121611221.json`

核心指标：
- `node_count=11`
- `edge_count=8`
- `relationTypeCounts`（本轮导出中可读项）：
  - `related=1`
  - `weak_related=7`
  - `supports=0`（导出中未读到）
  - `example_of=0`（导出中未读到）
  - `fallback=0`（导出中未读到）
- `confidenceStats`：
  - `high=2`
  - `mid=6`
  - `low=0`
  - `unknown=0`
- `evidence.method`：
  - `structured_overlap_fallback=8/8`
  - `embedding_similarity_plus_overlap=0/8`

本轮结论：
- 图谱状态：`部分通过`

评价：
1. 相比 R4，边数从 `17 -> 8`，图谱更克制，误连风险有所下降。
2. 类型分布明显收敛到 `weak_related`，`example_of` 误判问题有缓解。
3. 但主问题仍在：`8/8` 都来自 fallback，LLM/embedding 判型仍未进入有效主链路，导致强关系不足、可解释性偏弱。

### R5 Badcase

| Case ID | 样本/边 | 问题类型 | 现象描述 | 证据（日志/JSON/截图） | 原因标签（待确认） | 修复动作（待确认） | 状态 |
| --- | --- | --- | --- | --- | --- | --- | --- |
| R5-C01 | 全部边 | 证据弱 | `evidence.method` 全为 fallback，未见 embedding/LLM 主导边 | `innex-graph-1780121611221.json` | `graph_evidence_summary_weak` | 提升向量召回命中并强制记录 LLM 成功判型率 | 已确认待修复 |
| R5-C02 | Prompt/Agent 主题簇 | 漏连 | 主题相关节点存在但强边数量偏少，整体偏弱连通 | 图谱截图 + JSON边分布 | `graph_missing_relation` | 放宽 embedding 首轮召回并提高结构化证据权重 | 已确认待修复 |
| R5-C03 | 远离节点（如技术栈/Java） | 分簇可读性风险 | 节点位置已分离，但由于边类型单一，难判断“真正无关”还是“召回不足” | 图谱截图 | `graph_confidence_misaligned` | 增加“无关系判定日志”与阈值回放 | 待分析 |

---

## R6（2026-05-30，JSON正式评测）

输入：
- `innex-graph-1780126939352.json`

核心指标：
- `node_count=27`
- `edge_count=19`
- `relationTypeCounts`（可读项）：
  - `related=7`
  - `weak_related=12`
  - `supports=0`（导出中未读到）
  - `example_of=0`（导出中未读到）
- `confidenceStats`：
  - `high=11`
  - `mid=8`
  - `low=0`
- `evidence.method`：
  - `semantic_seed_llm=7`
  - `structured_overlap_fallback=12`
  - `embedding_similarity_plus_overlap=0`

本轮结论：
- 图谱状态：`部分通过（较R5有进步）`

评价：
1. 主链路开始生效：`semantic_seed_llm=7`，不再是“全fallback”。
2. 但 fallback 仍偏高（`12/19`），弱边仍占主导。
3. 视觉上标签重叠严重，影响可读性；这是布局/标注密度问题，不完全是关系质量问题。

### R6 Badcase

| Case ID | 样本/边 | 问题类型 | 现象描述 | 证据（日志/JSON/截图） | 原因标签（待确认） | 修复动作（待确认） | 状态 |
| --- | --- | --- | --- | --- | --- | --- | --- |
| R6-C01 | 全局边方法分布 | 证据弱 | fallback 仍高，占比 `12/19` | `innex-graph-1780126939352.json` | `graph_evidence_summary_weak` | 继续提高主链路候选命中，压降 fallback 入库比重 | 已确认待修复 |
| R6-C02 | 多节点标签 | 可读性问题 | 标签重叠，肉眼难判断簇结构 | 图谱截图 | `graph_confidence_misaligned` | 引入标签避让/按缩放级别显示标签 | 已确认待修复 |
| R6-C03 | 强关系类型 | 类型覆盖不足 | `supports/example_of` 为空，关系表达维度不足 | JSON 关系类型分布 | `graph_wrong_relation` | 在主链路判型中加强 supports/example_of 判定触发 | 待分析 |

---

## R7（2026-05-30，Phase5B QA链路截图验收）

输入：
- 验收问题 7 条（按顺序追问）
- 证据：用户提供 QA 页面截图（16:27~16:32）

核心观察：
1. Q1（Prompt AB五步法）：
- 命中同主题笔记，回答正确，可用。
2. Q2（留存指标）：
- 回答“证据不足”，且引用了不相关 Prompt skill 记录，出现召回偏题。
3. Q3（追问控制变量）：
- 直接“证据不足”，未复用上一轮上下文。
4. Q4（PRD模块）：
- 回答正确，命中较好。
5. Q5（PRD最小模板）：
- 误召回到“表达训练”类笔记，出现 follow-up 续问断链。
6. Q6（意图识别评估指标）：
- 回答正确，命中较好。
7. Q7（与PRD是否关联）：
- 返回“证据不足”，未给出明确“无关联”判断。

判定：
- QA状态：`部分通过`

问题标签（本轮新增）：
- `qa_followup_misjudged`
- `qa_missing_evidence`

### R7 Badcase

| Case ID | 样本/边 | 问题类型 | 现象描述 | 证据（日志/JSON/截图） | 原因标签（待确认） | 修复动作（待确认） | 状态 |
| --- | --- | --- | --- | --- | --- | --- | --- |
| R7-C01 | Q2（留存指标） | 召回偏题 | 应该沿 Prompt AB 指标类笔记扩展，却召回到不相关 Prompt skill 笔记 | 16:28 截图 | `qa_missing_evidence` | 提升“同会话主题词”权重；source阶段加标题/标签重排 | 已确认待修复 |
| R7-C02 | Q5（PRD最小模板） | Follow-up断链 | 明确“继续上一个PRD话题”仍未复用PRD上下文 | 16:31 截图 | `qa_followup_misjudged` | 连续追问增加指代词触发（继续/上一个/刚才）强制复用上轮seed | 已确认待修复 |
| R7-C03 | Q7（关联判断） | 拒答策略偏硬 | 应该输出“无明显关联”，却直接“不足证据” | 16:32 截图 | `qa_followup_misjudged` | 增加“关系判断问题”的兜底模板：可明确答“暂无直接关联” | 已确认待修复 |

---

## R8（2026-05-30，JSON正式评测）

输入：
- `innex-graph-1780144033855.json`

核心指标：
- `node_count=20`
- `edge_count=24`
- `relationTypeCounts`：
  - `weak_related=21`
  - `related=3`
  - `supports=0`
  - `example_of=0`
- `confidenceStats`：
  - `high=6`
  - `mid=18`
  - `low=0`
  - `unknown=0`
- `evidence.method`（按边明细统计）：
  - `structured_overlap_fallback=21`
  - `semantic_seed_llm=3`

本轮结论：
- 图谱状态：`部分通过`

评价：
1. 召回覆盖继续提升（`20/24`），主体网络更完整。
2. 但关系类型明显失衡，弱边占比过高（`21/24`），强关系维度缺失。
3. 主链路有恢复迹象（出现 `semantic_seed_llm`），但占比仍偏低，fallback 仍主导。
4. 从截图看中心簇过密、标题重叠严重，可读性瓶颈转为布局问题。

### R8 Badcase

| Case ID | 样本/边 | 问题类型 | 现象描述 | 证据（日志/JSON/截图） | 原因标签（待确认） | 修复动作（待确认） | 状态 |
| --- | --- | --- | --- | --- | --- | --- | --- |
| R8-C01 | 全局关系类型分布 | 类型覆盖不足 | 仅 `related/weak_related`，`supports/example_of` 缺失 | `innex-graph-1780144033855.json` | `graph_wrong_relation` | 强化关系判型约束与证据模板，提升 supports/example_of 触发 | 已确认待修复 |
| R8-C02 | 全局边来源 | 证据弱 | fallback 仍占主导（`21/24`） | JSON `evidence.method` | `graph_evidence_summary_weak` | 继续提升 semantic_seed_llm 命中率并压降 fallback 比重 | 已确认待修复 |
| R8-C03 | 中心簇可视化 | 可读性问题 | 节点与标题在中心区域严重重叠，难以判读关系 | 你提供的图谱截图 | `graph_confidence_misaligned` | 放大节点间距、增强斥力、提高 linkDistance（本轮已实施） | 修复中 |

---

## R9（2026-05-30，图谱精度收敛短闭环 — 待回填）

- 版本：R8 后三件事改动版
  - Item2：强化关系判型器 prompt（supports/example_of 结构证据约束 + 泛词降权 + 置信度分档校准），阈值未动。
  - Item1：fallback 条件压降（仅当已有强边时 上限6->3、score>=3->>=4；无强边保持原状）。
  - Item3：QA 无关联判定兜底（`isRelationCheckQuestion` + 兜底文案“暂无直接关联”）。
- 构建：`apps/web` `npm run build` 通过。
- A/B 输入：
  - A（baseline）：R8 = `innex-graph-1780144033855.json`
  - B（本轮）：__待回填 graph JSON 文件名__
- 复测口径要求（必须同样本、同 7 题，不换题不换样本）：

### 图谱侧（重内化同样本后导出 JSON 回填）
- `node_count` / `edge_count`：__待填__
- `relationTypeCounts`（含 weak_related/fallback）：__待填__
  - 重点看：`supports/example_of` 是否从 0 出现；`weak_related` 占比是否下降。
- `confidenceStats`（high/mid/low）：__待填__
- `evidence.method` 占比：`semantic_seed_llm` / `embedding_similarity_plus_overlap` / `structured_overlap_fallback`：__待填__
  - 目标线：`semantic_seed_llm + embedding` 占比上升；`fallback / final_relations_count < 0.60`。
- 内化日志关键字段（每条笔记）：`strong_edge_count`、`fallback_compressed`、`llm_classified_count`、`fallback_edges_count`：__待填__

### QA 侧（同一套 7 题复测，重点 R7 三个 badcase）
- Q1（Prompt AB五步法）：__待填__
- Q2（留存指标，R7-C01 偏题）：__待填__（本轮重点验证：主题重排后是否仍召回到不相关 Prompt skill 笔记）
- Q3（追问控制变量，R7-C02 断链）：__待填__（本轮重点验证：续问指代是否复用上轮上下文）
- Q4（PRD模块）：__待填__
- Q5（PRD最小模板，R7-C02 断链）：__待填__（本轮重点验证：是否复用 PRD 上下文，Stage 3.7 followup_reuse 是否命中）
- Q6（意图识别评估指标）：__待填__
- Q7（与PRD是否关联，R7-C03 拒答过硬）：__待填__（本轮重点验证：是否输出“暂无直接关联”而非“证据不足”）

观测建议：复测时查 `retrieval_stage`（是否出现 `followup_reuse`）与 `graph_expand.followup_reference / followup_reuse_applied` 字段。

### R9 Badcase（复测后回填）

| Case ID | 样本/边 | 问题类型 | 现象描述 | 证据（日志/JSON/截图） | 原因标签（待确认） | 修复动作（待确认） | 状态 |
| --- | --- | --- | --- | --- | --- | --- | --- |
| R9-C01 |  |  |  |  |  |  | 待回填 |

### R8 -> R9 关闭/新增（复测后回填）
- R8-C01（supports/example_of 缺失）：用户确认主因是 benchmark 样本本身这两类少，非 bug，本轮不再改图谱；关注 R9 是否仍可读。
- R8-C02（fallback 主导）：__待确认是否关闭（看 R9 fallback 占比）__
- R7-C01（Q2 召回偏题）：本轮已加同会话主题重排，__待 R9-QA 确认关闭__
- R7-C02（Q3/Q5 follow-up 断链）：本轮已加续问指代复用 + Stage 3.7 直接复用，__待 R9-QA 确认关闭__
- R7-C03（Q7 拒答过硬）：上一轮已加无关联兜底，__待 R9-QA 确认关闭__
