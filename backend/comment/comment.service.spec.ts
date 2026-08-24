import { Test, TestingModule } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { EntityManager, Repository, SelectQueryBuilder } from 'typeorm';
import {
  ForbiddenException,
  InternalServerErrorException,
  NotFoundException,
} from '@nestjs/common';
import { CommentService } from './comment.service';
import { CommentEntity } from './entity/comment.entity';
import { GetCommentsDto } from './dto/get-comments.dto';
import { PostService } from 'backend/post/post.service';
import { AuditLogService } from 'backend/audit-log/audit-log.service';
import { AuditTargetType } from 'backend/audit-log/audit-target-type.enum';
import { PostEntity } from 'backend/post/entity/post.entity';
import { UserEntity } from 'backend/user/entity/user.entity';
import { UserRole } from 'backend/auth/role/role';

// mockComment.creator.id === 1, so `author` manages by ownership; `postAuthor` owns the
// post the comment sits on and deliberately gains nothing from that (ADR 0023); `admin`
// manages by role (RBAC, ADR 0013).
const author = { id: 1, role: UserRole.user };
const postAuthor = { id: 2, role: UserRole.user };
const admin = { id: 9, role: UserRole.admin };

describe('CommentService', () => {
  let commentService: CommentService;
  let commentRepository: Repository<CommentEntity>;

  const mockPostService = {
    assertPostExists: jest.fn(),
  };

  const mockAuditLogService = {
    log: jest.fn(),
  };

  const mockComment: CommentEntity = {
    id: 3,
    body: 'Nice clip.',
    creator: { id: 1, email: 'author@test.com' } as UserEntity,
    post: { id: 5 } as PostEntity,
    createdAt: new Date(),
    updatedAt: new Date(),
  };

  const selectQueryBuilder = (getManyAndCount: jest.Mock) =>
    ({
      leftJoinAndSelect: jest.fn().mockReturnThis(),
      where: jest.fn().mockReturnThis(),
      orderBy: jest.fn().mockReturnThis(),
      addOrderBy: jest.fn().mockReturnThis(),
      take: jest.fn().mockReturnThis(),
      skip: jest.fn().mockReturnThis(),
      getManyAndCount,
    }) as unknown as SelectQueryBuilder<CommentEntity>;

  const insertQueryBuilder = (execute: jest.Mock) =>
    ({
      insert: jest.fn().mockReturnThis(),
      into: jest.fn().mockReturnThis(),
      values: jest.fn().mockReturnThis(),
      execute,
    }) as unknown as SelectQueryBuilder<CommentEntity>;

  beforeEach(async () => {
    const mockCommentRepository = {
      createQueryBuilder: jest.fn(),
      findOne: jest.fn(),
      update: jest.fn(),
      delete: jest.fn(),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        CommentService,
        {
          provide: getRepositoryToken(CommentEntity),
          useValue: mockCommentRepository,
        },
        { provide: PostService, useValue: mockPostService },
        { provide: AuditLogService, useValue: mockAuditLogService },
      ],
    }).compile();

    commentService = module.get<CommentService>(CommentService);
    commentRepository = module.get<Repository<CommentEntity>>(
      getRepositoryToken(CommentEntity),
    );
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  describe('getComments', () => {
    it('reads oldest-first with the id tiebreaker and paginates', async () => {
      const builder = selectQueryBuilder(
        jest.fn().mockResolvedValue([[mockComment], 1]),
      );
      jest
        .spyOn(commentRepository, 'createQueryBuilder')
        .mockReturnValue(builder);

      const [comments, count] = await commentService.getComments(
        5,
        new GetCommentsDto(),
      );

      expect(count).toBe(1);
      expect(comments[0].postId).toBe(5);
      // A thread reads in the order it was written — the opposite of the file/post lists.
      expect(builder.orderBy).toHaveBeenCalledWith('comment.createdAt', 'ASC');
      // Without a unique tiebreaker, OFFSET paging can repeat or skip rows (ADR 0021).
      expect(builder.addOrderBy).toHaveBeenCalledWith('comment.id', 'ASC');
      expect(builder.take).toHaveBeenCalledWith(20);
      expect(builder.skip).toHaveBeenCalledWith(0);
    });

    it('never joins the post relation — postId comes from the route', async () => {
      const builder = selectQueryBuilder(jest.fn().mockResolvedValue([[], 0]));
      jest
        .spyOn(commentRepository, 'createQueryBuilder')
        .mockReturnValue(builder);

      await commentService.getComments(5, new GetCommentsDto());

      // Joining it would repeat one post's row across every comment in the thread.
      expect(builder.leftJoinAndSelect).toHaveBeenCalledTimes(1);
      expect(builder.leftJoinAndSelect).toHaveBeenCalledWith(
        'comment.creator',
        'creator',
      );
    });

    it('throws when the post does not exist, before querying comments', async () => {
      mockPostService.assertPostExists.mockRejectedValueOnce(
        new NotFoundException(),
      );

      await expect(
        commentService.getComments(404, new GetCommentsDto()),
      ).rejects.toThrow(NotFoundException);
      expect(commentRepository.createQueryBuilder).not.toHaveBeenCalled();
    });
  });

  describe('create', () => {
    it('asks PostService first, then inserts and re-reads with the author', async () => {
      jest
        .spyOn(commentRepository, 'createQueryBuilder')
        .mockReturnValue(
          insertQueryBuilder(
            jest.fn().mockResolvedValue({ identifiers: [{ id: 3 }] }),
          ),
        );
      jest.spyOn(commentRepository, 'findOne').mockResolvedValue(mockComment);

      const result = await commentService.create(5, { body: 'Nice clip.' }, 1);

      // Existence is PostModule's judgment; this service never reads post_entity.
      expect(mockPostService.assertPostExists).toHaveBeenCalledWith(5);
      expect(result.id).toBe(3);
      expect(result.postId).toBe(5);
      expect(result.creator).toEqual({ id: 1, email: 'author@test.com' });
    });

    it('refuses to insert when the post is missing', async () => {
      mockPostService.assertPostExists.mockRejectedValueOnce(
        new NotFoundException(),
      );

      await expect(
        commentService.create(404, { body: 'orphan' }, 1),
      ).rejects.toThrow(NotFoundException);
      expect(commentRepository.createQueryBuilder).not.toHaveBeenCalled();
    });

    it('throws when the insert returns no usable id', async () => {
      jest
        .spyOn(commentRepository, 'createQueryBuilder')
        .mockReturnValue(
          insertQueryBuilder(
            jest.fn().mockResolvedValue({ identifiers: [{}] }),
          ),
        );

      await expect(
        commentService.create(5, { body: 'Nice clip.' }, 1),
      ).rejects.toThrow(InternalServerErrorException);
    });

    it('creates a second comment on an identical resubmission', async () => {
      // A comment has no unique column, so there is no natural idempotency key — the
      // repeat is a new row, exactly as for a post with no fileId (ADR 0023 D1).
      const execute = jest
        .fn()
        .mockResolvedValueOnce({ identifiers: [{ id: 3 }] })
        .mockResolvedValueOnce({ identifiers: [{ id: 4 }] });
      jest
        .spyOn(commentRepository, 'createQueryBuilder')
        .mockReturnValue(insertQueryBuilder(execute));
      jest
        .spyOn(commentRepository, 'findOne')
        .mockResolvedValueOnce(mockComment)
        .mockResolvedValueOnce({ ...mockComment, id: 4 });

      const first = await commentService.create(5, { body: 'same' }, 1);
      const second = await commentService.create(5, { body: 'same' }, 1);

      expect(first.id).not.toBe(second.id);
    });
  });

  describe('update', () => {
    it('lets the author edit the body', async () => {
      jest
        .spyOn(commentRepository, 'findOne')
        .mockResolvedValue({ ...mockComment, body: 'edited' });

      const result = await commentService.update(3, { body: 'edited' }, author);

      expect(commentRepository.update).toHaveBeenCalledWith(
        { id: 3 },
        { body: 'edited' },
      );
      expect(result.body).toBe('edited');
    });

    it('lets an admin edit a comment they did not write', async () => {
      jest.spyOn(commentRepository, 'findOne').mockResolvedValue(mockComment);

      await commentService.update(3, { body: 'moderated' }, admin);

      expect(commentRepository.update).toHaveBeenCalled();
    });

    it("forbids the post's author from editing a comment on their post", async () => {
      jest.spyOn(commentRepository, 'findOne').mockResolvedValue(mockComment);

      // The third authorization axis was rejected by ADR 0023: it would require a
      // comment.post.creator.id reach-through, and admin moderation covers the case.
      await expect(
        commentService.update(3, { body: 'silenced' }, postAuthor),
      ).rejects.toThrow(ForbiddenException);
      expect(commentRepository.update).not.toHaveBeenCalled();
    });

    it('treats an empty patch as a no-op rather than an error', async () => {
      jest.spyOn(commentRepository, 'findOne').mockResolvedValue(mockComment);

      await commentService.update(3, {}, author);

      // TypeORM rejects an empty update set, so the call must be skipped entirely.
      expect(commentRepository.update).not.toHaveBeenCalled();
    });

    it('throws NotFoundException when the comment is missing', async () => {
      jest.spyOn(commentRepository, 'findOne').mockResolvedValue(null);

      await expect(
        commentService.update(404, { body: 'x' }, author),
      ).rejects.toThrow(NotFoundException);
    });
  });

  describe('deleteComment', () => {
    it('deletes the row and audits COMMENT_DELETE after the delete', async () => {
      jest.spyOn(commentRepository, 'findOne').mockResolvedValue(mockComment);

      const result = await commentService.deleteComment(3, author);

      expect(commentRepository.delete).toHaveBeenCalledWith(3);
      expect(mockAuditLogService.log).toHaveBeenCalledWith(
        1,
        3,
        AuditTargetType.comment,
        'COMMENT_DELETE',
      );
      expect(result).toBe('Comment 3 deleted.');
    });

    it('forbids a stranger and leaves the row alone', async () => {
      jest.spyOn(commentRepository, 'findOne').mockResolvedValue(mockComment);

      await expect(commentService.deleteComment(3, postAuthor)).rejects.toThrow(
        ForbiddenException,
      );
      expect(commentRepository.delete).not.toHaveBeenCalled();
      expect(mockAuditLogService.log).not.toHaveBeenCalled();
    });

    it('throws NotFoundException when the comment is missing', async () => {
      jest.spyOn(commentRepository, 'findOne').mockResolvedValue(null);

      await expect(commentService.deleteComment(404, author)).rejects.toThrow(
        NotFoundException,
      );
      expect(commentRepository.delete).not.toHaveBeenCalled();
    });
  });

  // The account-deletion cascade (ADR 0020/0023 D5): UserService owns the transaction
  // and passes its EntityManager in, so comment rows still go through CommentService.
  describe('deleteCommentsOfCreator', () => {
    it('deletes by creatorId, not by a stale id list', async () => {
      const deleteBuilder = {
        delete: jest.fn().mockReturnThis(),
        from: jest.fn().mockReturnThis(),
        where: jest.fn().mockReturnThis(),
        execute: jest.fn().mockResolvedValue({ affected: 4 }),
      };
      const mockManager = {
        createQueryBuilder: jest.fn().mockReturnValue(deleteBuilder),
      };

      await commentService.deleteCommentsOfCreator(
        mockManager as unknown as EntityManager,
        7,
      );

      // Keyed by creatorId so a comment written between the read and the delete is
      // included — the read-then-delete race ADR 0020 forbids.
      expect(deleteBuilder.from).toHaveBeenCalledWith(CommentEntity);
      expect(deleteBuilder.where).toHaveBeenCalledWith(
        '"creatorId" = :creatorId',
        { creatorId: 7 },
      );
      expect(deleteBuilder.execute).toHaveBeenCalled();
    });
  });
});
