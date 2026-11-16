# Design: Driftwood Supply

World: a museum-shop object label. Every product is presented like an exhibit piece: a glaze-coloured plate for the object, then a label with its accession number, name, material line and price. Gallery-white walls, black label type, and one committed glaze-teal field for the collection banner and primary actions.

Scene: someone browsing on a laptop in daylight, so the page is light.

## Colour (Restrained, one committed field)
- `--wall` #f5f5f2: page ground, a cool gallery white (not cream)
- `--ink` #141414: labels and headings
- `--ink-2` #55564f: secondary label lines (7.0:1 on wall)
- `--rule` #d9d8d2: hairlines between label rows
- `--teal` #0d4f52: collection field, primary buttons, focus
- `--teal-ink` #e6f0ef: text on teal (10.9:1)
- Product glazes (object plates only): mug #b5652e, throw #8a8f6a, lamp #c9a24a, tray #6b4a33

## Type
- Display and labels: Familjen Grotesk (self-hosted through next/font). It is a Swedish grotesk with the plain authority of gallery wall text.
- Body: the same family at 400. Prices and accession numbers use `font-variant-numeric: tabular-nums`.
- Scale: 13 / 15 / 18 / 28 / 56. Tracking -0.02em on display only.

## Components
- Object plate: a solid glaze field (aspect 4:3) with a crisp geometric silhouette of the object in SVG, radius 4px.
- Label: accession no. (`DS-014`), name, material line, price, and a text-weight "Add to cart" button. Hairline separated, no card shadow.
- Collection banner: a full-width teal field with the collection name.
- Buttons: teal fill, 6px radius, 44px tall, darker on hover, 2px offset focus ring in teal.

## Motion
None beyond hover colour transitions (120ms ease-out). The shop is a calm backdrop for the demo.
