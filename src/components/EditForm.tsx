import React, { useState } from "react";
import type { GeminiExtraction } from "../shared/gemini-schema";
import { ArrowLeft, CheckCircle, MapPin, CalendarDays, Clock, DollarSign, Building, Clipboard, FileText } from "lucide-react";
import { motion } from "motion/react";

interface EditFormProps {
  extraction: GeminiExtraction;
  onSave: (updated: GeminiExtraction) => void;
  onCancel: () => void;
  key?: string;
}

export default function EditForm({ extraction, onSave, onCancel }: EditFormProps) {
  const [title, setTitle] = useState(extraction.title || "");

  // Parse start_datetime into date and time parts
  const startParts = (extraction.start_datetime || "").split("T");
  const [startDate, setStartDate] = useState(startParts[0] || extraction.due_date || "");
  const [startTime, setStartTime] = useState(startParts[1]?.slice(0, 5) || "");

  const endParts = (extraction.end_datetime || "").split("T");
  const [endDate, setEndDate] = useState(endParts[0] || "");
  const [endTime, setEndTime] = useState(endParts[1]?.slice(0, 5) || "");

  const [amount, setAmount] = useState<number | "">(extraction.amount || "");
  const [issuer, setIssuer] = useState(extraction.issuer || "");
  const [location, setLocation] = useState(extraction.location || "");
  const [summary, setSummary] = useState(extraction.summary || "");

  const handleSubmit = (e?: React.FormEvent) => {
    if (e) e.preventDefault();

    // Reconstruct datetime strings
    const startDatetime = startDate
      ? startTime
        ? `${startDate}T${startTime}`
        : startDate
      : "";
    const endDatetime = endDate
      ? endTime
        ? `${endDate}T${endTime}`
        : endDate
      : "";

    const updated: GeminiExtraction = {
      ...extraction,
      // When user edits, promote to calendar_action if they've set a date
      route: startDatetime ? "calendar_action" : extraction.route,
      title,
      start_datetime: startDatetime,
      end_datetime: endDatetime,
      due_date: extraction.due_date,
      amount: amount === "" ? 0 : Number(amount),
      issuer,
      location,
      summary,
      // Update calendar_event to match edited fields
      calendar_event: startDatetime
        ? {
            title: title || "LifeSnap Event",
            start: startDatetime,
            end: endDatetime || "",
            description: summary,
            location,
          }
        : undefined,
    };

    onSave(updated);
  };

  return (
    <motion.div
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      className="bg-background text-on-background antialiased min-h-full flex-1 flex flex-col relative pb-32"
    >
      {/* Header */}
      <header className="flex justify-between items-center px-6 py-4 w-full sticky top-0 z-50 bg-surface h-16 border-b border-outline-variant/30">
        <button
          type="button"
          onClick={onCancel}
          className="flex items-center justify-center w-11 h-11 rounded-full text-primary hover:bg-surface-container-low transition-colors cursor-pointer"
          aria-label="キャンセル"
        >
          <ArrowLeft className="w-5 h-5 text-secondary" />
        </button>
        <h1 className="font-headline-md text-primary font-semibold absolute left-1/2 -translate-x-1/2">
          予定を修正
        </h1>
        <div className="w-11"></div>
      </header>

      {/* Main Form Area */}
      <main className="flex-grow w-full max-w-md mx-auto px-6 pt-4 pb-10">
        <form onSubmit={handleSubmit} className="flex flex-col gap-6">
          {/* Details Group */}
          <div className="bg-surface-container-lowest border border-outline-variant rounded-2xl overflow-hidden flex flex-col shadow-sm">
            {/* Title Field */}
            <div className="px-5 py-3 border-b border-outline-variant/50 relative focus-within:bg-surface-container-low transition-colors">
              <label className="block font-label-sm text-secondary mb-1 flex items-center gap-1" htmlFor="title">
                <FileText className="w-3.5 h-3.5" /> 件名
              </label>
              <input
                id="title"
                type="text"
                value={title}
                onChange={(e) => setTitle(e.target.value)}
                placeholder="件名を入力してください"
                className="w-full bg-transparent border-none p-0 font-body-lg text-on-surface focus:ring-0 placeholder:text-secondary/30 outline-none"
              />
            </div>

            {/* Start Date & Time Row */}
            <div className="flex border-b border-outline-variant/50">
              <div className="px-5 py-3 border-r border-outline-variant/50 w-1/2 relative focus-within:bg-surface-container-low transition-colors">
                <label className="block font-label-sm text-secondary mb-1 flex items-center gap-1" htmlFor="startDate">
                  <CalendarDays className="w-3.5 h-3.5" /> 開始日
                </label>
                <input
                  id="startDate"
                  type="date"
                  value={startDate}
                  onChange={(e) => setStartDate(e.target.value)}
                  className="w-full bg-transparent border-none p-0 font-body-lg text-on-surface focus:ring-0 outline-none"
                />
              </div>
              <div className="px-5 py-3 w-1/2 relative focus-within:bg-surface-container-low transition-colors">
                <label className="block font-label-sm text-secondary mb-1 flex items-center gap-1" htmlFor="startTime">
                  <Clock className="w-3.5 h-3.5" /> 開始時刻
                </label>
                <input
                  id="startTime"
                  type="time"
                  value={startTime}
                  onChange={(e) => setStartTime(e.target.value)}
                  className="w-full bg-transparent border-none p-0 font-body-lg text-on-surface focus:ring-0 outline-none"
                />
              </div>
            </div>

            {/* End Date & Time Row */}
            <div className="flex border-b border-outline-variant/50">
              <div className="px-5 py-3 border-r border-outline-variant/50 w-1/2 relative focus-within:bg-surface-container-low transition-colors">
                <label className="block font-label-sm text-secondary mb-1 flex items-center gap-1" htmlFor="endDate">
                  <CalendarDays className="w-3.5 h-3.5" /> 終了日
                </label>
                <input
                  id="endDate"
                  type="date"
                  value={endDate}
                  onChange={(e) => setEndDate(e.target.value)}
                  className="w-full bg-transparent border-none p-0 font-body-lg text-on-surface focus:ring-0 outline-none"
                />
              </div>
              <div className="px-5 py-3 w-1/2 relative focus-within:bg-surface-container-low transition-colors">
                <label className="block font-label-sm text-secondary mb-1 flex items-center gap-1" htmlFor="endTime">
                  <Clock className="w-3.5 h-3.5" /> 終了時刻
                </label>
                <input
                  id="endTime"
                  type="time"
                  value={endTime}
                  onChange={(e) => setEndTime(e.target.value)}
                  className="w-full bg-transparent border-none p-0 font-body-lg text-on-surface focus:ring-0 outline-none"
                />
              </div>
            </div>

            {/* Amount Field */}
            <div className="px-5 py-3 border-b border-outline-variant/50 relative focus-within:bg-surface-container-low transition-colors flex items-end">
              <div className="flex-grow">
                <label className="block font-label-sm text-secondary mb-1 flex items-center gap-1" htmlFor="amount">
                  <DollarSign className="w-3.5 h-3.5" /> 金額
                </label>
                <input
                  id="amount"
                  type="number"
                  value={amount}
                  onChange={(e) => setAmount(e.target.value === "" ? "" : Number(e.target.value))}
                  placeholder="0"
                  className="w-full bg-transparent border-none p-0 font-body-lg text-on-surface focus:ring-0 placeholder:text-secondary/30 outline-none"
                />
              </div>
              <span className="font-body-lg text-secondary pl-2 mb-1">円</span>
            </div>

            {/* Issuer Field */}
            <div className="px-5 py-3 border-b border-outline-variant/50 relative focus-within:bg-surface-container-low transition-colors">
              <label className="block font-label-sm text-secondary mb-1 flex items-center gap-1" htmlFor="issuer">
                <Building className="w-3.5 h-3.5" /> 発行元
              </label>
              <input
                id="issuer"
                type="text"
                value={issuer}
                onChange={(e) => setIssuer(e.target.value)}
                placeholder="発行元（主催会社、店舗名など）"
                className="w-full bg-transparent border-none p-0 font-body-lg text-on-surface focus:ring-0 placeholder:text-secondary/30 outline-none"
              />
            </div>

            {/* Location Field */}
            <div className="px-5 py-3 border-b border-outline-variant/50 relative focus-within:bg-surface-container-low transition-colors">
              <label className="block font-label-sm text-secondary mb-1 flex items-center gap-1" htmlFor="location">
                <MapPin className="w-3.5 h-3.5" /> 場所
              </label>
              <input
                id="location"
                type="text"
                value={location}
                onChange={(e) => setLocation(e.target.value)}
                placeholder="場所（住所、オンラインなど）"
                className="w-full bg-transparent border-none p-0 font-body-lg text-on-surface focus:ring-0 placeholder:text-secondary/30 outline-none"
              />
            </div>

            {/* Summary Field */}
            <div className="px-5 py-3 relative focus-within:bg-surface-container-low transition-colors">
              <label className="block font-label-sm text-secondary mb-1 flex items-center gap-1" htmlFor="summary">
                <Clipboard className="w-3.5 h-3.5" /> 概要
              </label>
              <textarea
                id="summary"
                value={summary}
                onChange={(e) => setSummary(e.target.value)}
                placeholder="詳細なメモ、補足情報など"
                rows={4}
                className="w-full bg-transparent border-none p-0 font-body-lg text-on-surface focus:ring-0 placeholder:text-secondary/30 resize-none outline-none"
              />
            </div>
          </div>
        </form>
      </main>

      {/* Fixed Bottom Action Area */}
      <div className="fixed bottom-0 left-0 right-0 w-full bg-surface/90 backdrop-blur-md border-t border-outline-variant/30 p-6 pb-[calc(20px+env(safe-area-inset-bottom))] z-40 shadow-[0_-4px_12px_rgba(60,57,53,0.04)] flex justify-center">
        <div className="w-full max-w-md">
          <button
            type="button"
            onClick={() => handleSubmit()}
            className="w-full py-4 bg-primary text-on-primary rounded-full font-label-md hover:opacity-90 active:scale-[0.98] transition-all flex items-center justify-center gap-2 shadow-sm cursor-pointer"
          >
            <CheckCircle className="w-5 h-5" />
            内容を確定
          </button>
        </div>
      </div>
    </motion.div>
  );
}
