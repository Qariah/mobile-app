// @ai Qariah: the bottom sheet of the auth modals (sign-out, import, v1
// restore). A copy of the inherited `components/BottomSheetModal.tsx`, which
// upstream never imports, with two Qariah fixes: the mount rule for a closed
// sheet (TECH_DEBT #267) and `accessible={false}` (Sprint 50). The inherited
// file stays byte-identical to upstream (divergence batch C1, SHT-S18).
import React, {useCallback, useRef, useEffect, useState} from 'react';
import {
  View,
  Modal,
  StyleProp,
  ViewStyle,
  Platform,
  BackHandler,
} from 'react-native';
import BottomSheet, {
  BottomSheetBackdrop,
  BottomSheetBackdropProps,
  BottomSheetHandleProps,
} from '@gorhom/bottom-sheet';
import {useTheme} from '@/hooks/useTheme';
import {useResponsive} from '@/hooks/useResponsive';
import {TabletDialog} from '@/components/layout/TabletDialog';
import {moderateScale, ScaledSheet} from '@/utils/scale';
import {Theme} from '@/utils/themeUtils';
import Color from 'color';

// Custom handle component for the bottom sheet
const CustomHandle = (_props: BottomSheetHandleProps) => {
  const {theme} = useTheme();
  return (
    <View style={handleStyles.container}>
      <View
        style={[
          handleStyles.handle,
          {backgroundColor: Color(theme.colors.text).alpha(0.2).toString()},
        ]}
      />
    </View>
  );
};

// Separate styles for the handle to avoid theme dependency issues
const handleStyles = ScaledSheet.create({
  container: {
    paddingTop: 12,
    paddingBottom: 8,
    alignItems: 'center',
  },
  handle: {
    width: 40,
    height: 5,
    borderRadius: 3,
  },
});

interface QariahBottomSheetModalProps {
  isVisible: boolean;
  onClose: () => void;
  snapPoints?: string[];
  children: React.ReactNode;
  contentContainerStyle?: StyleProp<ViewStyle>;
}

