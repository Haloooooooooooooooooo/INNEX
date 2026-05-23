# QA V1 Task Checklist

## Scope
- Sessionized multi-turn QA
- Persist and restore chat sessions/messages
- Evidence-first answer display with citations
- Mode control: `/notes` (default), `/general`, `/online` (placeholder)

## Acceptance
- User can create/switch sessions from `/qa`
- Refreshing `/qa` restores latest session and message history
- `POST /api/qa` accepts `sessionId` and persists user + assistant messages
- Insufficient evidence returns explicit fallback
- Inbox drawer QA can keep follow-up context with session id

## Status (2026-05-23)
- [x] DB migration for `qa_sessions` and `qa_messages`
- [x] Session list/create API
- [x] Session message history API
- [x] Refactor `/api/qa` for session-aware flow
- [x] `/qa` frontend wired to real sessions/history
- [x] Inbox drawer sends `sessionId` for follow-up context
- [x] Build verification passed
- [ ] `/online` implementation (currently explicit not enabled response)
- [ ] Query filters (`tag/date/source`) integration
- [ ] QA metrics dashboard (latency, hit-rate, insufficient-evidence rate)
