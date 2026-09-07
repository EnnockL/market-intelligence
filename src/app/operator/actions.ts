"use server";

import { redirect } from "next/navigation";
import { matchesOperatorToken, safeOperatorReturnPath } from "@/lib/operator-auth";
import { createOperatorSession, deleteOperatorSession, isOperatorAuthConfigured } from "@/lib/operator-session";

export type OperatorLoginState = { status: "IDLE" | "ERROR"; message: string };

export async function loginOperator(_: OperatorLoginState, formData: FormData): Promise<OperatorLoginState> {
  if (!isOperatorAuthConfigured()) return { status: "ERROR", message: "Operatörsåtkomst är inte konfigurerad på servern." };
  if (!matchesOperatorToken(formData.get("operatorToken"), process.env.DATA_OPERATIONS_OPERATOR_TOKEN)) return { status: "ERROR", message: "Ogiltig operatörstoken." };
  await createOperatorSession();
  redirect(safeOperatorReturnPath(formData.get("next")));
}

export async function logoutOperator() {
  await deleteOperatorSession();
  redirect("/operator");
}
