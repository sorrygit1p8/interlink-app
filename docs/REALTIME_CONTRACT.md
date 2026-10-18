# 실시간 구독과 DB 복구 계약

이 문서는 2026-10-18 현재 구현과 Supabase 공식 문서를 대조한 연결 준비 설계다. 실제 원격 구독이나 기존 소켓 권한 철회를 검증한 결과는 아니다.

## 선택한 방식과 권한 경계

`packages/data/src/supabase.ts`는 사용자별 `public.change_events`의 INSERT만 Postgres Changes로 구독한다. `user_id` 필터는 구독량을 줄이며, 실제 읽기 권한은 `202610170001_schema.sql`의 `read_own_events` RLS와 `interlink_event_allowed`가 검사한다. 활성 계정과 이벤트 수신자를 확인하고, 메시지 관련 이벤트에는 현재 팀 멤버십도 요구한다. 탈퇴 알림에 필요한 `membership`/`notifications` 신호도 현재 수신자 본인에게만 보낸다.

Broadcast·Presence는 `realtime.messages`의 정책과 private channel 설정으로 주제에 대한 송수신 권한을 관리한다. 채널 권한은 연결·새 JWT 시점에 갱신되므로, 권한을 철회했다는 이유만으로 기존 Broadcast 연결의 즉시 차단을 가정할 수 없다. 이 앱은 Broadcast·Presence에 대화 본문을 보내지 않는다. [Supabase Realtime Authorization](https://supabase.com/docs/guides/realtime/authorization)

Postgres Changes는 구독 대상 테이블의 행 읽기 권한을 적용한다. 메시지 테이블을 직접 publication에 넣는 대신 본문 없는 `change_events`만 발행하고, 실제 본문은 매번 권한을 재검사하는 `messages.list` RPC로 조회한다. DELETE 이벤트와 이전 행 전달에 의존하지 않으므로 삭제 전 본문이나 신고자 정보가 이벤트에 실리지 않는다. [Supabase Postgres Changes](https://supabase.com/docs/guides/realtime/postgres-changes)

## 최초 진입·누락·중복·역순 복구

1. 어댑터가 세션과 사용자별 구독을 준비한다. 첫 화면의 조회는 연결 준비 중에도 진행할 수 있다.
2. SDK가 `SUBSCRIBED`를 알리면 어댑터가 `scope: '*'` 신호를 보낸다. [Supabase JavaScript subscribe](https://supabase.com/docs/reference/javascript/subscribe)
3. `packages/data/src/query-reconciliation.ts`는 구독 전에 시작한 진행 중 조회를 취소한 뒤 캐시를 무효화하고 활성 질의를 새로 실행한다. `invalidateQueries`만 사용하면 TanStack Query가 데이터 없는 최초 요청을 재사용하여 구독 직전의 변경을 놓칠 수 있으므로 취소 단계를 분리한다.
4. 새 조회 중에 들어온 신호는 한 번의 추가 복구로 합친다. 매 이벤트마다 새 조회를 취소하지 않아 연속 메시지 중에도 완료된 DB 스냅샷을 표시할 수 있다. 비활성 질의는 다음 화면 진입 때 새로 조회한다.
5. 이벤트 본문을 캐시에 직접 병합하지 않는다. 중복·역순 신호는 같은 DB 재조회를 일으키며 이전 데이터를 덮어쓰지 않는다. 채팅은 서버 메시지 ID로 중복을 제거하고 서버 `createdAt`·ID 순서로 정렬한다. 이전 페이지까지 다시 조회해 삭제·숨김 상태를 반영한다.

사용자 변경 시 계정별 query key, 캐시 취소·제거, 어댑터의 인증 세대 확인으로 이전 계정의 늦은 응답을 거절한다. 구독 해제 시 복구 대기열을 폐기하며, 앱 종료 시 어댑터가 채널과 요청을 정리한다.

## 변경 신호와 다시 읽는 질의

현재 앱은 아래 신호마다 **모든 활성 질의**를 위 복구 대기열로 갱신하고 비활성 캐시도 무효화한다. 표는 각 신호에 반드시 포함되는 관련 질의다. 화면 간 카운트·권한 변화를 놓치지 않도록 아직 세부 범위 최적화를 하지 않았다.

| 신호/변경 | 관련 질의 |
| --- | --- |
| `applications`, 신청 제출·철회·승인·거절 | `applications.list`, `projects.detail`, `projects.search`, `teams.mine`, `bootstrap`, `notifications.list` |
| `invitations`, 초대·응답·취소 | `invitations.list`, `projects.detail`, `teams.mine`, `bootstrap`, `notifications.list` |
| `membership`, 팀원 추가·탈퇴·제거·이전 | `teams.mine`, `teams.members`, `teams.history`, `projects.detail`, `applications.list`, `invitations.list`, `messages.pages`, `bootstrap` |
| `messages`, 전송·삭제·읽음 | `messages.pages`의 로드된 모든 `messages.list` 페이지, `teams.mine`, `bootstrap`, `notifications.list` |
| `notifications` | `notifications.list`, `notifications.preferences`, `bootstrap` |
| `team`, 프로필·차단·운영 변경과 명령 완료 신호 | 현재 화면의 상세·탐색·팀·알림·권한 질의 전체 |
| `*`, `session`, `connection` | 현재 계정의 모든 활성 질의; 재연결·토큰 갱신 이후 스냅샷 복원 |

## 연결 수명과 후속 검증

앱 전경 복귀, 재연결 및 토큰 갱신 시 구독과 재조회를 복구한다. SDK 오류·시간 초과·닫힘 및 최초 세션 조회 실패는 최대 5회, 1·2·4·8·16초의 제한된 재시도를 거친다. 수동 재시도나 전경 복귀는 시도 횟수를 초기화한다. 연결 상태는 대기·연결 중·연결됨·재연결·오프라인으로 표시한다. 이 동작은 `packages/data/src/supabase.ts`에 구현되어 있으며 네트워크 전환 중 소켓 실패도 동일 복구 경로를 따른다.

`tests/unit/realtime-reconciliation.test.ts`는 설치된 TanStack Query로 최초 조회 경합·늦은 응답·이벤트 폭주·종료·캐시 제거를 검증한다. 어댑터 구독/재시도는 `supabase-contract.test.ts`, 계정 변경은 `backend-continuation-auth.test.ts`가 모의 전송으로 검증한다. 실제 기존 소켓 유지 후 탈퇴·강퇴·정지·비공개 전환, 재접속 누락 복구, JWT 갱신은 `INTEGRATION_TEST_PLAN.md`의 실제 A/B/C 세션 절차로 후속 검증한다. 데모 이벤트 버스나 위 단위 검사는 원격 Realtime 검증을 대신하지 않는다.
