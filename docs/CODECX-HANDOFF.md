# Codex 交接文档

> 最后更新：2026-05-20

## 一、项目概述

INNEX — 个人知识内化助手。把用户输入的文字/链接/图片/文档收录到收件箱，LLM 自动生成摘要和标签，然后一键内化为结构化笔记，最终支持基于笔记的 RAG 问答和知识图谱浏览。

**技术栈：** Next.js 16 (App Router) + Tailwind v4 + shadcn/ui v4 (base-ui) + Supabase (Auth/PostgreSQL/pgvector/RLS) + DeepSeek API (LLM) + OpenAI API (Embeddings)

**代码位置：** `apps/web/`

---

## 二、已完成

### Phase 1：认证 + 收录箱 CRUD

| 功能 | 文件 |
|------|------|
| 邮箱注册/登录/退出 | `app/login/`, `app/register/`, `providers/auth-provider.tsx`, `proxy.ts` (路由守卫) |
| 收录箱页面 | `app/inbox/page.tsx` → `components/inbox/inbox-page.tsx` |
| 快速录入（单框+双按钮+附件） | `components/inbox/quick-capture.tsx` |
| 收录箱表格（7列，按状态操作按钮） | `components/inbox/inbox-table.tsx` |
| 筛选 Tab（全部/稍后看/待内化/已沉淀）+ 搜索 | `components/inbox/inbox-toolbar.tsx` |
| 详情抽屉（字段/摘要/我的理解/笔记本/附件/AI笔记/内化草稿） | `components/inbox/inbox-drawer.tsx` |
| 状态流转按钮 + 删除二次确认 | `components/inbox/inbox-drawer.tsx` (AlertDialog) |
| 日历弹窗 + 信息卡（UI 占位） | `components/shared/calendar-popover.tsx`, `components/shared/info-modal.tsx` |
| KB 页面（已沉淀笔记卡片） | `app/kb/page.tsx` |
| QA 页面（RAG 问答界面） | `app/qa/page.tsx`, `components/qa/` |
| 布局（深色侧边导航 + TopBar + 用户菜单） | `components/layout/` |
| Design Tokens | `app/globals.css` (CSS 变量 → Tailwind v4 @theme) |
| 数据库 Phase 1 | `supabase/migrations/001_initial_schema.sql` (profiles + capture_items + attachments + RLS) |

### Phase 2：LLM 集成 + 内化 + RAG QA（**后端已完成，前端部分未完成**）

| 功能 | 文件 | 状态 |
|------|------|------|
| LLM 客户端（DeepSeek + OpenAI） | `lib/llm/provider.ts`, `client.ts`, `prompts.ts` | ✅ |
| 轻解析模块（类型检测+可读性+生成） | `lib/parse/detector.ts`, `generator.ts`, `prompts.ts` | ✅ |
| URL 页面抓取（标题+正文+meta） | `app/api/parse-url/route.ts` | ✅ |
| 收录 API（接入轻解析，LLM 生成摘要标签） | `app/api/capture-items/route.ts` | ✅ |
| 内化 API | `app/api/internalize/route.ts` | ✅ |
| 笔记 CRUD API | `app/api/notes/route.ts`, `[id]/route.ts` | ✅ |
| RAG QA API | `app/api/qa/route.ts`, `app/api/qa/save/route.ts` | ✅ |
| 数据库 Phase 2 | `supabase/migrations/002_phase2_schema.sql` (notes + note_relations + ai_answers + note_chunks + pgvector + match_note_chunks RPC) | ✅ 但**用户未执行迁移** |
| 🔴 内化 Agent 真实调用 | `app/api/internalize/route.ts` | ❌ 有骨架但未经测试 |
| 🔴 RAG QA 真实调用 | `app/api/qa/route.ts` | ❌ 有骨架但未经测试 |
| 🔴 一键内化按钮真实触发 | `components/inbox/inbox-drawer.tsx` | ❌ `enterDraftMode()` 显示占位文本，未调 LLM |
| 🔴 Docling 侧车 | `services/docling-service/` | ❌ 未创建 |

---

## 三、当前正在做的事

**Phase 1 的轻解析调试。** 录入一条内容 → 系统自动判断类型 → LLM 生成摘要+标签。当前问题：

1. 粘贴链接后 `/api/parse-url` 抓取页面标题和正文
2. 正文传给 LLM（DeepSeek）生成摘要和标签
3. 有时页面抓取失败或超时，导致摘要/标签为空

最新改动：提交按钮在 URL 内容抓取期间禁用，防止用户抢在抓完之前提交。

---

## 四、未完成

### 高优先级

| 问题 | 说明 |
|------|------|
| 轻解析质量不稳定 | 取决于页面抓取成功率。有些网站（微信公众号）可能反爬或超时 |
| 内化 Agent 未测试 | `POST /api/internalize` 代码写完但从未跑过——需要先执行 002 迁移 |
| 一键内化按钮未接通 | 抽屉里点"一键内化"只显示占位，没有真正调内化 API |
| pgvector 迁移未执行 | 002_phase2_schema.sql 用户还没跑，所有 Phase 2 功能不可用 |

### 中优先级

