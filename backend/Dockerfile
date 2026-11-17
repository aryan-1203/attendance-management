FROM python:3.12-slim

ENV PYTHONDONTWRITEBYTECODE=1 PYTHONUNBUFFERED=1 PIP_NO_CACHE_DIR=1
RUN apt-get update && apt-get install -y --no-install-recommends fonts-dejavu-core curl ca-certificates \
    && rm -rf /var/lib/apt/lists/*
WORKDIR /app
COPY requirements.txt .
RUN pip install -r requirements.txt
COPY . .
RUN chmod +x docker-entrypoint.sh && mkdir -p storage/uploads storage/reports storage/outbox
# Render / most PaaS inject $PORT; defaults to 8000 locally
ENV PORT=8000
EXPOSE 8000
HEALTHCHECK --interval=15s --timeout=5s --retries=10 CMD curl -fsS http://localhost:${PORT}/api/health || exit 1
ENTRYPOINT ["./docker-entrypoint.sh"]
CMD ["sh", "-c", "exec uvicorn app.main:app --host 0.0.0.0 --port ${PORT} --proxy-headers --forwarded-allow-ips=*"]
