import { DomainError } from '../errors.js';
import { Ingredient, isBlend } from './ingredient.js';
import { IngredientCatalog } from './ingredient-catalog.js';
import { IngredientFeeding, introductionStatus, needsObservation, nextExposureNumber } from './introduction-status.js';

const broccoli: Ingredient = {
  id: 'broccoli',
  name: '브로콜리',
  aliases: ['브로컬리'],
  category: 'vegetable',
  servingWeightGram: 15,
  stockTracking: 'cubes',
  constituentIngredientIds: [],
};
const beef: Ingredient = {
  id: 'beef',
  name: '소고기',
  aliases: ['한우', 'Beef'],
  category: 'meat',
  servingWeightGram: 10,
  stockTracking: 'cubes',
  constituentIngredientIds: [],
};

describe('IngredientCatalog', () => {
  const catalog = new IngredientCatalog([broccoli, beef]);

  it('이름으로 재료를 찾는다', () => {
    expect(catalog.findByName('브로콜리')).toBe(broccoli);
  });

  it('별칭 "브로컬리"는 브로콜리와 같은 재료다', () => {
    expect(catalog.findByName('브로컬리')).toBe(broccoli);
  });

  it('공백과 대소문자 차이를 무시한다', () => {
    expect(catalog.findByName(' 소 고기 ')).toBe(beef);
    expect(catalog.findByName('beef')).toBe(beef);
  });

  it('등록되지 않은 이름은 null이다', () => {
    expect(catalog.findByName('고구마')).toBeNull();
  });

  it('미등록 재료명만 중복 없이 골라낸다', () => {
    expect(catalog.findUnknownNames(['소고기', '고구마', '브로컬리', '고구마', '오이'])).toEqual(['고구마', '오이']);
  });

  it('id로 찾을 때 없는 재료는 오류다', () => {
    expect(catalog.getById('beef')).toBe(beef);
    expect(() => catalog.getById('sweet-potato')).toThrow(DomainError);
  });

  it('다른 재료의 이름이나 별칭과 겹치면 등록을 거부한다', () => {
    const duplicate: Ingredient = { ...beef, id: 'another', name: '쇠고기', aliases: ['한우'] };

    expect(() => new IngredientCatalog([beef, duplicate])).toThrow(DomainError);
  });

  it('같은 재료 안에서 이름과 별칭이 같은 것은 허용한다', () => {
    const redundant: Ingredient = { ...broccoli, aliases: ['브로콜리'] };

    expect(new IngredientCatalog([redundant]).findByName('브로콜리')).toBe(redundant);
  });
});

describe('합침 재료', () => {
  const base = (id: string, name: string, constituentIngredientIds: string[] = []): Ingredient => ({
    id,
    name,
    aliases: [],
    category: 'base',
    servingWeightGram: 30,
    stockTracking: 'cubes',
    constituentIngredientIds,
  });
  const rice = base('rice', '쌀');
  const oatmeal = base('oatmeal', '오트밀');
  const riceOatmeal = base('rice-oatmeal', '쌀오트밀', ['rice', 'oatmeal']);
  const invalidBlend = (ingredients: Ingredient[]) => {
    try {
      new IngredientCatalog(ingredients);
    } catch (error) {
      return error instanceof DomainError ? error.code : error;
    }
    return null;
  };

  it('합침 재료는 구성 재료가 둘 이상이어야 한다', () => {
    expect(invalidBlend([rice, base('rice-only', '쌀만', ['rice'])])).toBe('INVALID_BLEND');
    expect(invalidBlend([rice, oatmeal, riceOatmeal])).toBeNull();
  });

  it('구성 재료에 같은 재료를 두 번 넣을 수 없다', () => {
    expect(invalidBlend([rice, base('double-rice', '쌀쌀', ['rice', 'rice'])])).toBe('INVALID_BLEND');
  });

  it('합침 재료는 자기 자신을 구성 재료로 가질 수 없다', () => {
    expect(() => new IngredientCatalog([rice, base('rice-self', '쌀자신', ['rice', 'rice-self'])])).toThrow(
      '자기 자신',
    );
  });

  it('등록되지 않은 재료는 구성 재료가 될 수 없다', () => {
    expect(invalidBlend([rice, riceOatmeal])).toBe('INVALID_BLEND');
  });

  it('구성 재료는 합침 재료보다 뒤에 놓여 있어도 등록된 재료다', () => {
    expect(invalidBlend([riceOatmeal, oatmeal, rice])).toBeNull();
  });

  it('합침 재료는 다른 합침 재료의 구성 재료가 될 수 없다', () => {
    const nested = base('rice-oatmeal-beef', '쌀오트밀소고기', ['rice-oatmeal', 'beef']);

    expect(invalidBlend([rice, oatmeal, beef, riceOatmeal, nested])).toBe('INVALID_BLEND');
    expect(invalidBlend([nested, riceOatmeal, beef, oatmeal, rice])).toBe('INVALID_BLEND');
  });

  it('합침 재료가 먹인 재료는 구성 재료이고 일반 재료는 자기 자신이다', () => {
    const catalog = new IngredientCatalog([rice, oatmeal, riceOatmeal]);

    expect(isBlend(riceOatmeal)).toBe(true);
    expect(isBlend(rice)).toBe(false);
    expect(catalog.eatenIngredientIds('rice-oatmeal')).toEqual(['rice', 'oatmeal']);
    expect(catalog.eatenIngredientIds('rice')).toEqual(['rice']);
    expect(() => catalog.eatenIngredientIds('brown-rice')).toThrow(DomainError);
  });
});

