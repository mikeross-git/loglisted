import { useEffect, useMemo, useState, type CSSProperties } from "react";
import {
  rankingScoreKeys,
  type PublicRankingRecord,
  type PublicRankingsResponse,
  type RankingScoreKey,
} from "../types/rankings.js";
import { loglistedRankingsStyles } from "./loglisted-rankings-styles.js";

const scoreLabels: Record<RankingScoreKey, string> = {
  overall: "Overall Score",
  premise: "Premise",
  story: "Story",
  structure: "Structure",
  characters: "Characters",
  dialogue: "Dialogue",
  pacing: "Pacing",
  theme: "Theme",
  tone: "Tone",
  marketability: "Marketability",
  craft: "Craft",
};
const pageSizes = [25, 50, 100] as const;
type Direction = "asc" | "desc";

export interface RankingsQuery {
  search: string;
  format: string;
  genre: string;
  scoreKey: RankingScoreKey;
  minimumScore: number | null;
  direction: Direction;
  page: number;
  pageSize: number;
}

export interface ScreenplayRankingsTableProps {
  apiBaseUrl: string;
  style?: CSSProperties;
  profilePathPrefix?: string;
  maxRows?: number;
  initialPageSize?: 25 | 50 | 100;
  backgroundColor?: string;
  textColor?: string;
  mutedTextColor?: string;
  accentColor?: string;
  goldColor?: string;
  borderColor?: string;
  headerColor?: string;
  fontFamily?: string;
  uiFontFamily?: string;
  rowSpacing?: number;
  canvasMode?: boolean;
}

const sampleRecords: PublicRankingRecord[] = [
  {
    id: "sample-1",
    slug: "jules-bishop",
    writerName: "Jules Bishop",
    scriptTitle: "Waking Valley",
    logline:
      "A reluctant heir enters a world of living myths and learns the prophecy naming them was written by an enemy.",
    format: "Half-Hour TV Pilot",
    genre: "Fantasy",
    imdbUrl: "https://www.imdb.com/",
    updatedAt: null,
    scores: {
      overall: 9.1,
      premise: 9.2,
      story: 9,
      structure: 8.9,
      characters: 9.1,
      dialogue: 8.8,
      pacing: 9,
      theme: 9.2,
      tone: 9.1,
      marketability: 9.3,
      craft: 9,
    },
  },
  {
    id: "sample-2",
    slug: "rowan-calloway",
    writerName: "Rowan Calloway",
    scriptTitle: "Orbiting Tomorrow",
    logline: "A maintenance worker receives a message from a future version of herself.",
    format: "Hour TV Pilot",
    genre: "Sci-Fi",
    imdbUrl: null,
    updatedAt: null,
    scores: {
      overall: 9,
      premise: 8.8,
      story: 9.1,
      structure: 9,
      characters: 8.9,
      dialogue: 9,
      pacing: 8.8,
      theme: 9.2,
      tone: 9,
      marketability: 8.9,
      craft: 9.1,
    },
  },
  {
    id: "sample-3",
    slug: "eden-stone",
    writerName: "Eden Stone",
    scriptTitle: "Polite Disaster",
    logline:
      "After a minor cover-up spirals through their perfect suburb, two friends discover that being decent is harder than looking like it.",
    format: "Feature",
    genre: "Dark Comedy",
    imdbUrl: null,
    updatedAt: null,
    scores: {
      overall: 8.9,
      premise: 9,
      story: 8.8,
      structure: 8.7,
      characters: 9,
      dialogue: 9.2,
      pacing: 8.6,
      theme: 8.9,
      tone: 9.1,
      marketability: 8.8,
      craft: 8.9,
    },
  },
];

function isScoreKey(value: string | null): value is RankingScoreKey {
  return value !== null && (rankingScoreKeys as readonly string[]).includes(value);
}

export function queryFromSearchParams(
  params: URLSearchParams,
  defaultPageSize = 25,
): RankingsQuery {
  const minimum = Number(params.get("minScore"));
  const requestedSize = Number(params.get("pageSize"));
  const requestedScore = params.get("score");
  return {
    search: params.get("search") ?? "",
    format: params.get("format") ?? "",
    genre: params.get("genre") ?? "",
    scoreKey: isScoreKey(requestedScore) ? requestedScore : "overall",
    minimumScore:
      params.has("minScore") && Number.isFinite(minimum)
        ? Math.min(10, Math.max(0, minimum))
        : null,
    direction: params.get("direction") === "asc" ? "asc" : "desc",
    page: Math.max(1, Number(params.get("page")) || 1),
    pageSize: pageSizes.includes(requestedSize as 25 | 50 | 100) ? requestedSize : defaultPageSize,
  };
}

