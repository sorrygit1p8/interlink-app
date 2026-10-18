import React, { useCallback, useEffect, useRef, useState } from 'react';
import { ActivityIndicator, Keyboard, Modal, Platform, Pressable, ScrollView, StyleSheet, TextInput, View, useWindowDimensions } from 'react-native';
import { router, useFocusEffect, useLocalSearchParams } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { AVAILABILITY, INTERESTS, PROJECT_PURPOSES, ROLES, type Profile, type Project, type SearchInput } from '@interlink/shared';
import { AppHeader, PersonCard, ProjectCard, statusName } from './discovery';
import { selectionAccessibility, useReducedMotion } from './accessibility';
import { usePagedData } from './runtime';
import { Button, C, Empty, ErrorState, Icon, IconButton, Loading, LoadMore, Screen, T, Tag, s } from './ui';

type Kind = 'project' | 'people';
type Sort = NonNullable<SearchInput['sort']>;
type Filters = {
  interest: string;
  role: string;
  time: string;
  online: boolean;
  beginner: boolean;
  status: 'recruiting' | 'active' | 'completed';
};
const DEFAULT_FILTERS: Filters = { interest: '전체', role: '전체', time: '전체', online: false, beginner: false, status: 'recruiting' };
const PROJECT_CATEGORIES = ['전체', ...PROJECT_PURPOSES, ...INTERESTS];
const PEOPLE_CATEGORIES = ['전체', ...INTERESTS];
const TIMES = ['전체', '평일 저녁', '주말', ...AVAILABILITY.filter(value => value !== '평일 저녁')];
const SORT_LABELS: Record<Sort, string> = { recommended: '추천순', newest: '최신순', deadline: '마감순' };
const NEXT_SORT: Record<Sort, Sort> = { recommended: 'newest', newest: 'deadline', deadline: 'recommended' };
const firstParam = (value?: string | string[]) => Array.isArray(value) ? value[0] : value;
const isPurpose = (value: string) => PROJECT_PURPOSES.some(purpose => purpose === value);

function selectedConditions(filters: Filters, kind: Kind): { key: keyof Filters; label: string }[] {
  const selected: { key: keyof Filters; label: string }[] = [];
  if (filters.interest !== '전체') selected.push({ key: 'interest', label: filters.interest });
  if (filters.role !== '전체') selected.push({ key: 'role', label: `${filters.role} 역할` });
  if (filters.time !== '전체') selected.push({ key: 'time', label: filters.time });
  if (filters.online) selected.push({ key: 'online', label: '온라인' });
  if (kind === 'project' && filters.beginner) selected.push({ key: 'beginner', label: '초보자 환영' });
  if (kind === 'project' && filters.status !== 'recruiting') selected.push({ key: 'status', label: statusName[filters.status]! });
  return selected;
}

function ToggleRow({ title, description, label, checked, onChange }: {
  title: string;
  description: string;
  label: string;
  checked: boolean;
  onChange: (value: boolean) => void;
}) {
  return <Pressable accessibilityRole="switch" accessibilityLabel={label} accessibilityState={{ checked }} aria-checked={checked} onPress={() => onChange(!checked)} style={({ pressed }) => [e.toggleRow, pressed && { backgroundColor: C.raised }]}>
    <View style={{ flex: 1, paddingRight: 20 }}>
      <T style={{ fontSize: 14, fontWeight: '700', lineHeight: 24 }}>{title}</T>
      <T muted style={{ fontSize: 12, lineHeight: 20, marginTop: 4 }}>{description}</T>
    </View>
    <View accessible={false} style={[e.toggleTrack, checked && { backgroundColor: C.lime, borderColor: C.lime }]}>
      <View style={[e.toggleThumb, { left: checked ? 21 : 3, backgroundColor: checked ? C.bg : C.muted }]} />
    </View>
  </Pressable>;
}

