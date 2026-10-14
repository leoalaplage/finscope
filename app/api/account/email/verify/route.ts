import { verifyEmail } from "@/lib/accounts";

/** The link in the confirmation email: the address is verified, and the reader is taken to their account. */
export async function GET(request: Request) {
  const url = new URL(request.url);
  const account = await verifyEmail(url.searchParams.get("token") ?? "").catch(() => null);
  return Response.redirect(`${url.origin}/t/account?email=${account ? "verified" : "expired"}`, 302);
}
