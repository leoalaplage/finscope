import { currentAccount, deleteAccount, renameAccount } from "@/lib/accounts";
import { accountAnswer, refuse, requireAccount, sameOrigin } from "@/lib/account-http";

/** The account signed in on this browser, if any (lib/accounts.ts). */
export async function GET(request: Request) {
  return accountAnswer(await currentAccount(request).catch(() => null));
}

/** Renames the account: the name shown on its pages and on the passkey prompts of new devices. */
export async function PATCH(request: Request) {
  if (!sameOrigin(request)) return refuse("Not from this site.", 403);
  const account = await requireAccount(request);
  if (account instanceof Response) return account;
  const body = await request.json().catch(() => null) as { name?: unknown } | null;
  if (typeof body?.name !== "string") return refuse("Incomplete request.");
  try {
    return accountAnswer(await renameAccount(account, body.name));
  } catch (error) {
    return refuse(error instanceof Error ? error.message : "The name could not be kept.");
  }
}

/** Deletes the account and everything it holds. */
export async function DELETE(request: Request) {
  if (!sameOrigin(request)) return refuse("Not from this site.", 403);
  const account = await requireAccount(request);
  if (account instanceof Response) return account;
  await deleteAccount(account, request);
  return accountAnswer(null, null, request);
}
