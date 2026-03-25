import Link from "next/link";
import { getSiteMode } from "../../../lib/site-mode";

export default async function PagoErrorPage() {
  const siteMode = await getSiteMode();

  if (siteMode === "admin") {
    return (
      <div className="page-stack">
        <section className="panel">
          <p className="empty">Esta pantalla está pensada para la tienda pública.</p>
        </section>
      </div>
    );
  }

  return (
    <div className="page-stack">
      <section className="storefront-location">
        <div className="storefront-location-copy">
          <span className="eyebrow">Pago pendiente</span>
          <h1 className="storefront-location-title">No se pudo confirmar el pago.</h1>
          <p className="storefront-location-lead">
            Podés volver a intentarlo desde WhatsApp o escribirnos y seguimos la compra por ahí.
          </p>
          <Link href="/" className="storefront-navbar-cta">
            Volver a la tienda
          </Link>
        </div>
      </section>
    </div>
  );
}
