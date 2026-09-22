import { HouseholdReader } from '../application/ports/household-write.port.js';

/**
 * Ids to the names a parent uses.
 *
 * Services answer in ids, because that is what the domain stores, but parents and the agent speak
 * in "브로콜리". Turning one into the other is presentation, not a rule, so it lives here rather
 * than inside a use case. Inputs need no such step: they arrive as names and the application
 * resolves them, rejecting the ones the master does not have.
 */
export interface NameDirectory {
  ingredient(ingredientId: string): string;
  menu(menuId: string): string;
}

export async function loadNameDirectory(
  reader: HouseholdReader,
  householdId: string,
): Promise<NameDirectory> {
  return await reader.read(householdId, (state) => {
    const ingredients = new Map(state.ingredients.map((item) => [item.id, item.name]));
    const menus = new Map([...state.menus.values()].map((menu) => [menu.id, menu.name]));
    return {
      // 이름을 못 찾으면 id를 그대로 보인다. 조회 하나가 비었다고 응답 전체를 버리지 않는다.
      ingredient: (id) => ingredients.get(id) ?? id,
      menu: (id) => menus.get(id) ?? id,
    };
  });
}
