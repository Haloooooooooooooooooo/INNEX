# 执行计划：收录箱 CRUD（第一阶段）

## 目标

把 `background-base.html` 中的收录箱原型，用 Next.js + Supabase 重写为真实可用的 CRUD 应用。包含完整的认证系统：注册、登录、退出、切换账户、数据隔离。

## 不做的事

- 不做内化 Agent（第二阶段）
- 不做知识图谱和 AI 助手逻辑（第三阶段）
- 不做文档解析服务（第二阶段）
- 不引入 Mastra / CopilotKit / React Flow（后续阶段再评估）
- 不做 OAuth 社交登录（后续再加 GitHub/Google）

## 技术栈

| 层 | 选型 | 说明 |
|----|------|------|
| 框架 | Next.js 15 + App Router | 页面路由、API Routes、Server Components、Middleware |
| 样式 | Tailwind CSS + shadcn/ui | 原型中的 CSS 变量→Tailwind theme tokens |
| 认证 | Supabase Auth (邮箱+密码) | 注册/登录/退出/切换账户 |
| 数据库 | Supabase PostgreSQL | 收录记录、附件、profiles |
| RLS | Row Level Security | 所有表启用，user_id = auth.uid() |
| 客户端 | Supabase JS SDK | Auth + DB + Storage |
| LLM 主力 | DeepSeek API | 文本任务（摘要/标签/内化笔记/RAG 问答），第二阶段接入 |
| LLM 多模态 | GPT-4o | 图片 OCR/理解等 DeepSeek 不支持的任务，第二阶段接入 |

## 数据库表

第一阶段建 3 张表（profiles + capture_items + attachments）：

### profiles

```sql
CREATE TABLE public.profiles (
  id         UUID PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  username   TEXT,
  avatar_url TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

ALTER TABLE profiles ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can view own profile"
  ON profiles FOR SELECT
  USING (auth.uid() = id);

CREATE POLICY "Users can update own profile"
  ON profiles FOR UPDATE
  USING (auth.uid() = id);
```

注册触发器：`auth.users` INSERT 后自动创建 `profiles` 行。

### capture_items

```sql
CREATE TABLE capture_items (
  id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id          UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  type             TEXT NOT NULL DEFAULT 'text',
  title            TEXT NOT NULL,
  source           TEXT NOT NULL,
  source_url       TEXT,
  raw_content      TEXT,
  my_understanding TEXT,
  summary          TEXT,
  status           TEXT NOT NULL DEFAULT 'pending',
  tags             TEXT[] DEFAULT '{}',
  created_at       TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at       TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

ALTER TABLE capture_items ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can view own items"    ON capture_items FOR SELECT  USING (auth.uid() = user_id);
CREATE POLICY "Users can insert own items"  ON capture_items FOR INSERT  WITH CHECK (auth.uid() = user_id);
CREATE POLICY "Users can update own items"  ON capture_items FOR UPDATE  USING (auth.uid() = user_id);
CREATE POLICY "Users can delete own items"  ON capture_items FOR DELETE  USING (auth.uid() = user_id);
```

### attachments

```sql
CREATE TABLE attachments (
  id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  capture_item_id  UUID REFERENCES capture_items(id) ON DELETE CASCADE,
  user_id          UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  file_name        TEXT NOT NULL,
  file_type        TEXT NOT NULL,
  file_size        BIGINT,
  storage_path     TEXT,
  created_at       TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

ALTER TABLE attachments ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can view own attachments"   ON attachments FOR SELECT  USING (auth.uid() = user_id);
CREATE POLICY "Users can insert own attachments" ON attachments FOR INSERT  WITH CHECK (auth.uid() = user_id);
CREATE POLICY "Users can delete own attachments" ON attachments FOR DELETE  USING (auth.uid() = user_id);
```

## 目录结构

