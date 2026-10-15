import Ionicons from '@expo/vector-icons/Ionicons';
import { LinearGradient } from 'expo-linear-gradient';
import { useState, type ComponentProps, type ReactNode } from 'react';
import {
  Modal,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
  useWindowDimensions,
  type StyleProp,
  type TextStyle,
  type ViewStyle,
} from 'react-native';

import type { HelpLine } from '@/content/schema';
import { colors, DESKTOP_MIN_WIDTH, radius, shadow } from './theme';

export const ARABIC_FONT = 'NotoNaskhArabic_400Regular';

export type IconName = ComponentProps<typeof Ionicons>['name'];

/** One icon family (Ionicons) across the app. */
export function Icon({ name, size = 20, color = colors.indigoText }: { name: IconName; size?: number; color?: string }) {
  return <Ionicons name={name} size={size} color={color} accessibilityElementsHidden importantForAccessibility="no" />;
}

export function useIsDesktop() {
  return useWindowDimensions().width >= DESKTOP_MIN_WIDTH;
}

/** Persistent prototype/draft notice. Text must stay clear in every mode. */
export function DraftNotice({
  mode,
  unreviewed,
  variant,
}: {
  mode: 'developer-demo' | 'tester';
  unreviewed: boolean;
  variant: 'strip' | 'banner';
}) {
  const tester = mode === 'tester';
  const main = tester ? 'Prototipe · mode penguji' : unreviewed ? 'Konten contoh · belum ditinjau' : 'Konten';
  const context = tester ? 'Hanya materi yang disetujui yang ditampilkan' : 'Prototipe pengembang';
  return (
    <View
      testID="dev-banner"
      accessibilityRole="summary"
      style={[
        variant === 'strip' ? styles.noticeStrip : styles.noticeBanner,
        tester ? styles.noticeTester : styles.noticeDraft,
      ]}
    >
      <Icon name={tester ? 'flask-outline' : 'information-circle'} size={variant === 'strip' ? 15 : 20} color={tester ? colors.infoInk : colors.clueInk} />
      <Text style={[styles.noticeText, tester && { color: colors.infoInk }]} numberOfLines={2}>
        <Text style={styles.noticeMain}>{main}</Text>
        <Text style={styles.noticeContext}>{`  ·  ${context}`}</Text>
      </Text>
    </View>
  );
}

/** Very subtle canvas wash: mint upper-left → peach upper-right, fading to paper. Opaque. */
export function Canvas() {
  return (
    <View style={StyleSheet.absoluteFill} pointerEvents="none">
      <LinearGradient
        colors={[colors.canvasMint, colors.canvasPeach]}
        start={{ x: 0, y: 0 }}
        end={{ x: 1, y: 0.2 }}
        style={StyleSheet.absoluteFill}
      />
      <LinearGradient
        colors={['rgba(247,242,234,0)', colors.canvasPaper]}
        start={{ x: 0.5, y: 0.15 }}
        end={{ x: 0.5, y: 1 }}
        style={StyleSheet.absoluteFill}
      />
    </View>
  );
}

/** Scrollable page column on the canvas. `width`: exercise ≈ 620, content ≈ 760, wide ≈ 980. */
export function Page({ children, width = 'content' }: { children: ReactNode; width?: 'exercise' | 'content' | 'wide' }) {
  const desktop = useIsDesktop();
  const maxWidth = width === 'exercise' ? 620 : width === 'wide' ? 980 : 760;
  return (
    <View style={styles.pageRoot}>
      <Canvas />
      <ScrollView
      style={styles.scroll}
      contentContainerStyle={[styles.page, desktop && styles.pageDesktop]}
      keyboardShouldPersistTaps="handled"
    >
        <View style={[styles.column, { maxWidth }]}>{children}</View>
      </ScrollView>
    </View>
  );
}

export function H1({ children, testID }: { children: ReactNode; testID?: string }) {
  const desktop = useIsDesktop();
  return (
    <Text accessibilityRole="header" testID={testID} style={[styles.h1, desktop && styles.h1Desktop]}>
      {children}
    </Text>
  );
}

