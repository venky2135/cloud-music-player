import './style.css';
import { Capacitor, registerPlugin } from '@capacitor/core';

interface MusicNotificationPluginType {
  update(options: {
    title: string;
    artist: string;
    isPlaying: boolean;
    thumbnailUrl?: string;
    duration?: number;
    position?: number;
  }): Promise<void>;
  setPosition(options: {
    position: number;
    isPlaying: boolean;
  }): Promise<void>;
  clear(): Promise<void>;
  checkPermissions(): Promise<{ notifications: string }>;
  requestPermissions(options: { permissions: string[] }): Promise<{ notifications: string }>;
  addListener(
    eventName: 'musicControlsAction',
    listenerFunc: (data: { action: 'play' | 'pause' | 'next' | 'previous' | 'seek'; time?: number }) => void
  ): Promise<any>;
}

const MusicNotification = registerPlugin<MusicNotificationPluginType>('MusicNotification');

interface Track {
  id: string;
  title: string;
  artist: string;
  duration: number;
  thumbnail: string;
  audio_url: string;
  source_url: string;
  filesize?: number;
  is_stream?: boolean;
  created_at: number;
}

interface CloudConfig {
  provider: string;
  supabase_url: string;
  supabase_key: string;
  supabase_bucket: string;
  youtube_cookies?: string;
}

interface Playlist {
  id: string;
  name: string;
  track_ids: string[];
  created_at: number;
}

const RENDER_BACKEND = 'https://cloud-music-player-wzd5.onrender.com';
// In dev (port 5173) → local backend. In Capacitor native app or prod → Render backend.
const API_BASE = window.location.port === '5173' ? 'http://127.0.0.1:8000' : RENDER_BACKEND;

class MusicPlayerApp {
  private tracks: Track[] = [];
  private currentTrack: Track | null = null;
  private isPlaying = false;
  private isShuffle = false;
  private repeatMode: 'off' | 'all' | 'one' = 'all';
  private volume = 0.8;
  private isMuted = false;
  private searchQuery = '';
  private activeFilter: 'all' | 'liked' | 'playlist' = 'all';
  private activePlaylistId: string | null = null;
  private playlists: Playlist[] = [];
  private favorites = new Set<string>(
    JSON.parse(localStorage.getItem('soundvault_favs') || '[]')
  );
  private cloudConfig: CloudConfig = {
    provider: 'local',
    supabase_url: '',
    supabase_key: '',
    supabase_bucket: 'music',
    youtube_cookies: '',
  };

  // Audio engine
  private audio: HTMLAudioElement;
  private isAutoAdvancing = false;

  // Sleep timer state
  private sleepTimerTargetTime: number | null = null;
  private sleepTimerType: 'duration' | 'end-of-track' | null = null;
  private sleepTimerIntervalId: number | null = null;
  private sleepTimerFadeOut = true;
  private sleepTimerOriginalVolume = 0.8;
  private isFadingVolume = false;

  constructor() {
    this.audio = new Audio();
    this.audio.preload = 'auto';
    this.audio.setAttribute('playsinline', 'true');
    this.audio.setAttribute('webkit-playsinline', 'true');
    this.audio.volume = this.volume;

    this.renderShell();
    this.renderFilterPills();
    this.attachListeners();
    this.initAudioEvents();
    this.initKeyboard();
    this.initNativeMusicControls();
    this.fetchConfig();
    this.fetchTracks();
    this.fetchPlaylists();
  }

  // ──────────────────────────────────────────
  // HELPERS
  // ──────────────────────────────────────────

  private resolveAudioUrl(url: string): string {
    return url.startsWith('/storage') ? `${API_BASE}${url}` : url;
  }

  private resolveMediaUrl(url: string): string {
    if (!url) return '';
    return url.startsWith('/storage') ? `${API_BASE}${url}` : url;
  }

  private fmt(sec: number): string {
    if (isNaN(sec) || sec < 0) return '0:00';
    const m = Math.floor(sec / 60);
    const s = Math.floor(sec % 60);
    return `${m}:${s < 10 ? '0' : ''}${s}`;
  }

  private toast(msg: string, type: 'success' | 'error' = 'success') {
    const zone = document.getElementById('toast-zone')!;
    const t = document.createElement('div');
    t.className = `toast${type === 'error' ? ' error' : ''}`;
    t.textContent = msg;
    zone.appendChild(t);
    setTimeout(() => {
      t.style.transition = 'opacity 0.3s, transform 0.3s';
      t.style.opacity = '0';
      t.style.transform = 'translateY(8px) scale(0.94)';
      setTimeout(() => t.remove(), 300);
    }, 3000);
  }

  private $ = <T extends HTMLElement>(id: string) =>
    document.getElementById(id) as T;

  // ──────────────────────────────────────────
  // SHELL RENDER
  // ──────────────────────────────────────────

