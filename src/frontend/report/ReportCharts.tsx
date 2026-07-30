import type { ScreenplayReport } from "./report-model.js";
import { formatOrdinal } from "./report-model.js";

function CategoryIcon({ category }: { category: string }) {
  const paths: Record<string, React.ReactNode> = {
    premise: (
      <>
        <circle cx="8" cy="7" r="3" />
        <path d="M6.5 11h3M7 13h2M8 1v2M2.8 3l1.4 1.4M13.2 3l-1.4 1.4" />
      </>
    ),
    story: (
      <path d="M2 3.5c2.3-.7 4.3-.2 6 1.2v8c-1.7-1.4-3.7-1.9-6-1.2v-8Zm12 0c-2.3-.7-4.3-.2-6 1.2v8c1.7-1.4 3.7-1.9 6-1.2v-8Z" />
    ),
    structure: (
      <>
        <circle cx="3" cy="4" r="1.5" />
        <circle cx="13" cy="4" r="1.5" />
        <circle cx="8" cy="12" r="1.5" />
        <path d="m4.4 4.7 2.7 5.8m4.5-5.8-2.7 5.8M4.5 4h7" />
      </>
    ),
    characters: (
      <>
        <circle cx="6" cy="5" r="2.2" />
        <circle cx="11.5" cy="6" r="1.7" />
        <path d="M2.5 13c.4-3 2-4.5 4.2-4.5S10.5 10 11 13m-.8-3.6c2.2-.3 3.3 1 3.6 3.2" />
      </>
    ),
    dialogue: <path d="M2 3h12v8H7l-3.5 2v-2H2V3Zm3 3h6M5 8h4" />,
    pacing: <path d="m9.5 1.8-5.8 7h4l-1.2 5.4 5.8-7h-4l1.2-5.4Z" />,
    theme: <path d="M8 1.5 14 8l-6 6.5L2 8l6-6.5Zm0 3.2L5.1 8 8 11.3 10.9 8 8 4.7Z" />,
    tone: (
      <>
        <circle cx="8" cy="8" r="6" />
        <path d="M5 6.5h.1M10.9 6.5h.1M5.3 10c1.7 1.6 3.7 1.6 5.4 0" />
      </>
    ),
    marketability: (
      <>
        <circle cx="8" cy="8" r="5.5" />
        <circle cx="8" cy="8" r="2.5" />
        <path d="m10 6 3.5-3.5M11.5 2.5h2v2" />
      </>
    ),
    craft: (
      <path d="m3 12.8.8-3.4 7.5-7.5 2.8 2.8-7.5 7.5-3.6.6Zm6.9-9.5 2.8 2.8M3.8 9.4l2.8 2.8" />
    ),
  };
  return (
    <svg className="loglisted-category-icon" viewBox="0 0 16 16" aria-hidden="true">
      {paths[category]}
    </svg>
  );
}

export function OverallScoreCard({ report }: { report: ScreenplayReport }) {
  const rotation = report.overallScore * 36;
  return (
    <section
      className="loglisted-report-card loglisted-overall-card"
      aria-labelledby="overall-title"
    >
      <h3 id="overall-title">Overall score</h3>
      <div
        className="loglisted-overall-card__ring"
        style={{ "--loglisted-score-angle": `${rotation}deg` } as React.CSSProperties}
        aria-label={`${report.overallScore.toFixed(1)} out of 10`}
      >
        <strong>{report.overallScore.toFixed(1)}</strong>
        <span>/ 10</span>
      </div>
      {report.overallPercentile !== undefined && report.cohort && (
        <div className="loglisted-overall-card__benchmark">
          <strong>{formatOrdinal(report.overallPercentile)} percentile</strong>
          <span>
            {report.cohort.source === "methodology_assumption"
              ? "Versus the Loglisted model of expected emerging writer script scores"
              : `Higher than ${Math.round(report.overallPercentile)}% of ${report.cohort.label}`}
          </span>
        </div>
      )}
    </section>
  );
}

