import {
  Apple, ArrowLeftRight, Baby, BookOpen, BriefcaseBusiness, Bus, Car, Carrot, CircleHelp, Coffee, CreditCard, Dumbbell, Ellipsis, Film, Fuel,
  Gamepad2, Gift, GraduationCap, HeartPulse, House, Landmark, Music, Package, PawPrint, PiggyBank, Pill, Plane, Popcorn, ReceiptText, Repeat,
  Scissors, Shirt, ShoppingBag, ShoppingCart, Smartphone, Sparkles, Store, Tag, TrendingUp, Utensils, Wifi, Wine, Wrench, Zap, type LucideIcon,
} from 'lucide-react'
import type { Category } from '../db/gastosRepo'

// Nome salvo no banco (kebab-case do Lucide) → componente. Mapa fixo para o bundle levar só estes.
const ICONS: Record<string, LucideIcon> = {
  utensils: Utensils, 'shopping-cart': ShoppingCart, car: Car, house: House, 'receipt-text': ReceiptText, 'heart-pulse': HeartPulse,
  'graduation-cap': GraduationCap, popcorn: Popcorn, 'shopping-bag': ShoppingBag, repeat: Repeat, plane: Plane, landmark: Landmark,
  ellipsis: Ellipsis, 'briefcase-business': BriefcaseBusiness, 'arrow-left-right': ArrowLeftRight, 'credit-card': CreditCard,
  'trending-up': TrendingUp, 'paw-print': PawPrint, gift: Gift, baby: Baby, dumbbell: Dumbbell, 'gamepad-2': Gamepad2, shirt: Shirt,
  wrench: Wrench, music: Music, 'book-open': BookOpen, coffee: Coffee, store: Store, apple: Apple, carrot: Carrot, wine: Wine,
  package: Package, sparkles: Sparkles, fuel: Fuel, bus: Bus, smartphone: Smartphone, wifi: Wifi, zap: Zap, film: Film, scissors: Scissors,
  pill: Pill, 'piggy-bank': PiggyBank, tag: Tag, 'circle-help': CircleHelp,
}
export const ICON_CHOICES = Object.keys(ICONS).filter(n => n !== 'circle-help')
export const COLOR_CHOICES = ['#ff9f5a', '#f5d76e', '#6fdc8c', '#4fd1a5', '#7fd1d1', '#5fb3ff', '#9aa8ff', '#c79bff', '#ff8fd0', '#ff7a8a', '#9a9da6']

// Categorias padrão (migração 002); as criadas pelo usuário, sem escolha, usam a etiqueta.
const DEFAULTS: Record<string, [string, string]> = {
  alimentacao: ['utensils', '#ff9f5a'], mercado: ['shopping-cart', '#6fdc8c'], transporte: ['car', '#5fb3ff'], moradia: ['house', '#e8b86d'],
  contas: ['receipt-text', '#7fd1d1'], saude: ['heart-pulse', '#ff7a8a'], educacao: ['graduation-cap', '#9aa8ff'], lazer: ['popcorn', '#ff8fd0'],
  compras: ['shopping-bag', '#f5d76e'], assinaturas: ['repeat', '#c79bff'], viagem: ['plane', '#5fd4ff'], 'impostos-e-taxas': ['landmark', '#d9a066'],
  outros: ['ellipsis', '#9a9da6'], receita: ['briefcase-business', '#c6ff3d'], transferencia: ['arrow-left-right', '#9a9da6'],
  'pagamento-de-fatura': ['credit-card', '#9a9da6'], investimento: ['trending-up', '#4fd1a5'],
}

type Look = Pick<Category, 'id' | 'icon' | 'color'>

/** Ícone e cor de uma categoria: a escolha salva, senão o padrão do id, senão etiqueta cinza. `null` = sem categoria. */
export function categoryLook(c: Look | null): { icon: string; color: string } {
  if (!c) return { icon: 'circle-help', color: '#ffcf5c' }
  const [icon, color] = DEFAULTS[c.id] ?? ['tag', '#9a9da6']
  return { icon: c.icon && ICONS[c.icon] ? c.icon : icon, color: c.color ?? color }
}

/** Ícone da categoria num círculo com a cor dela; `bare` mostra só o traço colorido. */
export function CategoryIcon({ category, size = 32, bare }: { category: Look | null; size?: number; bare?: boolean }) {
  const { icon, color } = categoryLook(category)
  return <IconGlyph name={icon} color={color} size={size} bare={bare} />
}

/** Mesmo desenho a partir do nome e da cor (prévia no painel de edição). */
export function IconGlyph({ name, color, size = 32, bare }: { name: string; color: string; size?: number; bare?: boolean }) {
  const Icon = ICONS[name] ?? Tag
  if (bare) return <Icon size={size} color={color} strokeWidth={1.9} aria-hidden />
  return (
    <span className="cat-ico" style={{ width: size, height: size, color, background: `${color}22` }} aria-hidden>
      <Icon size={Math.round(size / 2)} strokeWidth={1.9} />
    </span>
  )
}