  private renderShell() {
    document.getElementById('app')!.innerHTML = `
      <div class="app-layout">

        <!-- ═══ LIBRARY PANEL ═══ -->
        <div class="library-panel">

          <!-- Header -->
          <div class="lib-header">
            <div class="menu-btn-wrap">
              <button class="icon-btn" id="btn-menu" title="Menu" aria-label="Open menu">
                <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round">
                  <line x1="3" y1="6" x2="21" y2="6"/>
                  <line x1="3" y1="12" x2="21" y2="12"/>
                  <line x1="3" y1="18" x2="21" y2="18"/>
                </svg>
              </button>
              <span class="menu-badge" id="menu-timer-badge" style="display:none;"></span>
            </div>
            <h1 class="lib-header-title">My Music</h1>
            <button class="icon-btn accent" id="btn-open-dl" title="Add song from URL" aria-label="Add song">
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5">
                <line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/>
              </svg>
            </button>
          </div>

          <!-- Search -->
          <div class="search-wrap">
            <div class="search-inner">
              <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                <circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/>
              </svg>
              <input type="text" id="search-input" placeholder="Search songs, artists…" autocomplete="off" />
            </div>
          </div>

          <!-- Filter Pills -->
          <div class="filter-row" id="filter-row">
            <button class="pill active" id="pill-all">All</button>
            <button class="pill" id="pill-liked">Liked Songs</button>
          </div>

          <!-- Track List -->
          <div class="track-list" id="track-list">
            <!-- injected by renderTrackList() -->
          </div>

          <!-- Mini Player (mobile only) -->
          <div class="mini-player hidden" id="mini-player">
            <img class="mini-art" id="mini-art"
              src="data:image/svg+xml,<svg xmlns='http://www.w3.org/2000/svg'/>" alt="Art" />
            <div class="mini-info">
              <div class="mini-title" id="mini-title">—</div>
              <div class="mini-artist" id="mini-artist">—</div>
            </div>
            <div class="mini-controls">
              <button class="mini-btn" id="mini-prev" title="Previous" aria-label="Previous">
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                  <polygon points="19 20 9 12 19 4 19 20"/><line x1="5" y1="19" x2="5" y2="5"/>
                </svg>
              </button>
              <button class="mini-play-btn" id="mini-play" title="Play / Pause" aria-label="Play/Pause">
                <svg id="mini-play-icon" width="17" height="17" viewBox="0 0 24 24" fill="currentColor">
                  <polygon points="5 3 19 12 5 21 5 3"/>
                </svg>
              </button>
              <button class="mini-btn" id="mini-next" title="Next" aria-label="Next">
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                  <polygon points="5 4 15 12 5 20 5 4"/><line x1="19" y1="5" x2="19" y2="19"/>
                </svg>
              </button>
            </div>
          </div>
        </div>

        <!-- ═══ NOW PLAYING PANEL ═══ -->
        <div class="now-playing-panel" id="now-playing-panel">
          <div class="np-header">
            <button class="np-back-btn" id="np-back" title="Back to library" aria-label="Back">
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5">
                <polyline points="15 18 9 12 15 6"/>
              </svg>
            </button>
            <span class="np-header-title">Now Playing</span>
            <div style="display:flex;align-items:center;gap:8px;">
              <button class="np-sleep-btn" id="np-sleep-btn" title="Sleep timer" aria-label="Sleep timer">
                <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                  <path d="M12 3a6 6 0 0 0 9 9 9 9 0 1 1-9-9Z"/>
                </svg>
                <span class="np-sleep-badge" id="np-sleep-badge" style="display:none;"></span>
              </button>
              <button class="np-fav-btn" id="np-fav" title="Like / Unlike" aria-label="Like">
                <svg id="np-fav-icon" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                  <path d="M19 14c1.49-1.46 3-3.21 3-5.5A5.5 5.5 0 0 0 16.5 3c-1.76 0-3 .5-4.5 2-1.5-1.5-2.74-2-4.5-2A5.5 5.5 0 0 0 2 8.5c0 2.3 1.5 4.05 3 5.5l7 7Z"/>
                </svg>
              </button>
            </div>
          </div>

          <!-- Idle -->
          <div class="np-idle" id="np-idle">
            <span class="np-idle-icon">🎵</span>
            <h3>Nothing playing</h3>
            <p>Select a track from your library to start listening</p>
          </div>

          <!-- Active -->
          <div class="np-active" id="np-active">
            <div class="artwork-section">
              <div class="artwork-glow" id="artwork-glow"></div>
              <img class="artwork-img" id="artwork-img"
                src="data:image/svg+xml,<svg xmlns='http://www.w3.org/2000/svg'/>" alt="Album art" />
            </div>

            <div class="np-info">
              <div class="np-title" id="np-title">—</div>
              <div class="np-artist" id="np-artist">—</div>
            </div>

            <div class="np-progress">
              <div class="seek-bar" id="seek-bar">
                <div class="seek-fill" id="seek-fill" style="width:0%"></div>
              </div>
              <div class="time-row">
                <span id="current-time">0:00</span>
                <span id="total-time">0:00</span>
              </div>
            </div>

            <div class="np-controls">
              <!-- Shuffle -->
              <button class="ctrl-btn" id="ctrl-shuffle" title="Shuffle" aria-label="Shuffle">
                <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                  <polyline points="16 3 21 3 21 8"/><line x1="4" y1="20" x2="21" y2="3"/>
                  <polyline points="21 16 21 21 16 21"/><line x1="15" y1="15" x2="21" y2="21"/>
                  <line x1="4" y1="4" x2="9" y2="9"/>
                </svg>
              </button>
              <!-- Prev -->
              <button class="ctrl-btn" id="ctrl-prev" title="Previous" aria-label="Previous">
                <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                  <polygon points="19 20 9 12 19 4 19 20"/><line x1="5" y1="19" x2="5" y2="5"/>
                </svg>
              </button>
              <!-- Play/Pause -->
              <button class="ctrl-play-btn" id="ctrl-play" title="Play / Pause" aria-label="Play/Pause">
                <svg id="play-icon" width="24" height="24" viewBox="0 0 24 24" fill="currentColor">
                  <polygon points="5 3 19 12 5 21 5 3"/>
                </svg>
              </button>
              <!-- Next -->
              <button class="ctrl-btn" id="ctrl-next" title="Next" aria-label="Next">
                <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                  <polygon points="5 4 15 12 5 20 5 4"/><line x1="19" y1="5" x2="19" y2="19"/>
                </svg>
              </button>
              <!-- Repeat -->
              <button class="ctrl-btn active" id="ctrl-repeat" title="Repeat" aria-label="Repeat">
                <svg id="repeat-icon" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                  <polyline points="17 1 21 5 17 9"/>
                  <path d="M3 11V9a4 4 0 0 1 4-4h14"/>
                  <polyline points="7 23 3 19 7 15"/>
                  <path d="M21 13v2a4 4 0 0 1-4 4H3"/>
                </svg>
              </button>
            </div>

            <!-- Volume -->
            <div class="np-volume">
              <button class="ctrl-btn" id="btn-mute" title="Mute" aria-label="Mute" style="width:30px;height:30px;">
                <svg id="vol-icon" width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                  <polygon points="11 5 6 9 2 9 2 15 6 15 11 19 11 5"/>
                  <path d="M15.54 8.46a5 5 0 0 1 0 7.07"/>
                  <path d="M19.07 4.93a10 10 0 0 1 0 14.14"/>
                </svg>
              </button>
              <input type="range" class="vol-slider" id="vol-slider" min="0" max="1" step="0.01" value="0.8" />
            </div>
          </div>
        </div>
      </div>

      <!-- ═══ DOWNLOAD MODAL ═══ -->
      <div class="modal-overlay" id="modal-dl" role="dialog" aria-modal="true" aria-label="Add song from URL">
        <div class="modal-card">
          <div class="modal-handle"></div>
          <div class="modal-header">
            <div class="modal-title-row">
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5">
                <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/>
                <polyline points="7 10 12 15 17 10"/><line x1="12" y1="15" x2="12" y2="3"/>
              </svg>
              <span class="modal-title-text">Add from URL</span>
            </div>
            <button class="btn-close" id="btn-close-dl" aria-label="Close">&#x2715;</button>
          </div>

          <div class="modal-body">
            <div class="form-group">
              <label class="form-label" for="url-input">YouTube, SoundCloud or direct audio link</label>
              <div class="url-row">
                <input type="url" id="url-input" class="form-input"
                  placeholder="https://www.youtube.com/watch?v=…" autocomplete="off" />
                <button class="btn-inspect" id="btn-inspect" aria-label="Inspect URL">
                  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                    <circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/>
                  </svg>
                  Inspect
                </button>
              </div>
            </div>

            <!-- Preview (hidden until inspected) -->
            <div class="preview-box" id="preview-box" style="display:none">
              <img class="preview-thumb" id="preview-thumb" src="" alt="Thumbnail" />
              <div>
                <div class="pv-title" id="pv-title">—</div>
                <div class="pv-artist" id="pv-artist">—</div>
                <div class="pv-duration" id="pv-duration">—</div>
              </div>
            </div>

            <!-- Edit fields (hidden until inspected) -->
            <div id="edit-fields" style="display:none;flex-direction:column;gap:12px;">
              <div class="form-group">
                <label class="form-label" for="custom-title">Title (optional)</label>
                <input type="text" id="custom-title" class="form-input" placeholder="Track title" />
              </div>
              <div class="form-group">
                <label class="form-label" for="custom-artist">Artist (optional)</label>
                <input type="text" id="custom-artist" class="form-input" placeholder="Artist name" />
              </div>
            </div>

            <!-- Download progress -->
            <div class="dl-status" id="dl-status" style="display:none">
              <div class="spinner"></div>
              <span id="dl-status-text">Downloading &amp; extracting audio…</span>
            </div>
          </div>

          <div class="modal-footer">
            <button class="btn-ghost" id="btn-cancel-dl">Cancel</button>
            <button class="btn-lime" id="btn-download" disabled>
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5">
                <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/>
                <polyline points="7 10 12 15 17 10"/><line x1="12" y1="15" x2="12" y2="3"/>
              </svg>
              Download to Drive
            </button>
          </div>
        </div>
      </div>

      <!-- ═══ SETTINGS MODAL ═══ -->
      <div class="modal-overlay" id="modal-settings" role="dialog" aria-modal="true" aria-label="Cloud storage settings">
        <div class="modal-card">
          <div class="modal-handle"></div>
          <div class="modal-header">
            <div class="modal-title-row">
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                <path d="M17.5 19H9a7 7 0 1 1 6.71-9h1.79a4.5 4.5 0 1 1 0 9Z"/>
              </svg>
              <span class="modal-title-text">Cloud Storage</span>
            </div>
            <button class="btn-close" id="btn-close-settings" aria-label="Close">&#x2715;</button>
          </div>

          <div class="modal-body">
            <div id="supa-fields" style="display:flex;flex-direction:column;gap:12px;">
              <div class="form-group">
                <label class="form-label" for="supa-url">Supabase Project URL</label>
                <input type="text" id="supa-url" class="form-input" placeholder="https://your-project.supabase.co" />
              </div>
              <div class="form-group">
                <label class="form-label" for="supa-key">Supabase API Key (anon or service role)</label>
                <input type="password" id="supa-key" class="form-input" placeholder="eyJhbGci…" />
              </div>
              <div class="form-group">
                <label class="form-label" for="supa-bucket">Bucket Name</label>
                <input type="text" id="supa-bucket" class="form-input" value="music" placeholder="music" />
              </div>
            </div>

            <!-- YouTube Cookies section -->
            <div class="form-group" style="margin-top:14px;">
              <label class="form-label" for="yt-cookies">YouTube Cookies (Optional)</label>
              <textarea id="yt-cookies" class="form-input" rows="3" style="font-family:monospace;font-size:11px;resize:vertical;" placeholder="# Netscape HTTP Cookie File&#10;# Paste cookies if YouTube asks for bot verification on datacenter IPs"></textarea>
              <span style="font-size:11px;color:var(--text-muted);display:block;margin-top:4px;">Used automatically when downloading age-restricted or server-protected tracks.</span>
            </div>
          </div>

          <div class="modal-footer">
            <button class="btn-ghost" id="btn-cancel-settings">Close</button>
            <button class="btn-lime" id="btn-save-settings">Save</button>
          </div>
        </div>
      </div>

      <!-- ═══ TOAST ZONE ═══ -->
      <div class="toast-zone" id="toast-zone" aria-live="polite"></div>

      <!-- ═══ CREATE PLAYLIST MODAL ═══ -->
      <div class="modal-overlay" id="modal-new-playlist" role="dialog" aria-modal="true" aria-label="Create playlist">
        <div class="modal-card">
          <div class="modal-handle"></div>
          <div class="modal-header">
            <div class="modal-title-row">
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5">
                <path d="M3 6h18M3 12h12M3 18h8"/><circle cx="19" cy="18" r="3"/><path d="M19 15v3l2 1"/>
              </svg>
              <span class="modal-title-text">New Playlist</span>
            </div>
            <button class="btn-close" id="btn-close-new-playlist" aria-label="Close">&#x2715;</button>
          </div>
          <div class="modal-body">
            <div class="form-group">
              <label class="form-label" for="new-playlist-name">Playlist Name</label>
              <input type="text" id="new-playlist-name" class="form-input" placeholder="My awesome mix…" autocomplete="off" maxlength="80" />
            </div>
          </div>
          <div class="modal-footer">
            <button class="btn-ghost" id="btn-cancel-new-playlist">Cancel</button>
            <button class="btn-lime" id="btn-confirm-new-playlist">
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5">
                <line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/>
              </svg>
              Create
            </button>
          </div>
        </div>
      </div>

      <!-- ═══ ADD TO PLAYLIST MODAL ═══ -->
      <div class="modal-overlay" id="modal-add-to-playlist" role="dialog" aria-modal="true" aria-label="Add to playlist">
        <div class="modal-card">
          <div class="modal-handle"></div>
          <div class="modal-header">
            <div class="modal-title-row">
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                <path d="M3 6h18M3 12h12M3 18h8"/>
              </svg>
              <span class="modal-title-text">Add to Playlist</span>
            </div>
            <button class="btn-close" id="btn-close-add-playlist" aria-label="Close">&#x2715;</button>
          </div>
          <div class="modal-body" style="gap:8px;">
            <div id="add-to-playlist-list" style="display:flex;flex-direction:column;gap:6px;max-height:260px;overflow-y:auto;">
              <!-- injected by renderAddToPlaylistList() -->
            </div>
          </div>
          <div class="modal-footer">
            <button class="btn-ghost" id="btn-cancel-add-playlist">Cancel</button>
          </div>
        </div>
      </div>

      <!-- ═══ RENAME PLAYLIST MODAL ═══ -->
      <div class="modal-overlay" id="modal-rename-playlist" role="dialog" aria-modal="true" aria-label="Rename playlist">
        <div class="modal-card">
          <div class="modal-handle"></div>
          <div class="modal-header">
            <div class="modal-title-row">
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                <path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/>
                <path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"/>
              </svg>
              <span class="modal-title-text">Rename Playlist</span>
            </div>
            <button class="btn-close" id="btn-close-rename-playlist" aria-label="Close">&#x2715;</button>
          </div>
          <div class="modal-body">
            <div class="form-group">
              <label class="form-label" for="rename-playlist-input">New Name</label>
              <input type="text" id="rename-playlist-input" class="form-input" placeholder="Playlist name…" autocomplete="off" maxlength="80" />
            </div>
          </div>
          <div class="modal-footer">
            <button class="btn-ghost" id="btn-cancel-rename-playlist">Cancel</button>
            <button class="btn-lime" id="btn-confirm-rename-playlist">
              Save
            </button>
          </div>
        </div>
      </div>

      <!-- ═══ HAMBURGER DRAWER MENU ═══ -->
      <div class="drawer-overlay" id="drawer-menu" role="dialog" aria-modal="true" aria-label="Main menu">
        <div class="drawer-panel">
          <div class="drawer-header">
            <div class="drawer-brand">
              <img class="drawer-logo-img" src="/logo.png" alt="Poori" />
              <span class="drawer-title">Poori</span>
            </div>
            <button class="btn-close" id="btn-close-menu" aria-label="Close menu">&#x2715;</button>
          </div>

          <div class="drawer-content">
            <div class="drawer-section-label">Options</div>

            <button class="drawer-item" id="menu-item-timer">
              <div class="drawer-item-icon">
                <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                  <path d="M12 3a6 6 0 0 0 9 9 9 9 0 1 1-9-9Z"/>
                </svg>
              </div>
              <div class="drawer-item-text">
                <div class="drawer-item-title">Sleep Timer</div>
                <div class="drawer-item-subtitle" id="menu-timer-sub">Stop music automatically</div>
              </div>
              <span class="drawer-pill" id="menu-timer-pill" style="display:none;">Active</span>
            </button>

            <button class="drawer-item" id="menu-item-settings">
              <div class="drawer-item-icon">
                <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                  <circle cx="12" cy="12" r="3"/>
                  <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83-2.83l.06-.06A1.65 1.65 0 0 0 4.68 15a1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 2.83-2.83l.06.06A1.65 1.65 0 0 0 9 4.68a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 2.83l-.06.06A1.65 1.65 0 0 0 19.4 9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z"/>
                </svg>
              </div>
              <div class="drawer-item-text">
                <div class="drawer-item-title">Cloud Storage &amp; Settings</div>
                <div class="drawer-item-subtitle">Supabase, cookies, storage provider</div>
              </div>
            </button>
          </div>

          <div class="drawer-footer">
            <span>Poori</span>
          </div>
        </div>
      </div>

      <!-- ═══ SLEEP TIMER MODAL ═══ -->
      <div class="modal-overlay" id="modal-sleep-timer" role="dialog" aria-modal="true" aria-label="Sleep timer">
        <div class="modal-card">
          <div class="modal-handle"></div>
          <div class="modal-header">
            <div class="modal-title-row">
              <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                <path d="M12 3a6 6 0 0 0 9 9 9 9 0 1 1-9-9Z"/>
              </svg>
              <span class="modal-title-text">Sleep Timer</span>
            </div>
            <button class="btn-close" id="btn-close-sleep-timer" aria-label="Close">&#x2715;</button>
          </div>

          <div class="modal-body" style="gap:14px;">
            <!-- Active countdown card (minimalized) -->
            <div class="timer-active-card" id="timer-active-card" style="display:none;">
              <div class="tac-left">
                <svg class="tac-icon-svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5">
                  <path d="M12 3a6 6 0 0 0 9 9 9 9 0 1 1-9-9Z"/>
                </svg>
                <span class="tac-label" id="tac-status-label">Stopping in <strong id="timer-active-time">--:--</strong></span>
              </div>
              <div class="tac-actions">
                <button class="btn-preset-mini" id="timer-btn-add5" title="Add 5 minutes">+5m</button>
                <button class="btn-preset-mini" id="timer-btn-add15" title="Add 15 minutes">+15m</button>
                <button class="btn-cancel-timer" id="timer-btn-cancel">Turn Off</button>
              </div>
            </div>

            <!-- Presets grid -->
            <div class="form-group">
              <label class="form-label">Set Timer For</label>
              <div class="timer-presets-grid">
                <button class="btn-preset" data-minutes="5">5 min</button>
                <button class="btn-preset" data-minutes="10">10 min</button>
                <button class="btn-preset" data-minutes="15">15 min</button>
                <button class="btn-preset" data-minutes="30">30 min</button>
                <button class="btn-preset" data-minutes="45">45 min</button>
                <button class="btn-preset" data-minutes="60">1 hour</button>
              </div>
            </div>

            <!-- End of current track option -->
            <button class="btn-preset-wide" id="timer-preset-end-track">
              <div class="bpw-left">
                <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                  <path d="M9 18V5l12-2v13"/><circle cx="6" cy="18" r="3"/><circle cx="18" cy="16" r="3"/>
                </svg>
                <span>End of current track</span>
              </div>
              <span class="bpw-tag" id="timer-end-track-tag">Play until song ends</span>
            </button>

            <!-- Custom duration -->
            <div class="form-group">
              <label class="form-label" for="custom-timer-min">Custom Duration</label>
              <div class="custom-timer-row">
                <input type="number" id="custom-timer-min" class="form-input" min="1" max="720" placeholder="e.g. 25" />
                <span class="custom-timer-unit">minutes</span>
                <button class="btn-inspect" id="btn-set-custom-timer">Start</button>
              </div>
            </div>

            <!-- Fade out option -->
            <label class="toggle-option">
              <input type="checkbox" id="timer-fade-checkbox" checked />
              <span class="toggle-box"></span>
              <div class="toggle-text">
                <span class="toggle-title">Gentle fade out</span>
                <span class="toggle-desc">Gradually lowers volume over the final 15 seconds</span>
              </div>
            </label>
          </div>

          <div class="modal-footer">
            <button class="btn-ghost" id="btn-cancel-sleep-modal">Close</button>
          </div>
        </div>
      </div>
    `;
  }