const QariahBottomSheetModal: React.FC<QariahBottomSheetModalProps> = ({
  isVisible,
  onClose,
  snapPoints = ['40%'],
  children,
  contentContainerStyle,
}) => {
  const {theme} = useTheme();
  const {isTablet} = useResponsive();
  const bottomSheetRef = useRef<BottomSheet>(null);

  // @ai TECH_DEBT #267 — the sheet is in the tree only from its first open
  // until its close animation ends. gorhom 5.2.14 starts a sheet at the window
  // height and does not move a sheet that mounts closed (index -1) to its real
  // closed position. On Android the window height excludes the navigation
  // bar, and Settings draws edge to edge, so the top of the closed sheet (the
  // "Sign out of Qariah?" title) showed under the tab bar. A sheet that mounts
  // open animates in, and its close animation ends at the real closed
  // position; then `handleSheetClose` removes it.
  const [mounted, setMounted] = useState(isVisible);
  useEffect(() => {
    if (isVisible) setMounted(true);
  }, [isVisible]);
  const handleSheetClose = useCallback(() => {
    setMounted(false);
    onClose();
  }, [onClose]);

  useEffect(() => {
    if (isVisible) {
      bottomSheetRef.current?.expand();
    } else {
      bottomSheetRef.current?.close();
    }
  }, [isVisible]);

  // Add back button handler for Android
  useEffect(() => {
    if (Platform.OS !== 'android') return;

    const handleBackPress = () => {
      if (isVisible) {
        onClose();
        return true; // Prevent default behavior
      }
      return false; // Let default behavior happen
    };

    const subscription = BackHandler.addEventListener(
      'hardwareBackPress',
      handleBackPress,
    );

    return () => subscription.remove();
  }, [isVisible, onClose]);

  const renderBackdrop = useCallback(
    (props: BottomSheetBackdropProps) => {
      // gorhom's BottomSheetBackdrop mounts with pointerEvents:'auto' (a
      // full-screen, opacity-0-but-hit-testable Tap GestureDetector) and only
      // flips to 'none' via a reanimated useAnimatedReaction -> runOnJS ->
      // setState chain gated on its internal animatedIndex settling to -1. On
      // slow Android CPUs the closed-sheet layout race delays that settle, so
      // the backdrop keeps eating every touch while the sheet is LOGICALLY
      // closed -> the entire host screen goes touch-dead until the next
      // re-render. Gate on the logical `isVisible` prop so the backdrop never
      // renders while closed, immune to gorhom's racing animatedIndex. Same
      // touch-eater fix shipped for the PlayerSheet backdrop in #308.
      if (!isVisible) {
        return null;
      }
      return (
        <BottomSheetBackdrop
          {...props}
          disappearsOnIndex={-1}
          appearsOnIndex={0}
        />
      );
    },
    [isVisible],
  );

  // @ai Sprint 52 Task 7: on a tablet the sheet is a centred card of at most
  // 560 pt (upstream's TabletDialog) in a transparent Modal. The dismiss rules
  // stay those of the sheet: a tap outside, the Android back button and the
  // Modal's own close request all call `onClose`. Every user of this wrapper
  // is dismissable today (pan down, backdrop tap), so this adds no new way out.
  // gorhom is not mounted here, so the phone code above is not touched.
  if (isTablet) {
    return (
      <Modal
        visible={isVisible}
        transparent
        animationType="fade"
        onRequestClose={onClose}
        testID="qariah-tablet-dialog">
        <TabletDialog onClose={onClose}>
          <View
            accessible={false}
            style={[styles(theme).dialogContent, contentContainerStyle]}>
            {children}
          </View>
        </TabletDialog>
      </Modal>
    );
  }

  // @ai TECH_DEBT #267 — after the hooks: a closed sheet that is not in its
  // close animation draws nothing. (On the first open render `mounted` is
  // still false; `isVisible` keeps the sheet in the tree.)
  if (!isVisible && !mounted) {
    return null;
  }

  return (
    <BottomSheet
      ref={bottomSheetRef}
      index={isVisible ? 0 : -1}
      snapPoints={snapPoints}
      backdropComponent={renderBackdrop}
      backgroundStyle={{
        backgroundColor: theme.colors.background,
        borderTopLeftRadius: moderateScale(25),
        borderTopRightRadius: moderateScale(25),
      }}
      enablePanDownToClose={true}
      enableDynamicSizing={false}
      handleComponent={CustomHandle}
      enableContentPanningGesture
      onClose={handleSheetClose}
      // @ai Sprint 50: gorhom makes the whole sheet ONE accessibility element
      // ("Bottom Sheet") by default. VoiceOver, TalkBack and UI tests then
      // cannot reach the buttons in it. Expose the content instead.
      accessible={false}
      // The elevated BottomSheet Body is a SEPARATE sibling from the backdrop
      // above; gorhom drops its touch-interactivity asynchronously too, so on
      // slow CPUs it can still swallow touches while the sheet is logically
      // closed. Gate its pointerEvents on `isVisible` as well — the proven fix
      // is BOTH siblings gated (matches the PlayerSheet guard in #308).
      style={[
        {zIndex: 3000, elevation: 3000},
        !isVisible && {pointerEvents: 'none' as const},
      ]}>
      <View style={[styles(theme).contentContainer, contentContainerStyle]}>
        {children}
      </View>
    </BottomSheet>
  );
};

const styles = (theme: Theme) =>
  ScaledSheet.create({
    contentContainer: {
      flex: 1,
      padding: moderateScale(20),
      backgroundColor: theme.colors.background,
    },
    dialogContent: {
      padding: moderateScale(20),
      backgroundColor: theme.colors.background,
    },
  });

export default QariahBottomSheetModal;
