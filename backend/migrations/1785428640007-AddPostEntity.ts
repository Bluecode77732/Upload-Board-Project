// Purpose: creates post_entity — the board post table, its two foreign keys, and the unique fileId constraint (ADR 0023).
// Usage: applied by pnpm migration:run after AddUserRoleAndAuditLog; also run by the e2e suite to build its throwaway database.
// Rationale: generate emitted four spurious statements (dropping and re-adding FK_file_entity_creator and IDX_audit_log_entity_action_createdAt purely to rename them to TypeORM hashes) — stripped per ADR 0006; the new constraints follow the baseline's readable naming instead.

import { MigrationInterface, QueryRunner } from 'typeorm';

export class AddPostEntity1785428640007 implements MigrationInterface {
  name = 'AddPostEntity1785428640007';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `CREATE TABLE "post_entity" (
        "id" SERIAL NOT NULL,
        "title" character varying NOT NULL,
        "body" text NOT NULL,
        "createdAt" TIMESTAMP NOT NULL DEFAULT now(),
        "updatedAt" TIMESTAMP NOT NULL DEFAULT now(),
        "creatorId" integer NOT NULL,
        "fileId" integer,
        CONSTRAINT "UQ_post_entity_fileId" UNIQUE ("fileId"),
        CONSTRAINT "PK_post_entity" PRIMARY KEY ("id")
      )`,
    );
    await queryRunner.query(
      `ALTER TABLE "post_entity"
        ADD CONSTRAINT "FK_post_entity_creator"
        FOREIGN KEY ("creatorId") REFERENCES "user_entity"("id")
        ON DELETE NO ACTION ON UPDATE NO ACTION`,
    );
    // NO ACTION on purpose: deleting a file that a post references must be refused
    // (409 FILE_IN_USE), never silently strip the video out of a published post.
    await queryRunner.query(
      `ALTER TABLE "post_entity"
        ADD CONSTRAINT "FK_post_entity_file"
        FOREIGN KEY ("fileId") REFERENCES "file_entity"("id")
        ON DELETE NO ACTION ON UPDATE NO ACTION`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "post_entity" DROP CONSTRAINT "FK_post_entity_file"`,
    );
    await queryRunner.query(
      `ALTER TABLE "post_entity" DROP CONSTRAINT "FK_post_entity_creator"`,
    );
    await queryRunner.query(`DROP TABLE "post_entity"`);
  }
}
