import * as React from "react";
import { addPropertyControls, ControlType, RenderTarget } from "framer";

type ScoreKey =
  | "overall"
  | "premise"
  | "story"
  | "structure"
  | "characters"
  | "dialogue"
  | "pacing"
  | "theme"
  | "tone"
  | "marketability"
  | "craft";

type RankingScores = Record<ScoreKey, number | null>;

interface PublicRankingRecord {
  id: string;
  slug: string;
  writerName: string;
  scriptTitle: string;
  logline: string;
  format: string;
  genre: string;
  imdbUrl: string | null;
  websiteUrl: string | null;
  updatedAt: string | null;
  scores: RankingScores;
  reportStatus: "clear" | "pending_review";
}

type SortDirection = "asc" | "desc";
type PageSize = 25 | 50 | 100;

interface RankingsQuery {
  search: string;
  format: string;
  genre: string;
  scoreKey: ScoreKey;
  minimumScore: number | null;
  direction: SortDirection;
  page: number;
  pageSize: PageSize;
}

interface ScreenplayRankingsTableProps {
  apiBaseUrl?: string;
  profilePathPrefix?: string;
  maxRows?: number;
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
  turnstileSiteKey?: string;
  style?: React.CSSProperties;
}

const SCORE_KEYS: ScoreKey[] = [
  "overall",
  "premise",
  "story",
  "structure",
  "characters",
  "dialogue",
  "pacing",
  "theme",
  "tone",
  "marketability",
  "craft",
];

