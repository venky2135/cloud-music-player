import os
import sys
import json
import uuid
import re
import time
import shutil
import requests
from pathlib import Path
from typing import Optional, List
from dotenv import load_dotenv

load_dotenv()

from fastapi import FastAPI, HTTPException, BackgroundTasks, Query
from fastapi.responses import RedirectResponse, FileResponse
from fastapi.middleware.cors import CORSMiddleware
from fastapi.staticfiles import StaticFiles
from pydantic import BaseModel
import yt_dlp
import urllib.parse

BASE_DIR = Path(__file__).resolve().parent
STORAGE_DIR = BASE_DIR / "storage"
AUDIO_DIR = STORAGE_DIR / "audio"
THUMB_DIR = STORAGE_DIR / "thumbnails"
METADATA_FILE = STORAGE_DIR / "tracks.json"
PLAYLISTS_FILE = STORAGE_DIR / "playlists.json"
CONFIG_FILE = STORAGE_DIR / "config.json"
COOKIES_FILE = STORAGE_DIR / "cookies.txt"

AUDIO_DIR.mkdir(parents=True, exist_ok=True)
THUMB_DIR.mkdir(parents=True, exist_ok=True)

def get_cookie_file_path() -> Optional[str]:
    if COOKIES_FILE.exists() and COOKIES_FILE.stat().st_size > 0:
        return str(COOKIES_FILE)
    alt = BASE_DIR / "cookies.txt"
    if alt.exists() and alt.stat().st_size > 0:
        return str(alt)
    env_cookies = os.getenv("YOUTUBE_COOKIES", "").strip()
    if env_cookies:
        try:
            with open(COOKIES_FILE, "w", encoding="utf-8") as f:
                f.write(env_cookies)
            return str(COOKIES_FILE)
        except Exception as e:
            print("Failed to write YOUTUBE_COOKIES env var to file:", e)
    return None

def get_ydl_opts(extra_opts: Optional[dict] = None) -> dict:
    js_runtimes = {}
    if shutil.which("deno"):
        js_runtimes["deno"] = {}
    if shutil.which("node"):
        js_runtimes["node"] = {}

    opts = {
        "quiet": True,
        "no_warnings": True,
        "remote_components": {"ejs:github": {}},
        "http_headers": {
            "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
            "Accept-Language": "en-US,en;q=0.9",
        }
    }
    if js_runtimes:
        opts["js_runtimes"] = js_runtimes

    cookie_path = get_cookie_file_path()
    if cookie_path:
        opts["cookiefile"] = cookie_path

    if extra_opts:
        for k, v in extra_opts.items():
            if k == "extractor_args" and isinstance(v, dict):
                if "extractor_args" not in opts:
                    opts["extractor_args"] = {}
                for ek, ev in v.items():
                    opts["extractor_args"][ek] = ev
            elif k == "http_headers" and isinstance(v, dict):
                opts["http_headers"].update(v)
            else:
                opts[k] = v
    return opts

def extract_youtube_video_id(url: str) -> Optional[str]:
    match = re.search(r'(?:v=|\/vi\/|youtu\.be\/|\/shorts\/|\/embed\/)([0-9A-Za-z_-]{11})', url)
    return match.group(1) if match else None

def fetch_youtube_oembed(url: str) -> Optional[dict]:
    try:
        encoded_url = urllib.parse.quote(url, safe="")
        oembed_url = f"https://www.youtube.com/oembed?url={encoded_url}&format=json"
        resp = requests.get(oembed_url, timeout=6)
        if resp.status_code == 200:
            data = resp.json()
            vid = extract_youtube_video_id(url)
            thumb = f"https://i.ytimg.com/vi/{vid}/hqdefault.jpg" if vid else data.get("thumbnail_url")
            return {
                "title": data.get("title", "Unknown Title"),
                "artist": data.get("author_name", "Unknown Artist"),
                "duration": 0.0,
                "thumbnail": thumb or "https://images.unsplash.com/photo-1511671782779-c97d3d27a1d4?w=600&auto=format&fit=crop&q=80",
                "source_url": url,
                "direct": False
            }
    except Exception as e:
        print("YouTube oEmbed fetch failed:", e)
    return None

app = FastAPI(title="Cloud Music Player & Audio Downloader API", version="1.0.0")

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

