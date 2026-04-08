"use client";

import { useEffect, useState } from "react";

type AppleAnnouncementBarProps = {
  items: string[];
};

const ROTATION_MS = 3200;

export function AppleAnnouncementBar({ items }: AppleAnnouncementBarProps) {
  const [activeIndex, setActiveIndex] = useState(0);

  useEffect(() => {
    if (items.length <= 1) {
      return;
    }

    const timer = window.setInterval(() => {
      setActiveIndex((current) => (current + 1) % items.length);
    }, ROTATION_MS);

    return () => window.clearInterval(timer);
  }, [items]);

  if (items.length === 0) {
    return null;
  }

  return (
    <section className="apple-announcement-bar" aria-label="Beneficios de compra">
      <div className="apple-announcement-track">
        {items.map((item, index) => (
          <p
            key={item}
            className={`apple-announcement-item ${index === activeIndex ? "is-active" : ""}`}
            aria-hidden={index !== activeIndex}
          >
            {item}
          </p>
        ))}
      </div>
      {items.length > 1 ? (
        <div className="apple-announcement-dots" aria-hidden="true">
          {items.map((item, index) => (
            <span key={item} className={`apple-announcement-dot ${index === activeIndex ? "is-active" : ""}`} />
          ))}
        </div>
      ) : null}
    </section>
  );
}
