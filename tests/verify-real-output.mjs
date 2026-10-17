import { readFileSync } from 'node:fs'
import { parseMarketIndex, marketInstallTarget } from '@deepseek-ai/dsh-plugin-market-index'

const raw = readFileSync('dist/index.json', 'utf8')
const doc = JSON.parse(raw)
const URL = 'https://hytime.github.io/dsh-discover-index/index.json'

// 1. THE authoritative check the task demands.
let parsed
try { parsed = parseMarketIndex(doc, URL); console.log('VALIDATOR: ACCEPTED,', parsed.plugins.length, 'plugins') }
catch (e) { console.log('VALIDATOR: REJECTED', e.name, e.path, e.reason); process.exit(1) }

const names = parsed.plugins.map(p => p.name)
const fail = []
const check = (label, ok, detail='') => { console.log(`${ok?'PASS':'FAIL'}  ${label}${detail?' — '+detail:''}`); if(!ok) fail.push(label) }

// CASE 1: uniqueness
const dupes = names.filter((n,i)=>names.indexOf(n)!==i)
check('case 1: names unique', dupes.length===0, dupes.length?`dupes: ${[...new Set(dupes)].slice(0,5)}`:'')

// CASE 2: npm-name legality, via the validator itself
const probe = parseMarketIndex({format:1,title:{en:'p'},metadata:{},
  plugins: names.map(n=>({name:n,metadata:{},versions:[{version:'1.0.0',publishTimestamp:1,source:{type:'npm'}}]}))}, URL)
check('case 2: all names valid npm names', probe.plugins.length===names.length)
const withUpper = names.filter(n=>n!==n.toLowerCase())
check('case 2: no uppercase in names', withUpper.length===0, withUpper.slice(0,5).join(', '))

// CASE 3: no /tree/ anywhere; source.path present when repository.directory is
let treeUrls=0, pathMismatch=0
for (const p of parsed.plugins) {
  if (p.repository?.url?.includes('/tree/')) treeUrls++
  for (const v of p.versions) {
    if (v.source.type==='git' && v.source.url.includes('/tree/')) treeUrls++
    if (v.source.type==='git' && (v.source.path===undefined)!==(p.repository?.directory===undefined)) pathMismatch++
  }
}
check('case 3: no /tree/ URL in output', treeUrls===0, `found ${treeUrls}`)
check('case 3: source.path mirrors repository.directory', pathMismatch===0, `${pathMismatch} mismatches`)

// CASE 4: non-empty versions + valid install target for every version
let empty=0, badTarget=0
for (const p of parsed.plugins) {
  if (p.versions.length===0) empty++
  for (const v of p.versions) { try { marketInstallTarget(p.name, v) } catch { badTarget++ } }
}
check('case 4: every plugin has >=1 version', empty===0)
check('case 4: every version yields an install target', badTarget===0)

// CASE 5: product absent
check('case 5: deepseek-harness absent', !names.includes('deepseek-harness') && !names.includes('@deepseek-ai/deepseek-harness'))

// EXTRA: documented spec examples
const en = parsed.plugins.filter(p=>p.title?.en)
console.log(`\nINFO  ${parsed.plugins.length} plugins, ${parsed.plugins.filter(p=>p.versions[0].source.type==='npm').length} npm-sourced, ${parsed.plugins.filter(p=>p.versions[0].source.type==='git').length} git-sourced`)
console.log(`INFO  categories declared: ${Object.keys(parsed.metadata.categories).length}, sortKeys: ${Object.keys(parsed.metadata.sortKeys).join(',')}`)
console.log(`INFO  ${en.length} plugins carry a title`)

// EXTRA: the tightened rules, asserted against the real artifact rather than a
// unit fixture. These are the invariants the verifier's robustness suite proved
// were once missing; here they are confirmed on 5,000+ plugins produced from the
// live catalog.
const semver = (await import('semver')).default
const badVersions = []
const badRanges = []
const badTimestamps = []
const badSources = []
for (const p of parsed.plugins) {
  for (const v of p.versions) {
    if (semver.valid(v.version) === null) badVersions.push(`${p.name}@${v.version}`)
    if (v.version !== v.version.trim() || /^v/u.test(v.version)) badVersions.push(`${p.name}@${v.version} (unnormalised)`)
    if (v.engines?.dsh !== undefined && (v.engines.dsh.startsWith('workspace:') || semver.validRange(v.engines.dsh) === null)) {
      badRanges.push(`${p.name}: ${v.engines.dsh}`)
    }
    if (!Number.isInteger(v.publishTimestamp) || v.publishTimestamp < 0 || v.publishTimestamp >= 1e11) {
      badTimestamps.push(`${p.name}@${v.version}: ${v.publishTimestamp}`)
    }
    if (v.source.type === 'git') {
      const s = v.source
      if (!/^[0-9a-f]{40}$/u.test(s.commit)) badSources.push(`${p.name}: commit ${s.commit}`)
      if (s.url.includes('?') || s.url.includes('#') || s.url.includes('/tree/')) badSources.push(`${p.name}: url ${s.url}`)
      if (!s.url.startsWith('https://')) badSources.push(`${p.name}: non-https ${s.url}`)
    }
  }
}
check('tightened: every version is exact SemVer and normalised', badVersions.length === 0, badVersions.slice(0, 3).join('; '))
check('tightened: every engines.dsh is a non-workspace SemVer range', badRanges.length === 0, badRanges.slice(0, 3).join('; '))
check('tightened: every publishTimestamp is in [0, 1e11)', badTimestamps.length === 0, badTimestamps.slice(0, 3).join('; '))
check('tightened: every git source is https, canonical, unpinned-query-free, lowercase 40-hex', badSources.length === 0, badSources.slice(0, 3).join('; '))

console.log(fail.length? `\n${fail.length} FAILURES` : '\nALL REAL-OUTPUT CHECKS PASSED')
process.exit(fail.length?1:0)
