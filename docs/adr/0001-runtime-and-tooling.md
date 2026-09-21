# ADR 0001: 런타임과 개발 도구

- 상태: 채택
- 결정일: 2026-09-21

## 맥락

서버는 NestJS(TypeScript)로 만들고, 개발 전체를 에이전트 코딩으로 진행한다. 새 저장소라서 런타임 버전, 프레임워크 메이저 버전, 테스트와 린트 도구, 패키지 매니저를 처음부터 정해야 한다. 개인 npm 정책은 의존성의 설치 스크립트를 막고(`ignore-scripts=true`) 공개된 지 7일이 안 된 버전을 받지 않는다(`min-release-age=604800`).

## 결정

| 항목 | 결정 |
|---|---|
| Node.js | `engines.node`는 `>=24`. 운영 버전은 배포 시점의 최신 LTS |
| 프레임워크 | NestJS 12, ESM 프로젝트 |
| 테스트 | Vitest |
| 린트 | oxlint |
| 패키지 매니저 | pnpm 11, `packageManager` 필드로 정확한 버전 고정 |

## 근거

### Node.js

결정일 기준 Active LTS는 24이고 22는 Maintenance LTS다. 26은 Current이며 2026년 10월에 LTS로 전환된다([Node.js Releases](https://nodejs.org/en/about/previous-releases)). 2026년 10월부터는 메이저 릴리스가 연 1회로 줄고 모든 릴리스가 LTS가 된다([Evolving the Node.js Release Schedule](https://nodejs.org/en/blog/announcements/evolving-the-nodejs-release-schedule)).

개발 장비에는 버전 매니저 없이 26.9.0만 설치돼 있다. 배포는 26이 LTS가 된 뒤일 가능성이 높아서, 하한만 24로 두고 버전 매니저를 새로 설치하지 않는다. 배포가 그보다 빠르면 운영은 24, 개발은 26으로 갈리므로 CI는 24에서 테스트를 돌린다.

### NestJS 12와 ESM

NestJS 12는 2026-08-28에 출시됐고 코어 패키지가 ESM으로 배포된다. 출시 글은 요구 버전을 이렇게 적는다.

> NestJS 12 requires Node.js v20.19+ or v22.12+ to run your applications.

출처: [NestJS v12 is Now Available (Trilon)](https://trilon.io/blog/nestjs-12-is-now-available). Trilon은 NestJS 창시자가 운영하는 회사의 블로그이고 공식 문서는 아니다.

새 프로젝트를 v11(CommonJS)로 시작하면 곧 ESM 마이그레이션 대상이 된다. 대가는 출시 직후라 예제가 적고, 에이전트가 v10~11의 CommonJS 관용구로 코드를 낼 수 있다는 점이다. 도메인 코어(`src/domain`)는 NestJS에 의존하지 않으므로 이 위험은 MCP 도구 구현 단계부터 해당한다.

### Vitest와 oxlint

NestJS 12 CLI는 ESM 프로젝트에 Vitest와 oxlint를 기본으로 생성한다(같은 출시 글). 스캐폴드가 만든 설정을 그대로 쓰면 데코레이터 메타데이터 같은 NestJS 고유 설정을 직접 맞출 필요가 없다. 대가는 Jest 기반의 기존 NestJS 예제를 그대로 쓸 수 없다는 점이다.

### pnpm 11

pnpm은 의존성의 빌드 스크립트를 기본으로 막고 허용 목록으로만 푼다. 공식 문서의 `allowBuilds` 설명이다.

> Packages not listed in `allowBuilds` are disallowed by default and are treated as unreviewed.

출처: [pnpm Build Settings](https://pnpm.io/settings/build). 개인 정책의 `ignore-scripts=true`와 같은 동작이 저장소 설정으로 고정되므로, 다른 장비나 CI에서도 같은 보호가 적용된다. `minimumReleaseAge`도 개인 정책과 같은 7일(10080분)로 둔다. node_modules가 엄격해서 `package.json`에 선언하지 않은 의존성을 import하면 실패한다.

결정일 기준 최신 메이저는 12다. 12.0.0이 2026-08-26에 나온 뒤 3주 동안 마이너가 다섯 번 올라갔고(npm 레지스트리의 `pnpm` 릴리스 시각), 11 계열도 계속 릴리스되고 있다(11.27.1, 2026-09-20). 패키지 매니저는 lock 파일 형식과 설치 결과를 좌우하므로 변동이 잦은 새 메이저 대신 11을 쓴다. 버전은 `packageManager` 필드 한 줄로 고정되므로 12로 옮기는 비용은 작다.

## 결과

- 개발 장비에 pnpm을 설치해야 한다.
- 빌드 스크립트가 필요한 의존성은 `allowBuilds`에 하나씩 추가하고 그때마다 사유를 확인한다.
- Node.js 26이 LTS가 되면 `engines`와 CI 버전을 다시 본다.
