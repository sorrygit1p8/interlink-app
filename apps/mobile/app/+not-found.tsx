import React from 'react';
import { router } from 'expo-router';
import { Screen, Empty } from '../src/ui';
export default function NotFound() { return <Screen title="페이지를 찾을 수 없어요"><Empty title="연결할 페이지가 없어요" text="주소가 바뀌었거나 접근할 수 없는 페이지예요." actionLabel="홈으로" action={() => router.replace('/')}/></Screen>; }
