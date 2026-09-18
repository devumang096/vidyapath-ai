import { useCallback, useEffect, useState } from "react";
import { api, type OutcomeResult } from "../lib/callables";
import { formatDuration, newId } from "../lib/format";
import { useAction } from "../hooks/useFirestore";
import { InlineError } from "./ui";
import type { SessionKind } from "../lib/types";

interface TimerState {
  status: "idle" | "running" | "paused";
  startedAt: number | null;
  accumulatedMs: number;
  topicId: string | null;
  kind: SessionKind;
}

const STORAGE_KEY = "eduorbit.timer";
const IDLE: TimerState = { status: "idle", startedAt: null, accumulatedMs: 0, topicId: null, kind: "learning" };

function load(): TimerState {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    return raw ? { ...IDLE, ...(JSON.parse(raw) as Partial<TimerState>) } : IDLE;
  } catch (error) {
    console.warn("Could not restore timer", error);
    return IDLE;
  }
}

function save(state: TimerState): void {
  try {
    if (state.status === "idle") localStorage.removeItem(STORAGE_KEY);
    else localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
  } catch (error) {
    console.warn("Could not save timer", error);
  }
}

function elapsedMs(state: TimerState, now: number): number {
  return state.accumulatedMs + (state.status === "running" && state.startedAt ? now - state.startedAt : 0);
}

/**
 * Real study timer. Start, pause, resume, stop and reset; the running state survives a refresh
 * through localStorage, and only Stop sends the minutes to the server, which caps and validates them.
 */
export function StudyTimer({ topicId = null, kind = "learning", compact = false, onRecorded }: { topicId?: string | null; kind?: SessionKind; compact?: boolean; onRecorded?: (result: OutcomeResult | null, minutes: number) => void }) {
  const [state, setState] = useState<TimerState>(load);
  const [now, setNow] = useState(Date.now());
  const record = useAction(async (minutes: number) => api.recordStudySession({ sessionId: newId(), topicId: state.topicId ?? topicId, minutes, kind: state.kind }));

  useEffect(() => save(state), [state]);
  useEffect(() => {
    if (state.status !== "running") return;
    const timer = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(timer);
  }, [state.status]);

  const elapsed = elapsedMs(state, now);
  const start = useCallback(() => setState({ status: "running", startedAt: Date.now(), accumulatedMs: 0, topicId, kind }), [topicId, kind]);
  const pause = () => setState((previous) => ({ ...previous, status: "paused", accumulatedMs: elapsedMs(previous, Date.now()), startedAt: null }));
  const resume = () => setState((previous) => ({ ...previous, status: "running", startedAt: Date.now() }));
  const reset = () => setState(IDLE);
  async function stop() {
    const minutes = Math.floor(elapsedMs(state, Date.now()) / 60_000);
    if (minutes < 1) {
      reset();
      onRecorded?.(null, 0);
      return;
    }
    const result = await record.run(Math.min(60, minutes));
    if (result) {
      reset();
      onRecorded?.(result.rewards, result.minutesCounted);
    }
  }

  return (
    <div className={compact ? "flex flex-wrap items-center gap-2" : "card"}>
      {!compact && <p className="text-xs font-medium uppercase tracking-wide text-ink-500">Study timer</p>}
      <p className={compact ? "font-mono text-sm font-semibold" : "mt-1 font-mono text-3xl font-bold"} aria-live="off">{formatDuration(Math.floor(elapsed / 1000))}</p>
      <div className={compact ? "flex gap-1" : "mt-3 flex flex-wrap gap-2"}>
        {state.status === "idle" && <button type="button" className="btn-primary" onClick={start}>Start</button>}
        {state.status === "running" && <button type="button" className="btn-secondary" onClick={pause}>Pause</button>}
        {state.status === "paused" && <button type="button" className="btn-primary" onClick={resume}>Resume</button>}
        {state.status !== "idle" && <button type="button" className="btn-secondary" onClick={() => void stop()} disabled={record.busy}>{record.busy ? "Saving..." : "Stop"}</button>}
        {state.status !== "idle" && <button type="button" className="btn-ghost" onClick={reset}>Reset</button>}
      </div>
      {!compact && <p className="mt-2 text-xs text-ink-500">Stop saves whole minutes to your study log (up to 60 per session, 600 per day). 20 minutes a day keeps your streak.</p>}
      <InlineError message={record.error} />
    </div>
  );
}
