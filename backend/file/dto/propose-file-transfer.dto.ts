// 목적: POST /file/:id/transfer의 요청 본문 — 이전을 제안할 대상을 지정한다.
// 사용처: FileController.proposeTransfer()에서 임포트하며, 전역 ValidationPipe가 검증한다.
// 근거: 옛 UpdateFileDto.userId 필드는 "제안"과 "즉시 재배정"을 뒤섞고 있었다
//   (ADR 0050) — 전용 라우트에 전용 DTO를 두면 propose/accept/reject/cancel을 PATCH /file/:id의
//   의미를 더 늘리는 대신 네 개의 독립된 동작으로 유지할 수 있다.

import { ApiProperty } from '@nestjs/swagger';
import { IsInt, Min } from 'class-validator';

export class ProposeFileTransferDto {
  @IsInt()
  @Min(1)
  @ApiProperty({
    description:
      '이 파일을 제안받는 유저. 그 유저가 수락하기 전까지 소유권은 이동하지 않는다' +
      '(ADR 0050). (The user this file is being proposed to. Ownership does not move ' +
      'until that user accepts (ADR 0050).)',
    example: 2,
  })
  userId!: number;
}
