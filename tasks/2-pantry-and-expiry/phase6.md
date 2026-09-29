# Phase 6: slack

## 사전 준비

먼저 아래를 읽어라.

- `AGENTS.md` (`src/slack`은 어댑터다)
- `tasks/2-pantry-and-expiry/docs-diff.md`
- `docs/adr/0009-pantry-ingredients-and-expiry-notice.md`의 (d), (e), (f) (임계일 열, 강조 기호 `⏰`, "임계 지남")
- `docs/adr/0007-slack-message-templates.md` (템플릿 규약. `version`은 레이아웃이 바뀔 때 사람이 올리고 스냅숏이 그 버전을 이름에 담는다. 표 셀 규칙. 100행과 1만 자 한도)
- `docs/adr/0008-slack-canvas-board.md` (캔버스 마크다운 제약. 셀 색이 없어 기호와 굵게로 표시한다. 표 하나 300셀. 반응있음 기호 `⚠`, 오늘 기호 `▶`)
- `src/slack/templates/brief-lines.ts` (브리프와 상태판이 공유하는 행과 줄. `stockRowsOf`, `byUrgency`, `expiryLine`, `attentionLines`)
- `src/slack/templates/daily-brief.ts` (`STOCK_COLUMNS`, `stockBlocks`, `expiryBlocks`, `discardButtons`, `attentionBlocks`)
- `src/slack/templates/household-board.ts` (`STOCK_HEADER`, `MAX_STOCK_ROWS`, `stockLines`, `stockRow`, `expiryLines`)
- `src/slack/templates/labels.ts` (`stageLabel`, `shortDate`)
- `src/slack/templates/markdown.ts` (`escapeMarkdown`이 `*`를 이스케이프한다. 굵게는 이스케이프한 이름을 `**`로 감싼다. `blockTable`의 오늘 열이 본보기)
- `src/slack/templates/table.ts` (`TableColumn`, 셀 함수)
- `src/slack/templates/daily-brief.spec.ts`, `src/slack/templates/household-board.spec.ts`와 `src/slack/templates/__snapshots__/` (스냅숏은 `toMatchFileSnapshot`으로 파일에 고정된다. 버전이 파일 이름에 있다)
- `src/application/daily-brief.ts`의 `BriefStockRow.nextExpiry`, `DailyBrief.pantryIngredients`, `BriefExpiryAlert`
- `src/scripts/preview-slack.ts` (템플릿 버전을 참조하는지 확인만 하라)

## 작업 내용

두 템플릿의 버전을 3으로 올리고 양식을 바꾼다. 애플리케이션과 도메인은 건드리지 않는다.

### 1. 공유 행 (`brief-lines.ts`)

- `IngredientRow`는 그대로 `BriefStockRow`를 확장한다. `nextExpiry`가 따라온다.
- `byUrgency`의 마지막 기준(`overdue > 0`)을 `nextExpiry`가 `fresh`가 아닌 재료가 앞에 오도록 바꾼다. 소진 예상일, 임계개수, 임계 임박·지남, 나머지 순이다.
- 강조 여부 헬퍼 하나를 둔다: `export function isExpiryHighlighted(row: IngredientRow): boolean { return row.nextExpiry !== null && row.nextExpiry.stage.kind !== 'fresh'; }`. 템플릿은 이것만 읽는다. 날짜 차를 계산하지 않는다.
- 상비 한 줄 헬퍼: `pantryLine(brief, escape)`가 `상비: 땅콩버터, 계란, 밀가루`를 돌려주고, 상비 재료가 없으면 null.
- `expiryLine`은 지운다. 임계일 목록이 없어진다.

### 2. 브리프 (`daily-brief.ts`, `daily_brief` v3)

- `STOCK_COLUMNS`: `재료 | 합계 | 가용 | 임계 지남 | 임계일 | 소진 예상 | 임계`. 재료 칸은 강조 행이면 `⏰ 이름`, 아니면 이름. 임계일 칸은 `nextExpiry === null ? null : shortDate(nextExpiry.date)`.
- `stockBlocks`의 표 아래 줄에 상비 한 줄을 더한다(`재고 0` 줄과 같은 context 블록).
- `expiryBlocks`를 지운다. `discardButtons`는 남기되 `stockBlocks` 바로 뒤에 온다. 버튼 라벨 `폐기 완료: 브로콜리 2026-09-04`는 그대로.
- `version: 3`.

### 3. 상태판 (`household-board.ts`, `household_board` v3)

- `STOCK_HEADER`: `['재료', '합계', '가용', '임계 지남', '임계일', '소진 예상', '임계']`. `MAX_STOCK_ROWS`는 헤더 길이로 계산되므로 저절로 준다.
- `stockRow`의 재료 칸: 강조 행이면 `` `**⏰ ${escapeMarkdown(row.name)}**` ``, 아니면 `escapeMarkdown(row.name)`.
- 표 아래에 상비 한 줄을 `_상비: 땅콩버터, 계란, 밀가루_`로 더한다(`재고 0` 줄과 같은 모양).
- `expiryLines`와 `## 임계일` 구역을 지운다. 구역 순서는 제목, 식단, 재고, 확인 필요다.
- `version: 3`.

### 4. 라벨 (`labels.ts`)

