import React, { useEffect, useState } from 'react';
import { ActivityIndicator, Linking, Platform, Pressable, StyleSheet, Switch, View } from 'react-native';
import { router, useLocalSearchParams, usePathname } from 'expo-router';
import Constants from 'expo-constants';
import { Controller, useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { useQueryClient } from '@tanstack/react-query';
import type { DemoClient, SupabaseDataClient } from '@interlink/data';
import { AppError, EDUCATION_LEVELS, EDUCATION_LEVEL_LABELS, homeActivity, profileInputSchema, type ProfileInput, type ReportTarget } from '@interlink/shared';
import { Avatar, Button, C, Divider, Empty, ErrorState, Field, Icon, IconButton, Loading, LoadMore, Panel, RowLink, Screen, Section, T, Tag, Tags, s } from './ui';
import { useCommand, useData, useRuntime, useUnsavedChanges, usePagedData } from './runtime';
import { AppHeader, ProjectCard } from './discovery';
import { logout, registerPush } from './push';
type AccountMenuItem = {
    title: string;
    subtitle?: string;
    icon: React.ComponentProps<typeof Icon>['name'];
    onPress: () => void;
    danger?: boolean;
};
function AccountMenu({ items }: { items: AccountMenuItem[] }) {
    return <Panel style={{ padding: 0, overflow: 'hidden' }}>{items.map((item, index) =>
        <Pressable key={item.title} accessibilityRole="button" accessibilityLabel={item.title} onPress={item.onPress}
            style={({ pressed }) => [s.row, { minHeight: 72, paddingHorizontal: 16, paddingVertical: 16, gap: 12,
                borderBottomWidth: index < items.length - 1 ? 1 : 0, borderBottomColor: C.line,
                backgroundColor: pressed ? C.raised : 'transparent' }]}>
            <Icon name={item.icon} size={21} color={item.danger ? C.danger : C.muted}/>
            <View style={{ flex: 1, minWidth: 0 }}>
                <T style={{ fontSize: 14, lineHeight: 24, fontWeight: '600', color: item.danger ? C.danger : C.text }}>{item.title}</T>
                {item.subtitle && <T muted style={{ fontSize: 12, lineHeight: 20, marginTop: 4 }}>{item.subtitle}</T>}
            </View>
            <Icon name="chevron-forward" size={17} color={C.muted}/>
        </Pressable>
    )}</Panel>;
}
function AccountSwitch(props: React.ComponentProps<typeof Switch>) {
    // React Native Web uses a separate active thumb color; native keeps its platform control.
    const webProps = Platform.OS === 'web' ? { activeThumbColor: C.lime, style: { width: 48, height: 28 } } : {};
    return <View style={{ minWidth: 52, minHeight: 48, alignItems: 'center', justifyContent: 'center' }}>
        <Switch {...props} thumbColor={props.value ? C.lime : C.muted} hitSlop={{ top: 10, bottom: 10, left: 6, right: 6 }} {...webProps}/>
    </View>;
}
export function ProfileScreen() {
    const boot = useData('bootstrap', {});
    const person = boot.data?.viewer;
    const experiences = usePagedData('experiences.list', {}, !!person);
    const teams = usePagedData('teams.mine', { limit: 50 }, !!person);
    const applications = usePagedData('applications.list', { limit: 50 }, !!person);
    const invitations = usePagedData('invitations.list', { limit: 50 }, !!person);
    const { client } = useRuntime();
    const { run, pending } = useCommand();
    const isTab = usePathname() === '/me';
    const activity = homeActivity(person, teams.data?.items || [], applications.data?.items || [], invitations.data?.items || []);
    const activityLoading = teams.isLoading || applications.isLoading || invitations.isLoading;
    const activityError = teams.error || applications.error || invitations.error;
    const moreActivity = teams.hasNextPage || applications.hasNextPage || invitations.hasNextPage;
    const openActivity = (view = 'active') => router.push({ pathname: '/teams', params: { view } });
    const refreshActivity = () => { void teams.refetch(); void applications.refetch(); void invitations.refetch(); };
    const refresh = () => { void boot.refetch(); refreshActivity(); void experiences.refetch(); };
    const invitation = activity.pendingInvitations[0];
    const review = activity.awaitingReview[0];
    const application = activity.pendingApplications[0];
    const team = activity.nextTeam;
    const next = invitation ? {
        label: '확인할 초대', title: invitation.projectTitle || '받은 팀 초대', detail: `${invitation.role} 역할로 초대받았어요.`, action: '초대 확인',
        press: () => router.push('/project/' + invitation.projectId),
    } : review ? {
        label: `검토할 신청 ${activity.awaitingReview.length}${applications.hasNextPage ? '+' : ''}건`, title: review.projectTitle || '새로운 참여 신청', detail: `${review.nickname || '신청자'} · ${review.role}`, action: '신청자 확인',
        press: () => router.push('/applications/' + review.projectId),
    } : application ? {
        label: '지원서 검토 중', title: application.projectTitle || '지원한 프로젝트', detail: `${application.role} 역할 · 팀장의 응답을 기다리고 있어요.`, action: '지원 확인',
        press: () => router.push('/project/' + application.projectId),
    } : team ? {
        label: team.unreadCount ? `읽지 않은 대화 ${team.unreadCount > 99 ? '99+' : team.unreadCount}개` : '참여 중인 팀', title: team.title,
        detail: `${team.memberCount}명 참여 · ${team.status === 'active' ? '진행 중' : '팀원 모집 중'}`, action: '팀 대화',
        press: () => router.push('/chat/' + team.id),
    } : {
        label: '아직 참여 중인 팀이 없어요', title: '함께할 팀을 찾아보세요', detail: '하고 싶은 활동과 맡고 싶은 역할로 찾아볼 수 있어요.', action: '팀 찾기',
        press: () => router.push({ pathname: '/explore', params: { kind: 'project', q: '', reset: '1' } }),
    };
    const toggleProfile = async () => {
        if (!person || pending) return;
        // Omitted school and onboarding fields keep their latest persisted values.
        const input: ProfileInput = {
            nickname: person.nickname, avatar: person.avatar, interests: [...person.interests], roles: [...person.roles], learningRoles: [...person.learningRoles],
            skills: [...person.skills], availability: [...person.availability], activityMode: person.activityMode, bio: person.bio,
            discoverable: !person.discoverable, links: [...person.links],
        };
        await run('profile.update', input, person.discoverable ? '사람 찾기에서 프로필을 숨겼어요.' : '같은 커뮤니티의 사람 찾기에 프로필을 공개했어요.');
    };
    const settings = <IconButton icon="settings-outline" label="설정 열기" onPress={() => router.push('/settings')}/>;
    const header = isTab ? <><AppHeader/><View style={profileDashboardStyles.screenHeading}><T accessibilityRole="header" style={{ fontSize: 28, lineHeight: 40, fontWeight: '700', letterSpacing: -.6 }}>내 정보</T>{settings}</View></> : null;
    if (boot.isLoading)
        return <Screen title={isTab ? undefined : '내 정보'} back={!isTab}>{header}<Loading /></Screen>;
    if (boot.error)
        return <Screen title={isTab ? undefined : '내 정보'} back={!isTab} right={isTab ? undefined : settings}>{header}<ErrorState error={boot.error} retry={() => void boot.refetch()}/></Screen>;
    if (!person)
        return <Screen title={isTab ? undefined : '내 정보'} back={!isTab}>{header}<Empty title="로그인이 필요해요" text="로그인하면 참여 중인 팀과 내 프로필을 확인할 수 있어요." actionLabel="로그인" action={() => router.push('/auth')}/></Screen>;
    const hasExperiences = !!experiences.data?.items.length;
    const counts = [
        { label: '참여 중', count: activity.liveTeams.length, more: teams.hasNextPage, icon: 'people-outline' as const, press: () => openActivity() },
        { label: '지원 중', count: activity.pendingApplications.length, more: applications.hasNextPage, icon: 'document-text-outline' as const, press: () => openActivity('requests') },
        { label: '받은 초대', count: activity.pendingInvitations.length, more: invitations.hasNextPage, icon: 'mail-outline' as const, press: () => openActivity('requests') },
    ];
    return <Screen title={isTab ? undefined : '내 정보'} back={!isTab} right={isTab ? undefined : settings} onRefresh={refresh} refreshing={boot.isRefetching || teams.isRefetching || applications.isRefetching || invitations.isRefetching || experiences.isRefetching}>
        {header}
        <View style={profileDashboardStyles.dashboard}>
            <View style={profileDashboardStyles.greetingRow}>
                <View style={{ flex: 1, minWidth: 0 }}>
                    <T numberOfLines={1} style={{ fontSize: 24, lineHeight: 32, letterSpacing: -.6, fontWeight: '700', color: C.lime }}>{person.nickname.replace(/^가상 /, '')}<T style={{ fontSize: 20, lineHeight: 28, fontWeight: '400', color: C.text }}>님,</T></T>
                    <T style={{ fontSize: 14, lineHeight: 24 }}>안녕하세요.</T>
                </View>
                <Pressable accessibilityRole="switch" accessibilityLabel="프로필 공개" accessibilityHint="같은 커뮤니티의 사람 찾기에 내 프로필을 표시해요."
                    accessibilityState={{ checked: person.discoverable, disabled: pending, busy: pending }} aria-checked={person.discoverable} disabled={pending}
                    onPress={() => void toggleProfile()} style={({ pressed }) => [profileDashboardStyles.visibilityControl, pressed && { backgroundColor: C.raised }]}>
                    <T style={{ fontSize: 12, lineHeight: 20, color: C.muted }}>프로필 공개</T>
                    <View style={[profileDashboardStyles.toggleTrack, person.discoverable && { backgroundColor: C.lime, borderColor: C.lime }]}>
                        {pending ? <ActivityIndicator color={person.discoverable ? C.bg : C.lime} size="small"/> : <>
                            <T style={{ position: 'absolute', left: person.discoverable ? 10 : 30, fontSize: 12, lineHeight: 20, fontWeight: '700', color: person.discoverable ? C.bg : C.muted }}>{person.discoverable ? 'ON' : 'OFF'}</T>
                            <View style={[profileDashboardStyles.toggleThumb, { left: person.discoverable ? 37 : 4, backgroundColor: person.discoverable ? '#F4FFE7' : '#92998A' }]}/>
                        </>}
                    </View>
                </Pressable>
            </View>

            {activityLoading ? <View style={profileDashboardStyles.feedback}><ActivityIndicator color={C.lime}/><T muted style={{ fontSize: 14, lineHeight: 24 }}>내 활동을 불러오고 있어요</T></View>
                : activityError ? <View style={profileDashboardStyles.error}>
                    <T style={{ fontSize: 14, lineHeight: 24, marginBottom: 4 }}>내 활동을 불러오지 못했어요.</T>
                    <T muted style={{ fontSize: 12, lineHeight: 20, marginBottom: 16 }}>연결 상태를 확인하고 다시 시도해 주세요.</T>
                    <Button title="내 활동 다시 시도" variant="secondary" onPress={refreshActivity}/>
                </View> : <>
                    <View style={profileDashboardStyles.counts}>
                        {counts.map((item, index) => {
                            const value = item.more && !item.count ? '더 보기' : `${item.count}${item.more ? '+' : ''}`;
                            return <Pressable key={item.label} accessibilityRole="button" accessibilityLabel={`${item.label} ${value}`} onPress={item.press}
                                style={({ pressed }) => [profileDashboardStyles.count, index > 0 && { borderLeftWidth: 1, borderLeftColor: C.line }, pressed && { backgroundColor: C.raised }]}>
                                <View style={[s.row, { gap: 4 }]}><Icon name={item.icon} size={15} color={C.muted}/><T muted style={{ fontSize: 12, lineHeight: 20 }}>{item.label}</T></View>
                                <T style={{ fontSize: item.more && !item.count ? 16 : 28, lineHeight: 40, fontWeight: '700', color: C.lime }}>{value}</T>
                            </Pressable>;
                        })}
                    </View>
                    {moreActivity && <T muted style={{ fontSize: 12, lineHeight: 20, paddingHorizontal: 20, marginBottom: 12 }}>불러온 활동 기준이에요. 각 항목에서 더 확인할 수 있어요.</T>}
                    <Pressable accessibilityRole="button" accessibilityLabel={`${next.title} · ${next.action}`} onPress={next.press}
                        style={({ pressed }) => [profileDashboardStyles.next, pressed && { backgroundColor: C.raised }]}>
                        <View style={{ flex: 1, minWidth: 0 }}>
                            <T style={{ fontSize: 12, lineHeight: 20, color: C.muted }}>{next.label}</T>
                            <T numberOfLines={2} style={{ fontSize: 16, lineHeight: 24, fontWeight: '700', marginTop: 4 }}>{next.title}</T>
                            <T muted numberOfLines={2} style={{ fontSize: 12, lineHeight: 20, marginTop: 4 }}>{next.detail}</T>
                        </View>
                        <View style={profileDashboardStyles.nextAction}><T style={{ fontSize: 12, lineHeight: 20, fontWeight: '700', color: C.lime }}>{next.action}</T><Icon name="chevron-forward" size={14} color={C.lime}/></View>
                    </Pressable>
                </>}
        </View>

        <Section title="내 프로필">
          <Panel>
            <View style={[s.row, { alignItems: 'center', gap: 16 }]}>
                <Avatar avatar={person.avatar} name={person.nickname} size={64}/>
                <View style={{ flex: 1, minWidth: 0 }}>
                    <T style={{ fontSize: 24, fontWeight: '700', lineHeight: 32, letterSpacing: -.6 }}>{person.nickname}</T>
                    <T muted style={{ fontSize: 14, lineHeight: 24, marginTop: 4 }}>{person.roles.join(' · ') || '나의 역할을 알려주세요'}</T>
                    {person.educationLevel && <T muted style={{ fontSize: 12, lineHeight: 20, marginTop: 4 }}>{EDUCATION_LEVEL_LABELS[person.educationLevel]}</T>}
                    {client.mode === 'demo' && <View style={{ alignSelf: 'flex-start', marginTop: 8 }}><Tag active>가상 프로필</Tag></View>}
                </View>
            </View>
            <T muted style={{ fontSize: 14, lineHeight: 24, marginTop: 20 }}>{person.bio || '관심 있는 일과 함께하고 싶은 활동을 소개해 보세요.'}</T>
            {person.interests.length > 0 && <View style={{ marginTop: 16 }}><Tags values={person.interests}/></View>}
            <Button title="프로필 편집" variant="secondary" icon="create-outline" onPress={() => router.push('/profile/edit')} style={{ marginTop: 20 }}/>
          </Panel>
        </Section>
        <View style={{ marginTop: 16 }}><AccountMenu items={[
            { title: '저장한 프로젝트', subtitle: '관심 있는 팀을 다시 살펴보세요', icon: 'bookmark-outline', onPress: () => router.push('/saved') },
        ]}/></View>
        <Section title="활동 경험" label={hasExperiences ? '기록하기' : undefined} action={() => router.push('/experience')}>
            {experiences.isLoading ? <Loading /> : experiences.error ? <ErrorState error={experiences.error} retry={() => void experiences.refetch()}/> : hasExperiences ? experiences.data?.items.map(e =>
                <Panel key={e.id} style={{ marginBottom: 12 }}>
                    <View style={[s.between, { gap: 8, flexWrap: 'wrap' }]}><Tag active>{e.role}</Tag><Tag>{e.isPublic ? '공개' : '나만 보기'}</Tag></View>
                    <T style={{ fontSize: 20, lineHeight: 28, fontWeight: '700', marginTop: 16 }}>{e.title}</T>
                    <T muted style={{ fontSize: 14, lineHeight: 24, marginTop: 8 }}>{e.description}</T>
                    <RowLink title="기록 수정" icon="create-outline" onPress={() => router.push({ pathname: '/experience', params: { id: e.id, projectId: e.projectId } })}/>
                </Panel>
            ) : <Panel>
                <View style={[s.row, { gap: 12 }]}><Icon name="document-text-outline" color={C.lime} size={22}/><T style={{ fontSize: 14, lineHeight: 24, fontWeight: '700' }}>아직 기록한 경험이 없어요</T></View>
                <T muted style={{ fontSize: 14, lineHeight: 24, marginTop: 12, marginBottom: 20 }}>참여한 팀에서 맡은 역할과 결과를 기록해 보세요. 공개 여부도 직접 선택할 수 있어요.</T>
                <Button title="경험 기록하기" variant="secondary" onPress={() => router.push('/experience')}/>
            </Panel>}
            <LoadMore query={experiences} label="경험 더 불러오기"/>
        </Section>
        <Section title="내 설정"><AccountMenu items={[
            { title: '알림 설정', icon: 'notifications-outline', onPress: () => router.push('/notification-settings') },
            { title: '차단한 사용자', icon: 'hand-left-outline', onPress: () => router.push('/blocked') },
            { title: '개인정보와 커뮤니티 규칙', icon: 'shield-checkmark-outline', onPress: () => router.push('/legal') },
            { title: '설정 · 계정 관리', icon: 'settings-outline', onPress: () => router.push('/settings') },
        ]}/></Section>
    </Screen>;
}
const profileDashboardStyles = StyleSheet.create({
    screenHeading: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginTop: 12, marginBottom: 12 },
    dashboard: { backgroundColor: C.card, borderWidth: 1, borderColor: '#8BAA53', borderRadius: 24, overflow: 'hidden' },
    greetingRow: { flexDirection: 'row', alignItems: 'center', gap: 12, paddingHorizontal: 20, paddingTop: 20, paddingBottom: 16 },
    visibilityControl: { minHeight: 64, minWidth: 84, paddingHorizontal: 8, paddingVertical: 4, gap: 4, alignItems: 'center', justifyContent: 'center', borderRadius: 16 },
    toggleTrack: { width: 64, height: 32, borderRadius: 16, borderWidth: 1, borderColor: C.line, backgroundColor: C.raised, justifyContent: 'center', alignItems: 'center' },
    toggleThumb: { position: 'absolute', width: 24, height: 24, borderRadius: 12 },
    counts: { flexDirection: 'row', paddingHorizontal: 8, marginTop: 4, marginBottom: 20 },
    count: { flex: 1, minHeight: 72, alignItems: 'center', justifyContent: 'center', gap: 4, paddingHorizontal: 4, paddingVertical: 4 },
    next: { borderTopWidth: 1, borderTopColor: C.line, paddingHorizontal: 20, paddingVertical: 16, flexDirection: 'row', alignItems: 'center', gap: 12 },
    nextAction: { minHeight: 48, flexDirection: 'row', alignItems: 'center', gap: 2, paddingHorizontal: 8, borderWidth: 1, borderColor: C.line, borderRadius: 24 },
    feedback: { minHeight: 144, alignItems: 'center', justifyContent: 'center', gap: 12, padding: 20 },
    error: { paddingHorizontal: 20, paddingTop: 8, paddingBottom: 20 },
});
const cleanList = z.array(z.string()).transform(values => values.map(v => v.trim()).filter(Boolean));
const profileEditSchema = profileInputSchema.safeExtend({ interests: cleanList.pipe(profileInputSchema.shape.interests), roles: cleanList.pipe(profileInputSchema.shape.roles), learningRoles: cleanList.pipe(profileInputSchema.shape.learningRoles), skills: cleanList.pipe(profileInputSchema.shape.skills), availability: cleanList.pipe(profileInputSchema.shape.availability), links: cleanList.pipe(profileInputSchema.shape.links) });
export function ProfileEditScreen() {
    const boot = useData('bootstrap', {});
    const { run, pending } = useCommand();
    const editSchema = profileEditSchema.superRefine((value, context) => {
        if (!boot.data?.viewer?.onboardingCompleted) return;
        if (!value.educationLevel) context.addIssue({ code: 'custom', path: ['educationLevel'], message: '학교급을 선택해 주세요.' });
        if (!value.interests.length) context.addIssue({ code: 'custom', path: ['interests'], message: '관심 분야를 하나 이상 입력해 주세요.' });
    });
    const { control, handleSubmit, reset, setValue, watch, formState: { errors, isDirty } } = useForm<ProfileInput>({ resolver: zodResolver(editSchema), defaultValues: { nickname: '', avatar: 'orbit', educationLevel: null, interests: [], roles: [], learningRoles: [], skills: [], availability: [], activityMode: 'online', bio: '', discoverable: false, links: [] } });
    const allowNavigation = useUnsavedChanges(isDirty);
    useEffect(() => { if (boot.data?.viewer && !isDirty) {
        const p = boot.data.viewer;
        reset({ nickname: p.nickname, avatar: p.avatar, educationLevel: p.educationLevel ?? null, interests: p.interests, roles: p.roles, learningRoles: p.learningRoles, skills: p.skills, availability: p.availability, activityMode: p.activityMode, bio: p.bio, discoverable: p.discoverable, links: p.links });
    } }, [boot.data?.viewer, reset, isDirty]);
    const csv = (name: 'interests' | 'roles' | 'learningRoles' | 'skills' | 'availability' | 'links', label: string, hint: string, placeholder?: string) =>
        <Controller key={name} control={control} name={name} render={({ field }) => <Field label={label} value={field.value.join(', ')} onChangeText={v => field.onChange(v.split(',').map(x => x.trimStart()))} error={errors[name]?.message} hint={hint} placeholder={placeholder}/>}/>;
    const saveProfile = handleSubmit(async v => {
        const clean = { ...v, interests: v.interests.filter(Boolean), roles: v.roles.filter(Boolean), learningRoles: v.learningRoles.filter(Boolean), skills: v.skills.filter(Boolean), availability: v.availability.filter(Boolean), links: v.links.filter(Boolean) };
        const result = await run('profile.update', clean, '프로필을 저장했어요.');
        if (result) { allowNavigation(); reset(clean); router.back(); }
    });
    if (boot.isLoading)
        return <Screen title="프로필 편집"><Loading /></Screen>;
    if (boot.error)
        return <Screen title="프로필 편집"><ErrorState error={boot.error} retry={() => void boot.refetch()}/></Screen>;
    if (!boot.data?.viewer)
        return <Screen title="프로필 편집"><Empty title="로그인하고 프로필을 알려주세요" text="내 프로필을 불러온 뒤 안전하게 수정할 수 있어요." actionLabel="로그인" action={() => router.push({ pathname: '/auth', params: { returnTo: '/profile/edit' } })}/></Screen>;
    return <Screen title="프로필 편집" subtitle="함께하고 싶은 일을 알려주세요"
        footer={<Button title="프로필 저장" busy={pending} onPress={saveProfile}/>}>
        <Controller control={control} name="nickname" render={({ field }) => <Field label="닉네임" value={field.value} onChangeText={field.onChange} error={errors.nickname?.message} placeholder="함께할 사람들이 부를 이름"/>}/>
        <View style={{ marginBottom: 24 }}>
            <T style={{ fontSize: 14, lineHeight: 24, fontWeight: '700', marginBottom: 12 }}>학교급</T>
            <View accessibilityRole="radiogroup" accessibilityLabel="학교급" style={{ flexDirection: 'row', gap: 8 }}>
                {EDUCATION_LEVELS.map(level => {
                    const selected = watch('educationLevel') === level;
                    return <Pressable key={level} accessibilityRole="radio" accessibilityLabel={EDUCATION_LEVEL_LABELS[level]}
                        accessibilityState={{ checked: selected }} aria-checked={selected}
                        onPress={() => setValue('educationLevel', level, { shouldDirty: true, shouldValidate: true })}
                        style={({ pressed }) => ({ flex: 1, minWidth: 0, minHeight: 56, paddingHorizontal: 8, paddingVertical: 12,
                            borderRadius: 16, borderWidth: 1, borderColor: selected ? C.lime : C.line,
                            backgroundColor: selected ? C.raised : C.card, alignItems: 'center', justifyContent: 'center', opacity: pressed ? .7 : 1 })}>
                        <T style={{ fontSize: 14, lineHeight: 24, fontWeight: selected ? '700' : '500', color: selected ? C.lime : C.text }}>{EDUCATION_LEVEL_LABELS[level]}</T>
                    </Pressable>;
                })}
            </View>
            {errors.educationLevel?.message && <T accessibilityRole="alert" style={{ color: C.danger, fontSize: 12, lineHeight: 20, marginTop: 8 }}>{errors.educationLevel.message}</T>}
        </View>
        <T style={{ fontSize: 14, lineHeight: 24, fontWeight: '700', marginBottom: 12 }}>나를 표현하는 아바타</T>
        <View style={{ flexDirection: 'row', gap: 8, marginBottom: 8 }}>{(['orbit', 'spark', 'leaf', 'star'] as const).map((v, i) =>
            <Pressable key={v} accessibilityRole="button" accessibilityLabel={['링 아바타', '빛 아바타', '잎 아바타', '별 아바타'][i]}
                accessibilityState={{ selected: watch('avatar') === v }} aria-pressed={watch('avatar') === v}
                onPress={() => setValue('avatar', v, { shouldDirty: true })}
                style={({ pressed }) => ({ flex: 1, minWidth: 0, minHeight: 80, paddingVertical: 12, gap: 4, borderRadius: 16,
                    backgroundColor: watch('avatar') === v ? C.raised : C.card, alignItems: 'center', justifyContent: 'center',
                    borderWidth: 1, borderColor: watch('avatar') === v ? C.lime : C.line, opacity: pressed ? .7 : 1 })}>
                <Icon name={(['planet-outline', 'flash-outline', 'leaf-outline', 'star-outline'] as const)[i]} color={watch('avatar') === v ? C.lime : C.muted} size={26}/>
                <T style={{ fontSize: 12, lineHeight: 20, color: watch('avatar') === v ? C.lime : C.muted }}>{['링', '빛', '잎', '별'][i]}</T>
            </Pressable>
        )}</View>
        <Section title="관심과 역할">
            {csv('interests', '관심 분야', '여러 분야는 쉼표로 구분해 주세요.', '환경, 기술, 디자인')}
            {csv('roles', '가능한 역할', '지금 팀에서 함께할 수 있는 역할이에요.', '기획, 개발')}
            {csv('learningRoles', '배우고 싶은 역할 · 선택', '처음 도전하는 역할도 괜찮아요.', '디자인, 영상 편집')}
            {csv('skills', '기술 태그 · 선택', '다룰 수 있는 도구나 기술을 적어주세요.', 'Figma, Python')}
        </Section>
        <Section title="함께할 수 있는 시간">
            {csv('availability', '가능한 시간', '다른 팀원이 이해하기 쉬운 일정으로 적어주세요.', '평일 저녁, 주말')}
            <T style={{ fontSize: 14, lineHeight: 24, fontWeight: '700', marginBottom: 12 }}>활동 방식</T>
            <View style={[s.wrap, { marginBottom: 4 }]}>{([['online', '온라인'], ['offline', '오프라인'], ['hybrid', '온·오프라인']] as const).map(([v, l]) =>
                <Tag key={v} active={watch('activityMode') === v} onPress={() => setValue('activityMode', v, { shouldDirty: true })}>{l}</Tag>
            )}</View>
        </Section>
        <Section title="나를 소개하는 이야기">
            <Controller control={control} name="bio" render={({ field }) => <Field label="자기소개 · 선택" value={field.value} onChangeText={field.onChange} error={errors.bio?.message} multiline placeholder="어떤 일에 관심이 있고, 무엇을 함께 만들고 싶나요?" hint="학교, 성적, 개인 연락처는 적지 마세요."/>}/>
            {csv('links', '결과물 링크 · 선택', '최대 3개의 http/https 링크를 쉼표로 구분해 주세요.', 'https://...')}
        </Section>
        <Panel style={{ marginTop: 4, marginBottom: 12 }}>
            <View style={[s.between, { gap: 16 }]}>
                <View style={{ flex: 1, minWidth: 0 }}><T style={{ fontWeight: '700', fontSize: 14, lineHeight: 24 }}>같은 커뮤니티에서 발견 허용</T><T muted style={{ fontSize: 12, lineHeight: 20, marginTop: 8 }}>내 역할과 관심 분야를 사람 탐색에 표시해요.</T></View>
                <AccountSwitch accessibilityLabel="발견 허용" value={watch('discoverable')} onValueChange={v => setValue('discoverable', v, { shouldDirty: true })} trackColor={{ true: '#557C25', false: C.line }} thumbColor={C.lime}/>
            </View>
        </Panel>
        <Button title="취소" variant="ghost" onPress={() => router.back()}/>
    </Screen>;
}
export function PersonScreen() {
    const { id } = useLocalSearchParams<{
        id: string;
    }>();
    const person = useData('people.detail', { id });
    const experiences = usePagedData('experiences.list', { userId: id });
    const boot = useData('bootstrap', {});
    const { run, pending } = useCommand();
    const { confirm, toast } = useRuntime();
    if (person.isLoading)
        return <Screen title="프로필"><Loading /></Screen>;
    if (person.error)
        return <Screen title="프로필"><ErrorState error={person.error} retry={() => void person.refetch()}/></Screen>;
    if (!person.data)
        return <Screen title="프로필"><Empty title="프로필을 찾을 수 없어요" text="공개 상태가 바뀌었거나 더 이상 볼 수 없는 프로필이에요." actionLabel="사람 탐색으로" action={() => router.replace('/explore')}/></Screen>;
    const p = person.data;
    const self = boot.data?.viewer?.id === id;
    return <Screen title="함께할 사람"><View style={{ paddingVertical: 12 }}><Avatar avatar={p.avatar} name={p.nickname} size={76}/><T style={{ fontSize: 28, fontWeight: '700', marginTop: 20, lineHeight: 40 }}>{p.nickname}</T><T style={{ color: C.lime, marginTop: 4 }}>{p.roles.join(' · ')}</T>{p.educationLevel && <T muted style={{ fontSize: 12, lineHeight: 20, marginTop: 8 }}>{EDUCATION_LEVEL_LABELS[p.educationLevel]}</T>}</View><T muted style={{ lineHeight: 24, marginTop: 12 }}>{p.bio}</T><Section title="관심이 향하는 곳"><Tags values={p.interests}/></Section><Section title="내가 가진 강점"><Tags values={p.skills}/>{p.learningRoles.length > 0 && <T muted style={{ fontSize: 12, lineHeight: 20, marginTop: 16 }}>배우고 싶어요 · {p.learningRoles.join(' · ')}</T>}</Section><Section title="함께할 수 있는 시간"><Tags values={p.availability}/><T muted style={{ fontSize: 12, lineHeight: 20, marginTop: 12 }}>{p.activityMode === 'online' ? '온라인 활동을 선호해요' : p.activityMode === 'offline' ? '오프라인 활동을 선호해요' : '온라인과 오프라인 모두 좋아요'}</T></Section><Section title="공개한 경험">{experiences.isLoading ? <Loading /> : experiences.error ? <ErrorState error={experiences.error} retry={() => void experiences.refetch()}/> : experiences.data?.items.length ? experiences.data.items.map(e => <Panel key={e.id} style={{ marginBottom: 12 }}><Tag>{e.role}</Tag><T style={{ fontWeight: '700', fontSize: 16, lineHeight: 24, marginTop: 12 }}>{e.title}</T><T muted style={{ lineHeight: 20, fontSize: 12, marginTop: 8 }}>{e.description}</T></Panel>) : <T muted>아직 공개한 기록이 없어요.</T>}<LoadMore query={experiences} label="경험 더 불러오기"/></Section>{p.links.filter(link => /^https?:\/\//i.test(link)).map(link => <RowLink key={link} title="공개 결과물 열기" subtitle={link} icon="open-outline" onPress={() => void Linking.openURL(link).catch(() => toast('링크를 열지 못했어요.'))}/>)}{!self && <View style={{ marginTop: 32 }}><Button title="내 프로젝트에 초대하기" icon="paper-plane-outline" onPress={() => router.push('/invite/' + id)}/><RowLink title="프로필 신고" icon="flag-outline" onPress={() => router.push({ pathname: '/report', params: { type: 'profile', id } })}/><RowLink title="이 사용자 차단" icon="hand-left-outline" danger onPress={async () => { if (await confirm('이 사용자를 차단할까요?', '새로운 신청·초대·추천이 제한돼요. 이미 같은 팀이라면 공유 대화의 기존 기록이 남을 수 있어요. 필요하면 팀 탈퇴 또는 신고도 이용해 주세요.', '차단')) {
        const r = await run('block.set', { userId: id, blocked: true }, '사용자를 차단했어요.');
        if (r)
            router.back();
    } }}/></View>}{pending && <Loading />}</Screen>;
}
const inviteSchema = z.object({ projectId: z.string().min(1, '초대할 프로젝트를 선택해 주세요.'), role: z.string().trim().min(1, '제안할 역할을 입력해 주세요.').max(80), message: z.string().trim().max(500) });
export function InviteScreen() { const { id } = useLocalSearchParams<{
    id: string;
}>(); const person = useData('people.detail', { id }); const teams = usePagedData('teams.mine', {}); const boot = useData('bootstrap', {}); const { run, pending } = useCommand(); const { control, setValue, watch, handleSubmit, formState: { errors } } = useForm<z.infer<typeof inviteSchema>>({ resolver: zodResolver(inviteSchema), defaultValues: { projectId: '', role: '', message: '' } }); const owned = teams.data?.items.filter(p => p.ownerId === boot.data?.viewer?.id && p.status === 'recruiting') || [];
    if (person.isLoading || boot.isLoading) return <Screen title="함께할 팀에 초대"><Loading /></Screen>;
    if (person.error || boot.error) return <Screen title="함께할 팀에 초대"><ErrorState error={person.error || boot.error} retry={() => { void person.refetch(); void boot.refetch(); }}/></Screen>;
    return <Screen title="함께할 팀에 초대"><T style={{ fontSize: 28, fontWeight: '700', lineHeight: 40, marginBottom: 12 }}>{person.data?.nickname}님과 연결해 볼까요?</T><T muted style={{ lineHeight: 20, fontSize: 12, marginBottom: 24 }}>초대받은 사람이 수락하면 팀원이 돼요. 초대만으로 자리를 예약하거나 개인 대화가 열리지는 않아요.</T><T style={{ fontWeight: '700', marginBottom: 12 }}>내가 운영하는 모집 중 프로젝트</T>{teams.isLoading ? <Loading /> : teams.error ? <ErrorState error={teams.error} retry={() => void teams.refetch()}/> : owned.length ? owned.map(p => <Pressable key={p.id} accessibilityRole="radio" accessibilityState={{ checked: watch('projectId') === p.id }} aria-checked={watch('projectId') === p.id} onPress={() => setValue('projectId', p.id, { shouldValidate: true })} style={[s.panel, { marginBottom: 12, borderColor: watch('projectId') === p.id ? C.lime : C.line }]}><T style={{ fontWeight: '700' }}>{p.title}</T><T muted style={{ fontSize: 12, lineHeight: 20, marginTop: 4 }}>{p.memberCount}/{p.capacity}명 · {p.roles.join(' / ')}</T></Pressable>) : <Empty title="모집 중인 프로젝트가 없어요" text="직접 프로젝트를 만들고 함께할 사람을 초대할 수 있어요." actionLabel="팀 모집하기" action={() => router.push('/project/new')}/>}<LoadMore query={teams} label="모집 프로젝트 더 불러오기"/><T style={{ color: C.danger, fontSize: 12, lineHeight: 20, marginBottom: 16 }}>{errors.projectId?.message}</T><Controller control={control} name="role" render={({ field }) => <Field label="함께할 역할" value={field.value} onChangeText={field.onChange} error={errors.role?.message} placeholder="디자인"/>}/><Controller control={control} name="message" render={({ field }) => <Field label="초대 메시지 · 선택" value={field.value} onChangeText={field.onChange} multiline error={errors.message?.message} placeholder="어떤 점을 보고 함께하고 싶었는지 알려주세요."/>}/><Button title="초대 보내기" busy={pending} disabled={teams.isLoading || !!teams.error || !owned.length} onPress={handleSubmit(async (v) => { const r = await run('invitation.send', { ...v, inviteeId: id }, '초대를 보냈어요. 상대방의 응답을 기다려주세요.'); if (r)
    router.back(); })}/></Screen>; }