  // ──────────────────────────────────────────
  // EVENT LISTENERS
  // ──────────────────────────────────────────

  private attachListeners() {
    // ── Filter pills ──
    this.$('pill-all').addEventListener('click', () => this.setFilter('all'));
    this.$('pill-liked').addEventListener('click', () => this.setFilter('liked'));

    // ── Search ──
    this.$('search-input').addEventListener('input', (e) => {
      this.searchQuery = (e.target as HTMLInputElement).value.toLowerCase();
      this.renderTrackList();
    });

    // ── Download modal ──
    const openDl = () => {
      this.$('modal-dl').classList.add('active');
      this.$<HTMLInputElement>('url-input').focus();
    };
    const closeDl = () => {
      this.$('modal-dl').classList.remove('active');
      this.resetDlModal();
    };

    this.$('btn-open-dl').addEventListener('click', openDl);
    this.$('btn-close-dl').addEventListener('click', closeDl);
    this.$('btn-cancel-dl').addEventListener('click', closeDl);

    // Close on backdrop click
    this.$('modal-dl').addEventListener('click', (e) => {
      if (e.target === this.$('modal-dl')) closeDl();
    });

    this.$('btn-inspect').addEventListener('click', () => this.handleInspect());
    this.$<HTMLInputElement>('url-input').addEventListener('keydown', (e) => {
      if (e.key === 'Enter') this.handleInspect();
    });
    this.$('btn-download').addEventListener('click', () => this.handleDownload());

    // ── Hamburger Menu Drawer ──
    this.$('btn-menu').addEventListener('click', () => this.openMenu());
    this.$('btn-close-menu').addEventListener('click', () => this.closeMenu());
    this.$('drawer-menu').addEventListener('click', (e) => {
      if (e.target === this.$('drawer-menu')) this.closeMenu();
    });
    this.$('menu-item-settings').addEventListener('click', () => {
      this.closeMenu();
      openSettings();
    });
    this.$('menu-item-timer').addEventListener('click', () => {
      this.closeMenu();
      this.openSleepTimerModal();
    });

    // ── Settings modal ──
    const openSettings = () => this.$('modal-settings').classList.add('active');
    const closeSettings = () => this.$('modal-settings').classList.remove('active');

    this.$('btn-close-settings').addEventListener('click', closeSettings);
    this.$('btn-cancel-settings').addEventListener('click', closeSettings);
    this.$('modal-settings').addEventListener('click', (e) => {
      if (e.target === this.$('modal-settings')) closeSettings();
    });

    this.$('btn-save-settings').addEventListener('click', () => this.handleSaveSettings());

    // ── Sleep Timer modal & controls ──
    this.$('np-sleep-btn').addEventListener('click', () => this.openSleepTimerModal());
    this.$('btn-close-sleep-timer').addEventListener('click', () => this.closeSleepTimerModal());
    this.$('btn-cancel-sleep-modal').addEventListener('click', () => this.closeSleepTimerModal());
    this.$('modal-sleep-timer').addEventListener('click', (e) => {
      if (e.target === this.$('modal-sleep-timer')) this.closeSleepTimerModal();
    });

    // Presets (5, 10, 15, 30, 45, 60 min)
    document.querySelectorAll<HTMLButtonElement>('.timer-presets-grid .btn-preset').forEach((btn) => {
      btn.addEventListener('click', () => {
        const mins = parseInt(btn.dataset.minutes || '0');
        if (mins > 0) this.setSleepTimer(mins);
      });
    });

    // End of track preset
    this.$('timer-preset-end-track').addEventListener('click', () => {
      this.setSleepTimerEndOfTrack();
    });

    // Custom duration
    this.$('btn-set-custom-timer').addEventListener('click', () => {
      const input = this.$<HTMLInputElement>('custom-timer-min');
      const val = parseInt(input.value);
      if (!val || val <= 0) {
        this.toast('Please enter a valid number of minutes', 'error');
        return;
      }
      this.setSleepTimer(val);
      input.value = '';
    });
    this.$<HTMLInputElement>('custom-timer-min').addEventListener('keydown', (e) => {
      if (e.key === 'Enter') (this.$('btn-set-custom-timer') as HTMLButtonElement).click();
    });

    // Active card buttons
    this.$('timer-btn-add5').addEventListener('click', () => this.extendSleepTimer(5));
    this.$('timer-btn-add15').addEventListener('click', () => this.extendSleepTimer(15));
    this.$('timer-btn-cancel').addEventListener('click', () => this.cancelSleepTimer());

    // Fade out checkbox
    const fadeBox = this.$<HTMLInputElement>('timer-fade-checkbox');
    fadeBox.addEventListener('change', () => {
      this.sleepTimerFadeOut = fadeBox.checked;
    });

    // ── Now playing mobile navigation ──
    this.$('np-back').addEventListener('click', () => this.closeNowPlaying());
    this.$('mini-player').addEventListener('click', (e) => {
      if (!(e.target as HTMLElement).closest('.mini-btn, .mini-play-btn')) {
        this.openNowPlaying();
      }
    });

    // ── Player controls ──
    this.$('ctrl-play').addEventListener('click', () => this.togglePlay());
    this.$('ctrl-prev').addEventListener('click', () => this.prevTrack());
    this.$('ctrl-next').addEventListener('click', () => this.nextTrack());
    this.$('mini-play').addEventListener('click', (e) => { e.stopPropagation(); this.togglePlay(); });
    this.$('mini-prev').addEventListener('click', (e) => { e.stopPropagation(); this.prevTrack(); });
    this.$('mini-next').addEventListener('click', (e) => { e.stopPropagation(); this.nextTrack(); });

    this.$('ctrl-shuffle').addEventListener('click', () => {
      this.isShuffle = !this.isShuffle;
      this.$('ctrl-shuffle').classList.toggle('active', this.isShuffle);
      this.toast(this.isShuffle ? 'Shuffle on' : 'Shuffle off');
    });

    this.$('ctrl-repeat').addEventListener('click', () => {
      const modes: Array<'off' | 'all' | 'one'> = ['off', 'all', 'one'];
      const idx = (modes.indexOf(this.repeatMode) + 1) % modes.length;
      this.repeatMode = modes[idx];
      this.$('ctrl-repeat').classList.toggle('active', this.repeatMode !== 'off');
      const labels: Record<string, string> = { off: 'Repeat off', all: 'Repeat all', one: 'Repeat one' };
      this.toast(labels[this.repeatMode]);
      this.updateRepeatIcon();
    });

    // ── Seek bar ──
    this.$('seek-bar').addEventListener('click', (e) => {
      const rect = this.$('seek-bar').getBoundingClientRect();
      const pct = (e.clientX - rect.left) / rect.width;
      if (this.audio.duration) {
        this.audio.currentTime = pct * this.audio.duration;
        this.syncNativePosition();
      }
    });

    // ── Volume ──
    const volSlider = this.$<HTMLInputElement>('vol-slider');
    volSlider.addEventListener('input', () => {
      this.volume = parseFloat(volSlider.value);
      if (!this.isFadingVolume) {
        this.sleepTimerOriginalVolume = this.volume;
      }
      this.audio.volume = this.volume;
      this.isMuted = this.volume === 0;
      this.updateVolIcon();
    });
    this.$('btn-mute').addEventListener('click', () => {
      this.isMuted = !this.isMuted;
      this.audio.muted = this.isMuted;
      this.updateVolIcon();
    });

    // ── NP fav button ──
    this.$('np-fav').addEventListener('click', () => {
      if (this.currentTrack) this.toggleFav(this.currentTrack.id);
    });

    // ── Create Playlist modal ──
    const closeNewPl = () => this.$('modal-new-playlist').classList.remove('active');

    this.$('btn-close-new-playlist').addEventListener('click', closeNewPl);
    this.$('btn-cancel-new-playlist').addEventListener('click', closeNewPl);
    this.$('modal-new-playlist').addEventListener('click', (e) => {
      if (e.target === this.$('modal-new-playlist')) closeNewPl();
    });
    this.$<HTMLInputElement>('new-playlist-name').addEventListener('keydown', (e) => {
      if (e.key === 'Enter') this.handleCreatePlaylist();
    });
    this.$('btn-confirm-new-playlist').addEventListener('click', () => this.handleCreatePlaylist());

    // ── Add to Playlist modal ──
    const closeAddPl = () => this.$('modal-add-to-playlist').classList.remove('active');
    this.$('btn-close-add-playlist').addEventListener('click', closeAddPl);
    this.$('btn-cancel-add-playlist').addEventListener('click', closeAddPl);
    this.$('modal-add-to-playlist').addEventListener('click', (e) => {
      if (e.target === this.$('modal-add-to-playlist')) closeAddPl();
    });

    // ── Rename Playlist modal ──
    const closeRenamePl = () => this.$('modal-rename-playlist').classList.remove('active');
    this.$('btn-close-rename-playlist').addEventListener('click', closeRenamePl);
    this.$('btn-cancel-rename-playlist').addEventListener('click', closeRenamePl);
    this.$('modal-rename-playlist').addEventListener('click', (e) => {
      if (e.target === this.$('modal-rename-playlist')) closeRenamePl();
    });
    this.$<HTMLInputElement>('rename-playlist-input').addEventListener('keydown', (e) => {
      if (e.key === 'Enter') (this.$('btn-confirm-rename-playlist') as HTMLButtonElement).click();
    });
  }

