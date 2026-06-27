import React from "react";
import { LogIn, FileText, Calendar } from "lucide-react";
import { motion } from "motion/react";

interface LoginViewProps {
  onLogin: () => void;
  key?: string;
}

export default function LoginView({ onLogin }: LoginViewProps) {
  return (
    <motion.div
      initial={{ opacity: 0, y: 15 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0, y: -15 }}
      transition={{ duration: 0.5, ease: "easeOut" }}
      className="w-full max-w-md mx-auto px-6 py-10 flex flex-col items-center justify-center text-center min-h-[80vh]"
    >
      {/* App Icon & Title */}
      <div className="mb-6 flex flex-col items-center">
        <div className="w-20 h-20 bg-surface-container-high rounded-2xl flex items-center justify-center mb-3 shadow-sm border border-outline-variant">
          <FileText className="w-10 h-10 text-primary" strokeWidth={1.5} />
        </div>
        <h1 className="font-headline-lg-mobile md:font-headline-lg text-primary tracking-tight font-semibold">
          LifeSnap Action
        </h1>
      </div>

      {/* Tagline */}
      <div className="mb-8 max-w-[280px]">
        <p className="font-body-lg text-on-surface-variant text-secondary leading-relaxed">
          紙のお知らせを、カレンダーへ
        </p>
      </div>

      {/* Google Sign-In Button */}
      <div className="w-full mb-6 px-4">
        <button
          onClick={onLogin}
          className="w-full flex items-center justify-center gap-3 py-4 px-6 bg-surface-container-lowest border border-outline-variant rounded-full shadow-sm hover:bg-surface-container-low transition-colors duration-200 active:bg-surface-container-highest group cursor-pointer"
        >
          {/* Google 'G' Logo SVG */}
          <svg className="w-6 h-6" viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg">
            <path
              d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z"
              fill="#4285F4"
            ></path>
            <path
              d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z"
              fill="#34A853"
            ></path>
            <path
              d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z"
              fill="#FBBC05"
            ></path>
            <path
              d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z"
              fill="#EA4335"
            ></path>
          </svg>
          <span className="font-body-md font-medium text-on-surface">
            Googleで続ける
          </span>
        </button>
      </div>

      {/* Disclaimer */}
      <div className="px-4">
        <p className="font-label-sm text-secondary text-center leading-relaxed">
          予定作成のためにGoogleカレンダーを使用します
        </p>
      </div>
    </motion.div>
  );
}