app.mount("/storage", StaticFiles(directory=str(STORAGE_DIR)), name="storage")

# Models
class ExtractRequest(BaseModel):
    url: str
    custom_title: Optional[str] = None
    custom_artist: Optional[str] = None

class PreviewRequest(BaseModel):
    url: str

class Track(BaseModel):
    id: str
    title: str
    artist: str
    duration: float
    thumbnail: str
    audio_url: str
    source_url: str
    filesize: Optional[int] = 0
    created_at: float

class StorageConfig(BaseModel):
    provider: str = "local" # local | supabase | drive
    supabase_url: Optional[str] = ""
    supabase_key: Optional[str] = ""
    supabase_bucket: Optional[str] = "music"
    youtube_cookies: Optional[str] = ""

class PlaylistCreate(BaseModel):
    name: str
    track_ids: Optional[List[str]] = []

class PlaylistUpdate(BaseModel):
    name: Optional[str] = None
    track_ids: Optional[List[str]] = None

class PlaylistAddTrack(BaseModel):
    track_id: str

def get_supabase_headers(cfg: dict) -> dict:
    key = cfg.get("supabase_key", "")
    return {
        "apikey": key,
        "Authorization": f"Bearer {key}",
        "Content-Type": "application/json"
    }

def fetch_supabase_tracks(cfg: dict) -> Optional[List[dict]]:
    supa_url = (cfg.get("supabase_url") or "").rstrip("/")
    if not supa_url or not cfg.get("supabase_key"):
        return None
    headers = get_supabase_headers(cfg)

    # 1. Try PostgreSQL table via PostgREST
    try:
        r = requests.get(f"{supa_url}/rest/v1/tracks?select=*&order=created_at.desc", headers=headers, timeout=5)
        if r.status_code == 200:
            return r.json()
    except Exception as e:
        print("Supabase DB query error:", e)

    # 2. Fallback to storage bucket metadata/tracks.json
    try:
        bucket = cfg.get("supabase_bucket", "music")
        cache_buster = int(time.time())
        r = requests.get(
            f"{supa_url}/storage/v1/object/public/{bucket}/metadata/tracks.json?t={cache_buster}",
            headers={"Cache-Control": "no-cache"},
            timeout=5
        )
        if r.status_code == 200:
            data = r.json()
            if isinstance(data, list) and len(data) > 0:
                return data
    except Exception as e:
        print("Supabase storage metadata fetch error:", e)

    return None

def save_supabase_track_item(track: dict, cfg: dict):
    supa_url = (cfg.get("supabase_url") or "").rstrip("/")
    if not supa_url or not cfg.get("supabase_key"):
        return
    headers = get_supabase_headers(cfg)
    try:
        # Upsert into PostgreSQL table
        requests.post(
            f"{supa_url}/rest/v1/tracks",
            headers={**headers, "Prefer": "resolution=merge-duplicates"},
            json=track,
            timeout=5
        )
    except Exception as e:
        print("Supabase DB track upsert error:", e)

def save_supabase_tracks_backup(tracks: List[dict], cfg: dict):
    supa_url = (cfg.get("supabase_url") or "").rstrip("/")
    if not supa_url or not cfg.get("supabase_key"):
        return
    headers = get_supabase_headers(cfg)
    bucket = cfg.get("supabase_bucket", "music")
    try:
        data = json.dumps(tracks).encode("utf-8")
        r = requests.post(
            f"{supa_url}/storage/v1/object/{bucket}/metadata/tracks.json",
            headers={**headers, "x-upsert": "true"},
            data=data,
            timeout=8
        )
        if r.status_code not in (200, 201):
            requests.put(
                f"{supa_url}/storage/v1/object/{bucket}/metadata/tracks.json",
                headers=headers,
                data=data,
                timeout=8
            )
    except Exception as e:
        print("Supabase storage metadata backup error:", e)

