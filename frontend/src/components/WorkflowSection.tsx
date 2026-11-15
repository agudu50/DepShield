import { useEffect, useRef, useState } from 'react'
import { ArrowRight, Check, ChevronDown, Copy, Github, Globe, Terminal } from 'lucide-react'
import '../workflow.css'

type Tab = 'web' | 'cli'
type Os = 'windows' | 'unix' | 'pip'

const REPO = 'https://github.com/agudu50/DepShield.git'

const OS_LABEL: Record<Os, string> = { windows: 'Windows', unix: 'macOS & Linux', pip: 'pip / pipx' }
const INSTALL: Record<Os, string> = { windows: '.\\install-cli.ps1', unix: './install-cli.sh', pip: 'pip install -e ./cli' }
const UNINSTALL: Record<Os, string> = { windows: '.\\uninstall-cli.ps1', unix: './uninstall-cli.sh', pip: 'pip uninstall depshield-cli' }

const WEB_STEPS = [
  { title: 'Connect GitHub', body: 'Paste a token with read access. It stays in this browser.', tag: 'Token' },
  { title: 'Pick a repository', body: 'DepShield finds its manifests and lockfiles. Choose one or several.', tag: 'Manifests' },
  { title: 'Run the audit', body: 'Exact versions are checked against OSV.dev, and Bifrost explains what it finds.', tag: 'OSV + Bifrost' },
  { title: 'Fix with confidence', body: 'Each package gets a safe target version and a ready-to-copy upgrade command.', tag: 'Fixes' },
]

const CLI_STEPS = [
  { title: 'Sign in to GitHub', body: 'Saves the token in your OS keychain.', cmd: 'depshield github login --token <PAT>' },
  { title: 'Check before you install', body: 'Looks the package up on OSV.dev first, with install scripts disabled.', cmd: 'depshield add express@4.18.2' },
  { title: 'Watch your lockfiles', body: 'Re-checks your project whenever a lockfile changes. Ctrl + C to stop.', cmd: 'depshield monitor' },
  { title: 'Audit a repository', body: 'Runs the same audit as the dashboard, from your terminal.', cmd: 'depshield github analyze owner/repo' },
]

function detectOs(): Os {
  const p = (navigator.platform || navigator.userAgent).toLowerCase()
  return p.includes('win') ? 'windows' : 'unix'
}

function useCopy() {
  const [copied, setCopied] = useState<string | null>(null)
  const timer = useRef<number | undefined>(undefined)
  async function copy(text: string) {
    try {
      await navigator.clipboard.writeText(text)
      setCopied(text)
      window.clearTimeout(timer.current)
      timer.current = window.setTimeout(() => setCopied(null), 1600)
    } catch {
      /* clipboard unavailable */
    }
  }
  return { copied, copy }
}