export function SavedScreen() {
    const saved = usePagedData('saved.list', {});
    return <Screen title="저장한 프로젝트" subtitle="마음에 든 팀을 한곳에 모았어요">
        {saved.isLoading ? <Loading /> : saved.error ? <ErrorState error={saved.error} retry={() => void saved.refetch()}/> : saved.data?.items.length ? saved.data.items.map(p => <ProjectCard key={p.id} project={p}/>) :
            <Empty title="마음이 가는 팀을 담아두세요" text="프로젝트의 북마크를 누르면 여기에서 다시 볼 수 있어요." icon="bookmark-outline" actionLabel="프로젝트 둘러보기" action={() => router.push('/explore')}/>
        }
        <LoadMore query={saved}/>
    </Screen>;
}
const experienceSchema = z.object({ projectId: z.string().min(1, '참여한 팀을 선택해 주세요.'), title: z.string().trim().min(1, '기록의 제목을 입력해 주세요.').max(80), role: z.string().trim().min(1, '맡았던 역할을 입력해 주세요.').max(80), description: z.string().trim().min(5, '5자 이상 기록해 주세요.').max(2000), isPublic: z.boolean() });
export function ExperienceScreen() {
    const params = useLocalSearchParams<{ id?: string; projectId?: string }>();
    const teams = usePagedData('teams.history', {});
    const records = usePagedData('experiences.list', {}, !!params.id);
    const { run, pending } = useCommand();
    const { confirm } = useRuntime();
    const { control, handleSubmit, setValue, watch, reset, formState: { errors, isDirty } } = useForm<z.infer<typeof experienceSchema>>({
        resolver: zodResolver(experienceSchema),
        defaultValues: { projectId: params.projectId || '', title: '', role: '', description: '', isPublic: false },
    });
    const allowNavigation = useUnsavedChanges(isDirty);
    const [loadedRecordId, setLoadedRecordId] = useState<string>();
    const record = records.data?.items.find(item => item.id === params.id);
    const { fetchNextPage, hasNextPage, isFetchingNextPage, error: recordsError } = records;
    // Deep links can refer to a record beyond the first page. Never offer a blank
    // edit form while the requested record is still being resolved.
    useEffect(() => {
        if (params.id && !record && hasNextPage && !isFetchingNextPage && !recordsError)
            void fetchNextPage();
    }, [params.id, record, hasNextPage, isFetchingNextPage, recordsError, fetchNextPage]);
    useEffect(() => {
        if (record && !isDirty) {
            reset({ projectId: record.projectId, title: record.title, role: record.role, description: record.description, isPublic: record.isPublic });
            setLoadedRecordId(record.id);
        }
    }, [record, reset, isDirty]);
    const title = params.id ? '경험 수정' : '경험 기록';
    if (params.id && records.error)
        return <Screen title={title}><ErrorState error={records.error} retry={() => void records.refetch()}/></Screen>;
    if (params.id && (records.isLoading || !record && (hasNextPage || isFetchingNextPage) || record && loadedRecordId !== params.id))
        return <Screen title={title}><Loading /></Screen>;
    if (params.id && !record)
        return <Screen title={title}><Empty title="수정할 기록을 찾을 수 없어요" text="이미 삭제했거나 내 계정의 기록이 아닐 수 있어요. 프로필에서 다시 확인해 주세요." actionLabel="내 프로필로" action={() => router.replace('/profile')}/></Screen>;
    return <Screen title={title}>
        <T style={{ fontSize: 28, fontWeight: '700', lineHeight: 40, marginTop: 12, marginBottom: 24 }}>함께한 시간이 나의 경험으로.</T>
        <T style={{ fontWeight: '700', marginBottom: 12 }}>참여한 프로젝트</T>
        {params.id ? <Panel style={{ marginBottom: 20 }}><T style={{ fontWeight: '700' }}>{teams.data?.items.find(project => project.id === record?.projectId)?.title || '이전에 참여한 프로젝트'}</T><T muted style={{ fontSize: 12, lineHeight: 20, marginTop: 8 }}>기존 경험은 처음 기록한 프로젝트에 연결돼요.</T></Panel> : <>{teams.isLoading ? <Loading /> : teams.error ? <ErrorState error={teams.error} retry={() => void teams.refetch()}/> : teams.data?.items.length ? <View style={[s.wrap, { marginBottom: 20 }]}>{teams.data.items.map(project => <Tag key={project.id} active={watch('projectId') === project.id} onPress={() => setValue('projectId', project.id, { shouldValidate: true, shouldDirty: true })}>{project.title}</Tag>)}</View> : <Empty title="아직 참여한 프로젝트가 없어요" text="팀과 함께한 경험을 쌓은 뒤 나의 기록을 남길 수 있어요." actionLabel="프로젝트 찾아보기" action={() => router.push('/explore')}/>}<LoadMore query={teams} label="참여 이력 더 불러오기"/></>}
        {errors.projectId && <T style={{ color: C.danger, fontSize: 12, lineHeight: 20 }}>{errors.projectId.message}</T>}
        {(['title', 'role', 'description'] as const).map((name, i) => <Controller key={name} control={control} name={name} render={({ field }) => <Field label={['기록 제목', '맡았던 역할', '만든 것과 배운 점'][i]} value={field.value} onChangeText={field.onChange} error={errors[name]?.message} multiline={name === 'description'}/>}/>)}
        <Panel style={{ marginBottom: 24 }}><View style={s.between}><View style={{ flex: 1 }}><T style={{ fontWeight: '700' }}>프로필에 공개하기</T><T muted style={{ fontSize: 12, lineHeight: 20, marginTop: 8 }}>직접 선택한 기록만 공개돼요.</T></View><AccountSwitch accessibilityLabel="경험 공개" value={watch('isPublic')} onValueChange={value => setValue('isPublic', value, { shouldDirty: true })} trackColor={{ true: '#557C25', false: C.line }} thumbColor={C.lime}/></View></Panel>
        <Button title="경험 저장" busy={pending} disabled={!params.id && (teams.isLoading || !!teams.error || !teams.data?.items.length)} onPress={handleSubmit(async values => {
            const result = await run('experience.save', { ...values, ...(params.id ? { id: params.id } : {}) }, '경험을 기록했어요.');
            if (result) {
                allowNavigation();
                reset(values);
                router.replace('/profile');
            }
        })}/>
        {params.id && <Button title="경험 삭제" variant="danger" busy={pending} style={{ marginTop: 12 }} onPress={async () => {
            if (await confirm('이 기록을 삭제할까요?', '삭제한 기록은 되돌릴 수 없어요.', '삭제')) {
                const result = await run('experience.delete', { id: params.id! }, '경험을 삭제했어요.');
                if (result) {
                    allowNavigation();
                    router.replace('/profile');
                }
            }
        }}/>}
    </Screen>;
}
export function ReportScreen() { const { id, type } = useLocalSearchParams<{
    id: string;
    type: ReportTarget;
}>(); const [reason, setReason] = useState(''); const [detail, setDetail] = useState(''); const [submitted, setSubmitted] = useState(false); const { run, pending } = useCommand(); const { client } = useRuntime(); if (submitted)
    return <Screen title="신고"><Empty title={client.mode === 'demo' ? '가상 신고를 기록했어요' : '신고를 접수했어요'} text={client.mode === 'demo' ? '데모 기기 내 시나리오입니다. 실제 운영자에게 전달되지 않았어요.' : '운영자가 커뮤니티 규칙에 따라 검토해요. 신고자 정보는 상대방에게 공개되지 않아요.'} icon="shield-checkmark-outline" actionLabel="돌아가기" action={() => router.back()}/></Screen>; return <Screen title="신고하기"><T style={{ fontSize: 28, fontWeight: '700', lineHeight: 40 }}>함께 안전한 연결을 만들어요.</T><T muted style={{ fontSize: 12, lineHeight: 20, marginTop: 16, marginBottom: 24 }}>신고 사유와 상황을 알려주세요. 신고자 정보는 상대방에게 공개되지 않아요. 즉시 위험한 상황이라면 기기 밖에서 신뢰할 수 있는 보호자와 지역 긴급기관의 도움을 받으세요.</T><View style={[s.wrap, { marginBottom: 24 }]}>{['괴롭힘·혐오', '부적절한 콘텐츠', '개인정보 노출', '스팸·사기', '기타'].map(v => <Tag key={v} active={v === reason} onPress={() => setReason(v)}>{v}</Tag>)}</View><Field label="상황 설명 · 선택" value={detail} onChangeText={setDetail} multiline maxLength={2000} placeholder="검토에 필요한 상황만 적어주세요."/><Button title={client.mode === 'demo' ? '가상 신고 기록하기' : '신고 제출'} busy={pending} disabled={!reason || !['profile', 'project', 'message'].includes(type)} onPress={async () => { const r = await run('report.create', { targetType: type, targetId: id, reason, detail }); if (r)
    setSubmitted(true); }}/></Screen>; }
