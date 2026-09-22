# Phase 4: scheduler

## 사전 준비

**전제**: 아래가 빈 결과여야 한다.

```bash
git status --porcelain
```

출력이 있으면 이전 작업의 잔여 변경이 남아 있다는 뜻이다. 진행하지 말고 `tasks/1-slack-and-deploy/index.json`의 phase 4 status를 `"error"`로, `error_message`에 `dirty working tree`로 적고 멈춰라.

먼저 아래를 읽어라.

- `tasks/1-slack-and-deploy/docs-diff.md`
- `docs/adr/0006-slack-delivery-and-deployment.md`
- `docs/adr/0005-scheduler-and-daily-brief.md` 전체. **이 phase가 만드는 잡의 모든 전제가 거기 있다.** 매분 크론인 이유, `waitForCompletion`, `SCHEDULER_ENABLED`가 잡의 등록 자체를 막는 방식
- `src/scheduler/reconcile.job.ts` (**본보기다.** 이 phase가 만드는 잡은 이것과 같은 모양이어야 한다)
- `src/scheduler/reconcile.job.spec.ts` (**단위 테스트 본보기.** `Logger.prototype`을 spy로 가로채는 방식)
- `src/scheduler/scheduler.module.ts` (`ScheduleModule.forRootAsync`가 한 번만 불린다는 주석)
- `src/application/brief-dispatch.service.ts` (phase 1이 만든 것. `DispatchOutcome`의 모양)
- `test/integration/scheduler.int-spec.ts` (**이 파일을 확장한다.** `SchedulerRegistry`로 등록을 확인하고 `fireOnTick`으로 발화시키는 방식)

## 작업 내용

스케줄러 어댑터 하나를 더한다. **이 계층은 애플리케이션 서비스 하나만 본다.** 저장소도 Prisma도 Slack도 보지 않는다. 하는 일은 부르는 것과 기록하는 것 둘이다.

### 1. `src/scheduler/brief-dispatch.job.ts`

`ReconcileJob`과 같은 모양으로 만든다.

```ts
export const BRIEF_DISPATCH_JOB = 'brief-dispatch';

@Injectable()
export class BriefDispatchJob {
  private readonly logger = new Logger(BriefDispatchJob.name);

  constructor(private readonly dispatch: BriefDispatchService) {}

  @Cron(CronExpression.EVERY_MINUTE, {
    name: BRIEF_DISPATCH_JOB,
    timeZone: SERVICE_TIME_ZONE,
    waitForCompletion: true,
  })
  async tick(): Promise<void>;
}
```

매분인 이유를 클래스 주석에 적어라. 브리프 시각은 가정마다 다르고 `update_alert_settings`로 바뀐다. 설정이 바뀔 때 잡을 다시 거는 방식은 인스턴스가 둘이면 다른 인스턴스의 레지스트리에 닿지 못해 옛 시각이 남는다. 매분 확인은 매번 DB를 읽으므로 항상 현재 설정을 본다. ADR 0005가 4단계에 정해 둔 것과 같은 이유다.

`tick`이 하는 일은 `dispatch.runEveryHousehold()`를 부르고 결과를 기록하는 것뿐이다.

- 쓸기 자체가 던지면(가정 목록조차 읽지 못한 경우) `logger.error`로 남기고 조용히 끝낸다. **예외를 밖으로 내지 마라.** 크론에서 던지면 다음 tick까지 아무 기록도 남지 않는다.
- `sent`와 `failed`는 남긴다. `skipped`와 `deferred`는 평상시의 정상 동작이라 매분 남기면 로그가 그것으로만 찬다. `ReconcileJob.report`가 "바뀐 것이 없는 쓸기는 남기지 않는다"로 같은 판단을 했다.
- `Error`가 아닌 것이 올라와도 기록할 내용을 만들어라. 드라이버가 문자열을 던지는 경우가 있다.

### 2. `src/scheduler/scheduler.module.ts`

`providers`에 `BriefDispatchJob`을 더한다. `ScheduleModule.forRootAsync`는 이미 있고 **다시 부르지 마라.** 두 번 부르면 모든 잡이 두 번 등록된다.

`SCHEDULER_ENABLED`가 false면 두 잡이 모두 등록되지 않아야 한다. `cronJobs: env.schedulerEnabled`가 탐색 단계에서 막으므로 provider만 더하면 자동으로 그렇게 된다.

`ApplicationModule`은 이미 import되어 있다. `BriefDispatchService`는 phase 3이 거기서 export했다.

### 3. 단위 테스트 `src/scheduler/brief-dispatch.job.spec.ts`

`reconcile.job.spec.ts`와 같은 방식으로 쓴다. 가짜 서비스를 만들어 결과를 돌려주고 `Logger.prototype`을 spy로 가로챈다.

