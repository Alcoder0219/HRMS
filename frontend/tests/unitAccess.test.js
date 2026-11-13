import { test } from 'node:test';
import assert from 'node:assert/strict';

import { allUnitsLabel, resolveUnitAccess } from '../src/utils/unitAccess.js';

test('the session decides once loaded; until then only Super Admin and Company Admin see every unit', () => {
  assert.deepEqual(resolveUnitAccess({ role: 'HR', unitAccess: { all: false, units: [{ _id: 'a', name: 'A' }] } }), {
    all: false,
    units: [{ _id: 'a', name: 'A' }],
    loaded: true,
  });
  assert.equal(resolveUnitAccess({ role: 'SUPER_ADMIN' }).all, true);
  assert.equal(resolveUnitAccess({ role: 'COMPANY_ADMIN' }).all, true);
  assert.equal(resolveUnitAccess({ role: 'HR' }).all, false);
  assert.equal(resolveUnitAccess({ role: 'HOD' }).all, false);
  assert.equal(resolveUnitAccess(null).all, false);
});

test('"All units" is offered only to accounts that see every unit', () => {
  assert.equal(allUnitsLabel({ all: true }, 4), 'All units');
  assert.equal(allUnitsLabel({ all: false }, 2), 'All my units', 'a multi-unit HOD');
  assert.equal(allUnitsLabel({ all: false }, 1), null, 'HR in one unit gets no "all" choice');
  assert.equal(allUnitsLabel({ all: false }, 0), null);
});
