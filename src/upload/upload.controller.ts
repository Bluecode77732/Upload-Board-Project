import { BadRequestException, Controller, Post, UploadedFile, UseGuards, UseInterceptors } from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { ApiBearerAuth, ApiBody, ApiConsumes, ApiResponse, ApiTags } from '@nestjs/swagger';
import { JwtAuthGuard } from 'src/auth/guard/jwt-auth.guard';

@Controller('upload')
@ApiTags("Upload API")
@UseGuards(JwtAuthGuard)
@ApiBearerAuth()
export class UploadController {

    @Post('attach')
    @ApiConsumes("multipart/form-data")
    @ApiBody({
        schema: {
            type: 'object',
            properties: {
                video : {
                    type: "string",
                    format: "binary",
                },
            },
        },
    })
    @ApiResponse({
        status: 201,
        description: "Uploaded File Successfully.",
        example: {
            "filename": "temp_67ff0c79-a1f0-4d4f-865c-681af920378d_1764581241716.mp4"
        }
    })
    @ApiResponse({
        status: 400,
        description: "Bad Request. No file attached or the file is too larger than 100MB.",
    })
    @UseInterceptors(FileInterceptor('video', {
        limits: {
            fileSize: 100000000,     //300MB in bytes  
        },
    }))
    uploadVideo(
        @UploadedFile() file: Express.Multer.File,
    ) {
        // Throw error if there's no file.
        if (!file) {
            throw new BadRequestException("Attach File.");
        };

        // Terminal log
        console.log(file);

        // Client log
        return {
            filename: file.filename,
        };
    }
}
