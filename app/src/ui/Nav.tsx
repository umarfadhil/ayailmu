// Learner navigation (Calm Paper): three destinations, Belajar · Panduan · Kemajuan. A session and its
// summary run full screen; Pengaturan is reached separately (the Home header, or the desktop rail).
import { router, usePathname, type Href } from 'expo-router';
import { Pressable, StyleSheet, Text, View } from 'react-native';

import { learningBetaEnabled } from '@/config/learningBeta';
import { useApp } from './AppContext';
import { Icon, ModeNote, useInsets, Wordmark, type IconName } from './components';
import { colors, fonts, radius, SIDEBAR_WIDTH } from './theme';

interface Tab {
  key: 'learn' | 'guide' | 'progress';
  label: string;
  href: Href;
  icon: IconName;
  iconActive: IconName;
}

const TABS: Tab[] = [
  { key: 'learn', label: 'Belajar', href: '/', icon: 'book-outline', iconActive: 'book' },
  { key: 'guide', label: 'Panduan', href: '/guide' as Href, icon: 'document-text-outline', iconActive: 'document-text' },
  { key: 'progress', label: 'Kemajuan', href: '/progress' as Href, icon: 'analytics-outline', iconActive: 'analytics' },
];

const TAB_PATHS: Record<Tab['key'], string> = { learn: '/', guide: '/guide', progress: '/progress' };

/** Pathnames that show the learner navigation; every other route runs without it. */
export function isTabRoute(pathname: string) {
  return Object.values(TAB_PATHS).includes(pathname);
}

/**
 * Navigation exists only after consent and the basic profile (a learner exists) and only with showable content. A
 * validated learning beta has none: its tabs lead to routes that redirect Home, so it never shows dead tabs.
 */
export function useLearnerNav(): boolean {
  const { learner, content } = useApp();
  return !!learner && !content.empty && !learningBetaEnabled();
}

/** To a tab: back to it when it is already in the history, otherwise in place of the current tab. */
function openTab(tab: Tab) {
  router.dismissTo(tab.href);
}

function TabItem({ tab, active, rail }: { tab: Tab; active: boolean; rail?: boolean }) {
  return (
    <Pressable
      testID={`tab-${tab.key}`}
      accessibilityRole="tab"
      // The selected tab, for native (accessibilityState) and the web (react-native-web reads aria-* props only).
      accessibilityState={{ selected: active }}
      aria-selected={active}
      onPress={() => (active ? undefined : openTab(tab))}
      style={({ pressed }) => [rail ? styles.railItem : styles.tab, rail && active && styles.railItemActive, pressed && !active && styles.pressed]}
    >
      <View style={[styles.pill, active && styles.pillActive, rail && styles.railPill]}>
        <Icon name={active ? tab.iconActive : tab.icon} size={22} color={active ? colors.accentInk : colors.chipInk} />
      </View>
      <Text style={[rail ? styles.railLabel : styles.tabLabel, active && styles.labelActive]}>{tab.label}</Text>
    </Pressable>
  );
}

/** Phone and tablet: the bottom tab bar. Labels stay (they may wrap at large text, never icon-only). */
export function TabBar() {
  const pathname = usePathname();
  const insets = useInsets();
  return (
    <View accessibilityRole="tablist" style={[styles.tabBar, { paddingBottom: 6 + Math.max(insets.bottom, 12) }]}>
      {TABS.map((tab) => (
        <TabItem key={tab.key} tab={tab} active={TAB_PATHS[tab.key] === pathname} />
      ))}
    </View>
  );
}

/** Desktop: a quiet rail with the same three destinations, then Pengaturan apart from them. */
export function SideRail() {
  const pathname = usePathname();
  return (
    <View style={styles.rail} testID="sidebar">
      <View style={styles.brand}>
        <Wordmark />
      </View>
      <View accessibilityRole="tablist" style={styles.railList}>
        {TABS.map((tab) => (
          <TabItem key={tab.key} tab={tab} active={TAB_PATHS[tab.key] === pathname} rail />
        ))}
      </View>
      <View style={styles.divider} />
      <Pressable
        testID="rail-settings"
        accessibilityRole="link"
        onPress={() => router.push('/settings')}
        style={({ pressed }) => [styles.railItem, pressed && styles.pressed]}
      >
        <View style={[styles.pill, styles.railPill]}>
          <Icon name="options-outline" size={22} color={colors.chipInk} />
        </View>
        <Text style={styles.railLabel}>Pengaturan</Text>
      </Pressable>
      <View style={styles.railFoot}>
        <ModeNote align="left" />
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  tabBar: {
    flexDirection: 'row',
    paddingTop: 8,
    paddingHorizontal: 8,
    backgroundColor: colors.sheet2,
    borderTopWidth: 1,
    borderTopColor: colors.line,
  },
  tab: { flex: 1, minHeight: 56, alignItems: 'center', justifyContent: 'center', gap: 4, borderRadius: radius.sm, paddingHorizontal: 2 },
  pressed: { backgroundColor: colors.chipBg },
  pill: {
    width: 60,
    height: 30,
    borderRadius: radius.pill,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 2,
    borderColor: 'transparent',
  },
  pillActive: { backgroundColor: colors.accentSoft, borderColor: colors.accent },
  tabLabel: { fontFamily: fonts.semibold, fontSize: 12, lineHeight: 16, color: colors.chipInk, textAlign: 'center' },
  labelActive: { fontFamily: fonts.extrabold, color: colors.accentInk },

  rail: {
    width: SIDEBAR_WIDTH,
    paddingHorizontal: 16,
    paddingVertical: 20,
    gap: 6,
    backgroundColor: colors.sheet2,
    borderRightWidth: 1,
    borderRightColor: colors.line,
  },
  brand: { paddingHorizontal: 8, paddingBottom: 14 },
  railList: { gap: 4 },
  railItem: { flexDirection: 'row', alignItems: 'center', gap: 10, minHeight: 52, paddingHorizontal: 8, borderRadius: radius.md },
  railItemActive: { backgroundColor: colors.accentSoft },
  railPill: { width: 44 },
  railLabel: { fontFamily: fonts.semibold, fontSize: 16, lineHeight: 22, color: colors.ink, flexShrink: 1 },
  divider: { height: 1, backgroundColor: colors.line, marginVertical: 10, marginHorizontal: 8 },
  railFoot: { marginTop: 'auto', paddingHorizontal: 8 },
});
