import { test } from 'node:test';
import assert from 'node:assert/strict';

import { matchesPhrase, serverSearchTerm } from '../src/utils/employeeSearch.js';

const zuhura = { employeeCode: 'EMP00270', employeeId: '10270X', firstName: 'Zuhura', lastName: 'Mwinyi' };

test('a code, an ID or one name goes to the server as typed', () => {
  assert.equal(serverSearchTerm('EMP00270'), 'EMP00270');
  assert.equal(serverSearchTerm('  10270X '), '10270X');
  assert.equal(serverSearchTerm('Zuhura'), 'Zuhura');
  assert.equal(serverSearchTerm(''), '');
});

test('a full name searches by its first word and is narrowed by the whole phrase', () => {
  assert.equal(serverSearchTerm('Zuhura Mwinyi'), 'Zuhura');
  assert.equal(matchesPhrase(zuhura, 'zuhura mwinyi'), true);
  assert.equal(matchesPhrase({ ...zuhura, lastName: 'Ally' }, 'Zuhura Mwinyi'), false);
  assert.equal(matchesPhrase(zuhura, 'Zuhura'), true, 'a single word is left to the server');
});
