-- CreateEnum
CREATE TYPE "stock_tracking" AS ENUM ('cubes', 'pantry');

-- AlterTable
-- 기존 재료 행을 cubes로 채우기 위한 DEFAULT다. 채운 뒤 바로 없앤다. 스키마에는 기본값이 없다.
ALTER TABLE "ingredient" ADD COLUMN "stock_tracking" "stock_tracking" NOT NULL DEFAULT 'cubes';
ALTER TABLE "ingredient" ALTER COLUMN "stock_tracking" DROP DEFAULT;