def delete_supabase_track(track_id: str, audio_url: str, cfg: dict):
    supa_url = (cfg.get("supabase_url") or "").rstrip("/")
    if not supa_url or not cfg.get("supabase_key"):
        return
    headers = get_supabase_headers(cfg)
    bucket = cfg.get("supabase_bucket", "music")

    # 1. Delete from PostgreSQL table
    try:
        requests.delete(f"{supa_url}/rest/v1/tracks?id=eq.{track_id}", headers=headers, timeout=5)
    except Exception as e:
        print("Supabase DB track delete error:", e)

    # 2. Delete audio file from storage bucket if hosted in Supabase
    try:
        if f"/storage/v1/object/public/{bucket}/" in audio_url:
            filename = audio_url.split(f"/storage/v1/object/public/{bucket}/")[-1]
            requests.delete(f"{supa_url}/storage/v1/object/{bucket}", headers=headers, json={"prefixes": [filename]}, timeout=5)
    except Exception as e:
        print("Supabase storage audio delete error:", e)

def load_local_tracks() -> List[dict]:
    if not METADATA_FILE.exists():
        initial_tracks = [
            {
                "id": "demo-1",
                "title": "Lofi Chill Beat (Aesthetic Reverie)",
                "artist": "Free Music Archive",
                "duration": 142.0,
                "thumbnail": "https://images.unsplash.com/photo-1518609878373-06d740f60d8b?w=600&auto=format&fit=crop&q=80",
                "audio_url": "https://cdn.pixabay.com/download/audio/2022/05/27/audio_1808fbf07a.mp3?filename=lofi-study-112191.mp3",
                "source_url": "https://pixabay.com/music/beats-lofi-study-112191/",
                "filesize": 2400000,
                "created_at": time.time() - 3600
            },
            {
                "id": "demo-2",
                "title": "Midnight City Lights (Synthwave)",
                "artist": "Neon Wave Project",
                "duration": 185.0,
                "thumbnail": "https://images.unsplash.com/photo-1508700115892-45ecd05ae2ad?w=600&auto=format&fit=crop&q=80",
                "audio_url": "https://cdn.pixabay.com/download/audio/2022/03/15/audio_c8c8a73467.mp3?filename=synthwave-80s-110045.mp3",
                "source_url": "https://pixabay.com/music/synthwave-80s-110045/",
                "filesize": 3100000,
                "created_at": time.time() - 1800
            },
            {
                "id": "demo-3",
                "title": "Cosmic Acoustic Journey",
                "artist": "Acoustic Horizon",
                "duration": 164.0,
                "thumbnail": "https://images.unsplash.com/photo-1445985543470-41fdd6ce388d?w=600&auto=format&fit=crop&q=80",
                "audio_url": "https://cdn.pixabay.com/download/audio/2022/01/18/audio_d0a13f69d2.mp3?filename=acoustic-guitars-ambient-chillout-14305.mp3",
                "source_url": "https://pixabay.com/music/acoustic-guitars-ambient-chillout-14305/",
                "filesize": 2750000,
                "created_at": time.time() - 900
            }
        ]
        save_local_tracks(initial_tracks)
        return initial_tracks

    try:
        with open(METADATA_FILE, "r", encoding="utf-8") as f:
            return json.load(f)
    except Exception:
        return []

def save_local_tracks(tracks: List[dict]):
    with open(METADATA_FILE, "w", encoding="utf-8") as f:
        json.dump(tracks, f, indent=2)

def load_tracks() -> List[dict]:
    cfg = load_config()
    if cfg.get("provider") == "supabase" and cfg.get("supabase_url") and cfg.get("supabase_key"):
        cloud_tracks = fetch_supabase_tracks(cfg)
        if cloud_tracks is not None and len(cloud_tracks) > 0:
            save_local_tracks(cloud_tracks)
            return cloud_tracks

    return load_local_tracks()

def save_tracks(tracks: List[dict]):
    save_local_tracks(tracks)
    cfg = load_config()
    if cfg.get("provider") == "supabase" and cfg.get("supabase_url") and cfg.get("supabase_key"):
        save_supabase_tracks_backup(tracks, cfg)

def load_local_playlists() -> List[dict]:
    if PLAYLISTS_FILE.exists():
        try:
            with open(PLAYLISTS_FILE, "r", encoding="utf-8") as f:
                return json.load(f)
        except Exception:
            return []
    return []

def save_local_playlists(playlists: List[dict]):
    with open(PLAYLISTS_FILE, "w", encoding="utf-8") as f:
        json.dump(playlists, f, indent=2)

