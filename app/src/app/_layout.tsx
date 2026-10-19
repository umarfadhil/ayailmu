import Ionicons from '@expo/vector-icons/Ionicons';
import { NotoNaskhArabic_400Regular } from '@expo-google-fonts/noto-naskh-arabic/400Regular';
import { NotoNaskhArabic_500Medium } from '@expo-google-fonts/noto-naskh-arabic/500Medium';
import { PlusJakartaSans_400Regular } from '@expo-google-fonts/plus-jakarta-sans/400Regular';
import { PlusJakartaSans_500Medium } from '@expo-google-fonts/plus-jakarta-sans/500Medium';
import { PlusJakartaSans_600SemiBold } from '@expo-google-fonts/plus-jakarta-sans/600SemiBold';
import { PlusJakartaSans_700Bold } from '@expo-google-fonts/plus-jakarta-sans/700Bold';
import { PlusJakartaSans_800ExtraBold } from '@expo-google-fonts/plus-jakarta-sans/800ExtraBold';
import { useFonts } from 'expo-font';
import { DefaultTheme, Stack, ThemeProvider, usePathname } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import { useEffect } from 'react';
import { Platform, StyleSheet, View } from 'react-native';
import { SafeAreaProvider, SafeAreaView } from 'react-native-safe-area-context';

import { AccountProvider } from '@/ui/AccountContext';
import { AppProvider } from '@/ui/AppContext';
import { useIsDesktop } from '@/ui/components';
import { isTabRoute, SideRail, TabBar, useLearnerNav } from '@/ui/Nav';
import { colors } from '@/ui/theme';

const navTheme = {
  ...DefaultTheme,
  colors: { ...DefaultTheme.colors, background: colors.ground, card: colors.sheet2, border: colors.line },
};

/**
 * The Stack's parent chain is identical on phone and desktop: the tab bar and the desktop rail only
 * fill fixed sibling slots, so crossing the breakpoint never remounts the active route (unsent answers
 * and selections survive a resize). Sessions and summaries run full screen at every width.
 */
function Shell() {
  const desktop = useIsDesktop();
  const pathname = usePathname();
  const tabs = useLearnerNav() && isTabRoute(pathname);

  return (
    <SafeAreaView style={styles.root} edges={['top', 'left', 'right']}>
      <ThemeProvider value={navTheme}>
        <View style={styles.row}>
          {desktop && tabs ? <SideRail /> : null}
          <View style={styles.main}>
            <Stack screenOptions={{ headerShown: false, animation: 'none', contentStyle: { backgroundColor: colors.ground } }} />
            {!desktop && tabs ? <TabBar /> : null}
          </View>
        </View>
      </ThemeProvider>
      <StatusBar style="dark" />
    </SafeAreaView>
  );
}

export default function RootLayout() {
  // UI-02: the interface language is Indonesian; Arabic runs carry lang="ar" themselves.
  useEffect(() => {
    if (Platform.OS === 'web' && typeof document !== 'undefined') document.documentElement.lang = 'id';
  }, []);
  // Bundled faces (no network): Plus Jakarta Sans for the Indonesian UI, Noto Naskh Arabic for Arabic.
  // If loading fails the app still renders, in the system fonts.
  const [loaded, error] = useFonts({
    PlusJakartaSans_400Regular,
    PlusJakartaSans_500Medium,
    PlusJakartaSans_600SemiBold,
    PlusJakartaSans_700Bold,
    PlusJakartaSans_800ExtraBold,
    NotoNaskhArabic_400Regular,
    NotoNaskhArabic_500Medium,
    ...Ionicons.font,
  });
  if (!loaded && !error) return null;
  return (
    <SafeAreaProvider>
      <AppProvider>
        <AccountProvider>
          <Shell />
        </AccountProvider>
      </AppProvider>
    </SafeAreaProvider>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.ground },
  row: { flex: 1, flexDirection: 'row' },
  main: { flex: 1 },
});
