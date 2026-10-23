// Screen tree helpers for the test iPhone driver (TECH_DEBT #299).
//
// WebDriverAgent gives the accessibility tree of the screen as JSON (`GET /source?format=json`).
// These functions flatten that tree and find elements with the selector rules of Maestro, so
// that the `.maestro` flows run on the iPhone with the same meaning:
//   - `text` is a full-match, case-insensitive regular expression. It matches the label, the
//     value or the name of an element (iOS puts the visible text of a React Native view in its
//     label).
//   - `id` is a full-match regular expression on the accessibility identifier (the `testID`).
//   - `index` picks the n-th match, in screen order (top to bottom, then left to right).
//   - `enabled` and `checked` filter the matches.
// The functions are pure, so Jest tests them without a device.

/** One element of the flattened tree. */
export function toNode(raw) {
  const r = raw.rect || raw.frame || {};
  return {
    type: raw.type || '',
    id: raw.rawIdentifier ?? raw.identifier ?? '',
    name: raw.name ?? '',
    label: raw.label ?? '',
    value: raw.value == null ? '' : String(raw.value),
    enabled: raw.isEnabled !== false && raw.isEnabled !== '0',
    visibleFlag:
      raw.isVisible == null
        ? null
        : raw.isVisible === true || raw.isVisible === '1',
    // An accessibility element is what VoiceOver can focus. Its children are hidden from
    // VoiceOver and from XCUITest.
    accessible: raw.isAccessible === true || raw.isAccessible === '1',
    rect: {
      x: Number(r.x) || 0,
      y: Number(r.y) || 0,
      width: Number(r.width) || 0,
      height: Number(r.height) || 0,
    },
  };
}

/** Flattens the WebDriverAgent JSON tree into a list, parents before children. */
export function flatten(root) {
  const out = [];
  const walk = raw => {
    if (!raw || typeof raw !== 'object') return;
    out.push(toNode(raw));
    for (const child of raw.children || []) walk(child);
  };
  walk(root);
  return out;
}

/** The screen rect is the rect of the root (the application) element. */
export function screenOf(nodes) {
  const app = nodes.find(n => /Application$/.test(n.type)) || nodes[0];
  return app ? app.rect : {x: 0, y: 0, width: 0, height: 0};
}

/** An element is on screen when its rect has an area and intersects the screen. */
export function isOnScreen(node, screen) {
  if (node.visibleFlag === false) return false;
  const {x, y, width, height} = node.rect;
  if (width <= 0 || height <= 0) return false;
  return (
    x < screen.x + screen.width &&
    x + width > screen.x &&
    y < screen.y + screen.height &&
    y + height > screen.y
  );
}

/** Makes a full-match, case-insensitive RegExp from a Maestro pattern. */
export function fullMatch(pattern, {caseInsensitive = true} = {}) {
  return new RegExp(`^(?:${pattern})$`, caseInsensitive ? 'is' : 's');
}

/**
 * Normalizes a Maestro selector. A string is a `text` selector. An object can have `text`,
 * `id`, `index`, `enabled`, `checked`, `point` (with no other key, a tap on that point).
 */
export function normalizeSelector(sel) {
  if (sel == null) throw new Error('selector is empty');
  if (typeof sel === 'string' || typeof sel === 'number')
    return {text: String(sel)};
  return {...sel};
}

function textMatches(node, re) {
  return (
    re.test(node.label) ||
    re.test(node.value) ||
    (node.name !== node.id && re.test(node.name))
  );
}

function checkedOf(node) {
  // A UISwitch (and a React Native Switch) reports "1" or "0" in its value.
  if (node.value === '1' || /^(on|true|checked)$/i.test(node.value))
    return true;
  if (node.value === '0' || /^(off|false|unchecked)$/i.test(node.value))
    return false;
  return null;
}

