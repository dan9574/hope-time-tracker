import type { ReactNode } from "react";
import "./Page.css";

interface PageProps {
  title: string;
  subtitle: string;
  /** Controls aligned to the right of the title, e.g. period navigation. */
  accessory?: ReactNode;
  children?: ReactNode;
}

export function Page({ title, subtitle, accessory, children }: PageProps) {
  return (
    <article className="page">
      <header className="page-header">
        <div>
          <h1 className="page-title">{title}</h1>
          <p className="page-subtitle">{subtitle}</p>
        </div>
        {accessory && <div className="page-accessory">{accessory}</div>}
      </header>
      {children}
    </article>
  );
}
