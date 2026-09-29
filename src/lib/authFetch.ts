import { supabase } from './supabase';

export async function authFetch(
  input: RequestInfo | URL,
  init?: RequestInit
): Promise<Response> {
  const { data: { session } } = await supabase.auth.getSession();

  if (!session || !session.access_token) {
    throw new Error('Please log in again.');
  }

  const headers = new Headers(init?.headers);
  headers.set('Authorization', `Bearer ${session.access_token}`);

  const response = await fetch(input, {
    ...init,
    headers,
  });

  if (response.status === 401) {
    throw new Error('Your session expired. Please log in again.');
  }

  return response;
}
