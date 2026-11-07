import React, {
  useEffect,
  useState,
  useRef,
  useCallback,
  forwardRef,
  useImperativeHandle,
} from 'react';
import {
  View,
  Text,
  StyleSheet,
  Modal,
  Pressable,
  FlatList,
  ViewToken,
  useWindowDimensions,
} from 'react-native';
import {moderateScale} from '@/utils/scale';
import Animated, {
  ZoomIn,
  useSharedValue,
  useAnimatedScrollHandler,
} from 'react-native-reanimated';
import {useTheme} from '@/hooks/useTheme';
import {
  hasVersionChanged,
  markVersionAsSeen,
  getLastSeenVersion,
  filterPagesByVersion,
} from '@/utils/versionUtils';
import branding from '@/config/branding';
import {getOnboardingPages, OnboardingPage} from '@/data/onboardingPages';
import OnboardingPageComponent from './OnboardingPage';
import DotIndicator, {DOT_INDICATOR_HEIGHT} from './DotIndicator';
// @ai-start
import {useTranslation} from 'react-i18next';
import {appLayoutDirection, isRTL} from '@/utils/rtl';
// @ai-end

// Card chrome: the styles and the height budget both read these, so the footer stays in the card.
const CARD_PADDING_TOP = moderateScale(20);
const CARD_PADDING_BOTTOM = moderateScale(12);
const PAGES_MARGIN_TOP = moderateScale(24);
const BUTTON_PADDING_TOP = moderateScale(16);
const BUTTON_PADDING_BOTTOM = moderateScale(4);
const BUTTON_FONT_SIZE = moderateScale(16);
const BUTTON_HEIGHT =
  BUTTON_PADDING_TOP + BUTTON_PADDING_BOTTOM + BUTTON_FONT_SIZE * 1.4;
// Everything in the card that is NOT the pager.
const CARD_CHROME_HEIGHT =
  CARD_PADDING_TOP +
  PAGES_MARGIN_TOP +
  BUTTON_HEIGHT +
  DOT_INDICATOR_HEIGHT +
  CARD_PADDING_BOTTOM;

export interface WhatsNewModalRef {
  show: () => void;
}

