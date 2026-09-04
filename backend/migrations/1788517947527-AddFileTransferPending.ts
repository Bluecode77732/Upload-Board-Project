import { MigrationInterface, QueryRunner } from 'typeorm';

// ADR 0050: adds the one nullable column the propose/accept/reject/cancel flow needs —
// which user (if any) a file is currently proposed to. ON DELETE SET NULL: if the pending
// target's own account is deleted before responding, only the pending state disappears,
// never the file itself. The generated diff's FK/index DROP+CREATE statements for
// creator/post/comment constraints and the pg_trgm/audit-log indexes are stripped
// (spurious constraint-rename noise from the baseline's readable constraint names,
// CLAUDE.md > Database) so this migration touches only file_entity.pendingTransferToUserId.
export class AddFileTransferPending1788517947527 implements MigrationInterface {
  name = 'AddFileTransferPending1788517947527';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "file_entity" ADD "pendingTransferToUserId" integer`,
    );
    await queryRunner.query(
      `ALTER TABLE "file_entity" ADD CONSTRAINT "FK_file_entity_pendingTransferTo" FOREIGN KEY ("pendingTransferToUserId") REFERENCES "user_entity"("id") ON DELETE SET NULL ON UPDATE NO ACTION`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "file_entity" DROP CONSTRAINT "FK_file_entity_pendingTransferTo"`,
    );
    await queryRunner.query(
      `ALTER TABLE "file_entity" DROP COLUMN "pendingTransferToUserId"`,
    );
  }
}
