import { createHash } from 'node:crypto'
import { spawnSync } from 'node:child_process'
import { builtinModules } from 'node:module'
import { fileURLToPath } from 'node:url'
import { join, relative, resolve, sep, posix } from 'node:path'
import { tmpdir } from 'node:os'
import {
  cpSync,
  existsSync,
  lstatSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  realpathSync,
  rmdirSync,
  statSync,
  unlinkSync,
  writeFileSync,
} from 'node:fs'

const ROOT = resolve(fileURLToPath(new URL('..', import.meta.url)))
const FIXTURE_ROOT = join(ROOT, 'fixtures', 'alpha1')
const FIXTURE_TARBALL_ROOT = join(FIXTURE_ROOT, 'tarballs')
const PACKAGE_NAME = 'dsh-llm-grok'
const OFFICIAL_ALPHA1 = '0.1.2-alpha.1'
const MODEL_SWITCH_VERSION = '0.4.2'
const OWNER_NAME = 'dsh-llm-providers-ui'
const OWNER_VERSION = '0.1.1'
const INVALID_REGISTRY = 'http://127.0.0.1:9/'
const BUILTIN_MODULES = new Set(builtinModules)
const DEPENDENCY_SECTIONS = ['dependencies', 'optionalDependencies', 'peerDependencies', 'devDependencies']
const FORBIDDEN_ENV_KEY = /(?:KEY|SECRET|TOKEN|PASSWORD|CREDENTIAL|AUTH|CLOUD)/iu
const CHILD_ENV_ROOT = mkdtempSync(join(tmpdir(), 'dsh-llm-grok-pack-env-'))
const HOST_COREPACK_HOME = process.env.COREPACK_HOME ?? join(process.env.HOME ?? CHILD_ENV_ROOT, '.cache', 'node', 'corepack')
const CHILD_COREPACK_HOME = join(CHILD_ENV_ROOT, 'corepack')
const CHILD_HOME = join(CHILD_ENV_ROOT, 'home')
const CHILD_TMP = join(CHILD_ENV_ROOT, 'tmp')
const CHILD_CONFIG = join(CHILD_ENV_ROOT, 'config')
const CHILD_CACHE = join(CHILD_ENV_ROOT, 'cache')
const CHILD_DATA = join(CHILD_ENV_ROOT, 'data')
const CHILD_STATE = join(CHILD_ENV_ROOT, 'state')
const CHILD_STORE = join(CHILD_ENV_ROOT, 'store')
const CHILD_USERCONFIG = join(CHILD_CONFIG, 'npmrc')
const CHILD_GLOBALCONFIG = join(CHILD_CONFIG, 'globalrc')
const CHILD_ENV_KEYS = new Set([
  'PATH', 'HOME', 'USERPROFILE', 'TMPDIR', 'TMP', 'TEMP', 'XDG_CONFIG_HOME', 'XDG_CACHE_HOME', 'XDG_DATA_HOME', 'XDG_STATE_HOME',
  'NODE_PATH', 'NODE_OPTIONS', 'COREPACK_HOME', 'npm_config_userconfig', 'npm_config_globalconfig', 'npm_config_registry', 'npm_config_store_dir',
  'npm_config_cache', 'npm_config_auto_install_peers', 'npm_config_audit', 'npm_config_fund', 'pnpm_config_userconfig', 'pnpm_config_globalconfig', 'pnpm_config_registry',
  'pnpm_config_store_dir', 'pnpm_config_cache', 'pnpm_config_auto_install_peers', 'pnpm_config_audit', 'pnpm_config_fund', 'DSH_LLM_PROVIDERS_UI_SORTABLE', 'CI', 'FORCE_COLOR', 'LANG', 'LC_ALL',
])

function fail(message) {
  throw new Error('pack gate: ' + message)
}

function initializeChildEnvironment() {
  for (const directory of [CHILD_HOME, CHILD_TMP, CHILD_CONFIG, CHILD_CACHE, CHILD_DATA, CHILD_STATE, CHILD_STORE]) mkdirSync(directory, { recursive: true })
  if (existsSync(HOST_COREPACK_HOME)) cpSync(HOST_COREPACK_HOME, CHILD_COREPACK_HOME, { recursive: true, dereference: true })
  else mkdirSync(CHILD_COREPACK_HOME, { recursive: true })
  writeFileSync(CHILD_USERCONFIG, [
    'registry=' + INVALID_REGISTRY,
    'store-dir=' + CHILD_STORE,
    'cache-dir=' + CHILD_CACHE,
    'auto-install-peers=true',
    'audit=false',
    'fund=false',
  ].join('\n') + '\n')
  writeFileSync(CHILD_GLOBALCONFIG, '')
}

function commandEnv(extra = {}) {
  const env = {
    PATH: process.env.PATH ?? '/usr/bin:/bin',
    HOME: CHILD_HOME,
    USERPROFILE: CHILD_HOME,
    TMPDIR: CHILD_TMP,
    TMP: CHILD_TMP,
    TEMP: CHILD_TMP,
    XDG_CONFIG_HOME: CHILD_CONFIG,
    XDG_CACHE_HOME: CHILD_CACHE,
    XDG_DATA_HOME: CHILD_DATA,
    XDG_STATE_HOME: CHILD_STATE,
    NODE_PATH: '',
    NODE_OPTIONS: '',
    COREPACK_HOME: CHILD_COREPACK_HOME,
    npm_config_userconfig: CHILD_USERCONFIG,
    npm_config_globalconfig: CHILD_GLOBALCONFIG,
    npm_config_registry: INVALID_REGISTRY,
    npm_config_store_dir: CHILD_STORE,
    npm_config_cache: CHILD_CACHE,
    npm_config_auto_install_peers: 'true',
    npm_config_audit: 'false',
    npm_config_fund: 'false',
    pnpm_config_userconfig: CHILD_USERCONFIG,
    pnpm_config_globalconfig: CHILD_GLOBALCONFIG,
    pnpm_config_registry: INVALID_REGISTRY,
    pnpm_config_store_dir: CHILD_STORE,
    pnpm_config_cache: CHILD_CACHE,
    pnpm_config_auto_install_peers: 'true',
    pnpm_config_audit: 'false',
    pnpm_config_fund: 'false',
    CI: '1',
    FORCE_COLOR: '0',
    LANG: 'C.UTF-8',
    LC_ALL: 'C.UTF-8',
  }
  for (const [key, value] of Object.entries(extra)) {
    if (!CHILD_ENV_KEYS.has(key)) fail('child environment override is not allowlisted: ' + key)
    env[key] = String(value)
  }
  return env
}

