// Purpose: validates the PATCH /post/:id body — the editable subset of a post.
// Usage: bound via @Body() in PostController.update(); forwarded to PostService.update().
// Rationale: fileId must not be inheritable from CreatePostDto, so the shape is derived by OmitType rather than reused as-is.

import { OmitType, PartialType } from '@nestjs/swagger';
import { CreatePostDto } from './create-post.dto';

// fileId is omitted rather than inherited: the attachment is fixed at creation
// (ADR 0023 D1), so accepting it here would silently add a second claim surface.
// Detaching a video means deleting the post.
export class UpdatePostDto extends PartialType(
  OmitType(CreatePostDto, ['fileId'] as const),
) {}
