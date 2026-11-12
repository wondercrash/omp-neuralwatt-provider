import {
	BASE_URL,
	bearer,
	type FetchLike,
	finite,
	isRecord,
	PORTAL_URL,
	PROVIDER_ID,
	type ProviderConfig,
	usableApiKey,
} from "./shared";

type LoginCallbacks = Parameters<NonNullable<ProviderConfig["oauth"]>["login"]>[0];
type UsageProvider = NonNullable<ProviderConfig["usage"]>;
type UsageReport = NonNullable<Awaited<ReturnType<UsageProvider["fetchUsage"]>>>;
type UsageLimit = UsageReport["limits"][number];
type UsageAmount = UsageLimit["amount"];

export const QUOTA_URL = `${BASE_URL}/quota`;

const PERIOD_LABELS: Record<string, string> = { daily: "Daily", weekly: "Weekly", monthly: "Monthly" };

/** Rejects only on 401; a rate-limited or unreachable quota endpoint keeps the key. */
export async function validateApiKey(apiKey: string, fetchImpl: FetchLike, signal?: AbortSignal): Promise<void> {
	let response: Response;
	try {
		response = await fetchImpl(QUOTA_URL, { headers: bearer(apiKey), signal });
	} catch (error) {
		if (signal?.aborted) throw error;
		return;
	}
	if (response.status === 401) {
		throw new Error(`Neuralwatt rejected the API key. Create one at ${PORTAL_URL} (Dashboard > API Keys).`);
	}
}

export async function login(callbacks: LoginCallbacks): Promise<string> {
	callbacks.onAuth({ url: PORTAL_URL, instructions: "Create or copy an API key under Dashboard > API Keys" });
	const key = (await callbacks.onPrompt({ message: "Paste your Neuralwatt API key", placeholder: "sk-..." })).trim();
	if (callbacks.signal?.aborted) throw new Error("Neuralwatt login cancelled");
	if (!key) throw new Error("Neuralwatt API key is required");
	callbacks.onProgress?.("Validating API key...");
	await validateApiKey(key, callbacks.fetch ?? fetch, callbacks.signal);
	return key;
}

function usageStatus(usedFraction: number | undefined): UsageLimit["status"] {
	if (usedFraction === undefined) return "unknown";
	if (usedFraction >= 1) return "exhausted";
	return usedFraction >= 0.9 ? "warning" : "ok";
}

function usageAmount(
	used: number | undefined,
	limit: number,
	remaining: number | undefined,
	unit: UsageAmount["unit"],
): UsageAmount {
	const usedValue = used ?? (remaining !== undefined ? limit - remaining : undefined);
	const usedFraction = usedValue !== undefined ? Math.min(Math.max(usedValue / limit, 0), 1) : undefined;
	return {
		...(usedValue !== undefined ? { used: usedValue } : {}),
		limit,
		...(remaining !== undefined ? { remaining } : {}),
		...(usedFraction !== undefined ? { usedFraction, remainingFraction: 1 - usedFraction } : {}),
		unit,
	};
}

/** Maps a `/v1/quota` payload; `null` when it carries no limit worth showing. */
export function quotaToReport(payload: unknown, now: number): UsageReport | null {
	if (!isRecord(payload)) return null;
	const scope = { provider: PROVIDER_ID };
	const limits: UsageLimit[] = [];

	const balance = isRecord(payload.balance) ? payload.balance : undefined;
	const totalCredits = finite(balance?.total_credits_usd);
	if (balance && totalCredits !== undefined && totalCredits > 0) {
		const amount = usageAmount(
			finite(balance.credits_used_usd),
			totalCredits,
			finite(balance.credits_remaining_usd),
			"usd",
		);
		limits.push({
			id: "neuralwatt:credits",
			label: "Neuralwatt Credits",
			scope,
			amount,
			status: usageStatus(amount.usedFraction),
		});
	}

	const subscription = isRecord(payload.subscription) ? payload.subscription : undefined;
	const includedKwh = finite(subscription?.kwh_included);
	if (subscription && includedKwh !== undefined && includedKwh > 0) {
		const kwh = usageAmount(finite(subscription.kwh_used), includedKwh, finite(subscription.kwh_remaining), "unknown");
		if (kwh.used !== undefined && kwh.usedFraction !== undefined) {
			const resetsAt =
				typeof subscription.current_period_end === "string"
					? Date.parse(subscription.current_period_end)
					: Number.NaN;
			const plan = typeof subscription.plan === "string" && subscription.plan !== "" ? ` (${subscription.plan})` : "";
			limits.push({
				id: "neuralwatt:energy",
				label: `Neuralwatt Energy${plan}`,
				scope,
				window: {
					id: "billing-period",
					label: subscription.billing_interval === "year" ? "Yearly" : "Monthly",
					...(Number.isFinite(resetsAt) ? { resetsAt } : {}),
				},
				// omp has no kWh unit; report percent and carry kWh in the note.
				amount: {
					used: kwh.usedFraction * 100,
					limit: 100,
					remaining: (1 - kwh.usedFraction) * 100,
					usedFraction: kwh.usedFraction,
					remainingFraction: 1 - kwh.usedFraction,
					unit: "percent",
				},
				status: subscription.in_overage === true ? "exhausted" : usageStatus(kwh.usedFraction),
				notes: [`${kwh.used.toFixed(2)} / ${includedKwh.toFixed(2)} kWh charged`],
			});
		}
	}

	const key = isRecord(payload.key) ? payload.key : undefined;
	const allowance = key && isRecord(key.allowance) ? key.allowance : undefined;
	const allowanceLimit = finite(allowance?.limit_usd);
	if (allowance && allowanceLimit !== undefined && allowanceLimit > 0) {
		const amount = usageAmount(finite(allowance.spent_usd), allowanceLimit, finite(allowance.remaining_usd), "usd");
		const period = typeof allowance.period === "string" && allowance.period !== "" ? allowance.period : "period";
		limits.push({
			id: "neuralwatt:key-allowance",
			label: "Neuralwatt Key Allowance",
			scope,
			window: { id: period, label: PERIOD_LABELS[period] ?? period },
			amount,
			status: allowance.blocked === true ? "exhausted" : usageStatus(amount.usedFraction),
		});
	}

	if (limits.length === 0) return null;
	return { provider: PROVIDER_ID, fetchedAt: now, limits, metadata: { endpoint: QUOTA_URL } };
}

export const usageProvider: UsageProvider = {
	id: PROVIDER_ID,
	supports: params => params.provider === PROVIDER_ID && params.credential.type === "api_key",
	async fetchUsage(params, ctx) {
		const key = usableApiKey(params.credential.apiKey);
		if (!key) return null;
		try {
			const response = await ctx.fetch(QUOTA_URL, { headers: bearer(key), signal: params.signal });
			if (!response.ok) {
				ctx.logger?.warn("Neuralwatt usage fetch failed", { status: response.status });
				return null;
			}
			return quotaToReport(await response.json(), Date.now());
		} catch (error) {
			ctx.logger?.warn("Neuralwatt usage fetch error", { error: String(error) });
			return null;
		}
	},
};
