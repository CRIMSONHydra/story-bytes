/**
 * Web search service using Google Custom Search API.
 * Provides functionality to search the web for additional context.
 */

import axios from 'axios';
import { env } from '../config/env';

/**
 * Represents a single search result from Google Custom Search.
 */
interface SearchResult {
  title: string;
  link: string;
  snippet: string;
}

/**
 * Searches the web using Google Custom Search API.
 * 
 * @param query - The search query string
 * @returns Promise resolving to an array of search results
 * 
 * @remarks
 * - Returns empty array if API keys are not configured
 * - Returns empty array on error to prevent breaking calling code
 * - Requires GOOGLE_SEARCH_API_KEY and GOOGLE_CX environment variables
 */
export const searchWeb = async (query: string): Promise<SearchResult[]> => {
  // Check if required API credentials are configured
  if (!env.googleSearchApiKey || !env.googleCx) {
    console.warn('Google Search API key or CX not configured.');
    return [];
  }

  try {
    const response = await axios.get('https://www.googleapis.com/customsearch/v1', {
      params: {
        key: env.googleSearchApiKey,
        cx: env.googleCx,
        q: query,
      },
    });

    // Type definition for Google Search API response items
    interface GoogleSearchItem {
      title: string;
      link: string;
      snippet: string;
    }

    // Map API response items to our SearchResult interface
    return (response.data.items || []).map((item: GoogleSearchItem) => ({
      title: item.title,
      link: item.link,
      snippet: item.snippet,
    }));
  } catch (error) {
    console.error('Web search failed:', error);
    // Return empty array on error to prevent breaking the calling code
    return [];
  }
};
