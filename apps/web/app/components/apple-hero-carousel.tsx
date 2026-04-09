"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";

type AppleHeroCarouselItem = {
  id: string;
  title: string;
  subtitle?: string | null;
  pitch: string;
  price: string;
  installment?: string | null;
  imageUrl?: string | null;
  href: string;
};

type AppleHeroCarouselProps = {
  items: AppleHeroCarouselItem[];
  whatsappUrl?: string | null;
};

const AUTO_ADVANCE_MS = 3200;

export function AppleHeroCarousel({ items, whatsappUrl }: AppleHeroCarouselProps) {
  const [current, setCurrent] = useState(0);
  const safeItems = useMemo(() => items.filter((item) => item.href && item.title), [items]);

  useEffect(() => {
    if (safeItems.length <= 1) {
      return;
    }

    const timer = window.setInterval(() => {
      setCurrent((value) => (value + 1) % safeItems.length);
    }, AUTO_ADVANCE_MS);

    return () => window.clearInterval(timer);
  }, [safeItems.length]);

  useEffect(() => {
    if (current > safeItems.length - 1) {
      setCurrent(0);
    }
  }, [current, safeItems.length]);

  if (safeItems.length === 0) {
    return null;
  }

  const goPrev = () => {
    setCurrent((value) => (value - 1 + safeItems.length) % safeItems.length);
  };

  const goNext = () => {
    setCurrent((value) => (value + 1) % safeItems.length);
  };

  return (
    <section className="apple-hero-carousel" aria-label="Promociones iPhone destacadas">
      <div className="apple-hero-carousel-track" style={{ transform: `translate3d(-${current * 100}%, 0, 0)` }}>
        {safeItems.map((item, index) => (
          <article key={item.id} className="apple-hero-slide" aria-hidden={index !== current}>
            <div className="apple-hero-slide-copy">
              <span className="apple-hero-slide-kicker">iPhone destacado</span>
              <h2 className="apple-hero-slide-title">{item.title}</h2>
              {item.subtitle ? <p className="apple-hero-slide-subtitle">{item.subtitle}</p> : null}
              <div className="apple-hero-slide-price">
                <span>Precio final</span>
                <strong>{item.price}</strong>
                {item.installment ? <small>{item.installment}</small> : null}
              </div>
              <div className="apple-hero-slide-actions">
                <Link href={item.href} className="apple-storefront-cta">
                  Ver este iPhone
                </Link>
                {whatsappUrl ? (
                  <a href={whatsappUrl} target="_blank" rel="noreferrer" className="apple-storefront-link">
                    Consultar por WhatsApp
                  </a>
                ) : null}
              </div>
            </div>

            <div className="apple-hero-slide-visual">
              {item.imageUrl ? (
                <img
                  src={item.imageUrl}
                  alt={item.title}
                  loading={index === 0 ? "eager" : "lazy"}
                  decoding="async"
                  referrerPolicy="no-referrer"
                  className="apple-hero-slide-image"
                />
              ) : (
                <div className="apple-phone-fallback apple-hero-slide-fallback">
                  <span className="apple-phone-fallback-mark">IP</span>
                  <span className="apple-phone-fallback-copy">Imagen a confirmar</span>
                </div>
              )}
            </div>
          </article>
        ))}
      </div>

      {safeItems.length > 1 ? (
        <>
          <div className="apple-hero-carousel-controls">
            <button type="button" className="apple-hero-carousel-arrow" onClick={goPrev} aria-label="Slide anterior">
              <svg viewBox="0 0 24 24" aria-hidden="true" className="apple-hero-carousel-arrow-icon">
                <path d="M14.5 5.5 8 12l6.5 6.5" />
              </svg>
            </button>
            <button type="button" className="apple-hero-carousel-arrow" onClick={goNext} aria-label="Slide siguiente">
              <svg viewBox="0 0 24 24" aria-hidden="true" className="apple-hero-carousel-arrow-icon">
                <path d="M9.5 5.5 16 12l-6.5 6.5" />
              </svg>
            </button>
          </div>

          <div className="apple-hero-carousel-dots" aria-hidden="true">
            {safeItems.map((item, index) => (
              <span key={item.id} className={`apple-hero-carousel-dot ${index === current ? "is-active" : ""}`} />
            ))}
          </div>
        </>
      ) : null}
    </section>
  );
}
