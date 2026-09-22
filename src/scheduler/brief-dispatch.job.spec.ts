import { Logger } from '@nestjs/common';
import { afterEach, vi } from 'vitest';
import { BriefDispatchService, DispatchOutcome } from '../application/brief-dispatch.service.js';
import { BriefDispatchJob } from './brief-dispatch.job.js';

function jobOver(outcomes: DispatchOutcome[] | Error): BriefDispatchJob {
  const service = {
    runEveryHousehold: async () => {
      if (outcomes instanceof Error) throw outcomes;
      return outcomes;
    },
  };
  return new BriefDispatchJob(service as unknown as BriefDispatchService);
}

const logged = () => vi.spyOn(Logger.prototype, 'log').mockImplementation(() => {});
const errored = () => vi.spyOn(Logger.prototype, 'error').mockImplementation(() => {});

afterEach(() => {
  vi.restoreAllMocks();
});

describe('브리프 발송 잡', () => {
  it('보낸 것이 있으면 기록한다', async () => {
    const log = logged();

    await jobOver([
      { kind: 'sent', target: 'brief', householdId: '재하네' },
      { kind: 'skipped', target: 'brief', householdId: '민준네', reason: 'not_linked' },
    ]).tick();

    expect(log).toHaveBeenCalledTimes(1);
    expect(log.mock.calls[0][0]).toContain('재하네');
  });

  it('전부 skipped이거나 deferred면 기록하지 않는다', async () => {
    const log = logged();
    const error = errored();

    // 매분 도는 잡이라, 평상시의 건너뜀까지 남기면 로그가 그것으로만 찬다.
    await jobOver([
      { kind: 'skipped', target: 'brief', householdId: '재하네', reason: 'not_linked' },
      { kind: 'deferred', target: 'reaction_prompt', householdId: '민준네' },
    ]).tick();

    expect(log).not.toHaveBeenCalled();
    expect(error).not.toHaveBeenCalled();
  });

  it('failed가 있으면 오류로 기록하고 tick은 끝까지 간다', async () => {
    const log = logged();
    const error = errored();

    await expect(
      jobOver([
        { kind: 'failed', target: 'brief', householdId: '재하네', error: new Error('channel_not_found') },
        { kind: 'sent', target: 'reaction_prompt', householdId: '민준네' },
      ]).tick(),
    ).resolves.toBeUndefined();

    expect(error).toHaveBeenCalledTimes(1);
    expect(error.mock.calls[0][0]).toContain('재하네');
    expect(error.mock.calls[0][1]).toContain('channel_not_found');
    expect(log.mock.calls[0][0]).toContain('민준네');
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
    await jobOver([{ kind: 'failed', target: 'brief', householdId: '재하네', error: '연결 종료' }]).tick();

    expect(error.mock.calls[0][1]).toBe('연결 종료');
  });
});
