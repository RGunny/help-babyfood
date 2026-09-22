# ADR 0005: 정합화는 매분 도는 크론으로 돌리고, 브리프는 읽기 경로에서 조립한다

- 상태: 채택
- 결정일: 2026-09-22

## 맥락

3단계까지 정합화는 쓰기 도구가 같은 트랜잭션에서 부를 때만 돌았다. 아무도 도구를 부르지 않는 날에는 식단시간이 지나도 차감이 일어나지 않는다. 기획안 9장은 그 구멍과 브리프 내용 생성을 4단계로 묶었다.

정할 것은 넷이다. 스케줄링을 어디서 가져올지, 정합화를 얼마나 자주 돌릴지, 브리프를 어느 계층에서 조립할지, 저장하지 않기로 한 보류된 차감을 브리프가 어떻게 읽을지다.

애플리케이션 계층은 NestJS를 모르고 도메인 코어는 1단계 이후 한 줄도 바뀌지 않았다. 스케줄러도 MCP와 같은 조건에서 붙어야 한다.

## 결정

### 스케줄링

`@nestjs/schedule` 12.0.2를 쓴다. `SchedulerModule`(`src/scheduler/scheduler.module.ts`)이 `ScheduleModule.forRootAsync`를 한 번 부르고, 잡은 `ReconcileJob.tick`에 `@Cron`을 단 어댑터 하나다.

크론 표현식은 `CronExpression.EVERY_MINUTE`(`*/1 * * * *`), 시간대는 `SERVICE_TIME_ZONE`, 겹침 방지는 `waitForCompletion`이다.

프로세스가 잡 없이 뜰 수 있게 `SCHEDULER_ENABLED`를 둔다. 기본값은 true이고, 끄면 크론이 등록되지 않는다.

### 정합화 주기

매분이다. 끼니의 식단시간에 맞춘 잡은 두지 않는다.

정합화는 `ReconcileService.runEveryHousehold`가 가정을 하나씩, 가정마다 트랜잭션 하나로 돈다. 동시에 던지지 않는 이유는 쓸기 한 번이 커넥션 풀 전체를 가져가면 그동안 MCP 요청이 트랜잭션을 얻지 못하기 때문이다.

한 가정의 실패는 결과로 담아 다음 가정으로 넘어간다. 정합화는 실행 사이에 아무것도 이어받지 않으므로, 실패한 가정은 다음 tick이 복구 절차 없이 그대로 다시 시도한다.

### 브리프 조립

기획안 5장의 브리프는 `src/application/daily-brief.ts`의 순수 함수 `buildDailyBrief`가 조립한다. 도메인에는 함수를 더하지 않았다. 구성 요소가 전부 1단계에 있고, 그것들을 한 화면으로 합치는 것은 규칙이 아니라 표현이다.

`lastPlannedMealDate`, `needsObservation`, `nextExposureNumber`는 1단계에서 브리프를 보고 만든 뒤 호출자가 없었고, 여기서 처음 쓰인다.

식단 잔여 일수의 경고 기준은 `PLAN_RUNWAY_WARNING_DAYS = 7`로 코드에 둔다. 기획안 6장의 알람 설정은 브리프 시각, 재료별 임계개수, 임계일 셋이고 저장 항목을 늘리지 않는다.

### 보류된 차감

`HeldDeduction`은 저장하지 않는다는 결정을 유지하고, 브리프는 읽어 온 상태에 `reconcileMeals`를 다시 걸어 `held`만 가져간다. 같은 호출이 만든 상태 변경과 원장 이벤트는 버린다.

`get_daily_brief`는 쓰기 트랜잭션을 열지 않는다. 통합 테스트가 식단시간이 지난 상태에서 브리프를 두 번 부른 뒤 원장 행 수와 식단 상태가 그대로인 것을 확인한다(`test/integration/daily-brief.int-spec.ts`).

### 브리프 시각과 발송 이력

4단계에는 브리프 발송이 없으므로 발송 이력 테이블도 두지 않는다. 기획안 6장이 말하는 "발송 일시, 결과, 재시도 횟수"는 셋 다 발송이 있어야 생기는 사실이다.

