import type { NextConfig } from "next";

const csp = [
  "default-src 'self'",
  "script-src 'self' 'unsafe-inline'" + (process.env.NODE_ENV === "development" ? " 'unsafe-eval'" : ""),
  "style-src 'self' 'unsafe-inline'",
  "img-src 'self' data: blob: https:",
  "font-src 'self' data:",
  // RPC providers + wallet relays (MetaMask mobile connector, WalletConnect/Reown when configured).
  "connect-src 'self' https://rpc.testnet.chain.robinhood.com wss://*.robinhood.com https://*.alchemy.com wss://*.alchemy.com https://*.metamask.io wss://*.metamask.io https://*.walletconnect.com wss://*.walletconnect.com https://*.walletconnect.org wss://*.walletconnect.org https://*.reown.com wss://*.reown.com",
  "frame-src 'self' https://verify.walletconnect.com https://verify.walletconnect.org",
  "frame-ancestors 'none'",
  "base-uri 'self'",
  "form-action 'self'",
].join("; ");

const securityHeaders = [
  { key: "Content-Security-Policy", value: csp },
  { key: "X-Content-Type-Options", value: "nosniff" },
  { key: "X-Frame-Options", value: "DENY" },
  { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
  { key: "Permissions-Policy", value: "camera=(), microphone=(), geolocation=()" },
  { key: "Strict-Transport-Security", value: "max-age=63072000; includeSubDomains; preload" },
];

const nextConfig: NextConfig = {
  // Separate build dir lets the demo-mode E2E build coexist with the normal one.
  distDir: process.env.NEXT_DIST_DIR || ".next",
  poweredByHeader: false,
  serverExternalPackages: ["postgres", "ioredis"],
  async headers() {
    return [
      { source: "/((?!embed/).*)", headers: securityHeaders },
      // The embeddable badge is meant to be framed by project sites.
      {
        source: "/embed/:path*",
        headers: [
          ...securityHeaders.filter((h) => !["Content-Security-Policy", "X-Frame-Options"].includes(h.key)),
          { key: "Content-Security-Policy", value: csp.replace("frame-ancestors 'none'", "frame-ancestors *") },
        ],
      },
    ];
  },
};

export default nextConfig;