export function applyRankingsQuery(
  records: readonly PublicRankingRecord[],
  query: RankingsQuery,
): PublicRankingRecord[] {
  const needle = query.search.trim().toLocaleLowerCase();
  return records
    .filter(
      (record) =>
        !needle ||
        `${record.writerName} ${record.scriptTitle} ${record.logline}`
          .toLocaleLowerCase()
          .includes(needle),
    )
    .filter((record) => !query.format || record.format === query.format)
    .filter((record) => !query.genre || record.genre === query.genre)
    .filter(
      (record) =>
        query.minimumScore === null ||
        (record.scores[query.scoreKey] ?? -Infinity) >= query.minimumScore,
    )
    .sort((a, b) => {
      const left = a.scores[query.scoreKey];
      const right = b.scores[query.scoreKey];
      if (left === null && right === null) return a.scriptTitle.localeCompare(b.scriptTitle);
      if (left === null) return 1;
      if (right === null) return -1;
      const difference = left - right;
      return difference === 0
        ? a.scriptTitle.localeCompare(b.scriptTitle)
        : query.direction === "asc"
          ? difference
          : -difference;
    });
}

function validResponse(value: unknown): PublicRankingsResponse | null {
  if (!value || typeof value !== "object") return null;
  const records: unknown = (value as Record<string, unknown>)["records"];
  if (!Array.isArray(records)) return null;
  const parsedRecords = records.map(parseRecord);
  if (parsedRecords.some((record) => record === null)) return null;
  return {
    version: 1,
    generatedAt: new Date().toISOString(),
    records: parsedRecords.filter((record): record is PublicRankingRecord => record !== null),
  };
}

function parseRecord(value: unknown): PublicRankingRecord | null {
  if (!value || typeof value !== "object") return null;
  const item = value as Record<string, unknown>;
  const scoresValue = item["scores"];
  if (!scoresValue || typeof scoresValue !== "object") return null;
  const scoreSource = scoresValue as Record<string, unknown>;
  const scores = Object.fromEntries(
    rankingScoreKeys.map((key) => {
      const score = scoreSource[key];
      return [key, typeof score === "number" && Number.isFinite(score) ? score : null];
    }),
  ) as PublicRankingRecord["scores"];
  const id = item["id"];
  const slug = item["slug"];
  const writerName = item["writerName"];
  const scriptTitle = item["scriptTitle"];
  const logline = item["logline"];
  const format = item["format"];
  const genre = item["genre"];
  const imdbUrl = item["imdbUrl"];
  const updatedAt = item["updatedAt"];
  if (
    typeof id !== "string" ||
    typeof slug !== "string" ||
    typeof writerName !== "string" ||
    typeof scriptTitle !== "string" ||
    typeof logline !== "string" ||
    typeof format !== "string" ||
    typeof genre !== "string" ||
    (imdbUrl !== null && typeof imdbUrl !== "string") ||
    (updatedAt !== null && typeof updatedAt !== "string")
  )
    return null;
  return {
    id,
    slug,
    writerName,
    scriptTitle,
    logline,
    format,
    genre,
    imdbUrl,
    updatedAt,
    scores,
  };
}

function formatScore(score: number | null): string {
  return score === null ? "—" : score.toFixed(1);
}
function endpoint(base: string): string {
  return `${base.replace(/\/$/, "")}/api/rankings`;
}