5단계에서 브리프를 보낼 때는 고정된 매분 크론이 가정마다 `alert_settings.brief_time`을 읽어 "시각이 지났고 오늘 것이 아직 없다"로 판정한다. 설정이 바뀔 때 잡을 다시 거는 방식은 택하지 않는다. 인스턴스가 둘이면 `update_alert_settings`가 다른 인스턴스의 레지스트리에 닿지 못해 옛 시각이 남고, 매분 확인은 매번 DB를 읽으므로 항상 현재 설정을 본다.

분 단위 동등 비교가 아니라 "지났는데 없다"로 판정하는 이유는 배포나 긴 GC로 한 분을 놓쳐도 다음 분에 회복하기 위해서다. 그 판정에는 하루 한 건이라는 규칙을 기본키로 강제하는 기록이 필요하고, 클레임은 가정 행 잠금 아래에서 조회 후 삽입으로 한다.

## 근거

### 왜 `@nestjs/schedule`인가

| 후보 | 버전과 호환 | 택하거나 택하지 않은 이유 |
|---|---|---|
| `@nestjs/schedule` | 12.0.2, 2026-09-14 공개. peer `@nestjs/common`, `@nestjs/core` 모두 `^11.0.0 \|\| ^12.0.0` | NestJS 12를 peer에 명시한다. 분 경계 발화, 시간대, 겹침 방지, 종료 시 정리를 이미 가지고 있다 |
| 직접 만든 `setInterval` 어댑터 | 의존성 없음 | `setInterval(60_000)`은 드리프트로 벽시계 분을 건너뛴다. 분 경계 계산과 겹침 방지, 종료 처리를 우리가 쓰고 테스트하게 된다 |

peer 범위와 공개일은 레지스트리에서, 아래 인용은 설치된 패키지에서 확인했다.

겹침 방지는 옵션 하나다.

> If true, no additional instances of cronjob will run until the current onTick callback has completed.
> Any new scheduled executions that occur while the current cronjob is running will be skipped entirely.

출처: `@nestjs/schedule@12.0.2`의 `dist/decorators/cron.decorator.d.ts`, `CronOptions.waitForCompletion`.

동적 API(`SchedulerRegistry.addCronJob`) 대신 `@Cron` 데코레이터를 쓴다. 패키지의 `dist/index.d.ts`는 `CronJob`을 다시 내보내지 않으므로, 동적 등록을 하려면 `cron`을 우리 `dependencies`에 직접 선언해야 한다. pnpm은 선언하지 않은 전이 의존성의 import를 막고, 선언하면 `@nestjs/schedule`이 고정한 4.4.0과 범위를 계속 맞춰야 한다. 데코레이터는 어댑터 클래스에만 달리므로 "서비스에 데코레이터를 달지 않는다"는 그대로 남는다.

`SCHEDULER_ENABLED`가 잡의 등록 자체를 막는 근거도 같은 패키지에 있다.

```js
case SchedulerType.CRON: {
    if (!this.moduleOptions.cronJobs) {
        return;
    }
```

출처: `dist/schedule.explorer.js`의 `lookupSchedulers`. tick마다 플래그를 보는 대신 탐색 단계에서 끝난다. `cronJobs`만 넘기므로 나중에 `@Interval`을 더하면 그것도 이 옵션에 한 줄을 더해야 등록된다.

### 왜 매분인가

지금 코드에 식단시간을 고치는 경로는 없다. `insertSlotSchedule`이 `create`뿐이고 `MealSlotService`에 update가 없다. 그래도 끼니는 새로 열리고, 식단시간에 맞춘 잡이라면 그때마다 잡을 다시 걸어야 한다. 인스턴스가 둘이면 그 변경을 모든 인스턴스에 전파할 수단까지 필요하다.

매분 크론은 DB에서 매번 현재 설정을 읽으므로 다시 걸 것이 없다. 서버가 오래 멈췄다 올라온 경우도 첫 tick이 처리한다. `reconcileMeals`는 tick 수가 아니라 `now`와 비교하고, 적재 범위가 윈도 밖의 예정 식단을 전부 읽기 때문이다(`src/infrastructure/prisma/household-state.repository.ts`).

보류된 차감도 여기서 값을 한다. 입고는 정합화를 부르지 않으므로, 늦게 등록된 조리는 다음 정합화에서야 반영된다. 매분이면 그 지연이 1분이고, 식단시간에 맞춘 잡이면 다음 끼니까지다.

### 왜 가정 행 잠금으로 충분한가

