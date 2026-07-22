import {
  BadRequestException,
  Controller,
  Post,
  UploadedFile,
  UseGuards,
  UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import {
  ApiBearerAuth,
  ApiBody,
  ApiConsumes,
  ApiResponse,
  ApiTags,
} from '@nestjs/swagger';
import { JwtAuthGuard } from 'src/auth/guard/jwt-auth.guard';

@Controller('upload')
@ApiTags('Upload API')
@UseGuards(JwtAuthGuard)
@ApiBearerAuth()
export class UploadController {
  @Post('attach')
  @ApiConsumes('multipart/form-data')
  @ApiBody({
    schema: {
      type: 'object',
      properties: {
        video: {
          type: 'string',
          format: 'binary',
        },
      },
    },
  })
  @ApiResponse({
    status: 201,
    description: 'Uploaded File Successfully.',
    example: {
      filename: 'temp_67ff0c79-a1f0-4d4f-865c-681af920378d_1764581241716.mp4',
    },
  })
  @ApiResponse({
    status: 400,
    description:
      'Bad Request. No file attached, the file is larger than 100MB, or the file is not an allowed video type (mp4, mov, webm).',
  })
  @UseInterceptors(
    FileInterceptor('video', {
      limits: {
        fileSize: 100000000, // 100MB in bytes
      },
      fileFilter: (req, file, cb) => {
        // Both mimetype and extension are client-supplied, so this is an
        // allowlist against accidental/blatant misuse, not a content guarantee.
        const allowedMimeTypes = ['video/mp4', 'video/quicktime', 'video/webm'];
        const allowedExtensions = ['mp4', 'mov', 'webm'];
        const extension =
          file.originalname.split('.').pop()?.toLowerCase() ?? '';

        if (
          allowedMimeTypes.includes(file.mimetype) &&
          allowedExtensions.includes(extension)
        ) {
          cb(null, true);
        } else {
          cb(
            new BadRequestException(
              'Only video files are allowed (mp4, mov, webm).',
            ),
            false,
          );
        }
      },
    }),
  )
  uploadVideo(@UploadedFile() file: Express.Multer.File) {
    // Throw error if there's no file.
    if (!file) {
      throw new BadRequestException('Attach File.');
    }

    return {
      filename: file.filename,
    };
  }
}
