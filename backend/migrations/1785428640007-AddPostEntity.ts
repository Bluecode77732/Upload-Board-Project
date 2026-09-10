// 목적: post_entity를 만든다 — 게시글 테이블, 두 개의 외래키, fileId unique 제약이다 (ADR 0023).
// 사용처: AddUserRoleAndAuditLog 다음에 pnpm migration:run으로 적용되며, e2e 스위트가 일회용 DB를 만들 때도 실행된다.
// 근거: generate는 불필요한 문 네 개를 함께 뽑아냈다(FK_file_entity_creator와 IDX_audit_log_entity_action_createdAt을 오직 TypeORM 해시로 이름 바꾸려고 drop 후 재생성) — ADR 0006에 따라 이를 걷어냈고, 새 제약들은 대신 베이스라인의 읽기 쉬운 이름 규칙을 따른다.

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
    // 의도적으로 NO ACTION이다: 게시글이 참조하는 파일을 삭제하려면 거부되어야 한다
    // (409 FILE_IN_USE) — 이미 게시된 글에서 조용히 동영상만 빠지는 일은 없어야 한다.
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
