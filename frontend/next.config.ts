import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  serverExternalPackages: ['pdf-parse', '@prisma/adapter-pg', 'pg'],
};

export default nextConfig;
