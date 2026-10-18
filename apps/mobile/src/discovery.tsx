import React, { useEffect, useState } from 'react';
import { ActivityIndicator, Pressable, ScrollView, View, StyleSheet } from 'react-native';
import { router, useLocalSearchParams } from 'expo-router';
import { getProjectPurpose, type Profile, type Project } from '@interlink/shared';
import { Avatar, Button, C, Empty, ErrorState, Icon, IconButton, Loading, LoadMore, Logo, Panel, Screen, Section, T, Tag, Tags, s } from './ui';
import { env, useCommand, useData, usePagedData } from './runtime';
import { selectionAccessibility } from './accessibility';
import { useTeamActions } from './team-actions';

export function AppHeader() {
  const bootstrap = useData('bootstrap', {});
  return <View style={[s.between, { paddingTop: 12, paddingBottom: 8, gap: 12 }]}>
    <View style={[s.row, { gap: 8, flexShrink: 1 }]}>
      <Logo />
      {env.mode === 'demo' && <View accessibilityLabel="가상 데이터로 체험하는 데모" style={d.demoBadge}><T muted style={{ fontSize: 10, lineHeight: 16, fontWeight: '700' }}>데모</T></View>}
    </View>
    <View style={[s.row, { gap: 4 }]}>
      <View>
        <IconButton icon="notifications-outline" label="알림" onPress={() => router.push('/notifications')} />
        {(bootstrap.data?.unreadCount || 0) > 0 && <View pointerEvents="none" style={d.notificationDot} />}
      </View>
      <Pressable accessibilityRole="button" accessibilityLabel="내 프로필 열기" onPress={() => router.push('/profile')} style={({ pressed }) => [{ alignItems: 'center', justifyContent: 'center', width: 48, height: 48, borderRadius: 16, backgroundColor: pressed ? C.raised : 'transparent' }]}>
        <Avatar avatar={bootstrap.data?.viewer?.avatar} name={bootstrap.data?.viewer?.nickname || '나'} size={32} />
      </Pressable>
    </View>
  </View>;
}

export const statusName: Record<string, string> = {
  draft: '초안', recruiting: '모집 중', active: '진행 중', completed: '완료', archived: '보관',
};

