import {
  Controller,
  ForbiddenException,
  Get,
  Body,
  Patch,
  Param,
  Delete,
  ParseIntPipe,
  UseInterceptors,
  ClassSerializerInterceptor,
  UseGuards,
} from '@nestjs/common';
import { UserService } from './user.service';
import { UpdateUserDto } from './dto/update-user.dto';
import { UpdateRoleDto } from './dto/update-role.dto';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
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
  remove(@Param('id', ParseIntPipe) id: number, @AuthUser() actor: AuthUser) {
    if (actor.id !== id && ROLE_RANK[actor.role] < ROLE_RANK[UserRole.admin]) {
      throw new ForbiddenException({
        code: ErrorCode.FORBIDDEN_NOT_OWNER,
        message: 'You can only delete your own account.',
      });
    }
    return this.userService.remove(actor.id, id);
  }
}
