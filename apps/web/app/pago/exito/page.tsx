import Link from "next/link";
import { getSiteMode } from "../../../lib/site-mode";

export default async function PagoExitoPage() {
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
          <span className="eyebrow">Pago recibido</span>
          <h1 className="storefront-location-title">Tu compra quedó en marcha.</h1>
          <p className="storefront-location-lead">
            Si el pago se acreditó correctamente, seguimos la coordinación por WhatsApp para retiro o entrega.
          </p>
          <Link href="/" className="storefront-navbar-cta">
            Volver a la tienda
          </Link>
        </div>
      </section>
    </div>
  );
}
