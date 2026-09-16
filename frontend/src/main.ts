import './style.css';

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
}

const API_BASE = 'http://127.0.0.1:8000';

class MusicPlayerApp {
  private tracks: Track[] = [];
  private currentTrack: Track | null = null;
  private isPlaying = false;
  private isShuffle = false;
  private repeatMode: 'off' | 'all' | 'one' = 'all';
  private volume = 0.8;
  private isMuted = false;
  private searchQuery = '';
  private activeTab: 'library' | 'favorites' = 'library';
  private favorites = new Set<string>(JSON.parse(localStorage.getItem('soundvault_favs') || '[]'));
  private cloudConfig: CloudConfig = { provider: 'local', supabase_url: '', supabase_key: '', supabase_bucket: 'music' };

  // Audio Engine
  private audio: HTMLAudioElement;
  private audioCtx: AudioContext | null = null;
  private analyser: AnalyserNode | null = null;
  private dataArray: Uint8Array | null = null;
  private visualizerAnimationId: number | null = null;

  constructor() {
    this.audio = new Audio();
    this.audio.crossOrigin = 'anonymous';
    this.audio.volume = this.volume;

    this.renderAppShell();
    this.attachEventListeners();
    this.initAudioEvents();
    this.initKeyboardShortcuts();
    this.fetchConfig();
    this.fetchTracks();
  }

  private resolveAudioUrl(url: string): string {
    if (url.startsWith('/storage')) {
      return `${API_BASE}${url}`;
    }
    return url;
  }

  private formatTime(seconds: number): string {
    if (isNaN(seconds) || seconds < 0) return '0:00';
    const m = Math.floor(seconds / 60);
    const s = Math.floor(seconds % 60);
    return `${m}:${s < 10 ? '0' : ''}${s}`;
  }

  private showToast(message: string, type: 'success' | 'error' = 'success') {
    const container = document.getElementById('toast-container');
    if (!container) return;
    const toast = document.createElement('div');
    toast.className = `toast ${type}`;
    toast.innerHTML = `
      <span>${type === 'success' ? '✓' : '⚠'}</span>
      <span>${message}</span>
    `;
    container.appendChild(toast);
    setTimeout(() => {
      toast.style.opacity = '0';
      toast.style.transform = 'translateY(10px)';
      toast.style.transition = 'all 0.3s ease';
      setTimeout(() => toast.remove(), 300);
    }, 3500);
  }

