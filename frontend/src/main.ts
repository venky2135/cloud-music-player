import './style.css';
import { Capacitor, registerPlugin } from '@capacitor/core';

interface MusicNotificationPluginType {
  update(options: {
    title: string;
    artist: string;
    isPlaying: boolean;
    thumbnailUrl?: string;
  }): Promise<void>;
  clear(): Promise<void>;
  checkPermissions(): Promise<{ notifications: string }>;
  requestPermissions(options: { permissions: string[] }): Promise<{ notifications: string }>;
  addListener(
    eventName: 'musicControlsAction',
    listenerFunc: (data: { action: 'play' | 'pause' | 'next' | 'previous' }) => void
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
  private activeFilter: 'all' | 'liked' = 'all';
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

  constructor() {
    this.audio = new Audio();
    this.audio.preload = 'auto';
    this.audio.setAttribute('playsinline', 'true');
    this.audio.setAttribute('webkit-playsinline', 'true');
    this.audio.volume = this.volume;

    this.renderShell();
    this.attachListeners();
    this.initAudioEvents();
    this.initKeyboard();
    this.initNativeMusicControls();
    this.fetchConfig();
    this.fetchTracks();
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
            <button class="icon-btn" id="btn-open-settings" title="Storage settings" aria-label="Settings">
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                <circle cx="12" cy="12" r="3"/>
                <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83-2.83l.06-.06A1.65 1.65 0 0 0 4.68 15a1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 2.83-2.83l.06.06A1.65 1.65 0 0 0 9 4.68a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 2.83l-.06.06A1.65 1.65 0 0 0 19.4 9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z"/>
              </svg>
            </button>
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
          <div class="filter-row">
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
            <button class="np-fav-btn" id="np-fav" title="Like / Unlike" aria-label="Like">
              <svg id="np-fav-icon" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                <path d="M19 14c1.49-1.46 3-3.21 3-5.5A5.5 5.5 0 0 0 16.5 3c-1.76 0-3 .5-4.5 2-1.5-1.5-2.74-2-4.5-2A5.5 5.5 0 0 0 2 8.5c0 2.3 1.5 4.05 3 5.5l7 7Z"/>
              </svg>
            </button>
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

    // ── Settings modal ──
    const openSettings = () => this.$('modal-settings').classList.add('active');
    const closeSettings = () => this.$('modal-settings').classList.remove('active');

    this.$('btn-open-settings').addEventListener('click', openSettings);
    this.$('btn-close-settings').addEventListener('click', closeSettings);
    this.$('btn-cancel-settings').addEventListener('click', closeSettings);
    this.$('modal-settings').addEventListener('click', (e) => {
      if (e.target === this.$('modal-settings')) closeSettings();
    });

    this.$('btn-save-settings').addEventListener('click', () => this.handleSaveSettings());

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
      if (this.audio.duration) this.audio.currentTime = pct * this.audio.duration;
    });

