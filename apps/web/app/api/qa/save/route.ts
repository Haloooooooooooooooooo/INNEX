import { createClient } from "@/lib/supabase/server";
import { NextResponse } from "next/server";

export async function PATCH(request: Request) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { answerId, noteId } = await request.json();
  if (!answerId) {
    return NextResponse.json({ error: "answerId is required" }, { status: 400 });
  }

  const { data: answer, error } = await supabase
    .from("ai_answers")
    .select("*")
    .eq("id", answerId)
    .eq("user_id", user.id)
    .single();

  if (error || !answer) {
    return NextResponse.json({ error: "Answer not found" }, { status: 404 });
  }

  await supabase
    .from("ai_answers")
    .update({ saved_to_note: true, note_id: noteId || null })
    .eq("id", answerId)
    .eq("user_id", user.id);

  return NextResponse.json({ success: true });
}
