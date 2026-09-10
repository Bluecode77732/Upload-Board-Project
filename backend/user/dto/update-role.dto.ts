// 목적: PATCH /user/:id/role 요청 본문(부여할 대상 역할)을 검증한다.
// 사용처: UserController.updateRole()에서 바인딩되며, UserEntity.role을 변경하는 유일하게 허가된 경로다.
// 근거: role은 서버가 통제한다 (ADR 0013) — 전용 DTO로 분리해 UpdateUserDto에는 두지 않으므로, 다른 곳에서는 화이트리스트가 이를 걸러낸다.

import { ApiProperty } from '@nestjs/swagger';
import { IsEnum, IsNotEmpty } from 'class-validator';
import { UserRole } from 'backend/auth/role/role';

export class UpdateRoleDto {
  @IsNotEmpty()
  @IsEnum(UserRole)
  @ApiProperty({ enum: UserRole, description: 'Target role to assign' })
  role!: UserRole;
}
