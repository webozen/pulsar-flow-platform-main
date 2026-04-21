import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  output: "standalone",
  basePath: "/automation",
  assetPrefix: "/automation",
  env: {
    NEXT_PUBLIC_PULSAR_APP_URL: process.env.PULSAR_APP_URL || 'http://localhost:5173',
  },
};

export default nextConfig;
