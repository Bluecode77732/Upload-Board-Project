// 목적: user_entity.refreshTokenHash를 추가한다 — refresh token rotation/재사용 탐지를 위한 서버 측 앵커다 (ADR 0012).
// 사용처: pnpm migration:run으로 적용된다; migration:generate를 돌릴 라이브 DB가 없어 베이스라인의 읽기 쉬운 스타일을 따라 직접 손으로 작성했다.
// 근거: rotation은 제시된 refresh token을 저장된 SHA-256과 비교해야 한다; null은 "활성 세션 없음"을 의미하므로 nullable로 둔다.

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
