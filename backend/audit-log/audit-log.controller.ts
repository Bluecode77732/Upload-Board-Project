// 목적: 관리자가 권한 필요 작업 이력을 조회하는 GET /audit-log를 노출한다.
// 사용처: AuditLogModule에서 마운트; JwtAuthGuard + RolesGuard(@Roles admin) 뒤에 위치.
// 근거: RBAC(ADR 0013)로 관리자 작업이 중대해졌으므로, 관리자에게 감사 로그 읽기 권한이 필요하다.

import {
  ClassSerializerInterceptor,
  Controller,
  Get,
  Query,
  UseGuards,
  UseInterceptors,
} from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiOperation,
  ApiResponse,
  ApiTags,
} from '@nestjs/swagger';
import { JwtAuthGuard } from 'backend/auth/guard/jwt-auth.guard';
import { RolesGuard } from 'backend/auth/guard/roles.guard';
import { Roles } from 'backend/auth/decorator/roles.decorator';
import { UserRole } from 'backend/auth/role/role';
import { AuditLogService } from './audit-log.service';
import { AuditLogQueryDto } from './dto/audit-log-query.dto';

@ApiTags('감사 로그 API (Audit Log API)')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, RolesGuard)
@UseInterceptors(ClassSerializerInterceptor)
@Controller('audit-log')
export class AuditLogController {
  constructor(private readonly auditLogService: AuditLogService) {}

  @Get()
  @Roles(UserRole.admin)
  @ApiOperation({
    summary: '감사 로그를 조회한다. (List audit log records.)',
  })
  @ApiResponse({
    status: 200,
    description:
      '최신순으로 페이지네이션된 감사 기록. action은 행위 종류로 필터링하고, userId는 ' +
      "그 유저가 행위자이거나 유저-대상 행위(targetType='user')의 대상이었던 기록만 " +
      '반환한다 — 대상이 파일·게시글·댓글인 기록은 행위자 쪽으로만 매칭된다(ADR 0045). ' +
      '두 필터를 함께 주면 AND로 결합된다. (Paginated audit records, newest first. ' +
      'action filters by the action type; userId returns only records where that user ' +
      "was the actor, or was the target of a user-targeting action (targetType='user') " +
      '— a record whose target is a file, post, or comment matches only via the actor ' +
      'side (ADR 0045). The two filters AND together when both are given.)',
  })
  @ApiResponse({
    status: 403,
    description:
      'FORBIDDEN — admin 역할이 필요하다. (FORBIDDEN — admin role required.)',
  })
  // 목적: 감사 로그 목록 조회 조건을 서비스로 넘긴다.
  // 이유: action/userId 필터 조합과 페이지네이션 해석은 AuditLogService의 책임이다.
  // 방법: 검증된 AuditLogQueryDto를 그대로 전달한다.
  findAll(@Query() query: AuditLogQueryDto) {
    return this.auditLogService.findAll(query);
  }
}