  // ──────────────────────────────────────────
  // AUDIO EVENTS
  // ──────────────────────────────────────────

  private initAudioEvents() {
    this.audio.addEventListener('timeupdate', () => {
      this.checkSleepTimer();

      const cur = this.audio.currentTime;
      const tot = this.audio.duration || 0;
      this.$('current-time').textContent = this.fmt(cur);
      this.$('total-time').textContent = this.fmt(tot);
      const pct = tot > 0 ? (cur / tot) * 100 : 0;
      this.$('seek-fill').style.width = `${Math.min(pct, 100)}%`;

      // Mobile & streaming safeguard: if within 0.35s of track completion and stream finishes without firing 'ended'
      if (tot > 0 && cur >= tot - 0.35 && !this.isAutoAdvancing) {
        this.handleTrackEnded();
      }
    });

    document.addEventListener('visibilitychange', () => {
      if (!document.hidden) {
        this.checkSleepTimer();
      }
    });

    this.audio.addEventListener('durationchange', () => {
      this.syncNativeMusicNotification();
    });

    this.audio.addEventListener('seeked', () => {
      this.syncNativePosition();
    });

    this.audio.addEventListener('ended', () => {
      this.handleTrackEnded();
    });

    this.audio.addEventListener('play', () => {
      this.isPlaying = true;
      this.isAutoAdvancing = false;
      this.updatePlayUI();
      this.$('artwork-img').classList.add('spinning');
      if ('mediaSession' in navigator) {
        navigator.mediaSession.playbackState = 'playing';
      }
      this.syncNativeMusicNotification();
    });

    this.audio.addEventListener('pause', () => {
      this.isPlaying = false;
      this.updatePlayUI();
      this.$('artwork-img').classList.remove('spinning');
      if ('mediaSession' in navigator) {
        navigator.mediaSession.playbackState = 'paused';
      }
      this.syncNativeMusicNotification();
    });

    this.audio.addEventListener('error', (e) => {
      console.warn('Audio playback error:', e);
      this.isPlaying = false;
      this.updatePlayUI();

      // On mobile or stream error, automatically skip to next track so playlist does not freeze
      if (!this.isAutoAdvancing && this.tracks.length > 1) {
        this.toast('Error playing track, skipping to next…', 'error');
        this.isAutoAdvancing = true;
        setTimeout(() => {
          this.nextTrack(true);
        }, 1200);
      }
    });
  }

  private handleTrackEnded() {
    if (this.isAutoAdvancing) return;
    this.isAutoAdvancing = true;

    if (this.sleepTimerType === 'end-of-track') {
      this.cancelSleepTimer(false);
      this.pauseAudio();
      this.toast('Sleep timer ended at end of track 🌙');
      this.isAutoAdvancing = false;
      return;
    }

    if (this.repeatMode === 'one') {
      this.audio.currentTime = 0;
      const p = this.audio.play();
      if (p !== undefined) p.catch(() => { });
      this.isAutoAdvancing = false;
    } else {
      this.nextTrack(true);
    }
  }

  // ──────────────────────────────────────────
  // KEYBOARD SHORTCUTS
  // ──────────────────────────────────────────

  private initKeyboard() {
    window.addEventListener('keydown', (e) => {
      const tag = (e.target as HTMLElement).tagName;
      if (tag === 'INPUT' || tag === 'SELECT' || tag === 'TEXTAREA') return;

      switch (e.code) {
        case 'Space':
          e.preventDefault();
          this.togglePlay();
          break;
        case 'ArrowRight':
          e.preventDefault();
          this.audio.currentTime = Math.min(
            this.audio.currentTime + 5,
            this.audio.duration || 0
          );
          break;
        case 'ArrowLeft':
          e.preventDefault();
          this.audio.currentTime = Math.max(this.audio.currentTime - 5, 0);
          break;
        case 'ArrowUp':
          e.preventDefault();
          this.volume = Math.min(this.volume + 0.05, 1);
          if (!this.isFadingVolume) this.sleepTimerOriginalVolume = this.volume;
          this.audio.volume = this.volume;
          this.$<HTMLInputElement>('vol-slider').value = this.volume.toString();
          this.isMuted = false;
          this.updateVolIcon();
          break;
        case 'ArrowDown':
          e.preventDefault();
          this.volume = Math.max(this.volume - 0.05, 0);
          if (!this.isFadingVolume) this.sleepTimerOriginalVolume = this.volume;
          this.audio.volume = this.volume;
          this.$<HTMLInputElement>('vol-slider').value = this.volume.toString();
          this.isMuted = this.volume === 0;
          this.updateVolIcon();
          break;
        case 'KeyM':
          e.preventDefault();
          this.isMuted = !this.isMuted;
          this.audio.muted = this.isMuted;
          this.updateVolIcon();
          break;
        case 'KeyN':
          e.preventDefault();
          this.nextTrack();
          break;
        case 'KeyP':
          e.preventDefault();
          this.prevTrack();
          break;
      }
    });
  }

  // ──────────────────────────────────────────
  // VIEW NAVIGATION (mobile)
  // ──────────────────────────────────────────

  private openNowPlaying() {
    this.$('now-playing-panel').classList.add('open');
    document.body.style.overflow = 'hidden';
  }

  private closeNowPlaying() {
    this.$('now-playing-panel').classList.remove('open');
    document.body.style.overflow = '';
  }

  // ──────────────────────────────────────────
  // FILTER
  // ──────────────────────────────────────────

  private setFilter(f: 'all' | 'liked' | 'playlist', plId?: string) {
    this.activeFilter = f;
    this.activePlaylistId = plId ?? null;
    this.$('pill-all').classList.toggle('active', f === 'all');
    this.$('pill-liked').classList.toggle('active', f === 'liked');
    // Playlist pills toggled by renderFilterPills
    this.renderFilterPills();
    this.renderTrackList();
  }

  private getActivePlaylists(): Playlist | null {
    if (this.activeFilter !== 'playlist' || !this.activePlaylistId) return null;
    return this.playlists.find(p => p.id === this.activePlaylistId) ?? null;
  }

  private getFiltered(): Track[] {
    return this.tracks.filter((t) => {
      const q = this.searchQuery;
      const matchSearch =
        !q ||
        t.title.toLowerCase().includes(q) ||
        t.artist.toLowerCase().includes(q);
      if (!matchSearch) return false;
      if (this.activeFilter === 'liked') return this.favorites.has(t.id);
      if (this.activeFilter === 'playlist') {
        const pl = this.getActivePlaylists();
        return pl ? pl.track_ids.includes(t.id) : false;
      }
      return true;
    });
  }

