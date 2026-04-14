/**
 * Azure AI Foundry configuration.
 *
 * Single model: GPT Realtime (speech-to-speech over WebSocket).
 * All config is read from VITE_ env vars so models can be swapped
 * without touching code.
 */

export interface AzureConfig {
  /** Azure OpenAI resource host (e.g. my-resource.openai.azure.com) */
  host: string;
  /** API key */
  apiKey: string;
  /** Realtime model deployment name */
  realtimeModel: string;
  /** Voice for audio output */
  realtimeVoice: string;
}

function env(key: string, fallback = ''): string {
  return (import.meta as any).env[key] ?? fallback;
}

function extractHost(endpoint: string): string {
  try {
    return new URL(endpoint).host;
  } catch {
    return endpoint;
  }
}

export const azureConfig: AzureConfig = {
  host: extractHost(env('VITE_AZURE_ENDPOINT')),
  apiKey: env('VITE_AZURE_API_KEY'),
  realtimeModel: env('VITE_AZURE_REALTIME_MODEL', 'gpt-4o-realtime-preview'),
  realtimeVoice: env('VITE_AZURE_REALTIME_VOICE', 'alloy'),
};
