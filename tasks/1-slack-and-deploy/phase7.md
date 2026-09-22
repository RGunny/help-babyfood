# Phase 7: break-it (재실행)

## 이 phase는 재실행이다

앞선 실행에서 대부분이 끝났고 **한 가지만 남았다.** 이미 커밋된 것은 건드리지 마라.

- `tasks/1-slack-and-deploy/break-it.md`에 고장 1번과 2번의 실험 기록이 있다. 둘 다 지목한 테스트가 제대로 잡았다.
- `docs/product-plan.md` 9장의 5단계 상태가 `끝`으로 바뀌어 있다.
- `README.md`가 갱신되어 있다.

남은 것은 고장 3번이다. 앞선 실행이 **그것을 지목한 통합 테스트가 잡지 못한다는 것을 밝혀냈다.** 그때는 phase 파일의 AC가 `test/`의 최종 변경을 금지하고 있어서 잡는 테스트를 만들어 확인한 뒤 되돌렸다. 그 금지는 이 phase 파일의 잘못이었다. 이번에는 그 테스트를 저장소에 남긴다.

## 사전 준비

**전제**: 아래가 빈 결과여야 한다.

```bash
git status --porcelain -- src/ test/ prisma/ docs/
```

출력이 있으면 진행하지 말고 `tasks/1-slack-and-deploy/index.json`의 phase 7 status를 `"error"`로, `error_message`에 `dirty working tree`로 적고 멈춰라.

먼저 아래를 읽어라.

- `tasks/1-slack-and-deploy/break-it.md` **전체.** 특히 3번 절. 앞선 실행이 무엇을 확인했고 어떤 테스트를 만들었는지가 거기 있다
- `src/slack/actions.ts`의 `actionId`와 `ORDINAL_SEPARATOR`
- `src/slack/outbound/render-reaction-prompt.ts` (재료마다 버튼 둘을 어떤 `action_id`로 다는지)
- `src/slack/outbound/render-brief.ts`의 끼니 버튼과 폐기 버튼
- `src/slack/inbound/action-dispatch.ts`의 `idempotencyKeyOf`
- `test/integration/slack-interactions.int-spec.ts` 전체

## 이미 밝혀진 사실

`action_id`는 `{kind}.{ordinal}` 모양이다. 셋의 `ordinal`이 다르게 붙는다.

| 버튼 | `ordinal`이 무엇으로 정해지는가 | 한 메시지 안에서 겹치는가 |
|---|---|---|
| 폐기 완료 | 폐기 대기 배치의 index | 겹치지 않는다 |
| 반응 기록 | 이상 없음은 0, 반응 있음은 1. **재료마다 같은 쌍이 반복된다** | 재료가 둘 이상이면 겹친다 |
| 미급여 | 해동 전은 0, 해동 후는 1. **끼니마다 같은 쌍이 반복된다** | 끼니가 둘이면 겹친다 |

그래서 멱등키에서 `value`를 빼면 반응 버튼과 미급여 버튼에서 충돌이 난다. 두 번째 재료의 "이상 없음"이 `IDEMPOTENCY_KEY_REUSED`로 거부된다.

지금 지목된 통합 테스트는 폐기 버튼 둘을 쓴다. 폐기는 `ordinal`이 배치마다 달라 `value` 없이도 키가 갈린다. 그래서 그 테스트는 이 고장을 잡지 못한다. **`value`가 실제로 막고 있는 것은 반응과 미급여이고, 그것을 보는 통합 테스트가 없다.**

지금 코드(`value`가 키에 있는 상태)에는 버그가 없다. 없는 것은 그 보호를 지키는 테스트다.

## 작업 내용

### 1. 겹치는 두 경우를 덮는 통합 테스트를 더한다

`test/integration/slack-interactions.int-spec.ts`에 더한다. **새 파일을 만들지 마라.**

- **반응 버튼**: 한 후속 메시지에 재료가 둘 이상 실린 상태에서, 재료 A의 "이상 없음"과 재료 B의 "이상 없음"을 같은 메시지에서 차례로 누른다. **둘 다 기록되어야 한다.** 두 탭의 `action_id`가 `reaction.0`으로 같고 `value`만 다르다는 것이 이 테스트의 핵심이다.
- **미급여 버튼**: 오전과 오후 끼니가 모두 열린 가정에서, 한 브리프의 오전 "미급여(해동 전)"과 오후 "미급여(해동 전)"을 누른다. **둘 다 기록되어야 한다.** 두 탭의 `action_id`가 `no_feed.0`으로 같다.

오후 끼니는 `MealSlotService.start`로 연다. `test/integration/setup/fixtures.ts`의 `seedHousehold`가 오전만 열므로 테스트 안에서 오후를 더 연다. 기존 픽스처의 동작을 바꾸지 마라.

오후 끼니 준비가 불가능하다고 판단되면 **조용히 빼지 말고** 반응 버튼 테스트만 남긴 뒤 무엇이 막았는지를 `break-it.md`에 적어라.

기존 테스트를 고치거나 지우지 마라. 더하기만 한다.

### 2. 새 테스트가 고장 3번을 실제로 잡는지 확인한다