export function ProjectCard({ project, featured = false, compact = false }: { project: Project; featured?: boolean; compact?: boolean }) {
  const { run, pending } = useCommand();
  const purpose = getProjectPurpose(project);
  const remaining = new Date(project.deadline).getTime() - Date.now();
  const days = Math.max(0, Math.ceil(remaining / 86400000));
  const full = project.memberCount >= project.capacity;
  const open = project.status === 'recruiting' && remaining > 0 && !full;
  const deadline = project.status !== 'recruiting' ? statusName[project.status] : remaining <= 0 ? '모집 마감' : full ? '정원 마감' : 'D-' + days;
  const activity = project.activityMode === 'online' ? '온라인' : project.activityMode === 'hybrid' ? '온·오프라인' : '오프라인';
  const icon = project.interests.some(x => /환경|생태/.test(x)) ? 'leaf-outline'
    : project.interests.some(x => /창작|디자인/.test(x)) ? 'color-palette-outline'
    : project.interests.some(x => /과학/.test(x)) ? 'flask-outline' : 'code-slash-outline';
  if (compact) return <View style={d.projectCard}>
    <Pressable accessibilityRole="button" accessibilityLabel={project.title + ' 상세 보기'} onPress={() => router.push('/project/' + project.id)} style={({ pressed }) => ({ padding: 20, backgroundColor: pressed ? C.raised : C.card })}>
      <View style={[s.row, { gap: 12, alignItems: 'flex-start' }]}>
        <View style={{ width: 48, height: 48, borderRadius: 16, alignItems: 'center', justifyContent: 'center', backgroundColor: C.raised }}><Icon name={icon} color={C.text} size={24}/></View>
        <View style={{ flex: 1, minWidth: 0 }}><T muted style={{ fontSize: 12, lineHeight: 20, paddingRight: 32 }}>{purpose || project.interests[0]} · {activity}</T><T numberOfLines={2} style={{ fontSize: 18, lineHeight: 28, fontWeight: '700', letterSpacing: -.35, marginTop: 16 }}>{project.title}</T></View>
      </View>
      <T muted numberOfLines={2} style={{ fontSize: 14, lineHeight: 24, marginTop: 16 }}>{project.goal}</T>
      <View style={[s.row, { flexWrap: 'wrap', gap: 8, marginTop: 12 }]}><T style={{ fontSize: 12, lineHeight: 20 }}>{project.roles.slice(0, 3).join(' · ')} 모집</T><T muted style={{ fontSize: 12, lineHeight: 20 }}>· {project.availability[0] || '시간 협의'}</T></View>
      <View style={[s.between, { marginTop: 16, gap: 12, flexWrap: 'wrap' }]}><T muted style={{ fontSize: 12, lineHeight: 20 }}>현재 {project.memberCount}명 / {project.capacity}명 <T muted style={{ fontSize: 12, lineHeight: 20 }}> · {deadline}</T></T><View style={[s.row, { gap: 4 }]}><T style={{ fontSize: 12, lineHeight: 20, fontWeight: '700', color: C.lime }}>자세히 보기</T><Icon name="arrow-forward" color={C.lime} size={16}/></View></View>
    </Pressable>
    <Pressable accessibilityRole="button" accessibilityLabel={project.title + (project.saved ? ' 저장 해제' : ' 저장')} {...selectionAccessibility(!!project.saved)} accessibilityState={{ selected: !!project.saved, disabled: pending, busy: pending }} disabled={pending}
      onPress={() => void run('project.save', { id: project.id, saved: !project.saved }, project.saved ? '저장을 해제했어요.' : '저장했어요. 내 프로필에서 다시 볼 수 있어요.')}
      style={({ pressed }) => [d.bookmark, pressed && { backgroundColor: C.raised }]}>
      {pending ? <ActivityIndicator size="small" color={C.lime}/> : <Icon name={project.saved ? 'bookmark' : 'bookmark-outline'} color={project.saved ? C.lime : C.muted} size={21}/>} 
    </Pressable>
  </View>;
  return <View style={d.projectCard}>
    <Pressable accessibilityRole="button" accessibilityLabel={project.title + ' 상세 보기'}
      onPress={() => router.push('/project/' + project.id)}
      style={({ pressed }) => [pressed && { backgroundColor: C.raised }]}>
      <View style={{ padding: 20 }}>
        <View style={[s.row, { gap: 8, paddingRight: 38, minHeight: 26 }]}>
          <View style={d.projectIcon}><Icon name={icon} size={18} color={C.muted} /></View>
          <T muted style={{ fontSize: 12, lineHeight: 20, flexShrink: 1 }}>{purpose || project.interests[0] || '프로젝트'} · {activity}</T>
          {project.beginnerFriendly && <T muted style={{ fontSize: 12, lineHeight: 20, flexShrink: 1 }}>초보 환영</T>}
        </View>
        <T style={{ fontSize: 20, fontWeight: '700', lineHeight: 28, letterSpacing: -.6, marginTop: 12 }}>{project.title}</T>
        <T muted numberOfLines={2} style={{ fontSize: 14, lineHeight: 24, marginTop: 8 }}>{project.goal}</T>
        <View style={{ marginTop: 16 }}><Tags values={project.roles.slice(0, 3)} /></View>
        {featured && project.reasons?.length ? <View style={[s.row, { marginTop: 12, gap: 8 }]}>
          <Icon name="sparkles-outline" size={14} color={C.muted} />
          <T muted style={{ fontSize: 12, lineHeight: 20, flex: 1 }}>{project.reasons[0]}</T>
        </View> : null}
      </View>
      <View style={[s.between, d.projectFooter]}>
        <View style={[s.row, { gap: 7, flex: 1, flexWrap: 'wrap' }]}>
          <Icon name="people-outline" size={16} color={C.muted} />
          <T muted style={{ fontSize: 12, lineHeight: 20 }}>현재 {project.memberCount}명 / {project.capacity}명</T>
          <T muted style={{ fontSize: 12, lineHeight: 20 }}>·</T>
          <T style={{ fontSize: 12, lineHeight: 20, color: open && days <= 3 ? C.lime : C.muted }}>{deadline}</T>
        </View>
        <View style={[s.row, { gap: 5 }]}>
          <T style={{ fontSize: 12, lineHeight: 20, fontWeight: '700' }}>자세히 보기</T>
          <Icon name="arrow-forward" size={17} color={C.lime} />
        </View>
      </View>
    </Pressable>
    <Pressable accessibilityRole="button" accessibilityLabel={project.saved ? project.title + ' 저장 해제' : project.title + ' 저장'}
      {...selectionAccessibility(!!project.saved)}
      accessibilityState={{ selected: !!project.saved, disabled: pending, busy: pending }}
      aria-disabled={pending} disabled={pending}
      onPress={() => void run('project.save', { id: project.id, saved: !project.saved }, project.saved ? '저장을 해제했어요.' : '저장했어요. 내 프로필에서 다시 볼 수 있어요.')}
      style={({ pressed }) => [d.bookmark, pressed && { backgroundColor: C.raised }]}>
      {pending ? <ActivityIndicator color={C.lime} size="small" /> : <Icon name={project.saved ? 'bookmark' : 'bookmark-outline'} color={project.saved ? C.lime : C.muted} size={21} />}
    </Pressable>
  </View>;
}

