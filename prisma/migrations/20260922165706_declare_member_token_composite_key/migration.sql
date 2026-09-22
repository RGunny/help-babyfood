-- DropForeignKey
ALTER TABLE "member_token" DROP CONSTRAINT "member_token_member_id_fkey";

-- ============================================================================
-- 여기부터는 설명이다. 위 DROP 한 줄이 이 마이그레이션의 전부다.
-- ============================================================================

-- 스키마가 member_token.member 관계를 (member_id, household_id) 복합 FK로 선언하게 되면서
-- 단일 컬럼 FK는 스키마에 없는 제약이 됐다. 지워도 무결성 손실이 없다. 복합 FK
-- member_token_member_household_fkey가 이것을 함의한다. (member_id, household_id)가
-- member에 있으면 member_id도 반드시 member에 있다. ON DELETE CASCADE도 복합 FK에 그대로 있다.

-- member_token_member_id_idx 인덱스는 남는다. FK가 사라져도 member_id로 찾는 조회 경로는 유지된다.

-- 되돌리려면:
-- ALTER TABLE "member_token" ADD CONSTRAINT "member_token_member_id_fkey" FOREIGN KEY ("member_id") REFERENCES "member"("id") ON DELETE CASCADE ON UPDATE CASCADE;
