"use client";

import { usePathname, useSearchParams } from "next/navigation";
import { useEffect, useRef } from "react";
import { trackStorefrontPageView } from "../../lib/storefront-analytics";

export function StorefrontPageViewTracker() {
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const lastTrackedRef = useRef<string | null>(null);

  useEffect(() => {
    const search = searchParams.toString();
    const key = search ? `${pathname}?${search}` : pathname;

    if (!key || lastTrackedRef.current === key) {
      return;
    }

    lastTrackedRef.current = key;
    trackStorefrontPageView();
  }, [pathname, searchParams]);

  return null;
}
