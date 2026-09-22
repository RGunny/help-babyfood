import type { Response } from 'express';
import type { PrismaService } from '../infrastructure/prisma/prisma.service.js';
import { HealthController } from './health.controller.js';

function responseStub() {
  const response = { status: vi.fn() };
  response.status.mockReturnValue(response);
  return response;
}

function controllerWith(queryRaw: () => Promise<unknown>): HealthController {
  return new HealthController({ $queryRaw: queryRaw } as unknown as PrismaService);
}

describe('헬스체크', () => {
  it('DB가 답하면 상태 코드를 건드리지 않고 ok를 돌려준다', async () => {
    const response = responseStub();

    const body = await controllerWith(async () => [{ '?column?': 1 }]).check(
      response as unknown as Response,
    );

    expect(body).toEqual({ status: 'ok' });
    expect(response.status).not.toHaveBeenCalled();
  });

  it('DB가 실패하면 503과 error를 돌려주고 예외 메시지는 본문에 싣지 않는다', async () => {
    const response = responseStub();
    const secret = 'postgresql://app:hunter2@db.internal:5432/app';

    const body = await controllerWith(async () => {
      throw new Error(`connect ECONNREFUSED ${secret}`);
    }).check(response as unknown as Response);

    expect(response.status).toHaveBeenCalledWith(503);
    expect(body).toEqual({ status: 'error' });
    expect(JSON.stringify(body)).not.toContain('hunter2');
  });
});
