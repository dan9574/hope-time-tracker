import type { ReactNode } from "react";
import "./Page.css";

interface PageProps {
  title: string;
  subtitle: string;
  children?: ReactNode;
}

export function Page({ title, subtitle, children }: PageProps) {
  return (
    <article className="page">
      <header className="page-header">
        <h1 className="page-title">{title}</h1>
        <p className="page-subtitle">{subtitle}</p>
      </header>
      {children}
    </article>
  );
}
