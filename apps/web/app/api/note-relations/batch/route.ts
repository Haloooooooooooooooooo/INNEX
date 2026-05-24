import { createClient } from "@/lib/supabase/server";
import { NextResponse } from "next/server";

const ALLOWED_TYPES = new Set(["related", "extends", "contradicts", "derives_from"]);

export async function POST(request: Request) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { action, relationIds, relationType } = await request.json();
  if (!Array.isArray(relationIds) || relationIds.length === 0) {
    return NextResponse.json({ error: "relationIds is required" }, { status: 400 });
  }

  if (action === "delete") {
    const { error } = await supabase
      .from("note_relations")
      .delete()
      .eq("user_id", user.id)
      .in("id", relationIds);
    if (error) return NextResponse.json({ error: error.message }, { status: 500 });
    return NextResponse.json({ success: true, affected: relationIds.length });
  }

  if (action === "retag") {
    if (!relationType || !ALLOWED_TYPES.has(relationType)) {
      return NextResponse.json({ error: "Invalid relationType" }, { status: 400 });
    }
    const { error } = await supabase
      .from("note_relations")
      .update({ relation_type: relationType })
      .eq("user_id", user.id)
      .in("id", relationIds);
    if (error) return NextResponse.json({ error: error.message }, { status: 500 });
    return NextResponse.json({ success: true, affected: relationIds.length });
  }

  return NextResponse.json({ error: "Invalid action" }, { status: 400 });
}

