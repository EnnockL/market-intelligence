import { unstable_rethrow } from "next/navigation";
import type { LabActionState } from "./actions";

/** A lost response is not proof that a server-side run failed to persist. Never auto-retry. */
export async function invokeLabAction(
  action: (previous: LabActionState, form: FormData) => Promise<LabActionState>,
  previous: LabActionState,
  form: FormData,
): Promise<LabActionState> {
  try { return await action(previous, form); }
  catch (error) {
    unstable_rethrow(error);
    return {
      status: "ERROR",
      message: "Svaret kunde inte bekräftas. Åtgärden kan ha hunnit sparas. Dina val är kvar; kontrollera sparade körningar eller källans status innan du försöker igen.",
      values: Object.fromEntries(["definitionId", "assetId", "startsAt", "endsAt"].map(key => [key, String(form.get(key) ?? "")])),
    };
  }
}
