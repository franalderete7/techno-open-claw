"use client";

type AppleAnnouncementBarProps = {
  items: string[];
};

export function AppleAnnouncementBar({ items }: AppleAnnouncementBarProps) {
  const normalizedItems = items.map((item) => item.trim()).filter(Boolean);

  if (normalizedItems.length === 0) {
    return null;
  }

  const marqueeItems = [...normalizedItems, ...normalizedItems];

  return (
    <section className="apple-announcement-bar" aria-label="Beneficios de compra">
      <div className="apple-announcement-bar-inner">
        <div className="apple-announcement-marquee">
          <div className="apple-announcement-marquee-track">
            {marqueeItems.map((item, index) => (
              <span key={`${item}-${index}`} className="apple-announcement-message">
                <span>{item}</span>
                <i className="apple-announcement-separator" aria-hidden="true" />
              </span>
            ))}
          </div>
        </div>
      </div>
    </section>
  );
}
