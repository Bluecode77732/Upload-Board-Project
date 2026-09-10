import { MigrationInterface, QueryRunner } from 'typeorm';

// ADR 0040 D3: mediaType을 일단 nullable로 추가하고, 각 행의 기존 filePath 확장자로부터
// 결정론적으로 백필한 뒤 NOT NULL로 잠근다 — 곧바로 NOT NULL ADD COLUMN을 하면 이미
// 존재하는 행에 채워 넣을 값이 없다. generate가 뽑아낸 diff의 FK/인덱스 DROP+CREATE 문은
// 걷어냈다(베이스라인의 읽기 쉬운 제약 이름 때문에 생기는 불필요한 이름 변경 노이즈,
// CLAUDE.md > Database) — 그래서 이 마이그레이션은 file_entity.mediaType만 건드린다.
export class AddFileMediaType1786818802632 implements MigrationInterface {
  name = 'AddFileMediaType1786818802632';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "file_entity" ADD "mediaType" character varying`,
    );
    await queryRunner.query(`
      UPDATE "file_entity" SET "mediaType" = CASE
        WHEN "filePath" ~* '\\.(jpg|jpeg|png|webp)$' THEN 'image'
        WHEN "filePath" ~* '\\.mp3$' THEN 'audio'
        ELSE 'video'
      END
    `);
    await queryRunner.query(
      `ALTER TABLE "file_entity" ALTER COLUMN "mediaType" SET NOT NULL`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "file_entity" DROP COLUMN "mediaType"`,
    );
  }
}
