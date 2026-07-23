// Purpose: adds user_entity.refreshTokenHash — the server-side anchor for refresh-token rotation/reuse detection (ADR 0012).
// Usage: applied via pnpm migration:run; written by hand (no live DB for migration:generate) mirroring the baseline's readable style.
// Rationale: rotation must compare the presented refresh token against a stored SHA-256; nullable because null means "no active session".

import { MigrationInterface, QueryRunner } from 'typeorm';

export class AddUserRefreshTokenHash1784851200000
  implements MigrationInterface
{
  name = 'AddUserRefreshTokenHash1784851200000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "user_entity" ADD "refreshTokenHash" character varying`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "user_entity" DROP COLUMN "refreshTokenHash"`,
    );
  }
}
