# Codex 浜ゆ帴鏂囨。

> 鏈€鍚庢洿鏂帮細2026-05-20

## 涓€銆侀」鐩杩?
INNEX 鈥?涓汉鐭ヨ瘑鍐呭寲鍔╂墜銆傛妸鐢ㄦ埛杈撳叆鐨勬枃瀛?閾炬帴/鍥剧墖/鏂囨。鏀跺綍鍒版敹浠剁锛孡LM 鑷姩鐢熸垚鎽樿鍜屾爣绛撅紝鐒跺悗涓€閿唴鍖栦负缁撴瀯鍖栫瑪璁帮紝鏈€缁堟敮鎸佸熀浜庣瑪璁扮殑 RAG 闂瓟鍜岀煡璇嗗浘璋辨祻瑙堛€?
**鎶€鏈爤锛?* Next.js 16 (App Router) + Tailwind v4 + shadcn/ui v4 (base-ui) + Supabase (Auth/PostgreSQL/pgvector/RLS) + DeepSeek API (LLM) + OpenAI API (Embeddings)

**浠ｇ爜浣嶇疆锛?* `apps/web/`

---

## 浜屻€佸凡瀹屾垚

### Phase 1锛氳璇?+ 鏀跺綍绠?CRUD

| 鍔熻兘 | 鏂囦欢 |
|------|------|
| 閭娉ㄥ唽/鐧诲綍/閫€鍑?| `app/login/`, `app/register/`, `providers/auth-provider.tsx`, `proxy.ts` (璺敱瀹堝崼) |
| 鏀跺綍绠遍〉闈?| `app/inbox/page.tsx` 鈫?`components/inbox/inbox-page.tsx` |
| 蹇€熷綍鍏ワ紙鍗曟+鍙屾寜閽?闄勪欢锛?| `components/inbox/quick-capture.tsx` |
| 鏀跺綍绠辫〃鏍硷紙7鍒楋紝鎸夌姸鎬佹搷浣滄寜閽級 | `components/inbox/inbox-table.tsx` |
| 绛涢€?Tab锛堝叏閮?绋嶅悗鐪?寰呭唴鍖?宸叉矇娣€锛? 鎼滅储 | `components/inbox/inbox-toolbar.tsx` |
| 璇︽儏鎶藉眽锛堝瓧娈?鎽樿/鎴戠殑鐞嗚В/绗旇鏈?闄勪欢/AI绗旇/鍐呭寲鑽夌锛?| `components/inbox/inbox-drawer.tsx` |
| 鐘舵€佹祦杞寜閽?+ 鍒犻櫎浜屾纭 | `components/inbox/inbox-drawer.tsx` (AlertDialog) |
| 鏃ュ巻寮圭獥 + 淇℃伅鍗★紙UI 鍗犱綅锛?| `components/shared/calendar-popover.tsx`, `components/shared/info-modal.tsx` |
| KB 椤甸潰锛堝凡娌夋穩绗旇鍗＄墖锛?| `app/kb/page.tsx` |
| QA 椤甸潰锛圧AG 闂瓟鐣岄潰锛?| `app/qa/page.tsx`, `components/qa/` |
| 甯冨眬锛堟繁鑹蹭晶杈瑰鑸?+ TopBar + 鐢ㄦ埛鑿滃崟锛?| `components/layout/` |
| Design Tokens | `app/globals.css` (CSS 鍙橀噺 鈫?Tailwind v4 @theme) |
| 鏁版嵁搴?Phase 1 | `supabase/migrations/001_initial_schema.sql` (profiles + capture_items + attachments + RLS) |

