import { MigrationInterface, QueryRunner } from 'typeorm';

// ADR 0040 D3: mediaType is added nullable, backfilled deterministically from each
// row's existing filePath extension, then locked to NOT NULL — a straight NOT NULL
// ADD COLUMN has no value to write for rows that already exist. The generated diff's
// FK/index DROP+CREATE statements are stripped (spurious constraint-rename noise from
// the baseline's readable constraint names, CLAUDE.md > Database) so this migration
// touches only file_entity.mediaType.
export class AddFileMediaType1786818802632 implements MigrationInterface {
  name = 'AddFileMediaType1786818802632';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "file_entity" ADD "mediaType" character varying`,
    );
    await queryRunner.query(`
      UPDATE "file_entity" SET "mediaType" = CASE
        WHEN "filePath" ~* '\\.(jpg|jpeg|png|webp)$' THEN 'image'
        WHEN "filePath" ~* '\\.mp3$' THEN 'audio'
        ELSE 'video'
      END
    `);
    await queryRunner.query(
      `ALTER TABLE "file_entity" ALTER COLUMN "mediaType" SET NOT NULL`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "file_entity" DROP COLUMN "mediaType"`,
    );
  }
}