| 问题 | 说明 |
|------|------|
| 笔记本区域未持久化 | 抽屉里的"笔记本" textarea 保存按钮不存 DB——没有对应列 |
| 知识库定位按钮 | 占位，未实现跳转 |
| 基于此笔记提问按钮 | 占位，未实现上下文挂载 |
| 附件上传只是元数据 | 文件选中后只记录名字/大小/类型，没有真正上传到 Supabase Storage |
| 图片粘贴 | 不支持 |
| 已沉淀抽屉的 AI 笔记 | 占位文字，未读真实 notes 表 |

### 低优先级

| 问题 | 说明 |
|------|------|
| 响应式 | 目前最小宽度 ~1024px，移动端未做 |
| Docling 侧车 | 完全没有创建 |
| 知识图谱 | Phase 3，未开始 |

---

## 五、关键文件/目录结构

```
apps/web/
├── app/
│   ├── page.tsx                          # → 重定向 /inbox 或 /login
│   ├── layout.tsx                        # 根布局 + AuthProvider
│   ├── globals.css                       # Tailwind v4 + Design Tokens
│   ├── proxy.ts                          # 路由守卫 (原 middleware.ts，Next 16 改名)
│   ├── login/page.tsx                    # 登录页
│   ├── register/page.tsx                 # 注册页
│   ├── inbox/page.tsx                    # 收录箱 ← 核心页面
│   ├── kb/page.tsx                       # 知识库（笔记卡片列表）
│   ├── qa/page.tsx                       # RAG 问答
│   ├── ai/page.tsx                       # → redirect /qa
│   └── api/
│       ├── auth/register|login|logout|me/ # 认证 API
│       ├── capture-items/route.ts         # GET 列表 + POST 创建（含轻解析）
│       ├── capture-items/[id]/route.ts    # GET/PATCH/DELETE（含级联删笔记）
│       ├── parse-url/route.ts             # URL 抓取：标题+正文+meta
│       ├── internalize/route.ts           # 内化 Agent
│       ├── notes/route.ts                 # 笔记列表
│       ├── notes/[id]/route.ts            # 笔记详情/更新/删除
│       ├── qa/route.ts                    # RAG 问答
│       └── qa/save/route.ts              # 保存回答
├── components/
│   ├── layout/       # app-layout, topbar, nav
│   ├── auth/         # login-form, register-form, user-menu
│   ├── inbox/        # inbox-page, quick-capture, inbox-table, inbox-toolbar, inbox-drawer
│   ├── qa/           # qa-page, answer-display, citation-card
│   └── shared/       # status-badge, tag-chip, calendar-popover, info-modal
├── hooks/
│   ├── use-capture-items.ts   # 收录箱数据 hook
│   └── use-notes.ts           # 笔记数据 hook
├── lib/
│   ├── supabase/     # client.ts, server.ts, types.ts
│   ├── llm/          # provider.ts, client.ts, prompts.ts
│   └── parse/        # detector.ts, generator.ts, prompts.ts
├── providers/
│   └── auth-provider.tsx      # AuthContext + useAuth
└── supabase/migrations/
    ├── 001_initial_schema.sql  # Phase 1 建表（已执行）
    └── 002_phase2_schema.sql   # Phase 2 建表（未执行！）
```

---

## 六、规范文档

必读，按优先级：

1. **`docs/录入-解析-展示规范.md`** ← 最核心，录入/解析/详情页的所有规则
2. **`docs/全部功能.md`** ← 完整功能 PRD
3. **`docs/全局架构设计.md`** ← 技术架构 + Phase 1/2/3 路线
4. **`docs/执行计划-收录箱CRUD.md`** ← Phase 1 原始计划

---

## 七、环境变量

在 `apps/web/.env.local`：

```
NEXT_PUBLIC_SUPABASE_URL=https://rkoroeponxlvvewyhylu.supabase.co
NEXT_PUBLIC_SUPABASE_ANON_KEY=eyJ...(JWT)
DEEPSEEK_API_KEY=sk-2a0fc3fce2d544c093ccb673e5d8f728
OPENAI_API_KEY=sk-ic140CXeFEIF4RJlogi7ao8Xa5qC6Xx7myvdithcCgmK9sA0
OPENAI_BASE_URL=https://vortexaiapi.com/v1
```

---

## 八、下一步计划

1. **调试轻解析** — 确保粘贴链接+文字能稳定生成摘要和标签
2. **执行 002 迁移** — `supabase/migrations/002_phase2_schema.sql`（在 Supabase SQL Editor 跑）
3. **接通一键内化** — 抽屉"一键内化"→ 调 `/api/internalize` → 生成笔记 → 状态变 crystallized
4. **测试 RAG QA** — 确认 pgvector 可用 → 提问 → 检索 → 生成带引用回答
5. **持久化笔记本** — 给抽屉笔记本加 DB 列或复用现有列

---

## 九、已知约定

- 所有 API 路由先 `getUser()` 再返回 —— 无例外
- Next.js 16 动态路由 params 是 Promise：`{ params: Promise<{ id: string }> }` + `await params`
- middleware.ts 已改名为 proxy.ts（Next.js 16 要求）
- 样式用 Tailwind v4 `@theme inline`，组件里用 `bg-[--paper]` 引用 CSS 变量
- shadcn/ui v4 用的是 `@base-ui/react` 不是 Radix——`asChild` 不支持，Select `onValueChange` 签名不同
- 所有数据库表必须开 RLS + 4 个策略（SELECT/INSERT/UPDATE/DELETE = auth.uid() = user_id）
