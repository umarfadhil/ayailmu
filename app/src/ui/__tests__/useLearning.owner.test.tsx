import { act, renderHook, waitFor } from "@testing-library/react-native";

import { activePack } from "@/content/load";
import { gateContent } from "@/content/gating";
import { loadRules } from "@/config/rules";
import { KvStore, memoryKv } from "@/storage/kvStore";
import type { Learner } from "@/storage/types";
import { isLearningError, useLearning, type LearningState } from "../useLearning";

// Only the app projection and focus wiring are replaced; every read and projection below is the real one.
let mockApp: Record<string, unknown> = {};
jest.mock("../AppContext", () => ({ useApp: () => mockApp }));
jest.mock("expo-router", () => {
  const React = jest.requireActual<typeof import("react")>("react");
  return {
    useFocusEffect: (cb: () => void | (() => void)) => React.useEffect(cb, [cb]),
  };
});

const MODE_KEYS = ["EXPO_PUBLIC_APP_MODE"] as const;
const savedMode: Record<string, string | undefined> = {};
let content: Awaited<ReturnType<typeof gateContent>>;
let rules: Awaited<ReturnType<typeof loadRules>>;

beforeAll(async () => {
  for (const k of MODE_KEYS) {
    savedMode[k] = process.env[k];
    process.env[k] = "developer-demo";
  }
  content = await gateContent(activePack, "developer-demo");
  rules = await loadRules();
});

afterAll(() => {
  for (const k of MODE_KEYS) {
    if (savedMode[k] === undefined) delete process.env[k];
    else process.env[k] = savedMode[k];
  }
});

afterEach(() => jest.restoreAllMocks());

function learner(id: string): Learner {
  return {
    learner_id: id,
    created_at: "2026-10-01T00:00:00.000Z",
    consent_version: "1",
    consent_at: "2026-10-01T00:00:00.000Z",
    age_confirmed: true,
    session_minutes: 10,
    arabic_scale: 1,
    screens_seen: [],
  };
}

/** A real in-memory store holding `id` and no answers, with getLearner observed (still the real read). */
async function fixture(id: string) {
  const store = new KvStore(memoryKv());
  await store.init();
  await store.saveLearner(learner(id));
  const reads = jest.spyOn(store, "getLearner");
  /** Holds the next getLearner until the returned release is called; it then performs the real read. */
  const hold = () => {
    let release!: () => void;
    const gate = new Promise<void>((r) => (release = r));
    reads.mockImplementationOnce(async () => {
      await gate;
      return KvStore.prototype.getLearner.call(store);
    });
    return release;
  };
  return { store, reads, hold };
}

const app = (
  store: KvStore | null,
  id: string | null,
  dataset: "guest" | "account" = "guest",
) => ({
  store,
  content,
  rules,
  dataset,
  learner: id === null ? null : learner(id),
});

function shown(v: LearningState): string | null | undefined {
  if (!v) return v;
  if (isLearningError(v)) return `error: ${v.error}`;
  return v.learner.learner_id;
}

async function mount() {
  return renderHook((_: number) => useLearning(), { initialProps: 0 });
}

describe("useLearning ownership", () => {
  it("hides the settled A projection as soon as the app switches to B's store, then shows B", async () => {
    const a = await fixture("A");
    const b = await fixture("B");
    mockApp = app(a.store, "A", "account");
    const { result, rerender } = await mount();
    await waitFor(() => expect(shown(result.current)).toBe("A"));
    const aReads = a.reads.mock.calls.length;

    const releaseB = b.hold();
    mockApp = app(b.store, "B", "account");
    await rerender(1);
    expect(shown(result.current)).toBeUndefined();

    await act(async () => releaseB());
    await waitFor(() => expect(shown(result.current)).toBe("B"));
    expect(a.reads.mock.calls.length).toBe(aReads);
  });

  it("same store: a learner switch from A to B re-reads and hides A until B's read settles", async () => {
    const s = await fixture("A");
    mockApp = app(s.store, "A");
    const { result, rerender } = await mount();
    await waitFor(() => expect(shown(result.current)).toBe("A"));
    expect(s.reads).toHaveBeenCalledTimes(1);

    await s.store.saveLearner(learner("B"));
    const releaseB = s.hold();
    mockApp = app(s.store, "B");
    await rerender(1);
    expect(s.reads).toHaveBeenCalledTimes(2);
    expect(shown(result.current)).toBeUndefined();

    await act(async () => releaseB());
    await waitFor(() => expect(shown(result.current)).toBe("B"));
  });

  it("a late read for A that settles after B never replaces B", async () => {
    const a = await fixture("A");
    const b = await fixture("B");
    const releaseA = a.hold();
    mockApp = app(a.store, "A", "account");
    const { result, rerender } = await mount();
    expect(shown(result.current)).toBeUndefined();

    mockApp = app(b.store, "B", "account");
    await rerender(1);
    await waitFor(() => expect(shown(result.current)).toBe("B"));

    await act(async () => {
      releaseA();
      await new Promise((r) => setTimeout(r, 0));
    });
    expect(shown(result.current)).toBe("B");
  });

  it("hides the prior projection and reads no old store when the store goes null or content empties", async () => {
    const a = await fixture("A");
    mockApp = app(a.store, "A");
    const { result, rerender } = await mount();
    await waitFor(() => expect(shown(result.current)).toBe("A"));
    expect(a.reads).toHaveBeenCalledTimes(1);

    mockApp = app(null, null);
    await rerender(1);
    expect(shown(result.current)).toBeUndefined();
    expect(a.reads).toHaveBeenCalledTimes(1);

    mockApp = app(a.store, "A");
    await rerender(2);
    await waitFor(() => expect(shown(result.current)).toBe("A"));
    expect(a.reads).toHaveBeenCalledTimes(2);

    mockApp = { ...app(a.store, "A"), content: { ...content, empty: true } };
    await rerender(3);
    expect(shown(result.current)).toBeUndefined();
    expect(a.reads).toHaveBeenCalledTimes(2);
  });
});
