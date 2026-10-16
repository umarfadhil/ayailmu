import type { LessonScreen } from '@/content/schema';
import { colors } from './theme';
import { Card, ClueBlock, ConstructedLabel, Eyebrow, ExampleBlock, MixedText } from './components';
import type { RefObject } from 'react';
import { View } from 'react-native';

/** Lesson screen as an S19–S22 topic card. Text comes only from the content pack. */
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
  headingRef?: RefObject<View | null>;
}) {
  return (
    <Card accent={colors.topicBar} testID="lesson-panel">
      {eyebrow ? <Eyebrow>{eyebrow}</Eyebrow> : null}
      <View ref={headingRef} tabIndex={-1} testID="lesson-heading">
        <MixedText header scale={scale} testID="lesson-title" style={{ fontSize: 24, lineHeight: 32, fontWeight: '800', color: colors.ink }}>
          {screen.title}
        </MixedText>
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
        <View style={{ gap: 8 }}>
          {screen.examples.map((ex) => (
            <ExampleBlock key={ex.arabic} arabic={ex.arabic} gloss={ex.gloss} scale={scale} />
          ))}
          <ConstructedLabel />
        </View>
      ) : null}
    </Card>
  );
}
