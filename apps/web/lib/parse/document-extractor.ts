import mammoth from "mammoth";
import { createRequire } from "node:module";
import { pathToFileURL } from "node:url";

export type DocumentExtractMeta = {
  strategy: "text" | "docx" | "pdf_text" | "pdf_low_text" | "pdf_heuristic" | "unknown";
  page_count?: number;
  extracted_chars: number;
  chars_per_page?: number;
  likely_scanned_pdf?: boolean;
};

export type DocumentExtractResult = {
  text: string | null;
  meta: DocumentExtractMeta;
};

export async function extractDocumentText(file: File): Promise<string | null> {
  const result = await extractDocumentTextDetailed(file);
  return result.text;
}

export async function extractDocumentTextDetailed(file: File): Promise<DocumentExtractResult> {
  const name = file.name.toLowerCase();
  const bytes = Buffer.from(await file.arrayBuffer());

  if (name.endsWith(".txt") || name.endsWith(".md") || name.endsWith(".markdown") || name.endsWith(".csv") || name.endsWith(".json") || name.endsWith(".yaml") || name.endsWith(".yml")) {
    const text = bytes.toString("utf8");
    const normalized = text.trim() ? text : null;
    return {
      text: normalized,
      meta: {
        strategy: "text",
        extracted_chars: normalized?.length || 0,
      },
    };
  }

  if (name.endsWith(".docx")) {
    const result = await mammoth.extractRawText({ buffer: bytes });
    const text = (result.value || "").trim();
    return {
      text: text || null,
      meta: {
        strategy: "docx",
        extracted_chars: text.length,
      },
    };
  }

  if (name.endsWith(".pdf")) {
    return extractPdfTextByPdfjs(bytes);
  }

  if (file.type.startsWith("text/")) {
    const text = await file.text();
    const normalized = text.trim() ? text : null;
    return {
      text: normalized,
      meta: {
        strategy: "text",
        extracted_chars: normalized?.length || 0,
      },
    };
  }

  return {
    text: null,
    meta: {
      strategy: "unknown",
      extracted_chars: 0,
    },
  };
}

async function extractPdfTextByPdfjs(bytes: Buffer): Promise<DocumentExtractResult> {
  try {
    // Use pdfjs directly on server (preferred path).
    const pdfjs = await import("pdfjs-dist/legacy/build/pdf.mjs");
    configurePdfjsWorker(pdfjs);
    const loadingTask = pdfjs.getDocument({
      data: new Uint8Array(bytes),
      disableWorker: true,
      worker: null,
      isEvalSupported: false,
      useSystemFonts: true,
    } as Record<string, unknown>);
    const doc = await loadingTask.promise;
    const chunks: string[] = [];
    const pageCount = doc.numPages || 0;
    try {
      for (let i = 1; i <= doc.numPages; i += 1) {
        const page = await doc.getPage(i);
        const content = await page.getTextContent();
        const line = (content.items || [])
          .map((item: unknown) => {
            if (item && typeof item === "object" && "str" in item) {
              return String((item as { str?: unknown }).str || "");
            }
            return "";
          })
          .join(" ")
          .trim();
        if (line) chunks.push(line);
      }
    } finally {
      await loadingTask.destroy();
    }
    const merged = chunks.join("\n\n").trim();
    const extractedChars = merged.length;
    const charsPerPage = pageCount > 0 ? Math.round(extractedChars / pageCount) : extractedChars;
    const likelyScanned = pageCount > 0 && charsPerPage < 30;
    return {
      text: merged || null,
      meta: {
        strategy: likelyScanned ? "pdf_low_text" : "pdf_text",
        page_count: pageCount,
        extracted_chars: extractedChars,
        chars_per_page: charsPerPage,
        likely_scanned_pdf: likelyScanned,
      },
    };
  } catch {
    // Worker/runtime issues fallback: extract plain strings heuristically from bytes.
    const heuristic = extractPdfTextHeuristic(bytes);
    return {
      text: heuristic,
      meta: {
        strategy: "pdf_heuristic",
        extracted_chars: heuristic?.length || 0,
      },
    };
  }
}

function configurePdfjsWorker(pdfjs: unknown) {
  try {
    const require = createRequire(import.meta.url);
    const candidates = [
      "pdfjs-dist/legacy/build/pdf.worker.mjs",
      "pdfjs-dist/build/pdf.worker.mjs",
    ];
    let resolved: string | null = null;
    for (const mod of candidates) {
      try {
        resolved = require.resolve(mod);
        if (resolved) break;
      } catch {
        // try next
      }
    }
    if (!resolved) return;

    const workerSrc = pathToFileURL(resolved).href;
    const anyPdfjs = pdfjs as { GlobalWorkerOptions?: { workerSrc?: string } };
    if (anyPdfjs?.GlobalWorkerOptions) {
      anyPdfjs.GlobalWorkerOptions.workerSrc = workerSrc;
    }
  } catch {
    // Best-effort setup only; parser still attempts default behavior.
  }
}

function extractPdfTextHeuristic(bytes: Buffer): string | null {
  const raw = bytes.toString("latin1");
  const matches = raw.match(/\((?:\\.|[^\\)]){3,}\)/g) || [];
  if (!matches.length) return null;
  const decoded = matches
    .map((m) => m.slice(1, -1))
    .map((s) =>
      s
        .replace(/\\\)/g, ")")
        .replace(/\\\(/g, "(")
        .replace(/\\n/g, "\n")
        .replace(/\\r/g, "")
        .replace(/\\t/g, " ")
        .replace(/\\\\/g, "\\")
    )
    .map((s) => s.replace(/[^\x20-\x7E\u4E00-\u9FFF]/g, " ").trim())
    .filter((s) => s.length >= 3);
  const merged = decoded.join("\n").replace(/\n{3,}/g, "\n\n").trim();
  return merged || null;
}
