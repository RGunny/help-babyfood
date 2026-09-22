import { HouseholdDirectoryPort } from './ports/household-directory.port.js';
import {
  HouseholdWriteContext,
  HouseholdWriter,
  WriteRequest,
} from './ports/household-write.port.js';
import { ReconcileReport, ReconcileService } from './reconcile.service.js';

const EMPTY_REPORT: ReconcileReport = { consumedMealIds: [], revertedMealIds: [], held: [] };

/**
 * Records the requests instead of running the body. What the body does is the domain's
 * `reconcileMeals`, covered by `src/domain/deduction/deduction.spec.ts` and by the integration
 * tests; what this file is about is which households a sweep visits and in which shape.
 */
class RecordingWriter implements HouseholdWriter {
  readonly requests: WriteRequest[] = [];

  constructor(private readonly failing: ReadonlySet<string> = new Set()) {}

  async write<T>(request: WriteRequest, _body: (context: HouseholdWriteContext) => Promise<T>): Promise<T> {
    this.requests.push(request);
    if (this.failing.has(request.householdId)) {
      throw new Error(`정합화가 실패한 가정: ${request.householdId}`);
    }
    return EMPTY_REPORT as unknown as T;
  }
}

function directory(...ids: string[]): HouseholdDirectoryPort {
  return { listIds: async () => ids };
}

describe('가정 전체 정합화', () => {
  it('가정 목록의 순서대로 가정마다 트랜잭션을 하나 연다', async () => {
    const writer = new RecordingWriter();
    const service = new ReconcileService(writer, directory('재하네', '민준네'));

    const outcomes = await service.runEveryHousehold();

    expect(writer.requests.map((request) => request.householdId)).toEqual(['재하네', '민준네']);
    expect(outcomes).toEqual([
      { kind: 'reconciled', householdId: '재하네', report: EMPTY_REPORT },
      { kind: 'reconciled', householdId: '민준네', report: EMPTY_REPORT },
    ]);
  });

  it('한 가정이 실패해도 뒤에 있는 가정의 정합화는 돈다', async () => {
    const writer = new RecordingWriter(new Set(['재하네']));
    const service = new ReconcileService(writer, directory('재하네', '민준네'));

    const outcomes = await service.runEveryHousehold();

    expect(writer.requests.map((request) => request.householdId)).toEqual(['재하네', '민준네']);
    expect(outcomes[0]).toMatchObject({ kind: 'failed', householdId: '재하네' });
    expect(outcomes[1]).toMatchObject({ kind: 'reconciled', householdId: '민준네' });
  });

  it('실패는 예외가 아니라 결과로 돌아온다', async () => {
    const service = new ReconcileService(new RecordingWriter(new Set(['재하네'])), directory('재하네'));

    const outcomes = await service.runEveryHousehold();

    expect(outcomes).toHaveLength(1);
    expect(outcomes[0]).toMatchObject({ kind: 'failed' });
    if (outcomes[0].kind !== 'failed') throw new Error('실패 결과가 아닙니다');
    expect((outcomes[0].error as Error).message).toContain('재하네');
  });

  it('수행자는 스케줄러이고 멱등키는 붙지 않는다', async () => {
    const writer = new RecordingWriter();
    const service = new ReconcileService(writer, directory('재하네'));

    await service.runEveryHousehold();

    // 멱등키를 붙이면 같은 키의 기록된 응답이 돌아와 정합화가 실제로 돌지 않는 날이 생긴다.
    expect(writer.requests).toEqual([
      { householdId: '재하네', actor: { kind: 'scheduler' }, operation: 'reconcile' },
    ]);
  });

  it('가정이 없으면 트랜잭션을 열지 않는다', async () => {
    const writer = new RecordingWriter();

    const outcomes = await new ReconcileService(writer, directory()).runEveryHousehold();

    expect(outcomes).toEqual([]);
    expect(writer.requests).toEqual([]);
  });
});
