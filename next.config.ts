import type { NextConfig } from "next";
import path from "path";

const nextConfig: NextConfig = {
  outputFileTracingRoot: path.join(__dirname),
  /**
   * Keep firebase-admin (and its jwks-rsa → jose chain) as a native Node
   * require() from node_modules on Vercel, not webpack-bundled ESM.
   * Paired with package.json overrides pinning jose@4.15.9 (CJS-capable).
   */
  serverExternalPackages: ["firebase-admin", "jose", "jwks-rsa"],
};

export default nextConfig;
