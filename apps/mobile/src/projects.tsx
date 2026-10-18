import React, { useEffect, useState } from 'react';
import { ActivityIndicator, Share, View, Switch, Pressable, Modal, ScrollView, TextInput, Keyboard } from 'react-native';
import { router, useLocalSearchParams } from 'expo-router';
import { Controller, useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { AppError, PROJECT_PURPOSES, getProjectPurpose, INTERESTS, ROLES, AVAILABILITY, type ProjectPurpose } from '@interlink/shared';
import { Avatar, Button, C, Divider, Empty, ErrorState, Field, Icon, IconButton, Loading, LoadMore, Panel, RowLink, Screen, Section, T, Tag, Tags, s } from './ui';
import { useCommand, useData, useRuntime, useUnsavedChanges, usePagedData } from './runtime';
import { statusName } from './discovery';
import { useTeamActions } from './team-actions';
export function ProjectDetailScreen() {
    const { id } = useLocalSearchParams<{
        id: string;
    }>();
    const detail = useData('projects.detail', { id });
    const boot = useData('bootstrap', {});
    const { run, pending } = useCommand();
    const { confirm, toast } = useRuntime();
    const [more, setMore] = useState(false);
    if (detail.isLoading || boot.isLoading)
        return <Screen title="프로젝트"><Loading /></Screen>;
    if (detail.error instanceof AppError && detail.error.code === 'UNAUTHENTICATED')
        return <Screen title="프로젝트"><Empty title="로그인하고 팀을 만나보세요" text="승인된 커뮤니티의 프로젝트를 확인한 뒤 참여를 신청할 수 있어요." icon="lock-closed-outline" actionLabel="로그인 후 참여 신청" action={()=>router.push({pathname:'/auth',params:{returnTo:'/project/'+id}})}/></Screen>;
    if (detail.error || boot.error || !detail.data)
        return <Screen title="프로젝트"><ErrorState error={detail.error || boot.error} retry={() => { void detail.refetch(); void boot.refetch(); }}/></Screen>;
    const { project: p, members, application, invitation } = detail.data;
    const viewer = boot.data?.viewer;
    const owner = viewer?.id === p.ownerId;
    const member = members.some(m => m.userId === viewer?.id && m.active);
    const expired = new Date(p.deadline).getTime() <= Date.now();
    const open = p.status === 'recruiting' && !expired && p.memberCount < p.capacity;
    const deadline = new Date(p.deadline).toLocaleDateString('ko-KR', { month: 'long', day: 'numeric', timeZone: 'Asia/Seoul' });
    const closedReason = p.memberCount >= p.capacity ? '모든 자리에 팀원이 연결되었어요.' : expired ? '모집 기한이 지났어요.' : '모집 중인 프로젝트가 아니에요.';
    const footer = <View style={{ gap: 12 }}>
        {!viewer ? <Button title="로그인 후 참여 신청" onPress={() => router.push({ pathname: '/auth', params: { returnTo: '/project/' + id } })}/>
        : owner ? <View style={[s.row, { alignItems: 'stretch' }]}>
            {p.status === 'draft' ? <Button title="모집 시작하기" busy={pending} style={{ flex: 1, paddingHorizontal: 12 }} onPress={() => void run('project.transition', { id, status: 'recruiting' }, '모집을 시작했어요.')}/>
            : <Button title="신청자 관리" style={{ flex: 1, paddingHorizontal: 12 }} onPress={() => router.push('/applications/' + id)}/>}
            <Button title="팀 공간 열기" variant="secondary" style={{ flex: 1, paddingHorizontal: 12 }} onPress={() => router.push('/team/' + id)}/>
        </View>
        : member ? <Button title="팀 공간 열기" icon="arrow-forward" onPress={() => router.push('/team/' + id)}/>
        : invitation?.status === 'pending' ? <View style={s.row}>
            <Button title="초대 수락" busy={pending} style={{ flex: 1 }} onPress={() => void run('invitation.respond', { id: invitation.id, decision: 'accepted' }, '초대를 수락했어요. 팀 공간에서 대화를 시작하세요.')}/>
            <Button title="거절" variant="secondary" busy={pending} onPress={() => void run('invitation.respond', { id: invitation.id, decision: 'declined' })}/>
        </View>
        : application?.status === 'pending' ? <Button title="신청 철회" variant="secondary" busy={pending} onPress={async () => {
            if (await confirm('신청을 철회할까요?', '아직 승인되지 않은 참여 신청을 취소해요.', '신청 철회')) await run('application.withdraw', { id: application.id }, '신청을 철회했어요.');
        }}/>
        : open ? <><View style={s.between}><T style={{ fontSize: 12, fontWeight: '700' }}>함께할 자리 {p.capacity - p.memberCount}명</T><T muted style={{ fontSize: 12 }}>{deadline} 마감</T></View><Button title="참여 신청하기" icon="arrow-forward" onPress={() => router.push('/apply/' + id)}/></>
        : <View style={[s.row, { paddingVertical: 3 }]}><Icon name="information-circle-outline" color={C.muted}/><View style={{ flex: 1 }}><T style={{ fontWeight: '700' }}>지금은 신청할 수 없어요</T><T muted style={{ fontSize: 12, lineHeight: 20, marginTop: 4 }}>{closedReason}</T></View></View>}
    </View>;
    return <Screen title="프로젝트" footer={footer} right={<Pressable accessibilityRole="button" accessibilityLabel="프로젝트 더보기" accessibilityState={{ expanded: more }} onPress={() => setMore(!more)} style={({ pressed }) => [s.iconButton, pressed && { backgroundColor: C.raised }]}><Icon name="ellipsis-horizontal"/></Pressable>}>
        {more && <Panel style={{ marginBottom: 24, paddingVertical: 0 }}><RowLink title={p.saved ? '저장 해제' : '프로젝트 저장'} icon={p.saved ? 'bookmark' : 'bookmark-outline'} onPress={async () => { if (await run('project.save', { id, saved: !p.saved })) setMore(false); }}/><RowLink title="프로젝트 공유" icon="share-outline" onPress={() => { setMore(false); void Share.share({ message: p.title + '\n인터링크에서 함께해요. interlink://project/' + id }).catch(() => toast('공유 창을 열지 못했어요.')); }}/><RowLink title="프로젝트 신고" icon="flag-outline" onPress={() => router.push({ pathname: '/report', params: { type: 'project', id } })}/>{owner && <RowLink title="모집글 수정" icon="create-outline" onPress={() => router.push({ pathname: '/project/edit', params: { id } })}/>}</Panel>}
        <View style={s.wrap}><Tag active={open}>{p.status === 'recruiting' && !open ? expired ? '모집 마감' : '정원 마감' : statusName[p.status]}</Tag>{getProjectPurpose(p) && <Tag>{getProjectPurpose(p)}</Tag>}{p.beginnerFriendly && <Tag>초보자 환영</Tag>}</View>
        <T style={{ fontSize: 28, lineHeight: 40, fontWeight: '700', letterSpacing: -1, marginTop: 16 }}>{p.title}</T>
        <T muted style={{ lineHeight: 24, fontSize: 14, marginTop: 12 }}>{p.goal}</T>
        <Panel style={{ flexDirection: 'row', gap: 16, marginTop: 24 }}>
            <View style={{ flex: 1, minWidth: 0 }}><T muted style={{ fontSize: 12, lineHeight: 20 }}>참여 인원</T><T style={{ fontSize: 24, lineHeight: 36, fontWeight: '700', marginTop: 4 }}>{p.memberCount}<T muted style={{ fontSize: 14 }}> / {p.capacity}명</T></T><T muted style={{ fontSize: 12, lineHeight: 20, marginTop: 4 }}>팀장을 포함한 정원</T></View>
            <View style={{ width: 1, backgroundColor: C.line }}/>
            <View style={{ flex: 1, minWidth: 0 }}><T muted style={{ fontSize: 12, lineHeight: 20 }}>모집 마감</T><T style={{ fontSize: 20, lineHeight: 36, fontWeight: '700', marginTop: 4 }}>{deadline}</T><T muted style={{ fontSize: 12, lineHeight: 20, marginTop: 4 }}>한국 시간 {new Date(p.deadline).toLocaleTimeString('ko-KR', { hour: '2-digit', minute: '2-digit', hour12: false, timeZone: 'Asia/Seoul' })}</T></View>
        </Panel>
        {!owner && !member && invitation?.status === 'pending' && <Panel style={{ marginTop: 20 }}><View style={s.row}><Icon name="mail-unread-outline" color={C.lime}/><T style={{ fontWeight: '700' }}>이 팀에서 초대가 왔어요</T></View><T muted style={{ fontSize: 14, lineHeight: 24, marginTop: 12 }}>{invitation.message || '초대를 수락하면 이 팀에 참여할 수 있어요.'}</T><T style={{ color: C.lime, fontSize: 12, marginTop: 12 }}>초대받은 역할 · {invitation.role}</T></Panel>}
        {!owner && !member && invitation?.status !== 'pending' && application?.status === 'pending' && <Panel style={{ marginTop: 20 }}><View style={s.row}><Icon name="time-outline" color={C.lime}/><T style={{ fontWeight: '700' }}>신청을 검토하고 있어요</T></View><T muted style={{ fontSize: 14, lineHeight: 24, marginTop: 8 }}>팀장이 응답하면 알림으로 알려드려요.</T></Panel>}
        <Section title="함께 만들고 싶은 것" spacing={32}><T style={{ fontSize: 14, lineHeight: 24 }}>{p.description}</T></Section>
        <Section title="이런 역할을 기다려요" spacing={32}><Tags values={p.roles}/><T muted style={{ fontSize: 12, lineHeight: 20, marginTop: 12 }}>잘하는 일도, 배우고 싶은 일도 좋아요. 역할은 팀원들과 이야기하며 맞춰가요.</T></Section>
        <Section title="우리의 활동 방식" spacing={32}><View style={[s.row, { marginBottom: 20 }]}><Icon name="globe-outline" size={20} color={C.muted}/><T style={{ flex: 1 }}>{p.activityMode === 'online' ? '어디서든, 온라인' : p.activityMode === 'offline' ? '함께 모여, 오프라인' : '온라인과 오프라인을 함께'}</T></View><T muted style={{ fontSize: 12, lineHeight: 20, marginBottom: 8 }}>함께하는 시간</T><Tags values={p.availability}/><T muted style={{ fontSize: 12, lineHeight: 20, marginBottom: 8, marginTop: 20 }}>관심 분야</T><Tags values={p.interests}/></Section>
        <Section title={'지금 함께하는 ' + members.filter(m => m.active).length + '명'} spacing={32}>{members.filter(m => m.active).map(m => <Pressable key={m.id} accessibilityRole="button" accessibilityLabel={m.nickname + ' 프로필 보기'} onPress={() => router.push('/person/' + m.userId)} style={({ pressed }) => [s.row, { gap: 12, paddingVertical: 16, borderBottomWidth: 1, borderColor: C.line, opacity: pressed ? .7 : 1 }]}><Avatar avatar={m.avatar} name={m.nickname}/><View style={{ flex: 1 }}><T style={{ fontWeight: '700' }}>{m.nickname}{m.userId === p.ownerId ? ' · 팀장' : ''}</T><T muted style={{ fontSize: 12, lineHeight: 20, marginTop: 4 }}>{m.role}</T></View><Icon name="chevron-forward" color={C.muted} size={16}/></Pressable>)}</Section>
    </Screen>;
}
const splitTags = (value: string) => value.split(',').map(item => item.trim()).filter(Boolean);
const isPurpose = (value: string): value is ProjectPurpose => PROJECT_PURPOSES.includes(value as ProjectPurpose);
const tagField = (message: string) => z.string().trim().refine(value => splitTags(value).length > 0, message).refine(value => splitTags(value).length <= 20 && splitTags(value).every(item => item.length <= 40), '각 항목은 40자 이내, 최대 20개까지 입력해 주세요.');
const projectSchema = z.object({
    purpose: z.enum([...PROJECT_PURPOSES, '기타']),
    title: z.string().trim().min(4, '제목을 4자 이상 입력해 주세요.').max(80, '제목은 80자까지 입력할 수 있어요.'),
    goal: z.string().trim().min(5, '목표를 5자 이상 알려주세요.').max(200, '목표는 200자까지 입력할 수 있어요.'),
    description: z.string().trim().min(20, '프로젝트 설명을 20자 이상 입력해 주세요.').max(3000, '소개는 3,000자까지 입력할 수 있어요.'),
    interests: z.string().trim().refine(value => splitTags(value).length <= 20 && splitTags(value).every(item => item.length <= 40), '각 항목은 40자 이내, 최대 20개까지 입력해 주세요.'), roles: tagField('필요한 역할을 입력해 주세요.'),
    capacity: z.string().refine(value => Number.isInteger(Number(value)) && Number(value) >= 2 && Number(value) <= 20, '팀장을 포함해 2~20명으로 입력해 주세요.'),
    availability: tagField('가능한 시간을 알려주세요.'),
    deadline: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'YYYY-MM-DD 형식으로 입력해 주세요.').refine(value => !Number.isNaN(Date.parse(value)) && new Date(value).toISOString().slice(0, 10) === value, '유효한 날짜를 입력해 주세요.'),
    activityMode: z.enum(['online', 'offline', 'hybrid']), beginnerFriendly: z.boolean(),
}).superRefine((values, context) => {
    const interests = splitTags(values.interests);
    if (values.purpose === '기타' && interests.length === 0) context.addIssue({ code: 'custom', path: ['interests'], message: '관심 분야를 입력해 주세요.' });
    if (interests.some(value => isPurpose(value) && value !== values.purpose)) context.addIssue({ code: 'custom', path: ['interests'], message: '모집 목적은 위에서 선택하고, 관심 분야에는 전공이나 기술을 입력해 주세요.' });
    if (new Set([...interests, ...(values.purpose === '기타' ? [] : [values.purpose])]).size > 20) context.addIssue({ code: 'custom', path: ['interests'], message: '모집 목적을 포함해 관심 분야는 최대 20개까지 선택할 수 있어요.' });
});
type ProjectForm = z.infer<typeof projectSchema>;
const defaults: ProjectForm = { purpose: '조별과제', title: '', goal: '', description: '', interests: '', roles: '', capacity: '4', availability: '주말', deadline: new Date(Date.now() + 30 * 86400000).toISOString().slice(0, 10), activityMode: 'online', beginnerFriendly: true };
function projectInterests(values: ProjectForm, original: string[] = []) {
    const retained = values.purpose === (getProjectPurpose({ interests: original }) || '기타') ? original.filter(isPurpose) : [];
    return [...new Set([...(values.purpose === '기타' ? [] : [values.purpose]), ...retained, ...splitTags(values.interests).filter(value => !isPurpose(value))])];
}
function ChoiceInput({ label, options, value, onChange, onBlur, inputRef, error }: { label: string; options: readonly string[]; value: string; onChange: (value: string) => void; onBlur: () => void; inputRef: React.ComponentProps<typeof TextInput>['ref']; error?: string }) {
    const [focused, setFocused] = useState(false);
    const selected = splitTags(value);
    const choices = [...new Set([...options, ...selected])];
    return <View style={{ marginBottom: 24 }}><T style={{ fontSize: 14, fontWeight: '700', marginBottom: 12 }}>{label}</T><View style={[s.wrap, { marginBottom: 12 }]}>{choices.map(option => <Tag key={option} active={selected.includes(option)} onPress={() => onChange((selected.includes(option) ? selected.filter(item => item !== option) : [...selected, option]).join(', '))}>{option}</Tag>)}</View><TextInput ref={inputRef} accessibilityLabel={label} accessibilityHint={error || '목록에 없는 항목은 직접 입력하고, 여러 항목은 쉼표로 구분해 주세요.'} value={value} onChangeText={onChange} onFocus={() => setFocused(true)} onBlur={() => { setFocused(false); onBlur(); }} placeholder="직접 입력하거나 선택한 항목 수정" placeholderTextColor={C.muted} selectionColor={C.lime} style={[s.input, { fontFamily: 'NotoSansKR_400Regular', fontSize: 14 }, focused && { borderColor: '#87A660' }, error && { borderColor: C.danger }]}/><T muted style={{ fontSize: 12, lineHeight: 20, marginTop: 8 }}>목록에 없는 항목은 직접 입력해 주세요. 여러 항목은 쉼표로 구분해요.</T>{error && <T accessibilityRole="alert" style={{ color: C.danger, fontSize: 12, lineHeight: 20, marginTop: 8 }}>{error}</T>}</View>;
}
function FormSection({ number, title, children }: { number: string; title: string; children: React.ReactNode }) {
    return <View style={{ marginTop: 32 }}><View style={[s.row, { gap: 12, marginBottom: 20 }]}><View style={{ width: 32, height: 32, borderRadius: 12, borderWidth: 1, borderColor: C.line, backgroundColor: C.card, alignItems: 'center', justifyContent: 'center' }}><T muted style={{ fontSize: 12, fontWeight: '700' }}>{number}</T></View><T accessibilityRole="header" style={{ fontSize: 20, lineHeight: 28, fontWeight: '700', flex: 1 }}>{title}</T><T muted style={{ fontSize: 12 }}>필수</T></View>{children}</View>;
}
export function ProjectFormScreen() {
    const { id, purpose: purposeParam } = useLocalSearchParams<{
        id?: string;
        purpose?: string;
    }>();
    const edit = !!id;
    const detail = useData('projects.detail', { id: id || '' }, edit);
    const boot = useData('bootstrap', {});
    const { run, pending } = useCommand();
    const [preview, setPreview] = useState<ProjectForm | null>(null);
    const routePurpose = typeof purposeParam === 'string' && isPurpose(purposeParam) ? purposeParam : '조별과제';
    const { control, handleSubmit, reset, setValue, setError, watch, formState: { errors, isDirty } } = useForm<ProjectForm>({ resolver: zodResolver(projectSchema), defaultValues: { ...defaults, purpose: edit ? '기타' : routePurpose } });
    const allowNavigation = useUnsavedChanges(isDirty);
    useEffect(() => { if (detail.data && !isDirty) {
        const p = detail.data.project;
        reset({ purpose: getProjectPurpose(p) || '기타', title: p.title, goal: p.goal, description: p.description, interests: p.interests.filter(value => !isPurpose(value)).join(', '), roles: p.roles.join(', '), capacity: String(p.capacity), availability: p.availability.join(', '), deadline: p.deadline.slice(0, 10), activityMode: p.activityMode, beginnerFriendly: p.beginnerFriendly });
    } }, [detail.data, reset, isDirty]);
    const originalInterests = edit ? detail.data?.project.interests || [] : [];
    const validInterests = (values: ProjectForm) => { if (projectInterests(values, originalInterests).length > 20) { setError('interests', { message: '모집 목적을 포함해 관심 분야는 최대 20개까지 선택할 수 있어요.' }, { shouldFocus: true }); return false; } return true; };
    const save = async (values: ProjectForm, draft = false) => { if (!validInterests(values)) return; const { purpose, ...fields } = values; const payload = { ...fields, interests: projectInterests({ purpose, ...fields }, originalInterests), roles: [...new Set(splitTags(values.roles))], availability: [...new Set(splitTags(values.availability))], capacity: Number(values.capacity), deadline: new Date(values.deadline + 'T23:59:59+09:00').toISOString(), status: edit ? detail.data!.project.status : draft ? 'draft' as const : 'recruiting' as const }; const result = edit ? await run('project.update', { ...payload, id: id! }, '모집글을 수정했어요.') : await run('project.create', payload, draft ? '초안을 저장했어요.' : '모집글을 올렸어요.'); if (result) {
        setPreview(null);
        allowNavigation();
        reset(values);
        router.replace('/project/' + result.id);
    } };
    const choices = (name: 'interests' | 'roles' | 'availability', label: string, options: readonly string[]) => <Controller control={control} name={name} render={({ field: item }) => <ChoiceInput label={label} options={options} value={item.value} onChange={item.onChange} onBlur={item.onBlur} inputRef={item.ref} error={errors[name]?.message}/>}/>;
    const showPreview = handleSubmit(values => { if (validInterests(values)) { Keyboard.dismiss(); setPreview(values); } });
    const field = (name: keyof ProjectForm, label: string, placeholder: string, multiline = false, hint?: string) => <Controller key={name} control={control} name={name} render={({ field: { value, onChange, onBlur, ref } }) => {
        const limit = name === 'title' ? 80 : name === 'goal' ? 200 : name === 'description' ? 3000 : name === 'deadline' ? 10 : name === 'capacity' ? 2 : undefined;
        const counter = name === 'title' || name === 'goal' || name === 'description' ? `${String(value).length.toLocaleString('ko-KR')} / ${limit?.toLocaleString('ko-KR')}자` : '';
        return <Field ref={ref} label={label} placeholder={placeholder} value={String(value)} onChangeText={onChange} onBlur={onBlur} error={errors[name]?.message} keyboardType={name === 'capacity' ? 'number-pad' : 'default'} autoCapitalize={name === 'deadline' ? 'none' : 'sentences'} autoCorrect={name === 'deadline' || name === 'capacity' ? false : undefined} multiline={multiline} maxLength={limit} hint={[hint, counter].filter(Boolean).join(' · ')}/>;
    }}/>;
    if (edit && (detail.isLoading || boot.isLoading))
        return <Screen title="모집글 수정"><Loading /></Screen>;
    if (edit && (detail.error || boot.error))
        return <Screen title="모집글 수정"><ErrorState error={detail.error || boot.error} retry={() => { void detail.refetch(); void boot.refetch(); }}/></Screen>;
    if (edit && detail.data?.project.ownerId !== boot.data?.viewer?.id)
        return <Screen title="모집글 수정"><Empty title="팀장만 수정할 수 있어요" text="프로젝트 운영 권한을 확인해 주세요." icon="lock-closed-outline"/></Screen>;
    return <><Screen title={edit ? '모집글 수정' : '팀 모집하기'} right={<IconButton icon="close" label="작성 취소" onPress={() => router.back()}/>} footer={<View style={{ gap: 8 }}>{Object.keys(errors).length > 0 && <T accessibilityRole="alert" style={{ color: C.danger, fontSize: 12, lineHeight: 20 }}>표시된 입력 항목을 확인해 주세요.</T>}<Button title={edit ? '변경 사항 저장' : '모집글 미리보기'} busy={pending} onPress={edit ? handleSubmit(values => save(values)) : showPreview}/></View>}>
        <T style={{ fontSize: 28, fontWeight: '700', lineHeight: 40, letterSpacing: -.8 }}>{edit ? '팀에 필요한 정보를 다듬어요.' : '함께 만들 팀을 찾아요.'}</T>
        <T muted style={{ fontSize: 14, lineHeight: 24, marginTop: 8 }}>프로젝트 소개, 필요한 팀원, 활동 일정을 차례로 알려주세요.</T>
        <View style={{ marginTop: 24 }}><T style={{ fontSize: 14, fontWeight: '700', marginBottom: 12 }}>모집 목적</T><View style={s.wrap}>{([...PROJECT_PURPOSES, '기타'] as const).map(purpose => <Tag key={purpose} active={watch('purpose') === purpose} onPress={() => setValue('purpose', purpose, { shouldDirty: true, shouldValidate: true })}>{purpose}</Tag>)}</View></View>
        <FormSection number="01" title="프로젝트 소개">
            {field('title', '프로젝트 이름', '예: 우리 동네, 초록 지도', false, '4자 이상')}
            {field('goal', '함께 달성할 목표', '예: 친환경 장소를 한 장의 지도로 만들어요', false, '5자 이상')}
            {field('description', '프로젝트 소개', '시작한 이유와 만들고 싶은 결과, 함께할 일을 알려주세요.', true, '20자 이상 · 연락처 등 개인정보는 제외해 주세요')}
            {choices('interests', '관심 분야', INTERESTS)}
        </FormSection>
        <View style={{ height: 1, backgroundColor: C.line }}/>
        <FormSection number="02" title="필요한 팀원">
            {choices('roles', '필요한 역할', ROLES)}
            <View style={[s.between, { marginBottom: 12, padding: 12, backgroundColor: C.card, borderRadius: 16, borderWidth: 1, borderColor: C.line }]}><Pressable accessibilityRole="button" accessibilityLabel="정원 줄이기" accessibilityState={{ disabled: Number(watch('capacity')) <= 2 }} disabled={Number(watch('capacity')) <= 2} style={({ pressed }) => [s.iconButton, { width: 52, height: 52, backgroundColor: C.raised, opacity: Number(watch('capacity')) <= 2 ? .4 : pressed ? .7 : 1 }]} onPress={() => setValue('capacity', String(Math.max(2, (Number(watch('capacity')) || 4) - 1)), { shouldDirty: true, shouldValidate: true })}><Icon name="remove"/></Pressable><View style={{ alignItems: 'center' }}><T style={{ fontSize: 24, lineHeight: 36, fontWeight: '700' }}>{watch('capacity')}명</T><T muted style={{ fontSize: 12, lineHeight: 20 }}>팀장 포함</T></View><Pressable accessibilityRole="button" accessibilityLabel="정원 늘리기" accessibilityState={{ disabled: Number(watch('capacity')) >= 20 }} disabled={Number(watch('capacity')) >= 20} style={({ pressed }) => [s.iconButton, { width: 52, height: 52, backgroundColor: C.raised, opacity: Number(watch('capacity')) >= 20 ? .4 : pressed ? .7 : 1 }]} onPress={() => setValue('capacity', String(Math.min(20, (Number(watch('capacity')) || 4) + 1)), { shouldDirty: true, shouldValidate: true })}><Icon name="add"/></Pressable></View>
            {field('capacity', '전체 정원 · 팀장 포함', '4', false, '팀장을 포함해 2~20명으로 모집할 수 있어요.')}
        </FormSection>
        <View style={{ height: 1, backgroundColor: C.line }}/>
        <FormSection number="03" title="일정과 활동">
            {choices('availability', '함께할 수 있는 시간', AVAILABILITY)}
            {field('deadline', '모집 마감일', 'YYYY-MM-DD', false, '예: 2026-11-30 · 해당 날짜 한국 시간 23:59에 마감해요.')}
            <T style={{ fontWeight: '700', fontSize: 14, marginBottom: 12 }}>활동 방식</T>
            <View style={[s.wrap, { marginBottom: 24 }]}>{([['online', '온라인'], ['offline', '오프라인'], ['hybrid', '온·오프라인']] as const).map(([key, label]) => <Tag key={key} active={watch('activityMode') === key} onPress={() => setValue('activityMode', key, { shouldDirty: true })}>{label}</Tag>)}</View>
        </FormSection>
        <View style={{ marginBottom: 24, paddingVertical: 20, borderTopWidth: 1, borderBottomWidth: 1, borderColor: C.line }}><View style={[s.row, { gap: 16 }]}><View style={{ flex: 1 }}><View style={s.row}><T style={{ fontWeight: '700' }}>초보자도 환영해요</T><T muted style={{ fontSize: 12 }}>선택</T></View><T muted style={{ fontSize: 12, lineHeight: 20, marginTop: 8 }}>함께 배우려는 팀원에게도 열어둘까요?</T></View><Switch accessibilityLabel="초보자 환영" value={watch('beginnerFriendly')} onValueChange={value => setValue('beginnerFriendly', value, { shouldDirty: true })} trackColor={{ true: '#557C25', false: C.line }} thumbColor={watch('beginnerFriendly') ? C.lime : C.muted}/></View></View>
        {!edit && <><Button title="초안으로 저장" variant="ghost" busy={pending} onPress={handleSubmit(values => save(values, true))}/><T muted style={{ textAlign: 'center', fontSize: 12, lineHeight: 20, marginTop: 8 }}>필수 항목을 채우고 초안으로 저장하면, 나중에 모집을 시작할 수 있어요.</T></>}
    </Screen><Modal transparent animationType="fade" visible={!!preview} onRequestClose={() => { if (!pending) setPreview(null); }}><View style={{ flex: 1, justifyContent: 'center', backgroundColor: 'rgba(0,0,0,.78)', padding: 20 }}><View accessibilityViewIsModal style={{ width: '100%', maxWidth: 580, maxHeight: '90%', alignSelf: 'center', borderRadius: 20, borderWidth: 1, borderColor: C.line, backgroundColor: C.card, overflow: 'hidden' }}><View style={[s.between, { padding: 16, borderBottomWidth: 1, borderColor: C.line }]}><T style={{ fontSize: 20, fontWeight: '700' }}>모집글 미리보기</T><IconButton icon="close" label="미리보기 닫기" onPress={() => { if (!pending) setPreview(null); }}/></View>{preview && <><ScrollView style={{ flexShrink: 1 }} contentContainerStyle={{ padding: 20 }}><View style={s.wrap}><Tag active>{preview.purpose}</Tag><Tag>{preview.beginnerFriendly ? '초보자 환영' : '초보자 환영 표시 없음'}</Tag></View><T style={{ fontSize: 24, lineHeight: 34, fontWeight: '700', marginTop: 16 }}>{preview.title}</T><T style={{ fontSize: 14, lineHeight: 24, marginTop: 12 }}>{preview.goal}</T><Divider /><T style={{ fontSize: 14, lineHeight: 25 }}>{preview.description}</T><Section title="모집 조건"><T muted style={{ marginBottom: 12 }}>전체 {preview.capacity}명 · 팀장 포함</T><T muted style={{ marginBottom: 12 }}>{preview.deadline} 마감 · 한국 시간 23:59</T><T muted style={{ marginBottom: 16 }}>{preview.activityMode === 'online' ? '온라인' : preview.activityMode === 'offline' ? '오프라인' : '온·오프라인'}</T><T muted style={{ fontSize: 12, lineHeight: 20, marginBottom: 8 }}>필요한 역할</T><Tags values={splitTags(preview.roles)}/><T muted style={{ fontSize: 12, lineHeight: 20, marginTop: 20, marginBottom: 8 }}>함께할 수 있는 시간</T><Tags values={splitTags(preview.availability)}/>{projectInterests(preview, originalInterests).some(value => !isPurpose(value)) && <><T muted style={{ fontSize: 12, lineHeight: 20, marginTop: 20, marginBottom: 8 }}>관심 분야</T><Tags values={projectInterests(preview, originalInterests).filter(value => !isPurpose(value))}/></>}</Section></ScrollView><View style={{ padding: 16, borderTopWidth: 1, borderColor: C.line, gap: 12 }}><Button title="모집 시작하기" busy={pending} onPress={() => void save(preview)}/><Button title="계속 수정하기" variant="secondary" disabled={pending} onPress={() => setPreview(null)}/></View></>}</View></View></Modal></>;
}
const applySchema = z.object({ role: z.string().trim().min(1, '희망 역할을 선택해 주세요.'), introduction: z.string().trim().min(10, '소개를 10자 이상 입력해 주세요.').max(500) });
export function ApplyScreen() {
    const { id } = useLocalSearchParams<{ id: string }>();
    const detail = useData('projects.detail', { id });
    const boot = useData('bootstrap', {});
    const { run, pending } = useCommand();
    const { control, handleSubmit, setValue, watch, reset, formState: { errors, isDirty } } = useForm<z.infer<typeof applySchema>>({ resolver: zodResolver(applySchema), defaultValues: { role: '', introduction: '' } });
    const allowNavigation = useUnsavedChanges(isDirty);
    if (detail.isLoading || boot.isLoading)
        return <Screen title="참여 신청"><Loading /></Screen>;
    if (detail.error instanceof AppError && detail.error.code === 'UNAUTHENTICATED' || !boot.error && !boot.data?.viewer)
        return <Screen title="참여 신청"><Empty title="로그인하고 참여를 신청해 주세요" text="내 계정으로 프로젝트의 활동 조건을 확인할 수 있어요." actionLabel="로그인" action={() => router.push({ pathname: '/auth', params: { returnTo: '/apply/' + id } })}/></Screen>;
    if (detail.error || boot.error || !detail.data)
        return <Screen title="참여 신청"><ErrorState error={detail.error || boot.error} retry={() => { void detail.refetch(); void boot.refetch(); }}/></Screen>;
    const { project, members, application, invitation } = detail.data;
    const member = members.some(item => item.active && item.userId === boot.data?.viewer?.id);
    const unavailable = member || application?.status === 'pending' || invitation?.status === 'pending' || project.status !== 'recruiting' || project.memberCount >= project.capacity || new Date(project.deadline).getTime() <= Date.now();
    if (unavailable)
        return <Screen title="참여 신청"><Empty title={member ? '이미 함께하는 팀이에요' : application?.status === 'pending' ? '신청을 검토하고 있어요' : invitation?.status === 'pending' ? '이 팀에서 초대가 왔어요' : '지금은 신청할 수 없어요'} text="프로젝트에서 현재 참여 상태와 다음 행동을 확인해 주세요." actionLabel="프로젝트 보기" action={() => router.replace('/project/' + id)}/></Screen>;
    const submit = handleSubmit(async values => {
        const result = await run('application.submit', { projectId: id, ...values }, '신청을 보냈어요. 팀장의 응답을 기다려주세요.');
        if (result) {
            allowNavigation();
            reset(values);
            router.replace('/project/' + id);
        }
    });
    return <Screen title="참여 신청" footer={<View style={{ gap: 12 }}><T muted style={{ fontSize: 12, lineHeight: 20, textAlign: 'center' }}>선택한 역할과 소개가 팀장에게 전달돼요.</T><Button title="참여 신청 보내기" busy={pending} onPress={submit}/></View>}>
        <Panel style={{ padding: 20 }}><View style={s.wrap}><Tag active>모집 중</Tag>{project.beginnerFriendly && <Tag>초보자 환영</Tag>}</View><T style={{ fontSize: 20, fontWeight: '700', lineHeight: 28, letterSpacing: -.5, marginTop: 12 }}>{project.title}</T><T muted style={{ fontSize: 14, lineHeight: 24, marginTop: 8 }}>{project.goal}</T></Panel>
        <T muted style={{ lineHeight: 24, fontSize: 14, marginTop: 20 }}>잘하는 것과 배우고 싶은 것을 알려주세요. 신청이 승인되면 팀 공간에 참여할 수 있어요.</T>
        <FormSection number="01" title="희망 역할"><T style={{ fontWeight: '700', marginBottom: 12 }}>어떤 역할로 함께할까요?</T><View style={[s.wrap, { marginBottom: 8 }]}>{project.roles.map(role => <Tag key={role} active={watch('role') === role} onPress={() => setValue('role', role, { shouldValidate: true, shouldDirty: true })}>{role}</Tag>)}</View>{errors.role && <T accessibilityRole="alert" style={{ color: C.danger, fontSize: 12, lineHeight: 20, marginTop: 8 }}>{errors.role.message}</T>}</FormSection>
        <FormSection number="02" title="나를 소개하기"><Controller control={control} name="introduction" render={({ field }) => <Field ref={field.ref} label="짧은 소개" value={field.value} onChangeText={field.onChange} onBlur={field.onBlur} multiline maxLength={500} style={{ minHeight: 148 }} placeholder="함께하고 싶은 이유와 해보고 싶은 일을 알려주세요." error={errors.introduction?.message} hint={`10자 이상 · ${field.value.length} / 500자`}/>}/><View style={[s.row, { alignItems: 'flex-start', marginTop: -8 }]}><Icon name="lock-closed-outline" size={15} color={C.muted}/><T muted style={{ flex: 1, fontSize: 12, lineHeight: 20 }}>연락처와 민감한 개인정보는 적지 마세요.</T></View></FormSection>
    </Screen>;
}
export function ApplicationsScreen() {
    const { id } = useLocalSearchParams<{ id: string }>();
    const detail = useData('projects.detail', { id });
    const boot = useData('bootstrap', {});
    const apps = usePagedData('applications.list', { projectId: id });
    const invites = usePagedData('invitations.list', { projectId: id });
    const { run, pending } = useCommand();
    if (detail.isLoading || boot.isLoading) return <Screen title="신청자 관리"><Loading /></Screen>;
    if (detail.error || boot.error || !detail.data) return <Screen title="신청자 관리"><ErrorState error={detail.error || boot.error} retry={() => { void detail.refetch(); void boot.refetch(); }}/></Screen>;
    if (boot.data?.viewer?.id !== detail.data.project.ownerId) return <Screen title="신청자 관리"><Empty title="팀장만 관리할 수 있어요" text="신청 내역은 팀장과 신청자에게만 공개돼요." icon="lock-closed-outline"/></Screen>;
    const project = detail.data.project;
    const full = project.memberCount >= project.capacity;
    return <Screen title="신청자 관리" subtitle={project.title}>
        <Panel style={{ padding: 20 }}><View style={s.between}><View style={s.row}><Icon name="people-outline" color={C.lime}/><T style={{ fontWeight: '700' }}>현재 팀원</T></View><T style={{ fontSize: 22, lineHeight: 32, fontWeight: '700' }}>{project.memberCount}<T muted style={{ fontSize: 14 }}> / {project.capacity}명</T></T></View><T muted style={{ fontSize: 14, lineHeight: 24, marginTop: 12 }}>{full ? '정원이 가득 찼어요. 빈자리가 생기면 신청을 승인할 수 있어요.' : '신청을 승인하면 팀원으로 연결되고 팀 대화에 참여할 수 있어요.'}</T></Panel>
        <Section title="참여 신청">
            {apps.isLoading ? <Loading /> : apps.error ? <ErrorState error={apps.error} retry={() => void apps.refetch()}/> : apps.data?.items.length ? apps.data.items.map(application => <Panel key={application.id} style={{ marginBottom: 12, padding: 20 }}>
                <View style={[s.row, { alignItems: 'flex-start' }]}><Avatar name={application.nickname || '팀원'}/><View style={{ flex: 1 }}><T style={{ fontWeight: '700' }}>{application.nickname || '팀원'}</T><T muted style={{ fontSize: 12, lineHeight: 20, marginTop: 4 }}>{application.role}</T></View><Tag active={application.status === 'pending'}>{({ pending: '검토 대기', approved: '승인됨', rejected: '거절됨', withdrawn: '철회됨' } as const)[application.status]}</Tag></View>
                <T style={{ color: C.text, lineHeight: 24, fontSize: 14, marginVertical: 16 }}>{application.introduction}</T>
                {application.status === 'pending' && <View style={[s.row, { alignItems: 'stretch', flexWrap: 'wrap' }]}><Button title={(application.nickname || '신청자') + ' 승인'} busy={pending} disabled={full} style={{ flex: 1, minWidth: 150, paddingHorizontal: 12 }} onPress={() => void run('application.review', { id: application.id, decision: 'approved' }, '참여 신청을 승인했어요.')}/><Button title="거절" variant="secondary" busy={pending} style={{ paddingHorizontal: 16 }} onPress={() => void run('application.review', { id: application.id, decision: 'rejected' }, '신청을 검토했어요.')}/></View>}
            </Panel>) : <Empty title="아직 신청이 없어요" text="프로젝트 목표와 필요한 역할을 자세히 소개해 보세요."/>}
            <LoadMore query={apps} label="신청 더 불러오기"/>
        </Section>
        <Section title="보낸 초대">
            {invites.isLoading ? <Loading /> : invites.error ? <ErrorState error={invites.error} retry={() => void invites.refetch()}/> : invites.data?.items.length ? invites.data.items.map(invitation => <Panel key={invitation.id} style={{ marginBottom: 12, padding: 20 }}><View style={[s.row, { alignItems: 'flex-start' }]}><View style={{ flex: 1 }}><T style={{ fontWeight: '700' }}>{invitation.nickname || '팀원'}</T><T muted style={{ fontSize: 12, lineHeight: 20, marginTop: 4 }}>{invitation.role}</T></View><Tag active={invitation.status === 'pending'}>{({ pending: '응답 대기', accepted: '수락됨', declined: '거절됨', cancelled: '취소됨', expired: '기간 만료' } as const)[invitation.status]}</Tag></View>{invitation.status === 'pending' && <><T muted style={{ fontSize: 12, lineHeight: 20, marginVertical: 12 }}>초대가 수락되기 전까지 자리는 예약되지 않아요.</T><Button title="초대 취소" variant="secondary" busy={pending} onPress={() => void run('invitation.cancel', { id: invitation.id }, '초대를 취소했어요.')}/></>}</Panel>) : <T muted style={{ fontSize: 14, lineHeight: 24 }}>아직 보낸 초대가 없어요. 탐색에서 함께할 사람을 찾아보세요.</T>}
            <LoadMore query={invites} label="초대 더 불러오기"/>
        </Section>
    </Screen>;
}
export function TeamScreen() {
    const { id } = useLocalSearchParams<{
        id: string;
    }>();
    const detail = useData('projects.detail', { id });
    const boot = useData('bootstrap', {});
    const { run, pending } = useCommand();
    const { confirm } = useRuntime();
    const [tab, setTab] = useState('개요');
    const [memberMenuId, setMemberMenuId] = useState<string | null>(null);
    const records = usePagedData('experiences.list', {});
    const teamActions = useTeamActions();
    const teamRecords = records.data?.items.filter(item=>item.projectId===id)||[];
    if (detail.isLoading || boot.isLoading)
        return <Screen title="팀 공간"><Loading /></Screen>;
    if (detail.error || boot.error || !detail.data)
        return <Screen title="팀 공간"><ErrorState error={detail.error || boot.error} retry={() => { void detail.refetch(); void boot.refetch(); }}/></Screen>;
    const { project: p, members } = detail.data;
    const owner = p.ownerId === boot.data?.viewer?.id;
    const member = members.some(m => m.active && m.userId === boot.data?.viewer?.id);
    if (!member)
        return <Screen title="팀 공간"><Empty title="팀원만 들어올 수 있어요" text="참여 신청이 승인되면 팀 공간이 열려요." icon="lock-closed-outline" actionLabel="프로젝트 보기" action={() => router.replace('/project/' + id)}/></Screen>;
    return <Screen title="우리의 팀 공간" subtitle={statusName[p.status]}><T style={{ fontSize: 28, fontWeight: '700', lineHeight: 40, letterSpacing: -.8, marginBottom: 12 }}>{p.title}</T><T muted style={{ fontSize: 14, lineHeight: 24, marginBottom: 24 }}>{p.goal}</T><View style={[s.wrap, { marginBottom: 24 }]}>{['개요', '멤버', '활동 기록', ...(owner ? ['팀 설정'] : [])].map(value => <Tag key={value} active={value === tab} onPress={() => { setTab(value); setMemberMenuId(null); }}>{value}</Tag>)}</View>
 {tab === '개요' ? <><Panel style={{ padding: 20 }}><View style={s.row}><Icon name="chatbubbles-outline" color={C.lime}/><T style={{ fontSize: 20, fontWeight: '700', lineHeight: 28, flex: 1 }}>대화에서 다음 할 일을 정해요</T></View><T muted style={{ lineHeight: 24, marginVertical: 16, fontSize: 14 }}>팀원 {members.filter(item => item.active).length}명과 아이디어, 진행 상황을 나눠보세요.</T><Button title="팀 채팅 열기" icon="chatbubble-outline" onPress={() => router.push('/chat/' + id)}/></Panel><Section title="팀의 약속"><T style={[s.body, { color: C.text, lineHeight: 24 }]}>{p.description}</T><View style={{ marginTop: 20 }}><T muted style={{ fontSize: 12, marginBottom: 8 }}>함께하는 시간</T><Tags values={p.availability}/><T muted style={{ fontSize: 12, marginTop: 16, marginBottom: 8 }}>팀의 역할</T><Tags values={p.roles}/></View></Section>{owner && <Section title="팀장 도구">
   <Button title="신청자 관리" variant="secondary" onPress={() => router.push('/applications/' + id)}/>
   <Button title="함께할 사람 찾기" variant="ghost" onPress={() => router.push({ pathname: '/explore', params: { kind: 'people' } })}/>
   <View style={{ marginTop: 20, paddingTop: 8, borderTopWidth: 1, borderColor: C.line }}>
     <Pressable accessibilityRole="button" accessibilityLabel={p.title + ' 팀 해체'}
       accessibilityState={{ disabled: pending || teamActions.pendingProjectId !== null, busy: teamActions.pendingProjectId === id }}
       aria-disabled={pending || teamActions.pendingProjectId !== null} disabled={pending || teamActions.pendingProjectId !== null}
       onPress={async () => { if (await teamActions.disband(p)) router.replace('/teams'); }}
       style={({ pressed }) => [{ minHeight: 48, paddingHorizontal: 12, paddingVertical: 12, borderRadius: 10, alignItems: 'center', justifyContent: 'center', opacity: pending || teamActions.pendingProjectId !== null ? .5 : 1, backgroundColor: pressed ? C.raised : 'transparent' }]}>
       {teamActions.pendingProjectId === id ? <ActivityIndicator size="small" color={C.muted}/> : <T muted style={{ fontSize: 13, lineHeight: 22, fontWeight: '600' }}>팀 해체</T>}
     </Pressable>
   </View>
 </Section>}</> : tab === '멤버' ? <>
 {members.filter(m => m.active).map(m => <View key={m.id} style={{ paddingVertical: 16, borderBottomWidth: 1, borderColor: C.line }}>
   <View style={[s.row, { gap: 12 }]}><Avatar avatar={m.avatar} name={m.nickname}/><Pressable accessibilityRole="button" accessibilityLabel={m.nickname + ' 프로필 보기'} onPress={() => router.push('/person/' + m.userId)} style={{ flex: 1, minWidth: 0, minHeight: 48, justifyContent: 'center' }}><T style={{ fontWeight: '700' }}>{m.nickname}{m.userId === p.ownerId ? ' · 팀장' : ''}</T><T muted style={{ fontSize: 12, lineHeight: 20, marginTop: 4 }}>{m.role}</T></Pressable>{owner && m.userId !== p.ownerId ? <Pressable accessibilityRole="button" accessibilityLabel={m.nickname + ' 멤버 관리'} accessibilityState={{ expanded: memberMenuId === m.id }} onPress={() => setMemberMenuId(memberMenuId === m.id ? null : m.id)} style={({ pressed }) => [s.iconButton, pressed && { backgroundColor: C.raised }]}><Icon name="ellipsis-horizontal" color={C.muted}/></Pressable> : <Icon name="chevron-forward" size={16} color={C.muted}/>}</View>
   {owner && m.userId !== p.ownerId && memberMenuId === m.id && <View style={{ marginTop: 16, padding: 12, borderRadius: 16, backgroundColor: C.card, gap: 8 }}><T muted style={{ fontSize: 12, lineHeight: 20, paddingHorizontal: 8, marginBottom: 4 }}>{m.nickname}님 멤버 관리</T><Button title="팀장 이전" variant="secondary" busy={pending} onPress={async () => {
     if (await confirm('팀장 권한을 이전할까요?', m.nickname + '님이 팀을 운영하게 돼요. 이전 후에는 신청과 팀 설정을 관리할 수 없어요.', '권한 이전')) {
       if (await run('membership.transfer', { projectId: id, userId: m.userId }, '팀장 권한을 이전했어요.')) setMemberMenuId(null);
     }
   }}/><Button title="팀원 제거" variant="danger" busy={pending} onPress={async () => {
     if (await confirm('팀원을 제거할까요?', '이 팀의 대화와 팀 공간에 더 이상 접근할 수 없어요.', '제거')) {
       if (await run('membership.remove', { projectId: id, userId: m.userId }, '팀원을 제거했어요.')) setMemberMenuId(null);
     }
   }}/></View>}
 </View>)}
 {!owner && <Button title="팀 탈퇴" variant="danger" busy={pending || teamActions.pendingProjectId === id} onPress={async () => { if (await teamActions.leave(p)) router.replace('/teams'); }}/>}</> : tab === '활동 기록' ? <>{records.isLoading?<Loading/>:records.error?<ErrorState error={records.error}/>:teamRecords.length?teamRecords.map(record=><Panel key={record.id} style={{marginBottom:12}}><View style={s.between}><Tag>{record.role}</Tag><Tag>{record.isPublic?'공개':'나만 보기'}</Tag></View><T style={{fontSize:20,fontWeight: '700',lineHeight:28,marginTop:12}}>{record.title}</T><T muted style={{fontSize:14,lineHeight:23,marginTop:8}}>{record.description}</T><RowLink title="기록 수정" icon="create-outline" onPress={()=>router.push({pathname:'/experience',params:{id:record.id,projectId:id}})}/></Panel>):<Empty title="함께한 경험을 나의 기록으로" text="맡았던 역할, 배운 점, 완성한 결과를 기록해 보세요. 공개 여부는 직접 선택할 수 있어요." icon="sparkles-outline"/>}<LoadMore query={records} label="경험 더 불러오기"/><Button title="경험 기록하기" onPress={() => router.push({ pathname: '/experience', params: { projectId: id } })}/></> : <>
 <RowLink title="모집글 수정" icon="create-outline" onPress={() => router.push({ pathname: '/project/edit', params: { id } })}/>{p.status === 'recruiting' && <RowLink title="모집 종료 · 프로젝트 시작" icon="play-outline" onPress={async () => { if (await confirm('모집을 종료할까요?', '새로운 신청을 닫고 함께하는 팀원들과 프로젝트를 시작해요.', '진행 중으로 변경'))
            await run('project.transition', { id, status: 'active' }, '프로젝트를 시작했어요.'); }}/>}{p.status === 'active' && <RowLink title="프로젝트 완료" icon="checkmark-circle-outline" onPress={async () => { if (await confirm('프로젝트를 완료할까요?', '함께 만든 결과를 경험으로 기록할 수 있어요.', '완료로 변경'))
            await run('project.transition', { id, status: 'completed' }, '함께한 프로젝트가 완료되었어요.'); }}/>}{p.status !== 'archived' && <RowLink title="프로젝트 보관" icon="archive-outline" danger onPress={async () => { if (await confirm('프로젝트를 보관할까요?', '모집을 닫고 프로젝트를 보관 목록으로 옮겨요.', '보관'))
            await run('project.transition', { id, status: 'archived' }, '프로젝트를 보관했어요.'); }}/>}</>}</Screen>;
}
