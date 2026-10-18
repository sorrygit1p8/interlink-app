import { Platform } from 'react-native';
import * as SecureStore from 'expo-secure-store';
import * as Device from 'expo-device';
import type { SupabaseDataClient } from '@interlink/data';
import { AppError } from '@interlink/shared';
const tokenKey = 'interlink.push.token';
export async function registerPush(client: SupabaseDataClient): Promise<void> {
    if (Platform.OS === 'web' || !Device.isDevice)
        throw new AppError('UNAVAILABLE', '기기 푸시는 Android 또는 iPhone 실기기에서 설정해 주세요.');
    if (!await client.getSession())
        throw new AppError('UNAUTHENTICATED');
    const projectId = process.env.EXPO_PUBLIC_EAS_PROJECT_ID;
    if (!projectId)
        throw new AppError('CONFIGURATION', '푸시 연결을 위한 EAS 프로젝트 설정이 필요해요.');
    const Notifications = await import('expo-notifications');
    if (Platform.OS === 'android')
        await Notifications.setNotificationChannelAsync('team-updates', { name: '팀 활동', importance: Notifications.AndroidImportance.DEFAULT, lockscreenVisibility: Notifications.AndroidNotificationVisibility.PRIVATE });
    const existing = await Notifications.getPermissionsAsync();
    const permission = existing.granted ? existing : await Notifications.requestPermissionsAsync();
    if (!permission.granted)
        throw new AppError('FORBIDDEN', '알림 권한이 허용되지 않았어요. 기기 설정에서 변경할 수 있어요. 앱 안의 알림은 계속 확인할 수 있어요.');
    const token = (await Notifications.getExpoPushTokenAsync({ projectId })).data;
    const old = await SecureStore.getItemAsync(tokenKey);
    if (old && old !== token)
        await client.command('device.unregister', { token: old });
    await client.command('device.register', { token, platform: Platform.OS === 'ios' ? 'ios' : 'android' });
    await SecureStore.setItemAsync(tokenKey, token);
}
export async function logout(client: SupabaseDataClient): Promise<void> {
    const token = Platform.OS === 'web' ? null : await SecureStore.getItemAsync(tokenKey);
    await client.signOut(token || undefined);
    if (Platform.OS !== 'web')
        await SecureStore.deleteItemAsync(tokenKey);
}
/** Attach only in real mode. Does not request permission on app launch. */
export async function attachPushListeners(client: SupabaseDataClient, openProject: (id: string) => void, onFailure: () => void): Promise<() => void> {
    if (Platform.OS === 'web')
        return () => { };
    const Notifications = await import('expo-notifications');
    const handled = new Set<string>();
    const handleResponse = (event: import('expo-notifications').NotificationResponse) => {
        const identifier = event.notification.request.identifier;
        if (handled.has(identifier)) return;
        const id = event.notification.request.content.data?.projectId;
        if (typeof id === 'string' && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(id)) {
            handled.add(identifier); openProject(id);
            void Notifications.clearLastNotificationResponseAsync().catch(onFailure);
        }
    };
    const response = Notifications.addNotificationResponseReceivedListener(handleResponse);
    const coldStart = await Notifications.getLastNotificationResponseAsync().catch(()=>{onFailure();return null;});
    if (coldStart) handleResponse(coldStart);
    const tokenListener = Notifications.addPushTokenListener(() => { void SecureStore.getItemAsync(tokenKey).then(token => token ? registerPush(client) : undefined).catch(onFailure); });
    return () => { response.remove(); tokenListener.remove(); };
}
