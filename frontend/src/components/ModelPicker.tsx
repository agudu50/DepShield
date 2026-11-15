import { useEffect, useMemo, useState } from 'react'
import { Activity, AlertTriangle, Cpu, Lock, RefreshCw } from 'lucide-react'
import { checkBifrostHealth, listAIModels, type AIModel, type AIModelCatalog, type BifrostHealth } from '../api'

const STORAGE_KEY = 'depshield.ai-model'

const PROVIDER_LABEL: Record<string, string> = {
  openai: 'OpenAI',
  anthropic: 'Anthropic',
  gemini: 'Google',
  vertex: 'Vertex',
  bedrock: 'Bedrock',
  mistral: 'Mistral',
  groq: 'Groq',
  ollama: 'Ollama',
  openrouter: 'OpenRouter',
  cerebras: 'Cerebras',
}
const label = (p: string) => PROVIDER_LABEL[p] ?? p

const FREE_TAB = '__free__'
const TIER_BADGE: Record<string, { text: string; title: string }> = {
  local: { text: 'free · local', title: 'Runs on your machine via Ollama, with no API key and no cost' },
  free: { text: 'free', title: 'Free model on this provider (rate limited)' },
  free_tier: { text: 'free tier', title: 'Free API key from the provider, with rate limits' },
}
const isFree = (tier?: string) => tier === 'local' || tier === 'free' || tier === 'free_tier'
const usable = (m: AIModel) => m.available !== false

function readStored(): string | null {
  try {
    return localStorage.getItem(STORAGE_KEY)
  } catch {
    return null
  }
}

function writeStored(model: string) {
  try {
    localStorage.setItem(STORAGE_KEY, model)
  } catch {
    /* storage unavailable: selection just won't persist */
  }
}

/** Prefer the given choice if it can actually run; otherwise the first model that can. */
function pickUsable(c: AIModelCatalog, preferred: (string | null)[]): string {
  for (const id of preferred) {
    const m = id ? c.models.find((x) => x.id === id) : undefined
    if (m && usable(m)) return m.id
  }
  return c.models.find(usable)?.id ?? c.default
}

interface ModelPickerProps {
  value: string | null
  onChange: (model: string) => void
}

