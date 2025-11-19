import path from 'path';
import dotenv from 'dotenv';
import { GoogleGenAI } from '@google/genai';

// Ensure .env is loaded from the parent directory
dotenv.config({ path: path.resolve(process.cwd(), '../.env') });

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
    } catch (e: any) {
      console.log(`   ⚠️ gemini-2.5-flash failed: ${e.message}`);
      if (e.message && e.message.includes('404')) {
        console.log('      (Model not found or not available in your region)');
      }
    }

    return false;

  } catch (error: any) {
    console.error('❌ SDK Initialization failed:', error.message);
    return false;
  }
};

verifyGeminiNewSdk();
