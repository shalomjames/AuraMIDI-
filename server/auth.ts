import { Request, Response, NextFunction } from 'express';
import { createClient, SupabaseClient } from '@supabase/supabase-js';

let supabaseClient: SupabaseClient | null = null;

export function getSupabaseAdmin(): SupabaseClient | null {
  if (supabaseClient) {
    return supabaseClient;
  }

  const supabaseUrl = process.env.SUPABASE_URL;
  const supabaseSecretKey = process.env.SUPABASE_SECRET_KEY;

  if (!supabaseUrl || !supabaseSecretKey) {
    console.error(
      '[Server:Auth] Missing SUPABASE_URL or SUPABASE_SECRET_KEY environment variable. Cannot authenticate incoming requests.'
    );
    return null;
  }

  supabaseClient = createClient(supabaseUrl, supabaseSecretKey, {
    auth: {
      persistSession: false,
      autoRefreshToken: false,
    },
  });

  return supabaseClient;
}

export async function requireUser(req: Request, res: Response, next: NextFunction): Promise<void> {
  const supabase = getSupabaseAdmin();
  if (!supabase) {
    res.status(503).json({
      success: false,
      error: 'Sign-in is temporarily unavailable.',
    });
    return;
  }

  const authHeader = req.headers.authorization;
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    res.status(401).json({
      success: false,
      error: 'Please sign in again.',
    });
    return;
  }

  const token = authHeader.slice(7).trim();
  if (!token) {
    res.status(401).json({
      success: false,
      error: 'Please sign in again.',
    });
    return;
  }

  try {
    const { data: { user }, error } = await supabase.auth.getUser(token);

    if (error || !user) {
      res.status(401).json({
        success: false,
        error: 'Please sign in again.',
      });
      return;
    }

    res.locals.user = user;
    next();
  } catch (_err) {
    res.status(401).json({
      success: false,
      error: 'Please sign in again.',
    });
  }
}
