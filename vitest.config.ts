import { defineConfig } from 'vitest/config'

// datas da Pluggy seguem o fuso da máquina; os testes fixam o de Brasília para dar o mesmo resultado em qualquer lugar
process.env.TZ = 'America/Sao_Paulo'

export default defineConfig({
  test: { environment: 'node', include: ['src/**/*.test.ts'], globals: true },
})
