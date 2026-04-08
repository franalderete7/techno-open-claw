"use client";

type AppleStorefrontFooterProps = {
  sections: Array<{
    title: string;
    body: string;
  }>;
};

export function AppleStorefrontFooter({ sections }: AppleStorefrontFooterProps) {
  return (
    <footer className="apple-storefront-footer">
      {sections.map((section) => (
        <details key={section.title} className="apple-storefront-footer-item">
          <summary className="apple-storefront-footer-title">{section.title}</summary>
          <p className="apple-storefront-footer-copy">{section.body}</p>
        </details>
      ))}
    </footer>
  );
}
