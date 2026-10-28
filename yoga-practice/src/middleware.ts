import { dataAppMiddleware } from "@ai-outfitter/app-sdk/cloudflare/middleware";

// Pages are GET only; every /api/* request must carry the member identity the
// platform forwards. The policy allows only this app's own scripts and calls.
export const onRequest = dataAppMiddleware(
  "yoga-practice",
  "default-src 'none'; script-src 'self'; style-src 'self'; font-src 'self'; img-src 'self'; connect-src 'self'; base-uri 'none'; frame-ancestors 'none'; form-action 'self'",
);
