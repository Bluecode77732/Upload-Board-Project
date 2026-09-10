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
import { LookupUserDto } from './dto/lookup-user.dto';
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

  // 목록 조회는 모든 유저의 이메일을 노출하므로 admin 전용이다 (RBAC, ADR 0013).
  @Get()
  @UseGuards(RolesGuard)
  @Roles(UserRole.admin)
  @ApiResponse({
    status: 200,
    description:
      'A [users, totalCount] tuple. Defaults to the 20 newest accounts (createdAt DESC); ' +
      'take/skip paginate (ROADMAP execution order #2). search does a case-insensitive ' +
      'partial match on email; sortBy (createdAt|email|id, default createdAt) and order ' +
      '(ASC|DESC, default DESC) control sort, with id always added as a tiebreaker (ADR 0021 parity).',
  })
  @ApiResponse({
    status: 400,
    description:
      'VALIDATION_FAILED — take is out of 1–100, skip is negative, search exceeds 100 ' +
      'characters, sortBy/order is not one of the accepted values, or the request carries a ' +
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

  @Get('lookup')
  @ApiResponse({
    status: 200,
    description:
      'The user with this exact email (ADR 0050 — resolves a file-transfer proposal target). ' +
      'Any authenticated user may call this — same per-user disclosure level as GET /user/:id, ' +
      'just keyed by email instead of id.',
  })
  @ApiResponse({ status: 404, description: 'USER_NOT_FOUND.' })
  // 목적: 이메일로 유저를 조회해 숫자 id를 돌려준다.
  // 이유: 파일 이전 제안 폼은 상대방 이메일만 알고 id는 모르는 게 보통이다 — POST
  //       /file/:id/transfer가 숫자 userId만 받으므로 그 변환이 필요하다(ADR 0050).
  // 방법: 검증된 DTO의 email을 그대로 서비스에 위임한다. `:id` 라우트보다 먼저 선언해야
  //       'lookup'이 숫자 id 파라미터로 오인되지 않는다(Express는 선언 순서로 매칭한다).
  findByEmail(@Query() query: LookupUserDto) {
    return this.userService.findByEmail(query.email);
  }

  @Get(':id')
  // 목적: id로 단일 유저를 조회한다.
  // 이유: 없으면 404를 던지는 판정이 UserService.findOne에 이미 있다 — 컨트롤러가 중복하지 않는다.
  // 방법: 그대로 위임.
  findOne(@Param('id', ParseIntPipe) id: number) {
    return this.userService.findOne(id);
  }

  @Patch(':id')
  // 목적: 계정 정보 수정 요청을 권한 정보와 함께 서비스로 넘긴다.
  // 이유: "본인이거나 대상보다 낮은 role의 admin 이상"이라는 랭크 비교 판정은 대상 행을 이미
  //       읽는 UserService.update가 갖고 있어야 한다(RBAC 확장, Law of Demeter).
  // 방법: @AuthUser로 얻은 actor의 id/role을 그대로 전달 — 컨트롤러는 판정하지 않는다.
  update(
    @Param('id', ParseIntPipe) id: number,
    @Body() updateUserDto: UpdateUserDto,
    @AuthUser() actor: AuthUser,
  ) {
    // 본인이거나, 자신보다 확실히 낮은 등급의 계정에 대해 조치하는 admin이어야 한다 —
    // 대상 행을 이미 로드하는 UserService.update가 이 검사를 소유한다 (RBAC 소유권 확장).
    return this.userService.update(actor.id, actor.role, id, updateUserDto);
  }

  // superadmin 전용 role 할당; UserEntity.role을 바꾸는 유일한 경로다.
  @Patch(':id/role')
  @UseGuards(RolesGuard)
  @Roles(UserRole.superadmin)
  // 목적: role 변경 요청을 서비스로 넘긴다 — UserEntity.role을 바꾸는 유일한 경로.
  // 이유: 마지막 superadmin 강등 방지 등 불변식은 UserService.updateRole의 트랜잭션 안에서만
  //       안전하게 판정할 수 있다(동시 요청 레이스 포함).
  // 방법: @Roles(superadmin) 가드로 이미 걸러진 actor.id와 대상 id/role을 그대로 전달한다.
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
    // 본인이거나, 자신보다 확실히 낮은 등급의 계정에 대해 조치하는 admin이어야 한다 —
    // 대상 행을 이미 로드하는 UserService.remove가 이 검사를 소유한다 (RBAC 소유권 확장).
    return this.userService.remove(
      actor.id,
      actor.role,
      id,
      query.deleteFiles === 'true',
    );
  }
}