export function H2({ children, testID }: { children: ReactNode; testID?: string }) {
  return (
    <Text accessibilityRole="header" testID={testID} style={styles.h2}>
      {children}
    </Text>
  );
}

export function Eyebrow({ children, tone = 'muted' }: { children: ReactNode; tone?: 'muted' | 'mint' | 'indigo' }) {
  return (
    <Text style={[styles.eyebrow, tone === 'mint' && { color: colors.mintInk }, tone === 'indigo' && { color: colors.indigoText }]}>
      {children}
    </Text>
  );
}

export function P({ children, style, testID }: { children: ReactNode; style?: StyleProp<TextStyle>; testID?: string }) {
  return (
    <Text style={[styles.p, style]} testID={testID}>
      {children}
    </Text>
  );
}

export function Muted({ children, style, testID }: { children: ReactNode; style?: StyleProp<TextStyle>; testID?: string }) {
  return (
    <Text style={[styles.muted, style]} testID={testID}>
      {children}
    </Text>
  );
}

type Tone = 'plain' | 'white' | 'good' | 'warn' | 'info' | 'danger';

export function Card({
  children,
  tone = 'plain',
  accent,
  style,
  testID,
}: {
  children: ReactNode;
  tone?: Tone;
  /** Left accent bar colour (S19 topic cards). */
  accent?: string;
  style?: StyleProp<ViewStyle>;
  testID?: string;
}) {
  return (
    <View
      testID={testID}
      style={[
        styles.card,
        tone === 'white' && styles.cardWhite,
        tone === 'good' && styles.toneGood,
        tone === 'warn' && styles.toneWarn,
        tone === 'info' && styles.toneInfo,
        tone === 'danger' && styles.toneDanger,
        accent ? { borderLeftWidth: 4, borderLeftColor: accent } : null,
        style,
      ]}
    >
      {children}
    </View>
  );
}

/** Small notice row with an icon (info / warning / error states). */
export function Notice({ tone, icon, children, testID }: { tone: 'info' | 'warn' | 'danger' | 'good'; icon?: IconName; children: ReactNode; testID?: string }) {
  const ink = tone === 'info' ? colors.infoInk : tone === 'warn' ? colors.clueInk : tone === 'danger' ? colors.dangerInk : colors.mintInk;
  return (
    <View
      testID={testID}
      style={[
        styles.notice,
        tone === 'info' && styles.toneInfo,
        tone === 'warn' && styles.toneWarn,
        tone === 'danger' && styles.toneDanger,
        tone === 'good' && styles.toneGood,
      ]}
    >
      <Icon name={icon ?? (tone === 'danger' ? 'alert-circle' : 'information-circle')} color={ink} />
      <Text style={[styles.noticeBody, { color: ink }]}>{children}</Text>
    </View>
  );
}

/** Fully vowelled Arabic, right-to-left, in a font that renders harakat clearly. Never strips marks. */
export function ArabicText({
  children,
  scale = 1,
  size = 34,
  align = 'center',
  testID,
}: {
  children: string;
  scale?: number;
  size?: number;
  align?: 'center' | 'right';
  testID?: string;
}) {
  const fontSize = Math.round(size * scale);
  return (
    <Text
      testID={testID}
      style={[styles.arabic, { fontSize, lineHeight: Math.round(fontSize * 1.9), textAlign: align }]}
      accessibilityLanguage="ar"
    >
      {children}
    </Text>
  );
}