  // ──────────────────────────────────────────
  // PLAYBACK
  // ──────────────────────────────────────────

  private updateMediaSession() {
    this.syncNativeMusicNotification();
    if (!('mediaSession' in navigator) || !this.currentTrack) return;
    const t = this.currentTrack;
    try {
      navigator.mediaSession.metadata = new MediaMetadata({
        title: t.title,
        artist: t.artist,
        album: 'poori',
        artwork: t.thumbnail ? [{ src: this.resolveMediaUrl(t.thumbnail), sizes: '512x512', type: 'image/jpeg' }] : [{ src: '/logo.png', sizes: '512x512', type: 'image/png' }],
      });

      navigator.mediaSession.setActionHandler('play', () => this.resumeAudio());
      navigator.mediaSession.setActionHandler('pause', () => this.pauseAudio());
      navigator.mediaSession.setActionHandler('previoustrack', () => this.prevTrack());
      navigator.mediaSession.setActionHandler('nexttrack', () => this.nextTrack());
      navigator.mediaSession.setActionHandler('seekto', (details) => {
        if (details.seekTime !== undefined && details.seekTime !== null && this.audio.duration) {
          this.audio.currentTime = details.seekTime;
        }
      });
    } catch (_) { }
  }

  private initNativeMusicControls() {
    if (!Capacitor.isNativePlatform()) return;

    try {
      MusicNotification.checkPermissions().then((status) => {
        if (status.notifications !== 'granted') {
          MusicNotification.requestPermissions({ permissions: ['notifications'] }).catch(() => { });
        }
      }).catch(() => { });
    } catch (_) { }

    try {
      MusicNotification.addListener('musicControlsAction', (data) => {
        if (!data || !data.action) return;
        switch (data.action) {
          case 'play':
            this.resumeAudio();
            break;
          case 'pause':
            this.pauseAudio();
            break;
          case 'next':
            this.nextTrack();
            break;
          case 'previous':
            this.prevTrack();
            break;
          case 'seek':
            if (typeof data.time === 'number' && !isNaN(data.time)) {
              this.audio.currentTime = data.time;
            }
            break;
        }
      });
    } catch (_) { }
  }

  private syncNativeMusicNotification() {
    if (!Capacitor.isNativePlatform() || !this.currentTrack) return;
    try {
      const thumb = this.currentTrack.thumbnail
        ? this.resolveMediaUrl(this.currentTrack.thumbnail)
        : '';

      const dur = this.audio.duration && !isNaN(this.audio.duration) && this.audio.duration > 0
        ? this.audio.duration
        : (this.currentTrack.duration || 0);

      const pos = this.audio.currentTime && !isNaN(this.audio.currentTime)
        ? this.audio.currentTime
        : 0;

      MusicNotification.update({
        title: this.currentTrack.title || 'Unknown Track',
        artist: this.currentTrack.artist || 'poori',
        isPlaying: this.isPlaying,
        thumbnailUrl: thumb,
        duration: dur,
        position: pos,
      }).catch((e) => console.warn('MusicNotification update failed:', e));
    } catch (_) { }
  }

  private syncNativePosition() {
    if (!Capacitor.isNativePlatform() || !this.currentTrack) return;
    try {
      const pos = this.audio.currentTime && !isNaN(this.audio.currentTime)
        ? this.audio.currentTime
        : 0;

      MusicNotification.setPosition({
        position: pos,
        isPlaying: this.isPlaying,
      }).catch(() => { });
    } catch (_) { }
  }

  private playTrack(index: number) {
    const list = this.getFiltered();
    if (index < 0 || index >= list.length) {
      this.isAutoAdvancing = false;
      return;
    }

    this.isAutoAdvancing = false;
    this.currentTrack = list[index];
    const url = this.resolveAudioUrl(this.currentTrack.audio_url);

    // CRITICAL FIX FOR MOBILE:
    // DO NOT call this.audio.load()! On iOS and Android, calling load()
    // removes the mobile user-activation token and breaks auto-play of the next track.
    // Assigning .src directly preserves playback authorization on the existing Audio element.
    this.audio.src = url;

    const playPromise = this.audio.play();
    if (playPromise !== undefined) {
      playPromise.catch((err) => {
        console.warn('Auto-play initial attempt deferred:', err);
        // If audio is buffering on mobile, trigger play as soon as canplay fires
        const onCanPlay = () => {
          this.audio.removeEventListener('canplay', onCanPlay);
          this.audio.play().catch((e) => console.warn('Retry play error:', e));
        };
        this.audio.addEventListener('canplay', onCanPlay, { once: true });
      });
    }

    this.updateMediaSession();
    this.updateNowPlayingUI();
    this.updateMiniPlayer();
    this.renderTrackList();
  }

  private resumeAudio() {
    if (!this.currentTrack) {
      if (this.tracks.length > 0) this.playTrack(0);
      return;
    }
    const playPromise = this.audio.play();
    if (playPromise !== undefined) {
      playPromise.catch((err) => {
        console.warn('Audio play failed, attempting recovery:', err);
        if (this.currentTrack) {
          const curTime = this.audio.currentTime || 0;
          const url = this.resolveAudioUrl(this.currentTrack.audio_url);
          this.audio.src = url;
          this.audio.currentTime = curTime;
          this.audio.play().catch((e) => console.warn('Recovery play failed:', e));
        }
      });
    }
  }

  private pauseAudio() {
    this.audio.pause();
  }

  private togglePlay() {
    if (!this.currentTrack) {
      if (this.tracks.length > 0) this.playTrack(0);
      return;
    }
    if (this.audio.paused) {
      this.resumeAudio();
    } else {
      this.pauseAudio();
    }
  }

  private nextTrack(isAuto = false) {
    const list = this.getFiltered();
    if (list.length === 0) {
      this.isAutoAdvancing = false;
      return;
    }

    const cur = list.findIndex((t) => t.id === this.currentTrack?.id);

    // If auto-advancing at end of playlist and repeat is off, stop
    if (isAuto && this.repeatMode === 'off' && cur === list.length - 1) {
      this.isAutoAdvancing = false;
      this.isPlaying = false;
      this.audio.pause();
      this.audio.currentTime = 0;
      this.updatePlayUI();
      return;
    }

    if (this.isShuffle) {
      const remaining = list.length > 1 ? list.filter((_, idx) => idx !== cur) : list;
      const nextIndex = list.indexOf(remaining[Math.floor(Math.random() * remaining.length)]);
      this.playTrack(nextIndex >= 0 ? nextIndex : 0);
      return;
    }

    this.playTrack((cur + 1) % list.length);
  }

  private prevTrack() {
    const list = this.getFiltered();
    if (list.length === 0) return;
    const cur = list.findIndex((t) => t.id === this.currentTrack?.id);
    this.playTrack((cur - 1 + list.length) % list.length);
  }

  // ──────────────────────────────────────────
  // FAVORITES
  // ──────────────────────────────────────────

  private toggleFav(id: string) {
    if (this.favorites.has(id)) {
      this.favorites.delete(id);
      this.toast('Removed from liked songs');
    } else {
      this.favorites.add(id);
      this.toast('Added to liked songs ♥');
    }
    localStorage.setItem(
      'soundvault_favs',
      JSON.stringify(Array.from(this.favorites))
    );
    this.updateNpFavBtn();
    this.renderTrackList();
  }

  // ──────────────────────────────────────────
  // UI UPDATES
  // ──────────────────────────────────────────

  private updateNowPlayingUI() {
    if (!this.currentTrack) return;
    const t = this.currentTrack;

    // Show active content, hide idle
    this.$('np-idle').style.display = 'none';
    this.$('np-active').classList.add('visible');

    // Artwork
    const img = this.$<HTMLImageElement>('artwork-img');
    img.src = t.thumbnail;

    // Glow — use a dominant color approximation (just set background to accent-ish)
    this.$('artwork-glow').style.background =
      `radial-gradient(circle, rgba(200,255,0,0.6) 0%, transparent 70%)`;

    // Track info
    this.$('np-title').textContent = t.title;
    this.$('np-artist').textContent = t.artist;

    // Reset seek
    this.$('seek-fill').style.width = '0%';
    this.$('current-time').textContent = '0:00';
    this.$('total-time').textContent = this.fmt(t.duration);

    this.updateNpFavBtn();
  }

  private updateNpFavBtn() {
    const isFav = !!this.currentTrack && this.favorites.has(this.currentTrack.id);
    const btn = this.$('np-fav');
    const icon = this.$('np-fav-icon');
    btn.classList.toggle('active', isFav);
    icon.setAttribute('fill', isFav ? 'currentColor' : 'none');
    icon.setAttribute('stroke', 'currentColor');
  }

  private updateMiniPlayer() {
    if (!this.currentTrack) {
      this.$('mini-player').classList.add('hidden');
      return;
    }
    this.$('mini-player').classList.remove('hidden');
    this.$<HTMLImageElement>('mini-art').src = this.currentTrack.thumbnail;
    this.$('mini-title').textContent = this.currentTrack.title;
    this.$('mini-artist').textContent = this.currentTrack.artist;
  }

  private updatePlayUI() {
    const icon = this.$('play-icon');
    const miniIcon = this.$('mini-play-icon');
    if (this.isPlaying) {
      icon.innerHTML = `<rect x="6" y="4" width="4" height="16"/><rect x="14" y="4" width="4" height="16"/>`;
      miniIcon.innerHTML = `<rect x="6" y="4" width="4" height="16"/><rect x="14" y="4" width="4" height="16"/>`;
    } else {
      icon.innerHTML = `<polygon points="5 3 19 12 5 21 5 3"/>`;
      miniIcon.innerHTML = `<polygon points="5 3 19 12 5 21 5 3"/>`;
    }
  }

  private updateVolIcon() {
    const icon = this.$('vol-icon');
    if (this.isMuted || this.volume === 0) {
      icon.innerHTML = `<line x1="1" y1="1" x2="23" y2="23"/><polygon points="11 5 6 9 2 9 2 15 6 15 11 19 11 5"/>`;
    } else if (this.volume < 0.5) {
      icon.innerHTML = `<polygon points="11 5 6 9 2 9 2 15 6 15 11 19 11 5"/><path d="M15.54 8.46a5 5 0 0 1 0 7.07"/>`;
    } else {
      icon.innerHTML = `<polygon points="11 5 6 9 2 9 2 15 6 15 11 19 11 5"/><path d="M15.54 8.46a5 5 0 0 1 0 7.07"/><path d="M19.07 4.93a10 10 0 0 1 0 14.14"/>`;
    }
  }

