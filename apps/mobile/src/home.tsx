import React, { useState } from 'react';
import { Keyboard, Pressable, ScrollView, StyleSheet, TextInput, View } from 'react-native';
import { router } from 'expo-router';
import { PROJECT_PURPOSES, getProjectPurpose, openRecruitments, recruitmentDeadline, urgentRecruitments } from '@interlink/shared';
import { AppHeader, ProjectCard } from './discovery';
import { useData, usePagedData } from './runtime';
import { Button, C, Empty, ErrorState, Icon, Loading, Screen, Section, T, s } from './ui';
import { HomeBanner } from './home-banner';

const findTeams = (params: Record<string, string> = {}) => {
  Keyboard.dismiss();
  router.push({ pathname: '/explore', params: { kind: 'project', reset: '1', q: '', ...params } });
};

export function HomeScreen() {
  const [search, setSearch] = useState('');
  const [focused, setFocused] = useState(false);
  const [showGuide, setShowGuide] = useState(false);
  const boot = useData('bootstrap', {});
  const projects = useData('projects.search', { status: 'recruiting', sort: 'recommended', limit: 20 });
  const deadlines = useData('projects.search', { status: 'recruiting', sort: 'deadline', limit: 20 });
  const teams = usePagedData('teams.mine', { limit: 50 });
  const viewer = boot.data?.viewer;
  const myTeamIds = new Set((teams.data?.items || []).map(team => team.id));
  const available = openRecruitments(projects.data?.items || [], myTeamIds, viewer?.id);
  const urgent = urgentRecruitments(openRecruitments(deadlines.data?.items || [], myTeamIds, viewer?.id)).slice(0, 4);
  const refresh = () => { void boot.refetch(); void teams.refetch(); void projects.refetch(); void deadlines.refetch(); };

  return <Screen back={false} onRefresh={refresh} refreshing={projects.isRefetching || teams.isRefetching}>
    <AppHeader />
    <HomeBanner onOpen={purpose => findTeams({ interest: purpose })} />
    <View style={[h.search, focused && { borderColor: '#829C60' }]}>
      <Icon name="search-outline" color={C.muted} size={21} />
      <TextInput accessibilityLabel="홈 검색어" value={search} onChangeText={setSearch} onFocus={() => setFocused(true)} onBlur={() => setFocused(false)}
        placeholder="수업·프로젝트·팀 찾기" placeholderTextColor={C.muted} returnKeyType="search" autoCapitalize="none" autoCorrect={false}
        selectionColor={C.lime} onSubmitEditing={() => findTeams({ q: search.trim() })}
        style={{ flex: 1, minWidth: 0, minHeight: 54, color: C.text, fontFamily: 'NotoSansKR_400Regular', fontSize: 15, paddingVertical: 8 }} />
      <Pressable accessibilityRole="button" accessibilityLabel="프로젝트 검색" onPress={() => findTeams({ q: search.trim(), focus: search.trim() ? '0' : '1' })} style={({ pressed }) => [h.searchAction, pressed && { backgroundColor: C.raised }]}>
        <Icon name="arrow-forward" color={C.text} size={20} />
      </Pressable>
    </View>
    <View accessibilityLabel="목적별 팀 찾기" style={h.purposes}>
      {PROJECT_PURPOSES.map(purpose => <Pressable key={purpose} accessibilityRole="button" accessibilityLabel={`${purpose} 팀 찾기`} onPress={() => findTeams({ interest: purpose })}
        style={({ pressed }) => [h.purpose, pressed && { backgroundColor: '#252B1E', borderColor: '#647849' }]}>
        <T style={{ fontSize: 13, lineHeight: 21, fontWeight: '600' }}>{purpose}</T>
      </Pressable>)}
    </View>

    <View style={h.quickActions}>
      <Button title="팀 모집하기" icon="add" onPress={() => router.push('/project/new')} style={{ flex: 1.15, minHeight: 52, paddingHorizontal: 12, borderRadius: 16 }} />
      <Pressable accessibilityRole="button" accessibilityLabel="내 활동 전체 보기" onPress={() => router.push('/teams')} style={({ pressed }) => [h.myActivity, pressed && { backgroundColor: C.raised }]}>
        <Icon name="people-outline" size={18}/><T style={{ fontSize: 14, fontWeight: '600' }}>내 활동</T><Icon name="chevron-forward" size={15} color={C.muted}/>
      </Pressable>
    </View>

    {!!urgent.length && <Section title="마감·남은 자리" label="마감순 보기" action={() => findTeams({ sort: 'deadline' })} spacing={24}>
      <ScrollView horizontal showsHorizontalScrollIndicator={false} style={{ flexGrow: 0 }} contentContainerStyle={{ gap: 10, paddingBottom: 2 }}>
        {urgent.map(project => <Pressable key={project.id} accessibilityRole="button" accessibilityLabel={`${project.title} · 남은 자리 상세 보기`} onPress={() => router.push('/project/' + project.id)}
          style={({ pressed }) => [h.urgent, pressed && { backgroundColor: C.raised }]}>
          <View style={[s.between, { gap: 12 }]}><T style={{ fontSize: 12, lineHeight: 20, color: C.lime, fontWeight: '700' }}>{project.capacity - project.memberCount === 1 ? '1자리 남음' : recruitmentDeadline(project)}</T><T muted style={{ fontSize: 11, lineHeight: 18 }}>{getProjectPurpose(project) || '프로젝트'}</T></View>
          <T numberOfLines={1} style={{ fontSize: 15, lineHeight: 24, fontWeight: '700', marginTop: 7 }}>{project.title}</T>
          <T muted numberOfLines={1} style={{ fontSize: 12, lineHeight: 20, marginTop: 5 }}>{project.roles.join(' · ')} · {project.capacity - project.memberCount}명 모집</T>
        </Pressable>)}
      </ScrollView>
    </Section>}

    <Section title="추천 팀 모집" label="전체 보기" spacing={24} action={() => findTeams()}>
      {projects.isLoading || teams.isLoading || boot.isLoading ? <Loading /> : projects.error || teams.error || boot.error ? <ErrorState error={projects.error || teams.error || boot.error} retry={refresh} />
        : available.length ? available.slice(0, 3).map((project, index) => <ProjectCard key={project.id} project={project} featured={index === 0} compact />)
        : <Empty title="새로운 모집을 기다리고 있어요" text="목적에 맞는 팀을 찾거나 직접 모집글을 작성해 보세요." action={() => findTeams()} actionLabel="팀 전체 둘러보기" />}
    </Section>

    <View style={h.guide}>
      <Pressable accessibilityRole="button" accessibilityLabel="처음 이용 안내" accessibilityState={{ expanded: showGuide }}
        onPress={() => setShowGuide(value => !value)} style={({ pressed }) => [s.between, { minHeight: 52, opacity: pressed ? .7 : 1 }]}>
        <T style={{ fontSize: 14, lineHeight: 24, fontWeight: '600' }}>처음 이용하시나요?</T>
        <Icon name={showGuide ? 'chevron-up' : 'chevron-down'} size={18} color={C.muted}/>
      </Pressable>
      {showGuide && <View style={{ paddingBottom: 8 }}>
        <T muted style={{ fontSize: 13, lineHeight: 24, marginTop: 4 }}>역할과 시간을 확인하고 신청해 보세요. 팀장이 승인하면 팀 대화가 열려요.</T>
        <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginTop: 12 }}>
          <Pressable accessibilityRole="button" accessibilityLabel="초보자 환영 팀 찾기" onPress={() => findTeams({ interest: '초보자 환영' })} style={h.guideAction}><T style={{ fontSize: 12, lineHeight: 20 }}>처음 참여하기 좋은 팀</T><Icon name="arrow-forward" size={16}/></Pressable>
          <Pressable accessibilityRole="button" accessibilityLabel="내 프로필 작성하기" onPress={() => router.push('/profile/edit')} style={h.guideAction}><T style={{ fontSize: 12, lineHeight: 20 }}>내 역할과 시간 정리</T><Icon name="arrow-forward" size={16}/></Pressable>
        </View>
      </View>}
    </View>
  </Screen>;
}

