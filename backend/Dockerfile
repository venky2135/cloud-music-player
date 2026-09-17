# Dockerfile for Free Cloud Deployment (Hugging Face Spaces, Render, Fly.io, or Koyeb)
FROM python:3.11-slim

# Install system dependencies including ffmpeg and nodejs for audio transcoding & yt-dlp challenge solving
RUN apt-get update && apt-get install -y --no-install-recommends \
    ffmpeg \
    nodejs \
    ca-certificates \
    curl \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app

COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

COPY . .

# Hugging Face Spaces listens on port 7860, Render uses PORT env var
ENV PORT=7860
EXPOSE 7860

CMD uvicorn main:app --host 0.0.0.0 --port ${PORT:-7860}
