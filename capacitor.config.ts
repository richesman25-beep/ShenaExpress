import type { CapacitorConfig } from '@capacitor/cli';

const config: CapacitorConfig = {
  appId: 'com.shenaexpress.client',
  appName: 'SHENA Express',
  webDir: 'dist',
  server: { androidScheme: 'https' },
  android: {
    backgroundColor: '#0f2342',
    // Android 15 : garder l'interface hors des barres système et de l'encoche.
    adjustMarginsForEdgeToEdge: 'auto',
  },
};

export default config;
