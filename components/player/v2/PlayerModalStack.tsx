// @ai-generated
// Qariah (TECH_DEBT #260, issue #896): keep Android screen readers out of the
// app behind the open full player.
//
// The full player (PlayerSurface) is a sibling of the root Stack, drawn over
// it. It sets `accessibilityViewIsModal`, but that prop is iOS only. On
// Android the screens and the mini player behind the open player stayed in
// the accessibility tree: on the Pixel 3, TalkBack put its first focus on a
// row of the reciter profile behind the player, and its next moves went to
// the screen behind, not to the player's controls (2026-11-14,
// vc4570). So while the player is open, the Stack's wrapper hides its
// descendants from accessibility on Android. iOS keeps the modal prop.
import React from 'react';
import {Platform, StyleSheet, View} from 'react-native';
import {Stack} from 'expo-router';
import {usePlayerStore} from '@/services/player/store/playerStore';
import {selectForegroundQueue} from '@/services/player/store/foregroundPlayerState';

/**
 * The accessibility mode of the app behind the player: hidden while the full
 * player is open on Android, else unchanged.
 *
 * `playerShown` is the show condition of PlayerHost (a current track, and no
 * state restore). `sheetMode` can be 'full' while PlayerHost draws nothing
 * (a widget deep link with an empty queue, or during the restore). Then no
 * player covers the app, so the app must stay reachable.
 */
export function behindPlayerImportance(
  sheetMode: string,
  os: typeof Platform.OS,
  playerShown: boolean,
): 'auto' | 'no-hide-descendants' {
  return os === 'android' && sheetMode === 'full' && playerShown
    ? 'no-hide-descendants'
    : 'auto';
}

type StackProps = React.ComponentProps<typeof Stack>;

/** The root Stack, hidden from Android accessibility while the player is open. */
export function PlayerModalStack(props: StackProps) {
  const sheetMode = usePlayerStore(s => s.sheetMode);
  // The same condition as `shouldShow` in PlayerHost.
  const playerShown = usePlayerStore(s => {
    const queue = selectForegroundQueue(s);
    return (
      !s.loading?.stateRestoring && !!queue?.tracks?.[queue?.currentIndex ?? -1]
    );
  });
  return (
    <View
      style={styles.fill}
      collapsable={false}
      importantForAccessibility={behindPlayerImportance(
        sheetMode,
        Platform.OS,
        playerShown,
      )}>
      <Stack {...props} />
    </View>
  );
}

const styles = StyleSheet.create({
  fill: {flex: 1},
});