```
apps/web/
├─ middleware.ts                        # 路由守卫 (auth check → redirect /login)
├─ app/
│  ├─ layout.tsx                        # 根布局
│  ├─ page.tsx                          # 重定向 /inbox (需登录)
│  ├─ login/
│  │  └─ page.tsx                       # 登录页
│  ├─ register/
│  │  └─ page.tsx                       # 注册页
│  ├─ inbox/
│  │  └─ page.tsx                       # 收录箱页面
│  ├─ kb/
│  │  └─ page.tsx                       # 知识库（占位）
│  ├─ ai/
│  │  └─ page.tsx                       # AI 助手（占位）
│  └─ api/
│     ├─ auth/
│     │  ├─ register/route.ts           # POST 注册
│     │  ├─ login/route.ts              # POST 登录
│     │  ├─ logout/route.ts             # POST 退出
│     │  └─ me/route.ts                 # GET 当前用户
│     └─ capture-items/
│        ├─ route.ts                    # GET 列表 / POST 新增
│        └─ [id]/
│           └─ route.ts                 # GET 详情 / PATCH 更新 / DELETE 删除
│
├─ components/
│  ├─ layout/
│  │  ├─ app-layout.tsx                 # 整体布局容器（仅登录后可见）
│  │  ├─ topbar.tsx                     # 顶栏（消息图标 + 用户头像 + 退出/切换）
│  │  └─ nav.tsx                        # 左侧导航
│  ├─ auth/
│  │  ├─ login-form.tsx                 # 登录表单
│  │  ├─ register-form.tsx              # 注册表单
│  │  └─ user-menu.tsx                  # 用户头像下拉菜单（退出/切换账户）
│  ├─ inbox/
│  │  ├─ inbox-page.tsx                 # 收录箱页面主体
│  │  ├─ quick-capture.tsx              # 快速录入卡片
│  │  ├─ inbox-table.tsx                # 收录列表表格
│  │  ├─ inbox-toolbar.tsx              # 搜索 + Tab 切换
│  │  ├─ inbox-drawer.tsx               # 右侧详情抽屉
│  │  └─ internalization-draft.tsx      # 内化草稿视图（第二阶段实现逻辑）
│  ├─ shared/
│  │  ├─ calendar-popover.tsx           # 日历弹窗
│  │  ├─ info-modal.tsx                 # 信息卡弹窗
│  │  ├─ status-badge.tsx               # 状态 tag
│  │  ├─ tag-chip.tsx                   # 标签 chip
│  │  └─ confirm-dialog.tsx             # 确认删除弹窗（shadcn AlertDialog）
│  └─ ui/                               # shadcn/ui 基础组件
│
├─ lib/
│  ├─ supabase/
│  │  ├─ client.ts                      # Browser client (含 auth)
│  │  ├─ server.ts                      # Server component client (含 auth)
│  │  ├─ middleware.ts                  # Middleware client (cookie-based)
│  │  └─ types.ts                       # 数据库类型定义
│  ├─ styles/
│  │  └─ tokens.ts                      # 原型 CSS 变量 → Tailwind config
│  └─ utils.ts
│
├─ hooks/
│  ├─ use-auth.ts                       # 认证状态 hook (user, session, signIn, signOut)
│  └─ use-capture-items.ts             # 收录箱数据 hook
│
└─ providers/
   └─ auth-provider.tsx                 # AuthContext → 全 app 共享 user 对象
```

## 任务拆分（8 步）

### 步骤 0：项目脚手架

- [ ] 0.1 创建 `apps/web`，初始化 Next.js + Tailwind + shadcn
- [ ] 0.2 创建 Supabase 项目，获取 URL + anon key
- [ ] 0.3 配置环境变量 `.env.local`
- [ ] 0.4 执行建表 SQL（profiles + capture_items + attachments + RLS 策略 + 触发器）
- [ ] 0.5 创建 `lib/supabase/client.ts` / `server.ts` / `middleware.ts`
- [ ] 0.6 生成 TypeScript 类型

### 步骤 1：认证系统

- [ ] 1.1 `providers/auth-provider.tsx`：AuthContext 封装，全局提供 user + session
- [ ] 1.2 `hooks/use-auth.ts`：signUp / signIn / signOut / switchAccount hooks
- [ ] 1.3 `middleware.ts`：路由守卫，未登录重定向 /login
- [ ] 1.4 `/login/page.tsx` + `login-form.tsx`：邮箱 + 密码登录
- [ ] 1.5 `/register/page.tsx` + `register-form.tsx`：邮箱 + 密码注册
- [ ] 1.6 API Routes：`/api/auth/register`、`/login`、`/logout`、`/me`
- [ ] 1.7 退出登录 → 清除 session → 重定向 /login → 数据不可见
- [ ] 1.8 `user-menu.tsx`：用户头像下拉 → 切换账户 / 退出登录

### 步骤 2：Design Tokens 迁移

