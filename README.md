# 🎵 SoundVault — Cloud Music Player & URL Audio Downloader

SoundVault is a high-fidelity web music player and audio downloader with cloud drive synchronization and a sleek Spotify/Apple Music-grade dark glassmorphic design.

---

## ✨ Features

- **⚡ Instant URL Audio Extractor & Downloader**: Paste any YouTube, SoundCloud, or direct audio link (`.mp3`, `.wav`, `.m4a`, etc.). The backend inspects, downloads, transcodes, and saves the track directly to your drive.
- **🚀 Zero-Storage Ad-Free Live Stream**: Stream YouTube or web audio live with zero advertisements without saving any audio files to disk or storage (0 MB used).
- **❤️ Favorites & Replay Without Re-pasting**: Songs added via Live Stream are automatically saved to your Favorites with metadata and artwork so you can replay them anytime with a single click.
- **☁ Cloud Drive Storage**:
  - **Local Drive Mode** (zero configuration, instant streaming)
  - **Supabase Cloud Storage** (1 GB free storage, fast global CDN, direct streaming URLs)
  - **Google Drive API Support** (15 GB free tier)
- **🎧 Core Music Player**:
  - Play, Pause, Previous, Next, Scrub Seek Bar, Duration Counter.
  - Shuffle and Repeat modes (Repeat All / Repeat One).
  - Volume slider with one-click Mute/Unmute.
  - Interactive Favorites system.
  - Real-time search filter across library.
- **🎨 Visual Aesthetics**:
  - Real-time Audio Frequency Visualizer powered by HTML5 Web Audio API.
  - Rotating vinyl album artwork effect during playback.
  - Dynamic hero banner reflecting the active track.
- **⌨ Keyboard Shortcuts**:
  - `Space`: Play / Pause
  - `ArrowRight` / `ArrowLeft`: Seek ±5 seconds
  - `ArrowUp` / `ArrowDown`: Adjust volume ±5%
  - `M`: Toggle Mute
  - `N`: Next track
  - `P`: Previous track

---

## 🚀 Free Hosting & Deployment Guide

### 1. Backend Deployment (Free Docker Hosting)
The backend uses Python FastAPI, `yt-dlp`, and `ffmpeg`.

#### Target A: Hugging Face Spaces (Recommended - 100% Free, Does Not Sleep)
1. Go to [Hugging Face Spaces](https://huggingface.co/spaces) and click **Create new Space**.
2. Select **Docker** as SDK. Choose **Blank** template.
3. Upload the files in `backend/` (`Dockerfile`, `main.py`, `requirements.txt`).
4. Hugging Face builds and provides an HTTPS URL (e.g., `https://username-space-name.hf.space`).

#### Target B: Render (Free Web Service)
1. Push the code to a GitHub repository.
2. Go to [Render](https://render.com) and create a **New Web Service** pointing to `backend/`.
3. Select **Docker** environment and free tier.

---

### 2. Frontend Deployment (Free Static Hosting on Vercel or Netlify)
1. Go to [Vercel](https://vercel.com) or [Netlify](https://netlify.com).
2. Import the `frontend/` folder from your GitHub repo.
3. Build command: `npm run build`
4. Output directory: `dist`
5. (Optional) In `frontend/src/main.ts`, change `API_BASE` to your deployed backend URL.

---

### 3. Cloud Drive Storage Setup (Supabase Free Tier)
1. Sign up at [Supabase](https://supabase.com) (free 1 GB storage + Postgres).
2. Create a new project.
3. Go to **Storage** -> Click **New Bucket** -> Name it `music` and set it to **Public**.
4. Copy your **Project URL** and **API Key (anon or service_role)** from Project Settings -> API.
5. In the SoundVault UI, click the **Settings ⚙** icon on the bottom-left sidebar, switch provider to **Supabase Cloud Storage**, paste your URL and Key, and click **Save**. All future downloaded tracks will be uploaded directly to your cloud drive!

---

## 💻 Local Development

### Prerequisites
- Node.js (v18+)
- Python (v3.10+)

### Backend:
```bash
cd backend
python -m venv venv
# On Windows:
.\venv\Scripts\activate
# On Linux/macOS:
source venv/bin/activate

pip install -r requirements.txt
uvicorn main:app --port 8000 --reload
```

### Frontend:
```bash
cd frontend
npm install
npm run dev
```
Open `http://localhost:5173` in your browser.
