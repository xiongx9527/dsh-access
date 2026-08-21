import assert from 'node:assert/strict';
import test from 'node:test';
import { sanitizeHiddenUnicode, sanitizeJsonStrings, sanitizeText } from '../src/content-sanitization.js';

test('hidden Unicode is removed without changing visible text or line breaks', () => {
  assert.equal(sanitizeHiddenUnicode('alpha\u200bbeta\n1 < 2\u202e\u206a'), 'alphabeta\n1 < 2');
});

test('chat text removes hidden HTML CSS and script payloads but keeps comparisons', () => {
  const input = '<style>.x{display:none}</style><!--secret--><script>alert(1)</script>Hello <b>world</b>\n1 < 2 url(https://evil.test/x)';
  assert.equal(sanitizeText(input), 'Hello world \n1 < 2');
});

test('session history sanitation recursively changes strings without mutating the input', () => {
  const input = { result: { value: [{ text: '<style>x</style>a\u200bb url\u200b(https://evil.test)' }], count: 1 } };
  assert.deepEqual(sanitizeJsonStrings(input), { result: { value: [{ text: 'ab' }], count: 1 } });
  assert.equal(input.result.value[0].text, '<style>x</style>a\u200bb url\u200b(https://evil.test)');
});
