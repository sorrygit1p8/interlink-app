import React, { useCallback, useEffect, useRef, useState } from 'react';
import { ActivityIndicator, FlatList, Keyboard, Platform, Pressable, TextInput, View } from 'react-native';
import { router, useLocalSearchParams } from 'expo-router';
import * as Crypto from 'expo-crypto';
import type { Message } from '@interlink/shared';
import type { SupabaseDataClient } from '@interlink/data';
import { Avatar, Button, C, Empty, ErrorState, Icon, IconButton, Loading, LoadMore, Screen, T, Tag, s } from './ui';
import { useCommand, useData, useRuntime, useMessagePages, usePagedData } from './runtime';
type DraftMessage = {
    clientId: string;
    body: string;
    status: 'sending' | 'failed';
};
export function ChatScreen() {
    const { id } = useLocalSearchParams<{
        id: string;
    }>();
    const { client, confirm, actor, sessionUser } = useRuntime();
    const boot = useData('bootstrap', {});
    const detail = useData('projects.detail', { id });
    const latest = useMessagePages(id);
    const [drafts, setDrafts] = useState<DraftMessage[]>([]);
    const [text, setText] = useState('');
    const [atBottom, setAtBottom] = useState(true);
    const [composerFocused, setComposerFocused] = useState(false);
    const [composerHeight, setComposerHeight] = useState(52);
    const [actions, setActions] = useState<Message | null>(null);
    const { run, pending } = useCommand();
    const list = useRef<FlatList<Message>>(null);
    const contentHeight = useRef(0);
    const viewportHeight = useRef(0);
    const initial = useRef(true);
    const scrollOwn = useRef(false);
    const readRef = useRef('');
    const scrollToLatest = useCallback(() => {
        // Variable-height bubbles make FlatList's estimated final-item offset unreliable.
        list.current?.scrollToOffset({ offset: Math.max(0, contentHeight.current - viewportHeight.current), animated: false });
    }, []);
    useEffect(() => { setDrafts([]); initial.current = true; scrollOwn.current = false; readRef.current = ''; setText(''); setComposerHeight(52); setActions(null); setAtBottom(true); }, [id, actor, sessionUser]);
    useEffect(() => {
        const subscription = Keyboard.addListener('keyboardDidShow', () => {
            if (atBottom) scrollToLatest();
        });
        return () => subscription.remove();
    }, [atBottom, scrollToLatest]);
    const all = [...new Map((latest.data?.pages.flatMap(page=>page.items)||[]).map(m=>[m.id,m])).values()].sort((a,b)=>a.createdAt.localeCompare(b.createdAt)||a.id.localeCompare(b.id));
    const latestId=latest.data?.pages[0]?.items[0]?.id;
    useEffect(() => { if (!latestId || !atBottom || readRef.current === latestId)
        return; readRef.current = latestId; void client.command('message.read', { projectId: id, messageId: latestId }).catch(() => { readRef.current = ''; }); }, [latestId, atBottom, client, id]);
    useEffect(() => { if (latest.data?.pages.length)
        setDrafts(current => current.filter(d => !latest.data!.pages.some(page=>page.items.some(m => m.clientId === d.clientId)))); }, [latest.data]);
    const send = async (draft?: DraftMessage) => { const body = draft?.body || text.trim(); if (!body || pending)
        return; const item = draft || { clientId: Crypto.randomUUID(), body, status: 'sending' as const }; setDrafts(current => [...current.filter(d => d.clientId !== item.clientId), { ...item, status: 'sending' }]); if (!draft) {
        setText(''); setComposerHeight(52); } scrollOwn.current = true; const result = await run('message.send', { projectId: id, body, clientId: item.clientId }, undefined, item.clientId); if (!result)
        setDrafts(current => current.map(d => d.clientId === item.clientId ? { ...d, status: 'failed' } : d)); };
    const member = detail.data?.members.some(m => m.userId === boot.data?.viewer?.id && m.active);
    if (detail.isLoading || boot.isLoading)
        return <Screen title="팀 대화"><Loading /></Screen>;
    if (detail.error || boot.error)
        return <Screen title="팀 대화"><ErrorState error={detail.error || boot.error} retry={() => { void detail.refetch(); void boot.refetch(); }}/></Screen>;
    if (!member)
        return <Screen title="팀 대화"><Empty title="팀원만 대화에 참여할 수 있어요" text="참여가 승인된 팀원만 대화를 읽고 보낼 수 있어요." icon="lock-closed-outline"/></Screen>;
    return <Screen title="팀 대화" subtitle={`${detail.data?.project.title || ''} · ${detail.data?.members.filter(member => member.active).length || 0}명`} scroll={false} right={<IconButton icon="people-outline" label="팀 정보" onPress={() => router.push('/team/' + id)}/>}>
 {client.mode === 'supabase' && <View style={{ marginBottom: 12 }}><Tag>{({ idle: '연결 대기', connecting: '연결 중', connected: '연결됨', reconnecting: '다시 연결 중', offline: '연결 끊김' } as const)[(client as SupabaseDataClient).connectionState]}</Tag></View>}
 {latest.error ? <View style={{ borderWidth: 1, borderColor: C.dangerLine, backgroundColor: C.card, borderRadius: 20, padding: 20, marginBottom: 16 }}><View style={[s.row, { alignItems: 'flex-start', gap: 12 }]}><Icon name="cloud-offline-outline" size={20} color={C.danger}/><T accessibilityRole="alert" style={{ flex: 1, fontSize: 14, lineHeight: 24 }}>{latest.error instanceof Error ? latest.error.message : '대화를 불러오지 못했어요. 다시 시도해 주세요.'}</T></View><View style={[s.row, { marginTop: 16, gap: 12 }]}><Button title="다시 연결" variant="secondary" busy={latest.isFetching} style={{ flex: 1 }} onPress={() => void latest.refetch()}/><IconButton icon="settings-outline" label="연결 설정 확인" onPress={() => router.push('/settings')}/></View></View> : null}
 <FlatList ref={list} data={all} keyExtractor={m => m.id} style={{ flex: 1, minHeight: 0 }} contentContainerStyle={{ paddingTop: 8, paddingBottom: 16, flexGrow: 1 }} keyboardShouldPersistTaps="handled" keyboardDismissMode={Platform.OS === 'ios' ? 'interactive' : 'on-drag'} maintainVisibleContentPosition={{ minIndexForVisible: 1 }} onLayout={event => { viewportHeight.current = event.nativeEvent.layout.height; if (atBottom) scrollToLatest(); }} onScroll={event => { const { layoutMeasurement, contentOffset, contentSize } = event.nativeEvent; setAtBottom(layoutMeasurement.height + contentOffset.y >= contentSize.height - 80); }} scrollEventThrottle={100} onContentSizeChange={(_width, height) => { contentHeight.current = height; if (initial.current || scrollOwn.current || atBottom) {
        scrollToLatest();
        initial.current = false;
        scrollOwn.current = false;
    } }}
    ListHeaderComponent={latest.hasNextPage ? <Button title="이전 대화 불러오기" variant="ghost" busy={latest.isFetchingNextPage} onPress={() => { setAtBottom(false); void latest.fetchNextPage(); }}/> : undefined}
    ListEmptyComponent={latest.isLoading ? <Loading /> : latest.error ? undefined : <Empty title="첫 이야기를 건네볼까요?" text="서로의 역할을 소개하고 함께 만들고 싶은 것을 나눠보세요." icon="chatbubbles-outline"/>}
    renderItem={({ item: m, index }) => {
        const mine = m.authorId === boot.data?.viewer?.id;
        const previous = all[index - 1];
        const date = new Date(m.createdAt).toLocaleDateString('ko-KR', { year: 'numeric', month: 'long', day: 'numeric', timeZone: 'Asia/Seoul' });
        const showDate = !previous || date !== new Date(previous.createdAt).toLocaleDateString('ko-KR', { year: 'numeric', month: 'long', day: 'numeric', timeZone: 'Asia/Seoul' });
        const showAuthor = !mine && (!previous || showDate || previous.authorId !== m.authorId || Date.parse(m.createdAt) - Date.parse(previous.createdAt) > 300000);
        return <View style={{ alignItems: mine ? 'flex-end' : 'flex-start', marginBottom: 16 }}>
            {showDate && <View style={[s.row, { alignSelf: 'stretch', gap: 12, marginTop: index === 0 ? 8 : 16, marginBottom: 24 }]}><View style={{ flex: 1, height: 1, backgroundColor: C.line }}/><T muted style={{ fontSize: 12, lineHeight: 20 }}>{date}</T><View style={{ flex: 1, height: 1, backgroundColor: C.line }}/></View>}
            {showAuthor && <View style={[s.row, { gap: 8, marginBottom: 8 }]}><Avatar name={m.authorName} size={28}/><T muted style={{ fontSize: 12, lineHeight: 20, fontWeight: '700' }}>{m.authorName}</T></View>}
            <Pressable accessibilityRole={m.deleted ? undefined : 'button'} accessibilityLabel={m.deleted ? '삭제된 메시지' : m.body + ' · 메시지 동작'} disabled={m.deleted} onLongPress={() => setActions(m)} onPress={() => setActions(actions?.id === m.id ? null : m)} style={({ pressed }) => ({ maxWidth: '88%', paddingHorizontal: 16, paddingVertical: 12, borderWidth: 1, borderColor: actions?.id === m.id ? C.accentLine : 'transparent', borderRadius: 16, borderTopRightRadius: mine ? 4 : 16, borderTopLeftRadius: mine ? 16 : 4, backgroundColor: mine ? C.raised : C.card, opacity: pressed ? 0.78 : 1 })}><T style={{ fontSize: 14, lineHeight: 24, color: m.deleted ? C.muted : C.text, fontStyle: m.deleted ? 'italic' : 'normal' }}>{m.deleted ? '삭제된 메시지예요' : m.body}</T></Pressable>
            <View style={[s.row, { gap: 4, marginTop: 4, paddingHorizontal: 4 }]}><T muted style={{ fontSize: 12, lineHeight: 20 }}>{new Date(m.createdAt).toLocaleTimeString('ko-KR', { hour: '2-digit', minute: '2-digit', timeZone: 'Asia/Seoul' })}{mine ? ' · 저장됨' : ''}</T>{mine && <Icon name="checkmark" size={12} color={C.muted}/>}</View>
            {actions?.id === m.id && !m.deleted && <View style={[s.row, { marginTop: 8, gap: 12, flexWrap: 'wrap' }]}>{mine ? <Button title="메시지 삭제" variant="danger" busy={pending} onPress={async () => {
                if (await confirm('메시지를 삭제할까요?', '대화에서 메시지 내용이 삭제돼요.', '삭제')) {
                    if (await run('message.delete', { id: m.id })) setActions(null);
                }
            }}/> : <><Button title="메시지 신고" variant="secondary" onPress={() => router.push({ pathname: '/report', params: { type: 'message', id: m.id } })}/><IconButton icon="person-outline" label="작성자 프로필" onPress={() => router.push('/person/' + m.authorId)}/></>}</View>}
        </View>;
    }}
    ListFooterComponent={<>{drafts.map(draft => <View key={draft.clientId} style={{ alignItems: 'flex-end', marginBottom: 16 }}><View style={{ backgroundColor: C.raised, borderWidth: 1, borderColor: draft.status === 'failed' ? C.dangerLine : 'transparent', borderRadius: 16, borderTopRightRadius: 4, paddingHorizontal: 16, paddingVertical: 12, maxWidth: '88%' }}><T style={{ fontSize: 14, lineHeight: 24 }}>{draft.body}</T></View>{draft.status === 'failed' ? <Pressable accessibilityRole="button" accessibilityLabel="실패한 메시지 재전송" accessibilityState={{ disabled: pending }} disabled={pending} onPress={() => void send(draft)} style={({ pressed }) => ({ flexDirection: 'row', alignItems: 'center', gap: 8, paddingVertical: 12, paddingHorizontal: 4, minHeight: 52, opacity: pressed || pending ? 0.7 : 1 })}><Icon name="refresh-outline" size={16} color={C.danger}/><T style={{ color: C.danger, fontSize: 12, lineHeight: 20 }}>전송 실패 · 눌러서 재전송</T></Pressable> : <T muted style={{ fontSize: 12, lineHeight: 20, marginTop: 4 }}>전송 중…</T>}</View>)}</>}/>
        {!atBottom && <Button title="최근 대화로 이동" icon="arrow-down-outline" variant="secondary" style={{ alignSelf: 'center', paddingHorizontal: 16, borderRadius: 16, marginBottom: 12 }} onPress={() => { scrollToLatest(); setAtBottom(true); }}/>}
        <View style={{ borderTopWidth: 1, borderColor: C.line, paddingTop: 12, marginTop: 4 }}><View style={[s.row, { alignItems: 'flex-end', gap: 8, padding: 4, borderWidth: 1, borderColor: composerFocused ? C.accentLine : C.line, borderRadius: 16, backgroundColor: C.card }]}><TextInput accessibilityLabel="팀 메시지" value={text} onChangeText={value => { setText(value); if (!value) setComposerHeight(52); }} onFocus={() => setComposerFocused(true)} onBlur={() => setComposerFocused(false)} onContentSizeChange={event => setComposerHeight(Math.max(52, Math.min(128, event.nativeEvent.contentSize.height)))} placeholder="아이디어를 나눠보세요" placeholderTextColor={C.muted} multiline numberOfLines={1} maxLength={2000} style={{ flex: 1, height: composerHeight, minHeight: 52, maxHeight: 128, color: C.text, paddingHorizontal: 12, paddingVertical: 12, fontSize: 14, lineHeight: 24, textAlignVertical: 'top', fontFamily: 'NotoSansKR_400Regular' }}/><Pressable accessibilityRole="button" accessibilityLabel="메시지 보내기" accessibilityState={{ disabled: !text.trim() || pending, busy: pending }} disabled={!text.trim() || pending} onPress={() => void send()} style={({ pressed }) => ({ width: 52, height: 52, borderRadius: 12, backgroundColor: text.trim() && !pending ? C.lime : C.raised, alignItems: 'center', justifyContent: 'center', opacity: pressed ? 0.75 : 1 })}>{pending ? <ActivityIndicator size="small" color={C.muted}/> : <Icon name="arrow-up" size={24} color={text.trim() ? C.bg : C.muted}/>}</Pressable></View>{text.length >= 1800 && <T muted style={{ fontSize: 12, lineHeight: 20, textAlign: 'right', marginTop: 4 }}>{text.length.toLocaleString('ko-KR')} / 2,000자</T>}</View>
    </Screen>;
}
export function NotificationsScreen() {
    const notifications = usePagedData('notifications.list', { limit: 50 });
    const { run } = useCommand();
    return <Screen title="알림" right={<IconButton icon="settings-outline" label="알림 설정" onPress={() => router.push('/notification-settings')}/>}>
        {notifications.isLoading ? <Loading /> : notifications.error ? <ErrorState error={notifications.error} retry={() => void notifications.refetch()}/> : notifications.data?.items.length ? notifications.data.items.map(notification => <Pressable
            key={notification.id}
            accessibilityRole="button"
            accessibilityLabel={notification.title + (notification.read ? ' · 읽음' : ' · 읽지 않음')}
            onPress={async () => {
                const result = await run('notification.read', { id: notification.id });
                if (result && notification.projectId) router.push('/project/' + notification.projectId);
            }}
            style={({ pressed }) => ({ flexDirection: 'row', alignItems: 'flex-start', gap: 12, padding: 20, marginBottom: 12, borderWidth: 1, borderColor: notification.read ? 'transparent' : C.line, borderRadius: 20, backgroundColor: pressed ? C.raised : notification.read ? C.bg : C.card })}
        >
            <View style={{ width: 44, height: 44, borderRadius: 16, backgroundColor: notification.read ? C.card : C.raised, alignItems: 'center', justifyContent: 'center' }}><Icon name="notifications-outline" color={C.muted} size={22}/></View>
            <View style={{ flex: 1, minWidth: 0 }}><T style={{ fontSize: 14, fontWeight: notification.read ? '400' : '700', color: notification.read ? C.muted : C.text, lineHeight: 24 }}>{notification.title}</T><T muted style={{ fontSize: 12, lineHeight: 20, marginTop: 8 }}>{new Date(notification.createdAt).toLocaleString('ko-KR', { month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit', timeZone: 'Asia/Seoul' })} · {notification.read ? '읽음' : '새로운 소식'}</T></View>
            <View style={{ width: 8, alignItems: 'center', paddingTop: 8 }}>{!notification.read && <View style={{ width: 6, height: 6, borderRadius: 3, backgroundColor: C.lime }}/>}</View>
        </Pressable>) : <Empty title="새로운 연결 소식을 기다려요" text="신청과 초대, 팀의 중요한 변화가 이곳에 모여요." icon="notifications-outline"/>}
        <LoadMore query={notifications}/>
    </Screen>;
}
