// @ai-generated
// Qariah (Sprint 48, S48.6, Task 16): the "a track played to its end" signal.
//
// The upstream audio provider (`services/audio/ExpoAudioProvider.tsx`,
// `handleTrackEnd`) calls `notePlaybackCompleted()` once, where it sends
// `playback_completed`. The notification card (`softPrompt.ts`) listens.
// No imports: the provider is on the playback path.

type Listener = () => void;

const listeners = new Set<Listener>();

/** A surah track played to its end (not an upload). Never throws. */
export function notePlaybackCompleted(): void {
  listeners.forEach(listener => {
    try {
      listener();
    } catch {
      // A listener must not break the playback.
    }
  });
}

/** Calls `listener` at each completed play. Returns the unsubscribe. */
export function onPlaybackCompleted(listener: Listener): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}
