import * as React from "react";

import {
  CategoryScoreBars,
  OverallScoreCard,
  PeerDistributionChart,
  ScoreRadarChart,
} from "./ReportCharts.js";
import {
  createShareSummary,
  formatOrdinal,
  type ScreenplayReport as ScreenplayReportData,
} from "./report-model.js";

export interface ScreenplayReportProps {
  report: ScreenplayReportData;
}

export function requestPdfDownload(printReport: () => void = () => window.print()): void {
  printReport();
}

function ResourceIcon({
  name,
}: {
  name: "methodology" | "help" | "technical" | "download" | "share";
}) {
  return (
    <svg viewBox="0 0 20 20" aria-hidden="true">
      {name === "methodology" ? (
        <>
          <path d="M3 4.5c2.8-.9 5.1-.3 7 1.3v10c-1.9-1.6-4.2-2.2-7-1.3v-10Z" />
          <path d="M17 4.5c-2.8-.9-5.1-.3-7 1.3v10c1.9-1.6 4.2-2.2 7-1.3v-10Z" />
        </>
      ) : name === "help" ? (
        <>
          <circle cx="10" cy="10" r="7.5" />
          <path d="M7.8 7.5a2.3 2.3 0 1 1 3.2 2.1c-.8.4-1 1-1 1.8M10 14.5h.01" />
        </>
      ) : name === "technical" ? (
        <>
          <path d="m7 5-5 5 5 5M13 5l5 5-5 5M11.5 2.5l-3 15" />
        </>
      ) : name === "download" ? (
        <>
          <path d="M5 2.5h7l3 3V17.5H5v-15Z" />
          <path d="M12 2.5v3h3M10 8v6M7.5 11.5 10 14l2.5-2.5" />
        </>
      ) : (
        <>
          <circle cx="5" cy="10" r="2" />
          <circle cx="14.5" cy="5" r="2" />
          <circle cx="14.5" cy="15" r="2" />
          <path d="m6.8 9 5.8-3M6.8 11l5.8 3" />
        </>
      )}
    </svg>
  );
}

const formatDate = (value?: string): string | null => {
  if (!value) return null;
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return null;
  return new Intl.DateTimeFormat("en-US", {
    year: "numeric",
    month: "long",
    day: "numeric",
  }).format(date);
};

