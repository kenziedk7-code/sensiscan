import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useEffect, useRef, useState, useCallback } from "react";
import { scanProductFn, addSensitivityFn, getSubscriptionStatusFn } from "~/lib/server-fns";
import AdBanner from "~/components/AdBanner";

export const Route = createFileRoute("/scan")({
  component: Scan,
});

function getToken(): string {
  return localStorage.getItem("sensiskan_token") || "";
}

function getStoredUser(): { id: number; email: string; name: string } | null {
  const raw = localStorage.getItem("sensiskan_user");
  if (!raw) return null;
  try {
    return JSON.parse(raw);
  } catch {
    return null;
  }
}

function clearAuth() {
  localStorage.removeItem("sensiskan_token");
  localStorage.removeItem("sensiskan_user");
}

interface MatchedIngredient {
  name: string;
  category: string;
  severity: string;
}

interface ScanResultData {
  found: boolean;
  productName: string | null;
  productImage: string | null;
  ingredientsText: string | null;
  safe: boolean;
  matchedIngredients: MatchedIngredient[];
  source: string | null;
}

function Scan() {
  const navigate = useNavigate();
  const user = typeof window !== "undefined" ? getStoredUser() : null;

  const [barcode, setBarcode] = useState("");
  const [scanning, setScanning] = useState(false);
  const [error, setError] = useState("");
  const [result, setResult] = useState<ScanResultData | null>(null);
  const [lookupError, setLookupError] = useState("");

  // Camera scanner state
  const [cameraActive, setCameraActive] = useState(false);
  const [barcodeSupported, setBarcodeSupported] = useState<boolean | null>(null);
  const videoRef = useRef<HTMLVideoElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const detectorRef = useRef<unknown>(null);
  const animFrameRef = useRef<number>(0);

  // Quick-add sensitivity state
  const [addingIngredient, setAddingIngredient] = useState<string | null>(null);

  // Subscription state
  const [isPro, setIsPro] = useState(false);
  const [scansRemaining, setScansRemaining] = useState(10);

  // Auth check
  useEffect(() => {
    if (typeof window !== "undefined" && !user) {
      navigate({ to: "/login" });
    }
  }, [user, navigate]);

  // Check BarcodeDetector support
  useEffect(() => {
    if (typeof window !== "undefined" && "BarcodeDetector" in window) {
      try {
        const formats = ["ean_13", "ean_8", "upc_a", "upc_e"] as string[];
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const detector = new (window as any).BarcodeDetector({ formats });
        detectorRef.current = detector;
        setBarcodeSupported(true);
      } catch {
        setBarcodeSupported(false);
      }
    } else {
      setBarcodeSupported(false);
    }
  }, []);

  // Cleanup camera on unmount
  useEffect(() => {
    return () => {
      stopCamera();
    };
  }, []);

  // Load subscription status
  useEffect(() => {
    if (!user) return;
    getSubscriptionStatusFn({ data: { token: getToken() } })
      .then((r) => {
        setIsPro(r.isPro);
        setScansRemaining(r.scans_remaining);
      })
      .catch(() => {});
  }, [user]);

  const stopCamera = useCallback(() => {
    if (animFrameRef.current) {
      cancelAnimationFrame(animFrameRef.current);
      animFrameRef.current = 0;
    }
    if (streamRef.current) {
      streamRef.current.getTracks().forEach((t) => t.stop());
      streamRef.current = null;
    }
    setCameraActive(false);
  }, []);

  const startCamera = useCallback(async () => {
    setError("");
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        video: { facingMode: "environment", width: { ideal: 640 }, height: { ideal: 480 } },
      });
      streamRef.current = stream;
      if (videoRef.current) {
        videoRef.current.srcObject = stream;
        await videoRef.current.play();
      }
      setCameraActive(true);
      scanLoop();
    } catch {
      setError("Could not access camera. Please check permissions or use manual entry.");
    }
  }, []);

  const scanLoop = useCallback(() => {
    if (!videoRef.current || !canvasRef.current || !detectorRef.current) return;

    const video = videoRef.current;
    const canvas = canvasRef.current;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    if (video.readyState !== video.HAVE_ENOUGH_DATA) {
      animFrameRef.current = requestAnimationFrame(scanLoop);
      return;
    }

    canvas.width = video.videoWidth;
    canvas.height = video.videoHeight;
    ctx.drawImage(video, 0, 0, canvas.width, canvas.height);

    const detector = detectorRef.current as { detect: (source: ImageBitmapSource) => Promise<Array<{ rawValue: string }>> };
    detector
      .detect(canvas)
      .then((barcodes) => {
        if (barcodes.length > 0) {
          const code = barcodes[0].rawValue;
          stopCamera();
          setBarcode(code);
          handleScan(code);
        } else {
          animFrameRef.current = requestAnimationFrame(scanLoop);
        }
      })
      .catch(() => {
        animFrameRef.current = requestAnimationFrame(scanLoop);
      });
  }, [stopCamera]);

  const handleScan = async (code: string) => {
    const trimmed = code.trim();
    if (!trimmed) return;

    setScanning(true);
    setError("");
    setLookupError("");
    setResult(null);

    try {
      const token = getToken();
      const data = await scanProductFn({ data: { token, barcode: trimmed } });
      setResult(data);
      if (!data.found) {
        setLookupError("Product not found — try entering ingredients manually.");
      }
    } catch (err) {
      if (err instanceof Error && err.message.includes("Authentication required")) {
        clearAuth();
        navigate({ to: "/login" });
        return;
      }
      if (err instanceof Error && err.message.includes("UPGRADE_REQUIRED")) {
        setError(err.message.replace("UPGRADE_REQUIRED: ", ""));
        setScansRemaining(0);
        return;
      }
      setError(err instanceof Error ? err.message : "Scan failed. Please try again.");
    } finally {
      setScanning(false);
    }
  };

  const handleManualSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (barcode.trim()) {
      handleScan(barcode.trim());
    }
  };

  const handleQuickAdd = async (ingredientName: string) => {
    setAddingIngredient(ingredientName);
    try {
      const token = getToken();
      await addSensitivityFn({
        data: {
          token,
          ingredient_name: ingredientName,
          category: "food",
          severity: "moderate",
        },
      });
      // Update result to remove this from matched (it's now in their sensitivity list... still matched)
      setAddingIngredient(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to add sensitivity");
      setAddingIngredient(null);
    }
  };

  const severityColor = (sev: string) => {
    switch (sev) {
      case "severe":
        return "text-red-600 bg-red-50 border-red-200";
      case "moderate":
        return "text-yellow-600 bg-yellow-50 border-yellow-200";
      default:
        return "text-green-600 bg-green-50 border-green-200";
    }
  };

  if (!user) return null;

  return (
    <main className="min-h-dvh bg-gray-50">
      {/* Header */}
      <header className="border-b border-gray-200 bg-white">
        <div className="mx-auto flex max-w-3xl items-center justify-between px-4 py-4">
          <Link to="/" className="text-lg font-bold text-indigo-600">
            SensiScan
          </Link>
          <div className="flex items-center gap-4">
            <Link
              to="/dashboard"
              className="text-sm text-gray-600 hover:text-indigo-600"
            >
              Dashboard
            </Link>
            <Link
              to="/meals"
              className="text-sm text-gray-600 hover:text-indigo-600"
            >
              🍽️ Meals
            </Link>
            <Link
              to="/account"
              className="text-sm text-gray-600 hover:text-indigo-600"
            >
              Account
            </Link>
            {!isPro && (
              <Link
                to="/pricing"
                className="text-sm font-medium text-indigo-600 hover:text-indigo-700"
              >
                Upgrade 🔒
              </Link>
            )}
            <span className="text-sm text-gray-400">{user.name}</span>
          </div>
        </div>
      </header>

      <div className="mx-auto max-w-lg px-4 py-8">
        <h1 className="text-2xl font-bold">Scan a Product</h1>
        <p className="mt-1 text-sm text-gray-500">
          Enter a barcode or use your camera to scan a product.
        </p>

        {/* Free tier scan counter */}
        {!isPro && (
          <div className="mt-3 rounded-lg bg-amber-50 border border-amber-200 px-3 py-2 text-sm">
            <span className="font-medium text-amber-700">
              {scansRemaining > 0
                ? `${scansRemaining} free scan${scansRemaining !== 1 ? "s" : ""} remaining`
                : "No free scans remaining"}
            </span>
            <span className="text-amber-600 ml-2">
              —{" "}
              <Link to="/pricing" className="underline font-medium">
                Upgrade for unlimited
              </Link>
            </span>
          </div>
        )}

        {/* Upgrade required */}
        {!isPro && scansRemaining <= 0 && (
          <div className="mt-4 rounded-xl bg-gradient-to-r from-indigo-500 to-purple-600 p-6 text-white shadow-md text-center">
            <h2 className="text-xl font-bold">You're out of free scans!</h2>
            <p className="mt-2 text-indigo-100">
              Upgrade to Pro for unlimited barcode scans, meal plans, and reaction tracking.
            </p>
            <Link
              to="/pricing"
              className="mt-4 inline-block rounded-lg bg-white px-6 py-2.5 text-sm font-semibold text-indigo-600 hover:bg-indigo-50"
            >
              Upgrade — $9.99/month
            </Link>
          </div>
        )}

        {/* Error */}
        {error && (
          <div className="mt-4 rounded-lg bg-red-50 p-3 text-sm text-red-700">
            {error}
            <button onClick={() => setError("")} className="ml-2 underline">
              Dismiss
            </button>
          </div>
        )}

        {/* Camera Scanner */}
        <div className="mt-6 rounded-xl bg-white p-4 shadow-sm">
          <h2 className="font-semibold text-sm">📷 Camera Scanner</h2>

          {barcodeSupported === null && (
            <p className="mt-2 text-xs text-gray-400">Checking camera support...</p>
          )}

          {barcodeSupported === false && (
            <div className="mt-2 rounded-lg border border-dashed border-gray-200 p-4 text-center">
              <p className="text-sm text-gray-500">
                Camera barcode scanning is not supported in this browser.
              </p>
              <p className="mt-1 text-xs text-gray-400">
                Try Chrome on Android, or use the manual entry below.
              </p>
            </div>
          )}

          {barcodeSupported === true && !cameraActive && (
            <button
              onClick={startCamera}
              className="mt-3 w-full rounded-lg bg-indigo-600 px-4 py-3 text-sm font-semibold text-white hover:bg-indigo-700"
            >
              Open Camera Scanner
            </button>
          )}

          {cameraActive && (
            <div className="mt-3 space-y-2">
              <div className="relative overflow-hidden rounded-lg bg-black">
                <video
                  ref={videoRef}
                  className="w-full"
                  playsInline
                  muted
                />
                <canvas ref={canvasRef} className="hidden" />
                {/* Viewfinder overlay */}
                <div className="absolute inset-0 flex items-center justify-center pointer-events-none">
                  <div className="h-32 w-64 rounded-lg border-2 border-white/70 shadow-[0_0_0_9999px_rgba(0,0,0,0.35)]" />
                </div>
              </div>
              <button
                onClick={stopCamera}
                className="w-full rounded-lg border border-gray-300 px-4 py-2 text-sm text-gray-600 hover:bg-gray-50"
              >
                Stop Camera
              </button>
            </div>
          )}
        </div>

        {/* Manual Entry */}
        <div className="mt-4 rounded-xl bg-white p-4 shadow-sm">
          <h2 className="font-semibold text-sm">🔢 Manual Entry</h2>
          <form onSubmit={handleManualSubmit} className="mt-3 flex gap-2">
            <input
              type="text"
              inputMode="numeric"
              value={barcode}
              onChange={(e) => setBarcode(e.target.value)}
              placeholder="Enter barcode number (e.g. 3017620422003)"
              className="flex-1 rounded-lg border border-gray-300 px-3 py-2.5 text-sm focus:border-indigo-500 focus:outline-none focus:ring-1 focus:ring-indigo-500"
              disabled={scanning}
            />
            <button
              type="submit"
              disabled={scanning || !barcode.trim()}
              className="rounded-lg bg-indigo-600 px-5 py-2.5 text-sm font-semibold text-white hover:bg-indigo-700 disabled:opacity-50"
            >
              {scanning ? "..." : "Look Up"}
            </button>
          </form>
          <div className="mt-2 flex flex-wrap gap-2">
            <span className="text-xs text-gray-400">Try these:</span>
            {["3017620422003", "737628064502", "8001120200046"].map((bc) => (
              <button
                key={bc}
                onClick={() => {
                  setBarcode(bc);
                  handleScan(bc);
                }}
                disabled={scanning}
                className="rounded-md bg-gray-100 px-2 py-1 text-xs text-gray-600 hover:bg-gray-200 disabled:opacity-50"
              >
                {bc}
              </button>
            ))}
          </div>
        </div>

        {/* Scan in progress */}
        {scanning && (
          <div className="mt-6 rounded-xl bg-white p-8 shadow-sm text-center">
            <div className="mx-auto h-8 w-8 animate-spin rounded-full border-4 border-indigo-200 border-t-indigo-600" />
            <p className="mt-3 text-sm text-gray-500">Looking up product...</p>
          </div>
        )}

        {/* Result */}
        {result && !scanning && (
          <div className="mt-6 space-y-4">
            {/* Safe Result */}
            {result.safe && result.found && (
              <div className="rounded-xl bg-green-50 border border-green-200 p-6 shadow-sm">
                <div className="flex items-center gap-3">
                  <span className="text-3xl">✅</span>
                  <div>
                    <h2 className="text-lg font-bold text-green-800">
                      This product looks safe for you!
                    </h2>
                    <p className="text-sm text-green-600">No matches found with your sensitivity list.</p>
                  </div>
                </div>
                {result.productName && (
                  <div className="mt-4 flex items-center gap-4">
                    {result.productImage && (
                      <img
                        src={result.productImage}
                        alt={result.productName}
                        className="h-20 w-20 rounded-lg border border-gray-200 object-contain bg-white"
                        onError={(e) => {
                          (e.target as HTMLImageElement).style.display = "none";
                        }}
                      />
                    )}
                    <div>
                      <p className="font-semibold text-gray-900">{result.productName}</p>
                      <p className="text-xs text-gray-500">
                        Source: {result.source === "beauty" ? "Open Beauty Facts" : result.source === "cache" ? "Cached" : "Open Food Facts"}
                      </p>
                    </div>
                  </div>
                )}
              </div>
            )}

            {/* Flagged Result */}
            {!result.safe && result.found && (
              <div className="rounded-xl bg-red-50 border border-red-200 p-6 shadow-sm">
                <div className="flex items-center gap-3">
                  <span className="text-3xl">⚠️</span>
                  <div>
                    <h2 className="text-lg font-bold text-red-800">Watch out!</h2>
                    <p className="text-sm text-red-600">
                      {result.matchedIngredients.length} ingredient{result.matchedIngredients.length > 1 ? "s" : ""} from your sensitivity list found.
                    </p>
                  </div>
                </div>

                {result.productName && (
                  <div className="mt-4 flex items-center gap-4">
                    {result.productImage && (
                      <img
                        src={result.productImage}
                        alt={result.productName}
                        className="h-20 w-20 rounded-lg border border-gray-200 object-contain bg-white"
                        onError={(e) => {
                          (e.target as HTMLImageElement).style.display = "none";
                        }}
                      />
                    )}
                    <div>
                      <p className="font-semibold text-gray-900">{result.productName}</p>
                      <p className="text-xs text-gray-500">
                        Source: {result.source === "beauty" ? "Open Beauty Facts" : result.source === "cache" ? "Cached" : "Open Food Facts"}
                      </p>
                    </div>
                  </div>
                )}

                {/* Matched Ingredients */}
                <div className="mt-5 space-y-2">
                  <h3 className="text-sm font-semibold text-red-800">Matched Ingredients:</h3>
                  {result.matchedIngredients.map((m) => (
                    <div
                      key={m.name}
                      className={`flex items-center justify-between rounded-lg border px-3 py-2 ${severityColor(m.severity)}`}
                    >
                      <div>
                        <p className="text-sm font-medium">{m.name}</p>
                        <p className="text-xs opacity-75">
                          {m.category} · {m.severity}
                        </p>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {/* Not Found */}
            {!result.found && (
              <div className="rounded-xl bg-amber-50 border border-amber-200 p-6 shadow-sm">
                <div className="flex items-center gap-3">
                  <span className="text-3xl">🔍</span>
                  <div>
                    <h2 className="text-lg font-bold text-amber-800">Product Not Found</h2>
                    <p className="text-sm text-amber-600">
                      This barcode isn't in our database. Try entering ingredients manually.
                    </p>
                  </div>
                </div>
              </div>
            )}

            {/* Lookup error */}
            {lookupError && (
              <div className="rounded-lg bg-amber-50 p-3 text-sm text-amber-700">
                {lookupError}
              </div>
            )}

            {/* Ingredients text preview */}
            {result.ingredientsText && (
              <details className="rounded-xl bg-white p-4 shadow-sm">
                <summary className="cursor-pointer text-sm font-medium text-gray-700">
                  View Full Ingredients List
                </summary>
                <p className="mt-2 text-sm text-gray-600 leading-relaxed">
                  {result.ingredientsText}
                </p>
              </details>
            )}

            {/* Scan again */}
            <button
              onClick={() => {
                setResult(null);
                setLookupError("");
                setBarcode("");
              }}
              className="w-full rounded-lg border border-gray-300 px-4 py-2.5 text-sm font-medium text-gray-700 hover:bg-gray-50"
            >
              Scan Another Product
            </button>

            {/* Ad placement: below scan results */}
            <AdBanner placement="scan" />
          </div>
        )}
      </div>
    </main>
  );
}
