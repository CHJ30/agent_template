import path from "node:path";
import type { NextConfig } from "next";
const backendUrl = process.env.API_BASE_URL || "http://localhost:8081";
const nextConfig: NextConfig = {
  transpilePackages: ["@autix/contracts"],
  output: "standalone",
  outputFileTracingRoot: path.join(__dirname, "../../"),
  async rewrites() {
    return [
      // 以下路由保留 /api 前缀，因为 NestJS controller 声明了 @Controller('api/...')
      { source: "/api/memory/:path*",    destination: `${backendUrl}/api/memory/:path*`    },
      { source: "/api/files/:path*",     destination: `${backendUrl}/api/files/:path*`     },
      { source: "/api/embedding/:path*", destination: `${backendUrl}/api/embedding/:path*` },
      { source: "/api/agents/:path*",    destination: `${backendUrl}/api/agents/:path*`    },
      { source: "/api/pipeline-demo/:path*", destination: `${backendUrl}/api/pipeline-demo/:path*` },
      { source: "/api/rag-demo/:path*", destination: `${backendUrl}/api/rag-demo/:path*` },
      { source: "/api/advanced/:path*",        destination: `${backendUrl}/api/advanced/:path*`        },
      { source: "/api/ui-chat/:path*",        destination: `${backendUrl}/api/ui-chat/:path*`        },
      { source: "/api/conversations/:path*", destination: `${backendUrl}/api/conversations/:path*` },
      { source: "/api/conversations",        destination: `${backendUrl}/api/conversations`        },
      { source: "/api/documents/:path*",     destination: `${backendUrl}/api/documents/:path*`     },
      { source: "/api/documents",            destination: `${backendUrl}/api/documents`            },
      { source: "/api/search/:path*",        destination: `${backendUrl}/api/search/:path*`        },
      { source: "/api/search",               destination: `${backendUrl}/api/search`               },
      { source: "/api/sse/:path*",           destination: `${backendUrl}/api/sse/:path*`           },
      { source: "/api/tasks/:path*",         destination: `${backendUrl}/api/tasks/:path*`         },
      // 其余 /api/* 路由去掉 /api 前缀转发给 NestJS
      { source: "/api/:path*", destination: `${backendUrl}/:path*` },
    ];
  },
};
export default nextConfig;
