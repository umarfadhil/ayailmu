import Ionicons from '@expo/vector-icons/Ionicons';
import { NotoNaskhArabic_400Regular } from '@expo-google-fonts/noto-naskh-arabic/400Regular';
import { useFonts } from 'expo-font';
import { DefaultTheme, Stack, ThemeProvider } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import { useEffect } from 'react';
import { Platform, StyleSheet, View } from 'react-native';
import { SafeAreaProvider, SafeAreaView } from 'react-native-safe-area-context';

import { AppProvider, useApp } from '@/ui/AppContext';
import { Canvas, DraftNotice, useIsDesktop } from '@/ui/components';
import { MobileHeader, Sidebar, useNavItems } from '@/ui/Nav';
import { colors } from '@/ui/theme';

const navTheme = {
  ...DefaultTheme,
  colors: { ...DefaultTheme.colors, background: colors.canvasPaper, card: colors.paper, border: colors.border },
};

/**
 * The Stack's parent chain is identical on phone and desktop: responsive chrome only fills
 * fixed sibling slots or changes styles, so crossing the breakpoint never remounts the active
 * route (unsent answers and selections survive a resize).
 */
function Shell() {
  const { rules, content } = useApp();
  const desktop = useIsDesktop();
  const hasNav = useNavItems().length > 0;

  return (
    <SafeAreaView style={styles.root} edges={['top', 'left', 'right']}>
      <ThemeProvider value={navTheme}>
        <View style={styles.row}>
          {desktop && hasNav ? <Sidebar /> : null}
          <View style={styles.main}>
            {desktop ? <Canvas /> : null}
            {desktop ? null : <MobileHeader />}
            <View style={desktop ? styles.bannerWrap : null}>
              <View style={desktop ? styles.bannerInner : null}>
                <DraftNotice mode={rules.mode} unreviewed={content.unreviewed} variant={desktop ? 'banner' : 'strip'} />
              </View>
            </View>
            <Stack screenOptions={{ headerShown: false, contentStyle: { backgroundColor: colors.canvasPaper } }} />
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
  // Bundled fonts (no network). Falls back to system fonts if loading fails.
  const [loaded, error] = useFonts({ NotoNaskhArabic_400Regular, ...Ionicons.font });
  if (!loaded && !error) return null;
  return (
    <SafeAreaProvider>
      <AppProvider>
        <Shell />
      </AppProvider>
    </SafeAreaProvider>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.paper },
  row: { flex: 1, flexDirection: 'row' },
  main: { flex: 1 },
  bannerWrap: { paddingHorizontal: 40, paddingTop: 20 },
  bannerInner: { width: '100%', maxWidth: 980, alignSelf: 'center' },
});
