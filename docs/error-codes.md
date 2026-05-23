# Phase2 错误码（最小集）

- `AUTH_UNAUTHORIZED`：未登录或会话失效。
- `REQ_BAD_REQUEST`：请求参数缺失或格式不正确。
- `RESOURCE_NOT_FOUND`：目标记录不存在。
- `INTERNALIZE_NO_CONTENT`：记录没有可内化内容。
- `INTERNALIZE_FAILED`：内化流程失败。
- `QA_VECTOR_UNAVAILABLE`：向量检索不可用（如 pgvector/RPC 未就绪）。
- `QA_INSUFFICIENT_EVIDENCE`：证据不足，返回不确定答案。
- `QA_FAILED`：问答流程失败。

说明：
- 错误返回统一包含 `code` 和 `trace_id`（便于前后端排障）。
- 成功响应是否包含 `code` 取决于业务接口，不强制要求。
