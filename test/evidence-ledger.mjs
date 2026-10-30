// 证据账本冒烟测试：不依赖 DSH 宿主，只验证移植过来的模块能真的落库、核对、升级。
import { DatabaseSync } from 'node:sqlite'
import { EvidenceLedger, UnknownRegistry, evidenceId } from 'file:///D:/DSHDev/AGY/dsh-purge-plus/lib/redteam/evidence-ledger.mjs'

const db = new DatabaseSync(':memory:')
const ledger = new EvidenceLedger(db)
const unknowns = new UnknownRegistry(db)

const input = {
  engagement_id: 'eng-1',
  operation: 'nmap_scan',
  parameters: { target: '10.0.0.5' },
  result: { ports: [22, 80] },
  confidence: 'claimed',
  authority: 'subagent-report',
  summary: '子智能体报告 10.0.0.5 开放 22/80',
}

const rec = ledger.record(input)
const id = rec.ev_id
console.log('record       ->', rec.ok, id.slice(0, 12) + '…', 'duplicate=' + rec.duplicate)

console.log('id 稳定性     ->', evidenceId({ operation: 'nmap_scan' }) === evidenceId({ operation: 'nmap_scan' }))
console.log('重复记录      ->', JSON.stringify(ledger.record(input)).includes('"duplicate":true'))

// 同一语义重算哈希 → 与库里那条对上，说明"子智能体说的"和"库里记的"可核对
const ver = ledger.verify({ operation: 'nmap_scan', parameters: { target: '10.0.0.5' }, result: { ports: [22, 80] }, confidence: 'claimed', authority: 'subagent-report' })
console.log('verify 命中   ->', ver.matched, ver.ev_id === id)

// claimed 必须核实后才能升级成 observed
const up = ledger.upgrade({ claimed_ev_id: id, verified_by: 'coordinator', verified_result: { ports: [22, 80], banner: 'OpenSSH 9.6' } })
console.log('upgrade       ->', up.ok, up.ev_id ? 'new ev_id' : up.error)
console.log('升级后条数    ->', ledger.list({ engagement_id: 'eng-1' }).length)
console.log('未核实计数    ->', ledger.countUnverified('eng-1'))

const unk = unknowns.record({ engagement_id: 'eng-1', question: '10.0.0.7:22 是 SSH 但还没试出凭据', severity: 'medium', domain: 'network' })
console.log('unknown 记录  ->', unk.ok, unk.unk_id.slice(0, 12) + '…')
console.log('unknown 列表  ->', unknowns.list({ engagement_id: 'eng-1' }).length)
const res = unknowns.resolve(unk.unk_id, 'resolved', '用泄露口令登入成功')
console.log('unknown 收口  ->', JSON.stringify(res).slice(0, 90))

console.log('SMOKE OK')
