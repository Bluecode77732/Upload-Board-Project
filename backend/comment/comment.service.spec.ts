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

// mockComment.creator.id === 1이라 `author`는 소유권으로 관리 가능하다; `postAuthor`는
// 댓글이 달린 게시글의 작성자지만 그로부터 아무 권한도 얻지 못한다(ADR 0023, 의도된 설계);
// `admin`은 role로 관리 가능하다(RBAC, ADR 0013).
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
      // 스레드는 작성된 순서대로 읽힌다 — 파일/게시글 목록과는 반대다.
      expect(builder.orderBy).toHaveBeenCalledWith('comment.createdAt', 'ASC');
      // 유일 타이브레이커가 없으면 OFFSET 페이징에서 행이 중복되거나 누락될 수 있다(ADR 0021).
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

      // 조인하면 스레드의 모든 댓글마다 같은 게시글 행이 반복된다.
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

      // 존재 여부는 PostModule의 판단이다; 이 서비스는 post_entity를 절대 직접 읽지 않는다.
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
      // 댓글에는 유니크 컬럼이 없어 자연스러운 idempotency key가 없다 — 재제출은
      // fileId 없는 게시글과 마찬가지로 새 행이 된다(ADR 0023 D1).
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

      // 세 번째 권한 축은 ADR 0023에서 기각됐다: comment.post.creator.id로
      // reach-through해야 하는데, admin 관리 권한으로 이미 그 경우를 커버한다.
      await expect(
        commentService.update(3, { body: 'silenced' }, postAuthor),
      ).rejects.toThrow(ForbiddenException);
      expect(commentRepository.update).not.toHaveBeenCalled();
    });

    it('treats an empty patch as a no-op rather than an error', async () => {
      jest.spyOn(commentRepository, 'findOne').mockResolvedValue(mockComment);

      await commentService.update(3, {}, author);

      // TypeORM은 빈 update set을 거부하므로, 호출 자체를 건너뛰어야 한다.
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

  // 계정 삭제 캐스케이드(ADR 0020/0023 D5): UserService가 트랜잭션을 소유하고
  // 자신의 EntityManager를 넘기므로, 댓글 행도 여전히 CommentService를 거친다.
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

      // creatorId를 키로 삼아, 읽기와 삭제 사이에 작성된 댓글도 포함되게 한다 —
      // ADR 0020이 금지하는 read-then-delete 레이스를 막는다.
      expect(deleteBuilder.from).toHaveBeenCalledWith(CommentEntity);
      expect(deleteBuilder.where).toHaveBeenCalledWith(
        '"creatorId" = :creatorId',
        { creatorId: 7 },
      );
      expect(deleteBuilder.execute).toHaveBeenCalled();
    });
  });
});
