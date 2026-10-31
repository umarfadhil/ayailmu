import type { RefObject } from 'react';
import { StyleSheet, View, type ViewInstance } from 'react-native';

import type { LessonScreen } from '@/content/schema';
import { ClueBlock, ConstructedLabel, Eyebrow, ExampleGrid, MixedText } from './components';
import { colors, fonts } from './theme';

/**
 * Lesson screen (S19–S22 topic → clue → example anatomy) on the paper ground, shared by the session
 * and the Guide. Text comes only from the content pack.
 */
export function LessonPanel({
  screen,
  scale,
  eyebrow,
  headingRef,
}: {
  screen: LessonScreen;
  scale: number;
  eyebrow?: string;
  /** Focus target when a new lesson screen is shown (UI-01). */
  headingRef?: RefObject<ViewInstance | null>;
}) {
  return (
    <View testID="lesson-panel" style={styles.panel}>
      <View style={styles.head}>
        {eyebrow ? <Eyebrow tone="accent">{eyebrow}</Eyebrow> : null}
        <View ref={headingRef} tabIndex={-1} testID="lesson-heading">
          <MixedText header scale={scale} testID="lesson-title" style={styles.title}>
            {screen.title}
          </MixedText>
        </View>
      </View>
      {screen.body.map((b, i) =>
        i === screen.clue_paragraph ? (
          <ClueBlock key={b} scale={scale}>
            {b}
          </ClueBlock>
        ) : (
          <MixedText key={b} scale={scale}>
            {b}
          </MixedText>
        )
      )}
      {screen.examples?.length ? (
        <View style={styles.examples}>
          <ExampleGrid examples={screen.examples} scale={scale} />
          <ConstructedLabel />
        </View>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  panel: { gap: 16 },
  head: { gap: 8 },
  title: { fontFamily: fonts.extrabold, fontSize: 28, lineHeight: 34, letterSpacing: -0.5, color: colors.ink },
  examples: { gap: 10 },
});
