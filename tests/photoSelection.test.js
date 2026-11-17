import assert from 'node:assert/strict';
import { test } from 'node:test';
import { addPhotoSelectionRange } from '../client/src/photoSelection.js';

const photoList = (...paths) => paths.map(relPath => ({ relPath }));

test('a range uses visible order, includes both ends, and keeps prior selections', () => {
  const visible = photoList('d.jpg', 'c.jpg', 'b.jpg', 'a.jpg');
  assert.deepEqual(
    addPhotoSelectionRange(['b.jpg', 'previous.jpg'], visible, 'b.jpg', 'd.jpg'),
    ['b.jpg', 'previous.jpg', 'd.jpg', 'c.jpg'],
  );
  assert.deepEqual(
    addPhotoSelectionRange([], visible, 'd.jpg', 'b.jpg'),
    ['d.jpg', 'c.jpg', 'b.jpg'],
  );
});

test('a range cannot start from a photo hidden by the current filter', () => {
  assert.equal(addPhotoSelectionRange(['hidden.jpg'], photoList('a.jpg', 'c.jpg'), 'hidden.jpg', 'c.jpg'), null);
});
