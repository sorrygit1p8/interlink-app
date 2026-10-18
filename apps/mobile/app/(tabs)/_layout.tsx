import React from 'react';
import { View, useWindowDimensions } from 'react-native';
import { Tabs } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { C, Icon, type IconName } from '../../src/ui';
import { useData } from '../../src/runtime';

function TabIcon({ name, focused, color }: { name: IconName; focused: boolean; color: string }) {
  return <View style={{ width: 52, height: 32, borderRadius: 16, alignItems: 'center', justifyContent: 'center', backgroundColor: focused ? C.tint : 'transparent' }}>
    <Icon name={name} size={24} color={color} />
  </View>;
}

export default function TabsLayout() {
  const insets = useSafeAreaInsets();
  const { fontScale } = useWindowDimensions();
  const boot = useData('bootstrap', {});
  const unread = boot.data?.messageUnreadCount || 0;
  const bottom = Math.max(insets.bottom, 9);
  return <Tabs screenOptions={{
    headerShown: false,
    tabBarHideOnKeyboard: true,
    tabBarActiveTintColor: C.lime,
    tabBarInactiveTintColor: C.muted,
    tabBarStyle: {
      backgroundColor: C.bg, borderTopColor: C.line,
      paddingTop: 8, paddingBottom: bottom,
      height: 64 + bottom + Math.max(0, fontScale - 1) * 18,
    },
    tabBarLabelStyle: { fontSize: 11, lineHeight: 16, fontFamily: 'NotoSansKR_700Bold', marginTop: 4 },
    tabBarItemStyle: { minHeight: 48 },
  }}>
    <Tabs.Screen name="index" options={{ title: '홈', tabBarIcon: ({ color, focused }) => <TabIcon name={focused ? 'home' : 'home-outline'} focused={focused} color={typeof color === 'string' ? color : C.muted} /> }} />
    <Tabs.Screen name="explore" options={{ title: '팀 찾기', tabBarIcon: ({ color, focused }) => <TabIcon name={focused ? 'compass' : 'compass-outline'} focused={focused} color={typeof color === 'string' ? color : C.muted} /> }} />
    <Tabs.Screen name="teams" options={{ title: '내 활동', tabBarIcon: ({ color, focused }) => <TabIcon name={focused ? 'people' : 'people-outline'} focused={focused} color={typeof color === 'string' ? color : C.muted} /> }} />
    <Tabs.Screen name="messages" options={{
      title: '채팅', tabBarBadge: unread ? unread > 99 ? '99+' : unread : undefined,
      tabBarBadgeStyle: { backgroundColor: C.lime, color: C.bg, fontSize: 10, fontWeight: '700' },
      tabBarIcon: ({ color, focused }) => <TabIcon name={focused ? 'chatbubbles' : 'chatbubbles-outline'} focused={focused} color={typeof color === 'string' ? color : C.muted} />,
    }} />
    <Tabs.Screen name="me" options={{ title: '내 정보', tabBarIcon: ({ color, focused }) => <TabIcon name={focused ? 'person' : 'person-outline'} focused={focused} color={typeof color === 'string' ? color : C.muted} /> }} />
  </Tabs>;
}
