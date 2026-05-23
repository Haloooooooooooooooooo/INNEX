import { createClient } from "@/lib/supabase/server";
import { NextRequest, NextResponse } from "next/server";

export async function GET() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { data, error } = await supabase
    .from("qa_sessions")
    .select("id, title, mode, pinned_note_id, created_at, updated_at")
    .eq("user_id", user.id)
    .order("updated_at", { ascending: false });

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return NextResponse.json(data || []);
}

export async function POST(request: NextRequest) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const body = await request.json().catch(() => ({}));
  const title = typeof body.title === "string" && body.title.trim() ? body.title.trim() : "新建对话";
  const mode = typeof body.mode === "string" && body.mode.trim() ? body.mode.trim() : "notes";
  const pinnedNoteId = typeof body.pinnedNoteId === "string" ? body.pinnedNoteId : null;

  const { data, error } = await supabase
    .from("qa_sessions")
    .insert({
      user_id: user.id,
      title,
      mode,
      pinned_note_id: pinnedNoteId,
    })
    .select("id, title, mode, pinned_note_id, created_at, updated_at")
    .single();

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return NextResponse.json(data, { status: 201 });
}
