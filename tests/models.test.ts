import { describe, expect, mock, test } from "bun:test";
import { fetchNeuralwattModels, parseModelList, toModelConfig } from "../src/models";

const BASE = {
	id: "qwen-3.8-27b",
	object: "model",
	max_model_len: 262128,
	metadata: {
		display_name: "Qwen 3.8 27B",
		pricing: { input_per_million: 0.45, output_per_million: 3.2, cached_input_per_million: 0.25, pricing_tbd: false },
		capabilities: { tools: true, vision: true, reasoning: true, reasoning_effort: true, developer_role: false },
		reasoning: {
			mandatory: false,
			default_enabled: true,
			supported_efforts: ["xhigh", "medium", "low", "none"],
			default_effort: "xhigh",
		},
		limits: { max_context_length: 262128, max_output_tokens: 131072 },
		deprecated: false,
	},
};

type Meta = typeof BASE.metadata;

function row(patch: { [K in keyof Meta]?: unknown } = {}, top: Record<string, unknown> = {}): Record<string, unknown> {
	return { ...BASE, ...top, metadata: { ...BASE.metadata, ...patch } };
}

function caps(extra: Record<string, unknown>): Record<string, unknown> {
	return { ...BASE.metadata.capabilities, ...extra };
}

describe("toModelConfig", () => {
	test("maps a full reasoning row", () => {
		expect(toModelConfig(BASE) as unknown).toEqual({
			id: "qwen-3.8-27b",
			name: "Qwen 3.8 27B",
			reasoning: true,
			thinking: { mode: "effort", efforts: ["low", "medium", "xhigh"], requiresEffort: false, defaultLevel: "xhigh" },
			input: ["text", "image"],
			cost: { input: 0.45, output: 3.2, cacheRead: 0.25, cacheWrite: 0 },
			contextWindow: 262128,
			maxTokens: 131072,
			compat: {
				thinkingFormat: "openai",
				supportsReasoningEffort: true,
				reasoningDisableMode: "none-effort",
				reasoningEffortMap: {
					minimal: "minimal",
					low: "low",
					medium: "medium",
					high: "high",
					xhigh: "xhigh",
					max: "max",
				},
				supportsDeveloperRole: false,
				supportsStore: false,
			},
		});
	});

	test("mandatory reasoning, text-only, no output cap", () => {
		const m = toModelConfig(
			row({
				reasoning: { mandatory: true, supported_efforts: ["max", "high", "low"], default_effort: "max" },
				capabilities: caps({ vision: false }),
				limits: { max_context_length: 1048560, max_output_tokens: null },
			}),
		)!;
		expect(m.thinking as unknown).toEqual({
			mode: "effort",
			efforts: ["low", "high", "max"],
			requiresEffort: true,
			defaultLevel: "max",
		});
		expect(m.input).toEqual(["text"]);
		expect(m.contextWindow).toBe(1048560);
		expect(m.maxTokens).toBe(65536);
	});

	test("pinned-off alias has no thinking", () => {
		const m = toModelConfig(
			row({
				reasoning: { mandatory: false, supported_efforts: ["none"], default_effort: "none" },
				capabilities: caps({ reasoning: false }),
			}),
		)!;
		expect(m.reasoning).toBe(false);
		expect("thinking" in m).toBe(false);
	});

	test("default effort 'none' omits defaultLevel", () => {
		const m = toModelConfig(
			row({ reasoning: { mandatory: false, supported_efforts: ["max", "none"], default_effort: "none" } }),
		)!;
		expect(m.thinking as unknown).toEqual({ mode: "effort", efforts: ["max"], requiresEffort: false });
	});

	test("no reasoning block follows capabilities", () => {
		const m = toModelConfig(
			row({ reasoning: null, capabilities: caps({ reasoning: true, reasoning_effort: false }) }),
		)!;
		expect(m.reasoning).toBe(true);
		expect("thinking" in m).toBe(false);
		expect(m.compat).toMatchObject({ supportsReasoningEffort: false });
	});

	test("skips task models", () => {
		expect(toModelConfig(row({ capabilities: caps({ task: "embed" }) }))).toBeUndefined();
	});

	test("context window falls back to max_model_len", () => {
		const limits = { max_context_length: null, max_output_tokens: null };
		const noLen = row({ limits });
		delete noLen.max_model_len;
		expect(toModelConfig(noLen)).toBeUndefined();
		const m = toModelConfig(row({ limits }, { max_model_len: 32768 }))!;
		expect(m.contextWindow).toBe(32768);
		expect(m.maxTokens).toBe(32768);
	});

	test("pricing_tbd zeroes cost; deprecated rows get a suffix", () => {
		const m = toModelConfig(row({ pricing: { ...BASE.metadata.pricing, pricing_tbd: true }, deprecated: true }))!;
		expect(m.cost).toEqual({ input: 0, output: 0, cacheRead: 0, cacheWrite: 0 });
		expect(m.name).toBe("Qwen 3.8 27B (deprecated)");
	});
});

describe("parseModelList", () => {
	test("drops unusable rows and rejects malformed payloads", () => {
		const embed = row({ capabilities: caps({ task: "embed" }) }, { id: "embed" });
		expect(parseModelList({ data: [BASE, embed, "junk"] })).toHaveLength(1);
		expect(() => parseModelList({})).toThrow();
	});
});

describe("fetchNeuralwattModels", () => {
	test("unset env-var name fetches the public catalog without auth", async () => {
		const fake = mock(async (_url: string, _init?: RequestInit) => Response.json({ data: [BASE] }));
		const models = await fetchNeuralwattModels("NEURALWATT_API_KEY", fake);
		expect(fake).toHaveBeenCalledTimes(1);
		expect(fake.mock.calls[0][1]).toBeUndefined();
		expect(models).toHaveLength(1);
	});

	test("rejected key falls back to the public catalog", async () => {
		let calls = 0;
		const fake = mock(async (_url: string, _init?: RequestInit) =>
			calls++ === 0 ? new Response(null, { status: 401 }) : Response.json({ data: [BASE] }),
		);
		const models = await fetchNeuralwattModels("sk-test", fake);
		expect(fake.mock.calls[0][1]).toEqual({ headers: { Authorization: "Bearer sk-test" } });
		expect(fake.mock.calls[1][1]).toBeUndefined();
		expect(models).toHaveLength(1);
	});

	test("HTTP failure throws", async () => {
		const fake = async () => new Response(null, { status: 503 });
		await expect(fetchNeuralwattModels(undefined, fake)).rejects.toThrow(
			"Neuralwatt model discovery failed: HTTP 503",
		);
	});
});
