# Phase 3: persistence

## 사전 준비

먼저 아래를 읽어라.

- `AGENTS.md`
- `tasks/2-pantry-and-expiry/docs-diff.md`
- `docs/adr/0009-pantry-ingredients-and-expiry-notice.md`의 (c)와 층별 결합 절
- `docs/adr/0008-slack-canvas-board.md`의 "상태가 바뀐 뒤 1분 안에 갱신" 절 (모든 변경 메서드가 `dirty` 플래그를 올리는 이유)
- `src/infrastructure/prisma/household-writer.ts` 전체. 특히 `PrismaWriteContext`의 `insertIngredient`, `addIngredientAlias`, `updateServingWeight` (이 phase가 더할 메서드의 본보기)
- `src/application/ports/household-write.port.ts`의 `CatalogWrites` (phase 4가 포트에 더할 메서드. **이 phase는 포트를 건드리지 않는다**)
- `src/infrastructure/prisma/mappers/state.mapper.ts` (phase 2가 `stockTracking`을 이미 매핑했다. 확인만 하라)

## 작업 내용

`PrismaWriteContext`에 메서드 하나를 더한다. `PrismaWriteContext implements HouseholdWriteContext`이므로 포트에 아직 없는 메서드를 구현 클래스에 먼저 더해도 컴파일된다. 포트와 서비스는 phase 4가 더한다.

```ts
  /** Switches how the ingredient's stock is counted. The service checks that no cubes remain. */
  async updateStockTracking(ingredientId: string, stockTracking: Ingredient['stockTracking']): Promise<void> {
    this.dirty = true;
    await this.tx.ingredient.update({ where: { id: ingredientId }, data: { stockTracking } });
  }
```

`updateServingWeight` 바로 뒤에 둔다. `dirty = true`는 상태판 갱신 판정(`state_changed_at`)을 위해서다. 상비 전환은 재고 표를 바꾼다.

이 phase에서는 통합 테스트를 새로 쓰지 않는다. 메서드를 부르는 유스케이스가 phase 4에 생기고, 그 통합 테스트가 이 메서드를 거친다. 대신 `pnpm test:int`를 돌려 phase 2의 파급(매퍼, 픽스처)이 실제 DB에서 도는지 확인한다.

## Acceptance Criteria

```bash
pnpm typecheck
pnpm lint
pnpm test
pnpm test:int
grep -q "updateStockTracking" src/infrastructure/prisma/household-writer.ts
grep -A 3 "async updateStockTracking" src/infrastructure/prisma/household-writer.ts | grep -q "this.dirty = true"
git diff --quiet "$HARNESS_BASELINE" -- src/domain src/application src/mcp src/slack src/scheduler prisma docs README.md test
```

## AC 검증 방법

위 명령을 순서대로 실행하라. 모두 exit 0이면 status를 `completed`로 보고하라. `pnpm test:int`는 Docker가 필요하다. 세 번 고쳐도 실패하면 status를 `error`로 보고하고 `error_message`에 실제 출력을 근거로 적어라.

## 하지 말아야 할 것

- `src/application/ports/household-write.port.ts`를 고치지 마라. 이유: 포트는 phase 4의 일이고 scope 밖이다.
- 잔여 큐브 검사를 여기서 하지 마라. 이유: 규칙은 애플리케이션 서비스(`IngredientService.updateStockTracking`)에 두고 저장소는 쓰기만 한다(ADR 0002의 저장소 경계).
- `dirty = true`를 빠뜨리지 마라. 이유: 상태판이 갱신되지 않는다(ADR 0008).
- scope 밖 파일을 수정하지 마라. 러너가 phase를 실패로 처리한다.
