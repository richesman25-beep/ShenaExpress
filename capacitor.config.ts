import type { CapacitorConfig } from '@capacitor/cli';

const config: CapacitorConfig = {
  appId: 'com.shenaexpress.client',
  appName: 'SHENA Express',
  webDir: 'dist',
  server: { androidScheme: 'https' },
  android: { backgroundColor: '#0f2342' },
};

export default config;
