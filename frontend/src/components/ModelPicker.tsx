import { useEffect, useMemo, useState } from 'react'
import { Activity, Cpu, RefreshCw } from 'lucide-react'
import { checkBifrostHealth, listAIModels, type AIModelCatalog, type BifrostHealth } from '../api'

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

const FREE_TAB = '__free__'
const TIER_BADGE: Record<string, { text: string; title: string }> = {
  local: { text: 'free · local', title: 'Runs on your machine via Ollama, with no API key and no cost' },
  free: { text: 'free', title: 'Free model on this provider (rate limited)' },
  free_tier: { text: 'free tier', title: 'Free API key from the provider, with rate limits' },
}
const isFree = (tier?: string) => tier === 'local' || tier === 'free' || tier === 'free_tier'

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

interface ModelPickerProps {
  value: string | null
  onChange: (model: string) => void
}

/** Provider tabs + model chips, driven by the backend allowlist. Includes a real per-model probe. */
export default function ModelPicker({ value, onChange }: ModelPickerProps) {
  const [catalog, setCatalog] = useState<AIModelCatalog | null>(null)
  const [provider, setProvider] = useState<string>('')
  const [probe, setProbe] = useState<{ model: string; result: BifrostHealth } | null>(null)
  const [probing, setProbing] = useState(false)

  useEffect(() => {
    let cancelled = false
    listAIModels().then((c) => {
      if (cancelled || !c) return
      setCatalog(c)
      const stored = readStored()
      const initial = value ?? (stored && c.models.some((m) => m.id === stored) ? stored : c.default)
      onChange(initial)
      setProvider(c.models.find((m) => m.id === initial)?.provider ?? c.models[0]?.provider ?? '')
    })
    return () => {
      cancelled = true
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const providers = useMemo(() => {
    if (!catalog) return []
    const list = Array.from(new Set(catalog.models.map((m) => m.provider)))
    return catalog.models.some((m) => isFree(m.tier)) ? [FREE_TAB, ...list] : list
  }, [catalog])

  if (!catalog) {
    return (
      <div className="model-picker model-picker-empty">
        <Cpu size={14} /> Model list unavailable: start the backend to choose an AI model.
      </div>
    )
  }

  function select(id: string) {
    onChange(id)
    writeStored(id)
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

  return (
    <div className="model-picker">
      <div className="model-picker-head">
        <span className="directives-label">
          <Cpu size={14} />
          <span>AI Model (via Bifrost):</span>
        </span>
        <div className="model-provider-tabs" role="tablist" aria-label="AI provider">
          {providers.map((p) => (
            <button
              key={p}
              type="button"
              role="tab"
              aria-selected={provider === p}
              className={`ss-filter-pill ${provider === p ? 'active' : ''}`}
              onClick={() => setProvider(p)}
            >
              {p === FREE_TAB ? 'Free' : (PROVIDER_LABEL[p] ?? p)}
            </button>
          ))}
        </div>
      </div>

      <div className="model-chip-row" role="radiogroup" aria-label="Model">
        {visible.map((m) => (
          <button
            key={m.id}
            type="button"
            role="radio"
            aria-checked={value === m.id}
            className={`model-chip ${value === m.id ? 'active' : ''}`}
            onClick={() => select(m.id)}
            title={m.id}
          >
            {provider === FREE_TAB && <span className="model-chip-provider">{PROVIDER_LABEL[m.provider] ?? m.provider}</span>}
            <span>{m.name}</span>
            {m.tier && TIER_BADGE[m.tier] && (
              <span className="model-chip-badge free" title={TIER_BADGE[m.tier].title}>
                {TIER_BADGE[m.tier].text}
              </span>
            )}
            {m.id === catalog.default && <span className="model-chip-badge">default</span>}
          </button>
        ))}
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
