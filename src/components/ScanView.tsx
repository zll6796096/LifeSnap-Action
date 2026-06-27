import React, { useState, useRef, useEffect } from "react";
import { Camera, Image as ImageIcon, AlertCircle, Sparkles, User } from "lucide-react";
import { UserProfile } from "../types";
import { motion } from "motion/react";

interface ScanViewProps {
  user: UserProfile | null;
  onAnalyzeBase64: (base64: string, mimeType: string) => void;
  onOpenAccount: () => void;
  key?: string;
}

export default function ScanView({ user, onAnalyzeBase64, onOpenAccount }: ScanViewProps) {
  const [cameraActive, setCameraActive] = useState(false);
  const [cameraError, setCameraError] = useState("");
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const streamRef = useRef<MediaStream | null>(null);

  // Stop camera when component unmounts
  useEffect(() => {
    return () => {
      stopCamera();
    };
  }, []);

  const startCamera = async () => {
    setCameraError("");
    try {
      setCameraActive(true);
      const stream = await navigator.mediaDevices.getUserMedia({
        video: { facingMode: "environment" },
        audio: false
      });
      streamRef.current = stream;
      if (videoRef.current) {
        videoRef.current.srcObject = stream;
      }
    } catch (err: any) {
      console.error("Camera error:", err);
      setCameraError("カメラの起動に失敗しました。カメラのアクセス許可を確認してください。");
      setCameraActive(false);
    }
  };

  const stopCamera = () => {
    if (streamRef.current) {
      streamRef.current.getTracks().forEach(track => track.stop());
      streamRef.current = null;
    }
    setCameraActive(false);
  };

  const capturePhoto = () => {
    if (videoRef.current && canvasRef.current) {
      const video = videoRef.current;
      const canvas = canvasRef.current;
      const context = canvas.getContext("2d");

      if (context) {
        canvas.width = video.videoWidth;
        canvas.height = video.videoHeight;
        context.drawImage(video, 0, 0, canvas.width, canvas.height);

        const base64 = canvas.toDataURL("image/jpeg");
        stopCamera();
        onAnalyzeBase64(base64, "image/jpeg");
      }
    }
  };

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = e.target.files;
    if (files && files.length > 0) {
      const file = files[0];
      const reader = new FileReader();
      reader.onload = () => {
        if (typeof reader.result === "string") {
          onAnalyzeBase64(reader.result, file.type);
        }
      };
      reader.readAsDataURL(file);
    }
  };

  return (
    <motion.div
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      className="w-full max-w-md mx-auto flex flex-col min-h-full flex-1 relative pb-12"
    >
      {/* Header */}
      <header className="flex justify-between items-center px-6 py-4 w-full sticky top-0 z-50 bg-surface border-b border-outline-variant/30 h-16">
        <div className="flex items-center gap-2">
          <Sparkles className="w-6 h-6 text-primary" strokeWidth={1.5} />
          <h1 className="font-headline-md font-semibold text-primary tracking-tight">LifeSnap</h1>
        </div>
        <button
          onClick={onOpenAccount}
          className="w-10 h-10 rounded-full bg-surface-container-highest overflow-hidden border border-outline-variant hover:bg-surface-container-high transition-colors flex items-center justify-center cursor-pointer"
          aria-label="アカウント設定"
        >
          {user?.avatar ? (
            <img src={user.avatar} alt={user.name} className="w-full h-full object-cover" referrerPolicy="no-referrer" />
          ) : (
            <User className="w-5 h-5 text-on-surface-variant" />
          )}
        </button>
      </header>

      {/* Main Content Area */}
      <main className="flex-1 flex flex-col px-6 pt-3 pb-8 w-full max-w-md mx-auto">
        {/* Large Viewfinder Card */}
        <div className="relative w-full aspect-[3/4] min-h-[280px] max-h-[380px] mb-6 rounded-3xl bg-surface-container-high border border-outline-variant overflow-hidden shadow-sm group">
          {/* Viewfinder corner brackets using absolute elements */}
          <div className="absolute top-5 left-5 w-6 h-6 border-t-2 border-l-2 border-primary rounded-tl-md z-20 pointer-events-none"></div>
          <div className="absolute top-5 right-5 w-6 h-6 border-t-2 border-r-2 border-primary rounded-tr-md z-20 pointer-events-none"></div>
          <div className="absolute bottom-5 left-5 w-6 h-6 border-b-2 border-l-2 border-primary rounded-bl-md z-20 pointer-events-none"></div>
          <div className="absolute bottom-5 right-5 w-6 h-6 border-b-2 border-r-2 border-primary rounded-br-md z-20 pointer-events-none"></div>

          {/* Scanning animation line */}
          {cameraActive && (
            <div className="absolute left-[10%] right-[10%] h-[2px] bg-primary/40 shadow-[0_0_8px_rgba(38,36,32,0.5)] z-20 animate-[scan_3s_cubic-bezier(0.4,0,0.2,1)_infinite]"></div>
          )}

          {/* Grid lines background for camera */}
          <div className="absolute inset-0 bg-[linear-gradient(to_right,#e3e2e1_1px,transparent_1px),linear-gradient(to_bottom,#e3e2e1_1px,transparent_1px)] bg-[size:40px_40px] opacity-10 pointer-events-none"></div>

          {/* Camera stream view */}
          {cameraActive ? (
            <video
              ref={videoRef}
              autoPlay
              playsInline
              className="w-full h-full object-cover"
            />
          ) : (
            <div className="absolute inset-0 flex flex-col items-center justify-center text-center p-md">
              <Camera className="w-12 h-12 text-secondary/60 mb-sm" strokeWidth={1} />
              <p className="font-label-md text-secondary">書類を枠内に収めてください</p>
              <p className="font-label-sm text-secondary/60 mt-1 max-w-[220px]">
                請求書・支払票・お知らせ・予約通知など
              </p>
            </div>
          )}

          {/* Canvas for capturing photo */}
          <canvas ref={canvasRef} className="hidden" />
        </div>

        {/* Action Buttons Container */}
        <div className="flex flex-col gap-3 w-full mt-auto">
          {/* Primary Camera/Capture Button */}
          {cameraActive ? (
            <button
              onClick={capturePhoto}
              className="w-full py-4 rounded-full bg-primary text-on-primary hover:bg-primary/90 active:scale-[0.98] transition-all flex items-center justify-center gap-2 font-label-md shadow-md cursor-pointer"
            >
              <Camera className="w-5 h-5" />
              シャッターを押す
            </button>
          ) : (
            <button
              onClick={startCamera}
              className="w-full py-4 rounded-full bg-primary text-on-primary hover:bg-primary/90 active:scale-[0.98] transition-all flex items-center justify-center gap-2 font-label-md shadow-sm cursor-pointer"
            >
              <Camera className="w-5 h-5" />
              撮影する
            </button>
          )}

          {/* Camera Close / Error Info */}
          {cameraActive && (
            <button
              onClick={stopCamera}
              className="w-full py-3 rounded-full border border-outline-variant text-secondary bg-transparent hover:bg-surface-container-low transition-all font-label-md cursor-pointer"
            >
              カメラを閉じる
            </button>
          )}

          {cameraError && (
            <div className="flex items-center gap-2 text-error text-xs px-2 justify-center">
              <AlertCircle className="w-4 h-4 flex-shrink-0" />
              <span>{cameraError}</span>
            </div>
          )}

          {/* File Picker Button */}
          {!cameraActive && (
            <button
              onClick={() => fileInputRef.current?.click()}
              className="w-full py-4 rounded-full bg-surface border border-outline-variant text-on-surface hover:bg-surface-container-low active:scale-[0.98] transition-all flex items-center justify-center gap-2 font-label-md cursor-pointer"
            >
              <ImageIcon className="w-5 h-5 text-secondary" />
              写真を選ぶ
            </button>
          )}

          <input
            type="file"
            ref={fileInputRef}
            onChange={handleFileChange}
            accept="image/*"
            className="hidden"
          />
        </div>
      </main>

      {/* Styled inline animation for scan effect */}
      <style>{`
        @keyframes scan {
          0%, 100% { top: 10%; opacity: 0; }
          10%, 90% { opacity: 1; }
          50% { top: 90%; }
        }
      `}</style>
    </motion.div>
  );
}
