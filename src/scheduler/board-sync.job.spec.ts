import { Logger } from '@nestjs/common';
import { afterEach, vi } from 'vitest';
import { BoardSyncOutcome, BoardSyncService } from '../application/board-sync.service.js';
import { BoardSyncJob } from './board-sync.job.js';

function jobOver(outcomes: BoardSyncOutcome[] | Error): BoardSyncJob {
  const service = {
    runEveryHousehold: async () => {
      if (outcomes instanceof Error) throw outcomes;
      return outcomes;
    },
  };
  return new BoardSyncJob(service as unknown as BoardSyncService);
}

const logged = () => vi.spyOn(Logger.prototype, 'log').mockImplementation(() => {});
const warned = () => vi.spyOn(Logger.prototype, 'warn').mockImplementation(() => {});
const errored = () => vi.spyOn(Logger.prototype, 'error').mockImplementation(() => {});

afterEach(() => {
  vi.restoreAllMocks();
});

describe('상태판 동기화 잡', () => {
  it('갱신한 가정은 기록하고 건너뛴 가정은 경고로 남긴다', async () => {
    const log = logged();
    const warn = warned();

    await jobOver([
      { kind: 'published', householdId: '재하네' },
      { kind: 'skipped', householdId: '민준네', reason: 'not_linked' },
    ]).tick();

    expect(log).toHaveBeenCalledTimes(1);
    expect(log.mock.calls[0][0]).toContain('재하네');
    expect(warn).toHaveBeenCalledTimes(1);
    expect(warn.mock.calls[0][0]).toContain('not_linked');
  });

  it('실패는 오류로 기록하되 같은 사유의 반복은 다시 찍지 않는다', async () => {
    const error = errored();

    await jobOver([
      { kind: 'failed', householdId: '재하네', error: new Error('missing_scope'), repeated: false },
      { kind: 'failed', householdId: '민준네', error: new Error('missing_scope'), repeated: true },
    ]).tick();

    expect(error).toHaveBeenCalledTimes(1);
    expect(error.mock.calls[0][0]).toContain('재하네');
  });

  it('쓸기 자체가 던지면 오류 하나로 남기고 tick은 끝난다', async () => {
    const error = errored();

    await expect(jobOver(new Error('connection refused')).tick()).resolves.toBeUndefined();

    expect(error).toHaveBeenCalledTimes(1);
  });
});
