# API 계약

계약의 기준은 `packages/shared/src/index.ts`의 `QueryMap`, `CommandMap`, `commandSchemas`다. 모든 JSON 응답은 camelCase, ID는 UUID, 시각은 ISO 8601이다. 공개 프로필에 이메일은 포함되지 않는다. 이 문서는 구현된 호출 경로를 설명하며 원격 연결 성공을 의미하지 않는다.

## 전송과 오류

`packages/data/src/demo.ts`는 기기 내 가상 상태를 변경한다. `packages/data/src/supabase.ts`는 실제 Supabase SDK `rpc`를 호출한다.

```ts
query(name, input, { signal })
// sdk.rpc('interlink_query', { operation: name, payload: input })
// 목록: { items: T[], nextCursor: string | null }

command(name, input, idempotencyKey)
// sdk.rpc('interlink_command', {
//   operation: name, payload: input, idempotency_key: UUID
// })
// 변경: { id: UUID, status?: string }
```

`supabase/migrations/202610170002_queries.sql` 및 `202610170003_commands.sql`이 RPC를 구현한다. 명령 인증 주체는 `auth.uid()`이며 요청에 입력한 userId/ownerId/역할은 권한을 부여하지 않는다. `userId`, `inviteeId` 등은 대상 식별자일 뿐이다. 승인·초대 수락은 서버 트랜잭션 안에서 정원(팀장 포함), 멤버십, 알림·작업을 반영한다.

클라이언트 타임아웃은 기본 12초이고 NETWORK/UNAVAILABLE만 한 번 더 시도한다. 재시도는 동일 명령 본문·멱등성 키를 유지한다. 사용자 취소는 AbortError로 유지한다. 폼 검증은 공유 Zod 스키마, 권한·최종 상태 검증은 DB에서 다시 수행한다. 같은 키에 다른 본문을 보내면 충돌로 처리한다. 알림/수신자는 클라이언트가 직접 생성하지 않는다.

| 오류 코드 | 의미 | 클라이언트 처리 |
| --- | --- | --- |
| CONFIGURATION | 모드/URL/공개 키/운영 설정 누락 | 설정 안내, 데모 자동 전환 금지 |
| UNAUTHENTICATED | 세션 없음·만료 | 로그인/본인 확인 |
| FORBIDDEN | 커뮤니티·소유권·멤버십·계정 상태 접근 거절 | 접근 사유 안내, 관리자 UI 숨김만으로 대체하지 않음 |
| VALIDATION | 형식·길이·상태 입력 오류 | 입력 수정 |
| NOT_FOUND | 없음 또는 노출 불가 | 안전한 없음 상태 |
| CLOSED / FULL | 모집 종료 / 정원 초과 | 신청·승인 상태 재조회 |
| DUPLICATE / CONFLICT | 중복 / 변경된 상태 또는 키 충돌 | 최신 상태 재조회 |
| RATE_LIMITED | 제공자 또는 서버 요청 제한 | 대기 후 재시도 |
| NETWORK / UNAVAILABLE | 연결 실패 / 일시 장애 | 제한된 자동 재시도와 수동 재시도 |

원시 SQL·스택·메일·토큰을 사용자 오류에 반환하지 않는다. `normalizeError`가 열거된 코드만 안전한 메시지로 변환한다.

## 질의

공통 검색 입력은 `{search?, interests?, roles?, availability?, activityMode?, beginnerFriendly?, status?, sort?, cursor?, limit?}`이다. `sort`는 recommended/newest/deadline, `limit` 최대 50. 클라이언트는 서버가 반환한 커서만 다음 요청에 사용하고 전체 사용자 정보를 내려받아 필터링하지 않는다.

아래 모든 `Page<T>` 응답의 입력은 `{cursor?,limit?}`를 포함한다. 표의 다른 입력은 이 페이지 입력에 추가한다. 미읽음 채팅 합계는 화면에 로드된 첫 페이지가 아닌 서버가 접근 가능한 전체 팀을 대상으로 계산한다.

