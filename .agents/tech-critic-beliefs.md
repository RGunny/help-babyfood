# tech-critic-lead 신념 (help-babyfood)

`tech-critic-lead` 에이전트가 시작할 때 읽는다. 절차와 형식은 에이전트 정의에 있고, 여기에는 이 저장소만의 규약과 기준선을 적는다.

## 계층 규약

`AGENTS.md`의 계층 절이 원본이다. 판정에 쓰는 형태로 다시 적으면 다음과 같다.

- `src/domain`은 프레임워크, DB, 시스템 시계를 모른다. 동결 경로다. `unfreeze`하는 phase는 왜 기존 도메인 함수 조합으로 안 되는지를 먼저 보여야 한다.
- `src/application`은 NestJS를 모른다. 서비스에 데코레이터가 붙거나 `@nestjs/*` import가 생기면 거부한다. 예외는 `*.module.ts`뿐이다.
- `src/mcp`, `src/scheduler`, `src/slack`은 어댑터다. 어댑터가 재고 규칙을 다시 쓰면 거부한다.
- 시각은 `ClockPort`로만 들어온다. `new Date()`와 `Date.now()`가 어댑터 밖에 생기면 거부한다.

## 기획 문서와 ADR 위치

- 기획: `docs/product-plan.md`. 규칙은 4장, 도구는 7장, 아키텍처는 8장, 단계는 9장, 미정은 10장이다.
- ADR: `docs/adr/NNNN-slug.md`. 머리에 상태와 결정일이 있다.
- 요구 입력: `docs/backlog.md`. 여기에도 기획 10장에도 없는 요구는 근거를 물어 돌려보낸다.

## 더 적은 비용으로 해결한 사례

4단계의 데일리 브리프가 새 도메인 함수 없이 기존 일곱 개의 조합으로 끝났다. 6단계의 상태판은 도메인에 회차 투영 함수 하나(`src/domain/ingredient/exposure-projection.ts`)만 더했다. 새 도메인 함수나 새 테이블을 요구하는 제안은 이 둘과 비교해 왜 조합으로 안 되는지를 보여야 한다.

## 이 저장소에서 특히 거부하는 것

- 계산으로 얻을 수 있는 상태의 저장. 식단 날짜, 도입 상태, 보류된 차감은 전부 계산이다.
- 운영 데이터 없는 호환 코드. 옛 문서 형식을 위한 nullable과 fallback.
- 사람이 멈춰서 확인해야 진행되는 phase. 그런 일은 `docs/user-intervention.md`로 넘긴다.
- 서술형 AC. 검증은 `pnpm typecheck`, `pnpm lint`, `pnpm test`, `pnpm test:int`, `grep`, `git diff --quiet "$HARNESS_BASELINE"`로만 한다.
