// 목적: DELETE /user/:id의 명시적 cascade 확인(?deleteFiles=true)을 전달한다.
// 사용처: UserController.remove()에서 @Query()로 바인딩되며, 컨트롤러가 UserService.remove가 받는 boolean으로 변환한다.
// 근거: 되돌릴 수 없는 cascade가 암묵적인 string→boolean 강제 변환에 좌우돼서는 안 되므로, 이 플래그는 자체 검증 DTO를 갖는다 (ADR 0020).

import { ApiPropertyOptional } from '@nestjs/swagger';
import { IsIn, IsOptional } from 'class-validator';

// boolean이 아니라 의도적으로 문자열 리터럴로 타입을 잡는다: 전역 파이프는
// enableImplicitConversion을 실행하는데, 그 Boolean 캐스팅은 순수한 truthiness 판정이고
// 어떤 커스텀 @Transform보다도 먼저 적용된다 — 이 사실은 이 DTO의 스펙에서 실측·검증된다.
// boolean 타입 플래그였다면 `?deleteFiles=false`가 `true`로 바뀌어, 호출자가 남겨두려던
// 바로 그 파일들이 삭제됐을 것이다. 문자열로 두면 값이 손상 없이 그대로 살아남고,
// @IsIn이 두 리터럴 외의 모든 값을 VALIDATION_FAILED(400)로 거부한다.
export const DELETE_FILES_VALUES = ['true', 'false'] as const;

export class DeleteUserQueryDto {
  @IsOptional()
  @IsIn(DELETE_FILES_VALUES)
  @ApiPropertyOptional({
    description:
      'Confirms the irreversible cascade: deletes the account together with every file it owns (rows and stored files). Omitted or "false", an account that still owns files is refused with 409 USER_HAS_FILES.',
    enum: DELETE_FILES_VALUES,
    default: 'false',
  })
  deleteFiles?: (typeof DELETE_FILES_VALUES)[number];
}
