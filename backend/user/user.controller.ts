import {
  Controller,
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
import { GetUsersDto } from './dto/get-users.dto';
import { ApiBearerAuth, ApiResponse, ApiTags } from '@nestjs/swagger';
import { JwtAuthGuard } from 'backend/auth/guard/jwt-auth.guard';
import { RolesGuard } from 'backend/auth/guard/roles.guard';
import { Roles } from 'backend/auth/decorator/roles.decorator';
import { AuthUser } from 'backend/auth/decorator/auth-user.decorator';
import { UserRole } from 'backend/auth/role/role';

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
  @ApiResponse({
    status: 200,
    description:
      'A [users, totalCount] tuple. Defaults to the 20 newest accounts (createdAt DESC); take/skip paginate (ROADMAP execution order #2).',
  })
  @ApiResponse({
    status: 400,
    description:
      'VALIDATION_FAILED — take is out of 1–100, skip is negative, or the request carries a ' +
      "query parameter GetUsersDto doesn't declare (e.g. a typo like ?orderBy=email). The " +
      'global ValidationPipe runs forbidNonWhitelisted, so an unrecognized parameter is ' +
      'rejected rather than silently ignored — the same strict-input stance GET /file already ' +
      'takes (ADR 0021).',
  })
  // 목적: 검증된 페이지네이션 조건을 서비스에 그대로 넘긴다.
  // 이유: GetFilesDto/GetUsersDto 패턴을 따라 컨트롤러가 목록 조회 조건을 직접 해석하지 않게 한다.
  // 방법: @Query()로 바인딩된 GetUsersDto를 그대로 전달한다.
  findAll(@Query() query: GetUsersDto) {
    return this.userService.findAll(query);
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
    // Self, or an admin acting on a strictly lower-ranked account — UserService.update
    // owns the check since it already loads the target row (RBAC ownership extension).
    return this.userService.update(actor.id, actor.role, id, updateUserDto);
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
    // Self, or an admin acting on a strictly lower-ranked account — UserService.remove
    // owns the check since it already loads the target row (RBAC ownership extension).
    return this.userService.remove(
      actor.id,
      actor.role,
      id,
      query.deleteFiles === 'true',
    );
  }
}
