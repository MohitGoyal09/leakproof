import { Storefront } from "./Storefront";

export const dynamic = "force-dynamic";

async function loadInventory(): Promise<void> {
  await new Promise((r) => setTimeout(r, 1500));
}

export default async function Home() {
  await loadInventory();
  return <Storefront />;
}
