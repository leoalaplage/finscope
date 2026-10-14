import { removePasskey } from "@/lib/accounts";
import { accountAnswer, refuse, requireAccount, sameOrigin } from "@/lib/account-http";

/** Removes one of the account's passkeys (a lost phone); the last one stays. */
export async function DELETE(request: Request) {
  if (!sameOrigin(request)) return refuse("Not from this site.", 403);
  const account = await requireAccount(request);
  if (account instanceof Response) return account;
  const id = new URL(request.url).searchParams.get("id") ?? "";
  try {
    return accountAnswer(await removePasskey(account, id));
  } catch (error) {
    return refuse(error instanceof Error ? error.message : "The passkey could not be removed.");
  }
}
