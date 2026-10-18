import React from 'react';
import { Stack } from 'expo-router';
import { useQuery } from '@tanstack/react-query';
import { AppError } from '@interlink/shared';
import { useRuntime } from './runtime';
import { C, ErrorState, Loading, Screen } from './ui';
import { useReducedMotion } from './accessibility';

// Include every application route so cold links also respect first-time setup.
// This controls the setup flow; server authorization remains in the data layer.
const applicationScreens = [
  '(tabs)', 'account-delete', 'applications/[id]', 'apply/[id]', 'auth', 'blocked',
  'chat/[id]', 'community', 'experience', 'invite/[id]', 'legal', 'notification-settings',
  'notifications', 'person/[id]', 'profile/index', 'profile/edit', 'project/[id]',
  'project/edit', 'project/new', 'report', 'saved', 'settings', 'team/[id]', '+not-found',
] as const;

export function AppNavigator() {
  const { client, actor, sessionUser } = useRuntime();
  const enabled = client.mode === 'demo' || !!sessionUser;
  // Navigation reads the persisted profile independently of demo-only screen
  // errors, keeping Settings and its recovery controls mounted and reachable.
  const boot = useQuery({
    queryKey: [client.mode, client.mode === 'demo' ? actor : sessionUser, 'bootstrap', {}, 'normal'],
    queryFn: ({ signal }) => client.query('bootstrap', {}, { signal }),
    enabled, staleTime: 15000,
    retry: (count, error) => count < 1 && error instanceof AppError && error.retryable,
  });
  const reducedMotion = useReducedMotion();
  if (enabled && boot.isLoading) return <Screen back={false}><Loading /></Screen>;
  if (enabled && boot.error && !boot.data) return <Screen back={false}><ErrorState error={boot.error} retry={() => void boot.refetch()} /></Screen>;
  const needsSetup = boot.data?.viewer?.status === 'active' && boot.data.viewer.onboardingCompleted !== true;
  return <Stack screenOptions={{ headerShown: false, contentStyle: { backgroundColor: C.bg }, animation: reducedMotion ? 'none' : 'fade_from_bottom' }}>
    <Stack.Protected guard={!needsSetup} redirectTo="/onboarding">
      {applicationScreens.map(name => <Stack.Screen key={name} name={name} />)}
    </Stack.Protected>
    <Stack.Protected guard={needsSetup} redirectTo="/">
      <Stack.Screen name="onboarding" options={{ gestureEnabled: false, animation: 'none' }} />
    </Stack.Protected>
  </Stack>;
}
