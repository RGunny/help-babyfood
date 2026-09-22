# Phase 1: application

## 사전 준비

**전제**: 아래가 빈 결과여야 한다.

```bash
git status --porcelain
```

출력이 있으면 이전 작업의 잔여 변경이 남아 있다는 뜻이다. 진행하지 말고 `tasks/1-slack-and-deploy/index.json`의 phase 1 status를 `"error"`로, `error_message`에 `dirty working tree`로 적고 멈춰라.

먼저 아래를 읽고 설계 의도를 파악하라.

- `tasks/1-slack-and-deploy/docs-diff.md` (phase 0이 문서를 어떻게 바꿨는지. **이 task의 설계가 전부 거기 있다**)
- `docs/adr/0006-slack-delivery-and-deployment.md` (특히 재시도 정책, 브리프 시각 판정, 후속 메시지의 세 갈래)
- `docs/product-plan.md` 5장과 4.6절
- `src/application/reconcile.service.ts` (**이 phase가 만드는 서비스의 본보기다.** `runEveryHousehold`가 가정을 하나씩 돌고, 실패가 예외가 아니라 결과인 것)
- `src/application/daily-brief.service.ts`와 `src/application/daily-brief.ts` (`DailyBrief`의 모양. `slots`, `newIngredients`의 필드)
- `src/application/ports/clock.port.ts`와 `src/application/ports/household-directory.port.ts`
- `src/application/ports/tokens.ts` (주석이 말하는 "포트는 인터페이스라 런타임 값을 남기지 않는다")
- `src/application/reconcile.service.spec.ts` (**이 phase의 단위 테스트 본보기다.** 가짜 포트를 `class`로 만들어 호출을 기록하는 방식)
- `src/domain/shared/local-date.ts`, `local-time.ts`, `meal-slot.ts` (`LocalDate`, `LocalTime`, `MealSlot` 타입)

## 작업 내용

애플리케이션 계층만 만든다. **NestJS 배선을 하지 않는다.** 이 시점에는 `BriefDeliveryPort`의 구현이 없어서 모듈이 조립되지 않는다. 배선은 구현이 생기는 phase 3에서 한다.

파일 다섯 개를 만들고 `tokens.ts` 하나를 고친다.

### 1. `src/application/ports/brief-delivery.port.ts`

브리프를 밖으로 내보내는 아웃바운드 포트다. **이 파일은 Slack을 모른다.** 채널도 Block Kit도 토큰도 나오지 않는다.

```ts
export interface ReactionPromptIngredient {
  readonly ingredientId: string;
  readonly name: string;
  readonly exposureNumber: number;
}

/** 4.6절의 후속 메시지. 그 끼니의 새 재료마다 반응 기록 버튼이 붙는다. */
export interface ReactionPrompt {
  readonly date: LocalDate;
  readonly slot: MealSlot;
  readonly ingredients: readonly ReactionPromptIngredient[];
}

export type DeliveryResult =
  | { readonly kind: 'sent'; readonly reference: string }
  | { readonly kind: 'skipped'; readonly reason: string };

export interface BriefDeliveryPort {
  deliverDailyBrief(householdId: string, brief: DailyBrief): Promise<DeliveryResult>;
  deliverReactionPrompt(householdId: string, prompt: ReactionPrompt): Promise<DeliveryResult>;
}
```

`reference`는 나중에 그 메시지를 가리키기 위한 값이다. 실패는 예외로 던진다. `skipped`는 실패가 아니라 "보낼 곳이 없다"이고, 그것을 예외로 만들면 재시도 대상이 되어 매분 다시 시도하게 된다.

### 2. `src/application/ports/brief-delivery-log.port.ts`

발송 기록을 읽고 쓰는 포트다. 기획안 6장의 "발송 일시, 결과, 재시도 횟수"가 여기에 대응한다.

