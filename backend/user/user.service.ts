import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { UpdateUserDto } from './dto/update-user.dto';
import { InjectRepository } from '@nestjs/typeorm';
import { UserEntity } from './entity/user.entity';
import { DataSource, Repository } from 'typeorm';
import * as bcrypt from 'bcrypt';
import { ConfigService } from '@nestjs/config';
import { ErrorCode } from 'backend/common/error-code';
import { UserRole } from 'backend/auth/role/role';
import { AuditLogService } from 'backend/audit-log/audit-log.service';

@Injectable()
export class UserService {
  constructor(
    @InjectRepository(UserEntity)
    private readonly userRepository: Repository<UserEntity>,

    private readonly configService: ConfigService,
    private readonly dataSource: DataSource,
    private readonly auditLogService: AuditLogService,
  ) {}

  async findAll() {
    return this.userRepository.findAndCount();
  }

  async findOne(id: number) {
    const user = await this.userRepository.findOne({ where: { id } });

    if (!user) {
      throw new NotFoundException({
        code: ErrorCode.USER_NOT_FOUND,
        message: 'User not found.',
      });
    }

    return user;
  }

  async update(id: number, updateUserDto: UpdateUserDto) {
    const { password } = updateUserDto;

    const user = await this.userRepository.findOne({ where: { id } });

    if (!user) {
      throw new NotFoundException({
        code: ErrorCode.USER_NOT_FOUND,
        message: 'User not found.',
      });
    }

    if (password) {
      updateUserDto.password = await bcrypt.hash(
        password,
        this.configService.getOrThrow<number>('HASH_ROUNDS'),
      );
    }

    await this.userRepository.update(
      { id },
      {
        email: updateUserDto.email,
        password: updateUserDto.password,
      },
    );

    return this.userRepository.findOne({ where: { id } });
  }

  // Pure multi-DB-write with a read-modify-write invariant (last-superadmin guard) →
  // dataSource.transaction (Transaction Boundary table); SERIALIZABLE + a row lock
  // stop two concurrent demotions from both passing the count check.
  async updateRole(actorId: number, targetId: number, role: UserRole) {
    const previousRole = await this.dataSource.transaction(
      'SERIALIZABLE',
      async (manager) => {
        const target = await manager.findOne(UserEntity, {
          where: { id: targetId },
          lock: { mode: 'pessimistic_write' },
        });
        if (!target) {
          throw new NotFoundException({
            code: ErrorCode.USER_NOT_FOUND,
            message: 'User not found.',
          });
        }

        const previous = target.role;

        // superadmins are demotable (model ①), but never the last one — that would
        // lock the role system (nobody left to promote anyone).
        if (previous === UserRole.superadmin && role !== UserRole.superadmin) {
          const superadminCount = await manager.count(UserEntity, {
            where: { role: UserRole.superadmin },
          });
          if (superadminCount <= 1) {
            throw new BadRequestException({
              code: ErrorCode.AUTH_LAST_SUPERADMIN,
              message: 'Cannot demote the last superadmin.',
            });
          }
        }

        // Any role change ends the target's refresh session (refreshTokenHash: null)
        // so a demotion is fully in effect immediately, not just on the next access.
        await manager.update(UserEntity, targetId, {
          role,
          refreshTokenHash: null,
        });

        return previous;
      },
    );

    // Audit after commit (side effect isolated — a log failure must not roll back the role change).
    await this.auditLogService.log(
      actorId,
      targetId,
      'ROLE_CHANGE',
      `${previousRole}→${role}`,
    );

    return { id: targetId, role };
  }

  async remove(actorId: number, id: number) {
    const user = await this.userRepository.findOne({ where: { id } });

    if (!user) {
      throw new NotFoundException({
        code: ErrorCode.USER_NOT_FOUND,
        message: 'User not found.',
      });
    }

    await this.userRepository.delete(id);

    await this.auditLogService.log(actorId, id, 'USER_DELETE');

    return `User ${id} deleted.`;
  }
}
