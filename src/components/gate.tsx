import { PrintPanel } from "@/components/desk";
import { AnalogPanel, CalendarCompact, InboxCompact } from "@/components/desk-panels";
import type { BookId, DeskPayload } from "@/lib/live/types";
import type { Fill } from "@/lib/printgate/engine";

export function GateSurface({
  desk,
  dayPnl,
  openPositions,
  onFill,
  onPickBook,
}: {
  desk: DeskPayload | null;
  dayPnl: number;
  openPositions: number;
  onFill: (fill: Fill) => void;
  onPickBook: (id: BookId) => void;
}) {
  return (
    <>
      <PrintPanel desk={desk} dayPnl={dayPnl} openPositions={openPositions} onFill={onFill} />
      <div className="grid gap-4 px-4 pb-8 sm:px-6 lg:grid-cols-12 lg:px-8">
        <div className="min-w-0 lg:col-span-7">
          <AnalogPanel desk={desk} onPickBook={onPickBook} />
        </div>
        <div className="flex min-w-0 flex-col gap-4 lg:col-span-5">
          <InboxCompact />
          <CalendarCompact desk={desk} />
        </div>
      </div>
    </>
  );
}
