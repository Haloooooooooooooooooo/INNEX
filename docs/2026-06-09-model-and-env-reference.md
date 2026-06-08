# INNEX 模型与环境变量参考

更新时间：2026-06-09

目的：

- 记录当前部署所需的关键环境变量
- 说明项目里模型和 API 是怎么路由的
- 方便后续切换模型、切换服务商、补充 OpenAI 兼容接口

## 当前部署结构

- `apps/web`：Next.js 前端，部署到 `Vercel`
- `parser-service`：FastAPI PDF 解析服务，部署到 `Railway`
- `Supabase`：数据库和存储

## 当前建议生产环境变量

最小可上线集合：

```env
NEXT_PUBLIC_SUPABASE_URL=
NEXT_PUBLIC_SUPABASE_ANON_KEY=
SUPABASE_STORAGE_BUCKET=capture-files
PARSER_SERVICE_URL=https://api.innex.mmuxyq.cn

DEEPSEEK_BASE_URL=https://api.deepseek.com
DEEPSEEK_API_KEY=

LLM_PARSE_PROVIDER=deepseek
LLM_INTERNALIZE_PROVIDER=deepseek
LLM_QA_PROVIDER=deepseek
LLM_GENERAL_PROVIDER=deepseek
```

说明：

- `NEXT_PUBLIC_SUPABASE_URL`：Supabase 项目地址
- `NEXT_PUBLIC_SUPABASE_ANON_KEY`：Supabase 匿名公钥
- `SUPABASE_STORAGE_BUCKET`：当前使用 `capture-files`
- `PARSER_SERVICE_URL`：线上 PDF 解析服务地址
- `DEEPSEEK_BASE_URL`：DeepSeek API 地址，默认 `https://api.deepseek.com`
- `DEEPSEEK_API_KEY`：DeepSeek 密钥

## 当前未启用但代码支持的 OpenAI 兼容配置

如果后续要接 OpenAI 官方或其他兼容平台，可补这一组：

```env
OPENAI_BASE_URL=https://api.openai.com/v1
OPENAI_API_KEY=
OPENAI_CHAT_MODEL=gpt-4o-mini
OPENAI_VISION_MODEL=gpt-4o
OPENAI_EMBEDDING_MODEL=text-embedding-3-small
```

如果你的服务商不是官方 OpenAI：

- 只要它支持 OpenAI 兼容协议，就可以接
- `OPENAI_BASE_URL` 填服务商给你的 `Base URL`
- 如果对方文档给的是完整地址，如 `https://example.com/v1/chat/completions`
- 那这里应该填 `https://example.com/v1`

## 代码里当前怎么取模型配置

关键文件：

- [`apps/web/lib/llm/provider.ts`](/E:/my_vibecoding/INNEX/apps/web/lib/llm/provider.ts:1)
- [`apps/web/lib/llm/client.ts`](/E:/my_vibecoding/INNEX/apps/web/lib/llm/client.ts:1)

OpenAI provider 的默认逻辑：

```ts
baseURL: process.env.OPENAI_BASE_URL || "https://api.openai.com/v1"
apiKey: process.env.OPENAI_API_KEY || ""
```

DeepSeek provider 的默认逻辑：

```ts
baseURL: process.env.DEEPSEEK_BASE_URL || "https://api.deepseek.com"
apiKey: process.env.DEEPSEEK_API_KEY || ""
```

也就是说：

- 配了环境变量，就优先用环境变量
- 没配，就走代码里的默认值

## 各功能当前走哪类 provider

项目里通过这些变量决定不同功能走哪家：

```env
LLM_PARSE_PROVIDER=
LLM_INTERNALIZE_PROVIDER=
LLM_QA_PROVIDER=
LLM_GENERAL_PROVIDER=
LLM_EMBEDDING_PROVIDER=
LLM_RELATION_PROVIDER=
```

当前建议值：

```env
LLM_PARSE_PROVIDER=deepseek
LLM_INTERNALIZE_PROVIDER=deepseek
LLM_QA_PROVIDER=deepseek
LLM_GENERAL_PROVIDER=deepseek
```

说明：

- `LLM_PARSE_PROVIDER`：解析相关文本处理
- `LLM_INTERNALIZE_PROVIDER`：知识内化链路
- `LLM_QA_PROVIDER`：问答链路
- `LLM_GENERAL_PROVIDER`：通用生成链路
- `LLM_EMBEDDING_PROVIDER`：向量 embedding 链路
- `LLM_RELATION_PROVIDER`：关系分类链路

## 后续如果要切换模型，改哪里

### 1. 只切换同一服务商下的模型

例如继续用 DeepSeek，只改模型名。

可补充这些变量：

```env
LLM_PARSE_MODEL=
LLM_INTERNALIZE_MODEL=
LLM_QA_MODEL=
LLM_GENERAL_MODEL=
LLM_RELATION_MODEL=
```

如果不填，代码会走默认模型。

### 2. 从 DeepSeek 切到 OpenAI 兼容服务

要做两件事：

- 填好 `OPENAI_BASE_URL` 和 `OPENAI_API_KEY`
- 把相应 use case 的 provider 改成 `openai`

例如：

```env
OPENAI_BASE_URL=https://your-provider.example/v1
OPENAI_API_KEY=your_key

LLM_QA_PROVIDER=openai
LLM_GENERAL_PROVIDER=openai
```

### 3. 单独给 embedding 配一套服务

如果未来你不想让 embedding 走主模型服务，可以单独填：

```env
EMBEDDING_OPENAI_BASE_URL=
EMBEDDING_OPENAI_API_KEY=
EMBEDDING_OPENAI_MODEL=
LLM_EMBEDDING_PROVIDER=openai
LLM_EMBEDDING_MODEL=
```

### 4. 单独给 OCR / 视觉配一套服务

```env
OCR_OPENAI_BASE_URL=
OCR_OPENAI_API_KEY=
OCR_OPENAI_MODEL=
```

这组主要影响 OCR 或视觉识别相关链路。

## 当前可以先不配的项

当前阶段可以不填，后续需要时再补：

```env
OPENAI_BASE_URL=
OPENAI_API_KEY=
OPENAI_CHAT_MODEL=
OPENAI_VISION_MODEL=
OPENAI_EMBEDDING_MODEL=
EMBEDDING_OPENAI_BASE_URL=
EMBEDDING_OPENAI_API_KEY=
EMBEDDING_OPENAI_MODEL=
OCR_OPENAI_BASE_URL=
OCR_OPENAI_API_KEY=
OCR_OPENAI_MODEL=
```

风险：

- 依赖 OpenAI 兼容接口的链路暂时不可用
- 某些 embedding / OCR 回退逻辑可能报缺少配置

## 当前线上解析服务地址

```env
PARSER_SERVICE_URL=https://api.innex.mmuxyq.cn
```

健康检查示例：

```text
GET https://api.innex.mmuxyq.cn/health
```

当前返回过：

```json
{"ok":true,"ready":false,"init_error":null}
```

`ready:false` 不代表服务不可用，只表示 `docling` 还没有预热实例。

## 修改配置后的操作

只要你改了 `Vercel` 里的环境变量，一般要做：

1. 保存环境变量
2. 重新部署 `apps/web`
3. 重新测试相关功能

如果你改了 `Railway` 上的 `parser-service` 地址或配置，也要重新验证：

1. `GET /health`
2. PDF 上传解析链路

## 以后建议

- 上线时优先保证一条模型链路稳定，不要一开始就接太多 provider
- 模型切换优先改环境变量，不要先改代码
- 只有当某个 provider 的协议不兼容时，再考虑修改实现
