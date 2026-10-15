import { loadRules } from '@/config/rules';
import { demoPack } from '@/content/load';
import type { Item } from '@/content/schema';
import { levenshtein, normalize, scoreItem, scoreTyped } from '@/engine/scoring';

const rules = loadRules('developer-demo');
const item = (id: string): Item => {
  const found = demoPack.items.find((i) => i.item_id === id);
  if (!found) throw new Error(`missing fixture ${id}`);
  return found;
};

describe('normalize', () => {
  it('lowercases, trims, strips punctuation and collapses spaces', () => {
    expect(normalize('  Dia   JUJUR!!  ')).toBe('dia jujur');
    expect(normalize("Mu'min.")).toBe('mumin');
    expect(normalize('orang-yang, sabar')).toBe('orang yang sabar');
  });
});

describe('levenshtein', () => {
  it('counts single edits', () => {
    expect(levenshtein('beriman', 'berimen')).toBe(1);
    expect(levenshtein('sabar', 'sabar')).toBe(0);
    expect(levenshtein('jujur', 'jojor')).toBe(2);
  });
});

describe('typed Indonesian answers (Q-MEAN, lessons §2.6)', () => {
  const sadiq = item('DEMO-M01').accepted!;
  const alim = item('DEMO-M02').accepted!;

  it('accepts listed answers inside natural phrasings', () => {
    expect(scoreTyped('jujur', sadiq, rules).status).toBe('correct');
    expect(scoreTyped('Orang yang jujur.', sadiq, rules).status).toBe('correct');
    expect(scoreTyped('berilmu', alim, rules).status).toBe('correct');
    expect(scoreTyped('orang yang mengetahui', alim, rules).status).toBe('correct');
  });

  it('allows one typo only in words of 5+ letters', () => {
    expect(scoreTyped('berilmo', alim, rules).status).toBe('correct');
    // "tahu" is 4 letters: no typo tolerance
    expect(scoreTyped('tahi', alim, rules).status).toBe('pending');
  });

  it('holds "alim" for human check with FA-ALIM', () => {
    const s = scoreTyped('alim', alim, rules);
    expect(s.status).toBe('pending');
    expect(s.feedback_id).toBe('FA-ALIM');
  });

  it('does not accept a negated meaning ("tidak tahu")', () => {
    expect(scoreTyped('tidak tahu', alim, rules).status).not.toBe('correct');
  });

  it('holds unclear answers (no accepted word, no known error) as pending, never wrong', () => {
    expect(scoreTyped('benar', sadiq, rules).status).toBe('pending');
    expect(scoreTyped('xyz', sadiq, rules).status).toBe('pending');
    expect(scoreTyped('', sadiq, rules).status).toBe('pending');
  });
});

describe('sentence meaning (Q-PARA, scored in 3 parts)', () => {
  const p01 = item('DEMO-P01'); // هِيَ مُؤْمِنَةٌ, perempuan

  it('is correct when who, description and describes-not-possesses are all right', () => {
    const s = scoreItem(p01, { kind: 'typed', text: 'Dia orang yang beriman', ref: 'perempuan' }, rules);
    expect(s.outcome).toBe('correct');
    expect(s.parts).toEqual({ who: 'correct', description: 'correct', describes: 'correct' });
    expect(s.serious).toBeNull();
  });

  it('accepts natural non-possession phrasing "orangnya …"', () => {
    const s = scoreItem(item('DEMO-P02'), { kind: 'typed', text: 'orangnya saleh', ref: 'laki-laki' }, rules);
    expect(s.outcome).toBe('correct');
    expect(s.error_tags).toEqual([]);
  });

  it('flags a he/she swap as a serious mistake', () => {
    const s = scoreItem(p01, { kind: 'typed', text: 'dia beriman', ref: 'laki-laki' }, rules);
    expect(s.outcome).toBe('wrong');
    expect(s.parts.who).toBe('wrong');
    expect(s.parts.description).toBe('correct');
    expect(s.serious).toBe('wrong-referent');
    expect(s.feedback_ids).toContain('FA-REF-HIYA');
  });

  it('marks a known possession reading wrong and serious', () => {
    const s = scoreItem(p01, { kind: 'typed', text: 'keimanannya', ref: 'perempuan' }, rules);
    expect(s.outcome).toBe('wrong');
    expect(s.parts.describes).toBe('wrong');
    expect(s.serious).toBe('possession');
    expect(s.feedback_ids).toContain('FA-POS');
  });

  it('marks a known invented action wrong and serious', () => {
    const s = scoreItem(p01, { kind: 'typed', text: 'dia berkata beriman', ref: 'perempuan' }, rules);
    expect(s.outcome).toBe('wrong');
    expect(s.serious).toBe('invented-action');
    expect(s.feedback_ids).toContain('FA-ACT');
  });

  it('holds a generic possession/action flag for human check instead of marking it wrong', () => {
    const poss = scoreItem(p01, { kind: 'typed', text: 'milik dia beriman', ref: 'perempuan' }, rules);
    expect(poss.outcome).toBe('pending');
    expect(poss.parts.describes).toBe('pending');
    expect(poss.error_tags).toContain('possession');
    expect(poss.serious).toBeNull();

    const act = scoreItem(p01, { kind: 'typed', text: 'dia bilang beriman', ref: 'perempuan' }, rules);
    expect(act.outcome).toBe('pending');
    expect(act.error_tags).toContain('invented-action');
  });

  // Regression from independent review: negation separated from the accepted word by other words.
  it.each(['dia tidak beriman', 'dia tidak terlalu beriman', 'dia belum menjadi orang yang beriman'])(
    'never marks a negated paraphrase correct: %s',
    (text) => {
      expect(scoreTyped(text, p01.accepted!, rules).status).toBe('pending');
      const s = scoreItem(p01, { kind: 'typed', text, ref: 'perempuan' }, rules);
      expect(s.outcome).toBe('pending');
      expect(s.parts.description).toBe('pending');
      expect(s.parts.describes).toBe('pending');
    }
  );

  it('affirmative control for the negation regression is still correct', () => {
    expect(scoreTyped('dia beriman', p01.accepted!, rules).status).toBe('correct');
  });

  it('accepts a negation that is part of an accepted term itself', () => {
    const acc = { terms: ['tidak tahu'] };
    expect(scoreTyped('orang yang tidak tahu', acc, rules).status).toBe('correct');
    expect(scoreTyped('bukan orang yang tidak tahu', acc, rules).status).toBe('pending');
  });

  it('treats «Saya belum tahu» as dont_know, not wrong', () => {
    const s = scoreItem(p01, { kind: 'dont_know' }, rules);
    expect(s.outcome).toBe('dont_know');
    expect(s.serious).toBeNull();
  });
});

describe('form choice (Q-FORM2)', () => {
  it('scores the -atun form for perempuan', () => {
    const f01 = item('DEMO-F01');
    expect(scoreItem(f01, { kind: 'choice', option_id: 'b' }, rules).outcome).toBe('correct');
    const wrong = scoreItem(f01, { kind: 'choice', option_id: 'a' }, rules);
    expect(wrong.outcome).toBe('wrong');
    expect(wrong.error_tags).toEqual(['wrong-form']);
    expect(wrong.feedback_ids).toEqual(['FA-FORM']);
    expect(wrong.serious).toBeNull();
  });
});

describe('rules come from config', () => {
  it('changing typo tolerance in config changes scoring without code changes', () => {
    const strict = { ...rules, typo_tolerance: { min_word_length: 5, max_edits: 0 } };
    expect(scoreTyped('berilmo', item('DEMO-M02').accepted!, strict).status).toBe('pending');
  });
});
