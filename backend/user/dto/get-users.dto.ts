// Purpose: bounds the GET /user list query (take/skip) so the endpoint can never scan the full table.
// Usage: bound via @Query() in UserController.findAll(); values forwarded to UserService.findAll().
// Rationale: findAll() returned every row via a bare findAndCount() (a documented Never Do Group 2 debt,
// ROADMAP execution order #2); list inputs need DTO validation at the boundary, mirroring GetFilesDto.

import { ApiPropertyOptional } from '@nestjs/swagger';
import { IsInt, IsOptional, Max, Min } from 'class-validator';

export class GetUsersDto {
  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(100)
  @ApiPropertyOptional({
    description: 'Number of users to return',
    default: 20,
    minimum: 1,
    maximum: 100,
  })
  take: number = 20;

  @IsOptional()
  @IsInt()
  @Min(0)
  @ApiPropertyOptional({
    description: 'Number of users to skip',
    default: 0,
    minimum: 0,
  })
  skip: number = 0;
}
