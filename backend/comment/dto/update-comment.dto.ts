// Purpose: validates the PATCH /comment/:id body — the editable subset of a comment.
// Usage: bound via @Body() in CommentController.update(); forwarded to CommentService.update().
// Rationale: body is the only mutable field, so PartialType over CreateCommentDto keeps the ≤1,000 bound in one place instead of restating it.

import { PartialType } from '@nestjs/swagger';
import { CreateCommentDto } from './create-comment.dto';

// Nothing is omitted, unlike UpdatePostDto: CreateCommentDto carries only `body`, and a
// comment cannot be moved to another post (that would be a new comment, not an edit).
export class UpdateCommentDto extends PartialType(CreateCommentDto) {}