- [ ] 2.1 把原型 `:root` 中的 CSS 变量翻译成 Tailwind config
- [ ] 2.2 配置字体：JetBrains Mono、Space Grotesk
- [ ] 2.3 验证：布局底色、accent 色、文字颜色与原型一致

### 步骤 3：布局框架

- [ ] 3.1 `app-layout.tsx`：左 nav + 右 main-area 的 flex 布局（仅登录后可见）
- [ ] 3.2 `topbar.tsx`：消息图标 + 用户头像下拉菜单
- [ ] 3.3 `nav.tsx`：收录箱 / 知识库 / AI 助手导航（next/link）
- [ ] 3.4 `/page.tsx`：根路由 → 已登录重定向 /inbox，未登录重定向 /login

### 步骤 4：API Routes（收录箱 CRUD）

- [ ] 4.1 `GET /api/capture-items`：列表查询（带 user_id 筛选 + status/search 参数）
- [ ] 4.2 `POST /api/capture-items`：新增记录（自动注入 user_id）
- [ ] 4.3 `GET /api/capture-items/[id]`：单条详情（owner 校验）
- [ ] 4.4 `PATCH /api/capture-items/[id]`：更新字段（owner 校验）
- [ ] 4.5 `DELETE /api/capture-items/[id]`：删除 + 级联附件（owner 校验）

### 步骤 5：收录箱页面组件

- [ ] 5.1 `inbox-page.tsx`：组合 quick-capture + inbox-toolbar + inbox-table
- [ ] 5.2 `quick-capture.tsx`：内容输入、我的理解、附件、状态按钮、提交 → Supabase 入库
- [ ] 5.3 `inbox-toolbar.tsx`：全部 / 稍后看 / 待内化 / 已沉淀 Tab + 搜索框
- [ ] 5.4 `inbox-table.tsx`：7 列表格 + 行操作按钮（数据来自 Supabase 实时查询）
- [ ] 5.5 `hooks/use-capture-items.ts`：SWR/React Query 封装，自动按 user_id 过滤

### 步骤 6：详情抽屉 + 状态流转

- [ ] 6.1 `inbox-drawer.tsx`：右侧滑出抽屉（字段展示完整）
- [ ] 6.2 稍后看 → 转待内化 → 已沉淀 的状态流转（PATCH API + UI 更新）
- [ ] 6.3 `internalization-draft.tsx`：内化草稿视图（UI 完成，逻辑占位）
- [ ] 6.4 查看原笔记按类型分发（链接→ window.open / 文字→ 弹窗 / 文档→ 下载）
- [ ] 6.5 删除确认：shadcn AlertDialog 替换浏览器原生 confirm

### 步骤 7：共享组件 + 收尾

- [ ] 7.1 `calendar-popover.tsx` + `info-modal.tsx`：日历和信息卡 UI（真实数据第二版做）
- [ ] 7.2 `status-badge.tsx`、`tag-chip.tsx`：状态和标签展示
- [ ] 7.3 响应式适配（最小宽度 1024px，移动端暂不做）
- [ ] 7.4 知识库 + AI 助手占位页面
- [ ] 7.5 与原型 UI 对照检查，确保视觉还原度

### 步骤 8：验证数据隔离

- [ ] 8.1 注册两个不同用户，各自录入数据
- [ ] 8.2 验证用户 A 看不到用户 B 的数据
- [ ] 8.3 验证退出登录后 API 返回 401
- [ ] 8.4 验证切换账户后数据切换到新账户
- [ ] 8.5 验证退出后直接访问 /inbox 被重定向到 /login
- [ ] 8.6 验证 RLS 兜底——通过 Supabase Dashboard 直接查表，RLS 仍然生效

## 验收标准

- [x] 用户可注册账号（邮箱+密码），登录后进入收录箱
- [x] 用户可以录入内容（文本/链接），选择意图（稍后看/收藏），记录出现在列表
- [x] 列表支持按状态 Tab 筛选（全部/稍后看/待内化/已沉淀）
- [x] 搜索框可筛选标题、标签、来源
- [x] 点击表格行或操作按钮打开右侧详情抽屉
- [x] 状态流转：稍后看 → 转待内化 → 一键内化（UI 完成）
- [x] 删除有二次确认弹窗（shadcn AlertDialog）
- [x] 不同用户的数据完全隔离
- [x] 退出登录后看不到任何数据，访问 /inbox 被重定向
- [x] 切换账户后数据实时切换
- [x] 页面视觉与原型基本一致
