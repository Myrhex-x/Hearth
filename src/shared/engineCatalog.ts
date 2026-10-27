import type { ModelCapability } from './types'

// The models Hearth can download and run on its own, with llama.cpp. Each
// file is pinned to a Hugging Face revision with its size and SHA-256, so a
// download is checked before it is used. Names match Ollama's, so the same
// model reads the same wherever it runs.

export interface EngineFile {
  name: string
  size: number
  sha256: string
  /** The weights, or the image encoder of a model that can see. */
  role: 'model' | 'mmproj'
}

export interface EngineModel {
  name: string
  label: string
  repo: string
  revision: string
  files: EngineFile[]
  family: string
  parameterSize: string
  quantization: string
  capabilities: ModelCapability[]
  /** What it is for, next to the download button. */
  note: string
  /** Memory it is comfortable with, in GB. */
  memoryGB: number
  /** The context it was trained for. */
  contextLength: number
  /** llama-server options for this model, written to its preset. */
  options?: Record<string, string | number | boolean>
}

/** A catalog model as the interface sees it. */
export interface EngineCatalogEntry extends EngineModel {
  installed: boolean
  sizeBytes: number
  /** Bytes already on disk from a download that stopped. */
  partialBytes: number
}

export interface EngineInfo {
  /** The engine is part of this copy of Hearth. */
  available: boolean
  version: string | null
  modelsDir: string
  running: boolean
}

