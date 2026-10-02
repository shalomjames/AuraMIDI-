import React, { useState, useEffect, useCallback } from 'react';
import { X, RotateCcw, Sparkles, RefreshCw } from 'lucide-react';
import { supabase } from '../lib/supabase';

export interface SubscriptionStatusResponse {
  has_plan: boolean;
  ended?: boolean;
  tier?: string | null;
  plan_name?: string | null;
  price_cents?: number | null;
  monthly_credits?: number | null;
  status?: string | null;
  cancel_at_period_end?: boolean | null;
  renewal_period_end?: string | null;
}

export interface ManagePlanScreenProps {
  isOpen: boolean;
  onClose: () => void;
  onOpenPricing: () => void;
  creditBalance?: number | null;
}

export const ManagePlanScreen: React.FC<ManagePlanScreenProps> = ({
  isOpen,
  onClose,
  onOpenPricing,
  creditBalance,
}) => {
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [planData, setPlanData] = useState<SubscriptionStatusResponse | null>(null);

  // Cancel & Resume states
  const [isUpdating, setIsUpdating] = useState(false);
  const [actionError, setActionError] = useState<string | null>(null);
  const [isConfirmingCancel, setIsConfirmingCancel] = useState(false);

  const fetchStatus = useCallback(async () => {
    setIsLoading(true);
    setError(null);

    try {
      const { data, error: fnErr } = await supabase.functions.invoke('manage-subscription', {
        body: { action: 'status' },
      });

      if (fnErr) {
        throw fnErr;
      }
      if (!data || typeof data !== 'object') {
        throw new Error('Invalid response received');
      }

      setPlanData({
        has_plan: Boolean(data.has_plan),
        ended: data.ended ?? undefined,
        tier: data.tier ?? null,
        plan_name: data.plan_name ?? null,
        price_cents: typeof data.price_cents === 'number' ? data.price_cents : null,
        monthly_credits: typeof data.monthly_credits === 'number' ? data.monthly_credits : null,
        status: data.status ?? null,
        cancel_at_period_end: Boolean(data.cancel_at_period_end),
        renewal_period_end: typeof data.renewal_period_end === 'string' ? data.renewal_period_end : null,
      });
    } catch (err: any) {
      console.error('[ManagePlanScreen] Failed to fetch subscription status:', err?.message);
      setError("We couldn't load your plan.");
    } finally {
      setIsLoading(false);
    }
  }, []);

  const handleAction = async (action: 'cancel' | 'resume') => {
    if (isUpdating) return;
    setIsUpdating(true);
    setActionError(null);

    try {
      const { data, error: fnErr } = await supabase.functions.invoke('manage-subscription', {
        body: { action },
      });

      if (fnErr || !data || typeof data !== 'object') {
        throw fnErr || new Error('Invalid response');
      }

      setPlanData({
        has_plan: Boolean(data.has_plan),
        ended: data.ended ?? undefined,
        tier: data.tier ?? null,
        plan_name: data.plan_name ?? null,
        price_cents: typeof data.price_cents === 'number' ? data.price_cents : null,
        monthly_credits: typeof data.monthly_credits === 'number' ? data.monthly_credits : null,
        status: data.status ?? null,
        cancel_at_period_end: Boolean(data.cancel_at_period_end),
        renewal_period_end: typeof data.renewal_period_end === 'string' ? data.renewal_period_end : null,
      });
      setIsConfirmingCancel(false);
    } catch (err: any) {
      console.error(`[ManagePlanScreen] Failed to ${action} plan:`, err?.message);
      setActionError("We couldn't update your plan. Please try again.");
    } finally {
      setIsUpdating(false);
    }
  };

  useEffect(() => {
    if (isOpen) {
      fetchStatus();
      setIsConfirmingCancel(false);
      setActionError(null);
      setIsUpdating(false);
    }
  }, [isOpen, fetchStatus]);

  // Lock background scroll when open
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

  if (!isOpen) return null;

  const formatPrice = (priceCents?: number | null): string => {
    if (priceCents === undefined || priceCents === null || typeof priceCents !== 'number') return '';
    const dollars = priceCents / 100;
    const formatted = dollars % 1 === 0 ? dollars.toString() : dollars.toFixed(2);
    return `$${formatted}/month`;
  };

  const formatDate = (isoString?: string | null): string => {
    if (!isoString || typeof isoString !== 'string') return '';
    try {
      const d = new Date(isoString);
      if (isNaN(d.getTime())) return '';
      return d.toLocaleDateString(undefined, { year: 'numeric', month: 'long', day: 'numeric' });
    } catch {
      return '';
    }
  };

  let renderedContent: React.ReactNode = null;

  try {
    if (isLoading) {
      renderedContent = (
        <div className="bg-[#111114] border border-white/[0.06] rounded-xl p-6 sm:p-8 flex flex-col gap-4 animate-pulse">
          <div className="h-6 bg-white/[0.06] rounded w-32" />
          <div className="h-9 bg-white/[0.08] rounded w-44" />
          <div className="h-4 bg-white/[0.04] rounded w-52" />
          <div className="h-4 bg-white/[0.04] rounded w-48" />
          <div className="h-4 bg-white/[0.04] rounded w-60 mt-2" />
        </div>
      );
    } else if (error) {
      renderedContent = (
        <div className="py-12 flex flex-col items-center justify-center gap-4 text-center">
          <p className="text-sm sm:text-base text-[#d8a8ad] font-sans">
            {error}
          </p>
          <button
            type="button"
            onClick={fetchStatus}
            className="min-h-[44px] px-5 py-2.5 bg-[#1a1a22] hover:bg-[#252532] border border-white/[0.1] text-[#ede8df] hover:text-[#f5f2ec] text-xs font-sans rounded-md transition-all cursor-pointer flex items-center gap-2"
          >
            <RotateCcw className="w-3.5 h-3.5 text-[#c5a059]" />
            <span>Retry</span>
          </button>
        </div>
      );
    } else if (!planData?.has_plan) {
      renderedContent = (
        <div className="bg-[#111114] border border-white/[0.08] rounded-xl p-8 sm:p-10 flex flex-col items-center text-center gap-5 shadow-lg">
          <div className="w-12 h-12 rounded-xl bg-[#c5a059]/10 border border-[#c5a059]/20 flex items-center justify-center text-[#c5a059]">
            <Sparkles className="w-6 h-6" />
          </div>
          <div className="flex flex-col gap-1.5">
            <h3 className="font-editorial text-2xl text-[#f5f2ec] font-normal">
              You don't have a plan yet.
            </h3>
            <p className="text-xs sm:text-sm text-[#858076] font-sans max-w-sm">
              Choose a plan to get monthly audio transcription credits and keep all your scores saved.
            </p>
          </div>
          <button
            type="button"
            onClick={() => {
              onClose();
              onOpenPricing();
            }}
            className="min-h-[44px] px-6 py-2.5 bg-[#c5a059] hover:bg-[#d8ba7f] text-[#09090b] font-sans font-semibold text-xs rounded-md shadow transition-all cursor-pointer flex items-center justify-center"
          >
            See plans
          </button>
        </div>
      );
    } else {
      const hasPrice = planData.price_cents != null && typeof planData.price_cents === 'number';
      const planTitle = hasPrice ? (planData.plan_name || 'Your plan') : 'Your plan';
      const hasMonthlyCredits = planData.monthly_credits != null && typeof planData.monthly_credits === 'number';
      const formattedDate = formatDate(planData.renewal_period_end);

      renderedContent = (
        <div className="bg-[#111114] border border-[#c5a059]/30 rounded-xl p-6 sm:p-8 flex flex-col gap-6 shadow-[0_0_25px_rgba(197,160,89,0.08)]">
          <div className="flex flex-col sm:flex-row sm:items-baseline justify-between gap-2 border-b border-white/[0.06] pb-5">
            <div className="flex flex-col gap-1">
              <span className="text-[10px] font-sans uppercase tracking-wider text-[#c5a059] font-medium">
                Current plan
              </span>
              <h3 className="font-editorial text-2xl sm:text-3xl text-[#f5f2ec] font-normal">
                {planTitle}
              </h3>
            </div>
            {hasPrice && (
              <span className="text-2xl sm:text-3xl font-tabular font-bold text-[#f5f2ec]">
                {formatPrice(planData.price_cents)}
              </span>
            )}
          </div>

          <div className="flex flex-col gap-2.5 text-xs sm:text-sm font-sans text-[#c9c4b9]">
            {hasMonthlyCredits && (
              <div className="flex items-center justify-between py-1 border-b border-white/[0.04]">
                <span className="text-[#858076]">Monthly allowance</span>
                <span className="font-medium text-[#ede8df]">
                  {planData.monthly_credits!.toLocaleString()} credits per month
                </span>
              </div>
            )}
            <div className="flex items-center justify-between py-1 border-b border-white/[0.04]">
              <span className="text-[#858076]">Current balance</span>
              <span className="font-medium text-[#ede8df]">
                Credits left: {typeof creditBalance === 'number' ? creditBalance.toLocaleString() : '0'}
              </span>
            </div>
          </div>

          <div className="pt-2 text-xs font-sans text-[#858076] leading-relaxed">
            {!planData.cancel_at_period_end ? (
              formattedDate ? (
                <span>Renews on {formattedDate}</span>
              ) : (
                <span>Renews</span>
              )
            ) : formattedDate ? (
              <span>Your plan ends on {formattedDate}. You keep your credits and plan until then.</span>
            ) : (
              <span>Your plan ends. You keep your credits and plan until then.</span>
            )}
          </div>

          {/* Action error feedback */}
          {actionError && (
            <div className="p-3 bg-[#1c1214] border border-[#6b2930] rounded-lg text-center animate-fadeIn">
              <p className="text-xs text-[#f5d6d8] font-sans">{actionError}</p>
            </div>
          )}

          {/* Cancel or Resume Plan Controls */}
          {!planData.cancel_at_period_end ? (
            isConfirmingCancel ? (
              <div className="p-4 sm:p-5 bg-[#17171d] border border-white/[0.08] rounded-lg flex flex-col gap-3 animate-fadeIn">
                <p className="text-xs sm:text-sm text-[#ede8df] font-sans leading-relaxed">
                  Cancel at the end of this billing period? You'll keep your {planData.plan_name || 'current'} plan and your credits until {formattedDate || 'the end of your billing cycle'}.
                </p>
                <div className="flex flex-col sm:flex-row items-center gap-2 pt-1">
                  <button
                    type="button"
                    onClick={() => handleAction('cancel')}
                    disabled={isUpdating}
                    className="min-h-[44px] w-full sm:w-auto px-5 py-2 bg-[#2d1b1e] hover:bg-[#3d2227] border border-[#6b2930] text-[#f5d6d8] font-sans font-medium text-xs rounded-md transition-all cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed flex items-center justify-center gap-2"
                  >
                    {isUpdating ? (
                      <>
                        <RefreshCw className="w-3.5 h-3.5 animate-spin" />
                        <span>Canceling...</span>
                      </>
                    ) : (
                      <span>Yes, cancel</span>
                    )}
                  </button>
                  <button
                    type="button"
                    onClick={() => {
                      setIsConfirmingCancel(false);
                      setActionError(null);
                    }}
                    disabled={isUpdating}
                    className="min-h-[44px] w-full sm:w-auto px-5 py-2 bg-[#1a1a22] hover:bg-[#252532] border border-white/[0.08] text-[#ede8df] font-sans font-medium text-xs rounded-md transition-all cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed flex items-center justify-center"
                  >
                    Keep plan
                  </button>
                </div>
              </div>
            ) : (
              <div className="flex items-center justify-start pt-1 border-t border-white/[0.04]">
                <button
                  type="button"
                  onClick={() => {
                    setIsConfirmingCancel(true);
                    setActionError(null);
                  }}
                  disabled={isUpdating}
                  className="min-h-[44px] px-3 py-2 text-xs font-sans text-[#858076] hover:text-[#d8a8ad] hover:bg-white/[0.03] rounded-md transition-colors cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed flex items-center justify-center"
                >
                  Cancel plan
                </button>
              </div>
            )
          ) : (
            <div className="flex items-center justify-start pt-1 border-t border-white/[0.04]">
              <button
                type="button"
                onClick={() => handleAction('resume')}
                disabled={isUpdating}
                className="min-h-[44px] px-6 py-2.5 bg-[#c5a059] hover:bg-[#d8ba7f] text-[#09090b] font-sans font-semibold text-xs rounded-md shadow transition-all cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed flex items-center justify-center gap-2"
              >
                {isUpdating ? (
                  <>
                    <RefreshCw className="w-4 h-4 animate-spin text-current" />
                    <span>Updating plan...</span>
                  </>
                ) : (
                  <span>Keep my plan</span>
                )}
              </button>
            </div>
          )}
        </div>
      );
    }
  } catch (renderErr) {
    console.error('[ManagePlanScreen] Data handling or render error:', renderErr);
    renderedContent = (
      <div className="py-12 flex flex-col items-center justify-center gap-4 text-center">
        <p className="text-sm sm:text-base text-[#d8a8ad] font-sans">
          We couldn't load your plan.
        </p>
        <button
          type="button"
          onClick={fetchStatus}
          className="min-h-[44px] px-5 py-2.5 bg-[#1a1a22] hover:bg-[#252532] border border-white/[0.1] text-[#ede8df] hover:text-[#f5f2ec] text-xs font-sans rounded-md transition-all cursor-pointer flex items-center gap-2"
        >
          <RotateCcw className="w-3.5 h-3.5 text-[#c5a059]" />
          <span>Retry</span>
        </button>
      </div>
    );
  }

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label="Manage your plan"
      className="fixed inset-0 z-[56] bg-[#09090b] text-[#ede8df] overflow-y-auto flex flex-col p-4 sm:p-6 md:p-8 animate-fadeIn motion-reduce:animate-none"
    >
      {/* Top Header with Close Button */}
      <div className="max-w-2xl w-full mx-auto flex items-center justify-between pb-6 border-b border-white/[0.06]">
        <div className="flex items-center gap-2.5">
          <Sparkles className="w-5 h-5 text-[#c5a059]" />
          <h2 className="font-editorial text-xl sm:text-2xl text-[#f5f2ec] font-normal tracking-wide">
            Manage Subscription
          </h2>
        </div>
        <button
          type="button"
          onClick={onClose}
          className="min-h-[44px] min-w-[44px] p-2 text-[#858076] hover:text-[#f5f2ec] hover:bg-white/[0.05] rounded-md transition-colors cursor-pointer flex items-center justify-center"
          aria-label="Close plan screen"
        >
          <X className="w-5 h-5" />
        </button>
      </div>

      {/* Main Content Area */}
      <div className="max-w-2xl w-full mx-auto flex-1 flex flex-col justify-center py-8">
        {renderedContent}
      </div>
    </div>
  );
};
