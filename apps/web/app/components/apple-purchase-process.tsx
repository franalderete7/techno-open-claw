"use client";

import { useEffect, useMemo, useState } from "react";

type ApplePurchaseProcessProps = {
  variant?: "hero" | "detail" | "footer";
  inStock?: boolean;
  deliveryDays?: number | null;
};

type PurchaseMode = "shipping" | "pickup";
type PurchaseStep = {
  title: string;
  body: string;
  label: string;
};

function buildSteps(mode: PurchaseMode, inStock: boolean, deliveryDays: number | null): PurchaseStep[] {
  if (mode === "pickup") {
    return [
      {
        label: "Elegís",
        title: "Seleccionás tu iPhone",
        body: "Ves el precio final, confirmás la versión y reservás sin vueltas.",
      },
      {
        label: "Coordinamos",
        title: inStock ? "Te apartamos stock y horario" : "Te avisamos ingreso y reserva",
        body: inStock
          ? "Te confirmamos por WhatsApp el retiro en Salta antes de que salgas."
          : "Si entra por proveedor, te avisamos cuándo llega y coordinamos el retiro apenas esté listo.",
      },
      {
        label: "Retirás",
        title: "Pasás con todo confirmado",
        body: "Retirás el equipo con la operación ya validada y atención directa.",
      },
    ];
  }

  return [
    {
      label: "Elegís",
      title: "Elegís el modelo correcto",
      body: "Comparás precio final, cuotas y versión antes de avanzar.",
    },
    {
      label: "Confirmamos",
      title: inStock ? "Reservamos y despachamos" : "Reservamos e informamos tiempos",
      body: inStock
        ? "Confirmamos datos, pago y despacho para que salga rápido."
        : `Te pasamos tiempos estimados${deliveryDays ? ` de ${deliveryDays} días` : ""} y seguimos el ingreso con vos.`,
    },
    {
      label: "Seguís",
      title: "Recibís seguimiento real",
      body: "Te acompañamos por WhatsApp hasta la entrega para que sepas cómo viene todo.",
    },
  ];
}

export function ApplePurchaseProcess({ variant = "hero", inStock = true, deliveryDays = null }: ApplePurchaseProcessProps) {
  const [mode, setMode] = useState<PurchaseMode>("shipping");
  const [activeStep, setActiveStep] = useState(0);
  const steps = useMemo(() => buildSteps(mode, inStock, deliveryDays), [deliveryDays, inStock, mode]);
  const activeStepData = steps[activeStep] ?? steps[0];

  useEffect(() => {
    setActiveStep(0);
  }, [mode]);

  useEffect(() => {
    if (steps.length <= 1) {
      return;
    }

    const timer = window.setInterval(() => {
      setActiveStep((current) => (current + 1) % steps.length);
    }, 3200);

    return () => window.clearInterval(timer);
  }, [steps]);

  return (
    <section className={`apple-purchase-process apple-purchase-process--${variant}`}>
      <div className="apple-purchase-process-head">
        <div className="apple-purchase-process-copy">
          <span className="apple-purchase-process-kicker">Proceso de compra</span>
          <h2 className="apple-purchase-process-title">
            {mode === "shipping" ? "Envío a todo el país, claro y acompañado." : "Retiro en Salta, simple y coordinado."}
          </h2>
        </div>

        <div className="apple-purchase-process-tabs" role="tablist" aria-label="Elegir tipo de compra">
          <button
            type="button"
            className={`apple-purchase-process-tab ${mode === "shipping" ? "is-active" : ""}`}
            onClick={() => setMode("shipping")}
          >
            Envío país
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

      <div className="apple-purchase-process-progress" aria-hidden="true">
        {steps.map((step, index) => (
          <span key={step.title} className={`apple-purchase-process-progress-segment ${index <= activeStep ? "is-active" : ""}`} />
        ))}
      </div>

      <div className="apple-purchase-process-body">
        <article className="apple-purchase-process-stage">
          <div className="apple-purchase-process-stage-glow" aria-hidden="true" />
          <div key={`${mode}-${activeStep}`} className="apple-purchase-process-stage-surface">
            <div className="apple-purchase-process-stage-top apple-purchase-process-stage-line apple-purchase-process-stage-line--1">
              <span>{activeStep + 1}</span>
              <small>{activeStepData.label}</small>
            </div>
            <strong className="apple-purchase-process-stage-line apple-purchase-process-stage-line--2">{activeStepData.title}</strong>
            <p className="apple-purchase-process-stage-line apple-purchase-process-stage-line--3">{activeStepData.body}</p>
          </div>
        </article>

        <div className="apple-purchase-process-step-list">
          {steps.map((step, index) => (
            <button
              key={step.title}
              type="button"
              className={`apple-purchase-process-step ${index === activeStep ? "is-active" : ""}`}
              onClick={() => setActiveStep(index)}
            >
              <div className="apple-purchase-process-step-top">
                <span>{index + 1}</span>
                <small>{step.label}</small>
              </div>
              <strong>{step.title}</strong>
            </button>
          ))}
        </div>
      </div>
    </section>
  );
}
