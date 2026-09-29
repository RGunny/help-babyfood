# help-babyfood 에이전트 작업 규약

이유식 큐브 재고와 식단을 관리하는 MCP 서버다. 사용자는 부모 두 명이다. 문서 지도는 `docs/README.md`, 기획은 `docs/product-plan.md`, 결정은 `docs/adr/`다. 이 파일에는 코드와 문서에서 알 수 있는 것을 적지 않는다.

기획과 다른 판단이 필요하면 구현하지 말고 `충돌:`로 적는다.

## 계층

- `src/domain`은 프레임워크, DB, 시스템 시계를 모른다. 현재 시각도 인자로 받는다. `harness.json`의 동결 경로라 고치려면 phase가 `unfreeze`를 선언하고 tech-critic-lead 승인을 받는다.
- `src/application`은 NestJS를 모른다. 서비스는 생성자에 포트를 받는 평범한 클래스이고 `*.module.ts`가 `useFactory`로 조립한다. 서비스에 데코레이터를 달지 않는다.
- `src/mcp`, `src/scheduler`, `src/slack`은 어댑터다. 재고 규칙을 다시 구현하지 않고 애플리케이션 서비스를 호출한다.
- 현재 시각은 `ClockPort`로만 들어온다.

## 금지

1. 작업 범위 밖의 파일은 눈에 띄어도 수정하지 않는다.
2. 운영 데이터가 없는데 호환 코드(nullable, fallback, 옛 문서 테스트)를 넣지 않는다.
3. 계산으로 얻을 수 있는 상태를 저장하지 않는다. 식단 날짜, 도입 상태, 보류된 차감은 계산이다.
4. 시크릿은 `.env`에서만 읽는다. 코드, 문서, 대화 출력에 값을 적지 않는다.
5. lockfile에 없는 의존성을 넣지 않는다.
6. 커밋 메시지는 영어 conventional commit이고 AI 작성 표시와 co-author를 넣지 않는다.
7. 테스트 이름은 규칙을 한국어로 서술한다. 통합 테스트는 `test/integration/*.int-spec.ts`에 둔다.

## 검증

검증 명령의 원본은 `harness.json`의 `verify`이고 `python3 scripts/harness/verify.py fast|full|arch`가 그 명령을 실행한다. 새 `.md`는 `scripts/doc-paths.json` 허용 목록을 사용자가 연 뒤에만 만든다. 마이그레이션은 배포 뒤 직접 실행한다(`docs/user-intervention.md` 6번).

## 하네스

- 요구 사항은 `docs/backlog.md`에 적고, `plan-and-build`가 이를 `tasks/{id}-{name}/`으로 만든다. 규격은 `prompts/task-create.md`다.
- `HARNESS_HEADLESS=1`이 설정된 세션은 무인 실행이다. 이 세션에서만 도구 호출이 아니라 phase 파일 단위로 승인하며, 전역 승인 규칙의 유일한 예외다. 이 변수를 쉘에서 직접 export하지 않는다.
- 러너는 `.env`가 없는 worktree에서 실행한다. 절차는 `docs/README.md`에 있다.
- 사람이 해야 하는 일이 생기면 `docs/user-intervention.md`에 적고 다음 작업으로 넘어간다. 세션이 끝나면 `wrap-up`으로 `cc-logs/`에 기록한다.
