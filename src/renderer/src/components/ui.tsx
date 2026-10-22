import React from 'react';

// Shared presentation primitives. Deliberately free of hooks and icon imports:
// CopilotView and FloatingWindowView are bundled by the component contract test,
// which only provides useState/useRef/useEffect and the icons those files import.

export const cx = (...names: Array<string | false | null | undefined>) => names.filter(Boolean).join(' ');

const buttonBase = 'inline-flex items-center justify-center gap-1.5 whitespace-nowrap rounded-lg font-medium transition-colors disabled:opacity-40 disabled:pointer-events-none select-none';

export const button = {
  primary: cx(buttonBase, 'h-8 px-3.5 text-[13px] bg-accent text-white hover:bg-accent-hover active:brightness-95'),
  secondary: cx(buttonBase, 'h-8 px-3 text-[13px] bg-fill text-label hover:bg-fill-strong'),
  plain: cx(buttonBase, 'h-8 px-2.5 text-[13px] text-label-2 hover:bg-fill hover:text-label'),
  link: cx(buttonBase, 'h-7 px-1.5 text-[13px] text-accent-text hover:bg-accent-soft'),
  danger: cx(buttonBase, 'h-8 px-3 text-[13px] bg-danger-soft text-danger hover:brightness-110'),
  icon: cx(buttonBase, 'h-7 w-7 text-label-2 hover:bg-fill hover:text-label'),
  chip: cx(buttonBase, 'h-7 px-2.5 rounded-full text-[12px] bg-fill text-label-2 hover:bg-fill-strong hover:text-label')
};

export const field = 'w-full h-8 rounded-lg bg-fill px-2.5 text-[13px] text-label placeholder:text-label-3 outline-none border border-transparent focus:border-accent focus:bg-canvas transition-colors';
export const fieldBox = 'h-8 rounded-lg bg-fill px-2.5 text-[13px] text-label placeholder:text-label-3 outline-none border border-transparent focus:border-accent focus:bg-canvas transition-colors';
export const textArea = 'w-full rounded-lg bg-fill px-2.5 py-2 text-[13px] leading-relaxed text-label placeholder:text-label-3 outline-none border border-transparent focus:border-accent focus:bg-canvas transition-colors resize-none';
export const selectField = 'select-chevron h-7 rounded-md bg-fill pl-2 pr-6 text-[12px] text-label outline-none border border-transparent focus:border-accent appearance-none';

/** Window toolbar sitting in the hidden-inset titlebar region; it doubles as the drag handle. */
export function Toolbar({children, className}: {children?: React.ReactNode; className?: string}) {
  return <header className={cx('titlebar-drag h-[52px] shrink-0 flex items-center gap-2 px-4', className)}>{children}</header>;
}

export function PageHeader({title, subtitle, children}: {title: React.ReactNode; subtitle?: React.ReactNode; children?: React.ReactNode}) {
  return <div className="flex flex-wrap items-end justify-between gap-x-6 gap-y-4 pb-6">
    <div className="min-w-[280px] flex-1">
      <h1 className="text-[34px] leading-[1.1] font-bold tracking-[-0.035em] text-label">{title}</h1>
      {subtitle && <p className="mt-2 text-[14px] leading-relaxed text-label-2 max-w-[60ch]">{subtitle}</p>}
    </div>
    {children && <div className="flex items-center gap-2 shrink-0">{children}</div>}
  </div>;
}

/** System Settings style grouped list. */
export function Group({title, footer, children, className}: {title?: React.ReactNode; footer?: React.ReactNode; children: React.ReactNode; className?: string}) {
  return <section className={cx('space-y-1.5', className)}>
    {title && <h2 className="px-1 text-[13px] font-semibold text-label">{title}</h2>}
    <div className="rounded-2xl bg-surface shadow-card divide-y divide-separator overflow-hidden">{children}</div>
    {footer && <p className="px-1 text-[12px] leading-relaxed text-label-2">{footer}</p>}
  </section>;
}

