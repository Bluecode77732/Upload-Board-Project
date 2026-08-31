// Purpose: adds the three file_entity/post_entity indexes ADR 0021 deferred, now measured
// and adopted by docs/ADR/0049-performance-capacity-criteria.md.
// Usage: applied by `pnpm migration:run`; also required by test/e2e-utils.ts's MIGRATIONS list.
// Rationale: hand-authored, not migration:generate output — the pg_trgm GIN indexes need the
// gin_trgm_ops operator class, which @Index cannot express (file.entity.ts/post.entity.ts carry
// only the two plain-btree candidates), the same "generate can't express it" reason
// AddFileMediaType1786818802632 was hand-authored for.

import { MigrationInterface, QueryRunner } from 'typeorm';

export class AddPerformanceIndexes1788180660994 implements MigrationInterface {
  name = 'AddPerformanceIndexes1788180660994';

  public async up(queryRunner: QueryRunner): Promise<void> {
    // 기본 정렬(createdAt DESC, id DESC)용 — Postgres는 ASC로 만든 btree 인덱스도
    // 역방향으로 훑을 수 있어 DESC 정렬에 그대로 쓰인다(실측: file 27배, post 100배).
    await queryRunner.query(
      `CREATE INDEX "IDX_file_entity_createdAt_id" ON "file_entity" ("createdAt", "id")`,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_post_entity_createdAt_id" ON "post_entity" ("createdAt", "id")`,
    );

    // creatorId 필터 + ADR 0020 계정 삭제 캐스케이드용 — FK 컬럼은 자동으로 인덱싱되지
    // 않는다(실측: file 3.6배, post는 정렬 인덱스가 대신 선택되어 1.5배).
    await queryRunner.query(
      `CREATE INDEX "IDX_file_entity_creatorId" ON "file_entity" ("creatorId")`,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_post_entity_creatorId" ON "post_entity" ("creatorId")`,
    );

    // title ILIKE '%term%' 검색용 — pg_trgm의 gin_trgm_ops 연산자 클래스가 있어야 GIN
    // 인덱스가 패턴 매칭에 쓰인다. lower(title) 표현식 인덱스는 실제 쿼리(FileService.getFiles/
    // PostService.getPosts)가 title 원본 컬럼에 ILIKE를 쓰기 때문에 플래너가 못 골라 쓴다는
    // 것을 실측으로 확인했다 — 그래서 title 원본 컬럼에 직접 인덱스를 건다(실측: 4.4~4.6배).
    await queryRunner.query(`CREATE EXTENSION IF NOT EXISTS pg_trgm`);
    await queryRunner.query(
      `CREATE INDEX "IDX_file_entity_title_trgm" ON "file_entity" USING GIN ("title" gin_trgm_ops)`,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_post_entity_title_trgm" ON "post_entity" USING GIN ("title" gin_trgm_ops)`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP INDEX "IDX_post_entity_title_trgm"`);
    await queryRunner.query(`DROP INDEX "IDX_file_entity_title_trgm"`);
    await queryRunner.query(`DROP EXTENSION IF EXISTS pg_trgm`);

    await queryRunner.query(`DROP INDEX "IDX_post_entity_creatorId"`);
    await queryRunner.query(`DROP INDEX "IDX_file_entity_creatorId"`);

    await queryRunner.query(`DROP INDEX "IDX_post_entity_createdAt_id"`);
    await queryRunner.query(`DROP INDEX "IDX_file_entity_createdAt_id"`);
  }
}
