import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";

export async function GET() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const checks = {
    env: {
      ocr_base_url: Boolean(process.env.OCR_OPENAI_BASE_URL || process.env.EMBEDDING_OPENAI_BASE_URL || process.env.OPENAI_BASE_URL),
      ocr_api_key: Boolean(process.env.OCR_OPENAI_API_KEY || process.env.EMBEDDING_OPENAI_API_KEY || process.env.OPENAI_API_KEY),
      ocr_model: process.env.OCR_OPENAI_MODEL || "Qwen/Qwen3-Omni-30B-A3B-Instruct",
    },
    pdfjs: {
      ok: false,
      error: "",
    },
    summary: {
      ok: false,
      message: "",
    },
  };

  try {
    await import("pdfjs-dist/legacy/build/pdf.mjs");
    checks.pdfjs.ok = true;
  } catch (err: unknown) {
    checks.pdfjs.error = err instanceof Error ? err.message : "pdfjs_import_failed";
  }

  const ok = checks.pdfjs.ok;
  checks.summary.ok = ok;
  checks.summary.message = ok ? "Parser health check passed" : "Parser health check failed";

  return NextResponse.json(
    {
      ok,
      checks,
    },
    { status: ok ? 200 : 503 }
  );
}
