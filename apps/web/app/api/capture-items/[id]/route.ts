import { createClient } from "@/lib/supabase/server";
import { NextResponse } from "next/server";

function isOptionalSourcesInfraError(message: string): boolean {
  const m = message.toLowerCase();
  return (
    m.includes("capture_item_sources") &&
    (
      m.includes("does not exist") ||
      m.includes("schema cache") ||
      m.includes("relationship") ||
      m.includes("could not find a relationship")
    )
  );
}

async function loadCaptureItemWithOptionalSources(
  supabase: Awaited<ReturnType<typeof createClient>>,
  userId: string,
  id: string
) {
  const result = await supabase
    .from("capture_items")
    .select("*, attachments(*), sources:capture_item_sources(*)")
    .eq("id", id)
    .eq("user_id", userId)
    .single();

  if (!result.error || !isOptionalSourcesInfraError(String(result.error.message || ""))) {
    return result;
  }

  const fallback = await supabase
    .from("capture_items")
    .select("*, attachments(*)")
    .eq("id", id)
    .eq("user_id", userId)
    .single();

  if (fallback.error || !fallback.data) return fallback;
  return { ...fallback, data: { ...fallback.data, sources: [] } };
}

export async function GET(
  request: Request,
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
  const { data, error } = await loadCaptureItemWithOptionalSources(supabase, user.id, id);

  if (error || !data) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  return NextResponse.json(data);
}

export async function PATCH(
  request: Request,
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
  const body = await request.json();

  // Verify ownership
  const { data: existing } = await supabase
    .from("capture_items")
    .select("user_id")
    .eq("id", id)
    .eq("user_id", user.id)
    .single();

  if (!existing) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  const { data, error } = await supabase
    .from("capture_items")
    .update({ ...body, updated_at: new Date().toISOString() })
    .eq("id", id)
    .eq("user_id", user.id)
    .select()
    .single();

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return NextResponse.json(data);
}

export async function DELETE(
  request: Request,
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

  const { data: existing } = await supabase
    .from("capture_items")
    .select("user_id")
    .eq("id", id)
    .eq("user_id", user.id)
    .single();

  if (!existing) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  // If crystallized, cascade-delete the associated note first
  // (notes -> note_relations + ai_answers cascade via DB FK)
  const { data: note } = await supabase
    .from("notes")
    .select("id")
    .eq("capture_item_id", id)
    .eq("user_id", user.id)
    .maybeSingle();

  if (note) {
    await supabase.from("notes").delete().eq("id", note.id).eq("user_id", user.id);
  }

  const { error } = await supabase
    .from("capture_items")
    .delete()
    .eq("id", id)
    .eq("user_id", user.id);

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return NextResponse.json({ success: true });
}