| operation | 입력 → 출력 | 접근·범위 |
| --- | --- | --- |
| bootstrap | `{}` → viewer, community, unreadCount,messageUnreadCount | 본인 공개 프로필·접근 커뮤니티·자신의 미읽음 알림 및 팀 채팅 합계 |
| projects.search | 검색 → Page<Project> | 활성 커뮤니티·차단·노출·모집 조건 선적용, 추천 이유 포함 |
| projects.detail | `{id}` → project,members,application,invitation | 접근 가능한 프로젝트; 본인의 신청/초대 |
| people.search / people.detail | 검색 / `{id}` → Page<Profile> / Profile | 발견 허용·활성·같은 커뮤니티·차단 제외 |
| teams.mine / teams.members | `{}` / `{projectId}` → Page<Project/Membership> | 활성 팀원 범위 |
| teams.history | 페이지 입력 → Page<Project> | 본인의 과거 참여만; 탈퇴·제거 후 경험 기록용 최소 제목/식별자, 목표·설명·역할·관심사·시간·멤버 수 비공개. 채팅 권한을 복원하지 않음 |
| applications.list | `{projectId?}` → Page<Application> | 팀장 자신의 프로젝트 또는 본인 신청 |
| invitations.list | `{projectId?}` → Page<Invitation> | 초대 발신자·수신자/해당 팀장 |
| messages.list | `{projectId,cursor?,limit?}` → Page<Message> | 승인된 활성 팀원만, 최신부터 커서 조회 |
| notifications.list | `{cursor?,limit?}` → Page<Notification> | 본인만 |
| notifications.preferences | `{}` → push,team,applications | 본인만 |
| saved.list | `{}` → Page<Project> | 본인이 저장했고 현재 접근 가능한 프로젝트 |
| experiences.list | `{userId?}` → Page<Experience> | 본인 또는 공개·발견·커뮤니티 범위를 만족하는 경험 |
| blocks.list | `{}` → Page<Block> | 본인이 차단한 목록 |
| account.status | `{}` → status,deletionRequestId?,deletionStatus? | 본인만; 삭제 처리 상태 확인 |
| admin.session | `{}` → userId,role,mfa | 실제 서버 운영자 역할 + AAL2 |
| admin.overview | `{}` → reports,users,projects,failedJobs | 운영자; 데모에서는 가상 집계 |
| admin.reports / admin.report | `{status?,cursor?,limit?}` / `{id}` → Page<Report> / Report | 운영자, 신고 관련 최소 콘텐츠 |
| admin.audit / admin.jobs / admin.communities | 페이지 입력 → Page<AuditEntry/Job/Community> | 운영자 |

## 명령

모든 변경은 UUID 멱등성 키와 `{id,status?}` 응답을 사용한다. `ProjectInput`은 title,goal,description,interests,roles,capacity,activityMode,availability,deadline,beginnerFriendly,status?이며 전체 정원은 2~20명이다. `ProfileInput`은 nickname,avatar,interests,roles,learningRoles,skills,availability,activityMode,bio,discoverable,links와 선택 항목 educationLevel,onboardingCompleted다.

`Profile`/`ProfileInput`의 `educationLevel?: 'middle'|'high'|'university'|null`은 중학교/고등학교/대학교이며 `onboardingCompleted?: boolean`은 시작 설정 완료 여부다. 과거 응답과의 호환을 위해 타입은 선택 항목이고, 마이그레이션 `202610180009_profile_onboarding.sql` 이후 SQL 응답은 두 값을 명시한다. 기존 DB 프로필은 내용을 보존한 채 null/false로 시작한다. 학교급은 생년월일·학교명·인증 결과가 아니며 기존 권한 판단에 사용하지 않는다.

