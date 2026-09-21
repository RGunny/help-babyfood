import { Inject, Injectable, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { PrismaPg } from '@prisma/adapter-pg';
import type { AppEnv } from '../../config/env.js';
import { PrismaClient } from '../../generated/prisma/client.js';

export const APP_ENV = Symbol('APP_ENV');

/**
 * The client inside an interactive transaction. Prisma removes the connection and nesting methods
 * there, and repositories accept this so that the same code runs inside and outside a transaction.
 */
export type PrismaTransaction = Omit<
  PrismaClient,
  '$connect' | '$disconnect' | '$on' | '$transaction' | '$extends'
>;

@Injectable()
export class PrismaService extends PrismaClient implements OnModuleInit, OnModuleDestroy {
  constructor(@Inject(APP_ENV) env: AppEnv) {
    super({
      // v7은 모든 DB에 드라이버 어댑터를 요구한다. 풀 설정도 pg 드라이버 것이 되었고
      // 기본값이 connectionTimeoutMillis 0(무제한), idleTimeoutMillis 10초라 명시한다.
      adapter: new PrismaPg({
        connectionString: env.databaseUrl,
        max: env.databasePoolSize,
        connectionTimeoutMillis: 5_000,
        idleTimeoutMillis: 300_000,
      }),
    });
  }

  async onModuleInit(): Promise<void> {
    await this.$connect();
  }

  async onModuleDestroy(): Promise<void> {
    await this.$disconnect();
  }
}
