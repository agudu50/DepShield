export type Finding = {
  key: string
  packageName: string
  version: string
  id: string
  aliases: string[]
  summary: string
  status: string
  ecosystem?: string
}

function download(filename: string, mime: string, body: string) {
  const url = URL.createObjectURL(new Blob([body], { type: mime }))
  const a = document.createElement('a')
  a.href = url
  a.download = filename
  document.body.appendChild(a)
  a.click()
  a.remove()
  window.setTimeout(() => URL.revokeObjectURL(url), 1000)
}

const stamp = () => new Date().toISOString().slice(0, 10)

function csvCell(value: string) {
  // Quote everything; neutralise spreadsheet formula injection.
  const safe = /^[=+\-@\t\r]/.test(value) ? `'${value}` : value
  return `"${safe.replace(/"/g, '""')}"`
}

export function exportFindingsCsv(findings: Finding[], label: string) {
  const header = ['package', 'version', 'advisory_id', 'aliases', 'summary', 'osv_url']
  const rows = findings.map((f) => [
    f.packageName,
    f.version,
    f.id,
    f.aliases.join(' '),
    f.summary,
    `https://osv.dev/vulnerability/${f.id}`,
  ])
  const body = [header, ...rows].map((r) => r.map(csvCell).join(',')).join('\r\n')
  download(`depshield-${label}-${stamp()}.csv`, 'text/csv;charset=utf-8', body)
}

export function exportJson(data: unknown, label: string) {
  download(`depshield-${label}-${stamp()}.json`, 'application/json', JSON.stringify(data, null, 2))
}
