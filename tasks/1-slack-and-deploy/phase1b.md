# Phase 1b: migration-drift

## 사전 준비

**전제**: 아래가 빈 결과여야 한다.

```bash
git status --porcelain -- src/ test/ prisma/ docs/ package.json
```

출력이 있으면 이전 작업의 잔여 변경이 남아 있다는 뜻이다. 진행하지 말고 `tasks/1-slack-and-deploy/index.json`에서 phase `1b`의 status를 `"error"`로, `error_message`에 `dirty working tree`로 적고 멈춰라.

**이 phase는 5단계 기능과 무관하다.** 앞선 phase가 발견한 기존 결함 하나를 고친다. 먼저 아래를 읽어라.

- `prisma/migrations/20260922023722_member_token/migration.sql` **45행부터 48행.** 손으로 덧붙인 UNIQUE와 복합 FK가 거기 있다. 그 위의 주석이 왜 필요한지 설명한다
- `prisma/schema.prisma`의 `Member`와 `MemberToken` 모델. **그 둘이 선언되어 있지 않은 것을 직접 확인하라**
- `docs/adr/0002-orm-prisma.md`의 "대가" 절. 특히 "CHECK 제약이 없다"로 시작하는 항목의 마지막 문장
- `docs/adr/0004-mcp-server-and-auth.md`의 "결정 > 인증" 절과 "대가와 남는 위험"
- `test/integration/schema-constraints.int-spec.ts` (**이 파일에 테스트를 더한다.** 기존 describe 구성과 단정 방식을 따른다)
- `src/scripts/mint-member-token.ts`의 `issue` 함수와 `list` 함수 (생성 클라이언트의 관계 입력 타입이 바뀌면 영향받는 곳이다)
- `package.json`의 `scripts`

## 문제

`prisma/schema.prisma`가 DB에 실제로 있는 제약 둘을 모른다.

```sql
ALTER TABLE "member" ADD CONSTRAINT "member_id_household_id_key" UNIQUE ("id", "household_id");
ALTER TABLE "member_token" ADD CONSTRAINT "member_token_member_household_fkey"
    FOREIGN KEY ("member_id", "household_id") REFERENCES "member"("id", "household_id") ON DELETE CASCADE ON UPDATE CASCADE;
```

`Member`에는 `@@index([householdId])`만 있고 복합 유니크가 없다. `MemberToken.member`는 `@relation(fields: [memberId], references: [id])`로 단일 컬럼이다.

그래서 Prisma는 그 둘을 "스키마에 없는데 DB에 있는 것"으로 보고 지우려 한다. 마이그레이션을 전부 적용한 DB에 대고 돌린 결과다.

```
$ prisma migrate diff --from-config-datasource --to-schema prisma/schema.prisma --script
-- DropForeignKey
ALTER TABLE "member_token" DROP CONSTRAINT "member_token_member_household_fkey";
-- DropIndex
DROP INDEX "member_id_household_id_key";
```

이 때문에 `pnpm db:migrate`가 새 마이그레이션 이름을 물으며 멈춘다. 더 나쁜 것은 그 제안을 받아들이는 경우다. 그 복합 FK는 "토큰이 가리키는 구성원은 토큰이 가리키는 가정의 구성원이어야 한다"를 강제한다. 사라지면 한 가정의 토큰으로 다른 가정을 쓸 수 있고 원장의 수행자가 남의 가정 사람이 된다. 마이그레이션 SQL의 주석이 그것을 적어 두었다.

지금 고치는 이유는 `docs/user-intervention.md`의 1번, 3번, 5번이 아직 미완이기 때문이다. 원격 push도, Railway DB도, 실제 이관도 없다. 지금은 빈 DB 연산이고, 이관이 끝난 뒤에는 운영 작업이 된다.

## 작업 내용

### 1. `prisma/schema.prisma`

`Member`에 복합 유니크를 선언한다. `map`으로 기존 제약 이름을 그대로 쓴다. 이름이 다르면 Prisma가 지우고 다시 만든다.

```prisma
  @@unique([id, householdId], map: "member_id_household_id_key")
```

`MemberToken.member`를 복합 관계로 바꾼다.

```prisma
  member Member @relation(fields: [memberId, householdId], references: [id, householdId], onDelete: Cascade, map: "member_token_member_household_fkey")
```

`household` 관계는 그대로 둔다. `householdId`가 두 관계에 함께 쓰이는 것을 Prisma 7이 받아들인다(`prisma validate`로 확인했다).

왜 이것들이 스키마에 있어야 하는지 주석으로 적어라. 파일 머리말이 "Prisma 스키마 언어에 없는 것은 마이그레이션 SQL에 손으로 덧붙인다"로 CHECK와 부분 인덱스를 들고 있다. **UNIQUE와 FK는 그 목록에 속하지 않는다.** Prisma가 모델로 표현할 수 있으므로 스키마에 선언해야 하고, 선언하지 않으면 drift가 된다.

