import type { NextConfig } from "next";

const FLASK = process.env.FLASK_URL ?? "http://127.0.0.1:5000";

const nextConfig: NextConfig = {
  // Next blocks its own CSS/JS (/_next/*) in dev unless the page's host is listed.
  // Without this, opening http://127.0.0.1:3000 shows unstyled HTML.
  allowedDevOrigins: ["127.0.0.1"],
  // Kept from the generated project: this is how Tailwind v4 is compiled here.
  turbopack: {
    rules: {
      "*.css": {
        loaders: ["@tailwindcss/turbopack"],
        as: "*.css",
      },
    },
  },
  async rewrites() {
    // Whatever Next doesn't serve itself (dashboard, /static, /api/*, logout…)
    // is forwarded to the untouched Flask app.
    return { fallback: [{ source: "/:path*", destination: `${FLASK}/:path*` }] };
  },
};

export default nextConfig;