function checkChildEnvironment() {
  const marker = 'DSH_PACK_GATE_SYNTHETIC_SECRET'
  const previous = process.env[marker]
  process.env[marker] = 'must-not-cross-process-boundary'
  try {
    let child
    try {
      child = JSON.parse(run(process.execPath, ['-e', 'process.stdout.write(JSON.stringify(process.env))']))
    } catch (error) {
      fail('child environment probe returned invalid JSON: ' + (error instanceof Error ? error.message : String(error)))
    }
    for (const key of Object.keys(child)) {
      if (!CHILD_ENV_KEYS.has(key)) fail('child environment contains an unallowlisted key: ' + key)
      if (FORBIDDEN_ENV_KEY.test(key)) fail('child environment contains a credential-like key: ' + key)
    }
    if (child[marker] !== undefined) fail('child environment leaked the synthetic secret marker')
    for (const [key, expected] of Object.entries({
      NODE_PATH: '',
      NODE_OPTIONS: '',
      COREPACK_HOME: CHILD_COREPACK_HOME,
      HOME: CHILD_HOME,
      npm_config_userconfig: CHILD_USERCONFIG,
      pnpm_config_userconfig: CHILD_USERCONFIG,
      npm_config_registry: INVALID_REGISTRY,
      pnpm_config_registry: INVALID_REGISTRY,
      npm_config_store_dir: CHILD_STORE,
      pnpm_config_store_dir: CHILD_STORE,
      npm_config_cache: CHILD_CACHE,
      pnpm_config_cache: CHILD_CACHE,
      npm_config_audit: 'false',
      npm_config_fund: 'false',
      pnpm_config_audit: 'false',
      pnpm_config_fund: 'false',
    })) if (child[key] !== expected) fail('child environment has an unsafe ' + key + ' value')
    let rejected = false
    try {
      commandEnv({ [marker]: 'must-be-rejected' })
    } catch (error) {
      if (!(error instanceof Error) || !error.message.includes('not allowlisted')) throw error
      rejected = true
    }
    if (!rejected) fail('child environment accepted a credential-like override')
  } finally {
    if (previous === undefined) delete process.env[marker]
    else process.env[marker] = previous
  }
}

function outputText(value) {
  return typeof value === 'string' ? value : value == null ? '' : Buffer.from(value).toString('utf8')
}

function errorCode(error) {
  if (error !== null && typeof error === 'object' && 'code' in error && typeof error.code === 'string') return error.code
  return undefined
}

function errorText(error) {
  return error instanceof Error ? error.message : String(error)
}

function cleanupTree(target, label, rootReal) {
  let stat
  try {
    stat = lstatSync(target)
  } catch (error) {
    if (errorCode(error) === 'ENOENT') return
    throw new Error(label + ' lstat failed for ' + target + ': ' + errorText(error), { cause: error })
  }
  if (stat.isSymbolicLink() || !stat.isDirectory()) {
    try {
      unlinkSync(target)
    } catch (error) {
      if (errorCode(error) === 'ENOENT') return
      throw new Error(label + ' unlink failed for ' + target + ': ' + errorText(error), { cause: error })
    }
    return
  }
  let real
  try {
    real = realpathSync(target)
  } catch (error) {
    if (errorCode(error) === 'ENOENT') return
    throw new Error(label + ' realpath failed for ' + target + ': ' + errorText(error), { cause: error })
  }
  const base = rootReal ?? real
  if (real !== base && !real.startsWith(base + sep)) fail(label + ' would clean outside its temporary root: ' + real)
  let entries
  try {
    entries = readdirSync(target)
  } catch (error) {
    if (errorCode(error) === 'ENOENT') return
    throw new Error(label + ' readdir failed for ' + target + ': ' + errorText(error), { cause: error })
  }
  const errors = []
  for (const entry of entries) {
    try {
      cleanupTree(join(target, entry), label, base)
    } catch (error) {
      if (error instanceof AggregateError) errors.push(...error.errors)
      else errors.push(error)
    }
  }
  try {
    rmdirSync(target)
  } catch (error) {
    if (errorCode(error) !== 'ENOENT') errors.push(new Error(label + ' rmdir failed for ' + target + ': ' + errorText(error), { cause: error }))
  }
  if (errors.length === 1) throw errors[0]
  if (errors.length > 1) throw new AggregateError(errors, label + ' cleanup failed')
}

function cleanupTemporaryPath(target, label) {
  cleanupTree(target, label)
}

function run(command, args, options = {}) {
  const result = spawnSync(command, args, {
    cwd: options.cwd ?? ROOT,
    env: commandEnv(options.env),
    encoding: 'utf8',
    input: options.input,
    maxBuffer: 64 * 1024 * 1024,
    stdio: ['ignore', 'pipe', 'pipe'],
  })
  const stdout = outputText(result.stdout)
  const stderr = outputText(result.stderr)
  if (result.error || result.status !== 0) {
    const detail = [stdout, stderr].filter(Boolean).join('\n').trim()
    throw new Error(command + ' ' + args.join(' ') + ' failed' + (detail ? ':\n' + detail : ''))
  }
  return stdout
}

function readJson(file) {
  try {
    return JSON.parse(readFileSync(file, 'utf8'))
  } catch (error) {
    fail('invalid JSON in ' + file + ': ' + (error instanceof Error ? error.message : String(error)))
  }
}

