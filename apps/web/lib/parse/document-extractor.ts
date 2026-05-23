import mammoth from "mammoth";

export type DocumentExtractMeta = {
  strategy: "text" | "docx" | "pdf_text" | "pdf_low_text" | "unknown";
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
  // Use pdfjs directly on server to avoid fake worker resolution issues in Next dev/runtime.
  const pdfjs = await import("pdfjs-dist/legacy/build/pdf.mjs");
  const loadingTask = pdfjs.getDocument({
    data: new Uint8Array(bytes),
    isEvalSupported: false,
    useSystemFonts: true,
  } as Record<string, unknown>);

  const doc = await loadingTask.promise;
  try {
    const chunks: string[] = [];
    const pageCount = doc.numPages || 0;
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
  } finally {
    await loadingTask.destroy();
  }
}
