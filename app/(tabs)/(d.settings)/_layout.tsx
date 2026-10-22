import {Stack, router} from 'expo-router';
import {Pressable} from 'react-native';
import {Feather} from '@expo/vector-icons';
import {moderateScale} from 'react-native-size-matters';
import {useTheme} from '@/hooks/useTheme';
import {USE_GLASS} from '@/hooks/useGlassProps';
import {MaxWidthContainer} from '@/components/layout/MaxWidthContainer';
import branding from '@/config/branding';
// @ai-start
import {useTranslation} from 'react-i18next';
import {flipX} from '@/utils/rtl';
// @ai-end

// A deep link (widget, Live Activity, App Link) that opens a screen in this
// stack lands on top of its first screen, so back always has a target.
export const unstable_settings = {initialRouteName: 'index'};

// @ai-start
export default function SettingsLayout() {
  const {theme} = useTheme();
  const {t} = useTranslation(['settings', 'common', 'qariah']);

  // Qariah divergence — use the bolder Feather `arrow-left` glyph (matching
  // the Collection sub-screens' fixed-back-button affordance) instead of the
  // thin iOS system chevron the default Stack header would draw. Upstreaming
  // would require a `branding.headerBackIcon` config seam, which is heavier
  // than the one-line styling change is worth. The arrow mirrors in RTL
  // (`flipX`) and its label is localized.
  const headerLeft = () =>
    router.canGoBack() ? (
      <Pressable
        onPress={() => router.back()}
        hitSlop={12}
        accessibilityRole="button"
        accessibilityLabel={t('common:actions.back')}>
        <Feather
          name="arrow-left"
          size={moderateScale(22)}
          color={theme.colors.text}
          style={flipX}
        />
      </Pressable>
    ) : null;

  return (
    <MaxWidthContainer>
      <Stack
        screenOptions={{
          headerShown: true,
          freezeOnBlur: true,
          headerTintColor: theme.colors.text,
          ...(USE_GLASS
            ? {
                headerTransparent: true,
                headerStyle: {backgroundColor: 'transparent'},
              }
            : {
                headerStyle: {backgroundColor: theme.colors.background},
              }),
          headerTitleStyle: {
            fontFamily: 'Manrope-SemiBold',
            color: theme.colors.text,
          },
          headerShadowVisible: false,
          headerBackButtonDisplayMode: 'minimal',
          headerLeft,
        }}>
        <Stack.Screen name="index" options={{headerShown: false}} />
        <Stack.Screen name="storage" options={{title: t('layout.storage')}} />
        <Stack.Screen
          name="about"
          options={{title: t('layout.about', {appName: branding.appName})}}
        />
        <Stack.Screen name="credits" options={{title: t('layout.credits')}} />
        <Stack.Screen
          name="mushaf-settings"
          options={{title: t('layout.mushafSettings')}}
        />
        <Stack.Screen
          name="default-reciter"
          options={{title: t('layout.defaultReciter')}}
        />
        <Stack.Screen
          name="reciter-choice"
          options={{title: t('layout.reciterChoice')}}
        />
        {/* Sprint 27 — upstream-introduced `account` route doesn't exist in
         * Qariah (we expose sign-in + your-data directly under settings).
         * Drop the Stack.Screen entry to silence the dev WARN. */}
        <Stack.Screen
          name="translations"
          options={{title: t('layout.translations')}}
        />
        <Stack.Screen
          name="reading-theme"
          options={{title: t('layout.readingTheme')}}
        />
        <Stack.Screen
          name="whats-new"
          options={{title: t('layout.whatsNew')}}
        />
        <Stack.Screen
          name="language"
          options={{title: t('common:language.title')}}
        />
        {/* @ai Qariah-only routes (sign-in, Your Data, Notifications). */}
        <Stack.Screen
          name="sign-in"
          options={{title: t('qariah:settings.screens.signIn')}}
        />
        <Stack.Screen
          name="data"
          options={{title: t('qariah:settings.screens.yourData')}}
        />
        <Stack.Screen
          name="notifications"
          options={{title: t('qariah:settings.screens.notifications')}}
        />
      </Stack>
    </MaxWidthContainer>
  );
}
// @ai-end
