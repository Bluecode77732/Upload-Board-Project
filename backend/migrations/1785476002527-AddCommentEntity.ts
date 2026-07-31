// Purpose: creates comment_entity — the board comment table, its two foreign keys, and the thread index (ADR 0023).
// Usage: applied by pnpm migration:run after AddPostEntity; also run by the e2e suite to build its throwaway database.
// Rationale: generate emitted six spurious statements (dropping and re-adding FK_file_entity_creator, FK_post_entity_creator, FK_post_entity_file and IDX_audit_log_entity_action_createdAt purely to rename them to TypeORM hashes) — stripped per ADR 0006; the new constraints follow the baseline's readable naming instead.

import { MigrationInterface, QueryRunner } from 'typeorm';

export class AddCommentEntity1785476002527 implements MigrationInterface {
  name = 'AddCommentEntity1785476002527';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `CREATE TABLE "comment_entity" (
        "id" SERIAL NOT NULL,
        "body" text NOT NULL,
        "createdAt" TIMESTAMP NOT NULL DEFAULT now(),
        "updatedAt" TIMESTAMP NOT NULL DEFAULT now(),
        "creatorId" integer NOT NULL,
        "postId" integer NOT NULL,
        CONSTRAINT "PK_comment_entity" PRIMARY KEY ("id")
      )`,
    );
    // "One post's comments, oldest first" is this table's only query shape; the leading
    // column also serves FK_comment_entity_post, which Postgres does not index for us.
    await queryRunner.query(
      `CREATE INDEX "IDX_comment_entity_postId_createdAt"
        ON "comment_entity" ("postId", "createdAt")`,
    );
    await queryRunner.query(
      `ALTER TABLE "comment_entity"
        ADD CONSTRAINT "FK_comment_entity_creator"
        FOREIGN KEY ("creatorId") REFERENCES "user_entity"("id")
        ON DELETE NO ACTION ON UPDATE NO ACTION`,
    );
    // CASCADE on purpose, and the only one in this schema (ADR 0023 D3): a comment has
    // no URL, no file and no existence outside its post, so nothing must be read before
    // the rows go. ADR 0020's prohibition stays scoped to FileEntity.creator, where the
    // stored paths to unlink have to be read first.
    await queryRunner.query(
      `ALTER TABLE "comment_entity"
        ADD CONSTRAINT "FK_comment_entity_post"
        FOREIGN KEY ("postId") REFERENCES "post_entity"("id")
        ON DELETE CASCADE ON UPDATE NO ACTION`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "comment_entity" DROP CONSTRAINT "FK_comment_entity_post"`,
    );
    await queryRunner.query(
      `ALTER TABLE "comment_entity" DROP CONSTRAINT "FK_comment_entity_creator"`,
    );
    await queryRunner.query(
      `DROP INDEX "public"."IDX_comment_entity_postId_createdAt"`,
    );
    await queryRunner.query(`DROP TABLE "comment_entity"`);
  }
}