function sha256(file) {
  return createHash('sha256').update(readFileSync(file)).digest('hex')
}

function requireRegularFile(file, label) {
  let stat
  try {
    stat = lstatSync(file)
  } catch (error) {
    fail(label + ' is missing: ' + file + ': ' + errorText(error))
  }
  if (!stat.isFile() || stat.isSymbolicLink() || stat.size === 0) fail(label + ' is not a non-empty regular file: ' + file)
  return stat
}

function parsePackReport(output) {
  const start = output.lastIndexOf('\n[')
  const json = start >= 0 ? output.slice(start + 1) : output.trim()
  try {
    const report = JSON.parse(json)
    if (!Array.isArray(report) || report.length !== 1 || typeof report[0]?.filename !== 'string') fail('npm pack returned no single archive report')
    return report[0]
  } catch (error) {
    fail('npm pack returned invalid JSON: ' + (error instanceof Error ? error.message : String(error)))
  }
}

function pack(cwd, destination) {
  mkdirSync(destination, { recursive: true })
  const report = parsePackReport(run('npm', ['pack', '--json', '--ignore-scripts', '--pack-destination', destination], { cwd }))
  const archive = join(destination, report.filename)
  requireRegularFile(archive, 'npm pack archive')
  return { archive, report }
}

function archiveEntries(archive, label, options = {}) {
  const listing = run('tar', ['-tzf', archive])
  const entries = new Set()
  for (const entry of listing.split('\n').filter(Boolean)) {
    if (!entry.startsWith('package/')) fail(label + ' has an entry outside package/: ' + entry)
    const value = entry.slice('package/'.length)
    if (!value) continue
    if (value.includes('\0') || value.startsWith('/') || value.split('/').includes('..')) fail(label + ' has an unsafe archive entry: ' + value)
    if (value.split('/').includes('node_modules')) fail(label + ' contains a node_modules member: ' + value)
    if (value.endsWith('/')) continue
    entries.add(value)
  }
  if (options.regularMembers === true) {
    for (const line of run('tar', ['-tvzf', archive]).split('\n').filter(Boolean)) {
      const kind = line[0]
      if (kind !== 'd' && kind !== '-') fail(label + ' contains a non-regular archive member')
    }
  }
  return entries
}

function extractArchive(archive, work, label) {
  const destination = mkdtempSync(join(work, 'extract-'))
  run('tar', ['-xzf', archive, '-C', destination])
  const packageRoot = join(destination, 'package')
  if (!existsSync(packageRoot)) fail(label + ' has no package/ directory')
  return packageRoot
}

function cleanTarget(target, label) {
  if (typeof target !== 'string') fail(label + ' is not a package file target')
  const value = target.startsWith('./') ? target.slice(2) : target
  if (!value || value.startsWith('/') || value.includes('..') || value.includes('*')) fail(label + ' is not a concrete package file: ' + target)
  return value
}

function cleanExportTarget(target, label) {
  if (typeof target !== 'string' || !target.startsWith('./')) fail(label + ' is not a relative export target')
  return cleanTarget(target, label)
}

function exportTargets(value, label = 'exports') {
  if (typeof value === 'string') return [{ label, target: value }]
  if (Array.isArray(value)) return value.flatMap((entry, index) => exportTargets(entry, label + '[' + String(index) + ']'))
  if (value !== null && typeof value === 'object') return Object.entries(value).flatMap(([key, entry]) => exportTargets(entry, label + '.' + key))
  fail(label + ' has no export target')
}

function dependencyMap(manifest) {
  const result = new Map()
  for (const section of ['dependencies', 'optionalDependencies', 'peerDependencies']) {
    for (const [name, spec] of Object.entries(manifest[section] ?? {})) result.set(name, spec)
  }
  return result
}

function checkManifest(manifest, files, label, options = {}) {
  if (manifest.name !== (options.name ?? PACKAGE_NAME)) fail(label + ' has unexpected package name ' + String(manifest.name))
  if (options.version !== undefined && manifest.version !== options.version) fail(label + ' has unexpected version ' + String(manifest.version))
  if (typeof manifest.main !== 'string' || typeof manifest.types !== 'string') fail(label + ' must declare string main and types targets')
  for (const [targetLabel, target] of [['main', manifest.main], ['types', manifest.types]]) {
    const file = cleanTarget(target, label + '.' + targetLabel)
    if (!files.has(file)) fail(label + ' is missing ' + targetLabel + ' target ' + file)
  }
  for (const { label: targetLabel, target } of exportTargets(manifest.exports, label + '.exports')) {
    const file = cleanExportTarget(target, targetLabel)
    if (!files.has(file)) fail(label + ' is missing export target ' + file)
  }
  for (const section of DEPENDENCY_SECTIONS) {
    for (const [name, spec] of Object.entries(manifest[section] ?? {})) {
      if (typeof spec !== 'string') fail(label + '.' + section + '.' + name + ' is not a string specifier')
      const modelFixture = section === 'devDependencies' && name === 'dsh-model-switch' && spec === 'file:fixtures/alpha1/tarballs/dsh-model-switch-0.4.2.tgz'
      if (!modelFixture && (/^(?:file|link|workspace):/u.test(spec) || spec.startsWith('/') || /^[A-Za-z]:\\/u.test(spec))) fail(label + ' contains a local dependency alias at ' + section + '.' + name)
      if (modelFixture && options.allowModelFixture !== true) fail(label + ' contains an unapproved local model-switch dependency')
      if (options.strictAlpha && name.startsWith('@deepseek-ai/dsh-') && spec !== OFFICIAL_ALPHA1) fail(label + '.' + section + '.' + name + ' must use ' + OFFICIAL_ALPHA1 + ', got ' + spec)
    }
  }
  return dependencyMap(manifest)
}