온보딩은 기존 `profile.update` 한 번으로 닉네임·관심 분야·학교급·완료 여부를 함께 저장한다. 완료 요청은 2~24자 닉네임, 관심 분야 한 개 이상, 유효한 학교급과 `onboardingCompleted:true`를 보낸다. 잘못된 학교급, 완료 필수 값 누락, 완료 상태의 false 전환은 `VALIDATION`이다. 일반 프로필 수정·공개 전환에서 두 선택 항목을 생략하면 저장된 값을 유지한다. 이미 완료한 프로필은 수정 후에도 학교급과 관심 분야 한 개 이상을 유지해야 한다. 계정 삭제의 최종 정리에서만 학교급/완료 상태를 null/false로 지운다.

데모 `createDemoState(actor)`는 완료된 가상 인물로 테스트와 역할 시연을 유지한다. 저장된 상태와 명시적 actor가 없는 기본 `createDemoClient()`는 A의 닉네임/관심 분야만 빈 값으로 시작하고 학교급 null/완료 false로 설정한다. 기본 클라이언트의 사용자 요청 초기화도 같은 상태로 돌아간다. v1 저장에 두 필드가 없으면 기존 별명·관심 분야와 팀 데이터를 보존하고 설정을 한 번 받으며, 읽기만으로 저장소를 다시 쓰지 않는다. 완료 여부는 화면 진입 흐름이며 팀 명령의 별도 권한으로 취급하지 않는다. 저장 실패는 변경 전체와 멱등성 기록을 반영하지 않고, SQL에서는 프로필 행 잠금과 기존 트랜잭션·멱등성 규칙을 따른다.

| operation | 입력 | 서버 권한·상태 변화 |
| --- | --- | --- |
| profile.update | ProfileInput | 본인, 학교급·시작 설정 원자 저장/생략 값 보존; 상태/커뮤니티/관리자 권한 쓰기 불가 |
| project.create / project.update | ProjectInput / ProjectInput+id | 활성 커뮤니티 사용자 / 팀장; 팀장 멤버십 포함 |
| project.transition | id,status | 팀장; draft/recruiting/active/completed/archived의 허용 전이 |
| project.disband | id | 현재 팀장만 가능. 한 트랜잭션에서 보관·대기 신청 거절·초대 취소·전체 멤버십 비활성화. 내용과 참여 이력 유지, 이미 해체된 팀은 같은 결과 반환 |
| project.save | id,saved | 본인 저장 추가/삭제 |
| application.submit | projectId,role,introduction | 본인/중복/차단/마감/정원 검사 후 pending |
| application.withdraw | id | 지원자 본인 pending → withdrawn |
| application.review | id,decision:approved/rejected | 팀장; 승인 시 멤버십·알림을 같은 트랜잭션에 반영 |
| invitation.send | projectId,inviteeId,role,message | 팀장, 초대 발송만으로 멤버 추가/정원 예약 없음 |
| invitation.respond | id,decision:accepted/declined | 수신자, 수락 시 정원 재검사 후 가입 |
| invitation.cancel | id | 발신 팀장, pending → cancelled |
| membership.leave | projectId | 본인, 팀장은 먼저 이전 또는 종료 |
| membership.remove | projectId,userId | 팀장, 대상 활성 멤버 권한 회수 |
| membership.transfer | projectId,userId | 팀장, 활성 대상 멤버에게 소유권 이전 |
| message.send | projectId,body,clientId | 활성 팀원, 공백 금지·2000자 한도, clientId 중복 방지 |
| message.delete | id | 본인 메시지, 노출 본문 제거 |
| message.read | projectId,messageId | 활성 팀원, 읽음 위치 갱신 |
| notification.read | id | 본인 알림 읽음 |
| notification.preferences | push,team,applications | 본인 선호 변경 |
| device.register / device.unregister | token,platform / token | 본인 기기, 유효 Expo 토큰 형식 |
| report.create | targetType,targetId,reason,detail | 접근 가능한 profile/project/message 신고; 신고자 비공개 |
| block.set | userId,blocked | 본인 차단/해제; 새 신청·초대·발견·관련 알림 제한 |
| experience.save / experience.delete | id?,projectId,title,description,role,isPublic / id | 본인 참여 이력 연결, 공개는 선택 |
| account.delete | confirmation:DELETE,ownedTeams:archive | 최근 15분 이내 제공자 본인 인증(amr) 세션, 삭제 요청→처리중/실패/완료. 토큰 refresh만으로 최근 인증 대체 불가 |
| community.join | code | 만료·사용 한도·접근범위 검증한 코드로 가입 |
| admin.action | reportId?,targetType,targetId,action,note | 서버 운영자+AAL2; hide/restore/suspend/reactivate/resolve/dismiss, 감사 기록 |
| admin.community | id?,name,status | 운영자, active/closed |
| admin.invite | communityId,maxUses,expiresAt | 운영자, 만료·한도를 가진 코드 생성 |
| admin.job.retry | id,note | 운영자, 실패 작업 재시도 및 감사 기록 |

