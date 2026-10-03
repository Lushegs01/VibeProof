import { NextResponse, type NextRequest } from "next/server";

const ADDRESS = /^0x[0-9a-fA-F]{40}$/;
const NETWORK_SLUGS = new Set(["robinhood-mainnet", "robinhood-testnet"]);

/** Reject syntactically invalid addresses with a real 404 before any rendering or data access. */
export function proxy(req: NextRequest) {
  const parts = req.nextUrl.pathname.split("/").filter(Boolean);
  const bad =
    (parts[0] === "token" && (!NETWORK_SLUGS.has(parts[1] ?? "") || !ADDRESS.test(parts[2] ?? ""))) ||
    (parts[0] === "creator" && !ADDRESS.test(parts[1] ?? "")) ||
    (parts[0] === "p" && !/^[A-Za-z0-9]{4,16}$/.test(parts[1] ?? ""));
  if (bad) return NextResponse.rewrite(new URL("/invalid-address", req.url), { status: 404 });
  return NextResponse.next();
}

export const config = { matcher: ["/token/:path*", "/creator/:path*", "/p/:path*"] };
