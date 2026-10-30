// profile 自愈/收口的离线验证：全部在临时目录里跑，不碰真实 $DSH_HOME。
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'

const root = process.argv[2]
const mods = {
  heal: await import('file:///' + path.join(root, 'lib/profile-heal.js').replace(/\\/g, '/')),
  insert: await import('file:///' + path.join(root, 'lib/profile-insert.js').replace(/\\/g, '/')),
  preset: await import('file:///' + path.join(root, 'lib/preset-default.js').replace(/\\/g, '/')),
}

function tmpHome(name) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'purge-verify-' + name + '-'))
  fs.mkdirSync(path.join(dir, 'profiles', 'desktop'), { recursive: true })
  return dir
}
function write(p, s) { fs.mkdirSync(path.dirname(p), { recursive: true }); fs.writeFileSync(p, s, 'utf8') }
function read(p) { try { return fs.readFileSync(p, 'utf8') } catch { return '' } }

let fails = 0
function check(label, cond, detail) {
  console.log((cond ? '  ok   ' : '  FAIL ') + label + (detail ? '  [' + detail + ']' : ''))
  if (!cond) fails += 1
}

/* ── A. healProfiles 幂等 ───────────────────────────────────────────── */
{
  const home = tmpHome('heal')
  const profile = path.join(home, 'profiles', 'desktop')
  write(path.join(profile, 'package.json'), JSON.stringify({ name: 'p', dependencies: { 'dsh-purge': '1.0.0' } }, null, 2))
  write(path.join(profile, 'pnpm-workspace.yaml'), 'packages:\n  - .\n\nnodeLinker: hoisted\n')

  const a = mods.heal.healProfiles(home)
  const b = mods.heal.healProfiles(home)
  const yml = read(path.join(profile, 'pnpm-workspace.yaml'))
  check('A1 第一次写入 allowBuilds', a[0]?.pnpm?.wrote === true)
  check('A2 第二次不再写（幂等）', b[0]?.pnpm?.wrote === false)
  check('A3 allowBuilds 用裸包名', /allowBuilds[\s\S]*dsh-purge:\s*true/.test(yml) && !/dsh-purge@/.test(yml), JSON.stringify(yml))
  check('A4 保留原有 nodeLinker', yml.includes('nodeLinker: hoisted'))
  check('A5 没误建 cordis.patch.yml', !fs.existsSync(path.join(profile, 'cordis.patch.yml')))
}

/* ── B. #185：历史 URL 键必须被清掉 ─────────────────────────────────── */
{
  const home = tmpHome('legacy')
  const profile = path.join(home, 'profiles', 'desktop')
  write(path.join(profile, 'package.json'), JSON.stringify({ name: 'p', dependencies: { 'dsh-purge': 'x' } }))
  write(path.join(profile, 'pnpm-workspace.yaml'),
    'packages:\n  - .\n\nallowBuilds:\n  dsh-purge@https://github.com/a/b/archive/refs/heads/main.tar.gz: true\n  dsh-purge@https: true\n  other-pkg: true\n')
  mods.heal.healProfiles(home)
  const yml = read(path.join(profile, 'pnpm-workspace.yaml'))
  check('B1 URL 键被清掉', !yml.includes('dsh-purge@https'))
  check('B2 裸包名就位', /dsh-purge:\s*true/.test(yml))
  check('B3 别人的键保留', yml.includes('other-pkg: true'), JSON.stringify(yml))
}

/* ── C. #191：`[]` 的 profile patch 是替换而不是追加 ────────────────── */
{
  const home = tmpHome('flow')
  const profile = path.join(home, 'profiles', 'desktop')
  write(path.join(profile, 'package.json'), JSON.stringify({ name: 'p', dependencies: { 'dsh-purge': 'x' } }))
  write(path.join(profile, 'cordis.patch.yml'), '[]\n')
  const r1 = mods.insert.ensureProfileBodyInsert(profile)
  const text1 = read(path.join(profile, 'cordis.patch.yml'))
  check('C1 首次写入', r1.wrote === true, JSON.stringify(r1))
  check('C2 不残留单独一行的 []', !/^\[\]\s*$/m.test(text1), JSON.stringify(text1.slice(0, 80)))
  check('C3 只有一个 YAML 文档（无 --- 分隔）', !/^---\s*$/m.test(text1))
  check('C4 含 dsh-purge insert', text1.includes('dsh-purge'))
  const r2 = mods.insert.ensureProfileBodyInsert(profile)
  check('C5 二次调用幂等', r2.wrote === false)

  const home2 = tmpHome('flow2')
  const p2 = path.join(home2, 'profiles', 'desktop')
  write(path.join(p2, 'package.json'), JSON.stringify({ name: 'p', dependencies: { 'dsh-purge': 'x' } }))
  write(path.join(p2, 'cordis.patch.yml'), '- id: user-row\n  name: something\n')
  mods.insert.ensureProfileBodyInsert(p2)
  const t2 = read(path.join(p2, 'cordis.patch.yml'))
  check('C6 正常块序列 → 追加且保留用户行', t2.includes('user-row') && t2.includes('dsh-purge'))
}

/* ── D. selectedDefault 收口 ───────────────────────────────────────── */
{
  const home = tmpHome('preset')
  const profile = path.join(home, 'profiles', 'desktop')
  write(path.join(profile, 'package.json'), JSON.stringify({ name: 'p', dependencies: { 'dsh-purge': 'x' } }))
  write(path.join(profile, 'cordis.patch.yml'), '- id: agent-preset-registry\n  config:\n    selectedDefault: redteam\n')
  fs.mkdirSync(path.join(home, '.agent-presets', 'redteam'), { recursive: true })
  write(path.join(home, '.agent-presets', 'redteam', 'agent.cordis.yml'), 'x')

  const out = mods.preset.clearOwnedSelectedDefault({ dshHome: home })
  const yml = read(path.join(profile, 'cordis.patch.yml'))
  check('D1 不抛错并返回报告', out && Array.isArray(out.files), JSON.stringify(out))
  check('D2 selectedDefault 改回 standard', /selectedDefault:\s*standard/.test(yml), JSON.stringify(yml))
  check('D3 记录改动的文件', out.files.length === 1)

  const removed = mods.preset.removeStaleAgentPresetDir(home, 'redteam')
  check('D4 清掉遗留 redteam 预设目录', removed === true && !fs.existsSync(path.join(home, '.agent-presets', 'redteam')))
  check('D5 重复调用返回 false', mods.preset.removeStaleAgentPresetDir(home, 'redteam') === false)

  const other = mods.preset.clearOwnedSelectedDefault({ dshHome: '' })
  check('D6 空 home 不抛错', other && Array.isArray(other.files))
}

console.log(fails === 0 ? '\nVERIFY OK' : '\nVERIFY FAILED: ' + fails)
process.exit(fails === 0 ? 0 : 1)
