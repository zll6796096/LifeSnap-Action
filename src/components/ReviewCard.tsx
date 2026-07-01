import React, { useState } from "react";
import type { GeminiExtraction } from "../shared/gemini-schema";
import { Calendar, Edit3, ArrowLeft, Building, MapPin, DollarSign, Clock, CalendarDays, Clipboard, AlertTriangle, Loader2, Shield } from "lucide-react";
import { motion } from "motion/react";

interface ReviewCardProps {
  extraction: GeminiExtraction;
  onConfirm: () => void;
  onEdit: () => void;
  onBack: () => void;
  isCreating: boolean;
  needsCalendarAuth: boolean;
  onCalendarLinked: () => void;
  key?: string;
}

export default function ReviewCard({
  extraction,
  onConfirm,
  onEdit,
  onBack,
  isCreating,
  needsCalendarAuth,
  onCalendarLinked,
}: ReviewCardProps) {
  const [authError, setAuthError] = useState("");

  const handleConfirmClick = async () => {
    if (needsCalendarAuth) {
      // Need to get calendar access first
      await requestCalendarAuth();
      return;
    }
    onConfirm();
  };

  const requestCalendarAuth = async () => {
    setAuthError("");

    if (!window.google?.accounts?.oauth2) {
      setAuthError("Google Identity Servicesが読み込まれていません。ページを再読み込みしてください。");
      return;
    }

    try {
      // Fetch client ID from config
      const configRes = await fetch("/api/config");
      const { googleClientId } = await configRes.json();

      const codeClient = window.google.accounts.oauth2.initCodeClient({
        client_id: googleClientId,
        scope: "https://www.googleapis.com/auth/calendar.events",
        ux_mode: "popup",
        callback: async (codeResponse: any) => {
          if (codeResponse.error) {
            setAuthError("カレンダーへのアクセスが拒否されました。");
            return;
          }

          try {
            const tokenRes = await fetch("/api/auth/google/calendar", {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({ code: codeResponse.code }),
            });

            if (!tokenRes.ok) throw new Error("Token exchange failed");

            onCalendarLinked();
            // After linking, proceed to create
            // Small delay to ensure state is updated
            setTimeout(() => onConfirm(), 100);
          } catch (err: any) {
            setAuthError("カレンダー認証に失敗しました。もう一度お試しください。");
          }
        },
      });

      codeClient.requestCode();
    } catch (err: any) {
      setAuthError("認証の初期化に失敗しました。");
    }
  };

  // Display time from extraction
  const displayTime = () => {
    if (extraction.start_datetime && extraction.end_datetime) {
      const startTime = extraction.start_datetime.includes("T")
        ? extraction.start_datetime.split("T")[1]?.slice(0, 5)
        : "";
      const endTime = extraction.end_datetime.includes("T")
        ? extraction.end_datetime.split("T")[1]?.slice(0, 5)
        : "";
      if (startTime && endTime) return `${startTime} - ${endTime}`;
      if (startTime) return startTime;
    }
    if (extraction.start_datetime?.includes("T")) {
      return extraction.start_datetime.split("T")[1]?.slice(0, 5) || "終日";
    }
    return "終日";
  };

  // Display date from extraction
  const displayDate = () => {
    if (extraction.start_datetime) {
      return extraction.start_datetime.split("T")[0];
    }
    return extraction.due_date || "（未検出）";
  };

  return (
    <motion.div
      initial={{ opacity: 0, scale: 0.98 }}
      animate={{ opacity: 1, scale: 1 }}
      exit={{ opacity: 0, scale: 0.98 }}
      className="w-full max-w-md mx-auto flex flex-col min-h-full flex-1 relative pb-32"
    >
      {/* TopAppBar */}
      <header className="flex justify-between items-center px-6 py-4 w-full sticky top-0 z-50 bg-surface h-16 border-b border-outline-variant/30">
        <button
          onClick={onBack}
          className="flex items-center justify-center w-11 h-11 rounded-full text-primary hover:bg-surface-container-low transition-colors cursor-pointer"
          aria-label="戻る"
        >
          <ArrowLeft className="w-5 h-5 text-secondary" />
        </button>
        <h1 className="font-headline-md font-semibold text-primary absolute left-1/2 -translate-x-1/2">
          確認画面
        </h1>
        <div className="w-11"></div>
      </header>

      {/* Main Content */}
      <main className="flex-grow flex flex-col px-6 py-6 gap-6 items-center bg-surface-container-low">
        <div className="w-full max-w-sm flex flex-col gap-4">
          {/* Needs Review Warning */}
          {extraction.route === "needs_review" && (
            <div className="bg-amber-50 border border-amber-200 rounded-xl p-4 flex items-start gap-3">
              <AlertTriangle className="w-5 h-5 text-amber-600 flex-shrink-0 mt-0.5" />
              <div>
                <p className="font-label-md text-amber-800 font-medium">確認が必要です</p>
                <p className="font-label-sm text-amber-700 mt-1">
                  日付・時刻が不明確なため、内容を確認・修正してから登録してください。
                </p>
              </div>
            </div>
          )}

          {/* Confidence Badge */}
          {extraction.confidence > 0 && (
            <div className="flex items-center justify-center gap-2">
              <Shield className="w-3.5 h-3.5 text-secondary" />
              <span className="font-label-sm text-secondary">
                確信度: {Math.round(extraction.confidence * 100)}%
              </span>
              {extraction.risk_flags && extraction.risk_flags.length > 0 && (
                <span className="font-label-sm text-amber-600">
                  ⚠ {extraction.risk_flags.join(", ")}
                </span>
              )}
            </div>
          )}

          <div className="text-center font-body-md text-secondary mb-2">
            追加前に内容を確認してください
          </div>

          {/* Event Review Card */}
          <div className="bg-surface-container-lowest rounded-2xl border border-outline-variant p-6 flex flex-col gap-4 shadow-[0_4px_12px_rgba(60,57,53,0.04)]">
            <div className="flex flex-col gap-4">
              {/* Title */}
              <div className="flex flex-col border-b border-outline-variant/50 pb-2">
                <span className="font-label-sm text-secondary flex items-center gap-1">
                  <CalendarDays className="w-3.5 h-3.5" /> 件名 (Title)
                </span>
                <span className="font-body-lg text-on-surface font-semibold mt-1">
                  {extraction.title || "（未設定）"}
                </span>
              </div>

              {/* Date */}
              <div className="flex flex-col border-b border-outline-variant/50 pb-2">
                <span className="font-label-sm text-secondary flex items-center gap-1">
                  <Calendar className="w-3.5 h-3.5" /> 日付 (Date)
                </span>
                <span className="font-body-lg text-on-surface mt-1">
                  {displayDate()}
                </span>
              </div>

              {/* Time */}
              <div className="flex flex-col border-b border-outline-variant/50 pb-2">
                <span className="font-label-sm text-secondary flex items-center gap-1">
                  <Clock className="w-3.5 h-3.5" /> 時間 (Time)
                </span>
                <span className="font-body-lg text-on-surface mt-1">
                  {displayTime()}
                </span>
              </div>

              {/* Amount */}
              <div className="flex flex-col border-b border-outline-variant/50 pb-2">
                <span className="font-label-sm text-secondary flex items-center gap-1">
                  <DollarSign className="w-3.5 h-3.5" /> 金額 (Amount)
                </span>
                <span className="font-body-lg text-on-surface mt-1">
                  {extraction.amount && extraction.amount > 0
                    ? `¥${extraction.amount.toLocaleString()}`
                    : "—"}
                </span>
              </div>

              {/* Issuer */}
              <div className="flex flex-col border-b border-outline-variant/50 pb-2">
                <span className="font-label-sm text-secondary flex items-center gap-1">
                  <Building className="w-3.5 h-3.5" /> 発行元 (Issuer)
                </span>
                <span className="font-body-lg text-on-surface mt-1">
                  {extraction.issuer || "—"}
                </span>
              </div>

              {/* Location */}
              <div className="flex flex-col border-b border-outline-variant/50 pb-2">
                <span className="font-label-sm text-secondary flex items-center gap-1">
                  <MapPin className="w-3.5 h-3.5" /> 場所 (Location)
                </span>
                <span className="font-body-lg text-on-surface mt-1">
                  {extraction.location || "—"}
                </span>
              </div>

              {/* Summary */}
              <div className="flex flex-col">
                <span className="font-label-sm text-secondary flex items-center gap-1">
                  <Clipboard className="w-3.5 h-3.5" /> 概要 (Summary)
                </span>
                <span className="font-body-md text-on-surface mt-1.5 whitespace-pre-line leading-relaxed">
                  {extraction.summary || "—"}
                </span>
              </div>
            </div>
          </div>

          {/* Auth Error */}
          {authError && (
            <div className="bg-error-container rounded-xl p-3">
              <p className="font-label-sm text-error text-center">{authError}</p>
            </div>
          )}

          {/* Action Buttons */}
          <div className="flex flex-col gap-2 mt-4 w-full">
            {extraction.route === "needs_review" ? (
              <button
                disabled={true}
                className="bg-secondary/20 text-secondary font-label-md rounded-xl py-4 w-full flex justify-center items-center gap-2 cursor-not-allowed shadow-sm border border-outline-variant/30"
              >
                <AlertTriangle className="w-5 h-5 text-amber-600" />
                確認が必要です（修正してください）
              </button>
            ) : (
              <button
                onClick={handleConfirmClick}
                disabled={isCreating}
                className="bg-primary text-on-primary font-label-md rounded-xl py-4 w-full flex justify-center items-center gap-2 hover:opacity-90 transition-opacity cursor-pointer shadow-sm disabled:opacity-60 disabled:cursor-not-allowed"
              >
                {isCreating ? (
                  <>
                    <Loader2 className="w-5 h-5 animate-spin" />
                    作成中...
                  </>
                ) : needsCalendarAuth ? (
                  <>
                    <Calendar className="w-5 h-5" />
                    カレンダーを認証して追加
                  </>
                ) : (
                  <>
                    <Calendar className="w-5 h-5" />
                    カレンダーに追加
                  </>
                )}
              </button>
            )}
            <button
              onClick={onEdit}
              disabled={isCreating}
              className={`font-label-md rounded-xl py-4 w-full flex justify-center items-center gap-2 transition-colors cursor-pointer disabled:opacity-60 ${
                extraction.route === "needs_review"
                  ? "bg-primary text-on-primary hover:opacity-90 shadow-sm"
                  : "bg-transparent border border-outline-variant text-on-surface hover:bg-surface-container"
              }`}
            >
              <Edit3 className="w-4 h-4" />
              修正する
            </button>
          </div>
        </div>
      </main>

      {/* Footer */}
      <footer className="bg-surface border-t border-outline-variant/30 flex flex-col items-center gap-2 py-4 w-full mt-auto">
        <div className="flex gap-4 font-label-sm text-secondary">
          <span className="hover:text-primary transition-colors cursor-pointer">Privacy</span>
          <span className="hover:text-primary transition-colors cursor-pointer">Terms</span>
        </div>
        <div className="font-label-sm text-secondary">© LifeSnap Action</div>
      </footer>
    </motion.div>
  );
}
