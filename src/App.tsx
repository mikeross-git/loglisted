import FramerScreenplayUploader from "./frontend/FramerScreenplayUploader.js";
import "./frontend/styles/loglisted-reset.css";

export default function App() {
  const apiBaseUrl =
    (import.meta.env as Record<string, string | undefined>)["VITE_API_BASE_URL"] ??
    "http://localhost:3000";
  return (
    <main className="loglisted-preview">
      <div className="loglisted-preview__shell">
        <header className="loglisted-preview__masthead">
          <p className="loglisted-preview__brand">Loglisted.</p>
          <div className="loglisted-development-banner" role="status">
            Local Mock Mode — No external AI calls will be made
          </div>
        </header>
        <FramerScreenplayUploader
          apiBaseUrl={apiBaseUrl}
          turnstileSiteKey="local-mock-site-key"
          turnstileMode="mock"
          privacyPolicyUrl="#local-privacy"
          acceptableUseUrl="#local-acceptable-use"
        />
      </div>
    </main>
  );
}