### 2. 새 마이그레이션

위 선언만 하면 drift가 하나 남는다.

```
-- DropForeignKey
ALTER TABLE "member_token" DROP CONSTRAINT "member_token_member_id_fkey";
```

단일 컬럼 FK다. 복합 FK가 그것을 함의한다. `(member_id, household_id)`가 `member`에 있으면 `member_id`도 반드시 있다. 그래서 지우는 것이 옳고 무결성 손실이 없다.

`pnpm db:migrate --create-only --name declare_member_token_composite_key`로 초안을 만들고 내용을 확인한다. 위 DROP 한 줄이어야 한다. 그 아래에 구분선 주석과 함께 아래를 적어라.

- 이 DROP이 왜 안전한지. 복합 FK가 단일 컬럼 FK를 함의한다는 것
- 되돌리는 한 줄. `ALTER TABLE "member_token" ADD CONSTRAINT "member_token_member_id_fkey" FOREIGN KEY ("member_id") REFERENCES "member"("id") ON DELETE CASCADE ON UPDATE CASCADE;`
- `member_token_member_id_idx` 인덱스는 그대로 남는다는 것. FK가 사라져도 `member_id`로 찾는 조회 경로는 유지된다

그다음 `pnpm db:migrate`로 적용한다. 이번에는 프롬프트 없이 끝나야 한다.

**기존 마이그레이션 파일을 고치지 마라.** 이미 적용된 것을 고치면 체크섬이 어긋난다.

### 3. `package.json`에 drift 검사 스크립트

```json
"db:drift": "prisma migrate diff --from-config-datasource --to-schema prisma/schema.prisma --script --exit-code"
```

`--exit-code`는 비어 있으면 0, 차이가 있으면 2를 돌려준다. `migrate dev`와 달리 읽기만 하고 프롬프트를 띄우지 않아 무인 실행의 AC로 쓸 수 있다. 앞으로 마이그레이션을 만드는 모든 phase가 이것을 쓴다.

`--from-config-datasource`는 **살아 있는 DB**를 읽는다. 그래서 AC는 언제나 `pnpm db:deploy`로 먼저 로컬 DB를 최신으로 만든 뒤에 돈다.

### 4. 생성 클라이언트 재생성과 영향 확인

```bash
pnpm prisma:generate
pnpm typecheck
```

관계가 복합이 되면 `MemberToken`의 관계 입력 타입이 바뀐다. `src/scripts/mint-member-token.ts`의 `prisma.memberToken.create`와 `list`의 `member: { select: ... }`가 영향권이다. 타입이 깨지면 고쳐라. **동작을 바꾸지 마라.** 같은 일을 하는 다른 표기로만 고친다.

### 5. 통합 테스트

`test/integration/schema-constraints.int-spec.ts`에 describe 하나를 더한다. drift 검사는 스키마와 DB가 어긋났는지만 보고 제약이 살아 있는지는 보지 않는다. 이 테스트가 그것을 본다. 이번 결함을 3단계에서 잡았을 검사다.

- `pg_constraint`에 `member_token_member_household_fkey`가 있다.
- `pg_constraint`에 `member_id_household_id_key`가 있다.
- 다른 가정의 구성원 id로 토큰을 만들면 거부된다. **제약이 이름만 있는 것이 아니라 실제로 막는다는 것을 확인하는 테스트다.** 가정 둘과 각각의 구성원을 만들고, 첫 가정의 id에 둘째 가정 구성원의 id를 붙여 `member_token`에 넣으려 하면 FK 위반이 나야 한다.

`pg_constraint` 조회는 `prisma.$queryRaw`로 한다.

### 6. `docs/adr/0002-orm-prisma.md`

"대가" 절의 CHECK 항목 마지막 문장이 지금 이렇다.

> 이 저장소는 이렇게 CHECK 17개를 덧붙였다. 덧붙인 SQL이 마이그레이션 파일 안에 있으면 `migrate dev`가 shadow DB에 재생하므로 drift로 잡히지 않는다(`pnpm db:migrate`를 두 번 돌려 "Already in sync"를 확인했다).

**이 문장은 지금 거짓이다.** 고치면서 아래를 함께 적어라.

- 언제 참이었고 무엇이 깨뜨렸는지. 2단계에는 맞았고, 3단계의 `member_token` 마이그레이션이 손으로 덧붙인 UNIQUE와 FK가 깨뜨렸다.
- 구분. CHECK와 부분 인덱스는 Prisma가 모델로 표현할 수 없어 drift로 잡히지 않는다. UNIQUE와 FK는 표현할 수 있으므로 잡힌다. 후자는 마이그레이션에만 쓰지 말고 스키마에도 선언해야 한다.
- 그 구분을 앞으로 강제하는 수단. `pnpm db:drift`가 스키마와 DB의 어긋남을 잡고, `test/integration/schema-constraints.int-spec.ts`가 제약이 실제로 사는지 본다.

