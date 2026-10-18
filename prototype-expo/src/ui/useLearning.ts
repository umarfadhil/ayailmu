import { useFocusEffect } from "expo-router";
import { useCallback, useState } from "react";

import { classifySnapshot, type SnapshotStatus } from "@/engine/controller";
import { loadScreenViews } from "@/engine/exposure";
import { progress, type Progress } from "@/engine/progress";
import { openUnits, toAttempt } from "@/engine/session";
import { localDate } from "@/engine/util";
import type { AnswerRecord, Learner } from "@/storage/types";
import { useApp } from "./AppContext";

export interface Learning {
  /** Clock reading taken when the projection was built (not during render). */
  now: number;
  today: string;
  learner: Learner;
  answers: AnswerRecord[];
  progress: Progress;
  open: ("A" | "B")[];
  snapshot: SnapshotStatus;
}

/**
 * Read-only learner projection (progress, open units, saved-session status), rebuilt from the
 * durable log each time a screen gains focus. Never writes.
 */
export type LearningState = Learning | null | undefined | { error: string };

export function isLearningError(v: LearningState): v is { error: string } {
  return !!v && "error" in v;
}

export function useLearning(): LearningState {
  const { store, content, rules } = useApp();
  const [data, setData] = useState<LearningState>(undefined);
  useFocusEffect(
    useCallback(() => {
      let alive = true;
      (async () => {
        try {
          if (!store || content.empty) return;
          const learner = await store.getLearner();
          if (!learner) {
            if (alive) setData(null);
            return;
          }
          const answers = await store.listAnswers();
          const raw = await store.loadSnapshotRaw();
          const views = await loadScreenViews(store);
          const now = Date.now();
          const today = localDate(now);
          const attempts = answers.map((r) => toAttempt(r, content));
          if (!alive) return;
          setData({
            now,
            today,
            learner,
            answers,
            progress: progress(
              answers,
              content,
              rules,
              today,
              learner.screens_seen,
              views,
            ),
            open: openUnits(content, rules, attempts, learner.screens_seen),
            snapshot: classifySnapshot(raw, content),
          });
        } catch (e) {
          // Projection over stored data failed: report it (no write), never leave the screen loading.
          if (alive)
            setData({ error: e instanceof Error ? e.message : String(e) });
        }
      })();
      return () => {
        alive = false;
      };
    }, [store, content, rules]),
  );
  return data;
}

const DAYS = ["Minggu", "Senin", "Selasa", "Rabu", "Kamis", "Jumat", "Sabtu"];
const MONTHS = [
  "Jan",
  "Feb",
  "Mar",
  "Apr",
  "Mei",
  "Jun",
  "Jul",
  "Agu",
  "Sep",
  "Okt",
  "Nov",
  "Des",
];

/** «Jumat, 16 Okt», or «hari ini» when the date is today (or overdue). */
export function formatDue(iso: string, today: string): string {
  if (iso <= today) return "hari ini";
  const d = new Date(`${iso}T00:00:00Z`);
  return `${DAYS[d.getUTCDay()]}, ${d.getUTCDate()} ${MONTHS[d.getUTCMonth()]}`;
}