export function Btn({
  label,
  onPress,
  kind = 'primary',
  disabled,
  arabic,
  selected,
  icon,
  testID,
  accessibilityLabel,
}: {
  label: string;
  onPress: () => void;
  kind?: 'primary' | 'secondary' | 'quiet' | 'tile';
  disabled?: boolean;
  arabic?: boolean;
  selected?: boolean;
  icon?: IconName;
  testID?: string;
  accessibilityLabel?: string;
}) {
  const primary = kind === 'primary';
  return (
    <Pressable
      testID={testID}
      accessibilityRole="button"
      accessibilityLabel={accessibilityLabel}
      accessibilityState={{ disabled: !!disabled, selected: !!selected }}
      disabled={disabled}
      onPress={onPress}
      style={({ pressed }) => [
        styles.btn,
        styles[`btn_${kind}`],
        selected && styles.btnSelected,
        disabled && styles.btnDisabled,
        pressed && !disabled && (primary ? styles.btnPressedPrimary : styles.btnPressed),
      ]}
    >
      {primary ? (
        <LinearGradient
          colors={[colors.navyTop, colors.navyBottom]}
          style={[StyleSheet.absoluteFill, { borderRadius: radius.md }]}
          pointerEvents="none"
        />
      ) : null}
      <View style={styles.btnInner}>
        {icon ? <Icon name={icon} size={18} color={primary ? '#FFFFFF' : selected ? colors.indigoText : colors.ink} /> : null}
        <Text
          style={[
            styles.btnText,
            !primary && styles.btnTextAlt,
            kind === 'quiet' && styles.btnTextQuiet,
            selected && styles.btnTextSelected,
            arabic && styles.btnArabic,
          ]}
        >
          {label}
        </Text>
      </View>
    </Pressable>
  );
}

/** Two-up segmented choice (S09 Unvocalized/Vocalized toggle anatomy). */
export function Segmented<T extends string | number>({
  options,
  value,
  onChange,
  testIDPrefix,
}: {
  options: { value: T; label: string }[];
  value: T | null;
  onChange: (v: T) => void;
  testIDPrefix?: string;
}) {
  return (
    <View style={styles.segmented} accessibilityRole="radiogroup">
      {options.map((o) => {
        const on = o.value === value;
        return (
          <Pressable
            key={String(o.value)}
            testID={testIDPrefix ? `${testIDPrefix}${o.value}` : undefined}
            accessibilityRole="radio"
            accessibilityState={{ checked: on, selected: on }}
            onPress={() => onChange(o.value)}
            style={[styles.segment, on && styles.segmentOn]}
          >
            <Text style={[styles.segmentText, on && styles.segmentTextOn]}>{o.label}</Text>
          </Pressable>
        );
      })}
    </View>
  );
}

export function ProgressTrack({ value, max, label }: { value: number; max: number; label: string }) {
  const pct = max > 0 ? Math.min(1, Math.max(0, value / max)) : 0;
  return (
    <View
      style={styles.track}
      accessibilityRole="progressbar"
      accessibilityLabel={label}
      accessibilityValue={{ min: 0, max, now: value }}
    >
      <View style={[styles.trackFill, { width: `${pct * 100}%` }]} />
    </View>
  );
}

export function ConstructedLabel() {
  return <Text style={styles.constructed}>Kalimat latihan buatan — bukan ayat Al-Qur&apos;an</Text>;
}

export function HelpLines({ lines, scale }: { lines: HelpLine[]; scale: number }) {
  if (!lines.length) return null;
  return (
    <View style={styles.help}>
      {lines.map((h) => (
        <View key={h.word} style={styles.helpRow}>
          <Text style={styles.helpLabel}>Bantuan: </Text>
          <ArabicText size={20} scale={scale}>
            {h.word}
          </ArabicText>
          <Text style={styles.helpLabel}> = {h.meaning}</Text>
        </View>
      ))}
    </View>
  );
}

/** Example block (S19–S22): Arabic, then the Indonesian gloss. No transliteration (the content has none). */
export function ExampleBlock({ arabic, gloss, scale }: { arabic: string; gloss: string; scale: number }) {
  return (
    <View style={styles.example}>
      <ArabicText scale={scale} size={30} align="right">
        {arabic}
      </ArabicText>
      <Text style={styles.exampleGloss}>{gloss}</Text>
    </View>
  );
}

