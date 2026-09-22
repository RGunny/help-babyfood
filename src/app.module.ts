import { Module } from '@nestjs/common';
import { ApplicationModule } from './application/application.module.js';
import { AppController } from './app.controller.js';
import { AppService } from './app.service.js';

@Module({
  imports: [ApplicationModule],
  controllers: [AppController],
  providers: [AppService],
})
export class AppModule {}
