import { INestApplication } from '@nestjs/common';
import { DataSource } from 'typeorm';
import request from 'supertest';
import { App } from 'supertest/types';
import { existsSync } from 'fs';
import { unlink } from 'fs/promises';
import { join } from 'path';
import { FileEntity } from '../backend/file/entity/file.entity';
import {
  setupE2E,
  teardownE2E,
  truncateAll,
  basic,
  refreshCookieFrom,
} from './e2e-utils';

// End-to-end coverage of the paths unit tests cannot reach: the auth flow over real
// HTTP+DB, refresh rotation/reuse (ADR 0012), RBAC ownership 403s, list pagination,
// and the temp_ → granted_ physical promotion. Requires the local Postgres on 5435
// (docker start upload-board-pg); the suite owns a throwaway DB (see e2e-utils).
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

      expect(promote.body.fileUrl).toContain('file/upload/');
      expect(promote.body.fileUrl).toContain('granted_');
      expect(existsSync(grantedPath)).toBe(true);
      expect(existsSync(tempPath)).toBe(false);
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
});
