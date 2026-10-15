import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createInviteUrl, normalizeInviteCode, readRoomInvite, withoutRoomInvite } from '../src/online/inviteUrl';

test('invite parsing normalizes ASCII codes using the existing six-character policy', () => {
  assert.deepEqual(readRoomInvite(''), { present: false, code: null });
  assert.deepEqual(readRoomInvite('?other=123'), { present: false, code: null });
  assert.deepEqual(readRoomInvite('?room=abc123'), { present: true, code: 'ABC123' });
  assert.equal(readRoomInvite('?room=%20aBc123%20').code, 'ABC123');
  assert.equal(normalizeInviteCode('  abc123  '), 'ABC123');
});

test('empty, duplicate, overlong, malformed and injected room queries are rejected safely', () => {
  for (const query of ['?room=', '?room=ABC12', '?room=ABC1234', '?room=%3Cimg%3E', '?room=AB%00123',
    '?room=ab%26x12', '?room=%', '?room=ＡＢＣ１２３', '?room=aß123', '?room=ABC123&room=DEF456', `?room=${'A'.repeat(10000)}`]) {
    assert.deepEqual(readRoomInvite(query), { present: true, code: null });
  }
});

test('generated invite contains only origin, current path and public room code', () => {
  for (const href of ['http://localhost:5173/', 'https://example.com/base/', 'https://example.com//other.example/path']) {
    const original = new URL(href);
    const link = new URL(createInviteUrl(`${href}?token=private&socketId=secret&room=OLD123#private`, 'abc123'));
    assert.equal(link.origin, original.origin); assert.equal(link.pathname, original.pathname);
    assert.deepEqual([...link.searchParams], [['room', 'ABC123']]); assert.equal(link.hash, '');
  }
  assert.equal(new URL(createInviteUrl('https://user:password@example.com/game?secret=x', 'ABC123')).username, '');
  assert.throws(() => createInviteUrl('https://example.com/', 'invalid'));
});

test('invite consumption removes only room and preserves other URL context', () => {
  assert.equal(withoutRoomInvite('https://example.com/base/?room=ABC123&lang=ko#help'), 'https://example.com/base/?lang=ko#help');
  assert.equal(withoutRoomInvite('https://example.com/?room=ABC123&room=DEF456'), 'https://example.com/');
  assert.equal(withoutRoomInvite('https://example.com//other.example/path?room=ABC123'), 'https://example.com//other.example/path');
});
