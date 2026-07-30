import "@fontsource/cutive/400.css";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { ImdbProfileUrlSchema, WriterEmailSchema } from "../types/project.js";
import { ApiClientError, ScreenplayApiClient, publicErrorMessages } from "./api-client.js";
import { getOrCreateDeviceId } from "./device-session.js";
import { ClientFileError, inspectAndHashPdf } from "./file-hash.js";
import { AnalysisProgress } from "./report/AnalysisProgress.js";
import {
  holdCompletedMockAnalysis,
  waitForMinimumMockAnalysisDuration,
} from "./report/analysis-timing.js";
import { adaptAnalysisResult } from "./report/report-model.js";
import { ScreenplayReport } from "./report/ScreenplayReport.js";
import "./styles/loglisted-tokens.css";
import "./styles/loglisted-uploader.css";
import "./styles/loglisted-report.css";
import type {
  AnalysisResult,
  BrowserSession,
  FileInspection,
  ProjectForm,
  ProjectFormat,
  UploaderPhase,
} from "./types.js";

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
          theme?: "light" | "dark" | "auto";
        },
      ): string;
      reset(widgetId: string): void;
      remove(widgetId: string): void;
    };
  }
}

export interface FramerScreenplayUploaderProps {
  apiBaseUrl: string;
  turnstileSiteKey: string;
  maximumFileSizeMb?: number;
  maximumPages?: number;
  privacyPolicyUrl?: string;
  acceptableUseUrl?: string;
  accentColor?: string;
  surfaceColor?: string;
  textColor?: string;
  mutedTextColor?: string;
  borderColor?: string;
  borderRadius?: number;
  maxWidth?: number;
  compactMode?: boolean;
  theme?: "light" | "dark";
  turnstileMode?: "real" | "mock";
}

const initialProject: ProjectForm = {
  firstName: "",
  lastName: "",
  email: "",
  imdbUrl: "",
  projectTitle: "",
  format: "unknown",
  primaryGenre: "",
  secondaryGenres: [],
  logline: "",
  originalWorkConfirmed: false,
  uploadRightsConfirmed: false,
  privacyTermsAccepted: false,
  acceptableUseAccepted: false,
  aiProcessingAcknowledged: false,
  websiteConfirm: "",
};

const phaseLabels: Partial<Record<UploaderPhase, string>> = {
  establishing_session: "Preparing secure submission…",
  hashing: "Calculating a private file fingerprint…",
  authorizing: "Verifying submission…",
  uploading: "Uploading PDF temporarily…",
  processing: "Your script is currently being processed…",
  retrieving_cached: "Retrieving your existing result…",
};

function loadTurnstile(): Promise<void> {
  if (window.turnstile) return Promise.resolve();
  return new Promise((resolve, reject) => {
    const existing = document.querySelector<HTMLScriptElement>(
      'script[src^="https://challenges.cloudflare.com/turnstile/"]',
    );
    if (existing) {
      existing.addEventListener("load", () => resolve(), { once: true });
      existing.addEventListener("error", () => reject(new Error("Turnstile failed to load.")), {
        once: true,
      });
      return;
    }
    const script = document.createElement("script");
    script.src = "https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit";
    script.async = true;
    script.defer = true;
    script.onload = () => resolve();
    script.onerror = () => reject(new Error("Turnstile failed to load."));
    document.head.append(script);
  });
}

