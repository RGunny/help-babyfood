# ADR 0002: ORM은 Prisma 7

- 상태: 채택
- 결정일: 2026-09-21
- 적용 시점: 영속화 단계 (도메인 코어 이후)

## 맥락

재고는 원장 이벤트의 합으로 계산한다. 실제 급여 내용을 고치면 "기존 소비 취소"와 "새 내용으로 재차감"이 함께 기록돼야 하고, 하나만 기록되면 재고가 틀어진다. 부모 두 명과 스케줄러가 같은 배치를 동시에 차감할 수도 있다. 그래서 ORM의 첫 번째 기준은 트랜잭션이다. 두 번째 기준은 개인 npm 정책(`ignore-scripts=true`)과 충돌하지 않는 것이고, 세 번째는 에이전트 코딩에서 정확한 코드가 나올 만큼 자료가 많은 것이다.

## 결정

Prisma ORM 7을 쓴다. 도메인 코어는 Prisma 타입을 모르고, 저장소 인터페이스 뒤에서만 Prisma를 쓴다.

## 근거

Prisma 7은 Rust 엔진 없는 클라이언트가 기본이고([Prisma ORM v7.0.0 changelog](https://www.prisma.io/changelog/2025-11-19)), 클라이언트 생성이 설치 과정에 끼어들지 않는다. 업그레이드 가이드의 문장이다.

> migrate dev and db push no longer run prisma generate automatically. You must run prisma generate explicitly.

출처: [Upgrade to Prisma ORM 7](https://www.prisma.io/docs/guides/upgrade-prisma-orm/v7). 설치 스크립트를 막아 둔 환경에서도 `prisma generate`를 명시적으로 실행하면 되므로 정책과 충돌하지 않는다.

트랜잭션은 `$transaction`에 콜백을 넘기는 방식으로 여러 쓰기를 묶고 격리 수준을 지정할 수 있다. 스키마 파일 하나에서 마이그레이션과 타입이 함께 나오고, TypeScript ORM 가운데 문서와 예제가 가장 많다.

## 검토한 대안

| 후보 | 택하지 않은 이유 |
|---|---|
| Drizzle | 결정일 기준 안정판은 0.45.x이고 1.0은 베타 단계다([Drizzle latest releases](https://orm.drizzle.team/docs/latest-releases)). 1.0에서 관계 API가 바뀌므로 지금 쓴 코드가 곧 마이그레이션 대상이 된다. SQL에 가까워 원장 집계와 `FOR UPDATE`에는 더 잘 맞는다는 점은 인정한다 |
| TypeORM | 트랜잭션 범위와 마이그레이션 생성에서 알려진 함정이 많고, ESM 프로젝트와의 마찰이 있다 |
| MikroORM | 설계는 탄탄하지만 자료가 적어 에이전트 코딩의 정확도가 떨어진다 |

## 대가

- Prisma에는 `SELECT ... FOR UPDATE`가 없다. 동시 차감은 Serializable 격리 수준과 재시도로 처리하고, 부족하면 `$queryRaw`로 잠금을 건다. 멱등키는 유니크 제약으로 보장한다.
- v7은 설정 방식이 v6와 다르다. 가이드는 "The way to create a new Prisma Client has changed to require a driver adapter for all databases."와 "The output field is now required in the generator block."을 명시한다. 에이전트가 v6 이전 방식으로 코드를 내면 동작하지 않으므로, 도입할 때 v7 가이드를 기준으로 검증한다.
- 저장소 인터페이스를 한 겹 두는 비용이 든다. 대신 도메인 테스트가 DB 없이 돌고, ORM을 바꿀 때 도메인 코어는 건드리지 않는다.