export function PeerDistributionChart({ report }: { report: ScreenplayReport }) {
  const distribution = report.cohort?.distribution;
  if (!distribution?.length) {
    return (
      <section className="loglisted-report-card loglisted-chart-card">
        <h3>Peer distribution</h3>
        <div className="loglisted-chart-empty" role="status">
          <strong>Not enough peer data</strong>
          <span>
            Observed score distributions are not yet available for this exact Format/Genre cohort.
          </span>
        </div>
      </section>
    );
  }
  const width = 640;
  const height = 250;
  const inset = 32;
  const maximum = Math.max(...distribution.map((point) => point.count), 1);
  const points = distribution
    .map((point) => {
      const x = inset + (point.score / 10) * (width - inset * 2);
      const y = height - inset - (point.count / maximum) * (height - inset * 2);
      return `${x},${y}`;
    })
    .join(" ");
  const markerX = inset + (report.overallScore / 10) * (width - inset * 2);
  return (
    <section className="loglisted-report-card loglisted-chart-card">
      <div className="loglisted-report-card__heading">
        <h3>Peer distribution</h3>
        {report.cohort?.sampleSize && (
          <span>
            {report.cohort.sampleSizeKind === "illustrative" ? "Loglisted model: " : "n = "}
            {report.cohort.sampleSize.toLocaleString()}
          </span>
        )}
      </div>
      <svg
        className="loglisted-distribution-chart"
        viewBox={`0 0 ${width} ${height}`}
        role="img"
        aria-labelledby="distribution-title distribution-description"
      >
        <title id="distribution-title">Peer score distribution</title>
        <desc id="distribution-description">
          {`The screenplay scored ${report.overallScore.toFixed(1)} out of 10. ${
            report.cohort?.label ?? "Peer"
          } mean is ${report.cohort?.mean?.toFixed(1) ?? "unavailable"} and median is ${
            report.cohort?.median?.toFixed(1) ?? "unavailable"
          }.`}
        </desc>
        <line x1={inset} y1={height - inset} x2={width - inset} y2={height - inset} />
        <polyline className="loglisted-distribution-chart__area" points={points} />
        <line
          className="loglisted-distribution-chart__marker"
          x1={markerX}
          x2={markerX}
          y1={24}
          y2={height - inset}
        />
        <text x={markerX} y={18} textAnchor="middle">
          {report.overallScore.toFixed(1)}
        </text>
        {[0, 2, 4, 6, 8, 10].map((tick) => (
          <text
            className="loglisted-distribution-chart__tick"
            x={inset + (tick / 10) * (width - inset * 2)}
            y={height - 8}
            textAnchor="middle"
            key={tick}
          >
            {tick}
          </text>
        ))}
      </svg>
      <dl className="loglisted-chart-stats">
        <div>
          <dt>Mean</dt>
          <dd>{report.cohort?.mean?.toFixed(1) ?? "—"}</dd>
        </div>
        <div>
          <dt>Median</dt>
          <dd>{report.cohort?.median?.toFixed(1) ?? "—"}</dd>
        </div>
        <div>
          <dt>Percentile</dt>
          <dd>
            {report.overallPercentile === undefined ? "—" : formatOrdinal(report.overallPercentile)}
          </dd>
        </div>
        <div>
          <dt>Top 10% starts</dt>
          <dd>
            {report.cohort?.topDecileThreshold === undefined
              ? "—"
              : `${report.cohort.topDecileThreshold.toFixed(1)}+`}
          </dd>
        </div>
      </dl>
      {report.cohort?.source === "methodology_assumption" ? (
        <p className="loglisted-chart-note">
          The modeled top 10% includes scores of 8.0+ and the upper portion of the 7.0–7.9 band.
        </p>
      ) : null}
    </section>
  );
}

