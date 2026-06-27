import React from "react";
import { EventDetails } from "../types";
import { Calendar, Edit3, ArrowLeft, Building, MapPin, DollarSign, Clock, CalendarDays, Clipboard } from "lucide-react";
import { motion } from "motion/react";

interface ReviewCardProps {
  event: EventDetails;
  onConfirm: () => void;
  onEdit: () => void;
  onBack: () => void;
  key?: string;
}

// Generate Google Calendar Link Helper
export function makeGoogleCalendarUrl(event: EventDetails): string {
  const base = "https://calendar.google.com/calendar/render?action=TEMPLATE";
  const titleParam = encodeURIComponent(event.title);
  const locParam = encodeURIComponent(event.location || "");
  
  // Format notes: add Issuer and Amount to notes if present
  let fullNotes = event.notes || "";
  if (event.issuer) {
    fullNotes = `【発行元】 ${event.issuer}\n${fullNotes}`;
  }
  if (event.amount > 0) {
    fullNotes = `【金額】 ¥${event.amount.toLocaleString()}\n${fullNotes}`;
  }
  const detailsParam = encodeURIComponent(fullNotes);

  let datesParam = "";
  const cleanedDate = event.date ? event.date.replace(/-/g, "") : ""; // YYYYMMDD
  
  if (cleanedDate && event.time) {
    // Clean times like "14:00 - 15:00" or "09:00"
    const times = event.time.split("-").map(t => t.trim());
    if (times.length === 2) {
      // Start/End Time
      const startT = times[0].replace(/:/g, "").slice(0, 4) + "00"; // HHMMSS
      const endT = times[1].replace(/:/g, "").slice(0, 4) + "00"; // HHMMSS
      datesParam = `${cleanedDate}T${startT}/${cleanedDate}T${endT}`;
    } else if (times.length === 1 && times[0] && times[0].includes(":")) {
      // Just single start time, default to 1 hour duration
      const [sh, sm] = times[0].split(":");
      const startH = parseInt(sh) || 9;
      const startM = sm || "00";
      const startT = `${String(startH).padStart(2, "0")}${startM}00`;
      const endT = `${String(startH + 1).padStart(2, "0")}${startM}00`;
      datesParam = `${cleanedDate}T${startT}/${cleanedDate}T${endT}`;
    }
  }

  if (!datesParam && cleanedDate) {
    // All day event: dates=YYYYMMDD/YYYYMMDD (Google Calendar requires end date to be day AFTER)
    const parts = event.date.split("-");
    if (parts.length === 3) {
      try {
        const d = new Date(parseInt(parts[0]), parseInt(parts[1]) - 1, parseInt(parts[2]));
        if (!isNaN(d.getTime())) {
          const startStr = d.toISOString().split("T")[0].replace(/-/g, "");
          d.setDate(d.getDate() + 1);
          const endStr = d.toISOString().split("T")[0].replace(/-/g, "");
          datesParam = `${startStr}/${endStr}`;
        }
      } catch (e) {
        datesParam = `${cleanedDate}/${cleanedDate}`;
      }
    } else {
      datesParam = `${cleanedDate}/${cleanedDate}`;
    }
  }

  // Fallback for current date if none parsed
  if (!datesParam) {
    const todayStr = new Date().toISOString().split("T")[0].replace(/-/g, "");
    datesParam = `${todayStr}/${todayStr}`;
  }

  return `${base}&text=${titleParam}&dates=${datesParam}&details=${detailsParam}&location=${locParam}`;
}