def fetch_supabase_playlists(cfg: dict) -> Optional[List[dict]]:
    supa_url = (cfg.get("supabase_url") or "").rstrip("/")
    if not supa_url or not cfg.get("supabase_key"):
        return None
    headers = get_supabase_headers(cfg)
    try:
        r = requests.get(f"{supa_url}/rest/v1/playlists?select=*&order=created_at.asc", headers=headers, timeout=5)
        if r.status_code == 200:
            return r.json()
    except Exception as e:
        print("Supabase DB query playlists error:", e)

    try:
        bucket = cfg.get("supabase_bucket", "music")
        cache_buster = int(time.time())
        r = requests.get(
            f"{supa_url}/storage/v1/object/public/{bucket}/metadata/playlists.json?t={cache_buster}",
            headers={"Cache-Control": "no-cache"},
            timeout=5
        )
        if r.status_code == 200:
            data = r.json()
            if isinstance(data, list):
                return data
    except Exception as e:
        print("Supabase storage playlists fetch error:", e)
    return None

def save_supabase_playlists_backup(playlists: List[dict], cfg: dict):
    supa_url = (cfg.get("supabase_url") or "").rstrip("/")
    if not supa_url or not cfg.get("supabase_key"):
        return
    headers = get_supabase_headers(cfg)
    bucket = cfg.get("supabase_bucket", "music")
    try:
        data = json.dumps(playlists).encode("utf-8")
        requests.post(
            f"{supa_url}/storage/v1/object/{bucket}/metadata/playlists.json",
            headers={**headers, "x-upsert": "true"},
            data=data,
            timeout=8
        )
    except Exception as e:
        print("Supabase storage playlists backup error:", e)

def load_playlists() -> List[dict]:
    cfg = load_config()
    if cfg.get("provider") == "supabase" and cfg.get("supabase_url") and cfg.get("supabase_key"):
        cloud_pl = fetch_supabase_playlists(cfg)
        if cloud_pl is not None:
            save_local_playlists(cloud_pl)
            return cloud_pl
    return load_local_playlists()

def save_playlists(playlists: List[dict]):
    save_local_playlists(playlists)
    cfg = load_config()
    if cfg.get("provider") == "supabase" and cfg.get("supabase_url") and cfg.get("supabase_key"):
        save_supabase_playlists_backup(playlists, cfg)

def load_config() -> dict:
    cfg = {
        "provider": os.getenv("STORAGE_PROVIDER", "local"),
        "supabase_url": os.getenv("SUPABASE_URL", ""),
        "supabase_key": os.getenv("SUPABASE_KEY", ""),
        "supabase_bucket": os.getenv("SUPABASE_BUCKET", "music"),
        "youtube_cookies": ""
    }
    if CONFIG_FILE.exists():
        try:
            with open(CONFIG_FILE, "r", encoding="utf-8") as f:
                saved = json.load(f)
                for k, v in saved.items():
                    if v:
                        cfg[k] = v
        except Exception:
            pass
    if COOKIES_FILE.exists():
        try:
            with open(COOKIES_FILE, "r", encoding="utf-8") as f:
                cfg["youtube_cookies"] = f.read()
        except Exception:
            pass
    if cfg.get("supabase_url") and cfg.get("supabase_key"):
        if not cfg.get("provider") or cfg.get("provider") == "local":
            cfg["provider"] = "supabase"
    return cfg

def save_config_file(cfg: dict):
    # Don't persist full raw cookies in config.json; cookies are in cookies.txt
    filtered = {k: v for k, v in cfg.items() if k != "youtube_cookies"}
    with open(CONFIG_FILE, "w", encoding="utf-8") as f:
        json.dump(filtered, f, indent=2)

def upload_to_supabase(file_path: Path, filename: str, content_type: str = "audio/mpeg") -> Optional[str]:
    cfg = load_config()
    supa_url = (cfg.get("supabase_url") or "").rstrip("/")
    supa_key = cfg.get("supabase_key")
    bucket = cfg.get("supabase_bucket", "music")

    if not supa_url or not supa_key:
        return None

    try:
        endpoint = f"{supa_url}/storage/v1/object/{bucket}/{filename}"
        headers = {
            "Authorization": f"Bearer {supa_key}",
            "apikey": supa_key,
            "x-upsert": "true",
            "Content-Type": content_type
        }
        with open(file_path, "rb") as f:
            resp = requests.post(endpoint, headers=headers, data=f, timeout=60)
            if resp.status_code in (200, 201):
                return f"{supa_url}/storage/v1/object/public/{bucket}/{filename}"
            else:
                print("Supabase upload failed:", resp.status_code, resp.text)
                return None
    except Exception as e:
        print("Supabase upload exception:", e)
        return None

