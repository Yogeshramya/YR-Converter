'use client';

import React, { useState } from 'react';
import YoutubeConverter from '@/components/YoutubeConverter';
import LocalConverter from '@/components/LocalConverter';
import { Music, Link2, HelpCircle } from 'lucide-react';

export default function Home() {
  const [activeTab, setActiveTab] = useState<'youtube' | 'local'>('youtube');

  return (
    <div className="flex flex-col min-h-screen px-4 md:px-8 py-12 md:py-20 relative z-10">
      {/* Header */}
      <header className="w-full max-w-4xl mx-auto text-center space-y-4 mb-12">
        <div className="inline-flex items-center gap-2 px-3 py-1 rounded-full bg-white/5 border border-white/10 text-xs font-semibold text-gray-300 font-mono">
          <span className="w-2 h-2 rounded-full bg-violet-500"></span>
          Pure Client-Side Local Conversion & Direct Streaming
        </div>
        
        <h1 className="text-4xl md:text-6xl font-black font-display tracking-tight text-white leading-tight">
          YR<span className="bg-gradient-to-r from-indigo-400 via-purple-400 to-cyan-400 bg-clip-text text-transparent">Convert</span>
        </h1>
        
        <p className="text-sm md:text-lg text-gray-400 max-w-xl mx-auto font-sans leading-relaxed">
          Extract high-fidelity audio from local videos instantly in your browser, or stream direct audio & video downloads from YouTube.
        </p>
      </header>

      {/* Main Converter Card */}
      <main className="w-full max-w-2xl mx-auto glass-panel p-6 md:p-8">
        
        {/* Navigation Tabs */}
        <div className="flex bg-black/40 p-1.5 rounded-2xl border border-white/5 mb-8">
          <button
            type="button"
            onClick={() => setActiveTab('youtube')}
            className={`flex-1 flex items-center justify-center gap-2 py-3.5 text-sm font-semibold rounded-xl transition-all ${
              activeTab === 'youtube'
                ? 'bg-gradient-to-r from-indigo-600/30 to-purple-600/30 border border-purple-500/35 text-white shadow-[0_0_20px_rgba(99,102,241,0.1)]'
                : 'text-gray-400 hover:text-gray-200'
            }`}
          >
            <Link2 className="h-4 w-4" />
            YouTube / Instagram
          </button>
          
          <button
            type="button"
            onClick={() => setActiveTab('local')}
            className={`flex-1 flex items-center justify-center gap-2 py-3.5 text-sm font-semibold rounded-xl transition-all ${
              activeTab === 'local'
                ? 'bg-gradient-to-r from-purple-600/30 to-cyan-600/30 border border-cyan-500/35 text-white shadow-[0_0_20px_rgba(6,182,212,0.1)]'
                : 'text-gray-400 hover:text-gray-200'
            }`}
          >
            <Music className="h-4 w-4" />
            Local Video
          </button>
        </div>

        {/* Tab Content Panels */}
        <div className="min-h-[300px]">
          {activeTab === 'youtube' ? (
            <YoutubeConverter />
          ) : (
            <LocalConverter />
          )}
        </div>
      </main>

      {/* FAQ / Info Section */}
      <section className="w-full max-w-2xl mx-auto mt-12 grid grid-cols-1 md:grid-cols-2 gap-6">
        <div className="p-5 rounded-2xl bg-white/3 border border-white/5 space-y-2">
          <h4 className="text-sm font-bold text-white font-display flex items-center gap-2">
            <span className="p-1 rounded-lg bg-indigo-500/10 text-indigo-400">🛡️</span>
            Privacy Guaranteed
          </h4>
          <p className="text-xs text-gray-400 font-sans leading-relaxed">
            Local video files are decoded directly inside your web browser. Absolutely no data is uploaded to any servers, preserving your privacy and saving bandwidth.
          </p>
        </div>

        <div className="p-5 rounded-2xl bg-white/3 border border-white/5 space-y-2">
          <h4 className="text-sm font-bold text-white font-display flex items-center gap-2">
            <span className="p-1 rounded-lg bg-cyan-500/10 text-cyan-400">⚡</span>
            Direct Streaming
          </h4>
          <p className="text-xs text-gray-400 font-sans leading-relaxed">
            YouTube links are piped and streamed dynamically from our backend directly to your browser's downloader. Avoids ad-heavy interfaces and redirect links.
          </p>
        </div>
      </section>

      {/* Footer */}
      <footer className="w-full max-w-4xl mx-auto text-center mt-20 pt-8 border-t border-white/5 text-xs text-gray-500 font-mono">
        <p>© 2026 PulseConvert. Open-source, clean media conversion utility.</p>
      </footer>
    </div>
  );
}
