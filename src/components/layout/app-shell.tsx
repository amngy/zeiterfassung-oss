"use client";

import * as React from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { Menu, X, LogOut } from "lucide-react";
import { Logo } from "@/components/brand/logo";
import { navForRole, type RoleKey } from "@/components/layout/nav-config";
import { cn } from "@/lib/cn";

interface AppShellProps {
  user: { name: string; role: string };
  roleKey: RoleKey;
  /** Override the active nav item; defaults to the current pathname. */
  activeHref?: string;
  /** Optional badge counts keyed by nav href (e.g. open requests). */
  badges?: Record<string, number>;
  /** Server action that signs the user out. Omitted → disabled button. */
  signOutAction?: () => Promise<void>;
  children: React.ReactNode;
}

/**
 * Authenticated application shell: teal header, white sidebar with a lime
 * active state, responsive mobile drawer. Receives only serializable props;
 * the nav (with its icons) lives entirely in the client bundle.
 */
export function AppShell({
  user,
  roleKey,
  activeHref,
  badges,
  signOutAction,
  children,
}: AppShellProps) {
  const [open, setOpen] = React.useState(false);
  const pathname = usePathname();
  const current = activeHref ?? pathname;
  const nav = navForRole(roleKey);

  return (
    <div className="flex min-h-dvh flex-col">
      <header className="sticky top-0 z-30 flex h-14 items-center justify-between gap-3 bg-teal px-4 text-white shadow-sm">
        <div className="flex items-center gap-3">
          <button
            type="button"
            onClick={() => setOpen((v) => !v)}
            className="rounded-lg p-1.5 text-white/90 hover:bg-white/10 lg:hidden"
            aria-label="Menü öffnen"
            aria-expanded={open}
          >
            {open ? <X className="h-5 w-5" /> : <Menu className="h-5 w-5" />}
          </button>
          <Logo variant="dark" showSubtitle={false} />
        </div>

        <div className="flex items-center gap-3">
          <div className="hidden text-right sm:block">
            <p className="text-sm font-medium leading-tight">{user.name}</p>
            <p className="text-[11px] leading-tight text-white/70">{user.role}</p>
          </div>
          <span className="flex h-9 w-9 items-center justify-center rounded-full bg-white/15 text-sm font-semibold">
            {initials(user.name)}
          </span>
        </div>
      </header>

      <div className="flex flex-1">
        {open && (
          <div
            className="fixed inset-0 z-20 bg-ink/30 lg:hidden"
            onClick={() => setOpen(false)}
            aria-hidden
          />
        )}
        <aside
          className={cn(
            "fixed inset-y-0 left-0 z-20 w-64 border-r border-black/[0.06] bg-white pt-14 transition-transform lg:static lg:translate-x-0 lg:pt-0",
            open ? "translate-x-0" : "-translate-x-full",
          )}
        >
          <nav className="flex h-full flex-col gap-1 p-3">
            {nav.map((item) => {
              const active =
                current === item.href ||
                current.startsWith(item.href + "/");
              const Icon = item.icon;
              const badge = badges?.[item.href];
              return (
                <Link
                  key={item.href}
                  href={item.href}
                  onClick={() => setOpen(false)}
                  aria-current={active ? "page" : undefined}
                  className={cn(
                    "flex items-center gap-3 rounded-xl px-3 py-2 text-sm font-medium transition-colors",
                    active
                      ? "bg-lime text-white shadow-sm"
                      : "text-ink hover:bg-surface",
                  )}
                >
                  <Icon className="h-[18px] w-[18px] shrink-0" />
                  <span className="flex-1">{item.label}</span>
                  {badge ? (
                    <span
                      className={cn(
                        "rounded-full px-1.5 py-0.5 text-[11px] font-semibold",
                        active
                          ? "bg-white/25 text-white"
                          : "bg-danger/10 text-danger",
                      )}
                    >
                      {badge}
                    </span>
                  ) : null}
                </Link>
              );
            })}

            <div className="mt-auto border-t border-black/[0.06] pt-3">
              {signOutAction ? (
                <form action={signOutAction}>
                  <button
                    type="submit"
                    className="flex w-full items-center gap-3 rounded-xl px-3 py-2 text-sm font-medium text-muted transition-colors hover:bg-surface hover:text-ink"
                  >
                    <LogOut className="h-[18px] w-[18px]" />
                    Abmelden
                  </button>
                </form>
              ) : (
                <button
                  type="button"
                  disabled
                  className="flex w-full items-center gap-3 rounded-xl px-3 py-2 text-sm font-medium text-muted/60"
                >
                  <LogOut className="h-[18px] w-[18px]" />
                  Abmelden
                </button>
              )}
            </div>
          </nav>
        </aside>

        <main className="min-w-0 flex-1 bg-white px-4 py-6 sm:px-6 lg:px-8">
          <div className="mx-auto max-w-6xl">{children}</div>
        </main>
      </div>
    </div>
  );
}

function initials(name: string): string {
  return name
    .split(" ")
    .map((p) => p[0])
    .filter(Boolean)
    .slice(0, 2)
    .join("")
    .toUpperCase();
}
