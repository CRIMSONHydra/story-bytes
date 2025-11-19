/**
 * Script to verify Gemini API credentials using the new @google/genai SDK.
 * Tests the API key by attempting to generate content with the Gemini model.
 */

import path from 'path';
import dotenv from 'dotenv';
import { GoogleGenAI } from '@google/genai';

// Ensure .env is loaded from the parent directory (project root)
dotenv.config({ path: path.resolve(process.cwd(), '../.env') });

/**
 * Verifies Gemini API key by attempting to generate content.
 * @returns true if verification succeeds, false otherwise
 */
const verifyGeminiNewSdk = async () => {
  console.log('Checking Gemini API Key with new SDK (@google/genai)...');
  const key = process.env.GEMINI_API_KEY;

  if (!key) {
    console.error('❌ GEMINI_API_KEY not found. Check your .env file.');
    return false;
  }

  try {
    const ai = new GoogleGenAI({ apiKey: key });

    console.log('   Trying gemini-2.5-flash...');
    try {
      const response = await ai.models.generateContent({
        model: 'gemini-2.5-flash',
        contents: 'Say Hello',
      });
      console.log(`   ✅ gemini-2.5-flash works! Response: ${response.text}`);
      return true;
    } catch (e: unknown) {
      const errorMessage = e instanceof Error ? e.message : 'Unknown error';
      console.log(`   ⚠️ gemini-2.5-flash failed: ${errorMessage}`);
      if (errorMessage.includes('404')) {
        console.log('      (Model not found or not available in your region)');
      }
    }

    return false;

  } catch (error: unknown) {
    const errorMessage = error instanceof Error ? error.message : 'Unknown error';
    console.error('❌ SDK Initialization failed:', errorMessage);
    return false;
  }
};

verifyGeminiNewSdk();