function checkRootManifest(manifest) {
  if (manifest.name !== PACKAGE_NAME) fail('source manifest has unexpected package name')
  if (manifest.pnpm?.overrides || manifest.overrides) fail('source manifest ships dependency overrides')
  const runtimeOwner = manifest.dependencies?.[OWNER_NAME] ?? manifest.optionalDependencies?.[OWNER_NAME] ?? manifest.peerDependencies?.[OWNER_NAME]
  if (runtimeOwner !== undefined) fail(OWNER_NAME + ' must not be a runtime dependency')
  if (manifest.devDependencies?.[OWNER_NAME] !== '^0.1.1') fail(OWNER_NAME + ' must be the ^0.1.1 development dependency')
  if (manifest.peerDependencies?.['dsh-model-switch'] !== '^0.4.2') fail('dsh-model-switch must retain the ^0.4.2 optional peer')
  if (manifest.devDependencies?.['dsh-model-switch'] !== 'file:fixtures/alpha1/tarballs/dsh-model-switch-0.4.2.tgz') fail('dsh-model-switch must use the unshipped 0.4.2 fixture for development typing')
  if (manifest.peerDependenciesMeta?.['dsh-model-switch']?.optional !== true) fail('dsh-model-switch must be an optional peer')
  for (const section of DEPENDENCY_SECTIONS) {
    for (const [name, spec] of Object.entries(manifest[section] ?? {})) {
      if (typeof spec !== 'string') fail('source manifest has a non-string specifier at ' + section + '.' + name)
      const modelFixture = section === 'devDependencies' && name === 'dsh-model-switch' && spec === 'file:fixtures/alpha1/tarballs/dsh-model-switch-0.4.2.tgz'
      if (!modelFixture && (/^(?:file|link|workspace|github|git\+|https?):/u.test(spec) || spec.startsWith('/') || /^[A-Za-z]:\\/u.test(spec))) fail('source manifest has a non-registry alias at ' + section + '.' + name)
      if (name.startsWith('@deepseek-ai/dsh-') && spec !== OFFICIAL_ALPHA1) fail(section + '.' + name + ' must use exact ' + OFFICIAL_ALPHA1 + ', got ' + spec)
    }
  }
}

function checkLockfile(manifest) {
  const file = join(ROOT, 'pnpm-lock.yaml')
  const lock = readFileSync(file, 'utf8')
  if (/127\.0\.0\.1|localhost|4873/u.test(lock)) fail('lockfile contains a temporary registry URL')
  if (/^overrides:/mu.test(lock)) fail('lockfile contains a shipped overrides block')
  if (!/settings:\n  autoInstallPeers: true\n/u.test(lock)) fail('lockfile was not generated with normal peer installation')
  const importer = lock.slice(0, Math.max(0, lock.indexOf('\npackages:')))
  if (/specifier:.*(?:>=|<=|\|\||\brc\.)/u.test(importer)) fail('lockfile importer contains a broad or release-candidate dependency range')
  if (!importer.includes('specifier: file:fixtures/alpha1/tarballs/dsh-model-switch-0.4.2.tgz')) fail('lockfile importer lost the unshipped model-switch fixture')
  for (const line of lock.split('\n')) {
    if (!line.includes('integrity:')) continue
    const match = line.match(/integrity:\s*(sha(?:1|256|512)-[^,}\s]+)/u)
    if (!match || !/^sha(?:1|256|512)-[A-Za-z0-9+/]+={0,2}$/u.test(match[1])) fail('lockfile has malformed integrity metadata: ' + line.trim())
  }
  if (manifest.name !== PACKAGE_NAME) fail('lockfile check received the wrong manifest')
}

function verifyFixtureRecord(file, record, label) {
  if (record === null || typeof record !== 'object' || typeof record.package !== 'string' || typeof record.version !== 'string' || typeof record.sha256 !== 'string' || !Number.isSafeInteger(record.bytes)) fail('invalid provenance record: ' + label)
  const stat = requireRegularFile(file, 'fixture archive')
  if (stat.size !== record.bytes) fail('fixture byte size mismatch for ' + label)
  if (sha256(file) !== record.sha256) fail('fixture SHA-256 mismatch for ' + label)
}

function verifyProvenanceDependencies(record, manifest, label) {
  const sections = ['dependencies', 'optionalDependencies', 'peerDependencies']
  const nested = record.dependencies !== null && typeof record.dependencies === 'object' && Object.keys(record.dependencies).some(section => sections.includes(section))
  const recorded = nested ? record.dependencies : record
  if (nested && Object.keys(recorded).some(section => !sections.includes(section))) fail('provenance has an extra dependency section for ' + label)
  for (const section of sections) {
    const expected = Object.fromEntries(Object.entries(manifest[section] ?? {}).sort(([left], [right]) => left.localeCompare(right)))
    const actual = Object.fromEntries(Object.entries(recorded[section] ?? {}).sort(([left], [right]) => left.localeCompare(right)))
    if (JSON.stringify(expected) !== JSON.stringify(actual)) fail('provenance dependency record disagrees with ' + label + ' ' + section)
  }
}

