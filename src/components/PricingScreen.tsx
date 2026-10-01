import React, { useState, useEffect, useCallback } from 'react';
import { X, Sparkles, RotateCcw, RefreshCw, ExternalLink } from 'lucide-react';
import { supabase } from '../lib/supabase';

export interface BillingPlan {
  tier: string;
  name: string;
  price_cents: number;
  monthly_credits: number;
  sort_order: number;
  active: boolean;
}

interface PricingScreenProps {
  isOpen: boolean;
  onClose: () => void;
  onRefreshCredits?: () => Promise<void> | void;
  creditBalance?: number | null;
}

export const PricingScreen: React.FC<PricingScreenProps> = ({
  isOpen,
  onClose,
  onRefreshCredits,
  creditBalance,
}) => {
  const [plans, setPlans] = useState<BillingPlan[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // Checkout states
  const [checkoutTier, setCheckoutTier] = useState<string | null>(null);
  const [checkoutError, setCheckoutError] = useState<string | null>(null);
  const [fallbackCheckoutUrl, setFallbackCheckoutUrl] = useState<string | null>(null);
  const [isRefreshingCredits, setIsRefreshingCredits] = useState(false);

  const fetchPlans = useCallback(async () => {
    setIsLoading(true);
    setError(null);

    try {
      const { data, error: fetchErr } = await supabase
        .from('billing_plans')
        .select('tier, name, price_cents, monthly_credits, sort_order, active')
        .eq('active', true)
        .order('sort_order', { ascending: true });

      if (fetchErr) {
        throw fetchErr;
      }

      setPlans(data || []);
    } catch (err: any) {
      console.error('[PricingScreen] Failed to load billing plans:', err?.message);
      setError("We couldn't load the plans.");
    } finally {
      setIsLoading(false);
    }
  }, []);

  useEffect(() => {
    if (isOpen) {
      fetchPlans();
      setCheckoutError(null);
      setFallbackCheckoutUrl(null);
    }
  }, [isOpen, fetchPlans]);

  // Lock background scroll when modal is open
  useEffect(() => {
    if (isOpen) {
      document.body.style.overflow = 'hidden';
    } else {
      document.body.style.overflow = '';
    }
    return () => {
      document.body.style.overflow = '';
    };
  }, [isOpen]);

  // Reload balance when page becomes visible again while modal is open
  useEffect(() => {
    if (!isOpen || !onRefreshCredits) return;

    const handleVisibilityChange = () => {
      if (document.visibilityState === 'visible') {
        onRefreshCredits();
      }
    };

    document.addEventListener('visibilitychange', handleVisibilityChange);
    return () => {
      document.removeEventListener('visibilitychange', handleVisibilityChange);
    };
  }, [isOpen, onRefreshCredits]);

  const handleRefreshCredits = async () => {
    if (isRefreshingCredits || !onRefreshCredits) return;
    setIsRefreshingCredits(true);
    try {
      await onRefreshCredits();
    } finally {
      setTimeout(() => {
        setIsRefreshingCredits(false);
      }, 500);
    }
  };

  const handleChoosePlan = async (tier: string) => {
    if (checkoutTier) return;

    setCheckoutError(null);
    setFallbackCheckoutUrl(null);
    setCheckoutTier(tier);

    // 1. FIRST call window.open('', '_blank') synchronously to avoid popup blockers
    let newTab: Window | null = null;
    try {
      newTab = window.open('', '_blank');
    } catch (err) {
      console.warn('[PricingScreen] Synchronous window.open failed:', err);
    }

    try {
      // Retrieve session token to attach Authorization header if available
      let sessionToken: string | undefined;
      try {
        const { data: sessionData } = await supabase.auth.getSession();
        sessionToken = sessionData?.session?.access_token;
      } catch (_) {}

      const customHeaders: Record<string, string> = {};
      if (sessionToken) {
        customHeaders.Authorization = `Bearer ${sessionToken}`;
      }

      let checkoutUrl: string | null = null;

      // 2. Call Edge Function with supabase.functions.invoke
      const { data, error: fnErr } = await supabase.functions.invoke('create-checkout', {
        body: { tier },
        headers: customHeaders,
      });

      if (!fnErr && data) {
        if (typeof data.url === 'string' && data.url.startsWith('https://')) {
          checkoutUrl = data.url;
        } else if (typeof data.session_id === 'string' && data.session_id.length > 0) {
          checkoutUrl = `https://checkout.stripe.com/c/pay/${data.session_id}`;
        }
      }

      // If invoke failed or returned no url, attempt direct fetch with standard headers
      if (!checkoutUrl) {
        try {
          const supabaseUrl = import.meta.env.VITE_SUPABASE_URL;
          const supabaseKey = import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY;
          if (supabaseUrl && supabaseKey) {
            const reqHeaders: Record<string, string> = {
              'Content-Type': 'application/json',
              'apikey': supabaseKey,
            };
            if (sessionToken) {
              reqHeaders.Authorization = `Bearer ${sessionToken}`;
            }

            const res = await fetch(`${supabaseUrl}/functions/v1/create-checkout`, {
              method: 'POST',
              headers: reqHeaders,
              body: JSON.stringify({ tier }),
            });

            if (res.ok) {
              const directData = await res.json();
              if (typeof directData?.url === 'string' && directData.url.startsWith('https://')) {
                checkoutUrl = directData.url;
              } else if (typeof directData?.session_id === 'string' && directData.session_id.length > 0) {
                checkoutUrl = `https://checkout.stripe.com/c/pay/${directData.session_id}`;
              }
            }
          }
        } catch (_) {}
      }

      // 3. If checkoutUrl is valid https link
      if (checkoutUrl && checkoutUrl.startsWith('https://')) {
        if (newTab && !newTab.closed) {
          newTab.location.href = checkoutUrl;
        } else {
          setFallbackCheckoutUrl(checkoutUrl);
        }
      } else {
        // Any error, or a response with no url: close the new tab and show friendly message
        if (newTab && !newTab.closed) {
          try {
            newTab.close();
          } catch (_) {}
        }
        setCheckoutError("Checkout isn't available right now. Please try again later.");
      }
    } catch (_) {
      // Close new tab if opened and show friendly error
      if (newTab && !newTab.closed) {
        try {
          newTab.close();
        } catch (_) {}
      }
      setCheckoutError("Checkout isn't available right now. Please try again later.");
    } finally {
      setCheckoutTier(null);
    }
  };

  if (!isOpen) return null;

  const formatPrice = (priceCents: number): string => {
    const dollars = priceCents / 100;
    const formatted = dollars % 1 === 0 ? dollars.toString() : dollars.toFixed(2);
    return `$${formatted}/month`;
  };

  return (
    <div className="fixed inset-0 z-50 bg-[#09090b]/95 backdrop-blur-md overflow-y-auto flex flex-col p-4 sm:p-6 md:p-8 animate-fadeIn">
      {/* Top Header with Close Button */}
      <div className="max-w-4xl w-full mx-auto flex items-center justify-between pb-6 border-b border-white/[0.06]">
        <div className="flex items-center gap-2.5">
          <Sparkles className="w-5 h-5 text-[#c5a059]" />
          <h2 className="font-editorial text-xl sm:text-2xl text-[#f5f2ec] font-normal tracking-wide">
            Get Audio Transcription Credits
          </h2>
        </div>
        <button
          type="button"
          onClick={onClose}
          className="min-h-[44px] min-w-[44px] p-2 text-[#858076] hover:text-[#f5f2ec] hover:bg-white/[0.05] rounded-md transition-colors cursor-pointer flex items-center justify-center"
          aria-label="Close pricing screen"
        >
          <X className="w-5 h-5" />
        </button>
      </div>

      {/* Main Content Area */}
      <div className="max-w-4xl w-full mx-auto flex-1 flex flex-col justify-center py-8">
        {isLoading ? (
          /* Loading Skeleton */
          <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
            {[1, 2, 3].map((i) => (
              <div
                key={i}
                className="bg-[#111114] border border-white/[0.06] rounded-xl p-6 flex flex-col gap-4 animate-pulse"
              >
                <div className="h-6 bg-white/[0.06] rounded w-24" />
                <div className="h-8 bg-white/[0.08] rounded w-32" />
                <div className="h-4 bg-white/[0.04] rounded w-40" />
                <div className="h-4 bg-white/[0.04] rounded w-36" />
                <div className="h-11 bg-white/[0.06] rounded w-full mt-4" />
              </div>
            ))}
          </div>
        ) : error ? (
          /* Friendly Error State with Retry */
          <div className="py-12 flex flex-col items-center justify-center gap-4 text-center">
            <p className="text-sm sm:text-base text-[#d8a8ad] font-sans">
              {error}
            </p>
            <button
              type="button"
              onClick={fetchPlans}
              className="min-h-[44px] px-5 py-2.5 bg-[#1a1a22] hover:bg-[#252532] border border-white/[0.1] text-[#ede8df] hover:text-[#f5f2ec] text-xs font-sans rounded-md transition-all cursor-pointer flex items-center gap-2"
            >
              <RotateCcw className="w-3.5 h-3.5 text-[#c5a059]" />
              <span>Retry</span>
            </button>
          </div>
        ) : (
          /* Plans Grid & Checkout Controls */
          <div className="flex flex-col gap-6">
            {/* Friendly Checkout Error Banner */}
            {checkoutError && (
              <div className="p-4 bg-[#1c1214] border border-[#6b2930] rounded-lg text-center animate-fadeIn">
                <p className="text-xs sm:text-sm text-[#f5d6d8] font-sans">
                  {checkoutError}
                </p>
              </div>
            )}

            {/* Fallback Checkout Link if Popup Blocked */}
            {fallbackCheckoutUrl && (
              <div className="p-4 bg-[#141418] border border-[#c5a059]/40 rounded-lg flex flex-col sm:flex-row items-center justify-between gap-3 text-center sm:text-left animate-fadeIn">
                <div className="flex flex-col gap-0.5">
                  <span className="text-xs font-medium text-[#f5f2ec]">New tab was blocked</span>
                  <span className="text-xs text-[#858076]">Tap below to proceed directly to the secure checkout page.</span>
                </div>
                <a
                  href={fallbackCheckoutUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="min-h-[44px] px-5 py-2.5 bg-[#c5a059] hover:bg-[#d8ba7f] text-[#09090b] font-sans font-semibold text-xs rounded-md flex items-center justify-center gap-2 shadow shrink-0"
                >
                  <span>Open checkout</span>
                  <ExternalLink className="w-4 h-4" />
                </a>
              </div>
            )}

            <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
              {plans.map((plan) => {
                const isPopular = plan.tier === 'plus';
                const isThisLoading = checkoutTier === plan.tier;
                const isAnyLoading = Boolean(checkoutTier);

                return (
                  <div
                    key={plan.tier}
                    className={`relative bg-[#111114] rounded-xl p-6 flex flex-col justify-between gap-6 transition-all ${
                      isPopular
                        ? 'border-2 border-[#c5a059] shadow-[0_0_25px_rgba(197,160,89,0.15)] bg-[#141418]'
                        : 'border border-white/[0.08] hover:border-white/[0.15]'
                    }`}
                  >
                    {isPopular && (
                      <div className="absolute -top-3 left-1/2 -translate-x-1/2">
                        <span className="px-2.5 py-0.5 rounded-full text-[10px] font-sans font-semibold uppercase tracking-wider bg-[#c5a059] text-[#09090b] shadow">
                          Most popular
                        </span>
                      </div>
                    )}

                    <div className="flex flex-col gap-3">
                      <h3 className="font-editorial text-2xl text-[#f5f2ec] font-normal">
                        {plan.name}
                      </h3>
                      <div className="flex items-baseline gap-1">
                        <span className="text-3xl font-tabular font-bold text-[#f5f2ec]">
                          {formatPrice(plan.price_cents)}
                        </span>
                      </div>
                      <div className="flex flex-col gap-1.5 pt-2 border-t border-white/[0.06] text-xs font-sans text-[#c9c4b9]">
                        <span className="font-medium text-[#ede8df]">
                          {plan.monthly_credits.toLocaleString()} credits per month
                        </span>
                        <span className="text-[#858076]">
                          About {Math.floor(plan.monthly_credits / 60)} minutes of audio
                        </span>
                      </div>
                    </div>

                    {/* Choose Plan Button (min-h-[44px]) */}
                    <button
                      type="button"
                      onClick={() => handleChoosePlan(plan.tier)}
                      disabled={isAnyLoading}
                      className={`min-h-[44px] w-full px-4 py-2.5 rounded-md text-xs font-sans font-semibold transition-all cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed flex items-center justify-center gap-2 ${
                        isPopular
                          ? 'bg-[#c5a059] hover:bg-[#d8ba7f] text-[#09090b] shadow'
                          : 'bg-[#1a1a22] hover:bg-[#252532] border border-white/[0.1] text-[#ede8df] hover:text-[#f5f2ec]'
                      }`}
                    >
                      {isThisLoading ? (
                        <>
                          <RefreshCw className="w-4 h-4 animate-spin text-current" />
                          <span>Preparing checkout...</span>
                        </>
                      ) : (
                        <span>Choose {plan.name}</span>
                      )}
                    </button>
                  </div>
                );
              })}
            </div>

            {/* Note & Refresh Credits Controls Under the Cards */}
            <div className="flex flex-col items-center gap-2.5 pt-4 text-center">
              <p className="text-xs text-[#858076] font-sans leading-relaxed">
                1 credit = 1 second of audio. Unused credits reset each month.
              </p>
              <p className="text-xs text-[#c9c4b9] font-sans leading-relaxed">
                After you pay, come back here. Your credits appear within a minute.
              </p>

              {onRefreshCredits && (
                <button
                  type="button"
                  onClick={handleRefreshCredits}
                  disabled={isRefreshingCredits}
                  className="min-h-[44px] px-4 py-2 mt-1 bg-[#141418] hover:bg-[#1f1f26] border border-white/[0.08] text-[#ede8df] hover:text-[#f5f2ec] text-xs font-sans font-medium rounded-md transition-all cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed flex items-center gap-2 shadow-sm"
                >
                  <RefreshCw className={`w-3.5 h-3.5 text-[#c5a059] ${isRefreshingCredits ? 'animate-spin' : ''}`} />
                  <span>
                    {isRefreshingCredits
                      ? 'Refreshing credits...'
                      : creditBalance !== null && creditBalance !== undefined
                      ? `Refresh my credits (${creditBalance.toLocaleString()})`
                      : 'Refresh my credits'}
                  </span>
                </button>
              )}
            </div>
          </div>
        )}
      </div>
    </div>
  );
};
