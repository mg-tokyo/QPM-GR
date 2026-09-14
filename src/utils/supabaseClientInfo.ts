import { getCurrentVersion } from './versionChecker';

// Read back from Supabase API logs (Gemini-server `npm run usage`) to count tools/users.
// Header name is already allowlisted by the Supabase gateway and the edge-function CORS module.
export const SUPABASE_CLIENT_INFO_HEADER = 'x-client-info';

export function supabaseClientInfoHeaders(): Record<string, string> {
  return { [SUPABASE_CLIENT_INFO_HEADER]: `qpm-gr/${getCurrentVersion()}` };
}
