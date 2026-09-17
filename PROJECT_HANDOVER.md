# 🎵 SoundVault — Project Handover Document

> **Purpose**: Complete context summary for continuing development in a new chat session.
> **Date**: 2026-09-18
> **Project Root**: `C:\Users\venka\.gemini\antigravity-ide\scratch\cloud-music-player\`

---

## 📌 What Was Built

**SoundVault** is a full-stack cloud music player web application with:
- A dark glassmorphic Spotify/Apple Music-style UI
- A Python backend with `yt-dlp` for audio extraction
- YouTube/SoundCloud/direct URL audio downloading and live streaming
- Supabase cloud storage integration
- Free hosting configuration (Vercel + Hugging Face Spaces / Render)

---

## 🏗 Complete Project Structure

```
C:\Users\venka\.gemini\antigravity-ide\scratch\cloud-music-player\
│
├── README.md                    ← Full feature list + local dev + free hosting guide
├── vercel.json                  ← 1-click Vercel frontend deployment config
│
├── backend/
│   ├── main.py                  ← FastAPI server (all endpoints)
│   ├── requirements.txt         ← Python dependencies
│   ├── Dockerfile               ← Docker image with ffmpeg (for Hugging Face / Render)
│   └── storage/
│       ├── tracks.json          ← Track metadata database (JSON)
│       ├── config.json          ← Storage provider config (local / supabase)
│       ├── audio/               ← Downloaded audio files (.mp3, .webm, etc.)
│       └── thumbnails/          ← Cached thumbnail images
│
└── frontend/
    ├── index.html               ← App shell with Google Fonts (Outfit, Plus Jakarta Sans)
    ├── package.json             ← Vite + TypeScript project config
    ├── tsconfig.json
    └── src/
        ├── main.ts              ← All frontend logic (player, downloader, stream, favorites)
        └── style.css            ← Complete CSS design system (dark glassmorphism)
```

---

## ⚙️ Tech Stack

| Layer | Technology |
|:---|:---|
| **Frontend** | Vite + TypeScript (vanilla, no React) |
| **Styling** | Vanilla CSS with CSS custom properties (glassmorphism) |
| **Icons** | Inline SVG (no icon library) |
| **Fonts** | Google Fonts — Outfit (headings), Plus Jakarta Sans (body) |
| **Backend** | Python 3.12, FastAPI, Uvicorn |
| **Audio Extraction** | `yt-dlp` (YouTube, SoundCloud, direct links) |
| **Audio Transcoding** | `ffmpeg` (in Docker; optional locally) |
| **Storage** | Local file system (default) or Supabase S3-compatible storage |
| **DB** | `storage/tracks.json` (flat JSON file, no SQL needed) |

---

## 🔌 Backend API Endpoints

| Method | Path | Description |
|:---|:---|:---|
| `GET` | `/api/health` | Health check |
| `GET` | `/api/tracks` | Get all saved tracks |
| `DELETE` | `/api/tracks/{id}` | Delete a track |
| `POST` | `/api/preview` | Inspect a URL — fetch title, artist, duration, thumbnail (no download) |
| `POST` | `/api/extract` | Download & transcode audio, save to storage, add to library |
| `GET` | `/api/stream?url=...` | **Live stream** — resolve direct audio stream URL from YouTube/SoundCloud, redirect to it (0 MB storage) |
| `POST` | `/api/bookmark` | **Bookmark a live stream** — fetch metadata, save as stream track, returns `/api/stream?url=...` as `audio_url` |
| `GET` | `/api/config` | Get current storage provider config |
| `POST` | `/api/config` | Update storage provider config |

---

## 🎯 All Features Implemented

### Music Player
- [x] Play / Pause / Previous / Next
- [x] Scrub seek bar (click to seek)
- [x] Volume slider + Mute toggle
- [x] Shuffle mode
- [x] Repeat mode: Off / All / One
- [x] Rotating vinyl disc animation during playback
- [x] Dynamic hero banner (updates to currently playing track)
- [x] Favorites system (heart icon, persisted in `localStorage`)
- [x] Real-time search filter by title or artist
- [x] Library tab & Favorites tab in sidebar
- [x] Web Audio API frequency visualizer (canvas bars in player bar)

### Keyboard Shortcuts
- [x] `Space` → Play / Pause
- [x] `ArrowRight` / `ArrowLeft` → Seek ±5 seconds
- [x] `ArrowUp` / `ArrowDown` → Volume ±5%
- [x] `M` → Toggle mute
- [x] `N` → Next track
- [x] `P` → Previous track

### URL Audio Downloader
- [x] Paste URL → click **Inspect** → see preview card (title, artist, thumbnail, duration)
- [x] **⚡ Stream & Save to Favorites (0 MB)** — zero storage, ad-free, bookmarks metadata, auto-added to Favorites for 1-click replay
- [x] **💾 Download to Drive** — downloads + transcodes, saves to local/cloud storage
- [x] Supports: YouTube, SoundCloud, direct `.mp3` / `.wav` / `.m4a` / `.ogg` / `.flac`

### Track Library
- [x] Track table with artwork, title, artist, duration, storage badge
- [x] Storage badges: `⚡ Live Stream (0 MB)` / `☁ Cloud Drive` / `💻 Local Drive`
- [x] Favorite / Unfavorite button per row
- [x] Delete button per row (removes from storage + metadata)
- [x] 3 demo tracks pre-seeded on first run (royalty-free from Pixabay)

### Cloud Storage
- [x] Local file server (default, zero config)
- [x] Supabase Storage integration (1 GB free, CDN streaming)
- [x] Settings modal in UI to configure provider + Supabase keys at runtime

---

## 🚀 How to Run Locally

### Backend
```powershell
cd C:\Users\venka\.gemini\antigravity-ide\scratch\cloud-music-player\backend

