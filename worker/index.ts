/** Cloudflare Worker entry point for the vinext-starter template. */
import { handleImageOptimization, DEFAULT_DEVICE_SIZES, DEFAULT_IMAGE_SIZES } from "vinext/server/image-optimization";
import handler from "vinext/server/app-router-entry";

interface Env {
  ASSETS: Fetcher;
  DB: D1Database;
  IMAGES: {
    input(stream: ReadableStream): {
      transform(options: Record<string, unknown>): {
        output(options: { format: string; quality: number }): Promise<{ response(): Response }>;
      };
    };
  };
}

interface ExecutionContext {
  waitUntil(promise: Promise<unknown>): void;
  passThroughOnException(): void;
}

// Image security config. SVG sources with .svg extension auto-skip the
// optimization endpoint on the client side (served directly, no proxy).
// To route SVGs through the optimizer (with security headers), set
// dangerouslyAllowSVG: true in next.config.js and uncomment below:
// const imageConfig: ImageConfig = { dangerouslyAllowSVG: true };

const worker = {
  async fetch(request: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
    const url = new URL(request.url);
    const requestId = request.headers.get("cf-ray") ?? crypto.randomUUID();

    try {
      let response: Response;
      if (url.pathname === "/_vinext/image") {
        const allowedWidths = [...DEFAULT_DEVICE_SIZES, ...DEFAULT_IMAGE_SIZES];
        response = await handleImageOptimization(request, {
          fetchAsset: (path) => env.ASSETS.fetch(new Request(new URL(path, request.url))),
          transformImage: async (body, { width, format, quality }) => {
            const result = await env.IMAGES.input(body).transform(width > 0 ? { width } : {}).output({ format, quality });
            return result.response();
          },
        }, allowedWidths);
      } else {
        response = await handler.fetch(request, env, ctx);
      }

      return secureResponse(response, url, requestId);
    } catch (error) {
      console.error(JSON.stringify({ level: "error", requestId, path: url.pathname, message: error instanceof Error ? error.message : "Unhandled request error" }));
      return secureResponse(Response.json({ error: "The service is temporarily unavailable", requestId }, { status: 500 }), url, requestId);
    }
  },
};

function secureResponse(response: Response, url: URL, requestId: string) {
  const headers = new Headers(response.headers);
  headers.set("x-content-type-options", "nosniff");
  headers.set("referrer-policy", "strict-origin-when-cross-origin");
  headers.set("permissions-policy", "camera=(), microphone=(), geolocation=(), payment=(self \"https://checkout.razorpay.com\")");
  headers.set("strict-transport-security", "max-age=31536000; includeSubDomains");
  headers.set("cross-origin-opener-policy", "same-origin-allow-popups");
  headers.set("x-request-id", requestId);
  headers.set("content-security-policy", [
    "default-src 'self'",
    "base-uri 'self'",
    "object-src 'none'",
    "frame-ancestors 'none'",
    "form-action 'self' https://api.razorpay.com",
    "script-src 'self' 'unsafe-inline' https://www.gstatic.com https://www.google.com https://www.recaptcha.net https://checkout.razorpay.com",
    "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com",
    "font-src 'self' data: https://fonts.gstatic.com",
    "img-src 'self' data: blob: https://*.googleusercontent.com https://*.firebaseapp.com https://*.razorpay.com",
    "connect-src 'self' https://identitytoolkit.googleapis.com https://securetoken.googleapis.com https://firebaseinstallations.googleapis.com https://firebaseappcheck.googleapis.com https://firebasestorage.googleapis.com https://www.google.com https://*.googleapis.com https://api.razorpay.com https://*.razorpay.com",
    "frame-src 'self' https://www.google.com https://www.recaptcha.net https://*.firebaseapp.com https://api.razorpay.com https://*.razorpay.com",
    "worker-src 'self' blob:",
    "upgrade-insecure-requests",
  ].join("; "));
  if (url.pathname.startsWith("/api/")) headers.set("cache-control", "no-store, max-age=0");
  return new Response(response.body, { status: response.status, statusText: response.statusText, headers });
}

export default worker;
