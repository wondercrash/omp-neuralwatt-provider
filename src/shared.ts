import type { ExtensionAPI } from "@oh-my-pi/pi-coding-agent";

export type ProviderConfig = Parameters<ExtensionAPI["registerProvider"]>[1];
export type ProviderModelConfig = NonNullable<ProviderConfig["models"]>[number];
export type FetchLike = (input: string, init?: RequestInit) => Promise<Response>;

export const PROVIDER_ID = "neuralwatt";
export const BASE_URL = "https://api.neuralwatt.com/v1";
export const PORTAL_URL = "https://portal.neuralwatt.com";
export const API_KEY_ENV = "NEURALWATT_API_KEY";

export function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === "object" && value !== null && !Array.isArray(value);
}

export function finite(value: unknown): number | undefined {
	return typeof value === "number" && Number.isFinite(value) ? value : undefined;
}

/** omp resolves an unset env-var reference to its literal name; that is not a key. */
export function usableApiKey(apiKey: string | undefined): string | undefined {
	const key = apiKey?.trim();
	return key && key !== API_KEY_ENV ? key : undefined;
}

export function bearer(apiKey: string): { Authorization: string } {
	return { Authorization: `Bearer ${apiKey}` };
}
