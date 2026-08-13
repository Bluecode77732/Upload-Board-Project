// Purpose: carries the explicit cascade confirmation for DELETE /user/:id (?deleteFiles=true).
// Usage: bound via @Query() in UserController.remove(); the controller maps it to the boolean UserService.remove takes.
// Rationale: an irreversible cascade must not hinge on implicit string→boolean coercion, so the flag gets its own validated DTO (ADR 0020).

import { ApiPropertyOptional } from '@nestjs/swagger';
import { IsIn, IsOptional } from 'class-validator';

// Deliberately typed as a string literal, not a boolean: the global pipe runs
// enableImplicitConversion, whose Boolean cast is pure truthiness and lands BEFORE any
// custom @Transform — a measured fact, asserted in this DTO's spec. A boolean-typed
// flag would turn `?deleteFiles=false` into `true` and destroy the very files the
// caller asked to keep. As a string the value survives untouched, and @IsIn rejects
// everything but the two literals as VALIDATION_FAILED (400).
export const DELETE_FILES_VALUES = ['true', 'false'] as const;

export class DeleteUserQueryDto {
  @IsOptional()
  @IsIn(DELETE_FILES_VALUES)
  @ApiPropertyOptional({
    description:
      'Confirms the irreversible cascade: deletes the account together with every file it owns (rows and stored files). Omitted or "false", an account that still owns files is refused with 409 USER_HAS_FILES.',
    enum: DELETE_FILES_VALUES,
    default: 'false',
  })
  deleteFiles?: (typeof DELETE_FILES_VALUES)[number];
}
