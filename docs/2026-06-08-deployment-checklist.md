# INNEX 部署任务清单

更新时间：2026-06-08

目标：让其他人可以从外部设备访问 INNEX。

当前部署架构：

- `apps/web`：Next.js 16 前端，建议部署到 `Vercel`
- `parser-service`：FastAPI PDF 解析服务，建议部署到 `Railway` 或 `Render`
- `Supabase`：托管数据库和存储

## 总清单

- [x] 1. 准备代码仓库可部署状态
- [ ] 2. 确认并整理生产环境变量
- [x] 3. 确认 Supabase 项目和 Storage bucket 可用
- [x] 4. 部署 `parser-service`
- [x] 5. 获取 `parser-service` 公网地址
- [ ] 6. 部署 `apps/web` 到 Vercel
- [ ] 7. 在 Vercel 填写生产环境变量
- [ ] 8. 首次线上访问验证
- [ ] 9. 验证 PDF 解析链路
- [ ] 10. 验证 LLM 链路
- [ ] 11. 用手机和另一台设备验收
- [ ] 12. 绑定正式域名和 HTTPS

## 每步完成标准

### 1. 准备代码仓库可部署状态

完成标准：

- `apps/web` 本地可以执行 `npm install`
- `apps/web` 本地可以执行 `npm run build`
- 没有阻塞部署的报错

记录：

- 状态：已完成
- 备注：`apps/web` 已执行 `npm install` 和 `npm run build`，Next.js 生产构建成功。

### 2. 确认并整理生产环境变量

完成标准：

- 以下变量已经准备好值

```env
NEXT_PUBLIC_SUPABASE_URL=
NEXT_PUBLIC_SUPABASE_ANON_KEY=
SUPABASE_STORAGE_BUCKET=capture-files
PARSER_SERVICE_URL=

DEEPSEEK_BASE_URL=https://api.deepseek.com
DEEPSEEK_API_KEY=

OPENAI_BASE_URL=https://api.openai.com/v1
OPENAI_API_KEY=
OPENAI_CHAT_MODEL=gpt-4o-mini
OPENAI_VISION_MODEL=gpt-4o
OPENAI_EMBEDDING_MODEL=text-embedding-3-small

LLM_PARSE_PROVIDER=deepseek
LLM_INTERNALIZE_PROVIDER=deepseek
LLM_QA_PROVIDER=deepseek
LLM_GENERAL_PROVIDER=deepseek
LLM_EMBEDDING_PROVIDER=openai
LLM_EMBEDDING_MODEL=text-embedding-3-small
```

记录：

- 状态：未开始
- 备注：

### 3. 确认 Supabase 项目和 Storage bucket 可用

完成标准：

- 你已经选定正式使用的 Supabase 项目
- 已确认 bucket `capture-files` 存在
- `NEXT_PUBLIC_SUPABASE_URL` 和 `NEXT_PUBLIC_SUPABASE_ANON_KEY` 来自同一个项目

记录：

- 状态：已完成
- 备注：已拿到 `NEXT_PUBLIC_SUPABASE_URL`、`NEXT_PUBLIC_SUPABASE_ANON_KEY`，并确认 bucket `capture-files` 存在。

### 4. 部署 `parser-service`

完成标准：

- 服务已部署到 `Railway` 或 `Render`
- 安装了 `requirements.txt`
- 启动命令可正常运行

当前选择平台：

- `Railway`

建议启动命令：

```bash
uvicorn main:app --host 0.0.0.0 --port $PORT
```

记录：

- 状态：已完成
- 备注：已在 `Railway` 创建并成功部署，Root Directory 为 `parser-service`。

### 5. 获取 `parser-service` 公网地址

完成标准：

- 你拿到一个可公网访问的 URL
- 打开 `GET /health` 返回正常

记录：

- 状态：已完成
- 备注：已确认 Railway 公网地址可用，`/health` 返回 `{"ok":true,"ready":false,"init_error":null}`。生产环境优先使用 `https://api.innex.mmuxyq.cn`。

### 6. 部署 `apps/web` 到 Vercel

完成标准：

- 已导入 Git 仓库到 Vercel
- Root Directory 选择 `apps/web`
- 构建成功

记录：

- 状态：未开始
- 备注：

### 7. 在 Vercel 填写生产环境变量

完成标准：

- 已填写第 2 步变量
- `PARSER_SERVICE_URL` 已替换为线上地址

记录：

- 状态：未开始
- 备注：

### 8. 首次线上访问验证

完成标准：

- 首页可访问
- 关键页面无明显报错
- 控制台和部署日志无阻塞错误

记录：

- 状态：未开始
- 备注：

### 9. 验证 PDF 解析链路

完成标准：

- 上传 PDF 成功
- 前端能调用 `parser-service`
- 返回内容正常

记录：

- 状态：未开始
- 备注：

### 10. 验证 LLM 链路

完成标准：

- 至少 1 条需要 LLM 的功能可正常返回
- `llm-health` 检查通过或可解释

记录：

- 状态：未开始
- 备注：

### 11. 用手机和另一台设备验收

完成标准：

- 手机网络可访问
- 另一台电脑可访问
- 关键流程至少走一遍

记录：

- 状态：未开始
- 备注：

### 12. 绑定正式域名和 HTTPS

完成标准：

- 域名解析完成
- HTTPS 生效
- 最终访问地址固定

记录：

- 状态：未开始
- 备注：

## 当前执行顺序

现在先做第 1 步：

- 进入 `apps/web`
- 执行 `npm install`
- 执行 `npm run build`
- 把报错或成功结果告诉我