  private renderAppShell() {
    const app = document.getElementById('app')!;
    app.innerHTML = `
      <div class="app-container">
        <!-- Sidebar -->
        <aside class="sidebar">
          <div class="brand">
            <div class="brand-icon">🎵</div>
            <div class="brand-title">SoundVault</div>
          </div>

          <button id="btn-open-downloader" class="btn-download-action">
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" y1="15" x2="12" y2="3"/></svg>
            <span>Download from URL</span>
          </button>

          <div class="nav-group">
            <span class="nav-label">Menu</span>
            <div id="nav-library" class="nav-item active">
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="m3 9 9-7 9 7v11a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"/><polyline points="9 22 9 12 15 12 15 22"/></svg>
              <span>Library</span>
            </div>
            <div id="nav-favorites" class="nav-item">
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M19 14c1.49-1.46 3-3.21 3-5.5A5.5 5.5 0 0 0 16.5 3c-1.76 0-3 .5-4.5 2-1.5-1.5-2.74-2-4.5-2A5.5 5.5 0 0 0 2 8.5c0 2.3 1.5 4.05 3 5.5l7 7Z"/></svg>
              <span>Favorites</span>
            </div>
          </div>

          <div class="cloud-status-card">
            <div class="status-indicator">
              <div id="cloud-status-dot" class="dot"></div>
              <div>
                <strong id="cloud-provider-name">Local Storage</strong>
                <div style="color: var(--text-muted); font-size: 11px;">Drive Active</div>
              </div>
            </div>
            <button id="btn-open-settings" class="track-action-btn" title="Cloud Drive Settings">
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1 0 2.83 2 2 0 0 1-2.83 0l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-2 2 2 2 0 0 1-2-2v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83 0 2 2 0 0 1 0-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1-2-2 2 2 0 0 1 2-2h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 0-2.83 2 2 0 0 1 2.83 0l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 2-2 2 2 0 0 1 2 2v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 0 2 2 0 0 1 0 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 2 2 2 2 0 0 1-2 2h-.09a1.65 1.65 0 0 0-1.51 1z"/></svg>
            </button>
          </div>
        </aside>

        <!-- Main View -->
        <main class="main-view">
          <!-- Top Header -->
          <div class="top-header">
            <div class="search-bar">
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/></svg>
              <input type="text" id="search-input" placeholder="Search title, artist or genre..." />
            </div>

            <div class="header-actions">
              <button id="btn-quick-url" class="btn-icon-action" title="Add song from link">
                <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71"/><path d="M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71"/></svg>
              </button>
            </div>
          </div>

          <!-- Hero Banner -->
          <div class="hero-banner">
            <div class="hero-content">
              <div class="hero-tag">⚡ Cloud Stream & Offline Ready</div>
              <h1 class="hero-title" id="hero-title">Experience Pure Sound Freedom</h1>
              <p class="hero-subtitle" id="hero-subtitle">Stream effortlessly, download music directly from any URL, and manage your library seamlessly.</p>
              <div class="hero-btn-row">
                <button id="btn-hero-play" class="btn-hero-play">
                  <svg width="18" height="18" viewBox="0 0 24 24" fill="currentColor"><polygon points="5 3 19 12 5 21 5 3"/></svg>
                  <span>Play Featured</span>
                </button>
              </div>
            </div>
          </div>

          <!-- Music Library -->
          <div class="section-header">
            <h2 class="section-title">
              <span id="library-heading">All Songs</span>
              <span id="track-count" class="badge-count">0 tracks</span>
            </h2>
          </div>

          <div class="track-table-container">
            <table class="track-table">
              <thead>
                <tr>
                  <th style="width: 45px;">#</th>
                  <th>Title & Artist</th>
                  <th>Duration</th>
                  <th>Storage</th>
                  <th style="width: 100px; text-align: right;">Actions</th>
                </tr>
              </thead>
              <tbody id="track-table-body">
                <!-- Injected via renderTrackList -->
              </tbody>
            </table>
          </div>
        </main>
      </div>

      <!-- Persistent Player Bar -->
      <div class="player-bar">
        <!-- Left: Now Playing Info -->
        <div class="player-left">
          <div class="player-thumb-wrap">
            <img id="player-thumb" class="player-thumb" src="https://images.unsplash.com/photo-1511671782779-c97d3d27a1d4?w=200&auto=format&fit=crop&q=80" alt="Cover" />
          </div>
          <div class="player-meta">
            <div id="player-title" class="player-title">Select a track</div>
            <div id="player-artist" class="player-artist">Ready to play</div>
          </div>
          <button id="player-fav-btn" class="track-action-btn" title="Save to favorites">
            <svg id="fav-icon" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M19 14c1.49-1.46 3-3.21 3-5.5A5.5 5.5 0 0 0 16.5 3c-1.76 0-3 .5-4.5 2-1.5-1.5-2.74-2-4.5-2A5.5 5.5 0 0 0 2 8.5c0 2.3 1.5 4.05 3 5.5l7 7Z"/></svg>
          </button>
        </div>

        <!-- Center: Controls & Seek -->
        <div class="player-center">
          <div class="controls-row">
            <button id="ctrl-shuffle" class="ctrl-btn" title="Shuffle">
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="16 3 21 3 21 8"/><line x1="4" y1="20" x2="21" y2="3"/><polyline points="21 16 21 21 16 21"/><line x1="15" y1="15" x2="21" y2="21"/><line x1="4" y1="4" x2="9" y2="9"/></svg>
            </button>
            <button id="ctrl-prev" class="ctrl-btn" title="Previous (P)">
              <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polygon points="19 20 9 12 19 4 19 20"/><line x1="5" y1="19" x2="5" y2="5"/></svg>
            </button>
            <button id="ctrl-play" class="play-pause-btn" title="Play/Pause (Space)">
              <svg id="play-pause-icon" width="22" height="22" viewBox="0 0 24 24" fill="currentColor"><polygon points="5 3 19 12 5 21 5 3"/></svg>
            </button>
            <button id="ctrl-next" class="ctrl-btn" title="Next (N)">
              <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polygon points="5 4 15 12 5 20 5 4"/><line x1="19" y1="5" x2="19" y2="19"/></svg>
            </button>
            <button id="ctrl-repeat" class="ctrl-btn active" title="Repeat All">
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="17 1 21 5 17 9"/><path d="M3 11V9a4 4 0 0 1 4-4h14"/><polyline points="7 23 3 19 7 15"/><path d="M21 13v2a4 4 0 0 1-4 4H3"/></svg>
            </button>
          </div>

          <div class="progress-row">
            <span id="current-time" class="time-label">0:00</span>
            <div id="seek-bar" class="seek-bar-container">
              <div class="seek-bar-track">
                <div id="seek-fill" class="seek-bar-fill"></div>
              </div>
            </div>
            <span id="total-time" class="time-label">0:00</span>
          </div>
        </div>

        <!-- Right: Visualizer & Volume -->
        <div class="player-right">
          <canvas id="visualizer-canvas" class="visualizer-canvas" width="100" height="36"></canvas>

          <div class="volume-container">
            <button id="btn-volume-toggle" class="ctrl-btn" title="Mute (M)">
              <svg id="volume-icon" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polygon points="11 5 6 9 2 9 2 15 6 15 11 19 11 5"/><path d="M15.54 8.46a5 5 0 0 1 0 7.07"/><path d="M19.07 4.93a10 10 0 0 1 0 14.14"/></svg>
            </button>
            <input type="range" id="volume-slider" class="volume-slider" min="0" max="1" step="0.01" value="0.8" />
          </div>
        </div>
      </div>

      <!-- URL Audio Downloader Modal -->
      <div id="modal-downloader" class="modal-overlay">
        <div class="modal-card">
          <div class="modal-header">
            <div class="modal-title">
              <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" y1="15" x2="12" y2="3"/></svg>
              <span>Download Audio from URL</span>
            </div>
            <button id="btn-close-downloader" class="btn-close-modal">&times;</button>
          </div>

          <div class="modal-body">
            <div class="form-group">
              <label class="form-label">Media URL (YouTube, SoundCloud, or Direct Audio Link)</label>
              <div style="display: flex; gap: 8px;">
                <input type="url" id="input-download-url" class="form-input" style="flex: 1;" placeholder="https://www.youtube.com/watch?v=... or direct .mp3" />
                <button id="btn-inspect-url" class="btn-secondary" style="display: flex; align-items: center; gap: 6px;">
                  <span>Inspect</span>
                </button>
              </div>
            </div>

            <!-- Preview Card (Hidden initially) -->
            <div id="download-preview-box" class="preview-box" style="display: none;">
              <img id="preview-thumb" class="preview-thumb" src="" alt="Thumbnail" />
              <div class="preview-details">
                <div id="preview-title" class="preview-title">Title</div>
                <div id="preview-artist" class="preview-artist">Artist</div>
                <div class="status-pill">
                  <span id="preview-duration">0:00</span> • Ready to download
                </div>
              </div>
            </div>

            <div id="download-edit-fields" style="display: none; flex-direction: column; gap: 12px;">
              <div class="form-group">
                <label class="form-label">Customize Track Title (Optional)</label>
                <input type="text" id="input-custom-title" class="form-input" placeholder="Title" />
              </div>
              <div class="form-group">
                <label class="form-label">Customize Artist Name (Optional)</label>
                <input type="text" id="input-custom-artist" class="form-input" placeholder="Artist" />
              </div>
            </div>

            <div id="download-progress-status" style="display: none;" class="status-pill">
              <div class="spinner"></div>
              <span id="download-progress-text">Extracting audio & transcoding...</span>
            </div>
          </div>

          <div class="modal-footer" style="display: flex; gap: 10px; justify-content: flex-end; flex-wrap: wrap;">
            <button id="btn-cancel-downloader" class="btn-secondary">Cancel</button>
            <button id="btn-confirm-stream" class="btn-primary" style="background: linear-gradient(135deg, #06b6d4, #3b82f6); box-shadow: 0 4px 14px rgba(6, 182, 212, 0.4);" disabled>
              <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><polygon points="13 2 3 14 12 14 11 22 21 10 12 10 13 2"/></svg>
              <span>⚡ Stream & Save to Favorites (0 MB)</span>
            </button>
            <button id="btn-confirm-download" class="btn-secondary" style="border-color: var(--primary); color: #c4b5fd;" disabled>
              <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" y1="15" x2="12" y2="3"/></svg>
              <span>💾 Download to Drive</span>
            </button>
          </div>
        </div>
      </div>

      <!-- Cloud Storage Settings Modal -->
      <div id="modal-settings" class="modal-overlay">
        <div class="modal-card">
          <div class="modal-header">
            <div class="modal-title">
              <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M17.5 19H9a7 7 0 1 1 6.71-9h1.79a4.5 4.5 0 1 1 0 9Z"/></svg>
              <span>Cloud Storage Settings</span>
            </div>
            <button id="btn-close-settings" class="btn-close-modal">&times;</button>
          </div>

          <div class="modal-body">
            <div class="form-group">
              <label class="form-label">Storage Provider</label>
              <select id="select-provider" class="form-input">
                <option value="local">Local Storage (Fastest, zero setup)</option>
                <option value="supabase">Supabase Cloud Storage (Free 1GB, S3 CDN)</option>
              </select>
            </div>

            <div id="supabase-fields" style="display: none; flex-direction: column; gap: 14px;">
              <div class="form-group">
                <label class="form-label">Supabase Project URL</label>
                <input type="text" id="input-supa-url" class="form-input" placeholder="https://your-project.supabase.co" />
              </div>
              <div class="form-group">
                <label class="form-label">Supabase API Key (Anon or Service Role)</label>
                <input type="password" id="input-supa-key" class="form-input" placeholder="eyJhbGci..." />
              </div>
              <div class="form-group">
                <label class="form-label">Storage Bucket Name</label>
                <input type="text" id="input-supa-bucket" class="form-input" value="music" placeholder="music" />
              </div>
            </div>
          </div>

          <div class="modal-footer">
            <button id="btn-cancel-settings" class="btn-secondary">Close</button>
            <button id="btn-save-settings" class="btn-primary">Save Settings</button>
          </div>
        </div>
      </div>

      <!-- Toast Container -->
      <div id="toast-container" class="toast-container"></div>
    `;
  }

