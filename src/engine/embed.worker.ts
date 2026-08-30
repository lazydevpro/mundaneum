/// <reference lib="webworker" />
/**
 * Embedding worker. MiniLM-class models are FASTER on WASM than WebGPU
 * (dispatch overhead exceeds the computation) and have no shader-compile
 * cold start — so this is deliberately pinned to the WASM backend.
 */
import { pipeline, env, type FeatureExtractionPipeline } from '@huggingface/transformers'

env.allowLocalModels = false
// Model files come through our own origin (/hf/* proxy in dev and prod):
// same-origin fetches are immune to extensions that block huggingface.co.
env.remoteHost = self.location.origin + '/hf/'

let extractor: Promise<FeatureExtractionPipeline> | null = null

function getExtractor(): Promise<FeatureExtractionPipeline> {
  // Cast around transformers.js's giant task-union overload (TS2590).
  const make = pipeline as unknown as (
    task: string,
    model: string,
    opts: Record<string, unknown>,
  ) => Promise<FeatureExtractionPipeline>
  extractor ??= make('feature-extraction', 'Xenova/all-MiniLM-L6-v2', {
    device: 'wasm',
    dtype: 'q8',
    progress_callback: (p: unknown) => {
      const info = p as { status?: string; progress?: number; file?: string }
      if (info.status === 'progress' && typeof info.progress === 'number') {
        postMessage({ kind: 'progress', pct: Math.round(info.progress) })
      }
    },
  })
  return extractor
}

interface EmbedRequest {
  kind: 'embed' | 'warm'
  reqId: number
  texts?: string[]
}

self.onmessage = async (e: MessageEvent<EmbedRequest>) => {
  const { kind, reqId, texts } = e.data
  try {
    const pipe = await getExtractor()
    if (kind === 'warm') {
      // One tiny inference compiles the graph so the first real batch is instant.
      await pipe('warm', { pooling: 'mean', normalize: true })
      postMessage({ kind: 'ready', reqId })
      return
    }
    const out = await pipe(texts ?? [], { pooling: 'mean', normalize: true })
    const data = out.data as Float32Array
    const dim = out.dims[out.dims.length - 1]
    postMessage({ kind: 'embeddings', reqId, dim, data }, { transfer: [data.buffer as ArrayBuffer] })
  } catch (err) {
    postMessage({ kind: 'error', reqId, message: String(err) })
  }
}
