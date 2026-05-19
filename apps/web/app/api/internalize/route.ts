import { createClient } from "@/lib/supabase/server";
import { NextResponse } from "next/server";
import { generateCompletion, generateEmbedding } from "@/lib/llm/client";
import {
  INTERNALIZE_SYSTEM,
  internalizeUserPrompt,
  CONCEPT_EXTRACTION,
} from "@/lib/llm/prompts";

export async function POST(request: Request) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { captureItemId } = await request.json();
  if (!captureItemId) {
    return NextResponse.json({ error: "captureItemId is required" }, { status: 400 });
  }

  // 1. Read the capture item
  const { data: item, error: itemError } = await supabase
    .from("capture_items")
    .select("*")
    .eq("id", captureItemId)
    .eq("user_id", user.id)
    .single();

  if (itemError || !item) {
    return NextResponse.json({ error: "Capture item not found" }, { status: 404 });
  }

  if (!item.raw_content) {
    return NextResponse.json(
      { error: "Item has no content to internalize" },
      { status: 400 }
    );
  }

  try {
    // 2. Generate structured markdown via DeepSeek
    const userPrompt = internalizeUserPrompt(
      item.title,
      item.source,
      item.raw_content,
      item.my_understanding
    );
    const markdown = await generateCompletion(INTERNALIZE_SYSTEM, userPrompt);

    // 3. Extract concepts
    let concepts: string[] = [];
    try {
      const conceptsRaw = await generateCompletion(
        "You are a concept extraction assistant. Return ONLY a JSON array of strings.",
        `${CONCEPT_EXTRACTION}\n\n内容:\n${markdown}`,
        { temperature: 0.1, maxOutputTokens: 200 }
      );
      const parsed = JSON.parse(conceptsRaw.trim());
      if (Array.isArray(parsed)) concepts = parsed;
    } catch {
      concepts = [];
    }

    // 4. Summary
    const summary = await generateCompletion(
      "你是一个摘要助手。用一句简洁的中文总结核心要点。",
      `总结以下内容的核心要点：\n\n${markdown.substring(0, 2000)}`,
      { temperature: 0.1, maxOutputTokens: 100 }
    );

    // 5. Save note
    const { data: note, error: noteError } = await supabase
      .from("notes")
      .insert({
        user_id: user.id,
        capture_item_id: item.id,
        title: item.title,
        content: markdown,
        summary: summary.trim(),
        concepts,
        tags: item.tags || [],
        source: item.source,
        source_url: item.source_url || null,
      })
      .select()
      .single();

    if (noteError || !note) {
      return NextResponse.json(
        { error: noteError?.message || "Failed to create note" },
        { status: 500 }
      );
    }

    // 6. Chunk + embed
    const chunks = chunkMarkdown(markdown);
    for (let i = 0; i < chunks.length; i++) {
      try {
        const embedding = await generateEmbedding(chunks[i]);
        await supabase.from("note_chunks").insert({
          user_id: user.id,
          note_id: note.id,
          chunk_index: i,
          content: chunks[i],
          embedding: embedding as unknown as string,
          token_count: Math.ceil(chunks[i].length / 2),
        });
      } catch {
        // chunk insert failed, non-fatal
      }
    }

    // 7. Find similar notes via pgvector
    const relations: unknown[] = [];
    try {
      const firstChunk = await supabase
        .from("note_chunks")
        .select("embedding")
        .eq("note_id", note.id)
        .eq("chunk_index", 0)
        .single();

      if (firstChunk?.data?.embedding) {
        const { data: similar } = await supabase.rpc("match_note_chunks", {
          query_embedding: firstChunk.data.embedding,
          match_threshold: 0.7,
          match_count: 5,
          p_user_id: user.id,
        });

        if (similar) {
          const seenNoteIds = new Set<string>();
          for (const match of similar as Array<{ note_id: string }>) {
            if (match.note_id === note.id || seenNoteIds.has(match.note_id)) continue;
            seenNoteIds.add(match.note_id);

            const { data: rel } = await supabase
              .from("note_relations")
              .insert({
                user_id: user.id,
                source_note_id: note.id,
                target_note_id: match.note_id,
                relation_type: "related",
              })
              .select()
              .single();

            if (rel) relations.push(rel);
            if (seenNoteIds.size >= 5) break;
          }
        }
      }
    } catch {
      // Relation creation failed, non-fatal
    }

    // 8. Update capture_item status
    await supabase
      .from("capture_items")
      .update({ status: "crystallized", updated_at: new Date().toISOString() })
      .eq("id", item.id)
      .eq("user_id", user.id);

    return NextResponse.json(
      { note, relations, concepts, status: "success" },
      { status: 201 }
    );
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : "Internalization failed";
    return NextResponse.json({ error: message, status: "error" }, { status: 500 });
  }
}

function chunkMarkdown(markdown: string, maxWords = 500): string[] {
  const sections = markdown.split(/\n(?=#{2,3}\s)/);
  const chunks: string[] = [];

  for (const section of sections) {
    const words = section.split(/\s+/);
    if (words.length <= maxWords) {
      if (section.trim()) chunks.push(section.trim());
    } else {
      const paragraphs = section.split(/\n\s*\n/);
      let current = "";
      for (const para of paragraphs) {
        if ((current + para).split(/\s+/).length > maxWords && current) {
          chunks.push(current.trim());
          current = para;
        } else {
          current += (current ? "\n\n" : "") + para;
        }
      }
      if (current.trim()) chunks.push(current.trim());
    }
  }
  return chunks.filter((c) => c.length > 10);
}
