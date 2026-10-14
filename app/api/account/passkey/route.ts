import { removePasskey, renamePasskey } from "@/lib/accounts";
import { accountAnswer, refuse, requireAccount, sameOrigin } from "@/lib/account-http";

/** Renames one of the account's passkeys ("Work laptop"). */
export async function PATCH(request: Request) {
  if (!sameOrigin(request)) return refuse("Not from this site.", 403);
  const account = await requireAccount(request);
  if (account instanceof Response) return account;
  const body = await request.json().catch(() => null) as { label?: unknown } | null;
  if (typeof body?.label !== "string") return refuse("Incomplete request.");
  try {
    return accountAnswer(await renamePasskey(account, new URL(request.url).searchParams.get("id") ?? "", body.label));
  } catch (error) {
    return refuse(error instanceof Error ? error.message : "The passkey could not be renamed.");
  }
}

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
