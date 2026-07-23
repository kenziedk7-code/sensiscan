import { useEffect, useState } from "react";
import { getAdsFn, trackAdEventFn, type AdRow } from "~/lib/server-fns";

function getToken(): string {
  return typeof window !== "undefined"
    ? localStorage.getItem("sensiskan_token") || ""
    : "";
}

interface AdBannerProps {
  placement: "dashboard" | "scan" | "meals";
  className?: string;
}

export default function AdBanner({ placement, className = "" }: AdBannerProps) {
  const [ad, setAd] = useState<AdRow | null>(null);
  const [loading, setLoading] = useState(true);
  const [impressionSent, setImpressionSent] = useState(false);

  useEffect(() => {
    let cancelled = false;
    async function fetchAd() {
      try {
        const token = getToken();
        if (!token) {
          setLoading(false);
          return;
        }
        const result = await getAdsFn({ data: { token, placement } });
        if (!cancelled) {
          setAd(result.ad);
          setLoading(false);
        }
      } catch {
        if (!cancelled) setLoading(false);
      }
    }
    fetchAd();
    return () => {
      cancelled = true;
    };
  }, [placement]);

  // Track impression once
  useEffect(() => {
    if (ad && !impressionSent) {
      setImpressionSent(true);
      const token = getToken();
      if (token) {
        trackAdEventFn({
          data: { token, adId: ad.id, eventType: "impression" },
        }).catch(() => {
          // Silently fail — tracking is best-effort
        });
      }
    }
  }, [ad, impressionSent]);

  const handleClick = () => {
    if (!ad) return;
    const token = getToken();
    if (token) {
      trackAdEventFn({
        data: { token, adId: ad.id, eventType: "click" },
      }).catch(() => {
        // Silently fail
      });
    }
  };

  if (loading) return null;
  if (!ad) return null;

  return (
    <div
      className={`rounded-xl border border-gray-200 bg-white p-4 shadow-sm ${className}`}
    >
      {/* Sponsored label */}
      <div className="mb-3 flex items-center justify-between">
        <span className="inline-flex items-center gap-1 rounded-full bg-gray-100 px-2 py-0.5 text-xs font-medium text-gray-500">
          <svg
            className="h-3 w-3"
            fill="none"
            stroke="currentColor"
            viewBox="0 0 24 24"
          >
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              strokeWidth={2}
              d="M11 5.882V19.24a1.76 1.76 0 01-3.417.592l-2.147-6.15M18 13a3 3 0 100-6M5.436 13.683A4.001 4.001 0 017 6h1.832c4.1 0 7.625-1.234 9.168-3v14c-1.543-1.766-5.067-3-9.168-3H7a3.988 3.988 0 01-1.564-.317z"
            />
          </svg>
          Sponsored
        </span>
      </div>

      {/* Optional image */}
      {ad.image_url && (
        <img
          src={ad.image_url}
          alt={ad.company_name}
          className="mb-3 h-16 w-full rounded-lg object-cover"
          onError={(e) => {
            (e.target as HTMLImageElement).style.display = "none";
          }}
        />
      )}

      {/* Ad content */}
      <p className="text-xs font-semibold uppercase tracking-wide text-indigo-600">
        {ad.company_name}
      </p>
      <h3 className="mt-1 text-sm font-semibold leading-snug text-gray-900">
        {ad.headline}
      </h3>
      <p className="mt-1.5 text-xs leading-relaxed text-gray-500">
        {ad.body_text}
      </p>

      {/* CTA */}
      <a
        href={ad.link_url}
        target="_blank"
        rel="noopener noreferrer"
        onClick={handleClick}
        className="mt-3 inline-flex items-center gap-1 rounded-lg bg-indigo-600 px-3 py-1.5 text-xs font-semibold text-white transition-colors hover:bg-indigo-700"
      >
        Learn More
        <svg
          className="h-3 w-3"
          fill="none"
          stroke="currentColor"
          viewBox="0 0 24 24"
        >
          <path
            strokeLinecap="round"
            strokeLinejoin="round"
            strokeWidth={2}
            d="M10 6H6a2 2 0 00-2 2v10a2 2 0 002 2h10a2 2 0 002-2v-4M14 4h6m0 0v6m0-6L10 14"
          />
        </svg>
      </a>
    </div>
  );
}
