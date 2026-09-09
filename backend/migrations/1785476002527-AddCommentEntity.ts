// 목적: comment_entity를 만든다 — 게시판 댓글 테이블, 두 개의 외래키, 스레드 인덱스다 (ADR 0023).
// 사용처: AddPostEntity 다음에 pnpm migration:run으로 적용되며, e2e 스위트가 일회용 DB를 만들 때도 실행된다.
// 근거: generate는 불필요한 문 여섯 개를 함께 뽑아냈다(FK_file_entity_creator, FK_post_entity_creator, FK_post_entity_file, IDX_audit_log_entity_action_createdAt을 오직 TypeORM 해시로 이름 바꾸려고 drop 후 재생성) — ADR 0006에 따라 이를 걷어냈고, 새 제약들은 대신 베이스라인의 읽기 쉬운 이름 규칙을 따른다.

import { MigrationInterface, QueryRunner } from 'typeorm';

export class AddCommentEntity1785476002527 implements MigrationInterface {
  name = 'AddCommentEntity1785476002527';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `CREATE TABLE "comment_entity" (
        "id" SERIAL NOT NULL,
        "body" text NOT NULL,
        "createdAt" TIMESTAMP NOT NULL DEFAULT now(),
        "updatedAt" TIMESTAMP NOT NULL DEFAULT now(),
        "creatorId" integer NOT NULL,
        "postId" integer NOT NULL,
        CONSTRAINT "PK_comment_entity" PRIMARY KEY ("id")
      )`,
    );
    // "한 게시글의 댓글을, 오래된 순으로"가 이 테이블의 유일한 쿼리 형태다; 앞선 컬럼은
    // FK_comment_entity_post도 함께 서빙한다 — Postgres는 이 컬럼을 알아서 인덱싱해주지 않는다.
    await queryRunner.query(
      `CREATE INDEX "IDX_comment_entity_postId_createdAt"
        ON "comment_entity" ("postId", "createdAt")`,
    );
    await queryRunner.query(
      `ALTER TABLE "comment_entity"
        ADD CONSTRAINT "FK_comment_entity_creator"
        FOREIGN KEY ("creatorId") REFERENCES "user_entity"("id")
        ON DELETE NO ACTION ON UPDATE NO ACTION`,
    );
    // 의도적으로 CASCADE이며, 이 스키마에서 유일한 CASCADE다 (ADR 0023 D3): 댓글은 URL도
    // 파일도 없고 게시글 밖에서는 존재 자체가 없으므로, 행이 지워지기 전에 아무것도 읽을
    // 필요가 없다. ADR 0020의 금지 규칙은 FileEntity.creator에만 적용되는데, 거기서는
    // unlink할 저장 경로를 먼저 읽어야 하기 때문이다.
    await queryRunner.query(
      `ALTER TABLE "comment_entity"
        ADD CONSTRAINT "FK_comment_entity_post"
        FOREIGN KEY ("postId") REFERENCES "post_entity"("id")
        ON DELETE CASCADE ON UPDATE NO ACTION`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "comment_entity" DROP CONSTRAINT "FK_comment_entity_post"`,
    );
    await queryRunner.query(
      `ALTER TABLE "comment_entity" DROP CONSTRAINT "FK_comment_entity_creator"`,
    );
    await queryRunner.query(
      `DROP INDEX "public"."IDX_comment_entity_postId_createdAt"`,
    );
    await queryRunner.query(`DROP TABLE "comment_entity"`);
  }
}
