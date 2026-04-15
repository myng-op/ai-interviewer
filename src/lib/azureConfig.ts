/**
 * Azure AI Foundry configuration — browser-side only.
 *
 * The API key, endpoint, and model are NOT exposed here; they live in .env
 * and are read server-side only. The browser only needs the voice preference.
 */

export interface AzureConfig {
  /** Voice for audio output (e.g. "alloy", "nova") */
  realtimeVoice: string;
}

function env(key: string, fallback = ''): string {
  return (import.meta as any).env[key] ?? fallback;
}

export const azureConfig: AzureConfig = {
  realtimeVoice: env('VITE_AZURE_REALTIME_VOICE', 'alloy'),
};