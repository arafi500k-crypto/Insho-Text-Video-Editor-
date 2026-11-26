export interface CapacitorConfig {
  appId: string;
  appName: string;
  webDir: string;
  server: {
    androidScheme: 'https' | 'http';
    cleartext?: boolean;
  };
  android: {
    backgroundColor: string;
    allowMixedContent: boolean;
  };
}

const config: CapacitorConfig = {
  appId: 'com.inshotext.editor',
  appName: 'Insho Text',
  webDir: 'dist',
  server: {
    androidScheme: 'https',
  },
  android: {
    backgroundColor: '#08080b',
    allowMixedContent: false,
  },
};

export default config;
