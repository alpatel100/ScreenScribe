import { GoogleGenAI } from "@google/genai";

// FIX: Per coding guidelines, the API key is retrieved directly from the environment variable, assuming it is always available.
const ai = new GoogleGenAI({ apiKey: process.env.API_KEY });

/**
 * Transcribes text from a base64 encoded image.
 * @param base64ImageData The base64 encoded image data, without the data URL prefix.
 * @returns A promise that resolves to the transcribed text.
 */
export const transcribeImage = async (base64ImageData: string): Promise<string> => {
  try {
    const imagePart = {
      inlineData: {
        mimeType: 'image/png',
        data: base64ImageData,
      },
    };

    const textPart = {
      text: 'Transcribe all the text from this image. Be as accurate as possible. Do not include any formatting like markdown.'
    };
    
    const response = await ai.models.generateContent({
      model: 'gemini-2.5-flash',
      contents: [{ parts: [imagePart, textPart] }],
    });

    const text = response.text;
    if (!text) {
        return "No text found in the image.";
    }
    return text.trim();
  } catch (error) {
    console.error("Error calling Gemini API:", error);
    throw new Error("Failed to get transcription from AI service.");
  }
};