const h = StyleSheet.create({
  search: { minHeight: 56, borderRadius: 28, borderWidth: 1, borderColor: '#353C32', backgroundColor: C.card, marginTop: 0, paddingLeft: 16, paddingRight: 3, flexDirection: 'row', alignItems: 'center', gap: 10 },
  searchAction: { width: 48, height: 48, borderRadius: 24, alignItems: 'center', justifyContent: 'center' },
  purposes: { flexDirection: 'row', gap: 8, marginTop: 12 },
  purpose: { flex: 1, minHeight: 48, paddingVertical: 12, paddingHorizontal: 4, borderWidth: 1, borderColor: C.line, borderRadius: 24, alignItems: 'center', justifyContent: 'center', backgroundColor: C.card },
  quickActions: { flexDirection: 'row', alignItems: 'stretch', gap: 12, marginTop: 16 },
  myActivity: { flex: 1, minHeight: 52, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8, paddingHorizontal: 8, borderRadius: 16 },
  urgent: { width: 272, padding: 16, borderRadius: 20, borderWidth: 1, borderColor: C.line, backgroundColor: C.card },
  guide: { marginTop: 24, paddingTop: 12, borderTopWidth: 1, borderTopColor: C.line },
  guideAction: { minHeight: 48, flexDirection: 'row', alignItems: 'center', gap: 7, paddingRight: 14 },
});
