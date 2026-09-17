# 🎵 SoundVault — Cloud Music Player & URL Audio Downloader

SoundVault is a high-fidelity web music player and audio downloader with cloud drive synchronization and a minimal, responsive dark UI with lime accents.

---

## ✨ Features

- **⚡ Instant URL Audio Extractor & Downloader**: Paste any YouTube, SoundCloud, or direct audio link (`.mp3`, `.wav`, `.m4a`, etc.). The backend inspects, downloads, transcodes via FFmpeg, and saves the track directly to your drive.
- **☁ Cloud Drive Storage**:
  - **Local Drive Mode** (zero configuration, instant streaming)
  - **Supabase Cloud Storage** (1 GB free storage, fast global CDN, persistent audio files)
- **🎧 Core Music Player**:
  - Play, Pause, Previous, Next, Scrub Seek Bar, Duration Counter.
  - Shuffle and Repeat modes (Repeat All / Repeat One).
  - Volume slider with one-click Mute/Unmute.
  - Interactive Favorites / Liked songs system.
  - Real-time search filter across library.
- **📱 Responsive Minimal Design**:
  - Clean two-panel desktop layout (Library left, Now Playing right).
  - Native-app feel on mobile with bottom mini-player bar and slide-up full Now Playing screen.
  - Rotating vinyl artwork effect during playback.
- **⌨ Keyboard Shortcuts**:
  - `Space`: Play / Pause
  - `ArrowRight` / `ArrowLeft`: Seek ±5 seconds
  - `ArrowUp` / `ArrowDown`: Adjust volume ±5%
  - `M`: Toggle Mute
  - `N`: Next track
  - `P`: Previous track

---

## 🚀 Unified Single Deployment to Render (Frontend + Backend in One)

The frontend and backend can now be deployed together as **one single web service** on Render with **one URL**!

### How it works:
- The multi-stage `Dockerfile` in the root builds the Vite frontend bundle (`dist/`) in Stage 1.
- In Stage 2, it sets up Python 3.11 with `ffmpeg`, installs backend dependencies, and copies both the FastAPI backend and built frontend files into `/app`.
- FastAPI serves API endpoints on `/api/*`, stored audio on `/storage/*`, and the frontend static files on root `/`.
- API calls automatically use relative paths in production (no CORS issues, no separate hosting needed).

### Deploying to Render (Free Tier):
1. **Push your code to GitHub** (commit all files including `Dockerfile` and `render.yaml`).
2. Go to **[Render Dashboard](https://dashboard.render.com/)** and click **New +** → **Web Service** (or **Blueprint**).
3. Connect your GitHub repository.
4. If using **Web Service**:
   - **Environment**: `Docker`
   - **Dockerfile Path**: `./Dockerfile`
   - **Docker Build Context**: `.` (Root)
   - **Plan**: `Free`
5. Click **Create Web Service**.
6. Render will automatically build the Vite frontend, install FFmpeg + Python packages, and launch SoundVault on your dedicated Render URL (e.g. `https://soundvault-xxxx.onrender.com`).

> **Tip for Persistent Storage**: Render free-tier web services have an ephemeral filesystem (local downloaded files reset if the container restarts). To make your library persistent across restarts, connect **Supabase Storage** (free 1 GB) in the app's **Settings ⚙** modal.

---

## 💻 Local Development

### Option A: Running separately for rapid frontend development (Hot Reload)

**Backend:**
```bash
cd backend
python -m venv venv
# Windows:
.\venv\Scripts\activate
# Linux/macOS:
source venv/bin/activate

pip install -r requirements.txt
uvicorn main:app --port 8000 --reload
```

**Frontend:**
```bash
cd frontend
npm install
npm run dev
```
Open `http://localhost:5173`. In dev mode, the frontend automatically talks to `http://127.0.0.1:8000`.

---

### Option B: Running the unified single server locally

Build the frontend once and let FastAPI serve everything:
```bash
cd frontend
npm run build

cd ../backend
.\venv\Scripts\activate
uvicorn main:app --port 8000
```
Open `http://localhost:8000` to see both frontend and backend served together.
