import React, { useEffect, useRef, useState } from 'react';
import { BackHandler, Keyboard, Pressable, StyleSheet, View } from 'react-native';
import { EDUCATION_LEVELS, EDUCATION_LEVEL_LABELS, INTERESTS, type Profile } from '@interlink/shared';
import { useCommand, useData, useRuntime } from './runtime';
import { Avatar, Button, C, ErrorState, Field, Icon, Loading, Logo, Screen, T, type IconName } from './ui';

type School = NonNullable<Profile['educationLevel']>;
const schools: Record<School, { icon: IconName; description: string }> = {
  middle: { icon: 'book-outline', description: '탐구와 동아리, 함께하는 과제' },
  high: { icon: 'school-outline', description: '수행평가와 탐구, 동아리 프로젝트' },
  university: { icon: 'library-outline', description: '조별과제와 캡스톤, 공모전' },
};
const headings = ['어디에서\n배우고 있나요?', '어떤 이름으로\n함께할까요?', '관심 있는 분야를\n골라 주세요'];
const descriptions = ['학교급을 선택해 주세요. 나중에도 바꿀 수 있어요.', '팀에서 사용할 닉네임이에요. 실명 대신 편한 이름도 좋아요.', '1개 이상 선택해 주세요. 관심 분야는 팀 추천에 반영돼요.'];

export function OnboardingScreen() {
  const boot = useData('bootstrap', {});
  const { client } = useRuntime();
  const { run, pending } = useCommand();
  const [step, setStep] = useState(0);
  const [school, setSchool] = useState<School | null>(null);
  const [nickname, setNickname] = useState('');
  const [interests, setInterests] = useState<string[]>([]);
  const [nicknameError, setNicknameError] = useState('');
  const [saveError, setSaveError] = useState('');
  const hydrated = useRef('');
  const person = boot.data?.viewer;

  useEffect(() => {
    if (!person || hydrated.current === person.id) return;
    hydrated.current = person.id;
    setSchool(person.educationLevel ?? null);
    setNickname(person.nickname);
    setInterests([...person.interests]);
    setStep(0);
    setNicknameError('');
    setSaveError('');
  }, [person]);
  useEffect(() => {
    const listener = BackHandler.addEventListener('hardwareBackPress', () => {
      if (!pending && step > 0) { Keyboard.dismiss(); setStep(value => value - 1); }
      return true;
    });
    return () => listener.remove();
  }, [step, pending]);

  function next() {
    if (pending) return;
    if (step === 0 && school) setStep(1);
    if (step === 1) {
      const name = nickname.trim();
      if (name.length < 2 || name.length > 24) { setNicknameError('닉네임은 2~24자로 입력해 주세요.'); return; }
      Keyboard.dismiss();
      setNickname(name);
      setNicknameError('');
      setStep(2);
    }
  }
  async function complete() {
    if (!person || !school || !interests.length || pending) return;
    setSaveError('');
    const result = await run('profile.update', {
      nickname: nickname.trim(), avatar: person.avatar, interests,
      roles: person.roles, learningRoles: person.learningRoles, skills: person.skills,
      availability: person.availability, activityMode: person.activityMode,
      bio: person.bio, discoverable: person.discoverable, links: person.links,
      educationLevel: school, onboardingCompleted: true,
    });
    // The root navigator opens Home only after the saved bootstrap confirms completion.
    if (!result) setSaveError('설정을 저장하지 못했어요. 입력한 내용은 그대로 있으니 다시 시도해 주세요.');
  }

  if (boot.isLoading) return <Screen back={false}><Loading /></Screen>;
  if (!person) return <Screen back={false}><ErrorState error={boot.error || new Error('프로필을 불러오지 못했어요.')} retry={() => void boot.refetch()} /></Screen>;
  const choices = [...new Set<string>([...INTERESTS, ...person.interests, ...interests])];

  return <Screen back={false} footer={<View style={{ gap: 10 }}>
    <T muted style={{ fontSize: 12, lineHeight: 20, textAlign: 'center' }}>설정한 정보는 내 정보에서 수정할 수 있어요.</T>
    <View style={{ flexDirection: 'row', gap: 12 }}>
      {step > 0 && <Pressable accessibilityRole="button" accessibilityLabel="이전 단계" disabled={pending}
        onPress={() => { Keyboard.dismiss(); setStep(value => value - 1); }} style={({ pressed }) => [styles.back, pressed && { backgroundColor: C.raised }]}><Icon name="arrow-back" size={22} /></Pressable>}
      <Button title={step === 2 ? '인터링크 시작하기' : '다음'} icon={step === 2 ? 'arrow-forward' : undefined}
        busy={pending} disabled={step === 0 && !school || step === 2 && !interests.length}
        onPress={step === 2 ? () => void complete() : next} style={{ flex: 1 }} />
    </View>
  </View>}>
    <View style={styles.header}><Logo /><T muted style={{ fontSize: 12, lineHeight: 20 }}>처음 설정</T></View>
    <View accessibilityLabel={`처음 설정 ${step + 1} / 3단계`} style={styles.progress}>
      {[0, 1, 2].map(value => <View key={value} style={{ flex: 1, height: 3, borderRadius: 2, backgroundColor: value <= step ? C.lime : C.line }} />)}
    </View>
    <View style={{ marginTop: 28, marginBottom: 28 }}>
      <T style={{ color: C.lime, fontSize: 12, lineHeight: 20, marginBottom: 10 }}>{['학교급', '닉네임', '관심 분야'][step]} · {step + 1} / 3</T>
      <T accessibilityRole="header" style={styles.title}>{headings[step]}</T>
      <T muted style={{ fontSize: 14, lineHeight: 24, marginTop: 14 }}>{descriptions[step]}</T>
    </View>

    {step === 0 && <View accessibilityLabel="학교급 선택" style={{ gap: 12 }}>
      {EDUCATION_LEVELS.map(value => <Pressable key={value} accessibilityRole="radio" accessibilityLabel={EDUCATION_LEVEL_LABELS[value]}
        accessibilityState={{ checked: school === value }} aria-checked={school === value}
        onPress={() => setSchool(value)} style={({ pressed }) => [styles.school, school === value && styles.selected, pressed && { opacity: .86 }]}>
        <View style={[styles.schoolIcon, school === value && { backgroundColor: C.tint }]}><Icon name={schools[value].icon} size={24} color={school === value ? C.lime : C.muted} /></View>
        <View style={{ flex: 1, minWidth: 0 }}><T style={{ fontSize: 17, lineHeight: 26, fontWeight: '700' }}>{EDUCATION_LEVEL_LABELS[value]}</T><T muted style={{ fontSize: 12, lineHeight: 20, marginTop: 3 }}>{schools[value].description}</T></View>
        <Icon name={school === value ? 'checkmark-circle' : 'ellipse-outline'} size={22} color={school === value ? C.lime : C.line} />
      </Pressable>)}
    </View>}

    {step === 1 && <View>
      <Field label="닉네임" value={nickname} autoFocus autoCapitalize="none" autoCorrect={false} maxLength={24} returnKeyType="next"
        onChangeText={value => { setNickname(value); setNicknameError(''); }} onSubmitEditing={next} error={nicknameError || undefined}
        placeholder="사용할 닉네임을 입력해 주세요" hint="2~24자로 입력해 주세요." />
      <View style={styles.preview}><Avatar name={nickname.trim() || '나'} avatar={person.avatar} size={44} /><View style={{ flex: 1 }}><T numberOfLines={1} style={{ fontSize: 16, lineHeight: 25, fontWeight: '700' }}>{nickname.trim() || '나의 닉네임'}</T><T muted style={{ fontSize: 12, lineHeight: 20 }}>{school ? EDUCATION_LEVEL_LABELS[school] : ''}</T></View></View>
    </View>}

    {step === 2 && <View>
      <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 14 }}>
        <T style={{ fontSize: 14, lineHeight: 24, fontWeight: '700' }}>관심 분야 선택</T><T style={{ color: C.lime, fontSize: 12, lineHeight: 20 }}>{interests.length}개 선택</T>
      </View>
      <View style={styles.interests}>
        {choices.map(value => {
          const selected = interests.includes(value);
          const disabled = pending || (!selected && interests.length >= 20);
          return <Pressable key={value} accessibilityRole="checkbox" accessibilityLabel={value} accessibilityState={{ checked: selected, disabled }} aria-checked={selected} disabled={disabled}
            onPress={() => setInterests(current => selected ? current.filter(item => item !== value) : [...current, value])}
            style={({ pressed }) => [styles.interest, selected && styles.selected, disabled && !selected && { opacity: .45 }, pressed && { opacity: .86 }]}>
            <T style={{ fontSize: 14, lineHeight: 24, fontWeight: selected ? '700' : '400', color: selected ? C.lime : C.text, flexShrink: 1 }}>{value}</T>
            <Icon name={selected ? 'checkmark' : 'add'} size={17} color={selected ? C.lime : C.muted} />
          </Pressable>;
        })}
      </View>
      {interests.length >= 20 && <T muted style={{ fontSize: 12, lineHeight: 21, marginTop: 16 }}>관심 분야는 최대 20개까지 선택할 수 있어요.</T>}
      {saveError ? <T accessibilityRole="alert" style={{ color: C.danger, fontSize: 13, lineHeight: 22, marginTop: 20 }}>{saveError}</T> : null}
      {client.mode === 'demo' && <T muted style={{ fontSize: 12, lineHeight: 21, marginTop: 24 }}>현재 데모에서는 설정이 이 기기에 저장돼요.</T>}
    </View>}
  </Screen>;
}

