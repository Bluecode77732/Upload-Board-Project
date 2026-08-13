import { MigrationInterface, QueryRunner } from 'typeorm';

export class AddFileVisibility1785571437643 implements MigrationInterface {
  name = 'AddFileVisibility1785571437643';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "file_entity" ADD "visibility" character varying NOT NULL DEFAULT 'private'`,
    );
    await queryRunner.query(
      `ALTER TABLE "file_entity" ADD "shareToken" character varying`,
    );
    await queryRunner.query(
      `ALTER TABLE "file_entity" ADD "shareExpiresAt" TIMESTAMP WITH TIME ZONE`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "file_entity" DROP COLUMN "shareExpiresAt"`,
    );
    await queryRunner.query(
      `ALTER TABLE "file_entity" DROP COLUMN "shareToken"`,
    );
    await queryRunner.query(
      `ALTER TABLE "file_entity" DROP COLUMN "visibility"`,
    );
  }
}
