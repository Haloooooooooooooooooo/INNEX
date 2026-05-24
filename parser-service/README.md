# Parser Service (Docling)

## Start

```bash
cd parser-service
python -m venv .venv
. .venv/Scripts/activate
pip install -r requirements.txt
uvicorn main:app --host 127.0.0.1 --port 8011
```

## Endpoints

- `GET /health`
- `POST /parse/pdf` (`multipart/form-data`, field name: `file`)

