// Calm Paper design tokens (native Design v25, board 20 «Tokens & components»). Flat warm paper and
// navy: no gradient washes or accent bars, and state colours differ in lightness as well as hue.
import { Platform, StyleSheet } from 'react-native';

export const colors = {
  ground: '#F4EFE6', // app background
  sheet: '#FFFDF9', // cards, tiles, sheets
  sheet2: '#FAF6EF', // tab bar, segment track
  line: '#E3DACB', // decorative hairlines and card borders
  lineSoft: '#EDE5D7', // rows inside a card
  lineStrong: '#D2C6B3', // secondary buttons, pills
  tileLine: '#DCD2C0', // idle answer tiles
  marker: '#C9BCA6', // idle answer-tile marker
  markerOff: '#D8CCB8', // marker of an untouched tile after answering
  controlLine: '#8A7D69', // meaningful input and checkbox outlines (3.96:1 on sheet)

  ink: '#16233C', // headings, Arabic
  text: '#463D33', // body
  muted: '#6A5F52', // captions

  primary: '#23395B', // the one primary action; white text 11.6:1
  primaryPressed: '#1A2B46',
  accent: '#4150AE', // progress, selection, focus ring
  accentSoft: '#E9EAF7',
  accentInk: '#3A47A0',
  accentLine: '#BFC4EA',
  accentDeep: '#2F3C8A',

  goodBg: '#E2F1E9',
  goodInk: '#1C6A4E',
  goodLine: '#9FCDB7',
  goodBorder: '#4E9C7C',
  missBg: '#FBECDD', // «Belum tepat»: orange, not red
  missInk: '#8A4512',
  missLine: '#E8BF94',
  missBorder: '#C98A55',
  infoBg: '#ECF1F8',
  infoInk: '#2E4A73',
  infoLine: '#C9D6E8',
  draftBg: '#F8EFD6', // unreviewed content only
  draftInk: '#765610',
  draftLine: '#E7D08F',
  dangerBg: '#F8E7E5', // storage errors only
  dangerInk: '#9B302D',
  dangerLine: '#E6BDB8',

  exampleBg: '#EDF4EE',
  exampleLine: '#D3E5D7',
  exampleInk: '#3F362D',
  clueBg: '#FBF1DC',
  clueInk: '#765610',
  chipBg: '#F1EBDF',
  chipInk: '#5E5447',
  track: '#E6DED0',
  disabledBg: '#CFD3DC',
  disabledInk: '#3B4252',
  segmentInk: '#3B4A66',
  white: '#FFFFFF',
  backdrop: 'rgba(22,35,60,0.42)',

  // Earlier token names, kept for routes not yet moved to the names above.
  canvasPaper: '#F4EFE6',
  paper: '#FAF6EF',
  surface: '#FFFDF9',
  border: '#E3DACB',
  borderStrong: '#D2C6B3',
  inkSoft: '#16233C',
  body: '#463D33',
  navyTop: '#23395B',
  navyBottom: '#23395B',
  navyPressed: '#1A2B46',
  indigo: '#4150AE',
  indigoText: '#3A47A0',
  indigoSoft: '#E9EAF7',
  mintBg: '#E2F1E9',
  mintBorder: '#9FCDB7',
  mintInk: '#1C6A4E',
  exampleBar: '#D3E5D7',
  topicBar: '#BFC4EA',
  clueBar: '#E7D08F',
  infoBorder: '#C9D6E8',
  dangerBorder: '#E6BDB8',
};

/** Chips 999 · inputs 14 · buttons and tiles 16 · cards 20–28 · sheets 26 (top corners). */
export const radius = { xs: 10, sm: 12, input: 14, md: 16, card: 20, lg: 24, xl: 28, sheet: 26, pill: 999 };

/** Spacing scale 4 · 8 · 12 · 16 · 20 · 24 · 32; screen gutter 20 (16 at 320 px), tile gap 10. */
export const space = { gutter: 20, gutterNarrow: 16, tileGap: 10, section: 20 };

export const DESKTOP_MIN_WIDTH = 1024;
export const SIDEBAR_WIDTH = 248;
/** Widths at or below this use the narrow gutter and a single column of examples. */
export const NARROW_MAX_WIDTH = 340;

