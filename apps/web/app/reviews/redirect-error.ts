/** Next.js `redirect()` throws an internal error; rethrow so catch blocks don’t swallow it. */
export function isNextRedirectError(error: unknown): boolean {
  if (typeof error !== "object" || error === null) {
    return false;
  }
  const digest = String((error as { digest?: unknown }).digest ?? "");
  if (digest.includes("NEXT_REDIRECT")) {
    return true;
  }
  return (error as { message?: string }).message === "NEXT_REDIRECT";
}
