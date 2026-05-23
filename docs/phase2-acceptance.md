# Phase2 验收清单（执行版）

## 当前结果快照（2026-05-21）
- 已完成：`npm run build` 通过（Next.js 编译、类型检查、路由生成均通过）
- 已完成：`/api/internalize`、`/api/qa` 已接入 `trace_id`、超时/重试、统一错误码
- 已完成：模型路由支持分用途配置（Parse/Internalize/QA/General/Embedding）
- 已完成：Embedding 独立路由到 SiliconFlow（`EMBEDDING_OPENAI_*`），不影响主 DeepSeek
- 风险/阻塞：以下 E2E 需在你本地真实 Supabase 数据与真实请求下点测确认

## A. 内化链路 E2E
- [ ] 在收录箱创建一条 `later` 记录（文本或链接）
- [ ] 点击列表/详情「一键内化」可进入草稿并保存
- [ ] 保存后状态变为 `已沉淀`
- [ ] `notes` 表出现对应记录（capture_item_id 对应）
- [ ] `note_chunks` 出现切片数据
- [ ] `note_relations` 至少可为空但接口不报错

通过标准：状态正确流转，且 notes/chunks 成功落库。

## B. RAG 问答 E2E
- [ ] 进入 `/qa` 输入问题并提问
- [ ] `/api/qa` 返回 answer + citations（有证据时）
- [ ] 点击「加入笔记」后，`ai_answers.saved_to_note=true`
- [ ] 详情抽屉可看到「AI助手回答」区

通过标准：可检索、可回答、可回写、可在详情回显。

## C. 证据不足分支
- [ ] 在空知识库或无关问题下提问
- [ ] 返回“证据不足/不确定”提示而非编造答案

通过标准：无证据时稳定降级，不抛 500。

## D. 知识库联动
- [ ] 收录箱「知识库定位」可跳转 `/kb?captureItemId=...`
- [ ] `/kb` 自动高亮对应笔记
- [ ] 点击右侧“关联笔记”可切换详情并同步高亮目标卡片

通过标准：定位 + 关联切换闭环可用。

## E. 稳定性与日志
- [ ] `/api/internalize` 返回 `trace_id`
- [ ] `/api/qa` 返回 `trace_id`
- [ ] 服务端日志可按 `trace_id` 追踪 start/success/failed

通过标准：单次请求可完整追踪。

---

## 通过/阻塞/风险（阶段结论）
- 通过：Phase2 代码闭环已打通，构建与类型检查通过，核心 API 已具备生产前的最小稳定性措施。
- 阻塞：数据库迁移与真实数据 E2E 仍需你本地逐项点击验收（A/B/C/D）。
- 风险：当前 `.env.local` 中出现过真实密钥，建议立即轮换 DeepSeek/OpenAI/SiliconFlow key 后再继续联调。