  private updateRepeatIcon() {
    const icon = this.$('repeat-icon');
    if (this.repeatMode === 'one') {
      icon.innerHTML = `
        <polyline points="17 1 21 5 17 9"/>
        <path d="M3 11V9a4 4 0 0 1 4-4h14"/>
        <polyline points="7 23 3 19 7 15"/>
        <path d="M21 13v2a4 4 0 0 1-4 4H3"/>
        <line x1="12" y1="8" x2="12" y2="16"/>
      `;
    } else {
      icon.innerHTML = `
        <polyline points="17 1 21 5 17 9"/>
        <path d="M3 11V9a4 4 0 0 1 4-4h14"/>
        <polyline points="7 23 3 19 7 15"/>
        <path d="M21 13v2a4 4 0 0 1-4 4H3"/>
      `;
    }
  }

  // ──────────────────────────────────────────
  // FILTER PILL RENDER
  // ──────────────────────────────────────────

  private renderFilterPills() {
    const row = this.$('filter-row');
    // Build pills HTML
    const likedCount = this.tracks.filter(t => this.favorites.has(t.id)).length;
    const plPills = this.playlists.map(pl => `
      <button class="pill${this.activeFilter === 'playlist' && this.activePlaylistId === pl.id ? ' active' : ''}"
              data-pl-id="${pl.id}" id="pill-pl-${pl.id}">
        <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5">
          <path d="M3 6h18M3 12h12M3 18h8"/>
        </svg>
        ${pl.name}
        <span class="pill-count">${pl.track_ids.length}</span>
      </button>
    `).join('');

    row.innerHTML = `
      <button class="pill${this.activeFilter === 'all' ? ' active' : ''}" id="pill-all">All</button>
      <button class="pill${this.activeFilter === 'liked' ? ' active' : ''}" id="pill-liked">
        Liked Songs
        ${likedCount > 0 ? `<span class="pill-count">${likedCount}</span>` : ''}
      </button>
      ${plPills}
      <button class="pill btn-new-pl" id="pill-btn-new-pl" title="Create new playlist">
        <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5">
          <line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/>
        </svg>
        New Playlist
      </button>
    `;

    // Re-attach pill events
    this.$('pill-all').addEventListener('click', () => this.setFilter('all'));
    this.$('pill-liked').addEventListener('click', () => this.setFilter('liked'));
    this.$('pill-btn-new-pl').addEventListener('click', () => {
      this.$<HTMLInputElement>('new-playlist-name').value = '';
      this.$('modal-new-playlist').classList.add('active');
      setTimeout(() => this.$<HTMLInputElement>('new-playlist-name').focus(), 80);
    });
    this.playlists.forEach(pl => {
      const btn = document.getElementById(`pill-pl-${pl.id}`);
      if (btn) btn.addEventListener('click', () => this.setFilter('playlist', pl.id));
    });
  }

  // ──────────────────────────────────────────
  // TRACK LIST RENDER
  // ──────────────────────────────────────────

  private renderTrackList() {
    const container = this.$('track-list');
    const list = this.getFiltered();
    const count = list.length;
    const isPlaylistView = this.activeFilter === 'playlist';
    const activePl = this.getActivePlaylists();

    // Build playlist header card if in playlist view
    let headerHtml = '';
    if (isPlaylistView && activePl) {
      headerHtml = `
        <div class="playlist-header-card" id="pl-header-card">
          <div class="playlist-header-top">
            <div class="playlist-icon-badge">
              <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                <path d="M3 6h18M3 12h12M3 18h8"/>
              </svg>
            </div>
            <div class="playlist-header-details">
              <div class="playlist-badge-tag">Playlist</div>
              <div class="playlist-header-name">${activePl.name}</div>
              <div class="playlist-header-meta">${activePl.track_ids.length} song${activePl.track_ids.length !== 1 ? 's' : ''}</div>
            </div>
          </div>
          <div class="playlist-header-actions">
            <button class="btn-pl-play" id="pl-hdr-play" ${count === 0 ? 'disabled' : ''}>
              <svg width="13" height="13" viewBox="0 0 24 24" fill="currentColor"><polygon points="5 3 19 12 5 21 5 3"/></svg>
              Play All
            </button>
            <button class="btn-pl-action" id="pl-hdr-rename">
              <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                <path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/>
                <path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"/>
              </svg>
              Rename
            </button>
            <button class="btn-pl-action del icon-only" id="pl-hdr-delete" title="Delete playlist">
              <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                <polyline points="3 6 5 6 21 6"/><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/>
              </svg>
            </button>
          </div>
        </div>
      `;
    }

    if (count === 0) {
      const emptyMsg = isPlaylistView
        ? { icon: '🎵', title: 'Playlist is empty', sub: 'Add songs from the All tab using the + button on each track' }
        : this.activeFilter === 'liked'
          ? { icon: '♥', title: 'No liked songs yet', sub: 'Heart a track to see it here' }
          : { icon: '🎧', title: 'No songs found', sub: 'Tap + to download music from a YouTube or direct audio URL' };

      container.innerHTML = headerHtml + `
        <div class="empty-state">
          <span class="empty-icon">${emptyMsg.icon}</span>
          <h3>${emptyMsg.title}</h3>
          <p>${emptyMsg.sub}</p>
        </div>
      `;
      this.attachPlaylistHeaderEvents(activePl);
      return;
    }

    container.innerHTML = headerHtml + list
      .map((track, idx) => {
        const isCurrent = this.currentTrack?.id === track.id;
        const isFav = this.favorites.has(track.id);

        return `
          <div class="track-item${isCurrent ? ' active' : ''}"
               data-index="${idx}" role="button" tabindex="0" aria-label="Play ${track.title}">
            <img class="track-artwork"
                 src="${track.thumbnail}"
                 alt="${track.title}"
                 loading="lazy"
                 onerror="this.style.visibility='hidden'" />
            <div class="track-meta">
              <span class="track-name" title="${track.title}">${track.title}</span>
              <span class="track-sub">${track.artist} · ${this.fmt(track.duration)}</span>
            </div>
            <div class="track-right">
              <button class="track-icon-btn fav-btn${isFav ? ' fav-active' : ''}"
                      data-id="${track.id}"
                      title="${isFav ? 'Unlike' : 'Like'}"
                      aria-label="${isFav ? 'Unlike' : 'Like'}">
                <svg width="14" height="14" viewBox="0 0 24 24"
                     fill="${isFav ? 'currentColor' : 'none'}"
                     stroke="currentColor" stroke-width="2">
                  <path d="M19 14c1.49-1.46 3-3.21 3-5.5A5.5 5.5 0 0 0 16.5 3c-1.76 0-3 .5-4.5 2-1.5-1.5-2.74-2-4.5-2A5.5 5.5 0 0 0 2 8.5c0 2.3 1.5 4.05 3 5.5l7 7Z"/>
                </svg>
              </button>
              ${isPlaylistView ? `
                <button class="track-icon-btn remove-from-pl-btn"
                        data-id="${track.id}"
                        title="Remove from playlist"
                        aria-label="Remove from playlist">
                  <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                    <line x1="5" y1="12" x2="19" y2="12"/>
                  </svg>
                </button>
              ` : `
                <button class="track-icon-btn add-to-pl-btn"
                        data-id="${track.id}"
                        title="Add to playlist"
                        aria-label="Add to playlist">
                  <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                    <path d="M3 6h18M3 12h12M3 18h8"/><line x1="19" y1="15" x2="19" y2="21"/><line x1="16" y1="18" x2="22" y2="18"/>
                  </svg>
                </button>
                <button class="track-icon-btn del del-btn"
                        data-id="${track.id}"
                        title="Delete"
                        aria-label="Delete">
                  <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                    <polyline points="3 6 5 6 21 6"/>
                    <path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/>
                  </svg>
                </button>
              `}
              <button class="track-play-btn play-track-btn"
                      data-index="${idx}"
                      title="${isCurrent && this.isPlaying ? 'Pause' : 'Play'}"
                      aria-label="${isCurrent && this.isPlaying ? 'Pause' : 'Play'}">
                <svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor">
                  ${isCurrent && this.isPlaying
            ? `<rect x="6" y="4" width="4" height="16"/><rect x="14" y="4" width="4" height="16"/>`
            : `<polygon points="5 3 19 12 5 21 5 3"/>`
          }
                </svg>
              </button>
            </div>
          </div>
        `;
      })
      .join('');

    // Playlist header button events
    this.attachPlaylistHeaderEvents(activePl);

    // Row click → play + open Now Playing on mobile
    container.querySelectorAll('.track-item').forEach((row) => {
      row.addEventListener('click', (e) => {
        if ((e.target as HTMLElement).closest('.track-icon-btn, .track-play-btn')) return;
        const idx = parseInt((row as HTMLElement).dataset.index || '0', 10);
        this.playTrack(idx);
        // On mobile, also open now-playing view
        if (window.innerWidth < 768) this.openNowPlaying();
      });

      // Keyboard nav
      row.addEventListener('keydown', (e) => {
        if ((e as KeyboardEvent).key === 'Enter') (row as HTMLElement).click();
      });
    });

    // Play buttons
    container.querySelectorAll('.play-track-btn').forEach((btn) => {
      btn.addEventListener('click', (e) => {
        e.stopPropagation();
        const idx = parseInt((btn as HTMLElement).dataset.index || '0', 10);
        if (this.currentTrack?.id === list[idx].id) {
          this.togglePlay();
        } else {
          this.playTrack(idx);
          if (window.innerWidth < 768) this.openNowPlaying();
        }
      });
    });

    // Fav buttons
    container.querySelectorAll('.fav-btn').forEach((btn) => {
      btn.addEventListener('click', (e) => {
        e.stopPropagation();
        this.toggleFav((btn as HTMLElement).dataset.id!);
      });
    });

    // Delete buttons (only in 'all' view)
    container.querySelectorAll('.del-btn').forEach((btn) => {
      btn.addEventListener('click', async (e) => {
        e.stopPropagation();
        const id = (btn as HTMLElement).dataset.id!;
        if (confirm('Remove this track from your drive?')) {
          await this.deleteTrack(id);
        }
      });
    });

    // Add to playlist buttons (only outside playlist view)
    container.querySelectorAll('.add-to-pl-btn').forEach((btn) => {
      btn.addEventListener('click', (e) => {
        e.stopPropagation();
        const trackId = (btn as HTMLElement).dataset.id!;
        this.openAddToPlaylistModal(trackId);
      });
    });

    // Remove from playlist buttons (only in playlist view)
    container.querySelectorAll('.remove-from-pl-btn').forEach((btn) => {
      btn.addEventListener('click', async (e) => {
        e.stopPropagation();
        const trackId = (btn as HTMLElement).dataset.id!;
        if (activePl) await this.removeTrackFromPlaylist(activePl.id, trackId);
      });
    });
  }

