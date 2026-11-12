import { BASE_URL, bearer, type FetchLike, finite, isRecord, type ProviderModelConfig, usableApiKey } from "./shared";

const EFFORT_ORDER = ["minimal", "low", "medium", "high", "xhigh", "max"] as const;
/** Overrides omp's per-family effort remaps: the Neuralwatt gateway accepts every level by name. */
const IDENTITY_EFFORT_MAP = {
	minimal: "minimal",
	low: "low",
	medium: "medium",
	high: "high",
	xhigh: "xhigh",
	max: "max",
};
/** Used when a row publishes no output cap; omp clamps chat-completions output to 64k anyway. */
const DEFAULT_MAX_OUTPUT_TOKENS = 65_536;

function positive(value: unknown): number | undefined {
	const n = finite(value);
	return n !== undefined && n > 0 ? n : undefined;
}

function price(value: unknown): number {
	const n = finite(value);
	return n !== undefined && n >= 0 ? n : 0;
}

/** Maps one `/v1/models` row; `undefined` for rows omp cannot chat with. */
export function toModelConfig(entry: unknown): ProviderModelConfig | undefined {
	if (!isRecord(entry) || typeof entry.id !== "string" || entry.id === "") return undefined;
	const meta = isRecord(entry.metadata) ? entry.metadata : {};
	const caps = isRecord(meta.capabilities) ? meta.capabilities : {};
	if (typeof caps.task === "string") return undefined;
	const limits = isRecord(meta.limits) ? meta.limits : {};
	const contextWindow = positive(limits.max_context_length) ?? positive(entry.max_model_len);
	if (contextWindow === undefined) return undefined;
	const pricing = isRecord(meta.pricing) && meta.pricing.pricing_tbd !== true ? meta.pricing : {};
	const displayName =
		typeof meta.display_name === "string" && meta.display_name !== "" ? meta.display_name : entry.id;

	const block = isRecord(meta.reasoning) ? meta.reasoning : undefined;
	const supported: unknown[] = block && Array.isArray(block.supported_efforts) ? block.supported_efforts : [];
	const efforts = EFFORT_ORDER.filter(effort => supported.includes(effort));
	const defaultLevel = efforts.find(effort => effort === block?.default_effort);
	const thinking =
		efforts.length > 0
			? {
					mode: "effort",
					efforts,
					requiresEffort: block?.mandatory === true,
					...(defaultLevel ? { defaultLevel } : {}),
				}
			: undefined;

	return {
		id: entry.id,
		name: meta.deprecated === true ? `${displayName} (deprecated)` : displayName,
		reasoning: block ? efforts.length > 0 : caps.reasoning === true,
		...(thinking ? { thinking: thinking as unknown as ProviderModelConfig["thinking"] } : {}),
		input: caps.vision === true ? ["text", "image"] : ["text"],
		cost: {
			input: price(pricing.input_per_million),
			output: price(pricing.output_per_million),
			cacheRead: price(pricing.cached_input_per_million),
			cacheWrite: 0,
		},
		contextWindow,
		maxTokens: positive(limits.max_output_tokens) ?? Math.min(DEFAULT_MAX_OUTPUT_TOKENS, contextWindow),
		compat: {
			thinkingFormat: "openai",
			supportsReasoningEffort: block !== undefined || caps.reasoning_effort === true,
			reasoningDisableMode: "none-effort",
			reasoningEffortMap: IDENTITY_EFFORT_MAP,
			supportsDeveloperRole: caps.developer_role === true,
			supportsStore: false,
		} as ProviderModelConfig["compat"],
	};
}

export function parseModelList(payload: unknown): ProviderModelConfig[] {
	if (!isRecord(payload) || !Array.isArray(payload.data)) {
		throw new Error("Neuralwatt /v1/models returned an unexpected payload");
	}
	const models: ProviderModelConfig[] = [];
	for (const entry of payload.data) {
		const model = toModelConfig(entry);
		if (model) models.push(model);
	}
	return models;
}

/** Throws on failure so omp keeps its cached catalog; an empty array would wipe it. */
export async function fetchNeuralwattModels(
	apiKey: string | undefined,
	fetchImpl: FetchLike = fetch,
): Promise<ProviderModelConfig[]> {
	const url = `${BASE_URL}/models`;
	const key = usableApiKey(apiKey);
	let response = await fetchImpl(url, key ? { headers: bearer(key) } : undefined);
	// A rejected key must not hide the public catalog.
	if (key && (response.status === 401 || response.status === 403)) response = await fetchImpl(url);
	if (!response.ok) throw new Error(`Neuralwatt model discovery failed: HTTP ${response.status}`);
	return parseModelList(await response.json());
}