인스턴스가 둘로 늘면 같은 tick이 두 번 돈다. 그래도 결과는 같다. `reconcileMeals`는 규칙과 다른 식단만 골라 출력을 만들고, 모든 쓰기가 `household` 행을 `FOR UPDATE`로 잠가 두 쓸기를 직렬화한다. 뒤에 들어온 쪽은 앞의 결과를 보고 차이가 없으니 원장에 아무것도 더하지 않는다.

advisory lock은 두지 않는다. 세션 수준 잠금은 Prisma 풀에서 같은 커넥션을 보장할 수 없어 잠금과 해제가 다른 세션에 떨어질 수 있고, 트랜잭션 수준으로 바꾸면 모든 가정을 한 트랜잭션에 묶어야 해서 잠금을 오래 잡는다.

잠금이 막지 못하는 것은 한 번만 일어나야 하는 외부 효과다. 4단계에는 그것이 없고, 5단계의 Slack 발송이 그것이다.

### 왜 보류된 차감을 저장하지 않는가

저장한 행은 조리가 들어온 뒤에도 "부족"이라고 말한다. 매 정합화마다 통째로 갈아 끼우면 그 문제는 없어지지만, 마지막 정합화 시점의 투영을 하나 더 관리하게 되고 브리프의 정확도가 스케줄러의 지연에 묶인다.

순수 함수를 다시 부르면 둘 다 피한다. 계산은 `now` 기준이라 스케줄러가 멈춰 있어도 맞고, 관리할 상태가 늘지 않는다.

정합화 결과를 `applyReconcileResult`로 스냅샷에 얹어 재고까지 정합화 후 값으로 보이는 것도 검토했다. 택하지 않은 이유는 같은 순간에 `get_daily_brief`와 `get_stock_status`가 다른 수량을 말하기 때문이다. 식단시간 직후 최대 1분의 지연을 받아들이고 두 읽기 도구를 한 규칙에 둔다.

## 층별 결합

스케줄러 계층(`src/scheduler`)은 애플리케이션 서비스 하나만 본다. 저장소도 Prisma도 보지 않고, 하는 일은 호출과 기록 둘이다. MCP 계층이 도구에서 같은 서비스를 부르는 것과 같은 모양이라, 재고 규칙의 두 번째 사본이 자라지 않는다.

애플리케이션 계층은 스케줄러를 모른다. 이번에 더한 것은 가정 목록을 읽는 포트(`HouseholdDirectoryPort`)와 그것을 도는 `runEveryHousehold`, 그리고 브리프 읽기 모델이다. 가정 목록 포트를 따로 둔 이유는 다른 모든 포트가 호출자에게서 가정을 받는데 스케줄러에는 호출자가 없기 때문이다.

도메인 코어는 이번에도 바뀌지 않았다. 네 단계째다.

잡을 늘리는 방법은 `src/scheduler`에 어댑터를 더하고 `SchedulerModule`의 provider에 넣는 것이다. 새 잡이 재고를 직접 만지려면 애플리케이션에 유스케이스를 먼저 만들어야 한다.

## 대가와 남는 위험

- `cron@4.4.0`이 고정 버전으로 들어오고, 그것이 `luxon`과 `@types/luxon`을 런타임 의존성으로 끌어온다. 타입 패키지가 production 의존성에 들어오는 것은 cron의 선언이고 우리가 고칠 수 없다.
- 시간대 계산이 두 벌이 된다. 우리 벽시계는 `Intl`을 쓰는 `SeoulClock`이고, 크론 발화 시각은 luxon이 정한다. 매분 크론에서는 둘이 만나지 않지만, 5단계에서 브리프 시각을 보게 되면 판정은 `ClockPort`로만 한다.
- `SCHEDULER_ENABLED`를 실수로 false로 두고 배포하면 자동 차감이 조용히 멈춘다. 기본값이 true이고 `.env.example`에 그 사실을 적어 두는 것이 완화의 전부다.
- SIGTERM에 도는 tick을 정리하지 않는다. `main.ts`에 `enableShutdownHooks`가 없어서 프로세스가 그대로 죽고, 트랜잭션은 롤백되며 다음 tick이 같은 일을 다시 한다. 정합성 문제는 없지만 배포를 다루는 5단계에서 다시 본다.
- 가정 수가 늘면 쓸기 한 번의 길이가 가정 수에 비례한다. 순차로 도는 선택의 대가이고, 1분 안에 끝나지 않게 되면 잡을 나누거나 가정을 분배하는 방법을 그때 정한다.