function fixtureArchives(work) {
  const provenance = readJson(join(FIXTURE_ROOT, 'PROVENANCE.json'))
  if (provenance.source?.tag !== 'dsh-v0.1.2-alpha.1' || provenance.source?.commit !== 'cd5ef8148158c3a752a658978873241fdf8e2bbc') fail('fixture provenance does not identify the official alpha.1 tag and commit')
  if (provenance.source?.checkout !== 'dsh-v0.1.2-alpha.1-cd5ef8148158') fail('fixture provenance does not identify the alpha.1 checkout')
  const official = provenance.tarballs
  const additional = provenance.additionalTarballs
  if (official === null || typeof official !== 'object' || Array.isArray(official)) fail('fixture provenance has no tarballs map')
  if (additional === null || typeof additional !== 'object' || Array.isArray(additional)) fail('fixture provenance has no additionalTarballs map')
  const records = { ...official, ...additional }
  const files = readdirSync(FIXTURE_TARBALL_ROOT).filter(name => name.endsWith('.tgz')).sort()
  const recordNames = Object.keys(records).sort()
  if (files.length !== recordNames.length || files.some((name, index) => name !== recordNames[index])) fail('fixture archives and provenance records differ')
  const knownIdentities = new Set(recordNames.map(name => records[name].package + '@' + records[name].version))
  const identities = new Map()
  const graph = provenance.graph
  if (graph === null || typeof graph !== 'object' || Array.isArray(graph)) fail('fixture provenance has no dependency graph')
  for (const name of recordNames) {
    const record = records[name]
    const archive = join(FIXTURE_TARBALL_ROOT, name)
    verifyFixtureRecord(archive, record, name)
    archiveEntries(archive, name, { regularMembers: true })
    const packageRoot = extractArchive(archive, work, name)
    const manifest = readJson(join(packageRoot, 'package.json'))
    if (manifest.name !== record.package || manifest.version !== record.version) fail('fixture manifest identity mismatch for ' + name)
    verifyProvenanceDependencies(record, manifest, name)
    const identity = manifest.name + '@' + manifest.version
    if (identities.has(identity)) fail('fixture contains duplicate package identity ' + identity)
    identities.set(identity, { file: name, manifest })
    if (manifest.name.startsWith('@deepseek-ai/dsh-') && manifest.version !== OFFICIAL_ALPHA1) fail('fixture contains non-alpha DSH package ' + identity)
    if (manifest.name === 'dsh-model-switch' && manifest.version !== MODEL_SWITCH_VERSION) fail('fixture has the wrong model-switch fixture version')
    if (graph[identity] === undefined) fail('fixture graph is missing ' + identity)
    const graphDeps = graph[identity]
    if (graphDeps === null || typeof graphDeps !== 'object' || Array.isArray(graphDeps)) fail('fixture graph has an invalid node for ' + identity)
    const sections = ['dependencies', 'optionalDependencies', 'peerDependencies']
    for (const section of Object.keys(graphDeps)) if (!sections.includes(section) && section !== 'resolved') fail('fixture graph has an extra section for ' + identity + ': ' + section)
    for (const section of sections) {
      const expected = Object.fromEntries(Object.entries(manifest[section] ?? {}).sort(([left], [right]) => left.localeCompare(right)))
      const actual = Object.fromEntries(Object.entries(graphDeps[section] ?? {}).sort(([left], [right]) => left.localeCompare(right)))
      if (JSON.stringify(expected) !== JSON.stringify(actual)) fail('fixture graph disagrees with ' + identity + ' ' + section)
    }
    const resolved = graphDeps.resolved
    if (resolved === null || typeof resolved !== 'object' || Array.isArray(resolved)) fail('fixture graph has no resolved edges for ' + identity)
    for (const section of sections) {
      const expected = manifest[section] ?? {}
      const actual = resolved[section] ?? {}
      if (Object.keys(actual).some(name => expected[name] === undefined)) fail('fixture graph has an extra resolved edge for ' + identity + ' ' + section)
      for (const [name, spec] of Object.entries(expected)) {
        const target = actual[name]
        if (target === undefined) {
          const hasFixture = [...knownIdentities].some(candidate => candidate.startsWith(name + '@'))
          if (section === 'dependencies' || hasFixture) fail('fixture graph is missing a resolved edge for ' + identity + ' ' + name)
          continue
        }
        const at = target.lastIndexOf('@')
        const targetName = at > 0 ? target.slice(0, at) : ''
        const targetVersion = at > 0 ? target.slice(at + 1) : ''
        if (targetName !== name || !knownIdentities.has(target)) fail('fixture graph resolves ' + identity + ' ' + name + ' to an unknown target ' + target)
        if (!satisfiesRange(targetVersion, spec)) fail('fixture graph resolves ' + identity + ' ' + name + ' outside ' + spec)
      }
    }
    const normalizeResolved = value => Object.fromEntries(Object.entries(value ?? {}).sort(([left], [right]) => left.localeCompare(right)).map(([section, entries]) => [section, Object.fromEntries(Object.entries(entries ?? {}).sort(([left], [right]) => left.localeCompare(right)))]))
    if (JSON.stringify(normalizeResolved(record.resolved)) !== JSON.stringify(normalizeResolved(resolved))) fail('provenance resolved edges disagree with ' + identity)
  }
  for (const [identity, entry] of identities) {
    // Optional platform packages are intentionally omitted; pnpm selects the host binary.
    for (const section of ['dependencies']) {
      for (const dep of Object.keys(entry.manifest[section] ?? {})) {
        const hasName = [...identities.keys()].some(key => key.startsWith(dep + '@'))
        if (!hasName && dep !== OWNER_NAME) fail('fixture dependency closure lacks ' + dep + ' required by ' + identity)
      }
    }
  }
  for (const identity of Object.keys(graph)) if (!identities.has(identity)) fail('fixture graph lists an archive that is not present: ' + identity)
  const versions = new Map()
  for (const identity of identities.keys()) {
    const at = identity.lastIndexOf('@')
    const name = identity.slice(0, at)
    versions.set(name, (versions.get(name) ?? 0) + 1)
  }
  if (![...versions.values()].some(count => count > 1)) fail('fixture graph does not exercise a multi-version dependency')
  if (!Object.values(additional).some(record => record.package === 'dsh-model-switch' && record.version === MODEL_SWITCH_VERSION)) fail('fixture lacks the dsh-model-switch 0.4.2 type fixture')
  return { provenance, records, identities }
}

