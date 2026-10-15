import type { LessonScreen } from '@/content/schema';
import { colors } from './theme';
import { Card, ClueBlock, ConstructedLabel, Eyebrow, ExampleBlock, P } from './components';
import { Text, View } from 'react-native';

/** Lesson screen as an S19–S22 topic card. Text comes only from the content pack. */
export function LessonPanel({ screen, scale, eyebrow }: { screen: LessonScreen; scale: number; eyebrow?: string }) {
  return (
    <Card accent={colors.topicBar} testID="lesson-panel">
      {eyebrow ? <Eyebrow>{eyebrow}</Eyebrow> : null}
      <Text accessibilityRole="header" testID="lesson-title" style={{ fontSize: 24, lineHeight: 32, fontWeight: '800', color: colors.ink, writingDirection: 'ltr', textAlign: 'left' }}>
        {screen.title}
      </Text>
      {screen.body.map((b, i) => (i === screen.clue_paragraph ? <ClueBlock key={b}>{b}</ClueBlock> : <P key={b}>{b}</P>))}
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
