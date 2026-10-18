import Ionicons from '@expo/vector-icons/Ionicons';
import { LinearGradient } from 'expo-linear-gradient';
import { useCallback, useEffect, useImperativeHandle, useRef, useState, type ComponentProps, type ReactNode, type Ref } from 'react';
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
import { moveFocus } from './a11y';
import { useApp } from './AppContext';
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

/** Brings part of a Page into view, immediately (never an animated scroll). */
export interface PageHandle {
  /**
   * Shows `target` whole, bringing it up from below (e.g. the answer feedback and Lanjut). A target
   * taller than the view is aligned at its top instead, so its heading stays readable. Asked before
   * the page is laid out, or while its route is hidden, it waits until the page can be measured.
   */
  reveal: (target: View | null) => void;
  /** Back to the top of the page: a new question or lesson screen starts at its heading. Drops a waiting reveal. */
  toTop: () => void;
}

/** Scroll offset that shows the block [top, top + height] of the content in a view `viewport` px tall. */
export function revealOffset(top: number, height: number, viewport: number, margin = 16): number {
  return Math.max(0, Math.min(top - margin, top + height + margin - viewport));
}

/** Scrollable page column on the canvas. `width`: exercise ≈ 620, content ≈ 760, wide ≈ 980. */
export function Page({ children, width = 'content', ref }: { children: ReactNode; width?: 'exercise' | 'content' | 'wide'; ref?: Ref<PageHandle> }) {
  const desktop = useIsDesktop();
  const maxWidth = width === 'exercise' ? 620 : width === 'wide' ? 980 : 760;
  const scroll = useRef<ScrollView>(null);
  const column = useRef<View>(null);
  const viewport = useRef(0); // visible height of the scroll view; 0 until laid out and while the route is hidden
  const columnTop = useRef<number | null>(null); // offset of the column in the scrolled content (page padding); null until shown
  const pending = useRef<View | null>(null); // a reveal waiting until the page can be measured
  const request = useRef(0); // a newer reveal, toTop or unmount supersedes a measurement still in flight

  // Runs the waiting reveal once the page is laid out and shown. A session reopened on its feedback
  // lays the feedback out before the page around it, and a retained route measures zero while hidden.
  // Measured against the column, not the screen, so the current scroll position does not matter.
  const flush = useCallback(() => {
    const target = pending.current;
    if (!target || !column.current || !viewport.current || columnTop.current === null) return;
    pending.current = null;
    request.current += 1;
    const id = request.current;
    try {
      target.measureLayout(column.current as never, (_x, y, _width, height) => {
        if (id !== request.current) return; // superseded by a newer reveal, by toTop (Lanjut) or by unmounting
        if (!viewport.current || columnTop.current === null || height <= 0) {
          if (!pending.current) pending.current = target; // hidden again or not laid out yet: retry on the next layout
          return;
        }
        scroll.current?.scrollTo({ y: revealOffset(columnTop.current + y, height, viewport.current), animated: false });
      });
    } catch {
      // Scrolling is an enhancement: focus and the live region still present the content.
    }
  }, []);
  useImperativeHandle(
    ref,
    () => ({
      reveal: (target: View | null) => {
        pending.current = target;
        flush();
      },
      toTop: () => {
        pending.current = null;
        request.current += 1;
        try {
          scroll.current?.scrollTo({ y: 0, animated: false });
        } catch {
          // as above
        }
      },
    }),
    [flush]
  );
  useEffect(
    () => () => {
      pending.current = null;
      request.current += 1;
    },
    []
  );
  return (
    <View style={styles.pageRoot}>
      <Canvas />
      <ScrollView
        ref={scroll}
        style={styles.scroll}
        contentContainerStyle={[styles.page, desktop && styles.pageDesktop]}
        keyboardShouldPersistTaps="handled"
        onLayout={(e) => {
          viewport.current = e.nativeEvent.layout.height;
          flush();
        }}
      >
        <View
          ref={column}
          style={[styles.column, { maxWidth }]}
          onLayout={(e) => {
            const { y, height } = e.nativeEvent.layout;
            columnTop.current = height > 0 ? y : null;
            flush();
          }}
        >
          {children}
        </View>
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
      lang="ar"
    >
      {children}
    </Text>
  );
}

