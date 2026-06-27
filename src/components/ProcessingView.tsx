import React, { useState, useEffect } from "react";
import { Check, Loader2, FileSearch } from "lucide-react";
import { motion } from "motion/react";

interface ProcessingViewProps {
  analyzingProgress: number; // 0 to 3
  key?: string;
}

export default function ProcessingView({ analyzingProgress }: ProcessingViewProps) {
  return (
    <motion.div
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      className="w-full max-w-md mx-auto min-h-full flex-1 flex flex-col items-center justify-center text-center px-6 relative overflow-hidden bg-background"
    >
      {/* Ambient background noise or blur */}
      <div className="absolute inset-0 opacity-[0.03] pointer-events-none" style={{ backgroundImage: `url("data:image/svg+xml,%3Csvg width='100' height='100' viewBox='0 0 100 100' xmlns='http://www.w3.org/2000/svg'%3E%3Cfilter id='noise'%3E%3CfeTurbulence type='fractalNoise' baseFrequency='0.8' numOctaves='4' stitchTiles='stitch'/%3E%3C/filter%3E%3Crect width='100' height='100' filter='url(%23noise)'/%3E%3C/svg%3E")` }}></div>

      <main className="w-full max-w-md px-6 py-10 flex flex-col items-center justify-center relative z-10 text-center">
        {/* Animated Loading Visual */}
        <div className="mb-6 flex items-center justify-center w-24 h-24 rounded-full bg-surface-container-low border border-outline-variant/30 shadow-sm relative overflow-hidden">
          <div className="absolute inset-0 bg-primary/5 blur-xl rounded-full"></div>
          <motion.div
            animate={{
              scale: [0.9, 1.1, 0.9],
              opacity: [0.5, 0.8, 0.5],
            }}
            transition={{
              duration: 2.5,
              repeat: Infinity,
              ease: "easeInOut"
            }}
            className="absolute inset-0 bg-primary/10 rounded-full"
          />
          <FileSearch className="w-10 h-10 text-primary relative z-10" strokeWidth={1.5} />
        </div>

        {/* Text Content */}
        <div className="mb-8 space-y-xs">
          <h1 className="font-headline-lg-mobile md:font-headline-lg text-primary tracking-tight font-semibold">
            AIが予定を解析中
          </h1>
          <p className="font-body-md text-secondary max-w-[240px] mx-auto leading-relaxed">
            画像からカレンダーに登録する項目を読み取っています。
          </p>
        </div>

        {/* Dynamic Analysis Steps */}
        <div className="w-full flex flex-col gap-4 px-md max-w-xs text-left">
          {/* Step 1: 読み取り中 */}
          <div className={`flex items-center gap-3 transition-all duration-500 ${analyzingProgress >= 1 ? "opacity-100" : "opacity-40"}`}>
            <div className={`w-8 h-8 rounded-full flex items-center justify-center flex-shrink-0 transition-colors duration-500 ${analyzingProgress >= 1 ? "bg-primary text-on-primary" : "border-2 border-outline-variant"}`}>
              {analyzingProgress >= 1 ? (
                <Check className="w-4 h-4 text-on-primary" strokeWidth={2.5} />
              ) : (
                <Loader2 className="w-4 h-4 text-secondary animate-spin" />
              )}
            </div>
            <p className="font-body-lg text-on-surface font-medium">読み取り中</p>
          </div>

          {/* Step 2: 予定を抽出中 */}
          <div className={`flex items-center gap-3 transition-all duration-500 ${analyzingProgress >= 2 ? "opacity-100" : "opacity-40"}`}>
            <div className={`w-8 h-8 rounded-full flex items-center justify-center flex-shrink-0 transition-all duration-500 ${analyzingProgress >= 2 ? "bg-primary text-on-primary" : analyzingProgress === 1 ? "border-2 border-primary" : "border-2 border-outline-variant"}`}>
              {analyzingProgress >= 2 ? (
                <Check className="w-4 h-4 text-on-primary" strokeWidth={2.5} />
              ) : analyzingProgress === 1 ? (
                <Loader2 className="w-4 h-4 text-primary animate-spin" />
              ) : null}
            </div>
            <p className="font-body-lg text-on-surface font-medium">予定を抽出中</p>
          </div>

          {/* Step 3: カードを作成中 */}
          <div className={`flex items-center gap-3 transition-all duration-500 ${analyzingProgress >= 3 ? "opacity-100" : "opacity-40"}`}>
            <div className={`w-8 h-8 rounded-full flex items-center justify-center flex-shrink-0 transition-all duration-500 ${analyzingProgress >= 3 ? "bg-primary text-on-primary" : analyzingProgress === 2 ? "border-2 border-primary" : "border-2 border-outline-variant"}`}>
              {analyzingProgress >= 3 ? (
                <Check className="w-4 h-4 text-on-primary" strokeWidth={2.5} />
              ) : analyzingProgress === 2 ? (
                <Loader2 className="w-4 h-4 text-primary animate-spin" />
              ) : null}
            </div>
            <p className="font-body-lg text-on-surface font-medium">カードを作成中</p>
          </div>
        </div>
      </main>
    </motion.div>
  );
}