export function Row({label, detail, children, className}: {label?: React.ReactNode; detail?: React.ReactNode; children?: React.ReactNode; className?: string}) {
  return <div className={cx('flex items-center gap-4 px-4 min-h-11 py-2', className)}>
    {(label || detail) && <div className="min-w-[180px] flex-1">
      {label && <div className="text-[13px] text-label">{label}</div>}
      {detail && <div className="text-[12px] leading-relaxed text-label-2 mt-0.5">{detail}</div>}
    </div>}
    {children}
  </div>;
}

export function Switch({checked, onChange, label, disabled}: {checked: boolean; onChange: (next: boolean) => void; label: string; disabled?: boolean}) {
  return <button type="button" role="switch" aria-checked={checked} aria-label={label} title={label} disabled={disabled}
    onClick={() => onChange(!checked)}
    className={cx('relative h-[22px] w-[38px] shrink-0 rounded-full transition-colors disabled:opacity-40', checked ? 'bg-accent' : 'bg-fill-strong')}>
    <span className={cx('absolute left-0 top-[2px] h-[18px] w-[18px] rounded-full bg-white shadow-[0_1px_3px_rgba(0,0,0,0.25)] transition-transform', checked ? 'translate-x-[18px]' : 'translate-x-[2px]')}/>
  </button>;
}

export function Segmented<T extends string>({value, options, onChange}: {value: T; options: Array<{id: T; label: React.ReactNode}>; onChange: (id: T) => void}) {
  return <div className="inline-flex rounded-lg bg-fill p-0.5" role="tablist">
    {options.map(option => <button key={option.id} role="tab" aria-selected={value === option.id} onClick={() => onChange(option.id)}
      className={cx('h-7 px-3 rounded-md text-[12px] font-medium transition-all', value === option.id ? 'bg-elevated text-label shadow-[0_1px_2px_rgba(0,0,0,0.12)]' : 'text-label-2 hover:text-label')}>
      {option.label}
    </button>)}
  </div>;
}

export function Badge({tone = 'neutral', children, title}: {tone?: 'neutral' | 'accent' | 'success' | 'warning' | 'danger'; children: React.ReactNode; title?: string}) {
  const tones = {
    neutral: 'bg-fill text-label-2',
    accent: 'bg-accent-soft text-accent-text',
    success: 'bg-success-soft text-success',
    warning: 'bg-warning-soft text-warning',
    danger: 'bg-danger-soft text-danger'
  };
  return <span title={title} className={cx('inline-flex items-center gap-1 h-5 px-1.5 rounded-md text-[11px] font-medium whitespace-nowrap', tones[tone])}>{children}</span>;
}

export function Notice({tone = 'neutral', children, action}: {tone?: 'neutral' | 'warning' | 'danger' | 'success'; children: React.ReactNode; action?: React.ReactNode}) {
  const tones = {neutral: 'bg-fill text-label-2', warning: 'bg-warning-soft text-warning', danger: 'bg-danger-soft text-danger', success: 'bg-success-soft text-success'};
  return <div role={tone === 'danger' ? 'alert' : undefined} className={cx('flex items-start gap-3 rounded-lg px-3 py-2 text-[12px] leading-relaxed', tones[tone])}>
    <div className="min-w-0 flex-1 break-words">{children}</div>
    {action && <div className="shrink-0 flex items-center gap-1">{action}</div>}
  </div>;
}

export function Kbd({children}: {children: React.ReactNode}) {
  return <kbd className="inline-flex items-center h-5 px-1.5 rounded-md bg-fill border border-separator font-sans text-[11px] text-label-2">{children}</kbd>;
}

export function EmptyState({icon, title, children}: {icon?: React.ReactNode; title: React.ReactNode; children?: React.ReactNode}) {
  return <div className="flex flex-col items-center justify-center text-center gap-2 py-16 px-8">
    {icon && <div className="mb-1 text-label-3">{icon}</div>}
    <div className="text-[15px] font-semibold text-label">{title}</div>
    {children && <div className="text-[13px] leading-relaxed text-label-2 max-w-[44ch]">{children}</div>}
  </div>;
}
