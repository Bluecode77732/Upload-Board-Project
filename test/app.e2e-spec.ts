import { INestApplication } from '@nestjs/common';
import { DataSource } from 'typeorm';
import request from 'supertest';
import { App } from 'supertest/types';
import { existsSync } from 'fs';
import { unlink } from 'fs/promises';
import { join } from 'path';
import { FileEntity } from '../backend/file/entity/file.entity';
import { FileMediaType } from '../backend/file/entity/file-media-type.enum';
import { UserEntity } from '../backend/user/entity/user.entity';
import { CommentEntity } from '../backend/comment/entity/comment.entity';
import { UserRole } from '../backend/auth/role/role';
import {
  setupE2E,
  teardownE2E,
  truncateAll,
  basic,
  refreshCookieFrom,
} from './e2e-utils';

// 유닛 테스트가 닿을 수 없는 경로들을 엔드투엔드로 커버한다: 실제 HTTP+DB를 거치는 인증 흐름,
// 리프레시 회전/재사용(ADR 0012), RBAC 소유권 403, 목록 페이지네이션, temp_ → granted_ 실제
// 승격, 그리고 삭제 정책 — 계정 캐스케이드, 그 409 거부, 저장 파일 제거까지 확인한다(ADR 0020).
// 로컬 5435 포트의 Postgres가 필요하고(docker compose up -d db), 스위트는 임시 DB를 소유한다(e2e-utils 참고).
describe('Sharenpo API (e2e)', () => {
  let app: INestApplication;
  let server: App;
  // 테스트가 만든 실제 파일들; 디스크를 깨끗하게 유지하려고 각 테스트 후 unlink한다.
  let createdFiles: string[] = [];

  const PW = 'pw12345678';

  const register = (email: string, password = PW) =>
    request(server)
      .post('/auth/register')
      .set('Authorization', basic(email, password));

  async function createUser(email: string, password = PW) {
    const reg = await register(email, password).expect(201);
    const signin = await request(server)
      .post('/auth/signin')
      .set('Authorization', basic(email, password))
      .expect(201);
    return {
      id: reg.body.id as number,
      email,
      accessToken: signin.body.accessToken as string,
      refreshCookie: refreshCookieFrom(signin),
    };
  }

  const auth = (token: string) => ({ Authorization: `Bearer ${token}` });

  // 파일 행을 실제 파일 없이 직접 시드한다 — 승격 경로가 아니라 메타데이터 경로를
  // 검증하는 목록/소유권 테스트용.
  async function seedFile(title: string, creatorId: number): Promise<number> {
    const result = await app
      .get(DataSource)
      .getRepository(FileEntity)
      .insert({
        title,
        filePath: `file/upload/granted_${title}.mp4`,
        mediaType: FileMediaType.video,
        creator: { id: creatorId },
      });
    return result.identifiers[0].id as number;
  }

  // DB에서 직접 승격한다: PATCH /user/:id/role은 superadmin 전용이고, 모든 요청이
  // JwtStrategy.validate로 role을 매번 다시 읽으므로, 기존 토큰이 재로그인 없이도
  // 새 랭크를 즉시 반영한다.
  async function promoteToAdmin(id: number): Promise<void> {
    await app
      .get(DataSource)
      .getRepository(UserEntity)
      .update({ id }, { role: UserRole.admin });
  }

  beforeAll(async () => {
    app = await setupE2E();
    server = app.getHttpServer();
  });

  afterAll(async () => {
    await teardownE2E(app);
  });

  beforeEach(async () => {
    await truncateAll(app);
    createdFiles = [];
  });

  afterEach(async () => {
    await Promise.all(
      createdFiles
        .filter((f) => existsSync(f))
        .map((f) => unlink(f).catch(() => undefined)),
    );
  });

  describe('Auth flow', () => {
    it('registers a user and never leaks password/refreshTokenHash', async () => {
      const res = await register('reg@e.com').expect(201);

      expect(res.body).toMatchObject({ email: 'reg@e.com', role: 'user' });
      expect(res.body.id).toEqual(expect.any(Number));
      expect(res.body.password).toBeUndefined();
      expect(res.body.refreshTokenHash).toBeUndefined();
    });

    it('rejects a duplicate email with AUTH_EMAIL_TAKEN', async () => {
      await register('dup@e.com').expect(201);
      const res = await register('dup@e.com').expect(400);
      expect(res.body.code).toBe('AUTH_EMAIL_TAKEN');
    });

    it('rejects a malformed Basic token with AUTH_BAD_TOKEN_FORMAT', async () => {
      const res = await request(server)
        .post('/auth/register')
        .set('Authorization', 'Basic Zm9v') // base64("foo") — no ":" separator
        .expect(400);
      expect(res.body.code).toBe('AUTH_BAD_TOKEN_FORMAT');
    });

    it('signs in: returns an access token and sets the httpOnly refresh cookie', async () => {
      await register('signin@e.com').expect(201);
      const res = await request(server)
        .post('/auth/signin')
        .set('Authorization', basic('signin@e.com', PW))
        .expect(201);

      expect(res.body.accessToken).toEqual(expect.any(String));
      const cookie = refreshCookieFrom(res);
      expect(cookie).toMatch(/^refreshToken=/);
      const rawCookies = res.headers['set-cookie'] as unknown as string[];
      expect(rawCookies.join(';')).toMatch(/HttpOnly/i);
    });

    it('rejects a wrong password with AUTH_INVALID_CREDENTIALS', async () => {
      await register('pw@e.com').expect(201);
      const res = await request(server)
        .post('/auth/signin')
        .set('Authorization', basic('pw@e.com', 'wrong-password'))
        .expect(400);
      expect(res.body.code).toBe('AUTH_INVALID_CREDENTIALS');
    });

    it('blocks a protected route without a token (AUTH_UNAUTHORIZED)', async () => {
      const res = await request(server).get('/file').expect(401);
      expect(res.body.code).toBe('AUTH_UNAUTHORIZED');
    });

    it('allows a protected route with a valid token', async () => {
      const user = await createUser('ok@e.com');
      await request(server)
        .get('/file')
        .set(auth(user.accessToken))
        .expect(200);
    });
  });

  describe('Refresh rotation & reuse (ADR 0012)', () => {
    it('rotates the pair: new access token and a new refresh cookie', async () => {
      const user = await createUser('rot@e.com');
      const res = await request(server)
        .post('/auth/token/refresh')
        .set('Cookie', user.refreshCookie)
        .expect(201);

      expect(res.body.accessToken).toEqual(expect.any(String));
      expect(refreshCookieFrom(res)).not.toBe(user.refreshCookie);
    });

    it('detects reuse of a rotated-out cookie and invalidates the session', async () => {
      const user = await createUser('reuse@e.com');
      const rotated = await request(server)
        .post('/auth/token/refresh')
        .set('Cookie', user.refreshCookie)
        .expect(201);
      const newCookie = refreshCookieFrom(rotated);

      // 원본(이제 회전으로 무효화된) 쿠키를 다시 쓰면 재사용이 된다.
      const reuse = await request(server)
        .post('/auth/token/refresh')
        .set('Cookie', user.refreshCookie)
        .expect(401);
      expect(reuse.body.code).toBe('AUTH_REFRESH_REUSED');

      // 세션 전체가 이제 죽었다 — 새로 회전된 쿠키조차 거부된다.
      const after = await request(server)
        .post('/auth/token/refresh')
        .set('Cookie', newCookie)
        .expect(401);
      expect(after.body.code).toBe('AUTH_TOKEN_INVALID');
    });

    it('rejects a missing refresh cookie with AUTH_TOKEN_INVALID', async () => {
      const res = await request(server).post('/auth/token/refresh').expect(401);
      expect(res.body.code).toBe('AUTH_TOKEN_INVALID');
    });

    it('signs out: clears the session so a later refresh is refused', async () => {
      const user = await createUser('out@e.com');
      await request(server)
        .post('/auth/signout')
        .set(auth(user.accessToken))
        .expect(201);

      const res = await request(server)
        .post('/auth/token/refresh')
        .set('Cookie', user.refreshCookie)
        .expect(401);
      expect(res.body.code).toBe('AUTH_TOKEN_INVALID');
    });
  });

  describe('Ownership & RBAC (ADR 0013)', () => {
    it('forbids a non-owner from updating another user', async () => {
      const a = await createUser('own-a@e.com');
      const b = await createUser('own-b@e.com');

      const res = await request(server)
        .patch(`/user/${a.id}`)
        .set(auth(b.accessToken))
        .send({ email: 'hijack@e.com' })
        .expect(403);
      expect(res.body.code).toBe('FORBIDDEN_NOT_OWNER');
    });

    it("forbids a non-owner from updating or deleting another user's file", async () => {
      const a = await createUser('file-a@e.com');
      const b = await createUser('file-b@e.com');
      const fileId = await seedFile('owned-by-a', a.id);

      const update = await request(server)
        .patch(`/file/${fileId}`)
        .set(auth(b.accessToken))
        .send({ title: 'stolen' })
        .expect(403);
      expect(update.body.code).toBe('FORBIDDEN_NOT_OWNER');

      const del = await request(server)
        .delete(`/file/${fileId}`)
        .set(auth(b.accessToken))
        .expect(403);
      expect(del.body.code).toBe('FORBIDDEN_NOT_OWNER');

      // 작성자는 자기 파일을 삭제할 수 있다.
      await request(server)
        .delete(`/file/${fileId}`)
        .set(auth(a.accessToken))
        .expect(200);
    });

    it('restricts the admin-only user listing (GET /user) for a plain user', async () => {
      const user = await createUser('plain@e.com');
      const res = await request(server)
        .get('/user')
        .set(auth(user.accessToken))
        .expect(403);
      expect(res.body.code).toBe('FORBIDDEN');
    });
  });

  describe('Pagination (GET /file)', () => {
    it('honors take/skip and returns the total count', async () => {
      const user = await createUser('page@e.com');
      await seedFile('page-1', user.id);
      await seedFile('page-2', user.id);
      await seedFile('page-3', user.id);

      const first = await request(server)
        .get('/file?take=2&skip=0')
        .set(auth(user.accessToken))
        .expect(200);
      expect(first.body[1]).toBe(3); // total count
      expect(first.body[0]).toHaveLength(2);

      const second = await request(server)
        .get('/file?take=2&skip=2')
        .set(auth(user.accessToken))
        .expect(200);
      expect(second.body[0]).toHaveLength(1);
    });

    it('rejects an out-of-range take with VALIDATION_FAILED', async () => {
      const user = await createUser('page-bad@e.com');
      const res = await request(server)
        .get('/file?take=0')
        .set(auth(user.accessToken))
        .expect(400);
      expect(res.body.code).toBe('VALIDATION_FAILED');
    });
  });

  describe('Search / filter / sort (GET /file)', () => {
    // supertest는 body를 `any`로 타입 지정한다; [files, count] 튜플 형태를 여기서 한 번만
    // 단언해두면 이후 각 expectation은 타입 있는 값에서 title을 읽을 수 있다.
    const titlesOf = (body: unknown): string[] =>
      (body as [{ title: string }[], number])[0].map((f) => f.title);

    it('defaults to newest first (createdAt DESC, id as tiebreaker)', async () => {
      const user = await createUser('sort-default@e.com');
      await seedFile('sort-1', user.id);
      await seedFile('sort-2', user.id);
      await seedFile('sort-3', user.id);

      const res = await request(server)
        .get('/file')
        .set(auth(user.accessToken))
        .expect(200);

      expect(titlesOf(res.body)).toEqual(['sort-3', 'sort-2', 'sort-1']);
    });

    it('sorts by an allowed field in the requested direction', async () => {
      const user = await createUser('sort-title@e.com');
      await seedFile('charlie', user.id);
      await seedFile('alpha', user.id);
      await seedFile('bravo', user.id);

      const res = await request(server)
        .get('/file?sortBy=title&order=ASC')
        .set(auth(user.accessToken))
        .expect(200);

      expect(titlesOf(res.body)).toEqual(['alpha', 'bravo', 'charlie']);
    });

    it('rejects a sort field outside the whitelist with VALIDATION_FAILED', async () => {
      const user = await createUser('sort-bad@e.com');
      // 존재하지만 제공되지 않는 컬럼이다 — 결정하는 건 스키마가 아니라 화이트리스트다.
      const res = await request(server)
        .get('/file?sortBy=filePath')
        .set(auth(user.accessToken))
        .expect(400);
      expect(res.body.code).toBe('VALIDATION_FAILED');
    });

    it('rejects an unknown sort direction with VALIDATION_FAILED', async () => {
      const user = await createUser('order-bad@e.com');
      const res = await request(server)
        .get('/file?order=DROP')
        .set(auth(user.accessToken))
        .expect(400);
      expect(res.body.code).toBe('VALIDATION_FAILED');
    });

    it('searches the title by case-insensitive partial match', async () => {
      const user = await createUser('search@e.com');
      await seedFile('Summer Holiday Trip', user.id);
      await seedFile('Work Video', user.id);

      const res = await request(server)
        .get('/file?search=holiday')
        .set(auth(user.accessToken))
        .expect(200);

      expect(res.body[1]).toBe(1);
      expect(titlesOf(res.body)).toEqual(['Summer Holiday Trip']);
    });

    it('treats a LIKE wildcard in the search term literally', async () => {
      const user = await createUser('search-wild@e.com');
      await seedFile('100% wool', user.id);
      await seedFile('plain cotton', user.id);

      // 이스케이프하지 않으면 '%'가 그 문자를 포함한 행이 아니라 모든 행에 매칭된다.
      const res = await request(server)
        .get('/file?search=%25')
        .set(auth(user.accessToken))
        .expect(200);

      expect(res.body[1]).toBe(1);
      expect(titlesOf(res.body)).toEqual(['100% wool']);
    });

    it('returns an empty page for a search that matches nothing', async () => {
      const user = await createUser('search-none@e.com');
      await seedFile('only-file', user.id);

      const res = await request(server)
        .get('/file?search=nothing-matches-this')
        .set(auth(user.accessToken))
        .expect(200);

      expect(res.body[0]).toHaveLength(0);
      expect(res.body[1]).toBe(0);
    });

    it('filters by creator', async () => {
      const owner = await createUser('filter-owner@e.com');
      const other = await createUser('filter-other@e.com');
      await seedFile('owned-1', owner.id);
      await seedFile('owned-2', owner.id);
      await seedFile('other-1', other.id);

      const res = await request(server)
        .get(`/file?creatorId=${owner.id}&sortBy=title&order=ASC`)
        .set(auth(owner.accessToken))
        .expect(200);

      expect(res.body[1]).toBe(2);
      expect(titlesOf(res.body)).toEqual(['owned-1', 'owned-2']);
    });

    it('combines search, filter, sort and pagination in one query', async () => {
      const owner = await createUser('combo-owner@e.com');
      const other = await createUser('combo-other@e.com');
      await seedFile('trip alpha', owner.id);
      await seedFile('trip bravo', owner.id);
      await seedFile('trip charlie', owner.id);
      await seedFile('trip delta', other.id);
      await seedFile('unrelated', owner.id);

      const res = await request(server)
        .get(
          `/file?search=trip&creatorId=${owner.id}&sortBy=title&order=ASC&take=2&skip=1`,
        )
        .set(auth(owner.accessToken))
        .expect(200);

      // count는 필터링된 전체 개수이지 페이지 길이가 아니다.
      expect(res.body[1]).toBe(3);
      expect(titlesOf(res.body)).toEqual(['trip bravo', 'trip charlie']);
    });

    it('rejects an undeclared query parameter with VALIDATION_FAILED', async () => {
      const user = await createUser('extra-param@e.com');
      const res = await request(server)
        .get('/file?orderBy=title')
        .set(auth(user.accessToken))
        .expect(400);
      expect(res.body.code).toBe('VALIDATION_FAILED');
    });
  });

  describe('Two-phase upload promotion (temp_ → granted_)', () => {
    it('attaches a video then promotes it, moving the file to file/upload', async () => {
      const user = await createUser('upload@e.com');

      const attach = await request(server)
        .post('/upload/attach')
        .set(auth(user.accessToken))
        .attach('video', Buffer.from('fake-mp4-bytes'), {
          filename: 'sample.mp4',
          contentType: 'video/mp4',
        })
        .expect(201);

      const filename = attach.body.filename as string;
      expect(filename).toMatch(/^temp_.*\.mp4$/);
      const tempPath = join(process.cwd(), 'file', 'temp', filename);
      const grantedName = filename.replace('temp_', 'granted_');
      const grantedPath = join(process.cwd(), 'file', 'upload', grantedName);
      createdFiles.push(tempPath, grantedPath);
      expect(existsSync(tempPath)).toBe(true);

      const promote = await request(server)
        .post('/file')
        .set(auth(user.accessToken))
        .send({ title: 'promoted-clip', filePath: filename })
        .expect(201);

      // file/upload는 더 이상 정적으로 서빙되지 않는다(ADR 0025 D2) — fileUrl은 이제
      // 정적 경로가 아니라 접근 제어되는 콘텐츠 엔드포인트를 가리킨다.
      expect(promote.body.fileUrl).toBe(
        `http://localhost:3000/file/${promote.body.id}/content`,
      );
      expect(existsSync(grantedPath)).toBe(true);
      expect(existsSync(tempPath)).toBe(false);
    });

    // 중복 제출 계약(ADR 0019): attach가 발급한 filename은 일회성 클레임 토큰이라,
    // 재제출하면 에러가 아니라 replay된다.
    it('replays the same file when the identical claim is submitted twice', async () => {
      const user = await createUser('idem@e.com');

      const attach = await request(server)
        .post('/upload/attach')
        .set(auth(user.accessToken))
        .attach('video', Buffer.from('fake-mp4-bytes'), {
          filename: 'sample.mp4',
          contentType: 'video/mp4',
        })
        .expect(201);

      const filename = attach.body.filename as string;
      createdFiles.push(
        join(process.cwd(), 'file', 'temp', filename),
        join(
          process.cwd(),
          'file',
          'upload',
          filename.replace('temp_', 'granted_'),
        ),
      );

      const body = { title: 'retried-clip', filePath: filename };
      const first = await request(server)
        .post('/file')
        .set(auth(user.accessToken))
        .send(body)
        .expect(201);

      // 재시도는 (새로 만들어진 것 없이) 같은 리소스로 200을 응답한다.
      const retry = await request(server)
        .post('/file')
        .set(auth(user.accessToken))
        .send(body)
        .expect(200);

      expect(retry.body.id).toBe(first.body.id);
      expect(retry.body.fileUrl).toBe(first.body.fileUrl);

      // 행이 정확히 하나만 존재한다 — 재시도는 아무것도 만들지 않았다.
      const list = await request(server)
        .get('/file')
        .set(auth(user.accessToken))
        .expect(200);
      expect(list.body[1]).toBe(1);
    });

    it('rejects another user resubmitting a claimed filename (FILE_ALREADY_CLAIMED)', async () => {
      const owner = await createUser('claim-owner@e.com');
      const other = await createUser('claim-other@e.com');

      const attach = await request(server)
        .post('/upload/attach')
        .set(auth(owner.accessToken))
        .attach('video', Buffer.from('fake-mp4-bytes'), {
          filename: 'sample.mp4',
          contentType: 'video/mp4',
        })
        .expect(201);

      const filename = attach.body.filename as string;
      createdFiles.push(
        join(process.cwd(), 'file', 'temp', filename),
        join(
          process.cwd(),
          'file',
          'upload',
          filename.replace('temp_', 'granted_'),
        ),
      );

      await request(server)
        .post('/file')
        .set(auth(owner.accessToken))
        .send({ title: 'owned-clip', filePath: filename })
        .expect(201);

      const stolen = await request(server)
        .post('/file')
        .set(auth(other.accessToken))
        .send({ title: 'stolen-clip', filePath: filename })
        .expect(409);
      expect(stolen.body.code).toBe('FILE_ALREADY_CLAIMED');
    });

    it('rejects a filePath the attach step never issued', async () => {
      const user = await createUser('badpath@e.com');

      const res = await request(server)
        .post('/file')
        .set(auth(user.accessToken))
        .send({ title: 'traversal', filePath: '../upload/granted_other.mp4' })
        .expect(400);
      expect(res.body.code).toBe('VALIDATION_FAILED');
    });

    it('rejects a well-formed filePath with no temp file behind it (FILE_INVALID_PATH)', async () => {
      const user = await createUser('gone@e.com');

      const res = await request(server)
        .post('/file')
        .set(auth(user.accessToken))
        .send({
          title: 'expired',
          filePath:
            'temp_67ff0c79-a1f0-4d4f-865c-681af920378d_1764581241716.mp4',
        })
        .expect(400);
      expect(res.body.code).toBe('FILE_INVALID_PATH');
    });

    it('rejects a non-video attachment with UPLOAD_INVALID_TYPE', async () => {
      const user = await createUser('upload-bad@e.com');
      const res = await request(server)
        .post('/upload/attach')
        .set(auth(user.accessToken))
        .attach('video', Buffer.from('not a video'), {
          filename: 'evil.txt',
          contentType: 'text/plain',
        })
        .expect(400);
      expect(res.body.code).toBe('UPLOAD_INVALID_TYPE');
    });

    // 미디어 타입 확장(ADR 0025 D4/D5): image/audio/video는 이제 각자 고유한 클래스
    // 화이트리스트를 가진 세 개의 타입별 필드다.
    it('attaches an image under the image field, promotes it, and serves it with the right content-type', async () => {
      const user = await createUser('upload-image@e.com');

      const attach = await request(server)
        .post('/upload/attach')
        .set(auth(user.accessToken))
        .attach('image', Buffer.from('fake-jpg-bytes'), {
          filename: 'sample.jpg',
          contentType: 'image/jpeg',
        })
        .expect(201);

      const filename = attach.body.filename as string;
      expect(filename).toMatch(/^temp_.*\.jpg$/);
      createdFiles.push(
        join(process.cwd(), 'file', 'temp', filename),
        join(
          process.cwd(),
          'file',
          'upload',
          filename.replace('temp_', 'granted_'),
        ),
      );

      const promote = await request(server)
        .post('/file')
        .set(auth(user.accessToken))
        .send({ title: 'promoted-image', filePath: filename })
        .expect(201);

      const res = await request(server)
        .get(`/file/${promote.body.id}/content`)
        .set(auth(user.accessToken))
        .buffer(true)
        .expect(200);
      expect(res.headers['content-type']).toBe('image/jpeg');
    });

    it('attaches an audio file under the audio field, promotes it, and serves it with the right content-type', async () => {
      const user = await createUser('upload-audio@e.com');

      const attach = await request(server)
        .post('/upload/attach')
        .set(auth(user.accessToken))
        .attach('audio', Buffer.from('fake-mp3-bytes'), {
          filename: 'sample.mp3',
          contentType: 'audio/mpeg',
        })
        .expect(201);

      const filename = attach.body.filename as string;
      expect(filename).toMatch(/^temp_.*\.mp3$/);
      createdFiles.push(
        join(process.cwd(), 'file', 'temp', filename),
        join(
          process.cwd(),
          'file',
          'upload',
          filename.replace('temp_', 'granted_'),
        ),
      );

      const promote = await request(server)
        .post('/file')
        .set(auth(user.accessToken))
        .send({ title: 'promoted-audio', filePath: filename })
        .expect(201);

      const res = await request(server)
        .get(`/file/${promote.body.id}/content`)
        .set(auth(user.accessToken))
        .buffer(true)
        .expect(200);
      expect(res.headers['content-type']).toBe('audio/mpeg');
    });

    it('rejects a file attached under a field that does not accept its type (UPLOAD_INVALID_TYPE)', async () => {
      const user = await createUser('upload-wrong-field@e.com');

      const res = await request(server)
        .post('/upload/attach')
        .set(auth(user.accessToken))
        .attach('image', Buffer.from('fake-mp4-bytes'), {
          filename: 'sample.mp4',
          contentType: 'video/mp4',
        })
        .expect(400);
      expect(res.body.code).toBe('UPLOAD_INVALID_TYPE');
    });

    it('rejects a request with more than one of image/audio/video attached (UPLOAD_MULTIPLE_FIELDS)', async () => {
      const user = await createUser('upload-multi-field@e.com');

      const res = await request(server)
        .post('/upload/attach')
        .set(auth(user.accessToken))
        .attach('image', Buffer.from('fake-jpg-bytes'), {
          filename: 'sample.jpg',
          contentType: 'image/jpeg',
        })
        .attach('video', Buffer.from('fake-mp4-bytes'), {
          filename: 'sample.mp4',
          contentType: 'video/mp4',
        })
        .expect(400);
      expect(res.body.code).toBe('UPLOAD_MULTIPLE_FIELDS');
    });
  });

  // 파일 visibility + 접근 제어 콘텐츠(ADR 0025 D1/D2/D3/D6): granted 읽기는 이제 전부
  // GET /file/:id/content를 거치고, public/private/unlisted 상태로 게이트된다 —
  // file/upload는 더 이상 정적으로 서빙되지 않는다.
  describe('File visibility & access-controlled content (ADR 0025)', () => {
    const BYTES = 'fake-mp4-bytes';

    async function promoteFile(accessToken: string, title: string) {
      const attach = await request(server)
        .post('/upload/attach')
        .set(auth(accessToken))
        .attach('video', Buffer.from(BYTES), {
          filename: 'sample.mp4',
          contentType: 'video/mp4',
        })
        .expect(201);

      const filename = attach.body.filename as string;
      createdFiles.push(
        join(process.cwd(), 'file', 'temp', filename),
        join(
          process.cwd(),
          'file',
          'upload',
          filename.replace('temp_', 'granted_'),
        ),
      );

      const promote = await request(server)
        .post('/file')
        .set(auth(accessToken))
        .send({ title, filePath: filename })
        .expect(201);

      return promote.body as { id: number; visibility: string };
    }

    it('defaults to private, hiding metadata from a non-owner behind 404', async () => {
      const owner = await createUser('vis-owner@e.com');
      const stranger = await createUser('vis-stranger@e.com');
      const file = await promoteFile(owner.accessToken, 'vis-default');

      expect(file.visibility).toBe('private');

      await request(server)
        .get(`/file/${file.id}`)
        .set(auth(stranger.accessToken))
        .expect(404);

      await request(server)
        .get(`/file/${file.id}`)
        .set(auth(owner.accessToken))
        .expect(200);
    });

    it("hides a private file from another user's listing but keeps it in the owner's", async () => {
      const owner = await createUser('vis-list-owner@e.com');
      const stranger = await createUser('vis-list-stranger@e.com');
      await promoteFile(owner.accessToken, 'vis-list-private');

      const asStranger = await request(server)
        .get('/file')
        .set(auth(stranger.accessToken))
        .expect(200);
      expect(asStranger.body[1]).toBe(0);

      const asOwner = await request(server)
        .get('/file')
        .set(auth(owner.accessToken))
        .expect(200);
      expect(asOwner.body[1]).toBe(1);
    });

    it("refuses a private file's content to a stranger and serves it to the owner", async () => {
      const owner = await createUser('vis-private-owner@e.com');
      const stranger = await createUser('vis-private-stranger@e.com');
      const file = await promoteFile(owner.accessToken, 'vis-private-content');

      const refused = await request(server)
        .get(`/file/${file.id}/content`)
        .set(auth(stranger.accessToken))
        .expect(403);
      expect(refused.body.code).toBe('FORBIDDEN_NOT_OWNER');

      const served = await request(server)
        .get(`/file/${file.id}/content`)
        .set(auth(owner.accessToken))
        .buffer(true)
        .expect(200);
      expect(served.body.toString()).toBe(BYTES);
    });

    it('serves a public file to a fully anonymous request', async () => {
      const owner = await createUser('vis-public-owner@e.com');
      const file = await promoteFile(owner.accessToken, 'vis-public-content');

      await request(server)
        .patch(`/file/${file.id}`)
        .set(auth(owner.accessToken))
        .send({ visibility: 'public' })
        .expect(200);

      const res = await request(server)
        .get(`/file/${file.id}/content`)
        .buffer(true)
        .expect(200);
      expect(res.body.toString()).toBe(BYTES);
      expect(res.headers['content-type']).toBe('video/mp4');
    });

    it('supports Range requests for partial content', async () => {
      const owner = await createUser('vis-range-owner@e.com');
      const file = await promoteFile(owner.accessToken, 'vis-range-content');
      await request(server)
        .patch(`/file/${file.id}`)
        .set(auth(owner.accessToken))
        .send({ visibility: 'public' })
        .expect(200);

      const res = await request(server)
        .get(`/file/${file.id}/content`)
        .set('Range', 'bytes=0-3')
        .buffer(true)
        .expect(206);

      expect(res.headers['content-range']).toBe(
        `bytes 0-3/${Buffer.byteLength(BYTES)}`,
      );
      expect(res.body.toString()).toBe(BYTES.slice(0, 4));
    });

    it('supports a suffix Range request (last N bytes)', async () => {
      const owner = await createUser('vis-suffix-range-owner@e.com');
      const file = await promoteFile(owner.accessToken, 'vis-suffix-range');
      await request(server)
        .patch(`/file/${file.id}`)
        .set(auth(owner.accessToken))
        .send({ visibility: 'public' })
        .expect(200);

      const size = Buffer.byteLength(BYTES);
      const res = await request(server)
        .get(`/file/${file.id}/content`)
        .set('Range', 'bytes=-4')
        .buffer(true)
        .expect(206);

      expect(res.headers['content-range']).toBe(
        `bytes ${size - 4}-${size - 1}/${size}`,
      );
      expect(res.body.toString()).toBe(BYTES.slice(-4));
    });

    it('switches to unlisted, hands the owner a shareUrl, and rotation invalidates the old token', async () => {
      const owner = await createUser('vis-unlisted-owner@e.com');
      const file = await promoteFile(owner.accessToken, 'vis-unlisted-content');

      const unlisted = await request(server)
        .patch(`/file/${file.id}`)
        .set(auth(owner.accessToken))
        .send({ visibility: 'unlisted' })
        .expect(200);

      expect(unlisted.body.shareUrl).toContain(
        `/file/${file.id}/content?share=`,
      );
      const firstToken = new URL(
        unlisted.body.shareUrl as string,
      ).searchParams.get('share');

      // 익명, 토큰 없음: 거부됨.
      const noToken = await request(server)
        .get(`/file/${file.id}/content`)
        .expect(403);
      expect(noToken.body.code).toBe('FILE_SHARE_INVALID');

      // 익명, 올바른 토큰: 서빙됨.
      const withToken = await request(server)
        .get(`/file/${file.id}/content?share=${firstToken}`)
        .buffer(true)
        .expect(200);
      expect(withToken.body.toString()).toBe(BYTES);

      // 회전시키면: 기존 링크가 즉시 작동을 멈춘다.
      const rotated = await request(server)
        .patch(`/file/${file.id}`)
        .set(auth(owner.accessToken))
        .send({ rotateShareToken: true })
        .expect(200);
      const secondToken = new URL(
        rotated.body.shareUrl as string,
      ).searchParams.get('share');
      expect(secondToken).not.toBe(firstToken);

      await request(server)
        .get(`/file/${file.id}/content?share=${firstToken}`)
        .expect(403);
      await request(server)
        .get(`/file/${file.id}/content?share=${secondToken}`)
        .buffer(true)
        .expect(200);
    });

    it('refuses an unlisted share token past its expiry', async () => {
      const owner = await createUser('vis-ttl-owner@e.com');
      const file = await promoteFile(owner.accessToken, 'vis-ttl-content');

      const expired = new Date(Date.now() - 60_000).toISOString();
      const unlisted = await request(server)
        .patch(`/file/${file.id}`)
        .set(auth(owner.accessToken))
        .send({ visibility: 'unlisted', shareExpiresAt: expired })
        .expect(200);
      const token = new URL(unlisted.body.shareUrl as string).searchParams.get(
        'share',
      );

      const res = await request(server)
        .get(`/file/${file.id}/content?share=${token}`)
        .expect(403);
      expect(res.body.code).toBe('FILE_SHARE_INVALID');
    });
  });

  // 삭제 정책(ADR 0020): 파일을 소유한 계정은 실수로 삭제될 수 없다 — 캐스케이드는
  // 명시적 확인이 필요하고, 저장된 파일까지 함께 가져간다. 이전에는 FK 제약이
  // 불투명한 500으로 드러났다.
  describe('Deletion policy (ADR 0020)', () => {
    // 실제 업로드를 승격시켜, 검증이 디스크상의 실제 파일을 확인할 수 있게 한다.
    async function promoteFile(accessToken: string, title: string) {
      const attach = await request(server)
        .post('/upload/attach')
        .set(auth(accessToken))
        .attach('video', Buffer.from('fake-mp4-bytes'), {
          filename: 'sample.mp4',
          contentType: 'video/mp4',
        })
        .expect(201);

      const filename = attach.body.filename as string;
      const grantedPath = join(
        process.cwd(),
        'file',
        'upload',
        filename.replace('temp_', 'granted_'),
      );
      createdFiles.push(
        join(process.cwd(), 'file', 'temp', filename),
        grantedPath,
      );

      const promote = await request(server)
        .post('/file')
        .set(auth(accessToken))
        .send({ title, filePath: filename })
        .expect(201);

      return { id: promote.body.id as number, grantedPath };
    }

    it('deletes an account that owns nothing', async () => {
      const user = await createUser('solo@e.com');

      await request(server)
        .delete(`/user/${user.id}`)
        .set(auth(user.accessToken))
        .expect(200);
    });

    it('refuses to delete an account that owns files (409 USER_HAS_FILES)', async () => {
      const user = await createUser('owner@e.com');
      await seedFile('kept-a', user.id);
      await seedFile('kept-b', user.id);

      const res = await request(server)
        .delete(`/user/${user.id}`)
        .set(auth(user.accessToken))
        .expect(409);

      expect(res.body.code).toBe('USER_HAS_FILES');
      // 이 개수는 클라이언트의 경고 대화상자가 사용자에게 그대로 인용해 보여주는 값이다.
      expect(res.body.message).toContain('2 file(s)');

      // 거부된 시도로는 아무것도 파괴되지 않았다.
      await request(server)
        .get('/user/' + user.id)
        .set(auth(user.accessToken))
        .expect(200);
    });

    it('rejects a confirmation flag that is neither "true" nor "false"', async () => {
      const user = await createUser('badflag@e.com');
      await seedFile('kept-c', user.id);

      const res = await request(server)
        .delete(`/user/${user.id}?deleteFiles=yes`)
        .set(auth(user.accessToken))
        .expect(400);
      expect(res.body.code).toBe('VALIDATION_FAILED');
    });

    it('treats deleteFiles=false as no confirmation at all', async () => {
      const user = await createUser('explicit-no@e.com');
      await seedFile('kept-d', user.id);

      const res = await request(server)
        .delete(`/user/${user.id}?deleteFiles=false`)
        .set(auth(user.accessToken))
        .expect(409);
      expect(res.body.code).toBe('USER_HAS_FILES');
    });

    it('cascades into file rows and stored files once confirmed', async () => {
      const user = await createUser('cascade@e.com');
      const file = await promoteFile(user.accessToken, 'doomed-clip');
      expect(existsSync(file.grantedPath)).toBe(true);

      await request(server)
        .delete(`/user/${user.id}?deleteFiles=true`)
        .set(auth(user.accessToken))
        .expect(200);

      expect(existsSync(file.grantedPath)).toBe(false);

      // 두 행 모두 사라졌다: 이제 이 계정으로 로그인할 수 없다(삭제된 계정의 자격
      // 증명은 그냥 무효다 — 틀린 비밀번호와 마찬가지로 400).
      const signin = await request(server)
        .post('/auth/signin')
        .set('Authorization', basic('cascade@e.com', PW))
        .expect(400);
      expect(signin.body.code).toBe('AUTH_INVALID_CREDENTIALS');

      const rows = await app
        .get(DataSource)
        .getRepository(FileEntity)
        .count({ where: { id: file.id } });
      expect(rows).toBe(0);
    });

    it('removes the stored file when a single file is deleted', async () => {
      const user = await createUser('single@e.com');
      const file = await promoteFile(user.accessToken, 'single-clip');

      await request(server)
        .delete(`/file/${file.id}`)
        .set(auth(user.accessToken))
        .expect(200);

      expect(existsSync(file.grantedPath)).toBe(false);
    });
  });

  // 게시판 게시글 도메인(ADR 0023): CRUD, fileId claim/replay 규칙,
  // creator-OR-admin 소유권 형태, 그리고 두 모듈 간 파급 효과 —
  // 첨부된 파일에 대한 DELETE /file/:id, 그리고 계정 캐스케이드가 게시글까지 가져가는 것.
  describe('Post module (ADR 0023)', () => {
    const createPost = (
      token: string,
      body: Record<string, unknown>,
    ): request.Test =>
      request(server).post('/post').set(auth(token)).send(body);

    it('creates a text-only post and reads it back', async () => {
      const user = await createUser('poster@e.com');

      const created = await createPost(user.accessToken, {
        title: 'Hello board',
        body: 'No video attached.',
      }).expect(201);

      expect(created.body.creator.email).toBe('poster@e.com');
      expect(created.body.file).toBeUndefined();

      const fetched = await request(server)
        .get(`/post/${created.body.id}`)
        .set(auth(user.accessToken))
        .expect(200);
      expect(fetched.body.body).toBe('No video attached.');
    });

    it('allows two posts to share a title (unlike file titles)', async () => {
      const user = await createUser('dupetitle@e.com');

      await createPost(user.accessToken, { title: 'Same', body: 'a' }).expect(
        201,
      );
      await createPost(user.accessToken, { title: 'Same', body: 'b' }).expect(
        201,
      );
    });

    it('attaches a file the author created and exposes its public URL', async () => {
      const user = await createUser('attach@e.com');
      const fileId = await seedFile('attached-clip', user.id);

      const created = await createPost(user.accessToken, {
        title: 'With video',
        body: 'Watch this.',
        fileId,
      }).expect(201);

      expect(created.body.file.id).toBe(fileId);
      expect(created.body.file.fileUrl).toBe(
        `http://localhost:3000/file/${fileId}/content`,
      );
    });

    it("refuses to attach another user's file (FORBIDDEN_NOT_OWNER)", async () => {
      const owner = await createUser('fileowner@e.com');
      const other = await createUser('otherposter@e.com');
      const fileId = await seedFile('not-yours', owner.id);

      const res = await createPost(other.accessToken, {
        title: 'Stolen',
        body: 'Not mine.',
        fileId,
      }).expect(403);
      expect(res.body.code).toBe('FORBIDDEN_NOT_OWNER');
    });

    it('rejects a fileId that does not exist (FILE_NOT_FOUND)', async () => {
      const user = await createUser('nofile@e.com');

      const res = await createPost(user.accessToken, {
        title: 'Ghost',
        body: 'Nothing behind it.',
        fileId: 9999,
      }).expect(404);
      expect(res.body.code).toBe('FILE_NOT_FOUND');
    });

    it('replays the identical submission and 409s a differing one', async () => {
      const user = await createUser('replay@e.com');
      const fileId = await seedFile('replay-clip', user.id);
      const payload = { title: 'Once', body: 'Only once.', fileId };

      const first = await createPost(user.accessToken, payload).expect(201);
      // 네트워크 재시도는 두 번째 게시글이 아니라 같은 게시글을 반환해야 한다.
      const retry = await createPost(user.accessToken, payload).expect(200);
      expect(retry.body.id).toBe(first.body.id);

      // 작성자가 다른 텍스트를 썼다면 그건 재시도가 아니라 새 제출이다 — 그리고
      // 파일은 이미 소진됐으므로, 500이 아니라 타입 있는 conflict가 된다.
      const conflict = await createPost(user.accessToken, {
        ...payload,
        body: 'Rewritten.',
      }).expect(409);
      expect(conflict.body.code).toBe('POST_FILE_TAKEN');
    });

    it('rejects an undeclared body field with VALIDATION_FAILED', async () => {
      const user = await createUser('whitelist@e.com');

      const res = await createPost(user.accessToken, {
        title: 'Sneaky',
        body: 'Extra field.',
        creatorId: 999,
      }).expect(400);
      expect(res.body.code).toBe('VALIDATION_FAILED');
    });

    it('paginates, searches and sorts the listing', async () => {
      const user = await createUser('lister@e.com');
      for (const title of ['alpha trip', 'beta trip', 'gamma stay']) {
        await createPost(user.accessToken, { title, body: 'x' }).expect(201);
      }

      const search = await request(server)
        .get('/post?search=trip&sortBy=title&order=ASC')
        .set(auth(user.accessToken))
        .expect(200);
      const [posts, count] = search.body;
      expect(count).toBe(2);
      expect(posts.map((p: { title: string }) => p.title)).toEqual([
        'alpha trip',
        'beta trip',
      ]);

      const paged = await request(server)
        .get('/post?take=2&skip=0')
        .set(auth(user.accessToken))
        .expect(200);
      expect(paged.body[0]).toHaveLength(2);
      expect(paged.body[1]).toBe(3);
    });

    it('rejects a sort field outside the whitelist', async () => {
      const user = await createUser('badsort@e.com');

      const res = await request(server)
        .get('/post?sortBy=body')
        .set(auth(user.accessToken))
        .expect(400);
      expect(res.body.code).toBe('VALIDATION_FAILED');
    });

    it('lets the author edit, but forbids a stranger (403) and allows an admin', async () => {
      const author = await createUser('author@e.com');
      const stranger = await createUser('stranger@e.com');
      const created = await createPost(author.accessToken, {
        title: 'Original',
        body: 'v1',
      }).expect(201);
      const id = created.body.id as number;

      const edited = await request(server)
        .patch(`/post/${id}`)
        .set(auth(author.accessToken))
        .send({ body: 'v2' })
        .expect(200);
      expect(edited.body.body).toBe('v2');

      const forbidden = await request(server)
        .patch(`/post/${id}`)
        .set(auth(stranger.accessToken))
        .send({ body: 'hijacked' })
        .expect(403);
      expect(forbidden.body.code).toBe('FORBIDDEN_NOT_OWNER');

      // RBAC는 소유권을 admin 이상으로 확장한다(ADR 0013) — 파일과 같은 형태다.
      await promoteToAdmin(stranger.id);
      await request(server)
        .patch(`/post/${id}`)
        .set(auth(stranger.accessToken))
        .send({ body: 'moderated' })
        .expect(200);
    });

    it('forbids a stranger from deleting a post and lets the author do it', async () => {
      const author = await createUser('deleter@e.com');
      const stranger = await createUser('nosy@e.com');
      const created = await createPost(author.accessToken, {
        title: 'Doomed',
        body: 'bye',
      }).expect(201);
      const id = created.body.id as number;

      const forbidden = await request(server)
        .delete(`/post/${id}`)
        .set(auth(stranger.accessToken))
        .expect(403);
      expect(forbidden.body.code).toBe('FORBIDDEN_NOT_OWNER');

      await request(server)
        .delete(`/post/${id}`)
        .set(auth(author.accessToken))
        .expect(200);

      await request(server)
        .get(`/post/${id}`)
        .set(auth(author.accessToken))
        .expect(404);
    });

    it('leaves the attached file alone when the post is deleted', async () => {
      const user = await createUser('keepfile@e.com');
      const fileId = await seedFile('survives', user.id);
      const created = await createPost(user.accessToken, {
        title: 'Temporary',
        body: 'The file outlives me.',
        fileId,
      }).expect(201);

      await request(server)
        .delete(`/post/${created.body.id}`)
        .set(auth(user.accessToken))
        .expect(200);

      // 게시글은 파일을 참조할 뿐 절대 소유하지 않는다.
      await request(server)
        .get(`/file/${fileId}`)
        .set(auth(user.accessToken))
        .expect(200);
    });

    it('refuses to delete a file a post references (409 FILE_IN_USE)', async () => {
      const user = await createUser('inuse@e.com');
      const fileId = await seedFile('locked-clip', user.id);
      const created = await createPost(user.accessToken, {
        title: 'Holder',
        body: 'Holding the file.',
        fileId,
      }).expect(201);

      // FK가 판정의 근거다 — 사전 검사 없이, 불투명한 500도 절대 없다(D4).
      const res = await request(server)
        .delete(`/file/${fileId}`)
        .set(auth(user.accessToken))
        .expect(409);
      expect(res.body.code).toBe('FILE_IN_USE');

      // 게시글을 먼저 삭제하면 파일이 풀려난다.
      await request(server)
        .delete(`/post/${created.body.id}`)
        .set(auth(user.accessToken))
        .expect(200);
      await request(server)
        .delete(`/file/${fileId}`)
        .set(auth(user.accessToken))
        .expect(200);
    });

    it('takes posts with the account, unconfirmed, and counts them in the audit log', async () => {
      const admin = await createUser('cascadeadmin@e.com');
      await promoteToAdmin(admin.id);
      const adminToken = admin.accessToken;

      const victim = await createUser('cascadeposts@e.com');
      await createPost(victim.accessToken, { title: 'p1', body: 'a' }).expect(
        201,
      );
      await createPost(victim.accessToken, { title: 'p2', body: 'b' }).expect(
        201,
      );

      // 확인 플래그는 파일만 보호한다; 게시글은 확인 없이 진행된다(D5).
      await request(server)
        .delete(`/user/${victim.id}`)
        .set(auth(adminToken))
        .expect(200);

      const list = await request(server)
        .get('/post')
        .set(auth(adminToken))
        .expect(200);
      expect(list.body[1]).toBe(0);

      const log = await request(server)
        .get('/audit-log?action=USER_DELETE')
        .set(auth(adminToken))
        .expect(200);
      expect(log.body[0][0].detail).toBe('files=0 posts=2');
    });
  });

  // 게시판 댓글 도메인(ADR 0023): 스레드 CRUD, 소유권 형태(작성자 또는 admin이며,
  // 의도적으로 게시글 작성자는 *포함하지 않는다*), 그리고 두 가지 삭제 파급 효과 —
  // 게시글 삭제에 따른 FK 캐스케이드, 그리고 계정 캐스케이드에 댓글이 합류하는 것.
  describe('Comment module (ADR 0023)', () => {
    // 응답이 아니라 id를 반환한다: 여기서 호출하는 모든 곳이 이 값을 라우트나
    // 헬퍼에 그대로 꿰어 넣는데, res.body는 `any`이기 때문이다.
    async function newPost(token: string, title: string): Promise<number> {
      const res = await request(server)
        .post('/post')
        .set(auth(token))
        .send({ title, body: 'Post body.' })
        .expect(201);
      return res.body.id as number;
    }

    const createComment = (
      token: string,
      postId: number,
      body: unknown,
    ): request.Test =>
      request(server)
        .post(`/post/${postId}/comment`)
        .set(auth(token))
        .send(body);

    it('comments on a post and lists it back under that post', async () => {
      const user = await createUser('c-basic@e.com');
      const post = await newPost(user.accessToken, 'Thread');

      const created = await createComment(user.accessToken, post, {
        body: 'First!',
      }).expect(201);

      expect(created.body.body).toBe('First!');
      expect(created.body.postId).toBe(post);
      expect(created.body.creator.email).toBe('c-basic@e.com');

      const list = await request(server)
        .get(`/post/${post}/comment`)
        .set(auth(user.accessToken))
        .expect(200);
      expect(list.body[1]).toBe(1);
      expect(list.body[0][0].id).toBe(created.body.id);
    });

    it('404s when commenting on a post that does not exist', async () => {
      const user = await createUser('c-nopost@e.com');

      // FK라면 23503을 일으킬 것이다; 대신 서비스가 insert 전에 미리 거부한다.
      const res = await createComment(user.accessToken, 999999, {
        body: 'into the void',
      }).expect(404);
      expect(res.body.code).toBe('POST_NOT_FOUND');
    });

    it('404s when listing comments of a post that does not exist', async () => {
      const user = await createUser('c-nolist@e.com');

      const res = await request(server)
        .get('/post/999999/comment')
        .set(auth(user.accessToken))
        .expect(404);
      expect(res.body.code).toBe('POST_NOT_FOUND');
    });

    it('rejects an undeclared body field and an over-long body', async () => {
      const user = await createUser('c-validate@e.com');
      const post = await newPost(user.accessToken, 'Validated');

      const extra = await createComment(user.accessToken, post, {
        body: 'ok',
        postId: 1,
      }).expect(400);
      expect(extra.body.code).toBe('VALIDATION_FAILED');

      const long = await createComment(user.accessToken, post, {
        body: 'x'.repeat(1001),
      }).expect(400);
      expect(long.body.code).toBe('VALIDATION_FAILED');
    });

    it('reads the thread oldest-first and paginates', async () => {
      const user = await createUser('c-page@e.com');
      const post = await newPost(user.accessToken, 'Long thread');

      for (const body of ['one', 'two', 'three']) {
        await createComment(user.accessToken, post, { body }).expect(201);
      }

      const page = await request(server)
        .get(`/post/${post}/comment?take=2&skip=0`)
        .set(auth(user.accessToken))
        .expect(200);

      // 오래된 순 — 최신순인 파일/게시글 목록과는 반대다(ADR 0023).
      expect(page.body[0].map((c: { body: string }) => c.body)).toEqual([
        'one',
        'two',
      ]);
      expect(page.body[1]).toBe(3);
    });

    it('creates a second comment when the identical body is submitted twice', async () => {
      const user = await createUser('c-dup@e.com');
      const post = await newPost(user.accessToken, 'Dup');

      // 유니크 컬럼이 없으니 자연스러운 idempotency key도 없다 — 재제출은
      // fileId 없는 게시글과 정확히 같은 방식으로, 새 댓글이 되는 게 문서화된 정상 동작이다.
      const first = await createComment(user.accessToken, post, {
        body: 'same text',
      }).expect(201);
      const second = await createComment(user.accessToken, post, {
        body: 'same text',
      }).expect(201);

      expect(second.body.id).not.toBe(first.body.id);
    });

    it('lets the author edit, forbids a stranger, and allows an admin', async () => {
      const author = await createUser('c-author@e.com');
      const stranger = await createUser('c-stranger@e.com');
      const moderator = await createUser('c-admin@e.com');
      await promoteToAdmin(moderator.id);

      const post = await newPost(author.accessToken, 'Owned');
      const comment = await createComment(author.accessToken, post, {
        body: 'original',
      }).expect(201);

      const edited = await request(server)
        .patch(`/comment/${comment.body.id}`)
        .set(auth(author.accessToken))
        .send({ body: 'edited' })
        .expect(200);
      expect(edited.body.body).toBe('edited');

      const refused = await request(server)
        .patch(`/comment/${comment.body.id}`)
        .set(auth(stranger.accessToken))
        .send({ body: 'hijacked' })
        .expect(403);
      expect(refused.body.code).toBe('FORBIDDEN_NOT_OWNER');

      await request(server)
        .patch(`/comment/${comment.body.id}`)
        .set(auth(moderator.accessToken))
        .send({ body: 'moderated' })
        .expect(200);
    });

    it("gives the post's author no power over comments on their post", async () => {
      const postAuthor = await createUser('c-postowner@e.com');
      const commenter = await createUser('c-commenter@e.com');

      const post = await newPost(postAuthor.accessToken, 'My post');
      const comment = await createComment(commenter.accessToken, post, {
        body: 'someone else wrote this',
      }).expect(201);

      // 세 번째 권한 축은 ADR 0023에서 기각됐다 — comment.post.creator로
      // reach-through해야 하는데, admin 관리 권한이 이미 그 경우를 커버한다.
      const res = await request(server)
        .delete(`/comment/${comment.body.id}`)
        .set(auth(postAuthor.accessToken))
        .expect(403);
      expect(res.body.code).toBe('FORBIDDEN_NOT_OWNER');
    });

    it('deletes a comment and audits COMMENT_DELETE, leaving the post alone', async () => {
      const moderator = await createUser('c-audit@e.com');
      await promoteToAdmin(moderator.id);
      const post = await newPost(moderator.accessToken, 'Audited');
      const comment = await createComment(moderator.accessToken, post, {
        body: 'to be removed',
      }).expect(201);

      await request(server)
        .delete(`/comment/${comment.body.id}`)
        .set(auth(moderator.accessToken))
        .expect(200);

      await request(server)
        .get(`/post/${post}`)
        .set(auth(moderator.accessToken))
        .expect(200);

      const log = await request(server)
        .get('/audit-log?action=COMMENT_DELETE')
        .set(auth(moderator.accessToken))
        .expect(200);
      expect(log.body[1]).toBe(1);
      expect(log.body[0][0].targetId).toBe(comment.body.id);
    });

    it('takes the comments with the post through the FK cascade', async () => {
      const author = await createUser('c-cascade@e.com');
      const commenter = await createUser('c-cascade2@e.com');
      const post = await newPost(author.accessToken, 'Doomed');

      await createComment(author.accessToken, post, {
        body: 'mine',
      }).expect(201);
      await createComment(commenter.accessToken, post, {
        body: 'theirs',
      }).expect(201);

      await request(server)
        .delete(`/post/${post}`)
        .set(auth(author.accessToken))
        .expect(200);

      // ON DELETE CASCADE — 이 스키마의 유일한 DB 레벨 캐스케이드다(ADR 0023 D3).
      const remaining = await app
        .get(DataSource)
        .getRepository(CommentEntity)
        .count();
      expect(remaining).toBe(0);
    });

    it("takes the account's comments everywhere, including on other people's posts", async () => {
      const admin = await createUser('c-acctadmin@e.com');
      await promoteToAdmin(admin.id);
      const host = await createUser('c-host@e.com');
      const victim = await createUser('c-victim@e.com');

      const hostPost = await newPost(host.accessToken, 'Host post');
      // 피해자가 다른 사람의 게시글에 단 댓글 — 게시글 FK 캐스케이드로는 닿지 않으므로,
      // 계정 캐스케이드가 댓글을 먼저 명시적으로 삭제하는 이유가 바로 이것이다.
      await createComment(victim.accessToken, hostPost, {
        body: 'visiting',
      }).expect(201);
      await createComment(host.accessToken, hostPost, {
        body: 'staying',
      }).expect(201);

      await request(server)
        .delete(`/user/${victim.id}`)
        .set(auth(admin.accessToken))
        .expect(200);

      const left = await request(server)
        .get(`/post/${hostPost}/comment`)
        .set(auth(admin.accessToken))
        .expect(200);
      expect(left.body[1]).toBe(1);
      expect(left.body[0][0].body).toBe('staying');
    });
  });

  // ADR 0024: 동의 기반 파일 소유권 이전(ADR 0050)은 파일을 게시글 아래에서 빼낼 수
  // 있어서, 계정 캐스케이드가 자신이 소유하지 않은 게시글과 마주칠 수 있다. 예전에는
  // 불투명한 500이었지만 이제는 타입 있는 409다. 이것이 그 상황을 엔드투엔드로
  // 재현하는 유일한 경로다. (원래는 ADR 0050이 제거한, 즉시 반영되는 비동의
  // PATCH /file/:id { userId } 필드로 재현했다 — propose/accept 흐름도 수락되고 나면
  // 같은 불변식을 여전히 깨뜨린다. 동의는 누가 재배정을 트리거할 수 있는지만 통제할
  // 뿐, 수락된 재배정이 무엇을 하는지는 통제하지 않기 때문이다; ADR 0050의 Consequences 참고.)
  describe('Account cascade FK refusal (ADR 0024)', () => {
    it("refuses the cascade when another user's post holds the account's file", async () => {
      const author = await createUser('adr24-author@e.com');
      const newOwner = await createUser('adr24-owner@e.com');

      // 여기서는 불변식이 성립한다: 작성자가 자신이 만든 파일을 첨부한다.
      const fileId = await seedFile('reassigned-clip', author.id);
      const post = await request(server)
        .post('/post')
        .set(auth(author.accessToken))
        .send({
          title: 'Still mine',
          body: 'The file underneath is about to change hands.',
          fileId,
        })
        .expect(201);

      // ...그리고 여기, 생성 이후에 깨진다 — assertAttachableBy는 다시 실행되지 않는다.
      // 제안 후 수락(ADR 0050): 소유권은 newOwner가 동의해야만 이동한다.
      await request(server)
        .post(`/file/${fileId}/transfer`)
        .set(auth(author.accessToken))
        .send({ userId: newOwner.id })
        .expect(200);
      await request(server)
        .post(`/file/${fileId}/transfer/accept`)
        .set(auth(newOwner.accessToken))
        .expect(200);

      const refused = await request(server)
        .delete(`/user/${newOwner.id}?deleteFiles=true`)
        .set(auth(newOwner.accessToken))
        .expect(409);
      expect(refused.body.code).toBe('USER_FILES_IN_USE');

      // 트랜잭션 전체가 롤백됐다 — 계정과 게시글 둘 다 살아남는다.
      await request(server)
        .get(`/user/${newOwner.id}`)
        .set(auth(newOwner.accessToken))
        .expect(200);
      await request(server)
        .get(`/post/${post.body.id}`)
        .set(auth(author.accessToken))
        .expect(200);

      // 막다른 길이 아니라 대응 가능하다: 막고 있는 게시글을 치우면 삭제가 풀린다.
      await request(server)
        .delete(`/post/${post.body.id}`)
        .set(auth(author.accessToken))
        .expect(200);
      await request(server)
        .delete(`/user/${newOwner.id}?deleteFiles=true`)
        .set(auth(newOwner.accessToken))
        .expect(200);
    });
  });
});