@app.get("/api/health")
def health_check():
    return {"status": "ok", "timestamp": time.time()}

@app.get("/api/config")
def get_config():
    return load_config()

@app.post("/api/config")
def update_config(config: StorageConfig):
    cfg_data = config.model_dump()
    cookies_content = cfg_data.get("youtube_cookies")
    if cookies_content is not None:
        cookies_str = cookies_content.strip()
        if cookies_str:
            try:
                with open(COOKIES_FILE, "w", encoding="utf-8") as f:
                    f.write(cookies_str)
            except Exception as e:
                print("Failed to save cookies.txt:", e)
        elif COOKIES_FILE.exists():
            try:
                COOKIES_FILE.unlink()
            except Exception:
                pass
    save_config_file(cfg_data)
    return {"message": "Configuration updated successfully", "config": load_config()}

@app.get("/api/tracks")
def get_tracks():
    tracks = load_tracks()
    return {"tracks": tracks}

@app.delete("/api/tracks/{track_id}")
def delete_track(track_id: str):
    tracks = load_tracks()
    track_to_delete = None
    remaining_tracks = []
    
    for t in tracks:
        if t["id"] == track_id:
            track_to_delete = t
        else:
            remaining_tracks.append(t)
            
    if not track_to_delete:
        raise HTTPException(status_code=404, detail="Track not found")
        
    save_tracks(remaining_tracks)
    
    audio_url = track_to_delete.get("audio_url", "")
    cfg = load_config()
    if cfg.get("provider") == "supabase" and cfg.get("supabase_url") and cfg.get("supabase_key"):
        delete_supabase_track(track_id, audio_url, cfg)

    # Try removing local file if it exists
    if "/storage/audio/" in audio_url:
        filename = audio_url.split("/storage/audio/")[-1]
        local_path = AUDIO_DIR / filename
        if local_path.exists():
            try:
                local_path.unlink()
            except Exception as e:
                print(f"Could not delete {local_path}: {e}")

    # Remove track from any playlists referencing it
    try:
        playlists = load_playlists()
        pl_modified = False
        for pl in playlists:
            if track_id in pl.get("track_ids", []):
                pl["track_ids"] = [tid for tid in pl["track_ids"] if tid != track_id]
                pl_modified = True
        if pl_modified:
            save_playlists(playlists)
    except Exception as e:
        print("Failed to clean up track from playlists:", e)

    return {"message": "Track deleted successfully", "id": track_id}

@app.get("/api/playlists")
def get_playlists():
    return {"playlists": load_playlists()}

@app.post("/api/playlists")
def create_playlist(req: PlaylistCreate):
    name = req.name.strip()
    if not name:
        raise HTTPException(status_code=400, detail="Playlist name cannot be empty")
    playlists = load_playlists()
    new_pl = {
        "id": f"pl_{uuid.uuid4().hex[:8]}",
        "name": name,
        "track_ids": req.track_ids or [],
        "created_at": time.time()
    }
    playlists.append(new_pl)
    save_playlists(playlists)
    return {"playlist": new_pl}

@app.put("/api/playlists/{playlist_id}")
def update_playlist(playlist_id: str, req: PlaylistUpdate):
    playlists = load_playlists()
    found = None
    for pl in playlists:
        if pl["id"] == playlist_id:
            found = pl
            break
    if not found:
        raise HTTPException(status_code=404, detail="Playlist not found")
    if req.name is not None:
        trimmed = req.name.strip()
        if trimmed:
            found["name"] = trimmed
    if req.track_ids is not None:
        found["track_ids"] = req.track_ids
    save_playlists(playlists)
    return {"playlist": found}

