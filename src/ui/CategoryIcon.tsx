import {
  ArrowLeftRight, BriefcaseBusiness, Car, CircleHelp, CreditCard, Ellipsis, GraduationCap, HeartPulse, House, Landmark, Plane, Popcorn, ReceiptText,
  Repeat, ShoppingBag, ShoppingCart, Tag, TrendingUp, Utensils, type LucideIcon,
} from 'lucide-react'

// Categorias padrão (migração 003); as criadas pelo usuário usam a etiqueta.
const ICONS: Record<string, [LucideIcon, string]> = {
  alimentacao: [Utensils, '#ff9f5a'], mercado: [ShoppingCart, '#6fdc8c'], transporte: [Car, '#5fb3ff'], moradia: [House, '#e8b86d'],
  contas: [ReceiptText, '#7fd1d1'], saude: [HeartPulse, '#ff7a8a'], educacao: [GraduationCap, '#9aa8ff'], lazer: [Popcorn, '#ff8fd0'],
  compras: [ShoppingBag, '#f5d76e'], assinaturas: [Repeat, '#c79bff'], viagem: [Plane, '#5fd4ff'], 'impostos-e-taxas': [Landmark, '#d9a066'], outros: [Ellipsis, '#9a9da6'],
  receita: [BriefcaseBusiness, '#c6ff3d'], transferencia: [ArrowLeftRight, '#9a9da6'], 'pagamento-de-fatura': [CreditCard, '#9a9da6'], investimento: [TrendingUp, '#4fd1a5'],
  sem: [CircleHelp, '#ffcf5c'],
}
const OTHER: [LucideIcon, string] = [Tag, '#9a9da6']

/** Ícone da categoria num círculo com a cor dela; `bare` mostra só o traço colorido. `null` = sem categoria. */
export function CategoryIcon({ id, size = 32, bare }: { id: string | null; size?: number; bare?: boolean }) {
  const [Icon, color] = ICONS[id ?? 'sem'] ?? OTHER
  if (bare) return <Icon size={size} color={color} strokeWidth={1.9} aria-hidden />
  return (
    <span className="cat-ico" style={{ width: size, height: size, color, background: `${color}22` }} aria-hidden>
      <Icon size={Math.round(size / 2)} strokeWidth={1.9} />
    </span>
  )
}
