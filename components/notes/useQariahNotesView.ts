// @ai-generated
/**
 * Qariah (Sprint 21 round-3): the Notes collection screen shows one of two
 * views, Personal Notes or Reflections (notes published to QuranReflect,
 * with a `qf_post_id`). The route parameter picks it: `?type=personal` or
 * `?type=reflection`. A missing or unknown value falls back to Personal
 * Notes, so the screen never lands empty by default. This hook gives the
 * inherited screen its texts, its filter and the Reflections backfill
 * (2026-10-24 divergence batch C4, SHT-S5).
 */
import {useCallback, useMemo} from 'react';
import {useLocalSearchParams} from 'expo-router';
import {useTranslation} from 'react-i18next';
import type {VerseNote} from '@/types/verse-annotations';
import {backfillReflections} from './qfNoteSync';

export interface QariahNotesViewTexts {
  isReflectionView: boolean;
  title: string;
  icon: 'users' | 'file-text';
  countLabel: (count: number) => string;
  emptyTitle: string;
  emptySubtitle: string;
}

export interface QariahNotesView {
  notesView: QariahNotesViewTexts;
  /** Keeps the notes of this view. Stable while the view stays. */
  filterNotes: (notes: VerseNote[]) => VerseNote[];
  /**
   * Call on each focus: the Reflections view starts the posts backfill and
   * reloads when it adds rows. Returns the focus cleanup, or undefined for
   * the Personal Notes view (it does not read QuranReflect posts).
   */
  backfillOnFocus: (reload: () => void) => (() => void) | undefined;
}

export function useQariahNotesView(): QariahNotesView {
  const {t} = useTranslation(['collection', 'qariah']);
  const params = useLocalSearchParams<{type?: string}>();
  const isReflectionView = params.type === 'reflection';

  const filterNotes = useCallback(
    (notes: VerseNote[]) =>
      notes.filter(n => (isReflectionView ? !!n.qfPostId : !n.qfPostId)),
    [isReflectionView],
  );

  const backfillOnFocus = useCallback(
    (reload: () => void) =>
      isReflectionView ? backfillReflections(reload) : undefined,
    [isReflectionView],
  );

  const notesView = useMemo(
    (): QariahNotesViewTexts => ({
      isReflectionView,
      title: isReflectionView
        ? t('qariah:notes.reflections')
        : t('qariah:notes.personalNotes'),
      icon: isReflectionView ? 'users' : 'file-text',
      countLabel: (count: number) =>
        isReflectionView
          ? t('qariah:notes.countReflections', {count})
          : t('notesScreen.count', {count}),
      emptyTitle: isReflectionView
        ? t('qariah:notes.noReflections')
        : t('qariah:notes.noPersonalNotes'),
      emptySubtitle: isReflectionView
        ? t('qariah:notes.reflectionsHint')
        : t('notesScreen.emptySubtitle'),
    }),
    [isReflectionView, t],
  );

  return {notesView, filterNotes, backfillOnFocus};
}