const SCORE_LABELS: Record<ScoreKey, string> = {
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

const SCORE_DESCRIPTIONS: Record<ScoreKey, string> = {
  overall: "The arithmetic mean of all ten screenplay category scores.",
  premise: "Originality, clarity, hook, stakes, and commercial appeal.",
  story: "Conflict, escalation, causality, emotional impact, and resolution.",
  structure: "Opening, plot progression, turning points, climax, and scene flow.",
  characters: "Protagonist, supporting characters, character arcs, motivation, and relationships.",
  dialogue: "Naturalness, subtext, character voice, memorability, and efficiency.",
  pacing: "Momentum, scene rhythm, narrative balance, tension management, and engagement.",
  theme: "Novelty, clarity, integration, depth, and consistency of thematic ideas.",
  tone: "Consistency, genre alignment, emotional authenticity, atmosphere, and relatability.",
  marketability:
    "Audience appeal, positioning, production feasibility, distinctiveness, and franchise potential.",
  craft: "Formatting, grammar, visual storytelling, clarity of writing, and economy.",
};

const PAGE_SIZES: PageSize[] = [25, 50, 100];

const SAMPLE_RECORDS: PublicRankingRecord[] = [
  {
    id: "sample-1",
    slug: "jules-bishop",
    writerName: "Jules Bishop",
    scriptTitle: "Waking Valley",
    logline:
      "A reluctant heir enters a world of living myths and learns that the prophecy naming them may have been written by an enemy.",
    format: "Half-Hour TV Pilot",
    genre: "Fantasy",
    imdbUrl: "https://www.imdb.com/",
    websiteUrl: null,
    updatedAt: null,
    reportStatus: "clear",
    scores: {
      overall: 9.1,
      premise: 9.2,
      story: 9.0,
      structure: 8.9,
      characters: 9.1,
      dialogue: 8.8,
      pacing: 9.0,
      theme: 9.2,
      tone: 9.1,
      marketability: 9.3,
      craft: 9.0,
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
    websiteUrl: "https://example.com/rowan-calloway",
    updatedAt: null,
    reportStatus: "clear",
    scores: {
      overall: 9.0,
      premise: 8.8,
      story: 9.1,
      structure: 9.0,
      characters: 8.9,
      dialogue: 9.0,
      pacing: 8.8,
      theme: 9.2,
      tone: 9.0,
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
    websiteUrl: null,
    updatedAt: null,
    reportStatus: "clear",
    scores: {
      overall: 8.9,
      premise: 9.0,
      story: 8.8,
      structure: 8.7,
      characters: 9.0,
      dialogue: 9.2,
      pacing: 8.6,
      theme: 8.9,
      tone: 9.1,
      marketability: 8.8,
      craft: 8.9,
    },
  },
];

function isScoreKey(value: string | null): value is ScoreKey {
  return value !== null && SCORE_KEYS.includes(value as ScoreKey);
}

function isPageSize(value: number): value is PageSize {
  return PAGE_SIZES.includes(value as PageSize);
}

function nullableString(value: unknown): string | null {
  return typeof value === "string" ? value : null;
}

function parseRecord(value: unknown): PublicRankingRecord | null {
  if (!value || typeof value !== "object") {
    return null;
  }

  const item = value as Record<string, unknown>;
  const scoresValue = item["scores"];

  if (!scoresValue || typeof scoresValue !== "object") {
    return null;
  }

  const sourceScores = scoresValue as Record<string, unknown>;
  const scores = {} as RankingScores;

  for (const key of SCORE_KEYS) {
    const score = sourceScores[key];

    scores[key] =
      typeof score === "number" && Number.isFinite(score) ? Math.max(0, Math.min(10, score)) : null;
  }

  const id = item["id"];
  const slug = item["slug"];
  const writerName = item["writerName"];
  const scriptTitle = item["scriptTitle"];
  const logline = item["logline"];
  const format = item["format"];
  const genre = item["genre"];

  if (
    typeof id !== "string" ||
    typeof slug !== "string" ||
    typeof writerName !== "string" ||
    typeof scriptTitle !== "string" ||
    typeof logline !== "string" ||
    typeof format !== "string" ||
    typeof genre !== "string"
  ) {
    return null;
  }

  return {
    id,
    slug,
    writerName,
    scriptTitle,
    logline,
    format,
    genre,
    imdbUrl: nullableString(item["imdbUrl"]),
    websiteUrl: nullableString(item["websiteUrl"]),
    updatedAt: nullableString(item["updatedAt"]),
    scores,
    reportStatus: item["reportStatus"] === "pending_review" ? "pending_review" : "clear",
  };
}

interface PublicRankingsPage {
  records: PublicRankingRecord[];
  page: number;
  pageSize: PageSize;
  totalRecords: number;
  totalPages: number;
  availableFormats: string[];
  availableGenres: string[];
}

function parseResponse(value: unknown): PublicRankingsPage | null {
  if (!value || typeof value !== "object") {
    return null;
  }

  const response = value as Record<string, unknown>;
  const recordsValue = response["records"];
  const page = response["page"];
  const pageSize = response["pageSize"];
  const totalRecords = response["totalRecords"];
  const totalPages = response["totalPages"];
  const availableFormats = response["availableFormats"];
  const availableGenres = response["availableGenres"];

  if (
    !Array.isArray(recordsValue) ||
    typeof page !== "number" ||
    typeof pageSize !== "number" ||
    !isPageSize(pageSize) ||
    typeof totalRecords !== "number" ||
    typeof totalPages !== "number" ||
    !Array.isArray(availableFormats) ||
    !availableFormats.every((item) => typeof item === "string") ||
    !Array.isArray(availableGenres) ||
    !availableGenres.every((item) => typeof item === "string")
  ) {
    return null;
  }

  const records: PublicRankingRecord[] = [];

  for (const value of recordsValue) {
    const record = parseRecord(value);

    if (!record) {
      return null;
    }

    records.push(record);
  }

  return {
    records,
    page,
    pageSize,
    totalRecords,
    totalPages,
    availableFormats,
    availableGenres,
  };
}

function readQuery(parameters: URLSearchParams, defaultPageSize: PageSize): RankingsQuery {
  const requestedScore = parameters.get("score");
  const requestedMinimum = Number(parameters.get("minScore"));
  const requestedPageSize = Number(parameters.get("pageSize"));

  return {
    search: parameters.get("search") ?? "",
    format: parameters.get("format") ?? "",
    genre: parameters.get("genre") ?? "",
    scoreKey: isScoreKey(requestedScore) ? requestedScore : "overall",
    minimumScore:
      parameters.has("minScore") && Number.isFinite(requestedMinimum)
        ? Math.max(0, Math.min(10, requestedMinimum))
        : null,
    direction: parameters.get("direction") === "asc" ? "asc" : "desc",
    page: Math.max(1, Number(parameters.get("page")) || 1),
    pageSize: isPageSize(requestedPageSize) ? requestedPageSize : defaultPageSize,
  };
}

function formatScore(score: number | null): string {
  return score === null ? "—" : score.toFixed(1);
}

function buildEndpoint(apiBaseUrl: string, query: RankingsQuery): string {
  const parameters = new URLSearchParams();
  if (query.search.trim()) parameters.set("search", query.search.trim());
  if (query.format) parameters.set("format", query.format);
  if (query.genre) parameters.set("genre", query.genre);
  parameters.set("score", query.scoreKey);
  if (query.minimumScore !== null) parameters.set("minScore", String(query.minimumScore));
  parameters.set("direction", query.direction);
  parameters.set("page", String(query.page));
  parameters.set("pageSize", String(query.pageSize));
  return `${apiBaseUrl.replace(/\/$/, "")}/api/rankings?${parameters.toString()}`;
}

function buildProfileUrl(prefix: string, slug: string): string {
  const normalizedPrefix = prefix.endsWith("/") ? prefix : `${prefix}/`;

  return `${normalizedPrefix}${encodeURIComponent(slug)}`;
}

function ContactLink({
  record,
  profilePathPrefix,
}: {
  record: PublicRankingRecord;
  profilePathPrefix: string;
}) {
  const href =
    record.imdbUrl ?? record.websiteUrl ?? buildProfileUrl(profilePathPrefix, record.slug);

  return (
    <a
      className="lr-contact"
      href={href}
      target="_blank"
      rel="noopener noreferrer"
      aria-label={
        record.imdbUrl
          ? `Open ${record.writerName} on IMDb`
          : record.websiteUrl
            ? `Open ${record.writerName} professional website`
            : `Open ${record.writerName} profile`
      }
    >
      {record.imdbUrl ? (
        <svg
          className="lr-contact-icon lr-contact-icon--imdb"
          viewBox="0 0 44 24"
          aria-hidden="true"
        >
          <rect x="1" y="1" width="42" height="22" rx="3" fill="currentColor" />
          <text
            x="22"
            y="17"
            textAnchor="middle"
            fill="var(--lr-background)"
            fontSize="13"
            fontFamily="Arial, sans-serif"
            fontWeight="800"
          >
            IMDb
          </text>
        </svg>
      ) : (
        <svg className="lr-contact-icon" viewBox="0 0 24 24" aria-hidden="true">
          <circle cx="12" cy="12" r="9" fill="none" stroke="currentColor" strokeWidth="1.8" />
          <path
            d="M3.5 12h17M12 3c2.5 2.5 3.8 5.5 3.8 9S14.5 18.5 12 21M12 3C9.5 5.5 8.2 8.5 8.2 12S9.5 18.5 12 21"
            fill="none"
            stroke="currentColor"
            strokeWidth="1.5"
            strokeLinecap="round"
          />
        </svg>
      )}
    </a>
  );
}

function FlagButton({ record, onReport }: { record: PublicRankingRecord; onReport: () => void }) {
  const pending = record.reportStatus === "pending_review";
  return (
    <button
      type="button"
      className={`lr-flag${pending ? " is-pending" : ""}`}
      disabled={pending}
      aria-label={pending ? "Report pending review" : `Report ${record.scriptTitle}`}
      title={pending ? "Pending review" : "Report this listing"}
      onClick={onReport}
    >
      {pending ? (
        "Flagged"
      ) : (
        <svg className="lr-flag-icon" viewBox="0 0 24 24" aria-hidden="true">
          <path d="M6 21V4m0 1h10.5l-2 3 2 3H6" />
        </svg>
      )}
    </button>
  );
}

declare global {
  interface Window {
    turnstile?: {
      render(
        element: HTMLElement,
        options: {
          sitekey: string;
          action: string;
          callback: (token: string) => void;
          "expired-callback": () => void;
          "error-callback": () => void;
          theme?: "auto" | "light" | "dark";
        },
      ): string;
      reset(widgetId: string): void;
      remove(widgetId: string): void;
    };
  }
}

function loadTurnstileScript(): Promise<void> {
  if (window.turnstile) return Promise.resolve();
  return new Promise((resolve, reject) => {
    const existing = document.querySelector<HTMLScriptElement>(
      'script[src*="turnstile/v0/api.js"]',
    );
    if (existing) {
      existing.addEventListener("load", () => resolve(), { once: true });
      existing.addEventListener("error", () => reject(new Error("Verification failed to load.")), {
        once: true,
      });
      return;
    }
    const script = document.createElement("script");
    script.src = "https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit";
    script.async = true;
    script.defer = true;
    script.onload = () => resolve();
    script.onerror = () => reject(new Error("Verification failed to load."));
    document.head.appendChild(script);
  });
}

function EmptyState({ title, message }: { title: string; message: string }) {
  return (
    <div className="lr-state" role="status">
      <strong>{title}</strong>
      <span>{message}</span>
    </div>
  );
}

function Pagination({
  page,
  pageCount,
  pageSize,
  onPageChange,
  onPageSizeChange,
}: {
  page: number;
  pageCount: number;
  pageSize: PageSize;
  onPageChange: (page: number) => void;
  onPageSizeChange: (pageSize: PageSize) => void;
}) {
  const firstPage = Math.max(1, Math.min(page - 2, pageCount - 4));

  const visiblePageCount = Math.min(5, pageCount);

  const pages = Array.from({ length: visiblePageCount }, (_, index) => firstPage + index);

  return (
    <nav className="lr-pagination" aria-label="Rankings pagination">
      <label className="lr-page-size">
        Rows per page
        <select
          value={pageSize}
          onChange={(event) => {
            const value = Number(event.target.value);

            if (isPageSize(value)) {
              onPageSizeChange(value);
            }
          }}
        >
          {PAGE_SIZES.map((size) => (
            <option key={size} value={size}>
              {size}
            </option>
          ))}
        </select>
      </label>

      <div className="lr-pages">
        <button type="button" disabled={page <= 1} onClick={() => onPageChange(page - 1)}>
          Previous
        </button>

        {pages.map((pageNumber) => (
          <button
            key={pageNumber}
            type="button"
            aria-current={pageNumber === page ? "page" : undefined}
            onClick={() => onPageChange(pageNumber)}
          >
            {pageNumber}
          </button>
        ))}

        <button type="button" disabled={page >= pageCount} onClick={() => onPageChange(page + 1)}>
          Next
        </button>
      </div>
    </nav>
  );
}

/**
 * @framerSupportedLayoutWidth any-prefer-fixed
 * @framerSupportedLayoutHeight auto
 */
export default function ScreenplayRankingsTable(props: ScreenplayRankingsTableProps) {
  const {
    apiBaseUrl = "https://loglisted-production-canary-api.onrender.com",
    profilePathPrefix = "/loglist/",
    maxRows = 1000,
    backgroundColor = "#EEE3D2",
    textColor = "#17130F",
    mutedTextColor = "#72695F",
    accentColor = "#C45F45",
    goldColor = "#D6A85D",
    borderColor = "#C9BBA8",
    headerColor = "#090B0B",
    fontFamily = "Cutive, Georgia, serif",
    uiFontFamily = "Arial, sans-serif",
    rowSpacing = 18,
    turnstileSiteKey = "",
    style,
  } = props;

  const canvasMode = RenderTarget.current() === RenderTarget.canvas;

  const defaultPageSize: PageSize = 25;

  const [records, setRecords] = React.useState<PublicRankingRecord[]>(
    canvasMode ? SAMPLE_RECORDS : [],
  );
  const [availableFormats, setAvailableFormats] = React.useState<string[]>([]);
  const [availableGenres, setAvailableGenres] = React.useState<string[]>([]);
  const [totalRecords, setTotalRecords] = React.useState(canvasMode ? SAMPLE_RECORDS.length : 0);
  const [totalPages, setTotalPages] = React.useState(1);

  const [loading, setLoading] = React.useState(!canvasMode);

  const [error, setError] = React.useState<string | null>(null);
  const [reportingRecord, setReportingRecord] = React.useState<PublicRankingRecord | null>(null);
  const [reportReason, setReportReason] = React.useState("copyright");
  const [reportDetails, setReportDetails] = React.useState("");
  const [reportError, setReportError] = React.useState<string | null>(null);
  const [reportSubmitting, setReportSubmitting] = React.useState(false);
  const [turnstileToken, setTurnstileToken] = React.useState<string | null>(null);
  const turnstileContainerRef = React.useRef<HTMLDivElement>(null);
  const turnstileWidgetRef = React.useRef<string | null>(null);

  // Framer server-renders code components before hydrating them in the
  // browser. Start from the same query on both sides, then restore URL state
  // after hydration so React does not discard the server-rendered component.
  const [query, setQuery] = React.useState<RankingsQuery>(() =>
    readQuery(new URLSearchParams(), defaultPageSize),
  );
  const [browserReady, setBrowserReady] = React.useState(canvasMode);

  const stickyControlsRef = React.useRef<HTMLDivElement>(null);
  const [stickyControlsHeight, setStickyControlsHeight] = React.useState(142);

  React.useEffect(() => {
    const element = stickyControlsRef.current;

    if (!element) return;

    const measure = () =>
      setStickyControlsHeight(Math.ceil(element.getBoundingClientRect().height));
    measure();

    if (typeof ResizeObserver === "undefined") return;

    const observer = new ResizeObserver(measure);
    observer.observe(element);
    return () => observer.disconnect();
  }, []);

  React.useEffect(() => {
    if (canvasMode) return;

    setQuery(readQuery(new URLSearchParams(window.location.search), defaultPageSize));
    setBrowserReady(true);
  }, [canvasMode]);

  React.useEffect(() => {
    if (canvasMode || !browserReady) {
      return;
    }

    const controller = new AbortController();

    setLoading(true);
    setError(null);

    const delay = window.setTimeout(
      () =>
        void fetch(buildEndpoint(apiBaseUrl, query), {
          signal: controller.signal,
          headers: {
            Accept: "application/json",
          },
        })
          .then(async (response) => {
            if (!response.ok) {
              throw new Error(`Rankings request failed: ${response.status}`);
            }

            const responseValue: unknown = await response.json();

            const parsedPage = parseResponse(responseValue);

            if (!parsedPage) {
              throw new Error("The rankings response was invalid.");
            }

            setRecords(parsedPage.records);
            setAvailableFormats(parsedPage.availableFormats);
            setAvailableGenres(parsedPage.availableGenres);
            setTotalRecords(parsedPage.totalRecords);
            setTotalPages(parsedPage.totalPages);
          })
          .catch((cause: unknown) => {
            if (cause instanceof DOMException && cause.name === "AbortError") {
              return;
            }

            setError("The Loglist is temporarily unavailable. Please try again shortly.");
          })
          .finally(() => {
            if (!controller.signal.aborted) {
              setLoading(false);
            }
          }),
      query.search ? 300 : 0,
    );

    return () => {
      window.clearTimeout(delay);
      controller.abort();
    };
  }, [apiBaseUrl, browserReady, canvasMode, query]);

  React.useEffect(() => {
    if (canvasMode || !browserReady || typeof window === "undefined") {
      return;
    }

    const restoreQueryFromHistory = () => {
      setQuery(readQuery(new URLSearchParams(window.location.search), defaultPageSize));
    };

    window.addEventListener("popstate", restoreQueryFromHistory);
    return () => window.removeEventListener("popstate", restoreQueryFromHistory);
  }, [browserReady, canvasMode]);

  React.useEffect(() => {
    if (canvasMode || !browserReady || typeof window === "undefined") {
      return;
    }

    const parameters = new URLSearchParams(window.location.search);

    function setParameter(key: string, value: string) {
      if (value) {
        parameters.set(key, value);
      } else {
        parameters.delete(key);
      }
    }

    setParameter("search", query.search);
    setParameter("format", query.format);
    setParameter("genre", query.genre);

    setParameter("score", query.scoreKey === "overall" ? "" : query.scoreKey);

    setParameter("minScore", query.minimumScore === null ? "" : String(query.minimumScore));

    setParameter("direction", query.direction === "desc" ? "" : query.direction);

    setParameter("page", query.page === 1 ? "" : String(query.page));

    setParameter("pageSize", query.pageSize === defaultPageSize ? "" : String(query.pageSize));

    const queryString = parameters.toString();

    window.history.replaceState(
      window.history.state,
      "",
      `${window.location.pathname}${queryString ? `?${queryString}` : ""}${window.location.hash}`,
    );
  }, [query, browserReady, canvasMode]);

  React.useEffect(() => {
    if (!reportingRecord || canvasMode || !turnstileSiteKey || !turnstileContainerRef.current)
      return;
    let cancelled = false;
    void loadTurnstileScript()
      .then(() => {
        if (cancelled || !window.turnstile || !turnstileContainerRef.current) return;
        turnstileWidgetRef.current = window.turnstile.render(turnstileContainerRef.current, {
          sitekey: turnstileSiteKey,
          action: "ranking_report",
          callback: (token: string) => setTurnstileToken(token),
          "expired-callback": () => setTurnstileToken(null),
          "error-callback": () => setReportError("Verification could not be completed."),
        });
      })
      .catch(() => setReportError("Verification could not be loaded."));
    return () => {
      cancelled = true;
      const id = turnstileWidgetRef.current;
      if (id && window.turnstile) {
        try {
          window.turnstile.remove(id);
        } catch {
          /* Widget already removed. */
        }
      }
      turnstileWidgetRef.current = null;
      setTurnstileToken(null);
    };
  }, [reportingRecord, canvasMode, turnstileSiteKey]);

  async function submitReport(event: React.FormEvent) {
    event.preventDefault();
    if (!reportingRecord || !turnstileToken) {
      setReportError("Complete the verification before submitting.");
      return;
    }
    setReportSubmitting(true);
    setReportError(null);
    try {
      let deviceId = window.localStorage.getItem("loglisted_device_id");
      if (!deviceId) {
        deviceId = crypto.randomUUID();
        window.localStorage.setItem("loglisted_device_id", deviceId);
      }
      const base = apiBaseUrl.replace(/\/$/, "");
      const sessionResponse = await fetch(`${base}/api/session`, {
        method: "POST",
        credentials: "include",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ deviceId }),
      });
      const session = (await sessionResponse.json()) as { csrfToken?: string };
      if (!sessionResponse.ok || !session.csrfToken)
        throw new Error("A secure reporting session could not be created.");
      const response = await fetch(`${base}/api/rankings/report`, {
        method: "POST",
        credentials: "include",
        headers: { "content-type": "application/json", "x-csrf-token": session.csrfToken },
        body: JSON.stringify({
          rankingSlug: reportingRecord.slug,
          reason: reportReason,
          details: reportDetails,
          turnstileToken,
        }),
      });
      const payload = (await response.json().catch(() => ({}))) as { error?: { message?: string } };
      if (!response.ok)
        throw new Error(payload.error?.message ?? "The report could not be submitted.");
      setRecords((current) =>
        current.map((record) =>
          record.id === reportingRecord.id ? { ...record, reportStatus: "pending_review" } : record,
        ),
      );
      setReportingRecord(null);
      setReportDetails("");
    } catch (cause) {
      setReportError(cause instanceof Error ? cause.message : "The report could not be submitted.");
      setTurnstileToken(null);
      const widgetId = turnstileWidgetRef.current;
      if (widgetId && window.turnstile) {
        try {
          window.turnstile.reset(widgetId);
        } catch {
          // The dialog may have closed or Cloudflare may already have expired the widget.
        }
      }
    } finally {
      setReportSubmitting(false);
    }
  }

  const formats = canvasMode
    ? Array.from(new Set(records.map((record) => record.format).filter(Boolean))).sort()
    : availableFormats;
  const genres = canvasMode
    ? Array.from(new Set(records.map((record) => record.genre).filter(Boolean))).sort()
    : availableGenres;
  const visibleRecords = records.slice(0, Math.max(1, maxRows));
  const pageCount = canvasMode ? 1 : totalPages;
  const currentPage = canvasMode ? 1 : Math.min(query.page, pageCount);

  function updateQuery(change: Partial<RankingsQuery>, resetPage = true) {
    setQuery((current) => ({
      ...current,
      ...change,
      ...(resetPage ? { page: 1 } : {}),
    }));
  }

  function clearFilters() {
    setQuery({
      search: "",
      format: "",
      genre: "",
      scoreKey: "overall",
      minimumScore: null,
      direction: "desc",
      page: 1,
      pageSize: defaultPageSize,
    });
  }

  const componentStyle = {
    ...style,
    "--lr-background": backgroundColor,
    "--lr-text": textColor,
    "--lr-muted": mutedTextColor,
    "--lr-accent": accentColor,
    "--lr-gold": goldColor,
    "--lr-border": borderColor,
    "--lr-header": headerColor,
    "--lr-font": fontFamily,
    "--lr-ui-font": uiFontFamily,
    "--lr-row-spacing": `${rowSpacing}px`,
    "--lr-sticky-offset": `${stickyControlsHeight}px`,
  } as React.CSSProperties;

  return (
    <section className="loglisted-rankings" style={componentStyle} aria-label="Screenplay rankings">
      <style>{STYLES}</style>

      <div className="lr-sticky-controls" ref={stickyControlsRef}>
        <div className="lr-controls">
          <div className="lr-field lr-search-field">
            <label htmlFor="lr-search">Search the Loglist</label>

            <div className="lr-search-input">
              <svg viewBox="0 0 24 24" aria-hidden="true">
                <circle
                  cx="10.5"
                  cy="10.5"
                  r="6.5"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="2"
                />
                <path
                  d="m15.5 15.5 5 5"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="2"
                  strokeLinecap="round"
                />
              </svg>
              <input
                id="lr-search"
                type="search"
                value={query.search}
                placeholder="Search writers, scripts, or loglines"
                onChange={(event) =>
                  updateQuery({
                    search: event.target.value,
                  })
                }
              />
            </div>
          </div>

          <div className="lr-field">
            <label htmlFor="lr-format">Format</label>

            <select
              id="lr-format"
              value={query.format}
              onChange={(event) =>
                updateQuery({
                  format: event.target.value,
                })
              }
            >
              <option value="">All Formats</option>

              {formats.map((format) => (
                <option key={format} value={format}>
                  {format}
                </option>
              ))}
            </select>
          </div>

          <div className="lr-field">
            <label htmlFor="lr-genre">Genre</label>

            <select
              id="lr-genre"
              value={query.genre}
              onChange={(event) =>
                updateQuery({
                  genre: event.target.value,
                })
              }
            >
              <option value="">All Genres</option>

              {genres.map((genre) => (
                <option key={genre} value={genre}>
                  {genre}
                </option>
              ))}
            </select>
          </div>

          <div className="lr-field">
            <label htmlFor="lr-minimum">Minimum Score</label>

            <input
              id="lr-minimum"
              type="number"
              inputMode="decimal"
              min={0}
              max={10}
              step={0.1}
              value={query.minimumScore ?? ""}
              placeholder="Min Score"
              onChange={(event) => {
                const value = event.target.value;

                updateQuery({
                  minimumScore: value === "" ? null : Math.max(0, Math.min(10, Number(value))),
                });
              }}
            />
          </div>

          <div className="lr-field">
            <label htmlFor="lr-score">Rank by</label>

            <div className="lr-sort-control">
              <select
                id="lr-score"
                value={query.scoreKey}
                onChange={(event) => {
                  const value = event.target.value;

                  if (isScoreKey(value)) {
                    updateQuery({
                      scoreKey: value,
                    });
                  }
                }}
              >
                {SCORE_KEYS.map((key) => (
                  <option key={key} value={key}>
                    {SCORE_LABELS[key]}
                  </option>
                ))}
              </select>

              <button
                type="button"
                className="lr-direction"
                aria-label={
                  query.direction === "desc" ? "Sort scores ascending" : "Sort scores descending"
                }
                title={query.direction === "desc" ? "Highest scores first" : "Lowest scores first"}
                onClick={() =>
                  updateQuery({
                    direction: query.direction === "desc" ? "asc" : "desc",
                  })
                }
              >
                {query.direction === "desc" ? "↓" : "↑"}
              </button>
            </div>
          </div>
        </div>

        <div className="lr-toolbar">
          <p className="lr-count" aria-live="polite">
            {loading
              ? "Loading rankings…"
              : `${totalRecords} ${totalRecords === 1 ? "result" : "results"}`}
          </p>

          <button type="button" className="lr-clear" onClick={clearFilters}>
            Clear all filters
          </button>
        </div>
      </div>

      {loading ? (
        <EmptyState
          title="Loading the Loglist"
          message="Retrieving published screenplay rankings…"
        />
      ) : error ? (
        <EmptyState title="Unable to load rankings" message={error} />
      ) : visibleRecords.length === 0 ? (
        <EmptyState title="No matching screenplays" message="Try clearing one or more filters." />
      ) : (
        <>
          <div className="lr-table-wrapper">
            <table>
              <thead>
                <tr>
                  <th>Writer&apos;s Name</th>
                  <th>Script Title</th>
                  <th>Logline</th>
                  <th>Format</th>
                  <th>Genre</th>
                  <th>
                    <span className="lr-score-heading">
                      {SCORE_LABELS[query.scoreKey]}
                      <span className="lr-tooltip">
                        <button
                          type="button"
                          className="lr-tooltip-trigger"
                          aria-label={`About the ${SCORE_LABELS[query.scoreKey]} score`}
                          aria-describedby={`score-description-${query.scoreKey}`}
                        >
                          ?
                        </button>
                        <span
                          id={`score-description-${query.scoreKey}`}
                          className="lr-tooltip-panel"
                          role="tooltip"
                        >
                          {SCORE_DESCRIPTIONS[query.scoreKey]}
                        </span>
                      </span>
                    </span>
                  </th>
                  <th>Contact</th>
                  <th>Report</th>
                </tr>
              </thead>

              <tbody>
                {visibleRecords.map((record) => (
                  <tr key={record.id}>
                    <td>{record.writerName}</td>

                    <td>{record.scriptTitle}</td>

                    <td className="lr-logline-cell">
                      <span
                        className="lr-logline"
                        tabIndex={record.logline ? 0 : undefined}
                        aria-describedby={
                          record.logline ? `logline-preview-${safeDomId(record.id)}` : undefined
                        }
                      >
                        {record.logline || "—"}
                      </span>
                      {record.logline ? (
                        <span
                          id={`logline-preview-${safeDomId(record.id)}`}
                          className="lr-logline-preview"
                          role="tooltip"
                        >
                          {record.logline}
                        </span>
                      ) : null}
                    </td>

                    <td>{record.format || "—"}</td>

                    <td>{record.genre || "—"}</td>

                    <td className="lr-score">{formatScore(record.scores[query.scoreKey])}</td>

                    <td className="lr-contact-cell">
                      <ContactLink record={record} profilePathPrefix={profilePathPrefix} />
                    </td>

                    <td className="lr-report-cell">
                      <FlagButton record={record} onReport={() => setReportingRecord(record)} />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          <div className="lr-mobile-list">
            {visibleRecords.map((record) => (
              <article className="lr-mobile-card" key={record.id}>
                <header className="lr-mobile-header">
                  <span className="lr-mobile-title">{record.scriptTitle}</span>

                  <span className="lr-mobile-writer">{record.writerName}</span>

                  <span className="lr-mobile-score">
                    {formatScore(record.scores[query.scoreKey])}
                  </span>
                </header>

                <div className="lr-mobile-body">
                  <p className="lr-mobile-logline">{record.logline || "No logline available."}</p>

                  <dl>
                    <dt>Format</dt>
                    <dd>{record.format || "—"}</dd>

                    <dt>Genre</dt>
                    <dd>{record.genre || "—"}</dd>

                    <dt>Score</dt>
                    <dd>
                      {SCORE_LABELS[query.scoreKey]}: {formatScore(record.scores[query.scoreKey])}
                    </dd>

                    <dt>Contact</dt>
                    <dd>
                      <div className="lr-row-actions">
                        <ContactLink record={record} profilePathPrefix={profilePathPrefix} />
                        <FlagButton record={record} onReport={() => setReportingRecord(record)} />
                      </div>
                    </dd>
                  </dl>
                </div>
              </article>
            ))}
          </div>

          <Pagination
            page={currentPage}
            pageCount={pageCount}
            pageSize={query.pageSize}
            onPageChange={(page) => updateQuery({ page }, false)}
            onPageSizeChange={(pageSize) => updateQuery({ pageSize })}
          />
          {reportingRecord ? (
            <div
              className="lr-dialog-backdrop"
              role="presentation"
              onMouseDown={(event) => {
                if (event.target === event.currentTarget) setReportingRecord(null);
              }}
            >
              <div
                className="lr-dialog"
                role="dialog"
                aria-modal="true"
                aria-labelledby="lr-report-title"
              >
                <button
                  type="button"
                  className="lr-dialog-close"
                  aria-label="Close report dialog"
                  onClick={() => setReportingRecord(null)}
                >
                  <svg viewBox="0 0 24 24" aria-hidden="true">
                    <path d="M5 5l14 14M19 5L5 19" />
                  </svg>
                </button>
                <h2 id="lr-report-title">Report this listing</h2>
                <p>
                  Report “{reportingRecord.scriptTitle}” for manual review. Do not include private
                  or sensitive information.
                </p>
                <form
                  onSubmit={(event) => {
                    void submitReport(event);
                  }}
                >
                  <label htmlFor="lr-report-reason">Reason</label>
                  <select
                    id="lr-report-reason"
                    value={reportReason}
                    onChange={(event) => setReportReason(event.target.value)}
                  >
                    <option value="copyright">Copyright violation</option>
                    <option value="impersonation">Impersonation</option>
                    <option value="inappropriate">Inappropriate content</option>
                    <option value="spam">Spam</option>
                    <option value="suspicious">Suspicious content</option>
                    <option value="other">Other</option>
                  </select>
                  <label htmlFor="lr-report-details">Additional details (optional)</label>
                  <textarea
                    id="lr-report-details"
                    maxLength={500}
                    value={reportDetails}
                    onChange={(event) => setReportDetails(event.target.value)}
                  />
                  <div ref={turnstileContainerRef} className="lr-report-turnstile" />
                  {reportError ? (
                    <p className="lr-report-error" role="alert">
                      ! {reportError}
                    </p>
                  ) : null}
                  <button
                    type="submit"
                    className="lr-report-submit"
                    disabled={reportSubmitting || !turnstileToken}
                  >
                    {reportSubmitting ? "Submitting…" : "Submit report"}
                  </button>
                </form>
              </div>
            </div>
          ) : null}
        </>
      )}
    </section>
  );
}

function safeDomId(value: string): string {
  return value.replace(/[^a-zA-Z0-9_-]/g, "-");
}

addPropertyControls(ScreenplayRankingsTable, {
  apiBaseUrl: {
    type: ControlType.String,
    title: "API URL",
    defaultValue: "https://loglisted-production-canary-api.onrender.com",
  },
  profilePathPrefix: {
    type: ControlType.String,
    title: "Profile Path",
    defaultValue: "/loglist/",
  },
  maxRows: {
    type: ControlType.Number,
    title: "Max Rows",
    defaultValue: 1000,
    min: 25,
    max: 5000,
    step: 25,
  },
  backgroundColor: {
    type: ControlType.Color,
    title: "Background",
    defaultValue: "#EEE3D2",
  },
  textColor: {
    type: ControlType.Color,
    title: "Text",
    defaultValue: "#17130F",
  },
  mutedTextColor: {
    type: ControlType.Color,
    title: "Muted",
    defaultValue: "#72695F",
  },
  accentColor: {
    type: ControlType.Color,
    title: "Accent",
    defaultValue: "#C45F45",
  },
  goldColor: {
    type: ControlType.Color,
    title: "Gold",
    defaultValue: "#D6A85D",
  },
  borderColor: {
    type: ControlType.Color,
    title: "Border",
    defaultValue: "#C9BBA8",
  },
  headerColor: {
    type: ControlType.Color,
    title: "Header",
    defaultValue: "#090B0B",
  },
  fontFamily: {
    type: ControlType.String,
    title: "Typography",
    defaultValue: "Cutive, Georgia, serif",
  },
  rowSpacing: {
    type: ControlType.Number,
    title: "Row Space",
    defaultValue: 18,
    min: 10,
    max: 36,
    step: 1,
  },
  turnstileSiteKey: {
    type: ControlType.String,
    title: "Turnstile Key",
    defaultValue: "",
  },
});

const STYLES = `
.loglisted-rankings {
    --lr-background: #EEE3D2;
    --lr-text: #17130F;
    --lr-muted: #72695F;
    --lr-accent: #C45F45;
    --lr-gold: #D6A85D;
    --lr-border: #C9BBA8;
    --lr-header: #090B0B;
    --lr-font: Cutive, Georgia, serif;
    --lr-ui-font: Arial, sans-serif;
    --lr-row-spacing: 18px;

    box-sizing: border-box;
    container-name: rankings;
    container-type: inline-size;
    width: 100%;
    height: auto;
    padding: clamp(18px, 3vw, 44px);
    color: var(--lr-text);
    background: var(--lr-background);
    font-family: var(--lr-font);
}

.loglisted-rankings *,
.loglisted-rankings *::before,
.loglisted-rankings *::after {
    box-sizing: border-box;
}

.lr-controls {
    display: grid;
    grid-template-columns:
        minmax(260px, 1.6fr)
        minmax(210px, 1fr)
        minmax(175px, 0.9fr)
        minmax(125px, 0.65fr)
        minmax(245px, 1.25fr);
    gap: 14px;
    align-items: end;
    margin-bottom: 18px;
}

.lr-sticky-controls {
    position: sticky;
    top: 0;
    z-index: 40;
    margin: clamp(-44px, -3vw, -18px);
    margin-bottom: 12px;
    padding: clamp(18px, 3vw, 44px);
    padding-bottom: 8px;
    background: var(--lr-background);
    border-bottom: 1px solid var(--lr-border);
}

.lr-field {
    display: grid;
    gap: 7px;
    min-width: 0;
}

.lr-field label {
    font-family: var(--lr-ui-font);
    font-size: 12px;
    font-weight: 700;
    line-height: 1.25;
    letter-spacing: 0.08em;
    text-transform: uppercase;
}

.loglisted-rankings input,
.loglisted-rankings select,
.loglisted-rankings button {
    font: inherit;
}

.loglisted-rankings input,
.loglisted-rankings select {
    width: 100%;
    min-width: 0;
    min-height: 48px;
    padding: 10px 12px;
    color: var(--lr-text);
    background: #F7EDDE;
    border: 1px solid var(--lr-border);
    border-radius: 6px;
    font-size: 14px;
    line-height: 1.3;
}

.loglisted-rankings select {
    padding-right: 42px;
    font-size: 14px;
    appearance: none;
    background-image: url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='14' height='9' viewBox='0 0 14 9'%3E%3Cpath d='M1 1l6 6 6-6' fill='none' stroke='%2372695F' stroke-width='1.8' stroke-linecap='round' stroke-linejoin='round'/%3E%3C/svg%3E");
    background-repeat: no-repeat;
    background-position: right 15px center;
    background-size: 14px 9px;
}

.lr-search-input {
    position: relative;
}

.lr-search-input svg {
    position: absolute;
    top: 50%;
    left: 13px;
    z-index: 1;
    width: 20px;
    height: 20px;
    color: var(--lr-muted);
    pointer-events: none;
    transform: translateY(-50%);
}

.lr-search-input input {
    padding-left: 43px;
}

.loglisted-rankings input:focus-visible,
.loglisted-rankings select:focus-visible,
.loglisted-rankings button:focus-visible,
.loglisted-rankings summary:focus-visible,
.loglisted-rankings a:focus-visible {
    outline: 3px solid var(--lr-gold);
    outline-offset: 2px;
}

.lr-sort-control {
    display: grid;
    grid-template-columns: minmax(0, 1fr) auto;
    gap: 7px;
}

.lr-direction,
.lr-clear,
.lr-pages button {
    min-height: 42px;
    padding: 8px 13px;
    color: var(--lr-text);
    background: transparent;
    border: 1px solid var(--lr-border);
    border-radius: 5px;
    cursor: pointer;
}

.lr-direction {
    min-width: 48px;
    font-family: var(--lr-ui-font);
    font-size: 18px;
    font-weight: 700;
}

.lr-direction:hover,
.lr-clear:hover,
.lr-pages button:hover:not(:disabled) {
    color: var(--lr-accent);
    border-color: var(--lr-accent);
}

.lr-toolbar {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 16px;
    margin: 12px 0;
}

.lr-count {
    margin: 0;
    color: var(--lr-muted);
    font-family: var(--lr-ui-font);
    font-size: 14px;
    font-weight: 600;
}

.lr-state {
    padding: 42px 20px;
    text-align: center;
    background: rgba(255, 255, 255, 0.2);
    border: 1px solid var(--lr-border);
}

.lr-state strong {
    display: block;
    margin-bottom: 8px;
}

.lr-table-wrapper {
    height: auto !important;
    min-height: 0;
    overflow: visible;
    border: 1px solid var(--lr-border);
}

.loglisted-rankings table {
    width: 100%;
    min-width: 960px;
    height: auto !important;
    border-collapse: collapse;
    table-layout: fixed;
}

.loglisted-rankings tbody {
    height: auto !important;
}

.loglisted-rankings th {
    position: sticky;
    top: var(--lr-sticky-offset, 142px);
    z-index: 30;
    padding: 16px 14px;
    color: #EEE3D2;
    background: var(--lr-header);
    font-family: var(--lr-ui-font);
    font-size: 12px;
    font-weight: 700;
    line-height: 1.35;
    letter-spacing: 0.09em;
    text-align: left;
    text-transform: uppercase;
}

.loglisted-rankings th:nth-child(1) {
    width: 14%;
}

.loglisted-rankings th:nth-child(2) {
    width: 13%;
}

.loglisted-rankings th:nth-child(3) {
    width: 21%;
}

.loglisted-rankings th:nth-child(4) {
    width: 13%;
}

.loglisted-rankings th:nth-child(5) {
    width: 10%;
}

.loglisted-rankings th:nth-child(6) {
    width: 12%;
    text-align: center;
}

.loglisted-rankings th:nth-child(7) {
    width: 9%;
    text-align: center;
}

.loglisted-rankings th:nth-child(8) {
    width: 8%;
    text-align: center;
}

.loglisted-rankings td {
    padding:
        var(--lr-row-spacing)
        14px;
    vertical-align: top;
    line-height: 1.45;
    border-top: 1px solid var(--lr-border);
}

.loglisted-rankings tbody tr:hover {
    background: rgba(214, 168, 93, 0.1);
}

.lr-logline {
    display: -webkit-box;
    overflow: hidden;
    -webkit-box-orient: vertical;
    -webkit-line-clamp: 3;
}

.lr-logline-cell {
    position: relative;
    overflow: visible;
}

.lr-logline:focus-visible {
    outline: 3px solid var(--lr-gold);
    outline-offset: 3px;
}

.lr-logline-preview {
    position: absolute;
    top: calc(100% - 8px);
    left: 10px;
    z-index: 20;
    width: min(440px, 55vw);
    padding: 15px 16px;
    color: #EEE3D2;
    background: var(--lr-header);
    border: 1px solid var(--lr-gold);
    border-radius: 6px;
    box-shadow: 0 12px 28px rgba(0, 0, 0, 0.24);
    font-family: var(--lr-font);
    font-size: 13px;
    font-weight: 400;
    line-height: 1.55;
    letter-spacing: normal;
    text-transform: none;
    opacity: 0;
    visibility: hidden;
    pointer-events: none;
    transform: translateY(-4px);
}

.lr-logline-cell:hover .lr-logline-preview,
.lr-logline-cell:focus-within .lr-logline-preview {
    opacity: 1;
    visibility: visible;
    transform: translateY(0);
}

.lr-score-heading {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    flex-wrap: nowrap;
    gap: 7px;
    max-width: 100%;
    overflow: visible;
    white-space: nowrap;
}

.lr-tooltip {
    position: relative;
    display: inline-flex;
}

.lr-tooltip-trigger {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    width: 21px;
    height: 21px;
    min-height: 21px;
    padding: 0;
    color: #EEE3D2;
    background: transparent;
    border: 1px solid currentColor;
    border-radius: 50%;
    cursor: help;
    font-family: var(--lr-ui-font);
    font-size: 12px;
    font-weight: 700;
    line-height: 1;
}

.lr-tooltip-panel {
    position: absolute;
    top: calc(100% + 9px);
    right: -18px;
    z-index: 30;
    width: min(280px, calc(100vw - 32px));
    padding: 13px 14px;
    color: #EEE3D2;
    background: var(--lr-header);
    border: 1px solid var(--lr-gold);
    border-radius: 6px;
    box-shadow: 0 12px 28px rgba(0, 0, 0, 0.24);
    font-family: var(--lr-ui-font);
    font-size: 13px;
    font-weight: 400;
    line-height: 1.5;
    letter-spacing: normal;
    text-transform: none;
    white-space: normal;
    overflow-wrap: anywhere;
    opacity: 0;
    visibility: hidden;
    pointer-events: none;
}

.lr-tooltip:hover .lr-tooltip-panel,
.lr-tooltip:focus-within .lr-tooltip-panel {
    opacity: 1;
    visibility: visible;
}

.lr-score {
    color: var(--lr-accent);
    font-weight: 700;
}

.lr-contact {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    width: 58px;
    min-width: 58px;
    height: 48px;
    min-height: 48px;
    padding: 7px;
    color: var(--lr-accent);
    border: 1px solid currentColor;
    border-radius: 5px;
    font-family: var(--lr-ui-font);
    text-decoration: none;
}

.loglisted-rankings .lr-contact-cell,
.loglisted-rankings .lr-report-cell {
    text-align: center;
}

.loglisted-rankings td:nth-child(6) {
    text-align: center;
}

.lr-contact-icon {
    display: block;
    width: 23px;
    height: 23px;
}

.lr-contact-icon--imdb {
    width: 34px;
    height: 22px;
}

.lr-pagination {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    justify-content: space-between;
    gap: 14px;
    margin-top: 18px;
}

.lr-page-size {
    display: flex;
    align-items: center;
    gap: 9px;
    font-family: var(--lr-ui-font);
    font-size: 13px;
    font-weight: 600;
}

.lr-page-size select {
    width: auto;
    min-height: 42px;
}

.lr-pages {
    display: flex;
    flex-wrap: wrap;
    gap: 6px;
}

.lr-pages button[aria-current="page"] {
    color: #EEE3D2;
    background: var(--lr-header);
    border-color: var(--lr-header);
}

.lr-pages button:disabled {
    opacity: 0.45;
    cursor: not-allowed;
}

.lr-mobile-list {
    display: none;
}

.lr-mobile-card {
    background: rgba(255, 255, 255, 0.12);
    border: 1px solid var(--lr-border);
}

.lr-mobile-card + .lr-mobile-card {
    border-top: 0;
}

.lr-mobile-header {
    display: grid;
    grid-template-columns: minmax(0, 1fr) auto;
    gap: 8px 14px;
    padding: 18px;
}

.lr-mobile-title {
    font-weight: 700;
}

.lr-mobile-writer {
    color: var(--lr-muted);
    font-size: 14px;
}

.lr-mobile-score {
    grid-column: 2;
    grid-row: 1 / 3;
    align-self: center;
    color: var(--lr-accent);
    font-size: 22px;
    font-weight: 700;
}

.lr-mobile-body {
    padding: 0 18px 18px;
}

.lr-mobile-logline {
    margin: 16px 0;
    line-height: 1.6;
}

.lr-mobile-body dl {
    display: grid;
    grid-template-columns: max-content minmax(0, 1fr);
    gap: 8px 14px;
}

.lr-mobile-body dt {
    font-family: var(--lr-ui-font);
    font-size: 12px;
    font-weight: 700;
    line-height: 1.5;
    text-transform: uppercase;
}

.lr-mobile-body dd {
    min-width: 0;
    margin: 0;
}

@container rankings (min-width: 901px) and (max-width: 1150px) {
    .lr-controls {
        grid-template-columns: repeat(2, minmax(0, 1fr));
    }

    .lr-search-field {
        grid-column: 1 / -1;
    }

    .lr-table-wrapper {
        max-width: 100%;
        overflow-x: auto;
    }

    .loglisted-rankings th {
        position: static;
    }
}

@container rankings (max-width: 900px) {
    .lr-sticky-controls {
        position: static;
    }

    .lr-controls {
        grid-template-columns: repeat(2, minmax(0, 1fr));
    }

    .lr-search-field {
        grid-column: 1 / -1;
    }

    .lr-table-wrapper {
        display: none;
    }

    .lr-mobile-list {
        display: block;
    }
}

@media (max-width: 1050px) {
    .lr-sticky-controls {
        position: static;
    }
    .lr-controls {
        grid-template-columns:
            repeat(2, minmax(0, 1fr));
    }

    .lr-search-field {
        grid-column: 1 / -1;
    }

    .lr-table-wrapper {
        display: none;
    }

    .lr-mobile-list {
        display: block;
    }
}

@media (max-width: 600px) {
    .loglisted-rankings {
        padding: 16px;
    }

    .lr-controls {
        grid-template-columns: 1fr;
    }

    .lr-search-field {
        grid-column: auto;
    }

    .lr-toolbar,
    .lr-pagination {
        align-items: stretch;
        flex-direction: column;
    }

    .lr-clear {
        width: 100%;
    }

    .lr-page-size {
        justify-content: space-between;
    }

    .lr-pages {
        justify-content: center;
    }
}

@container rankings (max-width: 600px) {
    .loglisted-rankings {
        padding: 16px;
    }

    .lr-controls {
        grid-template-columns: 1fr;
    }

    .lr-search-field {
        grid-column: auto;
    }

    .lr-toolbar,
    .lr-pagination {
        align-items: stretch;
        flex-direction: column;
    }

    .lr-clear {
        width: 100%;
    }

    .lr-page-size {
        justify-content: space-between;
    }

    .lr-pages {
        justify-content: center;
    }
}

@media (prefers-reduced-motion: reduce) {
    .loglisted-rankings *,
    .loglisted-rankings *::before,
    .loglisted-rankings *::after {
        scroll-behavior: auto !important;
        transition: none !important;
    }
}

.lr-row-actions { display: flex; align-items: center; justify-content: center; gap: 8px; }
.lr-flag { display: inline-grid; place-items: center; width: 46px; min-width: 46px; height: 44px; min-height: 44px; padding: 7px; border: 1px solid var(--lr-accent); border-radius: 6px; background: transparent; color: var(--lr-accent); cursor: pointer; font: 700 15px var(--lr-ui-font); }
.lr-flag-icon { display: block; width: 25px; height: 25px; fill: none; stroke: currentColor; stroke-width: 1.8; stroke-linecap: round; stroke-linejoin: round; }
.lr-flag.is-pending { width: auto; padding-inline: 8px; border-color: var(--lr-gold); color: #76561f; cursor: default; font-size: 11px; }
.lr-dialog-backdrop { position: fixed; inset: 0; z-index: 10000; display: grid; place-items: center; padding: 20px; background: rgba(9,11,11,.72); }
.lr-dialog { position: relative; width: min(520px, 100%); max-height: calc(100vh - 40px); overflow: auto; padding: 28px; border: 1px solid var(--lr-gold); border-radius: 10px; background: var(--lr-background); color: var(--lr-text); box-shadow: 0 16px 50px rgba(0,0,0,.28); }
.lr-dialog h2 { margin: 0 36px 10px 0; font: 28px/1.2 var(--lr-font); }
.lr-dialog p { line-height: 1.55; }
.lr-dialog form { display: grid; gap: 10px; }
.lr-dialog label { margin-top: 8px; font: 700 11px/1.3 var(--lr-ui-font); text-transform: uppercase; letter-spacing: .08em; }
.lr-dialog select, .lr-dialog textarea { box-sizing: border-box; width: 100%; min-height: 48px; padding: 12px; border: 1px solid var(--lr-border); border-radius: 6px; background-color: #f8eedf; color: var(--lr-text); font: 14px/1.4 var(--lr-font); }
.lr-dialog select { appearance: none; -webkit-appearance: none; padding-right: 44px; background-image: linear-gradient(45deg, transparent 50%, #5d554b 50%), linear-gradient(135deg, #5d554b 50%, transparent 50%); background-position: calc(100% - 20px) calc(50% - 2px), calc(100% - 14px) calc(50% - 2px); background-size: 6px 6px, 6px 6px; background-repeat: no-repeat; cursor: pointer; }
.lr-dialog textarea { min-height: 100px; resize: vertical; }
.lr-dialog-close { position: absolute; top: 10px; right: 10px; display: grid; place-items: center; width: 48px; height: 48px; padding: 8px; border: 0; background: transparent; color: var(--lr-text); cursor: pointer; }
.lr-dialog-close svg { display: block; width: 30px; height: 30px; fill: none; stroke: currentColor; stroke-width: 2.25; stroke-linecap: round; }
.lr-report-submit { min-height: 48px; padding: 12px 18px; border: 1px solid var(--lr-accent); border-radius: 6px; background: var(--lr-accent); color: white; cursor: pointer; font: 700 15px var(--lr-ui-font); }
.lr-report-submit:disabled { cursor: not-allowed; opacity: .55; }
.lr-report-error { color: #9d2f24; font-weight: 700; }
.lr-report-turnstile { min-height: 66px; margin-top: 8px; }
`;
