import { CATALOG } from "@/lib/catalog";
import { notFound } from "next/navigation";
import Spectator from "@/components/Spectator";
export default async function PlayPage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const game = CATALOG.find((g) => g.slug === slug);
  if (!game) notFound();
  return <Spectator slug={game.slug} title={game.title} color={game.color} rules={game.rules} engine={game.engine} />;
}
