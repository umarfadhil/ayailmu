import Ionicons from '@expo/vector-icons/Ionicons';
import { useCallback, useContext, useEffect, useImperativeHandle, useRef, useState, type ComponentProps, type ReactNode, type Ref, type RefObject } from 'react';
import {
  Modal,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
  useWindowDimensions,
  type ScrollViewInstance,
  type StyleProp,
  type TextStyle,
  type ViewInstance,
  type ViewStyle,
} from 'react-native';
import { SafeAreaInsetsContext } from 'react-native-safe-area-context';

import { learningBetaEnabled } from '@/config/learningBeta';
import { isReleasePresentation } from '@/config/releasePresentation';
import type { HelpLine } from '@/content/schema';
import { moveFocus } from './a11y';
import { useApp } from './AppContext';
import { buttonShadow, colors, DESKTOP_MIN_WIDTH, dockShadow, fonts, NARROW_MAX_WIDTH, radius, shadow, typography as typeScale } from './theme';

export const ARABIC_FONT = fonts.arabic;

export type IconName = ComponentProps<typeof Ionicons>['name'];

/** One icon family (Ionicons) across the app. Icons are decorative: their control carries the name. */
export function Icon({ name, size = 20, color = colors.accentInk }: { name: IconName; size?: number; color?: string }) {
  return <Ionicons name={name} size={size} color={color} accessibilityElementsHidden importantForAccessibility="no" />;
}

export function useIsDesktop() {
  return useWindowDimensions().width >= DESKTOP_MIN_WIDTH;
}

/** ≤ 340 px wide or very large system text: 16 px gutters and one column of examples. */
export function useIsNarrow() {
  const { width, fontScale } = useWindowDimensions();
  return width <= NARROW_MAX_WIDTH || fontScale >= 1.5;
}

/** Safe-area insets, or none outside a provider. */
export function useInsets() {
  return useContext(SafeAreaInsetsContext) ?? { top: 0, right: 0, bottom: 0, left: 0 };
}

/** Brings part of a Page into view, immediately (never an animated scroll). */
export interface PageHandle {
  /**
   * Shows `target` whole, bringing it up from below (e.g. the answer feedback and Lanjut). A target
   * taller than the view is aligned at its top instead, so its heading stays readable. Asked before
   * the page is laid out, or while its route is hidden, it waits until the page can be measured.
   */
  reveal: (target: ViewInstance | null) => void;
  /** Back to the top of the page: a new question or lesson screen starts at its heading. Drops a waiting reveal. */
  toTop: () => void;
}

/** Scroll offset that shows the block [top, top + height] of the content in a view `viewport` px tall. */
export function revealOffset(top: number, height: number, viewport: number, margin = 16): number {
  return Math.max(0, Math.min(top - margin, top + height + margin - viewport));
}

/**
 * Scrollable page column on the paper ground. `width`: exercise ≈ 620, content ≈ 760, wide ≈ 980.
 * `header` stays fixed above the scrolling content; `footer` docks the screen's action below it. Board
 * heights are review frames, never app heights: everything scrolls and reflows with the system text size.
 */
export function Page({
  children,
  width = 'content',
  ref,
  header,
  footer,
  footerInset = true,
  footerStyle,
}: {
  children: ReactNode;
  width?: 'exercise' | 'content' | 'wide';
  ref?: Ref<PageHandle>;
  header?: ReactNode;
  footer?: ReactNode;
  /** The docked footer pads the bottom safe area (off when the tab bar below already does). */
  footerInset?: boolean;
  /** Surface of the docked footer (e.g. the tinted answer-feedback panel). */
  footerStyle?: StyleProp<ViewStyle>;
}) {
  const desktop = useIsDesktop();
  const { width: windowWidth } = useWindowDimensions();
  const insets = useInsets();
  const gutter = windowWidth <= NARROW_MAX_WIDTH ? 16 : 20;
  const maxWidth = width === 'exercise' ? 620 : width === 'wide' ? 980 : 760;
  const scroll = useRef<ScrollViewInstance>(null);
  const column = useRef<ViewInstance>(null);
  const viewport = useRef(0); // visible height of the scroll view; 0 until laid out and while the route is hidden
  const columnTop = useRef<number | null>(null); // offset of the column in the scrolled content (page padding); null until shown
  const pending = useRef<ViewInstance | null>(null); // a reveal waiting until the page can be measured
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
      reveal: (target: ViewInstance | null) => {
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
      {header}
      <ScrollView
        ref={scroll}
        style={styles.scroll}
        contentContainerStyle={[
          styles.page,
          { paddingHorizontal: gutter, paddingBottom: footer ? 28 : 40 + insets.bottom },
          desktop && styles.pageDesktop,
        ]}
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
      {footer ? (
        <View style={[styles.footer, { paddingHorizontal: gutter, paddingBottom: 14 + (footerInset ? insets.bottom : 0) }, footerStyle]}>
          <View style={[styles.footerInner, { maxWidth }]}>{footer}</View>
        </View>
      ) : null}
    </View>
  );
}

