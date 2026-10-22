// @ai-generated
// Qariah (Sprint 48, S48.8, Task 18): every announcement id has its notice
// text, in English and in Arabic, and i18next finds it under the id.
import i18n from 'i18next';
import {QARIAH_ANNOUNCEMENT_ID} from '../qariahAnnouncement';
import {
  ANNOUNCEMENT_ID_FORMAT,
  announcementTextKeys,
  whatsNewCandidate,
} from '@/services/notifications/announcement';
import en from '@/i18n/locales/en/qariah.json';
import ar from '@/i18n/locales/ar/qariah.json';

/** The id of the first build with an announcement (Sprint 48 betas). */
const FIRST_ANNOUNCEMENT_ID = '2026-10-sprint48';

/** The notice limits of `config/qariahAnnouncement.ts`. */
const MAX_TITLE = 40;
const MAX_BODY = 100;

type AnnouncementTexts = Record<string, {title?: string; body?: string}>;
const english = (en as {announcement?: AnnouncementTexts}).announcement ?? {};
const arabic = (ar as {announcement?: AnnouncementTexts}).announcement ?? {};

// The configured id, and each id that has text (an old id keeps its text, so
// a build of that id still shows it).
const ids = [
  ...new Set([
    ...(QARIAH_ANNOUNCEMENT_ID ? [QARIAH_ANNOUNCEMENT_ID] : []),
    ...Object.keys(english),
    ...Object.keys(arabic),
  ]),
];

describe('the Qariah announcement', () => {
  it('is an id in the YYYY-MM-<slug> format, or null', () => {
    if (QARIAH_ANNOUNCEMENT_ID !== null) {
      expect(QARIAH_ANNOUNCEMENT_ID).toMatch(ANNOUNCEMENT_ID_FORMAT);
    }
  });

  it('never sorts before the first announcement id', () => {
    // The rule announces only an id that sorts after the last recorded one
    // (`announcementAction`). The betas of Sprint 48 recorded
    // '2026-10-sprint48', so the release id must sort after every beta id,
    // or a beta tester who installs the release gets no announcement.
    if (QARIAH_ANNOUNCEMENT_ID === null) return;
    expect(QARIAH_ANNOUNCEMENT_ID >= FIRST_ANNOUNCEMENT_ID).toBe(true);
  });

  it('has at least one id to check', () => {
    expect(ids.length).toBeGreaterThan(0);
  });

  it.each(ids)('%s has an English and an Arabic title and body', id => {
    expect(id).toMatch(ANNOUNCEMENT_ID_FORMAT);
    for (const [language, texts] of [
      ['en', english],
      ['ar', arabic],
    ] as const) {
      const title = texts[id]?.title ?? '';
      const body = texts[id]?.body ?? '';
      expect({language, id, title: title.length > 0}).toEqual({
        language,
        id,
        title: true,
      });
      expect({language, id, body: body.length > 0}).toEqual({
        language,
        id,
        body: true,
      });
      expect({language, id, short: title.length <= MAX_TITLE}).toEqual({
        language,
        id,
        short: true,
      });
      expect({language, id, short: body.length <= MAX_BODY}).toEqual({
        language,
        id,
        short: true,
      });
      // The notice has no params (`whatsNewCandidate`), so a placeholder
      // would show as written.
      expect(`${title} ${body}`).not.toMatch(/{{/);
    }
    expect(arabic[id]?.title).toMatch(/[\u0600-\u06FF]/);
    expect(arabic[id]?.body).toMatch(/[\u0600-\u06FF]/);
  });

  it.each(ids)('%s resolves through i18next (a key with dashes)', id => {
    const keys = announcementTextKeys(id);
    // The key is built at run time, so it is not one of the typed keys.
    const translate = i18n.t.bind(i18n) as unknown as (
      key: string,
      options: {lng: string},
    ) => string;
    expect(i18n.exists(keys.title, {lng: 'en'})).toBe(true);
    expect(i18n.exists(keys.body, {lng: 'ar'})).toBe(true);
    expect(translate(keys.title, {lng: 'en'})).toBe(english[id]?.title);
    expect(translate(keys.body, {lng: 'ar'})).toBe(arabic[id]?.body);
  });

  it('gives the whats_new notice the keys of the configured id', () => {
    if (QARIAH_ANNOUNCEMENT_ID === null) return;
    const candidate = whatsNewCandidate(QARIAH_ANNOUNCEMENT_ID);
    expect(candidate.title).toEqual({
      key: announcementTextKeys(QARIAH_ANNOUNCEMENT_ID).title,
    });
    expect(candidate.body).toEqual({
      key: announcementTextKeys(QARIAH_ANNOUNCEMENT_ID).body,
    });
  });
});
