#!/usr/bin/env node
// Sums the token usage of one Claude Code session from its transcripts.
//
//   node tokens.mjs <session-id>
//
// Reads ~/.claude/projects/*/<id>.jsonl and ~/.claude/projects/*/<id>/subagents/*.jsonl
// (CLAUDE_CONFIG_DIR replaces ~/.claude when set) and prints one line of JSON:
//   { "input": n, "cacheCreation": n, "output": n, "cacheRead": n, "requests": n }
//
// The transcript writes an assistant message once per content block, each copy
// carrying the usage so far, so lines are grouped by message.id + requestId and
// each usage field is the maximum over the group. Malformed lines are skipped.
// Exits 1 when the session has no main transcript.

import { createReadStream, existsSync, readdirSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'
import { createInterface } from 'node:readline'

const FIELDS = {
  input: 'input_tokens',
  cacheCreation: 'cache_creation_input_tokens',
  output: 'output_tokens',
  cacheRead: 'cache_read_input_tokens',
}

function fail(message) {
  process.stderr.write(`tokens.mjs: ${message}\n`)
  process.exit(1)
}

function listDir(path) {
  try {
    return readdirSync(path, { withFileTypes: true })
  } catch {
    return []
  }
}

function findTranscripts(projectsDir, id) {
  const main = []
  const subagents = []

  for (const project of listDir(projectsDir)) {
    if (!project.isDirectory()) continue
    const dir = join(projectsDir, project.name)
    const file = join(dir, `${id}.jsonl`)
    if (existsSync(file)) main.push(file)

    const subDir = join(dir, id, 'subagents')
    for (const entry of listDir(subDir)) {
      if (entry.isFile() && entry.name.endsWith('.jsonl')) subagents.push(join(subDir, entry.name))
    }
  }

  return { main, subagents }
}

async function collect(file, byRequest) {
  const lines = createInterface({ input: createReadStream(file), crlfDelay: Infinity })

  for await (const line of lines) {
    // Cheap filter before parsing: most lines are not assistant messages.
    if (!line.includes('"assistant"')) continue

    let row
    try {
      row = JSON.parse(line)
    } catch {
      continue
    }

    const usage = row?.message?.usage
    if (row?.type !== 'assistant' || usage === null || typeof usage !== 'object') continue
    if (row.message.model === '<synthetic>') continue

    const key = `${row.message.id ?? row.uuid}:${row.requestId ?? ''}`
    const seen = byRequest.get(key) ?? { input: 0, cacheCreation: 0, output: 0, cacheRead: 0 }
    for (const [name, field] of Object.entries(FIELDS)) {
      const value = Number(usage[field])
      if (Number.isFinite(value) && value > seen[name]) seen[name] = value
    }
    byRequest.set(key, seen)
  }
}

const id = process.argv[2]
if (id === undefined || !/^[A-Za-z0-9_-]+$/.test(id)) fail('usage: tokens.mjs <session-id>')

const configDir = process.env.CLAUDE_CONFIG_DIR || join(homedir(), '.claude')
const { main, subagents } = findTranscripts(join(configDir, 'projects'), id)
if (main.length === 0) fail(`no transcript for session ${id}`)

const byRequest = new Map()
for (const file of [...main, ...subagents]) {
  try {
    await collect(file, byRequest)
  } catch {
    // A file that vanished or cannot be read adds nothing.
  }
}

const totals = { input: 0, cacheCreation: 0, output: 0, cacheRead: 0, requests: byRequest.size }
for (const usage of byRequest.values()) {
  for (const name of Object.keys(FIELDS)) totals[name] += usage[name]
}

process.stdout.write(`${JSON.stringify(totals)}\n`)
