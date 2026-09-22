# ADR 0002: ORM은 Prisma 7

- 상태: 채택
- 결정일: 2026-09-21
- 적용 시점: 영속화 단계 (도메인 코어 이후)

## 맥락

재고는 원장 이벤트의 합으로 계산한다. 실제 급여 내용을 고치면 "기존 소비 취소"와 "새 내용으로 재차감"이 함께 기록돼야 하고, 하나만 기록되면 재고가 틀어진다. 부모 두 명과 스케줄러가 같은 배치를 동시에 차감할 수도 있다. 그래서 ORM의 첫 번째 기준은 트랜잭션이다. 두 번째 기준은 개인 npm 정책(`ignore-scripts=true`)과 충돌하지 않는 것이고, 세 번째는 에이전트 코딩에서 정확한 코드가 나올 만큼 자료가 많은 것이다.

## 결정

Prisma ORM 7을 쓴다. 버전은 `7.10.0`으로 고정한다. 도메인 코어는 Prisma 타입을 모르고, 저장소 인터페이스 뒤에서만 Prisma를 쓴다.

동시 차감은 쓰기 트랜잭션 첫 문장에서 가정(household) 행을 `SELECT ... FOR UPDATE`로 잠가 처리한다. 격리 수준은 Read Committed를 쓴다.

멱등키는 `idempotency_record` 테이블에 작업 이름, 요청 본문 해시, 직렬화한 응답을 효과와 같은 트랜잭션에서 기록해 보장한다.

## 근거

