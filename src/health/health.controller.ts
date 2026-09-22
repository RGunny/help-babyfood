import { Controller, Get, HttpStatus, Inject, Logger, Res } from '@nestjs/common';
import type { Response } from 'express';
import { PrismaService } from '../infrastructure/prisma/prisma.service.js';

export interface HealthStatus {
  readonly status: 'ok' | 'error';
}

/**
 * `GET /health`, which the Railway health check calls after each deploy.
 *
 * It answers through the database. A check that only proves the process is up reports a server
 * whose connections are gone as healthy, and every request it then takes fails.
 *
 * No authentication: the platform's check carries no token. The MCP middleware is bound to `mcp`
 * only, so nothing stands in front of this route.
 */
@Controller('health')
export class HealthController {
  private readonly logger = new Logger(HealthController.name);

  constructor(@Inject(PrismaService) private readonly prisma: PrismaService) {}

  @Get()
  async check(@Res({ passthrough: true }) response: Response): Promise<HealthStatus> {
    try {
      await this.prisma.$queryRaw`SELECT 1`;
      return { status: 'ok' };
    } catch (error) {
      // 본문에는 예외 메시지를 싣지 않는다. 드라이버 오류에 접속 문자열이 섞여 나올 수 있다.
      this.logger.error('헬스체크의 DB 확인이 실패했습니다', error);
      response.status(HttpStatus.SERVICE_UNAVAILABLE);
      return { status: 'error' };
    }
  }
}