/** Provider tabs + model chips, driven by the backend allowlist and the gateway's real provider setup. */
export default function ModelPicker({ value, onChange }: ModelPickerProps) {
  const [catalog, setCatalog] = useState<AIModelCatalog | null>(null)
  const [loaded, setLoaded] = useState(false)
  const [checking, setChecking] = useState(false)
  const [provider, setProvider] = useState<string>('')
  const [probe, setProbe] = useState<{ model: string; result: BifrostHealth } | null>(null)
  const [probing, setProbing] = useState(false)

  async function load(refresh: boolean, attempt = 0) {
    setChecking(true)
    const c = await listAIModels(refresh)
    // One quiet retry covers the backend restarting (dev auto-reload) or a slow first response.
    if (!c && attempt === 0) {
      window.setTimeout(() => void load(refresh, 1), 2500)
      return
    }
    setChecking(false)
    setLoaded(true)
    if (!c) return
    setCatalog(c)
    const chosen = pickUsable(c, [value, readStored(), c.default])
    if (chosen !== value) onChange(chosen)
    setProvider((cur) => cur || (c.models.find((m) => m.id === chosen)?.provider ?? c.models[0]?.provider ?? ''))
  }

  useEffect(() => {
    void load(false)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const providers = useMemo(() => {
    if (!catalog) return []
    const list = Array.from(new Set(catalog.models.map((m) => m.provider)))
    // Set-up providers first, so what you can use is what you see first.
    list.sort((a, b) => {
      const ua = catalog.models.some((m) => m.provider === a && usable(m)) ? 0 : 1
      const ub = catalog.models.some((m) => m.provider === b && usable(m)) ? 0 : 1
      return ua - ub
    })
    return catalog.models.some((m) => isFree(m.tier)) ? [FREE_TAB, ...list] : list
  }, [catalog])

  if (!catalog) {
    return (
      <div className="model-picker model-picker-empty" role="status">
        <Cpu size={14} />
        {loaded ? (
          <>
            <span>Couldn’t load the model list from DepShield. Audits still work; the default model will be used.</span>
            <button type="button" className="hbd-link" onClick={() => void load(false)} disabled={checking}>
              {checking ? 'Retrying…' : 'Retry'}
            </button>
          </>
        ) : (
          <span>Loading models…</span>
        )}
      </div>
    )
  }

  function select(m: AIModel) {
    if (!usable(m)) return
    onChange(m.id)
    writeStored(m.id)
    setProbe(null)
  }

  async function runProbe() {
    if (!value) return
    setProbing(true)
    try {
      setProbe({ model: value, result: await checkBifrostHealth(value) })
    } finally {
      setProbing(false)
    }
  }

  const visible = catalog.models.filter((m) => (provider === FREE_TAB ? isFree(m.tier) : m.provider === provider))
  const probeResult = probe && probe.model === value ? probe.result : null
  const providerOff = (p: string) => catalog.models.filter((m) => m.provider === p).every((m) => m.available === false)
  const readyProviders = Array.from(new Set(catalog.models.filter((m) => m.available === true).map((m) => label(m.provider))))
  const someOff = catalog.models.some((m) => m.available === false)

  return (
    <div className="model-picker">
      <div className="model-picker-head">
        <span className="directives-label">
          <Cpu size={14} />
          <span>AI Model (via Bifrost):</span>
        </span>
        <div className="model-provider-tabs" role="tablist" aria-label="AI provider">
          {providers.map((p) => {
            const off = p !== FREE_TAB && providerOff(p)
            return (
              <button
                key={p}
                type="button"
                role="tab"
                aria-selected={provider === p}
                className={`ss-filter-pill ${provider === p ? 'active' : ''} ${off ? 'is-off' : ''}`}
                onClick={() => setProvider(p)}
                title={off ? `${label(p)} isn’t set up in your Bifrost gateway` : undefined}
              >
                {off && <Lock size={10} aria-hidden="true" />}
                {p === FREE_TAB ? 'Free' : label(p)}
              </button>
            )
          })}
        </div>
      </div>

      {/* What can actually run right now */}
      {catalog.availability === 'unreachable' ? (
        <p className="mp-note is-warn" role="status">
          <AlertTriangle size={13} />
          <span>
            Bifrost isn’t running at <code>localhost:8080</code>, so AI explanations are off. Audits still work from OSV.dev
            data. Start it with <code>npx -y @maximhq/bifrost</code>, then re-check.
          </span>
          <button type="button" className="hbd-link" onClick={() => void load(true)} disabled={checking}>
            {checking ? 'Checking…' : 'Re-check'}
          </button>
        </p>
      ) : someOff ? (
        <p className="mp-note" role="status">
          <span>
            {readyProviders.length ? (
              <>
                Available now: <strong>{readyProviders.join(', ')}</strong>. Other providers need an API key added in
                Bifrost (<code>localhost:8080</code> → Providers).
              </>
            ) : (
              <>No provider is set up in Bifrost yet. Add an API key at <code>localhost:8080</code> → Providers.</>
            )}
          </span>
          <button type="button" className="hbd-link" onClick={() => void load(true)} disabled={checking}>
            {checking ? 'Checking…' : 'Re-check'}
          </button>
        </p>
      ) : null}

      <div className="model-chip-row" role="radiogroup" aria-label="Model">
        {visible.map((m) => {
          const off = m.available === false
          return (
            <button
              key={m.id}
              type="button"
              role="radio"
              aria-checked={value === m.id}
              aria-disabled={off}
              disabled={off}
              className={`model-chip ${value === m.id ? 'active' : ''} ${off ? 'is-unavailable' : ''}`}
              onClick={() => select(m)}
              title={off ? `Not available: add a ${label(m.provider)} API key in Bifrost to use ${m.name}.` : m.id}
            >
              {provider === FREE_TAB && <span className="model-chip-provider">{label(m.provider)}</span>}
              <span>{m.name}</span>
              {off ? (
                <span className="model-chip-badge off">not set up</span>
              ) : (
                m.tier && TIER_BADGE[m.tier] && (
                  <span className="model-chip-badge free" title={TIER_BADGE[m.tier].title}>
                    {TIER_BADGE[m.tier].text}
                  </span>
                )
              )}
              {m.id === catalog.default && <span className="model-chip-badge">default</span>}
            </button>
          )
        })}
      </div>

      <div className="model-picker-foot">
        <code className="model-picker-id">{value}</code>
        <button type="button" className="preset-btn" onClick={runProbe} disabled={probing || !value}>
          {probing ? <RefreshCw size={12} className="animate-spin" /> : <Activity size={12} />}
          <span>{probing ? 'Testing…' : 'Test model'}</span>
        </button>
        {probeResult && (
          <span className={`provenance-chip ${probeResult.status === 'live' ? 'live' : 'fallback'}`}>
            {probeResult.status === 'live'
              ? `Live · ${probeResult.model} · ${probeResult.latency_ms}ms`
              : probeResult.status === 'unreachable'
                ? 'Gateway/provider did not answer'
                : probeResult.status === 'backend_offline'
                  ? 'Backend offline'
                  : 'Bifrost not configured'}
          </span>
        )}
        {catalog.fallbacks.length > 0 && (
          <span className="model-picker-fallback">Fallback: {catalog.fallbacks.join(' → ')}</span>
        )}
      </div>
    </div>
  )
}
