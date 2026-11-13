// @ai
// SEM-S3 (Sprint 51) — the QF OAuth scope list holds only the scopes that a
// call of the app needs (the map is in the `DEFAULT_SCOPES` comment in
// `services/auth/config.ts`). A change to the list changes the consent screen
// and what QF grants at sign-in, so this test makes each change explicit.

import {getQfOAuthConfig} from '../config';

describe('QF OAuth scopes (SEM-S3)', () => {
  const {scopes} = getQfOAuthConfig();

  it('asks for exactly the scopes that a call needs', () => {
    expect(scopes).toEqual([
      'openid',
      'offline_access',
      'user',
      'preference',
      'reading_session',
      'note.read',
      'note.create',
      'note.update',
      'note.delete',
      'post.read',
      'post.create',
      'post.update',
      'post.delete',
    ]);
  });

  it('does not ask for the scopes that no call uses', () => {
    for (const unused of [
      'collection',
      'bookmark',
      'goal',
      'streak',
      'post.like',
      'post.save',
      'comment.read',
      'comment.create',
      'comment.like',
    ]) {
      expect(scopes).not.toContain(unused);
    }
  });

  it('asks for no bare parent scope that Hydra drops (note, post, comment)', () => {
    expect(scopes).not.toContain('note');
    expect(scopes).not.toContain('post');
    expect(scopes).not.toContain('comment');
  });
});
