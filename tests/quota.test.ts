import { describe, expect, mock, test } from "bun:test";
import { quotaToReport, usageProvider, validateApiKey } from "../src/quota";

const DOCS = {
	balance: { credits_remaining_usd: 32.6774, total_credits_usd: 52.34, credits_used_usd: 19.6626 },
	subscription: {
		plan: "standard",
		billing_interval: "month",
		current_period_end: "2026-05-11T05:05:25Z",
		kwh_included: 20.0,
		kwh_used: 13.9023,
		kwh_remaining: 6.0977,
		in_overage: false,
	},
	key: { name: "k", allowance: null },
};

describe("quotaToReport", () => {
	test("maps credits and subscription energy", () => {
		const report = quotaToReport(DOCS, 1000)!;
		expect(report.fetchedAt).toBe(1000);
		expect(report.limits.map(limit => limit.id)).toEqual(["neuralwatt:credits", "neuralwatt:energy"]);
		const [credits, energy] = report.limits;
		expect(credits.amount).toMatchObject({ used: 19.6626, limit: 52.34, remaining: 32.6774, unit: "usd" });
		expect(credits.status).toBe("ok");
		expect(energy.label).toBe("Neuralwatt Energy (standard)");
		expect(energy.amount.unit).toBe("percent");
		expect(energy.amount.usedFraction).toBeCloseTo(0.695115, 5);
		expect(energy.window?.resetsAt).toBe(Date.parse("2026-05-11T05:05:25Z"));
		expect(energy.notes).toEqual(["13.90 / 20.00 kWh charged"]);
	});

	test("blocked key allowance is the only limit when credits are zero", () => {
		const report = quotaToReport(
			{
				balance: { credits_remaining_usd: 0, total_credits_usd: 0, credits_used_usd: 0 },
				subscription: null,
				key: { allowance: { limit_usd: 10, period: "daily", spent_usd: 10, remaining_usd: 0, blocked: true } },
			},
			0,
		)!;
		expect(report.limits).toHaveLength(1);
		const [allowance] = report.limits;
		expect(allowance.id).toBe("neuralwatt:key-allowance");
		expect(allowance.status).toBe("exhausted");
		expect(allowance.window).toEqual({ id: "daily", label: "Daily" });
	});

	test("payloads without limits yield null", () => {
		expect(quotaToReport({}, 0)).toBeNull();
		expect(quotaToReport("x", 0)).toBeNull();
	});
});

describe("validateApiKey", () => {
	const respond = (status: number) => async () => new Response(null, { status });

	test("401 rejects the key", async () => {
		await expect(validateApiKey("sk-x", respond(401))).rejects.toThrow(/rejected the API key/);
	});

	test("rate limit and network errors keep the key", async () => {
		await expect(validateApiKey("sk-x", respond(429))).resolves.toBeUndefined();
		const offline = async (): Promise<Response> => {
			throw new TypeError("fetch failed");
		};
		await expect(validateApiKey("sk-x", offline)).resolves.toBeUndefined();
	});

	test("aborted login propagates the fetch error", async () => {
		const controller = new AbortController();
		controller.abort();
		const aborted = async (): Promise<Response> => {
			throw new DOMException("aborted", "AbortError");
		};
		await expect(validateApiKey("sk-x", aborted, controller.signal)).rejects.toThrow();
	});
});

describe("usageProvider", () => {
	test("unset env-var name skips the request", async () => {
		const fake = mock(async () => Response.json(DOCS));
		const params = { provider: "neuralwatt", credential: { type: "api_key", apiKey: "NEURALWATT_API_KEY" } };
		const result = await usageProvider.fetchUsage(params as never, { fetch: fake } as never);
		expect(result).toBeNull();
		expect(fake).not.toHaveBeenCalled();
	});
});