```ts
export interface DailyBriefClaim {
  readonly kind: 'brief';
  readonly householdId: string;
  readonly date: LocalDate;
  /** 이번이 몇 번째 시도인가. 1부터 시작한다. */
  readonly attempts: number;
}

export interface ReactionPromptClaim {
  readonly kind: 'reaction_prompt';
  readonly householdId: string;
  readonly date: LocalDate;
  readonly slot: MealSlot;
  readonly attempts: number;
}

export type DeliveryClaim = DailyBriefClaim | ReactionPromptClaim;

/** 한 번의 쓸기가 "지금"을 보는 방식. 시각은 전부 호출자가 준다. */
export interface DeliveryDue {
  readonly date: LocalDate;
  /** Asia/Seoul 벽시계 HH:mm. 저장소는 이것으로 브리프 시각과 식단시간을 비교한다. */
  readonly time: LocalTime;
  readonly instant: Date;
  readonly leaseSeconds: number;
  readonly maxAttempts: number;
}

export interface BriefDeliveryLogPort {
  claimDueDailyBriefs(due: DeliveryDue): Promise<DailyBriefClaim[]>;
  claimDueReactionPrompts(due: DeliveryDue): Promise<ReactionPromptClaim[]>;
  recordSent(claim: DeliveryClaim, reference: string, at: Date): Promise<void>;
  recordSkipped(claim: DeliveryClaim, reason: string, at: Date): Promise<void>;
  recordFailed(claim: DeliveryClaim, error: string, at: Date, nextAttemptAt: Date): Promise<void>;
  /** 클레임했지만 아직 할 일이 아니었을 때 자기 행을 지운다. 다음 tick이 다시 잡는다. */
  releaseClaim(claim: ReactionPromptClaim): Promise<void>;
}
```

`kind`를 판별자로 두는 이유는 저장소가 어느 테이블인지 구조로 추측하지 않게 하기 위해서다.

`nextAttemptAt`이 `recordFailed`의 인자인 것이 중요하다. 저장소가 계산하면 재시도 간격 표가 순수 함수와 SQL 두 벌이 된다.

### 3. `src/application/brief-dispatch.policy.ts`

재시도 정책이다. **간격과 상한이 이 파일에만 있어야 한다.**

```ts
/** 실패한 시도 n번째 뒤 다음 시도까지의 분. 마지막 값은 그 뒤로도 쓰인다. */
export const RETRY_DELAY_MINUTES = [1, 5, 15, 60] as const;
export const MAX_DELIVERY_ATTEMPTS = 5;
export const CLAIM_LEASE_SECONDS = 300;

export function nextAttemptAt(attempts: number, now: Date): Date;
```

`attempts`는 방금 실패한 시도의 번호다(1부터). 1회 실패 뒤 1분, 2회 뒤 5분, 3회 뒤 15분, 4회 뒤 60분이다. 5회째가 실패하면 다시 시도하지 않지만 `nextAttemptAt`은 그래도 값을 돌려줘야 한다. 저장소의 CHECK가 `status = 'failed'`인 행에 `next_attempt_at`을 요구하기 때문이다. 배열 범위를 넘으면 마지막 값(60분)을 쓴다. 재시도를 막는 것은 이 값이 아니라 `attempts < MAX_DELIVERY_ATTEMPTS` 조건이다.

### 4. `src/application/brief-dispatch.service.ts`

`ReconcileService.runEveryHousehold`와 같은 모양이다. 생성자에 포트를 받는 평범한 클래스이고 데코레이터를 달지 않는다.

```ts
export type DispatchTarget = 'brief' | 'reaction_prompt';

export type DispatchOutcome =
  | { readonly kind: 'sent'; readonly target: DispatchTarget; readonly householdId: string }
  | { readonly kind: 'skipped'; readonly target: DispatchTarget; readonly householdId: string; readonly reason: string }
  | { readonly kind: 'deferred'; readonly target: DispatchTarget; readonly householdId: string }
  | { readonly kind: 'failed'; readonly target: DispatchTarget; readonly householdId: string; readonly error: unknown };

export class BriefDispatchService {
  constructor(
    private readonly log: BriefDeliveryLogPort,
    private readonly delivery: BriefDeliveryPort,
    private readonly brief: DailyBriefService,
    private readonly clock: ClockPort,
  ) {}

  async runEveryHousehold(): Promise<DispatchOutcome[]>;
}
```

하는 일은 이렇다.

