import { dataAppMiddleware } from "@ai-outfitter/app-sdk/cloudflare/middleware";
export const onRequest = dataAppMiddleware("dione", "default-src 'none'; script-src 'self'; style-src 'self'; font-src 'self'; img-src 'self'; connect-src 'self'; base-uri 'none'; frame-ancestors 'none'; form-action 'self'");
