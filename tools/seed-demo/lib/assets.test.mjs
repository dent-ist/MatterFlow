// Run: node --test tools/seed-demo/lib/assets.test.mjs
import test from 'node:test';
import assert from 'node:assert/strict';
import { choosablePool } from './assets.mjs';

test('a re-run after assets were moved off Active does not offer them to task forms', () => {
  const list = [
    { assetId: 1, assetTypeId: 10, dispositionCode: 'ACTIVE' },
    { assetId: 2, assetTypeId: 10, dispositionCode: 'INACTIVE' },
    { assetId: 3, assetTypeId: 11, dispositionCode: 'PENDING_DISPOSITION' },
    { assetId: 4, assetTypeId: 11, dispositionCode: 'DISPOSED' },
    { assetId: 5, assetTypeId: 12 },
    { assetId: 6, assetTypeId: 12, dispositionCode: null },
  ];
  assert.deepEqual(
    choosablePool(list).map((a) => a.assetId),
    [1, 5, 6],
  );
});

test('an empty list gives an empty pool', () => {
  assert.deepEqual(choosablePool([]), []);
});