- 보낸 것이 있으면 기록한다.
- 전부 `skipped`이거나 `deferred`면 기록하지 않는다.
- `failed`가 있으면 오류로 기록하고 tick은 끝까지 간다.
- 쓸기 자체가 던져도 tick이 예외를 밖으로 내지 않는다.
- `Error`가 아닌 것이 올라와도 기록이 비지 않는다.

### 4. 통합 테스트 `test/integration/scheduler.int-spec.ts` 확장

기존 "스케줄러 배선" describe에 더한다. 기존 테스트를 지우거나 고치지 마라.

- 서버를 띄우면 정합화 잡과 브리프 발송 잡이 **둘 다** 등록된다. 이름은 `RECONCILE_JOB`과 `BRIEF_DISPATCH_JOB`이다.
- 브리프 발송 잡의 크론 표현식도 `*/1 * * * *`다.
- `SCHEDULER_ENABLED`가 false면 등록된 잡이 0개다. 기존 테스트가 그것을 이미 단정하고 있으므로 잡이 둘이 되어도 0인지 확인하라.
- 등록된 브리프 잡을 `fireOnTick`으로 발화시키면 실제로 발송이 일어난다. 브리프 시각이 지난 가정을 만들고, 채널을 연결하고, 가짜 Slack 서버를 가리키게 한 뒤 `brief_delivery` 행이 `sent`가 되는 것을 확인한다.

`AppModule`을 띄울 때 Slack 발송이 진짜 slack.com으로 나가면 안 된다. `BRIEF_DELIVERY` 토큰을 테스트용 가짜 구현으로 `overrideProvider`하거나, phase 3이 만든 가짜 Slack 서버를 띄우고 `baseUrl`을 돌려라. **어느 쪽이든 실제 네트워크로 나가지 않는 것을 보장하라.**

## Acceptance Criteria

```bash
# 1) 파일이 생겼다
test -f src/scheduler/brief-dispatch.job.ts
test -f src/scheduler/brief-dispatch.job.spec.ts

# 2) 잡이 모듈에 등록됐고 forRoot는 한 번만 불린다
grep -q 'BriefDispatchJob' src/scheduler/scheduler.module.ts
test "$(grep -c 'forRootAsync' src/scheduler/scheduler.module.ts)" = "1"

# 3) 스케줄러가 저장소와 Slack을 모른다
! grep -rn 'prisma\|Prisma' src/scheduler/brief-dispatch.job.ts
! grep -rni 'slack' src/scheduler/brief-dispatch.job.ts

# 4) 매분 크론이다
grep -q 'EVERY_MINUTE' src/scheduler/brief-dispatch.job.ts
grep -q 'waitForCompletion' src/scheduler/brief-dispatch.job.ts

# 5) 앞 계층은 건드리지 않았다
git diff --quiet HEAD -- src/application/ src/slack/ src/infrastructure/ prisma/

# 6) 도메인 불변
git diff --quiet HEAD -- src/domain/

# 7) 타입, 린트, 테스트
pnpm typecheck
pnpm lint
pnpm test
pnpm test:int
pnpm test:cov
```

## AC 검증 방법

위 명령을 순서대로 실행하라. 모두 통과하면 `tasks/1-slack-and-deploy/index.json`의 phase 4 status를 `"completed"`로 바꿔라.

세 번 고쳐도 통과하지 못하면 status를 `"error"`로 바꾸고, `"error_message"`에 어떤 명령이 어떤 출력으로 실패했는지 실제 출력을 근거로 적어라.

AC 통과와 index.json 갱신을 마쳤으면 커밋하라. 메시지는 `feat(slack-and-deploy): phase 4 scheduler`로 한다.

## 하지 말아야 할 것

- **`ScheduleModule.forRootAsync`를 다시 부르지 마라.** 잡이 두 번 등록된다.
- **잡에 재고 규칙이나 발송 판정을 넣지 마라.** 부르고 기록하는 것이 전부다.
- **`skipped`와 `deferred`를 매분 로그로 남기지 마라.** 로그가 그것으로만 찬다.
- **`tick`에서 예외를 밖으로 내지 마라.**
- **`src/application`, `src/slack`, `src/infrastructure`, `prisma/`를 고치지 마라.** 이번 phase는 어댑터 하나와 그 배선뿐이다.
- **기존 `reconcile.job.ts`와 그 테스트를 고치지 마라.**
- **`test/integration/scheduler.int-spec.ts`의 기존 테스트를 지우지 마라.** 더하기만 한다.
- **통합 테스트에서 실제 slack.com으로 요청을 내지 마라.**
- **`src/domain`을 고치지 마라.**
- **`tasks/` 안의 다른 파일을 고치지 마라.** `tasks/1-slack-and-deploy/index.json`의 phase 4 status만 갱신한다.
