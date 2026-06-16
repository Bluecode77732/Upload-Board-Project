import { PartialType } from '@nestjs/swagger';
import { ApiPropertyOptional } from '@nestjs/swagger';
import { IsNumber, IsOptional } from 'class-validator';
import { UploadFileDto } from './create-uploadFile.dto';

export class UpdateFileDto extends PartialType(UploadFileDto) {
    @IsOptional()
    @IsNumber()
    @ApiPropertyOptional({ description: "Reassign file to a different user", example: 2 })
    userId?: number;
}
