/** @type {import('next').NextConfig} */
const isProd = process.env.NODE_ENV === "production";

// Content-Security-Policy. Self-hosted only — no external CDNs/fonts/analytics
// (a DSGVO requirement), so everything is 'self'. Next injects small inline
// bootstrap scripts and inline styles, hence 'unsafe-inline'; dev/HMR also needs
// 'unsafe-eval' and a websocket connection. A stricter nonce-based policy can be
// layered on later (see README › Security).
const csp = [
  "default-src 'self'",
  `script-src 'self' 'unsafe-inline'${isProd ? "" : " 'unsafe-eval'"}`,
  "style-src 'self' 'unsafe-inline'",
  "img-src 'self' data:",
  "font-src 'self'",
  `connect-src 'self'${isProd ? "" : " ws:"}`,
  "object-src 'none'",
  "base-uri 'self'",
  "form-action 'self'",
  "frame-ancestors 'none'",
  ...(isProd ? ["upgrade-insecure-requests"] : []),
].join("; ");

const nextConfig = {
  reactStrictMode: true,
  // Argon2 (native binding) must not be bundled into server components output tracing.
  serverExternalPackages: ["@node-rs/argon2"],
  // Static security-header baseline applied to every response.
  async headers() {
    return [
      {
        source: "/:path*",
        headers: [
          { key: "Content-Security-Policy", value: csp },
          // Harmless over HTTP; enforces HTTPS once served over TLS (Railway).
          { key: "Strict-Transport-Security", value: "max-age=63072000; includeSubDomains; preload" },
          { key: "X-Content-Type-Options", value: "nosniff" },
          { key: "X-Frame-Options", value: "DENY" },
          { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
          { key: "X-DNS-Prefetch-Control", value: "off" },
          {
            key: "Permissions-Policy",
            value: "camera=(), microphone=(), geolocation=(), payment=()",
          },
        ],
      },
    ];
  },
};

export default nextConfig;
