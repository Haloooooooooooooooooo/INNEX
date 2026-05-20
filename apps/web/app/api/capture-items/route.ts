import { createClient } from "@/lib/supabase/server";
import { NextRequest, NextResponse } from "next/server";
import { detectType } from "@/lib/parse/detector";
import { parseContent } from "@/lib/parse/generator";

export async function GET(request: NextRequest) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { searchParams } = request.nextUrl;
  const status = searchParams.get("status");
  const search = searchParams.get("search");

  let query = supabase
    .from("capture_items")
    .select("*")
    .eq("user_id", user.id)
    .order("created_at", { ascending: false });

  if (status && status !== "all") {
    query = query.eq("status", status);
  }

  if (search) {
    query = query.or(
      `title.ilike.%${search}%,source.ilike.%${search}%`
    );
  }

  const { data, error } = await query;

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return NextResponse.json(data);
}

export async function POST(request: Request) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const body = await request.json();
  const { content, my_understanding, status, url_title, url_content, attachments } = body;

  // Submit condition: content OR attachments must have content
  const hasContent = content?.trim();
  const hasAttachments = attachments?.length > 0;
  if (!hasContent && !hasAttachments) {
    return NextResponse.json(
      { error: "内容或附件至少需要一个" },
      { status: 400 }
    );
  }

  // 1. Detect type and readability
  const detected = detectType(content || null, attachments || []);

  // 2. Light parse: generate title, source, summary, tags
  // For URL types, use the fetched page content rather than just the URL string
  const parseContent_input = url_content || content || null;
  const parsed = await parseContent(
    parseContent_input,
    url_title || null,
    detected,
    attachments || []
  );

  // 3. Save
  const { data, error } = await supabase
    .from("capture_items")
    .insert({
      user_id: user.id,
      type: detected.type,
      title: parsed.title,
      source: parsed.source,
      source_url: detected.source_url || null,
      raw_content: content?.trim() || null,
      my_understanding: my_understanding?.trim() || null,
      summary: parsed.summary,
      tags: parsed.tags,
      status: status || "later",
    })
    .select()
    .single();

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return NextResponse.json(data, { status: 201 });
}
