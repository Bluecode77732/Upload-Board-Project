import { INestApplication } from '@nestjs/common';
import { DataSource } from 'typeorm';
import request from 'supertest';
import { App } from 'supertest/types';
import { existsSync } from 'fs';
import { unlink } from 'fs/promises';
import { join } from 'path';
import { FileEntity } from '../backend/file/entity/file.entity';
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

// End-to-end coverage of the paths unit tests cannot reach: the auth flow over real
// HTTP+DB, refresh rotation/reuse (ADR 0012), RBAC ownership 403s, list pagination,
// the temp_ → granted_ physical promotion, and the deletion policy — confirmed account
// cascade, its 409 refusal, and stored-file removal (ADR 0020). Requires the local
// Postgres on 5435 (docker compose up -d db); the suite owns a throwaway DB (see e2e-utils).
describe('Upload Board API (e2e)', () => {
  let app: INestApplication;
  let server: App;
  // Physical files a test created; unlinked after each test so disk stays clean.
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

  // Seed a file row directly (no physical file) — for list/ownership tests that
  // exercise metadata paths, not the promotion path.
  async function seedFile(title: string, creatorId: number): Promise<number> {
    const result = await app
      .get(DataSource)
      .getRepository(FileEntity)
      .insert({
        title,
        filePath: `file/upload/granted_${title}.mp4`,
        creator: { id: creatorId },
      });
    return result.identifiers[0].id as number;
  }

  // Promote directly in the DB: PATCH /user/:id/role is superadmin-only, and every
  // request re-reads the role via JwtStrategy.validate, so the existing token picks
  // the new rank up immediately (no re-sign-in needed).
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

      // Replaying the original (now rotated-out) cookie is reuse.
      const reuse = await request(server)
        .post('/auth/token/refresh')
        .set('Cookie', user.refreshCookie)
        .expect(401);
      expect(reuse.body.code).toBe('AUTH_REFRESH_REUSED');

      // The whole session is now dead — even the rotated-in cookie is refused.
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

      // The creator can delete their own file.
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
    // supertest types the body as `any`; the [files, count] tuple shape is asserted once
    // here so each expectation reads titles off a typed value.
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
      // A column that exists but is not offered — the whitelist, not the schema, decides.
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

      // Unescaped, '%' would match every row instead of the one containing it.
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

      // Count is the filtered total, not the page length.
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

      // file/upload is no longer statically served (ADR 0025 D2) — fileUrl now
      // points at the access-controlled content endpoint, not a static path.
      expect(promote.body.fileUrl).toBe(
        `http://localhost:3000/file/${promote.body.id}/content`,
      );
      expect(existsSync(grantedPath)).toBe(true);
      expect(existsSync(tempPath)).toBe(false);
    });

    // Duplicate-submission contract (ADR 0019): the attach-issued filename is a
    // one-shot claim token, so resubmitting it replays instead of erroring.
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

      // The retry answers 200 (nothing new was created) with the same resource.
      const retry = await request(server)
        .post('/file')
        .set(auth(user.accessToken))
        .send(body)
        .expect(200);

      expect(retry.body.id).toBe(first.body.id);
      expect(retry.body.fileUrl).toBe(first.body.fileUrl);

      // Exactly one row exists — the retry created nothing.
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
  });

  // File visibility + access-controlled content (ADR 0025 D1/D2/D3/D6): every granted
  // read now goes through GET /file/:id/content, gated by the public/private/unlisted
  // state — file/upload is no longer statically served.
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

      // Anonymous, no token: refused.
      const noToken = await request(server)
        .get(`/file/${file.id}/content`)
        .expect(403);
      expect(noToken.body.code).toBe('FILE_SHARE_INVALID');

      // Anonymous, correct token: served.
      const withToken = await request(server)
        .get(`/file/${file.id}/content?share=${firstToken}`)
        .buffer(true)
        .expect(200);
      expect(withToken.body.toString()).toBe(BYTES);

      // Rotate: the old link stops working immediately.
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

  // Deletion policy (ADR 0020): an account that owns files cannot be deleted by
  // accident — the cascade needs an explicit confirmation and takes the stored
  // files with it. Before this, the FK constraint surfaced as an opaque 500.
  describe('Deletion policy (ADR 0020)', () => {
    // Promote a real upload so the assertions can look at the actual file on disk.
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
      // The count is what the client's warning dialog quotes back to the user.
      expect(res.body.message).toContain('2 file(s)');

      // Nothing was destroyed by the refused attempt.
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

      // Both rows are gone: the account can no longer sign in (credentials for a
      // deleted account are simply invalid — 400, the same as a wrong password).
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

  // The board post domain (ADR 0023): CRUD, the fileId claim/replay rules, the
  // creator-OR-admin ownership shape, and the two cross-module consequences —
  // DELETE /file/:id on an attached file, and the account cascade taking posts.
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
      // A network retry must return the same post, not a second one.
      const retry = await createPost(user.accessToken, payload).expect(200);
      expect(retry.body.id).toBe(first.body.id);

      // Different author-written text is a new submission, not a retry — and the
      // file is spent, so it is a typed conflict rather than a 500.
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

      // RBAC extends ownership to admin+ (ADR 0013) — the same shape as files.
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

      // A post references a file; it never owns it.
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

      // The FK is the authority — no pre-check, and never an opaque 500 (D4).
      const res = await request(server)
        .delete(`/file/${fileId}`)
        .set(auth(user.accessToken))
        .expect(409);
      expect(res.body.code).toBe('FILE_IN_USE');

      // Deleting the post first releases the file.
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

      // The confirmation flag guards files only; posts go unconfirmed (D5).
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

  // The board comment domain (ADR 0023): thread CRUD, the ownership shape (author or
  // admin, and deliberately *not* the post's author), and the two delete consequences —
  // the FK cascade from a deleted post, and comments joining the account cascade.
  describe('Comment module (ADR 0023)', () => {
    // Returns the id rather than the response: every caller here threads it into a
    // route or a helper, and res.body is `any`.
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

      // The FK would raise 23503; the service refuses before the insert instead.
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

      // Oldest-first, unlike the newest-first file and post listings (ADR 0023).
      expect(page.body[0].map((c: { body: string }) => c.body)).toEqual([
        'one',
        'two',
      ]);
      expect(page.body[1]).toBe(3);
    });

    it('creates a second comment when the identical body is submitted twice', async () => {
      const user = await createUser('c-dup@e.com');
      const post = await newPost(user.accessToken, 'Dup');

      // No unique column means no natural idempotency key — the repeat is a new
      // comment, documented and accepted exactly as for a post with no fileId.
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

      // The third authorization axis was rejected by ADR 0023 — it would need a
      // comment.post.creator reach-through, and admin moderation covers the case.
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

      // ON DELETE CASCADE — the schema's only database-level cascade (ADR 0023 D3).
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
      // The victim's comment on somebody else's post — unreachable through the post
      // FK cascade, which is why the account cascade deletes comments explicitly first.
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

  // ADR 0024: PATCH /file/:id { userId } can move a file out from under a post, so the
  // account cascade can meet a post it does not own. That was an opaque 500; it is now a
  // typed 409. This is the only path that reproduces it end to end.
  describe('Account cascade FK refusal (ADR 0024)', () => {
    it("refuses the cascade when another user's post holds the account's file", async () => {
      const author = await createUser('adr24-author@e.com');
      const newOwner = await createUser('adr24-owner@e.com');

      // The invariant holds here: the author attaches a file they created.
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

      // ...and is broken here, after creation — assertAttachableBy never runs again.
      await request(server)
        .patch(`/file/${fileId}`)
        .set(auth(author.accessToken))
        .send({ userId: newOwner.id })
        .expect(200);

      const refused = await request(server)
        .delete(`/user/${newOwner.id}?deleteFiles=true`)
        .set(auth(newOwner.accessToken))
        .expect(409);
      expect(refused.body.code).toBe('USER_FILES_IN_USE');

      // The whole transaction rolled back — the account and the post both survive.
      await request(server)
        .get(`/user/${newOwner.id}`)
        .set(auth(newOwner.accessToken))
        .expect(200);
      await request(server)
        .get(`/post/${post.body.id}`)
        .set(auth(author.accessToken))
        .expect(200);

      // Actionable, not a dead end: clearing the blocking post unblocks the delete.
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
