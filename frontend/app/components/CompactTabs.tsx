"use client";

export const compactTabId = (prefix: string, value: string) => `${prefix}-${value.toLowerCase().replaceAll(" ", "-")}`;

export function CompactTabs<T extends string>({ options, value, onChange, label, idPrefix, panelId, disabled = false }: {
  options: readonly T[]; value: T; onChange: (value: T) => void;
  label: string; idPrefix: string; panelId: string; disabled?: boolean;
}) {
  return <div className="appointment-tabs" role="tablist" aria-label={label}>
    {options.map((item, index) => <button key={item} className="appointment-tab" type="button" role="tab" disabled={disabled}
      id={compactTabId(idPrefix, item)} aria-controls={panelId} aria-selected={value === item}
      tabIndex={value === item ? 0 : -1} onClick={() => onChange(item)} onKeyDown={(event) => {
        if (disabled) return;
        const next = event.key === "ArrowRight" ? (index + 1) % options.length
          : event.key === "ArrowLeft" ? (index + options.length - 1) % options.length
          : event.key === "Home" ? 0 : event.key === "End" ? options.length - 1 : undefined;
        if (next === undefined) return;
        event.preventDefault();
        document.getElementById(compactTabId(idPrefix, options[next]))?.focus();
        onChange(options[next]);
      }}>{item}</button>)}
  </div>;
}
