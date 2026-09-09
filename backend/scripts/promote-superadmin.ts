// 목적: SUPERADMIN_EMAIL 계정을 사람이 직접 확인한 뒤 superadmin으로 승격시키는 수동 트리거.
// 사용처: `pnpm promote-superadmin`으로 운영자가 직접 실행한다 — 어떤 코드 경로에서도 자동 호출되지 않는다.
// 근거: 부팅 시 자동 승격(SuperadminSeedService)은 이메일 소유자 검증이 없어 선등록 공격에
//       취약했다(ADR 0052, ADR 0013 amend) — 자동 트리거를 없애고 사람이 실행하는 단계로 대체한다.

import dataSource from '../data-source';
import { UserEntity } from '../user/entity/user.entity';
import { UserRole } from '../auth/role/role';

// 목적: SUPERADMIN_EMAIL 계정을 찾아 superadmin으로 승격한다.
// 이유: 자동 시딩이 제거된 뒤 이 역할을 대신할, 사람이 실행하는 유일한 경로가 필요하다.
// 방법: data-source.ts의 DataSource를 재사용해 두 번째 process.env 직접 접근 예외를
//       만들지 않는다. 계정 미존재/이미 승격된 경우를 구분해 명확한 메시지로 종료하고,
//       단일 쓰기이므로 트랜잭션 없이 repository.update 한 번으로 끝낸다.
async function promoteSuperadmin(): Promise<void> {
  const email = process.env.SUPERADMIN_EMAIL;
  if (!email) {
    throw new Error(
      'SUPERADMIN_EMAIL is not set — add it to .env, then re-run this script.',
    );
  }

  await dataSource.initialize();
  try {
    const userRepository = dataSource.getRepository(UserEntity);
    const user = await userRepository.findOne({ where: { email } });
    if (!user) {
      throw new Error(
        `No account registered with ${email} yet — register it first, then re-run this script.`,
      );
    }
    if (user.role === UserRole.superadmin) {
      console.log(`${email} is already superadmin — nothing to do.`);
      return;
    }

    await userRepository.update({ email }, { role: UserRole.superadmin });
    console.log(`Promoted ${email} to superadmin.`);
  } finally {
    await dataSource.destroy();
  }
}

promoteSuperadmin().catch((err: unknown) => {
  console.error(err instanceof Error ? err.message : err);
  process.exitCode = 1;
});
