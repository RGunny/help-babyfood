import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module.js';

async function bootstrap() {
  const app = await NestFactory.create(AppModule, {
    // Slack 서명은 파싱한 본문이 아니라 받은 바이트 그대로에 대해 계산된다. 이 옵션이 있어야
    // json과 urlencoded 파서가 req.rawBody에 원본을 남긴다(ADR 0006 "서명 검증").
    rawBody: true,
  });
  // 배포는 SIGTERM으로 옛 인스턴스를 내린다. 이것이 있어야 Nest의 종료 절차가 돌아 등록된 크론이
  // 멈추고 PrismaService.onModuleDestroy가 커넥션 풀을 닫는다(ADR 0005, ADR 0006 "Railway 배포").
  //
  // 정리하는 것은 도는 tick과 커넥션이지 Slack 버튼의 지연 처리가 아니다. 버튼은 200을 먼저 보내고
  // 처리를 void로 띄우는데, 그 Promise는 종료 훅이 모른다. 200을 보낸 뒤 유스케이스를 부르기 전에
  // 종료가 시작되면 그 탭은 사라진다. 부모가 다시 탭하면 멱등키가 같아 한 번만 기록된다.
  // ADR 0006 "버튼 응답은 처리보다 먼저 200으로 답한다"의 대가와 같은 것이다.
  app.enableShutdownHooks();
  await app.listen(process.env.PORT ?? 3000);
}
await bootstrap();