## 인증·세션·실시간·Storage

`requestOtp`, `verifyOtp`, `getSession`, `refreshSession`, `signOut`는 Supabase Auth SDK 메서드를 감싼다. OTP 기본 로컬 설정은 6자리/600초이며 제공자 설정과 앱 UI를 함께 맞춘다. 실제 인증 실패에 가상 사용자를 반환하지 않는다. `signOut(token)`은 인증을 없애기 전에 기기를 해제하고 실패를 숨기지 않는다.

`subscribe`는 사용자별 `change_events`의 INSERT를 구독한다. 이벤트 본문은 scope/projectId 메타데이터로 제한하고 query cache를 무효화한다. SUBSCRIBED 이후 전체 재조회, 세션 갱신·전경 복귀·재연결 재조회를 한다. 구독 해제·dispose가 실제 SDK 채널을 정리한다. 최대 5회 제한된 지수 backoff를 적용한다. 실제 권한 철회 검증은 후속 통합 테스트다.

`uploadAvatar(bytes, contentType)`은 Bearer 사용자 세션을 포함한 `POST /functions/v1/image-upload`로 원시 바이트를 전송한다. 5MiB 이하 JPEG/PNG/WebP 입력, 서버에서 형식·해상도 검증/리사이즈/메타데이터 제거 후 사용자 소유 비공개 경로에 저장한다. 응답은 `{path,mimeType,width,height}`. `getAvatarUrl(path)`는 private avatars 버킷에 60초 signed URL을 요청한다. 실제 Storage 권한은 연결 후 검증한다.

푸시·삭제 처리기의 내부 RPC/작업 lease 계약은 `supabase/functions/README.md`를 따른다. 일반 클라이언트는 작업 획득/확인 RPC를 호출할 수 없다.

## 운영 웹 HTTP

`docs/openapi.yaml`에 `/api/auth`, `/api/session`, `/api/data`, `/api/account`를 정의했다. 실제 코드는 `apps/web/app/api/*/route.ts`이며 HTTPS HttpOnly 쿠키, 서버 사용자 검증, 동일 Origin JSON 요청을 사용한다. 데모 운영 UI는 이 실제 인증 API를 우회 호출하지 않는다.

삭제 처리 후 Auth 사용자가 없어졌을 때 `GET /api/account`만 기존 유효한 서명 access token으로 PostgREST의 본인 `account.status`를 조회할 수 있다. 이 예외는 삭제 쓰기나 운영자 API 권한을 허용하지 않는다. 토큰 만료/접근 실패를 삭제 완료 응답으로 바꾸지 않는다.

연결 후 적용·실행 순서는 `INTEGRATION_GUIDE.md`, 검사 범위와 결과는 `TEST_REPORT.md`를 확인한다.
