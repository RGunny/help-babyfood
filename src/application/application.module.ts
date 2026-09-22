import { Module, Provider } from '@nestjs/common';
import { PersistenceModule } from '../infrastructure/prisma/persistence.module.js';
import { AlertSettingsService } from './alert-settings.service.js';
import { ForecastService } from './forecast.service.js';
import { IngredientService } from './ingredient.service.js';
import { MealPlanService } from './meal-plan.service.js';
import { MealSlotService } from './meal-slot.service.js';
import { MenuService } from './menu.service.js';
import { NoFeedService } from './no-feed.service.js';
import { ClockPort } from './ports/clock.port.js';
import { FeedingHistoryPort } from './ports/feeding-history.port.js';
import { HouseholdReader, HouseholdWriter } from './ports/household-write.port.js';
import { CLOCK, FEEDING_HISTORY, HOUSEHOLD_READER, HOUSEHOLD_WRITER } from './ports/tokens.js';
import { ReactionService } from './reaction.service.js';
import { ReconcileService } from './reconcile.service.js';
import { RulesService } from './rules.service.js';
import { StockService } from './stock.service.js';

// 서비스에는 데코레이터를 달지 않는다. 생성자에 포트를 받는 평범한 클래스로 두고 여기서 조립하면,
// 애플리케이션 계층이 Nest를 모르는 상태로 남고 테스트는 new로 같은 조립을 할 수 있다.
const providers: Provider[] = [
  {
    provide: StockService,
    useFactory: (writer: HouseholdWriter, reader: HouseholdReader, clock: ClockPort) =>
      new StockService(writer, reader, clock),
    inject: [HOUSEHOLD_WRITER, HOUSEHOLD_READER, CLOCK],
  },
  {
    provide: ReconcileService,
    useFactory: (writer: HouseholdWriter) => new ReconcileService(writer),
    inject: [HOUSEHOLD_WRITER],
  },
  {
    provide: NoFeedService,
    useFactory: (writer: HouseholdWriter) => new NoFeedService(writer),
    inject: [HOUSEHOLD_WRITER],
  },
  {
    provide: MealPlanService,
    useFactory: (writer: HouseholdWriter, reader: HouseholdReader, history: FeedingHistoryPort) =>
      new MealPlanService(writer, reader, history),
    inject: [HOUSEHOLD_WRITER, HOUSEHOLD_READER, FEEDING_HISTORY],
  },
  {
    provide: IngredientService,
    useFactory: (writer: HouseholdWriter) => new IngredientService(writer),
    inject: [HOUSEHOLD_WRITER],
  },
  {
    provide: MenuService,
    useFactory: (writer: HouseholdWriter, reader: HouseholdReader) => new MenuService(writer, reader),
    inject: [HOUSEHOLD_WRITER, HOUSEHOLD_READER],
  },
  {
    provide: MealSlotService,
    useFactory: (writer: HouseholdWriter, reader: HouseholdReader) => new MealSlotService(writer, reader),
    inject: [HOUSEHOLD_WRITER, HOUSEHOLD_READER],
  },
  {
    provide: ReactionService,
    useFactory: (writer: HouseholdWriter, reader: HouseholdReader, history: FeedingHistoryPort) =>
      new ReactionService(writer, reader, history),
    inject: [HOUSEHOLD_WRITER, HOUSEHOLD_READER, FEEDING_HISTORY],
  },
  {
    provide: ForecastService,
    useFactory: (reader: HouseholdReader) => new ForecastService(reader),
    inject: [HOUSEHOLD_READER],
  },
  {
    provide: RulesService,
    useFactory: (writer: HouseholdWriter, reader: HouseholdReader) => new RulesService(writer, reader),
    inject: [HOUSEHOLD_WRITER, HOUSEHOLD_READER],
  },
  {
    provide: AlertSettingsService,
    useFactory: (writer: HouseholdWriter, reader: HouseholdReader) =>
      new AlertSettingsService(writer, reader),
    inject: [HOUSEHOLD_WRITER, HOUSEHOLD_READER],
  },
];

/** The use cases. MCP tools, the scheduler and Slack handlers all come through here. */
@Module({
  imports: [PersistenceModule],
  providers,
  exports: [
    StockService,
    ReconcileService,
    NoFeedService,
    MealPlanService,
    IngredientService,
    MenuService,
    MealSlotService,
    ReactionService,
    ForecastService,
    RulesService,
    AlertSettingsService,
  ],
})
export class ApplicationModule {}
