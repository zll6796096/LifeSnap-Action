import React, { useEffect, useRef, useState } from "react";
import { FileText } from "lucide-react";
import { motion } from "motion/react";
import { UserProfile } from "../types";

declare global {
  interface Window {
    google?: {
      accounts: {
        id: {
          initialize: (config: any) => void;
          renderButton: (element: HTMLElement, config: any) => void;
          prompt: () => void;
        };
      };
    };
  }
}

interface LoginViewProps {
  onLogin: (user: UserProfile) => void;
  key?: string;
}

export default function LoginView({ onLogin }: LoginViewProps) {
  const googleBtnRef = useRef<HTMLDivElement>(null);
  const [clientId, setClientId] = useState<string>("");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  // Fetch Google Client ID from server
  useEffect(() => {
    fetch("/api/config")
      .then((res) => res.json())
      .then((data) => {
        setClientId(data.googleClientId || "");
        setLoading(false);
      })
      .catch(() => {
        setError("設定の読み込みに失敗しました。");
        setLoading(false);
      });
  }, []);

  // Initialize Google Sign-In when client ID is available
  useEffect(() => {
    if (!clientId || !googleBtnRef.current) return;

    const handleCredentialResponse = async (response: any) => {
      try {
        setError("");
        // Verify token on server
        const res = await fetch("/api/auth/google", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ credential: response.credential }),
        });

        if (!res.ok) {
          const errData = await res.json().catch(() => ({}));
          throw new Error(errData.error || "認証に失敗しました。");
        }

        const userProfile: UserProfile = await res.json();
        onLogin(userProfile);
      } catch (err: any) {
        console.error("Login error:", err);
        setError(err.message || "ログインに失敗しました。もう一度お試しください。");
      }
    };

    // Wait for GIS script to load
    const initGIS = () => {
      if (window.google?.accounts?.id) {
        window.google.accounts.id.initialize({
          client_id: clientId,
          callback: handleCredentialResponse,
        });
        if (googleBtnRef.current) {
          window.google.accounts.id.renderButton(googleBtnRef.current, {
            theme: "outline",
            size: "large",
            width: 320,
            text: "continue_with",
            shape: "pill",
            locale: "ja",
          });
        }
      } else {
        // GIS script not yet loaded, retry
        setTimeout(initGIS, 200);
      }
    };

    initGIS();
  }, [clientId, onLogin]);

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
      <div className="w-full mb-4 px-4 flex flex-col items-center justify-center min-h-[48px]">
        {loading ? (
          <div className="flex items-center gap-2 text-secondary">
            <div className="w-5 h-5 border-2 border-primary/30 border-t-primary rounded-full animate-spin"></div>
            <span className="font-body-md">読み込み中...</span>
          </div>
        ) : !clientId ? (
          <p className="font-body-md text-error">
            Google ログインが設定されていません。
            <br />
            <span className="font-label-sm text-secondary">GOOGLE_CLIENT_ID が未設定です。</span>
          </p>
        ) : (
          <div ref={googleBtnRef} className="flex justify-center w-full"></div>
        )}
      </div>

      {/* Fallback Demo Button */}
      <div className="w-full mb-6 px-4 flex flex-col items-center">
        {!loading && (
          <>
            <div className="w-full flex items-center justify-center gap-2 my-2 text-secondary/40 font-label-sm">
              <div className="h-[1px] bg-outline-variant/30 flex-1"></div>
              <span>または</span>
              <div className="h-[1px] bg-outline-variant/30 flex-1"></div>
            </div>
            
            <button
              onClick={() => {
                onLogin({
                  googleId: "demo-user",
                  name: "ゲストユーザー",
                  email: "guest@example.com",
                  avatar: "https://ui-avatars.com/api/?name=G&background=707070&color=fff&size=128&bold=true",
                  calendarLinked: false
                });
              }}
              className="w-full py-3 px-6 bg-surface border border-outline rounded-full shadow-sm hover:bg-surface-container-low transition-colors duration-200 font-body-md font-medium text-secondary cursor-pointer"
            >
              デモモードで試す (Googleログインをスキップ)
            </button>
            <p className="font-label-xs text-secondary/60 mt-2 max-w-[280px] text-center leading-relaxed">
              ※LINEやWeChatなどのアプリ内ブラウザでは、Googleのセキュリティ方針によりGoogleログインボタンが表示されない、または機能しない場合があります。
            </p>
          </>
        )}
      </div>

      {/* Error Message */}
      {error && (
        <div className="px-4 mb-4">
          <p className="font-label-sm text-error">{error}</p>
        </div>
      )}

      {/* Disclaimer */}
      <div className="px-4">
        <p className="font-label-sm text-secondary text-center leading-relaxed">
          予定作成のためにGoogleカレンダーを使用します
        </p>
      </div>
    </motion.div>
  );
}
