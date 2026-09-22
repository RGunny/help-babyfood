import { McpServer } from '@modelcontextprotocol/server';
import { AlertSettingsService } from '../application/alert-settings.service.js';
import { ForecastService } from '../application/forecast.service.js';
import { IngredientService } from '../application/ingredient.service.js';
import { MealPlanImportService } from '../application/meal-plan-import.service.js';
import { MealPlanService } from '../application/meal-plan.service.js';
import { MealSlotService } from '../application/meal-slot.service.js';
import { MenuService } from '../application/menu.service.js';
import { NoFeedService } from '../application/no-feed.service.js';
import { HouseholdReader } from '../application/ports/household-write.port.js';
import { ReactionService } from '../application/reaction.service.js';
import { RulesService } from '../application/rules.service.js';
import { StockService } from '../application/stock.service.js';
import { Caller } from './auth/caller.js';
import { registerStockTools } from './tools/stock.tools.js';

const SERVER_NAME = 'help-babyfood';
const SERVER_VERSION = '0.1.0';

/**
 * What the tool layer is allowed to reach: the use cases, plus the reader for turning ids back
 * into the names a parent uses. No repository and no Prisma client — a tool that could query the
 * database directly would start growing a second copy of the stock rules.
 */
export interface ToolDeps {
  readonly reader: HouseholdReader;
  readonly stock: StockService;
  readonly mealPlan: MealPlanService;
  readonly mealPlanImport: MealPlanImportService;
  readonly mealSlot: MealSlotService;
  readonly noFeed: NoFeedService;
  readonly rules: RulesService;
  readonly reaction: ReactionService;
  readonly forecast: ForecastService;
  readonly alertSettings: AlertSettingsService;
  readonly ingredient: IngredientService;
  readonly menu: MenuService;
}

/**
 * Builds the server for one request, around one caller.
 *
 * The caller is closed over rather than passed per call, so no tool can be written that takes a
 * household or a member from its arguments.
 */
export function buildServer(deps: ToolDeps, caller: Caller): McpServer {
  const server = new McpServer({ name: SERVER_NAME, version: SERVER_VERSION });
  registerStockTools(server, deps, caller);
  return server;
}
