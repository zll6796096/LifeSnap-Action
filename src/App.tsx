import React, { useState } from "react";
import { ScreenType, UserProfile, CalendarEventResult } from "./types";
import type { GeminiExtraction } from "./shared/gemini-schema";
import LoginView from "./components/LoginView";
import ScanView from "./components/ScanView";
import ProcessingView from "./components/ProcessingView";
import ReviewCard from "./components/ReviewCard";
import EditForm from "./components/EditForm";
import SuccessView from "./components/SuccessView";
import ErrorView from "./components/ErrorView";
import NoActionView from "./components/NoActionView";
import AccountSettings from "./components/AccountSettings";
import { AnimatePresence } from "motion/react";

const SESSION_KEY = "lifesnap_user";

function loadSavedUser(): UserProfile | null {
  try {
    const saved = sessionStorage.getItem(SESSION_KEY);
    if (saved) return JSON.parse(saved);
  } catch {}
  return null;
}

export default function App() {
  const savedUser = loadSavedUser();
  const [currentScreen, setCurrentScreen] = useState<ScreenType>(savedUser ? "SCAN" : "LOGIN");
  const [user, setUser] = useState<UserProfile | null>(savedUser);
  const [analyzingProgress, setAnalyzingProgress] = useState(0);
  const [currentExtraction, setCurrentExtraction] = useState<GeminiExtraction | null>(null);
  const [calendarResult, setCalendarResult] = useState<CalendarEventResult | null>(null);
  const [errorDetails, setErrorDetails] = useState<string>("");
  const [isCreatingEvent, setIsCreatingEvent] = useState(false);

  const handleLogin = (profile: UserProfile) => {
    setUser(profile);
    sessionStorage.setItem(SESSION_KEY, JSON.stringify(profile));
    setCurrentScreen("SCAN");
  };

  const handleCalendarLinked = (accessToken: string) => {
    if (user) {
      const updatedUser = { ...user, calendarLinked: true, calendarAccessToken: accessToken };
      setUser(updatedUser);
      sessionStorage.setItem(SESSION_KEY, JSON.stringify(updatedUser));
    }
  };

  const handleLogout = () => {
    setUser(null);
    sessionStorage.removeItem(SESSION_KEY);
    setCurrentScreen("LOGIN");
  };

  // Run steps simulation in sync with actual fetch
  const runStepsSimulation = async (fetchPromise: Promise<GeminiExtraction>) => {
    setCurrentScreen("PROCESSING");
    setAnalyzingProgress(1); // 読み取り中

    const progressTimer1 = setTimeout(() => {
      setAnalyzingProgress(2); // 予定を抽出中
    }, 1200);

    try {
      // Wait for actual fetch to complete
      const data = await fetchPromise;

      setAnalyzingProgress(3); // カードを作成中

      // Brief pause for natural feeling before screen transition
      await new Promise((resolve) => setTimeout(resolve, 800));

      if (data.route === "calendar_action" || data.route === "needs_review") {
        setCurrentExtraction(data);
        setCurrentScreen("REVIEW");
      } else {
        // no_action_detected
        setCurrentScreen("NO_ACTION");
      }
    } catch (err: any) {
      console.error("Analysis failed:", err);
      setAnalyzingProgress(3);
      await new Promise((resolve) => setTimeout(resolve, 800));

      setErrorDetails(
        err.message || "画像の解析中にエラーが発生しました。もう一度お試しください。"
      );
      setCurrentScreen("ERROR");
    } finally {
      clearTimeout(progressTimer1);
    }
  };

  // Analyze Base64 image
  const handleAnalyzeBase64 = async (base64: string, mimeType: string) => {
    const fetchPromise = async (): Promise<GeminiExtraction> => {
      const response = await fetch("/api/extract", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ image: base64, mimeType }),
      });

      if (!response.ok) {
        const errData = await response.json().catch(() => ({}));
        throw new Error(errData.error || "サーバーエラーが発生しました。");
      }

      return response.json();
    };

    runStepsSimulation(fetchPromise());
  };

  const handleSaveEvent = (updatedExtraction: GeminiExtraction) => {
    setCurrentExtraction(updatedExtraction);
    setCurrentScreen("REVIEW");
  };

  // Create calendar event via API
  const handleConfirmEvent = async () => {
    if (!currentExtraction || !user?.calendarAccessToken) return;

    setIsCreatingEvent(true);
    try {
      const response = await fetch("/api/create-calendar-event", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          extraction: currentExtraction,
          accessToken: user.calendarAccessToken,
        }),
      });

      if (!response.ok) {
        const errData = await response.json().catch(() => ({}));

        // If token expired, clear it and re-prompt
        if (response.status === 401) {
          const updatedUser = { ...user, calendarLinked: false, calendarAccessToken: undefined };
          setUser(updatedUser);
          sessionStorage.setItem(SESSION_KEY, JSON.stringify(updatedUser));
          throw new Error("カレンダーの認証が期限切れです。再度認証してください。");
        }

        throw new Error(errData.error || "イベント作成に失敗しました。");
      }

      const result: CalendarEventResult = await response.json();
      setCalendarResult(result);
      setCurrentScreen("SUCCESS");
    } catch (err: any) {
      console.error("Event creation failed:", err);
      setErrorDetails(err.message || "カレンダーイベントの作成中にエラーが発生しました。");
      setCurrentScreen("ERROR");
    } finally {
      setIsCreatingEvent(false);
    }
  };

  return (
    <div className="bg-[#f3f1ed] min-h-screen w-full flex items-center justify-center font-body-md antialiased selection:bg-surface-variant selection:text-on-surface p-0 sm:p-6">
      <div className="w-full max-w-md min-h-screen sm:min-h-[820px] sm:max-h-[860px] bg-background sm:rounded-[40px] sm:shadow-[0_24px_50px_rgba(0,0,0,0.12)] sm:border-[8px] sm:border-primary/95 overflow-hidden flex flex-col relative">
        <div className="flex-1 flex flex-col overflow-y-auto w-full">
          <AnimatePresence mode="wait">
            {currentScreen === "LOGIN" && (
              <LoginView
                key="login"
                onLogin={handleLogin}
                onCalendarLinked={handleCalendarLinked}
              />
            )}

            {currentScreen === "SCAN" && (
              <ScanView
                key="scan"
                user={user}
                onAnalyzeBase64={handleAnalyzeBase64}
                onOpenAccount={() => setCurrentScreen("ACCOUNT")}
              />
            )}

            {currentScreen === "PROCESSING" && (
              <ProcessingView key="processing" analyzingProgress={analyzingProgress} />
            )}

            {currentScreen === "REVIEW" && currentExtraction && (
              <ReviewCard
                key="review"
                extraction={currentExtraction}
                onConfirm={handleConfirmEvent}
                onEdit={() => setCurrentScreen("EDIT")}
                onBack={() => setCurrentScreen("SCAN")}
                isCreating={isCreatingEvent}
                needsCalendarAuth={!user?.calendarAccessToken}
                onCalendarLinked={handleCalendarLinked}
              />
            )}

            {currentScreen === "EDIT" && currentExtraction && (
              <EditForm
                key="edit"
                extraction={currentExtraction}
                onSave={handleSaveEvent}
                onCancel={() => setCurrentScreen("REVIEW")}
              />
            )}

            {currentScreen === "SUCCESS" && (
              <SuccessView
                key="success"
                eventTitle={currentExtraction?.title || ""}
                htmlLink={calendarResult?.htmlLink || ""}
                onScanAgain={() => {
                  setCurrentExtraction(null);
                  setCalendarResult(null);
                  setCurrentScreen("SCAN");
                }}
              />
            )}

            {currentScreen === "ERROR" && (
              <ErrorView
                key="error"
                errorMessage={errorDetails}
                onScanAgain={() => setCurrentScreen("SCAN")}
                onGoHome={() => setCurrentScreen("SCAN")}
              />
            )}

            {currentScreen === "NO_ACTION" && (
              <NoActionView
                key="no_action"
                onScanAgain={() => {
                  setCurrentExtraction(null);
                  setCurrentScreen("SCAN");
                }}
                onGoHome={() => {
                  setCurrentExtraction(null);
                  setCurrentScreen("SCAN");
                }}
              />
            )}

            {currentScreen === "ACCOUNT" && user && (
              <AccountSettings
                key="account"
                user={user}
                onBack={() => setCurrentScreen("SCAN")}
                onLogout={handleLogout}
              />
            )}
          </AnimatePresence>
        </div>
      </div>
    </div>
  );
}
