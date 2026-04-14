/**
 * Azure OpenAI Realtime API client.
 *
 * Manages a single WebSocket connection that handles:
 *   - Streaming microphone audio (PCM16 24 kHz) to the server
 *   - Playing back assistant audio from the server
 *   - Emitting transcript events for the UI
 *   - Server-side VAD (voice activity detection) for automatic turn-taking
 */
import { azureConfig } from './azureConfig';

const SAMPLE_RATE = 24000;
const BUFFER_SIZE = 4096;

// ---------------------------------------------------------------------------
// Callback interface
// ---------------------------------------------------------------------------

export interface RealtimeCallbacks {
  onUserTranscriptDone: (text: string) => void;
  onAssistantTranscriptDelta: (delta: string) => void;
  onAssistantTranscriptDone: (text: string) => void;
  onError: (error: string) => void;
  onStatusChange: (status: 'connecting' | 'connected' | 'disconnected') => void;
}

// ---------------------------------------------------------------------------
// RealtimeSession
// ---------------------------------------------------------------------------

export class RealtimeSession {
  private ws: WebSocket | null = null;

  // Capture
  private audioContext: AudioContext | null = null;
  private micStream: MediaStream | null = null;
  private sourceNode: MediaStreamAudioSourceNode | null = null;
  private processorNode: ScriptProcessorNode | null = null;
  private isMicActive = false;

  // Playback
  private playbackContext: AudioContext | null = null;
  private nextPlayTime = 0;

  constructor(private callbacks: RealtimeCallbacks) {}

  // -----------------------------------------------------------------------
  // Connect
  // -----------------------------------------------------------------------

  async connect(instructions: string): Promise<void> {
    const wsUrl =
      `wss://${azureConfig.host}/openai/realtime` +
      `?api-version=2025-04-01-preview` +
      `&deployment=${encodeURIComponent(azureConfig.realtimeModel)}` +
      `&api-key=${encodeURIComponent(azureConfig.apiKey)}`;

    this.callbacks.onStatusChange('connecting');

    return new Promise<void>((resolve, reject) => {
      this.ws = new WebSocket(wsUrl);

      this.ws.onopen = () => {
        this.callbacks.onStatusChange('connected');
        this.configureSession(instructions);
        resolve();
      };

      this.ws.onclose = () => {
        this.callbacks.onStatusChange('disconnected');
        this.cleanup();
      };

      this.ws.onerror = (ev) => {
        console.error('WebSocket error:', ev);
        this.callbacks.onError('WebSocket connection failed. Check your Azure endpoint and API key.');
        reject(new Error('WebSocket connection failed'));
      };

      this.ws.onmessage = (e) => {
        try {
          const msg = JSON.parse(e.data);
          if (msg.type === 'error') {
            console.error('Realtime API error:', msg.error);
          }
          this.handleMessage(msg);
        } catch {
          // ignore malformed messages
        }
      };
    });
  }

  // -----------------------------------------------------------------------
  // Session config
  // -----------------------------------------------------------------------

  private configureSession(instructions: string): void {
    this.send({
      type: 'session.update',
      session: {
        modalities: ['text', 'audio'],
        instructions,
        voice: azureConfig.realtimeVoice,
        input_audio_format: 'pcm16',
        output_audio_format: 'pcm16',
        input_audio_transcription: { model: 'whisper-1' },
        turn_detection: {
          type: 'server_vad',
          threshold: 0.5,
          prefix_padding_ms: 300,
          silence_duration_ms: 700,
        },
      },
    });
  }

  // -----------------------------------------------------------------------
  // Microphone capture → PCM16 → WebSocket
  // -----------------------------------------------------------------------

  async startMicrophone(): Promise<void> {
    if (!navigator.mediaDevices?.getUserMedia) {
      throw new Error(
        'Microphone access requires a secure context (HTTPS or localhost). ' +
        'Current origin: ' + location.origin,
      );
    }

    this.micStream = await navigator.mediaDevices.getUserMedia({
      audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true },
    });

    this.audioContext = new AudioContext({ sampleRate: SAMPLE_RATE });
    this.sourceNode = this.audioContext.createMediaStreamSource(this.micStream);
    this.processorNode = this.audioContext.createScriptProcessor(BUFFER_SIZE, 1, 1);

    this.processorNode.onaudioprocess = (e) => {
      if (!this.isMicActive) return;
      const float32 = e.inputBuffer.getChannelData(0);
      const base64 = this.float32ToPcm16Base64(float32);
      this.send({ type: 'input_audio_buffer.append', audio: base64 });
    };

