import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  serverExternalPackages: ['pdf-parse', '@prisma/adapter-pg', 'pg', 'better-sqlite3'],
};

export default nextConfig;
