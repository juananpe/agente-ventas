FROM python:3.13-slim

ENV PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1

WORKDIR /app

COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt \
    && useradd --create-home --uid 10001 agent \
    && mkdir -p /app/.copilot-state \
    && chown agent:agent /app/.copilot-state

COPY --chown=agent:agent agente_ventas.py web_app.py sales_data.db ./
COPY --chown=agent:agent static ./static

USER agent
RUN python -m copilot download-runtime
EXPOSE 8000
HEALTHCHECK --interval=30s --timeout=5s --start-period=20s \
    CMD python -c "import urllib.request; urllib.request.urlopen('http://127.0.0.1:8000/api/health', timeout=3)" || exit 1
CMD ["uvicorn", "web_app:app", "--host", "0.0.0.0", "--port", "8000"]
