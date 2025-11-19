import axios from 'axios';
import { env } from '../config/env';

interface SearchResult {
  title: string;
  link: string;
  snippet: string;
}

export const searchWeb = async (query: string): Promise<SearchResult[]> => {
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

    return (response.data.items || []).map((item: any) => ({
      title: item.title,
      link: item.link,
      snippet: item.snippet,
    }));
  } catch (error) {
    console.error('Web search failed:', error);
    return [];
  }
};
