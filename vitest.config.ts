import { defineConfig } from 'vitest/config';

// 단위 테스트는 Docker 없이 돌아야 한다. 컨테이너를 띄우는 globalSetup은 integration
// 프로젝트의 인라인 설정에만 둔다. 루트 globalSetup은 프로젝트로 상속되지 않는다.
export default defineConfig({
  // vite-tsconfig-paths 플러그인을 대신하는 Vite 기본 기능. 프로젝트마다 플러그인이
  // 한 번씩 경고를 찍던 것도 없어진다.
  resolve: { tsconfigPaths: true },
  test: {
    coverage: {
      provider: 'v8',
      include: ['src/**/*.ts'],
      // main.ts와 scripts는 진입점이다. 하는 일이 인자를 읽어 배선을 부르는 것뿐이라
      // 테스트가 덮을 것이 없고, 집계에 들어가면 계층별 숫자만 흐려진다.
      exclude: ['src/**/*.spec.ts', 'src/main.ts', 'src/scripts/**', 'src/generated/**'],
      // Stock and date rules fail silently, so the domain core must stay almost fully covered.
      // 애플리케이션과 영속화는 통합 테스트가 덮으므로 `pnpm test:cov`는 두 프로젝트를 함께
      // 돌린다(Docker 필요). 단위 테스트만 돌리려면 `pnpm test`를 쓴다.
      thresholds: {
        'src/domain/**/*.ts': { lines: 95, branches: 95, functions: 95, statements: 95 },
        'src/application/**/*.ts': { lines: 95, branches: 85, functions: 90, statements: 90 },
        'src/infrastructure/**/*.ts': { lines: 95, branches: 85, functions: 85, statements: 90 },
        // 도구는 어댑터라 분기가 적다. 낮은 쪽은 이름을 못 찾았을 때의 대비 경로와
        // 도메인·애플리케이션이 아닌 예외를 다시 던지는 가지다.
        'src/mcp/**/*.ts': { lines: 90, branches: 75, functions: 90, statements: 90 },
        // 스케줄러도 어댑터다. 도는 규칙은 애플리케이션과 도메인 쪽에서 덮인다.
        'src/scheduler/**/*.ts': { lines: 90, branches: 75, functions: 90, statements: 90 },
        // Slack 발송도 어댑터다. 브리프를 줄로 바꾸고 보낼 뿐이고, 무엇을 보낼지는 애플리케이션이 정한다.
        'src/slack/**/*.ts': { lines: 90, branches: 75, functions: 90, statements: 90 },
        // 헬스체크도 어댑터다. DB에 한 번 묻고 결과를 상태 코드로 옮길 뿐이다.
        'src/health/**/*.ts': { lines: 90, branches: 75, functions: 90, statements: 90 },
      },
    },
    projects: [
      {
        // Vitest 4에서 인라인 프로젝트는 기본으로 루트 설정을 상속하지 않는다.
        extends: true,
        test: {
          name: 'unit',
          globals: true,
          root: './',
          include: ['**/*.spec.ts'],
        },
      },
      {
        extends: true,
        test: {
          name: 'integration',
          globals: true,
          root: './',
          include: ['test/integration/**/*.int-spec.ts'],
          globalSetup: ['./test/integration/setup/global-setup.ts'],
          setupFiles: ['./test/integration/setup/worker-database.ts'],
          // 컨테이너 기동과 마이그레이션은 globalSetup에서 한 번만 하지만,
          // 워커별 DB 복제가 beforeAll에서 일어난다.
          testTimeout: 30_000,
          hookTimeout: 60_000,
        },
      },
    ],
  },
});