    // ── Volume ──
    const volSlider = this.$<HTMLInputElement>('vol-slider');
    volSlider.addEventListener('input', () => {
      this.volume = parseFloat(volSlider.value);
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
  }

  // ──────────────────────────────────────────
  // AUDIO EVENTS
  // ──────────────────────────────────────────

  private initAudioEvents() {
    this.audio.addEventListener('timeupdate', () => {
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

    if (this.repeatMode === 'one') {
      this.audio.currentTime = 0;
      const p = this.audio.play();
      if (p !== undefined) p.catch(() => {});
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
          this.audio.volume = this.volume;
          this.$<HTMLInputElement>('vol-slider').value = this.volume.toString();
          this.isMuted = false;
          this.updateVolIcon();
          break;
        case 'ArrowDown':
          e.preventDefault();
          this.volume = Math.max(this.volume - 0.05, 0);
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

  private setFilter(f: 'all' | 'liked') {
    this.activeFilter = f;
    this.$('pill-all').classList.toggle('active', f === 'all');
    this.$('pill-liked').classList.toggle('active', f === 'liked');
    this.renderTrackList();
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

      navigator.mediaSession.setActionHandler('play', () => this.togglePlay());
      navigator.mediaSession.setActionHandler('pause', () => this.togglePlay());
      navigator.mediaSession.setActionHandler('previoustrack', () => this.prevTrack());
      navigator.mediaSession.setActionHandler('nexttrack', () => this.nextTrack());
      navigator.mediaSession.setActionHandler('seekto', (details) => {
        if (details.seekTime !== undefined && details.seekTime !== null && this.audio.duration) {
          this.audio.currentTime = details.seekTime;
        }
      });
    } catch (_) {}
  }

  private initNativeMusicControls() {
    if (!Capacitor.isNativePlatform()) return;

    try {
      MusicNotification.checkPermissions().then((status) => {
        if (status.notifications !== 'granted') {
          MusicNotification.requestPermissions({ permissions: ['notifications'] }).catch(() => {});
        }
      }).catch(() => {});
    } catch (_) {}

    try {
      MusicNotification.addListener('musicControlsAction', (data) => {
        if (!data || !data.action) return;
        switch (data.action) {
          case 'play':
            if (!this.isPlaying) this.togglePlay();
            break;
          case 'pause':
            if (this.isPlaying) this.togglePlay();
            break;
          case 'next':
            this.nextTrack();
            break;
          case 'previous':
            this.prevTrack();
            break;
        }
      });
    } catch (_) {}
  }

  private syncNativeMusicNotification() {
    if (!Capacitor.isNativePlatform() || !this.currentTrack) return;
    try {
      const thumb = this.currentTrack.thumbnail
        ? this.resolveMediaUrl(this.currentTrack.thumbnail)
        : '';

      MusicNotification.update({
        title: this.currentTrack.title || 'Unknown Track',
        artist: this.currentTrack.artist || 'poori',
        isPlaying: this.isPlaying,
        thumbnailUrl: thumb,
      }).catch((e) => console.warn('MusicNotification update failed:', e));
    } catch (_) {}
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

  private togglePlay() {
    if (!this.currentTrack) {
      if (this.tracks.length > 0) this.playTrack(0);
      return;
    }
    if (this.isPlaying) {
      this.audio.pause();
    } else {
      const p = this.audio.play();
      if (p !== undefined) p.catch(() => {});
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
  // TRACK LIST RENDER
  // ──────────────────────────────────────────

  private renderTrackList() {
    const container = this.$('track-list');
    const list = this.getFiltered();
    const count = list.length;

    if (count === 0) {
      container.innerHTML = `
        <div class="empty-state">
          <span class="empty-icon">🎧</span>
          <h3>${this.activeFilter === 'liked' ? 'No liked songs yet' : 'No songs found'}</h3>
          <p>${
            this.activeFilter === 'liked'
              ? 'Heart a track to see it here'
              : 'Tap + to download music from a YouTube or direct audio URL'
          }</p>
        </div>
      `;
      return;
    }

    container.innerHTML = list
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
              <button class="track-icon-btn del del-btn"
                      data-id="${track.id}"
                      title="Delete"
                      aria-label="Delete">
                <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                  <polyline points="3 6 5 6 21 6"/>
                  <path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/>
                </svg>
              </button>
              <button class="track-play-btn play-track-btn"
                      data-index="${idx}"
                      title="${isCurrent && this.isPlaying ? 'Pause' : 'Play'}"
                      aria-label="${isCurrent && this.isPlaying ? 'Pause' : 'Play'}">
                <svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor">
                  ${
                    isCurrent && this.isPlaying
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

    // Delete buttons
    container.querySelectorAll('.del-btn').forEach((btn) => {
      btn.addEventListener('click', async (e) => {
        e.stopPropagation();
        const id = (btn as HTMLElement).dataset.id!;
        if (confirm('Remove this track from your drive?')) {
          await this.deleteTrack(id);
        }
      });
    });
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
            MusicNotification.clear().catch(() => {});
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
    } catch (_) {}
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
}

// ── Boot ──
new MusicPlayerApp();
