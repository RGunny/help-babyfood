import { Logger } from '@nestjs/common';
import { afterEach, vi } from 'vitest';
import { ReconcileOutcome, ReconcileReport, ReconcileService } from '../application/reconcile.service.js';
import { ReconcileJob } from './reconcile.job.js';

const NOTHING_CHANGED: ReconcileReport = { consumedMealIds: [], revertedMealIds: [], held: [] };

function jobOver(outcomes: ReconcileOutcome[] | Error): ReconcileJob {
  const service = {
    runEveryHousehold: async () => {
      if (outcomes instanceof Error) throw outcomes;
      return outcomes;
    },
  };
  return new ReconcileJob(service as unknown as ReconcileService);
}

const logged = () => vi.spyOn(Logger.prototype, 'log').mockImplementation(() => {});
const errored = () => vi.spyOn(Logger.prototype, 'error').mockImplementation(() => {});

afterEach(() => {
  vi.restoreAllMocks();
});

describe('정합화 잡', () => {
  it('바뀐 것이 있는 가정만 기록한다', async () => {
    const log = logged();

    await jobOver([
      { kind: 'reconciled', householdId: '재하네', report: { ...NOTHING_CHANGED, consumedMealIds: ['meal-1'] } },
      { kind: 'reconciled', householdId: '민준네', report: NOTHING_CHANGED },
    ]).tick();

    // 매분 도는 잡이라, 바뀐 것이 없을 때도 남기면 로그가 그것으로만 찬다.
    expect(log).toHaveBeenCalledTimes(1);
    expect(log.mock.calls[0][0]).toContain('재하네');
  });

  it('보류된 차감만 있어도 기록한다', async () => {
    const log = logged();

    await jobOver([
      {
        kind: 'reconciled',
        householdId: '재하네',
        report: {
          ...NOTHING_CHANGED,
          held: [{ mealId: 'meal-1', mealDate: '2026-09-22' as never, ingredientId: 'broccoli', cubes: 1 }],
        },
      },
    ]).tick();

    expect(log.mock.calls[0][0]).toContain('보류 1건');
  });

  it('실패한 가정은 오류로 기록하고 tick은 끝까지 간다', async () => {
    const error = errored();

    await expect(
      jobOver([
        { kind: 'failed', householdId: '재하네', error: new Error('연결이 끊겼습니다') },
        { kind: 'reconciled', householdId: '민준네', report: NOTHING_CHANGED },
      ]).tick(),
    ).resolves.toBeUndefined();

    expect(error).toHaveBeenCalledTimes(1);
    expect(error.mock.calls[0][0]).toContain('재하네');
  });

  it('쓸기 자체가 던져도 tick은 예외를 밖으로 내지 않는다', async () => {
    const error = errored();

    await expect(jobOver(new Error('가정 목록을 읽지 못했습니다')).tick()).resolves.toBeUndefined();

    expect(error.mock.calls[0][0]).toContain('쓸기를 시작하지 못했습니다');
    expect(error.mock.calls[0][1]).toContain('가정 목록을 읽지 못했습니다');
  });

  it('Error가 아닌 것이 올라와도 기록할 내용을 만든다', async () => {
    const error = errored();

    // 드라이버가 문자열을 던지는 경우가 있다. 스택을 꺼내려다 로그가 비면 원인을 잃는다.
    await jobOver([{ kind: 'failed', householdId: '재하네', error: '연결 종료' }]).tick();

    expect(error.mock.calls[0][1]).toBe('연결 종료');
  });
});
