// next/headers is a server-only API: importing this module from a Client
// Component is rejected by Next. Keep signing keys and cookie values server-side.
import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { OPERATOR_AUTH_REQUIRED, OPERATOR_SESSION_TTL_SECONDS, operatorTokenConfigured, safeOperatorReturnPath, signOperatorSession, verifyOperatorSession } from "./operator-auth";

export const OPERATOR_SESSION_COOKIE = "mi-operator-session";

export function isOperatorAuthConfigured() {
  return operatorTokenConfigured(process.env.DATA_OPERATIONS_OPERATOR_TOKEN);
}

export async function getOperatorSession() {
  const token = process.env.DATA_OPERATIONS_OPERATOR_TOKEN;
  if (!operatorTokenConfigured(token)) return null;
  const cookieStore = await cookies();
  return verifyOperatorSession(cookieStore.get(OPERATOR_SESSION_COOKIE)?.value, token);
}

export async function requireOperatorSession() {
  const session = await getOperatorSession();
  if (!session) throw new Error(OPERATOR_AUTH_REQUIRED);
  return session;
}

export async function requireOperatorPage(nextPath: string) {
  const session = await getOperatorSession();
  if (!session) redirect(`/operator?next=${encodeURIComponent(safeOperatorReturnPath(nextPath))}`);
  return session;
}

function cookieOptions() {
  return { httpOnly: true, secure: process.env.NODE_ENV === "production", sameSite: "strict" as const, path: "/", priority: "high" as const };
}

// These cookie mutation helpers must only be called from Server Actions.
export async function createOperatorSession() {
  const token = process.env.DATA_OPERATIONS_OPERATOR_TOKEN;
  if (!operatorTokenConfigured(token)) throw new Error("Operator access is not configured.");
  const cookieStore = await cookies();
  cookieStore.set(OPERATOR_SESSION_COOKIE, signOperatorSession(token), { ...cookieOptions(), maxAge: OPERATOR_SESSION_TTL_SECONDS });
}

export async function deleteOperatorSession() {
  const cookieStore = await cookies();
  cookieStore.set(OPERATOR_SESSION_COOKIE, "", { ...cookieOptions(), maxAge: 0, expires: new Date(0) });
}
