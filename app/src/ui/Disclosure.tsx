import { useState, type ReactNode } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';

import { Icon, type IconName } from './components';
import { colors, fonts, radius } from './theme';

function RowContent({ title, summary, icon, chevron }: { title: string; summary?: string; icon?: IconName; chevron: IconName }) {
  return (
    <>
      {icon ? (
        <View style={styles.icon}>
          <Icon name={icon} color={colors.accentInk} />
        </View>
      ) : null}
      <View style={styles.label}>
        <Text style={styles.title}>{title}</Text>
        {summary ? <Text style={styles.summary}>{summary}</Text> : null}
      </View>
      <Icon name={chevron} size={20} color={colors.muted} />
    </>
  );
}

/**
 * Optional detail (e.g. «Rincian latihan»). The toggle is a button whose expanded state is stated
 * explicitly for web (aria-expanded) and native (accessibilityState); closing removes the content from
 * focus and reading order.
 */
export function Disclosure({ title, summary, icon, children, testID, open, onToggle }: {
  title: string; summary?: string; icon?: IconName; children: ReactNode; testID: string;
  open?: boolean; onToggle?: () => void;
}) {
  const [localOpen, setOpen] = useState(false);
  const expanded = open ?? localOpen;
  return (
    <View style={styles.container}>
      <Pressable
        testID={testID}
        accessibilityRole="button"
        accessibilityState={{ expanded }}
        aria-expanded={expanded}
        onPress={onToggle ?? (() => setOpen((value) => !value))}
        style={({ pressed }) => [styles.row, pressed && styles.pressed]}
      >
        <RowContent title={title} summary={summary} icon={icon} chevron={expanded ? 'chevron-up' : 'chevron-down'} />
      </Pressable>
      {expanded ? <View style={styles.content}>{children}</View> : null}
    </View>
  );
}

export function ActionRow({ title, icon, onPress, testID }: { title: string; icon: IconName; onPress: () => void; testID?: string }) {
  return (
    <Pressable
      testID={testID}
      accessibilityRole="link"
      onPress={onPress}
      style={({ pressed }) => [styles.container, styles.row, pressed && styles.pressed]}
    >
      <RowContent title={title} icon={icon} chevron="chevron-forward" />
    </Pressable>
  );
}

const styles = StyleSheet.create({
  container: { backgroundColor: colors.sheet, borderWidth: 1, borderColor: colors.line, borderRadius: 18 },
  row: { minHeight: 60, paddingHorizontal: 16, paddingVertical: 10, flexDirection: 'row', alignItems: 'center', gap: 12, borderRadius: 18 },
  pressed: { backgroundColor: colors.sheet2 },
  icon: { width: 40, height: 40, borderRadius: radius.sm, backgroundColor: colors.accentSoft, alignItems: 'center', justifyContent: 'center' },
  label: { flex: 1, gap: 2 },
  title: { fontFamily: fonts.extrabold, fontSize: 15, lineHeight: 22, color: colors.ink, writingDirection: 'ltr', textAlign: 'left' },
  summary: { fontFamily: fonts.regular, fontSize: 13, lineHeight: 18, color: colors.muted, writingDirection: 'ltr', textAlign: 'left' },
  content: { paddingHorizontal: 16, paddingBottom: 16, gap: 10 },
});
