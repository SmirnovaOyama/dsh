// The tools the agent can call: their JSON schemas for DeepSeek, and how each one runs.

import { mkdir, writeFile } from 'node:fs/promises'
import path from 'node:path'
import type { DiffLine, DiffStats, Todo, ToolInfo } from '../../shared/types'
import type { ChangeTracker } from '../changes'
import type { ToolSpec } from '../deepseek'
import { countLines, diffText } from '../diff'
import {
  findFilesTool,
  listDirTool,
  prepareEditFile,
  prepareWriteFile,
  readFileTool,
  searchFilesTool,
  type PreparedWrite,
  type ToolOutput,
} from './files'
import { ToolError, resolveInWorkspace } from './paths'
import { clampTimeout, commandPrefix, runCommand } from './shell'

export { ToolError }

export const TOOL_SPECS: ToolSpec[] = [
  {
    type: 'function',
    function: {
      name: 'read_file',
      description:
        'Read a text file in the workspace. Returns numbered lines. Reads up to 2000 lines; use offset and limit for long files. Always read a file before editing it.',
      parameters: {
        type: 'object',
        properties: {
          path: { type: 'string', description: 'Path relative to the workspace root.' },
          offset: { type: 'integer', description: 'First line to read, starting at 1.' },
          limit: { type: 'integer', description: 'How many lines to read.' },
        },
        required: ['path'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'list_dir',
      description: 'List files and folders as an indented tree. Large generated folders such as node_modules are marked as skipped.',
      parameters: {
        type: 'object',
        properties: {
          path: { type: 'string', description: 'Folder relative to the workspace root. Defaults to the root.' },
          depth: { type: 'integer', description: 'How many levels to show, 1 to 5. Defaults to 2.' },
        },
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'find_files',
      description: 'Find files by glob pattern, for example "**/*.test.ts" or "*.md". Respects .gitignore in git repositories.',
      parameters: {
        type: 'object',
        properties: {
          pattern: { type: 'string', description: 'Glob pattern matched against paths relative to `path`.' },
          path: { type: 'string', description: 'Folder to search in. Defaults to the workspace root.' },
        },
        required: ['pattern'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'search_files',
      description:
        'Search file contents with a JavaScript regular expression. Returns matching lines as path:line: text. Respects .gitignore in git repositories.',
      parameters: {
        type: 'object',
        properties: {
          pattern: { type: 'string', description: 'Regular expression to search for.' },
          path: { type: 'string', description: 'File or folder to search in. Defaults to the workspace root.' },
          glob: { type: 'string', description: 'Only search files whose path matches this glob, for example "*.ts".' },
          ignore_case: { type: 'boolean', description: 'Match without regard to case.' },
        },
        required: ['pattern'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'edit_file',
      description:
        'Replace an exact piece of text in an existing file. old_string must match the file exactly, including indentation, and must be unique unless replace_all is true. Prefer this over write_file for changes to existing files.',
      parameters: {
        type: 'object',
        properties: {
          path: { type: 'string', description: 'Path relative to the workspace root.' },
          old_string: { type: 'string', description: 'The exact text to replace.' },
          new_string: { type: 'string', description: 'The text to put in its place.' },
          replace_all: { type: 'boolean', description: 'Replace every occurrence instead of exactly one.' },
        },
        required: ['path', 'old_string', 'new_string'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'write_file',
      description: 'Create a new file, or replace a whole file, with the given content. Missing folders are created.',
      parameters: {
        type: 'object',
        properties: {
          path: { type: 'string', description: 'Path relative to the workspace root.' },
          content: { type: 'string', description: 'The complete file content.' },
        },
        required: ['path', 'content'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'run_command',
      description:
        'Run a shell command in the workspace root and return its exit code and output. Use it for tests, builds, linters, git and package managers. Commands are not interactive: pass flags such as --yes where needed. Do not start servers or watchers that never exit.',
      parameters: {
        type: 'object',
        properties: {
          command: { type: 'string', description: 'The command line to run.' },
          timeout_ms: { type: 'integer', description: 'Time limit in milliseconds, up to 600000. Defaults to 120000.' },
        },
        required: ['command'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'todo_write',
      description:
        'Keep a to-do list for the current task, shown to the user as you work. Use it for tasks with three or more steps: write the whole list each time, mark one item in_progress before you start it, and mark it completed as soon as it is done. Skip it for small, single-step requests.',
      parameters: {
        type: 'object',
        properties: {
          todos: {
            type: 'array',
            description: 'The complete list, in order.',
            items: {
              type: 'object',
              properties: {
                content: { type: 'string', description: 'What to do, as a short imperative sentence.' },
                status: { type: 'string', enum: ['pending', 'in_progress', 'completed'] },
              },
              required: ['content', 'status'],
            },
          },
        },
        required: ['todos'],
      },
    },
  },
]

/** Offered only in plan mode, where the agent reads first and asks before changing anything. */
export const PLAN_TOOL: ToolSpec = {
  type: 'function',
  function: {
    name: 'exit_plan_mode',
    description:
      'Call this when your plan is ready. The user sees the plan and decides whether you may start. Write the plan in Markdown: what you found, the files you will change and how, and how you will check the result. Do not call it for questions that need no changes; just answer them.',
    parameters: {
      type: 'object',
      properties: {
        plan: { type: 'string', description: 'The plan, in Markdown.' },
      },
      required: ['plan'],
    },
  },
}

export function toolSpecs(planMode: boolean): ToolSpec[] {
  return planMode ? [...TOOL_SPECS, PLAN_TOOL] : TOOL_SPECS
}

const TODO_STATUSES = new Set<Todo['status']>(['pending', 'in_progress', 'completed'])

export function parseTodos(input: unknown): Todo[] {
  if (!Array.isArray(input)) throw new ToolError('"todos" must be an array of { content, status }.')
  return input.slice(0, 50).map((entry, i) => {
    const { content, status } = (entry ?? {}) as Record<string, unknown>
    if (typeof content !== 'string' || !content.trim()) throw new ToolError(`Item ${i + 1} needs a non-empty "content".`)
    if (!TODO_STATUSES.has(status as Todo['status'])) throw new ToolError(`Item ${i + 1} needs a "status" of pending, in_progress or completed.`)
    return { content: content.trim(), status: status as Todo['status'] }
  })
}

export interface ToolRunContext {
  workspace: string
  tracker: ChangeTracker
  signal: AbortSignal
  onOutput(text: string): void
}

export interface ToolRunResult {
  /** What the model reads. */
  text: string
  /** What a person sees when they open the row. */
  display?: string
  info?: ToolInfo
  isError?: boolean
  /** Set by todo_write: the agent's new list. */
  todos?: Todo[]
}

export type PermissionNeed =
  | { kind: 'edit'; path: string; created: boolean; stats: DiffStats; lines: DiffLine[] }
  | { kind: 'command'; command: string; cwd: string; prefix: string }
  | { kind: 'plan'; plan: string }

export interface PreparedCall {
  target: string
  path?: string
  created?: boolean
  stats?: DiffStats
  /** Set for tools that change something, so the agent can ask before running them. */
  approval: PermissionNeed | null
  run(ctx: ToolRunContext): Promise<ToolRunResult>
}

export function parseArgs(raw: string): Record<string, unknown> {
  if (!raw.trim()) return {}
  try {
    const value = JSON.parse(raw) as unknown
    if (value && typeof value === 'object' && !Array.isArray(value)) return value as Record<string, unknown>
  } catch {
    // Fall through.
  }
  throw new ToolError('The tool arguments were not valid JSON. Send a JSON object that matches the schema.')
}

function fromOutput(output: ToolOutput): ToolRunResult {
  return {
    text: output.text,
    display: output.text,
    info: { lines: output.lines, matches: output.matches, files: output.files, truncated: output.truncated },
  }
}

function readOnly(target: string, run: () => Promise<ToolOutput>): PreparedCall {
  return { target, approval: null, run: async () => fromOutput(await run()) }
}

function writeCall(
  prepared: PreparedWrite,
  describe: (p: PreparedWrite) => string,
  reprepare: () => Promise<PreparedWrite>,
): PreparedCall {
  const { lines, stats } = diffText(prepared.before ?? '', prepared.after)
  const created = prepared.before === null
  return {
    target: prepared.target.rel,
    path: prepared.target.rel,
    created,
    stats,
    approval: { kind: 'edit', path: prepared.target.rel, created, stats, lines },
    async run(ctx) {
      // The file may have changed while the person was deciding, so apply the edit to what is on disk now.
      const fresh = await reprepare()
      await ctx.tracker.remember(fresh.target.rel)
      await mkdir(path.dirname(fresh.target.abs), { recursive: true })
      await writeFile(fresh.target.abs, fresh.after, 'utf8')
      return { text: describe(fresh), info: { lines: countLines(fresh.after) } }
    },
  }
}

export async function prepareToolCall(name: string, rawArgs: string, workspace: string): Promise<PreparedCall> {
  const args = parseArgs(rawArgs)
  switch (name) {
    case 'read_file':
      return readOnly((await resolveInWorkspace(workspace, args.path)).rel, () => readFileTool(workspace, args))
    case 'list_dir':
      return readOnly((await resolveInWorkspace(workspace, args.path ?? '.')).rel, () => listDirTool(workspace, args))
    case 'find_files':
      await resolveInWorkspace(workspace, args.path ?? '.')
      return readOnly(String(args.pattern ?? ''), () => findFilesTool(workspace, args))
    case 'search_files':
      await resolveInWorkspace(workspace, args.path ?? '.')
      return readOnly(String(args.pattern ?? ''), () => searchFilesTool(workspace, args))
    case 'edit_file': {
      const prepare = () => prepareEditFile(workspace, args)
      return writeCall(
        await prepare(),
        (p) => `Edited ${p.target.rel}: replaced ${p.replacements} occurrence${p.replacements === 1 ? '' : 's'}.`,
        prepare,
      )
    }
    case 'write_file': {
      const prepare = () => prepareWriteFile(workspace, args)
      return writeCall(
        await prepare(),
        (p) => `${p.before === null ? 'Created' : 'Rewrote'} ${p.target.rel} (${countLines(p.after)} lines).`,
        prepare,
      )
    }
    case 'run_command': {
      const command = typeof args.command === 'string' ? args.command.trim() : ''
      if (!command) throw new ToolError('"command" must not be empty.')
      const timeoutMs = clampTimeout(args.timeout_ms)
      return {
        target: command,
        approval: { kind: 'command', command, cwd: workspace, prefix: commandPrefix(command) },
        async run(ctx) {
          const result = await runCommand(command, { cwd: ctx.workspace, timeoutMs, signal: ctx.signal, onOutput: ctx.onOutput })
          const status = result.aborted
            ? 'Stopped by the user.'
            : result.timedOut
              ? `Timed out after ${Math.round(timeoutMs / 1000)} seconds and was stopped.`
              : `Exit code: ${result.exitCode ?? 'none'}`
          const output = result.output.trim() ? result.output : '(no output)'
          return {
            text: `${status}\n\n${output}`,
            display: output,
            info: { exitCode: result.exitCode, truncated: result.truncated },
            isError: result.aborted || result.timedOut || result.exitCode !== 0,
          }
        },
      }
    }
    case 'todo_write': {
      const todos = parseTodos(args.todos)
      const done = todos.filter((t) => t.status === 'completed').length
      return {
        target: `${done}/${todos.length}`,
        approval: null,
        run: async () => ({
          text: `To-do list updated (${done} of ${todos.length} done). Keep working on the task.`,
          todos,
        }),
      }
    }
    case 'exit_plan_mode': {
      const plan = typeof args.plan === 'string' ? args.plan.trim() : ''
      if (!plan) throw new ToolError('"plan" must not be empty.')
      return {
        target: plan.split('\n').find((line) => line.trim())?.replace(/^#+\s*/, '').slice(0, 80) ?? '',
        approval: { kind: 'plan', plan },
        run: async () => ({ text: 'The user approved the plan. Start working on it now, following it step by step.', display: plan }),
      }
    }
    default:
      throw new ToolError(`There is no tool called ${name}. Use one of: ${TOOL_SPECS.map((t) => t.function.name).join(', ')}.`)
  }
}
