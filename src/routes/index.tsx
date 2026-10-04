import { createFileRoute } from "@tanstack/react-router";
import { Envelope } from "@/components/envelope";

export const Route = createFileRoute("/")({ component: Home });

function Home() {
  return <Envelope />;
}