# Activate virtual environment
.\venv\Scripts\activate

# Start server (already installed)
uvicorn main:app --host 127.0.0.1 --port 8000 --reload
```
> API available at: `http://127.0.0.1:8000`
> Auto-docs at: `http://127.0.0.1:8000/docs`

### Frontend
```powershell
cd C:\Users\venka\.gemini\antigravity-ide\scratch\cloud-music-player\frontend

npx vite --port 5173 --host 127.0.0.1
```
> App available at: `http://127.0.0.1:5173`

> **Note**: The backend must be running before the frontend, as the frontend calls `http://127.0.0.1:8000` on load.

---

## ☁️ Free Hosting Deployment Guide

### Frontend → Vercel (Free)
1. Push project to GitHub
2. Go to [vercel.com](https://vercel.com) → Import repo
3. Set **Root Directory** = `frontend`
4. Build command: `npm run build`, Output: `dist`
5. After deploy, update `API_BASE` in `frontend/src/main.ts` to your backend URL

### Backend → Hugging Face Spaces (Free, does NOT sleep)
1. Create a new Space at [huggingface.co/spaces](https://huggingface.co/spaces)
2. SDK: **Docker**, Template: Blank
3. Upload `backend/Dockerfile`, `backend/main.py`, `backend/requirements.txt`
4. HF builds and gives you a public HTTPS URL (e.g., `https://username-space.hf.space`)

### Backend Alternative → Render (Free, sleeps after 15 min)
1. Push `backend/` to GitHub
2. Go to [render.com](https://render.com) → New Web Service → Connect repo
3. Environment: **Docker**, free tier
4. Set `PORT=7860` env var if needed

### Cloud Storage → Supabase (Free 1 GB)
1. Create project at [supabase.com](https://supabase.com)
2. Storage → New Bucket → Name: `music` → Public: **yes**
3. Project Settings → API → copy **Project URL** and **anon key**
4. In SoundVault UI: click ⚙ Settings → Switch to Supabase → paste credentials → Save

---

## 🐛 Known Issues / Things to Note

| Issue | Detail |
|:---|:---|
| **ffmpeg not installed locally** | Detected during setup. `yt-dlp` downloads `.webm`/`.m4a` containers natively without ffmpeg. In the Docker deployment, ffmpeg is included and will handle MP3 conversion. |
| **Stream URL expiry** | YouTube CDN stream URLs expire after ~6 hours. The backend caches them for 2 hours. On re-play after expiry, the backend auto re-resolves the fresh URL. |
| **YouTube login / age-restricted videos** | `yt-dlp` may fail on age-restricted or login-required YouTube videos. No fix has been implemented yet. |
| **CORS for stream redirect** | On some browsers, if a YouTube CDN URL has strict CORS, playback may fail with a CORS error. A proxy endpoint can be added to resolve this if needed. |
| **`tracks.json` not backed up** | If the `backend/storage/` folder is deleted, all track metadata is lost. Supabase integration stores files in cloud but metadata remains local. Consider backing up `tracks.json`. |

---

## 🔮 Suggested Next Steps

- [ ] **YouTube stream CORS proxy**: Add a `GET /api/proxy-stream?url=...` endpoint that pipes the YouTube audio bytes through the FastAPI server to avoid CORS issues.
- [ ] **Playlist support**: Allow grouping tracks into named playlists (e.g., Chill, Workout).
- [ ] **Persist stream URL refresh**: When a stream URL expires, auto-call `/api/stream` again transparently on `audio.error`.
- [ ] **Dark/Light theme toggle**: Add a theme switcher in the settings panel.
- [ ] **PWA (Progressive Web App)**: Add `manifest.json` and a service worker to enable "Add to Home Screen" on mobile.
- [ ] **Mobile bottom sheet player**: Improve the bottom player bar UX on small screens.
- [ ] **Import/Export library**: Allow exporting `tracks.json` and importing it in another browser or device.
- [ ] **Equalizer**: Add a Web Audio API EQ panel with bass/mid/treble sliders.
- [ ] **Backend auth (optional)**: If deploying publicly, add a simple API key to prevent unauthorized downloads.

---

## 📁 Key File Paths (Absolute)

| File | Path |
|:---|:---|
| Backend server | `C:\Users\venka\.gemini\antigravity-ide\scratch\cloud-music-player\backend\main.py` |
| Frontend app logic | `C:\Users\venka\.gemini\antigravity-ide\scratch\cloud-music-player\frontend\src\main.ts` |
| CSS design system | `C:\Users\venka\.gemini\antigravity-ide\scratch\cloud-music-player\frontend\src\style.css` |
| HTML shell | `C:\Users\venka\.gemini\antigravity-ide\scratch\cloud-music-player\frontend\index.html` |
| Dockerfile | `C:\Users\venka\.gemini\antigravity-ide\scratch\cloud-music-player\backend\Dockerfile` |
| Requirements | `C:\Users\venka\.gemini\antigravity-ide\scratch\cloud-music-player\backend\requirements.txt` |
| Track metadata DB | `C:\Users\venka\.gemini\antigravity-ide\scratch\cloud-music-player\backend\storage\tracks.json` |
| Storage config | `C:\Users\venka\.gemini\antigravity-ide\scratch\cloud-music-player\backend\storage\config.json` |
| README | `C:\Users\venka\.gemini\antigravity-ide\scratch\cloud-music-player\README.md` |
| Vercel config | `C:\Users\venka\.gemini\antigravity-ide\scratch\cloud-music-player\vercel.json` |

---

## 💬 Conversation Summary

This project was built from scratch in a single conversation with the following progression:

1. **Planning** — Discussed architecture: React/Vite frontend + FastAPI backend + yt-dlp + Supabase storage + free hosting on Vercel and Hugging Face Spaces.
2. **Environment Setup** — Node.js v22, Python 3.12, Vite scaffolded, Python venv created with all dependencies installed.
3. **Backend Built** — `main.py` with 8 API endpoints, yt-dlp integration, local + Supabase storage adapters, demo tracks pre-seeded.
4. **Frontend Built** — Full TypeScript app with Web Audio API visualizer, glassmorphic dark UI, all player controls, modal UI for URL downloader, settings panel.
5. **Build Verified** — TypeScript compiled clean, production bundle built in under 2 seconds.
6. **Live Streaming Feature Added** — User asked to stream YouTube without ads and without storing audio. Added `/api/stream` (redirect to raw CDN URL) and `/api/bookmark` endpoints. Frontend updated with the two-button choice modal.
7. **Favorites Replay Added** — Bookmarked streams are auto-added to Favorites so the user can replay without re-pasting the URL.
8. **Fully Verified via Browser Agent** — All features tested interactively: playback, seek, URL inspection, streaming, favorites tab.
9. **UI Redesign & Live Stream Cleanup** — Redesigned into minimal dark layout with `#C8FF00` lime accent, mobile-first responsive 2-panel/sheet design, and removed live stream feature in favor of pure URL downloader.
10. **Unified Single-Service Render Deployment** — Frontend packaged directly into FastAPI backend using a multi-stage `Dockerfile` and `render.yaml`. FastAPI serves the Vite `dist/` bundle on `/` while serving API endpoints on `/api/*`. One URL, one Render deployment.
11. **Option B Supabase Cloud Sync Configured** — Integrated Supabase storage bucket `music` and metadata backup/database synchronization. Credentials configured in `backend/.env` and `config.json`. Audio uploads stream directly over Supabase global CDN public URLs and local temporary audio is auto-cleaned. Created `supabase_schema.sql` for PostgreSQL table setup.

---

*Continue this project by opening the workspace at `C:\Users\venka\.gemini\antigravity-ide\scratch\cloud-music-player` in a new chat and referencing this file.*
