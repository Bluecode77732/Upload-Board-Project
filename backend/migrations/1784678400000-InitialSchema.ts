// 목적: 이전까지 수동으로 적용해 온 스키마(user_entity, file_entity, creator FK)를 담는 베이스라인 마이그레이션이다.
// 사용처: 새 DB에서는 pnpm migration:run으로 실행하고, 이미 수동으로 만들어진 DB에서는 테이블을 다시 만들지 않고 적용됨으로 표시하기 위해 pnpm migration:run -- --fake를 실행한다.
// 근거: 마이그레이션 도입(ADR 0006)에는 명확한 출발점이 필요하다; 제약 이름은 TypeORM의 해시 기본값이 아니라 읽을 수 있는 이름을 쓰므로, 이후 migration:generate 출력에서는 매번 불필요한 제약 이름 변경 문을 걷어내고 검토해야 한다.

import { MigrationInterface, QueryRunner } from 'typeorm';

export class InitialSchema1784678400000 implements MigrationInterface {
  name = 'InitialSchema1784678400000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `CREATE TABLE "user_entity" (
        "id" SERIAL NOT NULL,
        "email" character varying NOT NULL,
        "password" character varying NOT NULL,
        "createdAt" TIMESTAMP NOT NULL DEFAULT now(),
        "updatedAt" TIMESTAMP NOT NULL DEFAULT now(),
        CONSTRAINT "UQ_user_entity_email" UNIQUE ("email"),
        CONSTRAINT "PK_user_entity" PRIMARY KEY ("id")
      )`,
    );
    await queryRunner.query(
      `CREATE TABLE "file_entity" (
        "id" SERIAL NOT NULL,
        "title" character varying NOT NULL,
        "filePath" character varying NOT NULL,
        "createdAt" TIMESTAMP NOT NULL DEFAULT now(),
        "updatedAt" TIMESTAMP NOT NULL DEFAULT now(),
        "creatorId" integer NOT NULL,
        CONSTRAINT "UQ_file_entity_title" UNIQUE ("title"),
        CONSTRAINT "PK_file_entity" PRIMARY KEY ("id")
      )`,
    );
    await queryRunner.query(
      `ALTER TABLE "file_entity"
        ADD CONSTRAINT "FK_file_entity_creator"
        FOREIGN KEY ("creatorId") REFERENCES "user_entity"("id")
        ON DELETE NO ACTION ON UPDATE NO ACTION`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "file_entity" DROP CONSTRAINT "FK_file_entity_creator"`,
    );
    await queryRunner.query(`DROP TABLE "file_entity"`);
    await queryRunner.query(`DROP TABLE "user_entity"`);
  }
}
