import { createClient } from "@/lib/supabase/server";
import { NextRequest, NextResponse } from "next/server";

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { id } = await params;
  const limitParam = Number(request.nextUrl.searchParams.get("limit") || 50);
  const limit = Number.isFinite(limitParam) ? Math.max(1, Math.min(limitParam, 200)) : 50;

  const { data: session } = await supabase
    .from("qa_sessions")
    .select("id")
    .eq("id", id)
    .eq("user_id", user.id)
    .single();

  if (!session) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  const { data, error } = await supabase
    .from("qa_messages")
    .select("id, role, content, citations, trace_id, created_at")
    .eq("user_id", user.id)
    .eq("session_id", id)
    .order("created_at", { ascending: true })
    .limit(limit);

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return NextResponse.json(data || []);
}
