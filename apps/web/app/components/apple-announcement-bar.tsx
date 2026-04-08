"use client";

type AppleAnnouncementBarProps = {
  items: string[];
};

export function AppleAnnouncementBar({ items }: AppleAnnouncementBarProps) {
  const normalizedItems = items
    .map((item) => item.trim())
    .filter(Boolean)
    .slice(0, 3);

  if (normalizedItems.length === 0) {
    return null;
  }

  return (
    <section className="apple-announcement-bar" aria-label="Beneficios de compra">
      <div className="apple-announcement-bar-inner">
        <div className="apple-announcement-marquee">
          <div className="apple-announcement-marquee-track">
            {normalizedItems.map((item) => (
              <span key={item} className="apple-announcement-message">
                <span>{item}</span>
              </span>
            ))}
          </div>
        </div>
      </div>
    </section>
  );
}
