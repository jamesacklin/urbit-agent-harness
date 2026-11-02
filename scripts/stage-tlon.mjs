// Build-time source imports. Pin the protocol vocabulary independently of the
// installed Groups desk; public versioned marks remain the runtime boundary.
import { execFileSync } from 'node:child_process'
import { mkdir, writeFile } from 'node:fs/promises'
import path from 'node:path'

const revision = '938f0c44d693f6f7391cca8107c7b3a40b834a01'
// Files staged from a later commit because the pinned one predates them.
// Each must import nothing, so it cannot pull in a second copy of a type.
const newer = { 'sur/buckets': 'c3659b2a89c1e204849f820d6009333e173bf7b4' }
const checkout = 'desk-deps/tlon'
const output = process.argv[2]
if (!output) throw new Error('Expected assembled desk directory')
const git = (...args) => execFileSync('git', ['-C', checkout, ...args], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] })
await mkdir(checkout, { recursive: true })
// Always initialize here: rev-parse would otherwise discover the parent repo.
git('init', '--quiet')
for (const commit of [revision, ...Object.values(newer)]) {
  try { git('cat-file', '-e', `${commit}^{commit}`) } catch {
    git('fetch', '--depth', '1', 'https://github.com/tloncorp/tlon-apps', commit)
  }
}
const visited = new Set()
async function stage(kind, name) {
  const key = `${kind}/${name}`
  if (visited.has(key)) return
  visited.add(key)
  const source = git('show', `${newer[key] || revision}:desk/${key}.hoon`)
  if (newer[key] && /^\/[+-]  /m.test(source)) throw new Error(`${key} must import nothing to be staged from a newer commit`)
  const lines = []
  const sourceLines = source.split('\n')
  for (let i = 0; i < sourceLines.length; i++) {
    let line = sourceLines[i]
    if (!/^\/[+-]  /.test(line)) { lines.push(line); continue }
    while (/^    \S/.test(sourceLines[i + 1] || '')) line += ` ${sourceLines[++i].trim()}`
    const depKind = line.startsWith('/-') ? 'sur' : 'lib'
    const imports = []
    for (const token of line.slice(4).split(/[, ]+/).filter(Boolean)) {
      const [alias, dep] = token.includes('=') ? token.split('=') : [token, token.replace(/^\*/, '')]
      await stage(depKind, dep)
      const flattened = dep.replaceAll('/', '-')
      imports.push(alias.startsWith('*') ? `*tlon-${flattened}` : `${alias}=tlon-${flattened}`)
    }
    lines.push(`${line.slice(0, 4)}${imports.join(', ')}`)
  }
  const target = path.join(output, kind, `tlon-${name.replaceAll('/', '-')}.hoon`)
  await mkdir(path.dirname(target), { recursive: true })
  await writeFile(target, lines.join('\n'))
}
for (const name of ['activity-ver', 'chat-ver', 'channels', 'contacts', 'story', 'groups', 'presence', 'notes', 'hooks', 'steward', 'steward/lens', 'reel', 'buckets']) await stage('sur', name)
for (const name of ['channel-json', 'groups-json', 'story-json', 'logs']) await stage('lib', name)
console.log(`Tlon: ${visited.size} namespaced protocol dependencies at ${revision.slice(0, 12)}`)
