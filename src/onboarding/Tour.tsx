import { useEffect, useLayoutEffect, useRef, useState } from 'react'

/** Paradas do tour: o que existe na tela deste perfil (seletores que não acham nada, ou acham algo escondido, saem). */
export const STOPS = [
  { sel: '[data-tour="abas"]', title: 'Suas abas', text: 'As telas que você escolheu no setup. Dá para ligar e desligar outras em Configurações › Abas do menu.' },
  { sel: '.sidebar .prof-btn', title: 'Seu perfil', text: 'Troque de perfil, crie outro ou bloqueie o app por aqui. Cada perfil tem os próprios dados.' },
  { sel: '.sidebar .sync-status', title: 'Sincronização', text: 'Quando os bancos, a Binance e as cotações foram lidos pela última vez. O botão ao lado lê tudo agora.' },
  { sel: '.sidebar .logo-row [aria-pressed]', title: 'Ocultar valores', text: 'Esconde os valores da tela, para abrir o app perto de outras pessoas.' },
  { sel: '[data-tour="config"]', title: 'Configurações', text: 'Contas conectadas, importações, PIN, backup e tudo o que você escolheu no setup.' },
]

type Box = { left: number; top: number; right: number; bottom: number }

/** Retângulo que cobre todos os elementos visíveis; null se nenhum aparece (menu fechado no celular, módulo desligado). */
export function union(rects: Box[]): Box | null {
  const vis = rects.filter(r => r.right > r.left && r.bottom > r.top)
  if (!vis.length) return null
  return { left: Math.min(...vis.map(r => r.left)), top: Math.min(...vis.map(r => r.top)), right: Math.max(...vis.map(r => r.right)), bottom: Math.max(...vis.map(r => r.bottom)) }
}

/** Balão ao lado do destaque; sem espaço à direita, vai para baixo. Sempre dentro da janela. */
export function tipPosition(r: Box, tip: { w: number; h: number }, win: { w: number; h: number }, gap = 14, margin = 12): { left: number; top: number } {
  const clamp = (v: number, max: number) => Math.max(margin, Math.min(v, max - margin))
  if (r.right + gap + tip.w <= win.w - margin) return { left: r.right + gap, top: clamp(r.top, win.h - tip.h) }
  return { left: clamp(r.left, win.w - tip.w), top: clamp(r.bottom + gap, win.h - tip.h) }
}

const measure = (): (Box | null)[] => STOPS.map(s => union([...document.querySelectorAll(s.sel)].map(e => e.getBoundingClientRect())))

export function Tour({ onDone }: { onDone(): void }) {
  const [boxes, setBoxes] = useState<(Box | null)[] | null>(null)
  const [i, setI] = useState(0)
  const tip = useRef<HTMLDivElement>(null)
  const [pos, setPos] = useState<{ left: number; top: number } | null>(null)

  useLayoutEffect(() => {
    const m = () => setBoxes(measure())
    m()
    window.addEventListener('resize', m)
    return () => window.removeEventListener('resize', m)
  }, [])

  const stops = (boxes ?? []).flatMap((b, k) => (b ? [{ ...STOPS[k], box: b }] : []))
  const stop = stops[Math.min(i, stops.length - 1)]

  useEffect(() => { if (boxes && !stops.length) onDone() }, [boxes, stops.length, onDone])
  useLayoutEffect(() => {
    if (!stop || !tip.current) return
    setPos(tipPosition(stop.box, { w: tip.current.offsetWidth, h: tip.current.offsetHeight }, { w: window.innerWidth, h: window.innerHeight }))
    tip.current.querySelector<HTMLElement>('.b.pri')?.focus()
  }, [stop?.title, boxes]) // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => {
    const esc = (e: KeyboardEvent) => { if (e.key === 'Escape') { e.stopPropagation(); onDone() } }
    document.addEventListener('keydown', esc, true)
    return () => document.removeEventListener('keydown', esc, true)
  }, [onDone])

  if (!stop) return null
  const last = i >= stops.length - 1
  const pad = 4
  return (
    <div className="tour" aria-live="polite">
      <div className="tour-hl" style={{ left: stop.box.left - pad, top: stop.box.top - pad, width: stop.box.right - stop.box.left + pad * 2, height: stop.box.bottom - stop.box.top + pad * 2 }} />
      <div ref={tip} className="tour-tip" role="dialog" aria-modal="true" aria-labelledby="tour-t" style={pos ?? { visibility: 'hidden' }}>
        <div className="muted">{i + 1} de {stops.length}</div>
        <b id="tour-t">{stop.title}</b>
        <p>{stop.text}</p>
        <div className="row">
          <button className="b ghost sm" onClick={onDone}>Pular tour</button>
          <span style={{ flex: 1 }} />
          {i > 0 && <button className="b sm" onClick={() => setI(i - 1)}>Voltar</button>}
          <button className="b pri sm" onClick={() => (last ? onDone() : setI(i + 1))}>{last ? 'Concluir' : 'Próximo'}</button>
        </div>
      </div>
    </div>
  )
}