  private attachEventListeners() {
    // Navigation
    document.getElementById('nav-library')!.addEventListener('click', () => {
      this.activeTab = 'library';
      document.getElementById('nav-library')!.classList.add('active');
      document.getElementById('nav-favorites')!.classList.remove('active');
      document.getElementById('library-heading')!.textContent = 'All Songs';
      this.renderTrackList();
    });

    document.getElementById('nav-favorites')!.addEventListener('click', () => {
      this.activeTab = 'favorites';
      document.getElementById('nav-favorites')!.classList.add('active');
      document.getElementById('nav-library')!.classList.remove('active');
      document.getElementById('library-heading')!.textContent = 'Favorite Songs';
      this.renderTrackList();
    });

    // Search
    document.getElementById('search-input')!.addEventListener('input', (e) => {
      this.searchQuery = (e.target as HTMLInputElement).value.toLowerCase();
      this.renderTrackList();
    });

    // Modals
    const downloaderModal = document.getElementById('modal-downloader')!;
    const settingsModal = document.getElementById('modal-settings')!;

    const openDownloader = () => {
      downloaderModal.classList.add('active');
      document.getElementById('input-download-url')?.focus();
    };

    const closeDownloader = () => {
      downloaderModal.classList.remove('active');
      this.resetDownloaderModal();
    };

    document.getElementById('btn-open-downloader')!.addEventListener('click', openDownloader);
    document.getElementById('btn-quick-url')!.addEventListener('click', openDownloader);
    document.getElementById('btn-close-downloader')!.addEventListener('click', closeDownloader);
    document.getElementById('btn-cancel-downloader')!.addEventListener('click', closeDownloader);

    document.getElementById('btn-open-settings')!.addEventListener('click', () => {
      settingsModal.classList.add('active');
    });
    document.getElementById('btn-close-settings')!.addEventListener('click', () => {
      settingsModal.classList.remove('active');
    });
    document.getElementById('btn-cancel-settings')!.addEventListener('click', () => {
      settingsModal.classList.remove('active');
    });

    // Downloader Actions
    document.getElementById('btn-inspect-url')!.addEventListener('click', () => this.handleInspectUrl());
    document.getElementById('input-download-url')!.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') this.handleInspectUrl();
    });
    document.getElementById('btn-confirm-download')!.addEventListener('click', () => this.handleStartDownload());
    document.getElementById('btn-confirm-stream')!.addEventListener('click', () => this.handleStreamAndBookmark());

    // Settings actions
    const selectProvider = document.getElementById('select-provider') as HTMLSelectElement;
    const supaFields = document.getElementById('supabase-fields')!;
    selectProvider.addEventListener('change', () => {
      supaFields.style.display = selectProvider.value === 'supabase' ? 'flex' : 'none';
    });

    document.getElementById('btn-save-settings')!.addEventListener('click', () => this.handleSaveSettings());

    // Hero Play Button
    document.getElementById('btn-hero-play')!.addEventListener('click', () => {
      if (this.tracks.length > 0) {
        this.playTrack(0);
      }
    });

    // Controls
    document.getElementById('ctrl-play')!.addEventListener('click', () => this.togglePlay());
    document.getElementById('ctrl-prev')!.addEventListener('click', () => this.prevTrack());
    document.getElementById('ctrl-next')!.addEventListener('click', () => this.nextTrack());

    document.getElementById('ctrl-shuffle')!.addEventListener('click', () => {
      this.isShuffle = !this.isShuffle;
      document.getElementById('ctrl-shuffle')!.classList.toggle('active', this.isShuffle);
      this.showToast(this.isShuffle ? 'Shuffle enabled' : 'Shuffle disabled');
    });

    document.getElementById('ctrl-repeat')!.addEventListener('click', () => {
      const modes: Array<'off' | 'all' | 'one'> = ['off', 'all', 'one'];
      const nextIndex = (modes.indexOf(this.repeatMode) + 1) % modes.length;
      this.repeatMode = modes[nextIndex];
      const repeatBtn = document.getElementById('ctrl-repeat')!;
      repeatBtn.classList.toggle('active', this.repeatMode !== 'off');
      this.showToast(`Repeat mode: ${this.repeatMode.toUpperCase()}`);
    });

    // Seek bar
    const seekBar = document.getElementById('seek-bar')!;
    seekBar.addEventListener('click', (e) => {
      const rect = seekBar.getBoundingClientRect();
      const clickX = e.clientX - rect.left;
      const percentage = clickX / rect.width;
      if (this.audio.duration) {
        this.audio.currentTime = percentage * this.audio.duration;
      }
    });

    // Volume
    const volumeSlider = document.getElementById('volume-slider') as HTMLInputElement;
    volumeSlider.addEventListener('input', () => {
      this.volume = parseFloat(volumeSlider.value);
      this.audio.volume = this.volume;
      this.isMuted = this.volume === 0;
      this.updateVolumeIcon();
    });

    document.getElementById('btn-volume-toggle')!.addEventListener('click', () => {
      this.isMuted = !this.isMuted;
      this.audio.muted = this.isMuted;
      this.updateVolumeIcon();
    });

    // Favorites in player bar
    document.getElementById('player-fav-btn')!.addEventListener('click', () => {
      if (this.currentTrack) {
        this.toggleFavorite(this.currentTrack.id);
      }
    });
  }

  private initAudioEvents() {
    this.audio.addEventListener('timeupdate', () => {
      const current = this.audio.currentTime;
      const total = this.audio.duration || 0;
      document.getElementById('current-time')!.textContent = this.formatTime(current);
      document.getElementById('total-time')!.textContent = this.formatTime(total);
      
      const percentage = total > 0 ? (current / total) * 100 : 0;
      document.getElementById('seek-fill')!.style.width = `${percentage}%`;
    });

    this.audio.addEventListener('ended', () => {
      if (this.repeatMode === 'one') {
        this.audio.currentTime = 0;
        this.audio.play();
      } else {
        this.nextTrack();
      }
    });

    this.audio.addEventListener('play', () => {
      this.isPlaying = true;
      this.updatePlayPauseUI();
      this.startVisualizer();
      document.getElementById('player-thumb')?.classList.add('rotating');
    });

    this.audio.addEventListener('pause', () => {
      this.isPlaying = false;
      this.updatePlayPauseUI();
      this.stopVisualizer();
      document.getElementById('player-thumb')?.classList.remove('rotating');
    });

    this.audio.addEventListener('error', (e) => {
      console.error('Audio playback error:', e);
      this.showToast('Error playing audio stream', 'error');
      this.isPlaying = false;
      this.updatePlayPauseUI();
    });
  }

  private initKeyboardShortcuts() {
    window.addEventListener('keydown', (e) => {
      // Don't trigger if typing in an input
      if ((e.target as HTMLElement).tagName === 'INPUT' || (e.target as HTMLElement).tagName === 'SELECT') {
        return;
      }

      switch (e.code) {
        case 'Space':
          e.preventDefault();
          this.togglePlay();
          break;
        case 'ArrowRight':
          e.preventDefault();
          this.audio.currentTime = Math.min(this.audio.currentTime + 5, this.audio.duration || 0);
          break;
        case 'ArrowLeft':
          e.preventDefault();
          this.audio.currentTime = Math.max(this.audio.currentTime - 5, 0);
          break;
        case 'ArrowUp':
          e.preventDefault();
          this.volume = Math.min(this.volume + 0.05, 1);
          this.audio.volume = this.volume;
          (document.getElementById('volume-slider') as HTMLInputElement).value = this.volume.toString();
          this.isMuted = false;
          this.updateVolumeIcon();
          break;
        case 'ArrowDown':
          e.preventDefault();
          this.volume = Math.max(this.volume - 0.05, 0);
          this.audio.volume = this.volume;
          (document.getElementById('volume-slider') as HTMLInputElement).value = this.volume.toString();
          this.isMuted = this.volume === 0;
          this.updateVolumeIcon();
          break;
        case 'KeyM':
          e.preventDefault();
          this.isMuted = !this.isMuted;
          this.audio.muted = this.isMuted;
          this.updateVolumeIcon();
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

  private setupAudioVisualizer() {
    if (this.audioCtx) return;
    try {
      const AudioContextClass = window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
      this.audioCtx = new AudioContextClass();
      this.analyser = this.audioCtx.createAnalyser();
      this.analyser.fftSize = 64;
      const source = this.audioCtx.createMediaElementSource(this.audio);
      source.connect(this.analyser);
      this.analyser.connect(this.audioCtx.destination);
      this.dataArray = new Uint8Array(this.analyser.frequencyBinCount);
    } catch (e) {
      console.warn('Web Audio API initialized on user gesture:', e);
    }
  }

  private startVisualizer() {
    const canvas = document.getElementById('visualizer-canvas') as HTMLCanvasElement;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    this.setupAudioVisualizer();

    const draw = () => {
      this.visualizerAnimationId = requestAnimationFrame(draw);
      ctx.clearRect(0, 0, canvas.width, canvas.height);

      if (this.analyser && this.dataArray) {
        (this.analyser as any).getByteFrequencyData(this.dataArray);
        const barWidth = (canvas.width / 16) - 2;
        let x = 0;

        for (let i = 0; i < 16; i++) {
          const barHeight = (this.dataArray[i * 2] / 255) * canvas.height;
          const gradient = ctx.createLinearGradient(0, canvas.height, 0, 0);
          gradient.addColorStop(0, '#8b5cf6');
          gradient.addColorStop(1, '#06b6d4');

          ctx.fillStyle = gradient;
          ctx.fillRect(x, canvas.height - barHeight, barWidth, barHeight);
          x += barWidth + 2;
        }
      } else {
        // Subtle idle wave
        for (let i = 0; i < 16; i++) {
          const h = Math.sin(Date.now() / 200 + i) * 6 + 8;
          ctx.fillStyle = 'rgba(139, 92, 246, 0.4)';
          ctx.fillRect(i * 6, canvas.height - h, 4, h);
        }
      }
    };

    if (this.visualizerAnimationId) cancelAnimationFrame(this.visualizerAnimationId);
    draw();
  }

  private stopVisualizer() {
    if (this.visualizerAnimationId) {
      cancelAnimationFrame(this.visualizerAnimationId);
      this.visualizerAnimationId = null;
    }
    const canvas = document.getElementById('visualizer-canvas') as HTMLCanvasElement;
    if (canvas) {
      const ctx = canvas.getContext('2d');
      ctx?.clearRect(0, 0, canvas.width, canvas.height);
    }
  }

  private updatePlayPauseUI() {
    const icon = document.getElementById('play-pause-icon')!;
    if (this.isPlaying) {
      icon.innerHTML = `<rect x="6" y="4" width="4" height="16"/><rect x="14" y="4" width="4" height="16"/>`;
    } else {
      icon.innerHTML = `<polygon points="5 3 19 12 5 21 5 3"/>`;
    }
    this.renderTrackList();
  }

  private updateVolumeIcon() {
    const icon = document.getElementById('volume-icon')!;
    if (this.isMuted || this.volume === 0) {
      icon.innerHTML = `<line x1="1" y1="1" x2="23" y2="23"/><polygon points="11 5 6 9 2 9 2 15 6 15 11 19 11 5"/>`;
    } else if (this.volume < 0.5) {
      icon.innerHTML = `<polygon points="11 5 6 9 2 9 2 15 6 15 11 19 11 5"/><path d="M15.54 8.46a5 5 0 0 1 0 7.07"/>`;
    } else {
      icon.innerHTML = `<polygon points="11 5 6 9 2 9 2 15 6 15 11 19 11 5"/><path d="M15.54 8.46a5 5 0 0 1 0 7.07"/><path d="M19.07 4.93a10 10 0 0 1 0 14.14"/>`;
    }
  }

  private togglePlay() {
    if (!this.currentTrack) {
      if (this.tracks.length > 0) this.playTrack(0);
      return;
    }

    if (this.isPlaying) {
      this.audio.pause();
    } else {
      if (this.audioCtx && this.audioCtx.state === 'suspended') {
        this.audioCtx.resume();
      }
      this.audio.play().catch(e => console.log('Play blocked until interaction:', e));
    }
  }

  private getFilteredTracks(): Track[] {
    return this.tracks.filter(t => {
      const matchSearch = t.title.toLowerCase().includes(this.searchQuery) ||
                          t.artist.toLowerCase().includes(this.searchQuery);
      if (!matchSearch) return false;
      if (this.activeTab === 'favorites') {
        return this.favorites.has(t.id);
      }
      return true;
    });
  }

  private playTrack(index: number) {
    const filtered = this.getFilteredTracks();
    if (index < 0 || index >= filtered.length) return;

    this.currentTrack = filtered[index];
    const streamUrl = this.resolveAudioUrl(this.currentTrack.audio_url);
    this.audio.src = streamUrl;
    this.audio.load();

    // Update bottom bar
    document.getElementById('player-title')!.textContent = this.currentTrack.title;
    document.getElementById('player-artist')!.textContent = this.currentTrack.artist;
    (document.getElementById('player-thumb') as HTMLImageElement).src = this.currentTrack.thumbnail;
    this.updateFavIcon();

    // Update hero banner with current playing
    document.getElementById('hero-title')!.textContent = this.currentTrack.title;
    document.getElementById('hero-subtitle')!.textContent = `By ${this.currentTrack.artist} • Enjoy High Fidelity Streaming`;

    if (this.audioCtx && this.audioCtx.state === 'suspended') {
      this.audioCtx.resume();
    }

    this.audio.play().catch(e => console.log('Playback error:', e));
    this.renderTrackList();
  }

  private nextTrack() {
    const filtered = this.getFilteredTracks();
    if (filtered.length === 0) return;

    if (this.isShuffle) {
      const randIndex = Math.floor(Math.random() * filtered.length);
      this.playTrack(randIndex);
      return;
    }

    const currentIndex = filtered.findIndex(t => t.id === this.currentTrack?.id);
    const nextIndex = (currentIndex + 1) % filtered.length;
    this.playTrack(nextIndex);
  }

  private prevTrack() {
    const filtered = this.getFilteredTracks();
    if (filtered.length === 0) return;

    const currentIndex = filtered.findIndex(t => t.id === this.currentTrack?.id);
    const prevIndex = (currentIndex - 1 + filtered.length) % filtered.length;
    this.playTrack(prevIndex);
  }

  private toggleFavorite(id: string) {
    if (this.favorites.has(id)) {
      this.favorites.delete(id);
      this.showToast('Removed from favorites');
    } else {
      this.favorites.add(id);
      this.showToast('Saved to favorites');
    }
    localStorage.setItem('soundvault_favs', JSON.stringify(Array.from(this.favorites)));
    this.updateFavIcon();
    this.renderTrackList();
  }

  private updateFavIcon() {
    const isFav = this.currentTrack && this.favorites.has(this.currentTrack.id);
    const favIcon = document.getElementById('fav-icon')!;
    if (isFav) {
      favIcon.setAttribute('fill', '#ec4899');
      favIcon.setAttribute('stroke', '#ec4899');
    } else {
      favIcon.setAttribute('fill', 'none');
      favIcon.setAttribute('stroke', 'currentColor');
    }
  }

  private async fetchConfig() {
    try {
      const res = await fetch(`${API_BASE}/api/config`);
      if (res.ok) {
        this.cloudConfig = await res.json();
        this.updateConfigUI();
      }
    } catch (e) {
      console.warn('Backend API connection pending:', e);
    }
  }

  private updateConfigUI() {
    const isSupa = this.cloudConfig.provider === 'supabase' && !!this.cloudConfig.supabase_url;
    const dot = document.getElementById('cloud-status-dot')!;
    const name = document.getElementById('cloud-provider-name')!;
    
    if (isSupa) {
      dot.className = 'dot';
      name.textContent = 'Supabase Drive';
    } else {
      dot.className = 'dot';
      name.textContent = 'Local Server Drive';
    }

    // Populate settings form
    (document.getElementById('select-provider') as HTMLSelectElement).value = this.cloudConfig.provider;
    (document.getElementById('input-supa-url') as HTMLInputElement).value = this.cloudConfig.supabase_url || '';
    (document.getElementById('input-supa-key') as HTMLInputElement).value = this.cloudConfig.supabase_key || '';
    (document.getElementById('input-supa-bucket') as HTMLInputElement).value = this.cloudConfig.supabase_bucket || 'music';
    document.getElementById('supabase-fields')!.style.display = this.cloudConfig.provider === 'supabase' ? 'flex' : 'none';
  }

  private async handleSaveSettings() {
    const provider = (document.getElementById('select-provider') as HTMLSelectElement).value;
    const supabase_url = (document.getElementById('input-supa-url') as HTMLInputElement).value.trim();
    const supabase_key = (document.getElementById('input-supa-key') as HTMLInputElement).value.trim();
    const supabase_bucket = (document.getElementById('input-supa-bucket') as HTMLInputElement).value.trim();

    const newConfig: CloudConfig = { provider, supabase_url, supabase_key, supabase_bucket };

    try {
      const res = await fetch(`${API_BASE}/api/config`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(newConfig)
      });
      if (res.ok) {
        this.cloudConfig = newConfig;
        this.updateConfigUI();
        document.getElementById('modal-settings')!.classList.remove('active');
        this.showToast('Storage settings saved!');
      } else {
        this.showToast('Failed to save settings', 'error');
      }
    } catch (e) {
      this.showToast('Could not reach backend', 'error');
    }
  }

  private async fetchTracks() {
    try {
      const res = await fetch(`${API_BASE}/api/tracks`);
      if (res.ok) {
        const data = await res.json();
        this.tracks = data.tracks || [];
        this.renderTrackList();
        if (this.tracks.length > 0 && !this.currentTrack) {
          // Pre-load first track info
          const first = this.tracks[0];
          document.getElementById('player-title')!.textContent = first.title;
          document.getElementById('player-artist')!.textContent = first.artist;
          (document.getElementById('player-thumb') as HTMLImageElement).src = first.thumbnail;
          document.getElementById('total-time')!.textContent = this.formatTime(first.duration);
        }
      }
    } catch (e) {
      console.warn('Backend server not reachable yet:', e);
    }
  }

  private renderTrackList() {
    const tbody = document.getElementById('track-table-body')!;
    const filtered = this.getFilteredTracks();
    document.getElementById('track-count')!.textContent = `${filtered.length} tracks`;

    if (filtered.length === 0) {
      tbody.innerHTML = `
        <tr>
          <td colspan="5">
            <div class="empty-state">
              <div class="empty-icon">🎧</div>
              <h3>No songs found</h3>
              <p>Download your favorite music from a YouTube or direct audio URL above!</p>
            </div>
          </td>
        </tr>
      `;
      return;
    }

    tbody.innerHTML = filtered.map((track, index) => {
      const isCurrent = this.currentTrack?.id === track.id;
      const isFav = this.favorites.has(track.id);
      const isStream = !!track.is_stream || track.id.startsWith('stream-');
      const isCloud = track.audio_url.startsWith('http') && !track.audio_url.includes('127.0.0.1');

      let storageBadgeHtml = '';
      if (isStream) {
        storageBadgeHtml = `<span class="storage-badge" style="background: rgba(139, 92, 246, 0.2); color: #c4b5fd; border-color: rgba(139, 92, 246, 0.4);">⚡ Live Stream (0 MB)</span>`;
      } else if (isCloud) {
        storageBadgeHtml = `<span class="storage-badge">☁ Cloud Drive</span>`;
      } else {
        storageBadgeHtml = `<span class="storage-badge local">💻 Local Drive</span>`;
      }

      return `
        <tr class="track-row ${isCurrent ? 'playing' : ''}" data-id="${track.id}" data-index="${index}">
          <td class="track-num-col">
            ${isCurrent && this.isPlaying ? '▶' : index + 1}
          </td>
          <td>
            <div class="track-info-cell">
              <img class="track-thumb" src="${track.thumbnail}" alt="" />
              <div class="track-meta">
                <span class="track-name" title="${track.title}">${track.title}</span>
                <span class="track-artist">${track.artist}</span>
              </div>
            </div>
          </td>
          <td style="color: var(--text-muted); font-size: 13px;">
            ${this.formatTime(track.duration)}
          </td>
          <td>
            ${storageBadgeHtml}
          </td>
          <td style="text-align: right;">
            <button class="track-action-btn btn-row-fav" data-id="${track.id}" title="${isFav ? 'Unfavorite' : 'Favorite'}">
              <svg width="15" height="15" viewBox="0 0 24 24" fill="${isFav ? '#ec4899' : 'none'}" stroke="${isFav ? '#ec4899' : 'currentColor'}" stroke-width="2"><path d="M19 14c1.49-1.46 3-3.21 3-5.5A5.5 5.5 0 0 0 16.5 3c-1.76 0-3 .5-4.5 2-1.5-1.5-2.74-2-4.5-2A5.5 5.5 0 0 0 2 8.5c0 2.3 1.5 4.05 3 5.5l7 7Z"/></svg>
            </button>
            <button class="track-action-btn delete btn-row-del" data-id="${track.id}" title="Delete song">
              <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="3 6 5 6 21 6"/><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/></svg>
            </button>
          </td>
        </tr>
      `;
    }).join('');

    // Attach row listeners
    tbody.querySelectorAll('.track-row').forEach(row => {
      row.addEventListener('click', (e) => {
        // Prevent click if clicked on action button
        if ((e.target as HTMLElement).closest('.track-action-btn')) return;
        const index = parseInt((row as HTMLElement).dataset.index || '0', 10);
        this.playTrack(index);
      });
    });

    tbody.querySelectorAll('.btn-row-fav').forEach(btn => {
      btn.addEventListener('click', (e) => {
        e.stopPropagation();
        const id = (btn as HTMLElement).dataset.id!;
        this.toggleFavorite(id);
      });
    });

    tbody.querySelectorAll('.btn-row-del').forEach(btn => {
      btn.addEventListener('click', async (e) => {
        e.stopPropagation();
        const id = (btn as HTMLElement).dataset.id!;
        if (confirm('Are you sure you want to remove this track from your drive?')) {
          await this.deleteTrack(id);
        }
      });
    });
  }

  private async deleteTrack(id: string) {
    try {
      const res = await fetch(`${API_BASE}/api/tracks/${id}`, { method: 'DELETE' });
      if (res.ok) {
        this.tracks = this.tracks.filter(t => t.id !== id);
        this.favorites.delete(id);
        if (this.currentTrack?.id === id) {
          this.audio.pause();
          this.currentTrack = null;
        }
        this.showToast('Track deleted from storage');
        this.renderTrackList();
      } else {
        this.showToast('Failed to delete track', 'error');
      }
    } catch (e) {
      this.showToast('Could not reach backend', 'error');
    }
  }

  // URL Audio Downloader Logic
  private resetDownloaderModal() {
    (document.getElementById('input-download-url') as HTMLInputElement).value = '';
    (document.getElementById('input-custom-title') as HTMLInputElement).value = '';
    (document.getElementById('input-custom-artist') as HTMLInputElement).value = '';
    document.getElementById('download-preview-box')!.style.display = 'none';
    document.getElementById('download-edit-fields')!.style.display = 'none';
    document.getElementById('download-progress-status')!.style.display = 'none';
    (document.getElementById('btn-confirm-download') as HTMLButtonElement).disabled = true;
    (document.getElementById('btn-confirm-stream') as HTMLButtonElement).disabled = true;
  }

  private async handleInspectUrl() {
    const urlInput = document.getElementById('input-download-url') as HTMLInputElement;
    const url = urlInput.value.trim();
    if (!url) {
      this.showToast('Please paste a media URL first', 'error');
      return;
    }

    const inspectBtn = document.getElementById('btn-inspect-url')!;
    inspectBtn.innerHTML = `<div class="spinner"></div>`;
    
    try {
      const res = await fetch(`${API_BASE}/api/preview`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ url })
      });

      if (!res.ok) {
        const err = await res.json();
        throw new Error(err.detail || 'URL could not be parsed');
      }

      const info = await res.json();
      
      // Populate preview card
      document.getElementById('download-preview-box')!.style.display = 'flex';
      (document.getElementById('preview-thumb') as HTMLImageElement).src = info.thumbnail;
      document.getElementById('preview-title')!.textContent = info.title;
      document.getElementById('preview-artist')!.textContent = info.artist;
      document.getElementById('preview-duration')!.textContent = this.formatTime(info.duration);

      // Populate edit fields
      document.getElementById('download-edit-fields')!.style.display = 'flex';
      (document.getElementById('input-custom-title') as HTMLInputElement).value = info.title;
      (document.getElementById('input-custom-artist') as HTMLInputElement).value = info.artist;

      (document.getElementById('btn-confirm-download') as HTMLButtonElement).disabled = false;
      (document.getElementById('btn-confirm-stream') as HTMLButtonElement).disabled = false;
      this.showToast('Media info fetched! Choose Stream or Download.');
    } catch (e: unknown) {
      this.showToast((e as Error).message || 'Failed to inspect media URL', 'error');
    } finally {
      inspectBtn.innerHTML = `<span>Inspect</span>`;
    }
  }

  private async handleStartDownload() {
    const url = (document.getElementById('input-download-url') as HTMLInputElement).value.trim();
    const custom_title = (document.getElementById('input-custom-title') as HTMLInputElement).value.trim();
    const custom_artist = (document.getElementById('input-custom-artist') as HTMLInputElement).value.trim();

    const confirmBtn = document.getElementById('btn-confirm-download') as HTMLButtonElement;
    const progressStatus = document.getElementById('download-progress-status')!;
    const progressText = document.getElementById('download-progress-text')!;

    confirmBtn.disabled = true;
    progressStatus.style.display = 'inline-flex';
    progressText.textContent = 'Extracting audio & storing in drive...';

    try {
      const res = await fetch(`${API_BASE}/api/extract`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ url, custom_title, custom_artist })
      });

      if (!res.ok) {
        const err = await res.json();
        throw new Error(err.detail || 'Audio download failed');
      }

      const result = await res.json();
      const newTrack: Track = result.track;

      // Add to top of list
      this.tracks.unshift(newTrack);
      this.renderTrackList();

      document.getElementById('modal-downloader')!.classList.remove('active');
      this.resetDownloaderModal();
      this.showToast(`"${newTrack.title}" added to your drive!`);

      // Auto play newly added track
      this.playTrack(0);
    } catch (e: unknown) {
      this.showToast((e as Error).message || 'Audio extraction failed', 'error');
      confirmBtn.disabled = false;
      progressStatus.style.display = 'none';
    }
  }

  private async handleStreamAndBookmark() {
    const url = (document.getElementById('input-download-url') as HTMLInputElement).value.trim();
    const custom_title = (document.getElementById('input-custom-title') as HTMLInputElement).value.trim();
    const custom_artist = (document.getElementById('input-custom-artist') as HTMLInputElement).value.trim();

    const streamBtn = document.getElementById('btn-confirm-stream') as HTMLButtonElement;
    const progressStatus = document.getElementById('download-progress-status')!;
    const progressText = document.getElementById('download-progress-text')!;

    streamBtn.disabled = true;
    progressStatus.style.display = 'inline-flex';
    progressText.textContent = 'Saving stream & adding to Favorites...';

    try {
      const res = await fetch(`${API_BASE}/api/bookmark`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ url, custom_title, custom_artist })
      });

      if (!res.ok) {
        const err = await res.json();
        throw new Error(err.detail || 'Failed to bookmark stream');
      }

      const result = await res.json();
      const newTrack: Track = result.track;

      // Add to tracks list
      this.tracks.unshift(newTrack);

      // Automatically add to Favorites so it's always ready to replay
      this.favorites.add(newTrack.id);
      localStorage.setItem('soundvault_favs', JSON.stringify(Array.from(this.favorites)));

      this.renderTrackList();
      document.getElementById('modal-downloader')!.classList.remove('active');
      this.resetDownloaderModal();
      this.showToast(`⚡ "${newTrack.title}" saved to Favorites! (0 Storage Used)`);

      // Auto play instantly
      this.playTrack(0);
    } catch (e: unknown) {
      this.showToast((e as Error).message || 'Failed to stream audio', 'error');
      streamBtn.disabled = false;
      progressStatus.style.display = 'none';
    }
  }
}

// Initialize Application
new MusicPlayerApp();
