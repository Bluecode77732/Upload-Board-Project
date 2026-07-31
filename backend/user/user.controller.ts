import {
  Controller,
  ForbiddenException,
  Get,
  Body,
  Patch,
  Param,
  Delete,
  ParseIntPipe,
  Query,
  UseInterceptors,
  ClassSerializerInterceptor,
  UseGuards,
} from '@nestjs/common';
import { UserService } from './user.service';
import { UpdateUserDto } from './dto/update-user.dto';
import { UpdateRoleDto } from './dto/update-role.dto';
import { DeleteUserQueryDto } from './dto/delete-user-query.dto';
import { ApiBearerAuth, ApiResponse, ApiTags } from '@nestjs/swagger';
import { JwtAuthGuard } from 'backend/auth/guard/jwt-auth.guard';
import { RolesGuard } from 'backend/auth/guard/roles.guard';
import { Roles } from 'backend/auth/decorator/roles.decorator';
import { AuthUser } from 'backend/auth/decorator/auth-user.decorator';
import { ROLE_RANK, UserRole } from 'backend/auth/role/role';
import { ErrorCode } from 'backend/common/error-code';

@Controller('user')
@ApiTags('User API')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard)
@UseInterceptors(ClassSerializerInterceptor)
export class UserController {
  constructor(private readonly userService: UserService) {}

  // Listing exposes every user's email — admin-only (RBAC, ADR 0013).
  @Get()
  @UseGuards(RolesGuard)
  @Roles(UserRole.admin)
  findAll() {
    return this.userService.findAll();
  }

  @Get(':id')
  findOne(@Param('id', ParseIntPipe) id: number) {
    return this.userService.findOne(id);
  }

  @Patch(':id')
  update(
    @Param('id', ParseIntPipe) id: number,
    @Body() updateUserDto: UpdateUserDto,
    @AuthUser() actor: AuthUser,
  ) {
    // Self, or an admin acting on another account (RBAC ownership extension).
    if (actor.id !== id && ROLE_RANK[actor.role] < ROLE_RANK[UserRole.admin]) {
      throw new ForbiddenException({
        code: ErrorCode.FORBIDDEN_NOT_OWNER,
        message: 'You can only update your own account.',
      });
    }
    return this.userService.update(id, updateUserDto);
  }

  // superadmin-only role assignment; the sole path that mutates UserEntity.role.
  @Patch(':id/role')
  @UseGuards(RolesGuard)
  @Roles(UserRole.superadmin)
  updateRole(
    @Param('id', ParseIntPipe) id: number,
    @Body() updateRoleDto: UpdateRoleDto,
    @AuthUser() actor: AuthUser,
  ) {
    return this.userService.updateRole(actor.id, id, updateRoleDto.role);
  }

  @Delete(':id')
  @ApiResponse({
    status: 200,
    description:
      'The account is gone. With deleteFiles=true its files (rows and stored files) are gone with it — irreversibly.',
  })
  @ApiResponse({
    status: 409,
    description:
      "USER_HAS_FILES — the account still owns files and the request did not confirm the cascade. The message carries the file count so the client can warn before repeating with deleteFiles=true (ADR 0020). USER_FILES_IN_USE — the cascade was confirmed, but one of the account's files is attached to another user's post, so nothing was deleted; remove that post first (ADR 0024).",
  })
  // 목적: 계정 삭제 요청을 권한 확인 후 서비스로 넘기고, 연쇄 삭제 동의 여부를 함께 전달한다.
  // 이유: 파일까지 지우는 경로는 비가역이므로, 확인 신호가 프론트 경고창이 아니라 요청 자체에 실려야 한다.
  // 방법: 검증된 쿼리 DTO의 문자열 리터럴을 boolean으로 좁혀 넘긴다 — 암묵 변환에 맡기지 않는다.
  remove(
    @Param('id', ParseIntPipe) id: number,
    @Query() query: DeleteUserQueryDto,
    @AuthUser() actor: AuthUser,
  ) {
    if (actor.id !== id && ROLE_RANK[actor.role] < ROLE_RANK[UserRole.admin]) {
      throw new ForbiddenException({
        code: ErrorCode.FORBIDDEN_NOT_OWNER,
        message: 'You can only delete your own account.',
      });
    }
    return this.userService.remove(actor.id, id, query.deleteFiles === 'true');
  }
}
