import type { ExtensionAPI } from "@oh-my-pi/pi-coding-agent";
import { API_KEY_ENV, BASE_URL, bearer, finite, isRecord, PROVIDER_ID, usableApiKey } from "./shared";

export const ENERGY_URL = `${BASE_URL}/usage/energy`;

/** Four decimals, or three significant digits below 0.001 kWh so small totals don't print as zero. */
function formatKwh(kwh: number): string {
	if (kwh <= 0 || kwh >= 0.001) return kwh.toFixed(4);
	return kwh.toFixed(Math.min(2 - Math.floor(Math.log10(kwh)), 20));
}

/** One-line summary of a `/v1/usage/energy` payload; `undefined` when it has no totals. */
export function formatEnergySummary(payload: unknown): string | undefined {
	if (!isRecord(payload) || !isRecord(payload.totals)) return undefined;
	const totals = payload.totals;
	const period = isRecord(payload.period) ? payload.period : {};
	const range =
		typeof period.start === "string" && typeof period.end === "string" ? ` ${period.start}..${period.end}` : "";
	const kwh = finite(totals.energy_kwh) ?? 0;
	const joules = finite(totals.energy_joules) ?? kwh * 3_600_000;
	const carbon = finite(totals.carbon_g_co2eq);
	return (
		`Neuralwatt energy${range}: ${finite(totals.requests) ?? 0} requests ` +
		`(${finite(totals.requests_with_energy) ?? 0} metered), ${formatKwh(kwh)} kWh (${Math.round(joules)} J)` +
		(carbon !== undefined ? `, ${carbon.toFixed(2)} g CO2e` : "")
	);
}

export function registerEnergyCommand(pi: ExtensionAPI): void {
	pi.registerCommand("neuralwatt-energy", {
		description: "Show Neuralwatt energy consumed over the last 30 days",
		handler: async (_args, ctx) => {
			const key = usableApiKey(await ctx.modelRegistry.getApiKeyForProvider(PROVIDER_ID));
			if (!key) {
				ctx.ui.notify(`Neuralwatt: no API key. Run /login ${PROVIDER_ID} or set ${API_KEY_ENV}.`, "warning");
				return;
			}
			try {
				const response = await fetch(ENERGY_URL, { headers: bearer(key) });
				if (!response.ok) {
					ctx.ui.notify(`Neuralwatt energy lookup failed: HTTP ${response.status}`, "error");
					return;
				}
				const summary = formatEnergySummary(await response.json());
				if (summary) ctx.ui.notify(summary, "info");
				else ctx.ui.notify("Neuralwatt energy lookup returned an unexpected payload", "error");
			} catch (error) {
				ctx.ui.notify(
					`Neuralwatt energy lookup failed: ${error instanceof Error ? error.message : String(error)}`,
					"error",
				);
			}
		},
	});
}
