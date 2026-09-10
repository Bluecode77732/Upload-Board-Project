// 목적: user_entity에 RBAC role 컬럼을 추가하고 audit_log_entity 테이블을 만든다 (ADR 0013).
// 사용처: 베이스라인 이후 pnpm migration:run으로 적용되며, CLAUDE.md 스키마 정책에 따라 한 줄씩 검토했다.
// 근거: generate는 불필요한 FK 이름 변경 문을 함께 뽑아냈다(베이스라인이 읽을 수 있는 제약 이름을 쓰기 때문) — 이를 걷어냈고, PK/인덱스 이름은 그 읽기 쉬운 규칙에 맞춰 다시 지었다.

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
