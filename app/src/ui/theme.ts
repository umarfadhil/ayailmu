// Design tokens. Values are sampled from the Sottaku reference captures
// (.design-reference/VISUAL_AUDIT.md); see .design-reference/DESIGN_SPEC.md for the mapping.
export const colors = {
  // Canvas wash: very subtle mint upper-left → peach upper-right → paper.
  canvasMint: '#EDF2EA',
  canvasPeach: '#FAF0E5',
  canvasPaper: '#F7F2EA',

  paper: '#FCF9F4', // S23 menu, S22 bars
  surface: '#FEFBF6', // S05 panels/cards
  white: '#FFFFFF', // S03/S04 study card only
  border: '#E0DCD1', // S18 rows
  borderStrong: '#D3CCBF',
  track: '#E8E4DC',

  ink: '#101F3B', // S01 heading ink
  inkSoft: '#203253', // S22 pill text
  body: '#5A4E42', // warm brown body copy
  muted: '#776B5F',

  navyTop: '#3A5679', // S04 primary button gradient
  navyBottom: '#365174',
  navyPressed: '#2E4566',

  indigo: '#5966D2', // S05 progress, S18 toggle
  indigoText: '#4753B2', // S23 icon indigo (AA on cream for text)
  indigoSoft: '#E7E7F0', // S23 selected group

  mintBg: '#F0F5EF', // S19 "Mark studied" pill background
  mintBorder: '#CFE0D2',
  mintInk: '#306339', // S01 INCLUDED green
  exampleBg: '#F3F6F0', // S19 example block
  exampleBar: '#B1DCCB',
  topicBar: '#A3C7F1', // S19 topic card accent

  clueBg: '#FDF4E2', // S19 Reading clue
  clueBar: '#F8D06C',
  clueInk: '#835E1D',

  infoBg: '#EEF3F9',
  infoBorder: '#CCD9EA',
  infoInk: '#2F4E78',

  dangerBg: '#F8ECEA',
  dangerBorder: '#E5C4C0',
  dangerInk: '#9C3F3B', // from S03 #AA4C48, darkened for text contrast

  unitPanelA: '#EEF5F0', // pale mint/blue Unit panel (concept)
  unitPanelB: '#EEF2F7',
  backdrop: 'rgba(16,31,59,0.32)',
};

export const radius = { sm: 6, md: 8, lg: 12, pill: 999 };

export const DESKTOP_MIN_WIDTH = 1024;
export const SIDEBAR_WIDTH = 232;

/** Restrained elevation (S05/S19 cards). */
export const shadow = {
  shadowColor: '#3B3326',
  shadowOpacity: 0.06,
  shadowRadius: 8,
  shadowOffset: { width: 0, height: 2 },
  elevation: 1,
} as const;
