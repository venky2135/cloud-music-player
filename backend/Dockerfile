# Dockerfile for Free Cloud Deployment (Hugging Face Spaces, Render, Fly.io, or Koyeb)
FROM python:3.11-slim

# Copy official standalone Deno binary (recommended by yt-dlp for JS challenges)
COPY --from=denoland/deno:bin /deno /usr/local/bin/deno

# Install system dependencies: ffmpeg, ca-certificates, curl, and Node.js 22 LTS
RUN apt-get update && apt-get install -y --no-install-recommends \
    ffmpeg \
    ca-certificates \
    curl \
    && curl -fsSL https://deb.nodesource.com/setup_22.x | bash - \
    && apt-get install -y --no-install-recommends nodejs \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app

COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

COPY . .

# Hugging Face Spaces listens on port 7860, Render uses PORT env var
ENV PORT=7860
EXPOSE 7860

CMD uvicorn main:app --host 0.0.0.0 --port ${PORT:-7860}
