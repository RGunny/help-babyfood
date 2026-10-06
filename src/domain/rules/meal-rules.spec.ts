import { Ingredient } from '../ingredient/ingredient.js';
import { IngredientCatalog } from '../ingredient/ingredient-catalog.js';
import { projectCalendar } from '../meal-plan/calendar-projection.js';
import { Meal } from '../meal-plan/meal.js';
import { MealCalendar, NoFeedRecord, SlotSchedule } from '../meal-plan/meal-calendar.js';
import { Menu } from '../menu/menu.js';
import { localDate } from '../shared/local-date.js';
import { localTime } from '../shared/local-time.js';
import { MealSlot } from '../shared/meal-slot.js';
import { MealPlanningRules, validateMealPlan } from './meal-rules.js';

const morning: SlotSchedule = { slot: 'morning', startDate: localDate('2026-08-17'), mealTime: localTime('10:00') };
const afternoon: SlotSchedule = { slot: 'afternoon', startDate: localDate('2026-08-17'), mealTime: localTime('17:00') };
const menus = new Map<string, Menu>([
  ['rice-porridge', { id: 'rice-porridge', name: '쌀죽', components: [{ ingredientId: 'rice', cubes: 1 }] }],
  [
    'rice-brown-rice-porridge',
    { id: 'rice-brown-rice-porridge', name: '쌀현미죽', components: [{ ingredientId: 'rice-brown-rice', cubes: 1 }] },
  ],
]);
const ingredient = (id: string, constituentIngredientIds: string[] = []): Ingredient => ({
  id,
  name: id,
  aliases: [],
  category: 'vegetable',
  servingWeightGram: 15,
  stockTracking: 'cubes',
  constituentIngredientIds,
});
const catalog = new IngredientCatalog([
  ...[
    'rice',
    'brown-rice',
    'beef',
    'broccoli',
    'sweet-potato',
    'peanut-butter',
    'peas',
    'egg',
    'zucchini',
    'pumpkin',
  ].map((id) => ingredient(id)),
  ingredient('rice-brown-rice', ['rice', 'brown-rice']),
]);
const rules: MealPlanningRules = {
  forbiddenPairings: [{ ingredientIds: ['beef', 'sweet-potato'], scope: 'same_meal' }],
  maxFirstIntroductionsPerDay: 1,
  firstIntroductionSlot: 'morning',
};

const meal = (slot: MealSlot, order: number, toppings: string[], status: Meal['status'] = 'planned'): Meal => ({
  id: `${slot}-${order}`,
  slot,
  order,
  planned: { baseMenuId: 'rice-porridge', toppingIngredientIds: toppings },
  actual: null,
  memo: null,
  status,
  migrated: false,
});
const blendMeal = (slot: MealSlot, order: number, toppings: string[] = []): Meal => ({
  ...meal(slot, order, toppings),
  planned: { baseMenuId: 'rice-brown-rice-porridge', toppingIngredientIds: toppings },
});

const validate = (
  meals: Meal[],
  options: { noFeeds?: NoFeedRecord[]; alreadyFed?: string[]; reacted?: string[]; rules?: MealPlanningRules } = {},
) => {
  const calendar = new MealCalendar([morning, afternoon], options.noFeeds ?? []);
  return validateMealPlan({
    days: projectCalendar(meals, calendar, localDate('2026-08-17'), localDate('2026-08-23')),
    menus,
    catalog,
    rules: options.rules ?? rules,
    alreadyFedIngredientIds: new Set(options.alreadyFed ?? ['rice']),
    reactedIngredientIds: new Set(options.reacted ?? []),
  });
};

