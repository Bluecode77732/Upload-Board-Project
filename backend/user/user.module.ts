import { Module } from '@nestjs/common';
import { UserService } from './user.service';
import { UserController } from './user.controller';
import { TypeOrmModule } from '@nestjs/typeorm';
import { UserEntity } from './entity/user.entity';
import { AuditLogModule } from 'backend/audit-log/audit-log.module';
import { SuperadminSeedService } from './superadmin-seed.service';
import { FileModule } from 'backend/file/file.module';

@Module({
  // FileModule supplies FileService so account deletion can cascade into file rows
  // without UserService owning file metadata itself (ADR 0020).
  imports: [TypeOrmModule.forFeature([UserEntity]), AuditLogModule, FileModule],
  controllers: [UserController],
  providers: [UserService, SuperadminSeedService],
  exports: [UserService],
})
export class UserModule {}
