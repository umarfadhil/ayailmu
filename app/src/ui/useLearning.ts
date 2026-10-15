import { useFocusEffect } from 'expo-router';
import { useCallback, useState } from 'react';

import { classifySnapshot, type SnapshotStatus } from '@/engine/controller';
import { progress, type Progress } from '@/engine/progress';
import { openUnits, toAttempt } from '@/engine/session';
import { localDate } from '@/engine/util';
import type { AnswerRecord, Learner } from '@/storage/types';
import { useApp } from './AppContext';

export interface Learning {
  /** Clock reading taken when the projection was built (not during render). */
  now: number;
  today: string;
  learner: Learner;
  answers: AnswerRecord[];
  progress: Progress;
  open: ('A' | 'B')[];
  snapshot: SnapshotStatus;
}

/**
 * Read-only learner projection (progress, open units, saved-session status), rebuilt from the
 * durable log each time a screen gains focus. Never writes.
 */
export function useLearning(): Learning | null | undefined {
  const { store, content, rules } = useApp();
  const [data, setData] = useState<Learning | null | undefined>(undefined);
  useFocusEffect(
    useCallback(() => {
      let alive = true;
      (async () => {
        if (!store || content.empty) return;
        const learner = await store.getLearner();
        if (!learner) {
          if (alive) setData(null);
          return;
        }
        const answers = await store.listAnswers();
        const raw = await store.loadSnapshotRaw();
        const now = Date.now();
        const today = localDate(now);
        const attempts = answers.map((r) => toAttempt(r, content));
        if (!alive) return;
        setData({
          now,
          today,
          learner,
          answers,
          progress: progress(answers, content, rules, today, learner.screens_seen),
          open: openUnits(content, rules, attempts, learner.screens_seen),
          snapshot: classifySnapshot(raw, content),
        });
      })();
      return () => {
        alive = false;
      };
    }, [store, content, rules])
  );
  return data;
}

const DAYS = ['Minggu', 'Senin', 'Selasa', 'Rabu', 'Kamis', 'Jumat', 'Sabtu'];
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'Mei', 'Jun', 'Jul', 'Agu', 'Sep', 'Okt', 'Nov', 'Des'];

/** «Jumat, 16 Okt», or «hari ini» when the date is today (or overdue). */
export function formatDue(iso: string, today: string): string {
  if (iso <= today) return 'hari ini';
  const d = new Date(`${iso}T00:00:00Z`);
  return `${DAYS[d.getUTCDay()]}, ${d.getUTCDate()} ${MONTHS[d.getUTCMonth()]}`;
}
