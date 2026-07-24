import type { NextConfig } from "next";
import path from "node:path";

const nextConfig: NextConfig = {
  // Evita o aviso de "múltiplos lockfiles" — o NestJS na raiz do repo tem o
  // seu próprio package-lock.json, mas o workspace deste app é só `web/`.
  outputFileTracingRoot: path.join(__dirname),
};

export default nextConfig;
