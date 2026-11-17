// Keyboard control of the photo grid: pure helpers so they can be unit tested.

// Columns of a CSS grid, read from the cards' positions (cards on the first row
// share its top edge). List view and single-column layouts return 1.
export function countGridColumns(cards) {
  if (!cards.length) return 1;
  const firstTop = cards[0].offsetTop;
  let columns = 0;
  for (const card of cards) {
    if (Math.abs(card.offsetTop - firstTop) > 2) break;
    columns++;
  }
  return Math.max(1, columns);
}

// Where the cursor goes for a navigation key, or null if the key doesn't move it.
// Stays inside the list; Up/Down jump a whole row.
export function nextGridIndex(index, key, count, columns = 1) {
  if (count <= 0) return null;
  if (index == null || index < 0) {
    return ['ArrowLeft', 'ArrowUp', 'End'].includes(key) ? count - 1 : 0;
  }
  const clamp = value => Math.min(count - 1, Math.max(0, value));
  switch (key) {
    case 'ArrowRight': return clamp(index + 1);
    case 'ArrowLeft': return clamp(index - 1);
    case 'ArrowDown': return index + columns < count ? index + columns : index;
    case 'ArrowUp': return index - columns >= 0 ? index - columns : index;
    case 'Home': return 0;
    case 'End': return count - 1;
    default: return null;
  }
}

const TRIAGE_KEYS = { 1: 'pick', 2: 'maybe', 3: 'reject' };
const MOVE_KEYS = new Set(['ArrowRight', 'ArrowLeft', 'ArrowDown', 'ArrowUp', 'Home', 'End']);

// Map a keydown to a grid action. Returns null for keys the grid leaves alone.
export function gridKeyAction(event) {
  if (event.metaKey || event.ctrlKey || event.altKey) return null;
  const key = event.key;
  if (MOVE_KEYS.has(key)) return { type: event.shiftKey ? 'extend' : 'move', key };
  if (event.shiftKey && key !== '?') return null;
  if (TRIAGE_KEYS[key]) return { type: 'triage', status: TRIAGE_KEYS[key] };
  if (key === '0') return { type: 'triage', status: null };
  if (key === ' ') return { type: 'select' };
  if (key === 'Enter') return { type: 'open' };
  if (key === 'f' || key === 'F') return { type: 'favorite' };
  if (key === 'v' || key === 'V') return { type: 'viewed' };
  if (key === '?') return { type: 'help' };
  return null;
}

// Typing in a field, a select or an editable element must never trigger grid shortcuts.
export function isTypingTarget(target) {
  if (!target || typeof target !== 'object') return false;
  const tag = target.tagName;
  return tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT' || Boolean(target.isContentEditable);
}
