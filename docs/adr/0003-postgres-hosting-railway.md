# ADR 0003: PostgreSQL은 Railway에 두고 PITR을 켠다

- 상태: 채택 (PITR 플랜 조건은 프로비저닝 때 확인)
- 결정일: 2026-09-21

## 맥락

데이터베이스는 PostgreSQL이다. 재고 원장은 잃으면 냉동고를 다시 세어 맞춰야 하고, 급여 이력과 알러지 반응 기록은 다시 만들 수 없다. 그래서 호스팅의 첫 번째 기준은 특정 시점으로 되돌릴 수 있는 백업이다. 서버는 Railway에서 상시 구동한다. 이 서비스는 인증, 파일 저장, 실시간 구독 같은 부가 기능 없이 순수 PostgreSQL만 쓴다.

## 결정

Railway의 Postgres 서비스를 쓰고 시점 복구(PITR)를 켠다. 서버와 DB는 Railway 사설망으로 연결하고 DB를 외부에 노출하지 않는다.

## 근거

Railway는 pgBackRest로 WAL을 보관하는 PITR을 제공한다. 공식 문서의 설명이다.

> The last 4 full backups are retained, giving you a restore window of roughly 4 weeks.

출처: [Railway Point-in-Time Recovery](https://docs.railway.com/volumes/point-in-time-recovery). 별도 PITR 요금 없이 보관 버킷의 스토리지와 업로드 트래픽으로 과금된다. 복구는 원본을 덮어쓰지 않고 새 서비스로 만들어지므로, 복구 결과를 확인한 뒤에 연결을 바꿀 수 있다.

서버와 같은 플랫폼에 두면 사설망으로 연결되어 지연이 작고, 연결 문자열과 과금, 배포 설정이 한곳에 모인다.

## 검토한 대안

| 후보 | 택하지 않은 이유 |
|---|---|
| Supabase | 가치의 대부분이 Auth, Storage, Realtime, 자동 REST인데 이 서비스는 쓰지 않는다. 무료 플랜에는 자동 백업이 없다. PITR은 Pro 이상 플랜의 유료 애드온이고 Small 이상 컴퓨트를 요구하며, 7일 보관이 월 약 100달러다([Supabase Database Backups](https://supabase.com/docs/guides/platform/backups)) |
| Neon | PITR이 기본 제공되는 점은 좋다. 다만 서버가 Railway에 있어서 DB 연결이 공용 인터넷을 지나고, 플랫폼이 둘로 나뉜다. Railway PITR을 쓸 수 없을 때의 차선책으로 둔다 |

## 대가와 확인할 것

- Railway PITR 문서에는 지원 플랜과 GA 여부가 없다. 프로비저닝할 때 확인하고, 쓸 수 없으면 Neon으로 바꾼다.
- 복구 가능 구간은 PITR을 켠 뒤의 첫 베이스 백업부터다. 운영 데이터를 넣기 전에 켠다.
- PITR을 쓰면 Postgres 이미지의 마이너 버전을 고정할 수 없다(메이저 태그만 지원).
- 서버와 DB가 같은 플랫폼에 있어서 Railway 장애 때 둘이 함께 멈춘다. 이 서비스는 서버가 멈추면 DB만 살아 있어도 쓸 수 없으므로 받아들인다.
- 복구 절차는 운영 데이터를 넣기 전에 한 번 실제로 수행해 본다.
