"use client";

import { useEffect, useState } from "react";
import { ObjectPlate } from "./ObjectPlate";
import { PRODUCTS, type Product } from "./products";

type Analytics = { track: (event: string, data: object) => void };

export default function Home() {
  const [count, setCount] = useState(0);
  const [picks, setPicks] = useState<Product[] | null>(null);
  const [showBanner, setShowBanner] = useState(false);

  useEffect(() => {
    // LEAK (network): the API returns 500, the UI quietly falls back.
    fetch("/api/recommendations")
      .then((res) => (res.ok ? res.json() : Promise.reject(res.status)))
      .then((data: Product[]) => setPicks(data))
      .catch(() => setPicks(PRODUCTS.slice(0, 2)));
    // LEAK (vitals): a promo banner appears late and shifts the page.
    const t = setTimeout(() => setShowBanner(true), 1500);
    return () => clearTimeout(t);
  }, []);

  function addToCart(product: Product) {
    setCount((c) => c + 1);
    // LEAK (console): analytics is never loaded, so this throws.
    (window as unknown as { analytics: Analytics }).analytics.track("add_to_cart", { id: product.id });
  }

  return (
    <>
      {/* LEAK (vitals): slow, unsized hero image. */}
      <img className="hero" src="/api/hero" alt="The spring collection: a stoneware mug, a wool throw, a brass lamp and an oak tray" />
      {showBanner && <p className="banner">Free shipping on orders over $50, through Sunday.</p>}

      <div className="collection-head">
        <h1>Spring collection</h1>
        <p className="cart-status" aria-live="polite">
          Cart <span className="num">{count}</span>
        </p>
      </div>

      <ul className="objects" aria-label="Products">
        {PRODUCTS.map((p) => (
          <li className="object" key={p.id}>
            <ObjectPlate shape={p.shape} glaze={p.glaze} label={p.name} />
            <div className="label">
              <span className="accession">{p.accession}</span>
              <h2>{p.name}</h2>
              <p className="material">{p.material}</p>
              <div className="label-foot">
                <span className="price">${p.price}</span>
                <button onClick={() => addToCart(p)}>Add to cart</button>
              </div>
            </div>
          </li>
        ))}
      </ul>

      <section className="picks" aria-labelledby="picks-title">
        <h2 id="picks-title">Popular this week</h2>
        <p>{picks ? picks.map((p) => `${p.accession} ${p.name}`).join("   ·   ") : "Loading…"}</p>
      </section>
    </>
  );
}
