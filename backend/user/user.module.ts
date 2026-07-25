import { Module } from '@nestjs/common';
import { UserService } from './user.service';
import { UserController } from './user.controller';
import { TypeOrmModule } from '@nestjs/typeorm';
import { UserEntity } from './entity/user.entity';
import { AuditLogModule } from 'backend/audit-log/audit-log.module';
import { SuperadminSeedService } from './superadmin-seed.service';

@Module({
  imports: [TypeOrmModule.forFeature([UserEntity]), AuditLogModule],
  controllers: [UserController],
  providers: [UserService, SuperadminSeedService],
  exports: [UserService],
})
export class UserModule {}
