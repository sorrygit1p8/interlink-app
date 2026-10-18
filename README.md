# 인터링크 · Inter-Link

[Android APK 다운로드](https://github.com/sorrygit1p8/interlink-app/releases/download/v0.1.5/interlink-onboarding-final.apk) · [v0.1.5 릴리스](https://github.com/sorrygit1p8/interlink-app/releases/tag/v0.1.5)

학생들이 관심 분야와 프로젝트 목적에 맞는 팀을 찾고, 지원·초대·협업·경험 기록까지 이어 갈 수 있도록 만든 모바일 앱입니다. **중학교·고등학교·대학교**의 과제, 캡스톤, 공모전, 스터디 활동을 다룹니다.

현재 제출 버전은 **실서비스 백엔드에 연결하지 않는 로컬 데모**입니다. 예시 인물과 팀을 사용하며 입력한 정보·대화는 같은 기기에 저장됩니다. 실제 다른 사용자에게 메시지·메일·푸시를 보내거나 신고를 접수하지 않습니다. 실제 서비스 연결을 위한 Supabase 어댑터, SQL 마이그레이션과 서버 함수는 별도로 포함했습니다.

## 주요 기능

- **처음 설정**: 학교급 → 닉네임 → 관심 분야를 한 번 설정한 뒤 홈으로 이동합니다. 앱을 다시 열어도 완료한 설정을 반복하지 않으며 **내 정보 → 프로필 편집**에서 수정할 수 있습니다.
- **팀 찾기**: 조별과제·캡스톤·공모전·스터디 목적과 관심 분야·역할·활동 방식으로 검색합니다. 홈 배너는 양방향으로 순환하고 목적별 모집글로 연결됩니다.
- **프로젝트 모집**: 모집 조건 입력, 미리보기, 참여 신청·승인·거절, 팀원 초대와 응답을 지원합니다.
- **내 활동과 팀 관리**: 참여·운영 중인 팀과 신청·초대를 확인합니다. 팀장은 팀 공간에서 팀을 해체하고, 일반 팀원은 팀 메뉴에서 탈퇴할 수 있습니다. 대화 접근 권한은 회수하고 참여 이력과 경험은 보존합니다.
- **채팅과 프로필**: 팀 대화·미읽음 표시·알림·저장한 프로젝트·프로필 공개 설정·경험 기록을 제공합니다.
- **운영 웹**: 예시 신고 검토, 계정·커뮤니티 관리와 작업 상태를 확인하는 별도 화면입니다.

## 실행 환경과 시작 방법

**Node.js 24.3 이상·25 미만**, npm을 사용합니다. 로컬 데모에는 API 키나 외부 계정이 필요하지 않습니다.

```bash
npm ci
npm run check:config
npm run web --workspace @interlink/mobile
```

모바일 웹 미리보기는 기본적으로 `http://localhost:8081`에서 실행합니다. 운영 웹은 별도 터미널에서 실행합니다.

```bash
npm run dev:web
```

운영 웹의 기본 주소는 `http://localhost:3000`입니다. localhost는 실행 중인 컴퓨터의 주소입니다.

Windows에서는 `START-DEMO.cmd Install`로 의존성을 설치한 뒤 `START-DEMO.cmd`와 `START-DEMO.cmd Web`을 각각 실행할 수도 있습니다.

### 데모 체험 순서

1. 학교급·닉네임·관심 분야를 입력해 처음 설정을 완료합니다.
2. A 역할에서 **팀 모집하기**로 프로젝트를 만듭니다.
3. **내 정보 → 설정 · 계정 관리 → 데모 설정 → 가상 역할 전환**에서 B로 바꿔 방금 만든 팀에 지원합니다.
4. A로 돌아와 신청을 승인하고, B에서 팀 채팅과 활동을 확인합니다.

역할을 바꿔도 같은 기기의 프로젝트와 대화가 유지됩니다. 데모 초기화를 선택하면 사용자가 만든 가상 기록을 지우고 A의 처음 설정으로 돌아갑니다.

## Android 설치 파일

| 항목 | 값 |
| --- | --- |
| 버전 | **0.1.5 / versionCode 6** |
| 패키지 | `dev.interlink.demo` |
| 파일 | `interlink-onboarding-final.apk` |
| 환경 | staging / demo · ARM64 |
| 크기 | 43,940,279 bytes |
| SHA-256 | `d599e70b223e9ceadcf2dba7a68234e777e87786a86a9882006aab09b88c488c` |
| GitHub Release 다운로드 | [최종 APK 받기](https://github.com/sorrygit1p8/interlink-app/releases/download/v0.1.5/interlink-onboarding-final.apk) · [릴리스 안내](https://github.com/sorrygit1p8/interlink-app/releases/tag/v0.1.5) |

APK는 위 릴리스에서 내려받을 수 있습니다. 소스 트리에는 APK와 서명 개인 키를 포함하지 않습니다. V2 서명·아카이브·내장 번들·자산 일치와 네이티브 라이브러리 정렬은 확인했으며, 최종 APK의 실제 Android 기기·에뮬레이터 실행은 확인하지 않았습니다. iPhone용 IPA는 제공하지 않습니다.

## 검사와 빌드

```bash
npm run typecheck
npm run lint
npm test
npm run build:mobile
npm run check:production
npm run build:web
npm run test:e2e
```

브라우저 검사는 Expo 웹 export와 운영 웹 빌드를 사용합니다. 처음 실행할 때 필요한 경우 `npx playwright install chromium`으로 테스트 브라우저를 준비합니다. 이미 실행 중인 서버를 지정하려면 `MOBILE_BASE_URL`, `WEB_BASE_URL`을 사용합니다.

| 이번 버전에서 확인한 범위 | 결과 |
| --- | --- |
| 전체 단위·계약 검사 | **184/184 통과**, 19개 파일 |
| 전체 workspace 설정·TypeScript·소스 ESLint | 통과 |
| 모바일 브라우저 검사 | **서로 다른 46개 시나리오 통과**. 기존 39개와 처음 설정·진입 7개이며, 오류 복구·화면 이동 관련 수정 후 해당 사례를 재실행한 결과 포함 |
| 화면 확인 | 360/412/768 너비, 360×460 키보드 높이에서 입력·주요 버튼 접근과 가로 넘침 확인 |
| PostgreSQL 17 통합 검사 | **36개 그룹 통과**. 격리된 DB에서 권한·동시성·팀 해체·탈퇴·온보딩 저장과 계정 삭제를 확인 |
| Deno 서버 함수 검사 | 타입·lint·format·테스트 및 의존성 lock 검사 통과 |
| 운영 모드 정적 번들 검사 | Android·iOS·Web의 데모 모듈·예시 데이터 제외와 내장 소스 일치 검사 통과 |
| 실제 외부 인증·DB·메일·푸시 | 연결·실행하지 않음 |

JavaScript export는 APK와 다릅니다. 로컬에서 Android를 다시 빌드하려면 JDK와 Android SDK 등 네이티브 도구를 준비하고 `npm run android --workspace @interlink/mobile`을 사용합니다. 포함된 별도 APK 빌드 스크립트는 `JAVA_HOME`·`ANDROID_HOME` 등의 도구 환경 설정이 필요합니다. 환경 파일을 사용할 때만 `INTERLINK_TOOLS_ENV`로 경로를 명시합니다.

## 저장소 구성

| 경로 | 내용 |
| --- | --- |
| `apps/mobile` | Expo Router·React Native 모바일 앱과 이미지 자산 |
| `apps/web` | Next.js 운영 웹 |
| `packages/shared` | 프로필·프로젝트 타입, 입력 검증과 공통 로직 |
| `packages/data` | 기기 저장 데모와 분리된 Supabase 어댑터 |
| `supabase` | DB 마이그레이션, 권한/RLS, RPC, 서버 함수와 격리 검사 |
| `tests` | 단위·계약·브라우저 검사 |
| `docs` | API·구조·실시간 동기화·실제 연결 안내와 제3자 라이선스 고지 |

구조는 [ARCHITECTURE](docs/ARCHITECTURE.md), 호출 규칙은 [API 계약](docs/API_CONTRACT.md), 실제 서비스 연결 순서는 [연결 안내](docs/INTEGRATION_GUIDE.md)와 [통합 검사 계획](docs/INTEGRATION_TEST_PLAN.md)을 확인하세요. `.env.example`에는 변수 이름과 예시만 포함했습니다. 실제 비밀 값은 저장소에 커밋하지 않습니다.

Noto Sans KR의 라이선스 고지는 [docs/licenses/NotoSansKR.txt](docs/licenses/NotoSansKR.txt)에 보존했습니다. 기존 자산과 제3자 저작권 고지는 함께 유지합니다.
