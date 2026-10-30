"""Find my Bike Slot – Backend.

Starten (im Ordner code/backend):  uv run uvicorn app.main:app --reload --port 8000
Testseite im Browser:              http://localhost:8000/docs
"""

from fastapi import FastAPI

app = FastAPI(title="Find my Bike Slot – Backend", version="0.1.0")


@app.get("/healthz")
def healthz() -> dict:
    """Lebenszeichen: Antwortet, solange das Backend läuft."""
    return {"status": "ok"}
