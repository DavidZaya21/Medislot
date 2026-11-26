"use client";

import Link from "next/link";
import { useId, useRef, useState, useEffect } from "react";
import { usePathname } from "next/navigation";

type Item = { label: string; href?: string; action?: () => void };

export function NavigationMenu({ label, items }: { label: string; items: Item[] }) {
  const [open, setOpen] = useState(false);
  const root = useRef<HTMLDivElement>(null);
  const trigger = useRef<HTMLButtonElement>(null);
  const id = useId();
  const pathname = usePathname();
  const active = items.some(item => item.href === pathname);
  useEffect(() => { setOpen(false); }, [pathname]);
  useEffect(() => {
    if (!open) return;
    function outside(event: PointerEvent) {
      if (!root.current?.contains(event.target as Node)) setOpen(false);
    }
    // WebKit can blur a link to no target on pointer-down, before its click.
    // Dismiss on actual outside focus instead of unmounting that clicked link.
    function outsideFocus(event: FocusEvent) {
      if (!root.current?.contains(event.target as Node)) setOpen(false);
    }
    document.addEventListener("pointerdown", outside);
    document.addEventListener("focusin", outsideFocus);
    return () => {
      document.removeEventListener("pointerdown", outside);
      document.removeEventListener("focusin", outsideFocus);
    };
  }, [open]);
  function focusItem(index: number) {
    const nodes = root.current?.querySelectorAll<HTMLElement>('[role="menuitem"]');
    if (nodes?.length) nodes[(index + nodes.length) % nodes.length].focus();
  }
  return <div className="navigation-menu" ref={root} onKeyDown={event => {
    if (event.key === "Escape" && open) { event.preventDefault(); setOpen(false); trigger.current?.focus(); }
  }}>
    <button type="button" ref={trigger} className={`nav-link navigation-menu-trigger${active ? " active" : ""}`}
      aria-haspopup="menu" aria-expanded={open} aria-controls={id}
      onClick={() => { setOpen(!open); if (!open) requestAnimationFrame(() => focusItem(0)); }} onKeyDown={event => {
        if (event.key === "ArrowDown" || event.key === "ArrowUp") {
          event.preventDefault(); setOpen(true);
          const last = event.key === "ArrowUp";
          requestAnimationFrame(() => focusItem(last ? items.length - 1 : 0));
        }
      }}>{label} <span aria-hidden="true">▾</span></button>
    {open ? <div id={id} role="menu" aria-label={label} className="navigation-menu-panel" onKeyDown={event => {
      const nodes = Array.from(event.currentTarget.querySelectorAll<HTMLElement>('[role="menuitem"]'));
      const index = nodes.indexOf(document.activeElement as HTMLElement);
      const next = event.key === "ArrowDown" ? index + 1 : event.key === "ArrowUp" ? index - 1 : event.key === "Home" ? 0 : event.key === "End" ? items.length - 1 : null;
      if (next !== null) { event.preventDefault(); focusItem(next); }
    }}>
      {items.map(item => item.href ? <Link key={item.label} role="menuitem" href={item.href}
        aria-current={pathname === item.href ? "page" : undefined}
        className={`nav-link${pathname === item.href ? " active" : ""}`} onClick={() => setOpen(false)}>{item.label}</Link>
        : <button key={item.label} type="button" role="menuitem" className="nav-link" onClick={() => { setOpen(false); item.action?.(); }}>{item.label}</button>)}
    </div> : null}
  </div>;
}
