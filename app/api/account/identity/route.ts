import { removeIdentity, type IdentityProvider } from "@/lib/accounts";
import { accountAnswer, refuse, requireAccount, sameOrigin } from "@/lib/account-http";

/** Disconnects a Google or Microsoft account, or an email address, from the account; one way in always stays. */
export async function DELETE(request: Request) {
  if (!sameOrigin(request)) return refuse("Not from this site.", 403);
  const account = await requireAccount(request);
  if (account instanceof Response) return account;
  const params = new URL(request.url).searchParams;
  const provider = params.get("provider") as IdentityProvider | null;
  if (provider !== "google" && provider !== "microsoft" && provider !== "apple" && provider !== "email") return refuse("Unknown sign-in method.");
  try {
    return accountAnswer(await removeIdentity(account, provider, params.get("subject") ?? ""));
  } catch (error) {
    return refuse(error instanceof Error ? error.message : "The sign-in method could not be removed.");
  }
}
