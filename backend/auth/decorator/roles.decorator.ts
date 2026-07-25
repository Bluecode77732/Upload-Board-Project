// Purpose: marks a handler with the minimum role required to invoke it.
// Usage: @Roles(UserRole.admin) on a controller method, enforced by RolesGuard.
// Rationale: Reflector-based metadata is the NestJS-idiomatic way to attach guard config without a custom abstraction.

import { Reflector } from '@nestjs/core';
import { UserRole } from '../role/role';

export const Roles = Reflector.createDecorator<UserRole>();
