"use client";

type AppleAnnouncementBarProps = {
  items: string[];
};

export function AppleAnnouncementBar({ items }: AppleAnnouncementBarProps) {
  const normalizedItems = items
    .map((item) => item.trim())
    .filter(Boolean)
    .slice(0, 3);
  const repeatedGroups = Array.from({ length: 2 }, (_, index) => index);

  if (normalizedItems.length === 0) {
    return null;
  }

  return (
    <section className="apple-announcement-bar" aria-label="Beneficios de compra">
      <div className="apple-announcement-bar-inner">
        <div className="apple-announcement-marquee">
          <div className="apple-announcement-marquee-track">
            {repeatedGroups.map((groupIndex) => (
              <div
                key={groupIndex}
                className="apple-announcement-marquee-group"
                aria-hidden={groupIndex > 0}
              >
                {normalizedItems.map((item, index) => (
                  <span key={`${groupIndex}-${index}`} className="apple-announcement-message">
                    <span>{item}</span>
                  </span>
                ))}
              </div>
            ))}
          </div>
        </div>
      </div>
    </section>
  );
}
