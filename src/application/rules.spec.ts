import { DomainError } from '../domain/errors.js';
import { Ingredient } from '../domain/ingredient/ingredient.js';
import { IngredientCatalog } from '../domain/ingredient/ingredient-catalog.js';
import { ApplicationError } from './errors.js';
import { normalizePairings } from './rules.service.js';

const INGREDIENTS: Ingredient[] = [
  { id: 'aaa', name: '소고기', aliases: [], category: 'meat', servingWeightGram: 10 },
  { id: 'bbb', name: '고구마', aliases: ['고구메'], category: 'vegetable', servingWeightGram: 15 },
];

const catalog = new IngredientCatalog(INGREDIENTS);

describe('금지 조합 정규화', () => {
  it('두 재료를 id 순서로 정렬해 저장할 값을 만든다', () => {
    expect(normalizePairings(catalog, [{ ingredientNames: ['고구마', '소고기'], scope: 'same_day' }])).toEqual([
      { ingredientIds: ['aaa', 'bbb'], scope: 'same_day' },
    ]);
  });

  it('순서만 다른 같은 조합은 한 건으로 합친다', () => {
    const pairings = normalizePairings(catalog, [
      { ingredientNames: ['소고기', '고구마'], scope: 'same_meal' },
      { ingredientNames: ['고구마', '소고기'], scope: 'same_meal' },
    ]);
    expect(pairings).toHaveLength(1);
  });

  it('범위가 다르면 별개의 조합이다', () => {
    const pairings = normalizePairings(catalog, [
      { ingredientNames: ['소고기', '고구마'], scope: 'same_meal' },
      { ingredientNames: ['소고기', '고구마'], scope: 'same_day' },
    ]);
    expect(pairings.map((pairing) => pairing.scope)).toEqual(['same_meal', 'same_day']);
  });

  it('별칭으로 써도 같은 재료를 가리킨다', () => {
    expect(normalizePairings(catalog, [{ ingredientNames: ['소고기', '고구메'], scope: 'same_day' }])).toEqual([
      { ingredientIds: ['aaa', 'bbb'], scope: 'same_day' },
    ]);
  });

  it('등록되지 않은 재료명은 거부한다', () => {
    expect(() =>
      normalizePairings(catalog, [{ ingredientNames: ['소고기', '파프리카'], scope: 'same_day' }]),
    ).toThrow(DomainError);
  });

  it('같은 재료끼리의 조합은 거부한다', () => {
    expect(() =>
      normalizePairings(catalog, [{ ingredientNames: ['소고기', '소고기'], scope: 'same_day' }]),
    ).toThrow(ApplicationError);
  });
});
