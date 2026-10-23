import React, { useState } from 'react';
import { Check, X, ArrowRight, Sparkles, Smartphone, Monitor } from 'lucide-react';

interface ThoughtCloudItem {
  id: number;
  image: string;
  badge: string;
  question: string;
}

export default function App() {
  const [showGetStartedModal, setShowGetStartedModal] = useState(false);
  const [setupStep, setSetupStep] = useState(1);
  const [elderName, setElderName] = useState('');
  const [selectedNeeds, setSelectedNeeds] = useState<string[]>([
    'Daily medication reminders',
    'Morning & evening check-in calls',
  ]);
  const [companionVoice, setCompanionVoice] = useState<'warm' | 'gentle' | 'bright'>('warm');
  const [mobileViewMode, setMobileViewMode] = useState<'adaptive' | 'original'>('adaptive');

  const thoughtClouds: ThoughtCloudItem[] = [
    {
      id: 1,
      image: '/assets/aistudio/bubble_1.png',
      badge: 'Daily Call',
      question: 'What if a call, a reminder, or a hello was never out of reach?',
    },
    {
      id: 2,
      image: '/assets/aistudio/bubble_2.png',
      badge: 'Medicine Check',
      question: "Wondering if they've taken their medicine today?",
    },
    {
      id: 3,
      image: '/assets/aistudio/bubble_3.png',
      badge: 'Patient Companion',
      question: "Want someone patient looking out for them when you can't be there?",
    },
    {
      id: 4,
      image: '/assets/aistudio/bubble_4.png',
      badge: 'Hands-Free',
      question: 'What if they could do it themselves, with help just a word away?',
    },
    {
      id: 5,
      image: '/assets/aistudio/bubble_5.png',
      badge: 'Caregiver Sync',
      question: 'Need a helping hand in caring for the people who cared for you?',
    },
    {
      id: 6,
      image: '/assets/aistudio/bubble_6.png',
      badge: 'Emergency Alert',
      question: 'What if help arrived the moment they asked?',
    },
  ];

  return (
    <div className="min-h-screen bg-[#FAF2E9] text-[#5F524C] font-sans selection:bg-[#F3C4BA] selection:text-[#753326] flex flex-col justify-between">
      
      {/* ================= DESKTOP & TABLET VIEW (md and up) ================= */}
      <section className="hidden md:flex flex-1 items-center justify-center p-4 lg:p-8">
        <div className="relative w-full max-w-[1560px] mx-auto overflow-hidden rounded-2xl lg:rounded-3xl shadow-sm border border-[#E8DDD1]/70 bg-[#FAF2E9]">
          {/* Master 1600x593 Exact Image */}
          <img
            src="/assets/aistudio/image_a81917d4.png"
            alt="Care for them, even when you can't be there - An AI companion for elderly care"
            className="w-full h-auto block select-none pointer-events-none"
            loading="eager"
            referrerPolicy="no-referrer"
          />

          {/* Clickable 'Get Started' Hotspot on the banner */}
          <button
            onClick={() => setShowGetStartedModal(true)}
            style={{
              left: '57.2%',
              top: '78.5%',
              width: '15.2%',
              height: '11.5%',
            }}
            className="absolute rounded-full cursor-pointer hover:ring-4 hover:ring-[#9E4536]/40 bg-transparent hover:bg-white/10 transition-all focus:outline-none"
            title="Get Started"
            aria-label="Get Started"
          />
        </div>
      </section>

      {/* ================= MOBILE VIEW (small screens < md) ================= */}
      <section className="md:hidden w-full flex-1 flex flex-col">
        {/* Mobile View Toggle Bar */}
        <div className="px-4 py-2.5 bg-white/70 border-b border-[#E8DDD1] flex items-center justify-between text-xs">
          <span className="font-serif-warm font-bold text-sm text-[#82382C]">Care For Them</span>
          <div className="flex items-center gap-1 bg-[#FAF2E9] p-1 rounded-full border border-[#E5D7CB]">
            <button
              onClick={() => setMobileViewMode('adaptive')}
              className={`px-2.5 py-1 rounded-full text-[11px] font-semibold transition-all cursor-pointer flex items-center gap-1 ${
                mobileViewMode === 'adaptive'
                  ? 'bg-[#82382C] text-white shadow-2xs'
                  : 'text-[#6F5E56]'
              }`}
            >
              <Smartphone className="w-3 h-3" />
              <span>Mobile Layout</span>
            </button>
            <button
              onClick={() => setMobileViewMode('original')}
              className={`px-2.5 py-1 rounded-full text-[11px] font-semibold transition-all cursor-pointer flex items-center gap-1 ${
                mobileViewMode === 'original'
                  ? 'bg-[#82382C] text-white shadow-2xs'
                  : 'text-[#6F5E56]'
              }`}
            >
              <Monitor className="w-3 h-3" />
              <span>Full Banner</span>
            </button>
          </div>
        </div>

        {mobileViewMode === 'original' ? (
          /* Mobile: Full Banner Mode */
          <div className="p-3 my-auto">
            <div className="relative w-full rounded-xl overflow-hidden shadow-sm border border-[#E8DDD1]/80 bg-[#FAF2E9]">
              <img
                src="/assets/aistudio/image_a81917d4.png"
                alt="Care for them - Exact Full Banner"
                className="w-full h-auto block select-none"
                referrerPolicy="no-referrer"
              />
              <button
                onClick={() => setShowGetStartedModal(true)}
                style={{
                  left: '57.2%',
                  top: '78.5%',
                  width: '15.2%',
                  height: '11.5%',
                }}
                className="absolute rounded-full cursor-pointer focus:outline-none"
                aria-label="Get Started"
              />
            </div>
            <p className="text-center text-[11px] text-[#7C6C64] mt-3">
              Tip: Rotate phone to landscape or switch to 'Mobile Layout' above for larger text.
            </p>
          </div>
        ) : (
          /* Mobile: Adaptive Optimized Layout */
          <div className="p-4 sm:p-6 space-y-6">
            
            {/* Top Sage Brush Badge */}
            <div className="flex justify-center">
              <div className="inline-flex items-center gap-1.5 px-4 py-1 rounded-full bg-[#DCE3DB] text-[#445646] text-xs font-bold uppercase tracking-widest shadow-2xs">
                <span>\ \</span>
                <span>Care, Just a Word Away</span>
                <span>/ /</span>
              </div>
            </div>

            {/* Headline with Heart Flourish */}
            <div className="text-center space-y-2">
              <h1 className="text-3xl sm:text-4xl font-serif-warm font-semibold text-[#82382C] leading-[1.18] tracking-tight">
                Care for them,
                <br />
                even when you
                <br />
                <span className="relative inline-block italic">
                  can’t be there.
                  <span className="inline-block text-[#82382C] not-italic ml-1 text-2xl">♡</span>
                </span>
              </h1>
              
              <p className="text-sm text-[#695850] max-w-sm mx-auto leading-relaxed pt-1">
                An AI companion that helps your elderly stay connected, independent and supported — one word at a time.
              </p>
            </div>

            {/* CTA Button with Sparkles */}
            <div className="flex justify-center">
              <div className="relative inline-flex items-center">
                {/* Left sparkles */}
                <div className="absolute -left-5 top-1/2 -translate-y-1/2 flex flex-col gap-1 pointer-events-none opacity-80">
                  <span className="w-3 h-[2px] bg-[#9C4B3D] rounded-full rotate-[-25deg]"></span>
                  <span className="w-3 h-[2px] bg-[#9C4B3D] rounded-full"></span>
                  <span className="w-3 h-[2px] bg-[#9C4B3D] rounded-full rotate-[25deg]"></span>
                </div>

                <button
                  onClick={() => setShowGetStartedModal(true)}
                  className="px-8 py-3 rounded-full bg-[#9E4536] hover:bg-[#86372A] text-white font-semibold text-sm shadow-md flex items-center gap-2 cursor-pointer transition-all active:scale-95"
                >
                  <span>Get Started</span>
                  <ArrowRight className="w-4 h-4" />
                </button>

                {/* Right sparkles */}
                <div className="absolute -right-5 top-1/2 -translate-y-1/2 flex flex-col gap-1 pointer-events-none opacity-80">
                  <span className="w-3 h-[2px] bg-[#9C4B3D] rounded-full rotate-[25deg]"></span>
                  <span className="w-3 h-[2px] bg-[#9C4B3D] rounded-full"></span>
                  <span className="w-3 h-[2px] bg-[#9C4B3D] rounded-full rotate-[-25deg]"></span>
                </div>
              </div>
            </div>

            {/* Loving Family Portrait Card */}
            <div className="bg-white rounded-3xl p-4 sm:p-5 border border-[#E8DAD0] shadow-2xs space-y-3">
              <div className="text-center">
                <p className="font-handwriting text-xl font-bold text-[#82382C]">
                  Because they deserve the same care they gave you. ♡
                </p>
              </div>
              <div className="rounded-2xl overflow-hidden bg-[#FAF2E9]">
                <img
                  src="/assets/aistudio/family_sofa.png"
                  alt="Loving family embracing on sofa"
                  className="w-full h-auto block select-none"
                  referrerPolicy="no-referrer"
                />
              </div>
            </div>

            {/* Central Companion Brain */}
            <div className="text-center pt-2">
              <div className="w-36 h-auto mx-auto drop-shadow-xs">
                <img
                  src="/assets/aistudio/central_brain.png"
                  alt="Smiling AI Companion Brain"
                  className="w-full h-auto block"
                  referrerPolicy="no-referrer"
                />
              </div>
            </div>

            {/* 6 Thought Clouds arranged cleanly for mobile */}
            <div className="space-y-3">
              <p className="text-center text-xs font-bold text-[#82382C] uppercase tracking-wider">
                Support Whenever They Need It:
              </p>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                {thoughtClouds.map((cloud) => (
                  <div
                    key={cloud.id}
                    className="bg-white rounded-2xl p-2 border border-[#E9DDD0] shadow-2xs flex items-center justify-center overflow-hidden"
                  >
                    <img
                      src={cloud.image}
                      alt={cloud.question}
                      className="w-full max-w-[280px] h-auto block object-contain"
                      referrerPolicy="no-referrer"
                    />
                  </div>
                ))}
              </div>
            </div>

          </div>
        )}
      </section>

      {/* ================= GET STARTED ONBOARDING MODAL ================= */}
      {showGetStartedModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/45 backdrop-blur-xs">
          <div className="bg-[#FFFDF9] border border-[#E6D4C6] rounded-3xl max-w-lg w-full p-6 sm:p-8 shadow-2xl relative font-sans text-[#5F524C]">
            <button
              onClick={() => {
                setShowGetStartedModal(false);
                setSetupStep(1);
              }}
              className="absolute top-5 right-5 p-2 rounded-full text-[#82382C] hover:bg-[#F5E8DC] transition-colors cursor-pointer"
            >
              <X className="w-5 h-5" />
            </button>

            {setupStep === 1 && (
              <div className="space-y-5">
                <div>
                  <span className="text-xs font-bold uppercase tracking-wider text-[#82382C]">
                    Step 1 of 3
                  </span>
                  <h3 className="text-2xl font-serif-warm font-semibold text-[#82382C] mt-1">
                    Who would you like to care for?
                  </h3>
                  <p className="text-sm text-[#6C5B54] mt-1">
                    Every companion adapts directly to your loved one’s personal routine.
                  </p>
                </div>

                <div className="space-y-3">
                  <label className="block text-xs font-semibold text-[#6C5B54]">
                    Loved one’s name or household
                  </label>
                  <input
                    type="text"
                    value={elderName}
                    onChange={(e) => setElderName(e.target.value)}
                    placeholder="e.g. Mom & Dad, Grandpa Arthur"
                    className="w-full px-4 py-2.5 rounded-xl border border-[#DDCFC3] bg-white text-[#4A3932] focus:outline-none focus:ring-2 focus:ring-[#82382C]/30 text-sm"
                  />
                </div>

                <div className="space-y-2">
                  <label className="block text-xs font-semibold text-[#6C5B54]">
                    Select primary areas of support
                  </label>
                  {[
                    'Daily medication reminders',
                    'Morning & evening check-in calls',
                    'Reminiscing & friendly conversational companion',
                    'One-word emergency family alerts',
                    'Hands-free music, stories & trivia',
                  ].map((item) => {
                    const isSelected = selectedNeeds.includes(item);
                    return (
                      <button
                        key={item}
                        type="button"
                        onClick={() => {
                          if (isSelected) {
                            setSelectedNeeds(selectedNeeds.filter((n) => n !== item));
                          } else {
                            setSelectedNeeds([...selectedNeeds, item]);
                          }
                        }}
                        className={`w-full text-left p-3 rounded-xl border text-xs sm:text-sm font-medium flex items-center justify-between transition-all cursor-pointer ${
                          isSelected
                            ? 'border-[#82382C] bg-[#FAF1E8] text-[#82382C]'
                            : 'border-[#E6D7CB] bg-white text-[#5F524C] hover:bg-[#FBF5EE]'
                        }`}
                      >
                        <span>{item}</span>
                        {isSelected && <Check className="w-4 h-4 text-[#82382C]" />}
                      </button>
                    );
                  })}
                </div>

                <button
                  onClick={() => setSetupStep(2)}
                  className="w-full py-3 rounded-full bg-[#82382C] hover:bg-[#6F2E23] text-white font-semibold text-sm shadow transition-all flex items-center justify-center gap-2 cursor-pointer"
                >
                  <span>Continue to Companion Voice</span>
                  <ArrowRight className="w-4 h-4" />
                </button>
              </div>
            )}

            {setupStep === 2 && (
              <div className="space-y-5">
                <div>
                  <span className="text-xs font-bold uppercase tracking-wider text-[#82382C]">
                    Step 2 of 3
                  </span>
                  <h3 className="text-2xl font-serif-warm font-semibold text-[#82382C] mt-1">
                    Choose companion tone
                  </h3>
                  <p className="text-sm text-[#6C5B54] mt-1">
                    Pick a gentle speaking cadence that feels most natural for {elderName || 'them'}.
                  </p>
                </div>

                <div className="grid grid-cols-1 gap-3">
                  {[
                    {
                      id: 'warm' as const,
                      title: 'Warm & Patient',
                      desc: 'Speaks with an unhurried, cozy cadence like an old family friend.',
                    },
                    {
                      id: 'gentle' as const,
                      title: 'Calm & Soothing',
                      desc: 'Soft tones ideal for late evenings and quiet moments.',
                    },
                    {
                      id: 'bright' as const,
                      title: 'Cheerful & Encouraging',
                      desc: 'Upbeat delivery great for morning walks and daily enthusiasm.',
                    },
                  ].map((v) => (
                    <div
                      key={v.id}
                      onClick={() => setCompanionVoice(v.id)}
                      className={`p-3.5 rounded-xl border cursor-pointer transition-all ${
                        companionVoice === v.id
                          ? 'border-[#82382C] bg-[#FAF1E8]'
                          : 'border-[#E6D7CB] bg-white hover:bg-[#FAF4ED]'
                      }`}
                    >
                      <div className="flex items-center justify-between">
                        <span className="font-semibold text-sm text-[#82382C]">{v.title}</span>
                        {companionVoice === v.id && <Check className="w-4 h-4 text-[#82382C]" />}
                      </div>
                      <p className="text-xs text-[#6C5B54] mt-1">{v.desc}</p>
                    </div>
                  ))}
                </div>

                <div className="flex items-center gap-3">
                  <button
                    onClick={() => setSetupStep(1)}
                    className="w-1/3 py-2.5 rounded-full border border-[#DDCFC3] text-xs font-semibold text-[#6C5B54] hover:bg-[#F7EFE7] cursor-pointer"
                  >
                    Back
                  </button>
                  <button
                    onClick={() => setSetupStep(3)}
                    className="w-2/3 py-2.5 rounded-full bg-[#82382C] hover:bg-[#6F2E23] text-white font-semibold text-xs shadow flex items-center justify-center gap-1.5 cursor-pointer"
                  >
                    <span>Finalize Setup</span>
                    <ArrowRight className="w-4 h-4" />
                  </button>
                </div>
              </div>
            )}

            {setupStep === 3 && (
              <div className="space-y-5 text-center py-2">
                <div className="w-16 h-16 mx-auto rounded-full bg-[#FAF1E8] border border-[#E8D4C5] flex items-center justify-center text-3xl">
                  🌸
                </div>
                <div>
                  <h3 className="text-2xl font-serif-warm font-semibold text-[#82382C]">
                    Companion Ready for {elderName || 'Your Family'}!
                  </h3>
                  <p className="text-sm text-[#6C5B54] max-w-sm mx-auto mt-2">
                    We have prepared their custom setup with{' '}
                    <strong className="text-[#82382C]">{companionVoice}</strong> tone and{' '}
                    <strong className="text-[#82382C]">{selectedNeeds.length} active care routines</strong>.
                  </p>
                </div>

                <div className="bg-[#FAF2E9] border border-[#EAD7C8] rounded-2xl p-4 text-left space-y-2 text-xs text-[#5C4A42]">
                  <div className="flex items-center gap-2">
                    <Check className="w-4 h-4 text-[#52634E]" />
                    <span>No complex hardware needed — works with any existing tablet or phone.</span>
                  </div>
                  <div className="flex items-center gap-2">
                    <Check className="w-4 h-4 text-[#52634E]" />
                    <span>Family caregiver companion portal active with instant notifications.</span>
                  </div>
                  <div className="flex items-center gap-2">
                    <Check className="w-4 h-4 text-[#52634E]" />
                    <span>Emergency contacts saved for instant one-word call dispatch.</span>
                  </div>
                </div>

                <button
                  onClick={() => {
                    setShowGetStartedModal(false);
                    setSetupStep(1);
                  }}
                  className="w-full py-3 rounded-full bg-[#82382C] hover:bg-[#6F2E23] text-white font-semibold text-sm shadow transition-all cursor-pointer"
                >
                  Start 14-Day Free Family Trial
                </button>
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