export function BlockedScreen() {
    const blocked = usePagedData('blocks.list', {});
    const { run, pending } = useCommand();
    const { confirm } = useRuntime();
    return <Screen title="차단한 사용자">
        <T muted style={{ fontSize: 14, lineHeight: 24, marginBottom: 20 }}>차단한 사용자와는 새로운 신청·초대·추천이 제한돼요. 같은 팀의 기존 기록은 남을 수 있어요.</T>
        {blocked.isLoading ? <Loading /> : blocked.error ? <ErrorState error={blocked.error} retry={() => void blocked.refetch()}/> : blocked.data?.items.length ? blocked.data.items.map(b =>
            <Panel key={b.id} style={{ marginBottom: 12 }}>
                <View style={[s.between, { gap: 16 }]}>
                    <T style={{ fontWeight: '700', fontSize: 14, lineHeight: 24, flex: 1, minWidth: 0 }}>{b.nickname}</T>
                    <Button title="차단 해제" variant="secondary" busy={pending} onPress={async () => {
                        if (await confirm('차단을 해제할까요?', '이 사용자와 다시 새로운 연결이 가능해져요.', '해제'))
                            await run('block.set', { userId: b.blockedId, blocked: false }, '차단을 해제했어요.');
                    }}/>
                </View>
            </Panel>
        ) : <Empty title="차단한 사용자가 없어요" text="필요할 때 상대방 프로필에서 차단할 수 있어요. 해제할 사용자도 이곳에서 관리해요." icon="shield-checkmark-outline"/>}
        <LoadMore query={blocked}/>
    </Screen>;
}
export function SettingsScreen() {
    const { client, actor, chooseActor, reset, confirm, scenario, setScenario, toast } = useRuntime();
    const [busy, setBusy] = useState(false);
    const [demoOpen, setDemoOpen] = useState(false);
    const demo = client.mode === 'demo';
    const roles = [
        ['A', 'A · 팀장', '프로젝트를 만들고 팀을 운영해요'],
        ['B', 'B · 지원자', '관심 있는 팀에 참여를 신청해요'],
        ['C', 'C · 초대받는 팀원', '받은 초대를 확인하고 합류해요'],
    ] as const;
    return <Screen title="설정">
        <Panel>
            <View style={[s.row, { gap: 12 }]}><Icon name={demo ? 'flask-outline' : 'cloud-outline'} color={C.lime} size={22}/><T style={{ fontWeight: '700', fontSize: 20, lineHeight: 28 }}>{demo ? '데모 체험 모드' : '서버 연결 모드'}</T></View>
            <T muted style={{ fontSize: 14, lineHeight: 24, marginTop: 12 }}>{demo ? '실제 계정 및 서버에 연결되지 않아요. 가상 프로필과 활동 기록은 이 기기에 저장되며 다음 실행에도 이어져요.' : '인증과 데이터는 설정된 서버에서 처리돼요. 연결에 문제가 생겨도 데모로 자동 전환하지 않아요.'}</T>
        </Panel>
        <Section title="앱 설정"><AccountMenu items={[
            { title: '알림 설정', subtitle: '팀 활동과 신청·초대 소식', icon: 'notifications-outline', onPress: () => router.push('/notification-settings') },
            { title: '커뮤니티 참여', icon: 'people-outline', onPress: () => router.push('/community') },
            { title: '약관 · 개인정보 · 커뮤니티 규칙', icon: 'shield-checkmark-outline', onPress: () => router.push('/legal') },
        ]}/></Section>
        {demo && <Pressable accessibilityRole="button" accessibilityLabel="데모 설정" accessibilityState={{ expanded: demoOpen }} aria-expanded={demoOpen}
            onPress={() => setDemoOpen(previous => !previous)} style={({ pressed }) => [s.panel, { marginTop: 24, minHeight: 80, flexDirection: 'row', alignItems: 'center', gap: 12, backgroundColor: pressed ? C.raised : C.card }]}>
            <Icon name="flask-outline" size={20} color={C.muted}/>
            <View style={{ flex: 1, minWidth: 0 }}><T style={{ fontSize: 16, lineHeight: 24, fontWeight: '700' }}>데모 설정</T><T muted style={{ fontSize: 12, lineHeight: 20, marginTop: 4 }}>역할 전환 · 상태 체험 · 가상 데이터 관리</T></View>
            <Icon name={demoOpen ? 'chevron-up' : 'chevron-down'} size={18} color={C.muted}/>
        </Pressable>}
        {demo && demoOpen && <>
            <Section title="가상 역할 전환">
                <T muted style={{ fontSize: 14, lineHeight: 24, marginBottom: 16 }}>같은 기기에서 역할을 바꾸며 팀이 만들어지는 과정을 체험해 보세요.</T>
                <View style={{ gap: 8 }}>{roles.map(([key, label, description]) =>
                    <Pressable key={key} accessibilityRole="button" accessibilityLabel={label} accessibilityState={{ selected: actor === key, disabled: busy }} aria-pressed={actor === key} disabled={busy}
                        onPress={async () => {
                            setBusy(true);
                            try { await chooseActor(key); router.replace('/'); }
                            catch { toast('역할을 전환하지 못했어요.'); }
                            finally { setBusy(false); }
                        }}
                        style={({ pressed }) => [s.row, { minHeight: 76, paddingHorizontal: 16, paddingVertical: 12, gap: 12,
                            borderRadius: 16, borderWidth: 1, borderColor: actor === key ? C.lime : C.line,
                            backgroundColor: actor === key ? C.raised : C.card, opacity: busy || pressed ? .65 : 1 }]}>
                        <View style={{ width: 40, height: 40, borderRadius: 12, alignItems: 'center', justifyContent: 'center', backgroundColor: C.raised }}><T style={{ fontWeight: '700', color: actor === key ? C.lime : C.muted }}>{key}</T></View>
                        <View style={{ flex: 1, minWidth: 0 }}><T style={{ fontWeight: '700', fontSize: 14, lineHeight: 24 }}>{label}</T><T muted style={{ fontSize: 12, lineHeight: 20, marginTop: 4 }}>{description}</T></View>
                        <Icon name={actor === key ? 'checkmark-circle' : 'ellipse-outline'} color={actor === key ? C.lime : C.muted} size={22}/>
                    </Pressable>
                )}</View>
                <T muted style={{ fontSize: 12, lineHeight: 20, marginTop: 12 }}>실제 사용자 간 인증이나 통신은 발생하지 않아요.</T>
            </Section>
            <Section title="화면 상태 체험">
                <Panel>
                    <View style={s.wrap}>{([['normal', '정상'], ['empty', '빈 상태'], ['offline', '오프라인'], ['error', '서버 오류']] as const).map(([key, label]) =>
                        <Tag key={key} active={scenario === key} onPress={() => { setScenario(key); toast(label + ' 상황을 선택했어요.'); }}>{label}</Tag>
                    )}</View>
                    <T muted style={{ fontSize: 12, lineHeight: 20, marginTop: 12 }}>선택한 상황이 다른 화면에 적용돼요. 체험을 마치면 ‘정상’으로 되돌려 주세요.</T>
                </Panel>
            </Section>
        </>}
        {(!demo || demoOpen) && <Section title={demo ? '데모 데이터 관리' : '계정 관리'}><AccountMenu items={[
            ...(demo ? [{ title: '데모 데이터 초기화', subtitle: '이 기기의 가상 활동을 처음부터 시작해요', icon: 'refresh-outline' as const, onPress: async () => {
                if (await confirm('데모를 처음부터 시작할까요?', '이 기기에서 만든 가상 프로젝트·신청·대화·기록이 초기화돼요.', '데모 초기화')) await reset();
            } }] : []),
            { title: demo ? '가상 계정 삭제 시나리오' : '계정 삭제', icon: 'person-remove-outline', danger: true, onPress: () => router.push('/account-delete') },
            ...(!demo ? [{ title: '로그아웃', icon: 'log-out-outline' as const, onPress: async () => {
                try { await logout(client as SupabaseDataClient); router.replace('/auth'); }
                catch (e) { toast(e instanceof AppError ? e.message : '로그아웃하지 못했어요. 다시 시도해 주세요.'); }
            } }] : []),
        ]}/></Section>}
        <T muted style={{ textAlign: 'center', fontSize: 12, lineHeight: 20, marginTop: 32 }}>인터링크 · 버전 {Constants.expoConfig?.version || '0.1.5'}</T>
    </Screen>;
}
export function DeleteAccountScreen() { const status = useData('account.status', {}); const { client, reset, confirm, toast } = useRuntime(); const { run, pending } = useCommand(); const [text, setText] = useState(''); const [processing, setProcessing] = useState(false); const cache = useQueryClient(); const deletion = status.data?.deletionStatus;
    if (status.isLoading) return <Screen title="계정 삭제"><Loading /></Screen>;
    if (status.error) return <Screen title="계정 삭제"><ErrorState error={status.error} retry={() => void status.refetch()}/></Screen>;
    return <Screen title="계정 삭제"><T style={{ fontSize: 28, fontWeight: '700', lineHeight: 40 }}>{client.mode === 'demo' ? '가상 계정 삭제를 체험해요' : '계정을 삭제하시겠어요?'}</T><T muted style={{ fontSize: 14, lineHeight: 24, marginTop: 16, marginBottom: 24 }}>{client.mode === 'demo' ? '기기 안의 가상 데이터에만 적용돼요. 실제 계정이나 서버 데이터는 삭제되지 않아요.' : '프로필·참여 상태·기기 토큰 등은 삭제 절차에 따라 처리돼요. 완료 전까지 요청·처리 중·실패 상태를 구분해 표시해요.'}</T><Panel><T style={{ fontWeight: '700' }}>운영하는 팀은 보관 처리돼요</T><T muted style={{ fontSize: 12, lineHeight: 20, marginTop: 8 }}>계속 운영할 팀이 있다면 먼저 멤버 화면에서 팀장 권한을 이전하세요. 새로운 신청·초대·알림은 제한되며 일부 기록의 보존 범위는 공개 전 정책 검토 대상이에요.</T></Panel>{deletion ? <View style={{ marginTop: 24 }}><Tag active>{({ requested: '삭제 요청됨', processing: '삭제 처리 중', completed: '삭제 완료', failed: '삭제 실패 · 재시도 필요' } as const)[deletion]}</Tag><T muted style={{ fontSize: 12, lineHeight: 20, marginVertical: 16 }}>{deletion === 'completed' ? '삭제 작업이 완료되었어요.' : deletion === 'failed' ? '삭제 작업 일부가 실패했어요. 처리 상태를 다시 확인하거나 운영 지원 절차를 이용해 주세요.' : '삭제 요청이 접수되었어요. 작업 완료 전까지 삭제 완료로 표시하지 않아요.'}</T>{client.mode === 'demo' && deletion !== 'completed' && <Button title="데모 삭제 처리 진행" busy={processing} onPress={async () => { setProcessing(true); try {
    await (client as DemoClient).processDeletion();
    await cache.invalidateQueries();
}
catch {
    toast('가상 삭제 작업을 처리하지 못했어요.');
}
finally {
    setProcessing(false);
} }}/>}<Button title={client.mode === 'demo' && deletion === 'completed' ? '데모 초기화 후 다시 시작' : '처리 상태 새로고침'} variant="secondary" style={{ marginTop: 12 }} onPress={() => client.mode === 'demo' && deletion === 'completed' ? void reset() : void status.refetch()}/></View> : <><View style={{ marginTop: 24 }}><Field label="확인을 위해 DELETE 입력" value={text} onChangeText={setText} autoCapitalize="characters" placeholder="DELETE"/></View>{client.mode === 'supabase' && <Button title="이메일로 본인 확인" variant="secondary" onPress={() => router.push({ pathname: '/auth', params: { returnTo: '/account-delete' } })} style={{ marginBottom: 12 }}/>}<Button title={client.mode === 'demo' ? '가상 계정 삭제 요청' : '계정 삭제 요청'} variant="danger" busy={pending} disabled={text !== 'DELETE'} onPress={async () => { if (await confirm('삭제를 요청할까요?', client.mode === 'demo' ? '기기 안의 가상 계정 삭제를 요청해요.' : '요청 후에는 새로운 활동이 제한돼요. 최근 이메일 본인 확인이 필요해요.', '삭제 요청'))
    await run('account.delete', { confirmation: 'DELETE', ownedTeams: 'archive' }, client.mode === 'demo' ? '가상 삭제를 요청했어요.' : '삭제를 요청했어요.'); }}/></>}</Screen>; }
