import React, { useState } from "react";
import { ScreenType, EventDetails, UserProfile } from "./types";
import LoginView from "./components/LoginView";
import ScanView from "./components/ScanView";
import ProcessingView from "./components/ProcessingView";
import ReviewCard from "./components/ReviewCard";
import EditForm from "./components/EditForm";
import SuccessView from "./components/SuccessView";
import ErrorView from "./components/ErrorView";
import AccountSettings from "./components/AccountSettings";
import { AnimatePresence } from "motion/react";

const INITIAL_USER: UserProfile = {
  name: "zll6796096",
  email: "zll6796096@gmail.com",
  avatar: "https://ui-avatars.com/api/?name=Z&background=4285F4&color=fff&size=128&bold=true",
  calendarLinked: true,
};

export default function App() {
  const [currentScreen, setCurrentScreen] = useState<ScreenType>("SCAN");
  const [user, setUser] = useState<UserProfile | null>(INITIAL_USER);
  const [analyzingProgress, setAnalyzingProgress] = useState(0);
  const [currentEvent, setCurrentEvent] = useState<EventDetails | null>(null);
  const [errorDetails, setErrorDetails] = useState<string>("");

  const handleLogin = () => {
    setUser(INITIAL_USER);
    setCurrentScreen("SCAN");
  };

  const handleLogout = () => {
    setUser(null);
    setCurrentScreen("LOGIN");
  };

  // Run steps simulation in sync with actual fetch
  const runStepsSimulation = async (fetchPromise: Promise<EventDetails>) => {
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

      if (data.hasEvent) {
        setCurrentEvent(data);
        setCurrentScreen("REVIEW");
      } else {
        setErrorDetails("この画像からはカレンダーに登録すべき予定が見つかりませんでした。");
        setCurrentScreen("ERROR");
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
    const fetchPromise = async (): Promise<EventDetails> => {
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

  const handleSaveEvent = (updatedEvent: EventDetails) => {
    setCurrentEvent(updatedEvent);
    setCurrentScreen("REVIEW");
  };

  return (
    <div className="bg-[#f3f1ed] min-h-screen w-full flex items-center justify-center font-body-md antialiased selection:bg-surface-variant selection:text-on-surface p-0 sm:p-6">
      <div className="w-full max-w-md min-h-screen sm:min-h-[820px] sm:max-h-[860px] bg-background sm:rounded-[40px] sm:shadow-[0_24px_50px_rgba(0,0,0,0.12)] sm:border-[8px] sm:border-primary/95 overflow-hidden flex flex-col relative">
        <div className="flex-1 flex flex-col overflow-y-auto w-full">
          <AnimatePresence mode="wait">
            {currentScreen === "LOGIN" && (
              <LoginView key="login" onLogin={handleLogin} />
            )}

            {currentScreen === "SCAN" && (
              <ScanView
                key="scan"
                onAnalyzeBase64={handleAnalyzeBase64}
                onOpenAccount={() => setCurrentScreen("ACCOUNT")}
              />
            )}

            {currentScreen === "PROCESSING" && (
              <ProcessingView key="processing" analyzingProgress={analyzingProgress} />
            )}

            {currentScreen === "REVIEW" && currentEvent && (
              <ReviewCard
                key="review"
                event={currentEvent}
                onConfirm={() => setCurrentScreen("SUCCESS")}
                onEdit={() => setCurrentScreen("EDIT")}
                onBack={() => setCurrentScreen("SCAN")}
              />
            )}

            {currentScreen === "EDIT" && currentEvent && (
              <EditForm
                key="edit"
                event={currentEvent}
                onSave={handleSaveEvent}
                onCancel={() => setCurrentScreen("REVIEW")}
              />
            )}

            {currentScreen === "SUCCESS" && (
              <SuccessView
                key="success"
                onScanAgain={() => {
                  setCurrentEvent(null);
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