1. `src/slack/inbound/action-dispatch.ts`의 `idempotencyKeyOf`에서 `value`를 뺀다.

```diff
-  return `slack:${tap.messageTs}:${tap.actionId}:${tap.value}`;
+  return `slack:${tap.messageTs}:${tap.actionId}`;
```

2. `test/integration/slack-interactions.int-spec.ts`를 돌린다.
3. **새 테스트가 실패하는 것을 확인한다.** 실패 메시지를 그대로 받아 적는다. 실패하지 않으면 그 테스트는 이 규칙을 보고 있지 않다는 뜻이므로 고쳐서 잡히게 만든 뒤 다시 확인한다.
4. `git checkout -- src/slack/inbound/action-dispatch.ts`로 되돌린다.
5. 다시 돌려 통과하는 것을 확인한다.

### 3. `break-it.md`의 3번 절을 갱신한다

지금 그 절은 "잡는 테스트를 만들어 확인했지만 저장소에 남기지 않았다"로 끝난다. 결론이 바뀌었으므로 고쳐라.

- 지목했던 통합 테스트가 왜 이 고장을 잡지 못했는지(폐기 버튼의 `ordinal`이 배치마다 다르다)
- `value`가 실제로 막는 것이 무엇인지(반응과 미급여의 `action_id` 충돌)
- 이번에 더한 테스트가 무엇이고 고장을 넣었을 때 어떤 메시지로 실패했는지. **실제 출력을 근거로 적어라**
- 되돌린 뒤 통과한 것

"저장소에 남기지 않은 이유" 절은 더 이상 맞지 않으므로 지운다.

1번과 2번 절은 건드리지 마라.

## Acceptance Criteria

```bash
# 1) 고장을 되돌렸다. src와 prisma는 최종적으로 바뀌지 않는다
git diff --quiet HEAD -- src/
git diff --quiet HEAD -- prisma/

# 2) 테스트는 딱 한 파일만 늘었다
test "$(git status --porcelain -- test/ | wc -l | tr -d ' ')" = "1"
git status --porcelain -- test/ | grep -q 'slack-interactions.int-spec.ts'

# 3) 겹치는 action_id를 보는 테스트가 들어갔다
grep -q 'reaction.0' test/integration/slack-interactions.int-spec.ts

# 4) 실험 기록이 갱신됐다
grep -q 'reaction.0' tasks/1-slack-and-deploy/break-it.md
! grep -q '이 테스트를 저장소에 남기지 않은 이유' tasks/1-slack-and-deploy/break-it.md

# 5) 앞선 실행의 문서 작업은 그대로다
git diff --quiet HEAD -- README.md docs/
python3 -c "
row = [l for l in open('docs/product-plan.md') if l.startswith('| 5. Slack과 배포')]
assert len(row) == 1, row
cells = [c.strip() for c in row[0].strip().strip('|').split('|')]
assert cells[-1] == '끝', cells
"

# 6) 사람이 할 일 목록은 그대로다
test "$(grep -c '^- \[ \]' docs/user-intervention.md)" -ge 5

# 7) 도메인 불변
git diff --quiet HEAD -- src/domain/

# 8) 전부 통과한다
pnpm typecheck
pnpm lint
pnpm test
pnpm test:int
pnpm test:cov
```

1번과 2번이 이 phase의 핵심 AC다. 고장은 남지 않아야 하고, 테스트는 늘어야 한다.

## AC 검증 방법

위 명령을 순서대로 실행하라. 모두 통과하면 `tasks/1-slack-and-deploy/index.json`의 phase 7 status를 `"completed"`로 바꿔라.

세 번 고쳐도 통과하지 못하면 status를 `"error"`로 바꾸고, `"error_message"`에 어떤 명령이 어떤 출력으로 실패했는지 실제 출력을 근거로 적어라.

AC 통과와 index.json 갱신을 마쳤으면 커밋하라. 메시지는 `test(slack): cover the colliding action ids the idempotency key guards`로 한다.

## 하지 말아야 할 것

- **고장을 남겨 두지 마라.** `git diff`로 확인한다.
- **`src/`를 최종적으로 바꾸지 마라.** 지금 코드에 버그가 없다. 없는 것은 테스트다.
- **`action_id`의 `ordinal` 부여 방식을 바꾸지 마라.** 반응과 미급여에 재료·끼니별 순번을 붙이고 싶어지겠지만 이번 범위가 아니다. 멱등키의 `value`가 이미 그 역할을 하고, 그것을 지키는 것이 이 phase의 일이다.
- **새 테스트 파일을 만들지 마라.** 기존 `slack-interactions.int-spec.ts`에 더한다.
- **기존 테스트를 고치거나 지우지 마라.**
- **`README.md`와 `docs/`를 고치지 마라.** 앞선 실행이 끝냈다.
- **`break-it.md`의 1번과 2번 절을 고치지 마라.**
- **테스트가 고장을 잡지 못했는데 잡았다고 적지 마라.**
- **`src/domain`을 고치지 마라.**
- **`tasks/` 안의 다른 파일을 고치지 마라.** `index.json`의 phase 7 status와 `break-it.md`의 3번 절만 고친다.
