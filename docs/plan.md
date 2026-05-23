# INNEX 项目总计划（plan）

> 维护规则
- 本文件是全阶段唯一计划台账。
- 所有阶段任务都持续追加在这里。
- 完成项必须在任务前标记 `✅`。
- 未完成项保持 `⬜`。
- 本文件与 `docs/全局架构设计.md` 必须同步更新。

---

## Phase 1（收录箱 CRUD + 录入/解析/展示）

### 状态
- ✅ 已基本完成（已进入收尾与修正阶段）

### 收尾项
- ⬜ 详情抽屉样式与 `background-base.html` 做最后像素级对齐
- ⬜ 对照 `docs/录入-解析-展示规范.md` 做一次逐条验收复核
- ⬜ 归档 Phase1 验收结果到本文件

---

## Phase 2（内化 Agent + RAG QA + 知识库联动）

### 2.0 阶段目标
- 打通“待内化 -> 一键内化 -> 已沉淀 -> 可问答 -> 可定位”的完整闭环。
- 所有实现以 `docs/全局架构设计.md` 为主基线。

### 2.1 基础准备（数据库与环境）
- ⬜ 执行并确认 `apps/web/supabase/migrations/002_phase2_schema.sql`
- ⬜ 校验 `notes / note_relations / ai_answers / note_chunks / match_note_chunks` 是否可用
- ⬜ 校验 `pgvector` 扩展是否可用
- ✅ 补齐并验证 Phase2 必要环境变量（LLM、Embedding、BaseURL）

### 2.2 一键内化链路（P0）
- ✅ 内化草稿视图改为真实生成（dryRun），支持编辑后保存
- ✅ 抽屉“一键内化”按钮改为真实触发 `/api/internalize`
- ✅ 内化 API 读取 capture_item + attachments + my_understanding
- ✅ 生成结构化笔记（Markdown）并写入 `notes`
- ✅ 生成并写入 `note_relations`（先最小可用：相似/同主题）
- ✅ capture_item 状态更新为 `crystallized`
- ✅ 抽屉中 AI 笔记区展示真实 `notes` 内容（不再占位）
- ✅ 内化失败时返回明确错误并前端 toast 提示

### 2.3 RAG 问答链路（P0）
- ✅ 已沉淀笔记切片并写入 `note_chunks`
- ✅ 生成 embedding 并完成向量入库
- ✅ `/api/qa` 实现检索 + 生成 + 引用返回
- ✅ `/qa` 页面改为真实调用并展示引用来源
- ✅ 证据不足时明确返回“不确定/证据不足”

### 2.4 回写能力（P1）
- ✅ `/api/qa/save` 将高价值问答回写 `ai_answers`
- ✅ 已沉淀详情抽屉新增“AI 助手回答”区（仅有数据时显示）
- ✅ “加入笔记”动作可把问答挂到当前笔记

### 2.5 知识库定位联动（P1）
- ✅ “知识库定位”按钮从收录箱跳转到 `/kb`
- ✅ 根据 note/capture 关联定位并高亮目标节点（先最小可用）
- ✅ 点击关联笔记可切换详情并同步高亮

### 2.6 文档与解析增强（P1）
- ⬜ 评估并接入 Docling sidecar（最小：PDF/Word）
- ⬜ 大文件“内化后读取”路径改为内化阶段真实解析
- ⬜ 输出解析失败原因并可在前端看到

### 2.7 稳定性与观测（P1）
- ✅ 为 `/api/internalize`、`/api/qa` 增加结构化日志（trace_id）
- ✅ 增加超时、重试、降级策略（模型不可用时）
- ✅ 建立最小错误码表（前后端统一）

### 2.8 测试与验收（P0）
- ⬜ 内化链路端到端测试（later/pending -> crystallized）
- ⬜ RAG 问答端到端测试（有引用、可回写）
- ✅ 回归测试：不影响 Phase1 录入/解析/展示
- ✅ 输出 Phase2 验收报告（通过/阻塞/风险）

### 2.9 A->C->D->B 执行清单（本轮）
- ✅ A1：PDF 本地解析改造为 `pdfjs` 服务端直读（移除 worker 依赖问题）
- ✅ A2：PDF 解析增加元信息（页数、总字数、每页字数、疑似扫描版判定）
- ✅ A3：提取链路落日志 notes（`pdf_extract_meta:*` / `pdf_likely_scanned:*`）
- ✅ C1：新增记录后自动短轮询回填（progressive hydrate），补齐摘要/标签最终态
- ✅ C2：录入成功 toast 增强，显示“已收录，摘要/标签稍后补全”与失败原因
- ✅ D1：新增 `/api/parser-health`，独立检查解析层健康状态（PDFJS/OCR配置）
- ✅ B1：`parse_debug` 新增 `stages` 结构（detect/extract/summarize/tags）
- ⬜ B2：`raw_text_blocks` 结构化落库（需数据库字段迁移后实施）
- ⬜ B3：解析阶段耗时指标（需统一 tracing 字段后实施）

---

## Phase 3（知识图谱与高级体验）

### 状态
- ⬜ 未开始

### 预备任务
- ⬜ 图谱节点/边模型最终定稿
- ⬜ React Flow（xyflow）接入与交互规范落地
- ⬜ 每日/每周反馈卡真实数据化

---

## 变更同步清单（强制）
- ⬜ 每次任务变更后同步更新 `docs/全局架构设计.md`
- ⬜ 如涉及交互/字段变更，同步更新 `docs/录入-解析-展示规范.md`
- ⬜ 如涉及阶段边界变更，同步更新本 `plan.md`



