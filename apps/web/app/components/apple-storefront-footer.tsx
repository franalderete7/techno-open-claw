import type { ReactNode } from "react";

type AppleStorefrontFooterProps = {
  sections: Array<{
    title: string;
    body: string;
  }>;
  preface?: ReactNode;
};

export function AppleStorefrontFooter({ sections, preface }: AppleStorefrontFooterProps) {
  return (
    <footer className="apple-storefront-footer" aria-label="Información de compra">
      {preface ? <div className="apple-storefront-footer-preface">{preface}</div> : null}

      <div className="apple-storefront-footer-lead">
        <span className="apple-info-kicker">Compra clara</span>
        <h2 className="apple-storefront-footer-heading">Todo lo importante, visible antes de avanzar.</h2>
        <p className="apple-storefront-footer-intro">
          Envío, retiro, pago y atención real en una sección fija, simple y prolija.
        </p>
      </div>

      <div className="apple-storefront-footer-grid">
        {sections.map((section, index) => (
          <article key={section.title} className="apple-storefront-footer-card">
            <span className="apple-storefront-footer-index">{String(index + 1).padStart(2, "0")}</span>
            <h3 className="apple-storefront-footer-title">{section.title}</h3>
            <p className="apple-storefront-footer-copy">{section.body}</p>
          </article>
        ))}
      </div>
    </footer>
  );
}
