import type { Metadata } from "next";
import NotFound from "../not-found";

export const metadata: Metadata = { title: "Not found", robots: { index: false } };

/** Target of the proxy rewrite for malformed addresses (served with HTTP 404). */
export default function InvalidAddress() {
  return <NotFound />;
}
