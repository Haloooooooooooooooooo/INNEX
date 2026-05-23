import { createClient } from "@/lib/supabase/server";
import { NextRequest, NextResponse } from "next/server";

export async function GET(request: NextRequest) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const noteId = request.nextUrl.searchParams.get("noteId");
  if (!noteId) {
    return NextResponse.json({ error: "noteId is required" }, { status: 400 });
  }

  const { data, error } = await supabase
    .from("ai_answers")
    .select("id, question, answer, citations, created_at")
    .eq("user_id", user.id)
    .eq("note_id", noteId)
    .order("created_at", { ascending: false });

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return NextResponse.json(data || []);
}

