import { currentAccount, deleteAccount } from "@/lib/accounts";
import { accountAnswer, refuse, requireAccount, sameOrigin } from "@/lib/account-http";

/** The account signed in on this browser, if any (lib/accounts.ts). */
export async function GET(request: Request) {
  return accountAnswer(await currentAccount(request).catch(() => null));
}

/** Deletes the account and everything it holds. */
export async function DELETE(request: Request) {
  if (!sameOrigin(request)) return refuse("Not from this site.", 403);
  const account = await requireAccount(request);
  if (account instanceof Response) return account;
  await deleteAccount(account, request);
  return accountAnswer(null, null, request);
}
