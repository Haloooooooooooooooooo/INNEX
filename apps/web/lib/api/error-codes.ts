export const ERROR_CODES = {
  unauthorized: "AUTH_UNAUTHORIZED",
  bad_request: "REQ_BAD_REQUEST",
  not_found: "RESOURCE_NOT_FOUND",
  no_internalize_content: "INTERNALIZE_NO_CONTENT",
  internalize_failed: "INTERNALIZE_FAILED",
  qa_failed: "QA_FAILED",
  qa_vector_unavailable: "QA_VECTOR_UNAVAILABLE",
  qa_insufficient_evidence: "QA_INSUFFICIENT_EVIDENCE",
} as const;

export type ErrorCode = (typeof ERROR_CODES)[keyof typeof ERROR_CODES];

export function errorBody(
  code: ErrorCode,
  error: string,
  traceId?: string,
  extra?: Record<string, unknown>
) {
  return {
    code,
    error,
    trace_id: traceId,
    ...(extra || {}),
  };
}