export function PersonCard({ person }: { person: Profile }) {
  return <Pressable accessibilityRole="button" accessibilityLabel={person.nickname + ' 프로필'} onPress={() => router.push('/person/' + person.id)}
    style={({ pressed }) => [s.panel, { marginBottom: 16, padding: 20, borderRadius: 20 }, pressed && { backgroundColor: C.raised }]}>
    <View style={[s.row, { gap: 12 }]}>
      <Avatar avatar={person.avatar} name={person.nickname} size={48} />
      <View style={{ flex: 1, minWidth: 0 }}>
        <T style={{ fontWeight: '700', fontSize: 18, lineHeight: 28 }}>{person.nickname}</T>
        <T muted style={{ fontSize: 12, lineHeight: 20, marginTop: 4 }}>{person.roles.join(' · ')}</T>
      </View>
      <Icon name="chevron-forward" color={C.muted} size={19} />
    </View>
    <T muted numberOfLines={3} style={{ fontSize: 14, lineHeight: 24, marginVertical: 16 }}>{person.bio}</T>
    <Tags values={person.interests.concat(person.availability).slice(0, 4)} />
    {person.reasons?.length ? <View style={[s.row, { marginTop: 16, gap: 8 }]}>
      <Icon name="sparkles-outline" size={14} color={C.muted} />
      <T muted style={{ fontSize: 12, lineHeight: 20, flex: 1 }}>{person.reasons.slice(0, 2).join(' · ')}</T>
    </View> : null}
  </Pressable>;
}


const d = StyleSheet.create({
  demoBadge: { backgroundColor: C.raised, borderRadius: 8, paddingHorizontal: 8, paddingVertical: 4 },
  notificationDot: { width: 7, height: 7, backgroundColor: C.lime, borderRadius: 4, position: 'absolute', top: 8, right: 9, borderWidth: 1, borderColor: C.bg },
  projectCard: { borderRadius: 20, borderWidth: 1, borderColor: C.line, backgroundColor: C.card, marginBottom: 16, overflow: 'hidden' },
  projectIcon: { width: 28, height: 28, borderRadius: 8, alignItems: 'center', justifyContent: 'center', backgroundColor: C.raised },
  projectFooter: { paddingHorizontal: 20, paddingVertical: 16, borderTopWidth: 1, borderColor: C.line, gap: 12, flexWrap: 'wrap' },
  bookmark: { position: 'absolute', right: 8, top: 8, width: 48, height: 48, borderRadius: 16, alignItems: 'center', justifyContent: 'center' },
});

