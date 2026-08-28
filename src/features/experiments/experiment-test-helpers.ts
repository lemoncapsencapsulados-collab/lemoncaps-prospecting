import type { AppDatabase } from "@/db/client";

import { createExperiment } from "./experiment-service.ts";

export function createInitialMessageExperiment(db: AppDatabase) {
  return createExperiment(db, {
    name: "Mensagem inicial",
    funnel: "customer",
    variable: "initial_message",
    minimumSamplePerVariant: 2,
    variants: [
      { name: "Controle", isControl: true, allocationBasisPoints: 5_000, config: { initial_message: "A" } },
      { name: "Variação", isControl: false, allocationBasisPoints: 5_000, config: { initial_message: "B" } },
    ],
  });
}

export function profile(instagramHandle: string) {
  return {
    instagramHandle,
    displayName: "Perfil de teste",
    bio: "Marca própria",
    category: "Empreendedor",
    location: "Brasil",
    recentPosts: [],
    hashtags: [],
    relatedProfiles: [],
    source: "experiment-test",
    proposedFunnel: "customer" as const,
  };
}
