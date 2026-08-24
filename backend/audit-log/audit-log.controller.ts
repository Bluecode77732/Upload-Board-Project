// Purpose: exposes GET /audit-log for admins to review the privileged-action trail.
// Usage: mounted by AuditLogModule; behind JwtAuthGuard + RolesGuard(@Roles admin).
// Rationale: RBAC (ADR 0013) makes admin actions consequential; admins need read access to the audit trail.

import {
  ClassSerializerInterceptor,
  Controller,
  Get,
  Query,
  UseGuards,
  UseInterceptors,
} from '@nestjs/common';
import { ApiBearerAuth, ApiResponse, ApiTags } from '@nestjs/swagger';
import { JwtAuthGuard } from 'backend/auth/guard/jwt-auth.guard';
import { RolesGuard } from 'backend/auth/guard/roles.guard';
import { Roles } from 'backend/auth/decorator/roles.decorator';
import { UserRole } from 'backend/auth/role/role';
import { AuditLogService } from './audit-log.service';
import { AuditLogQueryDto } from './dto/audit-log-query.dto';

@ApiTags('Audit Log API')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, RolesGuard)
@UseInterceptors(ClassSerializerInterceptor)
@Controller('audit-log')
export class AuditLogController {
  constructor(private readonly auditLogService: AuditLogService) {}

  @Get()
  @Roles(UserRole.admin)
  @ApiResponse({
    status: 200,
    description:
      'Paginated audit records, newest first. action filters by the action type; ' +
      'userId returns only records where that user was the actor, or was the ' +
      "target of a user-targeting action (targetType='user') — a record whose " +
      'target is a file, post, or comment matches only via the actor side ' +
      '(ADR 0045). The two filters AND together when both are given.',
  })
  @ApiResponse({ status: 403, description: 'Admin role required.' })
  findAll(@Query() query: AuditLogQueryDto) {
    return this.auditLogService.findAll(query);
  }
}
