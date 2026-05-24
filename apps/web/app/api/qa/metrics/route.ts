import { createClient } from "@/lib/supabase/server";
import { NextResponse } from "next/server";

export async function GET() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const since = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString();

  const [{ data: assistants }, { data: users }, { count: sessionsCount }] = await Promise.all([
    supabase
      .from("qa_messages")
      .select("evidence_level, created_at", { head: false })
      .eq("user_id", user.id)
      .eq("role", "assistant")
      .gte("created_at", since),
    supabase
      .from("qa_messages")
      .select("id, created_at", { head: false })
      .eq("user_id", user.id)
      .eq("role", "user")
      .gte("created_at", since),
    supabase
      .from("qa_sessions")
      .select("id", { count: "exact", head: true })
      .eq("user_id", user.id)
      .gte("updated_at", since),
  ]);

  const assistantTotal = assistants?.length || 0;
  const lowEvidence = (assistants || []).filter((m) => m.evidence_level !== "high").length;
  const lowEvidenceRate = assistantTotal > 0 ? lowEvidence / assistantTotal : 0;

  return NextResponse.json({
    window: "7d",
    sessions_active_7d: sessionsCount || 0,
    user_messages_7d: users?.length || 0,
    assistant_messages_7d: assistantTotal,
    low_evidence_rate: Number(lowEvidenceRate.toFixed(4)),
    notes: [
      "evidence_click_rate requires frontend event tracking and is not included yet",
      "helpfulness_rate requires explicit feedback events",
    ],
  });
}

