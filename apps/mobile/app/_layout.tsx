import React, { useEffect } from 'react';
import { ActivityIndicator, View } from 'react-native';
import { StatusBar } from 'expo-status-bar';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { useFonts } from 'expo-font';
import { NotoSansKR_400Regular } from '@expo-google-fonts/noto-sans-kr/400Regular';
import { NotoSansKR_700Bold } from '@expo-google-fonts/noto-sans-kr/700Bold';
import { NotoSansKR_900Black } from '@expo-google-fonts/noto-sans-kr/900Black';
import * as SplashScreen from 'expo-splash-screen';
import { AppProvider } from '../src/runtime';
import { C } from '../src/ui';
import { AppNavigator } from '../src/app-navigator';
void SplashScreen.preventAutoHideAsync().catch(() => { });
export default function RootLayout() { const [loaded, error] = useFonts({ NotoSansKR_400Regular, NotoSansKR_700Bold, NotoSansKR_900Black }); useEffect(() => { if (loaded || error)
    void SplashScreen.hideAsync(); }, [loaded, error]); return <SafeAreaProvider style={{ flex: 1, backgroundColor: C.bg }}><StatusBar style="light"/>{!loaded && !error ? <View style={{ flex: 1, backgroundColor: C.bg, alignItems: 'center', justifyContent: 'center' }}><ActivityIndicator color={C.lime}/></View> : <AppProvider><AppNavigator /></AppProvider>}</SafeAreaProvider>; }
