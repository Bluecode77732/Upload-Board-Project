// Purpose: baseline migration capturing the schema that was previously applied manually (user_entity, file_entity, creator FK).
// Usage: executed by pnpm migration:run on a fresh database; on a pre-existing manually-created database run pnpm migration:run -- --fake to mark it applied without re-creating tables.
// Rationale: migration adoption (ADR 0006) needs an explicit starting point; constraint names are readable rather than TypeORM's hashed defaults, so review any future migration:generate output and strip spurious constraint-rename statements.

import { MigrationInterface, QueryRunner } from 'typeorm';

export class InitialSchema1784678400000 implements MigrationInterface {
  name = 'InitialSchema1784678400000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `CREATE TABLE "user_entity" (
        "id" SERIAL NOT NULL,
        "email" character varying NOT NULL,
        "password" character varying NOT NULL,
        "createdAt" TIMESTAMP NOT NULL DEFAULT now(),
        "updatedAt" TIMESTAMP NOT NULL DEFAULT now(),
        CONSTRAINT "UQ_user_entity_email" UNIQUE ("email"),
        CONSTRAINT "PK_user_entity" PRIMARY KEY ("id")
      )`,
    );
    await queryRunner.query(
      `CREATE TABLE "file_entity" (
        "id" SERIAL NOT NULL,
        "title" character varying NOT NULL,
        "filePath" character varying NOT NULL,
        "createdAt" TIMESTAMP NOT NULL DEFAULT now(),
        "updatedAt" TIMESTAMP NOT NULL DEFAULT now(),
        "creatorId" integer NOT NULL,
        CONSTRAINT "UQ_file_entity_title" UNIQUE ("title"),
        CONSTRAINT "PK_file_entity" PRIMARY KEY ("id")
      )`,
    );
    await queryRunner.query(
      `ALTER TABLE "file_entity"
        ADD CONSTRAINT "FK_file_entity_creator"
        FOREIGN KEY ("creatorId") REFERENCES "user_entity"("id")
        ON DELETE NO ACTION ON UPDATE NO ACTION`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "file_entity" DROP CONSTRAINT "FK_file_entity_creator"`,
    );
    await queryRunner.query(`DROP TABLE "file_entity"`);
    await queryRunner.query(`DROP TABLE "user_entity"`);
  }
}
