import { Module } from '@nestjs/common';
import { ApplicationModule } from './application/application.module.js';
import { McpModule } from './mcp/mcp.module.js';
import { SchedulerModule } from './scheduler/scheduler.module.js';

@Module({
  imports: [ApplicationModule, McpModule, SchedulerModule],
})
export class AppModule {}
