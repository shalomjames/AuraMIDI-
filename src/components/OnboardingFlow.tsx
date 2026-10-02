import React, { useState } from 'react';
import { Music, Piano, Library, ArrowRight } from 'lucide-react';
import type { User } from '@supabase/supabase-js';
import { supabase } from '../lib/supabase';

export interface OnboardingFlowProps {
  isOpen?: boolean;
  onClose?: () => void;
  onOpenPricing?: () => void;
  user?: User | null;
}

interface Slide {
  icon: React.ReactNode;
  title: string;
  text: string;
}

export const OnboardingFlow: React.FC<OnboardingFlowProps> = ({
  isOpen = true,
  onClose,
  onOpenPricing,
  user,
}) => {
  const [currentSlide, setCurrentSlide] = useState(0);
  const [isDismissed, setIsDismissed] = useState(false);

  if (!isOpen || isDismissed) {
    return null;
  }

  const markDone = (userId?: string) => {
    if (userId) {
      try {
        localStorage.setItem(`aura_onboarding_done_${userId}`, '1');
      } catch (_) {}
    }

    (async () => {
      try {
        const { error } = await supabase.auth.updateUser({
          data: { onboarding_done: true },
        });
        if (error) {
          throw error;
        }
      } catch (_) {
        if (userId) {
          try {
            localStorage.setItem(`aura_onboarding_done_${userId}`, '1');
          } catch (_) {}
        }
      }
    })();
  };

  const handleSkipOrLater = () => {
    markDone(user?.id);
    setIsDismissed(true);
    onClose?.();
  };

  const handleChoosePlan = () => {
    markDone(user?.id);
    setIsDismissed(true);
    onClose?.();
    onOpenPricing?.();
  };

  const slides: Slide[] = [
    {
      icon: <Music className="w-8 h-8 text-[#c5a059]" />,
      title: 'Turn any song into MIDI',
      text: 'Upload a recording and AuraMIDI finds every instrument and note, then gives you a playable score.',
    },
    {
      icon: <Piano className="w-8 h-8 text-[#c5a059]" />,
      title: 'Play it in the Studio',
      text: 'Watch the notes fall onto the keyboard. Slow it down, change the key, and switch instruments on or off.',
    },
    {
      icon: <Library className="w-8 h-8 text-[#c5a059]" />,
      title: 'Keep every MIDI',
      text: 'Your transcriptions are saved to your account. Open them again anytime, or download the .mid file for your music software.',
    },
  ];

  const slide = slides[currentSlide];
  const isLastSlide = currentSlide === slides.length - 1;

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label="Welcome to AuraMIDI"
      className="fixed inset-0 z-[60] bg-[#09090b] flex flex-col justify-between p-6 sm:p-8 md:p-12 overflow-y-auto animate-fadeIn motion-reduce:animate-none"
    >
      {/* Top Header with Skip link */}
      <div className="w-full max-w-xl mx-auto flex items-center justify-between">
        <span className="font-editorial text-lg tracking-wide text-[#f5f2ec] font-normal italic select-none">
          AuraMIDI
        </span>
        <button
          type="button"
          onClick={handleSkipOrLater}
          className="min-h-[44px] min-w-[44px] px-3 py-2 text-xs font-sans text-[#858076] hover:text-[#f5f2ec] transition-colors cursor-pointer flex items-center justify-center rounded-md"
        >
          Skip
        </button>
      </div>

      {/* Main Slide Content Area */}
      <div className="w-full max-w-xl mx-auto my-auto py-8 flex flex-col items-center text-center">
        {/* Icon Circle */}
        <div className="w-16 h-16 rounded-2xl bg-[#c5a059]/10 border border-[#c5a059]/20 flex items-center justify-center mb-6 shadow-[0_0_30px_rgba(197,160,89,0.12)]">
          {slide.icon}
        </div>

        {/* Title */}
        <h2 className="font-editorial text-2xl sm:text-3xl text-[#f5f2ec] font-normal tracking-wide mb-3">
          {slide.title}
        </h2>

        {/* Description Text */}
        <p className="font-sans text-sm sm:text-base text-[#c9c4b9] leading-relaxed max-w-md">
          {slide.text}
        </p>
      </div>

      {/* Bottom Area: Progress Dots & Actions */}
      <div className="w-full max-w-xl mx-auto flex flex-col items-center">
        {/* Progress Dots */}
        <div
          className="flex items-center justify-center gap-2 mb-6"
          aria-label={`Step ${currentSlide + 1} of ${slides.length}`}
        >
          {slides.map((_, index) => {
            const isActive = index === currentSlide;
            return (
              <span
                key={index}
                className={`transition-all duration-300 motion-reduce:transition-none ${
                  isActive
                    ? 'w-6 h-1.5 bg-[#c5a059] rounded-full'
                    : 'w-1.5 h-1.5 bg-white/20 rounded-full'
                }`}
              />
            );
          })}
        </div>

        {/* Action Buttons */}
        <div className="flex flex-col items-center gap-2.5 w-full max-w-xs">
          {!isLastSlide ? (
            <button
              type="button"
              onClick={() => setCurrentSlide((prev) => Math.min(slides.length - 1, prev + 1))}
              className="min-h-[44px] w-full px-6 py-2.5 bg-[#c5a059] hover:bg-[#d8ba7f] text-[#09090b] font-sans font-semibold text-sm rounded-md shadow cursor-pointer transition-all flex items-center justify-center gap-2 active:scale-[0.98]"
            >
              <span>Next</span>
              <ArrowRight className="w-4 h-4" />
            </button>
          ) : (
            <>
              <button
                type="button"
                onClick={handleChoosePlan}
                className="min-h-[44px] w-full px-6 py-2.5 bg-[#c5a059] hover:bg-[#d8ba7f] text-[#09090b] font-sans font-semibold text-sm rounded-md shadow cursor-pointer transition-all flex items-center justify-center gap-2 active:scale-[0.98]"
              >
                Choose a plan
              </button>
              <button
                type="button"
                onClick={handleSkipOrLater}
                className="min-h-[44px] w-full px-4 py-2 text-xs font-sans text-[#858076] hover:text-[#ede8df] transition-colors cursor-pointer flex items-center justify-center rounded-md"
              >
                Maybe later
              </button>
            </>
          )}
        </div>
      </div>
    </div>
  );
};