/** Card elevation: two soft warm layers (≈ 0 1px 2px + 0 12px 32px at 5–6 %). Nothing else floats. */
export const shadow = {
  shadowColor: '#3C2D14',
  shadowOpacity: 0.07,
  shadowRadius: 14,
  shadowOffset: { width: 0, height: 6 },
  elevation: 2,
} as const;

/** Docked feedback and sheets (≈ 0 −10px 30px at 10–12 %). */
export const dockShadow = {
  shadowColor: '#3C2814',
  shadowOpacity: 0.1,
  shadowRadius: 15,
  shadowOffset: { width: 0, height: -10 },
  elevation: 8,
} as const;

/** Primary buttons: a quiet navy lift. */
export const buttonShadow = {
  shadowColor: '#141E32',
  shadowOpacity: 0.16,
  shadowRadius: 8,
  shadowOffset: { width: 0, height: 4 },
  elevation: 2,
} as const;

// Bundled faces: Plus Jakarta Sans for Indonesian UI, Noto Naskh Arabic for every Arabic run. Each weight
// is its own family name (no fontWeight with these faces: that would synthesise a faux bold). The web
// lists a system fallback; on native an unloaded face falls back to the system font by itself.
const face = (name: string, fallback: string) => (Platform.OS === 'web' ? `${name}, ${fallback}` : name);
const LATIN_FALLBACK = "system-ui, -apple-system, 'Segoe UI', sans-serif";
const ARABIC_FALLBACK = "'Geeza Pro', 'Noto Naskh Arabic', serif";

export const fonts = {
  regular: face('PlusJakartaSans_400Regular', LATIN_FALLBACK),
  medium: face('PlusJakartaSans_500Medium', LATIN_FALLBACK),
  semibold: face('PlusJakartaSans_600SemiBold', LATIN_FALLBACK),
  bold: face('PlusJakartaSans_700Bold', LATIN_FALLBACK),
  extrabold: face('PlusJakartaSans_800ExtraBold', LATIN_FALLBACK),
  arabic: face('NotoNaskhArabic_400Regular', ARABIC_FALLBACK),
  arabicMedium: face('NotoNaskhArabic_500Medium', ARABIC_FALLBACK),
};

/** Type hierarchy. Indonesian text is pinned LTR so a line that starts with Arabic is not flipped. */
export const typography = StyleSheet.create({
  display: { fontFamily: fonts.extrabold, fontSize: 34, lineHeight: 40, letterSpacing: -0.8, color: colors.ink, writingDirection: 'ltr', textAlign: 'left' },
  title: { fontFamily: fonts.extrabold, fontSize: 28, lineHeight: 34, letterSpacing: -0.5, color: colors.ink, writingDirection: 'ltr', textAlign: 'left' },
  screenTitle: { fontFamily: fonts.extrabold, fontSize: 26, lineHeight: 32, letterSpacing: -0.5, color: colors.ink, writingDirection: 'ltr', textAlign: 'left' },
  heading: { fontFamily: fonts.extrabold, fontSize: 19, lineHeight: 26, color: colors.ink, writingDirection: 'ltr', textAlign: 'left' },
  body: { fontFamily: fonts.regular, fontSize: 17, lineHeight: 27, color: colors.text, writingDirection: 'ltr', textAlign: 'left' },
  option: { fontFamily: fonts.medium, fontSize: 17, lineHeight: 24, color: colors.ink, writingDirection: 'ltr', textAlign: 'left' },
  label: { fontFamily: fonts.bold, fontSize: 15, lineHeight: 22, color: colors.ink, writingDirection: 'ltr', textAlign: 'left' },
  small: { fontFamily: fonts.regular, fontSize: 14, lineHeight: 21, color: colors.text, writingDirection: 'ltr', textAlign: 'left' },
  caption: { fontFamily: fonts.semibold, fontSize: 13, lineHeight: 18, color: colors.muted, writingDirection: 'ltr', textAlign: 'left' },
  eyebrow: {
    fontFamily: fonts.extrabold,
    fontSize: 13,
    lineHeight: 18,
    letterSpacing: 1,
    textTransform: 'uppercase',
    color: colors.accent,
    writingDirection: 'ltr',
    textAlign: 'left',
  },
});