### Phase 2锛歀LM 闆嗘垚 + 鍐呭寲 + RAG QA锛?*鍚庣宸插畬鎴愶紝鍓嶇閮ㄥ垎鏈畬鎴?*锛?
| 鍔熻兘 | 鏂囦欢 | 鐘舵€?|
|------|------|------|
| LLM 瀹㈡埛绔紙DeepSeek + OpenAI锛?| `lib/llm/provider.ts`, `client.ts`, `prompts.ts` | 鉁?|
| 杞昏В鏋愭ā鍧楋紙绫诲瀷妫€娴?鍙鎬?鐢熸垚锛?| `lib/parse/detector.ts`, `generator.ts`, `prompts.ts` | 鉁?|
| URL 椤甸潰鎶撳彇锛堟爣棰?姝ｆ枃+meta锛?| `app/api/parse-url/route.ts` | 鉁?|
| 鏀跺綍 API锛堟帴鍏ヨ交瑙ｆ瀽锛孡LM 鐢熸垚鎽樿鏍囩锛?| `app/api/capture-items/route.ts` | 鉁?|
| 鍐呭寲 API | `app/api/internalize/route.ts` | 鉁?|
| 绗旇 CRUD API | `app/api/notes/route.ts`, `[id]/route.ts` | 鉁?|
| RAG QA API | `app/api/qa/route.ts`, `app/api/qa/save/route.ts` | 鉁?|
| 鏁版嵁搴?Phase 2 | `supabase/migrations/002_phase2_schema.sql` (notes + note_relations + ai_answers + note_chunks + pgvector + match_note_chunks RPC) | 鉁?浣?*鐢ㄦ埛鏈墽琛岃縼绉?* |
| 馃敶 鍐呭寲 Agent 鐪熷疄璋冪敤 | `app/api/internalize/route.ts` | 鉂?鏈夐鏋朵絾鏈粡娴嬭瘯 |
| 馃敶 RAG QA 鐪熷疄璋冪敤 | `app/api/qa/route.ts` | 鉂?鏈夐鏋朵絾鏈粡娴嬭瘯 |
| 馃敶 涓€閿唴鍖栨寜閽湡瀹炶Е鍙?| `components/inbox/inbox-drawer.tsx` | 鉂?`enterDraftMode()` 鏄剧ず鍗犱綅鏂囨湰锛屾湭璋?LLM |
| 馃敶 Docling 渚ц溅 | `services/docling-service/` | 鉂?鏈垱寤?|

---

## 涓夈€佸綋鍓嶆鍦ㄥ仛鐨勪簨

**Phase 1 鐨勮交瑙ｆ瀽璋冭瘯銆?* 褰曞叆涓€鏉″唴瀹?鈫?绯荤粺鑷姩鍒ゆ柇绫诲瀷 鈫?LLM 鐢熸垚鎽樿+鏍囩銆傚綋鍓嶉棶棰橈細

1. 绮樿创閾炬帴鍚?`/api/parse-url` 鎶撳彇椤甸潰鏍囬鍜屾鏂?2. 姝ｆ枃浼犵粰 LLM锛圖eepSeek锛夌敓鎴愭憳瑕佸拰鏍囩
3. 鏈夋椂椤甸潰鎶撳彇澶辫触鎴栬秴鏃讹紝瀵艰嚧鎽樿/鏍囩涓虹┖

鏈€鏂版敼鍔細鎻愪氦鎸夐挳鍦?URL 鍐呭鎶撳彇鏈熼棿绂佺敤锛岄槻姝㈢敤鎴锋姠鍦ㄦ姄瀹屼箣鍓嶆彁浜ゃ€?
---

## 鍥涖€佹湭瀹屾垚

### 楂樹紭鍏堢骇

| 闂 | 璇存槑 |
|------|------|
| 杞昏В鏋愯川閲忎笉绋冲畾 | 鍙栧喅浜庨〉闈㈡姄鍙栨垚鍔熺巼銆傛湁浜涚綉绔欙紙寰俊鍏紬鍙凤級鍙兘鍙嶇埇鎴栬秴鏃?|
| 鍐呭寲 Agent 鏈祴璇?| `POST /api/internalize` 浠ｇ爜鍐欏畬浣嗕粠鏈窇杩団€斺€旈渶瑕佸厛鎵ц 002 杩佺Щ |
| 涓€閿唴鍖栨寜閽湭鎺ラ€?| 鎶藉眽閲岀偣"涓€閿唴鍖?鍙樉绀哄崰浣嶏紝娌℃湁鐪熸璋冨唴鍖?API |
| pgvector 杩佺Щ鏈墽琛?| 002_phase2_schema.sql 鐢ㄦ埛杩樻病璺戯紝鎵€鏈?Phase 2 鍔熻兘涓嶅彲鐢?|

### 涓紭鍏堢骇