  private attachPlaylistHeaderEvents(activePl: Playlist | null) {
    if (!activePl) return;
    const playBtn = document.getElementById('pl-hdr-play');
    const renameBtn = document.getElementById('pl-hdr-rename');
    const deleteBtn = document.getElementById('pl-hdr-delete');

    if (playBtn) {
      playBtn.addEventListener('click', () => {
        if (this.getFiltered().length > 0) this.playTrack(0);
        if (window.innerWidth < 768) this.openNowPlaying();
      });
    }
    if (renameBtn) {
      renameBtn.addEventListener('click', () => this.openRenamePlaylistModal(activePl));
    }
    if (deleteBtn) {
      deleteBtn.addEventListener('click', () => this.handleDeletePlaylist(activePl.id));
    }
  }

  private async deleteTrack(id: string) {
    try {
      const res = await fetch(`${API_BASE}/api/tracks/${id}`, { method: 'DELETE' });
      if (res.ok) {
        this.tracks = this.tracks.filter((t) => t.id !== id);
        this.favorites.delete(id);
        if (this.currentTrack?.id === id) {
          this.audio.pause();
          this.currentTrack = null;
          this.$('np-idle').style.display = '';
          this.$('np-active').classList.remove('visible');
          this.updateMiniPlayer();
          if (Capacitor.isNativePlatform()) {
            MusicNotification.clear().catch(() => { });
          }
        }
        this.toast('Track removed');
        this.renderTrackList();
      } else {
        this.toast('Failed to delete track', 'error');
      }
    } catch {
      this.toast('Could not reach backend', 'error');
    }
  }

  // ──────────────────────────────────────────
  // DOWNLOADER
  // ──────────────────────────────────────────

  private resetDlModal() {
    this.$<HTMLInputElement>('url-input').value = '';
    this.$<HTMLInputElement>('custom-title').value = '';
    this.$<HTMLInputElement>('custom-artist').value = '';
    this.$('preview-box').style.display = 'none';
    this.$('edit-fields').style.display = 'none';
    this.$('dl-status').style.display = 'none';
    (this.$<HTMLButtonElement>('btn-download')).disabled = true;
  }

