import { useFocusEffect } from "expo-router";
import { useCallback, useState } from "react";

import { classifySnapshot, legacyHistory, type SnapshotStatus } from "@/engine/controller";
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

type App = ReturnType<typeof useApp>;

/** A published state tagged with the selection that produced it. */
interface Owned {
  value: LearningState;
  store: App["store"];
  learnerId: string | null;
  dataset: App["dataset"];
  content: App["content"];
  rules: App["rules"];
}

export function useLearning(): LearningState {
  const { store, content, rules, dataset, learner: selected } = useApp();
  const learnerId = selected?.learner_id ?? null;
  const [owned, setOwned] = useState<Owned | undefined>(undefined);
  useFocusEffect(
    useCallback(() => {
      let alive = true;
      const setData = (value: LearningState) =>
        setOwned({ value, store, learnerId, dataset, content, rules });
      // A new focused read starts empty: the previous projection is never shown while it waits.
      setOwned(undefined);
      (async () => {
        try {
          if (!store || content.empty) return;
          const learner = await store.getLearner();
          if (!learner) {
            if (alive) setData(null);
            return;
          }
          // The learner's own Unit A pilot answers are not legacy progress; everything else is projected as stored.
          const answers = legacyHistory(await store.listAnswers(), learner.learner_id);
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
    }, [store, content, rules, learnerId, dataset]),
  );
  // Only the current selection's own state is returned; anything else reads as still loading.
  if (
    !owned ||
    !store ||
    content.empty ||
    owned.store !== store ||
    owned.learnerId !== learnerId ||
    owned.dataset !== dataset ||
    owned.content !== content ||
    owned.rules !== rules
  )
    return undefined;
  return owned.value;
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

const DAYS_SHORT = ["Min", "Sen", "Sel", "Rab", "Kam", "Jum", "Sab"];
const MONTHS_LONG = [
  "Januari",
  "Februari",
  "Maret",
  "April",
  "Mei",
  "Juni",
  "Juli",
  "Agustus",
  "September",
  "Oktober",
  "November",
  "Desember",
];

/** «Jumat, 16 Okt», or «hari ini» when the date is today (or overdue). */
export function formatDue(iso: string, today: string): string {
  if (iso <= today) return "hari ini";
  const d = new Date(`${iso}T00:00:00Z`);
  return `${DAYS[d.getUTCDay()]}, ${d.getUTCDate()} ${MONTHS[d.getUTCMonth()]}`;
}

/** Compact form for state chips: «Sab, 24 Okt», or «hari ini» when the date is today (or overdue). */
export function formatDueShort(iso: string, today: string): string {
  if (iso <= today) return "hari ini";
  const d = new Date(`${iso}T00:00:00Z`);
  return `${DAYS_SHORT[d.getUTCDay()]}, ${d.getUTCDate()} ${MONTHS[d.getUTCMonth()]}`;
}

/** A local calendar date written out: «Minggu, 18 Oktober». */
export function formatLongDate(iso: string): string {
  const d = new Date(`${iso}T00:00:00Z`);
  return `${DAYS[d.getUTCDay()]}, ${d.getUTCDate()} ${MONTHS_LONG[d.getUTCMonth()]}`;
}
