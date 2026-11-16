export type Shape = "mug" | "throw" | "lamp" | "tray";

export type Product = {
  id: string;
  accession: string;
  name: string;
  material: string;
  price: number;
  glaze: string;
  shape: Shape;
};

export const PRODUCTS: Product[] = [
  { id: "mug", accession: "DS-014", name: "Stoneware mug", material: "Wheel-thrown stoneware, iron glaze", price: 18, glaze: "#b5652e", shape: "mug" },
  { id: "throw", accession: "DS-022", name: "Wool throw", material: "Undyed Shetland wool, 130 × 170 cm", price: 64, glaze: "#8a8f6a", shape: "throw" },
  { id: "lamp", accession: "DS-031", name: "Brass desk lamp", material: "Spun brass, linen cord", price: 89, glaze: "#c9a24a", shape: "lamp" },
  { id: "tray", accession: "DS-047", name: "Oak serving tray", material: "Oiled white oak, 48 cm", price: 42, glaze: "#6b4a33", shape: "tray" },
];
