import catalog from './catalog.json'
import { gb, installedModel, lighter, machineLabel, pickModel, type Hardware } from './catalog'

const GiB = 2 ** 30
const mac = (gib: number, arch = 'aarch64'): Hardware => ({ ramBytes: gib * GiB, arch, os: 'macos', gpu: null })
const pc = (gib: number, vramMib?: number): Hardware => ({ ramBytes: gib * GiB, arch: 'x86_64', os: 'windows', gpu: vramMib ? { name: 'GPU Teste', vramMib } : null })
const id = (hw: Hardware) => { const r = pickModel(hw, catalog); return 'model' in r ? r.model.id : r.unavailable }

test('escolhe o modelo pela memória, com folga para o que o sistema reserva', () => {
  expect(id(mac(16))).toBe('qwen3-8b')
  expect(id(mac(15.8))).toBe('qwen3-8b')
  expect(id(mac(8))).toBe('qwen3-4b')
  expect(id(mac(7.8))).toBe('qwen3-4b')
  expect(id(pc(7.8))).toBe('qwen3-4b')
  expect(id(pc(8, 8192))).toBe('qwen3-8b')
})

test('Mac Intel e pouca memória ficam sem Assistente, com o motivo', () => {
  expect(id(mac(32, 'x86_64'))).toBe('O Assistente precisa de um Mac com chip Apple (M1 ou mais novo).')
  expect(id(pc(6))).toBe('O Assistente precisa de pelo menos 8 GB de memória.')
  expect(id(pc(6, 8192))).toBe('O Assistente precisa de pelo menos 8 GB de memória.')
})

test('o modelo mais leve é o próximo do catálogo', () => {
  expect(lighter(catalog[0], catalog)?.id).toBe('qwen3-4b')
  expect(lighter(catalog[1], catalog)).toBeNull()
})

test('descreve a máquina e o tamanho do modelo em GB', () => {
  expect(machineLabel(mac(16))).toBe('Mac com chip Apple · 16 GB')
  expect(machineLabel(pc(15.8, 8192))).toBe('PC com Windows · 16 GB · GPU Teste 8 GB')
  expect(gb(5027783488)).toBe('5,0 GB')
})

test('modelo em uso: o escolhido se está no disco; sem escolha, qualquer um do catálogo já baixado', () => {
  const [m8, m4] = catalog
  expect(installedModel(m4.id, [m8.file, m4.file])?.id).toBe('qwen3-4b')
  expect(installedModel(m4.id, [m8.file])).toBeNull() // escolheu outro e ainda não baixou
  expect(installedModel(null, [m4.file])?.id).toBe('qwen3-4b')
  expect(installedModel(null, ['outro.gguf'])).toBeNull()
})