function CopyLine({ cmd, copied, onCopy, comment }: { cmd: string; copied: string | null; onCopy: (c: string) => void; comment?: string }) {
  return (
    <button type="button" className="hwf-line" onClick={() => onCopy(cmd)} aria-label={`Copy: ${cmd}`}>
      {comment && <span className="hwf-comment"># {comment}</span>}
      <span className="hwf-cmd">
        <span className="hwf-prompt">$</span> {cmd}
      </span>
      <span className="hwf-copy">{copied === cmd ? <Check size={13} /> : <Copy size={13} />}</span>
    </button>
  )
}

interface WorkflowSectionProps {
  tab: Tab
  onTab: (tab: Tab) => void
  onConnect: () => void
}

export default function WorkflowSection({ tab, onTab, onConnect }: WorkflowSectionProps) {
  const [os, setOs] = useState<Os>('unix')
  const { copied, copy } = useCopy()
  const tabsRef = useRef<HTMLDivElement>(null)
  const [indicator, setIndicator] = useState({ left: 0, width: 0 })

  useEffect(() => setOs(detectOs()), [])
  useEffect(() => {
    const btn = tabsRef.current?.querySelector<HTMLElement>(`[data-tab="${tab}"]`)
    if (btn) setIndicator({ left: btn.offsetLeft, width: btn.offsetWidth })
  }, [tab])

  const installScript = [`git clone ${REPO}`, 'cd DepShield', INSTALL[os]].join('\n')

  return (
    <section id="sw-workflow" className="sw-section hwf">
      <div className="sw-section-inner">
        <div className="hwf-head">
          <div>
            <span className="hb-kicker"><span className="hb-kicker-n">02</span> Workflow</span>
            <h2 className="hwf-title">
              Two ways in.
              <br />
              <em>Same guarantees.</em>
            </h2>
          </div>
          <p className="hwf-sub">
            Audit from the web dashboard, or run the same checks from your terminal. Either way, only manifests are read.
          </p>
        </div>

        <div className="hwf-tabs" role="tablist" aria-label="Workflow" ref={tabsRef}>
          <span className="hwf-tab-indicator" style={{ transform: `translateX(${indicator.left}px)`, width: indicator.width }} aria-hidden="true" />
          <button type="button" role="tab" data-tab="web" aria-selected={tab === 'web'} className={tab === 'web' ? 'active' : ''} onClick={() => onTab('web')}>
            <Globe size={15} /> Web dashboard
          </button>
          <button type="button" role="tab" data-tab="cli" aria-selected={tab === 'cli'} className={tab === 'cli' ? 'active' : ''} onClick={() => onTab('cli')}>
            <Terminal size={15} /> Developer CLI
          </button>
        </div>

        {tab === 'web' ? (
          <div className="hwf-pane" key="web">
            <ol className="hwf-steps">
              {WEB_STEPS.map((s, i) => (
                <li key={s.title} className="hwf-step" style={{ '--i': i } as React.CSSProperties}>
                  <span className="hwf-step-n">{String(i + 1).padStart(2, '0')}</span>
                  <h3>{s.title}</h3>
                  <p>{s.body}</p>
                  <span className="hb-chip">{s.tag}</span>
                </li>
              ))}
            </ol>
            <div className="hwf-cta">
              <button type="button" className="hb-btn hb-btn-primary" onClick={onConnect} aria-haspopup="dialog">
                <Github size={16} /> Connect GitHub <ArrowRight size={15} className="hb-btn-arrow" />
              </button>
              <span>Takes about a minute. No install needed.</span>
            </div>
          </div>
        ) : (
          <div className="hwf-pane" key="cli">
            <div className="hwf-install">
              <div className="hwf-install-copy">
                <span className="hb-kicker">Step 1 · Install once</span>
                <h3 className="hwf-h3">Install the CLI from source</h3>
                <p>
                  DepShield isn’t on PyPI yet, so you install it from the repository. The installer adds{' '}
                  <code>depshield</code> to your PATH without admin rights; then it works in any folder.
                </p>
                <details className="hwf-why">
                  <summary>
                    Why from source? <ChevronDown size={13} />
                  </summary>
                  <ul>
                    <li><strong>Not on PyPI yet.</strong> The repository is the official distribution for now.</li>
                    <li><strong>Launchers included.</strong> PowerShell, Bash and CMD launchers live in <code>bin/</code>.</li>
                    <li><strong>Inspectable and removable.</strong> Read the manifest parsers, run the tests, and uninstall in seconds.</li>
                  </ul>
                </details>
              </div>

              <div className="hwf-term" aria-label="Install commands">
                <div className="hwf-term-bar">
                  <span className="hwf-dots" aria-hidden="true"><i /><i /><i /></span>
                  <div className="hwf-os" role="tablist" aria-label="Operating system">
                    {(Object.keys(OS_LABEL) as Os[]).map((o) => (
                      <button key={o} type="button" role="tab" aria-selected={os === o} className={os === o ? 'active' : ''} onClick={() => setOs(o)}>
                        {OS_LABEL[o]}
                      </button>
                    ))}
                  </div>
                  <button type="button" className="hwf-copy-all" onClick={() => void copy(installScript)}>
                    {copied === installScript ? <Check size={12} /> : <Copy size={12} />} {copied === installScript ? 'Copied' : 'Copy all'}
                  </button>
                </div>
                <div className="hwf-term-body" key={os}>
                  <CopyLine cmd={`git clone ${REPO}`} comment="get the source" copied={copied} onCopy={(c) => void copy(c)} />
                  <CopyLine cmd="cd DepShield" copied={copied} onCopy={(c) => void copy(c)} />
                  <CopyLine cmd={INSTALL[os]} comment="install the CLI" copied={copied} onCopy={(c) => void copy(c)} />
                  <CopyLine cmd="depshield --version" comment="check it worked" copied={copied} onCopy={(c) => void copy(c)} />
                </div>
                <div className="hwf-term-foot">
                  <span>No clone needed:</span>
                  <CopyLine
                    cmd={`pip install "git+${REPO}#subdirectory=cli"`}
                    copied={copied}
                    onCopy={(c) => void copy(c)}
                  />
                </div>
              </div>
            </div>

            <div className="hwf-use">
              <span className="hb-kicker">Step 2 · Use it anywhere</span>
              <div className="hwf-cmd-grid">
                {CLI_STEPS.map((s, i) => (
                  <div key={s.cmd} className="hwf-cmd-card" style={{ '--i': i } as React.CSSProperties}>
                    <span className="hwf-step-n sm">{String(i + 1).padStart(2, '0')}</span>
                    <div>
                      <h4>{s.title}</h4>
                      <p>{s.body}</p>
                    </div>
                    <CopyLine cmd={s.cmd} copied={copied} onCopy={(c) => void copy(c)} />
                  </div>
                ))}
              </div>
            </div>

            <div className="hwf-teardown">
              <span className="hb-kicker">Done? Clean up</span>
              <div className="hwf-teardown-row">
                <div>
                  <strong>Stop</strong>
                  <p>Press <kbd>Ctrl</kbd> + <kbd>C</kbd> to end <code>depshield monitor</code>. One-off commands exit on their own.</p>
                </div>
                <div>
                  <strong>Sign out</strong>
                  <p>Remove the GitHub token from your keychain.</p>
                  <CopyLine cmd="depshield github logout" copied={copied} onCopy={(c) => void copy(c)} />
                </div>
                <div>
                  <strong>Uninstall</strong>
                  <p>Removes the PATH entry, launchers and package ({OS_LABEL[os]}).</p>
                  <CopyLine cmd={UNINSTALL[os]} copied={copied} onCopy={(c) => void copy(c)} />
                </div>
              </div>
            </div>
          </div>
        )}
      </div>
    </section>
  )
}