  private async handleInspect() {
    const url = this.$<HTMLInputElement>('url-input').value.trim();
    if (!url) {
      this.toast('Paste a URL first', 'error');
      return;
    }

    const btn = this.$('btn-inspect');
    btn.innerHTML = `<div class="spinner"></div>`;

    try {
      const res = await fetch(`${API_BASE}/api/preview`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ url }),
      });

      if (!res.ok) {
        const err = await res.json();
        throw new Error(err.detail || 'Could not parse URL');
      }

      const info = await res.json();

      // Show preview
      this.$('preview-box').style.display = 'flex';
      this.$<HTMLImageElement>('preview-thumb').src = info.thumbnail;
      this.$('pv-title').textContent = info.title;
      this.$('pv-artist').textContent = info.artist;
      this.$('pv-duration').textContent = this.fmt(info.duration);

      // Show edit fields
      this.$('edit-fields').style.display = 'flex';
      this.$<HTMLInputElement>('custom-title').value = info.title;
      this.$<HTMLInputElement>('custom-artist').value = info.artist;

      (this.$<HTMLButtonElement>('btn-download')).disabled = false;
      this.toast('Track info loaded! Edit if needed then download.');
    } catch (e: unknown) {
      this.toast((e as Error).message || 'Failed to inspect URL', 'error');
    } finally {
      btn.innerHTML = `
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
          <circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/>
        </svg>
        Inspect
      `;
    }
  }

  private async handleDownload() {
    const url = this.$<HTMLInputElement>('url-input').value.trim();
    const custom_title = this.$<HTMLInputElement>('custom-title').value.trim();
    const custom_artist = this.$<HTMLInputElement>('custom-artist').value.trim();

    const dlBtn = this.$<HTMLButtonElement>('btn-download');
    const statusEl = this.$('dl-status');
    const statusText = this.$('dl-status-text');

    dlBtn.disabled = true;
    statusEl.style.display = 'flex';
    statusText.textContent = 'Downloading & extracting audio…';

    try {
      const res = await fetch(`${API_BASE}/api/extract`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ url, custom_title, custom_artist }),
      });

      if (!res.ok) {
        const err = await res.json();
        throw new Error(err.detail || 'Download failed');
      }

      const result = await res.json();
      const newTrack: Track = result.track;

      this.tracks.unshift(newTrack);
      this.renderTrackList();

      this.$('modal-dl').classList.remove('active');
      this.resetDlModal();
      this.toast(`"${newTrack.title}" added to your library!`);

      this.playTrack(0);
      if (window.innerWidth < 768) this.openNowPlaying();
    } catch (e: unknown) {
      this.toast((e as Error).message || 'Audio extraction failed', 'error');
      dlBtn.disabled = false;
      statusEl.style.display = 'none';
    }
  }

  // ──────────────────────────────────────────
  // SETTINGS
  // ──────────────────────────────────────────

  private async fetchConfig() {
    try {
      const res = await fetch(`${API_BASE}/api/config`);
      if (res.ok) {
        this.cloudConfig = await res.json();
        this.populateSettingsForm();
      }
    } catch (_) { }
  }

  private populateSettingsForm() {
    this.$<HTMLInputElement>('supa-url').value = this.cloudConfig.supabase_url || '';
    this.$<HTMLInputElement>('supa-key').value = this.cloudConfig.supabase_key || '';
    this.$<HTMLInputElement>('supa-bucket').value = this.cloudConfig.supabase_bucket || 'music';
    this.$<HTMLTextAreaElement>('yt-cookies').value = this.cloudConfig.youtube_cookies || '';
  }

  private async handleSaveSettings() {
    const provider = 'supabase';
    const supabase_url = this.$<HTMLInputElement>('supa-url').value.trim();
    const supabase_key = this.$<HTMLInputElement>('supa-key').value.trim();
    const supabase_bucket = this.$<HTMLInputElement>('supa-bucket').value.trim();
    const youtube_cookies = this.$<HTMLTextAreaElement>('yt-cookies').value;

    const cfg: CloudConfig = { provider, supabase_url, supabase_key, supabase_bucket, youtube_cookies };

    try {
      const res = await fetch(`${API_BASE}/api/config`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(cfg),
      });
      if (res.ok) {
        this.cloudConfig = cfg;
        this.$('modal-settings').classList.remove('active');
        this.toast('Storage settings saved!');
      } else {
        this.toast('Failed to save settings', 'error');
      }
    } catch {
      this.toast('Could not reach backend', 'error');
    }
  }

  // ──────────────────────────────────────────
  // FETCH TRACKS
  // ──────────────────────────────────────────

  private async fetchTracks() {
    try {
      const res = await fetch(`${API_BASE}/api/tracks`);
      if (res.ok) {
        const data = await res.json();
        // Filter out stream-only tracks (no longer supported)
        this.tracks = (data.tracks || []).filter(
          (t: Track) => !t.is_stream && !t.id.startsWith('stream-')
        );
        this.renderFilterPills();
        this.renderTrackList();

        // Pre-load first track info into now playing
        if (this.tracks.length > 0 && !this.currentTrack) {
          const first = this.tracks[0];
          this.$('np-title').textContent = first.title;
          this.$('np-artist').textContent = first.artist;
          this.$('total-time').textContent = this.fmt(first.duration);
        }
      }
    } catch (_) {
      // Backend not yet reachable — will retry on user action
    }
  }

  // ──────────────────────────────────────────
  // PLAYLISTS
  // ──────────────────────────────────────────

  private async fetchPlaylists() {
    try {
      const res = await fetch(`${API_BASE}/api/playlists`);
      if (res.ok) {
        const data = await res.json();
        this.playlists = data.playlists || [];
        this.renderFilterPills();
      }
    } catch (_) { }
  }

  private async handleCreatePlaylist() {
    const name = this.$<HTMLInputElement>('new-playlist-name').value.trim();
    if (!name) {
      this.toast('Please enter a playlist name', 'error');
      return;
    }
    const btn = this.$<HTMLButtonElement>('btn-confirm-new-playlist');
    btn.disabled = true;
    try {
      const res = await fetch(`${API_BASE}/api/playlists`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name, track_ids: [] }),
      });
      if (res.ok) {
        const data = await res.json();
        this.playlists.push(data.playlist);
        this.$('modal-new-playlist').classList.remove('active');
        this.toast(`Playlist "${name}" created!`);
        this.setFilter('playlist', data.playlist.id);
      } else {
        this.toast('Failed to create playlist', 'error');
      }
    } catch {
      this.toast('Could not reach backend', 'error');
    } finally {
      btn.disabled = false;
    }
  }

  private async handleDeletePlaylist(plId: string) {
    const pl = this.playlists.find(p => p.id === plId);
    if (!pl) return;
    if (!confirm(`Delete playlist "${pl.name}"? This cannot be undone.`)) return;
    try {
      const res = await fetch(`${API_BASE}/api/playlists/${plId}`, { method: 'DELETE' });
      if (res.ok) {
        this.playlists = this.playlists.filter(p => p.id !== plId);
        this.toast(`"${pl.name}" deleted`);
        this.setFilter('all');
      } else {
        this.toast('Failed to delete playlist', 'error');
      }
    } catch {
      this.toast('Could not reach backend', 'error');
    }
  }

  private async removeTrackFromPlaylist(plId: string, trackId: string) {
    try {
      const res = await fetch(`${API_BASE}/api/playlists/${plId}/tracks/${trackId}`, { method: 'DELETE' });
      if (res.ok) {
        const data = await res.json();
        const idx = this.playlists.findIndex(p => p.id === plId);
        if (idx >= 0) this.playlists[idx] = data.playlist;
        this.toast('Removed from playlist');
        this.renderFilterPills();
        this.renderTrackList();
      } else {
        this.toast('Failed to remove from playlist', 'error');
      }
    } catch {
      this.toast('Could not reach backend', 'error');
    }
  }

  private openAddToPlaylistModal(trackId: string) {
    // Populate playlist list
    const listEl = this.$('add-to-playlist-list');
    if (this.playlists.length === 0) {
      listEl.innerHTML = `
        <div style="text-align:center;padding:20px 0;color:var(--text-3);font-size:13px;">
          No playlists yet. Create one first!
        </div>
      `;
    } else {
      listEl.innerHTML = this.playlists.map(pl => {
        const alreadyIn = pl.track_ids.includes(trackId);
        return `
          <button class="add-to-pl-item${alreadyIn ? ' already-in' : ''}"
                  data-pl-id="${pl.id}"
                  data-track-id="${trackId}"
                  style="display:flex;align-items:center;gap:10px;padding:10px 12px;
                         border-radius:var(--radius-md);background:${alreadyIn ? 'var(--accent-bg)' : 'var(--surface-2)'};
                         border:1.5px solid ${alreadyIn ? 'rgba(200,255,0,0.2)' : 'var(--border)'};
                         color:${alreadyIn ? 'var(--accent)' : 'var(--text)'};
                         font-size:13.5px;font-weight:600;text-align:left;
                         transition:all 0.15s;width:100%;cursor:${alreadyIn ? 'default' : 'pointer'};">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
              <path d="M3 6h18M3 12h12M3 18h8"/>
            </svg>
            <span style="flex:1">${pl.name}</span>
            <span style="font-size:11px;color:var(--text-3);font-weight:500">${pl.track_ids.length} songs</span>
            ${alreadyIn ? `<svg width="13" height="13" viewBox="0 0 24 24" fill="var(--accent)"><polyline points="20 6 9 17 4 12"/></svg>` : ''}
          </button>
        `;
      }).join('');

      listEl.querySelectorAll('.add-to-pl-item:not(.already-in)').forEach(btn => {
        btn.addEventListener('click', async () => {
          const plId = (btn as HTMLElement).dataset.plId!;
          const tId = (btn as HTMLElement).dataset.trackId!;
          await this.addTrackToPlaylist(plId, tId);
          this.$('modal-add-to-playlist').classList.remove('active');
        });
      });
    }
    this.$('modal-add-to-playlist').classList.add('active');
  }

  private async addTrackToPlaylist(plId: string, trackId: string) {
    try {
      const res = await fetch(`${API_BASE}/api/playlists/${plId}/tracks`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ track_id: trackId }),
      });
      if (res.ok) {
        const data = await res.json();
        const idx = this.playlists.findIndex(p => p.id === plId);
        if (idx >= 0) this.playlists[idx] = data.playlist;
        const pl = this.playlists.find(p => p.id === plId);
        this.toast(`Added to "${pl?.name ?? 'playlist'}"`);
        this.renderFilterPills();
      } else {
        this.toast('Failed to add to playlist', 'error');
      }
    } catch {
      this.toast('Could not reach backend', 'error');
    }
  }

  private openRenamePlaylistModal(pl: Playlist) {
    const input = this.$<HTMLInputElement>('rename-playlist-input');
    input.value = pl.name;
    this.$('modal-rename-playlist').classList.add('active');
    setTimeout(() => { input.focus(); input.select(); }, 80);

    const confirmBtn = this.$<HTMLButtonElement>('btn-confirm-rename-playlist');
    // Clone to remove old listeners
    const newBtn = confirmBtn.cloneNode(true) as HTMLButtonElement;
    confirmBtn.parentNode!.replaceChild(newBtn, confirmBtn);

    newBtn.addEventListener('click', async () => {
      const newName = input.value.trim();
      if (!newName) { this.toast('Name cannot be empty', 'error'); return; }
      newBtn.disabled = true;
      try {
        const res = await fetch(`${API_BASE}/api/playlists/${pl.id}`, {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ name: newName }),
        });
        if (res.ok) {
          const data = await res.json();
          const idx = this.playlists.findIndex(p => p.id === pl.id);
          if (idx >= 0) this.playlists[idx] = data.playlist;
          this.$('modal-rename-playlist').classList.remove('active');
          this.toast(`Renamed to "${newName}"`);
          this.renderFilterPills();
          this.renderTrackList();
        } else {
          this.toast('Failed to rename playlist', 'error');
        }
      } catch {
        this.toast('Could not reach backend', 'error');
      } finally {
        newBtn.disabled = false;
      }
    });
  }

  // ──────────────────────────────────────────
  // MENU DRAWER & SLEEP TIMER
  // ──────────────────────────────────────────

  private openMenu() {
    this.$('drawer-menu').classList.add('active');
    this.updateSleepTimerUI();
  }

  private closeMenu() {
    this.$('drawer-menu').classList.remove('active');
  }

  private openSleepTimerModal() {
    this.$('modal-sleep-timer').classList.add('active');
    this.updateSleepTimerUI();
  }

  private closeSleepTimerModal() {
    this.$('modal-sleep-timer').classList.remove('active');
  }

  private setSleepTimer(minutes: number) {
    if (minutes <= 0) return;
    this.cancelSleepTimer(false);
    this.sleepTimerOriginalVolume = this.volume;
    this.sleepTimerTargetTime = Date.now() + minutes * 60 * 1000;
    this.sleepTimerType = 'duration';
    this.isFadingVolume = false;

    this.startSleepTimerInterval();
    this.updateSleepTimerUI();
    this.toast(`Sleep timer set for ${minutes} min 🌙`);
    this.closeSleepTimerModal();
  }

  private setSleepTimerEndOfTrack() {
    this.cancelSleepTimer(false);
    this.sleepTimerOriginalVolume = this.volume;
    this.sleepTimerType = 'end-of-track';
    this.sleepTimerTargetTime = null;
    this.isFadingVolume = false;

    this.updateSleepTimerUI();
    this.toast('Sleep timer will stop at end of current song 🌙');
    this.closeSleepTimerModal();
  }

  private extendSleepTimer(extraMinutes: number) {
    if (this.sleepTimerType !== 'duration' || !this.sleepTimerTargetTime) {
      this.setSleepTimer(extraMinutes);
      return;
    }
    this.sleepTimerTargetTime += extraMinutes * 60 * 1000;
    if (this.isFadingVolume) {
      this.isFadingVolume = false;
      this.audio.volume = this.sleepTimerOriginalVolume;
    }
    this.updateSleepTimerUI();
    this.toast(`Added ${extraMinutes} min to sleep timer 🌙`);
  }

  private cancelSleepTimer(showToast = true) {
    if (this.sleepTimerIntervalId) {
      clearInterval(this.sleepTimerIntervalId);
      this.sleepTimerIntervalId = null;
    }
    if (this.isFadingVolume) {
      this.audio.volume = this.sleepTimerOriginalVolume;
      this.isFadingVolume = false;
    }
    this.sleepTimerTargetTime = null;
    this.sleepTimerType = null;

    this.updateSleepTimerUI();
    if (showToast) {
      this.toast('Sleep timer turned off');
    }
  }

  private startSleepTimerInterval() {
    if (this.sleepTimerIntervalId) clearInterval(this.sleepTimerIntervalId);
    this.sleepTimerIntervalId = window.setInterval(() => {
      this.checkSleepTimer();
    }, 1000);
  }

  private checkSleepTimer() {
    if (this.sleepTimerType !== 'duration' || !this.sleepTimerTargetTime) return;

    const remainingMs = this.sleepTimerTargetTime - Date.now();

    if (remainingMs <= 0) {
      this.triggerSleepTimerStop();
      return;
    }

    // Handle smooth volume fade-out in final 15 seconds
    if (this.sleepTimerFadeOut && remainingMs <= 15000) {
      this.isFadingVolume = true;
      const factor = Math.max(0, remainingMs / 15000);
      this.audio.volume = Math.max(0, this.sleepTimerOriginalVolume * factor);
    }

    this.updateSleepTimerUI();
  }

  private triggerSleepTimerStop() {
    if (this.sleepTimerIntervalId) {
      clearInterval(this.sleepTimerIntervalId);
      this.sleepTimerIntervalId = null;
    }
    this.sleepTimerTargetTime = null;
    this.sleepTimerType = null;
    this.isFadingVolume = false;

    this.pauseAudio();
    this.audio.volume = this.sleepTimerOriginalVolume;

    this.updateSleepTimerUI();
    this.toast('Sleep timer finished. Music paused 🌙');
  }

  private updateSleepTimerUI() {
    const isDuration = this.sleepTimerType === 'duration' && !!this.sleepTimerTargetTime;
    const isEndTrack = this.sleepTimerType === 'end-of-track';
    const isActive = isDuration || isEndTrack;

    // Badges on hamburger menu and now playing header
    const menuBadge = this.$('menu-timer-badge');
    const npSleepBadge = this.$('np-sleep-badge');
    const npSleepBtn = this.$('np-sleep-btn');
    if (menuBadge) menuBadge.style.display = isActive ? 'block' : 'none';
    if (npSleepBadge) npSleepBadge.style.display = isActive ? 'block' : 'none';
    if (npSleepBtn) npSleepBtn.classList.toggle('active', isActive);

    // Format remaining time string
    let timeStr = '--:--';
    if (isDuration && this.sleepTimerTargetTime) {
      const remSec = Math.max(0, Math.ceil((this.sleepTimerTargetTime - Date.now()) / 1000));
      const m = Math.floor(remSec / 60);
      const s = remSec % 60;
      timeStr = `${m}:${s < 10 ? '0' : ''}${s}`;
    } else if (isEndTrack) {
      timeStr = 'End of song';
    }

    // Drawer menu active pill
    const menuTimerPill = this.$('menu-timer-pill');
    if (menuTimerPill) menuTimerPill.style.display = isActive ? 'inline-block' : 'none';

    // Sleep Timer modal active card (minimalized)
    const timerCard = this.$('timer-active-card');
    const timerActiveTime = this.$('timer-active-time');
    const tacStatusLabel = this.$('tac-status-label');
    if (timerCard) timerCard.style.display = isActive ? 'flex' : 'none';
    if (tacStatusLabel) {
      if (isEndTrack) {
        tacStatusLabel.innerHTML = 'Stopping at <strong>end of song</strong>';
      } else {
        tacStatusLabel.innerHTML = `Stopping in <strong id="timer-active-time">${timeStr}</strong>`;
      }
    } else if (timerActiveTime) {
      timerActiveTime.textContent = timeStr;
    }

    const endTrackBtn = this.$('timer-preset-end-track');
    if (endTrackBtn) endTrackBtn.classList.toggle('selected', isEndTrack);
  }
}

// ── Boot ──
new MusicPlayerApp();
