import {
  Apple, ArrowLeftRight, Baby, BookOpen, BriefcaseBusiness, Bus, Car, Carrot, CircleHelp, Coffee, CreditCard, Dumbbell, Ellipsis, Film, Fuel,
  Gamepad2, Gift, GraduationCap, HeartPulse, House, Landmark, Music, Package, PawPrint, PiggyBank, Pill, Plane, Popcorn, ReceiptText, Repeat,
  Scissors, Shirt, ShoppingBag, ShoppingCart, Smartphone, Sparkles, Store, Tag, TrendingUp, Utensils, Wifi, Wine, Wrench, Zap, type LucideIcon,
} from 'lucide-react'
import type { Category } from '../db/gastosRepo'
import { ico, TINT } from './palette'

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
export const COLOR_CHOICES: string[] = Object.values(TINT)
// cores da paleta antiga, já salvas em categorias: desenhadas com a equivalente da paleta nova (sem migrar o banco)
const OLD: Record<string, string> = {
  '#ff9f5a': TINT.ambar, '#f5d76e': TINT.areia, '#6fdc8c': TINT.verde, '#4fd1a5': TINT.turquesa, '#7fd1d1': TINT.turquesa, '#5fb3ff': TINT.azul,
  '#9aa8ff': TINT.violeta, '#c79bff': TINT.violeta, '#ff8fd0': TINT.rosa, '#ff7a8a': TINT.coral, '#9a9da6': TINT.cinza,
  '#e8b86d': TINT.areia, '#5fd4ff': TINT.azul, '#d9a066': TINT.ambar, // padrões antigos de moradia, viagem e impostos
}

// Categorias padrão (migração 002); as criadas pelo usuário, sem escolha, usam a etiqueta.
const DEFAULTS: Record<string, [string, string]> = {
  alimentacao: ['utensils', TINT.ambar], mercado: ['shopping-cart', TINT.verde], transporte: ['car', TINT.azul], moradia: ['house', TINT.areia],
  contas: ['receipt-text', TINT.turquesa], saude: ['heart-pulse', TINT.coral], educacao: ['graduation-cap', TINT.violeta], lazer: ['popcorn', TINT.rosa],
  compras: ['shopping-bag', TINT.areia], assinaturas: ['repeat', TINT.violeta], viagem: ['plane', TINT.azul], 'impostos-e-taxas': ['landmark', TINT.ambar],
  outros: ['ellipsis', TINT.cinza], receita: ['briefcase-business', '#c6ff3d' /* o verde da marca: entrada de dinheiro */], transferencia: ['arrow-left-right', TINT.cinza],
  'pagamento-de-fatura': ['credit-card', TINT.cinza], investimento: ['trending-up', TINT.turquesa],
}

type Look = Pick<Category, 'id' | 'icon' | 'color'>

/** Ícone e cor de uma categoria: a escolha salva, senão o padrão do id, senão etiqueta cinza. `null` = sem categoria. */
export function categoryLook(c: Look | null): { icon: string; color: string } {
  if (!c) return { icon: 'circle-help', color: '#fbc959' /* --warn: sem categoria pede atenção */ }
  const [icon, color] = DEFAULTS[c.id] ?? ['tag', TINT.cinza]
  return { icon: c.icon && ICONS[c.icon] ? c.icon : icon, color: c.color ? OLD[c.color.toLowerCase()] ?? c.color : color }
}

/** Ícone da categoria num círculo com a cor dela; `bare` mostra só o traço colorido. */
export function CategoryIcon({ category, size = 32, bare }: { category: Look | null; size?: number; bare?: boolean }) {
  const { icon, color } = categoryLook(category)
  return <IconGlyph name={icon} color={color} size={size} bare={bare} />
}

/** Mesmo desenho a partir do nome e da cor (prévia no painel de edição). */
export function IconGlyph({ name, color, size = 32, bare }: { name: string; color: string; size?: number; bare?: boolean }) {
  const Icon = ICONS[name] ?? Tag
  if (bare) return <Icon size={size} className="ico-bare" style={ico(color)} strokeWidth={1.9} aria-hidden />
  return (
    <span className="cat-ico" style={{ width: size, height: size, ...ico(color) }} aria-hidden>
      <Icon size={Math.round(size / 2)} strokeWidth={1.9} />
    </span>
  )
}
