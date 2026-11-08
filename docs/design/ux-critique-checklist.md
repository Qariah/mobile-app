# UX critique checklist

One page. A second, fresh agent applies it to a mock set before the owner sees the set. The critic has not seen the brief discussion and has not made the mocks. It reads `docs/design/design-rules.md`, then the mock files, then it writes one finding per failed line. Who runs it, and when: `.claude/skills/qariah-uxd/SKILL.md`, step 5.

## How to write a finding

One line each, in this form:

`<mock id> · <check id> · <what is wrong, with the number> · <the fix>`

Example: `B-dark-a10s · T2 · The "Memorize with me" chip is 24 pt tall · Make the chip 32 pt tall, or give the row a 44 pt touch area.`

A finding names a rule in `docs/design/design-rules.md` when one applies. A finding with no number and no named element is not a finding. A finding that a rule contradicts is wrong: the rule wins.

The verdict at the end is one line: `PASS` (no finding), or `FIX <n>` (the count). A `FIX` goes back to the mock maker. The owner does not see a set with an open finding.

## The checks

### H — Hierarchy

- **H1.** The first thing the eye lands on is the thing the brief is about. Name it. If it is not, say what wins.
- **H2.** The screen has one primary action. Two filled buttons on one screen is a finding. A screen with no action names the one that the brief asks for.
- **H3.** Each text level is one of the sizes in the rules (title, body, caption). A fourth size is a finding.
- **H4.** Secondary text uses the secondary color, not a smaller size of the primary color.

### T — Touch

- **T1.** Every tappable element is 44 pt tall or has a 44 pt hit area, on the small phone width too.
- **T2.** A chip, a badge or an icon that opens something is also 44 pt, or sits inside a 44 pt row.
- **T3.** Two tappable elements are 8 pt or more apart.
- **T4.** The thumb reaches the primary action with one hand on the small phone (the bottom half of the screen, or the header's trailing edge).

### C — Contrast and color

- **C1.** Body text on its background is 4.5:1 or more; a caption too. Large text (20 pt or more) is 3:1 or more. Give the ratio.
- **C2.** The accent is one hue (sage or teal); no new hue is added.
- **C3.** Meaning is not carried by color alone (a badge has an icon or a label; a state has a word).
- **C4.** The dark mock uses the dark theme tokens, not an inverted light mock. Shadows and elevation read on the dark ground.

### R — Arabic and RTL

- **R1.** The RTL variant mirrors the layout: leading edge on the right, back arrows point right, lists and chips flow right to left, progress bars fill from the right.
- **R2.** Arabic text uses the Arabic UI font of the rules, at its own size; it is not the Latin font.
- **R3.** Numbers and times keep their format rule (`docs/design/design-rules.md`, Arabic and RTL).
- **R4.** Reciter and surah names in the Arabic variant are the catalog's Arabic names, not transliterations.
- **R5.** Icons that show direction (play, next, back) mirror only where the rules say so.

### S — States

- **S1.** The empty state says what the person can do next, in one sentence.
- **S2.** The error state says what went wrong and what to do; it does not apologize.
- **S3.** A loading state has a skeleton or a spinner of the component set, not a blank area.
- **S4.** A long name (a 40-character reciter name, a 30-character Arabic name) does not break the layout. The mock shows one.

### F — Fit

- **F1.** At the small phone width (the Galaxy A10s, 360 × 760 CSS px) nothing is cut, overlapped or scrolled sideways.
- **F2.** The mini player and the tab bar do not cover the last row of a list (the bottom inset is in the mock).
- **F3.** With the font scale at 130 % the title and the primary action still fit (say "not checked" when the mock has no scaled variant).
- **F4.** Safe areas: content clears the status bar and the home indicator on the iPhone width.

### A — Accessibility

- **A1.** Every control has a label that says what it does (the mock names the label in a note when it is icon-only).
- **A2.** A container that holds controls is not one accessibility element (the RN rule: `accessible={false}` on a sheet, a card or a row with buttons inside). The mock's note says which containers.
- **A3.** The reading order is the visual order.
- **A4.** Motion is not required to understand the screen; the mock works with motion off.

### V — Voice and content

- **V1.** The copy follows the voice rules: "qariah", not "reciter"; sentence case; a verb in each action; no exclamation marks.
- **V2.** Every string that is new is marked `new string` in the mock's note, so that it goes to the `qariah` i18n namespace with an Arabic line.
- **V3.** The content is real: real surah names, real reciter names from the catalog, real rewayah names. No lorem ipsum, no "Reciter 1".

### D — Set

- **D1.** The set has 2 or 3 options, each in light and dark, at both widths, and one RTL variant. A missing cell is a finding.
- **D2.** The options differ in one named decision each. Two options that differ only in color are one option.
- **D3.** The review page states the decision the owner makes, in one question, with the options named.
