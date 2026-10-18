import type { PoliteFetcher } from "../http/politeFetch.js";
import { civicplusAgendaCenter } from "./civicplus_agendacenter.js";
import { legistar } from "./legistar.js";
import type { Adapter, AdapterFactory, Jurisdiction } from "./types.js";

const adapters: Record<string, AdapterFactory> = {
  civicplus_agendacenter: civicplusAgendaCenter,
  legistar,
};

export function createAdapter(j: Jurisdiction, http: PoliteFetcher): Adapter {
  const factory = adapters[j.adapter];
  if (!factory) throw new Error(`${j.id}: unknown adapter "${j.adapter}"`);
  return factory(j, http);
}
