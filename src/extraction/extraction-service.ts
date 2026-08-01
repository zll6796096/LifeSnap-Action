import {
  geminiResponseSchema,
  GEMINI_EXTRACTION_PROMPT,
  validateGeminiExtraction,
} from "../shared/gemini-schema";
import { createPublicHttpError } from "../shared/http-error";

export type ImageInput = {
  buffer: Buffer;
  mimeType: string;
};

export interface ExtractionService {
  extract(
    image: ImageInput,
  ): Promise<ReturnType<typeof validateGeminiExtraction>>;
}

export type GeminiClient = {
  models: {
    generateContent: (request: unknown) => Promise<{ text?: string }>;
  };
};

export type GeminiClientFactory = (apiKey: string) => GeminiClient;

export function createGeminiExtractionService(options: {
  apiKey: string;
  model: string;
  createClient: GeminiClientFactory;
}): ExtractionService {
  return {
    async extract(image) {
      const client = options.createClient(options.apiKey);
      const response = await client.models.generateContent({
        model: options.model,
        contents: [
          {
            inlineData: {
              mimeType: image.mimeType,
              data: image.buffer.toString("base64"),
            },
          },
          {
            text: GEMINI_EXTRACTION_PROMPT,
          },
        ],
        config: {
          responseMimeType: "application/json",
          responseSchema: geminiResponseSchema,
        },
      });

      if (!response.text) {
        throw createPublicHttpError("AI_EMPTY_RESPONSE");
      }

      return validateGeminiExtraction(JSON.parse(response.text));
    },
  };
}
