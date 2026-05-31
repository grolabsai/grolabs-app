"use client";

import { useState } from "react";
import { ImageOff } from "lucide-react";

import { Icon } from "@/components/ui/icon";

/**
 * 40px product image with hover-to-zoom popover.
 *
 * Used in Step 2's suggestions table and Step 3's variant table to give
 * the reviewer a quick visual reference. Hovering enlarges the image to
 * 240px in an absolutely-positioned card so the user can sanity-check
 * categorization or grouping without leaving the row.
 *
 * Plain <img> with onError fallback to an icon — same pattern as
 * NewProductForm's PhotosCard. referrerPolicy="no-referrer" to dodge
 * external-host hot-link gates (Shopify CDN, etc.).
 */
export function ProductThumbnail({
  url,
  alt,
}: {
  url: string | undefined;
  alt: string;
}) {
  const [errored, setErrored] = useState(false);
  const [hover, setHover] = useState(false);
  const showImage = Boolean(url) && !errored;

  return (
    <div
      style={{
        position: "relative",
        width: 40,
        height: 40,
        flexShrink: 0,
      }}
      onMouseEnter={() => setHover(true)}
      onMouseLeave={() => setHover(false)}
    >
      <div
        style={{
          width: 40,
          height: 40,
          borderRadius: "var(--gl-radius-sm)",
          background: "var(--gl-surface-alt)",
          border: "0.5px solid var(--gl-border)",
          overflow: "hidden",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          color: "var(--gl-text-tertiary)",
        }}
      >
        {showImage ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={url}
            alt={alt}
            loading="lazy"
            referrerPolicy="no-referrer"
            onError={() => setErrored(true)}
            style={{ width: "100%", height: "100%", objectFit: "cover" }}
          />
        ) : (
          <Icon icon={ImageOff} size={16} />
        )}
      </div>

      {/* Zoom popover — only shown when hovering and an image is loadable */}
      {showImage && hover ? (
        <div
          style={{
            position: "absolute",
            top: -8,
            left: 48,
            width: 240,
            height: 240,
            background: "white",
            border: "0.5px solid var(--gl-border)",
            borderRadius: "var(--gl-radius-md)",
            boxShadow: "0 8px 24px rgba(0,0,0,0.15)",
            overflow: "hidden",
            zIndex: 50,
            // Pointer-events stay on the parent, so leaving the popover via the
            // image counts as still hovering the trigger.
            pointerEvents: "none",
          }}
        >
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src={url}
            alt={alt}
            referrerPolicy="no-referrer"
            style={{ width: "100%", height: "100%", objectFit: "contain", background: "var(--gl-surface-alt)" }}
          />
        </div>
      ) : null}
    </div>
  );
}
