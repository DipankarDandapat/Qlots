const production = process.env.APP_ENV === 'production';

export default {
  expo: {
    name: 'Qlots',
    slug: 'qlots-financial-health',
    version: '0.1.0',
    orientation: 'portrait',
    userInterfaceStyle: 'light',
    scheme: 'qlots',
    newArchEnabled: true,
    icon: './assets/icon.png',
    plugins: ['expo-secure-store', 'expo-sharing'],
    android: {
      package: 'com.qlots.app',
      versionCode: 1,
      usesCleartextTraffic: !production,
      icon: './assets/icon.png',
      adaptiveIcon: {
        foregroundImage: './assets/icon.png',
        backgroundColor: '#0D2B1E',
      },
    },
    ios: { supportsTablet: true, bundleIdentifier: 'com.qlots.app' },
    extra: { apiUrl: process.env.EXPO_PUBLIC_API_URL || 'https://qlots.onrender.com' },
  },
};