describe('식단 제약 검증', () => {
  it('식단이 없으면 경고도 없다', () => {
    expect(validate([])).toEqual([]);
  });

  it('하루에 새 재료가 하나씩이고 오전에 도입하면 경고가 없다', () => {
    const meals = [
      meal('morning', 1, ['beef']),
      meal('afternoon', 1, ['beef']),
      meal('morning', 2, ['beef', 'broccoli']),
      meal('afternoon', 2, ['beef', 'broccoli']),
    ];

    expect(validate(meals)).toEqual([]);
  });

  it('같은 날 처음 먹는 재료가 둘이면 경고한다', () => {
    const meals = [meal('morning', 1, ['beef', 'broccoli'])];

    expect(validate(meals)).toEqual([
      { code: 'TOO_MANY_FIRST_INTRODUCTIONS', date: '2026-08-17', slot: null, ingredientIds: ['beef', 'broccoli'] },
    ]);
  });

  it('처음 먹는 재료 하나와 2회차 재료가 같은 날인 것은 허용한다 (기존 식단표 33일차의 완두콩과 땅콩버터)', () => {
    const meals = [meal('morning', 1, ['peanut-butter']), meal('morning', 2, ['peas', 'peanut-butter'])];

    expect(validate(meals)).toEqual([]);
  });

  it('새 재료를 오후에 처음 도입하면 경고한다', () => {
    const meals = [meal('morning', 1, []), meal('afternoon', 1, ['beef'])];

    expect(validate(meals)).toEqual([
      { code: 'FIRST_INTRODUCTION_IN_WRONG_SLOT', date: '2026-08-17', slot: 'afternoon', ingredientIds: ['beef'] },
    ]);
  });

  it('오전에 도입한 재료를 같은 날 오후에 또 먹이는 것은 첫 도입이 아니다', () => {
    const meals = [meal('morning', 1, ['beef']), meal('afternoon', 1, ['beef'])];

    expect(validate(meals)).toEqual([]);
  });

  it('소고기와 고구마가 한 식단에 있으면 경고한다', () => {
    const meals = [meal('morning', 1, ['beef', 'sweet-potato'])];

    expect(validate(meals, { alreadyFed: ['rice', 'beef', 'sweet-potato'] })).toEqual([
      { code: 'FORBIDDEN_PAIRING', date: '2026-08-17', slot: 'morning', ingredientIds: ['beef', 'sweet-potato'] },
    ]);
  });

  it('한 식단 기준의 조합 금지는 오전과 오후로 나뉘어 있으면 경고하지 않는다', () => {
    const meals = [meal('morning', 1, ['beef']), meal('afternoon', 1, ['sweet-potato'])];

    expect(validate(meals, { alreadyFed: ['rice', 'beef', 'sweet-potato'] })).toEqual([]);
  });

  it('하루 기준의 조합 금지는 오전과 오후로 나뉘어 있어도 경고한다', () => {
    const sameDayRules: MealPlanningRules = {
      ...rules,
      forbiddenPairings: [{ ingredientIds: ['beef', 'sweet-potato'], scope: 'same_day' }],
    };
    const meals = [meal('morning', 1, ['beef'], 'consumed'), meal('afternoon', 1, ['sweet-potato'])];

    expect(validate(meals, { alreadyFed: ['rice', 'beef', 'sweet-potato'], rules: sameDayRules })).toEqual([
      { code: 'FORBIDDEN_PAIRING', date: '2026-08-17', slot: null, ingredientIds: ['beef', 'sweet-potato'] },
    ]);
  });

  it('반응이 있었던 재료가 예정 식단에 있으면 경고한다', () => {
    const meals = [meal('morning', 1, ['egg'])];

    expect(validate(meals, { alreadyFed: ['rice', 'egg'], reacted: ['egg'] })).toEqual([
      { code: 'REACTED_INGREDIENT_PLANNED', date: '2026-08-17', slot: 'morning', ingredientIds: ['egg'] },
    ]);
  });

  it('이미 먹인 식단은 경고하지 않지만 도입 이력에는 반영한다', () => {
    const meals = [meal('morning', 1, ['beef', 'broccoli'], 'consumed'), meal('morning', 2, ['beef', 'broccoli'])];

    expect(validate(meals)).toEqual([]);
  });

  it('제약을 꺼 두면 검사하지 않는다', () => {
    const noRules: MealPlanningRules = {
      forbiddenPairings: [],
      maxFirstIntroductionsPerDay: null,
      firstIntroductionSlot: null,
    };
    const meals = [meal('morning', 1, []), meal('afternoon', 1, ['beef', 'broccoli', 'sweet-potato'])];

    expect(validate(meals, { rules: noRules })).toEqual([]);
  });
});

