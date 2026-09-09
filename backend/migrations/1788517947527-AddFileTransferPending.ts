import { MigrationInterface, QueryRunner } from 'typeorm';

// ADR 0050: propose/accept/reject/cancel 흐름에 필요한 nullable 컬럼 하나를 추가한다 —
// 파일이 현재 어떤 유저에게(있다면) 제안된 상태인지를 담는다. ON DELETE SET NULL로 둔 이유는,
// 응답하기 전에 제안 대상 계정이 삭제되면 파일 자체가 아니라 대기 상태만 사라지게 하기 위해서다.
// generate가 뽑아낸 diff의 creator/post/comment 제약과 pg_trgm/audit-log 인덱스에 대한
// FK/인덱스 DROP+CREATE 문은 걷어냈다(베이스라인의 읽기 쉬운 제약 이름 때문에 생기는 불필요한
// 이름 변경 노이즈, CLAUDE.md > Database) — 그래서 이 마이그레이션은
// file_entity.pendingTransferToUserId만 건드린다.
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
