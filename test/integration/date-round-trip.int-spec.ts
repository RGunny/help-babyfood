import { localDate } from '../../src/domain/shared/local-date.js';
import { fromLocalDate, toLocalDate } from '../../src/infrastructure/prisma/mappers/local-date.mapper.js';
import { PrismaClient } from '../../src/generated/prisma/client.js';
import { createPrismaClient } from './setup/database.js';

// 날짜가 하루 밀리는 버그는 재고 차감 전체를 조용히 틀어 놓는다. 프로세스 시간대를 서울에서
// 멀리 떨어뜨린 채로 DATE 칼럼을 왕복시켜 고정한다.
const prisma: PrismaClient = createPrismaClient();
let originalTz: string | undefined;

beforeAll(() => {
  originalTz = process.env['TZ'];
  process.env['TZ'] = 'America/Los_Angeles';
});

afterAll(async () => {
  process.env['TZ'] = originalTz;
  await prisma.$disconnect();
});

const householdId = async () => (await prisma.household.create({ data: { name: '재하네' } })).id;

describe('DATE 칼럼 왕복', () => {
  it.each(['2026-01-01', '2026-02-28', '2026-08-17', '2026-09-20', '2026-12-31'])(
    '조리일 %s은 저장했다 읽어도 같은 날짜다',
    async (value) => {
      const household = await householdId();
      const ingredient = await prisma.ingredient.create({
        data: { householdId: household, name: '브로콜리', category: 'vegetable', servingWeightGram: 15, stockTracking: 'cubes' },
      });
      const created = await prisma.cookedBatch.create({
        data: {
          householdId: household,
          ingredientId: ingredient.id,
          cubeWeightGram: 15,
          cookedOn: fromLocalDate(localDate(value)),
        },
      });
      const loaded = await prisma.cookedBatch.findUniqueOrThrow({ where: { id: created.id } });
      expect(toLocalDate(loaded.cookedOn)).toBe(localDate(value));
    },
  );

  it('끼니 시작일과 미급여 날짜도 같은 규칙으로 왕복한다', async () => {
    const household = await householdId();
    await prisma.slotSchedule.create({
      data: {
        householdId: household,
        slot: 'morning',
        startDate: fromLocalDate(localDate('2026-08-17')),
        mealTime: '10:00',
      },
    });
    await prisma.noFeedRecord.create({
      data: { householdId: household, date: fromLocalDate(localDate('2026-08-20')), slot: 'morning', thawed: false },
    });

    const schedule = await prisma.slotSchedule.findFirstOrThrow({ where: { householdId: household } });
    const noFeed = await prisma.noFeedRecord.findFirstOrThrow({ where: { householdId: household } });
    expect(toLocalDate(schedule.startDate)).toBe(localDate('2026-08-17'));
    expect(toLocalDate(noFeed.date)).toBe(localDate('2026-08-20'));
  });

  it('DB가 보는 날짜 문자열도 같다', async () => {
    const household = await householdId();
    await prisma.slotSchedule.create({
      data: {
        householdId: household,
        slot: 'morning',
        startDate: fromLocalDate(localDate('2026-08-17')),
        mealTime: '10:00',
      },
    });
    const [row] = await prisma.$queryRaw<{ text: string }[]>`
      SELECT to_char(start_date, 'YYYY-MM-DD') AS text FROM slot_schedule WHERE household_id = ${household}::uuid
    `;
    expect(row.text).toBe('2026-08-17');
  });

  it('미급여 날짜로 조회할 때도 같은 값으로 찾는다', async () => {
    const household = await householdId();
    await prisma.noFeedRecord.create({
      data: { householdId: household, date: fromLocalDate(localDate('2026-08-20')), slot: 'morning', thawed: true },
    });
    const found = await prisma.noFeedRecord.findUnique({
      where: {
        householdId_date_slot: {
          householdId: household,
          date: fromLocalDate(localDate('2026-08-20')),
          slot: 'morning',
        },
      },
    });
    expect(found?.thawed).toBe(true);
  });
});