describe('합침 재료가 든 식단의 검증', () => {
  it('합침 재료에 처음 먹는 구성 재료가 있으면 그 구성 재료가 첫 도입이다', () => {
    const meals = [meal('morning', 1, []), blendMeal('afternoon', 1)];

    expect(validate(meals)).toEqual([
      {
        code: 'FIRST_INTRODUCTION_IN_WRONG_SLOT',
        date: '2026-08-17',
        slot: 'afternoon',
        ingredientIds: ['brown-rice'],
      },
    ]);
  });

  it('구성 재료를 모두 먹인 적이 있는 합침 재료는 첫 도입이 아니다', () => {
    const meals = [meal('morning', 1, []), blendMeal('afternoon', 1)];

    expect(validate(meals, { alreadyFed: ['rice', 'brown-rice'] })).toEqual([]);
  });

  it('반응 있었던 재료가 합침 재료의 구성에 있으면 경고한다', () => {
    const meals = [blendMeal('morning', 1)];

    expect(validate(meals, { alreadyFed: ['rice', 'brown-rice'], reacted: ['brown-rice'] })).toEqual([
      { code: 'REACTED_INGREDIENT_PLANNED', date: '2026-08-17', slot: 'morning', ingredientIds: ['brown-rice'] },
    ]);
  });

  it('금지 조합은 합침 재료의 구성 재료에도 걸린다', () => {
    const blendRules: MealPlanningRules = {
      ...rules,
      forbiddenPairings: [
        { ingredientIds: ['brown-rice', 'beef'], scope: 'same_meal' },
        { ingredientIds: ['brown-rice', 'sweet-potato'], scope: 'same_day' },
      ],
    };
    const meals = [blendMeal('morning', 1, ['beef']), meal('afternoon', 1, ['sweet-potato'])];

    expect(validate(meals, { alreadyFed: ['rice', 'brown-rice', 'beef', 'sweet-potato'], rules: blendRules })).toEqual([
      { code: 'FORBIDDEN_PAIRING', date: '2026-08-17', slot: 'morning', ingredientIds: ['brown-rice', 'beef'] },
      { code: 'FORBIDDEN_PAIRING', date: '2026-08-17', slot: null, ingredientIds: ['brown-rice', 'sweet-potato'] },
    ]);
  });
});

describe('미룸 뒤의 재검증', () => {
  // 2일차 오전에 브로콜리, 3일차 오전에 애호박을 도입하고 오후는 하루 늦게 따라가는 식단.
  const meals = [
    meal('morning', 1, ['beef']),
    meal('afternoon', 1, ['beef']),
    meal('morning', 2, ['beef', 'broccoli']),
    meal('afternoon', 2, ['beef']),
    meal('morning', 3, ['beef', 'zucchini']),
    meal('afternoon', 3, ['beef', 'broccoli']),
  ];

  it('밀리기 전에는 경고가 없다', () => {
    expect(validate(meals)).toEqual([]);
  });

  it('오전만 밀리면 브로콜리를 오후에 처음 먹이게 되어 경고한다', () => {
    const noFeeds: NoFeedRecord[] = [
      { date: localDate('2026-08-18'), slot: 'morning', thawed: false, reason: null },
      { date: localDate('2026-08-19'), slot: 'morning', thawed: false, reason: null },
    ];

    expect(validate(meals, { noFeeds })).toContainEqual({
      code: 'FIRST_INTRODUCTION_IN_WRONG_SLOT',
      date: '2026-08-19',
      slot: 'afternoon',
      ingredientIds: ['broccoli'],
    });
  });

  it('오후만 밀려 원래 다른 날이던 식단이 같은 날에 놓이면 하루 기준 조합 금지에 걸린다', () => {
    const sameDayRules: MealPlanningRules = {
      ...rules,
      forbiddenPairings: [{ ingredientIds: ['zucchini', 'pumpkin'], scope: 'same_day' }],
    };
    const shiftedMeals = [
      meal('morning', 1, ['beef']),
      meal('afternoon', 1, ['beef']),
      meal('morning', 2, ['beef', 'zucchini']),
      meal('afternoon', 2, ['beef']),
      meal('morning', 3, ['beef']),
      meal('afternoon', 3, ['beef', 'pumpkin']),
      meal('morning', 4, ['beef', 'zucchini']),
    ];
    const alreadyFed = ['rice', 'beef', 'zucchini', 'pumpkin'];
    const noFeeds: NoFeedRecord[] = [{ date: localDate('2026-08-17'), slot: 'afternoon', thawed: false, reason: null }];

    expect(validate(shiftedMeals, { alreadyFed, rules: sameDayRules })).toEqual([]);
    expect(validate(shiftedMeals, { alreadyFed, rules: sameDayRules, noFeeds })).toEqual([
      { code: 'FORBIDDEN_PAIRING', date: '2026-08-20', slot: null, ingredientIds: ['zucchini', 'pumpkin'] },
    ]);
  });
});