// @ai-start
export const WhatsNewModal = forwardRef<WhatsNewModalRef>((_, ref) => {
  const {theme} = useTheme();
  const {t} = useTranslation(['settings', 'common']);
  const [visible, setVisible] = useState(false);
  const [currentPage, setCurrentPage] = useState(0);
  const [pages, setPages] = useState<OnboardingPage[]>(getOnboardingPages());
  const flatListRef = useRef<FlatList<OnboardingPage>>(null);
  const scrollX = useSharedValue(0);

  // Live dimensions, so a rotation or split-view resize does not leave a stale card height.
  const {width: windowWidth, height: windowHeight} = useWindowDimensions();

  const modalWidth = Math.min(
    windowWidth - moderateScale(48),
    moderateScale(420),
  );
  const pageWidth = modalWidth - moderateScale(64); // account for modal padding
  const modalMaxHeight = windowHeight * 0.72;
  // The pager is the only row that shrinks; cap its floor at the space the card can spare.
  const pagesMinHeight = Math.max(
    0,
    Math.min(moderateScale(280), modalMaxHeight - CARD_CHROME_HEIGHT),
  );

  const isLastPage = currentPage === pages.length - 1;

  useImperativeHandle(ref, () => ({
    show: () => {
      setPages(getOnboardingPages());
      setCurrentPage(0);
      scrollX.value = 0;
      flatListRef.current?.scrollToOffset({offset: 0, animated: false});
      setVisible(true);
    },
  }));

  useEffect(() => {
    async function checkAndShow() {
      try {
        // @ai Qariah (TECH_DEBT #390): a patch release can show its update pages too.
        const versionChanged = await hasVersionChanged({
          includePatch: branding.whatsNewOnPatchUpdate === true,
        });
        if (versionChanged) {
          const lastSeen = await getLastSeenVersion();
          const filtered = filterPagesByVersion(getOnboardingPages(), lastSeen);

          if (filtered.length === 0) return;

          setPages(filtered);
          setTimeout(() => {
            setVisible(true);
          }, 800);
        }
      } catch (error) {
        console.error('[WhatsNewOnboarding] Error checking version:', error);
      }
    }

    checkAndShow();
  }, []);

  // Re-anchor on resize: a paged list keeps its pixel contentOffset while the item width changes.
  const currentPageRef = useRef(0);
  useEffect(() => {
    currentPageRef.current = currentPage;
  }, [currentPage]);
  // @ai Pass C: scrollToIndex, not scrollToOffset — in RTL a raw offset counts from the last page.
  useEffect(() => {
    const index = currentPageRef.current;
    if (pages.length > 0) {
      flatListRef.current?.scrollToIndex({index, animated: false});
    }
    scrollX.value = index * pageWidth;
    // eslint-disable-next-line react-hooks/exhaustive-deps -- re-anchor only on resize
  }, [pageWidth, scrollX]);

  function handleClose() {
    setVisible(false);
    markVersionAsSeen();
  }

  function handleNext() {
    if (isLastPage) {
      handleClose();
      return;
    }
    const nextIndex = currentPage + 1;
    flatListRef.current?.scrollToIndex({index: nextIndex, animated: true});
  }

  const onViewableItemsChanged = useRef(
    ({viewableItems}: {viewableItems: ViewToken[]}) => {
      if (viewableItems.length > 0 && viewableItems[0].index !== null) {
        setCurrentPage(viewableItems[0].index);
      }
    },
  ).current;

  const viewabilityConfig = useRef({
    itemVisiblePercentThreshold: 50,
  }).current;

  const scrollHandler = useAnimatedScrollHandler({
    onScroll: event => {
      // A right-to-left scroll view reports its offset from the left edge,
      // where the last page sits. The dots need the distance from page one.
      scrollX.value = isRTL
        ? event.contentSize.width -
          event.layoutMeasurement.width -
          event.contentOffset.x
        : event.contentOffset.x;
    },
  });

  const getItemLayout = useCallback(
    (_: unknown, index: number) => ({
      length: pageWidth,
      offset: pageWidth * index,
      index,
    }),
    [pageWidth],
  );

  const renderItem = useCallback(
    ({item, index}: {item: OnboardingPage; index: number}) => (
      <OnboardingPageComponent
        page={item}
        width={pageWidth}
        isIntroPage={item.id === 'welcome'}
      />
    ),
    [pageWidth],
  );

  const keyExtractor = useCallback((item: OnboardingPage) => item.id, []);

  return (
    <Modal
      visible={visible}
      transparent
      animationType="fade"
      onRequestClose={handleClose}>
      <View style={styles.overlay}>
        <View style={styles.backdrop} />

        <Animated.View
          entering={ZoomIn.duration(300).springify()}
          style={[
            styles.modalContainer,
            {
              backgroundColor: theme.colors.backgroundSecondary,
              width: modalWidth,
              maxHeight: modalMaxHeight,
            },
          ]}>
          {/* Skip button */}
          <Pressable
            style={styles.skipButton}
            onPress={handleClose}
            hitSlop={12}>
            <Text
              style={[styles.skipText, {color: theme.colors.textSecondary}]}>
              {t('onboarding.skip')}
            </Text>
          </Pressable>

          {/* Pages — the only shrinkable row, so the footer stays in the card. */}
          <View style={[styles.pagesContainer, {minHeight: pagesMinHeight}]}>
            {/* Runs in the app's direction: the list's index math follows
                the native direction, so forcing LTR here breaks Next in RTL. */}
            <Animated.FlatList
              ref={flatListRef as any}
              style={appLayoutDirection}
              data={pages}
              renderItem={renderItem}
              keyExtractor={keyExtractor}
              horizontal
              pagingEnabled
              snapToInterval={pageWidth}
              decelerationRate="fast"
              showsHorizontalScrollIndicator={false}
              onScroll={scrollHandler}
              scrollEventThrottle={16}
              onViewableItemsChanged={onViewableItemsChanged}
              viewabilityConfig={viewabilityConfig}
              getItemLayout={getItemLayout}
              bounces={false}
            />
          </View>

          {/* Next / Get Started button */}
          <Pressable
            style={({pressed}) => [
              styles.button,
              pressed && styles.buttonPressed,
            ]}
            onPress={handleNext}
            accessibilityRole="button"
            accessibilityLabel={
              isLastPage ? t('onboarding.getStarted') : t('common:actions.next')
            }>
            <Text
              style={[styles.buttonText, {color: theme.colors.textSecondary}]}>
              {isLastPage
                ? t('onboarding.getStarted')
                : t('common:actions.next')}
            </Text>
          </Pressable>

          {/* Dot indicator */}
          <DotIndicator
            totalPages={pages.length}
            scrollX={scrollX}
            pageWidth={pageWidth}
          />
        </Animated.View>
      </View>
    </Modal>
  );
});
// @ai-end

WhatsNewModal.displayName = 'WhatsNewModal';

const styles = StyleSheet.create({
  overlay: {
    flex: 1,
    backgroundColor: 'rgba(0, 0, 0, 0.6)',
    justifyContent: 'center',
    alignItems: 'center',
  },
  backdrop: {
    ...StyleSheet.absoluteFill,
  },
  modalContainer: {
    borderRadius: moderateScale(24),
    paddingTop: CARD_PADDING_TOP,
    paddingBottom: CARD_PADDING_BOTTOM,
    paddingHorizontal: moderateScale(32),
    overflow: 'hidden',
    shadowColor: '#000',
    shadowOffset: {width: 0, height: 8},
    shadowOpacity: 0.3,
    shadowRadius: 16,
    elevation: 24,
  },
  skipButton: {
    position: 'absolute',
    top: moderateScale(16),
    right: moderateScale(20),
    zIndex: 10,
    padding: moderateScale(4),
  },
  skipText: {
    fontSize: moderateScale(14),
    fontFamily: 'Manrope-SemiBold',
  },
  pagesContainer: {
    marginTop: PAGES_MARGIN_TOP,
    // The only shrinkable row: the inline `minHeight` is its floor.
    flexShrink: 1,
    overflow: 'hidden',
    justifyContent: 'center',
  },
  button: {
    paddingTop: BUTTON_PADDING_TOP,
    paddingBottom: BUTTON_PADDING_BOTTOM,
    alignItems: 'center',
  },
  buttonPressed: {
    opacity: 0.8,
  },
  buttonText: {
    fontSize: BUTTON_FONT_SIZE,
    fontFamily: 'Manrope-SemiBold',
  },
});
