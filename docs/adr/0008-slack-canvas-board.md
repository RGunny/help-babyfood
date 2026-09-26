# ADR 0008: 식단 달력과 재고는 Slack 채널 캔버스 상태판에 두고, 서버가 상태가 바뀔 때 갱신한다

- 상태: 채택. 2026-09-26에 무료 플랜 워크스페이스에서 `conversations.canvases.create`와 `canvases.edit`(전체 교체, 11열 표)를 실제로 호출해 `ok: true`를 확인했다. 캔버스 `F0C4HPW0JP7`
- 결정일: 2026-09-26

## 맥락

기획안 2장은 2차 범위에 "필요 시 웹 또는 앱 캘린더"를 남겨 두었다. 이관 뒤 부모가 잃은 것은 엑셀 식단표의 한 장짜리 뷰다. 10일씩 가로로 놓인 블록에 일차, 베이스, 토핑이 있고 첫 도입 재료가 칠해져 있어서, "앞으로 열흘 무엇을 먹이는가"가 한눈에 보였다.

브리프는 그 뷰를 대신하지 못한다. 브리프는 시간순 메시지라 어제 것을 보려면 스크롤해야 하고, 재고 표는 07:30 시점에 멈춰 있다. 부모의 요구는 분명했다. 외부 캘린더 앱은 쓰지 않는다. 메시지 흐름과 별개로 Slack 안에 고정된 화면이 있어야 하고, 그 화면은 엑셀 식단표와 같은 달력 모양이어야 하며, 재고도 거기에 있으면 좋다. 유료 플랜 기능은 쓰지 않는다.

정할 것은 여섯이다. 고정된 화면을 Slack의 무엇으로 만들지, 내용과 양식을 어떻게 둘지, 언제 갱신할지, 갱신 기록을 어디에 둘지, 미래 식단의 회차를 누가 계산할지, Slack 어댑터가 무엇을 소유할지다.

## 결정

### 고정된 화면은 채널 캔버스다

가정마다 브리프 채널의 채널 캔버스 하나를 서버가 만들고 갱신한다. 채널 캔버스는 채널 위 탭에 붙어 한 번의 탭으로 열리고, 메시지 흐름에 섞이지 않는다.

캔버스는 마크다운 문서다. Block Kit이 들어가지 않으므로 버튼이 없다.

> Note that currently, Block Kit is not supported in canvases.

출처: https://docs.slack.dev/surfaces/canvases . 그래서 미급여, 반응, 폐기 버튼은 ADR 0006대로 메시지에 남고, 캔버스는 서버가 쓰기만 하는 화면이다. 사람이 캔버스를 고쳐도 서버는 그것을 읽지 않으며 다음 갱신이 덮어쓴다.

무료 플랜 제약은 문서끼리 어긋난다. `canvases.create` 문서는 무료 팀이 채널 캔버스를 만들 수 있고 `channel_id`가 필수라고 적고, `canvases.access.set` 문서는 캔버스가 유료 워크스페이스 전용이라고 적는다. 그래서 문서 대신 실측으로 정했다. 2026-09-26에 운영 컨테이너에서 `conversations.canvases.create`를 채널 `C0C464ME015`로 한 번 호출해 `{"ok":true,"canvas_id":"F0C4HPW0JP7"}`를 받았고, 이어서 `canvases.edit`의 `replace`(구역 id 없음)로 11열 표 하나와 6열 표 하나를 넣어 `{"ok":true}`를 받았다. 독립형 캔버스는 무료 팀이 만들 수 없으므로 쓰지 않는다.

기각한 대안은 셋이다.

