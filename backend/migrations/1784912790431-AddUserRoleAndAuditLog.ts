// Purpose: adds the RBAC role column to user_entity and the audit_log_entity table (ADR 0013).
// Usage: applied by pnpm migration:run after the baseline; reviewed line-by-line per CLAUDE.md schema policy.
// Rationale: generate emitted spurious FK-rename statements (baseline uses readable constraint names) — stripped; PK/index renamed to match the readable convention.

import { MigrationInterface, QueryRunner } from 'typeorm';

export class AddUserRoleAndAuditLog1784912790431 implements MigrationInterface {
  name = 'AddUserRoleAndAuditLog1784912790431';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "user_entity" ADD "role" character varying NOT NULL DEFAULT 'user'`,
    );
    await queryRunner.query(
      `CREATE TABLE "audit_log_entity" (
        "id" SERIAL NOT NULL,
        "actorId" integer NOT NULL,
        "targetId" integer,
        "action" character varying NOT NULL,
        "detail" character varying,
        "createdAt" TIMESTAMP NOT NULL DEFAULT now(),
        CONSTRAINT "PK_audit_log_entity" PRIMARY KEY ("id")
      )`,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_audit_log_entity_action_createdAt" ON "audit_log_entity" ("action", "createdAt")`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `DROP INDEX "public"."IDX_audit_log_entity_action_createdAt"`,
    );
    await queryRunner.query(`DROP TABLE "audit_log_entity"`);
    await queryRunner.query(`ALTER TABLE "user_entity" DROP COLUMN "role"`);
  }
}