    this.sourceNode.connect(this.processorNode);
    this.processorNode.connect(this.audioContext.destination); // output is silence

    this.isMicActive = true;

    // Playback context (same sample rate)
    this.playbackContext = new AudioContext({ sampleRate: SAMPLE_RATE });
    this.nextPlayTime = 0;
  }

  muteMicrophone(): void {
    this.isMicActive = false;
  }

  unmuteMicrophone(): void {
    this.isMicActive = true;
  }

  get muted(): boolean {
    return !this.isMicActive;
  }

  // -----------------------------------------------------------------------
  // Trigger the assistant to speak first
  // -----------------------------------------------------------------------

  triggerResponse(): void {
    // Add a hidden user message to prompt the model to begin
    this.send({
      type: 'conversation.item.create',
      item: {
        type: 'message',
        role: 'user',
        content: [{ type: 'input_text', text: 'Please begin the interview.' }],
      },
    });
    this.send({ type: 'response.create' });
  }

  // -----------------------------------------------------------------------
  // Disconnect
  // -----------------------------------------------------------------------

  disconnect(): void {
    this.ws?.close();
    this.cleanup();
  }

  private cleanup(): void {
    this.isMicActive = false;
    this.micStream?.getTracks().forEach((t) => t.stop());
    this.processorNode?.disconnect();
    this.sourceNode?.disconnect();
    this.audioContext?.close().catch(() => {});
    this.playbackContext?.close().catch(() => {});
    this.ws = null;
    this.micStream = null;
    this.audioContext = null;
    this.processorNode = null;
    this.sourceNode = null;
    this.playbackContext = null;
  }

  // -----------------------------------------------------------------------
  // Incoming message handler
  // -----------------------------------------------------------------------

  private handleMessage(msg: any): void {
    switch (msg.type) {
      case 'response.audio_transcript.delta':
        this.callbacks.onAssistantTranscriptDelta(msg.delta);
        break;

      case 'response.audio_transcript.done':
        this.callbacks.onAssistantTranscriptDone(msg.transcript);
        break;

      case 'conversation.item.input_audio_transcription.completed':
        if (msg.transcript) {
          this.callbacks.onUserTranscriptDone(msg.transcript);
        }
        break;

      case 'response.audio.delta':
        this.playAudioChunk(msg.delta);
        break;

      case 'error':
        this.callbacks.onError(msg.error?.message || 'Unknown realtime error');
        break;

      default:
        break;
    }
  }

  // -----------------------------------------------------------------------
  // Audio playback (queue PCM16 chunks)
  // -----------------------------------------------------------------------

  private playAudioChunk(base64Audio: string): void {
    if (!this.playbackContext) return;

    const int16 = this.base64ToInt16(base64Audio);
    const float32 = new Float32Array(int16.length);
    for (let i = 0; i < int16.length; i++) {
      float32[i] = int16[i] / (int16[i] < 0 ? 0x8000 : 0x7fff);
    }

    const buf = this.playbackContext.createBuffer(1, float32.length, SAMPLE_RATE);
    buf.getChannelData(0).set(float32);

    const source = this.playbackContext.createBufferSource();
    source.buffer = buf;
    source.connect(this.playbackContext.destination);

    const now = this.playbackContext.currentTime;
    const startTime = Math.max(now + 0.05, this.nextPlayTime);
    source.start(startTime);
    this.nextPlayTime = startTime + buf.duration;
  }

  // -----------------------------------------------------------------------
  // Helpers
  // -----------------------------------------------------------------------

  private send(data: unknown): void {
    if (this.ws?.readyState === WebSocket.OPEN) {
      this.ws.send(JSON.stringify(data));
    }
  }

  private float32ToPcm16Base64(float32: Float32Array): string {
    const int16 = new Int16Array(float32.length);
    for (let i = 0; i < float32.length; i++) {
      const s = Math.max(-1, Math.min(1, float32[i]));
      int16[i] = s < 0 ? s * 0x8000 : s * 0x7fff;
    }
    return this.arrayBufferToBase64(int16.buffer);
  }

  private arrayBufferToBase64(buffer: ArrayBuffer): string {
    const bytes = new Uint8Array(buffer);
    let binary = '';
    for (let i = 0; i < bytes.length; i++) {
      binary += String.fromCharCode(bytes[i]);
    }
    return btoa(binary);
  }

  private base64ToInt16(base64: string): Int16Array {
    const binary = atob(base64);
    const bytes = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i++) {
      bytes[i] = binary.charCodeAt(i);
    }
    return new Int16Array(bytes.buffer);
  }
}
