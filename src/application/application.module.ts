import { Module, Provider } from '@nestjs/common';
import { PersistenceModule } from '../infrastructure/prisma/persistence.module.js';
import { SlackDeliveryModule } from '../slack/outbound/slack-delivery.module.js';
import { AlertSettingsService } from './alert-settings.service.js';
import { BoardSyncService } from './board-sync.service.js';
import { BriefDispatchService } from './brief-dispatch.service.js';
import { DailyBriefService } from './daily-brief.service.js';
import { ForecastService } from './forecast.service.js';
import { HouseholdBoardService } from './household-board.service.js';
import { IngredientService } from './ingredient.service.js';
import { MealPlanImportService } from './meal-plan-import.service.js';
import { MealPlanService } from './meal-plan.service.js';
import { MealSlotService } from './meal-slot.service.js';
import { MenuService } from './menu.service.js';
import { NoFeedService } from './no-feed.service.js';
import { BoardPublisherPort } from './ports/board-publisher.port.js';
import { BoardSyncLogPort } from './ports/board-sync-log.port.js';
import { BriefDeliveryLogPort } from './ports/brief-delivery-log.port.js';
import { BriefDeliveryPort } from './ports/brief-delivery.port.js';
import { ClockPort } from './ports/clock.port.js';
import { FeedingHistoryPort } from './ports/feeding-history.port.js';
import { HouseholdDirectoryPort } from './ports/household-directory.port.js';
import { HouseholdReader, HouseholdWriter } from './ports/household-write.port.js';
import {
  BOARD_PUBLISHER,
  BOARD_SYNC_LOG,
  BRIEF_DELIVERY,
  BRIEF_DELIVERY_LOG,
  CLOCK,
  FEEDING_HISTORY,
  HOUSEHOLD_DIRECTORY,
  HOUSEHOLD_READER,
  HOUSEHOLD_WRITER,
} from './ports/tokens.js';
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
    useFactory: (writer: HouseholdWriter, directory: HouseholdDirectoryPort) =>
      new ReconcileService(writer, directory),
    inject: [HOUSEHOLD_WRITER, HOUSEHOLD_DIRECTORY],
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
    provide: MealPlanImportService,
    useFactory: (writer: HouseholdWriter, reader: HouseholdReader, history: FeedingHistoryPort) =>
      new MealPlanImportService(writer, reader, history),
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
  {
    provide: DailyBriefService,
    useFactory: (reader: HouseholdReader, history: FeedingHistoryPort, clock: ClockPort) =>
      new DailyBriefService(reader, history, clock),
    inject: [HOUSEHOLD_READER, FEEDING_HISTORY, CLOCK],
  },
  {
    provide: BriefDispatchService,
    useFactory: (
      log: BriefDeliveryLogPort,
      delivery: BriefDeliveryPort,
      brief: DailyBriefService,
      clock: ClockPort,
    ) => new BriefDispatchService(log, delivery, brief, clock),
    inject: [BRIEF_DELIVERY_LOG, BRIEF_DELIVERY, DailyBriefService, CLOCK],
  },
  {
    provide: HouseholdBoardService,
    useFactory: (reader: HouseholdReader, history: FeedingHistoryPort, clock: ClockPort) =>
      new HouseholdBoardService(reader, history, clock),
    inject: [HOUSEHOLD_READER, FEEDING_HISTORY, CLOCK],
  },
  {
    provide: BoardSyncService,
    useFactory: (log: BoardSyncLogPort, publisher: BoardPublisherPort, board: HouseholdBoardService, clock: ClockPort) =>
      new BoardSyncService(log, publisher, board, clock),
    inject: [BOARD_SYNC_LOG, BOARD_PUBLISHER, HouseholdBoardService, CLOCK],
  },
];

/** The use cases. MCP tools, the scheduler and Slack handlers all come through here. */
@Module({
  imports: [PersistenceModule, SlackDeliveryModule],
  providers,
  exports: [
    StockService,
    ReconcileService,
    NoFeedService,
    MealPlanService,
    MealPlanImportService,
    IngredientService,
    MenuService,
    MealSlotService,
    ReactionService,
    ForecastService,
    RulesService,
    AlertSettingsService,
    DailyBriefService,
    BriefDispatchService,
    HouseholdBoardService,
    BoardSyncService,
  ],
})
export class ApplicationModule {}
