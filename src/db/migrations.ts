// As migrações de todo banco de perfil (o `yield.db` também), rodadas pelo `migrate` no JS.
const files = import.meta.glob<string>('../../src-tauri/migrations/*.sql', { query: '?raw', import: 'default', eager: true })

export const MIGRATIONS: string[] = Object.keys(files).sort().map(name => files[name])
