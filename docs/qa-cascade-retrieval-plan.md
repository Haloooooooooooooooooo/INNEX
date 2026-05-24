# QA 级联检索执行计划

## 目标
- 提升问答命中率与速度：先用标题/摘要粗召回，再在候选范围做深检索。
- 减少“知识库有内容但答不出来”的情况。

## 策略（两阶段 + 兜底）
1. 第一阶段（粗召回）
- 在 `notes.title + notes.summary` 上做关键词召回，取 `topN note_id` 候选集。

2. 第二阶段（深检索）
- 仅在候选 `note_id` 范围内对 `note_chunks` 做向量检索，取高相关 chunk。
- 生成回答时优先使用该阶段证据。

3. 兜底策略
- 若候选集为空或深检索为空，退回全库向量检索（现有链路）。
- 全库向量仍为空时，走关键词兜底（`notes.title/content`）。

## 数据库改造
- 新增 RPC：`match_note_chunks_in_notes(...)`
  - 输入：`query_embedding`, `p_user_id`, `p_note_ids`, `match_threshold`, `match_count`
  - 输出：与 `match_note_chunks` 同结构

## API 改造（/api/qa）
- 增加 `coarseRecallNotes`（标题/摘要召回）
- 先调用 `coarseRecallNotes`
- 若有候选，调用 `match_note_chunks_in_notes`
- 若无结果，按“兜底策略”继续
- 在响应里返回 `retrieval_stage` 调试信息

## 验收标准
1. 级联路径可执行
- 日志可见 `coarse_candidate_count` 与 `scoped_chunk_count`

2. 召回命中提升
- 在已有 PDF 沉淀场景下，同问题较改造前更少出现 `QA_INSUFFICIENT_EVIDENCE`

3. 性能可接受
- 平均响应时间不显著恶化（P95 不超过改造前 +30%）

4. 兼容性
- 旧链路仍可工作（候选为空时可回退全库）

