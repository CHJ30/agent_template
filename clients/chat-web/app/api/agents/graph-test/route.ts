import { type NextRequest, NextResponse } from "next/server";

// This Route Handler takes precedence over the /api/agents/:path* rewrite rule.
// It calls the NestJS backend directly in Node.js, so there is no proxy socket
// timeout — long-running analyze test cases (1-3 min) won't get ECONNRESET.
const BACKEND = "http://localhost:8081";

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const upstream = await fetch(`${BACKEND}/api/agents/graph-test`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    const data = await upstream.json();
    return NextResponse.json(data, { status: upstream.status });
  } catch (e) {
    return NextResponse.json(
      { error: e instanceof Error ? e.message : "backend unreachable" },
      { status: 502 },
    );
  }
}
