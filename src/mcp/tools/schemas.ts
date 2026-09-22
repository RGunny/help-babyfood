import * as z from 'zod/v4';
import { LocalDate, localDate } from '../../domain/shared/local-date.js';
import { LocalTime, localTime } from '../../domain/shared/local-time.js';

/**
 * The key that makes a retry a retry.
 *
 * Every tool that changes stock or the plan takes one, and it is the caller's to choose: a key the
 * server generated would be new on every attempt, which is the opposite of what it is for. An LLM
 * does retry the same call, and a registration counted twice puts the whole freezer out.
 */
export const idempotencyKey = z
  .string()
  .min(1)
  .max(200)
  .describe('Caller-chosen key. Repeating a call with the same key returns the first result.');

export const dateString = z
  .string()
  .transform((value, ctx): LocalDate => {
    try {
      return localDate(value);
    } catch {
      ctx.addIssue({ code: 'custom', message: `날짜는 YYYY-MM-DD 형식입니다: ${value}` });
      return z.NEVER;
    }
  })
  .describe('Asia/Seoul calendar date, YYYY-MM-DD.');

export const timeString = z
  .string()
  .transform((value, ctx): LocalTime => {
    try {
      return localTime(value);
    } catch {
      ctx.addIssue({ code: 'custom', message: `시각은 HH:mm 형식입니다: ${value}` });
      return z.NEVER;
    }
  })
  .describe('Asia/Seoul wall-clock time, HH:mm.');

export const mealSlot = z.enum(['morning', 'afternoon']).describe('오전(morning) 또는 오후(afternoon).');

export const ingredientCategory = z.enum(['base', 'meat', 'vegetable', 'high_risk_allergen']);

export const positiveCubes = z.number().int().positive();

/** What a parent says a meal is made of. Names, never ids: the server resolves them. */
export const composition = z.object({
  baseMenuName: z.string().nullable().describe('베이스 메뉴 이름. 토핑만 있는 식단이면 null.'),
  toppingIngredientNames: z.array(z.string()).describe('토핑 재료 이름. 재료마다 큐브 1개다.'),
});
