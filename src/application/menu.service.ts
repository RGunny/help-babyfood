import { DomainError } from '../domain/errors.js';
import { CubeNeed } from '../domain/ingredient/ingredient.js';
import { IngredientCatalog } from '../domain/ingredient/ingredient-catalog.js';
import { Menu } from '../domain/menu/menu.js';
import { ApplicationError } from './errors.js';
import { Actor, HouseholdReader, HouseholdWriter } from './ports/household-write.port.js';

/** One line of a menu as a parent says it: "쌀 1개". */
export interface MenuComponentInput {
  readonly ingredientName: string;
  readonly cubes: number;
}

export interface RegisterMenuCommand {
  readonly householdId: string;
  readonly actor: Actor;
  readonly idempotencyKey?: string;
  readonly name: string;
  readonly components: readonly MenuComponentInput[];
}

export interface UpdateMenuCommand extends RegisterMenuCommand {
  /** The menu to change, named as it is stored now. */
  readonly currentName: string;
}

/**
 * Base menus such as "쌀오트밀죽". A meal points at one, and deduction expands it into cubes, so a
 * menu is the only place where "one bowl" turns into a number of cubes per ingredient.
 */
export class MenuService {
  constructor(
    private readonly writer: HouseholdWriter,
    private readonly reader: HouseholdReader,
  ) {}

  async register(command: RegisterMenuCommand): Promise<Menu> {
    return await this.writer.write(
      {
        householdId: command.householdId,
        actor: command.actor,
        operation: 'register_menu',
        idempotencyKey: command.idempotencyKey,
        payload: { name: command.name, components: command.components },
      },
      async (context) => {
        const state = await context.load();
        requireNameFree(state.menus, command.name);
        return await context.insertMenu({
          name: command.name,
          components: resolveComponents(state.catalog, command.components),
        });
      },
    );
  }

  async update(command: UpdateMenuCommand): Promise<Menu> {
    return await this.writer.write(
      {
        householdId: command.householdId,
        actor: command.actor,
        operation: 'update_menu',
        idempotencyKey: command.idempotencyKey,
        payload: { currentName: command.currentName, name: command.name, components: command.components },
      },
      async (context) => {
        const state = await context.load();
        const menu = requireMenu(state.menus, command.currentName);
        if (command.name !== menu.name) requireNameFree(state.menus, command.name);
        return await context.updateMenu({
          id: menu.id,
          name: command.name,
          components: resolveComponents(state.catalog, command.components),
        });
      },
    );
  }

  async getMenus(householdId: string): Promise<Menu[]> {
    return await this.reader.read(householdId, (state) => [...state.menus.values()]);
  }
}

function requireMenu(menus: ReadonlyMap<string, Menu>, name: string): Menu {
  const menu = [...menus.values()].find((candidate) => candidate.name === name);
  if (menu === undefined) {
    throw new DomainError('UNKNOWN_MENU', `등록되지 않은 메뉴입니다: ${name}`);
  }
  return menu;
}

function requireNameFree(menus: ReadonlyMap<string, Menu>, name: string): void {
  if ([...menus.values()].some((menu) => menu.name === name)) {
    throw new ApplicationError('MENU_NAME_TAKEN', `이미 있는 메뉴 이름입니다: ${name}`);
  }
}

/**
 * Names come from the parent, so unknown ones are rejected here rather than at deduction time.
 * An ingredient listed twice is merged, which is what `expandToCubeNeeds` does with the result.
 */
function resolveComponents(
  catalog: IngredientCatalog,
  inputs: readonly MenuComponentInput[],
): CubeNeed[] {
  const cubesByIngredient = new Map<string, number>();
  for (const input of inputs) {
    const ingredient = catalog.findByName(input.ingredientName);
    if (ingredient === null) {
      throw new DomainError('UNKNOWN_INGREDIENT', `등록되지 않은 재료입니다: ${input.ingredientName}`);
    }
    if (!Number.isInteger(input.cubes) || input.cubes <= 0) {
      throw new ApplicationError('INVALID_CUBE_COUNT', `큐브 수는 1 이상의 정수여야 합니다: ${input.cubes}`);
    }
    cubesByIngredient.set(ingredient.id, (cubesByIngredient.get(ingredient.id) ?? 0) + input.cubes);
  }
  return [...cubesByIngredient].map(([ingredientId, cubes]) => ({ ingredientId, cubes }));
}
