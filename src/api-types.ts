export interface ApiHealth {
  ok: boolean;
  service: string;
  version: string;
  configured: boolean;
  ocrProvider: string;
  ocrModel: string;
  textProvider: string;
  textModel: string;
  providerOptions: ProviderOptions;
  kimiConfigured: boolean;
  kimiModel: string;
  kimiGenerationMode?: "light";
  kimiOcrModel?: string;
  ocrApiProvider?: string;
}

export interface ModelOption {
  value: string;
  label: string;
}

export interface ProviderOptions {
  [provider: string]: {
    analysis: ModelOption[];
    ocr: ModelOption[];
  };
}

export interface AiSettings {
  configured: boolean;
  ocrProvider: string;
  ocrModel: string;
  textProvider: string;
  textModel: string;
  kimi: { apiKey: boolean; baseUrl: string };
  zhipu: { apiKey: boolean; baseUrl: string };
  deepseek: { apiKey: boolean; baseUrl: string };
  providerOptions: ProviderOptions;
}

export interface KimiSettings {
  configured: boolean;
  model: string;
  ocrModel: string;
  baseUrl: string;
}