/** Reading-clue block (S19–S22), used only for an existing explanation paragraph. */
export function ClueBlock({ children }: { children: string }) {
  return (
    <View style={styles.clue}>
      <Text style={styles.clueLabel}>Petunjuk membaca</Text>
      <Text style={styles.clueText}>{children}</Text>
    </View>
  );
}

export function Field(props: { value: string; onChangeText: (t: string) => void; placeholder: string; testID?: string; editable?: boolean }) {
  return (
    <TextInput
      {...props}
      style={styles.input}
      autoCapitalize="none"
      autoCorrect={false}
      spellCheck={false}
      placeholderTextColor={colors.muted}
      accessibilityLabel={props.placeholder}
    />
  );
}

export function EmptyState({ icon, title, children }: { icon: IconName; title: string; children?: ReactNode }) {
  return (
    <Card tone="white" style={styles.empty}>
      <Icon name={icon} size={36} color={colors.borderStrong} />
      <Text accessibilityRole="header" style={styles.emptyTitle}>
        {title}
      </Text>
      {children}
    </Card>
  );
}

const REPORT_REASONS = ['Teks Arab salah', 'Terjemahan tidak tepat', 'Jawaban saya seharusnya benar', 'Soal membingungkan', 'Lainnya'];

/** «Laporkan soal»: short reason list and a free-text field (S14 modal anatomy). */
export function ReportButton({ onSubmit }: { onSubmit: (reason: string, text: string) => Promise<void> }) {
  const [open, setOpen] = useState(false);
  const [reason, setReason] = useState<string | null>(null);
  const [text, setText] = useState('');
  const [sent, setSent] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const close = () => {
    setOpen(false);
    setReason(null);
    setText('');
    setError(null);
  };

  return (
    <View>
      <Pressable onPress={() => setOpen(true)} accessibilityRole="button" testID="report-open" style={styles.reportBtn}>
        <Icon name={sent ? 'checkmark-circle-outline' : 'flag-outline'} size={14} color={colors.muted} />
        <Text style={styles.reportLink}>{sent ? 'Laporan terkirim' : 'Laporkan soal'}</Text>
      </Pressable>
      <Modal visible={open} transparent animationType="fade" onRequestClose={close}>
        <View style={styles.modalBack}>
          <View style={styles.modal} accessibilityViewIsModal>
            <View style={styles.modalHead}>
              <View style={{ flex: 1 }}>
                <Eyebrow tone="indigo">Laporan</Eyebrow>
                <H2>Laporkan soal</H2>
              </View>
              <Pressable accessibilityRole="button" accessibilityLabel="Tutup" onPress={close} style={styles.modalClose}>
                <Icon name="close" color={colors.ink} />
              </Pressable>
            </View>
            {REPORT_REASONS.map((r, n) => (
              <Btn key={r} testID={`report-reason-${n}`} label={r} kind="secondary" selected={reason === r} onPress={() => setReason(r)} />
            ))}
            <Field testID="report-text" value={text} onChangeText={setText} placeholder="Keterangan (boleh kosong)" />
            {error ? <Notice tone="danger">{error}</Notice> : null}
            <View style={styles.modalActions}>
              <View style={{ flex: 1 }}>
                <Btn label="Batal" kind="secondary" onPress={close} />
              </View>
              <View style={{ flex: 1 }}>
                <Btn
                  label="Kirim laporan"
                  disabled={!reason || busy}
                  testID="report-send"
                  onPress={async () => {
                    if (!reason) return;
                    setBusy(true);
                    try {
                      await onSubmit(reason, text);
                      setSent(true);
                      close();
                    } catch {
                      setError('Laporan belum tersimpan. Coba lagi.');
                    } finally {
                      setBusy(false);
                    }
                  }}
                />
              </View>
            </View>
          </View>
        </View>
      </Modal>
    </View>
  );
}

