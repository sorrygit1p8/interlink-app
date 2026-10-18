# 인터링크 운영 웹

루트에서 `npm run dev:web`를 실행하고 `http://127.0.0.1:3000`을 엽니다. 기본값은 외부 요청을 하지 않는 데모입니다. 신고 검토·콘텐츠 숨김/복구·계정 제한/해제·커뮤니티·초대 발급·실패 작업 재시도·감사 기록을 가상 데이터로 확인할 수 있습니다. 각 탭의 메모리 상태이며 새로고침/데모 초기화로 되돌아갑니다. 모바일 데모 및 계정 삭제 데모와 상태를 공유하지 않습니다.

## 실제 연결 설정

| 서버 환경 변수 | 의미 |
| --- | --- |
| `INTERLINK_DATA_MODE` | `demo` 또는 `supabase` |
| `INTERLINK_APP_ENV` | `development`, `staging`, `production` |
| `SUPABASE_URL` | 사용자가 소유한 프로젝트의 HTTPS 주소. 개발용 루프백 HTTP만 예외 |
| `SUPABASE_ANON_KEY` | 공개 publishable/anon 키. service-role/secret 키는 거부 |

실제 모드의 설정 누락은 오류로 표시하며 데모로 전환하지 않습니다. production은 데모를 차단하고 데이터 패키지의 production 전용 export를 번들에 연결합니다. 배포 빌드와 실행에 동일한 모드·환경을 설정하세요. 이 작업에서는 원격 연결을 수행하지 않았습니다. 전체 연결 순서는 루트의 연동 가이드를 따릅니다.

운영 접근에는 기존 등록 계정, Supabase 이메일 인증 코드, 인증 앱 TOTP, DB 운영자 권한이 필요합니다. 메일 템플릿에서 이메일 인증 코드를 제공하도록 설정해야 합니다. `/api/auth`는 가입을 허용하지 않습니다(`shouldCreateUser: false`). 최초 가입자나 이메일 비교로 관리자 권한을 부여하지 않습니다. 최초 운영자 권한 부여는 검토된 서버 절차로 수행해야 합니다.

서버는 HttpOnly·SameSite=Strict 쿠키로 세션을 관리하며 staging/production 쿠키는 Secure입니다. HTTPS 프록시는 Origin과 Host를 보존하도록 구성하세요. 모든 변경 API는 동일 출처 JSON을 요구합니다. 접근 쿠키가 만료되어도 유효한 갱신 쿠키로 세션을 복원하고 `getUser`로 검증합니다. 모든 운영 API는 AAL2 및 `admin.session` RPC를 확인하며 DB는 각 실제 작업에서도 권한을 다시 검증합니다. 추가 MFA 수단 등록은 기존 인증 수단이 있으면 AAL2를 요구합니다.

## 경로

- `/`: 운영 콘솔. 데모 모드에서는 가상 운영자, 실제 모드에서는 인증·권한 확인.
- `/account/delete`: 본인 확인 후 소유팀 종료와 계정 삭제 요청. 실제 삭제 POST는 `getUser` 검증이 필요하며 userId를 입력받지 않습니다.
- `/policies/terms`, `/policies/privacy`, `/policies/community`, `/policies/support`: 공개 출시 전 정책 초안. `content/policies.ts`의 `[미확정]` 값을 운영·법률 검토 후 교체합니다.

계정 삭제의 요청·처리 중·완료·실패는 서버 상태에 따라 구분합니다. 외부 Auth 계정이 먼저 제거된 경우 GET 상태 조회만 기존 접근 JWT를 PostgREST에 전달합니다. PostgREST가 서명·만료를 검증하며 `account.status`는 `auth.uid()`로 자기 상태만 반환합니다. 이 경로는 운영 권한이나 변경 작업에 재사용되지 않습니다. 접근 토큰이 만료되면 완료 여부를 추정하지 않습니다. 삭제 이후 재로그인이 불가능한 점과 보존/문의 절차는 실제 운영 정책에서 확정해야 합니다.

## 검증

```sh
npm run typecheck --workspace @interlink/web
npm exec eslint -- apps/web tests/unit/web-security.test.ts
npm test -- tests/unit/web-security.test.ts
npm run build:web
npm run test:e2e -- tests/e2e/operations.spec.ts
```

단위 테스트는 서버 제어 흐름과 인증 경계를 모의 SDK로 확인하며 실제 인증·JWT·RLS 검증을 대신하지 않습니다. Playwright는 실제 Next 서버를 실행한 상태에서 데모 조치를 검증합니다. 원격 통합, 이메일 발송, 실제 MFA, 삭제 처리기의 외부 Auth 제거는 후속 연동 검증 대상입니다.
