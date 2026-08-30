import { useBoard } from '../store'
import { engineEvents } from '../engine/engine'
import { allTools, callTool, type ToolDef } from './registry'

/**
 * Bridge the internal registry onto the browser's WebMCP surface.
 *
 * Silent-failure traps this code respects:
 *  - document.modelContext, NOT navigator.modelContext (removed in Chrome 150;
 *    we fall back to it only for 149-era builds where document.* is absent).
 *  - Registration happens in the top-level page — never inside an iframe.
 *  - Tools with `applicable` (merge_duplicates) are registered only while
 *    applicable, and unregistered via AbortController when not.
 */

type ModelContext = {
  registerTool: (
    tool: {
      name: string
      description: string
      inputSchema: Record<string, unknown>
      annotations?: Record<string, boolean>
      execute: (input: Record<string, unknown>) => Promise<{ content: Array<{ type: 'text'; text: string }> }>
    },
    opts?: { signal?: AbortSignal },
  ) => void | Promise<void>
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
        description: def.description,
        inputSchema: def.inputSchema,
        ...(def.annotations ? { annotations: { ...def.annotations } as Record<string, boolean> } : {}),
        execute: async (input) => {
          // External callers self-identify via the agent param; default mark
          // distinguishes "some external agent" from in-page ones.
          const text = await callTool(def.name, input ?? {}, 'agent')
          return { content: [{ type: 'text', text }] }
        },
      },
      { signal: controller.signal },
    )
  } catch (err) {
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
