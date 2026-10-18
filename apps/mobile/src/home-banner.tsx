import React, { useCallback, useEffect, useId, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { AccessibilityInfo, Animated, Easing, PanResponder, Platform, Pressable, StyleSheet, View, useWindowDimensions } from 'react-native';
import Svg, { Defs, Ellipse, G, LinearGradient, Path, RadialGradient, Stop } from 'react-native-svg';
import { C, Icon, T } from './ui';

const banners = [
  { purpose: '공모전', title: '함께 도전할', emphasis: '공모전 팀', action: '공모전 모집글 모아보기' },
  { purpose: '캡스톤', title: '아이디어를 완성할', emphasis: '캡스톤 팀', action: '캡스톤 팀 찾아보기' },
  { purpose: '조별과제', title: '우리 수업에 맞는', emphasis: '조별과제', action: '조별과제 모집글 보기' },
] as const;
const count = banners.length;
const wrap = (index: number) => (index + count) % count;
const slots = [-1, 0, 1] as const;

// The campaign illustration is separate from the Interlink chain logo.
// Vector bands keep the reference's matte black and lime material at every size.
function BannerArtwork({ size, variant }: { size: number; variant: number }) {
  const id = useId().replace(/:/g, '');
  const band = 'M 0 -83 A 54 83 0 1 1 0 83 A 54 83 0 1 1 0 -83 Z M 0 -65 A 35 65 0 1 0 0 65 A 35 65 0 1 0 0 -65 Z';
  return <Svg width={size} height={size} viewBox="0 0 260 240" accessible={false}>
    <Defs>
      <RadialGradient id={`${id}-halo`} cx="50%" cy="50%" rx="50%" ry="50%">
        <Stop offset="0" stopColor="#A9F52F" stopOpacity=".19" />
        <Stop offset=".5" stopColor="#789F22" stopOpacity=".07" />
        <Stop offset="1" stopColor="#789F22" stopOpacity="0" />
      </RadialGradient>
      <LinearGradient id={`${id}-back`} x1="0%" y1="0%" x2="100%" y2="100%">
        <Stop offset="0" stopColor="#080C08" /><Stop offset=".43" stopColor="#111B0D" />
        <Stop offset=".7" stopColor="#82BE24" /><Stop offset=".87" stopColor="#CBFF5B" />
        <Stop offset="1" stopColor="#293915" />
      </LinearGradient>
      <LinearGradient id={`${id}-front`} x1="0%" y1="5%" x2="100%" y2="95%">
        <Stop offset="0" stopColor="#182217" /><Stop offset=".28" stopColor="#060A07" />
        <Stop offset=".6" stopColor="#090F07" /><Stop offset=".83" stopColor="#87BD30" />
        <Stop offset="1" stopColor="#C3FA55" />
      </LinearGradient>
      <LinearGradient id={`${id}-edge`} x1="0%" y1="0%" x2="100%" y2="100%">
        <Stop offset="0" stopColor="#52654A" /><Stop offset=".42" stopColor="#17220F" />
        <Stop offset=".76" stopColor="#A9E344" /><Stop offset="1" stopColor="#597826" />
      </LinearGradient>
    </Defs>
    <Ellipse cx="146" cy="140" rx="114" ry="91" fill={`url(#${id}-halo)`} />
    <G transform={`rotate(${variant === 1 ? -8 : variant === 2 ? 7 : 0} 130 120)`}>
      <G transform="translate(164 139) rotate(34)">
        <Path d={band} fill={`url(#${id}-back)`} fillRule="evenodd" stroke={`url(#${id}-edge)`} strokeWidth="1" />
        <Ellipse cx="0" cy="0" rx="35" ry="65" fill="none" stroke="#8DBD3A" strokeOpacity=".42" strokeWidth="1" />
      </G>
      <G transform="translate(105 105) rotate(34)">
        <Path d={band} fill={`url(#${id}-front)`} fillRule="evenodd" stroke={`url(#${id}-edge)`} strokeWidth="1.2" />
        <Path d="M 0 -65 A 35 65 0 0 1 17 57" fill="none" stroke="#CBFF74" strokeOpacity=".58" strokeWidth="1" />
      </G>
    </G>
  </Svg>;
}

export function HomeBanner({ onOpen }: { onOpen: (purpose: string) => void }) {
  const window = useWindowDimensions();
  const [viewportWidth, setViewportWidth] = useState(Math.min(window.width, 620));
  const [index, setIndex] = useState(0);
  const offset = useRef(new Animated.Value(0)).current;
  const animating = useRef(false);
  const dragged = useRef(false);
  const reducedMotion = useRef(false);
  const cardWidth = Math.max(220, viewportWidth - 56);
  const pitch = cardWidth + 12;
  const cardHeight = Math.round(Math.max(174, Math.min(244, cardWidth * .534)));
  const compact = viewportWidth < 390;
  const largeText = window.fontScale > 1.15;
  const height = largeText ? cardHeight + 36 : cardHeight;

  useEffect(() => {
    let mounted = true;
    void AccessibilityInfo.isReduceMotionEnabled().then(value => { if (mounted) reducedMotion.current = value; });
    const listener = AccessibilityInfo.addEventListener('reduceMotionChanged', value => { reducedMotion.current = value; });
    return () => { mounted = false; listener.remove(); offset.stopAnimation(); };
  }, [offset]);

  // Recenter the three reusable cards in the same commit as the content update.
  // The viewport never runs into a finite first/last slide or retains a partial offset.
  useLayoutEffect(() => {
    offset.stopAnimation();
    offset.setValue(0);
    animating.current = false;
    dragged.current = false;
  }, [index, pitch, offset]);

  const settle = useCallback((direction: -1 | 0 | 1) => {
    if (animating.current) return;
    animating.current = true;
    const finish = () => {
      if (direction) setIndex(value => wrap(value + direction));
      else { offset.setValue(0); animating.current = false; dragged.current = false; }
    };
    if (reducedMotion.current) { finish(); return; }
    Animated.timing(offset, {
      toValue: -direction * pitch,
      duration: direction ? 240 : 180,
      easing: Easing.out(Easing.cubic),
      useNativeDriver: Platform.OS !== 'web',
    }).start(({ finished }) => { if (finished) finish(); });
  }, [offset, pitch]);

  const pan = useMemo(() => PanResponder.create({
    onStartShouldSetPanResponder: () => false,
    onMoveShouldSetPanResponder: (_, gesture) => !animating.current && Math.abs(gesture.dx) > 8 && Math.abs(gesture.dx) > Math.abs(gesture.dy) * 1.2,
    onMoveShouldSetPanResponderCapture: (_, gesture) => !animating.current && Math.abs(gesture.dx) > 8 && Math.abs(gesture.dx) > Math.abs(gesture.dy) * 1.2,
    onPanResponderGrant: () => { dragged.current = true; offset.stopAnimation(); },
    onPanResponderMove: (_, gesture) => offset.setValue(Math.max(-pitch, Math.min(pitch, gesture.dx))),
    onPanResponderRelease: (_, gesture) => {
      const moved = Math.abs(gesture.dx) >= Math.min(64, pitch * .18);
      const flicked = Math.abs(gesture.dx) > 24 && Math.abs(gesture.vx) > .55;
      settle(moved || flicked ? gesture.dx < 0 ? 1 : -1 : 0);
    },
    onPanResponderTerminationRequest: () => false,
    onPanResponderTerminate: () => settle(0),
  }), [offset, pitch, settle]);

  const keyProps: Pick<React.ComponentProps<typeof Pressable>, 'onKeyDown'> = Platform.OS === 'web' ? {
    onKeyDown: event => {
      const key = event.nativeEvent.key;
      if (key === 'ArrowRight' || key === 'ArrowLeft') {
        event.preventDefault();
        settle(key === 'ArrowRight' ? 1 : -1);
      }
    },
  } : {};

  return <View style={styles.section}>
    <View testID="home-banner-carousel" style={[styles.viewport, { height }, Platform.OS === 'web' && { touchAction: 'pan-y' } as object]}
      onLayout={event => { const width = event.nativeEvent.layout.width; if (width > 0) setViewportWidth(width); }} {...pan.panHandlers}>
      <Animated.View style={[styles.track, { left: 20 - pitch, width: pitch * 3, height, transform: [{ translateX: offset }] }]}>
        {slots.map(slot => {
          const itemIndex = wrap(index + slot);
          const banner = banners[itemIndex];
          const active = slot === 0;
          return <View key={slot} style={{ width: pitch, height }} pointerEvents={active ? 'auto' : 'none'}
            accessibilityElementsHidden={!active} importantForAccessibility={active ? 'auto' : 'no-hide-descendants'} aria-hidden={!active}>
            <Pressable testID={active ? 'home-banner-active' : undefined} accessibilityRole="button" accessibilityLabel={banner.action}
              accessibilityHint="해당 목적의 팀 모집글을 볼 수 있어요. 배너는 좌우로 넘길 수 있어요."
              accessible={active} focusable={active} {...keyProps}
              onPress={() => { if (!dragged.current && !animating.current) onOpen(banner.purpose); }}
              style={({ pressed }) => [styles.card, { width: cardWidth, height, padding: compact ? 20 : 22, opacity: pressed && !dragged.current ? .86 : 1 }]}>
              <View pointerEvents="none" accessible={false} accessibilityElementsHidden importantForAccessibility="no-hide-descendants"
                style={{ position: 'absolute', right: compact ? 1 : 8, top: compact ? 28 : 24, opacity: largeText ? .45 : .9 }}>
                <BannerArtwork size={Math.min(208, cardWidth * .49)} variant={itemIndex} />
              </View>
              <View style={{ alignItems: 'flex-start' }}>
                <T style={{ fontSize: compact ? 20 : 22, lineHeight: compact ? 28 : 30, fontWeight: '700', letterSpacing: -.7 }}>{banner.title}</T>
                <T style={{ fontSize: compact ? 39 : 44, lineHeight: compact ? 49 : 55, fontWeight: '900', letterSpacing: -1.3, color: C.lime }}>{banner.emphasis}</T>
              </View>
              <View>
                <View style={styles.action}><T style={{ fontSize: compact ? 11 : 12, lineHeight: 20, color: '#CFD5C8', flexShrink: 1 }}>{banner.action}</T><Icon name="arrow-forward" size={15} color="#CFD5C8" /></View>
                <T style={{ fontSize: 11, lineHeight: 18, color: C.muted, marginTop: compact ? 8 : 12 }}><T style={{ color: '#B8D482', fontSize: 11 }}>{itemIndex + 1}</T> / {count}</T>
              </View>
            </Pressable>
          </View>;
        })}
      </Animated.View>
    </View>
    <Pressable testID="home-banner-pager" accessibilityRole="button" accessibilityLabel={`추천 배너 ${index + 1} / ${count}, 다음 배너 보기`}
      accessibilityHint="누르면 다음 배너로 이동해요. 이전·다음 배너 동작도 사용할 수 있어요."
      accessibilityActions={[{ name: 'increment', label: '다음 배너' }, { name: 'decrement', label: '이전 배너' }]}
      onAccessibilityAction={event => settle(event.nativeEvent.actionName === 'decrement' ? -1 : 1)}
      onPress={() => settle(1)} {...keyProps} style={({ pressed }) => [styles.pager, pressed && { opacity: .65 }]}>
      {banners.map((banner, position) => <View key={banner.purpose} style={[styles.dot, { backgroundColor: position === index ? C.lime : '#343A30' }]} />)}
    </Pressable>
  </View>;
}

const styles = StyleSheet.create({
  section: { marginTop: 16, marginHorizontal: -20, marginBottom: 0 },
  viewport: { overflow: 'hidden' },
  track: { position: 'absolute', top: 0, flexDirection: 'row' },
  card: { borderRadius: 20, borderWidth: 1, borderColor: '#30392A', backgroundColor: '#0B0F0A', overflow: 'hidden', justifyContent: 'space-between' },
  action: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  pager: { height: 48, minWidth: 80, alignSelf: 'center', flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8 },
  dot: { width: 6, height: 6, borderRadius: 3 },
});
