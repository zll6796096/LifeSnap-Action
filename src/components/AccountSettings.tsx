import React from "react";
import type { UserProfile } from "../types";
import { ArrowLeft, CheckCircle, ChevronRight, LogOut, Shield, Mail, Calendar } from "lucide-react";
import { motion } from "motion/react";

interface AccountSettingsProps {
  user: UserProfile;
  onBack: () => void;
  onLogout: () => void;
  key?: string;
}

export default function AccountSettings({ user, onBack, onLogout }: AccountSettingsProps) {
  return (
    <motion.div
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      className="bg-background text-on-background min-h-full flex-1 flex flex-col font-body-md antialiased"
    >
      {/* Top App Bar */}
      <header className="bg-surface text-primary flex justify-between items-center px-6 py-3 w-full sticky top-0 z-50 h-16 border-b border-outline-variant/30">
        <button
          onClick={onBack}
          className="w-11 h-11 flex items-center justify-center rounded-full hover:bg-surface-container-low transition-colors text-secondary cursor-pointer"
          aria-label="Go back"
        >
          <ArrowLeft className="w-5 h-5 text-secondary" />
        </button>
        <h1 className="font-headline-md font-semibold text-primary absolute left-1/2 -translate-x-1/2">
          アカウント
        </h1>
        <div className="w-11 h-11"></div>
      </header>

      {/* Main Content Canvas */}
      <main className="flex-grow px-6 py-6 flex flex-col items-center">
        {/* Minimal Account Info Card */}
        <div className="w-full max-w-md flex flex-col items-center mb-8">
          {/* User Avatar */}
          <div className="w-24 h-24 rounded-full bg-surface-container-highest mb-3 overflow-hidden flex items-center justify-center border border-outline-variant shadow-sm">
            <img
              className="w-full h-full object-cover"
              src={user.avatar}
              referrerPolicy="no-referrer"
              alt={user.name}
            />
          </div>
          <h2 className="font-headline-md font-medium text-primary">{user.name}</h2>
          <p className="font-body-md text-secondary">{user.email}</p>
        </div>

        {/* Inscribed List for Settings */}
        <div className="w-full max-w-md bg-surface-container-lowest rounded-2xl border border-outline-variant overflow-hidden mb-8 shadow-sm">
          {/* Account Email */}
          <div className="flex items-center justify-between px-5 py-3 min-h-[56px] border-b border-outline-variant/30">
            <span className="font-body-lg text-on-surface flex items-center gap-2">
              <Mail className="w-4 h-4 text-secondary/70" /> アカウント
            </span>
            <span className="font-body-md text-secondary">{user.email}</span>
          </div>

          {/* Calendar Sync */}
          <div className="flex items-center justify-between px-5 py-3 min-h-[56px] border-b border-outline-variant/30">
            <span className="font-body-lg text-on-surface flex items-center gap-2">
              <Calendar className="w-4 h-4 text-secondary/70" /> カレンダー連携
            </span>
            <div className="flex items-center gap-2">
              <span className="font-body-md text-secondary">
                {user.calendarLinked ? "連携中" : "未連携"}
              </span>
              {user.calendarLinked && (
                <CheckCircle className="w-4 h-4 text-primary" strokeWidth={2.5} />
              )}
            </div>
          </div>

          {/* Privacy */}
          <button className="w-full flex items-center justify-between px-5 py-3 min-h-[56px] hover:bg-surface-container transition-colors text-left border-none bg-transparent cursor-pointer">
            <span className="font-body-lg text-on-surface flex items-center gap-2">
              <Shield className="w-4 h-4 text-secondary/70" /> プライバシー
            </span>
            <ChevronRight className="w-4 h-4 text-secondary" />
          </button>
        </div>

        {/* Action Area */}
        <div className="w-full max-w-md mt-auto pt-6">
          <button
            onClick={onLogout}
            className="w-full py-4 rounded-xl border border-error text-error font-label-md bg-transparent hover:bg-error-container transition-colors flex items-center justify-center gap-2 min-h-[44px] cursor-pointer"
          >
            <LogOut className="w-4 h-4" />
            ログアウト
          </button>
        </div>
      </main>
    </motion.div>
  );
}