/** Elements that match the selector and are on screen, in screen order. */
export function findAll(nodes, selector, screen = screenOf(nodes)) {
  const sel = normalizeSelector(selector);
  const textRe = sel.text != null ? fullMatch(String(sel.text)) : null;
  const idRe =
    sel.id != null ? fullMatch(String(sel.id), {caseInsensitive: false}) : null;
  const matches = nodes.filter(n => {
    if (/Application$|Window$/.test(n.type)) return false;
    if (!isOnScreen(n, screen)) return false;
    if (idRe && !idRe.test(n.id)) return false;
    if (textRe && !textMatches(n, textRe)) return false;
    if (sel.enabled != null && n.enabled !== Boolean(sel.enabled)) return false;
    if (sel.checked != null && checkedOf(n) !== Boolean(sel.checked))
      return false;
    return Boolean(
      idRe || textRe || sel.enabled != null || sel.checked != null,
    );
  });
  // A React Native view and its text child often both match a text selector. Keep the
  // innermost match only, so that the tap goes to the element that shows the text.
  const innermost = matches.filter(
    (n, i) =>
      !matches.some(
        (m, j) =>
          j !== i &&
          contains(n.rect, m.rect) &&
          area(m.rect) < area(n.rect) &&
          (!idRe || idRe.test(m.id)),
      ),
  );
  return innermost.sort((a, b) => a.rect.y - b.rect.y || a.rect.x - b.rect.x);
}

/** The element at `index` (default 0) of the matches, or null. */
export function findOne(nodes, selector, screen) {
  const sel = normalizeSelector(selector);
  const all = findAll(nodes, sel, screen);
  const index = sel.index == null ? 0 : Number(sel.index);
  return all[index] || null;
}

/** The center point of a rect. */
export function center(rect) {
  return {x: rect.x + rect.width / 2, y: rect.y + rect.height / 2};
}

/** Resolves a Maestro `point` ("50%,32%" or "120,300") to screen points. */
export function resolvePoint(point, screen) {
  const parts = String(point)
    .split(',')
    .map(s => s.trim());
  if (parts.length !== 2) throw new Error(`bad point "${point}"`);
  const axis = (s, size, origin) =>
    s.endsWith('%') ? origin + (size * parseFloat(s)) / 100 : parseFloat(s);
  return {
    x: axis(parts[0], screen.width, screen.x),
    y: axis(parts[1], screen.height, screen.y),
  };
}

function contains(outer, inner) {
  return (
    inner.x >= outer.x &&
    inner.y >= outer.y &&
    inner.x + inner.width <= outer.x + outer.width &&
    inner.y + inner.height <= outer.y + outer.height
  );
}

function area(r) {
  return r.width * r.height;
}

/** A short text form of the visible elements, for a FAIL report. */
export function describeScreen(nodes, screen = screenOf(nodes), limit = 60) {
  const lines = [];
  for (const n of nodes) {
    if (!isOnScreen(n, screen)) continue;
    if (!n.label && !n.id && !n.value) continue;
    const parts = [n.type.replace(/^XCUIElementType/, '')];
    if (n.id) parts.push(`id=${n.id}`);
    if (n.label) parts.push(`"${n.label}"`);
    if (n.value && n.value !== n.label) parts.push(`value=${n.value}`);
    lines.push(parts.join(' '));
    if (lines.length >= limit) break;
  }
  return lines.join('\n');
}

/**
 * The overlay that covers the center of an element, or null. A floating tab bar, the mini
 * player and a toolbar stay on top of a scrolled list: an element under them is "on screen"
 * by its rect, but a tap at its center reaches the overlay.
 */
export function coveringOverlay(node, nodes) {
  const c = center(node.rect);
  const inside = (r, p) =>
    p.x >= r.x && p.x <= r.x + r.width && p.y >= r.y && p.y <= r.y + r.height;
  return (
    nodes.find(
      n =>
        (/TabBar$|Toolbar$/.test(n.type) || n.id === 'mini-player-bar') &&
        n !== node &&
        inside(n.rect, c) &&
        !contains(n.rect, node.rect),
    ) || null
  );
}
