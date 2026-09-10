// 목적: ADR 0021이 유예해 뒀던 file_entity/post_entity 인덱스 세 개를 추가한다 — 이제 실측을
// 거쳐 docs/ADR/0049-performance-capacity-criteria.md에서 채택됐다.
// 사용처: `pnpm migration:run`으로 적용되며, test/e2e-utils.ts의 MIGRATIONS 목록에도 필요하다.
// 근거: migration:generate 출력이 아니라 직접 손으로 작성했다 — pg_trgm GIN 인덱스는
// gin_trgm_ops 연산자 클래스가 필요한데, @Index로는 표현할 수 없다(file.entity.ts/post.entity.ts에는
// 일반 btree 후보 두 개만 있다) — AddFileMediaType1786818802632를 손으로 작성했던 것과
// 같은 "generate가 표현하지 못한다"는 이유다.

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