describe('알러지 도입 상태', () => {
  const clear: IngredientFeeding = { reaction: 'clear' };
  const unrecorded: IngredientFeeding = { reaction: null };
  const reacted: IngredientFeeding = { reaction: 'reacted' };
  const status = (feedings: IngredientFeeding[], verifiedBeforeMigration = false) =>
    introductionStatus({ feedings, verifiedBeforeMigration });

  it('먹인 적이 없으면 미도입이다', () => {
    expect(status([])).toEqual({ kind: 'not_introduced' });
  });

  it('첫 급여 후 반응을 기록하기 전에는 검증중이고 이상 없음 0회다', () => {
    expect(status([unrecorded])).toEqual({ kind: 'verifying', clearCount: 0, unrecordedCount: 1 });
  });

  it('이상 없음 1회면 아직 검증중이다', () => {
    expect(status([clear])).toEqual({ kind: 'verifying', clearCount: 1, unrecordedCount: 0 });
  });

  it('이상 없음 2회면 검증완료다', () => {
    expect(status([clear, clear])).toEqual({ kind: 'verified' });
  });

  it('반응을 기록하지 않은 급여는 횟수에 세지 않는다', () => {
    expect(status([clear, unrecorded, unrecorded])).toEqual({
      kind: 'verifying',
      clearCount: 1,
      unrecordedCount: 2,
    });
  });

  it('한 번이라도 반응이 있었으면 이후 이상 없음이 쌓여도 반응있음이다', () => {
    expect(status([clear, reacted, clear, clear])).toEqual({ kind: 'reacted' });
  });

  it('이관 때 검증된 재료로 등록했으면 급여 이력이 없어도 검증완료다', () => {
    expect(status([], true)).toEqual({ kind: 'verified' });
  });

  it('이관 때 검증된 재료로 등록했어도 이후 반응이 있으면 반응있음이다', () => {
    expect(status([reacted], true)).toEqual({ kind: 'reacted' });
  });

  it('미도입과 검증중인 재료만 급여 후 관찰이 필요하다', () => {
    expect(needsObservation(status([]))).toBe(true);
    expect(needsObservation(status([clear]))).toBe(true);
    expect(needsObservation(status([clear, clear]))).toBe(false);
    expect(needsObservation(status([reacted]))).toBe(false);
  });

  it('브리프의 회차는 이상 없음 횟수에 1을 더한 값이다', () => {
    expect(nextExposureNumber(status([]))).toBe(1);
    expect(nextExposureNumber(status([unrecorded]))).toBe(1);
    expect(nextExposureNumber(status([clear]))).toBe(2);
    expect(nextExposureNumber(status([clear, clear]))).toBeNull();
    expect(nextExposureNumber(status([reacted]))).toBeNull();
  });
});
