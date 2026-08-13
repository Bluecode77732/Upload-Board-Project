// Purpose: the outward shape of a comment — its text, its author, and the post it hangs off.
// Usage: returned by every CommentService method; composed in CommentService.toResponse().
// Rationale: entities stay pure DB models (Boundary Validation & Response Shaping); PostResponseDto cannot serve here because a comment must not drag its post's body and file into every row of a thread.

export class CommentResponseDto {
  id!: number;
  body!: string;
  creator?: {
    id: number;
    email: string;
  };
  // The id alone, never the embedded post: a thread of 20 comments would otherwise
  // repeat the same post body and file URL 20 times.
  postId!: number;
  createdAt!: Date;
  updatedAt!: Date;
}
