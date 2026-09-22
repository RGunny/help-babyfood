import { Module } from '@nestjs/common';
import { PersistenceModule } from '../infrastructure/prisma/persistence.module.js';
import { HealthController } from './health.controller.js';

@Module({
  imports: [PersistenceModule],
  controllers: [HealthController],
})
export class HealthModule {}
