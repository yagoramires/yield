import { invoke } from '@tauri-apps/api/core'
import { Lock } from 'lucide-react'
import { useEffect, useState } from 'react'
import { openDb } from '../../db/client'
import { useProfiles } from '../../profiles/Gate'
import { PinPad } from '../../profiles/PinPad'
import { pinEntered, pinTitle, startPin, unlock, unlockMessage, type PinMode, type PinStep, type Unlock } from '../../profiles/pin'
import type { Profile } from '../../profiles/profiles'
import { BackupExport } from './BackupExport'

const errText = (e: unknown) => (e instanceof Error ? e.message : String(e))

/** Teclado que confere o PIN atual no Rust (conta no limite de tentativas); `onOk` só depois de acertar. */
export function CurrentPin({ profile, title = 'Digite o PIN atual', onOk, onCancel }: { profile: Profile; title?: string; onOk(pin: string): void; onCancel(): void }) {
  const [msg, setMsg] = useState<string | null>(null)
  const [until, setUntil] = useState<number | null>(null)
  const check = async (pin: string) => {
    try {
      const r = await unlock(profile, pin)
      if (r.kind === 'ok') return onOk(pin)
      setMsg(unlockMessage(r)); setUntil(r.kind === 'locked' ? r.until : null)
    } catch (e) { setMsg(errText(e)) }
  }
  return <PinPad title={title} until={until} message={msg} onComplete={check} onBack={onCancel} />
}

/** Ligar, trocar e tirar o PIN do perfil aberto. O Rust troca o arquivo do banco e reabre o pool: o app segue sem recarregar. */
export function PinConfig() {
  const { profile, profiles, hasPin, setHasPin } = useProfiles()
  const [supported, setSupported] = useState<boolean | null>(null)
  const [step, setStep] = useState<PinStep | null>(null)
  const [msg, setMsg] = useState<string | null>(null)
  const [until, setUntil] = useState<number | null>(null)
  const [busy, setBusy] = useState<string | null>(null)
  const [done, setDone] = useState<string | null>(null)
  const [backup, setBackup] = useState(false)
  const [backupMsg, setBackupMsg] = useState<string | null>(null)
  const [exporting, setExporting] = useState(false)

  useEffect(() => { invoke<boolean>('pin_supported').then(setSupported, () => setSupported(false)) }, [])

  const start = (mode: PinMode) => { setStep(startPin(mode)); setMsg(null); setUntil(null); setDone(null); setBackup(false); setBackupMsg(null) }
  const close = () => { setStep(null); setMsg(null); setUntil(null) }

  const run = async (mode: PinMode, current: string, next: string) => {
    setBusy(mode === 'remove' ? 'Tirando a criptografia dos dados…' : 'Criptografando os dados…')
    const args = { id: profile.id, dbFile: profile.dbFile }
    try {
      const r: Unlock | null = mode === 'set' ? (await invoke('profile_set_pin', { ...args, pin: next }), null)
        : mode === 'change' ? await invoke<Unlock>('profile_change_pin', { ...args, current, next })
          : await invoke<Unlock>('profile_remove_pin', { ...args, current })
      if (r && r.kind !== 'ok') {
        // PIN atual errado no último passo: volta a pedi-lo, com a contagem e a espera do Rust
        setStep(startPin(mode)); setMsg(unlockMessage(r)); setUntil(r.kind === 'locked' ? r.until : null)
      } else {
        setHasPin(mode !== 'remove'); close()
        setDone(mode === 'set' ? 'PIN ligado.' : mode === 'change' ? 'PIN trocado.' : 'PIN desligado.')
      }
    } catch (e) { setStep(startPin(mode)); setMsg(`Não foi possível: ${errText(e)}`) }
    // o Rust reabre o pool depois da troca; se a reabertura falhou, tenta de novo daqui para o app seguir lendo o banco
    await openDb(profile.dbFile).catch(() => {})
    setBusy(null)
  }

  const entered = async (pin: string) => {
    if (!step) return
    // trocar: confere o PIN atual antes de pedir o novo, para o erro não aparecer só no fim
    if (step.mode === 'change' && step.stage === 'current') {
      const r = await unlock(profile, pin).catch(e => { setMsg(errText(e)); return null })
      if (!r) return
      if (r.kind !== 'ok') { setMsg(unlockMessage(r)); setUntil(r.kind === 'locked' ? r.until : null); return }
    }
    const r = pinEntered(step, pin)
    if ('run' in r) return run(step.mode, r.run.current, r.run.next)
    setStep(r.next); setMsg(r.message); setUntil(null)
  }

  if (supported === null) return null
  return (
    <div style={{ marginTop: 16, paddingTop: 14, borderTop: '1px solid var(--line)' }}>
      <b style={{ color: 'var(--strong)' }}>PIN</b>
      {!supported ? (
        <div className="muted" style={{ marginTop: 4 }}>PIN indisponível nesta instalação: o Yield não encontrou a criptografia do banco (SQLCipher).</div>
      ) : <>
        <div className="muted" style={{ margin: '4px 0 10px' }}>
          {hasPin ? <><Lock size={12} aria-hidden /> Ligado: os dados deste perfil só abrem com o PIN.</> : 'Desligado. Com PIN, os dados deste perfil ficam criptografados e só abrem com ele.'}
          {profiles.length > 1 && ' O PIN é pedido ao abrir o app e ao trocar para este perfil.'}
        </div>
        {!step && !busy && (
          <div className="btns">
            {hasPin
              ? <><button className="b" onClick={() => start('change')}>Trocar PIN…</button><button className="b ghost" onClick={() => start('remove')}>Tirar PIN…</button></>
              : <button className="b" onClick={() => start('set')}>Ligar PIN…</button>}
          </div>
        )}
        {done && <div className="info" style={{ marginTop: 10 }}>{done}</div>}
        {step && (
          <div className="pin-panel">
            {step.mode === 'set' && !busy && <>
              <div className="note">Se esquecer o PIN, os dados deste perfil não têm como voltar: nem o Yield consegue abrir. A única saída é restaurar um backup.</div>
              <div className="muted" style={{ marginTop: 8 }}>4 dígitos protegem de quem usa este computador, não de quem copia o arquivo e testa as 10 mil combinações por fora.</div>
              {!backup && <button className="b" style={{ marginTop: 10 }} onClick={() => setBackup(true)}>Fazer backup agora</button>}
              {backup && !backupMsg && <BackupExport onBusy={setExporting} onDone={m => setBackupMsg(m)} onCancel={() => setBackup(false)} />}
              {backupMsg && <div className="info" style={{ marginTop: 10 }}>{backupMsg}</div>}
            </>}
            {busy ? <div className="muted" role="status" style={{ marginTop: 12 }}>{busy}</div>
              : !exporting && <div style={{ marginTop: 16 }}><PinPad key={`${step.stage}-${step.first}`} title={pinTitle(step)} until={until} message={msg} onComplete={entered} onBack={close} /></div>}
          </div>
        )}
      </>}
    </div>
  )
}