const styles = StyleSheet.create({
  noticeStrip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    paddingVertical: 6,
    paddingHorizontal: 16,
    borderBottomWidth: 1,
  },
  noticeBanner: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    paddingVertical: 12,
    paddingHorizontal: 16,
    borderWidth: 1,
    borderRadius: radius.md,
  },
  noticeDraft: { backgroundColor: colors.clueBg, borderColor: colors.clueBar },
  noticeTester: { backgroundColor: colors.infoBg, borderColor: colors.infoBorder },
  noticeText: { flex: 1, color: colors.clueInk, fontSize: 13, lineHeight: 18, writingDirection: 'ltr', textAlign: 'left' },
  noticeMain: { fontWeight: '700' },
  noticeContext: { fontWeight: '400' },

  pageRoot: { flex: 1, backgroundColor: colors.canvasPaper },
  scroll: { flex: 1, backgroundColor: 'transparent' },
  page: { padding: 16, paddingBottom: 48, flexGrow: 1 },
  pageDesktop: { paddingHorizontal: 40, paddingTop: 28 },
  column: { width: '100%', alignSelf: 'center', gap: 14 },

  // Indonesian text is pinned LTR so a line that starts with Arabic (e.g. «هُوَ dan هِيَ») is not flipped RTL.
  h1: { fontSize: 28, lineHeight: 34, fontWeight: '800', color: colors.ink, letterSpacing: -0.3, writingDirection: 'ltr', textAlign: 'left' },
  h1Desktop: { fontSize: 36, lineHeight: 44 },
  h2: { fontSize: 20, lineHeight: 26, fontWeight: '700', color: colors.ink, writingDirection: 'ltr', textAlign: 'left' },
  eyebrow: { fontSize: 13, fontWeight: '600', color: colors.muted, letterSpacing: 0.2, writingDirection: 'ltr', textAlign: 'left' },
  p: { fontSize: 16, lineHeight: 24, color: colors.body, writingDirection: 'ltr', textAlign: 'left' },
  muted: { fontSize: 14, lineHeight: 20, color: colors.muted, writingDirection: 'ltr', textAlign: 'left' },

  card: {
    backgroundColor: colors.surface,
    borderRadius: radius.md,
    padding: 16,
    gap: 10,
    borderWidth: 1,
    borderColor: colors.border,
    ...shadow,
  },
  cardWhite: { backgroundColor: colors.white },
  toneGood: { backgroundColor: colors.mintBg, borderColor: colors.mintBorder },
  toneWarn: { backgroundColor: colors.clueBg, borderColor: colors.clueBar },
  toneInfo: { backgroundColor: colors.infoBg, borderColor: colors.infoBorder },
  toneDanger: { backgroundColor: colors.dangerBg, borderColor: colors.dangerBorder },

  notice: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 10,
    padding: 12,
    borderRadius: radius.md,
    borderWidth: 1,
  },
  noticeBody: { flex: 1, fontSize: 15, lineHeight: 21, writingDirection: 'ltr', textAlign: 'left' },

  arabic: { fontFamily: ARABIC_FONT, writingDirection: 'rtl', color: colors.ink },

  btn: {
    borderRadius: radius.md,
    minHeight: 48,
    paddingVertical: 12,
    paddingHorizontal: 18,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 1,
    overflow: 'hidden',
  },
  btn_primary: { backgroundColor: colors.navyBottom, borderColor: colors.navyBottom, ...shadow },
  btn_secondary: { backgroundColor: colors.paper, borderColor: colors.borderStrong },
  btn_quiet: { backgroundColor: 'transparent', borderColor: 'transparent' },
  btn_tile: { backgroundColor: colors.white, borderColor: colors.border, minHeight: 88, paddingVertical: 16, borderRadius: radius.lg },
  btnInner: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  btnSelected: { borderColor: colors.indigo, backgroundColor: colors.indigoSoft, borderWidth: 2 },
  btnDisabled: { opacity: 0.45 },
  btnPressed: { backgroundColor: colors.indigoSoft },
  btnPressedPrimary: { opacity: 0.88 },
  btnText: { color: '#FFFFFF', fontSize: 16, fontWeight: '700', textAlign: 'center' },
  btnTextAlt: { color: colors.ink },
  btnTextQuiet: { color: colors.inkSoft },
  btnTextSelected: { color: colors.indigoText },
  btnArabic: { fontFamily: ARABIC_FONT, fontSize: 32, lineHeight: 58, writingDirection: 'rtl', fontWeight: '400', color: colors.ink },

  segmented: {
    flexDirection: 'row',
    backgroundColor: colors.paper,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radius.md,
    padding: 4,
    gap: 4,
  },
  segment: { flex: 1, minHeight: 44, borderRadius: radius.sm, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 8 },
  segmentOn: { backgroundColor: colors.indigoSoft },
  segmentText: { fontSize: 16, fontWeight: '600', color: colors.inkSoft, writingDirection: 'ltr' },
  segmentTextOn: { color: colors.indigoText, fontWeight: '700' },

  track: { height: 8, borderRadius: radius.pill, backgroundColor: colors.track, overflow: 'hidden' },
  trackFill: { height: 8, borderRadius: radius.pill, backgroundColor: colors.indigo },

  constructed: { fontSize: 12, color: colors.muted, textAlign: 'center' },
  help: { gap: 4, alignItems: 'center' },
  helpRow: { flexDirection: 'row', alignItems: 'center', flexWrap: 'wrap', justifyContent: 'center' },
  helpLabel: { fontSize: 15, color: colors.muted, writingDirection: 'ltr' },

  example: {
    backgroundColor: colors.exampleBg,
    borderLeftWidth: 3,
    borderLeftColor: colors.exampleBar,
    borderRadius: radius.sm,
    paddingVertical: 8,
    paddingHorizontal: 14,
  },
  exampleGloss: { fontSize: 15, lineHeight: 21, color: colors.body, writingDirection: 'ltr', textAlign: 'left' },
  clue: {
    backgroundColor: colors.clueBg,
    borderLeftWidth: 3,
    borderLeftColor: colors.clueBar,
    borderRadius: radius.sm,
    paddingVertical: 10,
    paddingHorizontal: 14,
    gap: 4,
  },
  clueLabel: { fontSize: 13, fontWeight: '700', color: colors.clueInk },
  clueText: { fontSize: 15, lineHeight: 22, color: colors.body, writingDirection: 'ltr', textAlign: 'left' },

  input: {
    borderWidth: 1,
    borderColor: colors.borderStrong,
    borderRadius: radius.md,
    paddingHorizontal: 14,
    paddingVertical: 12,
    fontSize: 17,
    backgroundColor: colors.white,
    color: colors.ink,
    minHeight: 48,
  },

  empty: { alignItems: 'center', paddingVertical: 32, gap: 12 },
  emptyTitle: { fontSize: 20, lineHeight: 26, fontWeight: '700', color: colors.ink, textAlign: 'center', writingDirection: 'ltr' },

  reportBtn: { flexDirection: 'row', gap: 6, alignItems: 'center', justifyContent: 'center', paddingVertical: 10, minHeight: 44 },
  reportLink: { color: colors.muted, fontSize: 14, textDecorationLine: 'underline', writingDirection: 'ltr' },
  modalBack: { flex: 1, backgroundColor: colors.backdrop, justifyContent: 'center', padding: 16 },
  modal: {
    backgroundColor: colors.paper,
    borderRadius: radius.lg,
    padding: 18,
    gap: 8,
    maxWidth: 520,
    width: '100%',
    alignSelf: 'center',
    borderWidth: 1,
    borderColor: colors.border,
    ...shadow,
  },
  modalHead: { flexDirection: 'row', alignItems: 'flex-start', marginBottom: 4 },
  modalClose: { width: 44, height: 44, alignItems: 'center', justifyContent: 'center', borderRadius: radius.md },
  modalActions: { flexDirection: 'row', gap: 10, marginTop: 4 },
});
