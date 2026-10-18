import React, { ReactNode, useState } from 'react';
import { ActivityIndicator, Image, Pressable, ScrollView, StyleSheet, Text, TextInput, View, ViewStyle, KeyboardAvoidingView, Platform, RefreshControl, type TextProps } from 'react-native';
import Ionicons from '@expo/vector-icons/Ionicons';
import Svg, { Ellipse, Path, Rect } from 'react-native-svg';
import { router } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { selectionAccessibility } from './accessibility';
export const C = {
  bg: '#080A09', card: '#121512', raised: '#1B1F1A', lime: '#B7FF32',
  text: '#F3F5EF', muted: '#A4AD9D', line: '#2D322B', danger: '#FF9E91',
  tint: '#222D17', accentLine: '#587434', dangerSurface: '#261C19', dangerLine: '#513730',
};
export type IconName = React.ComponentProps<typeof Ionicons>['name'];
export function Icon({ name, size = 22, color = C.text }: {
    name: IconName;
    size?: number;
    color?: string;
}) { return <Ionicons name={name} size={size} color={color}/>; }
export function T({ children, style, muted = false, ...props }: TextProps & {
    muted?: boolean;
}) { const weight = Number(StyleSheet.flatten(style)?.fontWeight || 400); return <Text {...props} style={[s.text, muted && { color: C.muted }, style, { fontFamily: weight >= 900 ? 'NotoSansKR_900Black' : weight >= 600 ? 'NotoSansKR_700Bold' : 'NotoSansKR_400Regular' }]}>{children}</Text>; }
export function Ring({ size = 180, simple = false }: {
    size?: number;
    simple?: boolean;
}) {
    return <View accessible={false} accessibilityElementsHidden importantForAccessibility="no-hide-descendants">
      {simple ? <Svg width={size} height={size * .8} viewBox="0 0 240 192">
        <Ellipse cx="92" cy="82" rx="46" ry="65" transform="rotate(42 92 82)" fill="none" stroke={C.lime} strokeWidth="9"/>
        <Ellipse cx="147" cy="113" rx="46" ry="65" transform="rotate(42 147 113)" fill="none" stroke={C.lime} strokeWidth="9"/>
      </Svg> : <Image
        // Metro resolves this static asset for native bundles as well as the browser export.
        // eslint-disable-next-line @typescript-eslint/no-require-imports
        source={require('../assets/hero-rings.png')}
        style={{ width: size, height: size * .8 }}
        resizeMode="contain"
        accessible={false}
      />}
    </View>;
}
export function ChainMark({size=36}:{size?:number}) {
 return <View accessible={false} accessibilityElementsHidden importantForAccessibility="no-hide-descendants"><Svg width={size} height={size*.65} viewBox="0 0 56 36"><Rect x="3" y="8" width="29" height="20" rx="10" transform="rotate(-37 17.5 18)" fill="none" stroke={C.lime} strokeWidth="3.2"/><Rect x="24" y="8" width="29" height="20" rx="10" transform="rotate(-37 38.5 18)" fill="none" stroke={C.lime} strokeWidth="3.2"/><Path d="M29.481 9.846 A10 10 0 0 1 30.997 13.900 M25.003 22.100 A10 10 0 0 0 26.519 26.154" fill="none" stroke={C.bg} strokeWidth="6.4" strokeLinecap="butt"/><Path d="M28.754 8.864 A10 10 0 0 1 31.094 15.292 M24.906 20.708 A10 10 0 0 0 27.246 27.136" fill="none" stroke={C.lime} strokeWidth="3.2" strokeLinecap="butt"/></Svg></View>;
}
export function Logo() { return <View style={[s.row,{gap:7}]}><ChainMark size={32}/><T style={{ fontSize: 21, lineHeight: 32, fontWeight: '900', letterSpacing: -.8 }}>인터링크</T></View>; }
export function Button({ title, onPress, variant = 'primary', icon, disabled, busy, style }: {
    title: string;
    onPress: () => void;
    variant?: 'primary' | 'secondary' | 'ghost' | 'danger';
    icon?: IconName;
    disabled?: boolean;
    busy?: boolean;
    style?: ViewStyle;
}) {
    const color = variant === 'primary' ? C.bg : variant === 'danger' ? C.danger : C.text;
    return <Pressable accessibilityRole="button" accessibilityLabel={title} accessibilityState={{ disabled: !!disabled || !!busy, busy: !!busy }} aria-disabled={!!disabled || !!busy} aria-busy={!!busy} onPress={onPress} disabled={disabled || busy} style={({ pressed }) => [s.button, variant === 'primary' ? { backgroundColor: C.lime } : variant === 'ghost' ? { backgroundColor: 'transparent' } : variant === 'danger' ? { backgroundColor: C.dangerSurface, borderWidth: 1, borderColor: C.dangerLine } : { backgroundColor: C.raised, borderWidth: 1, borderColor: C.line }, (disabled || busy) && { opacity: .5 }, pressed && { opacity: .86 }, style]}>{busy ? <ActivityIndicator color={color}/> : icon ? <Icon name={icon} size={19} color={color}/> : null}<T style={{ color, fontWeight: '700', fontSize: 15, lineHeight: 23, letterSpacing: -.15, flexShrink: 1, textAlign: 'center' }}>{title}</T></Pressable>;
}
export function IconButton({ icon, label, onPress, color = C.text }: {
    icon: IconName;
    label: string;
    onPress: () => void;
    color?: string;
}) { return <Pressable accessibilityRole="button" accessibilityLabel={label} onPress={onPress} style={({ pressed }) => [s.iconButton, pressed && { backgroundColor: C.raised }]}><Icon name={icon} color={color}/></Pressable>; }
export function Tag({ children, active, onPress }: {
    children: ReactNode;
    active?: boolean;
    onPress?: () => void;
}) { const node = <T style={{ fontSize: 12, lineHeight: 20, fontWeight: active ? '700' : '400', color: active ? C.lime : C.muted }}>{children}</T>; return onPress ? <Pressable accessibilityRole="button" {...(active === undefined ? {} : selectionAccessibility(active))} onPress={onPress} style={({pressed})=>[s.tag, { minHeight: 48, paddingHorizontal: 16 }, active && s.activeTag, pressed&&{borderColor:C.accentLine,backgroundColor:C.tint}]}>{node}</Pressable> : <View style={[s.tag, active && s.activeTag]}>{node}</View>; }
export function Tags({ values, active = false }: {
    values: string[];
    active?: boolean;
}) { return <View style={s.wrap}>{values.map((v, i) => <Tag key={`${v}-${i}`} active={active}>{v}</Tag>)}</View>; }
export function Avatar({ name, avatar, size = 42, onPress }: {
    name: string;
    avatar?: string;
    size?: number;
    onPress?: () => void;
}) { const content = <View style={{ width: size, height: size, borderRadius: size * .5, backgroundColor: C.raised, alignItems: 'center', justifyContent: 'center', borderWidth: 1, borderColor: C.line }}>{avatar && ['orbit', 'spark', 'leaf', 'star'].includes(avatar) ? <Icon name={({ orbit: 'planet-outline', spark: 'flash-outline', leaf: 'leaf-outline', star: 'star-outline' } as const)[avatar as 'orbit' | 'spark' | 'leaf' | 'star']} size={size * .48} color={C.lime}/> : <T style={{ color: C.lime, fontWeight: '800', fontSize: size * .35, lineHeight: size * .65 }}>{name?.replace('가상 ', '').slice(0, 1) || 'I'}</T>}</View>; return onPress ? <Pressable accessibilityRole="button" accessibilityLabel="내 프로필 열기" onPress={onPress} style={{ minHeight: 48, minWidth: 48, alignItems: 'center', justifyContent: 'center' }}>{content}</Pressable> : content; }
export function Screen({ children, title, subtitle, back = true, right, refreshing, onRefresh, scroll = true, footer }: {
    children: ReactNode;
    title?: string;
    subtitle?: string;
    back?: boolean;
    right?: ReactNode;
    refreshing?: boolean;
    onRefresh?: () => void;
    scroll?: boolean;
    footer?: ReactNode;
}) {
    const insets = useSafeAreaInsets();
    const content = <View style={[s.page, scroll ? { paddingBottom: footer ? 24 : Math.max(insets.bottom + 16, 32) } : { flex: 1, minHeight: 0, paddingBottom: footer ? 0 : Math.max(insets.bottom, 8) }]}>{title && <View style={s.screenHeader}>{back && <IconButton icon="arrow-back" label="뒤로가기" onPress={() => router.canGoBack() ? router.back() : router.replace('/')}/>}<View style={{ flex: 1, minWidth: 0 }}><T accessibilityRole="header" style={s.title}>{title}</T>{subtitle && <T muted style={{ fontSize: 12, lineHeight: 19, marginTop: 3 }}>{subtitle}</T>}</View>{right}</View>}{children}</View>;
    return <KeyboardAvoidingView style={{ flex: 1, minHeight: 0, backgroundColor: C.bg, paddingTop: insets.top }} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
      {scroll ? <ScrollView style={{ flex: 1 }} contentContainerStyle={{ flexGrow: 1 }} keyboardShouldPersistTaps="handled" keyboardDismissMode="on-drag" showsVerticalScrollIndicator={false} refreshControl={onRefresh ? <RefreshControl refreshing={!!refreshing} onRefresh={onRefresh} tintColor={C.lime} colors={[C.lime]}/> : undefined}>{content}</ScrollView> : content}
      {footer && <View style={{ backgroundColor: C.bg, borderTopWidth: 1, borderTopColor: C.line, paddingBottom: Math.max(insets.bottom, 12), paddingTop: 12 }}><View style={{ width: '100%', maxWidth: 620, alignSelf: 'center', paddingHorizontal: 20 }}>{footer}</View></View>}
    </KeyboardAvoidingView>;
}
export function Panel({ children, style }: {
    children: ReactNode;
    style?: ViewStyle;
}) { return <View style={[s.panel, style]}>{children}</View>; }
export function Section({ title, label, action, children, spacing = 24 }: {
    title: string;
    label?: string;
    action?: () => void;
    children?: ReactNode;
    spacing?: number;
}) { return <View style={{ marginTop: spacing }}><View style={[s.between, { marginBottom: 12 }]}><T accessibilityRole="header" style={{ fontSize: 20, fontWeight: '700', letterSpacing: -.5, lineHeight: 28, flexShrink: 1, marginRight: 10 }}>{title}</T>{label && action && <Pressable accessibilityRole="button" accessibilityLabel={label} onPress={action} style={{ minHeight: 48, minWidth: 48, flexDirection: 'row', alignItems: 'center', justifyContent: 'flex-end', gap: 4 }}><T muted style={{ fontSize: 12 }}>{label}</T><Icon name="chevron-forward" color={C.muted} size={15}/></Pressable>}</View>{children}</View>; }
export function Field({ label, error, hint, onFocus, onBlur, style, ...props }: React.ComponentProps<typeof TextInput> & {
    label: string;
    error?: string;
    hint?: string;
}) { const [focused,setFocused]=useState(false);return <View style={{ gap: 8, marginBottom: 24 }}><T style={{ fontSize: 14, fontWeight: '700' }}>{label}</T><TextInput {...props} accessibilityLabel={label} accessibilityHint={error || hint} placeholderTextColor={C.muted} selectionColor={C.lime} onFocus={event=>{setFocused(true);onFocus?.(event);}} onBlur={event=>{setFocused(false);onBlur?.(event);}} style={[s.input, {fontFamily:'NotoSansKR_400Regular'}, props.multiline && { minHeight: 118, textAlignVertical: 'top', paddingTop: 14, paddingBottom: 14 }, focused&&{borderColor:'#87A660',backgroundColor:C.card}, error && { borderColor: C.danger },style]}/>{error ? <T accessibilityRole="alert" style={{ color: C.danger, fontSize: 12, lineHeight: 19 }}>{error}</T> : hint ? <T muted style={{ fontSize: 12, lineHeight: 19 }}>{hint}</T> : null}</View>; }
export function Empty({ title, text, icon = 'planet-outline', action, actionLabel }: {
    title: string;
    text: string;
    icon?: IconName;
    action?: () => void;
    actionLabel?: string;
}) { return <View style={{ paddingVertical: 40, paddingHorizontal: 8, alignItems: 'center', gap: 12 }}><View style={{ backgroundColor: C.raised, padding: 20, borderRadius: 24, borderWidth: 1, borderColor: C.line }}><Icon name={icon} color={C.lime} size={30}/></View><T style={{ fontWeight: '700', fontSize: 20, lineHeight: 28, marginTop: 4, textAlign: 'center' }}>{title}</T><T muted style={{ textAlign: 'center', fontSize: 14, lineHeight: 24, maxWidth: 310 }}>{text}</T>{action && <Button title={actionLabel || '다시 시도'} onPress={action} variant="secondary" style={{ marginTop: 8 }}/>}</View>; }
export function Loading() { return <View accessibilityLabel="불러오는 중" style={{ padding: 60, alignItems: 'center' }}><ActivityIndicator color={C.lime}/><T muted style={{ marginTop: 12, fontSize: 12 }}>연결을 준비하고 있어요</T></View>; }
export function LoadMore({query,label='더 불러오기'}:{query:{hasNextPage:boolean;isFetchingNextPage:boolean;fetchNextPage:()=>Promise<unknown>};label?:string}) { return query.hasNextPage ? <Button title={label} variant="secondary" busy={query.isFetchingNextPage} icon="arrow-down-outline" onPress={()=>void query.fetchNextPage()} style={{marginTop:12,marginBottom:8}}/> : null; }
export function ErrorState({ error, retry }: {
    error: unknown;
    retry?: () => void;
}) { return <Empty icon="cloud-offline-outline" title="잠시 연결이 어려워요" text={error instanceof Error ? error.message : '요청을 처리하지 못했어요. 다시 시도해 주세요.'} action={retry}/>; }
export function Divider() { return <View style={{ height: 1, backgroundColor: C.line, marginVertical: 20 }}/>; }
export function RowLink({ title, subtitle, icon, onPress, danger }: {
    title: string;
    subtitle?: string;
    icon?: IconName;
    onPress: () => void;
    danger?: boolean;
}) { return <Pressable accessibilityRole="button" accessibilityLabel={title} onPress={onPress} style={({ pressed }) => [s.between, { minHeight: 56, paddingVertical: 16, borderBottomWidth: 1, borderColor: C.line, gap: 12, opacity: pressed ? .72 : 1 }]}>{icon && <Icon name={icon} size={21} color={danger ? C.danger : C.muted}/>}<View style={{ flex: 1, minWidth: 0 }}><T style={{ fontSize: 14, lineHeight: 24, fontWeight: '400', color: danger ? C.danger : C.text }}>{title}</T>{subtitle && <T muted style={{ fontSize: 12, lineHeight: 20, marginTop: 4 }}>{subtitle}</T>}</View><Icon name="chevron-forward" size={17} color={C.muted}/></Pressable>; }
export const s = StyleSheet.create({
    text: { color: C.text, fontSize: 14, lineHeight: 24 },
    row: { flexDirection: 'row', alignItems: 'center', gap: 8 },
    between: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
    wrap: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
    page: { width: '100%', maxWidth: 620, alignSelf: 'center', paddingHorizontal: 20, flexGrow: 1 },
    title: { fontSize: 22, fontWeight: '700', letterSpacing: -.5, lineHeight: 32 },
    screenHeader: { flexDirection: 'row', alignItems: 'center', gap: 8, paddingTop: 8, marginBottom: 24, minHeight: 64 },
    panel: { borderRadius: 20, backgroundColor: C.card, borderWidth: 1, borderColor: C.line, padding: 20 },
    button: { minHeight: 52, minWidth: 48, paddingHorizontal: 20, paddingVertical: 12, borderRadius: 16, flexDirection: 'row', justifyContent: 'center', alignItems: 'center', gap: 8 },
    iconButton: { minHeight: 48, minWidth: 48, borderRadius: 16, alignItems: 'center', justifyContent: 'center' },
    tag: { borderWidth: 1, borderColor: C.line, borderRadius: 24, backgroundColor: C.card, paddingHorizontal: 10, paddingVertical: 4, alignItems: 'center', justifyContent: 'center' },
    activeTag: { borderColor: C.accentLine, backgroundColor: C.tint },
    input: { backgroundColor: C.card, color: C.text, fontSize: 15, borderWidth: 1, borderColor: '#353C32', borderRadius: 16, minHeight: 56, paddingHorizontal: 16 },
    eyebrow: { fontSize: 10, fontWeight: '700', letterSpacing: 2, color: C.lime },
    body: { fontSize: 14, lineHeight: 24, color: C.muted }
});
