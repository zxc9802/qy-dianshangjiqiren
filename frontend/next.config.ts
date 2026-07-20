import type { NextConfig } from "next";
import path from "node:path";

const nextConfig: NextConfig = {
  serverExternalPackages: ['pdf-parse', '@prisma/adapter-pg', 'pg', 'better-sqlite3'],
  outputFileTracingRoot: path.resolve(process.cwd(), '..'),
  outputFileTracingIncludes: {
    '/*': ['system_prompts.md', 'system_prompts_part2.md'],
  },
  async rewrites() {
    return {
      beforeFiles: [
        {
          source: '/',
          destination: '/home2',
        },
      ],
      afterFiles: [],
      fallback: [],
    };
  },
};

export default nextConfig;
