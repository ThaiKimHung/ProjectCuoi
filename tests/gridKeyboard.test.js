import assert from 'node:assert/strict';
import { test } from 'node:test';
import { countGridColumns, gridKeyAction, isTypingTarget, nextGridIndex } from '../client/src/gridKeyboard.js';

test('columns are counted from cards sharing the first row', () => {
  const cards = [0, 0, 0, 0, 210, 210, 420].map(offsetTop => ({ offsetTop }));
  assert.equal(countGridColumns(cards), 4);
  assert.equal(countGridColumns([{ offsetTop: 0 }, { offsetTop: 50 }]), 1);
  assert.equal(countGridColumns([]), 1);
});

test('arrow keys move within a 4-column grid of 10 photos and stay inside it', () => {
  const move = (index, key) => nextGridIndex(index, key, 10, 4);
  assert.equal(move(0, 'ArrowRight'), 1);
  assert.equal(move(0, 'ArrowLeft'), 0);
  assert.equal(move(1, 'ArrowDown'), 5);
  assert.equal(move(5, 'ArrowUp'), 1);
  assert.equal(move(7, 'ArrowDown'), 7, 'no photo below the last row');
  assert.equal(move(2, 'ArrowUp'), 2);
  assert.equal(move(4, 'Home'), 0);
  assert.equal(move(4, 'End'), 9);
  assert.equal(move(3, 'Enter'), null);
});

test('the first move without a cursor starts at the first or last photo', () => {
  assert.equal(nextGridIndex(null, 'ArrowRight', 10, 4), 0);
  assert.equal(nextGridIndex(-1, 'ArrowDown', 10, 4), 0);
  assert.equal(nextGridIndex(null, 'ArrowUp', 10, 4), 9);
  assert.equal(nextGridIndex(null, 'ArrowRight', 0, 4), null);
});

test('keys map to grid actions; modifiers and other keys are ignored', () => {
  assert.deepEqual(gridKeyAction({ key: 'ArrowDown' }), { type: 'move', key: 'ArrowDown' });
  assert.deepEqual(gridKeyAction({ key: 'ArrowDown', shiftKey: true }), { type: 'extend', key: 'ArrowDown' });
  assert.deepEqual(gridKeyAction({ key: '1' }), { type: 'triage', status: 'pick' });
  assert.deepEqual(gridKeyAction({ key: '3' }), { type: 'triage', status: 'reject' });
  assert.deepEqual(gridKeyAction({ key: '0' }), { type: 'triage', status: null });
  assert.deepEqual(gridKeyAction({ key: ' ' }), { type: 'select' });
  assert.deepEqual(gridKeyAction({ key: 'F' }), { type: 'favorite' });
  assert.deepEqual(gridKeyAction({ key: '?', shiftKey: true }), { type: 'help' });
  assert.equal(gridKeyAction({ key: 'z', metaKey: true }), null);
  assert.equal(gridKeyAction({ key: '1', ctrlKey: true }), null);
  assert.equal(gridKeyAction({ key: 'q' }), null);
});

test('typing targets are recognised', () => {
  assert.equal(isTypingTarget({ tagName: 'INPUT' }), true);
  assert.equal(isTypingTarget({ tagName: 'SELECT' }), true);
  assert.equal(isTypingTarget({ tagName: 'DIV', isContentEditable: true }), true);
  assert.equal(isTypingTarget({ tagName: 'BUTTON' }), false);
  assert.equal(isTypingTarget(null), false);
});