export function ScreenplayReport({ report }: ScreenplayReportProps) {
  const [copyState, setCopyState] = React.useState<"idle" | "copied" | "failed">("idle");
  const analyzedDate = formatDate(report.analyzedAt);
  const strongest = report.categories.reduce((best, category) =>
    category.score > best.score ? category : best,
  );
  const lowest = report.categories.reduce((worst, category) =>
    category.score < worst.score ? category : worst,
  );
  const comparableCategories = report.categories.filter((category) => category.mean !== undefined);
  const categoriesAboveMean = comparableCategories.filter(
    (category) => category.mean !== undefined && category.score > category.mean,
  ).length;

  const shareSummary = async () => {
    const text = createShareSummary(report);
    try {
      if (navigator.share) {
        await navigator.share({ title: `${report.title} — Loglisted Score`, text });
      } else {
        await navigator.clipboard.writeText(text);
      }
      setCopyState("copied");
      window.setTimeout(() => setCopyState("idle"), 2500);
    } catch {
      setCopyState("failed");
    }
  };

  return (
    <section
      className="loglisted-report"
      aria-labelledby="screenplay-report-title"
      id="screenplay-report"
    >
      {report.evaluationMode === "mock" ? (
        <p className="loglisted-report__mock-notice" role="status">
          Mock evaluation — these scores are for interface testing, not a genuine screenplay
          evaluation.
        </p>
      ) : null}

      <header className="loglisted-report__header">
        <div>
          <p className="loglisted-report__wordmark">Loglisted.</p>
          <p className="loglisted-report__eyebrow">Screenplay score</p>
          <h2 id="screenplay-report-title">{report.title}</h2>
        </div>
        <span
          className={`loglisted-report__status loglisted-report__status--${report.status.toLowerCase()}`}
        >
          {report.status}
        </span>
        <dl className="loglisted-report__metadata">
          <div>
            <dt>Format:</dt>
            <dd>{report.format}</dd>
          </div>
          <div>
            <dt>Genre:</dt>
            <dd>{report.genre}</dd>
          </div>
          {report.pageCount !== undefined ? (
            <div>
              <dt>Length:</dt>
              <dd>{report.pageCount} pages</dd>
            </div>
          ) : null}
          {analyzedDate ? (
            <div>
              <dt>Analyzed:</dt>
              <dd>{analyzedDate}</dd>
            </div>
          ) : null}
        </dl>
      </header>

      <div className="loglisted-report__layout">
        <aside className="loglisted-report__sidebar" aria-label="Report resources">
          <div className="loglisted-report__resources" aria-label="Additional resources">
            <a href="/methodology" target="_blank" rel="noopener noreferrer">
              <ResourceIcon name="methodology" />
              <span>Methodology</span>
            </a>
            <a href="/faq" target="_blank" rel="noopener noreferrer">
              <ResourceIcon name="help" />
              <span>Help</span>
            </a>
            <a
              href="https://github.com/mikeross-git/loglisted"
              target="_blank"
              rel="noopener noreferrer"
            >
              <ResourceIcon name="technical" />
              <span>Technical Suggestions</span>
            </a>
          </div>
          <button
            className="loglisted-report__icon-action loglisted-report__download"
            type="button"
            onClick={() => requestPdfDownload()}
          >
            <ResourceIcon name="download" />
            <span>Download PDF Report</span>
          </button>
        </aside>

        <main className="loglisted-report__main" id="report-overview">
          <div className="loglisted-report__top-grid">
            <OverallScoreCard report={report} />
            <PeerDistributionChart report={report} />
          </div>

          {report.cohort?.fallbackReason ? (
            <p className="loglisted-report__benchmark-note">
              <strong>Benchmark note:</strong> {report.cohort.fallbackReason}
            </p>
          ) : null}

          <div className="loglisted-report__analysis-grid">
            <CategoryScoreBars report={report} />
            <ScoreRadarChart report={report} />
          </div>

          <section className="loglisted-report__summary" aria-labelledby="report-summary-title">
            <h3 id="report-summary-title">At a glance</h3>
            <div className="loglisted-report__summary-grid">
              <article>
                <span>Strongest category</span>
                <strong>
                  {strongest.label} — {strongest.score.toFixed(1)}
                </strong>
              </article>
              <article>
                <span>Lowest category</span>
                <strong>
                  {lowest.label} — {lowest.score.toFixed(1)}
                </strong>
              </article>
              <article>
                <span>Peer standing</span>
                <strong>
                  {report.overallPercentile !== undefined
                    ? `${
                        report.cohort?.source === "methodology_assumption" ? "Loglisted model " : ""
                      }${formatOrdinal(report.overallPercentile)} percentile`
                    : "Not enough peer data"}
                </strong>
              </article>
              <article>
                <span>Above peer mean</span>
                <strong>
                  {comparableCategories.length
                    ? `${categoriesAboveMean} of ${comparableCategories.length} categories`
                    : "Not enough peer data"}
                </strong>
              </article>
            </div>
          </section>

          <div className="loglisted-report__actions">
            <button
              className="loglisted-report__icon-action"
              type="button"
              onClick={() => requestPdfDownload()}
            >
              <ResourceIcon name="download" />
              <span>Download PDF Report</span>
            </button>
            <button
              type="button"
              className="loglisted-report__secondary-action loglisted-report__icon-action"
              onClick={() => void shareSummary()}
            >
              <ResourceIcon name="share" />
              <span>{copyState === "copied" ? "Shared" : "Share on Socials"}</span>
            </button>
            {copyState === "failed" ? (
              <span role="alert">The share action could not be completed. Please try again.</span>
            ) : null}
          </div>
        </main>
      </div>
    </section>
  );
}
