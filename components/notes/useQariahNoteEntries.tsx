// @ai-generated
import React, {useCallback, useState} from 'react';
import {moderateScale} from 'react-native-size-matters';
import {Feather} from '@expo/vector-icons';
import {useTranslation} from 'react-i18next';
import type {VerseNote} from '@/types/verse-annotations';

/** One card of the Collection tab (the shape of its `CategoryItem`). */
export interface QariahCollectionEntry {
  id: string;
  label: string;
  icon: React.ReactNode;
  color: string;
  count: number;
  emptyText: string;
  route: string;
}

/**
 * Qariah (Sprint 21 round-3): the Collection tab shows two cards in place of
 * upstream's one Notes card, Personal Notes and Reflections. Reflections are
 * notes synced to QF with a published post id; everything else is a Personal
 * Note (signed-out local-only notes too). Each card opens the Notes screen in
 * its view (2026-10-24 divergence batch C4, SHT-S5).
 *
 * @returns `noteEntries`, the two cards; `countNotes`, which counts the notes
 *   (stable; call it with every note).
 */
export function useQariahNoteEntries(): {
  noteEntries: QariahCollectionEntry[];
  countNotes: (notes: VerseNote[]) => void;
} {
  const {t} = useTranslation('qariah');
  const [personalNoteCount, setPersonalNoteCount] = useState(0);
  const [reflectionCount, setReflectionCount] = useState(0);

  const countNotes = useCallback((notes: VerseNote[]) => {
    let reflections = 0;
    let personals = 0;
    for (const note of notes) {
      if (note.qfPostId) reflections += 1;
      else personals += 1;
    }
    setPersonalNoteCount(personals);
    setReflectionCount(reflections);
  }, []);

  const noteEntries: QariahCollectionEntry[] = [
    {
      id: 'personal-notes',
      label: t('notes.personalNotes'),
      icon: (
        <Feather name="file-text" size={moderateScale(22)} color="#3B82F6" />
      ),
      color: '#3B82F6',
      count: personalNoteCount,
      emptyText: t('notes.noPersonalNotes'),
      route: '/collection/notes?type=personal',
    },
    {
      id: 'reflections',
      label: t('notes.reflections'),
      icon: <Feather name="users" size={moderateScale(22)} color="#5645a1" />,
      color: '#5645a1',
      count: reflectionCount,
      emptyText: t('notes.noReflections'),
      route: '/collection/notes?type=reflection',
    },
  ];

  return {noteEntries, countNotes};
}
