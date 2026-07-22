// Purpose: bounds the GET /file list query (take/skip) so the endpoint can never scan the full table.
// Usage: bound via @Query() in FileController.getFiles(); values forwarded to FileService.getFiles().
// Rationale: getFiles() was unpaginated (a documented Known Gap); list inputs need DTO validation at the boundary.

import { ApiPropertyOptional } from '@nestjs/swagger';
import { IsInt, IsOptional, Max, Min } from 'class-validator';

export class GetFilesDto {
    @IsOptional()
    @IsInt()
    @Min(1)
    @Max(100)
    @ApiPropertyOptional({ description: "Number of files to return", default: 20, minimum: 1, maximum: 100 })
    take: number = 20;

    @IsOptional()
    @IsInt()
    @Min(0)
    @ApiPropertyOptional({ description: "Number of files to skip", default: 0, minimum: 0 })
    skip: number = 0;
}