export function H1({ children, testID, accessibilityLabel }: { children: ReactNode; testID?: string; accessibilityLabel?: string }) {
  return (
    <Text accessibilityRole="header" testID={testID} accessibilityLabel={accessibilityLabel} style={styles.h1}>
      {children}
    </Text>
  );
}

export function H2({ children, testID }: { children: ReactNode; testID?: string }) {
  return (
    <Text accessibilityRole="header" testID={testID} style={typeScale.heading}>
      {children}
    </Text>
  );
}

/** The learner wordmark. */
export function Wordmark() {
  return <Text style={styles.wordmark}>AyaFasih</Text>;
}

/** Group title in a settings-style list («BELAJAR», «DATA DAN PRIVASI»). */
export function SectionLabel({ children }: { children: string }) {
  return (
    <Text accessibilityRole="header" style={styles.sectionLabel}>
      {children}
    </Text>
  );
}

/** Title row of a tab screen («Panduan», «Kemajuan»): the heading and its few actions. */
export function ScreenHeader({ title, children }: { title: string; children?: ReactNode }) {
  return (
    <View style={styles.screenHeader}>
      <Text accessibilityRole="header" style={[typeScale.screenTitle, styles.screenHeaderTitle]}>
        {title}
      </Text>
      {children ? <View style={styles.headerActions}>{children}</View> : null}
    </View>
  );
}

const EYEBROW_INK = { muted: colors.muted, mint: colors.goodInk, good: colors.goodInk, indigo: colors.accent, accent: colors.accent } as const;

