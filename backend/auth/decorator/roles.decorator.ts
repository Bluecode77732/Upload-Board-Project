// 목적: 핸들러를 호출하는 데 필요한 최소 역할을 표시한다.
// 사용처: 컨트롤러 메서드에 @Roles(UserRole.admin)로 지정, RolesGuard가 강제.
// 근거: Reflector 기반 메타데이터는 커스텀 추상화 없이 가드 설정을 붙이는 NestJS다운 방식이다.

import { Reflector } from '@nestjs/core';
import { UserRole } from '../role/role';

export const Roles = Reflector.createDecorator<UserRole>();