1. `now = this.clock.now()`, `instant = this.clock.instant()`. `due = { date: now.date, time: now.time, instant, leaseSeconds: CLAIM_LEASE_SECONDS, maxAttempts: MAX_DELIVERY_ATTEMPTS }`.
2. `claimDueDailyBriefs(due)`가 준 클레임마다: `brief.get(householdId)` → `delivery.deliverDailyBrief` → 결과가 `sent`면 `recordSent`, `skipped`면 `recordSkipped`.
3. `claimDueReactionPrompts(due)`가 준 클레임마다 아래 세 갈래로 나눈다. 브리프를 한 번 만들어(`brief.get`) 그 끼니의 `slots` 항목을 본다.

| 브리프가 말하는 것 | 처리 | 결과 |
|---|---|---|
| 그 끼니 항목이 없거나 `meal === null` | `recordSkipped(claim, 'no_meal', instant)` | `skipped` |
| `meal !== null`인데 `meal.fed === false` | `releaseClaim(claim)` | `deferred` |
| `fed === true`인데 그 끼니의 `newIngredients`가 비었다 | `recordSkipped(claim, 'no_new_ingredient', instant)` | `skipped` |
| `fed === true`이고 새 재료가 있다 | `deliverReactionPrompt` → `recordSent` 또는 `recordSkipped` | 결과대로 |

새 재료는 `brief.newIngredients`를 `entry.slot === claim.slot`으로 거른 것이다. `DailyBrief`에 필드를 더하지 마라. 필요한 `ingredientId`, `name`, `exposureNumber`가 이미 `BriefNewIngredient`에 있다.

4. 어느 단계에서든 예외가 나오면 `recordFailed(claim, 메시지, instant, nextAttemptAt(claim.attempts, instant))`를 부르고 `failed` 결과를 담는다. **한 가정의 실패가 다음 가정을 막지 않는다.** `ReconcileService.runEveryHousehold`가 같은 방식이다.
5. `recordFailed` 자체가 던지는 경우까지 삼키지는 마라. 그것은 DB가 죽은 것이고 다음 tick이 다시 시도한다.

첫 갈래(`meal === null`)를 되돌림이 아니라 종결로 두는 이유를 주석에 적어라. 미급여를 등록한 날에는 `fed`가 영영 true가 되지 않으므로 되돌림으로 두면 클레임과 삭제가 자정까지 매분 반복된다.

### 5. `src/application/ports/tokens.ts` 수정

심벌 둘을 더한다. 기존 주석의 뜻을 그대로 따른다.

```ts
export const BRIEF_DELIVERY = Symbol('BriefDeliveryPort');
export const BRIEF_DELIVERY_LOG = Symbol('BriefDeliveryLogPort');
```

**어느 모듈에도 바인딩하지 마라.** 구현이 아직 없다. 심벌만 있고 아무도 주입하지 않는 상태가 정상이다.

### 6. 단위 테스트

`src/application/brief-dispatch.policy.spec.ts`와 `src/application/brief-dispatch.service.spec.ts`를 만든다. 테스트 이름은 규칙을 한국어로 서술한다. 가짜 포트는 `src/application/reconcile.service.spec.ts`의 `RecordingWriter`처럼 호출을 기록하는 클래스로 만든다.

정책에서 고정할 것.

- 1회 실패 뒤 1분, 2회 뒤 5분, 3회 뒤 15분, 4회 뒤 60분이다.
- 5회째 실패에도 시각을 돌려준다(마지막 간격을 쓴다). 상한을 넘는 번호에서도 던지지 않는다.

서비스에서 고정할 것.

- 클레임에 넘기는 `time`이 `clock.now().time`이고 `date`가 `clock.now().date`다. 시각을 저장소가 정하지 않는다는 것을 고정하는 테스트다.
- 클레임이 비면 아무것도 보내지 않고 빈 결과를 돌려준다.
- 발송이 `sent`면 `recordSent`가 그 `reference`로 불린다.
- 발송이 `skipped`면 `recordSkipped`가 불리고 재시도 대상이 되지 않는다.
- 발송이 던지면 `recordFailed`가 `nextAttemptAt(attempts, instant)`와 같은 값으로 불린다.
- 한 가정의 발송이 던져도 다음 가정의 발송은 일어난다.
- 후속 메시지 세 갈래가 각각 `recordSkipped('no_meal')`, `releaseClaim`, `recordSkipped('no_new_ingredient')`로 간다.
- 후속 메시지가 그 끼니의 새 재료만 싣는다. 다른 끼니의 새 재료는 들어가지 않는다.

## Acceptance Criteria

