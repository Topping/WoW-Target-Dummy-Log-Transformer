export function App() {
  return (
    <div className="page-shell">
      <header className="site-header">
        <a
          className="brand"
          href="./"
          aria-label="WoW Training Dummy Log Analyzer home"
        >
          Combat Lab
        </a>
        <span className="status-badge">Browser only</span>
      </header>

      <main>
        <section className="hero" aria-labelledby="page-title">
          <p className="eyebrow">WoW Retail · Training dummies</p>
          <h1 id="page-title">
            Turn a noisy combat log into one clean training session.
          </h1>
          <p className="lede">
            Choose your character and attempt, then review the events that
            belong to your rotation. File selection and analysis are coming in
            the next delivery chunks.
          </p>

          <div className="intake-preview" aria-labelledby="intake-title">
            <div aria-hidden="true" className="file-mark">
              LOG
            </div>
            <div>
              <h2 id="intake-title">Combat-log intake</h2>
              <p>
                The application foundation is ready for local file processing.
              </p>
            </div>
            <button type="button" disabled aria-describedby="intake-note">
              Choose log
            </button>
            <p id="intake-note" className="intake-note">
              File selection will be enabled with the streaming worker.
            </p>
          </div>
        </section>

        <aside className="privacy-card" aria-labelledby="privacy-title">
          <span className="privacy-icon" aria-hidden="true">
            ✓
          </span>
          <div>
            <h2 id="privacy-title">Your combat log stays on your computer.</h2>
            <p>
              This file is processed locally in your browser and is never
              uploaded.
            </p>
          </div>
        </aside>
      </main>

      <footer>
        <p>No account · No analytics · No server</p>
      </footer>
    </div>
  );
}
