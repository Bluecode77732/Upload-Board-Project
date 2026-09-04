// Purpose: request body for POST /file/:id/transfer — names who a transfer is proposed to.
// Usage: imported by FileController.proposeTransfer(); validated by the global ValidationPipe.
// Rationale: the old UpdateFileDto.userId field conflated "propose" with "immediately reassign"
//   (ADR 0050) — a dedicated DTO on its own route keeps propose/accept/reject/cancel as four
//   distinct actions instead of overloading PATCH /file/:id's semantics further.

import { ApiProperty } from '@nestjs/swagger';
import { IsInt, Min } from 'class-validator';

export class ProposeFileTransferDto {
  @IsInt()
  @Min(1)
  @ApiProperty({
    description:
      'The user this file is being proposed to. Ownership does not move until that user accepts (ADR 0050).',
    example: 2,
  })
  userId!: number;
}
