import { describe, expect, it } from 'vitest'
import { ENGINE_MODELS, REAL_TEST_MODELS, TEST_MODEL, downloadSize, engineId, fileUrl, folderName, recommendedChatModel } from '../../src/shared/engineCatalog'
import { keepAliveSeconds, presetText } from '../../src/main/engine/preset'

describe('presetText', () => {
  it('writes a section per model with its options', () => {
    const text = presetText(
      [
        { name: 'qwen3:4b', model: '/data/models/qwen3-4b/Qwen3-4B-Q4_K_M.gguf' },
        { name: 'qwen3-vl:4b', model: '/m/vl.gguf', mmproj: '/m/mmproj.gguf' },
        { name: 'qwen3-embedding:0.6b', model: '/m/e.gguf', options: { embeddings: true, pooling: 'last', ub: 4096 } }
      ],
      { contextWindow: 16384, sleepSeconds: 1800 }
    )
    expect(text.split('\n').slice(0, 5)).toEqual(['version = 1', '', '[*]', 'c = 16384', 'sleep-idle-seconds = 1800'])
    expect(text).toContain('[qwen3:4b]\nmodel = /data/models/qwen3-4b/Qwen3-4B-Q4_K_M.gguf\n')
    expect(text).toContain('[qwen3-vl:4b]\nmodel = /m/vl.gguf\nmmproj = /m/mmproj.gguf\n')
    expect(text).toContain('embeddings = true\npooling = last\nub = 4096\n')
  })

  it('writes Windows paths with forward slashes and leaves out sleep when it is off', () => {
    const text = presetText([{ name: 'a', model: 'C:\\Users\\Ann Lee\\AppData\\Roaming\\Hearth\\models\\a\\a.gguf' }], { contextWindow: 8192, sleepSeconds: -1 })
    expect(text).toContain('model = C:/Users/Ann Lee/AppData/Roaming/Hearth/models/a/a.gguf')
    expect(text).not.toContain('sleep-idle-seconds')
  })
})

describe('keepAliveSeconds', () => {
  it('reads the durations Settings offers', () => {
    expect(keepAliveSeconds('5m')).toBe(300)
    expect(keepAliveSeconds('30m')).toBe(1800)
    expect(keepAliveSeconds('2h')).toBe(7200)
    expect(keepAliveSeconds('-1')).toBe(-1)
    expect(keepAliveSeconds('0')).toBe(1)
    expect(keepAliveSeconds('90')).toBe(90)
    expect(keepAliveSeconds('soon')).toBe(1800)
  })
})

describe('the engine catalog', () => {
  it('pins every file to a revision, a size and a checksum', () => {
    for (const m of ENGINE_MODELS) {
      expect(m.revision, m.name).toMatch(/^[0-9a-f]{40}$/)
      expect(m.files.filter((f) => f.role === 'model'), m.name).toHaveLength(1)
      for (const f of m.files) {
        expect(f.sha256, f.name).toMatch(/^[0-9a-f]{64}$/)
        expect(f.size, f.name).toBeGreaterThan(1e8)
        expect(f.name, f.name).toMatch(/\.gguf$/)
      }
      expect(fileUrl(m, m.files[0])).toBe(`https://huggingface.co/${m.repo}/resolve/${m.revision}/${m.files[0].name}`)
    }
  })

  it('gives each kind of model what it needs to run', () => {
    const names = ENGINE_MODELS.map((m) => m.name)
    expect(new Set(names).size).toBe(names.length)
    for (const m of ENGINE_MODELS) {
      expect(m.files.some((f) => f.role === 'mmproj'), m.name).toBe(m.capabilities.includes('vision'))
      if (m.capabilities.includes('embedding')) expect(m.options?.embeddings, m.name).toBe(true)
    }
    // The defaults Hearth picks need these.
    for (const name of ['qwen3:4b', 'qwen3:8b', 'qwen3:14b', 'qwen3-coder:30b', 'qwen2.5-coder:1.5b', 'qwen3-embedding:0.6b', 'qwen3-vl:4b']) expect(names).toContain(name)
    expect(ENGINE_MODELS.find((m) => m.name === 'qwen2.5-coder:1.5b')?.capabilities).toContain('insert')
  })

  it('keeps the test model out of the real list', () => {
    expect(ENGINE_MODELS.map((m) => m.name)).not.toContain(TEST_MODEL.name)
    expect(downloadSize(TEST_MODEL)).toBe(262144)
  })

  it('suggests an agent that fits the memory', () => {
    const gb = 1024 ** 3
    expect(recommendedChatModel(8 * gb)).toBe('qwen3:4b')
    expect(recommendedChatModel(16 * gb)).toBe('qwen3:8b')
    expect(recommendedChatModel(24 * gb)).toBe('qwen3:8b')
    expect(recommendedChatModel(32 * gb)).toBe('qwen3:14b')
    expect(recommendedChatModel(64 * gb)).toBe('qwen3-coder:30b')
    expect(recommendedChatModel(0)).toBe('qwen3:4b')
  })

  it('gives the engine names it will not rewrite', () => {
    // llama.cpp takes what follows a colon for a quantization tag and changes it.
    expect(engineId('qwen3-embedding:0.6b')).toBe('qwen3-embedding-0.6b')
    for (const m of [...ENGINE_MODELS, ...REAL_TEST_MODELS, TEST_MODEL]) expect(engineId(m.name), m.name).not.toContain(':')
    const ids = [...ENGINE_MODELS, ...REAL_TEST_MODELS].map((m) => engineId(m.name))
    expect(new Set(ids).size).toBe(ids.length)
  })

  it('names folders without characters Windows forbids', () => {
    expect(folderName('qwen3-embedding:0.6b')).toBe('qwen3-embedding-0.6b')
    for (const m of ENGINE_MODELS) expect(folderName(m.name)).not.toMatch(/[<>:"/\\|?*]/)
  })
})