@app.delete("/api/playlists/{playlist_id}")
def delete_playlist(playlist_id: str):
    playlists = load_playlists()
    new_pls = [p for p in playlists if p["id"] != playlist_id]
    if len(new_pls) == len(playlists):
        raise HTTPException(status_code=404, detail="Playlist not found")
    save_playlists(new_pls)
    return {"message": "Playlist deleted successfully", "id": playlist_id}

@app.post("/api/playlists/{playlist_id}/tracks")
def add_track_to_playlist(playlist_id: str, req: PlaylistAddTrack):
    playlists = load_playlists()
    found = None
    for pl in playlists:
        if pl["id"] == playlist_id:
            found = pl
            break
    if not found:
        raise HTTPException(status_code=404, detail="Playlist not found")
    if req.track_id not in found["track_ids"]:
        found["track_ids"].append(req.track_id)
        save_playlists(playlists)
    return {"playlist": found}

@app.delete("/api/playlists/{playlist_id}/tracks/{track_id}")
def remove_track_from_playlist(playlist_id: str, track_id: str):
    playlists = load_playlists()
    found = None
    for pl in playlists:
        if pl["id"] == playlist_id:
            found = pl
            break
    if not found:
        raise HTTPException(status_code=404, detail="Playlist not found")
    found["track_ids"] = [tid for tid in found["track_ids"] if tid != track_id]
    save_playlists(playlists)
    return {"playlist": found}

@app.post("/api/preview")
def preview_url(req: PreviewRequest):
    url = req.url.strip()
    if not url:
        raise HTTPException(status_code=400, detail="Empty URL provided")

    # Check direct audio link
    audio_extensions = (".mp3", ".wav", ".m4a", ".aac", ".ogg", ".flac")
    clean_url = url.split("?")[0].lower()
    if any(clean_url.endswith(ext) for ext in audio_extensions):
        filename = Path(clean_url).name
        return {
            "title": filename,
            "artist": "Direct Audio Stream",
            "duration": 0,
            "thumbnail": "https://images.unsplash.com/photo-1470225620780-dba8ba36b745?w=600&auto=format&fit=crop&q=80",
            "source_url": url,
            "direct": True
        }

    is_youtube = ("youtube.com" in url.lower() or "youtu.be" in url.lower())

    # For YouTube, pre-fetch oEmbed metadata (never blocked by YouTube bot checks on datacenter IPs)
    oembed_meta = None
    if is_youtube:
        oembed_meta = fetch_youtube_oembed(url)

    # Attempt yt-dlp metadata extraction using mobile player client
    ydl_opts = get_ydl_opts({
        "skip_download": True,
        "extract_flat": "in_playlist",
    })
    
    try:
        with yt_dlp.YoutubeDL(ydl_opts) as ydl:
            info = ydl.extract_info(url, download=False)
            title = info.get("title") or (oembed_meta["title"] if oembed_meta else "Unknown Title")
            artist = info.get("artist") or info.get("uploader") or info.get("channel") or (oembed_meta["artist"] if oembed_meta else "Unknown Artist")
            duration = float(info.get("duration", 0) or (oembed_meta["duration"] if oembed_meta else 0))
            thumbnail = info.get("thumbnail") or (oembed_meta["thumbnail"] if oembed_meta else "https://images.unsplash.com/photo-1511671782779-c97d3d27a1d4?w=600&auto=format&fit=crop&q=80")
            return {
                "title": title,
                "artist": artist,
                "duration": duration,
                "thumbnail": thumbnail,
                "source_url": url,
                "direct": False
            }
    except Exception as e:
        # If yt-dlp hit bot check / error, but oEmbed succeeded, return oEmbed metadata
        if oembed_meta:
            return oembed_meta
        raise HTTPException(status_code=400, detail=f"Failed to inspect URL: {str(e)}")