export function TeamsScreen() {
  const params = useLocalSearchParams<{ view?: string }>();
  const [tab, setTab] = useState('참여 중');
  const [teamMenu, setTeamMenu] = useState<string | null>(null);
  useEffect(() => { if (params.view) { setTab(params.view === 'requests' ? '신청·초대' : '참여 중'); router.setParams({ view: undefined }); } }, [params.view]);
  const teams = usePagedData('teams.mine', {});
  const boot = useData('bootstrap', {});
  const apps = usePagedData('applications.list', {});
  const invites = usePagedData('invitations.list', {});
  const { run, pending } = useCommand();
  const actions = useTeamActions();
  const viewerId = boot.data?.viewer?.id;
  const list = teams.data?.items.filter(project => tab === '내가 운영' ? project.ownerId === viewerId : tab === '완료' ? project.status === 'completed' || project.status === 'archived' : project.status !== 'completed' && project.status !== 'archived') || [];
  const received = invites.data?.items.filter(invitation => invitation.inviteeId === viewerId) || [];
  const sent = apps.data?.items.filter(application => application.userId === viewerId) || [];
  const refresh = () => { void teams.refetch(); void boot.refetch(); void apps.refetch(); void invites.refetch(); };
  const emptyTitle = tab === '내가 운영' ? '내가 운영하는 팀이 없어요' : tab === '완료' ? '완료한 팀이 없어요' : '참여 중인 팀이 없어요';

  return <Screen back={false} onRefresh={refresh} refreshing={teams.isRefetching}>
    <AppHeader />
    <View style={[s.between, { marginTop: 24, marginBottom: 20, gap: 12 }]}>
      <T accessibilityRole="header" style={[s.title, { fontSize: 28, lineHeight: 40 }]}>내 활동</T>
      <Button title="팀 모집" icon="add" onPress={() => router.push('/project/new')} variant="secondary"/>
    </View>
    <ScrollView horizontal showsHorizontalScrollIndicator={false} style={{ flexGrow: 0, marginBottom: 20 }} contentContainerStyle={{ gap: 8, paddingBottom: 4 }}>
      {['참여 중', '내가 운영', '신청·초대', '완료'].map(value => <Tag key={value} active={value === tab} onPress={() => setTab(value)}>{value}</Tag>)}
    </ScrollView>
    {boot.isLoading ? <Loading /> : boot.error ? <ErrorState error={boot.error} retry={refresh}/> : tab === '신청·초대' ? <>
      <Section title="받은 초대">
        {invites.isLoading ? <Loading /> : invites.error ? <ErrorState error={invites.error} retry={() => void invites.refetch()}/> : received.length ? received.map(invitation => <Panel key={invitation.id} style={{ marginBottom: 12 }}>
          <T style={{ fontSize: 18, lineHeight: 28, fontWeight: '700' }}>{invitation.projectTitle || '팀 초대'}</T>
          <T muted style={{ fontSize: 12, lineHeight: 20, marginTop: 8 }}>{invitation.role} · {({ pending: '응답을 기다려요', accepted: '수락됨', declined: '거절됨', cancelled: '취소됨', expired: '기간 만료' } as const)[invitation.status]}</T>
          <T muted style={{ fontSize: 14, lineHeight: 24, marginVertical: 16 }}>{invitation.message}</T>
          {invitation.status === 'pending' && <View style={[s.row, { gap: 12 }]}>
            <Button title="초대 수락" busy={pending} onPress={() => void run('invitation.respond', { id: invitation.id, decision: 'accepted' }, '초대를 수락했어요. 내 활동에서 팀 대화를 시작하세요.')} style={{ flex: 1 }}/>
            <Button title="거절" variant="ghost" busy={pending} onPress={() => void run('invitation.respond', { id: invitation.id, decision: 'declined' })}/>
          </View>}
        </Panel>) : <Empty title="받은 초대가 없어요" text="프로필에 관심 분야와 가능한 역할을 알려주세요."/>}
        <LoadMore query={invites} label="초대 더 불러오기"/>
      </Section>
      <Section title="보낸 신청">
        {apps.isLoading ? <Loading /> : apps.error ? <ErrorState error={apps.error} retry={() => void apps.refetch()}/> : sent.length ? sent.map(application => <Panel key={application.id} style={{ marginBottom: 12 }}>
          <T style={{ fontSize: 18, lineHeight: 28, fontWeight: '700' }}>{application.projectTitle || '프로젝트 신청'}</T>
          <T muted style={{ fontSize: 12, lineHeight: 20, marginTop: 8, marginBottom: 16 }}>{application.role} · {({ pending: '검토 중', approved: '승인됨', rejected: '거절됨', withdrawn: '철회됨' } as const)[application.status]}</T>
          <Button title="프로젝트 보기" variant="secondary" onPress={() => router.push('/project/' + application.projectId)}/>
        </Panel>) : <Empty title="아직 보낸 신청이 없어요" text="마음이 가는 프로젝트에 나의 역할을 제안해 보세요."/>}
        <LoadMore query={apps} label="신청 더 불러오기"/>
      </Section>
    </> : teams.isLoading ? <Loading /> : teams.error ? <ErrorState error={teams.error} retry={() => void teams.refetch()}/> : list.length ? list.map(project => {
      const owner = project.ownerId === viewerId;
      const busy = actions.pendingProjectId === project.id;
      const disabled = actions.pendingProjectId !== null;
      return <View key={project.id} style={[d.projectCard, { borderRadius: 20 }]}>
        <Pressable accessibilityRole="button" accessibilityLabel={project.title + ' 팀 공간 열기'} disabled={disabled}
          accessibilityState={{ disabled }} onPress={() => router.push('/team/' + project.id)}
          style={({ pressed }) => [{ padding: 20, backgroundColor: pressed ? C.raised : C.card }]}>
          <View style={[s.between, { gap: 12, paddingRight: owner ? 0 : 40 }]}><Tag>{statusName[project.status]}</Tag><T muted style={{ fontSize: 12, lineHeight: 20, flexShrink: 1 }}>{owner ? '내가 운영하는 팀' : '함께하는 팀'}</T></View>
          <T style={{ fontSize: 20, fontWeight: '700', lineHeight: 28, marginTop: 16 }}>{project.title}</T>
          <View style={[s.between, { marginTop: 16, gap: 12, flexWrap: 'wrap' }]}>
            <View style={[s.row, { gap: 8 }]}><Icon name="people-outline" size={16} color={C.muted}/><T muted style={{ fontSize: 12, lineHeight: 20 }}>현재 {project.memberCount}명 / {project.capacity}명</T></View>
            <View style={[s.row, { gap: 4 }]}><T style={{ color: C.lime, fontSize: 12, lineHeight: 20, fontWeight: '700' }}>팀 공간 열기</T><Icon name="arrow-forward" size={16} color={C.lime}/></View>
          </View>
        </Pressable>
        {!owner && <Pressable accessibilityRole="button" accessibilityLabel={project.title + ' 팀 메뉴'} accessibilityState={{ expanded: teamMenu === project.id, disabled }} disabled={disabled}
          onPress={() => setTeamMenu(current => current === project.id ? null : project.id)} style={({ pressed }) => [d.bookmark, pressed && { backgroundColor: C.raised }]}><Icon name="ellipsis-horizontal" color={C.muted} size={22}/></Pressable>}
        {!owner && teamMenu === project.id && <View style={[s.between, { borderTopWidth: 1, borderColor: C.line, paddingHorizontal: 20, paddingVertical: 8, gap: 12 }]}>
          <T muted style={{ flex: 1, fontSize: 12, lineHeight: 20 }}>탈퇴하면 내 참여만 종료돼요</T>
          <Pressable accessibilityRole="button" accessibilityLabel={project.title + ' 팀 탈퇴'} accessibilityState={{ disabled, busy }} aria-disabled={disabled} disabled={disabled}
            onPress={() => { void actions.leave(project); }}
            style={({ pressed }) => [{ minHeight: 52, paddingHorizontal: 12, borderRadius: 16, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8, opacity: disabled ? .5 : 1, backgroundColor: pressed ? C.raised : 'transparent' }]}>
            {busy ? <ActivityIndicator size="small" color={C.danger}/> : <Icon name="log-out-outline" size={18} color={C.danger}/>}
            <T style={{ color: C.danger, fontSize: 13, fontWeight: '700' }}>팀 탈퇴</T>
          </Pressable>
        </View>}
      </View>;
    }) : <Empty title={emptyTitle} text={tab === '완료' ? '함께 마친 프로젝트는 이곳에서 확인할 수 있어요.' : '목적에 맞는 팀에 참여하거나 직접 팀원을 모집해 보세요.'} actionLabel={tab === '내가 운영' ? '팀 모집하기' : '팀 찾아보기'} action={() => router.push(tab === '내가 운영' ? '/project/new' : '/explore')}/>}
    {tab !== '신청·초대' && <LoadMore query={teams} label="팀 더 불러오기"/>}
  </Screen>;
}
export function MessagesScreen() {
  const teams = usePagedData('teams.mine', {});
  return <Screen back={false} onRefresh={() => void teams.refetch()} refreshing={teams.isRefetching}>
    <AppHeader />
    <View style={{ marginTop: 24, marginBottom: 24 }}>
      <T style={{ fontSize: 28, lineHeight: 40, fontWeight: '700', letterSpacing: -.7 }}>채팅</T>
      <T muted style={{ fontSize: 14, lineHeight: 24, marginTop: 8 }}>팀원과 아이디어를 나누고, 다음 단계를 함께 정해요.</T>
    </View>
    {teams.isLoading ? <Loading /> : teams.error ? <ErrorState error={teams.error} retry={() => void teams.refetch()} />
      : teams.data?.items.length ? teams.data.items.map(project => <Pressable key={project.id}
        accessibilityRole="button" accessibilityLabel={project.title + ' 대화 열기'}
        accessibilityHint={project.unreadCount ? '읽지 않은 메시지 ' + project.unreadCount + '개' : '팀 대화로 이동'}
        onPress={() => router.push('/chat/' + project.id)}
        style={({ pressed }) => [{ flexDirection: 'row', alignItems: 'center', gap: 16, paddingVertical: 20, paddingHorizontal: 4, borderBottomWidth: 1, borderColor: C.line }, pressed && { backgroundColor: C.card }]}>
        <View style={{ width: 48, height: 48, backgroundColor: C.raised, borderRadius: 16, alignItems: 'center', justifyContent: 'center' }}>
          <Icon name="chatbubbles-outline" color={C.muted} size={24} />
        </View>
        <View style={{ flex: 1, minWidth: 0 }}>
          <T style={{ fontWeight: '700', fontSize: 16, lineHeight: 24 }}>{project.title}</T>
          <T muted style={{ fontSize: 12, lineHeight: 20, marginTop: 4 }}>팀 대화 · {project.memberCount}명</T>
        </View>
        {project.unreadCount ? <View style={{ backgroundColor: C.lime, minWidth: 24, height: 24, paddingHorizontal: 6, borderRadius: 12, alignItems: 'center', justifyContent: 'center' }}>
          <T style={{ color: C.bg, fontWeight: '700', fontSize: 12, lineHeight: 20 }}>{project.unreadCount > 99 ? '99+' : project.unreadCount}</T>
        </View> : <Icon name="chevron-forward" color={C.muted} size={17} />}
      </Pressable>)
      : <Empty title="연결되면 대화가 시작돼요" text="팀 참여가 승인되면 여기에서 팀원들과 이야기할 수 있어요." icon="chatbubbles-outline" actionLabel="프로젝트 찾아보기" action={() => router.push('/explore')} />}
    <LoadMore query={teams} label="대화 더 불러오기" />
  </Screen>;
}
