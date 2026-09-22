import { HouseholdDirectoryPort } from '../../application/ports/household-directory.port.js';
import { PrismaTransaction } from './prisma.service.js';

/**
 * Lists the households a sweep visits.
 *
 * Ordered by creation so that every tick visits them in the same order: a household that keeps
 * failing then shows up at the same point of the log instead of moving around.
 */
export class PrismaHouseholdDirectory implements HouseholdDirectoryPort {
  constructor(private readonly prisma: PrismaTransaction) {}

  async listIds(): Promise<string[]> {
    const rows = await this.prisma.household.findMany({
      select: { id: true },
      orderBy: { createdAt: 'asc' },
    });
    return rows.map((row) => row.id);
  }
}
