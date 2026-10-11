import {
  LayoutDashboard,
  Clock3,
  CalendarDays,
  CalendarCheck,
  CalendarPlus,
  Users,
  FileText,
  Settings,
  ShieldCheck,
  ClipboardList,
  ClipboardCheck,
  ScrollText,
  Archive,
  UserCircle,
  QrCode,
  type LucideIcon,
} from "lucide-react";

export type RoleKey = "EMPLOYEE" | "ADMIN";

export interface NavItem {
  href: string;
  label: string;
  icon: LucideIcon;
}

/** Navigation every signed-in user sees (their own data). */
export const EMPLOYEE_NAV: NavItem[] = [
  { href: "/dashboard", label: "Übersicht", icon: LayoutDashboard },
  { href: "/zeiten", label: "Meine Zeiten", icon: Clock3 },
  { href: "/abwesenheit", label: "Urlaub & Abwesenheit", icon: CalendarDays },
  { href: "/konto", label: "Mein Konto", icon: UserCircle },
];

/** Admin-only sections, appended after the personal section. */
export const ADMIN_NAV: NavItem[] = [
  { href: "/admin/mitarbeitende", label: "Mitarbeitende", icon: Users },
  { href: "/admin/zeiten", label: "Alle Zeiten", icon: ClipboardList },
  { href: "/admin/nachtragen", label: "Zeiten nachtragen", icon: CalendarPlus },
  { href: "/admin/korrekturen", label: "Korrekturen", icon: ClipboardCheck },
  { href: "/admin/abwesenheiten", label: "Abwesenheiten", icon: CalendarCheck },
  { href: "/admin/terminals", label: "Terminals", icon: QrCode },
  { href: "/admin/feiertage", label: "Feiertage", icon: ShieldCheck },
  { href: "/admin/protokoll", label: "Protokoll", icon: ScrollText },
  { href: "/admin/aufbewahrung", label: "Aufbewahrung", icon: Archive },
  { href: "/admin/auswertung", label: "Auswertungen", icon: FileText },
  { href: "/admin/einstellungen", label: "Einstellungen", icon: Settings },
];

export function navForRole(role: RoleKey): NavItem[] {
  return role === "ADMIN" ? [...EMPLOYEE_NAV, ...ADMIN_NAV] : EMPLOYEE_NAV;
}