| 대안 | 기각 이유 |
|---|---|
| 고정(pin) 메시지 하나를 `chat.update`로 갱신 | 새 스코프도 플랜 제약도 없지만, 메시지 하나의 표 셀 문자 합계가 1만 자로 묶인다(출처: https://docs.slack.dev/reference/block-kit/blocks/table-block ). 10일 블록 넷과 재고 표를 한 메시지에 넣으면 그 한도에 닿고, 고정 메시지는 채널 탭이 아니라 핀 목록 안에 있어 메시지 흐름을 벗어나지 못한다. 캔버스 생성이 플랜에서 거부됐을 때의 차선으로 남긴다 |
| 매일 브리프에 달력 표를 넣기 | 로그성 메시지에 같은 달력이 매일 쌓인다. 부모가 원한 "고정된 화면"이 아니다 |
| 외부 캘린더 구독(ICS)이나 Google Calendar | 부모가 쓰지 않기로 했다. 이미 Slack으로 받는데 앱을 하나 더 열지 않는다 |

### 내용은 상태판이고, 달력은 엑셀 식단표의 양식을 따른다

캔버스 한 장을 상태판이라 부른다. 위에서부터 갱신 시각, 식단 달력, 재고 표, 임계일, 확인 필요다. 재고 표와 임계일, 확인 필요는 브리프의 것과 같은 내용이고 같은 읽기 모델(`DailyBrief`)에서 나온다.

식단 달력은 엑셀 식단표의 양식이다. 10일이 표 하나이고, 표의 열이 날짜, 행이 일차·날짜·베이스·토핑이다.

```
| 일차   | 21일차   | 22일차   | … | 27일차 ▶ | 28일차 | 29일차 | 30일차 |
| 날짜   | 09-20 토 | 09-21 일 | … | 09-26 금 | …      |        |        |
| 오전 베이스 | 쌀밀가루죽 | 쌀오트밀죽 | … |
| 오전 토핑   | 소고기   | 소고기   | … |
|             | 양배추   | 브로콜리 | … |
|             | 청경채   | 당근     | … | 시금치 ① | …
```

- 블록의 기준일은 이유식 시작일(가장 이른 끼니의 시작일, 기획안 4.3절의 일차 계산과 같은 기준)이고, k번째 블록은 시작일부터 10k일째의 열흘이다. 미급여로 하루가 밀려도 열이 날짜이므로 블록이 흔들리지 않는다.
- 보이는 범위는 오늘의 7일 전이 속한 블록부터 마지막 예정 식단(없으면 오늘)이 속한 블록까지이고, 최대 6블록이다. 넘치면 오래된 블록을 버리고 그 수를 표 위에 적는다.
- 일차 열의 머리는 일차이고, 두 끼니를 모두 안 먹여 일차가 없는 날은 "미급여"다. 오늘 열은 굵게 하고 `▶`를 붙인다. 급여 완료된 식단은 일차 뒤에 `✓`를 붙인다.
- 엑셀이 셀 색으로 표시하던 첫 도입은 재료 뒤의 `①`, `②`로 표시한다. 숫자는 그 식단이 그 재료의 몇 회차 노출인지이고, 검증완료 재료에는 붙지 않는다. 반응있음 재료가 식단에 남아 있으면 `⚠`를 붙인다.
- 실제 급여 내용으로 정정된 식단은 정정된 내용을 보이고 `(수정)`을 붙인다. 메모는 베이스 옆에 그대로 붙는다.
- 끼니가 둘이면 오후의 베이스와 토핑 행이 오전 아래에 이어진다. 토핑 행 수는 그 블록에서 가장 많은 토핑 수이고 최소 1이다.

표 하나는 셀 300개가 한도다.

> Canvas tables have a limit of 300 cells per table; this may be any number of rows or columns that add up to that limit.

출처: https://docs.slack.dev/surfaces/canvases . 블록 하나는 11열이고 행은 2 + 끼니마다 (1 + 토핑 행 수)다. 끼니 하나에 토핑 넷이면 77셀, 끼니 둘이면 132셀이다. 토핑이 많아져 300을 넘으면 토핑 행을 잘라 내고 잘린 수를 표 아래 적는다. 본문 전체 한도 1MiB에는 6블록으로 닿지 않는다.

### 상태가 바뀐 뒤 1분 안에 갱신하고, 날이 바뀌면 한 번 더 갱신한다

상태판은 "지금 상태"이므로 매일 한 번으로는 부족하다. 미급여를 등록하면 그 뒤의 열이 전부 옮겨 가고, 입고를 등록하면 재고 표가 바뀐다. 반대로 매분 모든 가정의 상태를 렌더링해 비교하는 것은 ADR 0006이 브리프 시각 판정을 SQL 선별로 바꾼 것과 같은 이유로 피한다.

그래서 가정 행에 `state_changed_at`을 둔다. `PrismaWriteContext`의 모든 변경 메서드가 실제로 행을 썼을 때 dirty 플래그를 올리고, 트랜잭션이 끝나기 전에 같은 트랜잭션에서 그 시각을 갱신한다. 원장 추가, 식단 upsert, 미급여 추가와 삭제, 반응 기록, 재료·메뉴·끼니·규칙·알람 설정·임계개수 변경이 전부 여기 든다. 임계개수도 재고 표의 임계 열을 바꾸기 때문이다. `appendLedgerEntries([])`처럼 아무것도 쓰지 않은 호출은 플래그를 올리지 않으므로, 차이가 없는 매분 정합화는 이 시각을 건드리지 않는다.

이 컬럼이 "저장하지 않아도 되는 것은 저장하지 않는다"에 걸리지 않는 이유는 계산으로 얻을 수 없기 때문이다. 각 테이블의 `created_at`, `updated_at`의 최댓값은 삭제를 보지 못한다. `removeNoFeedRecord`, `saveThresholds`, `saveRules`, `updateMenu`가 행을 지우고(`src/infrastructure/prisma/household-writer.ts`), 그 삭제는 상태판을 바꾸지만 남는 시각이 없다.

갱신은 매분 도는 `BoardSyncJob`이 한다. 판정 조건은 다음과 같다.

| 조건 | 뜻 |
|---|---|
| 발행 기록이 없다 | 아직 한 번도 만들지 않았다 |
| `synced_state_at < state_changed_at` 이고 `state_changed_at <= 지금 - 60초` | 상태가 바뀌었고, 연속된 도구 호출이 끝나기를 1분 기다렸다 |
| `synced_on < 오늘` | 날이 바뀌었다. 오늘 열과 임계일 단계가 쓰기 없이도 바뀐다 |
| `next_attempt_at`이 없거나 지났다 | 실패한 가정은 5분 뒤에 다시 |

디바운스 60초는 에이전트가 식단 열흘치를 한 건씩 고칠 때 편집 열 번이 한 번으로 묶이게 하는 값이다. 갱신이 늦어지는 최대치는 그 1분에 tick 1분을 더한 2분이다.

브리프처럼 `INSERT ... ON CONFLICT`로 단독 발행자를 가리지 않는다. 캔버스 편집은 전체 교체라 두 인스턴스가 같은 내용을 두 번 써도 결과가 같다. 한 번만 일어나야 하는 외부 효과가 아니므로 클레임 행이 필요 없다.

### 발행 기록은 애플리케이션 것이고, 캔버스 id는 Slack 어댑터 것이다

ADR 0007이 `brief_delivery`와 `slack_message`를 나눈 경계를 그대로 쓴다.

| 테이블 | 소유 | 열 |
|---|---|---|
| `board_publication` | 애플리케이션(`BoardSyncLogPort`) | `household_id` PK, `status`(published, skipped, failed), `synced_state_at`, `synced_on`, `attempts`, `next_attempt_at`, `outcome_reason`, `updated_at` |
| `slack_canvas` | Slack 어댑터 | `household_id` PK, `channel_id`, `canvas_id`(예: `F0C4HPW0JP7`), `template_version`, `content_hash`, `updated_at` |

`claimDue`는 판정 시점에 읽은 `state_changed_at`을 클레임에 담아 돌려주고, 결과를 기록할 때 그 값을 `synced_state_at`에 쓴다. 기록 시각을 쓰면 클레임과 발행 사이에 들어온 쓰기가 영영 동기화되지 않는다.

`skipped`도 `synced_state_at`과 `synced_on`을 전진시킨다. 채널이 없는 가정, 사람이 만든 캔버스가 이미 있어 서버가 만들 수 없는 가정은 그렇지 않으면 매분 다시 잡힌다. 어댑터가 내용 해시가 같아 API를 부르지 않은 경우는 발행 성공과 같다.

`content_hash`는 템플릿 버전과 마크다운을 함께 SHA-256으로 만든 값이다. 해시가 같으면 `canvases.edit`를 부르지 않는다. 레이아웃을 바꿔 버전을 올리면 해시가 달라져 다음 갱신에서 반드시 한 번 편집된다.

Slack 어댑터의 흐름은 다음과 같다. `slack_canvas` 행이 없으면 `conversations.canvases.create`로 만들고 행을 넣는다. `channel_canvas_already_exists`가 오면 사람이 만든 캔버스가 있는 것이므로 `skipped`로 두고, `pnpm slack-link --household 재하네 --canvas F0C4HPW0JP7`로 연결한다. 행이 있으면 `canvases.edit`의 `replace`를 구역 id 없이 불러 문서 전체를 바꾼다.

> You can optionally specify a `section_id` or omit it to replace the entire canvas.

출처: https://docs.slack.dev/reference/methods/canvases.edit . 구역별 편집은 호출당 연산 하나라 표 여섯 개면 조회 한 번과 편집 여섯 번이 되고, 중간에 실패하면 반쪽 문서가 남는다. `canvas_editing_locked`(사람이 편집 중)는 실패로 돌려 5분 뒤 다시 시도한다. `missing_scope`처럼 사람이 고쳐야 풀리는 실패도 같은 5분 간격으로 흘러가고, 스코프가 들어오면 다음 시도에서 스스로 풀린다. 잡은 같은 사유가 반복될 때 오류 로그를 다시 찍지 않는다.

Web API의 `ok: false` 판정과 `fetch` 직접 호출은 ADR 0006과 같다.

### 미래 식단의 회차는 도메인 함수가 센다

브리프의 회차(`nextExposureNumber`)는 4.6절의 "이상 없음으로 기록한 급여만 센다"이고 오늘 식단에만 쓰인다. 달력은 앞으로의 식단에도 회차를 붙여야 하므로 규칙 결정이 하나 더 필요하다. 아직 먹이지 않은 식단은 이상 없음일 것으로 보고 다음 회차를 올리고, 이미 먹였지만 기록이 없는 식단은 올리지 않는다.

이것은 표현이 아니라 규칙이라 `src/domain/ingredient/exposure-projection.ts`의 순수 함수 `projectExposures`에 둔다. 입력은 창 시작 시점의 도입 상태와 창 안의 식단(급여 여부, 기록된 반응)이고, 출력은 식단마다 재료별 회차다. 식단은 날짜 순, 같은 날은 오전이 먼저다. DB 없는 테스트가 미기록 과거 급여, 같은 날 두 끼니, 창 밖 이전 식단, 검증완료와 반응있음 재료를 고정한다.

도메인 코어가 1단계 이후 처음 바뀐다. 다섯 단계 동안 바뀌지 않은 것은 규칙이 늘지 않았던 결과이지 지켜야 할 규칙이 아니다. 규칙을 애플리케이션에 두는 것이 더 나쁘다.

### 읽기 창

상태판 읽기 모델은 `HouseholdBoardService.get`이 만든다. 달력의 시작은 오늘의 7일 전이 속한 블록의 시작이므로 최대 16일 전이다. 기본 적재 창은 `LOOKBACK_DAYS`(기본 90일)라 지금은 그 안에 들지만, 설정에 기대지 않고 `LoadScope.sinceDate`로 오늘의 16일 전을 넘긴다. 창 시작 시점의 도입 상태는 급여 이력에서 창 시작보다 앞선 식단만 골라 계산한다.

### 미리보기

`pnpm slack-preview --template household_board --dry-run`이 오늘 상태판의 마크다운을 출력한다. `--dry-run` 없이 부르면 연결된 캔버스에 지금 발행한다. 발행 기록에는 쓰지 않으므로 다음 tick이 다시 잡지만, 해시가 같아 편집은 일어나지 않는다.

## 층별 결합

```
scheduler/BoardSyncJob ──▶ application/BoardSyncService ──▶ BoardSyncLogPort ──▶ infrastructure/prisma (board_publication)
                                   │                        └▶ BoardPublisherPort ──▶ slack/outbound/SlackCanvasPublisher
                                   └──▶ HouseholdBoardService ──▶ buildHouseholdBoard      │
                                              (buildDailyBrief + projectCalendar            ├─ templates/household-board.ts (마크다운)
                                               + projectExposures)                          └─ slack_canvas (Prisma)
```

애플리케이션은 Slack을 모른다. `BoardPublisherPort`는 "이 상태판을 내보내라"까지만 말하고 캔버스도 마크다운도 모른다. 상태판을 다른 곳에 내보내려면 이 포트의 다른 구현을 끼운다. 고정 메시지 대안이 필요해지면 그 구현 하나가 늘어날 뿐이다.

템플릿은 순수 함수다. `CanvasTemplate<Input>`은 `MessageTemplate`과 같은 규약(`key`, `version`, `render`)이고 출력만 마크다운 문자열이다. 달력을 표로 펴는 것은 `templates/calendar-grid.ts`가 하고 표를 마크다운으로 바꾸는 것은 `templates/markdown.ts`가 한다. 나뉜 이유는 같은 격자를 Block Kit 표로도 그릴 수 있게 두기 위해서다.

도메인에 더한 것은 회차 투영 하나다. 프레임워크, DB, 시계를 여전히 모른다.

## 대가와 남는 위험

- 가정 행에 `state_changed_at`이 생기고 모든 쓰기 트랜잭션이 마지막에 그 행을 한 번 더 갱신한다. 이미 그 행을 `FOR UPDATE`로 잡고 있으므로 잠금이 늘지는 않는다.
- 11열 표가 휴대폰에서 어떻게 보이는지는 문서가 말하지 않는다. 가로 스크롤인지 잘리는지는 사람이 채널 탭에서 본다. 2026-09-26에 시험 내용을 넣어 두었다.
- 캔버스는 사람이 지울 수 있다. 지워지면 `canvas_not_found`가 실패로 기록되고 5분마다 재시도된다. 복구는 `slack_canvas` 행을 지워 서버가 새로 만들게 하는 것이다. 이 기능을 되돌릴 때도 채널 캔버스는 사람이 지운다.
- 스코프 `canvases:write`와 `canvases:read`가 봇에 더 필요하다. 앱 재설치는 사람이 한다(`docs/user-intervention.md` 9번).
- 사람이 캔버스에 적은 내용은 다음 갱신이 지운다. 메모는 캔버스가 아니라 식단의 메모나 규칙의 텍스트 가이드에 적는다.
- 회차 투영은 미래 식단을 이상 없음으로 가정한다. 반응이 기록되면 그 뒤 회차가 바뀌므로 달력의 ①②는 예정이지 약속이 아니다.
- 실패한 가정은 상한 없이 5분마다 재시도한다. 사람이 고쳐야 풀리는 실패가 그동안 발행 기록에 남고 로그는 사유가 바뀔 때만 찍힌다.
