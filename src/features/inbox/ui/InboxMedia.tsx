import { useQuery } from "@tanstack/react-query";
import { queryClient } from "../../../shared/lib/queryClient";
import { useEffect, useState } from "react";
import { openUrl } from "@tauri-apps/plugin-opener";
import {
  inboxMediaQuery,
  sniffInboxMedia,
  type InboxMediaType,
} from "../model/inboxMedia";

type Props = {
  src: string;
  alt?: string;
};

export function InboxMedia({ src, alt }: Props) {
  const read = useQuery(inboxMediaQuery(src), queryClient);
  const [resource, setResource] = useState<{ bytes: Uint8Array; url: string; type: InboxMediaType }>();
  useEffect(() => {
    const bytes = read.data, type = bytes && sniffInboxMedia(bytes);
    if (!bytes || !type) return;
    const url = URL.createObjectURL(new Blob([bytes], { type: type.mime }));
    setResource({ bytes, url, type });
    return () => URL.revokeObjectURL(url);
  }, [read.data]);
  const state = read.isError || (read.data && !sniffInboxMedia(read.data)) ? { status: "error" as const }
    : resource && resource.bytes === read.data ? { ...resource, status: "ready" as const } : { status: "loading" as const };

  if (state.status === "loading") {
    return (
      <span
        className="inbox-media my-2 inline-block h-32 w-full max-w-xl animate-pulse rounded-[10px] border border-content/10 bg-content/6"
        aria-hidden
      />
    );
  }

  if (state.status === "error") {
    return <MediaFallback src={src} alt={alt} />;
  }

  if (state.type.kind === "video") {
    return (
      <span className="inbox-media my-2 inline-block w-full max-w-xl overflow-hidden rounded-[10px] border border-content/10 bg-content/6">
        <video
          src={state.url}
          controls
          playsInline
          preload="metadata"
          className="block max-h-[28rem] w-full bg-black"
        >
          <MediaFallback src={src} alt={alt} />
        </video>
      </span>
    );
  }

  const label = alt?.trim() || "Image";
  return (
    <img
      src={state.url}
      alt={alt ?? ""}
      title={label}
      draggable={false}
      role="link"
      tabIndex={0}
      aria-label={label}
      className="inbox-media my-2 inline-block max-h-[28rem] w-full max-w-xl cursor-zoom-in rounded-[10px] border border-content/10 bg-content/6 object-contain outline-none hover:border-content/20 focus-visible:ring-2 focus-visible:ring-focus active:opacity-90"
      onClick={(event) => {
        event.preventDefault();
        event.stopPropagation();
        void openUrl(src);
      }}
      onKeyDown={(event) => {
        if (event.key !== "Enter") return;
        event.preventDefault();
        event.stopPropagation();
        void openUrl(src);
      }}
    />
  );
}

function MediaFallback({ src, alt }: { src: string; alt?: string }) {
  const label = alt?.trim() || src;
  return (
    <a
      href={src}
      className="focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring active:opacity-70 text-accent/90 hover:text-accent hover:underline"
      onClick={(event) => {
        event.preventDefault();
        void openUrl(src);
      }}
    >
      {label}
    </a>
  );
}
