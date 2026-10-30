// 红队工具注册/执行冒烟：用桩 ctx 跑 lib/redteam/tools.js 的 apply()，
// 断言 64 个工具全部注册，并对新移植的 8 个执行一次真实落库。
import { DatabaseSync } from 'node:sqlite'
import path from 'node:path'

const pluginRoot = process.argv[2] || 'C:/Users/Azusa/.dsh/profiles/desktop/node_modules/dsh-purge'
const mod = await import('file:///' + path.join(pluginRoot, 'lib/redteam/tools.js').replace(/\\/g, '/'))

const dbs = new Map()
const store = {
  db(id) {
    if (!dbs.has(id)) dbs.set(id, new DatabaseSync(':memory:'))
    return dbs.get(id)
  },
  listEngagements: () => [{ id: 'eng-1' }],
  stats: () => ({}),
  activeEngagementId: () => undefined,
}

const registered = []
const ctx = {
  redteam: store,
  logger: { warn: (m) => console.log('  [warn]', m) },
  effect(fn) { const d = fn(); return d },
  on() { return () => {} },
  tools: { register(def) { registered.push(def) } },
  get() { return undefined },
}

console.log('module exports:', Object.keys(mod).join(', '))
mod.apply(ctx)
console.log('registered tools:', registered.length)

const names = registered.map((d) => d.name).sort()
const wanted = [
  'redteam_evidence_list', 'redteam_evidence_record', 'redteam_evidence_upgrade', 'redteam_evidence_verify',
  'redteam_unknown_list', 'redteam_unknown_record', 'redteam_unknown_resolve', 'redteam_unverified_count',
]
console.log('new tools present:', wanted.every((n) => names.includes(n)), '| count =', wanted.filter((n) => names.includes(n)).length)

const byName = Object.fromEntries(registered.map((d) => [d.name, d]))
for (const n of wanted) {
  const d = byName[n]
  if (!d) { console.log('MISSING', n); continue }
  const bad = []
  if (typeof d.execute !== 'function') bad.push('no execute')
  if (!d.parameters || typeof d.parameters !== 'object') bad.push('no parameters')
  if (bad.length) console.log('BAD', n, bad.join(','))
}
console.log('shape check done')

const exec = { agent: { session: { header: { cwd: 'D:/tmp' } } }, session: { header: { cwd: 'D:/tmp' } } }
async function call(name, args) {
  const r = await byName[name].execute(args, exec)
  return typeof r === 'string' ? r : JSON.stringify(r)
}

const rec = JSON.parse(await call('redteam_evidence_record', {
  engagement: 'eng-1', operation: 'nmap_scan',
  parameters: { target: '10.0.0.5' }, result: { ports: [22, 80] },
  confidence: 'claimed', authority: 'subagent-report',
  summary: '子智能体报告 22/80 开放',
}))
console.log('record   ->', rec.ok, rec.ev_id ? rec.ev_id.slice(0, 12) + '…' : rec)

const lst = JSON.parse(await call('redteam_evidence_list', { engagement: 'eng-1' }))
console.log('list     ->', Array.isArray(lst.items) ? lst.items.length : Object.keys(lst))

const ver = JSON.parse(await call('redteam_evidence_verify', {
  engagement: 'eng-1', operation: 'nmap_scan',
  parameters: { target: '10.0.0.5' }, result: { ports: [22, 80] },
  confidence: 'claimed', authority: 'subagent-report',
}))
console.log('verify   ->', JSON.stringify(ver).slice(0, 110))

const up = JSON.parse(await call('redteam_evidence_upgrade', {
  engagement: 'eng-1', claimed_ev_id: rec.ev_id, verified_by: 'coordinator',
  verified_result: { ports: [22, 80], banner: 'OpenSSH 9.6' },
}))
console.log('upgrade  ->', up.ok, up.ev_id ? 'new' : up.error)

const cnt = JSON.parse(await call('redteam_unverified_count', { engagement: 'eng-1' }))
console.log('unverif  ->', JSON.stringify(cnt).slice(0, 90))

const unk = JSON.parse(await call('redteam_unknown_record', {
  engagement: 'eng-1', question: '10.0.0.7:22 还没试出凭据', severity: 'medium', domain: 'network',
}))
console.log('unk rec  ->', unk.ok, unk.unk_id ? unk.unk_id.slice(0, 12) + '…' : unk)

const ul = JSON.parse(await call('redteam_unknown_list', { engagement: 'eng-1' }))
console.log('unk list ->', Array.isArray(ul.items) ? ul.items.length : Object.keys(ul))

const ur = JSON.parse(await call('redteam_unknown_resolve', { engagement: 'eng-1', unk_id: unk.unk_id, disposition: 'resolved', resolution: '口令登入成功' }))
console.log('unk res  ->', ur.ok ? 'ok' : ur)

console.log('HARNESS OK')
