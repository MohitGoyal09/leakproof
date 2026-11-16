"use client";

import { useEffect } from "react";

export default function Checkout() {
  useEffect(() => {
    // LEAK (env-leak): production code still reports to a staging host.
    fetch("http://staging.localhost:3000/api/collect", { method: "POST", mode: "no-cors" }).catch(() => {});
  }, []);

  return (
    <section className="panel">
      <h1>Order summary</h1>
      <ul className="summary">
        <li><span>DS-014 Stoneware mug × 1</span><span className="price">$18</span></li>
        <li><span>Shipping</span><span>Calculated next</span></li>
        <li className="total"><span>Total</span><span className="price">$18</span></li>
      </ul>
      <button>Continue to payment</button>
    </section>
  );
}