아래를 순서대로 실행해 모두 exit 0이어야 한다.

```bash
# 1) 파일이 생겼다
test -f src/application/ports/brief-delivery.port.ts
test -f src/application/ports/brief-delivery-log.port.ts
test -f src/application/brief-dispatch.policy.ts
test -f src/application/brief-dispatch.service.ts
test -f src/application/brief-dispatch.policy.spec.ts
test -f src/application/brief-dispatch.service.spec.ts

# 2) 애플리케이션 계층이 NestJS와 Slack과 Prisma를 모른다
! grep -rn "@nestjs" src/application/ports/brief-delivery.port.ts src/application/ports/brief-delivery-log.port.ts src/application/brief-dispatch.policy.ts src/application/brief-dispatch.service.ts
! grep -rni "slack" src/application/ports/brief-delivery.port.ts src/application/ports/brief-delivery-log.port.ts src/application/brief-dispatch.policy.ts src/application/brief-dispatch.service.ts
! grep -rn "prisma" src/application/brief-dispatch.service.ts

# 3) 재시도 간격이 정책 파일에만 있다
test "$(grep -rln 'RETRY_DELAY_MINUTES' src/ | grep -v spec | wc -l | tr -d ' ')" = "1"

# 4) 아직 아무 모듈도 새 토큰을 바인딩하지 않았다
! grep -rn "BRIEF_DELIVERY" src/application/application.module.ts src/infrastructure/prisma/persistence.module.ts

# 5) 어댑터 계층은 건드리지 않았다
git diff --quiet HEAD -- src/mcp/ src/scheduler/ src/infrastructure/ prisma/

# 6) 도메인 불변
git diff --quiet HEAD -- src/domain/

# 7) 타입, 린트, 단위 테스트
pnpm typecheck
pnpm lint
pnpm test

# 8) 기존 배선 테스트가 수정 없이 통과한다 (새 토큰이 컨테이너에 새지 않았다는 증거)
git diff --quiet HEAD -- test/integration/wiring.int-spec.ts
pnpm test:int

# 9) 계층별 커버리지 임계값
pnpm test:cov
```

## AC 검증 방법

위 명령을 순서대로 실행하라. 모두 통과하면 `tasks/1-slack-and-deploy/index.json`의 phase 1 status를 `"completed"`로 바꿔라.

`pnpm test:cov`의 `src/application/**` 임계값은 lines 95, branches 85, functions 90, statements 90이다(`vitest.config.ts`). 이 phase가 더하는 코드는 전부 가짜 포트로 돌릴 수 있으므로 단위 테스트만으로 도달해야 한다. 도달하지 못하면 임계값을 낮추지 말고 테스트를 더 써라.

세 번 고쳐도 통과하지 못하면 status를 `"error"`로 바꾸고, `"error_message"`에 어떤 명령이 어떤 출력으로 실패했는지 실제 출력을 근거로 적어라.

AC 통과와 index.json 갱신을 마쳤으면 커밋하라. 메시지는 `feat(slack-and-deploy): phase 1 application`으로 한다.

## 하지 말아야 할 것

- **`src/application/application.module.ts`를 고치지 마라.** 구현이 없는 토큰을 컨테이너에 넣으면 부팅이 깨진다. 배선은 phase 3이다.
- **`prisma/schema.prisma`와 마이그레이션을 만들지 마라.** 저장은 phase 2다.
- **`src/infrastructure`에 파일을 만들지 마라.** 이 phase에는 포트의 구현이 없다.
- **`src/slack` 디렉터리를 만들지 마라.** phase 3이다.
- **`DailyBrief`에 필드를 더하지 마라.** 후속 메시지가 필요로 하는 것은 `newIngredients`에 이미 있다.
- **`src/domain`을 고치지 마라.** 이번 단계에 새 도메인 규칙은 없다. 브리프 조립이 그랬듯 조합으로 끝난다.
- **의존성을 설치하지 마라.** `@slack/types`는 phase 3이다.
- **`vitest.config.ts`의 임계값을 낮추지 마라.**
- **`src/application/daily-brief.ts`와 `daily-brief.service.ts`를 고치지 마라.** 읽기만 한다.
- **`tasks/` 안의 다른 파일을 고치지 마라.** `tasks/1-slack-and-deploy/index.json`의 phase 1 status만 갱신한다.