Prisma 7은 Rust 엔진 없는 클라이언트가 기본이고([Prisma ORM v7.0.0 changelog](https://www.prisma.io/changelog/2025-11-19)), 클라이언트 생성이 설치 과정에 끼어들지 않는다. 업그레이드 가이드의 문장이다.

> migrate dev and db push no longer run prisma generate automatically. You must run prisma generate explicitly.

출처: [Upgrade to Prisma ORM 7](https://www.prisma.io/docs/guides/upgrade-prisma-orm/v7). 설치 스크립트를 막아 둔 환경에서도 `prisma generate`를 명시적으로 실행하면 되므로 정책과 충돌하지 않는다.

트랜잭션은 `$transaction`에 콜백을 넘기는 방식으로 여러 쓰기를 묶고 격리 수준을 지정할 수 있다. 스키마 파일 하나에서 마이그레이션과 타입이 함께 나오고, TypeScript ORM 가운데 문서와 예제가 가장 많다.

### 버전을 7.10.0으로 고정하는 이유

결정일 기준 npm의 `prisma@latest`는 `8.0.0-rc.15`다. `pnpm add -D prisma`를 범위 없이 실행하면 RC가 들어온다. Prisma ORM 8은 2026년 10월 GA 예정이고 스키마와 API가 다시 바뀐다. 재고 원장을 RC 위에 올리지 않는다.

> @prisma/client, the library that Prisma ORM 7 apps import, stays at 7.10.0, because it belongs to Prisma ORM 7. ... Prisma ORM 7 keeps receiving bug fixes and security updates for 18 months from the day Prisma ORM 8 reaches general availability.

출처: [Prisma ORM release status](https://www.prisma.io/docs/orm/release-status). 8 GA 이후에 올릴지는 별도 ADR로 정한다.

7.9.0 미만은 쓰지 않는다. interactive 트랜잭션이 `maxWait`로 만료될 때 `@prisma/adapter-pg`에서 커넥션이 새고 `there is already a transaction in progress`가 나는 버그가 7.9.0에서 고쳐졌다([7.9.0 릴리스 노트](https://github.com/prisma/orm/releases/tag/7.9.0), #29727).

### 동시 차감을 Serializable이 아니라 행 잠금으로 처리하는 이유

잠글 대상이 있다. 일관성 경계가 가정 하나이므로 `household` 행이 집합체 루트가 되고, 모든 쓰기가 그 행을 먼저 잠그면 순서가 결정적으로 정해진다. 직렬화 실패(P2034) 재시도 루프가 필요 없고, 재시도가 몰려 같은 작업을 반복하는 일도 없다.

격리 수준은 Read Committed다. Repeatable Read나 Serializable은 잠금을 얻기 전에 스냅샷이 고정되어, 뒤에 들어온 트랜잭션이 잠금을 얻고도 앞 트랜잭션이 커밋한 재고를 보지 못한다. Read Committed는 문장마다 최신 커밋을 보므로 잠금을 먼저 잡고 읽으면 앞의 결과가 반드시 보인다.

`cooked_batch.remaining_cubes`에 `CHECK (>= 0)`을 걸어 두어, 잠금이 빠지더라도 재고가 음수로 내려가는 대신 트랜잭션이 실패한다.

### 도입 상태는 적재 범위를 쓰지 않고 별도 읽기 모델로 읽는 이유

쓰기 트랜잭션의 적재는 윈도로 자른다. 윈도 밖 식단은 급여가 끝나고 식단시간이 한참 지난 것뿐이라 정합화가 바꿀 것이 없기 때문이다.

알러지 도입 상태는 이 전제가 통하지 않는다. `introductionStatus`는 그 재료가 들어간 급여 완료 식단을 전부 세고, 검증완료를 만드는 두 번째 이상 없음은 몇 달 전 급여일 수 있다. 윈도를 그만큼 넓히면 재고를 차감하는 모든 쓰기가 전체 이력을 읽는다.

그래서 `FeedingHistoryPort`(`src/application/ports/feeding-history.port.ts`)를 따로 두고 `PrismaFeedingHistoryRepository`가 급여 완료 식단 전체를 읽는다. 쓰기 트랜잭션 밖에서만 부르고, 쓰는 곳은 도입 상태 조회와 식단 달력의 경고, 그리고 4단계 브리프다.

재료별로 펼치는 일은 `src/application/feeding-history.ts`의 순수 함수가 도메인의 `effectiveComposition`과 `expandToCubeNeeds`로 처리한다. SQL로 집계하면 "실제 급여 내용이 있으면 그것을 쓴다"는 규칙이 차감 경로와 도입 상태 경로에 두 번 존재하게 되고, 둘이 어긋나면 급여 이력이 조용히 틀어진다.

대가는 이 읽기가 이력과 함께 자란다는 것이다. 하루 한두 끼이므로 3년이면 식단 약 1,100행과 토핑 약 4,000행이고, 조회 경로에만 쓰므로 받아들인다. 커지면 재료별 집계를 투영 테이블로 옮기고 원장처럼 같은 트랜잭션에서 갱신한다.

### 멱등키를 유니크 제약 대신 테이블로 두는 이유

`register_no_feed` 한 번이 미급여 행 1개, 식단 상태 여러 개, 원장 이벤트 여러 개를 쓴다. 단일 행의 유니크 제약으로는 이 묶음을 가리킬 수 없다. LLM 재시도에는 오류가 아니라 처음과 같은 응답을 돌려줘야 하므로 응답도 함께 보관한다. 같은 키에 다른 본문이 오면 재시도가 아니라 실수이므로 거부한다.

## 검토한 대안

| 후보 | 택하지 않은 이유 |
|---|---|
| Drizzle | 결정일 기준 안정판은 0.45.x이고 1.0은 베타 단계다([Drizzle latest releases](https://orm.drizzle.team/docs/latest-releases)). 1.0에서 관계 API가 바뀌므로 지금 쓴 코드가 곧 마이그레이션 대상이 된다. SQL에 가까워 원장 집계와 `FOR UPDATE`에는 더 잘 맞는다는 점은 인정한다 |
| TypeORM | 트랜잭션 범위와 마이그레이션 생성에서 알려진 함정이 많고, ESM 프로젝트와의 마찰이 있다 |
| MikroORM | 설계는 탄탄하지만 자료가 적어 에이전트 코딩의 정확도가 떨어진다 |

## 대가

- Prisma의 쿼리 API에는 `SELECT ... FOR UPDATE`가 없어 `$queryRaw`로 직접 건다. 잠금 획득이 트랜잭션보다 먼저 끊기도록 `SET LOCAL lock_timeout`을 트랜잭션 타임아웃보다 짧게 둔다.
- 스키마 언어에 CHECK 제약이 없다. 공식 절차대로 초안 마이그레이션을 만든 뒤 SQL을 손으로 고친다. 문서는 "Create a draft migration using: `npx prisma migrate dev --create-only`", "Modify the generated SQL file.", "Apply the modified SQL by running: `npx prisma migrate dev`"로 적는다([Customizing migrations](https://www.prisma.io/docs/orm/v7/prisma-migrate/workflows/customizing-migrations)). 이 저장소는 이렇게 CHECK 17개를 덧붙였다. 덧붙인 SQL이 마이그레이션 파일 안에 있으면 `migrate dev`가 shadow DB에 재생하므로 drift로 잡히지 않는다(`pnpm db:migrate`를 두 번 돌려 "Already in sync"를 확인했다).
- 부분 인덱스는 `partialIndexes` preview 기능으로 쓸 수 있다. "The `where` argument is available on the `@unique`, `@@unique` and `@@index` attributes. It requires the `partialIndexes` Preview feature."([Indexes](https://www.prisma.io/docs/orm/v7/prisma-schema/data-model/indexes)) 재고 원장의 스키마에 preview 기능을 끌어들이지 않기로 하고, 잔여가 있는 배치를 찾는 인덱스도 마이그레이션 SQL에 직접 적었다.
- 드라이버 어댑터 경로에서는 유니크 위반의 필드가 문서대로 `meta.target`에 오지 않고 `meta.driverAdapterError.cause.constraint.fields`에 오는 사례가 보고돼 있다([#28953](https://github.com/prisma/orm/issues/28953), 7.2.0에서 재현, #28281의 중복으로 close). 지금은 유니크 위반을 잡아 분기하는 코드가 없고, 멱등키는 먼저 조회해 판단하며 미급여 중복은 예외를 그대로 올린다. 어느 필드가 걸렸는지 알아야 하는 코드를 쓰게 되면 `P2002`로 분기하고 필드는 두 경로에서 모두 읽는다.
- 커넥션 풀 기본값이 pg 드라이버의 것으로 바뀌었다. `connectionTimeoutMillis`가 0(무제한), `idleTimeoutMillis`가 10초라 명시적으로 지정해야 한다.
- 트랜잭션 안에서는 커넥션이 하나라 쿼리를 `Promise.all`로 묶을 수 없다. 저장소의 적재는 순차 실행한다.
- v7은 설정 방식이 v6와 다르다. 접속 URL이 `prisma7.config.ts`로 옮겨 갔고, `.env` 자동 로딩이 없으며, `migrate`가 `generate`를 더 이상 자동 실행하지 않는다. 생성기는 `prisma-client`에 `output`이 필수이고, ESM 프로젝트는 `moduleFormat = "esm"`과 `importFileExtension = "js"`를 쓴다. 에이전트가 v6 이전 방식으로 코드를 내면 동작하지 않는다.
- 저장소 인터페이스를 한 겹 두는 비용이 든다. 대신 도메인 테스트가 DB 없이 돌고, ORM을 바꿀 때 도메인 코어는 건드리지 않는다.
