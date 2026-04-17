"use client";

import { useEffect, useRef, useState } from "react";

interface Props {
  onDetected: (code: string) => void;
}

export default function BarcodeScanner({ onDetected }: Props) {
  const containerRef = useRef<HTMLDivElement>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const detectedRef = useRef(false);

  useEffect(() => {
    let stopped = false;

    const start = async () => {
      try {
        const Quagga = (await import("@ericblade/quagga2")).default;

        if (!containerRef.current) return;

        await Quagga.init(
          {
            inputStream: {
              type: "LiveStream",
              target: containerRef.current,
              constraints: {
                facingMode: "environment",
                width: { ideal: 1280 },
                height: { ideal: 720 },
              },
            },
            decoder: {
              readers: [
                "code_128_reader",
                "ean_reader",
                "ean_8_reader",
                "code_39_reader",
                "code_93_reader",
                "upc_reader",
                "upc_e_reader",
                "i2of5_reader",
              ],
            },
            locate: true,
          },
          (err: Error | null) => {
            if (err) {
              console.error(err);
              setError(String(err));
              setLoading(false);
              return;
            }
            if (stopped) return;
            Quagga.start();
            setLoading(false);
          }
        );

        Quagga.onDetected((result: { codeResult?: { code?: string | null } }) => {
          const code = result?.codeResult?.code;
          if (code && !detectedRef.current) {
            detectedRef.current = true;
            Quagga.stop();
            onDetected(code);
          }
        });
      } catch (e) {
        console.error(e);
        setError(String(e));
        setLoading(false);
      }
    };

    start();

    return () => {
      stopped = true;
      import("@ericblade/quagga2").then(({ default: Quagga }) => {
        try {
          Quagga.stop();
        } catch {}
      });
    };
  }, [onDetected]);

  return (
    <div className="w-full">
      {loading && <div className="text-[var(--fg-muted)] mb-2">カメラ起動中...</div>}
      {error && (
        <div className="text-red-500 text-sm mb-2">
          カメラエラー: {error}
          <br />
          <span className="text-xs">
            HTTPS環境かlocalhostでのみカメラが使えます。手動入力をご利用ください。
          </span>
        </div>
      )}
      <div
        ref={containerRef}
        className="w-full h-[400px] bg-black rounded overflow-hidden relative"
        style={{ position: "relative" }}
      />
      <p className="text-xs text-zinc-500 mt-2">
        バーコードをカメラに向けてください。検出時に自動で閉じます。
      </p>
    </div>
  );
}