export function AuthScreen() { const { returnTo } = useLocalSearchParams<{
    returnTo?: string;
}>(); const { client, toast } = useRuntime(); const cache = useQueryClient(); const [email, setEmail] = useState(''); const [token, setToken] = useState(''); const [sent, setSent] = useState(false); const [busy, setBusy] = useState(false); const [error, setError] = useState(''); const [cooldown, setCooldown] = useState(0); useEffect(() => { if (!cooldown)
    return; const timer = setTimeout(() => setCooldown(v => v - 1), 1000); return () => clearTimeout(timer); }, [cooldown]); const send = async () => { if (client.mode !== 'supabase')
    return; setBusy(true); setError(''); try {
    await (client as SupabaseDataClient).requestOtp(email);
    setSent(true);
    setCooldown(60);
    toast('인증 메일을 요청했어요. 받은 편지함을 확인해 주세요.');
}
catch (e) {
    setError(e instanceof AppError ? e.message : '인증 메일 요청에 실패했어요.');
}
finally {
    setBusy(false);
} }; return <Screen title="이메일로 연결 시작"><T style={{ fontSize: 28, fontWeight: '700', lineHeight: 40, marginTop: 16, marginBottom: 16 }}>나의 가능성이{'\n'}우리의 가능성으로.</T><T muted style={{ fontSize: 14, lineHeight: 24, marginBottom: 32 }}>이메일의 일회용 인증코드로 로그인해요. 이메일 인증은 학생·연령·신원 인증을 의미하지 않아요.</T>{client.mode === 'demo' ? <Panel><T style={{ color: C.lime, fontWeight: '700' }}>현재 데모 체험 모드예요</T><T muted style={{ fontSize: 12, lineHeight: 20, marginVertical: 16 }}>실제 이메일을 입력하거나 인증 메일을 보내지 않아요. 설정에서 가상 역할을 선택해 주세요.</T><Button title="가상 역할 선택" onPress={() => router.replace('/settings')}/></Panel> : <><Field label="이메일" value={email} onChangeText={setEmail} keyboardType="email-address" autoCapitalize="none" autoCorrect={false} placeholder="메일 주소" editable={!busy}/>{sent && <Field label="인증코드" value={token} onChangeText={setToken} keyboardType="number-pad" autoComplete="one-time-code" maxLength={10} hint="메일에 안내된 6~10자리 코드를 입력해 주세요."/>}{error && <T accessibilityRole="alert" style={{ color: C.danger, fontSize: 14, lineHeight: 24, marginBottom: 16 }}>{error}</T>}{sent ? <><Button title="인증하고 계속하기" busy={busy} disabled={!/^\d{6,10}$/.test(token)} onPress={async () => { setBusy(true); setError(''); try {
    await (client as SupabaseDataClient).verifyOtp(email, token);
    cache.clear();
    router.replace(returnTo?.startsWith('/') && !returnTo.startsWith('//') ? returnTo : '/');
}
catch (e) {
    setError(e instanceof AppError ? e.message : '코드를 확인하지 못했어요. 만료되었다면 다시 요청해 주세요.');
}
finally {
    setBusy(false);
} }}/><Button title={cooldown ? '코드 재요청 · ' + cooldown + '초' : '코드 다시 요청'} variant="ghost" disabled={cooldown > 0} busy={busy} onPress={() => void send()}/></> : <Button title="인증코드 받기" busy={busy} disabled={!z.string().email().safeParse(email).success} onPress={() => void send()}/>}<T muted style={{ fontSize: 12, lineHeight: 20, marginTop: 24 }}>로그인 후 승인된 커뮤니티 참여 절차가 필요해요. 외부 인증·메일 제공자의 설정이 완료된 환경에서만 사용할 수 있어요.</T></>}</Screen>; }
export function CommunityScreen() { const [code, setCode] = useState(''); const { run, pending } = useCommand(); const { client } = useRuntime(); const boot = useData('bootstrap', {}); return <Screen title="커뮤니티 참여"><Panel><T style={{ fontWeight: '700', fontSize: 20, lineHeight: 28 }}>{boot.data?.community?.name || '승인된 커뮤니티에 참여하세요'}</T><T muted style={{ fontSize: 12, lineHeight: 20, marginTop: 12 }}>인터링크는 승인된 커뮤니티 안에서 연결을 시작해요. 참여 코드는 범위·유효기간·사용 횟수를 서버에서 확인해요.</T></Panel><View style={{ marginTop: 24 }}><Field label="커뮤니티 초대코드" value={code} onChangeText={setCode} autoCapitalize="none" placeholder="운영자가 전달한 코드"/></View><Button title="커뮤니티 참여" busy={pending} disabled={code.trim().length < 8} onPress={() => void run('community.join', { code }, '커뮤니티에 참여했어요.')}/>{client.mode === 'demo' && <T muted style={{ fontSize: 12, lineHeight: 20, marginTop: 20 }}>현재 가상 커뮤니티가 선택되어 있어요. 모바일과 운영 웹 데모는 독립된 저장소여서 웹의 가상 코드로 가입할 수 없어요. 실제 연동 후에는 같은 서버의 코드를 사용해요.</T>}</Screen>; }
export function NotificationSettingsScreen() {
    const preferences = useData('notifications.preferences', {});
    const { run, pending } = useCommand();
    const { client, toast } = useRuntime();
    const p = preferences.data;
    return <Screen title="알림 설정" subtitle="받고 싶은 소식만 선택하세요">
        <T muted style={{ fontSize: 14, lineHeight: 24, marginBottom: 24 }}>잠금 화면에는 대화 본문을 기본 표시하지 않아요. 필요한 연결 소식만 편하게 받아보세요.</T>
        {preferences.isLoading ? <Loading /> : preferences.error ? <ErrorState error={preferences.error} retry={() => void preferences.refetch()}/> : p ?
            <Panel style={{ paddingHorizontal: 16, paddingVertical: 0 }}>
                {([['team', '팀 활동', '팀 변경과 새로운 대화'], ['applications', '신청·초대', '참여 신청과 초대의 응답'], ['push', '기기 푸시', '앱 밖에서도 연결 소식 받기']] as const).map(([key, label, description], index) =>
                    <View key={key} style={[s.between, { minHeight: 88, paddingVertical: 20, gap: 16, borderBottomWidth: index < 2 ? 1 : 0, borderBottomColor: C.line }]}>
                        <View style={{ flex: 1, minWidth: 0 }}><T style={{ fontWeight: '700', fontSize: 14, lineHeight: 24 }}>{label}</T><T muted style={{ fontSize: 12, lineHeight: 20, marginTop: 4 }}>{description}</T></View>
                        <AccountSwitch accessibilityLabel={label + ' 알림'} value={p[key]} disabled={pending} onValueChange={value => void run('notification.preferences', { ...p, [key]: value })} trackColor={{ true: '#557C25', false: C.line }} thumbColor={C.lime}/>
                    </View>
                )}
            </Panel> : <Empty title="설정을 불러오지 못했어요" text="알림 설정을 다시 불러와 주세요." action={() => void preferences.refetch()}/>
        }
        {client.mode === 'demo' ? <Panel style={{ marginTop: 24 }}>
            <View style={[s.row, { alignItems: 'flex-start', gap: 12 }]}><Icon name="information-circle-outline" color={C.lime} size={21}/><View style={{ flex: 1 }}><T style={{ fontSize: 14, fontWeight: '700', lineHeight: 24 }}>데모 알림은 이 기기 안에서만</T><T muted style={{ fontSize: 12, lineHeight: 20, marginTop: 8 }}>실제 푸시 권한·기기 토큰을 요청하거나 알림을 발송하지 않아요.</T></View></View>
        </Panel> : <View style={{ marginTop: 24 }}>
            <T muted style={{ fontSize: 14, lineHeight: 24, marginBottom: 16 }}>기기 알림을 허용하면 참여 신청과 팀 활동 소식을 받을 수 있어요. 거부해도 앱 안에서 확인할 수 있어요.</T>
            <Button title="기기 알림 권한 설정" onPress={async () => {
                try { await registerPush(client as SupabaseDataClient); toast('기기 알림 설정을 확인했어요.'); }
                catch (e) { toast(e instanceof AppError ? e.message : '기기 알림 설정에 실패했어요.'); }
            }}/>
        </View>}
    </Screen>;
}
export function LegalScreen() { return <Screen title="함께 안전하게 연결하기"><Tag active>공개 전 검토용 초안</Tag><Section title="이용약관"><T style={s.body}>인터링크는 승인된 학생 커뮤니티에서 프로젝트 팀을 만드는 도구예요. 타인을 존중하고, 모집 목적과 역할을 사실대로 소개해 주세요. 수상·경력·신원 등을 검증한 서비스로 해석하지 않아요.</T></Section><Section title="개인정보처리방침"><T style={s.body}>실제 연결 시 이메일 인증 정보와 공개 범위를 선택한 프로필, 참여·대화·신고·기기 알림 데이터를 처리해요. 공개 학번·전화번호·정확한 위치를 요구하지 않아요. 실제 운영 주체·연락처·보관 기간·수탁사·국외 이전 조건은 아직 미확정이며 공개 출시 전에 확정되어야 해요.</T></Section><Section title="커뮤니티 규칙"><T style={s.body}>괴롭힘·차별·혐오·성적 착취·개인정보 유출·사칭·스팸을 허용하지 않아요. 개인 연락처나 민감한 정보를 강요하지 마세요. 문제가 생기면 신고·차단을 이용할 수 있어요. 같은 팀의 기존 기록과 접근 권한은 별도 처리될 수 있어요.</T></Section><Section title="지원과 신고 처리"><T style={s.body}>프로필·프로젝트·대화에서 필요한 내용만 신고해 주세요. 실제 운영자는 신고 대상의 최소 범위를 검토하고 조치 기록을 남겨야 해요. 운영 연락처와 처리 기한은 아직 확정되지 않았어요. 이 데모는 실제 신고 접수 창구가 아니에요.</T></Section><Section title="계정과 기록 삭제"><T style={s.body}>설정에서 본인 확인 후 삭제를 요청할 수 있어요. 소유팀을 이전하거나 보관하고, 데이터·파일·인증 계정 삭제 상태를 확인해요. 법적 보존 사유와 기간은 공개 전 별도 검토 대상이에요.</T></Section><Divider /><T muted style={{ fontSize: 12, lineHeight: 20 }}>이 안내는 편집 가능한 제품 초안입니다. 공개 출시를 위한 법률·운영·연령 적합성 검토가 완료된 상태가 아니에요.</T></Screen>; }
