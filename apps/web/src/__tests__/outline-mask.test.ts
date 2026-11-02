import type { MultiPolygon } from "geojson";
import { describe, expect, it } from "vitest";
import { invertOutline, ringArea } from "@/components/map/outline-mask";

const ring = (x: number, y: number, size: number, clockwise: boolean): number[][] => {
  const ccw = [
    [x, y],
    [x + size, y],
    [x + size, y + size],
    [x, y + size],
    [x, y],
  ];
  return clockwise ? [...ccw].reverse() : ccw;
};

describe("invertOutline", () => {
  it("строит прямоугольник мира с контурами страны в роли дырок", () => {
    const outline: MultiPolygon = {
      type: "MultiPolygon",
      coordinates: [[ring(67, 37, 5, false)], [ring(70, 40, 0.1, true)]],
    };
    const mask = invertOutline(outline);
    expect(mask.geometry.type).toBe("Polygon");
    const [world, ...holes] = mask.geometry.coordinates;
    expect(world?.[0]).toEqual([-180, -85]);
    expect(holes).toHaveLength(2);
    // MapLibre отличает дырку от нового полигона по направлению обхода: у дырок оно обратное внешнему.
    const outer = Math.sign(ringArea(world ?? []));
    for (const hole of holes) expect(Math.sign(ringArea(hole))).toBe(-outer);
  });

  it("берёт только внешние кольца: щели между областями не становятся «островами» маски", () => {
    const outline: MultiPolygon = {
      type: "MultiPolygon",
      coordinates: [[ring(67, 37, 5, false), ring(68, 38, 0.5, true)]],
    };
    expect(invertOutline(outline).geometry.coordinates).toHaveLength(2);
  });

  it("пропускает вырожденные кольца", () => {
    const outline: MultiPolygon = {
      type: "MultiPolygon",
      coordinates: [
        [
          [
            [67, 37],
            [68, 37],
            [67, 37],
          ],
        ],
      ],
    };
    expect(invertOutline(outline).geometry.coordinates).toHaveLength(1);
  });
});
