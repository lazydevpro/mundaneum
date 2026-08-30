import { useBoard } from '../store'
import { engineEvents } from '../engine/engine'
import { allTools, callTool, type ToolDef } from './registry'

/**
 * Bridge the internal registry onto the browser's WebMCP surface
 * (https://webmachinelearning.github.io/webmcp/).
 *
 * Spec fidelity notes:
 *  - execute returns a PLAIN value; the user agent serializes it to JSON.
 *    (No MCP-style content wrapper — that would double-encode.)
 *  - annotations carries exactly the spec's members: readOnlyHint,
 *    untrustedContentHint. Our internal destructiveHint stays internal —
 *    it drives dynamic registration, per Chrome's guidance to register
 *    destructive tools only while applicable.
 *  - unregistration is AbortSignal-based; the pending registerTool promise
 *    rejects with the abort reason, which is expected, not an error.
 *  - document.modelContext, NOT navigator.modelContext (removed in Chrome
 *    150; we fall back only for 149-era builds).
 *  - Registration happens in the top-level page — never inside an iframe.
 */

interface RegisteredToolHandle {
  name: string
}

type ModelContext = {
  registerTool: (
    tool: {
      name: string
      title?: string
      description: string
      inputSchema: Record<string, unknown>
      annotations?: { readOnlyHint?: boolean; untrustedContentHint?: boolean }
      execute: (input: Record<string, unknown>) => Promise<unknown>
    },
    opts?: { signal?: AbortSignal },
  ) => void | Promise<void>
  getTools?: () => Promise<RegisteredToolHandle[]>
  executeTool?: (tool: RegisteredToolHandle, input?: object) => Promise<string>
}

function modelContext(): ModelContext | null {
  if (window !== window.top) return null // iframe tools are invisible to agents
  const d = document as Document & { modelContext?: ModelContext }
  const n = navigator as Navigator & { modelContext?: ModelContext }
  return d.modelContext ?? n.modelContext ?? null
}

export type WebMcpStatus = 'live' | 'unavailable'

const controllers = new Map<string, AbortController>()

async function register(mc: ModelContext, def: ToolDef): Promise<void> {
  if (controllers.has(def.name)) return
  const controller = new AbortController()
  controllers.set(def.name, controller)
  try {
    await mc.registerTool(
      {
        name: def.name,
        ...(def.title ? { title: def.title } : {}),
        description: def.description,
        inputSchema: def.inputSchema,
        annotations: {
          readOnlyHint: Boolean(def.annotations?.readOnlyHint),
          untrustedContentHint: Boolean(def.annotations?.untrustedContentHint),
        },
        execute: async (input) => {
          // External callers self-identify via the agent param; default mark
          // distinguishes "some external agent" from in-page ones.
          const text = await callTool(def.name, input ?? {}, 'agent')
          try {
            return JSON.parse(text) as unknown
          } catch {
            return text
          }
        },
      },
      { signal: controller.signal },
    )
  } catch (err) {
    if (controller.signal.aborted) return // expected: unregistration path
    controllers.delete(def.name)
    console.warn('webmcp: failed to register ' + def.name, err)
  }
}

function unregister(name: string): void {
  controllers.get(name)?.abort()
  controllers.delete(name)
}

function sync(mc: ModelContext): void {
  for (const def of allTools()) {
    const want = !def.applicable || def.applicable()
    const have = controllers.has(def.name)
    if (want && !have) void register(mc, def)
    else if (!want && have) unregister(def.name)
  }
}

export function startWebMcp(): WebMcpStatus {
  const mc = modelContext()
  if (!mc) {
    console.info(
      'WebMCP: document.modelContext not available. ' +
        'Enable chrome://flags/#enable-webmcp-testing locally, or serve with an origin-trial token.',
    )
    return 'unavailable'
  }
  sync(mc)
  // Re-evaluate dynamic tools when structure changes or the board mutates.
  engineEvents.addEventListener('organized', () => sync(mc))
  let last = useBoard.getState().cards
  useBoard.subscribe((s) => {
    if (s.cards !== last) {
      last = s.cards
      sync(mc)
    }
  })
  return 'live'
}

/**
 * In-page agents act as spec-proper WebMCP clients when the surface exists:
 * getTools()/executeTool() through the browser, so UA-level permissioning
 * and logging see them. Returns null when unavailable (caller falls back to
 * the internal registry — identical payloads either way).
 */
export async function executeViaWebMcp(
  name: string,
  input: Record<string, unknown>,
): Promise<string | null> {
  const mc = modelContext()
  if (!mc?.getTools || !mc.executeTool) return null
  try {
    const tools = await mc.getTools()
    const tool = tools.find((t) => t.name === name)
    if (!tool) return null
    return String(await mc.executeTool(tool, input))
  } catch {
    return null
  }
}
