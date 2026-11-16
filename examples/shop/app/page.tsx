import { Storefront } from "./Storefront";

export const dynamic = "force-dynamic";

async function loadInventory(): Promise<void> {
  // LEAK (vitals): a slow inventory lookup blocks the first byte of every page view.
  await new Promise((r) => setTimeout(r, 1500));
}

export default async function Home() {
  await loadInventory();
  return <Storefront />;
}
