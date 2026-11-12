import type { ExtensionAPI } from "@oh-my-pi/pi-coding-agent";
import { fetchNeuralwattModels } from "./models";
import { API_KEY_ENV, BASE_URL, PROVIDER_ID } from "./shared";

export default function neuralwatt(pi: ExtensionAPI): void {
	pi.registerProvider(PROVIDER_ID, {
		baseUrl: BASE_URL,
		apiKey: API_KEY_ENV,
		api: "openai-completions",
		fetchDynamicModels: apiKey => fetchNeuralwattModels(apiKey),
	});
}
