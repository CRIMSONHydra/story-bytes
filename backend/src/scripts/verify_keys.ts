/**
 * Script to verify Google Search API credentials.
 * Tests the API key and Custom Search Engine ID (CX) by making a test request.
 */

import path from 'path';
import dotenv from 'dotenv';
import axios from 'axios';

// Ensure .env is loaded from the parent directory (project root)
dotenv.config({ path: path.resolve(process.cwd(), '../.env') });

/**
 * Verifies Google Search API key and CX by making a test search request.
 * @returns true if verification succeeds, false otherwise
 */
const verifySearch = async () => {
  console.log('\nChecking Google Search API Key & CX...');
  const key = process.env.GOOGLE_SEARCH_API_KEY;
  const cx = process.env.GOOGLE_CX;

  if (!key) {
    console.error('❌ GOOGLE_SEARCH_API_KEY not found in environment.');
    return false;
  }
  if (!cx) {
    console.error('❌ GOOGLE_CX not found in environment.');
    return false;
  }

  try {
    const response = await axios.get('https://www.googleapis.com/customsearch/v1', {
      params: {
        key,
        cx,
        q: 'test',
      },
    });

    if (response.status === 200) {
      console.log('✅ Google Search API Key & CX work!');
      return true;
    } else {
      console.error(`❌ Google Search failed with status: ${response.status}`);
      return false;
    }
  } catch (error: unknown) {
    const errorMessage = error instanceof Error ? error.message : 'Unknown error';
    console.error('❌ Google Search API Key failed:', errorMessage);
    if (error && typeof error === 'object' && 'response' in error) {
      const axiosError = error as { response?: { data?: unknown } };
      if (axiosError.response?.data) {
        console.error('   Details:', JSON.stringify(axiosError.response.data, null, 2));
      }
    }
    return false;
  }
};

/**
 * Main execution function.
 * Runs all verification checks and exits with appropriate status code.
 */
const run = async () => {
  const searchOk = await verifySearch();

  if (searchOk) {
    console.log('\n🎉 All keys verified successfully!');
    process.exit(0);
  } else {
    console.error('\n⚠️ Some keys failed verification.');
    process.exit(1);
  }
};

// Execute verification
run();
