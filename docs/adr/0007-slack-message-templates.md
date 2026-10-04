# ADR 0007: Slack 메시지는 코드 템플릿으로 만들고, 재고는 표 한 장으로 보이며, 보낸 메시지를 스냅숏으로 남긴다

- 상태: 채택
- 결정일: 2026-09-26

## 맥락

5단계(ADR 0006)의 브리프는 섹션마다 `• 소고기 2개 (가용 0, 폐기 대기 2) · 소진 예상 2026-09-28` 같은 글머리 줄을 이어 붙였다. 2026-09-26 운영 채널에 보낸 브리프에는 재고 17줄, 부족 예측 9줄, 임계일 5줄이 줄글로 쌓였다. 기획안 5장은 "재고현황 표"를 요구하는데 구현은 표가 아니었다.

구조에도 빈 곳이 둘 있었다.

하나는 양식이 흩어져 있다는 것이다. `src/slack/outbound/render-brief.ts` 한 파일에 블록 원시 함수, 한국어 라벨, 섹션별 문장, 잘라내기 규칙이 섞여 있었고, 버튼 답장 문구는 `src/slack/inbound/action-dispatch.ts`에 따로 있었다.

다른 하나는 무엇을 보냈는지 남지 않는다는 것이다. `brief_delivery.message_reference`에는 메시지 ts만 있고 채널과 페이로드가 없다. 레이아웃을 바꾼 뒤에는 어제 브리프가 어떻게 보였는지 재현할 수 없고, 나중에 `chat.update`로 원본을 고칠 근거도 없다.

## 결정

### 템플릿은 코드에 둔다

양식 하나가 `src/slack/templates/` 아래 파일 하나다. 각 템플릿은 `MessageTemplate<Input>`이고 `key`, `version`, `render(input)`을 가진다.

| 템플릿 | key | version |
|---|---|---|
| 일일 브리프 | `daily_brief` | 4 |
| 새 재료 반응 기록 | `reaction_prompt` | 1 |

버튼 답장 문구는 `response_url`로 가는 문장이라 Block Kit 메시지가 아니다. 그래도 양식이므로 같은 디렉터리의 `button-reply.ts`에 모은다.

DB에 문자열 템플릿(Handlebars, Liquid)을 두는 방식은 택하지 않았다. Novu나 Courier 같은 알림 플랫폼이 그렇게 하는 이유는 비개발자가 배포 없이 문구를 고치기 위해서다. 이 저장소의 양식에는 그런 편집자가 없다. 대신 템플릿 문법으로 표현할 수 없는 로직이 있다. 버튼 value는 `src/slack/actions.ts`의 인코더와 짝을 이뤄야 하고(ADR 0006), 블록 50개와 section 3000자와 표 100행을 넘을 때 자르는 규칙이 있다. DB 템플릿은 잘못 저장되어도 07:30 발송 시점에야 `invalid_blocks`로 드러난다. 코드 템플릿은 타입 검사와 스냅숏 테스트가 배포 전에 잡는다.

`slack-block-builder`나 `jsx-slack` 같은 빌더 라이브러리도 넣지 않았다. `@slack/types` 3.1.0이 이미 `TableBlock`까지 타입을 제공하고, 필요한 원시 함수는 `section`, `actions`, `button`, `context`, `header`, `divider`, `table` 일곱 개다.

`version`은 레이아웃을 바꿀 때 사람이 올린다. 스냅숏(아래)에 함께 남아서, 어느 양식으로 보낸 메시지인지 가려 준다.

### 브리프의 재고는 재료 표 한 장이다

`buildDailyBrief`의 `stock`은 모든 재료를 담는다(`src/application/daily-brief.ts`의 `summarizeStock(state.ingredients, …)`). 임계개수 도달도 재료 단위다. 그래서 두 섹션을 `ingredientId` 기준으로 표 한 장에 합친다.

```
재료   │ 합계 │ 가용 │ 폐기대기 │ 소진 예상 │ 임계
소고기 │    2 │    0 │        2 │ 09-28     │ –
쌀     │    5 │    5 │        0 │ 10-01     │ –
오트밀 │   15 │   15 │        0 │ –         │ –
```

