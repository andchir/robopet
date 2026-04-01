import type { CapacitorConfig } from '@capacitor/cli';

const config: CapacitorConfig = {
  appId: 'com.robopet.app',
  appName: 'RoboPet',
  webDir: 'www',
  server: {
    cleartext: true,
  },
};

export default config;