/** Small uppercase label above a title («UNIT A»). The underlying text keeps its case. */
export function Eyebrow({ children, tone = 'muted', testID }: { children: ReactNode; tone?: keyof typeof EYEBROW_INK; testID?: string }) {
  return (
    <Text testID={testID} style={[typeScale.eyebrow, { color: EYEBROW_INK[tone] }]}>
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

export function Caption({ children, style, testID }: { children: ReactNode; style?: StyleProp<TextStyle>; testID?: string }) {
  return (
    <Text style={[typeScale.caption, style]} testID={testID}>
      {children}
    </Text>
  );
}

type Tone = 'plain' | 'white' | 'good' | 'warn' | 'info' | 'danger';

export function Card({
  children,
  tone = 'plain',
  style,
  testID,
}: {
  children: ReactNode;
  tone?: Tone;
  /** No longer drawn: Calm Paper has no left accent bars. */
  accent?: string;
  style?: StyleProp<ViewStyle>;
  testID?: string;
}) {
  return (
    <View
      testID={testID}
      style={[
        styles.card,
        tone === 'good' && styles.toneGood,
        tone === 'warn' && styles.toneWarn,
        tone === 'info' && styles.toneInfo,
        tone === 'danger' && styles.toneDanger,
        style,
      ]}
    >
      {children}
    </View>
  );
}

const NOTICE = {
  info: { bg: colors.infoBg, line: colors.infoLine, ink: colors.infoInk, icon: 'information-circle-outline' },
  warn: { bg: colors.clueBg, line: colors.draftLine, ink: colors.draftInk, icon: 'information-circle-outline' },
  danger: { bg: colors.dangerBg, line: colors.dangerLine, ink: colors.dangerInk, icon: 'alert-circle-outline' },
  good: { bg: colors.goodBg, line: colors.goodLine, ink: colors.goodInk, icon: 'checkmark-circle-outline' },
} as const;

/** Notice row with an icon (info / warning / error / done). Storage errors alone use the danger tone. */
export function Notice({ tone, icon, children, testID, action }: { tone: keyof typeof NOTICE; icon?: IconName; children: ReactNode; testID?: string; action?: ReactNode }) {
  const t = NOTICE[tone];
  const body = <Text style={[styles.noticeBody, { color: t.ink }, tone === 'danger' && styles.noticeStrong, action ? { flex: 0 } : null]}>{children}</Text>;
  return (
    <View testID={testID} style={[styles.notice, { backgroundColor: t.bg, borderColor: t.line }]}>
      <Icon name={icon ?? t.icon} color={t.ink} />
      {action ? <View style={{ flex: 1, minWidth: 0, gap: 4 }}>{body}{action}</View> : body}
    </View>
  );
}

const CHIP = {
  neutral: { bg: colors.chipBg, ink: colors.chipInk, line: colors.chipBg },
  accent: { bg: colors.accentSoft, ink: colors.accentInk, line: colors.accentSoft },
  good: { bg: colors.goodBg, ink: colors.goodInk, line: colors.goodBg },
  draft: { bg: colors.draftBg, ink: colors.draftInk, line: colors.draftLine },
} as const;

/** Factual state label («Belum dinilai», «Sedang dilatih», «Belum tersedia»). Never a score or badge. */
export function Chip({ label, tone = 'neutral', testID }: { label: string; tone?: keyof typeof CHIP; testID?: string }) {
  const t = CHIP[tone];
  return (
    <View testID={testID} style={[styles.chip, { backgroundColor: t.bg, borderColor: t.line }]}>
      <Text style={[styles.chipText, { color: t.ink }]}>{label}</Text>
    </View>
  );
}

/** A 44 × 44 icon-only control; `label` is its accessible name («Pengaturan», «Tutup sesi»). */
export function IconButton({
  icon,
  label,
  onPress,
  testID,
  size = 24,
  color = colors.ink,
  ref,
}: {
  icon: IconName;
  label: string;
  onPress: () => void;
  testID?: string;
  size?: number;
  color?: string;
  ref?: Ref<ViewInstance>;
}) {
  return (
    <Pressable
      ref={ref}
      testID={testID}
      accessibilityRole="button"
      accessibilityLabel={label}
      onPress={onPress}
      style={({ pressed }) => [styles.iconBtn, pressed && styles.iconBtnPressed]}
    >
      <Icon name={icon} size={size} color={color} />
    </Pressable>
  );
}

/**
 * Bottom sheet (dialog). Opening moves focus to its title; dismissing it (close, backdrop, Esc or the
 * back button) returns focus to `returnFocus`. A choice made inside the sheet closes it through
 * `visible` instead, and the screen decides where focus goes next.
 */
export function Sheet({
  visible,
  title,
  onClose,
  children,
  testID,
  closeLabel = 'Tutup',
  returnFocus,
}: {
  visible: boolean;
  title: string;
  onClose: () => void;
  children: ReactNode;
  testID?: string;
  closeLabel?: string;
  returnFocus?: RefObject<ViewInstance | null>;
}) {
  const insets = useInsets();
  const { height } = useWindowDimensions();
  const titleRef = useRef<ViewInstance>(null);
  useEffect(() => {
    if (!visible) return;
    const t = setTimeout(() => moveFocus(titleRef), 0); // after the modal content mounts
    return () => clearTimeout(t);
  }, [visible]);
  const dismiss = () => {
    onClose();
    if (returnFocus) setTimeout(() => moveFocus(returnFocus), 0);
  };
  return (
    <Modal visible={visible} transparent animationType="none" onRequestClose={dismiss}>
      <View style={styles.sheetWrap}>
        <Pressable style={styles.sheetBackdrop} onPress={dismiss} accessibilityElementsHidden importantForAccessibility="no-hide-descendants" />
        <View
          testID={testID}
          role="dialog"
          aria-modal
          accessibilityViewIsModal
          accessibilityLabel={title}
          style={[styles.sheet, { maxHeight: Math.round(height * 0.88), paddingBottom: 20 + insets.bottom }]}
        >
          <View style={styles.sheetHandle} />
          <View style={styles.sheetHead}>
            <View ref={titleRef} tabIndex={-1} style={styles.sheetTitleWrap}>
              <Text accessibilityRole="header" style={styles.sheetTitle}>
                {title}
              </Text>
            </View>
            <IconButton icon="close" label={closeLabel} onPress={dismiss} />
          </View>
          <ScrollView contentContainerStyle={styles.sheetContent} keyboardShouldPersistTaps="handled">
            {children}
          </ScrollView>
        </View>
      </View>
    </Modal>
  );
}

/**
 * «Draf» chip: the content is synthetic and unreviewed. Opens a short explanation. Shown wherever
 * unreviewed content can appear; nothing in tester mode before approval.
 */
export function DraftChip() {
  const { content, rules } = useApp();
  const [open, setOpen] = useState(false);
  const chip = useRef<ViewInstance>(null);
  if (!content.unreviewed || content.empty) return null;
  return (
    <>
      <Pressable
        ref={chip}
        testID="draft-chip"
        accessibilityRole="button"
        accessibilityLabel="Konten draf, belum ditinjau. Lihat penjelasan"
        onPress={() => setOpen(true)}
        style={styles.chipHit}
      >
        <View style={[styles.chip, styles.chipDraft]}>
          <Icon name="information-circle-outline" size={14} color={colors.draftInk} />
          <Text style={[styles.chipText, { color: colors.draftInk }]}>Draf</Text>
        </View>
      </Pressable>
      <Sheet visible={open} title="Konten contoh · belum ditinjau" onClose={() => setOpen(false)} returnFocus={chip} testID="draft-sheet">
        <Text style={typeScale.body}>Kalimat Arab di aplikasi ini adalah contoh buatan yang belum ditinjau.</Text>
        <Text style={typeScale.caption}>{rules.mode === 'tester' ? 'Prototipe · mode penguji' : 'Prototipe pengembang'}</Text>
      </Sheet>
    </>
  );
}

/** The prototype mode, stated plainly (welcome, settings, empty states). A validated production build shows none; a validated learning beta says it is a private beta. */
export function ModeNote({ align = 'center' }: { align?: 'center' | 'left' }) {
  const { rules, content } = useApp();
  if (isReleasePresentation(rules.mode)) return null;
  const text = learningBetaEnabled()
    ? 'Beta privat · Hanya materi yang disetujui yang ditampilkan'
    : rules.mode === 'tester'
      ? 'Prototipe · mode penguji · Hanya materi yang disetujui yang ditampilkan'
      : content.unreviewed
        ? 'Prototipe pengembang · Konten contoh, belum ditinjau'
        : 'Prototipe pengembang';
  return (
    <Text testID="mode-note" style={[styles.modeNote, { textAlign: align }]}>
      {text}
    </Text>
  );
}

/** Fully vowelled Arabic, right-to-left, in a font that renders harakat clearly. Never strips marks. */
export function ArabicText({
  children,
  scale = 1,
  size = 34,
  align = 'center',
  weight = 'regular',
  testID,
}: {
  children: string;
  scale?: number;
  size?: number;
  align?: 'center' | 'right';
  /** Block Arabic (question, hero) uses the 500 face; weights stay 400–500. */
  weight?: 'regular' | 'medium';
  testID?: string;
}) {
  const fontSize = Math.round(size * scale);
  return (
    <Text
      testID={testID}
      style={[
        styles.arabic,
        { fontFamily: weight === 'medium' ? fonts.arabicMedium : fonts.arabic, fontSize, lineHeight: Math.round(fontSize * 1.9), textAlign: align },
      ]}
      accessibilityLanguage="ar"
      lang="ar"
    >
      {children}
    </Text>
  );
}

const ARABIC_RUN = /([؀-ۿݐ-ݿﭐ-﷿ﹰ-﻿]+(?:[  ]+[؀-ۿݐ-ݿﭐ-﷿ﹰ-﻿]+)*)/;

/** Splits text into Latin and Arabic runs (consecutive Arabic words stay one run). */
export function arabicRuns(text: string): { text: string; arabic: boolean }[] {
  return text
    .split(ARABIC_RUN)
    .filter((t) => t.length > 0)
    .map((t) => ({ text: t, arabic: ARABIC_RUN.test(t) && /^[^A-Za-z0-9]*$/.test(t) }));
}

/**
 * UI-02: Indonesian text with inline Arabic (lesson titles, body, prompts, feedback). Arabic runs are
 * marked lang="ar", set right-to-left in the Arabic font at 1.35× the surrounding size, and follow the
 * learner's Arabic text size; a line holding Arabic gets the leading the marks need.
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
  const base: TextStyle = StyleSheet.flatten([styles.p, style]) ?? {};
  const size = Math.round((base.fontSize ?? 17) * 1.35 * scale);
  const runs = arabicRuns(children);
  const leading = runs.some((r) => r.arabic) ? { lineHeight: Math.max(base.lineHeight ?? 0, Math.round(size * 1.3)) } : null;
  return (
    <Text style={[base, leading]} testID={testID} accessibilityRole={header ? 'header' : undefined} numberOfLines={numberOfLines}>
      {runs.map((r, n) =>
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
  style,
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
  style?: StyleProp<ViewStyle>;
}) {
  const primary = kind === 'primary';
  const ink = disabled
    ? primary
      ? colors.disabledInk
      : colors.muted
    : primary
      ? colors.white
      : kind === 'quiet'
        ? colors.primary
        : selected
          ? colors.accentDeep
          : colors.ink;
  // A forward arrow follows its label («Mulai sesi →»); other icons lead.
  const trailing = icon === 'arrow-forward';
  const glyph = icon ? <Icon name={icon} size={20} color={ink} /> : null;
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
        disabled && (primary ? styles.btnDisabledPrimary : styles.btnDisabled),
        pressed && !disabled && (primary ? styles.btnPressedPrimary : styles.btnPressed),
        style,
      ]}
    >
      <View style={styles.btnInner}>
        {trailing ? null : glyph}
        <Text style={[styles.btnText, primary ? styles.btnTextPrimary : kind === 'quiet' ? styles.btnTextQuiet : null, { color: ink }, arabic && styles.btnArabic]}>
          {label}
        </Text>
        {trailing ? glyph : null}
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

/** Segmented single choice (three equal parts at every width). The selected part is ringed in the accent. */
export function Segmented<T extends string | number>({
  options,
  value,
  onChange,
  testIDPrefix,
  accessibilityLabel,
}: {
  options: { value: T; label: string }[];
  value: T | null;
  onChange: (v: T) => void;
  testIDPrefix?: string;
  accessibilityLabel?: string;
}) {
  return (
    <View style={styles.segmented} accessibilityRole="radiogroup" accessibilityLabel={accessibilityLabel}>
      {options.map((o) => {
        const on = o.value === value;
        return (
          <Pressable
            key={String(o.value)}
            testID={testIDPrefix ? `${testIDPrefix}${o.value}` : undefined}
            accessibilityRole="radio"
            // Checked state for native (accessibilityState) and the web (react-native-web reads aria-* props only).
            accessibilityState={{ checked: on, selected: on }}
            aria-checked={on}
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
      // The same values for native (accessibilityValue) and the web (react-native-web reads aria-value* props only).
      accessibilityValue={{ min: 0, max, now: value }}
      aria-valuemin={0}
      aria-valuemax={max}
      aria-valuenow={value}
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
          <Text style={[styles.helpText, styles.helpLabel]}>Bantuan: </Text>
          <ArabicText size={22} scale={scale}>
            {h.word}
          </ArabicText>
          <MixedText scale={scale} style={styles.helpText}>{` = ${h.meaning}`}</MixedText>
        </View>
      ))}
    </View>
  );
}

/** Example tile (S19–S22): Arabic, then the Indonesian gloss. No transliteration (the content has none). */
export function ExampleBlock({ arabic, gloss, scale }: { arabic: string; gloss: string; scale: number }) {
  return (
    <View style={styles.example}>
      <ArabicText scale={scale} size={32}>
        {arabic}
      </ArabicText>
      <MixedText scale={scale} style={styles.exampleGloss}>
        {gloss}
      </MixedText>
    </View>
  );
}

/** Two columns of example tiles; one column on narrow screens or with very large text. */
export function ExampleGrid({ examples, scale }: { examples: { arabic: string; gloss: string }[]; scale: number }) {
  const narrow = useIsNarrow();
  return (
    <View style={styles.exampleGrid}>
      {examples.map((ex) => (
        <View key={ex.arabic} style={narrow ? styles.exampleCellFull : styles.exampleCell}>
          <ExampleBlock arabic={ex.arabic} gloss={ex.gloss} scale={scale} />
        </View>
      ))}
    </View>
  );
}

/** «Petunjuk membaca» block (S19–S22), used only for an existing explanation paragraph. */
export function ClueBlock({ children, scale = 1 }: { children: string; scale?: number }) {
  return (
    <View style={styles.clue} accessibilityLabel="Petunjuk membaca">
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
    <Card style={styles.empty}>
      <Icon name={icon} size={36} color={colors.muted} />
      <Text accessibilityRole="header" style={styles.emptyTitle}>
        {title}
      </Text>
      {children}
    </Card>
  );
}

const REPORT_REASONS = ['Teks Arab salah', 'Terjemahan tidak tepat', 'Jawaban saya seharusnya benar', 'Soal membingungkan', 'Lainnya'];

/** «Laporkan soal»: short reason list and a free-text field (S14 modal anatomy, shown as a sheet). Saved on this device only. */
export function ReportButton({ onSubmit }: { onSubmit: (reason: string, text: string) => Promise<void> }) {
  const [open, setOpen] = useState(false);
  const [reason, setReason] = useState<string | null>(null);
  const [text, setText] = useState('');
  const [sent, setSent] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const insets = useInsets();

  const dialogHeading = useRef<ViewInstance>(null);
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
        accessibilityLabel={sent ? 'Laporan tersimpan di perangkat ini. Laporkan soal lagi' : 'Laporkan soal'}
        accessibilityHint="Membuka formulir laporan"
        testID="report-open"
        style={({ pressed }) => [styles.quietAction, pressed && styles.iconBtnPressed]}
      >
        <Icon name={sent ? 'checkmark-circle-outline' : 'flag-outline'} size={16} color={colors.muted} />
        <Text style={styles.reportLink}>{sent ? 'Laporan tersimpan di perangkat ini' : 'Laporkan soal'}</Text>
      </Pressable>
      <Modal visible={open} transparent animationType="none" onRequestClose={close}>
        <View style={styles.sheetWrap}>
          <View style={styles.sheetBackdrop} />
          <View
            style={[styles.sheet, { paddingBottom: 20 + insets.bottom }]}
            accessibilityViewIsModal
            role="dialog"
            aria-modal
            accessibilityLabel="Laporkan soal"
            testID="report-dialog"
          >
            <View style={styles.sheetHandle} />
            <ScrollView contentContainerStyle={styles.sheetContent} keyboardShouldPersistTaps="handled">
              <View style={styles.sheetHead}>
                <View style={styles.sheetTitleWrap} ref={dialogHeading} tabIndex={-1}>
                  <Eyebrow tone="accent">Laporan</Eyebrow>
                  <Text accessibilityRole="header" style={styles.sheetTitle}>
                    Laporkan soal
                  </Text>
                </View>
                <IconButton icon="close" label="Tutup" onPress={close} />
              </View>
              <View role="radiogroup" accessibilityLabel="Alasan laporan" style={styles.reasons} testID="report-reasons">
                {REPORT_REASONS.map((r, n) => (
                  <Pressable
                    key={r}
                    testID={`report-reason-${n}`}
                    accessibilityRole="radio"
                    accessibilityState={{ checked: reason === r, selected: reason === r }}
                    aria-checked={reason === r}
                    onPress={() => setReason(r)}
                    {...selectOnSpace(() => setReason(r))}
                    style={[styles.reason, reason === r && styles.reasonOn]}
                  >
                    <View style={[styles.radio, reason === r && styles.radioOn]}>{reason === r ? <View style={styles.radioDot} /> : null}</View>
                    <Text style={styles.reasonText}>{r}</Text>
                  </Pressable>
                ))}
              </View>
              <Field testID="report-text" value={text} onChangeText={setText} placeholder="Keterangan (boleh kosong)" />
              <Text style={styles.small}>Laporan hanya disimpan di perangkat ini dan tidak dikirim ke mana pun.</Text>
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
                <View style={{ flex: 1.3 }}>
                  <Btn
                    label="Simpan laporan"
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
            </ScrollView>
          </View>
        </View>
      </Modal>
    </View>
  );
}

/** Saved data could not be read: nothing was changed; tell the learner what that means (ENG-06). */
export function StorageRefused({ message }: { message: string }) {
  return (
    <Page>
      <View testID="storage-refused" style={styles.refused}>
        <Text accessibilityRole="header" style={styles.refusedTitle}>
          Data tersimpan tidak dapat dibaca
        </Text>
        <Text style={styles.refusedBody}>
          Data yang tersimpan di perangkat ini tidak diubah dan tidak dihapus. Aplikasi tidak akan menyimpan apa pun sampai data dapat
          dibaca.
        </Text>
        <Text style={styles.small}>Hubungi tim kursus dengan ID peserta Anda bila masalah ini berlanjut.</Text>
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
    <View testID="read-only" accessibilityRole="alert" style={styles.readOnly}>
      <Text style={styles.readOnlyTitle}>
        {otherTab
          ? 'Aplikasi ini sedang terbuka di tab lain. Agar jawaban tidak saling menimpa, tab ini hanya bisa dibaca.'
          : 'Peramban ini tidak dapat menjaga agar beberapa tab tidak saling menimpa data, jadi aplikasi hanya bisa dibaca di sini.'}
      </Text>
      <Text style={styles.readOnlyBody}>
        {otherTab
          ? 'Tutup tab lain itu; tab ini akan otomatis bisa dipakai lagi dengan data terbaru. Tidak ada data yang diubah.'
          : 'Tidak ada data yang diubah. Gunakan peramban versi terbaru untuk menyimpan jawaban.'}
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  pageRoot: { flex: 1, backgroundColor: colors.ground },
  scroll: { flex: 1, backgroundColor: 'transparent' },
  page: { paddingTop: 12, flexGrow: 1 },
  pageDesktop: { paddingHorizontal: 40, paddingTop: 28 },
  column: { width: '100%', alignSelf: 'center', gap: 16 },
  footer: { backgroundColor: colors.ground, borderTopWidth: 1, borderTopColor: colors.line, paddingTop: 14 },
  footerInner: { width: '100%', alignSelf: 'center', gap: 6, flexShrink: 1 },

  h1: { ...typeScale.title, fontSize: 30, lineHeight: 36 },
  p: { ...typeScale.body },
  muted: { ...typeScale.small, color: colors.muted },
  small: { ...typeScale.small },

  wordmark: { fontFamily: fonts.extrabold, fontSize: 21, lineHeight: 28, letterSpacing: -0.2, color: colors.ink },
  sectionLabel: {
    fontFamily: fonts.extrabold,
    fontSize: 13,
    lineHeight: 18,
    letterSpacing: 0.8,
    textTransform: 'uppercase',
    color: colors.muted,
    marginTop: 10,
    marginHorizontal: 4,
    writingDirection: 'ltr',
    textAlign: 'left',
  },
  screenHeader: { flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', justifyContent: 'space-between', gap: 8, minHeight: 52 },
  screenHeaderTitle: { flexShrink: 1 },
  headerActions: { flexDirection: 'row', alignItems: 'center', gap: 4, flexWrap: 'wrap' },

  card: {
    backgroundColor: colors.sheet,
    borderRadius: radius.card,
    padding: 18,
    gap: 12,
    borderWidth: 1,
    borderColor: colors.line,
    ...shadow,
  },
  toneGood: { backgroundColor: colors.goodBg, borderColor: colors.goodLine },
  toneWarn: { backgroundColor: colors.clueBg, borderColor: colors.draftLine },
  toneInfo: { backgroundColor: colors.infoBg, borderColor: colors.infoLine },
  toneDanger: { backgroundColor: colors.dangerBg, borderColor: colors.dangerLine },

  notice: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 10,
    paddingVertical: 12,
    paddingHorizontal: 14,
    borderRadius: radius.input,
    borderWidth: 1,
  },
  noticeBody: { flex: 1, fontFamily: fonts.regular, fontSize: 15, lineHeight: 22, writingDirection: 'ltr', textAlign: 'left' },
  noticeStrong: { fontFamily: fonts.semibold },

  chip: {
    flexDirection: 'row',
    alignItems: 'center',
    alignSelf: 'flex-start',
    gap: 6,
    minHeight: 26,
    paddingHorizontal: 10,
    paddingVertical: 3,
    borderRadius: radius.pill,
    borderWidth: 1,
  },
  chipDraft: { minHeight: 28, backgroundColor: colors.draftBg, borderColor: colors.draftLine },
  chipText: { fontFamily: fonts.bold, fontSize: 12, lineHeight: 16 },
  chipHit: { minHeight: 44, minWidth: 44, justifyContent: 'center', paddingHorizontal: 4 },

  iconBtn: { width: 44, height: 44, alignItems: 'center', justifyContent: 'center', borderRadius: radius.sm },
  iconBtnPressed: { backgroundColor: colors.chipBg },

  sheetWrap: { flex: 1, justifyContent: 'flex-end' },
  sheetBackdrop: { position: 'absolute', top: 0, right: 0, bottom: 0, left: 0, backgroundColor: colors.backdrop },
  sheet: {
    width: '100%',
    maxWidth: 640,
    alignSelf: 'center',
    backgroundColor: colors.sheet,
    borderTopLeftRadius: radius.xl,
    borderTopRightRadius: radius.xl,
    paddingTop: 10,
    paddingHorizontal: 16,
    ...dockShadow,
  },
  sheetHandle: { alignSelf: 'center', width: 40, height: 5, borderRadius: radius.pill, backgroundColor: colors.lineStrong },
  sheetHead: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 8, paddingTop: 4, paddingLeft: 8 },
  sheetTitleWrap: { flex: 1, gap: 2 },
  sheetTitle: { fontFamily: fonts.extrabold, fontSize: 21, lineHeight: 28, color: colors.ink, writingDirection: 'ltr', textAlign: 'left' },
  sheetContent: { gap: 12, paddingTop: 6, paddingBottom: 8 },

  modeNote: { fontFamily: fonts.regular, fontSize: 12, lineHeight: 16, color: colors.muted, writingDirection: 'ltr' },

  arabic: { color: colors.ink, writingDirection: 'rtl' },
  inlineArabic: { fontFamily: fonts.arabic, writingDirection: 'rtl', color: colors.ink },

  btn: {
    borderRadius: radius.md,
    minHeight: 48,
    paddingVertical: 12,
    paddingHorizontal: 18,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 1,
    borderColor: 'transparent',
  },
  btn_primary: { minHeight: 56, backgroundColor: colors.primary, borderColor: colors.primary, ...buttonShadow },
  btn_secondary: { minHeight: 56, backgroundColor: colors.sheet, borderColor: colors.lineStrong },
  btn_quiet: { minHeight: 44, backgroundColor: 'transparent', paddingHorizontal: 12 },
  btn_tile: { backgroundColor: colors.sheet, borderColor: colors.tileLine, minHeight: 88, paddingVertical: 16, borderRadius: radius.md },
  btnInner: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 10, flexWrap: 'nowrap', alignSelf: 'stretch', minWidth: 0 },
  btnSelected: { borderColor: colors.accent, backgroundColor: colors.accentSoft, borderWidth: 2 },
  btnDisabledPrimary: { backgroundColor: colors.disabledBg, borderColor: colors.disabledBg, shadowOpacity: 0, elevation: 0 },
  btnDisabled: { opacity: 0.55 },
  btnPressed: { backgroundColor: colors.chipBg },
  btnPressedPrimary: { backgroundColor: colors.primaryPressed, borderColor: colors.primaryPressed },
  btnText: { fontFamily: fonts.bold, fontSize: 17, lineHeight: 24, textAlign: 'center', flexShrink: 1, minWidth: 0 },
  btnTextPrimary: { fontSize: 17, lineHeight: 24 },
  btnTextQuiet: { fontSize: 15, lineHeight: 22 },
  btnArabic: { fontFamily: fonts.arabic, fontSize: 32, lineHeight: 58, writingDirection: 'rtl' },

  segmented: {
    flexDirection: 'row',
    backgroundColor: colors.sheet2,
    borderWidth: 1,
    borderColor: colors.line,
    borderRadius: radius.input,
    padding: 4,
    gap: 4,
  },
  segment: {
    flex: 1,
    minHeight: 48,
    borderRadius: radius.xs,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 6,
    borderWidth: 2,
    borderColor: 'transparent',
  },
  segmentOn: { backgroundColor: colors.sheet, borderColor: colors.accent },
  segmentText: { fontFamily: fonts.semibold, fontSize: 15, lineHeight: 20, color: colors.segmentInk, textAlign: 'center' },
  segmentTextOn: { fontFamily: fonts.extrabold, color: colors.accentDeep },

  track: { height: 6, borderRadius: radius.pill, backgroundColor: colors.track, overflow: 'hidden' },
  trackFill: { height: 6, borderRadius: radius.pill, backgroundColor: colors.accent },

  constructed: { fontFamily: fonts.regular, fontSize: 12, lineHeight: 16, color: colors.muted, textAlign: 'center' },
  help: { gap: 4, alignSelf: 'stretch' },
  helpRow: { flexDirection: 'row', alignItems: 'center', flexWrap: 'wrap', columnGap: 6 },
  helpText: { fontFamily: fonts.regular, fontSize: 15, lineHeight: 22, color: colors.muted, writingDirection: 'ltr' },
  helpLabel: { fontFamily: fonts.semibold },

  exampleGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: 10 },
  exampleCell: { flexBasis: '45%', flexGrow: 1 },
  exampleCellFull: { flexBasis: '100%' },
  example: {
    backgroundColor: colors.exampleBg,
    borderWidth: 1,
    borderColor: colors.exampleLine,
    borderRadius: 18,
    paddingTop: 10,
    paddingBottom: 14,
    paddingHorizontal: 10,
    alignItems: 'center',
  },
  exampleGloss: { fontSize: 14, lineHeight: 20, color: colors.exampleInk, textAlign: 'center' },
  clue: { backgroundColor: colors.clueBg, borderRadius: radius.md, paddingVertical: 14, paddingHorizontal: 16, gap: 6 },
  clueLabel: { fontFamily: fonts.extrabold, fontSize: 13, lineHeight: 18, color: colors.clueInk },
  clueText: { fontSize: 16, lineHeight: 25, color: colors.exampleInk },

  input: {
    borderWidth: 1,
    borderColor: colors.controlLine,
    borderRadius: radius.input,
    paddingHorizontal: 14,
    paddingVertical: 12,
    fontFamily: fonts.regular,
    fontSize: 17,
    backgroundColor: colors.sheet,
    color: colors.ink,
    minHeight: 48,
  },

  empty: { alignItems: 'center', paddingVertical: 32, gap: 12 },
  emptyTitle: { fontFamily: fonts.extrabold, fontSize: 20, lineHeight: 26, color: colors.ink, textAlign: 'center' },

  quietAction: { flexDirection: 'row', gap: 8, alignItems: 'center', justifyContent: 'center', minHeight: 44, paddingHorizontal: 14, borderRadius: radius.sm },
  reportLink: { fontFamily: fonts.semibold, color: colors.muted, fontSize: 14, lineHeight: 20 },
  reasons: { gap: 8 },
  reason: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    minHeight: 52,
    paddingHorizontal: 14,
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: colors.tileLine,
    backgroundColor: colors.sheet,
  },
  reasonOn: { borderColor: colors.accent, borderWidth: 2, backgroundColor: colors.accentSoft },
  radio: { width: 22, height: 22, borderRadius: radius.pill, borderWidth: 2, borderColor: colors.controlLine, alignItems: 'center', justifyContent: 'center' },
  radioOn: { borderColor: colors.accent },
  radioDot: { width: 10, height: 10, borderRadius: radius.pill, backgroundColor: colors.accent },
  reasonText: { flex: 1, fontFamily: fonts.semibold, fontSize: 16, lineHeight: 22, color: colors.ink },
  modalActions: { flexDirection: 'row', gap: 10, marginTop: 4 },

  refused: { gap: 12 },
  refusedTitle: { ...typeScale.title },
  refusedBody: { fontFamily: fonts.semibold, fontSize: 15, lineHeight: 22, color: colors.dangerInk, writingDirection: 'ltr' },
  readOnly: { gap: 6, paddingVertical: 14, paddingHorizontal: 16, borderRadius: radius.md, backgroundColor: colors.clueBg, borderWidth: 1, borderColor: colors.draftLine },
  readOnlyTitle: { fontFamily: fonts.semibold, fontSize: 15, lineHeight: 22, color: colors.draftInk, writingDirection: 'ltr' },
  readOnlyBody: { fontFamily: fonts.regular, fontSize: 13, lineHeight: 19, color: '#5E4A38', writingDirection: 'ltr' },
});