| 闂 | 璇存槑 |
|------|------|
| 绗旇鏈尯鍩熸湭鎸佷箙鍖?| 鎶藉眽閲岀殑"绗旇鏈? textarea 淇濆瓨鎸夐挳涓嶅瓨 DB鈥斺€旀病鏈夊搴斿垪 |
| 鐭ヨ瘑搴撳畾浣嶆寜閽?| 鍗犱綅锛屾湭瀹炵幇璺宠浆 |
| 鍩轰簬姝ょ瑪璁版彁闂寜閽?| 鍗犱綅锛屾湭瀹炵幇涓婁笅鏂囨寕杞?|
| 闄勪欢涓婁紶鍙槸鍏冩暟鎹?| 鏂囦欢閫変腑鍚庡彧璁板綍鍚嶅瓧/澶у皬/绫诲瀷锛屾病鏈夌湡姝ｄ笂浼犲埌 Supabase Storage |
| 鍥剧墖绮樿创 | 涓嶆敮鎸?|
| 宸叉矇娣€鎶藉眽鐨?AI 绗旇 | 鍗犱綅鏂囧瓧锛屾湭璇荤湡瀹?notes 琛?|

### 浣庝紭鍏堢骇

| 闂 | 璇存槑 |
|------|------|
| 鍝嶅簲寮?| 鐩墠鏈€灏忓搴?~1024px锛岀Щ鍔ㄧ鏈仛 |
| Docling 渚ц溅 | 瀹屽叏娌℃湁鍒涘缓 |
| 鐭ヨ瘑鍥捐氨 | Phase 3锛屾湭寮€濮?|

---

## 浜斻€佸叧閿枃浠?鐩綍缁撴瀯

```
apps/web/
鈹溾攢鈹€ app/
鈹?  鈹溾攢鈹€ page.tsx                          # 鈫?閲嶅畾鍚?/inbox 鎴?/login
鈹?  鈹溾攢鈹€ layout.tsx                        # 鏍瑰竷灞€ + AuthProvider
鈹?  鈹溾攢鈹€ globals.css                       # Tailwind v4 + Design Tokens
鈹?  鈹溾攢鈹€ proxy.ts                          # 璺敱瀹堝崼 (鍘?middleware.ts锛孨ext 16 鏀瑰悕)
鈹?  鈹溾攢鈹€ login/page.tsx                    # 鐧诲綍椤?鈹?  鈹溾攢鈹€ register/page.tsx                 # 娉ㄥ唽椤?鈹?  鈹溾攢鈹€ inbox/page.tsx                    # 鏀跺綍绠?鈫?鏍稿績椤甸潰
鈹?  鈹溾攢鈹€ kb/page.tsx                       # 鐭ヨ瘑搴擄紙绗旇鍗＄墖鍒楄〃锛?鈹?  鈹溾攢鈹€ qa/page.tsx                       # RAG 闂瓟
鈹?  鈹溾攢鈹€ ai/page.tsx                       # 鈫?redirect /qa
鈹?  鈹斺攢鈹€ api/
鈹?      鈹溾攢鈹€ auth/register|login|logout|me/ # 璁よ瘉 API
鈹?      鈹溾攢鈹€ capture-items/route.ts         # GET 鍒楄〃 + POST 鍒涘缓锛堝惈杞昏В鏋愶級
鈹?      鈹溾攢鈹€ capture-items/[id]/route.ts    # GET/PATCH/DELETE锛堝惈绾ц仈鍒犵瑪璁帮級
鈹?      鈹溾攢鈹€ parse-url/route.ts             # URL 鎶撳彇锛氭爣棰?姝ｆ枃+meta
鈹?      鈹溾攢鈹€ internalize/route.ts           # 鍐呭寲 Agent
鈹?      鈹溾攢鈹€ notes/route.ts                 # 绗旇鍒楄〃
鈹?      鈹溾攢鈹€ notes/[id]/route.ts            # 绗旇璇︽儏/鏇存柊/鍒犻櫎
鈹?      鈹溾攢鈹€ qa/route.ts                    # RAG 闂瓟
鈹?      鈹斺攢鈹€ qa/save/route.ts              # 淇濆瓨鍥炵瓟
鈹溾攢鈹€ components/
鈹?  鈹溾攢鈹€ layout/       # app-layout, topbar, nav
鈹?  鈹溾攢鈹€ auth/         # login-form, register-form, user-menu
鈹?  鈹溾攢鈹€ inbox/        # inbox-page, quick-capture, inbox-table, inbox-toolbar, inbox-drawer
鈹?  鈹溾攢鈹€ qa/           # qa-page, answer-display, citation-card
鈹?  鈹斺攢鈹€ shared/       # status-badge, tag-chip, calendar-popover, info-modal
鈹溾攢鈹€ hooks/
鈹?  鈹溾攢鈹€ use-capture-items.ts   # 鏀跺綍绠辨暟鎹?hook
鈹?  鈹斺攢鈹€ use-notes.ts           # 绗旇鏁版嵁 hook
鈹溾攢鈹€ lib/
鈹?  鈹溾攢鈹€ supabase/     # client.ts, server.ts, types.ts
鈹?  鈹溾攢鈹€ llm/          # provider.ts, client.ts, prompts.ts
鈹?  鈹斺攢鈹€ parse/        # detector.ts, generator.ts, prompts.ts
鈹溾攢鈹€ providers/
鈹?  鈹斺攢鈹€ auth-provider.tsx      # AuthContext + useAuth
鈹斺攢鈹€ supabase/migrations/
    鈹溾攢鈹€ 001_initial_schema.sql  # Phase 1 寤鸿〃锛堝凡鎵ц锛?    鈹斺攢鈹€ 002_phase2_schema.sql   # Phase 2 寤鸿〃锛堟湭鎵ц锛侊級
```