@app.post("/api/extract")
def extract_and_download(req: ExtractRequest):
    url = req.url.strip()
    if not url:
        raise HTTPException(status_code=400, detail="Empty URL provided")

    track_id = str(uuid.uuid4())[:8]
    output_filename = f"{track_id}.mp3"
    local_output_path = AUDIO_DIR / output_filename
    
    title = req.custom_title or ""
    artist = req.custom_artist or ""
    duration = 0.0
    thumbnail = ""
    source_url = url
    filesize = 0

    audio_extensions = (".mp3", ".wav", ".m4a", ".aac", ".ogg", ".flac")
    clean_url = url.split("?")[0].lower()

    # Direct audio file download branch
    if any(clean_url.endswith(ext) for ext in audio_extensions):
        try:
            resp = requests.get(url, stream=True, timeout=30)
            resp.raise_for_status()
            with open(local_output_path, "wb") as f:
                for chunk in resp.iter_content(chunk_size=65536):
                    if chunk:
                        f.write(chunk)
            
            filesize = local_output_path.stat().st_size
            title = title or Path(clean_url).stem
            artist = artist or "Direct Audio Link"
            duration = 180.0 # Default estimation if header omitted
            thumbnail = "https://images.unsplash.com/photo-1511671782779-c97d3d27a1d4?w=600&auto=format&fit=crop&q=80"
        except Exception as e:
            raise HTTPException(status_code=400, detail=f"Failed to download direct audio: {str(e)}")

    else:
        # yt-dlp audio download prioritizing YouTube's highest bitrate pure audio streams (Opus 160kbps / AAC 130kbps)
        ydl_opts = get_ydl_opts({
            "format": "bestaudio[abr>0]/bestaudio[ext=webm]/bestaudio[ext=m4a]/bestaudio/best",
            "format_sort": ["abr", "quality", "hasaud"],
            "outtmpl": str(AUDIO_DIR / f"{track_id}.%(ext)s"),
        })

        try:
            with yt_dlp.YoutubeDL(ydl_opts) as ydl:
                info = ydl.extract_info(url, download=True)
                title = title or info.get("title", "Unknown Title")
                artist = artist or info.get("artist") or info.get("uploader") or info.get("channel") or "Unknown Artist"
                duration = float(info.get("duration", 0) or 0)
                thumbnail = info.get("thumbnail") or "https://images.unsplash.com/photo-1511671782779-c97d3d27a1d4?w=600&auto=format&fit=crop&q=80"
                
                # Check what file was written
                candidates = list(AUDIO_DIR.glob(f"{track_id}.*"))
                if candidates:
                    chosen_file = candidates[0]
                    filesize = chosen_file.stat().st_size
                    output_filename = chosen_file.name
                    local_output_path = chosen_file
                else:
                    raise Exception("Audio file could not be generated by extractor")
        except Exception as e:
            err_msg = str(e)
            if "bot" in err_msg.lower() or "cookies" in err_msg.lower():
                err_msg = "YouTube bot verification triggered. Add YouTube cookies in Cloud Storage Settings or provide a direct audio URL."
            raise HTTPException(status_code=400, detail=f"Failed to extract audio with yt-dlp: {err_msg}")

    # Storage decision: Try Supabase if configured, otherwise fallback to local server stream
    cfg = load_config()
    final_audio_url = f"/storage/audio/{output_filename}"
    
    if cfg.get("provider") == "supabase" and cfg.get("supabase_url") and cfg.get("supabase_key"):
        supa_url = upload_to_supabase(local_output_path, output_filename)
        if supa_url:
            final_audio_url = supa_url
            try:
                local_output_path.unlink()
            except Exception as e:
                print(f"Could not remove local temp audio: {e}")

    new_track = {
        "id": track_id,
        "title": title,
        "artist": artist,
        "duration": duration,
        "thumbnail": thumbnail,
        "audio_url": final_audio_url,
        "source_url": source_url,
        "filesize": filesize,
        "created_at": time.time()
    }

    current_tracks = load_tracks()
    current_tracks.insert(0, new_track)
    save_tracks(current_tracks)
    if cfg.get("provider") == "supabase":
        save_supabase_track_item(new_track, cfg)

    return {"message": "Track downloaded and saved successfully", "track": new_track}

# In-memory stream URL cache to avoid repeated extraction calls
STREAM_CACHE = {}

