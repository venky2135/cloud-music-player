# ── Stage 1: Build the Vite Frontend ──
FROM node:20-alpine AS frontend-builder
WORKDIR /app/frontend

COPY frontend/package*.json ./
RUN npm ci

COPY frontend/ ./
RUN npm run build

# ── Stage 2: Python Runtime with FFmpeg & FastAPI ──
FROM python:3.11-slim

# Install system dependencies including ffmpeg for audio transcoding
RUN apt-get update && apt-get install -y --no-install-recommends \
    ffmpeg \
    ca-certificates \
    curl \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app

# Install Python requirements
COPY backend/requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

# Copy backend code
COPY backend/ .

# Copy built frontend dist into /app/dist (FastAPI serves this statically)
COPY --from=frontend-builder /app/frontend/dist ./dist

# Render provides the PORT environment variable dynamically (defaults to 10000 or 7860)
ENV PORT=10000
EXPOSE 10000

CMD ["sh", "-c", "uvicorn main:app --host 0.0.0.0 --port ${PORT:-10000}"]