- 행 순서는 소진 예상일이 빠른 재료, 폐기 대기가 있는 재료, 나머지 재료다. 같은 무리 안에서는 `stock`의 원래 순서를 지킨다.
- 날짜는 `MM-DD`로 줄인다. 연도는 브리프 제목에 있다.
- 임계 열에는 임계개수에 닿은 재료만 그 임계개수를 숫자로 적고, 나머지는 `–`다.
- 합계가 0인 재료는 표에서 빼고 표 아래 context 한 줄(`재고 0: 땅콩버터, 오이`)로 적는다. 2026-09-26 데이터 기준으로 17행이 11행으로 준다.
- 표는 100행과 표 전체 1만 자가 한도다(출처: https://docs.slack.dev/reference/block-kit/blocks/table-block ). 넘치면 뒤쪽 행을 버리고, 버린 개수를 표 아래 context로 알린다. 기존 `linesSection`의 "…외 N줄 생략"과 같은 규칙이다.

부족 예측(부족 시작일, 부족 개수)은 브리프에서 뺐다. 재료가 언제 떨어지는지는 `소진 예상` 열이 이미 보여 주고, 부족 시작일은 대개 그 다음 날이라 한 행에 같은 말이 두 번 나온다. `DailyBrief.shortages`와 MCP `forecast_shortage`는 그대로 두므로, 몇 개를 더 조리해야 하는지는 에이전트 클라이언트에서 묻는다.

~~임계일 알람은 표에 넣지 않는다. 재료가 아니라 배치 단위이고, 배치마다 "폐기 완료" 버튼이 붙는다. 표 셀에는 버튼을 넣을 수 없다.~~ 2026-09-29 ADR 0009로 뒤집혔다. 임계일은 재고 표의 열이 되었고 폐기 버튼만 표 아래에 남는다.

반응 기록 후속 메시지도 표로 바꾸지 않는다. 버튼이 메시지의 전부이고, 재료마다 actions 블록 하나를 두는 지금 구조가 그대로 맞다.

### 표 셀은 숫자도 `raw_text`다

2026-09-26 운영 채널에서 실제로 보내 확인했다.

| 보낸 셀 | 결과 |
|---|---|
| `{ "type": "raw_number", "value": 2 }` (문서 예시의 필드) | `invalid_blocks`, `missing required field: text` |
| `{ "type": "raw_number", "value": "2", "text": "2" }` | `invalid_blocks`, `must provide a number` |
| `{ "type": "raw_number", "value": 2, "text": "2" }` | `ok: true`. 데스크톱 앱은 숫자를 그리고, 모바일 앱은 칸을 비워 둔다(2026-10-04 확인) |
| `{ "type": "raw_text", "text": "2" }` | `ok: true`. 데스크톱과 모바일 모두 그린다(2026-10-04 확인) |
| 표 두 개를 가진 메시지 | `ok: true` |

~~그래서 숫자 셀은 숫자 `value`와 표시용 `text`를 함께 넣는다.~~ 2026-10-04에 뒤집었다. 부모는 브리프를 휴대폰으로 읽는데, 10-01부터 10-04까지의 브리프에서 합계·가용·임계 지남 열이 모바일 앱에서 비어 보였다. 같은 날 `raw_number` 표와 `raw_text` 표를 한 메시지에 넣어 보냈더니 `raw_text` 표만 숫자가 보였다. 공개된 Slack 문서와 SDK 저장소에는 이 차이가 적혀 있지 않다.

그래서 모든 셀을 `raw_text`로 보낸다. 오른쪽 정렬은 `column_settings.align`이 맡으므로 셀 타입이 숫자가 아니어도 모양은 같다. 셀은 `src/slack/templates/table.ts`의 `textCell` 한 곳에서만 만들고, 단위 테스트가 숫자 칸의 모양을 고정한다. `raw_number`가 주는 것은 `data_table` 블록의 숫자 정렬인데, 브리프의 표는 정렬 기능이 없는 `table` 블록이라 잃는 것이 없다.

### 보낸 메시지는 `slack_message`에 남긴다

| 열 | 예 |
|---|---|
| `id` | uuid v7 |
| `household_id` | 가정 |
| `channel_id` | `C0C464ME015` |
| `message_ts` | `1790408011.344589` |
| `template_key` | `daily_brief` |
| `template_version` | `2` |
| `payload` | `{ "text": …, "blocks": […] }`, 보낸 그대로의 jsonb |
| `posted_at` | 발송 성공 시각 |

유일 키는 (`channel_id`, `message_ts`)다. Slack에서 메시지를 가리키는 쌍이 이것이고, 버튼 요청 본문에도 `channel.id`와 `message.ts`가 함께 온다. 나중에 폐기한 배치의 버튼을 `chat.update`로 지운다면 이 행이 조회 키가 된다. `chat.update`는 이 결정의 범위가 아니다.

발송 로그(`brief_delivery`, `reaction_prompt_delivery`)와 테이블을 나눈 이유는 계층이 다르기 때문이다. 발송 로그는 전달 수단을 모르는 `BriefDeliveryPort`의 기록이고, 애플리케이션의 `BriefDispatchService`가 쓴다. 스냅숏은 Block Kit 페이로드라 Slack 어댑터의 기록이고, `SlackBriefDelivery`가 Prisma에 직접 쓴다. 가정의 채널 id를 Prisma에서 읽는 것과 같은 어댑터 경계다(ADR 0006 "층별 결합").

스냅숏 쓰기는 `chat.postMessage`가 성공한 뒤에 하고, 실패해도 예외를 던지지 않고 로그만 남긴다. 던지면 `BriefDispatchService`가 `recordFailed`를 부르고, 이미 채널에 간 브리프가 재시도로 한 번 더 간다. 스냅숏 하나가 빠지는 것이 부모가 같은 브리프를 두 번 받는 것보다 낫다.

기존 `message_reference`는 그대로 둔다. 운영 데이터가 이미 있고, 발송 로그에서 그 열이 뜻하는 것(보낸 메시지를 가리키는 값)은 바뀌지 않는다.

### 미리보기는 정식 명령으로 한다

`pnpm slack-preview`(`src/scripts/preview-slack.ts`)는 실제 `DailyBriefService`와 템플릿으로 오늘 양식을 렌더링해 지정한 채널에 보낸다. 맨 위에 "[미리보기] 버튼을 누르면 실제로 기록됩니다" 줄을 붙인다. 발송 로그와 스냅숏에는 쓰지 않는다. `--dry-run`은 보내지 않고 Block Kit Builder에 붙여 넣을 페이로드를 출력한다.

2026-09-26에는 이것 없이 `railway ssh`로 임시 스크립트를 넣어 양식을 확인했다. 그 방식은 배포된 `dist` 경로를 손으로 import해야 하고, 다음 사람이 같은 일을 다시 짜야 한다.

## 층별 결합

```
application ── DailyBrief, ReactionPrompt ──▶ BriefDeliveryPort
                                                   │ (구현)
src/slack/outbound/SlackBriefDelivery ─┬─ templates/daily-brief.ts ─┐
                                       ├─ templates/reaction-prompt.ts ─┼─ templates/blocks.ts, table.ts, labels.ts
                                       └─ SlackMessageLog (Prisma) ─────┘
src/slack/inbound/SlackActionDispatcher ── templates/button-reply.ts, labels.ts
```

애플리케이션 계층과 `BriefDeliveryPort`는 바뀌지 않는다. 포트는 여전히 `DailyBrief`를 받아 결과를 돌려줄 뿐이고, 표도 템플릿 버전도 모른다.

템플릿은 순수 함수다. 네트워크도 저장소도 모른다. 입력이 같으면 페이로드가 같으므로 스냅숏 테스트가 성립한다.

양식을 더하는 방법은 `src/slack/templates/`에 `MessageTemplate`을 하나 더 만들고 발송 어댑터에서 부르는 것이다. 브리프에 섹션을 더하는 방법은 `daily-brief.ts`의 섹션 함수 배열에 한 줄을 더하는 것이다. 표 열을 더하는 방법은 `TableSpec`의 `columns`에 항목 하나를 더하는 것이며, 셀 모양은 `table.ts`가 책임진다.

도메인 코어는 이번에도 바뀌지 않는다.

## 대가와 남는 위험

- 표의 모바일 표시를 문서가 말하지 않는다. 6열 표가 iOS 앱에서 가로로 스크롤되는지 잘리는지는 배포 뒤 사람이 확인한다.
- 모바일 앱이 `raw_number` 셀을 비워 두는 것은 실측이고, Slack이 고치면 두 셀 타입의 차이가 사라진다. 그래도 `raw_text`로 돌아갈 이유는 없다.
- 표의 다른 셀 타입이 모바일에서 어떻게 그려지는지는 보낸 적이 없어 모른다. 새 셀 타입을 쓰기 전에 휴대폰으로 본다.
- 스냅숏 쓰기 실패를 삼키므로, 드물게 보낸 메시지의 스냅숏이 빠질 수 있다.
- `version`을 사람이 올려야 한다. 스냅숏 테스트 파일이 바뀌는 변경은 버전도 함께 바뀌었는지 리뷰에서 본다.
- 스냅숏은 가정당 하루 1~3행이고, 행당 대략 5~10KB다. 1년에 가정당 약 1천 행이다. 정리 작업은 두지 않았다.
- 부족 예측이 Slack 브리프에서 빠졌으므로, "몇 개를 더 조리해야 하나"는 MCP로만 알 수 있다.
