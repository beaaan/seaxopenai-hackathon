import { useEffect, useState, type ReactNode } from "react";
import { FilePlus2, LayoutList, Menu, X } from "lucide-react";
import { cx } from "./ui";

export interface NavItem {
  href: string;
  label: string;
  icon: ReactNode;
  current: boolean;
  count?: number;
}

/** The product's mark: three streamlines bending around one block of text. */
export function Mark(): ReactNode {
  return (
    <svg viewBox="0 0 24 24" fill="none" aria-hidden>
      <rect x="9" y="9.5" width="6" height="5" rx="1" fill="var(--accent)" />
      <path d="M2 5.5h20" stroke="var(--accent)" strokeWidth="1.6" strokeLinecap="round" />
      <path d="M2 12h3.5c1.6 0 1.8-4.2 3.6-4.2h5.8c1.8 0 2 4.2 3.6 4.2H22" stroke="var(--text)" strokeWidth="1.6" strokeLinecap="round" />
      <path d="M2 18.5h20" stroke="var(--accent)" strokeWidth="1.6" strokeLinecap="round" />
    </svg>
  );
}

export function Shell(props: {
  runNav: { label: string; items: NavItem[] } | null;
  home: boolean;
  newPolicy: boolean;
  crumb: ReactNode;
  topRight?: ReactNode;
  footer?: ReactNode;
  children: ReactNode;
}): ReactNode {
  const [open, setOpen] = useState(false);
  useEffect(() => {
    const close = (): void => setOpen(false);
    window.addEventListener("hashchange", close);
    return () => window.removeEventListener("hashchange", close);
  }, []);
  return (
    <div className="app">
      <div className={cx("scrim", open && "open")} onClick={() => setOpen(false)} />
      <nav className={cx("sidebar", open && "open")} aria-label="Main">
        <div className="brand">
          <Mark />
          <span>Policy Wind Tunnel</span>
          <button className="btn ghost menu-toggle" style={{ marginLeft: "auto", padding: "0 6px" }} onClick={() => setOpen(false)} aria-label="Close menu"><X /></button>
        </div>
        {props.runNav && (
          <>
            <div className="group-label">{props.runNav.label}</div>
            {props.runNav.items.map((item) => (
              <a key={item.href} href={item.href} className="nav-item" aria-current={item.current ? "page" : undefined}>
                {item.icon}
                <span>{item.label}</span>
                {item.count !== undefined && <span className="count">{item.count}</span>}
              </a>
            ))}
          </>
        )}
        <div className="group-label">Workspace</div>
        <a href="#/" className="nav-item" aria-current={props.home ? "page" : undefined}><LayoutList /><span>Policies tested</span></a>
        <a href="#/new" className="nav-item" aria-current={props.newPolicy ? "page" : undefined}><FilePlus2 /><span>Test a policy</span></a>
        {props.footer && <div className="bottom">{props.footer}</div>}
      </nav>
      <header className="topbar">
        <button className="btn ghost menu-toggle" style={{ padding: "0 8px" }} onClick={() => setOpen(true)} aria-label="Open menu"><Menu /></button>
        <div className="crumb">{props.crumb}</div>
        <span className="spacer" />
        {props.topRight}
      </header>
      <main className="sheet">{props.children}</main>
    </div>
  );
}
