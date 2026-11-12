import { describe, expect, test } from "bun:test";
import { formatEnergySummary } from "../src/energy";

const TOTALS = { requests: 1523, requests_with_energy: 1520, energy_kwh: 0.0234, energy_joules: 84240 };

describe("formatEnergySummary", () => {
	test("full payload", () => {
		expect(
			formatEnergySummary({
				period: { start: "2024-11-01", end: "2024-11-30" },
				totals: { ...TOTALS, carbon_g_co2eq: 3.7521 },
			}),
		).toBe(
			"Neuralwatt energy 2024-11-01..2024-11-30: 1523 requests (1520 metered), 0.0234 kWh (84240 J), 3.75 g CO2e",
		);
	});

	test("without period and carbon", () => {
		expect(formatEnergySummary({ totals: TOTALS })).toBe(
			"Neuralwatt energy: 1523 requests (1520 metered), 0.0234 kWh (84240 J)",
		);
	});

	test("small totals keep three significant digits", () => {
		expect(
			formatEnergySummary({ totals: { requests: 2, requests_with_energy: 2, energy_kwh: 0.0000489, energy_joules: 176 } }),
		).toBe("Neuralwatt energy: 2 requests (2 metered), 0.0000489 kWh (176 J)");
		expect(formatEnergySummary({ totals: { requests: 0, energy_kwh: 0 } })).toBe(
			"Neuralwatt energy: 0 requests (0 metered), 0.0000 kWh (0 J)",
		);
	});

	test("no totals", () => {
		expect(formatEnergySummary({})).toBeUndefined();
	});
});
