# Phase 6: deploy

## 사전 준비

**전제**: 아래가 빈 결과여야 한다.

```bash
git status --porcelain
```

출력이 있으면 이전 작업의 잔여 변경이 남아 있다는 뜻이다. 진행하지 말고 `tasks/1-slack-and-deploy/index.json`의 phase 6 status를 `"error"`로, `error_message`에 `dirty working tree`로 적고 멈춰라.

먼저 아래를 읽어라.

- `tasks/1-slack-and-deploy/docs-diff.md`
- `docs/adr/0006-slack-delivery-and-deployment.md`의 Railway 절과 종료 훅 결정
- `docs/adr/0003-postgres-hosting-railway.md` 전체 (사설망, PITR, 그리고 **아직 모르는 플랜 조건**)
- `docs/adr/0005-scheduler-and-daily-brief.md`의 "대가와 남는 위험" 마지막에서 두 번째 항목. **`enableShutdownHooks`가 없다는 것과 그것을 5단계에서 본다는 것이 거기 적혀 있다**
- `docs/adr/0001-runtime-and-tooling.md` (Node 24 이상, pnpm 11, `packageManager` 고정)
- `docs/user-intervention.md` 3번 (사람이 Railway에서 할 일)
- `package.json`의 `scripts`와 `packageManager`
- `pnpm-workspace.yaml` (`minimumReleaseAge`, `allowBuilds`)
- `src/main.ts`, `src/app.module.ts`
- `src/infrastructure/prisma/prisma.service.ts` (`onModuleDestroy`가 언제 불리는지)
- `.gitignore`
- `vitest.config.ts`

## 작업 내용

### 1. `GET /health`

`src/health/health.controller.ts`와 `src/health/health.module.ts`를 만들고 `AppModule`에 더한다.

DB까지 확인한다. `PrismaService`로 `SELECT 1`을 돌려 성공하면 200과 `{ "status": "ok" }`, 실패하면 503과 `{ "status": "error" }`를 돌려준다. 프로세스가 살아 있는 것만 보는 헬스체크는 DB 연결이 끊긴 서버를 정상으로 보고한다.

**인증을 걸지 마라.** Railway의 헬스체크가 토큰을 들고 오지 않는다. `McpModule`의 미들웨어는 `mcp` 경로에만 걸려 있으므로 그대로 두면 된다.

오류 본문에 예외 메시지를 싣지 마라. 접속 문자열이 새어 나갈 수 있다. 서버 로그에는 남긴다.

### 2. `src/main.ts`

`app.enableShutdownHooks()`를 더한다. ADR 0005가 4단계에 미뤄 둔 항목이다. 이것이 있어야 SIGTERM에 Nest의 종료 절차가 돌고, `PrismaService.onModuleDestroy`가 불려 커넥션 풀이 닫히며, 도는 크론이 정리된다.

phase 5가 넣은 `rawBody: true`는 그대로 둔다.

**여기에 주석으로 적을 것**: 종료 훅이 정리하는 것은 도는 tick과 커넥션이지, Slack 버튼의 지연 처리가 아니다. 200을 보낸 뒤 유스케이스를 부르기 전에 종료가 시작되면 그 탭은 사라진다. 부모가 다시 탭하면 멱등키가 같아 한 번만 기록된다. ADR 0006에 적힌 대가와 같은 것이다.

### 3. `Dockerfile`

멀티스테이지로 만든다. 베이스는 `node:24-alpine`이다. `engines.node`가 `>=24`이고 운영은 그 하한을 쓴다.

빌드 단계에서 하는 일 순서다.

1. `corepack`으로 `package.json`의 `packageManager`가 고정한 pnpm 버전을 활성화한다.
2. 의존성 파일만 먼저 복사하고 `pnpm install --frozen-lockfile`을 돌린다. 소스가 바뀌어도 이 층이 재사용된다.
3. 소스를 복사한다.
4. `pnpm prisma:generate`를 돌린다. **Prisma 7은 `migrate`도 `build`도 `generate`를 자동으로 부르지 않는다.** 이것이 빠지면 `src/generated`가 없어 빌드가 깨진다.
5. `pnpm build`를 돌린다.

런타임 단계에는 production 의존성과 `dist`만 넣는다. `node dist/main`으로 띄운다. `dist/generated/prisma`가 런타임에 필요하므로 `dist` 전체를 넣는다.

`pnpm-workspace.yaml`을 복사해야 한다. `minimumReleaseAge`와 `allowBuilds`가 거기 있고, 빠지면 설치 동작이 로컬과 달라진다.

`PORT`는 Railway가 환경 변수로 준다. `src/main.ts`가 이미 `process.env.PORT ?? 3000`을 읽는다. `EXPOSE`는 문서 목적이다.

### 4. `.dockerignore`

`node_modules`, `dist`, `.git`, `coverage`, `.env`, `cc-logs`, `tasks`, `prompts`, `scripts/__pycache__`를 넣는다. `node_modules`가 590MB라 빌드 컨텍스트에 들어가면 매 빌드가 그만큼 느려진다.

`prisma/`와 `docs/`는 제외하지 마라. 전자는 마이그레이션에 필요하고 후자는 이미지에 들어가도 작다.

### 5. `railway.json`

```json
{
  "$schema": "https://railway.com/railway.schema.json",
  "build": { "builder": "DOCKERFILE" },
  "deploy": {
    "preDeployCommand": ["pnpm db:deploy"],
    "healthcheckPath": "/health",
    "restartPolicyType": "ON_FAILURE"
  }
}
```

