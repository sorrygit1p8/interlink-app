import { useEffect, useState } from 'react';
import { AccessibilityInfo, Platform } from 'react-native';

// React Native Web 0.21 consumes aria-* state; native retains accessibilityState.
export function selectionAccessibility(selected: boolean, role: 'button' | 'tab' = 'button') {
  return {
    accessibilityState: { selected },
    ...(Platform.OS === 'web' ? role === 'tab' ? { 'aria-selected': selected } : { 'aria-pressed': selected } : {}),
  };
}

export function useReducedMotion() {
  // Avoid an animated first frame before the platform preference is known.
  const [reduced, setReduced] = useState(true);
  useEffect(() => {
    let alive = true;
    let changed = false;
    const subscription = AccessibilityInfo.addEventListener('reduceMotionChanged', value => {
      changed = true;
      if (alive) setReduced(value);
    });
    void AccessibilityInfo.isReduceMotionEnabled().then(value => {
      if (alive && !changed) setReduced(value);
    }).catch(() => { /* Keep motion reduced if the platform cannot report its setting. */ });
    return () => { alive = false; subscription?.remove(); };
  }, []);
  return reduced;
}