export const ENGINE_MODELS: EngineModel[] = [
  {
    name: 'qwen3:4b',
    label: 'Qwen3 4B',
    repo: 'Qwen/Qwen3-4B-GGUF',
    revision: 'bc640142c66e1fdd12af0bd68f40445458f3869b',
    files: [{ name: 'Qwen3-4B-Q4_K_M.gguf', size: 2497280256, sha256: '7485fe6f11af29433bc51cab58009521f205840f5b4ae3a32fa7f92e8534fdf5', role: 'model' }],
    family: 'qwen3',
    parameterSize: '4B',
    quantization: 'Q4_K_M',
    capabilities: ['completion', 'tools', 'thinking'],
    note: 'Agent and chat, 8 GB of memory',
    memoryGB: 8,
    contextLength: 32768
  },
  {
    name: 'qwen3:8b',
    label: 'Qwen3 8B',
    repo: 'Qwen/Qwen3-8B-GGUF',
    revision: '7c41481f57cb95916b40956ab2f0b139b296d974',
    files: [{ name: 'Qwen3-8B-Q4_K_M.gguf', size: 5027783488, sha256: 'd98cdcbd03e17ce47681435b5150e34c1417f50b5c0019dd560e4882c5745785', role: 'model' }],
    family: 'qwen3',
    parameterSize: '8B',
    quantization: 'Q4_K_M',
    capabilities: ['completion', 'tools', 'thinking'],
    note: 'Agent and chat, 16 GB of memory',
    memoryGB: 16,
    contextLength: 32768
  },
  {
    name: 'qwen3:14b',
    label: 'Qwen3 14B',
    repo: 'Qwen/Qwen3-14B-GGUF',
    revision: '530227a7d994db8eca5ab5ced2fb692b614357fd',
    files: [{ name: 'Qwen3-14B-Q4_K_M.gguf', size: 9001752960, sha256: '500a8806e85ee9c83f3ae08420295592451379b4f8cf2d0f41c15dffeb6b81f0', role: 'model' }],
    family: 'qwen3',
    parameterSize: '14B',
    quantization: 'Q4_K_M',
    capabilities: ['completion', 'tools', 'thinking'],
    note: 'Stronger agent, 24 GB of memory',
    memoryGB: 24,
    contextLength: 32768
  },
  {
    name: 'gpt-oss:20b',
    label: 'gpt-oss 20B',
    repo: 'ggml-org/gpt-oss-20b-GGUF',
    revision: '15dcfc7e7c608c6161507211ed43c5b590801b4b',
    files: [{ name: 'gpt-oss-20b-MXFP4.gguf', size: 12109566624, sha256: '27cd6c432c7672cb812a92f611cf3ba7bbc35928262bb1e1253ff4ee6ae35901', role: 'model' }],
    family: 'gpt-oss',
    parameterSize: '20B',
    quantization: 'MXFP4',
    capabilities: ['completion', 'tools', 'thinking'],
    note: 'Reasoning agent, 24 GB of memory',
    memoryGB: 24,
    contextLength: 131072
  },
  {
    name: 'qwen3-coder:30b',
    label: 'Qwen3 Coder 30B',
    repo: 'unsloth/Qwen3-Coder-30B-A3B-Instruct-GGUF',
    revision: 'b17cb02dd882d5b6ab62fc777ad2995f19668350',
    files: [{ name: 'Qwen3-Coder-30B-A3B-Instruct-Q4_K_M.gguf', size: 18556689568, sha256: 'fadc3e5f8d42bf7e894a785b05082e47daee4df26680389817e2093056f088ad', role: 'model' }],
    family: 'qwen3moe',
    parameterSize: '30B',
    quantization: 'Q4_K_M',
    capabilities: ['completion', 'tools'],
    note: 'Best agent, 48 GB of memory',
    memoryGB: 48,
    contextLength: 262144
  },
  {
    name: 'qwen2.5-coder:1.5b',
    label: 'Qwen2.5 Coder 1.5B',
    repo: 'ggml-org/Qwen2.5-Coder-1.5B-Q8_0-GGUF',
    revision: '8be1b8a895a84beea772817caaa71eba6b6e0d07',
    files: [{ name: 'qwen2.5-coder-1.5b-q8_0.gguf', size: 1646573056, sha256: '29871c94d15727a6e243f79a37113d4ae625a6215b5e800bf41a23af2da32832', role: 'model' }],
    family: 'qwen2',
    parameterSize: '1.5B',
    quantization: 'Q8_0',
    capabilities: ['completion', 'insert'],
    note: 'Fast autocomplete',
    memoryGB: 8,
    contextLength: 32768,
    options: { c: 8192 }
  },
  {
    name: 'qwen3-embedding:0.6b',
    label: 'Qwen3 Embedding 0.6B',
    repo: 'Qwen/Qwen3-Embedding-0.6B-GGUF',
    revision: '370f27d7550e0def9b39c1f16d3fbaa13aa67728',
    files: [{ name: 'Qwen3-Embedding-0.6B-Q8_0.gguf', size: 639150592, sha256: '06507c7b42688469c4e7298b0a1e16deff06caf291cf0a5b278c308249c3e439', role: 'model' }],
    family: 'qwen3',
    parameterSize: '0.6B',
    quantization: 'Q8_0',
    capabilities: ['embedding'],
    note: 'Search by meaning',
    memoryGB: 8,
    contextLength: 32768,
    // A piece of code is embedded in one go, so the batch has to hold the longest piece.
    options: { embeddings: true, pooling: 'last', c: 8192, b: 4096, ub: 4096 }
  },
  {
    name: 'qwen3-vl:4b',
    label: 'Qwen3 VL 4B',
    repo: 'Qwen/Qwen3-VL-4B-Instruct-GGUF',
    revision: '1cd86afb9a95c410a6038ab3b40d8b578c892266',
    files: [
      { name: 'Qwen3VL-4B-Instruct-Q4_K_M.gguf', size: 2497281664, sha256: '66358cb18bb6b3b1b6675aa412c7a88ef01d228f481184d13668e5201c730a0a', role: 'model' },
      { name: 'mmproj-Qwen3VL-4B-Instruct-Q8_0.gguf', size: 453974304, sha256: '30ba2c7dd3127a4561b6cba9d13d0f711c91bdb38742e2f56d73c8cb596bd06d', role: 'mmproj' }
    ],
    family: 'qwen3vl',
    parameterSize: '4B',
    quantization: 'Q4_K_M',
    capabilities: ['completion', 'vision', 'tools'],
    note: 'Reads images, uses tools',
    memoryGB: 8,
    contextLength: 262144
  }
]

