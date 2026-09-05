// Purpose: query DTO for GET /user/lookup — resolves an exact email to the numeric id a
//   file-transfer proposal needs (ADR 0050 frontend UI).
// Usage: bound via @Query() in UserController.findByEmail(); passed straight to UserService.
// Rationale: a dedicated DTO, not GetUsersDto — this is a single-row exact-match lookup, not a
//   paginated partial-match search, so the two share no validation worth inheriting.

import { ApiProperty } from '@nestjs/swagger';
import { IsEmail } from 'class-validator';

export class LookupUserDto {
  @IsEmail()
  @ApiProperty({
    description: 'Exact email to resolve to a user id.',
    example: 'user@example.com',
  })
  email!: string;
}