/** Search and the category row apply immediately; advanced choices remain a draft until committed. */
export function ExploreScreen() {
  const params = useLocalSearchParams<{ interest?: string | string[]; kind?: string | string[]; q?: string | string[]; role?: string | string[]; sort?: string | string[]; reset?: string | string[]; focus?: string | string[] }>();
  const interestParam = firstParam(params.interest);
  const kindParam = firstParam(params.kind);
  const searchParam = firstParam(params.q);
  const roleParam = firstParam(params.role);
  const sortParam = firstParam(params.sort);
  const resetParam = firstParam(params.reset);
  const focusParam = firstParam(params.focus);
  const kind: Kind = kindParam === 'people' ? 'people' : 'project';
  const categories = kind === 'project' ? PROJECT_CATEGORIES : PEOPLE_CATEGORIES;
  const [search, setSearch] = useState('');
  const [debounced, setDebounced] = useState('');
  const [applied, setApplied] = useState<Filters>({ ...DEFAULT_FILTERS });
  const [draft, setDraft] = useState<Filters>({ ...DEFAULT_FILTERS });
  const [sheetOpen, setSheetOpen] = useState(false);
  const [sort, setSort] = useState<Sort>('recommended');
  const [searchFocused, setSearchFocused] = useState(false);
  const searchInputRef = useRef<React.ComponentRef<typeof TextInput>>(null);
  const [focusRequest, setFocusRequest] = useState(0);
  const lastFocusRequest = useRef(0);
  const reducedMotion = useReducedMotion();
  const insets = useSafeAreaInsets();
  const { height } = useWindowDimensions();

  useEffect(() => {
    if ([interestParam, searchParam, roleParam, sortParam, resetParam, focusParam].every(value => value === undefined)) return;
    setApplied(previous => {
      const next = resetParam === '1' ? { ...DEFAULT_FILTERS } : { ...previous };
      if (interestParam === '초보자 환영') { next.interest = '전체'; next.beginner = true; }
      else if (interestParam) next.interest = interestParam === '앱 개발' ? '기술' : interestParam;
      if (roleParam && ROLES.some(role => role === roleParam)) next.role = roleParam;
      if (kind === 'people' && isPurpose(next.interest)) next.interest = '전체';
      return next;
    });
    if (searchParam !== undefined || resetParam === '1') {
      const nextSearch = (searchParam || '').slice(0, 100);
      setSearch(nextSearch);
      setDebounced(nextSearch.trim());
    }
    if (sortParam === 'recommended' || sortParam === 'newest' || sortParam === 'deadline') setSort(sortParam);
    else if (resetParam === '1') setSort('recommended');
    if (focusParam === '1') setFocusRequest(previous => previous + 1);
    setSheetOpen(false);
    // Home shortcuts are commands. Consuming them preserves local edits on detail-back
    // and allows the same shortcut to be used again later.
    router.setParams({ interest: undefined, q: undefined, role: undefined, sort: undefined, reset: undefined, focus: undefined });
  }, [interestParam, searchParam, roleParam, sortParam, resetParam, focusParam, kind]);

  useFocusEffect(useCallback(() => {
    if (focusRequest === lastFocusRequest.current) return;
    lastFocusRequest.current = focusRequest;
    const timer = setTimeout(() => searchInputRef.current?.focus(), 120);
    return () => clearTimeout(timer);
  }, [focusRequest]));

  useEffect(() => {
    const timer = setTimeout(() => setDebounced(search.trim()), 300);
    return () => clearTimeout(timer);
  }, [search]);

  useEffect(() => {
    if (!sheetOpen || Platform.OS !== 'web') return;
    const onEscape = (event: KeyboardEvent) => {
      if (event.key === 'Escape') { event.preventDefault(); setSheetOpen(false); }
    };
    window.addEventListener('keydown', onEscape);
    return () => window.removeEventListener('keydown', onEscape);
  }, [sheetOpen]);

  const conditions = selectedConditions(applied, kind);
  const draftConditions = selectedConditions(draft, kind);
  const clearSearch = () => { setSearch(''); setDebounced(''); };
  const applyFilters = (next: Filters) => setApplied(next);
  const clearFilters = () => applyFilters({ ...DEFAULT_FILTERS });
  const removeCondition = (key: keyof Filters) => applyFilters({ ...applied, [key]: DEFAULT_FILTERS[key] });
  const openFilters = () => {
    Keyboard.dismiss();
    setDraft({ ...applied });
    setSheetOpen(true);
  };
  const closeFilters = () => setSheetOpen(false);
  const commitFilters = () => { applyFilters({ ...draft }); setSheetOpen(false); };
  const setKind = (next: Kind) => {
    Keyboard.dismiss();
    if (next === 'people' && isPurpose(applied.interest)) setApplied(previous => ({ ...previous, interest: '전체' }));
    router.setParams({ kind: next });
  };

  const input: SearchInput = {
    search: debounced,
    interests: applied.interest === '전체' ? undefined : [applied.interest],
    roles: applied.role === '전체' ? undefined : [applied.role],
    availability: applied.time === '전체' ? undefined : applied.time === '주말' ? ['주말', '주말 오전', '주말 오후'] : [applied.time],
    activityMode: applied.online ? 'online' : undefined,
    beginnerFriendly: kind === 'project' && applied.beginner || undefined,
    status: kind === 'project' ? applied.status : undefined,
    sort,
    limit: 8,
  };
  const projects = usePagedData('projects.search', input, kind === 'project');
  const people = usePagedData('people.search', input, kind === 'people');
  const current = kind === 'project' ? projects : people;
  const items = current.data?.items || [];
  const searchPending = search.trim() !== debounced;
  const updating = searchPending || current.isFetching && !current.isFetchingNextPage;
  const resultCount = `${items.length}${current.hasNextPage ? '+' : ''}`;
  const retry = () => void (current.isFetchNextPageError ? current.fetchNextPage() : current.refetch());

  return <>
    <Screen back={false} onRefresh={() => void current.refetch()} refreshing={current.isRefetching}>
      <AppHeader />
      <View style={e.heading}>
        <T accessibilityRole="header" style={e.title}>팀 찾기</T>
        <T muted style={e.subtitle}>목적과 역할에 맞는 팀을 찾아보세요.</T>
      </View>

      <View accessibilityRole="tablist" accessibilityLabel="탐색 대상" style={e.segments}>
        {([['project', '프로젝트', 'layers-outline'], ['people', '사람', 'people-outline']] as const).map(([key, label, icon]) => <Pressable key={key} accessibilityRole="tab" accessibilityLabel={label} {...selectionAccessibility(kind === key, 'tab')} onPress={() => setKind(key)} style={({ pressed }) => [e.segment, kind === key && e.segmentActive, pressed && { opacity: .8 }]}>
          <Icon name={icon} size={18} color={kind === key ? C.lime : C.muted} />
          <T style={{ fontSize: 14, lineHeight: 24, fontWeight: '700', color: kind === key ? C.text : C.muted }}>{label}</T>
        </Pressable>)}
      </View>

      <View style={[e.search, searchFocused && { borderColor: C.accentLine, backgroundColor: C.raised }]}>
        <Icon name="search-outline" color={C.muted} size={21} />
        <TextInput
          ref={searchInputRef}
          accessibilityLabel={kind === 'project' ? '프로젝트 검색어' : '사람 검색어'}
          value={search}
          onChangeText={setSearch}
          onFocus={() => setSearchFocused(true)}
          onBlur={() => setSearchFocused(false)}
          returnKeyType="search"
          autoCapitalize="none"
          autoCorrect={false}
          autoComplete="off"
          maxLength={100}
          selectionColor={C.lime}
          onSubmitEditing={() => { setDebounced(search.trim()); Keyboard.dismiss(); }}
          placeholder={kind === 'project' ? '프로젝트 검색' : '닉네임, 관심 분야 검색'}
          placeholderTextColor={C.muted}
          style={e.searchInput}
        />
        {search.length > 0 && <IconButton icon="close-circle" label="검색어 지우기" color={C.muted} onPress={clearSearch} />}
        <View style={e.searchDivider} />
        <Pressable accessibilityRole="button" accessibilityLabel="필터 열기" accessibilityHint={conditions.length ? `${conditions.length}개의 조건이 선택되어 있어요.` : '역할, 시간과 참여 조건을 선택해요.'} onPress={openFilters} style={({ pressed }) => [e.filterButton, pressed && { backgroundColor: C.raised }]}>
          <Icon name="options-outline" color={conditions.length ? C.lime : C.text} size={21} />
          <T style={{ fontSize: 12, lineHeight: 20, fontWeight: '700', color: conditions.length ? C.lime : C.text }}>필터</T>
          {conditions.length > 0 && <View style={e.filterDot} />}
        </Pressable>
      </View>

      <ScrollView horizontal showsHorizontalScrollIndicator={false} keyboardShouldPersistTaps="handled" style={e.categoryScroll} contentContainerStyle={e.categoryContent}>
        {categories.map(value => <Tag key={value} active={applied.interest === value} onPress={() => applyFilters({ ...applied, interest: value })}>{value}</Tag>)}
      </ScrollView>

      {conditions.length > 0 && <View accessibilityLabel={`선택 조건: ${conditions.map(condition => condition.label).join(', ')}`} style={e.selectedRow}>
        <ScrollView horizontal showsHorizontalScrollIndicator={false} keyboardShouldPersistTaps="handled" style={{ flex: 1 }} contentContainerStyle={{ gap: 8, paddingRight: 8 }}>
          {conditions.map(condition => <Pressable key={condition.key} accessibilityRole="button" accessibilityLabel={`${condition.label} 조건 해제`} onPress={() => removeCondition(condition.key)} style={({ pressed }) => [e.selectedChip, pressed && { backgroundColor: C.raised }]}>
            <T style={{ fontSize: 12, lineHeight: 20, color: C.text }}>{condition.label}</T>
            <Icon name="close" size={14} color={C.lime} />
          </Pressable>)}
        </ScrollView>
        <IconButton icon="refresh-outline" label="선택 조건 지우기" color={C.muted} onPress={clearFilters} />
      </View>}

      <View style={e.resultsHeader}>
        <View style={[s.row, { gap: 8, flexShrink: 1 }]}>
          <T accessibilityLiveRegion="polite" aria-live="polite" style={{ fontSize: 14, fontWeight: '700', lineHeight: 24 }}>
            {current.isLoading || searchPending ? '검색 중' : current.error && !items.length ? '검색 결과' : <>검색 결과 <T style={{ fontSize: 14, lineHeight: 24, fontWeight: '700', color: C.text }}>{resultCount}</T></>}
          </T>
          {updating && <ActivityIndicator size="small" color={C.lime} accessibilityLabel="검색 결과 업데이트 중" />}
        </View>
        <Pressable accessibilityRole="button" accessibilityLabel="정렬 변경" accessibilityHint={`${SORT_LABELS[NEXT_SORT[sort]]}으로 정렬합니다.`} accessibilityValue={{ text: SORT_LABELS[sort] }} onPress={() => setSort(NEXT_SORT[sort])} style={({ pressed }) => [e.sortButton, pressed && { backgroundColor: C.raised }]}>
          <T muted style={{ fontSize: 12, lineHeight: 20 }}>{SORT_LABELS[sort]}</T>
          <Icon name="swap-vertical-outline" size={15} color={C.muted} />
        </Pressable>
      </View>

      {current.isLoading || searchPending && !items.length ? <Loading /> : current.error && !items.length ? <ErrorState error={current.error} retry={() => void current.refetch()} /> : items.length ? items.map(item => kind === 'project'
        ? <ProjectCard key={item.id} project={item as Project} />
        : <PersonCard key={item.id} person={item as Profile} />)
        : <View><Empty icon="search-outline" title="검색 결과가 없어요" text={debounced ? `“${debounced}”에 맞는 결과가 없어요. 검색어나 선택한 조건을 바꿔보세요.` : '선택한 조건에 맞는 결과가 없어요. 조건을 줄이거나 직접 팀원을 모집해 보세요.'} actionLabel="필터 초기화" action={() => { clearSearch(); clearFilters(); }} />
          {kind === 'project' && isPurpose(applied.interest) && <Button title="이 목적으로 모집하기" icon="add-outline" onPress={() => router.push({ pathname: '/project/new', params: { purpose: applied.interest } })} style={{ marginBottom: 24 }} />}
        </View>}

      {!!items.length && current.error ? <View style={e.retryPanel}>
        <T muted style={{ fontSize: 14, lineHeight: 24, marginBottom: 16 }}>{current.isFetchNextPageError ? '다음 결과를 불러오지 못했어요.' : '최신 결과를 가져오지 못했어요.'}</T>
        <Button title="다시 시도" variant="secondary" onPress={retry} />
      </View> : !current.error && <LoadMore query={current} label="결과 더 불러오기" />}
    </Screen>

    <Modal visible={sheetOpen} accessibilityLabel="탐색 필터" transparent animationType={reducedMotion ? 'none' : 'fade'} onRequestClose={closeFilters} statusBarTranslucent navigationBarTranslucent presentationStyle="overFullScreen">
      <View style={[e.modalRoot, { paddingTop: Math.max(insets.top, 12) }]}>
        <Pressable accessible={false} onPress={closeFilters} style={e.backdrop} />
        <View accessibilityViewIsModal style={[e.sheet, { height: Math.max(280, Math.min(height - insets.top - 20, 780)) }]}>
          <View style={e.sheetHeader}>
            <View style={{ flex: 1, minWidth: 0 }}>
              <T accessibilityRole="header" style={{ fontSize: 20, lineHeight: 28, fontWeight: '700', letterSpacing: -.5 }}>검색 필터</T>
              <T muted style={{ fontSize: 12, lineHeight: 20, marginTop: 4 }}>{draftConditions.length ? `${draftConditions.length}개의 조건을 선택했어요.` : '필요한 조건만 골라보세요.'}</T>
            </View>
            <IconButton icon="close" label="필터 닫기" onPress={closeFilters} />
          </View>

          <ScrollView style={{ flex: 1 }} contentContainerStyle={e.sheetContent} showsVerticalScrollIndicator keyboardShouldPersistTaps="handled">
            {kind === 'project' && <View style={e.filterSection}>
              <T style={e.filterLabel}>프로젝트 상태</T>
              <View style={s.wrap}>{(['recruiting', 'active', 'completed'] as const).map(value => <Tag key={value} active={draft.status === value} onPress={() => setDraft(previous => ({ ...previous, status: value }))}>{statusName[value]}</Tag>)}</View>
            </View>}

            <View style={e.filterSection}>
              <T style={e.filterLabel}>{kind === 'project' ? '목적 · 관심 분야' : '관심 분야'}</T>
              <View style={s.wrap}>{categories.map(value => <Tag key={value} active={draft.interest === value} onPress={() => setDraft(previous => ({ ...previous, interest: value }))}>{value}</Tag>)}</View>
            </View>

            <View style={e.filterSection}>
              <T style={e.filterLabel}>{kind === 'project' ? '모집 역할' : '함께할 역할'}</T>
              <View style={s.wrap}>{['전체', ...ROLES].map(value => <Tag key={value} active={draft.role === value} onPress={() => setDraft(previous => ({ ...previous, role: value }))}>{value}</Tag>)}</View>
            </View>

            <View style={e.filterSection}>
              <T style={e.filterLabel}>가능한 시간</T>
              <View style={s.wrap}>{TIMES.map(value => <Tag key={value} active={draft.time === value} onPress={() => setDraft(previous => ({ ...previous, time: value }))}>{value}</Tag>)}</View>
            </View>

            <View style={e.toggleGroup}>
              <ToggleRow title="온라인으로 참여" description="장소에 구애받지 않고 함께해요." label={kind === 'project' ? '온라인 프로젝트만' : '온라인으로 활동하는 사람만'} checked={draft.online} onChange={online => setDraft(previous => ({ ...previous, online }))} />
              {kind === 'project' && <ToggleRow title="초보자 환영" description="처음 도전하는 역할도 괜찮아요." label="초보자 환영만" checked={draft.beginner} onChange={beginner => setDraft(previous => ({ ...previous, beginner }))} />}
            </View>
          </ScrollView>

          <View style={[e.sheetFooter, { paddingBottom: Math.max(insets.bottom, 16) }]}>
            <Pressable accessibilityRole="button" accessibilityLabel="조건 초기화" onPress={() => setDraft({ ...DEFAULT_FILTERS })} style={({ pressed }) => [e.resetButton, pressed && { backgroundColor: C.raised }]}>
              <Icon name="refresh-outline" size={17} color={C.muted} />
              <T style={{ fontSize: 14, lineHeight: 24, fontWeight: '700' }}>초기화</T>
            </Pressable>
            <Button title="결과 보기" onPress={commitFilters} style={{ flex: 1 }} />
          </View>
        </View>
      </View>
    </Modal>
  </>;
}

