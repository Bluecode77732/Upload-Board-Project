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