**결정 자체를 바꾸지 마라.** Prisma 7을 쓴다는 것도, CHECK를 손으로 덧붙인다는 절차도 그대로다. 바꾸는 것은 사실 진술 하나다.

## Acceptance Criteria

아래를 순서대로 실행해 모두 exit 0이어야 한다.

```bash
# 1) 스키마가 두 제약을 선언한다
grep -q 'member_id_household_id_key' prisma/schema.prisma
grep -q 'member_token_member_household_fkey' prisma/schema.prisma

# 2) 새 마이그레이션이 생겼고 되돌리는 방법이 적혀 있다
ls prisma/migrations | grep -q declare_member_token_composite_key
grep -q 'member_token_member_id_fkey' prisma/migrations/*declare_member_token_composite_key*/migration.sql
grep -q 'ADD CONSTRAINT' prisma/migrations/*declare_member_token_composite_key*/migration.sql

# 3) 기존 마이그레이션은 손대지 않았다
git diff --quiet HEAD -- prisma/migrations/20260921134349_init/ prisma/migrations/20260922023722_member_token/ prisma/migrations/20260922163337_slack_delivery/

# 4) drift 검사 스크립트가 생겼다
python3 -c "
import json
s = json.load(open('package.json'))['scripts']
assert 'db:drift' in s, s
assert '--exit-code' in s['db:drift'], s['db:drift']
assert 'migrate dev' not in s['db:drift'], s['db:drift']
"

# 5) 생성 클라이언트를 다시 만들고 타입이 맞는다
pnpm prisma:generate
pnpm typecheck

# 6) 로컬 DB를 최신으로 만든 뒤 drift가 없다
docker compose up -d
pnpm db:deploy
pnpm db:drift

# 7) 제약이 실제로 살아 있다
grep -q 'pg_constraint' test/integration/schema-constraints.int-spec.ts
pnpm test:int

# 8) ADR 0002의 거짓 문장이 사라졌다
! grep -q '두 번 돌려 "Already in sync"를 확인했다' docs/adr/0002-orm-prisma.md
grep -q 'db:drift' docs/adr/0002-orm-prisma.md

# 9) 5단계 코드는 한 줄도 건드리지 않았다
git diff --quiet HEAD -- src/application/ src/slack/ src/scheduler/ src/mcp/ src/infrastructure/prisma/brief-delivery-log.repository.ts

# 10) 도메인 불변
git diff --quiet HEAD -- src/domain/

# 11) 나머지가 깨지지 않았다
pnpm lint
pnpm test
pnpm test:cov
```

6번이 이 phase의 핵심 AC다. `pnpm db:drift`가 exit 0이면 스키마와 DB가 일치한다는 뜻이다.

## AC 검증 방법

위 명령을 순서대로 실행하라. 모두 통과하면 `tasks/1-slack-and-deploy/index.json`에서 phase `1b`의 status를 `"completed"`로 바꿔라.

세 번 고쳐도 통과하지 못하면 status를 `"error"`로 바꾸고, `"error_message"`에 어떤 명령이 어떤 출력으로 실패했는지 실제 출력을 근거로 적어라.

AC 통과와 index.json 갱신을 마쳤으면 커밋하라. 메시지는 `fix(prisma): declare the member token composite key in the schema`로 한다.

## 하지 말아야 할 것

- **Prisma가 제안하는 DROP 둘을 받아들이지 마라.** 그것이 이 phase가 막으려는 일이다. 복합 FK와 복합 UNIQUE는 남아야 한다.
- **기존 마이그레이션 파일을 고치지 마라.** 체크섬이 어긋난다. 새 파일만 더한다.
- **제약 이름을 바꾸지 마라.** `map`으로 기존 이름을 그대로 쓴다. 이름이 다르면 Prisma가 지우고 다시 만드는 마이그레이션을 낸다.
- **`pnpm db:migrate`를 AC에 넣지 마라.** 프롬프트를 띄워 무인 세션이 매달린다. `pnpm db:drift`가 그 자리를 대신한다.
- **5단계 기능 코드를 건드리지 마라.** `src/application`, `src/slack`, `src/scheduler`, `src/mcp`, 그리고 phase 2가 만든 발송 기록 저장소 전부 이번 범위 밖이다.
- **`src/scripts/mint-member-token.ts`의 동작을 바꾸지 마라.** 타입이 깨졌을 때만, 같은 일을 하는 표기로 고친다.
- **ADR 0002의 결정을 바꾸지 마라.** 사실 진술 하나만 고친다.
- **`src/domain`을 고치지 마라.**
- **`tasks/` 안의 다른 파일을 고치지 마라.** `tasks/1-slack-and-deploy/index.json`의 phase `1b` status만 갱신한다.
