import { Test, TestingModule } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import {
  EntityManager,
  QueryFailedError,
  Repository,
  SelectQueryBuilder,
} from 'typeorm';
import {
  ConflictException,
  ForbiddenException,
  NotFoundException,
} from '@nestjs/common';
import { PostService } from './post.service';
import { PostEntity } from './entity/post.entity';
import { GetPostsDto } from './dto/get-posts.dto';
import { FileService } from 'backend/file/file.service';
import { AuditLogService } from 'backend/audit-log/audit-log.service';
import { AuditTargetType } from 'backend/audit-log/audit-target-type.enum';
import { FileEntity } from 'backend/file/entity/file.entity';
import { UserEntity } from 'backend/user/entity/user.entity';
import { UserRole } from 'backend/auth/role/role';

// mockPost.creator.id === 1이므로 `author`는 소유권으로 관리 권한을 갖고, `stranger`(작성자가
// 아닌 일반 user)는 거부되며, `admin`은 역할로 관리 권한을 갖는다 (RBAC, ADR 0013).
const author = { id: 1, role: UserRole.user };
const stranger = { id: 2, role: UserRole.user };
const admin = { id: 9, role: UserRole.admin };

describe('PostService', () => {
  let postService: PostService;
  let postRepository: Repository<PostEntity>;

  const mockFileService = {
    assertAttachableBy: jest.fn(),
    toResponse: jest.fn(),
  };

  const mockAuditLogService = {
    log: jest.fn(),
  };

  const mockFile: FileEntity = {
    id: 7,
    title: 'clip',
    filePath: 'file/upload/granted_clip.mp4',
    creator: { id: 1 } as UserEntity,
  };

  const mockPost: PostEntity = {
    id: 5,
    title: 'Hello board',
    body: 'First post.',
    creator: { id: 1, email: 'author@test.com' } as UserEntity,
    file: null,
    createdAt: new Date(),
    updatedAt: new Date(),
  };

  // getPosts/getPostById/findByFileId가 공유하는, join이 걸린 쿼리 빌더.
  const selectQueryBuilder = (
    result: Partial<Record<'getOne' | 'getManyAndCount', jest.Mock>>,
  ) =>
    ({
      leftJoinAndSelect: jest.fn().mockReturnThis(),
      where: jest.fn().mockReturnThis(),
      andWhere: jest.fn().mockReturnThis(),
      orderBy: jest.fn().mockReturnThis(),
      addOrderBy: jest.fn().mockReturnThis(),
      take: jest.fn().mockReturnThis(),
      skip: jest.fn().mockReturnThis(),
      ...result,
    }) as unknown as SelectQueryBuilder<PostEntity>;

  const insertQueryBuilder = (execute: jest.Mock) =>
    ({
      insert: jest.fn().mockReturnThis(),
      into: jest.fn().mockReturnThis(),
      values: jest.fn().mockReturnThis(),
      execute,
    }) as unknown as SelectQueryBuilder<PostEntity>;

  // TypeORM이 그대로 드러내는 Postgres unique_violation (driverError.code).
  const uniqueViolation = () =>
    new QueryFailedError(
      'INSERT',
      [],
      Object.assign(new Error('duplicate key'), { code: '23505' }),
    );

  beforeEach(async () => {
    const mockPostRepository = {
      createQueryBuilder: jest.fn(),
      findOne: jest.fn(),
      exists: jest.fn(),
      update: jest.fn(),
      delete: jest.fn(),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        PostService,
        {
          provide: getRepositoryToken(PostEntity),
          useValue: mockPostRepository,
        },
        { provide: FileService, useValue: mockFileService },
        { provide: AuditLogService, useValue: mockAuditLogService },
      ],
    }).compile();

    postService = module.get<PostService>(PostService);
    postRepository = module.get<Repository<PostEntity>>(
      getRepositoryToken(PostEntity),
    );
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  describe('getPosts', () => {
    it('applies the default sort with the id tiebreaker and paginates', async () => {
      const builder = selectQueryBuilder({
        getManyAndCount: jest.fn().mockResolvedValue([[mockPost], 1]),
      });
      jest.spyOn(postRepository, 'createQueryBuilder').mockReturnValue(builder);

      const [posts, count] = await postService.getPosts(new GetPostsDto());

      expect(count).toBe(1);
      expect(posts[0].id).toBe(mockPost.id);
      expect(builder.orderBy).toHaveBeenCalledWith('post.createdAt', 'DESC');
      // 고유한 tiebreaker가 없으면 OFFSET 페이징이 행을 중복하거나 건너뛸 수 있다 (ADR 0021).
      expect(builder.addOrderBy).toHaveBeenCalledWith('post.id', 'DESC');
      expect(builder.take).toHaveBeenCalledWith(20);
      expect(builder.skip).toHaveBeenCalledWith(0);
    });

    it('escapes LIKE wildcards in the search term', async () => {
      const builder = selectQueryBuilder({
        getManyAndCount: jest.fn().mockResolvedValue([[], 0]),
      });
      jest.spyOn(postRepository, 'createQueryBuilder').mockReturnValue(builder);

      const query = new GetPostsDto();
      query.search = '100%_off';
      await postService.getPosts(query);

      expect(builder.andWhere).toHaveBeenCalledWith(
        "post.title ILIKE :term ESCAPE '\\'",
        { term: '%100\\%\\_off%' },
      );
    });

    it('omits the duplicate tiebreaker when sorting by id', async () => {
      const builder = selectQueryBuilder({
        getManyAndCount: jest.fn().mockResolvedValue([[], 0]),
      });
      jest.spyOn(postRepository, 'createQueryBuilder').mockReturnValue(builder);

      const query = new GetPostsDto();
      query.sortBy = 'id';
      await postService.getPosts(query);

      expect(builder.orderBy).toHaveBeenCalledWith('post.id', 'DESC');
      expect(builder.addOrderBy).not.toHaveBeenCalled();
    });
  });

  describe('getPostById', () => {
    it('composes the attached file through FileService', async () => {
      const withFile: PostEntity = { ...mockPost, file: mockFile };
      const builder = selectQueryBuilder({
        getOne: jest.fn().mockResolvedValue(withFile),
      });
      jest.spyOn(postRepository, 'createQueryBuilder').mockReturnValue(builder);
      mockFileService.toResponse.mockReturnValue({
        id: 7,
        title: 'clip',
        fileUrl: 'http://localhost:3000/file/upload/granted_clip.mp4',
      });

      const result = await postService.getPostById(5);

      // BASE_URL 조립은 정확히 한 곳에서만 이뤄진다 (ADR 0023).
      expect(mockFileService.toResponse).toHaveBeenCalledWith(mockFile);
      expect(result.file?.fileUrl).toContain('granted_clip.mp4');
      expect(result.creator?.email).toBe('author@test.com');
    });

    it('throws POST_NOT_FOUND for a missing post', async () => {
      const builder = selectQueryBuilder({
        getOne: jest.fn().mockResolvedValue(null),
      });
      jest.spyOn(postRepository, 'createQueryBuilder').mockReturnValue(builder);

      await expect(postService.getPostById(404)).rejects.toThrow(
        NotFoundException,
      );
    });
  });

  // CommentService가 댓글을 쓰기 전에 확인을 요청한다: 게시글이 존재하는지는
  // PostModule의 판단이지, 다른 모듈이 post_entity를 직접 쿼리할 일이 아니다 (ADR 0023).
  describe('assertPostExists', () => {
    it('passes for an existing post without loading relations', async () => {
      jest.spyOn(postRepository, 'exists').mockResolvedValue(true);

      await expect(postService.assertPostExists(5)).resolves.toBeUndefined();
      // getPostById를 썼다면 아무도 읽지 않을 응답을 위해 creator와 file join까지 끌고 왔을 것이다.
      expect(postRepository.createQueryBuilder).not.toHaveBeenCalled();
    });

    it('throws POST_NOT_FOUND for a missing post', async () => {
      jest.spyOn(postRepository, 'exists').mockResolvedValue(false);

      await expect(postService.assertPostExists(404)).rejects.toThrow(
        NotFoundException,
      );
    });
  });

  describe('create', () => {
    const dto = { title: 'Hello board', body: 'First post.', fileId: 7 };

    it('creates a post and returns it as a fresh (non-replayed) result', async () => {
      const insert = insertQueryBuilder(
        jest.fn().mockResolvedValue({ identifiers: [{ id: 5 }] }),
      );
      const lookup = selectQueryBuilder({
        getOne: jest.fn().mockResolvedValue(null),
      });
      const reread = selectQueryBuilder({
        getOne: jest.fn().mockResolvedValue(mockPost),
      });
      jest
        .spyOn(postRepository, 'createQueryBuilder')
        .mockReturnValueOnce(lookup)
        .mockReturnValueOnce(insert)
        .mockReturnValueOnce(reread);

      const result = await postService.create(dto, 1);

      expect(mockFileService.assertAttachableBy).toHaveBeenCalledWith(7, 1);
      expect(result.replayed).toBe(false);
      expect(result.post.id).toBe(5);
    });

    it('never asks about a file when the post carries none', async () => {
      const insert = insertQueryBuilder(
        jest.fn().mockResolvedValue({ identifiers: [{ id: 5 }] }),
      );
      const reread = selectQueryBuilder({
        getOne: jest.fn().mockResolvedValue(mockPost),
      });
      jest
        .spyOn(postRepository, 'createQueryBuilder')
        .mockReturnValueOnce(insert)
        .mockReturnValueOnce(reread);

      await postService.create({ title: 'Text only', body: 'No video.' }, 1);

      expect(mockFileService.assertAttachableBy).not.toHaveBeenCalled();
    });

    it('replays the existing post when the identical payload is resubmitted', async () => {
      const lookup = selectQueryBuilder({
        getOne: jest.fn().mockResolvedValue(mockPost),
      });
      jest.spyOn(postRepository, 'createQueryBuilder').mockReturnValue(lookup);

      const result = await postService.create(dto, 1);

      expect(result.replayed).toBe(true);
      expect(result.post.id).toBe(5);
      // 재시도는 쓰기를 아예 열면 안 된다 — 조회 한 번, insert는 없다.
      expect(postRepository.createQueryBuilder).toHaveBeenCalledTimes(1);
    });

    it('rejects a resubmission whose text differs (POST_FILE_TAKEN)', async () => {
      const lookup = selectQueryBuilder({
        getOne: jest.fn().mockResolvedValue(mockPost),
      });
      jest.spyOn(postRepository, 'createQueryBuilder').mockReturnValue(lookup);

      // ADR 0019의 무조건적 replay와는 다르다: 작성자가 쓴 텍스트가 다르면 실제로
      // 새로운 제출이므로, 예전 게시글로 응답해서는 안 된다.
      await expect(
        postService.create({ ...dto, body: 'Rewritten.' }, 1),
      ).rejects.toThrow(ConflictException);
    });

    it("rejects a claim on a post that is not the requester's", async () => {
      const lookup = selectQueryBuilder({
        getOne: jest.fn().mockResolvedValue(mockPost),
      });
      jest.spyOn(postRepository, 'createQueryBuilder').mockReturnValue(lookup);

      // 파일 소유권을 재할당할 수 있기 때문에(PATCH /file/:id userId) 도달 가능한 경로다.
      await expect(postService.create(dto, 2)).rejects.toThrow(
        ConflictException,
      );
    });

    it('re-resolves a concurrent double-submit lost to the unique constraint', async () => {
      const insert = insertQueryBuilder(
        jest.fn().mockRejectedValue(uniqueViolation()),
      );
      const lookupBefore = selectQueryBuilder({
        getOne: jest.fn().mockResolvedValue(null),
      });
      const lookupAfter = selectQueryBuilder({
        getOne: jest.fn().mockResolvedValue(mockPost),
      });
      jest
        .spyOn(postRepository, 'createQueryBuilder')
        .mockReturnValueOnce(lookupBefore)
        .mockReturnValueOnce(insert)
        .mockReturnValueOnce(lookupAfter);

      const result = await postService.create(dto, 1);

      // 경합에서 진 쪽은 결국 같은 요청이 두 번 온 것이다 — replay일 뿐, 500이 아니다.
      expect(result.replayed).toBe(true);
      expect(result.post.id).toBe(5);
    });

    it('propagates a 403 from the file ownership check', async () => {
      mockFileService.assertAttachableBy.mockRejectedValueOnce(
        new ForbiddenException(),
      );

      await expect(postService.create(dto, 2)).rejects.toThrow(
        ForbiddenException,
      );
      // 소유권 검사는 무엇이 쓰이거나 조회되기도 전에 먼저 실행된다.
      expect(postRepository.createQueryBuilder).not.toHaveBeenCalled();
    });
  });

  describe('update', () => {
    it('updates the title and body for the author', async () => {
      jest.spyOn(postRepository, 'findOne').mockResolvedValue(mockPost);
      const reread = selectQueryBuilder({
        getOne: jest.fn().mockResolvedValue(mockPost),
      });
      jest.spyOn(postRepository, 'createQueryBuilder').mockReturnValue(reread);

      await postService.update(5, { title: 'Edited' }, author);

      expect(postRepository.update).toHaveBeenCalledWith(
        { id: 5 },
        { title: 'Edited' },
      );
    });

    it('allows an admin to update another user’s post', async () => {
      jest.spyOn(postRepository, 'findOne').mockResolvedValue(mockPost);
      const reread = selectQueryBuilder({
        getOne: jest.fn().mockResolvedValue(mockPost),
      });
      jest.spyOn(postRepository, 'createQueryBuilder').mockReturnValue(reread);

      await postService.update(5, { body: 'Moderated.' }, admin);

      expect(postRepository.update).toHaveBeenCalled();
    });

    it('forbids a stranger from updating the post', async () => {
      jest.spyOn(postRepository, 'findOne').mockResolvedValue(mockPost);

      await expect(
        postService.update(5, { title: 'Hijack' }, stranger),
      ).rejects.toThrow(ForbiddenException);
      expect(postRepository.update).not.toHaveBeenCalled();
    });

    it('treats an empty patch as a no-op instead of an empty UPDATE', async () => {
      jest.spyOn(postRepository, 'findOne').mockResolvedValue(mockPost);
      const reread = selectQueryBuilder({
        getOne: jest.fn().mockResolvedValue(mockPost),
      });
      jest.spyOn(postRepository, 'createQueryBuilder').mockReturnValue(reread);

      await postService.update(5, {}, author);

      expect(postRepository.update).not.toHaveBeenCalled();
    });

    it('throws POST_NOT_FOUND for a missing post', async () => {
      jest.spyOn(postRepository, 'findOne').mockResolvedValue(null);

      await expect(
        postService.update(404, { title: 'x' }, author),
      ).rejects.toThrow(NotFoundException);
    });
  });

  describe('deletePost', () => {
    it('deletes the author’s own post and audits POST_DELETE', async () => {
      jest.spyOn(postRepository, 'findOne').mockResolvedValue(mockPost);

      await postService.deletePost(5, author);

      expect(postRepository.delete).toHaveBeenCalledWith(5);
      expect(mockAuditLogService.log).toHaveBeenCalledWith(
        1,
        5,
        AuditTargetType.post,
        'POST_DELETE',
      );
    });

    it('forbids a stranger from deleting the post', async () => {
      jest.spyOn(postRepository, 'findOne').mockResolvedValue(mockPost);

      await expect(postService.deletePost(5, stranger)).rejects.toThrow(
        ForbiddenException,
      );
      expect(postRepository.delete).not.toHaveBeenCalled();
    });

    it('throws POST_NOT_FOUND for a missing post', async () => {
      jest.spyOn(postRepository, 'findOne').mockResolvedValue(null);

      await expect(postService.deletePost(404, author)).rejects.toThrow(
        NotFoundException,
      );
    });
  });

  describe('deletePostsOfCreator', () => {
    it('deletes by creatorId inside the caller’s transaction and reports the count', async () => {
      const execute = jest.fn().mockResolvedValue({ affected: 3 });
      const deleteBuilder = {
        delete: jest.fn().mockReturnThis(),
        from: jest.fn().mockReturnThis(),
        where: jest.fn().mockReturnThis(),
        execute,
      };
      const manager = {
        createQueryBuilder: jest.fn().mockReturnValue(deleteBuilder),
      } as unknown as EntityManager;

      const deleted = await postService.deletePostsOfCreator(manager, 1);

      expect(deleted).toBe(3);
      // creatorId 기준으로만 삭제하고, 직전에 읽어둔 id 목록으로는 절대 삭제하지 않는다 —
      // 그렇게 하면 ADR 0020이 막았던 read-then-delete 경합이 다시 열린다.
      expect(deleteBuilder.where).toHaveBeenCalledWith(
        '"creatorId" = :creatorId',
        { creatorId: 1 },
      );
    });
  });
});