---

## 鍏€佽鑼冩枃妗?
蹇呰锛屾寜浼樺厛绾э細

1. **`docs/褰曞叆-瑙ｆ瀽-灞曠ず瑙勮寖.md`** 鈫?鏈€鏍稿績锛屽綍鍏?瑙ｆ瀽/璇︽儏椤电殑鎵€鏈夎鍒?2. **`docs/鍏ㄩ儴鍔熻兘.md`** 鈫?瀹屾暣鍔熻兘 PRD
3. **`docs/鍏ㄥ眬鏋舵瀯璁捐.md`** 鈫?鎶€鏈灦鏋?+ Phase 1/2/3 璺嚎
4. **`docs/鎵ц璁″垝-鏀跺綍绠盋RUD.md`** 鈫?Phase 1 鍘熷璁″垝

---

## 涓冦€佺幆澧冨彉閲?
鍦?`apps/web/.env.local`锛?
```
NEXT_PUBLIC_SUPABASE_URL=https://rkoroeponxlvvewyhylu.supabase.co
NEXT_PUBLIC_SUPABASE_ANON_KEY=eyJ...(JWT)
DEEPSEEK_API_KEY=YOUR_DEEPSEEK_API_KEY
OPENAI_API_KEY=YOUR_OPENAI_API_KEY
OPENAI_BASE_URL=https://vortexaiapi.com/v1
```

---

## 鍏€佷笅涓€姝ヨ鍒?
1. **璋冭瘯杞昏В鏋?* 鈥?纭繚绮樿创閾炬帴+鏂囧瓧鑳界ǔ瀹氱敓鎴愭憳瑕佸拰鏍囩
2. **鎵ц 002 杩佺Щ** 鈥?`supabase/migrations/002_phase2_schema.sql`锛堝湪 Supabase SQL Editor 璺戯級
3. **鎺ラ€氫竴閿唴鍖?* 鈥?鎶藉眽"涓€閿唴鍖?鈫?璋?`/api/internalize` 鈫?鐢熸垚绗旇 鈫?鐘舵€佸彉 crystallized
4. **娴嬭瘯 RAG QA** 鈥?纭 pgvector 鍙敤 鈫?鎻愰棶 鈫?妫€绱?鈫?鐢熸垚甯﹀紩鐢ㄥ洖绛?5. **鎸佷箙鍖栫瑪璁版湰** 鈥?缁欐娊灞夌瑪璁版湰鍔?DB 鍒楁垨澶嶇敤鐜版湁鍒?
---

## 涔濄€佸凡鐭ョ害瀹?
- 鎵€鏈?API 璺敱鍏?`getUser()` 鍐嶈繑鍥?鈥斺€?鏃犱緥澶?- Next.js 16 鍔ㄦ€佽矾鐢?params 鏄?Promise锛歚{ params: Promise<{ id: string }> }` + `await params`
- middleware.ts 宸叉敼鍚嶄负 proxy.ts锛圢ext.js 16 瑕佹眰锛?- 鏍峰紡鐢?Tailwind v4 `@theme inline`锛岀粍浠堕噷鐢?`bg-[--paper]` 寮曠敤 CSS 鍙橀噺
- shadcn/ui v4 鐢ㄧ殑鏄?`@base-ui/react` 涓嶆槸 Radix鈥斺€擿asChild` 涓嶆敮鎸侊紝Select `onValueChange` 绛惧悕涓嶅悓
- 鎵€鏈夋暟鎹簱琛ㄥ繀椤诲紑 RLS + 4 涓瓥鐣ワ紙SELECT/INSERT/UPDATE/DELETE = auth.uid() = user_id锛?