`stageLabel`을 새 뜻에 맞춘다. `fresh` → `'여유'`, `due_soon` → `daysLeft === 0 ? '오늘 임계일' : ` `임계일 ${daysLeft}일 전` ``, `overdue` → `` `임계일 ${overdueDays}일 지남` ``. "폐기 대기", "기한"이라는 말을 없앤다. 이 함수를 부르는 곳이 없어지면 함수도 지운다.

### 5. 스냅숏과 테스트

- `__snapshots__/daily-brief.v2.json`과 `household-board.v2.md`를 지우고 v3 파일을 만든다. 스냅숏 테스트의 파일 경로와 `describe` 이름의 버전을 3으로 바꾼 뒤 `pnpm vitest run --project unit src/slack/templates -u`로 v3 파일을 쓴다. 쓴 뒤 두 파일을 열어 임계일 열, `⏰`, 상비 한 줄이 있고 임계일 목록이 없는지 눈으로 확인하라.
- 스냅숏 픽스처(`daily-brief.spec.ts`의 v2 페이로드 테스트, `household-board.spec.ts`의 `board()`)에 상비 재료 하나와 `nextExpiry`가 임박인 행 하나를 더해 새 요소가 스냅숏에 보이게 한다.
- 테스트를 더한다(이름은 규칙을 한국어로 서술한다):
  - `daily-brief.spec.ts`: 임계일이 3일 안이거나 지난 재료는 재료 칸에 ⏰가 붙는다 / 임계일 칸은 가장 이른 배치의 임계일이고 배치가 없으면 –다 / 상비 재료는 표 아래 한 줄에 이름만 적힌다 / 임계일 목록은 없고 폐기 버튼은 재고 표 바로 뒤에 온다
  - `household-board.spec.ts`: 임계일이 임박하거나 지난 행은 재료명이 굵고 ⏰가 붙는다 / 상비 재료는 표 아래 한 줄이다 / 임계일 구역이 없다
- 기존 테스트 이름의 "폐기 대기"는 "임계 지남"으로, "임계일 알람"은 맞는 말로 고친다.

### 6. `preview-slack.ts`

템플릿 버전을 하드코딩하고 있으면 고친다. 그렇지 않으면 건드리지 않는다.

## Acceptance Criteria

```bash
pnpm typecheck
pnpm lint
pnpm test
grep -q "version: 3" src/slack/templates/daily-brief.ts
grep -q "version: 3" src/slack/templates/household-board.ts
test -f src/slack/templates/__snapshots__/daily-brief.v3.json
test -f src/slack/templates/__snapshots__/household-board.v3.md
! test -f src/slack/templates/__snapshots__/daily-brief.v2.json
! test -f src/slack/templates/__snapshots__/household-board.v2.md
grep -q "임계일" src/slack/templates/__snapshots__/household-board.v3.md
grep -q "⏰" src/slack/templates/__snapshots__/household-board.v3.md
grep -q "상비" src/slack/templates/__snapshots__/household-board.v3.md
! grep -q "^## 임계일" src/slack/templates/__snapshots__/household-board.v3.md
grep -q "⏰" src/slack/templates/__snapshots__/daily-brief.v3.json
grep -q "폐기 완료" src/slack/templates/__snapshots__/daily-brief.v3.json
! rg -n '폐기 대기|폐기대기|폐기 필요' src/slack
! rg -n 'EXPIRY_NOTICE_DAYS|daysBetween' src/slack/templates --glob '!*.spec.ts'
! rg -n "summarizeStock|forecastShortage|reconcileMeals|expiryStageOn" src/slack
git diff --quiet HEAD -- src/domain src/application src/infrastructure src/mcp src/scheduler prisma docs README.md test
```

## AC 검증 방법

위 명령을 순서대로 실행하라. 모두 exit 0이면 status를 `completed`로 보고하라. 세 번 고쳐도 실패하면 status를 `error`로 보고하고 `error_message`에 실제 출력을 근거로 적어라.

## 하지 말아야 할 것

- 강조 기호로 `⚠`를 쓰지 마라. 이유: 같은 캔버스의 달력에서 반응있음 재료를 뜻한다(ADR 0008). 한 기호가 두 뜻을 가지면 안 된다. 기호는 `⏰`다.
- 템플릿에서 임계일까지 남은 날을 계산하지 마라. 이유: `nextExpiry.stage`가 도메인이 계산한 값이다. 어댑터는 재고 규칙을 다시 쓰지 않는다.
- 폐기 버튼을 없애지 마라. 이유: 폐기는 부모가 실제로 버렸을 때 기록하는 별개 행위이고 버튼은 메시지에서만 가능하다(ADR 0009 (d)). 캔버스에는 버튼을 넣을 수 없다.
- 버전을 올리지 않은 채 스냅숏을 바꾸지 마라. 이유: ADR 0007. 버전은 3이다.
- v2 스냅숏 파일을 남기지 마라. 이유: 어느 양식으로 보내는지 파일 이름이 말한다. 두 버전이 함께 있으면 어느 쪽이 현재인지 알 수 없다.
- `src/application`이나 `src/domain`을 고치지 마라. 이유: scope 밖이고 이전 phase가 끝냈다.
- scope 밖 파일을 수정하지 마라. 러너가 phase를 실패로 처리한다.
