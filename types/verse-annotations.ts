export type HighlightColor = 'yellow' | 'green' | 'blue' | 'orange' | 'purple';

export const HIGHLIGHT_COLORS: Record<HighlightColor, string> = {
  yellow: 'rgba(255, 243, 176, 0.3)',
  green: 'rgba(184, 240, 192, 0.3)',
  blue: 'rgba(176, 212, 255, 0.3)',
  orange: 'rgba(255, 212, 176, 0.3)',
  purple: 'rgba(212, 176, 255, 0.3)',
};

// @ai #276 — persistent tint for bookmarked verses in the mushaf renderers.
// With coloredHighlights disabled the bookmark is the user's only marker, so
// it must leave a visible trace; an explicit colored highlight overrides it.
export const BOOKMARK_HIGHLIGHT_COLOR = HIGHLIGHT_COLORS.yellow;

// Optional rewayah this annotation was saved in. Null on legacy rows
// written before rewayah stamping was introduced — the UI treats those
// as rewayah-agnostic and opens them in whatever is currently active.
import type {RewayahId} from '@/store/mushafSettingsStore';

export interface VerseBookmark {
  id: string;
  verseKey: string;
  surahNumber: number;
  ayahNumber: number;
  createdAt: number;
  rewayahId?: RewayahId;
}

export interface VerseNote {
  id: string;
  verseKey: string;
  surahNumber: number;
  ayahNumber: number;
  content: string;
  verseKeys?: string[];
  createdAt: number;
  updatedAt: number;
  rewayahId?: RewayahId;
  /**
   * QF Notes API note id. Set when the note has been synced to QF
   * (`auth.v1.notes.*`). Null on pure-local notes (signed-out users,
   * or notes created before Sprint 18's Slice B sync landed).
   */
  qfNoteId?: string | null;
  /**
   * QF QuranReflect post id, present when this note has been published.
   * Returned by the `auth.v1.notes/{id}/publish` call. Null on private
   * notes. Unpublish = `DELETE quranReflect.v1.posts/{qfPostId}` +
   * nulling this field.
   */
  qfPostId?: string | null;
}

export interface VerseHighlight {
  id: string;
  verseKey: string;
  surahNumber: number;
  ayahNumber: number;
  color: HighlightColor;
  createdAt: number;
  rewayahId?: RewayahId;
}