@app.get("/api/stream")
def stream_audio(url: str = Query(...)):
    url = url.strip()
    if not url:
        raise HTTPException(status_code=400, detail="Missing URL")

    # If direct mp3/wav audio link, redirect straight to it
    audio_extensions = (".mp3", ".wav", ".m4a", ".aac", ".ogg", ".flac")
    clean_url = url.split("?")[0].lower()
    if any(clean_url.endswith(ext) for ext in audio_extensions):
        return RedirectResponse(url, status_code=302)

    # Check cache (valid for 2 hours)
    now = time.time()
    if url in STREAM_CACHE:
        cached_url, expire_at = STREAM_CACHE[url]
        if now < expire_at:
            return RedirectResponse(cached_url, status_code=302)

    ydl_opts = get_ydl_opts({
        "format": "bestaudio/best",
        "skip_download": True,
    })

    try:
        with yt_dlp.YoutubeDL(ydl_opts) as ydl:
            info = ydl.extract_info(url, download=False)
            direct_stream = info.get("url")
            if not direct_stream and "formats" in info:
                audio_formats = [f for f in info["formats"] if f.get("vcodec") == "none" and f.get("url")]
                if audio_formats:
                    direct_stream = audio_formats[-1].get("url")
                else:
                    direct_stream = info["formats"][-1].get("url")

            if not direct_stream:
                raise Exception("Could not resolve media stream URL")

            STREAM_CACHE[url] = (direct_stream, now + 7200)
            return RedirectResponse(direct_stream, status_code=302)
    except Exception as e:
        raise HTTPException(status_code=400, detail=f"Failed to resolve live audio stream: {str(e)}")

@app.post("/api/bookmark")
def bookmark_stream(req: ExtractRequest):
    url = req.url.strip()
    if not url:
        raise HTTPException(status_code=400, detail="Empty URL provided")

    track_id = f"stream-{str(uuid.uuid4())[:8]}"
    title = req.custom_title or ""
    artist = req.custom_artist or ""
    duration = 0.0
    thumbnail = ""

    audio_extensions = (".mp3", ".wav", ".m4a", ".aac", ".ogg", ".flac")
    clean_url = url.split("?")[0].lower()

    if any(clean_url.endswith(ext) for ext in audio_extensions):
        title = title or Path(clean_url).stem
        artist = artist or "Direct Audio Stream"
        duration = 180.0
        thumbnail = "https://images.unsplash.com/photo-1511671782779-c97d3d27a1d4?w=600&auto=format&fit=crop&q=80"
    else:
        is_youtube = ("youtube.com" in url.lower() or "youtu.be" in url.lower())
        oembed_meta = fetch_youtube_oembed(url) if is_youtube else None

        ydl_opts = get_ydl_opts({
            "skip_download": True,
            "extract_flat": "in_playlist",
        })
        try:
            with yt_dlp.YoutubeDL(ydl_opts) as ydl:
                info = ydl.extract_info(url, download=False)
                title = title or info.get("title", "Unknown Title")
                artist = artist or info.get("artist") or info.get("uploader") or info.get("channel") or "Unknown Artist"
                duration = float(info.get("duration", 0) or 0)
                thumbnail = info.get("thumbnail") or "https://images.unsplash.com/photo-1511671782779-c97d3d27a1d4?w=600&auto=format&fit=crop&q=80"
        except Exception as e:
            if oembed_meta:
                title = title or oembed_meta["title"]
                artist = artist or oembed_meta["artist"]
                thumbnail = thumbnail or oembed_meta["thumbnail"]
            else:
                raise HTTPException(status_code=400, detail=f"Failed to inspect YouTube URL: {str(e)}")

    encoded_url = urllib.parse.quote(url)
    stream_endpoint = f"/api/stream?url={encoded_url}"

    new_track = {
        "id": track_id,
        "title": title,
        "artist": artist,
        "duration": duration,
        "thumbnail": thumbnail,
        "audio_url": stream_endpoint,
        "source_url": url,
        "filesize": 0,
        "is_stream": True,
        "created_at": time.time()
    }

    current_tracks = load_tracks()
    current_tracks.insert(0, new_track)
    save_tracks(current_tracks)

    return {"message": "Stream bookmarked successfully", "track": new_track}


# ── Frontend Static Files (Single-deployment / Combined build) ──
FRONTEND_DIST = BASE_DIR / "dist"
if not FRONTEND_DIST.exists():
    # Fallback to sibling frontend/dist when testing in development repo
    FRONTEND_DIST = BASE_DIR.parent / "frontend" / "dist"

if FRONTEND_DIST.exists():
    app.mount("/", StaticFiles(directory=str(FRONTEND_DIST), html=True), name="frontend")


