// Navigation adapted from the S23 menu anatomy, limited to routes this prototype actually has.
import { router, usePathname, type Href } from 'expo-router';
import { useState } from 'react';
import { Modal, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { useApp } from './AppContext';
import { Icon, type IconName } from './components';
import { colors, radius, SIDEBAR_WIDTH } from './theme';

export interface NavItem {
  key: string;
  label: string;
  href: Href;
  icon: IconName;
  /** Pathnames that count as this item being active. */
  match: string[];
  group?: 'belajar';
  section: 0 | 1 | 2;
}

const ITEMS: NavItem[] = [
  { key: 'home', label: 'Sesi hari ini', href: '/', icon: 'book', match: ['/'], group: 'belajar', section: 0 },
  { key: 'guide', label: 'Panduan', href: '/guide' as Href, icon: 'document-text', match: ['/guide'], group: 'belajar', section: 0 },
  { key: 'practice', label: 'Latihan', href: '/session', icon: 'help-circle', match: ['/session'], group: 'belajar', section: 0 },
  { key: 'summary', label: 'Ringkasan', href: '/summary', icon: 'stats-chart', match: ['/summary'], section: 0 },
  { key: 'progress', label: 'Kemajuan', href: '/progress' as Href, icon: 'analytics', match: ['/progress'], section: 0 },
  { key: 'settings', label: 'Pengaturan', href: '/settings', icon: 'settings-sharp', match: ['/settings'], section: 1 },
  { key: 'dev', label: 'Data pengembang', href: '/dev', icon: 'code-slash', match: ['/dev'], section: 2 },
];

/**
 * Learner navigation exists only after consent + setup (a learner exists) and only when
 * there is showable content. Developer data is developer-demo only.
 */
export function useNavItems(): NavItem[] {
  const { learner, content, rules } = useApp();
  if (!learner || content.empty) return [];
  return ITEMS.filter((i) => i.key !== 'dev' || rules.mode === 'developer-demo');
}

function isActive(item: NavItem, pathname: string) {
  return item.match.includes(pathname);
}

function Brand() {
  return (
    <View style={styles.brand}>
      <Icon name="book" size={24} color={colors.indigoText} />
      <Text style={styles.brandText}>Arabic Trial</Text>
    </View>
  );
}

function NavList({ items, onChoose }: { items: NavItem[]; onChoose: (item: NavItem) => void }) {
  const pathname = usePathname();
  const learn = items.filter((i) => i.group === 'belajar');
  const rest = items.filter((i) => !i.group);
  const row = (item: NavItem, child: boolean) => {
    const active = isActive(item, pathname);
    return (
      <Pressable
        key={item.key}
        testID={`nav-${item.key}`}
        accessibilityRole="link"
        accessibilityState={{ selected: active }}
        accessibilityLabel={item.label}
        onPress={() => onChoose(item)}
        style={({ pressed }) => [styles.row, child && styles.rowChild, active && styles.rowActive, pressed && !active && styles.rowPressed]}
      >
        <Icon name={item.icon} size={child ? 18 : 20} color={colors.indigoText} />
        <Text style={[styles.rowText, active && styles.rowTextActive]}>{item.label}</Text>
      </Pressable>
    );
  };
  return (
    <View style={styles.list}>
      {learn.length ? (
        <View style={styles.groupHead} accessibilityRole="header">
          <Icon name="school" size={20} color={colors.indigoText} />
          <Text style={styles.groupText}>Belajar</Text>
        </View>
      ) : null}
      {learn.map((i) => row(i, true))}
      {rest.map((i, n) => (
        <View key={i.key}>
          {n > 0 && rest[n - 1].section !== i.section ? <View style={styles.divider} /> : null}
          {row(i, false)}
        </View>
      ))}
    </View>
  );
}

function modeLine(mode: 'developer-demo' | 'tester') {
  return mode === 'tester' ? 'Prototipe · mode penguji' : 'Prototipe pengembang';
}

/** Desktop: ~232 px cream rail (S23). */
export function Sidebar() {
  const items = useNavItems();
  const { rules } = useApp();
  return (
    <View style={styles.sidebar} accessibilityRole="menu" testID="sidebar">
      <ScrollView contentContainerStyle={{ padding: 16, gap: 12 }}>
        <Brand />
        <NavList items={items} onChoose={(i) => router.navigate(i.href)} />
      </ScrollView>
      <Text style={styles.sidebarFoot}>{modeLine(rules.mode)}</Text>
    </View>
  );
}

/** Phone/tablet: compact header with an accessible drawer. */
export function MobileHeader() {
  const items = useNavItems();
  const { rules } = useApp();
  const [open, setOpen] = useState(false);
  const insets = useSafeAreaInsets();
  return (
    <View style={styles.header}>
      {items.length ? (
        <Pressable
          testID="menu-open"
          accessibilityRole="button"
          accessibilityLabel="Buka menu"
          accessibilityState={{ expanded: open }}
          onPress={() => setOpen(true)}
          style={styles.iconBtn}
        >
          <Icon name="menu" size={26} color={colors.ink} />
        </Pressable>
      ) : null}
      <Brand />
      <Modal visible={open} transparent animationType="fade" onRequestClose={() => setOpen(false)}>
        <View style={styles.drawerWrap}>
          <View
            style={[styles.drawer, { paddingTop: insets.top + 8, paddingBottom: insets.bottom + 8 }]}
            accessibilityViewIsModal
            testID="drawer"
          >
            <View style={styles.drawerHead}>
              <Brand />
              <Pressable
                testID="menu-close"
                accessibilityRole="button"
                accessibilityLabel="Tutup menu"
                onPress={() => setOpen(false)}
                style={styles.iconBtn}
              >
                <Icon name="close" size={24} color={colors.ink} />
              </Pressable>
            </View>
            <ScrollView contentContainerStyle={{ paddingHorizontal: 12, paddingBottom: 12 }}>
              <NavList
                items={items}
                onChoose={(i) => {
                  setOpen(false);
                  router.navigate(i.href);
                }}
              />
            </ScrollView>
            <Text style={styles.sidebarFoot}>{modeLine(rules.mode)}</Text>
          </View>
          <Pressable
            style={styles.backdrop}
            accessibilityRole="button"
            accessibilityLabel="Tutup menu"
            onPress={() => setOpen(false)}
          />
        </View>
      </Modal>
    </View>
  );
}

const styles = StyleSheet.create({
  brand: { flexDirection: 'row', alignItems: 'center', gap: 10, paddingVertical: 4, flexShrink: 1 },
  brandText: { fontSize: 20, fontWeight: '800', color: colors.ink, letterSpacing: -0.2, writingDirection: 'ltr', textAlign: 'left' },
  list: { gap: 2 },
  groupHead: { flexDirection: 'row', alignItems: 'center', gap: 12, paddingHorizontal: 8, paddingVertical: 10 },
  groupText: { fontSize: 16, fontWeight: '700', color: colors.ink, writingDirection: 'ltr', textAlign: 'left' },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    minHeight: 44,
    paddingHorizontal: 8,
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: 'transparent',
  },
  rowChild: { paddingLeft: 22 },
  rowActive: { backgroundColor: colors.indigoSoft, borderColor: '#D6D7EA' },
  rowPressed: { backgroundColor: colors.surface },
  rowText: { fontSize: 16, fontWeight: '600', color: colors.ink, flexShrink: 1, writingDirection: 'ltr', textAlign: 'left' },
  rowTextActive: { color: colors.indigoText, fontWeight: '700' },
  divider: { height: 1, backgroundColor: colors.border, marginVertical: 8, marginHorizontal: 4 },
  sidebar: {
    width: SIDEBAR_WIDTH,
    backgroundColor: colors.paper,
    borderRightWidth: 1,
    borderRightColor: colors.border,
  },
  sidebarFoot: { fontSize: 12, color: colors.muted, paddingHorizontal: 16, paddingVertical: 12, writingDirection: 'ltr', textAlign: 'left' },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    minHeight: 56,
    paddingHorizontal: 8,
    backgroundColor: colors.paper,
    borderBottomWidth: 1,
    borderBottomColor: colors.border,
  },
  iconBtn: { width: 44, height: 44, alignItems: 'center', justifyContent: 'center', borderRadius: radius.md },
  drawerWrap: { flex: 1, flexDirection: 'row' },
  drawer: {
    width: 284,
    maxWidth: '84%',
    backgroundColor: colors.paper,
    borderRightWidth: 1,
    borderRightColor: colors.border,
  },
  drawerHead: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: 12, paddingBottom: 8 },
  backdrop: { flex: 1, backgroundColor: colors.backdrop },
});