export default function FramerScreenplayUploader({
  apiBaseUrl,
  turnstileSiteKey,
  maximumFileSizeMb = 15,
  maximumPages = 150,
  privacyPolicyUrl = "/privacy",
  acceptableUseUrl = "/acceptable-use",
  accentColor = "#d6a85d",
  surfaceColor = "#11100e",
  textColor = "#eee3d2",
  mutedTextColor = "#b8ad9c",
  borderColor = "#3a3329",
  borderRadius = 16,
  maxWidth = 1180,
  compactMode = false,
  theme = "light",
  turnstileMode = "real",
}: FramerScreenplayUploaderProps) {
  const api = useMemo(() => new ScreenplayApiClient(apiBaseUrl), [apiBaseUrl]);
  const mountedAt = useRef(new Date().toISOString());
  const fileSelectedAt = useRef<string | null>(null);
  const turnstileContainer = useRef<HTMLDivElement | null>(null);
  const turnstileWidget = useRef<string | null>(null);
  const reportContainer = useRef<HTMLDivElement | null>(null);
  const [session, setSession] = useState<BrowserSession | null>(null);
  const [project, setProject] = useState<ProjectForm>(initialProject);
  const [file, setFile] = useState<File | null>(null);
  const [inspection, setInspection] = useState<FileInspection | null>(null);
  const [hashProgress, setHashProgress] = useState(0);
  const [turnstileToken, setTurnstileToken] = useState<string | null>(null);
  const [phase, setPhase] = useState<UploaderPhase>("establishing_session");
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<AnalysisResult | null>(null);
  const [analysisStartedAt, setAnalysisStartedAt] = useState<number | null>(null);
  const [analysisProgressComplete, setAnalysisProgressComplete] = useState(false);
  const isAnalyzing = ["authorizing", "uploading", "processing", "retrieving_cached"].includes(
    phase,
  );
  const report = useMemo(
    () => (result ? adaptAnalysisResult(result, { project, inspection }) : null),
    [inspection, project, result],
  );

  useEffect(() => {
    if (!report || !reportContainer.current) return;
    window.requestAnimationFrame(() => {
      reportContainer.current?.scrollIntoView({ block: "start", behavior: "auto" });
    });
  }, [report]);

  useEffect(() => {
    let active = true;
    const establish = async () => {
      try {
        const deviceId = getOrCreateDeviceId(localStorage);
        const created = await api.createSession(deviceId);
        if (active) {
          setSession({ deviceId, ...created });
          setPhase("ready");
        }
      } catch {
        if (active) {
          setError(publicErrorMessages.verification);
          setPhase("error");
        }
      }
    };
    void establish();
    return () => {
      active = false;
    };
  }, [api]);

  useEffect(() => {
    if (turnstileMode === "mock") return;
    let active = true;
    void loadTurnstile()
      .then(() => {
        if (
          !active ||
          !window.turnstile ||
          !turnstileContainer.current ||
          turnstileWidget.current
        ) {
          return;
        }
        turnstileWidget.current = window.turnstile.render(turnstileContainer.current, {
          sitekey: turnstileSiteKey,
          action: "screenplay_upload",
          theme,
          callback: setTurnstileToken,
          "expired-callback": () => setTurnstileToken(null),
          "error-callback": () => {
            setTurnstileToken(null);
            setError(publicErrorMessages.verification);
          },
        });
      })
      .catch(() => setError(publicErrorMessages.verification));
    return () => {
      active = false;
      if (turnstileWidget.current && window.turnstile) {
        window.turnstile.remove(turnstileWidget.current);
        turnstileWidget.current = null;
      }
    };
  }, [theme, turnstileMode, turnstileSiteKey]);

  const resetTurnstile = useCallback(() => {
    setTurnstileToken(null);
    if (turnstileMode === "mock") return;
    if (turnstileWidget.current && window.turnstile) {
      window.turnstile.reset(turnstileWidget.current);
    }
  }, [turnstileMode]);

  const updateProject = <K extends keyof ProjectForm>(key: K, value: ProjectForm[K]) => {
    setProject((current) => ({ ...current, [key]: value }));
  };

  const onFileSelected = async (selected: File | null) => {
    setFile(selected);
    setInspection(null);
    setHashProgress(0);
    setResult(null);
    setError(null);
    if (!selected) return;
    fileSelectedAt.current = new Date().toISOString();
    setPhase("hashing");
    try {
      const inspected = await inspectAndHashPdf(
        selected,
        {
          maximumBytes: maximumFileSizeMb * 1024 * 1024,
          maximumPages,
        },
        setHashProgress,
      );
      setInspection(inspected);
      setPhase("ready");
    } catch (caught) {
      setFile(null);
      setPhase("error");
      setError(
        caught instanceof ClientFileError &&
          (caught.code === "too_large" || caught.code === "too_many_pages")
          ? publicErrorMessages.documentLimit
          : publicErrorMessages.unreadable,
      );
    }
  };

  const emailIsValid = WriterEmailSchema.safeParse(project.email).success;
  const imdbIsValid =
    project.imdbUrl.trim().length === 0 || ImdbProfileUrlSchema.safeParse(project.imdbUrl).success;

  const requiredComplete =
    Boolean(session) &&
    project.firstName.trim().length > 0 &&
    project.lastName.trim().length > 0 &&
    emailIsValid &&
    imdbIsValid &&
    project.projectTitle.trim().length > 0 &&
    project.format !== "unknown" &&
    project.primaryGenre.trim().length > 0 &&
    project.logline.trim().length > 0 &&
    project.originalWorkConfirmed &&
    project.uploadRightsConfirmed &&
    project.privacyTermsAccepted &&
    project.acceptableUseAccepted &&
    project.aiProcessingAcknowledged &&
    Boolean(file) &&
    Boolean(inspection) &&
    Boolean(turnstileToken) &&
    phase === "ready";

  const submit = async () => {
    if (
      !requiredComplete ||
      !session ||
      !file ||
      !inspection ||
      !turnstileToken ||
      !fileSelectedAt.current
    ) {
      return;
    }
    setError(null);
    setResult(null);
    const analysisStartedAt = Date.now();
    setAnalysisStartedAt(analysisStartedAt);
    setAnalysisProgressComplete(false);
    setPhase("authorizing");
    try {
      const authorization = await api.authorizeUpload({
        csrfToken: session.csrfToken,
        turnstileToken,
        deviceId: session.deviceId,
        file,
        inspection,
        project,
        mountedAt: mountedAt.current,
        fileSelectedAt: fileSelectedAt.current,
      });
      resetTurnstile();
      let completedResult: AnalysisResult;
      if (authorization.cachedResultAvailable) {
        if (!authorization.resultId || !authorization.resultAccessToken) {
          throw new ApiClientError(publicErrorMessages.analysis, 500);
        }
        setPhase("retrieving_cached");
        completedResult = await api.getResult(
          authorization.resultId,
          authorization.resultAccessToken,
        );
      } else {
        if (!authorization.uploadToken) {
          throw new ApiClientError(publicErrorMessages.authorizationExpired, 403);
        }
        setPhase("uploading");
        setPhase("processing");
        completedResult = await api.analyze(file, authorization.uploadToken);
      }
      if (completedResult.evaluationMode === "mock") {
        await waitForMinimumMockAnalysisDuration(analysisStartedAt);
        setAnalysisProgressComplete(true);
        await holdCompletedMockAnalysis();
      }
      setResult(completedResult);
      setPhase("completed");
    } catch (caught) {
      resetTurnstile();
      setError(
        caught instanceof ApiClientError ? caught.publicMessage : publicErrorMessages.analysis,
      );
      setPhase("error");
    }
  };

  const uploaderStyle = {
    "--loglisted-component-accent": accentColor,
    "--loglisted-component-surface": surfaceColor,
    "--loglisted-component-text": textColor,
    "--loglisted-component-muted": mutedTextColor,
    "--loglisted-component-border": borderColor,
    "--loglisted-component-radius": `${borderRadius}px`,
    "--loglisted-component-max-width": `${maxWidth}px`,
  } as React.CSSProperties;

  return (
    <div
      className={`loglisted-uploader${compactMode ? " loglisted-uploader--compact" : ""}`}
      style={uploaderStyle}
    >
      {!result && !isAnalyzing && (
        <>
          <header className="loglisted-uploader__header">
            <p className="loglisted-uploader__eyebrow">Loglisted Screenplay Scoring</p>
            <h2 className="loglisted-uploader__title">Score your screenplay</h2>
            <p className="loglisted-uploader__description">
              No account is required. To prevent abuse, submission limits apply.
            </p>
            <p className="loglisted-uploader__privacy-notice">
              Your uploaded PDF is processed temporarily and is not retained after analysis. Scores
              and limited project metadata may be stored according to the{" "}
              <a href={privacyPolicyUrl}>Privacy Policy</a>.
            </p>
          </header>

          <div className="loglisted-uploader__form">
            <section
              className="loglisted-uploader__section"
              aria-labelledby="project-details-heading"
            >
              <h3 className="loglisted-uploader__section-title" id="project-details-heading">
                Project Details
              </h3>
              <div className="loglisted-uploader__field-grid">
                <div className="loglisted-uploader__field">
                  <label className="loglisted-uploader__label" htmlFor="loglisted-first-name">
                    Your First Name
                  </label>
                  <input
                    id="loglisted-first-name"
                    className="loglisted-uploader__input"
                    value={project.firstName}
                    onChange={(event) => updateProject("firstName", event.target.value)}
                    autoComplete="given-name"
                    maxLength={100}
                    required
                  />
                </div>
                <div className="loglisted-uploader__field">
                  <label className="loglisted-uploader__label" htmlFor="loglisted-last-name">
                    Your Last Name
                  </label>
                  <input
                    id="loglisted-last-name"
                    className="loglisted-uploader__input"
                    value={project.lastName}
                    onChange={(event) => updateProject("lastName", event.target.value)}
                    autoComplete="family-name"
                    maxLength={100}
                    required
                  />
                </div>

                <div className="loglisted-uploader__field">
                  <label className="loglisted-uploader__label" htmlFor="loglisted-email">
                    Your Email Address
                  </label>
                  <input
                    id="loglisted-email"
                    className="loglisted-uploader__input"
                    type="email"
                    inputMode="email"
                    autoComplete="email"
                    value={project.email}
                    onChange={(event) => updateProject("email", event.target.value)}
                    aria-invalid={project.email.length > 0 && !emailIsValid}
                    aria-describedby={
                      project.email.length > 0 && !emailIsValid
                        ? "loglisted-email-error"
                        : undefined
                    }
                    maxLength={254}
                    required
                  />
                  {project.email.length > 0 && !emailIsValid && (
                    <p
                      className="loglisted-uploader__field-error"
                      id="loglisted-email-error"
                      role="alert"
                    >
                      Enter a valid email address.
                    </p>
                  )}
                </div>

                <div className="loglisted-uploader__field">
                  <label className="loglisted-uploader__label" htmlFor="loglisted-imdb">
                    Your IMDb Profile Link{" "}
                    <span className="loglisted-uploader__optional">(optional)</span>
                  </label>
                  <input
                    id="loglisted-imdb"
                    className="loglisted-uploader__input"
                    type="url"
                    inputMode="url"
                    placeholder="https://www.imdb.com/name/nm1234567/"
                    value={project.imdbUrl}
                    onChange={(event) => updateProject("imdbUrl", event.target.value)}
                    aria-invalid={!imdbIsValid}
                    aria-describedby={!imdbIsValid ? "loglisted-imdb-error" : undefined}
                    maxLength={500}
                  />
                  {!imdbIsValid && (
                    <p
                      className="loglisted-uploader__field-error"
                      id="loglisted-imdb-error"
                      role="alert"
                    >
                      Enter a valid IMDb name-profile link, such as
                      https://www.imdb.com/name/nm1234567/.
                    </p>
                  )}
                </div>
                <div className="loglisted-uploader__field loglisted-uploader__field--wide">
                  <label className="loglisted-uploader__label" htmlFor="loglisted-project-title">
                    Project Title
                  </label>
                  <input
                    id="loglisted-project-title"
                    className="loglisted-uploader__input"
                    value={project.projectTitle}
                    onChange={(event) => updateProject("projectTitle", event.target.value)}
                    maxLength={200}
                    required
                  />
                </div>
                <div className="loglisted-uploader__field">
                  <label className="loglisted-uploader__label" htmlFor="loglisted-format">
                    Format
                  </label>
                  <select
                    id="loglisted-format"
                    className="loglisted-uploader__select"
                    value={project.format}
                    onChange={(event) =>
                      updateProject("format", event.target.value as ProjectFormat)
                    }
                  >
                    <option value="unknown" disabled>
                      Select a format
                    </option>
                    <option value="feature">Feature</option>
                    <option value="halfHourPilot">Half-Hour TV Pilot</option>
                    <option value="hourPilot">Hour TV Pilot</option>
                    <option value="short">Short</option>
                  </select>
                </div>
                <div className="loglisted-uploader__field">
                  <label className="loglisted-uploader__label" htmlFor="loglisted-primary-genre">
                    Primary Genre
                  </label>

                  <select
                    id="loglisted-primary-genre"
                    className="loglisted-uploader__select"
                    value={project.primaryGenre}
                    onChange={(event) => updateProject("primaryGenre", event.target.value)}
                  >
                    <option value="" disabled>
                      Select a genre
                    </option>
                    <option value="action">Action</option>
                    <option value="animated">Animated</option>
                    <option value="biopic">Biopic</option>
                    <option value="comedy">Comedy</option>
                    <option value="crime">Crime</option>
                    <option value="darkComedy">Dark Comedy</option>
                    <option value="drama">Drama</option>
                    <option value="dramedy">Dramedy</option>
                    <option value="family">Family</option>
                    <option value="fantasy">Fantasy</option>
                    <option value="historical">Historical</option>
                    <option value="horror">Horror</option>
                    <option value="romCom">Rom-Com</option>
                    <option value="sciFi">Sci-Fi</option>
                    <option value="thriller">Thriller</option>
                  </select>
                </div>

                <div className="loglisted-uploader__field loglisted-uploader__field--wide">
                  <label className="loglisted-uploader__label" htmlFor="loglisted-logline">
                    Logline
                  </label>
                  <textarea
                    id="loglisted-logline"
                    className="loglisted-uploader__textarea"
                    value={project.logline}
                    onChange={(event) => updateProject("logline", event.target.value)}
                    maxLength={1000}
                    required
                  />
                </div>
              </div>
            </section>

            <input
              className="loglisted-uploader__honeypot"
              aria-hidden="true"
              tabIndex={-1}
              autoComplete="off"
              name="website_confirm"
              value={project.websiteConfirm}
              onChange={(event) => updateProject("websiteConfirm", event.target.value)}
            />

            <section
              className="loglisted-uploader__section"
              aria-labelledby="screenplay-upload-heading"
            >
              <h3 className="loglisted-uploader__section-title" id="screenplay-upload-heading">
                Screenplay PDF
              </h3>
              <div className="loglisted-uploader__upload-zone">
                <label className="loglisted-uploader__label" htmlFor="loglisted-screenplay-file">
                  Choose a text-based PDF
                </label>
                <input
                  id="loglisted-screenplay-file"
                  className="loglisted-uploader__file-input"
                  type="file"
                  accept="application/pdf,.pdf"
                  aria-describedby="loglisted-file-status"
                  onChange={(event) => void onFileSelected(event.target.files?.[0] ?? null)}
                />
                {phase === "hashing" && (
                  <progress
                    className="loglisted-uploader__progress"
                    value={hashProgress}
                    max={1}
                    aria-label="Calculating PDF hash"
                  />
                )}
                <div id="loglisted-file-status" aria-live="polite">
                  {inspection?.approximatePageCount !== null && inspection && (
                    <p className="loglisted-uploader__file-status">
                      Approximately {inspection.approximatePageCount} pages detected.
                    </p>
                  )}
                  {inspection?.readableTextWarning && (
                    <p className="loglisted-uploader__file-status">
                      Readable text could not be confirmed in the browser. The server will verify
                      the PDF before analysis.
                    </p>
                  )}
                </div>
              </div>
            </section>

            <section
              className="loglisted-uploader__section"
              aria-labelledby="confirmations-heading"
            >
              <h3 className="loglisted-uploader__section-title" id="confirmations-heading">
                Confirmations
              </h3>
              <div className="loglisted-uploader__checkbox-list">
                <Confirmation
                  id="loglisted-original-work"
                  checked={project.originalWorkConfirmed}
                  onChange={(checked) => updateProject("originalWorkConfirmed", checked)}
                  label="I confirm this is original work or I am authorized to submit it."
                />
                <Confirmation
                  id="loglisted-upload-rights"
                  checked={project.uploadRightsConfirmed}
                  onChange={(checked) => updateProject("uploadRightsConfirmed", checked)}
                  label="I confirm I have the necessary upload and processing rights."
                />
                <Confirmation
                  id="loglisted-privacy"
                  checked={project.privacyTermsAccepted}
                  onChange={(checked) => updateProject("privacyTermsAccepted", checked)}
                  label={
                    <>
                      I accept the <a href={privacyPolicyUrl}>Privacy Policy</a>.
                    </>
                  }
                />
                <Confirmation
                  id="loglisted-acceptable-use"
                  checked={project.acceptableUseAccepted}
                  onChange={(checked) => updateProject("acceptableUseAccepted", checked)}
                  label={
                    <>
                      I accept the <a href={acceptableUseUrl}>Acceptable Use Policy</a>.
                    </>
                  }
                />
                <Confirmation
                  id="loglisted-ai-processing"
                  checked={project.aiProcessingAcknowledged}
                  onChange={(checked) => updateProject("aiProcessingAcknowledged", checked)}
                  label="I understand that portions of my screenplay may be processed by third-party AI service providers to generate scores. Loglisted is configured not to opt submitted content into model training, subject to the provider's current terms and technical controls."
                />
              </div>
            </section>

            {turnstileMode === "mock" ? (
              <div className="loglisted-uploader__turnstile">
                <strong className="loglisted-uploader__turnstile-label">
                  Mock Turnstile — development only
                </strong>
                <button
                  className="loglisted-uploader__mock-button"
                  type="button"
                  onClick={() => {
                    setError(null);
                    setTurnstileToken(`local-turnstile:${crypto.randomUUID()}`);
                  }}
                >
                  {turnstileToken ? "Mock challenge complete" : "Complete mock challenge"}
                </button>
              </div>
            ) : (
              <div
                className="loglisted-uploader__turnstile"
                ref={turnstileContainer}
                aria-label="Abuse prevention challenge"
              />
            )}

            {phaseLabels[phase] && (
              <p className="loglisted-uploader__progress-state" role="status">
                {phaseLabels[phase]}
              </p>
            )}
            {error && (
              <p
                className="loglisted-uploader__error-message"
                id="loglisted-submit-error"
                role="alert"
              >
                {error}
              </p>
            )}
            <button
              className="loglisted-uploader__submit"
              type="button"
              disabled={!requiredComplete}
              onClick={() => void submit()}
              aria-describedby={error ? "loglisted-submit-error" : undefined}
            >
              Submit screenplay
            </button>
          </div>
        </>
      )}

      {isAnalyzing && analysisStartedAt !== null ? (
        <AnalysisProgress
          phase={phase}
          startedAt={analysisStartedAt}
          completed={analysisProgressComplete}
        />
      ) : null}
      {report ? (
        <div className="loglisted-uploader__report-anchor" ref={reportContainer}>
          <ScreenplayReport report={report} />
        </div>
      ) : null}
    </div>
  );
}

function Confirmation({
  id,
  checked,
  onChange,
  label,
}: {
  id: string;
  checked: boolean;
  onChange: (checked: boolean) => void;
  label: React.ReactNode;
}) {
  return (
    <label className="loglisted-uploader__checkbox-field" htmlFor={id}>
      <input
        id={id}
        className="loglisted-uploader__checkbox"
        type="checkbox"
        checked={checked}
        onChange={(event) => onChange(event.target.checked)}
      />
      <span className="loglisted-uploader__checkbox-label">{label}</span>
    </label>
  );
}
