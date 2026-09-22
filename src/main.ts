import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module.js';

async function bootstrap() {
  const app = await NestFactory.create(AppModule, {
    // Slack 서명은 파싱한 본문이 아니라 받은 바이트 그대로에 대해 계산된다. 이 옵션이 있어야
    // json과 urlencoded 파서가 req.rawBody에 원본을 남긴다(ADR 0006 "서명 검증").
    rawBody: true,
  });
  await app.listen(process.env.PORT ?? 3000);
}
await bootstrap();
