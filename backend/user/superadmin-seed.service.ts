// Purpose: promotes the SUPERADMIN_EMAIL account to superadmin on boot so a first superadmin can exist.
// Usage: registered in UserModule providers; runs once via OnApplicationBootstrap. No-op if the env var is unset.
// Rationale: role defaults to 'user' (ADR 0013), so someone must be seeded; env + boot hook avoids a manual SQL step and needs no new infra.

import { Injectable, OnApplicationBootstrap } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { UserEntity } from './entity/user.entity';
import { UserRole } from 'backend/auth/role/role';

@Injectable()
export class SuperadminSeedService implements OnApplicationBootstrap {
  constructor(
    private readonly configService: ConfigService,
    @InjectRepository(UserEntity)
    private readonly userRepository: Repository<UserEntity>,
  ) {}

  // 목적: 부팅 시 SUPERADMIN_EMAIL 계정을 superadmin으로 승격한다.
  // 이유: role 기본값이 'user'라(ADR 0013) 최초의 superadmin이 저절로 생기지 않는다 —
  //       수동 SQL 개입 없이 env var + 부팅 훅만으로 첫 superadmin을 확보한다.
  // 방법: env var 미설정이면 즉시 no-op. 계정이 아직 없으면 다음 부팅에서 승격되도록 이번엔
  //       건너뛴다(회원가입이 먼저 필요하므로). 이미 superadmin이면 중복 업데이트를 생략한다.
  async onApplicationBootstrap(): Promise<void> {
    const email = this.configService.get<string>('SUPERADMIN_EMAIL');
    if (!email) {
      return;
    }

    const user = await this.userRepository.findOne({ where: { email } });
    // Absent account: no-op — register it, then the next boot promotes it.
    if (!user || user.role === UserRole.superadmin) {
      return;
    }

    await this.userRepository.update({ email }, { role: UserRole.superadmin });
  }
}