function verifyOwnerArtifact(work) {
  const artifact = process.env.DSH_LLM_PROVIDERS_UI_ARTIFACT
  const expected = process.env.DSH_LLM_PROVIDERS_UI_SHA256?.toLowerCase()
  if (!artifact || !expected) fail('set DSH_LLM_PROVIDERS_UI_ARTIFACT and DSH_LLM_PROVIDERS_UI_SHA256')
  if (!/^[0-9a-f]{64}$/u.test(expected)) fail('DSH_LLM_PROVIDERS_UI_SHA256 is not a SHA-256 digest')
  const provenance = readJson(join(FIXTURE_ROOT, 'PROVENANCE.json'))
  const recorded = provenance.externalArtifacts?.owner?.sha256?.toLowerCase()
  if (recorded !== expected) fail('owner artifact SHA-256 differs from fixture provenance')
  if (provenance.externalArtifacts?.owner?.package !== OWNER_NAME || provenance.externalArtifacts?.owner?.version !== OWNER_VERSION) fail('fixture provenance identifies the wrong owner artifact')
  requireRegularFile(artifact, 'owner artifact')
  const actual = sha256(artifact)
  if (actual !== expected) fail('owner artifact SHA-256 mismatch: expected ' + expected + ', got ' + actual)
  const files = archiveEntries(artifact, 'owner artifact', { regularMembers: true })
  const packageRoot = extractArchive(artifact, work, 'owner artifact')
  const manifest = readJson(join(packageRoot, 'package.json'))
  checkManifest(manifest, files, 'owner artifact', { name: OWNER_NAME, version: OWNER_VERSION })
  if (manifest.exports?.['./sortable'] === undefined) fail('owner artifact does not export ./sortable')
  const sortable = join(packageRoot, 'lib', 'sortable.js')
  requireRegularFile(sortable, 'owner sortable module')
  return { artifact, manifest, sortable }
}

function checkBundledSortable(owner) {
  const bundle = readFileSync(join(ROOT, 'lib', 'client.js'), 'utf8')
  const marker = relative(ROOT, owner.sortable).split(sep).join('/')
  if (!bundle.includes(marker)) fail('packed client did not bundle sortable from the supplied owner artifact: ' + owner.sortable)
}