const ARABIC_RUN = /([\u0600-\u06FF\u0750-\u077F\uFB50-\uFDFF\uFE70-\uFEFF]+(?:[ \u00A0]+[\u0600-\u06FF\u0750-\u077F\uFB50-\uFDFF\uFE70-\uFEFF]+)*)/;

/** Splits text into Latin and Arabic runs (consecutive Arabic words stay one run). */
export function arabicRuns(text: string): { text: string; arabic: boolean }[] {
  return text
    .split(ARABIC_RUN)
    .filter((t) => t.length > 0)
    .map((t) => ({ text: t, arabic: ARABIC_RUN.test(t) && /^[^A-Za-z0-9]*$/.test(t) }));
}

/**
 * UI-02: Indonesian text with inline Arabic (lesson titles, body, prompts, feedback). Arabic runs are
 * marked lang="ar", set right-to-left in the Arabic font and follow the learner's Arabic text size.
 */
export function MixedText({
  children,
  scale = 1,
  style,
  testID,
  header,
  numberOfLines,
}: {
  children: string;
  scale?: number;
  style?: StyleProp<TextStyle>;
  testID?: string;
  header?: boolean;
  numberOfLines?: number;
}) {
  const base = StyleSheet.flatten([styles.p, style]);
  const size = Math.round((base.fontSize ?? 16) * 1.35 * scale);
  return (
    <Text style={base} testID={testID} accessibilityRole={header ? 'header' : undefined} numberOfLines={numberOfLines}>
      {arabicRuns(children).map((r, n) =>
        r.arabic ? (
          <Text key={n} lang="ar" accessibilityLanguage="ar" style={[styles.inlineArabic, { fontSize: size, lineHeight: Math.round(size * 1.7) }]}>
            {r.text}
          </Text>
        ) : (
          r.text
        )
      )}
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

/**
 * Keyboard activation for single-choice radios (UI-01). react-native-web activates role="radio" on
 * Enter only; ARIA radios select on Space too. Space is also kept from scrolling the page.
 */
export function selectOnSpace(select: () => void): object {
  // `onKeyDown` is a react-native-web prop (not in the native Pressable types); native ignores it.
  return {
    onKeyDown: (e: { key?: string; nativeEvent?: { key?: string }; preventDefault?: () => void }) => {
      const key = e.nativeEvent?.key ?? e.key;
      if (key === ' ' || key === 'Spacebar') {
        e.preventDefault?.();
        select();
      }
    },
  };
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
            {...selectOnSpace(() => onChange(o.value))}
            style={[styles.segment, on && styles.segmentOn]}
          >
            <Text style={[styles.segmentText, on && styles.segmentTextOn]}>{o.label}</Text>
          </Pressable>
        );
      })}
    </View>
  );
}

export function ProgressTrack({ value, max, label, testID }: { value: number; max: number; label: string; testID?: string }) {
  const pct = max > 0 ? Math.min(1, Math.max(0, value / max)) : 0;
  return (
    <View
      testID={testID}
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
          <MixedText scale={scale} style={styles.helpLabel}>{` = ${h.meaning}`}</MixedText>
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
      <MixedText scale={scale} style={styles.exampleGloss}>
        {gloss}
      </MixedText>
    </View>
  );
}

