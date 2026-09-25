import type { CapacitorConfig } from '@capacitor/cli';

const config: CapacitorConfig = {
  appId: 'com.soundvault.app',
  appName: 'poori',
  webDir: 'dist',
  server: {
    androidScheme: 'https',
    allowNavigation: [
      'https://cloud-music-player-wzd5.onrender.com',
      'https://kgtlhjwsheiholowfebj.supabase.co',
      'https://i.ytimg.com',
    ],
  },
  android: {
    backgroundColor: '#0A0A0A',
    allowMixedContent: false,
  },
};

export default config;

