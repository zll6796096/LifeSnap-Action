import React from "react";
import { CheckCircle, Calendar, RefreshCw } from "lucide-react";
import { motion } from "motion/react";

interface SuccessViewProps {
  onScanAgain: () => void;
  key?: string;
}

export default function SuccessView({ onScanAgain }: SuccessViewProps) {
  const handleOpenCalendar = () => {
    window.open("https://calendar.google.com", "_blank", "noopener,noreferrer");
  };

  return (
    <motion.div
      initial={{ opacity: 0, y: 10 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0, y: -10 }}
      transition={{ duration: 0.6, ease: "easeOut" }}
      className="bg-background text-on-background antialiased min-h-full flex-1 flex flex-col items-center justify-center relative overflow-hidden"
    >
      {/* Subtle Background Texture */}
      <div className="absolute inset-0 opacity-[0.03] pointer-events-none" style={{ backgroundImage: `url("data:image/svg+xml,%3Csvg width='100' height='100' viewBox='0 0 100 100' xmlns='http://www.w3.org/2000/svg'%3E%3Cfilter id='noise'%3E%3CfeTurbulence type='fractalNoise' baseFrequency='0.8' numOctaves='4' stitchTiles='stitch'/%3E%3C/filter%3E%3Crect width='100' height='100' filter='url(%23noise)'/%3E%3C/svg%3E")` }}></div>

      <main className="w-full max-w-md px-6 py-10 flex flex-col items-center justify-center relative z-10 text-center">
        {/* Icon Container with subtle glow */}
        <div className="mb-6 flex items-center justify-center w-24 h-24 rounded-full bg-surface-container-low border border-outline-variant/30 shadow-sm relative overflow-hidden">
          <div className="absolute inset-0 bg-primary/5 blur-xl rounded-full"></div>
          <CheckCircle className="w-12 h-12 text-primary relative z-10" strokeWidth={1.5} />
        </div>

        {/* Text Content */}
        <div className="mb-8 space-y-xs">
          <h1 className="font-headline-lg-mobile md:font-headline-lg text-primary tracking-tight font-semibold">
            予定を追加しました
          </h1>
          <p className="font-body-md text-secondary max-w-[240px] mx-auto leading-relaxed">
            カレンダーへの登録が完了しました。
          </p>
        </div>

        {/* Actions Container */}
        <div className="w-full flex flex-col gap-3">
          {/* Primary Action */}
          <button
            onClick={handleOpenCalendar}
            className="w-full py-4 px-5 bg-primary text-on-primary rounded-xl font-label-md hover:opacity-90 active:scale-[0.98] transition-all flex items-center justify-center gap-2 cursor-pointer shadow-sm"
          >
            <Calendar className="w-5 h-5" />
            カレンダーを開く
          </button>

          {/* Secondary Action */}
          <button
            onClick={onScanAgain}
            className="w-full py-4 px-5 bg-transparent border border-outline-variant text-on-surface-variant rounded-xl font-label-md hover:bg-surface-container-low transition-all flex items-center justify-center gap-2 cursor-pointer"
          >
            <RefreshCw className="w-4 h-4" />
            もう一度スキャン
          </button>
        </div>
      </main>
    </motion.div>
  );
}
