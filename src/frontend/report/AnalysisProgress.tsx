import { useEffect, useMemo, useState } from "react";
import type { UploaderPhase } from "../types.js";
import { categoryDefinitions } from "./report-model.js";

export type EvaluationState = "queued" | "active" | "complete" | "failed";

export interface EvaluationProgressItem {
  label: string;
  state: EvaluationState;
}

export function mapAnalysisProgress(
  _phase: UploaderPhase,
  elapsedMilliseconds: number,
  completed = false,
): {
  percentage: number;
  currentLabel: string;
  items: EvaluationProgressItem[];
} {
  if (completed) {
    return {
      percentage: 100,
      currentLabel: "Analysis complete",
      items: categoryDefinitions.map(({ label }) => ({
        label: `Analyzing ${label}`,
        state: "complete" as const,
      })),
    };
  }
  const elapsedRatio = Math.min(1, Math.max(0, elapsedMilliseconds) / 9_000);
  const percentage = Math.min(95, Math.round(5 + elapsedRatio * 90));
  const activeIndex = Math.min(9, Math.floor((percentage - 5) / 9));
  const items = categoryDefinitions.map(({ label }, index) => ({
    label: `Analyzing ${label}`,
    state:
      index < activeIndex
        ? ("complete" as const)
        : index === activeIndex
          ? ("active" as const)
          : ("queued" as const),
  }));
  return {
    percentage,
    currentLabel: items[activeIndex]?.label ?? "Analyzing screenplay",
    items,
  };
}

export function AnalysisProgress({
  phase,
  startedAt,
  completed = false,
  failed = false,
}: {
  phase: UploaderPhase;
  startedAt: number;
  completed?: boolean;
  failed?: boolean;
}) {
  const [elapsed, setElapsed] = useState(0);

  useEffect(() => {
    const update = () => {
      if (document.visibilityState !== "hidden") setElapsed(Date.now() - startedAt);
    };
    update();
    const interval = window.setInterval(update, 750);
    return () => window.clearInterval(interval);
  }, [startedAt]);

  const progress = useMemo(
    () => mapAnalysisProgress(phase, elapsed, completed),
    [completed, elapsed, phase],
  );
  const items = failed
    ? progress.items.map((item) =>
        item.state === "active" ? { ...item, state: "failed" as const } : item,
      )
    : progress.items;

  return (
    <section
      className="loglisted-analysis-progress"
      aria-labelledby="loglisted-analysis-progress-title"
    >
      <header className="loglisted-analysis-progress__header">
        <p className="loglisted-report__eyebrow">Loglisted Screenplay Analysis</p>
        <h2 id="loglisted-analysis-progress-title">Analyzing your screenplay</h2>
        <p>This may take up to 2 minutes</p>
      </header>
      <div className="loglisted-analysis-progress__layout">
        <ol className="loglisted-analysis-progress__list" aria-label="Evaluation categories">
          {items.map((item) => (
            <li
              className={`loglisted-analysis-progress__item loglisted-analysis-progress__item--${item.state}`}
              key={item.label}
            >
              <span className="loglisted-analysis-progress__marker" aria-hidden="true" />
              <span>{item.label}</span>
              <small>
                {item.state === "active"
                  ? "In progress"
                  : item.state === "failed"
                    ? "Interrupted"
                    : item.state === "complete"
                      ? "Complete"
                      : "Queued"}
              </small>
            </li>
          ))}
        </ol>
        <div
          className="loglisted-analysis-progress__visual"
          role="progressbar"
          aria-label="Screenplay analysis progress"
          aria-valuemin={0}
          aria-valuemax={100}
          aria-valuenow={progress.percentage}
          aria-valuetext={`${progress.percentage}%; ${progress.currentLabel}`}
        >
          <div className="loglisted-analysis-progress__halo" aria-hidden="true">
            <span />
            <span />
            <span />
          </div>
          <div
            className="loglisted-analysis-progress__ring"
            style={
              { "--loglisted-progress": `${progress.percentage * 3.6}deg` } as React.CSSProperties
            }
          >
            <strong>{progress.percentage}%</strong>
            <span>{completed ? "Complete" : "Estimated"}</span>
            <small>{progress.currentLabel}</small>
          </div>
        </div>
      </div>
      <p className="loglisted-analysis-progress__message">
        Your screenplay is being scored across premise, story, structure, characters, dialogue,
        pacing, theme, tone, marketability, and craft.
      </p>
      <p className="loglisted-analysis-progress__disclosure">
        Progress is estimated while the secure analysis request is running. Category-level backend
        status is not currently available.
      </p>
    </section>
  );
}
