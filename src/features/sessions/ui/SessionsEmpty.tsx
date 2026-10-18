import { Omi } from "../../../shared/ui/branding/Omi";

export function SessionsEmpty({ message }: { message: string }) {
  return (
    <div data-empty-state className="flex min-h-full flex-col items-center justify-center gap-5 px-6 py-10 text-center">
      <Omi expression="ready" animated className="w-24 text-content/35" />
      <p className="text-[13px] leading-relaxed text-content/45">{message}</p>
    </div>
  );
}
