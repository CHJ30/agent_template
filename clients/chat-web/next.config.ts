import path from "node:path";
import type { NextConfig } from "next";
const nextConfig: NextConfig = {
  transpilePackages: ["@autix/contracts"],
  output: "standalone",
  outputFileTracingRoot: path.join(__dirname, "../../"),
  async rewrites() {
    return [
      // 以下路由保留 /api 前缀，因为 NestJS controller 声明了 @Controller('api/...')
      { source: "/api/memory/:path*",    destination: "http://localhost:8081/api/memory/:path*"    },
      { source: "/api/files/:path*",     destination: "http://localhost:8081/api/files/:path*"     },
      { source: "/api/embedding/:path*", destination: "http://localhost:8081/api/embedding/:path*" },
      { source: "/api/agents/:path*",    destination: "http://localhost:8081/api/agents/:path*"    },
      { source: "/api/pipeline-demo/:path*", destination: "http://localhost:8081/api/pipeline-demo/:path*" },
      { source: "/api/advanced/:path*",        destination: "http://localhost:8081/api/advanced/:path*"        },
      { source: "/api/ui-chat/:path*",        destination: "http://localhost:8081/api/ui-chat/:path*"        },
      { source: "/api/conversations/:path*", destination: "http://localhost:8081/api/conversations/:path*" },
      { source: "/api/conversations",        destination: "http://localhost:8081/api/conversations"        },
      { source: "/api/documents/:path*",     destination: "http://localhost:8081/api/documents/:path*"     },
      { source: "/api/documents",            destination: "http://localhost:8081/api/documents"            },
      { source: "/api/search/:path*",        destination: "http://localhost:8081/api/search/:path*"        },
      { source: "/api/search",               destination: "http://localhost:8081/api/search"               },
      { source: "/api/sse/:path*",           destination: "http://localhost:8081/api/sse/:path*"           },
      { source: "/api/tasks/:path*",         destination: "http://localhost:8081/api/tasks/:path*"         },
      // 其余 /api/* 路由去掉 /api 前缀转发给 NestJS
      { source: "/api/:path*", destination: "http://localhost:8081/:path*" },
    ];
  },
};
export default nextConfig;