/**
 * A tiny stand-in the end-to-end tests download from their own server. It is
 * not a real model: their fake engine answers for it.
 */
export const TEST_MODEL: EngineModel = {
  name: 'tiny-test:1m',
  label: 'Tiny test model',
  repo: 'hearth-test/tiny',
  revision: 'main',
  files: [{ name: 'tiny-test.gguf', size: 262144, sha256: '88a27acc92907475c5f16c76b14633def7715e1a1f7672fd362564229c05ce96', role: 'model' }],
  family: 'test',
  parameterSize: '1M',
  quantization: 'F16',
  capabilities: ['completion', 'tools', 'thinking'],
  note: 'For the tests',
  memoryGB: 1,
  contextLength: 4096
}

/**
 * Real models of about a megabyte, from llama.cpp's own tests: they let CI
 * run the actual engine on every system. They write nonsense stories.
 */
const STORIES = { repo: 'ggml-org/models', revision: '499bc8821c6b12b4e53c5bffcb21ec206f212d81', family: 'llama', parameterSize: '260K', quantization: 'F32', memoryGB: 1, contextLength: 512, note: 'For the tests' }
const STORIES_FILE: EngineFile = { name: 'tinyllamas/stories260K.gguf', size: 1185376, sha256: '270cba1bd5109f42d03350f60406024560464db173c0e387d91f0426d3bd256d', role: 'model' }

export const REAL_TEST_MODELS: EngineModel[] = [
  { ...STORIES, name: 'stories:260k', label: 'Stories 260K', files: [STORIES_FILE], capabilities: ['completion'] },
  {
    ...STORIES,
    name: 'stories-infill:260k',
    label: 'Stories 260K infill',
    files: [{ name: 'tinyllamas/stories260K-infill.gguf', size: 1185760, sha256: '102f2a00a5bfc56d0706467830bda9e39fa5d7df1cd55e47291dd25b4b509140', role: 'model' }],
    capabilities: ['completion', 'insert']
  },
  // Pieces of a real project run past 512 tokens: the batch has to hold them, as for the real embedding model.
  { ...STORIES, name: 'stories-embed:260k', label: 'Stories 260K embeddings', files: [STORIES_FILE], capabilities: ['embedding'], options: { embeddings: true, pooling: 'mean', c: 4096, b: 4096, ub: 4096 } }
]

/** The bytes of TEST_MODEL's file, shared by the tests and their server. */
export function testModelBytes(): Uint8Array {
  const out = new Uint8Array(TEST_MODEL.files[0].size)
  for (let i = 0; i < out.length; i++) out[i] = (i * 31 + 7) % 251
  return out
}

export function downloadSize(m: EngineModel): number {
  return m.files.reduce((sum, f) => sum + f.size, 0)
}

export function fileUrl(m: EngineModel, file: EngineFile, mirror = 'https://huggingface.co'): string {
  return `${mirror.replace(/\/+$/, '')}/${m.repo}/resolve/${m.revision}/${file.name}`
}

/** A folder name that works on every system: no colons on Windows. */
export function folderName(name: string): string {
  return name.replace(/[^a-z0-9.]+/gi, '-')
}

/**
 * The name the engine knows a model by. No colon: llama.cpp reads what follows
 * one as a quantization tag and rewrites it ("qwen3:4b" would become "qwen3:4B").
 */
export function engineId(name: string): string {
  return folderName(name)
}

/** The agent model that fits this much memory comfortably. */
export function recommendedChatModel(memoryBytes: number): string {
  const gb = memoryBytes / 1024 ** 3
  if (gb >= 46) return 'qwen3-coder:30b'
  if (gb >= 28) return 'qwen3:14b'
  if (gb >= 14) return 'qwen3:8b'
  return 'qwen3:4b'
}