export function ScreenplayRankingsTable(props: ScreenplayRankingsTableProps) {
  const {
    apiBaseUrl,
    style,
    profilePathPrefix = "/loglist/",
    maxRows = 1000,
    initialPageSize = 25,
    backgroundColor = "#eee3d2",
    textColor = "#17130f",
    mutedTextColor = "#72695f",
    accentColor = "#c45f45",
    goldColor = "#d6a85d",
    borderColor = "#c9bba8",
    headerColor = "#090b0b",
    fontFamily = "Cutive, Georgia, serif",
    uiFontFamily = "Arial, sans-serif",
    rowSpacing = 18,
    canvasMode = false,
  } = props;
  const [records, setRecords] = useState<PublicRankingRecord[]>(canvasMode ? sampleRecords : []);
  const [loading, setLoading] = useState(!canvasMode);
  const [error, setError] = useState<string | null>(null);
  const [query, setQuery] = useState<RankingsQuery>(() =>
    typeof window === "undefined"
      ? queryFromSearchParams(new URLSearchParams(), initialPageSize)
      : queryFromSearchParams(new URLSearchParams(window.location.search), initialPageSize),
  );

  useEffect(() => {
    if (canvasMode) return;
    const controller = new AbortController();
    setLoading(true);
    setError(null);
    void fetch(endpoint(apiBaseUrl), {
      signal: controller.signal,
      headers: { accept: "application/json" },
    })
      .then(async (response) => {
        if (!response.ok) throw new Error("request failed");
        const parsed = validResponse(await response.json());
        if (!parsed) throw new Error("invalid response");
        setRecords(parsed.records);
      })
      .catch((cause: unknown) => {
        if (!(cause instanceof DOMException && cause.name === "AbortError"))
          setError("The Loglist is temporarily unavailable. Please try again shortly.");
      })
      .finally(() => {
        if (!controller.signal.aborted) setLoading(false);
      });
    return () => controller.abort();
  }, [apiBaseUrl, canvasMode, maxRows]);

  useEffect(() => {
    if (canvasMode || typeof window === "undefined") return;
    const params = new URLSearchParams(window.location.search);
    const set = (key: string, value: string) =>
      value ? params.set(key, value) : params.delete(key);
    set("search", query.search);
    set("format", query.format);
    set("genre", query.genre);
    set("score", query.scoreKey === "overall" ? "" : query.scoreKey);
    set("minScore", query.minimumScore === null ? "" : String(query.minimumScore));
    set("direction", query.direction === "desc" ? "" : query.direction);
    set("page", query.page === 1 ? "" : String(query.page));
    set("pageSize", query.pageSize === initialPageSize ? "" : String(query.pageSize));
    window.history.replaceState(
      null,
      "",
      `${window.location.pathname}${params.size ? `?${params}` : ""}${window.location.hash}`,
    );
  }, [query, canvasMode, initialPageSize]);

  const formats = useMemo(
    () => [...new Set(records.map((r) => r.format).filter(Boolean))].sort(),
    [records],
  );
  const genres = useMemo(
    () => [...new Set(records.map((r) => r.genre).filter(Boolean))].sort(),
    [records],
  );
  const filtered = useMemo(
    () => applyRankingsQuery(records, query).slice(0, maxRows),
    [records, query, maxRows],
  );
  const pageCount = Math.max(1, Math.ceil(filtered.length / query.pageSize));
  const currentPage = Math.min(query.page, pageCount);
  const visible = filtered.slice((currentPage - 1) * query.pageSize, currentPage * query.pageSize);
  const update = (change: Partial<RankingsQuery>, resetPage = true) =>
    setQuery((previous) => ({ ...previous, ...change, ...(resetPage ? { page: 1 } : {}) }));
  const clear = () =>
    setQuery({
      search: "",
      format: "",
      genre: "",
      scoreKey: "overall",
      minimumScore: null,
      direction: "desc",
      page: 1,
      pageSize: initialPageSize,
    });
  const cssVars = {
    ...style,
    "--lr-bg": backgroundColor,
    "--lr-ink": textColor,
    "--lr-muted": mutedTextColor,
    "--lr-accent": accentColor,
    "--lr-gold": goldColor,
    "--lr-border": borderColor,
    "--lr-head": headerColor,
    "--lr-font": fontFamily,
    "--lr-ui": uiFontFamily,
    "--lr-row-space": `${rowSpacing}px`,
  } as CSSProperties;

  return (
    <section className="loglisted-rankings" style={cssVars} aria-label="Screenplay rankings">
      <style>{loglistedRankingsStyles}</style>
      <div className="loglisted-rankings__controls">
        <div className="loglisted-rankings__field loglisted-rankings__field--search">
          <label htmlFor="lr-search">Search the Loglist</label>
          <input
            id="lr-search"
            type="search"
            value={query.search}
            onChange={(e) => update({ search: e.target.value })}
            placeholder="Search writers, scripts, or loglines"
          />
        </div>
        <div className="loglisted-rankings__field">
          <label htmlFor="lr-format">Format</label>
          <select
            id="lr-format"
            value={query.format}
            onChange={(e) => update({ format: e.target.value })}
          >
            <option value="">All Formats</option>
            {formats.map((value) => (
              <option key={value}>{value}</option>
            ))}
          </select>
        </div>
        <div className="loglisted-rankings__field">
          <label htmlFor="lr-genre">Genre</label>
          <select
            id="lr-genre"
            value={query.genre}
            onChange={(e) => update({ genre: e.target.value })}
          >
            <option value="">All Genres</option>
            {genres.map((value) => (
              <option key={value}>{value}</option>
            ))}
          </select>
        </div>
        <div className="loglisted-rankings__field">
          <label htmlFor="lr-min">Minimum selected score</label>
          <input
            id="lr-min"
            type="number"
            inputMode="decimal"
            min="0"
            max="10"
            step="0.1"
            value={query.minimumScore ?? ""}
            onChange={(e) =>
              update({ minimumScore: e.target.value === "" ? null : Number(e.target.value) })
            }
            placeholder="Min Score"
          />
        </div>
        <div className="loglisted-rankings__field">
          <label htmlFor="lr-ranking">Rank by</label>
          <div className="loglisted-rankings__sort-combo">
            <select
              id="lr-ranking"
              value={query.scoreKey}
              onChange={(e) => update({ scoreKey: e.target.value as RankingScoreKey })}
            >
              {rankingScoreKeys.map((key) => (
                <option value={key} key={key}>
                  {scoreLabels[key]}
                </option>
              ))}
            </select>
            <button
              className="loglisted-rankings__direction"
              type="button"
              aria-label={`Sort ${query.direction === "desc" ? "ascending" : "descending"}`}
              title={`Currently ${query.direction === "desc" ? "highest first" : "lowest first"}`}
              onClick={() => update({ direction: query.direction === "desc" ? "asc" : "desc" })}
            >
              {query.direction === "desc" ? "↓" : "↑"}
            </button>
          </div>
        </div>
      </div>
      <div className="loglisted-rankings__toolbar">
        <p className="loglisted-rankings__count" aria-live="polite">
          {loading
            ? "Loading rankings…"
            : `${filtered.length} ${filtered.length === 1 ? "result" : "results"}`}
        </p>
        <button type="button" className="loglisted-rankings__clear" onClick={clear}>
          Clear all filters
        </button>
      </div>
      {loading ? (
        <State title="Loading the Loglist" body="Retrieving published screenplay rankings…" />
      ) : error ? (
        <State title="Unable to load rankings" body={error} />
      ) : visible.length === 0 ? (
        <State title="No matching screenplays" body="Try clearing one or more filters." />
      ) : (
        <>
          <div className="loglisted-rankings__table-wrap">
            <table>
              <thead>
                <tr>
                  <th className="loglisted-rankings__writer">Writer’s Name</th>
                  <th className="loglisted-rankings__title-col">Script Title</th>
                  <th className="loglisted-rankings__logline">Logline</th>
                  <th className="loglisted-rankings__format">Format</th>
                  <th className="loglisted-rankings__genre">Genre</th>
                  <th className="loglisted-rankings__score">{scoreLabels[query.scoreKey]}</th>
                  <th className="loglisted-rankings__contact">Contact</th>
                </tr>
              </thead>
              <tbody>
                {visible.map((record) => (
                  <DesktopRow
                    key={record.id}
                    record={record}
                    scoreKey={query.scoreKey}
                    profilePathPrefix={profilePathPrefix}
                  />
                ))}
              </tbody>
            </table>
          </div>
          <div className="loglisted-rankings__mobile">
            {visible.map((record) => (
              <MobileRow
                key={record.id}
                record={record}
                scoreKey={query.scoreKey}
                profilePathPrefix={profilePathPrefix}
              />
            ))}
          </div>
          <Pagination
            page={currentPage}
            pageCount={pageCount}
            pageSize={query.pageSize}
            onPage={(page) => update({ page }, false)}
            onPageSize={(pageSize) => update({ pageSize })}
          />
        </>
      )}
    </section>
  );
}

