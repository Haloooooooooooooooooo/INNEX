import { createClient } from "@/lib/supabase/server";
import { NextResponse } from "next/server";
import { parseContent } from "@/lib/parse/generator";
import { detectType } from "@/lib/parse/detector";

export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { id } = await params;
  const { data: item, error } = await supabase
    .from("capture_items")
    .select("*, attachments(*)")
    .eq("id", id)
    .eq("user_id", user.id)
    .single();

  if (error || !item) return NextResponse.json({ error: "Not found" }, { status: 404 });

  const raw = (item.raw_content || "").trim();
  if (!raw) return NextResponse.json({ success: true, skipped: true, reason: "no_raw_content" });

  const attachments = Array.isArray(item.attachments)
    ? item.attachments.map((a: { file_name: string; file_type: string; file_size: number }) => ({
        name: a.file_name,
        type: a.file_type,
        size: a.file_size || 0,
      }))
    : [];

  const detected = detectType(raw, attachments);
  let parsed;
  try {
    parsed = await parseContent(raw, item.title || null, item.source_url || null, detected, attachments);
  } catch (error) {
    const message = error instanceof Error ? error.message : "unknown_error";
    console.error("[retry-parse.failed]", {
      item_id: id,
      user_id: user.id,
      detected_type: detected.type,
      readable: detected.readable,
      raw_len: raw.length,
      error: message.slice(0, 600),
    });
    return NextResponse.json(
      { error: "retry_parse_failed", detail: message.slice(0, 300) },
      { status: 500 }
    );
  }

  const oldDebug = (item.parse_debug && typeof item.parse_debug === "object") ? item.parse_debug : {};
  const debugObj = oldDebug as Record<string, unknown>;
  const oldNotes = Array.isArray(debugObj.notes) ? (debugObj.notes as string[]) : [];
  const keptNotes = oldNotes.filter((n) => !n.startsWith("summary_error:") && !n.startsWith("tags_error:"));

  const nextParseDebug = {
    ...debugObj,
    model_summary_attempted: true,
    model_summary_succeeded: Boolean(parsed.summary && parsed.summary.trim()),
    model_tags_attempted: true,
    model_tags_succeeded: Array.isArray(parsed.tags) && parsed.tags.length > 0 && !(parsed.tags.length === 1 && parsed.tags[0] === "-"),
    notes: [...keptNotes, ...parsed.debug.notes],
  };

  const patch: Record<string, unknown> = {
    updated_at: new Date().toISOString(),
    parse_debug: nextParseDebug,
  };
  if (parsed.summary && parsed.summary.trim()) patch.summary = parsed.summary.trim();
  if (Array.isArray(parsed.tags) && parsed.tags.length > 0 && !(parsed.tags.length === 1 && parsed.tags[0] === "-")) {
    patch.tags = parsed.tags.slice(0, 3);
  }

  const { error: updateError } = await supabase
    .from("capture_items")
    .update(patch)
    .eq("id", id)
    .eq("user_id", user.id);

  if (updateError) {
    const msg = updateError.message || "";
    const missingParseDebug =
      msg.includes("parse_debug") &&
      (msg.includes("column") || msg.includes("schema cache"));
    if (missingParseDebug) {
      const { parse_debug: _ignored, ...patchWithoutDebug } = patch;
      const { error: retryUpdateError } = await supabase
        .from("capture_items")
        .update(patchWithoutDebug)
        .eq("id", id)
        .eq("user_id", user.id);
      if (!retryUpdateError) {
        console.info("[retry-parse.success.compat-no-parse-debug]", {
          item_id: id,
          user_id: user.id,
          summary_updated: Boolean(patch.summary),
          tags_updated: Array.isArray(patch.tags),
        });
        return NextResponse.json({ success: true, retried: true, parse_debug_dropped: true });
      }
    }

    console.error("[retry-parse.update-failed]", {
      item_id: id,
      user_id: user.id,
      error: updateError.message,
    });
    return NextResponse.json({ error: updateError.message }, { status: 500 });
  }

  console.info("[retry-parse.success]", {
    item_id: id,
    user_id: user.id,
    summary_updated: Boolean(patch.summary),
    tags_updated: Array.isArray(patch.tags),
  });

  return NextResponse.json({ success: true, retried: true });
}