/** Reading-clue block (S19–S22), used only for an existing explanation paragraph. */
export function ClueBlock({ children, scale = 1 }: { children: string; scale?: number }) {
  return (
    <View style={styles.clue}>
      <Text style={styles.clueLabel}>Petunjuk membaca</Text>
      <MixedText scale={scale} style={styles.clueText}>
        {children}
      </MixedText>
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

  const dialogHeading = useRef<View>(null);
  useEffect(() => {
    if (open) setTimeout(() => moveFocus(dialogHeading), 0); // after the modal mounts
  }, [open]);

  const close = () => {
    setOpen(false);
    setReason(null);
    setText('');
    setError(null);
  };

  return (
    <View>
      <Pressable
        onPress={() => setOpen(true)}
        accessibilityRole="button"
        accessibilityLabel={sent ? 'Laporan terkirim. Laporkan soal lagi' : 'Laporkan soal'}
        accessibilityHint="Membuka formulir laporan"
        testID="report-open"
        style={styles.reportBtn}
      >
        <Icon name={sent ? 'checkmark-circle-outline' : 'flag-outline'} size={14} color={colors.muted} />
        <Text style={styles.reportLink}>{sent ? 'Laporan terkirim' : 'Laporkan soal'}</Text>
      </Pressable>
      <Modal visible={open} transparent animationType="fade" onRequestClose={close}>
        <View style={styles.modalBack}>
          <View style={styles.modal} accessibilityViewIsModal role="dialog" aria-modal accessibilityLabel="Laporkan soal" testID="report-dialog">
            <View style={styles.modalHead}>
              <View style={{ flex: 1 }} ref={dialogHeading} tabIndex={-1}>
                <Eyebrow tone="indigo">Laporan</Eyebrow>
                <H2>Laporkan soal</H2>
              </View>
              <Pressable accessibilityRole="button" accessibilityLabel="Tutup" onPress={close} style={styles.modalClose}>
                <Icon name="close" color={colors.ink} />
              </Pressable>
            </View>
            <View role="radiogroup" accessibilityLabel="Alasan laporan" style={{ gap: 8 }} testID="report-reasons">
              {REPORT_REASONS.map((r, n) => (
                <Pressable
                  key={r}
                  testID={`report-reason-${n}`}
                  accessibilityRole="radio"
                  accessibilityState={{ checked: reason === r, selected: reason === r }}
                  onPress={() => setReason(r)}
                  {...selectOnSpace(() => setReason(r))}
                  style={[styles.btn, styles.btn_secondary, reason === r && styles.btnSelected]}
                >
                  <Text style={styles.reasonText}>{r}</Text>
                </Pressable>
              ))}
            </View>
            <Field testID="report-text" value={text} onChangeText={setText} placeholder="Keterangan (boleh kosong)" />
            {error ? (
              <View role="alert" accessibilityLiveRegion="assertive">
                <Notice tone="danger" testID="report-error">
                  {error}
                </Notice>
              </View>
            ) : null}
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
  inlineArabic: { fontFamily: ARABIC_FONT, writingDirection: 'rtl', color: colors.ink },
  reasonText: { fontSize: 16, fontWeight: '600', color: colors.ink, textAlign: 'center' },

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

/** Saved data could not be read: nothing was changed; tell the learner what that means (ENG-06). */
export function StorageRefused({ message }: { message: string }) {
  return (
    <Page>
      <View testID="storage-refused" style={{ gap: 12 }}>
        <H1>Data tersimpan tidak dapat dibaca</H1>
        <Notice tone="danger">
          Data yang tersimpan di perangkat ini tidak diubah dan tidak dihapus. Aplikasi tidak akan menyimpan apa pun sampai data
          dapat dibaca.
        </Notice>
        <P>Hubungi tim kursus dengan ID peserta Anda bila masalah ini berlanjut.</P>
        <ErrorDetail message={message} />
      </View>
    </Page>
  );
}

/** The technical cause of an error, for developers only: learners (tester mode) see the Indonesian message alone. */
export function ErrorDetail({ message }: { message: string }) {
  const { rules } = useApp();
  if (rules.mode !== 'developer-demo') return null;
  return <Muted testID="error-detail">{`Detail teknis (mode pengembang): ${message}`}</Muted>;
}

/**
 * ENG-R01: this tab may not write (another tab is the writer, or the browser cannot keep tabs
 * apart). Shown on routes that save, instead of their content. The tab takes over by itself
 * once the other tab is closed.
 */
export function ReadOnlyNotice({ reason }: { reason: string }) {
  const otherTab = /another tab/i.test(reason);
  return (
    <View testID="read-only" accessibilityRole="alert" style={{ gap: 8 }}>
      <Notice tone="warn">
        {otherTab
          ? 'Aplikasi ini sedang terbuka di tab lain. Agar jawaban tidak saling menimpa, tab ini hanya bisa dibaca.'
          : 'Peramban ini tidak dapat menjaga agar beberapa tab tidak saling menimpa data, jadi aplikasi hanya bisa dibaca di sini.'}
      </Notice>
      <Muted>
        {otherTab
          ? 'Tutup tab lain itu; tab ini akan otomatis bisa dipakai lagi dengan data terbaru. Tidak ada data yang diubah.'
          : 'Tidak ada data yang diubah. Gunakan peramban versi terbaru untuk menyimpan jawaban.'}
      </Muted>
    </View>
  );
}
