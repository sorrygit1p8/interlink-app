import type { ConfigContext, ExpoConfig } from 'expo/config';

export default ({ config }: ConfigContext): ExpoConfig => {
 const environment = process.env.EXPO_PUBLIC_APP_ENV || 'development';
 const mode = process.env.EXPO_PUBLIC_DATA_MODE || 'demo';
 const androidPackage = process.env.INTERLINK_ANDROID_PACKAGE || 'dev.interlink.demo';
 const iosBundle = process.env.INTERLINK_IOS_BUNDLE_ID || 'dev.interlink.demo';
 if (!['demo','supabase'].includes(mode)) throw new Error('EXPO_PUBLIC_DATA_MODE must be demo or supabase.');
 if (!['development','staging','production'].includes(environment)) throw new Error('EXPO_PUBLIC_APP_ENV is invalid.');
 if (environment === 'production') {
  if (mode !== 'supabase') throw new Error('Production cannot include demo mode.');
  if (!process.env.INTERLINK_ANDROID_PACKAGE || !process.env.INTERLINK_IOS_BUNDLE_ID || /example|demo/i.test(androidPackage + iosBundle)) throw new Error('Set user-owned production application identifiers.');
  if (!process.env.EXPO_PUBLIC_SUPABASE_URL || !process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY) throw new Error('Production backend public configuration is missing.');
 }
 return {
  ...config, name: mode === 'demo' ? '인터링크 · 데모' : '인터링크', slug: 'interlink', version: '0.1.5',
  scheme: 'interlink', userInterfaceStyle: 'dark', icon: './assets/icon.png',
  orientation: 'default', backgroundColor: '#070807',
  ios: { bundleIdentifier: iosBundle, buildNumber: '1', supportsTablet: true, infoPlist: { ITSAppUsesNonExemptEncryption: false } },
  android: { package: androidPackage, versionCode: 6, adaptiveIcon: { foregroundImage: './assets/adaptive-icon.png', backgroundColor: '#070807' }, permissions: ['android.permission.POST_NOTIFICATIONS'], blockedPermissions: ['android.permission.SYSTEM_ALERT_WINDOW','android.permission.RECORD_AUDIO','android.permission.READ_CONTACTS','android.permission.ACCESS_FINE_LOCATION','android.permission.ACCESS_COARSE_LOCATION','android.permission.READ_MEDIA_IMAGES','android.permission.READ_MEDIA_VIDEO','android.permission.READ_EXTERNAL_STORAGE','android.permission.WRITE_EXTERNAL_STORAGE'] },
  web: { bundler: 'metro', output: 'single', favicon: './assets/icon.png', name: '인터링크 · Inter-Link', themeColor: '#070807', backgroundColor: '#070807' },
  plugins: ['expo-router','expo-font','expo-secure-store',['expo-splash-screen',{image:'./assets/splash.png',imageWidth:160,backgroundColor:'#070807'}],['expo-notifications',{color:'#B7FF32',defaultChannel:'team-updates'}]],
  experiments: { typedRoutes: false },
  extra: { dataMode: mode, appEnvironment: environment, buildLabel: environment+'/'+mode, ...(process.env.EXPO_PUBLIC_EAS_PROJECT_ID ? { eas: { projectId: process.env.EXPO_PUBLIC_EAS_PROJECT_ID } } : {}) },
 };
};