export default function ReviewCard({ event, onConfirm, onEdit, onBack }: ReviewCardProps) {
  const gcalUrl = makeGoogleCalendarUrl(event);

  const handleConfirmClick = () => {
    // Open Google Calendar template in a new window/tab safely
    window.open(gcalUrl, "_blank", "noopener,noreferrer");
    onConfirm();
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
          <div className="text-center font-body-md text-secondary mb-2">
            追加前に内容を確認してください
          </div>

          {/* Event Review Card */}
          <div className="bg-surface-container-lowest rounded-2xl border border-outline-variant p-6 flex flex-col gap-4 shadow-[0_4px_12px_rgba(60,57,53,0.04)]">
            <div className="flex flex-col gap-4">
              {/* Piece Name (Title) */}
              <div className="flex flex-col border-b border-outline-variant/50 pb-2">
                <span className="font-label-sm text-secondary flex items-center gap-1">
                  <CalendarDays className="w-3.5 h-3.5" /> 件名 (Title)
                </span>
                <span className="font-body-lg text-on-surface font-semibold mt-1">
                  {event.title || "（未設定）"}
                </span>
              </div>

              {/* Date */}
              <div className="flex flex-col border-b border-outline-variant/50 pb-2">
                <span className="font-label-sm text-secondary flex items-center gap-1">
                  <Calendar className="w-3.5 h-3.5" /> 日付 (Date)
                </span>
                <span className="font-body-lg text-on-surface mt-1">
                  {event.date || "（未検出）"}
                </span>
              </div>

              {/* Time */}
              <div className="flex flex-col border-b border-outline-variant/50 pb-2">
                <span className="font-label-sm text-secondary flex items-center gap-1">
                  <Clock className="w-3.5 h-3.5" /> 時間 (Time)
                </span>
                <span className="font-body-lg text-on-surface mt-1">
                  {event.time || "終日"}
                </span>
              </div>

              {/* Amount */}
              <div className="flex flex-col border-b border-outline-variant/50 pb-2">
                <span className="font-label-sm text-secondary flex items-center gap-1">
                  <DollarSign className="w-3.5 h-3.5" /> 金額 (Amount)
                </span>
                <span className="font-body-lg text-on-surface mt-1">
                  {event.amount > 0 ? `¥${event.amount.toLocaleString()}` : "—"}
                </span>
              </div>

              {/* Issuer */}
              <div className="flex flex-col border-b border-outline-variant/50 pb-2">
                <span className="font-label-sm text-secondary flex items-center gap-1">
                  <Building className="w-3.5 h-3.5" /> 発行元 (Issuer)
                </span>
                <span className="font-body-lg text-on-surface mt-1">
                  {event.issuer || "—"}
                </span>
              </div>

              {/* Location */}
              <div className="flex flex-col border-b border-outline-variant/50 pb-2">
                <span className="font-label-sm text-secondary flex items-center gap-1">
                  <MapPin className="w-3.5 h-3.5" /> 場所 (Location)
                </span>
                <span className="font-body-lg text-on-surface mt-1">
                  {event.location || "—"}
                </span>
              </div>

              {/* Notes */}
              <div className="flex flex-col">
                <span className="font-label-sm text-secondary flex items-center gap-1">
                  <Clipboard className="w-3.5 h-3.5" /> メモ (Notes)
                </span>
                <span className="font-body-md text-on-surface mt-1.5 whitespace-pre-line leading-relaxed">
                  {event.notes || "—"}
                </span>
              </div>
            </div>
          </div>

          {/* Action Buttons */}
          <div className="flex flex-col gap-2 mt-4 w-full">
            <button
              onClick={handleConfirmClick}
              className="bg-primary text-on-primary font-label-md rounded-xl py-4 w-full flex justify-center items-center gap-2 hover:opacity-90 transition-opacity cursor-pointer shadow-sm"
            >
              <Calendar className="w-5 h-5" />
              カレンダーに追加
            </button>
            <button
              onClick={onEdit}
              className="bg-transparent border border-outline-variant text-on-surface font-label-md rounded-xl py-4 w-full flex justify-center items-center gap-2 hover:bg-surface-container transition-colors cursor-pointer"
            >
              <Edit3 className="w-4 h-4" />
              修正する
            </button>
          </div>
        </div>
      </main>

      {/* Styled simple footer */}
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
