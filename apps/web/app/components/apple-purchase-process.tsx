"use client";

import { useState } from "react";

type ApplePurchaseProcessProps = {
  variant?: "hero" | "detail";
  inStock?: boolean;
  deliveryDays?: number | null;
};

type PurchaseMode = "shipping" | "pickup";

function buildSteps(mode: PurchaseMode, inStock: boolean, deliveryDays: number | null) {
  if (mode === "pickup") {
    return [
      "Reservás el iPhone por WhatsApp o pago.",
      inStock ? "Te confirmamos stock y horario para retiro en Salta." : "Te avisamos cuándo ingresa y coordinamos el retiro en Salta.",
      "Retirás el equipo con la operación ya confirmada.",
    ];
  }

  return [
    "Reservás el iPhone por WhatsApp o pago.",
    inStock
      ? "Confirmamos stock, datos de envío y despacho."
      : `Te confirmamos ingreso y tiempos estimados${deliveryDays ? ` de ${deliveryDays} días` : ""}.`,
    "Te enviamos seguimiento y acompañamiento por WhatsApp hasta que llegue.",
  ];
}

export function ApplePurchaseProcess({ variant = "hero", inStock = true, deliveryDays = null }: ApplePurchaseProcessProps) {
  const [mode, setMode] = useState<PurchaseMode>("shipping");
  const steps = buildSteps(mode, inStock, deliveryDays);

  return (
    <section className={`apple-purchase-process apple-purchase-process--${variant}`}>
      <div className="apple-purchase-process-head">
        <span className="apple-hero-kicker">Proceso de compra</span>
        <div className="apple-purchase-process-tabs" role="tablist" aria-label="Elegir tipo de compra">
          <button
            type="button"
            className={`apple-purchase-process-tab ${mode === "shipping" ? "is-active" : ""}`}
            onClick={() => setMode("shipping")}
          >
            Envío
          </button>
          <button
            type="button"
            className={`apple-purchase-process-tab ${mode === "pickup" ? "is-active" : ""}`}
            onClick={() => setMode("pickup")}
          >
            Retiro Salta
          </button>
        </div>
      </div>

      <div className="apple-purchase-process-body">
        {steps.map((step, index) => (
          <div key={step} className="apple-purchase-process-step">
            <span>{index + 1}</span>
            <p>{step}</p>
          </div>
        ))}
      </div>
    </section>
  );
}