function State({ title, body }: { title: string; body: string }) {
  return (
    <div className="loglisted-rankings__state" role="status">
      <strong>{title}</strong>
      <span>{body}</span>
    </div>
  );
}
function profileHref(prefix: string, slug: string): string {
  return `${prefix.endsWith("/") ? prefix : `${prefix}/`}${encodeURIComponent(slug)}`;
}
function Contact({ record, prefix }: { record: PublicRankingRecord; prefix: string }) {
  const imdb = record.imdbUrl;
  return (
    <a
      href={imdb ?? profileHref(prefix, record.slug)}
      target="_blank"
      rel="noopener noreferrer"
      aria-label={imdb ? `Open ${record.writerName} on IMDb` : `Open ${record.writerName} profile`}
    >
      {imdb ? "IMDb" : "Profile"}
    </a>
  );
}
function DesktopRow({
  record,
  scoreKey,
  profilePathPrefix,
}: {
  record: PublicRankingRecord;
  scoreKey: RankingScoreKey;
  profilePathPrefix: string;
}) {
  return (
    <tr>
      <td>{record.writerName}</td>
      <td>{record.scriptTitle}</td>
      <td>
        <span className="loglisted-rankings__truncate" title={record.logline}>
          {record.logline || "—"}
        </span>
      </td>
      <td>{record.format || "—"}</td>
      <td>{record.genre || "—"}</td>
      <td className="loglisted-rankings__score">{formatScore(record.scores[scoreKey])}</td>
      <td className="loglisted-rankings__contact">
        <Contact record={record} prefix={profilePathPrefix} />
      </td>
    </tr>
  );
}
function MobileRow({
  record,
  scoreKey,
  profilePathPrefix,
}: {
  record: PublicRankingRecord;
  scoreKey: RankingScoreKey;
  profilePathPrefix: string;
}) {
  return (
    <details>
      <summary>
        <span className="loglisted-rankings__mobile-title">{record.scriptTitle}</span>
        <span className="loglisted-rankings__mobile-writer">{record.writerName}</span>
        <span
          className="loglisted-rankings__mobile-score"
          aria-label={`${scoreLabels[scoreKey]} ${formatScore(record.scores[scoreKey])}`}
        >
          {formatScore(record.scores[scoreKey])}
        </span>
      </summary>
      <div className="loglisted-rankings__mobile-body">
        <p>{record.logline || "No logline available."}</p>
        <dl>
          <dt>Format</dt>
          <dd>{record.format || "—"}</dd>
          <dt>Genre</dt>
          <dd>{record.genre || "—"}</dd>
          <dt>Score</dt>
          <dd>
            {scoreLabels[scoreKey]}: {formatScore(record.scores[scoreKey])}
          </dd>
          <dt>Contact</dt>
          <dd>
            <Contact record={record} prefix={profilePathPrefix} />
          </dd>
        </dl>
      </div>
    </details>
  );
}
function Pagination({
  page,
  pageCount,
  pageSize,
  onPage,
  onPageSize,
}: {
  page: number;
  pageCount: number;
  pageSize: number;
  onPage: (page: number) => void;
  onPageSize: (size: number) => void;
}) {
  const start = Math.max(1, Math.min(page - 2, pageCount - 4));
  const pages = Array.from({ length: Math.min(5, pageCount) }, (_, i) => start + i);
  return (
    <nav className="loglisted-rankings__pagination" aria-label="Rankings pagination">
      <label className="loglisted-rankings__page-size">
        Rows per page{" "}
        <select value={pageSize} onChange={(e) => onPageSize(Number(e.target.value))}>
          {pageSizes.map((size) => (
            <option key={size}>{size}</option>
          ))}
        </select>
      </label>
      <div className="loglisted-rankings__pages">
        <button
          className="loglisted-rankings__page"
          type="button"
          disabled={page === 1}
          onClick={() => onPage(page - 1)}
        >
          Previous
        </button>
        {pages.map((value) => (
          <button
            className="loglisted-rankings__page"
            type="button"
            key={value}
            aria-current={value === page ? "page" : undefined}
            onClick={() => onPage(value)}
          >
            {value}
          </button>
        ))}
        <button
          className="loglisted-rankings__page"
          type="button"
          disabled={page === pageCount}
          onClick={() => onPage(page + 1)}
        >
          Next
        </button>
      </div>
    </nav>
  );
}

export default ScreenplayRankingsTable;
