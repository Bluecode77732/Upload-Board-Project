import { MigrationInterface, QueryRunner } from 'typeorm';

// ADR 0045: targetType은 targetId의 판별자다. 기존 행은 action에서 종류가 결정적으로
// 도출되므로(각 action은 정확히 한 call site에서 한 종류의 대상만 기록한다) nullable로
// 추가한 뒤 action 기반으로 백필한다. targetId가 이미 nullable이므로 NOT NULL 단계는
// 두지 않는다 — 불변식은 "targetType IS NULL ⟺ targetId IS NULL"이다.
// 백필은 새 칸만 채우며 actorId/targetId/action/detail은 건드리지 않는다(append-only 유지).
// 생성된 diff의 FK·인덱스 DROP+CREATE 문은 제거했다 — 베이스라인의 읽기 좋은 제약조건
// 이름을 해시로 바꾸기만 하는 스퓨리어스 노이즈다(CLAUDE.md > Database).
export class AddAuditLogTargetType1787578451680 implements MigrationInterface {
  name = 'AddAuditLogTargetType1787578451680';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "audit_log_entity" ADD "targetType" character varying`,
    );
    await queryRunner.query(`
      UPDATE "audit_log_entity" SET "targetType" = CASE "action"
        WHEN 'ROLE_CHANGE'    THEN 'user'
        WHEN 'USER_DELETE'    THEN 'user'
        WHEN 'FILE_DELETE'    THEN 'file'
        WHEN 'POST_DELETE'    THEN 'post'
        WHEN 'COMMENT_DELETE' THEN 'comment'
      END
      WHERE "targetId" IS NOT NULL
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "audit_log_entity" DROP COLUMN "targetType"`,
    );
  }
}
