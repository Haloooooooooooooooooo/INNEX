from fastapi import FastAPI, UploadFile, File, HTTPException
from fastapi.responses import JSONResponse
from docling.document_converter import DocumentConverter
import tempfile
import os
import threading

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
async def parse_pdf(file: UploadFile = File(...)):
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
