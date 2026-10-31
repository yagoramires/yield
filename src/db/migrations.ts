// Os mesmos arquivos que o plugin roda no `yield.db`; os bancos dos outros perfis são migrados no JS (`migrate`).
const files = import.meta.glob<string>('../../src-tauri/migrations/*.sql', { query: '?raw', import: 'default', eager: true })

export const MIGRATIONS: string[] = Object.keys(files).sort().map(name => files[name])
