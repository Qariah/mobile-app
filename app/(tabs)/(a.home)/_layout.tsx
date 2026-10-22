import {Stack} from 'expo-router';
// @ai-start
import {useTranslation} from 'react-i18next';
// @ai-end
import {USE_GLASS} from '@/hooks/useGlassProps';
import {MaxWidthContainer} from '@/components/layout/MaxWidthContainer';

// A deep link (widget, Live Activity, App Link) that opens a screen in this
// stack lands on top of its first screen, so back always has a target.
export const unstable_settings = {initialRouteName: 'index'};

// @ai-start
export default function HomeLayout() {
  const {t} = useTranslation('home');
  return (
    <MaxWidthContainer>
      <Stack
        screenOptions={{
          headerShown: true,
          freezeOnBlur: true,
          headerTransparent: true,
          headerShadowVisible: false,
        }}>
        <Stack.Screen
          name="index"
          options={{
            title: '',
          }}
        />
        <Stack.Screen
          name="reciter/[id]"
          options={{
            title: '',
            // Non-glass devices use custom NavigationButtons; hide native header to avoid clash
            headerShown: USE_GLASS,
          }}
        />
        <Stack.Screen
          name="reciter/browse"
          options={{
            // Non-glass devices use custom Header component inside BrowseReciters
            headerShown: USE_GLASS,
          }}
        />
        <Stack.Screen name="playlist/[id]" options={{title: ''}} />
        <Stack.Screen name="adhkar" options={{headerShown: false}} />
        <Stack.Screen
          name="translations"
          options={{title: t('translations.title')}}
        />
        <Stack.Screen
          name="browse-all"
          options={{
            title: t('browse.browseAll'),
            // Non-glass devices use custom Header component; hide native header to avoid clash
            headerShown: USE_GLASS,
          }}
        />
        <Stack.Screen
          name="browse-all-surahs"
          options={{
            // Sprint 14 — `BrowseSurahs` renders its own custom Header
            // (and on iOS-glass also drives the native header title via
            // `navigation.setOptions`). Without this entry the native
            // header inherited the route filename ("browse-all-surahs")
            // AND ran alongside the custom Header — visible as the
            // duplicate title + double back button bug.
            title: t('browse.allSurahs'),
            headerShown: USE_GLASS,
          }}
        />
      </Stack>
    </MaxWidthContainer>
  );
}
// @ai-end