const styles = StyleSheet.create({
  header: { minHeight: 72, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 16 },
  progress: { flexDirection: 'row', gap: 6, marginTop: 8 },
  title: { fontSize: 30, lineHeight: 41, fontWeight: '700', letterSpacing: -.8 },
  school: { minHeight: 88, padding: 16, borderRadius: 18, borderWidth: 1, borderColor: C.line, backgroundColor: C.card, flexDirection: 'row', alignItems: 'center', gap: 14 },
  schoolIcon: { width: 44, height: 44, borderRadius: 14, backgroundColor: C.raised, alignItems: 'center', justifyContent: 'center' },
  selected: { borderColor: C.accentLine, backgroundColor: '#141D0F' },
  preview: { flexDirection: 'row', alignItems: 'center', gap: 12, padding: 18, backgroundColor: C.card, borderRadius: 18, borderWidth: 1, borderColor: C.line },
  interests: { flexDirection: 'row', flexWrap: 'wrap', gap: 10 },
  interest: { minHeight: 54, width: '48%', paddingHorizontal: 16, paddingVertical: 12, borderRadius: 16, borderWidth: 1, borderColor: C.line, backgroundColor: C.card, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 6 },
  back: { width: 52, minHeight: 52, borderRadius: 16, alignItems: 'center', justifyContent: 'center', borderWidth: 1, borderColor: C.line },
});