const e = StyleSheet.create({
  heading: { marginTop: 24, marginBottom: 24 },
  title: { fontSize: 28, lineHeight: 40, fontWeight: '700', letterSpacing: -.8 },
  subtitle: { fontSize: 14, lineHeight: 24, marginTop: 8 },
  segments: { flexDirection: 'row', gap: 4, borderRadius: 16, backgroundColor: C.card, padding: 4, marginBottom: 16 },
  segment: { flex: 1, minHeight: 48, borderRadius: 12, justifyContent: 'center', alignItems: 'center', flexDirection: 'row', gap: 8, paddingVertical: 8, paddingHorizontal: 12 },
  segmentActive: { backgroundColor: C.raised },
  search: { minHeight: 56, flexDirection: 'row', alignItems: 'center', gap: 8, paddingLeft: 16, paddingRight: 4, backgroundColor: C.card, borderWidth: 1, borderColor: C.line, borderRadius: 16 },
  searchInput: { flex: 1, minWidth: 0, minHeight: 56, color: C.text, fontSize: 14, fontFamily: 'NotoSansKR_400Regular', paddingVertical: 12 },
  searchDivider: { width: 1, height: 24, backgroundColor: C.line },
  filterButton: { minWidth: 64, minHeight: 48, paddingHorizontal: 8, flexDirection: 'row', gap: 4, borderRadius: 12, justifyContent: 'center', alignItems: 'center' },
  filterDot: { position: 'absolute', width: 6, height: 6, borderRadius: 3, backgroundColor: C.lime, right: 8, top: 8 },
  categoryScroll: { marginTop: 16, marginHorizontal: -20, flexGrow: 0 },
  categoryContent: { gap: 8, paddingHorizontal: 20, paddingVertical: 4, alignItems: 'center' },
  selectedRow: { flexDirection: 'row', alignItems: 'center', marginTop: 12 },
  selectedChip: { minHeight: 48, flexDirection: 'row', alignItems: 'center', gap: 8, borderRadius: 12, paddingHorizontal: 12, backgroundColor: C.tint },
  resultsHeader: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 12, marginTop: 20, marginBottom: 12, minHeight: 52 },
  sortButton: { minHeight: 52, minWidth: 88, paddingLeft: 12, paddingRight: 4, flexDirection: 'row', justifyContent: 'flex-end', alignItems: 'center', gap: 8, borderRadius: 12 },
  retryPanel: { backgroundColor: C.card, borderRadius: 20, borderWidth: 1, borderColor: C.line, padding: 20, marginTop: 8 },
  modalRoot: { flex: 1, alignItems: 'center', justifyContent: 'flex-end' },
  backdrop: { position: 'absolute', top: 0, right: 0, bottom: 0, left: 0, backgroundColor: 'rgba(0,0,0,0.72)' },
  sheet: { width: '100%', maxWidth: 620, backgroundColor: C.card, borderTopLeftRadius: 24, borderTopRightRadius: 24, borderWidth: 1, borderBottomWidth: 0, borderColor: C.line, overflow: 'hidden' },
  sheetHeader: { paddingLeft: 20, paddingRight: 12, paddingTop: 20, paddingBottom: 20, flexDirection: 'row', alignItems: 'center', gap: 12, borderBottomWidth: 1, borderColor: C.line },
  sheetContent: { paddingHorizontal: 20, paddingTop: 24, paddingBottom: 16 },
  filterSection: { marginBottom: 32 },
  filterLabel: { fontSize: 14, lineHeight: 24, fontWeight: '700', marginBottom: 12 },
  toggleGroup: { borderTopWidth: 1, borderTopColor: C.line, paddingTop: 4 },
  toggleRow: { flexDirection: 'row', alignItems: 'center', minHeight: 80, paddingVertical: 16, borderRadius: 12 },
  toggleTrack: { width: 46, height: 28, borderRadius: 14, backgroundColor: C.raised, borderWidth: 1, borderColor: C.line, justifyContent: 'center' },
  toggleThumb: { position: 'absolute', width: 20, height: 20, borderRadius: 10 },
  sheetFooter: { flexDirection: 'row', alignItems: 'center', gap: 12, paddingHorizontal: 20, paddingTop: 16, borderTopWidth: 1, borderColor: C.line, backgroundColor: C.card },
  resetButton: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8, minHeight: 52, minWidth: 88, borderRadius: 16, paddingHorizontal: 8 },
});
