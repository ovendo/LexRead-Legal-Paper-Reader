import type { ButtonHTMLAttributes, ReactNode } from "react";
import { Check, X } from "lucide-react";

export function cx(...values: Array<string | false | null | undefined>) {
  return values.filter(Boolean).join(" ");
}

export function Button({ variant = "primary", size = "md", className, children, ...props }: ButtonHTMLAttributes<HTMLButtonElement> & { variant?: "primary" | "secondary" | "ghost" | "danger"; size?: "sm" | "md" }) {
  return <button className={cx("button", `button-${variant}`, `button-${size}`, className)} {...props}>{children}</button>;
}

export function Panel({ title, action, children, className }: { title?: ReactNode; action?: ReactNode; children: ReactNode; className?: string }) {
  return <section className={cx("panel", className)}>
    {(title || action) && <header className="panel-header"><div className="panel-title">{title}</div>{action}</header>}
    {children}
  </section>;
}

export function Badge({ children, tone = "neutral" }: { children: ReactNode; tone?: "blue" | "green" | "amber" | "red" | "purple" | "neutral" }) {
  return <span className={cx("badge", `badge-${tone}`)}>{children}</span>;
}

export function Progress({ value, tone = "blue", label }: { value: number; tone?: "blue" | "teal" | "amber" | "purple"; label?: string }) {
  return <div className="progress-wrap">
    {label && <div className="progress-label"><span>{label}</span><strong>{value}%</strong></div>}
    <div className="progress-track"><span className={`progress-fill progress-${tone}`} style={{ width: `${Math.max(0, Math.min(value, 100))}%` }} /></div>
  </div>;
}

export function EmptyState({ icon, title, description, action }: { icon: ReactNode; title: string; description: string; action?: ReactNode }) {
  return <div className="empty-state"><div className="empty-icon">{icon}</div><h3>{title}</h3><p>{description}</p>{action}</div>;
}

export function Modal({ title, children, onClose }: { title: string; children: ReactNode; onClose: () => void }) {
  return <div className="modal-backdrop" role="presentation" onMouseDown={onClose}>
    <div className="modal" role="dialog" aria-modal="true" aria-label={title} onMouseDown={(event) => event.stopPropagation()}>
      <header><h2>{title}</h2><button className="icon-button" onClick={onClose} aria-label="关闭"><X size={18} /></button></header>
      {children}
    </div>
  </div>;
}

export function CheckBox({ checked, onChange, label }: { checked: boolean; onChange: () => void; label: string }) {
  return <button className="check-row" onClick={onChange}><span className={cx("checkbox", checked && "is-checked")}>{checked && <Check size={13} />}</span><span>{label}</span></button>;
}
