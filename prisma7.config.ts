import { defineConfig } from 'prisma/config';

// Prisma 7은 .env를 자동으로 읽지 않는다. dotenv를 더하는 대신 Node의 내장 로더를 쓴다.
// 파일이 없는 환경(CI, 테스트 컨테이너)에서는 이미 들어 있는 환경 변수를 그대로 쓴다.
try {
  process.loadEnvFile();
} catch {
  // .env가 없으면 넘어간다.
}

// 파일 이름이 prisma7.config.ts인 이유: 7.10.0의 CLI는 prisma7.config.*를 먼저 찾고
// prisma.config.*로 폴백한다. 나중에 8로 올릴 때 설정 파일이 섞이지 않는다.
export default defineConfig({
  schema: 'prisma/schema.prisma',
  migrations: { path: 'prisma/migrations' },
  datasource: {
    // env() 헬퍼는 값이 없으면 던진다. generate처럼 DB가 필요 없는 명령도 돌아야 하므로
    // process.env를 직접 읽는다.
    url: process.env['DATABASE_URL'] ?? '',
  },
});
