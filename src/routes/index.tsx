import { createFileRoute } from "@tanstack/react-router";
import { Envelope } from "@/components/envelope";
import { beginFlagOn } from "@/lib/envelope/kill.server";

export const Route = createFileRoute("/")({
  loader: () => ({ begun: beginFlagOn() }),
  component: Home,
});

function Home() {
  const { begun } = Route.useLoaderData();
  return <Envelope initialBegun={begun} />;
}
