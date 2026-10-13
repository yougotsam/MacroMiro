import { createFileRoute } from "@tanstack/react-router";
import { Envelope } from "@/components/envelope";
import { getBegun } from "@/lib/envelope/begun";

export const Route = createFileRoute("/")({
  // server function: the kill-switch module stays server-only (it was being pulled into the client bundle)
  loader: async () => ({ begun: await getBegun() }),
  component: Home,
});

function Home() {
  const { begun } = Route.useLoaderData();
  return <Envelope initialBegun={begun} />;
}
