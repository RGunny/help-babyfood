import { Module } from '@nestjs/common';
import { ApplicationModule } from './application/application.module.js';
import { McpModule } from './mcp/mcp.module.js';

@Module({
  imports: [ApplicationModule, McpModule],
})
export class AppModule {}
