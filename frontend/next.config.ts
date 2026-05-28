import type { NextConfig } from "next";
import path from "node:path";

const nextConfig: NextConfig = {
  serverExternalPackages: ['pdf-parse', '@prisma/adapter-pg', 'pg', 'better-sqlite3'],
  outputFileTracingRoot: path.resolve(process.cwd(), '..'),
  outputFileTracingIncludes: {
    '/*': ['system_prompts.md', 'system_prompts_part2.md'],
  },
};

export default nextConfig;
