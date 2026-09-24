import {Stack, router} from 'expo-router';
import {Pressable} from 'react-native';
import {Feather} from '@expo/vector-icons';
import {moderateScale} from 'react-native-size-matters';
import {useTheme} from '@/hooks/useTheme';
import {USE_GLASS} from '@/hooks/useGlassProps';
import {MaxWidthContainer} from '@/components/layout/MaxWidthContainer';
import branding from '@/config/branding';

export default function SettingsLayout() {
  const {theme} = useTheme();

  // Qariah divergence — use the bolder Feather `arrow-left` glyph (matching
  // the Collection sub-screens' fixed-back-button affordance) instead of the
  // thin iOS system chevron the default Stack header would draw. Upstreaming
  // would require a `branding.headerBackIcon` config seam, which is heavier
  // than the one-line styling change is worth.
  const headerLeft = () =>
    router.canGoBack() ? (
      <Pressable
        onPress={() => router.back()}
        hitSlop={12}
        accessibilityRole="button"
        accessibilityLabel="Back">
        <Feather
          name="arrow-left"
          size={moderateScale(22)}
          color={theme.colors.text}
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
        <Stack.Screen name="storage" options={{title: 'Storage'}} />
        <Stack.Screen
          name="about"
          options={{title: `About ${branding.appName}`}}
        />
        <Stack.Screen name="credits" options={{title: 'Credits'}} />
        <Stack.Screen
          name="mushaf-settings"
          options={{title: 'Mushaf Settings'}}
        />
        <Stack.Screen
          name="default-reciter"
          options={{title: 'Default Reciter'}}
        />
        <Stack.Screen
          name="reciter-choice"
          options={{title: 'Reciter Choice'}}
        />
        {/* Sprint 27 — upstream-introduced `account` route doesn't exist in
         * Qariah (we expose sign-in + your-data directly under settings).
         * Drop the Stack.Screen entry to silence the dev WARN. */}
        <Stack.Screen
          name="translations"
          options={{title: 'Translations & Tafaseer'}}
        />
        <Stack.Screen name="reading-theme" options={{title: 'Reading Theme'}} />
        <Stack.Screen name="whats-new" options={{title: "What's New"}} />
        <Stack.Screen name="sign-in" options={{title: 'Sign in'}} />
        <Stack.Screen name="data" options={{title: 'Your Data'}} />
      </Stack>
    </MaxWidthContainer>
  );
}
