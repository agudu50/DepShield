import type { LucideIcon } from 'lucide-react'
import {
  Boxes,
  Cpu,
  Database,
  EyeOff,
  FileCode2,
  FileText,
  Fingerprint,
  Github,
  KeyRound,
  Lock,
  Package,
  Rainbow,
  ScrollText,
  ShieldCheck,
  Sparkles,
} from 'lucide-react'

type Item = { label: string; icon: LucideIcon }

const SOURCES: Item[] = [
  { label: 'OSV.dev advisories', icon: Database },
  { label: 'GitHub repos', icon: Github },
  { label: 'npm', icon: Package },
  { label: 'PyPI', icon: Boxes },
  { label: 'package-lock.json', icon: FileCode2 },
  { label: 'uv.lock', icon: Lock },
  { label: 'requirements.txt', icon: FileText },
  { label: 'poetry.lock', icon: FileCode2 },
  { label: 'GHSA & CVE IDs', icon: Fingerprint },
]

const GUARANTEES: Item[] = [
  { label: 'Bifrost gateway', icon: Rainbow },
  { label: 'OpenAI · Anthropic · Groq', icon: Cpu },
  { label: 'Free models supported', icon: Sparkles },
  { label: 'Zero source ingestion', icon: EyeOff },
  { label: 'Pre-install gate', icon: ShieldCheck },
  { label: 'Read-only token scope', icon: KeyRound },
  { label: 'Every file read is logged', icon: ScrollText },
]

function Row({ items, variant, reverse }: { items: Item[]; variant: 'outline' | 'solid'; reverse?: boolean }) {
  return (
    <div className={`hb-strip-row hb-strip-${variant}`}>
      <div className={`hb-strip-track ${reverse ? 'is-reverse' : ''}`}>
        {[0, 1].map((copy) => (
          <div className="hb-strip-group" key={copy}>
            {items.map(({ label, icon: Icon }) => (
              <span className="hb-strip-item" key={label}>
                <Icon size={15} strokeWidth={1.75} />
                {label}
                <span className="hb-strip-sep">✦</span>
              </span>
            ))}
          </div>
        ))}
      </div>
    </div>
  )
}

/** Two crossing ribbons on a slight 3D tilt: what DepShield reads, and what it guarantees. */
export default function SourcesStrip() {
  return (
    <div className="hb-strip" aria-label="Data sources: OSV.dev, GitHub, npm, PyPI and common lockfiles. Reasoning through the Bifrost gateway with zero source ingestion.">
      <div className="hb-strip-stage" aria-hidden="true">
        <Row items={SOURCES} variant="outline" />
        <Row items={GUARANTEES} variant="solid" reverse />
      </div>
    </div>
  )
}
