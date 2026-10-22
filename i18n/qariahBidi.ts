// @ai-generated
// Qariah (TECH_DEBT #310): keep a Latin run, such as a handle or a licence id,
// in its own order inside Arabic text. Without an isolate, the bidi algorithm
// moves neutral characters at its ends: "@OKKHALIL3" showed as "OKKHALIL3@".

const FIRST_STRONG_ISOLATE = '⁨';
const POP_DIRECTIONAL_ISOLATE = '⁩';

/**
 * `text` inside a first-strong isolate (U+2068 … U+2069). The marks are
 * invisible, and they change nothing in left-to-right text.
 */
export function isolate(text: string): string {
  return `${FIRST_STRONG_ISOLATE}${text}${POP_DIRECTIONAL_ISOLATE}`;
}