function staticSpecifiers(source) {
  const result = new Set()
  for (const pattern of [
    /\bfrom\s*['"]([^'"]+)['"]/gu,
    /\bimport\s*\(\s*['"]([^'"]+)['"]/gu,
    /\brequire\s*\(\s*['"]([^'"]+)['"]/gu,
  ]) for (const match of source.matchAll(pattern)) result.add(match[1])
  return result
}

function packageName(specifier) {
  return specifier.startsWith('@') ? specifier.split('/').slice(0, 2).join('/') : specifier.split('/')[0]
}

function statExists(file) {
  try {
    return statSync(file).isFile()
  } catch (error) {
    if (errorCode(error) === 'ENOENT') return false
    fail('could not stat packed file ' + file + ': ' + errorText(error))
  }
}

function checkStaticClosure(packageRoot, manifest) {
  const declared = dependencyMap(manifest)
  const files = []
  const visit = directory => {
    let entries
    try {
      entries = readdirSync(directory, { withFileTypes: true })
    } catch (error) {
      fail('could not read packed directory ' + directory + ': ' + errorText(error))
    }
    for (const entry of entries) {
      const file = join(directory, entry.name)
      if (entry.isDirectory()) visit(file)
      else if (entry.isFile() && /\.(?:js|mjs|cjs)$/u.test(entry.name)) files.push(file)
    }
  }
  visit(packageRoot)
  for (const file of files) {
    const relativeFile = relative(packageRoot, file).split(sep).join('/')
    for (const specifier of staticSpecifiers(readFileSync(file, 'utf8'))) {
      if (specifier.startsWith('node:') || BUILTIN_MODULES.has(specifier)) continue
      if (specifier.startsWith('.') || specifier.startsWith('/')) {
        const normalized = posix.normalize(posix.join(posix.dirname(relativeFile), specifier.split('?')[0]))
        if (normalized.startsWith('../') || normalized === '..') fail('packed JS escapes the package with ' + specifier + ' in ' + relativeFile)
        const candidates = [normalized, normalized + '.js', normalized + '.mjs', normalized + '.cjs', normalized + '.json', posix.join(normalized, 'index.js')]
        if (!candidates.some(candidate => statExists(join(packageRoot, ...candidate.split('/'))))) fail('packed JS has unresolved relative import ' + specifier + ' in ' + relativeFile)
      } else {
        const name = packageName(specifier)
        if (name === OWNER_NAME) fail('packed JS retains a runtime owner import ' + specifier)
        if (!declared.has(name)) fail('packed JS imports undeclared package ' + specifier)
      }
    }
  }
}

function parseRangeVersion(value) {
  const core = value.trim().replace(/^v/u, '').split('-')[0].split('.')
  return { major: Number(core[0] ?? 0), minor: Number(core[1] ?? 0), patch: Number(core[2] ?? 0) }
}

function compareRangeVersions(left, right) {
  const a = parseRangeVersion(left)
  const b = parseRangeVersion(right)
  return a.major - b.major || a.minor - b.minor || a.patch - b.patch
}

function satisfiesRange(version, spec) {
  for (const alternative of spec.split('||')) {
    const range = alternative.trim()
    if (!range || range === '*' || range === 'latest') return true
    let accepted = true
    const words = range.split(' ').filter(Boolean)
    const tokens = []
    for (let index = 0; index < words.length; index++) {
      const word = words[index]
      if ((word === '>=' || word === '<=' || word === '>' || word === '<') && words[index + 1] !== undefined) tokens.push(word + words[++index])
      else tokens.push(word)
    }
    for (const token of tokens) {
      const operator = token.startsWith('>=') || token.startsWith('<=') ? token.slice(0, 2) : token.startsWith('>') || token.startsWith('<') ? token.slice(0, 1) : ''
      const raw = operator ? token.slice(operator.length) : token
      if (raw.startsWith('^')) {
        const base = parseRangeVersion(raw.slice(1)); const actual = parseRangeVersion(version)
        const upper = base.major > 0 ? actual.major === base.major : base.minor > 0 ? actual.major === 0 && actual.minor === base.minor : actual.major === 0 && actual.minor === 0
        if (!upper || compareRangeVersions(version, raw.slice(1)) < 0) accepted = false
      } else if (raw.startsWith('~')) {
        const base = parseRangeVersion(raw.slice(1)); const actual = parseRangeVersion(version)
        if (actual.major !== base.major || actual.minor !== base.minor || compareRangeVersions(version, raw.slice(1)) < 0) accepted = false
      } else if (operator) {
        const comparison = compareRangeVersions(version, raw)
        if ((operator === '>=' && comparison < 0) || (operator === '<=' && comparison > 0) || (operator === '>' && comparison <= 0) || (operator === '<' && comparison >= 0)) accepted = false
      } else if (raw.endsWith('.x')) {
        const prefix = raw.slice(0, -2); if (!version.startsWith(prefix + '.')) accepted = false
      } else if (raw.split('.').length < 3 && raw.split('.').every(part => part !== '' && Number.isInteger(Number(part)))) {
        const actual = parseRangeVersion(version); const parts = raw.split('.').map(Number)
        if (actual.major !== parts[0] || (parts.length > 1 && actual.minor !== parts[1])) accepted = false
      } else if (raw !== version) {
        accepted = false
      }
    }
    if (accepted) return true
  }
  return false
}

function installOffline(archive, fixture, ownerArtifact, ownerManifest, packedManifest, work, includeOwner = true) {
  const suffix = includeOwner ? 'with-owner' : 'without-owner'
  const consumer = join(work, 'consumer-' + suffix)
  const store = join(work, 'store-' + suffix)
  const cache = join(work, 'cache-' + suffix)
  mkdirSync(consumer, { recursive: true })
  mkdirSync(store, { recursive: true })
  mkdirSync(cache, { recursive: true })
  if (readdirSync(store).length !== 0) fail('offline install store was not empty: ' + store)
  const candidates = new Map()
  for (const [identity, entry] of fixture.identities) {
    const at = identity.lastIndexOf('@')
    const name = identity.slice(0, at)
    const list = candidates.get(name) ?? []
    list.push({ id: identity, name, version: identity.slice(at + 1), file: join(FIXTURE_TARBALL_ROOT, entry.file), manifest: entry.manifest })
    candidates.set(name, list)
  }
  if (includeOwner) {
    const ownerCandidate = { id: OWNER_NAME + '@' + OWNER_VERSION, name: OWNER_NAME, version: OWNER_VERSION, file: ownerArtifact, manifest: ownerManifest }
    candidates.set(OWNER_NAME, [ownerCandidate])
  }
  for (const list of candidates.values()) list.sort((left, right) => compareRangeVersions(right.version, left.version))
  const select = (name, spec) => (candidates.get(name) ?? []).find(candidate => satisfiesRange(candidate.version, spec))
  const selected = new Map()
  const visited = new Set()
  const overrides = {}
  const queue = []
  const targetParent = { name: PACKAGE_NAME }
  for (const section of ['dependencies', 'peerDependencies']) for (const [name, spec] of Object.entries(packedManifest[section] ?? {})) queue.push({ name, spec, parent: targetParent, optional: false })
  queue.push({ name: 'dsh-model-switch', spec: '0.4.2', parent: undefined, optional: false })
  if (includeOwner) queue.push({ name: OWNER_NAME, spec: OWNER_VERSION, parent: undefined, optional: false })
  while (queue.length) {
    const edge = queue.shift()
    const candidate = select(edge.name, edge.spec)
    if (candidate === undefined) {
      if (edge.optional) continue
      fail('fixture graph cannot satisfy ' + edge.name + '@' + edge.spec)
    }
    const previous = selected.get(edge.name)
    if (previous === undefined) selected.set(edge.name, candidate)
    if (edge.parent !== undefined) overrides[edge.parent.name + '>' + edge.name] = 'file:' + candidate.file
    if (visited.has(candidate.id)) continue
    visited.add(candidate.id)
    for (const section of ['dependencies', 'optionalDependencies', 'peerDependencies']) {
      for (const [name, spec] of Object.entries(candidate.manifest[section] ?? {})) {
        const optional = section === 'optionalDependencies' || (section === 'peerDependencies' && candidate.manifest.peerDependenciesMeta?.[name]?.optional === true)
        queue.push({ name, spec, parent: candidate, optional })
      }
    }
  }
  const dependencies = { [PACKAGE_NAME]: 'file:' + archive }
  if (includeOwner) dependencies[OWNER_NAME] = 'file:' + ownerArtifact
  for (const [name, candidate] of selected) if (name !== PACKAGE_NAME && name !== OWNER_NAME) dependencies[name] = 'file:' + candidate.file
  if (includeOwner) overrides['dsh-model-switch>' + OWNER_NAME] = 'file:' + ownerArtifact
  writeFileSync(join(consumer, 'package.json'), JSON.stringify({
    name: 'dsh-llm-grok-pack-consumer',
    private: true,
    type: 'module',
    dependencies,
    pnpm: { overrides },
  }, null, 2) + '\n')
  const userConfig = join(consumer, '.npmrc')
  writeFileSync(userConfig, [
    'registry=' + INVALID_REGISTRY,
    'store-dir=' + store,
    'cache-dir=' + cache,
    'auto-install-peers=true',
    'audit=false',
    'fund=false',
    'supportedArchitectures.os=linux',
    'supportedArchitectures.cpu=x64',
  ].join('\n') + '\n')
  run('pnpm', ['install', '--offline', '--ignore-scripts', '--config.audit=false', '--config.fund=false', '--registry=' + INVALID_REGISTRY], {
    cwd: consumer,
    env: {
      npm_config_registry: INVALID_REGISTRY,
      npm_config_userconfig: userConfig,
      npm_config_globalconfig: CHILD_GLOBALCONFIG,
      npm_config_store_dir: store,
      npm_config_cache: cache,
      npm_config_auto_install_peers: 'true',
      npm_config_audit: 'false',
      npm_config_fund: 'false',
      pnpm_config_registry: INVALID_REGISTRY,
      pnpm_config_userconfig: userConfig,
      pnpm_config_globalconfig: CHILD_GLOBALCONFIG,
      pnpm_config_store_dir: store,
      pnpm_config_cache: cache,
      pnpm_config_auto_install_peers: 'true',
      pnpm_config_audit: 'false',
      pnpm_config_fund: 'false',
    },
  })
  const installedRoot = join(consumer, 'node_modules', PACKAGE_NAME)
  if (!statExists(join(installedRoot, 'package.json'))) fail('offline install did not produce the target package')
  const resolved = realpathSync(installedRoot)
  if (resolved.startsWith(ROOT + sep)) fail('offline install resolved the target to the source checkout')
  if (!includeOwner && statExists(join(consumer, 'node_modules', OWNER_NAME, 'package.json'))) fail('no-owner install unexpectedly included the owner package')
  return { consumer, installedRoot }
}

function smokePublicFactories(consumer) {
  const file = join(consumer, 'factory-smoke.mjs')
  const script = [
    "import { createRequire } from 'node:module'",
    "const require = createRequire(import.meta.url)",
    "const host = await import('dsh-llm-grok')",
    "if (typeof host.apply !== 'function' || typeof host.GrokAdapter !== 'function') throw new Error('public Host factory missing')",
    "const invariant = await import('dsh-llm-grok/invariant')",
    "if (typeof invariant.apply !== 'function' || typeof invariant.name !== 'string') throw new Error('public invariant factory missing')",
    "let registration",
    "globalThis.window = { __ModuleLoader__: { load(value) { registration = value } } }",
    "await import('dsh-llm-grok/client')",
    "if (registration?.id !== 'dsh-llm-grok' || typeof registration.factory !== 'function') throw new Error('public client ModuleLoader registration missing')",
    "const client = registration.factory(require)",
    "if (typeof client.apply !== 'function' || client.name !== 'dsh-llm-grok-client') throw new Error('public client factory missing')",
    "console.log('public Host/invariant/client ModuleLoader factories passed')",
  ].join('\n') + '\n'
  writeFileSync(file, script)
  run(process.execPath, [file], { cwd: consumer })
}

let work
let primaryError
try {
  initializeChildEnvironment()
  checkChildEnvironment()
  const sourceManifest = readJson(join(ROOT, 'package.json'))
  checkRootManifest(sourceManifest)
  checkLockfile(sourceManifest)
  work = mkdtempSync(join(tmpdir(), 'dsh-llm-grok-pack-'))
  const owner = verifyOwnerArtifact(work)
  // Build immediately before packing so tracked lib output cannot drift from src.
  run('pnpm', ['run', 'build'], { env: { DSH_LLM_PROVIDERS_UI_SORTABLE: owner.sortable } })
  checkBundledSortable(owner)
  const fixture = fixtureArchives(work)
  const packed = pack(ROOT, join(work, 'plugin-pack'))
  const packedFiles = archiveEntries(packed.archive, 'packed plugin', { regularMembers: true })
  const packedRoot = extractArchive(packed.archive, work, 'packed plugin')
  const packedManifest = readJson(join(packedRoot, 'package.json'))
  checkManifest(packedManifest, packedFiles, 'packed plugin', { strictAlpha: true, allowModelFixture: true })
  for (const required of ['LICENSE', 'README.md', 'README.zh.md', 'cordis.patch.yml', 'lib/index.js', 'lib/invariant.js', 'lib/client.js', 'lib/types/index.d.ts', 'lib/types/invariant.d.ts', 'lib/types/client/index.d.ts']) if (!packedFiles.has(required)) fail('packed plugin is missing ' + required)
  if ([...packedFiles].some(file => /^(?:src|tests|scripts|node_modules)(?:\/|$)/u.test(file))) fail('packed plugin contains source, test, script, or node_modules files')
  checkStaticClosure(packedRoot, packedManifest)
  const installed = installOffline(packed.archive, fixture, owner.artifact, owner.manifest, packedManifest, work)
  const installedManifest = readJson(join(installed.installedRoot, 'package.json'))
  const installedFiles = new Set()
  const collect = directory => {
    for (const entry of readdirSync(directory, { withFileTypes: true })) {
      const file = join(directory, entry.name)
      if (entry.isDirectory()) collect(file)
      else if (entry.isFile()) installedFiles.add(relative(installed.installedRoot, file).split(sep).join('/'))
    }
  }
  collect(installed.installedRoot)
  checkManifest(installedManifest, installedFiles, 'installed plugin', { strictAlpha: true, allowModelFixture: true })
  checkStaticClosure(installed.installedRoot, installedManifest)
  smokePublicFactories(installed.consumer)
  const withoutOwner = installOffline(packed.archive, fixture, owner.artifact, owner.manifest, packedManifest, work, false)
  smokePublicFactories(withoutOwner.consumer)
  console.log('pack check passed: owner artifact, real tarball, exports/main/types, static closure, recursive fixture graph, fresh-store owner/no-owner offline installs, and public factories verified')
  console.log('validated owner artifact: ' + owner.artifact + ' sha256=' + process.env.DSH_LLM_PROVIDERS_UI_SHA256.toLowerCase())
} catch (error) {
  primaryError = error
  throw error
} finally {
  const cleanupTargets = [...(work === undefined ? [] : [{ path: work, label: 'pack work tree' }]), { path: CHILD_ENV_ROOT, label: 'child environment tree' }]
  const cleanupErrors = []
  for (const target of cleanupTargets) {
    try {
      cleanupTemporaryPath(target.path, target.label)
    } catch (error) {
      cleanupErrors.push(error)
    }
  }
  if (cleanupErrors.length !== 0) {
    const failures = primaryError === undefined ? [] : [primaryError]
    for (const error of cleanupErrors) {
      if (error instanceof AggregateError) failures.push(...error.errors)
      else failures.push(error)
    }
    throw new AggregateError(failures, 'pack gate execution and cleanup failed')
  }
}
