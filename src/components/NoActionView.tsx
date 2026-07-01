import React from "react";
import { CheckCircle2, RefreshCw, Home, ArrowLeft } from "lucide-react";
import { motion } from "motion/react";

interface NoActionViewProps {
  onScanAgain: () => void;
  onGoHome: () => void;
  key?: string;
}

export default function NoActionView({ onScanAgain, onGoHome }: NoActionViewProps) {
  return (
    <motion.div
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      className="min-h-full flex-1 flex flex-col font-body-md antialiased bg-background"
    >
      {/* TopAppBar */}
      <header className="flex justify-between items-center px-6 py-4 w-full sticky top-0 z-50 bg-surface h-16 border-b border-outline-variant/30">
        <button
          onClick={onGoHome}
          className="p-2 -ml-2 rounded-full hover:bg-surface-container-low transition-colors cursor-pointer"
          aria-label="戻る"
        >
          <ArrowLeft className="w-5 h-5 text-secondary" />
        </button>
        <span className="font-headline-md font-semibold text-primary tracking-tight absolute left-1/2 -translate-x-1/2">
          LifeSnap
        </span>
        <div className="w-9 h-9"></div>
      </header>

      {/* Main Content */}
      <main className="flex-1 flex flex-col items-center justify-center p-6 pb-10 max-w-md mx-auto w-full">
        <div className="flex flex-col items-center text-center space-y-6 w-full mt-[-32px]">
          {/* Icon/Visual Element */}
          <div className="w-32 h-32 rounded-full bg-surface-container-low flex items-center justify-center shadow-[0_4px_12px_rgba(60,57,53,0.04)] mb-3 transition-transform hover:scale-105 duration-300 border border-outline-variant/35">
            <CheckCircle2 className="w-16 h-16 text-secondary/50" strokeWidth={1} />
          </div>

          {/* Text Content */}
          <div className="space-y-3">
            <h1 className="font-headline-lg-mobile md:font-headline-lg text-on-surface font-semibold leading-snug">
              予定にする内容は<br />見つかりませんでした
            </h1>
            <p className="font-body-md text-secondary max-w-[280px] mx-auto leading-relaxed">
              この書類は確認のみで、カレンダー登録は不要そうです。
            </p>
          </div>

          {/* Action Area */}
          <div className="w-full pt-4 flex flex-col gap-3">
            <button
              onClick={onScanAgain}
              className="w-full bg-primary text-on-primary py-4 px-4 rounded-xl font-label-md hover:opacity-90 transition-all flex items-center justify-center gap-2 cursor-pointer shadow-sm"
            >
              <RefreshCw className="w-4 h-4" />
              別の書類をスキャン
            </button>
            <button
              onClick={onGoHome}
              className="w-full border border-outline-variant bg-transparent text-on-surface py-4 px-4 rounded-xl font-label-md hover:bg-surface-container transition-colors cursor-pointer"
            >
              ホームに戻る
            </button>
          </div>
        </div>
      </main>
    </motion.div>
  );
}
