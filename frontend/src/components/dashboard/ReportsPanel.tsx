import { CheckCircle2, FileJson, Printer } from 'lucide-react'
import { exportJson } from './exporters'

interface ReportsPanelProps {
  totalDeps: number
  checkedDeps: number
  unpinned: number
  advisories: number
  packagesAffected: number
  source: string | null
  report: unknown
  notify: (message: string) => void
}

/** Monochrome ring that draws in to the coverage percentage. */
function CoverageRing({ pct }: { pct: number | null }) {
  const r = 52
  const c = 2 * Math.PI * r
  const offset = pct === null ? c : c * (1 - pct / 100)
  return (
    <svg className="hbd-ring" viewBox="0 0 128 128" role="img" aria-label={pct === null ? 'No coverage yet' : `${pct}% exact-version coverage`}>
      <circle cx="64" cy="64" r={r} className="hbd-ring-track" />
      <circle
        cx="64"
        cy="64"
        r={r}
        className="hbd-ring-value"
        strokeDasharray={c}
        strokeDashoffset={offset}
        transform="rotate(-90 64 64)"
      />
      <text x="64" y="70" textAnchor="middle" className="hbd-ring-text">
        {pct === null ? '—' : `${pct}%`}
      </text>
    </svg>
  )
}

export default function ReportsPanel({
  totalDeps,
  checkedDeps,
  unpinned,
  advisories,
  packagesAffected,
  source,
  report,
  notify,
}: ReportsPanelProps) {
  const pct = totalDeps > 0 ? Math.round((checkedDeps / totalDeps) * 100) : null

  return (
    <section className="hbd-panel hbd-report">
      <div className="hbd-report-actions no-print">
        <button type="button" className="hb-btn hb-btn-ghost hbd-btn-sm" onClick={() => window.print()}>
          <Printer size={14} /> Print / save as PDF
        </button>
        <button
          type="button"
          className="hb-btn hb-btn-ghost hbd-btn-sm"
          disabled={!report}
          onClick={() => {
            exportJson(report, 'report')
            notify('Downloaded report JSON')
          }}
        >
          <FileJson size={14} /> Export JSON
        </button>
      </div>

      <div className="hbd-report-grid">
        <div className="hbd-report-hero">
          <CoverageRing pct={pct} />
          <div>
            <span className="hb-kicker">Exact-version coverage</span>
            <p>
              {pct === null
                ? 'Run an audit to measure how many dependencies are pinned to an exact version.'
                : `${checkedDeps} of ${totalDeps} dependencies are pinned exactly and were checked against OSV.dev.${
                    unpinned ? ` ${unpinned} use version ranges and can’t be checked exactly; a lockfile fixes that.` : ''
                  }`}
            </p>
          </div>
        </div>

        <div className="hbd-report-cell">
          <span className="hb-kicker">Advisories matched</span>
          <strong className="hbd-serif">{source ? advisories : '—'}</strong>
          <p>{source ? `Across ${packagesAffected} package${packagesAffected === 1 ? '' : 's'} in ${source}.` : 'No audit yet.'}</p>
        </div>
        <div className="hbd-report-cell">
          <span className="hb-kicker">Advisory source</span>
          <strong className="hbd-serif">OSV.dev</strong>
          <p>Findings come only from published OSV records matched to exact versions.</p>
        </div>
        <div className="hbd-report-cell">
          <span className="hb-kicker">AI explanations</span>
          <strong className="hbd-serif">Grounded</strong>
          <p>Bifrost only explains supplied OSV evidence and cites advisory IDs. With no evidence, no AI is called.</p>
        </div>
      </div>

      <div className="hbd-philosophy">
        <h4 className="hbd-serif">How DepShield works</h4>
        <ol>
          <li><CheckCircle2 size={15} /> Exact package names and versions are read from manifests, without running build scripts.</li>
          <li><CheckCircle2 size={15} /> Each pinned version is matched against OSV.dev to find known advisories.</li>
          <li><CheckCircle2 size={15} /> Bifrost explains the matched advisories with the model you choose.</li>
          <li><CheckCircle2 size={15} /> The CLI checks new packages before they are installed.</li>
        </ol>
      </div>
    </section>
  )
}
