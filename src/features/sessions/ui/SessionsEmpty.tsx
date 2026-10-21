import { Omi } from "../../../shared/ui/branding/Omi";
import { Empty, EmptyDescription, EmptyMedia } from "../../../shared/ui/primitives/Empty";

export function SessionsEmpty({ message }: { message: string }) {
  return (
    <Empty data-empty-state className="min-h-full gap-5 px-6 py-10">
      <EmptyMedia className="mb-0">
        <Omi expression="ready" animated className="w-24 text-content/35" />
      </EmptyMedia>
      <EmptyDescription className="text-[13px] text-content/45">{message}</EmptyDescription>
    </Empty>
  );
}