export function CategoryScoreBars({ report }: { report: ScreenplayReport }) {
  return (
    <section className="loglisted-report-card loglisted-category-card">
      <div className="loglisted-report-card__heading">
        <h3>Category scores</h3>
        <span>Score out of 10</span>
      </div>
      <div className="loglisted-category-bars">
        {report.categories.map((category) => {
          const difference =
            category.mean === undefined ? undefined : category.score - category.mean;
          return (
            <div className="loglisted-category-row" key={category.key}>
              <div className="loglisted-category-row__label">
                <CategoryIcon category={category.key} />
                <span>
                  <strong>{category.label}</strong>
                  {difference !== undefined && (
                    <small>
                      {difference >= 0 ? "Above" : "Below"}{" "}
                      {report.cohort?.source === "methodology_assumption"
                        ? "Loglisted model"
                        : "peer"}{" "}
                      mean by {Math.abs(difference).toFixed(1)}
                    </small>
                  )}
                </span>
              </div>
              <div
                className="loglisted-category-row__track"
                role="meter"
                aria-label={`${category.label}: ${category.score.toFixed(1)} out of 10`}
                aria-valuemin={0}
                aria-valuemax={10}
                aria-valuenow={category.score}
              >
                <span style={{ width: `${category.score * 10}%` }} />
                {category.mean !== undefined && (
                  <i
                    style={{ left: `${category.mean * 10}%` }}
                    title={`Peer mean ${category.mean.toFixed(1)}`}
                  />
                )}
              </div>
              <strong className="loglisted-category-row__score">{category.score.toFixed(1)}</strong>
              <span className="loglisted-category-row__percentile">
                {category.percentile === undefined
                  ? "No peer data"
                  : `${formatOrdinal(category.percentile)} percentile`}
              </span>
            </div>
          );
        })}
      </div>
    </section>
  );
}

export function ScoreRadarChart({ report }: { report: ScreenplayReport }) {
  const hasPeerMeans = report.categories.every((category) => category.mean !== undefined);
  if (!hasPeerMeans) {
    return (
      <section className="loglisted-report-card loglisted-chart-card">
        <h3>Score profile</h3>
        <div className="loglisted-chart-empty" role="status">
          <strong>Peer profile unavailable</strong>
          <span>
            Category-level means are needed to compare this screenplay with its exact cohort.
          </span>
        </div>
      </section>
    );
  }
  const size = 420;
  const center = size / 2;
  const radius = 142;
  const point = (index: number, value: number) => {
    const angle = (Math.PI * 2 * index) / report.categories.length - Math.PI / 2;
    const scaled = (value / 10) * radius;
    return [center + Math.cos(angle) * scaled, center + Math.sin(angle) * scaled] as const;
  };
  const scriptPoints = report.categories
    .map((category, index) => point(index, category.score).join(","))
    .join(" ");
  const peerPoints = report.categories
    .map((category, index) => point(index, category.mean ?? 0).join(","))
    .join(" ");
  return (
    <section className="loglisted-report-card loglisted-chart-card">
      <h3>Score profile</h3>
      <svg
        className="loglisted-radar-chart"
        viewBox={`0 0 ${size} ${size}`}
        role="img"
        aria-labelledby="radar-title radar-description"
      >
        <title id="radar-title">Screenplay category score profile</title>
        <desc id="radar-description">
          Gold shows this screenplay and the dashed line shows the peer mean. Exact values are
          listed in the category score table.
        </desc>
        {[2, 4, 6, 8, 10].map((level) => (
          <polygon
            className="loglisted-radar-chart__grid"
            points={report.categories
              .map((_category, index) => point(index, level).join(","))
              .join(" ")}
            key={level}
          />
        ))}
        {report.categories.map((category, index) => {
          const [x, y] = point(index, 10);
          const [labelX, labelY] = point(index, 11.4);
          return (
            <g key={category.key}>
              <line className="loglisted-radar-chart__axis" x1={center} y1={center} x2={x} y2={y} />
              <text x={labelX} y={labelY} textAnchor="middle">
                {category.label}
              </text>
            </g>
          );
        })}
        <polygon className="loglisted-radar-chart__peer" points={peerPoints} />
        <polygon className="loglisted-radar-chart__script" points={scriptPoints} />
      </svg>
      <div className="loglisted-chart-legend" aria-hidden="true">
        <span>
          <i /> Your script
        </span>
        <span>
          <i className="loglisted-chart-legend__peer" /> Peer mean
        </span>
      </div>
    </section>
  );
}
