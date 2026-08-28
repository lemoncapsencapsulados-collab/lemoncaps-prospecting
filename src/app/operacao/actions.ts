"use server";

import { revalidatePath } from "next/cache";

import { setGeneralPause } from "@/features/dashboard/operations";
import { getServerContext } from "@/lib/server-context";

export async function toggleGeneralPause(formData: FormData): Promise<void> {
  const requested = formData.get("paused");
  if (requested !== "true" && requested !== "false") {
    throw new Error("Valor inválido para a pausa geral");
  }

  const { database } = getServerContext();
  setGeneralPause(
    database,
    requested === "true",
    requested === "true" ? "Pausa acionada pelo operador no painel" : "Operação retomada pelo operador no painel",
  );

  revalidatePath("/");
  revalidatePath("/operacao");
}
