import { describe, it, expect } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import Arrows, { squarePoint } from "./Arrows";
describe("probability arrows", () => {
  it("maps squares consistently in both orientations", () => {
    expect(squarePoint("a1", false)).toEqual([50, 750]);
    expect(squarePoint("h8", false)).toEqual([750, 50]);
    expect(squarePoint("a1", true)).toEqual([750, 50]);
    expect(squarePoint("g1", false)).toEqual([650, 750]);
    expect(squarePoint("f3", false)).toEqual([550, 550]);
  });
  it("renders actual probability, legal source/target and proportional thickness", () => {
    const html = renderToStaticMarkup(
      <Arrows
        moves={[
          {
            uci: "g1f3",
            san: "Nf3",
            origin: "g1",
            target: "f3",
            piece: "N",
            probability: 0.42,
          },
        ]}
        flipped={false}
        opacity={0.8}
        selected=""
      />,
    );
    expect(html).toContain("42%");
    expect(html).toContain('x1="650"');
    expect(html).toContain('y1="750"');
    expect(html).toContain('stroke-width="14.24"');
    expect(html).toContain('opacity="0.8"');
  });
});
