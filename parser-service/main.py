from fastapi import FastAPI, UploadFile, File, HTTPException, Form
from fastapi.responses import JSONResponse
from docling.document_converter import DocumentConverter
import tempfile
import os
import threading
import pypdfium2 as pdfium

app = FastAPI(title="INNEX Parser Service", version="0.1.0")
_converter: DocumentConverter | None = None
_init_lock = threading.Lock()
_init_error: str | None = None


def get_converter() -> DocumentConverter:
    global _converter, _init_error
    if _converter is not None:
        return _converter
    with _init_lock:
        if _converter is not None:
            return _converter
        try:
            _converter = DocumentConverter()
            _init_error = None
            return _converter
        except Exception as e:
            _init_error = str(e)
            raise


@app.get("/health")
def health():
    return {"ok": True, "ready": _converter is not None, "init_error": _init_error}


@app.post("/parse/pdf")
async def parse_pdf(file: UploadFile = File(...), ocr: int = Form(0)):
    name = (file.filename or "").lower()
    if not name.endswith(".pdf"):
        raise HTTPException(status_code=400, detail="only_pdf_supported")

    data = await file.read()
    if not data:
        raise HTTPException(status_code=400, detail="empty_file")

    tmp_path = None
    try:
        with tempfile.NamedTemporaryFile(delete=False, suffix=".pdf") as tmp:
            tmp.write(data)
            tmp_path = tmp.name

        # Default path: text-layer extraction without OCR.
        # This is fast and avoids OCR-related OOM on scanned/complex pages.
        if ocr != 1:
            text = extract_text_with_pdfium(tmp_path)
            if not text:
                return JSONResponse(
                    status_code=422,
                    content={"ok": False, "error_code": "PDF_PARSE_EMPTY_TEXT", "detail": "pdfium_empty_text"},
                )
            return {
                "ok": True,
                "source": "pdfium_text_only",
                "text": text,
                "chars": len(text),
            }

        converter = get_converter()
        result = converter.convert(tmp_path)
        doc = result.document
        text = doc.export_to_markdown() or ""
        text = text.strip()
        if not text:
            return JSONResponse(
                status_code=422,
                content={"ok": False, "error_code": "PDF_PARSE_EMPTY_TEXT", "detail": "docling_empty_text"},
            )

        return {
            "ok": True,
            "source": "docling",
            "text": text,
            "chars": len(text),
        }
    except Exception as e:
        return JSONResponse(
            status_code=500,
            content={"ok": False, "error_code": "PDF_PARSE_DOCILING_FAILED", "detail": str(e)[:300]},
        )
    finally:
        if tmp_path and os.path.exists(tmp_path):
            try:
                os.remove(tmp_path)
            except Exception:
                pass


def extract_text_with_pdfium(pdf_path: str) -> str:
    doc = pdfium.PdfDocument(pdf_path)
    chunks: list[str] = []
    try:
        for i in range(len(doc)):
            page = doc[i]
            textpage = None
            try:
                textpage = page.get_textpage()
                text = (textpage.get_text_range() or "").strip()
                if text:
                    chunks.append(text)
            finally:
                try:
                    if textpage is not None:
                        textpage.close()
                except Exception:
                    pass
                try:
                    page.close()
                except Exception:
                    pass
    finally:
        try:
            doc.close()
        except Exception:
            pass
    return "\n\n".join(chunks).strip()
