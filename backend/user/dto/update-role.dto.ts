// Purpose: validates the PATCH /user/:id/role body (the target role to assign).
// Usage: bound in UserController.updateRole(); the only sanctioned path that mutates UserEntity.role.
// Rationale: role is server-controlled (ADR 0013) — a dedicated DTO keeps it off UpdateUserDto so the whitelist strips it elsewhere.

import { ApiProperty } from '@nestjs/swagger';
import { IsEnum, IsNotEmpty } from 'class-validator';
import { UserRole } from 'backend/auth/role/role';

export class UpdateRoleDto {
  @IsNotEmpty()
  @IsEnum(UserRole)
  @ApiProperty({ enum: UserRole, description: 'Target role to assign' })
  role!: UserRole;
}