`preDeployCommand`는 빌드와 배포 사이에 돌고, 실패하면 배포가 진행되지 않으며, 서비스 환경 변수에 접근한다. 마이그레이션이 실패한 채 새 코드가 뜨는 것을 막는 것이 이 설정의 목적이다. 출처는 https://docs.railway.com/reference/config-as-code 와 https://docs.railway.com/deployments/pre-deploy-command 다.

`db:deploy`는 `prisma migrate deploy`이고 shadow DB를 쓰지 않으며 drift를 보지 않는다. 운영에 맞는 명령이다.

`numReplicas`를 넣지 마라. 인스턴스가 둘이어도 정합화와 발송이 안전하다는 것은 확인했지만, 그것을 기본값으로 만드는 것은 이번 단계의 범위가 아니다.

### 6. `vitest.config.ts`

임계값에 `src/health/**`를 더한다. 어댑터이므로 `src/mcp/**`와 같은 값(lines 90, branches 75, functions 90, statements 90)을 쓴다.

### 7. 통합 테스트 `test/integration/health.int-spec.ts`

`AppModule`을 띄워 `GET /health`가 200과 `{"status":"ok"}`를 주는 것을 확인한다. `test/integration/setup/mcp-server.ts`가 앱을 띄우는 방식을 따르되 토큰은 필요 없다.

인증이 걸려 있지 않다는 것도 확인한다. `Authorization` 헤더 없이 200이어야 한다.

## Acceptance Criteria

```bash
# 1) 파일이 생겼다
test -f Dockerfile
test -f .dockerignore
test -f railway.json
test -f src/health/health.controller.ts
test -f src/health/health.module.ts
test -f test/integration/health.int-spec.ts

# 2) railway.json이 유효한 JSON이고 필요한 키를 가진다
python3 -c "
import json
d = json.load(open('railway.json'))
assert d['build']['builder'] == 'DOCKERFILE', d['build']
assert d['deploy']['healthcheckPath'] == '/health', d['deploy']
assert d['deploy']['preDeployCommand'], d['deploy']
assert d['deploy']['restartPolicyType'] == 'ON_FAILURE', d['deploy']
assert 'numReplicas' not in d['deploy'], '이번 단계 범위가 아니다'
"

# 3) 종료 훅이 들어갔고 rawBody는 남아 있다
grep -q 'enableShutdownHooks' src/main.ts
grep -q 'rawBody' src/main.ts

# 4) Dockerfile이 generate를 빼먹지 않았다
grep -q 'prisma:generate' Dockerfile
grep -q 'frozen-lockfile' Dockerfile
grep -q 'pnpm-workspace.yaml' Dockerfile

# 5) 빌드 컨텍스트에서 node_modules를 뺐다
grep -q 'node_modules' .dockerignore

# 6) 커버리지 임계값에 새 디렉터리가 들어갔다
grep -q 'src/health' vitest.config.ts

# 7) 이미지가 실제로 빌드된다
docker build -t help-babyfood:phase6 .

# 8) 도메인 불변
git diff --quiet HEAD -- src/domain/

# 9) 앞 계층은 건드리지 않았다
git diff --quiet HEAD -- src/application/ src/slack/ src/scheduler/ src/infrastructure/ prisma/

# 10) 타입, 린트, 테스트
pnpm typecheck
pnpm lint
pnpm test
pnpm test:int
pnpm test:cov
```

7번은 시간이 걸린다. 실패하면 출력의 마지막 오류를 근거로 고쳐라. Docker 데몬이 없으면 이 phase는 시작되지 않는다.

## AC 검증 방법

위 명령을 순서대로 실행하라. 모두 통과하면 `tasks/1-slack-and-deploy/index.json`의 phase 6 status를 `"completed"`로 바꿔라.

세 번 고쳐도 통과하지 못하면 status를 `"error"`로 바꾸고, `"error_message"`에 어떤 명령이 어떤 출력으로 실패했는지 실제 출력을 근거로 적어라.

AC 통과와 index.json 갱신을 마쳤으면 커밋하라. 메시지는 `feat(slack-and-deploy): phase 6 deployment`로 한다.

## 하지 말아야 할 것

- **`/health`에 인증을 걸지 마라.** 헬스체크가 토큰을 들고 오지 않는다.
- **`/health`의 오류 본문에 예외 메시지를 싣지 마라.** 접속 문자열이 샌다.
- **Dockerfile에서 `pnpm prisma:generate`를 빼먹지 마라.** Prisma 7은 자동으로 부르지 않는다.
- **`pnpm install`에 `--frozen-lockfile`을 빼지 마라.** 잠금 파일과 다른 것이 설치된다.
- **`railway.json`에 `numReplicas`를 넣지 마라.**
- **Railway 프로젝트를 만들거나 배포를 시도하지 마라.** 계정, 결제 수단, PITR 플랜 확인은 사람 몫이고 `docs/user-intervention.md` 3번에 있다.
- **PITR 플랜 조건을 아는 것처럼 쓰지 마라.** 아직 모른다.
- **`.env`를 이미지에 넣지 마라.** 환경 변수는 Railway가 준다.
- **README를 고치지 마라.** phase 7이다.
- **`src/domain`을 고치지 마라.**
- **`tasks/` 안의 다른 파일을 고치지 마라.** `tasks/1-slack-and-deploy/index.json`의 phase 6 status만 갱신한다.
